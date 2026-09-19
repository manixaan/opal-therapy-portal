'use strict';

/**
 * OPAL ASSIST DE-IDENTIFICATION — practice-wide, conversation-stable,
 * names never stored.
 *
 * Composes the pure primitives in backend/ai/deidentify.js (structured
 * identifiers, exact matching, candidate detection, refusal checks) over
 * the practice-wide directory. Three properties the case-note layer does
 * not have:
 *
 *   1. TOKENS ARE NUMBERED BY APPEARANCE. With hundreds of directory
 *      entries the case-note scheme would yield [CLIENT_347]. Here the first
 *      client mentioned is [CLIENT_1], the next [CLIENT_2], and so on.
 *
 *   2. TOKENS ARE STABLE ACROSS A CONVERSATION — but the server keeps no
 *      map. The browser holds `known` ([{token, ref|name, role}]) for the
 *      conversation and sends it with every check; the server honours those
 *      assignments and numbers new people after them. The server therefore
 *      never persists a name beside a transcript, and the reply is restored
 *      in the browser by the person who typed the names.
 *
 *   3. THE SEND PATH IS GUARDED, NOT TRUSTED. `assertClean()` runs on every
 *      message the chat route receives: any directory name, confirmed name
 *      or contact detail still in the clear is a 422 — the client must run
 *      the check first. The model never sees a raw identifier because the
 *      route refuses to send one, not because the client promised.
 *
 * Nothing here logs a name.
 */

const deid = require('../ai/deidentify');
const directory = require('./identity-directory');
const knownValues = require('./known-values');
const { suburbSpans } = require('./suburbs-wa');
const { ageGroupOf, ageGroupOfYears } = require('./age-groups');

const ROLE_TOKEN = { client: 'CLIENT', contact: 'CONTACT', therapist: 'THERAPIST', staff: 'STAFF', person: 'PERSON' };
const MAX_KNOWN = 200;
// Capitals that are jargon, not a person's initials.
const ACRONYMS = new Set('ot pt sp gp ea it hr wa sa nt act nsw vic qld tas adl asd adhd id gdd cp ms ra oa fca abi tbi sil sda ndis ndia dcp doc ed er ent mri ct ecg bp hr am pm tv pc ok na tba tbc fyi asap cc re ps'.split(' '));

// Topics the Privacy Act treats as sensitive in themselves. Never hidden — the
// clinician decides — but said out loud on the review card.
const SENSITIVE_TOPICS = [
  ['cultural or ethnic background', /\b(aboriginal|torres strait|indigenous|first nations|ethnic(?:ity)?|refugee|asylum seeker|visa status|migrant)\b/i],
  ['religion', /\b(religio(?:n|us)|muslim|islam(?:ic)?|christian|catholic|jewish|hindu|buddhist|sikh|church|mosque|temple|synagogue)\b/i],
  ['sexuality or gender identity', /\b(gay|lesbian|bisexual|transgender|non-binary|lgbt\w*|sexual orientation|gender identity)\b/i],
  ['court, police or child protection', /\b(family court|court order|intervention order|restraining order|vro|fvro|police|charged|convicted|criminal|prison|child protection|dcp|department of communities|custody|out-of-home care|foster)\b/i],
  ['abuse or violence', /\b(domestic violence|family violence|abuse[ds]?|assault(?:ed)?|neglect(?:ed)?|self-harm|suicid\w+)\b/i],
  ['substance use', /\b(alcohol(?:ic|ism)?|drug use|substance (?:use|abuse)|methamphetamine|heroin|cannabis|rehab)\b/i],
];
const MAX_NAME_DECISIONS = 50;

const lower = (s) => String(s || '').trim().toLowerCase();

function entryFor({ token, role, name, variants, capVariants, midOnly }) {
  return { token, role, name, variants, capVariants, midOnly, phonetic: new Set(), count: 0 };
}

/** Next free number for a role given tokens already handed out. */
function nextNumber(role, used) {
  const base = ROLE_TOKEN[role] || ROLE_TOKEN.person;
  let n = 1;
  while (used.has(`${base}_${n}`)) n++;
  used.add(`${base}_${n}`);
  return `${base}_${n}`;
}

/**
 * Turn the browser's `known` list back into map entries with their tokens.
 * A ref resolves through the directory (name never travels); a confirmed
 * unknown person carries the name the user confirmed.
 */
