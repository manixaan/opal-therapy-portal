'use strict';

/**
 * GRAPH MAIL TRANSPORT — the portal's email sent through Microsoft Graph.
 *
 * Exchange Online is retiring password (Basic) SMTP AUTH: off by default for
 * existing tenants from the end of December 2026 (Microsoft MC786329). Graph
 * with an app-only token is the supported way for a server to send as a
 * Microsoft 365 mailbox, and it needs no mailbox password in the portal's
 * settings — only the app registration the portal already has.
 *
 *   EMAIL_TRANSPORT=graph
 *   EMAIL_SENDER=portal@opaltherapy.com.au   the mailbox mail is sent from
 *   EMAIL_FROM="Opal Therapy <portal@…>"     optional display name
 *   EMAIL_REPLY_TO=ann.mathew@…              optional reply-to
 *   EMAIL_SAVE_TO_SENT=false                 default: portal mail is NOT kept in
 *                                            the sender's Sent Items (see below)
 *   MICROSOFT_CLIENT_ID / _SECRET / _TENANT_ID   (already used for Outlook)
 *
 * Tenant side (owner/Microsoft admin): the app registration needs the
 * Microsoft Graph APPLICATION permission Mail.Send with admin consent, and
 * should be limited to the sender mailbox (Exchange RBAC for Applications /
 * application access policy) so it cannot send as anyone else.
 *
 * It exposes the one method email.js uses — sendMail(nodemailerOptions) — so
 * every template keeps its three-state contract (skipped / sent / thrown).
 * The JSON sendMail call carries the whole message in one request, which
 * Graph caps at about 4 MB; anything larger is refused with a clear error
 * rather than half-sent (larger messages need a draft + upload session and
 * the Mail.ReadWrite permission — not enabled).
 */

const axios = require('axios');

const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'https://graph.microsoft.com/.default';
// Base64 grows data by a third; keep the encoded request comfortably under 4 MB.
const MAX_INLINE_ATTACHMENT_BYTES = 2.8 * 1024 * 1024;

class GraphMailError extends Error {
  constructor(message, { status = null, code = null } = {}) {
    super(message);
    this.name = 'GraphMailError';
    this.status = status;
    this.code = code;
  }
}

function graphMailConfig(env = process.env) {
  return {
    sender: String(env.EMAIL_SENDER || '').trim(),
    replyTo: String(env.EMAIL_REPLY_TO || '').trim(),
    // Invite, verification and password-reset emails carry account links. In a
    // SHARED mailbox every member can read Sent Items, so a kept copy would
    // hand those links to the whole team. Off unless explicitly turned on.
    saveToSentItems: String(env.EMAIL_SAVE_TO_SENT || '').trim().toLowerCase() === 'true',
    clientId: env.MICROSOFT_CLIENT_ID || '',
    clientSecret: env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: env.MICROSOFT_TENANT_ID || '',
  };
}

/** True when every setting the Graph transport needs is present. */
function isGraphMailConfigured(env = process.env) {
  const c = graphMailConfig(env);
  return !!(c.sender && c.clientId && c.clientSecret && c.tenantId);
}

/** "Opal Therapy <portal@x>" → { name: 'Opal Therapy', address: 'portal@x' }; "a@b" → { name: '', address: 'a@b' }. */
function parseAddress(value) {
  const s = String(value || '').trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), address: m[2].trim() };
  return { name: '', address: s };
}

/** to: "a@b, c@d" | ["a@b", "Name <c@d>"] → Graph recipients. */
function toRecipients(to) {
  const list = Array.isArray(to) ? to : String(to || '').split(',');
  return list
    .map((x) => (x && typeof x === 'object' && x.address ? { name: x.name || '', address: x.address } : parseAddress(x)))
    .filter((a) => a.address)
    .map((a) => ({ emailAddress: a.name ? { name: a.name, address: a.address } : { address: a.address } }));
}

