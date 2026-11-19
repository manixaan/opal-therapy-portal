'use strict';

/**
 * Side-panel notes sanitiser (19 Nov 2026). Notes are rendered back with
 * innerHTML, so only the editor's own formatting may survive.
 */
const { sanitizeNotesHtml, textLength } = require('../rich-notes');

describe('sanitizeNotesHtml', () => {
  test('keeps the editor formatting, strips every attribute', () => {
    expect(sanitizeNotesHtml('<b style="color:red">Bold</b> <i>it</i> <u>u</u> <strike>s</strike>'))
      .toBe('<b>Bold</b> <i>it</i> <u>u</u> <strike>s</strike>');
    expect(sanitizeNotesHtml('<ul class="x"><li onclick="x()">one</li></ul><div>line</div><br/>'))
      .toBe('<ul><li>one</li></ul><div>line</div><br>');
  });
  test('drops scripts, styles, iframes and svg whole', () => {
    expect(sanitizeNotesHtml('a<script>alert(1)</script>b<style>*{}</style>c<iframe src="x"></iframe>d<svg onload=alert(1)><circle/></svg>e'))
      .toBe('abcde');
    expect(sanitizeNotesHtml('safe<script>never closed')).toBe('safe');
  });
  test('removes unknown tags but keeps their text; event handlers never survive', () => {
    expect(sanitizeNotesHtml('<img src=x onerror=alert(1)>hi <a href="javascript:alert(1)">link</a>')).toBe('hi link');
    expect(sanitizeNotesHtml('<span style="x">t</span>')).toBe('t');
  });
  test('a stray angle bracket or quote is escaped; existing entities kept', () => {
    expect(sanitizeNotesHtml('1 < 2 & "q" &amp; &lt;b&gt;')).toBe('1 &lt; 2 &amp; &quot;q&quot; &amp; &lt;b&gt;');
  });
  test('non-strings become empty; length helpers ignore tags', () => {
    expect(sanitizeNotesHtml(null)).toBe('');
    expect(textLength('<b>ab</b><br>')).toBe(2);
    expect(textLength('<div><br></div>')).toBe(0);
  });
});

describe('side panel notes are stored on the event, not in the browser (19 Nov 2026)', () => {
  const SHELL = require('fs').readFileSync(require('path').join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
  const notes = SHELL.slice(SHELL.indexOf('// ===== Notes (side panel) ====='), SHELL.indexOf('function __notesUpdateCount() {'));

  test('the loader carries notes from custom_metadata through to the tile', () => {
    expect(SHELL).toContain("notesHtml: (event.custom_metadata && event.custom_metadata.notes && event.custom_metadata.notes.html) || '',");
    expect(SHELL).toContain("notesHtml: session.notesHtml || '',");
  });
  test('saves go to PATCH /api/events/:dbId/notes, never to localStorage', () => {
    expect(notes).toContain("fetch('/api/events/' + encodeURIComponent(p.dbId) + '/notes'");
    expect(notes).not.toMatch(/localStorage\.setItem/);
  });
  test('a pending save belongs to the event it was typed into and is flushed before another opens or the panel closes', () => {
    expect(notes).toMatch(/function notesLoadForSession\(id\) \{\s+notesFlush\(\);/);
    expect(notes).toContain('__notesPending = { sessionId, dbId: s.dbId, html };');
    expect(SHELL).toMatch(/function closeBlockDetail\(\) \{\s+if \(typeof notesFlush === 'function'\) notesFlush\(\);/);
  });
  test('the notes box is the larger, resizable one', () => {
    expect(SHELL).toMatch(/\.notes-editor \{[^}]*font-size: 14px;[^}]*min-height: 160px; max-height: 45vh; resize: vertical;/);
  });
});
