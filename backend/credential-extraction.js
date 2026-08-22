'use strict';

/**
 * CREDENTIAL SCAN EXTRACTION — reading the certificate so nobody retypes it.
 *
 * A credential card in the portal used to be an assertion: somebody typed
 * "WWCC WWC1234567, expires 1 May 2029" and the practice's compliance position
 * rested on that typing being right. This module reads the actual document —
 * the AHPRA certificate, the WWCC card, the NDIS screening letter — and
 * PROPOSES the fields it can see. A person then accepts, corrects or rejects
 * each one before anything is saved.
 *
 * ── WHY PROPOSALS, NOT FACTS ───────────────────────────────────────────────
 * The same reasoning as onboarding-extraction.js, and for the same reason: a
 * wrong answer that looks authoritative is worse than no answer. An expiry
 * date written straight into `credentials` by a model is a compliance date
 * nobody chose. So a read lands in `credential_extractions` with its per-field
 * confidence, and the credential row changes only when a human saves the form.
 *
 * ── WHY THIS IS NOT onboarding_document_extraction ─────────────────────────
 * That module reads TEXT from returned onboarding forms and says so plainly:
 * an image "is reported as such — this portal has no OCR dependency". A
 * photographed WWCC card has no text layer at all, so text extraction reads
 * nothing and the feature would be useless for its main case.
 *
 * This module therefore sends the PAGE IMAGE to a vision-capable model. That
 * is a different data path (pixels of an identity document, not typed form
 * text), so it gets its own policy entry and its own audit category rather
 * than being smuggled through one written for something else. A reviewer
 * asking "has an image of a staff identity document ever reached a model?"
 * must be able to get a straight answer from `ai_interactions.feature`.
 *
 * ── WHAT IS NEVER EXTRACTED ────────────────────────────────────────────────
 * A driver's licence carries a date of birth, a residential address, a
 * signature and a photograph. None of them is needed to know whether the
 * licence is current, so none of them is collected. The prompt forbids them,
 * `FIELDS` has no key for them, and migration 042 adds a CHECK constraint that
 * refuses a proposal row containing one. Three layers, because the prompt is
 * the layer that can be talked out of it.
 *
 * ── GOVERNANCE ─────────────────────────────────────────────────────────────
 * Every model call goes through backend/ai/ai-gateway.js under the
 * `credential_document_extraction` policy: Australian region, approved model
 * keys only, kill switch respected, denials audited. This module never imports
 * a provider SDK — tests/ai-gateway-boundary.test.js turns that into a build
 * failure.
 */

const gateway = require('./ai/ai-gateway');
const classification = require('./ai/ai-classification');
const outputTypes = require('./ai/ai-output-type');
const onboardingExtraction = require('./onboarding-extraction');
const log = require('./logger').createLogger('credential-extraction');

const AI_FEATURE = 'credential_document_extraction';

/** Text-layer budget for one credential. A certificate is one page; anything
 *  past this is a covering letter or a terms-and-conditions back page. */
const MAX_TEXT_CHARS = 12000;

/** Pages sent as images. A credential is one page and occasionally two (card
 *  front and back). Beyond that somebody has attached the wrong document. */
const MAX_PAGE_IMAGES = 3;

/** Per image, decoded. The client down-scales to roughly 1600px before
 *  encoding, which lands around 100-300 KB; 2 MB is generous for a page that
 *  is mostly a photograph, and three of them still fit the route's body
 *  limit with room to spare. The provider's own ceiling is 5 MB. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const ALLOWED_IMAGE_MIMES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

// ═════════════════════════════════════════════════════════════════════════════
//  THE FIELD VOCABULARY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The credential types the portal recognises. This list is the frontend's
 * select, the model's enum and the validator's allow-list — one vocabulary,
 * three consumers, so a type added in the UI cannot silently fail to survive a
 * read.
 */
