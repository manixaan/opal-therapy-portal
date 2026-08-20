'use strict';

/**
 * ONBOARDING DOCUMENT EXTRACTION — reading returned forms so nobody retypes them.
 *
 * A new starter fills in a paper pack; somebody in the practice then copies
 * thirty fields into the portal by hand. This module removes the copying and
 * nothing else. It does NOT decide anything, does not write to an employee
 * record, and does not create a person. It reads returned documents and
 * PROPOSES values that a human then accepts, corrects or rejects.
 *
 * ── WHY PROPOSALS, NOT FACTS ───────────────────────────────────────────────
 * The failure mode that matters here is not a wrong answer, it is a wrong
 * answer that looks authoritative. An extractor that writes straight into
 * employee_personal_details produces a date of birth nobody chose and nobody
 * can trace. So every value lands in onboarding_extracted_fields with its
 * source document, its page, and the model's own confidence, and stays there
 * until a person accepts it. The apply step is separate and deliberate.
 *
 * ── WHAT IS NEVER EXTRACTED ────────────────────────────────────────────────
 * Tax file numbers. The prompt forbids returning one, the field vocabulary has
 * no key for one, and migration 038 adds a CHECK constraint that refuses one
 * at the database. Three independent layers, because the instruction layer is
 * the one that can be talked out of it. A TFN is collected from the employee
 * directly, in the authenticated portal, in the form built for it.
 *
 * ── GOVERNANCE ─────────────────────────────────────────────────────────────
 * Every model call goes through backend/ai/ai-gateway.js under the
 * `onboarding_document_extraction` policy: Australian region, approved model
 * keys only, kill switch respected, denials audited. This module never
 * imports a provider SDK — see tests/ai-gateway-boundary.test.js, which turns
 * that rule into a build failure.
 *
 * ── HOW THE TEXT IS OBTAINED ───────────────────────────────────────────────
 * PDFs are read with the portal's existing pdfjs worker (the same one the
 * Resource Hub uses for file-quality checks), page by page, so a field can
 * cite the page it came from. DOCX is unzipped and its document.xml stripped
 * to text. A scan with no text layer is reported as such — this portal has no
 * OCR dependency, and saying "we could not read this one, please type these
 * three fields" is the honest outcome. Guessing is not.
 */

const gateway = require('./ai/ai-gateway');
const classification = require('./ai/ai-classification');
const outputTypes = require('./ai/ai-output-type');
const log = require('./logger').createLogger('onboarding-extraction');

const AI_FEATURE = 'onboarding_document_extraction';

/** Per-document text budget. Beyond this the tail is dropped, not the head. */
const MAX_CHARS_PER_DOCUMENT = 24000;
/** Across all documents in one run. Bounds both cost and blast radius. */
const MAX_CHARS_PER_RUN = 90000;

// ═════════════════════════════════════════════════════════════════════════════
//  THE FIELD VOCABULARY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Every field the extractor may return, and where it lands when applied.
 *
 * This is a CLOSED vocabulary, and that is its point. A model cannot invent
 * `spouse_income` or `medicare_number` and have it stored: an unknown key is
 * dropped at parse time. Data minimisation stops being a policy document and
 * becomes a data structure.
 *
 *   group        the review section it appears under
 *   label        what the Owner and the employee see
 *   sensitive    stored encrypted, rendered only as a mask
 *   target       'personal' | 'payroll' | 'employment' | 'credential' | null
 *                where accept-and-apply writes it. null means review-only.
 *   column       the column on that target table
 *   kind         'text' | 'date' | 'email' | 'phone' | 'bsb' | 'account' | 'number'
 */
