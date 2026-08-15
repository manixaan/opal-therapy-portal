'use strict';

/**
 * ASSESSMENT FRAMEWORK — EMAIL / SHARE PREPARATION
 *
 * Composes the message a clinician is about to send about an assessment, and
 * stops there. Nothing in this module sends anything, and nothing it returns
 * can be turned into a send by a caller that forgets to ask: the payload is a
 * DRAFT, marked `sent: false`, and the route that builds it performs no
 * transport call at all.
 *
 * ── Why nothing is sent from here ──────────────────────────────────────────
 * backend/email.js exists, but it is the account-lifecycle transporter:
 * invitations, verification, password resets. It is not an approved channel
 * for clinical correspondence, it has no consent record, no recipient
 * allow-list and no attachment path. Wiring a completed assessment into it
 * would create exactly the thing the brief forbids — a silent send — with none
 * of the controls a clinical disclosure needs. So the share action prepares
 * the message, records that it was prepared, and hands the clinician the
 * document through the authenticated download route to attach themselves.
 *
 * ── Privacy rules applied here ─────────────────────────────────────────────
 * - The SUBJECT carries no client identity. A subject line is the part of a
 *   message most likely to be shown on a lock screen, quoted in a bounce, or
 *   logged by an intermediate mail server.
 * - The BODY names the client, because the clinician is writing to a named
 *   recipient about that person, but carries no responses, no domain values
 *   and no score. A number without its method and its missing-data handling is
 *   the easiest clinical fact to misread.
 * - No URL is generated. The document is fetched through the authenticated
 *   route by the person who is already signed in; there is no link to leak.
 */

const MAX_LINE = 300;

function clean(v, max) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim().slice(0, max || MAX_LINE);
}

/**
 * What is being shared. A blank form and a completed record are different
 * disclosures and read differently.
 */
const SUBJECTS = {
  blank: (d) => `${d.abbreviation} — blank assessment form`,
  completed: (d) => `${d.abbreviation} — completed assessment`,
  results: (d) => `${d.abbreviation} — assessment results`,
};

function bodyFor(kind, ctx) {
  const { definition, clientName, assessorName, completedOn, method, orgName } = ctx;
  const who = clientName ? clean(clientName, 120) : 'the client';
  const lines = [];

  if (kind === 'blank') {
    lines.push(`Please find attached a blank ${definition.abbreviation} form.`);
    lines.push('');
    lines.push(`Instrument: ${definition.name}${definition.edition ? ` (version ${definition.edition})` : ''}`);
    if (method) lines.push(`Form: ${method}`);
    lines.push('');
    lines.push('The form is reproduced without modification and remains the work of its '
      + 'rights holder.');
  } else {
    lines.push(`Please find attached the ${definition.abbreviation} assessment completed for ${who}.`);
    lines.push('');
    lines.push(`Instrument: ${definition.name}${definition.edition ? ` (version ${definition.edition})` : ''}`);
    if (method) lines.push(`Administration: ${method}`);
    if (completedOn) lines.push(`Completed: ${completedOn}`);
    if (assessorName) lines.push(`Completed by: ${clean(assessorName, 120)}`);
    lines.push('');
    lines.push('Scores and domain results are set out in the attached document, each labelled '
      + 'with the scoring method that produced it. Please read them together with that label '
      + 'rather than in isolation.');
  }

  if (definition.attribution && definition.attribution.copyright) {
    lines.push('');
    lines.push(definition.attribution.copyright);
  }

  lines.push('');
  lines.push('This message contains confidential health information. If it has reached you in '
    + 'error, please delete it and let us know.');
  if (orgName) {
    lines.push('');
    lines.push(clean(orgName, 160));
  }

  return lines.join('\n');
}

/**
 * Build the share draft.
 *
 * @param {object}  args
 * @param {object}  args.definition   assessment definition
 * @param {string}  args.kind         'blank' | 'completed' | 'results'
 * @param {string}  [args.clientName]
 * @param {string}  [args.assessorName]
 * @param {string}  [args.completedOn] already-formatted date
 * @param {string}  [args.method]     administration method label
 * @param {string}  [args.orgName]
 * @param {object}  [args.attachment] { filename, downloadPath }
 * @param {boolean} [args.transportConfigured] whether an approved clinical mail
 *                  channel exists. Today: never.
 * @returns {object} a draft, never a sent message
 */
function prepareShare(args) {
  const kind = SUBJECTS[args.kind] ? args.kind : 'completed';
  const definition = args.definition;

  const draft = {
    kind,
    sent: false,
    requiresReview: true,
    subject: SUBJECTS[kind](definition),
    body: bodyFor(kind, args),
    // Deliberately empty: a recipient is the clinician's decision, made in
    // front of the message, never prefilled from a record.
    to: [],
    attachment: args.attachment
      ? { filename: args.attachment.filename, downloadPath: args.attachment.downloadPath }
      : null,
    // How the clinician actually sends it, stated rather than implied.
    delivery: {
      transport: args.transportConfigured ? 'portal' : 'clinician-mail-client',
      configured: Boolean(args.transportConfigured),
      instruction: args.transportConfigured
        ? 'Review the message, then send it from the portal.'
        : 'No approved secure-mail channel is configured for clinical correspondence in '
          + 'this environment, so the portal will not send this message. Download the '
          + 'document below and send it from your own secure mail client after reviewing '
          + 'the wording.',
    },
    notices: [],
  };

  if (kind !== 'blank') {
    draft.notices.push('Check that you have the client\'s consent to disclose this assessment '
      + 'to the recipient, and that the recipient is entitled to receive it.');
  }
  if (!args.attachment) {
    draft.notices.push('No document is attached: this assessment has no generated PDF yet.');
  }

  return draft;
}

module.exports = { prepareShare, SUBJECTS };
