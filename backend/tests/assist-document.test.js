'use strict';
/** Opal Assist documents — the shape a rephrase or case note must have. Pure. */
const d = require('../assist/assist-document');

const NOTE = { title: null, blocks: [
  { t: 'h', text: 'Identify:' }, { t: 'p', text: 'The OT saw [CLIENT_1] at home.' },
  { t: 'h', text: 'session details' }, { t: 'li', lead: 'Session setup:', text: 'TACPAC items prepared.' },
  { t: 'h', text: 'Plan' }, { t: 'li', text: 'Continue TACPAC.' },
] };

test('a case note has exactly Identify, Session details, Plan — headings are normalised, leads lose their colon', () => {
  const r = d.validateDocument(NOTE, 'casenote');
  expect(r.ok).toBe(true);
  expect(r.doc.kind).toBe('casenote');
  expect(r.doc.blocks.filter((b) => b.t === 'h').map((b) => b.text)).toEqual(['Identify', 'Session details', 'Plan']);
  expect(r.doc.blocks[3]).toEqual({ t: 'li', lead: 'Session setup', text: 'TACPAC items prepared.' });
});

test('a case note with a missing, extra, reordered or empty section is refused', () => {
  const without = { blocks: NOTE.blocks.filter((b) => b.text !== 'Plan' && b.text !== 'Continue TACPAC.') };
  expect(d.validateDocument(without, 'casenote')).toEqual({ ok: false, reason: 'casenote_headings' });
  const reordered = { blocks: [NOTE.blocks[4], NOTE.blocks[5], ...NOTE.blocks.slice(0, 4)] };
  expect(d.validateDocument(reordered, 'casenote').ok).toBe(false);
  const empty = { blocks: [...NOTE.blocks.slice(0, 4), { t: 'h', text: 'Plan' }] };
  expect(d.validateDocument(empty, 'casenote')).toEqual({ ok: false, reason: 'casenote_empty_section' });
  // The same blocks are a perfectly good ordinary document.
  expect(d.validateDocument(without, 'document').ok).toBe(true);
});

test('the reply may wrap the JSON in prose; anything that is not the shape is refused', () => {
  const r = d.parseDocument('Sure, here it is:\n' + JSON.stringify(NOTE) + '\nHope that helps', 'casenote');
  expect(r.ok).toBe(true);
  expect(d.parseDocument('Just some words.', 'document')).toEqual({ ok: false, reason: 'not_json' });
  expect(d.parseDocument('{"blocks":[{"t":"table","text":"x"}]}', 'document')).toEqual(expect.objectContaining({ ok: false, reason: 'block_type' }));
  expect(d.parseDocument('{"blocks":[]}', 'document')).toEqual(expect.objectContaining({ ok: false, reason: 'block_count' }));
});

test('plain text of a document keeps tokens; every string is offered to the guard', () => {
  const doc = d.validateDocument(NOTE, 'casenote').doc;
  expect(d.documentToText(doc)).toBe('Identify:\nThe OT saw [CLIENT_1] at home.\nSession details:\n• Session setup: TACPAC items prepared.\nPlan:\n• Continue TACPAC.');
  expect(d.documentStrings(doc)).toEqual(expect.arrayContaining(['Session setup', 'TACPAC items prepared.', 'The OT saw [CLIENT_1] at home.']));
});

test('the case-note instruction names the three sections and forbids invention; both formats ask for JSON only', () => {
  const cn = d.formatInstruction('casenote');
  expect(cn).toMatch(/"Identify", "Session details", "Plan"/);
  expect(cn).toMatch(/add nothing that is not in the notes/);
  expect(d.formatInstruction('document')).toMatch(/Reply with ONLY one JSON object/);
});
