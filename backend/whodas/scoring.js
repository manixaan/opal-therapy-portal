'use strict';

/**
 * WHODAS 2.0 — SCORING ENGINE
 *
 * Deterministic, isolated and side-effect free: semantic responses in, scores
 * out. No database, no clock, no IO, no randomness. The caller stamps
 * `calculatedAt`, so the same input always produces the same output and the
 * whole module is trivially testable.
 *
 * ── Three methods, never blended ───────────────────────────────────────────
 * The supplied WHO material defines three mutually incompatible schemes (see
 * docs/whodas/02_WHO_SOURCE_AUDIT.md §5). All three are implemented; each names
 * its own source; none is presented as "the" WHODAS score.
 *
 *   simple_sum   WHO simple-scoring workbook.  SUM(36 items, 0-4) / 144
 *   domain_mean  WHO 36-item scoring workbook. Six raw domain proportions,
 *                then their unweighted mean. Despite the workbook's filename
 *                this is NOT WHO's complex method: it applies no item weighting
 *                and no category collapsing.
 *   irt          Manual Chapter 8 SPSS syntax. The real complex/IRT method:
 *                per-item recode, domain sums x 100 / domain max, overall
 *                x 100 / 106 (or / 92 on the 32-item pathway). DEFAULT.
 *
 * ── What this module refuses to do ─────────────────────────────────────────
 * - It never invents mathematics. Where a source defines no rule for a
 *   situation, the result is `scorable: false` with a reason, not a guess.
 * - It never emits a severity label. No supplied source defines score-to-
 *   severity cut-points; see docs/whodas/02_WHO_SOURCE_AUDIT.md §7.
 * - It never scores H1-H3, D5.9, D5.10, D5.01 or D5.02. No supplied source
 *   scores them.
 */

const {
  ITEMS,
  ITEM_IDS,
  ITEM_BY_ID,
  DOMAINS,
  RECODE,
  LIFE_HOUSEHOLD,
  LIFE_WORK_SCHOOL,
  WORK_SCHOOL_ITEMS,
  ALWAYS_APPLICABLE_ITEMS,
  IRT_DENOMINATORS,
  WORKBOOK_DENOMINATORS,
  isResponseValue,
  toWho04,
  itemsInDomain,
} = require('./instrument');

/**
 * Bumped whenever the arithmetic of any method changes. Persisted with every
 * calculated score so an old result stays explicable after an engine change.
 */
const SCORING_VERSION = '1.0.0';

const METHODS = {
  irt: {
    method: 'irt',
    label: 'WHODAS 2.0 Complex Score (IRT)',
    sourceMethodology:
      'WHO Disability Assessment Schedule 2.0 manual (WHO, 2010), Chapter 8 — ' +
      'syntax for automatic computation of overall score (SPSS)',
    scale: '0-100',
    itemWeighting: true,
    categoryCollapsing: true,
  },
  simple_sum: {
    method: 'simple_sum',
    label: 'WHO Simple Sum Score',
    sourceMethodology: 'WHO 36-item scoring template — simple scoring workbook',
    scale: '0-100 (percentage of maximum)',
    itemWeighting: false,
    categoryCollapsing: false,
  },
  domain_mean: {
    method: 'domain_mean',
    label: 'WHO Domain Mean Score',
    sourceMethodology: 'WHO 36-item scoring template — 36-item scoring workbook (domain-mean method)',
    scale: '0-100 (mean of six domain percentages)',
    itemWeighting: false,
    categoryCollapsing: false,
  },
};

const DEFAULT_METHOD = 'irt';
const ALL_METHODS = ['irt', 'simple_sum', 'domain_mean'];

/**
 * Workbook cells are formatted `0.00%`, so `value` is rounded to 2dp for
 * display and comparison against the spreadsheets. Every score also carries an
 * unrounded `exact`: rounding is a presentation choice, and a longitudinal
 * comparison two years from now should not be limited by it.
 */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Response set normalisation ───────────────────────────────────────────────

/**
 * Works out which items apply, which are answered, and which are missing —
 * before any arithmetic happens. Every method starts from this.
 *
 * The distinction that matters clinically: a work/school item the respondent
 * was INSTRUCTED to skip is `notApplicable`, not `missing`. Treating it as
 * missing (or as "None") would silently understate their disability.
 */
