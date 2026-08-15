'use strict';

/**
 * WHODAS 2.0 — 36-ITEM INSTRUMENT REGISTRY
 *
 * The structural facts about the instrument: which items exist, which domain
 * each belongs to, how each response maps to a number, and how each item is
 * recoded for IRT scoring. Pure data and pure functions — no database, no IO,
 * no Express. `scoring.js` consumes this; nothing here knows what a request is.
 *
 * Every fact below was read out of the supplied WHO material during the source
 * audit (docs/whodas/02_WHO_SOURCE_AUDIT.md). Item wording is NOT here: it is
 * derived from the template PDFs into instrument-data.json, so it cannot be
 * mistyped. This file holds only what the PDFs cannot tell us.
 *
 * ── The two numeric codings, and why both exist ────────────────────────────
 * The manual's prose (§6.1) and its Chapter 8 SPSS syntax use 1-5. The two
 * supplied scoring workbooks use 0-4. They describe the same five categories.
 * Storing a numeral would therefore be ambiguous, so responses are stored as
 * the SEMANTIC value ('none' … 'extreme') and each scoring method asks for the
 * coding it needs. Nothing in this module ever infers meaning from display text.
 */

// ── Response scale ───────────────────────────────────────────────────────────

/**
 * The five printed categories, in left-to-right order.
 *   who04 — the coding stated in both supplied scoring workbooks (cells B2-B6)
 *   who15 — the coding printed on the interviewer form and used as the INPUT
 *           to the Chapter 8 SPSS recode
 */
const RESPONSE_SCALE = [
  { value: 'none', label: 'None', who04: 0, who15: 1 },
  { value: 'mild', label: 'Mild', who04: 1, who15: 2 },
  { value: 'moderate', label: 'Moderate', who04: 2, who15: 3 },
  { value: 'severe', label: 'Severe', who04: 3, who15: 4 },
  { value: 'extreme', label: 'Extreme or cannot do', who04: 4, who15: 5 },
];

const RESPONSE_VALUES = RESPONSE_SCALE.map((r) => r.value);
const BY_VALUE = new Map(RESPONSE_SCALE.map((r) => [r.value, r]));

function isResponseValue(v) {
  return typeof v === 'string' && BY_VALUE.has(v);
}

/** Semantic value → 0-4 coding (both supplied workbooks). */
function toWho04(value) {
  const r = BY_VALUE.get(value);
  if (!r) throw new Error(`Unknown WHODAS response value: ${JSON.stringify(value)}`);
  return r.who04;
}

/** Semantic value → 1-5 coding (interviewer form / Chapter 8 SPSS input). */
function toWho15(value) {
  const r = BY_VALUE.get(value);
  if (!r) throw new Error(`Unknown WHODAS response value: ${JSON.stringify(value)}`);
  return r.who15;
}

// ── IRT recode (manual Chapter 8) ────────────────────────────────────────────

/**
 * Chapter 8 recodes every item into one of exactly two patterns, expressed
 * there over 1-5 input:
 *
 *   flat       (1=0) (2=1) (3=2) (4=3) (5=4)      → item max 4
 *   collapsed  (1=0) (2=1) (3=1) (4=2) (5=2)      → item max 2
 *
 * Restated over the 0-4 coding this module stores, `flat` is the identity and
 * `collapsed` is [0,1,1,2,2]. Keeping the tables indexed by 0-4 avoids a
 * pointless +1/-1 round trip; `RECODE_FROM_WHO15` is retained so a test can
 * assert the two formulations agree.
 */
const RECODE = {
  flat: [0, 1, 2, 3, 4],
  collapsed: [0, 1, 1, 2, 2],
};

/** The same two patterns keyed by the literal 1-5 inputs Chapter 8 recodes. */
const RECODE_FROM_WHO15 = {
  flat: { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 },
  collapsed: { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2 },
};

// ── Domains ──────────────────────────────────────────────────────────────────

/**
 * `title` is the heading printed on the instrument; `conceptName` is the
 * shorthand used in manual §6.2. The UI shows `title`, because that is what the
 * clinician just read to the client.
 */
