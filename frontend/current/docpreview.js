/**
 * DocPreview — the shared in-browser document viewer.
 *
 * One overlay viewer for any stored document the portal serves inline:
 * Resource Hub files today, and any future surface that has an authenticated
 * bytes URL. It deliberately reuses the two renderers the portal already
 * vendors on-origin — pdf.js (the WHODAS pattern) for PDFs, docx-preview (the
 * FCA report pattern) for Word files — so no document ever triggers a CDN
 * request, and no third renderer needs vendoring.
 *
 * What this is NOT: the FCA live-recompose loop. Resource files are static
 * bytes, so there is no debounce, revision guard or re-render-on-edit here —
 * fetch once, render, page/zoom locally. (fca.js keeps its own driver; see
 * the extraction notes in that file's preview section.)
 *
 * Contract:
 *   DocPreview.open({
 *     kind: 'pdf' | 'docx',       // which renderer
 *     url: '/api/rh2/files/<id>/preview',  // authenticated inline bytes
 *     title: 'Sensory Worksheet',
 *     downloadUrl: '/api/rh2/files/<id>',  // optional Download button
 *     meta: 'PDF · 1.2 MB · Publisher',    // optional caption line
 *   })
 *   DocPreview.close()
 *
 * PDF zoom re-renders pages at the new scale (canvas stays crisp); DOCX zoom
 * is a CSS transform on the rendered sheet (it is DOM, so it scales cleanly).
 * Keyboard: Escape closes, +/- zoom. Focus returns to the opener.
 *
 * Self-contained on purpose: styles are injected once by this file, so a page
 * only needs the two vendor scripts and this one file — no CSS load-order
 * coupling with the hub stylesheet.
 */
