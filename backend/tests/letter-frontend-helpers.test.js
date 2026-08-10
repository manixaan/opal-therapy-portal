'use strict';

/**
 * PROGRESS NOTE LETTER BUILDER — pure helpers (node).
 *
 * letter.js exports its side-effect-free helpers before it touches the DOM
 * (the same shape as fca.js / casenotes.js), so the rules that decide what a
 * therapist is told about a clinical letter can be tested without a browser.
 *
 * The rules that actually matter here:
 *   - SOURCE ATTRIBUTION IS THE SERVER'S, NOT OURS. The badge mapping is
 *     exact, total and closed. The server's documented superset is
 *     splose | client_profile | report_override | missing | portal | server;
 *     'portal' splits by the tag's own group so the badge names the screen
 *     the therapist would go and edit, and anything unrecognised is 'Missing'
 *     rather than an optimistic guess about where a value came from.
 *   - DATES ARE AUSTRALIAN, ALWAYS. Day first on entry and in the letter.
 *     03/04/2026 is the third of April and can never be read as 4 March.
 *   - A VALUE IS NEVER INVENTED. A blank is reported as missing; a missing
 *     field never acquires a value on the way to the screen.
 *   - THE TWO REQUIRED BLOCKS SURVIVE EVERYTHING. No selection, however
 *     stale or hostile, can drop a required block from the letter.
 *   - THE PREVIEW IS THE MANIFEST. No manifest means no preview — never a
 *     locally invented letter that disagrees with the DOCX.
 */

const {
  ltrEsc,
  ltrHumanise,
  ltrTagGroup,
  ltrTagLabel,
  ltrSourceKey,
  ltrSourceLabel,
  ltrFormatAUDate,
  ltrLongAUDate,
  ltrParseAUDate,
  ltrTodayISO,
  ltrGroupBlocks,
  ltrDefaultSelection,
  ltrEnforceRequired,
  ltrNormaliseCustom,
  ltrMoveCustom,
  ltrContactSourceLabel,
  ltrSuggestSalutation,
  ltrCcSummary,
  ltrFieldGroupLabel,
  ltrScalarModel,
  ltrScalarFields,
  ltrPreviewModel,
  ltrBlockCounts,
  ltrRequiredScalarTags,
  ltrBlockingIssues,
  ltrMissingSummary,
  ltrSanitiseFilePart,
  ltrFilenamePreview,
  LTR_SOURCE_LABELS,
  LTR_SOURCE_ORDER,
  LTR_CONTACT_TARGETS,
} = require('../../frontend/current/letter.js');

// A miniature template shaped exactly like GET /api/letters/template returns,
// carrying the real contract: two required blocks, three optional ones on by
// default. Tag names here are the fixture's, not the front end's — letter.js
// itself contains no template tag at all.
const SECTIONS = [
  { tag: 'OPAL_SECTION_LETTER_PURPOSE_CONTEXT', label: 'Purpose and context', description: 'Why the letter is being written.', required: true, defaultSelected: true, defaultOrder: 1 },
  { tag: 'OPAL_SECTION_LETTER_PROGRESS_UPDATE', label: 'Therapy and progress update', description: 'What has happened since the last update.', required: true, defaultSelected: true, defaultOrder: 2 },
  { tag: 'OPAL_SECTION_LETTER_CURRENT_PRESENTATION', label: 'Current presentation and support needs', description: 'How the participant presents now.', required: false, defaultSelected: true, defaultOrder: 3 },
  { tag: 'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS', label: 'Clinical opinion and recommendations', description: 'Your clinical view.', required: false, defaultSelected: true, defaultOrder: 4 },
  { tag: 'OPAL_SECTION_LETTER_NEXT_STEPS', label: 'Next steps and review', description: 'What happens next.', required: false, defaultSelected: true, defaultOrder: 5 },
];

const REQUIRED_TAGS = [
  'OPAL_SECTION_LETTER_PURPOSE_CONTEXT',
  'OPAL_SECTION_LETTER_PROGRESS_UPDATE',
];

