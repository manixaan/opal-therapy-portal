'use strict';

/**
 * Builds onboarding-templates/stage2/contract-of-employment.docx — the
 * Contract of Employment master — from the wording below.
 *
 * The package shell (styles, numbering, theme, letterhead image, headers and
 * footers) is the Letter of Offer template, so the two documents share Opal's
 * styling exactly. Every person-specific value is a Word content control
 * tagged OPAL_COE_*, filled by onboarding-contract-docx.js.
 *
 *   node scripts/build-contract-template.js        (from backend/)
 *
 * Re-run after changing the wording here. A practice that edits the .docx in
 * Word instead keeps the controls and uploads it in Edit Onboarding.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const SHELL = path.join(__dirname, '..', 'onboarding-templates', 'letter-of-offer-v1.docx');
const OUT = path.join(__dirname, '..', 'onboarding-templates', 'stage2', 'contract-of-employment.docx');
const DOCUMENT_CODE = 'OPAL-COE-2026-001';

// ── A tiny WordprocessingML DSL ─────────────────────────────────────────────

const ALIASES = {
  DATE: 'CONTRACT DATE', EMPLOYEE_FULL_NAME: 'EMPLOYEE FULL NAME', EMPLOYEE_FIRST_NAME: 'EMPLOYEE FIRST NAME',
  EMPLOYEE_EMAIL: 'EMPLOYEE EMAIL', POSITION_TITLE: 'POSITION TITLE', EMPLOYMENT_BASIS: 'EMPLOYMENT BASIS',
  EMPLOYMENT_BASIS_LOWER: 'EMPLOYMENT BASIS (LOWER CASE)', COMMENCEMENT_DATE: 'COMMENCEMENT DATE',
  WORK_LOCATION: 'WORK LOCATION', REPORTS_TO: 'REPORTS TO', HOURS_DESCRIPTION: 'ORDINARY HOURS', AWARD: 'MODERN AWARD',
  CLASSIFICATION: 'CLASSIFICATION', REMUNERATION_LABEL: 'REMUNERATION LABEL', REMUNERATION: 'REMUNERATION',
  SUPERANNUATION: 'SUPERANNUATION', PAY_CYCLE: 'PAY CYCLE', PAY_CYCLE_LOWER: 'PAY CYCLE (LOWER CASE)',
  PROBATION: 'PROBATIONARY PERIOD', PROBATION_PERIOD: 'PROBATION LENGTH', CPD_ALLOWANCE: 'CPD ALLOWANCE',
  ADDITIONAL_TERMS: 'ADDITIONAL TERMS', SIGNATORY_NAME: 'SIGNATORY NAME', SIGNATORY_TITLE: 'SIGNATORY TITLE',
  SIGNATORY_EMAIL: 'SIGNATORY EMAIL', SIGNATORY_PHONE: 'SIGNATORY PHONE',
};

let sdtId = 81000;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A field: F('POSITION_TITLE') → a content control tagged OPAL_COE_POSITION_TITLE. */
const F = (name, bold) => ({ field: name, bold: !!bold });
const B = (text) => ({ text, bold: true });

