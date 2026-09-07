'use strict';

const R = require('../ndis-billing-rules');
const G = require('../ndis/ot-price-guide');

const OT = 'occupational_therapist';

describe('price guide integrity', () => {
  test('remote and very remote limits are national × 1.40 / × 1.50', () => {
    for (const item of G.SUPPORT_ITEMS) {
      for (const [fy, p] of Object.entries(item.prices)) {
        if (p.national == null) continue;
        expect(p.remote).toBeCloseTo(Math.round(p.national * 1.4 * 100) / 100, 2);
        expect(p.veryRemote).toBeCloseTo(Math.round(p.national * 1.5 * 100) / 100, 2);
        expect(fy).toMatch(/^FY20\d\d-\d\d$/);
      }
    }
  });
  test('OT direct limit is unchanged across 2025-26 and 2026-27', () => {
    const ot = G.SUPPORT_ITEMS.find(i => i.code === '15_617_0128_1_3');
    expect(ot.prices['FY2025-26'].national).toBe(193.99);
    expect(ot.prices['FY2026-27'].national).toBe(193.99);
  });
  test('every priced item points at a known non-labour travel item', () => {
    for (const item of G.SUPPORT_ITEMS) {
      if (item.nonLabourTravelItem) expect(G.NON_LABOUR_TRAVEL_ITEMS[item.nonLabourTravelItem]).toBeDefined();
    }
  });
});

describe('financial year and proration', () => {
  test('maps dates to the right financial year and refuses out-of-range', () => {
    expect(R.financialYearFor('2026-06-30')).toBe('FY2025-26');
    expect(R.financialYearFor('2026-07-01')).toBe('FY2026-27');
    expect(R.financialYearFor('2024-01-01')).toBeNull();
    expect(R.financialYearFor('garbage')).toBeNull();
  });
  test('reproduces the PAPL p.16 proration table at $193.99', () => {
    expect(R.amountForMinutes(10, 193.99)).toBe(32.33);
    expect(R.amountForMinutes(20, 193.99)).toBe(64.66);
    expect(R.amountForMinutes(30, 193.99)).toBe(97.00);
    expect(R.amountForMinutes(40, 193.99)).toBe(129.33);
    expect(R.amountForMinutes(50, 193.99)).toBe(161.66);
    expect(R.amountForMinutes(60, 193.99)).toBe(193.99);
    expect(R.hoursFromMinutes(40)).toBe(0.67);
  });
});

describe('resolveSupportItem / resolvePriceLimit', () => {
  test('OT, age 12, capacity building → 15_617_0128_1_3', () => {
    expect(R.resolveSupportItem({ profession: OT, participantAge: 12 }).code).toBe('15_617_0128_1_3');
  });
  test('OT, age 6 → early childhood item', () => {
    expect(R.resolveSupportItem({ profession: OT, participantAge: 6 }).code).toBe('15_617_0118_1_3');
  });
  test('OT core (DRHS) and employment variants', () => {
    expect(R.resolveSupportItem({ profession: OT, ageBand: '9_plus', budget: 'core' }).code).toBe('01_661_0128_1_3');
    expect(R.resolveSupportItem({ profession: OT, ageBand: '9_plus', budget: 'employment' }).code).toBe('10_617_0128_5_3');
  });
  test('missing age or unknown profession resolves to null (fail closed)', () => {
    expect(R.resolveSupportItem({ profession: OT })).toBeNull();
    expect(R.resolveSupportItem({ profession: 'physio', participantAge: 20 })).toBeNull();
  });
  test('travel limit is 50% of direct; remote loading applies', () => {
    const d = R.resolvePriceLimit({ itemCode: '15_617_0128_1_3', claimType: 'direct', mmm: 1, date: '2026-09-07' });
    const t = R.resolvePriceLimit({ itemCode: '15_617_0128_1_3', claimType: 'travel', mmm: 1, date: '2026-09-07' });
    const r = R.resolvePriceLimit({ itemCode: '15_617_0128_1_3', claimType: 'direct', mmm: 6, date: '2026-09-07' });
    const vr = R.resolvePriceLimit({ itemCode: '15_617_0128_1_3', claimType: 'travel', mmm: 7, date: '2026-09-07' });
    expect(d.limit).toBe(193.99);
    expect(t.limit).toBe(97.00);
    expect(t.claimCode).toBe('15_617_0128_1_3_PT');
    expect(r.limit).toBe(271.59);
    expect(vr.limit).toBe(145.50);
  });
  test('employment item has no 2025-26 price → null before 1 July 2026', () => {
    expect(R.resolvePriceLimit({ itemCode: '10_617_0128_5_3', mmm: 1, date: '2026-03-01' })).toBeNull();
    expect(R.resolvePriceLimit({ itemCode: '10_617_0128_5_3', mmm: 1, date: '2026-08-01' }).limit).toBe(193.99);
  });
  test('claim type not permitted for item → null', () => {
    expect(R.resolvePriceLimit({ itemCode: '15_045_0128_1_3', claimType: 'ndia_report', mmm: 1, date: '2026-01-10' })).toBeNull();
  });
});