const DOMAINS = [
  { domain: 1, key: 'understanding_communicating', title: 'Understanding and communicating', conceptName: 'Cognition' },
  { domain: 2, key: 'getting_around', title: 'Getting around', conceptName: 'Mobility' },
  { domain: 3, key: 'self_care', title: 'Self-care', conceptName: 'Self-care' },
  { domain: 4, key: 'getting_along', title: 'Getting along with people', conceptName: 'Getting along' },
  { domain: 5, key: 'life_activities', title: 'Life activities', conceptName: 'Life activities' },
  { domain: 6, key: 'participation', title: 'Participation in society', conceptName: 'Participation' },
];

/** Domain 5 is printed as two blocks; Chapter 8 scores them separately. */
const LIFE_HOUSEHOLD = 'household';
const LIFE_WORK_SCHOOL = 'work_school';

// ── The 36 scored items ──────────────────────────────────────────────────────

/**
 * `irt` is the Chapter 8 recode class. For Domain 5 the class assignment rests
 * on the SPSS-variable → printed-item mapping recorded as Q2 in
 * docs/whodas/04_OPEN_QUESTIONS.md: Chapter 8 names the household block
 * d5_2..d5_5 and the work block d5_8..d5_11, while every form prints them
 * D5.1-D5.4 and D5.5-D5.8. The offset below is the only assignment that
 * reproduces Chapter 8's /10 and /14 denominators; `assertDomainMaxima()`
 * fails the build if that ever stops being true.
 */
const ITEMS = [
  // Domain 1 — Understanding and communicating (max 20)
  { id: 'D1.1', domain: 1, irt: 'flat' },
  { id: 'D1.2', domain: 1, irt: 'flat' },
  { id: 'D1.3', domain: 1, irt: 'flat' },
  { id: 'D1.4', domain: 1, irt: 'flat' },
  { id: 'D1.5', domain: 1, irt: 'collapsed' },
  { id: 'D1.6', domain: 1, irt: 'collapsed' },

  // Domain 2 — Getting around (max 16)
  { id: 'D2.1', domain: 2, irt: 'flat' },
  { id: 'D2.2', domain: 2, irt: 'collapsed' },
  { id: 'D2.3', domain: 2, irt: 'collapsed' },
  { id: 'D2.4', domain: 2, irt: 'flat' },
  { id: 'D2.5', domain: 2, irt: 'flat' },

  // Domain 3 — Self-care (max 10)
  { id: 'D3.1', domain: 3, irt: 'collapsed' },
  { id: 'D3.2', domain: 3, irt: 'flat' },
  { id: 'D3.3', domain: 3, irt: 'collapsed' },
  { id: 'D3.4', domain: 3, irt: 'collapsed' },

  // Domain 4 — Getting along with people (max 12)
  { id: 'D4.1', domain: 4, irt: 'collapsed' },
  { id: 'D4.2', domain: 4, irt: 'collapsed' },
  { id: 'D4.3', domain: 4, irt: 'collapsed' },
  { id: 'D4.4', domain: 4, irt: 'flat' },
  { id: 'D4.5', domain: 4, irt: 'collapsed' },

  // Domain 5(1) — Life activities, household (max 10). Always applicable.
  { id: 'D5.1', domain: 5, block: LIFE_HOUSEHOLD, irt: 'collapsed' },
  { id: 'D5.2', domain: 5, block: LIFE_HOUSEHOLD, irt: 'collapsed' },
  { id: 'D5.3', domain: 5, block: LIFE_HOUSEHOLD, irt: 'flat' },
  { id: 'D5.4', domain: 5, block: LIFE_HOUSEHOLD, irt: 'collapsed' },

  // Domain 5(2) — Life activities, work/school (max 14). Conditional: the form
  // instructs the respondent to skip these unless they work (paid, non-paid,
  // self-employed) or go to school.
  { id: 'D5.5', domain: 5, block: LIFE_WORK_SCHOOL, irt: 'collapsed' },
  { id: 'D5.6', domain: 5, block: LIFE_WORK_SCHOOL, irt: 'flat' },
  { id: 'D5.7', domain: 5, block: LIFE_WORK_SCHOOL, irt: 'flat' },
  { id: 'D5.8', domain: 5, block: LIFE_WORK_SCHOOL, irt: 'flat' },

  // Domain 6 — Participation in society (max 24)
  { id: 'D6.1', domain: 6, irt: 'collapsed' },
  { id: 'D6.2', domain: 6, irt: 'flat' },
  { id: 'D6.3', domain: 6, irt: 'collapsed' },
  { id: 'D6.4', domain: 6, irt: 'flat' },
  { id: 'D6.5', domain: 6, irt: 'flat' },
  { id: 'D6.6', domain: 6, irt: 'collapsed' },
  { id: 'D6.7', domain: 6, irt: 'flat' },
  { id: 'D6.8', domain: 6, irt: 'collapsed' },
];

