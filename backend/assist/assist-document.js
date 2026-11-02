'use strict';

/**
 * OPAL ASSIST DOCUMENTS — rephrased writing as an editable document.
 *
 * A chat reply is prose in a bubble. A REPHRASE (an email, a letter, a report
 * paragraph, a case note) is something the practitioner keeps: it opens as a
 * small document they can edit, format and re-prompt piece by piece. The model
 * is asked for that document as JSON, so the layout is the page's, not the
 * model's — headings, paragraphs and dot points with an optional bold lead-in
 * ("Session setup: …"), the way Splose lays a note out.
 *
 *   document — any rephrase: whatever headings the text needs (often none)
 *   casenote — always exactly three sections: Identify · Session details · Plan
 *
 * Shape: { kind, title|null, blocks: [{ t:'h'|'p'|'li', text, lead? }] }
 * Text carries the conversation's tokens ([CLIENT_1]) — never a name — and the
 * routes guard every block like any other message. Pure: no I/O.
 */

const FORMATS = Object.freeze({ document: 'document', casenote: 'casenote' });
const CASE_NOTE_HEADINGS = Object.freeze(['Identify', 'Session details', 'Plan']);
const MAX_BLOCKS = 80;
const MAX_BLOCK_CHARS = 3000;
const MAX_TOTAL_CHARS = 20000;
const MAX_TITLE_CHARS = 120;

const SHAPE = 'Reply with ONLY one JSON object, no prose before or after it and no code fence:\n'
  + '{"title": "short title or null", "blocks": [{"t": "h", "text": "Heading"}, {"t": "p", "text": "A paragraph."}, {"t": "li", "lead": "Optional bold label", "text": "A dot point."}]}\n'
  + '"t" is "h" (heading), "p" (paragraph) or "li" (dot point). "lead" is optional, only on dot points, a two-to-four word label without its colon. '
  + 'No Markdown anywhere: no asterisks, hashes or dashes for formatting — the page does the layout. Keep every token such as [CLIENT_1] exactly as written.';

function formatInstruction(format) {
  if (format === FORMATS.casenote) {
    return 'THIS REPLY IS A CASE NOTE DOCUMENT\nThe staff member wants a case note written or rewritten. It overrides the plain-text rule above. '
      + `Use EXACTLY three headings, in this order and with these words: ${CASE_NOTE_HEADINGS.map((h) => `"${h}"`).join(', ')}. `
      + 'Identify: one short paragraph — the date, where the session happened, who was present and their roles (participant, OT, support workers, family). '
      + 'Session details: dot points in the order things happened, each starting with a short bold "lead" where it helps (for example "Session setup", "Session course", "Response", "Outcome"); '
      + 'separate what was reported from what was observed. Plan: dot points for next steps and recommendations from the notes only. '
      + 'Write in the third person ("the OT"), past tense, objective, person-centred Australian English. Keep every fact, observation, quote, score and date; add nothing that is not in the notes. '
      + 'If the notes do not say something a section needs, write a short [square-bracket note] for the practitioner in that place rather than inventing it.\n' + SHAPE;
  }
  return 'THIS REPLY IS A DOCUMENT\nThe staff member wants writing rephrased, rewritten or drafted — an email, a letter, a report section or similar. It overrides the plain-text rule above. '
    + 'Return only the finished text as a document: paragraphs for prose, dot points only where the original or the task calls for a list, headings only if the piece genuinely has sections. '
    + 'For an email, put the greeting, body paragraphs and sign-off as separate paragraphs. No commentary about what you changed.\n' + SHAPE;
}

const clean = (s, max) => String(s == null ? '' : s).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').trim().slice(0, max);
const canonicalHeading = (s) => {
  const k = String(s || '').trim().replace(/[:：]\s*$/, '').toLowerCase();
  return CASE_NOTE_HEADINGS.find((h) => h.toLowerCase() === k) || null;
};

/**
 * Normalise and check a document (from the model, or edited in the page).
 * @returns {{ ok: true, doc } | { ok: false, reason }}
 */
function validateDocument(input, format) {
  const kind = format === FORMATS.casenote ? FORMATS.casenote : FORMATS.document;
  if (!input || typeof input !== 'object' || !Array.isArray(input.blocks)) return { ok: false, reason: 'no_blocks' };
  if (!input.blocks.length || input.blocks.length > MAX_BLOCKS) return { ok: false, reason: 'block_count' };
  let total = 0;
  const blocks = [];
  for (const b of input.blocks) {
    if (!b || typeof b !== 'object' || !['h', 'p', 'li'].includes(b.t)) return { ok: false, reason: 'block_type' };
    const text = clean(b.text, MAX_BLOCK_CHARS);
    const lead = b.t === 'li' && b.lead ? clean(b.lead, 60).replace(/[:：]\s*$/, '') : '';
    if (!text && !lead) continue;
    total += text.length + lead.length;
    blocks.push(lead ? { t: b.t, lead, text } : { t: b.t, text });
  }
  if (!blocks.length) return { ok: false, reason: 'empty' };
  if (total > MAX_TOTAL_CHARS) return { ok: false, reason: 'too_long' };
  if (kind === FORMATS.casenote) {
    const heads = blocks.filter((b) => b.t === 'h');
    if (heads.length !== CASE_NOTE_HEADINGS.length) return { ok: false, reason: 'casenote_headings' };
    for (let i = 0; i < heads.length; i++) {
      if (canonicalHeading(heads[i].text) !== CASE_NOTE_HEADINGS[i]) return { ok: false, reason: 'casenote_headings' };
      heads[i].text = CASE_NOTE_HEADINGS[i];
    }
    if (blocks[0].t !== 'h') return { ok: false, reason: 'casenote_starts_with_text' };
    for (let i = 0; i < blocks.length; i++) {
      if (blocks[i].t === 'h' && (i === blocks.length - 1 || blocks[i + 1].t === 'h')) return { ok: false, reason: 'casenote_empty_section' };
    }
  }
  const title = input.title ? clean(input.title, MAX_TITLE_CHARS) || null : null;
  return { ok: true, doc: { kind, title, blocks } };
}

/** Pull the JSON object out of a model reply and validate it. */
function parseDocument(text, format) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: 'not_json' };
  let raw;
  try { raw = JSON.parse(m[0]); } catch (_) { return { ok: false, reason: 'not_json' }; }
  return validateDocument(raw, format);
}

/** Plain text of a document — for the model's history and for search/audit sizes. */
function documentToText(doc) {
  if (!doc || !Array.isArray(doc.blocks)) return '';
  return doc.blocks.map((b) => {
    if (b.t === 'h') return `${b.text}:`;
    if (b.t === 'li') return `• ${b.lead ? `${b.lead}: ` : ''}${b.text}`;
    return b.text;
  }).join('\n');
}

/** Every piece of text in a document, for the send-path guard. */
function documentStrings(doc) {
  const out = [];
  if (doc && doc.title) out.push(doc.title);
  (doc && doc.blocks ? doc.blocks : []).forEach((b) => { if (b.lead) out.push(b.lead); if (b.text) out.push(b.text); });
  return out;
}

module.exports = {
  FORMATS, CASE_NOTE_HEADINGS, MAX_BLOCK_CHARS,
  formatInstruction, validateDocument, parseDocument, documentToText, documentStrings,
};
