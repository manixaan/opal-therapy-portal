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
 *   3. STRUCTURED IDENTIFIERS — things with a reliable shape that need no
 *      caller knowledge at all: email addresses, Australian phone numbers,
 *      street addresses and NDIS numbers. Each becomes [EMAIL_n], [PHONE_n],
 *      [ADDRESS_n] or [NDIS_NUMBER_n] and is restored afterwards exactly like
 *      a name. This pass runs FIRST, so an email built from a person's name
 *      is one opaque token rather than a half-replaced fragment.
 *
 * reidentify() puts the names back and REFUSES the result if the model
 * emitted a token it was never given, or if any known name appears in the
 * clear — fail closed, never guess. containsStructuredIdentifier() is the
 * matching output-side check: a raw email, phone, address or NDIS number in
 * the model's answer can only mean it was never hidden on the way in.
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
  // A bracketed token already in the text (from the structured pass, or a
  // confirmed earlier pass) is one opaque non-word run: it must never be
  // matched as a name, offered as a candidate, or phonetically compared.
  const re = /\[[A-Z][A-Z0-9_]*\]|[A-Za-z][A-Za-z'’-]*|[^A-Za-z[]+|\[/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ text: m[0], word: /^[A-Za-z]/.test(m[0]) });
  return out;
}

// ── Structured identifiers ───────────────────────────────────────────────────

/**
 * Shapes that identify a person without any caller knowledge. Deliberately
 * conservative: every pattern anchors on something a clinical narrative does
 * not otherwise contain (an @, a leading 0/+61 with 8-9 more digits, a house
 * number followed by a street type, the 43xxxxxxx NDIS prefix). Ages, dates,
 * scores and dollar amounts never match. Order matters — addresses before
 * phones so a postcode is consumed by the address, NDIS before phone so a
 * 9-digit participant number is never read as a phone.
 */
const STREET_TYPES = 'street|st|road|rd|avenue|ave|av|drive|dr|court|ct|crescent|cres|cr|place|pl|way|lane|ln|parade|pde|boulevard|blvd|bvd|terrace|tce|close|cl|highway|hwy|circuit|cct|grove|gr|rise|loop|esplanade|esp|square|sq|mews|walk|promenade|prom|glade|gdns|gardens|retreat|rtt|entrance|ent|link|vista|view|heights|hts|track|trk|alley|circle|cir|crossing|xing|green|grn|quay|qy|ridge|rdge|row|strand|trail|trl';
const AU_STATES = 'wa|nsw|vic|qld|sa|tas|nt|act';
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_SHAPES = '(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}\\s*[/.-]\\s*\\d{1,2}\\s*[/.-]\\s*(?:\\d{4}|\\d{2})'
  + '|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:' + MONTHS + ')\\.?,?(?:\\s+\\d{4})?'
  + '|(?:' + MONTHS + ')\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?(?:\\s+\\d{4})?)';
const MONTH_INDEX = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** Read a date written the Australian way. Returns { y, m, d } or null. Two-digit years are left to the caller (`y < 100`). */
function parseDate(str) {
  const t = String(str || '').trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\bof\s+/g, '').replace(/[.,]/g, ' ');
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y; let mo; let d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})\s*[/ -]\s*(\d{1,2})\s*[/ -]\s*(\d{4}|\d{2})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else if ((m = t.match(/^(\d{1,2})\s+([a-z]{3})[a-z]*(?:\s+(\d{4}))?$/))) { d = +m[1]; mo = MONTH_INDEX[m[2]]; y = m[3] ? +m[3] : null; }
  else if ((m = t.match(/^([a-z]{3})[a-z]*\s+(\d{1,2})(?:\s+(\d{4}))?$/))) { d = +m[2]; mo = MONTH_INDEX[m[1]]; y = m[3] ? +m[3] : null; }
  else return null;
  if (!mo || mo > 12 || !d || d > 31) return null;
  return { y, m: mo, d };
}