describe('assessCancellation — 2 clear business days (PAPL p.27 examples)', () => {
  // Tue 2026-09-08 10:00 UTC appointment; Mon 2026-09-07 public holiday
  const start = '2026-09-08T10:00:00Z';
  const holidays = ['2026-09-07'];
  test('cancelled after 10am Thursday → short notice, claimable with agreement', () => {
    const out = R.assessCancellation({ scheduledStart: start, cancelledAt: '2026-09-03T11:00:00Z', publicHolidays: holidays, serviceAgreementAllowsCancellationFee: true });
    expect(out.shortNotice).toBe(true);
    expect(out.claimable).toBe(true);
    expect(out.deadline).toBe('2026-09-03T10:00:00.000Z');
  });
  test('cancelled before 10am Thursday → sufficient notice', () => {
    const out = R.assessCancellation({ scheduledStart: start, cancelledAt: '2026-09-03T09:00:00Z', publicHolidays: holidays, serviceAgreementAllowsCancellationFee: true });
    expect(out.shortNotice).toBe(false);
    expect(out.claimable).toBe(false);
  });
  test('without the holiday the deadline is Friday 10am', () => {
    const out = R.assessCancellation({ scheduledStart: start, cancelledAt: '2026-09-04T09:00:00Z', publicHolidays: [], serviceAgreementAllowsCancellationFee: true });
    expect(out.deadline).toBe('2026-09-04T10:00:00.000Z');
    expect(out.shortNotice).toBe(false);
  });
  test('no-show is short notice; missing agreement term blocks the claim', () => {
    const out = R.assessCancellation({ scheduledStart: start, noShow: true, publicHolidays: holidays });
    expect(out.shortNotice).toBe(true);
    expect(out.claimable).toBe(false);
    expect(out.warnings).toContain('service_agreement_cancellation_term_not_confirmed');
  });
  test('alternative billable work found blocks the claim', () => {
    const out = R.assessCancellation({ scheduledStart: start, noShow: true, publicHolidays: holidays, serviceAgreementAllowsCancellationFee: true, alternativeBillableWorkFound: true });
    expect(out.claimable).toBe(false);
  });
  test('missing holiday list is flagged, never assumed', () => {
    const out = R.assessCancellation({ scheduledStart: start, noShow: true, serviceAgreementAllowsCancellationFee: true });
    expect(out.warnings).toContain('public_holidays_not_supplied');
  });
});

