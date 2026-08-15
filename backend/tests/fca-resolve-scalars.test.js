'use strict';

/**
 * FCA SCALAR RESOLVER + MANIFEST COMPOSER — unit tests.
 *
 * The four-layer precedence and its per-tag source attribution are the part of
 * this feature a therapist has to be able to trust: the badge next to a field
 * is a claim about where a clinical fact came from. These tests pin every
 * ordering rule, including the one that matters most — that a stale client
 * profile can never shadow live Splose data.
 */

const { resolveScalars, layerTable } = require('../fca/resolve-scalars');
const {
  normaliseSelection,
  normaliseCustomSections,
  normaliseOverrides,
  normaliseExcludedFields,
  buildManifest,
} = require('../fca/manifest');
const {
  documentReference,
  issueDocumentControl,
  documentControlFor,
} = require('../fca/document-id');
const tm = require('../fca/template-map');

const SPLOSE = {
  id: 'c-1',
  fullName: 'Jane Citizen',
  ndisNumber: '430000001',
  email: 'jane@example.invalid',
  mobilePhone: '0400 000 000',
  formattedAddress: '1 Example St, Perth WA 6000',
};

const PROFILE = {
  preferred_name: 'Janey',
  pronouns: 'she/her',
  date_of_birth: '1990-05-07',
  primary_disability: 'Multiple sclerosis',
  other_conditions: 'Chronic fatigue',
  nominee_details: 'Pat Citizen (mother)',
  support_coordinator_details: 'Coordinator Co',
  referrer_details: 'Dr A Referrer',
};

const PLAN = { plan_start: '2026-01-01', plan_end: '2026-12-31' };
const GOALS = [
  { goalText: 'Increase independence at home' },
  { goalText: 'Return to part-time work' },
  { goalText: 'Build community connections' },
];

const PORTAL = {
  therapistName: 'Sam Therapist',
  therapistRoleTitle: 'Occupational Therapist',
  therapistEmail: 'sam@opal.invalid',
  therapistPhone: '08 9000 0000',
  organisationName: 'Opal Therapy',
  ahpraNumber: 'OCC0001234567',
};

// What Opal issues when a draft is created — see fca/document-id.js.
const SERVER = {
  documentReference: 'FCA-ABCD1234',
  reportDate: '10/08/2026',
  reportVersion: '1.0',
  reportStatus: 'Draft',
};

const full = (overrides = {}) => resolveScalars({
  splose: SPLOSE, profile: PROFILE, currentPlan: PLAN, goals: GOALS,
  portal: PORTAL, server: SERVER, overrides,
});

// ── Layer classification ─────────────────────────────────────────────────────

describe('layer classification', () => {
  test('every one of the 33 scalar tags belongs to exactly one layer', () => {
    const layers = ['splose', 'client_profile', 'portal', 'report', 'server'];
    const counts = Object.fromEntries(layers.map((l) => [l, 0]));
    for (const meta of tm.SCALAR_TAGS) {
      expect(layers).toContain(meta.layer);
      counts[meta.layer] += 1;
    }
    expect(tm.SCALAR_TAGS.length).toBe(33);
    expect(counts).toEqual({ splose: 5, client_profile: 12, portal: 6, report: 6, server: 4 });
  });

  test('profile eligibility is derived from the layer, not a hand-written list', () => {
    expect(new Set(tm.PROFILE_ELIGIBLE_TAGS))
      .toEqual(new Set(tm.SCALAR_TAGS.filter((s) => s.layer === 'client_profile').map((s) => s.tag)));
    // Nothing Splose owns, nothing report-specific, nothing server-issued.
    for (const tag of tm.SPLOSE_AUTHORITATIVE_TAGS) expect(tm.PROFILE_ELIGIBLE_TAGS).not.toContain(tag);
    for (const tag of tm.REPORT_SPECIFIC_TAGS) expect(tm.PROFILE_ELIGIBLE_TAGS).not.toContain(tag);
    for (const tag of tm.SERVER_TAGS) expect(tm.PROFILE_ELIGIBLE_TAGS).not.toContain(tag);
    for (const tag of tm.PORTAL_TAGS) expect(tm.PROFILE_ELIGIBLE_TAGS).not.toContain(tag);
  });

  test('the layer table covers the whole template', () => {
    expect(layerTable().map((r) => r.tag).sort()).toEqual(tm.SCALAR_TAG_LIST.slice().sort());
  });
});

