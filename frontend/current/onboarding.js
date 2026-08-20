/* ═══════════════════════════════════════════════════════════════════════════
   ONBOARDING PACKAGES — portal module

   One IIFE, one global (window.Onboarding), no build step, no dependencies —
   the same shape as resourcehub.js and casenotes.js. Renders string-built HTML
   into the static <div id="ob-root"> that mockup_v3.html declares inside
   <section class="view" id="view-onboarding">.

   ONE TAB, TWO SURFACES
   ─────────────────────
   The same tab shows a different thing depending on who is looking:

     • Whoever holds onboarding.view (the Owner, or an Admin the Owner has
       delegated to) gets the MANAGEMENT surface — dashboard, packages,
       active onboarding, employees, compliance, documents, settings.

     • Everyone else gets MY ONBOARDING: their own run and nothing else. A
       therapist, a read-only account and a pre-employee all land here.

   Which one you get is decided by the SERVER's answer, not by a role string
   this file trusts: /api/onboarding/dashboard either answers or 403s. Client
   gating here is honesty about what to draw, never the security boundary.

   ACCESSIBILITY
   ─────────────
   Status is never carried by colour alone — every chip has a text label, every
   progress bar has a written "n of m" beside it. Forms use real <label for>,
   errors are announced through aria-live and linked with aria-describedby,
   and the modal traps focus and restores it on close.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  var doc = global.document;
  if (!doc) return;

  // ── Utilities ─────────────────────────────────────────────────────────────

  /** Escape before interpolation. Every string here comes from the server. */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Escape for a single-quoted inline onclick argument. */
  function jsq(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  }

  function root() { return doc.getElementById('ob-root'); }

  /**
   * Private API helper — copied from resourcehub.js so error handling is
   * identical across the app. Never throws: the caller checks `ok`.
   */
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
        return {
          ok: false, status: r.status, code: data.code || null,
          error: data.message || data.error || ('Request failed (' + r.status + ')'),
          details: data,
        };
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: null, error: 'Network error — please try again.' };
    }
  }

  function toast(message, isError) {
    // showToast in this app is (msg, isError) — passing a subtitle string here
    // would be read as truthy and render an error-styled toast.
    if (typeof global.showToast === 'function') global.showToast(message, !!isError);
  }

  function fmtDate(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtDateLong(v) {
    if (!v) return null;
    var d = new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  function titleCase(s) {
    return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /** A status chip. Colour AND text, always — never colour alone. */
  function chip(status, extra) {
    var label = titleCase(status);
    return '<span class="ob-chip ' + esc(status) + (extra ? ' ' + extra : '') + '">'
      + esc(label) + '</span>';
  }

  function basisChip(basis) {
    if (!basis) return '';
    return '<span class="ob-basis ' + esc(basis) + '">' + esc(titleCase(basis)) + '</span>';
  }

  function meter(label, done, total, opts) {
    opts = opts || {};
    var pct = total === 0 ? 100 : Math.round((done / total) * 100);
    var complete = total === 0 || done >= total;
    return ''
      + '<div>'
      + '  <div class="ob-meter-label">'
      + '    <strong>' + esc(label) + '</strong>'
      + '    <span>' + done + ' of ' + total + ' · ' + pct + '%</span>'
      + '  </div>'
      + '  <div class="ob-bar' + (opts.employer ? ' is-employer' : '') + (complete ? ' is-complete' : '') + '"'
      + '       role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"'
      + '       aria-label="' + esc(label) + ': ' + done + ' of ' + total + ' complete">'
      + '    <i style="width:' + pct + '%"></i>'
      + '  </div>'
      + (opts.note ? '<p class="ob-meter-note">' + esc(opts.note) + '</p>' : '')
      + '</div>';
  }

  function empty(title, sub) {
    return '<div class="ob-empty"><strong>' + esc(title) + '</strong>'
      + (sub ? esc(sub) : '') + '</div>';
  }

  function spinner(label) {
    return '<div class="ob-empty"><span class="ob-spinner" aria-hidden="true"></span> '
      + esc(label || 'Loading…') + '</div>';
  }

  // ── State ─────────────────────────────────────────────────────────────────

  var S = {
    booted: false,
    mode: null,            // 'manage' | 'mine' | 'none'
    view: 'dashboard',
    dashboard: null,
    packages: null,
    packageDocs: null,
    journey: null,
    review: null,
    // The temporary password, held in memory only, only until the sign-in
    // email carrying it has been sent. It is never written anywhere, and the
    // server cannot produce it again — reissuing is the only remedy.
    pendingCredential: null,
    assignments: null,
    assignmentDetail: null,
    packageDetail: null,
    employees: null,
    documents: null,
    compliance: null,
    expiring: null,
    settings: null,
    permissions: null,
    mine: null,
    filters: { status: '', search: '' },
    busy: false,
  };

  function user() { return global.APP_USER || {}; }

  /** Mirrors requirePermission on the server; UI honesty, not enforcement. */
  function can(permission) {
    if (typeof global.currentUserCan === 'function') {
      try { return !!global.currentUserCan(permission); } catch (_) { /* not ready */ }
    }
    return user().role === 'owner';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MODAL
  // ═══════════════════════════════════════════════════════════════════════════

  var _modalReturnFocus = null;

  function modalHost() {
    var el = doc.getElementById('ob-modal-host');
    if (!el) {
      // A position:fixed overlay authored inside a .view never paints while
      // that tab is inactive, because display:none on an ancestor kills fixed
      // positioning. Same reason letter-root and fca-root are body children.
      el = doc.createElement('div');
      el.id = 'ob-modal-host';
      el.className = 'ob-modal-backdrop';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
      doc.body.appendChild(el);
      el.addEventListener('click', function (e) {
        if (e.target === el) closeModal();
      });
    }
    return el;
  }

  function openModal(opts) {
    var host = modalHost();
    _modalReturnFocus = doc.activeElement;
    host.setAttribute('aria-labelledby', 'ob-modal-title');
    host.innerHTML = ''
      + '<div class="ob-modal' + (opts.wide ? ' is-wide' : '') + '">'
      + '  <div class="ob-modal-head">'
      + '    <div>'
      + '      <h2 id="ob-modal-title">' + esc(opts.title) + '</h2>'
      + (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '')
      + '    </div>'
      + '    <button type="button" class="ob-modal-close" aria-label="Close"'
      + '            onclick="Onboarding.closeModal()">&times;</button>'
      + '  </div>'
      + '  <div class="ob-modal-body" id="ob-modal-body">' + (opts.body || '') + '</div>'
      + (opts.footer ? '<div class="ob-modal-foot">' + opts.footer + '</div>' : '')
      + '</div>';
    host.classList.add('open');

    var first = host.querySelector('input, select, textarea, button:not(.ob-modal-close)');
    if (first) first.focus(); else host.querySelector('.ob-modal-close').focus();
  }

  function closeModal() {
    var host = doc.getElementById('ob-modal-host');
    if (!host) return;
    host.classList.remove('open');
    host.innerHTML = '';
    if (_modalReturnFocus && _modalReturnFocus.focus) _modalReturnFocus.focus();
    _modalReturnFocus = null;
  }

  // Escape closes; Tab is trapped inside the dialog while it is open.
  doc.addEventListener('keydown', function (e) {
    var host = doc.getElementById('ob-modal-host');
    if (!host || !host.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    var focusable = host.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function modalError(message) {
    var body = doc.getElementById('ob-modal-body');
    if (!body) return;
    var existing = body.querySelector('.ob-note.is-danger');
    if (existing) existing.remove();
    var el = doc.createElement('div');
    el.className = 'ob-note is-danger';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    body.insertBefore(el, body.firstChild);
    body.scrollTop = 0;
  }

  /** Read every named field inside the open modal. */
  function modalValues() {
    var body = doc.getElementById('ob-modal-body');
    var out = {};
    if (!body) return out;
    body.querySelectorAll('[name]').forEach(function (el) {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BOOT AND ROUTING
  // ═══════════════════════════════════════════════════════════════════════════

  var MANAGE_VIEWS = [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'packages', label: 'Packages' },
    { key: 'active', label: 'Active Onboarding' },
    { key: 'employees', label: 'Employees' },
    { key: 'compliance', label: 'Compliance' },
    { key: 'expiring', label: 'Expiring Credentials' },
    { key: 'documents', label: 'Document Library' },
    { key: 'settings', label: 'Settings' },
  ];

  function visibleViews() {
    return MANAGE_VIEWS.filter(function (v) {
      if (v.key === 'documents') return can('onboarding.manage_documents') || can('onboarding.view');
      if (v.key === 'settings') return can('onboarding.manage_compliance') || user().role === 'owner';
      if (v.key === 'compliance') return can('onboarding.manage_compliance') || can('onboarding.view');
      return true;
    });
  }

  /**
   * Decide which surface to draw by ASKING the server, not by trusting a role
   * string. A 403 is a definitive "not for you", and is handled as such rather
   * than as an error.
   */
  async function resolveMode() {
    var dash = await api('/api/onboarding/dashboard');
    if (dash.ok) { S.dashboard = dash; return 'manage'; }
    if (dash.status === 403) {
      var mine = await api('/api/onboarding/me');
      if (mine.ok && mine.hasOnboarding) { S.mine = mine; return 'mine'; }
      if (mine.ok) { S.mine = mine; return 'none'; }
      return 'none';
    }
    return 'error';
  }

  async function open(view) {
    var host = root();
    if (!host) return;
    if (!S.booted) {
      S.booted = true;
      host.innerHTML = spinner('Loading onboarding…');
      S.mode = await resolveMode();
    }
    if (view) S.view = view;
    await render();
  }

  function nav(view) {
    if (!view) return;
    S.view = view;
    S.assignmentDetail = null;
    S.packageDetail = null;
    render();
  }

  async function render() {
    var host = root();
    if (!host) return;
    host.dataset.mode = S.mode || '';

    if (S.mode === 'error') {
      host.innerHTML = '<div class="ob-note is-danger" role="alert">'
        + 'Onboarding could not be loaded. Please refresh, or contact your practice owner.</div>';
      return;
    }
    if (S.mode === 'none') { host.innerHTML = renderNoOnboarding(); return; }
    if (S.mode === 'mine') { await renderMine(host); return; }
    await renderManage(host);
  }

  function renderNoOnboarding() {
    return ''
      + '<div class="ob-root">'
      + '  <div class="ob-hero"><div>'
      + '    <h1>Onboarding</h1>'
      + '    <p>You do not have an onboarding pack in progress.</p>'
      + '  </div></div>'
      + empty('Nothing to complete',
        'When the practice assigns you onboarding, it will appear here.')
      + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MANAGEMENT SURFACE
  // ═══════════════════════════════════════════════════════════════════════════

  async function renderManage(host) {
    var views = visibleViews();
    if (!views.some(function (v) { return v.key === S.view; })) S.view = views[0].key;

    var subnav = '<div class="ob-subnav" id="ob-subnav" role="tablist">'
      + views.map(function (v) {
        return '<button type="button" role="tab" data-ob="' + esc(v.key) + '"'
          + ' aria-selected="' + (S.view === v.key ? 'true' : 'false') + '"'
          + (S.view === v.key ? ' class="active"' : '') + '>' + esc(v.label) + '</button>';
      }).join('')
      + '</div>';

    host.innerHTML = ''
      + '<div class="ob-root">'
      + '  <div class="ob-hero">'
      + '    <div>'
      + '      <h1>Onboarding Packages</h1>'
      + '      <p>New starter onboarding, credential verification and ongoing workforce compliance.</p>'
      + '    </div>'
      + '    <div class="ob-hero-actions" id="ob-hero-actions"></div>'
      + '  </div>'
      + subnav
      + '  <div id="ob-view">' + spinner() + '</div>'
      + '</div>';

    await loadView(S.view);
  }

  async function loadView(view) {
    var pane = doc.getElementById('ob-view');
    var actions = doc.getElementById('ob-hero-actions');
    if (!pane) return;
    pane.innerHTML = spinner();
    if (actions) actions.innerHTML = '';

    switch (view) {
      case 'dashboard': return viewDashboard(pane, actions);
      case 'packages': return S.packageDetail ? viewPackageDetail(pane, actions) : viewPackages(pane, actions);
      case 'active': return S.assignmentDetail ? viewAssignment(pane, actions) : viewActive(pane, actions);
      case 'employees': return viewEmployees(pane);
      case 'compliance': return viewCompliance(pane, actions);
      case 'expiring': return viewExpiring(pane);
      case 'documents': return viewDocuments(pane, actions);
      case 'settings': return viewSettings(pane);
      default: pane.innerHTML = empty('Not found', '');
    }
  }

  // ── Dashboard ─────────────────────────────────────────────────────────────

  async function viewDashboard(pane, actions) {
    var d = S.dashboard && S.dashboard.ok ? S.dashboard : await api('/api/onboarding/dashboard');
    S.dashboard = d;
    if (!d.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(d.error) + '</div>'; return; }

    if (actions && can('onboarding.assign')) {
      actions.innerHTML = '<button class="btn primary" onclick="Onboarding.assignDialog()">'
        + 'Start onboarding</button>';
    }

    var ob = d.onboarding || {};
    var pk = d.packages || {};
    var c = d.compliance || {};

    var notes = '';
    if (!d.settings.encryptionConfigured) {
      notes += '<div class="ob-note is-danger" role="alert"><strong>Encryption is not configured.</strong> '
        + 'Onboarding cannot collect tax or bank details until ONBOARDING_ENCRYPTION_KEY is set. '
        + 'Releasing an onboarding pack will be refused rather than storing those values unencrypted.</div>';
    }
    if (d.settings.industrialRelationsSystem === 'unknown') {
      notes += '<div class="ob-note is-warn"><strong>Which employment law system applies?</strong> '
        + 'The Fair Work information statements bind national system employers. In WA a sole trader '
        + 'or unincorporated partnership is generally in the state system instead, where they do not '
        + 'apply. Set this in Settings so the right statements are issued.</div>';
    }
    if (d.settings.ndisProviderStatus === 'unregistered') {
      notes += '<div class="ob-note is-info"><strong>NDIS provider status: unregistered.</strong> '
        + 'NDIS worker screening is required by law only for risk-assessed roles of registered '
        + 'providers, so it is applied here as an Opal policy requirement. The NDIS Code of Conduct '
        + 'still binds every worker.</div>';
    }

    var card = function (title, rows) {
      return '<div class="ob-card"><h3>' + esc(title) + '</h3>'
        + rows.map(function (r) {
          return '<div class="ob-stat' + (r[2] ? ' ' + r[2] : '') + '">'
            + '<span class="ob-stat-n">' + (r[1] || 0) + '</span>'
            + '<span class="ob-stat-l">' + esc(r[0]) + '</span></div>';
        }).join('')
        + '</div>';
    };

    pane.innerHTML = notes
      + '<div class="ob-grid">'
      + card('Packages', [
        ['Published', pk.published], ['Draft', pk.draft],
      ])
      + card('Onboarding', [
        ['Invited', (ob.created || 0) + (ob.invite_sent || 0)],
        ['In progress', (ob.invite_accepted || 0) + (ob.in_progress || 0)],
        ['Awaiting review', (ob.employee_actions_complete || 0) + (ob.employer_review || 0), 'is-warn'],
        ['Corrections required', ob.corrections_required || 0, ob.corrections_required ? 'is-alert' : ''],
        ['Ready to activate', ob.ready_to_activate || 0, ob.ready_to_activate ? 'is-ok' : ''],
        ['Completed', (ob.activated || 0) + (ob.completed || 0)],
      ])
      + card('Compliance', [
        ['Verification required', c.verificationRequired, c.verificationRequired ? 'is-warn' : ''],
        ['Credentials expiring', c.expiringSoon, c.expiringSoon ? 'is-warn' : ''],
        ['Expired', c.expired, c.expired ? 'is-alert' : ''],
        ['Overdue onboarding', d.overdue, d.overdue ? 'is-alert' : ''],
      ])
      + '</div>'
      + '<div class="ob-section-card"><div class="ob-section-head">'
      + '<h2>Needs attention</h2></div><div class="ob-section-body" id="ob-attention">'
      + spinner() + '</div></div>';

    var list = await api('/api/onboarding/assignments?active=1');
    var el = doc.getElementById('ob-attention');
    if (!el) return;
    if (!list.ok) { el.innerHTML = '<p class="ob-quiet">' + esc(list.error) + '</p>'; return; }

    var needs = (list.assignments || []).filter(function (a) {
      return ['employer_review', 'corrections_required', 'ready_to_activate'].indexOf(a.status) !== -1
        || a.overdue;
    });
    el.innerHTML = needs.length ? assignmentTable(needs)
      : '<p class="ob-quiet">Nothing waiting on you right now.</p>';
  }

  // ── Active onboarding ─────────────────────────────────────────────────────

  /**
   * Human labels for the assignment lifecycle.
   *
   * The MIRROR of STATUS_LABELS in onboarding-workflow-routes.js. Duplicated
   * deliberately and narrowly: this table renders rows from
   * /api/onboarding/assignments, which predates the journey endpoint and
   * returns the raw status. Teaching that endpoint to send a label would
   * change a response three other screens already read.
   *
   * `activated` says "Complete" because that IS what it means — the run is
   * finished and the person is staff.
   */
  var STATUS_TEXT = {
    created: 'Draft',
    starter_pack_ready: 'Starter pack ready',
    starter_pack_sent: 'Awaiting documents',
    documents_received: 'Documents received',
    details_extracted: 'Details ready for review',
    ready_for_account: 'Ready for account',
    account_created: 'Account created',
    invite_sent: 'Invitation sent',
    invite_accepted: 'Employee reviewing',
    in_progress: 'Employee reviewing',
    employee_actions_complete: 'Awaiting their submission',
    employer_review: 'Our review',
    corrections_required: 'Actions outstanding',
    ready_to_activate: 'Ready to activate',
    activated: 'Complete',
    completed: 'Complete',
    cancelled: 'Cancelled',
    archived: 'Archived',
  };

  function statusText(status) {
    return STATUS_TEXT[status] || titleCase(status);
  }

  /** The status chip, wearing its human label. */
  function statusChip(status) {
    return '<span class="ob-chip ' + esc(status) + '">' + esc(statusText(status)) + '</span>';
  }

  /**
   * How far through the WHOLE journey this person is.
   *
   * Their requirement meter only starts once an account exists, so it reads 0%
   * for everyone still in the paper round-trip — which is the opposite of the
   * truth for somebody whose forms have just come back. This counts journey
   * milestones instead, which is what an Owner scanning the list means by
   * "how far along is Jane?".
   */
  function journeyPercent(a) {
    var p = a.progress || {};
    var milestones = [
      !!a.starterPackGeneratedAt,
      !!a.starterPackSentAt,
      !!a.documentsReceivedAt,
      !!a.extractionCompletedAt,
      !!a.detailsReviewedAt,
      !!a.accountCreatedAt,
      !!a.invitationSentAt,
      !!a.firstLoginAt,
      ['activated', 'completed'].indexOf(a.status) !== -1,
    ];
    var done = milestones.filter(Boolean).length;
    // Once they are in the portal, their own progress is the better answer.
    if (a.firstLoginAt && p.employeeTotal) {
      return Math.round(((done - 1) / milestones.length) * 100
        + (p.employeeDone / p.employeeTotal) * (100 / milestones.length));
    }
    return Math.round((done / milestones.length) * 100);
  }

  function assignmentTable(rows) {
    return '<div class="ob-table-wrap"><table class="ob-table">'
      + '<thead><tr>'
      + '<th scope="col">Employee</th><th scope="col">Role</th><th scope="col">Package</th>'
      + '<th scope="col">Started</th><th scope="col">Status</th>'
      + '<th scope="col">Progress</th>'
      + '</tr></thead><tbody>'
      + rows.map(function (a) {
        var pct = journeyPercent(a);
        return '<tr class="ob-row-click" tabindex="0" role="link"'
          + ' onclick="Onboarding.openAssignment(\'' + jsq(a.id) + '\')"'
          + ' onkeydown="if(event.key===\'Enter\'){Onboarding.openAssignment(\'' + jsq(a.id) + '\')}">'
          + '<td><span class="ob-strong">' + esc(a.applicantName) + '</span></td>'
          + '<td>' + esc(a.jobTitle || '—') + '<br><span class="ob-quiet">'
          + esc(titleCase(a.employmentType)) + '</span></td>'
          // No version. Which version somebody is pinned to is a real fact and
          // it lives in their onboarding workspace, not in a list an Owner
          // scans to find a name.
          + '<td>' + esc(a.packageTitle) + '</td>'
          + '<td>' + fmtDate(a.createdAt || a.startDate) + '</td>'
          + '<td>' + statusChip(a.status)
          + (a.overdue ? ' <span class="ob-chip expired">Overdue</span>' : '') + '</td>'
          + '<td class="ob-num"><span class="ob-sr">'
          + esc(statusText(a.status)) + ', </span>' + pct + '%</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }

  async function viewActive(pane, actions) {
    if (actions && can('onboarding.assign')) {
      actions.innerHTML = '<button class="btn primary" onclick="Onboarding.assignDialog()">'
        + 'Start onboarding</button>';
    }
    var qs = [];
    if (S.filters.status) qs.push('status=' + encodeURIComponent(S.filters.status));
    if (S.filters.search) qs.push('search=' + encodeURIComponent(S.filters.search));
    var res = await api('/api/onboarding/assignments' + (qs.length ? '?' + qs.join('&') : ''));
    S.assignments = res;
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }

    // The paper round-trip states are offered too, so an Owner can ask the
    // question they actually have: "who am I waiting on documents from?"
    var STATUSES = ['created', 'starter_pack_ready', 'starter_pack_sent',
      'documents_received', 'details_extracted', 'ready_for_account',
      'account_created', 'invite_sent', 'invite_accepted', 'in_progress',
      'employee_actions_complete', 'employer_review', 'corrections_required',
      'ready_to_activate', 'activated', 'completed', 'cancelled', 'archived'];

    pane.innerHTML = ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head">'
      + '    <h2>Onboarding</h2>'
      + '    <div class="ob-inline-actions">'
      + '      <label for="ob-f-search" class="ob-sr">Search by name or email</label>'
      + '      <input type="text" id="ob-f-search" placeholder="Search name or email"'
      + '             value="' + esc(S.filters.search) + '"'
      + '             style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;font-size:13px;">'
      + '      <label for="ob-f-status" class="ob-sr">Filter by status</label>'
      + '      <select id="ob-f-status"'
      + '              style="padding:7px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-family:inherit;font-size:13px;">'
      + '        <option value="">All statuses</option>'
      + STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (S.filters.status === s ? ' selected' : '') + '>'
          + esc(statusText(s)) + '</option>';
      }).join('')
      + '      </select>'
      + '      <button class="btn ob-btn-sm" onclick="Onboarding.applyFilters()">Apply</button>'
      + '    </div>'
      + '  </div>'
      + '  <div class="ob-section-body is-flush">'
      + ((res.assignments || []).length
        ? assignmentTable(res.assignments)
        : empty('No active onboarding',
          'When you start onboarding a new employee, their progress will appear here.'))
      + '  </div>'
      + '</div>';
  }

  function applyFilters() {
    var s = doc.getElementById('ob-f-search');
    var st = doc.getElementById('ob-f-status');
    S.filters.search = s ? s.value.trim() : '';
    S.filters.status = st ? st.value : '';
    loadView('active');
  }

  // ── One assignment ────────────────────────────────────────────────────────

  async function openAssignment(id) {
    S.view = 'active';
    S.assignmentDetail = { id: id };
    await renderManage(root());
  }

  function backToActive() { S.assignmentDetail = null; loadView('active'); }

  async function viewAssignment(pane, actions) {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(S.assignmentDetail.id));
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }
    S.assignmentDetail.data = res;

    var a = res.assignment;
    var p = a.progress || {};
    var act = res.activation || { ok: false, blockers: [] };

    if (actions) {
      var buttons = '<button class="btn" onclick="Onboarding.backToActive()">Back to list</button>';
      if (can('onboarding.assign') && a.status === 'invite_sent') {
        buttons += ' <button class="btn" onclick="Onboarding.resendInvite()">Resend invitation</button>'
          + ' <button class="btn" onclick="Onboarding.showInviteLink()">Copy link</button>';
      }
      // The 034 shortcut, kept and made explicit: skip the paper round-trip and
      // send a secure link on which the new starter sets their own password.
      // That is the SAFER of the two credential models, so it stays one click
      // away rather than being replaced.
      if (can('onboarding.assign') && !a.userId
          && ['created', 'starter_pack_ready', 'starter_pack_sent',
            'documents_received', 'details_extracted', 'ready_for_account'].indexOf(a.status) !== -1) {
        buttons += ' <button class="btn" onclick="Onboarding.releaseDialog(\'' + jsq(a.id) + '\')">'
          + 'Invite them to the portal instead</button>';
      }
      if (can('onboarding.audit')) {
        buttons += ' <button class="btn" onclick="Onboarding.exportArchive()">Export record</button>';
      }
      // Activation needs an account to activate. Before one exists the server
      // refuses with "not released yet", so offering the button was a promise
      // the workflow could not keep — and on a Draft onboarding with no
      // requirements yet, `canActivate` is vacuously true.
      if (can('onboarding.activate') && res.canActivate && a.userId) {
        buttons += ' <button class="btn primary" onclick="Onboarding.activate()">Activate employee</button>';
      }
      actions.innerHTML = buttons;
    }

    var facts = a.facts || {};
    var factRows = [
      ['Employment type', titleCase(a.employmentType)],
      ['Role category', titleCase(a.roleCategory) || '—'],
      ['Start date', fmtDate(a.startDate)],
      ['Portal role on activation', titleCase(a.proposedRole)],
      ['Child-related work', titleCase(facts.child_related_work)],
      ['NDIS risk-assessed role', titleCase(facts.ndis_risk_assessed_role)],
      ['Mobile / community', facts.mobile_community_role ? 'Yes' : 'No'],
      ['Provider status at assignment', titleCase(facts.provider_status)],
    ];

    // Nothing to say about activation until there is somebody to activate.
    // "Ready to activate" over an empty requirement list is technically true
    // and completely misleading.
    var blockers = !a.userId
      ? ''
      : act.ok
        ? '<div class="ob-note is-ok"><strong>Ready to activate.</strong> '
          + 'Everything that must be done before they start is done.</div>'
        : '<div class="ob-note is-warn"><strong>' + act.blockers.length
          + ' item' + (act.blockers.length === 1 ? '' : 's')
          + ' still to finish before this person can start.</strong>'
          + '<ul style="margin:8px 0 0 18px;">'
          + act.blockers.map(function (b) {
            return '<li>' + esc(b.title) + ' — ' + esc(b.reason) + '</li>';
          }).join('')
          + '</ul></div>';

    var sensitive = '';
    if (can('onboarding.review')) {
      sensitive += '<button class="btn ob-btn-sm" onclick="Onboarding.showPersonal()">Personal details</button> ';
    }
    if (can('onboarding.payroll')) {
      sensitive += '<button class="btn ob-btn-sm" onclick="Onboarding.showPayroll()">Payroll</button> ';
    }
    if (can('onboarding.sensitive_identity')) {
      sensitive += '<button class="btn ob-btn-sm" onclick="Onboarding.showIdentity()">Identity records</button>';
    }

    pane.innerHTML = ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head">'
      + '    <div><h2>' + esc(a.applicantName) + '</h2>'
      + '      <p class="ob-quiet" style="margin:4px 0 0;">' + esc(a.jobTitle || '')
      + '        · ' + esc(a.packageTitle) + '</p></div>'
      + '    ' + statusChip(a.status)
      + '  </div>'
      + '  <div class="ob-section-body">'
      // The requirement meters only mean something once the requirements
      // exist, which is at account creation. Before then they read 0 of 0 at
      // 100%, which tells the Owner the opposite of the truth.
      + (a.userId
        ? '    <div class="ob-meters ob-mb-4">'
          + meter('Employee actions', p.employeeDone || 0, p.employeeTotal || 0, {
            note: 'What the new starter must do themselves.',
          })
          + meter('Employer verification', p.employerDone || 0, p.employerTotal || 0, {
            employer: true, note: 'Checks the practice must complete. Counted separately.',
          })
          + '    </div>'
        : '')
      + blockers
      + (sensitive ? '<div class="ob-inline-actions ob-mb-3">' + sensitive + '</div>' : '')
      + '    <div class="ob-table-wrap"><table class="ob-table"><tbody>'
      + factRows.map(function (r) {
        return '<tr><th scope="row" style="text-align:left;font-weight:600;color:var(--ink-soft);'
          + 'text-transform:none;letter-spacing:0;font-size:13px;">' + esc(r[0]) + '</th>'
          + '<td>' + esc(r[1]) + '</td></tr>';
      }).join('')
      + '    </tbody></table></div>'
      + '  </div>'
      + '</div>'
      // The journey panel loads on its own so the details above paint
      // immediately: it makes six queries, and an Owner staring at a spinner
      // for all of them would be a worse trade than a panel that fills in.
      + '<div id="ob-journey-host">' + spinner('Loading progress…') + '</div>'
      + (res.sections || []).map(renderReviewSection).join('');

    await loadJourney();
  }

  function renderReviewSection(section) {
    return ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head"><h2>' + esc(section.label) + '</h2>'
      + '    <span class="ob-quiet">' + section.employeeDone + ' of ' + section.employeeTotal
      + '      employee item' + (section.employeeTotal === 1 ? '' : 's') + ' done</span></div>'
      + '  <div class="ob-section-body is-flush"><div class="ob-req-list">'
      + section.requirements.map(renderReviewRequirement).join('')
      + '  </div></div>'
      + '</div>';
  }

  function renderReviewRequirement(r) {
    var meta = [];
    meta.push(titleCase(r.classification));
    if (r.blocksActivation) meta.push('Required before they start');
    if (!r.mandatory) meta.push('Optional');
    if (r.requiresEmployerVerification) meta.push('Needs verification');
    if (r.expiresAt) meta.push('Expires ' + fmtDate(r.expiresAt));

    var evidence = '';
    if (r.credentialName) {
      evidence += '<div class="ob-req-sub">' + esc(r.credentialName)
        + (r.credentialExpiry ? ' · expires ' + fmtDate(r.credentialExpiry) : '')
        + (r.credentialLifecycleStatus
          ? ' · ' + chip(r.credentialLifecycleStatus) : '') + '</div>';
    }
    if (r.evidenceFileName) {
      evidence += '<div class="ob-req-sub">Evidence: ' + esc(r.evidenceFileName) + '</div>';
    }
    if (r.learningStatus) {
      evidence += '<div class="ob-req-sub">Learning: ' + esc(titleCase(r.learningStatus))
        + ' (' + (r.learningProgress || 0) + '%)</div>';
    }
    if (r.compliance) {
      evidence += '<div class="ob-req-sub">' + basisChip(r.compliance.basis) + ' '
        + esc(r.compliance.sourceOrg || '') + '</div>';
    }
    if (r.waived) {
      evidence += '<div class="ob-correction"><strong>Waived</strong>' + esc(r.waivedReason || '') + '</div>';
    } else if (r.status === 'correction_required' && r.reviewReason) {
      evidence += '<div class="ob-correction"><strong>Correction requested</strong>'
        + esc(r.reviewReason) + '</div>';
    }

    var buttons = '';
    var done = ['verified', 'complete', 'not_applicable'].indexOf(r.status) !== -1;
    if (!done) {
      if (r.requiresEmployerVerification && can('onboarding.verify')) {
        buttons += '<button class="btn primary ob-btn-sm" onclick="Onboarding.verifyDialog(\''
          + jsq(r.id) + '\')">Verify</button> ';
      } else if (can('onboarding.review')) {
        buttons += '<button class="btn primary ob-btn-sm" onclick="Onboarding.reviewAction(\''
          + jsq(r.id) + '\',\'approve\')">Approve</button> ';
      }
      if (can('onboarding.review')) {
        buttons += '<button class="btn ob-btn-sm" onclick="Onboarding.correctionDialog(\''
          + jsq(r.id) + '\')">Request correction</button> '
          + '<button class="btn ob-btn-sm" onclick="Onboarding.notApplicableDialog(\''
          + jsq(r.id) + '\')">Not applicable</button> ';
      }
      if (r.blocksActivation && user().role === 'owner') {
        buttons += '<button class="btn ob-btn-sm" onclick="Onboarding.waiveDialog(\''
          + jsq(r.id) + '\',\'' + jsq(r.title) + '\')">Waive</button>';
      }
    }

    return ''
      + '<div class="ob-req' + (r.status === 'correction_required' ? ' is-action-required' : '') + '">'
      + '  <div class="ob-req-main">'
      + '    <div class="ob-req-title">' + esc(r.title) + ' ' + chip(r.status)
      + (r.blocksActivation
        ? ' <span class="ob-chip is-blocking">Required before they start</span>' : '')
      + '    </div>'
      + (r.summary ? '<div class="ob-req-sub">' + esc(r.summary) + '</div>' : '')
      + evidence
      + '    <div class="ob-req-meta">' + meta.map(esc).join(' · ') + '</div>'
      + '  </div>'
      + '  <div class="ob-req-actions">' + buttons + '</div>'
      + '</div>';
  }

  // ── Review actions ────────────────────────────────────────────────────────

  function assignmentId() { return S.assignmentDetail && S.assignmentDetail.id; }

  async function reviewAction(requirementId, action, body) {
    if (S.busy) return;
    S.busy = true;
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/requirements/' + encodeURIComponent(requirementId) + '/' + action, {
      method: 'POST', body: body || {},
    });
    S.busy = false;
    if (!res.ok) { toast(res.error, true); return false; }
    closeModal();
    toast('Updated');
    await loadView('active');
    return true;
  }

  function verifyDialog(requirementId) {
    openModal({
      title: 'Record verification',
      subtitle: 'Confirm you have checked this against the issuing authority, not just the '
        + 'employee\'s own copy.',
      body: ''
        + '<div class="ob-note is-info">Record what the authority actually says. A verification '
        + 'here is a statement of fact about an external register — it is not a decision you can '
        + 'make on the employee\'s behalf.</div>'
        + '<div class="ob-field ob-mb-3">'
        + '  <label for="ob-v-expiry">Expiry date (if the credential has one)</label>'
        + '  <input type="date" id="ob-v-expiry" name="expiresAt">'
        + '</div>'
        + '<div class="ob-field">'
        + '  <label for="ob-v-reason">Note (optional)</label>'
        + '  <textarea id="ob-v-reason" name="reason" maxlength="1000"'
        + '            placeholder="e.g. Checked against the Ahpra Register of Practitioners"></textarea>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitVerify(\'' + jsq(requirementId) + '\')">'
        + 'Record verification</button>',
    });
  }

  function submitVerify(requirementId) {
    var v = modalValues();
    reviewAction(requirementId, 'verify', {
      expiresAt: v.expiresAt || undefined, reason: v.reason || undefined,
    });
  }

  function correctionDialog(requirementId) {
    openModal({
      title: 'Request a correction',
      subtitle: 'Only this requirement reopens — the rest of their progress is untouched.',
      body: '<div class="ob-field">'
        + '  <label for="ob-c-reason">What needs fixing?<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '  <textarea id="ob-c-reason" name="reason" maxlength="1000" required'
        + '            aria-describedby="ob-c-hint"'
        + '            placeholder="e.g. The photo of your driver licence is too blurry to read."></textarea>'
        + '  <p class="ob-hint" id="ob-c-hint">This message is shown to the employee, so write it to them.</p>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitCorrection(\'' + jsq(requirementId) + '\')">'
        + 'Send to employee</button>',
    });
  }

  function submitCorrection(requirementId) {
    var v = modalValues();
    if (!v.reason || !v.reason.trim()) { modalError('Please say what needs fixing.'); return; }
    reviewAction(requirementId, 'request-correction', { reason: v.reason.trim() });
  }

  function notApplicableDialog(requirementId) {
    openModal({
      title: 'Mark not applicable',
      subtitle: 'A reason is required and is kept on the employee\'s compliance record.',
      body: '<div class="ob-field">'
        + '  <label for="ob-na-reason">Why does this not apply?<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '  <textarea id="ob-na-reason" name="reason" maxlength="1000" required'
        + '            placeholder="e.g. WWCC not required — the role does not involve child-related work."></textarea>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitNotApplicable(\'' + jsq(requirementId) + '\')">'
        + 'Mark not applicable</button>',
    });
  }

  function submitNotApplicable(requirementId) {
    var v = modalValues();
    if (!v.reason || !v.reason.trim()) { modalError('Please give a reason.'); return; }
    reviewAction(requirementId, 'not-applicable', { reason: v.reason.trim() });
  }

  function waiveDialog(requirementId, title) {
    openModal({
      title: 'Waive a requirement',
      subtitle: title,
      body: '<div class="ob-note is-warn">A waiver relaxes an <strong>Opal</strong> requirement. '
        + 'It cannot be used on registration, screening or work-rights checks — those record what '
        + 'the issuing authority actually says, and nothing here may change that.</div>'
        + '<div class="ob-field">'
        + '  <label for="ob-w-reason">Reason<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '  <textarea id="ob-w-reason" name="reason" maxlength="1000" required'
        + '            placeholder="e.g. Police check waived — role has no participant contact."></textarea>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitWaive(\'' + jsq(requirementId) + '\')">'
        + 'Waive with reason</button>',
    });
  }

  function submitWaive(requirementId) {
    var v = modalValues();
    if (!v.reason || !v.reason.trim()) { modalError('A reason is required to waive a requirement.'); return; }
    reviewAction(requirementId, 'waive', { reason: v.reason.trim() });
  }

  async function activate() {
    var a = S.assignmentDetail && S.assignmentDetail.data && S.assignmentDetail.data.assignment;
    if (!a) return;
    openModal({
      title: 'Activate ' + a.applicantName,
      subtitle: 'This converts their restricted onboarding account into a full portal account.',
      body: '<div class="ob-note is-info">On activation they receive the '
        + '<strong>' + esc(titleCase(a.proposedRole)) + '</strong> role, their employment and '
        + 'compliance records go live, payroll setup is queued, and their onboarding history is '
        + 'kept in full.</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.confirmActivate()">Activate employee</button>',
    });
  }

  async function confirmActivate() {
    if (S.busy) return;
    S.busy = true;
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId()) + '/activate', {
      method: 'POST', body: {},
    });
    S.busy = false;
    if (!res.ok) {
      if (res.code === 'activation_blocked' && res.details && res.details.blockers) {
        modalError('Still blocked: ' + res.details.blockers.map(function (b) { return b.title; }).join(', '));
        return;
      }
      modalError(res.error);
      return;
    }
    closeModal();
    toast('Employee activated');
    await loadView('active');
  }

  async function resendInvite() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/resend-invite', { method: 'POST', body: {} });
    if (!res.ok) { toast(res.error, true); return; }
    toast(res.emailSent ? 'Invitation resent'
      : 'Email is not configured — use “Copy link” to share it manually', !res.emailSent);
  }

  async function showInviteLink() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/invite-link');
    if (!res.ok) { toast(res.error, true); return; }
    openModal({
      title: 'Onboarding link',
      subtitle: 'Share this only with the person it was issued to. It expires '
        + fmtDate(res.expiresAt) + '.',
      body: '<div class="ob-field">'
        + '  <label for="ob-link">Secure onboarding link</label>'
        + '  <input type="text" id="ob-link" readonly value="' + esc(res.onboardingUrl) + '"'
        + '         onclick="this.select()">'
        + '  <p class="ob-hint">Anyone holding this link can set the password for that account, '
        + '     so send it directly to them and nowhere else.</p>'
        + '</div>',
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Done</button>',
    });
  }

  // ── Sensitive views ───────────────────────────────────────────────────────

  async function showPersonal() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/personal-details');
    if (!res.ok) { toast(res.error, true); return; }
    var d = res.personalDetails;
    if (!d) { openModal({ title: 'Personal details', body: empty('Not provided yet', '') }); return; }
    var rows = [
      ['Legal name', [d.legal_first_name, d.middle_name, d.surname].filter(Boolean).join(' ')],
      ['Preferred name', d.preferred_name],
      ['Date of birth', fmtDate(d.date_of_birth)],
      ['Personal email', d.personal_email],
      ['Mobile', d.mobile],
      ['Address', [d.address_line1, d.address_line2, d.suburb, d.state, d.postcode].filter(Boolean).join(', ')],
      ['Emergency contact', d.emergency_name],
      ['Relationship', d.emergency_relationship],
      ['Emergency phone', d.emergency_phone],
    ];
    openModal({
      title: 'Personal details',
      subtitle: 'Viewing this is recorded in the audit log.',
      body: detailTable(rows),
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
    });
  }

  async function showPayroll() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId()) + '/payroll');
    if (!res.ok) { toast(res.error, true); return; }
    var p = res.payroll;
    if (!p) { openModal({ title: 'Payroll', body: empty('Not provided yet', '') }); return; }
    openModal({
      title: 'Payroll',
      subtitle: 'Masked values only. Viewing this is recorded in the audit log.',
      body: '<div class="ob-note is-info">Full bank and tax file numbers are never displayed. '
        + 'They are released once, to the payroll export, which is owner-only and separately audited.</div>'
        + detailTable([
          ['Account holder', p.accountHolderName],
          ['BSB', p.bsbMasked ? '<span class="ob-masked">' + esc(p.bsbMasked) + '</span>' : null, true],
          ['Account number', p.accountNumberLast4
            ? '<span class="ob-masked">••••' + esc(p.accountNumberLast4) + '</span>' : null, true],
          ['Bank status', titleCase(p.bankStatus)],
          ['Tax setup', titleCase(p.taxSetupStatus)],
          ['Tax method', titleCase(p.taxSubmissionMethod)],
          ['Residency', titleCase(p.residencyStatus)],
          ['TFN provided', p.tfnProvided ? 'Yes ('
            + (p.tfnLast3 ? '<span class="ob-masked">•••-•••-' + esc(p.tfnLast3) + '</span>' : 'recorded')
            + ')' : 'No', true],
          ['Tax-free threshold', p.claimsTaxFreeThreshold === null ? '—' : (p.claimsTaxFreeThreshold ? 'Claimed' : 'Not claimed')],
          ['Study loan', p.hasStudyLoan === null ? '—' : (p.hasStudyLoan ? 'Yes' : 'No')],
          ['Super status', titleCase(p.superStatus)],
          ['Super choice', titleCase(p.superChoiceType)],
          ['Fund', p.superFundName],
          ['Fund ABN', p.superFundAbn],
          ['USI', p.superFundUsi],
          ['Member number', p.superMemberNumber],
          ['SMSF ESA', p.smsfEsa],
          ['Payroll setup', titleCase(p.payrollSetupStatus)],
        ]),
      footer: (user().role === 'owner'
        ? '<button class="btn" onclick="Onboarding.payrollExportDialog()">Export for payroll</button>' : '')
        + '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
    });
  }

  function payrollExportDialog() {
    openModal({
      title: 'Export for payroll',
      subtitle: 'This is the only place full tax and bank values are released.',
      body: '<div class="ob-note is-warn">The export contains the employee\'s full tax file number '
        + 'and bank account. Use it to configure payroll and nothing else — do not save it, forward '
        + 'it, or paste it anywhere. The export is recorded in the audit log with your reason.</div>'
        + '<div class="ob-field">'
        + '  <label for="ob-x-reason">Reason<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '  <textarea id="ob-x-reason" name="reason" maxlength="500" required'
        + '            placeholder="e.g. Configuring the employee in payroll before their first pay run."></textarea>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitPayrollExport()">Export</button>',
    });
  }

  async function submitPayrollExport() {
    var v = modalValues();
    if (!v.reason || !v.reason.trim()) { modalError('A reason is required.'); return; }
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/payroll-export', { method: 'POST', body: { reason: v.reason.trim() } });
    if (!res.ok) { modalError(res.error); return; }
    var p = res.payroll || {};
    openModal({
      title: 'Payroll export',
      subtitle: 'Recorded in the audit log. Close this window when you are done.',
      body: '<div class="ob-note is-danger">This window shows full values. Close it as soon as '
        + 'payroll is configured.</div>'
        + detailTable([
          ['Legal name', [res.employee.legalFirstName, res.employee.middleName, res.employee.surname]
            .filter(Boolean).join(' ')],
          ['Date of birth', fmtDate(res.employee.dateOfBirth)],
          ['Tax file number', p.tfn],
          ['Residency', titleCase(p.residencyStatus)],
          ['Tax-free threshold', p.claimsTaxFreeThreshold ? 'Claimed' : 'Not claimed'],
          ['Study loan', p.hasStudyLoan ? 'Yes' : 'No'],
          ['Account holder', p.accountHolderName],
          ['BSB', p.bsb],
          ['Account number', p.accountNumber],
          ['Super fund', p.superFundName],
          ['Fund ABN', p.superFundAbn],
          ['USI', p.superFundUsi],
          ['Member number', p.superMemberNumber],
          ['SMSF ESA', p.smsfEsa],
        ]),
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Done</button>',
    });
  }

  async function showIdentity() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId()) + '/identity');
    if (!res.ok) { toast(res.error, true); return; }
    var records = res.identityRecords || [];
    openModal({
      title: 'Identity and work rights',
      subtitle: 'Masked values only. Viewing this is recorded in the audit log.',
      wide: true,
      body: '<div class="ob-note is-info">Opal records that a document was <strong>sighted</strong> '
        + 'rather than keeping a copy of it. Home Affairs asks employers to retain the work-rights '
        + 'check result, not the travel document, and holding fewer copies is both less to protect '
        + 'and less to destroy later.</div>'
        + (records.length ? records.map(function (r) {
          return '<div class="ob-section-card"><div class="ob-section-body">'
            + detailTable([
              ['Type', titleCase(r.record_kind) + ' — ' + titleCase(r.evidence_type)],
              ['Name on document', r.name_on_document],
              ['Document number', r.document_number_last4
                ? '<span class="ob-masked">••••' + esc(r.document_number_last4) + '</span>' : null, true],
              ['Country of issue', r.country_of_issue],
              ['Expiry', fmtDate(r.expiry_date)],
              ['Right to work basis', titleCase(r.right_to_work_basis)],
              ['Visa subclass', r.visa_subclass],
              ['Work rights expiry', r.work_rights_expiry ? fmtDate(r.work_rights_expiry) : '—'],
              ['Copy retained', r.copy_retained ? 'Yes — ' + (r.retention_reason || 'no reason recorded') : 'No (sighted only)'],
              ['Verification', titleCase(r.verification_status)
                + (r.verification_method ? ' via ' + titleCase(r.verification_method) : '')],
              ['Verified at', r.verified_at ? fmtDate(r.verified_at) : '—'],
            ])
            + '</div></div>';
        }).join('') : empty('Not provided yet', '')),
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
    });
  }

  function detailTable(rows) {
    return '<div class="ob-table-wrap"><table class="ob-table"><tbody>'
      + rows.filter(function (r) { return r[1] !== null && r[1] !== undefined && r[1] !== ''; })
        .map(function (r) {
          return '<tr><th scope="row" style="text-align:left;text-transform:none;letter-spacing:0;'
            + 'font-size:13px;font-weight:600;color:var(--ink-soft);white-space:nowrap;">'
            + esc(r[0]) + '</th><td>' + (r[2] ? r[1] : esc(r[1])) + '</td></tr>';
        }).join('')
      + '</tbody></table></div>';
  }

  async function exportArchive() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/archive-export', { method: 'POST', body: {} });
    if (!res.ok) { toast(res.error, true); return; }
    openModal({
      title: 'Onboarding record',
      subtitle: res.note,
      wide: true,
      body: '<div class="ob-note is-info">' + esc(res.note) + '</div>'
        + '<div class="ob-doc">' + esc(JSON.stringify(res, null, 2)) + '</div>',
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
    });
  }

  // ── Assign dialog ─────────────────────────────────────────────────────────

  async function assignDialog() {
    var pkgs = S.packages && S.packages.ok ? S.packages : await api('/api/onboarding/packages');
    S.packages = pkgs;
    if (!pkgs.ok) { toast(pkgs.error, true); return; }
    var assignable = (pkgs.packages || []).filter(function (p) {
      return p.kind === 'package' && p.status === 'published';
    });
    if (!assignable.length) {
      toast('Publish a package before assigning onboarding', true);
      return;
    }

    openModal({
      title: 'Start onboarding',
      subtitle: 'Nothing is sent yet — you prepare the starter pack on the next screen.',
      wide: true,
      body: ''
        + '<div class="ob-form">'
        // WHO, then WHAT THEY DO, then — recommended from those two — WHICH
        // PACKAGE. The package used to be the first question, which asked the
        // Owner to make the technical choice before the human one.
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><label for="ob-a-name">Full name<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <input type="text" id="ob-a-name" name="applicantName" required maxlength="200"></div>'
        + '    <div class="ob-field"><label for="ob-a-email">Email<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <input type="email" id="ob-a-email" name="applicantEmail" required maxlength="255"'
        + '             aria-describedby="ob-a-email-hint">'
        + '      <p class="ob-hint" id="ob-a-email-hint">Where the starter pack goes. It becomes their '
        + '        sign-in unless you give them an Opal address later.</p></div>'
        + '  </div>'
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><label for="ob-a-title">Role / position</label>'
        + '      <input type="text" id="ob-a-title" name="jobTitle" maxlength="150"'
        + '             placeholder="e.g. Occupational Therapist"></div>'
        + '    <div class="ob-field"><label for="ob-a-mobilenum">Mobile (optional)</label>'
        + '      <input type="tel" id="ob-a-mobilenum" name="mobile" maxlength="40"></div>'
        + '  </div>'
        + '  <div class="ob-form-row is-thirds">'
        + '    <div class="ob-field"><label for="ob-a-rolecat">Role category</label>'
        + '      <select id="ob-a-rolecat" name="roleCategory" onchange="Onboarding.recommendPackage()">'
        + '        <option value="occupational_therapist">Occupational therapist</option>'
        + '        <option value="administration">Administration</option>'
        + '      </select></div>'
        + '    <div class="ob-field"><label for="ob-a-emptype">Employment type<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <select id="ob-a-emptype" name="employmentType" required onchange="Onboarding.recommendPackage()">'
        + '        <option value="full_time">Full-time</option>'
        + '        <option value="part_time">Part-time</option>'
        + '        <option value="casual">Casual</option>'
        + '        <option value="fixed_term">Fixed-term</option>'
        + '      </select></div>'
        + '    <div class="ob-field"><label for="ob-a-start">Start date</label>'
        + '      <input type="date" id="ob-a-start" name="startDate"></div>'
        + '  </div>'
        + '  <div class="ob-form-row is-single"><div class="ob-field">'
        + '    <label for="ob-a-package">Onboarding package<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '    <select id="ob-a-package" name="packageId" required>'
        + assignable.map(function (p) {
          return '<option value="' + esc(p.id) + '" data-type="' + esc(p.employmentType || '')
            + '" data-role="' + esc(p.roleCategory || '') + '">' + esc(p.title) + '</option>';
        }).join('')
        + '    </select>'
        + '    <p class="ob-hint" id="ob-a-package-hint" aria-live="polite"></p>'
        + '  </div></div>'
        + '  <div class="ob-form-row is-single"><div class="ob-field">'
        + '    <label for="ob-a-role">Portal access when they join</label>'
        + '    <select id="ob-a-role" name="proposedRole">'
        + '      <option value="therapist">Employee — their own calendar, clients and records</option>'
        + '      <option value="admin">Admin — practice-wide scheduling and travel</option>'
        + '      <option value="read_only">Read-only</option>'
        + '    </select>'
        + '    <p class="ob-hint">You confirm this again when you create their account.</p>'
        + '  </div></div>'
        + '  <div class="ob-note is-info">These determinations decide which statutory requirements '
        + '    are issued. They follow the role\'s <strong>usual duties</strong>, not its job title, '
        + '    and an undecided answer deliberately issues the requirement rather than skipping it.</div>'
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><label for="ob-a-child">Child-related work</label>'
        + '      <select id="ob-a-child" name="childRelatedWork" aria-describedby="ob-a-child-hint">'
        + '        <option value="assessment_required">Not yet determined</option>'
        + '        <option value="yes">Yes</option>'
        + '        <option value="no">No</option>'
        + '      </select>'
        + '      <p class="ob-hint" id="ob-a-child-hint">Drives the WA Working with Children Check.</p></div>'
        + '    <div class="ob-field"><label for="ob-a-risk">NDIS risk-assessed role</label>'
        + '      <select id="ob-a-risk" name="ndisRiskAssessedRole" aria-describedby="ob-a-risk-hint">'
        + '        <option value="requires_determination">Not yet determined</option>'
        + '        <option value="yes">Yes</option>'
        + '        <option value="no">No</option>'
        + '      </select>'
        + '      <p class="ob-hint" id="ob-a-risk-hint">More than incidental contact with participants.</p></div>'
        + '  </div>'
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><div class="ob-check">'
        + '      <input type="checkbox" id="ob-a-mobile" name="mobileCommunityRole">'
        + '      <label for="ob-a-mobile">Mobile / community role (home and community visits)</label>'
        + '    </div></div>'
        + '    <div class="ob-field"><div class="ob-check">'
        + '      <input type="checkbox" id="ob-a-vehicle" name="usesOwnVehicle">'
        + '      <label for="ob-a-vehicle">Uses their own vehicle for work</label>'
        + '    </div></div>'
        + '  </div>'
        + '  <div class="ob-form-row is-single"><div class="ob-field">'
        + '    <label for="ob-a-note">Note for the new starter (optional)</label>'
        + '    <textarea id="ob-a-note" name="ownerNote" maxlength="2000"></textarea>'
        + '  </div></div>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn" onclick="Onboarding.previewAssign()">Preview requirements</button>'
        + '<button class="btn primary" onclick="Onboarding.submitAssign()">Start onboarding</button>',
    });

    recommendPackage();
  }

  /**
   * Suggest the package that matches the role and employment type chosen.
   *
   * A SUGGESTION, not a selection: it moves the dropdown and says why, and the
   * Owner can change it back. Silently pre-selecting would be the same
   * mechanic with the check removed.
   *
   * The scoring lives on the server, so this and the API agree by construction
   * rather than by two implementations happening to match.
   */
  async function recommendPackage() {
    var hint = doc.getElementById('ob-a-package-hint');
    var select = doc.getElementById('ob-a-package');
    if (!hint || !select) return;

    var v = modalValues();
    var qs = 'roleCategory=' + encodeURIComponent(v.roleCategory || '')
      + '&employmentType=' + encodeURIComponent(v.employmentType || '');
    var res = await api('/api/onboarding/packages/recommend?' + qs);
    if (!res.ok || !res.recommended) {
      hint.textContent = 'Choose the package that matches this role.';
      return;
    }
    // Only move the selection while the Owner has not overridden it.
    if (!select.dataset.touched) select.value = res.recommended.packageId;
    hint.textContent = 'Recommended: ' + res.recommended.title + '. '
      + res.recommended.reason + ' You can choose a different one.';
    select.onchange = function () { select.dataset.touched = '1'; };
  }

  function assignPayload() {
    var v = modalValues();
    return {
      packageId: v.packageId,
      applicantName: (v.applicantName || '').trim(),
      applicantEmail: (v.applicantEmail || '').trim(),
      jobTitle: v.jobTitle || undefined,
      mobile: v.mobile || undefined,
      startDate: v.startDate || undefined,
      employmentType: v.employmentType,
      roleCategory: v.roleCategory,
      proposedRole: v.proposedRole,
      isTreatingTherapist: v.roleCategory === 'occupational_therapist',
      childRelatedWork: v.childRelatedWork,
      ndisRiskAssessedRole: v.ndisRiskAssessedRole,
      mobileCommunityRole: !!v.mobileCommunityRole,
      usesOwnVehicle: !!v.usesOwnVehicle,
      ownerNote: v.ownerNote || undefined,
    };
  }

  async function previewAssign() {
    var p = assignPayload();
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(p.packageId) + '/preview', {
      method: 'POST',
      body: {
        facts: {
          employment_type: p.employmentType,
          role_category: p.roleCategory,
          proposed_role: p.proposedRole,
          is_treating_therapist: p.isTreatingTherapist,
          child_related_work: p.childRelatedWork,
          ndis_risk_assessed_role: p.ndisRiskAssessedRole,
          mobile_community_role: p.mobileCommunityRole,
          uses_own_vehicle: p.usesOwnVehicle,
        },
      },
    });
    if (!res.ok) { modalError(res.error); return; }
    openModal({
      title: 'What this person will be asked for',
      subtitle: res.appliedCount + ' items · ' + res.blockingCount + ' required before they start',
      wide: true,
      body: res.sections.map(function (s) {
        return '<div class="ob-builder-section"><h3>' + esc(s.label) + '</h3>'
          + s.requirements.map(function (r) {
            return '<div class="ob-builder-item">'
              + '<span class="ob-tick' + (r.mandatory ? '' : ' is-optional') + '" aria-hidden="true">'
              + (r.mandatory ? '✓' : '○') + '</span>'
              + '<span class="ob-builder-item-main">'
              + '<span class="ob-builder-item-title">' + esc(r.title) + '</span>'
              + (r.compliance ? '<span class="ob-builder-item-cond">' + esc(r.compliance.sourceOrg || '')
                + '</span>' : '')
              + '</span>'
              + (r.blocksActivation
                ? '<span class="ob-chip is-blocking">Required before they start</span>' : '')
              + '</div>';
          }).join('')
          + '</div>';
      }).join('')
      + (res.skipped && res.skipped.length
        ? '<div class="ob-note ob-mt-4"><strong>Not applicable to this person</strong><ul style="margin:8px 0 0 18px;">'
          + res.skipped.map(function (s) {
            return '<li>' + esc(s.title) + ' <span class="ob-quiet">— ' + esc(s.rule) + '</span></li>';
          }).join('') + '</ul></div>'
        : ''),
      footer: '<button class="btn primary" onclick="Onboarding.assignDialog()">Back</button>',
    });
  }

  async function submitAssign() {
    var p = assignPayload();
    if (!p.applicantName) { modalError('A full name is required.'); return; }
    if (!p.applicantEmail || p.applicantEmail.indexOf('@') === -1) {
      modalError('A valid email address is required.'); return;
    }
    if (S.busy) return;
    S.busy = true;
    var res = await api('/api/onboarding/assignments', { method: 'POST', body: p });
    S.busy = false;
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Onboarding started — prepare their starter pack next');
    S.view = 'active';
    S.assignmentDetail = { id: res.assignment.id };
    // Straight into the workspace, which tells them the next step. This used
    // to open the release dialog immediately, which sent an invitation before
    // the new starter had received a single form — and skipped the whole paper
    // round-trip the workflow now exists for. Releasing is still available,
    // from the workspace, for an Owner who genuinely wants to go straight to
    // the portal.
    await renderManage(root());
  }

  function releaseDialog(id, preview) {
    openModal({
      title: 'Invite them straight to the portal?',
      subtitle: 'Skips the starter pack — they set their own password on a secure link.',
      body: '<div class="ob-note is-info">'
        + (preview ? '<strong>' + preview.willIssue + ' requirements</strong> will be issued, '
          + '<strong>' + preview.blocking + '</strong> of which must be done before they start.' : '')
        + '</div>'
        + '<div class="ob-note">The email contains a secure link and nothing else — no password, '
        + 'no employment terms, no personal details. Everything sensitive is collected inside the '
        + 'portal.</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Not yet</button>'
        + '<button class="btn primary" onclick="Onboarding.confirmRelease(\'' + jsq(id) + '\')">'
        + 'Release and send invitation</button>',
    });
  }

  async function confirmRelease(id) {
    if (S.busy) return;
    S.busy = true;
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(id) + '/release', {
      method: 'POST', body: {},
    });
    S.busy = false;
    if (!res.ok) {
      if (res.code === 'documents_unpublished' && res.details && res.details.documents) {
        modalError(res.error + ': ' + res.details.documents.map(function (d) {
          return d.title;
        }).join(', ') + '. Publish these in the Document Library first.');
        return;
      }
      modalError(res.error);
      return;
    }
    closeModal();
    if (res.emailSent) toast('Invitation sent');
    else toast('Released — email is not configured, use “Copy link” to share it', true);
    await loadView('active');
  }

  // ── Packages ──────────────────────────────────────────────────────────────

  async function viewPackages(pane, actions) {
    var res = await api('/api/onboarding/packages');
    S.packages = res;
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }

    // The Owner's list is the assignable packages. Bases and overlays are the
    // composition machinery — real, useful, and not what somebody opens this
    // screen to look at — so they sit behind a disclosure rather than as two
    // more tables of equal weight.
    var assignable = (res.packages || []).filter(function (p) { return p.kind === 'package'; });
    var building = (res.packages || []).filter(function (p) { return p.kind !== 'package'; });

    if (!assignable.length && !building.length) {
      pane.innerHTML = '<div class="ob-section-card"><div class="ob-section-body">'
        + empty('No packages yet',
          'A package decides what a new starter receives and what they must complete. '
          + 'Opal\'s standard packages are created the first time onboarding is set up.')
        + '</div></div>';
      return;
    }

    pane.innerHTML = ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head"><h2>Packages</h2>'
      + '    <span class="ob-quiet">' + assignable.length + ' available to new starters</span></div>'
      + '  <div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
      + '<thead><tr><th scope="col">Package</th><th scope="col">Applies to</th>'
      + '<th scope="col">Status</th><th scope="col">Assigned to</th></tr></thead><tbody>'
      + assignable.map(function (p) {
        var people = p.assignmentCount || 0;
        return '<tr class="ob-row-click" tabindex="0" role="link"'
          + ' onclick="Onboarding.openPackage(\'' + jsq(p.id) + '\')"'
          + ' onkeydown="if(event.key===\'Enter\'){Onboarding.openPackage(\'' + jsq(p.id) + '\')}">'
          // The PKG_ code is gone. It remains the stable identifier underneath
          // and in the API; an Owner choosing a package for Jane does not need
          // to read it, and printing it under the name made the screen look
          // like a database table.
          + '<td><span class="ob-strong">' + esc(p.title) + '</span></td>'
          + '<td>' + esc([titleCase(p.roleCategory), titleCase(p.employmentType)]
            .filter(Boolean).join(' · ') || 'Any role') + '</td>'
          + '<td>' + chip(p.status)
          + (p.draftDirty && p.currentVersion
            ? ' <span class="ob-chip in_progress">Unpublished changes</span>' : '') + '</td>'
          // "Assigned to 3 people" rather than a bare 3 under "In use", and
          // counting only LIVE runs — the query behind it excludes cancelled
          // and archived, so the sentence is true.
          + '<td>' + (people
            ? esc(people + ' ' + (people === 1 ? 'person' : 'people'))
            : '<span class="ob-quiet">Nobody yet</span>') + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></div></div>'
      + (building.length
        ? '<details class="ob-details"><summary>How these are built</summary>'
          + '<div class="ob-note is-info">Packages are <strong>composed</strong>, not copied. '
          + 'Each one inherits a shared base plus the parts that apply to it, so adding a '
          + 'requirement for every new starter is one edit rather than six that can drift apart.'
          + '</div>'
          + '<div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Building block</th><th scope="col">Applies to</th>'
          + '<th scope="col">Status</th></tr></thead><tbody>'
          + building.map(function (p) {
            return '<tr class="ob-row-click" tabindex="0" role="link"'
              + ' onclick="Onboarding.openPackage(\'' + jsq(p.id) + '\')"'
              + ' onkeydown="if(event.key===\'Enter\'){Onboarding.openPackage(\'' + jsq(p.id) + '\')}">'
              + '<td><span class="ob-strong">' + esc(p.title) + '</span></td>'
              + '<td>' + esc([titleCase(p.roleCategory), titleCase(p.employmentType)]
                .filter(Boolean).join(' · ') || 'Any role') + '</td>'
              + '<td>' + chip(p.status) + '</td></tr>';
          }).join('')
          + '</tbody></table></div></details>'
        : '');
  }

  async function openPackage(id) {
    S.view = 'packages';
    S.packageDetail = { id: id };
    await renderManage(root());
  }

  function backToPackages() { S.packageDetail = null; loadView('packages'); }

  async function viewPackageDetail(pane, actions) {
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id));
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }
    var p = res.package;

    if (actions) {
      var b = '<button class="btn" onclick="Onboarding.backToPackages()">Back to packages</button>';
      if (can('onboarding.manage_packages') && p.kind === 'package') {
        // "Publish v4" told the Owner a number they never chose and cannot
        // act on. What they are doing is making their edits live for new
        // starters; the version is bookkeeping, and belongs in the history.
        b += ' <button class="btn primary" onclick="Onboarding.publishPackage(\'' + jsq(p.id) + '\')">'
          + (p.currentVersion ? 'Publish changes' : 'Publish this package') + '</button>';
      }
      actions.innerHTML = b;
    }

    var bySection = {};
    (res.resolvedRequirements || []).forEach(function (r) {
      (bySection[r.sectionLabel] = bySection[r.sectionLabel] || []).push(r);
    });

    pane.innerHTML = ''
      + '<div class="ob-section-card"><div class="ob-section-head">'
      + '  <div><h2>' + esc(p.title) + '</h2>'
      + '  <p class="ob-quiet" style="margin:4px 0 0;">'
      + esc([titleCase(p.roleCategory), titleCase(p.employmentType)]
        .filter(Boolean).join(' · ') || 'Applies to any role') + '</p></div>'
      + chip(p.status)
      + '</div><div class="ob-section-body">'
      + (p.description ? '<p class="ob-mb-3">' + esc(p.description) + '</p>' : '')
      + (res.warnings && res.warnings.length
        ? '<div class="ob-note is-warn ob-mt-3">' + res.warnings.map(esc).join('<br>') + '</div>' : '')
      + '</div></div>'
      // The starter pack comes FIRST, because "what will this person actually
      // receive?" is what an Owner opens a package to find out.
      + (p.kind === 'package'
        ? '<div class="ob-section-card"><div class="ob-section-head"><h2>Starter pack</h2>'
          + '<span class="ob-quiet">Emailed to the new starter</span></div>'
          + '<div class="ob-section-body" id="ob-pkg-docs">' + spinner('Loading documents…')
          + '</div></div>'
        : '')
      + '<div class="ob-section-card"><div class="ob-section-head"><h2>What they must complete</h2>'
      + '<span class="ob-quiet">' + (res.resolvedRequirements || []).length + ' items</span></div>'
      + '<div class="ob-section-body">'
      + Object.keys(bySection).map(function (label) {
        return '<div class="ob-builder-section"><h3>' + esc(label) + '</h3>'
          + bySection[label].map(function (r) {
            return '<div class="ob-builder-item">'
              + '<span class="ob-tick' + (r.mandatory ? '' : ' is-optional') + '" aria-hidden="true">'
              + (r.mandatory ? '✓' : '○') + '</span>'
              + '<span class="ob-builder-item-main">'
              + '<span class="ob-builder-item-title">' + esc(r.title) + '</span>'
              + '<span class="ob-builder-item-cond">' + esc(r.conditionText) + '</span>'
              + '</span>'
              + (r.inheritedFrom
                ? '<span class="ob-inherited">' + esc(packageLabel(r.inheritedFrom)) + '</span>' : '')
              + (r.blocksActivation
                ? '<span class="ob-chip is-blocking">Required before they start</span>' : '')
              + '</div>';
          }).join('')
          + '</div>';
      }).join('')
      + '</div></div>'
      // Version history exists for auditability, not for daily use, so it sits
      // behind a disclosure. An Owner who needs to prove what somebody was
      // issued in March can find it; an Owner adding a document does not have
      // to read past it.
      + (res.versions && res.versions.length
        ? '<details class="ob-details"><summary>History</summary>'
          + '<div class="ob-note is-info">Publishing takes a permanent copy. Everyone already '
          + 'onboarding keeps the version they were issued, so what they were asked to complete — '
          + 'and which edition of each policy they agreed to — never changes after the fact.</div>'
          + '<div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Published</th><th scope="col">Items</th>'
          + '<th scope="col">What changed</th><th scope="col"></th></tr></thead><tbody>'
          + res.versions.map(function (v) {
            return '<tr><td>' + fmtDate(v.published_at) + '</td>'
              + '<td class="ob-num">' + esc(v.requirement_count) + '</td>'
              + '<td>' + esc(v.change_note || '—') + '</td>'
              + '<td>' + (v.status === 'published'
                ? '<span class="ob-chip published">Current</span>'
                : '<span class="ob-quiet">Superseded</span>') + '</td></tr>';
          }).join('')
          + '</tbody></table></div></details>'
        : '');

    if (p.kind === 'package') await loadPackageDocuments();
  }

  /**
   * A package's internal code, made readable.
   *
   * PKG_OVL_CHILD_RELATED is a stable identifier and stays one; what an Owner
   * sees is "Child Related". The codes still exist everywhere they are useful —
   * the API, imports, the seed catalogue — just not on screen.
   */
  function packageLabel(code) {
    return String(code || '')
      .replace(/^PKG_(BASE_|OVL_)?/, '')
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function publishPackage(id) {
    openModal({
      title: 'Publish a new version',
      subtitle: 'Anyone already onboarding keeps the version they were issued.',
      body: '<div class="ob-note is-info">Publishing creates an immutable snapshot. Existing '
        + 'assignments stay pinned to their own version, so what someone was asked to complete — '
        + 'and which policy version they agreed to — never changes after the fact.</div>'
        + '<div class="ob-field"><label for="ob-p-note">What changed?</label>'
        + '<input type="text" id="ob-p-note" name="changeNote" maxlength="1000"></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.confirmPublish(\'' + jsq(id) + '\')">Publish</button>',
    });
  }

  async function confirmPublish(id) {
    var v = modalValues();
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(id) + '/publish', {
      method: 'POST', body: { changeNote: v.changeNote || undefined },
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Published v' + res.version.version);
    await loadView('packages');
  }

  // ── Employees, compliance, expiring, documents, settings ──────────────────

  async function viewEmployees(pane) {
    var res = await api('/api/onboarding/employees');
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }
    pane.innerHTML = '<div class="ob-section-card">'
      + '<div class="ob-section-head"><h2>Employees</h2></div>'
      + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
      + '<thead><tr><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Employment</th>'
      + '<th scope="col">Started</th><th scope="col">Screening</th>'
      + '<th scope="col">Expired</th><th scope="col">Unverified</th>'
      + '<th scope="col">Policies</th></tr></thead><tbody>'
      + (res.employees || []).map(function (e) {
        return '<tr>'
          + '<td><span class="ob-strong">' + esc(e.name) + '</span></td>'
          + '<td>' + esc(titleCase(e.role)) + '</td>'
          + '<td>' + esc(titleCase(e.employmentType) || '—') + '</td>'
          + '<td>' + fmtDate(e.startDate) + '</td>'
          + '<td>' + (e.ndisRiskAssessedRole ? chip(e.ndisRiskAssessedRole) : '—') + '</td>'
          + '<td class="ob-num">' + (e.expiredCredentials
            ? '<span class="ob-chip expired">' + esc(e.expiredCredentials) + '</span>' : '0') + '</td>'
          + '<td class="ob-num">' + (e.unverifiedCredentials || 0) + '</td>'
          + '<td class="ob-num">' + (e.acknowledgements || 0) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></div></div>';
  }

  async function viewCompliance(pane, actions) {
    var reg = await api('/api/onboarding/compliance/requirements');
    var org = can('onboarding.manage_compliance')
      ? await api('/api/onboarding/compliance/organisation') : { ok: false };

    if (!reg.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(reg.error) + '</div>'; return; }

    pane.innerHTML = ''
      + (org.ok ? '<div class="ob-section-card">'
        + '<div class="ob-section-head"><h2>Organisation compliance</h2>'
        + '<span class="ob-quiet">Employer obligations — never an employee upload</span></div>'
        + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
        + '<thead><tr><th scope="col">Record</th><th scope="col">Provider</th><th scope="col">Policy</th>'
        + '<th scope="col">Expires</th><th scope="col">Status</th></tr></thead><tbody>'
        + (org.records || []).map(function (r) {
          return '<tr><td><span class="ob-strong">' + esc(r.title) + '</span></td>'
            + '<td>' + esc(r.provider || '—') + '</td>'
            + '<td>' + esc(r.policyNumber || '—') + '</td>'
            + '<td>' + fmtDate(r.expiryDate) + '</td>'
            + '<td>' + chip(r.status) + '</td></tr>';
        }).join('')
        + '</tbody></table></div></div></div>' : '')
      + '<div class="ob-section-card">'
      + '<div class="ob-section-head"><h2>Compliance registry</h2>'
      + '<span class="ob-quiet">' + (reg.requirements || []).length + ' sources</span></div>'
      + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
      + '<thead><tr><th scope="col">Requirement</th><th scope="col">Applies to</th>'
      + '<th scope="col">Basis</th><th scope="col">Source</th><th scope="col">Version</th>'
      + '<th scope="col">Last verified</th></tr></thead><tbody>'
      + (reg.requirements || []).map(function (c) {
        return '<tr>'
          + '<td><span class="ob-strong">' + esc(c.title) + '</span><br>'
          + '<span class="ob-quiet">' + esc(c.jurisdiction) + ' · ' + esc(titleCase(c.classification))
          + '</span></td>'
          + '<td>' + esc(c.appliesTo || '—') + '</td>'
          + '<td>' + basisChip(c.basis) + '</td>'
          + '<td>' + (c.sourceUrl
            ? '<a href="' + esc(c.sourceUrl) + '" target="_blank" rel="noopener noreferrer">'
              + esc(c.sourceOrg || 'Source') + '</a>'
            : esc(c.sourceOrg || '—')) + '</td>'
          + '<td>' + esc(c.sourceVersionLabel || '—') + '</td>'
          + '<td>' + (c.lastVerifiedAt ? fmtDate(c.lastVerifiedAt)
            : '<span class="ob-chip not_started">Never</span>') + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div></div></div>';
  }

  async function viewExpiring(pane) {
    var res = await api('/api/onboarding/compliance/expiring?days=120');
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }
    var items = res.items || [];
    pane.innerHTML = '<div class="ob-note is-info">Credentials are re-checked daily. Reminders go out '
      + 'at 90, 60, 30 and 7 days, and again on expiry — each one sent once.</div>'
      + '<div class="ob-section-card"><div class="ob-section-head"><h2>Expiring and expired</h2></div>'
      + '<div class="ob-section-body is-flush">'
      + (items.length
        ? '<div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Person</th><th scope="col">Credential</th>'
          + '<th scope="col">Expires</th><th scope="col">Status</th></tr></thead><tbody>'
          + items.map(function (i) {
            return '<tr><td>' + esc(i.userName || 'Organisation') + '</td>'
              + '<td>' + esc(i.title || titleCase(i.kind)) + '</td>'
              + '<td>' + fmtDate(i.expiryDate) + '</td>'
              + '<td>' + (i.expired
                ? '<span class="ob-chip expired">Expired</span>'
                : '<span class="ob-chip submitted">In ' + esc(i.window) + ' days</span>') + '</td></tr>';
          }).join('')
          + '</tbody></table></div>'
        : empty('Nothing expiring', 'No credential expires in the next 120 days.'))
      + '</div></div>';
  }

  async function viewDocuments(pane, actions) {
    if (actions && can('onboarding.manage_documents')) {
      actions.innerHTML = '<button class="btn" onclick="Onboarding.importDialog()">Import ZIP</button>';
    }
    var res = await api('/api/onboarding/documents');
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }

    var docs = res.documents || [];
    var needContent = docs.filter(function (d) { return d.contentStatus === 'document_required'; });

    var byCat = {};
    docs.forEach(function (d) { (byCat[d.category] = byCat[d.category] || []).push(d); });

    pane.innerHTML = ''
      + (needContent.length
        ? '<div class="ob-note is-warn"><strong>' + needContent.length
          + ' document' + (needContent.length === 1 ? '' : 's') + ' still need content.</strong> '
          + 'Opal seeds the policy slots but deliberately does not write the policies — a fabricated '
          + 'policy in front of a real workforce is worse than an empty one. Onboarding cannot ask '
          + 'anyone to acknowledge a document until it is published.</div>'
        : '')
      + Object.keys(byCat).sort().map(function (cat) {
        return '<div class="ob-section-card">'
          + '<div class="ob-section-head"><h2>' + esc(cat) + '</h2></div>'
          + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Document</th><th scope="col">Type</th>'
          + '<th scope="col">Audience</th><th scope="col">Version</th>'
          + '<th scope="col">Content</th><th scope="col">Status</th></tr></thead><tbody>'
          + byCat[cat].map(function (d) {
            return '<tr>'
              + '<td><span class="ob-strong">' + esc(d.title) + '</span>'
              + (d.officialSourceUrl
                ? ' <a href="' + esc(d.officialSourceUrl) + '" target="_blank" rel="noopener noreferrer"'
                  + ' class="ob-quiet">(official source)</a>' : '')
              + '<br><span class="ob-quiet">' + esc(d.code) + '</span></td>'
              + '<td>' + esc(titleCase(d.classification)) + '</td>'
              + '<td>' + esc(titleCase(d.audience)) + '</td>'
              + '<td>' + (d.currentVersion ? 'v' + d.currentVersion : '—')
              + (d.sourceVersionLabel ? '<br><span class="ob-quiet">' + esc(d.sourceVersionLabel)
                + '</span>' : '') + '</td>'
              + '<td>' + chip(d.contentStatus) + '</td>'
              + '<td>' + chip(d.status) + '</td>'
              + '</tr>';
          }).join('')
          + '</tbody></table></div></div></div>';
      }).join('');
  }

  function importDialog() {
    openModal({
      title: 'Import a resources ZIP',
      subtitle: 'Nothing is published — every file becomes a proposal you confirm.',
      body: '<div class="ob-note is-info">Each entry is checked for unsafe paths, size, type and '
        + 'actual file contents before anything is stored. Accepted files arrive as <strong>drafts</strong>; '
        + 'you classify them and publish deliberately.</div>'
        + '<div class="ob-field">'
        + '  <label for="ob-i-file">ZIP file</label>'
        + '  <input type="file" id="ob-i-file" accept=".zip,application/zip" aria-describedby="ob-i-hint">'
        + '  <p class="ob-hint" id="ob-i-hint">Up to 45 MB.</p>'
        + '</div>'
        + '<div id="ob-i-result"></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitImport()">Scan archive</button>',
    });
  }

  async function submitImport() {
    var input = doc.getElementById('ob-i-file');
    if (!input || !input.files || !input.files[0]) { modalError('Choose a ZIP file first.'); return; }
    var file = input.files[0];
    if (file.size > 45 * 1024 * 1024) { modalError('That archive is larger than 45 MB.'); return; }

    var result = doc.getElementById('ob-i-result');
    if (result) result.innerHTML = spinner('Scanning…');

    var base64 = await new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsDataURL(file);
    }).catch(function () { return null; });
    if (!base64) { modalError('That file could not be read.'); return; }

    var res = await api('/api/onboarding/imports', {
      method: 'POST', body: { fileName: file.name, fileData: base64 },
    });
    if (!res.ok) { if (result) result.innerHTML = ''; modalError(res.error); return; }

    var accepted = (res.items || []).filter(function (i) { return i.decision === 'pending'; });
    var rejected = (res.items || []).filter(function (i) { return i.decision !== 'pending'; });

    if (result) {
      result.innerHTML = '<div class="ob-note is-ok ob-mt-4"><strong>' + accepted.length
        + ' file' + (accepted.length === 1 ? '' : 's') + ' ready to import</strong>'
        + (rejected.length ? ', ' + rejected.length + ' refused' : '') + '.</div>'
        + (accepted.length ? '<div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">File</th><th scope="col">Proposed category</th>'
          + '<th scope="col">Type</th></tr></thead><tbody>'
          + accepted.map(function (i) {
            return '<tr><td>' + esc(i.file_name) + '</td>'
              + '<td>' + esc(i.proposed_category) + '</td>'
              + '<td>' + esc(titleCase(i.proposed_classification)) + '</td></tr>';
          }).join('') + '</tbody></table></div>' : '')
        + (rejected.length ? '<div class="ob-note is-warn ob-mt-3"><strong>Refused</strong><ul style="margin:8px 0 0 18px;">'
          + rejected.map(function (i) {
            return '<li>' + esc(i.file_name) + ' — ' + esc(i.reason || i.decision) + '</li>';
          }).join('') + '</ul></div>' : '');
    }

    var foot = doc.querySelector('.ob-modal-foot');
    if (foot && accepted.length) {
      foot.innerHTML = '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.applyImport(\'' + jsq(res.import.id) + '\')">'
        + 'Import ' + accepted.length + ' as drafts</button>';
    }
  }

  async function applyImport(importId) {
    var res = await api('/api/onboarding/imports/' + encodeURIComponent(importId) + '/apply', {
      method: 'POST', body: {},
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast(res.created.length + ' document(s) imported as drafts');
    await loadView('documents');
  }

  async function viewSettings(pane) {
    var res = await api('/api/onboarding/settings');
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }
    var s = res.settings;
    S.settings = s;

    var perms = user().role === 'owner' ? await api('/api/onboarding/permissions') : { ok: false };

    pane.innerHTML = ''
      + '<div class="ob-section-card"><div class="ob-section-head"><h2>Organisation</h2></div>'
      + '<div class="ob-section-body">'
      + '  <div class="ob-note is-info">These answers change what the portal states is legally '
      + '  required. Opal never asserts an obligation it cannot support — an unregistered provider '
      + '  is told worker screening is an Opal policy, not law.</div>'
      + '  <div class="ob-form">'
      + '    <div class="ob-form-row">'
      + '      <div class="ob-field"><label for="ob-s-ndis">NDIS provider status</label>'
      + '        <select id="ob-s-ndis" name="ndisProviderStatus">'
      + ['unregistered', 'application_in_progress', 'registered', 'registration_inactive']
        .map(function (v) {
          return '<option value="' + v + '"' + (s.ndisProviderStatus === v ? ' selected' : '') + '>'
            + esc(titleCase(v)) + '</option>';
        }).join('')
      + '        </select></div>'
      + '      <div class="ob-field"><label for="ob-s-ir">Industrial relations system</label>'
      + '        <select id="ob-s-ir" name="industrialRelationsSystem">'
      + [['unknown', 'Not yet determined'], ['national', 'National system (Fair Work)'],
        ['wa_state', 'WA state system']].map(function (v) {
        return '<option value="' + v[0] + '"' + (s.industrialRelationsSystem === v[0] ? ' selected' : '')
          + '>' + esc(v[1]) + '</option>';
      }).join('')
      + '        </select>'
      + '        <p class="ob-hint">A WA sole trader or unincorporated partnership is generally in '
      + '           the state system, where the Fair Work statements do not apply.</p></div>'
      + '    </div>'
      + '    <div class="ob-form-row">'
      + '      <div class="ob-field"><div class="ob-check">'
      + '        <input type="checkbox" id="ob-s-small" name="smallBusinessEmployer"'
      + (s.smallBusinessEmployer ? ' checked' : '') + '>'
      + '        <label for="ob-s-small">Small business employer (fewer than 15 employees)</label>'
      + '      </div><p class="ob-hint">Changes the Casual Employment Information Statement cadence '
      + '        from 6/12 months then annually, to 12-monthly.</p></div>'
      + '      <div class="ob-field"><label for="ob-s-due">Default days to complete onboarding</label>'
      + '        <input type="number" id="ob-s-due" name="defaultDueDays" min="1" max="120"'
      + '               value="' + esc(s.defaultDueDays) + '"></div>'
      + '    </div>'
      + '    <div class="ob-form-row is-thirds">'
      + '      <div class="ob-field"><label for="ob-s-cpd">OT CPD hours per year</label>'
      + '        <input type="number" id="ob-s-cpd" name="otCpdHoursPerYear" min="0" max="200"'
      + '               value="' + esc(s.otCpdHoursPerYear) + '"></div>'
      + '      <div class="ob-field"><label for="ob-s-wwcc">WWCC validity (years)</label>'
      + '        <input type="number" id="ob-s-wwcc" name="wwccValidityYears" min="1" max="10"'
      + '               value="' + esc(s.wwccValidityYears) + '"></div>'
      + '      <div class="ob-field"><label for="ob-s-scr">NDIS screening validity (years)</label>'
      + '        <input type="number" id="ob-s-scr" name="ndisScreeningValidityYears" min="1" max="10"'
      + '               value="' + esc(s.ndisScreeningValidityYears) + '"></div>'
      + '    </div>'
      + '    <div><button class="btn primary" onclick="Onboarding.saveSettings()">Save settings</button></div>'
      + '  </div>'
      + '</div></div>'
      + (perms.ok ? renderPermissions(perms) : '');
  }

  function renderPermissions(perms) {
    return '<div class="ob-section-card">'
      + '<div class="ob-section-head"><h2>Who can manage onboarding</h2></div>'
      + '<div class="ob-section-body">'
      + '<div class="ob-note is-warn"><strong>An Admin employee is not automatically an onboarding '
      + 'administrator.</strong> Someone whose job is administration and someone you trust with a '
      + 'colleague\'s tax file number are two different things, so each permission is granted '
      + 'separately.</div>'
      + perms.users.filter(function (u) { return u.role !== 'owner'; }).map(function (u) {
        return '<div class="ob-section-card"><div class="ob-section-body">'
          + '<div class="ob-req-title">' + esc(u.name || u.email) + ' '
          + '<span class="ob-quiet">' + esc(titleCase(u.role)) + '</span></div>'
          + perms.groups.map(function (g) {
            return '<fieldset style="border:none;padding:0;margin:12px 0 0;">'
              + '<legend style="font-size:12px;font-weight:700;color:var(--muted);'
              + 'text-transform:uppercase;letter-spacing:0.5px;padding:0;">' + esc(g.label) + '</legend>'
              + '<p class="ob-hint" style="margin:2px 0 8px;">' + esc(g.description) + '</p>'
              + g.permissions.map(function (p) {
                var id = 'ob-perm-' + esc(u.id) + '-' + p.replace(/\./g, '-');
                return '<div class="ob-check" style="margin-bottom:6px;">'
                  + '<input type="checkbox" id="' + esc(id) + '" data-user="' + esc(u.id) + '"'
                  + ' data-perm="' + esc(p) + '"' + (u.granted.indexOf(p) !== -1 ? ' checked' : '') + '>'
                  + '<label for="' + esc(id) + '">' + esc(p) + '</label></div>';
              }).join('')
              + '</fieldset>';
          }).join('')
          + '<div class="ob-mt-3"><button class="btn ob-btn-sm" onclick="Onboarding.savePermissions(\''
          + jsq(u.id) + '\')">Save for ' + esc(u.name || u.email) + '</button></div>'
          + '</div></div>';
      }).join('')
      + '</div></div>';
  }

  async function savePermissions(userId) {
    var granted = [];
    doc.querySelectorAll('[data-user="' + userId + '"]').forEach(function (el) {
      if (el.checked) granted.push(el.dataset.perm);
    });
    var res = await api('/api/onboarding/permissions/' + encodeURIComponent(userId), {
      method: 'PUT', body: { permissions: granted },
    });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Permissions updated');
  }

  async function saveSettings() {
    var body = {};
    ['ndisProviderStatus', 'industrialRelationsSystem', 'defaultDueDays',
      'otCpdHoursPerYear', 'wwccValidityYears', 'ndisScreeningValidityYears'].forEach(function (k) {
      var el = doc.querySelector('[name="' + k + '"]');
      if (!el) return;
      body[k] = el.type === 'number' ? Number(el.value) : el.value;
    });
    var small = doc.querySelector('[name="smallBusinessEmployer"]');
    if (small) body.smallBusinessEmployer = small.checked;

    var res = await api('/api/onboarding/settings', { method: 'PUT', body: body });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Settings saved');
    S.dashboard = null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  MY ONBOARDING
  // ═══════════════════════════════════════════════════════════════════════════

  async function renderMine(host) {
    var m = S.mine && S.mine.ok ? S.mine : await api('/api/onboarding/me');
    S.mine = m;
    if (!m.ok) {
      host.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(m.error) + '</div>';
      return;
    }
    if (!m.hasOnboarding) { host.innerHTML = renderNoOnboarding(); return; }

    var w = m.welcome || {};
    var yp = m.yourProgress || {};
    var er = m.employerReview || {};

    var start = fmtDateLong(w.startDate);
    var due = fmtDateLong(w.dueAt);

    host.innerHTML = ''
      + '<div class="ob-root">'
      + '  <div class="ob-welcome">'
      + '    <h1>Welcome to ' + esc(w.organisationName || 'Opal Therapy') + '</h1>'
      + '    <p>' + (w.name ? esc(w.name.split(' ')[0]) + ', we' : 'We')
      + '      are glad you are joining us. This page walks you through everything we need before '
      + '      your first day. You can save as you go and come back at any time.</p>'
      + '    <div class="ob-welcome-facts">'
      + (w.roleTitle ? '<div><span>Your role</span><strong>' + esc(w.roleTitle) + '</strong></div>' : '')
      + (w.employmentType ? '<div><span>Employment</span><strong>'
        + esc(titleCase(w.employmentType)) + '</strong></div>' : '')
      + (start ? '<div><span>Start date</span><strong>' + esc(start) + '</strong></div>' : '')
      + (due ? '<div><span>Please complete by</span><strong>' + esc(due) + '</strong></div>' : '')
      + (w.contactName ? '<div><span>Your contact</span><strong>' + esc(w.contactName) + '</strong></div>' : '')
      + '    </div>'
      + (w.ownerNote ? '<div class="ob-note ob-mt-4">' + esc(w.ownerNote) + '</div>' : '')
      + '  </div>'
      + (m.actionRequired
        ? '<div class="ob-note is-danger" role="alert"><strong>' + m.actionRequired
          + ' item' + (m.actionRequired === 1 ? ' needs' : 's need') + ' your attention.</strong> '
          + 'We have asked for a correction — look for the highlighted items below.</div>'
        : '')
      + '  <div class="ob-section-card"><div class="ob-section-body">'
      + '    <div class="ob-meters">'
      + meter('Your progress', yp.done || 0, yp.total || 0, {
        note: 'Everything on this page that is yours to do.',
      })
      + meter('Our review', er.done || 0, er.total || 0, {
        employer: true,
        note: er.remaining
          ? er.remaining + ' check' + (er.remaining === 1 ? '' : 's') + ' left for us — nothing for you to do.'
          : 'All our checks are done.',
      })
      + '    </div>'
      + (yp.complete && !m.canSubmit && m.status !== 'employer_review'
        ? '' : '')
      + (m.canSubmit
        ? '<div class="ob-note is-ok ob-mt-4"><strong>You have finished everything.</strong> '
          + 'Submit when you are ready and we will take it from here.'
          + '<div class="ob-mt-3"><button class="btn primary" onclick="Onboarding.submitMine()">'
          + 'Submit my onboarding</button></div></div>'
        : '')
      + (m.status === 'employer_review' || m.status === 'ready_to_activate'
        ? '<div class="ob-note is-info ob-mt-4"><strong>Submitted — thank you.</strong> '
          + 'We are reviewing your documents and will be in touch if anything is needed.</div>'
        : '')
      + '  </div></div>'
      + (m.sections || []).map(renderMineSection).join('')
      + '  <p class="ob-quiet ob-mt-4">Everything you enter here is stored securely in the portal. '
      + '    Please do not email us documents containing your tax file number or bank details.</p>'
      + '</div>';
  }

  function renderMineSection(section, index) {
    var complete = section.complete;
    var actionNeeded = section.requirements.some(function (r) {
      return r.status === 'correction_required';
    });
    return ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head">'
      + '    <h2><span class="ob-step-n" style="display:inline-flex;margin-right:8px;'
      + (complete ? 'background:var(--ok);color:#fff;' : '')
      + (actionNeeded ? 'background:var(--danger);color:#fff;' : '') + '">'
      + (index + 1) + '</span>' + esc(section.label) + '</h2>'
      + '    <span class="ob-quiet">' + section.employeeDone + ' of ' + section.employeeTotal
      + '      done' + (complete ? ' · complete' : '') + '</span>'
      + '  </div>'
      + '  <div class="ob-section-body is-flush"><div class="ob-req-list">'
      + section.requirements
        .filter(function (r) { return r.actor === 'employee' || r.actor === 'both'; })
        .map(renderMineRequirement).join('')
      + '  </div></div>'
      + '</div>';
  }

  function renderMineRequirement(r) {
    var done = ['submitted', 'awaiting_verification', 'verified', 'complete', 'not_applicable']
      .indexOf(r.status) !== -1;
    var needsAction = r.status === 'correction_required';

    var statusText = done
      ? (r.status === 'submitted' || r.status === 'awaiting_verification'
        ? 'Submitted — we will check this' : 'Done')
      : (needsAction ? 'Needs your attention' : 'Not started yet');

    var action = '';
    if (!done || needsAction) {
      var label = needsAction ? 'Fix and resubmit' : 'Start';
      switch (r.handler) {
        case 'document_ack':
        case 'info':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openDocument(\''
            + jsq(r.id) + '\')">' + (needsAction ? 'Review again' : 'Read and acknowledge') + '</button>';
          break;
        case 'form':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openForm(\''
            + jsq(r.id) + '\')">' + label + '</button>';
          break;
        case 'credential':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openCredential(\''
            + jsq(r.id) + '\')">' + label + '</button>';
          break;
        case 'upload':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openUpload(\''
            + jsq(r.id) + '\')">Upload</button>';
          break;
        case 'training':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openTraining(\''
            + jsq(r.id) + '\')">Open</button>';
          break;
        case 'live_source':
          action = '<button class="btn primary ob-btn-sm" onclick="Onboarding.openLiveSource(\''
            + jsq(r.id) + '\')">Open</button>';
          break;
        default:
          action = '';
      }
    }

    return ''
      + '<div class="ob-req' + (needsAction ? ' is-action-required' : '') + '">'
      + '  <div class="ob-req-main">'
      + '    <div class="ob-req-title">' + esc(r.title) + ' ' + chip(r.status) + '</div>'
      + (r.summary ? '<div class="ob-req-sub">' + esc(r.summary) + '</div>' : '')
      + (needsAction && r.reviewReason
        ? '<div class="ob-correction"><strong>We need a correction</strong>' + esc(r.reviewReason) + '</div>'
        : '')
      + '    <div class="ob-req-meta"><span>' + esc(statusText) + '</span>'
      + (r.dueAt ? '<span>Due ' + fmtDate(r.dueAt) + '</span>' : '')
      + (r.sensitivity === 'restricted' ? '<span>Stored encrypted</span>' : '')
      + '    </div>'
      + '  </div>'
      + '  <div class="ob-req-actions">' + action + '</div>'
      + '</div>';
  }

  async function refreshMine() {
    S.mine = await api('/api/onboarding/me');
    await renderMine(root());
  }

  async function mineRequirement(id) {
    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id));
    if (!res.ok) { toast(res.error, true); return null; }
    return res;
  }

  async function submitMine() {
    var res = await api('/api/onboarding/me/submit', { method: 'POST', body: {} });
    if (!res.ok) {
      toast(res.error, true);
      return;
    }
    toast('Submitted — thank you');
    await refreshMine();
  }

  // ── Employee: documents ───────────────────────────────────────────────────

  async function openDocument(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;

    var body = '';
    if (req.documentVersionId) {
      var d = await api('/api/onboarding/me/documents/version/'
        + encodeURIComponent(req.documentVersionId));
      if (d.ok && d.document) {
        if (d.document.body) {
          body += '<div class="ob-doc" tabindex="0">' + esc(d.document.body) + '</div>';
        } else if (d.document.hasFile) {
          // The portal's shared viewer, opened over the top — the same one the
          // Resource Hub uses, so a policy looks the same wherever it is read.
          // The iframe stays underneath as the fallback for anything the
          // viewer does not render, and for a browser where it failed to load.
          var kind = d.document.fileMime === 'application/pdf' ? 'pdf'
            : String(d.document.fileMime || '').indexOf('wordprocessingml') !== -1 ? 'docx' : null;
          var bytesUrl = '/api/onboarding/me/documents/version/'
            + encodeURIComponent(req.documentVersionId) + '/download';
          if (kind && global.DocPreview) {
            body += '<div class="ob-inline-actions ob-mb-3">'
              + '<button class="btn" onclick="Onboarding.previewMineDocument(\''
              + jsq(req.documentVersionId) + '\',\'' + jsq(d.document.title) + '\',\''
              + jsq(kind) + '\')">Open full screen</button></div>';
          }
          body += '<iframe class="ob-doc-frame" title="' + esc(d.document.title) + '" src="'
            + bytesUrl + '"></iframe>';
        }
        body += '<div class="ob-doc-meta">'
          + (d.document.sourceVersionLabel ? '<span>' + esc(d.document.sourceVersionLabel) + '</span>' : '')
          + (d.document.effectiveDate ? '<span>Effective ' + fmtDate(d.document.effectiveDate) + '</span>' : '')
          + '<span>Version ' + esc(d.document.version) + '</span>'
          + '</div>';
        if (d.document.officialSourceUrl) {
          body += '<p class="ob-hint ob-mt-3">Published by the issuing body: '
            + '<a href="' + esc(d.document.officialSourceUrl) + '" target="_blank"'
            + ' rel="noopener noreferrer">open the official page</a>.</p>';
        }
      }
    } else if (req.externalUrl) {
      body += '<p>This is published by an external body. Open it, read it, then confirm below.</p>'
        + '<p class="ob-mt-3"><a class="btn" href="' + esc(req.externalUrl) + '" target="_blank"'
        + ' rel="noopener noreferrer">Open the document</a></p>';
    }
    if (!body) {
      body = '<div class="ob-doc" tabindex="0">' + esc(req.instructions || req.summary || req.title)
        + '</div>';
    }

    var needsName = req.config && req.config.requiresTypedName;

    openModal({
      title: req.title,
      subtitle: req.summary || '',
      wide: true,
      body: body
        + (req.instructions ? '<p class="ob-hint ob-mt-3">' + esc(req.instructions) + '</p>' : '')
        + '<div class="ob-check ob-mt-4">'
        + '  <input type="checkbox" id="ob-ack" name="acknowledged">'
        + '  <label for="ob-ack">I confirm that I have read and understood this'
        + (req.handler === 'document_ack' ? ' document' : '') + '.</label>'
        + '</div>'
        + (needsName
          ? '<div class="ob-field ob-mt-3"><label for="ob-ack-name">Type your full legal name'
            + '<span class="ob-req-mark" aria-hidden="true">*</span></label>'
            + '<input type="text" id="ob-ack-name" name="typedLegalName" maxlength="200"'
            + ' autocomplete="name"></div>'
          : ''),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Not now</button>'
        + '<button class="btn primary" onclick="Onboarding.submitAcknowledge(\'' + jsq(id) + '\')">'
        + 'Acknowledge</button>',
    });
  }

  async function submitAcknowledge(id) {
    var v = modalValues();
    if (!v.acknowledged) {
      modalError('Please tick the box to confirm you have read this.');
      return;
    }
    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id) + '/acknowledge', {
      method: 'POST',
      body: { acknowledged: true, typedLegalName: v.typedLegalName || undefined },
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Recorded');
    await refreshMine();
  }

  // ── Employee: forms ───────────────────────────────────────────────────────

  var FORMS = {
    personal_details: function (values) {
      var d = values || {};
      return ''
        + '<div class="ob-form">'
        + '  <div class="ob-form-row is-thirds">'
        + field('Legal first name', 'legalFirstName', 'text', d.legal_first_name, { required: true, autocomplete: 'given-name' })
        + field('Middle name', 'middleName', 'text', d.middle_name, { autocomplete: 'additional-name' })
        + field('Surname', 'surname', 'text', d.surname, { required: true, autocomplete: 'family-name' })
        + '  </div>'
        + '  <div class="ob-form-row">'
        + field('Preferred name', 'preferredName', 'text', d.preferred_name,
          { hint: 'What we should call you day to day.' })
        + field('Date of birth', 'dateOfBirth', 'date', d.date_of_birth, { required: true, autocomplete: 'bday' })
        + '  </div>'
        + '  <div class="ob-form-row">'
        + field('Personal email', 'personalEmail', 'email', d.personal_email, { autocomplete: 'email' })
        + field('Mobile', 'mobile', 'tel', d.mobile, { required: true, autocomplete: 'tel' })
        + '  </div>'
        + '  <div class="ob-form-row is-single">'
        + field('Address', 'addressLine1', 'text', d.address_line1, { required: true, autocomplete: 'address-line1' })
        + '  </div>'
        + '  <div class="ob-form-row is-thirds">'
        + field('Suburb', 'suburb', 'text', d.suburb, { required: true, autocomplete: 'address-level2' })
        + selectField('State', 'state', d.state || 'WA',
          ['WA', 'SA', 'NT', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'].map(function (s) { return [s, s]; }))
        + field('Postcode', 'postcode', 'text', d.postcode, { required: true, autocomplete: 'postal-code' })
        + '  </div>'
        + '</div>';
    },

    emergency_contact: function (values) {
      var d = values || {};
      return '<div class="ob-form">'
        + '<div class="ob-note">One contact is enough. We will only use this in an emergency.</div>'
        + '  <div class="ob-form-row">'
        + field('Their name', 'emergencyName', 'text', d.emergency_name, { required: true })
        + field('Relationship to you', 'emergencyRelationship', 'text', d.emergency_relationship, { required: true })
        + '  </div>'
        + '  <div class="ob-form-row">'
        + field('Phone', 'emergencyPhone', 'tel', d.emergency_phone, { required: true })
        + field('Alternate phone', 'emergencyAltPhone', 'tel', d.emergency_alt_phone)
        + '  </div>'
        + '</div>';
    },

    bank_details: function (values) {
      var d = values || {};
      var have = d.accountNumberLast4;
      return '<div class="ob-form">'
        + '<div class="ob-sensitive-note">These details are encrypted before they are stored. '
        + 'After you save them, only the last four digits are ever shown — to you or to anyone at '
        + 'the practice.</div>'
        + (have ? '<div class="ob-note">Currently on file: <span class="ob-masked">'
          + esc(d.bsbMasked || '') + '</span> <span class="ob-masked">••••'
          + esc(have) + '</span>. Entering new details replaces them.</div>' : '')
        + '  <div class="ob-form-row is-single">'
        + field('Account holder name', 'accountHolderName', 'text', d.accountHolderName, { required: true })
        + '  </div>'
        + '  <div class="ob-form-row">'
        + field('BSB', 'bsb', 'text', '', { required: true, hint: 'Six digits, e.g. 062-000', inputmode: 'numeric' })
        + field('Account number', 'accountNumber', 'text', '', { required: true, hint: 'Between 5 and 10 digits', inputmode: 'numeric' })
        + '  </div>'
        + '</div>';
    },

    tax_setup: function (values) {
      var d = values || {};
      return '<div class="ob-form">'
        + '<div class="ob-sensitive-note">Your tax file number is encrypted before it is stored, and '
        + 'is never displayed again — not to you and not to the practice. It is released once, to '
        + 'payroll, and that release is recorded.</div>'
        + '<div class="ob-field"><span class="ob-strong" id="ob-tax-method-label">'
        + 'How would you like to provide your tax details?</span>'
        + '<div class="ob-radio-group ob-mt-3" role="radiogroup" aria-labelledby="ob-tax-method-label">'
        + radio('taxSubmissionMethod', 'employer_electronic_form', 'Complete it here',
          'The quickest option, and the one the ATO prefers when an employer has its own form.',
          d.taxSubmissionMethod === 'employer_electronic_form' || !d.taxSubmissionMethod)
        + radio('taxSubmissionMethod', 'ato_online_services', 'I will use ATO online services',
          'Complete the commencement forms through myGov within 28 days of starting, then give us the summary.',
          d.taxSubmissionMethod === 'ato_online_services')
        + radio('taxSubmissionMethod', 'paper_form', 'I need the paper form',
          'Required if you have no tax file number yet, or are exempt from quoting one. We will arrange it.',
          d.taxSubmissionMethod === 'paper_form')
        + radio('taxSubmissionMethod', 'exemption', 'I am exempt from quoting a TFN', '',
          d.taxSubmissionMethod === 'exemption')
        + '</div></div>'
        + '<div class="ob-form-row is-single">'
        + selectField('Residency for tax purposes', 'residencyStatus', d.residencyStatus, [
          ['australian_resident', 'Australian resident for tax purposes'],
          ['foreign_resident', 'Foreign resident'],
          ['working_holiday_maker', 'Working holiday maker'],
        ])
        + '</div>'
        + '<div class="ob-form-row is-single">'
        + field('Tax file number', 'tfn', 'text', '', {
          hint: 'Nine digits. Only needed if you are completing it here.', inputmode: 'numeric',
        })
        + '</div>'
        + '<div class="ob-form-row is-single">'
        + field('Reason for exemption', 'tfnExemptionReason', 'text', d.tfnExemptionReason,
          { hint: 'Only if you selected the exemption option above.' })
        + '</div>'
        + '<div class="ob-form-row">'
        + '<div class="ob-field"><div class="ob-check">'
        + '<input type="checkbox" id="ob-tfree" name="claimsTaxFreeThreshold"'
        + (d.claimsTaxFreeThreshold ? ' checked' : '') + '>'
        + '<label for="ob-tfree">I want to claim the tax-free threshold from this employer</label>'
        + '</div></div>'
        + '<div class="ob-field"><div class="ob-check">'
        + '<input type="checkbox" id="ob-loan" name="hasStudyLoan"'
        + (d.hasStudyLoan ? ' checked' : '') + '>'
        + '<label for="ob-loan">I have a study or training support loan (HELP, VSL, SFSS, SSL, AASL)</label>'
        + '</div></div>'
        + '</div>'
        + '</div>';
    },

    super_setup: function (values) {
      var d = values || {};
      return '<div class="ob-form">'
        + '<div class="ob-note is-info">Super now has to reach your fund within days of each payday, '
        + 'so settling this before your first pay matters. If you do not nominate a fund we will ask '
        + 'the ATO whether you have a stapled fund that follows you between jobs.</div>'
        + '<div class="ob-field"><span class="ob-strong" id="ob-super-label">Where should your super go?</span>'
        + '<div class="ob-radio-group ob-mt-3" role="radiogroup" aria-labelledby="ob-super-label">'
        + radio('superChoiceType', 'apra_fund', 'My existing super fund',
          'A retail or industry fund. You will need its ABN, USI and your member number.',
          d.superChoiceType === 'apra_fund' || !d.superChoiceType)
        + radio('superChoiceType', 'smsf', 'My self-managed super fund',
          'An SMSF has no USI or member number — it needs its ABN, electronic service address and bank account.',
          d.superChoiceType === 'smsf')
        + radio('superChoiceType', 'employer_default', 'Use the practice default fund', '',
          d.superChoiceType === 'employer_default')
        + radio('superChoiceType', 'stapled', 'Use my stapled fund',
          'We will ask the ATO which fund is linked to you.',
          d.superChoiceType === 'stapled')
        + '</div></div>'
        + '<div class="ob-form-row">'
        + field('Fund name', 'superFundName', 'text', d.superFundName)
        + field('Fund ABN', 'superFundAbn', 'text', d.superFundAbn, { hint: '11 digits', inputmode: 'numeric' })
        + '</div>'
        + '<div class="ob-form-row is-thirds">'
        + field('USI', 'superFundUsi', 'text', d.superFundUsi, { hint: 'Retail/industry funds only' })
        + field('Member number', 'superMemberNumber', 'text', d.superMemberNumber, { hint: 'Retail/industry funds only' })
        + field('Name on the account', 'superAccountName', 'text', d.superAccountName)
        + '</div>'
        + '<div class="ob-form-row is-thirds">'
        + field('SMSF electronic service address', 'smsfEsa', 'text', d.smsfEsa, { hint: 'SMSF only' })
        + field('SMSF bank account name', 'smsfBankAccountName', 'text', d.smsfBankAccountName, { hint: 'SMSF only' })
        + field('SMSF BSB', 'smsfBankBsb', 'text', '', { hint: 'SMSF only', inputmode: 'numeric' })
        + '</div>'
        + '<div class="ob-form-row is-single">'
        + field('SMSF account number', 'smsfBankAccount', 'text', '', { hint: 'SMSF only', inputmode: 'numeric' })
        + '</div>'
        + '</div>';
    },

    identity: function () {
      return '<div class="ob-form">'
        + '<div class="ob-note is-info">In most cases we will <strong>sight</strong> your document '
        + 'and record its details rather than keep a copy — that is what the regulators prefer, and '
        + 'it means less of your personal information for us to hold.</div>'
        + '<div class="ob-form-row is-single">'
        + selectField('Which document will you present?', 'evidenceType', '', [
          ['australian_passport', 'Australian passport'],
          ['citizenship_certificate', 'Australian citizenship certificate'],
          ['birth_certificate', 'Australian birth certificate'],
          ['permanent_residency', 'Evidence of permanent residency'],
          ['foreign_passport', 'Foreign passport'],
          ['drivers_licence', 'Driver licence'],
          ['other', 'Something else'],
        ])
        + '</div>'
        + '<div class="ob-form-row">'
        + field('Name exactly as it appears on the document', 'nameOnDocument', 'text', '', { required: true })
        + field('Document number', 'documentNumber', 'text', '', { hint: 'Only the last four digits are ever displayed.' })
        + '</div>'
        + '<div class="ob-form-row">'
        + field('Country of issue', 'countryOfIssue', 'text', 'Australia')
        + field('Expiry date', 'expiryDate', 'date', '')
        + '</div>'
        + '</div>';
    },

    right_to_work: function () {
      return '<div class="ob-form">'
        + '<div class="ob-note is-info">A tax file number, Medicare card or driver licence is not '
        + 'enough on its own to show a right to work.</div>'
        + '<div class="ob-form-row is-single">'
        + selectField('What is the basis of your right to work?', 'rightToWorkBasis', '', [
          ['citizen', 'Australian citizen'],
          ['permanent_resident', 'Australian permanent resident'],
          ['nz_citizen', 'New Zealand citizen'],
          ['visa_with_work_rights', 'Visa with work rights'],
          ['other', 'Something else'],
        ])
        + '</div>'
        + '<div class="ob-note ob-mt-3">If you hold a visa, we check your work rights online with '
        + 'Home Affairs. That check needs your travel document details and your consent.</div>'
        + '<div class="ob-form-row">'
        + field('Travel document type', 'travelDocumentType', 'text', 'Passport', { hint: 'Visa holders only' })
        + field('Travel document number', 'documentNumber', 'text', '', { hint: 'Visa holders only' })
        + '</div>'
        + '<div class="ob-form-row">'
        + field('Country of document', 'countryOfIssue', 'text', '', { hint: 'Visa holders only' })
        + field('Visa subclass', 'visaSubclass', 'text', '', { hint: 'If you know it' })
        + '</div>'
        + '<div class="ob-check ob-mt-3">'
        + '  <input type="checkbox" id="ob-vevo" name="vevoConsent">'
        + '  <label for="ob-vevo">I consent to Opal Therapy checking my visa work rights online '
        + '    with the Department of Home Affairs.</label>'
        + '</div>'
        + '</div>';
    },

    vehicle_details: function () {
      return '<div class="ob-form">'
        + '<div class="ob-form-row is-thirds">'
        + field('Registration', 'registration', 'text', '', { required: true })
        + field('Make', 'make', 'text', '')
        + field('Model', 'model', 'text', '')
        + '</div>'
        + '<div class="ob-form-row is-single">'
        + field('Registration expiry', 'registrationExpiry', 'date', '')
        + '</div>'
        + '<div class="ob-check ob-mt-3">'
        + '  <input type="checkbox" id="ob-biz" name="businessUseConfirmed">'
        + '  <label for="ob-biz">I confirm my insurance covers using this vehicle for work.</label>'
        + '</div>'
        + '</div>';
    },
  };

  function field(label, name, type, value, opts) {
    opts = opts || {};
    var id = 'ob-f-' + name;
    var hintId = id + '-hint';
    return '<div class="ob-field">'
      + '<label for="' + id + '">' + esc(label)
      + (opts.required ? '<span class="ob-req-mark" aria-hidden="true">*</span>' : '') + '</label>'
      + '<input type="' + type + '" id="' + id + '" name="' + name + '"'
      + (value ? ' value="' + esc(type === 'date' && value ? String(value).slice(0, 10) : value) + '"' : '')
      + (opts.required ? ' required' : '')
      + (opts.autocomplete ? ' autocomplete="' + opts.autocomplete + '"' : '')
      + (opts.inputmode ? ' inputmode="' + opts.inputmode + '"' : '')
      + (opts.hint ? ' aria-describedby="' + hintId + '"' : '')
      + ' maxlength="200">'
      + (opts.hint ? '<p class="ob-hint" id="' + hintId + '">' + esc(opts.hint) + '</p>' : '')
      + '</div>';
  }

  function selectField(label, name, value, options) {
    var id = 'ob-f-' + name;
    return '<div class="ob-field">'
      + '<label for="' + id + '">' + esc(label) + '</label>'
      + '<select id="' + id + '" name="' + name + '">'
      + '<option value="">Please choose…</option>'
      + options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (value === o[0] ? ' selected' : '') + '>'
          + esc(o[1]) + '</option>';
      }).join('')
      + '</select></div>';
  }

  function radio(name, value, title, sub, checked) {
    var id = 'ob-r-' + name + '-' + value;
    return '<label class="ob-radio' + (checked ? ' is-selected' : '') + '" for="' + id + '">'
      + '<input type="radio" id="' + id + '" name="' + name + '" value="' + esc(value) + '"'
      + (checked ? ' checked' : '') + '>'
      + '<span><span class="ob-radio-title">' + esc(title) + '</span>'
      + (sub ? '<span class="ob-radio-sub">' + esc(sub) + '</span>' : '') + '</span></label>';
  }

  async function openForm(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;
    var builder = FORMS[req.formKey];
    if (!builder) { toast('This form is not available', true); return; }

    // These forms carry their own, more specific explanation of what happens
    // to the values. Rendering the generic instructions above it would say the
    // same thing twice in two different voices.
    var SELF_EXPLAINING = ['bank_details', 'tax_setup', 'super_setup', 'identity', 'right_to_work'];
    var showInstructions = req.instructions && SELF_EXPLAINING.indexOf(req.formKey) === -1;

    openModal({
      title: req.title,
      subtitle: req.summary || '',
      wide: true,
      body: (showInstructions ? '<div class="ob-note">' + esc(req.instructions) + '</div>' : '')
        // Why this is already filled in. Without it, a form the employee has
        // never opened carrying their date of birth reads as a mistake or a
        // leak rather than as us saving them the typing.
        + (r.prefill
          ? '<div class="ob-note is-ok"><strong>We filled this in for you.</strong> '
            + esc(r.prefill.message) + '</div>'
          : '')
        + builder(r.values),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitForm(\'' + jsq(id) + '\')">Save</button>',
    });
  }

  async function submitForm(id) {
    var v = modalValues();
    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id) + '/form', {
      method: 'POST', body: v,
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Saved');
    await refreshMine();
  }

  // ── Employee: credentials, uploads, training ──────────────────────────────

  async function openCredential(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;
    var type = req.credentialType;
    var cfg = req.config || {};

    var extra = '';
    if (type === 'ndis_worker_screening') {
      extra = '<div class="ob-note is-info">We verify your status directly in the NDIS Worker '
        + 'Screening Database and link you to Opal — a certificate on its own is not enough, because '
        + 'a clearance can change at any time.'
        + (cfg.waApplyUrl ? ' <a href="' + esc(cfg.waApplyUrl) + '" target="_blank"'
          + ' rel="noopener noreferrer">Apply in WA</a>.' : '') + '</div>'
        + selectField('Which state issued it?', 'jurisdiction', 'WA',
          ['WA', 'SA', 'NT', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'].map(function (s) { return [s, s]; }));
    } else if (type === 'wwcc') {
      extra = '<div class="ob-note is-info">We validate your card with the WA Screening Unit and '
        + 'register you, so we are told if your card status changes.'
        + (cfg.validationUrl ? ' <a href="' + esc(cfg.validationUrl) + '" target="_blank"'
          + ' rel="noopener noreferrer">WA card validation</a>.' : '') + '</div>'
        + field('Family name as it appears on the card', 'familyName', 'text', '');
    } else if (type === 'ahpra_registration') {
      extra = '<div class="ob-note is-info">We check this against the public Register of '
        + 'Practitioners.' + (cfg.verificationUrl ? ' <a href="' + esc(cfg.verificationUrl)
          + '" target="_blank" rel="noopener noreferrer">Ahpra register</a>.' : '') + '</div>';
    } else if (type === 'professional_indemnity') {
      extra = '<div class="ob-field"><span class="ob-strong" id="ob-pii-label">'
        + 'Which arrangement covers your practice?</span>'
        + '<div class="ob-radio-group ob-mt-3" role="radiogroup" aria-labelledby="ob-pii-label">'
        + radio('arrangement', 'employer_policy', 'Opal Therapy\'s policy covers me', '', true)
        + radio('arrangement', 'own_policy', 'I hold my own policy', '')
        + radio('arrangement', 'combined', 'A combination of both', '')
        + radio('arrangement', 'other_compliant', 'Another compliant arrangement', '')
        + '</div></div>'
        + '<div class="ob-form-row">'
        + field('Insurer', 'insurer', 'text', '')
        + field('Policy number', 'policyNumber', 'text', '')
        + '</div>';
    } else if (type === 'qualification') {
      extra = '<div class="ob-form-row">'
        + field('Institution', 'institution', 'text', '')
        + field('Year completed', 'completionYear', 'number', '')
        + '</div>';
    } else if (type === 'drivers_licence') {
      extra = '<div class="ob-form-row">'
        + field('Licence class', 'licenceClass', 'text', '')
        + selectField('Issuing state', 'jurisdiction', 'WA',
          ['WA', 'SA', 'NT', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'].map(function (s) { return [s, s]; }))
        + '</div>';
    }

    openModal({
      title: req.title,
      subtitle: req.summary || '',
      wide: true,
      body: (req.instructions ? '<div class="ob-note">' + esc(req.instructions) + '</div>' : '')
        + '<div class="ob-form">'
        + '<div class="ob-form-row">'
        + field('Registration / card / application number', 'registrationNumber', 'text', '',
          { required: true })
        + field('Expiry date', 'expiryDate', 'date', '')
        + '</div>'
        + extra
        + '<div class="ob-form-row is-single">'
        + '<div class="ob-field"><label for="ob-cred-file">Supporting document (optional)</label>'
        + '<input type="file" id="ob-cred-file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx"'
        + ' aria-describedby="ob-cred-file-hint">'
        + '<p class="ob-hint" id="ob-cred-file-hint">PDF, image or Word document, up to 5 MB.</p></div>'
        + '</div>'
        + '</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitCredential(\'' + jsq(id) + '\')">Save</button>',
    });
  }

  async function uploadFileFor(id, inputId, title) {
    var input = doc.getElementById(inputId);
    if (!input || !input.files || !input.files[0]) return true; // nothing to upload
    var file = input.files[0];
    if (file.size > 5 * 1024 * 1024) { modalError('That file is larger than 5 MB.'); return false; }

    var base64 = await new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result).split(',')[1]); };
      reader.onerror = function () { resolve(null); };
      reader.readAsDataURL(file);
    });
    if (!base64) { modalError('That file could not be read.'); return false; }

    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id) + '/upload', {
      method: 'POST',
      body: {
        title: title, fileName: file.name,
        fileMime: file.type || 'application/octet-stream',
        fileSizeBytes: file.size, fileData: base64,
      },
    });
    if (!res.ok) { modalError(res.error); return false; }
    return true;
  }

  async function submitCredential(id) {
    var v = modalValues();
    if (!v.registrationNumber || !v.registrationNumber.trim()) {
      modalError('Please enter the number shown on your registration or card.');
      return;
    }
    if (!(await uploadFileFor(id, 'ob-cred-file', v.registrationNumber))) return;

    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id) + '/credential', {
      method: 'POST', body: v,
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Saved — we will verify this');
    await refreshMine();
  }

  async function openUpload(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;
    openModal({
      title: req.title,
      subtitle: req.summary || '',
      body: (req.instructions ? '<div class="ob-note">' + esc(req.instructions) + '</div>' : '')
        + '<div class="ob-field"><label for="ob-up-file">Choose a file'
        + '<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '<input type="file" id="ob-up-file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" required'
        + ' aria-describedby="ob-up-hint">'
        + '<p class="ob-hint" id="ob-up-hint">PDF, image or Word document, up to 5 MB. '
        + 'A clear photo taken on your phone is fine.</p></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitUpload(\'' + jsq(id) + '\',\''
        + jsq(req.title) + '\')">Upload</button>',
    });
  }

  async function submitUpload(id, title) {
    var input = doc.getElementById('ob-up-file');
    if (!input || !input.files || !input.files[0]) { modalError('Please choose a file.'); return; }
    if (!(await uploadFileFor(id, 'ob-up-file', title))) return;
    closeModal();
    toast('Uploaded');
    await refreshMine();
  }

  async function openTraining(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;

    if (req.learningAssignmentId) {
      openModal({
        title: req.title,
        subtitle: 'Assigned to you in My Learning',
        body: '<div class="ob-note is-info">This is in your learning. It ticks off here '
          + 'automatically as soon as you finish it — you do not need to come back.</div>'
          + '<p class="ob-mt-3">Progress: <strong>' + (req.learningProgress || 0) + '%</strong> · '
          + esc(titleCase(req.learningStatus || 'assigned')) + '</p>',
        footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
      });
      return;
    }

    openModal({
      title: req.title,
      subtitle: req.summary || '',
      body: (req.instructions ? '<div class="ob-note">' + esc(req.instructions) + '</div>' : '')
        + (req.externalUrl
          ? '<p class="ob-mb-4"><a class="btn primary" href="' + esc(req.externalUrl) + '"'
            + ' target="_blank" rel="noopener noreferrer">Open the official training</a></p>'
            + '<p class="ob-hint">The course is run by the issuing body, not by Opal. Complete it '
            + 'there, then upload your certificate below.</p>'
          : '')
        + '<div class="ob-field ob-mt-4"><label for="ob-tr-file">Completion certificate'
        + '<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '<input type="file" id="ob-tr-file" accept=".pdf,.png,.jpg,.jpeg" required></div>'
        + '<div class="ob-field"><label for="ob-tr-date">Date completed'
        + '<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '<input type="date" id="ob-tr-date" name="completedAt" required></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitTraining(\'' + jsq(id) + '\',\''
        + jsq(req.title) + '\')">Submit</button>',
    });
  }

  async function submitTraining(id, title) {
    var v = modalValues();
    if (!v.completedAt) { modalError('Please tell us when you completed it.'); return; }
    var input = doc.getElementById('ob-tr-file');
    if (!input || !input.files || !input.files[0]) {
      modalError('Please attach your completion certificate.'); return;
    }
    if (!(await uploadFileFor(id, 'ob-tr-file', title))) return;

    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id) + '/training', {
      method: 'POST', body: { completedAt: v.completedAt },
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Submitted');
    await refreshMine();
  }

  async function openLiveSource(id) {
    var r = await mineRequirement(id);
    if (!r) return;
    var req = r.requirement;
    openModal({
      title: req.title,
      subtitle: req.summary || '',
      body: (req.instructions ? '<div class="ob-note">' + esc(req.instructions) + '</div>' : '')
        + (req.externalUrl
          ? '<p><a class="btn primary" href="' + esc(req.externalUrl) + '" target="_blank"'
            + ' rel="noopener noreferrer">Open the official page</a></p>' : '')
        + '<div class="ob-check ob-mt-4">'
        + '<input type="checkbox" id="ob-ls" name="confirmed">'
        + '<label for="ob-ls">I confirm I have completed this step.</label></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitLiveSource(\'' + jsq(id) + '\')">'
        + 'Confirm</button>',
    });
  }

  async function submitLiveSource(id) {
    var v = modalValues();
    if (!v.confirmed) { modalError('Please tick the box to confirm.'); return; }
    var res = await api('/api/onboarding/me/requirements/' + encodeURIComponent(id)
      + '/confirm-live-source', { method: 'POST', body: { confirmed: true } });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Recorded');
    await refreshMine();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE ONBOARDING JOURNEY
  //
  //  One person, start to finish. The panel below answers the only three
  //  questions an Owner opens an onboarding to ask — where are they, what am I
  //  waiting for, what do I do next — and every technical mechanism behind
  //  those answers (package versions, snapshots, extraction runs, credential
  //  lifetimes) stays where it belongs, which is not on this screen.
  //
  //  The server decides what the next action IS. The browser only draws it:
  //  duplicating that rule here would give two answers that disagree the first
  //  time one of them changed.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Open a document in the portal's shared viewer.
   *
   * The same overlay the Resource Hub uses, for the same reason: an onboarding
   * document that opened differently from every other document in the portal
   * would read as a different product. Falls back to a plain download when the
   * viewer is absent or the type is not one it renders.
   */
  function preview(opts) {
    if (!opts || !opts.url) return;
    if (global.DocPreview && (opts.kind === 'pdf' || opts.kind === 'docx')) {
      global.DocPreview.open({
        kind: opts.kind,
        url: opts.url,
        downloadUrl: opts.downloadUrl || opts.url,
        title: opts.title || 'Document',
        meta: opts.meta || '',
      });
      return;
    }
    global.open(opts.downloadUrl || opts.url, '_blank', 'noopener');
  }

  /** Preview a starter-pack or library document by its version. */
  function previewDocument(documentId, versionId, title, kind, meta) {
    preview({
      kind: kind || 'pdf',
      url: '/api/onboarding/documents/' + encodeURIComponent(documentId)
        + '/versions/' + encodeURIComponent(versionId) + '/download',
      title: title,
      meta: meta,
    });
  }

  /** Preview one of the documents an employee sent back. */
  function previewReturned(docId, title, kind) {
    var base = '/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/returned-documents/' + encodeURIComponent(docId);
    preview({ kind: kind || 'pdf', url: base + '/preview', downloadUrl: base + '/download', title: title });
  }

  function bytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * The progress list.
   *
   * A step is done, current, or still to come — never a percentage per step,
   * because "starter pack 60% sent" means nothing. Each state carries a shape
   * as well as a colour so it survives being printed, and being read by
   * somebody who cannot distinguish the two.
   */
  function journeySteps(steps) {
    return '<ol class="ob-journey">'
      + steps.map(function (s) {
        var mark = s.state === 'done' ? '✓' : (s.state === 'current' ? '→' : '○');
        return '<li class="ob-journey-step is-' + esc(s.state) + '">'
          + '<span class="ob-journey-mark" aria-hidden="true">' + mark + '</span>'
          + '<span class="ob-journey-main">'
          + '<span class="ob-journey-label">' + esc(s.label)
          + '<span class="ob-sr"> — ' + esc(s.state === 'done' ? 'done'
            : s.state === 'current' ? 'next to do' : 'not started yet') + '</span></span>'
          + '<span class="ob-journey-detail">' + esc(s.detail || '')
          + (s.at ? ' · ' + esc(fmtDate(s.at)) : '') + '</span>'
          + '</span>'
          + (s.state === 'current' && s.action
            ? '<button class="btn ob-btn-sm primary" onclick="Onboarding.journeyAction(\''
              + jsq(s.action.verb) + '\')">' + esc(s.action.label) + '</button>'
            : (s.action
              ? '<button class="btn ob-btn-sm" onclick="Onboarding.journeyAction(\''
                + jsq(s.action.verb) + '\')">' + esc(s.action.label) + '</button>'
              : ''))
          + '</li>';
      }).join('')
      + '</ol>';
  }

  /** Load and draw the journey panel for the open assignment. */
  async function loadJourney() {
    var host = doc.getElementById('ob-journey-host');
    if (!host) return;
    var res = await api('/api/onboarding/assignments/'
      + encodeURIComponent(assignmentId()) + '/journey');
    if (!res.ok) {
      host.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>';
      return;
    }
    S.journey = res;

    var pack = res.starterPack;
    var docs = res.returnedDocuments || [];
    var ex = res.extraction || {};
    var sum = ex.summary || {};

    host.innerHTML = ''
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head">'
      + '    <h2>Progress</h2>'
      + '    <span class="ob-quiet">' + res.progressPercent + '% complete</span>'
      + '  </div>'
      + '  <div class="ob-section-body">'
      + (res.nextAction
        ? '<div class="ob-note is-info"><strong>Next: ' + esc(res.nextAction.label) + '.</strong> '
          + esc(res.nextAction.detail || '') + '</div>'
        : '')
      + journeySteps(res.steps || [])
      + '  </div>'
      + '</div>'

      // ── Starter pack ──────────────────────────────────────────────────────
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head"><h2>Starter pack</h2>'
      + (pack ? '<span class="ob-quiet">' + pack.documentCount + ' documents · '
        + esc(bytes(pack.sizeBytes)) + '</span>' : '')
      + '  </div>'
      + '  <div class="ob-section-body">'
      + (pack
        ? '<div class="ob-inline-actions ob-mb-3">'
          + '<a class="btn ob-btn-sm" href="/api/onboarding/assignments/'
          + encodeURIComponent(assignmentId()) + '/starter-pack/download">Download</a> '
          + '<button class="btn ob-btn-sm" onclick="Onboarding.journeyAction(\'send\')">'
          + (res.assignment.status === 'starter_pack_ready' ? 'Send starter pack' : 'Resend starter pack')
          + '</button> '
          + '<button class="btn ob-btn-sm" onclick="Onboarding.regeneratePack()">Rebuild</button>'
          + '</div>'
          + '<ol class="ob-pack-list">'
          + (pack.manifest || []).map(function (m) {
            return '<li><span class="ob-pack-title">' + esc(m.title) + '</span>'
              + '<span class="ob-quiet">' + esc(m.publisherEdition || ('Version ' + m.documentVersion))
              + ' · ' + esc(bytes(m.sizeBytes)) + '</span></li>';
          }).join('')
          + '</ol>'
          + ((pack.omissions || []).length
            ? '<div class="ob-note is-warn ob-mt-3"><strong>Left out of the pack.</strong><ul '
              + 'style="margin:8px 0 0 18px;">'
              + pack.omissions.map(function (o) {
                return '<li>' + esc(o.title || o.code || 'A document') + ' — ' + esc(o.reason) + '</li>';
              }).join('') + '</ul></div>'
            : '')
        : empty('No starter pack yet',
          'Generate one and it will be ready to email, with every document this package includes.')
          + '<div class="ob-inline-actions ob-mt-3">'
          + '<button class="btn primary" onclick="Onboarding.journeyAction(\'generate\')">'
          + 'Generate starter pack</button></div>')
      + (res.dispatches && res.dispatches.length
        ? '<details class="ob-details ob-mt-3"><summary>Email history</summary>'
          + '<div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">When</th><th scope="col">What</th>'
          + '<th scope="col">To</th><th scope="col">Result</th></tr></thead><tbody>'
          + res.dispatches.map(function (d) {
            return '<tr><td>' + fmtDate(d.created_at) + '</td>'
              + '<td>' + esc(d.kind === 'starter_pack' ? 'Starter pack' : 'Sign-in details')
              + (d.attempt > 1 ? ' (resend ' + esc(d.attempt - 1) + ')' : '') + '</td>'
              + '<td>' + esc(d.to_email) + '</td>'
              + '<td>' + esc(dispatchLabel(d)) + '</td></tr>';
          }).join('')
          + '</tbody></table></div></details>'
        : '')
      + '  </div>'
      + '</div>'

      // ── Returned documents ────────────────────────────────────────────────
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head"><h2>Returned documents</h2>'
      + '    <button class="btn ob-btn-sm" onclick="Onboarding.journeyAction(\'upload\')">Upload</button>'
      + '  </div>'
      + '  <div class="ob-section-body' + (docs.length ? ' is-flush' : '') + '">'
      + (docs.length
        ? '<div class="ob-req-list">'
          + docs.map(function (d) {
            return '<div class="ob-req">'
              + '<div class="ob-req-main"><div class="ob-req-title">' + esc(d.title || d.fileName) + '</div>'
              + '<div class="ob-req-meta">' + esc(bytes(d.sizeBytes))
              + (d.pageCount ? ' · ' + d.pageCount + ' page' + (d.pageCount === 1 ? '' : 's') : '')
              + ' · ' + esc(readableLabel(d.textStatus)) + '</div></div>'
              + '<div class="ob-req-actions">'
              + (d.previewKind
                ? '<button class="btn ob-btn-sm" onclick="Onboarding.previewReturned(\''
                  + jsq(d.id) + '\',\'' + jsq(d.title || d.fileName) + '\',\'' + jsq(d.previewKind)
                  + '\')">Preview</button> '
                : '')
              + '<button class="btn ob-btn-sm" onclick="Onboarding.archiveReturned(\''
              + jsq(d.id) + '\')">Remove</button>'
              + '</div></div>';
          }).join('')
          + '</div>'
        : empty('Nothing returned yet',
          'When the completed forms come back, upload them here and we will read the details out of them.'))
      + '  </div>'
      + '</div>'

      // ── Details read from those documents ─────────────────────────────────
      + (docs.length
        ? '<div class="ob-section-card">'
          + '  <div class="ob-section-head"><h2>Employee details</h2>'
          + (sum.total
            ? '<span class="ob-quiet">' + sum.confirmed + ' of ' + sum.total + ' confirmed</span>'
            : '')
          + '  </div>'
          + '  <div class="ob-section-body">'
          + (sum.total
            ? (sum.needsReview
              ? '<div class="ob-note is-warn"><strong>' + sum.needsReview + ' detail'
                + (sum.needsReview === 1 ? '' : 's') + ' still to check.</strong> '
                + 'Nothing reaches the employee record until you confirm it.</div>'
              : '<div class="ob-note is-ok"><strong>All checked.</strong></div>')
              + '<div class="ob-inline-actions ob-mt-3">'
              + '<button class="btn primary" onclick="Onboarding.reviewDetails()">Review details</button> '
              + '<button class="btn ob-btn-sm" onclick="Onboarding.journeyAction(\'extract\')">'
              + 'Read again</button></div>'
            : (ex.run && ex.run.status === 'failed'
              ? '<div class="ob-note is-warn"><strong>We could not read these documents.</strong> '
                + esc(extractionFailureText(ex.run.errorReason))
                + '</div><div class="ob-inline-actions ob-mt-3">'
                + '<button class="btn" onclick="Onboarding.journeyAction(\'extract\')">Try again</button></div>'
              : '<p>We can read the details straight off the returned forms so nobody has to '
                + 'retype them. You check everything before it is saved.</p>'
                + '<div class="ob-inline-actions ob-mt-3">'
                + '<button class="btn primary" onclick="Onboarding.journeyAction(\'extract\')">'
                + 'Read the documents</button></div>'))
          + '  </div>'
          + '</div>'
        : '')

      // ── Portal account ────────────────────────────────────────────────────
      + '<div class="ob-section-card">'
      + '  <div class="ob-section-head"><h2>Portal account</h2></div>'
      + '  <div class="ob-section-body">'
      + (res.assignment.userId && res.assignment.status !== 'created'
        && ['account_created', 'invite_sent', 'invite_accepted', 'in_progress',
          'employee_actions_complete', 'employer_review', 'corrections_required',
          'ready_to_activate', 'activated', 'completed'].indexOf(res.assignment.status) !== -1
        ? '<p><strong>Created.</strong> They sign in as '
          + esc(res.assignment.loginEmail || res.assignment.email) + '.</p>'
          + '<div class="ob-inline-actions ob-mt-3">'
          + '<button class="btn" onclick="Onboarding.journeyAction(\'invite\')">'
          + 'Send sign-in details</button> '
          + (res.canCreateAccount
            ? '<button class="btn ob-btn-sm" onclick="Onboarding.reissuePassword()">'
              + 'New temporary password</button>' : '')
          + '</div>'
        : (res.canCreateAccount
          ? '<p>Create their account once you are happy with the details above. '
            + 'They will get a temporary password and be asked to choose their own on first sign-in.</p>'
            + '<div class="ob-inline-actions ob-mt-3">'
            + '<button class="btn primary" onclick="Onboarding.journeyAction(\'account\')">'
            + 'Create portal account</button></div>'
          : '<p class="ob-quiet">Only the practice owner can create a portal account.</p>'))
      + '  </div>'
      + '</div>';
  }

  function dispatchLabel(d) {
    if (d.status === 'sent') return d.attachment_included ? 'Sent with the pack attached' : 'Sent';
    if (d.status === 'draft_created') return 'Draft prepared in Outlook';
    if (d.status === 'skipped') return 'Not sent — email is not configured';
    if (d.status === 'failed') return 'Failed';
    return 'Prepared';
  }

  function readableLabel(textStatus) {
    if (textStatus === 'extracted') return 'Readable';
    if (textStatus === 'no_text_layer') return 'A scan — we cannot read the text';
    if (textStatus === 'unsupported') return 'We cannot read this type';
    if (textStatus === 'failed') return 'Could not be opened';
    return 'Not checked yet';
  }

  function extractionFailureText(reason) {
    if (reason === 'no_readable_text') {
      return 'They look like scans or photographs. Enter the details yourself below — '
        + 'the employee will be asked to check them either way.';
    }
    if (reason === 'encryption_unavailable') {
      return 'Bank details cannot be stored until field encryption is configured.';
    }
    return 'Your documents are safe. You can try again, or enter the details yourself.';
  }

  /** One dispatcher, so the server's `verb` is the only vocabulary. */
  function journeyAction(verb) {
    if (verb === 'generate') return generatePack();
    if (verb === 'send') return sendPackDialog();
    if (verb === 'upload') return uploadReturnedDialog();
    if (verb === 'extract') return runExtraction();
    if (verb === 'review') return reviewDetails();
    if (verb === 'account') return createAccountDialog();
    if (verb === 'invite') return sendInviteDialog();
    return undefined;
  }

  // ── Starter pack ────────────────────────────────────────────────────────────

  async function generatePack(regenerate) {
    toast('Building the starter pack…');
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/starter-pack', { method: 'POST', body: { regenerate: regenerate === true } });
    if (!res.ok) {
      openModal({
        title: 'The starter pack could not be built',
        body: '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>'
          + (res.details && res.details.message ? '<p>' + esc(res.details.message) + '</p>' : '')
          + ((res.details && res.details.omissions || []).length
            ? '<ul style="margin:8px 0 0 18px;">'
              + res.details.omissions.map(function (o) {
                return '<li>' + esc(o.title || o.code) + ' — ' + esc(o.reason) + '</li>';
              }).join('') + '</ul>'
            : ''),
        footer: '<button class="btn" onclick="Onboarding.closeModal()">Close</button>',
      });
      return;
    }
    toast(res.reused ? 'Starter pack ready' : 'Starter pack built');
    await refreshAssignment();
  }

  function regeneratePack() {
    openModal({
      title: 'Rebuild the starter pack',
      subtitle: 'Only affects this person.',
      body: '<div class="ob-note is-info">This rebuilds the pack from the package version this '
        + 'onboarding is pinned to. If you have published package changes since, they are '
        + '<strong>not</strong> included — that is deliberate, so nobody\'s pack changes after it '
        + 'was sent.</div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.confirmRegenerate()">Rebuild</button>',
    });
  }

  async function confirmRegenerate() { closeModal(); await generatePack(true); }

  function sendPackDialog() {
    var j = S.journey || {};
    var a = j.assignment || {};
    openModal({
      title: 'Send the starter pack',
      subtitle: a.name || '',
      body: '<div class="ob-note is-info">The email is already written. It explains what to complete, '
        + 'how to send the forms back, and asks them not to email their tax file number.</div>'
        + field('Send to', 'toEmail', 'email', a.email || '')
        + '<div class="ob-field"><label for="ob-send-method">How</label>'
        + '<select id="ob-send-method" name="method">'
        + '<option value="smtp">Send it now from the practice mailbox</option>'
        + '<option value="graph_draft">Prepare a draft in my Outlook to review first</option>'
        + '</select>'
        + '<p class="ob-hint">A draft needs Outlook permissions your practice may not have granted '
        + 'yet. If it is unavailable we will tell you, and nothing is lost.</p></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitSendPack()">Send starter pack</button>',
    });
  }

  async function submitSendPack() {
    var v = modalValues();
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/starter-pack/send', { method: 'POST', body: { toEmail: v.toEmail, method: v.method } });
    if (!res.ok) { modalError(res.error || 'That did not work. Your starter pack is still saved.'); return; }
    closeModal();
    if (res.webLink) {
      openModal({
        title: 'Draft ready in Outlook',
        body: '<div class="ob-note is-ok">' + esc(res.message) + '</div>',
        footer: '<button class="btn" onclick="Onboarding.closeModal()">Close</button>'
          + '<a class="btn primary" href="' + esc(res.webLink) + '" target="_blank"'
          + ' rel="noopener noreferrer">Open the draft</a>',
      });
    } else {
      toast(res.message || 'Starter pack sent');
    }
    await refreshAssignment();
  }

  // ── Returned documents ──────────────────────────────────────────────────────

  function uploadReturnedDialog() {
    openModal({
      title: 'Upload returned documents',
      subtitle: 'The completed forms, as they came back',
      body: '<div class="ob-note is-info">Upload everything they sent — one file or several. '
        + 'We keep the originals exactly as received, and reading them never replaces them.</div>'
        + '<div class="ob-field"><label for="ob-ret-files">Files</label>'
        + '<input type="file" id="ob-ret-files" multiple '
        + 'accept=".pdf,.png,.jpg,.jpeg,.doc,.docx,.txt">'
        + '<p class="ob-hint">PDF, Word, or a photograph. Up to 10 MB each, 12 at a time.</p></div>'
        + '<div id="ob-ret-progress" aria-live="polite"></div>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitReturned()">Upload</button>',
    });
  }

  /** Read one File into base64, without the data: prefix. */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      var reader = new global.FileReader();
      reader.onload = function () {
        var out = String(reader.result || '');
        resolve(out.slice(out.indexOf(',') + 1));
      };
      reader.onerror = function () { reject(new Error('read_failed')); };
      reader.readAsDataURL(file);
    });
  }

  async function submitReturned() {
    var input = doc.getElementById('ob-ret-files');
    var progress = doc.getElementById('ob-ret-progress');
    var files = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (!files.length) { modalError('Choose at least one file.'); return; }
    if (files.length > 12) { modalError('Please upload at most 12 files at a time.'); return; }

    if (progress) progress.innerHTML = spinner('Uploading…');
    var payload = [];
    for (var i = 0; i < files.length; i += 1) {
      try {
        payload.push({
          fileName: files[i].name,
          fileMime: files[i].type || 'application/octet-stream',
          fileSizeBytes: files[i].size,
          fileData: await readFile(files[i]),
        });
      } catch (_) {
        if (progress) progress.innerHTML = '';
        modalError('One of those files could not be read.');
        return;
      }
    }

    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/returned-documents', { method: 'POST', body: { files: payload } });
    if (progress) progress.innerHTML = '';
    if (!res.ok) { modalError(res.error); return; }

    closeModal();
    var kept = (res.stored || []).filter(function (s) { return !s.duplicate; }).length;
    var dupes = (res.stored || []).length - kept;
    toast(kept + ' document' + (kept === 1 ? '' : 's') + ' uploaded'
      + (dupes ? ' · ' + dupes + ' already had' : ''));

    if ((res.rejected || []).length || res.message) {
      openModal({
        title: 'Uploaded',
        body: (res.message ? '<div class="ob-note is-warn">' + esc(res.message) + '</div>' : '')
          + ((res.rejected || []).length
            ? '<div class="ob-note is-danger"><strong>Not accepted:</strong><ul '
              + 'style="margin:8px 0 0 18px;">'
              + res.rejected.map(function (r) {
                return '<li>' + esc(r.fileName) + ' — ' + esc(r.reason) + '</li>';
              }).join('') + '</ul></div>'
            : ''),
        footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
      });
    }
    await refreshAssignment();
  }

  async function archiveReturned(docId) {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/returned-documents/' + encodeURIComponent(docId), { method: 'DELETE' });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Removed from the list — the file is kept on the record');
    await refreshAssignment();
  }

  // ── Reading the documents ───────────────────────────────────────────────────

  async function runExtraction() {
    openModal({
      title: 'Reading the documents',
      body: spinner('Reading the forms you uploaded…')
        + '<p class="ob-hint ob-mt-3">This usually takes a few seconds. Nothing is saved to the '
        + 'employee record until you have checked it.</p>',
    });
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/extraction', { method: 'POST' });
    if (!res.ok) {
      openModal({
        title: 'We could not read those documents',
        body: '<div class="ob-note is-warn" role="alert">' + esc(res.error) + '</div>'
          + (res.details && res.details.message ? '<p>' + esc(res.details.message) + '</p>' : ''),
        footer: '<button class="btn" onclick="Onboarding.closeModal()">Close</button>'
          + '<button class="btn primary" onclick="Onboarding.reviewDetails()">Enter them myself</button>',
      });
      return;
    }
    closeModal();
    toast(res.fieldsProposed + ' detail' + (res.fieldsProposed === 1 ? '' : 's') + ' found');
    await refreshAssignment();
    await reviewDetails();
  }

  /**
   * Review what was read.
   *
   * Grouped the way a person thinks about it, not the way it is stored. Every
   * row shows the value, where it came from, and how sure we are — and the
   * Owner accepts, corrects or rejects each one. Nothing here writes to the
   * employee record; that is the Save at the bottom, deliberately separate.
   */
  async function reviewDetails() {
    var res = await api('/api/onboarding/assignments/'
      + encodeURIComponent(assignmentId()) + '/extraction');
    if (!res.ok) { toast(res.error, true); return; }
    S.review = res;

    var sum = res.summary || {};
    openModal({
      title: 'Review employee details',
      subtitle: sum.needsReview
        ? sum.needsReview + ' still to check'
        : 'Everything has been checked',
      wide: true,
      body: reviewBody(res),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Close</button>'
        + '<button class="btn primary" onclick="Onboarding.applyDetails()">'
        + 'Save to the employee record</button>',
    });
  }

  function reviewBody(res) {
    var groups = res.groups || [];
    if (!groups.length) {
      return '<div class="ob-note is-info">Nothing has been read from the documents yet.</div>';
    }
    return '<div class="ob-note is-info">These came off the forms that were returned. '
      + 'Check each one — nothing is written to the employee record until you save.</div>'
      + groups.map(function (g) {
        return '<div class="ob-review-group">'
          + '<h3>' + esc(g.label) + '</h3>'
          + g.fields.map(reviewField).join('')
          + '</div>';
      }).join('')
      + (res.canSeePayroll ? '' : '<p class="ob-hint ob-mt-3">Bank and superannuation details are '
        + 'hidden because you do not hold the payroll permission.</p>');
  }

  function reviewField(f) {
    var value = f.visible
      ? (f.value === null || f.value === '' ? '—' : f.value)
      : 'Hidden';
    var decided = f.status !== 'proposed';
    return '<div class="ob-review-row' + (decided ? ' is-decided' : '') + '">'
      + '<div class="ob-review-main">'
      + '<div class="ob-review-label">' + esc(f.label)
      + (f.sensitive ? ' <span class="ob-chip is-sensitive">Sensitive</span>' : '')
      + '</div>'
      + '<div class="ob-review-value' + (f.visible ? '' : ' is-hidden') + '">' + esc(value) + '</div>'
      + '<div class="ob-review-source">'
      + esc(reviewStatusText(f))
      + (f.source && f.source.label
        ? ' · from ' + esc(f.source.label)
          + (f.source.page ? ', page ' + esc(f.source.page) : '')
        : '')
      + '</div>'
      + '</div>'
      + (f.visible
        ? '<div class="ob-review-actions">'
          + (decided
            ? '<button class="btn ob-btn-sm" onclick="Onboarding.correctField(\'' + jsq(f.id)
              + '\')">Change</button>'
            // "Correct" was the first label here and it was ambiguous: an
            // Owner could read it as "this is correct" or as "correct this",
            // which are opposite instructions sitting next to each other.
            // Every label below is unmistakably an action or an assessment.
            : '<button class="btn ob-btn-sm primary" onclick="Onboarding.decideField(\'' + jsq(f.id)
              + '\',\'accept\')">Looks right</button> '
              + '<button class="btn ob-btn-sm" onclick="Onboarding.correctField(\'' + jsq(f.id)
              + '\')">Change</button> '
              + '<button class="btn ob-btn-sm" onclick="Onboarding.decideField(\'' + jsq(f.id)
              + '\',\'reject\')">Discard</button>')
          + '</div>'
        : '')
      + '</div>';
  }

  function reviewStatusText(f) {
    if (f.status === 'applied') return 'Saved to the record';
    if (f.status === 'corrected') return 'You corrected this';
    if (f.status === 'accepted') return 'You confirmed this';
    if (f.status === 'rejected') return 'You said this was wrong';
    if (f.confidence === 'high') return 'Clearly written';
    if (f.confidence === 'medium') return 'Legible, worth a look';
    return 'Hard to read — please check';
  }

  async function decideField(fieldId, decision) {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/extraction/fields/' + encodeURIComponent(fieldId),
    { method: 'PATCH', body: { decision: decision } });
    if (!res.ok) { modalError(res.error); return; }
    await refreshReview();
  }

  function correctField(fieldId) {
    var res = S.review || {};
    var field = null;
    (res.groups || []).forEach(function (g) {
      g.fields.forEach(function (f) { if (f.id === fieldId) field = f; });
    });
    if (!field) return;

    openModal({
      title: 'Correct ' + field.label.toLowerCase(),
      subtitle: field.source && field.source.label
        ? 'Read from ' + field.source.label : '',
      body: (field.sensitive
        ? '<div class="ob-note is-info">Type the whole value. We only ever show you a masked '
          + 'version afterwards.</div>' : '')
        + field2('New value', 'value', 'text', field.sensitive ? '' : (field.value || '')),
      footer: '<button class="btn" onclick="Onboarding.reviewDetails()">Back</button>'
        + '<button class="btn primary" onclick="Onboarding.submitCorrectField(\'' + jsq(fieldId)
        + '\')">Save this value</button>',
    });
  }

  async function submitCorrectField(fieldId) {
    var v = modalValues();
    if (!v.value) { modalError('Enter a value, or use Discard to leave this one out.'); return; }
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/extraction/fields/' + encodeURIComponent(fieldId),
    { method: 'PATCH', body: { decision: 'correct', value: v.value } });
    if (!res.ok) { modalError(res.error); return; }
    await reviewDetails();
  }

  /** Redraw the open review dialog without closing it. */
  async function refreshReview() {
    var res = await api('/api/onboarding/assignments/'
      + encodeURIComponent(assignmentId()) + '/extraction');
    if (!res.ok) return;
    S.review = res;
    var body = doc.getElementById('ob-modal-body');
    if (body) body.innerHTML = reviewBody(res);
    var title = doc.querySelector('#ob-modal-title + p');
    if (title) {
      title.textContent = (res.summary && res.summary.needsReview)
        ? res.summary.needsReview + ' still to check' : 'Everything has been checked';
    }
  }

  async function applyDetails() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/extraction/apply', { method: 'POST' });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast(res.message || 'Employee record updated');
    await refreshAssignment();
  }

  // ── Portal account ──────────────────────────────────────────────────────────

  function createAccountDialog() {
    var j = S.journey || {};
    var a = j.assignment || {};
    openModal({
      title: 'Create portal account',
      subtitle: a.name || '',
      body: '<div class="ob-note is-info">We will generate a temporary password and show it to you '
        + 'once. They will be asked to choose their own the first time they sign in.</div>'
        + '<div class="ob-field"><label>Portal access</label>'
        + radio('portalRole', 'employee', 'Employee',
          'Their own calendar, their own clients, their own records.', true)
        + radio('portalRole', 'admin', 'Admin',
          'Practice-wide scheduling and travel. No financials, no user management.', false)
        + '</div>'
        + field2('Sign-in email', 'loginEmail', 'email', a.loginEmail || a.email || '')
        + '<p class="ob-hint">This is what they type to sign in. It can be their personal address '
        + 'or an Opal Therapy one — whichever they will actually use.</p>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitCreateAccount()">'
        + 'Create account</button>',
    });
  }

  async function submitCreateAccount() {
    var v = modalValues();
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/account', { method: 'POST', body: { portalRole: v.portalRole, loginEmail: v.loginEmail } });
    if (!res.ok) { modalError(res.error); return; }
    showCredential(res, 'Account created');
    await refreshAssignment();
  }

  async function reissuePassword() {
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/account/reissue-password', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    showCredential(res, 'New temporary password');
  }

  /**
   * Show the temporary password exactly once.
   *
   * It is never stored in clear and cannot be retrieved again, so the dialog
   * says so plainly rather than letting an Owner discover it by closing the
   * window. The only remedy afterwards is to issue a new one, which is the
   * correct trade.
   */
  function showCredential(res, title) {
    S.pendingCredential = res.temporaryPassword || null;
    openModal({
      title: title,
      subtitle: res.loginEmail || '',
      body: '<div class="ob-note is-warn"><strong>This is the only time this password is shown.</strong> '
        + 'Send the sign-in email now, or copy it somewhere safe.</div>'
        + '<div class="ob-cred">'
        + '<div><span>Sign in at</span><strong>' + esc(res.loginUrl || '') + '</strong></div>'
        + '<div><span>Email</span><strong>' + esc(res.loginEmail || '') + '</strong></div>'
        + '<div><span>Temporary password</span><code>' + esc(res.temporaryPassword || '') + '</code></div>'
        + '</div>'
        + '<p class="ob-hint ob-mt-3">It expires '
        + esc(fmtDateLong(res.temporaryPasswordExpiresAt) || 'in a week')
        + ', and stops working the moment they choose their own.</p>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Close</button>'
        + '<button class="btn primary" onclick="Onboarding.sendInviteDialog()">'
        + 'Send sign-in details</button>',
    });
  }

  function sendInviteDialog() {
    var j = S.journey || {};
    var a = j.assignment || {};
    var held = !!S.pendingCredential;
    openModal({
      title: 'Send sign-in details',
      subtitle: a.loginEmail || a.email || '',
      body: '<div class="ob-note is-info">The email tells them where to sign in, that their first '
        + 'password is temporary, and what they will be asked to do next.</div>'
        + (held
          ? '<div class="ob-field"><label class="ob-check">'
            + '<input type="checkbox" name="includePassword" checked> '
            + 'Include the temporary password in the email</label>'
            + '<p class="ob-hint">Convenient, and the usual choice for a new starter. '
            + 'Leave it unticked if you would rather pass the password on by phone — '
            + 'an email is forwarded and archived in places nobody controls.</p></div>'
          : '<div class="ob-note is-warn">The temporary password is no longer available to include '
            + '— it is never stored. Send this email and pass the password on separately, or issue '
            + 'a new one first.</div>'),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitInvite()">Send</button>',
    });
  }

  async function submitInvite() {
    var v = modalValues();
    var body = {};
    if (v.includePassword && S.pendingCredential) body.temporaryPassword = S.pendingCredential;
    var res = await api('/api/onboarding/assignments/' + encodeURIComponent(assignmentId())
      + '/account/invite', { method: 'POST', body: body });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    // The credential is dropped from memory once it has been delivered.
    S.pendingCredential = null;
    toast(res.message || 'Sign-in details sent');
    await refreshAssignment();
  }

  /** Reload the open assignment and redraw its journey panel. */
  async function refreshAssignment() {
    if (!assignmentId()) return;
    await renderManage(root());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  PACKAGE DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════════════

  /** Draw the starter-pack document list inside an open package. */
  async function loadPackageDocuments() {
    var host = doc.getElementById('ob-pkg-docs');
    if (!host) return;
    var id = S.packageDetail && S.packageDetail.id;
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(id) + '/documents');
    if (!res.ok) {
      host.innerHTML = '<div class="ob-note is-danger" role="alert">' + esc(res.error) + '</div>';
      return;
    }
    S.packageDocs = res;
    var editable = can('onboarding.manage_packages');
    var included = (res.documents || []).filter(function (d) { return !d.excluded; });
    var removed = (res.documents || []).filter(function (d) { return d.excluded; });

    host.innerHTML = ''
      + (res.package.hasUnpublishedChanges
        ? '<div class="ob-note is-warn"><strong>Unpublished changes.</strong> '
          + 'Anyone already onboarding keeps the pack they were sent. Publish to use these '
          + 'changes for new starters.</div>'
        : '')
      + (included.length
        ? '<ol class="ob-pack-list is-editable">'
          + included.map(function (d, i) { return packDocRow(d, i, included.length, editable); }).join('')
          + '</ol>'
        : empty('No documents yet',
          'Add the forms and policies a new starter should receive.'))
      + (removed.length
        ? '<details class="ob-details ob-mt-3"><summary>'
          + removed.length + ' left out of the pack</summary>'
          + '<ol class="ob-pack-list">'
          + removed.map(function (d) {
            return '<li><span class="ob-pack-title">' + esc(d.title) + '</span>'
              + '<span class="ob-quiet">Still required in the portal, just not emailed</span>'
              + (editable
                ? '<button class="btn ob-btn-sm" onclick="Onboarding.restorePackageDoc(\''
                  + jsq(d.documentId) + '\')">Put back</button>' : '')
              + '</li>';
          }).join('')
          + '</ol></details>'
        : '')
      + (editable
        ? '<div class="ob-inline-actions ob-mt-3">'
          + '<button class="btn" onclick="Onboarding.addPackageDocDialog()">Add document</button>'
          + '</div>'
        : '');
  }

  function packDocRow(d, index, total, editable) {
    var actions = '';
    if (d.available && d.previewUrl) {
      actions += '<button class="btn ob-btn-sm" onclick="Onboarding.previewDocument(\''
        + jsq(d.documentId) + '\',\'' + jsq(previewVersionId(d)) + '\',\'' + jsq(d.title)
        + '\',\'' + jsq(d.previewKind || 'pdf') + '\',\''
        + jsq(d.publisherEdition || '') + '\')">Preview</button> ';
    }
    if (editable) {
      actions += '<button class="btn ob-btn-sm" onclick="Onboarding.replacePackageDoc(\''
        + jsq(d.documentId) + '\')">Replace</button> '
        + '<button class="btn ob-btn-sm" onclick="Onboarding.renamePackageDoc(\''
        + jsq(d.documentId) + '\')">Rename</button> '
        + '<button class="btn ob-btn-sm" onclick="Onboarding.removePackageDoc(\''
        + jsq(d.documentId) + '\')">Remove</button>';
    }

    var move = editable
      ? '<span class="ob-pack-move">'
        + '<button class="btn ob-btn-icon" aria-label="Move up" ' + (index === 0 ? 'disabled' : '')
        + ' onclick="Onboarding.movePackageDoc(\'' + jsq(d.documentId) + '\',-1)">↑</button>'
        + '<button class="btn ob-btn-icon" aria-label="Move down" '
        + (index === total - 1 ? 'disabled' : '')
        + ' onclick="Onboarding.movePackageDoc(\'' + jsq(d.documentId) + '\',1)">↓</button>'
        + '</span>'
      : '';

    return '<li class="ob-pack-doc' + (d.available ? '' : ' is-unavailable') + '">'
      + move
      + '<span class="ob-pack-main">'
      + '<span class="ob-pack-title">' + esc(d.title)
      + (d.renamed ? ' <span class="ob-quiet">(shown as this in this package)</span>' : '') + '</span>'
      + '<span class="ob-pack-meta">' + esc(d.requirement)
      + (d.publisherEdition ? ' · ' + esc(d.publisherEdition) : '')
      + (d.sizeBytes ? ' · ' + esc(bytes(d.sizeBytes)) : '')
      + '</span>'
      + (d.available ? '' : '<span class="ob-pack-warn">' + esc(d.unavailableReason) + '</span>')
      + '</span>'
      + '<span class="ob-pack-actions">' + actions + '</span>'
      + '</li>';
  }

  /** The version id sits inside the preview URL the server built. */
  function previewVersionId(d) {
    var m = String(d.previewUrl || '').match(/\/versions\/([0-9a-f-]{36})\//i);
    return m ? m[1] : '';
  }

  function addPackageDocDialog() {
    var res = S.packageDocs || {};
    var options = (res.available || []).filter(function (d) { return d.ready; });
    if (!options.length) {
      openModal({
        title: 'Add a document',
        body: '<div class="ob-note is-info">Every published document is already in this package. '
          + 'Upload a new one in the Document Library first, publish it, then come back.</div>',
        footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
      });
      return;
    }
    openModal({
      title: 'Add a document to this starter pack',
      body: selectField('Document', 'documentId', '',
        options.map(function (d) { return [d.documentId, d.title]; })),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitAddPackageDoc()">Add</button>',
    });
  }

  async function submitAddPackageDoc() {
    var v = modalValues();
    if (!v.documentId) { modalError('Choose a document.'); return; }
    var res = await api('/api/onboarding/packages/'
      + encodeURIComponent(S.packageDetail.id) + '/documents',
    { method: 'POST', body: { documentId: v.documentId } });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast('Added to the starter pack');
    await loadPackageDocuments();
  }

  function renamePackageDoc(documentId) {
    var d = findPackageDoc(documentId);
    if (!d) return;
    openModal({
      title: 'Rename in this package',
      subtitle: d.libraryTitle,
      body: '<div class="ob-note is-info">This changes what the document is called <strong>here</strong>. '
        + 'Its own title, and every record of what previous employees received, stays as it is.</div>'
        + field2('Shown as', 'displayTitle', 'text', d.title),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + (d.renamed
          ? '<button class="btn" onclick="Onboarding.submitRenamePackageDoc(\'' + jsq(documentId)
            + '\',true)">Use its own title</button>' : '')
        + '<button class="btn primary" onclick="Onboarding.submitRenamePackageDoc(\'' + jsq(documentId)
        + '\')">Rename</button>',
    });
  }

  async function submitRenamePackageDoc(documentId, reset) {
    var v = modalValues();
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id)
      + '/documents/' + encodeURIComponent(documentId),
    { method: 'PATCH', body: { displayTitle: reset ? null : v.displayTitle } });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast(res.message || 'Renamed');
    await loadPackageDocuments();
  }

  function removePackageDoc(documentId) {
    var d = findPackageDoc(documentId);
    if (!d) return;
    openModal({
      title: 'Remove from the starter pack',
      subtitle: d.title,
      body: '<div class="ob-note is-warn">Nothing is deleted. This document stops going out in new '
        + 'starter packs; everyone already onboarding keeps the pack they were sent, and the '
        + 'record of what they received is untouched.'
        + (d.fromRequirement
          ? ' They will still be asked to read and acknowledge it in the portal.' : '')
        + '</div>'
        + field2('Why? (recorded)', 'reason', 'text', ''),
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.submitRemovePackageDoc(\'' + jsq(documentId)
        + '\')">Remove</button>',
    });
  }

  async function submitRemovePackageDoc(documentId) {
    var v = modalValues();
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id)
      + '/documents/' + encodeURIComponent(documentId),
    { method: 'DELETE', body: { reason: v.reason } });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    toast(res.message || 'Removed from future packs');
    await loadPackageDocuments();
  }

  async function restorePackageDoc(documentId) {
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id)
      + '/documents/' + encodeURIComponent(documentId) + '/restore', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Back in the starter pack');
    await loadPackageDocuments();
  }

  /**
   * Replacing a document is publishing a new VERSION of it.
   *
   * Sending the Owner to the Document Library rather than duplicating the
   * upload form here is deliberate: that screen already handles the file, the
   * change note and the publish step, and a second one would be the copy that
   * forgot something.
   */
  function replacePackageDoc(documentId) {
    var d = findPackageDoc(documentId);
    if (!d) return;
    openModal({
      title: 'Replace this document',
      subtitle: d.title,
      body: '<div class="ob-note is-info">A replacement is a <strong>new version</strong> of the same '
        + 'document, not a new document. That is what lets an employment record from last year '
        + 'still say exactly which edition that person was issued.</div>'
        + '<p>Upload the new file in the Document Library and publish it. Every package that '
        + 'includes this document picks it up for new starters; nobody already onboarding is '
        + 'changed.</p>',
      footer: '<button class="btn" onclick="Onboarding.closeModal()">Cancel</button>'
        + '<button class="btn primary" onclick="Onboarding.goToDocument(\'' + jsq(documentId)
        + '\')">Open in the Document Library</button>',
    });
  }

  function goToDocument(documentId) {
    closeModal();
    S.documentFocus = documentId;
    S.packageDetail = null;
    nav('documents');
  }

  async function movePackageDoc(documentId, delta) {
    var res = S.packageDocs || {};
    var list = (res.documents || []).filter(function (d) { return !d.excluded; });
    var at = list.findIndex(function (d) { return d.documentId === documentId; });
    if (at < 0) return;
    var to = at + delta;
    if (to < 0 || to >= list.length) return;
    var order = list.map(function (d) { return d.documentId; });
    order.splice(to, 0, order.splice(at, 1)[0]);

    var out = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id)
      + '/documents/reorder', { method: 'POST', body: { documentIds: order } });
    if (!out.ok) { toast(out.error, true); return; }
    await loadPackageDocuments();
  }

  function findPackageDoc(documentId) {
    var res = S.packageDocs || {};
    return (res.documents || []).find(function (d) { return d.documentId === documentId; }) || null;
  }

  async function packageDocHistory(documentId) {
    var res = await api('/api/onboarding/packages/' + encodeURIComponent(S.packageDetail.id)
      + '/documents/' + encodeURIComponent(documentId) + '/history');
    if (!res.ok) { toast(res.error, true); return; }
    openModal({
      title: res.document.title,
      subtitle: 'Every edition, and who received which',
      wide: true,
      body: '<div class="ob-table-wrap"><table class="ob-table">'
        + '<thead><tr><th scope="col">Edition</th><th scope="col">Published</th>'
        + '<th scope="col">Note</th><th scope="col"></th></tr></thead><tbody>'
        + res.versions.map(function (v) {
          return '<tr><td>' + esc(v.publisherEdition || ('Version ' + v.version))
            + (v.current ? ' <span class="ob-chip published">Current</span>' : '') + '</td>'
            + '<td>' + fmtDate(v.publishedAt) + '</td>'
            + '<td>' + esc(v.changeNote || '—') + '</td>'
            + '<td>' + (v.previewKind
              ? '<button class="btn ob-btn-sm" onclick="Onboarding.previewDocument(\''
                + jsq(res.document.id) + '\',\'' + jsq(v.id) + '\',\'' + jsq(v.title)
                + '\',\'' + jsq(v.previewKind) + '\',\'' + jsq(v.publisherEdition || '')
                + '\')">Preview</button>' : '') + '</td></tr>';
        }).join('')
        + '</tbody></table></div>'
        + (res.issuedIn.length
          ? '<h3 class="ob-mt-4">Issued to</h3><div class="ob-table-wrap"><table class="ob-table">'
            + '<thead><tr><th scope="col">Employee</th><th scope="col">Edition</th>'
            + '<th scope="col">Sent</th></tr></thead><tbody>'
            + res.issuedIn.map(function (r) {
              return '<tr><td>' + esc(r.employee) + '</td>'
                + '<td>' + esc(r.version ? 'Version ' + r.version : '—') + '</td>'
                + '<td>' + fmtDate(r.sentAt) + '</td></tr>';
            }).join('')
            + '</tbody></table></div>'
          : '<p class="ob-quiet ob-mt-4">Not yet included in any starter pack that was sent.</p>'),
      footer: '<button class="btn primary" onclick="Onboarding.closeModal()">Close</button>',
    });
  }

  /**
   * A labelled input. `field` is already taken by the employee form builders
   * further down, which take a different argument order.
   */
  function field2(label, name, type, value) {
    var id = 'ob-x-' + name;
    return '<div class="ob-field"><label for="' + id + '">' + esc(label) + '</label>'
      + '<input type="' + esc(type || 'text') + '" id="' + id + '" name="' + esc(name) + '"'
      + ' value="' + esc(value == null ? '' : value) + '"></div>';
  }

  /** Open one of the caller's own onboarding documents full screen. */
  function previewMineDocument(versionId, title, kind) {
    preview({
      kind: kind,
      url: '/api/onboarding/me/documents/version/' + encodeURIComponent(versionId) + '/download',
      title: title,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  WIRING
  // ═══════════════════════════════════════════════════════════════════════════

  // Delegated: the sub-nav is re-rendered constantly, so per-button handlers
  // would be rebound on every render.
  doc.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('#ob-subnav button[data-ob]');
    if (!btn) return;
    nav(btn.dataset.ob);
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    var input = e.target;
    if (input && input.id === 'ob-f-search') { e.preventDefault(); applyFilters(); }
  });

  // Radio cards highlight when chosen.
  doc.addEventListener('change', function (e) {
    if (!e.target || e.target.type !== 'radio') return;
    var group = doc.querySelectorAll('input[name="' + e.target.name + '"]');
    group.forEach(function (el) {
      var card = el.closest('.ob-radio');
      if (card) card.classList.toggle('is-selected', el.checked);
    });
  });

  var api_ = {
    open: open,
    nav: nav,
    closeModal: closeModal,
    applyFilters: applyFilters,
    // management
    assignDialog: assignDialog,
    previewAssign: previewAssign,
    submitAssign: submitAssign,
    releaseDialog: releaseDialog,
    confirmRelease: confirmRelease,
    openAssignment: openAssignment,
    backToActive: backToActive,
    reviewAction: reviewAction,
    verifyDialog: verifyDialog,
    submitVerify: submitVerify,
    correctionDialog: correctionDialog,
    submitCorrection: submitCorrection,
    notApplicableDialog: notApplicableDialog,
    submitNotApplicable: submitNotApplicable,
    waiveDialog: waiveDialog,
    submitWaive: submitWaive,
    activate: activate,
    confirmActivate: confirmActivate,
    resendInvite: resendInvite,
    showInviteLink: showInviteLink,
    showPersonal: showPersonal,
    showPayroll: showPayroll,
    payrollExportDialog: payrollExportDialog,
    submitPayrollExport: submitPayrollExport,
    showIdentity: showIdentity,
    exportArchive: exportArchive,
    openPackage: openPackage,
    backToPackages: backToPackages,
    recommendPackage: recommendPackage,
    // journey
    journeyAction: journeyAction,
    generatePack: generatePack,
    regeneratePack: regeneratePack,
    confirmRegenerate: confirmRegenerate,
    sendPackDialog: sendPackDialog,
    submitSendPack: submitSendPack,
    uploadReturnedDialog: uploadReturnedDialog,
    submitReturned: submitReturned,
    archiveReturned: archiveReturned,
    previewReturned: previewReturned,
    runExtraction: runExtraction,
    reviewDetails: reviewDetails,
    decideField: decideField,
    correctField: correctField,
    submitCorrectField: submitCorrectField,
    applyDetails: applyDetails,
    createAccountDialog: createAccountDialog,
    submitCreateAccount: submitCreateAccount,
    reissuePassword: reissuePassword,
    sendInviteDialog: sendInviteDialog,
    submitInvite: submitInvite,
    // package documents
    previewDocument: previewDocument,
    previewMineDocument: previewMineDocument,
    addPackageDocDialog: addPackageDocDialog,
    submitAddPackageDoc: submitAddPackageDoc,
    renamePackageDoc: renamePackageDoc,
    submitRenamePackageDoc: submitRenamePackageDoc,
    removePackageDoc: removePackageDoc,
    submitRemovePackageDoc: submitRemovePackageDoc,
    restorePackageDoc: restorePackageDoc,
    replacePackageDoc: replacePackageDoc,
    goToDocument: goToDocument,
    movePackageDoc: movePackageDoc,
    packageDocHistory: packageDocHistory,
    publishPackage: publishPackage,
    confirmPublish: confirmPublish,
    importDialog: importDialog,
    submitImport: submitImport,
    applyImport: applyImport,
    saveSettings: saveSettings,
    savePermissions: savePermissions,
    // employee
    openDocument: openDocument,
    submitAcknowledge: submitAcknowledge,
    openForm: openForm,
    submitForm: submitForm,
    openCredential: openCredential,
    submitCredential: submitCredential,
    openUpload: openUpload,
    submitUpload: submitUpload,
    openTraining: openTraining,
    submitTraining: submitTraining,
    openLiveSource: openLiveSource,
    submitLiveSource: submitLiveSource,
    submitMine: submitMine,
    // testing seam
    _state: S,
    _esc: esc,
  };

  global.Onboarding = api_;
})(typeof window !== 'undefined' ? window : this);
