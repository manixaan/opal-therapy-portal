'use strict';

/**
 * Builders for the pack's returned forms, with the same field names and
 * printed labels the real documents carry, so the rule-based reader is
 * tested against what it will actually meet.
 */

const { PDFDocument, StandardFonts, PDFName, PDFString } = require('pdf-lib');

const CONTRACT_FIELDS = ['letter_date', 'recipient_name', 'salutation_name', 'recipient_address', 'contract_date', 'commencement_date', 'employee_full_name', 'employee_address', 'employment_type', 'workplace_address', 'cpd_allowance', 'signatory_full_name', 'signature_date', 'annual_salary_aud', 'standard_hours'];

/** Every AcroForm field of the New Employee Details form, page by page. */
const NED_TEXT = {
  1: ['p1_organisation_name', 'p1_address', 'p1_contact_details', 'p1_name_and_role_of_person_completing_th', 'p1_date_the_form_was_completed'],
  2: ['p2_non_binary_other', 'p2_date_of_completion', 'p2_type', 'p2_expiry', 'p2_first_name', 'p2_preferred_name', 'p2_middle_name', 'p2_last_name', 'p2_date_of_birth', 'p2_preferred_language', 'p2_employment_start_date', 'p2_role_position_title', 'p2_car_registration_details_if_applicabl', 'p2_site_service_name', 'p2_site_address', 'p2_contact_details', 'p2_contact_name', 'p2_do_you_have_secondary_employment_i_e_'],
  3: ['p3_do_you_have_any_skills_qualifications', 'p3_do_you_have_any_pre_existing_medical_', 'p3_do_you_have_any_allergies', 'p3_name', 'p3_address', 'p3_phone', 'p3_email', 'p3_name_2', 'p3_relationship_to_employee', 'p3_address_2', 'p3_mobile', 'p3_email_2'],
  4: ['p4_account_name', 'p4_bank_financial_institution', 'p4_bsb', 'p4_account_number', 'p4_superannuation_fund_name', 'p4_super_member_number_usi', 'p4_licence_number', 'p4_state_territory_of_issue', 'p4_licence_class', 'p4_expiry_date', 'p4_passport_number', 'p4_country_of_issue', 'p4_passport_expiry_date', 'p4_visa_grant_number_vevo_check_if_appli', 'p4_other_identity_document_e_g_birth_cer'],
  5: ['p5_if_yes_please_provide_details', 'p5_ahpra_registration_number', 'p5_profession_division', 'p5_registration_type', 'p5_registration_expiry_date', 'p5_first_aid_certificate_number', 'p5_training_provider', 'p5_first_aid_expiry_date', 'p5_cpr_expiry_date', 'p5_ndis_worker_screening_check_number', 'p5_state_territory_of_issue', 'p5_date_of_issue', 'p5_expiry_date'],
  6: ['p6_if_no_date_applied', 'p6_if_yes_please_provide_details', 'p6_i', 'p6_wwcc_number', 'p6_state_territory_of_issue', 'p6_expiry_date', 'p6_date_of_issue', 'p6_issuing_body_provider', 'p6_certificate_reference_number', 'p6_signature', 'p6_date'],
};
const NED_BOXES = {
  2: ['p2_identifies_as_male', 'p2_identifies_as_female', 'p2_identifies_as_transgender', 'p2_identifies_as_non_binary', 'p2_identifies_as_other', 'p2_interpreter_required_yes', 'p2_interpreter_required_no', 'p2_aboriginal_or_torres_strait_islander_', 'p2_aboriginal_or_torres_strait_islander__2', 'p2_aboriginal_or_torres_strait_islander__3', 'p2_ndis_worker_orientation_module_comple', 'p2_ndis_worker_orientation_module_comple_2', 'p2_australian_citizen_yes', 'p2_australian_citizen_no', 'p2_are_you_a_permanent_resident_yes', 'p2_are_you_a_permanent_resident_yes_no'],
  4: ['p4_tax_file_number_declaration_provided_', 'p4_tax_file_number_declaration_provided__2', 'p4_copy_of_driver_s_licence_front_and_ba', 'p4_copy_of_driver_s_licence_front_and_ba_2', 'p4_passport_photo_page_attached_required'],
  5: ['p5_conditions_or_undertakings_on_registr', 'p5_conditions_or_undertakings_on_registr_2', 'p5_copy_of_ahpra_registration_certificat', 'p5_copy_of_ahpra_registration_certificat_2', 'p5_first_aid_cpr_required_for_this_role_', 'p5_first_aid_cpr_required_for_this_role__2', 'p5_copy_of_first_aid_cpr_certificate_att', 'p5_copy_of_first_aid_cpr_certificate_att_2', 'p5_clearance_status_cleared', 'p5_clearance_status_application', 'p5_linked_to_opal_therapy_in_the_ndis_wo', 'p5_linked_to_opal_therapy_in_the_ndis_wo_2', 'p5_copy_of_ndis_worker_screening_clearan', 'p5_copy_of_ndis_worker_screening_clearan_2'],
  6: ['p6_clearance_type_employee', 'p6_clearance_type_volunteer', 'p6_copy_of_wwcc_clearance_attached_attac', 'p6_copy_of_wwcc_clearance_attached_to', 'p6_police_check_completed_yes', 'p6_police_check_completed_no', 'p6_disclosable_court_outcomes_recorded_y', 'p6_disclosable_court_outcomes_recorded_n', 'p6_copy_of_police_check_certificate_atta', 'p6_copy_of_police_check_certificate_atta_2'],
};

