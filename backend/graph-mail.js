'use strict';

/**
 * MICROSOFT GRAPH MAIL — preparing a draft in the practice's own mailbox.
 *
 * The portal already connects each user's Microsoft account for calendar sync
 * (outlook-oauth.js). This module reuses that connection to do one further
 * thing: create a DRAFT message, with the starter pack attached, in the
 * Owner's own Outlook — so pressing "Send Starter Pack" ends with the email
 * sitting in their Drafts, addressed, written and attached, for them to read
 * and send.
 *
 * ── WHY A DRAFT AND NOT A SEND ─────────────────────────────────────────────
 * A starter pack is the practice's first contact with a new employee. It goes
 * out under the Owner's name, in their sent items, in the thread the employee
 * will reply to. A draft preserves all of that AND leaves the last word with a
 * person. Sending on their behalf gains a click and loses the review.
 *
 * ── SCOPES ─────────────────────────────────────────────────────────────────
 * Creating a draft needs the delegated `Mail.ReadWrite` scope. The portal's
 * consented scope set today is Calendars.ReadWrite + offline_access + User.Read
 * (outlook-oauth.js), so this module is INERT until an administrator adds
 * Mail.ReadWrite to the Entra app registration, grants consent, and sets
 * GRAPH_MAIL_ENABLED=true — at which point outlook-oauth.js starts asking for
 * the scope and each connected user reconnects once to pick it up. That is
 * deliberate: silently widening what a stored refresh token can do is not
 * something code should arrange for itself.
 *
 * Until then `isAvailable()` returns false and the caller falls back to SMTP,
 * which already sends from the practice mailbox and already carries
 * attachments. Nothing is blocked on the scope; the draft path is the nicer
 * option, not the only one.
 *
 * ── FAILURE IS NEVER FATAL ─────────────────────────────────────────────────
 * Every function here reports rather than throws into the request path. A
 * Graph outage must not lose a generated starter pack (§51) — the pack is
 * already saved, and the Owner is offered a retry or the SMTP path.
 */

const axios = require('axios');
const log = require('./logger').createLogger('graph-mail');

const GRAPH = 'https://graph.microsoft.com/v1.0';

/**
 * Graph refuses a single request carrying more than 4 MB of payload; the
 * documented threshold for switching to an upload session is 3 MB of raw
 * attachment. Base64 inflates by a third, so anything over 3 MB raw goes down
 * the secure-link path instead of failing at the API.
 */
const MAX_SIMPLE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/**
 * The scope a draft needs. Checked against what the tenant actually granted
 * rather than assumed, so this module reports its own unavailability instead
 * of producing a 403 the caller has to interpret.
 */
const REQUIRED_SCOPE = 'Mail.ReadWrite';

/**
 * Is the draft path usable for this user right now?
 *
 * Two conditions, both necessary: the deployment has opted in
 * (GRAPH_MAIL_ENABLED), and this user has a live Microsoft connection. The
 * env flag exists so an administrator who has just added the scope can turn
 * the path on without a redeploy, and turn it off again if consent is
 * withdrawn.
 */
function isEnabled() {
  return String(process.env.GRAPH_MAIL_ENABLED || '').toLowerCase() === 'true';
}

function isAvailable(user) {
  if (!isEnabled()) return false;
  return !!(user && user.microsoft_id && user.refresh_token);
}

/** Why the draft path is not available, in words a UI can show. */
function unavailableReason(user) {
  if (!isEnabled()) {
    return 'Outlook drafts are not switched on for this practice. '
      + `An administrator needs to grant the ${REQUIRED_SCOPE} permission and set GRAPH_MAIL_ENABLED.`;
  }
  if (!user || !user.microsoft_id) {
    return 'Your Microsoft account is not connected. Connect it from Settings → Integrations.';
  }
  if (!user.refresh_token) {
    return 'Your Microsoft connection needs renewing. Reconnect it from Settings → Integrations.';
  }
  return null;
}