/** PURE — nodemailer-style options → the Graph sendMail request body. */
function buildGraphMessage(opts, { sender, replyTo, saveToSentItems = false } = {}) {
  const o = opts || {};
  const recipients = toRecipients(o.to);
  if (!recipients.length) throw new GraphMailError('No recipient', { code: 'no_recipient' });
  const fromName = parseAddress(o.from).name;
  const message = {
    subject: String(o.subject || ''),
    body: o.html
      ? { contentType: 'HTML', content: String(o.html) }
      : { contentType: 'Text', content: String(o.text || '') },
    toRecipients: recipients,
    // The mailbox is fixed by EMAIL_SENDER; the display name follows EMAIL_FROM.
    from: { emailAddress: fromName ? { name: fromName, address: sender } : { address: sender } },
  };
  const cc = toRecipients(o.cc);
  if (cc.length) message.ccRecipients = cc;
  const reply = o.replyTo || replyTo;
  if (reply) message.replyTo = toRecipients(reply);

  if (Array.isArray(o.attachments) && o.attachments.length) {
    let total = 0;
    message.attachments = o.attachments.map((a) => {
      const buf = Buffer.isBuffer(a.content) ? a.content : Buffer.from(String(a.content || ''));
      total += buf.length;
      return {
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: String(a.filename || 'attachment'),
        contentType: String(a.contentType || 'application/octet-stream'),
        contentBytes: buf.toString('base64'),
      };
    });
    if (total > MAX_INLINE_ATTACHMENT_BYTES) {
      throw new GraphMailError(
        'Attachments are too large to send through Microsoft Graph in one message (about 2.8 MB total). '
        + 'Send fewer or smaller files.',
        { code: 'attachments_too_large' });
    }
  }
  return { message, saveToSentItems: !!saveToSentItems };
}

/**
 * The transport. `http` is injectable for tests: { post(url, body, config) }
 * returning a promise of { status, data } (axios-compatible).
 */
function createGraphTransport({ env = process.env, http = axios, now = () => Date.now() } = {}) {
  const cfg = graphMailConfig(env);
  let token = null; // { value, expiresAt }

  async function appToken() {
    if (token && token.expiresAt - now() > 60 * 1000) return token.value;
    const params = new URLSearchParams();
    params.append('client_id', cfg.clientId);
    params.append('client_secret', cfg.clientSecret);
    params.append('scope', SCOPE);
    params.append('grant_type', 'client_credentials');
    try {
      const { data } = await http.post(
        `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
        params.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 });
      token = { value: data.access_token, expiresAt: now() + (Number(data.expires_in) || 3600) * 1000 };
      return token.value;
    } catch (err) {
      token = null;
      const status = err?.response?.status || null;
      throw new GraphMailError(
        'Could not get a Microsoft token to send email — check MICROSOFT_CLIENT_ID / _SECRET / _TENANT_ID.',
        { status, code: err?.response?.data?.error || 'token_failed' });
    }
  }

  async function sendMail(opts) {
    const body = buildGraphMessage(opts, cfg);
    const bearer = await appToken();
    try {
      await http.post(
        `${GRAPH}/users/${encodeURIComponent(cfg.sender)}/sendMail`,
        body,
        { headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' }, timeout: 30000 });
    } catch (err) {
      const status = err?.response?.status || null;
      const code = err?.response?.data?.error?.code || null;
      if (status === 401) token = null;
      const hint = status === 403
        ? 'Microsoft refused: the app needs the Mail.Send application permission (admin consent) and access to the sender mailbox.'
        : status === 404
          ? 'Microsoft could not find the sender mailbox (EMAIL_SENDER).'
          : 'Microsoft Graph could not send the email.';
      throw new GraphMailError(hint, { status, code });
    }
    // Graph's sendMail answers 202 with no message id; this one is ours, for logs.
    return { messageId: `graph-${now()}`, accepted: body.message.toRecipients.map((r) => r.emailAddress.address) };
  }

  return { sendMail, kind: 'graph' };
}

module.exports = {
  GraphMailError,
  MAX_INLINE_ATTACHMENT_BYTES,
  graphMailConfig,
  isGraphMailConfigured,
  parseAddress,
  toRecipients,
  buildGraphMessage,
  createGraphTransport,
};
