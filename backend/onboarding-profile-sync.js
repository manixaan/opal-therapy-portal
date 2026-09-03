'use strict';

/**
 * PROFILE SYNC — verified onboarding information becomes the employee's
 * profile, which every register reads from.
 *
 * Input: the record's resolved fields whose status is accepted/corrected
 * (reliable by reconciliation, or settled by the Owner). Output: rows in
 *   employee_personal_details   name, DOB, contact, address, emergency contact
 *   employment_profiles         type, dates, hours, pay
 *   payroll_profiles            bank, super (approval is a separate Owner act)
 *   credentials                 licence, police, NDIS, WWCC, AHPRA, first aid, CPR — with expiry
 *   employee_identity_records   passport / visa
 *   employee_vehicles           registration, make, model, expiries
 * with the original returned document copied into pd_documents and linked,
 * so a credential keeps its evidence.
 *
 * Every value is written once, here. The Compliance Register, the profile
 * page and the expiry sweep read the same rows; nobody re-types them.
 */

const odb = require('./onboarding-db');
const rdb = require('./onboarding-returns-db');
const log = require('./logger').createLogger('onboarding-profile-sync');

/** field key → { type, name, number?, expiry?, issue?, extra? } */
const CREDENTIAL_MAP = {
  drivers_licence: { type: 'drivers_licence', name: "Driver's licence", number: 'drivers_licence_number', expiry: 'drivers_licence_expiry', extra: { state: 'drivers_licence_state' }, kind: 'drivers_licence' },
  police_check: { type: 'police_check', name: 'National Police Check', number: 'police_check_reference', issue: 'police_check_date', kind: 'police_check' },
  ndis_worker_screening: { type: 'ndis_worker_screening', name: 'NDIS Worker Screening Check', number: 'ndis_screening_number', expiry: 'ndis_screening_expiry', kind: 'ndis_screening' },
  wwcc: { type: 'wwcc', name: 'Working with Children Check', number: 'wwcc_number', expiry: 'wwcc_expiry', kind: 'wwcc' },
  ahpra_registration: { type: 'ahpra_registration', name: 'AHPRA registration', number: 'ahpra_registration_number', expiry: 'ahpra_expiry', kind: 'ahpra' },
  first_aid: { type: 'first_aid', name: 'First Aid Certificate', expiry: 'first_aid_expiry', issue: 'first_aid_issue_date', kind: 'first_aid' },
  cpr: { type: 'cpr', name: 'CPR Certificate', expiry: 'cpr_expiry', issue: 'cpr_issue_date', kind: 'cpr' },
  professional_indemnity: { type: 'professional_indemnity', name: 'Professional indemnity insurance', expiry: 'insurance_policy_expiry', kind: 'insurance' },
};

/** Which fields belong to which credential (reverse of the map). */
const FIELD_TO_CREDENTIAL = {};
for (const [t, m] of Object.entries(CREDENTIAL_MAP)) {
  for (const k of [m.number, m.expiry, m.issue, ...Object.values(m.extra || {})]) if (k) FIELD_TO_CREDENTIAL[k] = t;
}

const POLICE_VALIDITY_MONTHS = 12;

/**
 * @param {object} p
 * @param {object} p.assignment   with user_id
 * @param {object[]} p.returnedDocuments rows (id, document_kind, pack_item_id, …)
 * @returns {{ written: string[], appliedFieldIds: string[], skipped: string[] }}
 */
