/* ═══════════════════════════════════════════════════════════════════════════
   MY PROFILE — portal module

   Lifted out of mockup_v3.html unchanged (2026-08-23). The shell was ~29,000
   lines; this is the whole My Profile domain — about 1,750 of them — moved
   without a change to what any of it does.

   WHAT IS HERE
     Leave           request, approve, reject; therapist and manager views
     CPD             the same, plus the approved-hours total
     PD documents    upload, list, delete
     Credentials     the register, the document scan, the reader's proposals,
                     verification and its withdrawal
     Work schedule   the debounced save behind the Work Locations editor
     Notifications   the per-user preference switches
     Dashboard nav   the seven #pf-* area cards and the back button
     Details         loadProfileView / toggleProfileEdit / saveProfileDetails

   NOT A MODULE PATTERN, DELIBERATELY
   No IIFE and no namespace object. Every function below is called by name
   from an onclick= attribute in the shell's markup or from the shell's own
   inline script, so all of it stays global exactly as it was. Nothing is
   renamed, nothing is wrapped, and the file is not strict-mode — because the
   inline script it came from is not either, and 'use strict' would be a
   behaviour change wearing a tidy-up's clothes.

   LOAD ORDER
   Loaded with defer, so it executes after every inline <script> in the shell
   has parsed and before DOMContentLoaded. So this file may use the shell's
   globals — escapeHtml(), showToast(), refreshAlarm(), alarmEnabled,
   loadSetupStatusCard() — at call time, and the shell may use everything
   defined here from any handler that fires once the page is parsed.
   One line is order-sensitive: the loadProfileView patch reads
   loadProfileView above the declaration that provides it, which is correct
   because function declarations hoist across the whole script.

   WHAT STAYED IN THE SHELL
   Every line of #view-profile markup and every .pf-* style rule. Moving
   those needs a templating step this repository does not have, and the
   point of the move was the logic.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   MY PROFILE — data-driven sections
   Leave | CPD | PD Documents | Credentials
   All sections start empty. Data is fetched from the backend API.
   Role-aware: Owner/Admin see approval views; Therapist sees own records only.
   ═══════════════════════════════════════════════════════════════════════════ */

// ── Helpers ────────────────────────────────────────────────────────────────

function _pfDateFmt(dateStr) {
  if (!dateStr) return '—';
  try { return new Date(dateStr).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }); }
  catch { return dateStr; }
}

