'use strict';

/**
 * PROGRESS NOTE LETTER TEMPLATE MAP — asserted against the REAL shipped file.
 *
 * Every count in letter-template-map.js is DISCOVERED here by unzipping
 * progress-note-letter-v1.docx and walking its XML. Nothing in the production
 * code branches on a count; the counts exist only so this file can prove the
 * static map still describes the document it claims to describe. Swap the
 * template and these tests fail loudly instead of the portal quietly writing
 * into controls that are no longer there.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

const ltm = require('../fca/letter-template-map');

const TEMPLATE_PATH = path.join(__dirname, '..', 'fca', 'templates', ltm.LETTER_TEMPLATE_FILENAME);
const templateBuffer = fs.readFileSync(TEMPLATE_PATH);

// ── Discovery ────────────────────────────────────────────────────────────────

const directChildren = (el, name) => {
  const out = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && n.nodeName === name) out.push(n);
  }
  return out;
};
const directChild = (el, name) => directChildren(el, name)[0] || null;

function ownTag(sdt) {
  const pr = directChild(sdt, 'w:sdtPr');
  if (!pr) return null;
  const tag = directChild(pr, 'w:tag');
  return tag ? tag.getAttribute('w:val') : null;
}

/**
 * Every tagged content control in the package.
 * A control is a BLOCK when its own content holds paragraphs, and a SCALAR
 * when it holds only runs — which is exactly how Word distinguishes a
 * rich-text block control from a plain-text field.
 */
