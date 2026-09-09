/**
 * EMPLOYEES — the practice's people register and one page per person.
 *
 *   #employees                  the register: everyone, searchable, grouped
 *                               into therapists, admin and people still
 *                               being onboarded
 *   #employees/record/<userId>  one employee's profile — everything the
 *                               onboarding journey gathered about them
 *
 * Renders into #emp-root inside #view-employees. Reads only; nothing here
 * edits a person. The server decides what each reader may see: sections a
 * caller is not permitted to view are simply absent from the payload
 * (/api/onboarding/employees/:userId attaches personal details, payroll and
 * identity only for the matching permission), so this module renders what
 * arrives and never infers a section from the role string in the browser.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var S = { view: 'list', group: 'all', search: '', employees: null, record: null, loading: false };

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function root() { return doc.getElementById('emp-root'); }
  function titleCase(s) { return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function fmtDate(d) {
    if (!d) return '';
    var x = new Date(d); if (isNaN(x)) return String(d);
    return x.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(d) {
    if (!d) return '';
    var x = new Date(d); if (isNaN(x)) return String(d);
    return x.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  function money(n) { if (n == null || n === '') return ''; var v = Number(n); return isNaN(v) ? String(n) : '$' + v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function toast(msg, isError) {
    if (typeof global.showToast === 'function') global.showToast(isError ? 'Employees' : 'Employees', msg, isError ? 'warn' : 'info');
  }
  async function api(path) {
    try {
      var res = await fetch(path, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
      var body = null; try { body = await res.json(); } catch (_) { body = null; }
      if (!res.ok) return { ok: false, status: res.status, error: (body && body.error) || ('Request failed (' + res.status + ')') };
      return body || { ok: true };
    } catch (err) { return { ok: false, status: 0, error: 'Network error — please try again.' }; }
  }

  /**
   * Which register a person belongs to. Therapists are anyone treating
   * clients; admin is the owner, admins and anyone whose employment record
   * says so. People still being onboarded keep their intended group AND
   * appear under Onboarding, so the register never hides a starter.
   */
  function groupOf(e) {
    var cat = String(e.roleCategory || '').toLowerCase();
    if (e.isTreatingTherapist || e.role === 'therapist' || cat === 'therapist' || /therap/i.test(e.jobTitle || '')) return 'therapist';
    if (e.role === 'admin' || e.role === 'owner' || cat === 'admin' || cat === 'administration') return 'admin';
    return 'other';
  }
  function isOnboarding(e) { return e.role === 'pre_employee' || (e.onboardingStatus && ['completed', 'activated', 'cancelled', 'archived'].indexOf(e.onboardingStatus) === -1 && !e.isActive); }

  var GROUPS = [['all', 'All'], ['therapist', 'Therapists'], ['admin', 'Admin'], ['onboarding', 'Onboarding']];

  // ── The register ──────────────────────────────────────────────────────────
  function visible() {
    var list = S.employees || [];
    var q = S.search.trim().toLowerCase();
    return list.filter(function (e) {
      if (S.group === 'onboarding') { if (!isOnboarding(e)) return false; }
      else if (S.group !== 'all' && groupOf(e) !== S.group) return false;
      if (!q) return true;
      return [e.name, e.email, e.jobTitle, e.roleTitle].some(function (v) { return v && String(v).toLowerCase().indexOf(q) !== -1; });
    });
  }

  function statusChip(e) {
    if (e.role === 'pre_employee') return '<span class="emp-chip is-onboarding">Onboarding' + (e.onboardingStatus ? ' · ' + esc(titleCase(e.onboardingStatus)) : '') + '</span>';
    if (e.isActive === false) return '<span class="emp-chip is-inactive">Inactive</span>';
    if (e.employmentStatus && e.employmentStatus !== 'active') return '<span class="emp-chip is-quiet">' + esc(titleCase(e.employmentStatus)) + '</span>';
    return '<span class="emp-chip is-active">Active</span>';
  }
  function flags(e) {
    var out = [];
    if (e.expiredCredentials) out.push('<span class="emp-flag is-danger" title="Expired credentials">' + e.expiredCredentials + ' expired</span>');
    if (e.unverifiedCredentials) out.push('<span class="emp-flag" title="Credentials awaiting verification">' + e.unverifiedCredentials + ' to verify</span>');
    return out.join(' ');
  }

  function renderList(host) {
    var counts = { all: 0, therapist: 0, admin: 0, onboarding: 0 };
    (S.employees || []).forEach(function (e) { counts.all += 1; var g = groupOf(e); if (counts[g] != null) counts[g] += 1; if (isOnboarding(e)) counts.onboarding += 1; });
    var rows = visible();
    var html = ''
      + '<div class="ob-root emp-root">'
      + '<div class="ob-hero"><div><h1>Employees</h1>'
      + '<p>Everyone who works at the practice, and everything onboarding gathered about them. Open a person for their profile.</p></div></div>'
      + '<div class="ob-subnav emp-subnav" role="tablist">' + GROUPS.map(function (g) {
        return '<button type="button" role="tab" class="' + (S.group === g[0] ? 'active' : '') + '" aria-selected="' + (S.group === g[0]) + '" onclick="Employees.group(\'' + g[0] + '\')">' + esc(g[1]) + ' <span class="emp-count">' + counts[g[0]] + '</span></button>';
      }).join('') + '</div>'
      + '<div class="emp-toolbar"><label class="emp-search"><span class="emp-search-icon" aria-hidden="true">⌕</span>'
      + '<input type="search" id="emp-search" placeholder="Search by name, email or position" value="' + esc(S.search) + '" oninput="Employees.search(this.value)" aria-label="Search employees"></label>'
      + '<span class="emp-quiet">' + rows.length + ' of ' + counts.all + '</span></div>';
    if (!S.employees) html += '<p class="emp-quiet">Loading…</p>';
    else if (!rows.length) html += '<div class="emp-empty"><strong>No one matches.</strong>' + (S.search ? 'Try a different name.' : 'Nobody in this group yet.') + '</div>';
    else {
      html += '<div class="emp-table-wrap"><table class="emp-table"><thead><tr><th>Name</th><th>Position</th><th>Type</th><th>Start</th><th>Location</th><th>Status</th><th></th></tr></thead><tbody>'
        + rows.map(function (e) {
          return '<tr class="emp-row" onclick="Employees.openRecord(\'' + esc(e.userId) + '\')" tabindex="0" onkeydown="if(event.key===\'Enter\')Employees.openRecord(\'' + esc(e.userId) + '\')">'
            + '<td><a class="emp-name" href="#employees/record/' + esc(e.userId) + '" onclick="event.preventDefault(); event.stopPropagation(); Employees.openRecord(\'' + esc(e.userId) + '\')">' + esc(e.name || e.email) + '</a><br><span class="emp-quiet">' + esc(e.email || '') + '</span></td>'
            + '<td>' + esc(e.jobTitle || e.roleTitle || titleCase(e.role)) + '<br><span class="emp-quiet">' + esc(groupOf(e) === 'therapist' ? 'Therapist' : groupOf(e) === 'admin' ? 'Admin' : '') + '</span></td>'
            + '<td>' + esc(titleCase(e.employmentType || '')) + '</td>'
            + '<td>' + esc(fmtDate(e.startDate)) + '</td>'
            + '<td>' + esc(e.workLocation || '') + '</td>'
            + '<td>' + statusChip(e) + ' ' + flags(e) + '</td>'
            + '<td class="emp-open">Open ›</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '</div>';
    host.innerHTML = html;
    var inp = doc.getElementById('emp-search');
    if (inp && S.searchFocus) { inp.focus(); try { inp.setSelectionRange(inp.value.length, inp.value.length); } catch (_) {} }
  }

  // ── One person ────────────────────────────────────────────────────────────
  function row(k, v) { return v == null || v === '' ? '' : '<dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd>'; }
  function dl(rows) { return rows ? '<dl class="emp-terms">' + rows + '</dl>' : '<p class="emp-quiet">Nothing recorded yet.</p>'; }
  function card(title, body, extra) { return '<section class="emp-card"><h3>' + esc(title) + (extra || '') + '</h3>' + body + '</section>'; }
  function joinAddr(p, postal) {
    var g = function (k) { return p[(postal ? 'postal_' : '') + k] || ''; };
    var lines = postal ? [g('line1'), g('line2')] : [p.address_line1 || '', p.address_line2 || ''];
    return lines.concat([[g('suburb'), g('state'), g('postcode')].filter(Boolean).join(' ')]).filter(Boolean).join(', ');
  }

  function renderRecord(host) {
    var d = S.record;
    if (!d) { host.innerHTML = '<div class="ob-root emp-root">' + backLink() + '<p class="emp-quiet">Loading…</p></div>'; return; }
    var u = d.user || {}; var em = d.employment || {}; var pd = d.personalDetails; var pay = d.payroll; var veh = d.vehicle;
    var listRow = (S.employees || []).filter(function (e) { return e.userId === u.id; })[0] || {};
    var name = (pd && [pd.legal_first_name, pd.middle_name, pd.surname].filter(Boolean).join(' ')) || u.name || u.email;
    var head = '<div class="emp-head"><div><h1>' + esc(name) + (pd && pd.preferred_name && pd.preferred_name !== pd.legal_first_name ? ' <span class="emp-quiet">(' + esc(pd.preferred_name) + ')</span>' : '') + '</h1>'
      + '<p class="emp-quiet">' + esc(em.job_title || listRow.jobTitle || titleCase(u.role)) + (em.employment_type ? ' · ' + esc(titleCase(em.employment_type)) : '') + (em.start_date ? ' · started ' + esc(fmtDate(em.start_date)) : '') + ' · ' + esc(u.email || '') + '</p></div>'
      + '<div class="emp-head-chips">' + statusChip({ role: u.role, isActive: u.isActive, employmentStatus: em.status, onboardingStatus: listRow.onboardingStatus })
      + (groupOf({ role: u.role, roleCategory: em.role_category, jobTitle: em.job_title, isTreatingTherapist: listRow.isTreatingTherapist }) === 'therapist' ? '<span class="emp-chip is-quiet">Therapist</span>' : groupOf({ role: u.role, roleCategory: em.role_category }) === 'admin' ? '<span class="emp-chip is-quiet">Admin</span>' : '') + '</div></div>';

    var cards = '';
    cards += card('Employment', dl(
      row('Position', em.job_title) + row('Employment type', titleCase(em.employment_type || '')) + row('Role category', titleCase(em.role_category || ''))
      + row('Start date', fmtDate(em.start_date)) + row('End date', fmtDate(em.end_date)) + row('Probation ends', fmtDate(em.probation_end_date))
      + row('Hours per week', em.hours_per_week) + row('Pay', em.pay_rate != null ? money(em.pay_rate) + (em.pay_basis ? ' ' + (em.pay_basis === 'annual' ? 'per year' : em.pay_basis === 'hourly' ? 'per hour' : em.pay_basis) : '') : '')
      + row('Award classification', em.award_classification) + row('Work location', em.work_location)
      + row('Child-related work', titleCase(em.child_related_work || '')) + row('NDIS risk-assessed role', titleCase(em.ndis_risk_assessed_role || ''))
      + row('Mobile / community role', em.mobile_community_role == null ? '' : em.mobile_community_role ? 'Yes' : 'No') + row('Uses own vehicle', em.uses_own_vehicle == null ? '' : em.uses_own_vehicle ? 'Yes' : 'No')
    ));
    if (pd !== undefined) {
      cards += card('Personal details', dl(pd ? (
        row('Legal name', [pd.legal_first_name, pd.middle_name, pd.surname].filter(Boolean).join(' ')) + row('Preferred name', pd.preferred_name)
        + row('Date of birth', fmtDate(pd.date_of_birth)) + row('Personal email', pd.personal_email) + row('Mobile', pd.mobile)
        + row('Residential address', joinAddr(pd, false)) + row('Postal address', pd.postal_same_as_residential ? 'Same as residential' : joinAddr(pd, true))
      ) : ''));
      cards += card('Emergency contact', dl(pd && pd.emergency_name ? (
        row('Name', pd.emergency_name) + row('Relationship', pd.emergency_relationship) + row('Phone', pd.emergency_phone) + row('Alternative phone', pd.emergency_alt_phone) + row('Email', pd.emergency_email)
      ) : ''));
    }
    if (pay !== undefined) {
      cards += card('Payroll', dl(pay ? (
        row('Account name', pay.accountHolderName) + row('Bank', pay.bsbMasked ? 'BSB ' + pay.bsbMasked + ' · account ••••' + (pay.accountNumberLast4 || '') : '')
        + row('Bank details', titleCase(pay.bankStatus || '')) + row('Tax setup', titleCase(pay.taxSetupStatus || '')) + row('Residency', titleCase(pay.residencyStatus || ''))
        + row('Tax-free threshold', pay.claimsTaxFreeThreshold == null ? '' : pay.claimsTaxFreeThreshold ? 'Claimed' : 'Not claimed') + row('Study loan', pay.hasStudyLoan == null ? '' : pay.hasStudyLoan ? 'Yes' : 'No')
        + row('Super', titleCase(pay.superStatus || '')) + row('Super fund', pay.superFundName) + row('Member number', pay.superMemberNumber)
        + row('Payroll system', pay.payrollSystem ? titleCase(pay.payrollSystem) + (pay.payrollEmployeeRef ? ' · ' + pay.payrollEmployeeRef : '') : '') + row('Payroll setup', titleCase(pay.payrollSetupStatus || ''))
      ) : ''), '<span class="emp-quiet emp-h3-note">masked</span>');
    }
    var creds = (d.credentials || []);
    var ids = (d.identityRecords || []);
    if (creds.length || ids.length || d.identityRecords !== undefined) {
      var items = ids.map(function (i) {
        var expired = i.expiry_date && new Date(i.expiry_date) < new Date();
        return '<li' + (expired ? ' class="is-danger"' : '') + '><strong>' + esc(titleCase(i.evidence_type || i.record_kind || 'Identity')) + '</strong>' + (i.document_number_last4 ? ' · ••••' + esc(i.document_number_last4) : '') + (i.country_of_issue ? ' · ' + esc(i.country_of_issue) : '')
          + (i.expiry_date ? ' · expires ' + esc(fmtDate(i.expiry_date)) + (expired ? ' <span class="emp-flag is-danger">EXPIRED</span>' : '') : '') + (i.work_rights_expiry ? ' · work rights to ' + esc(fmtDate(i.work_rights_expiry)) : '')
          + (i.verification_status ? ' <span class="emp-chip is-quiet">' + esc(titleCase(i.verification_status)) + '</span>' : '') + '</li>';
      }).concat(creds.map(function (c) {
        var expired = c.expiryDate && new Date(c.expiryDate) < new Date();
        return '<li' + (expired ? ' class="is-danger"' : '') + '><strong>' + esc(c.name || titleCase(c.type)) + '</strong>' + (c.registrationNumber ? ' · ' + esc(c.registrationNumber) : '') + (c.issuingBody ? ' · ' + esc(c.issuingBody) : '')
          + (c.expiryDate ? ' · expires ' + esc(fmtDate(c.expiryDate)) + (expired ? ' <span class="emp-flag is-danger">EXPIRED</span>' : '') : '')
          + ' <span class="emp-chip ' + (c.status === 'verified' ? 'is-active' : c.status === 'expired' || c.status === 'rejected' ? 'is-inactive' : 'is-quiet') + '">' + esc(titleCase(c.status || '')) + '</span></li>';
      }));
      cards += card('Identity & credentials', items.length ? '<ul class="emp-creds">' + items.join('') + '</ul>' : '<p class="emp-quiet">Nothing recorded yet.</p>');
    }
    if (veh !== undefined) {
      cards += card('Vehicle', dl(veh ? (
        row('Registration', veh.registration) + row('Vehicle', [veh.make, veh.model].filter(Boolean).join(' ')) + row('Registration expires', fmtDate(veh.registration_expiry))
        + row('Insurance policy', veh.insurance_policy_number) + row('Insurance expires', fmtDate(veh.insurance_expiry))
      ) : ''));
    }
    var acks = d.acknowledgements || [];
    cards += card('Policies acknowledged', acks.length ? '<ul class="emp-creds">' + acks.map(function (a) {
      return '<li><strong>' + esc(a.documentTitle || a.documentCode) + '</strong>' + (a.documentVersion ? ' · v' + esc(a.documentVersion) : '') + ' · ' + esc(fmtDateTime(a.acknowledgedAt)) + (a.typedLegalName ? ' · signed ' + esc(a.typedLegalName) : '') + '</li>';
    }).join('') + '</ul>' : '<p class="emp-quiet">None yet.</p>');
    var hist = d.onboardingHistory || [];
    cards += card('Onboarding', hist.length ? '<ul class="emp-creds">' + hist.map(function (h) {
      return '<li><a href="#onboarding/record/' + esc(h.id) + '" onclick="event.preventDefault(); Employees.goOnboarding(\'' + esc(h.id) + '\')"><strong>' + esc(h.package_title || 'Onboarding') + '</strong></a>' + (h.package_version ? ' · v' + esc(h.package_version) : '') + ' · ' + esc(titleCase(h.status || '')) + ' · started ' + esc(fmtDate(h.created_at)) + (h.activated_at ? ' · activated ' + esc(fmtDate(h.activated_at)) : '') + '</li>';
    }).join('') + '</ul>' : '<p class="emp-quiet">No onboarding record.</p>');

    host.innerHTML = '<div class="ob-root emp-root">' + backLink() + head + '<div class="emp-grid">' + cards + '</div></div>';
  }

  function backLink() { return '<button type="button" class="emp-back" onclick="Employees.open()">‹ All employees</button>'; }

  // ── Loading + entry points ────────────────────────────────────────────────
  async function loadList() {
    var res = await api('/api/onboarding/employees?include=onboarding');
    if (!res.ok) { S.employees = []; toast(res.status === 403 ? 'You do not have access to the employee register.' : res.error, true); return; }
    S.employees = res.employees || [];
  }
  async function loadRecord(id) {
    var res = await api('/api/onboarding/employees/' + encodeURIComponent(id));
    if (!res.ok) { toast(res.status === 404 ? 'That person could not be found.' : res.error, true); S.record = null; S.view = 'list'; S.recordId = null; return false; }
    S.record = res; return true;
  }

  function draw() {
    var host = root(); if (!host) return;
    if (S.view === 'record') renderRecord(host); else renderList(host);
  }
  function syncRoute() {
    if (global.OpalNav && typeof global.OpalNav.pushEmployee === 'function') {
      try { global.OpalNav.pushEmployee(currentRecordId()); } catch (_) { /* routing never blocks the UI */ }
    }
  }
  function currentRecordId() { return S.view === 'record' && S.recordId ? S.recordId : null; }

  /** The register. Idempotent: navigation.js and the tab dispatch may both call it. */
  async function open() {
    if (S.view === 'record' && S.recordId) { S.view = 'list'; S.recordId = null; S.record = null; }
    draw();
    syncRoute();
    if (!S.loading) { S.loading = true; await loadList(); S.loading = false; if (S.view === 'list') draw(); }
  }
  /** One person. */
  async function openRecord(id) {
    if (!id) return open();
    S.view = 'record'; S.recordId = id; S.record = null;
    draw();
    syncRoute();
    var listLoad = S.employees ? Promise.resolve() : loadList();
    var ok = await loadRecord(id);
    await listLoad;
    draw();
    if (!ok) syncRoute();
  }
  function group(g) { S.group = g; S.searchFocus = false; draw(); }
  function search(v) { S.search = v || ''; S.searchFocus = true; draw(); }
  function goOnboarding(id) {
    if (global.OpalNav && typeof global.OpalNav.go === 'function') global.OpalNav.go({ tab: 'onboarding', view: 'record', id: id });
    else if (typeof global.switchTab === 'function') { global.switchTab('onboarding'); if (global.Onboarding && global.Onboarding.open) global.Onboarding.open('record', id); }
  }

  global.Employees = { open: open, openRecord: openRecord, currentRecordId: currentRecordId, group: group, search: search, goOnboarding: goOnboarding };
})(window);
