'use strict';

/**
 * SUPPORT LETTER + PROGRESS REPORT — the maps, the shipped masters, and the
 * two composition behaviours they introduced (one paragraph per line, optional
 * table rows). No database: everything here is the .docx itself.
 *
 *   - the masters are pinned and are exactly what the builder produces from
 *     the maps, so a map edit without a rebuild (or the reverse) fails here;
 *   - every control the master carries is declared, and every declared
 *     control is in the master;
 *   - narratives split into paragraphs, bullets stay bullets, empty optional
 *     rows go and the first row of a table never does;
 *   - goal slots beyond the default start removed, and their fields are not
 *     counted as outstanding.
 */

const crypto = require('crypto');
const JSZip = require('jszip');

const catalogue = require('../templates/catalogue');
const { resolveDocument, composePortalDocx, exportDocument, sectionStructure } = require('../templates/compose');
const { buildLetter, buildReport } = require('../scripts/build-clinical-templates');
const letterMap = require('../templates/support-letter-map');
const reportMap = require('../templates/progress-report-map');

const ROW = {
  id: '11111111-2222-3333-4444-555555555555',
  created_at: new Date('2026-11-07T00:00:00Z'),
  title: 'Doc',
  field_values: {},
  sections: null,
};
const CLIENT = {
  splose: { fullName: 'Jane Smith', firstname: 'Jane', ndisNumber: '430000000' },
  profile: { date_of_birth: '2015-01-20', preferred_name: 'Jane' },
  currentPlan: { plan_start: '2025-12-19', plan_end: '2026-12-18' },
  goals: [{ goalText: 'Jane would like to communicate what she wants.' }],
};
const PORTAL = { therapistName: 'Alex Rivera', therapistRoleTitle: 'Occupational Therapist' };

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

async function documentXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file('word/document.xml').async('string');
}

async function allPartsXml(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const out = {};
  for (const n of Object.keys(zip.files).filter((f) => /\.xml$/.test(f))) out[n] = await zip.file(n).async('string');
  return out;
}

function stateFor(id, fieldValues = {}, sections = null) {
  return resolveDocument({
    template: catalogue.getTemplate(id),
    row: { ...ROW, field_values: fieldValues, sections },
    client: CLIENT,
    portal: PORTAL,
    organisation: { businessPhone: '08 0000 0000' },
  });
}

