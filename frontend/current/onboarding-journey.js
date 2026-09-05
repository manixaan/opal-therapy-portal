/* ═══════════════════════════════════════════════════════════════════════════
   ONBOARDING JOURNEY — the Owner's surface for the three-stage workflow

     1. Letter of Offer  →  2. Onboarding Documentation  →  3. Induction & Access

   One IIFE, one global (window.OnboardingJourney), no build step. Renders
   string-built HTML into the #ob-root that onboarding.js owns: onboarding.js
   still decides WHO sees the management surface (by asking the server) and
   still draws the employee's own onboarding and the Packages editor; this
   file draws everything the Owner uses day to day — the board, Start
   Onboarding, and one record's command centre.

   THE ONE RULE OF THIS SCREEN
   ───────────────────────────
   The server projects the journey (onboarding-journey.js on the backend) and
   this file only draws it. Stage, "what happens next", the four groups and
   "overdue" are never recomputed here, so the board and the record can never
   disagree with each other or with a notification.

   Status is never carried by colour alone — every chip has a label, every
   step has a written state.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  var doc = global.document;
  if (!doc) return;

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function jsq(s) { return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return { ok: false, status: r.status, code: data.code || null,
          error: data.message || data.error || ('Request failed (' + r.status + ')'), details: data };
      }
      data.ok = data.ok !== false;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: null, error: 'Network error — please try again.' };
    }
  }

  function toast(message, isError) {
    if (typeof global.showToast === 'function') global.showToast(message, !!isError);
  }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) + ' '
      + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }
  function isoDate(v) {
    if (!v) return '';
    var d = new Date(v);
    return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  function titleCase(s) {
    return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }
  function money(n) {
    var v = Number(n);
    if (!isFinite(v)) return '—';
    return v.toLocaleString('en-AU', { style: 'currency', currency: 'AUD' });
  }
  function daysWord(n) {
    if (n == null) return '';
    if (n === 0) return 'starts today';
    if (n < 0) return 'started ' + Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' ago';
    return 'starts in ' + n + ' day' + (n === 1 ? '' : 's');
  }
  function spinner(text) {
    return '<div class="oj-spinner" role="status">' + esc(text || 'Loading…') + '</div>';
  }
  function empty(title, body) {
    return '<div class="oj-empty"><strong>' + esc(title) + '</strong>' + (body ? '<p>' + esc(body) + '</p>' : '') + '</div>';
  }

  /** UI convenience only — the server's guard is the real one. */
  function can(perm) {
    if (S.board && S.board.can) {
      var k = perm.replace('onboarding.', '');
      if (typeof S.board.can[k] === 'boolean') return S.board.can[k];
    }
    if (typeof global.currentUserCan === 'function') {
      try { return !!global.currentUserCan(perm); } catch (_) { /* not ready */ }
    }
    return true;
  }

  // ── State ─────────────────────────────────────────────────────────────────

  var S = {
    view: 'board',
    filter: 'all',
    board: null,
    options: null,
    record: null,       // the last GET /records/:id payload
    recordId: null,
    editingTerms: false,
    busy: false,
  };

  var VIEWS = [
    { key: 'board', label: 'Onboarding' },
    { key: 'start', label: 'Start onboarding' },
    { key: 'defaults', label: 'Edit onboarding' },
  ];

  function root() { return doc.getElementById('ob-root'); }

  /** The shared sub-navigation. onboarding.js reuses it for the Packages view. */
  function subnavHtml(active) {
    return '<div class="ob-subnav oj-subnav" role="tablist">'
      + VIEWS.filter(function (v) { return v.key !== 'start' || can('onboarding.assign'); })
        .map(function (v) {
          var on = active === v.key || (active === 'record' && v.key === 'board') || (active === 'defaults' && v.key === 'defaults');
          return '<button type="button" role="tab" aria-selected="' + (on ? 'true' : 'false') + '"'
            + (on ? ' class="active"' : '') + ' onclick="OnboardingJourney.nav(\'' + v.key + '\')">'
            + esc(v.label) + '</button>';
        }).join('')
      + '</div>';
  }

  /** Navigate. Goes through Onboarding.nav so navigation.js records the address. */
  function nav(view, id) {
    if (view === 'packages') {
      if (global.Onboarding && typeof global.Onboarding.nav === 'function') global.Onboarding.nav('packages');
      return;
    }
    S.view = view;
    S.recordId = view === 'record' ? (id || S.recordId) : null;
    S.packageId = view === 'defaults' ? (id || null) : null;
    S.phaseView = null;
    S.editingTerms = false;
    if (global.Onboarding && typeof global.Onboarding.nav === 'function') {
      global.Onboarding.nav(view, view === 'defaults' ? S.packageId : S.recordId);
    } else {
      render(root());
    }
  }

  function openRecord(id) { nav('record', id); }

  // ── Render entry ──────────────────────────────────────────────────────────

  /**
   * Called by onboarding.js's renderManage for every management view except
   * Packages. `view` may be a retired address ('track') — it lands on the board.
   */
  async function render(host, view, id) {
    if (!host) return;
    if (view) S.view = (view === 'track' || view === 'dashboard') ? 'board' : view;
    if (S.view === 'record' && id) S.recordId = id;
    if (S.view === 'defaults') S.packageId = id || S.packageId || null;
    if (S.view === 'record' && !S.recordId) S.view = 'board';
    if (S.view === 'start' && !can('onboarding.assign')) S.view = 'board';

    host.innerHTML = '<div class="ob-root oj-root">'
      + '<div class="ob-hero"><div><h1>Onboarding</h1>'
      + '<p>From the letter of offer to the first day. The portal runs each step and asks for you only when a decision is yours.</p></div>'
      + '<div class="ob-hero-actions" id="oj-hero-actions"></div></div>'
      + subnavHtml(S.view)
      + '<div id="oj-view">' + spinner() + '</div></div>';

    var pane = doc.getElementById('oj-view');
    var actions = doc.getElementById('oj-hero-actions');
    if (S.view === 'start') return viewStart(pane, actions);
    if (S.view === 'record') return viewRecord(pane, actions);
    if (S.view === 'defaults') return viewDefaults(pane, actions);
    return viewBoard(pane, actions);
  }

  function rerender() { return render(root()); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE BOARD
  // ═══════════════════════════════════════════════════════════════════════════

  var FILTERS = [['all', 'In progress'], ['complete', 'Completed'], ['archived', 'Archived']];

  function matchesFilter(r, f) {
    switch (f) {
      case 'needs_you': return !r.closed && !r.complete && r.next.actor === 'admin';
      case 'employee': return !r.closed && !r.complete && r.next.actor === 'employee';
      case 'overdue': return !r.closed && !r.complete && r.counts.overdue > 0;
      case 'offer': case 'documentation': case 'induction': return r.stage.key === f;
      case 'complete': return r.complete && !r.closed;
      case 'archived': return r.closed;
      default: return !r.complete && !r.closed;
    }
  }

  async function viewBoard(pane, actions) {
    if (actions && can('onboarding.assign')) {
      actions.innerHTML = '<button type="button" class="oj-btn oj-btn-primary" onclick="OnboardingJourney.nav(\'start\')">+ Start onboarding</button>';
    }
    var res = await api('/api/onboarding/journey/board');
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'; return; }
    S.board = res;
    drawBoard(pane);
  }

  function drawBoard(pane) {
    var b = S.board;
    var s = b.summary;
    var tile = function (n, label, filter, cls) {
      return '<button type="button" class="oj-tile' + (cls ? ' ' + cls : '') + (S.filter === filter ? ' active' : '') + '"'
        + ' onclick="OnboardingJourney.filter(\'' + filter + '\')">'
        + '<span class="oj-tile-n">' + n + '</span><span class="oj-tile-l">' + esc(label) + '</span></button>';
    };

    var rows = b.records.filter(function (r) { return matchesFilter(r, S.filter); });

    pane.innerHTML = ''
      + '<div class="oj-tiles">'
      + tile(s.live, 'In progress', 'all')
      + tile(s.complete, 'Completed', 'complete')
      + tile(s.archived || 0, 'Archived', 'archived')
      + '</div>'
      + '<div class="oj-filters" role="tablist">'
      + FILTERS.map(function (f) {
        return '<button type="button" role="tab" aria-selected="' + (S.filter === f[0]) + '"'
          + ' class="oj-filter' + (S.filter === f[0] ? ' active' : '') + '" onclick="OnboardingJourney.filter(\'' + f[0] + '\')">' + esc(f[1]) + '</button>';
      }).join('')
      + '</div>'
      + (rows.length ? '<div class="oj-list">' + rows.map(boardRow).join('') + '</div>'
        : empty(S.filter === 'all' && !b.records.length ? 'Nobody is being onboarded yet' : 'Nothing here',
          S.filter === 'all' && !b.records.length ? 'Press Start onboarding to create the first record — the letter of offer is drafted from the same details.' : ''));
  }

  function stageTrack(r) {
    return '<ol class="oj-track" aria-label="Stages">' + r.stages.map(function (st) {
      return '<li class="oj-track-step is-' + esc(st.state) + '" title="' + esc(st.label + ': ' + st.summary) + '">'
        + '<span class="oj-track-n">' + st.number + '</span><span class="oj-track-l">' + esc(st.label) + '</span>'
        + '<span class="oj-track-s">' + esc(titleCase(st.state)) + '</span></li>';
    }).join('') + '</ol>';
  }

  /**
   * The six cells: three phases across the top, then Internal setup, Payroll and
   * Attention beneath. Each cell stacks its label over its chip so the eye reads
   * column by column. `compact` (the board) drops the detail subline — the row's
   * "next" line already says it.
   */
  function summaryLines(sm, compact) {
    var cls = function (st) { return st === 'complete' || st === 'approved' ? 'is-done' : st === 'blocked' || st === 'conflict' ? 'is-danger' : st === 'ready_for_review' || st === 'review' ? 'is-you' : st === 'pending' || st === 'gathering' || st === 'unknown' ? 'is-quiet' : 'is-employee'; };
    var cell = function (k, v, st, extra) {
      return '<div class="oj-sum-cell"><span class="oj-sum-k">' + esc(k) + '</span><span class="oj-chip ' + cls(st) + '">' + esc(v) + '</span>'
        + (extra && !compact ? '<span class="oj-sum-detail">' + esc(extra) + '</span>' : '') + '</div>';
    };
    var docDetail = sm.documentation.detail && sm.documentation.detail !== sm.documentation.label ? sm.documentation.detail : '';
    return '<div class="oj-summary">'
      + cell('Phase 1 · Offer', sm.offer.label, sm.offer.state)
      + cell('Phase 2 · Documentation', sm.documentation.label, sm.documentation.state, docDetail)
      + cell('Phase 3 · Induction', sm.induction.label, sm.induction.state)
      + cell('Internal setup', sm.setup.label, sm.setup.total && sm.setup.ready === sm.setup.total ? 'complete' : 'active')
      + cell('Payroll', sm.payroll.label, sm.payroll.state)
      + cell('Needs your attention', sm.attention ? sm.attention + ' item' + (sm.attention === 1 ? '' : 's') : 'Nothing', sm.attention ? 'review' : 'complete')
      + (sm.employee ? cell('Employee', sm.employee, 'complete') : '')
      + '</div>';
  }

  function nextLine(next) {
    var cls = next.actor === 'admin' ? 'is-you' : next.actor === 'employee' ? 'is-employee' : 'is-quiet';
    var who = next.actor === 'admin' ? 'You' : next.actor === 'employee' ? 'Employee' : next.actor === 'system' ? 'Portal' : 'Done';
    return '<div class="oj-next ' + cls + '"><span class="oj-next-who">' + esc(who) + '</span><span class="oj-next-l">' + esc(next.label) + '</span></div>';
  }

  function boardRow(r) {
    var c = r.counts;
    var bits = [];
    if (c.overdue) bits.push('<span class="oj-chip is-danger">' + c.overdue + ' overdue</span>');
    if (c.adminReview) bits.push('<span class="oj-chip is-you">' + c.adminReview + ' to review</span>');
    if (c.waitingOnEmployee) bits.push('<span class="oj-chip">' + c.waitingOnEmployee + ' with employee</span>');
    if (c.internalOpen) bits.push('<span class="oj-chip">' + c.internalOpen + ' internal</span>');
    if (r.complete) bits.push('<span class="oj-chip is-done">Complete</span>');
    if (r.closed) bits.push('<span class="oj-chip is-quiet">' + esc(titleCase(r.status)) + '</span>');

    return '<article class="oj-row oj-tile-link' + (r.next.actor === 'admin' ? ' needs-you' : '') + '" role="link" tabindex="0" onclick="OnboardingJourney.openRecord(\'' + jsq(r.id) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();OnboardingJourney.openRecord(\'' + jsq(r.id) + '\');}">'
      + '<div class="oj-row-main">'
      + '  <h3>' + esc(r.applicantName) + '</h3>'
      + '  <p class="oj-quiet">' + esc(r.jobTitle || 'Position not set') + ' · ' + esc(titleCase(r.employmentType)) + (r.startDate ? ' · commencement ' + esc(fmtDate(r.startDate)) + ' (' + esc(daysWord(r.daysToStart)) + ')' : '') + '</p>'
      + (r.summary ? summaryLines(r.summary, true) : stageTrack(r))
      + '</div>'
      + '<div class="oj-row-side">'
      + nextLine(r.next)
      + '<div class="oj-chips">' + bits.join('') + '</div>'
      + '</div>'
      + '</article>';
  }

  function setFilter(f) { S.filter = f; var pane = doc.getElementById('oj-view'); if (pane && S.board) drawBoard(pane); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDIT ONBOARDING — the default copy each package starts from
  // ═══════════════════════════════════════════════════════════════════════════

  async function viewDefaults(pane, actions) {
    if (actions) actions.innerHTML = S.packageId ? '<button type="button" class="oj-btn" onclick="OnboardingJourney.nav(\'defaults\')">← All packages</button>' : '';
    if (!S.packageId) {
      var res = await api('/api/onboarding/journey/defaults');
      if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'; return; }
      pane.innerHTML = '<p class="oj-quiet">Each package is the default an onboarding starts from. Open one to walk through its three phases and tweak the documents; every new onboarding for that package inherits the tweak.</p>'
        + '<div class="oj-list">' + res.packages.map(function (p) {
          return '<article class="oj-row oj-tile-link" role="link" tabindex="0" onclick="OnboardingJourney.openDefaults(\'' + jsq(p.id) + '\')" onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();OnboardingJourney.openDefaults(\'' + jsq(p.id) + '\');}"><div class="oj-row-main"><h3>' + esc(p.title) + '</h3>'
            + '<p class="oj-quiet">' + esc(titleCase(p.roleCategory || '')) + ' · ' + esc(titleCase(p.employmentType || '')) + (p.tweaks ? ' · ' + p.tweaks + ' tweak' + (p.tweaks === 1 ? '' : 's') : '') + (p.published ? '' : ' · not published') + '</p></div>'
            + '<div class="oj-row-side"><span class="oj-tile-arrow" aria-hidden="true">→</span></div></article>';
        }).join('') + '</div>';
      return;
    }
    var d = await api('/api/onboarding/journey/defaults/' + encodeURIComponent(S.packageId));
    if (!d.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(d.error) + '</div>'; return; }
    S.defaults = d;
    drawDefaults(pane);
  }
  function openDefaults(id) { nav('defaults', id); }

  function drawDefaults(pane) {
    var d = S.defaults; var view = S.defaultsPhase || 1;
    var names = ['Letter of Offer', 'Onboarding Documentation', 'Internal Induction'];
    var stepper = '<ol class="oj-stepper">' + names.map(function (n, i) {
      var num = i + 1;
      return '<li class="oj-stepper-step is-current' + (num === view ? ' is-viewing' : '') + '"><button type="button" onclick="OnboardingJourney.viewDefaultsPhase(' + num + ')"><span class="oj-stepper-n">' + num + '</span>' + esc(n) + '</button></li>';
    }).join('') + '</ol>';
    var body;
    if (view === 1) {
      body = '<section class="oj-panel oj-stage"><header><h2><span class="oj-stage-n">1</span>Letter of Offer</h2></header>'
        + '<p class="oj-quiet">The letter template, filled with a sample employee so you can see how it reads. The wording is fixed; the particulars come from each onboarding\'s details.</p>'
        + '<div class="oj-actions">' + btn('Preview the letter', 'OnboardingJourney.previewDefaultsLetter()', 'oj-btn-primary') + '<a class="oj-btn" href="' + esc(d.letter.downloadUrl) + '">Download (.docx)</a>' + (d.letter.pdfUrl ? '<a class="oj-btn" href="' + esc(d.letter.pdfUrl) + '">Download (PDF)</a>' : '') + '</div>'
        + '<h3 class="oj-sub">Email 1</h3><pre class="oj-pre">' + esc(d.emails.offer.subject) + '\n\n' + esc(d.emails.offer.body) + '</pre></section>';
    } else {
      var phase = view === 2 ? 'documentation' : 'induction';
      var em = view === 2 ? d.emails.documentation : d.emails.induction;
      body = defaultsTable(d, phase)
        + '<section class="oj-panel"><h3 class="oj-sub">' + (view === 2 ? 'Email 2' : 'Email 3') + '</h3><pre class="oj-pre">' + esc(em.subject) + '\n\n' + esc(em.body) + '</pre></section>';
    }
    pane.innerHTML = '<div class="oj-record-head"><div><h2>' + esc(d.package.title) + '</h2><p class="oj-quiet">' + esc(titleCase(d.package.roleCategory || '')) + ' · ' + esc(titleCase(d.package.employmentType || '')) + ' · default copy — nothing here is sent to anyone</p></div></div>'
      + stepper + '<div class="oj-stages">' + body + '</div>';
  }
  function viewDefaultsPhase(n) { S.defaultsPhase = n; var pane = doc.getElementById('oj-view'); if (pane && S.defaults) drawDefaults(pane); }
  function previewDefaultsLetter() {
    var L = S.defaults && S.defaults.letter; if (!L) return;
    if (global.DocPreview) global.DocPreview.open({ kind: 'docx', url: L.previewUrl + '&r=' + Date.now(), downloadUrl: L.downloadUrl, title: 'Letter of Offer — template', meta: 'Sample employee' });
    else global.open(L.downloadUrl, '_blank');
  }

  function defaultsTable(d, phase) {
    var items = d.phases[phase].items; var edit = d.can && d.can.edit;
    var included = items.filter(function (i) { return i.status === 'included'; }); var removed = items.filter(function (i) { return i.status !== 'included'; });
    var groups = {}; included.forEach(function (i) { var k = i.section || 'other'; (groups[k] = groups[k] || []).push(i); });
    var order = Object.keys(SECTION_LABELS).concat(['other']).filter(function (k) { return groups[k]; });
    var flag = function (i, field, value) {
      if (!edit) return yesNo(value);
      return '<button type="button" class="oj-toggle ' + (value ? 'is-on' : '') + '" onclick="OnboardingJourney.defaultsFlag(\'' + jsq(i.code) + '\',\'' + phase + '\',\'' + field + '\',' + (value ? 'false' : 'true') + ')">' + (value ? 'Yes' : 'No') + '</button>';
    };
    var out = '<section class="oj-panel oj-stage"><header><h2><span class="oj-stage-n">' + (phase === 'induction' ? 3 : 2) + '</span>' + (phase === 'induction' ? 'Internal Induction Pack' : 'Onboarding Documentation Pack') + '</h2></header>'
      + '<div class="oj-pack-head"><div><strong>' + included.length + ' items by default</strong> <span class="oj-quiet">for this package. Required, Employee returns and Verified by us start as No — set them here for each document.</span></div>'
      + (edit ? '<div class="oj-actions">' + btn('Restore defaults', 'OnboardingJourney.defaultsRestore(\'' + phase + '\')', 'oj-btn-quiet') + '</div>' : '') + '</div>'
      + '<div id="oj-defaults-add" hidden></div>'
      + '<div class="oj-table-wrap"><table class="oj-pack"><thead><tr><th>Document</th><th>Required</th><th>Employee returns</th><th>Verified by us</th><th>File</th><th></th></tr></thead><tbody>'
      + (edit ? '<tr class="oj-pack-addrow"><td colspan="6">' + btn('+ Add a document to this package', 'OnboardingJourney.defaultsAddOpen(\'' + phase + '\')', 'oj-btn-primary oj-btn-small') + '</td></tr>' : '');
    order.forEach(function (k) {
      out += '<tr class="oj-pack-section"><td colspan="6">' + esc(SECTION_LABELS[k] || titleCase(k)) + '</td></tr>';
      groups[k].forEach(function (i) {
        var f = i.file || {};
        var fileCell = i.itemKind !== 'document' ? '<span class="oj-quiet">' + (i.itemKind === 'account' ? 'Follows the set-up task' : 'Follows the induction task') + '</span>'
          : f.previewUrl ? '<span class="oj-quiet">' + esc(f.fileName || 'Library') + '</span>' : !i.sendsDocument ? '<span class="oj-quiet">Employee supplies their own</span>'
          : f.source === 'link' && i.officialSourceUrl ? '<span class="oj-warn">No file</span> <a href="' + esc(i.officialSourceUrl) + '" target="_blank" rel="noopener" class="oj-quiet">official source ↗</a>' : '<span class="oj-warn">No file yet</span>';
        var fileActs = [];
        if (f.previewUrl) fileActs.push(btn('Preview', 'OnboardingJourney.defaultsPreview(\'' + jsq(i.code) + '\',\'' + phase + '\')', 'oj-btn-small oj-btn-quiet'));
        if (f.previewUrl) fileActs.push('<a class="oj-btn oj-btn-small oj-btn-quiet" href="' + esc(f.previewUrl) + '" download>Download</a>');
        if (edit && i.itemKind === 'document') fileActs.push('<label class="oj-btn oj-btn-small oj-file' + (f.previewUrl ? ' oj-btn-quiet' : ' oj-btn-primary') + '">' + (f.previewUrl ? 'Replace' : 'Upload file') + '<input type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.defaultsUpload(\'' + jsq(i.code) + '\',\'' + phase + '\', this)"></label>');
        var rowActs = [];
        if (edit) { rowActs.push(btn('Rename', 'OnboardingJourney.defaultsRename(\'' + jsq(i.code) + '\',\'' + phase + '\',\'' + jsq(i.title) + '\')', 'oj-btn-small oj-btn-quiet')); rowActs.push(btn('Remove', 'OnboardingJourney.defaultsRemove(\'' + jsq(i.code) + '\',\'' + phase + '\', true)', 'oj-btn-small oj-btn-quiet')); }
        out += '<tr' + (i.origin === 'added' ? ' class="oj-pack-row is-added"' : '') + '><td><strong>' + esc(i.title) + '</strong>' + (i.origin === 'added' ? ' <span class="oj-chip is-you">Added</span>' : i.tweaked ? ' <span class="oj-chip is-quiet">Tweaked</span>' : '') + (i.description ? '<br><span class="oj-quiet">' + esc(i.description) + '</span>' : '') + '</td>'
          + '<td>' + flag(i, 'required', i.required) + '</td><td>' + flag(i, 'employeeReturns', i.employeeReturns) + '</td><td>' + flag(i, 'requiresVerification', i.requiresVerification) + '</td>'
          + '<td class="oj-filecell"><div>' + fileCell + '</div>' + (fileActs.length ? '<div class="oj-actions oj-actions-tight oj-file-acts">' + fileActs.join('') + '</div>' : '') + '</td>'
          + '<td class="oj-rowacts"><div class="oj-actions oj-actions-tight">' + rowActs.join('') + '</div></td></tr>';
      });
    });
    out += '</tbody></table></div>';
    if (removed.length) out += '<details class="oj-history"><summary>Removed from this package\'s default (' + removed.length + ')</summary><ul>' + removed.map(function (i) { return '<li>' + esc(i.title) + (edit ? ' ' + btn('Restore', 'OnboardingJourney.defaultsRemove(\'' + jsq(i.code) + '\',\'' + phase + '\', false)', 'oj-btn-small oj-btn-quiet') : '') + '</li>'; }).join('') + '</ul></details>';
    out += '</section>';
    return out;
  }

  async function defaultsAct(rest, body, method, okMessage) {
    if (S.busy) return null; S.busy = true;
    var res = await api('/api/onboarding/journey/defaults/' + encodeURIComponent(S.packageId) + rest, { method: method || 'POST', body: body || {} });
    S.busy = false;
    if (!res.ok) { toast(res.error, true); return res; }
    if (res.items && S.defaults) S.defaults.phases[res.phase].items = res.items;
    if (okMessage) toast(okMessage);
    var pane = doc.getElementById('oj-view'); if (pane && S.defaults) drawDefaults(pane);
    return res;
  }
  function defaultsFlag(code, phase, field, value) { var b = { phase: phase }; b[field] = value; return defaultsAct('/items/' + encodeURIComponent(code), b, 'PATCH'); }
  async function defaultsRename(code, phase, current) {
    var title = await portalPrompt('Document name in this package\'s default pack:', current || '');
    if (title === null) return; if (!title.trim()) return toast('Give the document a name.', true);
    return defaultsAct('/items/' + encodeURIComponent(code), { phase: phase, title: title.trim() }, 'PATCH', 'Renamed for every new onboarding of this package.');
  }
  function defaultsRemove(code, phase, removed) { return defaultsAct('/items/' + encodeURIComponent(code), { phase: phase, removed: removed }, 'PATCH', removed ? 'Removed from the default.' : 'Restored to the default.'); }
  async function defaultsUpload(code, phase, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is larger than 10 MB.', true); input.value = ''; return; }
    var ext = String(file.name).split('.').pop().toLowerCase();
    var mime = MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type);
    var b64; try { b64 = await readFileAsBase64(file); } catch (_) { toast('The file could not be read.', true); return; }
    input.value = '';
    return defaultsAct('/items/' + encodeURIComponent(code) + '/file', { phase: phase, fileName: file.name, fileMime: mime, fileData: b64 }, 'POST', 'File uploaded — it now goes out in every new onboarding that includes this document.');
  }
  async function defaultsRestore(phase) { if (!await portalConfirm('Restore this package\'s default pack? Every tweak for this phase is cleared.')) return; return defaultsAct('/restore', { phase: phase }, 'POST', 'Defaults restored.'); }
  function defaultsPreview(code, phase) {
    var i = (S.defaults.phases[phase].items || []).filter(function (x) { return x.code === code; })[0];
    if (!i || !i.file || !i.file.previewUrl) return;
    if ((i.file.previewKind === 'pdf' || i.file.previewKind === 'docx') && global.DocPreview) global.DocPreview.open({ kind: i.file.previewKind, url: i.file.previewUrl, downloadUrl: i.file.previewUrl, title: i.title, meta: 'Library copy' });
    else global.open(i.file.previewUrl, '_blank', 'noopener');
  }
  async function defaultsAddOpen(phase) {
    var host = doc.getElementById('oj-defaults-add'); if (!host) return;
    host.hidden = false; host.innerHTML = spinner('Loading the library…');
    var lib = await api('/api/onboarding/documents?audience=employee');
    var docs = (lib.ok && (lib.documents || lib.items)) || [];
    var opts = [['', '— Choose a library document —']].concat(docs.filter(function (x) { return x.status !== 'archived'; }).map(function (x) { return [x.id, x.title]; }));
    host.innerHTML = '<div class="oj-panel oj-add"><h3>Add a document to this package\'s default ' + (phase === 'induction' ? 'induction' : 'documentation') + ' pack</h3>'
      + '<div class="oj-grid2">' + field('oj-da-doc', 'From the library', select('oj-da-doc', opts, '')) + field('oj-da-title', 'Name (optional when choosing from the library)', input('oj-da-title', 'text', '', 'maxlength="250"')) + '</div>'
      + '<div class="oj-check-row"><label class="oj-check"><input type="checkbox" id="oj-da-sends" checked> A file is sent in the pack</label><label class="oj-check"><input type="checkbox" id="oj-da-returns"> The employee returns it</label><label class="oj-check"><input type="checkbox" id="oj-da-verifies"> We verify it</label><label class="oj-check"><input type="checkbox" id="oj-da-required" checked> Required</label></div>'
      + '<div class="oj-actions">' + btn('Add to the default', 'OnboardingJourney.defaultsAddSubmit(\'' + phase + '\')', 'oj-btn-primary') + btn('Cancel', 'OnboardingJourney.defaultsAddClose()') + '</div></div>';
  }
  function defaultsAddClose() { var host = doc.getElementById('oj-defaults-add'); if (host) { host.hidden = true; host.innerHTML = ''; } }
  async function defaultsAddSubmit(phase) {
    var v = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
    var ck = function (id) { var el = doc.getElementById(id); return !!(el && el.checked); };
    if (!v('oj-da-doc') && !v('oj-da-title')) return toast('Choose a library document or give the new document a name.', true);
    var res = await defaultsAct('/items', { phase: phase, documentId: v('oj-da-doc') || null, title: v('oj-da-title') || null, sendsDocument: ck('oj-da-sends'), employeeReturns: ck('oj-da-returns'), requiresVerification: ck('oj-da-verifies'), required: ck('oj-da-required') }, 'POST', 'Added to the default.');
    if (res && res.ok) defaultsAddClose();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  START ONBOARDING
  // ═══════════════════════════════════════════════════════════════════════════

  async function viewStart(pane, actions) {
    if (actions) actions.innerHTML = '';
    if (!S.options) {
      var o = await api('/api/onboarding/journey/options');
      if (!o.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(o.error) + '</div>'; return; }
      S.options = o;
    }
    pane.innerHTML = startForm(S.options, {});
    var first = doc.getElementById('oj-f-name');
    if (first) first.focus({ preventScroll: true });
  }

  function field(id, label, control, hint) {
    return '<div class="oj-field"><label for="' + id + '">' + esc(label) + '</label>' + control
      + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }
  function input(id, type, value, attrs) {
    return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  }
  /** Suggested values for a number field: a native datalist, so the field stays free-text. */
  var SUGGEST = {
    payAnnual: [65000, 70000, 75000, 80000, 85000, 90000, 95000, 100000, 110000, 120000],
    payHourly: [35, 40, 45, 50, 55, 60, 65, 70, 75, 80],
    hours: [[38, '38 — full time'], [30.4, '30.4 — 0.8 FTE'], [22.8, '22.8 — 0.6 FTE'], [19, '19 — 0.5 FTE'], [15.2, '15.2 — 0.4 FTE'], [7.6, '7.6 — 0.2 FTE']],
    probation: [[0, 'None'], [3, '3 months'], [6, '6 months'], [12, '12 months']]
  };
  function suggestOptions(options) {
    return options.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o; var l = Array.isArray(o) ? o[1] : '';
      return '<option value="' + esc(v) + '"' + (l ? ' label="' + esc(l) + '"' : '') + '></option>';
    }).join('');
  }
  function suggest(id, options) { return '<datalist id="' + id + '-list">' + suggestOptions(options) + '</datalist>'; }
  /** Pay basis changed: swap the salary suggestions between annual and hourly figures. */
  function syncPaySuggestions(prefix) {
    var basis = doc.getElementById(prefix + 'payBasis'), list = doc.getElementById(prefix + 'payRate-list');
    if (basis && list) list.innerHTML = suggestOptions(basis.value === 'hourly' ? SUGGEST.payHourly : SUGGEST.payAnnual);
  }
  function select(id, options, value, attrs) {
    return '<select id="' + id + '" ' + (attrs || '') + '>' + options.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o; var l = Array.isArray(o) ? o[1] : titleCase(o);
      return '<option value="' + esc(v) + '"' + (String(v) === String(value == null ? '' : value) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('') + '</select>';
  }

  /** The terms half of the form. Shared by Start Onboarding and the offer editor. */
  function termsFields(opts, t, prefix) {
    var p = prefix || 'oj-f-';
    var types = (opts.employmentTypes || []).map(function (x) { return [x, titleCase(x)]; });
    return ''
      + '<div class="oj-grid2">'
      + field(p + 'position', 'Position', input(p + 'position', 'text', t.positionTitle, 'maxlength="150" required'))
      + field(p + 'employmentType', 'Employment type', select(p + 'employmentType', types, t.employmentType || 'full_time'))
      + field(p + 'startDate', 'Commencement date', input(p + 'startDate', 'date', isoDate(t.startDate), 'required'))
      + field(p + 'endDate', 'End date (fixed-term only)', input(p + 'endDate', 'date', isoDate(t.endDate)))
      + field(p + 'payBasis', 'Pay basis', select(p + 'payBasis', [['annual', 'Annual salary'], ['hourly', 'Hourly rate']], t.payBasis || 'annual', 'onchange="OnboardingJourney.syncPay(\'' + jsq(p) + '\')"'))
      + field(p + 'payRate', 'Salary or rate (AUD, excl. super)', input(p + 'payRate', 'number', t.payRate, 'min="0" step="0.01" inputmode="decimal" list="' + p + 'payRate-list"') + suggest(p + 'payRate', t.payBasis === 'hourly' ? SUGGEST.payHourly : SUGGEST.payAnnual))
      + field(p + 'hoursPerWeek', 'Standard hours per week', input(p + 'hoursPerWeek', 'number', t.hoursPerWeek, 'min="0" max="80" step="0.1" inputmode="decimal" list="' + p + 'hoursPerWeek-list"') + suggest(p + 'hoursPerWeek', SUGGEST.hours))
      + field(p + 'probationMonths', 'Probation (months)', input(p + 'probationMonths', 'number', t.probationMonths == null ? 6 : t.probationMonths, 'min="0" max="12" step="1" list="' + p + 'probationMonths-list"') + suggest(p + 'probationMonths', SUGGEST.probation))
      + field(p + 'awardClassification', 'Award / classification', input(p + 'awardClassification', 'text', t.awardClassification, 'maxlength="150"'), 'e.g. Health Professionals and Support Services Award, Level 2')
      + field(p + 'workLocation', 'Location', input(p + 'workLocation', 'text', t.workLocation || (opts.defaults && opts.defaults.workLocation) || '', 'maxlength="150"'))
      + '</div>'
      + '<details class="oj-more"><summary>Letter particulars (defaults apply if left blank)</summary><div class="oj-grid2">'
      + field(p + 'award', 'Applicable modern award', input(p + 'award', 'text', t.award, 'maxlength="200" placeholder="Health Professionals and Support Services Award 2020 (MA000027)"'))
      + field(p + 'workPattern', 'Work pattern', input(p + 'workPattern', 'text', t.workPattern, 'maxlength="200" placeholder="worked between 8:30am and 4:30pm (flexible), Monday to Friday"'))
      + field(p + 'payCycle', 'Pay cycle', input(p + 'payCycle', 'text', t.payCycle, 'maxlength="40" placeholder="Fortnightly"'))
      + field(p + 'superannuationRate', 'Superannuation %', input(p + 'superannuationRate', 'number', t.superannuationRate, 'min="0" max="30" step="0.5" placeholder="12"'))
      + field(p + 'offerClosingDate', 'Offer closing date', input(p + 'offerClosingDate', 'date', isoDate(t.offerClosingDate)), 'Blank: seven days from the day the letter is issued.')
      + '</div></details>';
  }

  function readTerms(prefix) {
    var p = prefix || 'oj-f-';
    var v = function (k) { var el = doc.getElementById(p + k); return el ? el.value.trim() : ''; };
    return {
      positionTitle: v('position'), employmentType: v('employmentType'), startDate: v('startDate') || null,
      endDate: v('endDate') || null, payBasis: v('payRate') ? v('payBasis') : null, payRate: v('payRate') || null,
      hoursPerWeek: v('hoursPerWeek') || null, probationMonths: v('probationMonths') || null,
      awardClassification: v('awardClassification') || null, workLocation: v('workLocation') || null,
      award: v('award') || null, workPattern: v('workPattern') || null, payCycle: v('payCycle') || null,
      superannuationRate: v('superannuationRate') || null, offerClosingDate: v('offerClosingDate') || null,
    };
  }

  function startForm(opts, t) {
    var staff = [['', '— Not set —']].concat((opts.staff || []).map(function (u) { return [u.id, u.name + ' (' + titleCase(u.role) + ')']; }));
    var roleCats = [['', '— Choose —']].concat((opts.roleCategories || []).map(function (c) { return [c, titleCase(c)]; }));
    var pkgs = [['', 'Recommend from role and employment type']].concat((opts.packages || []).map(function (p) { return [p.id, p.title]; }));
    return ''
      + '<form class="oj-form" id="oj-start" onsubmit="return OnboardingJourney.submitStart(event)">'
      + '<section class="oj-panel"><h2>Who</h2>'
      + '<div class="oj-grid2">'
      + field('oj-f-name', 'Full name', input('oj-f-name', 'text', '', 'maxlength="200" required autocomplete="off"'))
      + field('oj-f-email', 'Personal email', input('oj-f-email', 'email', '', 'maxlength="255" required autocomplete="off"'), 'The letter of offer and the onboarding invitation go here.')
      + field('oj-f-mobile', 'Mobile (optional)', input('oj-f-mobile', 'tel', '', 'maxlength="40"'))
      + field('oj-f-roleCategory', 'Role category', select('oj-f-roleCategory', roleCats, ''), 'Drives which onboarding package applies.')
      + field('oj-f-proposedRole', 'Portal access role', select('oj-f-proposedRole', [['therapist', 'Therapist'], ['admin', 'Admin'], ['read_only', 'Read only']], 'therapist'), 'Granted at induction, never before.')
      + field('oj-f-managerUserId', 'Reports to', select('oj-f-managerUserId', staff, ''))
      + '</div>'
      + '<label class="oj-check"><input type="checkbox" id="oj-f-treating" checked> Treating therapist (works directly with participants)</label>'
      + '</section>'
      + '<section class="oj-panel"><h2>The offer</h2>'
      + '<p class="oj-quiet">Entered once. These terms become the letter of offer, the employment profile and the payroll set-up task.</p>'
      + termsFields(opts, t)
      + '</section>'
      + '<section class="oj-panel"><h2>Onboarding package</h2>'
      + field('oj-f-packageId', 'Documentation package', select('oj-f-packageId', pkgs, ''), 'Left alone, the portal picks the published package that matches the role and employment type.')
      + field('oj-f-notes', 'Internal note (optional)', '<textarea id="oj-f-notes" rows="2" maxlength="2000"></textarea>')
      + '</section>'
      + '<div id="oj-start-error" class="ob-note is-danger" role="alert" hidden></div>'
      + '<div class="oj-actions"><button type="submit" class="oj-btn oj-btn-primary" id="oj-start-submit">Create the record and draft the letter</button>'
      + '<button type="button" class="oj-btn" onclick="OnboardingJourney.nav(\'board\')">Cancel</button></div>'
      + '</form>';
  }

  async function submitStart(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return false;
    var errEl = doc.getElementById('oj-start-error');
    var btn = doc.getElementById('oj-start-submit');
    var v = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
    var terms = readTerms();
    var body = {
      name: v('oj-f-name'), personalEmail: v('oj-f-email'), mobile: v('oj-f-mobile') || null,
      roleCategory: v('oj-f-roleCategory') || null, proposedRole: v('oj-f-proposedRole'),
      managerUserId: v('oj-f-managerUserId') || null,
      isTreatingTherapist: !!(doc.getElementById('oj-f-treating') || {}).checked,
      position: terms.positionTitle, employmentType: terms.employmentType, startDate: terms.startDate, endDate: terms.endDate,
      payBasis: terms.payBasis, payRate: terms.payRate, hoursPerWeek: terms.hoursPerWeek, probationMonths: terms.probationMonths,
      awardClassification: terms.awardClassification, workLocation: terms.workLocation, additionalTerms: terms.additionalTerms,
      award: terms.award, workPattern: terms.workPattern, payCycle: terms.payCycle,
      superannuationRate: terms.superannuationRate, offerClosingDate: terms.offerClosingDate,
      packageId: v('oj-f-packageId') || null, notes: v('oj-f-notes') || null,
    };
    S.busy = true; if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    var res = await api('/api/onboarding/journey/records', { method: 'POST', body: body });
    S.busy = false; if (btn) { btn.disabled = false; btn.textContent = 'Create the record and draft the letter'; }
    if (!res.ok) {
      if (errEl) { errEl.textContent = res.error; errEl.hidden = false; errEl.scrollIntoView({ block: 'nearest' }); }
      return false;
    }
    toast('Onboarding started — the letter of offer is drafted and waiting for your approval.');
    S.record = res;
    nav('record', res.record.id);
    return false;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ONE RECORD
  // ═══════════════════════════════════════════════════════════════════════════

  async function viewRecord(pane, actions) {
    if (actions) actions.innerHTML = '<button type="button" class="oj-btn" onclick="OnboardingJourney.nav(\'board\')">← All onboarding</button>';
    if (!S.record || !S.record.record || S.record.record.id !== S.recordId) {
      var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId));
      if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'; return; }
      S.record = res;
    }
    if (!S.options && can('onboarding.assign')) {
      var o = await api('/api/onboarding/journey/options');
      if (o.ok) S.options = o;
    }
    drawRecord(pane);
  }

  function drawRecord(pane) {
    var d = S.record; var r = d.record; var j = d.journey;
    var stagePill = '';

    pane.innerHTML = ''
      + '<div class="oj-record-head">'
      + '  <div><h2>' + esc(r.applicantName) + ' ' + stagePill + '</h2>'
      + '  <p class="oj-quiet">' + esc(r.jobTitle || 'Position not set') + ' · ' + esc(titleCase(r.employmentType)) + ' · ' + esc(r.applicantEmail || '')
      + (r.startDate ? ' · commences ' + esc(fmtDate(r.startDate)) + ' (' + esc(daysWord(j.daysToStart)) + ')' : '') + '</p></div>'
      + '  <div class="oj-record-head-actions">' + recordHeadActions(d) + '</div>'
      + '</div>'
      // One phase at a time. The screen shows the phase the record is on;
      // when that phase completes, the screen moves to the next. Earlier
      // phases stay reachable through the stepper.
      + phaseStepper(d)
      + '<div class="oj-stages">'
      + phaseBody(d)
      + '</div>'
      + emailsPanel(d);
  }

  /** Which phase the record is on: 1 until the signed letter is in, 2 until the documentation is done, then 3. */
  function currentPhase(d) {
    var o = d.offer; var r = d.record;
    if (!o || ['accepted', 'not_required'].indexOf(o.status) === -1) return 1;
    var I = d.induction || {};
    if (I.sentAt || I.completedAt || r.status === 'completed' || r.status === 'activated' || r.status === 'ready_to_activate') return 3;
    if (d.journey && d.journey.stages && d.journey.stages[1] && d.journey.stages[1].state === 'complete') return 3;
    return 2;
  }

  function phaseStepper(d) {
    var cur = currentPhase(d);
    var view = S.phaseView || cur;
    var names = ['Letter of Offer', 'Onboarding Documentation', 'Internal Induction'];
    return '<ol class="oj-stepper">' + names.map(function (n, i) {
      var num = i + 1; var state = num < cur ? 'done' : num === cur ? 'current' : 'upcoming';
      var clickable = num <= cur;
      return '<li class="oj-stepper-step is-' + state + (num === view ? ' is-viewing' : '') + '">'
        + (clickable ? '<button type="button" onclick="OnboardingJourney.viewPhase(' + num + ')">' : '<span>')
        + '<span class="oj-stepper-n">' + (state === 'done' ? '✓' : num) + '</span>' + esc(n)
        + (clickable ? '</button>' : '</span>') + '</li>';
    }).join('') + '</ol>';
  }

  function phaseBody(d) {
    var cur = currentPhase(d);
    var view = Math.min(S.phaseView || cur, cur);
    if (view === 1) return offerPanel(d);
    if (view === 2) return documentationPanel(d) + inductionPanel(d) + payrollPanel(d);
    return phase3Panel(d) + inductionPanel(d) + payrollPanel(d) + profilePanel(d);
  }

  function viewPhase(n) { S.phaseView = n; var pane = doc.getElementById('oj-view'); if (pane && S.record) drawRecord(pane); }

  function recordHeadActions(d) {
    var r = d.record;
    if (d.journey.closed) return '';
    var out = '';
    if (d.can.assign && r.status !== 'activated' && r.status !== 'completed') {
      out += '<button type="button" class="oj-btn oj-btn-quiet" onclick="OnboardingJourney.cancelRecord()">Cancel onboarding</button>';
    }
    return out;
  }

  function nextBanner(d) {
    var n = d.journey.next;
    var action = '';
    if (n.actor === 'admin' && n.action) action = actionButton(n, d);
    return '<div class="oj-next-banner ' + (n.actor === 'admin' ? 'is-you' : n.actor === 'employee' ? 'is-employee' : 'is-quiet') + '">'
      + '<div><span class="oj-next-k">What happens next</span><strong>' + esc(n.label) + '</strong>'
      + '<span class="oj-quiet"> — ' + (n.actor === 'admin' ? 'this one is yours' : n.actor === 'employee' ? 'the portal is waiting on the employee and will chase them' : n.actor === 'system' ? 'the portal is handling it' : 'nothing to do') + '</span></div>'
      + (action ? '<div>' + action + '</div>' : '')
      + '</div>';
  }

  function actionButton(n, d) {
    var c = d.can;
    switch (n.action) {
      case 'edit_offer': case 'reissue_offer': return c.assign ? btn('Edit the offer details', 'OnboardingJourney.editTerms()', 'oj-btn-primary') : '';
      case 'prepare_email': return btn('Preview the letter', 'OnboardingJourney.previewLetter()', 'oj-btn-primary') + btn('Go to Email 1', 'OnboardingJourney.scrollTo(\'oj-email\')');
      case 'send_in_outlook': return (d.offer && d.offer.email && d.offer.email.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(d.offer.email.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '')
        + (c.assign ? btn('Mark as sent', 'OnboardingJourney.markSent()') : '');
      case 'verify_offer': return btn('View the signed letter', 'OnboardingJourney.previewSigned()') + (c.assign ? btn('Verify', 'OnboardingJourney.verifyOffer()', 'oj-btn-primary') : '');
      case 'release': return c.assign ? btn('Release the documentation', 'OnboardingJourney.release()', 'oj-btn-primary') : '';
      case 'review_pack': return btn('Review the document pack', 'OnboardingJourney.scrollTo(\'oj-stage-2\')', 'oj-btn-primary');
      case 'send_pack_in_outlook': return (d.pack && d.pack.email && d.pack.email.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(d.pack.email.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '')
        + (c.assign ? btn('Mark as sent', 'OnboardingJourney.packMarkSent()') : '');
      case 'review_returns': return btn('Open the document pack', 'OnboardingJourney.scrollTo(\'oj-stage-2\')', 'oj-btn-primary');
      case 'unblock_induction': return btn('See what is blocking Phase 3', 'OnboardingJourney.scrollTo(\'oj-phase3\')', 'oj-btn-primary');
      case 'prepare_induction': return btn('Review the induction pack', 'OnboardingJourney.scrollTo(\'oj-phase3\')', 'oj-btn-primary');
      case 'send_induction_in_outlook': return (d.induction && d.induction.email && d.induction.email.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(d.induction.email.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '')
        + (c.assign ? btn('Mark as sent', 'OnboardingJourney.packMarkSent(\'induction\')') : '');
      case 'review': return btn('Open the review', 'OnboardingJourney.openReview()', 'oj-btn-primary');
      case 'activate': return c.activate ? btn('Activate portal access', 'OnboardingJourney.runTask(\'portal_access\')', 'oj-btn-primary') : '';
      case 'task': return n.taskCode ? btn('Go to the task', 'OnboardingJourney.scrollTo(\'oj-task-' + jsq(n.taskCode) + '\')') : '';
      case 'open_record': return btn('Open the paper round-trip', 'OnboardingJourney.openReview()');
      default: return '';
    }
  }
  function btn(label, onclick, cls) {
    return '<button type="button" class="oj-btn ' + (cls || '') + '" onclick="' + onclick + '">' + esc(label) + '</button>';
  }

  var ATTENTION_ICONS = { conflict: '⚖', low_confidence: '?', unrecognised_document: '📄', missing_signature: '✍', missing_required_document: '⏳', expired_credential: '⌛', incorrect_document: '✕', payroll_approval: '$', account_setup_failed: '⚠', register_check: '🔍' };

  /** Requires Your Attention — only exceptions. */
  function attentionHtml(d) {
    var items = d.attention || [];
    var stageAsks = (d.journey.adminReview || []).filter(function (i) { return !i.attentionKind; });
    var out = '<section class="oj-panel oj-attention" id="oj-attention"><header><h2>Requires Your Attention <span class="oj-count">' + (items.length + stageAsks.length) + '</span></h2></header>';
    if (!items.length && !stageAsks.length) {
      out += '<p class="oj-quiet">Nothing needs you. The portal is handling the normal items.</p></section>';
      return out;
    }
    out += '<ul class="oj-attn">';
    items.forEach(function (a, n) { out += attentionItem(a, n, d); });
    stageAsks.forEach(function (i) { out += '<li class="oj-attn-item is-normal"><span class="oj-attn-ico">→</span><div><strong>' + esc(i.label) + '</strong></div></li>'; });
    out += '</ul></section>';
    return out;
  }

  function attentionItem(a, n, d) {
    var c = d.can || {};
    var act = a.action || {};
    var body = '<strong>' + esc(a.title) + '</strong>' + (a.detail && a.kind !== 'conflict' ? '<p class="oj-quiet">' + esc(a.detail) + '</p>' : '');
    var acts = '';
    switch (act.type) {
      case 'resolve_conflict':
        body += '<div class="oj-conflict">' + (a.options || []).map(function (o, k) {
          var id = 'oj-cf-' + n + '-' + k;
          return '<label class="oj-conflict-opt" for="' + id + '"><input type="radio" name="oj-cf-' + n + '" id="' + id + '" value="' + esc(o.candidateId || '') + '" data-value="' + esc(o.display || '') + '">'
            + '<span class="oj-conflict-src">' + esc(o.sourceLabel) + '</span><span class="oj-conflict-val">' + esc(o.display || '') + '</span>'
            + (o.confidence ? '<span class="oj-quiet">' + esc(o.confidence) + ' confidence</span>' : '') + '</label>';
        }).join('') + '</div>';
        if (c.review) acts = btn('Use the selected value', 'OnboardingJourney.resolveConflict(\'' + jsq(act.fieldId) + '\',' + n + ')', 'oj-btn-primary oj-btn-small') + btn('Type a different value', 'OnboardingJourney.correctField(\'' + jsq(act.fieldId) + '\')', 'oj-btn-small') + btn('Ignore', 'OnboardingJourney.rejectField(\'' + jsq(act.fieldId) + '\')', 'oj-btn-small oj-btn-quiet');
        break;
      case 'confirm_field': {
        var src = (d.returnedDocuments || []).filter(function (x) { return x.matchStatus !== 'unrecognised' && x.previewKind; })[0];
        if (src) acts += btn('Preview', 'OnboardingJourney.previewReturn(\'' + jsq(src.id) + '\')', 'oj-btn-small');
        if (c.review) acts += btn('Confirm', 'OnboardingJourney.acceptField(\'' + jsq(act.fieldId) + '\')', 'oj-btn-primary oj-btn-small') + btn('Correct it', 'OnboardingJourney.correctField(\'' + jsq(act.fieldId) + '\')', 'oj-btn-small') + btn('Ignore', 'OnboardingJourney.rejectField(\'' + jsq(act.fieldId) + '\')', 'oj-btn-small oj-btn-quiet');
        break;
      }
      case 'assign_document': {
        var opts = ((d.pack && d.pack.items) || []).filter(function (i) { return i.status === 'included' && i.employeeReturns; }).map(function (i) { return [i.id, i.title]; });
        body += '<div class="oj-inline-row">' + select('oj-asg-' + n, [['', '— Which document is this? —']].concat(opts), '') + '</div>';
        var rd = (d.returnedDocuments || []).filter(function (x) { return x.id === act.returnedDocumentId; })[0];
        if (rd && rd.previewKind) acts += btn('View', 'OnboardingJourney.previewReturn(\'' + jsq(rd.id) + '\')', 'oj-btn-small');
        if (c.review) acts += btn('Assign', 'OnboardingJourney.assignReturn(\'' + jsq(act.returnedDocumentId) + '\',' + n + ')', 'oj-btn-primary oj-btn-small') + btn('Not one of ours', 'OnboardingJourney.archiveReturn(\'' + jsq(act.returnedDocumentId) + '\')', 'oj-btn-small oj-btn-quiet');
        break;
      }
      case 'verify_item':
        if (act.returnedDocumentId) acts += btn('Preview', 'OnboardingJourney.previewReturn(\'' + jsq(act.returnedDocumentId) + '\')', 'oj-btn-small');
        if (c.verify) acts += btn(a.kind === 'register_check' ? 'Checked the register — verify' : 'Verify', 'OnboardingJourney.verifyItem(\'' + jsq(act.packItemId) + '\')', 'oj-btn-primary oj-btn-small') + btn('Reject', 'OnboardingJourney.rejectItem(\'' + jsq(act.packItemId) + '\')', 'oj-btn-small oj-btn-quiet');
        break;
      case 'approve_payroll':
        acts = btn('Review Payroll', 'OnboardingJourney.scrollTo(\'oj-payroll\')', 'oj-btn-primary oj-btn-small');
        break;
      case 'request_again': case 'chase':
        acts = btn('Open the pack', 'OnboardingJourney.scrollTo(\'oj-stage-2\')', 'oj-btn-small');
        break;
      case 'open_task':
        acts = btn('Go to internal setup', 'OnboardingJourney.scrollTo(\'oj-task-' + jsq(act.taskCode) + '\')', 'oj-btn-small');
        break;
      default: break;
    }
    return '<li class="oj-attn-item is-' + esc(a.severity || 'normal') + '"><span class="oj-attn-ico">' + (ATTENTION_ICONS[a.kind] || '!') + '</span><div>' + body + (acts ? '<div class="oj-actions oj-actions-tight">' + acts + '</div>' : '') + '</div></li>';
  }

  function groupsHtml(j) {
    var item = function (i) {
      var due = i.dueAt ? '<span class="oj-due' + (i.overdue ? ' is-overdue' : '') + '">' + (i.overdue ? 'overdue · ' : 'due ') + esc(fmtDate(i.dueAt)) + '</span>' : '';
      var who = i.assigneeName ? '<span class="oj-quiet"> · ' + esc(i.assigneeName) + '</span>' : '';
      var at = i.at ? '<span class="oj-quiet"> · ' + esc(fmtDate(i.at)) + '</span>' : '';
      return '<li' + (i.overdue ? ' class="is-overdue"' : '') + '>' + esc(i.label) + who + (i.kind === 'done' ? at : '') + ' ' + due + (i.detail ? '<span class="oj-quiet"> · ' + esc(i.detail) + '</span>' : '') + '</li>';
    };
    var group = function (title, items, cls, emptyText) {
      return '<div class="oj-group ' + cls + '"><h3>' + esc(title) + ' <span class="oj-count">' + items.length + '</span></h3>'
        + (items.length ? '<ul>' + items.map(item).join('') + '</ul>' : '<p class="oj-quiet">' + esc(emptyText) + '</p>') + '</div>';
    };
    return '<div class="oj-groups">'
      + group('Waiting on the employee', j.waitingOnEmployee, 'is-employee', 'Nothing with the employee.')
      + group('Internal set-up', j.internalOpen, 'is-internal', 'No internal tasks open.')
      + group('Completed', j.completed, 'is-done', 'Nothing completed yet.')
      + (j.overdue.length ? group('Overdue', j.overdue, 'is-danger', '') : '')
      + '</div>';
  }

  // ── Stage 1 panel ─────────────────────────────────────────────────────────

  function termsTable(t) {
    var rows = [
      ['Position', t.positionTitle], ['Employment type', titleCase(t.employmentType)],
      ['Commencement', t.startDate ? fmtDate(t.startDate) : null], ['End date', t.endDate ? fmtDate(t.endDate) : null],
      [t.payBasis === 'hourly' ? 'Rate' : 'Salary', t.payRate != null ? money(t.payRate) + (t.payBasis === 'hourly' ? ' per hour' : ' per annum') : null],
      ['Standard hours', t.hoursPerWeek != null ? t.hoursPerWeek + ' h/week' : null],
      ['Award / classification', t.awardClassification], ['Probation', t.probationMonths ? t.probationMonths + ' months' : null],
      ['Location', t.workLocation], ['Reports to', t.reportsTo],
    ].filter(function (x) { return x[1]; });
    return '<dl class="oj-terms">' + rows.map(function (x) { return '<dt>' + esc(x[0]) + '</dt><dd>' + esc(x[1]) + '</dd>'; }).join('') + '</dl>';
  }

  function offerPanel(d) {
    var o = d.offer; var st = d.journey.stages[0]; var c = d.can; var r = d.record;
    var editable = c.assign && r.status === 'created' && (!o || ['draft', 'approved', 'email_drafted', 'declined', 'withdrawn'].indexOf(o.status) !== -1);
    var body = '';

    if (S.editingTerms && editable) {
      body += '<form class="oj-form" onsubmit="return OnboardingJourney.saveTerms(event)">'
        + termsFields(S.options || {}, (o && o.terms) || r.terms || {}, 'oj-t-')
        + '<div id="oj-terms-error" class="ob-note is-danger" role="alert" hidden></div>'
        + '<div class="oj-actions"><button type="submit" class="oj-btn oj-btn-primary">Save — the letter regenerates from these details</button>'
        + '<button type="button" class="oj-btn" onclick="OnboardingJourney.cancelEdit()">Cancel</button></div></form>';
      return stagePanel(1, 'Letter of Offer', st, body);
    }

    if (!o) {
      if (editable) body += '<div class="oj-actions">' + btn('Enter the offer details', 'OnboardingJourney.editTerms()', 'oj-btn-primary') + '</div>';
      return stagePanel(1, 'Letter of Offer', st, body);
    }

    var before = ['draft', 'approved', 'email_drafted'].indexOf(o.status) !== -1;   // not yet sent
    var closed = ['declined', 'withdrawn', 'not_required'].indexOf(o.status) !== -1;
    var stepState = function (done, active) { return done ? 'is-done' : (active ? 'is-active' : 'is-todo'); };

    body += o.declineReason ? '<div class="oj-offer-status"><span class="oj-quiet">Reason given: ' + esc(o.declineReason) + '</span></div>' : '';

    if (closed) {
      if (editable) body += '<div class="oj-actions">' + btn(o.status === 'not_required' ? 'Edit the offer details' : 'Issue a revised offer', 'OnboardingJourney.editTerms()') + '</div>';
      return stagePanel(1, 'Letter of Offer', st, body);
    }

    // ── Step 1: details ──
    body += '<ol class="oj-steps">';
    body += '<li class="oj-step ' + stepState(true, false) + '"><div class="oj-step-head"><span class="oj-step-n">1</span><strong>Employee details</strong>'
      + (editable ? btn('Edit', 'OnboardingJourney.editTerms()', 'oj-btn-small') : '') + '</div>'
      + termsTable(o.terms || r.terms || {})
      + (before ? '<p class="oj-quiet">Change these and the letter regenerates. An Outlook draft made from the old letter is discarded.</p>' : '')
      + '</li>';

    // ── Step 2: the letter ──
    var L = d.letter || {};
    body += '<li class="oj-step ' + stepState(!before, before) + '"><div class="oj-step-head"><span class="oj-step-n">2</span><strong>Letter of Offer</strong>'
      + '<span class="oj-chip ' + (L.source === 'uploaded' ? 'is-you' : 'is-quiet') + '">' + (L.source === 'uploaded' ? 'Edited copy uploaded' : 'Generated from the template') + '</span></div>'
      + '<p class="oj-quiet">' + esc(L.fileName || '') + (L.uploaded ? ' · uploaded ' + esc(fmtDateTime(L.uploaded.uploadedAt)) + (L.uploaded.uploadedByName ? ' by ' + esc(L.uploaded.uploadedByName) : '') : '') + '</p>'
      + '<div class="oj-actions">'
      + btn('Preview the letter', 'OnboardingJourney.previewLetter()', before ? 'oj-btn-primary' : '')
      + '<a class="oj-btn" href="' + esc(L.downloadUrl || '#') + '">Download (.docx)</a>'
      + (L.pdfUrl ? '<a class="oj-btn" href="' + esc(L.pdfUrl) + '">Download (PDF)</a>' : '')
      + (before && c.assign ? '<label class="oj-btn oj-file">Upload an edited letter<input type="file" accept=".docx" hidden onchange="OnboardingJourney.uploadLetter(this)"></label>' : '')
      + (before && c.assign && L.source === 'uploaded' ? btn('Discard the edit — use the generated letter', 'OnboardingJourney.discardLetter()', 'oj-btn-quiet') : '')
      + '</div>'
      + '<div id="oj-letter-preview" class="oj-docx-host" hidden></div>'
      + '</li>';

    // ── Step 3: Email 1 ──
    var E = d.email || {};
    var drafted = o.status === 'email_drafted';
    body += '<li class="oj-step ' + stepState(!before, before) + '" id="oj-email"><div class="oj-step-head"><span class="oj-step-n">3</span><strong>Email 1 — to ' + esc(r.applicantEmail || '') + '</strong>'
      + (drafted ? '<span class="oj-chip is-you">Draft in Outlook</span>' : '') + '</div>';
    if (before && c.assign) {
      body += '<div class="oj-field"><label for="oj-e-subject">Subject</label><input id="oj-e-subject" type="text" maxlength="250" value="' + esc(E.subject || '') + '"></div>'
        + '<div class="oj-field"><label for="oj-e-body">Message</label><textarea id="oj-e-body" rows="14">' + esc(E.body || '') + '</textarea>'
        + '<small>The letter is attached automatically. Edit freely — what you send is what is kept on the record.</small></div>'
        + '<div class="oj-actions">'
        + btn(drafted ? 'Create a fresh Outlook draft' : 'Create the Outlook draft with the letter attached', 'OnboardingJourney.createDraft()', 'oj-btn-primary')
        + btn('Save the wording', 'OnboardingJourney.saveEmail()')
        + btn('Reset to the template', 'OnboardingJourney.resetEmail()', 'oj-btn-quiet')
        + '</div>';
      if (drafted) {
        body += '<div class="ob-note is-info"><strong>Your draft is in Outlook</strong>' + (E.draftedAt ? ' (created ' + esc(fmtDateTime(E.draftedAt)) + ')' : '') + '. Read it over and press Send there, then come back and mark it as sent.'
          + '<div class="oj-actions">'
          + (E.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(E.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '')
          + btn('I have sent it — mark as sent', 'OnboardingJourney.markSent()', 'oj-btn-primary')
          + '</div></div>';
      } else {
        body += '<p class="oj-quiet">Sent it another way? ' + '<button type="button" class="oj-link" onclick="OnboardingJourney.markSent()">Mark as sent</button></p>';
      }
    } else {
      body += '<p class="oj-quiet">' + (E.sentAt ? 'Sent ' + esc(fmtDateTime(E.sentAt)) : 'Not yet sent') + (E.subject ? ' · “' + esc(E.subject) + '”' : '') + '</p>'
        + '<details class="oj-history"><summary>Show the message</summary><pre class="oj-pre">' + esc(E.body || '') + '</pre></details>';
    }
    body += '</li>';

    // ── The signed letter: one upload, and Phase 1 is done ──
    var Sg = d.signed; var done = o.status === 'accepted';
    body += '<li class="oj-step ' + stepState(done, !done) + '"><div class="oj-step-head"><span class="oj-step-n">4</span><strong>Signed letter</strong></div>';
    if (Sg) {
      body += '<p class="oj-quiet">' + esc(Sg.fileName) + ' · received ' + esc(fmtDateTime(Sg.uploadedAt)) + '</p>'
        + '<div class="oj-actions">' + btn('View', 'OnboardingJourney.previewSigned()') + '<a class="oj-btn" href="' + esc(Sg.downloadUrl) + '">Download</a>'
        + (c.assign && !done ? '<label class="oj-btn oj-file">Replace<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.uploadSigned(this)"></label>' : '') + '</div>';
    } else if (c.assign) {
      body += '<div class="oj-actions"><label class="oj-btn oj-btn-primary oj-file">Upload the signed letter<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.uploadSigned(this)"></label></div>';
    }
    body += '</li></ol>';


    if (d.offerHistory && d.offerHistory.length > 1) {
      body += '<details class="oj-history"><summary>Previous versions (' + (d.offerHistory.length - 1) + ')</summary><ul>'
        + d.offerHistory.filter(function (h) { return h.id !== o.id; }).map(function (h) {
          return '<li>v' + h.version + ' — ' + esc(offerLabel(h)) + (h.respondedAt ? ' ' + esc(fmtDate(h.respondedAt)) : h.withdrawnAt ? ' ' + esc(fmtDate(h.withdrawnAt)) : '') + '</li>';
        }).join('') + '</ul></details>';
    }
    return stagePanel(1, 'Letter of Offer', st, body);
  }

  function offerLabel(o) {
    return { draft: 'Letter ready — Email 1 not yet drafted', approved: 'Letter ready — Email 1 not yet drafted',
      email_drafted: 'Email 1 drafted in Outlook', sent: 'Sent — awaiting the signed letter', signed_received: 'Signed letter received — verify it',
      accepted: 'Signed and verified', declined: 'Declined', withdrawn: 'Withdrawn', not_required: 'Not required' }[o.status] || titleCase(o.status);
  }
  function offerChipClass(s) {
    return s === 'accepted' || s === 'not_required' ? 'is-done' : s === 'declined' || s === 'withdrawn' ? 'is-danger' : s === 'sent' ? 'is-employee' : 'is-you';
  }

  function stagePanel(n, title, st, body) {
    return '<section class="oj-panel oj-stage is-' + esc(st.state) + '" id="oj-stage-' + n + '">'
      + '<header><h2><span class="oj-stage-n">' + n + '</span>' + esc(title) + '</h2></header>'
      + body + '</section>';
  }

  // ── Stage 2 panel ─────────────────────────────────────────────────────────

  var SECTION_LABELS = {
    welcome_employment: 'Employment', personal_details: 'Personal details', payroll_tax_super: 'Payroll, tax and super',
    identity: 'Identity and right to work', professional: 'Professional registration', screening: 'Screening and checks',
    ndis: 'NDIS', policies: 'Policies', training: 'Training',
    systems: 'Account setup instructions', agreements: 'Agreements and acknowledgements', accounts: 'Accounts activated',
  };

  function documentationPanel(d) {
    var st = d.journey.stages[1];
    if (st.state === 'pending') return '';
    var r = d.record; var P = d.pack;
    var body = '';

    // The document pack (Phase 2) — while the record is on the paper round-trip.
    var packStatuses = ['created', 'starter_pack_ready', 'starter_pack_sent', 'documents_received'];
    if (P && packStatuses.indexOf(r.status) !== -1) {
      body += packPanel(d);
      return stagePanel(2, 'Onboarding Documentation', st, body);
    }

    if (r.status === 'created') {
      body += '<p>Releasing creates their portal account, emails the invitation and issues the documentation list from the <strong>' + esc(r.packageTitle || 'onboarding') + '</strong> package.</p>';
      if (d.can.assign) body += '<div class="oj-actions">' + btn('Release the documentation', 'OnboardingJourney.release()', 'oj-btn-primary') + '</div>';
      return stagePanel(2, 'Onboarding Documentation', st, body);
    }
    var p = r.progress || {};
    body += '<div class="oj-meters">'
      + meter('Employee', p.employeeDone, p.employeeTotal)
      + meter('Practice verification', p.employerDone, p.employerTotal)
      + '</div>';
    if (d.sections && d.sections.length) {
      body += '<ul class="oj-sections">' + d.sections.map(function (s) {
        var open = s.requirements.filter(function (q) { return ['submitted', 'awaiting_verification'].indexOf(q.status) !== -1; }).length;
        return '<li' + (s.complete ? ' class="is-done"' : '') + '><span>' + esc(s.label) + '</span><span class="oj-quiet">' + s.employeeDone + ' of ' + s.employeeTotal
          + (open ? ' · <strong>' + open + ' to review</strong>' : '') + '</span></li>';
      }).join('') + '</ul>';
    }
    body += '<div class="oj-actions">' + btn('Open the full review', 'OnboardingJourney.openReview()') + '</div>';
    return stagePanel(2, 'Onboarding Documentation', st, body);
  }

  function yesNo(v) { return v ? '<span class="oj-yes">Yes</span>' : '<span class="oj-no">No</span>'; }

  function packPanel(d) {
    var P = d.pack; var r = d.record; var c = P.can || d.can; var E = P.email || {};
    var editable = P.editable && c.assign;
    var sent = r.status === 'starter_pack_sent' || r.status === 'documents_received';
    var drafted = !!E.draftId;
    var out = '';

    if (!P.prepared) {
      out += '<p class="oj-quiet">The document pack is being prepared from the role and employment type.</p>';
      if (c.assign) out += '<div class="oj-actions">' + btn('Prepare the pack now', 'OnboardingJourney.packPrepare()', 'oj-btn-primary') + '</div>';
      return out;
    }

    // ── Sent banner ──
    if (sent) {
      out += '<div class="oj-sent-banner"><strong>Onboarding Documents Sent</strong>'
        + '<span>Due: ' + esc(fmtDate(E.dueAt)) + '</span>'
        + '<span class="oj-quiet">sent ' + esc(fmtDateTime(E.sentAt)) + ' to ' + esc(E.sentTo || r.applicantEmail || '') + (P.zip ? ' · ' + P.zip.documentCount + ' document(s)' : '') + '</span>'
        + '</div>';
      if (r.status === 'starter_pack_sent') {
        out += '<p class="oj-quiet">Waiting for the completed documentation to come back. ' + P.counts.returns + ' item(s) are expected to be returned.</p>';
        if (c.assign) out += '<div class="oj-actions">' + btn('Not sent after all', 'OnboardingJourney.packUnmarkSent()', 'oj-btn-quiet') + (P.zip ? '<a class="oj-btn" href="' + esc(P.zip.downloadUrl) + '">Download the ZIP that went out</a>' : '') + '</div>';
      }
    }

    out += packTable(d, P, 'documentation');
    if (sent) return out;
    out += packEmailEditor(d, P, 'documentation');
    return out;
  }

  /**
   * Returned documents, for either phase: one drop zone for files, a folder or
   * a ZIP; what came back and what it was matched to; what is still to come.
   */
  function returnsBlock(d, P, phase, sent) {
    var active = (d.returnedDocuments || []).filter(function (x) { return x.status === 'active'; });
    var expected = P.items.filter(function (i) { return i.status === 'included' && i.itemKind === 'document' && i.employeeReturns; });
    var pending = expected.filter(function (i) { return i.progress === 'awaiting_return'; });
    var unrecognised = active.filter(function (x) { return x.matchStatus === 'unrecognised'; });
    var out = '<div class="oj-returns" id="oj-returns-' + esc(phase) + '"><strong>Returned documents</strong> <span class="oj-quiet">— upload what comes back, one file or many, a whole folder, or a ZIP. The portal reads each one, works out which document it is, ticks it off and fills the employee profile. Anything it cannot recognise is listed under Requires Your Attention for you to name.</span>'
      + (!sent ? '<p class="oj-quiet">The pack has not been marked as sent yet. You can still upload anything the employee has already returned.</p>' : '')
      + '<div class="oj-actions">'
      + '<label class="oj-btn oj-btn-primary oj-file">Upload returned documents<input type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.txt,.zip" hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
      + '<label class="oj-btn oj-file">Upload a folder<input type="file" multiple webkitdirectory directory hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
      + (active.length ? btn('Re-read everything', 'OnboardingJourney.processReturns()', 'oj-btn-quiet') : '') + '</div>';
    if (active.length) {
      out += '<ul class="oj-returns-list">' + active.map(function (x) {
        var item = P.items.filter(function (i) { return i.id === x.packItemId; })[0];
        return '<li><span>' + esc(x.title || x.fileName) + '</span> <span class="oj-quiet">' + (item ? '→ ' + esc(item.title) : x.matchStatus === 'unrecognised' ? '<span class="oj-warn">not recognised — name it under Requires Your Attention</span>' : 'reading…') + (x.signatureStatus === 'missing' ? ' · <span class="oj-warn">no signature</span>' : '') + '</span> '
          + (x.previewKind ? btn('View', 'OnboardingJourney.previewReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small') : '<a class="oj-btn oj-btn-small" href="' + esc(x.downloadUrl) + '">Download</a>') + '</li>';
      }).join('') + '</ul>';
    }
    if (expected.length) {
      out += '<p class="oj-returns-pending">' + (pending.length
        ? '<strong>Still to come back (' + pending.length + ' of ' + expected.length + '):</strong> ' + esc(pending.map(function (i) { return i.title; }).join(' · '))
        : '<strong>Everything expected has come back.</strong>' + (unrecognised.length ? ' ' + unrecognised.length + ' file(s) still need naming.' : '')) + '</p>';
    }
    return out + '</div>';
  }

  /** The pack table for either phase. */
  function packTable(d, P, phase) {
    var r = d.record; var c = P.can || d.can; var out = '';
    var editable = P.editable && c.assign;
    var sent = !!P.sent;
    var included = P.items.filter(function (i) { return i.status === 'included'; });
    var removed = P.items.filter(function (i) { return i.status !== 'included'; });
    var groups = {};
    included.forEach(function (i) { var k = i.section || 'other'; (groups[k] = groups[k] || []).push(i); });
    var order = Object.keys(SECTION_LABELS).concat(['other']).filter(function (k) { return groups[k]; });

    out += '<div class="oj-pack-head"><div><strong>' + included.length + ' items in the ' + (phase === 'induction' ? 'induction' : 'documentation') + ' pack</strong> · '
      + '<span class="oj-quiet">' + P.counts.sending + ' sent as files, ' + P.counts.returns + ' to come back' + (P.tracking ? ', ' + P.tracking.done + ' of ' + P.tracking.total + ' tracked items complete' : '') + '</span>'
      + (P.counts.missingFiles ? '<br><span class="oj-warn">' + P.counts.missingFiles + ' document(s) marked as sent have no file behind them yet — upload a file, or remove them before preparing the email.</span>' : '') + '</div>'
      + (editable ? '<div class="oj-actions">' + btn('+ Add document', 'OnboardingJourney.packAddOpen(\'' + phase + '\')') + btn('Restore defaults', 'OnboardingJourney.packRestoreDefaults(\'' + phase + '\')', 'oj-btn-quiet') + '</div>' : '') + '</div>';

    if (c.review) out += returnsBlock(d, P, phase, sent);
    out += '<div class="oj-table-wrap"><table class="oj-pack"><thead><tr><th>Document</th>' + (sent ? '<th>Status</th>' : '') + '<th>File</th><th></th></tr></thead><tbody>';
    order.forEach(function (k) {
      out += '<tr class="oj-pack-section"><td colspan="7">' + esc(SECTION_LABELS[k] || titleCase(k)) + '</td></tr>';
      groups[k].forEach(function (i) { out += packRow(i, editable, sent); });
    });
    out += '</tbody></table></div>';
    if (removed.length) {
      out += '<details class="oj-history"><summary>Removed from this pack (' + removed.length + ')</summary><ul>' + removed.map(function (i) {
        return '<li>' + esc(i.title) + (i.removedReason ? ' <span class="oj-quiet">— ' + esc(i.removedReason) + '</span>' : '')
          + (editable ? ' ' + btn('Restore', 'OnboardingJourney.packItem(\'' + jsq(i.id) + '\',\'restore\')', 'oj-btn-small oj-btn-quiet') : '') + '</li>';
      }).join('') + '</ul></details>';
    }
    out += '<div id="oj-pack-add-' + phase + '" hidden></div>';
    return out;
  }

  /** Email 2 editor (Phase 2). */
  function packEmailEditor(d, P, phase) {
    var r = d.record; var c = P.can || d.can; var out = '';
    var E = P.email || {}; var drafted = !!E.draftId;
    out += '<div class="oj-step is-active" id="oj-pack-email"><div class="oj-step-head"><span class="oj-step-n">✉</span><strong>Onboarding email — to ' + esc(r.applicantEmail || '') + '</strong>'
      + (drafted ? '<span class="oj-chip is-you">Draft in Outlook</span>' : '') + '</div>';
    if (c.assign) {
      out += '<div class="oj-field"><label for="oj-pe-subject">Subject</label><input id="oj-pe-subject" type="text" maxlength="250" value="' + esc(E.subject || '') + '"></div>'
        + '<div class="oj-field"><label for="oj-pe-body">Message</label><textarea id="oj-pe-body" rows="16">' + esc(E.body || '') + '</textarea>'
        + '<small>The ZIP is built from the pack above and attached automatically. The due date is set to seven days from the day the draft is created.</small></div>'
        + (E.outlook && !E.outlook.available ? '<div class="ob-note is-warn">' + esc(E.outlook.reason || 'Outlook is not connected.') + ' You can still download the ZIP, send it yourself, then mark it as sent.</div>' : '')
        + '<div class="oj-actions">'
        + btn(drafted ? 'Prepare a fresh Outlook draft' : 'Prepare Onboarding Email — create the Outlook draft with the ZIP attached', 'OnboardingJourney.packCreateDraft()', 'oj-btn-primary')
        + btn('Save the wording', 'OnboardingJourney.packSaveEmail()')
        + btn('Reset to the template', 'OnboardingJourney.packResetEmail()', 'oj-btn-quiet')
        + '<a class="oj-btn" href="/api/onboarding/journey/records/' + esc(r.id) + '/pack/zip">Download the ZIP</a>'
        + '</div>';
      if (drafted) {
        out += '<div class="ob-note is-info"><strong>Your draft is in Outlook</strong>' + (E.draftedAt ? ' (created ' + esc(fmtDateTime(E.draftedAt)) + ')' : '') + ' with '
          + (P.zip ? P.zip.documentCount + ' document(s) attached' : 'the pack attached') + '. Due date in the email: ' + esc(fmtDate(E.dueAt)) + '. Read it over and press Send there, then mark it as sent.'
          + (P.zip && P.zip.omissions && P.zip.omissions.length ? '<br><span class="oj-warn">Left out (no file): ' + esc(P.zip.omissions.map(function (o) { return o.title; }).join(', ')) + '</span>' : '')
          + '<div class="oj-actions">'
          + (E.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(E.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '')
          + btn('I have sent it — mark as sent', 'OnboardingJourney.packMarkSent()', 'oj-btn-primary')
          + '</div></div>';
      } else {
        out += '<p class="oj-quiet">Sent it another way? <button type="button" class="oj-link" onclick="OnboardingJourney.packMarkSent()">Mark as sent</button></p>';
      }
    }
    out += '</div>';
    return out;
  }

  var PROGRESS_LABELS = { awaiting_return: 'Awaiting return', received: 'Received', verified: 'Complete', attention: 'Needs attention', sent: 'Sent', awaiting: 'Pending', 'n/a': '—', removed: 'Removed' };
  function progressChip(i) {
    var cls = i.progress === 'verified' ? 'is-done' : i.progress === 'received' ? 'is-employee' : i.progress === 'attention' ? 'is-danger' : i.progress === 'awaiting_return' ? 'is-you' : 'is-quiet';
    return '<span class="oj-chip ' + cls + '">' + esc(PROGRESS_LABELS[i.progress] || titleCase(i.progress)) + '</span>' + (i.verificationMode === 'auto' && i.progress === 'verified' ? '<br><span class="oj-quiet">by the portal</span>' : '');
  }

  function packRow(i, editable, sent) {
    var f = i.file || {};
    var fileCell;
    if (i.itemKind && i.itemKind !== 'document') {
      fileCell = '<span class="oj-quiet">' + (i.itemKind === 'account' ? 'Follows the internal set-up task' : i.itemKind === 'training' ? 'Follows the induction walkthrough task' : 'Tracked') + '</span>';
    } else if (f.previewUrl) {
      fileCell = '<span class="oj-chip ' + (f.source === 'own' ? 'is-you' : 'is-quiet') + '">' + (f.source === 'own' ? 'Your copy' : f.source === 'body' ? 'Text' : 'Library') + '</span> <span class="oj-quiet">' + esc(f.fileName || '') + '</span>';
    } else if (!i.sendsDocument) {
      fileCell = '<span class="oj-quiet">Employee supplies their own</span>';
    } else if (f.source === 'link' && i.officialSourceUrl) {
      fileCell = '<span class="oj-warn">No file</span> <a href="' + esc(i.officialSourceUrl) + '" target="_blank" rel="noopener" class="oj-quiet">official source ↗</a>';
    } else {
      fileCell = '<span class="oj-warn">No file yet</span>';
    }
    var acts = [];
    if (f.previewUrl) acts.push(btn('Preview', 'OnboardingJourney.packPreview(\'' + jsq(i.id) + '\')', 'oj-btn-small'));
    if (f.downloadUrl) acts.push('<a class="oj-btn oj-btn-small" href="' + esc(f.downloadUrl) + '">Download</a>');
    if (editable) {
      acts.push('<label class="oj-btn oj-btn-small oj-file">' + (f.source === 'own' ? 'Replace again' : i.sendsDocument ? 'Replace' : 'Attach a file') + '<input type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.packUploadFile(\'' + jsq(i.id) + '\', this)"></label>');
      if (f.source === 'own' && i.library) acts.push(btn('Use library copy', 'OnboardingJourney.packRevertFile(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
      acts.push(btn('Rename', 'OnboardingJourney.packRename(\'' + jsq(i.id) + '\',\'' + jsq(i.title) + '\')', 'oj-btn-small oj-btn-quiet'));
      acts.push(btn('Remove', 'OnboardingJourney.packItem(\'' + jsq(i.id) + '\',\'remove\')', 'oj-btn-small oj-btn-quiet'));
    }
    // What the portal expects of this item, in words — the flags themselves
    // are the package's defaults and are not toggled per record.
    var expects = [];
    if (i.itemKind === 'document') {
      if (i.employeeReturns) expects.push(i.required ? 'comes back, required' : 'comes back if provided');
      else if (i.sendsDocument) expects.push('for reading only');
      if (i.employeeReturns && i.requiresVerification) expects.push('checked by us');
    }
    return '<tr class="oj-pack-row' + (i.origin === 'added' ? ' is-added' : '') + '">'
      + '<td><strong>' + esc(i.title) + '</strong>' + (i.origin === 'added' ? ' <span class="oj-chip is-you">Added</span>' : '') + (i.description ? '<br><span class="oj-quiet">' + esc(i.description) + '</span>' : '') + (expects.length ? '<br><span class="oj-quiet">' + esc(expects.join(' · ')) + '</span>' : '') + '</td>'
      + (sent ? '<td>' + progressChip(i) + (i.progress === 'received' && i.requiresVerification && S.record && S.record.can && S.record.can.verify ? '<div class="oj-actions oj-actions-tight">' + btn('Verify', 'OnboardingJourney.verifyItem(\'' + jsq(i.id) + '\')', 'oj-btn-small') + '</div>' : '') + '</td>' : '')
      + '<td>' + fileCell + '</td>'
      + '<td><div class="oj-actions oj-actions-tight">' + acts.join('') + '</div></td>'
      + '</tr>';
  }

  function meter(label, done, total) {
    done = done || 0; total = total || 0;
    var pct = total === 0 ? 100 : Math.round((done / total) * 100);
    return '<div class="oj-meter"><div class="oj-meter-l"><strong>' + esc(label) + '</strong><span>' + done + ' of ' + total + '</span></div>'
      + '<div class="oj-meter-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></div></div>';
  }

  // ── Stage 3 panel ─────────────────────────────────────────────────────────

  var TASK_STATE = { pending: 'Preparing', in_progress: 'In progress', done: 'Ready', skipped: 'Skipped', failed: 'Failed' };

  function inductionPanel(d) {
    var st = d.journey.stages[2];
    if (st.state === 'pending') return '';
    var c = d.can;
    var staff = [['', 'Unassigned']].concat(((S.options && S.options.staff) || []).map(function (u) { return [u.id, u.name]; }));
    var body = d.tasks.length ? '<ul class="oj-tasks">' + d.tasks.map(function (t) {
      var acts = [];
      if (t.automation === 'activate_portal_access') {
        if (t.status !== 'done' && c.activate) acts.push(btn(t.status === 'failed' ? 'Try again' : 'Run — activate portal access', 'OnboardingJourney.runTask(\'' + jsq(t.code) + '\')', 'oj-btn-primary oj-btn-small'));
      } else if (c.review) {
        if (t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed') {
          acts.push(btn('Done', 'OnboardingJourney.task(\'' + jsq(t.code) + '\',\'complete\')', 'oj-btn-primary oj-btn-small'));
          acts.push(btn('Skip', 'OnboardingJourney.task(\'' + jsq(t.code) + '\',\'skip\')', 'oj-btn-small oj-btn-quiet'));
        } else {
          acts.push(btn('Reopen', 'OnboardingJourney.task(\'' + jsq(t.code) + '\',\'reopen\')', 'oj-btn-small oj-btn-quiet'));
        }
      }
      var assign = c.review && !t.automation
        ? '<label class="oj-inline">Assign <select onchange="OnboardingJourney.assignTask(\'' + jsq(t.code) + '\', this.value)">' + staff.map(function (s) {
          return '<option value="' + esc(s[0]) + '"' + (String(s[0]) === String(t.assigneeUserId || '') ? ' selected' : '') + '>' + esc(s[1]) + '</option>';
        }).join('') + '</select></label>'
        + '<label class="oj-inline">Due <input type="date" value="' + esc(isoDate(t.dueAt)) + '" onchange="OnboardingJourney.assignTask(\'' + jsq(t.code) + '\', null, this.value)"></label>'
        : (t.assigneeName ? '<span class="oj-quiet">' + esc(t.assigneeName) + '</span>' : '');
      return '<li class="oj-task is-' + esc(t.status) + (t.overdue ? ' is-overdue' : '') + '" id="oj-task-' + esc(t.code) + '">'
        + '<div class="oj-task-main"><strong>' + esc(t.title) + '</strong>'
        + '<span class="oj-chip is-' + esc(t.status) + '">' + esc(TASK_STATE[t.status] || titleCase(t.status)) + (t.automation ? ' · portal' : '') + '</span>'
        + '<p class="oj-quiet">' + esc(t.description || '') + '</p>'
        + (t.note ? '<p class="oj-quiet">Note: ' + esc(t.note) + '</p>' : '')
        + (t.dueAt ? '<span class="oj-due' + (t.overdue ? ' is-overdue' : '') + '">' + (t.overdue ? 'overdue · ' : 'due ') + esc(fmtDate(t.dueAt)) + '</span>' : '')
        + (t.completedAt ? '<span class="oj-quiet"> · done ' + esc(fmtDate(t.completedAt)) + (t.completedByName ? ' by ' + esc(t.completedByName) : '') + '</span>' : '')
        + '</div>'
        + '<div class="oj-task-side">' + assign + '<div class="oj-actions">' + acts.join('') + '</div></div>'
        + '</li>';
    }).join('') + '</ul>' : '<p class="oj-quiet">The checklist is being generated.</p>';
    return stagePanel('⚙', 'Internal Setup', st, body);
  }

  /** Payroll Setup — confirm, do not retype. */
  function payrollPanel(d) {
    // Coming soon: the payroll set is gathered underneath, but the review and
    // approval are switched off until the payroll integration is connected.
    return '<section class="oj-panel oj-stage oj-coming-soon" id="oj-payroll" aria-disabled="true"><header><h2><span class="oj-stage-n">$</span>Payroll Setup</h2><span class="oj-chip is-quiet">Coming soon</span></header>'
      + '<p class="oj-quiet">Payroll set-up will be prepared here from the onboarding information once the payroll integration is connected.</p></section>';
  }

  function payrollPanelFull(d) {
    var P = d.payroll;
    if (!P) return '';
    var state = P.approved ? 'complete' : P.ready ? 'active' : 'parallel';
    var cls = function (x) { return x === 'ready' ? 'is-done' : x === 'conflict' ? 'is-danger' : x === 'review' ? 'is-you' : 'is-quiet'; };
    var lbl = { ready: 'Ready', missing: 'Missing', conflict: 'Conflict', review: 'Needs confirmation' };
    var body = '<div class="oj-table-wrap"><table class="oj-pack oj-payroll"><tbody>' + P.rows.map(function (r) {
      return '<tr><th scope="row">' + esc(r.label) + '</th><td>' + (r.value ? esc(r.value) : '<span class="oj-quiet">—</span>') + '</td><td><span class="oj-chip ' + cls(r.status) + '">' + esc(lbl[r.status] || r.status) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
    if (P.approved) body += '<p class="oj-quiet">Approved ' + esc(fmtDateTime(P.approvedAt)) + (P.approvedByName ? ' by ' + esc(P.approvedByName) : '') + '. ' + esc(P.integration.note) + '</p>';
    else if (P.ready) body += '<div class="oj-actions">' + btn('Approve Payroll Setup', 'OnboardingJourney.approvePayrollSetup()', 'oj-btn-primary') + '</div><p class="oj-quiet">' + esc(P.integration.note) + '</p>';
    else body += '<div class="ob-note is-warn"><strong>Payroll cannot proceed yet.</strong> ' + esc(P.blockers.join(' · ')) + '. Resolve these in Requires Your Attention or wait for the documents.</div>';
    return '<section class="oj-panel oj-stage is-' + esc(state) + '" id="oj-payroll"><header><h2><span class="oj-stage-n">$</span>Payroll Setup</h2><span class="oj-chip ' + (P.approved ? 'is-done' : P.ready ? 'is-you' : 'is-quiet') + '">' + esc(P.label) + '</span></header>'
      + '<p class="oj-stage-summary">' + P.readyCount + ' of ' + P.total + ' lines ready. Everything here was gathered during onboarding; confirm it rather than typing it again.</p>' + body + '</section>';
  }

  /** Phase 3 — readiness, the induction pack, Email 3, tracking. */
  function phase3Panel(d) {
    var I = d.induction;
    if (!I) return '';
    var R = I.readiness || { ready: false, checks: [], blockers: [] };
    var c = I.can || d.can; var E = I.email || {}; var sent = I.sent;
    var state = I.tracking && I.tracking.total && I.tracking.done === I.tracking.total && sent ? 'complete' : sent ? 'active' : R.ready ? 'active' : 'parallel';
    var body = '';
    body += '<div class="oj-ready"><h3>' + (R.ready ? 'Ready to send' : 'Phase 3 is not ready because:') + '</h3>'
      + (R.ready ? '' : '<ul class="oj-blockers">' + R.blockers.map(function (b) { return '<li>' + esc(b) + '</li>'; }).join('') + '</ul>')
      + '<ul class="oj-checks">' + R.checks.map(function (k) { return '<li><span>' + esc(k.label) + '</span><span class="oj-chip ' + (k.state === 'ready' ? 'is-done' : k.state === 'in_progress' ? 'is-employee' : 'is-quiet') + '">' + esc(k.detail) + '</span></li>'; }).join('') + '</ul></div>';
    if (sent) {
      body += '<div class="oj-sent-banner"><strong>Internal Induction Sent</strong><span>Due: ' + esc(fmtDate(E.dueAt)) + '</span><span class="oj-quiet">sent ' + esc(fmtDateTime(E.sentAt)) + (I.tracking ? ' · ' + I.tracking.done + ' of ' + I.tracking.total + ' induction items complete' : '') + '</span></div>';
    }
    body += packTable(d, I, 'induction');
    if (!sent && c.assign) {
      body += '<div class="oj-step is-active" id="oj-induction-email"><div class="oj-step-head"><span class="oj-step-n">✉</span><strong>Phase 3 email — to ' + esc(d.record.applicantEmail || '') + '</strong>' + (E.draftId ? '<span class="oj-chip is-you">Draft in Outlook</span>' : '') + '</div>'
        + '<div class="oj-field"><label for="oj-ie-subject">Subject</label><input id="oj-ie-subject" type="text" maxlength="250" value="' + esc(E.subject || '') + '"></div>'
        + '<div class="oj-field"><label for="oj-ie-body">Message</label><textarea id="oj-ie-body" rows="14">' + esc(E.body || '') + '</textarea><small>The induction ZIP is built from the pack above and attached. The due date is seven days from the day the draft is created.</small></div>'
        + (E.outlook && !E.outlook.available ? '<div class="ob-note is-warn">' + esc(E.outlook.reason || 'Outlook is not connected.') + '</div>' : '')
        + '<div class="oj-actions">' + btn(E.draftId ? 'Prepare a fresh Outlook draft' : 'Prepare Phase 3 Email — create the Outlook draft with the pack attached', 'OnboardingJourney.packCreateDraft(\'induction\')', R.ready ? 'oj-btn-primary' : '') + btn('Save the wording', 'OnboardingJourney.packSaveEmail(\'induction\')') + btn('Reset to the template', 'OnboardingJourney.packResetEmail(\'induction\')', 'oj-btn-quiet') + '<a class="oj-btn" href="/api/onboarding/journey/records/' + esc(d.record.id) + '/induction/zip">Download the ZIP</a></div>'
        + (E.draftId ? '<div class="ob-note is-info"><strong>Your draft is in Outlook.</strong> Read it over and press Send there, then mark it as sent.<div class="oj-actions">' + (E.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(E.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '') + btn('I have sent it — mark as sent', 'OnboardingJourney.packMarkSent(\'induction\')', 'oj-btn-primary') + '</div></div>'
          : '<p class="oj-quiet">Sent it another way? <button type="button" class="oj-link" onclick="OnboardingJourney.packMarkSent(\'induction\')">Mark as sent</button></p>')
        + '</div>';
    }
    return '<section class="oj-panel oj-stage is-' + esc(state) + '" id="oj-phase3"><header><h2><span class="oj-stage-n">3</span>Phase 3 — Internal Induction Pack</h2><span class="oj-chip ' + (state === 'complete' ? 'is-done' : sent ? 'is-employee' : R.ready ? 'is-you' : 'is-quiet') + '">' + esc(state === 'complete' ? 'Complete' : sent ? 'Sent — tracking' : R.ready ? 'Ready to send' : 'Not ready') + '</span></header>' + body + '</section>';
  }

  /** The employee profile — the source of truth every register reads. */
  function profilePanel(d) {
    var p = d.profile;
    if (!p) return '';
    var row = function (k, v) { return v ? '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>' : ''; };
    var dl = function (rows) { return rows ? '<dl class="oj-terms">' + rows + '</dl>' : '<p class="oj-quiet">Nothing yet.</p>'; };
    var pe = p.personal || {}; var em = p.emergency; var e = p.employment || {}; var pay = p.payroll; var v = p.vehicle;
    var body = '<div class="oj-profile">'
      + '<div><h3>Personal details</h3>' + dl(row('Name', pe.name) + row('Preferred', pe.preferredName) + row('Date of birth', pe.dateOfBirth ? fmtDate(pe.dateOfBirth) : '') + row('Mobile', pe.mobile) + row('Email', pe.email) + row('Address', pe.address)) + '</div>'
      + '<div><h3>Emergency contact</h3>' + dl(em ? row('Name', em.name) + row('Relationship', em.relationship) + row('Phone', em.phone) + row('Email', em.email) : '') + '</div>'
      + '<div><h3>Employment</h3>' + dl(row('Position', e.position) + row('Type', e.employmentType ? titleCase(e.employmentType) : '') + row('Commences', e.startDate ? fmtDate(e.startDate) : '') + row('Ends', e.endDate ? fmtDate(e.endDate) : '') + row('Hours / week', e.hoursPerWeek != null ? String(e.hoursPerWeek) : '') + row(e.payBasis === 'hourly' ? 'Hourly rate' : 'Salary', e.payRate != null ? money(e.payRate) : '')) + '</div>'
      + '<div><h3>Payroll</h3>' + dl(pay ? row('Bank', pay.bsbMasked ? 'BSB ' + pay.bsbMasked + ' · acct ••••' + (pay.accountLast4 || '') : '') + row('Status', pay.bankStatus ? (pay.bankStatus === 'verified' ? 'Approved' : titleCase(pay.bankStatus)) : '') + row('Super fund', pay.superFund) : '') + '</div>'
      + '<div><h3>Identification &amp; credentials</h3>' + ((p.credentials || []).length || (p.identity || []).length ? '<ul class="oj-creds">'
        + (p.identity || []).map(function (i) { return '<li><span>' + esc(titleCase(i.evidenceType)) + (i.numberLast4 ? ' ••••' + esc(i.numberLast4) : '') + '</span><span class="oj-quiet">' + (i.expiryDate ? 'expires ' + esc(fmtDate(i.expiryDate)) : '') + (i.documentId ? ' · original attached' : '') + '</span></li>'; }).join('')
        + (p.credentials || []).map(function (c) { var exp = c.expiryDate ? new Date(c.expiryDate) < new Date() : false; return '<li><span>' + esc(c.name) + (c.number ? ' <span class="oj-quiet">' + esc(c.number) + '</span>' : '') + '</span><span class="' + (exp ? 'oj-warn' : 'oj-quiet') + '">' + (c.expiryDate ? (exp ? 'EXPIRED ' : 'expires ') + esc(fmtDate(c.expiryDate)) : 'no expiry') + ' · ' + esc(c.status === 'verified' ? 'verified' : 'pending verification') + (c.documentId ? ' · original attached' : '') + '</span></li>'; }).join('')
        + '</ul>' : '<p class="oj-quiet">Nothing yet.</p>') + '</div>'
      + '<div><h3>Vehicle</h3>' + dl(v ? row('Registration', v.registration) + row('Vehicle', [v.make, v.model].filter(Boolean).join(' ')) + row('Registration expiry', v.registrationExpiry ? fmtDate(v.registrationExpiry) : '') + row('Insurance expiry', v.insuranceExpiry ? fmtDate(v.insuranceExpiry) : '') : '') + '</div>'
      + '</div><p class="oj-quiet">Filled from verified onboarding documents. The Compliance Register, profile page and expiry reminders read these same records.</p>';
    return '<section class="oj-panel oj-stage is-parallel" id="oj-profile"><header><h2><span class="oj-stage-n">👤</span>Employee profile</h2><span class="oj-chip is-quiet">Source of truth</span></header>' + body + '</section>';
  }

  function emailsPanel(d) {
    if (!d.dispatches || !d.dispatches.length) return '';
    return '<details class="oj-history"><summary>Emails sent (' + d.dispatches.length + ')</summary><ul>'
      + d.dispatches.map(function (e) {
        return '<li>' + esc(fmtDateTime(e.sentAt)) + ' — ' + esc(titleCase(e.kind)) + ' to ' + esc(e.toEmail) + ' · ' + esc(titleCase(e.status)) + '</li>';
      }).join('') + '</ul></details>';
  }

  // ── Record actions ────────────────────────────────────────────────────────

  async function act(path, body, okMessage, method) {
    if (S.busy) return null;
    S.busy = true;
    var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + path, { method: method || 'POST', body: body || {} });
    S.busy = false;
    if (!res.ok && !res.record) { toast(res.error, true); return res; }
    if (res.record) S.record = res;
    else if (res.pack && S.record) S.record.pack = res.pack;
    if (okMessage) toast(typeof okMessage === 'function' ? okMessage(res) : okMessage, !res.ok);
    var pane = doc.getElementById('oj-view');
    if (pane && S.record) drawRecord(pane);
    return res;
  }

  function editTerms() { S.editingTerms = true; var pane = doc.getElementById('oj-view'); if (pane) drawRecord(pane); scrollTo('oj-stage-1'); }
  function cancelEdit() { S.editingTerms = false; var pane = doc.getElementById('oj-view'); if (pane) drawRecord(pane); }

  async function saveTerms(ev) {
    if (ev) ev.preventDefault();
    var terms = readTerms('oj-t-');
    var res = await act('/offer', { terms: terms }, null, 'PUT');
    if (res && !res.ok) {
      var el = doc.getElementById('oj-terms-error');
      if (el) { el.textContent = res.error; el.hidden = false; }
      return false;
    }
    S.editingTerms = false;
    toast('Terms saved. The letter is a draft again — approve it when you are happy.');
    var pane = doc.getElementById('oj-view'); if (pane) drawRecord(pane);
    return false;
  }

  /** Preview the letter as the employee will read it (docx-preview, in the modal). */
  function previewLetter() {
    var L = S.record && S.record.letter;
    if (!L) return;
    if (global.DocPreview && typeof global.DocPreview.open === 'function') {
      global.DocPreview.open({ kind: 'docx', url: L.previewUrl + '?rev=' + Date.now(), downloadUrl: L.downloadUrl, title: 'Letter of Offer — ' + (S.record.record.applicantName || ''), meta: L.source === 'uploaded' ? 'Your edited copy' : 'Generated from the template' });
    } else {
      global.open(L.downloadUrl, '_blank');
    }
  }
  function previewSigned() {
    var Sg = S.record && S.record.signed;
    if (!Sg) return;
    if (Sg.previewKind && global.DocPreview && typeof global.DocPreview.open === 'function') {
      global.DocPreview.open({ kind: Sg.previewKind, url: Sg.previewUrl + '?rev=' + Date.now(), downloadUrl: Sg.downloadUrl, title: 'Signed Letter of Offer', meta: Sg.fileName });
    } else {
      global.open(Sg.previewUrl, '_blank');
    }
  }

  function readFileAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(',')[1] || ''); };
      fr.onerror = function () { reject(new Error('read failed')); };
      fr.readAsDataURL(file);
    });
  }
  var MIMES = { docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

  async function uploadTo(input, path, kindLabel) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is larger than 10 MB.', true); input.value = ''; return; }
    var ext = String(file.name).split('.').pop().toLowerCase();
    var mime = MIMES[ext] || file.type;
    toast('Uploading ' + kindLabel + '…');
    var b64;
    try { b64 = await readFileAsBase64(file); } catch (_) { toast('The file could not be read.', true); return; }
    var res = await act(path, { fileName: file.name, fileMime: mime, fileData: b64 }, kindLabel + ' stored.');
    input.value = '';
    return res;
  }
  function uploadLetter(input) { return uploadTo(input, '/offer/letter', 'Edited letter'); }
  function uploadSigned(input) { return refreshRecordAfter(uploadTo(input, '/offer/signed', 'Signed letter')); }
  async function discardLetter() {
    if (!await portalConfirm('Discard the uploaded edit and go back to the generated letter?', { danger: true })) return;
    return act('/offer/letter', {}, 'Using the generated letter again.', 'DELETE');
  }

  function readEmail() {
    var sub = doc.getElementById('oj-e-subject'); var body = doc.getElementById('oj-e-body');
    return { subject: sub ? sub.value.trim() : undefined, body: body ? body.value : undefined };
  }
  function saveEmail() { return act('/offer/email', readEmail(), 'Email wording saved.', 'PUT'); }
  function resetEmail() { return act('/offer/email/reset', {}, 'Email reset to the template.'); }

  async function createDraft() {
    var e = readEmail();
    if (e.subject !== undefined && !e.subject) return toast('Give the email a subject.', true);
    if (e.body !== undefined && !e.body.trim()) return toast('The email needs a message.', true);
    var res = await act('/offer/email/draft', e, null);
    if (!res) return;
    if (res.delivery) {
      toast(res.delivery.message, false);
      if (res.delivery.webLink) global.open(res.delivery.webLink, '_blank', 'noopener');
    }
  }
  async function markSent() {
    if (!await portalConfirm('Mark the letter of offer as sent? The record moves to waiting for the signed copy.')) return;
    return act('/offer/mark-sent', {}, 'Marked as sent. Waiting for the signed letter.');
  }
  function unmarkSent() { return act('/offer/unmark-sent', {}, 'Back to not sent.'); }
  async function verifyOffer() {
    if (!await portalConfirm('Verify the signed letter of offer? Phase 1 completes and the onboarding documentation is released to the employee.')) return;
    return act('/offer/verify', {}, function (r) { return (r.release && r.release.message) || 'Verified.'; });
  }
  async function declineOffer() {
    var reason = await portalPrompt('Record that the candidate declined. Reason (optional):');
    if (reason === null) return;
    return act('/offer/decline', { reason: reason || undefined }, 'Recorded as declined.');
  }

  async function withdrawOffer() {
    var reason = await portalPrompt('Withdraw this letter of offer? You can add a reason for the record (optional).');
    if (reason === null) return;
    return act('/offer/withdraw', { reason: reason || undefined }, 'Offer withdrawn.');
  }

  async function skipOffer() {
    if (!await portalConfirm('Skip the letter of offer and release the onboarding documentation now?')) return;
    return act('/offer/skip', {}, function (r) { return r.release && r.release.message ? r.release.message : 'Letter marked as not required.'; });
  }

  function release() {
    return act('/release', {}, function (r) { return (r.release && r.release.message) || r.error || 'Released.'; });
  }

  async function runTask(code) {
    if (code === 'portal_access' && !await portalConfirm('Activate portal access for this person now? Their account becomes a staff account with the agreed role.')) return;
    return act('/tasks/' + encodeURIComponent(code) + '/run', {}, 'Portal access activated.');
  }
  async function task(code, verb) {
    var note;
    if (verb === 'skip') { note = await portalPrompt('Skip this task? Add a short reason for the record.'); if (note === null) return; }
    return act('/tasks/' + encodeURIComponent(code) + '/' + verb, { note: note || undefined }, verb === 'complete' ? 'Task done.' : null);
  }
  function assignTask(code, assigneeUserId, dueAt) {
    var body = {};
    if (assigneeUserId !== null && assigneeUserId !== undefined) body.assigneeUserId = assigneeUserId || null;
    if (dueAt) body.dueAt = dueAt;
    return act('/tasks/' + encodeURIComponent(code), body, null, 'PATCH');
  }

  // ── Phase 2: the document pack ──
  function packPath(rest, phase) { return (phase === 'induction' ? '/induction' : '/pack') + rest; }
  async function packAct(rest, body, okMessage, method, phase) {
    var res = await act(packPath(rest, phase), body, null, method);
    if (!res) return null;
    if (res.pack && S.record) {
      if (res.pack.phase === 'induction') S.record.induction = Object.assign({}, S.record.induction || {}, res.pack); else S.record.pack = res.pack;
      var pane = doc.getElementById('oj-view'); if (pane) drawRecord(pane);
    }
    if (okMessage && res.ok !== false) toast(typeof okMessage === 'function' ? okMessage(res) : okMessage);
    return res;
  }
  function phaseOfItem(id) {
    var ind = (S.record && S.record.induction && S.record.induction.items) || [];
    return ind.some(function (i) { return i.id === id; }) ? 'induction' : 'documentation';
  }
  async function packRestoreDefaults(phase) {
    if (!await portalConfirm('Restore the default ' + (phase === 'induction' ? 'induction' : 'documentation') + ' pack for this person? Removed defaults come back; added documents are removed.')) return;
    return refreshRecordAfter(packAct('/restore-defaults', {}, 'Defaults restored.', 'POST', phase));
  }
  async function approvePayrollSetup() {
    if (!await portalConfirm('Approve the payroll setup? Bank details are approved with it.')) return;
    return returnsAct('/payroll-setup/approve', {}, 'Payroll setup approved.');
  }
  function packPrepare() { return refreshRecordAfter(packAct('/prepare', {}, 'Pack prepared.')); }
  async function packItem(id, verb) {
    var reason;
    if (verb === 'remove') { reason = await portalPrompt('Remove this document from this person\'s pack? Reason (optional):'); if (reason === null) return; }
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/' + verb, { reason: reason || undefined }, verb === 'remove' ? 'Removed from this pack only.' : 'Restored.', 'POST', phaseOfItem(id)));
  }
  function packFlag(id, field, value) { var body = {}; body[field] = value; return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id), body, null, 'PATCH', phaseOfItem(id))); }
  async function packRename(id, current) {
    var title = await portalPrompt('Document name as it will appear in the pack:', current || '');
    if (title === null) return; if (!title.trim()) return toast('Give the document a name.', true);
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id), { title: title.trim() }, 'Renamed.', 'PATCH', phaseOfItem(id)));
  }
  async function packUploadFile(id, input) {
    var file = input && input.files && input.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is larger than 10 MB.', true); input.value = ''; return; }
    var ext = String(file.name).split('.').pop().toLowerCase();
    var mime = MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type);
    var b64; try { b64 = await readFileAsBase64(file); } catch (_) { toast('The file could not be read.', true); return; }
    input.value = '';
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', { fileName: file.name, fileMime: mime, fileData: b64 }, 'File replaced for this person only.', 'POST', phaseOfItem(id)));
  }
  function packRevertFile(id) { return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', {}, 'Back to the library copy.', 'DELETE', phaseOfItem(id))); }
  function packPreview(id) {
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    if (!i || !i.file || !i.file.previewUrl) return;
    var kind = i.file.previewKind;
    if ((kind === 'pdf' || kind === 'docx') && global.DocPreview && typeof global.DocPreview.open === 'function') {
      global.DocPreview.open({ kind: kind, url: i.file.previewUrl + '?rev=' + Date.now(), downloadUrl: i.file.downloadUrl, title: i.title, meta: (i.file.source === 'own' ? 'Your copy' : 'Library copy') + (i.file.fileName ? ' · ' + i.file.fileName : '') });
    } else {
      global.open(i.file.previewUrl, '_blank', 'noopener');
    }
  }
  async function packAddOpen(phase) {
    phase = phase || 'documentation';
    S.addPhase = phase;
    var host = doc.getElementById('oj-pack-add-' + phase);
    if (!host) return;
    host.hidden = false;
    host.innerHTML = spinner('Loading the library…');
    var lib = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + packPath('/library', phase));
    if (!lib.ok) { host.innerHTML = '<div class="ob-note is-danger">' + esc(lib.error) + '</div>'; return; }
    var opts = [['', '— Choose a library document —']].concat(lib.documents.filter(function (d) { return !d.alreadyInPack; }).map(function (d) {
      return [d.id, d.title + (d.hasFile ? '' : d.contentStatus === 'link_only' ? ' (official link — no file)' : ' (no file yet)')];
    }));
    host.innerHTML = '<div class="oj-panel oj-add">'
      + '<h3>Add a document to this pack</h3>'
      + '<div class="oj-grid2">'
      + field('oj-pa-doc', 'From the library', select('oj-pa-doc', opts, ''), 'Or leave blank and upload a file below.')
      + field('oj-pa-title', 'Name (optional when choosing from the library)', input('oj-pa-title', 'text', '', 'maxlength="250"'))
      + '</div>'
      + '<div class="oj-check-row">'
      + '<label class="oj-check"><input type="checkbox" id="oj-pa-sends" checked> A file is sent in the pack</label>'
      + '<label class="oj-check"><input type="checkbox" id="oj-pa-returns"> The employee returns it</label>'
      + '<label class="oj-check"><input type="checkbox" id="oj-pa-verifies"> We verify it</label>'
      + '<label class="oj-check"><input type="checkbox" id="oj-pa-required" checked> Required</label>'
      + '</div>'
      + '<div class="oj-field"><label for="oj-pa-file">Upload a file (PDF, Word, PNG or JPEG)</label><input id="oj-pa-file" type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"></div>'
      + '<div class="oj-actions">' + btn('Add to this pack', 'OnboardingJourney.packAddSubmit()', 'oj-btn-primary') + btn('Cancel', 'OnboardingJourney.packAddClose()') + '</div>'
      + '</div>';
    host.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function packAddClose() { var host = doc.getElementById('oj-pack-add-' + (S.addPhase || 'documentation')); if (host) { host.hidden = true; host.innerHTML = ''; } }
  async function packAddSubmit() {
    var v = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
    var ck = function (id) { var el = doc.getElementById(id); return !!(el && el.checked); };
    var body = { documentId: v('oj-pa-doc') || null, title: v('oj-pa-title') || null, sendsDocument: ck('oj-pa-sends'), employeeReturns: ck('oj-pa-returns'), requiresVerification: ck('oj-pa-verifies'), required: ck('oj-pa-required') };
    var fileEl = doc.getElementById('oj-pa-file');
    var file = fileEl && fileEl.files && fileEl.files[0];
    if (!body.documentId && !body.title) return toast('Choose a library document or give the new document a name.', true);
    if (file) {
      if (file.size > 10 * 1024 * 1024) return toast('That file is larger than 10 MB.', true);
      var ext = String(file.name).split('.').pop().toLowerCase();
      body.fileName = file.name; body.fileMime = MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type);
      try { body.fileData = await readFileAsBase64(file); } catch (_) { return toast('The file could not be read.', true); }
    }
    var res = await packAct('/items', body, 'Added to this pack.', 'POST', S.addPhase || 'documentation');
    if (res && res.ok !== false) { packAddClose(); return refreshRecordAfter(Promise.resolve(res)); }
  }
  function readPackEmail(phase) {
    var sfx = phase === 'induction' ? 'ie' : 'pe';
    var sub = doc.getElementById('oj-' + sfx + '-subject'); var body = doc.getElementById('oj-' + sfx + '-body');
    return { subject: sub ? sub.value.trim() : undefined, body: body ? body.value : undefined };
  }
  function packSaveEmail(phase) { return packAct('/email', readPackEmail(phase), 'Email wording saved.', 'PUT', phase); }
  function packResetEmail(phase) { return packAct('/email/reset', {}, 'Email reset to the template.', 'POST', phase); }
  async function packCreateDraft(phase) {
    var e = readPackEmail(phase);
    if (e.subject !== undefined && !e.subject) return toast('Give the email a subject.', true);
    if (e.body !== undefined && !e.body.trim()) return toast('The email needs a message.', true);
    var res = await packAct('/email/draft', e, null, 'POST', phase);
    if (!res) return;
    if (res.blockers) toast('Phase 3 is not ready: ' + res.blockers.join('; '), true);
    if (res.delivery) {
      toast(res.delivery.message, false);
      if (res.delivery.webLink) global.open(res.delivery.webLink, '_blank', 'noopener');
    }
    return refreshRecordAfter(Promise.resolve(res));
  }
  async function packMarkSent(phase) {
    if (!await portalConfirm(phase === 'induction' ? 'Mark the Internal Induction Pack as sent? The record tracks the induction items from here.' : 'Mark the onboarding documentation as sent? The record moves to waiting for the returned documents.')) return;
    return refreshRecordAfter(packAct('/mark-sent', {}, phase === 'induction' ? 'Internal Induction Sent.' : 'Marked as sent. Waiting for the returned documentation.', 'POST', phase));
  }
  function packUnmarkSent(phase) { return refreshRecordAfter(packAct('/unmark-sent', {}, 'Back to not sent.', 'POST', phase)); }

  // ── The return leg ──
  async function returnsAct(rest, body, okMessage, method) {
    if (S.busy) return null;
    S.busy = true;
    var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + rest, { method: method || 'POST', body: body || {} });
    S.busy = false;
    if (!res.ok) { toast(res.error, true); return res; }
    if (okMessage) toast(typeof okMessage === 'function' ? okMessage(res) : okMessage);
    return refreshRecordAfter(Promise.resolve(res));
  }
  var RETURN_EXTS = { pdf: 1, docx: 1, doc: 1, png: 1, jpg: 1, jpeg: 1, txt: 1, zip: 1 };
  /** Files, a folder or a ZIP → the returns endpoint, in batches the server accepts (12 files, ~10 MB each request). */
  async function uploadReturns(input) {
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    input.value = '';
    if (!files.length) return;
    var payload = []; var skipped = 0;
    for (var i = 0; i < files.length; i += 1) {
      var f = files[i];
      var rel = f.webkitRelativePath || f.name;
      var base = String(f.name);
      if (base.charAt(0) === '.' || /(^|\/)__MACOSX\//.test(rel) || base === 'Thumbs.db') continue; // folder noise
      var ext = base.split('.').pop().toLowerCase();
      if (!RETURN_EXTS[ext]) { skipped += 1; continue; }
      if (f.size > 10 * 1024 * 1024) { toast(base + ' is larger than 10 MB.', true); continue; }
      var mime = ext === 'zip' ? 'application/zip' : MIMES[ext] || (ext === 'doc' ? 'application/msword' : ext === 'txt' ? 'text/plain' : f.type);
      try { payload.push({ fileName: base, fileMime: mime, fileData: await readFileAsBase64(f), title: rel !== base ? rel.split('/').slice(0, -1).join('/') + ' / ' + base : base, bytes: f.size }); } catch (_) { toast(base + ' could not be read.', true); }
    }
    if (skipped) toast(skipped + ' file(s) skipped — not PDF, Word, image, text or ZIP.', true);
    if (!payload.length) return;
    // Batch: at most 12 files and about 10 MB per request.
    var batches = []; var cur = []; var curBytes = 0;
    payload.forEach(function (p) {
      if (cur.length >= 12 || (cur.length && curBytes + p.bytes > 10 * 1024 * 1024)) { batches.push(cur); cur = []; curBytes = 0; }
      cur.push(p); curBytes += p.bytes;
    });
    if (cur.length) batches.push(cur);
    toast('Reading ' + payload.length + ' file(s)' + (batches.length > 1 ? ' in ' + batches.length + ' batches' : '') + '…');
    var totals = { stored: 0, matched: 0, applied: 0, check: 0, rejected: [] }; var last = null;
    for (var b = 0; b < batches.length; b += 1) {
      var body = { files: batches[b].map(function (p) { return { fileName: p.fileName, fileMime: p.fileMime, fileData: p.fileData, title: p.title }; }) };
      var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + '/returns', { method: 'POST', body: body });
      if (!res.ok) { toast(res.error, true); break; }
      last = res;
      var p2 = res.processed || {};
      totals.stored += (res.stored || []).length; totals.matched = p2.matched || totals.matched; totals.applied = p2.reliable || totals.applied; totals.check = (p2.conflict || 0) + (p2.review || 0);
      totals.rejected = totals.rejected.concat(res.rejected || []);
    }
    if (last) {
      toast(totals.stored + ' stored · ' + totals.matched + ' matched · ' + totals.applied + ' values applied · ' + totals.check + ' for you to check' + (totals.rejected.length ? ' · ' + totals.rejected.length + ' not accepted' : ''));
      if (totals.rejected.length) toast(totals.rejected.slice(0, 3).map(function (r) { return r.fileName + ': ' + r.reason; }).join(' · '), true);
    }
    return refreshRecordAfter(Promise.resolve(last || { ok: false }));
  }
  function processReturns() { return returnsAct('/returns/process', {}, 'Re-read.'); }
  function previewReturn(id) {
    var x = (S.record && S.record.returnedDocuments || []).filter(function (r) { return r.id === id; })[0];
    if (!x) return;
    if (x.previewKind && global.DocPreview) global.DocPreview.open({ kind: x.previewKind, url: x.previewUrl + '?rev=' + Date.now(), downloadUrl: x.downloadUrl, title: x.title || x.fileName });
    else global.open(x.downloadUrl, '_blank', 'noopener');
  }
  function assignReturn(docId, n) {
    var sel = doc.getElementById('oj-asg-' + n);
    var itemId = sel ? sel.value : '';
    if (!itemId) return toast('Choose which document this is.', true);
    return returnsAct('/returns/' + encodeURIComponent(docId) + '/assign', { packItemId: itemId }, 'Assigned and re-read.');
  }
  async function archiveReturn(docId) {
    if (!await portalConfirm('Archive this document as not part of the onboarding pack?')) return;
    return returnsAct('/returns/' + encodeURIComponent(docId) + '/archive', {}, 'Archived.');
  }
  function resolveConflict(fieldId, n) {
    var picked = doc.querySelector('input[name="oj-cf-' + n + '"]:checked');
    if (!picked) return toast('Select which value is correct.', true);
    if (!picked.value) return correctField(fieldId, picked.getAttribute('data-value'));
    return returnsAct('/fields/' + encodeURIComponent(fieldId) + '/resolve', { decision: 'choose', candidateId: picked.value }, 'Applied to the profile.');
  }
  function acceptField(fieldId) { return returnsAct('/fields/' + encodeURIComponent(fieldId) + '/resolve', { decision: 'accept' }, 'Confirmed and applied.'); }
  async function correctField(fieldId, seed) {
    var value = await portalPrompt('Enter the correct value:', seed || '');
    if (value === null || !value.trim()) return;
    return returnsAct('/fields/' + encodeURIComponent(fieldId) + '/resolve', { decision: 'correct', value: value.trim() }, 'Corrected and applied.');
  }
  function rejectField(fieldId) { return returnsAct('/fields/' + encodeURIComponent(fieldId) + '/resolve', { decision: 'reject' }, 'Ignored.'); }
  async function verifyItem(itemId) {
    var ref = await portalPrompt('Verified against the register. Reference (optional):');
    if (ref === null) return;
    return returnsAct('/pack/items/' + encodeURIComponent(itemId) + '/verify', { reference: ref || undefined }, 'Verified.');
  }
  async function rejectItem(itemId) {
    var reason = await portalPrompt('Reject this document. Reason:');
    if (reason === null) return;
    return returnsAct('/pack/items/' + encodeURIComponent(itemId) + '/reject', { reason: reason || undefined }, 'Rejected.');
  }
  async function approvePayroll() {
    if (!await portalConfirm('Approve these bank details for payroll?')) return;
    return returnsAct('/payroll/approve', {}, 'Approved for payroll.');
  }

  /** Pack changes move the record's stage/next line: reload the record after them. */
  async function refreshRecordAfter(p) {
    var res = await p;
    if (!res || res.ok === false) return res;
    var fresh = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId));
    if (fresh.ok) { S.record = fresh; var pane = doc.getElementById('oj-view'); if (pane) drawRecord(pane); }
    return res;
  }

  async function cancelRecord() {
    var reason = await portalPrompt('Cancel this onboarding? Give a reason for the record.');
    if (reason === null) return;
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(S.recordId) + '/cancel', { method: 'POST', body: { reason: reason || 'Cancelled by the practice' } });
    if (!res.ok) return toast(res.error, true);
    toast('Onboarding cancelled.');
    S.record = null; nav('board');
  }

  /** The detailed requirement review still lives in onboarding.js's Track view. */
  function openReview() {
    var ob = global.Onboarding;
    if (ob && typeof ob.openAssignment === 'function') {
      if (typeof ob.nav === 'function') ob.nav('track');
      try { ob.openAssignment(S.recordId); } catch (e) { /* the old surface reports its own errors */ }
    }
  }

  function scrollTo(id) { var el = doc.getElementById(id); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
  function copy(text) {
    if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(text).then(function () { toast('Link copied.'); }, function () { toast('Could not copy — select the link and copy it.', true); });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  global.OnboardingJourney = {
    render: render,
    syncPay: syncPaySuggestions,
    subnavHtml: subnavHtml,
    nav: nav,
    openRecord: openRecord,
    filter: setFilter,
    submitStart: submitStart,
    editTerms: editTerms, cancelEdit: cancelEdit, saveTerms: saveTerms,
    previewLetter: previewLetter, previewSigned: previewSigned, uploadLetter: uploadLetter, uploadSigned: uploadSigned, discardLetter: discardLetter,
    saveEmail: saveEmail, resetEmail: resetEmail, createDraft: createDraft, markSent: markSent, unmarkSent: unmarkSent,
    verifyOffer: verifyOffer, declineOffer: declineOffer, withdrawOffer: withdrawOffer, skipOffer: skipOffer,
    packPrepare: packPrepare, packItem: packItem, packFlag: packFlag, packRename: packRename, packUploadFile: packUploadFile,
    packRevertFile: packRevertFile, packPreview: packPreview, packAddOpen: packAddOpen, packAddClose: packAddClose, packAddSubmit: packAddSubmit,
    packSaveEmail: packSaveEmail, packResetEmail: packResetEmail, packCreateDraft: packCreateDraft, packMarkSent: packMarkSent, packUnmarkSent: packUnmarkSent,
    uploadReturns: uploadReturns, processReturns: processReturns, previewReturn: previewReturn, assignReturn: assignReturn, archiveReturn: archiveReturn,
    resolveConflict: resolveConflict, acceptField: acceptField, correctField: correctField, rejectField: rejectField,
    verifyItem: verifyItem, rejectItem: rejectItem, approvePayroll: approvePayroll, approvePayrollSetup: approvePayrollSetup, packRestoreDefaults: packRestoreDefaults,
    release: release,
    runTask: runTask, task: task, assignTask: assignTask,
    cancelRecord: cancelRecord, openReview: openReview,
    scrollTo: scrollTo, copy: copy, viewPhase: viewPhase,
    openDefaults: openDefaults, viewDefaultsPhase: viewDefaultsPhase, previewDefaultsLetter: previewDefaultsLetter, defaultsFlag: defaultsFlag, defaultsRename: defaultsRename,
    defaultsRemove: defaultsRemove, defaultsRestore: defaultsRestore, defaultsUpload: defaultsUpload, defaultsPreview: defaultsPreview, defaultsAddOpen: defaultsAddOpen, defaultsAddClose: defaultsAddClose, defaultsAddSubmit: defaultsAddSubmit,
    refresh: rerender,
    _state: S,
  };
})(typeof window !== 'undefined' ? window : this);