function manifest(extra) {
  return Object.assign({
    scalarData: {
      OPAL_CLIENT_FULL_NAME: 'Jordan Fielding',
      OPAL_CLIENT_NDIS_NUMBER: '430011223',
      OPAL_CLIENT_PREFERRED_NAME: '',
      OPAL_THERAPIST_FULL_NAME: 'Ana Ruiz',
      OPAL_THERAPIST_ROLE: 'Occupational Therapist',
      OPAL_ORGANISATION_EMAIL: 'hello@example.org',
      OPAL_LETTER_DOCUMENT_ID: 'OPL-2026-0007',
    },
    scalarSources: {
      OPAL_CLIENT_FULL_NAME: 'splose',
      OPAL_CLIENT_NDIS_NUMBER: 'client_profile',
      OPAL_CLIENT_PREFERRED_NAME: 'missing',
      OPAL_THERAPIST_FULL_NAME: 'portal',
      OPAL_THERAPIST_ROLE: 'report_override',
      OPAL_ORGANISATION_EMAIL: 'portal',
      OPAL_LETTER_DOCUMENT_ID: 'server',
    },
    sections: [
      { tag: REQUIRED_TAGS[0], kind: 'required', title: 'Purpose and context', included: true, order: 0 },
      { tag: REQUIRED_TAGS[1], kind: 'required', title: 'Therapy and progress update', included: true, order: 1 },
      { tag: 'OPAL_SECTION_LETTER_NEXT_STEPS', kind: 'optional', title: 'Next steps and review', included: false, order: 2 },
      { tag: 'custom-1', kind: 'custom', title: 'Equipment trial', included: true, order: 3 },
    ],
  }, extra || {});
}

function draft(extra) {
  return Object.assign({
    id: 'd1',
    documentType: 'progress_note_letter',
    clientId: 'c1',
    clientName: 'Jordan Fielding',
    clientPreferredName: 'Jordy',
    therapistName: 'Ana Ruiz',
    templateVersion: 'v1',
    recipient: { name: 'Priya Nand', role: 'Support Coordinator', organisation: 'Horizon', address: 'Level 2\n14 Wattle St\nHobart TAS 7000', salutation: 'Dear Priya' },
    ccRecipients: [{ name: 'Sam Cole', organisation: 'Horizon' }],
    letterDetails: { letterDate: '2026-08-10', subject: 'OT progress update', reportingPeriod: 'April to June 2026', documentId: 'OPL-2026-0007' },
    selectedSections: REQUIRED_TAGS.concat(['OPAL_SECTION_LETTER_NEXT_STEPS']),
    customSections: [{ id: 'custom-1', tag: 'custom-1', label: 'Equipment trial', guidance: 'Note the shower chair trial.', order: 0 }],
    manifest: manifest(),
    missingFields: ['OPAL_CLIENT_PREFERRED_NAME'],
  }, extra || {});
}

// ══ Escaping ═══════════════════════════════════════════════════════════════

describe('escaping', () => {
  test('every HTML-significant character is neutralised', () => {
    expect(ltrEsc('<script>"x"&\'y\'</script>'))
      .toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
  });
  test('null and undefined become an empty string, never the word "null"', () => {
    expect(ltrEsc(null)).toBe('');
    expect(ltrEsc(undefined)).toBe('');
  });
  test('humanise title-cases a server key without inventing words', () => {
    expect(ltrHumanise('saved_contact')).toBe('Saved contact');
    expect(ltrHumanise('')).toBe('');
  });
});

// ══ Tag derivation ═════════════════════════════════════════════════════════

describe('tag derivation', () => {
  test('the group is the first segment after the OPAL prefix', () => {
    expect(ltrTagGroup('OPAL_CLIENT_FULL_NAME')).toBe('client');
    expect(ltrTagGroup('OPAL_ORGANISATION_EMAIL')).toBe('organisation');
    expect(ltrTagGroup('OPAL_THERAPIST_ROLE')).toBe('therapist');
    expect(ltrTagGroup('')).toBe('other');
  });
  test('labels are derived from the tag, with acronyms kept upper case', () => {
    expect(ltrTagLabel('OPAL_CLIENT_NDIS_NUMBER')).toBe('NDIS number');
    expect(ltrTagLabel('OPAL_LETTER_DOCUMENT_ID')).toBe('Document ID');
    expect(ltrTagLabel('OPAL_THERAPIST_AHPRA_REGISTRATION')).toBe('AHPRA registration');
  });
  test('group labels cover the letter\'s own groups and degrade gracefully', () => {
    expect(ltrFieldGroupLabel('client')).toBe('Participant');
    expect(ltrFieldGroupLabel('organisation')).toBe('Organisation');
    expect(ltrFieldGroupLabel('something_new')).toBe('Something new');
  });
});