function _pfStatusPill(status) {
  const map = {
    draft:     ['draft',    'Draft'],
    submitted: ['pending',  'Pending approval'],
    approved:  ['approved', 'Approved'],
    rejected:  ['denied',   'Rejected'],
    active:    ['approved', 'Active'],
    expired:   ['denied',   'Expired'],
    verified:  ['approved', 'Verified'],
    missing:   ['denied',   'Missing'],
    pending_review: ['pending', 'Pending review'],
  };
  const [cls, label] = map[status] || ['draft', status];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

function _pfEmpty(msg) {
  return `<div class="pf-empty">
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/>
    </svg>
    <p>${msg}</p>
  </div>`;
}

function _pfCredDaysToExpiry(expiryDate) {
  if (!expiryDate) return null;
  return Math.ceil((new Date(expiryDate) - new Date()) / 86400000);
}

// ── Leave section ──────────────────────────────────────────────────────────

async function loadLeaveSection() {
  const u = window.APP_USER;
  if (!u) return;
  const isManager = ['owner','admin'].includes(u.role);

  const hdr = document.getElementById('pf-leave-header');
  const body = document.getElementById('pf-leave-body');

  // Update sidebar nav label
  const navLabel = document.getElementById('pf-nav-leave-label');
  if (navLabel) navLabel.textContent = isManager ? 'Leave approvals' : 'Leave';

  // Set header
  hdr.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3 style="margin:0;">${isManager ? 'Leave approvals' : 'Leave requests'}</h3>
      ${!isManager ? `<button class="btn primary" onclick="showModal('modal-leave-request')" style="font-size:12px;">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 2v3M8 2v3M2 11h20"/></svg>
        Request leave</button>` : ''}
    </div>
    <p class="section-desc">${isManager
      ? 'Review and approve leave requests submitted by staff. Once approved, leave blocks scheduling.'
      : 'Submit leave requests. Once approved, the leave period blocks scheduling in Splose.'}</p>
  `;

  body.innerHTML = '<div class="pf-loading">Loading…</div>';

  try {
    const r = await fetch('/api/profile/leave', { credentials: 'include' });
    if (!r.ok) throw new Error('Failed');
    const { leaveRequests } = await r.json();

    if (isManager) {
      _renderLeaveApprovalView(body, leaveRequests);
    } else {
      _renderLeaveTherapistView(body, leaveRequests);
    }
  } catch {
    body.innerHTML = '<p style="color:var(--danger);font-size:12.5px;">Could not load leave data. Please try again.</p>';
  }
}

function _renderLeaveTherapistView(body, requests) {
  if (!requests.length) {
    body.innerHTML = _pfEmpty('No leave requests submitted yet.') +
      `<div style="text-align:center;margin-top:8px;">
        <button class="btn primary" onclick="showModal('modal-leave-request')">Submit your first leave request</button>
      </div>`;
    return;
  }
  body.innerHTML = `
    <div class="req-history">
      <table class="req-tbl">
        <thead><tr><th>Type</th><th>From</th><th>To</th><th>Submitted</th><th>Status</th></tr></thead>
        <tbody>
          ${requests.map(r => `<tr>
            <td>${_pfLeaveTypeLabel(r.leave_type)}</td>
            <td>${_pfDateFmt(r.start_date)}</td>
            <td>${_pfDateFmt(r.end_date)}</td>
            <td>${_pfDateFmt(r.submitted_at || r.created_at)}</td>
            <td>${_pfStatusPill(r.status)}${r.rejection_reason ? `<div style="font-size:10.5px;color:var(--muted);margin-top:2px;">Note: ${r.rejection_reason}</div>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _renderLeaveApprovalView(body, requests) {
  const pending  = requests.filter(r => r.status === 'submitted');
  const approved = requests.filter(r => r.status === 'approved');
  const rejected = requests.filter(r => r.status === 'rejected');
  const draft    = requests.filter(r => r.status === 'draft');

  const badge = n => n > 0 ? `<span class="pf-badge">${n}</span>` : '';

  body.innerHTML = `
    <div class="pf-tabs">
      <button class="pf-tab-btn active" onclick="_pfSwitchTab(this,'leave-pending')">Pending${badge(pending.length)}</button>
      <button class="pf-tab-btn" onclick="_pfSwitchTab(this,'leave-approved')">Approved</button>
      <button class="pf-tab-btn" onclick="_pfSwitchTab(this,'leave-rejected')">Rejected</button>
      ${draft.length ? `<button class="pf-tab-btn" onclick="_pfSwitchTab(this,'leave-draft')">Drafts${badge(draft.length)}</button>` : ''}
    </div>
    <div id="leave-pending" class="pf-tab-pane active">${_renderLeaveApprovalRows(pending, true)}</div>
    <div id="leave-approved" class="pf-tab-pane">${_renderLeaveTableRows(approved)}</div>
    <div id="leave-rejected" class="pf-tab-pane">${_renderLeaveTableRows(rejected)}</div>
    ${draft.length ? `<div id="leave-draft" class="pf-tab-pane">${_renderLeaveTableRows(draft)}</div>` : ''}
  `;
}

function _renderLeaveApprovalRows(requests, showActions) {
  if (!requests.length) return _pfEmpty('No leave requests pending approval.');
  return requests.map(r => `
    <div class="approval-row" id="leave-ar-${r.id}">
      <div class="ar-info">
        <strong>${escapeHtml(r.user_display_name || r.user_email)}</strong> — ${_pfLeaveTypeLabel(r.leave_type)}<br>
        <div class="ar-meta">${_pfDateFmt(r.start_date)} → ${_pfDateFmt(r.end_date)}
          ${r.reason ? ` · <em>${escapeHtml(r.reason)}</em>` : ''}</div>
        <div class="ar-meta">Submitted ${_pfDateFmt(r.submitted_at || r.created_at)}</div>
      </div>
      ${showActions ? `<div class="ar-actions">
        <button class="btn" style="color:var(--danger);border-color:var(--danger);" onclick="pfRejectLeave('${r.id}')">Reject</button>
        <button class="btn primary" onclick="pfApproveLeave('${r.id}')">Approve</button>
      </div>` : ''}
    </div>`).join('');
}

function _renderLeaveTableRows(requests) {
  if (!requests.length) return _pfEmpty('No records in this category.');
  return `<table class="req-tbl">
    <thead><tr><th>Staff member</th><th>Type</th><th>From</th><th>To</th><th>Status</th></tr></thead>
    <tbody>${requests.map(r => `<tr>
      <td>${escapeHtml(r.user_display_name || r.user_email)}</td>
      <td>${_pfLeaveTypeLabel(r.leave_type)}</td>
      <td>${_pfDateFmt(r.start_date)}</td>
      <td>${_pfDateFmt(r.end_date)}</td>
      <td>${_pfStatusPill(r.status)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function _pfLeaveTypeLabel(type) {
  const map = { annual:'Annual leave', personal:"Personal / carer's leave", sick:'Sick leave',
    public:'Public holiday / RDO', unpaid:'Unpaid leave', study:'Study / conference', other:'Other' };
  return map[type] || escapeHtml(type);
}

async function pfApproveLeave(id) {
  try {
    const r = await fetch(`/api/profile/leave/${id}/approve`, { method:'PATCH', credentials:'include' });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('Leave approved', 'Recorded. Note: the portal does not yet notify the staff member automatically — tell them directly.');
    loadLeaveSection();
  } catch (e) { showToast('Error', e.message || 'Could not approve leave.', 'error'); }
}

async function pfRejectLeave(id) {
  const reason = await portalPrompt('Reason for rejection (optional):') ?? null;
  if (reason === null && !await portalConfirm('Reject without a reason?')) return;
  try {
    const r = await fetch(`/api/profile/leave/${id}/reject`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ rejectionReason: reason || '' }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('Leave rejected', 'Recorded. Note: the portal does not yet notify the staff member automatically — tell them directly.');
    loadLeaveSection();
  } catch (e) { showToast('Error', e.message || 'Could not reject leave.', 'error'); }
}

async function submitLeaveModal() {
  const leaveType = document.getElementById('leave-type-modal').value;
  const startDate = document.getElementById('leave-from-modal').value;
  const endDate   = document.getElementById('leave-to-modal').value;
  const reason    = document.getElementById('leave-note-modal').value.trim();
  const status    = document.getElementById('leave-status-modal').value;
  const errBox    = document.getElementById('leave-modal-err');
  const btn       = document.getElementById('leave-submit-btn');

  errBox.style.display = 'none';
  if (!startDate || !endDate) { errBox.textContent = 'Please set both start and end dates.'; errBox.style.display = ''; return; }
  if (endDate < startDate)    { errBox.textContent = 'End date must be on or after start date.'; errBox.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/profile/leave', {
      method: 'POST', headers: {'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({ leaveType, startDate, endDate, reason: reason || null, status }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Save failed');

    closeModal('modal-leave-request');
    // Reset form
    document.getElementById('leave-from-modal').value = '';
    document.getElementById('leave-to-modal').value = '';
    document.getElementById('leave-note-modal').value = '';
    document.getElementById('leave-status-modal').value = 'submitted';

    showToast('Leave request saved', status === 'draft' ? 'Saved as draft.' : 'Submitted for approval.');
    loadLeaveSection();
  } catch (e) {
    errBox.textContent = e.message || 'Could not save leave request. Please try again.';
    errBox.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit for approval';
  }
}

// ── CPD section ────────────────────────────────────────────────────────────

async function loadCPDSection() {
  const u = window.APP_USER;
  if (!u) return;
  const isManager = ['owner','admin'].includes(u.role);

  const hdr = document.getElementById('pf-cpd-header');
  const body = document.getElementById('pf-cpd-body');

  const navLabel = document.getElementById('pf-nav-cpd-label');
  if (navLabel) navLabel.textContent = isManager ? 'CPD approvals' : 'Professional development';

  hdr.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3 style="margin:0;">${isManager ? 'CPD approvals' : 'Professional development'}</h3>
      ${!isManager ? `<button class="btn primary" onclick="showModal('modal-cpd-request')" style="font-size:12px;">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6m-2-2h4M2 10v6m2-2H0M12 2L2 7v5c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-10-5z"/></svg>
        Add CPD activity</button>` : ''}
    </div>
    <p class="section-desc">${isManager
      ? 'Review CPD submissions from staff members.'
      : 'Log CPD activities for AHPRA registration and professional development records.'}</p>
  `;

  body.innerHTML = '<div class="pf-loading">Loading…</div>';

  try {
    const r = await fetch('/api/profile/cpd', { credentials: 'include' });
    if (!r.ok) throw new Error('Failed');
    const { cpdActivities } = await r.json();

    if (isManager) {
      _renderCPDApprovalView(body, cpdActivities);
    } else {
      _renderCPDTherapistView(body, cpdActivities);
    }
  } catch {
    body.innerHTML = '<p style="color:var(--danger);font-size:12.5px;">Could not load CPD data. Please try again.</p>';
  }
}

function _renderCPDTherapistView(body, activities) {
  if (!activities.length) {
    body.innerHTML = _pfEmpty('No CPD activities added yet.') +
      `<div style="text-align:center;margin-top:8px;">
        <button class="btn primary" onclick="showModal('modal-cpd-request')">Add your first CPD activity</button>
      </div>`;
    return;
  }
  const totalApprovedHrs = activities.filter(a => a.status === 'approved')
    .reduce((s, a) => s + (parseFloat(a.hours) || 0), 0);
  body.innerHTML = `
    ${totalApprovedHrs > 0 ? `<p style="font-size:12.5px;color:var(--ink-soft);margin-bottom:12px;">
      Approved CPD hours: <strong>${totalApprovedHrs.toFixed(1)}</strong>
    </p>` : ''}
    <div class="req-history">
      <table class="req-tbl">
        <thead><tr><th>Activity</th><th>Date</th><th>Hours</th><th>Cost</th><th>Status</th></tr></thead>
        <tbody>
          ${activities.map(a => `<tr>
            <td>${escapeHtml(a.title)}${a.provider ? `<div style="font-size:10.5px;color:var(--muted);">${escapeHtml(a.provider)}</div>` : ''}</td>
            <td>${_pfDateFmt(a.completed_date)}</td>
            <td>${a.hours != null ? Number(a.hours).toFixed(1) : '—'}</td>
            <td>${a.cost_aud != null ? '$' + Number(a.cost_aud).toLocaleString('en-AU', {minimumFractionDigits:2}) : '—'}</td>
            <td>${_pfStatusPill(a.status)}${a.review_comments ? `<div style="font-size:10.5px;color:var(--muted);margin-top:2px;">${escapeHtml(a.review_comments)}</div>` : ''}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

function _renderCPDApprovalView(body, activities) {
  const pending  = activities.filter(a => a.status === 'submitted');
  const approved = activities.filter(a => a.status === 'approved');
  const rejected = activities.filter(a => a.status === 'rejected');

  const badge = n => n > 0 ? `<span class="pf-badge">${n}</span>` : '';

  body.innerHTML = `
    <div class="pf-tabs">
      <button class="pf-tab-btn active" onclick="_pfSwitchTab(this,'cpd-pending')">Pending${badge(pending.length)}</button>
      <button class="pf-tab-btn" onclick="_pfSwitchTab(this,'cpd-approved')">Approved</button>
      <button class="pf-tab-btn" onclick="_pfSwitchTab(this,'cpd-rejected')">Rejected</button>
    </div>
    <div id="cpd-pending" class="pf-tab-pane active">${_renderCPDApprovalRows(pending, true)}</div>
    <div id="cpd-approved" class="pf-tab-pane">${_renderCPDTableRows(approved)}</div>
    <div id="cpd-rejected" class="pf-tab-pane">${_renderCPDTableRows(rejected)}</div>
  `;
}

function _renderCPDApprovalRows(activities, showActions) {
  if (!activities.length) return _pfEmpty('No CPD activities pending approval.');
  return activities.map(a => `
    <div class="approval-row" id="cpd-ar-${a.id}">
      <div class="ar-info">
        <strong>${escapeHtml(a.user_display_name || a.user_email)}</strong> — ${escapeHtml(a.title)}<br>
        <div class="ar-meta">${a.provider ? escapeHtml(a.provider) + ' · ' : ''}${a.completed_date ? _pfDateFmt(a.completed_date) : 'Date not set'}
          ${a.hours != null ? ` · ${Number(a.hours).toFixed(1)} hrs` : ''}
          ${a.cost_aud != null ? ` · $${Number(a.cost_aud).toLocaleString('en-AU')}` : ''}</div>
        ${a.notes ? `<div class="ar-meta" style="margin-top:2px;font-style:italic;">${escapeHtml(a.notes)}</div>` : ''}
      </div>
      ${showActions ? `<div class="ar-actions">
        <button class="btn" style="color:var(--danger);border-color:var(--danger);" onclick="pfRejectCPD('${a.id}')">Reject</button>
        <button class="btn primary" onclick="pfApproveCPD('${a.id}')">Approve</button>
      </div>` : ''}
    </div>`).join('');
}

function _renderCPDTableRows(activities) {
  if (!activities.length) return _pfEmpty('No records in this category.');
  return `<table class="req-tbl">
    <thead><tr><th>Staff</th><th>Activity</th><th>Date</th><th>Hours</th><th>Status</th></tr></thead>
    <tbody>${activities.map(a => `<tr>
      <td>${escapeHtml(a.user_display_name || a.user_email)}</td>
      <td>${escapeHtml(a.title)}</td>
      <td>${_pfDateFmt(a.completed_date)}</td>
      <td>${a.hours != null ? Number(a.hours).toFixed(1) : '—'}</td>
      <td>${_pfStatusPill(a.status)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

async function pfApproveCPD(id) {
  try {
    const r = await fetch(`/api/profile/cpd/${id}/approve`, { method:'PATCH', credentials:'include' });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('CPD approved', '');
    loadCPDSection();
  } catch (e) { showToast('Error', e.message || 'Could not approve CPD.', 'error'); }
}

async function pfRejectCPD(id) {
  const comments = await portalPrompt('Reason for rejection (optional):') ?? null;
  if (comments === null && !await portalConfirm('Reject without a reason?')) return;
  try {
    const r = await fetch(`/api/profile/cpd/${id}/reject`, {
      method:'PATCH', headers:{'Content-Type':'application/json'}, credentials:'include',
      body: JSON.stringify({ reviewComments: comments || '' }),
    });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('CPD rejected', '');
    loadCPDSection();
  } catch (e) { showToast('Error', e.message || 'Could not reject CPD.', 'error'); }
}

async function submitCPDModal() {
  const title    = document.getElementById('cpd-title-modal').value.trim();
  const provider = document.getElementById('cpd-provider-modal').value.trim();
  const category = document.getElementById('cpd-category-modal').value;
  const completedDate = document.getElementById('cpd-date-modal').value;
  const hours    = document.getElementById('cpd-hours-modal').value;
  const costAud  = document.getElementById('cpd-cost-modal').value;
  const mode     = document.getElementById('cpd-mode-modal').value;
  const link     = document.getElementById('cpd-link-modal').value.trim();
  const notes    = document.getElementById('cpd-why-modal').value.trim();
  const status   = document.getElementById('cpd-status-modal').value;
  const errBox   = document.getElementById('cpd-modal-err');
  const btn      = document.getElementById('cpd-submit-btn');

  errBox.style.display = 'none';
  if (!title) { errBox.textContent = 'Activity title is required.'; errBox.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/profile/cpd', {
      method: 'POST', headers:{'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({
        title, provider: provider || null, category: category || null,
        completedDate: completedDate || null,
        hours: hours ? parseFloat(hours) : null,
        costAud: costAud ? parseFloat(costAud) : null,
        mode: mode || null, link: link || null,
        notes: notes || null, status,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Save failed');

    closeModal('modal-cpd-request');
    // Reset form
    ['cpd-title-modal','cpd-provider-modal','cpd-date-modal','cpd-hours-modal',
     'cpd-cost-modal','cpd-link-modal','cpd-why-modal'].forEach(id => {
      document.getElementById(id).value = '';
    });
    document.getElementById('cpd-category-modal').value = '';
    document.getElementById('cpd-mode-modal').value = 'online';
    document.getElementById('cpd-status-modal').value = 'submitted';

    showToast('CPD activity saved', status === 'draft' ? 'Saved as draft.' : 'Submitted for approval.');
    loadCPDSection();
  } catch (e) {
    errBox.textContent = e.message || 'Could not save CPD activity.';
    errBox.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit for approval';
  }
}

// ── PD Documents section ────────────────────────────────────────────────────

let _pdDocFile = null; // selected file for upload

function onDocFileSelected(input) {
  const file = input.files[0];
  if (!file) { _pdDocFile = null; return; }
  if (file.size > 5 * 1024 * 1024) {
    showToast('File too large', 'Maximum file size is 5 MB.', 'error');
    input.value = ''; _pdDocFile = null; return;
  }
  _pdDocFile = file;
  document.getElementById('doc-dropzone-label').textContent = `Selected: ${file.name}`;
}

async function loadPDDocumentsSection() {
  const hdr  = document.getElementById('pf-pddocs-header');
  const body = document.getElementById('pf-pddocs-body');

  hdr.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3 style="margin:0;">Professional development documents</h3>
      <button class="btn primary" onclick="openPDDocModal()" style="font-size:12px;">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x1="12" y2="3"/></svg>
        Upload document</button>
    </div>
    <p class="section-desc">Upload certificates, training records, course completions, and other PD evidence.</p>
  `;

  body.innerHTML = '<div class="pf-loading">Loading…</div>';

  try {
    const r = await fetch('/api/profile/documents', { credentials: 'include' });
    if (!r.ok) throw new Error('Failed');
    const { documents } = await r.json();
    _renderPDDocuments(body, documents);
  } catch {
    body.innerHTML = '<p style="color:var(--danger);font-size:12.5px;">Could not load documents.</p>';
  }
}

function _renderPDDocuments(body, docs) {
  if (!docs.length) {
    body.innerHTML = _pfEmpty('No professional development documents uploaded yet.') +
      `<div style="text-align:center;margin-top:8px;">
        <button class="btn primary" onclick="openPDDocModal()">Upload your first document</button>
      </div>`;
    return;
  }
  body.innerHTML = `<table class="req-tbl">
    <thead><tr><th>Title</th><th>Type</th><th>File</th><th>Uploaded</th><th></th></tr></thead>
    <tbody>
      ${docs.map(d => `<tr>
        <td>${escapeHtml(d.title)}</td>
        <td style="color:var(--muted);font-size:11.5px;">${_pfDocTypeLabel(d.document_type)}</td>
        <td style="font-size:11.5px;">${escapeHtml(d.file_name) || '—'}</td>
        <td style="font-size:11.5px;">${_pfDateFmt(d.uploaded_at)}</td>
        <td style="white-space:nowrap;">
          <a class="btn" style="font-size:11px;padding:3px 10px;" href="/api/profile/documents/${d.id}/download" target="_blank" rel="noopener">Download</a>
          <button class="btn" style="font-size:11px;padding:3px 10px;color:var(--danger);"
          onclick="pfDeleteDocument('${d.id}')">Remove</button></td>
      </tr>`).join('')}
    </tbody>
  </table>`;
}

function _pfDocTypeLabel(type) {
  const map = { certificate:'Certificate', training:'Training record', supervision:'Supervision record',
    learning_plan:'Learning plan', registration:'Registration document', other:'Other' };
  return map[type] || escapeHtml(type) || '—';
}

async function openPDDocModal() {
  // Pre-populate CPD dropdown with user's CPD activities
  try {
    const r = await fetch('/api/profile/cpd?mine=1', { credentials:'include' });
    if (r.ok) {
      const { cpdActivities } = await r.json();
      const sel = document.getElementById('doc-cpd-link-modal');
      sel.innerHTML = '<option value="">— None —</option>' +
        cpdActivities.map(a => `<option value="${a.id}">${a.title}</option>`).join('');
    }
  } catch {}
  document.getElementById('doc-title-modal').value = '';
  document.getElementById('doc-type-modal').value = 'certificate';
  document.getElementById('doc-dropzone-label').textContent = 'Click to select file or drag & drop';
  document.getElementById('file-input-doc').value = '';
  _pdDocFile = null;
  showModal('modal-doc-upload');
}

async function submitDocumentModal() {
  const title    = document.getElementById('doc-title-modal').value.trim();
  const docType  = document.getElementById('doc-type-modal').value;
  const cpdId    = document.getElementById('doc-cpd-link-modal').value;
  const errBox   = document.getElementById('doc-modal-err');
  const btn      = document.getElementById('doc-submit-btn');

  errBox.style.display = 'none';
  if (!title) { errBox.textContent = 'Document title is required.'; errBox.style.display = ''; return; }

  btn.disabled = true; btn.textContent = 'Uploading…';
  try {
    let fileData = null, fileName = null, fileMime = null, fileSizeBytes = null;
    if (_pdDocFile) {
      fileData = await new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = e => res(e.target.result.split(',')[1]); // base64
        fr.onerror = rej;
        fr.readAsDataURL(_pdDocFile);
      });
      fileName     = _pdDocFile.name;
      fileMime     = _pdDocFile.type;
      fileSizeBytes = _pdDocFile.size;
    }

    const r = await fetch('/api/profile/documents', {
      method: 'POST', headers:{'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({
        title, documentType: docType,
        fileName, fileMime, fileSizeBytes, fileData,
        relatedCpdActivityId: cpdId || null,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Upload failed');

    closeModal('modal-doc-upload');
    _pdDocFile = null;
    showToast('Document uploaded', title);
    loadPDDocumentsSection();
  } catch (e) {
    errBox.textContent = e.message || 'Upload failed. Please try again.';
    errBox.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload document';
  }
}

async function pfDeleteDocument(id) {
  if (!await portalConfirm('Remove this document?', { danger: true })) return;
  try {
    const r = await fetch(`/api/profile/documents/${id}`, { method:'DELETE', credentials:'include' });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('Document removed', '');
    loadPDDocumentsSection();
  } catch (e) { showToast('Error', e.message || 'Could not remove document.', 'error'); }
}

// ── Credentials section ────────────────────────────────────────────────────

async function loadCredentialsSection() {
  const u = window.APP_USER;
  if (!u) return;
  const isManager = ['owner','admin'].includes(u.role);

  const hdr  = document.getElementById('pf-credentials-header');
  const body = document.getElementById('pf-credentials-body');

  hdr.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
      <h3 style="margin:0;">Credentials</h3>
      <button class="btn primary" onclick="credOpenAddModal()" style="font-size:12px;">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Add credential</button>
    </div>
    <p class="section-desc">${isManager
      ? 'View credentials across staff. Use the verification button to mark credentials as verified.'
      : 'Manage your professional credentials, licences, and clearances. The app alerts you before expiry.'}</p>
  `;

  body.innerHTML = '<div class="pf-loading">Loading…</div>';

  try {
    const r = await fetch('/api/profile/credentials', { credentials: 'include' });
    if (!r.ok) throw new Error('Failed');
    const { credentials } = await r.json();
    _renderCredentialCards(body, credentials, isManager);
  } catch {
    body.innerHTML = '<p style="color:var(--danger);font-size:12.5px;">Could not load credentials.</p>';
  }
}

/**
 * The portal grew two names for four credential types: onboarding writes
 * `ahpra_registration`, the profile's own dialog used to write `ahpra`. Both
 * are in the table. A screen that knows only one spelling renders the other as
 * a raw database string — which is what this list did before, showing
 * "ndis_worker_screening" under a card.
 *
 * The onboarding spelling is canonical. Nothing is renamed in the database by
 * this; the server folds a type when a credential is saved, and the two
 * spellings count as the same value so an idle save cannot withdraw a
 * verification.
 */
var CRED_TYPE_LABELS = {
  ahpra_registration: 'AHPRA registration',
  wwcc: 'Working with Children Check',
  ndis_worker_screening: 'NDIS Worker Screening Check',
  police_check: 'Police check',
  drivers_licence: "Driver's licence",
  professional_indemnity: 'Professional indemnity',
  public_liability: 'Public liability insurance',
  qualification: 'Qualification',
  first_aid: 'First aid certificate',
  cpr: 'CPR certificate',
  other: 'Other',
};

var CRED_TYPE_ALIASES = {
  ahpra: 'ahpra_registration',
  ndis_screening: 'ndis_worker_screening',
  police_clearance: 'police_check',
  indemnity_insurance: 'professional_indemnity',
};

function credCanonicalType(type) {
  const key = String(type || '').toLowerCase();
  return CRED_TYPE_ALIASES[key] || key;
}

/**
 * The cards, and the last credential list the page loaded.
 *
 * Kept because the detail dialog opens from a click on a card and must show
 * the record as loaded, not re-fetch a single credential the API has no route
 * for. Refreshed on every load, so it cannot go stale behind the dialog.
 */
var _credCache = [];

function _renderCredentialCards(body, creds, isManager) {
  _credCache = creds || [];

  if (!creds.length) {
    body.innerHTML = _pfEmpty('No credentials added yet.') +
      `<div style="text-align:center;margin-top:8px;">
        <button class="btn primary" onclick="credOpenAddModal()">Add your first credential</button>
      </div>`;
    return;
  }

  const meId = (window.APP_USER || {}).id;

  const cards = creds.map(c => {
    const days = _pfCredDaysToExpiry(c.expiry_date);
    const isExpired  = days !== null && days < 0;
    const isExpiring = days !== null && days >= 0 && days <= 60;
    const cardClass  = isExpired ? 'expired' : isExpiring ? 'expiring-soon' : '';
    const isMine     = c.user_id === meId;

    let statusLabel;
    if (isExpired)       statusLabel = `<span style="color:var(--danger);font-size:11px;font-weight:600;">EXPIRED</span>`;
    else if (isExpiring) statusLabel = `<span style="color:var(--warn);font-size:11px;font-weight:600;">Expires in ${days} day${days === 1 ? '' : 's'}</span>`;
    else if (c.expiry_date) statusLabel = `<span style="color:var(--ok);font-size:11px;">Current</span>`;
    else                 statusLabel = `<span style="font-size:11px;color:var(--muted);">No expiry date</span>`;

    // A credential with no document behind it is a claim, not evidence, and
    // the card says so rather than looking complete.
    const scanBadge = c.document_id
      ? `<span class="cred-scan present">✓ Document attached</span>`
      : `<span class="cred-scan missing">Scan missing</span>`;

    return `<div class="cred-card clickable ${cardClass}" role="button" tabindex="0"
        onclick="pfOpenCredential('${c.id}')"
        onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pfOpenCredential('${c.id}');}"
        title="Open this credential">
      <div class="cred-name">${escapeHtml(c.credential_name)}</div>
      ${isManager ? `<div class="cred-sub">${escapeHtml(c.user_display_name || c.user_email || '')}</div>` : ''}
      <div class="cred-sub">${_pfCredTypeLabel(c.credential_type)}</div>
      <div class="cred-meta">
        ${c.issuing_body ? `<strong>${escapeHtml(c.issuing_body)}</strong><br>` : ''}
        ${c.registration_number ? `Reg: ${escapeHtml(c.registration_number)}<br>` : ''}
        ${c.expiry_date ? `Expires: ${_pfDateFmt(c.expiry_date)}<br>` : ''}
        ${statusLabel}
        ${c.status === 'verified' ? `<br><span style="color:var(--ok);font-size:10.5px;">✓ Verified</span>` : ''}
      </div>
      ${scanBadge}
      <div class="cred-actions" onclick="event.stopPropagation();">
        ${isManager && c.status !== 'verified' ? `<button class="btn" onclick="pfVerifyCredential('${c.id}')">Verify</button>` : ''}
        ${isMine ? `<button class="btn" style="color:var(--danger);" onclick="pfDeleteCredential('${c.id}')">Remove</button>` : ''}
      </div>
    </div>`;
  }).join('');

  body.innerHTML = `<div class="cred-grid">${cards}</div>`;
}

function _pfCredTypeLabel(type) {
  return CRED_TYPE_LABELS[credCanonicalType(type)] || type || '—';
}

async function submitCredentialModal() {
  const credentialType   = document.getElementById('cred-type-modal').value;
  const credentialName   = document.getElementById('cred-name-modal').value.trim();
  const issuingBody      = document.getElementById('cred-issuer-modal').value.trim();
  const registrationNumber = document.getElementById('cred-regnum-modal').value.trim();
  const issueDate        = document.getElementById('cred-issue-modal').value;
  const expiryDate       = document.getElementById('cred-expiry-modal').value;
  const notes            = document.getElementById('cred-notes-modal').value.trim();
  const errBox           = document.getElementById('cred-modal-err');
  const btn              = document.getElementById('cred-submit-btn');

  errBox.style.display = 'none';
  if (!credentialName) { errBox.textContent = 'Credential name is required.'; errBox.style.display = ''; return; }
  if (!_credScan.add.documentId) {
    errBox.textContent = 'Upload the credential document before saving. The register keeps the evidence, not just the claim.';
    errBox.style.display = '';
    return;
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch('/api/profile/credentials', {
      method: 'POST', headers:{'Content-Type':'application/json'}, credentials: 'include',
      body: JSON.stringify({
        credentialType, credentialName,
        issuingBody:        issuingBody        || null,
        registrationNumber: registrationNumber || null,
        issueDate:          issueDate          || null,
        expiryDate:         expiryDate         || null,
        notes:              notes              || null,
        documentId:         _credScan.add.documentId,
        extractionId:       _credScan.add.extractionId || null,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Save failed');

    credCloseAddModal();
    showToast('Credential saved', credentialName);
    loadCredentialsSection();
  } catch (e) {
    errBox.textContent = e.message || 'Could not save credential.';
    errBox.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save credential';
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREDENTIAL SCANS — upload, read, review

   The shape of this, and why:

     1. The person uploads the certificate. It is stored immediately, before
        any credential exists, because the reader needs bytes and because a
        failed read should not cost them the upload.
     2. The page rasterises the first pages LOCALLY with the portal's own
        vendored pdf.js and sends those images alongside. The server has no
        canvas, and a photographed WWCC card has no text layer at all — so
        without this step the reader would have nothing to look at in exactly
        the case it exists for.
     3. The model PROPOSES values. They land in the form marked as proposals,
        with the reader's own confidence, and every one can be undone in a
        click. Nothing is saved until the person presses Save.

   Step 3 is the part to keep honest. A field silently filled by a model, and
   then saved, is a compliance date nobody chose.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Per-dialog scan state. `add` is the new-credential flow, `detail` the
 *  dialog opened from a card. */
var _credScan = {
  add:    { file: null, documentId: null, extractionId: null, mime: null, previewUrl: null },
  detail: { file: null, documentId: null, extractionId: null, mime: null, previewUrl: null },
};

/** Which input each proposed field lands in, per dialog. */
var CRED_FIELD_INPUTS = {
  add: {
    credential_type: 'cred-type-modal', credential_name: 'cred-name-modal',
    issuing_body: 'cred-issuer-modal', registration_number: 'cred-regnum-modal',
    issue_date: 'cred-issue-modal', expiry_date: 'cred-expiry-modal',
  },
  detail: {
    credential_type: 'credx-type', credential_name: 'credx-name',
    issuing_body: 'credx-issuer', registration_number: 'credx-regnum',
    issue_date: 'credx-issue', expiry_date: 'credx-expiry',
  },
};

var CRED_NOTE_PREFIX = { add: 'cred-note-', detail: 'credx-note-' };
var CRED_STATUS_BOX  = { add: 'cred-add-read-status', detail: 'credx-read-status' };
var CRED_MAX_SCAN_BYTES = 5 * 1024 * 1024;

function _credStatus(scope, kind, html) {
  const box = document.getElementById(CRED_STATUS_BOX[scope]);
  if (!box) return;
  if (!html) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.className = 'cred-read-status ' + kind;
  box.innerHTML = html;
  box.style.display = 'block';
}

// ── Rasterising, so the reader has something to look at ────────────────────

var _credPdfLib = null;
function _credLoadPdfJs() {
  if (_credPdfLib) return Promise.resolve(_credPdfLib);
  return import('/vendor/pdfjs/pdf.min.mjs').then(function (lib) {
    lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
    _credPdfLib = lib;
    return lib;
  });
}

/** Long edge of the images sent to the reader. Large enough that a licence
 *  number stays legible, small enough to stay well inside the upload budget. */
var CRED_RASTER_MAX = 1600;
var CRED_RASTER_PAGES = 2;

/** Longest we will wait for the browser to draw the pages. See below. */
var CRED_RASTER_TIMEOUT_MS = 20000;

function _credBlobToBase64(blob) {
  return new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function (e) { resolve(String(e.target.result).split(',')[1]); };
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

/**
 * A surface to draw a page on, and a way to get JPEG bytes back off it.
 *
 * OffscreenCanvas is preferred because nothing here is ever shown: these
 * pixels exist to be encoded and posted, so putting a canvas element in the
 * document to hold them buys nothing and costs a layout.
 *
 * It is NOT what makes a background tab work — pdf.js schedules its render
 * loop on requestAnimationFrame whatever surface it is given. That is handled
 * where the render task is created, by driving the loop directly.
 */
function _credMakeCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    return {
      canvas: canvas,
      ctx: canvas.getContext('2d'),
      toJpeg: function () {
        return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 }).then(_credBlobToBase64);
      },
    };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return {
    canvas: canvas,
    ctx: canvas.getContext('2d'),
    toJpeg: function () {
      return Promise.resolve(canvas.toDataURL('image/jpeg', 0.75).split(',')[1]);
    },
  };
}

/** PDF → page images, via the same pdf.js the document preview uses. */
async function _credPdfPageImages(file) {
  const lib = await _credLoadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await lib.getDocument({ data: new Uint8Array(buf) }).promise;
  const images = [];
  const pages = Math.min(pdf.numPages, CRED_RASTER_PAGES);
  for (let i = 1; i <= pages; i += 1) {
    const page = await pdf.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(CRED_RASTER_MAX / Math.max(base.width, base.height), 3);
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
    const surface = _credMakeCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    // A PDF page is transparent where it is "white". Without this the JPEG
    // comes out black and the reader sees nothing at all.
    surface.ctx.fillStyle = '#ffffff';
    surface.ctx.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
    // intent 'print' is not about printing. It is the one documented way to
    // get pdf.js to render WITHOUT scheduling each chunk on
    // requestAnimationFrame, which does not fire in a background tab — so a
    // person who uploads a certificate and switches tabs while it reads would
    // otherwise wait for ever. (`onContinue` does not help: the continuation
    // it hands you is the rAF scheduler itself.) The appearance difference is
    // nil for a scan and correct for a form: printed values, not editor
    // widgets.
    await page.render({ canvasContext: surface.ctx, viewport: viewport, intent: 'print' }).promise;
    images.push({ data: await surface.toJpeg(), mime: 'image/jpeg' });
  }
  try { pdf.destroy(); } catch (e) { /* best effort */ }
  return images;
}

/** Photograph or screenshot → one down-scaled image. */
async function _credImagePageImages(file) {
  const bitmap = typeof createImageBitmap === 'function'
    ? await createImageBitmap(file)
    : await new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')); };
      img.src = url;
    });

  const scale = Math.min(1, CRED_RASTER_MAX / Math.max(bitmap.width, bitmap.height));
  const surface = _credMakeCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale))
  );
  surface.ctx.fillStyle = '#ffffff';
  surface.ctx.fillRect(0, 0, surface.canvas.width, surface.canvas.height);
  surface.ctx.drawImage(bitmap, 0, 0, surface.canvas.width, surface.canvas.height);
  if (bitmap.close) bitmap.close();
  return [{ data: await surface.toJpeg(), mime: 'image/jpeg' }];
}

/**
 * The page images, or none.
 *
 * Bounded by a timeout on purpose. Rasterising is the one step here that can
 * stall rather than fail — an old browser without OffscreenCanvas, backgrounded
 * mid-upload, leaves pdf.js waiting on an animation frame that will not come.
 * "Opal could not read this one, please type the three fields" is a bad
 * outcome; a dialog that says "Reading the document…" for ever is a worse one,
 * because nobody can tell it from working.
 */
async function _credPageImages(file) {
  const timeout = new Promise(function (resolve) {
    setTimeout(function () { resolve('__timeout__'); }, CRED_RASTER_TIMEOUT_MS);
  });
  try {
    let work = null;
    if (file.type === 'application/pdf') work = _credPdfPageImages(file);
    else if (/^image\//.test(file.type)) work = _credImagePageImages(file);
    if (!work) return [];

    const result = await Promise.race([work, timeout]);
    if (result === '__timeout__') {
      console.warn('credential rasterise timed out — falling back to the text layer');
      return [];
    }
    return result;
  } catch (e) {
    // The upload still succeeded and the text layer may carry the day; a
    // rasterising failure is not a reason to lose the whole read.
    console.warn('credential rasterise failed', e);
    return [];
  }
}

function _credFileToBase64(file) {
  return new Promise(function (resolve, reject) {
    const fr = new FileReader();
    fr.onload = function (e) { resolve(e.target.result.split(',')[1]); };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

// ── Choosing a file ────────────────────────────────────────────────────────

function credOnScanDrop(event, scope) {
  event.preventDefault();
  event.currentTarget.classList.remove('dragover');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) credHandleScanFile(file, scope);
}

function credOnScanSelected(input, scope) {
  const file = input.files && input.files[0];
  input.value = '';
  if (file) credHandleScanFile(file, scope);
}

/**
 * Upload the chosen file, then read it.
 *
 * Upload and read are separate so a refusal from the reader — a tripped
 * guardrail, a model outage, a blurred photo — leaves the document attached
 * and the person typing three fields, which is exactly what they did before
 * this feature existed.
 */
async function credHandleScanFile(file, scope) {
  const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
  if (allowed.indexOf(file.type) === -1) {
    _credStatus(scope, 'err', 'That file type is not accepted. Upload a PDF, PNG or JPG of the document.');
    return;
  }
  if (file.size > CRED_MAX_SCAN_BYTES) {
    _credStatus(scope, 'err', 'That file is larger than 5 MB. A photo of the certificate is usually enough.');
    return;
  }

  const state = _credScan[scope];
  state.file = file;
  state.mime = file.type;
  _credStatus(scope, 'info', 'Uploading the document…');

  try {
    const fileData = await _credFileToBase64(file);
    const isDetail = scope === 'detail' && _credDetail;
    const url = isDetail
      ? `/api/profile/credentials/${_credDetail.id}/scan`
      : '/api/profile/credentials/scans';

    const r = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        fileName: file.name, fileMime: file.type, fileSizeBytes: file.size, fileData,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Upload failed');

    state.documentId = json.document.id;
    if (isDetail) {
      _credDetail = json.credential || _credDetail;
      _credDetail.document_id = json.document.id;
      _credDetail.document_file_name = file.name;
      _credDetail.document_mime = file.type;
      _credRenderScanPanel();
      if (json.verificationWithdrawn) {
        _credBanner('warn', 'The document changed, so the practice\u2019s verification has been withdrawn. Ask for it to be verified again.');
      }
    } else {
      document.getElementById('cred-add-dz-title').textContent = file.name;
      document.getElementById('cred-add-dz-sub').innerHTML =
        'Attached · <span style="color:var(--brand);">choose a different file</span>';
    }

    await credReadScan(scope);
  } catch (e) {
    _credStatus(scope, 'err', (e.message || 'The document could not be uploaded.'));
  }
}

// ── Reading it ─────────────────────────────────────────────────────────────

/**
 * Ask the server to read the stored scan, and put what comes back in front of
 * the person as a proposal.
 *
 * Every unhappy ending gets its own sentence. "Opal could not read this one"
 * and "Opal is switched off" and "the safety filter stopped it" are different
 * facts, and a single "something went wrong" would leave somebody retrying a
 * thing that cannot work.
 */
async function credReadScan(scope) {
  const state = _credScan[scope];
  if (!state.documentId) {
    _credStatus(scope, 'err', 'Upload the document first.');
    return;
  }

  _credStatus(scope, 'info', 'Reading the document…');
  const btn = scope === 'detail' ? document.getElementById('credx-read-btn') : null;
  if (btn) { btn.disabled = true; btn.textContent = 'Reading…'; }

  try {
    const pageImages = state.file ? await _credPageImages(state.file) : [];
    const typeInput = document.getElementById(CRED_FIELD_INPUTS[scope].credential_type);

    const r = await fetch(`/api/profile/credentials/scans/${state.documentId}/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        pageImages,
        credentialType: typeInput ? typeInput.value : null,
        credentialId: scope === 'detail' && _credDetail ? _credDetail.id : null,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'The document could not be read');

    state.extractionId = json.extractionId || null;

    if (json.status === 'refused') {
      _credStatus(scope, 'warn',
        'Opal was not permitted to read this document — the safety filter stopped it. ' +
        'The document is attached; please type the details below.');
      return;
    }
    if (json.status === 'unavailable' || json.status === 'failed') {
      _credStatus(scope, 'warn',
        'Opal could not read the document just now. It is attached; please type the details below.');
      return;
    }
    if (json.status !== 'proposed' || !json.fields || !Object.keys(json.fields).length) {
      _credStatus(scope, 'warn',
        'Opal could not make out the details on this one'
        + (json.notes ? ' — ' + escapeHtml(json.notes) : '')
        + '. The document is attached; please type the details below.');
      return;
    }

    const applied = credApplyProposal(scope, json.fields);
    const bits = [];
    bits.push(`<strong>Opal read ${applied} field${applied === 1 ? '' : 's'} from this document.</strong> Check each one — they are proposals, not facts.`);
    if (json.notes) bits.push(escapeHtml(json.notes));
    (json.warnings || []).forEach(w => bits.push('⚠ ' + escapeHtml(w)));
    _credStatus(scope, (json.warnings || []).length ? 'warn' : 'info', bits.join('<br>'));
  } catch (e) {
    _credStatus(scope, 'err', e.message || 'The document could not be read.');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Re-read this document'; }
  }
}

/**
 * Put the proposals into the form, marked as proposals.
 *
 * An existing value is never overwritten silently: if the person already typed
 * something, the proposal is offered beneath the field instead of replacing
 * what they wrote.
 */
function credApplyProposal(scope, fields) {
  const inputs = CRED_FIELD_INPUTS[scope];
  let applied = 0;

  Object.keys(inputs).forEach(function (key) {
    const el = document.getElementById(inputs[key]);
    const note = document.getElementById(CRED_NOTE_PREFIX[scope] + key);
    if (!el || !note) return;

    const proposal = fields[key];
    if (!proposal) { note.style.display = 'none'; note.innerHTML = ''; el.classList.remove('cred-proposed'); return; }

    const previous = el.value;
    const conflicts = previous && previous !== proposal.value;

    if (!conflicts) {
      el.value = proposal.value;
      el.classList.add('cred-proposed');
      applied += 1;
    }

    const conf = String(proposal.confidence || 'low');
    note.innerHTML = conflicts
      ? `Opal read <strong>${escapeHtml(proposal.value)}</strong> here
         <span class="conf ${conf}">${conf}</span>
         <button type="button" onclick="credUseProposal('${scope}','${key}','${encodeURIComponent(proposal.value)}')">use it</button>`
      : `Read from your document <span class="conf ${conf}">${conf}</span>
         <button type="button" onclick="credUndoProposal('${scope}','${key}','${encodeURIComponent(previous)}')">undo</button>`;
    note.style.display = 'flex';
  });

  return applied;
}

function credUseProposal(scope, key, encoded) {
  const el = document.getElementById(CRED_FIELD_INPUTS[scope][key]);
  if (!el) return;
  const previous = el.value;
  el.value = decodeURIComponent(encoded);
  el.classList.add('cred-proposed');
  const note = document.getElementById(CRED_NOTE_PREFIX[scope] + key);
  if (note) {
    note.innerHTML = `Read from your document
      <button type="button" onclick="credUndoProposal('${scope}','${key}','${encodeURIComponent(previous)}')">undo</button>`;
  }
}

function credUndoProposal(scope, key, encoded) {
  const el = document.getElementById(CRED_FIELD_INPUTS[scope][key]);
  if (!el) return;
  el.value = decodeURIComponent(encoded || '');
  el.classList.remove('cred-proposed');
  const note = document.getElementById(CRED_NOTE_PREFIX[scope] + key);
  if (note) { note.style.display = 'none'; note.innerHTML = ''; }
}

// ── The Add dialog ─────────────────────────────────────────────────────────

function credOpenAddModal() {
  _credScan.add = { file: null, documentId: null, extractionId: null, mime: null, previewUrl: null };
  ['cred-name-modal','cred-issuer-modal','cred-regnum-modal',
   'cred-issue-modal','cred-expiry-modal','cred-notes-modal'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) { el.value = ''; el.classList.remove('cred-proposed'); }
  });
  Object.keys(CRED_FIELD_INPUTS.add).forEach(function (key) {
    const note = document.getElementById('cred-note-' + key);
    if (note) { note.style.display = 'none'; note.innerHTML = ''; }
  });
  document.getElementById('cred-add-dz-title').textContent = 'Upload the credential document';
  document.getElementById('cred-add-dz-sub').innerHTML =
    'Click to choose a file, or drag it here · PDF, PNG or JPG · max 5&nbsp;MB';
  const addErr = document.getElementById('cred-modal-err');
  // Cleared, not just hidden. A hidden box that still holds "Credential name
  // is required" will show that message again the next time anything reveals
  // it, against a dialog where it is not true.
  addErr.textContent = '';
  addErr.style.display = 'none';
  _credStatus('add', 'info', '');
  showModal('modal-add-credential');
}

function credCloseAddModal() {
  // An uploaded scan that never became a credential is the person's own file
  // and stays theirs; it is invisible in the documents list until a credential
  // claims it, so nothing here needs cleaning up on screen.
  _credScan.add = { file: null, documentId: null, extractionId: null, mime: null, previewUrl: null };
  closeModal('modal-add-credential');
}

// ── The detail dialog ──────────────────────────────────────────────────────

var _credDetail = null;

function _credBanner(kind, html) {
  const el = document.getElementById('credx-banner');
  if (!el) return;
  if (!html) { el.style.display = 'none'; return; }
  const colours = {
    warn: 'background:#fff4e5;color:#92510a;',
    info: 'background:rgba(0,0,0,.04);color:var(--ink-soft);',
    ok:   'background:#eaf7ef;color:#1d6b3f;',
  };
  el.setAttribute('style', `font-size:12px;border-radius:8px;padding:9px 11px;margin-bottom:12px;${colours[kind] || colours.info}`);
  el.innerHTML = html;
}

function pfOpenCredential(id) {
  const cred = _credCache.filter(function (c) { return c.id === id; })[0];
  if (!cred) return;
  _credDetail = cred;
  _credScan.detail = {
    file: null, documentId: cred.document_id || null, extractionId: null,
    mime: cred.document_mime || null, previewUrl: null,
  };

  const isMine = cred.user_id === (window.APP_USER || {}).id;
  const isManager = ['owner','admin'].indexOf((window.APP_USER || {}).role) !== -1;

  document.getElementById('credx-heading').textContent = cred.credential_name || 'Credential';
  const detailErr = document.getElementById('credx-err');
  detailErr.textContent = '';
  detailErr.style.display = 'none';
  _credStatus('detail', 'info', '');

  const set = function (elId, value) {
    const el = document.getElementById(elId);
    if (el) { el.value = value == null ? '' : String(value); el.classList.remove('cred-proposed'); }
  };
  // Canonicalised before it reaches the select. A stored `ahpra` has no
  // option to match, and an unmatched value leaves a select showing its FIRST
  // option — which a save would then write, silently reclassifying somebody's
  // registration as whatever happens to be at the top of the list.
  const canonicalType = credCanonicalType(cred.credential_type);
  set('credx-type', CRED_TYPE_LABELS[canonicalType] ? canonicalType : 'other');
  set('credx-name', cred.credential_name);
  set('credx-issuer', cred.issuing_body);
  set('credx-regnum', cred.registration_number);
  set('credx-issue', (cred.issue_date || '').slice(0, 10));
  set('credx-expiry', (cred.expiry_date || '').slice(0, 10));
  set('credx-notes', cred.notes);

  Object.keys(CRED_FIELD_INPUTS.detail).forEach(function (key) {
    const note = document.getElementById('credx-note-' + key);
    if (note) { note.style.display = 'none'; note.innerHTML = ''; }
  });

  // The Owner reads and verifies; only the holder edits. The server enforces
  // this — the dialog just stops offering what would be refused.
  ['credx-type','credx-name','credx-issuer','credx-regnum','credx-issue','credx-expiry','credx-notes']
    .forEach(function (elId) {
      const el = document.getElementById(elId);
      if (el) el.disabled = !isMine;
    });
  document.getElementById('credx-save-btn').style.display = isMine ? '' : 'none';
  document.getElementById('credx-replace-btn').style.display = isMine ? '' : 'none';
  document.getElementById('credx-read-btn').style.display = isMine ? '' : 'none';
  document.getElementById('credx-remove-btn').style.display = isMine ? '' : 'none';
  document.getElementById('credx-verify-btn').style.display =
    (isManager && cred.status !== 'verified') ? '' : 'none';

  if (!isMine) {
    _credBanner('info', `This credential belongs to <strong>${escapeHtml(cred.user_display_name || cred.user_email || 'a colleague')}</strong>. You can read it and verify it; only they can change it.`);
  } else if (!cred.document_id) {
    _credBanner('warn', 'No document is attached to this credential yet. Upload the certificate so the record carries its evidence — Opal will read what it can from it.');
  } else {
    _credBanner('', '');
  }

  const bits = [];
  if (cred.status === 'verified') {
    bits.push(`✓ Verified${cred.verified_at ? ' on ' + _pfDateFmt(cred.verified_at) : ''}. Changing any detail below withdraws that verification.`);
  }
  const days = _pfCredDaysToExpiry(cred.expiry_date);
  if (days !== null && days < 0) bits.push('This credential has expired.');
  else if (days !== null && days <= 60) bits.push(`Expires in ${days} day${days === 1 ? '' : 's'}.`);
  document.getElementById('credx-status-line').textContent = bits.join(' ');

  _credRenderScanPanel();
  showModal('modal-credential-detail');
}

function _credRenderScanPanel() {
  const cred = _credDetail;
  const thumb = document.getElementById('credx-thumb');
  const meta = document.getElementById('credx-scan-meta');
  const viewBtn = document.getElementById('credx-view-btn');
  const readBtn = document.getElementById('credx-read-btn');
  if (!cred || !thumb) return;

  const has = Boolean(cred.document_id);
  viewBtn.disabled = !has;
  readBtn.disabled = !has;
  document.getElementById('credx-replace-btn').textContent = has ? 'Replace document' : 'Upload document';

  if (!has) {
    thumb.innerHTML = 'No document attached';
    meta.textContent = '';
    return;
  }

  const url = `/api/profile/documents/${cred.document_id}/download`;
  if (/^image\//.test(cred.document_mime || '')) {
    thumb.innerHTML = `<img src="${url}" alt="Scan of ${escapeHtml(cred.credential_name || 'the credential')}" />`;
  } else {
    thumb.innerHTML = '<div style="text-align:center;">PDF document<br><span style="font-size:10.5px;">Open it with View document</span></div>';
  }
  meta.innerHTML = escapeHtml(cred.document_file_name || 'Attached document')
    + (cred.document_size_bytes ? ` · ${Math.round(cred.document_size_bytes / 1024)} KB` : '');
}

function credViewScan() {
  const cred = _credDetail;
  if (!cred || !cred.document_id) return;
  const url = `/api/profile/documents/${cred.document_id}/download`;
  if (/^image\//.test(cred.document_mime || '')) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  if (window.DocPreview) {
    DocPreview.open({
      kind: 'pdf', url: url, downloadUrl: url,
      title: cred.credential_name || 'Credential document',
      meta: cred.document_file_name || '',
    });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

async function credSaveDetail() {
  const cred = _credDetail;
  if (!cred) return;
  const errBox = document.getElementById('credx-err');
  const btn = document.getElementById('credx-save-btn');
  const val = function (id) { const el = document.getElementById(id); return el ? el.value.trim() : ''; };

  errBox.style.display = 'none';
  const credentialName = val('credx-name');
  if (!credentialName) {
    errBox.textContent = 'Credential name is required.';
    errBox.style.display = '';
    return;
  }

  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const r = await fetch(`/api/profile/credentials/${cred.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({
        credentialType:     val('credx-type'),
        credentialName:     credentialName,
        issuingBody:        val('credx-issuer') || null,
        registrationNumber: val('credx-regnum') || null,
        issueDate:          val('credx-issue') || null,
        expiryDate:         val('credx-expiry') || null,
        notes:              val('credx-notes') || null,
        extractionId:       _credScan.detail.extractionId || null,
      }),
    });
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || 'Save failed');

    credCloseDetail();
    showToast('Credential updated', json.verificationWithdrawn
      ? 'Verification withdrawn — the details changed'
      : credentialName);
    loadCredentialsSection();
  } catch (e) {
    errBox.textContent = e.message || 'Could not save this credential.';
    errBox.style.display = '';
  } finally {
    btn.disabled = false; btn.textContent = 'Save changes';
  }
}

async function credVerifyFromDetail() {
  if (!_credDetail) return;
  const id = _credDetail.id;
  credCloseDetail();
  await pfVerifyCredential(id);
}

async function credRemoveFromDetail() {
  if (!_credDetail) return;
  const id = _credDetail.id;
  credCloseDetail();
  await pfDeleteCredential(id);
}

function credCloseDetail() {
  _credDetail = null;
  _credScan.detail = { file: null, documentId: null, extractionId: null, mime: null, previewUrl: null };
  closeModal('modal-credential-detail');
}

async function pfVerifyCredential(id) {
  try {
    const r = await fetch(`/api/profile/credentials/${id}/verify`, { method:'PATCH', credentials:'include' });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('Credential verified', '');
    loadCredentialsSection();
  } catch (e) { showToast('Error', e.message || 'Could not verify credential.', 'error'); }
}

async function pfDeleteCredential(id) {
  if (!await portalConfirm('Remove this credential?', { danger: true })) return;
  try {
    const r = await fetch(`/api/profile/credentials/${id}`, { method:'DELETE', credentials:'include' });
    if (!r.ok) throw new Error((await r.json()).error);
    showToast('Credential removed', '');
    loadCredentialsSection();
  } catch (e) { showToast('Error', e.message || 'Could not remove credential.', 'error'); }
}

// ── Tab switcher (shared) ──────────────────────────────────────────────────

function _pfSwitchTab(btn, panelId) {
  const container = btn.closest('.pf-tabs');
  if (!container) return;
  container.querySelectorAll('.pf-tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Find sibling panes
  const parent = container.parentElement;
  parent.querySelectorAll('.pf-tab-pane').forEach(p => p.classList.remove('active'));
  const pane = parent.querySelector('#' + panelId);
  if (pane) pane.classList.add('active');
}

// ── Wire all loaders into loadProfileView ─────────────────────────────────

// Patch the existing loadProfileView to also trigger data sections
const _origLoadProfileView = typeof loadProfileView === 'function' ? loadProfileView : () => {};
window.loadProfileView = function() {
  _origLoadProfileView();
  loadLeaveSection();
  loadCPDSection();
  loadPDDocumentsSection();
  loadCredentialsSection();
  loadWorkSchedule();
  loadNotificationPrefs();
};

// ── Work schedule + travel bases persistence ──────────────────────────────

var _wlSaveTimer = null;
var _wlSaveIndicatorTimer = null;

function _wlShowSaved() {
  var lbl = document.getElementById('wl-week-label');
  if (!lbl) return;
  var prev = lbl.textContent;
  lbl.textContent = '✓ Locations saved';
  clearTimeout(_wlSaveIndicatorTimer);
  _wlSaveIndicatorTimer = setTimeout(function() {
    if (typeof renderWorkLocationEditor === 'function') renderWorkLocationEditor();
  }, 1800);
}

async function saveWorkSchedule() {
  try {
    var payload = {
      workLocationSchedule: typeof WORK_LOCATION !== 'undefined' ? WORK_LOCATION : null,
      travelBases:          typeof WORK_BASES    !== 'undefined' ? WORK_BASES    : null,
    };
    var r = await fetch('/api/profile/work-schedule', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    if (r.ok) _wlShowSaved();
  } catch (e) {
    console.warn('Work schedule save failed:', e.message);
  }
}

function debouncedSaveWorkSchedule() {
  clearTimeout(_wlSaveTimer);
  _wlSaveTimer = setTimeout(saveWorkSchedule, 900);
}

async function loadWorkSchedule() {
  try {
    var r = await fetch('/api/profile/work-schedule', { credentials: 'include' });
    if (!r.ok) return;
    var data = await r.json();
    var workLocationSchedule = data.workLocationSchedule;
    var travelBases = data.travelBases;

    // Populate WORK_LOCATION from backend
    if (workLocationSchedule && typeof workLocationSchedule === 'object') {
      Object.assign(WORK_LOCATION, workLocationSchedule);
    }

    // Populate WORK_BASES from backend (only if data exists)
    if (travelBases && typeof travelBases === 'object') {
      if (travelBases.office) {
        Object.assign(WORK_BASES.office, travelBases.office);
        // The office is "coming soon" (no office yet): show any saved value
        // greyed out, keep the field disabled, and leave the hint as is.
        var addrEl = document.getElementById('wb-office-addr');
        if (addrEl && travelBases.office.addr) addrEl.value = travelBases.office.addr;
        if (typeof wireBaseAddressAutocomplete === 'function') wireBaseAddressAutocomplete();
      }
      if (Array.isArray(travelBases.homes) && travelBases.homes.length) {
        WORK_BASES.homes = travelBases.homes;
      }
    }

    // Re-render with real data
    if (typeof renderWorkLocationEditor === 'function') renderWorkLocationEditor();
    if (typeof renderHomeBases          === 'function') renderHomeBases();
    if (typeof refreshAlarm             === 'function') refreshAlarm();
    // The bases and the week's day locations just arrived: legs that were
    // drawn from defaults are redrawn from the real anchors.
    Object.values(window.SESSIONS || {}).forEach(function (s) { delete s.__loc; });
    if (typeof refreshAllOverlays === 'function') refreshAllOverlays();
  } catch (e) {
    console.warn('loadWorkSchedule error:', e.message);
  }
}

// ── Notification preferences persistence ──────────────────────────────────

var NOTIF_PREF_IDS = {
  locationAlarm:  'alarm-location',
  planExpiry:     'alarm-plan-expiry',
  cancellation:   'alarm-cancellation',
  weeklyDigest:   'alarm-weekly-digest',
  cpdReminder:    'alarm-cpd-reminder',
};

async function saveNotificationPref(key, value) {
  try {
    await fetch('/api/profile/notification-prefs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ [key]: value }),
    });
  } catch (e) {
    console.warn('saveNotificationPref error:', e.message);
  }
}

async function loadNotificationPrefs() {
  try {
    var r = await fetch('/api/profile/notification-prefs', { credentials: 'include' });
    if (!r.ok) return;
    var data = await r.json();
    var prefs = data.prefs;
    if (!prefs) return;
    for (var key in NOTIF_PREF_IDS) {
      if (typeof prefs[key] !== 'boolean') continue;
      var el = document.getElementById(NOTIF_PREF_IDS[key]);
      if (el) el.checked = prefs[key];
    }
    // Sync the alarm-enabled state used by refreshAlarm()
    var locEl = document.getElementById('alarm-location');
    if (locEl) {
      alarmEnabled = locEl.checked;
      if (typeof refreshAlarm === 'function') refreshAlarm();
    }
  } catch (e) {
    console.warn('loadNotificationPrefs error:', e.message);
  }
}

/* ── Profile dashboard ↔ focused-area navigation (2026-08-06 redesign) ────
   The dashboard shows seven area cards; opening one reveals only that
   section inside #pf-area-host. All section ids/loaders are unchanged. */
const PF_AREA_IDS = ['pf-details', 'pf-location', 'pf-leave', 'pf-cpd', 'pf-pddocs', 'pf-credentials', 'pf-alerts'];

function pfAreaTitle(id) {
  if (id === 'pf-leave')  return (document.getElementById('pf-nav-leave-label') || {}).textContent || 'Leave';
  if (id === 'pf-cpd')    return (document.getElementById('pf-nav-cpd-label') || {}).textContent || 'Professional development';
  return { 'pf-details': 'Personal Details', 'pf-location': 'Work Locations',
           'pf-pddocs': 'Professional Development Documents',
           'pf-credentials': 'Credentials', 'pf-alerts': 'Notifications' }[id] || '';
}

function pfOpenArea(id) {
  const dash = document.getElementById('pf-dashboard');
  const host = document.getElementById('pf-area-host');
  if (!dash || !host) return;
  PF_AREA_IDS.forEach(function (sid) {
    const el = document.getElementById(sid);
    if (el) el.style.display = (sid === id) ? '' : 'none';
  });
  const title = document.getElementById('pf-area-title');
  if (title) title.textContent = pfAreaTitle(id);
  dash.style.display = 'none';
  host.style.display = '';
  window.scrollTo({ top: 0 });
}

function pfBackToDashboard() {
  const dash = document.getElementById('pf-dashboard');
  const host = document.getElementById('pf-area-host');
  if (dash) dash.style.display = '';
  if (host) host.style.display = 'none';
}

/* Legacy alias — older callers scrolled to a section; they now open it. */
function scrollToProfile(id) { pfOpenArea(id); }

function loadProfileView() {
  loadSetupStatusCard();
  const u = window.APP_USER;
  if (!u) return; // auth not yet resolved

  // ── Sidebar identity ─────────────────────────────────
  const displayName = u.displayName || u.name || u.email;
  const initials = displayName
    .split(/\s+/).map(w => w.replace(/[^\p{L}]/gu, '')).filter(Boolean).slice(0, 2)
    .map(w => w[0].toUpperCase()).join('') || '?';

  const el = id => document.getElementById(id);

  el('pf-avatar').textContent = initials;
  el('pf-name').textContent   = displayName;

  const roleBadgeText = { owner: 'Practice Owner', admin: 'Administrator', therapist: 'Therapist' }[u.role] || u.role;
  const treatingLabel = u.isTreatingTherapist ? ' · Treating' : '';
  el('pf-role-line').textContent = (u.roleTitle ? u.roleTitle + ' · ' : '') + roleBadgeText + treatingLabel;
  el('pf-meta').textContent = u.email;

  // ── Details grid (read view) ─────────────────────────
  const grid = el('pf-details-grid');
  if (grid) {
    const row = (k, v) => `<div class="field"><div class="k">${k}</div><div class="v">${v || '<span style="color:var(--muted)">—</span>'}</div></div>`;
    grid.innerHTML =
      row('Full name',     u.name || u.email.split('@')[0]) +
      row('Display name',  u.displayName) +
      row('Email',         `<a href="mailto:${u.email}" style="color:var(--accent)">${u.email}</a>`) +
      row('Phone',         u.phone) +
      row('Job title',     u.roleTitle) +
      row('App role',      roleBadgeText + treatingLabel) +
      row('Outlook sync',  u.hasOutlookConnected ? '<span style="color:var(--ok)">Connected</span>' : '<span style="color:var(--muted)">Not connected</span>') +
      row('Profile status', u.profileCompleted ? '<span style="color:var(--ok)">Complete</span>' : '<span style="color:var(--warn)">Incomplete</span>');
  }
}

function toggleProfileEdit(editing) {
  const u = window.APP_USER;
  document.getElementById('pf-details-read').style.display = editing ? 'none' : '';
  document.getElementById('pf-details-form').style.display = editing ? '' : 'none';
  document.getElementById('pf-edit-btn').style.display     = editing ? 'none' : '';
  document.getElementById('pf-form-error').style.display = 'none';

  if (editing && u) {
    document.getElementById('pf-input-displayname').value = u.displayName || '';
    document.getElementById('pf-input-roletitle').value   = u.roleTitle   || '';
    document.getElementById('pf-input-phone').value       = u.phone       || '';
    document.getElementById('pf-input-email').value       = u.email       || '';
  }
}

async function saveProfileDetails(e) {
  e.preventDefault();
  const errBox = document.getElementById('pf-form-error');
  const btn    = document.getElementById('pf-save-btn');
  errBox.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving…';

  const payload = {
    displayName: document.getElementById('pf-input-displayname').value.trim() || null,
    roleTitle:   document.getElementById('pf-input-roletitle').value.trim()   || null,
    phone:       document.getElementById('pf-input-phone').value.trim()       || null,
  };

  try {
    const r = await fetch('/api/auth/complete-profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(json.error || 'Save failed');

    // Merge updates back into APP_USER
    if (json.user) {
      window.APP_USER = { ...window.APP_USER, ...json.user };
    } else {
      // Patch locally if API didn't return full profile
      window.APP_USER = { ...window.APP_USER, ...payload };
    }

    // Re-render read view with updated data
    loadProfileView();
    toggleProfileEdit(false);
    const banner = document.getElementById('pf-save-banner');
    if (banner) {
      banner.textContent = 'Profile updated successfully.';
      banner.style.display = '';
      setTimeout(() => { banner.style.display = 'none'; }, 3000);
    }
  } catch (err) {
    errBox.textContent = err.message;
    errBox.style.display = '';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
}