/** A complete, valid New Employee Details answer set (Jane Doe, Australian citizen, licence and passport attached). */
const NED_COMPLETE = {
  values: {
    p1_organisation_name: 'Opal Therapy', p1_address: '11 Rostrata Av, Willetton WA 6155', p1_contact_details: 'adminservices@opaltherapy.com.au | +61 484 827 212',
    p1_name_and_role_of_person_completing_th: 'Jane Doe - Junior Occupational Therapist (new employee)', p1_date_the_form_was_completed: '10/09/2026',
    p2_date_of_completion: '01/08/2026', p2_first_name: 'Jane', p2_preferred_name: 'Jane', p2_middle_name: 'Marie', p2_last_name: 'Doe', p2_date_of_birth: '14/03/1998',
    p2_preferred_language: 'English', p2_employment_start_date: '28/09/2026', p2_role_position_title: 'Junior Occupational Therapist', p2_car_registration_details_if_applicabl: '1TST123 (WA)',
    p2_site_service_name: 'Opal Therapy', p2_site_address: '11 Rostrata Av, Willetton WA 6155', p2_contact_details: '+61 484 827 212 | adminservices@opaltherapy.com.au', p2_contact_name: 'Ann Mary Mathew (Owner)',
    p2_do_you_have_secondary_employment_i_e_: 'No',
    p3_do_you_have_any_skills_qualifications: 'Current HLTAID011 Provide First Aid and HLTAID009 CPR.', p3_do_you_have_any_pre_existing_medical_: 'No', p3_do_you_have_any_allergies: 'No known allergies',
    p3_name: 'Dr Sam Example, Subiaco Medical Centre', p3_address: '1 Example Road, Subiaco WA 6008', p3_phone: '(08) 9000 0000', p3_email: 'reception@example.com',
    p3_name_2: 'John Doe', p3_relationship_to_employee: 'Partner', p3_address_2: '12 Example Street, Subiaco WA 6008', p3_mobile: '0400 000 002', p3_email_2: 'john.doe@example.com',
    p4_account_name: 'Jane M Doe', p4_bank_financial_institution: 'Test Bank Australia', p4_bsb: '066-000', p4_account_number: '00000001',
    p4_superannuation_fund_name: 'AustralianSuper', p4_super_member_number_usi: 'TEST0000001 / USI STA0100AU',
    p4_licence_number: '0000001', p4_state_territory_of_issue: 'WA', p4_licence_class: 'C', p4_expiry_date: '14/03/2031',
    p4_passport_number: 'PA0000001', p4_country_of_issue: 'Australia', p4_passport_expiry_date: '01/07/2033', p4_other_identity_document_e_g_birth_cer: 'Medicare card',
    p5_ahpra_registration_number: 'OCC0000000001', p5_profession_division: 'Occupational Therapist', p5_registration_type: 'General', p5_registration_expiry_date: '30/11/2026',
    p5_first_aid_certificate_number: 'TEST-FA-000001', p5_training_provider: 'St John WA', p5_first_aid_expiry_date: '01/08/2029', p5_cpr_expiry_date: '01/08/2027',
    p5_ndis_worker_screening_check_number: 'WSC-TEST-000001', p5_state_territory_of_issue: 'WA', p5_date_of_issue: '01/07/2026', p5_expiry_date: '01/07/2031',
    p6_i: 'Jane Marie Doe', p6_wwcc_number: 'WWC0000001', p6_state_territory_of_issue: 'WA', p6_expiry_date: '01/07/2029',
    p6_date_of_issue: '15/08/2026', p6_issuing_body_provider: 'Australian Federal Police (National Police Check)', p6_certificate_reference_number: 'NPC-TEST-000001',
    p6_signature: 'Jane Marie Doe', p6_date: '10/09/2026',
  },
  ticks: ['p2_identifies_as_female', 'p2_interpreter_required_no', 'p2_aboriginal_or_torres_strait_islander__2', 'p2_ndis_worker_orientation_module_comple', 'p2_australian_citizen_yes',
    'p4_tax_file_number_declaration_provided_', 'p4_copy_of_driver_s_licence_front_and_ba', 'p4_passport_photo_page_attached_required',
    'p5_conditions_or_undertakings_on_registr_2', 'p5_copy_of_ahpra_registration_certificat', 'p5_first_aid_cpr_required_for_this_role_', 'p5_copy_of_first_aid_cpr_certificate_att',
    'p5_clearance_status_cleared', 'p5_linked_to_opal_therapy_in_the_ndis_wo', 'p5_copy_of_ndis_worker_screening_clearan',
    'p6_clearance_type_employee', 'p6_copy_of_wwcc_clearance_attached_attac', 'p6_police_check_completed_yes', 'p6_disclosable_court_outcomes_recorded_n', 'p6_copy_of_police_check_certificate_atta'],
};

