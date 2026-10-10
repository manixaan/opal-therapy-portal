'use strict';

/**
 * Session MMM zone lookup — the hard-coded WA MMM 2023 locality table.
 * Fail-closed: only an unambiguous locality (or single-zone postcode) is CONFIDENT.
 */

const L = require('../billing/mmm-locality');
const TABLE = require('../billing/data/mmm2023-wa-localities.json');

describe('WA MMM 2023 locality table', () => {
  test('is the official SAL/POA/MMM 2023 correspondence, WA only, zones 1–7', () => {
    expect(TABLE.version).toBe('MMM2023');
    expect(TABLE.sourceUrl).toMatch(/data\.gov\.au/);
    expect(TABLE.localities.length).toBeGreaterThan(1600);
    for (const [name, postcode, zones] of TABLE.localities) {
      expect(typeof name).toBe('string');
      expect(postcode).toMatch(/^(6\d{3}|0872)$/); // 0872: WA's Ngaanyatjarra lands use an NT postcode
      expect(zones.length).toBeGreaterThan(0);
      for (const [z] of zones) expect(z >= 1 && z <= 7).toBe(true);
    }
  });
});

describe('lookupAddress', () => {
  test.each([
    ['13 Lecania St, Seville Grove, WA, 6112', 1, 'Seville Grove'],
    ['15A Jarvis St, O’Connor, WA, 6163', 1, "O'Connor"],
    ['10 Albany Hwy Victoria Park WA 6100', 1, 'Victoria Park'],
    ['12 Bunbury St, Bunbury WA 6230', 2, 'Bunbury'],
    ['Broome 6725', 6, 'Broome'],
    ['Lot 4, Kununurra', 7, 'Kununurra'],
    ['Community Office, Warakurna WA 0872', 7, 'Warakurna'],
    ['Unit 2/14 Collins St, Kensington (WA) 6151', 1, 'Kensington'],
  ])('%s → MM%i (%s)', (address, zone, locality) => {
    expect(L.lookupAddress(address)).toMatchObject({ zone, confident: true, locality, reason: null, datasetVersion: 'MMM2023' });
  });

  test('a street named like a town does not decide the zone — the suburb does', () => {
    expect(L.lookupAddress('4 Broome St, Perth WA 6000')).toMatchObject({ zone: 1, locality: 'Perth' });
  });

  test('a suburb straddling a zone boundary is REVIEW with a suggestion, never a guess', () => {
    const r = L.lookupAddress('1 Main St, Baldivis WA 6171');
    expect(r).toMatchObject({ zone: null, confident: false, reason: 'straddles_boundary', zones: [1, 2], suggestedZone: 1 });
  });

  test('a postcode that contradicts the suburb is REVIEW', () => {
    expect(L.lookupAddress('5 Smith St, Perth WA 6155')).toMatchObject({ zone: null, confident: false, reason: 'postcode_mismatch' });
  });

  test('postcode only: confident when every locality shares a zone, REVIEW when it spans zones', () => {
    expect(L.lookupAddress('PO Box 1, 6000')).toMatchObject({ zone: 1, confident: true, matchedBy: 'postcode' });
    expect(L.lookupAddress('somewhere 6171')).toMatchObject({ zone: null, confident: false, reason: 'postcode_spans_zones' });
  });

  test.each([
    ['', 'no_address'],
    [null, 'no_address'],
    ['22 Princeton Cct', 'no_wa_locality'],
    ['Microsoft Teams Meeting', 'no_wa_locality'],
    ['Sydney NSW 2000', 'no_wa_locality'],
  ])('%p is UNRESOLVED (%s)', (address, reason) => {
    expect(L.lookupAddress(address)).toMatchObject({ zone: null, confident: false, reason });
  });

  test('every unresolved reason has wording for the attention queue', () => {
    for (const r of ['no_address', 'no_wa_locality', 'unknown_postcode', 'postcode_spans_zones', 'postcode_mismatch', 'straddles_boundary']) {
      expect(L.reasonText(r)).not.toBe(r);
    }
  });
});