const CREDENTIAL_TYPES = Object.freeze({
  ahpra_registration:    'AHPRA registration',
  wwcc:                  'Working with Children Check',
  ndis_worker_screening: 'NDIS Worker Screening Check',
  police_check:          'Police check',
  drivers_licence:       "Driver's licence",
  professional_indemnity:'Professional indemnity',
  public_liability:      'Public liability insurance',
  qualification:         'Qualification',
  first_aid:             'First aid certificate',
  cpr:                   'CPR certificate',
  other:                 'Other',
});

const CREDENTIAL_TYPE_KEYS = Object.freeze(Object.keys(CREDENTIAL_TYPES));

/**
 * The portal grew two names for four of these.
 *
 * Onboarding writes `ahpra_registration`; the profile's own Add dialog wrote
 * `ahpra`. Both are in the credentials table today, and a screen that knows
 * only one of them shows the other as a raw database string — which is
 * exactly what the Credentials list did before this change.
 *
 * The onboarding spelling wins, because that is what a compliance requirement
 * template refers to and what the expiry notices key off. The old spellings
 * are accepted for ever and folded to it. Nothing is renamed in the database
 * by this map: a row keeps the value it was written with until somebody saves
 * that credential, and `materialChanges` treats the two spellings as the same
 * value so an idle save does not withdraw a verification.
 */
const LEGACY_TYPE_ALIASES = Object.freeze({
  ahpra:               'ahpra_registration',
  ndis_screening:      'ndis_worker_screening',
  police_clearance:    'police_check',
  indemnity_insurance: 'professional_indemnity',
});

/** The canonical spelling of a credential type, or null if it is not one. */
function canonicalType(value) {
  const key = String(value == null ? '' : value).trim().toLowerCase();
  if (!key) return null;
  if (LEGACY_TYPE_ALIASES[key]) return LEGACY_TYPE_ALIASES[key];
  return CREDENTIAL_TYPE_KEYS.includes(key) ? key : null;
}

/**
 * Every field a read may return.
 *
 *   label     what the reviewer sees beside the proposal
 *   kind      'text' | 'date' | 'enum' | 'reference'
 *   target    the credentials column it fills, or null for review-only
 *
 * `holder_name` and `document_kind` are review-only on purpose. The name is
 * used once, to warn when the certificate belongs to somebody else, and is
 * never written to the credential. document_kind is how the reader says "this
 * looks like a first aid certificate" when the person filed it as a licence.
 */
const FIELDS = Object.freeze({
  credential_type: {
    label: 'Credential type', kind: 'enum', target: 'credential_type',
    description: 'Which of the practice\'s credential categories this document is.',
  },
  credential_name: {
    label: 'Credential name', kind: 'text', target: 'credential_name',
    description: 'The name of the credential as the document titles it, e.g. "Occupational Therapy Registration".',
  },
  issuing_body: {
    label: 'Issuing body', kind: 'text', target: 'issuing_body',
    description: 'The organisation that issued it, exactly as printed.',
  },
  registration_number: {
    label: 'Registration / reference number', kind: 'reference', target: 'registration_number',
    description: 'The registration, certificate, policy or licence number printed on the document.',
  },
  issue_date: {
    label: 'Issue date', kind: 'date', target: 'issue_date',
    description: 'The date of issue, effective date or period start. ISO YYYY-MM-DD.',
  },
  expiry_date: {
    label: 'Expiry date', kind: 'date', target: 'expiry_date',
    description: 'The expiry, valid-to or renewal date. ISO YYYY-MM-DD.',
  },
  holder_name: {
    label: 'Name on the document', kind: 'text', target: null,
    description: 'The person the document is issued to. Used only to warn about a mismatch; never stored on the credential.',
  },
  document_kind: {
    label: 'What this document appears to be', kind: 'text', target: null,
    description: 'A short plain description of the document, e.g. "AHPRA registration certificate".',
  },
});

const FIELD_KEYS = Object.freeze(Object.keys(FIELDS));

/** The columns a proposal may fill. Anything else is review-only. */
const TARGET_FIELDS = Object.freeze(
  FIELD_KEYS.filter((k) => FIELDS[k].target)
);

