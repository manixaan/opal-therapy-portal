'use strict';

/**
 * ONBOARDING CATALOGUE — the seeded compliance registry, document library,
 * requirement templates and packages.
 *
 * This is DATA, not logic. It is the answer to "what does Opal ask a new
 * starter for, and on whose authority?", expressed so an Owner can change it
 * in the UI afterwards without a deployment.
 *
 * PROVENANCE
 * ──────────
 * Every source below was verified against the PRIMARY publisher on
 * 20 August 2026 — fairwork.gov.au, ato.gov.au, ndiscommission.gov.au,
 * ahpra.gov.au, occupationaltherapyboard.gov.au, wa.gov.au,
 * workingwithchildren.wa.gov.au, workcover.wa.gov.au, immi.homeaffairs.gov.au
 * and oaic.gov.au. `sourceVersionLabel` records the publisher's OWN version
 * string where one exists, verbatim.
 *
 * THINGS THIS FILE IS CAREFUL NOT TO SAY
 * ──────────────────────────────────────
 * Getting compliance content wrong in a confident tone is worse than leaving
 * it out, so several widely-repeated claims are deliberately NOT asserted:
 *
 *   • NDIS Worker Screening is NOT stated as universally required. It is a
 *     legal requirement for risk-assessed roles and key personnel of
 *     REGISTERED providers. The Commission's own words for everyone else:
 *     unregistered providers "aren't legally required to ask their staff to
 *     have an NDIS worker screening clearance, but you can choose to do so."
 *     Opal may still require it — as OPAL_POLICY_REQUIREMENT, never as law.
 *
 *   • A National Police Check is NOT stated as mandatory for NDIS or health
 *     workers. It becomes mandatory only through a specific instrument.
 *
 *   • A WWCC is NOT auto-required by job title. The statutory test is whether
 *     the USUAL DUTIES involve contact with a child in one of the 18
 *     categories in s.6 of the Working with Children (Screening) Act 2004 (WA).
 *
 *   • OT CPD is 20 hours per registration year, not 30. The 30-hour figure is
 *     everywhere on secondary sites and belongs to other professions; the
 *     Board's own standard says "at least 20 hours", including a minimum of
 *     five in an interactive setting.
 *
 *   • Occupational therapists are NOT listed as mandatory reporters under
 *     s.124B of the Children and Community Services Act 2004 (WA).
 *
 *   • The Fair Work statements bind NATIONAL SYSTEM employers. A WA sole
 *     trader or unincorporated partnership sits in the WA state system, where
 *     they do not apply — hence the `industrialRelationsSystem` setting.
 *
 * Everything numeric that a regulator can revise (CPD hours, recency hours,
 * validity periods, reminder windows) is CONFIGURABLE data here rather than a
 * constant in code, because all of it has changed before and will again.
 */

// ═════════════════════════════════════════════════════════════════════════════
//  ORGANISATION DEFAULTS  (stored in org_settings under the 'onboarding' key)
// ═════════════════════════════════════════════════════════════════════════════

const DEFAULT_SETTINGS = {
  // Drives every NDIS rule. Nothing about worker screening is asserted as a
  // legal requirement while this is 'unregistered'.
  ndisProviderStatus: 'unregistered', // unregistered | application_in_progress | registered | registration_inactive

  // Whether the Fair Work information-statement obligations bind at all.
  // 'unknown' makes the portal say so rather than guess.
  industrialRelationsSystem: 'unknown', // national | wa_state | unknown

  // Fewer than 15 employees changes the CEIS re-issue cadence from
  // 6/12/annual to 12-monthly. Re-evaluated at each trigger, never cached.
  smallBusinessEmployer: true,

  defaultDueDays: 14,
  reminderWindowsDays: [90, 60, 30, 7],
  onboardingReminderDays: [7, 3, 1],

  // Opal's own safeguarding position, kept explicitly separate from the law.
  requireWorkerScreeningAsPolicy: false,
  requirePoliceCheckAsPolicy: false,

  // Professional standards that the Board can revise. Editable in Settings.
  otCpdHoursPerYear: 20,
  otCpdInteractiveHours: 5,
  otRecencyHours5Years: 750,
  otRecencyHours3Years: 450,
  otRecencyHours12Months: 150,
  ahpraRenewalMonthDay: '11-30',      // 30 November
  ahpraLatePeriodEndsMonthDay: '12-31',

  wwccValidityYears: 3,
  ndisScreeningValidityYears: 5,

  // Default super fund. The employer must complete Section C of the
  // Superannuation standard choice form BEFORE giving it to an employee.
  defaultSuperFund: { name: null, abn: null, usi: null },
};

// ═════════════════════════════════════════════════════════════════════════════
//  1. COMPLIANCE REGISTRY — the official source behind each requirement
// ═════════════════════════════════════════════════════════════════════════════

