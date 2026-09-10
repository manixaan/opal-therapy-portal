'use strict';

/**
 * ONBOARDING FORM READER — the pack's own forms, read by fixed rules.
 *
 * No model. Each form the practice sends out is a known document with known
 * fields, so the portal reads it the way a clerk with a checklist would:
 *
 *   1. recognise which form it is (its field names, or its printed title);
 *   2. read every field the form carries, by name (AcroForm) or by the text
 *      under a printed label (the ATO form, a flattened PDF);
 *   3. apply that form's rules — which fields must be filled, which tick
 *      boxes belong to one question, which fields only apply once another
 *      answer makes them apply, and what a valid value of each looks like;
 *   4. hand back the values as candidates for the profile, with a check
 *      result naming every blank or invalid field in plain words.
 *
 * A value that fails its rule is never proposed: a date that is not a date,
 * a BSB that is not six digits, an expiry already passed. The Owner sees
 * "Licence expiry is not a valid date (dd/mm/yyyy)" and the form comes back
 * to the employee. Nothing here guesses, infers or completes.
 *
 *   readReturnedDocument({ buffer, mime, fileName })
 *     → { kind, check, candidates, signed } | null   (null: not one of ours)
 *
 *   check      { status, method, kind, fields, issues, checkedAt } — the same
 *              shape the document check produces, so the UI needs no change
 *   candidates [{ key, value, confidence, page }] — FIELDS vocabulary keys
 *   signed     'present' | 'missing' | 'unknown'
 */

const { PDFDocument, PDFName } = require('pdf-lib');
const { FIELDS, normaliseValue } = require('./onboarding-extraction');

const norm = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const labelKey = (s) => norm(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const SENSITIVE = /tfn|tax file|account|bsb|passport|licen[cs]e|medicare|birth|password|pin\b/i;
const AU_STATES = ['WA', 'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT', 'NT'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// ═════════════════════════════════════════════════════════════════════════════
//  VALUE RULES — what a valid answer looks like
// ═════════════════════════════════════════════════════════════════════════════

/** dd/mm/yyyy, d-m-yyyy, dd.mm.yyyy, "28 September 2026", "28 Sept 2026", yyyy-mm-dd, or eight boxed digits → ISO, else null. */
function parseDate(raw) {
  const s = norm(raw);
  if (!s) return null;
  let d; let m; let y;
  let hit;
  if ((hit = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/))) { [d, m, y] = [+hit[1], +hit[2], +hit[3]]; }
  else if ((hit = s.match(/^(\d{4})-(\d{2})-(\d{2})$/))) { [y, m, d] = [+hit[1], +hit[2], +hit[3]]; }
  else if ((hit = s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})$/))) {
    const mi = MONTHS.findIndex((name) => name.startsWith(hit[2].toLowerCase().slice(0, 3)));
    if (mi < 0) return null;
    [d, m, y] = [+hit[1], mi + 1, +hit[3]];
  } else if ((hit = s.replace(/\s+/g, '').match(/^(\d{2})(\d{2})(\d{4})$/))) { [d, m, y] = [+hit[1], +hit[2], +hit[3]]; }
  else return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

const todayIso = () => new Date().toISOString().slice(0, 10);

/** The ATO's ABN check: weighted digits, first digit less one, divisible by 89. */
function validAbn(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length !== 11) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = digits.split('').reduce((acc, ch, i) => acc + (Number(ch) - (i === 0 ? 1 : 0)) * weights[i], 0);
  return sum % 89 === 0;
}

/**
 * Validate one raw value against its kind. Returns { value } (a clean value)
 * or { problem } (a sentence fragment naming what is wrong).
 */