/** Visible text of every paragraph in document order. */
function paragraphs(xml) {
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).map((p) => ({
    style: (p.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || null,
    text: (p.match(/<w:t[^>]*>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join(''),
  }));
}

describe.each([
  ['support_letter', letterMap, buildLetter],
  ['progress_report', reportMap, buildReport],
])('%s master', (id, map, build) => {
  const template = catalogue.getTemplate(id);
  let parts;

  beforeAll(async () => { parts = await allPartsXml(catalogue.readMaster(template)); });

  test('the shipped file is the pinned one', () => {
    expect(sha(catalogue.readMaster(template))).toBe(map.TEMPLATE_SHA256);
  });

  test('the shipped file is exactly what the builder makes from the map', async () => {
    expect(sha(await build())).toBe(map.TEMPLATE_SHA256);
  });

  test('every control in the master is declared, and every declared field is in the master', () => {
    const inMaster = new Set();
    for (const name of map.CONTROL_PARTS) {
      for (const m of (parts[name] || '').matchAll(/<w:tag w:val="([^"]+)"/g)) inMaster.add(m[1]);
    }
    const declared = new Set([
      ...map.SCALAR_TAG_LIST,
      ...map.SECTIONS.map((s) => s.tag),
      map.CUSTOM_SECTION_ANCHOR,
    ]);
    expect([...inMaster].filter((t) => !declared.has(t))).toEqual([]);
    expect([...declared].filter((t) => !inMaster.has(t))).toEqual([]);
  });

  test('a field declared in a header or footer is really there', () => {
    for (const s of map.SCALAR_TAGS.filter((x) => x.parts)) {
      for (const p of s.parts) expect(`${s.tag}@${p}:${parts[p].includes(`"${s.tag}"`)}`).toBe(`${s.tag}@${p}:true`);
    }
  });

  test('each section is one control, and each narrative is a block-level control inside its section', () => {
    const xml = parts['word/document.xml'];
    for (const s of map.SECTIONS) {
      expect(`${s.tag}:${(xml.match(new RegExp(`w:val="${s.tag}"`, 'g')) || []).length}`).toBe(`${s.tag}:1`);
    }
    for (const tag of map.PARAGRAPH_TAGS) {
      // <w:sdt> … tag … <w:sdtContent><w:p> — a paragraph inside, not a run.
      expect(xml).toMatch(new RegExp(`w:val="${tag}"[^]*?<w:sdtContent><w:p>`));
    }
  });

  test('nothing in the export survives as a portal prompt or binding', async () => {
    const out = await exportDocument(stateFor(id), 'docx');
    const xml = Object.values(await allPartsXml(out.buffer)).join('\n');
    expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
    expect(xml).not.toMatch(/\[PORTAL\b/);
  });

  test('the field spec carries narrative metadata and never a binding', () => {
    const fields = catalogue.fieldSpec(template).flatMap((g) => g.fields);
    const narrative = fields.filter((f) => f.narrative);
    expect(narrative.length).toBeGreaterThan(0);
    for (const f of narrative) {
      expect(f.maxChars).toBeGreaterThan(4000);
      expect(f.hint).toBeTruthy();
    }
    for (const f of fields) expect(`${f.label}`).not.toMatch(/OPAL_|PORTAL —/);
  });
});

describe('a narrative is written one paragraph per line', () => {
  test('three lines → three body paragraphs, blank lines dropped, nothing merged', async () => {
    const xml = await documentXml(await composePortalDocx(stateFor('support_letter', {
      OPAL_LETTER_BACKGROUND: 'First paragraph.\n\n  Second paragraph.  \r\nThird paragraph.',
    })));
    const texts = paragraphs(xml).map((p) => p.text);
    const i = texts.indexOf('First paragraph.');
    expect(texts.slice(i, i + 3)).toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.']);
  });

  test('bullet lines stay bullets', async () => {
    const xml = await documentXml(await composePortalDocx(stateFor('progress_report', {
      OPAL_REPORT_GOALS_LIST: 'Communicate needs\nPlay with peers',
    })));
    const ps = paragraphs(xml).filter((p) => ['Communicate needs', 'Play with peers'].includes(p.text));
    expect(ps.map((p) => p.style)).toEqual(['OPAL–Bullet', 'OPAL–Bullet']);
  });
});

describe('optional table rows', () => {
  test('an empty support row is removed whole; the first row is always kept', async () => {
    const xml = await documentXml(await composePortalDocx(stateFor('progress_report', {
      OPAL_REPORT_SUPPORT_2_ROLE: 'Speech Pathologist',
      OPAL_REPORT_SUPPORT_2_PROVIDER: 'Pat, Example Speech',
    })));
    expect(xml).toContain('OPAL_REPORT_SUPPORT_1_ROLE');           // unfilled, but kept
    expect(xml).toContain('Speech Pathologist');
    for (let i = 3; i <= reportMap.SUPPORT_ROWS; i++) {
      expect(`${i}:${xml.includes(`OPAL_REPORT_SUPPORT_${i}_ROLE`)}`).toBe(`${i}:false`);
    }
  });

  test('a row with one value of four stays', async () => {
    const xml = await documentXml(await composePortalDocx(stateFor('progress_report', {
      OPAL_REPORT_RESULT_3_SCORE: '71',
    })));
    expect(xml).toContain('OPAL_REPORT_RESULT_3_DOMAIN');
    expect(xml).not.toContain('OPAL_REPORT_RESULT_4_DOMAIN');
  });

  test('the support letter leaves out an unused quote reference and date of birth line', async () => {
    const state = stateFor('support_letter');
    state.scalarData.OPAL_CLIENT_DATE_OF_BIRTH = null;
    const xml = await documentXml(await composePortalDocx(state));
    expect(xml).not.toContain('Quote / reference');
    expect(xml).not.toContain('OPAL_CLIENT_DATE_OF_BIRTH');
    expect(xml).toContain('OPAL_LETTER_SUBJECT');
  });
});

describe('sections', () => {
  test('goal slots past the fourth start removed, and come back when selected', async () => {
    const t = catalogue.getTemplate('progress_report');
    const included = sectionStructure(t, { ...ROW }).sections.filter((s) => s.included).map((s) => s.tag);
    expect(included).toContain('OPAL_SECTION_REPORT_GOAL_4');
    expect(included).not.toContain('OPAL_SECTION_REPORT_GOAL_5');

    let xml = await documentXml(await composePortalDocx(stateFor('progress_report')));
    expect(xml).not.toContain('NDIS Goal 5');

    const all = t.sectionCatalogue.SECTIONS.map((s) => s.tag);
    xml = await documentXml(await composePortalDocx(stateFor('progress_report', {}, { selected: all })));
    expect(xml).toContain('NDIS Goal 8');
  });

  test('a goal statement resolves from the current plan’s goals', () => {
    const state = stateFor('progress_report');
    expect(state.scalarData.OPAL_REPORT_GOAL_1).toBe('Jane would like to communicate what she wants.');
    expect(state.scalarSources.OPAL_REPORT_GOAL_1).toBe('client_profile');
  });

  test('a support letter custom section prints at Heading 3 by default', async () => {
    const xml = await documentXml(await composePortalDocx(stateFor('support_letter', {}, {
      custom: [{ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', title: 'Trial outcome' }],
    })));
    const p = paragraphs(xml).find((x) => x.text === 'Trial outcome');
    expect(p.style).toBe('OPAL–Heading3');
  });

  test('the retired Progress Note still composes for documents already started from it', async () => {
    const out = await exportDocument(stateFor('progress_note'), 'docx');
    expect(out.buffer.length).toBeGreaterThan(1000);
  });
});