const COMPLIANCE_SOURCES = [
  // ── Fair Work ────────────────────────────────────────────────────────────
  {
    code: 'FWIS',
    title: 'Fair Work Information Statement',
    category: 'employment',
    classification: 'OFFICIAL_DOCUMENT',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'AU',
    sourceOrg: 'Fair Work Ombudsman',
    sourceTitle: 'Fair Work Information Statement',
    sourceUrl: 'https://www.fairwork.gov.au/employment-conditions/information-statements/fair-work-information-statement',
    sourceVersionLabel: 'Last updated: July 2026',
    effectiveDate: '2026-07-01',
    deliveryRules: {
      methods: ['in_person', 'mail', 'email', 'email_link', 'intranet_link', 'fax', 'other'],
      electronicRequiresAgreement: false,
    },
    notes: 'Fair Work Act 2009 ss 124-125. Must be given to EVERY new employee before, or as '
      + 'soon as possible after, they start — every employment type including casual, fixed term '
      + 'and probationary. Reissued each July after the Annual Wage Review, so expect a new '
      + 'version annually. Binds national system employers only.',
  },
  {
    code: 'CEIS',
    title: 'Casual Employment Information Statement',
    category: 'employment',
    classification: 'OFFICIAL_DOCUMENT',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Casual employees',
    jurisdiction: 'AU',
    sourceOrg: 'Fair Work Ombudsman',
    sourceTitle: 'Casual Employment Information Statement',
    sourceUrl: 'https://www.fairwork.gov.au/employment-conditions/information-statements/casual-employment-information-statement',
    sourceVersionLabel: 'Last updated: August 2025',
    effectiveDate: '2025-08-25',
    // THE RULE MOST OFTEN GOT WRONG. Not a one-off onboarding task.
    recurrence: {
      kind: 'months_since_start',
      months: [6, 12],
      thenEveryMonths: 12,
      smallBusinessMonths: [12],
      smallBusinessThenEveryMonths: 12,
    },
    deliveryRules: {
      methods: ['in_person', 'mail', 'email', 'email_link', 'intranet_link', 'fax', 'other'],
      electronicRequiresAgreement: false,
    },
    notes: 'Fair Work Act 2009 ss 125A-125B. Given at commencement alongside the FWIS, and then '
      + 'AGAIN during employment: a small business employer (fewer than 15 employees) at 12 months '
      + 'and every 12 months after; every other employer at 6 months, 12 months, and every 12 '
      + 'months after. Small-business status is tested at each trigger, not fixed — crossing 15 '
      + 'employees changes the cadence for every casual.',
  },
  {
    code: 'FTCIS',
    title: 'Fixed Term Contract Information Statement',
    category: 'employment',
    classification: 'OFFICIAL_DOCUMENT',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Fixed-term employees',
    jurisdiction: 'AU',
    sourceOrg: 'Fair Work Ombudsman',
    sourceTitle: 'Fixed Term Contract Information Statement',
    sourceUrl: 'https://www.fairwork.gov.au/employment-conditions/information-statements/fixed-term-contract-information-statement',
    sourceVersionLabel: 'Last updated: November 2025',
    effectiveDate: '2025-11-01',
    recurrence: { kind: 'per_contract' },
    // Materially narrower than the other two.
    deliveryRules: {
      methods: ['in_person', 'mail', 'email', 'email_link', 'intranet_link'],
      electronicRequiresAgreement: true,
    },
    notes: 'Fair Work Act 2009 ss 333J-333K. The trigger is ENTERING INTO a fixed term contract, '
      + 'not being a new hire — so it re-fires on every renewal or extension with an existing '
      + 'employee. Delivery is restricted: in person, by mail to the residential address, or '
      + 'electronically ONLY if the employee agrees. Do not infer the version from the URL: the '
      + 'file sits under a /2023-12/ path but is the November 2025 revision.',
  },
  {
    code: 'IR_SYSTEM',
    title: 'Which industrial relations system applies to the practice',
    category: 'employment',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Employer',
    jurisdiction: 'WA',
    sourceOrg: 'Private Sector Labour Relations, Government of Western Australia',
    sourceTitle: 'Which system of employment laws applies',
    sourceUrl: 'https://www.wa.gov.au/organisation/private-sector-labour-relations/which-system-of-employment-laws-applies',
    notes: 'MUST BE RESOLVED BEFORE THE FAIR WORK STATEMENTS ARE ASSERTED. In WA a sole trader or '
      + 'unincorporated partnership is generally in the STATE system (Minimum Conditions of '
      + 'Employment Act 1993, WA awards), where the FWIS/CEIS/FTCIS obligations do not apply. '
      + 'A Pty Ltd is a national system employer and they do. There is no WA state equivalent of '
      + 'the information statements.',
  },
  {
    code: 'CASUAL_EMPLOYEE_CHOICE',
    title: 'Casual employee choice pathway — 21-day written employer response',
    category: 'employment',
    classification: 'EMPLOYER_ONLY_COMPLIANCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Casual employees',
    jurisdiction: 'AU',
    sourceOrg: 'Fair Work Ombudsman',
    sourceTitle: 'Becoming a permanent employee',
    sourceUrl: 'https://www.fairwork.gov.au/starting-employment/types-of-employees/casual-employees/becoming-a-permanent-employee',
    notes: 'Replaced the old offer-based casual conversion on 26 August 2024. It is '
      + 'EMPLOYEE-INITIATED: there is no employer obligation to offer conversion, so do not build '
      + 'a "must offer at 12 months" reminder. Once an eligible casual gives written notice the '
      + 'employer must consult and respond IN WRITING WITHIN 21 DAYS, and may only refuse on the '
      + 'closed list of permitted grounds.',
  },

  // ── ATO: tax, super, Payday Super ────────────────────────────────────────
  {
    code: 'ATO_COMMENCEMENT',
    title: 'New employee tax commencement (TFN declaration)',
    category: 'payroll',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'AU',
    sourceOrg: 'Australian Taxation Office',
    sourceTitle: 'Hiring a new worker',
    sourceUrl: 'https://www.ato.gov.au/businesses-and-organisations/hiring-and-paying-your-workers/engaging-a-worker/hiring-a-new-worker',
    notes: 'The ATO\'s stated order of preference is (1) the EMPLOYER\'S OWN electronic form, '
      + '(2) ATO online services via myGov, (3) the paper NAT 3092 — whose downloadable PDF has '
      + 'been withdrawn and must be ordered by phone. Capturing tax details inside Opal is '
      + 'therefore the ATO\'s FIRST preference, not a workaround. The employee must complete '
      + 'online commencement forms within 28 days of starting. Paper is MANDATORY where the '
      + 'employee has no TFN or is exempt from quoting one. An STP-enabled employer never lodges '
      + 'the declaration; it retains the record.',
  },
  {
    code: 'ATO_SUPER_CHOICE',
    title: 'Superannuation standard choice (NAT 13080)',
    category: 'payroll',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All eligible employees',
    jurisdiction: 'AU',
    sourceOrg: 'Australian Taxation Office',
    sourceTitle: 'Superannuation standard choice form',
    sourceUrl: 'https://www.ato.gov.au/forms-and-instructions/superannuation-standard-choice-form',
    sourceVersionLabel: 'NAT 13080-03.2023',
    notes: 'Still current. APRA fund fields: fund name, ABN, USI, member account number, name as '
      + 'it appears on the account, plus a letter of compliance from the fund. SMSF fields differ '
      + 'entirely — an SMSF has NO USI and NO member account number; it needs SMSF name, ABN, '
      + 'electronic service address (ESA) and bank account name/BSB/number, plus Super Fund Lookup '
      + 'evidence that it is ATO-regulated. The EMPLOYER must complete its default fund details '
      + '(Section C) before giving the form to an employee.',
  },
  {
    code: 'ATO_STAPLED_SUPER',
    title: 'Stapled super fund request',
    category: 'payroll',
    classification: 'EMPLOYER_ONLY_COMPLIANCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Employees who start without nominating a fund',
    jurisdiction: 'AU',
    sourceOrg: 'Australian Taxation Office',
    sourceTitle: 'Stapled super funds for employers',
    sourceUrl: 'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/setting-up-super-for-your-business/offer-employees-a-choice-of-super-fund/stapled-super-funds-for-employers',
    notes: 'Order of precedence to avoid the super guarantee charge: (1) the employee\'s chosen '
      + 'fund; (2) the stapled fund the ATO returns; (3) the employer default fund. Requested '
      + 'through ATO online services for business (needs the "Employee commencement form" '
      + 'permission in Access Manager). FROM 27 MARCH 2026 the stapled request may be made and '
      + 'offered AT THE SAME TIME as the choice form rather than only after it, which shortens '
      + 'time to first contribution.',
  },
  {
    code: 'PAYDAY_SUPER',
    title: 'Payday Super — SG must reach the fund within 7 business days of payday',
    category: 'payroll',
    classification: 'EMPLOYER_ONLY_COMPLIANCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'AU',
    sourceOrg: 'Australian Taxation Office',
    sourceTitle: 'Payment deadlines for payday super',
    sourceUrl: 'https://www.ato.gov.au/businesses-and-organisations/super-for-employers/paying-super-on-payday/payment-deadlines-for-payday-super',
    effectiveDate: '2026-07-01',
    notes: 'In force from 1 July 2026 for earnings PAID on or after that date. Contributions must '
      + 'be RECEIVED by the fund within 7 business days of payday. THE ONBOARDING-CRITICAL '
      + 'EXCEPTION: the first contribution for a NEW employee has 20 business days — but only for '
      + 'the first payday; by payday two the 7-day rule applies. This is why super details must be '
      + 'settled before the first pay run rather than within a quarterly cycle. SG rate for '
      + '2026-27 is 12%, applied to qualifying earnings (not ordinary time earnings), with a '
      + 'maximum contribution base of $270,830.',
  },

  // ── Work rights and identity ─────────────────────────────────────────────
  {
    code: 'VEVO_WORK_RIGHTS',
    title: 'Work rights verification (VEVO for organisations)',
    category: 'identity',
    classification: 'EMPLOYER_VERIFICATION',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Non-citizen workers',
    jurisdiction: 'AU',
    sourceOrg: 'Department of Home Affairs',
    sourceTitle: 'Check visa conditions online — for organisations',
    sourceUrl: 'https://immi.homeaffairs.gov.au/visas/already-have-a-visa/check-visa-details-and-conditions/check-conditions-online/for-organisations',
    notes: 'The employer check takes name AS SHOWN ON THE TRAVEL DOCUMENT, date of birth, travel '
      + 'document type, travel document number and country of document — NOT a visa grant number '
      + 'or TRN, which are the visa holder\'s own self-check identifiers. Requires the visa '
      + 'holder\'s consent and organisation registration with Home Affairs. Home Affairs states '
      + '"You do not need to keep a copy of the visa holder\'s travel document" and recommends '
      + 'retaining the VEVO RESULT PDF instead — that is the artefact compliance officers ask for. '
      + 'A TFN, Medicare card or driver\'s licence is NOT sufficient evidence of work rights. '
      + 'Re-verification intervals published by Home Affairs are operational guidance, not '
      + 'statutory deadlines. The obligation is the employer\'s own and cannot be delegated to an '
      + 'agency.',
  },
  {
    code: 'PRIVACY_APP5_NOTICE',
    title: 'Privacy collection notice (APP 5) for onboarding',
    category: 'privacy',
    classification: 'OPAL_POLICY',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All applicants and new employees',
    jurisdiction: 'AU',
    sourceOrg: 'Office of the Australian Information Commissioner',
    sourceTitle: 'APP 5 — Notification of the collection of personal information',
    sourceUrl: 'https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-5-app-5-notification-of-the-collection-of-personal-information',
    notes: 'THE EMPLOYEE RECORDS EXEMPTION DOES NOT COVER THIS. Section 7B(3) applies to current '
      + 'and former employment relationships — not to job applicants and prospective employees, '
      + 'which is precisely the onboarding phase when identity documents, TFN and bank details are '
      + 'collected. A collection notice must therefore be given at the START of onboarding, not '
      + 'treated as optional. APP 3 also requires collecting only what is reasonably necessary, '
      + 'and APP 11.2 requires destroying what is no longer needed.',
  },
  {
    code: 'TFN_RULE',
    title: 'Privacy (Tax File Number) Rule 2015',
    category: 'privacy',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'AU',
    sourceOrg: 'Office of the Australian Information Commissioner',
    sourceTitle: 'The Privacy (Tax File Number) Rule 2015',
    sourceUrl: 'https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/handling-personal-information/the-privacy-tax-file-number-rule-2015-and-the-protection-of-tax-file-number-information',
    notes: 'A TFN must NEVER be used as an identifier, key, index or search field, and records '
      + 'must not be cross-matched by TFN. Breach is an interference with privacy, and ss 8WA/8WB '
      + 'of the Taxation Administration Act 1953 create criminal offences for unauthorised '
      + 'recording, use or disclosure. Opal stores a TFN encrypted, renders at most the last three '
      + 'digits, never indexes it, and never permits a search by it.',
  },

  // ── Ahpra / Occupational Therapy Board ───────────────────────────────────
  {
    code: 'AHPRA_REGISTRATION',
    title: 'Ahpra registration as an occupational therapist',
    category: 'professional',
    classification: 'EMPLOYER_VERIFICATION',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Anyone using the protected title "occupational therapist"',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Ahpra',
    sourceTitle: 'Register of practitioners',
    sourceUrl: 'https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx',
    notes: 'Verify against the public register — never on the strength of an employee-supplied '
      + 'screenshot. There is NO free public API: structured access is the paid Practitioner '
      + 'Information Exchange, and its change-notification service is browser-only. Registration '
      + 'expires 30 November annually. CRITICAL READING TRAP: between 1 and 31 December a '
      + 'practitioner may legitimately show status "Registered" with an expiry date already in the '
      + 'past, because the National Law allows a late period while renewal is assessed — naive '
      + '"expiry < today = lapsed" logic will flag a compliant clinician. The register cannot '
      + 'verify CPD, recency or professional indemnity; those must be collected directly.',
  },
  {
    code: 'OT_PII',
    title: 'Professional indemnity insurance arrangements (OT Board registration standard)',
    category: 'professional',
    classification: 'EMPLOYER_VERIFICATION',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered OTs other than students / non-practising',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Occupational Therapy Board of Australia',
    sourceTitle: 'Registration standard: Professional indemnity insurance arrangements',
    sourceUrl: 'https://www.occupationaltherapyboard.gov.au/Registration-Standards/Professional-indemnity-insurance.aspx',
    effectiveDate: '2019-12-01',
    notes: 'Own cover, third-party cover and employer-provided cover are ALL acceptable — but '
      + 'employer cover counts only if it actually meets the standard (civil liability, '
      + 'retroactive cover, automatic reinstatement or equivalent), and the practitioner must hold '
      + 'their own cover for any practice outside that employment. Never tell an OT "you are '
      + 'covered by us" as a blanket assurance; record WHICH arrangement applies and that it was '
      + 'checked against the standard.',
  },
  {
    code: 'OT_CPD',
    title: 'Continuing professional development (OT Board registration standard)',
    category: 'professional',
    classification: 'EMPLOYEE_UPLOAD',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered OTs other than students / non-practising',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Occupational Therapy Board of Australia',
    sourceTitle: 'Registration standard: Continuing professional development',
    sourceUrl: 'https://www.occupationaltherapyboard.gov.au/registration-standards/continuing-professional-development.aspx',
    effectiveDate: '2019-12-01',
    notes: 'AT LEAST 20 HOURS per registration year, of which a minimum of 5 must be in an '
      + 'interactive setting with other practitioners. NOT 30 hours — that figure appears widely '
      + 'on secondary sites and belongs to other professions. Records must be kept for five years. '
      + 'The registration year runs to the 30 November expiry. All of these numbers are settings, '
      + 'not constants, because the Board reviews its standards periodically.',
  },
  {
    code: 'OT_RECENCY',
    title: 'Recency of practice (OT Board registration standard)',
    category: 'professional',
    classification: 'EMPLOYEE_UPLOAD',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered OTs other than students / first-time graduates / non-practising',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Occupational Therapy Board of Australia',
    sourceTitle: 'Registration standard: Recency of practice',
    sourceUrl: 'https://www.occupationaltherapyboard.gov.au/registration-standards/recency-of-practice.aspx',
    notes: '750 hours in the past 5 years, OR 450 hours in the past 3 years, OR 150 hours in the '
      + 'past 12 months. No exemptions. Relevant when onboarding a returner rather than a new '
      + 'graduate.',
  },
  {
    code: 'OT_CODE_OF_CONDUCT',
    title: 'Code of conduct (shared Ahpra code)',
    category: 'professional',
    classification: 'ACKNOWLEDGEMENT',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered occupational therapists',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Occupational Therapy Board of Australia',
    sourceTitle: 'Code of conduct',
    sourceUrl: 'https://www.occupationaltherapyboard.gov.au/Codes-Guidelines/Code-of-conduct.aspx',
    effectiveDate: '2022-06-29',
    notes: 'The Board issues a Code of CONDUCT, not a Code of Ethics. The shared code covering 12 '
      + 'professions replaced the OT-specific code on 28 June 2022. Occupational Therapy '
      + 'Australia\'s Code of Ethics is an association membership document, not a regulatory '
      + 'instrument, and binds only its members.',
  },
  {
    code: 'OT_CRIMINAL_HISTORY',
    title: 'Criminal history (OT Board registration standard)',
    category: 'professional',
    classification: 'ACKNOWLEDGEMENT',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered practitioners, applicants and registered students',
    jurisdiction: 'PROFESSION',
    sourceOrg: 'Occupational Therapy Board of Australia',
    sourceTitle: 'Registration standard: Criminal history',
    sourceUrl: 'https://www.occupationaltherapyboard.gov.au/Registration-Standards/Criminal-history.aspx',
    effectiveDate: '2026-07-15',
    notes: 'New standard effective 15 July 2026, replacing the 2015 version. The duty sits on the '
      + 'INDIVIDUAL — declare criminal history at application, declare changes at renewal, notify '
      + 'relevant events during the registration period. It does NOT oblige an employer to obtain '
      + 'a police check; Ahpra obtains the check itself at application.',
  },

  // ── NDIS ─────────────────────────────────────────────────────────────────
  {
    code: 'NDIS_CODE_OF_CONDUCT',
    title: 'NDIS Code of Conduct',
    category: 'ndis',
    classification: 'ACKNOWLEDGEMENT',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All workers — registered AND unregistered providers',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'NDIS Code of Conduct',
    sourceUrl: 'https://www.ndiscommission.gov.au/rules-and-standards/ndis-code-conduct',
    notes: 'THE ONE NDIS OBLIGATION AN UNREGISTERED PROVIDER CANNOT OPT OUT OF. It binds '
      + 'registered providers, unregistered providers, their key personnel and all workers — '
      + 'employees, contractors, agents and volunteers alike. Worker guidance PDF: '
      + 'https://www.ndiscommission.gov.au/sites/default/files/2024-10/Code-of-Conduct-Worker-Guidance.pdf',
  },
  {
    code: 'NDIS_WORKER_SCREENING',
    title: 'NDIS Worker Screening Check',
    category: 'screening',
    classification: 'EMPLOYER_VERIFICATION',
    // Deliberately NOT 'LEGAL_REQUIREMENT' at the registry level: whether it is
    // one depends entirely on the organisation's provider status, which the
    // rule engine resolves per assignment.
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Risk-assessed roles and key personnel of REGISTERED providers',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'Worker screening',
    sourceUrl: 'https://www.ndiscommission.gov.au/workforce/worker-screening',
    notes: 'LEGALLY REQUIRED ONLY for risk-assessed roles and key personnel of REGISTERED '
      + 'providers, via the NDIS (Practice Standards—Worker Screening) Rules 2018 as a condition '
      + 'of registration. The Commission on unregistered providers: they "aren\'t legally required '
      + 'to ask their staff to have an NDIS worker screening clearance, but you can choose to do '
      + 'so." A risk-assessed role means direct delivery of specified supports, or work likely to '
      + 'require MORE THAN INCIDENTAL CONTACT with people with disability, or a key personnel '
      + 'role. VERIFICATION IS DATABASE-BASED, NOT CERTIFICATE-BASED: the employer links the '
      + 'worker in the NDIS Worker Screening Database and monitors status — it never simply '
      + 'accepts an uploaded certificate. Clearance is valid up to 5 years, nationally portable, '
      + 'under continuous monitoring. NWSD statuses are Clearance, Pending, Interim bar, '
      + 'Exclusion, Suspension and No valid clearance — "Expired" is NOT one of them; expiry is '
      + 'derived from the expiry date.',
  },
  {
    code: 'NDIS_WORKER_ORIENTATION',
    title: 'NDIS Worker Orientation Module — "Quality, Safety and You"',
    category: 'training',
    classification: 'TRAINING_MODULE',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Workers of registered providers (mandatory); all others recommended',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'Online training modules',
    sourceUrl: 'https://www.ndiscommission.gov.au/workforce/online-training-modules',
    notes: 'Mandatory for workers of REGISTERED providers, through the Human Resource Management '
      + 'quality indicators in the Practice Standards — not by a free-standing law binding every '
      + 'disability worker. Strongly recommended for everyone else. Widely-repeated details (an '
      + '80% pass mark, ~90 minutes, a non-expiring certificate) could NOT be verified against the '
      + 'Commission and are deliberately not asserted here. Link to the official course; never '
      + 'reproduce the Commission\'s training content inside Opal.',
  },
  {
    code: 'NDIS_NEW_WORKER_INDUCTION',
    title: 'New worker NDIS induction modules',
    category: 'training',
    classification: 'TRAINING_MODULE',
    basis: 'GOOD_PRACTICE',
    appliesTo: 'New workers entering the disability sector',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'New worker NDIS induction modules',
    sourceUrl: 'https://training.ndiscommission.gov.au/course/index.php?categoryid=3',
    notes: 'The individual module titles could not be verified — the Commission\'s training site '
      + 'refuses automated requests — so Opal links the course index rather than listing modules '
      + 'that may be wrong.',
  },
  {
    code: 'NDIS_PRACTICE_STANDARDS',
    title: 'NDIS Practice Standards and Quality Indicators',
    category: 'ndis',
    classification: 'EMPLOYER_REFERENCE',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered providers',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'NDIS Practice Standards',
    sourceUrl: 'https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards',
    notes: 'EMPLOYER REFERENCE ONLY. Do not require an employee to read the whole document and '
      + 'click agree — derive the relevant policies and training from it instead. The consolidated '
      + 'document still reads "Version 4, November 2021", but new supported independent living '
      + 'standards commenced 1 July 2026 and a broader review is under way, so a stored copy will '
      + 'go stale.',
  },
  {
    code: 'NDIS_VERIFICATION_EVIDENCE',
    title: 'Qualification and professional association evidence for NDIS audit',
    category: 'ndis',
    classification: 'EMPLOYER_REFERENCE',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Registered providers of allied health supports',
    jurisdiction: 'NDIS',
    sourceOrg: 'NDIS Quality and Safeguards Commission',
    sourceTitle: 'NDIS Practice Standards — Qualification and Professional Associations Required Documentation Guide',
    sourceUrl: 'https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards/verification-module',
    notes: 'Explains WHY Opal keeps qualification, registration and screening records: it is the '
      + 'evidence an auditor asks for under the Verification module. Owner/Admin reference — never '
      + 'shown to an employee as a requirement.',
  },

  // ── Western Australia ────────────────────────────────────────────────────
  {
    code: 'WWCC_WA',
    title: 'Working with Children Check (WA)',
    category: 'screening',
    classification: 'EMPLOYER_VERIFICATION',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Child-related work as defined in s.6 of the Act',
    jurisdiction: 'WA',
    sourceOrg: 'Department of Communities, Government of Western Australia',
    sourceTitle: 'Working with Children Check — who needs a WWC Check',
    sourceUrl: 'https://www.wa.gov.au/organisation/department-of-communities/working-children-check-who-needs-wwc-check',
    notes: 'Working with Children (Screening) Act 2004 (WA) s.6: work is child-related if its '
      + 'USUAL DUTIES involve, or are likely to involve, contact with a child in connection with '
      + 'one of 18 prescribed categories. The test is DUTIES, NOT JOB TITLE. Communities\' own '
      + 'factsheet CAT10 names occupational therapists working with children who provide '
      + 'counselling-type support as in scope, and says administration and reception roles are '
      + '"generally" not — but an admin person who supervises children or runs activities can be. '
      + 'The card is valid 3 years and renewable up to 3 months before expiry. Verify through the '
      + 'official card validation service; a card number format must NOT be enforced by regex '
      + 'because no official format is published. Registering the cardholder with the Screening '
      + 'Unit is what makes the employer receive interim/negative notice alerts, and that '
      + 'registration lapses with each card. Reform is in train: a 2025 amendment bill on '
      + 'interstate mutual recognition and a Phase 2 review of the categories.',
  },
  {
    code: 'WWCC_WA_VALIDATION',
    title: 'WWC card validation and employee registration (WA)',
    category: 'screening',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Employers of child-related workers',
    jurisdiction: 'WA',
    sourceOrg: 'Working with Children Screening Unit (WA)',
    sourceTitle: 'Card validation',
    sourceUrl: 'https://www.workingwithchildren.wa.gov.au/card-validation',
    notes: 'The validation service takes the notice (card) number OR the application number '
      + 'together with the family name. A validated card is a POINT-IN-TIME result, not a '
      + 'permanent pass — cards can be suspended or revoked mid-term, and the employer only '
      + 'receives alerts if it has registered the cardholder.',
  },
  {
    code: 'WA_NDIS_SCREENING_UNIT',
    title: 'NDIS Worker Screening Check — WA administration',
    category: 'screening',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'REGULATORY_STANDARD',
    appliesTo: 'Workers living or working in WA',
    jurisdiction: 'WA',
    sourceOrg: 'Department of Communities, Government of Western Australia',
    sourceTitle: 'NDIS Worker Screening Check',
    sourceUrl: 'https://www.wa.gov.au/organisation/department-of-communities/ndis-worker-screening-check',
    notes: 'Administered in WA by the NDIS Worker Screening Unit within the Department of '
      + 'Communities under the National Disability Insurance Scheme (Worker Screening) Act 2020 '
      + '(WA). Applied for online via DoTDirect and finalised at a Driver and Vehicle Services '
      + 'centre. IT DOES NOT SUBSTITUTE FOR A WWCC: Communities\' own comparison states that '
      + 'someone in a risk-assessed role for a registered provider who works with children needs '
      + 'BOTH. Fees change — link the page, never hardcode them.',
  },
  {
    code: 'WA_WORKERS_COMPENSATION',
    title: 'Workers compensation policy (WA)',
    category: 'employer_compliance',
    classification: 'EMPLOYER_ONLY_COMPLIANCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Employer',
    jurisdiction: 'WA',
    sourceOrg: 'WorkCover WA',
    sourceTitle: 'Employers — rights and obligations',
    sourceUrl: 'https://www.workcover.wa.gov.au/employers/',
    effectiveDate: '2024-07-01',
    notes: 'Workers Compensation and Injury Management Act 2023 (WA), which replaced the 1981 Act '
      + 'on 1 July 2024. s.202(2): an employer must AT ALL TIMES hold a current policy from a '
      + 'licensed insurer; s.204 penalty is $10,000 per worker with a fresh offence each week '
      + 'after conviction. THIS IS NEVER AN EMPLOYEE UPLOAD — it is an organisational record.',
  },
  {
    code: 'WA_INJURY_MANAGEMENT_SYSTEM',
    title: 'Injury management system document (WA)',
    category: 'employer_compliance',
    classification: 'OPAL_POLICY',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'WA',
    sourceOrg: 'WorkCover WA',
    sourceTitle: 'Injury management systems',
    sourceUrl: 'https://www.workcover.wa.gov.au/employers/understanding-your-rights-obligations/injury-management-systems/',
    notes: 'WCIM Act 2023 s.159 requires the employer to establish an injury management system and '
      + 'ensure it is DESCRIBED IN A DOCUMENT AVAILABLE TO WORKERS (penalty $5,000). Regulation 73 '
      + 'prescribes the content: the worker\'s right to claim, the employer\'s obligation to '
      + 'comply with the claim and injury-management process, the steps the employer will take, '
      + 'and the NAMED PERSON with day-to-day responsibility plus their contact details. '
      + 'Regulation 74 requires a copy on request. This is why onboarding gives the employee '
      + 'injury/workers-compensation INFORMATION rather than asking them to upload anything. '
      + 'A claim must be passed to the insurer within 7 days (s.26).',
  },
  {
    code: 'WA_WHS_INDUCTION',
    title: 'Work health and safety induction (WA)',
    category: 'employer_compliance',
    classification: 'TRAINING_MODULE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'All employees',
    jurisdiction: 'WA',
    sourceOrg: 'WorkSafe WA',
    sourceTitle: 'Work Health and Safety Act 2020 (WA)',
    sourceUrl: 'https://www.worksafe.wa.gov.au/',
    effectiveDate: '2022-03-31',
    notes: 'Work Health and Safety Act 2020 (WA) and WHS (General) Regulations 2022, operative '
      + 'from 31 March 2022. There is no standalone "induction" section — the duty arises from the '
      + 'primary duty of care and the requirement to provide information, training, instruction '
      + 'and supervision. Psychosocial hazards are in scope; the specific regulation numbers were '
      + 'not verified against the live consolidation and are deliberately not cited.',
  },
  {
    code: 'NATIONAL_POLICE_CHECK',
    title: 'National Police Check',
    category: 'screening',
    classification: 'EMPLOYEE_UPLOAD',
    // The whole point of this record is that it is NOT a universal legal duty.
    basis: 'OPAL_POLICY_REQUIREMENT',
    appliesTo: 'Only roles where a specific instrument or contract requires it',
    jurisdiction: 'AU',
    sourceOrg: 'Australian Criminal Intelligence Commission',
    sourceTitle: 'National Police Checking Service',
    sourceUrl: 'https://www.acic.gov.au/national-police-checking-service',
    notes: 'NOT legally required for all NDIS or health workers. It becomes mandatory only through '
      + 'a specific instrument — a WA Health screening policy, a funder or contractual condition, '
      + 'aged care rules, or a particular site requirement. Ahpra obtains its own criminal history '
      + 'check at registration and does not require the employer to. Opal may require one as an '
      + 'ORGANISATIONAL policy; the registry records that honestly rather than dressing it up as '
      + 'law.',
  },
  {
    code: 'WA_MANDATORY_REPORTING',
    title: 'Mandatory reporting of child sexual abuse (WA)',
    category: 'ndis',
    classification: 'OFFICIAL_LIVE_SOURCE',
    basis: 'LEGAL_REQUIREMENT',
    appliesTo: 'Only the classes listed in s.124B',
    jurisdiction: 'WA',
    sourceOrg: 'Government of Western Australia',
    sourceTitle: 'Mandatory reporting of child sexual abuse',
    sourceUrl: 'https://www.wa.gov.au/service/community-services/community-support/mandatory-reporting-of-child-sexual-abuse-wa',
    notes: 'Children and Community Services Act 2004 (WA) s.124B lists specific classes of '
      + 'mandatory reporter. OCCUPATIONAL THERAPISTS ARE NOT AMONG THEM. Telling an OT they are a '
      + 'legal mandatory reporter would be a false statement of their obligations. Opal may still '
      + 'require internal reporting as a safeguarding policy — that is a different thing and is '
      + 'labelled as such.',
  },
];