// ═════════════════════════════════════════════════════════════════════════════
//  READING THE FILE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The text layer, when there is one.
 *
 * Delegates to onboarding-extraction's reader rather than opening a second
 * pdfjs path — one pdf worker protocol, one set of failure modes. A scanned
 * certificate returns `no_text_layer`, which is not a failure here: it is the
 * ordinary case, and the image path covers it.
 */
async function readTextLayer(buffer, mime) {
  try {
    const result = await onboardingExtraction.readDocumentText(buffer, mime);
    const pages = Array.isArray(result.pages) ? result.pages : [];
    let text = '';
    for (let i = 0; i < pages.length && text.length < MAX_TEXT_CHARS; i += 1) {
      const body = String(pages[i] || '').trim();
      if (!body) continue;
      text += `--- page ${i + 1} ---\n${body.slice(0, MAX_TEXT_CHARS - text.length)}\n`;
    }
    return { status: result.status, text: text.trim(), chars: text.length };
  } catch (err) {
    log.warn('credential text layer read failed', { error: err });
    return { status: 'failed', text: '', chars: 0 };
  }
}

/** JPEG/PNG/WebP by magic bytes, not by what the client claimed. */
function sniffImageMime(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * Turn what the client sent into image blocks the provider will accept.
 *
 * The client rasterises PDF pages with the portal's own vendored pdf.js and
 * down-scales photographs, because the server has no canvas. That means these
 * bytes are client-supplied and are treated as such: sniffed, size-capped,
 * counted, and dropped individually rather than failing the whole read.
 *
 * @param {Array<{data:string, mime?:string}>} raw
 */
function prepareImages(raw) {
  const out = [];
  const rejected = [];
  const list = Array.isArray(raw) ? raw : [];

  for (const item of list) {
    if (out.length >= MAX_PAGE_IMAGES) { rejected.push('too_many_pages'); break; }
    const base64 = String((item && item.data) || '').replace(/^data:[^,]+,/, '').trim();
    if (!base64) { rejected.push('empty'); continue; }
    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(base64.slice(0, 2000))) { rejected.push('not_base64'); continue; }

    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      rejected.push('not_base64');
      continue;
    }
    if (buffer.length > MAX_IMAGE_BYTES) { rejected.push('too_large'); continue; }

    const sniffed = sniffImageMime(buffer);
    if (!sniffed || !ALLOWED_IMAGE_MIMES.includes(sniffed)) { rejected.push('not_an_image'); continue; }

    out.push({ mediaType: sniffed, data: buffer.toString('base64'), bytes: buffer.length });
  }

  return { images: out, rejected };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE MODEL CALL
// ═════════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = [
  'You read scanned professional credentials for an Australian allied-health',
  'practice: registration certificates, background-check cards, insurance',
  'certificates of currency, first aid statements of attainment, licences.',
  'You are a careful reader, not an interpreter.',
  '',
  'RULES',
  '1. Return ONLY what is printed on the document. Never infer a value, never',
  '   complete a partial one, never correct what looks like a typo. If a field',
  '   is absent, illegible or cropped, omit it. An omitted field is correct; a',
  '   guessed one is a defect that becomes a wrong compliance date.',
  '2. NEVER return a date of birth, a residential or postal address, a',
  '   signature, a photograph description, a Medicare number or a tax file',
  '   number, under any field, even if the document shows one. Ignore them.',
  '   Do not mention them. They are not needed to know whether a credential is',
  '   current, so they are not collected.',
  '3. Dates must be ISO (YYYY-MM-DD). Australian documents are day-first:',
  '   03/04/2029 is 3 April 2029. If a date is genuinely ambiguous or partly',
  '   obscured, omit it rather than choosing.',
  '4. Distinguish the ISSUE date from the EXPIRY date by its label ("Issued",',
  '   "Effective", "Valid from" against "Expires", "Valid to", "Renewal due").',
  '   If only one date is printed and its meaning is not labelled, omit both.',
  '5. registration_number is the number identifying THIS credential — the',
  '   registration, certificate, policy or licence number. It is not a phone',
  '   number, an ABN, a receipt number or a document reference in a footer.',
  '6. confidence is your own reading certainty for THAT value:',
  '     high   - printed clearly and unambiguously labelled',
  '     medium - legible but with some doubt, or inferred from layout',
  '     low    - hard to read, cropped, or a guess at which label applies',
  '7. If the image is too blurred, too dark, or too cropped to read, set',
  '   unreadable to true and return no fields. Saying "I could not read this"',
  '   is a correct answer here. Guessing is not.',
  '8. If the document is plainly not a credential (a payslip, a photo of a',
  '   room, a blank page), set unreadable to true and say so in notes.',
  '',
  'Return your answer only through the record_credential tool.',
].join('\n');

