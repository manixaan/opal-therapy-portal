'use strict';

/**
 * WHODAS 2.0 — SCORING GOLDEN TESTS
 *
 * Three independent references, none of which is the engine under test:
 *
 *   1. The WHO workbooks themselves. `whodas-workbook-oracle` opens the .xlsx
 *      files and evaluates their own formula strings, so `simple_sum` and
 *      `domain_mean` are checked against WHO's spreadsheet rather than against
 *      a second copy of my reading of it.
 *
 *   2. A literal transcription of manual Chapter 8 (below). It is deliberately
 *      written the awkward way — SPSS variable names, the 1-5 recode tables as
 *      printed, the domain formulas verbatim — while the engine works in 0-4
 *      space where `flat` collapses to the identity. Two different
 *      formulations that must agree on every input.
 *
 *   3. Hand-computed fixtures for the boundaries.
 */

const {
  score,
  scoreAll,
  ALL_METHODS,
  SCORING_VERSION,
  MAX_IMPUTABLE_MISSING,
} = require('../whodas/scoring');

const I = require('../whodas/instrument');

const {
  runSimpleWorkbook,
  runDomainMeanWorkbook,
  workbookItemCells,
  workbookFormulas,
} = require('./helpers/whodas-workbook-oracle');

// ── Chapter 8, transcribed literally ─────────────────────────────────────────

/** Recode maps exactly as printed: `(1=0) (2=1) (3=2) (4=3) (5=4)` etc. */
const CH8_FLAT = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4 };
const CH8_COLLAPSED = { 1: 0, 2: 1, 3: 1, 4: 2, 5: 2 };

/** Which SPSS variable takes which recode, read off the Chapter 8 listing. */
const CH8_RECODE = {
  D1_1: CH8_FLAT, D1_2: CH8_FLAT, D1_3: CH8_FLAT, D1_4: CH8_FLAT,
  D1_5: CH8_COLLAPSED, D1_6: CH8_COLLAPSED,
  D2_1: CH8_FLAT, D2_2: CH8_COLLAPSED, D2_3: CH8_COLLAPSED, D2_4: CH8_FLAT, D2_5: CH8_FLAT,
  D3_1: CH8_COLLAPSED, D3_2: CH8_FLAT, D3_3: CH8_COLLAPSED, D3_4: CH8_COLLAPSED,
  D4_1: CH8_COLLAPSED, D4_2: CH8_COLLAPSED, D4_3: CH8_COLLAPSED, D4_4: CH8_FLAT, D4_5: CH8_COLLAPSED,
  D5_2: CH8_COLLAPSED, D5_3: CH8_COLLAPSED, D5_4: CH8_FLAT, D5_5: CH8_COLLAPSED,
  D5_8: CH8_COLLAPSED, D5_9: CH8_FLAT, D5_10: CH8_FLAT, D5_11: CH8_FLAT,
  D6_1: CH8_COLLAPSED, D6_2: CH8_FLAT, D6_3: CH8_COLLAPSED, D6_4: CH8_FLAT,
  D6_5: CH8_FLAT, D6_6: CH8_COLLAPSED, D6_7: CH8_FLAT, D6_8: CH8_COLLAPSED,
};

/**
 * SPSS variable → printed item id. Domain 5 is the offset documented as Q2 in
 * docs/whodas/04_OPEN_QUESTIONS.md; every other domain is one-to-one.
 */
const CH8_TO_PRINTED = {
  D5_2: 'D5.1', D5_3: 'D5.2', D5_4: 'D5.3', D5_5: 'D5.4',
  D5_8: 'D5.5', D5_9: 'D5.6', D5_10: 'D5.7', D5_11: 'D5.8',
};
for (const [d, n] of [[1, 6], [2, 5], [3, 4], [4, 5], [6, 8]]) {
  for (let i = 1; i <= n; i += 1) CH8_TO_PRINTED[`D${d}_${i}`] = `D${d}.${i}`;
}

const WHO15 = { none: 1, mild: 2, moderate: 3, severe: 4, extreme: 5 };

