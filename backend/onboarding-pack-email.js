'use strict';

/**
 * EMAIL 2 — the message that carries the Onboarding Documentation Pack.
 *
 * Opal's wording, verbatim, with two substitutions: [Name] (first name) and
 * [DD/MM/YYYY] (seven days after the day the email goes). The due date is
 * fixed when the Outlook draft is created — that is the date the employee
 * reads — and the record shows the same date.
 */

const SUBJECT = 'Onboarding Documentation Pack - Opal Therapy';

const BODY = `Hi [Name],

Thank you for signing and returning your Letter of Offer. We're delighted to move forward with your employment and continue with the next stage of the onboarding process.

Attached as a ZIP folder is your Opal Therapy Onboarding Documentation Pack. This pack includes your official employment contract, required employment and government documentation, and the screening and credential documentation required for your role.

Attachments: ZIP folder including –
- Contract of Employment
- Superannuation Form
- FWIS (and FTCIS/CEIS)
- New Employee Details which will include:
   o Bank details
   o Right to Work Verification (passport or visa details)
   o Identity Verification (evidence of passport)
   o Police Check
   o NDIS Worker Screening
   o WWCC
   o Driver's licence + Vehicle Details
   o First Aid Certificate/CPR Certificate
   o AHPRA Reg

Please download and extract the ZIP folder, carefully review each document, and complete and sign all documentation applicable to you. Please return the completed documentation within seven days, by [DD/MM/YYYY].

Tax File Number Declaration

Complete your ATO declaration form using your myGov account:
ato.gov.au/forms-and-instructions/tfn-declaration

Generate your Employee Tax Details Summary and email it to us at ann.mathew@opaltherapy.com.au.

Before returning the pack, please check that all required fields, dates, signatures and supporting documents have been included. If you have any questions or are waiting for a screening or credential document, please let us know as soon as possible.

Once we've received and reviewed your completed onboarding documentation, we'll move on to the Opal Therapy company induction stage to help prepare you for your commencement.

We look forward to welcoming you to the Opal Therapy team!

Warmly,
Ann
Director | Opal Therapy`;

const RETURN_DAYS = 7;
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** Seven days after `from`, as a Date at the end of that day (Perth). */
function dueDateFrom(from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + RETURN_DAYS);
  return d;
}
const ddmmyyyy = (d) => new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Australia/Perth' });

/** The default Email 2 for a record, with the due date it states. */
function composePackEmail({ applicantName, sentAt = new Date() }) {
  const dueAt = dueDateFrom(sentAt);
  const body = BODY.replace(/\[Name\]/g, firstName(applicantName)).replace(/\[DD\/MM\/YYYY\]/g, ddmmyyyy(dueAt));
  return { subject: SUBJECT, body, dueAt };
}

/** Re-stamp the due date in an edited body, if the Owner kept the placeholder or the old date. */
function restampDueDate(body, previousDueAt, dueAt) {
  let out = String(body || '').replace(/\[DD\/MM\/YYYY\]/g, ddmmyyyy(dueAt));
  if (previousDueAt) out = out.split(ddmmyyyy(previousDueAt)).join(ddmmyyyy(dueAt));
  return out;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const { bodyToHtml } = require('./onboarding-email-markup');

module.exports = { SUBJECT, BODY, RETURN_DAYS, composePackEmail, dueDateFrom, restampDueDate, ddmmyyyy, bodyToHtml };
