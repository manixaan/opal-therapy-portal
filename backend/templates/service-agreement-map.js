'use strict';

/**
 * SERVICE AGREEMENT TEMPLATE MAP — the static description of the Opal NDIS
 * Service Agreement master (service-agreement-v2.2.docx, the owner-supplied
 * "Portal Integrated" edition of 24 Aug 2026), written in the same style as
 * fca/template-map.js and fca/letter-template-map.js.
 *
 * Everything below was derived by unzipping the real .docx and reading
 * word/document.xml, word/header3.xml and word/footer1.xml, and is asserted
 * against the shipped file by tests/templates-service-agreement-map.test.js
 * so this file cannot silently drift from the document. The v2.2 master uses
 * `[PORTAL: …]` / `[OWNER: …]` prompt syntax (colon, not em dash); the export
 * boundary's prompt pattern matches both.
 *
 * VERIFIED MASTER FACTS (service-agreement-v2.2.docx)
 *   121 unique w:tag content controls, 138 occurrences in total.
 *   word/header3.xml carries OPAL_AGREEMENT_ID; word/footer1.xml carries
 *   OPAL_AGREEMENT_VERSION — a body-only implementation would ship a blank
 *   header and footer, which is why both parts are listed in CONTROL_PARTS.
 *   Two sections (cover with titlePg + body); A4; no w:updateFields.
 *
 * ── DATA REALITY ────────────────────────────────────────────────────────────
 * Identical to the FCA's: there is no clients table in this database. Client
 * identity and contact details come from Splose at request time; durable
 * supplementary facts come from the organisation-scoped fca_client_profiles
 * row and its versioned NDIS plan.
 *
 * Many agreement facts have NO backing store anywhere in this repository —
 * ABN, NDIS registration number, privacy and complaints contacts, payment
 * terms, plan manager, emergency contact, and every support-row price. Those
 * are declared `layer: 'report'`, which resolves to MISSING unless the user
 * types a value. That is the honest answer: an ABN is never inferred, and a
 * field with no source must reach the exported document as an empty, editable
 * field rather than as a guess.
 *
 * ── INTERNAL CONTROLS ───────────────────────────────────────────────────────
 * Three controls are deliberately absent from SCALAR_TAGS and are listed in
 * INTERNAL_TAGS instead: OPAL_INTERNAL_COVER_CONTROL_NOTICE,
 * OPAL_INTERNAL_OWNER_GOVERNANCE and OPAL_MASTER_TEMPLATE_HASH. They carry
 * Opal's own governance prose and the published master's SHA-256 — portal
 * implementation metadata, not agreement content. They are never offered as a
 * field and are removed outright at export by templates/export-boundary.js.
 */

const path = require('path');

const TEMPLATE_ID = 'service_agreement';
const TEMPLATE_VERSION = 'v2.2';
const TEMPLATE_NAME = 'Opal Therapy NDIS Service Agreement';
const TEMPLATE_FILENAME = 'service-agreement-v2.2.docx';
const TEMPLATE_FILE = path.join(
  __dirname, '..', 'service-agreements', 'templates', TEMPLATE_FILENAME
);

// Parts that may carry content controls. Only these are ever read or modified.
const CONTROL_PARTS = ['word/document.xml', 'word/header3.xml', 'word/footer1.xml'];

/**
 * Controls holding Opal's own governance prose and the master hash. Removed
 * entirely from an exported document — the master itself states that the
 * internal block must not reach a participant copy.
 */
const INTERNAL_TAGS = [
  'OPAL_INTERNAL_COVER_CONTROL_NOTICE',
  'OPAL_INTERNAL_OWNER_GOVERNANCE',
  'OPAL_MASTER_TEMPLATE_HASH',
];

