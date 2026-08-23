'use strict';

/**
 * SERVICE AGREEMENT — THE TEMPLATE CONTRACT
 *
 * The single declaration of what the master Word template contains and what
 * each control means. Nothing downstream re-derives any of this: the engine,
 * the validator, the PDF renderer, the resolver, the wizard and the tests all
 * read THIS file, so "what is a signature field" has exactly one answer.
 *
 * ── TAGS ARE THE IDENTIFIERS. NOTHING ELSE IS ──────────────────────────────
 * Every control is addressed by its `w:tag`. Visible text, `w:alias`,
 * paragraph order and heading wording are NOT identifiers and are never used
 * to find, remove, clone or reorder anything. The aliases recorded below are
 * documentation and are how the ORIGINAL author expressed field authority —
 * they are reproduced so a reviewer can check this map against the document,
 * not so that code can match on them.
 *
 * ── THE CONTRACT, AS MEASURED ──────────────────────────────────────────────
 * Measured against the v1.0 master, not asserted from the specification:
 *
 *   83   unique scalar tags
 *   23   unique block tags
 *   106  unique tags overall
 *   126  content-control occurrences across the package
 *          124 in word/document.xml + 1 in word/header6.xml + 1 in word/footer6.xml
 *   124  content controls in the body, every one with a unique w:id
 *   81   controls nested inside another control
 *
 * The header carries OPAL_AGREEMENT_ID and the footer carries
 * OPAL_AGREEMENT_VERSION. A body-only implementation would ship an agreement
 * whose running head still said "[PORTAL — AGREEMENT ID]", which is why
 * CONTROL_PARTS names all three parts and why the counts above are stated per
 * part rather than as one number.
 *
 * ── FIELD AUTHORITY ────────────────────────────────────────────────────────
 * Authority is who is ALLOWED to put a value in a field, and it is enforced,
 * not advisory. There are four authorities:
 *
 *   server    Opal issues it. No user, form, upload or query parameter can
 *             set it — agreement id, version, status, template hash, the
 *             issue timestamp.
 *   owner     the practice owns it. It comes from the organisation snapshot
 *             pinned at issue, never from the staff member filling in the
 *             agreement — legal name, ABN, NDIS registration, payment terms.
 *   portal    instance data about THIS agreement: the participant, their
 *             representative, plan, supports, preferences and consents.
 *   esign     only a completed signing session may write it. A signature that
 *             arrived on an ordinary form save is not a signature, and
 *             `writableBy` returns false for every non-signing caller.
 *
 * ── PROMPTS ARE FOR HUMANS ─────────────────────────────────────────────────
 * Every scalar carries a `prompt`. It is what a participant sees in a blank
 * field — "Enter participant full name", not "[PORTAL — PARTICIPANT FULL
 * NAME]" and not "OPAL_PARTICIPANT_FULL_NAME". The template's own bracketed
 * placeholders are internal drafting furniture and MUST NOT reach a
 * participant; assertNoForbiddenTokens() in ./docx.js is what actually
 * guarantees that, and this map is what it replaces them with.
 */

const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
//  Identity
// ─────────────────────────────────────────────────────────────────────────────

const TEMPLATE_KEY = 'service_agreement';
const TEMPLATE_NAME = 'Opal Therapy Service Agreement';
const SEED_VERSION = '1.0.1';
const SEED_TEMPLATE_FILE = path.join(__dirname, 'templates', 'service-agreement-v1.0.1.docx');

/**
 * The hash of the bundled master. Recorded so a validation report can say
 * whether the bytes on disk are still the bytes that were reviewed — it is NOT
 * a gate on uploads, because an owner publishing a revised master will
 * legitimately produce a different hash.
 */
const SEED_TEMPLATE_SHA256 =
  'afb1e1e8ae5dafde60e3cf04220f00ec557cc3cc87ce21ff11d27c6b8a334d14';

/**
 * v1.0 — the master this patch supersedes, kept for audit and for the upgrade.
 *
 * v1.0.1 is v1.0 with `<w:updateFields w:val="true"/>` removed from
 * word/settings.xml and NOTHING else. Every other part of the package —
 * word/document.xml, the styles, the header, the footer, the numbering, the
 * media — is byte-for-byte identical, so the patch changes no clause, no
 * schedule and no clinical content. It exists because that one setting made
 * Word recalculate every field on open and warn a participant that the
 * document "contains fields that may refer to other files"; the agreement's
 * only fields are its own PAGE and NUMPAGES.
 *
 * An organisation still on v1.0 is upgraded automatically the next time the
 * master is read — see ensurePublishedMaster in service-agreement-routes.js.
 * Agreements already issued against v1.0 stay pinned to it and are not
 * reissued: what a participant signed is what they signed.
 */
const SUPERSEDED_TEMPLATE_SHA256 =
  '9c6bb10688ca5a5c322fb48a6901692f92c12045afb0cde270ca6dd1b13dee27';

/** The version an automatic safety patch replaces, and what it is called. */
const PATCH_FROM_VERSION = '1.0';
const PATCH_REASON = 'Safety patch: removes automatic Word field updating '
  + '(w:updateFields). No clause, schedule or clinical-content change.';

/** Parts that may carry content controls. Ordered as the package stores them. */
const CONTROL_PARTS = ['word/document.xml', 'word/header6.xml', 'word/footer6.xml'];

/** Document-reference prefix, matching fca/document-id.js's convention. */
const DOCUMENT_PREFIX = 'SVA';

// ─────────────────────────────────────────────────────────────────────────────
//  Control kinds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How a blank field behaves. The kind drives BOTH the Word control that
 * survives in a manual copy and the AcroForm widget in the fillable PDF, which
 * is why there is one vocabulary rather than two.
 */
const KIND = {
  TEXT: 'text',             // single-line text
  MULTILINE: 'multiline',   // address, notes, goals — real line breaks
  DATE: 'date',             // DD/MM/YYYY
  CHOICE: 'choice',         // a fixed option set — radio group in the PDF
  SIGNATURE: 'signature',   // signature widget; esign authority only
};

const AUTHORITY = {
  SERVER: 'server',
  OWNER: 'owner',
  PORTAL: 'portal',
  ESIGN: 'esign',
};