async function knownEntries(known) {
  const out = [];
  const used = new Set();
  const structured = []; // contact details and record numbers from earlier turns keep their token
  for (const k of (Array.isArray(known) ? known : []).slice(0, MAX_KNOWN)) {
    if (!k || typeof k.token !== 'string' || !/^[A-Z]+_\d+$/.test(k.token)) continue;
    if (used.has(k.token)) continue;
    let name = null; let role = null;
    if (deid.STRUCTURED_TOKENS[k.role] && typeof k.name === 'string' && k.name.trim() && k.token.startsWith(`${deid.STRUCTURED_TOKENS[k.role]}_`)) {
      structured.push({ token: k.token, role: k.role, name: k.name.trim().slice(0, 200) });
      used.add(k.token);
      continue;
    }
    if (typeof k.ref === 'string') {
      const e = await directory.byRef(k.ref);
      if (!e) continue;
      name = e.name; role = e.role;
      out.push(entryFor({ token: k.token, role, name, variants: e.variants, capVariants: e.capVariants, midOnly: e.midOnly }));
      out[out.length - 1].ref = k.ref;
    } else if (typeof k.name === 'string' && k.name.trim().length >= 2) {
      name = k.name.trim(); role = 'person';
      out.push(entryFor({ token: k.token, role, name, variants: new Set([lower(name)]) }));
    } else continue;
    used.add(k.token);
  }
  return { entries: out, used, structured };
}

/**
 * Check-before-send: what would leave, and what was hidden.
 *
 * @returns {{ text, hidden:[{token,label,name,role,ref?,count}], candidates:[{word,reason}], known:[{token,ref?|name,role}] }}
 */
async function check({ text, known, confirmedNames, ignoredWords }) {
  const dir = await directory.load();
  const prior = await knownEntries(known);
  const used = prior.used;
  // A client's own recorded phone, birth date, NDIS number or address, in any format.
  // Tokens already written in the text (another pass put them there) are never handed out again.
  for (const m of String(text || '').matchAll(/\[([A-Z][A-Z_]*_\d+)\]/g)) used.add(m[1]);
  // …and place names: the client's own suburb by fingerprint, other listed suburbs by name.
  const recorded = await knownValues.matcher();
  const knownSpans = (t) => [...(recorded ? recorded(t) : []), ...suburbSpans(t)];
  const shape = { knownSpans, ageGroupOf, ageGroupOfYears, reservedTokens: used, priorStructured: prior.structured };

  // Pass 1: everything the directory knows, plus prior tokens, to find who
  // actually appears. Directory entries get provisional tokens.
  const provisional = dir.entries.map((e) => entryFor({ token: `__DIR__${e.ref}`, role: e.role, name: e.name, variants: e.variants, capVariants: e.capVariants, midOnly: e.midOnly }));
  provisional.forEach((p, i) => { p.ref = dir.entries[i].ref; });
  const pass1 = deid.deidentify(text, { entries: [...prior.entries, ...provisional] }, {
    confirmedNames: cleanList(confirmedNames), ignoredWords: cleanList(ignoredWords), ...shape,
  });

  // Order the directory hits by first appearance in the tokenised text and
  // number them after the prior tokens.
  const hits = new Map();
  const re = /\[__DIR__([^\]]+)\]/g;
  let m;
  while ((m = re.exec(pass1.text)) !== null) if (!hits.has(m[1])) hits.set(m[1], hits.size);
  const assigned = [];
  for (const ref of hits.keys()) {
    const e = provisional.find((p) => p.ref === ref);
    const token = nextNumber(e.role, used);
    assigned.push(Object.assign(entryFor({ token, role: e.role, name: e.name, variants: e.variants, capVariants: e.capVariants, midOnly: e.midOnly }), { ref }));
  }

  // People who ARE in this conversation are also matched by nickname ("Tony"
  // for Antony) and by bare initials in capitals ("NW attended"). Practice-wide
  // these would hide "Will" and "OT"; for a person already named here they are
  // almost certainly that person.
  [...prior.entries, ...assigned].forEach((e) => {
    if (e.role === 'person') return;
    const parts = String(e.name).trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
    const first = (parts[0] || '').toLowerCase();
    const extra = new Set(e.variants);
    (deid.DIMINUTIVES[first] || []).forEach((d) => { if (d.length >= 3 && !directory.EVERYDAY.has(d)) extra.add(d); });
    e.variants = extra;
    if (parts.length >= 2) {
      const ini = parts.map((w) => w[0]).join('').toLowerCase();
      if (ini.length >= 2 && ini.length <= 3 && !ACRONYMS.has(ini)) e.initials = new Set([ini]);
    }
  });

  // Pass 2: only the people present, with their final tokens, so the
  // returned map is exact and confirmed unknown people number correctly.
  const confirmed = cleanList(confirmedNames).filter((n) => !prior.entries.some((e) => e.role === 'person' && lower(e.name) === lower(n)));
  const finalEntries = [...prior.entries, ...assigned];
  const r = deid.deidentify(text, { entries: finalEntries }, { confirmedNames: confirmed, ignoredWords: cleanList(ignoredWords), looseCandidates: true, ...shape });

  // The primitive copies entries, so prior ones are recognised by token.
  const priorTokens = new Set(prior.entries.map((e) => e.token));

  // Confirmed unknown people come back as PERSON_n from the primitive,
  // numbered from 1 — renumber past any prior PERSON tokens.
  let out = r.text;
  const personMap = new Map();
  // (The primitive names the first confirmed person [PERSON] and the next
  // [PERSON_2]; here every person token carries a number.)
  r.map.entries.filter((e) => e.role === 'person' && !priorTokens.has(e.token)).forEach((e) => {
    const fresh = nextNumber('person', used);
    personMap.set(e.token, fresh);
    e.token = fresh;
  });
  if (personMap.size) out = out.replace(/\[(PERSON(?:_\d+)?)\]/g, (whole, t) => (personMap.has(t) ? `[${personMap.get(t)}]` : whole));

  const entries = r.map.entries.filter((e) => e.count > 0 || priorTokens.has(e.token));
  const hidden = entries.filter((e) => e.count > 0).map((e) => ({
    token: e.token, label: labelFor(e), name: e.name, role: e.role, ref: e.ref || null, count: e.count,
  }));
  // CAUTIONS — said, never enforced. (1) sensitive topics; (2) combination
  // risk: tokens hide WHO, but several leftover specifics together can still
  // point at one person in a small community.
  const cautions = [];
  const topics = SENSITIVE_TOPICS.filter(([, re]) => re.test(out)).map(([label]) => label);
  if (topics.length) cautions.push({ kind: 'sensitive_topic', message: `This mentions ${topics.join(', ')}. Send only what the question needs.` });
  const specifics = [
    r.candidates.length > 0 && 'a name or place still written out',
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/.test(out) && 'an exact date',
    /\[(?:SCHOOL|HOSPITAL|ORG)_\d+\]/.test(out) && /\[AGE_\d+\]|\[DOB_\d+\]/.test(out) && 'an age group with a named kind of place',
    /\b(only|sole|rare|one of (?:two|three|the few))\b/i.test(out) && 'a detail described as rare or the only one',
    /\b(twin|triplet|wheelchair|amputee|tracheostomy|peg[- ]fed|ventilator|guide dog|assistance dog)\b/i.test(out) && 'a distinctive personal detail',
  ].filter(Boolean);
  if (specifics.length >= 3) cautions.push({ kind: 'combination', message: `Together these could still point to one person: ${specifics.join('; ')}. Consider removing one.` });

  const priorStructuredTokens = new Set(prior.structured.map((p) => p.token));
  const knownOut = r.map.entries.filter((e) => e.count > 0 || priorTokens.has(e.token) || priorStructuredTokens.has(e.token))
    .map((e) => (e.ref ? { token: e.token, ref: e.ref, role: e.role } : { token: e.token, name: e.name, role: e.role }))
    .filter((k) => k.ref || k.role === 'person' || deid.STRUCTURED_TOKENS[k.role]);
  return {
    text: out, hidden, candidates: r.candidates, known: knownOut, cautions,
    directoryPartial: !!dir.partial, directoryMissing: dir.missing || [], directoryNotConnected: dir.notConnected || [], directoryCount: dir.count || dir.entries.length,
  };
}