// ── Precedence ───────────────────────────────────────────────────────────────

describe('four-layer precedence', () => {
  test('Splose wins for identity and contact facts', () => {
    const { scalarData, scalarSources } = full();
    expect(scalarData.OPAL_CLIENT_FULL_NAME).toBe('Jane Citizen');
    expect(scalarSources.OPAL_CLIENT_FULL_NAME).toBe('splose');
    expect(scalarData.OPAL_CLIENT_NDIS_NUMBER).toBe('430000001');
    expect(scalarSources.OPAL_CLIENT_NDIS_NUMBER).toBe('splose');
    expect(scalarSources.OPAL_CLIENT_ADDRESS).toBe('splose');
    expect(scalarSources.OPAL_CLIENT_EMAIL).toBe('splose');
    expect(scalarSources.OPAL_CLIENT_PHONE).toBe('splose');
  });

  test('a STALE PROFILE can never shadow live Splose data', () => {
    // The failure this rule exists to prevent: a profile row captured months
    // ago quietly overriding the current name, NDIS number or address.
    const stale = {
      ...PROFILE,
      full_name: 'OLD NAME',
      ndis_number: '000000000',
      formatted_address: 'OLD ADDRESS',
      email: 'old@example.invalid',
      mobile_phone: '0000',
    };
    const { scalarData, scalarSources } = resolveScalars({
      splose: SPLOSE, profile: stale, currentPlan: PLAN, goals: GOALS, portal: PORTAL, server: SERVER,
    });
    for (const tag of tm.SPLOSE_AUTHORITATIVE_TAGS) {
      expect(scalarSources[tag]).toBe('splose');
    }
    expect(scalarData.OPAL_CLIENT_FULL_NAME).toBe('Jane Citizen');
    expect(JSON.stringify(scalarData)).not.toContain('OLD NAME');
    expect(JSON.stringify(scalarData)).not.toContain('OLD ADDRESS');
  });

  test('a Splose-authoritative tag with no Splose value is missing, not borrowed from the profile', () => {
    const { scalarData, scalarSources, missingFields } = resolveScalars({
      splose: { ...SPLOSE, ndisNumber: null },
      profile: { ...PROFILE, ndis_number: '999999999' },
      currentPlan: PLAN, goals: GOALS, portal: PORTAL, server: SERVER,
    });
    expect(scalarData.OPAL_CLIENT_NDIS_NUMBER).toBeNull();
    expect(scalarSources.OPAL_CLIENT_NDIS_NUMBER).toBe('missing');
    expect(missingFields).toContain('OPAL_CLIENT_NDIS_NUMBER');
  });

  test('the client profile supplies what Splose has no field for', () => {
    const { scalarData, scalarSources } = full();
    expect(scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('Janey');
    expect(scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('client_profile');
    expect(scalarData.OPAL_CLIENT_PRONOUNS).toBe('she/her');
    expect(scalarData.OPAL_CLIENT_PRIMARY_DISABILITY).toBe('Multiple sclerosis');
    expect(scalarSources.OPAL_CLIENT_REFERRER_DETAILS).toBe('client_profile');
  });

  test('a report override beats both the profile and Splose', () => {
    const { scalarData, scalarSources } = full({
      OPAL_CLIENT_PREFERRED_NAME: 'Jan',
      OPAL_CLIENT_ADDRESS: '2 Corrected Rd, Perth WA 6000',
    });
    expect(scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('Jan');
    expect(scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('report_override');
    expect(scalarData.OPAL_CLIENT_ADDRESS).toBe('2 Corrected Rd, Perth WA 6000');
    expect(scalarSources.OPAL_CLIENT_ADDRESS).toBe('report_override');
  });

  test('portal data supplies assessor facts', () => {
    const { scalarData, scalarSources } = full();
    expect(scalarData.OPAL_THERAPIST_FULL_NAME).toBe('Sam Therapist');
    expect(scalarSources.OPAL_THERAPIST_FULL_NAME).toBe('portal');
    expect(scalarData.OPAL_THERAPIST_AHPRA_NUMBER).toBe('OCC0001234567');
    expect(scalarSources.OPAL_THERAPIST_AHPRA_NUMBER).toBe('portal');
  });

  test('server-issued tags resolve to the value Opal issued', () => {
    const { scalarData, scalarSources } = full();
    expect(scalarData.OPAL_REPORT_DOCUMENT_ID).toBe('FCA-ABCD1234');
    expect(scalarSources.OPAL_REPORT_DOCUMENT_ID).toBe('server');
    expect(scalarData.OPAL_REPORT_DATE).toBe('10/08/2026');
    expect(scalarData.OPAL_REPORT_VERSION).toBe('1.0');
    expect(scalarData.OPAL_REPORT_STATUS).toBe('Draft');
    for (const tag of tm.SERVER_TAGS) expect(scalarSources[tag]).toBe('server');
  });

  test('an override beats the issued default — the therapist owns their own document', () => {
    // Version 2.0 of a report, or a report marked Final, is a claim about the
    // therapist's own document. Opal issues a sensible default and gets out of
    // the way, and the badge then says the value came from them.
    const { scalarData, scalarSources } = full({
      OPAL_REPORT_VERSION: '2.0',
      OPAL_REPORT_STATUS: 'Final',
    });
    expect(scalarData.OPAL_REPORT_VERSION).toBe('2.0');
    expect(scalarSources.OPAL_REPORT_VERSION).toBe('report_override');
    expect(scalarData.OPAL_REPORT_STATUS).toBe('Final');
    expect(scalarSources.OPAL_REPORT_STATUS).toBe('report_override');
    // Untouched fields keep the issued value and the 'server' attribution.
    expect(scalarSources.OPAL_REPORT_DOCUMENT_ID).toBe('server');
  });

  test('the document-control fields Opal does NOT issue stay missing', () => {
    // The line between "ours to issue" and "a fact about the world". An issue
    // date has not happened yet, a reviewer is a second human, and only the
    // participant knows who may receive their report.
    const { scalarData, scalarSources } = full();
    for (const tag of [
      'OPAL_REPORT_ISSUE_DATE',
      'OPAL_REPORT_REVIEWER_NAME',
      'OPAL_REPORT_REVIEWER_ROLE',
      'OPAL_REPORT_AUTHORISED_RECIPIENTS',
    ]) {
      expect(scalarData[tag]).toBeNull();
      expect(scalarSources[tag]).toBe('missing');
    }
  });

  test('report-specific tags come from the override or nowhere', () => {
    const before = full();
    expect(before.scalarSources.OPAL_REPORT_REVIEWER_NAME).toBe('missing');
    const after = full({ OPAL_REPORT_REVIEWER_NAME: 'Dr Reviewer' });
    expect(after.scalarSources.OPAL_REPORT_REVIEWER_NAME).toBe('report_override');
    expect(after.scalarData.OPAL_REPORT_REVIEWER_NAME).toBe('Dr Reviewer');
  });
});

// ── NDIS plans and goals ─────────────────────────────────────────────────────

describe('NDIS plan and goals', () => {
  test('the current plan supplies dates, rendered in Australian format', () => {
    const { scalarData } = full();
    expect(scalarData.OPAL_CLIENT_NDIS_PLAN_START).toBe('01/01/2026');
    expect(scalarData.OPAL_CLIENT_NDIS_PLAN_END).toBe('31/12/2026');
    expect(scalarData.OPAL_CLIENT_DATE_OF_BIRTH).toBe('07/05/1990');
  });

  test('a pg Date is read in UTC so the date never slips a day', () => {
    const { scalarData } = resolveScalars({
      profile: { date_of_birth: new Date(Date.UTC(1990, 4, 7)) },
      templateTags: ['OPAL_CLIENT_DATE_OF_BIRTH'],
    });
    expect(scalarData.OPAL_CLIENT_DATE_OF_BIRTH).toBe('07/05/1990');
  });

  test('the template\'s two goal controls take the current plan\'s first two goals, in order', () => {
    const { scalarData, scalarSources } = full();
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_1).toBe('Increase independence at home');
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_2).toBe('Return to part-time work');
    expect(scalarSources.OPAL_CLIENT_NDIS_GOAL_1).toBe('client_profile');
    // A third goal is stored and queryable but fca-v1 has no control for it.
    expect(JSON.stringify(scalarData)).not.toContain('Build community connections');
  });

  test('a plan with one goal leaves the second control missing rather than duplicating', () => {
    const { scalarData, scalarSources } = resolveScalars({
      profile: PROFILE, currentPlan: PLAN, goals: [{ goalText: 'Only goal' }],
      templateTags: ['OPAL_CLIENT_NDIS_GOAL_1', 'OPAL_CLIENT_NDIS_GOAL_2'],
    });
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_1).toBe('Only goal');
    expect(scalarData.OPAL_CLIENT_NDIS_GOAL_2).toBeNull();
    expect(scalarSources.OPAL_CLIENT_NDIS_GOAL_2).toBe('missing');
  });
});

// ── Missing is flagged, never fabricated ─────────────────────────────────────

describe('missing data', () => {
  test('with nothing but Splose, every non-Splose tag is flagged missing', () => {
    const { scalarData, scalarSources, missingFields } = resolveScalars({ splose: SPLOSE });
    expect(missingFields.length).toBe(33 - 5);
    for (const tag of tm.SPLOSE_AUTHORITATIVE_TAGS) expect(scalarSources[tag]).toBe('splose');
    for (const tag of missingFields) expect(scalarData[tag]).toBeNull();
  });

  test('a first name is never substituted for a preferred name', () => {
    const { scalarData, scalarSources } = resolveScalars({
      splose: { ...SPLOSE, firstname: 'Jane' },
      templateTags: ['OPAL_CLIENT_PREFERRED_NAME'],
    });
    expect(scalarData.OPAL_CLIENT_PREFERRED_NAME).toBeNull();
    expect(scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('missing');
  });

  test('blank, whitespace and null are all absent', () => {
    const { scalarSources } = resolveScalars({
      splose: { ...SPLOSE, email: '   ', mobilePhone: '' },
      profile: { ...PROFILE, pronouns: '  ' },
      overrides: { OPAL_REPORT_REVIEWER_NAME: '   ' },
      templateTags: ['OPAL_CLIENT_EMAIL', 'OPAL_CLIENT_PHONE', 'OPAL_CLIENT_PRONOUNS', 'OPAL_REPORT_REVIEWER_NAME'],
    });
    expect(scalarSources.OPAL_CLIENT_EMAIL).toBe('missing');
    expect(scalarSources.OPAL_CLIENT_PHONE).toBe('missing');
    expect(scalarSources.OPAL_CLIENT_PRONOUNS).toBe('missing');
    expect(scalarSources.OPAL_REPORT_REVIEWER_NAME).toBe('missing');
  });

  test('an unknown tag is never invented into the output', () => {
    const { scalarData } = resolveScalars({ templateTags: ['NOT_A_REAL_TAG'] });
    expect(scalarData).toEqual({});
  });

  test('every tag gets a value and a source, always', () => {
    const { scalarData, scalarSources } = full();
    expect(Object.keys(scalarData).sort()).toEqual(tm.SCALAR_TAG_LIST.slice().sort());
    expect(Object.keys(scalarSources).sort()).toEqual(tm.SCALAR_TAG_LIST.slice().sort());
  });
});

// ── Cross-client isolation, at the pure layer ────────────────────────────────

describe('cross-client isolation', () => {
  test('client Y\'s resolution carries nothing of client X', () => {
    const x = resolveScalars({
      splose: { ...SPLOSE, fullName: 'Xavier Ex', ndisNumber: '111111111' },
      profile: { ...PROFILE, preferred_name: 'Xav', primary_disability: 'Condition X' },
      currentPlan: PLAN, goals: [{ goalText: 'Goal of X' }], portal: PORTAL, server: SERVER,
    });
    const y = resolveScalars({
      splose: { ...SPLOSE, fullName: 'Yvonne Why', ndisNumber: '222222222' },
      profile: null, currentPlan: null, goals: [], portal: PORTAL, server: SERVER,
    });

    const yJson = JSON.stringify(y.scalarData);
    for (const leak of ['Xavier Ex', '111111111', 'Xav', 'Condition X', 'Goal of X']) {
      expect(yJson).not.toContain(leak);
    }
    expect(y.scalarData.OPAL_CLIENT_FULL_NAME).toBe('Yvonne Why');
    expect(y.scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('missing');
    expect(x.scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('Xav');
  });
});

// ── Manifest composition ─────────────────────────────────────────────────────

describe('manifest composition', () => {
  test('required sections cannot be deselected, server-side', () => {
    const { selectedSections } = normaliseSelection({ selectedSections: [] });
    for (const tag of tm.REQUIRED_SECTION_TAGS) expect(selectedSections).toContain(tag);

    const manifest = buildManifest({ selectedSections: [], sectionOrder: [], customSections: [] });
    for (const s of manifest.sections.filter((x) => x.kind === 'required')) {
      expect(s.included).toBe(true);
    }
    expect(tm.REQUIRED_SECTION_TAGS.length).toBe(7);
  });

  test('an unknown section tag is dropped rather than trusted', () => {
    const { selectedSections, sectionOrder } = normaliseSelection({
      selectedSections: ['OPAL_SECTION_DOMAIN_MOBILITY', 'OPAL_SECTION_NOT_REAL'],
      sectionOrder: ['OPAL_SECTION_NOT_REAL'],
    });
    expect(selectedSections).not.toContain('OPAL_SECTION_NOT_REAL');
    expect(sectionOrder).not.toContain('OPAL_SECTION_NOT_REAL');
  });

  test('optional sections are included only when selected', () => {
    const manifest = buildManifest({
      selectedSections: ['OPAL_SECTION_DOMAIN_MOBILITY'],
      sectionOrder: [], customSections: [],
    });
    const byTag = new Map(manifest.sections.map((s) => [s.tag, s]));
    expect(byTag.get('OPAL_SECTION_DOMAIN_MOBILITY').included).toBe(true);
    expect(byTag.get('OPAL_SECTION_DOMAIN_COGNITION').included).toBe(false);
    expect(byTag.get('OPAL_SECTION_APPENDICES').included).toBe(false);
  });

  test('ordering falls back to the template position for anything unplaced', () => {
    const { sectionOrder } = normaliseSelection({
      sectionOrder: ['OPAL_SECTION_APPENDICES', 'OPAL_SECTION_DOMAIN_MOBILITY'],
    });
    expect(sectionOrder[0]).toBe('OPAL_SECTION_APPENDICES');
    expect(sectionOrder[1]).toBe('OPAL_SECTION_DOMAIN_MOBILITY');
    expect(sectionOrder.length).toBe(tm.SECTIONS.length);
    expect(new Set(sectionOrder).size).toBe(tm.SECTIONS.length);
  });

  test('custom section tags are always server-minted', () => {
    let n = 0;
    const custom = normaliseCustomSections([
      { title: 'Fatigue and Daily Routines', guidance: 'Describe fatigue.' },
      // A client-supplied tag aimed at a real template control must not stick.
      { title: 'Hostile', tag: 'OPAL_SECTION_ASSESSMENT_RESULTS' },
    ], () => `id-${++n}`);

    expect(custom[0].tag).toMatch(/^OPAL_SECTION_CUSTOM_FATIGUE_AND_DAILY_ROUTINES_/);
    expect(custom[1].tag).not.toBe('OPAL_SECTION_ASSESSMENT_RESULTS');
    expect(custom[1].tag).toMatch(/^OPAL_SECTION_CUSTOM_HOSTILE_/);
  });

  test('custom sections are capped and trimmed', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ title: `Section ${i}` }));
    expect(normaliseCustomSections(many, () => 'x').length).toBe(tm.MAX_CUSTOM_SECTIONS);

    const [one] = normaliseCustomSections([{ title: 'T'.repeat(500), guidance: 'G'.repeat(2000) }], () => 'x');
    expect(one.title.length).toBe(tm.MAX_CUSTOM_TITLE_CHARS);
    expect(one.guidance.length).toBe(tm.MAX_CUSTOM_GUIDANCE_CHARS);

    // A section with no title is not a section.
    expect(normaliseCustomSections([{ title: '   ' }], () => 'x')).toEqual([]);
  });

  test('overrides for unknown tags are refused; a document-control override is not', () => {
    const clean = normaliseOverrides({
      OPAL_CLIENT_PRONOUNS: '  they/them  ',
      OPAL_REPORT_VERSION: '2.0',
      NOT_A_TAG: 'x',
      OPAL_CLIENT_ADDRESS: { nested: 'object' },
    });
    expect(clean.OPAL_CLIENT_PRONOUNS).toBe('they/them');
    // The four Opal issues itself are DEFAULTS, not decrees.
    expect(clean.OPAL_REPORT_VERSION).toBe('2.0');
    expect(clean).not.toHaveProperty('NOT_A_TAG');
    expect(clean).not.toHaveProperty('OPAL_CLIENT_ADDRESS');
  });

  test('the manifest carries values AND their sources, for one shared render', () => {
    const { scalarData, scalarSources } = full();
    const manifest = buildManifest({
      selectedSections: tm.OPTIONAL_SECTION_TAGS,
      sectionOrder: [],
      customSections: normaliseCustomSections([{ title: 'Fatigue' }], () => 'abc'),
      scalarData,
      scalarSources,
    });

    expect(manifest.scalarData.OPAL_CLIENT_FULL_NAME).toBe('Jane Citizen');
    expect(manifest.scalarSources.OPAL_CLIENT_FULL_NAME).toBe('splose');
    expect(manifest.sections.filter((s) => s.kind === 'custom')).toHaveLength(1);
    expect(manifest.sections.find((s) => s.kind === 'custom').title).toBe('Fatigue');
    // Every template section is described, included or not — the frontend never
    // has to work out what exists.
    expect(manifest.sections.filter((s) => s.kind !== 'custom')).toHaveLength(tm.SECTIONS.length);
  });
});