// ═════════════════════════════════════════════════════════════════════════════
//  2. DOCUMENT LIBRARY
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Official documents Opal republishes verbatim. `ownerControlled: false` means
 * Opal must never edit the text — only re-import a newer official file, which
 * is why each carries the source URL and expected version label.
 *
 * These seed with contentStatus 'link_only': the pipeline to import the real
 * files exists (ZIP import and per-document version upload), but Opal has not
 * been handed the files, and serving a fabricated stand-in for a statutory
 * document would be worse than linking the publisher.
 */
const OFFICIAL_DOCUMENTS = [
  {
    code: 'DOC_FWIS', title: 'Fair Work Information Statement', category: 'Fair Work',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'FWIS', requiresAcknowledgement: true,
    officialSourceUrl: 'https://www.fairwork.gov.au/fwis',
    sourceVersionLabel: 'Last updated: July 2026',
    description: 'The statement every new employee must be given. Published by the Fair Work Ombudsman and reissued each July.',
  },
  {
    code: 'DOC_SUPER_CHOICE', title: 'Superannuation Standard Choice Form', category: 'Payroll',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'ATO_SUPER_CHOICE', requiresAcknowledgement: false,
    officialSourceUrl: 'https://www.ato.gov.au/forms-and-instructions/superannuation-standard-choice-form',
    sourceVersionLabel: 'NAT 13080',
    description: 'The ATO form a new employee completes to nominate a superannuation fund. Published by the ATO; upload the current PDF to include it in the pack.',
  },
  {
    code: 'DOC_CEIS', title: 'Casual Employment Information Statement', category: 'Fair Work',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'CEIS', requiresAcknowledgement: true,
    officialSourceUrl: 'https://www.fairwork.gov.au/ceis',
    sourceVersionLabel: 'Last updated: August 2025',
    description: 'Given to casual employees at commencement and re-issued at set intervals throughout their engagement.',
  },
  {
    code: 'DOC_FTCIS', title: 'Fixed Term Contract Information Statement', category: 'Fair Work',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'FTCIS', requiresAcknowledgement: true,
    officialSourceUrl: 'https://www.fairwork.gov.au/ftcis',
    sourceVersionLabel: 'Last updated: November 2025',
    description: 'Given on entering into every new or renewed fixed term contract. Electronic delivery requires the employee\'s agreement.',
  },
  {
    code: 'DOC_NDIS_CODE_GUIDANCE', title: 'NDIS Code of Conduct — Worker Guidance', category: 'NDIS',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'NDIS_CODE_OF_CONDUCT', requiresAcknowledgement: true,
    officialSourceUrl: 'https://www.ndiscommission.gov.au/sites/default/files/2024-10/Code-of-Conduct-Worker-Guidance.pdf',
    description: 'The Commission\'s guidance on what the Code of Conduct requires of every worker.',
  },
  {
    code: 'DOC_NDIS_PRACTICE_STANDARDS', title: 'NDIS Practice Standards and Quality Indicators', category: 'Employer Compliance',
    classification: 'EMPLOYER_REFERENCE', audience: 'employer', ownerControlled: false,
    complianceCode: 'NDIS_PRACTICE_STANDARDS',
    officialSourceUrl: 'https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards',
    description: 'Reference material behind Opal\'s workforce compliance design. Not issued to employees.',
  },
  {
    code: 'DOC_NDIS_VERIFICATION_GUIDE', title: 'NDIS Verification Module — required documentation guide', category: 'Employer Compliance',
    classification: 'EMPLOYER_REFERENCE', audience: 'employer', ownerControlled: false,
    complianceCode: 'NDIS_VERIFICATION_EVIDENCE',
    officialSourceUrl: 'https://www.ndiscommission.gov.au/rules-and-standards/ndis-practice-standards/verification-module',
    description: 'Explains which staff records an NDIS auditor expects to see, and why Opal keeps them.',
  },
  {
    code: 'DOC_OT_CODE_OF_CONDUCT', title: 'Occupational Therapy Board — Code of conduct', category: 'Professional Registration',
    classification: 'OFFICIAL_DOCUMENT', audience: 'employee', ownerControlled: false,
    complianceCode: 'OT_CODE_OF_CONDUCT', requiresAcknowledgement: true,
    officialSourceUrl: 'https://www.occupationaltherapyboard.gov.au/Codes-Guidelines/Code-of-conduct.aspx',
    description: 'The shared Ahpra code of conduct that binds registered occupational therapists.',
  },
];