// The master's published clause and schedule blocks. These are the agreement's
// own wording; a document instance never edits them, so they are not fields.
const CLAUSE_TAGS = [
  'OPAL_CLAUSE_PARTIES_AUTHORITY',
  'OPAL_CLAUSE_SUPPORTS',
  'OPAL_CLAUSE_TERM_REVIEW',
  'OPAL_CLAUSE_PRICING_PAYMENT',
  'OPAL_CLAUSE_CANCELLATIONS',
  'OPAL_CLAUSE_CHANGES',
  'OPAL_CLAUSE_PROVIDER_RESPONSIBILITIES',
  'OPAL_CLAUSE_PARTICIPANT_RESPONSIBILITIES',
  'OPAL_CLAUSE_PRIVACY_RECORDS',
  'OPAL_CLAUSE_SAFEGUARDING_INCIDENTS',
  'OPAL_CLAUSE_FEEDBACK_COMPLAINTS',
  'OPAL_CLAUSE_CONFLICTS',
  'OPAL_CLAUSE_AI_ASSISTED_TECHNOLOGY',
  'OPAL_CLAUSE_ELECTRONIC_SIGNING',
  'OPAL_CLAUSE_VARIATIONS_TERMINATION',
  'OPAL_SCHEDULE_SUPPORTS',
  'OPAL_SCHEDULE_PREFERENCES',
  'OPAL_SCHEDULE_CONSENTS',
  'OPAL_SCHEDULE_DOCUMENT_CONTROL',
];

// Anchors the master reserves for owner-authored insertions. Templates does
// not author clauses (that is the owner's master-publishing job, not this
// capability's), so both are removed at export rather than left as prose.
const ANCHOR_TAGS = ['OPAL_ANCHOR_OWNER_CUSTOM_CLAUSES', 'OPAL_REPEAT_SUPPORT_ROW'];