const FIELDS = Object.freeze({
  // ── Identity ──────────────────────────────────────────────────────────────
  legal_first_name:   { group: 'identity', label: 'Legal first name',  target: 'personal', column: 'legal_first_name', kind: 'text' },
  middle_name:        { group: 'identity', label: 'Middle name',       target: 'personal', column: 'middle_name',      kind: 'text' },
  surname:            { group: 'identity', label: 'Surname',           target: 'personal', column: 'surname',          kind: 'text' },
  preferred_name:     { group: 'identity', label: 'Preferred name',    target: 'personal', column: 'preferred_name',   kind: 'text' },
  date_of_birth:      { group: 'identity', label: 'Date of birth',     target: 'personal', column: 'date_of_birth',    kind: 'date' },

  // ── Contact ───────────────────────────────────────────────────────────────
  personal_email:     { group: 'contact', label: 'Personal email',     target: 'personal', column: 'personal_email',   kind: 'email' },
  mobile:             { group: 'contact', label: 'Mobile',             target: 'personal', column: 'mobile',           kind: 'phone' },
  address_line1:      { group: 'contact', label: 'Address line 1',     target: 'personal', column: 'address_line1',    kind: 'text' },
  address_line2:      { group: 'contact', label: 'Address line 2',     target: 'personal', column: 'address_line2',    kind: 'text' },
  suburb:             { group: 'contact', label: 'Suburb',             target: 'personal', column: 'suburb',           kind: 'text' },
  state:              { group: 'contact', label: 'State',              target: 'personal', column: 'state',            kind: 'text' },
  postcode:           { group: 'contact', label: 'Postcode',           target: 'personal', column: 'postcode',         kind: 'text' },
  postal_line1:       { group: 'contact', label: 'Postal address line 1', target: 'personal', column: 'postal_line1',  kind: 'text' },
  postal_suburb:      { group: 'contact', label: 'Postal suburb',      target: 'personal', column: 'postal_suburb',    kind: 'text' },
  postal_state:       { group: 'contact', label: 'Postal state',       target: 'personal', column: 'postal_state',     kind: 'text' },
  postal_postcode:    { group: 'contact', label: 'Postal postcode',    target: 'personal', column: 'postal_postcode',  kind: 'text' },

  // ── Emergency contact ─────────────────────────────────────────────────────
  emergency_name:         { group: 'emergency', label: 'Emergency contact name',  target: 'personal', column: 'emergency_name',         kind: 'text' },
  emergency_relationship: { group: 'emergency', label: 'Relationship',            target: 'personal', column: 'emergency_relationship', kind: 'text' },
  emergency_phone:        { group: 'emergency', label: 'Emergency phone',         target: 'personal', column: 'emergency_phone',        kind: 'phone' },
  emergency_alt_phone:    { group: 'emergency', label: 'Alternative phone',       target: 'personal', column: 'emergency_alt_phone',    kind: 'phone' },

  // ── Employment ────────────────────────────────────────────────────────────
  job_title:            { group: 'employment', label: 'Job title',            target: 'employment', column: 'job_title',            kind: 'text' },
  employment_type:      { group: 'employment', label: 'Employment type',      target: 'employment', column: 'employment_type',      kind: 'text' },
  start_date:           { group: 'employment', label: 'Start date',           target: 'employment', column: 'start_date',           kind: 'date' },
  hours_per_week:       { group: 'employment', label: 'Ordinary hours a week', target: 'employment', column: 'hours_per_week',      kind: 'number' },
  award_classification: { group: 'employment', label: 'Award classification', target: 'employment', column: 'award_classification', kind: 'text' },
  work_location:        { group: 'employment', label: 'Work location',        target: 'employment', column: 'work_location',        kind: 'text' },

  // ── Payroll (bank only — never tax) ───────────────────────────────────────
  account_holder_name: { group: 'payroll', label: 'Account name',   target: 'payroll', column: 'account_holder_name', kind: 'text' },
  bsb:                 { group: 'payroll', label: 'BSB',            target: 'payroll', column: 'bsb',            kind: 'bsb',     sensitive: true },
  account_number:      { group: 'payroll', label: 'Account number', target: 'payroll', column: 'account_number', kind: 'account', sensitive: true },

  // ── Superannuation ────────────────────────────────────────────────────────
  super_fund_name:     { group: 'super', label: 'Super fund',       target: 'payroll', column: 'super_fund_name',     kind: 'text' },
  super_usi:           { group: 'super', label: 'USI',              target: 'payroll', column: 'super_fund_usi',      kind: 'text' },
  super_member_number: { group: 'super', label: 'Member number',    target: 'payroll', column: 'super_member_number', kind: 'text', sensitive: true },
  super_choice_type:   { group: 'super', label: 'Fund choice',      target: 'payroll', column: 'super_choice_type',   kind: 'text' },

  // ── Credentials (review-only; the credential record is created separately) ─
  ahpra_registration_number: { group: 'credentials', label: 'AHPRA registration number', target: null, kind: 'text' },
  ahpra_expiry:              { group: 'credentials', label: 'AHPRA expiry',              target: null, kind: 'date' },
  wwcc_number:               { group: 'credentials', label: 'WWCC number',               target: null, kind: 'text' },
  wwcc_expiry:               { group: 'credentials', label: 'WWCC expiry',               target: null, kind: 'date' },
  ndis_screening_number:     { group: 'credentials', label: 'NDIS Worker Screening number', target: null, kind: 'text' },
  ndis_screening_expiry:     { group: 'credentials', label: 'NDIS Worker Screening expiry', target: null, kind: 'date' },
  drivers_licence_number:    { group: 'credentials', label: 'Driver licence number',     target: null, kind: 'text', sensitive: true },
  drivers_licence_expiry:    { group: 'credentials', label: 'Driver licence expiry',     target: null, kind: 'date' },
  police_check_date:         { group: 'credentials', label: 'Police check date',         target: null, kind: 'date' },
  first_aid_expiry:          { group: 'credentials', label: 'First aid expiry',          target: null, kind: 'date' },
  cpr_expiry:                { group: 'credentials', label: 'CPR expiry',                target: null, kind: 'date' },
  insurance_policy_expiry:   { group: 'credentials', label: 'Professional indemnity expiry', target: null, kind: 'date' },
});

