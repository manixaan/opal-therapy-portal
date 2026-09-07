'use strict';

/**
 * EMAIL 1 — the message that carries the Letter of Offer.
 *
 * Opal's wording, verbatim, with two substitutions: [Name] (the candidate's
 * first name) and [Position Role]. The Owner may edit the result before the
 * Outlook draft is created; what is stored on the offer is what was drafted.
 */

const SUBJECT = 'Letter of Offer - Opal Therapy';

const BODY = `Hi [Name],

We're so excited to officially offer you the position of [Position Role] with Opal Therapy!

It was such a pleasure getting to know you throughout the interview process, and we would love to welcome you to our growing team. We believe you'll be a wonderful fit for Opal Therapy and are really looking forward to supporting you as you settle into your role and grow with us.

Attached is your Letter of Offer, which outlines the key details of your proposed employment, including your position, commencement date, remuneration, and any conditions precedent to your employment.

Please take some time to read through the letter and feel free to reach out if you have any questions. If you're happy to accept the offer, please sign and return the Letter of Offer within 48 hours.

Once we receive your signed Letter of Offer, we'll move on to the next stage of the process and send through your onboarding documentation which will include your official contract of employment, followed by your Opal Therapy induction documentation to help prepare you for your commencement.

We are very excited about the possibility of welcoming you to the Opal Therapy team!

Warmly,
Ann
Director | Opal Therapy`;

const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'there';

/** The default Email 1 for a record. */
function composeOfferEmail({ applicantName, positionTitle }) {
  const body = BODY
    .replace(/\[Name\]/g, firstName(applicantName))
    .replace(/\[Position Role\]/g, String(positionTitle || 'the role discussed').trim());
  return { subject: SUBJECT, body };
}

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Plain text → the HTML body Outlook shows. Paragraphs on blank lines, <br> within. */
const { bodyToHtml } = require('./onboarding-email-markup');

module.exports = { SUBJECT, BODY, composeOfferEmail, bodyToHtml };
