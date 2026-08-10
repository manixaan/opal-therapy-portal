'use strict';

/**
 * FCA REPORT BUILDER — pure helpers (node).
 *
 * fca.js exports its side-effect-free helpers before it touches the DOM (the
 * same shape as casenotes.js / supportpop.js), so the rules that decide what a
 * therapist is told about a clinical report can be tested without a browser.
 *
 * The rules that actually matter here:
 *   - SOURCE ATTRIBUTION IS THE SERVER'S, NOT OURS. The badge label mapping is
 *     exact, total, and closed: four labels, and anything unrecognised is
 *     'Missing' rather than an optimistic guess about where a value came from.
 *   - A VALUE IS NEVER INVENTED. A blank is reported as missing; a missing
 *     field never acquires a value on the way to the screen.
 *   - SAVE-TO-PROFILE IS NARROW. Only server-declared profile-eligible tags
 *     that the THERAPIST entered on THIS report may be offered — never a
 *     Splose value, never something already on the profile, never a blank.
 *   - REQUIRED SECTIONS SURVIVE EVERYTHING. No preset, however stale or
 *     hostile, can deselect a required section or select a tag the template
 *     does not have.
 */

const {
  fcaEsc,
  fcaHumanise,
  fcaGroupKey,
  fcaGroupLabel,
  fcaGroupSections,
  fcaNormaliseOrder,
  fcaMoveTag,
  fcaReorderTo,
  fcaApplyPreset,
  fcaDefaultSelection,
  fcaTagGroup,
  fcaTagLabel,
  fcaSourceKey,
  fcaSourceLabel,
  fcaFieldGroupLabel,
  fcaScalarModel,
  fcaProfileSavableFields,
  fcaMissingSummary,
  fcaPreviewModel,
  fcaSanitiseFilePart,
  fcaFilenamePreview,
  fcaSectionCounts,
  FCA_SOURCE_LABELS,
  FCA_SOURCE_ORDER,
} = require('../../frontend/current/fca.js');

