'use strict';

/**
 * OPAL ASSIST REPORTS — the report builder's server half. Pure: no I/O.
 *
 * The Report builder (frontend/current/assist-report.js) attaches the
 * practitioner's TICKED case notes, numbered N1, N2 … in date order, plus
 * the goals or recommendation they typed, as ordinary attachments (checked
 * for names like any file). It then sends the chat message with
 * `report: { kind, goals }`. This module turns that into:
 *
 *   - the instruction appended to the system prompt: the exact headings of
 *     the matching Templates master (Progress Report / Support Letter), so
 *     the reply can be poured into that template section by section, and the
 *     CITATION rule — every statement taken from a note ends with its note
 *     number, "(N3)" or "(N2, N5)", so the practitioner can check each claim
 *     against its source before anything is used;
 *   - a heading check: the reply must carry those headings, in order (one
 *     correction is asked for, as for a case note).
 *
 * Headings here are the Templates section titles (templates/*-map.js); the
 * frontend maps them back onto the template's narrative fields. A test pins
 * the two lists together.
 */

const MAX_GOALS = 8;

const KINDS = Object.freeze({
  progress_report: {
    name: 'progress report',
    headings: (goals) => [
      'Background information',
      ...Array.from({ length: goals }, (_, i) => `Goal ${i + 1} progress`),
      'Overall summary of progress',
      'Core supports',
      'Capacity building',
    ],
    rules: 'This is an NDIS therapy progress report for the participant\'s plan review, read by the NDIA planner, the support coordinator and the family. '
      + 'Background information: who the participant is, their disability-related needs and why occupational therapy is involved, from the notes only. '
      + 'Each "Goal N progress" section is about the Nth goal in the attached goals list, in that order: where the participant started, what was worked on, what changed (with dates and any scores or measures from the notes), and what support is still needed. If no note covers a goal, say so in a [square-bracket note]. '
      + 'Overall summary of progress: overall gains, continuing difficulties and why ongoing support is required. '
      + 'Core supports and Capacity building: recommendations for the next plan drawn from the notes; never state hours, frequencies or dollar amounts unless a note states them — leave a [square-bracket note] instead.',
  },
  support_letter: {
    name: 'support letter',
    headings: () => [
      'Purpose of this letter',
      'Background and current situation',
      'Recommended support',
      'Clinical justification',
      'Value for money and alternatives considered',
      'Alignment with NDIS goals',
      'Impact if not funded',
      'Recommendation',
    ],
    rules: 'This is an NDIS support letter recommending the support described in the attached request, read by the NDIA. '
      + 'Purpose: what is recommended, for whom and the need, in one or two sentences. Background: disability, current functioning and how the task is managed now, including risks. '
      + 'Recommended support: the specification as given — never invent a product, model, price or supplier. Clinical justification: how it addresses the disability-related need, safety and independence, citing observations from the notes. '
      + 'Value for money: why this option and why lower-cost alternatives would not meet the need, only as far as the notes and request support it. '
      + 'Alignment with NDIS goals: link to the goals given. Impact if not funded: foreseeable risks. Recommendation: the formal recommendation in one short paragraph.',
  },
});

/** Read `body.report` → { kind, goals } or null. Anything unrecognised is null (an ordinary chat). */
function readReport(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = Object.prototype.hasOwnProperty.call(KINDS, raw.kind) ? raw.kind : null;
  if (!kind) return null;
  let goals = 0;
  if (kind === 'progress_report') {
    goals = Number.isInteger(raw.goals) ? Math.min(MAX_GOALS, Math.max(1, raw.goals)) : 1;
  }
  return { kind, goals };
}

function headingsFor(report) {
  return KINDS[report.kind].headings(report.goals);
}

const CITATION_RULE = 'CITE THE NOTES. The attached REPORT MATERIAL holds the practitioner\'s case notes, each headed with its number (N1, N2 …) and date. '
  + 'End every sentence or dot point that states something taken from the notes with the number of each note it came from, in round brackets: (N3), or (N2, N5) for several. '
  + 'Cite only notes that actually say it; never invent a note number. A sentence that comes from no note (a general NDIS framing sentence) has no citation — keep those few and plain. '
  + 'Write nothing about the participant that is not in the notes or the practitioner\'s own request: no history, diagnoses, scores, hours or funding that the material does not give.';

/** The system-prompt section for a report reply. */
function reportInstruction(report) {
  const spec = KINDS[report.kind];
  const heads = headingsFor(report);
  return `THIS REPLY IS A ${spec.name.toUpperCase()}\n`
    + `Use EXACTLY these ${heads.length} headings, in this order, each as an "h" block with these words: ${heads.map((h) => `"${h}"`).join(', ')}. `
    + 'Put no heading of your own and no title block before the first heading; set "title" to a short title such as "Progress report". Under each heading write paragraphs, with dot points only where a list genuinely helps. '
    + spec.rules + ' Third person, past tense for what happened, objective, person-centred and strengths-based Australian English, NDIS terminology. '
    + 'If the material does not cover something a heading needs, write a short [square-bracket note] for the practitioner in that place rather than inventing it.\n'
    + CITATION_RULE;
}

const norm = (s) => String(s || '').trim().replace(/[:：]\s*$/, '').replace(/\s+/g, ' ').toLowerCase();

/**
 * Do the document's headings match the report's, in order? Canonicalises the
 * wording in place when they do (case, a trailing colon). Returns a reason
 * string, or null when they match.
 */
function checkHeadings(doc, report) {
  const want = headingsFor(report);
  const heads = (doc && Array.isArray(doc.blocks) ? doc.blocks : []).filter((b) => b.t === 'h');
  if (heads.length !== want.length) return `report_headings: expected ${want.length} headings, got ${heads.length}`;
  for (let i = 0; i < want.length; i++) {
    if (norm(heads[i].text) !== norm(want[i])) return `report_headings: heading ${i + 1} should be "${want[i]}"`;
  }
  heads.forEach((h, i) => { h.text = want[i]; });
  return null;
}

module.exports = { KINDS, MAX_GOALS, readReport, headingsFor, reportInstruction, checkHeadings, CITATION_RULE };