/** The tool the model must call. Forcing structure beats parsing prose. */
function buildTool() {
  const properties = {};
  for (const key of FIELD_KEYS) {
    properties[key] = {
      type: 'object',
      description: FIELDS[key].description,
      properties: {
        value: key === 'credential_type'
          ? { type: 'string', enum: CREDENTIAL_TYPE_KEYS, description: 'One of the practice\'s credential categories.' }
          : { type: 'string', description: 'The value exactly as printed on the document.' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      },
      required: ['value', 'confidence'],
    };
  }

  return {
    name: 'record_credential',
    description: 'Record the credential details read from the supplied document.',
    input_schema: {
      type: 'object',
      properties: {
        ...properties,
        unreadable: {
          type: 'boolean',
          description: 'True when the document cannot be read, or is not a credential at all.',
        },
        notes: {
          type: 'string',
          description: 'What the reviewer should know: a missing expiry, a cropped corner, a document that looks like something else. Never a field value.',
        },
      },
      required: [],
    },
  };
}

/**
 * Build the user turn. Images first, then the text layer, then the ask —
 * the model reads better with the evidence before the instruction, and a text
 * layer placed after the image lets it use printed text to confirm what it saw
 * rather than the other way round.
 */
function buildMessages({ images, text, credentialTypeHint }) {
  const content = [];

  for (let i = 0; i < images.length; i += 1) {
    if (images.length > 1) {
      content.push({ type: 'text', text: `Page ${i + 1} of ${images.length}:` });
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: images[i].mediaType, data: images[i].data },
    });
  }

  if (text) {
    content.push({
      type: 'text',
      text: `Text layer extracted from the same document:\n\n${text}`,
    });
  }

  const hint = credentialTypeHint && CREDENTIAL_TYPES[credentialTypeHint]
    // A hint is context, never an instruction — a person who picked the wrong
    // type from the dropdown should be corrected by the document, not
    // confirmed by it.
    ? `\n\nThe person filing it selected "${CREDENTIAL_TYPES[credentialTypeHint]}". Treat that as a hint only: if the document says otherwise, report what the document says.`
    : '';

  content.push({
    type: 'text',
    text: `Read this credential document and record what is printed on it.${hint}`,
  });

  return [{ role: 'user', content }];
}

/**
 * Ask the model to read one credential document.
 *
 * Never throws for an AI-side refusal. A denied policy, a tripped guardrail or
 * a provider outage all return a status the caller can show honestly — the
 * fallback is always "type the three fields yourself", which is exactly what
 * the portal did before this feature existed.
 *
 * @returns {Promise<{status:string, fields:object, notes:string, warnings:string[], sourceKind:string, meta:object}>}
 */