function validate(kind, raw) {
  const s = norm(raw);
  if (!s) return { value: '' };
  switch (kind) {
    case 'date': { const v = parseDate(s); return v ? { value: v } : { problem: 'is not a valid date (dd/mm/yyyy)' }; }
    case 'past_date': {
      const v = parseDate(s); if (!v) return { problem: 'is not a valid date (dd/mm/yyyy)' };
      return v <= todayIso() ? { value: v } : { problem: 'is in the future' };
    }
    case 'future_date': {
      const v = parseDate(s); if (!v) return { problem: 'is not a valid date (dd/mm/yyyy)' };
      return v > todayIso() ? { value: v } : { problem: 'has already passed' };
    }
    case 'birth_date': {
      const v = parseDate(s); if (!v) return { problem: 'is not a valid date (dd/mm/yyyy)' };
      const age = (Date.now() - new Date(`${v}T00:00:00Z`).getTime()) / (365.25 * 24 * 3600 * 1000);
      return age >= 14 && age <= 100 ? { value: v } : { problem: 'is not a plausible date of birth' };
    }
    case 'name': return /^[A-Za-z][A-Za-z' \-.]{0,79}$/.test(s) && /[A-Za-z]{2,}/.test(s) ? { value: s } : { problem: 'should be letters only' };
    case 'email': return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? { value: s.toLowerCase() } : { problem: 'is not a valid email address' };
    case 'phone': { const digits = s.replace(/\D/g, ''); return digits.length >= 8 && digits.length <= 15 && /^[\d+ ()\-]+$/.test(s) ? { value: s } : { problem: 'is not a valid phone number' }; }
    case 'bsb': { const digits = s.replace(/\D/g, ''); return digits.length === 6 && /^[\d\s-]+$/.test(s) ? { value: `${digits.slice(0, 3)}-${digits.slice(3)}` } : { problem: 'should be six digits (000-000)' }; }
    case 'account': { const digits = s.replace(/\D/g, ''); return digits.length >= 5 && digits.length <= 12 && /^[\d\s-]+$/.test(s) ? { value: digits } : { problem: 'should be 5 to 12 digits' }; }
    case 'money': { const n = Number(s.replace(/[$,\s]/g, '')); return Number.isFinite(n) && n > 0 && n < 10000000 ? { value: String(Math.round(n * 100) / 100) } : { problem: 'is not a valid amount' }; }
    case 'hours': { const n = Number(s.replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n <= 76 ? { value: String(n) } : { problem: 'is not a valid number of hours a week' }; }
    case 'state': { const u = s.toUpperCase().replace(/[^A-Z]/g, ''); return AU_STATES.includes(u) ? { value: u } : { problem: 'should be an Australian state or territory (e.g. WA)' }; }
    case 'postcode': return /^\d{4}$/.test(s) ? { value: s } : { problem: 'should be four digits' };
    case 'abn': return validAbn(s) ? { value: s.replace(/\D/g, '') } : { problem: 'is not a valid ABN' };
    case 'usi': { const u = s.replace(/\s+/g, '').toUpperCase(); return /^[A-Z0-9]{8,20}$/.test(u) ? { value: u } : { problem: 'is not a valid USI' }; }
    case 'code': { const u = s.replace(/\s+/g, ''); return /^[A-Za-z0-9\-/.]{3,40}$/.test(u) ? { value: u } : { problem: 'should be letters and digits' }; }
    case 'employment_type': {
      const lower = s.toLowerCase();
      const type = /fixed.?term|contract/.test(lower) ? 'fixed_term' : /casual/.test(lower) ? 'casual' : /part.?time/.test(lower) ? 'part_time' : /full.?time|permanent/.test(lower) ? 'full_time' : null;
      if (!type) return { problem: 'should be full-time, part-time, casual or fixed-term' };
      // "Fixed-term (to 27 September 2027)" carries the end date with it.
      const tail = s.match(/(?:to|until|ending|ends)\s+([0-9A-Za-z/ .\-]+?)\)?$/i);
      const end = tail ? parseDate(tail[1]) : null;
      if (type === 'fixed_term' && tail && !end) return { problem: 'names an end date that is not a valid date' };
      return { value: type, extra: end ? { end_date: end } : {} };
    }
    case 'address': {
      // "12 Example Street, Subiaco WA 6008" → its parts, when it has them.
      const m = s.match(/^(.+?),\s*([A-Za-z' \-]+?)\s+(WA|NSW|VIC|QLD|SA|TAS|ACT|NT)\s+(\d{4})$/i);
      if (!m) return s.length >= 6 ? { value: s, extra: { address_line1: s } } : { problem: 'is too short to be an address' };
      return { value: s, extra: { address_line1: norm(m[1]), suburb: norm(m[2]), state: m[3].toUpperCase(), postcode: m[4] } };
    }
    case 'yes_no': { const l = s.toLowerCase(); return /^(yes|no|y|n)$/.test(l) ? { value: l.startsWith('y') ? 'yes' : 'no' } : { problem: 'should be Yes or No' }; }
    case 'signature': return { value: s };
    default: return { value: s.slice(0, 300) };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE FORMS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Field entries:
 *   name        the AcroForm field name (form specs) or the printed label (text specs)
 *   label       what the Owner reads in an issue
 *   kind        a rule from validate()
 *   required    true, or a function (values, ticks) → boolean
 *   key         FIELDS vocabulary key the value proposes (optional)
 *   when        a tick-box name that must be ticked for this field to apply at all
 * Tick groups (one question, several boxes):
 *   { group, label, boxes: { name: 'Answer' }, required, exclusive }
 */

const CONTRACT = {
  kind: 'contract', title: 'Contract of Employment', method: 'pdf_form',
  detect: { fieldNames: ['signatory_full_name', 'signature_date'] },
  fields: [
    { name: 'letter_date', label: 'Letter date', kind: 'date' },
    { name: 'recipient_name', label: 'Recipient name', kind: 'name' },
    { name: 'salutation_name', label: 'Salutation', kind: 'name' },
    { name: 'recipient_address', label: 'Recipient address', kind: 'address' },
    { name: 'contract_date', label: 'Contract date', kind: 'date' },
    { name: 'commencement_date', label: 'Commencement date', kind: 'date', required: true, key: 'start_date' },
    { name: 'employee_full_name', label: 'Employee full name', kind: 'name', required: true, key: 'full_name' },
    { name: 'employee_address', label: 'Employee address', kind: 'address', required: true },
    { name: 'employment_type', label: 'Employment type', kind: 'employment_type', required: true, key: 'employment_type' },
    { name: 'workplace_address', label: 'Workplace address', kind: 'text', key: 'work_location' },
    { name: 'cpd_allowance', label: 'CPD allowance', kind: 'text' },
    { name: 'annual_salary_aud', label: 'Annual salary', kind: 'money', required: true, key: 'salary_annual' },
    { name: 'standard_hours', label: 'Standard hours a week', kind: 'hours', required: true, key: 'hours_per_week' },
    { name: 'signatory_full_name', label: 'Signed by (full name)', kind: 'name', required: true },
    { name: 'employee_signature', label: 'Employee signature', kind: 'signature', required: true },
    { name: 'signature_date', label: 'Date signed', kind: 'past_date', required: true },
  ],
};

const NEW_EMPLOYEE_DETAILS = {
  kind: 'new_employee_details', title: 'New Employee Details', method: 'pdf_form',
  detect: { fieldNames: ['p2_first_name', 'p2_last_name'] },
  fields: [
    // Page 1 — who is completing the form
    { name: 'p1_organisation_name', label: 'Organisation name', kind: 'text', required: true },
    { name: 'p1_address', label: 'Organisation address', kind: 'text', required: true },
    { name: 'p1_contact_details', label: 'Organisation contact details', kind: 'text', required: true },
    { name: 'p1_name_and_role_of_person_completing_th', label: 'Name and role of the person completing the form', kind: 'text', required: true },
    { name: 'p1_date_the_form_was_completed', label: 'Date the form was completed', kind: 'past_date', required: true },
    // Page 2 — the employee
    { group: 'identifies_as', label: 'Identifies as', required: true, exclusive: false, boxes: { p2_identifies_as_male: 'Male', p2_identifies_as_female: 'Female', p2_identifies_as_transgender: 'Transgender', p2_identifies_as_non_binary: 'Non-binary', p2_identifies_as_other: 'Other' } },
    { name: 'p2_non_binary_other', label: 'Identifies as (other)', kind: 'text', required: true, when: 'p2_identifies_as_other' },
    { group: 'interpreter', label: 'Interpreter required', required: true, boxes: { p2_interpreter_required_yes: 'Yes', p2_interpreter_required_no: 'No' } },
    { group: 'atsi', label: 'Aboriginal or Torres Strait Islander', required: true, boxes: { 'p2_aboriginal_or_torres_strait_islander_': 'Yes', p2_aboriginal_or_torres_strait_islander__2: 'No', p2_aboriginal_or_torres_strait_islander__3: 'Prefer not to say' } },
    { group: 'ndis_module', label: 'NDIS Worker Orientation Module completed', required: true, boxes: { p2_ndis_worker_orientation_module_comple: 'Yes', p2_ndis_worker_orientation_module_comple_2: 'No' } },
    { name: 'p2_date_of_completion', label: 'NDIS module completion date', kind: 'past_date', required: true, when: 'p2_ndis_worker_orientation_module_comple' },
    { group: 'citizen', label: 'Australian citizen', required: true, boxes: { p2_australian_citizen_yes: 'Yes', p2_australian_citizen_no: 'No' } },
    { group: 'permanent_resident', label: 'Permanent resident', required: true, when: 'p2_australian_citizen_no', boxes: { p2_are_you_a_permanent_resident_yes: 'Yes', p2_are_you_a_permanent_resident_yes_no: 'No' } },
    { name: 'p2_type', label: 'Visa type', kind: 'text', required: true, when: 'p2_are_you_a_permanent_resident_yes_no', key: 'visa_subclass' },
    { name: 'p2_expiry', label: 'Visa expiry', kind: 'future_date', required: true, when: 'p2_are_you_a_permanent_resident_yes_no', key: 'visa_expiry' },
    { name: 'p2_first_name', label: 'First name', kind: 'name', required: true, key: 'legal_first_name' },
    { name: 'p2_preferred_name', label: 'Preferred name', kind: 'name', key: 'preferred_name' },
    { name: 'p2_middle_name', label: 'Middle name', kind: 'name', key: 'middle_name' },
    { name: 'p2_last_name', label: 'Last name', kind: 'name', required: true, key: 'surname' },
    { name: 'p2_date_of_birth', label: 'Date of birth', kind: 'birth_date', required: true, key: 'date_of_birth' },
    { name: 'p2_preferred_language', label: 'Preferred language', kind: 'text', required: true },
    { name: 'p2_employment_start_date', label: 'Employment start date', kind: 'date', required: true, key: 'start_date' },
    { name: 'p2_role_position_title', label: 'Role / position title', kind: 'text', required: true, key: 'job_title' },
    { name: 'p2_car_registration_details_if_applicabl', label: 'Car registration', kind: 'text', key: 'vehicle_registration' },
    { name: 'p2_site_service_name', label: 'Site / service name', kind: 'text', required: true },
    { name: 'p2_site_address', label: 'Site address', kind: 'text', required: true },
    { name: 'p2_contact_details', label: 'Site contact details', kind: 'text', required: true },
    { name: 'p2_contact_name', label: 'Site contact name', kind: 'text', required: true },
    { name: 'p2_do_you_have_secondary_employment_i_e_', label: 'Secondary employment', kind: 'text', required: true },
    // Page 3 — health, doctor, emergency contact
    { name: 'p3_do_you_have_any_skills_qualifications', label: 'Skills and qualifications', kind: 'text', required: true },
    { name: 'p3_do_you_have_any_pre_existing_medical_', label: 'Pre-existing medical conditions', kind: 'text', required: true },
    { name: 'p3_do_you_have_any_allergies', label: 'Allergies', kind: 'text', required: true },
    { name: 'p3_name', label: 'Doctor name', kind: 'text', required: true },
    { name: 'p3_address', label: 'Doctor address', kind: 'text', required: true },
    { name: 'p3_phone', label: 'Doctor phone', kind: 'phone', required: true },
    { name: 'p3_email', label: 'Doctor email', kind: 'email' },
    { name: 'p3_name_2', label: 'Emergency contact name', kind: 'name', required: true, key: 'emergency_name' },
    { name: 'p3_relationship_to_employee', label: 'Emergency contact relationship', kind: 'text', required: true, key: 'emergency_relationship' },
    { name: 'p3_address_2', label: 'Emergency contact address', kind: 'text', required: true },
    { name: 'p3_mobile', label: 'Emergency contact mobile', kind: 'phone', required: true, key: 'emergency_phone' },
    { name: 'p3_email_2', label: 'Emergency contact email', kind: 'email', key: 'emergency_email' },
    // Page 4 — tax, bank, super, identity
    { group: 'tfn_declaration', label: 'Tax file number declaration provided', required: true, boxes: { 'p4_tax_file_number_declaration_provided_': 'Yes', p4_tax_file_number_declaration_provided__2: 'No' } },
    { group: 'licence_copy', label: "Copy of driver's licence attached", required: true, boxes: { p4_copy_of_driver_s_licence_front_and_ba: 'Yes', p4_copy_of_driver_s_licence_front_and_ba_2: 'No' } },
    { group: 'passport_copy', label: 'Passport photo page attached', boxes: { p4_passport_photo_page_attached_required: 'Yes' } },
    { name: 'p4_account_name', label: 'Bank account name', kind: 'text', required: true, key: 'account_holder_name' },
    { name: 'p4_bank_financial_institution', label: 'Bank', kind: 'text', required: true },
    { name: 'p4_bsb', label: 'BSB', kind: 'bsb', required: true, key: 'bsb' },
    { name: 'p4_account_number', label: 'Account number', kind: 'account', required: true, key: 'account_number' },
    { name: 'p4_superannuation_fund_name', label: 'Superannuation fund name', kind: 'text', required: true, key: 'super_fund_name' },
    { name: 'p4_super_member_number_usi', label: 'Super member number / USI', kind: 'text', required: true, key: 'super_member_and_usi' },
    { name: 'p4_licence_number', label: 'Licence number', kind: 'code', required: true, when: 'p4_copy_of_driver_s_licence_front_and_ba', key: 'drivers_licence_number' },
    { name: 'p4_state_territory_of_issue', label: 'Licence state', kind: 'state', required: true, when: 'p4_copy_of_driver_s_licence_front_and_ba', key: 'drivers_licence_state' },
    { name: 'p4_licence_class', label: 'Licence class', kind: 'text', required: true, when: 'p4_copy_of_driver_s_licence_front_and_ba' },
    { name: 'p4_expiry_date', label: 'Licence expiry', kind: 'future_date', required: true, when: 'p4_copy_of_driver_s_licence_front_and_ba', key: 'drivers_licence_expiry' },
    { name: 'p4_passport_number', label: 'Passport number', kind: 'code', required: true, when: 'p4_passport_photo_page_attached_required', key: 'passport_number' },
    { name: 'p4_country_of_issue', label: 'Passport country of issue', kind: 'text', required: true, when: 'p4_passport_photo_page_attached_required', key: 'passport_country' },
    { name: 'p4_passport_expiry_date', label: 'Passport expiry', kind: 'future_date', required: true, when: 'p4_passport_photo_page_attached_required', key: 'passport_expiry' },
    { name: 'p4_visa_grant_number_vevo_check_if_appli', label: 'Visa grant number / VEVO', kind: 'text', required: true, when: 'p2_australian_citizen_no' },
    { name: 'p4_other_identity_document_e_g_birth_cer', label: 'Other identity document', kind: 'text' },
    // Page 5 — AHPRA, first aid, NDIS screening
    { group: 'ahpra_conditions', label: 'Conditions or undertakings on registration', required: true, boxes: { p5_conditions_or_undertakings_on_registr: 'Yes', p5_conditions_or_undertakings_on_registr_2: 'No' } },
    { name: 'p5_if_yes_please_provide_details', label: 'Conditions on registration (details)', kind: 'text', required: true, when: 'p5_conditions_or_undertakings_on_registr' },
    { group: 'ahpra_copy', label: 'Copy of AHPRA registration certificate attached', required: true, boxes: { p5_copy_of_ahpra_registration_certificat: 'Yes', p5_copy_of_ahpra_registration_certificat_2: 'No' } },
    { name: 'p5_ahpra_registration_number', label: 'AHPRA registration number', kind: 'code', required: true, when: 'p5_copy_of_ahpra_registration_certificat', key: 'ahpra_registration_number' },
    { name: 'p5_profession_division', label: 'AHPRA profession / division', kind: 'text', required: true, when: 'p5_copy_of_ahpra_registration_certificat' },
    { name: 'p5_registration_type', label: 'AHPRA registration type', kind: 'text', required: true, when: 'p5_copy_of_ahpra_registration_certificat' },
    { name: 'p5_registration_expiry_date', label: 'AHPRA registration expiry', kind: 'future_date', required: true, when: 'p5_copy_of_ahpra_registration_certificat', key: 'ahpra_expiry' },
    { group: 'first_aid_required', label: 'First Aid / CPR required for this role', required: true, boxes: { 'p5_first_aid_cpr_required_for_this_role_': 'Yes', p5_first_aid_cpr_required_for_this_role__2: 'No' } },
    { group: 'first_aid_copy', label: 'Copy of First Aid / CPR certificate attached', required: true, when: 'p5_first_aid_cpr_required_for_this_role_', boxes: { p5_copy_of_first_aid_cpr_certificate_att: 'Yes', p5_copy_of_first_aid_cpr_certificate_att_2: 'No' } },
    { name: 'p5_first_aid_certificate_number', label: 'First aid certificate number', kind: 'code', required: true, when: 'p5_copy_of_first_aid_cpr_certificate_att' },
    { name: 'p5_training_provider', label: 'First aid training provider', kind: 'text', required: true, when: 'p5_copy_of_first_aid_cpr_certificate_att' },
    { name: 'p5_first_aid_expiry_date', label: 'First aid expiry', kind: 'future_date', required: true, when: 'p5_copy_of_first_aid_cpr_certificate_att', key: 'first_aid_expiry' },
    { name: 'p5_cpr_expiry_date', label: 'CPR expiry', kind: 'future_date', required: true, when: 'p5_copy_of_first_aid_cpr_certificate_att', key: 'cpr_expiry' },
    { group: 'ndis_clearance', label: 'NDIS Worker Screening clearance status', required: true, boxes: { p5_clearance_status_cleared: 'Cleared', p5_clearance_status_application: 'Application in progress' } },
    { group: 'ndis_linked', label: 'Linked to Opal Therapy in the NDIS Worker Screening database', required: true, boxes: { p5_linked_to_opal_therapy_in_the_ndis_wo: 'Yes', p5_linked_to_opal_therapy_in_the_ndis_wo_2: 'No' } },
    { group: 'ndis_copy', label: 'Copy of NDIS Worker Screening clearance attached', required: true, when: 'p5_clearance_status_cleared', boxes: { p5_copy_of_ndis_worker_screening_clearan: 'Yes', p5_copy_of_ndis_worker_screening_clearan_2: 'No' } },
    { name: 'p5_ndis_worker_screening_check_number', label: 'NDIS Worker Screening check number', kind: 'code', required: true, when: 'p5_clearance_status_cleared', key: 'ndis_screening_number' },
    { name: 'p5_state_territory_of_issue', label: 'NDIS screening state', kind: 'state', required: true, when: 'p5_clearance_status_cleared' },
    { name: 'p5_date_of_issue', label: 'NDIS screening date of issue', kind: 'past_date', required: true, when: 'p5_clearance_status_cleared' },
    { name: 'p5_expiry_date', label: 'NDIS screening expiry', kind: 'future_date', required: true, when: 'p5_clearance_status_cleared', key: 'ndis_screening_expiry' },
    // Page 6 — WWCC, police check, declaration
    { group: 'wwcc_type', label: 'WWCC clearance type', required: true, boxes: { p6_clearance_type_employee: 'Employee', p6_clearance_type_volunteer: 'Volunteer' } },
    { group: 'wwcc_copy', label: 'Copy of WWCC clearance attached', required: true, boxes: { p6_copy_of_wwcc_clearance_attached_attac: 'Yes', p6_copy_of_wwcc_clearance_attached_to: 'No' } },
    { name: 'p6_wwcc_number', label: 'WWCC number', kind: 'code', required: true, key: 'wwcc_number' },
    { name: 'p6_state_territory_of_issue', label: 'WWCC state', kind: 'state', required: true },
    { name: 'p6_expiry_date', label: 'WWCC expiry', kind: 'future_date', required: true, key: 'wwcc_expiry' },
    { group: 'police_done', label: 'Police check completed', required: true, boxes: { p6_police_check_completed_yes: 'Yes', p6_police_check_completed_no: 'No' } },
    { name: 'p6_if_no_date_applied', label: 'Police check date applied', kind: 'past_date', required: true, when: 'p6_police_check_completed_no' },
    { name: 'p6_date_of_issue', label: 'Police check date of issue', kind: 'past_date', required: true, when: 'p6_police_check_completed_yes', key: 'police_check_date' },
    { name: 'p6_issuing_body_provider', label: 'Police check issuing body', kind: 'text', required: true, when: 'p6_police_check_completed_yes' },
    { name: 'p6_certificate_reference_number', label: 'Police check certificate reference', kind: 'code', required: true, when: 'p6_police_check_completed_yes', key: 'police_check_reference' },
    { group: 'disclosable', label: 'Disclosable court outcomes recorded', required: true, when: 'p6_police_check_completed_yes', boxes: { p6_disclosable_court_outcomes_recorded_y: 'Yes', p6_disclosable_court_outcomes_recorded_n: 'No' } },
    { name: 'p6_if_yes_please_provide_details', label: 'Disclosable court outcomes (details)', kind: 'text', required: true, when: 'p6_disclosable_court_outcomes_recorded_y' },
    { group: 'police_copy', label: 'Copy of police check certificate attached', required: true, when: 'p6_police_check_completed_yes', boxes: { p6_copy_of_police_check_certificate_atta: 'Yes', p6_copy_of_police_check_certificate_atta_2: 'No' } },
    { name: 'p6_i', label: 'Declaration name', kind: 'name', required: true },
    { name: 'p6_signature', label: 'Signature', kind: 'signature', required: true },
    { name: 'p6_date', label: 'Date signed', kind: 'past_date', required: true },
  ],
};

/**
 * The ATO Superannuation standard choice form (NAT 13080). The copy in the
 * pack has no fillable fields, so it is read from the printed labels: the
 * value of a label is the text directly beneath it. Values typed into the
 * ATO's character boxes come back one letter at a time and are joined.
 */
const SUPER_CHOICE = {
  kind: 'super_choice', title: 'Superannuation Standard Choice Form', method: 'pdf_text',
  detect: { text: /superannuation\s+standard\s+choice\s+form/i },
  fields: [
    { name: 'Full name', page: 1, label: 'Full name (Section A)', kind: 'name', required: true, key: 'full_name' },
    { name: 'Employee number (if known)', page: 1, label: 'Employee number', kind: 'text' },
    { name: 'Super fund name', page: 2, label: 'Super fund name (Section B)', kind: 'text', section: 'B', key: 'super_fund_name' },
    { name: 'Super fund Australian business number (ABN)', page: 2, label: 'Super fund ABN (Section B)', kind: 'abn', boxed: true, section: 'B' },
    { name: 'Unique superannuation identifier (USI)', page: 2, label: 'USI (Section B)', kind: 'usi', boxed: true, section: 'B', key: 'super_usi' },
    { name: 'Your member account number', page: 2, label: 'Member account number (Section B)', kind: 'code', boxed: true, section: 'B', key: 'super_member_number' },
    { name: 'Your name as it appears on your account', page: 2, label: 'Name on the account (Section B)', kind: 'name', section: 'B' },
    { name: 'Signature', page: 2, label: 'Signature (Section B)', kind: 'signature', section: 'B', box: { w: 260, h: 40 } },
    { name: 'Date', page: 2, label: 'Date signed (Section B)', kind: 'past_date', boxed: true, section: 'B', skipLine: /^day month year$/i },
    { name: 'Signature', page: 3, label: 'Signature (Section C)', kind: 'signature', section: 'C', box: { w: 260, h: 40 } },
    { name: 'Date', page: 3, label: 'Date signed (Section C)', kind: 'past_date', boxed: true, section: 'C', skipLine: /^day month year$/i },
    { name: 'SMSF name', page: 4, label: 'SMSF name (Section D)', kind: 'text', section: 'D', key: 'super_fund_name' },
    { name: 'SMSF Australian business number (ABN)', page: 4, label: 'SMSF ABN (Section D)', kind: 'abn', boxed: true, section: 'D' },
    { name: 'SMSF electronic service address (ESA)', page: 4, label: 'SMSF ESA (Section D)', kind: 'text', section: 'D' },
    { name: 'Your full name as it appears on your account', page: 4, label: 'Name on the account (Section D)', kind: 'name', section: 'D' },
    { name: 'Bank account name', page: 4, label: 'SMSF bank account name (Section D)', kind: 'text', section: 'D' },
    { name: 'BSB code (please include all six numbers)', page: 4, label: 'SMSF BSB (Section D)', kind: 'bsb', boxed: true, section: 'D' },
    { name: 'Account number', page: 4, label: 'SMSF account number (Section D)', kind: 'account', boxed: true, section: 'D' },
    { name: 'Signature', page: 4, label: 'Signature (Section D)', kind: 'signature', section: 'D', box: { w: 260, h: 40 } },
    { name: 'Date', page: 4, label: 'Date signed (Section D)', kind: 'past_date', boxed: true, section: 'D', skipLine: /^(day month year|month year day)$/i },
  ],
  /** Other printed labels on the form: reaching one of these means the field above it is blank. */
  stopLabels: ['Tax file number (TFN)', 'Employee number (if known)', 'Super fund details', 'Required documentation', 'Declaration', 'SMSF details', 'SMSF bank account details', 'Business name', 'Australian business number (ABN)'],
  /** One of B, C or D must be completed; within it, everything. */
  sections: { B: 'My existing super fund', C: "My employer's default super fund", D: 'My self-managed super fund' },
  sectionChoice: { B: 'employee_choice', C: 'employer_default', D: 'employee_choice' },
};

/** Statements that go out for reading only: recognised, never checked. */
const READ_ONLY = [
  // The contract-type statements name the FWIS in their own text: they are tried first.
  { kind: 'ftcis', detect: { text: /fixed\s+term\s+contract\s+information\s+statement/i } },
  { kind: 'ceis', detect: { text: /casual\s+employment\s+information\s+statement/i } },
  { kind: 'fair_work_statement', detect: { text: /fair\s+work\s+information\s+statement/i } },
];

const SPECS = [CONTRACT, NEW_EMPLOYEE_DETAILS, SUPER_CHOICE];

// ═════════════════════════════════════════════════════════════════════════════
//  READING A PDF
// ═════════════════════════════════════════════════════════════════════════════

/** Every AcroForm field: { name, type, value, checked, page, rect }. */
async function acroFields(buffer) {
  const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true, updateMetadata: false });
  let form;
  try { form = pdf.getForm(); } catch (_) { return { fields: [], pdf }; }
  const pages = pdf.getPages();
  // The page a widget sits on: its /P entry when it has one, else the page whose annotations list it.
  const pageIndexOf = (widget) => {
    const ref = widget.P && widget.P();
    let i = ref ? pages.findIndex((p) => p.ref === ref) : -1;
    if (i < 0) {
      i = pages.findIndex((p) => {
        const annots = p.node.Annots();
        if (!annots) return false;
        for (let k = 0; k < annots.size(); k += 1) { if (pdf.context.lookup(annots.get(k)) === widget.dict) return true; }
        return false;
      });
    }
    return i >= 0 ? i + 1 : null;
  };
  const out = [];
  for (const f of form.getFields()) {
    const type = f.constructor.name;
    const entry = { name: f.getName(), type, value: '', checked: null, page: null, rect: null, signed: null };
    try {
      const widgets = f.acroField.getWidgets();
      if (widgets[0]) {
        const r = widgets[0].getRectangle();
        entry.rect = { x: r.x, y: r.y, w: r.width, h: r.height };
        entry.page = pageIndexOf(widgets[0]);
      }
      if (type === 'PDFTextField') entry.value = f.getText() || '';
      else if (type === 'PDFCheckBox') entry.checked = f.isChecked();
      else if (type === 'PDFRadioGroup' || type === 'PDFDropdown') entry.value = [].concat(f.getSelected() || []).join(', ');
      else if (type === 'PDFOptionList') entry.value = [].concat(f.getSelected() || []).join(', ');
      else if (type === 'PDFSignature') entry.signed = f.acroField.dict.has(PDFName.of('V'));
    } catch (_) { /* an odd widget reads as blank */ }
    out.push(entry);
  }
  return { fields: out, pdf };
}

/** Text items grouped into lines per page: [{ y, x, words: [{str,x,y,w,h}], text, key }]. */
function linesOf(pages) {
  return pages.map((items) => {
    const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    let cur = null;
    for (const it of sorted) {
      if (cur && Math.abs(cur.y - it.y) <= Math.max(3, (it.h || 10) * 0.4)) cur.words.push(it);
      else { cur = { y: it.y, words: [it] }; lines.push(cur); }
    }
    for (const l of lines) {
      l.words.sort((a, b) => a.x - b.x);
      l.x = l.words[0].x;
      l.text = norm(l.words.map((w) => w.str).join(' '));
      l.key = labelKey(l.text);
    }
    return lines;
  });
}

/** Text inside a rectangle on a page (a signature box). */
function textInRect(items, rect, pad = 2) {
  if (!rect || !items) return '';
  return norm(items.filter((it) => it.x >= rect.x - pad && it.x <= rect.x + rect.w + pad && it.y >= rect.y - pad && it.y <= rect.y + rect.h + pad).map((it) => it.str).join(' '));
}

/**
 * The value printed beneath a label: the nearest line below it that starts
 * within the label's column, unless that line is itself a label. Boxed
 * values (one character per box) are joined without spaces.
 */
function valueBelowLabel(lines, spec, allLabelKeys) {
  const page = lines[spec.page - 1] || [];
  const label = findLabel(page, spec.name);
  if (!label) return { absent: true, value: '' };
  // The label may share its baseline with another column: only its own column is read.
  const left = label.x - 12; const right = label.x + 320;
  const below = page.filter((l) => l.y < label.y - 2 && label.y - l.y <= 60).sort((a, b) => b.y - a.y);
  for (const l of below) {
    // Only the words in this column: a second column's text shares the baseline.
    const words = l.words.filter((w) => w.x >= left && w.x <= right);
    if (!words.length) continue;
    const text = norm(words.map((w) => w.str).join(' '));
    if (spec.skipLine && spec.skipLine.test(text)) continue;
    if (allLabelKeys.has(labelKey(text))) return { value: '' };
    if (spec.boxed) {
      // One character per box: short tokens only. A sentence here is the form's own print, not an answer.
      if (text.length > 40 || text.split(' ').some((t) => t.length > 12)) return { value: '' };
      return { value: words.map((w) => w.str).join('').replace(/\s+/g, ''), y: l.y };
    }
    if (text.length > 80) return { value: '' };
    return { value: text, y: l.y };
  }
  return { value: '' };
}

/** The printed label as a word run on a page: { x, y } of its first word, or null. */
function findLabel(page, name) {
  const key = labelKey(name);
  for (const l of page) {
    if (l.key === key) return { x: l.x, y: l.y };
    for (let i = 0; i < l.words.length; i += 1) {
      for (let j = i + 1; j <= l.words.length; j += 1) {
        const k = labelKey(l.words.slice(i, j).map((w) => w.str).join(' '));
        if (k === key) return { x: l.words[i].x, y: l.y };
        if (!key.startsWith(k)) break;
      }
    }
  }
  return null;
}

/** A signature drawn or typed in the box beneath the "Signature" label. */
function signatureBelowLabel(lines, pages, spec) {
  const label = findLabel(lines[spec.page - 1] || [], spec.name);
  if (!label) return { absent: true, value: '' };
  const items = pages[spec.page - 1] || [];
  const rect = { x: label.x - 4, y: label.y - spec.box.h, w: spec.box.w, h: spec.box.h - 2 };
  const text = norm(items.filter((it) => it.x >= rect.x && it.x <= rect.x + rect.w && it.y >= rect.y && it.y < label.y - 2 && !/^(date|day|month|year|[\d ]+)$/i.test(it.str.trim())).map((it) => it.str).join(' '));
  return { value: text };
}

// ═════════════════════════════════════════════════════════════════════════════
//  RECOGNITION
// ═════════════════════════════════════════════════════════════════════════════

function detectKind({ fieldNames, pageTexts }) {
  const names = new Set(fieldNames || []);
  for (const spec of SPECS) {
    if (spec.detect.fieldNames && spec.detect.fieldNames.every((n) => names.has(n))) return spec.kind;
  }
  const first = String((pageTexts || []).slice(0, 2).join('\n'));
  for (const spec of SPECS) if (spec.detect.text && spec.detect.text.test(first)) return spec.kind;
  for (const r of READ_ONLY) if (r.detect.text.test(first)) return r.kind;
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
//  APPLYING A FORM'S RULES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * @param spec       CONTRACT | NEW_EMPLOYEE_DETAILS | SUPER_CHOICE
 * @param raw        Map name → { value, checked, signed, page, rect, absent }
 * @param keepValues whether previews of non-sensitive values are kept
 */
function applyRules(spec, raw, { keepValues = false, sectionFilled = null } = {}) {
  const ticked = new Set();
  for (const e of spec.fields) if (e.group) for (const name of Object.keys(e.boxes)) { const r = raw.get(name); if (r && r.checked) ticked.add(name); }
  const applies = (e) => !e.when || ticked.has(e.when);
  const fields = []; const issues = []; const values = {}; const extras = {};
  let signatureAsked = false; let signaturePresent = true;

  for (const e of spec.fields) {
    if (e.group) {
      if (!applies(e)) continue;
      const on = Object.entries(e.boxes).filter(([name]) => ticked.has(name)).map(([, answer]) => answer);
      fields.push({ label: e.label, filled: on.length > 0, ...(on.length ? { preview: on.join(', ') } : {}) });
      if (!on.length && e.required) issues.push({ code: 'blank', message: `${e.label}: nothing is ticked` });
      if (on.length > 1 && e.exclusive !== false) issues.push({ code: 'invalid', message: `${e.label}: more than one box is ticked` });
      continue;
    }
    if (!applies(e)) continue;
    if (e.section && sectionFilled && e.section !== sectionFilled) continue;
    // Everything inside the section the employee chose is required.
    const required = e.required || (!!e.section && e.section === sectionFilled);
    const r = raw.get(e.page ? `${e.name}@${e.page}` : e.name) || { value: '', absent: true };
    if (e.kind === 'signature') {
      signatureAsked = true;
      const present = !!(r.signed || norm(r.value));
      fields.push({ label: e.label, filled: present });
      if (!present) { signaturePresent = false; if (required) issues.push({ code: 'unsigned', message: `${e.label} is empty` }); }
      continue;
    }
    const filled = !!norm(r.value);
    const field = { label: e.label, filled };
    if (!filled) {
      if (r.absent && spec.method === 'pdf_text') issues.push({ code: 'missing', message: `${e.label} could not be found on the form` });
      else if (required) issues.push({ code: 'blank', message: `${e.label} is blank` });
      fields.push(field); continue;
    }
    const v = validate(e.kind, r.value);
    if (v.problem) {
      field.valid = false;
      issues.push({ code: 'invalid', message: `${e.label} ${v.problem}` });
    } else {
      field.valid = true;
      values[e.name] = { value: v.value, page: r.page || e.page || null, key: e.key || null };
      if (v.extra) Object.assign(extras, v.extra);
      if (keepValues && !SENSITIVE.test(e.label)) field.preview = v.value.length > 40 ? `${v.value.slice(0, 37)}…` : v.value;
    }
    fields.push(field);
  }
  return { fields, issues, values, extras, ticked, signed: signatureAsked ? (signaturePresent ? 'present' : 'missing') : 'unknown' };
}

/** Values → FIELDS vocabulary candidates; the compound ones are split here. */
function candidatesFrom(values, extras, page) {
  const out = [];
  const push = (key, value, p) => {
    if (!FIELDS[key]) return;
    const v = normaliseValue(key, value);
    if (v !== null && !out.some((c) => c.key === key)) out.push({ key, value: v, confidence: 'high', page: p || page || null });
  };
  for (const { value, page: p, key } of Object.values(values)) {
    if (!key) continue;
    if (key === 'full_name') {
      const parts = value.split(/\s+/);
      if (parts.length >= 2) { push('legal_first_name', parts[0], p); push('surname', parts[parts.length - 1], p); if (parts.length >= 3) push('middle_name', parts.slice(1, -1).join(' '), p); }
      continue;
    }
    if (key === 'super_member_and_usi') {
      // "TEST0000001 / USI STA0100AU", "STA0100AU / 12345678", or a bare member number.
      const usi = value.match(/USI\s*:?\s*([A-Za-z0-9]{8,20})/i);
      const parts = value.split(/[\/,|]|\bUSI\b/i).map((s) => norm(s)).filter(Boolean);
      if (usi) { push('super_usi', usi[1].toUpperCase(), p); const member = parts.find((s) => !new RegExp(usi[1], 'i').test(s)); if (member) push('super_member_number', member, p); }
      else if (parts.length) push('super_member_number', parts[0], p);
      continue;
    }
    push(key, value, p);
  }
  for (const [key, value] of Object.entries(extras)) push(key, value, page);
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

const stamp = () => new Date().toISOString();

/**
 * Read one returned document by the rules of the form it is.
 * @returns {Promise<null|{kind, check, candidates, signed}>} null when the
 *   document is not a form the portal knows; the caller falls back to the
 *   generic blank-field check and name matching.
 */
async function readReturnedDocument({ buffer, mime, keepValues = false }) {
  if (String(mime || '').toLowerCase() !== 'application/pdf') return null;
  let fields = [];
  try { ({ fields } = await acroFields(buffer)); } catch (_) { fields = []; }
  let pages = [];
  try { pages = await require('./resource-file-quality').pdfPageItems(buffer); } catch (_) { pages = []; }
  const pageTexts = pages.map((items) => items.map((it) => it.str).join(' '));
  const kind = detectKind({ fieldNames: fields.map((f) => f.name), pageTexts });
  if (!kind) return null;
  if (READ_ONLY.some((r) => r.kind === kind)) {
    return { kind, signed: 'unknown', candidates: [], check: { status: 'unchecked', method: 'pdf_text', kind, fields: [], issues: [], checkedAt: stamp() } };
  }
  const spec = SPECS.find((s) => s.kind === kind);

  if (spec.method === 'pdf_form') {
    const raw = new Map();
    for (const f of fields) {
      let signed = f.signed;
      // A signature field left as a field, or a signature written in its box (a flattened or printed-and-scanned copy with a text layer).
      if (f.type === 'PDFSignature' && !signed && f.rect) signed = f.page ? !!textInRect(pages[f.page - 1], f.rect) : pages.some((items) => !!textInRect(items, f.rect));
      raw.set(f.name, { value: f.value, checked: f.checked, signed, page: f.page, rect: f.rect });
    }
    const r = applyRules(spec, raw, { keepValues });
    const status = r.issues.length ? 'attention' : 'ok';
    return {
      kind, signed: r.signed, candidates: candidatesFrom(r.values, r.extras, null),
      check: { status, method: 'pdf_form', kind, fields: r.fields, issues: r.issues, checkedAt: stamp() },
    };
  }

  // Text-positioned (the ATO form).
  const totalText = pageTexts.join(' ').trim();
  if (totalText.length < 40) {
    return { kind, signed: 'unknown', candidates: [], check: { status: 'unreadable', method: 'none', kind, fields: [], issues: [{ code: 'unreadable', message: 'This PDF has no readable text (a scan or photo) — check it by eye' }], checkedAt: stamp() } };
  }
  const lines = linesOf(pages);
  const allLabelKeys = new Set([...spec.fields.map((e) => labelKey(e.name)), ...(spec.stopLabels || []).map(labelKey)]);
  const raw = new Map();
  for (const e of spec.fields) {
    const read = e.kind === 'signature' ? signatureBelowLabel(lines, pages, e) : valueBelowLabel(lines, e, allLabelKeys);
    raw.set(`${e.name}@${e.page}`, { value: read.value, absent: !!read.absent, page: e.page });
  }
  // Which section did the employee complete? The one with anything in it.
  const filledIn = (section) => spec.fields.some((e) => e.section === section && e.kind !== 'signature' && norm((raw.get(`${e.name}@${e.page}`) || {}).value));
  const signedIn = (section) => spec.fields.some((e) => e.section === section && e.kind === 'signature' && norm((raw.get(`${e.name}@${e.page}`) || {}).value));
  const section = ['B', 'D'].find(filledIn) || (signedIn('C') ? 'C' : null);
  const r = applyRules(spec, raw, { keepValues, sectionFilled: section || 'none' });
  if (!section) r.issues.push({ code: 'blank', message: 'No section is completed — choose Section B (existing fund), C (employer default) or D (SMSF) and complete it' });
  const candidates = candidatesFrom(r.values, r.extras, null);
  if (section) candidates.push({ key: 'super_choice_type', value: spec.sectionChoice[section], confidence: 'high', page: null });
  const status = r.issues.length ? 'attention' : 'ok';
  return {
    kind, signed: section ? r.signed : 'missing', candidates,
    check: { status, method: 'pdf_text', kind, section: section || null, fields: r.fields, issues: r.issues, checkedAt: stamp() },
  };
}

module.exports = {
  readReturnedDocument, detectKind, parseDate, validate, validAbn,
  SPECS: { CONTRACT, NEW_EMPLOYEE_DETAILS, SUPER_CHOICE }, READ_ONLY,
  _internals: { applyRules, candidatesFrom, linesOf, valueBelowLabel, textInRect, acroFields },
};