// A miniature template shaped exactly like GET /api/fca/template returns.
const SECTIONS = [
  { tag: 'OPAL_SECTION_PARTICIPANT_DETAILS', group: 'core', label: 'Participant details', required: true, defaultSelected: true, defaultOrder: 1 },
  { tag: 'OPAL_SECTION_ASSESSMENT_METHOD', group: 'core', label: 'Assessment method', required: true, defaultSelected: true, defaultOrder: 2 },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_WHODAS', group: 'assessment_tool', label: 'WHODAS 2.0', required: false, defaultSelected: true, defaultOrder: 3 },
  { tag: 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA', group: 'assessment_tool', label: 'MoCA', required: false, defaultSelected: false, defaultOrder: 4 },
  { tag: 'OPAL_SECTION_DOMAIN_MOBILITY', group: 'domain', label: 'Mobility', required: false, defaultSelected: true, defaultOrder: 5 },
  { tag: 'OPAL_SECTION_APPENDICES', group: 'appendix', label: 'Appendices', required: false, defaultSelected: false, defaultOrder: 6 },
];

describe('fcaEsc', () => {
  test('escapes every HTML-significant character', () => {
    expect(fcaEsc('<img src=x onerror="alert(1)">'))
      .toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(fcaEsc("O'Brien & Sons")).toBe('O&#39;Brien &amp; Sons');
  });

  test('null and undefined render as empty, never as the words', () => {
    expect(fcaEsc(null)).toBe('');
    expect(fcaEsc(undefined)).toBe('');
    expect(fcaEsc(0)).toBe('0');
  });
});

describe('source badge labels — the four exact strings, and nothing else', () => {
  test('the mapping is exactly the four contract labels', () => {
    expect(FCA_SOURCE_LABELS).toEqual({
      splose: 'Splose',
      client_profile: 'Opal client profile',
      report_override: 'Entered for this report',
      missing: 'Missing',
    });
    expect(FCA_SOURCE_ORDER).toEqual(['splose', 'client_profile', 'report_override', 'missing']);
  });

  test('each layer maps to its own label', () => {
    expect(fcaSourceLabel('splose')).toBe('Splose');
    expect(fcaSourceLabel('client_profile')).toBe('Opal client profile');
    expect(fcaSourceLabel('report_override')).toBe('Entered for this report');
    expect(fcaSourceLabel('missing')).toBe('Missing');
  });

  test('an unknown, empty or absent origin degrades to Missing — never to a guess', () => {
    ['', null, undefined, 'splose_maybe', 'guessed', 'SPLOSE_V2', 42].forEach((v) => {
      expect(fcaSourceLabel(v)).toBe('Missing');
      expect(fcaSourceKey(v)).toBe('missing');
    });
  });

  test('recognised origins are case- and whitespace-tolerant', () => {
    expect(fcaSourceKey(' Splose ')).toBe('splose');
    expect(fcaSourceKey('CLIENT_PROFILE')).toBe('client_profile');
  });
});

describe('field grouping (step 3 buckets)', () => {
  test('tags fall into Client / Therapist / Report by their template prefix', () => {
    expect(fcaTagGroup('OPAL_CLIENT_NDIS_NUMBER')).toBe('client');
    expect(fcaTagGroup('OPAL_THERAPIST_FULL_NAME')).toBe('therapist');
    expect(fcaTagGroup('OPAL_REPORT_DATE')).toBe('report');
    expect(fcaFieldGroupLabel('client')).toBe('Client');
    expect(fcaFieldGroupLabel('therapist')).toBe('Therapist');
    expect(fcaFieldGroupLabel('report')).toBe('Report');
  });

  test('labels are derived from the tag, so a new template tag still reads well', () => {
    expect(fcaTagLabel('OPAL_CLIENT_NDIS_NUMBER')).toBe('NDIS number');
    expect(fcaTagLabel('OPAL_CLIENT_DATE_OF_BIRTH')).toBe('Date of birth');
    expect(fcaTagLabel('OPAL_REPORT_DOCUMENT_ID')).toBe('Document ID');
    expect(fcaTagLabel('OPAL_CLIENT_SOME_FUTURE_FIELD')).toBe('Some future field');
  });

  test('humanise turns a server key into prose without inventing words', () => {
    expect(fcaHumanise('my_new_group')).toBe('My new group');
    expect(fcaHumanise('')).toBe('');
  });
});

describe('fcaScalarModel — value and origin, straight from the manifest', () => {
  const manifest = {
    scalarData: {
      OPAL_CLIENT_FULL_NAME: 'Jordan Lee',
      OPAL_CLIENT_PRONOUNS: 'they/them',
      OPAL_CLIENT_PRIMARY_DISABILITY: 'Acquired brain injury',
      OPAL_CLIENT_DATE_OF_BIRTH: null,
      OPAL_THERAPIST_FULL_NAME: 'Ann Mathew',
      OPAL_REPORT_DATE: '2026-08-10',
    },
    scalarSources: {
      OPAL_CLIENT_FULL_NAME: 'splose',
      OPAL_CLIENT_PRONOUNS: 'client_profile',
      OPAL_CLIENT_PRIMARY_DISABILITY: 'report_override',
      OPAL_CLIENT_DATE_OF_BIRTH: 'missing',
      OPAL_THERAPIST_FULL_NAME: 'splose',
      OPAL_REPORT_DATE: 'splose',
    },
  };

  function field(groups, tag) {
    return groups.reduce((acc, g) => acc.concat(g.fields), []).find((f) => f.tag === tag);
  }

  test('groups appear in Client, Therapist, Report order', () => {
    const groups = fcaScalarModel(manifest, []);
    expect(groups.map((g) => g.key)).toEqual(['client', 'therapist', 'report']);
    expect(groups.map((g) => g.label)).toEqual(['Client', 'Therapist', 'Report']);
  });

  test('each field carries the server origin verbatim as its badge label', () => {
    const groups = fcaScalarModel(manifest, []);
    expect(field(groups, 'OPAL_CLIENT_FULL_NAME').sourceLabel).toBe('Splose');
    expect(field(groups, 'OPAL_CLIENT_PRONOUNS').sourceLabel).toBe('Opal client profile');
    expect(field(groups, 'OPAL_CLIENT_PRIMARY_DISABILITY').sourceLabel).toBe('Entered for this report');
    expect(field(groups, 'OPAL_CLIENT_DATE_OF_BIRTH').sourceLabel).toBe('Missing');
  });

  test('a missing field has a null value — it never carries a substitute', () => {
    const f = field(fcaScalarModel(manifest, []), 'OPAL_CLIENT_DATE_OF_BIRTH');
    expect(f.missing).toBe(true);
    expect(f.value).toBeNull();
  });

  test('a blank string is missing even when the server labelled it a real layer', () => {
    const groups = fcaScalarModel({
      scalarData: { OPAL_CLIENT_ADDRESS: '   ' },
      scalarSources: { OPAL_CLIENT_ADDRESS: 'splose' },
    }, []);
    const f = field(groups, 'OPAL_CLIENT_ADDRESS');
    expect(f.missing).toBe(true);
    expect(f.value).toBeNull();
    expect(f.sourceLabel).toBe('Missing');
  });

  test('a tag with no origin at all is reported missing when blank', () => {
    const groups = fcaScalarModel({ scalarData: { OPAL_CLIENT_EMAIL: null }, scalarSources: {} }, []);
    expect(field(groups, 'OPAL_CLIENT_EMAIL').sourceLabel).toBe('Missing');
  });

  test('profile eligibility is flagged from the template list only', () => {
    const groups = fcaScalarModel(manifest, ['OPAL_CLIENT_PRONOUNS', 'OPAL_CLIENT_PRIMARY_DISABILITY']);
    expect(field(groups, 'OPAL_CLIENT_PRONOUNS').profileEligible).toBe(true);
    expect(field(groups, 'OPAL_CLIENT_FULL_NAME').profileEligible).toBe(false);
  });

  test('an absent manifest yields no fields rather than an invented shape', () => {
    expect(fcaScalarModel(null, [])).toEqual([]);
    expect(fcaScalarModel({}, [])).toEqual([]);
  });
});

describe('fcaProfileSavableFields — explicit, narrow, and never presumptuous', () => {
  const manifest = {
    scalarData: {
      OPAL_CLIENT_FULL_NAME: 'Jordan Lee',
      OPAL_CLIENT_PRONOUNS: 'they/them',
      OPAL_CLIENT_PRIMARY_DISABILITY: 'Acquired brain injury',
      OPAL_CLIENT_DATE_OF_BIRTH: null,
      OPAL_REPORT_REVIEWER_NAME: 'Dr Patel',
    },
    scalarSources: {
      OPAL_CLIENT_FULL_NAME: 'splose',
      OPAL_CLIENT_PRONOUNS: 'client_profile',
      OPAL_CLIENT_PRIMARY_DISABILITY: 'report_override',
      OPAL_CLIENT_DATE_OF_BIRTH: 'missing',
      OPAL_REPORT_REVIEWER_NAME: 'report_override',
    },
  };
  const ELIGIBLE = [
    'OPAL_CLIENT_PRONOUNS',
    'OPAL_CLIENT_PRIMARY_DISABILITY',
    'OPAL_CLIENT_DATE_OF_BIRTH',
    'OPAL_CLIENT_FULL_NAME',
  ];

  test('offers only what the therapist entered on this report', () => {
    expect(fcaProfileSavableFields(manifest, ELIGIBLE).map((f) => f.tag))
      .toEqual(['OPAL_CLIENT_PRIMARY_DISABILITY']);
  });

  test('a Splose value is never offered, even when the tag is eligible', () => {
    const tags = fcaProfileSavableFields(manifest, ELIGIBLE).map((f) => f.tag);
    expect(tags).not.toContain('OPAL_CLIENT_FULL_NAME');
  });

  test('a value already on the profile is never re-offered', () => {
    const tags = fcaProfileSavableFields(manifest, ELIGIBLE).map((f) => f.tag);
    expect(tags).not.toContain('OPAL_CLIENT_PRONOUNS');
  });

  test('a missing field is never offered — there is nothing to save', () => {
    const tags = fcaProfileSavableFields(manifest, ELIGIBLE).map((f) => f.tag);
    expect(tags).not.toContain('OPAL_CLIENT_DATE_OF_BIRTH');
  });

  test('a report-specific tag is never offered even if entered for this report', () => {
    // The reviewer name IS a report_override, but the server never lists it as
    // profile-eligible — so the UI must not offer it.
    const tags = fcaProfileSavableFields(manifest, ELIGIBLE).map((f) => f.tag);
    expect(tags).not.toContain('OPAL_REPORT_REVIEWER_NAME');
  });

  test('with no eligible list from the server, nothing is offered at all', () => {
    expect(fcaProfileSavableFields(manifest, [])).toEqual([]);
    expect(fcaProfileSavableFields(manifest, null)).toEqual([]);
  });
});

describe('section grouping', () => {
  test('sections land in the documented buckets, required first', () => {
    const groups = fcaGroupSections(SECTIONS);
    expect(groups.map((g) => g.key)).toEqual(['required', 'tools', 'domains', 'appendices']);
    expect(groups[0].label).toBe('Required report framework');
    expect(groups[1].label).toBe('Assessment tools');
    expect(groups[2].label).toBe('Functional domains');
    expect(groups[3].label).toBe('Appendices');
  });

  test('required wins over the server group key, so it can never look optional', () => {
    expect(fcaGroupKey({ tag: 'X', group: 'domain', required: true })).toBe('required');
    expect(fcaGroupKey({ tag: 'X', kind: 'required', group: 'appendix' })).toBe('required');
  });

  test('an unknown server group is shown, not silently dropped', () => {
    const groups = fcaGroupSections(SECTIONS.concat([
      { tag: 'OPAL_SECTION_NEW_THING', group: 'brand_new_group', label: 'New thing', required: false, defaultOrder: 9 },
    ]));
    const keys = groups.map((g) => g.key);
    expect(keys).toContain('brand_new_group');
    expect(fcaGroupLabel('brand_new_group')).toBe('Brand new group');
    const total = groups.reduce((n, g) => n + g.sections.length, 0);
    expect(total).toBe(SECTIONS.length + 1);
  });

  test('the recommendations bucket keeps its contract label', () => {
    expect(fcaGroupLabel('recommendations')).toBe('Recommendation groups');
    expect(fcaGroupLabel('custom')).toBe('Custom sections');
  });
});

describe('order normalisation', () => {
  test('produces a total, duplicate-free order over every known tag', () => {
    const order = fcaNormaliseOrder(['OPAL_SECTION_DOMAIN_MOBILITY'], SECTIONS);
    expect(order[0]).toBe('OPAL_SECTION_DOMAIN_MOBILITY');
    expect(order.length).toBe(SECTIONS.length);
    expect(new Set(order).size).toBe(SECTIONS.length);
  });

  test('drops tags the template no longer has and appends ones it gained', () => {
    const order = fcaNormaliseOrder(
      ['OPAL_SECTION_RETIRED', 'OPAL_SECTION_APPENDICES', 'OPAL_SECTION_APPENDICES'], SECTIONS);
    expect(order).not.toContain('OPAL_SECTION_RETIRED');
    expect(order[0]).toBe('OPAL_SECTION_APPENDICES');
    expect(order.length).toBe(SECTIONS.length);
  });

  test('an empty stored order falls back to the template default order', () => {
    expect(fcaNormaliseOrder([], SECTIONS)).toEqual(SECTIONS.map((s) => s.tag));
    expect(fcaNormaliseOrder(null, SECTIONS)).toEqual(SECTIONS.map((s) => s.tag));
  });
});

describe('reordering (drag and keyboard share one implementation)', () => {
  const order = ['a', 'b', 'c', 'd'];

  test('move up and down shift by one without mutating the input', () => {
    expect(fcaMoveTag(order, 'c', -1)).toEqual(['a', 'c', 'b', 'd']);
    expect(fcaMoveTag(order, 'b', 1)).toEqual(['a', 'c', 'b', 'd']);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });

  test('moves off either end are no-ops', () => {
    expect(fcaMoveTag(order, 'a', -1)).toEqual(order);
    expect(fcaMoveTag(order, 'd', 1)).toEqual(order);
    expect(fcaMoveTag(order, 'missing', -1)).toEqual(order);
  });

  test('a drop places the tag immediately before its target', () => {
    expect(fcaReorderTo(order, 'd', 'b')).toEqual(['a', 'd', 'b', 'c']);
    expect(fcaReorderTo(order, 'a', null)).toEqual(['b', 'c', 'd', 'a']);
    expect(fcaReorderTo(order, 'b', 'b')).toEqual(order);
  });
});

describe('presets', () => {
  test('defaults come from the template, never from a local opinion', () => {
    expect(fcaDefaultSelection(SECTIONS)).toEqual([
      'OPAL_SECTION_PARTICIPANT_DETAILS',
      'OPAL_SECTION_ASSESSMENT_METHOD',
      'OPAL_SECTION_ASSESSMENT_TOOL_WHODAS',
      'OPAL_SECTION_DOMAIN_MOBILITY',
    ]);
  });

  test('a preset that omits required sections still selects them', () => {
    const out = fcaApplyPreset({ selectedSections: ['OPAL_SECTION_APPENDICES'] }, SECTIONS, []);
    expect(out.selectedSections).toContain('OPAL_SECTION_PARTICIPANT_DETAILS');
    expect(out.selectedSections).toContain('OPAL_SECTION_ASSESSMENT_METHOD');
    expect(out.selectedSections).toContain('OPAL_SECTION_APPENDICES');
  });

  test('a stale preset cannot select a tag the template does not have', () => {
    const out = fcaApplyPreset({ selectedSections: ['OPAL_SECTION_GONE'] }, SECTIONS, []);
    expect(out.selectedSections).not.toContain('OPAL_SECTION_GONE');
  });

  test("the draft's own custom sections survive a preset", () => {
    const custom = [{ id: 'c1', tag: 'OPAL_SECTION_CUSTOM_SENSORY_ABC', title: 'Sensory profile', order: 0 }];
    const out = fcaApplyPreset({ selectedSections: [] }, SECTIONS, custom);
    expect(out.selectedSections).toContain('OPAL_SECTION_CUSTOM_SENSORY_ABC');
    expect(out.sectionOrder).toContain('OPAL_SECTION_CUSTOM_SENSORY_ABC');
  });

  test('an empty or malformed preset degrades to required-only, not a crash', () => {
    expect(fcaApplyPreset(null, SECTIONS, null).selectedSections).toEqual([
      'OPAL_SECTION_PARTICIPANT_DETAILS',
      'OPAL_SECTION_ASSESSMENT_METHOD',
    ]);
  });
});

describe('missing-field summary', () => {
  test('combines the server list with anything blank in the manifest', () => {
    const s = fcaMissingSummary(['OPAL_CLIENT_PRONOUNS'], {
      OPAL_CLIENT_FULL_NAME: 'Jordan Lee',
      OPAL_CLIENT_ADDRESS: '',
      OPAL_THERAPIST_AHPRA_NUMBER: null,
    });
    expect(s.count).toBe(3);
    expect(s.tags).toEqual(expect.arrayContaining([
      'OPAL_CLIENT_PRONOUNS', 'OPAL_CLIENT_ADDRESS', 'OPAL_THERAPIST_AHPRA_NUMBER']));
    expect(s.tags).not.toContain('OPAL_CLIENT_FULL_NAME');
  });

  test('never double-counts a tag the server already flagged', () => {
    const s = fcaMissingSummary(['OPAL_CLIENT_ADDRESS'], { OPAL_CLIENT_ADDRESS: '' });
    expect(s.count).toBe(1);
  });

  test('nothing missing is reported as nothing, not as an empty placeholder', () => {
    const s = fcaMissingSummary([], { OPAL_CLIENT_FULL_NAME: 'Jordan Lee' });
    expect(s.count).toBe(0);
    expect(s.groups).toEqual([]);
  });
});

describe('preview model — built from the manifest, or not at all', () => {
  const draft = {
    clientName: 'Jordan Lee',
    therapistName: 'Ann Mathew',
    templateVersion: '1.0.0',
    manifest: {
      scalarData: { OPAL_CLIENT_FULL_NAME: 'Jordan Lee' },
      scalarSources: { OPAL_CLIENT_FULL_NAME: 'splose' },
      sections: [
        { tag: 'A', kind: 'required', group: 'core', title: 'Participant details', included: true, order: 0 },
        { tag: 'B', kind: 'optional', group: 'domain', title: 'Mobility', included: false, order: 1 },
        { tag: 'C', kind: 'custom', group: 'custom', title: 'Sensory profile', included: true, order: 2 },
      ],
    },
  };

  test('splits included from excluded and preserves manifest order', () => {
    const m = fcaPreviewModel(draft);
    expect(m.ready).toBe(true);
    expect(m.included.map((s) => s.tag)).toEqual(['A', 'C']);
    expect(m.excluded.map((s) => s.tag)).toEqual(['B']);
    expect(m.customCount).toBe(1);
  });

  test('with no manifest the preview is not ready — it does not reconstruct one', () => {
    expect(fcaPreviewModel({ clientName: 'Jordan Lee' }).ready).toBe(false);
    expect(fcaPreviewModel({ clientName: 'Jordan Lee' }).included).toEqual([]);
    expect(fcaPreviewModel(null).ready).toBe(false);
  });

  test('the preview reuses the same scalar model, so badges cannot disagree', () => {
    const m = fcaPreviewModel(draft);
    expect(m.scalarGroups[0].fields[0].sourceLabel).toBe('Splose');
  });

  test('section counts feed the generate confirmation honestly', () => {
    const c = fcaSectionCounts(draft.manifest);
    expect(c).toEqual({ total: 3, included: 2, excluded: 1, required: 1, optional: 0, custom: 1 });
    expect(fcaSectionCounts(null).total).toBe(0);
  });
});

describe('filename preview', () => {
  test('is a readable, filesystem-safe expectation', () => {
    expect(fcaFilenamePreview({ clientName: 'Jordan Lee' }, new Date('2026-08-10T02:00:00Z')))
      .toBe('FCA-Report_Jordan-Lee_2026-08-10.docx');
  });

  test('strips characters a filesystem would choke on', () => {
    expect(fcaSanitiseFilePart('O\'Brien / Smith*?')).toBe('O-Brien-Smith');
    expect(fcaSanitiseFilePart('')).toBe('');
  });

  test('an unknown client simply drops out rather than becoming a placeholder', () => {
    const name = fcaFilenamePreview({}, new Date('2026-08-10T02:00:00Z'));
    expect(name).toBe('FCA-Report_2026-08-10.docx');
    expect(name).not.toMatch(/undefined|null|unknown/i);
  });
});
