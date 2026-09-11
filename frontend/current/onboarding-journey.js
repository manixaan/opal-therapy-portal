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
    draftId: null,      // the Start form being resumed / autosaved
    draftTimer: null,
    draftDirty: false,
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
    S.draftId = view === 'start' ? (id || null) : null;
    S.recordId = view === 'record' ? (id || S.recordId) : null;
    S.packageId = view === 'defaults' ? (id || null) : null;
    S.phaseView = null;
    S.docTab = null;
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
    armDropzones();
    if (view) S.view = (view === 'track' || view === 'dashboard') ? 'board' : view;
    if (S.view === 'record' && id) S.recordId = id;
    if (S.view === 'start' && id) S.draftId = id;
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
    var both = await Promise.all([api('/api/onboarding/journey/board'), can('onboarding.assign') ? api('/api/onboarding/journey/drafts') : { ok: true, drafts: [] }]);
    var res = both[0];
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'; return; }
    S.board = res;
    S.drafts = both[1].ok ? both[1].drafts : [];
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
      + draftsSection(S.drafts)
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
      + (!r.closed && !r.complete && can('onboarding.assign')
        ? '<button type="button" class="oj-row-bin" title="Cancel this onboarding" aria-label="Cancel onboarding for ' + esc(r.applicantName) + '"'
          + ' onclick="event.stopPropagation();OnboardingJourney.cancelRecordDialog(\'' + jsq(r.id) + '\')" onkeydown="event.stopPropagation()">'
          + '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">'
          + '<path d="M3.5 5.5h13M8 5.5V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M5 5.5l.8 10.2a1.5 1.5 0 0 0 1.5 1.3h5.4a1.5 1.5 0 0 0 1.5-1.3L15 5.5M8.2 9v5M11.8 9v5"/></svg></button>'
        : '')
      + '</article>';
  }

  /**
   * The bin on a board row. Cancelling keeps the record and its history (the
   * backend never deletes), but stops the invitation and any account that was
   * never staff — so it asks for a reason, the same as the record page does.
   */
  function cancelRecordDialog(id) {
    if (!global.Onboarding || typeof global.Onboarding.openModal !== 'function') return;
    var r = (S.board && S.board.records || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    global.Onboarding.openModal({
      title: 'Cancel this onboarding',
      subtitle: r.applicantName,
      body: '<div class="ob-note is-warn">Cancelling stops this onboarding: any invitation link '
        + 'stops working immediately, and an account that never became staff is deactivated. '
        + 'Nothing is deleted — the record and its history are kept.</div>'
        + '<div class="ob-field">'
        + '  <label for="oj-cx-reason">Why is it being cancelled?<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '  <textarea id="oj-cx-reason" maxlength="500" required'
        + '            placeholder="e.g. Started in error, or the candidate withdrew."></textarea>'
        + '</div>'
        + '<div id="oj-cx-error" class="ob-note is-danger" role="alert" hidden></div>',
      footer: '<div class="oj-actions oj-actions-tight">'
        + btn('Cancel onboarding', 'OnboardingJourney.confirmCancelRecord(\'' + jsq(id) + '\')', 'oj-btn-primary')
        + btn('Keep it', 'Onboarding.closeModal()')
        + '</div>',
    });
  }

  async function confirmCancelRecord(id) {
    var ta = doc.getElementById('oj-cx-reason');
    var errEl = doc.getElementById('oj-cx-error');
    var reason = ta && ta.value.trim();
    var fail = function (m) { if (errEl) { errEl.textContent = m; errEl.hidden = false; } };
    if (!reason) { fail('A reason is required.'); return; }
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(id) + '/cancel', { method: 'POST', body: { reason: reason } });
    if (!res.ok) { fail(res.error); return; }
    global.Onboarding.closeModal();
    toast('Onboarding cancelled');
    rerender();
  }

  function setFilter(f) { S.filter = f; var pane = doc.getElementById('oj-view'); if (pane && S.board) drawBoard(pane); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EDIT ONBOARDING — the default copy each package starts from
  // ═══════════════════════════════════════════════════════════════════════════

  /** Packages whose master default can be opened from Edit onboarding. Everything else is greyed out for now. */
  var ACTIVE_DEFAULT_PACKAGES = ['PKG_OT_FULL_TIME'];

  async function viewDefaults(pane, actions) {
    if (actions) actions.innerHTML = S.packageId ? '<button type="button" class="oj-btn" onclick="OnboardingJourney.nav(\'defaults\')">← All packages</button>' : '';
    if (!S.packageId) {
      var res = await api('/api/onboarding/journey/defaults');
      if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'; return; }
      pane.innerHTML = '<p class="oj-quiet">Each package is the default an onboarding starts from. Open one to walk through its three phases and tweak the documents; every new onboarding for that package inherits the tweak.</p>'
        + '<p class="oj-quiet">Only <strong>Occupational Therapist — Full-Time</strong> is open for editing at the moment. The other packages are on the way.</p>'
        + '<div class="oj-list">' + res.packages.map(function (p) {
          // Only the OT full-time package is being actively developed; the rest are shown but greyed out.
          if (ACTIVE_DEFAULT_PACKAGES.indexOf(p.code) === -1) {
            return '<article class="oj-row oj-tile-off" aria-disabled="true"><div class="oj-row-main"><h3>' + esc(p.title) + '</h3>'
              + '<p class="oj-quiet">' + esc(titleCase(p.roleCategory || '')) + ' · ' + esc(titleCase(p.employmentType || '')) + ' · coming soon</p></div>'
              + '<div class="oj-row-side"><span class="oj-chip is-quiet">Not yet available</span></div></article>';
          }
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
  function openDefaults(id) { S.defaultsSavedAt = null; nav('defaults', id); }

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
        + '<p class="oj-quiet">The letter template, filled with a sample employee so you can see how it reads. Edit the wording here and it becomes the standard for every offer; the particulars come from each onboarding\'s details.</p>'
        + '<div class="oj-actions">' + btn('Preview the letter', 'OnboardingJourney.previewDefaultsLetter()', 'oj-btn-primary') + (can('onboarding.assign') ? btn('Edit the letter', 'OnboardingJourney.openLetterEditor()') : '') + '<a class="oj-btn" href="' + esc(d.letter.downloadUrl) + '">Download (.docx)</a>' + (d.letter.pdfUrl ? '<a class="oj-btn" href="' + esc(d.letter.pdfUrl) + '">Download (PDF)</a>' : '') + '</div>'
        + '<h3 class="oj-sub">Email 1</h3><pre class="oj-pre">' + esc(d.emails.offer.subject) + '\n\n' + esc(d.emails.offer.body) + '</pre></section>';
    } else {
      var phase = view === 2 ? 'documentation' : 'induction';
      var em = view === 2 ? d.emails.documentation : d.emails.induction;
      // The email first, then the documents that go with it — the order the employee meets them.
      body = '<section class="oj-panel"><h3 class="oj-sub">' + (view === 2 ? 'Email 2' : 'Email 3') + '</h3><pre class="oj-pre">' + esc(em.subject) + '\n\n' + esc(em.body) + '</pre></section>'
        + defaultsTable(d, phase);
    }
    pane.innerHTML = '<div class="oj-record-head"><div><h2>' + esc(d.package.title) + ' <span class="oj-chip is-warn">Master default</span></h2><p class="oj-quiet">' + esc(titleCase(d.package.roleCategory || '')) + ' · ' + esc(titleCase(d.package.employmentType || '')) + '</p></div>'
      + '<div class="oj-record-head-actions">' + btn('Done — back to packages', 'OnboardingJourney.nav(\'defaults\')', 'oj-btn-primary') + '</div></div>'
      + '<div class="ob-note is-warn oj-master-note"><strong>You are editing the master default for this package.</strong> Every onboarding you start with this package begins from what is set here — the letter wording, the documents and their files. Records already started keep their own copy. '
      + '<span id="oj-master-saved" class="oj-quiet">' + (S.defaultsSavedAt ? 'Saved ' + esc(fmtDateTime(S.defaultsSavedAt)) + '.' : 'Each change saves as you make it.') + '</span></div>'
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
    var grouped = groupPackItems(included); var groups = grouped.groups;
    var order = sectionOrder(phase).filter(function (k) { return groups[k]; });
    var out = '<section class="oj-panel oj-stage"><header><h2><span class="oj-stage-n">' + (phase === 'induction' ? 3 : 2) + '</span>' + (phase === 'induction' ? 'Internal Induction Pack' : 'Onboarding Documentation Pack') + '</h2></header>'
      + '<div class="oj-pack-head"><div><strong>' + included.length + ' items by default</strong> <span class="oj-quiet">for this package. Required, Employee returns and Verified by us start as No — set them here for each document.</span></div>'
      + (edit ? '<div class="oj-actions">' + btn('Restore defaults', 'OnboardingJourney.defaultsRestore(\'' + phase + '\')', 'oj-btn-quiet') + '</div>' : '') + '</div>'
      + '<div id="oj-defaults-add" hidden></div>'
      + '<div class="oj-table-wrap"><table class="oj-pack"><thead><tr><th>Document</th><th>File</th><th></th></tr></thead><tbody>'
      + (edit ? '<tr class="oj-pack-addrow"><td colspan="3">' + btn('+ Add a document to this package', 'OnboardingJourney.defaultsAddOpen(\'' + phase + '\')', 'oj-btn-primary oj-btn-small') + '</td></tr>' : '');
    order.forEach(function (k) {
      out += '<tr class="oj-pack-section"><td colspan="3"><div class="oj-section-bar"><span>' + esc(SECTION_LABELS[k] || titleCase(k)) + '</span>'
        + (edit ? '<span class="oj-section-attach">' + btn('+ Add document', 'OnboardingJourney.defaultsAddOpen(\'' + phase + '\', \'' + jsq(k) + '\')', 'oj-btn-small oj-btn-quiet') + '</span>' : '') + '</div></td></tr>';
      groups[k].forEach(function (i) { out += defaultsRow(i); var kids = grouped.children[i.code] || []; if (kids.length) { out += subheadRow(i, 3); kids.forEach(function (c) { out += defaultsRow(c, true); }); } });
    });
    function defaultsRow(i, sub) {
      var out = '';
        var f = i.file || {};
        var fileCell = i.itemKind !== 'document' ? '<span class="oj-quiet">' + (i.itemKind === 'account' ? 'Follows the set-up task' : 'Follows the induction task') + '</span>'
          : f.previewUrl ? (/^PLACEHOLDER - /.test(f.fileName || '') ? '<span class="oj-chip is-warn">Placeholder</span> ' : '') + '<span class="oj-quiet">' + esc(f.fileName || 'Library') + '</span>' : !i.sendsDocument ? '<span class="oj-quiet">Employee supplies their own</span>'
          : f.source === 'link' && i.officialSourceUrl ? '<span class="oj-warn">No file</span> <a href="' + esc(i.officialSourceUrl) + '" target="_blank" rel="noopener" class="oj-quiet">official source ↗</a>' : '<span class="oj-warn">No file yet</span>';
        var fileActs = [];
        if (f.previewUrl) fileActs.push(btn('Preview', 'OnboardingJourney.defaultsPreview(\'' + jsq(i.code) + '\',\'' + phase + '\')', 'oj-btn-small oj-btn-quiet'));
        if (f.previewUrl) fileActs.push('<a class="oj-btn oj-btn-small oj-btn-quiet" href="' + esc(f.previewUrl) + '" download>Download</a>');
        if (edit && i.itemKind === 'document') fileActs.push('<label class="oj-btn oj-btn-small oj-file' + (f.previewUrl ? ' oj-btn-quiet' : ' oj-btn-primary') + '">' + (f.previewUrl ? 'Replace' : 'Upload file') + '<input type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.defaultsUpload(\'' + jsq(i.code) + '\',\'' + phase + '\', this)"></label>');
        if (edit && f.previewUrl && f.source === 'library') fileActs.push(btn('Edit', 'OnboardingJourney.defaultsRenameFile(\'' + jsq(i.code) + '\',\'' + phase + '\',\'' + jsq(f.fileName || '') + '\')', 'oj-btn-small oj-btn-quiet'));
        var rowActs = [];
        if (edit) { rowActs.push(btn('Remove', 'OnboardingJourney.defaultsRemove(\'' + jsq(i.code) + '\',\'' + phase + '\', true)', 'oj-btn-small oj-btn-quiet')); }
        var droppable = edit && i.itemKind === 'document';
        out += '<tr class="oj-pack-row' + (sub ? ' oj-pack-sub' : '') + (i.origin === 'added' ? ' is-added' : '') + (droppable ? ' oj-droprow' : '') + '"' + (droppable ? ' data-drop="defaults:' + esc(i.code) + ':' + esc(phase) + '" title="Drop a file here to attach it"' : '') + '><td><strong>' + esc(i.title) + '</strong>' + (i.origin === 'added' ? ' <span class="oj-chip is-you">Added</span>' : i.tweaked ? ' <span class="oj-chip is-quiet">Tweaked</span>' : '') + (i.description ? '<br><span class="oj-quiet">' + esc(i.description) + '</span>' : '') + '</td>'
          + '<td class="oj-filecell"><div>' + fileCell + '</div>' + (fileActs.length ? '<div class="oj-actions oj-actions-tight oj-file-acts">' + fileActs.join('') + '</div>' : '') + '</td>'
          + '<td class="oj-rowacts"><div class="oj-actions oj-actions-tight">' + rowActs.join('') + '</div></td></tr>';
      return out;
    }
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
    S.defaultsSavedAt = new Date().toISOString();
    if (okMessage) toast(okMessage);
    var pane = doc.getElementById('oj-view'); if (pane && S.defaults) drawDefaults(pane);
    return res;
  }
  async function defaultsRename(code, phase, current) {
    var title = await portalPrompt('Document name in this package\'s default pack:', current || '');
    if (title === null) return; if (!title.trim()) return toast('Give the document a name.', true);
    return defaultsAct('/items/' + encodeURIComponent(code), { phase: phase, title: title.trim() }, 'PATCH', 'Renamed for every new onboarding of this package.');
  }
  async function defaultsRenameFile(code, phase, current) {
    var name = await portalPrompt('File name as it will appear in the pack:', current || '');
    if (name === null) return; if (!name.trim()) return toast('Give the file a name.', true);
    return defaultsAct('/items/' + encodeURIComponent(code) + '/file', { phase: phase, fileName: name.trim() }, 'PATCH', 'File renamed — it shows under this name in every pack that uses it.');
  }
  function defaultsRemove(code, phase, removed) { return defaultsAct('/items/' + encodeURIComponent(code), { phase: phase, removed: removed }, 'PATCH', removed ? 'Removed from the default.' : 'Restored to the default.'); }
  async function defaultsUpload(code, phase, input) {
    var file = fileFrom(input);
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
  /** Open the add form for the package default; a section pins the new document under that heading. */
  async function defaultsAddOpen(phase, section) {
    var host = doc.getElementById('oj-defaults-add'); if (!host) return;
    S.defaultsAddSection = section || null;
    host.hidden = false; host.innerHTML = spinner('Loading the library…');
    var lib = await api('/api/onboarding/documents?audience=employee');
    var docs = (lib.ok && (lib.documents || lib.items)) || [];
    var opts = [['', '— Choose a library document —']].concat(docs.filter(function (x) { return x.status !== 'archived'; }).map(function (x) { return [x.id, x.title]; }));
    host.innerHTML = '<div class="oj-panel oj-add"><h3>Add a document to ' + (S.defaultsAddSection ? '<em>' + esc(SECTION_LABELS[S.defaultsAddSection] || titleCase(S.defaultsAddSection)) + '</em> in ' : '') + 'this package\'s default ' + (phase === 'induction' ? 'induction' : 'documentation') + ' pack</h3>'
      + '<div class="oj-grid2">' + field('oj-da-doc', 'From the library', select('oj-da-doc', opts, '')) + field('oj-da-title', 'Name (optional when choosing from the library)', input('oj-da-title', 'text', '', 'maxlength="250"')) + '</div>'
      + '<div class="oj-check-row"><label class="oj-check"><input type="checkbox" id="oj-da-sends" checked> A file is sent in the pack</label><label class="oj-check"><input type="checkbox" id="oj-da-returns"> The employee returns it</label><label class="oj-check"><input type="checkbox" id="oj-da-verifies"> We verify it</label><label class="oj-check"><input type="checkbox" id="oj-da-required" checked> Required</label></div>'
      + '<div class="oj-actions">' + btn('Add to the default', 'OnboardingJourney.defaultsAddSubmit(\'' + phase + '\')', 'oj-btn-primary') + btn('Cancel', 'OnboardingJourney.defaultsAddClose()') + '</div></div>';
  }
  function defaultsAddClose() { var host = doc.getElementById('oj-defaults-add'); if (host) { host.hidden = true; host.innerHTML = ''; } }
  async function defaultsAddSubmit(phase) {
    var v = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
    var ck = function (id) { var el = doc.getElementById(id); return !!(el && el.checked); };
    if (!v('oj-da-doc') && !v('oj-da-title')) return toast('Choose a library document or give the new document a name.', true);
    var res = await defaultsAct('/items', { phase: phase, documentId: v('oj-da-doc') || null, title: v('oj-da-title') || null, sendsDocument: ck('oj-da-sends'), employeeReturns: ck('oj-da-returns'), requiresVerification: ck('oj-da-verifies'), required: ck('oj-da-required'), section: S.defaultsAddSection || undefined }, 'POST', 'Added to the default.');
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
    var form = {};
    if (S.draftId) {
      var d = await api('/api/onboarding/journey/drafts/' + encodeURIComponent(S.draftId));
      if (d.ok) form = d.draft.form || {};
      else { S.draftId = null; toast('That draft is no longer there — starting fresh.', true); }
    }
    pane.innerHTML = startForm(S.options, form);
    var formEl = doc.getElementById('oj-start');
    if (formEl) formEl.addEventListener('input', markDraftDirty);
    if (formEl) formEl.addEventListener('change', markDraftDirty);
    if (S.draftId) syncPaySuggestions('oj-f-');
    setDraftStatus(S.draftId ? 'Draft resumed — saves as you type' : 'Saves as you type');
    var first = doc.getElementById('oj-f-name');
    if (first) first.focus({ preventScroll: true });
  }

  // ── Drafts: the form is saved as it is typed, and on demand ──────────────

  var DRAFT_DELAY = 1500;

  function setDraftStatus(text, isError) {
    var el = doc.getElementById('oj-draft-status');
    if (el) { el.textContent = text; el.classList.toggle('is-error', !!isError); }
  }

  function markDraftDirty() {
    S.draftDirty = true;
    if (S.draftTimer) clearTimeout(S.draftTimer);
    S.draftTimer = setTimeout(function () { saveDraft(true); }, DRAFT_DELAY);
    setDraftStatus('Unsaved changes…');
  }

  function fmtTime(d) { return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); }

  /** Saves the Start form as a draft. `auto` is the typing-triggered save; a
   *  manual save also tells the person where it went. */
  async function saveDraft(auto) {
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }
    if (!doc.getElementById('oj-start')) return false;
    var form = readStartForm();
    var typedAnything = Object.keys(form).some(function (k) { return form[k] !== '' && form[k] !== null && form[k] !== false && k !== 'proposedRole' && k !== 'employmentType' && k !== 'payBasis' && k !== 'probationMonths' && k !== 'isTreatingTherapist'; });
    if (!S.draftId && !typedAnything) { setDraftStatus('Saves as you type'); return false; }
    setDraftStatus('Saving…');
    var res = S.draftId
      ? await api('/api/onboarding/journey/drafts/' + encodeURIComponent(S.draftId), { method: 'PUT', body: { form: form } })
      : await api('/api/onboarding/journey/drafts', { method: 'POST', body: { form: form } });
    if (!res.ok) { setDraftStatus('Could not save the draft — ' + res.error, true); if (!auto) toast(res.error, true); return false; }
    S.draftId = res.draft.id;
    S.draftDirty = false;
    setDraftStatus('Draft saved ' + fmtTime(new Date()));
    if (!auto) toast('Draft saved. Find it under Drafts on the Onboarding board whenever you come back.');
    return true;
  }

  async function saveDraftAndLeave() {
    var ok = await saveDraft(false);
    if (ok || !S.draftDirty) nav('board');
  }

  async function discardDraft(id) {
    if (!await portalConfirm('Discard this draft? Nothing has been created from it, so there is nothing else to undo.', { danger: true })) return;
    var res = await api('/api/onboarding/journey/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { toast(res.error, true); return; }
    if (S.draftId === id) S.draftId = null;
    toast('Draft discarded.');
    if (S.view === 'start') nav('board'); else { var pane = doc.getElementById('oj-view'); if (pane) viewBoard(pane, doc.getElementById('oj-hero-actions')); }
  }

  function draftsSection(drafts) {
    if (!drafts || !drafts.length) return '';
    return '<section class="oj-drafts"><h2>Drafts <span class="oj-count">' + drafts.length + '</span></h2>'
      + '<p class="oj-quiet">Start Onboarding forms saved part-way. Nothing has been created from them yet.</p>'
      + '<div class="oj-list">' + drafts.map(function (d) {
        return '<article class="oj-row oj-row-draft"><div class="oj-row-main"><h3>' + esc(d.applicantName || 'Unnamed') + ' <span class="oj-chip is-quiet">Draft</span></h3>'
          + '<p class="oj-quiet">' + esc(d.positionTitle || 'Position not set') + ' · last saved ' + esc(fmtDateTime(d.updatedAt)) + '</p></div>'
          + '<div class="oj-row-side"><div class="oj-actions oj-actions-tight">'
          + '<button type="button" class="oj-btn oj-btn-primary oj-btn-small" onclick="OnboardingJourney.nav(\'start\', \'' + jsq(d.id) + '\')">Resume</button>'
          + '<button type="button" class="oj-btn oj-btn-small" onclick="OnboardingJourney.discardDraft(\'' + jsq(d.id) + '\')">Discard</button>'
          + '</div></div></article>';
      }).join('') + '</div></section>';
  }

  function field(id, label, control, hint) {
    return '<div class="oj-field"><label for="' + id + '">' + esc(label) + '</label>' + control
      + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
  }
  function input(id, type, value, attrs) {
    return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + '>';
  }
  /** Suggested values for a number field. The field stays free-text; the
   *  button at its edge lists every suggestion, always, filtered by nothing. */
  var SUGGEST = {
    payAnnual: [65000, 70000, 75000, 80000, 85000, 90000, 95000, 100000, 110000, 120000],
    payHourly: [35, 40, 45, 50, 55, 60, 65, 70, 75, 80],
    hours: [[38, '38 — full time'], [30.4, '30.4 — 0.8 FTE'], [22.8, '22.8 — 0.6 FTE'], [19, '19 — 0.5 FTE'], [15.2, '15.2 — 0.4 FTE'], [7.6, '7.6 — 0.2 FTE']],
    probation: [[0, 'None'], [3, '3 months'], [6, '6 months'], [12, '12 months']]
  };
  function comboItems(id, options) {
    return options.map(function (o) {
      var v = Array.isArray(o) ? o[0] : o; var l = Array.isArray(o) ? o[1] : String(v);
      return '<button type="button" role="option" class="oj-combo-item" onclick="OnboardingJourney.comboPick(\'' + jsq(id) + '\', \'' + jsq(String(v)) + '\')">' + esc(l) + '</button>';
    }).join('');
  }
  /** A number input with a dropdown of suggestions at its right edge. */
  function combo(id, value, attrs, options) {
    return '<div class="oj-combo" id="' + id + '-combo">'
      + '<input id="' + id + '" type="number" value="' + esc(value == null ? '' : value) + '" ' + (attrs || '') + ' onkeydown="OnboardingJourney.comboKey(event, \'' + jsq(id) + '\')">'
      + '<button type="button" class="oj-combo-btn" aria-label="Show options" aria-haspopup="listbox" onclick="OnboardingJourney.comboToggle(\'' + jsq(id) + '\')">▾</button>'
      + '<div class="oj-combo-menu" id="' + id + '-menu" role="listbox" hidden>' + comboItems(id, options) + '</div>'
      + '</div>';
  }
  function comboClose() {
    var open = doc.querySelectorAll('.oj-combo-menu:not([hidden])');
    for (var i = 0; i < open.length; i++) open[i].hidden = true;
  }
  function comboToggle(id) {
    var menu = doc.getElementById(id + '-menu'); if (!menu) return;
    var wasHidden = menu.hidden;
    comboClose();
    menu.hidden = !wasHidden;
    if (!menu.hidden) {
      var input = doc.getElementById(id); if (input) input.focus({ preventScroll: true });
      setTimeout(function () { doc.addEventListener('click', function onDoc(ev) {
        if (!ev.target.closest || !ev.target.closest('#' + id + '-combo')) { menu.hidden = true; doc.removeEventListener('click', onDoc); }
      }); }, 0);
    }
  }
  function comboPick(id, value) {
    var input = doc.getElementById(id); if (!input) return;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    comboClose();
    input.focus({ preventScroll: true });
  }
  /** Arrow keys step by a whole 1 regardless of the field's decimal step. */
  function comboKey(ev, id) {
    if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') { if (ev.key === 'Escape') comboClose(); return; }
    ev.preventDefault();
    var input = doc.getElementById(id); if (!input) return;
    var n = parseFloat(input.value); if (isNaN(n)) n = 0;
    n = n + (ev.key === 'ArrowUp' ? 1 : -1);
    var min = parseFloat(input.min), max = parseFloat(input.max);
    if (!isNaN(min) && n < min) n = min;
    if (!isNaN(max) && n > max) n = max;
    input.value = String(Math.round(n * 100) / 100);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }
  /** Pay basis changed: swap the salary suggestions between annual and hourly figures. */
  function syncPaySuggestions(prefix) {
    var basis = doc.getElementById(prefix + 'payBasis'), menu = doc.getElementById(prefix + 'payRate-menu');
    if (basis && menu) menu.innerHTML = comboItems(prefix + 'payRate', basis.value === 'hourly' ? SUGGEST.payHourly : SUGGEST.payAnnual);
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
      + field(p + 'payRate', 'Salary or rate (AUD, excl. super)', combo(p + 'payRate', t.payRate, 'min="0" step="any" inputmode="decimal"', t.payBasis === 'hourly' ? SUGGEST.payHourly : SUGGEST.payAnnual))
      + field(p + 'hoursPerWeek', 'Standard hours per week', combo(p + 'hoursPerWeek', t.hoursPerWeek, 'min="0" max="80" step="any" inputmode="decimal"', SUGGEST.hours))
      + field(p + 'probationMonths', 'Probation (months)', combo(p + 'probationMonths', t.probationMonths == null ? 6 : t.probationMonths, 'min="0" max="12" step="1"', SUGGEST.probation))
      + field(p + 'awardClassification', 'Award / classification', input(p + 'awardClassification', 'text', t.awardClassification, 'maxlength="150"'), 'e.g. Health Professionals and Support Services Award, Level 2')
      + field(p + 'workLocation', 'Location', input(p + 'workLocation', 'text', t.workLocation || (opts.defaults && opts.defaults.workLocation) || '', 'maxlength="150"'))
      + '</div>'
      + '<details class="oj-more"><summary>Letter particulars (defaults apply if left blank)</summary><div class="oj-grid2">'
      + field(p + 'award', 'Applicable modern award', input(p + 'award', 'text', t.award, 'maxlength="200" placeholder="Health Professionals and Support Services Award 2020 (MA000027)"'))
      + field(p + 'workPattern', 'Work pattern', input(p + 'workPattern', 'text', t.workPattern, 'maxlength="200" placeholder="worked between 8:30am and 4:30pm (flexible), Monday to Friday"'))
      + field(p + 'payCycle', 'Pay cycle', input(p + 'payCycle', 'text', t.payCycle, 'maxlength="40" placeholder="Fortnightly"'))
      + field(p + 'superannuationRate', 'Superannuation %', input(p + 'superannuationRate', 'number', t.superannuationRate, 'min="0" max="30" step="0.5" placeholder="12"'))
      + field(p + 'offerClosingDate', 'Offer closing date', input(p + 'offerClosingDate', 'date', isoDate(t.offerClosingDate)), 'Blank: 48 hours from the day the offer email goes out — the same window the email asks for.')
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
    var pkgs = (opts.packages || []).map(function (p) { return [p.id, p.title]; });
    return ''
      + '<form class="oj-form" id="oj-start" onsubmit="return OnboardingJourney.submitStart(event)">'
      + '<section class="oj-panel"><h2>Who</h2>'
      + '<div class="oj-grid2">'
      + field('oj-f-name', 'Full name', input('oj-f-name', 'text', t.name, 'maxlength="200" required autocomplete="off"'))
      + field('oj-f-email', 'Personal email', input('oj-f-email', 'email', t.personalEmail, 'maxlength="255" required autocomplete="off"'), 'The letter of offer and the onboarding invitation go here.')
      + field('oj-f-mobile', 'Mobile (optional)', input('oj-f-mobile', 'tel', t.mobile, 'maxlength="40"'))
      + field('oj-f-roleCategory', 'Role category', select('oj-f-roleCategory', roleCats, t.roleCategory || ''), 'Drives which onboarding package applies.')
      + field('oj-f-proposedRole', 'Portal access role', select('oj-f-proposedRole', [['therapist', 'Therapist'], ['admin', 'Admin'], ['read_only', 'Read only']], t.proposedRole || 'therapist'))
      + field('oj-f-managerUserId', 'Reports to', select('oj-f-managerUserId', staff, t.managerUserId || ''))
      + '</div>'
      + '<label class="oj-check"><input type="checkbox" id="oj-f-treating"' + (t.isTreatingTherapist === false ? '' : ' checked') + '> Treating therapist (works directly with participants)</label>'
      + '</section>'
      + '<section class="oj-panel"><h2>The offer</h2>'
      + '<p class="oj-quiet">Entered once. These terms become the letter of offer, the employment profile and the payroll set-up task.</p>'
      + termsFields(opts, t)
      + '</section>'
      + '<section class="oj-panel"><h2>Onboarding package</h2>'
      + field('oj-f-packageId', 'Documentation package', select('oj-f-packageId', pkgs, t.packageId || ''), 'The published document pack this hire will receive.')
      + field('oj-f-notes', 'Internal note (optional)', '<textarea id="oj-f-notes" rows="2" maxlength="2000">' + esc(t.notes || '') + '</textarea>')
      + '</section>'
      + '<div id="oj-start-error" class="ob-note is-danger" role="alert" hidden></div>'
      + '<div class="oj-actions"><button type="submit" class="oj-btn oj-btn-primary" id="oj-start-submit">Create the record and draft the letter</button>'
      + '<button type="button" class="oj-btn" onclick="OnboardingJourney.saveDraftAndLeave()">Save and come back later</button>'
      + '<button type="button" class="oj-btn" onclick="OnboardingJourney.nav(\'board\')">Cancel</button>'
      + '<span class="oj-draft-status" id="oj-draft-status" aria-live="polite"></span></div>'
      + '</form>';
  }

  /** Every field of the Start form, as the create endpoint (and a draft) takes it. */
  function readStartForm() {
    var v = function (id) { var el = doc.getElementById(id); return el ? el.value.trim() : ''; };
    var terms = readTerms();
    return {
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
  }

  async function submitStart(ev) {
    if (ev) ev.preventDefault();
    if (S.busy) return false;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }
    var errEl = doc.getElementById('oj-start-error');
    var btn = doc.getElementById('oj-start-submit');
    var body = readStartForm();
    body.draftId = S.draftId || null;
    S.busy = true; if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
    var res = await api('/api/onboarding/journey/records', { method: 'POST', body: body });
    S.busy = false; if (btn) { btn.disabled = false; btn.textContent = 'Create the record and draft the letter'; }
    if (!res.ok) {
      if (errEl) { errEl.textContent = res.error; errEl.hidden = false; errEl.scrollIntoView({ block: 'nearest' }); }
      return false;
    }
    toast('Onboarding started — the letter of offer is drafted and waiting for your approval.');
    S.draftId = null; S.draftDirty = false;
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
    var s2 = d.journey && d.journey.stages && d.journey.stages[1];
    // Stage 3 opens once the forms (contract, super choice, New Employee
    // Details) are verified, even while supporting copies are still to come.
    if (s2 && (s2.state === 'complete' || s2.formsDone)) return 3;
    return 2;
  }

  /** Stage 2 opened Stage 3 early: the returns still outstanding, or 0. */
  function docsOutstanding(d) {
    var s2 = d.journey && d.journey.stages && d.journey.stages[1];
    return s2 && s2.state !== 'complete' && s2.formsDone ? (s2.outstanding || 0) : 0;
  }

  function phaseStepper(d) {
    var cur = currentPhase(d);
    var view = S.phaseView || cur;
    var names = ['Letter of Offer', 'Onboarding Documentation', 'Internal Induction'];
    var outstanding = docsOutstanding(d);
    return '<ol class="oj-stepper">' + names.map(function (n, i) {
      var num = i + 1; var state = num < cur ? 'done' : num === cur ? 'current' : 'upcoming';
      // Stage 2 is not ticked while returns are outstanding, even though Stage 3 is open.
      if (num === 2 && state === 'done' && outstanding) state = 'attention';
      var clickable = num <= cur;
      return '<li class="oj-stepper-step is-' + state + (num === view ? ' is-viewing' : '') + '">'
        + (clickable ? '<button type="button" onclick="OnboardingJourney.viewPhase(' + num + ')">' : '<span>')
        + '<span class="oj-stepper-n">' + (state === 'done' ? '✓' : state === 'attention' ? '!' : num) + '</span>' + esc(n)
        + (state === 'attention' ? '<span class="oj-stepper-note" title="' + outstanding + ' document(s) still to come back">' + outstanding + ' still to come back</span>' : '')
        + (clickable ? '</button>' : '</span>') + '</li>';
    }).join('') + '</ol>';
  }

  function phaseBody(d) {
    var cur = currentPhase(d);
    var view = Math.min(S.phaseView || cur, cur);
    if (view === 1) return offerPanel(d);
    if (view === 2) return docTabs(d);
    var outstanding = docsOutstanding(d);
    var pending = outstanding
      ? '<div class="ob-note is-warn oj-docs-pending" role="status"><strong>Onboarding Documentation still has ' + outstanding + ' document(s) to come back.</strong> The forms are verified, so internal induction can begin; Stage 2 is ticked off once every return is in. '
        + '<button type="button" class="oj-link" onclick="OnboardingJourney.viewPhase(2)">Open Onboarding Documentation</button></div>'
      : '';
    return pending + phase3Panel(d) + inductionPanel(d) + payrollPanel(d) + profilePanel(d);
  }

  function viewPhase(n) { S.phaseView = n; var pane = doc.getElementById('oj-view'); if (pane && S.record) drawRecord(pane); }

  // ── Stage 2 tabs ──────────────────────────────────────────────────────────
  // Phase 2 is three jobs that happen side by side: the email and its
  // attachments, the internal setup checklist, and payroll. Each gets a
  // browser-style tab so the page shows one job at a time.

  var DOC_TABS = [
    ['email', 'Email & attachments', function (d) { return documentationPanel(d); }],
    ['setup', 'Internal setup', function (d) { return inductionPanel(d); }],
    ['payroll', 'Payroll & Xero', function (d) { return payrollPanel(d); }],
  ];

  function docTabs(d) {
    var active = S.docTab || DOC_TABS[0][0];
    if (!DOC_TABS.some(function (t) { return t[0] === active; })) active = DOC_TABS[0][0];
    var tabs = '<div class="oj-tabs" role="tablist" aria-label="Onboarding documentation">' + DOC_TABS.map(function (t) {
      var on = t[0] === active;
      return '<button type="button" role="tab" class="oj-tab' + (on ? ' is-active' : '') + '" id="oj-tab-' + t[0] + '" aria-selected="' + on + '" aria-controls="oj-tabpane-' + t[0] + '" onclick="OnboardingJourney.docTab(\'' + t[0] + '\')">' + esc(t[1]) + '</button>';
    }).join('') + '</div>';
    var panes = DOC_TABS.map(function (t) {
      var html = t[2](d) || '<section class="oj-panel oj-stage is-pending"><p class="oj-quiet">Nothing here yet — this opens once the earlier steps are done.</p></section>';
      return '<div class="oj-tabpane" role="tabpanel" id="oj-tabpane-' + t[0] + '" aria-labelledby="oj-tab-' + t[0] + '"' + (t[0] === active ? '' : ' hidden') + '>' + html + '</div>';
    }).join('');
    return '<div class="oj-tabset">' + tabs + panes + '</div>';
  }

  /** Switch the stage 2 tab in place — no re-render, so nothing typed is lost. */
  function docTab(key) {
    S.docTab = key;
    var set = doc.querySelector('.oj-tabset'); if (!set) return;
    set.querySelectorAll('.oj-tab').forEach(function (b) { var on = b.id === 'oj-tab-' + key; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    set.querySelectorAll('.oj-tabpane').forEach(function (p) { p.hidden = p.id !== 'oj-tabpane-' + key; });
  }

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
      case 'verify_offer': return btn('View the signed letter', 'OnboardingJourney.previewSigned()') + (c.assign ? btn('Submit the signed letter', 'OnboardingJourney.verifyOffer()', 'oj-btn-primary') : '');
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

  function termsTable(t, name) {
    var rows = [
      ['Employee name', name], ['Position', t.positionTitle], ['Employment type', titleCase(t.employmentType)],
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
      + termsTable(o.terms || r.terms || {}, r.applicantName)
      + (before ? '<p class="oj-quiet">Change these and the letter regenerates. An Outlook draft made from the old letter is discarded.</p>' : '')
      + '</li>';

    // ── Step 2: the letter ──
    var L = d.letter || {};
    body += '<li class="oj-step ' + stepState(!before, before) + '"><div class="oj-step-head"><span class="oj-step-n">2</span><strong>Letter of Offer</strong>'
      + '<span class="oj-chip ' + (L.source === 'uploaded' ? 'is-you' : 'is-quiet') + '">' + (L.source === 'uploaded' ? 'Edited copy uploaded' : templateChipText(L.template)) + '</span></div>'
      + '<p class="oj-quiet">' + esc(L.fileName || '') + (L.uploaded ? ' · uploaded ' + esc(fmtDateTime(L.uploaded.uploadedAt)) + (L.uploaded.uploadedByName ? ' by ' + esc(L.uploaded.uploadedByName) : '') : '') + '</p>'
      + '<div class="oj-actions">'
      + btn('Preview the letter', 'OnboardingJourney.previewLetter()', before ? 'oj-btn-primary' : '')
      + '<a class="oj-btn" href="' + esc(L.downloadUrl || '#') + '">Download (.docx)</a>'
      + (L.pdfUrl ? '<a class="oj-btn" href="' + esc(L.pdfUrl) + '">Download (PDF)</a>' : '')
      + (before && c.assign && L.source !== 'uploaded' ? btn('Edit the letter', 'OnboardingJourney.openLetterEditor()') : '')
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
        + '<div class="oj-field"><label for="oj-e-body">Message</label>' + emailToolbar('oj-e-body') + '<textarea id="oj-e-body" rows="14" onkeydown="OnboardingJourney.emailKey(event)">' + esc(E.body || '') + '</textarea>'
        + '</div>'
        + '<div class="oj-actions">'
        + (E.outlook && !E.outlook.available
          ? btn('Open in my mail app — with the letter downloaded', 'OnboardingJourney.openInMailApp(\'e\', \'' + jsq((d.letter && d.letter.pdfUrl) || (d.letter && d.letter.downloadUrl) || '') + '\')', 'oj-btn-primary')
            + btn('Create the Outlook draft', 'OnboardingJourney.createDraft()')
          : btn(drafted ? 'Create a fresh Outlook draft' : 'Create the Outlook draft with the letter attached', 'OnboardingJourney.createDraft()', 'oj-btn-primary')
            + btn('Open in my mail app instead', 'OnboardingJourney.openInMailApp(\'e\', \'' + jsq((d.letter && d.letter.pdfUrl) || (d.letter && d.letter.downloadUrl) || '') + '\')'))
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
        body += '<div class="oj-actions oj-actions-sent">' + btn('Mark as sent — I sent it another way', 'OnboardingJourney.markSent()') + '</div>';
      }
    } else {
      body += '<p class="oj-quiet">' + (E.sentAt ? 'Sent ' + esc(fmtDateTime(E.sentAt)) : 'Not yet sent') + (E.subject ? ' · “' + esc(E.subject) + '”' : '') + '</p>'
        + '<details class="oj-history"><summary>Show the message</summary><pre class="oj-pre">' + esc(E.body || '') + '</pre></details>';
    }
    body += '</li>';

    // ── The signed letter: upload, the portal reads it, the Owner submits ──
    var Sg = d.signed; var done = o.status === 'accepted';
    body += '<li class="oj-step ' + stepState(done, !done) + '"><div class="oj-step-head"><span class="oj-step-n">4</span><strong>Signed letter</strong></div>';
    if (Sg) {
      body += '<p class="oj-quiet">' + esc(Sg.fileName) + ' · received ' + esc(fmtDateTime(Sg.uploadedAt)) + '</p>'
        + documentCheckBlock(Sg.check)
        + '<div class="oj-actions">'
        + (c.assign && !done ? btn('Submit — accept the offer and start Phase 2', 'OnboardingJourney.verifyOffer()', 'oj-btn-primary') : '')
        + btn('View', 'OnboardingJourney.previewSigned()') + '<a class="oj-btn" href="' + esc(Sg.downloadUrl) + '">Download</a>'
        + (c.assign ? '<label class="oj-btn oj-file" title="Upload a different signed letter — it supersedes this one and what was read from it">Replace<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.uploadSigned(this' + (done ? ', true' : '') + ')"></label>' : '') + '</div>';
    } else if (c.assign) {
      body += '<p class="oj-quiet">Upload the letter the candidate returned. The portal reads the acceptance block — name, signature, date — and flags anything left blank before you submit it.</p>'
        + '<div class="oj-actions"><label class="oj-btn oj-btn-primary oj-file">Upload the signed letter<input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.uploadSigned(this)"></label></div>';
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

  /**
   * What the portal read in an uploaded document: each fillable field and
   * whether it was filled, and the blanks it flags. Never a green tick for
   * something it could not read.
   */
  function documentCheckBlock(check) {
    if (!check) return '';
    var cls = check.status === 'ok' ? 'is-ok' : check.status === 'attention' ? 'is-warn' : 'is-quiet';
    var head = check.status === 'ok' ? 'Read and complete' : check.status === 'attention' ? 'Needs a look before you submit' : check.status === 'unreadable' ? 'Could not be read automatically' : 'Nothing fillable to check';
    var out = '<div class="oj-doccheck ' + cls + '"><div class="oj-doccheck-head"><strong>' + esc(head) + '</strong>';
    if (check.issues && check.issues.length) out += '<ul class="oj-doccheck-issues">' + check.issues.map(function (i) { return '<li>' + esc(i.message) + '</li>'; }).join('') + '</ul>';
    out += '</div>';
    if (check.fields && check.fields.length) {
      out += '<ul class="oj-doccheck-fields">' + check.fields.map(function (f) {
        return '<li class="' + (f.filled ? 'is-filled' : 'is-blank') + '"><span class="oj-doccheck-mark" aria-hidden="true">' + (f.filled ? '✓' : '—') + '</span><span>' + esc(f.label) + '</span>'
          + (f.preview ? '<span class="oj-quiet">' + esc(f.preview) + '</span>' : !f.filled ? '<span class="oj-quiet">blank</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    return out + '</div>';
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

  /** Group included items by section, hoisting each supporting document under
      its parent (the New Employee Details) wherever the parent sits, so the
      form's attachments read as subsections rather than headings of their own. */
  function groupPackItems(included) {
    var byCode = {}; included.forEach(function (i) { byCode[i.code] = i; });
    var children = {}; var groups = {};
    included.forEach(function (i) {
      var pc = i.parentCode && byCode[i.parentCode] ? i.parentCode : null;
      if (pc) { (children[pc] = children[pc] || []).push(i); return; }
      var k = i.section || 'other'; (groups[k] = groups[k] || []).push(i);
    });
    return { groups: groups, children: children };
  }
  function subheadRow(parent, cols) {
    return '<tr class="oj-pack-subhead"><td colspan="' + cols + '">Returned with the ' + esc(parent.title) + ' — the copies the form asks for</td></tr>';
  }

  var SECTION_LABELS = {
    welcome_employment: 'Employment', personal_details: 'Personal details', payroll_tax_super: 'Payroll, tax and super',
    identity: 'Identity and right to work', professional: 'Professional registration', screening: 'Screening and checks',
    ndis: 'NDIS', policies: 'Policies', training: 'Training and induction',
    systems: 'Account setup instructions', agreements: 'Policies and agreements', accounts: 'Accounts activated',
  };
  /** Section order per phase; sections not listed (older records, added documents) follow in label order. */
  var PHASE_ORDER = {
    documentation: ['welcome_employment', 'personal_details', 'payroll_tax_super'],
    induction: ['welcome_employment', 'agreements', 'training', 'systems', 'accounts'],
  };
  function sectionOrder(phase) {
    var lead = PHASE_ORDER[phase] || [];
    return lead.concat(Object.keys(SECTION_LABELS).filter(function (k) { return lead.indexOf(k) === -1; })).concat(['other']);
  }

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


  function packPanel(d) {
    var P = d.pack; var r = d.record; var c = P.can || d.can;
    var sent = r.status === 'starter_pack_sent' || r.status === 'documents_received';
    var out = '';

    if (!P.prepared) {
      out += '<p class="oj-quiet">The document pack is being prepared.</p>';
      if (c.assign) out += '<div class="oj-actions">' + btn('Prepare the pack now', 'OnboardingJourney.packPrepare()', 'oj-btn-primary') + '</div>';
      return out;
    }
    // Stage 2.5 — the pack is out; what comes back is read, placed and checked here.
    if (sent) return returnsPanel(d);

    // Stage 2 — the email first, then the documents that go with it.
    out += packEmailEditor(d, P, 'documentation');
    out += attachmentsList(d, P);
    return out;
  }

  /** The Phase 2 list, in the words of the email: the four attachments, and what the New Employee Details bring back. */
  function attachmentsList(d, P) {
    var c = P.can || d.can; var editable = P.editable && c.assign; var phase = 'documentation';
    var included = P.items.filter(function (i) { return i.status === 'included'; });
    var attachments = included.filter(function (i) { return i.group === 'attachment'; });
    var supporting = included.filter(function (i) { return i.group === 'supporting'; });
    var added = included.filter(function (i) { return i.group === 'added'; });
    var out = '<div class="oj-attach" id="oj-attachments">'
      + '<div class="oj-pack-head"><div><strong>Attachments: ZIP folder including –</strong> <span class="oj-quiet">' + P.counts.sending + ' document(s) go out in the ZIP; ' + P.counts.returns + ' item(s) come back.</span>'
      + (P.counts.missingFiles ? '<br><span class="oj-warn">' + P.counts.missingFiles + ' document(s) have no file yet — attach one before the email can be sent.</span>' : '')
      + (P.counts.placeholders ? '<br><span class="oj-quiet">' + P.counts.placeholders + ' placeholder(s) stand in for documents not uploaded yet — replace them in Edit onboarding, or here for this person only.</span>' : '') + '</div>'
      + (editable ? '<div class="oj-actions">' + btn('+ Add document', 'OnboardingJourney.packAddOpen(\'' + phase + '\')') + btn('Restore defaults', 'OnboardingJourney.packRestoreDefaults(\'' + phase + '\')', 'oj-btn-quiet') + '</div>' : '') + '</div>'
      + '<ol class="oj-attach-list">';
    attachments.concat(added).forEach(function (i) {
      out += attachmentRow(i, editable, i.code === 'PACK_NEW_EMPLOYEE_DETAILS' ? supporting : null);
    });
    out += '</ol><div id="oj-pack-add-' + phase + '" hidden></div></div>';
    return out;
  }

  /** More files on the same document — each becomes its own attachment; the item's own file stays. */
  function addFilesButton(id) {
    return '<label class="oj-btn oj-btn-small oj-file" title="Attach more files to this document">+ Add files<input type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.packAddAttachments(\'' + jsq(id) + '\', this.files); this.value = \'\'"></label>';
  }

  function fileChip(i, editable) {
    var f = i.file || {};
    if (f.placeholder) return '<span class="oj-chip is-warn">Placeholder — replace with the real document</span>';
    if (f.previewUrl) return '<span class="oj-chip ' + (f.source === 'own' ? 'is-you' : 'is-quiet') + '">' + (f.source === 'own' ? 'Your copy' : f.source === 'body' ? 'Text' : 'Library') + '</span> <span class="oj-quiet">' + esc(f.fileName || '') + '</span>';
    if (f.source === 'link' && i.officialSourceUrl) return '<span class="oj-warn">No file</span> <a href="' + esc(i.officialSourceUrl) + '" target="_blank" rel="noopener" class="oj-quiet">official source ↗</a>';
    return '<span class="oj-warn">No file yet</span>';
  }

  function attachmentRow(i, editable, supporting) {
    var f = i.file || {};
    var acts = [];
    if (f.previewUrl) acts.push(btn('Preview', 'OnboardingJourney.packPreview(\'' + jsq(i.id) + '\')', 'oj-btn-small'));
    if (f.downloadUrl) acts.push('<a class="oj-btn oj-btn-small" href="' + esc(f.downloadUrl) + '">Download</a>');
    if (editable) {
      acts.push('<label class="oj-btn oj-btn-small oj-file' + (f.previewUrl && !f.placeholder ? '' : ' oj-btn-primary') + '">' + (f.previewUrl ? 'Replace' : 'Attach a file') + '<input type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.packUploadFile(\'' + jsq(i.id) + '\', this)"></label>');
      if (!i.itemKind || i.itemKind === 'document') acts.push(addFilesButton(i.id));
      if (f.source === 'own' && i.library) acts.push(btn('Use library copy', 'OnboardingJourney.packRevertFile(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
      if (f.previewUrl && !f.placeholder && (f.source === 'own' || f.source === 'library')) acts.push(btn('Edit', 'OnboardingJourney.packRenameFile(\'' + jsq(i.id) + '\',\'' + jsq(f.fileName || '') + '\')', 'oj-btn-small oj-btn-quiet'));
      if (i.group === 'added') acts.push(btn('Remove', 'OnboardingJourney.packItem(\'' + jsq(i.id) + '\',\'remove\')', 'oj-btn-small oj-btn-quiet'));
    }
    var atts = (i.attachments || []);
    var extra = atts.length ? '<ul class="oj-atts">' + atts.map(function (a) {
      return '<li class="oj-att"><a href="' + esc(a.previewUrl) + '" title="Preview" onclick="event.preventDefault(); OnboardingJourney.packPreviewAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\')">' + esc(a.fileName) + '</a>'
        + (editable ? ' <button type="button" class="oj-btn oj-btn-small oj-btn-quiet" title="Rename this attachment" onclick="OnboardingJourney.packRenameAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\', \'' + jsq(a.fileName) + '\')">Edit</button>' : '')
        + (editable ? '<button type="button" class="oj-file-x" title="Remove this attachment now" aria-label="Remove ' + esc(a.fileName) + '" onclick="OnboardingJourney.packRemoveAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\')">×</button>' : '') + '</li>';
    }).join('') + '</ul>' : '';
    var sub = '';
    if (supporting) {
      sub = '<p class="oj-quiet oj-attach-subhead">which will include:</p><ul class="oj-attach-sub">'
        + '<li>Bank details <span class="oj-quiet">— in the form</span></li>'
        + supporting.map(function (x) { return '<li>' + esc(x.title) + (x.required ? '' : ' <span class="oj-quiet">(if applicable)</span>') + (x.description ? ' <span class="oj-quiet">— ' + esc(x.description) + '</span>' : '') + '</li>'; }).join('')
        + '</ul>';
    }
    var droppable = editable && (!i.itemKind || i.itemKind === 'document');
    return '<li class="oj-attach-item' + (droppable ? ' oj-droprow' : '') + '"' + (droppable ? ' data-drop="pack:' + esc(i.id) + '" title="Drop a file here to attach it"' : '') + '>'
      + '<div class="oj-attach-main"><strong>' + esc(i.title) + '</strong>' + (i.group === 'added' ? ' <span class="oj-chip is-you">Added</span>' : '')
      + (i.description ? '<br><span class="oj-quiet">' + esc(i.description) + '</span>' : '')
      + '<div class="oj-attach-file">' + fileChip(i, editable) + extra + '</div>' + sub + '</div>'
      + '<div class="oj-actions oj-actions-tight oj-attach-acts">' + acts.join('') + '</div></li>';
  }

  /**
   * Stage 2.5 — the returned documentation. The same list as the pack, one
   * slot per document: upload a file, a folder or a ZIP and the portal reads
   * each one, works out which document it is and checks its fillable fields;
   * what it cannot place is listed for the Owner to put in the right slot.
   */
  function returnsPanel(d) {
    var P = d.pack; var r = d.record; var c = P.can || d.can; var E = P.email || {};
    var active = (d.returnedDocuments || []).filter(function (x) { return x.status === 'active'; });
    var included = P.items.filter(function (i) { return i.status === 'included'; });
    var expected = included.filter(function (i) { return i.employeeReturns; });
    var unplaced = active.filter(function (x) { return !x.packItemId; });
    var out = '<div class="oj-sent-banner"><strong>Onboarding Documents Sent</strong>'
      + '<span>Due: ' + esc(fmtDate(E.dueAt)) + '</span>'
      + '<span class="oj-quiet">sent ' + esc(fmtDateTime(E.sentAt)) + ' to ' + esc(E.sentTo || r.applicantEmail || '') + (P.zip ? ' · ' + P.zip.documentCount + ' document(s)' : '') + '</span></div>'
      + '<div class="oj-actions">' + (P.zip ? '<a class="oj-btn" href="' + esc(P.zip.downloadUrl) + '">Download the ZIP that went out</a>' : '')
      + (c.assign && r.status === 'starter_pack_sent' ? btn('Not sent after all', 'OnboardingJourney.packUnmarkSent()', 'oj-btn-quiet') : '') + '</div>';

    if (c.review) {
      out += '<div class="oj-returns oj-droprow" id="oj-returns-documentation" data-drop="returns"><strong>Upload what came back</strong>'
        + '<div class="oj-actions">'
        + '<label class="oj-btn oj-btn-primary oj-file">Upload files or a ZIP<input type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.txt,.zip" hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
        + '<label class="oj-btn oj-file">Upload a folder<input type="file" multiple webkitdirectory directory hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
        + (active.length ? btn('Re-read everything', 'OnboardingJourney.processReturns()', 'oj-btn-quiet') : '') + '</div>';
      if (unplaced.length) {
        // Every document in the pack is a slot, read-only ones included: a statement that came back sits under its own heading.
        var placeable = included.filter(function (i) { return !i.itemKind || i.itemKind === 'document'; });
        var opts = placeable.map(function (i) { return '<option value="' + esc(i.id) + '">' + esc(i.title) + (i.employeeReturns ? '' : ' (for reading only)') + '</option>'; }).join('');
        out += '<div class="oj-unplaced"><strong>Not placed yet (' + unplaced.length + ')</strong> <span class="oj-quiet">— the portal could not tell which document these are. Choose the slot for each.</span><ul>'
          + unplaced.map(function (x) {
            return '<li><span>' + esc(x.title || x.fileName) + '</span> ' + (x.checkSummary ? '<span class="oj-quiet">' + esc(x.checkSummary) + '</span> ' : '')
              + '<select id="oj-place-' + esc(x.id) + '"><option value="">— Which document is this? —</option>' + opts + '</select> '
              + btn('Place it', 'OnboardingJourney.placeReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small oj-btn-primary')
              + (x.previewKind ? btn('View', 'OnboardingJourney.previewReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small') : '')
              + btn('Not one of ours', 'OnboardingJourney.archiveReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small oj-btn-quiet') + '</li>';
          }).join('') + '</ul></div>';
      }
      out += '</div>';
    }

    var attachments = included.filter(function (i) { return i.group === 'attachment'; });
    var supporting = included.filter(function (i) { return i.group === 'supporting'; });
    var added = included.filter(function (i) { return i.group === 'added'; });
    var t = P.tracking || { done: 0, total: expected.length };
    out += '<div class="oj-pack-head"><div><strong>Returned documentation</strong> <span class="oj-quiet">' + t.done + ' of ' + t.total + ' complete' + (P.counts.attention ? ' · <span class="oj-warn">' + P.counts.attention + ' need a look</span>' : '') + '</span></div></div>'
      + '<ol class="oj-attach-list is-returns">';
    // A document added to the pack sits under the last sent document of its
    // section (an added FTCIS under the FWIS); one from a section with none at the end.
    var rows = [];
    attachments.forEach(function (i, idx) {
      rows.push(i);
      var lastOfSection = !attachments.slice(idx + 1).some(function (n) { return n.section === i.section; });
      if (lastOfSection) added.forEach(function (a) { if (a.section === i.section) rows.push(a); });
    });
    added.forEach(function (a) { if (rows.indexOf(a) < 0) rows.push(a); });
    rows.forEach(function (i) {
      out += returnRow(d, i, c);
      if (i.code === 'PACK_NEW_EMPLOYEE_DETAILS' && supporting.length) {
        out += '<li class="oj-attach-item is-subhead"><span class="oj-quiet">which will include:</span></li>';
        out += '<li class="oj-attach-item is-sub"><div class="oj-attach-main"><strong>Bank details</strong> <span class="oj-quiet">— in the form</span></div></li>';
        supporting.forEach(function (x) { out += returnRow(d, x, c, true); });
      }
    });
    out += '</ol>';
    var pending = expected.filter(function (i) { return i.progress === 'awaiting_return'; });
    out += '<p class="oj-returns-pending">' + (pending.length
      ? '<strong>Still to come back (' + pending.length + ' of ' + expected.length + '):</strong> ' + esc(pending.map(function (i) { return i.title; }).join(' · '))
      : '<strong>Everything expected has come back.</strong>' + (unplaced.length ? ' ' + unplaced.length + ' file(s) still need placing.' : '')) + '</p>';
    return out;
  }

  /** One slot in the returned-documentation list. */
  function returnRow(d, i, c, sub) {
    var docs = (d.returnedDocuments || []).filter(function (x) { return x.status === 'active' && x.packItemId === i.id; });
    var body = '';
    if (!i.employeeReturns) {
      // Returned anyway (the whole pack came back as one ZIP, say): shown, nothing to check or verify.
      body = '<span class="oj-quiet">For reading only — nothing comes back.</span>' + (docs.length ? '<ul class="oj-return-files">' + docs.map(function (x) {
        return '<li><span>' + esc(x.title || x.fileName) + '</span> <span class="oj-quiet">· came back with the pack — nothing to check</span> '
          + (x.previewKind ? btn('View', 'OnboardingJourney.previewReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small') : '<a class="oj-btn oj-btn-small" href="' + esc(x.downloadUrl) + '">Download</a>')
          + (c.review ? btn('Not this one', 'OnboardingJourney.unplaceReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small oj-btn-quiet') : '') + '</li>';
      }).join('') + '</ul>' : '');
    } else if (i.progress === 'not_applicable') {
      body = '<span class="oj-quiet">Not applicable to this person — nothing needs to come back.' + (i.verificationNote ? ' ' + esc(i.verificationNote) : '') + '</span>';
    } else if (!docs.length) {
      body = '<span class="oj-quiet">' + (i.required ? 'Waiting for it to come back.' : 'If applicable — nothing received yet.') + '</span>';
    } else {
      body = '<ul class="oj-return-files">' + docs.map(function (x) {
        var flags = [];
        if (x.signatureStatus === 'missing') flags.push('<span class="oj-warn">no signature</span>');
        if (x.check && x.check.status === 'attention') flags.push('<span class="oj-warn">' + esc(x.checkSummary || 'blank fields') + '</span>');
        else if (x.check && x.check.status === 'unreadable') flags.push('<span class="oj-quiet">' + esc(x.checkSummary) + '</span>');
        else if (x.check && x.check.status === 'ok') flags.push('<span class="oj-ok">' + esc(x.checkSummary) + '</span>');
        return '<li><span>' + esc(x.title || x.fileName) + '</span>' + (flags.length ? ' <span class="oj-quiet">· ' + flags.join(' · ') + '</span>' : '') + ' '
          + (x.previewKind ? btn('View', 'OnboardingJourney.previewReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small') : '<a class="oj-btn oj-btn-small" href="' + esc(x.downloadUrl) + '">Download</a>')
          + (c.review ? btn('Not this one', 'OnboardingJourney.unplaceReturn(\'' + jsq(x.id) + '\')', 'oj-btn-small oj-btn-quiet') : '') + '</li>';
      }).join('') + '</ul>';
      if (i.attentionReason) body += '<div class="oj-warn oj-attach-reason">' + esc(i.attentionReason) + '</div>';
      if (i.verificationNote && i.progress === 'verified') body += '<div class="oj-quiet oj-attach-reason">' + esc(i.verificationNote) + '</div>';
    }
    var acts = [];
    if (i.employeeReturns && i.progress === 'not_applicable') {
      if (c.review) acts.push(btn('Applies after all', 'OnboardingJourney.itemApplicable(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
      return '<li class="oj-attach-item' + (sub ? ' is-sub' : '') + ' is-not_applicable"><div class="oj-attach-main"><strong>' + esc(i.title) + '</strong> ' + progressChip(i)
        + '<div class="oj-attach-file">' + body + '</div></div><div class="oj-actions oj-actions-tight oj-attach-acts">' + acts.join('') + '</div></li>';
    }
    if (i.employeeReturns && c.review) acts.push('<label class="oj-btn oj-btn-small oj-file">' + (docs.length ? 'Upload another' : 'Upload for this document') + '<input type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.txt" hidden onchange="OnboardingJourney.uploadReturns(this, \'' + jsq(i.id) + '\')"></label>');
    if (i.employeeReturns && !docs.length && c.review) acts.push(btn('Not applicable', 'OnboardingJourney.itemNotApplicable(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
    if (i.employeeReturns && docs.length && i.progress !== 'verified' && c.verify) acts.push(btn('Verify', 'OnboardingJourney.verifyItem(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-primary') + btn('Reject', 'OnboardingJourney.rejectItem(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
    return '<li class="oj-attach-item' + (sub ? ' is-sub' : '') + ' is-' + esc(i.progress || 'n/a') + '">'
      + '<div class="oj-attach-main"><strong>' + esc(i.title) + '</strong>' + (i.employeeReturns && !i.required ? ' <span class="oj-quiet">(if applicable)</span>' : '') + (i.employeeReturns ? ' ' + progressChip(i) : '')
      + '<div class="oj-attach-file">' + body + '</div></div>'
      + '<div class="oj-actions oj-actions-tight oj-attach-acts">' + acts.join('') + '</div></li>';
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
    var out = '<div class="oj-returns oj-droprow" id="oj-returns-' + esc(phase) + '" data-drop="returns"><strong>Returned documents</strong>'
      + (!sent ? '<p class="oj-quiet">The pack has not been marked as sent yet. You can still upload anything the employee has already returned.</p>' : '')
      + '<div class="oj-actions">'
      + '<label class="oj-btn oj-btn-primary oj-file">Upload returned documents<input type="file" multiple accept=".pdf,.docx,.doc,.png,.jpg,.jpeg,.txt,.zip" hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
      + '<label class="oj-btn oj-file">Upload a folder<input type="file" multiple webkitdirectory directory hidden onchange="OnboardingJourney.uploadReturns(this)"></label>'
      + (active.length ? btn('Re-read everything', 'OnboardingJourney.processReturns()', 'oj-btn-quiet') : '') + '</div>';
    if (active.length) {
      out += '<ul class="oj-returns-list">' + active.map(function (x) {
        var item = P.items.filter(function (i) { return i.id === x.packItemId; })[0];
        return '<li><span>' + esc(x.title || x.fileName) + '</span> <span class="oj-quiet">' + (item ? '→ ' + esc(item.title) : x.matchStatus === 'unrecognised' ? '<span class="oj-warn">not recognised — name it under Requires Your Attention</span>' : 'reading…') + (x.signatureStatus === 'missing' ? ' · <span class="oj-warn">no signature</span>' : '') + (x.check && x.check.status === 'attention' ? ' · <span class="oj-warn">' + esc(x.checkSummary || 'blank fields') + '</span>' : x.check && x.check.status === 'unreadable' ? ' · <span class="oj-quiet">' + esc(x.checkSummary) + '</span>' : x.check && x.check.status === 'ok' ? ' · ' + esc(x.checkSummary) : '') + '</span> '
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
    var grouped = groupPackItems(included); var groups = grouped.groups;
    // While the pack is editable every section of this phase is shown, empty ones
    // included, so there is always somewhere to drop a file for it. Identity,
    // professional and screening headings only appear when something still sits there.
    var phaseSections = PHASE_ORDER[phase] || [];
    var order = sectionOrder(phase).filter(function (k) { return groups[k] || (editable && phaseSections.indexOf(k) >= 0); });

    out += '<div class="oj-pack-head"><div><strong>' + included.length + ' items in the ' + (phase === 'induction' ? 'induction' : 'documentation') + ' pack</strong></div>'
      + (editable ? '<div class="oj-actions">' + btn('+ Add document', 'OnboardingJourney.packAddOpen(\'' + phase + '\')') + btn('Restore defaults', 'OnboardingJourney.packRestoreDefaults(\'' + phase + '\')', 'oj-btn-quiet') + '</div>' : '') + '</div>';

    if (c.review) out += returnsBlock(d, P, phase, sent);
    out += '<div class="oj-table-wrap"><table class="oj-pack"><thead><tr><th>Document</th>' + (sent ? '<th>Status</th>' : '') + '<th>File</th><th></th></tr></thead><tbody>';
    order.forEach(function (k) {
      out += '<tr class="oj-pack-section' + (editable ? ' oj-droprow' : '') + '"' + (editable ? ' data-drop="section:' + esc(phase) + ':' + esc(k) + '" title="Drop one or more files here to add them to this section"' : '') + '><td colspan="7"><div class="oj-section-bar"><span>' + esc(SECTION_LABELS[k] || titleCase(k)) + '</span>'
        + (editable ? '<span class="oj-section-attach">' + btn('+ Add document', 'OnboardingJourney.packAddOpen(\'' + phase + '\', \'' + jsq(k) + '\')', 'oj-btn-small oj-btn-quiet') + '</span>' : '')
        + '</div></td></tr>';
      (groups[k] || []).forEach(function (i) { out += packRow(i, editable, sent); var kids = grouped.children[i.code] || []; if (kids.length) { out += subheadRow(i, 7); kids.forEach(function (c) { out += packRow(c, editable, sent, true); }); } });
      if (!groups[k] && editable) out += '<tr class="oj-pack-empty oj-droprow" data-drop="section:' + esc(phase) + ':' + esc(k) + '"><td colspan="7">Nothing here yet — drop files here to add them, or press + Add document.</td></tr>';
    });
    out += '</tbody></table></div>';
    // Removed documents are not listed here — a stale entry is noise on the working pack. Restore defaults brings the defaults back.
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
        + '<div class="oj-field"><label for="oj-pe-body">Message</label>' + emailToolbar('oj-pe-body') + '<textarea id="oj-pe-body" rows="16" onkeydown="OnboardingJourney.emailKey(event)">' + esc(E.body || '') + '</textarea>'
        + '</div>'
        + (P.counts && P.counts.missingFiles ? '<div class="ob-note is-warn">' + P.counts.missingFiles + ' document(s) below have no file yet. Attach a file for each before the email can be prepared or sent.</div>' : '')
        + '<div class="oj-actions">'
        + (E.outlook && !E.outlook.available
          ? btn('Open in my mail app — with the ZIP downloaded', 'OnboardingJourney.openInMailApp(\'pe\', \'/api/onboarding/journey/records/' + jsq(r.id) + '/pack/zip\')', 'oj-btn-primary')
            + btn('Prepare the Outlook draft', 'OnboardingJourney.packCreateDraft()')
          : btn(drafted ? 'Prepare a fresh Outlook draft' : 'Prepare Onboarding Email — create the Outlook draft with the ZIP attached', 'OnboardingJourney.packCreateDraft()', 'oj-btn-primary')
            + btn('Open in my mail app instead', 'OnboardingJourney.openInMailApp(\'pe\', \'/api/onboarding/journey/records/' + jsq(r.id) + '/pack/zip\')'))
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
        out += '<div class="oj-actions oj-actions-sent">' + btn('Mark as sent — I sent it another way', 'OnboardingJourney.packMarkSent()') + '</div>';
      }
    }
    out += '</div>';
    return out;
  }

  var PROGRESS_LABELS = { awaiting_return: 'Awaiting return', received: 'Received', verified: 'Complete', attention: 'Needs attention', sent: 'Sent', awaiting: 'Pending', not_applicable: 'Not applicable', 'n/a': '—', removed: 'Removed' };
  function progressChip(i) {
    var cls = i.progress === 'verified' ? 'is-done' : i.progress === 'received' ? 'is-employee' : i.progress === 'attention' ? 'is-danger' : i.progress === 'awaiting_return' ? 'is-you' : 'is-quiet';
    return '<span class="oj-chip ' + cls + '">' + esc(PROGRESS_LABELS[i.progress] || titleCase(i.progress)) + '</span>' + (i.verificationMode === 'auto' && i.progress === 'verified' ? '<br><span class="oj-quiet">by the portal</span>' : '');
  }

  function packRow(i, editable, sent, sub) {
    var f = i.file || {};
    var fileCell;
    if (i.itemKind && i.itemKind !== 'document') {
      fileCell = '<span class="oj-quiet">' + (i.itemKind === 'account' ? 'Follows the internal set-up task' : i.itemKind === 'training' ? 'Follows the induction walkthrough task' : 'Tracked') + '</span>';
    } else if (f.previewUrl) {
      fileCell = '<span class="oj-chip ' + (f.source === 'own' ? 'is-you' : 'is-quiet') + '">' + (f.source === 'own' ? 'Your copy' : f.source === 'body' ? 'Text' : 'Library') + '</span> <span class="oj-quiet">' + esc(f.fileName || '') + '</span>'
        + (editable ? '<button type="button" class="oj-file-x" title="' + (f.source === 'own' ? 'Remove this file now' : 'This is the library copy — × takes the document out of this pack') + '" aria-label="Remove" onclick="OnboardingJourney.packRemoveFileNow(\'' + jsq(i.id) + '\')">×</button>' : '');
    } else if (!i.sendsDocument) {
      fileCell = '<span class="oj-quiet">Employee supplies their own</span>';
    } else if (f.source === 'link' && i.officialSourceUrl) {
      fileCell = '<span class="oj-warn">No file</span> <a href="' + esc(i.officialSourceUrl) + '" target="_blank" rel="noopener" class="oj-quiet">official source ↗</a>';
    } else {
      fileCell = '<span class="oj-warn">No file yet</span>';
    }
    var atts = (i.attachments || []);
    if (atts.length) {
      fileCell += '<ul class="oj-atts">' + atts.map(function (a) {
        return '<li class="oj-att"><a href="' + esc(a.previewUrl) + '" title="Preview" onclick="event.preventDefault(); OnboardingJourney.packPreviewAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\')">' + esc(a.fileName) + '</a>'
          + (editable ? ' <button type="button" class="oj-btn oj-btn-small oj-btn-quiet" title="Rename this attachment" onclick="OnboardingJourney.packRenameAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\', \'' + jsq(a.fileName) + '\')">Edit</button>' : '')
        + (editable ? '<button type="button" class="oj-file-x" title="Remove this attachment now" aria-label="Remove ' + esc(a.fileName) + '" onclick="OnboardingJourney.packRemoveAttachment(\'' + jsq(i.id) + '\', \'' + jsq(a.id) + '\')">×</button>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    var acts = [];
    if (f.previewUrl) acts.push(btn('Preview', 'OnboardingJourney.packPreview(\'' + jsq(i.id) + '\')', 'oj-btn-small'));
    if (f.downloadUrl) acts.push('<a class="oj-btn oj-btn-small" href="' + esc(f.downloadUrl) + '">Download</a>');
    if (editable) {
      acts.push('<label class="oj-btn oj-btn-small oj-file">' + (f.previewUrl ? 'Replace' : 'Attach a file') + '<input type="file" accept=".pdf,.docx,.doc,.png,.jpg,.jpeg" hidden onchange="OnboardingJourney.packUploadFile(\'' + jsq(i.id) + '\', this)"></label>');
      if (!i.itemKind || i.itemKind === 'document') acts.push(addFilesButton(i.id));
      if (f.source === 'own' && i.library) acts.push(btn('Use library copy', 'OnboardingJourney.packRevertFile(\'' + jsq(i.id) + '\')', 'oj-btn-small oj-btn-quiet'));
      if (f.previewUrl && !f.placeholder && (f.source === 'own' || f.source === 'library')) acts.push(btn('Edit', 'OnboardingJourney.packRenameFile(\'' + jsq(i.id) + '\',\'' + jsq(f.fileName || '') + '\')', 'oj-btn-small oj-btn-quiet'));
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
    var droppable = editable && (!i.itemKind || i.itemKind === 'document');
    return '<tr class="oj-pack-row' + (sub ? ' oj-pack-sub' : '') + (i.origin === 'added' ? ' is-added' : '') + (droppable ? ' oj-droprow' : '') + '"' + (droppable ? ' data-drop="pack:' + esc(i.id) + '" title="Drop a file here to attach it"' : '') + '>'
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


  function inductionPanel(d) {
    var st = d.journey.stages[2];
    if (st.state === 'pending') return '';
    var c = d.can;
    var staff = [['', 'Unassigned']].concat(((S.options && S.options.staff) || []).map(function (u) { return [u.id, u.name]; }));
    var ready = d.tasks.filter(function (t) { return t.status === 'done' || t.status === 'skipped'; }).length;
    var body = '';
    if (d.tasks.length) {
      body += '<div class="oj-tasks-head"><span class="oj-tasks-count">' + ready + ' of ' + d.tasks.length + ' ready</span>'
        + '<span class="oj-meter-bar oj-tasks-bar"><span style="width:' + Math.round(ready / d.tasks.length * 100) + '%"></span></span></div>';
      body += '<ul class="oj-tasks">' + d.tasks.map(function (t) {
        var open = t.status === 'pending' || t.status === 'in_progress' || t.status === 'failed';
        var tone = t.status === 'done' ? 'done' : t.status === 'skipped' ? 'skipped' : t.status === 'failed' || t.overdue ? 'danger' : t.automation ? 'portal' : 'open';
        var icon = t.status === 'done' ? '✓' : t.status === 'skipped' ? '–' : t.status === 'failed' ? '!' : t.automation ? '▶' : '';
        var acts = [];
        // Manual tasks are ticked and unticked; only the portal's own action keeps a button.
        var tickable = c.review && t.automation !== 'activate_portal_access';
        if (t.automation === 'activate_portal_access' && open && c.activate) {
          acts.push(btn(t.status === 'failed' ? 'Try again' : 'Activate', 'OnboardingJourney.runTask(\'' + jsq(t.code) + '\')', 'oj-btn-primary oj-btn-small'));
        }
        var lead = tickable
          ? '<label class="oj-task-check" title="' + (t.status === 'done' ? 'Untick to reopen' : 'Tick when done') + '"><input type="checkbox"' + (t.status === 'done' ? ' checked' : '') + ' aria-label="' + esc(t.title) + ' done" onchange="OnboardingJourney.task(\'' + jsq(t.code) + '\', this.checked ? \'complete\' : \'reopen\')"><span class="oj-task-dot">' + icon + '</span></label>'
          : '<span class="oj-task-dot" aria-hidden="true">' + icon + '</span>';
        // One line of facts: who, when. Editable in place while the task is open.
        var meta = [];
        if (t.automation) meta.push('<span class="oj-task-portal">Portal does this</span>');
        if (open && c.review && !t.automation) {
          meta.push('<label class="oj-task-ctl" title="Assign to"><select onchange="OnboardingJourney.assignTask(\'' + jsq(t.code) + '\', this.value)">' + staff.map(function (s) {
            return '<option value="' + esc(s[0]) + '"' + (String(s[0]) === String(t.assigneeUserId || '') ? ' selected' : '') + '>' + esc(s[1]) + '</option>';
          }).join('') + '</select></label>');
          meta.push('<label class="oj-task-ctl' + (t.overdue ? ' is-overdue' : '') + '" title="Due date">' + (t.overdue ? 'Overdue ' : 'Due ') + '<input type="date" value="' + esc(isoDate(t.dueAt)) + '" onchange="OnboardingJourney.assignTask(\'' + jsq(t.code) + '\', null, this.value)"></label>');
        } else {
          if (t.assigneeName && open) meta.push(esc(t.assigneeName));
          if (open && t.dueAt) meta.push('<span' + (t.overdue ? ' class="oj-warn"' : '') + '>' + (t.overdue ? 'overdue ' : 'due ') + esc(fmtDate(t.dueAt)) + '</span>');
          if (t.completedAt) meta.push((t.status === 'skipped' ? 'skipped ' : 'done ') + esc(fmtDate(t.completedAt)) + (t.completedByName ? ' by ' + esc(t.completedByName) : ''));
        }
        if (t.note) meta.push('<span class="oj-task-note" title="' + esc(t.note) + '">' + esc(t.note) + '</span>');
        if (tickable && open) meta.push('<button type="button" class="oj-task-link" onclick="OnboardingJourney.task(\'' + jsq(t.code) + '\',\'skip\')">skip — not needed</button>');
        if (tickable && t.status === 'skipped') meta.push('<button type="button" class="oj-task-link" onclick="OnboardingJourney.task(\'' + jsq(t.code) + '\',\'reopen\')">reopen</button>');
        return '<li class="oj-task is-' + tone + '" id="oj-task-' + esc(t.code) + '">'
          + lead
          + '<div class="oj-task-main"><span class="oj-task-title" title="' + esc(t.description || '') + '">' + esc(t.title) + '</span>'
          + (meta.length ? '<span class="oj-task-meta">' + meta.join('<span class="oj-task-sep">·</span>') + '</span>' : '')
          + '</div>'
          + '<div class="oj-task-acts">' + acts.join('') + '</div>'
          + '</li>';
      }).join('') + '</ul>';
    } else {
      body = '<p class="oj-quiet">The checklist is being generated.</p>';
    }
    return stagePanel('⚙', 'Internal Setup', st, body);
  }

  /** Payroll Setup — confirm, do not retype. */
  function payrollPanel(d) {
    if (!d.payroll) return '';
    return payrollPanelFull(d);
  }

  /** The Xero states as chips. Verified is done; anything needing a person is "you". */
  function xeroStateClass(state) {
    if (state === 'SYNCED') return 'is-done';
    if (state === 'SYNC_IN_PROGRESS') return 'is-employee';
    if (['ADMIN_REVIEW', 'APPROVED_FOR_XERO', 'POSSIBLE_DUPLICATE', 'MANUAL_XERO_ACTION_REQUIRED', 'SYNC_FAILED_ACTION_REQUIRED', 'CHANGES_REQUESTED'].indexOf(state) >= 0) return 'is-you';
    if (state === 'SYNC_FAILED_RETRYABLE') return 'is-danger';
    return 'is-quiet';
  }

  function optionList(items, selectedId, labelFn) {
    return '<option value="">— choose —</option>' + (items || []).map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === selectedId ? ' selected' : '') + '>' + esc(labelFn ? labelFn(x) : x.name) + '</option>';
    }).join('');
  }

  /** The Owner's employment and pay configuration, edited in place. */
  function payrollConfigForm(d) {
    var X = d.payroll.xero; var c = X.config || X.defaultConfig || {}; var R = S.payrollRef;
    var locked = !X.can.configure;
    var f = function (label, id, value, opts) {
      opts = opts || {};
      return '<div class="oj-field"><label for="oj-px-' + id + '">' + esc(label) + '</label><input id="oj-px-' + id + '" type="' + (opts.type || 'text') + '" value="' + esc(value == null ? '' : value) + '"' + (opts.step ? ' step="' + opts.step + '"' : '') + (locked ? ' disabled' : '') + (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') + '>' + (opts.hint ? '<small>' + esc(opts.hint) + '</small>' : '') + '</div>';
    };
    var sel = function (label, id, options, hint) {
      return '<div class="oj-field"><label for="oj-px-' + id + '">' + esc(label) + '</label><select id="oj-px-' + id + '"' + (locked ? ' disabled' : '') + '>' + options + '</select>' + (hint ? '<small>' + esc(hint) + '</small>' : '') + '</div>';
    };
    var enumOpts = function (values, selected, labels) {
      return values.map(function (v) { return '<option value="' + v + '"' + (v === selected ? ' selected' : '') + '>' + esc(labels && labels[v] ? labels[v] : v) + '</option>'; }).join('');
    };
    var basisLabels = { FULLTIME: 'Full-time', PARTTIME: 'Part-time', CASUAL: 'Casual' };
    var scaleLabels = { REGULAR: 'Regular', SENIORORPENSIONER: 'Senior or pensioner', FOREIGN: 'Foreign resident', WORKINGHOLIDAYMAKER: 'Working holiday maker', ACTORSARTISTSENTERTAINERS: 'Actors, artists, entertainers', HORTICULTURISTORSHEARER: 'Horticulturist or shearer' };
    var xeroLists = R ? '' : '<div class="ob-note is-info">Xero lists (payroll calendars, earnings rates, leave types, super funds) have not been loaded. ' + (X.health && X.health.connected ? btn('Load from Xero', 'OnboardingJourney.loadPayrollReference()', 'oj-btn-small') : '<strong>The Xero payroll connection is not available.</strong>') + '</div>';
    var leaveRows = (c.leaveLines || []).map(function (l, i) {
      return '<tr><td>' + esc(l.leaveTypeName || l.leaveTypeId) + '</td><td>' + esc(l.calculationType) + '</td><td>' + esc(l.annualNumberOfUnits == null ? '' : l.annualNumberOfUnits) + '</td><td>' + esc(l.fullTimeNumberOfUnitsPerPeriod == null ? '' : l.fullTimeNumberOfUnitsPerPeriod) + '</td><td>' + (locked ? '' : '<button type="button" class="oj-link" onclick="OnboardingJourney.removePayrollLeave(' + i + ')">Remove</button>') + '</td></tr>';
    }).join('');
    return '<div class="oj-step" id="oj-payroll-config"><div class="oj-step-head"><span class="oj-step-n">1</span><strong>Employment and pay configuration</strong>' + (X.config ? '<span class="oj-chip is-done">Saved</span>' : '<span class="oj-chip is-you">Needs your input</span>') + '</div>'
      + '<p class="oj-quiet">Prefilled from the offer terms. Nothing here is inferred by the portal: you choose the Xero earnings rate, calendar, tax scale and leave lines, and approve the salary or rate.</p>'
      + xeroLists
      + '<div class="oj-form-grid">'
      + f('Employee number (optional)', 'employeeNumber', c.employeeNumber, { maxlength: 60 })
      + f('Job title', 'jobTitle', c.jobTitle, { maxlength: 150 })
      + sel('Employment basis', 'employmentBasis', enumOpts(['FULLTIME', 'PARTTIME', 'CASUAL'], c.employmentBasis, basisLabels))
      + sel('Income type', 'incomeType', enumOpts(['SALARYANDWAGES', 'WORKINGHOLIDAYMAKER'], c.incomeType, { SALARYANDWAGES: 'Salary and wages', WORKINGHOLIDAYMAKER: 'Working holiday maker' }))
      + sel('Pay basis', 'payBasis', enumOpts(['annual', 'hourly'], c.payBasis, { annual: 'Annual salary', hourly: 'Hourly rate' }))
      + f('Annual salary', 'annualSalary', c.annualSalary, { type: 'number', step: '0.01', hint: 'Salaried only' })
      + f('Hourly rate', 'hourlyRate', c.hourlyRate, { type: 'number', step: '0.01', hint: 'Hourly only' })
      + f('Ordinary hours per week', 'unitsPerWeek', c.unitsPerWeek, { type: 'number', step: '0.01', hint: 'Leave blank for casual as rostered' })
      + sel('Xero payroll calendar', 'payrollCalendarId', R ? optionList(R.calendars, c.payrollCalendarId, function (x) { return x.name + ' (' + x.calendarType + ')'; }) : '<option value="' + esc(c.payrollCalendarId || '') + '">' + esc(c.payrollCalendarName || (c.payrollCalendarId ? c.payrollCalendarId : 'load the Xero lists')) + '</option>', 'Opal normally pays fortnightly; the id is read from Xero, never typed.')
      + sel('Xero ordinary earnings rate', 'earningsRateId', R ? optionList(R.earningsRates, c.earningsRateId, function (x) { return x.name + (x.rateType ? ' · ' + x.rateType : ''); }) : '<option value="' + esc(c.earningsRateId || '') + '">' + esc(c.earningsRateName || (c.earningsRateId ? c.earningsRateId : 'load the Xero lists')) + '</option>')
      + sel('Tax scale type', 'taxScaleType', enumOpts(['REGULAR', 'SENIORORPENSIONER', 'FOREIGN', 'WORKINGHOLIDAYMAKER', 'ACTORSARTISTSENTERTAINERS', 'HORTICULTURISTORSHEARER'], c.taxScaleType, scaleLabels), 'Suggested from the residency the employee declared; confirm it.')
      + sel('TFN exemption (only if no TFN was given)', 'tfnExemptionType', '<option value="">— not applicable —</option>' + enumOpts(['NOTQUOTED', 'PENDING', 'PENSIONER', 'UNDER18'], c.tfnExemptionType))
      + f('Bank statement text', 'statementText', c.statementText || 'Opal Therapy wages', { maxlength: 18 })
      + f('Payroll email (optional)', 'payrollEmail', c.payrollEmail, { type: 'email', hint: 'Defaults to the personal email on the profile' })
      + f('Employee group (optional)', 'employeeGroupName', c.employeeGroupName, { maxlength: 100 })
      + f('Additional withholding per pay (optional)', 'upwardVariationTaxWithholdingAmount', c.upwardVariationTaxWithholdingAmount, { type: 'number', step: '0.01', hint: 'Only with the employee\'s written instruction' })
      + sel('Employer default super fund', 'defaultSuperFundId', R ? optionList(R.superFunds, c.defaultSuperFundId, function (x) { return x.name + ' (' + x.type + (x.usi ? ' · ' + x.usi : '') + ')'; }) : '<option value="' + esc(c.defaultSuperFundId || '') + '">' + esc(c.defaultSuperFundId || 'load the Xero lists') + '</option>', 'Used only when the employee chose the practice default fund.')
      + '<div class="oj-field"><label><input type="checkbox" id="oj-px-eligibleToReceiveLeaveLoading"' + (c.eligibleToReceiveLeaveLoading ? ' checked' : '') + (locked ? ' disabled' : '') + '> Eligible for leave loading</label></div>'
      + '</div>'
      + '<h4>Leave lines</h4><div class="oj-table-wrap"><table class="oj-pack"><thead><tr><th>Leave type</th><th>Calculation</th><th>Annual units</th><th>Full-time units per period</th><th></th></tr></thead><tbody>' + (leaveRows || '<tr><td colspan="5" class="oj-quiet">No leave lines. Casual employees normally have none.</td></tr>') + '</tbody></table></div>'
      + (locked || !R ? '' : '<div class="oj-form-grid oj-leave-add"><div class="oj-field"><label for="oj-px-leaveType">Add a leave type</label><select id="oj-px-leaveType">' + optionList(R.leaveTypes, null, function (x) { return x.name + (x.normalEntitlement ? ' · ' + x.normalEntitlement + ' ' + (x.typeOfUnits || 'units') + '/yr' : ''); }) + '</select></div><div class="oj-field"><label for="oj-px-leaveAnnual">Annual units</label><input id="oj-px-leaveAnnual" type="number" step="0.01"></div><div class="oj-field"><label for="oj-px-leavePeriod">Full-time units per period</label><input id="oj-px-leavePeriod" type="number" step="0.01"></div><div class="oj-field"><label>&nbsp;</label>' + btn('Add leave line', 'OnboardingJourney.addPayrollLeave()', 'oj-btn-small') + '</div></div>')
      + ((c.warnings || []).length ? '<div class="ob-note is-warn">' + esc(c.warnings.join(' ')) + '</div>' : '')
      + (locked ? '<p class="oj-quiet">Locked: the employee exists in Xero. Changes now happen in Xero and on the profile.</p>' : '<div class="oj-actions">' + btn('Save configuration', 'OnboardingJourney.savePayrollConfig()', 'oj-btn-primary') + '</div>')
      + '</div>';
  }

  /** The approved snapshot the Owner is sending: masked, never a secret. */
  function payrollSnapshotView(s) {
    if (!s) return '';
    var row = function (k, v) { return '<dt>' + esc(k) + '</dt><dd>' + esc(v == null || v === '' ? '—' : v) + '</dd>'; };
    var i = s.identity || {}; var a = i.address || {}; var e = s.employment || {}; var b = s.bank || {}; var t = s.tax || {}; var su = s.super || {};
    return '<dl class="oj-terms oj-snapshot">'
      + row('Legal name', [i.firstName, i.middleNames, i.lastName].filter(Boolean).join(' ')) + row('Date of birth', i.dateOfBirth) + row('Payroll email', i.email) + row('Mobile', i.mobile)
      + row('Home address', [a.line1, a.line2, a.city, a.region, a.postcode].filter(Boolean).join(', '))
      + row('Start date', e.startDate) + row('Employment basis', e.employmentBasis) + row('Income type', e.incomeType)
      + row('Pay', e.payBasis === 'annual' ? '$' + e.annualSalary + ' per annum · ' + e.unitsPerWeek + ' hrs/week' : '$' + e.hourlyRate + ' per hour' + (e.unitsPerWeek ? ' · ' + e.unitsPerWeek + ' hrs/week' : ''))
      + row('Earnings rate', e.earningsRateName || e.earningsRateId) + row('Payroll calendar', (e.payrollCalendarName || e.payrollCalendarId) + (e.calendarType ? ' (' + e.calendarType + ')' : ''))
      + row('Leave lines', (e.leaveLines || []).map(function (l) { return l.leaveTypeName || l.leaveTypeId; }).join(', ') || 'None')
      + row('Bank account', (b.accountName || '') + ' · BSB ' + (b.bsbMasked || '') + ' · ••••' + (b.accountLast4 || '') + ' · "' + (b.statementText || '') + '"')
      + row('Tax', (t.residencyStatus || '') + ' · scale ' + (t.taxScaleType || '') + ' · TFN ' + (t.tfnProvided ? '*** *** ' + (t.tfnLast3 || '') : 'exemption ' + (t.tfnExemptionType || '?')) + ' · tax-free threshold ' + (t.taxFreeThresholdClaimed ? 'claimed' : 'not claimed') + ' · study loan ' + (t.hasLoanOrStudentDebt ? 'yes' : 'no'))
      + row('Super', su.choice === 'employer_default' ? 'Employer default fund' : (su.fundName || '') + (su.usi ? ' · USI ' + su.usi : '') + (su.fundAbn ? ' · ABN ' + su.fundAbn : '') + (su.memberNumberMasked ? ' · member ' + su.memberNumberMasked : '') + (su.choice === 'smsf' ? ' · SMSF ' + (su.smsfEsa || '') + ' · BSB ' + (su.smsfBsbMasked || '') + ' ••••' + (su.smsfAccountLast4 || '') : ''))
      + '</dl>';
  }

  /** The Xero stage: state, health, actions, verification, manual actions. */
  function payrollXeroSection(d) {
    var X = d.payroll.xero; var H = X.health || {}; var can = X.can || {};
    var body = '<div class="oj-step" id="oj-payroll-xero"><div class="oj-step-head"><span class="oj-step-n">2</span><strong>Xero Payroll</strong><span class="oj-chip ' + xeroStateClass(X.state) + '">' + esc(X.label) + '</span></div>';
    body += '<p class="oj-quiet">Connection: ' + (!H.configured ? 'not configured — set XERO_PAYROLL_CLIENT_ID and XERO_PAYROLL_CLIENT_SECRET.' : H.connected ? 'connected to ' + esc(H.tenantName || 'Xero') + ' (tenant …' + esc(H.tenantIdSuffix || '') + ')' : 'not connected — ' + esc(H.reason || '')) + (H.configured && !H.syncEnabled ? ' · <strong>employee creation is switched off</strong> (ENABLE_XERO_PAYROLL_SYNC).' : '') + ' · ' + esc(X.apiVersion || '') + '</p>';
    if (X.reason) body += '<div class="ob-note ' + (X.state === 'SYNCED' ? 'is-info' : 'is-warn') + '">' + esc(X.reason) + '</div>';
    if (X.lastError) body += '<div class="ob-note is-warn"><strong>' + esc(X.lastError.code) + '</strong> at step ' + esc(X.lastStep || '?') + ': ' + esc(X.lastError.message) + (X.validationMessages && X.validationMessages.length ? '<ul>' + X.validationMessages.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>' : '') + (X.retryAfter ? '<div class="oj-quiet">Retry after ' + esc(fmtDateTime(X.retryAfter)) + '</div>' : '') + '</div>';
    if (X.duplicateCandidates && X.state === 'POSSIBLE_DUPLICATE') {
      body += '<div class="ob-note is-warn"><strong>Possible duplicate.</strong> Nothing was created. Decide which is right:<ul>' + X.duplicateCandidates.map(function (c) {
        return '<li>' + esc(c.name) + (c.status ? ' (' + esc(c.status) + ')' : '') + (c.startDate ? ' · started ' + esc(c.startDate) : '') + ' — ' + esc(c.reasons.join(', ')) + ' ' + btn('Link this employee', 'OnboardingJourney.resolvePayrollDuplicate(\'link_existing\', \'' + jsq(c.employeeId) + '\')', 'oj-btn-small') + '</li>';
      }).join('') + '</ul><div class="oj-actions">' + btn('None of these — create a new employee', 'OnboardingJourney.resolvePayrollDuplicate(\'create_new\')', 'oj-btn-small') + '</div></div>';
    }
    if (X.snapshot) body += '<details class="oj-details"><summary>Approved set (version ' + esc(X.snapshotVersion) + ', ' + esc(fmtDateTime(X.approvedAt)) + ')</summary>' + payrollSnapshotView(X.snapshot) + '</details>';
    if (X.xeroEmployeeId) body += '<p class="oj-quiet">Xero EmployeeID ' + esc(X.xeroEmployeeId) + (X.syncedAt ? ' · verified ' + esc(fmtDateTime(X.syncedAt)) : '') + (X.lastRecheckAt ? ' · last checked ' + esc(fmtDateTime(X.lastRecheckAt)) : '') + ' · attempts ' + esc(X.attempts) + '</p>';
    if (X.verification && X.verification.checks) {
      body += '<ul class="oj-checks">' + X.verification.checks.map(function (k) { return '<li><span>' + esc(k.label) + '</span><span class="oj-chip ' + (k.ok ? 'is-done' : k.key === 'stp2' ? 'is-quiet' : 'is-danger') + '">' + esc(k.ok ? 'Verified' : (k.detail || 'Mismatch')) + '</span></li>'; }).join('') + '</ul>';
    }
    if (X.state === 'SYNCED' || X.nextPayRun.state !== 'UNKNOWN') body += '<p><strong>Next pay run:</strong> <span class="oj-chip ' + (X.nextPayRun.state === 'READY_FOR_NEXT_PAY_RUN' || X.nextPayRun.state === 'INCLUDED_IN_DRAFT' ? 'is-done' : 'is-you') + '">' + esc(X.nextPayRun.label) + '</span></p>';
    var open = (X.manualActions || []).filter(function (a) { return !a.completedAt; });
    var done = (X.manualActions || []).filter(function (a) { return a.completedAt; });
    if (open.length) body += '<div class="ob-note is-warn"><strong>To do in Xero:</strong><ul>' + open.map(function (a) { return '<li>' + esc(a.text) + ' ' + btn('Mark manual action complete', 'OnboardingJourney.completePayrollAction(\'' + jsq(a.code) + '\')', 'oj-btn-small') + '</li>'; }).join('') + '</ul></div>';
    if (done.length) body += '<p class="oj-quiet">Done in Xero: ' + esc(done.map(function (a) { return a.code.replace(/_/g, ' '); }).join(', ')) + '</p>';
    var acts = '';
    if (can.requestChanges) acts += btn('Request changes', 'OnboardingJourney.requestPayrollChanges()', 'oj-btn-quiet');
    if (can.approve) acts += btn('Approve for Xero', 'OnboardingJourney.approvePayrollSetup()', 'oj-btn-primary');
    if (can.sync) acts += btn(X.attempts > 0 ? 'Retry sync' : 'Sync to Xero', 'OnboardingJourney.syncPayroll(' + (X.attempts > 0 ? 'true' : 'false') + ')', 'oj-btn-primary');
    if (can.recheck) acts += btn('Recheck Xero', 'OnboardingJourney.recheckPayroll()');
    if (acts) body += '<div class="oj-actions">' + acts + '</div>';
    if (X.privacyNotice) body += '<p class="oj-quiet">Privacy notice: ' + (X.privacyNotice.acceptedAt ? 'accepted ' + esc(fmtDateTime(X.privacyNotice.acceptedAt)) + ' (version ' + esc(X.privacyNotice.version) + ')' : 'not yet recorded — the employee accepts it when saving their bank, tax or super details') + '</p>';
    if (X.operations && X.operations.length) body += '<details class="oj-details"><summary>Xero requests (' + X.operations.length + ')</summary><ul class="oj-quiet">' + X.operations.map(function (o) { return '<li>' + esc(fmtDateTime(o.started_at)) + ' · ' + esc(o.method) + ' ' + esc(o.resource) + ' · ' + esc(o.step) + ' · ' + esc(o.outcome) + (o.http_status ? ' (' + esc(o.http_status) + ')' : '') + (o.error_code ? ' · ' + esc(o.error_code) : '') + '</li>'; }).join('') + '</ul></details>';
    return body + '</div>';
  }

  function payrollPanelFull(d) {
    var P = d.payroll;
    if (!P) return '';
    var X = P.xero;
    var state = X && X.state === 'SYNCED' ? 'complete' : (P.approved || P.ready) ? 'active' : 'parallel';
    var cls = function (x) { return x === 'ready' ? 'is-done' : x === 'conflict' ? 'is-danger' : x === 'review' ? 'is-you' : 'is-quiet'; };
    var lbl = { ready: 'Ready', missing: 'Missing', conflict: 'Conflict', review: 'Needs confirmation' };
    var body = '<div class="oj-table-wrap"><table class="oj-pack oj-payroll"><tbody>' + P.rows.map(function (r) {
      return '<tr><th scope="row">' + esc(r.label) + '</th><td>' + (r.value ? esc(r.value) : '<span class="oj-quiet">—</span>') + '</td><td><span class="oj-chip ' + cls(r.status) + '">' + esc(lbl[r.status] || r.status) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
    if (P.approved) body += '<p class="oj-quiet">Approved ' + esc(fmtDateTime(P.approvedAt)) + (P.approvedByName ? ' by ' + esc(P.approvedByName) : '') + '.</p>';
    else if (!P.ready) body += '<div class="ob-note is-warn"><strong>Payroll cannot proceed yet.</strong> ' + esc(P.blockers.join(' · ')) + '. Resolve these in Requires Your Attention or wait for the documents.</div>';
    if (X) body += payrollConfigForm(d) + payrollXeroSection(d);
    else body += '<p class="oj-quiet">' + esc(P.integration.note) + '</p>';
    var chip = X && X.state !== 'NOT_STARTED' ? '<span class="oj-chip ' + xeroStateClass(X.state) + '">' + esc(X.label) + '</span>' : '<span class="oj-chip ' + (P.approved ? 'is-done' : P.ready ? 'is-you' : 'is-quiet') + '">' + esc(P.label) + '</span>';
    return '<section class="oj-panel oj-stage is-' + esc(state) + '" id="oj-payroll"><header><h2><span class="oj-stage-n">$</span>Payroll &amp; Xero Setup</h2>' + chip + '</header>'
      + '<p class="oj-stage-summary">' + P.readyCount + ' of ' + P.total + ' lines ready. Everything here was gathered during onboarding; confirm it rather than typing it again.</p>' + body + '</section>';
  }

  // ── Payroll & Xero actions ───────────────────────────────────────────────
  function payrollConfigFromForm() {
    var v = function (id) { var el = doc.getElementById('oj-px-' + id); return el ? el.value : null; };
    var num = function (id) { var x = v(id); return x === '' || x == null ? null : Number(x); };
    var cb = doc.getElementById('oj-px-eligibleToReceiveLeaveLoading');
    var current = (S.record && S.record.payroll && S.record.payroll.xero && (S.record.payroll.xero.config || S.record.payroll.xero.defaultConfig)) || {};
    var R = S.payrollRef;
    var pick = function (list, id) { return (list || []).filter(function (x) { return x.id === id; })[0]; };
    var cal = R && pick(R.calendars, v('payrollCalendarId')); var er = R && pick(R.earningsRates, v('earningsRateId'));
    return {
      employeeNumber: v('employeeNumber'), jobTitle: v('jobTitle'), employmentBasis: v('employmentBasis'), employmentType: 'EMPLOYEE', incomeType: v('incomeType'),
      payBasis: v('payBasis'), annualSalary: num('annualSalary'), hourlyRate: num('hourlyRate'), unitsPerWeek: num('unitsPerWeek'),
      payrollCalendarId: v('payrollCalendarId'), payrollCalendarName: cal ? cal.name : current.payrollCalendarName, calendarType: cal ? cal.calendarType : current.calendarType,
      earningsRateId: v('earningsRateId'), earningsRateName: er ? er.name : current.earningsRateName,
      taxScaleType: v('taxScaleType'), tfnExemptionType: v('tfnExemptionType') || null, statementText: v('statementText'), payrollEmail: v('payrollEmail') || null,
      employeeGroupName: v('employeeGroupName') || null, upwardVariationTaxWithholdingAmount: num('upwardVariationTaxWithholdingAmount'),
      defaultSuperFundId: v('defaultSuperFundId') || null, eligibleToReceiveLeaveLoading: !!(cb && cb.checked),
      leaveLines: S.payrollLeave || current.leaveLines || [],
    };
  }
  async function loadPayrollReference() {
    var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + '/payroll-setup/xero/reference');
    if (!res.ok) { toast(res.error, true); return; }
    S.payrollRef = res.reference;
    rerender();
  }
  function addPayrollLeave() {
    var R = S.payrollRef; if (!R) return;
    var id = doc.getElementById('oj-px-leaveType').value; if (!id) return;
    var lt = R.leaveTypes.filter(function (x) { return x.id === id; })[0];
    var annual = doc.getElementById('oj-px-leaveAnnual').value; var period = doc.getElementById('oj-px-leavePeriod').value;
    var current = payrollConfigFromForm();
    S.payrollLeave = (current.leaveLines || []).concat([{ leaveTypeId: id, leaveTypeName: lt ? lt.name : id, calculationType: 'BASEDONORDINARYEARNINGS', annualNumberOfUnits: annual === '' ? null : Number(annual), fullTimeNumberOfUnitsPerPeriod: period === '' ? null : Number(period) }]);
    S.payrollDraft = current; S.payrollDraft.leaveLines = S.payrollLeave;
    S.record.payroll.xero.config = S.record.payroll.xero.config ? S.payrollDraft : null;
    S.record.payroll.xero.defaultConfig = S.payrollDraft;
    rerender();
  }
  function removePayrollLeave(i) {
    var current = payrollConfigFromForm();
    S.payrollLeave = (current.leaveLines || []).filter(function (_, k) { return k !== i; });
    current.leaveLines = S.payrollLeave;
    if (S.record.payroll.xero.config) S.record.payroll.xero.config = current; else S.record.payroll.xero.defaultConfig = current;
    rerender();
  }
  async function savePayrollConfig() {
    var body = payrollConfigFromForm();
    S.payrollLeave = null;
    var res = await returnsAct('/payroll-setup/config', body, 'Configuration saved.', 'PUT');
    if (res && !res.ok && res.errors) toast(res.errors.join(' · '), true);
  }
  async function requestPayrollChanges() {
    var reason = window.prompt('What should the employee change? They will see this message.');
    if (!reason || !reason.trim()) return;
    return returnsAct('/payroll-setup/request-changes', { reason: reason.trim() }, 'Changes requested; the payroll forms are open for the employee again.');
  }
  async function syncPayroll(retry) {
    if (!await portalConfirm(retry ? 'Retry the Xero sync? The same operation continues from where it stopped; nothing is created twice.' : 'Create this employee in Xero Payroll now? Their tax file number and bank details are sent to Xero over the server connection and this action is recorded.')) return;
    toast('Talking to Xero…');
    return returnsAct(retry ? '/payroll-setup/retry' : '/payroll-setup/sync', {}, function (res) { var x = res.payroll && res.payroll.xero; return x ? x.label + (x.nextPayRun && x.nextPayRun.state !== 'UNKNOWN' ? ' · ' + x.nextPayRun.label : '') : 'Done.'; });
  }
  function recheckPayroll() { return returnsAct('/payroll-setup/recheck', {}, function (res) { var x = res.payroll && res.payroll.xero; return x ? 'Rechecked: ' + x.label + ' · ' + x.nextPayRun.label : 'Rechecked.'; }); }
  async function resolvePayrollDuplicate(resolution, employeeId) {
    if (!await portalConfirm(resolution === 'link_existing' ? 'Link the onboarding record to this existing Xero employee? Their Xero record will be updated with the approved set.' : 'Create a new employee even though a similar one exists in Xero?', { danger: resolution === 'create_new' })) return;
    return returnsAct('/payroll-setup/resolve-duplicate', { resolution: resolution, employeeId: employeeId || null }, 'Recorded. You can sync now.');
  }
  function completePayrollAction(code) { return returnsAct('/payroll-setup/manual-actions/' + encodeURIComponent(code) + '/complete', {}, 'Recorded.'); }

  /**
   * Readiness as a checklist: one row per check, its reasons folded beneath
   * it, so the eye reads "what is done, what is left" rather than a wall of red.
   */
  function readinessBlock(R) {
    var checks = R.checks || [];
    var gating = checks.filter(function (k) { return !k.advisory; });
    var readyCount = gating.filter(function (k) { return k.state === 'ready'; }).length;
    var head = R.ready
      ? '<h3>Ready to send</h3><p class="oj-quiet">Everything the induction pack needs is in place.</p>'
      : '<h3>Before the induction pack can go</h3><p class="oj-quiet">' + readyCount + ' of ' + gating.length + ' ready. Each item below says what is still to happen.</p>';
    var rows = checks.map(function (k) {
      var ok = k.state === 'ready';
      var cls = ok ? 'is-ready' : k.state === 'in_progress' ? 'is-progress' : 'is-open';
      var items = (k.items || []).filter(function (x) { return !ok; });
      // The chip carries the count; the reasons say which ones, so a count-only chip is not repeated.
      var chip = ok ? 'Ready' : items.length ? (items.length + ' to go') : k.detail;
      return '<li class="oj-rdy ' + cls + '"><div class="oj-rdy-head"><span class="oj-rdy-mark" aria-hidden="true">' + (ok ? '✓' : k.state === 'in_progress' ? '…' : '') + '</span>'
        + '<span class="oj-rdy-label">' + esc(k.label) + (k.advisory ? ' <span class="oj-quiet">(shown, not a gate)</span>' : '') + '</span>'
        + '<span class="oj-chip ' + (ok ? 'is-done' : k.state === 'in_progress' ? 'is-employee' : 'is-quiet') + '">' + esc(chip) + '</span></div>'
        + (items.length ? '<ul class="oj-rdy-items">' + items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '')
        + '</li>';
    }).join('');
    return '<div class="oj-ready' + (R.ready ? ' is-ready' : '') + '">' + head + '<ol class="oj-rdy-list">' + rows + '</ol></div>';
  }

  /** Phase 3 — readiness, the induction pack, Email 3, tracking. */
  function phase3Panel(d) {
    var I = d.induction;
    if (!I) return '';
    var R = I.readiness || { ready: false, checks: [], blockers: [] };
    var c = I.can || d.can; var E = I.email || {}; var sent = I.sent;
    var state = I.tracking && I.tracking.total && I.tracking.done === I.tracking.total && sent ? 'complete' : sent ? 'active' : R.ready ? 'active' : 'parallel';
    var body = '';
    body += readinessBlock(R);
    if (sent) {
      body += '<div class="oj-sent-banner"><strong>Internal Induction Sent</strong><span>Due: ' + esc(fmtDate(E.dueAt)) + '</span><span class="oj-quiet">sent ' + esc(fmtDateTime(E.sentAt)) + (I.tracking ? ' · ' + I.tracking.done + ' of ' + I.tracking.total + ' induction items complete' : '') + '</span></div>';
    }
    body += packTable(d, I, 'induction');
    if (!sent && c.assign) {
      body += '<div class="oj-step is-active" id="oj-induction-email"><div class="oj-step-head"><span class="oj-step-n">✉</span><strong>Phase 3 email — to ' + esc(d.record.applicantEmail || '') + '</strong>' + (E.draftId ? '<span class="oj-chip is-you">Draft in Outlook</span>' : '') + '</div>'
        + '<div class="oj-field"><label for="oj-ie-subject">Subject</label><input id="oj-ie-subject" type="text" maxlength="250" value="' + esc(E.subject || '') + '"></div>'
        + '<div class="oj-field"><label for="oj-ie-body">Message</label>' + emailToolbar('oj-ie-body') + '<textarea id="oj-ie-body" rows="14" onkeydown="OnboardingJourney.emailKey(event)">' + esc(E.body || '') + '</textarea></div>'
        + '<div class="oj-actions">' + (E.outlook && !E.outlook.available ? btn('Open in my mail app — with the ZIP downloaded', 'OnboardingJourney.openInMailApp(\'ie\', \'/api/onboarding/journey/records/' + jsq(d.record.id) + '/induction/zip\')', R.ready ? 'oj-btn-primary' : '') : '') + btn(E.draftId ? 'Prepare a fresh Outlook draft' : 'Prepare Phase 3 Email — create the Outlook draft with the pack attached', 'OnboardingJourney.packCreateDraft(\'induction\')', R.ready && !(E.outlook && !E.outlook.available) ? 'oj-btn-primary' : '') + btn('Save the wording', 'OnboardingJourney.packSaveEmail(\'induction\')') + btn('Reset to the template', 'OnboardingJourney.packResetEmail(\'induction\')', 'oj-btn-quiet') + '<a class="oj-btn" href="/api/onboarding/journey/records/' + esc(d.record.id) + '/induction/zip">Download the ZIP</a></div>'
        + (E.draftId ? '<div class="ob-note is-info"><strong>Your draft is in Outlook.</strong> Read it over and press Send there, then mark it as sent.<div class="oj-actions">' + (E.webLink ? '<a class="oj-btn oj-btn-primary" href="' + esc(E.webLink) + '" target="_blank" rel="noopener">Open the draft in Outlook</a>' : '') + btn('I have sent it — mark as sent', 'OnboardingJourney.packMarkSent(\'induction\')', 'oj-btn-primary') + '</div></div>'
          : '<div class="oj-actions oj-actions-sent">' + btn('Mark as sent — I sent it another way', 'OnboardingJourney.packMarkSent(\'induction\')') + '</div>')
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

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE LETTER'S WORDING — edit any paragraph; save makes it the standard
  // ═══════════════════════════════════════════════════════════════════════════

  var LT = { data: null, lastFocus: null, range: null };

  function templateChipText(t) {
    if (!t || t.source !== 'practice') return 'Generated from the template';
    return 'Your wording, v' + t.version;
  }

  /**
   * The editor is a carbon copy of the preview: the letter drawn as a page,
   * in the template's own type, and every paragraph edited in place the way
   * a Word document is. The portal-filled controls are chips — they can be
   * moved or deleted as a whole but their wording is not typed over.
   */
  var LT_KIND = {
    OPALDocumentTitle: 'title', OPALSubtitle: 'subtitle', OPALHeading1: 'h1', OPALHeading2: 'h2', OPALHeading3: 'h3',
    OPALHeading4: 'h4', OPALTableHeader: 'th', OPALTableBody: 'td', OPALBullet: 'bullet', OPALBullet2: 'bullet2',
    OPALNumberedList: 'num', OPALNumberedList2: 'num2', OPALCaption: 'caption',
  };

  /** Segments → the HTML inside one editable block: text with line breaks, controls as chips. */
  function segmentsToHtml(segs, labels) {
    return (segs || []).map(function (s) {
      if (s.type === 'tag') return '<span class="oj-lt-tag" contenteditable="false" data-tag="' + esc(s.tag) + '" title="Filled in by the portal for each person">' + esc(labels[s.tag] || s.tag) + '</span>';
      return esc(s.text).replace(/\n/g, '<br>');
    }).join('');
  }

  /** One editable block's DOM → segments. Chips become tags, <br> and nested blocks become line breaks. */
  function blockToSegments(el) {
    var out = [];
    var push = function (text) {
      if (!text) return;
      if (out.length && out[out.length - 1].type === 'text') out[out.length - 1].text += text;
      else out.push({ type: 'text', text: text });
    };
    var walk = function (node, first) {
      if (node.nodeType === 3) { push(node.nodeValue.replace(/\u00a0/g, ' ')); return; }
      if (node.nodeType !== 1) return;
      if (node.classList && node.classList.contains('oj-lt-tag')) { out.push({ type: 'tag', tag: node.getAttribute('data-tag') }); return; }
      if (node.nodeName === 'BR') { push('\n'); return; }
      var block = /^(DIV|P)$/.test(node.nodeName);
      if (block && !first) push('\n');
      for (var c = node.firstChild, i = 0; c; c = c.nextSibling, i++) walk(c, i === 0 && (first || !block));
    };
    for (var c = el.firstChild, i = 0; c; c = c.nextSibling, i++) walk(c, i === 0);
    return out;
  }

  function normaliseSegments(segs) {
    var out = [];
    (segs || []).forEach(function (s) {
      if (s.type === 'tag') { out.push({ type: 'tag', tag: s.tag }); return; }
      var t = String(s.text || '');
      if (!t) return;
      if (out.length && out[out.length - 1].type === 'text') out[out.length - 1].text += t;
      else out.push({ type: 'text', text: t });
    });
    return out;
  }

  async function openLetterEditor() {
    if (!global.Onboarding || typeof global.Onboarding.openModal !== 'function') return;
    var res = await api('/api/onboarding/journey/offer-template');
    if (!res.ok) { toast(res.error, true); return; }
    LT.data = res; LT.lastFocus = null; LT.range = null;
    var labels = {}; res.tags.forEach(function (t) { labels[t.tag] = t.label; });
    var t = res.template;
    var TH = 'OPALTableHeader', TD = 'OPALTableBody';
    var paras = res.paragraphs;
    var block = function (p, tagName, extraCls) {
      var kind = LT_KIND[p.style] || 'body';
      return '<' + tagName + ' class="oj-lt-block is-' + kind + (extraCls ? ' ' + extraCls : '') + '" contenteditable="true" spellcheck="true"'
        + ' id="oj-lt-' + p.index + '" data-index="' + p.index + '"'
        + (p.style === TD ? ' data-placeholder="Left blank in the letter"' : '')
        + ' onfocus="OnboardingJourney.letterFocus(this)" onkeyup="OnboardingJourney.letterCaret(this)" onmouseup="OnboardingJourney.letterCaret(this)"'
        + ' onkeydown="OnboardingJourney.letterKey(event)" onpaste="OnboardingJourney.letterPaste(event)">'
        + segmentsToHtml(p.segments, labels) + '</' + tagName + '>';
    };
    var rows = ''; var i = 0;
    while (i < paras.length) {
      var p = paras[i];
      if (p.style === TH) {
        // A table: label / value pairs until the labels stop.
        rows += '<div class="oj-lt-table" role="table">';
        while (i < paras.length && paras[i].style === TH) {
          var label = paras[i]; var value = paras[i + 1] && paras[i + 1].style === TD ? paras[i + 1] : null;
          rows += '<div class="oj-lt-row" role="row">' + block(label, 'div', 'is-cell') + (value ? block(value, 'div', 'is-cell') : '<div class="oj-lt-td-empty"></div>') + '</div>';
          i += value ? 2 : 1;
        }
        rows += '</div>';
        continue;
      }
      rows += block(p, 'div');
      i += 1;
    }
    var fields = res.tags.map(function (x) { return '<option value="' + esc(x.tag) + '">' + esc(x.label) + '</option>'; }).join('');
    global.Onboarding.openModal({
      title: 'Edit the Letter of Offer',
      subtitle: 'The letter as the employee sees it. Click into any line and type, as in Word. Save makes it the standard letter for every offer from now on.',
      wide: true,
      body: '<div class="oj-lt">'
        + '<div class="oj-lt-bar"><span class="oj-chip ' + (t.source === 'practice' ? 'is-you' : 'is-quiet') + '">' + esc(t.source === 'practice' ? 'Your wording, v' + t.version + (t.savedByName ? ' · saved by ' + t.savedByName : '') : 'The original letter') + '</span>'
        + '<label class="oj-lt-insert">Insert a field <select onchange="OnboardingJourney.letterInsert(this)"><option value="">Choose…</option>' + fields + '</select></label></div>'
        + '<p class="oj-lt-help">The <span class="oj-lt-tag is-demo">highlighted fields</span> are filled in by the portal for each person — the candidate\'s name, the salary, the dates. Move or delete them like a word; the text around them is yours to change.</p>'
        + '<div class="oj-lt-sheet"><div class="oj-lt-page is-doc">'
        + '<div class="oj-lt-header" aria-hidden="true"><span>OPAL THERAPY</span><span>Letter of Offer</span><span>' + esc(labels.OPAL_LOO_CANDIDATE_FULL_NAME || 'Candidate full name') + '</span></div>'
        + rows
        + '<div class="oj-lt-footer" aria-hidden="true"><span>Opal Therapy | Confidential</span><span>Page 1</span></div>'
        + '</div></div>'
        + '<div id="oj-lt-error" class="ob-note is-danger" role="alert" hidden></div>'
        + '</div>',
      footer: '<div class="oj-actions oj-actions-tight">'
        + btn('Save as the standard letter', 'OnboardingJourney.saveLetterEditor()', 'oj-btn-primary')
        + btn('Cancel', 'Onboarding.closeModal()')
        + (t.source === 'practice' ? btn('Restore the original letter', 'OnboardingJourney.resetLetterTemplate()', 'oj-btn-quiet') : '')
        + '</div>',
    });
  }

  function letterFocus(el) { LT.lastFocus = el; letterCaret(el); }
  /** Remember where the caret is, so Insert a field can put the chip there after the select steals focus. */
  function letterCaret(el) {
    var sel = global.getSelection && global.getSelection();
    if (!sel || !sel.rangeCount) return;
    var r = sel.getRangeAt(0);
    if (el.contains(r.commonAncestorContainer)) LT.range = r.cloneRange();
  }
  /** Enter is a line break within the paragraph — the paragraphs themselves are the letter's, not added here. */
  function letterKey(ev) {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (!doc.execCommand('insertLineBreak')) doc.execCommand('insertHTML', false, '<br>');
  }
  /** Pasted text arrives as words, never as someone else's formatting. */
  function letterPaste(ev) {
    ev.preventDefault();
    var text = (ev.clipboardData || global.clipboardData).getData('text/plain');
    if (text) doc.execCommand('insertText', false, text);
  }
  function letterInsert(sel) {
    var tag = sel.value; sel.value = '';
    var ta = LT.lastFocus; if (!tag || !ta || !doc.body.contains(ta)) return;
    var labels = {}; (LT.data && LT.data.tags || []).forEach(function (t) { labels[t.tag] = t.label; });
    var chip = doc.createElement('span');
    chip.className = 'oj-lt-tag'; chip.setAttribute('contenteditable', 'false'); chip.setAttribute('data-tag', tag);
    chip.title = 'Filled in by the portal for each person'; chip.textContent = labels[tag] || tag;
    var r = LT.range && ta.contains(LT.range.commonAncestorContainer) ? LT.range : null;
    if (r) { r.deleteContents(); r.insertNode(chip); } else ta.appendChild(chip);
    // Put the caret just after the chip so typing carries on.
    var after = doc.createRange(); after.setStartAfter(chip); after.collapse(true);
    var s = global.getSelection(); s.removeAllRanges(); s.addRange(after);
    LT.range = after.cloneRange(); ta.focus();
  }

  async function saveLetterEditor() {
    var d = LT.data; if (!d) return;
    var original = {}; d.paragraphs.forEach(function (p) { original[p.index] = normaliseSegments(p.segments); });
    var endsWithBreak = function (segs) { var l = segs[segs.length - 1]; return !!l && l.type === 'text' && /\n$/.test(l.text); };
    var edits = [];
    var blocks = doc.querySelectorAll('.oj-lt .oj-lt-block');
    for (var i = 0; i < blocks.length; i++) {
      var el = blocks[i]; var index = Number(el.getAttribute('data-index'));
      var segs = normaliseSegments(blockToSegments(el));
      // The browser leaves a trailing line break behind after editing; it is not a change.
      if (endsWithBreak(segs) && !endsWithBreak(original[index] || [])) {
        var last = segs[segs.length - 1];
        last.text = last.text.replace(/\n$/, ''); if (!last.text) segs.pop();
      }
      if (JSON.stringify(segs) === JSON.stringify(original[index] || [])) continue;
      edits.push({ index: index, segments: segs });
    }
    var errEl = doc.getElementById('oj-lt-error');
    if (!edits.length) { global.Onboarding.closeModal(); toast('Nothing changed.'); return; }
    var res = await api('/api/onboarding/journey/offer-template', { method: 'PUT', body: { paragraphs: edits } });
    if (!res.ok) { if (errEl) { errEl.textContent = res.error; errEl.hidden = false; errEl.scrollIntoView({ block: 'nearest' }); } return; }
    global.Onboarding.closeModal();
    toast('Saved. This wording is now the standard letter — v' + res.template.version + '.');
    rerender();
  }

  async function resetLetterTemplate() {
    if (!await portalConfirm('Go back to the original letter? Your edited wording is kept in the history but no longer used.', { danger: true })) return;
    var res = await api('/api/onboarding/journey/offer-template/reset', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    global.Onboarding.closeModal();
    toast('The original letter is the standard again.');
    rerender();
  }

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

  /** The file behind an upload: a File dropped on a row, or the input's first file. */
  function fileFrom(input) {
    if (!input) return null;
    if (typeof File !== 'undefined' && input instanceof File) return input;
    return input.files && input.files[0];
  }

  // ── Drag and drop: a file dropped on a pack row attaches to that item ─────

  var DROP_ARMED = false;
  function armDropzones() {
    if (DROP_ARMED) return; DROP_ARMED = true;
    var over = function (ev) {
      var row = ev.target.closest && ev.target.closest('[data-drop]');
      if (!row || !ev.dataTransfer || Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') < 0) return;
      ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy';
      row.classList.add('is-dragover');
    };
    doc.addEventListener('dragover', over);
    doc.addEventListener('dragenter', over);
    // A file let go anywhere else on the page must not open in the browser and lose the record.
    doc.addEventListener('dragover', function (ev) { if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0) ev.preventDefault(); });
    doc.addEventListener('drop', function (ev) { if (ev.dataTransfer && Array.prototype.indexOf.call(ev.dataTransfer.types || [], 'Files') >= 0 && !(ev.target.closest && ev.target.closest('[data-drop]'))) { ev.preventDefault(); toast('Drop the file on a document\'s row or a section heading.', true); } });
    doc.addEventListener('dragleave', function (ev) {
      var row = ev.target.closest && ev.target.closest('[data-drop]');
      if (row && !row.contains(ev.relatedTarget)) row.classList.remove('is-dragover');
    });
    doc.addEventListener('drop', function (ev) {
      var row = ev.target.closest && ev.target.closest('[data-drop]');
      if (!row) return;
      ev.preventDefault(); row.classList.remove('is-dragover');
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (!files || !files.length) return;
      var spec = row.getAttribute('data-drop').split(':');
      if (spec[0] === 'pack') packDropFiles(spec[1], files);
      else if (spec[0] === 'defaults') defaultsUpload(spec[1], spec[2], files[0]);
      else if (spec[0] === 'returns') uploadReturns({ files: files, value: '' });
      else if (spec[0] === 'section') packAttachToSection(spec[1], spec[2], files);

    });
  }

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
  async function uploadSigned(input, accepted) {
    if (accepted && input && input.files && input.files[0]) {
      if (!await portalConfirm('Replace the signed letter? The offer stays accepted; the new letter and what the portal reads from it supersede the previous one.', { danger: true })) { input.value = ''; return; }
    }
    return refreshRecordAfter(uploadTo(input, '/offer/signed', 'Signed letter'));
  }
  async function discardLetter() {
    if (!await portalConfirm('Discard the uploaded edit and go back to the generated letter?', { danger: true })) return;
    return act('/offer/letter', {}, 'Using the generated letter again.', 'DELETE');
  }

  /**
   * Without Outlook drafts (Graph), the next best thing: the attachment is
   * downloaded and the laptop's own mail app opens with recipient, subject and
   * message filled in. A browser cannot attach a file to a mailto: message,
   * so the downloaded file is dragged in — the note beside the button says so.
   */
  function openInMailApp(prefix, attachmentUrl) {
    var r = S.record && S.record.record; if (!r) return;
    var sub = doc.getElementById('oj-' + prefix + '-subject'); var body = doc.getElementById('oj-' + prefix + '-body');
    var subject = sub ? sub.value.trim() : ''; var text = body ? stripEmailMarks(body.value) : '';
    if (attachmentUrl) {
      var a = doc.createElement('a'); a.href = attachmentUrl; a.download = ''; a.style.display = 'none';
      doc.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 1000);
    }
    var href = 'mailto:' + encodeURIComponent(r.applicantEmail || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text);
    setTimeout(function () { global.location.href = href; }, attachmentUrl ? 400 : 0);
    toast(attachmentUrl ? 'Your mail app is opening — attach the file that just downloaded, then send.' : 'Your mail app is opening.');
  }

  /**
   * The three emails are plain text with light marks — **bold**, *italic*,
   * __underline__ — rendered when the Outlook draft is made. The toolbar
   * wraps (or unwraps) whatever is selected in the textarea.
   */
  function stripEmailMarks(text) {
    return String(text || '').replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '$1').replace(/__(?=\S)([\s\S]*?\S)__/g, '$1').replace(/(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, '$1$2');
  }
  function emailToolbar(textareaId) {
    var b = function (mark, label, title, cls) {
      return '<button type="button" class="oj-fmt-btn ' + cls + '" title="' + title + '" aria-label="' + title + '" onmousedown="event.preventDefault()" onclick="OnboardingJourney.emailMark(\'' + textareaId + '\', \'' + mark + '\')">' + label + '</button>';
    };
    return '<div class="oj-fmt-bar" role="toolbar" aria-label="Formatting">' + b('**', 'B', 'Bold (Ctrl+B)', 'is-b') + b('*', 'I', 'Italic (Ctrl+I)', 'is-i') + b('__', 'U', 'Underline (Ctrl+U)', 'is-u')
      + '</div>';
  }
  function emailMark(textareaId, mark) {
    var ta = doc.getElementById(textareaId); if (!ta) return;
    var a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
    var sel = v.slice(a, b);
    // Trim the selection to the words, so the mark never wraps a space.
    var lead = (/^\s*/.exec(sel) || [''])[0].length, trail = (/\s*$/.exec(sel) || [''])[0].length;
    if (sel.trim()) { a += lead; b -= trail; sel = v.slice(a, b); }
    var n = mark.length; var next, ca, cb;
    if (sel.length >= 2 * n && sel.slice(0, n) === mark && sel.slice(-n) === mark) {
      next = sel.slice(n, -n); ca = a; cb = a + next.length;                                       // unwrap inside
    } else if (v.slice(a - n, a) === mark && v.slice(b, b + n) === mark) {
      next = sel; a -= n; b += n; ca = a; cb = a + next.length;                                      // unwrap around
    } else {
      next = mark + sel + mark; ca = sel ? a : a + n; cb = sel ? a + next.length : a + n;            // wrap; empty → caret between marks
    }
    ta.focus();
    if (typeof ta.setRangeText === 'function') ta.setRangeText(next, a, b, 'preserve');
    else ta.value = v.slice(0, a) + next + v.slice(b);
    ta.selectionStart = ca; ta.selectionEnd = cb;
  }
  /** Ctrl/Cmd+B, I, U inside an email textarea. */
  function emailKey(ev) {
    if (!(ev.ctrlKey || ev.metaKey) || ev.altKey) return;
    var mark = { b: '**', i: '*', u: '__' }[ev.key.toLowerCase()];
    if (!mark) return;
    ev.preventDefault(); emailMark(ev.target.id, mark);
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
    var Sg = S.record && S.record.signed; var check = Sg && Sg.check;
    var flagged = check && check.status !== 'ok';
    var q = flagged
      ? 'The portal\'s reading of the signed letter flagged: ' + (check.issues || []).map(function (i) { return i.message; }).join('; ') + '. Submit it anyway? Phase 1 completes and the onboarding documentation is released to the employee.'
      : 'Submit the signed letter of offer? Phase 1 completes and the onboarding documentation is released to the employee.';
    if (!await portalConfirm(q, flagged ? { danger: true } : undefined)) return;
    return act('/offer/verify', flagged ? { acknowledge: true } : {}, function (r) { return (r.release && r.release.message) || 'Submitted — the offer is accepted.'; });
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
    if (!await portalConfirm('Approve the payroll set for Xero? Bank details are approved with it, and the set is frozen as the version that will be sent.')) return;
    return returnsAct('/payroll-setup/approve', {}, 'Approved for Xero.');
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
    var file = fileFrom(input);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('That file is larger than 10 MB.', true); input.value = ''; return; }
    var ext = String(file.name).split('.').pop().toLowerCase();
    var mime = MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type);
    var b64; try { b64 = await readFileAsBase64(file); } catch (_) { toast('The file could not be read.', true); return; }
    input.value = '';
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', { fileName: file.name, fileMime: mime, fileData: b64 }, 'File replaced for this person only.', 'POST', phaseOfItem(id)));
  }
  async function packRevertFile(id) {
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    var hasLibrary = !!(i && i.library);
    if (!hasLibrary && !await portalConfirm('Remove the attached file? The document stays in the pack with no file until you attach another.', { danger: true })) return;
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', {}, hasLibrary ? 'Back to the library copy.' : 'File removed — attach the right one when ready.', 'DELETE', phaseOfItem(id)));
  }
  /** Files dropped on a document: the first fills an empty slot, everything else is attached alongside. */
  function packDropFiles(id, files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    var hasFile = !!(i && i.file && i.file.previewUrl && !i.file.placeholder);
    if (hasFile) return packAddAttachments(id, list);
    packUploadFile(id, list[0]).then(function () { if (list.length > 1) return packAddAttachments(id, list.slice(1)); });
  }
  /** Extra files on one document. Several at once; each lands as its own attachment. */
  async function packAddAttachments(id, files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var ok = 0;
    for (var n = 0; n < list.length; n++) {
      var file = list[n];
      if (file.size > 10 * 1024 * 1024) { toast(file.name + ' is larger than 10 MB — skipped.', true); continue; }
      var ext = String(file.name).split('.').pop().toLowerCase();
      var b64; try { b64 = await readFileAsBase64(file); } catch (_) { toast(file.name + ' could not be read.', true); continue; }
      var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + packPath('/items/' + encodeURIComponent(id) + '/attachments', phaseOfItem(id)), { method: 'POST', body: {
        fileName: file.name, fileMime: MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type), fileData: b64,
      } });
      if (res.ok) ok += 1; else toast(file.name + ': ' + res.error, true);
    }
    if (ok) toast(ok === 1 ? 'Attached.' : ok + ' files attached.');
    return refreshRecordAfter(Promise.resolve({ ok: true }));
  }
  async function packRenameFile(id, current) {
    var name = await portalPrompt('File name as it will appear in the pack:', current || '');
    if (name === null) return; if (!name.trim()) return toast('Give the file a name.', true);
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', { fileName: name.trim() }, 'File renamed.', 'PATCH', phaseOfItem(id)));
  }
  async function packRenameAttachment(id, attachmentId, current) {
    var name = await portalPrompt('Attachment name as it will appear in the pack:', current || '');
    if (name === null) return; if (!name.trim()) return toast('Give the attachment a name.', true);
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/attachments/' + encodeURIComponent(attachmentId), { fileName: name.trim() }, 'Renamed.', 'PATCH', phaseOfItem(id)));
  }
  function packRemoveAttachment(id, attachmentId) {
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/attachments/' + encodeURIComponent(attachmentId), {}, 'Attachment removed.', 'DELETE', phaseOfItem(id)));
  }

  /** × on a file: off immediately, no dialog — the row stays, so the right file can go on. */
  function packRemoveFileNow(id) {
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    var src = i && i.file ? i.file.source : 'own';
    if (src !== 'own') {
      // The library's own copy cannot be detached from its document, so the document leaves the pack.
      return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/remove', {}, 'Taken out of this pack. Add it again from the library if that was a slip.', 'POST', phaseOfItem(id)));
    }
    var hasLibrary = !!(i && i.library);
    return refreshRecordAfter(packAct('/items/' + encodeURIComponent(id) + '/file', {}, hasLibrary ? 'File removed — back to the library copy.' : 'File removed.', 'DELETE', phaseOfItem(id)));
  }

  /** Several files onto a section: each becomes its own document there, named after the file. */
  async function packAttachToSection(phase, section, files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;
    var ok = 0;
    for (var n = 0; n < list.length; n++) {
      var file = list[n];
      if (file.size > 10 * 1024 * 1024) { toast(file.name + ' is larger than 10 MB — skipped.', true); continue; }
      var ext = String(file.name).split('.').pop().toLowerCase();
      if (!MIMES[ext] && ext !== 'doc') { toast(file.name + ' is not a PDF, Word, PNG or JPEG — skipped.', true); continue; }
      var b64; try { b64 = await readFileAsBase64(file); } catch (_) { toast(file.name + ' could not be read.', true); continue; }
      var stem = file.name.replace(/\.[^.]+$/, ''); try { stem = decodeURIComponent(stem); } catch (_) { /* keep as typed */ }
      var title = stem.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || file.name;
      var res = await api('/api/onboarding/journey/records/' + encodeURIComponent(S.recordId) + packPath('/items', phase), { method: 'POST', body: {
        title: title, section: section, sendsDocument: true, employeeReturns: false, requiresVerification: false, required: false,
        fileName: file.name, fileMime: MIMES[ext] || (ext === 'doc' ? 'application/msword' : file.type), fileData: b64,
      } });
      if (res.ok) ok += 1; else toast(file.name + ': ' + res.error, true);
    }
    if (ok) toast(ok === 1 ? 'Added to the pack.' : ok + ' documents added to the pack.');
    return refreshRecordAfter(Promise.resolve({ ok: true }));
  }

  function packPreview(id) {
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    if (!i || !i.file || !i.file.previewUrl) return;
    var kind = i.file.previewKind;
    if ((kind === 'pdf' || kind === 'docx' || kind === 'image' || kind === 'text') && global.DocPreview && typeof global.DocPreview.open === 'function') {
      global.DocPreview.open({ kind: kind, url: i.file.previewUrl + '?rev=' + Date.now(), downloadUrl: i.file.downloadUrl, title: i.title, meta: (i.file.source === 'own' ? 'Your copy' : i.file.source === 'body' ? 'Library text' : 'Library copy') + (i.file.fileName ? ' · ' + i.file.fileName : '') });
    } else {
      global.open(i.file.previewUrl, '_blank', 'noopener');
    }
  }
  function packPreviewAttachment(id, attachmentId) {
    var all = ((S.record && S.record.pack) ? S.record.pack.items : []).concat((S.record && S.record.induction) ? S.record.induction.items : []);
    var i = all.filter(function (x) { return x.id === id; })[0];
    var a = i && (i.attachments || []).filter(function (x) { return x.id === attachmentId; })[0];
    if (!a) return;
    if ((a.previewKind === 'pdf' || a.previewKind === 'docx' || a.previewKind === 'image') && global.DocPreview && typeof global.DocPreview.open === 'function') {
      global.DocPreview.open({ kind: a.previewKind, url: a.previewUrl + '?rev=' + Date.now(), downloadUrl: a.downloadUrl, title: i.title, meta: 'Attachment · ' + a.fileName });
    } else {
      global.open(a.downloadUrl || a.previewUrl, '_blank', 'noopener');
    }
  }
  /** Open the add-document form; a section pins the new document to that heading. */
  async function packAddOpen(phase, section) {
    phase = phase || 'documentation';
    S.addPhase = phase; S.addSection = section || null;
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
      + '<h3>Add a document to ' + (S.addSection ? '<em>' + esc(SECTION_LABELS[S.addSection] || titleCase(S.addSection)) + '</em>' : 'this pack') + '</h3>'
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
    var body = { documentId: v('oj-pa-doc') || null, title: v('oj-pa-title') || null, sendsDocument: ck('oj-pa-sends'), employeeReturns: ck('oj-pa-returns'), requiresVerification: ck('oj-pa-verifies'), required: ck('oj-pa-required'), section: S.addSection || undefined };
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
  async function uploadReturns(input, packItemId) {
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
      var body = { files: batches[b].map(function (p) { return { fileName: p.fileName, fileMime: p.fileMime, fileData: p.fileData, title: p.title, packItemId: packItemId || undefined }; }) };
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
  function placeReturn(docId) {
    var sel = doc.getElementById('oj-place-' + docId);
    var itemId = sel ? sel.value : '';
    if (!itemId) return toast('Choose which document this is.', true);
    return returnsAct('/returns/' + encodeURIComponent(docId) + '/assign', { packItemId: itemId }, 'Placed and re-read.');
  }
  async function unplaceReturn(docId) {
    if (!await portalConfirm('Take this file out of its slot? It goes back to Not placed yet, where you can put it in the right one.')) return;
    return returnsAct('/returns/' + encodeURIComponent(docId) + '/unassign', {}, 'Unplaced.');
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
  async function itemNotApplicable(itemId) {
    if (!await portalConfirm('Mark this document as not applicable? Nothing will need to come back for it, and it will no longer hold up the internal induction.')) return;
    return returnsAct('/pack/items/' + encodeURIComponent(itemId) + '/not-applicable', {}, 'Marked not applicable.');
  }
  function itemApplicable(itemId) { return returnsAct('/pack/items/' + encodeURIComponent(itemId) + '/applicable', {}, 'Back to awaiting return.'); }
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

  function scrollTo(id) {
    var el = doc.getElementById(id); if (!el) return;
    // A target inside a hidden stage 2 tab needs its tab in front first.
    var pane = el.closest('.oj-tabpane'); if (pane && pane.hidden) docTab(pane.id.replace('oj-tabpane-', ''));
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  function copy(text) {
    if (global.navigator && global.navigator.clipboard) global.navigator.clipboard.writeText(text).then(function () { toast('Link copied.'); }, function () { toast('Could not copy — select the link and copy it.', true); });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  global.OnboardingJourney = {
    render: render,
    syncPay: syncPaySuggestions,
    comboToggle: comboToggle, comboPick: comboPick, comboKey: comboKey,
    saveDraft: function () { return saveDraft(false); },
    saveDraftAndLeave: saveDraftAndLeave,
    discardDraft: discardDraft,
    subnavHtml: subnavHtml,
    nav: nav,
    openRecord: openRecord,
    cancelRecordDialog: cancelRecordDialog,
    confirmCancelRecord: confirmCancelRecord,
    filter: setFilter,
    submitStart: submitStart,
    editTerms: editTerms, cancelEdit: cancelEdit, saveTerms: saveTerms,
    openLetterEditor: openLetterEditor, saveLetterEditor: saveLetterEditor, resetLetterTemplate: resetLetterTemplate, letterFocus: letterFocus, letterCaret: letterCaret, letterKey: letterKey, letterPaste: letterPaste, letterInsert: letterInsert,
    packPreviewAttachment: packPreviewAttachment, packRemoveFileNow: packRemoveFileNow, packAttachToSection: packAttachToSection, packAddAttachments: packAddAttachments, packRemoveAttachment: packRemoveAttachment, packRenameAttachment: packRenameAttachment, packRenameFile: packRenameFile,
    openInMailApp: openInMailApp,
    previewLetter: previewLetter, previewSigned: previewSigned, uploadLetter: uploadLetter, uploadSigned: uploadSigned, discardLetter: discardLetter,
    saveEmail: saveEmail, resetEmail: resetEmail, createDraft: createDraft, markSent: markSent, unmarkSent: unmarkSent,
    verifyOffer: verifyOffer, declineOffer: declineOffer, withdrawOffer: withdrawOffer, skipOffer: skipOffer,
    packPrepare: packPrepare, packItem: packItem, packFlag: packFlag, packRename: packRename, packUploadFile: packUploadFile,
    packRevertFile: packRevertFile, packPreview: packPreview, packAddOpen: packAddOpen, packAddClose: packAddClose, packAddSubmit: packAddSubmit,
    emailMark: emailMark, emailKey: emailKey, packSaveEmail: packSaveEmail, packResetEmail: packResetEmail, packCreateDraft: packCreateDraft, packMarkSent: packMarkSent, packUnmarkSent: packUnmarkSent,
    uploadReturns: uploadReturns, processReturns: processReturns, previewReturn: previewReturn, assignReturn: assignReturn, placeReturn: placeReturn, unplaceReturn: unplaceReturn, archiveReturn: archiveReturn,
    resolveConflict: resolveConflict, acceptField: acceptField, correctField: correctField, rejectField: rejectField,
    verifyItem: verifyItem, rejectItem: rejectItem, itemNotApplicable: itemNotApplicable, itemApplicable: itemApplicable, approvePayroll: approvePayroll, approvePayrollSetup: approvePayrollSetup, packRestoreDefaults: packRestoreDefaults,
    loadPayrollReference: loadPayrollReference, savePayrollConfig: savePayrollConfig, addPayrollLeave: addPayrollLeave, removePayrollLeave: removePayrollLeave,
    requestPayrollChanges: requestPayrollChanges, syncPayroll: syncPayroll, recheckPayroll: recheckPayroll, resolvePayrollDuplicate: resolvePayrollDuplicate, completePayrollAction: completePayrollAction,
    release: release,
    runTask: runTask, task: task, assignTask: assignTask,
    cancelRecord: cancelRecord, openReview: openReview,
    scrollTo: scrollTo, copy: copy, viewPhase: viewPhase, docTab: docTab,
    openDefaults: openDefaults, viewDefaultsPhase: viewDefaultsPhase, previewDefaultsLetter: previewDefaultsLetter, defaultsRename: defaultsRename, defaultsRenameFile: defaultsRenameFile,
    defaultsRemove: defaultsRemove, defaultsRestore: defaultsRestore, defaultsUpload: defaultsUpload, defaultsPreview: defaultsPreview, defaultsAddOpen: defaultsAddOpen, defaultsAddClose: defaultsAddClose, defaultsAddSubmit: defaultsAddSubmit,
    refresh: rerender,
    _state: S,
  };
})(typeof window !== 'undefined' ? window : this);