// A named place a person attends: the NAME is identifying, the KIND is
// clinical context. "Subiaco Primary School" → "[SCHOOL_1] (primary school)".
const ORG_KINDS = [
  ['school', 'Education Support Centre|Senior High School|Primary School|High School|Secondary College|Community College|Grammar School|Christian School|Catholic School|Special School|College|School|Kindergarten|Kindy|Pre-?primary|Early Learning Centre|Child ?[Cc]are Centre|Child ?[Cc]are|Day ?[Cc]are|University|TAFE'],
  ['organisation', 'Pty\\.? Ltd\\.?|Ltd\\.?|Inc\\.?|Incorporated|Day Program|Day Centre|Community Centre|Neighbourhood Centre|Group Home|Aged Care|Nursing Home|Retirement Village|Respite Centre|Foundation|Association|Support Coordination|Plan Management|Men\'?s Shed|Workshop|Supported Employment'],
  ['hospital', "Children'?s Hospital|Private Hospital|General Hospital|Hospital|Health Campus|Medical Centre|Health Centre|Health Service|Clinic"],
];
const ORG_SUFFIX = ORG_KINDS.map((k) => k[1]).join('|');
const ORG_LEAD_IN = /^(?:The|At|In|From|To|With|And|Attends|Attending|Visited|Near|For|Of|On|Via|Both|Local|Their|His|Her|Our|A|An)\s+/;
const ORG_RE = new RegExp("\\b(?:[A-Z][A-Za-z'’&-]*\\s+(?:of\\s+|the\\s+)?){1,4}(?:" + ORG_SUFFIX + ')\\b', 'g');
function orgKind(match) {
  for (const [kind, alt] of ORG_KINDS) { const m = match.match(new RegExp('(?:' + alt + ')$')); if (m) return { kind, label: m[0].toLowerCase() }; }
  return { kind: 'organisation', label: 'organisation' };
}

// ── Checksums: a number that passes is that kind of number, whatever surrounds it ──
const digitsOf = (m) => String(m).replace(/\D/g, '');
const luhn = (m) => { const d = digitsOf(m); let sum = 0; for (let i = 0; i < d.length; i++) { let n = +d[d.length - 1 - i]; if (i % 2) { n *= 2; if (n > 9) n -= 9; } sum += n; } return d.length >= 13 && sum % 10 === 0; };
const medicareOk = (m) => { const d = digitsOf(m); if (d.length < 10) return false; const w = [1, 3, 7, 9, 1, 3, 7, 9]; return w.reduce((a, x, i) => a + x * +d[i], 0) % 10 === +d[8]; };
const tfnOk = (m) => { const d = digitsOf(m); const w = d.length === 9 ? [1, 4, 3, 7, 5, 8, 6, 9, 10] : d.length === 8 ? [10, 7, 8, 4, 6, 3, 5, 1] : null; return !!w && w.reduce((a, x, i) => a + x * +d[i], 0) % 11 === 0; };
const abnOk = (m) => { const d = digitsOf(m).split('').map(Number); if (d.length !== 11) return false; d[0] -= 1; const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19]; return w.reduce((a, x, i) => a + x * d[i], 0) % 89 === 0; };