/**
 * Opal's own policy library.
 *
 * Every one seeds as DRAFT / document_required. That is a deliberate refusal:
 * fabricating a polished, authoritative-looking WHS or privacy policy so the
 * feature "looks complete" would produce a document a real practice might rely
 * on in a real incident. The slot, its version history, its acknowledgement
 * workflow and its audit trail are all real and working — the CONTENT is the
 * Owner's to supply or approve.
 */
const OPAL_POLICIES = [
  { code: 'POL_CODE_OF_CONDUCT', title: 'Opal Therapy Code of Conduct', category: 'Policies', ack: true },
  { code: 'POL_PRIVACY', title: 'Privacy & Confidentiality Policy', category: 'Policies', ack: true },
  { code: 'POL_COLLECTION_NOTICE', title: 'Employee Privacy Collection Notice', category: 'Policies', ack: true,
    complianceCode: 'PRIVACY_APP5_NOTICE',
    description: 'What Opal collects during onboarding, why, who it is disclosed to and how it is stored. '
      + 'Required by APP 5 — and the employee records exemption does not cover applicants, so this is issued first.' },
  { code: 'POL_INFOSEC', title: 'Information Security & Acceptable Use Policy', category: 'Policies', ack: true },
  { code: 'POL_WHS', title: 'Work Health and Safety Policy', category: 'WHS', ack: true, complianceCode: 'WA_WHS_INDUCTION' },
  { code: 'POL_EEO', title: 'Equal Opportunity, Anti-Discrimination & Respectful Workplace Policy', category: 'Policies', ack: true },
  { code: 'POL_BULLYING', title: 'Bullying, Harassment & Sexual Harassment Policy', category: 'Policies', ack: true },
  { code: 'POL_INCIDENT', title: 'Incident Management Policy', category: 'Policies', ack: true },
  { code: 'POL_COMPLAINTS', title: 'Complaints Management Policy', category: 'Policies', ack: true },
  { code: 'POL_SAFEGUARDING', title: 'Safeguarding — Violence, Abuse, Neglect and Exploitation Policy', category: 'Policies', ack: true },
  { code: 'POL_CONFLICT', title: 'Conflict of Interest Policy', category: 'Policies', ack: true },
  { code: 'POL_GIFTS', title: 'Gifts and Benefits Policy', category: 'Policies', ack: false },
  { code: 'POL_RECORDS', title: 'Records Management Policy', category: 'Policies', ack: true },
  { code: 'POL_CLINICAL_DOC', title: 'Clinical Documentation Policy', category: 'Clinical', ack: true },
  { code: 'POL_BOUNDARIES', title: 'Professional Boundaries Policy', category: 'Clinical', ack: true },
  { code: 'POL_SOCIAL_MEDIA', title: 'Social Media Policy', category: 'Policies', ack: true },
  { code: 'POL_TELEHEALTH', title: 'Telehealth Policy', category: 'Clinical', ack: true },
  { code: 'POL_HOME_VISIT', title: 'Home Visit & Community Work Safety Policy', category: 'WHS', ack: true },
  { code: 'POL_LONE_WORKER', title: 'Lone Worker Policy', category: 'WHS', ack: true },
  { code: 'POL_VEHICLE', title: 'Vehicle and Travel Policy', category: 'Vehicle / Travel', ack: true },
  { code: 'POL_INFECTION', title: 'Infection Prevention and Control Policy', category: 'WHS', ack: true },
  { code: 'POL_EMERGENCY', title: 'Emergency and Disaster Management Policy', category: 'WHS', ack: true },
  { code: 'POL_PARTICIPANT_RIGHTS', title: 'Participant Rights, Choice and Control', category: 'NDIS', ack: true },
  { code: 'POL_LEAVE', title: 'Leave and Attendance Policy', category: 'Employment', ack: false },
  { code: 'POL_EXPENSES', title: 'Expenses and Reimbursement Policy', category: 'Employment', ack: false },
  { code: 'POL_SUPERVISION', title: 'Supervision, Performance and CPD Policy', category: 'Professional Registration', ack: true },
  { code: 'POL_INJURY_MANAGEMENT', title: 'Injury Management System — information for workers', category: 'WHS', ack: true,
    complianceCode: 'WA_INJURY_MANAGEMENT_SYSTEM',
    description: 'Required by s.159 of the Workers Compensation and Injury Management Act 2023 (WA) to be described in a '
      + 'document available to workers, with the content prescribed by regulation 73 — including the named person '
      + 'responsible and their contact details.' },
  { code: 'DOC_HANDBOOK', title: 'Welcome to Opal Therapy — Employee Handbook', category: 'Employment', ack: false,
    description: 'Structure seeded; content required. Sections: Welcome · About Opal · Values · Team structure · How we work · '
      + 'Participant-centred practice · Communication · Work hours · Leave · Payroll · Travel · Rural visits · Expenses · '
      + 'Systems · Portal · Email · Calendar · Clinical documentation · Supervision · CPD · Safety · Incident escalation · '
      + 'Complaints · Emergency contacts · Key people.' },
  { code: 'DOC_WELCOME', title: 'Welcome to Opal Therapy', category: 'Employment', ack: false,
    description: 'The first page a new starter sees. Rendered from their own onboarding record — role, start date, '
      + 'contact person and what they need to complete — rather than a static flyer.' },
  // Phase 2 pack documents: templates the practice writes, uploaded through
  // the library like every other Opal document, sent in the pack and returned signed.
  { code: 'DOC_CONTRACT_TEMPLATE', title: 'Contract of Employment', category: 'Employment', ack: false,
    description: 'The contract template. Sent in the onboarding pack; the signed copy comes back with it.' },
  { code: 'DOC_NEW_EMPLOYEE_DETAILS', title: 'New Employee Details Form', category: 'Employment', ack: false,
    description: 'Personal, emergency contact and bank details on one form, returned with the pack.' },
];

