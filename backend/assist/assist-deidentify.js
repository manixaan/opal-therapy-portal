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
const { ageGroupOf } = require('./age-groups');

const ROLE_TOKEN = { client: 'CLIENT', contact: 'CONTACT', therapist: 'THERAPIST', staff: 'STAFF', person: 'PERSON' };
const MAX_KNOWN = 200;
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
  for (const k of (Array.isArray(known) ? known : []).slice(0, MAX_KNOWN)) {
    if (!k || typeof k.token !== 'string' || !/^[A-Z]+_\d+$/.test(k.token)) continue;
    if (used.has(k.token)) continue;
    let name = null; let role = null;
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
  return { entries: out, used };
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
  const shape = { knownSpans: await knownValues.matcher(), ageGroupOf };

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
  const knownOut = entries.map((e) => (e.ref ? { token: e.token, ref: e.ref, role: e.role } : { token: e.token, name: e.name, role: e.role }))
    .filter((k) => k.ref || (k.role === 'person'));
  return {
    text: out, hidden, candidates: r.candidates, known: knownOut,
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
  if (r.entries.length) return 'known_name_present';
  return null;
}

module.exports = { check, assertClean, labelFor, ROLE_TOKEN };