// ── Scalar controls ─────────────────────────────────────────────────────────
// `layer` selects the resolution rule in fca/resolve-scalars.js. `group` is the
// fieldset the portal renders it under. `occurrences` is asserted against the
// shipped master by the map test.
const SCALAR_TAGS = [

  // ── Participant ───────────────────────────────────────────────
  { tag: 'OPAL_PARTICIPANT_ADDRESS', label: 'Participant address', group: 'Participant',
    layer: 'splose', field: 'formattedAddress', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_COMMUNICATION_SUPPORTS', label: 'Communication supports', group: 'Participant',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_PARTICIPANT_DATE_OF_BIRTH', label: 'Date of birth', group: 'Participant',
    layer: 'client_profile', profileField: 'date_of_birth', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_EMAIL', label: 'Participant email', group: 'Participant',
    layer: 'splose', field: 'email', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_FULL_NAME', label: 'Participant full name', group: 'Participant',
    layer: 'splose', field: 'fullName', occurrences: 2 },
  { tag: 'OPAL_PARTICIPANT_GOALS', label: 'Participant goals', group: 'Participant',
    layer: 'client_profile', profilePlanField: 'goal:0', occurrences: 1, multiline: true },
  { tag: 'OPAL_PARTICIPANT_NDIS_NUMBER', label: 'NDIS number', group: 'Participant',
    layer: 'splose', field: 'ndisNumber', occurrences: 2 },
  { tag: 'OPAL_PARTICIPANT_PHONE', label: 'Participant phone', group: 'Participant',
    layer: 'splose', field: 'mobilePhone', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_PLAN_END_DATE', label: 'Plan end date', group: 'Participant',
    layer: 'client_profile', profilePlanField: 'plan_end', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_PLAN_START_DATE', label: 'Plan start date', group: 'Participant',
    layer: 'client_profile', profilePlanField: 'plan_start', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_PREFERRED_COMMUNICATION', label: 'Preferred communication', group: 'Participant',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_PREFERRED_NAME', label: 'Preferred name', group: 'Participant',
    layer: 'client_profile', profileField: 'preferred_name', occurrences: 1 },

  // ── Representative and emergency contact ──────────────────────
  { tag: 'OPAL_EMERGENCY_CONTACT_NAME', label: 'Emergency contact name', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_EMERGENCY_CONTACT_PHONE', label: 'Emergency contact phone', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_EMERGENCY_CONTACT_RELATIONSHIP', label: 'Emergency contact relationship', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPRESENTATIVE_AUTHORITY', label: 'Representative authority', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPRESENTATIVE_EMAIL', label: 'Representative email', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPRESENTATIVE_FULL_NAME', label: 'Representative name or not applicable', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPRESENTATIVE_PHONE', label: 'Representative phone', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_REPRESENTATIVE_RELATIONSHIP', label: 'Representative relationship', group: 'Representative and emergency contact',
    layer: 'report', occurrences: 1 },

  // ── Agreement period ──────────────────────────────────────────
  { tag: 'OPAL_AGREEMENT_END_DATE', label: 'Agreement end date', group: 'Agreement period',
    layer: 'report', isDate: true, occurrences: 2 },
  { tag: 'OPAL_AGREEMENT_ID', label: 'Agreement ID', group: 'Agreement period',
    layer: 'server', field: 'documentReference', occurrences: 3, parts: ["word/header3.xml"] },
  { tag: 'OPAL_AGREEMENT_ISSUE_DATE', label: 'Issue date', group: 'Agreement period',
    layer: 'server', field: 'reportDate', isDate: true, occurrences: 2 },
  { tag: 'OPAL_AGREEMENT_REVIEW_DATE', label: 'Review date', group: 'Agreement period',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_AGREEMENT_START_DATE', label: 'Agreement start date', group: 'Agreement period',
    layer: 'report', isDate: true, occurrences: 2 },
  // Publication status and version describe the MASTER's governance state, and
  // Opal stores neither for a document instance. Declared user-entered rather
  // than server-issued: stamping an instance "Draft" because the portal had
  // nothing better to say would be a claim about an agreement, not a default.
  { tag: 'OPAL_AGREEMENT_STATUS', label: 'Publication status', group: 'Agreement period',
    layer: 'report', occurrences: 3 },
  { tag: 'OPAL_AGREEMENT_VERSION', label: 'Published version', group: 'Agreement period',
    layer: 'report', occurrences: 3, parts: ["word/footer1.xml"] },

  // ── Provider details ──────────────────────────────────────────
  { tag: 'OPAL_ORG_ABN', label: 'ABN', group: 'Provider details',
    layer: 'report', occurrences: 2 },
  { tag: 'OPAL_ORG_ADDRESS', label: 'Business address', group: 'Provider details',
    layer: 'organisation', field: 'businessAddress', occurrences: 1 },
  { tag: 'OPAL_ORG_COMPLAINTS_CONTACT', label: 'Complaints contact', group: 'Provider details',
    layer: 'report', occurrences: 2 },
  { tag: 'OPAL_ORG_EMAIL', label: 'Business email', group: 'Provider details',
    layer: 'organisation', field: 'businessEmail', occurrences: 1 },
  { tag: 'OPAL_ORG_LEGAL_NAME', label: 'Legal entity name', group: 'Provider details',
    layer: 'organisation', field: 'organisationName', occurrences: 2 },
  { tag: 'OPAL_ORG_NDIS_REGISTRATION_NUMBER', label: 'NDIS registration number', group: 'Provider details',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_ORG_PHONE', label: 'Business phone', group: 'Provider details',
    layer: 'organisation', field: 'businessPhone', occurrences: 1 },
  { tag: 'OPAL_ORG_PRIVACY_CONTACT', label: 'Privacy contact', group: 'Provider details',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_ORG_TRADING_NAME', label: 'Trading name', group: 'Provider details',
    layer: 'organisation', field: 'organisationName', occurrences: 1 },
  { tag: 'OPAL_ORG_WEBSITE', label: 'Website', group: 'Provider details',
    layer: 'organisation', field: 'website', occurrences: 1 },
  { tag: 'OPAL_RECORD_RETENTION_PERIOD', label: 'Record retention period', group: 'Provider details',
    layer: 'report', occurrences: 1,
    note: 'An [OWNER: …] prompt in the master. Opal stores no approved retention period, so it is user-entered.' },
  { tag: 'OPAL_PAYMENT_TERMS_DAYS', label: 'Payment terms in days', group: 'Provider details',
    layer: 'report', occurrences: 2 },

  // ── Funding and invoicing ─────────────────────────────────────
  { tag: 'OPAL_FUNDING_MANAGEMENT_TYPE', label: 'NDIA / plan / self managed', group: 'Funding and invoicing',
    layer: 'report', occurrences: 2 },
  { tag: 'OPAL_INVOICE_EMAIL', label: 'Invoice email', group: 'Funding and invoicing',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_INVOICE_RECIPIENT', label: 'Invoice recipient', group: 'Funding and invoicing',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PLAN_MANAGER_EMAIL', label: 'Plan manager email', group: 'Funding and invoicing',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PLAN_MANAGER_NAME', label: 'Plan manager name or not applicable', group: 'Funding and invoicing',
    layer: 'report', occurrences: 1 },

  // ── Schedule A — agreed supports ──────────────────────────────
  { tag: 'OPAL_SUPPORT_CANCELLATION_TERMS', label: 'Cancellation terms for this support', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_SUPPORT_DELIVERY_METHOD', label: 'In person / telehealth / other', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_DESCRIPTION', label: 'Support description', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_SUPPORT_ADDITIONAL_EXPENSES', label: 'Additional expenses and responsibility', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_SUPPORT_ENDING_NOTICE', label: 'Notice period to end agreement', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_GST_TREATMENT', label: 'GST treatment', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_ESTIMATED_QUANTITY', label: 'Estimated quantity', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_ESTIMATED_TOTAL', label: 'Estimated total', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_FREQUENCY', label: 'Frequency or hours', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_FUNDING_PERIOD', label: 'Funding period', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_ITEM_NUMBER', label: 'Support item number', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_LOCATION', label: 'Delivery location', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_RATE', label: 'Agreed rate', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SUPPORT_TRAVEL_TERMS', label: 'Travel and non-face-to-face terms', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_SUPPORT_UNIT', label: 'Rate unit', group: 'Schedule A — agreed supports',
    layer: 'report', occurrences: 1 },

  // ── Schedule B — preferences and access ───────────────────────
  { tag: 'OPAL_ACCESSIBILITY_REQUIREMENTS', label: 'Accessibility requirements', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_CONTINUITY_PLAN_SUMMARY', label: 'Emergency or disaster continuity plan summary', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_CULTURAL_SAFETY_PREFERENCES', label: 'Cultural or safety preferences', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_INTERPRETER_REQUIREMENTS', label: 'Interpreter requirements', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_PEEP_REQUIRED', label: 'Emergency preparation plan required — yes / no / not applicable', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PEEP_ATTACHED', label: 'Emergency plan attached — yes / no / not applicable', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PEEP_TEST_DATE', label: 'Emergency plan test date', group: 'Schedule B — preferences and access',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PEEP_REVIEW_DATE', label: 'Emergency plan review date', group: 'Schedule B — preferences and access',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_SERVICE_LOCATION_PREFERENCES', label: 'Service location preferences', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_SOLE_WORKER_APPLICABLE', label: 'Sole worker clause applies — yes / no / not applicable', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_SOLE_WORKER_MONITORING', label: 'Sole worker monitoring arrangements', group: 'Schedule B — preferences and access',
    layer: 'report', occurrences: 1, multiline: true },

  // ── Schedule C — consents ─────────────────────────────────────
  { tag: 'OPAL_CONSENT_AI_ASSISTED', label: 'Yes / no / discuss', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_CONSENT_CLINICAL_MEDIA', label: 'Yes / no / discuss', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_CONSENT_MARKETING', label: 'Yes / no', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_CONSENT_NDIS_AUDIT', label: 'NDIS audit access — yes / no / discuss', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_CONSENT_REVIEW_DATE', label: 'Consent review date', group: 'Schedule C — consents',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_CONSENT_NOTES', label: 'Consent notes or conditions', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_CONSENT_SHARE_EXCLUSIONS', label: 'Sharing limits or exclusions', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_CONSENT_SHARE_INFORMATION', label: 'Yes / no / discuss', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_CONSENT_SHARE_WITH', label: 'Authorised people or organisations', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_CONSENT_STUDENT_OBSERVER', label: 'Yes / no / discuss', group: 'Schedule C — consents',
    layer: 'report', occurrences: 1 },

  // ── Schedule D — signing and document control ─────────────────
  { tag: 'OPAL_ATTACHED_DOCUMENTS', label: 'Attached documents or none', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1, multiline: true },
  { tag: 'OPAL_NDIS_PLAN_ATTACHED', label: 'NDIS plan attached — yes / no', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_COPY_DECLINED', label: 'Completed copy declined — yes / no', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_COPY_DECLINED_REASON', label: 'Reason copy declined, if known', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_RECEIPT_DATE', label: 'Signed copy provided date', group: 'Schedule D — signing and document control',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_RECEIPT_METHOD', label: 'Email / download / print', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 2 },
  { tag: 'OPAL_PARTICIPANT_SIGNATORY_CAPACITY', label: 'Signatory capacity', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_SIGNATORY_NAME', label: 'Participant or representative signatory', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_SIGNATURE', label: 'Participant / representative signature', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PARTICIPANT_SIGNED_DATE', label: 'Participant signed date', group: 'Schedule D — signing and document control',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_PROVIDER_SIGNATORY_NAME', label: 'Provider signatory name', group: 'Schedule D — signing and document control',
    layer: 'portal', field: 'therapistName', occurrences: 1 },
  { tag: 'OPAL_PROVIDER_SIGNATORY_ROLE', label: 'Provider signatory role', group: 'Schedule D — signing and document control',
    layer: 'portal', field: 'therapistRoleTitle', occurrences: 1 },
  { tag: 'OPAL_PROVIDER_SIGNATURE', label: 'Provider signature', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_PROVIDER_SIGNED_DATE', label: 'Provider signed date', group: 'Schedule D — signing and document control',
    layer: 'report', isDate: true, occurrences: 1 },
  { tag: 'OPAL_WITNESS_NAME', label: 'Witness name or not required', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_WITNESS_SIGNATURE', label: 'Witness signature or not required', group: 'Schedule D — signing and document control',
    layer: 'report', occurrences: 1 },
  { tag: 'OPAL_WITNESS_SIGNED_DATE', label: 'Witness date or not required', group: 'Schedule D — signing and document control',
    layer: 'report', isDate: true, occurrences: 1 },
];

