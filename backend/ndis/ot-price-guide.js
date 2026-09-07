'use strict';

/**
 * NDIS PRICE GUIDE — Occupational Therapy and therapy-assistant items
 *
 * Machine-readable transcription of the two source documents:
 *   • NDIS Pricing Arrangements and Price Limits 2025-26 v1.1 (published
 *     14 Oct 2025, arrangements valid from 24 Nov 2025; prices from 1 Jul 2025)
 *   • NDIS Pricing Schedule 2026-27 v1.2 (published 22 Jul 2026, effective
 *     1 Jul 2026)
 *
 * Scope is deliberately narrow: the line items an OT practice can claim, plus
 * the therapy-assistant items an OT may delegate to. Prices for other
 * professions are in the source documents, not here.
 *
 * This module is DATA. It contains no business logic and does not decide what
 * the practice charges — `finance_pricing_rules` (owner-managed) still holds
 * the agreed rate. `ndis-billing-rules.js` uses these figures as the CEILING
 * and eligibility reference when validating a claim.
 *
 * Page references are to the 2025-26 PAPL unless marked "Sched".
 */

// ── Financial years ─────────────────────────────────────────────────────────
const FINANCIAL_YEARS = [
  {
    key: 'FY2025-26',
    from: '2025-07-01',
    to: '2026-06-30',
    source: 'NDIS Pricing Arrangements and Price Limits 2025-26 v1.1',
    rulesSource: 'NDIS Pricing Arrangements and Price Limits 2025-26 v1.1',
  },
  {
    key: 'FY2026-27',
    from: '2026-07-01',
    to: '2027-06-30',
    source: 'NDIS Pricing Schedule 2026-27 v1.2',
    // The 2026-27 document supplied is a price schedule only. The claiming
    // rules below are carried forward from the 2025-26 PAPL until the
    // 2026-27 Pricing Arrangements are supplied and cross-checked.
    rulesSource: 'NDIS Pricing Arrangements and Price Limits 2025-26 v1.1 (carried forward)',
  },
];

// ── Geography ───────────────────────────────────────────────────────────────
// Modified Monash Model bands and the loadings the price limits carry.
// p.30-31: no loading in MMM1-5; +40% in MMM6 (Remote); +50% in MMM7 (Very Remote).
const MMM_ZONES = {
  1: { zone: 'metropolitan', loading: 1.00, travelTimeCapMinutes: 30 },
  2: { zone: 'regional_centre', loading: 1.00, travelTimeCapMinutes: 30 },
  3: { zone: 'regional_centre', loading: 1.00, travelTimeCapMinutes: 30 },
  4: { zone: 'regional_area', loading: 1.00, travelTimeCapMinutes: 60 },
  5: { zone: 'regional_area', loading: 1.00, travelTimeCapMinutes: 60 },
  6: { zone: 'remote', loading: 1.40, travelTimeCapMinutes: null }, // no cap p.23
  7: { zone: 'very_remote', loading: 1.50, travelTimeCapMinutes: null },
};

// ── Claim types ─────────────────────────────────────────────────────────────
// 2025-26: one line item per support, claim type chosen via a portal
// drop-down ("Provider Travel", "Non-Face-to-Face", "Cancellation",
// "NDIA Report", "Telehealth"). 2026-27 Schedule: the same claim types become
// explicit suffixed item numbers (_PT, _NF, _CA, _RR, _TH). Both are recorded.
const CLAIM_TYPES = {
  direct:      { suffix: '',    portalOption: null,                 rateFactor: 1.0, label: 'Direct Service' },
  telehealth:  { suffix: '_TH', portalOption: 'Telehealth Services', rateFactor: 1.0, label: 'Telehealth' },
  non_f2f:     { suffix: '_NF', portalOption: 'Non-Face-to-Face',    rateFactor: 1.0, label: 'Non-Face-to-Face' },
  travel:      { suffix: '_PT', portalOption: 'Provider Travel',     rateFactor: 0.5, label: 'Provider Travel' }, // p.22: 50% for therapy
  cancellation:{ suffix: '_CA', portalOption: 'Cancellation',        rateFactor: 1.0, label: 'Short Notice Cancellation' },
  ndia_report: { suffix: '_RR', portalOption: 'NDIA Report',         rateFactor: 1.0, label: 'NDIA Requested Report' },
};

// ── Support items ───────────────────────────────────────────────────────────
// `national` is the MMM1-5 hourly limit; remote / veryRemote are the loaded
// figures as printed (they equal national × 1.40 / × 1.50 rounded to cents).
// `claimable` lists which CLAIM_TYPES the PAPL allows against the item.
const THERAPY_CLAIMABLE = ['direct', 'telehealth', 'non_f2f', 'travel', 'cancellation', 'ndia_report'];

