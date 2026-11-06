/**
 * Opal Assist — the message box. No framework.
 *
 * One rounded box, like a modern chat composer:
 *   - the text area grows as you type (to about 40% of the window, then it
 *     scrolls) and shrinks back after sending;
 *   - + attaches a file: .txt .md .csv .docx .pdf, READ IN THIS BROWSER (the
 *     portal's own pdf.js and jszip) — only the text is kept, and it goes
 *     through the same name check as the message before anything is sent;
 *   - the microphone dictates ON-DEVICE ONLY (the browser's processLocally
 *     switch, as in the Case Notes composer) — where a browser cannot promise
 *     that, there is no microphone button at all;
 *   - beside the send button: the model this chat runs on, and a ring showing
 *     roughly how much of its context the chat already uses.
 *
 * This file makes no network call of its own except loading the portal's
 * vendored readers; sending stays in assist.js, behind the check.
 */
(function (global) {
  'use strict';

  /** Rough token count for text: about four characters a token. */
  function estimateTokens(text) { return Math.ceil(String(text || '').length / 4); }

  /** The visible fraction for the ring, 0..1, and its band. */
  function contextBand(used, total) {
    var f = total > 0 ? Math.min(1, used / total) : 0;
    return { fraction: f, band: f >= 0.85 ? 'full' : f >= 0.6 ? 'high' : 'ok' };
  }

  /** Plain text of a .docx (word/document.xml): one line per paragraph, tabs and breaks kept. */
  function docxXmlToText(xml) {
    return String(xml || '')
      .replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  var api = { estimateTokens: estimateTokens, contextBand: contextBand, docxXmlToText: docxXmlToText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) return;

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var C = { attachments: [], maxAttachmentChars: 20000, listening: false, rec: null, lang: 'en-AU', dictation: 'unavailable', opts: null };

  // ── Growing text area ─────────────────────────────────────────────────────
  function autosize() {
    var ta = $('oa-input'); if (!ta) return;
    ta.style.height = 'auto';
    var max = Math.round(global.innerHeight * 0.4);
    ta.style.height = Math.min(ta.scrollHeight, max) + 'px';
    ta.style.overflowY = ta.scrollHeight > max ? 'auto' : 'hidden';
  }

  // ── Attachments: read here, text only ─────────────────────────────────────
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      if (document.querySelector('script[data-src="' + src + '"]')) return resolve();
      var s = document.createElement('script'); s.src = src; s.dataset.src = src; s.onload = resolve; s.onerror = reject; document.head.appendChild(s);
    });
  }
  function readDocx(file) {
    return (global.JSZip ? Promise.resolve() : loadScript('/vendor/jszip.min.js'))
      .then(function () { return global.JSZip.loadAsync(file); })
      .then(function (zip) { var f = zip.file('word/document.xml'); if (!f) throw new Error('This Word file has no text.'); return f.async('string'); })
      .then(docxXmlToText);
  }
  var pdfjs = null;
  function readPdf(file) {
    var lib = pdfjs ? Promise.resolve(pdfjs) : import('/vendor/pdfjs/pdf.min.mjs').then(function (m) {
      pdfjs = m; pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return pdfjs;
    });
    return Promise.all([lib, file.arrayBuffer()]).then(function (r) { return r[0].getDocument({ data: r[1] }).promise; }).then(function (doc) {
      var pages = []; var chain = Promise.resolve();
      for (var i = 1; i <= Math.min(doc.numPages, 60); i++) {
        (function (n) { chain = chain.then(function () { return doc.getPage(n); }).then(function (p) { return p.getTextContent(); }).then(function (tc) { pages.push(tc.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ''); }).join('')); }); })(i);
      }
      return chain.then(function () { var t = pages.join('\n\n').trim(); if (!t) throw new Error('This PDF has no text to read (it may be a scan).'); return t; });
    });
  }
  function readFile(file) {
    var name = file.name || 'file'; var ext = (name.split('.').pop() || '').toLowerCase();
    if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error(name + ' is too large to attach.'));
    if (ext === 'docx') return readDocx(file);
    if (ext === 'pdf') return readPdf(file);
    if (['txt', 'md', 'csv', 'text'].indexOf(ext) >= 0 || /^text\//.test(file.type)) return file.text();
    return Promise.reject(new Error(name + ': only .txt, .md, .csv, .docx and .pdf files can be attached.'));
  }
  function usedAttachmentChars() { return C.attachments.reduce(function (n, a) { return n + a.text.length; }, 0); }
  function addFiles(files) {
    Array.prototype.forEach.call(files || [], function (file) {
      var item = { name: file.name, text: '', loading: true };
      C.attachments.push(item); renderAttachments();
      readFile(file).then(function (text) {
        var room = C.maxAttachmentChars - usedAttachmentChars();
        item.loading = false;
        if (room <= 0) { item.error = 'No room left: attachments are limited to ' + C.maxAttachmentChars.toLocaleString() + ' characters a message.'; }
        else { item.text = String(text).slice(0, room); item.cut = String(text).length > room; }
        renderAttachments(); changed();
      }, function (err) { item.loading = false; item.error = (err && err.message) || 'Could not read that file.'; renderAttachments(); });
    });
  }
  function renderAttachments() {
    var el = $('oa-attachments'); if (!el) return;
    el.innerHTML = C.attachments.map(function (a, i) {
      var meta = a.loading ? 'Reading…' : a.error ? esc(a.error) : (a.text.length.toLocaleString() + ' characters' + (a.cut ? ' (cut to fit)' : ''));
      return '<span class="oa-att' + (a.error ? ' bad' : '') + '"><span class="oa-att-name">' + esc(a.name) + '</span><small>' + meta + '</small>'
        + '<button type="button" data-att-remove="' + i + '" aria-label="Remove ' + esc(a.name) + '">×</button></span>';
    }).join('');
    el.hidden = !C.attachments.length;
  }
  /** The attached text as one block for the check, or ''. */
  function attachmentsText() {
    return C.attachments.filter(function (a) { return a.text && !a.error; }).map(function (a) { return '--- Attached file: ' + a.name + ' ---\n' + a.text; }).join('\n\n');
  }
  function clearAttachments() { C.attachments = []; renderAttachments(); changed(); }

  // ── Dictation: on-device or not at all ────────────────────────────────────
  function speechCtor() { return global.SpeechRecognition || global.webkitSpeechRecognition || null; }
  function canPromiseLocal(Ctor) { return !!(Ctor && typeof Ctor.available === 'function' && Ctor.prototype && 'processLocally' in Ctor.prototype); }
  function renderMic() {
    var b = $('oa-mic'); if (!b) return;
    b.hidden = !(C.dictation === 'ready' || C.dictation === 'installable' || C.dictation === 'installing');
    b.classList.toggle('on', C.listening);
    b.title = C.listening ? 'Stop dictating' : C.dictation === 'installable' ? 'Set up on-device dictation (one download, then speech never leaves this computer)' : C.dictation === 'installing' ? 'Setting up dictation…' : 'Dictate — speech is turned into text on this computer only';
    b.setAttribute('aria-pressed', C.listening ? 'true' : 'false');
  }
  function probeDictation() {
    var Ctor = speechCtor();
    if (!canPromiseLocal(Ctor)) { C.dictation = 'unavailable'; renderMic(); return; }
    var langs = ['en-AU', 'en-GB', 'en-US']; var i = 0; var installable = '';
    (function next() {
      if (i >= langs.length) { C.dictation = installable && typeof Ctor.install === 'function' ? 'installable' : 'unavailable'; if (installable) C.lang = installable; renderMic(); return; }
      var lang = langs[i++];
      Promise.resolve(Ctor.available({ langs: [lang], processLocally: true })).then(function (st) {
        if (st === 'available') { C.dictation = 'ready'; C.lang = lang; renderMic(); return; }
        if (!installable && (st === 'downloadable' || st === 'downloading')) installable = lang;
        next();
      }, next);
    })();
  }
  function insertAtCursor(text) {
    var ta = $('oa-input'); var start = ta.selectionStart; var end = ta.selectionEnd; var before = ta.value.slice(0, start);
    var piece = (before && !/\s$/.test(before) ? ' ' : '') + text.trim();
    ta.value = before + piece + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + piece.length;
    autosize(); changed();
  }
  function startDictation() {
    var Ctor = speechCtor();
    if (C.dictation === 'installable') {
      C.dictation = 'installing'; renderMic();
      Promise.resolve(Ctor.install({ langs: [C.lang], processLocally: true })).then(function (ok) { C.dictation = ok ? 'ready' : 'unavailable'; renderMic(); }, function () { C.dictation = 'unavailable'; renderMic(); });
      return;
    }
    if (C.dictation !== 'ready' || C.listening) return;
    var rec;
    try {
      rec = new Ctor(); rec.lang = C.lang; rec.continuous = true; rec.interimResults = false; rec.processLocally = true;
      if (rec.processLocally !== true) throw new Error('not_local'); // fail closed
    } catch (e) { C.dictation = 'unavailable'; renderMic(); return; }
    rec.onresult = function (e) { for (var i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) insertAtCursor(e.results[i][0].transcript); };
    rec.onerror = function (e) { if (e && (e.error === 'no-speech' || e.error === 'aborted')) return; stopDictation(); };
    rec.onend = function () { if (C.listening) { try { rec.start(); } catch (x) { stopDictation(); } } };
    C.rec = rec; C.listening = true; renderMic();
    try { rec.start(); } catch (x) { stopDictation(); }
    $('oa-input').focus();
  }
  function stopDictation() { C.listening = false; if (C.rec) { try { C.rec.stop(); } catch (x) { /* already stopped */ } } C.rec = null; renderMic(); }

  // ── Model and context ─────────────────────────────────────────────────────
  function setModel(model) {
    var el = $('oa-model'); if (!el) return;
    if (!model) { el.hidden = true; return; }
    el.hidden = false;
    el.textContent = model.name;
    el.title = model.name + (model.host ? ' on ' + model.host : '') + (model.residency ? ', in ' + model.residency : '') + '. Names and contact details are hidden before anything is sent.';
    C.contextTokens = model.contextTokens || 200000;
    changed();
  }
  function renderContext(used) {
    var el = $('oa-context'); if (!el || !C.contextTokens) { if (el) el.hidden = true; return; }
    var b = contextBand(used, C.contextTokens);
    var r = 7; var circ = 2 * Math.PI * r;
    el.hidden = false;
    el.className = 'oa-context ' + b.band;
    el.innerHTML = '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><circle cx="9" cy="9" r="' + r + '" class="track"/><circle cx="9" cy="9" r="' + r + '" class="fill" stroke-dasharray="' + (circ * Math.max(b.fraction, 0.02)).toFixed(2) + ' ' + circ.toFixed(2) + '" transform="rotate(-90 9 9)"/></svg>';
    var pct = Math.round(b.fraction * 100);
    var text = 'This chat uses about ' + used.toLocaleString() + ' of ' + C.contextTokens.toLocaleString() + ' tokens (' + (pct < 1 ? 'under 1' : pct) + '%).'
      + (b.band === 'full' ? ' It is nearly full — start a new chat for the next piece of work.' : ' Each message sends the recent conversation with it.');
    el.title = text; el.setAttribute('aria-label', text);
  }
  function changed() { if (C.opts && C.opts.onChange) C.opts.onChange(); }

  // ── Wiring ────────────────────────────────────────────────────────────────
  function init(opts) {
    C.opts = opts || {};
    if (opts.maxAttachmentChars) C.maxAttachmentChars = opts.maxAttachmentChars;
    var ta = $('oa-input');
    ta.addEventListener('input', function () { autosize(); changed(); });
    global.addEventListener('resize', autosize);
    if (opts.attachments !== false) {
      $('oa-attach').hidden = false;
      $('oa-attach').addEventListener('click', function () { $('oa-file').click(); });
      $('oa-file').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
      var box = $('oa-composer');
      box.addEventListener('dragover', function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') >= 0) { e.preventDefault(); box.classList.add('drop'); } });
      box.addEventListener('dragleave', function () { box.classList.remove('drop'); });
      box.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); box.classList.remove('drop'); addFiles(e.dataTransfer.files); } });
      $('oa-attachments').addEventListener('click', function (e) { var b = e.target.closest('[data-att-remove]'); if (b) { C.attachments.splice(+b.dataset.attRemove, 1); renderAttachments(); changed(); } });
    }
    $('oa-mic').addEventListener('click', function () { if (C.listening) stopDictation(); else startDictation(); });
    probeDictation();
    renderAttachments(); autosize();
  }

  api.init = init; api.autosize = autosize; api.attachmentsText = attachmentsText; api.clearAttachments = clearAttachments;
  api.setModel = setModel; api.renderContext = renderContext; api.stopDictation = stopDictation;
  api.busyReading = function () { return C.attachments.some(function (a) { return a.loading; }); };
  global.OpalAssistComposer = api;
})(typeof window !== 'undefined' ? window : globalThis);
