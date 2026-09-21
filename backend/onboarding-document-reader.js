'use strict';

/**
 * ONBOARDING DOCUMENT READER — every returned document is read, whatever
 * shape it comes back in.
 *
 * onboarding-form-reader.js reads the pack's forms when they come back as the
 * fillable PDFs. People return other things: the Word copy of the same form,
 * a PDF printed from Word, a scan of the signed pages, a photograph of a
 * licence, a certificate from a registry. This module gets the text out of
 * any of them and reads it by fixed rules. No model is involved.
 *
 *   1. TEXT     the text layer of a PDF, the body of a Word file, or — when a
 *               page has no text layer at all — local OCR (onboarding-ocr.js).
 *   2. KIND     what the document is: its title or distinctive wording, else
 *               the hint the caller derived from its file name.
 *   3. FIELDS   the New Employee Details and the Contract are read against the
 *               SAME specs and value rules as their fillable PDFs; a
 *               certificate is read by the labels printed on it.
 *
 *   readDocument({ buffer, mime, kindHint })
 *     → { text: { source, confidence, chars, pageCount, truncated }, reading: null | { kind, check, candidates, signed } }
 *
 *   text.source  'form_fields' | 'text_layer' | 'word' | 'ocr' | 'none'
 *
 * A value read by OCR is proposed at 'medium' confidence, never 'high': it is
 * a machine's reading of pixels, and the reviewer sees it beside the page.
 */

const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');
const formReader = require('./onboarding-form-reader');
const extraction = require('./onboarding-extraction');
const ocr = require('./onboarding-ocr');

const { SPECS, _internals: { applyRules, candidatesFrom, linesOf } } = formReader;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const lk = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stamp = () => new Date().toISOString();
const BLANK = /^[\s_.\-–—]*$/;
const TICKED = '(?:☒|☑|✔|✓|\\[\\s*[xX✓]\\s*\\]|\\(\\s*[xX]\\s*\\))';

// ═════════════════════════════════════════════════════════════════════════════
//  TEXT
// ═════════════════════════════════════════════════════════════════════════════

async function textOf({ buffer, mime }) {
  const type = String(mime || '').toLowerCase();
  const read = await extraction.readDocumentText(buffer, type);
  if (read.status === 'extracted') {
    // pdfPageTexts runs a page together; the labels are read line by line, so the lines are rebuilt from the positioned words.
    if (type === 'application/pdf') {
      try {
        const items = await require('./resource-file-quality').pdfPageItems(buffer);
        const pages = linesOf(items).map((lines) => lines.map((l) => l.text).join('\n'));
        if (pages.some((p) => p.trim())) return { source: 'text_layer', confidence: null, pages, chars: read.chars, pageCount: pages.length, truncated: false };
      } catch (_) { /* the run-together text is still better than none */ }
    }
    return { source: type === DOCX_MIME ? 'word' : 'text_layer', confidence: null, pages: read.pages, chars: read.chars, pageCount: read.pages.length, truncated: false };
  }
  if (read.status === 'no_text_layer' && (type === 'application/pdf' || type.startsWith('image/'))) {
    const r = await ocr.ocrDocument({ buffer, mime: type });
    if (r.status === 'ocr') return { source: 'ocr', confidence: r.confidence, pages: r.pages, chars: r.chars, pageCount: r.pageCount, truncated: r.truncated };
  }
  return { source: 'none', confidence: null, pages: [], chars: 0, pageCount: 0, truncated: false };
}

// ═════════════════════════════════════════════════════════════════════════════
//  KIND
// ═════════════════════════════════════════════════════════════════════════════

