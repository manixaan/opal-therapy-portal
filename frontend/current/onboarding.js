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
        + 'Assign onboarding</button>';
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

  function assignmentTable(rows) {
    return '<div class="ob-table-wrap"><table class="ob-table">'
      + '<thead><tr>'
      + '<th scope="col">Employee</th><th scope="col">Role</th><th scope="col">Package</th>'
      + '<th scope="col">Start</th><th scope="col">Their actions</th>'
      + '<th scope="col">Employer review</th><th scope="col">Status</th>'
      + '<th scope="col">Due</th>'
      + '</tr></thead><tbody>'
      + rows.map(function (a) {
        var p = a.progress || {};
        return '<tr class="ob-row-click" tabindex="0" role="link"'
          + ' onclick="Onboarding.openAssignment(\'' + jsq(a.id) + '\')"'
          + ' onkeydown="if(event.key===\'Enter\'){Onboarding.openAssignment(\'' + jsq(a.id) + '\')}">'
          + '<td><span class="ob-strong">' + esc(a.applicantName) + '</span></td>'
          + '<td>' + esc(a.jobTitle || '—') + '<br><span class="ob-quiet">'
          + esc(titleCase(a.employmentType)) + '</span></td>'
          + '<td>' + esc(a.packageTitle) + ' <span class="ob-quiet">v' + esc(a.packageVersion) + '</span></td>'
          + '<td>' + fmtDate(a.startDate) + '</td>'
          + '<td class="ob-num">' + (p.employeeDone || 0) + ' / ' + (p.employeeTotal || 0) + '</td>'
          + '<td class="ob-num">' + (p.employerDone || 0) + ' / ' + (p.employerTotal || 0) + '</td>'
          + '<td>' + chip(a.status) + '</td>'
          + '<td>' + fmtDate(a.dueAt) + (a.overdue ? ' <span class="ob-chip expired">Overdue</span>' : '') + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table></div>';
  }

  async function viewActive(pane, actions) {
    if (actions && can('onboarding.assign')) {
      actions.innerHTML = '<button class="btn primary" onclick="Onboarding.assignDialog()">'
        + 'Assign onboarding</button>';
    }
    var qs = [];
    if (S.filters.status) qs.push('status=' + encodeURIComponent(S.filters.status));
    if (S.filters.search) qs.push('search=' + encodeURIComponent(S.filters.search));
    var res = await api('/api/onboarding/assignments' + (qs.length ? '?' + qs.join('&') : ''));
    S.assignments = res;
    if (!res.ok) { pane.innerHTML = '<div class="ob-note is-danger">' + esc(res.error) + '</div>'; return; }

    var STATUSES = ['created', 'invite_sent', 'invite_accepted', 'in_progress',
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
          + esc(titleCase(s)) + '</option>';
      }).join('')
      + '      </select>'
      + '      <button class="btn ob-btn-sm" onclick="Onboarding.applyFilters()">Apply</button>'
      + '    </div>'
      + '  </div>'
      + '  <div class="ob-section-body is-flush">'
      + ((res.assignments || []).length
        ? assignmentTable(res.assignments)
        : empty('No onboarding runs yet',
          'Assign a package to a new starter to begin.'))
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
      if (can('onboarding.audit')) {
        buttons += ' <button class="btn" onclick="Onboarding.exportArchive()">Export record</button>';
      }
      if (can('onboarding.activate') && res.canActivate) {
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

    var blockers = act.ok
      ? '<div class="ob-note is-ok"><strong>Ready to activate.</strong> '
        + 'Every requirement that blocks activation is satisfied.</div>'
      : '<div class="ob-note is-warn"><strong>' + act.blockers.length
        + ' requirement' + (act.blockers.length === 1 ? '' : 's') + ' still blocking activation.</strong>'
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
      + '        · ' + esc(a.packageTitle) + ' v' + esc(a.packageVersion) + '</p></div>'
      + '    ' + chip(a.status)
      + '  </div>'
      + '  <div class="ob-section-body">'
      + '    <div class="ob-meters ob-mb-4">'
      + meter('Employee actions', p.employeeDone || 0, p.employeeTotal || 0, {
        note: 'What the new starter must do themselves.',
      })
      + meter('Employer verification', p.employerDone || 0, p.employerTotal || 0, {
        employer: true, note: 'Checks the practice must complete. Counted separately.',
      })
      + '    </div>'
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
      + (res.sections || []).map(renderReviewSection).join('');
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
    if (r.blocksActivation) meta.push('Blocks activation');
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
      + (r.blocksActivation ? ' <span class="ob-chip is-blocking">Blocking</span>' : '')
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
      title: 'Assign onboarding',
      subtitle: 'Nothing is sent until you release it on the next step.',
      wide: true,
      body: ''
        + '<div class="ob-form">'
        + '  <div class="ob-form-row is-single"><div class="ob-field">'
        + '    <label for="ob-a-package">Package<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '    <select id="ob-a-package" name="packageId" required>'
        + assignable.map(function (p) {
          return '<option value="' + esc(p.id) + '" data-type="' + esc(p.employmentType || '')
            + '" data-role="' + esc(p.roleCategory || '') + '">' + esc(p.title) + '</option>';
        }).join('')
        + '    </select>'
        + '  </div></div>'
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><label for="ob-a-name">Full name<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <input type="text" id="ob-a-name" name="applicantName" required maxlength="200"></div>'
        + '    <div class="ob-field"><label for="ob-a-email">Email<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <input type="email" id="ob-a-email" name="applicantEmail" required maxlength="255"'
        + '             aria-describedby="ob-a-email-hint">'
        + '      <p class="ob-hint" id="ob-a-email-hint">The invitation goes here and becomes their sign-in.</p></div>'
        + '  </div>'
        + '  <div class="ob-form-row">'
        + '    <div class="ob-field"><label for="ob-a-title">Job title</label>'
        + '      <input type="text" id="ob-a-title" name="jobTitle" maxlength="150"></div>'
        + '    <div class="ob-field"><label for="ob-a-start">Start date</label>'
        + '      <input type="date" id="ob-a-start" name="startDate"></div>'
        + '  </div>'
        + '  <div class="ob-form-row is-thirds">'
        + '    <div class="ob-field"><label for="ob-a-emptype">Employment type<span class="ob-req-mark" aria-hidden="true">*</span></label>'
        + '      <select id="ob-a-emptype" name="employmentType" required>'
        + '        <option value="full_time">Full-time</option>'
        + '        <option value="part_time">Part-time</option>'
        + '        <option value="casual">Casual</option>'
        + '        <option value="fixed_term">Fixed-term</option>'
        + '      </select></div>'
        + '    <div class="ob-field"><label for="ob-a-rolecat">Role category</label>'
        + '      <select id="ob-a-rolecat" name="roleCategory">'
        + '        <option value="occupational_therapist">Occupational therapist</option>'
        + '        <option value="administration">Administration</option>'
        + '      </select></div>'
        + '    <div class="ob-field"><label for="ob-a-role">Portal role on activation</label>'
        + '      <select id="ob-a-role" name="proposedRole">'
        + '        <option value="therapist">Therapist</option>'
        + '        <option value="admin">Administrator</option>'
        + '        <option value="read_only">Read-only</option>'
        + '      </select></div>'
        + '  </div>'
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
        + '<button class="btn primary" onclick="Onboarding.submitAssign()">Create</button>',
    });
  }

  function assignPayload() {
    var v = modalValues();
    return {
      packageId: v.packageId,
      applicantName: (v.applicantName || '').trim(),
      applicantEmail: (v.applicantEmail || '').trim(),
      jobTitle: v.jobTitle || undefined,
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
      subtitle: res.appliedCount + ' requirements · ' + res.blockingCount + ' block activation',
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
              + (r.blocksActivation ? '<span class="ob-chip is-blocking">Blocking</span>' : '')
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
    toast('Onboarding created — review it, then release');
    S.view = 'active';
    S.assignmentDetail = { id: res.assignment.id };
    await renderManage(root());
    releaseDialog(res.assignment.id, res.preview);
  }

  function releaseDialog(id, preview) {
    openModal({
      title: 'Release this onboarding?',
      subtitle: 'This creates their account and emails a secure link.',
      body: '<div class="ob-note is-info">'
        + (preview ? '<strong>' + preview.willIssue + ' requirements</strong> will be issued, '
          + '<strong>' + preview.blocking + '</strong> of which block activation.' : '')
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

    var groups = [
      ['Assignable packages', 'package'],
      ['Base', 'base'],
      ['Overlays', 'overlay'],
    ];

    pane.innerHTML = '<div class="ob-note is-info">Packages are <strong>composed</strong>, not copied. '
      + 'A package inherits a base plus the overlays that apply, so adding a requirement to every new '
      + 'starter is one edit rather than six that can drift apart.</div>'
      + groups.map(function (g) {
        var rows = (res.packages || []).filter(function (p) { return p.kind === g[1]; });
        if (!rows.length) return '';
        return '<div class="ob-section-card">'
          + '<div class="ob-section-head"><h2>' + esc(g[0]) + '</h2></div>'
          + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Package</th><th scope="col">Applies to</th>'
          + '<th scope="col">Version</th><th scope="col">Status</th>'
          + '<th scope="col">In use</th></tr></thead><tbody>'
          + rows.map(function (p) {
            return '<tr class="ob-row-click" tabindex="0" role="link"'
              + ' onclick="Onboarding.openPackage(\'' + jsq(p.id) + '\')"'
              + ' onkeydown="if(event.key===\'Enter\'){Onboarding.openPackage(\'' + jsq(p.id) + '\')}">'
              + '<td><span class="ob-strong">' + esc(p.title) + '</span><br>'
              + '<span class="ob-quiet">' + esc(p.code) + '</span></td>'
              + '<td>' + esc([titleCase(p.roleCategory), titleCase(p.employmentType)]
                .filter(Boolean).join(' · ') || 'Any') + '</td>'
              + '<td>' + (p.currentVersion ? 'v' + p.currentVersion : '—')
              + (p.draftDirty && p.currentVersion
                ? ' <span class="ob-chip in_progress">Unpublished changes</span>' : '') + '</td>'
              + '<td>' + chip(p.status) + '</td>'
              + '<td class="ob-num">' + (p.assignmentCount || 0) + '</td>'
              + '</tr>';
          }).join('')
          + '</tbody></table></div></div></div>';
      }).join('');
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
        b += ' <button class="btn primary" onclick="Onboarding.publishPackage(\'' + jsq(p.id) + '\')">'
          + (p.currentVersion ? 'Publish v' + (p.currentVersion + 1) : 'Publish v1') + '</button>';
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
      + '  <p class="ob-quiet" style="margin:4px 0 0;">' + esc(p.code)
      + (p.currentVersion ? ' · published v' + p.currentVersion : ' · never published') + '</p></div>'
      + chip(p.status)
      + '</div><div class="ob-section-body">'
      + (p.description ? '<p class="ob-mb-3">' + esc(p.description) + '</p>' : '')
      + '<p class="ob-quiet">Composed from: ' + esc((res.chain || []).join(' → ')) + '</p>'
      + (res.warnings && res.warnings.length
        ? '<div class="ob-note is-warn ob-mt-3">' + res.warnings.map(esc).join('<br>') + '</div>' : '')
      + (p.draftDirty && p.currentVersion
        ? '<div class="ob-note is-warn ob-mt-3"><strong>Unpublished changes.</strong> '
          + 'Anyone already onboarding stays on v' + p.currentVersion
          + '; publishing affects new assignments only.</div>' : '')
      + '</div></div>'
      + '<div class="ob-section-card"><div class="ob-section-head"><h2>Requirements</h2>'
      + '<span class="ob-quiet">' + (res.resolvedRequirements || []).length + ' resolved</span></div>'
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
                ? '<span class="ob-inherited">' + esc(r.inheritedFrom.replace('PKG_', '')) + '</span>' : '')
              + (r.blocksActivation ? '<span class="ob-chip is-blocking">Blocking</span>' : '')
              + '</div>';
          }).join('')
          + '</div>';
      }).join('')
      + '</div></div>'
      + (res.versions && res.versions.length
        ? '<div class="ob-section-card"><div class="ob-section-head"><h2>Version history</h2></div>'
          + '<div class="ob-section-body is-flush"><div class="ob-table-wrap"><table class="ob-table">'
          + '<thead><tr><th scope="col">Version</th><th scope="col">Requirements</th>'
          + '<th scope="col">Published</th><th scope="col">Note</th><th scope="col">Status</th></tr></thead><tbody>'
          + res.versions.map(function (v) {
            return '<tr><td>v' + esc(v.version) + '</td><td class="ob-num">' + esc(v.requirement_count) + '</td>'
              + '<td>' + fmtDate(v.published_at) + '</td><td>' + esc(v.change_note || '—') + '</td>'
              + '<td>' + chip(v.status) + '</td></tr>';
          }).join('')
          + '</tbody></table></div></div></div>'
        : '');
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
          body += '<iframe class="ob-doc-frame" title="' + esc(d.document.title) + '" src="'
            + '/api/onboarding/me/documents/version/' + encodeURIComponent(req.documentVersionId)
            + '/download"></iframe>';
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