// ══ Source badge mapping ═══════════════════════════════════════════════════

describe('source badge labels', () => {
  test('the six contract labels are exactly what the legend offers', () => {
    expect(LTR_SOURCE_ORDER.map((k) => LTR_SOURCE_LABELS[k])).toEqual([
      'Splose',
      'Opal client profile',
      'Therapist profile',
      'Organisation settings',
      'Entered for this letter',
      'Missing',
    ]);
  });

  test('each documented server origin maps to exactly one label', () => {
    expect(ltrSourceLabel('splose', 'OPAL_CLIENT_FULL_NAME')).toBe('Splose');
    expect(ltrSourceLabel('client_profile', 'OPAL_CLIENT_NDIS_NUMBER')).toBe('Opal client profile');
    expect(ltrSourceLabel('report_override', 'OPAL_THERAPIST_ROLE')).toBe('Entered for this letter');
    expect(ltrSourceLabel('missing', 'OPAL_CLIENT_PREFERRED_NAME')).toBe('Missing');
  });

  test('"portal" is split by tag prefix — therapist profile vs organisation settings', () => {
    expect(ltrSourceLabel('portal', 'OPAL_THERAPIST_FULL_NAME')).toBe('Therapist profile');
    expect(ltrSourceLabel('portal', 'OPAL_THERAPIST_ROLE')).toBe('Therapist profile');
    expect(ltrSourceLabel('portal', 'OPAL_ORGANISATION_ADDRESS')).toBe('Organisation settings');
    expect(ltrSourceLabel('portal', 'OPAL_ORGANISATION_WEBSITE')).toBe('Organisation settings');
    expect(ltrSourceKey('portal', 'OPAL_ORGANISATION_PHONE')).toBe('portal_organisation');
  });

  test('"server" reads as generated by Opal, and is kept out of the legend', () => {
    expect(ltrSourceLabel('server', 'OPAL_LETTER_DOCUMENT_ID')).toBe('Generated by Opal');
    expect(LTR_SOURCE_ORDER).not.toContain('server');
  });

  test('an origin the server does not name is Missing, never a guess', () => {
    ['', null, undefined, 'made_up', 'SPLOSE_ISH', 42].forEach((v) => {
      expect(ltrSourceLabel(v, 'OPAL_CLIENT_FULL_NAME')).toBe('Missing');
    });
  });

  test('the mapping is case- and whitespace-tolerant, not case-fragile', () => {
    expect(ltrSourceLabel('  Splose ', 'OPAL_CLIENT_FULL_NAME')).toBe('Splose');
    expect(ltrSourceLabel('PORTAL', 'OPAL_ORGANISATION_EMAIL')).toBe('Organisation settings');
  });
});

// ══ Australian dates ═══════════════════════════════════════════════════════