/** A complete, valid contract answer set. */
const CONTRACT_COMPLETE = {
  letter_date: '10 September 2026', recipient_name: 'Jane Doe', salutation_name: 'Jane', recipient_address: '12 Example Street, Subiaco WA 6008',
  contract_date: '10/09/2026', commencement_date: '28 September 2026', employee_full_name: 'Jane Marie Doe', employee_address: '12 Example Street, Subiaco WA 6008',
  employment_type: 'Fixed-term (to 27 September 2027)', workplace_address: '11 Rostrata Av, Willetton WA 6155', cpd_allowance: '$1,000',
  signatory_full_name: 'Jane Marie Doe', signature_date: '10/09/2026', annual_salary_aud: '80,000.00', standard_hours: '38',
};

async function fontAnd(doc) { return doc.embedFont(StandardFonts.Helvetica); }

/**
 * The contract: one page of text fields, a PDFSignature-style signature box.
 * `signature` (a string) writes a typed name into the signature box, as a
 * flattened or printed-and-scanned copy with a text layer would carry it.
 */
async function buildContractPdf(values = {}, { signature = null } = {}) {
  const doc = await PDFDocument.create();
  const font = await fontAnd(doc);
  const form = doc.getForm();
  let page = doc.addPage([595, 842]);
  page.drawText('CONTRACT OF EMPLOYMENT', { x: 40, y: 800, size: 14, font });
  let y = 770;
  for (const name of CONTRACT_FIELDS) {
    if (y < 60) { page = doc.addPage([595, 842]); y = 790; }
    page.drawText(name.replace(/_/g, ' '), { x: 40, y: y + 2, size: 8, font });
    const f = form.createTextField(name);
    f.addToPage(page, { x: 220, y, width: 320, height: 16, font });
    if (values[name] != null) f.setText(String(values[name]));
    y -= 24;
  }
  // The signature box: a signature field with a widget, as the practice's own PDF has.
  page.drawText('employee signature', { x: 40, y: y + 2, size: 8, font });
  const sig = doc.context.obj({ FT: 'Sig', T: PDFString.of('employee_signature'), Kids: [] });
  const sigRef = doc.context.register(sig);
  const widget = doc.context.obj({ Type: 'Annot', Subtype: 'Widget', Rect: [220, y - 20, 540, y + 16], F: 4, Parent: sigRef, P: page.ref });
  const widgetRef = doc.context.register(widget);
  sig.set(PDFName.of('Kids'), doc.context.obj([widgetRef]));
  page.node.addAnnot(widgetRef);
  form.acroForm.addField(sigRef);
  if (signature) page.drawText(signature, { x: 230, y: y - 10, size: 12, font });
  form.updateFieldAppearances(font);
  return Buffer.from(await doc.save());
}