async function syncProfile({ assignment, returnedDocuments = [] }) {
  const userId = assignment.user_id;
  const org = assignment.organisation_id;
  const written = []; const appliedIds = []; const skipped = [];
  if (!userId) return { written, appliedFieldIds: appliedIds, skipped: ['no_user'] };

  const rows = (await rdb.listResolved(assignment.id)).filter((r) => ['accepted', 'corrected'].includes(r.status));
  const values = {}; const idsByKey = {}; const sourceByKey = {};
  for (const r of rows) {
    const raw = await rdb.getResolvedRaw(assignment.id, r.id);
    const v = rdb.revealResolved(raw);
    if (v == null || v === '') continue;
    values[r.field_key] = v; idsByKey[r.field_key] = r.id; sourceByKey[r.field_key] = r.source_document_id;
  }
  const has = (k) => values[k] != null;
  const take = (...keys) => keys.filter(has).map((k) => idsByKey[k]);
  const docFor = (kind, fieldKeys) => {
    const byField = fieldKeys.map((k) => sourceByKey[k]).find(Boolean);
    return returnedDocuments.find((d) => d.id === byField) || returnedDocuments.find((d) => d.document_kind === kind) || null;
  };

  // ── Personal + emergency ──
  const personalKeys = ['legal_first_name', 'middle_name', 'surname', 'preferred_name', 'date_of_birth', 'personal_email', 'mobile',
    'address_line1', 'address_line2', 'suburb', 'state', 'postcode', 'postal_line1', 'postal_suburb', 'postal_state', 'postal_postcode',
    'emergency_name', 'emergency_relationship', 'emergency_phone', 'emergency_alt_phone'];
  if (personalKeys.some(has)) {
    // Merge over what is already there: the saver overwrites some optional columns unconditionally.
    const cur = (await odb.getPersonalDetails(userId)) || {};
    const pick = (k, col) => (has(k) ? values[k] : cur[col] ?? undefined);
    await odb.upsertPersonalDetails(userId, org, {
      assignmentId: assignment.id,
      legalFirstName: pick('legal_first_name', 'legal_first_name'), middleName: pick('middle_name', 'middle_name'),
      surname: pick('surname', 'surname'), preferredName: pick('preferred_name', 'preferred_name'),
      dateOfBirth: pick('date_of_birth', 'date_of_birth'), personalEmail: pick('personal_email', 'personal_email') || assignment.applicant_email,
      mobile: pick('mobile', 'mobile') || assignment.mobile,
      addressLine1: pick('address_line1', 'address_line1'), addressLine2: pick('address_line2', 'address_line2'),
      suburb: pick('suburb', 'suburb'), state: pick('state', 'state'), postcode: pick('postcode', 'postcode'),
      postalSameAsResidential: !(has('postal_line1') || cur.postal_line1),
      postalLine1: pick('postal_line1', 'postal_line1'), postalSuburb: pick('postal_suburb', 'postal_suburb'),
      postalState: pick('postal_state', 'postal_state'), postalPostcode: pick('postal_postcode', 'postal_postcode'),
      emergencyName: pick('emergency_name', 'emergency_name'), emergencyRelationship: pick('emergency_relationship', 'emergency_relationship'),
      emergencyPhone: pick('emergency_phone', 'emergency_phone'), emergencyAltPhone: pick('emergency_alt_phone', 'emergency_alt_phone'),
      completedAt: cur.completed_at || undefined,
    });
    written.push('personal'); appliedIds.push(...take(...personalKeys));
    if (has('emergency_email')) {
      await odb.pool.query('UPDATE employee_personal_details SET emergency_email = $2 WHERE user_id = $1', [userId, String(values.emergency_email).slice(0, 255)]).catch(() => {});
      appliedIds.push(idsByKey.emergency_email);
    }
  }

  // ── Employment ──
  const empKeys = ['employment_type', 'start_date', 'end_date', 'hours_per_week', 'salary_annual', 'hourly_rate', 'job_title', 'award_classification', 'work_location'];
  if (empKeys.some(has)) {
    await odb.upsertEmploymentProfile(userId, org, {
      assignmentId: assignment.id, jobTitle: values.job_title || assignment.job_title, employmentType: values.employment_type || assignment.employment_type,
      roleCategory: assignment.role_category, startDate: values.start_date || assignment.start_date, endDate: values.end_date || assignment.end_date,
      hoursPerWeek: values.hours_per_week ?? assignment.hours_per_week ?? undefined, awardClassification: values.award_classification || assignment.award_classification,
      managerUserId: assignment.manager_user_id, workLocation: values.work_location || assignment.work_location,
      childRelatedWork: assignment.facts?.child_related_work || 'assessment_required', ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
      mobileCommunityRole: assignment.facts?.mobile_community_role === true, usesOwnVehicle: assignment.facts?.uses_own_vehicle === true,
      status: 'onboarding',
    });
    await rdb.setEmploymentPay(userId, {
      payBasis: has('salary_annual') ? 'annual' : has('hourly_rate') ? 'hourly' : null,
      payRate: values.salary_annual ?? values.hourly_rate ?? null,
      hoursPerWeek: values.hours_per_week ?? null, employmentType: values.employment_type || null,
      startDate: values.start_date || null, endDate: values.end_date || null,
    });
    written.push('employment'); appliedIds.push(...take(...empKeys));
  }

  // ── Payroll (bank + super) — stored; the Owner approves separately ──
  if (has('bsb') || has('account_number') || has('account_holder_name')) {
    await odb.savePayrollBank(userId, org, { assignmentId: assignment.id, accountHolderName: values.account_holder_name, bsb: values.bsb, accountNumber: values.account_number }, null);
    written.push('bank'); appliedIds.push(...take('bsb', 'account_number', 'account_holder_name'));
  }
  if (has('super_fund_name') || has('super_usi') || has('super_member_number')) {
    const choice = values.super_choice_type === 'employer_default' ? 'employer_default' : 'apra_fund';
    await odb.savePayrollSuper(userId, org, { assignmentId: assignment.id, superChoiceType: choice, superFundName: values.super_fund_name, superFundUsi: values.super_usi, superMemberNumber: values.super_member_number }, null);
    written.push('super'); appliedIds.push(...take('super_fund_name', 'super_usi', 'super_member_number', 'super_choice_type'));
  }

  // ── Credentials, with the original attached ──
  for (const [type, m] of Object.entries(CREDENTIAL_MAP)) {
    const keys = [m.number, m.expiry, m.issue, ...Object.values(m.extra || {})].filter(Boolean);
    if (!keys.some(has)) continue;
    const doc = docFor(m.kind, keys);
    const documentId = doc ? await rdb.attachOriginal(doc, { userId, organisationId: org, title: m.name, documentType: 'credential_scan' }) : null;
    let expiry = m.expiry ? values[m.expiry] : null;
    if (!expiry && type === 'police_check' && has('police_check_date')) {
      const d = new Date(values.police_check_date); d.setMonth(d.getMonth() + POLICE_VALIDITY_MONTHS); expiry = d.toISOString().slice(0, 10);
    }
    const detail = {};
    for (const [k, fk] of Object.entries(m.extra || {})) if (has(fk)) detail[k] = values[fk];
    await rdb.upsertCredentialByType(userId, org, {
      credentialType: type, credentialName: m.name, registrationNumber: m.number ? values[m.number] : null,
      issueDate: m.issue ? values[m.issue] : null, expiryDate: expiry, documentId, detail, status: 'pending_review',
    });
    written.push(`credential:${type}`); appliedIds.push(...take(...keys));
  }

  // ── Identity: passport / visa ──
  if (has('passport_number') || has('passport_expiry') || has('passport_country')) {
    const doc = docFor('passport', ['passport_number', 'passport_expiry', 'passport_country']);
    const documentId = doc ? await rdb.attachOriginal(doc, { userId, organisationId: org, title: 'Passport', documentType: 'identity' }) : null;
    const au = /austral/i.test(values.passport_country || '');
    await rdb.upsertIdentity(userId, org, {
      assignmentId: assignment.id, recordKind: 'identity', evidenceType: au ? 'australian_passport' : 'foreign_passport',
      nameOnDocument: [values.legal_first_name, values.surname].filter(Boolean).join(' ') || assignment.applicant_name,
      documentNumber: values.passport_number, countryOfIssue: values.passport_country, expiryDate: values.passport_expiry, documentId,
    });
    written.push('identity:passport'); appliedIds.push(...take('passport_number', 'passport_expiry', 'passport_country'));
  }
  if (has('visa_subclass') || has('visa_expiry')) {
    const doc = docFor('visa', ['visa_subclass', 'visa_expiry']);
    const documentId = doc ? await rdb.attachOriginal(doc, { userId, organisationId: org, title: 'Visa', documentType: 'identity' }) : null;
    await rdb.upsertIdentity(userId, org, {
      assignmentId: assignment.id, recordKind: 'right_to_work', evidenceType: 'visa', nameOnDocument: assignment.applicant_name,
      visaSubclass: values.visa_subclass, workRightsExpiry: values.visa_expiry, expiryDate: values.visa_expiry, documentId,
    });
    written.push('identity:visa'); appliedIds.push(...take('visa_subclass', 'visa_expiry'));
  }

  // ── Vehicle ──
  const vKeys = ['vehicle_registration', 'vehicle_make', 'vehicle_model', 'vehicle_registration_expiry', 'vehicle_insurance_expiry'];
  if (vKeys.some(has)) {
    const doc = docFor('vehicle', vKeys);
    const documentId = doc ? await rdb.attachOriginal(doc, { userId, organisationId: org, title: 'Vehicle details', documentType: 'vehicle' }) : null;
    await rdb.upsertVehicle(userId, org, {
      assignmentId: assignment.id, registration: values.vehicle_registration, make: values.vehicle_make, model: values.vehicle_model,
      registrationExpiry: values.vehicle_registration_expiry, insuranceExpiry: values.vehicle_insurance_expiry, documentId,
    });
    written.push('vehicle'); appliedIds.push(...take(...vKeys));
  }

  const ids = [...new Set(appliedIds.filter(Boolean))];
  await rdb.markFieldsApplied(ids, 'profile');
  for (const k of Object.keys(values)) if (!ids.includes(idsByKey[k])) skipped.push(k);
  return { written, appliedFieldIds: ids, skipped };
}

