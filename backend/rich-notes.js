'use strict';

/**
 * RICH NOTES — the event side panel's notes (19 Nov 2026).
 *
 * The notes editor is a contenteditable box with bold / italic / underline /
 * strike / lists. What it produces is stored on the event
 * (custom_metadata.notes) and rendered back as HTML, so it is cleaned here,
 * server-side, before it is stored: only the editor's own formatting tags
 * survive, with NO attributes (no style, no href, no on*); script/style/
 * iframe content is dropped whole; any other tag is removed but its text
 * kept; a stray "<" becomes "&lt;". The result can be put into innerHTML.
 */

const ALLOWED = new Set(['b', 'strong', 'i', 'em', 'u', 's', 'strike', 'ul', 'ol', 'li', 'br', 'div', 'p']);
const VOID = new Set(['br']);
const DROP_WITH_CONTENT = /<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*?<\/\1\s*>/gi;
const MAX_LEN = 20000;

function sanitizeNotesHtml(input) {
  if (typeof input !== 'string') return '';
  let s = input.replace(DROP_WITH_CONTENT, '');
  // Unclosed dangerous openers: drop from the opener to the end.
  s = s.replace(/<(script|style|iframe|object|embed|template|noscript|svg|math)\b[\s\S]*$/i, '');
  s = s.replace(/<!--[\s\S]*?(-->|$)/g, '');
  let out = '';
  let i = 0;
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)\b[^<>]*>/g;
  let m;
  while ((m = tagRe.exec(s))) {
    out += escapeText(s.slice(i, m.index));
    const closing = m[1] === '/';
    const name = m[2].toLowerCase();
    if (ALLOWED.has(name)) {
      if (VOID.has(name)) out += closing ? '' : '<br>';
      else out += closing ? `</${name}>` : `<${name}>`;
    }
    i = tagRe.lastIndex;
  }
  out += escapeText(s.slice(i));
  // Never cut here — a cut can split an entity ("&l"); the route refuses over-length notes instead.
  return out;
}

/** Text between tags: keep existing entities, escape anything that could open a tag. */
function escapeText(t) {
  return t
    .replace(/&(?!(?:[a-zA-Z]{2,8}|#\d{1,6}|#x[0-9a-fA-F]{1,6});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Visible text length (for limits/audit), tags and entities collapsed. */
function textLength(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/&[^;]+;/g, ' ').trim().length;
}

module.exports = { sanitizeNotesHtml, textLength, MAX_LEN };
