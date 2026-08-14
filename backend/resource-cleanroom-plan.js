'use strict';

/**
 * The clean-room backlog: 18 occupational-therapy company documents that must
 * be REPLACED rather than reused.
 *
 * WHAT A CLEAN ROOM MEANS HERE
 * None of the 18 source files has been opened. Not by this process, not to
 * "check the structure", not to extract headings. Every `purpose` below was
 * written from the catalogued title and ordinary professional knowledge of what
 * such a document is for. That is a deliberately stricter line than the brief
 * requires — it asks that only the general clinical purpose be carried across,
 * and the surest way to carry across nothing more is never to look.
 *
 * The consequence is worth stating plainly: an Opal replacement will not
 * resemble the original, will not have the same sections in the same order, and
 * is not a substitute for it. It is a new document addressing the same clinical
 * need. That is the point.
 *
 * WHY SOME ARE BLOCKED RATHER THAN DRAFTED
 * `riskTier` divides the backlog three ways.
 *
 *   'standard'      — a structural or educational template. Safe to draft, then
 *                     clinically reviewed before use.
 *   'high-clinical' — an assessment or report that carries a clinical judgement
 *                     about a person's function. A wrong structure here produces
 *                     wrong clinical conclusions and, in NDIS work, wrong funding
 *                     outcomes. These get a requirements brief, not a form.
 *   'legal'         — a contract. Drafting one is legal practice.
 *
 * `authorDraft` says whether this run produces a document. Where it is false the
 * backlog record and its blocker ARE the deliverable, and that is the honest
 * outcome rather than a half-authored clinical instrument.
 */