function analyseResponses(responses, workSchoolApplicable) {
  const given = responses && typeof responses === 'object' ? responses : {};

  const applicable = workSchoolApplicable ? ITEM_IDS : ALWAYS_APPLICABLE_ITEMS;
  const notApplicable = workSchoolApplicable ? [] : [...WORK_SCHOOL_ITEMS];

  const answered = {};
  const missing = [];
  const invalid = [];

  for (const id of applicable) {
    const raw = given[id];
    if (raw === undefined || raw === null || raw === '') {
      missing.push(id);
    } else if (!isResponseValue(raw)) {
      invalid.push(id);
    } else {
      answered[id] = toWho04(raw);
    }
  }

  // A response supplied for an item the respondent was told to skip is a data
  // error, not a score. Surfaced rather than silently dropped.
  const unexpected = notApplicable.filter(
    (id) => given[id] !== undefined && given[id] !== null && given[id] !== ''
  );

  return {
    applicable,
    notApplicable,
    answered,
    missing,
    invalid,
    unexpected,
    itemSet: workSchoolApplicable ? '36-item' : '32-item',
  };
}

// ── WHO missing-data handling (manual §6.5) ──────────────────────────────────

/**
 * The manual permits exactly one simple imputation for the full version:
 *
 *   "In all other situations where one or two items are missing, the mean score
 *    across all items within the domain should be assigned to the missing
 *    items. This method should not be used if more than two items are missing.
 *    In addition, if domain-wise scores are being computed for domains, the two
 *    missing items should not come from the same domain."
 *
 * So: 0 missing → nothing to do. 1-2 missing → impute from the item's own
 * domain. 3+ → refuse; the manual offers only hot-deck and multiple imputation
 * beyond that, both explicitly framed for researchers with large datasets, not
 * for a single clinical record.
 *
 * `valueOf` lets the caller decide which space the mean is taken in: raw 0-4
 * for the workbook methods (which sum raw values) and recoded space for IRT
 * (which sums recoded values). Taking an IRT mean in raw space then recoding it
 * would be undefined — the collapsed recode is a lookup on integers 0-4, and a
 * mean is generally fractional.
 */
const MAX_IMPUTABLE_MISSING = 2;

function imputeMissing(analysis, valueOf) {
  const { answered, missing } = analysis;
  const values = { ...answered };
  const imputed = [];

  for (const id of missing) {
    const item = ITEM_BY_ID.get(id);
    const peers = itemsInDomain(item.domain)
      .filter((p) => p.id !== id && answered[p.id] !== undefined)
      .map((p) => valueOf(p, answered[p.id]));

    if (!peers.length) {
      return { ok: false, reason: 'domain_has_no_answered_items', domain: item.domain };
    }
    const mean = peers.reduce((s, v) => s + v, 0) / peers.length;
    values[id] = mean;
    imputed.push({ itemId: id, domain: item.domain, value: round2(mean), from: peers.length });
  }

  // Domain scores stop being defensible when both missing items share a domain.
  const perDomain = new Map();
  for (const id of missing) {
    const d = ITEM_BY_ID.get(id).domain;
    perDomain.set(d, (perDomain.get(d) || 0) + 1);
  }
  const domainsWithMultipleMissing = [...perDomain.entries()]
    .filter(([, n]) => n > 1)
    .map(([d]) => d);

  return { ok: true, values, imputed, domainsWithMultipleMissing };
}

/** Shared pre-flight for all three methods. */
function prepare(analysis, valueOf) {
  if (analysis.invalid.length) {
    return {
      ok: false,
      refusal: {
        reason: 'invalid_responses',
        message: `Unrecognised response value for ${analysis.invalid.join(', ')}.`,
        itemIds: analysis.invalid,
      },
    };
  }
  if (analysis.missing.length > MAX_IMPUTABLE_MISSING) {
    return {
      ok: false,
      refusal: {
        reason: 'too_many_missing',
        message:
          `${analysis.missing.length} applicable items are unanswered. WHODAS 2.0 ` +
          `permits imputation for at most ${MAX_IMPUTABLE_MISSING} missing items ` +
          '(manual §6.5); beyond that no simple scoring method is defined.',
        itemIds: analysis.missing,
      },
    };
  }

  const imputation = imputeMissing(analysis, valueOf);
  if (!imputation.ok) {
    return {
      ok: false,
      refusal: {
        reason: imputation.reason,
        message: `Domain ${imputation.domain} has no answered items to impute from.`,
        itemIds: analysis.missing,
      },
    };
  }
  return { ok: true, ...imputation };
}

