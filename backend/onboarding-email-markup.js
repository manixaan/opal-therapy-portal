'use strict';

/**
 * ONBOARDING EMAIL MARKUP — the three onboarding emails are kept as plain
 * text with light inline marks, so the record, the mailto: fallback and the
 * Outlook draft all come from the one wording:
 *
 *   **bold**   *italic*   __underline__
 *
 * bodyToHtml renders those marks for the Outlook draft; stripMarks gives the
 * bare words for anywhere HTML cannot go.
 */

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A mark wraps something, and the something does not start or end with a space. */
const MARKS = [
  [/\*\*(?=\S)([\s\S]*?\S)\*\*/g, 'strong'],
  [/__(?=\S)([\s\S]*?\S)__/g, 'u'],
  [/(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, 'em'],
];

/** Escaped text → HTML with the marks rendered. Escape first, then mark, so a mark never escapes an angle bracket. */
function inlineHtml(text) {
  let out = esc(text);
  for (const [re, tag] of MARKS) out = out.replace(re, (_, inner) => `<${tag}>${inner}</${tag}>`);
  return out.replace(/\n/g, '<br>');
}

function bodyToHtml(text) {
  const paras = String(text || '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  return '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a">'
    + paras.map((p) => `<p style="margin:0 0 12px">${inlineHtml(p)}</p>`).join('')
    + '</div>';
}

function stripMarks(text) {
  let out = String(text || '');
  for (const [re] of MARKS) out = out.replace(re, '$1');
  return out;
}

module.exports = { bodyToHtml, stripMarks };