/** Option sets, taken from the template's own alias wording. */
const CHOICES = {
  YES_NO_DISCUSS: ['Yes', 'No', 'Discuss further'],
  YES_NO: ['Yes', 'No'],
  FUNDING: ['NDIA managed', 'Plan managed', 'Self managed'],
  DELIVERY: ['In person', 'Telehealth', 'Other'],
  RECEIPT: ['Email', 'Download', 'Print'],
};

// ─────────────────────────────────────────────────────────────────────────────
//  The 83 scalar tags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `s(tag, authority, kind, prompt, extra)` — one scalar.
 *
 * `occurrences` is the number of places the tag appears in the package and is
 * asserted by the validator: a template that grew a second copy of
 * OPAL_PARTICIPANT_FULL_NAME without anyone noticing would populate one and
 * leave the other showing a placeholder.
 *
 * `pdfName` is the AcroForm field name. It is human-readable on purpose — a
 * participant who inspects the form, or a screen reader announcing it, should
 * hear "Participant full name", not a tag.
 */
function s(tag, authority, kind, prompt, extra = {}) {
  return {
    tag,
    authority,
    kind,
    prompt,
    occurrences: extra.occurrences || 1,
    alias: extra.alias || null,
    choices: extra.choices || null,
    pdfName: extra.pdfName || null,
    // Fields a participant may complete in their own signing session or in a
    // downloaded PDF. Everything else is locked once the agreement is issued.
    participantEditable: extra.participantEditable === true,
    // Lives inside OPAL_REPEAT_SUPPORT_ROW, so it is cloned per support and
    // its PDF widget is indexed rather than canonical.
    repeatRow: extra.repeatRow === true,
    // Lives in the single "Support-row detail" panel: one control, describing
    // the first support. See the Supports block below for why.
    detail: extra.detail === true,
    group: extra.group,
  };
}