async function extract({
  buffer, mime, pageImages, credentialTypeHint, userId, organisationId, modelKey,
} = {}) {
  const textLayer = buffer ? await readTextLayer(buffer, mime) : { status: 'none', text: '', chars: 0 };
  const { images, rejected } = prepareImages(pageImages);

  const sourceKind = images.length && textLayer.text ? 'text+image'
    : images.length ? 'image'
      : textLayer.text ? 'text'
        : 'unknown';

  if (sourceKind === 'unknown') {
    return {
      status: 'unreadable',
      fields: {},
      notes: 'Nothing readable could be taken from this file — it has no text layer and no page image was produced.',
      warnings: rejected.length ? [`page images rejected: ${rejected.join(', ')}`] : [],
      sourceKind,
      meta: {},
    };
  }

  const tool = buildTool();
  let result;
  try {
    result = await gateway.generate({
      feature: AI_FEATURE,
      // Left undefined by every caller in the application, so the policy's
      // own default decides. Present so tests can reach the mock provider
      // without a second code path through the gateway.
      modelKey,
      // A staff member's own registration certificate: information about
      // somebody who works here, not about a participant we treat. INTERNAL,
      // and the policy pins it onshore regardless.
      classification: classification.INTERNAL,
      outputType: outputTypes.ASSISTANT_RESPONSE,
      system: SYSTEM_PROMPT,
      messages: buildMessages({ images, text: textLayer.text, credentialTypeHint }),
      tools: [tool],
      toolChoice: { type: 'tool', name: tool.name },
      maxTokens: 1500,
      userId,
      organisationId,
    });
  } catch (err) {
    // Three different unhappy endings, and the reviewer deserves to know
    // which one they got. A guardrail refusal in particular is expected on
    // identity documents — they are dense with exactly the personal
    // information a guardrail is configured to stop — and it is not a bug in
    // this module.
    const reason = err && (err.reason || err.message);
    const refused = reason === 'guardrail_intervened' || reason === 'guardrail_not_configured';
    const denied = err && err.name === 'AiPolicyError';
    log.warn('credential extraction unavailable', { reason: String(reason || 'unknown') });
    return {
      status: refused ? 'refused' : denied ? 'unavailable' : 'failed',
      fields: {},
      notes: '',
      warnings: [],
      sourceKind,
      meta: {},
      reason: String(reason || 'unknown'),
    };
  }

  const call = result && result.toolUse;
  if (!call || call.name !== tool.name || !call.input) {
    return {
      status: 'unreadable', fields: {}, notes: '', warnings: [], sourceKind,
      meta: (result && result.metadata) || {},
    };
  }

  const input = call.input;
  const notes = typeof input.notes === 'string' ? input.notes.slice(0, 500) : '';

  if (input.unreadable === true) {
    return {
      status: 'unreadable', fields: {}, notes, warnings: [], sourceKind,
      meta: result.metadata || {},
    };
  }

  const { fields, warnings } = normaliseProposal(input);
  if (rejected.length) warnings.push(`page images rejected: ${rejected.join(', ')}`);

  return {
    status: Object.keys(fields).length ? 'proposed' : 'unreadable',
    fields,
    notes,
    warnings,
    sourceKind,
    meta: result.metadata || {},
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  NORMALISATION
// ═════════════════════════════════════════════════════════════════════════════

const MONTHS = Object.freeze({
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
});

const CONFIDENCES = Object.freeze(['high', 'medium', 'low']);

/**
 * Coerce one returned value into the shape its field takes, or reject it.
 *
 * A value that will not normalise is DROPPED, not stored badly. The cost of
 * dropping is that somebody types one field; the cost of storing badly is a
 * compliance date that is wrong and looks verified.
 */
function normaliseValue(key, raw) {
  const def = FIELDS[key];
  if (!def) return null;

  let value = String(raw == null ? '' : raw).trim().replace(/\s+/g, ' ');
  if (!value) return null;

  switch (def.kind) {
    case 'enum':
      return canonicalType(value);

    case 'date':
      return normaliseDate(value);

    case 'reference': {
      // Certificate numbers are alphanumeric with the odd separator, and every
      // one of them carries a digit. Two cheap rules kill the failure that
      // actually happens — the model returning the sentence beside the label
      // ("see attached letter") rather than the number, which would otherwise
      // become a registration number of SEEATTACHEDLETTER.
      if (!/\d/.test(value)) return null;
      if (value.split(' ').length > 3) return null;
      const ref = value.toUpperCase().replace(/\s+/g, '');
      if (!/^[A-Z0-9][A-Z0-9\-/.]{2,49}$/.test(ref)) return null;
      return ref;
    }

    default:
      return value.slice(0, 200);
  }
}

/**
 * ISO, or an unambiguous written date. Nothing else.
 *
 * `03/04/2029` is deliberately REFUSED even though the prompt calls Australian
 * documents day-first: if the model failed to follow the ISO instruction, its
 * reading of the day/month order is exactly the thing that cannot be trusted,
 * and a silently transposed expiry date is the worst defect this feature could
 * ship. The reviewer types it.
 */
function normaliseDate(value) {
  let iso = null;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    iso = value;
  } else {
    // "1 May 2029", "01 May 2029", "1 May 29" is not accepted — a two-digit
    // year on a credential is a misread of something else.
    const written = value.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/);
    if (written) {
      const month = MONTHS[written[2].slice(0, 3).toLowerCase()];
      if (!month) return null;
      iso = `${written[3]}-${month}-${String(written[1]).padStart(2, '0')}`;
    }
  }
  if (!iso) return null;

  const [y, m, d] = iso.split('-').map(Number);
  if (y < 1950 || y > 2100) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Round-trip through Date to reject 2029-02-31 and friends.
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.getUTCDate() !== d || parsed.getUTCMonth() + 1 !== m) return null;
  return iso;
}