/** What the profile now holds, for the record screen — masked where sensitive. */
async function profileSummary(userId) {
  if (!userId) return null;
  const [personal, employment, payroll, credentials, vehicle, identity] = await Promise.all([
    odb.getPersonalDetails(userId), odb.getEmploymentProfile(userId), odb.getPayrollProfileMasked(userId),
    odb.listCredentialsForUser(userId), rdb.getVehicle(userId), odb.listIdentityRecordsMasked(userId),
  ]);
  const p = personal || {}; const e = employment || {};
  return {
    personal: personal ? {
      name: [p.legal_first_name, p.middle_name, p.surname].filter(Boolean).join(' ') || null, preferredName: p.preferred_name || null,
      dateOfBirth: p.date_of_birth || null, mobile: p.mobile || null, email: p.personal_email || null,
      address: [p.address_line1, p.address_line2, p.suburb, p.state, p.postcode].filter(Boolean).join(', ') || null,
    } : null,
    emergency: personal && p.emergency_name ? { name: p.emergency_name, relationship: p.emergency_relationship || null, phone: p.emergency_phone || null, email: p.emergency_email || null } : null,
    employment: employment ? {
      position: e.job_title || null, employmentType: e.employment_type || null, startDate: e.start_date || null, endDate: e.end_date || null,
      hoursPerWeek: e.hours_per_week != null ? Number(e.hours_per_week) : null, payBasis: e.pay_basis || null, payRate: e.pay_rate != null ? Number(e.pay_rate) : null,
    } : null,
    payroll: payroll ? { bankStatus: payroll.bankStatus || payroll.bank_status, bsbMasked: payroll.bsbMasked || payroll.bsb_masked, accountLast4: payroll.accountNumberLast4 || payroll.account_number_last4, superFund: payroll.superFundName || payroll.super_fund_name || null, bankVerifiedAt: payroll.bankVerifiedAt || payroll.bank_verified_at || null } : null,
    credentials: (credentials || []).map((c) => ({ id: c.id, type: c.credential_type, name: c.credential_name, number: c.registration_number || null, issueDate: c.issue_date || null, expiryDate: c.expiry_date || null, status: c.status, documentId: c.document_id || null })),
    identity: (identity || []).map((r) => ({ id: r.id, kind: r.record_kind, evidenceType: r.evidence_type, numberLast4: r.document_number_last4 || null, expiryDate: r.expiry_date || null, workRightsExpiry: r.work_rights_expiry || null, documentId: r.document_id || null })),
    vehicle: vehicle ? { registration: vehicle.registration, make: vehicle.make, model: vehicle.model, registrationExpiry: vehicle.registration_expiry, insuranceExpiry: vehicle.insurance_expiry, documentId: vehicle.document_id } : null,
  };
}

module.exports = { CREDENTIAL_MAP, FIELD_TO_CREDENTIAL, syncProfile, profileSummary };
