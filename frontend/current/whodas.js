/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — WHODAS 2.0 (36-item) DIGITAL ASSESSMENT

   Conventions (mirrors fca.js / casenotes.js / resourcehub.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - delegated data-whodas handlers; no inline onclick carrying server ids
     - pure helpers exported for node tests (whodas-frontend-helpers.test.js)
     - the backend enforces every boundary; the client only reflects it

   NON-NEGOTIABLES ENCODED HERE:
     1. THE WHO DOCUMENT IS THE DOCUMENT. This file contains no question text,
        no response wording, no domain layout and no instrument markup. The
        instrument is rendered from the official WHO PDF via pdf.js, and the
        only thing drawn over it is a ring around the chosen response — the
        mark the form itself asks for ("circle only one response"). Item text
        appears in exactly one place: the aria-label of a control, taken
        verbatim from the server, which derived it from that same PDF.
     2. THE CLIENT NEVER SCORES. There is no arithmetic in this file. Scores,
        domain values, missing-data handling and completion validity all
        arrive from the server, already labelled with the method that produced
        them. A number is never computed, rounded or re-scaled here.
     3. NEVER BLEND METHODS. Every score is rendered inside a block that names
        its method, its source methodology, its engine version and its
        calculation date. There is no "the WHODAS score" anywhere.
     4. NO INVENTED CLINICAL MEANING. No severity band, no interpretation, no
        traffic-light colour, no "mild/moderate/severe disability". The
        supplied WHO sources define no cut-points, so none are shown.
     5. RESPONSES ARE SEMANTIC. The value posted for an item is always
        'none'|'mild'|'moderate'|'severe'|'extreme' — never a numeral. The
        1-5 / 0-4 coding difference between WHO sources is a server concern.
     6. NOTHING COMPLETES BY ITSELF. Autosave saves drafts. Completion is an
        explicit, confirmed action, and it is refused client-side and
        server-side while any applicable item is unanswered.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // `global` is null under the node test harness. The pure helpers below are
  // still defined and exported there; everything that touches the DOM is gated
  // on `doc` further down.
  var doc = global && global.document;

  var API = '/api/whodas';
  var PDFJS_SRC = '/vendor/pdfjs/pdf.min.mjs';
  var PDFJS_WORKER = '/vendor/pdfjs/pdf.worker.min.mjs';

  // Render scale. 1.5 keeps the instrument crisp on a clinical laptop without
  // producing canvases so large that a ten-page interviewer form stutters.
  var SCALE = 1.5;
  var AUTOSAVE_DEBOUNCE_MS = 700;
  var AUTOSAVE_RETRY_MS = 4000;
  var MAX_AUTOSAVE_RETRIES = 4;

  // ══ PURE HELPERS (exported for node tests) ════════════════════════════════

  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Human date for history rows. Never used for anything the server stores. */
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  var METHOD_LABELS = {
    interviewer: 'Interviewer-administered',
    self: 'Self-administered',
    proxy: 'Proxy-administered',
  };

  function methodLabel(m) { return METHOD_LABELS[m] || m || '—'; }

  /**
   * Descriptions are paraphrased from WHODAS 2.0 manual §5.2 (modes of
   * administering) — portal chrome that helps a clinician pick a mode. They are
   * never rendered inside the instrument.
   */
  var METHOD_DESCRIPTIONS = {
    interviewer: 'Administered in person or by telephone. Requires interviewer training and uses flashcards.',
    self: 'Completed by the client themselves, on paper or on screen.',
    proxy: 'Completed by a friend, relative or carer on the client\'s behalf.',
  };

  /**
   * A score is only displayable when the server said it was scorable. Anything
   * else renders as the server's stated reason — never as 0, never as a blank.
   */
  function displayScore(result) {
    if (!result) return null;
    if (!result.scorable) return null;
    if (!result.overall || result.overall.value === null || result.overall.value === undefined) return null;
    return result.overall.value;
  }

  /** Formats a 0-100 score for display without doing any arithmetic on it. */
  function formatScore(value) {
    if (value === null || value === undefined) return '—';
    return Number(value).toFixed(2);
  }

  /**
   * Turns the field map's PDF-user-space rectangle into CSS pixels for the
   * overlay, using the pdf.js viewport so the CropBox offset and the render
   * scale are applied by the same transform that drew the page.
   */
  function rectToCss(viewport, rect) {
    var a = viewport.convertToViewportPoint(rect.x, rect.y);
    var b = viewport.convertToViewportPoint(rect.x + rect.w, rect.y + rect.h);
    return {
      left: Math.min(a[0], b[0]),
      top: Math.min(a[1], b[1]),
      width: Math.abs(b[0] - a[0]),
      height: Math.abs(b[1] - a[1]),
    };
  }

  /** Which applicable items still have no response. Mirrors the server rule. */
  function missingItems(itemIds, workSchoolItems, responses, workSchoolApplicable) {
    var skip = {};
    if (workSchoolApplicable === false) {
      (workSchoolItems || []).forEach(function (id) { skip[id] = true; });
    }
    return (itemIds || []).filter(function (id) {
      if (skip[id]) return false;
      var v = responses ? responses[id] : undefined;
      return v === undefined || v === null || v === '';
    });
  }

  var helpers = {
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    methodLabel: methodLabel,
    displayScore: displayScore,
    formatScore: formatScore,
    rectToCss: rectToCss,
    missingItems: missingItems,
  };

  // Node test harness stops here — nothing below runs without a DOM.
  if (!doc) {
    if (typeof module !== 'undefined' && module.exports) module.exports = { _helpers: helpers };
    return;
  }

  // ══ STATE ═════════════════════════════════════════════════════════════════

  var S = {
    instrument: null,      // GET /api/whodas/instrument
    clientId: null,
    clientName: null,
    assessments: [],
    current: null,         // the assessment being viewed/edited
    fieldMap: null,
    pdf: null,             // pdf.js document
    pdfjsLib: null,
    pending: {},           // itemId → value awaiting save
    pendingForm: {},
    saveTimer: null,
    retries: 0,
    saveState: 'idle',
    validation: null,
    readOnly: false,
    // ── Page mode ───────────────────────────────────────────────────────────
    // When the assessment framework (assessment.js) mounts this module into
    // its full-page surface, `pageHost` is the element the form renders INTO.
    // The form is then part of the page, not a fixed overlay stacked on top of
    // whatever was underneath — which is what made it read as a modal.
    // Null means the legacy standalone mode, where the viewer is its own
    // full-screen surface.
    pageHost: null,
    hooks: null,           // { onRecord, onExit, onError, onNavigate, onChange }
    startHook: null,       // one-shot: where a newly created record should land
    summaryHost: null,     // compact read-only list (client profile)
  };

  // ══ NETWORK ═══════════════════════════════════════════════════════════════

  function api(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || (data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  // ══ LIBRARY ═══════════════════════════════════════════════════════════════

  function root() { return S.summaryHost || doc.getElementById('whodas-root'); }

  /**
   * Reflect a freshly loaded assessment list.
   *
   * There are two surfaces and this module owns neither of the lists on them:
   *
   *   PAGE MODE   assessment.js renders the instrument card, the action bar and
   *               the history table on the full-page surface. Here we only tell
   *               it the list changed, so it can re-read /api/assessments.
   *   SUMMARY     the client profile drawer gets a compact, read-only summary
   *               with a link to the full page. The assessment ITSELF is never
   *               opened in the drawer: a clinical form belongs on its own page,
   *               not in a panel over the client's appointments and invoices.
   */
  function renderLibrary() {
    // The signal is "a framework hook is wired", NOT "a record form is
    // mounted". Uploading a completed paper form happens on the page's CLIENT
    // view, where pageHost is null — so gating on pageHost meant a successful
    // upload never told the page to reload, and the new record only appeared
    // after a manual refresh.
    if (S.hooks && typeof S.hooks.onChange === 'function') {
      try { S.hooks.onChange(); } catch (e) { /* the frame owns its own errors */ }
      return;
    }
    if (S.pageHost) return;      // framed, but nothing wired to tell
    renderSummary();
  }

  /**
   * The client profile's Assessments section: what exists, and one way through
   * to the full page. Deliberately read-only — no Start, no form, no viewer.
   */
  function renderSummary() {
    var el = root();
    if (!el) return;

    var total = S.assessments.length;
    var drafts = S.assessments.filter(function (a) { return a.status === 'draft'; }).length;
    var last = S.assessments.filter(function (a) { return a.status === 'completed'; })[0] || null;

    var h = '<div class="whodas-summary">';
    h += '<p class="whodas-instrument-sub"><strong>WHODAS 2.0</strong> — '
      + esc(total ? (String(total) + (total === 1 ? ' assessment' : ' assessments')) : 'no assessments yet')
      + (drafts ? esc(' · ' + drafts + ' in progress') : '')
      + '</p>';
    if (last) {
      h += '<p class="whodas-instrument-sub">Last completed ' + esc(fmtDate(last.completedAt)) + '</p>';
    }
    h += '<div class="whodas-actions">'
      + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="open-page">'
      + 'Open assessments</button></div>';
    h += '<p class="whodas-instrument-sub">Assessments open on their own page, with the client\'s '
      + 'full history, the official forms and the results.</p>';
    h += '</div>';

    el.innerHTML = h;
    el.classList.add('is-open');
  }

  // ══ MODALS ════════════════════════════════════════════════════════════════

  function closeModal() {
    var m = doc.querySelector('.whodas-modal');
    if (m) m.remove();
  }

  function showModal(html) {
    closeModal();
    var wrap = doc.createElement('div');
    wrap.className = 'whodas-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.innerHTML = '<div class="whodas-modal__panel">' + html + '</div>';
    doc.body.appendChild(wrap);
    var focusable = wrap.querySelector('input, button, textarea');
    if (focusable) focusable.focus();
    return wrap;
  }

  function methodChooser(title, intro, actionLabel, action) {
    var methods = (S.instrument && S.instrument.methods) || [];
    var h = '<h3>' + esc(title) + '</h3><p>' + esc(intro) + '</p>';

    methods.forEach(function (m, i) {
      h += '<label class="whodas-choice">'
        + '<input type="radio" name="whodas-method" value="' + esc(m.method) + '"' + (i === 0 ? ' checked' : '') + '>'
        + '<span class="whodas-choice__box">'
        + '<strong>' + esc(methodLabel(m.method)) + '</strong>'
        + '<span>' + esc(METHOD_DESCRIPTIONS[m.method] || '') + '</span>'
        + '</span></label>';
    });

    h += '<div class="whodas-modal__actions">'
      + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Cancel</button>'
      + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="' + esc(action) + '">'
      + esc(actionLabel) + '</button></div>';

    showModal(h);
  }

  /**
   * Upload a WHODAS completed on paper.
   *
   * Asks for the same three facts the record needs and nothing more: which WHO
   * form was used, when it was completed, and the file. It states plainly that
   * no score will be produced — the alternative would be a clinician assuming
   * one had been, which is how an unscored assessment ends up quoted as if it
   * were scored.
   */
  function uploadChooser() {
    var methods = (S.instrument && S.instrument.methods) || [];
    var today = new Date().toISOString().slice(0, 10);
    var h = '<h3>Upload completed WHODAS</h3>'
      + '<p>For a form completed on paper outside Opal. It is filed against this '
      + 'client as an externally completed assessment.</p>';

    methods.forEach(function (m, i) {
      h += '<label class="whodas-choice">'
        + '<input type="radio" name="whodas-method" value="' + esc(m.method) + '"' + (i === 0 ? ' checked' : '') + '>'
        + '<span class="whodas-choice__box"><strong>' + esc(methodLabel(m.method)) + '</strong>'
        + '<span>' + esc(METHOD_DESCRIPTIONS[m.method] || '') + '</span></span></label>';
    });

    h += '<p><label for="whodas-up-date"><strong>Date completed</strong></label><br>'
      + '<input type="date" id="whodas-up-date" class="whodas-input" value="' + esc(today) + '" max="' + esc(today) + '"></p>';
    h += '<p><label for="whodas-up-file"><strong>Scanned PDF</strong></label><br>'
      + '<input type="file" id="whodas-up-file" accept="application/pdf"></p>';
    h += '<p class="whodas-instrument-sub">No score is calculated for an uploaded form. '
      + 'To produce a score, complete the assessment electronically instead.</p>';
    h += '<div class="whodas-modal__actions">'
      + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Cancel</button>'
      + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="upload-confirm">Upload</button>'
      + '</div>';
    showModal(h);
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('The file could not be read.')); };
      fr.onload = function () {
        var s = String(fr.result || '');
        var comma = s.indexOf(',');
        resolve(comma === -1 ? s : s.slice(comma + 1));
      };
      fr.readAsDataURL(file);
    });
  }

  function selectedMethod() {
    var checked = doc.querySelector('.whodas-modal input[name="whodas-method"]:checked');
    return checked ? checked.value : null;
  }

  function templateKeyFor(method) {
    var m = ((S.instrument && S.instrument.methods) || []).filter(function (x) { return x.method === method; })[0];
    return m ? m.templateKey : null;
  }

  // ══ VIEWER ════════════════════════════════════════════════════════════════

  function loadPdfJs() {
    if (S.pdfjsLib) return Promise.resolve(S.pdfjsLib);
    return import(PDFJS_SRC).then(function (lib) {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      S.pdfjsLib = lib;
      return lib;
    });
  }

  function viewerEl() { return doc.getElementById('whodas-viewer'); }

  function closeViewer() {
    flushSave();
    var v = viewerEl();
    if (v) v.remove();
    S.current = null;
    S.pdf = null;
    S.fieldMap = null;
    S.pending = {};
    S.pendingForm = {};
    S.validation = null;
    // Only the standalone viewer ever locked the page behind it.
    if (!S.pageHost) doc.body.style.overflow = '';
  }

  function openAssessment(id) {
    return api('/assessments/' + encodeURIComponent(id)).then(function (data) {
      S.current = data.assessment;
      S.fieldMap = data.fieldMap;
      S.readOnly = data.assessment.status !== 'draft';
      S.pending = {};
      S.pendingForm = {};
      S.retries = 0;
      setSaveState('idle');
      // In page mode the surrounding page shows the client, the status and the
      // completion metadata, so hand it the record it is describing.
      if (S.pageHost && S.hooks && typeof S.hooks.onRecord === 'function') {
        try { S.hooks.onRecord(summaryOf(data.assessment)); } catch (e) {}
      }
      return renderViewer();
    }).catch(function (err) {
      if (S.pageHost && S.hooks && typeof S.hooks.onError === 'function') {
        try { S.hooks.onError(err.message); } catch (e) {}
        return null;
      }
      throw err;
    });
  }

  /** The subset of a record the page frame needs for its context line. */
  function summaryOf(a) {
    return {
      id: a.id,
      assessmentKey: 'whodas-2.0-36',
      clientId: a.clientId,
      clientName: a.clientName,
      status: a.status,
      administrationMethod: a.administrationMethod,
      itemSet: a.itemSet,
      startedAt: a.startedAt,
      startedByName: a.startedByName,
      completedAt: a.completedAt,
      completedByName: a.completedByName,
      completionSource: a.completionSource,
      hasDocument: Boolean(a.hasDocument),
    };
  }

  function renderViewer() {
    var a = S.current;
    var existing = viewerEl();
    if (existing) existing.remove();

    var v = doc.createElement('div');
    // In page mode the viewer is part of the page it was rendered into. It is
    // not a modal, not a drawer and not a floating window: nothing is stacked
    // over the application and nothing behind it is inert.
    v.className = S.pageHost ? 'whodas-viewer whodas-viewer--page' : 'whodas-viewer';
    v.id = 'whodas-viewer';

    var h = '<div class="whodas-toolbar">';
    h += '<span class="whodas-toolbar__title">WHODAS 2.0 — 36 Item</span>';
    h += '<span class="whodas-toolbar__meta">' + esc(methodLabel(a.administrationMethod))
      + ' · ' + esc(a.clientName || a.clientId) + '</span>';
    h += '<span class="whodas-toolbar__spacer"></span>';
    h += '<span class="whodas-save whodas-save--idle" id="whodas-save-state" role="status" aria-live="polite"></span>';

    if (!S.readOnly) {
      h += '<button type="button" class="whodas-btn" data-whodas="save-exit">Save &amp; Exit</button>';
      h += '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="complete">Complete Assessment</button>';
    } else {
      if (a.status === 'completed') {
        h += '<button type="button" class="whodas-btn" data-whodas="amend" data-id="' + esc(a.id) + '">Amend</button>';
      }
      if (a.hasDocument) {
        h += '<button type="button" class="whodas-btn" data-whodas="download-doc" data-id="' + esc(a.id) + '">Download PDF</button>';
      }
    }
    // The page frame owns Back; a second "Close" beside it would be two
    // controls for one movement.
    if (!S.pageHost) {
      h += '<button type="button" class="whodas-btn" data-whodas="close-viewer">Close</button>';
    }
    h += '</div>';

    h += '<div class="whodas-scroll" id="whodas-scroll">';
    h += '<div id="whodas-panels"></div>';
    h += '<div class="whodas-pages" id="whodas-pages"><div class="whodas-panel">Loading the official WHO document…</div></div>';
    h += '</div>';

    v.innerHTML = h;
    if (S.pageHost) {
      S.pageHost.innerHTML = '';
      S.pageHost.appendChild(v);
    } else {
      doc.body.appendChild(v);
      doc.body.style.overflow = 'hidden';
    }

    renderPanels();
    return renderPdf();
  }

  function renderPanels() {
    var host = doc.getElementById('whodas-panels');
    if (!host) return;
    var a = S.current;
    var h = '';

    // Work/school applicability. This is not a WHO form field — it is the
    // portal asking the question the form's own skip instruction depends on,
    // so it lives outside the document area and says so.
    if (!S.readOnly) {
      var w = a.workSchoolApplicable;
      h += '<div class="whodas-panel">';
      h += '<h4>Before you begin — work or school status</h4>';
      h += '<p class="whodas-notice">The instrument instructs that items D5.5–D5.8 are completed only if the '
        + 'respondent works (paid, non-paid, self-employed) or goes to school. This determines whether the '
        + '36-item or the 32-item scoring pathway applies.</p>';
      h += '<div class="whodas-actions" style="margin-top:10px">';
      h += '<button type="button" class="whodas-btn' + (w === true ? ' whodas-btn--primary' : '')
        + '" data-whodas="work" data-value="yes" aria-pressed="' + (w === true) + '">Works or studies</button>';
      h += '<button type="button" class="whodas-btn' + (w === false ? ' whodas-btn--primary' : '')
        + '" data-whodas="work" data-value="no" aria-pressed="' + (w === false) + '">Does not work or study</button>';
      h += '</div>';
      if (w === null || w === undefined) {
        h += '<p class="whodas-notice whodas-notice--warn" style="margin-top:10px">Not yet recorded. '
          + 'The assessment cannot be completed until this is answered.</p>';
      } else if (w === false) {
        h += '<p class="whodas-notice" style="margin-top:10px">Items D5.5–D5.8 are not applicable and will be '
          + 'left blank on the form. The 32-item pathway will be used.</p>';
      }
      h += '</div>';
    }

    if (S.validation && !S.validation.ok) {
      h += '<div class="whodas-panel">';
      h += '<h4>Not yet complete</h4>';
      (S.validation.problems || []).forEach(function (p) {
        h += '<p class="whodas-notice whodas-notice--error">' + esc(p.message) + '</p>';
      });
      if ((S.validation.missingItemIds || []).length) {
        h += '<div class="whodas-missing-list">';
        S.validation.missingItemIds.forEach(function (id) {
          h += '<button type="button" data-whodas="goto" data-item="' + esc(id) + '">' + esc(id) + '</button>';
        });
        h += '</div>';
      }
      h += '</div>';
    }

    if (S.readOnly && a.scores && Object.keys(a.scores).length) {
      h += renderResults(a);
    }

    host.innerHTML = h;
  }

  /**
   * Results. Every method gets its own block naming its source; nothing is
   * presented as "the" score, and no severity language appears anywhere.
   */
  function renderResults(a) {
    var h = '<div class="whodas-panel">';
    h += '<h4>Results</h4>';
    h += '<p class="whodas-result-source">'
      + 'Administration: ' + esc(methodLabel(a.administrationMethod))
      + ' · Assessment date: ' + esc(fmtDate(a.completedAt))
      + ' · Item set: ' + esc(a.itemSet)
      + '</p>';

    var order = ['irt', 'simple_sum', 'domain_mean'];
    order.forEach(function (key) {
      var r = a.scores[key];
      if (!r) return;

      h += '<div class="whodas-result-method">';
      h += '<div class="whodas-result-head"><strong>' + esc(r.label) + '</strong>';
      if (key === a.defaultScoringMethod) h += '<span class="whodas-result-default">Default clinical score</span>';
      h += '</div>';

      var v = displayScore(r);
      if (v !== null) {
        h += '<div class="whodas-result-overall">' + esc(formatScore(v)) + ' <small>/ 100</small></div>';
      }

      h += '<p class="whodas-result-source">'
        + 'Methodology: ' + esc(r.sourceMethodology) + '<br>'
        + 'Scoring engine version: ' + esc(r.scoringVersion)
        + ' · Calculated: ' + esc(fmtDateTime(r.calculatedAt))
        + (r.summaryVariable ? ' · Summary variable: ' + esc(r.summaryVariable) : '')
        + '</p>';

      if (!r.scorable && r.refusal) {
        h += '<div class="whodas-refusal"><strong>Not calculated.</strong> ' + esc(r.refusal.message) + '</div>';
      }

      if (r.domains && r.domains.length) {
        h += '<table class="whodas-domains"><tbody>';
        r.domains.forEach(function (d) {
          if (d.splitDomain && d.subScores) {
            h += '<tr><td>' + esc(d.title) + '</td><td></td></tr>';
            d.subScores.forEach(function (s) {
              var na = !s.applicable || s.value === null;
              h += '<tr class="whodas-domains__sub' + (na ? ' whodas-domains__na' : '') + '">'
                + '<td>' + esc(s.title) + '</td><td>'
                + (na ? esc(s.applicable ? 'Not reportable' : 'Not applicable') : esc(formatScore(s.value)))
                + '</td></tr>';
            });
          } else {
            h += '<tr' + (d.value === null ? ' class="whodas-domains__na"' : '') + '>'
              + '<td>' + esc(d.title) + '</td><td>'
              + (d.value === null ? 'Not reportable' : esc(formatScore(d.value)))
              + '</td></tr>';
          }
        });
        h += '</tbody></table>';
      } else if (r.domainsNote) {
        h += '<p class="whodas-result-source">' + esc(r.domainsNote) + '</p>';
      }

      if (r.missingData && r.missingData.imputationApplied) {
        h += '<p class="whodas-notice whodas-notice--warn" style="margin-top:8px">'
          + 'This result involved missing data. ' + esc(r.missingData.imputationRule) + '. '
          + esc(String(r.missingData.missingCount)) + ' item(s) imputed.</p>';
      }
      h += '</div>';
    });

    h += '</div>';
    return h;
  }

  function renderPdf() {
    var a = S.current;
    var url = API + '/templates/' + encodeURIComponent(a.templateKey) + '/blank?disposition=inline';

    return loadPdfJs()
      .then(function (lib) { return lib.getDocument({ url: url, withCredentials: true }).promise; })
      .then(function (pdf) {
        S.pdf = pdf;
        var host = doc.getElementById('whodas-pages');
        host.innerHTML = '';

        var chain = Promise.resolve();
        for (var n = 1; n <= pdf.numPages; n += 1) {
          chain = chain.then(renderPage.bind(null, pdf, n, host));
        }
        return chain;
      })
      .then(function () { refreshControlState(); })
      .catch(function (err) {
        var host = doc.getElementById('whodas-pages');
        if (host) {
          host.innerHTML = '<div class="whodas-panel"><p class="whodas-notice whodas-notice--error">'
            + 'The official WHO document could not be displayed. ' + esc(err.message)
            + '</p></div>';
        }
      });
  }

  function renderPage(pdf, pageNumber, host) {
    return pdf.getPage(pageNumber).then(function (page) {
      var viewport = page.getViewport({ scale: SCALE });

      var wrap = doc.createElement('div');
      wrap.className = 'whodas-page';
      wrap.setAttribute('data-page', String(pageNumber));
      wrap.style.width = viewport.width + 'px';
      wrap.style.height = viewport.height + 'px';

      var canvas = doc.createElement('canvas');
      var ratio = global.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * ratio);
      canvas.height = Math.floor(viewport.height * ratio);
      canvas.style.width = viewport.width + 'px';
      canvas.style.height = viewport.height + 'px';

      var overlay = doc.createElement('div');
      overlay.className = 'whodas-overlay';

      wrap.appendChild(canvas);
      wrap.appendChild(overlay);
      host.appendChild(wrap);

      var ctx = canvas.getContext('2d');
      ctx.scale(ratio, ratio);

      return page.render({ canvasContext: ctx, viewport: viewport }).promise.then(function () {
        buildOverlay(overlay, viewport, pageNumber);
      });
    });
  }

  function buildOverlay(overlay, viewport, pageNumber) {
    var a = S.current;
    var itemText = ((S.instrument && S.instrument.methods) || []).filter(function (m) {
      return m.method === a.administrationMethod;
    })[0];
    var texts = (itemText && itemText.itemText) || {};

    var fields = (S.fieldMap && S.fieldMap.fields) || [];
    var html = '';

    fields.forEach(function (f) {
      if (f.page !== pageNumber) return;

      if (f.type === 'radio-group' || f.type === 'coded-radio') {
        var groupName = esc('whodas-' + a.id + '-' + f.field);
        var label = (texts[f.field] && texts[f.field].text) || f.field;

        f.options.forEach(function (o) {
          var box = rectToCss(viewport, o.hit);
          var value = f.type === 'radio-group' ? o.value : String(o.code);
          var optLabel = f.type === 'radio-group' ? o.label : ('Option ' + o.code);

          html += '<span class="whodas-opt" data-field="' + esc(f.field) + '"'
            + ' style="left:' + box.left + 'px;top:' + box.top + 'px;'
            + 'width:' + box.width + 'px;height:' + box.height + 'px">'
            + '<input type="radio" name="' + esc(groupName) + '"'
            + ' value="' + esc(value) + '"'
            + ' data-whodas-field="' + esc(f.field) + '"'
            + ' data-whodas-kind="' + esc(f.type) + '"'
            + (S.readOnly ? ' disabled' : '')
            // The screen-reader label is the WHO item verbatim plus the printed
            // response category — nothing paraphrased.
            + ' aria-label="' + esc(f.field + '. ' + label + ' Response: ' + optLabel) + '">'
            + '<span class="whodas-opt__ring" aria-hidden="true"></span>'
            + '</span>';
        });
        return;
      }

      if (f.type === 'text') {
        var wbox = rectToCss(viewport, f.writeIn);
        html += '<input type="text" class="whodas-write"'
          + ' data-whodas-field="' + esc(f.field) + '"'
          + ' data-whodas-kind="text"'
          + (S.readOnly ? ' disabled' : '')
          + ' aria-label="' + esc(f.field + '. Write-in value') + '"'
          + ' style="left:' + wbox.left + 'px;top:' + wbox.top + 'px;'
          + 'width:' + wbox.width + 'px;height:' + Math.max(wbox.height, 12) + 'px;'
          + 'font-size:' + Math.max(9, wbox.height * 0.9) + 'px">';
      }
    });

    overlay.innerHTML = html;
    refreshControlState(overlay);
  }

  /** Reflect stored responses onto the controls. Never the other way round. */
  function refreshControlState(scope) {
    var a = S.current;
    if (!a) return;
    var host = scope || doc.getElementById('whodas-pages');
    if (!host) return;

    var responses = a.responses || {};
    var formData = a.formData || {};

    Array.prototype.forEach.call(host.querySelectorAll('input[data-whodas-field]'), function (input) {
      var field = input.getAttribute('data-whodas-field');
      var kind = input.getAttribute('data-whodas-kind');

      if (kind === 'radio-group') {
        input.checked = responses[field] === input.value;
      } else if (kind === 'coded-radio') {
        input.checked = String(formData[field] === undefined ? '' : formData[field]) === input.value;
      } else if (kind === 'text') {
        input.value = formData[field] === undefined || formData[field] === null ? '' : String(formData[field]);
      }
    });

    // Not-applicable work items are disabled, matching the paper instruction.
    var skip = a.workSchoolApplicable === false
      ? ((S.instrument && S.instrument.workSchoolItems) || [])
      : [];
    Array.prototype.forEach.call(host.querySelectorAll('.whodas-opt'), function (span) {
      var field = span.getAttribute('data-field');
      var isSkipped = skip.indexOf(field) !== -1;
      var input = span.querySelector('input');
      if (input) input.disabled = S.readOnly || isSkipped;
      span.style.opacity = isSkipped ? '0.35' : '';
    });

    // Flag anything completion validation called out.
    var missing = (S.validation && S.validation.missingItemIds) || [];
    Array.prototype.forEach.call(host.querySelectorAll('.whodas-opt'), function (span) {
      span.classList.toggle('whodas-opt--missing', missing.indexOf(span.getAttribute('data-field')) !== -1);
    });
  }

  // ══ AUTOSAVE ══════════════════════════════════════════════════════════════

  function setSaveState(state, detail) {
    S.saveState = state;
    var el = doc.getElementById('whodas-save-state');
    if (!el) return;
    el.className = 'whodas-save whodas-save--' + state;
    el.textContent = ({
      idle: '',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed — retrying',
      conflict: 'Conflict — reload required',
    })[state] || '';
    if (detail) el.textContent = detail;
  }

  function queueSave(kind, field, value) {
    if (S.readOnly) return;
    if (kind === 'radio-group') S.pending[field] = value;
    else S.pendingForm[field] = value;

    if (S.saveTimer) clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, AUTOSAVE_DEBOUNCE_MS);
    setSaveState('saving');
  }

  function flushSave() {
    if (S.saveTimer) { clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (!S.current || S.readOnly) return Promise.resolve();
    if (!Object.keys(S.pending).length && !Object.keys(S.pendingForm).length) return Promise.resolve();

    var body = {
      version: S.current.version,
      responses: S.pending,
      formData: S.pendingForm,
    };
    // Cleared optimistically so edits made during the request are not lost.
    S.pending = {};
    S.pendingForm = {};
    setSaveState('saving');

    return api('/assessments/' + encodeURIComponent(S.current.id), { method: 'PATCH', body: body })
      .then(function (data) {
        S.current = data.assessment;
        S.retries = 0;
        setSaveState('saved');
        return data;
      })
      .catch(function (err) {
        if (err.status === 409 && err.payload && err.payload.error === 'stale_version') {
          // Never silently overwrite: stop saving and make the clinician reload.
          setSaveState('conflict');
          showModal('<h3>This assessment changed elsewhere</h3>'
            + '<p>It was edited in another session or tab. To avoid overwriting newer clinical '
            + 'responses, reload before continuing. Your unsaved changes on this screen will be discarded.</p>'
            + '<div class="whodas-modal__actions">'
            + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="reload">Reload assessment</button>'
            + '</div>');
          return null;
        }

        // Put the changes back and retry — a transient network failure must not
        // lose a clinician's answers.
        Object.keys(body.responses).forEach(function (k) {
          if (!(k in S.pending)) S.pending[k] = body.responses[k];
        });
        Object.keys(body.formData).forEach(function (k) {
          if (!(k in S.pendingForm)) S.pendingForm[k] = body.formData[k];
        });

        if (S.retries < MAX_AUTOSAVE_RETRIES) {
          S.retries += 1;
          setSaveState('failed');
          setTimeout(flushSave, AUTOSAVE_RETRY_MS * S.retries);
        } else {
          setSaveState('failed', 'Save failed — do not close this window');
        }
        return null;
      });
  }

  // ══ COMPLETION ════════════════════════════════════════════════════════════

  function checkValidation() {
    return flushSave().then(function () {
      return api('/assessments/' + encodeURIComponent(S.current.id) + '/validation');
    }).then(function (v) {
      S.validation = v;
      renderPanels();
      refreshControlState();
      return v;
    });
  }

  function completeAssessment() {
    checkValidation().then(function (v) {
      if (!v.ok) {
        var scroll = doc.getElementById('whodas-scroll');
        if (scroll) scroll.scrollTop = 0;
        return;
      }
      showModal('<h3>Complete this assessment?</h3>'
        + '<p>You are completing this WHODAS 2.0 assessment. Once completed, changes will require '
        + 'an auditable amendment.</p>'
        + '<div class="whodas-modal__actions">'
        + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Cancel</button>'
        + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="complete-confirm">'
        + 'Complete Assessment</button></div>');
    });
  }

  function doComplete() {
    closeModal();
    setSaveState('saving', 'Completing…');
    api('/assessments/' + encodeURIComponent(S.current.id) + '/complete', { method: 'POST' })
      .then(function (data) {
        S.current = data.assessment;
        S.readOnly = true;
        S.validation = null;
        setSaveState('saved', 'Completed');
        // The page frame's status, completion metadata and share action all
        // change the moment this lands, so it is told before anything renders.
        if (S.pageHost && S.hooks && typeof S.hooks.onRecord === 'function') {
          try { S.hooks.onRecord(summaryOf(S.current)); } catch (e) {}
        }
        return renderViewer().then(function () { return refreshList(); });
      })
      .catch(function (err) {
        if (err.status === 422 && err.payload) {
          S.validation = err.payload;
          renderPanels();
          refreshControlState();
          setSaveState('idle');
          return;
        }
        setSaveState('failed', 'Could not complete: ' + err.message);
      });
  }

  /**
   * Where a newly started (or resumed) assessment goes.
   *
   * In page mode the framework decides the address, so the browser gets a real
   * history entry for the assessment and Back behaves. Standalone, the viewer
   * opens in place, as it always did.
   */
  function landOnAssessment(assessment) {
    if (S.startHook) {
      var hook = S.startHook;
      S.startHook = null;
      return hook(summaryOf(assessment));
    }
    // An amendment is a NEW record with its own id, so the address has to move
    // with it. Without this the page would go on claiming to be the record it
    // just superseded.
    if (S.pageHost && S.hooks && typeof S.hooks.onNavigate === 'function') {
      return S.hooks.onNavigate(summaryOf(assessment));
    }
    return openAssessment(assessment.id);
  }

  // ══ DOCUMENTS ═════════════════════════════════════════════════════════════

  function openDocument(url, mode) {
    if (mode === 'print') {
      var w = global.open(url, '_blank');
      if (w) w.addEventListener('load', function () { w.print(); });
      return;
    }
    // A plain navigation to an authenticated endpoint — the browser handles the
    // Content-Disposition. Nothing clinical is ever put in a query string.
    global.location.href = url;
  }

  // ══ EVENTS ════════════════════════════════════════════════════════════════

  doc.addEventListener('change', function (e) {
    var input = e.target.closest && e.target.closest('input[data-whodas-field]');
    if (!input) return;
    var kind = input.getAttribute('data-whodas-kind');
    var field = input.getAttribute('data-whodas-field');

    if (kind === 'radio-group') queueSave('radio-group', field, input.value);
    else if (kind === 'coded-radio') queueSave('form', field, Number(input.value));
  });

  doc.addEventListener('input', function (e) {
    var input = e.target.closest && e.target.closest('input.whodas-write');
    if (!input) return;
    queueSave('form', input.getAttribute('data-whodas-field'), input.value);
  });

  doc.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-whodas]');
    if (!t) return;
    var action = t.getAttribute('data-whodas');

    if (action === 'modal-cancel') return closeModal();
    if (action === 'close-viewer') return closeViewer();

    if (action === 'start') {
      return methodChooser(
        'WHODAS 2.0 — 36 Item',
        'Choose assessment method. The corresponding official WHO form will be loaded.',
        'Start assessment', 'start-confirm'
      );
    }

    if (action === 'start-confirm') {
      var m = selectedMethod();
      if (!m) return;
      closeModal();
      return api('/assessments', {
        method: 'POST',
        body: { clientId: S.clientId, clientName: S.clientName, administrationMethod: m },
      }).then(function (data) {
        return refreshList().then(function () { return landOnAssessment(data.assessment); });
      }).catch(function (err) {
        // A draft already exists for this client and method — the unique index
        // in migration 021 is what stops a double-click creating two clinical
        // records. Continue the one that exists rather than reporting a clash.
        if (err.status === 409 && err.payload && err.payload.assessment) {
          return landOnAssessment(err.payload.assessment);
        }
        showModal('<h3>Could not start assessment</h3><p>' + esc(err.message) + '</p>'
          + '<div class="whodas-modal__actions"><button type="button" class="whodas-btn" '
          + 'data-whodas="modal-cancel">Close</button></div>');
      });
    }

    if (action === 'upload') return uploadChooser();

    if (action === 'upload-confirm') {
      var um = selectedMethod();
      var dateEl = doc.getElementById('whodas-up-date');
      var fileEl = doc.getElementById('whodas-up-file');
      var file = fileEl && fileEl.files && fileEl.files[0];
      if (!um || !dateEl || !dateEl.value) return;
      if (!file) {
        showModal('<h3>No file chosen</h3><p>Select the scanned PDF to upload.</p>'
          + '<div class="whodas-modal__actions"><button type="button" class="whodas-btn" '
          + 'data-whodas="modal-cancel">Close</button></div>');
        return;
      }
      return readFileAsBase64(file).then(function (b64) {
        return api('/clients/' + encodeURIComponent(S.clientId) + '/assessments/upload', {
          method: 'POST',
          body: {
            administrationMethod: um,
            assessedOn: dateEl.value,
            clientName: S.clientName || undefined,
            fileBase64: b64,
          },
        });
      }).then(function () {
        closeModal();
        return refreshList();
      }).catch(function (err) {
        showModal('<h3>Upload failed</h3><p>' + esc(err.message || 'Please try again.') + '</p>'
          + '<div class="whodas-modal__actions"><button type="button" class="whodas-btn" '
          + 'data-whodas="modal-cancel">Close</button></div>');
      });
    }

    if (action === 'blank') {
      var mode = t.getAttribute('data-mode');
      return methodChooser(
        mode === 'print' ? 'Print blank form' : 'Download blank form',
        'Which official WHO form do you need?',
        mode === 'print' ? 'Print' : 'Download',
        'blank-confirm-' + mode
      );
    }

    if (action === 'blank-confirm-download' || action === 'blank-confirm-print') {
      var bm = selectedMethod();
      if (!bm) return;
      closeModal();
      var key = templateKeyFor(bm);
      if (!key) return;
      var pm = action === 'blank-confirm-print' ? 'print' : 'download';
      return openDocument(
        API + '/templates/' + encodeURIComponent(key) + '/blank' + (pm === 'print' ? '?disposition=inline' : ''),
        pm
      );
    }

    if (action === 'flashcards') {
      var fk = S.instrument && S.instrument.flashcards && S.instrument.flashcards.templateKey;
      if (fk) openDocument(API + '/templates/' + encodeURIComponent(fk) + '/blank?disposition=inline', 'print');
      return;
    }

    if (action === 'open') return openAssessment(t.getAttribute('data-id'));

    if (action === 'download-doc' || action === 'print-doc') {
      var id = t.getAttribute('data-id');
      var dm = action === 'print-doc' ? 'print' : 'download';
      return openDocument(
        API + '/assessments/' + encodeURIComponent(id) + '/document' + (dm === 'print' ? '?disposition=inline' : ''),
        dm
      );
    }

    if (action === 'work') {
      var yes = t.getAttribute('data-value') === 'yes';
      return api('/assessments/' + encodeURIComponent(S.current.id), {
        method: 'PATCH',
        body: { version: S.current.version, workSchoolApplicable: yes },
      }).then(function (data) {
        S.current = data.assessment;
        renderPanels();
        refreshControlState();
        setSaveState('saved');
      }).catch(function (err) { setSaveState('failed', err.message); });
    }

    if (action === 'open-page') {
      // The client profile's one way through to the assessment surface.
      if (global.Assess && typeof global.Assess.openForClient === 'function') {
        if (typeof global.closeClientProfile === 'function') {
          try { global.closeClientProfile(); } catch (err) { /* already closed */ }
        }
        return global.Assess.openForClient('whodas-2.0-36', S.clientId, S.clientName);
      }
      return undefined;
    }

    if (action === 'save-exit') {
      return flushSave().then(function () {
        if (S.pageHost && S.hooks && typeof S.hooks.onExit === 'function') {
          return refreshList().then(function () { return S.hooks.onExit(); });
        }
        closeViewer();
        return refreshList();
      });
    }

    if (action === 'complete') return completeAssessment();
    if (action === 'complete-confirm') return doComplete();

    if (action === 'reload') {
      closeModal();
      return openAssessment(S.current.id);
    }

    if (action === 'goto') {
      // Matched by scanning rather than by building a selector out of the id:
      // an item id reaching querySelector unescaped is a selector-injection
      // waiting to happen, and CSS.escape is not available everywhere.
      var item = t.getAttribute('data-item');
      var target = null;
      Array.prototype.some.call(doc.querySelectorAll('.whodas-opt'), function (span) {
        if (span.getAttribute('data-field') !== item) return false;
        target = span.querySelector('input');
        return true;
      });
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus();
      }
      return;
    }

    if (action === 'delete-confirm') {
      var delId = t.getAttribute('data-id');
      closeModal();
      return api('/assessments/' + encodeURIComponent(delId), { method: 'DELETE' })
        .then(function () {
          var hook = pendingDeleteHook;
          pendingDeleteHook = null;
          // refreshList re-reads the module's own list and, in page mode,
          // fires the framework's onChange — which reloads the history table
          // the Delete button lives in. The extra hook covers a caller whose
          // change hook is not wired.
          return refreshList().then(function () {
            if (hook && !(S.hooks && typeof S.hooks.onChange === 'function')) return hook();
            return null;
          });
        })
        .catch(function (err) {
          pendingDeleteHook = null;
          showModal('<h3>Could not delete this assessment</h3><p>'
            + esc((err && err.message) || 'Please try again.') + '</p>'
            + '<div class="whodas-modal__actions"><button type="button" class="whodas-btn" '
            + 'data-whodas="modal-cancel">Close</button></div>');
        });
    }

    if (action === 'amend') {
      return showModal('<h3>Amend this assessment</h3>'
        + '<p>The completed assessment stays in the record unchanged. A new draft will be created, '
        + 'pre-filled from it, and linked to it. Give a reason for the amendment.</p>'
        + '<input type="text" id="whodas-amend-reason" class="whodas-btn" style="width:100%;text-align:left" '
        + 'placeholder="Reason for amendment" aria-label="Reason for amendment">'
        + '<div class="whodas-modal__actions">'
        + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Cancel</button>'
        + '<button type="button" class="whodas-btn whodas-btn--primary" data-whodas="amend-confirm" '
        + 'data-id="' + esc(t.getAttribute('data-id')) + '">Create amendment</button></div>');
    }

    if (action === 'amend-confirm') {
      var reasonEl = doc.getElementById('whodas-amend-reason');
      var reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) { if (reasonEl) reasonEl.focus(); return; }
      closeModal();
      return api('/assessments/' + encodeURIComponent(t.getAttribute('data-id')) + '/amend', {
        method: 'POST', body: { reason: reason },
      }).then(function (data) {
        return refreshList().then(function () { return landOnAssessment(data.assessment); });
      }).catch(function (err) { setSaveState('failed', err.message); });
    }
  });

  // Never lose responses to a closed tab.
  global.addEventListener('beforeunload', function (e) {
    if (S.readOnly) return;
    if (Object.keys(S.pending).length || Object.keys(S.pendingForm).length || S.saveState === 'saving') {
      flushSave();
      e.preventDefault();
      e.returnValue = '';
    }
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return undefined;
    if (doc.querySelector('.whodas-modal')) return closeModal();
    // In page mode Escape does NOT dismiss the form: the form is the page, and
    // a stray keypress must not blank a clinical record mid-administration.
    // Leaving is the Back button, which the frame owns.
    if (S.pageHost) return undefined;
    if (viewerEl() && !S.readOnly) return flushSave().then(closeViewer);
    if (viewerEl()) return closeViewer();
    return undefined;
  });

  // ══ BOOTSTRAP ═════════════════════════════════════════════════════════════

  function refreshList() {
    if (!S.clientId) return Promise.resolve();
    return api('/clients/' + encodeURIComponent(S.clientId) + '/assessments')
      .then(function (data) {
        S.assessments = data.assessments || [];
        renderLibrary();
      })
      .catch(function () { /* the library simply does not render */ });
  }

  /**
   * Mount the assessment library for one client. Safe to call repeatedly; a
   * 404 means the feature is not enabled in this environment and nothing
   * renders at all.
   */
  function open(clientId, clientName) {
    S.clientId = clientId;
    S.clientName = clientName || null;

    var ready = S.instrument
      ? Promise.resolve(S.instrument)
      : api('/instrument').then(function (d) { S.instrument = d; return d; });

    return ready
      .then(refreshList)
      .catch(function () {
        var el = root();
        if (el) el.classList.remove('is-open');
      });
  }

  function close() {
    closeViewer();
    var el = root();
    if (el) { el.classList.remove('is-open'); el.innerHTML = ''; }
    S.clientId = null;
    S.summaryHost = null;
    S.assessments = [];
  }

  // ══ ASSESSMENT-FRAMEWORK ADAPTER ══════════════════════════════════════════
  /*
     What assessment.js needs from an instrument module, and nothing more. The
     framework knows about clients, routes, history and disclosure; it knows
     nothing about administration methods, field maps, WHO templates or the
     36-item pathway, and it must not have to. Everything below is the WHODAS
     side of that boundary.
  */

  function ensureInstrument() {
    if (S.instrument) return Promise.resolve(S.instrument);
    return api('/instrument').then(function (d) { S.instrument = d; return d; });
  }

  /**
   * Every adapter entry point below loads the instrument first, and every one
   * of them used to drop the rejection on the floor: the framework discards
   * the returned promise, so a 404 (feature switched off) or a 403 produced an
   * unhandled rejection in the console and NOTHING on screen. A button that
   * silently does nothing is the worst of the failure modes — the clinician
   * presses it again, and again.
   */
  function instrumentFailed(title) {
    return function (err) {
      showModal('<h3>' + esc(title) + '</h3><p>'
        + esc((err && err.message) || 'The assessment module is unavailable in this environment.')
        + '</p><div class="whodas-modal__actions">'
        + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Close</button></div>');
      return null;
    };
  }

  /** The instrument's own client-scoped tools (method chooser, upload form). */
  function mountClientTools(ctx) {
    S.clientId = ctx.clientId ? String(ctx.clientId) : null;
    S.clientName = ctx.clientName || null;
    S.hooks = Object.assign({}, S.hooks, { onChange: ctx.onChange });
    return ensureInstrument().catch(function () { return null; });
  }

  /**
   * Render one assessment into the page. `host` is an element inside the
   * framework's page — never document.body, and never a dialog.
   */
  function mountRecord(host, assessmentId, hooks) {
    S.pageHost = host;
    S.hooks = Object.assign({}, S.hooks, hooks || {});
    return ensureInstrument()
      .then(function () { return openAssessment(assessmentId); })
      .catch(function (err) {
        if (S.hooks && typeof S.hooks.onError === 'function') S.hooks.onError(err.message);
        return null;
      });
  }

  /** The read-only summary shown in the client profile. Never the form. */
  function mountSummary(host, clientId, clientName) {
    S.summaryHost = host || null;
    return open(clientId, clientName);
  }

  function startAssessment(ctx) {
    S.clientId = ctx.clientId ? String(ctx.clientId) : S.clientId;
    S.clientName = ctx.clientName || S.clientName;
    S.startHook = ctx.onStarted || null;
    return ensureInstrument().then(function () {
      methodChooser(
        'WHODAS 2.0 — 36 Item',
        'Choose assessment method. The corresponding official WHO form will be loaded.',
        'Start assessment', 'start-confirm'
      );
    }).catch(instrumentFailed('Could not start assessment'));
  }

  function blankForm(mode) {
    return ensureInstrument().then(function () {
      methodChooser(
        mode === 'print' ? 'Print blank form' : 'Download blank form',
        'Which official WHO form do you need?',
        mode === 'print' ? 'Print' : 'Download',
        'blank-confirm-' + (mode === 'print' ? 'print' : 'download')
      );
    }).catch(instrumentFailed('Could not open the blank form'));
  }

  function uploadCompleted(ctx) {
    S.clientId = ctx.clientId ? String(ctx.clientId) : S.clientId;
    S.clientName = ctx.clientName || S.clientName;
    S.hooks = Object.assign({}, S.hooks, { onChange: ctx.onUploaded });
    return ensureInstrument().then(uploadChooser)
      .catch(instrumentFailed('Could not open the upload form'));
  }

  /**
   * Delete a draft, with confirmation.
   *
   * The dialog is this module's existing confirmation pattern — the same
   * showModal that guards Complete and Amend — because a second confirmation
   * style would be one more thing a clinician has to learn to read. Nothing
   * is deleted until the Delete button INSIDE the dialog is pressed; Cancel
   * and Escape both leave the draft exactly as it was.
   */
  var pendingDeleteHook = null;

  function deleteDraft(assessmentId, ctx) {
    pendingDeleteHook = (ctx && ctx.onDeleted) || null;
    showModal('<h3>Delete this assessment?</h3>'
      + '<p>This will permanently delete the saved assessment and any answers '
      + 'entered so far.</p>'
      + '<div class="whodas-modal__actions">'
      + '<button type="button" class="whodas-btn" data-whodas="modal-cancel">Cancel</button>'
      + '<button type="button" class="whodas-btn whodas-btn--danger" data-whodas="delete-confirm" '
      + 'data-id="' + esc(assessmentId) + '">Delete</button>'
      + '</div>');
    return Promise.resolve();
  }

  function openRecordDocument(assessmentId, mode) {
    var m = mode === 'print' ? 'print' : 'download';
    return openDocument(
      API + '/assessments/' + encodeURIComponent(assessmentId) + '/document'
        + (m === 'print' ? '?disposition=inline' : ''),
      m
    );
  }

  function unmount() {
    closeViewer();
    S.pageHost = null;
    S.summaryHost = null;
    S.hooks = null;
    S.startHook = null;
  }

  global.WHODAS = {
    open: open,
    close: close,
    refresh: refreshList,
    openAssessment: openAssessment,
    // Assessment-framework adapter.
    mountClientTools: mountClientTools,
    mountRecord: mountRecord,
    mountSummary: mountSummary,
    startAssessment: startAssessment,
    blankForm: blankForm,
    uploadCompleted: uploadCompleted,
    deleteDraft: deleteDraft,
    openDocument: openRecordDocument,
    unmount: unmount,
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