const ITEM_IDS = ITEMS.map((i) => i.id);
const ITEM_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** The four conditional work/school items, in printed order. */
const WORK_SCHOOL_ITEMS = ITEMS.filter((i) => i.block === LIFE_WORK_SCHOOL).map((i) => i.id);
const WORK_SCHOOL_SET = new Set(WORK_SCHOOL_ITEMS);

/** The 32 items that are always applicable (Chapter 8's `st_s32` set). */
const ALWAYS_APPLICABLE_ITEMS = ITEM_IDS.filter((id) => !WORK_SCHOOL_SET.has(id));

const isWorkSchoolItem = (id) => WORK_SCHOOL_SET.has(id);
const itemsInDomain = (domain) => ITEMS.filter((i) => i.domain === domain);
const irtMaxFor = (item) => Math.max(...RECODE[item.irt]);

// ── Chapter 8 denominators, and the check that we reproduce them ─────────────

/**
 * Transcribed verbatim from manual Chapter 8 (PDF p.69 / printed p.61).
 * These are assertions about WHO's arithmetic, not values we choose.
 */
const IRT_DENOMINATORS = {
  Do1: 20,
  Do2: 16,
  Do3: 10,
  Do4: 12,
  Do51: 10,  // household
  Do52: 14,  // work/school
  Do6: 24,
  st_s32: 92,
  st_s36: 106,
};

/**
 * Every Chapter 8 denominator must equal the sum of that group's per-item
 * maxima under our recode assignment. This is what makes the Domain-5 mapping
 * inference verifiable rather than merely plausible: get any item's recode
 * class wrong and a denominator stops matching.
 *
 * Called at module load, so a bad edit fails fast and loudly rather than
 * quietly producing wrong clinical numbers.
 */
function assertDomainMaxima() {
  const maxOf = (items) => items.reduce((s, i) => s + irtMaxFor(i), 0);
  const household = ITEMS.filter((i) => i.block === LIFE_HOUSEHOLD);
  const work = ITEMS.filter((i) => i.block === LIFE_WORK_SCHOOL);

  const actual = {
    Do1: maxOf(itemsInDomain(1)),
    Do2: maxOf(itemsInDomain(2)),
    Do3: maxOf(itemsInDomain(3)),
    Do4: maxOf(itemsInDomain(4)),
    Do51: maxOf(household),
    Do52: maxOf(work),
    Do6: maxOf(itemsInDomain(6)),
  };
  actual.st_s32 = maxOf(ITEMS.filter((i) => !WORK_SCHOOL_SET.has(i.id)));
  actual.st_s36 = maxOf(ITEMS);

  const wrong = Object.entries(IRT_DENOMINATORS)
    .filter(([k, v]) => actual[k] !== v)
    .map(([k, v]) => `${k}: WHO says ${v}, recode table yields ${actual[k]}`);

  if (wrong.length) {
    throw new Error(
      'WHODAS IRT recode table disagrees with the manual Chapter 8 denominators:\n  ' +
      `${wrong.join('\n  ')}\nRefusing to load — see docs/whodas/02_WHO_SOURCE_AUDIT.md §5b.`
    );
  }
  if (ITEMS.length !== 36) throw new Error(`WHODAS registry has ${ITEMS.length} items, expected 36`);
  return actual;
}

assertDomainMaxima();

// ── Workbook denominators (the two supplied spreadsheets) ────────────────────

/**
 * Raw 0-4 maxima: item count x 4. Transcribed from the workbook formulas.
 *   simple  overall  = SUM(all 36) / 144
 *   domain-mean      = per-domain SUM / [24,20,16,20,32,32], then mean of six
 */
const WORKBOOK_DENOMINATORS = {
  simpleOverall: 144,
  domain: { 1: 24, 2: 20, 3: 16, 4: 20, 5: 32, 6: 32 },
};