// ═════════════════════════════════════════════════════════════════════════════
//  3. REQUIREMENT TEMPLATES — the reusable building blocks
// ═════════════════════════════════════════════════════════════════════════════

const R = {
  ALL: {},
  CASUAL: { fact: 'employment_type', op: 'eq', value: 'casual' },
  FIXED_TERM: { fact: 'employment_type', op: 'eq', value: 'fixed_term' },
  OT: { fact: 'role_category', op: 'eq', value: 'occupational_therapist' },
  CHILD_RELATED: { fact: 'child_related_work', op: 'in', value: ['yes', 'assessment_required'] },
  MOBILE: { fact: 'mobile_community_role', op: 'is_true' },
  OWN_VEHICLE: { fact: 'uses_own_vehicle', op: 'is_true' },
  SCREENING: { fact: 'requires_worker_screening', op: 'is_true' },
  REGISTERED_PROVIDER: { fact: 'provider_status', op: 'eq', value: 'registered' },
  PARTICIPANT_FACING: { fact: 'works_with_participants', op: 'is_true' },
};

const REQUIREMENT_TEMPLATES = [
  // ── Welcome & employment ────────────────────────────────────────────────
  {
    code: 'REQ_WELCOME', title: 'Welcome to Opal Therapy', section: 'welcome_employment',
    classification: 'OPAL_FORM', handler: 'info', actor: 'employee',
    summary: 'Your role, start date, who to contact and what onboarding involves.',
    documentCode: 'DOC_WELCOME', mandatory: true, blocksActivation: false, sortHint: 10,
    applicability: R.ALL,
  },
  {
    code: 'REQ_PRIVACY_NOTICE', title: 'Privacy collection notice', section: 'welcome_employment',
    classification: 'ACKNOWLEDGEMENT', handler: 'document_ack', actor: 'employee',
    summary: 'What Opal collects during onboarding, why, and how it is protected.',
    instructions: 'Please read this before providing any personal information. It explains what we collect, '
      + 'why we need it, who we may share it with, and how you can access or correct it.',
    documentCode: 'POL_COLLECTION_NOTICE', complianceCode: 'PRIVACY_APP5_NOTICE',
    mandatory: true, blocksActivation: true, sortHint: 5, applicability: R.ALL,
  },
  {
    code: 'REQ_CONTRACT', title: 'Employment contract', section: 'welcome_employment',
    classification: 'OPAL_POLICY', handler: 'document_ack', actor: 'both',
    summary: 'Read and electronically acknowledge your employment contract.',
    requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.ALL,
    config: { requiresTypedName: true, employerCountersignature: true },
  },
  {
    code: 'REQ_POSITION_DESCRIPTION', title: 'Position description', section: 'welcome_employment',
    classification: 'OPAL_POLICY', handler: 'document_ack', actor: 'employee',
    summary: 'Read and acknowledge the position description for your role.',
    mandatory: true, blocksActivation: true, sortHint: 30, applicability: R.ALL,
  },
  {
    code: 'REQ_FWIS', title: 'Fair Work Information Statement', section: 'welcome_employment',
    classification: 'OFFICIAL_DOCUMENT', handler: 'document_ack', actor: 'employee',
    summary: 'The statement every new employee must receive.',
    documentCode: 'DOC_FWIS', complianceCode: 'FWIS',
    mandatory: true, blocksActivation: true, sortHint: 40, applicability: R.ALL,
    config: { recordIssuance: true, statementCode: 'FWIS' },
  },
  {
    code: 'REQ_CEIS', title: 'Casual Employment Information Statement', section: 'welcome_employment',
    classification: 'OFFICIAL_DOCUMENT', handler: 'document_ack', actor: 'employee',
    summary: 'Required for casual employees, at commencement and at intervals afterwards.',
    documentCode: 'DOC_CEIS', complianceCode: 'CEIS',
    mandatory: true, blocksActivation: true, sortHint: 50, applicability: R.CASUAL,
    config: { recordIssuance: true, statementCode: 'CEIS', recurring: true },
  },
  {
    code: 'REQ_FTCIS', title: 'Fixed Term Contract Information Statement', section: 'welcome_employment',
    classification: 'OFFICIAL_DOCUMENT', handler: 'document_ack', actor: 'employee',
    summary: 'Required whenever a fixed term contract is entered into, including renewals.',
    documentCode: 'DOC_FTCIS', complianceCode: 'FTCIS',
    mandatory: true, blocksActivation: true, sortHint: 60, applicability: R.FIXED_TERM,
    config: { recordIssuance: true, statementCode: 'FTCIS', electronicDeliveryRequiresAgreement: true },
  },
  {
    code: 'REQ_HANDBOOK', title: 'Employee handbook', section: 'welcome_employment',
    classification: 'OPAL_POLICY', handler: 'document_ack', actor: 'employee',
    summary: 'How Opal works day to day.',
    documentCode: 'DOC_HANDBOOK',
    mandatory: false, blocksActivation: false, sortHint: 70, applicability: R.ALL,
  },
  {
    code: 'REQ_INJURY_INFO', title: 'Workplace injury and workers compensation information', section: 'welcome_employment',
    classification: 'ACKNOWLEDGEMENT', handler: 'document_ack', actor: 'employee',
    summary: 'How to report an injury, who to notify, and how injury management works.',
    instructions: 'This explains your right to claim, what Opal will do, and who is responsible for injury '
      + 'management. You are not asked to provide any insurance document — workers compensation cover is '
      + 'Opal\'s obligation, not yours.',
    documentCode: 'POL_INJURY_MANAGEMENT', complianceCode: 'WA_INJURY_MANAGEMENT_SYSTEM',
    mandatory: true, blocksActivation: false, sortHint: 80, applicability: R.ALL,
  },

  // ── Personal details ────────────────────────────────────────────────────
  {
    code: 'REQ_PERSONAL_DETAILS', title: 'Personal details', section: 'personal_details',
    classification: 'OPAL_FORM', handler: 'form', actor: 'employee', formKey: 'personal_details',
    summary: 'Your legal name, date of birth and contact details.',
    sensitivity: 'sensitive',
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.ALL,
  },
  {
    code: 'REQ_EMERGENCY_CONTACT', title: 'Emergency contact', section: 'personal_details',
    classification: 'OPAL_FORM', handler: 'form', actor: 'employee', formKey: 'emergency_contact',
    summary: 'Who we should contact in an emergency.',
    sensitivity: 'sensitive',
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.ALL,
  },

  // ── Payroll, tax and super ──────────────────────────────────────────────
  {
    code: 'REQ_BANK_DETAILS', title: 'Bank details for pay', section: 'payroll_tax_super',
    classification: 'OPAL_FORM', handler: 'form', actor: 'employee', formKey: 'bank_details',
    summary: 'Where your pay should be deposited.',
    instructions: 'These details are encrypted and visible only to payroll-authorised staff. After you save '
      + 'them, only the last four digits are ever displayed.',
    sensitivity: 'restricted',
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.ALL,
  },
  {
    code: 'REQ_TAX_SETUP', title: 'Tax details', section: 'payroll_tax_super',
    classification: 'OPAL_FORM', handler: 'form', actor: 'both', formKey: 'tax_setup',
    summary: 'Your tax file number declaration details.',
    instructions: 'You can complete this here, or complete the ATO\'s online commencement forms through myGov '
      + 'and give us the summary. If you have no tax file number, or are exempt from quoting one, the ATO '
      + 'requires the paper form — tell us and we will arrange it.',
    complianceCode: 'ATO_COMMENCEMENT', sensitivity: 'restricted',
    requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 20, dueOffsetDays: 28, applicability: R.ALL,
    config: { atoDeadlineDays: 28 },
  },
  {
    code: 'REQ_SUPER_SETUP', title: 'Superannuation fund', section: 'payroll_tax_super',
    classification: 'OPAL_FORM', handler: 'form', actor: 'both', formKey: 'super_setup',
    summary: 'Choose the super fund your contributions should go to.',
    instructions: 'If you do not nominate a fund, we will ask the ATO whether you have a stapled fund that '
      + 'follows you between jobs. Super now has to reach your fund within days of each payday, so settling '
      + 'this before your first pay matters.',
    complianceCode: 'ATO_SUPER_CHOICE', sensitivity: 'sensitive',
    requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 30, applicability: R.ALL,
  },
  {
    code: 'REQ_STAPLED_SUPER', title: 'Stapled super fund determination', section: 'payroll_tax_super',
    classification: 'EMPLOYER_ONLY_COMPLIANCE', handler: 'employer_task', actor: 'employer',
    summary: 'Request the employee\'s stapled fund from the ATO where they have not nominated one.',
    complianceCode: 'ATO_STAPLED_SUPER',
    mandatory: false, blocksActivation: false, sortHint: 40, applicability: R.ALL,
  },
  {
    code: 'REQ_PAYROLL_SETUP', title: 'Payroll setup', section: 'payroll_tax_super',
    classification: 'EMPLOYER_ONLY_COMPLIANCE', handler: 'employer_task', actor: 'employer',
    summary: 'Configure the employee in payroll before their first pay run.',
    complianceCode: 'PAYDAY_SUPER',
    mandatory: true, blocksActivation: false, sortHint: 50, applicability: R.ALL,
  },

  // ── Identity and work rights ────────────────────────────────────────────
  {
    code: 'REQ_IDENTITY', title: 'Identity verification', section: 'identity',
    classification: 'EMPLOYER_VERIFICATION', handler: 'form', actor: 'both', formKey: 'identity',
    summary: 'Confirm your identity so we can complete your employment records.',
    instructions: 'Tell us which document you will present. In most cases we will sight it and record the '
      + 'details rather than keep a copy — that is both what the regulators prefer and less of your personal '
      + 'information for us to hold.',
    sensitivity: 'restricted', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.ALL,
    config: { preferSighting: true, copyRequiresReason: true },
  },
  {
    code: 'REQ_RIGHT_TO_WORK', title: 'Right to work in Australia', section: 'identity',
    classification: 'EMPLOYER_VERIFICATION', handler: 'form', actor: 'both', formKey: 'right_to_work',
    summary: 'Confirm your entitlement to work in Australia.',
    instructions: 'Australian citizens and permanent residents provide evidence of that status. Visa holders '
      + 'consent to an online work-rights check — a tax file number, Medicare card or driver licence is not '
      + 'enough on its own.',
    complianceCode: 'VEVO_WORK_RIGHTS', sensitivity: 'restricted', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.ALL,
    config: { vevoRequiresConsent: true, retainResultPdf: true },
    expiryRule: { hasExpiry: true, source: 'work_rights', reminderDays: [90, 60, 30, 7] },
  },

  // ── Professional credentials (OT overlay) ───────────────────────────────
  {
    code: 'REQ_AHPRA', title: 'Ahpra registration', section: 'professional',
    classification: 'EMPLOYER_VERIFICATION', handler: 'credential', actor: 'both',
    credentialType: 'ahpra_registration',
    summary: 'Your registration as an occupational therapist.',
    instructions: 'Enter your Ahpra registration number. We verify it against the public Register of '
      + 'Practitioners — a screenshot is not sufficient.',
    complianceCode: 'AHPRA_REGISTRATION', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.OT,
    expiryRule: { hasExpiry: true, source: 'credential', reminderDays: [90, 60, 30, 7], renewalMonthDay: '11-30' },
    config: { verificationUrl: 'https://www.ahpra.gov.au/registration/registers-of-practitioners.aspx', lateePeriodAware: true },
  },
  {
    code: 'REQ_QUALIFICATION', title: 'Occupational therapy qualification', section: 'professional',
    classification: 'EMPLOYEE_UPLOAD', handler: 'credential', actor: 'both',
    credentialType: 'qualification',
    summary: 'Your occupational therapy degree, institution and completion year.',
    complianceCode: 'NDIS_VERIFICATION_EVIDENCE', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.OT,
    config: { allowMultiple: true, requiresEvidence: true },
  },
  {
    code: 'REQ_PII', title: 'Professional indemnity arrangements', section: 'professional',
    classification: 'EMPLOYER_VERIFICATION', handler: 'credential', actor: 'both',
    credentialType: 'professional_indemnity',
    summary: 'Confirm the professional indemnity arrangement that covers your practice.',
    instructions: 'This may be Opal\'s cover, your own policy, or a combination. We record which arrangement '
      + 'applies and check it against the Board\'s standard — we do not simply assume our policy covers you.',
    complianceCode: 'OT_PII', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 30, applicability: R.OT,
    expiryRule: { hasExpiry: true, source: 'credential', reminderDays: [90, 60, 30, 7] },
    config: {
      arrangements: ['employer_policy', 'own_policy', 'combined', 'other_compliant'],
    },
  },
  {
    code: 'REQ_CPD_SETUP', title: 'Continuing professional development', section: 'professional',
    classification: 'EMPLOYEE_UPLOAD', handler: 'info', actor: 'employee',
    summary: 'How CPD is recorded in the portal, and what the Board requires each registration year.',
    complianceCode: 'OT_CPD',
    mandatory: false, blocksActivation: false, sortHint: 40, applicability: R.OT,
    config: { linksTo: 'profile_cpd' },
  },

  // ── Screening ───────────────────────────────────────────────────────────
  {
    code: 'REQ_NDIS_SCREENING', title: 'NDIS Worker Screening Check', section: 'screening',
    classification: 'EMPLOYER_VERIFICATION', handler: 'credential', actor: 'both',
    credentialType: 'ndis_worker_screening',
    summary: 'Your NDIS worker screening clearance or application details.',
    instructions: 'Provide your clearance or application number and the state that issued it. We verify your '
      + 'status directly in the NDIS Worker Screening Database and link you to Opal — we do not rely on an '
      + 'uploaded certificate, because a clearance can be suspended or revoked at any time.',
    complianceCode: 'NDIS_WORKER_SCREENING', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.SCREENING,
    expiryRule: { hasExpiry: true, source: 'credential', reminderDays: [90, 60, 30, 7], validityYears: 5 },
    config: {
      databaseVerificationOnly: true,
      statuses: ['clearance', 'pending', 'interim_bar', 'exclusion', 'suspension', 'no_valid_clearance'],
      waApplyUrl: 'https://www.wa.gov.au/organisation/department-of-communities/ndis-worker-screening-check',
    },
  },
  {
    code: 'REQ_WWCC', title: 'Working with Children Check (WA)', section: 'screening',
    classification: 'EMPLOYER_VERIFICATION', handler: 'credential', actor: 'both',
    credentialType: 'wwcc',
    summary: 'Your WA Working with Children Check card details.',
    instructions: 'Provide your card or application number and family name. We validate it with the WA '
      + 'Screening Unit and register you so we are notified if your card status changes.',
    complianceCode: 'WWCC_WA', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.CHILD_RELATED,
    expiryRule: { hasExpiry: true, source: 'credential', reminderDays: [90, 60, 30, 7], validityYears: 3 },
    config: {
      noCardNumberFormat: true,
      validationUrl: 'https://www.workingwithchildren.wa.gov.au/card-validation',
      employerRegistrationUrl: 'https://www.workingwithchildren.wa.gov.au/registeremployees',
    },
  },
  {
    code: 'REQ_POLICE_CHECK', title: 'National Police Check', section: 'screening',
    classification: 'EMPLOYEE_UPLOAD', handler: 'credential', actor: 'both',
    credentialType: 'police_check',
    summary: 'A National Police Certificate, where Opal requires one for the role.',
    instructions: 'This is an Opal organisational requirement for this role, not a general legal requirement '
      + 'for NDIS or health workers.',
    complianceCode: 'NATIONAL_POLICE_CHECK', requiresEmployerVerification: true,
    mandatory: false, blocksActivation: false, sortHint: 30, applicability: R.ALL,
  },
  {
    code: 'REQ_DRIVERS_LICENCE', title: 'Driver licence', section: 'screening',
    classification: 'EMPLOYEE_UPLOAD', handler: 'credential', actor: 'both',
    credentialType: 'drivers_licence',
    summary: 'Your driver licence, for community and home-visit work.',
    complianceCode: null, requiresEmployerVerification: true,
    mandatory: true, blocksActivation: true, sortHint: 40, applicability: R.MOBILE,
    expiryRule: { hasExpiry: true, source: 'credential', reminderDays: [90, 60, 30, 7] },
  },
  {
    code: 'REQ_VEHICLE', title: 'Vehicle details and insurance', section: 'screening',
    classification: 'OPAL_FORM', handler: 'form', actor: 'both', formKey: 'vehicle_details',
    summary: 'Your vehicle registration and confirmation of appropriate insurance.',
    requiresEmployerVerification: true,
    mandatory: true, blocksActivation: false, sortHint: 50, applicability: R.OWN_VEHICLE,
    expiryRule: { hasExpiry: true, source: 'requirement', reminderDays: [60, 30, 7] },
  },

  // ── NDIS essentials ─────────────────────────────────────────────────────
  {
    code: 'REQ_NDIS_CODE', title: 'NDIS Code of Conduct', section: 'ndis',
    classification: 'ACKNOWLEDGEMENT', handler: 'document_ack', actor: 'employee',
    summary: 'The Code that binds every worker delivering NDIS supports.',
    documentCode: 'DOC_NDIS_CODE_GUIDANCE', complianceCode: 'NDIS_CODE_OF_CONDUCT',
    mandatory: true, blocksActivation: true, sortHint: 10, applicability: R.ALL,
  },
  {
    code: 'REQ_NDIS_ORIENTATION', title: 'NDIS Worker Orientation Module — Quality, Safety and You', section: 'ndis',
    classification: 'TRAINING_MODULE', handler: 'training', actor: 'both',
    summary: 'The NDIS Commission\'s worker orientation module.',
    instructions: 'Complete the module on the NDIS Commission\'s own site, then upload your certificate here.',
    externalUrl: 'https://www.ndiscommission.gov.au/workforce/online-training-modules',
    complianceCode: 'NDIS_WORKER_ORIENTATION', requiresEmployerVerification: true,
    mandatory: true, blocksActivation: false, sortHint: 20, applicability: R.PARTICIPANT_FACING,
    config: { external: true, evidenceRequired: true },
  },
  {
    code: 'REQ_NDIS_INDUCTION', title: 'New worker NDIS induction modules', section: 'ndis',
    classification: 'TRAINING_MODULE', handler: 'training', actor: 'both',
    summary: 'The Commission\'s induction series for workers new to the disability sector.',
    externalUrl: 'https://training.ndiscommission.gov.au/course/index.php?categoryid=3',
    complianceCode: 'NDIS_NEW_WORKER_INDUCTION',
    mandatory: false, blocksActivation: false, sortHint: 30, applicability: R.PARTICIPANT_FACING,
    config: { external: true, evidenceRequired: true },
  },

  // ── Opal policies (generated per policy in the seeder) ───────────────────

  // ── Training ────────────────────────────────────────────────────────────
  {
    code: 'REQ_OPAL_INDUCTION', title: 'Opal induction', section: 'training',
    classification: 'TRAINING_MODULE', handler: 'training', actor: 'employee',
    summary: 'Your Opal Therapy induction pathway.',
    instructions: 'This is assigned to you in My Learning. It completes here automatically when you finish it.',
    mandatory: true, blocksActivation: false, sortHint: 10, applicability: R.ALL,
    config: { learningIntegration: true },
  },
  {
    code: 'REQ_WHS_INDUCTION', title: 'Work health and safety induction', section: 'training',
    classification: 'TRAINING_MODULE', handler: 'training', actor: 'employee',
    summary: 'Safety induction covering your work environment and how to raise a hazard.',
    complianceCode: 'WA_WHS_INDUCTION',
    mandatory: true, blocksActivation: true, sortHint: 20, applicability: R.ALL,
    config: { learningIntegration: true },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
//  4. PACKAGES — a base, role/type overlays, and the six seeded packages
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Composition, not duplication. The six assignable packages below hold almost
 * no requirements of their own — they inherit a base plus the overlays that
 * apply, so adding a requirement to every new starter is one edit to the base
 * rather than six edits that can drift apart.
 */
const PACKAGE_BASE = {
  code: 'PKG_BASE_EMPLOYEE', title: 'Base Employee Package', kind: 'base',
  description: 'Every Opal employee, regardless of role or employment type.',
  requirements: [
    'REQ_PRIVACY_NOTICE', 'REQ_WELCOME', 'REQ_CONTRACT', 'REQ_POSITION_DESCRIPTION',
    'REQ_FWIS', 'REQ_HANDBOOK', 'REQ_INJURY_INFO',
    'REQ_PERSONAL_DETAILS', 'REQ_EMERGENCY_CONTACT',
    'REQ_BANK_DETAILS', 'REQ_TAX_SETUP', 'REQ_SUPER_SETUP',
    'REQ_STAPLED_SUPER', 'REQ_PAYROLL_SETUP',
    'REQ_IDENTITY', 'REQ_RIGHT_TO_WORK',
    'REQ_NDIS_CODE',
    'REQ_OPAL_INDUCTION', 'REQ_WHS_INDUCTION',
  ],
};

const PACKAGE_OVERLAYS = [
  {
    code: 'PKG_OVL_CASUAL', title: 'Casual Employee Overlay', kind: 'overlay',
    description: 'Adds the Casual Employment Information Statement.',
    employmentType: 'casual', requirements: ['REQ_CEIS'],
  },
  {
    code: 'PKG_OVL_FIXED_TERM', title: 'Fixed-Term Employee Overlay', kind: 'overlay',
    description: 'Adds the Fixed Term Contract Information Statement.',
    employmentType: 'fixed_term', requirements: ['REQ_FTCIS'],
  },
  {
    code: 'PKG_OVL_OT', title: 'Occupational Therapist Overlay', kind: 'overlay',
    description: 'Registration, qualification, professional indemnity and CPD.',
    roleCategory: 'occupational_therapist',
    requirements: ['REQ_AHPRA', 'REQ_QUALIFICATION', 'REQ_PII', 'REQ_CPD_SETUP'],
  },
  {
    code: 'PKG_OVL_ADMIN', title: 'Administration Overlay', kind: 'overlay',
    description: 'Administration roles. Deliberately carries no clinical or driver requirements.',
    roleCategory: 'administration', requirements: [],
  },
  {
    code: 'PKG_OVL_CHILD_RELATED', title: 'Child-Related Worker Overlay', kind: 'overlay',
    description: 'Working with Children Check, where the role\'s usual duties involve contact with children.',
    requirements: ['REQ_WWCC'],
  },
  {
    code: 'PKG_OVL_MOBILE', title: 'Mobile / Community Worker Overlay', kind: 'overlay',
    description: 'Driver licence, vehicle and community-safety requirements.',
    requirements: ['REQ_DRIVERS_LICENCE', 'REQ_VEHICLE'],
  },
  {
    code: 'PKG_OVL_NDIS_RISK', title: 'NDIS Risk-Assessed Role Overlay', kind: 'overlay',
    description: 'Worker screening and NDIS orientation for participant-facing roles.',
    requirements: ['REQ_NDIS_SCREENING', 'REQ_NDIS_ORIENTATION', 'REQ_NDIS_INDUCTION'],
  },
  {
    code: 'PKG_OVL_POLICE', title: 'Police Check Overlay', kind: 'overlay',
    description: 'Adds a National Police Check where Opal requires one for the role.',
    requirements: ['REQ_POLICE_CHECK'],
  },
];

const PACKAGES = [
  {
    code: 'PKG_OT_FULL_TIME', title: 'Occupational Therapist — Full-Time',
    roleCategory: 'occupational_therapist', employmentType: 'full_time',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_OT', 'PKG_OVL_CHILD_RELATED', 'PKG_OVL_MOBILE', 'PKG_OVL_NDIS_RISK'],
  },
  {
    code: 'PKG_OT_PART_TIME', title: 'Occupational Therapist — Part-Time',
    roleCategory: 'occupational_therapist', employmentType: 'part_time',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_OT', 'PKG_OVL_CHILD_RELATED', 'PKG_OVL_MOBILE', 'PKG_OVL_NDIS_RISK'],
  },
  {
    code: 'PKG_OT_CASUAL', title: 'Occupational Therapist — Casual',
    roleCategory: 'occupational_therapist', employmentType: 'casual',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_CASUAL', 'PKG_OVL_OT', 'PKG_OVL_CHILD_RELATED', 'PKG_OVL_MOBILE', 'PKG_OVL_NDIS_RISK'],
  },
  {
    code: 'PKG_OT_FIXED_TERM', title: 'Occupational Therapist — Fixed-Term',
    roleCategory: 'occupational_therapist', employmentType: 'fixed_term',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_FIXED_TERM', 'PKG_OVL_OT', 'PKG_OVL_CHILD_RELATED', 'PKG_OVL_MOBILE', 'PKG_OVL_NDIS_RISK'],
  },
  {
    code: 'PKG_ADMIN_PERMANENT', title: 'Administration — Permanent',
    roleCategory: 'administration', employmentType: 'full_time',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_ADMIN'],
  },
  {
    code: 'PKG_ADMIN_CASUAL', title: 'Administration — Casual',
    roleCategory: 'administration', employmentType: 'casual',
    extends: ['PKG_BASE_EMPLOYEE', 'PKG_OVL_CASUAL', 'PKG_OVL_ADMIN'],
  },
];

/** Organisational compliance records the Owner should hold, seeded empty. */
const ORG_COMPLIANCE_SLOTS = [
  { recordType: 'workers_compensation', title: 'Workers Compensation Insurance', complianceCode: 'WA_WORKERS_COMPENSATION' },
  { recordType: 'public_liability', title: 'Public Liability Insurance' },
  { recordType: 'professional_indemnity', title: 'Organisational Professional Indemnity Insurance', complianceCode: 'OT_PII' },
  { recordType: 'ndis_registration', title: 'NDIS Provider Registration' },
];

module.exports = {
  DEFAULT_SETTINGS,
  COMPLIANCE_SOURCES,
  OFFICIAL_DOCUMENTS,
  OPAL_POLICIES,
  REQUIREMENT_TEMPLATES,
  PACKAGE_BASE,
  PACKAGE_OVERLAYS,
  PACKAGES,
  ORG_COMPLIANCE_SLOTS,
  RULES: R,
};