function missingDataBlock(analysis, imputed, domainsWithMultipleMissing) {
  return {
    missingCount: analysis.missing.length,
    missingItemIds: [...analysis.missing],
    imputationApplied: imputed.length > 0,
    imputationRule: imputed.length
      ? 'Domain mean assigned to missing items (WHODAS 2.0 manual §6.5)'
      : null,
    imputedItems: imputed,
    domainsWithMultipleMissingItems: domainsWithMultipleMissing,
    notApplicableItemIds: [...analysis.notApplicable],
    unexpectedResponsesForSkippedItems: [...analysis.unexpected],
  };
}

// ── Method 1: IRT / complex (manual Chapter 8) ───────────────────────────────

const recodeValue = (item, who04) => RECODE[item.irt][who04];

function scoreIrt(analysis) {
  // Recoded space: the collapsed lookup is only defined on integers, so the
  // imputation mean is taken over already-recoded peer values.
  const prep = prepare(analysis, (item, who04) => recodeValue(item, who04));
  if (!prep.ok) return prep;

  const { values, imputed, domainsWithMultipleMissing } = prep;

  // Answered items get recoded now; imputed items are already in recoded space.
  const recoded = {};
  for (const id of analysis.applicable) {
    const item = ITEM_BY_ID.get(id);
    recoded[id] = analysis.answered[id] !== undefined
      ? recodeValue(item, analysis.answered[id])
      : values[id];
  }

  const sumOf = (ids) => ids.reduce((s, id) => s + recoded[id], 0);
  const groupScore = (ids, denominator) => (sumOf(ids) * 100) / denominator;

  const householdIds = ITEMS.filter((i) => i.block === LIFE_HOUSEHOLD).map((i) => i.id);
  const workIds = [...WORK_SCHOOL_ITEMS];
  const workApplies = analysis.itemSet === '36-item';

  const unreportable = new Set(domainsWithMultipleMissing);

  const domains = DOMAINS.map((d) => {
    const base = { domain: d.domain, key: d.key, title: d.title, conceptName: d.conceptName };

    if (d.domain === 5) {
      // Chapter 8 defines Do51 and Do52 separately and gives no combined Do5,
      // so none is invented here.
      const householdOk = !unreportable.has(5);
      const workOk = workApplies && householdOk;
      const subScores = [
        {
          key: 'life_activities_household',
          title: 'Life activities — household',
          spssName: 'Do51',
          value: householdOk ? round2(groupScore(householdIds, IRT_DENOMINATORS.Do51)) : null,
          exact: householdOk ? groupScore(householdIds, IRT_DENOMINATORS.Do51) : null,
          denominator: IRT_DENOMINATORS.Do51,
          applicable: true,
        },
        {
          key: 'life_activities_work_school',
          title: 'Life activities — work/school',
          spssName: 'Do52',
          value: workOk ? round2(groupScore(workIds, IRT_DENOMINATORS.Do52)) : null,
          exact: workOk ? groupScore(workIds, IRT_DENOMINATORS.Do52) : null,
          denominator: IRT_DENOMINATORS.Do52,
          applicable: workApplies,
          notApplicableReason: workApplies
            ? null
            : 'Respondent does not work or attend school; items D5.5–D5.8 skipped per the instrument.',
        },
      ];
      return { ...base, value: null, splitDomain: true, subScores, reportable: !unreportable.has(5) };
    }

    const ids = itemsInDomain(d.domain).map((i) => i.id);
    const denominator = IRT_DENOMINATORS[`Do${d.domain}`];
    const ok = !unreportable.has(d.domain);
    return {
      ...base,
      spssName: `Do${d.domain}`,
      denominator,
      value: ok ? round2(groupScore(ids, denominator)) : null,
      exact: ok ? groupScore(ids, denominator) : null,
      reportable: ok,
      splitDomain: false,
    };
  });

  const summaryIds = workApplies ? ITEM_IDS : ALWAYS_APPLICABLE_ITEMS;
  const denominator = workApplies ? IRT_DENOMINATORS.st_s36 : IRT_DENOMINATORS.st_s32;
  const overall = (sumOf(summaryIds) * 100) / denominator;

  return {
    ok: true,
    result: {
      ...METHODS.irt,
      scoringVersion: SCORING_VERSION,
      scorable: true,
      itemSet: analysis.itemSet,
      summaryVariable: workApplies ? 'st_s36' : 'st_s32',
      overall: {
        value: round2(overall),
        exact: overall,
        scale: '0-100',
        denominator,
        recodedSum: round2(sumOf(summaryIds)),
        interpretation: '0 = no disability, 100 = full disability',
      },
      domains,
      missingData: missingDataBlock(analysis, imputed, domainsWithMultipleMissing),
    },
  };
}