/** The six-page New Employee Details form: text fields and tick boxes by name. */
async function buildEmployeeDetailsPdf({ values = {}, ticks = [] } = {}) {
  const doc = await PDFDocument.create();
  const font = await fontAnd(doc);
  const form = doc.getForm();
  const on = new Set(ticks);
  for (let p = 1; p <= 6; p += 1) {
    const page = doc.addPage([595, 842]);
    page.drawText(`NEW EMPLOYEE DETAILS — page ${p}`, { x: 40, y: 810, size: 12, font });
    let y = 780;
    for (const name of NED_TEXT[p] || []) {
      page.drawText(name, { x: 30, y: y + 3, size: 6, font });
      const f = form.createTextField(name);
      f.addToPage(page, { x: 230, y, width: 330, height: 14, font });
      if (values[name] != null && values[name] !== '') f.setText(String(values[name]));
      y -= 20;
    }
    for (const name of NED_BOXES[p] || []) {
      page.drawText(name, { x: 30, y: y + 3, size: 6, font });
      const b = form.createCheckBox(name);
      b.addToPage(page, { x: 230, y, width: 12, height: 12 });
      if (on.has(name)) b.check();
      y -= 18;
    }
  }
  form.updateFieldAppearances(font);
  return Buffer.from(await doc.save());
}

/**
 * The ATO Superannuation standard choice form as the pack carries it: no
 * fields, printed labels, answers typed beneath them (one character per box
 * for the boxed ones). `answers` keys are the printed labels of Section B.
 */