// ── Document control: issued, not looked up ──────────────────────────────────

describe('server-issued document control', () => {
  const DRAFT_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  test('a new draft is issued a reference, a date, version 1.0 and status Draft', () => {
    const issued = issueDocumentControl('FCA', DRAFT_ID, new Date(Date.UTC(2026, 7, 10)));
    expect(issued).toEqual({
      documentReference: 'FCA-1A2B3C4D',
      reportDate: '10/08/2026',   // Australian format, day first
      reportVersion: '1.0',
      reportStatus: 'Draft',
    });
  });

  test('the letter uses the same issuer with its own prefix', () => {
    expect(issueDocumentControl('LTR', DRAFT_ID, new Date()).documentReference)
      .toBe('LTR-1A2B3C4D');
    expect(documentReference('LTR', DRAFT_ID)).toBe('LTR-1A2B3C4D');
  });

  test('the stored value is read back verbatim — regenerating never renumbers', () => {
    const stored = {
      documentReference: 'FCA-1A2B3C4D',
      reportDate: '01/07/2026',
      reportVersion: '2.0',
      reportStatus: 'Final',
    };
    const row = { id: DRAFT_ID, created_at: '2026-08-10T00:00:00.000Z', document_control: stored };
    expect(documentControlFor('FCA', row)).toEqual(stored);
    // Twice, to make the point: reading is not minting.
    expect(documentControlFor('FCA', row)).toEqual(documentControlFor('FCA', row));
  });

  test('a draft created before this behaviour existed is not renumbered by the upgrade', () => {
    const legacy = { id: DRAFT_ID, created_at: '2026-08-10T00:00:00.000Z', document_control: {} };
    expect(documentControlFor('FCA', legacy)).toEqual({
      documentReference: 'FCA-1A2B3C4D',  // derived from the id it always had
      reportDate: '10/08/2026',           // derived from its own created_at
      reportVersion: '1.0',
      reportStatus: 'Draft',
    });
  });

  test('the issued values reach the resolver as source "server"', () => {
    const server = issueDocumentControl('FCA', DRAFT_ID, new Date(Date.UTC(2026, 7, 10)));
    const { scalarData, scalarSources, missingFields } = resolveScalars({
      splose: SPLOSE, portal: PORTAL, server,
    });
    expect(scalarData.OPAL_REPORT_DOCUMENT_ID).toBe('FCA-1A2B3C4D');
    expect(scalarData.OPAL_REPORT_DATE).toBe('10/08/2026');
    expect(scalarData.OPAL_REPORT_VERSION).toBe('1.0');
    expect(scalarData.OPAL_REPORT_STATUS).toBe('Draft');
    for (const tag of tm.SERVER_TAGS) {
      expect(scalarSources[tag]).toBe('server');
      expect(missingFields).not.toContain(tag);
    }
    // And the four real-world facts are still outstanding.
    expect(missingFields).toContain('OPAL_REPORT_ISSUE_DATE');
    expect(missingFields).toContain('OPAL_REPORT_REVIEWER_NAME');
    expect(missingFields).toContain('OPAL_REPORT_REVIEWER_ROLE');
    expect(missingFields).toContain('OPAL_REPORT_AUTHORISED_RECIPIENTS');
  });
});