// ── Method 2: WHO simple sum (simple-scoring workbook) ───────────────────────

/**
 * `SUM(C9:C49) / 144` on raw 0-4 values, displayed `0.00%`.
 *
 * The workbook defines no domain scores and no 32-item pathway. Neither is
 * invented: a non-working respondent gets `scorable: false` here, which is
 * exactly why `irt` is the default clinical score.
 */
function scoreSimpleSum(analysis) {
  if (analysis.itemSet !== '36-item') {
    return {
      ok: false,
      refusal: {
        reason: 'no_32_item_pathway',
        message:
          'The WHO simple-scoring workbook divides by a fixed 144 (36 items × 4) and ' +
          'defines no 32-item pathway. Scoring a respondent who skipped D5.5–D5.8 ' +
          'would require inventing a denominator. Use the IRT score, which has an ' +
          'official 32-item pathway (st_s32).',
        itemIds: [...WORK_SCHOOL_ITEMS],
      },
    };
  }

  const prep = prepare(analysis, (_item, who04) => who04);
  if (!prep.ok) return prep;
  const { values, imputed, domainsWithMultipleMissing } = prep;

  const raw = ITEM_IDS.reduce((s, id) => s + values[id], 0);
  const denominator = WORKBOOK_DENOMINATORS.simpleOverall;

  return {
    ok: true,
    result: {
      ...METHODS.simple_sum,
      scoringVersion: SCORING_VERSION,
      scorable: true,
      itemSet: analysis.itemSet,
      overall: {
        value: round2((raw / denominator) * 100),
        exact: (raw / denominator) * 100,
        scale: '0-100',
        denominator,
        rawSum: round2(raw),
        interpretation: 'Percentage of the maximum obtainable raw score (144).',
      },
      // The simple-scoring workbook computes no domain scores, so none are shown.
      domains: null,
      domainsNote:
        'The WHO simple-scoring workbook defines a single overall score and no domain scores.',
      missingData: missingDataBlock(analysis, imputed, domainsWithMultipleMissing),
    },
  };
}

// ── Method 3: WHO domain mean (36-item scoring workbook) ─────────────────────

/**
 * Six raw domain proportions over 0-4 values — /24, /20, /16, /20, /32, /32 —
 * then their unweighted mean. Domain 5 is a single block of all eight items.
 *
 * Same refusal as simple_sum on the 32-item pathway: the workbook's D5
 * denominator is a fixed 32.
 */
