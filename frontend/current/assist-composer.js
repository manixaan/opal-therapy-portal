/**
 * Opal Assist — the message box. No framework.
 *
 * One rounded box, like a modern chat composer:
 *   - the text area grows as you type (to about 40% of the window, then it
 *     scrolls) and shrinks back after sending;
 *   - + attaches a picture (chosen, dropped or pasted): shrunk here, its TEXT
 *     read by the portal's own OCR (no AI), and attached as text — the picture
 *     itself never reaches the model;
 *   - + attaches a file: .txt .md .csv .docx .pdf, READ IN THIS BROWSER (the
 *     portal's own pdf.js and jszip) — only the text is kept, and it goes
 *     through the same name check as the message before anything is sent.
 *     A SCANNED PDF's pages (no text layer) are drawn here and read by the
 *     portal's OCR one page at a time, like a picture (up to 15 pages);
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

  // ── Scanned PDFs ──────────────────────────────────────────────────────────
  // A page whose text layer is (nearly) empty is a scan or a photo. Those
  // pages are drawn here (pdf.js) and read by the portal's own OCR, one page at
  // a time, exactly like an attached picture — only the TEXT is kept.
  var MIN_PAGE_CHARS = 20;      // fewer non-space characters than this = no real text layer
  var MAX_SCAN_PAGES = 15;      // OCR is slow and shared; a longer scan is cut, and says so
  var SCAN_SIDE = 2400;         // same ceiling as a picture

  /** Which pages (1-based) need reading by OCR. */
  function pagesNeedingOcr(pageTexts) {
    var out = [];
    (pageTexts || []).forEach(function (t, i) { if (String(t || '').replace(/\s+/g, '').length < MIN_PAGE_CHARS) out.push(i + 1); });
    return out;
  }
  /** The render scale for a page of this size (at scale 1): long side about SCAN_SIDE px, never more than 3x. */
  function scanScale(width, height) {
    var side = Math.max(width || 0, height || 0);
    return side > 0 ? Math.min(3, SCAN_SIDE / side) : 1;
  }
  /** The PDF's text: each page's own text, or what OCR read from it. Empty pages drop out. */
  function joinPages(pageTexts, ocrTexts) {
    return (pageTexts || []).map(function (t, i) {
      var o = ocrTexts && ocrTexts[i + 1];
      return String(o != null ? o : t || '').trim();
    }).filter(Boolean).join('\n\n');
  }

  var api = { estimateTokens: estimateTokens, contextBand: contextBand, docxXmlToText: docxXmlToText,
    pagesNeedingOcr: pagesNeedingOcr, scanScale: scanScale, joinPages: joinPages, MAX_SCAN_PAGES: MAX_SCAN_PAGES };
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
  function readPdf(file, progress) {
    var lib = pdfjs ? Promise.resolve(pdfjs) : import('/vendor/pdfjs/pdf.min.mjs').then(function (m) {
      pdfjs = m; pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return pdfjs;
    });
    return Promise.all([lib, file.arrayBuffer()]).then(function (r) { return r[0].getDocument({ data: r[1] }).promise; }).then(function (doc) {
      var pages = []; var chain = Promise.resolve();
      for (var i = 1; i <= Math.min(doc.numPages, 60); i++) {
        (function (n) { chain = chain.then(function () { return doc.getPage(n); }).then(function (p) { return p.getTextContent(); }).then(function (tc) { pages.push(tc.items.map(function (it) { return it.str + (it.hasEOL ? '\n' : ''); }).join('')); }); })(i);
      }
      return chain.then(function () {
        var scanned = pagesNeedingOcr(pages);
        if (!scanned.length) return joinPages(pages);
        var todo = scanned.slice(0, MAX_SCAN_PAGES); var ocr = {}; var conf = []; var failed = 0;
        var run = Promise.resolve();
        todo.forEach(function (n, k) {
          run = run.then(function () {
            if (progress) progress('Reading scanned page ' + (k + 1) + ' of ' + todo.length + '…');
            return doc.getPage(n).then(renderPageJpeg).then(ocrJpeg).then(function (r) { ocr[n] = r.text; if (r.confidence != null) conf.push(r.confidence); }, function () { failed += 1; });
          });
        });
        return run.then(function () {
          var text = joinPages(pages, ocr);
          if (!text) throw new Error('The text in this scanned PDF could not be read.');
          return {
            text: text, scannedPages: todo.length - failed, skippedPages: scanned.length - todo.length, failedPages: failed,
            confidence: conf.length ? Math.round(conf.reduce(function (a, b) { return a + b; }, 0) / conf.length) : null,
          };
        });
      });
    });
  }
  /** One PDF page drawn white-backed into a JPEG, about 2400 px on its long side. */
  function renderPageJpeg(page) {
    var base = page.getViewport({ scale: 1 });
    var vp = page.getViewport({ scale: scanScale(base.width, base.height) });
    var c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    return page.render({ canvasContext: g, viewport: vp }).promise.then(function () {
      return new Promise(function (resolve, reject) { c.toBlob(function (b) { c.width = c.height = 0; if (b) resolve(b); else reject(new Error('page')); }, 'image/jpeg', 0.9); });
    });
  }
  /** The portal's OCR on one JPEG; waits and tries again while it is busy with someone else's. */
  function ocrJpeg(jpeg, attempt) {
    attempt = attempt || 0;
    return fetch('/api/assist/read-image', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'image/jpeg' }, body: jpeg }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (res.status === 503 && j.error === 'ocr_busy' && attempt < 4) return new Promise(function (r) { setTimeout(r, 1500 * (attempt + 1)); }).then(function () { return ocrJpeg(jpeg, attempt + 1); });
        if (!res.ok) throw new Error(j.message || j.answer || 'This picture could not be read just now.');
        return { text: j.text || '', confidence: j.confidence };
      });
    });
  }
  // Pictures: shrunk and re-encoded HERE (any format this browser can show —
  // HEIC on a Mac, WebP, GIF — becomes a JPEG of at most 2400 px), then read by
  // the portal's own OCR on the server (read-image: no AI, nothing stored). Only
  // the TEXT is attached, so it is checked for names like any other file; the
  // picture itself never goes to the AI.
  var IMAGE_EXT = ['png', 'jpg', 'jpeg', 'heic', 'heif', 'webp', 'gif', 'bmp'];
  var MAX_IMAGE_SIDE = 2400;
  function isImage(file) { return /^image\//.test(file.type || '') || IMAGE_EXT.indexOf(((file.name || '').split('.').pop() || '').toLowerCase()) >= 0; }
  function imageToJpeg(file) {
    var bitmap = global.createImageBitmap ? global.createImageBitmap(file).catch(function () { return null; }) : Promise.resolve(null);
    return bitmap.then(function (bmp) {
      if (bmp) return bmp;
      return new Promise(function (resolve, reject) {
        var url = URL.createObjectURL(file); var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = function () { URL.revokeObjectURL(url); reject(new Error((file.name || 'This picture') + ' could not be opened in this browser.')); };
        img.src = url;
      });
    }).then(function (src) {
      var w = src.width; var h = src.height; var k = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(src, 0, 0, c.width, c.height);
      if (src.close) src.close();
      return new Promise(function (resolve, reject) { c.toBlob(function (b) { if (b) resolve(b); else reject(new Error('This picture could not be prepared.')); }, 'image/jpeg', 0.92); });
    });
  }
  // Pictures and scanned PDF pages share one door to the OCR (ocrJpeg, above).
  function readImage(file) { return imageToJpeg(file).then(function (jpeg) { return ocrJpeg(jpeg); }); }

  function readFile(file, progress) {
    var name = file.name || 'file'; var ext = (name.split('.').pop() || '').toLowerCase();
    if (file.size > 15 * 1024 * 1024) return Promise.reject(new Error(name + ' is too large to attach.'));
    if (isImage(file)) return readImage(file);
    if (ext === 'docx') return readDocx(file);
    if (ext === 'pdf') return readPdf(file, progress);
    if (['txt', 'md', 'csv', 'text'].indexOf(ext) >= 0 || /^text\//.test(file.type)) return file.text();
    return Promise.reject(new Error(name + ': only pictures and .txt, .md, .csv, .docx and .pdf files can be attached.'));
  }
  function usedAttachmentChars() { return C.attachments.reduce(function (n, a) { return n + a.text.length; }, 0); }
  function addFiles(files) {
    Array.prototype.forEach.call(files || [], function (file) {
      var item = { name: file.name || 'Pasted picture', text: '', loading: true, picture: isImage(file) };
      C.attachments.push(item); renderAttachments();
      readFile(file, function (msg) { item.progress = msg; renderAttachments(); }).then(function (text) {
        if (text && typeof text === 'object') {
          item.confidence = text.confidence;
          if (text.scannedPages !== undefined) { item.scanned = text.scannedPages; item.skipped = text.skippedPages; item.failedPages = text.failedPages; }
          text = text.text;
        }
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
      var meta = a.loading ? esc(a.progress || (a.picture ? 'Reading the text in this picture…' : 'Reading…')) : a.error ? esc(a.error)
        : ((a.picture ? 'Text read from picture: ' : '') + (a.scanned ? 'Scanned — text read from ' + a.scanned + (a.scanned === 1 ? ' page' : ' pages') + ': ' : '')
          + a.text.length.toLocaleString() + ' characters' + (a.cut ? ' (cut to fit)' : '')
          + (a.skipped ? ' — only the first ' + MAX_SCAN_PAGES + ' scanned pages were read' : '')
          + (a.failedPages ? ' — ' + a.failedPages + (a.failedPages === 1 ? ' page' : ' pages') + ' could not be read' : '')
          + ((a.picture || a.scanned) && a.confidence != null && a.confidence < 70 ? ' — hard to read, check the reply' : ''));
      return '<span class="oa-att' + (a.error ? ' bad' : '') + '"><span class="oa-att-name">' + esc(a.name) + '</span><small>' + meta + '</small>'
        + '<button type="button" data-att-remove="' + i + '" aria-label="Remove ' + esc(a.name) + '">×</button></span>';
    }).join('');
    el.hidden = !C.attachments.length;
  }
  /** The attached text as one block for the check, or ''. */
  function attachmentsText() {
    return C.attachments.filter(function (a) { return a.text && !a.error; }).map(function (a) {
      return (a.picture ? '--- Text read from attached picture: ' : a.scanned ? '--- Text read from attached scanned PDF: ' : '--- Attached file: ') + a.name + ' ---\n' + a.text;
    }).join('\n\n');
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
    if (C.onState) C.onState(C.dictation, C.listening);
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
    var ta = C.target || $('oa-input'); var start = ta.selectionStart; var end = ta.selectionEnd; var before = ta.value.slice(0, start);
    var piece = (before && !/\s$/.test(before) ? ' ' : '') + text.trim();
    ta.value = before + piece + ta.value.slice(end);
    ta.selectionStart = ta.selectionEnd = start + piece.length;
    if (C.target) { if (C.targetChanged) C.targetChanged(); return; }
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
    (C.target || $('oa-input')).focus();
  }
  function stopDictation() { C.listening = false; if (C.rec) { try { C.rec.stop(); } catch (x) { /* already stopped */ } } C.rec = null; renderMic(); }
  /**
   * Point dictation at another text box (the notes-owing panel) until
   * release(). Same engine, same on-device-only rule; onState(state,
   * listening) lets that panel draw its own microphone.
   */
  function dictateInto(textarea, opts) {
    stopDictation();
    C.target = textarea; C.targetChanged = opts && opts.onChange; C.onState = opts && opts.onState;
    renderMic();
    return {
      toggle: function () { if (C.target !== textarea) return; if (C.listening) stopDictation(); else startDictation(); },
      release: function () { if (C.target !== textarea) return; stopDictation(); C.target = null; C.targetChanged = null; C.onState = null; renderMic(); },
    };
  }

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
      // A pasted screenshot or copied photo attaches like a chosen picture; pasted text is left alone.
      ta.addEventListener('paste', function (e) {
        var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], isImage);
        if (files.length) { e.preventDefault(); addFiles(files); }
      });
      $('oa-attachments').addEventListener('click', function (e) { var b = e.target.closest('[data-att-remove]'); if (b) { C.attachments.splice(+b.dataset.attRemove, 1); renderAttachments(); changed(); } });
    }
    $('oa-mic').addEventListener('click', function () { if (C.target) return; if (C.listening) stopDictation(); else startDictation(); });
    probeDictation();
    renderAttachments(); autosize();
  }

  api.init = init; api.autosize = autosize; api.attachmentsText = attachmentsText; api.clearAttachments = clearAttachments;
  api.setModel = setModel; api.renderContext = renderContext; api.stopDictation = stopDictation; api.dictateInto = dictateInto;
  /** 'ready' | 'installable' | 'installing' | 'unavailable' */
  api.dictationState = function () { return C.dictation; };
  /** The server's attachment cap (from the Assist config), applied once known. */
  api.setMaxAttachmentChars = function (n) { if (n > 0) C.maxAttachmentChars = n; };
  api.busyReading = function () { return C.attachments.some(function (a) { return a.loading; }); };
  /** Characters still free for attachments in this message. */
  api.roomLeft = function () { return Math.max(0, C.maxAttachmentChars - usedAttachmentChars()); };
  /** Attach text the page already has (the client file). Cut to the room left; checked for names like any file. */
  api.addText = function (name, text) {
    var room = api.roomLeft(); text = String(text || '');
    if (!text.trim()) return false;
    var item = { name: name, text: text.slice(0, room), cut: text.length > room };
    if (room <= 0) { item.text = ''; item.error = 'No room left: attachments are limited to ' + C.maxAttachmentChars.toLocaleString() + ' characters a message.'; }
    C.attachments.push(item); renderAttachments(); changed();
    return !item.error;
  };
  global.OpalAssistComposer = api;
})(typeof window !== 'undefined' ? window : globalThis);