const FIELD_KEYS = Object.freeze(Object.keys(FIELDS));

const GROUP_LABELS = Object.freeze({
  identity: 'Personal',
  contact: 'Contact',
  emergency: 'Emergency contact',
  employment: 'Employment',
  payroll: 'Payroll',
  super: 'Superannuation',
  credentials: 'Credentials',
  other: 'Other',
});

const GROUP_ORDER = Object.freeze([
  'identity', 'contact', 'emergency', 'employment', 'payroll', 'super', 'credentials', 'other',
]);

/** Fields the payroll permission tier gates. Everything else needs review only. */
function requiredPermissionFor(fieldKey) {
  const def = FIELDS[fieldKey];
  if (!def) return 'onboarding.review';
  if (def.group === 'payroll' || def.group === 'super') return 'onboarding.payroll';
  if (def.sensitive) return 'onboarding.sensitive_identity';
  return 'onboarding.review';
}

// ═════════════════════════════════════════════════════════════════════════════
//  TEXT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Pull readable text out of one returned document, page by page.
 *
 * @returns {Promise<{status:string, pages:string[], chars:number}>}
 *   status: 'extracted' | 'no_text_layer' | 'unsupported' | 'failed'
 */
async function readDocumentText(buffer, mime) {
  const type = String(mime || '').toLowerCase();

  if (type === 'application/pdf') {
    try {
      const quality = require('./resource-file-quality');
      const pages = await quality.pdfPageTexts(buffer);
      const chars = pages.reduce((n, p) => n + p.length, 0);
      // A scanned form has pages but almost no characters. Below roughly a
      // sentence a page there is no text layer worth reading, and pretending
      // otherwise sends the model whitespace and gets confident nonsense back.
      if (chars < Math.max(40, pages.length * 20)) {
        return { status: 'no_text_layer', pages, chars };
      }
      return { status: 'extracted', pages, chars };
    } catch (err) {
      log.warn('pdf text extraction failed', { error: err });
      return { status: 'failed', pages: [], chars: 0 };
    }
  }

  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    try {
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const entry = zip.file('word/document.xml');
      if (!entry) return { status: 'failed', pages: [], chars: 0 };
      const xml = await entry.async('string');
      const text = xml
        .replace(/<w:p[^>]*>/g, '\n')
        .replace(/<w:tab[^>]*\/>/g, '\t')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (text.length < 40) return { status: 'no_text_layer', pages: [], chars: text.length };
      return { status: 'extracted', pages: [text], chars: text.length };
    } catch (err) {
      log.warn('docx text extraction failed', { error: err });
      return { status: 'failed', pages: [], chars: 0 };
    }
  }

  if (type.startsWith('image/')) {
    // No OCR dependency in this portal, and adding one to read a payslip
    // photograph is not a decision to make silently.
    return { status: 'no_text_layer', pages: [], chars: 0 };
  }

  if (type === 'text/plain') {
    const text = buffer.toString('utf8');
    return { status: text.length >= 40 ? 'extracted' : 'no_text_layer', pages: [text], chars: text.length };
  }

  return { status: 'unsupported', pages: [], chars: 0 };
}