function labelFor(e) {
  if (e.role === 'client') return 'Client';
  if (e.role === 'contact') return 'Contact';
  if (e.role === 'therapist') return 'Practitioner';
  if (e.role === 'staff') return 'Staff member';
  if (e.role === 'person') return 'Person';
  return deid.describeToken(e.token);
}

function cleanList(list) {
  return (Array.isArray(list) ? list : []).filter((s) => typeof s === 'string').map((s) => s.trim()).filter((s) => s && s.length <= 60).slice(0, MAX_NAME_DECISIONS);
}

/**
 * The send-path guard. Returns null when the text carries no identifier the
 * practice knows about and no contact detail; otherwise a reason code.
 * Confirmed names from the browser's map are checked too.
 */
async function assertClean({ text, known }) {
  if (deid.containsStructuredIdentifier(text)) return 'contact_detail_present';
  const knownSpans = await knownValues.matcher();
  if (knownSpans && knownSpans(text).length) return 'client_record_detail_present';
  const dir = await directory.load();
  const prior = await knownEntries(known);
  const r = deid.deidentify(text, { entries: [...prior.entries, ...dir.entries.map((e) => entryFor({ token: 'X_1', role: e.role, name: e.name, variants: e.variants, capVariants: e.capVariants, midOnly: e.midOnly }))] });
  // Shapes were judged above (and ages, links and place names are hidden on the way in, not refused); here only PEOPLE count.
  if (r.entries.some((e) => !deid.STRUCTURED_TOKENS[e.role])) return 'known_name_present';
  return null;
}

module.exports = { check, assertClean, labelFor, ROLE_TOKEN };