const SCALAR_BY_TAG = new Map(SCALAR_TAGS.map((s) => [s.tag, s]));
const SCALAR_TAG_LIST = SCALAR_TAGS.map((s) => s.tag);

/** Tags whose value renders as real w:br line breaks rather than one flat run. */
const MULTILINE_TAGS = new Set(SCALAR_TAGS.filter((s) => s.multiline).map((s) => s.tag));

/** The field groups, in the order the portal shows them. */
const GROUPS = [];
for (const s of SCALAR_TAGS) if (!GROUPS.includes(s.group)) GROUPS.push(s.group);

/**
 * The catalogue shape fca/resolve-scalars.js resolves against. Passing this as
 * `catalogue` is the whole of the integration — there is no second resolver.
 */
const CATALOGUE = { SCALAR_TAGS, SCALAR_BY_TAG, SCALAR_TAG_LIST };

module.exports = {
  TEMPLATE_ID,
  TEMPLATE_VERSION,
  TEMPLATE_NAME,
  TEMPLATE_FILENAME,
  TEMPLATE_FILE,
  CONTROL_PARTS,
  INTERNAL_TAGS,
  CLAUSE_TAGS,
  ANCHOR_TAGS,
  SCALAR_TAGS,
  SCALAR_BY_TAG,
  SCALAR_TAG_LIST,
  MULTILINE_TAGS,
  GROUPS,
  CATALOGUE,
};