function scoreDomainMean(analysis) {
  if (analysis.itemSet !== '36-item') {
    return {
      ok: false,
      refusal: {
        reason: 'no_32_item_pathway',
        message:
          'The WHO 36-item scoring workbook divides Life activities by a fixed 32 ' +
          '(8 items × 4) and defines no 32-item pathway. Scoring a respondent who ' +
          'skipped D5.5–D5.8 would require inventing a denominator. Use the IRT ' +
          'score, which has an official 32-item pathway (st_s32).',
        itemIds: [...WORK_SCHOOL_ITEMS],
      },
    };
  }

  const prep = prepare(analysis, (_item, who04) => who04);
  if (!prep.ok) return prep;
  const { values, imputed, domainsWithMultipleMissing } = prep;

  const unreportable = new Set(domainsWithMultipleMissing);

  const domains = DOMAINS.map((d) => {
    const ids = itemsInDomain(d.domain).map((i) => i.id);
    const denominator = WORKBOOK_DENOMINATORS.domain[d.domain];
    const sum = ids.reduce((s, id) => s + values[id], 0);
    const ok = !unreportable.has(d.domain);
    const exact = (sum / denominator) * 100;
    return {
      domain: d.domain,
      key: d.key,
      title: d.title,
      conceptName: d.conceptName,
      denominator,
      value: ok ? round2(exact) : null,
      exact: ok ? exact : null,
      reportable: ok,
      splitDomain: false,
    };
  });

  // The overall is the mean of the six domain values, so one unreportable
  // domain makes the overall unreportable too.
  if (domains.some((d) => !d.reportable)) {
    return {
      ok: false,
      refusal: {
        reason: 'domain_not_reportable',
        message:
          'Two missing items fall in the same domain. WHODAS 2.0 manual §6.5 states ' +
          'that domain-wise scores must not be computed in that case, and this ' +
          'method derives its overall score from the six domain scores.',
        itemIds: [...analysis.missing],
      },
    };
  }

  // Averaged from the UNROUNDED domain values, matching workbook cell C56
  // (`SUM(C15+C22+C28+C35+C45+C55)/6`), which reads the raw cell values rather
  // than their `0.00%` display text.
  const overall = domains.reduce((s, d) => s + d.exact, 0) / DOMAINS.length;

  return {
    ok: true,
    result: {
      ...METHODS.domain_mean,
      scoringVersion: SCORING_VERSION,
      scorable: true,
      itemSet: analysis.itemSet,
      overall: {
        value: round2(overall),
        exact: overall,
        scale: '0-100',
        denominator: null,
        interpretation: 'Unweighted mean of the six domain percentages.',
      },
      domains,
      missingData: missingDataBlock(analysis, imputed, domainsWithMultipleMissing),
    },
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

const IMPLEMENTATIONS = {
  irt: scoreIrt,
  simple_sum: scoreSimpleSum,
  domain_mean: scoreDomainMean,
};

/**
 * Score one method.
 *
 * @param {object}  input
 * @param {object}  input.responses              itemId → semantic value
 * @param {boolean} input.workSchoolApplicable   does the respondent work or study?
 * @param {string} [input.method='irt']
 * @returns a result object, or `{ scorable: false, refusal }`
 */
function score({ responses, workSchoolApplicable, method = DEFAULT_METHOD } = {}) {
  const impl = IMPLEMENTATIONS[method];
  if (!impl) {
    throw new Error(
      `Unknown WHODAS scoring method: ${JSON.stringify(method)}. ` +
      `Expected one of ${ALL_METHODS.join(', ')}.`
    );
  }
  if (typeof workSchoolApplicable !== 'boolean') {
    throw new Error(
      'workSchoolApplicable must be an explicit boolean: whether the respondent ' +
      'works (paid, non-paid, self-employed) or goes to school determines whether ' +
      'D5.5–D5.8 are scored or legitimately skipped. It must never be guessed.'
    );
  }

  const analysis = analyseResponses(responses, workSchoolApplicable);
  const out = impl(analysis);

  if (!out.ok) {
    return {
      ...METHODS[method],
      scoringVersion: SCORING_VERSION,
      scorable: false,
      itemSet: analysis.itemSet,
      overall: null,
      domains: null,
      refusal: out.refusal,
      missingData: {
        missingCount: analysis.missing.length,
        missingItemIds: [...analysis.missing],
        imputationApplied: false,
        imputedItems: [],
        notApplicableItemIds: [...analysis.notApplicable],
        unexpectedResponsesForSkippedItems: [...analysis.unexpected],
      },
    };
  }
  return out.result;
}

/**
 * Score every method at once. Each result stands alone and names its own
 * source; a method that cannot be computed reports why rather than being
 * silently omitted.
 */
function scoreAll({ responses, workSchoolApplicable } = {}) {
  const results = {};
  for (const method of ALL_METHODS) {
    results[method] = score({ responses, workSchoolApplicable, method });
  }
  return {
    scoringVersion: SCORING_VERSION,
    defaultMethod: DEFAULT_METHOD,
    methods: results,
  };
}

module.exports = {
  SCORING_VERSION,
  DEFAULT_METHOD,
  ALL_METHODS,
  METHODS,
  MAX_IMPUTABLE_MISSING,
  analyseResponses,
  score,
  scoreAll,
};
