'use strict';

/**
 * OPAL ASSIST — an Assist document as an Outlook DRAFT. Pure: no I/O.
 *
 * "Outlook draft" on a document reply (an email to a support coordinator, a
 * note to a family) saves it in the practitioner's OWN Outlook Drafts through
 * graph-mail.js — never sent. They open it in Outlook, read it, and press
 * Send themselves.
 *
 * The browser sends the document as BLOCKS of plain text with names already
 * put back (it is going to the practitioner's own mailbox, written by them),
 * never HTML: the email body is built here, every character escaped, so
 * nothing the page or the model produced can become markup or a link in the
 * draft. Recipients are optional (a draft may be addressed in Outlook) and
 * checked as plain addresses.
 */

const MAX_RECIPIENTS = 10;
const MAX_SUBJECT = 250;
const MAX_BLOCKS = 120;
const MAX_TEXT = 30000;
// Deliberately plain: one @, no spaces, no angle brackets or commas, a dot in the domain.
const EMAIL_RE = /^[^\s@<>,;"'()]+@[^\s@<>,;"'()]+\.[^\s@<>,;"'()]+$/;

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** "a@x.au; b@y.au" or an array → { ok, to } | { ok:false, reason }. Empty is fine. */
function readRecipients(raw) {
  const list = (Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[;,\s]+/))
    .map((s) => String(s || '').trim()).filter(Boolean);
  if (list.length > MAX_RECIPIENTS) return { ok: false, reason: `At most ${MAX_RECIPIENTS} recipients.` };
  const bad = list.find((a) => a.length > 254 || !EMAIL_RE.test(a));
  if (bad) return { ok: false, reason: 'One of the addresses does not look like an email address.' };
  return { ok: true, to: [...new Set(list.map((a) => a.toLowerCase()))] };
}

/** The draft's body, from plain-text blocks: escaped, Arial 11pt, like Copy. */
function renderBody(blocks) {
  if (!Array.isArray(blocks) || !blocks.length || blocks.length > MAX_BLOCKS) return { ok: false, reason: 'The document is empty or too long for an email.' };
  let total = 0; let html = ''; let list = false;
  for (const b of blocks) {
    if (!b || !['h', 'p', 'li'].includes(b.t)) return { ok: false, reason: 'The document could not be read.' };
    const text = String(b.text || '').trim(); const lead = b.t === 'li' && b.lead ? String(b.lead).trim() : '';
    total += text.length + lead.length;
    if (total > MAX_TEXT) return { ok: false, reason: 'The document is too long for an email.' };
    if (!text && !lead) continue;
    const inline = esc(text).replace(/\n/g, '<br>');
    if (b.t === 'li' && !list) { html += '<ul>'; list = true; }
    if (b.t !== 'li' && list) { html += '</ul>'; list = false; }
    if (b.t === 'h') html += `<p><strong>${inline}</strong></p>`;
    else if (b.t === 'li') html += `<li>${lead ? `<strong>${esc(lead)}:</strong> ` : ''}${inline}</li>`;
    else html += `<p>${inline}</p>`;
  }
  if (list) html += '</ul>';
  if (!html) return { ok: false, reason: 'The document is empty.' };
  return { ok: true, html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;">${html}</div>`, chars: total };
}

function readSubject(raw) {
  return String(raw == null ? '' : raw).replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_SUBJECT);
}

module.exports = { readRecipients, renderBody, readSubject, MAX_RECIPIENTS, MAX_TEXT };