function assertWorkbookMaxima() {
  const wrong = [];
  for (const d of [1, 2, 3, 4, 5, 6]) {
    const expect = itemsInDomain(d).length * 4;
    if (WORKBOOK_DENOMINATORS.domain[d] !== expect) {
      wrong.push(`domain ${d}: workbook says ${WORKBOOK_DENOMINATORS.domain[d]}, ${itemsInDomain(d).length} items x 4 = ${expect}`);
    }
  }
  if (WORKBOOK_DENOMINATORS.simpleOverall !== ITEMS.length * 4) {
    wrong.push(`simple overall: workbook says ${WORKBOOK_DENOMINATORS.simpleOverall}, ${ITEMS.length} items x 4 = ${ITEMS.length * 4}`);
  }
  if (wrong.length) {
    throw new Error(`WHODAS workbook denominators disagree with the item registry:\n  ${wrong.join('\n  ')}`);
  }
}

assertWorkbookMaxima();

// ── Non-scored items ─────────────────────────────────────────────────────────

/**
 * Present on the forms, captured for the clinical record and rendered into the
 * completed PDF, but scored by NO supplied source. They must never reach the
 * scoring engine.
 */
const DAY_COUNT_ITEMS = ['H1', 'H2', 'H3'];

/** Proxy only. The eight coded options are printed on page 1 of the proxy form. */
const PROXY_RELATIONSHIP_OPTIONS = [
  { code: 1, label: 'husband or wife' },
  { code: 2, label: 'parent' },
  { code: 3, label: 'son or daughter' },
  { code: 4, label: 'brother or sister' },
  { code: 5, label: 'other relative' },
  { code: 6, label: 'friend' },
  { code: 7, label: 'professional carer' },
  { code: 8, label: 'other (specify)' },
];

/**
 * Interviewer-only extras. D5.9/D5.10 use a 1=No / 2=Yes coding that is NOT the
 * difficulty scale and must never be fed through the recode. D5.01/D5.02 are
 * conditional day counts.
 */
const INTERVIEWER_EXTRA_ITEMS = {
  'D5.01': { type: 'day_count', conditionalOn: ['D5.1', 'D5.2', 'D5.3', 'D5.4'] },
  'D5.02': { type: 'day_count', conditionalOn: WORK_SCHOOL_ITEMS },
  'D5.9': { type: 'yes_no', coding: { no: 1, yes: 2 } },
  'D5.10': { type: 'yes_no', coding: { no: 1, yes: 2 } },
};

/**
 * A5 (interviewer face sheet) — "Which describes your main work status best?".
 * Options 1-4 are exactly the statuses the D5.5 skip instruction names
 * ("works (paid, non-paid, self-employed) or goes to school"), so A5 can
 * pre-answer the work/school applicability question on the interviewer form.
 * Self and proxy forms have no A5; there the clinician declares it.
 */
const A5_WORK_STATUS = [
  { code: 1, label: 'Paid work', worksOrStudies: true },
  { code: 2, label: 'Self employed, such as own your business or farming', worksOrStudies: true },
  { code: 3, label: 'Non-paid work, such as volunteer or charity', worksOrStudies: true },
  { code: 4, label: 'Student', worksOrStudies: true },
  { code: 5, label: 'Keeping house/homemaker', worksOrStudies: false },
  { code: 6, label: 'Retired', worksOrStudies: false },
  { code: 7, label: 'Unemployed (health reasons)', worksOrStudies: false },
  { code: 8, label: 'Unemployed (other reasons)', worksOrStudies: false },
  { code: 9, label: 'Other', worksOrStudies: false },
];

const ADMINISTRATION_METHODS = ['interviewer', 'self', 'proxy'];

module.exports = {
  RESPONSE_SCALE,
  RESPONSE_VALUES,
  isResponseValue,
  toWho04,
  toWho15,
  RECODE,
  RECODE_FROM_WHO15,
  DOMAINS,
  LIFE_HOUSEHOLD,
  LIFE_WORK_SCHOOL,
  ITEMS,
  ITEM_IDS,
  ITEM_BY_ID,
  WORK_SCHOOL_ITEMS,
  ALWAYS_APPLICABLE_ITEMS,
  isWorkSchoolItem,
  itemsInDomain,
  irtMaxFor,
  IRT_DENOMINATORS,
  WORKBOOK_DENOMINATORS,
  assertDomainMaxima,
  DAY_COUNT_ITEMS,
  PROXY_RELATIONSHIP_OPTIONS,
  INTERVIEWER_EXTRA_ITEMS,
  A5_WORK_STATUS,
  ADMINISTRATION_METHODS,
};