// ── Excluded fields ──────────────────────────────────────────────────────────

describe('excluded fields', () => {
  test('every scalar tag may be excluded, including the ones Opal issues', () => {
    expect(new Set(tm.EXCLUDABLE_TAGS)).toEqual(new Set(tm.SCALAR_TAG_LIST));
    for (const tag of tm.SERVER_TAGS) expect(tm.EXCLUDABLE_TAGS).toContain(tag);
  });

  test('unknown tags are dropped rather than trusted, and duplicates collapse', () => {
    expect(normaliseExcludedFields([
      'OPAL_REPORT_REVIEWER_NAME',
      'NOT_A_TAG',
      '  OPAL_REPORT_REVIEWER_NAME  ',
      'OPAL_SECTION_APPENDICES', // a section tag is not a scalar tag
      42,
      null,
    ])).toEqual(['OPAL_REPORT_REVIEWER_NAME']);

    expect(normaliseExcludedFields(null)).toEqual([]);
    expect(normaliseExcludedFields('OPAL_REPORT_REVIEWER_NAME')).toEqual([]);
  });

  test('the manifest carries the exclusions, re-validated on the way in', () => {
    const { scalarData, scalarSources } = full();
    const manifest = buildManifest({
      selectedSections: [], sectionOrder: [], customSections: [],
      scalarData, scalarSources,
      // Deliberately unnormalised: the composer is the last gate before the
      // engine, so it must not trust what it is handed.
      excludedFields: ['OPAL_REPORT_REVIEWER_NAME', 'NOT_A_TAG'],
    });
    expect(manifest.excludedTags).toEqual(['OPAL_REPORT_REVIEWER_NAME']);
  });

  test('a manifest with no exclusions carries an empty list, never undefined', () => {
    const manifest = buildManifest({ selectedSections: [], sectionOrder: [], customSections: [] });
    expect(manifest.excludedTags).toEqual([]);
  });

  test('exclusion does not change resolution — it changes rendering', () => {
    // The resolver stays honest about where a value came from. What happens to
    // an excluded value is the ENGINE's business, which is what makes
    // un-excluding restore the resolved value with no extra machinery.
    const { scalarData, scalarSources } = full({ OPAL_REPORT_REVIEWER_NAME: 'Dr Reviewer' });
    expect(scalarData.OPAL_REPORT_REVIEWER_NAME).toBe('Dr Reviewer');
    expect(scalarSources.OPAL_REPORT_REVIEWER_NAME).toBe('report_override');
  });
});