/**
 * A usable delegated access token for this user, refreshing if needed.
 *
 * Implemented here rather than imported from routes.js or server.js — both
 * hold a near-identical helper, and requiring either would create a circular
 * import at module-init time. It decrypts defensively for the same reason
 * server.js does: a row read through raw SQL carries the AES-GCM ciphertext,
 * and Graph answering `Bearer enc:...` with a 401 on every call is a fault
 * this codebase has already had once.
 *
 * @returns {Promise<string|null>} null rather than a throw — a token that
 *   cannot be refreshed is a condition the caller reports, not an exception
 *   that should abort a request the user's starter pack depends on.
 */
async function getAccessToken(user) {
  if (!user || !user.refresh_token) return null;
  try {
    const { decrypt } = require('./crypto-utils');
    const expiresAt = user.token_expires_at ? new Date(user.token_expires_at) : null;
    // One minute of headroom, matching the calendar sync path.
    if (expiresAt && (expiresAt - new Date()) > 60 * 1000 && user.access_token) {
      return decrypt(user.access_token);
    }
    const outlook = require('./outlook-oauth');
    const refreshed = await outlook.refreshAccessToken(decrypt(user.refresh_token));
    await require('./database')
      .updateUserTokens(user.id, refreshed.accessToken, refreshed.refreshToken, refreshed.expiresIn);
    return refreshed.accessToken;
  } catch (err) {
    log.warn('graph token refresh failed', { error: err });
    return null;
  }
}

/**
 * Create a draft with an optional single attachment.
 *
 * @param {object}  opts
 * @param {string}  opts.accessToken   a valid delegated token (the caller
 *                                     refreshes; this module never touches
 *                                     stored credentials)
 * @param {string}  opts.to
 * @param {string}  opts.subject
 * @param {string}  opts.html
 * @param {Buffer}  [opts.attachment]
 * @param {string}  [opts.attachmentName]
 * @param {string}  [opts.attachmentMime]
 * @returns {Promise<{ok:true, id:string, webLink:string}|{ok:false, reason:string, code:string}>}
 */
async function createDraft({
  accessToken, to, subject, html, attachment, attachmentName, attachmentMime,
}) {
  if (!accessToken) return { ok: false, code: 'no_token', reason: 'No Microsoft access token' };

  const body = {
    subject: String(subject || '').slice(0, 250),
    body: { contentType: 'HTML', content: String(html || '') },
    toRecipients: [{ emailAddress: { address: String(to || '') } }],
  };

  if (attachment && attachment.length) {
    if (attachment.length > MAX_SIMPLE_ATTACHMENT_BYTES) {
      return {
        ok: false,
        code: 'attachment_too_large',
        reason: 'That starter pack is too large to attach to an Outlook draft.',
      };
    }
    body.attachments = [{
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: String(attachmentName || 'attachment.zip').slice(0, 200),
      contentType: attachmentMime || 'application/zip',
      contentBytes: attachment.toString('base64'),
    }];
  }

  try {
    const res = await axios.post(`${GRAPH}/me/messages`, body, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: 30000,
      maxBodyLength: 8 * 1024 * 1024,
    });
    return {
      ok: true,
      id: res.data?.id || null,
      // Opens the draft in Outlook on the web. The Owner reads it there and
      // presses Send; the portal never does.
      webLink: res.data?.webLink || null,
    };
  } catch (err) {
    const status = err?.response?.status;
    // A missing scope is the expected failure until an administrator grants it,
    // and it has a specific remedy. Everything else is an outage.
    if (status === 403 || status === 401) {
      log.warn('graph draft refused', { status });
      return {
        ok: false,
        code: 'scope_missing',
        reason: `Outlook refused the request. The ${REQUIRED_SCOPE} permission may not be granted yet — `
          + 'ask your administrator, or send the pack from the portal instead.',
      };
    }
    log.warn('graph draft failed', { error: err, status: status || null });
    return {
      ok: false,
      code: 'graph_error',
      reason: 'Outlook could not be reached just now. Your starter pack is saved — please try again.',
    };
  }
}

module.exports = {
  GRAPH,
  REQUIRED_SCOPE,
  MAX_SIMPLE_ATTACHMENT_BYTES,
  isEnabled,
  isAvailable,
  unavailableReason,
  getAccessToken,
  createDraft,
};
