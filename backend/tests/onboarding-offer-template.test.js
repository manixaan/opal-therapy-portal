'use strict';

/**
 * THE LETTER'S WORDING — paragraphs read out of the shipped template, edits
 * written back, and the result still composing into a letter. Runs against
 * the real .docx so a template change that breaks the editor fails here.
 */

const JSZip = require('jszip');
const docx = require('../onboarding-offer-docx');
const tpl = require('../onboarding-offer-template');

const base = () => docx.readTemplateBuffer();

async function text(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  return (xml.match(/<w:t(?: [^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('');
}

describe('reading the letter', () => {
  test('every paragraph comes out in order, with its style and its fields as tags', async () => {
    const paras = await tpl.readParagraphs(base());
    expect(paras.length).toBeGreaterThan(60);
    const greeting = paras.find((p) => p.segments[0] && p.segments[0].text === 'Dear ');
    expect(greeting.style).toBe('OPALBody');
    expect(greeting.segments).toEqual([
      { type: 'text', text: 'Dear ' }, { type: 'tag', tag: 'OPAL_LOO_CANDIDATE_FIRST_NAME' }, { type: 'text', text: ',' },
    ]);
    // Every tag the module fills has a label for the editor.
    for (const p of paras) for (const s of p.segments) if (s.type === 'tag') expect(tpl.TAG_LABELS[s.tag]).toBeTruthy();
  });
});

describe('editing the letter', () => {
  test('a rewritten paragraph keeps its style, its fields, and still composes', async () => {
    const before = await tpl.readParagraphs(base());
    const i = before.findIndex((p) => p.segments[0] && p.segments[0].text === 'Dear ');
    const out = await tpl.applyEdits(base(), [{ index: i, segments: [
      { type: 'text', text: 'Hello ' }, { type: 'tag', tag: 'OPAL_LOO_CANDIDATE_FIRST_NAME' }, { type: 'text', text: ' — welcome to the team,' },
    ] }]);
    const after = await tpl.readParagraphs(out);
    expect(after.length).toBe(before.length);
    expect(after[i].style).toBe('OPALBody');
    expect(after[i].segments).toEqual([
      { type: 'text', text: 'Hello ' }, { type: 'tag', tag: 'OPAL_LOO_CANDIDATE_FIRST_NAME' }, { type: 'text', text: ' — welcome to the team,' },
    ]);
    await tpl.proveComposes(out);
    const filled = await docx.buildOfferDocx({
      templateBuffer: out, issuedAt: new Date('2026-09-03T02:00:00Z'), isTreatingTherapist: true,
      terms: { positionTitle: 'Occupational Therapist', employmentType: 'full_time', startDate: '2026-10-07', payBasis: 'annual', payRate: 90000, hoursPerWeek: 38, probationMonths: 3 },
      applicant: { name: 'Jane Smith', email: 'jane@example.com', mobile: '0412 000 000' }, signatory: docx.DEFAULT_SIGNATORY,
    });
    expect(await text(filled)).toContain('Hello Jane — welcome to the team,');
  });

  test('a field typed into a paragraph that never had it is cloned from elsewhere; a deleted one is gone', async () => {
    const before = await tpl.readParagraphs(base());
    const i = before.findIndex((p) => p.segments.length === 1 && /^We look forward/.test(p.segments[0].text));
    const out = await tpl.applyEdits(base(), [{ index: i, segments: [
      { type: 'text', text: 'We look forward to welcoming you on ' }, { type: 'tag', tag: 'OPAL_LOO_COMMENCEMENT_DATE_LONG' }, { type: 'text', text: '.' },
    ] }]);
    const after = await tpl.readParagraphs(out);
    expect(after[i].segments[1]).toEqual({ type: 'tag', tag: 'OPAL_LOO_COMMENCEMENT_DATE_LONG' });
    await tpl.proveComposes(out);

    const greeting = before.findIndex((p) => p.segments[0] && p.segments[0].text === 'Dear ');
    const plain = await tpl.applyEdits(base(), [{ index: greeting, segments: [{ type: 'text', text: 'Dear colleague,' }] }]);
    expect((await tpl.readParagraphs(plain))[greeting].segments).toEqual([{ type: 'text', text: 'Dear colleague,' }]);
    await tpl.proveComposes(plain);
  });

  test('edits outside the letter, unknown fields and over-long paragraphs are refused', async () => {
    await expect(tpl.applyEdits(base(), [{ index: 9999, segments: [] }])).rejects.toThrow(/outside the letter/);
    await expect(tpl.applyEdits(base(), [{ index: 5, segments: [{ type: 'tag', tag: 'OPAL_LOO_NOPE' }] }])).rejects.toThrow(/Unknown control/);
    await expect(tpl.applyEdits(base(), [{ index: 5, segments: [{ type: 'text', text: 'x'.repeat(tpl.MAX_PARAGRAPH_CHARS + 1) }] }])).rejects.toThrow(/too long/);
  });
});