const STRUCTURED_PATTERNS = [
  { role: 'org', re: ORG_RE, inputOnly: true },
  { role: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // A web address or a social handle points at a person's page. Input only: the model may cite ndis.gov.au.
  { role: 'link', inputOnly: true, re: /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?]|\bwww\.[^\s<>()]+[^\s<>().,;:!?]|\b(?:facebook|instagram|linkedin|tiktok|fb)\.com\/[^\s<>()]+|(?<![A-Za-z0-9._%+-])@[A-Za-z0-9_]{3,30}\b/gi },
  {
    role: 'address',
    // "12 Smith Street", "Unit 4/12 Smith St, Fremantle WA 6160", "12a smith road subiaco"
    re: new RegExp(
      '\\b(?:(?:unit|apt|apartment|flat|suite|lot|shop)\\s*\\d{1,5}[a-z]?[,\\s/]+)?'
      + '\\d{1,5}[a-z]?(?:\\s*[/-]\\s*\\d{1,5}[a-z]?)?\\s+'
      + "(?:[A-Za-z][A-Za-z'’-]+\\s+){1,3}(?:" + STREET_TYPES + ')\\b\\.?'
      + "(?:,?\\s+(?!(?:" + AU_STATES + ")\\b)[A-Za-z][A-Za-z'’-]+(?:\\s+[A-Za-z][A-Za-z'’-]+)?)?"
      + '(?:,?\\s+(?:' + AU_STATES + ')\\b)?(?:,?\\s+\\d{4}\\b)?',
      'gi',
    ),
  },
  {
    role: 'address',
    // "PO Box 12", "GPO Box 9 Perth WA 6848", "Locked Bag 3" — the suburb is
    // taken only when a state or postcode follows, so ordinary words are not.
    re: new RegExp(
      '\\b(?:g?\\.?p\\.?\\s?o\\.?\\s?box|locked\\s+bag|private\\s+bag)\\s*\\d{1,6}'
      + "(?:,?\\s+[A-Za-z][A-Za-z'’-]+(?:\\s+[A-Za-z][A-Za-z'’-]+)?(?=,?\\s+(?:(?:" + AU_STATES + ')\\b|\\d{4}\\b)))?'
      + '(?:,?\\s+(?:' + AU_STATES + ')\\b)?(?:,?\\s+\\d{4}\\b)?',
      'gi',
    ),
  },
  // A postcode only when it is called one. A bare four-digit number is a year or a score.
  { role: 'address', re: /(?<=\bpost\s?code(?:\s+is)?[:\s]{1,3})\d{4}\b/gi },
  {
    role: 'dob',
    // Only a date that is SAID to be a birth date. Session dates are clinical
    // content and stay. The cue stays in the text; the date becomes [DOB_n].
    re: new RegExp('(?<=\\b(?:d\\.?\\s?o\\.?\\s?b\\.?|date\\s+of\\s+birth|birth\\s?date|birthday|born)(?:\\s+(?:is|was|on|in))?[:\\s-]{1,3})' + DATE_SHAPES + '\\b', 'gi'),
  },
  // A typed age. The model is given the age GROUP (see ageGroupOf); the exact
  // figure, with a suburb and a school, is how a child is picked out of a town.
  { role: 'age', inputOnly: true, re: /\b\d{1,3}\s?(?:yo|y\.o\.?|y\/o|yrs?\s?old|years?\s?old|-year-old|\syear-old)\b|\b\d{1,2}\s?(?:mo|months?)\s?old\b|(?<=\b(?:aged?|age\s+of|turns|turned|turning)\s)\d{1,3}\b(?!\s?(?:%|percent|times|sessions|weeks|days|hours|minutes|mins))/gi },
  // Medicare: ten digits written 4-5-1 (optionally a reference digit), or
  // any ten/eleven digits after the word.
  { role: 'medicare', re: /\b[2-6]\d{3}[\s-]\d{5}[\s-]\d(?:\s?[/-]?\s?\d)?\b|(?<=\bmedicare(?:\s+(?:card|number|no\.?|num|#))*[:\s#-]{1,3})[2-6]\d{9,10}\b/gi },
  // Ten digits that pass the Medicare check digit, however they are spaced.
  { role: 'medicare', valid: medicareOk, re: /\b[2-6]\d{9}\d?\b/g },
  // Individual Healthcare Identifier: sixteen digits from 8003 6, Luhn-checked.
  { role: 'health_id', valid: luhn, re: /\b8003[\s-]?6\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  // A payment card: 13-19 digits that pass Luhn.
  { role: 'card', valid: luhn, re: /\b(?:\d[\s-]?){12,18}\d\b/g },
  // An ABN (a sole trader's ABN is theirs personally): eleven digits, mod-89.
  { role: 'abn', valid: abnOk, re: /\b\d{2}\s?\d{3}\s?\d{3}\s?\d{3}\b/g },
  { role: 'ndis_number', re: /\b43\d{7}\b/g },
  // Centrelink customer reference: nine digits and a letter.
  { role: 'crn', re: /\b\d{3}[\s-]?\d{3}[\s-]?\d{3}[A-Za-z]\b/g },
  // Tax file number: said to be one, or eight/nine digits that pass the TFN checksum.
  { role: 'tfn', re: /(?<=\b(?:tfn|tax\s+file(?:\s+(?:number|no\.?))?)[:\s#-]{1,3})\d(?:[\s-]?\d){7,8}\b/gi },
  { role: 'tfn', valid: tfnOk, re: /\b\d{3}[\s-]\d{3}[\s-]\d{2,3}\b/g },
  // Bank: a BSB, and the account number that follows it.
  { role: 'bank', re: /\b(?:bsb[:\s#-]{0,3})?\d{3}-\d{3}\b(?:[,;\s]+(?:acc(?:ount|t)?(?:\s+(?:number|no\.?|#))?[:\s#-]{0,3})?\d{6,10}\b)?|(?<=\b(?:acc(?:ount|t)?(?:\s+(?:number|no\.?))?)[:\s#-]{1,3})\d{6,10}\b/gi },
  // Identity documents and memberships, recognised by what they are called (formats vary by state and fund).
  { role: 'id_number', re: /(?<=\b(?:driver'?s?\s+licen[cs]e|licen[cs]e|passport|dva|health\s+fund|member(?:ship)?|concession\s+card|pension(?:er)?\s+card|healthcare\s+card|companion\s+card)(?:\s+(?:number|no\.?|num|card|file|#))*[:\s#-]{1,3})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9][A-Za-z0-9-]{4,15}\b/gi },
  // Vehicle registration, when it is called one.
  { role: 'rego', re: /(?<=\b(?:rego|registration|number\s+plate|plate|plates)(?:\s+(?:is|number|no\.?))?[:\s#-]{1,3})(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{2,4}[\s-]?[A-Za-z0-9]{2,4}\b/gi },
  {
    role: 'phone',
    // +61 4xx xxx xxx · 04xx xxx xxx · (08) 9xxx xxxx · 08 9xxx xxxx · 1300/1800 xxx xxx · 13 xx xx
    re: /(?:\+61[\s-]?\(?0?\)?[\s-]?[2-478](?:[\s-]?\d){8}|\(0[2-478]\)[\s-]?\d(?:[\s-]?\d){7}|\b0[2-478](?:[\s-]?\d){8}|\b1[38]00(?:[\s-]?\d){6}|\b13(?:[\s-]?\d){4})\b/g,
  },
  // A landline without its area code: "9388 1234". Two years side by side
  // ("2023-2024") are not a phone. Eight digits run together only after a cue.
  { role: 'phone', re: /\b(?!(?:19|20)\d{2}[\s-](?:19|20)\d{2}\b)[2-9]\d{3}[\s-]\d{4}\b(?![\s-]?\d)|(?<=\b(?:ph|phone|tel|telephone|mob|mobile|call|ring|rang|fax)\.?[:\s]{1,3})[2-9]\d{7}\b/gi },
];
const STRUCTURED_TOKENS = { link: 'LINK', age: 'AGE', health_id: 'HEALTH_ID', card: 'CARD', abn: 'ABN', crn: 'CRN', tfn: 'TFN', bank: 'BANK', id_number: 'ID_NUMBER', rego: 'REGO', suburb: 'SUBURB', organisation: 'ORG', email: 'EMAIL', address: 'ADDRESS', ndis_number: 'NDIS_NUMBER', phone: 'PHONE', dob: 'DOB', medicare: 'MEDICARE_NUMBER', school: 'SCHOOL', hospital: 'HOSPITAL' };
const NUMERIC_ROLES = new Set(['phone', 'ndis_number', 'medicare', 'health_id', 'card', 'abn', 'tfn', 'bank']);

/**
 * Replace every structured identifier with a numbered token. The same value
 * spoken twice gets the same token. Returns entries in the identity-map
 * shape so reidentify() restores them with no special casing.
 */
function deidentifyStructured(text, opts = {}) {
  let out = String(text || '');
  const entries = [];
  const byValue = new Map();
  const counts = {}; // per ROLE, not per pattern — two address patterns share one numbering
  const keyOf = (role, m) => `${role}:${NUMERIC_ROLES.has(role) ? m.replace(/\D/g, '') : m.replace(/\s+/g, ' ').trim().toLowerCase()}`;
  // Tokens already spoken for — earlier turns of the conversation, or tokens
  // another pass put in this text. A new value never reuses one of them, and
  // a value seen before keeps the token it had.
  const reserved = opts.reservedTokens instanceof Set ? opts.reservedTokens : new Set();
  (opts.priorStructured || []).forEach((p) => {
    if (!p || !STRUCTURED_TOKENS[p.role] || !p.name || !p.token) return;
    const e = { token: p.token, role: p.role, name: String(p.name), variants: new Set(), phonetic: new Set(), count: 0 };
    byValue.set(keyOf(p.role, e.name), e); entries.push(e); reserved.add(p.token);
  });
  const tokenise = (role, m) => {
    // Numeric identifiers compare on digits alone so "0412 345 678" and
    // "0412345678" are one token; text ones on collapsed lowercase.
    const key = keyOf(role, m);
    let e = byValue.get(key);
    if (!e) {
      do { counts[role] = (counts[role] || 0) + 1; } while (reserved.has(`${STRUCTURED_TOKENS[role]}_${counts[role]}`));
      e = { token: `${STRUCTURED_TOKENS[role]}_${counts[role]}`, role, name: m.trim(), variants: new Set(), phonetic: new Set(), count: 0 };
      byValue.set(key, e);
      entries.push(e);
    }
    e.count++;
    return e;
  };

  for (const { role, re, valid } of STRUCTURED_PATTERNS) {
    out = out.replace(re, (m) => {
      if (valid && !valid(m)) return m;
      if (role === 'org') {
        const lead = (m.match(ORG_LEAD_IN) || [''])[0];
        const body = m.slice(lead.length);
        if (!/^[A-Z]/.test(body) || body.split(/\s+/).length < 2) return m; // "The School" names nothing
        const { kind, label } = orgKind(body);
        const e = tokenise(kind, body);
        return `${lead}[${e.token}] (${label})`;
      }
      return dress(role, tokenise(role, m), opts);
    });
  }
  // KNOWN VALUES, after the shapes (so a full street address is taken whole
  // before its "12 smith" fragment could be): spans the caller recognised as a recorded detail of a
  // real client (a phone, birth date, NDIS number or address in ANY format).
  // The caller supplies positions only; this module still never does I/O.
  if (typeof opts.knownSpans === 'function') {
    const spans = (opts.knownSpans(out) || []).filter((sp) => STRUCTURED_TOKENS[sp.role] && sp.end > sp.start)
      .sort((x, y) => y.start - x.start);
    let ceiling = Infinity;
    const pieces = [];
    for (const sp of spans) {
      if (sp.end > ceiling) continue; // overlapping: keep the later one already taken
      pieces.push(sp); ceiling = sp.start;
    }
    // Number in reading order, replace from the end so positions hold.
    pieces.slice().reverse().forEach((sp) => { sp.entry = tokenise(sp.role, out.slice(sp.start, sp.end)); sp.entry.count--; });
    for (const sp of pieces) { sp.entry.count++; out = out.slice(0, sp.start) + dress(sp.role, sp.entry, opts) + out.slice(sp.end); }
  }

  return { text: out, entries };
}

/** The token as written into the text. A birth date carries its age group, so the model keeps the clinical meaning without the date. */
function dress(role, e, opts) {
  if (role === 'age' && typeof opts.ageGroupOfYears === 'function') {
    const n = parseInt(e.name, 10);
    const g = opts.ageGroupOfYears(/mo|month/i.test(e.name) ? n / 12 : n);
    return g ? `[${e.token}] (age group: ${g})` : `[${e.token}]`;
  }
  if (role === 'dob' && typeof opts.ageGroupOf === 'function') {
    const g = opts.ageGroupOf(e.name);
    if (g) return `[${e.token}] (age group: ${g})`;
  }
  return `[${e.token}]`;
}

/** True when a raw email, phone, address or NDIS number appears in text. */
function containsStructuredIdentifier(text) {
  const t = String(text || '');
  return STRUCTURED_PATTERNS.filter((p) => !p.inputOnly).some(({ re, valid }) => {
    if (valid) { re.lastIndex = 0; const all = t.match(re) || []; re.lastIndex = 0; return all.some((m) => valid(m)); } re.lastIndex = 0; const hit = re.test(t); re.lastIndex = 0; return hit; });
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

// Everyday English that must never be offered as "is this a person?" by the
// loose detectors below (a lowercase word after a person cue, a near-miss of a
// name already in the conversation). Not a dictionary — the words that really
// do follow "spoke with…" or sit one letter from a common name.
const COMMON_WORDS = new Set(('a about above after again all also am an and any are around as at away back bad be because been before being best better big both but by '
  + 'call called came can care class clear client clients come could day did do does doing done down each early end even every family feel felt few find first for from '
  + 'gave get give go going good got great group had hand has have he help her here high him his home how i if in into is it its just keep kept kind knew know '
  + 'lake last late later left less let life like line little long look made make man many mark may me meet men met might mind more most much must my need never new next '
  + 'no not note notes now of off often old on once one only or other our out over own park part past plan play put ran read real really right room '
  + 'said same saw say school see seen session she should show side since so some soon staff still such take team tell than that the their them then there these they thing things think this those '
  + 'though time to today told too took toward two under until up upon us use used very want was way we week well went were what when where which while who why will with without work would '
  + 'year yes yet you your parent parents mum dad mother father teacher carer coordinator provider support worker therapist doctor nurse everyone someone nobody anyone people person child children kids '
  + 'dark mask mare widen laden loam bike hike mike luck lack lick duke nuke').split(/\s+/));
// A person is about to be named: "spoke with …", "rang …", "his mum …".
const PERSON_CUES = /^(with|to|from|rang|called|phoned|emailed|texted|messaged|met|saw|visited|contacted|thanked|asked|told|cc|attn)$/i;

/** Damerau–Levenshtein distance, capped: returns 2 for anything further than 1. */
function nearMiss(a, b) {
  if (a === b) return 0;
  const la = a.length; const lb = b.length;
  if (Math.abs(la - lb) > 1) return 2;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  const ra = a.slice(i); const rb = b.slice(i);
  if (la === lb) {
    if (ra.slice(1) === rb.slice(1)) return 1;                                   // one letter swapped for another
    if (ra.length >= 2 && ra[0] === rb[1] && ra[1] === rb[0] && ra.slice(2) === rb.slice(2)) return 1; // two letters transposed
    return 2;
  }
  return (la > lb ? ra.slice(1) === rb : rb.slice(1) === ra) ? 1 : 2;             // one letter added or dropped
}

/**
 * @param {string} text
 * @param {object} map          from buildIdentityMap
 * @param {object} [opts]
 * @param {string[]} [opts.confirmedNames]  candidate words the therapist said ARE people
 * @param {string[]} [opts.ignoredWords]    candidate words the therapist said are NOT
 * @param {boolean}  [opts.looseCandidates] also OFFER (never replace) lowercase words after a
 *                                          person cue and one-letter near-misses of a name that
 *                                          did match — for free text with no linked client
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

  // Structured identifiers first — they need no caller knowledge and must
  // not be half-eaten by the name matcher (an email built from a name).
  const structured = deidentifyStructured(text, { knownSpans: opts.knownSpans, ageGroupOf: opts.ageGroupOf, ageGroupOfYears: opts.ageGroupOfYears, reservedTokens: opts.reservedTokens, priorStructured: opts.priorStructured });
  structured.entries.forEach((e) => entries.push(e));

  const toks = tokenise(structured.text);
  const words = toks.map((t) => (t.word ? normaliseWord(stripPossessive(t.text)) : null));
  const out = [];
  const candidates = new Map();
  const knownNorm = new Set();
  entries.forEach((e) => e.variants.forEach((v) => knownNorm.add(v)));

  const sentenceStart = () => {
    const before = out.join('');
    return out.length === 0 || /^\s*$/.test(before) || SENTENCE_END.test(before.trimEnd() + ' ');
  };
  const unmatched = []; // { w, raw, prev } — for the loose candidate pass

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
      while (idx.length < span && j < toks.length) { if (toks[j].word) idx.push(j); else if (idx.length && /\s/.test(toks[j].text) === false && !/^[._]$/.test(toks[j].text)) break; j++; }
      if (idx.length < span) continue;
      const phrase = idx.map((k) => words[k]).join(' ');
      for (const e of entries) {
        if (e.variants.has(phrase)) { matched = { e, last: idx[idx.length - 1] }; break; }
      }
      if (!matched && span === 1) {
        const w = words[i];
        const rawWord = stripPossessive(t.text);
        // CAPITALISED-ONLY variants: short names ("Li") and names that are
        // also everyday words ("Rose"). Lowercase they are English; with a
        // capital they are a person. `midOnly` ones ("An", "Will") are also
        // ordinary sentence openers, so they need a capital mid-sentence.
        if (/^[A-Z]/.test(rawWord)) {
          for (const e of entries) {
            if (e.capVariants && e.capVariants.has(w) && !(e.midOnly && e.midOnly.has(w) && sentenceStart())) { matched = { e, last: i }; break; }
          }
        }
        // Bare initials, in capitals, of someone already named in this conversation.
        if (!matched && /^[A-Z]{2,3}$/.test(rawWord)) {
          for (const e of entries) { if (e.initials && e.initials.has(w)) { matched = { e, last: i }; break; } }
        }
        // "Noahs" — the possessive typed without its apostrophe.
        if (!matched && w.length >= 5 && w.endsWith('s')) {
          const stem = w.slice(0, -1);
          for (const e of entries) { if (e.variants.has(stem)) { matched = { e, last: i, possessive: true }; break; } }
        }
        // "Whitlock-Tan" — a hyphenated word with a known name as one half.
        if (!matched && w.includes('-')) {
          const halves = w.split('-').filter((h) => h.length >= 4);
          for (const e of entries) { if (halves.some((h) => e.variants.has(h))) { matched = { e, last: i }; break; } }
        }
        if (!matched && w.length >= 4 && !COMMON_CAPITALISED.has(w)) {
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
      out.push(`[${matched.e.token}]` + (isPossessive(lastTok.text) || matched.possessive ? "'s" : ''));
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
      if (!reason) unmatched.push({ w, raw, prev, prev2 });
    }
    out.push(t.text);
    i++;
  }

  // ── Loose candidates (offered, never replaced) ──
  if (opts.looseCandidates) {
    const present = [];
    entries.forEach((e) => { if (e.count > 0) e.variants.forEach((v) => { if (!v.includes(' ') && v.length >= 4) present.push(v); }); });
    for (const u of unmatched) {
      if (candidates.has(u.w) || u.w.length < 3 || COMMON_WORDS.has(u.w) || COMMON_CAPITALISED.has(u.w) || RELATIONS.test(u.w) || /\d/.test(u.w)) continue;
      let reason = null;
      if (u.w.length >= 4 && present.some((v) => nearMiss(u.w, v) === 1)) reason = 'close to a name above';
      else if (PERSON_CUES.test(u.prev) || (RELATIONS.test(u.prev) && RELATION_LEADS.test(u.prev2))) reason = 'after a person cue';
      if (reason) candidates.set(u.w, { word: u.raw, reason });
    }
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
    .replace('Client Gp', "Client's GP").replace(/^Client (Mother|Father|Parent|Carer|Sibling|Teacher)$/, "Client's $1")
    .replace('Ndis Number', 'NDIS number').replace('Medicare Number', 'Medicare number').replace(/^Dob$/, 'Date of birth').replace(/^Org$/, 'Organisation').replace(/^Tfn$/, 'Tax file number').replace(/^Crn$/, 'Centrelink reference').replace(/^Abn$/, 'ABN').replace(/^Health Id$/, 'Health identifier').replace(/^Id Number$/, 'Identity document number').replace(/^Rego$/, 'Vehicle registration').replace(/^Bank$/, 'Bank account').replace(/^Card$/, 'Payment card').replace(/^Link$/, 'Web link or handle').replace(/^School$/, 'School or education provider').replace(/^Hospital$/, 'Hospital or clinic').replace(/^Email$/, 'Email address').replace(/^Phone$/, 'Phone number');
}

module.exports = {
  buildIdentityMap, deidentify, reidentify, containsKnownName, containsStructuredIdentifier, describeToken,
  deidentifyStructured, STRUCTURED_TOKENS, DIMINUTIVES, parseDate, DATE_SHAPES, phoneticKey, variantsOf, ROLE_TOKENS, TOKEN_RE,
};