/** Assemble the page-tagged corpus the model reads, within the run budget. */
function buildCorpus(documents) {
  const parts = [];
  let total = 0;

  for (const doc of documents) {
    if (total >= MAX_CHARS_PER_RUN) break;
    if (!doc.pages || !doc.pages.length) continue;

    const header = `\n===== DOCUMENT ${doc.index}: ${doc.title} =====\n`;
    parts.push(header);
    total += header.length;

    let used = 0;
    for (let i = 0; i < doc.pages.length; i += 1) {
      if (total >= MAX_CHARS_PER_RUN || used >= MAX_CHARS_PER_DOCUMENT) break;
      const room = Math.min(MAX_CHARS_PER_DOCUMENT - used, MAX_CHARS_PER_RUN - total);
      const body = String(doc.pages[i]).slice(0, room);
      if (!body.trim()) continue;
      const chunk = `--- page ${i + 1} ---\n${body}\n`;
      parts.push(chunk);
      used += chunk.length;
      total += chunk.length;
    }
  }
  return { text: parts.join(''), chars: total };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE MODEL CALL
// ═════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = [
  'You transcribe completed employment onboarding forms for an Australian',
  'allied-health practice. You are a careful reader, not an interpreter.',
  '',
  'RULES',
  '1. Return ONLY values that appear in the supplied text. Never infer, never',
  '   complete a partial value, never normalise a name to what it "should" be.',
  '2. If a field is blank, illegible or absent, omit it entirely. An omitted',
  '   field is correct; a guessed one is a defect.',
  '3. NEVER return a tax file number, or any part of one, under any field.',
  '   If the text contains one, ignore it. Do not mention it.',
  '4. Dates must be ISO (YYYY-MM-DD). Australian forms are day-first: 03/04/1990',
  '   is 3 April 1990. If a date is genuinely ambiguous, omit it.',
  '5. BSB is six digits, formatted 000-000. Account numbers are digits only.',
  '6. confidence is your own reading certainty for THAT value:',
  '     high   - printed or clearly written, unambiguous',
  '     medium - legible but with some doubt, or reconstructed from layout',
  '     low    - hard to read, conflicting copies, or a guess at the label',
  '7. Cite the document number and page each value came from.',
  '8. If the same field appears twice with different values, return the one on',
  '   the most complete form and mark it low confidence.',
  '',
  'Return your answer only through the record_employee_details tool.',
].join('\n');