const SUPPORT_ITEMS = [
  // ── Occupational Therapist, participant 9 or older ────────────────────
  {
    code: '15_617_0128_1_3',
    name: 'Assessment Recommendation Therapy or Training - Occupational Therapist',
    profession: 'occupational_therapist',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '15', // Improved Daily Living
    ageBand: '9_plus',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0128_1_3',
    prices: {
      'FY2025-26': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // p.96
      'FY2026-27': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // Sched p.36
    },
  },
  {
    code: '01_661_0128_1_3',
    name: 'Assessment Recommendation Therapy or Training Supports - Occupational Therapist (Disability-Related Health Supports, Core duplicate)',
    profession: 'occupational_therapist',
    registrationGroup: '0128',
    budget: 'core',
    supportCategory: '01', // Assistance with Daily Life — DRHS duplicate, p.61-62
    ageBand: '9_plus',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '01_799_0128_1_1',
    prices: {
      'FY2025-26': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // p.62
      'FY2026-27': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // Sched p.35
    },
  },
  {
    code: '10_617_0128_5_3',
    name: 'Employment Therapy - Occupational Therapist',
    profession: 'occupational_therapist',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '10', // Finding and Keeping a Job
    ageBand: '9_plus',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '10_799_0128_5_3',
    prices: {
      // Not tabulated in the 2025-26 therapy section supplied; listed in 2026-27 Schedule.
      'FY2026-27': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // Sched p.35-36
    },
  },
  // ── Occupational Therapist, participant younger than 9 (ECI) ───────────
  {
    code: '15_617_0118_1_3',
    name: 'Early Childhood Intervention Professional - Occupational Therapist',
    profession: 'occupational_therapist',
    registrationGroup: '0118',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: 'under_9',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0118_1_3',
    prices: {
      'FY2025-26': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // p.94
      'FY2026-27': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // Sched p.54
    },
  },
  {
    code: '01_650_0118_1_3',
    name: 'Assessment Recommendation Therapy or Training - EC - Occupational Therapist (Disability-Related Health Supports, Core duplicate)',
    profession: 'occupational_therapist',
    registrationGroup: '0118',
    budget: 'core',
    supportCategory: '01',
    ageBand: 'under_9',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '01_799_0118_1_1',
    prices: {
      'FY2025-26': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // p.62
      'FY2026-27': { national: 193.99, remote: 271.59, veryRemote: 290.99 }, // Sched p.54
    },
  },
  // ── Therapy assistants working under OT delegation ─────────────────────
  {
    code: '15_052_0128_1_3',
    name: 'Therapy Assistant - Level 1 (direct supervision at all times)',
    profession: 'therapy_assistant_1',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: '9_plus',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0128_1_3',
    prices: {
      'FY2025-26': { national: 56.16, remote: 78.62, veryRemote: 84.24 }, // p.97
      'FY2026-27': { national: 56.16, remote: 78.62, veryRemote: 84.24 }, // Sched p.48
    },
  },
  {
    code: '15_053_0128_1_3',
    name: 'Therapy Assistant - Level 2 (indirect supervision)',
    profession: 'therapy_assistant_2',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: '9_plus',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0128_1_3',
    prices: {
      'FY2025-26': { national: 86.79, remote: 121.51, veryRemote: 130.19 }, // p.97
      'FY2026-27': { national: 86.79, remote: 121.51, veryRemote: 130.19 }, // Sched p.48
    },
  },
  {
    code: '15_007_0118_1_3',
    name: 'Early Childhood Intervention Professional - Therapy Assistant - Level 1',
    profession: 'therapy_assistant_1',
    registrationGroup: '0118',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: 'under_9',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0118_1_3',
    prices: {
      'FY2025-26': { national: 56.16, remote: 78.62, veryRemote: 84.24 }, // p.94
      'FY2026-27': { national: 56.16, remote: 78.62, veryRemote: 84.24 }, // Sched p.62
    },
  },
  {
    code: '15_008_0118_1_3',
    name: 'Early Childhood Intervention Professional - Therapy Assistant - Level 2',
    profession: 'therapy_assistant_2',
    registrationGroup: '0118',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: 'under_9',
    unit: 'hour',
    claimable: THERAPY_CLAIMABLE,
    nonLabourTravelItem: '15_799_0118_1_3',
    prices: {
      'FY2025-26': { national: 86.79, remote: 121.51, veryRemote: 130.19 }, // p.94
      'FY2026-27': { national: 86.79, remote: 121.51, veryRemote: 130.19 }, // Sched p.62-63
    },
  },
  // ── Related items an OT practice may use ───────────────────────────────
  {
    code: '15_045_0128_1_3',
    name: 'Community Engagement Assistance',
    profession: 'any_0128',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: '9_plus',
    unit: 'hour',
    claimable: ['direct', 'non_f2f', 'travel', 'cancellation'], // p.97 — no NDIA report
    groupPricing: 'per_participant_flat', // p.97: group price per participant is the table price, not divided
    nonLabourTravelItem: '15_799_0128_1_3',
    prices: {
      'FY2025-26': { national: 51.20, remote: 71.68, veryRemote: 76.80 }, // p.97
    },
  },
  {
    code: '15_049_0128_1_3',
    name: 'Multidisciplinary Team',
    profession: 'any_0128',
    registrationGroup: '0128',
    budget: 'capacity_building',
    supportCategory: '15',
    ageBand: '9_plus',
    unit: 'each',
    claimable: ['direct'],
    requiresNdiaPriorApproval: true, // p.98
    prices: {}, // no price limit; quotable / prior approval
  },
];