/**
 * Turn the tool input into `{ key: { value, confidence } }`, dropping every
 * key the vocabulary does not know and every value that will not normalise.
 *
 * Returns warnings for the things a reviewer should look at rather than the
 * things the parser silently fixed — an expiry before its issue date is the
 * one that matters, because both values can be individually plausible.
 */
function normaliseProposal(input) {
  const fields = {};
  const warnings = [];

  for (const key of FIELD_KEYS) {
    const entry = input && input[key];
    if (!entry || typeof entry !== 'object') continue;

    const value = normaliseValue(key, entry.value);
    if (value === null) continue;

    const confidence = CONFIDENCES.includes(String(entry.confidence || '').toLowerCase())
      ? String(entry.confidence).toLowerCase()
      : 'low';

    fields[key] = { value, confidence };
  }

  if (fields.issue_date && fields.expiry_date && fields.expiry_date.value <= fields.issue_date.value) {
    warnings.push('The expiry date read from this document is not after its issue date — check both before saving.');
    fields.issue_date.confidence = 'low';
    fields.expiry_date.confidence = 'low';
  }

  if (fields.expiry_date) {
    const year = Number(fields.expiry_date.value.slice(0, 4));
    const thisYear = new Date().getUTCFullYear();
    if (year > thisYear + 25) {
      warnings.push('The expiry date read from this document is more than 25 years away — check it before saving.');
      fields.expiry_date.confidence = 'low';
    }
  }

  return { fields, warnings };
}

/**
 * Does the name on the document look like the person filing it?
 *
 * Deliberately forgiving: initials, middle names, maiden names and reversed
 * order all differ legitimately. This warns, and only warns, when NO part of
 * the printed name matches any part of the account name — the case that
 * catches somebody uploading a colleague's certificate by mistake.
 */
function holderNameMismatch(documentName, accountName) {
  const parts = (s) => String(s || '')
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);

  const onDoc = parts(documentName);
  const onAccount = parts(accountName);
  if (!onDoc.length || !onAccount.length) return false;
  return !onDoc.some((w) => onAccount.includes(w));
}

/** Only the keys that fill a credential column, in save order. */
function targetValues(fields) {
  const out = {};
  for (const key of TARGET_FIELDS) {
    if (fields && fields[key] && fields[key].value != null) out[key] = fields[key].value;
  }
  return out;
}

module.exports = {
  AI_FEATURE,
  CREDENTIAL_TYPES,
  CREDENTIAL_TYPE_KEYS,
  LEGACY_TYPE_ALIASES,
  canonicalType,
  FIELDS,
  FIELD_KEYS,
  TARGET_FIELDS,
  MAX_PAGE_IMAGES,
  MAX_IMAGE_BYTES,
  SYSTEM_PROMPT,
  readTextLayer,
  sniffImageMime,
  prepareImages,
  buildTool,
  buildMessages,
  extract,
  normaliseValue,
  normaliseDate,
  normaliseProposal,
  holderNameMismatch,
  targetValues,
};