/** Chapter 8's own formulas, computed from 1-5 responses keyed by printed id. */
function chapter8(responses, workApplies) {
  const d = {};
  for (const [spss, map] of Object.entries(CH8_RECODE)) {
    const printed = CH8_TO_PRINTED[spss];
    const raw = responses[printed];
    if (raw === undefined) continue;
    d[spss] = map[WHO15[raw]];
  }

  const Do1 = (d.D1_1 + d.D1_2 + d.D1_3 + d.D1_4 + d.D1_5 + d.D1_6) * 100 / 20;
  const Do2 = (d.D2_1 + d.D2_2 + d.D2_3 + d.D2_4 + d.D2_5) * 100 / 16;
  const Do3 = (d.D3_1 + d.D3_2 + d.D3_3 + d.D3_4) * 100 / 10;
  const Do4 = (d.D4_1 + d.D4_2 + d.D4_3 + d.D4_4 + d.D4_5) * 100 / 12;
  const Do51 = (d.D5_2 + d.D5_3 + d.D5_4 + d.D5_5) * 100 / 10;
  const Do52 = workApplies ? (d.D5_8 + d.D5_9 + d.D5_10 + d.D5_11) * 100 / 14 : null;
  const Do6 = (d.D6_1 + d.D6_2 + d.D6_3 + d.D6_4 + d.D6_5 + d.D6_6 + d.D6_7 + d.D6_8) * 100 / 24;

  const base =
    d.D1_1 + d.D1_2 + d.D1_3 + d.D1_4 + d.D1_5 + d.D1_6 +
    d.D2_1 + d.D2_2 + d.D2_3 + d.D2_4 + d.D2_5 +
    d.D3_1 + d.D3_2 + d.D3_3 + d.D3_4 +
    d.D4_1 + d.D4_2 + d.D4_3 + d.D4_4 + d.D4_5 +
    d.D5_2 + d.D5_3 + d.D5_4 + d.D5_5 +
    d.D6_1 + d.D6_2 + d.D6_3 + d.D6_4 + d.D6_5 + d.D6_6 + d.D6_7 + d.D6_8;

  const st_s32 = base * 100 / 92;
  const st_s36 = (base + d.D5_8 + d.D5_9 + d.D5_10 + d.D5_11) * 100 / 106;

  return { Do1, Do2, Do3, Do4, Do51, Do52, Do6, overall: workApplies ? st_s36 : st_s32 };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const VALUES = ['none', 'mild', 'moderate', 'severe', 'extreme'];
const allItems = (v) => Object.fromEntries(I.ITEM_IDS.map((id) => [id, v]));

/** Deterministic PRNG — tests must never depend on Math.random. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function randomPattern(seed) {
  const rnd = lcg(seed);
  return Object.fromEntries(I.ITEM_IDS.map((id) => [id, VALUES[Math.floor(rnd() * 5)]]));
}

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Registry integrity ───────────────────────────────────────────────────────

describe('WHODAS instrument registry', () => {
  test('holds exactly 36 scored items across six domains', () => {
    expect(I.ITEMS).toHaveLength(36);
    expect(I.DOMAINS).toHaveLength(6);
    const counts = I.DOMAINS.map((d) => I.itemsInDomain(d.domain).length);
    expect(counts).toEqual([6, 5, 4, 5, 8, 8]);
  });

  test('reproduces every Chapter 8 denominator from the recode table', () => {
    expect(I.assertDomainMaxima()).toEqual(I.IRT_DENOMINATORS);
  });

  test('Chapter 8 denominators are the values printed in the manual', () => {
    expect(I.IRT_DENOMINATORS).toEqual({
      Do1: 20, Do2: 16, Do3: 10, Do4: 12, Do51: 10, Do52: 14, Do6: 24,
      st_s32: 92, st_s36: 106,
    });
  });

  test('the 0-4 recode tables agree with the printed 1-5 tables', () => {
    for (const cls of ['flat', 'collapsed']) {
      for (let who15 = 1; who15 <= 5; who15 += 1) {
        expect(I.RECODE[cls][who15 - 1]).toBe(I.RECODE_FROM_WHO15[cls][who15]);
      }
    }
  });

  test('flat items max at 4 and collapsed at 2', () => {
    const flat = I.ITEMS.filter((i) => i.irt === 'flat');
    const collapsed = I.ITEMS.filter((i) => i.irt === 'collapsed');
    expect(flat).toHaveLength(17);
    expect(collapsed).toHaveLength(19);
    flat.forEach((i) => expect(I.irtMaxFor(i)).toBe(4));
    collapsed.forEach((i) => expect(I.irtMaxFor(i)).toBe(2));
  });

  test('the recode class of every item matches the Chapter 8 listing', () => {
    for (const [spss, map] of Object.entries(CH8_RECODE)) {
      const printed = CH8_TO_PRINTED[spss];
      const item = I.ITEM_BY_ID.get(printed);
      expect(item).toBeDefined();
      const expected = map === CH8_FLAT ? 'flat' : 'collapsed';
      expect(`${printed}:${item.irt}`).toBe(`${printed}:${expected}`);
    }
  });

  test('the work/school block is exactly D5.5-D5.8 and 32 items are always applicable', () => {
    expect(I.WORK_SCHOOL_ITEMS).toEqual(['D5.5', 'D5.6', 'D5.7', 'D5.8']);
    expect(I.ALWAYS_APPLICABLE_ITEMS).toHaveLength(32);
  });

  test('response values carry both codings and never overlap', () => {
    expect(I.RESPONSE_VALUES).toEqual(VALUES);
    expect(I.RESPONSE_VALUES.map(I.toWho04)).toEqual([0, 1, 2, 3, 4]);
    expect(I.RESPONSE_VALUES.map(I.toWho15)).toEqual([1, 2, 3, 4, 5]);
  });
});

// ── Workbook structure ───────────────────────────────────────────────────────

describe('WHO scoring workbooks', () => {
  test('both workbooks map all 36 registry item ids to score cells', () => {
    for (const key of ['simple', 'domainMean']) {
      const cells = workbookItemCells(key);
      expect(Object.keys(cells).sort()).toEqual([...I.ITEM_IDS].sort());
    }
  });

  test('the formulas being evaluated are the ones WHO shipped', () => {
    expect(workbookFormulas('simple')).toEqual({ C50: 'SUM(C9:C49)/144' });
    expect(workbookFormulas('domainMean')).toEqual({
      C15: '(SUM(C9:C14)/24)',
      C22: '(SUM(C17:C21)/20)',
      C28: '(SUM(C24:C27)/16)',
      C35: '(SUM(C30:C34)/20)',
      C45: '(SUM(C37:C44)/32)',
      C55: '(SUM(C47:C54)/32)',
      C56: 'SUM(C15+C22+C28+C35+C45+C55)/6',
    });
  });

  test('the workbook denominators match item count x 4', () => {
    expect(I.WORKBOOK_DENOMINATORS.simpleOverall).toBe(144);
    expect(I.WORKBOOK_DENOMINATORS.domain).toEqual({ 1: 24, 2: 20, 3: 16, 4: 20, 5: 32, 6: 32 });
  });
});

// ── Golden: simple_sum vs the WHO simple-scoring workbook ────────────────────

describe('simple_sum matches the WHO simple-scoring workbook', () => {
  const cases = [
    ['all none', allItems('none')],
    ['all mild', allItems('mild')],
    ['all moderate', allItems('moderate')],
    ['all severe', allItems('severe')],
    ['all extreme', allItems('extreme')],
    ...Array.from({ length: 40 }, (_, k) => [`pseudo-random #${k + 1}`, randomPattern(k + 1)]),
  ];

  test.each(cases)('%s', (_name, responses) => {
    const expected = runSimpleWorkbook(responses);
    const actual = score({ responses, workSchoolApplicable: true, method: 'simple_sum' });

    expect(actual.scorable).toBe(true);
    expect(actual.overall.exact).toBeCloseTo(expected.overallPercent, 10);
    expect(actual.overall.value).toBe(round2(expected.overallPercent));
    expect(actual.overall.denominator).toBe(144);
  });

  test('boundaries land exactly on 0 and 100', () => {
    expect(score({ responses: allItems('none'), workSchoolApplicable: true, method: 'simple_sum' }).overall.value).toBe(0);
    expect(score({ responses: allItems('extreme'), workSchoolApplicable: true, method: 'simple_sum' }).overall.value).toBe(100);
  });

  test('reports no domain scores, because the workbook defines none', () => {
    const r = score({ responses: allItems('mild'), workSchoolApplicable: true, method: 'simple_sum' });
    expect(r.domains).toBeNull();
    expect(r.domainsNote).toMatch(/no domain scores/i);
  });
});

// ── Golden: domain_mean vs the WHO 36-item workbook ──────────────────────────

describe('domain_mean matches the WHO 36-item scoring workbook', () => {
  const cases = [
    ['all none', allItems('none')],
    ['all extreme', allItems('extreme')],
    ['all moderate', allItems('moderate')],
    ...Array.from({ length: 40 }, (_, k) => [`pseudo-random #${k + 1}`, randomPattern(1000 + k)]),
  ];

  test.each(cases)('%s — overall and all six domains', (_name, responses) => {
    const expected = runDomainMeanWorkbook(responses);
    const actual = score({ responses, workSchoolApplicable: true, method: 'domain_mean' });

    expect(actual.scorable).toBe(true);
    expect(actual.overall.exact).toBeCloseTo(expected.overallPercent, 10);
    expect(actual.overall.value).toBe(round2(expected.overallPercent));

    for (const d of actual.domains) {
      expect(`D${d.domain}`).toBe(`D${d.domain}`);
      expect(d.exact).toBeCloseTo(expected.domainPercents[d.domain], 10);
      expect(d.value).toBe(round2(expected.domainPercents[d.domain]));
    }
  });

  test('domain-specific patterns isolate to the right domain', () => {
    for (const domain of [1, 2, 3, 4, 5, 6]) {
      const responses = allItems('none');
      I.itemsInDomain(domain).forEach((i) => { responses[i.id] = 'extreme'; });

      const expected = runDomainMeanWorkbook(responses);
      const actual = score({ responses, workSchoolApplicable: true, method: 'domain_mean' });

      expect(actual.overall.exact).toBeCloseTo(expected.overallPercent, 10);
      const hit = actual.domains.find((d) => d.domain === domain);
      expect(hit.value).toBe(100);
      actual.domains.filter((d) => d.domain !== domain).forEach((d) => expect(d.value).toBe(0));
    }
  });
});

// ── Golden: irt vs a literal transcription of Chapter 8 ──────────────────────

describe('irt matches manual Chapter 8', () => {
  const cases = [
    ['all none', allItems('none')],
    ['all mild', allItems('mild')],
    ['all moderate', allItems('moderate')],
    ['all severe', allItems('severe')],
    ['all extreme', allItems('extreme')],
    ...Array.from({ length: 60 }, (_, k) => [`pseudo-random #${k + 1}`, randomPattern(50_000 + k)]),
  ];

  test.each(cases)('%s — 36-item pathway', (_name, responses) => {
    const expected = chapter8(responses, true);
    const actual = score({ responses, workSchoolApplicable: true, method: 'irt' });

    expect(actual.scorable).toBe(true);
    expect(actual.summaryVariable).toBe('st_s36');
    expect(actual.overall.exact).toBeCloseTo(expected.overall, 10);
    expect(actual.overall.value).toBe(round2(expected.overall));
    expect(actual.overall.denominator).toBe(106);

    const byDomain = Object.fromEntries(actual.domains.map((d) => [d.domain, d]));
    expect(byDomain[1].exact).toBeCloseTo(expected.Do1, 10);
    expect(byDomain[2].exact).toBeCloseTo(expected.Do2, 10);
    expect(byDomain[3].exact).toBeCloseTo(expected.Do3, 10);
    expect(byDomain[4].exact).toBeCloseTo(expected.Do4, 10);
    expect(byDomain[6].exact).toBeCloseTo(expected.Do6, 10);

    const [household, work] = byDomain[5].subScores;
    expect(household.exact).toBeCloseTo(expected.Do51, 10);
    expect(work.exact).toBeCloseTo(expected.Do52, 10);
  });

  test.each(cases)('%s — 32-item pathway', (_name, responses) => {
    const expected = chapter8(responses, false);
    const actual = score({ responses, workSchoolApplicable: false, method: 'irt' });

    expect(actual.scorable).toBe(true);
    expect(actual.summaryVariable).toBe('st_s32');
    expect(actual.overall.exact).toBeCloseTo(expected.overall, 10);
    expect(actual.overall.value).toBe(round2(expected.overall));
    expect(actual.overall.denominator).toBe(92);

    const d5 = actual.domains.find((d) => d.domain === 5);
    const [household, work] = d5.subScores;
    expect(household.exact).toBeCloseTo(expected.Do51, 10);
    expect(work.value).toBeNull();
    expect(work.applicable).toBe(false);
    expect(work.notApplicableReason).toMatch(/does not work or attend school/i);
  });

  test('boundaries land exactly on 0 and 100 on both pathways', () => {
    for (const workSchoolApplicable of [true, false]) {
      expect(score({ responses: allItems('none'), workSchoolApplicable, method: 'irt' }).overall.value).toBe(0);
      expect(score({ responses: allItems('extreme'), workSchoolApplicable, method: 'irt' }).overall.value).toBe(100);
    }
  });

  test('category collapsing is real: moderate and mild coincide on collapsed items', () => {
    // D1.5 is collapsed (2=1, 3=1), D1.1 is flat (2=1, 3=2).
    const base = allItems('none');
    const mild = { ...base, 'D1.5': 'mild' };
    const moderate = { ...base, 'D1.5': 'moderate' };
    const flatMild = { ...base, 'D1.1': 'mild' };
    const flatModerate = { ...base, 'D1.1': 'moderate' };

    const run = (r) => score({ responses: r, workSchoolApplicable: true, method: 'irt' }).overall.value;

    expect(run(mild)).toBe(run(moderate));
    expect(run(flatMild)).not.toBe(run(flatModerate));
  });

  test('the work block genuinely contributes 14 of the 106 points', () => {
    const responses = allItems('none');
    I.WORK_SCHOOL_ITEMS.forEach((id) => { responses[id] = 'extreme'; });

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.overall.recodedSum).toBe(14);
    expect(r.overall.exact).toBeCloseTo((14 * 100) / 106, 10);

    const skipped = score({ responses: allItems('none'), workSchoolApplicable: false, method: 'irt' });
    expect(skipped.overall.value).toBe(0);
  });

  test('a skipped work block is not silently scored as "none"', () => {
    // The clinical hazard the 32-item pathway exists to avoid.
    const responses = allItems('severe');
    const skipped = score({ responses, workSchoolApplicable: false, method: 'irt' });
    const asIfNone = { ...responses };
    I.WORK_SCHOOL_ITEMS.forEach((id) => { asIfNone[id] = 'none'; });
    const wrong = score({ responses: asIfNone, workSchoolApplicable: true, method: 'irt' });

    expect(skipped.overall.value).toBeGreaterThan(wrong.overall.value);
  });
});

// ── Missing data (manual §6.5) ───────────────────────────────────────────────

describe('missing-data handling', () => {
  test('one missing item is imputed from its own domain mean', () => {
    const responses = allItems('none');
    I.itemsInDomain(1).forEach((i) => { responses[i.id] = 'extreme'; });
    delete responses['D1.1'];

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.scorable).toBe(true);
    expect(r.missingData.missingCount).toBe(1);
    expect(r.missingData.imputationApplied).toBe(true);
    expect(r.missingData.imputedItems[0].itemId).toBe('D1.1');

    // IRT imputes in RECODED space, because the collapsed recode is a lookup on
    // integers and a mean is generally fractional. The five answered peers are
    // all 'extreme': D1.2-D1.4 are flat (→4) and D1.5-D1.6 collapsed (→2), so
    // the domain mean is (4+4+4+2+2)/5 = 3.2, not 4.
    expect(r.missingData.imputedItems[0].value).toBe(3.2);
    expect(r.missingData.imputedItems[0].from).toBe(5);
    // Domain 1 = (16 + 3.2) x 100 / 20.
    expect(r.domains.find((d) => d.domain === 1).value).toBe(96);
  });

  test('imputing from uniform peers on a single-recode-class group reproduces that value', () => {
    // Domain 5's work block is flat except D5.5, so use the household block's
    // three collapsed items to check the mean is not distorted by mixed classes.
    const responses = allItems('none');
    ['D5.1', 'D5.2', 'D5.4'].forEach((id) => { responses[id] = 'extreme'; });
    delete responses['D5.1'];

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    // Peers in domain 5: D5.2 collapsed extreme (2), D5.4 collapsed extreme (2),
    // D5.3 none (0), and the four work items at none (0) → mean 4/7.
    expect(r.missingData.imputedItems[0].value).toBe(round2(4 / 7));
  });

  test('two missing items in different domains still score, with domains reportable', () => {
    const responses = allItems('moderate');
    delete responses['D1.1'];
    delete responses['D2.1'];

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.scorable).toBe(true);
    expect(r.missingData.missingCount).toBe(2);
    expect(r.missingData.domainsWithMultipleMissingItems).toEqual([]);
    r.domains.forEach((d) => expect(d.reportable).toBe(true));
  });

  test('two missing items in the SAME domain make that domain unreportable', () => {
    const responses = allItems('moderate');
    delete responses['D1.1'];
    delete responses['D1.2'];

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.scorable).toBe(true);
    expect(r.missingData.domainsWithMultipleMissingItems).toEqual([1]);

    const d1 = r.domains.find((d) => d.domain === 1);
    expect(d1.reportable).toBe(false);
    expect(d1.value).toBeNull();
    // The overall is a sum over items, not a mean of domains, so it survives.
    expect(r.overall.value).not.toBeNull();
  });

  test('domain_mean refuses when a domain is unreportable, since its overall is the domain mean', () => {
    const responses = allItems('moderate');
    delete responses['D1.1'];
    delete responses['D1.2'];

    const r = score({ responses, workSchoolApplicable: true, method: 'domain_mean' });
    expect(r.scorable).toBe(false);
    expect(r.refusal.reason).toBe('domain_not_reportable');
  });

  test('three missing items are refused on every method', () => {
    const responses = allItems('moderate');
    ['D1.1', 'D2.1', 'D3.1'].forEach((id) => delete responses[id]);

    for (const method of ALL_METHODS) {
      const r = score({ responses, workSchoolApplicable: true, method });
      expect(r.scorable).toBe(false);
      expect(r.refusal.reason).toBe('too_many_missing');
      expect(r.refusal.itemIds).toEqual(['D1.1', 'D2.1', 'D3.1']);
      expect(r.overall).toBeNull();
    }
  });

  test(`the imputation ceiling is ${MAX_IMPUTABLE_MISSING}, as the manual states`, () => {
    expect(MAX_IMPUTABLE_MISSING).toBe(2);
  });

  test('imputation for workbook methods happens in raw 0-4 space', () => {
    const responses = allItems('none');
    I.itemsInDomain(3).forEach((i) => { responses[i.id] = 'extreme'; });
    delete responses['D3.1'];

    const r = score({ responses, workSchoolApplicable: true, method: 'domain_mean' });
    expect(r.missingData.imputedItems[0].value).toBe(4);
    expect(r.domains.find((d) => d.domain === 3).value).toBe(100);
  });

  test('an unanswered work item still counts as missing when work applies', () => {
    const responses = allItems('none');
    delete responses['D5.5'];

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.missingData.missingItemIds).toEqual(['D5.5']);
    expect(r.missingData.imputationApplied).toBe(true);
  });

  test('skipped work items are reported as not-applicable, never as missing', () => {
    const responses = allItems('none');
    I.WORK_SCHOOL_ITEMS.forEach((id) => delete responses[id]);

    const r = score({ responses, workSchoolApplicable: false, method: 'irt' });
    expect(r.missingData.missingCount).toBe(0);
    expect(r.missingData.notApplicableItemIds).toEqual(['D5.5', 'D5.6', 'D5.7', 'D5.8']);
    expect(r.missingData.unexpectedResponsesForSkippedItems).toEqual([]);
  });

  test('a response left behind on a skipped item is surfaced, not silently used', () => {
    // Happens when a clinician answers the work block and then marks the
    // respondent as not working. The stale answer must not affect the score.
    const responses = allItems('none');
    I.WORK_SCHOOL_ITEMS.forEach((id) => delete responses[id]);
    responses['D5.5'] = 'extreme';

    const r = score({ responses, workSchoolApplicable: false, method: 'irt' });
    expect(r.missingData.unexpectedResponsesForSkippedItems).toEqual(['D5.5']);
    expect(r.overall.value).toBe(0);
  });
});

// ── Refusals and guards ──────────────────────────────────────────────────────

describe('refusals and guards', () => {
  test('workbook methods refuse the 32-item pathway rather than invent a denominator', () => {
    for (const method of ['simple_sum', 'domain_mean']) {
      const r = score({ responses: allItems('mild'), workSchoolApplicable: false, method });
      expect(r.scorable).toBe(false);
      expect(r.refusal.reason).toBe('no_32_item_pathway');
      expect(r.refusal.message).toMatch(/IRT/);
    }
  });

  test('an unrecognised response value is refused, not coerced', () => {
    const responses = allItems('mild');
    responses['D1.1'] = 'very severe';

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.scorable).toBe(false);
    expect(r.refusal.reason).toBe('invalid_responses');
    expect(r.refusal.itemIds).toEqual(['D1.1']);
  });

  test('workSchoolApplicable must be an explicit boolean', () => {
    expect(() => score({ responses: allItems('mild'), method: 'irt' })).toThrow(/must be an explicit boolean/);
    expect(() => score({ responses: allItems('mild'), workSchoolApplicable: 'yes', method: 'irt' }))
      .toThrow(/must be an explicit boolean/);
  });

  test('an unknown method throws rather than falling back', () => {
    expect(() => score({ responses: allItems('mild'), workSchoolApplicable: true, method: 'irt2' }))
      .toThrow(/Unknown WHODAS scoring method/);
  });

  test('numeric response codes are rejected — only semantic values are accepted', () => {
    const responses = allItems('mild');
    responses['D1.1'] = 2;

    const r = score({ responses, workSchoolApplicable: true, method: 'irt' });
    expect(r.scorable).toBe(false);
    expect(r.refusal.reason).toBe('invalid_responses');
  });
});

// ── Presentation contract ────────────────────────────────────────────────────

describe('result presentation', () => {
  test('every result names its method, source, version and scale', () => {
    const all = scoreAll({ responses: allItems('mild'), workSchoolApplicable: true });
    expect(all.defaultMethod).toBe('irt');
    expect(all.scoringVersion).toBe(SCORING_VERSION);

    for (const method of ALL_METHODS) {
      const r = all.methods[method];
      expect(r.method).toBe(method);
      expect(r.label).toBeTruthy();
      expect(r.sourceMethodology).toBeTruthy();
      expect(r.scoringVersion).toBe(SCORING_VERSION);
      expect(r.scale).toBeTruthy();
    }
  });

  test('the default method is the IRT complex score and is labelled as such', () => {
    const r = score({ responses: allItems('mild'), workSchoolApplicable: true });
    expect(r.method).toBe('irt');
    expect(r.label).toBe('WHODAS 2.0 Complex Score (IRT)');
    expect(r.sourceMethodology).toMatch(/Chapter 8/);
  });

  test('the workbook methods declare that they apply no weighting or collapsing', () => {
    const all = scoreAll({ responses: allItems('mild'), workSchoolApplicable: true });
    expect(all.methods.irt.itemWeighting).toBe(true);
    expect(all.methods.irt.categoryCollapsing).toBe(true);
    for (const method of ['simple_sum', 'domain_mean']) {
      expect(all.methods[method].itemWeighting).toBe(false);
      expect(all.methods[method].categoryCollapsing).toBe(false);
    }
  });

  test('scoreAll keeps methods separate and never blends them', () => {
    const responses = randomPattern(7);
    const all = scoreAll({ responses, workSchoolApplicable: true });

    const values = ALL_METHODS.map((m) => all.methods[m].overall.value);
    expect(new Set(values).size).toBeGreaterThan(1);

    for (const m of ALL_METHODS) {
      expect(all.methods[m].overall.exact)
        .toBeCloseTo(score({ responses, workSchoolApplicable: true, method: m }).overall.exact, 10);
    }
  });

  test('no result carries a severity label — no supplied source defines cut-points', () => {
    const banned = /\b(mild|moderate|severe|extreme)\s+disability\b|severityLabel|severityBand|classification/i;
    for (const v of VALUES) {
      const all = scoreAll({ responses: allItems(v), workSchoolApplicable: true });
      expect(JSON.stringify(all)).not.toMatch(banned);
    }
  });

  test('domain titles are the headings printed on the instrument', () => {
    const r = score({ responses: allItems('mild'), workSchoolApplicable: true, method: 'irt' });
    expect(r.domains.map((d) => d.title)).toEqual([
      'Understanding and communicating',
      'Getting around',
      'Self-care',
      'Getting along with people',
      'Life activities',
      'Participation in society',
    ]);
  });

  test('Life activities is reported as the two sub-scores Chapter 8 defines, with no invented combined value', () => {
    const r = score({ responses: allItems('mild'), workSchoolApplicable: true, method: 'irt' });
    const d5 = r.domains.find((d) => d.domain === 5);
    expect(d5.splitDomain).toBe(true);
    expect(d5.value).toBeNull();
    expect(d5.subScores.map((s) => s.spssName)).toEqual(['Do51', 'Do52']);
  });

  test('scoring is deterministic and free of side effects', () => {
    const responses = randomPattern(99);
    const frozen = JSON.stringify(responses);
    const a = JSON.stringify(scoreAll({ responses, workSchoolApplicable: true }));
    const b = JSON.stringify(scoreAll({ responses, workSchoolApplicable: true }));
    expect(a).toBe(b);
    expect(JSON.stringify(responses)).toBe(frozen);
  });
});