const CLEANROOM_BACKLOG = [
  // ── Legal ────────────────────────────────────────────────────────────────
  {
    catalogueId: 'res-0624', title: 'Service Agreement', riskTier: 'legal', authorDraft: false,
    purpose: 'Set out the commercial and service terms between the practice and a participant, including '
      + 'scope, fees, cancellation, privacy and termination.',
    blocker: 'LEGAL REVIEW REQUIRED. A service agreement is a contract and must be drafted or approved by a '
      + 'lawyer. NDIS service agreements also carry specific obligations under the NDIS Practice Standards '
      + 'and Australian Consumer Law. No draft has been generated.',
  },

  // ── High clinical risk — requirements brief only ─────────────────────────
  {
    catalogueId: 'res-0058', title: 'Neuro Assessment and Intervention Booklet',
    riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Guide neurological assessment and intervention planning across motor, sensory, cognitive and '
      + 'functional domains.',
    blocker: 'CLINICAL REVIEW REQUIRED before authoring. A neurological assessment booklet determines what a '
      + 'clinician examines; omissions become missed impairments. Scope and evidence base must be set by a '
      + 'senior clinician, not inferred from a title.',
  },
  {
    catalogueId: 'res-0614', title: 'Psychosocial Functional Assessment',
    riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Assess functional impact of psychosocial disability across daily living, social and community '
      + 'participation domains to support NDIS evidence.',
    blocker: 'CLINICAL REVIEW REQUIRED before authoring. Psychosocial functional assessment drives access '
      + 'and funding decisions and intersects with recovery-oriented practice standards. Requires a '
      + 'clinician with mental-health scope to define the domains.',
  },
  {
    catalogueId: 'res-0599', title: 'OT Report', riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Report occupational therapy assessment findings, functional impact and recommendations to a '
      + 'funder or referrer.',
    blocker: 'OVERLAPS EXISTING PORTAL FUNCTIONALITY. Opal already generates FCA reports and progress note '
      + 'letters from governed templates. A second static report template would compete with them. Decide '
      + 'whether this is wanted at all before authoring.',
  },
  {
    catalogueId: 'res-0622', title: 'Multidisciplinary Care Therapy Plan',
    riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Coordinate goals, interventions and responsibilities across multiple therapy disciplines for '
      + 'one participant.',
    blocker: 'CLINICAL REVIEW REQUIRED before authoring. A multidisciplinary plan allocates clinical '
      + 'responsibility between professions; the boundaries must be agreed by those professions.',
  },
  {
    catalogueId: 'res-0519', title: 'General Assistive Technology Needs Assessment',
    riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Assess a participant\'s assistive technology needs, trial outcomes and the functional '
      + 'justification for a recommended solution.',
    blocker: 'CLINICAL REVIEW REQUIRED before authoring. AT assessment structure must align to current NDIA '
      + 'AT evidence expectations, which change; a clinician should confirm the required evidence set.',
  },
  {
    catalogueId: 'res-0625', title: 'Cooking Assessment', riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Assess kitchen and meal-preparation performance, including safety, sequencing and equipment '
      + 'use, in a functional context.',
    blocker: 'CLINICAL REVIEW REQUIRED before authoring. A kitchen assessment is a safety assessment — burns, '
      + 'scalds and knife handling. The risk criteria must be set clinically.',
  },
  {
    catalogueId: 'res-0634', title: 'Standardised and Formal Assessments (student resource)',
    riskTier: 'high-clinical', authorDraft: false,
    purpose: 'Orient students to the standardised assessments used in occupational therapy practice.',
    blocker: 'RECOMMEND NOT RECREATING. The source is a student project, and Opal already holds an '
      + 'Assessment Tool Directory plus the controlled-instrument register, which serve this purpose with '
      + 'governed licensing information. Confirm whether to retire this backlog item.',
  },

  // ── Standard — safe to draft ─────────────────────────────────────────────
  {
    catalogueId: 'res-0517', title: 'Mid-cost AT letter — funding already in plan',
    riskTier: 'standard', authorDraft: true,
    purpose: 'Letter recording the functional justification for a mid-cost assistive technology item where '
      + 'the participant\'s plan already holds sufficient funding.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0518', title: 'Mid-cost AT letter — no funding in plan',
    riskTier: 'standard', authorDraft: true,
    purpose: 'Letter requesting mid-cost assistive technology where the participant\'s plan does not hold '
      + 'sufficient funding, setting out functional need and the consequence of not funding it.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0520', title: 'Low-cost AT letter', riskTier: 'standard', authorDraft: true,
    purpose: 'Brief letter recording the clinical reasoning for a low-cost assistive technology item.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0521', title: 'Manual Handling Plan', riskTier: 'standard', authorDraft: true,
    purpose: 'Record how a participant is to be transferred and supported, including equipment, number of '
      + 'assistants and identified risks, so support workers act consistently.',
    blocker: 'Clinical review required before use. Manual handling plans carry worker and participant safety '
      + 'consequences and must be signed off by the assessing clinician for each participant.',
  },
  {
    catalogueId: 'res-0522', title: 'SDA Sole Occupancy Evidence', riskTier: 'standard', authorDraft: true,
    purpose: 'Set out the evidence for why a participant requires sole-occupancy specialist disability '
      + 'accommodation rather than a shared arrangement.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0604', title: 'Emergency Social Housing Letter', riskTier: 'standard', authorDraft: true,
    purpose: 'Support an urgent social housing application by describing functional need, current housing '
      + 'unsuitability and associated risk.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0613', title: 'General Letter Template', riskTier: 'standard', authorDraft: true,
    purpose: 'A general-purpose practice letterhead structure for correspondence that does not fit a '
      + 'specific clinical template.',
    blocker: 'Brand review required. Note Opal already generates progress note letters from a governed '
      + 'template; this is for correspondence outside that workflow.',
  },
  {
    catalogueId: 'res-0623', title: 'MDT Information Gathering', riskTier: 'standard', authorDraft: true,
    purpose: 'Collect background information from other team members and services before a '
      + 'multidisciplinary discussion, so the meeting starts from a shared picture.',
    blocker: 'Clinical review required before use.',
  },
  {
    catalogueId: 'res-0628', title: 'Paediatric Initial Interview', riskTier: 'standard', authorDraft: true,
    purpose: 'Structure a first conversation with a child\'s family, covering developmental history, daily '
      + 'routines, participation concerns and family priorities.',
    blocker: 'Clinical review required before use. Paediatric intake must be reviewed by a clinician working '
      + 'with children.',
  },
  {
    catalogueId: 'res-0501', title: 'Oral Hygiene', riskTier: 'standard', authorDraft: true,
    purpose: 'Plain-language guidance on supporting daily oral care for a person who needs assistance, '
      + 'including positioning, equipment and building a routine.',
    blocker: 'Clinical review required before use. Confirm scope boundary with dental and speech pathology '
      + 'where swallowing risk is present.',
  },
];

/** The subset this run produces documents for. */
function draftable() {
  return CLEANROOM_BACKLOG.filter((i) => i.authorDraft);
}
function blocked() {
  return CLEANROOM_BACKLOG.filter((i) => !i.authorDraft);
}

module.exports = { CLEANROOM_BACKLOG, draftable, blocked };