const SCALARS = [
  // ── Agreement identity — server issued ────────────────────────────────────
  s('OPAL_AGREEMENT_ID', AUTHORITY.SERVER, KIND.TEXT, 'Agreement reference',
    { occurrences: 3, alias: 'PORTAL — AGREEMENT ID', pdfName: 'Agreement reference', group: 'agreement' }),
  s('OPAL_AGREEMENT_VERSION', AUTHORITY.SERVER, KIND.TEXT, 'Agreement version',
    { occurrences: 3, alias: 'OWNER — PUBLISHED VERSION', pdfName: 'Agreement version', group: 'agreement' }),
  s('OPAL_AGREEMENT_STATUS', AUTHORITY.SERVER, KIND.TEXT, 'Agreement status',
    { occurrences: 3, alias: 'OWNER — PUBLICATION STATUS', pdfName: 'Agreement status', group: 'agreement' }),
  s('OPAL_MASTER_TEMPLATE_HASH', AUTHORITY.SERVER, KIND.TEXT, 'Master template hash',
    { alias: 'SERVER — PUBLISHED TEMPLATE HASH', pdfName: 'Master template hash', group: 'agreement' }),
  s('OPAL_AGREEMENT_ISSUE_DATE', AUTHORITY.SERVER, KIND.DATE, 'Issue date',
    { occurrences: 2, alias: 'PORTAL — ISSUE DATE', pdfName: 'Issue date', group: 'agreement' }),

  // ── Agreement term — portal ───────────────────────────────────────────────
  s('OPAL_AGREEMENT_START_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Enter agreement start date',
    { occurrences: 2, alias: 'PORTAL — AGREEMENT START DATE', pdfName: 'Agreement start date', group: 'agreement' }),
  s('OPAL_AGREEMENT_END_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Enter agreement end date',
    { occurrences: 2, alias: 'PORTAL — AGREEMENT END DATE', pdfName: 'Agreement end date', group: 'agreement' }),
  s('OPAL_AGREEMENT_REVIEW_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Enter review date',
    { alias: 'PORTAL — REVIEW DATE', pdfName: 'Review date', group: 'agreement' }),
  s('OPAL_ATTACHED_DOCUMENTS', AUTHORITY.PORTAL, KIND.MULTILINE, 'List any attached documents, or write None',
    { alias: 'PORTAL — ATTACHED DOCUMENTS OR NONE', pdfName: 'Attached documents', group: 'agreement' }),

  // ── Organisation — owner controlled ───────────────────────────────────────
  s('OPAL_ORG_LEGAL_NAME', AUTHORITY.OWNER, KIND.TEXT, 'Legal entity name',
    { alias: 'OWNER — LEGAL ENTITY NAME', pdfName: 'Provider legal name', group: 'organisation' }),
  s('OPAL_ORG_TRADING_NAME', AUTHORITY.OWNER, KIND.TEXT, 'Trading name',
    { occurrences: 2, alias: 'OWNER — TRADING NAME', pdfName: 'Provider trading name', group: 'organisation' }),
  s('OPAL_ORG_ABN', AUTHORITY.OWNER, KIND.TEXT, 'ABN',
    { occurrences: 2, alias: 'OWNER — ABN', pdfName: 'Provider ABN', group: 'organisation' }),
  s('OPAL_ORG_NDIS_REGISTRATION_NUMBER', AUTHORITY.OWNER, KIND.TEXT, 'NDIS registration number',
    { alias: 'OWNER — NDIS REGISTRATION NUMBER', pdfName: 'Provider NDIS registration number', group: 'organisation' }),
  s('OPAL_ORG_ADDRESS', AUTHORITY.OWNER, KIND.MULTILINE, 'Business address',
    { alias: 'OWNER — BUSINESS ADDRESS', pdfName: 'Provider address', group: 'organisation' }),
  s('OPAL_ORG_PHONE', AUTHORITY.OWNER, KIND.TEXT, 'Business phone',
    { occurrences: 2, alias: 'OWNER — BUSINESS PHONE', pdfName: 'Provider phone', group: 'organisation' }),
  s('OPAL_ORG_EMAIL', AUTHORITY.OWNER, KIND.TEXT, 'Business email',
    { occurrences: 2, alias: 'OWNER — BUSINESS EMAIL', pdfName: 'Provider email', group: 'organisation' }),
  s('OPAL_ORG_WEBSITE', AUTHORITY.OWNER, KIND.TEXT, 'Website',
    { alias: 'OWNER — WEBSITE', pdfName: 'Provider website', group: 'organisation' }),
  s('OPAL_ORG_COMPLAINTS_CONTACT', AUTHORITY.OWNER, KIND.TEXT, 'Complaints contact',
    { occurrences: 2, alias: 'OWNER — COMPLAINTS CONTACT', pdfName: 'Complaints contact', group: 'organisation' }),
  s('OPAL_ORG_PRIVACY_CONTACT', AUTHORITY.OWNER, KIND.TEXT, 'Privacy contact',
    { alias: 'OWNER — PRIVACY CONTACT', pdfName: 'Privacy contact', group: 'organisation' }),
  s('OPAL_PAYMENT_TERMS_DAYS', AUTHORITY.OWNER, KIND.TEXT, 'Payment terms in days',
    { alias: 'OWNER — PAYMENT TERMS IN DAYS', pdfName: 'Payment terms in days', group: 'organisation' }),

  // ── Participant ───────────────────────────────────────────────────────────
  s('OPAL_PARTICIPANT_FULL_NAME', AUTHORITY.PORTAL, KIND.TEXT, 'Enter participant full name',
    { occurrences: 2, alias: 'PORTAL — PARTICIPANT FULL NAME', pdfName: 'Participant full name', group: 'participant' }),
  s('OPAL_PARTICIPANT_PREFERRED_NAME', AUTHORITY.PORTAL, KIND.TEXT, 'Enter preferred name',
    { alias: 'PORTAL — PREFERRED NAME', pdfName: 'Participant preferred name', group: 'participant' }),
  s('OPAL_PARTICIPANT_DATE_OF_BIRTH', AUTHORITY.PORTAL, KIND.DATE, 'Enter date of birth',
    { alias: 'PORTAL — DATE OF BIRTH', pdfName: 'Participant date of birth', group: 'participant' }),
  s('OPAL_PARTICIPANT_NDIS_NUMBER', AUTHORITY.PORTAL, KIND.TEXT, 'Enter NDIS number',
    { occurrences: 2, alias: 'PORTAL — NDIS NUMBER', pdfName: 'Participant NDIS number', group: 'participant' }),
  s('OPAL_PARTICIPANT_ADDRESS', AUTHORITY.PORTAL, KIND.MULTILINE, 'Enter participant address',
    { alias: 'PORTAL — PARTICIPANT ADDRESS', pdfName: 'Participant address', group: 'participant',
      participantEditable: true }),
  s('OPAL_PARTICIPANT_PHONE', AUTHORITY.PORTAL, KIND.TEXT, 'Enter participant phone',
    { alias: 'PORTAL — PARTICIPANT PHONE', pdfName: 'Participant phone', group: 'participant',
      participantEditable: true }),
  s('OPAL_PARTICIPANT_EMAIL', AUTHORITY.PORTAL, KIND.TEXT, 'Enter participant email',
    { alias: 'PORTAL — PARTICIPANT EMAIL', pdfName: 'Participant email', group: 'participant',
      participantEditable: true }),
  s('OPAL_PARTICIPANT_PLAN_START_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Enter plan start date',
    { alias: 'PORTAL — PLAN START DATE', pdfName: 'Plan start date', group: 'plan' }),
  s('OPAL_PARTICIPANT_PLAN_END_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Enter plan end date',
    { alias: 'PORTAL — PLAN END DATE', pdfName: 'Plan end date', group: 'plan' }),
  s('OPAL_PARTICIPANT_GOALS', AUTHORITY.PORTAL, KIND.MULTILINE, 'Enter the goals this agreement supports',
    { alias: 'PORTAL — PARTICIPANT GOALS', pdfName: 'Participant goals', group: 'participant',
      participantEditable: true }),
  s('OPAL_PARTICIPANT_PREFERRED_COMMUNICATION', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter preferred way to be contacted',
    { occurrences: 2, alias: 'PORTAL — PREFERRED COMMUNICATION', pdfName: 'Preferred communication',
      group: 'preferences', participantEditable: true }),
  s('OPAL_PARTICIPANT_COMMUNICATION_SUPPORTS', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter any communication supports needed',
    { occurrences: 2, alias: 'PORTAL — COMMUNICATION SUPPORTS', pdfName: 'Communication supports',
      group: 'preferences', participantEditable: true }),

  // ── Representative ────────────────────────────────────────────────────────
  s('OPAL_REPRESENTATIVE_FULL_NAME', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter representative name, or write Not applicable',
    { alias: 'PORTAL — REPRESENTATIVE NAME OR NOT APPLICABLE', pdfName: 'Representative full name',
      group: 'representative', participantEditable: true }),
  s('OPAL_REPRESENTATIVE_RELATIONSHIP', AUTHORITY.PORTAL, KIND.TEXT, 'Enter relationship to participant',
    { alias: 'PORTAL — REPRESENTATIVE RELATIONSHIP', pdfName: 'Representative relationship',
      group: 'representative', participantEditable: true }),
  s('OPAL_REPRESENTATIVE_AUTHORITY', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter the authority they act under',
    { alias: 'PORTAL — REPRESENTATIVE AUTHORITY', pdfName: 'Representative authority',
      group: 'representative', participantEditable: true }),
  s('OPAL_REPRESENTATIVE_PHONE', AUTHORITY.PORTAL, KIND.TEXT, 'Enter representative phone',
    { alias: 'PORTAL — REPRESENTATIVE PHONE', pdfName: 'Representative phone',
      group: 'representative', participantEditable: true }),
  s('OPAL_REPRESENTATIVE_EMAIL', AUTHORITY.PORTAL, KIND.TEXT, 'Enter representative email',
    { alias: 'PORTAL — REPRESENTATIVE EMAIL', pdfName: 'Representative email',
      group: 'representative', participantEditable: true }),

  // ── Funding and invoicing ─────────────────────────────────────────────────
  s('OPAL_FUNDING_MANAGEMENT_TYPE', AUTHORITY.PORTAL, KIND.CHOICE, 'Select how the plan is managed',
    { occurrences: 2, alias: 'PORTAL — NDIA / PLAN / SELF MANAGED', choices: CHOICES.FUNDING,
      pdfName: 'Funding management type', group: 'funding' }),
  s('OPAL_PLAN_MANAGER_NAME', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter plan manager name, or write Not applicable',
    { alias: 'PORTAL — PLAN MANAGER NAME OR NOT APPLICABLE', pdfName: 'Plan manager name', group: 'funding' }),
  s('OPAL_PLAN_MANAGER_EMAIL', AUTHORITY.PORTAL, KIND.TEXT, 'Enter plan manager email',
    { alias: 'PORTAL — PLAN MANAGER EMAIL', pdfName: 'Plan manager email', group: 'funding' }),
  s('OPAL_INVOICE_RECIPIENT', AUTHORITY.PORTAL, KIND.TEXT, 'Enter who invoices are sent to',
    { alias: 'PORTAL — INVOICE RECIPIENT', pdfName: 'Invoice recipient', group: 'funding' }),
  s('OPAL_INVOICE_EMAIL', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the invoice email address',
    { alias: 'PORTAL — INVOICE EMAIL', pdfName: 'Invoice email', group: 'funding' }),

  // ── Supports ──────────────────────────────────────────────────────────────
  // Schedule A is in TWO parts, and the difference is load-bearing.
  //
  //   `repeatRow: true`  — one of the FIVE columns of the table row wrapped by
  //     OPAL_REPEAT_SUPPORT_ROW. The row is cloned once per agreed support, so
  //     these five carry a value per support and get indexed PDF widgets.
  //
  //   `detail: true`     — one of the SEVEN fields in the single "Support-row
  //     detail" panel beneath the table. The template gives each exactly ONE
  //     control, so they describe the FIRST support; composition emits an
  //     explicit warning when there is more than one, rather than silently
  //     showing support 1's location under a table listing three supports.
  //
  // This is measured from the v1.0 master, not assumed. Inventing a second
  // repeat control to make all twelve per-support would break the contract the
  // owner's Word file actually declares.
  s('OPAL_SUPPORT_ITEM_NUMBER', AUTHORITY.PORTAL, KIND.TEXT, 'Enter support item number',
    { alias: 'PORTAL — SUPPORT ITEM NUMBER', pdfName: 'Support item number', group: 'supports', repeatRow: true }),
  s('OPAL_SUPPORT_DESCRIPTION', AUTHORITY.PORTAL, KIND.TEXT, 'Enter support description',
    { alias: 'PORTAL — SUPPORT DESCRIPTION', pdfName: 'Support description', group: 'supports', repeatRow: true }),
  s('OPAL_SUPPORT_DELIVERY_METHOD', AUTHORITY.PORTAL, KIND.CHOICE, 'Select how the support is delivered',
    { alias: 'PORTAL — IN PERSON / TELEHEALTH / OTHER', choices: CHOICES.DELIVERY,
      pdfName: 'Support delivery method', group: 'supports', repeatRow: true }),
  s('OPAL_SUPPORT_FREQUENCY', AUTHORITY.PORTAL, KIND.TEXT, 'Enter frequency or hours',
    { alias: 'PORTAL — FREQUENCY OR HOURS', pdfName: 'Support frequency', group: 'supports', repeatRow: true }),
  s('OPAL_SUPPORT_RATE', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the agreed rate',
    { alias: 'PORTAL — AGREED RATE', pdfName: 'Support rate', group: 'supports', repeatRow: true }),

  s('OPAL_SUPPORT_LOCATION', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the delivery location',
    { alias: 'PORTAL — DELIVERY LOCATION', pdfName: 'Support location', group: 'supports', detail: true }),
  s('OPAL_SUPPORT_UNIT', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the rate unit',
    { alias: 'PORTAL — RATE UNIT', pdfName: 'Support unit', group: 'supports', detail: true }),
  s('OPAL_SUPPORT_ESTIMATED_QUANTITY', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the estimated quantity',
    { alias: 'PORTAL — ESTIMATED QUANTITY', pdfName: 'Support estimated quantity', group: 'supports', detail: true }),
  s('OPAL_SUPPORT_ESTIMATED_TOTAL', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the estimated total',
    { alias: 'PORTAL — ESTIMATED TOTAL', pdfName: 'Support estimated total', group: 'supports', detail: true }),
  s('OPAL_SUPPORT_FUNDING_PERIOD', AUTHORITY.PORTAL, KIND.TEXT, 'Enter the funding period',
    { alias: 'PORTAL — FUNDING PERIOD', pdfName: 'Support funding period', group: 'supports', detail: true }),
  s('OPAL_SUPPORT_TRAVEL_TERMS', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter travel and non-face-to-face terms',
    { alias: 'PORTAL — TRAVEL AND NON-FACE-TO-FACE TERMS', pdfName: 'Support travel terms',
      group: 'supports', detail: true }),
  s('OPAL_SUPPORT_CANCELLATION_TERMS', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter the cancellation terms for this support',
    { alias: 'PORTAL — CANCELLATION TERMS FOR THIS SUPPORT', pdfName: 'Support cancellation terms',
      group: 'supports', detail: true }),

  // ── Preferences, access and continuity ────────────────────────────────────
  s('OPAL_SERVICE_LOCATION_PREFERENCES', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter preferred service locations',
    { alias: 'PORTAL — SERVICE LOCATION PREFERENCES', pdfName: 'Service location preferences',
      group: 'preferences', participantEditable: true }),
  s('OPAL_ACCESSIBILITY_REQUIREMENTS', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter any accessibility requirements',
    { alias: 'PORTAL — ACCESSIBILITY REQUIREMENTS', pdfName: 'Accessibility requirements',
      group: 'preferences', participantEditable: true }),
  s('OPAL_INTERPRETER_REQUIREMENTS', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter interpreter requirements',
    { alias: 'PORTAL — INTERPRETER REQUIREMENTS', pdfName: 'Interpreter requirements',
      group: 'preferences', participantEditable: true }),
  s('OPAL_CULTURAL_SAFETY_PREFERENCES', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter any cultural or safety preferences',
    { alias: 'PORTAL — CULTURAL OR SAFETY PREFERENCES', pdfName: 'Cultural safety preferences',
      group: 'preferences', participantEditable: true }),
  s('OPAL_CONTINUITY_PLAN_SUMMARY', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Enter a summary of the continuity plan',
    { alias: 'PORTAL — EMERGENCY OR DISASTER CONTINUITY PLAN SUMMARY',
      pdfName: 'Continuity plan summary', group: 'preferences' }),
  s('OPAL_EMERGENCY_CONTACT_NAME', AUTHORITY.PORTAL, KIND.TEXT, 'Enter emergency contact name',
    { alias: 'PORTAL — EMERGENCY CONTACT NAME', pdfName: 'Emergency contact name',
      group: 'preferences', participantEditable: true }),
  s('OPAL_EMERGENCY_CONTACT_RELATIONSHIP', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter emergency contact relationship',
    { alias: 'PORTAL — EMERGENCY CONTACT RELATIONSHIP', pdfName: 'Emergency contact relationship',
      group: 'preferences', participantEditable: true }),
  s('OPAL_EMERGENCY_CONTACT_PHONE', AUTHORITY.PORTAL, KIND.TEXT, 'Enter emergency contact phone',
    { alias: 'PORTAL — EMERGENCY CONTACT PHONE', pdfName: 'Emergency contact phone',
      group: 'preferences', participantEditable: true }),

  // ── Consents — the participant's own choices ──────────────────────────────
  s('OPAL_CONSENT_SHARE_INFORMATION', AUTHORITY.PORTAL, KIND.CHOICE,
    'Do you agree to information being shared?',
    { alias: 'PORTAL — YES / NO / DISCUSS', choices: CHOICES.YES_NO_DISCUSS,
      pdfName: 'Consent to share information', group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_SHARE_WITH', AUTHORITY.PORTAL, KIND.MULTILINE,
    'List the people or organisations information may be shared with',
    { alias: 'PORTAL — AUTHORISED PEOPLE OR ORGANISATIONS', pdfName: 'Information shared with',
      group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_SHARE_EXCLUSIONS', AUTHORITY.PORTAL, KIND.MULTILINE,
    'List anything that must not be shared',
    { alias: 'PORTAL — SHARING LIMITS OR EXCLUSIONS', pdfName: 'Sharing exclusions',
      group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_CLINICAL_MEDIA', AUTHORITY.PORTAL, KIND.CHOICE,
    'Do you agree to clinical photos or video?',
    { alias: 'PORTAL — YES / NO / DISCUSS', choices: CHOICES.YES_NO_DISCUSS,
      pdfName: 'Consent to clinical media', group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_STUDENT_OBSERVER', AUTHORITY.PORTAL, KIND.CHOICE,
    'Do you agree to a student observer?',
    { alias: 'PORTAL — YES / NO / DISCUSS', choices: CHOICES.YES_NO_DISCUSS,
      pdfName: 'Consent to student observer', group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_AI_ASSISTED', AUTHORITY.PORTAL, KIND.CHOICE,
    'Do you agree to AI-assisted note taking?',
    { alias: 'PORTAL — YES / NO / DISCUSS', choices: CHOICES.YES_NO_DISCUSS,
      pdfName: 'Consent to AI-assisted technology', group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_MARKETING', AUTHORITY.PORTAL, KIND.CHOICE,
    'Do you agree to marketing contact?',
    { alias: 'PORTAL — YES / NO', choices: CHOICES.YES_NO,
      pdfName: 'Consent to marketing', group: 'consents', participantEditable: true }),
  s('OPAL_CONSENT_NOTES', AUTHORITY.PORTAL, KIND.MULTILINE,
    'Add any notes or conditions about these consents',
    { alias: 'PORTAL — CONSENT NOTES OR CONDITIONS', pdfName: 'Consent notes',
      group: 'consents', participantEditable: true }),

  // ── Provider signatory identity — portal, not e-sign ──────────────────────
  // The NAME and ROLE of the person signing for Opal are ordinary instance
  // data the issuing staff member supplies. Only the SIGNATURE and the SIGNED
  // DATE are e-sign controlled.
  s('OPAL_PROVIDER_SIGNATORY_NAME', AUTHORITY.PORTAL, KIND.TEXT, 'Enter provider signatory name',
    { alias: 'PORTAL — PROVIDER SIGNATORY NAME', pdfName: 'Provider signatory name', group: 'signature' }),
  s('OPAL_PROVIDER_SIGNATORY_ROLE', AUTHORITY.PORTAL, KIND.TEXT, 'Enter provider signatory role',
    { alias: 'PORTAL — PROVIDER SIGNATORY ROLE', pdfName: 'Provider signatory role', group: 'signature' }),
  s('OPAL_PARTICIPANT_SIGNATORY_NAME', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter the name of the person signing',
    { alias: 'PORTAL — PARTICIPANT OR REPRESENTATIVE SIGNATORY',
      pdfName: 'Participant signatory name', group: 'signature', participantEditable: true }),
  s('OPAL_PARTICIPANT_SIGNATORY_CAPACITY', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter the capacity they are signing in',
    { alias: 'PORTAL — SIGNATORY CAPACITY', pdfName: 'Participant signatory capacity',
      group: 'signature', participantEditable: true }),
  s('OPAL_WITNESS_NAME', AUTHORITY.PORTAL, KIND.TEXT,
    'Enter witness name, or write Not required',
    { alias: 'PORTAL — WITNESS NAME OR NOT REQUIRED', pdfName: 'Witness name',
      group: 'signature', participantEditable: true }),
  s('OPAL_PARTICIPANT_RECEIPT_METHOD', AUTHORITY.PORTAL, KIND.CHOICE,
    'How was the signed copy provided?',
    { occurrences: 2, alias: 'PORTAL — EMAIL / DOWNLOAD / PRINT', choices: CHOICES.RECEIPT,
      pdfName: 'Signed copy provided by', group: 'signature' }),
  s('OPAL_PARTICIPANT_RECEIPT_DATE', AUTHORITY.PORTAL, KIND.DATE, 'Date the signed copy was provided',
    { alias: 'PORTAL — SIGNED COPY PROVIDED DATE', pdfName: 'Signed copy provided date', group: 'signature' }),

  // ── Signatures — e-sign authority only ────────────────────────────────────
  s('OPAL_PARTICIPANT_SIGNATURE', AUTHORITY.ESIGN, KIND.SIGNATURE,
    'Participant or representative signature',
    { alias: 'E-SIGN — PARTICIPANT / REPRESENTATIVE SIGNATURE', pdfName: 'Participant signature',
      group: 'signature', participantEditable: true }),
  s('OPAL_PARTICIPANT_SIGNED_DATE', AUTHORITY.ESIGN, KIND.DATE, 'Date signed',
    { alias: 'E-SIGN — PARTICIPANT SIGNED DATE', pdfName: 'Participant signed date',
      group: 'signature', participantEditable: true }),
  s('OPAL_PROVIDER_SIGNATURE', AUTHORITY.ESIGN, KIND.SIGNATURE, 'Provider signature',
    { alias: 'E-SIGN — PROVIDER SIGNATURE', pdfName: 'Provider signature', group: 'signature' }),
  s('OPAL_PROVIDER_SIGNED_DATE', AUTHORITY.ESIGN, KIND.DATE, 'Date signed',
    { alias: 'E-SIGN — PROVIDER SIGNED DATE', pdfName: 'Provider signed date', group: 'signature' }),
  s('OPAL_WITNESS_SIGNATURE', AUTHORITY.ESIGN, KIND.SIGNATURE,
    'Witness signature, or leave blank if not required',
    { alias: 'E-SIGN — WITNESS SIGNATURE OR NOT REQUIRED', pdfName: 'Witness signature',
      group: 'signature', participantEditable: true }),
  s('OPAL_WITNESS_SIGNED_DATE', AUTHORITY.ESIGN, KIND.DATE,
    'Date witnessed, or leave blank if not required',
    { alias: 'E-SIGN — WITNESS DATE OR NOT REQUIRED', pdfName: 'Witness signed date',
      group: 'signature', participantEditable: true }),
];

// ─────────────────────────────────────────────────────────────────────────────
//  The 23 block tags
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `role` is what the block IS, and it decides what may be done to it:
 *
 *   clause     owner-editable body text. May be reordered, disabled and
 *              rewritten in the online editor.
 *   schedule   a numbered schedule. Owner-editable, same as a clause, but
 *              never reordered out of its lettered sequence.
 *   structural neither editable nor optional — the anchor and the repeat row
 *              are machinery, not prose.
 *   internal   NEVER reaches a participant. Removed from every participant
 *              Word, PDF, preview, print view and signing session.
 */
function b(tag, role, label, extra = {}) {
  return {
    tag,
    role,
    label,
    order: extra.order,
    optional: extra.optional === true,
    alias: extra.alias || null,
  };
}

const BLOCKS = [
  b('OPAL_BLOCK_AT_A_GLANCE', 'clause', 'Agreement at a glance',
    { order: 10, alias: 'OWNER CLAUSE — Agreement at a glance' }),
  b('OPAL_CLAUSE_PARTIES_AUTHORITY', 'clause', 'Parties and authority',
    { order: 20, alias: 'OWNER CLAUSE — Parties and authority' }),
  b('OPAL_CLAUSE_TERM_REVIEW', 'clause', 'Agreement term and review',
    { order: 30, alias: 'OWNER CLAUSE — Agreement term and review' }),
  b('OPAL_CLAUSE_SUPPORTS', 'clause', 'Supports, goals and delivery',
    { order: 40, alias: 'OWNER CLAUSE — Supports, goals and delivery' }),
  b('OPAL_CLAUSE_PRICING_PAYMENT', 'clause', 'Prices, invoices and payment',
    { order: 50, alias: 'OWNER CLAUSE — Prices, invoices and payment' }),
  b('OPAL_CLAUSE_CANCELLATIONS', 'clause', 'Changes, cancellations and missed appointments',
    { order: 60, alias: 'OWNER CLAUSE — Changes, cancellations and missed appointments' }),
  b('OPAL_CLAUSE_PROVIDER_RESPONSIBILITIES', 'clause', 'Opal Therapy commitments',
    { order: 70, alias: 'OWNER CLAUSE — Opal Therapy commitments' }),
  b('OPAL_CLAUSE_PARTICIPANT_RESPONSIBILITIES', 'clause', 'Participant commitments',
    { order: 80, alias: 'OWNER CLAUSE — Participant commitments' }),
  b('OPAL_CLAUSE_PRIVACY_RECORDS', 'clause', 'Privacy, records and information sharing',
    { order: 90, alias: 'OWNER CLAUSE — Privacy, records and information sharing' }),
  b('OPAL_CLAUSE_AI_ASSISTED_TECHNOLOGY', 'clause', 'AI-assisted technology declaration',
    { order: 100, optional: true, alias: 'OWNER CLAUSE — AI-assisted technology declaration' }),
  b('OPAL_CLAUSE_SAFEGUARDING_INCIDENTS', 'clause', 'Safety, incidents and continuity',
    { order: 110, alias: 'OWNER CLAUSE — Safety, incidents and continuity' }),
  b('OPAL_CLAUSE_FEEDBACK_COMPLAINTS', 'clause', 'Feedback, complaints and disagreements',
    { order: 120, alias: 'OWNER CLAUSE — Feedback, complaints and disagreements' }),
  b('OPAL_CLAUSE_CONFLICTS', 'clause', 'Conflicts of interest',
    { order: 130, optional: true, alias: 'OWNER CLAUSE — Conflicts of interest' }),
  b('OPAL_CLAUSE_VARIATIONS_TERMINATION', 'clause', 'Changes to or ending the agreement',
    { order: 140, alias: 'OWNER CLAUSE — Changes to or ending the agreement' }),
  b('OPAL_CLAUSE_ELECTRONIC_SIGNING', 'clause', 'Electronic signing and counterparts',
    { order: 150, alias: 'OWNER CLAUSE — Electronic signing and counterparts' }),

  b('OPAL_ANCHOR_OWNER_CUSTOM_CLAUSES', 'structural', 'Custom clause insertion point',
    { order: 160, alias: 'OWNER ANCHOR — CUSTOM CLAUSES' }),

  b('OPAL_SCHEDULE_SUPPORTS', 'schedule', 'Schedule A — Agreed supports and prices',
    { order: 200, alias: 'OWNER CLAUSE — Schedule A — Agreed supports and prices' }),
  b('OPAL_REPEAT_SUPPORT_ROW', 'structural', 'Repeatable support row',
    { order: 205, alias: 'PORTAL REPEAT — SUPPORT ROW' }),
  b('OPAL_SCHEDULE_PREFERENCES', 'schedule', 'Schedule B — Preferences, access and continuity',
    { order: 210, alias: 'OWNER CLAUSE — Schedule B — Preferences, access and continuity' }),
  b('OPAL_SCHEDULE_CONSENTS', 'schedule', 'Schedule C — Separate consent choices',
    { order: 220, alias: 'OWNER CLAUSE — Schedule C — Separate consent choices' }),
  b('OPAL_SCHEDULE_DOCUMENT_CONTROL', 'schedule', 'Schedule D — Document control and attachments',
    { order: 230, alias: 'OWNER CLAUSE — Schedule D — Document control and attachments' }),

  b('OPAL_INTERNAL_COVER_CONTROL_NOTICE', 'internal', 'Internal cover control notice',
    { order: 1, alias: 'INTERNAL — COVER CONTROL NOTICE — OMIT FROM PARTICIPANT COPY' }),
  b('OPAL_INTERNAL_OWNER_GOVERNANCE', 'internal', 'Internal owner governance',
    { order: 240, alias: 'OWNER CLAUSE — INTERNAL — OWNER GOVERNANCE — OMIT FROM PARTICIPANT COPY' }),
];

// ─────────────────────────────────────────────────────────────────────────────
//  Derived indexes — computed once, frozen, never rebuilt by a caller
// ─────────────────────────────────────────────────────────────────────────────

const SCALAR_BY_TAG = Object.freeze(
  SCALARS.reduce((acc, f) => { acc[f.tag] = Object.freeze(f); return acc; }, Object.create(null))
);
const BLOCK_BY_TAG = Object.freeze(
  BLOCKS.reduce((acc, f) => { acc[f.tag] = Object.freeze(f); return acc; }, Object.create(null))
);

const SCALAR_TAGS = Object.freeze(SCALARS.map((f) => f.tag));
const BLOCK_TAGS = Object.freeze(BLOCKS.map((f) => f.tag));
const ALL_TAGS = Object.freeze([...SCALAR_TAGS, ...BLOCK_TAGS]);

/** Blocks the owner may rewrite, reorder, enable or disable. */
const CLAUSE_TAGS = Object.freeze(
  BLOCKS.filter((x) => x.role === 'clause' || x.role === 'schedule').map((x) => x.tag)
);
/** Clauses that may be switched off entirely. Everything else is mandatory. */
const OPTIONAL_CLAUSE_TAGS = Object.freeze(BLOCKS.filter((x) => x.optional).map((x) => x.tag));

/** Removed from every participant-facing artefact, without exception. */
const INTERNAL_BLOCK_TAGS = Object.freeze(
  BLOCKS.filter((x) => x.role === 'internal').map((x) => x.tag)
);

const CUSTOM_CLAUSE_ANCHOR = 'OPAL_ANCHOR_OWNER_CUSTOM_CLAUSES';
const REPEAT_SUPPORT_ROW = 'OPAL_REPEAT_SUPPORT_ROW';

/**
 * The FIVE columns genuinely inside OPAL_REPEAT_SUPPORT_ROW, in column order.
 * These are cloned once per agreed support.
 */
const REPEAT_ROW_TAGS = Object.freeze(SCALARS.filter((f) => f.repeatRow).map((f) => f.tag));

/**
 * The SEVEN fields in the single "Support-row detail" panel. One control each,
 * populated from the first support.
 */
const SUPPORT_DETAIL_TAGS = Object.freeze(SCALARS.filter((f) => f.detail).map((f) => f.tag));

/** All twelve support fields — what the wizard collects for each support. */
const SUPPORT_ROW_TAGS = Object.freeze([...REPEAT_ROW_TAGS, ...SUPPORT_DETAIL_TAGS]);

const MULTILINE_TAGS = Object.freeze(
  SCALARS.filter((f) => f.kind === KIND.MULTILINE).map((f) => f.tag)
);
const DATE_TAGS = Object.freeze(SCALARS.filter((f) => f.kind === KIND.DATE).map((f) => f.tag));
const CHOICE_TAGS = Object.freeze(SCALARS.filter((f) => f.kind === KIND.CHOICE).map((f) => f.tag));
const SIGNATURE_TAGS = Object.freeze(
  SCALARS.filter((f) => f.kind === KIND.SIGNATURE).map((f) => f.tag)
);

const SERVER_TAGS = Object.freeze(SCALARS.filter((f) => f.authority === AUTHORITY.SERVER).map((f) => f.tag));
const OWNER_TAGS = Object.freeze(SCALARS.filter((f) => f.authority === AUTHORITY.OWNER).map((f) => f.tag));
const PORTAL_TAGS = Object.freeze(SCALARS.filter((f) => f.authority === AUTHORITY.PORTAL).map((f) => f.tag));
const ESIGN_TAGS = Object.freeze(SCALARS.filter((f) => f.authority === AUTHORITY.ESIGN).map((f) => f.tag));

/** Fields a participant may complete in a signing session or a downloaded PDF. */
const PARTICIPANT_EDITABLE_TAGS = Object.freeze(
  SCALARS.filter((f) => f.participantEditable).map((f) => f.tag)
);

/** Custom clauses minted by the owner. Server-generated, never client-supplied. */
const CUSTOM_CLAUSE_PATTERN = /^OPAL_CUSTOM_CLAUSE_[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

function customClauseTag(uuid) {
  return `OPAL_CUSTOM_CLAUSE_${String(uuid).toUpperCase()}`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  The measured contract — what a valid master must contain
// ─────────────────────────────────────────────────────────────────────────────

const EXPECTED = Object.freeze({
  uniqueScalarTags: 83,
  uniqueBlockTags: 23,
  uniqueTags: 106,
  totalOccurrences: 126,
  bodyOccurrences: 124,
  headerOccurrences: 1,
  footerOccurrences: 1,
  /** Which tag each single-control part must carry. */
  partTags: Object.freeze({
    'word/header6.xml': 'OPAL_AGREEMENT_ID',
    'word/footer6.xml': 'OPAL_AGREEMENT_VERSION',
  }),
  /**
   * PAGE / NUMPAGES field counts in the footer, which must survive
   * composition. PAGE is counted excluding the "PAGE" inside "NUMPAGES" —
   * a naive substring count reports 2 and is wrong.
   */
  footerPageFields: Object.freeze({ page: 1, numPages: 1 }),
  /** Controls genuinely nested inside the repeatable support row. */
  repeatRowControls: 5,
  /** Paragraph styles the template must define for the owner editor to be safe. */
  requiredStyles: Object.freeze([
    'OPAL–Body', 'OPAL–BodyEmphasis', 'OPAL–Bullet', 'OPAL–Heading1', 'OPAL–Heading2',
    'OPAL–Heading3', 'OPAL–NumberedList', 'OPAL–TableBody', 'OPAL–TableHeader',
  ]),
});

/** Approved styles the owner's rich text may use. Anything else is rejected. */
const APPROVED_CLAUSE_STYLES = Object.freeze([
  'OPAL–Body', 'OPAL–BodyEmphasis', 'OPAL–Bullet', 'OPAL–NumberedList',
  'OPAL–Heading2', 'OPAL–Heading3', 'OPAL–Heading4',
]);

const STYLE = Object.freeze({
  BODY: 'OPAL–Body',
  BODY_EMPHASIS: 'OPAL–BodyEmphasis',
  BULLET: 'OPAL–Bullet',
  HEADING2: 'OPAL–Heading2',
  HEADING3: 'OPAL–Heading3',
  TABLE_BODY: 'OPAL–TableBody',
});

// ─────────────────────────────────────────────────────────────────────────────
//  Forbidden tokens — the promise made about the BYTES that reach a participant
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anything matching these must never appear in a participant-facing Word file,
 * PDF, email preview, print view or signing session. The list is deliberately
 * wider than the four bracketed prefixes: a raw OPAL_ tag leaking into visible
 * text is the same failure wearing different clothes.
 *
 * These are matched against EXTRACTED TEXT and against the packaged XML, so a
 * placeholder split across two runs cannot slip past a naive string search.
 */
const FORBIDDEN_TEXT_PATTERNS = Object.freeze([
  { name: 'portal placeholder', re: /\[PORTAL\s*[—–-]/i },
  { name: 'owner placeholder', re: /\[OWNER\s*[—–-]/i },
  { name: 'server placeholder', re: /\[SERVER\s*[—–-]/i },
  { name: 'e-sign placeholder', re: /\[E-?SIGN\s*[—–-]/i },
  { name: 'internal placeholder', re: /\[INTERNAL\s*[—–-]/i },
  { name: 'raw OPAL tag', re: /\bOPAL_[A-Z0-9_]{3,}\b/ },
  { name: 'custom clause marker', re: /OPAL_ANCHOR_|OPAL_REPEAT_/ },
]);

// ─────────────────────────────────────────────────────────────────────────────
//  Lookups
// ─────────────────────────────────────────────────────────────────────────────

/** @returns {object|null} the scalar descriptor, or null for an unknown tag. */
function scalar(tag) {
  return SCALAR_BY_TAG[tag] || null;
}

/** @returns {object|null} the block descriptor, or null for an unknown tag. */
function block(tag) {
  return BLOCK_BY_TAG[tag] || null;
}

function isKnownTag(tag) {
  return Boolean(SCALAR_BY_TAG[tag] || BLOCK_BY_TAG[tag]) || CUSTOM_CLAUSE_PATTERN.test(String(tag));
}

/**
 * May `authority` write this tag?
 *
 * This is the whole of the trust boundary in one function. Route handlers ask
 * it before accepting any submitted value, which is why a participant profile,
 * a query parameter, a template upload and an ordinary form save can none of
 * them set a signature: they all arrive as 'portal' and every signature tag is
 * 'esign'.
 */
function writableBy(tag, authority) {
  const f = SCALAR_BY_TAG[tag];
  if (!f) return false;
  return f.authority === authority;
}

/** The human prompt shown in a blank field. Never the template's own placeholder. */
function promptFor(tag) {
  const f = SCALAR_BY_TAG[tag];
  return f ? f.prompt : '';
}

module.exports = {
  TEMPLATE_KEY,
  TEMPLATE_NAME,
  SEED_VERSION,
  SEED_TEMPLATE_FILE,
  SEED_TEMPLATE_SHA256,
  SUPERSEDED_TEMPLATE_SHA256,
  PATCH_FROM_VERSION,
  PATCH_REASON,
  CONTROL_PARTS,
  DOCUMENT_PREFIX,

  KIND,
  AUTHORITY,
  CHOICES,
  STYLE,
  APPROVED_CLAUSE_STYLES,

  SCALARS,
  BLOCKS,
  SCALAR_BY_TAG,
  BLOCK_BY_TAG,
  SCALAR_TAGS,
  BLOCK_TAGS,
  ALL_TAGS,

  CLAUSE_TAGS,
  OPTIONAL_CLAUSE_TAGS,
  INTERNAL_BLOCK_TAGS,
  CUSTOM_CLAUSE_ANCHOR,
  REPEAT_SUPPORT_ROW,
  REPEAT_ROW_TAGS,
  SUPPORT_DETAIL_TAGS,
  SUPPORT_ROW_TAGS,

  MULTILINE_TAGS,
  DATE_TAGS,
  CHOICE_TAGS,
  SIGNATURE_TAGS,

  SERVER_TAGS,
  OWNER_TAGS,
  PORTAL_TAGS,
  ESIGN_TAGS,
  PARTICIPANT_EDITABLE_TAGS,

  CUSTOM_CLAUSE_PATTERN,
  customClauseTag,

  EXPECTED,
  FORBIDDEN_TEXT_PATTERNS,

  scalar,
  block,
  isKnownTag,
  writableBy,
  promptFor,
};
