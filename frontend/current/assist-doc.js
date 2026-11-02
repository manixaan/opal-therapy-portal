/**
 * Opal Assist — the editable document. No framework.
 *
 * A rephrase or a case note comes back from the server as a small document
 * ({ kind, title, blocks: [{ t:'h'|'p'|'li', text, lead? }] }, tokens in the
 * text). This file lays it out like a page, lets the practitioner type into it
 * (bold, dot points, headings, undo), and lets them HIGHLIGHT any passage and
 * have just that passage rewritten.
 *
 * Names: the AI only ever saw tokens. Here a token is shown as the person's
 * name — first name by default — as plain text, no highlight. Under the hood
 * each name is an atomic span carrying its token, so whatever the person
 * edits, the document turns back into tokens before it leaves the browser.
 * A token this browser has no name for is shown as a role ("the support
 * worker"), never as a bracket.
 *
 * Pure helpers are exported for node tests; the DOM part needs a document.
 */
(function (global) {
  'use strict';

  var TOKEN_RE = /\[([A-Z][A-Z0-9_]*)\]/g;
  var PEOPLE = { CLIENT: 'the client', CONTACT: 'the contact', THERAPIST: 'the therapist', STAFF: 'a colleague', PERSON: 'another person' };
  var DETAILS = {
    EMAIL: 'the email address', PHONE: 'the phone number', ADDRESS: 'the address', NDIS_NUMBER: 'the NDIS number',
    MEDICARE_NUMBER: 'the Medicare number', DOB: 'the date of birth', AGE: 'their age', SCHOOL: 'the school',
    HOSPITAL: 'the hospital', ORG: 'the organisation', SUBURB: 'the suburb', LINK: 'the link',
  };

  function tokenBase(token) { return String(token || '').replace(/_\d+$/, ''); }

  /** What a token reads as: the name (first name for people by default), else a role. */
  function displayName(token, names, style) {
    var name = names && names[token];
    var base = tokenBase(token);
    if (!name) return PEOPLE[base] || DETAILS[base] || 'the detail';
    if (PEOPLE[base] && style !== 'full') return String(name).trim().split(/\s+/)[0];
    return String(name);
  }

  /** Text with tokens shown as display names (copy, insert, plain previews). */
  function restoreText(text, names, style) {
    return String(text || '').replace(TOKEN_RE, function (whole, t) { return displayName(t, names, style); });
  }

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /** Editor HTML for a run of text: names become atomic spans carrying their token. */
  function inlineHtml(text, names, style) {
    var out = ''; var last = 0; var m;
    var s = String(text || '');
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(s)) !== null) {
      out += esc(s.slice(last, m.index)).replace(/\n/g, '<br>');
      out += '<span class="oa-tok" contenteditable="false" data-token="' + esc(m[1]) + '">' + esc(displayName(m[1], names, style)) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last)).replace(/\n/g, '<br>');
  }

  /** The whole document as editor HTML. */
  function docToHtml(doc, names, style) {
    var html = ''; var list = false;
    (doc && doc.blocks || []).forEach(function (b) {
      if (b.t === 'li' && !list) { html += '<ul>'; list = true; }
      if (b.t !== 'li' && list) { html += '</ul>'; list = false; }
      if (b.t === 'h') html += '<h3>' + inlineHtml(b.text, names, style) + '</h3>';
      else if (b.t === 'li') html += '<li>' + (b.lead ? '<strong>' + inlineHtml(b.lead, names, style) + ':</strong> ' : '') + inlineHtml(b.text, names, style) + '</li>';
      else html += '<p>' + inlineHtml(b.text, names, style) + '</p>';
    });
    if (list) html += '</ul>';
    return html;
  }

  /** Plain text for the clipboard — what a person pastes into Splose or an email. */
  function docToPlain(doc, names, style) {
    var lines = [];
    (doc && doc.blocks || []).forEach(function (b, i) {
      var prev = doc.blocks[i - 1];
      if (b.t === 'h') { if (lines.length) lines.push(''); lines.push(restoreText(b.text, names, style) + ':'); return; }
      if (b.t === 'li') { lines.push('• ' + (b.lead ? restoreText(b.lead, names, style) + ': ' : '') + restoreText(b.text, names, style)); return; }
      if (prev && prev.t !== 'h') lines.push('');
      lines.push(restoreText(b.text, names, style));
    });
    return lines.join('\n');
  }

  /** Rich HTML for the clipboard: real names, no spans. */
  function docToClipboardHtml(doc, names, style) {
    var noTok = { blocks: (doc && doc.blocks || []).map(function (b) {
      var o = { t: b.t, text: restoreText(b.text, names, style) };
      if (b.lead) o.lead = restoreText(b.lead, names, style);
      return o;
    }) };
    return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:11pt;">' + docToHtml(noTok, {}, style) + '</div>';
  }

  /** Same tokens, same order, same text? (Decides whether an edit needs saving.) */
  function sameDoc(a, b) { return JSON.stringify(a && a.blocks) === JSON.stringify(b && b.blocks); }

  var api = { displayName: displayName, restoreText: restoreText, docToHtml: docToHtml, docToPlain: docToPlain, docToClipboardHtml: docToClipboardHtml, sameDoc: sameDoc, tokenBase: tokenBase };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) return;

  // ── DOM → document ────────────────────────────────────────────────────────
  /** Text of a node with name spans turned back into their tokens. */
  function nodeText(node) {
    if (node.nodeType === 3) return node.nodeValue.replace(/ /g, ' ');
    if (node.nodeType !== 1) return '';
    if (node.dataset && node.dataset.token) return '[' + node.dataset.token + ']';
    if (node.tagName === 'BR') return '\n';
    var s = '';
    for (var i = 0; i < node.childNodes.length; i++) s += nodeText(node.childNodes[i]);
    return s;
  }

  function serialize(root) {
    var blocks = [];
    function pushText(t, text) { text = text.replace(/[ \t]+\n/g, '\n').replace(/\n+$/, '').trim(); if (text) blocks.push({ t: t, text: text }); }
    function walkLi(li) {
      var first = li.firstElementChild;
      var lead = '';
      var clone = li.cloneNode(true);
      if (first && (first.tagName === 'STRONG' || first.tagName === 'B') && li.firstChild === first) {
        lead = nodeText(first).trim().replace(/[:：]\s*$/, '');
        clone.removeChild(clone.firstChild);
      }
      var text = nodeText(clone).replace(/^\s*[:：]?\s*/, '').trim();
      if (lead || text) blocks.push(lead ? { t: 'li', lead: lead, text: text } : { t: 'li', text: text });
    }
    for (var i = 0; i < root.childNodes.length; i++) {
      var n = root.childNodes[i];
      if (n.nodeType === 3) { pushText('p', n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      var tag = n.tagName;
      if (/^H[1-6]$/.test(tag)) pushText('h', nodeText(n));
      else if (tag === 'UL' || tag === 'OL') { for (var j = 0; j < n.children.length; j++) if (n.children[j].tagName === 'LI') walkLi(n.children[j]); }
      else if (tag === 'LI') walkLi(n);
      else pushText('p', nodeText(n)); // P, DIV and anything pasted
    }
    return blocks;
  }

  /** The highlighted part of the editor as tokenised text. */
  function selectionText(range) {
    var div = document.createElement('div');
    div.appendChild(range.cloneContents());
    return nodeText(div).trim();
  }

  // ── The editor ────────────────────────────────────────────────────────────
  var QUICK = [
    ['Rewrite', 'Rewrite this more clearly and professionally'],
    ['Shorter', 'Make this shorter without losing any facts'],
    ['More formal', 'Make this more formal and objective'],
    ['Expand', 'Expand this a little, using only facts already in the document'],
  ];

  /**
   * Mount an editor.
   * opts: { doc, getNames(), getStyle(), onChange(doc), onRevise(passage, instruction, context) → Promise<string>, extraButtons: [[label, fn]] }
   * Returns { el, setDoc(doc), rerender(), doc() }.
   */
  function mount(opts) {
    var current = { kind: opts.doc.kind, title: opts.doc.title || null, blocks: opts.doc.blocks.slice() };
    var el = document.createElement('div');
    el.className = 'oa-doc' + (current.kind === 'casenote' ? ' casenote' : '');
    el.innerHTML = '<div class="oa-doc-bar" role="toolbar" aria-label="Edit document">'
      + '<span class="oa-doc-kind">' + (current.kind === 'casenote' ? 'Case note' : 'Document') + '</span>'
      + '<button type="button" data-cmd="undo" title="Undo" aria-label="Undo">↶</button>'
      + '<button type="button" data-cmd="redo" title="Redo" aria-label="Redo">↷</button>'
      + '<span class="oa-doc-sep"></span>'
      + '<button type="button" data-cmd="bold" title="Bold" aria-label="Bold"><b>B</b></button>'
      + '<button type="button" data-cmd="insertUnorderedList" title="Dot points" aria-label="Dot points">•≡</button>'
      + '<button type="button" data-cmd="heading" title="Heading or normal text" aria-label="Heading or normal text">H</button>'
      + '<span class="oa-doc-gap"></span>'
      + '<span class="oa-doc-status" aria-live="polite"></span>'
      + '<button type="button" class="oa-doc-copy" data-act="copy">Copy</button>'
      + '</div>'
      + '<div class="oa-doc-page" contenteditable="true" spellcheck="true" aria-label="Document — type to edit, highlight to rewrite"></div>'
      + '<div class="oa-doc-menu" hidden role="dialog" aria-label="Rewrite the highlighted text">'
      + QUICK.map(function (q, i) { return '<button type="button" data-quick="' + i + '">' + esc(q[0]) + '</button>'; }).join('')
      + '<form class="oa-doc-ask"><input type="text" placeholder="Or say what to change…" aria-label="What to change"><button type="submit">Go</button></form>'
      + '</div>';
    var page = el.querySelector('.oa-doc-page');
    var menu = el.querySelector('.oa-doc-menu');
    var status = el.querySelector('.oa-doc-status');
    var bar = el.querySelector('.oa-doc-bar');
    (opts.extraButtons || []).forEach(function (b) {
      var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'oa-doc-copy'; btn.textContent = b[0];
      btn.addEventListener('click', function () { b[1](current, btn); });
      bar.appendChild(btn);
    });
    var savedRange = null;

    function render() { page.innerHTML = docToHtml(current, opts.getNames(), opts.getStyle()); }
    function setStatus(t) { status.textContent = t || ''; }
    function changed() {
      var blocks = serialize(page);
      if (!blocks.length) return;
      var next = { kind: current.kind, title: current.title, blocks: blocks };
      if (sameDoc(next, current)) return;
      current = next;
      opts.onChange(current, setStatus);
    }
    var timer = null;
    page.addEventListener('input', function () { setStatus('Editing…'); clearTimeout(timer); timer = setTimeout(changed, 1200); });
    page.addEventListener('blur', function () { clearTimeout(timer); changed(); });

    bar.addEventListener('mousedown', function (e) { if (e.target.closest('button[data-cmd]')) e.preventDefault(); }); // keep the caret in the page
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.dataset.cmd) {
        page.focus();
        if (b.dataset.cmd === 'heading') {
          var block = document.queryCommandValue('formatBlock').toLowerCase();
          document.execCommand('formatBlock', false, /h\d/.test(block) ? 'p' : 'h3');
        } else document.execCommand(b.dataset.cmd, false, null);
        page.dispatchEvent(new Event('input'));
      } else if (b.dataset.act === 'copy') {
        var names = opts.getNames(); var style = opts.getStyle();
        var plain = docToPlain(current, names, style); var rich = docToClipboardHtml(current, names, style);
        var done = function () { b.textContent = 'Copied'; setTimeout(function () { b.textContent = 'Copy'; }, 1400); };
        try {
          if (global.ClipboardItem && navigator.clipboard.write) {
            navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([rich], { type: 'text/html' }), 'text/plain': new Blob([plain], { type: 'text/plain' }) })]).then(done, function () { navigator.clipboard.writeText(plain).then(done); });
          } else navigator.clipboard.writeText(plain).then(done);
        } catch (x) { navigator.clipboard.writeText(plain).then(done); }
      }
    });

    // Pasted text arrives as plain text, so foreign styling never gets in.
    page.addEventListener('paste', function (e) {
      var t = (e.clipboardData || global.clipboardData).getData('text/plain');
      if (t === undefined) return;
      e.preventDefault();
      document.execCommand('insertText', false, t);
    });

    // ── Highlight to rewrite ──
    function hideMenu() { menu.hidden = true; savedRange = null; }
    function showMenu() {
      var sel = global.getSelection();
      if (!sel.rangeCount || sel.isCollapsed) return hideMenu();
      var r = sel.getRangeAt(0);
      if (!page.contains(r.commonAncestorContainer)) return hideMenu();
      if (selectionText(r).length < 3) return hideMenu();
      savedRange = r.cloneRange();
      var box = r.getBoundingClientRect(); var host = el.getBoundingClientRect();
      menu.hidden = false;
      var left = Math.max(8, Math.min(box.left - host.left, host.width - menu.offsetWidth - 8));
      menu.style.left = left + 'px';
      menu.style.top = (box.bottom - host.top + 8) + 'px';
    }
    page.addEventListener('mouseup', function () { setTimeout(showMenu, 0); });
    page.addEventListener('keyup', function (e) { if (e.shiftKey || e.key === 'Escape') setTimeout(e.key === 'Escape' ? hideMenu : showMenu, 0); });
    document.addEventListener('mousedown', function (e) { if (!menu.hidden && !menu.contains(e.target) && !page.contains(e.target)) hideMenu(); });

    function revise(instruction) {
      if (!savedRange) return;
      var range = savedRange; var passage = selectionText(range);
      changed(); // the context the AI sees is what is on the page now
      var context = docToPlainTokens(current);
      hideMenu();
      el.classList.add('revising'); setStatus('Rewriting…');
      opts.onRevise(passage, instruction, context).then(function (text) {
        el.classList.remove('revising');
        if (!text) { setStatus('Could not rewrite that — try again'); return; }
        var sel = global.getSelection(); sel.removeAllRanges(); sel.addRange(range);
        // One paragraph/dot point stays inline; the reply's own line breaks become <br>.
        document.execCommand('insertHTML', false, inlineHtml(text, opts.getNames(), opts.getStyle()));
        setStatus('');
        changed();
      }, function (err) {
        el.classList.remove('revising');
        setStatus((err && err.message) || 'Could not rewrite that — try again');
      });
    }
    menu.addEventListener('mousedown', function (e) { if (e.target.tagName === 'BUTTON') e.preventDefault(); });
    menu.addEventListener('click', function (e) { var b = e.target.closest('button[data-quick]'); if (b) revise(QUICK[+b.dataset.quick][1]); });
    menu.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault(); var v = e.target.querySelector('input').value.trim(); if (v) { revise(v); e.target.querySelector('input').value = ''; }
    });

    render();
    return {
      el: el,
      doc: function () { return current; },
      setDoc: function (d) { current = { kind: d.kind, title: d.title || null, blocks: d.blocks.slice() }; render(); },
      rerender: render,
      status: setStatus,
    };
  }

  /** The document as tokenised plain text (context for a rewrite). */
  function docToPlainTokens(doc) {
    return (doc.blocks || []).map(function (b) { return b.t === 'h' ? b.text + ':' : b.t === 'li' ? '• ' + (b.lead ? b.lead + ': ' : '') + b.text : b.text; }).join('\n');
  }

  api.mount = mount; api.serialize = serialize; api.docToPlainTokens = docToPlainTokens;
  global.OpalAssistDoc = api;
})(typeof window !== 'undefined' ? window : globalThis);