(function (global) {
  'use strict';
  var doc = global && global.document;
  if (!doc) return;

  var PDFJS_SRC = '/vendor/pdfjs/pdf.min.mjs';
  var PDFJS_WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';

  var S = {
    open: false,
    kind: null,
    url: null,
    downloadUrl: null,
    title: '',
    meta: '',
    zoom: 1,          // 1 = fit width
    pdf: null,        // pdf.js document
    pdfjsLib: null,
    pages: 0,
    rendering: false,
    renderToken: 0,
    opener: null,     // element to restore focus to
    abort: null,
  };

  var CSS = [
    '.dp-overlay{position:fixed;inset:0;z-index:1400;background:rgba(20,24,23,.72);display:flex;flex-direction:column;}',
    '.dp-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--panel,#fff);border-bottom:1px solid var(--border,#dce3e0);flex-wrap:wrap;}',
    '.dp-title{font-weight:600;color:var(--ink,#1c2a27);margin-right:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:40vw;}',
    '.dp-meta{color:var(--ink-soft,#5c6f6a);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:30vw;}',
    '.dp-spacer{flex:1;}',
    '.dp-btn{border:1px solid var(--border,#dce3e0);background:var(--panel,#fff);color:var(--ink,#1c2a27);border-radius:8px;padding:6px 12px;font-size:13px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:6px;}',
    '.dp-btn:hover{border-color:var(--accent,#0f7c6c);color:var(--accent-deep,#0a5a4e);}',
    '.dp-btn:focus-visible{outline:var(--focus-ring,2px solid #0f7c6c);outline-offset:1px;}',
    '.dp-zoom{min-width:52px;text-align:center;color:var(--ink-soft,#5c6f6a);font-size:12.5px;font-variant-numeric:tabular-nums;}',
    '.dp-stage{flex:1;overflow:auto;padding:20px;display:block;text-align:center;-webkit-overflow-scrolling:touch;}',
    '.dp-sheet{display:inline-block;text-align:center;transform-origin:top center;}',
    '.dp-page{background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);margin:0 auto 16px;display:block;max-width:100%;}',
    '.dp-status{color:#fff;padding:40px 20px;font-size:14.5px;text-align:center;}',
    '.dp-status .dp-btn{margin-top:14px;}',
    // docx-preview injects its own sheet styling; contain it to white pages.
    '.dp-docx-render{background:transparent;}',
    // text-align:center on the stage/sheet is for centring the PAGE, not its
    // words: a Word paragraph with no alignment is left-aligned.
    '.dp-docx-render section{background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.35);margin:0 auto 16px;text-align:left;box-sizing:border-box;flex:none;}',
    // The shell styles bare <header> as position:sticky with a white background
    // and a high z-index; docx-preview emits a <header> per page for the
    // running header, which then floated over the letterhead. Undo it here.
    '.dp-docx-render section > header, .dp-docx-render section > footer{position:static !important;display:block;padding:0;margin:0;background:transparent !important;border:0 !important;box-shadow:none !important;height:auto !important;z-index:auto !important;}',
    '@media (max-width:700px){.dp-title{max-width:60vw;}.dp-meta{display:none;}.dp-stage{padding:10px;}}',
  ].join('\n');

  function ensureStyles() {
    if (doc.getElementById('dp-styles')) return;
    var s = doc.createElement('style');
    s.id = 'dp-styles';
    s.textContent = CSS;
    doc.head.appendChild(s);
  }

  function esc(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function overlayEl() { return doc.getElementById('dp-overlay'); }
  function stageEl() { return doc.getElementById('dp-stage'); }

  function toolbar() {
    return '<div class="dp-bar">'
      + '<span class="dp-title" id="dp-title">' + esc(S.title) + '</span>'
      + (S.meta ? '<span class="dp-meta">' + esc(S.meta) + '</span>' : '')
      + '<span class="dp-spacer"></span>'
      + '<button type="button" class="dp-btn" data-dp="zoom-out" aria-label="Zoom out">−</button>'
      + '<span class="dp-zoom" id="dp-zoom" aria-live="polite">' + Math.round(S.zoom * 100) + '%</span>'
      + '<button type="button" class="dp-btn" data-dp="zoom-in" aria-label="Zoom in">+</button>'
      + '<button type="button" class="dp-btn" data-dp="zoom-fit">Fit</button>'
      + (S.downloadUrl
        ? '<a class="dp-btn" href="' + esc(S.downloadUrl) + '" download>Download</a>' : '')
      + '<button type="button" class="dp-btn" data-dp="close" aria-label="Close preview">Close</button>'
      + '</div>';
  }

  function mount() {
    ensureStyles();
    var el = doc.createElement('div');
    el.id = 'dp-overlay';
    el.className = 'dp-overlay';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-labelledby', 'dp-title');
    el.innerHTML = toolbar()
      + '<div class="dp-stage" id="dp-stage"><div class="dp-status" role="status">Loading preview…</div></div>';
    doc.body.appendChild(el);
    el.addEventListener('click', onClick);
    // Click outside the document closes it. Remembering where the press
    // started means a text selection that ends on the backdrop does not.
    el.addEventListener('mousedown', function (e) { S.pressedBackdrop = isBackdrop(e.target); });
    doc.addEventListener('keydown', onKey, true);
    var closeBtn = el.querySelector('[data-dp="close"]');
    if (closeBtn) closeBtn.focus();
  }

  /** The dim area around the page — the overlay itself or the empty stage. */
  function isBackdrop(target) {
    if (!target) return false;
    return target.id === 'dp-overlay' || target.id === 'dp-stage' || target.classList.contains('dp-sheet') || target.classList.contains('dp-docx-render-wrapper');
  }

  function onClick(e) {
    if (isBackdrop(e.target) && S.pressedBackdrop) { close(); return; }
    var t = e.target && e.target.closest ? e.target.closest('[data-dp]') : null;
    if (!t) return;
    var act = t.getAttribute('data-dp');
    if (act === 'close') close();
    else if (act === 'zoom-in') setZoom(S.zoom + 0.15);
    else if (act === 'zoom-out') setZoom(S.zoom - 0.15);
    else if (act === 'zoom-fit') setZoom(1);
  }

  function onKey(e) {
    if (!S.open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === '+' || e.key === '=') setZoom(S.zoom + 0.15);
    else if (e.key === '-') setZoom(S.zoom - 0.15);
  }

  function setZoom(z) {
    S.zoom = Math.min(3, Math.max(0.4, Math.round(z * 100) / 100));
    var zEl = doc.getElementById('dp-zoom');
    if (zEl) zEl.textContent = Math.round(S.zoom * 100) + '%';
    if (S.kind === 'pdf') schedulePdfRender();
    else applyDocxZoom();
  }

  function statusHtml(msg, withDownload) {
    return '<div class="dp-status" role="status">' + esc(msg)
      + (withDownload && S.downloadUrl
        ? '<br><a class="dp-btn" href="' + esc(S.downloadUrl) + '" download>Download the original</a>'
        : '')
      + '</div>';
  }

  function fail(msg) {
    var st = stageEl();
    if (st) st.innerHTML = statusHtml(msg || 'Preview unavailable.', true);
  }

  // ── PDF path (pdf.js, canvas per page, re-render on zoom) ────────────────

  function loadPdfJs() {
    if (S.pdfjsLib) return Promise.resolve(S.pdfjsLib);
    return import(PDFJS_SRC).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      S.pdfjsLib = lib;
      return lib;
    });
  }

  function openPdf() {
    loadPdfJs().then(function (lib) {
      return lib.getDocument({ url: S.url, withCredentials: true }).promise;
    }).then(function (pdf) {
      if (!S.open) return;
      S.pdf = pdf;
      S.pages = pdf.numPages;
      renderPdf();
    }).catch(function () {
      fail('This PDF could not be previewed.');
    });
  }

  var pdfRenderTimer = null;
  function schedulePdfRender() {
    if (pdfRenderTimer) clearTimeout(pdfRenderTimer);
    pdfRenderTimer = setTimeout(renderPdf, 120);
  }

  function renderPdf() {
    if (!S.pdf || !S.open) return;
    var token = ++S.renderToken;
    var st = stageEl();
    if (!st) return;
    var stageWidth = Math.max(280, st.clientWidth - 40);
    var sheet = doc.createElement('div');
    sheet.className = 'dp-sheet';

    var pageNo = 1;
    var next = function () {
      if (token !== S.renderToken || !S.open) return;
      if (pageNo > S.pages) {
        if (token === S.renderToken && S.open) {
          st.innerHTML = '';
          st.appendChild(sheet);
          var counter = doc.createElement('div');
          counter.className = 'dp-status';
          counter.setAttribute('role', 'status');
          counter.textContent = S.pages + (S.pages === 1 ? ' page' : ' pages');
          st.appendChild(counter);
        }
        return;
      }
      S.pdf.getPage(pageNo).then(function (page) {
        if (token !== S.renderToken || !S.open) return;
        var base = page.getViewport({ scale: 1 });
        // Fit-width is zoom 1; user zoom multiplies. devicePixelRatio keeps
        // canvases crisp on retina without inflating layout size.
        var scale = (Math.min(stageWidth, 900) / base.width) * S.zoom;
        var vp = page.getViewport({ scale: scale });
        var ratio = global.devicePixelRatio || 1;
        var canvas = doc.createElement('canvas');
        canvas.className = 'dp-page';
        canvas.width = Math.floor(vp.width * ratio);
        canvas.height = Math.floor(vp.height * ratio);
        canvas.style.width = Math.floor(vp.width) + 'px';
        canvas.style.height = Math.floor(vp.height) + 'px';
        var ctx = canvas.getContext('2d');
        ctx.scale(ratio, ratio);
        sheet.appendChild(canvas);
        return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
          pageNo += 1;
          next();
        });
      }).catch(function () {
        if (token === S.renderToken) fail('This PDF could not be previewed.');
      });
    };
    next();
  }

  // ── DOCX path (docx-preview, CSS-transform zoom) ─────────────────────────

  function openDocx() {
    if (!global.docx || !global.JSZip) {
      fail('The document renderer is not available.');
      return;
    }
    S.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    fetch(S.url, { credentials: 'same-origin', cache: 'no-store', signal: S.abort && S.abort.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('http ' + res.status);
        return res.arrayBuffer();
      })
      .then(function (buf) {
        if (!S.open) return null;
        var st = stageEl();
        st.innerHTML = '';
        var sheet = doc.createElement('div');
        sheet.className = 'dp-sheet';
        sheet.id = 'dp-docx-sheet';
        st.appendChild(sheet);
        return global.docx.renderAsync(buf, sheet, null, {
          className: 'dp-docx-render',
          inWrapper: true,
          breakPages: true,
          ignoreLastRenderedPageBreak: false,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          experimental: true,
          useBase64URL: true,
        });
      })
      .then(function () {
        // Real pages: docx-preview only breaks on explicit breaks, so a long
        // section grows past the sheet. Measure, and move what falls past the
        // page's content area onto continuation pages (same header/footer).
        var sheet0 = doc.getElementById('dp-docx-sheet');
        return sheet0 ? settled(sheet0).then(function () { paginate(sheet0); }) : null;
      })
      .then(function () {
        // Fit-to-width baseline: a Word page has a fixed layout width (usually
        // ~816px) that rarely matches the stage. Measure once, then let user
        // zoom multiply the fitted base — 100% means "the page fits".
        var st = stageEl();
        var sheet = doc.getElementById('dp-docx-sheet');
        if (st && sheet && sheet.scrollWidth > 0) {
          var avail = Math.max(280, st.clientWidth - 40);
          S.docxFit = Math.min(1, avail / sheet.scrollWidth);
        } else {
          S.docxFit = 1;
        }
        applyDocxZoom();
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return;
        fail('This document could not be previewed.');
      });
  }

  /** Wait for images and fonts so measurement sees real heights. */
  function settled(root) {
    var waits = Array.prototype.slice.call(root.querySelectorAll('img')).map(function (img) {
      if (img.complete) return Promise.resolve();
      if (img.decode) return img.decode().catch(function () {});
      return new Promise(function (r) { img.onload = img.onerror = r; });
    });
    if (doc.fonts && doc.fonts.ready) waits.push(doc.fonts.ready.catch(function () {}));
    return Promise.all(waits);
  }

  /**
   * PAGE PAGINATION — the same pass templates.js uses for the FCA preview.
   * Each rendered <section> is one page whose min-height comes from the
   * document's own page size (A4 or Letter). Blocks past the content area
   * move to a cloned page; completed pages are pinned to exact height. A block
   * moves whole (Word may split a paragraph), so a boundary can differ by up
   * to one block; a single block taller than a page keeps its tall page.
   */
  function paginate(root) {
    var wrapper = root.querySelector('.dp-docx-render-wrapper') || root;
    Array.prototype.slice.call(wrapper.children).filter(function (n) { return n.tagName === 'SECTION'; }).forEach(splitPage);
  }

  function splitPage(sec) {
    var guard = 80;
    var current = sec;
    while (guard-- > 0) {
      var cs = getComputedStyle(current);
      var target = parseFloat(cs.minHeight) || parseFloat(current.style.minHeight);
      if (!target) return;
      var limit = target - (parseFloat(cs.paddingBottom) || 0);
      var articles = Array.prototype.slice.call(current.children).filter(function (n) { return n.tagName === 'ARTICLE'; });
      if (!articles.length) return;
      var secTop = current.getBoundingClientRect().top;
      var flow = [];
      articles.forEach(function (art, ai) {
        Array.prototype.slice.call(art.children).forEach(function (kid) { flow.push({ el: kid, art: ai }); });
      });
      var splitAt = -1;
      for (var i = 0; i < flow.length; i++) {
        var r = flow[i].el.getBoundingClientRect();
        if (r.height === 0) continue;
        if (r.bottom - secTop > limit) { splitAt = i; break; }
      }
      if (splitAt !== -1) {
        var tailHasContent = false;
        for (var t = splitAt; t < flow.length; t++) {
          var tEl = flow[t].el;
          if ((tEl.textContent || '').trim() !== '' || tEl.querySelector('img, table')) { tailHasContent = true; break; }
        }
        if (!tailHasContent) splitAt = -1;
      }
      if (splitAt === -1) { current.style.height = target + 'px'; current.style.overflow = 'hidden'; return; }
      if (splitAt === 0) return;
      var next = current.cloneNode(false);
      var header = current.querySelector(':scope > header');
      if (header) next.appendChild(header.cloneNode(true));
      var ai2 = flow[splitAt].art;
      var srcArticle = articles[ai2];
      var within = Array.prototype.indexOf.call(srcArticle.children, flow[splitAt].el);
      if (within > 0) {
        var nextArticle = srcArticle.cloneNode(false);
        next.appendChild(nextArticle);
        var kids = Array.prototype.slice.call(srcArticle.children);
        for (var k = within; k < kids.length; k++) nextArticle.appendChild(kids[k]);
        ai2 += 1;
      }
      for (var a = ai2; a < articles.length; a++) next.appendChild(articles[a]);
      var footer = current.querySelector(':scope > footer');
      if (footer) next.appendChild(footer.cloneNode(true));
      current.parentNode.insertBefore(next, current.nextSibling);
      current.style.height = target + 'px';
      current.style.overflow = 'hidden';
      current = next;
    }
  }

  function applyDocxZoom() {
    var sheet = doc.getElementById('dp-docx-sheet');
    if (!sheet) return;
    // CSS zoom (not transform) so the scaled size IS the layout size and the
    // stage's scrollbars stay honest.
    sheet.style.zoom = String((S.docxFit || 1) * S.zoom);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function open(opts) {
    if (S.open) close();
    S.open = true;
    S.kind = opts.kind === 'docx' ? 'docx' : 'pdf';
    S.url = String(opts.url || '');
    S.downloadUrl = opts.downloadUrl ? String(opts.downloadUrl) : null;
    S.title = String(opts.title || 'Document preview');
    S.meta = String(opts.meta || '');
    S.zoom = 1;
    S.docxFit = 1;
    S.pdf = null;
    S.pages = 0;
    S.opener = doc.activeElement;
    mount();
    doc.body.style.overflow = 'hidden';
    if (S.kind === 'pdf') openPdf();
    else openDocx();
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    S.renderToken += 1;
    if (S.abort) { try { S.abort.abort(); } catch (e) { /* already done */ } S.abort = null; }
    if (S.pdf) { try { S.pdf.destroy(); } catch (e) { /* best effort */ } S.pdf = null; }
    var el = overlayEl();
    if (el) el.remove();
    doc.removeEventListener('keydown', onKey, true);
    doc.body.style.overflow = '';
    if (S.opener && S.opener.focus) { try { S.opener.focus(); } catch (e) { /* gone */ } }
    S.opener = null;
  }

  global.DocPreview = { open: open, close: close, _state: S };
}(typeof window !== 'undefined' ? window : this));