// ── Non-labour travel items ($1 notional unit, no price limit) ─────────────
// Claimed as (kilometres × agreed rate) + tolls/parking, quantity in dollars.
const NON_LABOUR_TRAVEL_ITEMS = {
  '15_799_0128_1_3': { registrationGroup: '0128', budget: 'capacity_building', unit: 'each', notionalUnit: 1.00 },
  '01_799_0128_1_1': { registrationGroup: '0128', budget: 'core', unit: 'each', notionalUnit: 1.00 },
  '10_799_0128_5_3': { registrationGroup: '0128', budget: 'capacity_building', unit: 'each', notionalUnit: 1.00 },
  '15_799_0118_1_3': { registrationGroup: '0118', budget: 'capacity_building', unit: 'each', notionalUnit: 1.00 },
  '01_799_0118_1_1': { registrationGroup: '0118', budget: 'core', unit: 'each', notionalUnit: 1.00 },
};

// ── Claiming-rule constants (p.16-27) ──────────────────────────────────────
const CLAIMING_RULES = {
  // p.22 travel labour: cap per participant per direction, by MMM of the
  // PARTICIPANT's location at time of service. Return travel to usual place of
  // work also claimable within the same cap if the worker is paid for it.
  travel: {
    rateFactor: 0.5,               // therapy travel limit = 50% of direct limit
    capMinutesByMmm: { 1: 30, 2: 30, 3: 30, 4: 60, 5: 60, 6: null, 7: null },
    apportionAcrossParticipants: true, // multi-participant trip: divide agreed in advance
    requiresFaceToFacePrimarySupport: true,
    requiresAgreementInAdvance: true,
    nonLabour: {
      vehiclePerKmGuide: 0.99,     // p.23 "up to $0.99 a kilometre"
      otherCostsFullAmount: true,  // tolls, parking, public transport at cost
    },
  },
  // p.26-27 short notice cancellation for non-DSW (therapy) supports
  cancellation: {
    noticeBusinessDays: 2,         // "less than two (2) clear business days' notice"
    maxClaimFraction: 1.0,         // up to 100% of the agreed fee
    requiresNoAlternativeBillableWork: true,
    requiresServiceAgreementTerm: true,
    noShowCountsAsCancellation: true,
    providerMayWaive: true,
    noHardLimitOnCount: true,      // NDIA monitors unusual counts
    programsOfSupportExempt: true, // p.32
  },
  // p.20-21
  nonFaceToFace: {
    mustRelateToSpecificSupportForThatParticipant: true,
    requiresAgreementInAdvance: true,
    notClaimable: [
      'pre-engagement visits',
      'developing and agreeing service agreements',
      'entering or amending participant details',
      'making participant service time changes',
      'staff/participant travel monitoring and adjustment',
      'ongoing NDIS plan monitoring',
      'completing a quoting tool',
      'making service bookings',
      'making payment claims',
      'staff training, up-skilling and supervision',
    ],
    claimableExamples: [
      'writing reports for co-workers/other providers about the participant',
      'participant-specific research linked to the participant goals',
      'resource development for the participant',
    ],
  },
  // p.20
  telehealth: {
    requiresAppropriateness: true,
    requiresAgreementInAdvance: true,
    sameRateAsDirect: true,
    priceLimitLocation: 'provider',   // p.32: limit is where the PROVIDER is, unless remote participant agrees otherwise
  },
  // p.27-28
  ndiaReport: {
    requiresNdiaRequest: true,
    requiresAgreementInAdvance: true,
    qualifyingReports: [
      'plan commencement report outlining objectives and goals',
      'plan review report measuring functional outcomes',
      'report recommending ongoing needs',
      'other therapy report stipulated as required in the plan',
    ],
    priceLimitLocation: 'provider',
  },
  // p.32
  group: {
    perParticipantLimit: 'divide_by_group_size',
    claimFullDurationPerParticipant: true,
  },
  // p.17-18: therapy items have NO time-of-day / day-of-week variants.
  timeOfDay: { appliesToTherapy: false },
  // p.16: partial units are claimed pro rata by time
  partialUnits: { proRataByMinutes: true },
  // p.36-37
  multipleWorkers: {
    supervisionOfTherapyAssistantBillable: true,  // both therapist and TA time
    caseConferenceBillable: true,                 // all therapists' time
  },
  // p.40
  otherFees: {
    surchargesProhibited: true,   // no card surcharge, gap fee, late fee, exit fee
    gstInclusiveLimit: true,      // if GST applies, the limit includes it
  },
  // p.9-10
  applicability: {
    agencyManaged: 'limits_apply_registered_only',
    planManaged: 'limits_apply',
    selfManaged: 'limits_do_not_apply',
  },
};

module.exports = {
  FINANCIAL_YEARS,
  MMM_ZONES,
  CLAIM_TYPES,
  SUPPORT_ITEMS,
  NON_LABOUR_TRAVEL_ITEMS,
  CLAIMING_RULES,
};
