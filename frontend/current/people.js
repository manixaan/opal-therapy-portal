'use strict';

/**
 * PEOPLE — Settings → Users & Roles, redesigned (22 Sep 2026).
 *
 * One row per person. Every account in the practice and every invite that
 * has not become an account yet, from GET /api/admin/people. Click a row and
 * a side panel holds everything the Owner does to finish setting that person
 * up: role, approval / suspension, which Splose practitioner they are (a
 * dropdown of names — never a typed id), Outlook status, the pending invite.
 *
 * Accounts are CREATED by onboarding (or an invite). This page is the
 * Owner's "finish setting them up" step, not a second way to create people.
 *
 * Globals on window (no modules): window.People. Reuses the shell's
 * showInviteModal / openSuspendModal / portalConfirm / showToast / escapeHtml.
 */
(function () {
  var ROLE_LABEL = { owner: 'Owner', admin: 'Admin', therapist: 'Therapist', read_only: 'Read only', pre_employee: 'Pre-employee' };
  var STATUS = {
    active:               { label: 'Active',            cls: 'ok' },
    invited:              { label: 'Invited',           cls: 'info' },
    pending_verification: { label: 'Pending email',     cls: 'warn' },
    pending_approval:     { label: 'Needs approval',    cls: 'warn' },
    suspended:            { label: 'Suspended',         cls: 'danger' },
    deactivated:          { label: 'Deactivated',       cls: 'muted' },
  };
  var ORDER = { pending_approval: 1, pending_verification: 2, invited: 3, active: 4, suspended: 5, deactivated: 6 };
  var CALENDAR_ROLES = { therapist: 1, owner: 1, admin: 1 };

  var state = {
    people: [],
    practitioners: null,   // null = not loaded, [] = loaded, false = unavailable
    selectedId: null,
    showInactive: false,
    query: '',
    loading: false,
  };

  var esc = function (s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); };
  var toast = function (msg, isError) { if (window.showToast) window.showToast(msg, !!isError); };
  var confirmIt = function (msg, opts) { return window.portalConfirm ? window.portalConfirm(msg, opts) : Promise.resolve(window.confirm(msg)); };
  var $ = function (id) { return document.getElementById(id); };
  var api = function (url, opts) {
    var o = Object.assign({ credentials: 'include' }, opts || {});
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    });
  };
  var when = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  function isInactive(p) { return p.accountStatus === 'suspended' || p.accountStatus === 'deactivated'; }
  function needsAttention(p) { return p.accountStatus === 'pending_approval' || p.accountStatus === 'pending_verification'; }
  function practitionerName(id) {
    if (!id) return null;
    var list = Array.isArray(state.practitioners) ? state.practitioners : [];
    var p = list.find(function (x) { return String(x.id) === String(id); });
    return p ? (p.fullName || String(p.id)) : ('Practitioner ' + id);
  }
  /** Who (other than `exceptId`) already wears this practitioner badge. */
  function claimedBy(practitionerId, exceptId) {
    var p = state.people.find(function (x) {
      return x.kind === 'user' && x.id !== exceptId && x.isActive && x.splosePractitionerId && String(x.splosePractitionerId) === String(practitionerId);
    });
    return p ? p.name : null;
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  function load() {
    var root = $('people-root');
    if (!root) return Promise.resolve();
    if (!window.APP_USER || window.APP_USER.role !== 'owner') {
      root.innerHTML = '<p class="ppl-quiet">Only the practice owner can manage people.</p>';
      return Promise.resolve();
    }
    state.loading = true;
    if (!state.people.length) root.innerHTML = '<p class="ppl-quiet">Loading…</p>';
    var peopleReq = api('/api/admin/people');
    var pracReq = state.practitioners === null || state.practitioners === false
      ? api('/api/splose/practitioners').then(function (r) { state.practitioners = r.ok && Array.isArray(r.data.data) ? r.data.data : false; })
      : Promise.resolve();
    return Promise.all([peopleReq, pracReq]).then(function (res) {
      state.loading = false;
      var r = res[0];
      if (!r.ok) { root.innerHTML = '<p class="ppl-quiet">Could not load people' + (r.status === 403 ? ' — owner only.' : '.') + '</p>'; return; }
      state.people = (r.data.people || []).slice().sort(function (a, b) {
        var d = (ORDER[a.accountStatus] || 9) - (ORDER[b.accountStatus] || 9);
        return d || String(a.name || '').localeCompare(String(b.name || ''));
      });
      render();
      if (state.selectedId) renderPanel();
    }).catch(function () {
      state.loading = false;
      root.innerHTML = '<p class="ppl-quiet">Could not load people.</p>';
    });
  }

  // ── List ───────────────────────────────────────────────────────────────────
  function visible() {
    var q = state.query.trim().toLowerCase();
    return state.people.filter(function (p) {
      if (!state.showInactive && isInactive(p)) return false;
      if (!q) return true;
      return (String(p.name || '') + ' ' + String(p.email || '')).toLowerCase().indexOf(q) !== -1;
    });
  }

  function pill(status) {
    var s = STATUS[status] || { label: status, cls: 'muted' };
    return '<span class="ppl-pill ppl-pill-' + s.cls + '">' + esc(s.label) + '</span>';
  }

  function sploseCell(p) {
    if (p.kind !== 'user' || !CALENDAR_ROLES[p.role]) return '<span class="ppl-quiet">—</span>';
    if (p.splosePractitionerId) return '<span class="ppl-ok">' + esc(practitionerName(p.splosePractitionerId)) + '</span>';
    return '<span class="ppl-todo">Not linked</span>';
  }
  function outlookCell(p) {
    if (p.kind !== 'user' || !CALENDAR_ROLES[p.role]) return '<span class="ppl-quiet">—</span>';
    return p.outlook.connected ? '<span class="ppl-ok">Connected</span>' : '<span class="ppl-todo">Not connected</span>';
  }

  function render() {
    var root = $('people-root');
    if (!root) return;
    var rows = visible();
    var attention = state.people.filter(needsAttention).length;
    var hidden = state.people.filter(isInactive).length;

    var html = '';
    html += '<div class="ppl-toolbar">';
    html += '<label class="ppl-search"><span class="ppl-search-icon" aria-hidden="true">⌕</span><input id="ppl-search" type="search" placeholder="Search by name or email" value="' + esc(state.query) + '" aria-label="Search people"></label>';
    html += '<label class="ppl-toggle"><input id="ppl-show-inactive" type="checkbox"' + (state.showInactive ? ' checked' : '') + '> Show inactive' + (hidden ? ' (' + hidden + ')' : '') + '</label>';
    html += '<span class="ppl-spacer"></span>';
    html += '<button class="btn" id="ppl-refresh" type="button">⟳ Refresh</button>';
    html += '<button class="btn primary" id="ppl-invite" type="button" data-help="settings-invite-user">+ Invite</button>';
    html += '</div>';

    if (attention) {
      html += '<div class="ppl-attention" role="status">' + attention + (attention === 1 ? ' account needs' : ' accounts need') + ' your approval — they are at the top of the list.</div>';
    }

    if (!rows.length) {
      html += '<p class="ppl-quiet" style="padding:18px 4px;">' + (state.people.length ? 'No one matches.' : 'No people yet. New accounts arrive from onboarding, or invite someone.') + '</p>';
    } else {
      html += '<div class="ppl-table-wrap"><table class="ppl-table" role="grid"><thead><tr>' +
        '<th>Person</th><th>Role</th><th>Status</th><th>Splose practitioner</th><th>Outlook</th><th aria-label="Open"></th></tr></thead><tbody>';
      rows.forEach(function (p) {
        var sel = p.id === state.selectedId ? ' is-selected' : '';
        html += '<tr class="ppl-row' + sel + '" data-id="' + esc(p.id) + '" tabindex="0" role="row">' +
          '<td><div class="ppl-name">' + esc(p.name) + (p.isMe ? ' <span class="ppl-you">You</span>' : '') + '</div><div class="ppl-quiet">' + esc(p.email) + '</div></td>' +
          '<td>' + esc(ROLE_LABEL[p.role] || p.role) + '</td>' +
          '<td>' + pill(p.accountStatus) + '</td>' +
          '<td>' + sploseCell(p) + '</td>' +
          '<td>' + outlookCell(p) + '</td>' +
          '<td class="ppl-chev" aria-hidden="true">›</td>' +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<p class="ppl-quiet ppl-foot">' + state.people.length + (state.people.length === 1 ? ' person' : ' people') + ' · accounts are created by onboarding or an invite; this is where you finish setting them up.</p>';
    root.innerHTML = html;

    var search = $('ppl-search');
    if (search) search.addEventListener('input', function () { state.query = search.value; renderKeepingSearch(); });
    var toggle = $('ppl-show-inactive');
    if (toggle) toggle.addEventListener('change', function () { state.showInactive = toggle.checked; render(); });
    var refresh = $('ppl-refresh');
    if (refresh) refresh.addEventListener('click', function () { load(); });
    var invite = $('ppl-invite');
    if (invite) invite.addEventListener('click', function () { if (window.showInviteModal) window.showInviteModal(); });
    root.querySelectorAll('.ppl-row').forEach(function (tr) {
      tr.addEventListener('click', function () { open(tr.getAttribute('data-id')); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(tr.getAttribute('data-id')); } });
    });
  }
  // Re-render the rows only, so typing in the search box keeps focus.
  function renderKeepingSearch() {
    var search = $('ppl-search');
    var pos = search ? search.selectionStart : null;
    render();
    var again = $('ppl-search');
    if (again) { again.focus(); if (pos != null) { try { again.setSelectionRange(pos, pos); } catch (_) {} } }
  }

  // ── Panel ──────────────────────────────────────────────────────────────────
  function ensurePanel() {
    var panel = $('people-panel');
    if (panel) return panel;
    var wrap = document.createElement('div');
    wrap.id = 'people-panel-wrap';
    wrap.innerHTML = '<div id="people-panel-backdrop" class="ppl-backdrop"></div>' +
      '<aside id="people-panel" class="ppl-panel" role="dialog" aria-modal="true" aria-labelledby="ppl-panel-title" hidden></aside>';
    document.body.appendChild(wrap);
    $('people-panel-backdrop').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && state.selectedId) close(); });
    return $('people-panel');
  }

  function open(id) {
    state.selectedId = id;
    ensurePanel();
    renderPanel();
    render();
  }
  function close() {
    state.selectedId = null;
    var panel = $('people-panel');
    if (panel) { panel.hidden = true; panel.innerHTML = ''; }
    var bd = $('people-panel-backdrop');
    if (bd) bd.classList.remove('is-open');
    render();
  }

  function renderPanel() {
    var panel = ensurePanel();
    var p = state.people.find(function (x) { return x.id === state.selectedId; });
    if (!p) { close(); return; }
    var bd = $('people-panel-backdrop');
    if (bd) bd.classList.add('is-open');
    panel.hidden = false;

    var html = '';
    html += '<header class="ppl-panel-head">' +
      '<div><h3 id="ppl-panel-title">' + esc(p.name) + '</h3><div class="ppl-quiet">' + esc(p.email) + '</div></div>' +
      '<div class="ppl-panel-head-right">' + pill(p.accountStatus) + '<button class="ppl-close" id="ppl-close" type="button" aria-label="Close">×</button></div>' +
      '</header>';
    html += '<div class="ppl-panel-body">';

    if (p.kind === 'invite') {
      html += section('Invitation', inviteBlock(p, true));
      html += section('Role when they join', '<p>' + esc(ROLE_LABEL[p.role] || p.role) + '</p><p class="ppl-quiet">Set on the invite. Change it after they have created their account.</p>');
    } else {
      html += section('Account', accountBlock(p));
      if (CALENDAR_ROLES[p.role]) {
        html += section('Splose practitioner', sploseBlock(p));
        html += section('Outlook calendar', outlookBlock(p));
      } else if (p.role === 'pre_employee') {
        html += section('Splose practitioner', '<p class="ppl-quiet">Available once their role is set to Therapist, Admin or Owner.</p>');
      }
      if (p.invite) html += section('Invitation', inviteBlock(p, false));
      html += section('More', moreBlock(p));
    }
    html += '</div>';
    panel.innerHTML = html;

    $('ppl-close').addEventListener('click', close);
    panel.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function () { act(btn.getAttribute('data-act'), p, btn); });
    });
    var roleSel = $('ppl-role');
    if (roleSel) roleSel.addEventListener('change', function () { var b = $('ppl-role-save'); if (b) b.disabled = roleSel.value === p.role; });
    var pracSel = $('ppl-prac');
    if (pracSel) pracSel.addEventListener('change', function () { var b = $('ppl-prac-save'); if (b) b.disabled = !pracSel.value || pracSel.value === String(p.splosePractitionerId || ''); });
    var first = panel.querySelector('button, select, input');
    if (first) first.focus();
  }

  function section(title, body) {
    return '<section class="ppl-section"><h4>' + esc(title) + '</h4>' + body + '</section>';
  }

  function accountBlock(p) {
    var html = '';
    if (p.isMe) return '<p class="ppl-quiet">This is your own account. Your role and status are changed by another owner.</p>';
    var roles = ['owner', 'admin', 'therapist', 'read_only'];
    html += '<label class="ppl-field"><span>Role</span><div class="ppl-inline"><select id="ppl-role">';
    if (p.role === 'pre_employee') html += '<option value="pre_employee" selected>Pre-employee (onboarding in progress)</option>';
    roles.forEach(function (r) { html += '<option value="' + r + '"' + (r === p.role ? ' selected' : '') + '>' + esc(ROLE_LABEL[r]) + '</option>'; });
    html += '</select><button class="btn primary" id="ppl-role-save" data-act="role" type="button" disabled>Save</button></div></label>';
    if (p.role === 'pre_employee') html += '<p class="ppl-quiet">Created by onboarding. Activating their onboarding assignment sets the role for you; choose one here only if you want to skip that.</p>';

    var acts = [];
    var s = p.accountStatus;
    if (needsAttention(p)) acts.push('<button class="btn primary" data-act="approve" type="button">Approve account</button>');
    if (s === 'active') { acts.push('<button class="btn ppl-danger" data-act="suspend" type="button">Suspend</button>'); acts.push('<button class="btn" data-act="deactivate" type="button">Deactivate</button>'); }
    if (s === 'suspended') { acts.push('<button class="btn primary" data-act="activate" type="button">Re-activate</button>'); acts.push('<button class="btn" data-act="deactivate" type="button">Deactivate</button>'); }
    if (s === 'deactivated') acts.push('<button class="btn primary" data-act="activate" type="button">Restore</button>');
    if (acts.length) html += '<div class="ppl-actions">' + acts.join('') + '</div>';
    var meta = [];
    if (p.lastLoginAt) meta.push('Last signed in ' + when(p.lastLoginAt)); else meta.push('Never signed in');
    if (p.createdAt) meta.push('added ' + when(p.createdAt));
    html += '<p class="ppl-quiet">' + esc(meta.join(' · ')) + '</p>';
    return html;
  }

  function sploseBlock(p) {
    var html = '';
    var current = p.splosePractitionerId ? practitionerName(p.splosePractitionerId) : null;
    if (state.practitioners === false) {
      html += '<p class="ppl-todo">Splose is not connected, so the practitioner list is unavailable.</p>';
      if (current) html += '<p>Currently linked: <strong>' + esc(current) + '</strong></p><div class="ppl-actions"><button class="btn" data-act="unlink" type="button">Disconnect</button></div>';
      return html;
    }
    var list = (state.practitioners || []).slice().sort(function (a, b) { return String(a.fullName || '').localeCompare(String(b.fullName || '')); });
    html += '<p class="ppl-quiet">Which calendar in Splose is theirs. Names already linked to someone else are greyed out.</p>';
    html += '<label class="ppl-field"><span>Practitioner</span><div class="ppl-inline"><select id="ppl-prac">';
    html += '<option value="">' + (current ? '— choose a different practitioner —' : '— not linked —') + '</option>';
    list.forEach(function (x) {
      var id = String(x.id);
      var taken = claimedBy(id, p.id);
      var isCurrent = id === String(p.splosePractitionerId || '');
      var label = (x.fullName || id) + (x.email ? ' · ' + x.email : '') + (taken ? ' — linked to ' + taken : '');
      html += '<option value="' + esc(id) + '"' + (isCurrent ? ' selected' : '') + (taken ? ' disabled' : '') + '>' + esc(label) + '</option>';
    });
    html += '</select><button class="btn primary" id="ppl-prac-save" data-act="link" type="button" disabled>Link</button></div></label>';
    if (current) html += '<div class="ppl-actions"><span class="ppl-ok">Linked to ' + esc(current) + '</span><button class="btn" data-act="unlink" type="button">Disconnect</button></div>';
    else if (!list.length) html += '<p class="ppl-quiet">No practitioners in Splose yet.</p>';
    return html;
  }

  function outlookBlock(p) {
    if (p.outlook.connected) {
      return '<p><span class="ppl-ok">Connected</span> as ' + esc(p.outlook.email || '') + (p.outlook.lastSyncedAt ? ' · last synced ' + esc(when(p.outlook.lastSyncedAt)) : '') + '</p>' +
        '<p class="ppl-quiet">Only they can disconnect it, from their own Settings → Integrations.</p>';
    }
    return '<p><span class="ppl-todo">Not connected</span></p><p class="ppl-quiet">They connect their own mailbox from Settings → Integrations after signing in.</p>';
  }

  function inviteBlock(p, standalone) {
    var inv = p.invite;
    var html = '<p>' + (inv.expired ? '<span class="ppl-todo">Expired</span> on ' : 'Expires ') + esc(when(inv.expiresAt)) + (inv.invitedAt ? ' · sent ' + esc(when(inv.invitedAt)) : '') + '</p>';
    if (standalone) html += '<p class="ppl-quiet">They have not created their account yet. Resend, or copy the link and send it yourself.</p>';
    html += '<div class="ppl-actions">' +
      (inv.expired ? '' : '<button class="btn" data-act="copy-link" type="button">Copy link</button>') +
      '<button class="btn" data-act="resend" type="button">Resend</button>' +
      '<button class="btn ppl-danger" data-act="revoke" type="button">Revoke</button></div>';
    return html;
  }

  function moreBlock(p) {
    var html = '<div class="ppl-actions">';
    html += '<button class="btn" data-act="employee" type="button">Open employee record</button>';
    html += '</div><p class="ppl-quiet">Personal details, payroll and documents live in the Employees register.</p>';
    return html;
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  function busy(btn, on, label) { if (!btn) return; btn.disabled = !!on; if (label) btn.textContent = label; }

  function act(kind, p, btn) {
    var name = p.name || p.email;
    var done = function (msg) { if (msg) toast(msg); return load(); };
    var fail = function (r, fallback) { toast((r && r.data && r.data.error) || fallback, true); };
    var original = btn ? btn.textContent : '';

    switch (kind) {
      case 'role': {
        var sel = $('ppl-role'); var role = sel ? sel.value : null;
        if (!role || role === p.role || role === 'pre_employee') return;
        busy(btn, true, 'Saving…');
        return api('/api/admin/users/' + p.id + '/role', { method: 'PATCH', body: { role: role } })
          .then(function (r) { if (r.ok) return done(name + ' is now ' + (ROLE_LABEL[role] || role)); fail(r, 'Could not change role'); busy(btn, false, original); });
      }
      case 'approve':
        return confirmIt('Approve the account for ' + name + '? They can sign in straight away.').then(function (yes) {
          if (!yes) return;
          busy(btn, true, 'Approving…');
          return api('/api/admin/users/' + p.id + '/approve', { method: 'PATCH' })
            .then(function (r) { if (r.ok) return done(name + '\'s account approved'); fail(r, 'Could not approve'); busy(btn, false, original); });
        });
      case 'activate':
        return confirmIt('Re-activate the account for ' + name + '?').then(function (yes) {
          if (!yes) return;
          busy(btn, true, 'Working…');
          return api('/api/admin/users/' + p.id + '/activate', { method: 'PATCH' })
            .then(function (r) { if (r.ok) return done(name + '\'s account re-activated'); fail(r, 'Could not re-activate'); busy(btn, false, original); });
        });
      case 'suspend':
        if (window.openSuspendModal) { window.openSuspendModal(p.id, name); return; }
        return;
      case 'deactivate':
        return confirmIt('Deactivate ' + name + '? They cannot sign in, their data is kept, and you can restore them later.', { danger: true }).then(function (yes) {
          if (!yes) return;
          busy(btn, true, 'Working…');
          return api('/api/admin/users/' + p.id + '/deactivate', { method: 'PATCH' })
            .then(function (r) { if (r.ok) return done('Account deactivated'); fail(r, 'Could not deactivate'); busy(btn, false, original); });
        });
      case 'link': {
        var ps = $('ppl-prac'); var pid = ps ? ps.value : '';
        if (!pid) return;
        busy(btn, true, 'Linking…');
        return api('/api/admin/people/' + p.id + '/splose-link', { method: 'PUT', body: { practitionerId: pid } })
          .then(function (r) { if (r.ok) return done('Linked to ' + (r.data.linked && r.data.linked.fullName || 'practitioner')); fail(r, 'Could not link'); busy(btn, false, original); });
      }
      case 'unlink':
        return confirmIt('Disconnect ' + name + ' from ' + (practitionerName(p.splosePractitionerId) || 'their Splose practitioner') + '? Their Splose appointments stop showing until they are linked again.', { danger: true }).then(function (yes) {
          if (!yes) return;
          busy(btn, true, 'Working…');
          return api('/api/admin/people/' + p.id + '/splose-link', { method: 'DELETE' })
            .then(function (r) { if (r.ok) return done('Splose practitioner disconnected'); fail(r, 'Could not disconnect'); busy(btn, false, original); });
        });
      case 'copy-link':
        busy(btn, true, '…');
        return api('/api/invites/' + p.invite.id + '/link').then(function (r) {
          if (!r.ok || !r.data.registerUrl) { fail(r, 'Could not fetch invite link'); busy(btn, false, original); return; }
          return navigator.clipboard.writeText(r.data.registerUrl).then(function () {
            busy(btn, false, '✓ Copied'); setTimeout(function () { busy(btn, false, original); }, 2000);
          }).catch(function () { busy(btn, false, original); window.prompt('Copy this link', r.data.registerUrl); });
        });
      case 'resend':
        busy(btn, true, 'Sending…');
        return api('/api/invites/' + p.invite.id + '/resend', { method: 'POST' }).then(function (r) {
          if (r.ok) { busy(btn, false, '✓ Sent'); setTimeout(function () { busy(btn, false, original); }, 2500); return; }
          fail(r, 'Could not resend invite'); busy(btn, false, original);
        });
      case 'revoke':
        return confirmIt('Revoke the invite for ' + name + '? The link stops working.', { danger: true }).then(function (yes) {
          if (!yes) return;
          busy(btn, true, 'Revoking…');
          return api('/api/invites/' + p.invite.id, { method: 'DELETE' }).then(function (r) {
            if (r.ok) { if (p.kind === 'invite') state.selectedId = null; return done('Invite revoked'); }
            fail(r, 'Could not revoke'); busy(btn, false, original);
          });
        });
      case 'employee':
        close();
        if (window.Employees && typeof window.Employees.openRecord === 'function') {
          if (window.switchTab) window.switchTab('employees');
          window.Employees.openRecord(p.id);
        } else {
          window.location.hash = '#employees/record/' + encodeURIComponent(p.id);
        }
        return;
      default:
        return;
    }
  }

  window.People = { load: load, open: open, close: close, _state: state };

  // The shell's older entry points still call these after an invite or a
  // suspension; keep them as thin aliases so nothing goes stale.
  window.loadUserListForOwner = function () { return load(); };
  window.loadPendingInvites = function () { return load(); };
})();
