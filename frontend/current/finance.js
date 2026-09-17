/* Finance portal (owner-only) — Dashboard · Payroll · Invoicing.
   Reads /api/finance/* only. The backend enforces owner-only on every route;
   this file hides nothing that matters and writes nothing to Xero. Invoice
   drafting stays on the Accounting tab behind its fail-closed flags. */
(function () {
  'use strict';

  var state = { loaded: {}, currency: 'AUD' };

  function esc(s) { return typeof window.escapeHtml === 'function' ? window.escapeHtml(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, ccy) {
    if (n == null || isNaN(Number(n))) return '—';
    try { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: ccy || state.currency || 'AUD' }).format(Number(n)); }
    catch (_) { return (ccy || 'AUD') + ' ' + Number(n).toFixed(2); }
  }
  function date(d) {
    if (!d) return '—';
    var t = new Date(d);
    return isNaN(t.getTime()) ? esc(d) : t.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function monthLabel(ym) {
    var p = String(ym || '').split('-');
    if (p.length < 2) return esc(ym);
    return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-AU', { month: 'short' });
  }
  async function get(path) {
    var r = await fetch('/api/finance' + path, { credentials: 'include' });
    if (r.status === 401 || r.status === 403) return { _denied: true, status: r.status };
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) j._error = j.error || ('HTTP ' + r.status);
    return j;
  }
  function body(id) { return document.getElementById('fin-' + id + '-body'); }
  function denied(el) { el.innerHTML = '<div class="fin-note">You do not have access to this area. Finance is available to the practice owner only.</div>'; }
  function warnings(list) { return (list || []).map(function (w) { return '<div class="fin-warn">' + esc(w) + '</div>'; }).join(''); }
  function card(lbl, val, hint, cls) {
    return '<div class="fin-card ' + (cls || '') + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>';
  }
  function pill(status) {
    var s = String(status || '').toLowerCase();
    var cls = s === 'paid' || s === 'posted' ? s : (s === 'overdue' ? 'overdue' : (s === 'draft' ? 'draft' : ''));
    return '<span class="fin-pill ' + cls + '">' + esc(status || '—') + '</span>';
  }

  // ── Status line ─────────────────────────────────────────────────────────
  async function renderStatus() {
    var el = document.getElementById('fin-status-line');
    if (!el) return;
    var s = await get('/status');
    if (s._denied) { el.textContent = 'Owner only.'; return; }
    state.currency = (s.accounting && s.accounting.baseCurrency) || 'AUD';
    var parts = [];
    parts.push(s.accounting && s.accounting.connected
      ? 'Xero accounting: connected to ' + esc(s.accounting.organisation || 'your organisation')
      : 'Xero accounting: <strong>not connected</strong> — connect it under Xero settings');
    parts.push(s.payroll && s.payroll.connected
      ? 'Xero Payroll: connected'
      : 'Xero Payroll: <strong>not connected</strong>' + (s.payroll && s.payroll.configured ? '' : ' (not configured on this server)'));
    el.innerHTML = parts.join(' · ');
  }

  // ── Dashboard ───────────────────────────────────────────────────────────
  function bars(series) {
    if (!series || !series.length) return '<div class="fin-empty">No invoices or bills in the last six months yet. Run a Xero sync from the Accounting tab.</div>';
    var max = 0;
    series.forEach(function (m) { max = Math.max(max, m.revenue, m.expenses); });
    if (!max) max = 1;
    return '<div class="fin-bars">' + series.map(function (m) {
      return '<div class="fin-bar" title="' + esc(m.month) + ': in ' + esc(money(m.revenue)) + ', out ' + esc(money(m.expenses)) + '">' +
        '<div class="cols"><div class="col" style="height:' + Math.round(100 * m.revenue / max) + '%"></div><div class="col exp" style="height:' + Math.round(100 * m.expenses / max) + '%"></div></div>' +
        '<div class="m">' + monthLabel(m.month) + '</div></div>';
    }).join('') + '</div><div class="fin-legend"><span><i></i>Invoiced</span><span><i class="exp"></i>Bills</span></div>';
  }

  async function renderDashboard() {
    var el = body('dashboard');
    if (!el) return;
    el.innerHTML = '<div class="fin-note">Loading dashboard…</div>';
    var d = await get('/dashboard');
    if (d._denied) return denied(el);
    if (d._error) { el.innerHTML = '<div class="fin-warn">' + esc(d._error) + '</div>'; return; }
    if (!d.connected) {
      el.innerHTML = '<div class="fin-note">Connect Xero to see revenue, expenses and recurring costs here. Open <a href="#" onclick="finOpenAccounting();return false;">Xero settings</a> to connect.</div>';
      return;
    }
    state.currency = d.currency || state.currency;
    var f = d.financials;
    var html = warnings(d.warnings);
    html += '<div class="fin-cards">' +
      card('Invoiced this month', money(f.month.revenue)) +
      card('Bills this month', money(f.month.expenses)) +
      card('Net this month', money(f.month.net), null, f.month.net < 0 ? 'warn' : 'good') +
      card('Owed to you', money(f.receivable.outstanding), f.receivable.overdue > 0 ? '<span class="fin-pill overdue">' + esc(money(f.receivable.overdue)) + ' overdue</span>' : 'Nothing overdue', f.receivable.overdue > 0 ? 'warn' : '') +
      card('You owe', money(f.payable.outstanding), f.payable.billsOverdue > 0 ? '<span class="fin-pill overdue">' + f.payable.billsOverdue + ' bill' + (f.payable.billsOverdue === 1 ? '' : 's') + ' overdue</span>' : (f.payable.billsUnpaid + ' unpaid bill' + (f.payable.billsUnpaid === 1 ? '' : 's')), f.payable.billsOverdue > 0 ? 'warn' : '') +
      '</div>';
    html += '<div class="fin-panel"><h3>Money in and out — last six months</h3>' + bars(f.series) + '</div>';
    html += '<div class="fin-grid">';
    html += '<div class="fin-panel"><h3>Recurring expenses</h3>';
    if (d.recurring && d.recurring.length) {
      html += '<table class="fin-table"><thead><tr><th>Supplier</th><th>Every</th><th>Next</th><th class="num">Amount</th></tr></thead><tbody>' +
        d.recurring.map(function (r) {
          return '<tr><td>' + esc(r.contact || '—') + (r.reference ? '<div class="hint" style="font-size:11px;color:var(--muted)">' + esc(r.reference) + '</div>' : '') + '</td><td>' + esc(r.period || '—') + '</td><td>' + date(r.nextDate) + '</td><td class="num">' + esc(money(r.total, r.currency)) + '</td></tr>';
        }).join('') + '</tbody></table>';
      var monthly = d.recurring.reduce(function (s, r) {
        var m = /^(\d+)\s+(\w+)/.exec(r.period || '');
        if (!m) return s;
        var n = Number(m[1]) || 1, unit = m[2];
        var perMonth = unit.indexOf('week') === 0 ? (52 / 12) / n : (unit.indexOf('month') === 0 ? 1 / n : 0);
        return s + r.total * perMonth;
      }, 0);
      html += '<div class="fin-note" style="margin-top:10px;margin-bottom:0">About ' + esc(money(monthly)) + ' per month across ' + d.recurring.length + ' repeating bill' + (d.recurring.length === 1 ? '' : 's') + ' set up in Xero.</div>';
    } else {
      html += '<div class="fin-empty">No repeating bills are set up in Xero. Add them in Xero under Bills → Repeating and they will appear here.</div>';
    }
    html += '</div>';
    html += '<div class="fin-panel"><h3>Top suppliers — six months</h3>';
    html += f.topSuppliers.length
      ? '<table class="fin-table"><thead><tr><th>Supplier</th><th class="num">Bills</th><th class="num">Total</th></tr></thead><tbody>' +
        f.topSuppliers.map(function (s) { return '<tr><td>' + esc(s.name) + '</td><td class="num">' + s.bills + '</td><td class="num">' + esc(money(s.total)) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<div class="fin-empty">No bills synced yet.</div>';
    html += '</div></div>';
    if (d.profitAndLoss && d.profitAndLoss.rows && d.profitAndLoss.rows.length) {
      html += '<div class="fin-panel"><h3>' + esc(d.profitAndLoss.title) + '</h3><table class="fin-table"><tbody>' +
        d.profitAndLoss.rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="num">' + esc(money(r.value)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }
    html += '<div class="fin-panel"><h3>Recent bills</h3>';
    html += f.recentBills.length
      ? '<table class="fin-table"><thead><tr><th>Date</th><th>Supplier</th><th>Reference</th><th>Status</th><th>Due</th><th class="num">Total</th><th class="num">Owing</th></tr></thead><tbody>' +
        f.recentBills.map(function (b) {
          var overdue = b.status === 'AUTHORISED' && b.amount_due > 0 && b.due_date && new Date(b.due_date) < new Date();
          return '<tr><td>' + date(b.invoice_date) + '</td><td>' + esc(b.contact_name || '—') + '</td><td>' + esc(b.invoice_number || b.reference || '—') + '</td><td>' + pill(overdue ? 'OVERDUE' : b.status) + '</td><td>' + date(b.due_date) + '</td><td class="num">' + esc(money(b.total)) + '</td><td class="num">' + esc(money(b.amount_due)) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="fin-empty">No bills synced yet.</div>';
    html += '</div>';
    el.innerHTML = html;
  }

  // ── Payroll ─────────────────────────────────────────────────────────────
  async function renderPayroll() {
    var el = body('payroll');
    if (!el) return;
    el.innerHTML = '<div class="fin-note">Loading payroll…</div>';
    var d = await get('/payroll/overview');
    if (d._denied) return denied(el);
    if (d._error) { el.innerHTML = '<div class="fin-warn">' + esc(d._error) + '</div>'; return; }
    if (!d.connected) {
      el.innerHTML = '<div class="fin-note">' + (d.configured
        ? 'Xero Payroll could not be reached: ' + esc(d.reason || 'unknown reason') + '.'
        : 'Xero Payroll is not configured on this server. The payroll Custom Connection (client id and secret) needs to be set before pay runs can be shown.') + '</div>';
      return;
    }
    var latest = d.payRuns && d.payRuns[0];
    var html = warnings(d.warnings);
    html += '<div class="fin-cards">' +
      card('Employees in Xero Payroll', d.employees ? String(d.employees.active) : '—', d.employees ? (d.employees.total - d.employees.active) + ' terminated' : '') +
      card('Pay calendars', String((d.calendars || []).length), (d.calendars || []).map(function (c) { return esc(c.name); }).join(', ')) +
      card('Latest pay run', latest ? money(latest.netPay) : '—', latest ? esc(latest.calendarName || '') + ' · ' + pill(latest.status) + ' · paid ' + date(latest.paymentDate) : 'No pay runs yet') +
      card('Super in latest run', latest ? money(latest.super) : '—', latest ? 'PAYG ' + esc(money(latest.tax)) : '') +
      '</div>';
    html += '<div class="fin-panel"><h3>Pay runs</h3>';
    html += (d.payRuns && d.payRuns.length)
      ? '<table class="fin-table"><thead><tr><th>Period</th><th>Calendar</th><th>Status</th><th>Payment date</th><th class="num">Wages</th><th class="num">Tax</th><th class="num">Super</th><th class="num">Net pay</th></tr></thead><tbody>' +
        d.payRuns.map(function (r) {
          return '<tr class="clickable" onclick="finOpenPayRun(\'' + esc(r.id) + '\')"><td>' + date(r.periodStart) + ' – ' + date(r.periodEnd) + '</td><td>' + esc(r.calendarName || '') + '</td><td>' + pill(r.status) + '</td><td>' + date(r.paymentDate) + '</td><td class="num">' + esc(money(r.wages)) + '</td><td class="num">' + esc(money(r.tax)) + '</td><td class="num">' + esc(money(r.super)) + '</td><td class="num">' + esc(money(r.netPay)) + '</td></tr>';
        }).join('') + '</tbody></table><div id="fin-payrun-drawer"></div>'
      : '<div class="fin-empty">No pay runs found for these calendars.</div>';
    html += '</div>';
    html += '<div class="fin-panel"><h3>Employees</h3>';
    html += (d.employees && d.employees.list.length)
      ? '<table class="fin-table"><thead><tr><th>Name</th><th>Status</th><th>Pay calendar</th></tr></thead><tbody>' +
        d.employees.list.map(function (e) {
          var cal = (d.calendars || []).filter(function (c) { return c.id === e.calendarId; })[0];
          return '<tr><td>' + esc(e.name) + '</td><td>' + pill(e.status) + '</td><td>' + esc(cal ? cal.name : '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="fin-empty">No active employees in Xero Payroll. New starters are added through Onboarding → Payroll &amp; Xero setup.</div>';
    html += '</div>';
    html += '<div class="fin-note">Pay runs are created, reviewed and posted in Xero. This page reads them; it never changes them.</div>';
    el.innerHTML = html;
  }

  window.finOpenPayRun = async function (id) {
    var host = document.getElementById('fin-payrun-drawer');
    if (!host) return;
    host.innerHTML = '<div class="fin-drawer">Loading pay run…</div>';
    var d = await get('/payroll/pay-runs/' + encodeURIComponent(id));
    if (d._denied) return denied(host);
    if (d._error) { host.innerHTML = '<div class="fin-warn">' + esc(d._error) + '</div>'; return; }
    var r = d.payRun;
    host.innerHTML = '<div class="fin-drawer"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;"><strong>' +
      date(r.periodStart) + ' – ' + date(r.periodEnd) + ' · ' + pill(r.status) + '</strong><button class="btn" onclick="document.getElementById(\'fin-payrun-drawer\').innerHTML=\'\'">Close</button></div>' +
      (d.payslips.length
        ? '<table class="fin-table"><thead><tr><th>Employee</th><th class="num">Wages</th><th class="num">Tax</th><th class="num">Super</th><th class="num">Deductions</th><th class="num">Net pay</th></tr></thead><tbody>' +
          d.payslips.map(function (p) { return '<tr><td>' + esc(p.name) + '</td><td class="num">' + esc(money(p.wages)) + '</td><td class="num">' + esc(money(p.tax)) + '</td><td class="num">' + esc(money(p.super)) + '</td><td class="num">' + esc(money(p.deductions)) + '</td><td class="num">' + esc(money(p.netPay)) + '</td></tr>'; }).join('') +
          '</tbody></table>'
        : '<div class="fin-empty">No payslips in this pay run.</div>') + '</div>';
  };

  // ── Invoicing ───────────────────────────────────────────────────────────
  var PIPELINE_LABELS = {
    draft_candidate: 'Drafted from Splose', ready_for_review: 'Ready for review', needs_mapping: 'Needs contact mapping',
    needs_pricing: 'Needs pricing', approved: 'Approved', invoiced: 'Sent to Xero', rejected: 'Rejected', skipped: 'Skipped',
  };

  async function renderInvoicing(status) {
    var el = body('invoicing');
    if (!el) return;
    el.innerHTML = '<div class="fin-note">Loading invoicing…</div>';
    var d = await get('/invoicing/summary' + (status ? '?status=' + encodeURIComponent(status) : ''));
    if (d._denied) return denied(el);
    if (d._error) { el.innerHTML = '<div class="fin-warn">' + esc(d._error) + '</div>'; return; }
    var html = '';
    var o = d.overview;
    if (d.connected && o) {
      html += '<div class="fin-cards">' +
        card('Invoiced this month', money(o.revenueThisMonth)) +
        card('Outstanding', money(o.outstandingBalance), o.invoices.overdue > 0 ? '<span class="fin-pill overdue">' + o.invoices.overdue + ' overdue</span>' : o.invoices.unpaid + ' unpaid', o.invoices.overdue > 0 ? 'warn' : '') +
        card('Drafts in Xero', String(o.invoices.draft)) +
        card('Average invoice', money(o.averageInvoiceValue)) +
        card('Awaiting invoicing', String(o.uninvoicedCandidates), (o.candidatesNeedingMapping + o.candidatesNeedingPricing) > 0 ? (o.candidatesNeedingMapping + ' need mapping · ' + o.candidatesNeedingPricing + ' need pricing') : 'From Splose appointments') +
        '</div>';
    } else {
      html += '<div class="fin-note">Connect Xero to see invoices here. Open <a href="#" onclick="finOpenAccounting();return false;">Xero settings</a> to connect.</div>';
    }
    html += '<div class="fin-grid">';
    html += '<div class="fin-panel"><h3>Splose → Xero pipeline</h3>';
    html += (d.pipeline && d.pipeline.length)
      ? '<table class="fin-table"><thead><tr><th>Stage</th><th class="num">Appointments</th><th class="num">Value</th></tr></thead><tbody>' +
        d.pipeline.map(function (p) { return '<tr><td>' + esc(PIPELINE_LABELS[p.status] || p.status) + '</td><td class="num">' + p.count + '</td><td class="num">' + esc(money(p.amount)) + '</td></tr>'; }).join('') + '</tbody></table>'
      : '<div class="fin-empty">No invoice candidates yet. Generate them from completed Splose appointments on the Accounting tab.</div>';
    html += '<div class="fin-note" style="margin-top:10px;margin-bottom:0">Review, price and draft candidates on the Accounting tab. ' +
      (d.flags && d.flags.xeroWrite ? 'Draft invoice creation is enabled.' : 'Writing to Xero is switched off on this server, so nothing leaves the portal until it is turned on.') + '</div>';
    html += '<div style="margin-top:10px"><button class="btn" onclick="finOpenAccounting(\'candidates\')">Open invoice candidates</button></div>';
    html += '</div>';
    html += '<div class="fin-panel"><h3>Invoices in Xero</h3>';
    html += '<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap">' +
      [['', 'All'], ['DRAFT', 'Draft'], ['AUTHORISED', 'Awaiting payment'], ['PAID', 'Paid']].map(function (f) {
        return '<button class="btn" style="font-size:12px' + ((status || '') === f[0] ? ';font-weight:700' : '') + '" onclick="finFilterInvoices(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join('') + '</div>';
    html += (d.invoices && d.invoices.length)
      ? '<table class="fin-table"><thead><tr><th>Number</th><th>Client / payer</th><th>Date</th><th>Status</th><th class="num">Total</th><th class="num">Owing</th></tr></thead><tbody>' +
        d.invoices.map(function (i) {
          var overdue = i.status === 'AUTHORISED' && i.amount_due > 0 && i.due_date && new Date(i.due_date) < new Date();
          return '<tr><td>' + esc(i.invoice_number || '—') + '</td><td>' + esc(i.contact_name || '—') + '</td><td>' + date(i.invoice_date) + '</td><td>' + pill(overdue ? 'OVERDUE' : i.status) + '</td><td class="num">' + esc(money(i.total, i.currency_code)) + '</td><td class="num">' + esc(money(i.amount_due, i.currency_code)) + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="fin-empty">' + (d.connected ? 'No invoices match.' : 'Not connected.') + '</div>';
    html += '</div></div>';
    el.innerHTML = html;
  }

  window.finFilterInvoices = function (status) { renderInvoicing(status || ''); };

  // ── Navigation ──────────────────────────────────────────────────────────
  function load(key, force) {
    if (!force && state.loaded[key]) return;
    state.loaded[key] = true;
    if (key === 'dashboard') return renderDashboard();
    if (key === 'payroll') return renderPayroll();
    if (key === 'invoicing') return renderInvoicing('');
  }
  function activeKey() {
    var b = document.querySelector('#fin-subnav button.active');
    return b ? b.dataset.fin : 'dashboard';
  }
  window.finRefresh = function () { renderStatus(); load(activeKey(), true); };
  window.finOpenAccounting = function (section) {
    var t = document.querySelector('.tab[data-tab="accounting"]');
    if (t) t.click();
    if (section) setTimeout(function () {
      var b = document.querySelector('#acct-subnav button[data-acct="' + section + '"]');
      if (b) b.click();
    }, 120);
  };

  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('#fin-subnav button');
    if (btn) {
      var key = btn.dataset.fin;
      document.querySelectorAll('#fin-subnav button').forEach(function (b) { b.classList.toggle('active', b === btn); });
      document.querySelectorAll('.fin-section').forEach(function (s) { s.classList.toggle('active', s.id === 'fin-' + key); });
      load(key);
      return;
    }
    var tab = e.target.closest && e.target.closest('.tab[data-tab="finance"]');
    if (tab) setTimeout(function () { renderStatus(); load(activeKey()); }, 50);
  });

  // Direct link (#finance) or refresh while on the tab.
  function bootIfVisible() {
    var view = document.getElementById('view-finance');
    if (view && view.classList.contains('active') && !state.loaded[activeKey()]) { renderStatus(); load(activeKey()); }
  }
  window.addEventListener('hashchange', function () { setTimeout(bootIfVisible, 80); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(bootIfVisible, 300); });
  else setTimeout(bootIfVisible, 300);
})();