describe('Australian date formatting', () => {
  test('ISO renders day first, zero padded', () => {
    expect(ltrFormatAUDate('2026-08-10')).toBe('10/08/2026');
    expect(ltrFormatAUDate('2026-04-03')).toBe('03/04/2026');
  });

  test('the letter itself carries the long Australian form', () => {
    expect(ltrLongAUDate('2026-08-10')).toBe('10 August 2026');
    expect(ltrLongAUDate('2026-01-01')).toBe('1 January 2026');
  });

  test('typed dates are read day first — 03/04/2026 is 3 April, never 4 March', () => {
    expect(ltrParseAUDate('03/04/2026')).toBe('2026-04-03');
    expect(ltrParseAUDate('3/4/2026')).toBe('2026-04-03');
    expect(ltrParseAUDate('31-12-2026')).toBe('2026-12-31');
  });

  test('a US-order date is not silently reinterpreted — it is rejected', () => {
    // There is no month 13, so a US typist gets an error rather than a wrong
    // letter date sitting quietly in a clinical document.
    expect(ltrParseAUDate('12/25/2026')).toBeNull();
    expect(ltrParseAUDate('2026-08-10')).toBeNull(); // ISO is not the entry format
  });

  test('impossible and half-typed dates return null rather than rolling over', () => {
    expect(ltrParseAUDate('31/02/2026')).toBeNull();
    expect(ltrParseAUDate('00/04/2026')).toBeNull();
    expect(ltrParseAUDate('3/4/26')).toBeNull();   // two-digit years are never assumed
    expect(ltrParseAUDate('3/4/')).toBeNull();
    expect(ltrParseAUDate('')).toBeNull();
  });

  test('an unparseable value formats to nothing — never to today', () => {
    expect(ltrFormatAUDate('')).toBe('');
    expect(ltrFormatAUDate(null)).toBe('');
    expect(ltrFormatAUDate('not a date')).toBe('');
    expect(ltrLongAUDate('not a date')).toBe('');
  });

  test('today is produced in ISO for the server, from local parts', () => {
    expect(ltrTodayISO(new Date(2026, 7, 10))).toBe('2026-08-10');
    expect(ltrTodayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

// ══ Block grouping and required blocks ═════════════════════════════════════

describe('block grouping', () => {
  test('two buckets only — always included, then optional', () => {
    const groups = ltrGroupBlocks(SECTIONS);
    expect(groups.map((g) => g.key)).toEqual(['required', 'optional']);
    expect(groups[0].label).toBe('Always included');
    expect(groups[0].locked).toBe(true);
    expect(groups[1].locked).toBe(false);
  });

  test('the two required blocks are in the locked bucket, the three optional ones are not', () => {
    const groups = ltrGroupBlocks(SECTIONS);
    expect(groups[0].sections.map((s) => s.tag)).toEqual(REQUIRED_TAGS);
    expect(groups[1].sections).toHaveLength(3);
  });

  test('blocks are ordered by the template\'s own defaultOrder, not by arrival', () => {
    const shuffled = [SECTIONS[4], SECTIONS[2], SECTIONS[3]];
    // No required blocks in this slice, so the locked bucket is not rendered
    // at all rather than shown empty.
    expect(ltrGroupBlocks(shuffled).map((g) => g.key)).toEqual(['optional']);
    expect(ltrGroupBlocks(shuffled)[0].sections.map((s) => s.defaultOrder)).toEqual([3, 4, 5]);
  });

  test('empty and malformed template responses do not throw', () => {
    expect(ltrGroupBlocks(null)).toEqual([]);
    expect(ltrGroupBlocks([{ label: 'no tag' }, null])).toEqual([]);
  });

  test('the default selection is required plus template-default optionals', () => {
    expect(ltrDefaultSelection(SECTIONS)).toHaveLength(5);
    const noDefaults = SECTIONS.map((s) => Object.assign({}, s, { defaultSelected: false }));
    expect(ltrDefaultSelection(noDefaults)).toEqual(REQUIRED_TAGS);
  });
});

describe('required blocks survive every selection', () => {
  test('a selection that omits them gets them back', () => {
    expect(ltrEnforceRequired([], SECTIONS)).toEqual(REQUIRED_TAGS);
    expect(ltrEnforceRequired(['OPAL_SECTION_LETTER_NEXT_STEPS'], SECTIONS))
      .toEqual(REQUIRED_TAGS.concat(['OPAL_SECTION_LETTER_NEXT_STEPS']));
  });
  test('a hostile or stale selection cannot deselect them or duplicate them', () => {
    const out = ltrEnforceRequired([REQUIRED_TAGS[0], REQUIRED_TAGS[0], 'GHOST_TAG'], SECTIONS);
    expect(out.filter((t) => t === REQUIRED_TAGS[0])).toHaveLength(1);
    expect(out).toContain(REQUIRED_TAGS[1]);
  });
  test('nonsense input still yields the required blocks', () => {
    expect(ltrEnforceRequired(null, SECTIONS)).toEqual(REQUIRED_TAGS);
    expect(ltrEnforceRequired(undefined, null)).toEqual([]);
  });
});

// ══ Custom content ═════════════════════════════════════════════════════════

describe('custom content normalisation', () => {
  test('labels are collapsed and trimmed, guidance is trimmed', () => {
    const [c] = ltrNormaliseCustom([{ id: 'a', label: '  Equipment   trial  ', guidance: '  Shower chair.  ' }]);
    expect(c.label).toBe('Equipment trial');
    expect(c.guidance).toBe('Shower chair.');
  });

  test('an entry with neither a label nor guidance is not content — it is dropped', () => {
    expect(ltrNormaliseCustom([{ id: 'a', label: '   ', guidance: '' }])).toEqual([]);
    expect(ltrNormaliseCustom([{ id: 'a' }, null, 'nope', 7])).toEqual([]);
  });

  test('guidance alone is enough — a label is optional', () => {
    const out = ltrNormaliseCustom([{ id: 'a', guidance: 'Mention the review date.' }]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toBe('');
  });

  test('it stays letter-sized: label and guidance are capped', () => {
    const [c] = ltrNormaliseCustom([{ id: 'a', label: 'x'.repeat(400), guidance: 'y'.repeat(2000) }]);
    expect(c.label).toHaveLength(120);
    expect(c.guidance).toHaveLength(600);
  });

  test('order is reassigned sequentially and ids are deduplicated', () => {
    const out = ltrNormaliseCustom([
      { id: 'a', label: 'One', order: 9 },
      { id: 'a', label: 'Duplicate', order: 0 },
      { label: 'No id', order: 4 },
    ]);
    expect(out.map((c) => c.order)).toEqual([0, 1]);
    expect(out.map((c) => c.label)).toEqual(['One', 'No id']);
    expect(out[1].id).toBe('custom-3');
  });

  test('a missing tag falls back to the id, so nothing is ever tagless', () => {
    expect(ltrNormaliseCustom([{ id: 'a', label: 'One' }])[0].tag).toBe('a');
  });

  test('reordering is a pure move that renumbers, and never mutates the input', () => {
    const list = ltrNormaliseCustom([
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' },
    ]);
    const moved = ltrMoveCustom(list, 'c', -1);
    expect(moved.map((c) => c.id)).toEqual(['a', 'c', 'b']);
    expect(moved.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(list.map((c) => c.id)).toEqual(['a', 'b', 'c']);
  });

  test('moves off either end are no-ops, and an unknown id changes nothing', () => {
    const list = ltrNormaliseCustom([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
    expect(ltrMoveCustom(list, 'a', -1).map((c) => c.id)).toEqual(['a', 'b']);
    expect(ltrMoveCustom(list, 'b', 1).map((c) => c.id)).toEqual(['a', 'b']);
    expect(ltrMoveCustom(list, 'zzz', 1).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

// ══ Recipients and CC ══════════════════════════════════════════════════════

describe('recipients', () => {
  test('every contact source is labelled, and unknown ones degrade readably', () => {
    expect(LTR_CONTACT_TARGETS).toEqual(['support_coordinator', 'nominee', 'referrer', 'saved_contact']);
    expect(ltrContactSourceLabel('support_coordinator')).toBe('Support coordinator');
    expect(ltrContactSourceLabel('nominee')).toBe('Nominee');
    expect(ltrContactSourceLabel('referrer')).toBe('Referrer');
    expect(ltrContactSourceLabel('saved_contact')).toBe('Saved contact');
    expect(ltrContactSourceLabel('plan_manager')).toBe('Plan manager');
  });

  test('the salutation is suggested from a real name only', () => {
    expect(ltrSuggestSalutation({ name: 'Priya Nand' })).toBe('Dear Priya Nand');
    expect(ltrSuggestSalutation({ name: '  Priya   Nand ' })).toBe('Dear Priya Nand');
  });

  test('no name means no suggestion — a letter is never addressed to a guess', () => {
    expect(ltrSuggestSalutation({ name: '' })).toBe('');
    expect(ltrSuggestSalutation({})).toBe('');
    expect(ltrSuggestSalutation(null)).toBe('');
  });
});

describe('CC summary', () => {
  test('names and organisations are joined for the CC line', () => {
    const s = ltrCcSummary([{ name: 'Sam Cole', organisation: 'Horizon' }, { name: 'Dee Katz' }]);
    expect(s.count).toBe(2);
    expect(s.willAppear).toBe(true);
    expect(s.text).toBe('CC: Sam Cole, Horizon; Dee Katz');
  });

  test('an organisation with no name still counts as a CC recipient', () => {
    expect(ltrCcSummary([{ organisation: 'Horizon' }]).text).toBe('CC: Horizon');
  });

  test('empty rows are ignored — a blank row is not a silent CC', () => {
    const s = ltrCcSummary([{ name: '  ', organisation: '' }, null, 'x']);
    expect(s.count).toBe(0);
    expect(s.willAppear).toBe(false);
  });

  test('with no CC the summary states the line is removed, not merely empty', () => {
    // The template deletes the whole CC paragraph, so "CC:" with nothing after
    // it would be a lie about the document.
    expect(ltrCcSummary([]).text).toBe('No CC line will appear — the whole line is removed from the letter.');
    expect(ltrCcSummary(null).willAppear).toBe(false);
  });
});

// ══ Scalar model ═══════════════════════════════════════════════════════════

describe('scalar model', () => {
  test('each field carries the server\'s value and the server\'s origin', () => {
    const groups = ltrScalarModel(manifest());
    const client = groups.filter((g) => g.key === 'client')[0];
    const name = client.fields.filter((f) => f.tag === 'OPAL_CLIENT_FULL_NAME')[0];
    expect(name.value).toBe('Jordan Fielding');
    expect(name.sourceLabel).toBe('Splose');
    expect(name.missing).toBe(false);
  });

  test('a blank value is missing and carries no value at all', () => {
    const client = ltrScalarFields(manifest(), 'client');
    const pref = client.filter((f) => f.tag === 'OPAL_CLIENT_PREFERRED_NAME')[0];
    expect(pref.missing).toBe(true);
    expect(pref.value).toBeNull();
    expect(pref.sourceLabel).toBe('Missing');
  });

  test('a value the server sent with no origin at all is treated as entered here', () => {
    const m = { scalarData: { OPAL_LETTER_SUBJECT: 'OT update' }, scalarSources: {} };
    expect(ltrScalarFields(m, 'letter')[0].sourceLabel).toBe('Entered for this letter');
  });

  test('server-issued values are shown but never editable', () => {
    const letter = ltrScalarFields(manifest(), 'letter');
    const docId = letter.filter((f) => f.tag === 'OPAL_LETTER_DOCUMENT_ID')[0];
    expect(docId.sourceLabel).toBe('Generated by Opal');
    expect(docId.editable).toBe(false);
    expect(ltrScalarFields(manifest(), 'client')[0].editable).toBe(true);
  });

  test('groups come out in the letter\'s reading order', () => {
    expect(ltrScalarModel(manifest()).map((g) => g.key))
      .toEqual(['client', 'letter', 'therapist', 'organisation']);
  });

  test('an absent manifest yields nothing rather than throwing', () => {
    expect(ltrScalarModel(null)).toEqual([]);
    expect(ltrScalarModel({})).toEqual([]);
    expect(ltrScalarFields(null, 'client')).toEqual([]);
  });
});

// ══ Preview model ══════════════════════════════════════════════════════════

describe('preview model', () => {
  test('no manifest means the preview is not ready — never a locally built letter', () => {
    const m = ltrPreviewModel(draft({ manifest: null }));
    expect(m.ready).toBe(false);
    expect(m.blocks).toEqual([]);
    expect(m.included).toEqual([]);
  });

  test('null and rubbish drafts do not throw', () => {
    expect(ltrPreviewModel(null).ready).toBe(false);
    expect(ltrPreviewModel('nope').ready).toBe(false);
    expect(ltrPreviewModel({ manifest: { sections: 'not an array' } }).ready).toBe(false);
  });

  test('blocks come from the manifest, in the manifest\'s own order', () => {
    const m = ltrPreviewModel(draft());
    expect(m.ready).toBe(true);
    expect(m.included.map((s) => s.title)).toEqual([
      'Purpose and context', 'Therapy and progress update', 'Equipment trial',
    ]);
    expect(m.excluded.map((s) => s.title)).toEqual(['Next steps and review']);
  });

  test('the manifest wins over the draft\'s selection — the manifest is what generates', () => {
    // selectedSections says NEXT_STEPS is in; the manifest says it is out.
    // The preview must show what the generator will do, not what the picker says.
    const d = draft();
    expect(d.selectedSections).toContain('OPAL_SECTION_LETTER_NEXT_STEPS');
    expect(ltrPreviewModel(d).included.map((s) => s.tag))
      .not.toContain('OPAL_SECTION_LETTER_NEXT_STEPS');
  });

  test('letterhead, participant and signature lines are the manifest\'s own scalars', () => {
    const m = ltrPreviewModel(draft());
    expect(m.letterhead.map((f) => f.tag)).toEqual(['OPAL_ORGANISATION_EMAIL']);
    expect(m.participantFields.map((f) => f.tag)).toContain('OPAL_CLIENT_NDIS_NUMBER');
    expect(m.signatureFields.map((f) => f.tag)).toContain('OPAL_THERAPIST_FULL_NAME');
  });

  test('the addressing comes from the draft\'s server-echoed snapshots', () => {
    const m = ltrPreviewModel(draft());
    expect(m.recipient.name).toBe('Priya Nand');
    expect(m.recipient.salutation).toBe('Dear Priya');
    expect(m.subject).toBe('OT progress update');
    expect(m.letterDateLong).toBe('10 August 2026');
    expect(m.cc.willAppear).toBe(true);
  });

  test('a missing letter date does not become today in the preview', () => {
    const m = ltrPreviewModel(draft({ letterDetails: { subject: 'x' } }));
    expect(m.letterDateLong).toBe('');
  });

  test('block counts split required, optional and custom', () => {
    expect(ltrBlockCounts(manifest())).toEqual({
      total: 4, included: 3, excluded: 1, required: 2, optional: 0, custom: 1,
    });
    expect(ltrBlockCounts(null).total).toBe(0);
  });
});

// ══ What blocks generation ═════════════════════════════════════════════════

describe('blocking issues', () => {
  const template = { scalarTags: ['OPAL_CLIENT_FULL_NAME'] };

  test('a complete letter has nothing blocking it', () => {
    expect(ltrBlockingIssues(draft(), template)).toEqual([]);
  });

  test('a missing recipient name blocks, and points at the addressee step', () => {
    const issues = ltrBlockingIssues(draft({ recipient: { name: '' } }), template);
    expect(issues.map((i) => i.key)).toEqual(['recipient']);
    expect(issues[0].step).toBe(2);
  });

  test('a missing subject blocks, and points at the letter details step', () => {
    const issues = ltrBlockingIssues(draft({ letterDetails: { letterDate: '2026-08-10', subject: '   ' } }), template);
    expect(issues.map((i) => i.key)).toEqual(['subject']);
    expect(issues[0].step).toBe(3);
  });

  test('an absent or unparseable letter date blocks', () => {
    expect(ltrBlockingIssues(draft({ letterDetails: { subject: 'x' } }), template).map((i) => i.key))
      .toEqual(['letterDate']);
    expect(ltrBlockingIssues(draft({ letterDetails: { subject: 'x', letterDate: 'soon' } }), template).map((i) => i.key))
      .toEqual(['letterDate']);
  });

  test('no participant blocks at step 1', () => {
    const issues = ltrBlockingIssues(draft({ clientId: '', clientName: '' }), template);
    expect(issues[0].key).toBe('participant');
    expect(issues[0].step).toBe(1);
  });

  test('a template scalar the TEMPLATE marks required blocks when the server reports it missing', () => {
    const strict = { scalarTags: [{ tag: 'OPAL_CLIENT_PREFERRED_NAME', required: true }] };
    expect(ltrRequiredScalarTags(strict)).toEqual(['OPAL_CLIENT_PREFERRED_NAME']);
    const issues = ltrBlockingIssues(draft(), strict);
    expect(issues.map((i) => i.key)).toEqual(['OPAL_CLIENT_PREFERRED_NAME']);
  });

  test('an optional blank never blocks — it becomes a marked placeholder', () => {
    // OPAL_CLIENT_PREFERRED_NAME is in missingFields but the template does not
    // require it, so the letter can still be generated.
    expect(draft().missingFields).toContain('OPAL_CLIENT_PREFERRED_NAME');
    expect(ltrBlockingIssues(draft(), template)).toEqual([]);
  });

  test('a plain string scalarTags list marks nothing required', () => {
    expect(ltrRequiredScalarTags({ scalarTags: ['A', 'B'] })).toEqual([]);
    expect(ltrRequiredScalarTags(null)).toEqual([]);
  });

  test('every issue carries a human message and a step to fix it on', () => {
    ltrBlockingIssues({}, null).forEach((i) => {
      expect(typeof i.message).toBe('string');
      expect(i.message.length).toBeGreaterThan(10);
      expect(i.step).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('missing summary', () => {
  test('server-flagged and blank values are merged and grouped', () => {
    const s = ltrMissingSummary(['OPAL_THERAPIST_AHPRA_REGISTRATION'], manifest().scalarData);
    expect(s.tags).toContain('OPAL_THERAPIST_AHPRA_REGISTRATION');
    expect(s.tags).toContain('OPAL_CLIENT_PREFERRED_NAME');
    expect(s.count).toBe(2);
    expect(s.groups.map((g) => g.label)).toEqual(['Therapist', 'Participant']);
  });
  test('a tag is never counted twice', () => {
    const s = ltrMissingSummary(['OPAL_CLIENT_PREFERRED_NAME', 'OPAL_CLIENT_PREFERRED_NAME'], manifest().scalarData);
    expect(s.count).toBe(1);
  });
  test('nothing missing means an empty summary', () => {
    expect(ltrMissingSummary([], {}).count).toBe(0);
    expect(ltrMissingSummary(null, null).count).toBe(0);
  });
});

// ══ Filename preview ═══════════════════════════════════════════════════════

describe('filename preview', () => {
  test('the contracted shape is produced, preferred name winning over full name', () => {
    expect(ltrFilenamePreview(draft())).toBe('Progress Note Letter - Jordy - 2026-08-10.docx');
  });

  test('with no preferred name the full name is used', () => {
    expect(ltrFilenamePreview(draft({ clientPreferredName: '' })))
      .toBe('Progress Note Letter - Jordan Fielding - 2026-08-10.docx');
  });

  test('the letter date drives the date component, not the clock', () => {
    const d = draft({ letterDetails: { letterDate: '2026-01-02' } });
    expect(ltrFilenamePreview(d, new Date(2026, 7, 10)))
      .toBe('Progress Note Letter - Jordy - 2026-01-02.docx');
  });

  test('with no letter date it falls back to today, in ISO', () => {
    const d = draft({ letterDetails: {} });
    expect(ltrFilenamePreview(d, new Date(2026, 7, 10)))
      .toBe('Progress Note Letter - Jordy - 2026-08-10.docx');
  });

  test('every component is sanitised — separators can never escape the filename', () => {
    expect(ltrSanitiseFilePart('An/na\\Ru:iz')).toBe('An na Ru iz');
    expect(ltrSanitiseFilePart('  ..dots..  ')).toBe('dots');
    expect(ltrSanitiseFilePart('a'.repeat(200))).toHaveLength(60);
    expect(ltrSanitiseFilePart(null)).toBe('');
    const d = draft({ clientPreferredName: '../../etc/passwd' });
    expect(ltrFilenamePreview(d)).toBe('Progress Note Letter - etc passwd - 2026-08-10.docx');
  });

  test('a nameless draft still produces a valid filename rather than an empty slot', () => {
    const d = draft({ clientPreferredName: '', clientName: '' });
    expect(ltrFilenamePreview(d)).toBe('Progress Note Letter - 2026-08-10.docx');
  });

  test('hyphens inside the ISO date survive sanitisation', () => {
    expect(ltrFilenamePreview(draft())).toContain('2026-08-10');
  });
});
