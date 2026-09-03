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
    offerUrl: null,     // returned once by send; shown until the view changes
    editingTerms: false,
    busy: false,
  };

  var VIEWS = [
    { key: 'board', label: 'Onboarding' },
    { key: 'start', label: 'Start onboarding' },
    { key: 'packages', label: 'Packages' },
  ];

  function root() { return doc.getElementById('ob-root'); }

  /** The shared sub-navigation. onboarding.js reuses it for the Packages view. */
  function subnavHtml(active) {
    return '<div class="ob-subnav oj-subnav" role="tablist">'
      + VIEWS.filter(function (v) { return v.key !== 'start' || can('onboarding.assign'); })
        .map(function (v) {
          var on = active === v.key || (active === 'record' && v.key === 'board');
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
    S.offerUrl = null;
    S.editingTerms = false;
    if (global.Onboarding && typeof global.Onboarding.nav === 'function') {
      global.Onboarding.nav(view, S.recordId);
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
    return viewBoard(pane, actions);
  }

  function rerender() { return render(root()); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE BOARD
  // ═══════════════════════════════════════════════════════════════════════════

  var FILTERS = [
    ['all', 'Everyone'], ['needs_you', 'Needs you'], ['employee', 'Waiting on employee'], ['overdue', 'Overdue'],
    ['offer', 'Letter of offer'], ['documentation', 'Documentation'], ['induction', 'Induction'], ['complete', 'Complete'],
  ];

  function matchesFilter(r, f) {
    switch (f) {
      case 'needs_you': return !r.closed && !r.complete && r.next.actor === 'admin';
      case 'employee': return !r.closed && !r.complete && r.next.actor === 'employee';
      case 'overdue': return !r.closed && !r.complete && r.counts.overdue > 0;
      case 'offer': case 'documentation': case 'induction': return r.stage.key === f;
      case 'complete': return r.complete;
      default: return !r.complete;
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
      + tile(s.needsYou, 'Need you', 'needs_you', 'is-you')
      + tile(s.waitingOnEmployee, 'Waiting on employee', 'employee')
      + tile(s.overdue, 'Overdue', 'overdue', s.overdue ? 'is-danger' : '')
      + tile(s.byStage.offer, 'Letter of offer', 'offer')
      + tile(s.byStage.documentation, 'Documentation', 'documentation')
      + tile(s.byStage.induction, 'Induction & access', 'induction')
      + '</div>'
      + '<div class="oj-filters" role="tablist">'
      + FILTERS.map(function (f) {
        return '<button type="button" role="tab" aria-selected="' + (S.filter === f[0]) + '"'
          + ' class="oj-filter' + (S.filter === f[0] ? ' active' : '') + '" onclick="OnboardingJourney.filter(\'' + f[0] + '\')">' + esc(f[1]) + '</button>';
      }).join('')
      + '</div>'
      + (rows.length ? '<div class="oj-list">' + rows.map(boardRow).join('') + '</div>'
        : empty(S.filter === 'all' && !b.records.length ? 'Nobody is being onboarded yet' : 'Nothing here',
          S.filter === 'all' && !b.records.length ? 'Press Start onboarding to create the first record — the letter of offer is drafted from the same details.' : 'Try another filter.'));
  }

  function stageTrack(r) {
    return '<ol class="oj-track" aria-label="Stages">' + r.stages.map(function (st) {
      return '<li class="oj-track-step is-' + esc(st.state) + '" title="' + esc(st.label + ': ' + st.summary) + '">'
        + '<span class="oj-track-n">' + st.number + '</span><span class="oj-track-l">' + esc(st.label) + '</span>'
        + '<span class="oj-track-s">' + esc(titleCase(st.state)) + '</span></li>';
    }).join('') + '</ol>';
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

    return '<article class="oj-row' + (r.next.actor === 'admin' ? ' needs-you' : '') + '">'
      + '<div class="oj-row-main">'
      + '  <h3><a href="#onboarding/record/' + esc(r.id) + '" onclick="OnboardingJourney.openRecord(\'' + jsq(r.id) + '\');return false;">' + esc(r.applicantName) + '</a></h3>'
      + '  <p class="oj-quiet">' + esc(r.jobTitle || 'Position not set') + ' · ' + esc(titleCase(r.employmentType)) + (r.startDate ? ' · ' + esc(fmtDate(r.startDate)) + ' (' + esc(daysWord(r.daysToStart)) + ')' : '') + '</p>'
      + stageTrack(r)
      + '</div>'
      + '<div class="oj-row-side">'
      + nextLine(r.next)
      + '<div class="oj-chips">' + bits.join('') + '</div>'
      + '<button type="button" class="oj-btn" onclick="OnboardingJourney.openRecord(\'' + jsq(r.id) + '\')">Open</button>'
      + '</div>'
      + '</article>';
  }

  function setFilter(f) { S.filter = f; var pane = doc.getElementById('oj-view'); if (pane && S.board) drawBoard(pane); }

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
      + field(p + 'payBasis', 'Pay basis', select(p + 'payBasis', [['annual', 'Annual salary'], ['hourly', 'Hourly rate']], t.payBasis || 'annual'))
      + field(p + 'payRate', 'Salary or rate (AUD, excl. super)', input(p + 'payRate', 'number', t.payRate, 'min="0" step="0.01" inputmode="decimal"'))
      + field(p + 'hoursPerWeek', 'Standard hours per week', input(p + 'hoursPerWeek', 'number', t.hoursPerWeek, 'min="0" max="80" step="0.1" inputmode="decimal"'))
      + field(p + 'probationMonths', 'Probation (months)', input(p + 'probationMonths', 'number', t.probationMonths == null ? 6 : t.probationMonths, 'min="0" max="12" step="1"'))
      + field(p + 'awardClassification', 'Award / classification', input(p + 'awardClassification', 'text', t.awardClassification, 'maxlength="150"'), 'e.g. Health Professionals and Support Services Award, Level 2')
      + field(p + 'workLocation', 'Location', input(p + 'workLocation', 'text', t.workLocation || (opts.defaults && opts.defaults.workLocation) || '', 'maxlength="150"'))
      + '</div>'
      + field(p + 'additionalTerms', 'Additional terms for the letter (optional)',
        '<textarea id="' + p + 'additionalTerms" rows="3" maxlength="4000">' + esc(t.additionalTerms || '') + '</textarea>',
        'Appears as its own paragraph in the letter of offer.');
  }

  function readTerms(prefix) {
    var p = prefix || 'oj-f-';
    var v = function (k) { var el = doc.getElementById(p + k); return el ? el.value.trim() : ''; };
    return {
      positionTitle: v('position'), employmentType: v('employmentType'), startDate: v('startDate') || null,
      endDate: v('endDate') || null, payBasis: v('payRate') ? v('payBasis') : null, payRate: v('payRate') || null,
      hoursPerWeek: v('hoursPerWeek') || null, probationMonths: v('probationMonths') || null,
      awardClassification: v('awardClassification') || null, workLocation: v('workLocation') || null,
      additionalTerms: v('additionalTerms') || null,
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
    var stagePill = '<span class="oj-stage-pill is-' + esc(j.stage.key) + '">' + (j.stage.number ? 'Stage ' + j.stage.number + ' · ' : '') + esc(j.stage.label) + '</span>';

    pane.innerHTML = ''
      + '<div class="oj-record-head">'
      + '  <div><h2>' + esc(r.applicantName) + ' ' + stagePill + '</h2>'
      + '  <p class="oj-quiet">' + esc(r.jobTitle || 'Position not set') + ' · ' + esc(titleCase(r.employmentType)) + ' · ' + esc(r.applicantEmail || '')
      + (r.startDate ? ' · commences ' + esc(fmtDate(r.startDate)) + ' (' + esc(daysWord(j.daysToStart)) + ')' : '') + '</p></div>'
      + '  <div class="oj-record-head-actions">' + recordHeadActions(d) + '</div>'
      + '</div>'
      + stageTrack({ stages: j.stages })
      + nextBanner(d)
      + groupsHtml(j)
      + '<div class="oj-stages">'
      + offerPanel(d)
      + documentationPanel(d)
      + inductionPanel(d)
      + '</div>'
      + emailsPanel(d);
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
      case 'edit_offer': case 'reissue_offer': return c.assign ? btn('Edit the offer terms', 'OnboardingJourney.editTerms()', 'oj-btn-primary') : '';
      case 'approve_offer': return c.assign ? btn('Approve the letter', 'OnboardingJourney.approveOffer()', 'oj-btn-primary') : '';
      case 'send_offer': return c.assign ? btn('Send the letter of offer', 'OnboardingJourney.sendOffer()', 'oj-btn-primary') : '';
      case 'resend_offer': return c.assign ? btn('Send it again', 'OnboardingJourney.sendOffer()', 'oj-btn-primary') : '';
      case 'release': return c.assign ? btn('Release the documentation', 'OnboardingJourney.release()', 'oj-btn-primary') : '';
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
      + group('Needs your review', j.adminReview, 'is-you', 'Nothing waiting on you.')
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
    var o = d.offer; var st = d.journey.stages[0]; var c = d.can;
    var editable = c.assign && d.record.status === 'created' && (!o || ['draft', 'approved', 'declined', 'withdrawn'].indexOf(o.status) !== -1);
    var body = '';

    if (S.editingTerms && editable) {
      body += '<form class="oj-form" onsubmit="return OnboardingJourney.saveTerms(event)">'
        + termsFields(S.options || {}, (o && o.terms) || d.record.terms || {}, 'oj-t-')
        + '<div id="oj-terms-error" class="ob-note is-danger" role="alert" hidden></div>'
        + '<div class="oj-actions"><button type="submit" class="oj-btn oj-btn-primary">Save the terms</button>'
        + '<button type="button" class="oj-btn" onclick="OnboardingJourney.cancelEdit()">Cancel</button></div></form>';
    } else {
      body += '<div class="oj-offer-status">'
        + (o ? '<span class="oj-chip ' + offerChipClass(o.status) + '">' + esc(offerLabel(o)) + '</span>' : '')
        + (o && o.sentAt ? '<span class="oj-quiet"> sent ' + esc(fmtDateTime(o.sentAt)) + (o.sentByName ? ' by ' + esc(o.sentByName) : '') + (o.reminderCount ? ' · ' + o.reminderCount + ' reminder' + (o.reminderCount === 1 ? '' : 's') : '') + '</span>' : '')
        + (o && o.firstViewedAt ? '<span class="oj-quiet"> · opened ' + esc(fmtDateTime(o.firstViewedAt)) + '</span>' : '')
        + (o && o.respondedAt ? '<span class="oj-quiet"> · answered ' + esc(fmtDateTime(o.respondedAt)) + (o.signedName ? ', signed “' + esc(o.signedName) + '”' : '') + '</span>' : '')
        + '</div>'
        + (o && o.declineReason ? '<div class="ob-note is-warn">Reason given: ' + esc(o.declineReason) + '</div>' : '')
        + termsTable((o && o.terms) || d.record.terms || {});

      if (S.offerUrl) {
        body += '<div class="ob-note is-info"><strong>Response link</strong> (shown once — copy it if you need to deliver it yourself):<br>'
          + '<code class="oj-code">' + esc(S.offerUrl) + '</code> <button type="button" class="oj-btn oj-btn-small" onclick="OnboardingJourney.copy(\'' + jsq(S.offerUrl) + '\')">Copy</button></div>';
      }

      var acts = [];
      if (editable) acts.push(btn(o && ['declined', 'withdrawn'].indexOf(o.status) !== -1 ? 'Issue a revised offer' : 'Edit the terms', 'OnboardingJourney.editTerms()'));
      if (c.assign && o && o.status === 'draft') acts.push(btn('Approve the letter', 'OnboardingJourney.approveOffer()', 'oj-btn-primary'));
      if (c.assign && o && o.status === 'approved') acts.push(btn('Send the letter of offer', 'OnboardingJourney.sendOffer()', 'oj-btn-primary'));
      if (c.assign && o && o.status === 'sent') acts.push(btn(o.linkLive ? 'Send a reminder' : 'Send it again (new link)', 'OnboardingJourney.sendOffer()', 'oj-btn-primary'));
      if (c.assign && o && ['draft', 'approved', 'sent'].indexOf(o.status) !== -1) acts.push(btn('Withdraw', 'OnboardingJourney.withdrawOffer()', 'oj-btn-quiet'));
      if (c.assign && o && ['draft', 'approved'].indexOf(o.status) !== -1) acts.push(btn('No letter needed — go to documentation', 'OnboardingJourney.skipOffer()', 'oj-btn-quiet'));
      if (acts.length) body += '<div class="oj-actions">' + acts.join('') + '</div>';

      if (d.letterHtml) {
        body += '<details class="oj-letter-preview"><summary>Preview the letter as the employee will read it</summary>'
          + '<div class="oj-letter">' + d.letterHtml + '</div></details>';
      }
      if (d.offerHistory && d.offerHistory.length > 1) {
        body += '<details class="oj-history"><summary>Previous versions (' + (d.offerHistory.length - 1) + ')</summary><ul>'
          + d.offerHistory.filter(function (h) { return !o || h.id !== o.id; }).map(function (h) {
            return '<li>v' + h.version + ' — ' + esc(offerLabel(h)) + (h.respondedAt ? ' ' + esc(fmtDate(h.respondedAt)) : h.withdrawnAt ? ' ' + esc(fmtDate(h.withdrawnAt)) : '') + '</li>';
          }).join('') + '</ul></details>';
      }
    }
    return stagePanel(1, 'Letter of Offer', st, body);
  }

  function offerLabel(o) {
    return { draft: 'Draft — awaiting approval', approved: 'Approved — not yet sent', sent: 'Sent — awaiting response',
      accepted: 'Accepted', declined: 'Declined', withdrawn: 'Withdrawn', not_required: 'Not required' }[o.status] || titleCase(o.status);
  }
  function offerChipClass(s) {
    return s === 'accepted' || s === 'not_required' ? 'is-done' : s === 'declined' || s === 'withdrawn' ? 'is-danger' : s === 'sent' ? 'is-employee' : 'is-you';
  }

  function stagePanel(n, title, st, body) {
    return '<section class="oj-panel oj-stage is-' + esc(st.state) + '" id="oj-stage-' + n + '">'
      + '<header><h2><span class="oj-stage-n">' + n + '</span>' + esc(title) + '</h2>'
      + '<span class="oj-chip is-' + esc(st.state) + '">' + esc(titleCase(st.state)) + '</span></header>'
      + '<p class="oj-stage-summary">' + esc(st.summary) + '</p>'
      + body + '</section>';
  }

  // ── Stage 2 panel ─────────────────────────────────────────────────────────

  function documentationPanel(d) {
    var st = d.journey.stages[1];
    var body = '';
    if (st.state === 'pending') return stagePanel(2, 'Onboarding Documentation', st, '');
    var r = d.record;
    if (r.status === 'created') {
      body += '<p>The employee has accepted. Releasing creates their portal account, emails the invitation and issues the documentation list from the <strong>' + esc(r.packageTitle || 'onboarding') + '</strong> package.</p>';
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

  function meter(label, done, total) {
    done = done || 0; total = total || 0;
    var pct = total === 0 ? 100 : Math.round((done / total) * 100);
    return '<div class="oj-meter"><div class="oj-meter-l"><strong>' + esc(label) + '</strong><span>' + done + ' of ' + total + '</span></div>'
      + '<div class="oj-meter-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></div></div>';
  }

  // ── Stage 3 panel ─────────────────────────────────────────────────────────

  function inductionPanel(d) {
    var st = d.journey.stages[2];
    if (st.state === 'pending') return stagePanel(3, 'Internal Induction & Access', st, '');
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
        + '<span class="oj-chip is-' + esc(t.status) + '">' + esc(titleCase(t.status)) + (t.automation ? ' · portal' : '') + '</span>'
        + '<p class="oj-quiet">' + esc(t.description || '') + '</p>'
        + (t.note ? '<p class="oj-quiet">Note: ' + esc(t.note) + '</p>' : '')
        + (t.dueAt ? '<span class="oj-due' + (t.overdue ? ' is-overdue' : '') + '">' + (t.overdue ? 'overdue · ' : 'due ') + esc(fmtDate(t.dueAt)) + '</span>' : '')
        + (t.completedAt ? '<span class="oj-quiet"> · done ' + esc(fmtDate(t.completedAt)) + (t.completedByName ? ' by ' + esc(t.completedByName) : '') + '</span>' : '')
        + '</div>'
        + '<div class="oj-task-side">' + assign + '<div class="oj-actions">' + acts.join('') + '</div></div>'
        + '</li>';
    }).join('') + '</ul>' : '<p class="oj-quiet">The checklist is being generated.</p>';
    return stagePanel(3, 'Internal Induction & Access', st, body);
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

  function approveOffer() { return act('/offer/approve', {}, 'Letter approved. Send it when you are ready.'); }

  async function sendOffer() {
    var res = await act('/offer/send', {}, null);
    if (!res) return;
    if (res.offerUrl) S.offerUrl = res.offerUrl;
    if (res.delivery) toast(res.delivery.message, res.delivery.status === 'failed');
    var pane = doc.getElementById('oj-view'); if (pane && S.record) drawRecord(pane);
  }

  function withdrawOffer() {
    var reason = global.prompt('Withdraw this letter of offer? You can add a reason for the record (optional).');
    if (reason === null) return;
    return act('/offer/withdraw', { reason: reason || undefined }, 'Offer withdrawn.');
  }

  function skipOffer() {
    if (!global.confirm('Skip the letter of offer and release the onboarding documentation now?')) return;
    return act('/offer/skip', {}, function (r) { return r.release && r.release.message ? r.release.message : 'Letter marked as not required.'; });
  }

  function release() {
    return act('/release', {}, function (r) { return (r.release && r.release.message) || r.error || 'Released.'; });
  }

  function runTask(code) {
    if (code === 'portal_access' && !global.confirm('Activate portal access for this person now? Their account becomes a staff account with the agreed role.')) return;
    return act('/tasks/' + encodeURIComponent(code) + '/run', {}, 'Portal access activated.');
  }
  function task(code, verb) {
    var note;
    if (verb === 'skip') { note = global.prompt('Skip this task? Add a short reason for the record.'); if (note === null) return; }
    return act('/tasks/' + encodeURIComponent(code) + '/' + verb, { note: note || undefined }, verb === 'complete' ? 'Task done.' : null);
  }
  function assignTask(code, assigneeUserId, dueAt) {
    var body = {};
    if (assigneeUserId !== null && assigneeUserId !== undefined) body.assigneeUserId = assigneeUserId || null;
    if (dueAt) body.dueAt = dueAt;
    return act('/tasks/' + encodeURIComponent(code), body, null, 'PATCH');
  }

  async function cancelRecord() {
    var reason = global.prompt('Cancel this onboarding? Give a reason for the record.');
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
    subnavHtml: subnavHtml,
    nav: nav,
    openRecord: openRecord,
    filter: setFilter,
    submitStart: submitStart,
    editTerms: editTerms, cancelEdit: cancelEdit, saveTerms: saveTerms,
    approveOffer: approveOffer, sendOffer: sendOffer, withdrawOffer: withdrawOffer, skipOffer: skipOffer,
    release: release,
    runTask: runTask, task: task, assignTask: assignTask,
    cancelRecord: cancelRecord, openReview: openReview,
    scrollTo: scrollTo, copy: copy,
    refresh: rerender,
    _state: S,
  };
})(typeof window !== 'undefined' ? window : this);