describe('computeTravel (PAPL p.25 speech pathologist example, OT rates)', () => {
  test('MMM1-3: 35 min to is capped at 30, 25 min return allowed, km at agreed rate', () => {
    const out = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 3, date: '2026-09-07', minutesTo: 35, minutesReturn: 25, kilometres: 80, perKmRate: 0.78, agreedInAdvance: true });
    const labour = out.lines.find(l => l.kind === 'travel_labour');
    const nl = out.lines.find(l => l.kind === 'travel_non_labour');
    expect(labour.minutes).toBe(55);
    expect(labour.unitAmount).toBe(97.00);
    expect(labour.amount).toBe(88.92); // 97 × 55/60
    expect(labour.itemCode).toBe('15_617_0128_1_3_PT');
    expect(nl.itemCode).toBe('15_799_0128_1_3');
    expect(nl.amount).toBe(62.40);
    expect(out.warnings).toContain('travel_minutes_capped');
  });
  test('MMM4-5 cap is 60; MMM6 uncapped and loaded', () => {
    const r = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 4, date: '2026-09-07', minutesTo: 65, agreedInAdvance: true });
    expect(r.lines[0].minutes).toBe(60);
    const rem = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 6, date: '2026-09-07', minutesTo: 90, agreedInAdvance: true });
    expect(rem.lines[0].minutes).toBe(90);
    expect(rem.lines[0].unitAmount).toBe(135.80);
  });
  test('apportions across participants on one trip', () => {
    const out = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 1, date: '2026-09-07', minutesTo: 30, minutesReturn: 30, participantsOnTrip: 2, kilometres: 40, perKmRate: 0.99, agreedInAdvance: true });
    expect(out.lines[0].minutes).toBe(30);
    expect(out.lines[1].amount).toBe(19.80);
  });
  test('per-km above $0.99 and rate above limit are flagged; no F2F primary blocks', () => {
    const out = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 1, date: '2026-09-07', minutesTo: 10, kilometres: 5, perKmRate: 1.20, agreedHourlyRate: 120, agreedInAdvance: true });
    expect(out.warnings).toEqual(expect.arrayContaining(['per_km_rate_above_guide', 'travel_rate_above_limit']));
    const blocked = R.computeTravel({ itemCode: '15_617_0128_1_3', mmm: 1, date: '2026-09-07', minutesTo: 10, primarySupportFaceToFace: false });
    expect(blocked.blocked).toBe(true);
  });
});

describe('planDayTravel — pooled multi-client run (PAPL p.25 method)', () => {
  const sessions = [
    { eventId: 'a', legMinutes: 20, legKm: 15 },
    { eventId: 'b', legMinutes: 15, legKm: 10 },
    { eventId: 'c', legMinutes: 25, legKm: 20 },
  ];
  test('three clients, paid return: 90 min and 70 km split three ways', () => {
    const p = R.planDayTravel({ sessions, returnMinutes: 30, returnKm: 25, returnPaid: true });
    expect(p.pooledMinutes).toBe(90);
    expect(p.pooledKm).toBe(70);
    expect(p.divisor).toBe(3);
    expect(p.shares.a).toEqual({ minutes: 30, km: 23.33 });
  });
  test('unpaid return is dropped and flagged', () => {
    const p = R.planDayTravel({ sessions, returnMinutes: 30, returnKm: 25, returnPaid: false });
    expect(p.pooledMinutes).toBe(60);
    expect(p.shares.b.minutes).toBe(20);
    expect(p.warnings).toContain('return_leg_unpaid_not_claimed');
  });
  test('a cancelled client drops out of the divisor but its leg stays pooled with a flag', () => {
    const p = R.planDayTravel({ sessions: [sessions[0], { ...sessions[1], billable: false }, sessions[2]], returnMinutes: 30, returnKm: 25 });
    expect(p.divisor).toBe(2);
    expect(p.shares.b).toBeUndefined();
    expect(p.shares.a.minutes).toBe(45);
    expect(p.warnings).toContain('leg_to_non_billable_session_pooled');
  });
  test('no billable sessions → nothing to share', () => {
    expect(R.planDayTravel({ sessions: [] }).warnings).toContain('no_billable_sessions');
  });
});

