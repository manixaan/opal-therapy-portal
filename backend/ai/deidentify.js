'use strict';

/**
 * DE-IDENTIFICATION — names out before the model, names back after.
 *
 * A dictated case note is always about a linked client, so the portal knows,
 * before any text leaves, exactly whose names should be in it. That turns
 * "find any name in free text" (not solvable) into "find THESE names"
 * (solvable, deterministically). Two layers:
 *
 *   1. KNOWN IDENTITIES — the client, their contacts, the therapist, other
 *      staff. Every spelling variant (possessive, initials, diminutives,
 *      phonetic near-misses from dictation such as "aid in" for Aiden) is
 *      replaced by a ROLE token: [CLIENT], [CLIENT_MOTHER], [THERAPIST]…
 *      Role tokens carry meaning, so the model writes "[CLIENT]'s mother
 *      reported…" rather than losing the thread behind a bare mask.
 *
 *   2. CANDIDATES — words that LOOK like an unknown person's name
 *      (honorifics, "named X", relation patterns, capitalised mid-sentence).
 *      These are not replaced silently: they are returned for the therapist
 *      to confirm on the phone. Confirmed ones become [PERSON_n]; dismissed
 *      ones are remembered so they are not asked again.
 *
 * reidentify() puts the names back and REFUSES the result if the model
 * emitted a token it was never given, or if any known name appears in the
 * clear — fail closed, never guess.
 *
 * Pure: no I/O, no clock, no logging. Nothing here may log a name.
 */

const TOKEN_RE = /\[([A-Z][A-Z0-9_]*)\]/g;

// ── Name variants ────────────────────────────────────────────────────────────

/** Common Australian diminutives. Deliberately conservative — a wrong
 *  expansion here would hide an ordinary word. */
const DIMINUTIVES = {
  alexander: ['alex', 'xander', 'lex'], alexandra: ['alex', 'lexi', 'sandra'],
  anthony: ['tony', 'ant'], antony: ['tony', 'ant'], benjamin: ['ben', 'benji', 'benny'],
  catherine: ['cath', 'cathy', 'kate', 'katie'], katherine: ['kath', 'kathy', 'kate', 'katie'],
  charles: ['charlie', 'chas'], charlotte: ['lottie', 'charlie'], christopher: ['chris', 'kit'],
  daniel: ['dan', 'danny'], david: ['dave', 'davey'], edward: ['ed', 'eddie', 'ted', 'teddy'],
  elizabeth: ['liz', 'lizzie', 'beth', 'eliza', 'libby'], emily: ['em', 'emmy'],
  ethan: ['e'], harrison: ['harry'], henry: ['harry', 'hal'], isabella: ['bella', 'izzy'],
  isabelle: ['izzy', 'belle'], jacob: ['jake'], james: ['jim', 'jimmy', 'jamie'],
  jessica: ['jess', 'jessie'], jonathan: ['jon', 'jonny'], joseph: ['joe', 'joey'],
  joshua: ['josh'], katherine2: [], lachlan: ['lachie', 'locky'], leonardo: ['leo'],
  matthew: ['matt', 'matty'], michael: ['mike', 'mick', 'mikey'], nicholas: ['nick', 'nicky'],
  oliver: ['ollie'], olivia: ['liv', 'livvy'], patrick: ['pat', 'paddy'], rebecca: ['bec', 'becky', 'bex'],
  richard: ['rick', 'ricky', 'dick'], robert: ['rob', 'robbie', 'bob', 'bobby'],
  samantha: ['sam', 'sammy'], samuel: ['sam', 'sammy'], sebastian: ['seb', 'bas'],
  stephanie: ['steph'], stephen: ['steve'], steven: ['steve'], thomas: ['tom', 'tommy'],
  timothy: ['tim', 'timmy'], victoria: ['vicky', 'tori'], william: ['will', 'bill', 'billy', 'liam'],
  zachary: ['zac', 'zach', 'zak'],
};

/**
 * A compact phonetic key. Not full Metaphone — enough to make "aiden" and
 * "aidan", "zara" and "sara", "mikayla" and "makayla" collide while keeping
 * ordinary short words apart. Used only against the KNOWN name list.
 */