const KIND_BY_TEXT = [
  [/new employee details/i, 'new_employee_details'],
  [/contract of employment|this employment contract is made/i, 'contract'],
  [/working with children/i, 'wwcc'],
  [/ndis worker screening/i, 'ndis_screening'],
  [/national police (check|certificate)|police (check|certificate)|criminal history check/i, 'police_check'],
  [/ahpra|health practitioner regulation|certificate of registration/i, 'ahpra'],
  [/hltaid|first aid|cardiopulmonary|statement of attainment/i, 'first_aid'],
  [/passport/i, 'passport'],
  [/driver'?s? licen[cs]e|licence class/i, 'drivers_licence'],
];
function kindOf(text, hint) {
  const head = text.slice(0, 1500);
  const hit = KIND_BY_TEXT.find(([re]) => re.test(head));
  // A pack form names itself; otherwise the file name's hint outranks a passing mention in the text.
  if (hit && (hit[1] === 'new_employee_details' || hit[1] === 'contract')) return hit[1];
  return hint || (hit ? hit[1] : null);
}

// ═════════════════════════════════════════════════════════════════════════════
//  CERTIFICATES — the labels printed on them
// ═════════════════════════════════════════════════════════════════════════════

/** kind → [[label pattern, FIELDS key]]. The first label on the page that matches wins. */
const NAME_RULES = [[/(?:full )?name(?: of (?:holder|applicant|practitioner))?|holder|surname and given names?/, 'full_name'], [/date of birth|dob/, 'date_of_birth']];
const CERTIFICATE_RULES = {
  ahpra: [[/(?:ahpra )?registration (?:number|no)/, 'ahpra_registration_number'], [/(?:registration )?expiry(?: date)?|expires|valid (?:to|until)/, 'ahpra_expiry']],
  drivers_licence: [[/licen[cs]e (?:number|no)/, 'drivers_licence_number'], [/state(?: territory)?(?: of issue)?/, 'drivers_licence_state'], [/expiry(?: date)?|expires/, 'drivers_licence_expiry']],
  passport: [[/passport (?:number|no)|document (?:number|no)/, 'passport_number'], [/country of issue|issuing (?:country|state|authority)/, 'passport_country'], [/(?:date of )?expiry(?: date)?|expires/, 'passport_expiry']],
  first_aid: [[/first aid expiry(?: date)?/, 'first_aid_expiry'], [/cpr expiry(?: date)?/, 'cpr_expiry']],
  cpr: [[/cpr expiry(?: date)?|expiry(?: date)?/, 'cpr_expiry']],
  ndis_screening: [[/(?:ndis )?worker screening (?:check )?(?:number|id|no)|screening (?:number|id)|clearance (?:number|id)/, 'ndis_screening_number'], [/expiry(?: date)?|expires/, 'ndis_screening_expiry']],
  wwcc: [[/wwcc? (?:number|no)|card (?:number|no)|notice (?:number|no)/, 'wwcc_number'], [/expiry(?: date)?|expires/, 'wwcc_expiry']],
  police_check: [[/(?:certificate )?reference (?:number|no)|certificate (?:number|no)/, 'police_check_reference'], [/date of issue|issue date|date issued|issued/, 'police_check_date']],
};

/** "Label: value" on one line, or a label on a line of its own with the value on the next. */
function labelledValue(lines, pattern) {
  const re = new RegExp(`^(?:${pattern.source})\\s*[:\\-–]?\\s*(.*)$`, 'i');
  for (let i = 0; i < lines.length; i += 1) {
    const m = lk(lines[i]).length <= 120 && lines[i].replace(/[^A-Za-z0-9:/ .'\-–]+/g, ' ').trim().match(re);
    if (!m) continue;
    const same = norm(m[1]);
    if (same && !BLANK.test(same)) return same;
    const next = norm(lines[i + 1] || '');
    if (next && !BLANK.test(next) && !/:\s*$/.test(next)) return next;
  }
  return null;
}

function readCertificate(kind, text, source) {
  const rules = CERTIFICATE_RULES[kind];
  if (!rules) return null;
  const lines = text.split(/\n+/).map(norm).filter(Boolean);
  const confidence = source === 'ocr' ? 'medium' : 'high';
  const fields = []; const candidates = [];
  const push = (key, raw) => {
    if (key === 'full_name') {
      const parts = raw.replace(/[^A-Za-z' \-]/g, ' ').trim().split(/\s+/);
      if (parts.length < 2) return false;
      for (const [k, v] of [['legal_first_name', parts[0]], ['surname', parts[parts.length - 1]], ['middle_name', parts.length > 2 ? parts.slice(1, -1).join(' ') : null]]) {
        const n = v && extraction.FIELDS[k] ? extraction.normaliseValue(k, v) : null;
        if (n !== null && n !== undefined && v) candidates.push({ key: k, value: n, confidence, page: null });
      }
      return true;
    }
    if (!extraction.FIELDS[key]) return false;
    const date = /expiry|_date$|date_of_birth/.test(key) ? formReader.parseDate(raw.replace(/[^0-9A-Za-z/.\- ]/g, '').trim()) : null;
    const v = extraction.normaliseValue(key, date || raw);
    if (v === null || v === undefined) return false;
    candidates.push({ key, value: v, confidence, page: null });
    return true;
  };
  for (const [pattern, key] of [...rules, ...NAME_RULES]) {
    const raw = labelledValue(lines, pattern);
    const label = (extraction.FIELDS[key] && extraction.FIELDS[key].label) || (key === 'full_name' ? 'Name on the document' : key);
    const ok = raw ? push(key, raw) : false;
    fields.push({ label, filled: !!raw, ...(raw && !ok ? { valid: false } : {}) });
  }
  const own = rules.map(([, key]) => key);
  // None of its own details found: this is not a reading with gaps, it is no reading — a person looks at it, as before.
  if (!own.some((key) => candidates.some((c) => c.key === key))) return null;
  const missing = own.filter((key) => !candidates.some((c) => c.key === key));
  const issues = missing.map((key) => ({ code: 'missing', message: `${extraction.FIELDS[key] ? extraction.FIELDS[key].label : key} could not be read from the document` }));
  return { kind, signed: 'unknown', candidates, check: { status: issues.length ? 'attention' : 'ok', method: source === 'ocr' ? 'ocr' : 'text', kind, fields, issues, checkedAt: stamp() } };
}

// ═════════════════════════════════════════════════════════════════════════════
//  NEW EMPLOYEE DETAILS — the Word form, its PDF print, or a scan of it
// ═════════════════════════════════════════════════════════════════════════════

/** section heading → { label → AcroForm field name }, and its tick groups { question → { answer → box name } }. */
const NED_SECTIONS = [
  { id: 'intro', heading: /^new employee details$/, labels: { 'organisation name': 'p1_organisation_name', address: 'p1_address', 'contact details': 'p1_contact_details', 'name and role of person completing this form': 'p1_name_and_role_of_person_completing_th', 'date the form was completed': 'p1_date_the_form_was_completed' } },
  { id: 'employee', heading: /^employee details$/,
    labels: { 'first name': 'p2_first_name', 'preferred name': 'p2_preferred_name', 'middle name': 'p2_middle_name', 'last name': 'p2_last_name', 'date of birth': 'p2_date_of_birth', 'preferred language': 'p2_preferred_language', 'employment start date': 'p2_employment_start_date', 'role position title': 'p2_role_position_title', 'date of completion': 'p2_date_of_completion', type: 'p2_type', expiry: 'p2_expiry' },
    ticks: { 'identifies as': { Male: 'p2_identifies_as_male', Female: 'p2_identifies_as_female', Transgender: 'p2_identifies_as_transgender', 'Non-binary': 'p2_identifies_as_non_binary', Other: 'p2_identifies_as_other' },
      'interpreter required': { Yes: 'p2_interpreter_required_yes', No: 'p2_interpreter_required_no' },
      'aboriginal or torres strait islander': { Yes: 'p2_aboriginal_or_torres_strait_islander_', No: 'p2_aboriginal_or_torres_strait_islander__2', 'Prefer not to say': 'p2_aboriginal_or_torres_strait_islander__3' },
      'ndis worker orientation module completed': { Yes: 'p2_ndis_worker_orientation_module_comple', No: 'p2_ndis_worker_orientation_module_comple_2' },
      'australian citizen': { Yes: 'p2_australian_citizen_yes', No: 'p2_australian_citizen_no' },
      'are you a permanent resident': { Yes: 'p2_are_you_a_permanent_resident_yes', No: 'p2_are_you_a_permanent_resident_yes_no' } } },
  { id: 'transport', heading: /^employment transport and location$/, labels: { 'car registration details': 'p2_car_registration_details_if_applicabl', 'site service name': 'p2_site_service_name', 'site address': 'p2_site_address', 'contact details': 'p2_contact_details', 'contact name': 'p2_contact_name' },
    questions: [[/secondary employment/, 'p2_do_you_have_secondary_employment_i_e_'], [/skills qualifications or experience/, 'p3_do_you_have_any_skills_qualifications'], [/pre existing medical/, 'p3_do_you_have_any_pre_existing_medical_'], [/any allergies/, 'p3_do_you_have_any_allergies']] },
  { id: 'doctor', heading: /^health practitioner details$/, labels: { name: 'p3_name', address: 'p3_address', phone: 'p3_phone', email: 'p3_email' } },
  { id: 'emergency', heading: /^emergency contact details$/, labels: { name: 'p3_name_2', 'relationship to employee': 'p3_relationship_to_employee', address: 'p3_address_2', mobile: 'p3_mobile', email: 'p3_email_2' } },
  { id: 'bank', heading: /^bank details$/, labels: { 'account name': 'p4_account_name', 'bank financial institution': 'p4_bank_financial_institution', bsb: 'p4_bsb', 'account number': 'p4_account_number', 'superannuation fund name': 'p4_superannuation_fund_name', 'super member number usi': 'p4_super_member_number_usi' },
    ticks: { 'tax file number declaration provided': { Yes: 'p4_tax_file_number_declaration_provided_', No: 'p4_tax_file_number_declaration_provided__2' } } },
  { id: 'licence', heading: /^driver s licence details$/, labels: { 'licence number': 'p4_licence_number', 'state territory of issue': 'p4_state_territory_of_issue', 'licence class': 'p4_licence_class', 'expiry date': 'p4_expiry_date' },
    ticks: { 'copy of driver s licence': { Attached: 'p4_copy_of_driver_s_licence_front_and_ba', 'To follow': 'p4_copy_of_driver_s_licence_front_and_ba_2' } } },
  { id: 'identity', heading: /^working rights and identity verification$/, labels: { 'passport number': 'p4_passport_number', 'country of issue': 'p4_country_of_issue', 'passport expiry date': 'p4_passport_expiry_date', 'visa grant number vevo check': 'p4_visa_grant_number_vevo_check_if_appli', 'other identity document': 'p4_other_identity_document_e_g_birth_cer' },
    ticks: { 'passport photo page attached': { Attached: 'p4_passport_photo_page_attached_required' } } },
  { id: 'ahpra', heading: /^ahpra registration details$/, labels: { 'ahpra registration number': 'p5_ahpra_registration_number', 'profession division': 'p5_profession_division', 'registration type': 'p5_registration_type', 'registration expiry date': 'p5_registration_expiry_date', 'if yes please provide details': 'p5_if_yes_please_provide_details' },
    ticks: { 'conditions or undertakings on registration': { Yes: 'p5_conditions_or_undertakings_on_registr', No: 'p5_conditions_or_undertakings_on_registr_2' }, 'copy of ahpra registration certificate': { Attached: 'p5_copy_of_ahpra_registration_certificat', 'To follow': 'p5_copy_of_ahpra_registration_certificat_2' } } },
  { id: 'first_aid', heading: /^first aid and cpr certification$/, labels: { 'first aid certificate number': 'p5_first_aid_certificate_number', 'training provider': 'p5_training_provider', 'first aid expiry date': 'p5_first_aid_expiry_date', 'cpr expiry date': 'p5_cpr_expiry_date' },
    ticks: { 'first aid cpr required for this role': { Yes: 'p5_first_aid_cpr_required_for_this_role_', No: 'p5_first_aid_cpr_required_for_this_role__2' }, 'copy of first aid cpr certificate': { Attached: 'p5_copy_of_first_aid_cpr_certificate_att', 'To follow': 'p5_copy_of_first_aid_cpr_certificate_att_2' } } },
  { id: 'ndis', heading: /^ndis worker screening check$/, labels: { 'ndis worker screening check number': 'p5_ndis_worker_screening_check_number', 'state territory of issue': 'p5_state_territory_of_issue', 'date of issue': 'p5_date_of_issue', 'expiry date': 'p5_expiry_date' },
    ticks: { 'clearance status': { Cleared: 'p5_clearance_status_cleared', 'Application in progress': 'p5_clearance_status_application' }, 'linked to opal therapy': { Yes: 'p5_linked_to_opal_therapy_in_the_ndis_wo', No: 'p5_linked_to_opal_therapy_in_the_ndis_wo_2' }, 'copy of ndis worker screening clearance': { Attached: 'p5_copy_of_ndis_worker_screening_clearan', 'To follow': 'p5_copy_of_ndis_worker_screening_clearan_2' } } },
  { id: 'wwcc', heading: /^working with children check/, labels: { 'wwcc number': 'p6_wwcc_number', 'state territory of issue': 'p6_state_territory_of_issue', 'expiry date': 'p6_expiry_date' },
    ticks: { 'clearance type': { Employee: 'p6_clearance_type_employee', Volunteer: 'p6_clearance_type_volunteer' }, 'copy of wwcc clearance': { Attached: 'p6_copy_of_wwcc_clearance_attached_attac', 'To follow': 'p6_copy_of_wwcc_clearance_attached_to' } } },
  { id: 'police', heading: /^national police check$/, labels: { 'date of issue': 'p6_date_of_issue', 'issuing body provider': 'p6_issuing_body_provider', 'certificate reference number': 'p6_certificate_reference_number', 'if no date applied': 'p6_if_no_date_applied', 'if yes please provide details': 'p6_if_yes_please_provide_details' },
    ticks: { 'police check completed': { Yes: 'p6_police_check_completed_yes', No: 'p6_police_check_completed_no' }, 'disclosable court outcomes recorded': { Yes: 'p6_disclosable_court_outcomes_recorded_y', No: 'p6_disclosable_court_outcomes_recorded_n' }, 'copy of police check certificate': { Attached: 'p6_copy_of_police_check_certificate_atta', 'To follow': 'p6_copy_of_police_check_certificate_atta_2' } } },
  { id: 'declaration', heading: /^employee declaration$/, labels: { signature: 'p6_signature', date: 'p6_date' } },
];

/** The longest label of the section that the text starts with → [field name, the rest of the text]. */
function splitLabel(section, text) {
  const key = lk(text);
  const hit = Object.keys(section.labels || {}).sort((a, b) => b.length - a.length).find((l) => key === l || key.startsWith(`${l} `));
  if (!hit) return null;
  // Skip the label's own words in the original text, then any "(…)" aside, "?" and ":".
  let rest = text; for (const word of hit.split(' ')) { const i = lk(rest.slice(0, 80)).indexOf(word); if (i < 0) break; rest = rest.replace(new RegExp(`^.*?${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ''); }
  rest = rest.replace(/^\s*(\([^)]*\))?\s*[?:]?\s*/, '');
  return [section.labels[hit], rest];
}

function tickGroup(section, text) {
  const key = lk(text);
  const q = Object.keys(section.ticks || {}).find((question) => key.startsWith(question));
  return q ? section.ticks[q] : null;
}

function readTicks(boxes, text, raw) {
  for (const [answer, name] of Object.entries(boxes)) {
    const on = new RegExp(`${TICKED}\\s*${answer.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![a-z-])`, 'i').test(text);
    if (on || !raw.has(name)) raw.set(name, { value: '', checked: on });
  }
}

/** A blank after a prompt inside a cell: "Date of Completion: 02/09/2026". */
function inlineBlanks(section, text, raw) {
  for (const [label, name] of Object.entries(section.labels || {})) {
    const words = label.split(' ').map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^A-Za-z0-9]+');
    const m = text.match(new RegExp(`${words}\\s*:\\s*([^☐☒☑\\n]+)`, 'i'));
    if (m && !BLANK.test(m[1]) && !raw.has(name)) raw.set(name, { value: norm(m[1]) });
  }
}

/** The form as a sequence of { heading } | { label, value } | { para } entries. */
async function nedEntriesFromDocx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const xml = (await zip.file('word/document.xml').async('string')).replace(/^﻿/, '');
  const doc = new DOMParser({ onError() {} }).parseFromString(xml, 'text/xml');
  const text = (n) => { let s = ''; const w = (e) => { if (e.nodeName === 'w:t') s += e.textContent; else if (e.nodeName === 'w:p' && s) s += '\n'; for (let c = e.firstChild; c; c = c.nextSibling) w(c); }; w(n); return s.trim(); };
  const out = [];
  const body = doc.getElementsByTagName('w:body')[0];
  for (let n = body && body.firstChild; n; n = n.nextSibling) {
    if (n.nodeName === 'w:p') { const t = norm(text(n)); if (t) out.push({ para: t }); continue; }
    if (n.nodeName !== 'w:tbl') continue;
    const rows = Array.from(n.getElementsByTagName('w:tr')).map((tr) => Array.from(tr.getElementsByTagName('w:tc')).map((tc) => norm(text(tc))));
    if (rows.every((r) => r.length === 1)) out.push({ question: rows[0][0], answer: rows.slice(2).map((r) => r[0]).filter(Boolean).join(' ') });
    else for (const r of rows) out.push({ label: r[0], value: r.slice(1).join(' ') });
  }
  return out;
}

function nedEntriesFromText(text) {
  return text.split(/\n+/).map(norm).filter(Boolean).map((line) => ({ line }));
}

function readNed(entries, source) {
  const raw = new Map();
  let section = NED_SECTIONS[0];
  const sectionFor = (t) => NED_SECTIONS.find((s) => s.heading.test(lk(t)));
  const questions = NED_SECTIONS.flatMap((s) => s.questions || []);
  for (const e of entries) {
    const head = sectionFor(e.para || e.line || '');
    if (head) { section = head; continue; }
    if (e.question !== undefined) { const q = questions.find(([re]) => re.test(lk(e.question))); if (q) raw.set(q[1], { value: e.answer }); continue; }
    const whole = e.label !== undefined ? `${e.label} ${e.value}` : (e.para || e.line);
    // "I, <name> consent to this information …"
    const decl = whole.match(/^I,?\s+(.+?)\s+consent to this information/i);
    if (decl) { if (!BLANK.test(decl[1])) raw.set('p6_i', { value: norm(decl[1]) }); continue; }
    const boxes = tickGroup(section, whole);
    if (boxes) { readTicks(boxes, whole, raw); inlineBlanks(section, whole, raw); continue; }
    const split = e.label !== undefined ? (splitLabel(section, e.label) ? [splitLabel(section, e.label)[0], e.value] : null) : splitLabel(section, whole);
    if (split && !raw.has(split[0])) raw.set(split[0], { value: BLANK.test(split[1]) ? '' : norm(split[1]) });
  }
  const spec = SPECS.NEW_EMPLOYEE_DETAILS;
  // A tick drawn by hand does not survive OCR, and in Word people type an X as
  // often as they change the glyph: a completed dependent field implies its box.
  for (const f of spec.fields) {
    if (!f.when || f.group) continue;
    const dependent = raw.get(f.name);
    // …unless the question was answered outright: a box the employee ticked is never overruled.
    const group = spec.fields.find((g) => g.group && Object.keys(g.boxes).includes(f.when));
    const answered = group && Object.keys(group.boxes).some((name) => (raw.get(name) || {}).checked);
    if (dependent && norm(dependent.value) && !answered) raw.set(f.when, { value: '', checked: true, inferred: true });
  }
  const r = applyRules(spec, raw, {});
  // From running text the tick boxes and free-text answers cannot be located
  // reliably: only what feeds the profile, and the signature, is reported on.
  const exact = source === 'word';
  const keyed = new Set(spec.fields.filter((f) => f.key || f.kind === 'signature').map((f) => f.label));
  const issues = exact ? r.issues : r.issues.filter((i) => [...keyed].some((label) => i.message.startsWith(label)));
  const candidates = candidatesFrom(r.values, r.extras, null).map((c) => (source === 'ocr' ? { ...c, confidence: 'medium' } : c));
  return { kind: 'new_employee_details', signed: r.signed, candidates, check: { status: issues.length ? 'attention' : 'ok', method: source === 'ocr' ? 'ocr' : source === 'word' ? 'docx' : 'text', kind: 'new_employee_details', fields: exact ? r.fields : r.fields.filter((f) => keyed.has(f.label)), issues, checkedAt: stamp() } };
}

// ═════════════════════════════════════════════════════════════════════════════
//  CONTRACT — a letter in prose; its terms are read from its sentences
// ═════════════════════════════════════════════════════════════════════════════

function readContract(text, source) {
  const flat = text.replace(/[ \t]+/g, ' ');
  const lines = flat.split(/\n+/).map(norm).filter(Boolean);
  const pick = (re) => { const m = flat.match(re); return m && !BLANK.test(m[1]) && !/^\[/.test(m[1].trim()) ? norm(m[1]) : ''; };
  const before = (re) => { const i = lines.findIndex((l) => re.test(l)); const v = i > 0 ? lines[i - 1] : ''; return BLANK.test(v) ? '' : v.replace(/\s*\((?:signed|e-?signed)[^)]*\)\s*$/i, ''); };
  const dateLine = (() => { const i = lines.findIndex((l) => /^full name of signatory$/i.test(l)); const l = i >= 0 ? (lines.slice(i + 1, i + 3).find((x) => /^date\b/i.test(x)) || '') : ''; return norm(l.replace(/^date\s*:?\s*/i, '')); })();
  const party = flat.match(/\n\s*([A-Z][A-Za-z'’ .\-]{2,80}?),\s+residing at\s+([^\n]+?)\.?\s*\n/);
  const term = pick(/employment is\s+((?:a\s+)?(?:fixed[- ]term|indefinite|ongoing|permanent)[^.\n]*)/i);
  const basis = (flat.match(/\b(full[- ]time|part[- ]time|casual)\b/i) || [])[1] || '';
  // The composed contract (onboarding-contract-docx): a particulars table, and an acceptance table the employee completes.
  const row = (label) => pick(new RegExp(`^${label}\\s*:?[ \\t]+(.+)$`, 'im'));
  const acceptance = lines.slice(Math.max(0, lines.findIndex((l) => /^to be completed by\b/i.test(l))));
  const accepted = (label) => { const l = acceptance.find((x) => new RegExp(`^${label}\\b`, 'i').test(x)) || ''; const v = norm(l.replace(new RegExp(`^${label}\\s*:?`, 'i'), '')); return BLANK.test(v) ? '' : v.replace(/\s*\((?:signed|e-?signed)[^)]*\)\s*$/i, ''); };
  if (/^commencement date\b/im.test(flat) && /^to be completed by\b/im.test(flat)) {
    const tabular = new Map(Object.entries({
      commencement_date: (row('Commencement Date').match(/^\d[^(]{4,30}/) || [''])[0].trim(), employee_full_name: accepted('Full Name'), employment_type: row('Employment Type'), workplace_address: row('Work Location'),
      annual_salary_aud: (row('Annual Salary').match(/\$?\s*([\d][\d,]*(?:\.\d{1,2})?)/) || [])[1] || '', standard_hours: (row('Ordinary Hours of Work').match(/^(\d{1,2}(?:\.\d+)?)/) || [])[1] || '',
      employee_signature: accepted('Signature'), signatory_full_name: accepted('Full Name'), signature_date: accepted('Date'),
    }).map(([k, v]) => [k, { value: v }]));
    const spec = SPECS.CONTRACT;
    const r = applyRules(spec, tabular, {});
    // This contract carries no home address, and an hourly engagement no annual salary: neither is a blank the employee left.
    const issues = r.issues.filter((i) => !/^Employee address/.test(i.message) && !(/^Annual salary is blank/.test(i.message) && /^hourly rate\b/im.test(flat)));
    const candidates = candidatesFrom(r.values, r.extras, null).map((c) => (source === 'ocr' ? { ...c, confidence: 'medium' } : c));
    return { kind: 'contract', signed: r.signed, candidates, check: { status: issues.length ? 'attention' : 'ok', method: source === 'ocr' ? 'ocr' : source === 'word' ? 'docx' : 'text', kind: 'contract', fields: r.fields.filter((f) => spec.fields.some((e) => e.label === f.label && tabular.has(e.name))), issues, checkedAt: stamp() } };
  }
  const raw = new Map(Object.entries({
    commencement_date: pick(/will commence on\s+(\d[^.\n]{4,30})/i), employee_full_name: party ? norm(party[1]) : '', employee_address: party ? norm(party[2]) : '',
    employment_type: /fixed/i.test(term) ? term : basis, workplace_address: pick(/based at\s+(.+?)\s+or any other location/i),
    annual_salary_aud: pick(/gross annual salary of\s+(?:AUD)?\s*\$?\s*([\d][\d,]*(?:\.\d{1,2})?)/i), standard_hours: pick(/standard working hours of\s+(\d{1,2}(?:\.\d+)?)/i),
    employee_signature: before(/^signature of employee$/i), signatory_full_name: before(/^full name of signatory$/i), signature_date: dateLine,
  }).map(([k, v]) => [k, { value: v }]));
  const spec = SPECS.CONTRACT;
  const r = applyRules(spec, raw, {});
  // The prose contract never states full-time or part-time: that comes from the offer, not from here.
  const issues = r.issues.filter((i) => !/^Employment type/.test(i.message));
  const candidates = candidatesFrom(r.values, r.extras, null).map((c) => (source === 'ocr' ? { ...c, confidence: 'medium' } : c));
  const shown = new Set([...raw.keys()]);
  return { kind: 'contract', signed: r.signed, candidates, check: { status: issues.length ? 'attention' : 'ok', method: source === 'ocr' ? 'ocr' : source === 'word' ? 'docx' : 'text', kind: 'contract', fields: r.fields.filter((f) => spec.fields.some((e) => e.label === f.label && shown.has(e.name))), issues, checkedAt: stamp() } };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

async function readDocument({ buffer, mime, kindHint = null }) {
  const type = String(mime || '').toLowerCase();
  const form = await formReader.readReturnedDocument({ buffer, mime: type }).catch(() => null);
  // The fillable PDF, read field by field, is the best reading there is. A form
  // recognised but with no text on it (a scan) falls through to OCR below.
  if (form && form.check.status !== 'unreadable') return { text: { source: form.check.method === 'pdf_form' ? 'form_fields' : 'text_layer', confidence: null, chars: null, pageCount: null, truncated: false }, reading: form };

  const text = await textOf({ buffer, mime: type });
  const meta = { source: text.source, confidence: text.confidence, chars: text.chars, pageCount: text.pageCount, truncated: text.truncated };
  if (text.source === 'none') return { text: meta, reading: null };
  const body = text.pages.join('\n');
  const kind = kindOf(body, kindHint);

  let reading = null;
  if (kind === 'new_employee_details') reading = readNed(type === DOCX_MIME ? await nedEntriesFromDocx(buffer) : nedEntriesFromText(body), text.source);
  else if (kind === 'contract') reading = readContract(type === DOCX_MIME ? (await nedEntriesFromDocx(buffer)).map((e) => e.para || `${e.label || e.question || ''} ${e.value || e.answer || ''}`).join('\n') : body, text.source);
  else if (kind) reading = readCertificate(kind, body, text.source);
  if (reading) { reading.check.textSource = text.source; if (text.confidence != null) reading.check.ocrConfidence = text.confidence; }
  return { text: meta, reading };
}

module.exports = { readDocument, _internals: { kindOf, readCertificate, readNed, readContract, nedEntriesFromDocx, nedEntriesFromText, labelledValue } };