/** The tool the model must call. Forcing structure beats parsing prose. */
function buildTool() {
  return {
    name: 'record_employee_details',
    description: 'Record the employment details transcribed from the supplied documents.',
    input_schema: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          description: 'One entry per field found. Omit fields that are not present.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', enum: FIELD_KEYS, description: 'Which field this is.' },
              value: { type: 'string', description: 'The value exactly as written on the form.' },
              confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
              documentIndex: { type: 'integer', description: 'The DOCUMENT number this came from.' },
              page: { type: 'integer', description: 'The page number within that document.' },
            },
            required: ['key', 'value', 'confidence'],
          },
        },
        notes: {
          type: 'string',
          description: 'Anything the reviewer should know: a form left blank, an unreadable section. No values.',
        },
      },
      required: ['fields'],
    },
  };
}

/**
 * Ask the model to transcribe the corpus.
 *
 * @returns {Promise<{fields:object[], notes:string, meta:object}>}
 */
async function callModel({ corpus, userId, organisationId }) {
  const tool = buildTool();
  const result = await gateway.generate({
    feature: AI_FEATURE,
    // Employment information about an identified person: internal, not
    // clinical. The policy pins it onshore regardless.
    classification: classification.INTERNAL,
    outputType: outputTypes.ASSISTANT_RESPONSE,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Transcribe the employment details from these returned onboarding documents.\n\n${corpus}`,
    }],
    tools: [tool],
    toolChoice: { type: 'tool', name: tool.name },
    maxTokens: 4096,
    userId,
    organisationId,
  });

  // The gateway hands back { text, toolUse, metadata } and never a raw
  // provider response, so `toolUse` is the whole structured answer.
  const call = result && result.toolUse;
  if (!call || call.name !== tool.name || !call.input) {
    return { fields: [], notes: '', meta: result?.metadata || {} };
  }
  return {
    fields: Array.isArray(call.input.fields) ? call.input.fields : [],
    notes: typeof call.input.notes === 'string' ? call.input.notes.slice(0, 500) : '',
    meta: result?.metadata || {},
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  NORMALISATION
// ═════════════════════════════════════════════════════════════════════════════

const AU_STATES = ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT'];

/**
 * Coerce one returned value into the shape its field actually takes, or reject
 * it. A value that will not normalise is dropped rather than stored badly: the
 * Owner types it, which is the outcome we already accept for an unreadable
 * scan.
 */
function normaliseValue(key, raw) {
  const def = FIELDS[key];
  if (!def) return null;
  let value = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!value) return null;
  if (value.length > 300) value = value.slice(0, 300);

  switch (def.kind) {
    case 'date': {
      const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!iso) return null;
      const d = new Date(`${value}T00:00:00Z`);
      if (Number.isNaN(d.getTime())) return null;
      // A date of birth in the future, or a credential expiry a century out,
      // is a misread rather than a fact.
      const year = Number(iso[1]);
      if (year < 1900 || year > 2100) return null;
      return value;
    }
    case 'email': {
      const email = value.toLowerCase();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255 ? email : null;
    }
    case 'phone': {
      const phone = value.replace(/[^\d+ ]/g, '').trim();
      const digits = phone.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15 ? phone.slice(0, 40) : null;
    }
    case 'bsb': {
      const digits = value.replace(/\D/g, '');
      return digits.length === 6 ? `${digits.slice(0, 3)}-${digits.slice(3)}` : null;
    }
    case 'account': {
      const digits = value.replace(/\D/g, '');
      return digits.length >= 5 && digits.length <= 12 ? digits : null;
    }
    case 'number': {
      const n = Number(value.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n >= 0 && n <= 168 ? String(n) : null;
    }
    default:
      break;
  }

  if (key === 'state' || key === 'postal_state') {
    const upper = value.toUpperCase().replace(/[^A-Z]/g, '');
    return AU_STATES.includes(upper) ? upper : null;
  }
  if (key === 'postcode' || key === 'postal_postcode') {
    const digits = value.replace(/\D/g, '');
    return digits.length === 4 ? digits : null;
  }
  if (key === 'employment_type') {
    const map = {
      'full time': 'full_time', fulltime: 'full_time', full_time: 'full_time', permanent: 'full_time',
      'part time': 'part_time', parttime: 'part_time', part_time: 'part_time',
      casual: 'casual', 'fixed term': 'fixed_term', fixedterm: 'fixed_term',
      fixed_term: 'fixed_term', contract: 'fixed_term', contractor: 'contractor',
    };
    return map[value.toLowerCase().replace(/-/g, ' ')] || null;
  }
  if (key === 'super_choice_type') {
    const lower = value.toLowerCase();
    if (/default|employer/.test(lower)) return 'employer_default';
    if (/choice|own|nominat|stapled/.test(lower)) return 'employee_choice';
    return null;
  }
  return value;
}

/**
 * A refusal of last resort.
 *
 * The prompt forbids tax file numbers and the schema has no key for one, but a
 * nine-digit run landing in `account_number` or a free-text field would defeat
 * both. Anything that looks like a bare TFN in a field that has no business
 * holding one is dropped, and the drop is counted so it is visible.
 */
function looksLikeTfn(key, value) {
  const def = FIELDS[key];
  if (!def) return true;
  // Account numbers are legitimately 8-9 digits; they are handled by their own
  // encrypted field and are not what this guard is for.
  if (def.kind === 'account' || def.kind === 'bsb') return false;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length !== 8 && digits.length !== 9) return false;
  // Only refuse when the field is one where a long digit run means nothing.
  return ['text'].includes(def.kind) && /^\d[\d\s-]*\d$/.test(String(value).trim());
}

/** Turn the model's raw array into storable proposals. */
function normaliseFields(rawFields, documentsByIndex) {
  const out = [];
  const seen = new Set();
  let dropped = 0;

  for (const item of rawFields) {
    if (!item || typeof item !== 'object') { dropped += 1; continue; }
    const key = String(item.key || '');
    const def = FIELDS[key];
    if (!def) { dropped += 1; continue; }
    if (seen.has(key)) { dropped += 1; continue; }

    const value = normaliseValue(key, item.value);
    if (value === null) { dropped += 1; continue; }
    if (looksLikeTfn(key, value)) {
      log.warn('extraction dropped a value resembling a tax file number', { field: key });
      dropped += 1;
      continue;
    }

    const source = documentsByIndex.get(Number(item.documentIndex)) || null;
    const page = Number.isInteger(item.page) && item.page > 0 && item.page < 2000 ? item.page : null;

    seen.add(key);
    out.push({
      key,
      group: def.group,
      label: def.label,
      sensitive: def.sensitive === true,
      value,
      confidence: ['high', 'medium', 'low'].includes(item.confidence) ? item.confidence : 'low',
      sourceDocumentId: source ? source.id : null,
      sourceLabel: source ? source.title : null,
      sourcePage: page,
    });
  }
  return { fields: out, dropped };
}

// ═════════════════════════════════════════════════════════════════════════════
//  MASKS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The ONLY renderable form of a sensitive value.
 *
 * Mirrors the *_masked convention 034 established for payroll_profiles, so a
 * BSB reviewed here looks the same as the one stored afterwards.
 */
function maskValue(key, value) {
  const def = FIELDS[key];
  const s = String(value || '');
  if (!def) return '••••';
  if (def.kind === 'bsb') return `${s.slice(0, 3)}-•••`;
  if (def.kind === 'account') return `••••${s.slice(-3)}`;
  if (s.length <= 4) return '••••';
  return `••••${s.slice(-4)}`;
}

module.exports = {
  AI_FEATURE,
  FIELDS,
  FIELD_KEYS,
  GROUP_LABELS,
  GROUP_ORDER,
  MAX_CHARS_PER_DOCUMENT,
  MAX_CHARS_PER_RUN,
  requiredPermissionFor,
  readDocumentText,
  buildCorpus,
  buildTool,
  callModel,
  normaliseValue,
  normaliseFields,
  looksLikeTfn,
  maskValue,
  SYSTEM_PROMPT,
};