describe('buildClaim', () => {
  const base = {
    id: 'ev1', start: '2026-09-08T00:00:00Z', end: '2026-09-08T01:00:00Z', status: 'completed',
    deliveryMode: 'in_person', profession: OT, participantAge: 30, mmm: 1, fundingType: 'plan_managed',
    agreedHourlyRate: 193.99, agreement: { telehealth: true, nonF2f: true, ndiaReports: true, cancellations: true, travel: true },
  };
  test('direct 60 min session at the limit is ready', () => {
    const c = R.buildClaim(base);
    expect(c.status).toBe('ready');
    expect(c.lines[0].itemCode).toBe('15_617_0128_1_3');
    expect(c.total).toBe(193.99);
    expect(c.fy).toBe('FY2026-27');
  });
  test('45 min session prorates', () => {
    const c = R.buildClaim({ ...base, end: '2026-09-08T00:45:00Z' });
    expect(c.lines[0].quantityHours).toBe(0.75);
    expect(c.total).toBe(145.49);
  });
  test('rate above limit → needs_review, not clamped', () => {
    const c = R.buildClaim({ ...base, agreedHourlyRate: 200 });
    expect(c.status).toBe('needs_review');
    expect(c.lines[0].unitAmount).toBe(200);
    expect(c.warnings).toContain('rate_above_price_limit');
  });
  test('self-managed: limit not binding, no review flag', () => {
    const c = R.buildClaim({ ...base, agreedHourlyRate: 200, fundingType: 'self_managed' });
    expect(c.status).toBe('ready');
    expect(c.warnings).toContain('self_managed_limits_not_binding');
  });
  test('telehealth uses provider MMM and _TH code; missing agreement warns', () => {
    const c = R.buildClaim({ ...base, deliveryMode: 'telehealth', mmm: 6, providerMmm: 1, agreement: {} });
    expect(c.lines[0].itemCode).toBe('15_617_0128_1_3_TH');
    expect(c.lines[0].priceLimit).toBe(193.99);
    expect(c.warnings).toContain('telehealth_agreement_not_confirmed');
  });
  test('NDIA report needs both agreement and an NDIA request', () => {
    const c = R.buildClaim({ ...base, deliveryMode: 'ndia_report' });
    expect(c.lines[0].itemCode).toBe('15_617_0128_1_3_RR');
    expect(c.warnings).toContain('ndia_report_request_not_confirmed');
    const ok = R.buildClaim({ ...base, deliveryMode: 'ndia_report', ndiaRequested: true });
    expect(ok.warnings).not.toContain('ndia_report_request_not_confirmed');
  });
  test('group of 3 divides the per-participant limit', () => {
    const c = R.buildClaim({ ...base, groupSize: 3, agreedHourlyRate: 64.66 });
    expect(c.lines[0].priceLimit).toBe(64.66);
    expect(c.status).toBe('ready');
  });
  test('short-notice cancellation claims at agreed rate under _CA; sufficient notice → not_claimable', () => {
    const sn = R.buildClaim({ ...base, status: 'cancelled', cancellation: { cancelledAt: '2026-09-07T20:00:00Z', publicHolidays: [] } });
    expect(sn.status).toBe('ready');
    expect(sn.lines[0].itemCode).toBe('15_617_0128_1_3_CA');
    expect(sn.total).toBe(193.99);
    const ok = R.buildClaim({ ...base, status: 'cancelled', cancellation: { cancelledAt: '2026-09-01T00:00:00Z', publicHolidays: [] } });
    expect(ok.status).toBe('not_claimable');
    expect(ok.lines).toHaveLength(0);
  });
  test('travel rides on a direct session and is refused on telehealth or cancellation', () => {
    const t = { minutesTo: 20, minutesReturn: 20, kilometres: 30, perKmRate: 0.99 };
    const d = R.buildClaim({ ...base, travel: t });
    expect(d.lines.map(l => l.kind)).toEqual(['direct', 'travel_labour', 'travel_non_labour']);
    expect(d.total).toBe(193.99 + 64.67 + 29.70);
    const th = R.buildClaim({ ...base, deliveryMode: 'telehealth', travel: t });
    expect(th.lines).toHaveLength(1);
    expect(th.warnings).toContain('travel_not_claimable_for_this_claim_type');
  });
  test('fails closed on unresolvable inputs', () => {
    expect(R.buildClaim({ ...base, participantAge: undefined }).status).toBe('blocked');
    expect(R.buildClaim({ ...base, start: '2024-01-01T00:00:00Z', end: '2024-01-01T01:00:00Z' }).status).toBe('blocked');
    expect(R.buildClaim({ ...base, end: base.start }).status).toBe('blocked');
    expect(R.buildClaim({ ...base, fundingType: 'ndia_managed', providerRegistered: false }).status).toBe('blocked');
  });
  test('weekly roll-up groups by participant', () => {
    const w = R.buildWeeklyClaims([{ ...base, participantId: 'p1' }, { ...base, id: 'ev2', participantId: 'p1', end: '2026-09-08T00:30:00Z' }, { ...base, id: 'ev3', participantId: 'p2' }]);
    expect(w.byParticipant.p1.total).toBe(193.99 + 97.00);
    expect(w.byParticipant.p2.claims).toHaveLength(1);
  });
});
