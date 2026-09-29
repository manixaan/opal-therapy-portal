'use strict';

/**
 * DEFAULT RATE CARD — the ONLY place NDIS prices appear in code.
 *
 * Used once per organisation to seed its first rate card when none exists.
 * After that the owner edits/versions rate cards in Billing Settings and
 * billing reads prices exclusively from the database.
 *
 * Source: Opal Therapy business rules (Sep 2026), consistent with NDIS PAPL
 * 2025-26 and Pricing Schedule 2026-27 for Occupational Therapy
 * (15_617_0128_1_3; OT limits unchanged across both years).
 *   MMM1–5 share the base session/travel rate; MMM1–3 vs MMM4–5 differ only
 *   in the travel-time cap. MMM6 = remote loading, MMM7 = very remote.
 *   No evening/weekend/public-holiday loading for OT.
 */

const DEFAULT_RATE_CARD = Object.freeze({
  discipline: 'OT',
  name: 'NDIS Occupational Therapy price limits',
  version: 1,
  effectiveFrom: '2025-07-01',
  notes: 'Seeded default. PAPL 2025-26 / Pricing Schedule 2026-27 OT limits; vehicle at the $0.99/km guide maximum.',
  rules: [
    { mmmMin: 1, mmmMax: 3, zoneLabel: 'MMM1–3', sessionHourlyRate: '193.99', travelHourlyRate: '97.00', travelCapMinutesEachWay: 30, vehicleRatePerKm: '0.99' },
    { mmmMin: 4, mmmMax: 5, zoneLabel: 'MMM4–5', sessionHourlyRate: '193.99', travelHourlyRate: '97.00', travelCapMinutesEachWay: 60, vehicleRatePerKm: '0.99' },
    { mmmMin: 6, mmmMax: 6, zoneLabel: 'MMM6 (remote)', sessionHourlyRate: '271.59', travelHourlyRate: '135.80', travelCapMinutesEachWay: null, vehicleRatePerKm: '0.99' },
    { mmmMin: 7, mmmMax: 7, zoneLabel: 'MMM7 (very remote)', sessionHourlyRate: '290.99', travelHourlyRate: '145.50', travelCapMinutesEachWay: null, vehicleRatePerKm: '0.99' },
  ].map(r => ({
    ...r,
    sessionItemCode: '15_617_0128_1_3',
    travelItemCode: '15_617_0128_1_3_PT',
    vehicleItemCode: '15_799_0128_1_3',
    tripCostItemCode: '15_799_0128_1_3',
  })),
});

module.exports = { DEFAULT_RATE_CARD };