async function buildSuperChoicePdf(answers = {}, { signature = null, signedDate = null } = {}) {
  const doc = await PDFDocument.create();
  const font = await fontAnd(doc);
  const boxed = (s) => String(s).split('').join(' ');
  // Page 1: title and Section A.
  const p1 = doc.addPage([595, 842]);
  p1.drawText('Superannuation', { x: 300, y: 800, size: 20, font });
  p1.drawText('standard choice form', { x: 300, y: 778, size: 16, font });
  p1.drawText('How to complete online', { x: 40, y: 700, size: 10, font });
  p1.drawText('Section A  Your details', { x: 300, y: 700, size: 10, font });
  p1.drawText('Full name', { x: 300, y: 680, size: 8, font });
  p1.drawText('Save time: use the online form', { x: 40, y: 666, size: 8, font });
  if (answers['Full name']) p1.drawText(answers['Full name'], { x: 300, y: 664, size: 10, font });
  p1.drawText('Employee number (if known)', { x: 300, y: 640, size: 8, font });
  p1.drawText('Tax file number (TFN)', { x: 300, y: 600, size: 8, font });
  // Page 2: Section B.
  const p2 = doc.addPage([595, 842]);
  p2.drawText('Section B  My existing super fund', { x: 40, y: 800, size: 12, font });
  p2.drawText('Super fund details', { x: 40, y: 780, size: 10, font });
  let y = 750;
  for (const [label, key, isBoxed] of [['Super fund name', 'Super fund name', false], ['Super fund Australian business number (ABN)', 'ABN', true], ['Unique superannuation identifier (USI)', 'USI', true], ['Your member account number', 'Member', true], ['Your name as it appears on your account', 'Name on account', false]]) {
    p2.drawText(label, { x: 40, y, size: 8, font });
    if (answers[key]) p2.drawText(isBoxed ? boxed(answers[key]) : String(answers[key]), { x: 40, y: y - 16, size: 10, font });
    y -= 50;
  }
  p2.drawText('Required documentation', { x: 40, y, size: 10, font }); y -= 30;
  p2.drawText('Declaration', { x: 40, y, size: 10, font }); y -= 30;
  p2.drawText('Signature', { x: 40, y, size: 8, font });
  if (signature) p2.drawText(signature, { x: 60, y: y - 24, size: 12, font });
  p2.drawText('Date', { x: 340, y, size: 8, font });
  p2.drawText('Day Month Year', { x: 340, y: y - 10, size: 6, font });
  if (signedDate) p2.drawText(boxed(signedDate), { x: 340, y: y - 24, size: 10, font });
  y -= 60;
  p2.drawText('If you have completed this section, this is the end of the form. Return this form to your employer as soon as possible.', { x: 40, y, size: 7, font });
  // Page 3: Section C, blank.
  const p3 = doc.addPage([595, 842]);
  p3.drawText("Section C  My employer's default super fund", { x: 40, y: 800, size: 12, font });
  p3.drawText('Signature', { x: 40, y: 600, size: 8, font });
  p3.drawText('Date', { x: 340, y: 600, size: 8, font });
  p3.drawText('Day Month Year', { x: 340, y: 590, size: 6, font });
  // Page 4: Section D, blank.
  const p4 = doc.addPage([595, 842]);
  p4.drawText('Section D  My private self-managed super fund (SMSF)', { x: 40, y: 800, size: 12, font });
  for (const [i, label] of ['SMSF name', 'SMSF Australian business number (ABN)', 'SMSF electronic service address (ESA)', 'Your full name as it appears on your account', 'Bank account name', 'BSB code (please include all six numbers)', 'Account number'].entries()) {
    p4.drawText(label, { x: 40, y: 760 - i * 40, size: 8, font });
  }
  p4.drawText('Signature', { x: 40, y: 420, size: 8, font });
  p4.drawText('Date', { x: 340, y: 420, size: 8, font });
  p4.drawText('Month Year Day', { x: 340, y: 410, size: 6, font });
  return Buffer.from(await doc.save());
}

const SUPER_COMPLETE = { 'Full name': 'Jane Marie Doe', 'Super fund name': 'AustralianSuper', ABN: '65714394898', USI: 'STA0100AU', Member: 'TEST0000001', 'Name on account': 'Jane Marie Doe' };

/** A statement that comes back for reading only. */
async function buildStatementPdf(title) {
  const doc = await PDFDocument.create();
  const font = await fontAnd(doc);
  const page = doc.addPage([595, 842]);
  page.drawText(title, { x: 40, y: 800, size: 16, font });
  page.drawText('Employers must give every new employee this statement before, or as soon as possible after, they start their new job. It explains their rights.', { x: 40, y: 770, size: 8, font });
  return Buffer.from(await doc.save());
}

module.exports = { buildContractPdf, buildEmployeeDetailsPdf, buildSuperChoicePdf, buildStatementPdf, CONTRACT_COMPLETE, NED_COMPLETE, SUPER_COMPLETE, CONTRACT_FIELDS, NED_TEXT, NED_BOXES };