function run(text, bold) {
  return `<w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
function control(name, bold) {
  if (!ALIASES[name]) throw new Error(`Unknown field ${name}`);
  sdtId += 1;
  return `<w:sdt><w:sdtPr><w:tag w:val="OPAL_COE_${name}"/><w:alias w:val="PORTAL — ${ALIASES[name]}"/><w:id w:val="${sdtId}"/><w:text/></w:sdtPr>`
    + `<w:sdtContent>${run(`[PORTAL — ${ALIASES[name]}]`, bold)}</w:sdtContent></w:sdt>`;
}
function inline(parts) {
  return parts.map((part) => {
    if (typeof part === 'string') return run(part);
    if (part.field) return control(part.field, part.bold);
    return run(part.text, part.bold);
  }).join('');
}
const para = (style, parts, pPrExtra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${pPrExtra}</w:pPr>${inline(parts)}</w:p>`;
const JUSTIFY = '<w:jc w:val="both"/>';
const h1 = (...parts) => para('OPALHeading1', parts);
const h2 = (...parts) => para('OPALHeading2', parts, JUSTIFY);
const p = (...parts) => para('OPALBody', parts, JUSTIFY);
const left = (...parts) => para('OPALBody', parts);
const li = (...parts) => para('OPALBullet', parts, `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="27"/></w:numPr>${JUSTIFY}`);
const blank = () => '<w:p><w:pPr><w:pStyle w:val="OPALBody"/></w:pPr></w:p>';
const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

const CELL_MAR = '<w:tcMar><w:top w:w="95" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="95" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar><w:vAlign w:val="center"/>';
function table(rows) {
  const tr = rows.map(([label, value]) => '<w:tr>'
    + `<w:tc><w:tcPr><w:tcW w:w="3506" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="2F5651" w:themeFill="accent1"/>${CELL_MAR}</w:tcPr>${para('OPALTableHeader', [].concat(label))}</w:tc>`
    + `<w:tc><w:tcPr><w:tcW w:w="6558" w:type="dxa"/>${CELL_MAR}</w:tcPr>${para('OPALTableBody', [].concat(value))}</w:tc>`
    + '</w:tr>').join('');
  return '<w:tbl><w:tblPr><w:tblW w:w="10064" w:type="dxa"/><w:tblInd w:w="-8" w:type="dxa"/><w:tblBorders>'
    + '<w:top w:val="single" w:sz="6" w:space="0" w:color="BFCDCE" w:themeColor="accent3"/><w:left w:val="single" w:sz="6" w:space="0" w:color="BFCDCE" w:themeColor="accent3"/>'
    + '<w:bottom w:val="single" w:sz="6" w:space="0" w:color="BFCDCE" w:themeColor="accent3"/><w:right w:val="single" w:sz="6" w:space="0" w:color="BFCDCE" w:themeColor="accent3"/>'
    + '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="D9E2DE"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="D9E2DE"/></w:tblBorders>'
    + '<w:tblLayout w:type="fixed"/><w:tblLook w:val="0480" w:firstRow="0" w:lastRow="0" w:firstColumn="1" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>'
    + `<w:tblGrid><w:gridCol w:w="3506"/><w:gridCol w:w="6558"/></w:tblGrid>${tr}</w:tbl>`;
}

// ── The contract ────────────────────────────────────────────────────────────

function body() {
  const POSITION = F('POSITION_TITLE');
  const PROBATION = F('PROBATION_PERIOD');
  return [
    left(F('DATE')),
    left(F('EMPLOYEE_FULL_NAME', true), { text: '' }),
    left(F('EMPLOYEE_EMAIL')),
    h1('Contract of Employment — ', POSITION),
    p('Dear ', F('EMPLOYEE_FIRST_NAME'), ','),
    p('This Contract of Employment (the Contract) is made on ', F('DATE'), ' between Opal Therapy Pty Ltd (the Company) and ', F('EMPLOYEE_FULL_NAME'),
      ' (you). It follows your Letter of Offer and sets out the full terms and conditions of your employment as ', POSITION,
      '. If this Contract and the Letter of Offer differ, this Contract prevails.'),

    h2('Particulars of Employment'),
    p('The following table sets out the particulars of your employment. The numbered clauses and the Schedules that follow apply to them.'),
    table([
      ['Position Title', POSITION],
      ['Employment Type', F('EMPLOYMENT_BASIS')],
      ['Commencement Date', F('COMMENCEMENT_DATE')],
      ['Work Location', F('WORK_LOCATION')],
      ['Reporting Line', F('REPORTS_TO')],
      ['Ordinary Hours of Work', F('HOURS_DESCRIPTION')],
      ['Applicable Modern Award', F('AWARD')],
      ['Classification', F('CLASSIFICATION')],
      [F('REMUNERATION_LABEL'), F('REMUNERATION')],
      ['Superannuation', F('SUPERANNUATION')],
      ['Pay Cycle', F('PAY_CYCLE')],
      ['Probationary Period', F('PROBATION')],
      ['CPD Allowance', F('CPD_ALLOWANCE')],
    ]),
    blank(),

    h2('1. Term and commencement'),
    p('Your employment commences on ', F('COMMENCEMENT_DATE'), ' (the Commencement Date) on a ', F('EMPLOYMENT_BASIS_LOWER'),
      ' basis, and continues until it is ended in accordance with this Contract. You must sign and return a copy of this Contract before you start work.'),

    h2('2. About Opal Therapy'),
    p('Opal Therapy provides occupational therapy services, largely to participants of the National Disability Insurance Scheme (NDIS). Our therapists travel to clients in their homes and communities, carry out assessments, recommend services and supports, and deliver ongoing therapy in line with each client’s plan.'),
    p('We are committed to a supportive workplace in which clinicians develop their skills, gain experience and contribute meaningfully to the lives of the people we serve.'),

    h2('3. Position and duties'),
    p('You are employed as ', POSITION, '. Your duties and responsibilities are described in Schedule 1. The Company may reasonably vary your duties, consistent with your skills and classification.'),
    p('You warrant that you hold the qualifications, registrations and licences needed for your role. You will perform your duties diligently, ethically and in accordance with the standards set by the Australian Health Practitioner Regulation Agency (AHPRA) and the Occupational Therapy Board of Australia, and as lawfully directed by the Company.'),
    p('You will provide services at client homes and community locations, at the Company’s premises, or by telehealth, as required.'),

    h2('4. Reporting'),
    p('You report to ', F('REPORTS_TO'), '. The Company may change your reporting line from time to time.'),
    p('Your contact for onboarding and for any question about this Contract is ', F('SIGNATORY_NAME'), ', ', F('SIGNATORY_TITLE'), ' — ', F('SIGNATORY_EMAIL'), ', ', F('SIGNATORY_PHONE'), '.'),

    h2('5. Your obligations'),
    p('You must:'),
    li('perform your duties in a diligent and professional manner, to the standards that normally apply to your profession;'),
    li('use your best efforts to meet reasonable deadlines set by the Company;'),
    li('keep current every registration, licence and clearance your role requires, and tell the Company immediately if any lapses, is made conditional, or is the subject of action to suspend or revoke it;'),
    li('not conduct yourself in a way that brings the Company into disrepute; and'),
    li('comply with all laws that apply to your work, including those about the provision of occupational therapy services, the NDIS, work health and safety, anti-discrimination and privacy.'),

    h2('6. Work location, travel and equipment'),
    p('Your work location is ', F('WORK_LOCATION'), ', together with any other location the Company reasonably directs, including client homes, hospitals, aged care facilities and community settings. Telehealth and administrative work may be done remotely where the Company approves.'),
    p('Your role involves travel between clients. You must hold a current driver’s licence and have the use of a reliable, registered and insured vehicle. The Company reimburses approved work travel in accordance with its travel policy and the Award.'),
    p('The Company provides the equipment you need for your role, which may include a laptop, software and system access, and therapy tools and resources. You must use Company equipment for work purposes only, keep it in good condition, report any loss, damage or fault immediately, and return it when your employment ends.'),

    h2('7. Professional requirements'),
    li(B('Registration. '), 'You must maintain current registration as an occupational therapist with the Occupational Therapy Board of Australia, through AHPRA, throughout your employment.'),
    li(B('Professional development. '), 'You will meet your continuing professional development (CPD) requirements and take part in training the Company reasonably directs.'),
    li(B('Professional membership. '), 'Membership of Occupational Therapy Australia is encouraged but is not a condition of your employment.'),
    li(B('Insurance. '), 'The Company maintains professional indemnity and public liability insurance covering the services you provide in the course of your employment.'),
    li(B('Work health and safety. '), 'You must follow the Company’s work health and safety policies, take reasonable care for your own safety and that of others, and report hazards, incidents and unsafe practices promptly.'),

    h2('8. Policies and conduct'),
    p('You must comply with the Company’s Code of Conduct, the NDIS Code of Conduct, and the Company’s policies and procedures as they stand from time to time. They are available through the Company’s systems and it is your responsibility to be familiar with them. The policies are not terms of this Contract, and the Company may change them; a failure to comply may nevertheless result in disciplinary action, up to and including termination.'),
    p('You must handle and store all client information in accordance with the Privacy Act 1988 (Cth), the requirements of the NDIS Quality and Safeguards Commission, and the Company’s privacy policy.'),
    p('The Company does not tolerate harassment, discrimination or bullying. You must help maintain a respectful and inclusive workplace and report any incident to a Director of the Company, who will deal with it in accordance with Company policy.'),

    h2('9. Probation and performance review'),
    p('The first ', PROBATION, ' of your employment, starting on the Commencement Date, is a probationary period. It allows both you and the Company to assess your suitability for the role.'),
    p('Your performance will be reviewed during, and at the end of, the probationary period in a meeting with your manager. The review considers, among other things:'),
    li('clinical competence in delivering occupational therapy services;'),
    li('adherence to professional and ethical standards, including AHPRA requirements;'),
    li('communication with clients, colleagues and stakeholders;'),
    li('management of your caseload, planning and documentation; and'),
    li('professional development and responsiveness to feedback.'),
    p('After the probationary period, your performance will be reviewed quarterly.'),

    h2('10. Supervision, development and progression'),
    p('You will receive clinical supervision and mentoring on an ongoing basis, including regular sessions with a qualified supervisor, structured feedback on cases and plans, and guidance on evidence-based practice. The Company will set the supervision hours for your role, consistent with the expectations of the Occupational Therapy Board of Australia.'),
    p('On successful completion of the probationary period your employment continues on the terms of this Contract. The Company will explain the pathway to more senior roles, which depends on your performance, demonstrated competencies and the availability of positions.'),

    h2('11. CPD allowance and repayment'),
    p('The Company supports your professional growth with an annual CPD allowance: ', F('CPD_ALLOWANCE'), '. It is for approved courses, workshops and certifications relevant to your role, and is subject to the Company’s prior approval of each expense.'),
    p('If your employment ends at your initiative, or for serious misconduct:'),
    li('during the probationary period — you agree to repay 100% of the CPD allowance paid in that period;'),
    li('after the probationary period but before you complete twelve (12) months of employment — you agree to repay 50% of the CPD allowance paid; and'),
    li('after twelve (12) months of employment — nothing is repayable.'),
    p('A repayment may be deducted from your final pay only where you have authorised it in writing and the law permits; otherwise it will be repaid under an arrangement agreed with you.'),

    h2('12. Hours of work'),
    p('Your ordinary hours are ', F('HOURS_DESCRIPTION'), ', with an unpaid meal break of 30 minutes each day.'),
    p('Flexible arrangements, including remote work and telehealth, may be agreed between you and the Company and adjusted to operational needs.'),
    p('You may be asked to work reasonable additional hours, including occasional work on weekends or outside normal hours to meet client needs. The Company will give reasonable notice where it can. Overtime, penalty rates and time off in lieu apply in accordance with the Award.'),

    h2('13. Remuneration, superannuation and leave'),
    p('Your remuneration and superannuation are set out in Schedule 2, and your leave entitlements in Schedule 3.'),

    h2('14. Conflict of interest and outside work'),
    p('During your employment you must not, without the Company’s prior written approval, engage in any other employment, business or professional activity that conflicts with your duties or competes with the Company, including providing similar services to clients in the same region.'),
    p('You must disclose any outside employment, business interest or affiliation that could create a conflict of interest or affect your ability to perform your duties, including freelance, consulting or ownership interests in healthcare or occupational therapy. The Company will assess each disclosure reasonably.'),

    h2('15. Restraints after your employment ends'),
    p('For six (6) months after your employment ends, you must not, directly or indirectly, solicit, approach or accept work from any client or prospective client of the Company with whom you dealt in the twelve (12) months before your employment ended, for the purpose of providing services similar to the Company’s.'),
    p('For six (6) months after your employment ends, you must not be engaged or employed in a business that competes directly with the Company within fifty (50) kilometres of any location at which you regularly provided services during your employment.'),
    p('You agree these restraints are reasonable and go no further than is needed to protect the Company’s legitimate interests in its client relationships and confidential information. Each restraint is separate; if any part is unenforceable, it is severed and the rest continues to apply.'),

    h2('16. Client records and Company property'),
    p('All client files, assessments, reports, records and documentation that you create, use or access during your employment, in any form, are and remain the property of the Company. When your employment ends you must not remove, copy or keep any of them, and you must return all Company property.'),

    h2('17. Confidentiality'),
    p('In this clause, Confidential Information means all information about the Company’s business and affairs that is not in the public domain — including trade secrets, know-how, client lists, prices, methods, intellectual property, and sales and marketing information — and any personal information held by the Company about any other person, including a client or supplier.'),
    p('You must not, during or after your employment, use or disclose Confidential Information except in the proper course of your duties, as required by law, or with the Company’s prior written consent. When your employment ends you must return or destroy, as the Company directs, all Confidential Information in your possession. This clause continues to apply after your employment ends.'),

    h2('18. Background checks'),
    p('Your employment is conditional on the satisfactory completion, and the continued currency, of:'),
    li('a National Police Check;'),
    li('a Working with Children Check;'),
    li('an NDIS Worker Screening Check;'),
    li('verification of your qualifications, professional registration and references; and'),
    li('confirmation of your right to work in Australia.'),
    p('You consent to the Company carrying out these checks. If any information you gave during recruitment is found to be false, misleading or incomplete, the Company may withdraw its offer or end your employment immediately.'),

    h2('19. Ending your employment'),
    li(B('During probation. '), 'Either you or the Company may end your employment during the probationary period by giving one (1) week’s written notice.'),
    li(B('After probation. '), 'Either you or the Company may end your employment by giving four (4) weeks’ written notice, or the minimum notice required by the Fair Work Act 2009 (Cth) or the Award, whichever is greater.'),
    li(B('Payment in lieu. '), 'The Company may pay you in lieu of all or part of a notice period.'),
    li(B('Serious misconduct. '), 'The Company may end your employment without notice for serious misconduct, including a serious breach of AHPRA professional standards, negligence or misconduct in client care, a serious breach of safety requirements, fraud, dishonesty or criminal conduct, or a serious breach of confidentiality or privacy obligations.'),

    h2('20. Notices'),
    p('A notice under this Contract must be in writing and may be given by email — to you at the email address you have given the Company, and to the Company at adminservices@opaltherapy.com.au. A notice sent by email is taken to be received on the day it is sent unless the sender receives a delivery failure message. Each party must tell the other promptly, in writing, if its contact details change.'),

    h2('21. General'),
    para('OPALBody', ['Additional terms agreed for your employment: ', F('ADDITIONAL_TERMS')], JUSTIFY),
    p('This Contract and your Letter of Offer are the whole agreement between you and the Company about your employment. This Contract may be varied only in writing signed by both parties. It is governed by the laws of Western Australia. Nothing in it reduces an entitlement you have under the Fair Work Act 2009 (Cth), the National Employment Standards or the Award. If any part of it is unenforceable, that part is severed and the rest continues to apply.'),

    h2('Acknowledgement and acceptance'),
    p('By signing this Contract you acknowledge that you have read and understood it, that you have had the opportunity to seek independent advice, and that you accept employment with the Company on its terms.'),
    left('Yours sincerely,'),
    blank(),
    left(F('SIGNATORY_NAME')),
    left(F('SIGNATORY_TITLE')),
    left('Opal Therapy Pty Ltd'),

    h1('Acceptance'),
    p('To be completed by ', F('EMPLOYEE_FULL_NAME'), ' and returned to the Company before the Commencement Date.'),
    p('I have read and understood this Contract of Employment, including its Schedules, and I accept employment with Opal Therapy Pty Ltd on its terms.'),
    table([['Full Name', F('EMPLOYEE_FULL_NAME')], ['Signature', ''], ['Date', '']]),
    pageBreak(),

    h1('Schedule 1 — Duties and responsibilities'),
    p('You are employed as ', POSITION, ' and are responsible for providing occupational therapy services to the Company’s clients, including NDIS participants.'),
    h2('Key responsibilities'),
    li('Conducting initial assessments and evaluations of clients’ physical, cognitive and psychosocial needs.'),
    li('Developing and implementing individualised therapy plans that support each client’s goals, recovery and independence.'),
    li('Providing therapy, including interventions for mobility, fine motor skills, sensory processing and activities of daily living.'),
    li('Educating and training clients, carers and family members in therapy techniques and strategies for use at home.'),
    li('Maintaining accurate client records, progress notes, reports and documentation in accordance with professional standards and privacy law.'),
    li('Complying with the Occupational Therapy Board of Australia’s Code of Conduct and ethical guidelines.'),
    li('Following workplace policies, work health and safety requirements and infection control procedures.'),
    h2('Performance expectations'),
    li('Maintain high professional standards in client care.'),
    li('Work effectively as part of a team.'),
    li('Demonstrate cultural sensitivity and client-centred practice.'),
    li('Uphold workplace policies and professional integrity at all times.'),

    h1('Schedule 2 — Remuneration and superannuation'),
    li(B('Remuneration. '), F('REMUNERATION_LABEL'), ': ', F('REMUNERATION'), '. It is paid ', F('PAY_CYCLE_LOWER'), ' into your nominated bank account, less tax and any other deduction the law requires or you authorise.'),
    li(B('Award. '), 'Your employment is covered by the ', F('AWARD'), ' (the Award). Your classification is: ', F('CLASSIFICATION'), '. Your remuneration is paid in satisfaction of your Award entitlements to the extent the law allows, and will never be less than the Award requires.'),
    li(B('Superannuation. '), F('SUPERANNUATION'), ' Contributions are made at no less than the Superannuation Guarantee rate. You may nominate your own fund; if you do not, contributions go to your stapled fund or, failing that, the Company’s default fund. Please return the Superannuation Standard Choice Form with this Contract.'),
    li(B('Salary sacrifice. '), 'You may ask to salary sacrifice part of your remuneration into superannuation, within the limits the law allows.'),
    li(B('Expenses. '), 'The Company reimburses approved work-related expenses, including travel, in accordance with its policies and the Award.'),
    li(B('Incentives. '), 'Any bonus or incentive is at the Company’s discretion and depends on performance goals it sets.'),
    li(B('Review. '), 'Your remuneration is reviewed annually, having regard to your performance, the Company’s performance and market conditions. A review does not guarantee an increase. Any change will be confirmed in writing.'),

    h1('Schedule 3 — Leave'),
    p('Your leave entitlements are those of the National Employment Standards in the Fair Work Act 2009 (Cth) and the Award, including:'),
    li(B('Annual leave. '), 'Four (4) weeks of paid annual leave for each year of service, accruing progressively and taken at times agreed with the Company.'),
    li(B('Personal/carer’s leave. '), 'Ten (10) days of paid personal/carer’s leave for each year of service, accruing progressively and accumulating from year to year. You must notify the Company as soon as you can, and provide evidence such as a medical certificate if asked.'),
    li(B('Compassionate leave. '), 'Two (2) days of paid compassionate leave on each permissible occasion.'),
    li(B('Family and domestic violence leave. '), 'Ten (10) days of paid leave in each twelve-month period.'),
    li(B('Parental leave. '), 'Unpaid parental leave after twelve (12) months of continuous service, together with any entitlement under the Australian Government’s Paid Parental Leave scheme. At least ten (10) weeks’ written notice is required.'),
    li(B('Long service leave. '), 'In accordance with the Long Service Leave Act 1958 (WA).'),
    li(B('Study and professional development leave. '), 'Paid or unpaid leave for study or professional development directly related to your role may be granted at the Company’s discretion, on request in advance.'),
    li(B('Public holidays. '), 'You are entitled to be absent on a public holiday without loss of pay. If you are asked to work on one, you are compensated in accordance with the Award.'),
  ].join('');
}

// ── Assemble ────────────────────────────────────────────────────────────────

async function build() {
  const zip = await JSZip.loadAsync(fs.readFileSync(SHELL));
  const doc = await zip.file('word/document.xml').async('string');

  const bodyStart = doc.indexOf('<w:body>') + '<w:body>'.length;
  const firstControl = doc.indexOf('OPAL_LOO_DATE');
  const letterheadEnd = doc.lastIndexOf('<w:p ', firstControl); // logo + "OPAL THERAPY" rule sit before the date line
  const sectPr = doc.slice(doc.lastIndexOf('<w:sectPr'), doc.indexOf('</w:body>'));
  zip.file('word/document.xml', doc.slice(0, bodyStart) + doc.slice(bodyStart, letterheadEnd) + body() + sectPr + '</w:body></w:document>');

  const header = await zip.file('word/header2.xml').async('string');
  zip.file('word/header2.xml', header
    .replace('Letter of Offer', 'Contract of Employment')
    .replace('OPAL_LOO_CANDIDATE_FULL_NAME', 'OPAL_COE_EMPLOYEE_FULL_NAME')
    .replace(/PORTAL — CANDIDATE FULL NAME/g, 'PORTAL — EMPLOYEE FULL NAME'));
  for (const name of ['word/footer1.xml', 'word/footer2.xml', 'word/footer3.xml']) {
    const xml = await zip.file(name).async('string');
    zip.file(name, xml.replace(/OPAL-LOFT-\d{4}-\d{3}/g, DOCUMENT_CODE).replace(/>\d{2}-\d{2}-\d{4}</g, `>${DOCUMENT_CODE}<`));
  }
  const core = await zip.file('docProps/core.xml').async('string');
  zip.file('docProps/core.xml', core.replace(/<dc:title>[\s\S]*?<\/dc:title>/, '<dc:title>Contract of Employment</dc:title>'));

  fs.writeFileSync(OUT, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${sdtId - 81000} controls)`);
}

build().catch((err) => { console.error(err); process.exit(1); });