async function discover() {
  const zip = await JSZip.loadAsync(templateBuffer);
  const controls = [];

  for (const name of Object.keys(zip.files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue;
    const xml = await zip.file(name).async('string');
    const doc = new DOMParser().parseFromString(xml, 'text/xml');

    for (const sdt of Array.from(doc.getElementsByTagName('w:sdt'))) {
      const tag = ownTag(sdt);
      if (!tag) continue;
      const content = directChild(sdt, 'w:sdtContent');
      const isBlock = Boolean(content && content.getElementsByTagName('w:p').length > 0);
      controls.push({ tag, part: name, isBlock });
    }
  }

  const occurrences = new Map();
  for (const c of controls) occurrences.set(c.tag, (occurrences.get(c.tag) || 0) + 1);

  const blockTags = new Set(controls.filter((c) => c.isBlock).map((c) => c.tag));
  const scalarTags = new Set(controls.filter((c) => !c.isBlock).map((c) => c.tag));

  return { zip, controls, occurrences, blockTags, scalarTags };
}

let found;
beforeAll(async () => { found = await discover(); });

// ── The pin ──────────────────────────────────────────────────────────────────

describe('template file', () => {
  test('is the exact template the map was written against', () => {
    const sha = crypto.createHash('sha256').update(templateBuffer).digest('hex');
    expect(sha).toBe('63c9da6409841da6c98d09de45278ec316a86808b242f0ae990d0ea6580aa1ed');
    expect(sha).toBe(ltm.LETTER_TEMPLATE_SHA256);
  });
});

// ── The verified contract ────────────────────────────────────────────────────

describe('verified contract', () => {
  test('30 unique tags across 32 occurrences', () => {
    expect(found.occurrences.size).toBe(30);
    const total = [...found.occurrences.values()].reduce((a, b) => a + b, 0);
    expect(total).toBe(32);
  });

  test('24 unique scalar tags across 26 occurrences', () => {
    expect(found.scalarTags.size).toBe(24);
    const total = [...found.scalarTags].reduce((a, t) => a + found.occurrences.get(t), 0);
    expect(total).toBe(26);
  });

  test('5 block controls and 1 anchor, each appearing once', () => {
    expect(found.blockTags.size).toBe(6);
    for (const tag of found.blockTags) expect(found.occurrences.get(tag)).toBe(1);

    const sections = [...found.blockTags].filter((t) => t !== ltm.LETTER_CUSTOM_SECTION_ANCHOR);
    expect(sections.sort()).toEqual(ltm.LETTER_SECTIONS.map((s) => s.tag).sort());
    expect(found.blockTags.has(ltm.LETTER_CUSTOM_SECTION_ANCHOR)).toBe(true);
  });

  test('exactly two scalar tags repeat, and they are the two documented ones', () => {
    const repeated = {};
    for (const tag of found.scalarTags) {
      const n = found.occurrences.get(tag);
      if (n > 1) repeated[tag] = n;
    }
    expect(repeated).toEqual({ OPAL_CLIENT_FULL_NAME: 2, OPAL_THERAPIST_ROLE: 2 });
  });

  test('both repeated scalars live entirely in word/document.xml', () => {
    for (const tag of ['OPAL_CLIENT_FULL_NAME', 'OPAL_THERAPIST_ROLE']) {
      const parts = found.controls.filter((c) => c.tag === tag).map((c) => c.part);
      expect(parts).toEqual(['word/document.xml', 'word/document.xml']);
    }
  });

  test('header6 carries the four organisation tags and nothing else', () => {
    const header = found.controls.filter((c) => c.part === 'word/header6.xml').map((c) => c.tag).sort();
    expect(header).toEqual([
      'OPAL_ORGANISATION_ADDRESS', 'OPAL_ORGANISATION_EMAIL',
      'OPAL_ORGANISATION_PHONE', 'OPAL_ORGANISATION_WEBSITE',
    ]);
  });

  test('footer6 carries the document id, beside a live PAGE field', async () => {
    const footer = found.controls.filter((c) => c.part === 'word/footer6.xml').map((c) => c.tag);
    expect(footer).toEqual(['OPAL_LETTER_DOCUMENT_ID']);

    const xml = await found.zip.file('word/footer6.xml').async('string');
    expect(xml).toMatch(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/);
  });
});

// ── The map agrees with the file ─────────────────────────────────────────────

describe('the static map matches the document', () => {
  test('scalar catalogue lists exactly the template\'s scalar tags', () => {
    expect(ltm.LETTER_SCALAR_TAG_LIST.slice().sort()).toEqual([...found.scalarTags].sort());
  });

  test('every declared occurrence count is the real one', () => {
    for (const meta of ltm.LETTER_SCALAR_TAGS) {
      expect([meta.tag, meta.occurrences]).toEqual([meta.tag, found.occurrences.get(meta.tag)]);
    }
  });

  test('every declared non-document part is where the map says it is', () => {
    for (const meta of ltm.LETTER_SCALAR_TAGS) {
      const parts = new Set(found.controls.filter((c) => c.tag === meta.tag).map((c) => c.part));
      for (const declared of (meta.parts || [])) expect(parts.has(declared)).toBe(true);
    }
  });

  test('the multiline tags really do declare w:text multiLine="1"', async () => {
    const declared = new Set(ltm.LETTER_MULTILINE_TAGS);
    const actual = new Set();

    for (const name of ['word/document.xml', 'word/header6.xml', 'word/footer6.xml']) {
      const xml = await found.zip.file(name).async('string');
      const doc = new DOMParser().parseFromString(xml, 'text/xml');
      for (const sdt of Array.from(doc.getElementsByTagName('w:sdt'))) {
        const pr = directChild(sdt, 'w:sdtPr');
        if (!pr) continue;
        const text = directChild(pr, 'w:text');
        if (text && text.getAttribute('w:multiLine') === '1') actual.add(ownTag(sdt));
      }
    }

    expect([...declared].sort()).toEqual([...actual].sort());
  });

  test('the styles the custom blocks use exist in the template', async () => {
    const styles = await found.zip.file('word/styles.xml').async('string');
    expect(styles).toContain(`w:styleId="${ltm.STYLE.BODY}"`);
    expect(styles).toContain(`w:styleId="${ltm.STYLE.BODY_EMPHASIS}"`);
  });

  test('this template has no table of contents to worry about', async () => {
    const xml = await found.zip.file('word/document.xml').async('string');
    expect(xml).not.toMatch(/<w:instrText[^>]*>[^<]*\bTOC\b/);
  });
});

// ── Catalogue invariants ─────────────────────────────────────────────────────

describe('block catalogue', () => {
  test('two required blocks, three optional, all on by default', () => {
    expect(ltm.LETTER_REQUIRED_SECTION_TAGS).toEqual([
      'OPAL_SECTION_LETTER_PURPOSE_CONTEXT',
      'OPAL_SECTION_LETTER_PROGRESS_UPDATE',
    ]);
    expect(ltm.LETTER_OPTIONAL_SECTION_TAGS).toEqual([
      'OPAL_SECTION_LETTER_CURRENT_PRESENTATION',
      'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS',
      'OPAL_SECTION_LETTER_NEXT_STEPS',
    ]);
    expect(ltm.LETTER_SECTIONS.every((s) => s.defaultSelected)).toBe(true);
  });

  test('the template descriptor is the contract shape', () => {
    const d = ltm.letterTemplateDescriptor();
    expect(d.documentType).toBe('progress_note_letter');
    expect(d.version).toBe('v1');
    expect(d.sections).toHaveLength(5);
    expect(Object.keys(d.sections[0]).sort())
      .toEqual(['defaultOrder', 'defaultSelected', 'description', 'label', 'required', 'tag']);
    expect(d.scalarTags).toHaveLength(24);
    expect(d.profileEligibleTags).toEqual(['OPAL_CLIENT_PREFERRED_NAME']);
    expect(d.recipientTargets).toEqual(['support_coordinator', 'nominee', 'referrer', 'saved_contact']);
  });
});

describe('required vs optional values', () => {
  test('required and optional-line tags partition the scalar catalogue', () => {
    const all = [...ltm.LETTER_REQUIRED_VALUE_TAGS, ...ltm.LETTER_OPTIONAL_LINE_TAGS].sort();
    expect(all).toEqual(ltm.LETTER_SCALAR_TAG_LIST.slice().sort());
    // No tag can be both, or neither.
    expect(new Set(all).size).toBe(24);
  });

  test('exactly the six removable lines are optional', () => {
    expect(ltm.LETTER_OPTIONAL_LINE_TAGS.slice().sort()).toEqual([
      'OPAL_LETTER_CC',
      'OPAL_LETTER_RECIPIENT_ADDRESS',
      'OPAL_LETTER_RECIPIENT_ORGANISATION',
      'OPAL_LETTER_RECIPIENT_ROLE',
      'OPAL_THERAPIST_AHPRA_NUMBER',
      'OPAL_THERAPIST_QUALIFICATIONS',
    ]);
  });

  test('every required tag is one a therapist can actually supply', () => {
    const overridable = new Set(ltm.LETTER_OVERRIDABLE_TAGS);
    for (const tag of ltm.LETTER_REQUIRED_VALUE_TAGS) {
      expect([tag, overridable.has(tag)]).toEqual([tag, true]);
    }
  });

  test('the issued document id is a default, not a decree — it is overridable', () => {
    // Opal issues the reference so a therapist is never told it is "Missing",
    // but a practice that numbers its own correspondence is not overruled.
    expect(ltm.LETTER_OVERRIDABLE_TAGS).toContain('OPAL_LETTER_DOCUMENT_ID');
    expect(ltm.LETTER_SCALAR_BY_TAG.get('OPAL_LETTER_DOCUMENT_ID').layer).toBe('server');
    expect(ltm.LETTER_SCALAR_BY_TAG.get('OPAL_LETTER_DOCUMENT_ID').readOnly).toBeUndefined();
  });

  test('every scalar tag may be excluded', () => {
    expect(new Set(ltm.LETTER_EXCLUDABLE_TAGS)).toEqual(new Set(ltm.LETTER_SCALAR_TAG_LIST));
    expect(ltm.letterTemplateDescriptor().excludableTags)
      .toEqual(ltm.LETTER_SCALAR_TAG_LIST);
  });
});

describe('custom block tags', () => {
  test('are server-minted, namespaced to the letter, and slug-safe', () => {
    const tag = ltm.letterCustomSectionTag('Equipment & AT review!', 'abc-def-123');
    expect(tag).toBe('OPAL_SECTION_LETTER_CUSTOM_EQUIPMENT_AT_REVIEW_ABCDEF123');
    expect(ltm.LETTER_CUSTOM_TAG_PATTERN.test(tag)).toBe(true);
  });

  test('an empty label still produces a valid, unique tag', () => {
    const tag = ltm.letterCustomSectionTag('', 'abc-def-123');
    expect(tag).toBe('OPAL_SECTION_LETTER_CUSTOM_SECTION_ABCDEF123');
    expect(ltm.LETTER_CUSTOM_TAG_PATTERN.test(tag)).toBe(true);
  });

  test('cannot collide with a real template control', () => {
    for (const tag of found.occurrences.keys()) {
      expect(ltm.LETTER_CUSTOM_TAG_PATTERN.test(tag)).toBe(false);
    }
  });
});

describe('missing placeholder', () => {
  test('is never the string null or undefined', () => {
    for (const tag of ltm.LETTER_SCALAR_TAG_LIST) {
      const p = ltm.letterMissingPlaceholder(tag);
      expect(p).not.toMatch(/null|undefined/i);
      expect(p).toMatch(/^\[TO COMPLETE/);
    }
  });
});