function phoneticKey(word) {
  let w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return '';
  w = w.replace(/^(kn|gn|pn|wr)/, (m) => m[1]).replace(/^x/, 's').replace(/^wh/, 'w');
  w = w.replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/sch/g, 'sk').replace(/gh/g, '')
       .replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k').replace(/q/g, 'k').replace(/z/g, 's')
       .replace(/x/g, 'ks').replace(/dg/g, 'j').replace(/th/g, '0').replace(/w(?![aeiou])/g, '')
       .replace(/h(?![aeiou])/g, '').replace(/y(?![aeiou])/g, 'i');
  const first = w[0];
  const rest = w.slice(1).replace(/[aeiou]/g, '');
  return (first + rest).replace(/(.)\1+/g, '$1');
}

function normaliseWord(w) {
  return String(w || '').toLowerCase().replace(/[’']s$/, '').replace(/[^a-z0-9-]/g, '');
}

/** All the ways one recorded name might be spoken or transcribed. */
function variantsOf(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const out = new Set();
  if (!parts.length) return out;
  const clean = parts.map((p) => p.replace(/[^A-Za-z'’-]/g, '')).filter((p) => p.length > 1);
  if (clean.length === 0) return out;
  out.add(clean.join(' ').toLowerCase());                       // full
  clean.forEach((p) => { if (p.length >= 3) out.add(p.toLowerCase()); }); // each part
  if (clean.length >= 2) {
    out.add(`${clean[0]} ${clean[clean.length - 1]}`.toLowerCase());
    out.add(`${clean[0][0]} ${clean[clean.length - 1]}`.toLowerCase());   // "J Smith"
    out.add(`${clean[0]} ${clean[clean.length - 1][0]}`.toLowerCase());   // "Jane S"
  }
  const first = clean[0].toLowerCase();
  (DIMINUTIVES[first] || []).forEach((d) => { if (d.length >= 3) out.add(d); });
  // Hyphenated or two-part surnames: each half.
  clean.forEach((p) => p.split('-').forEach((h) => { if (h.length >= 4) out.add(h.toLowerCase()); }));
  return out;
}

// ── Identity map ─────────────────────────────────────────────────────────────

const ROLE_TOKENS = {
  client: 'CLIENT', therapist: 'THERAPIST', staff: 'STAFF',
  mother: 'CLIENT_MOTHER', father: 'CLIENT_FATHER', parent: 'CLIENT_PARENT', carer: 'CLIENT_CARER',
  sibling: 'CLIENT_SIBLING', teacher: 'CLIENT_TEACHER', support_coordinator: 'SUPPORT_COORDINATOR',
  plan_manager: 'PLAN_MANAGER', gp: 'CLIENT_GP', contact: 'CONTACT', person: 'PERSON',
};

function tokenFor(role, n) {
  const base = ROLE_TOKENS[role] || ROLE_TOKENS.contact;
  return n > 1 ? `${base}_${n}` : base;
}

/**
 * Build the identity map for one note.
 *
 *   people: [{ name, role }]  role ∈ ROLE_TOKENS keys; client first.
 *
 * Returns { entries: [{ token, role, name, variants: Set, phonetic: Set }] }.
 * Longer variants are matched first so "Jane Smith" wins over "Jane".
 */
function buildIdentityMap(people) {
  const counts = {};
  const entries = [];
  const seen = new Set();
  for (const p of people || []) {
    const name = String(p && p.name || '').trim();
    if (!name || name.length < 2) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const role = ROLE_TOKENS[p.role] ? p.role : 'contact';
    counts[role] = (counts[role] || 0) + 1;
    const variants = variantsOf(name);
    const phonetic = new Set();
    variants.forEach((v) => { if (!v.includes(' ') && v.length >= 4) phonetic.add(phoneticKey(v)); });
    entries.push({ token: tokenFor(role, counts[role]), role, name, variants, phonetic });
  }
  return { entries };
}

// ── Tokenising the transcript ────────────────────────────────────────────────

/** Split text into word / non-word runs, keeping everything. */
function tokenise(text) {
  const out = [];
  const re = /[A-Za-z][A-Za-z'’-]*|[^A-Za-z]+/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], word: /^[A-Za-z]/.test(m[0]) });
  return out;
}

function isPossessive(w) { return /[’']s$/i.test(w); }
function stripPossessive(w) { return w.replace(/[’']s$/i, ''); }

// ── De-identify ──────────────────────────────────────────────────────────────

const HONORIFICS = /^(mr|mrs|ms|miss|dr|doctor|prof|professor|nurse|sister|aunty|auntie|uncle)$/i;
const NAMING_VERBS = /^(named|called|name|names)$/i;
const RELATIONS = /^(mum|mom|mother|dad|father|brother|sister|carer|teacher|nan|nana|grandma|grandmother|grandpa|grandfather|aunt|uncle|cousin|friend|partner|husband|wife|worker|coordinator|therapist|psychologist|physio|physiotherapist|speechie|ot|gp|doctor|teacher|ea|aide)$/i;
const RELATION_LEADS = /^(his|her|their|the|our|my)$/i;
const SENTENCE_END = /[.!?]\s*$/;
// Words that are often capitalised for reasons other than being a name.
const COMMON_CAPITALISED = new Set(('i monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december ndis ot pt ndia australia australian perth wa western sydney melbourne brisbane adelaide english maths science school year term christmas easter covid ipad iphone lego youtube google zoom teams outlook splose opal opa australia mr mrs ms dr').split(/\s+/));

/**
 * @param {string} text
 * @param {object} map          from buildIdentityMap
 * @param {object} [opts]
 * @param {string[]} [opts.confirmedNames]  candidate words the therapist said ARE people
 * @param {string[]} [opts.ignoredWords]    candidate words the therapist said are NOT
 * @returns {{ text, entries: [{token, role, count}], candidates: [{word, reason}], map }}
 */
function deidentify(text, map, opts = {}) {
  // Confirmed names keep the therapist's spelling for restoration; matching
  // is on the normalised form.
  const confirmed = new Map();
  (opts.confirmedNames || []).forEach((raw) => {
    const n = normaliseWord(raw);
    if (n && !confirmed.has(n)) confirmed.set(n, String(raw).trim());
  });
  const ignored = new Set((opts.ignoredWords || []).map(normaliseWord).filter(Boolean));

  // Confirmed unknown people become PERSON_n entries of their own.
  const entries = (map && map.entries ? map.entries : []).map((e) => ({ ...e, count: 0 }));
  let personN = 0;
  for (const [c, original] of confirmed) {
    personN++;
    const variants = new Set([c]);
    entries.push({ token: tokenFor('person', personN), role: 'person', name: original, variants, phonetic: new Set([phoneticKey(c)]), count: 0 });
  }

  const toks = tokenise(String(text || ''));
  const words = toks.map((t) => (t.word ? normaliseWord(stripPossessive(t.text)) : null));
  const out = [];
  const candidates = new Map();
  const knownNorm = new Set();
  entries.forEach((e) => e.variants.forEach((v) => knownNorm.add(v)));

  // Exact multi-word / single-word / phonetic matching, longest first.
  let i = 0;
  while (i < toks.length) {
    const t = toks[i];
    if (!t.word) { out.push(t.text); i++; continue; }
    let matched = null;
    // Try windows of 3, 2, 1 words (with any non-word run between them).
    for (let span = 3; span >= 1 && !matched; span--) {
      const idx = [];
      let j = i;
      while (idx.length < span && j < toks.length) { if (toks[j].word) idx.push(j); else if (idx.length && /\s/.test(toks[j].text) === false) break; j++; }
      if (idx.length < span) continue;
      const phrase = idx.map((k) => words[k]).join(' ');
      for (const e of entries) {
        if (e.variants.has(phrase)) { matched = { e, last: idx[idx.length - 1] }; break; }
      }
      if (!matched && span === 1) {
        const w = words[i];
        if (w.length >= 4 && !COMMON_CAPITALISED.has(w)) {
          const pk = phoneticKey(w);
          for (const e of entries) { if (e.phonetic.has(pk) && !e.variants.has(w) && Math.abs(w.length - e.name.split(' ')[0].length) <= 2) { matched = { e, last: i }; break; } }
        }
      }
      if (!matched && span === 2) {
        // Dictation splitting a name in two: "aid in" → Aiden.
        const joined = idx.map((k) => words[k]).join('');
        if (joined.length >= 4) {
          const pk = phoneticKey(joined);
          for (const e of entries) { if (e.phonetic.has(pk) && e.variants.has(joined) === false && e.role !== 'person') { matched = { e, last: idx[idx.length - 1] }; break; } }
        }
      }
    }
    if (matched) {
      const lastTok = toks[matched.last];
      matched.e.count++;
      out.push(`[${matched.e.token}]` + (isPossessive(lastTok.text) ? "'s" : ''));
      i = matched.last + 1;
      continue;
    }

    // ── Candidate detection (not replaced, only reported) ──
    const w = words[i];
    const raw = stripPossessive(t.text);
    if (!ignored.has(w) && !knownNorm.has(w) && w.length >= 2 && !HONORIFICS.test(w)) {
      const prevWordIdx = (() => { for (let k = i - 1; k >= 0; k--) if (toks[k].word) return k; return -1; })();
      const prev = prevWordIdx >= 0 ? words[prevWordIdx] : '';
      const prev2Idx = (() => { for (let k = prevWordIdx - 1; k >= 0; k--) if (toks[k].word) return k; return -1; })();
      const prev2 = prev2Idx >= 0 ? words[prev2Idx] : '';
      const beforeText = out.join('');
      const atSentenceStart = out.length === 0 || SENTENCE_END.test(beforeText.trimEnd() + ' ') || /^\s*$/.test(beforeText);
      const capitalised = /^[A-Z][a-z]/.test(raw);
      let reason = null;
      if (HONORIFICS.test(prev)) reason = 'after a title';
      else if (NAMING_VERBS.test(prev)) reason = 'after "named"';
      else if (RELATIONS.test(prev) && RELATION_LEADS.test(prev2) && capitalised) reason = 'named relation';
      else if (capitalised && !atSentenceStart && !COMMON_CAPITALISED.has(w) && !RELATIONS.test(w)) reason = 'capitalised mid-sentence';
      if (reason && !candidates.has(w)) candidates.set(w, { word: raw, reason });
    }
    out.push(t.text);
    i++;
  }

  return {
    text: out.join(''),
    entries: entries.filter((e) => e.count > 0).map((e) => ({ token: e.token, role: e.role, count: e.count })),
    candidates: [...candidates.values()],
    map: { entries },
  };
}

// ── Re-identify ──────────────────────────────────────────────────────────────

/**
 * Put names back. Refuses when the model produced a token it was never
 * given, or when any known name still appears in the clear (which would mean
 * the model reconstructed it — or de-identification missed it).
 */
function reidentify(text, map) {
  const entries = (map && map.entries) || [];
  const byToken = new Map(entries.map((e) => [e.token, e]));
  const unknownTokens = new Set();
  const replaced = String(text || '').replace(TOKEN_RE, (m, tok) => {
    const e = byToken.get(tok);
    if (!e) { unknownTokens.add(tok); return m; }
    return e.name;
  });
  return { text: replaced, ok: unknownTokens.size === 0, unknownTokens: [...unknownTokens] };
}

/** True when any known name's full form appears in text (case-insensitive). */
function containsKnownName(text, map) {
  const t = String(text || '').toLowerCase();
  for (const e of (map && map.entries) || []) {
    for (const v of e.variants) {
      if (v.includes(' ') && t.includes(v)) return true;
    }
  }
  return false;
}

/** Human-readable label for a token, for the phone's names check. */
function describeToken(token) {
  return token.replace(/_\d+$/, '').split('_').map((s) => s.charAt(0) + s.slice(1).toLowerCase()).join(' ')
    .replace('Client Gp', "Client's GP").replace(/^Client (Mother|Father|Parent|Carer|Sibling|Teacher)$/, "Client's $1");
}

module.exports = {
  buildIdentityMap, deidentify, reidentify, containsKnownName, describeToken,
  phoneticKey, variantsOf, ROLE_TOKENS, TOKEN_RE,
};
