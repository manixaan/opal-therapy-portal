/* Invoicing — Owner Portal.
   Calendar → travel → MMM + rate card → invoice → PDF → audit trail.
   Reads and writes /api/invoicing/* only. Every figure on screen comes from
   the server; this file never computes money. The backend enforces
   manage_billing on every route — hiding things here is convenience only.
   Also adds the "Complete invoicing" button to the calendar bar and an
   invoicing panel to the calendar event drawer (owner only). */
(function () {
  'use strict';

  var API = '/api/invoicing';
  var state = {
    section: 'invoices', overview: null, practitioners: [], filters: { status: '', q: '', practitionerId: '', from: '', to: '', payer: '', trip: false, mmm: '', sort: 'issue', dir: 'desc' },
    invoiceId: null, tripId: null, tripTab: 'overview', settings: null,
    // Send selected: every sendable row starts ticked; untick the ones to look into.
    unticked: {}, listRows: [],
  };

  // ── Helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(v) {
    if (v == null || v === '' || isNaN(Number(v))) return '—';
    return new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v));
  }
  function aud(v) { return v == null ? '—' : '$' + money(v); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function dmy(ymd) {
    if (!ymd) return '—';
    var p = String(ymd).slice(0, 10).split('-');
    if (p.length < 3) return esc(ymd);
    return Number(p[2]) + ' ' + MONTHS[Number(p[1]) - 1] + ' ' + p[0];
  }
  function dt(iso) { if (!iso) return '—'; var d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function ymdLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  var STATUS_LABEL = { DRAFT: 'Draft', NEEDS_ATTENTION: 'Needs attention', READY: 'Ready', SENT: 'Sent', PART_PAID: 'Part paid', PAID: 'Paid', OVERDUE: 'Overdue', VOID: 'Void' };
  function pill(status) { return '<span class="inv-pill ' + esc(status) + '">' + esc(STATUS_LABEL[status] || status) + '</span>'; }
  function toast(msg, sub) { if (typeof window.showToast === 'function') window.showToast(msg, sub || ''); }
  function skel(n) { var h = ''; for (var i = 0; i < (n || 4); i++) h += '<div class="inv-skel" style="width:' + (60 + (i * 13) % 40) + '%"></div>'; return h; }

  async function api(method, path, body) {
    var opt = { method: method, credentials: 'include', headers: {} };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    var r = await fetch(API + path, opt);
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('Request failed (' + r.status + ')')); e.status = r.status; e.code = j.code; throw e; }
    return j;
  }
  var get = function (p) { return api('GET', p); };
  var post = function (p, b) { return api('POST', p, b || {}); };
  var put = function (p, b) { return api('PUT', p, b || {}); };
  var patch = function (p, b) { return api('PATCH', p, b || {}); };
  var del = function (p) { return api('DELETE', p); };

  function canInvoice() {
    var u = window.APP_USER;
    if (!u) return false;
    if (u.role === 'owner') return true;
    return Array.isArray(u.permissions) && u.permissions.indexOf('manage_billing') >= 0;
  }
  function root() { return document.getElementById('inv-root'); }
  function section() { return document.getElementById('inv-section'); }
  function denied(el, e) {
    el.innerHTML = e && e.status === 403
      ? '<div class="inv-note">Invoicing is available to the practice owner only.</div>'
      : '<div class="inv-error">' + esc(e && e.message || 'Something went wrong') + '</div>';
  }
  async function ask(message, opts) {
    if (typeof window.portalPrompt === 'function') return window.portalPrompt(message, '', opts || {});
    return window.prompt(message); // eslint-disable-line no-alert
  }
  async function confirmIt(message) {
    if (typeof window.portalConfirm === 'function') return window.portalConfirm(message);
    return window.confirm(message); // eslint-disable-line no-alert
  }

  // ── Modal ────────────────────────────────────────────────────────────────
  function modal(title, bodyHtml, footerHtml, opts) {
    closeModal();
    var bd = document.createElement('div');
    bd.className = 'inv-backdrop';
    bd.id = 'inv-backdrop';
    bd.innerHTML = '<div class="inv-modal ' + ((opts && opts.wide) ? 'wide' : '') + '" role="dialog" aria-modal="true" aria-labelledby="inv-modal-title">' +
      '<header><h3 id="inv-modal-title">' + esc(title) + '</h3><button class="inv-x" type="button" aria-label="Close" data-inv="close-modal">×</button></header>' +
      '<div class="body" id="inv-modal-body">' + bodyHtml + '</div>' +
      (footerHtml ? '<footer id="inv-modal-foot">' + footerHtml + '</footer>' : '') + '</div>';
    bd.addEventListener('click', function (e) { if (e.target === bd) closeModal(); });
    document.body.appendChild(bd);
    var first = bd.querySelector('input, select, textarea, button.btn');
    if (first) first.focus();
    return bd;
  }
  function closeModal() { var m = document.getElementById('inv-backdrop'); if (m) m.remove(); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && document.getElementById('inv-backdrop')) closeModal(); });

  // ── Shell ────────────────────────────────────────────────────────────────
  var SECTIONS = [['invoices', 'Invoices'], ['attention', 'Needs attention'], ['trips', 'Trips'], ['clients', 'Client billing'], ['payers', 'Payers'], ['runs', 'Runs'], ['settings', 'Billing settings']];

  function renderShell() {
    var el = root();
    if (!el || el.dataset.ready) return;
    el.dataset.ready = '1';
    el.innerHTML =
      '<div class="inv-head"><div><h1>Invoicing</h1><div class="inv-sub" id="inv-sub">Calendar sessions and travel become NDIS invoice drafts.</div></div>' +
      '<div class="inv-head-actions"><button class="btn" data-inv="new-trip">Invoice a trip</button><button class="btn" data-inv="xero-payments" title="Read payments recorded in Xero onto invoices copied there">Update payments from Xero</button><button class="btn" data-inv="complete">Complete invoicing…</button><button class="btn primary" data-inv="complete-last" title="Draft every client\'s invoice for last Monday to Friday, all practitioners">Invoice last week</button></div></div>' +
      '<div id="inv-cards" class="inv-cards">' + skel(1) + '</div>' +
      '<nav class="inv-subnav" id="inv-subnav" aria-label="Invoicing sections">' + SECTIONS.map(function (s) {
        return '<button type="button" data-sec="' + s[0] + '"' + (s[0] === state.section ? ' class="active"' : '') + '>' + esc(s[1]) + (s[0] === 'attention' ? ' <span class="cnt" id="inv-attn-cnt"></span>' : '') + '</button>';
      }).join('') + '</nav>' +
      '<div id="inv-section"></div>';
  }

  async function loadOverview() {
    try {
      var o = await get('/overview');
      state.overview = o;
      state.practitioners = o.practitioners || [];
      var c = o.counts || {};
      var cards = [
        ['Drafts', c.draft, 'DRAFT', aud(c.draft_value) + ' in drafts'],
        ['Needs attention', (c.needs_attention || 0), 'NEEDS_ATTENTION', (c.open_issues || 0) + ' open items', (c.needs_attention || c.open_issues) ? 'warn' : ''],
        ['Ready / sent', (c.ready || 0) + (c.sent || 0), 'READY,SENT', ''],
        ['Outstanding', aud(c.outstanding), 'READY,SENT,PART_PAID,OVERDUE', ''],
        ['Overdue', c.overdue || 0, 'OVERDUE', '', c.overdue ? 'warn' : ''],
        ['Paid', c.paid || 0, 'PAID', ''],
      ];
      var el = document.getElementById('inv-cards');
      if (el) el.innerHTML = cards.map(function (k) {
        return '<button type="button" class="inv-card ' + (k[4] || '') + '" data-inv="card" data-status="' + k[2] + '"><div class="lbl">' + esc(k[0]) + '</div><div class="val">' + esc(k[1] == null ? 0 : k[1]) + '</div>' + (k[3] ? '<div class="inv-dim">' + esc(k[3]) + '</div>' : '') + '</button>';
      }).join('');
      var cnt = document.getElementById('inv-attn-cnt');
      if (cnt) { cnt.textContent = c.open_issues ? String(c.open_issues) : ''; if (!c.open_issues) cnt.setAttribute('data-zero', '1'); else cnt.removeAttribute('data-zero'); }
    } catch (e) {
      var el2 = document.getElementById('inv-cards');
      if (el2) denied(el2, e);
    }
  }

  function go(sec, opts) {
    state.section = sec;
    if (!opts || !opts.keepIds) { state.invoiceId = null; state.tripId = null; }
    document.querySelectorAll('#inv-subnav button').forEach(function (b) { b.classList.toggle('active', b.dataset.sec === sec); });
    var el = section();
    if (!el) return;
    el.innerHTML = skel(6);
    var fn = { invoices: renderInvoices, attention: renderAttention, trips: renderTrips, clients: renderClients, payers: renderPayers, runs: renderRuns, settings: renderSettings }[sec];
    Promise.resolve(fn(el)).catch(function (e) { denied(el, e); });
  }

  // ── Invoices list ────────────────────────────────────────────────────────
  var FILTER_CHIPS = [['', 'All'], ['DRAFT', 'Draft'], ['NEEDS_ATTENTION', 'Needs attention'], ['READY', 'Ready'], ['SENT', 'Sent'], ['PART_PAID', 'Part paid'], ['PAID', 'Paid'], ['OVERDUE', 'Overdue'], ['VOID', 'Void']];

  async function renderInvoices(el) {
    if (state.invoiceId) return renderInvoiceDetail(el, state.invoiceId);
    var f = state.filters;
    el.innerHTML =
      '<div class="inv-chips" role="group" aria-label="Status">' + FILTER_CHIPS.map(function (c) { return '<button type="button" class="inv-chip' + (f.status === c[0] ? ' on' : '') + '" data-inv="chip" data-status="' + c[0] + '">' + esc(c[1]) + '</button>'; }).join('') + '</div>' +
      '<div class="inv-filters">' +
      '<input type="search" id="inv-f-q" placeholder="Search invoice #, client, NDIS number, plan manager" value="' + esc(f.q) + '" aria-label="Search invoices">' +
      '<select id="inv-f-prac" aria-label="Practitioner"><option value="">All practitioners</option>' + state.practitioners.map(function (p) { return '<option value="' + esc(p.id) + '"' + (f.practitionerId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select>' +
      '<input type="text" id="inv-f-payer" placeholder="Plan manager" value="' + esc(f.payer) + '" aria-label="Plan manager" style="width:150px">' +
      '<label class="inv-dim">Issued <input type="date" id="inv-f-from" value="' + esc(f.from) + '" aria-label="Issued from"></label>' +
      '<label class="inv-dim">to <input type="date" id="inv-f-to" value="' + esc(f.to) + '" aria-label="Issued to"></label>' +
      '<select id="inv-f-mmm" aria-label="MMM zone"><option value="">Any MMM</option>' + [1, 2, 3, 4, 5, 6, 7].map(function (z) { return '<option value="' + z + '"' + (String(f.mmm) === String(z) ? ' selected' : '') + '>MM' + z + '</option>'; }).join('') + '</select>' +
      '<label class="inv-dim"><input type="checkbox" id="inv-f-trip"' + (f.trip ? ' checked' : '') + '> Rural trip</label>' +
      '</div><div id="inv-list">' + skel(6) + '</div>';
    await loadInvoiceList();
  }

  function listQuery() {
    var f = state.filters, q = [];
    if (f.status) q.push('status=' + encodeURIComponent(f.status));
    if (f.q) q.push('q=' + encodeURIComponent(f.q));
    if (f.practitionerId) q.push('practitionerId=' + encodeURIComponent(f.practitionerId));
    if (f.payer) q.push('payer=' + encodeURIComponent(f.payer));
    if (f.from) q.push('from=' + f.from);
    if (f.to) q.push('to=' + f.to);
    if (f.mmm) q.push('mmm=' + f.mmm);
    if (f.trip) q.push('trip=true');
    q.push('sort=' + f.sort, 'dir=' + f.dir);
    return '?' + q.join('&');
  }

  /* Can this row go out with "Send selected"? A draft or final invoice that
     is not sent yet, has a payer email and needs no attention. */
  function sendable(i) {
    return (i.status === 'DRAFT' || i.status === 'READY') && i.sent_status !== 'SENT' && i.sent_status !== 'SENDING' && !!i.payer_email && !i.is_stale;
  }
  function whyNotSendable(i) {
    if (i.sent_status === 'SENT') return 'Already sent';
    if (i.sent_status === 'SENDING') return 'Being sent';
    if (i.status === 'NEEDS_ATTENTION') return 'Needs attention first';
    if (i.is_stale) return 'Source changed — regenerate first';
    if (!i.payer_email) return 'No payer email';
    return 'Not sendable (' + String(i.status || '').toLowerCase().replace('_', ' ') + ')';
  }
  function selectedRows() { return state.listRows.filter(function (i) { return sendable(i) && !state.unticked[i.id]; }); }
  function renderSendBar() {
    var bar = document.getElementById('inv-send-bar');
    if (!bar) return;
    var rows = selectedRows(), all = state.listRows.filter(sendable);
    if (!all.length) { bar.hidden = true; return; }
    bar.hidden = false;
    var total = rows.reduce(function (a, i) { return a + Math.round(Number(i.total) * 100); }, 0) / 100;
    bar.innerHTML = '<span><b>' + rows.length + '</b> of ' + all.length + ' ready to send ticked · ' + money(total.toFixed(2)) + '</span>' +
      '<button type="button" class="btn primary" data-inv="send-selected"' + (rows.length ? '' : ' disabled') + '>Finalise &amp; send selected (' + rows.length + ')</button>';
    var head = document.getElementById('inv-sel-all');
    if (head) { head.checked = rows.length === all.length; head.indeterminate = rows.length > 0 && rows.length < all.length; }
  }

  function openSendSelected() {
    var rows = selectedRows();
    if (!rows.length) return;
    var total = rows.reduce(function (a, i) { return a + Math.round(Number(i.total) * 100); }, 0) / 100;
    var body = '<p>Each ticked invoice is finalised (its number and PDF are locked), copied to Xero when that is switched on, and emailed with its PDF to:</p>' +
      '<div class="inv-table-wrap" style="max-height:280px"><table class="inv-table"><thead><tr><th>Invoice #</th><th>Client</th><th>To</th><th class="num">Amount</th></tr></thead><tbody>' +
      rows.map(function (i) { return '<tr><td>' + esc(i.invoice_number) + '</td><td>' + esc(i.client_name || '—') + '</td><td>' + esc(i.payer_email) + '</td><td class="num">' + money(i.total) + '</td></tr>'; }).join('') +
      '</tbody></table></div><p class="inv-note">' + rows.length + ' invoice' + (rows.length === 1 ? '' : 's') + ', ' + money(total.toFixed(2)) + ' in total. Unticked invoices are left as they are. This cannot be unsent.</p><div id="inv-send-result"></div>';
    modal('Send ' + rows.length + ' invoice' + (rows.length === 1 ? '' : 's'), body,
      '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" id="inv-send-go" data-inv="send-go">Finalise &amp; send</button>', { wide: true });
    document.getElementById('inv-backdrop').__ids = rows.map(function (i) { return i.id; });
  }

  async function sendSelected(btn) {
    var bd = document.getElementById('inv-backdrop');
    var ids = (bd && bd.__ids) || [];
    var out = document.getElementById('inv-send-result');
    btn.disabled = true; btn.textContent = 'Sending ' + ids.length + '…';
    var cancel = bd.querySelector('[data-inv="close-modal"]');
    if (cancel) cancel.disabled = true;
    try {
      var r = await post('/invoices/send-batch', { ids: ids });
      var label = { sent: 'Sent', skipped: 'Skipped', failed: 'Not sent' };
      out.innerHTML = '<div class="' + (r.failed ? 'inv-error' : 'inv-ok') + '">' + r.sent + ' sent' + (r.skipped ? ', ' + r.skipped + ' skipped' : '') + (r.failed ? ', ' + r.failed + ' not sent' : '') + '.</div>' +
        '<table class="inv-table"><tbody>' + r.results.map(function (x) {
          return '<tr><td>' + esc(x.number || '') + '</td><td>' + esc(x.client || '') + '</td><td><span class="inv-pill ' + (x.outcome === 'sent' ? 'SENT' : x.outcome === 'failed' ? 'NEEDS_ATTENTION' : 'DRAFT') + '">' + label[x.outcome] + '</span></td><td>' + esc(x.outcome === 'sent' ? (x.to || '') : (x.message || '')) + '</td></tr>';
        }).join('') + '</tbody></table>';
      var foot = document.getElementById('inv-modal-foot');
      if (foot) foot.innerHTML = '<button class="btn primary" data-inv="close-modal">Done</button>';
      state.unticked = {};
      loadOverview();
      loadInvoiceList();
    } catch (e) {
      out.innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Finalise & send';
      if (cancel) cancel.disabled = false;
    }
  }

  var COLS = [['number', 'Invoice #'], [null, 'To'], ['client', 'Client'], [null, 'Location'], [null, 'Practitioner'], ['issue', 'Issue date'], ['due', 'Due date'], ['total', 'Amount', 'num'], [null, 'Outstanding', 'num'], [null, 'Status'], [null, 'Sent status']];

  async function loadInvoiceList() {
    var el = document.getElementById('inv-list');
    if (!el) return;
    try {
      var r = await get('/invoices' + listQuery());
      if (!r.invoices.length) {
        el.innerHTML = '<div class="inv-panel inv-empty">No invoices match. Use <strong>Complete invoicing</strong> to turn completed calendar sessions into drafts.</div>';
        return;
      }
      var f = state.filters;
      state.listRows = r.invoices;
      el.innerHTML = '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th class="inv-sel"><input type="checkbox" id="inv-sel-all" aria-label="Tick every invoice ready to send"></th>' + COLS.map(function (c) {
        var sorted = c[0] && f.sort === c[0];
        return '<th class="' + (c[2] || '') + (c[0] ? ' sortable' : '') + (sorted ? ' sorted' : '') + '"' + (c[0] ? ' data-inv="sort" data-sort="' + c[0] + '" tabindex="0" aria-sort="' + (sorted ? (f.dir === 'asc' ? 'ascending' : 'descending') : 'none') + '"' : '') + '>' + esc(c[1]) + (sorted ? (f.dir === 'asc' ? ' ▲' : ' ▼') : '') + '</th>';
      }).join('') + '</tr></thead><tbody>' + r.invoices.map(function (i) {
        var loc = (i.mmm_zones || []).filter(Boolean).map(function (z) { return 'MM' + z; }).join(', ');
        var can = sendable(i);
        return '<tr class="clickable" data-inv="open" data-id="' + esc(i.id) + '">' +
          '<td class="inv-sel">' + (can
            ? '<input type="checkbox" class="inv-sel-row" data-id="' + esc(i.id) + '"' + (state.unticked[i.id] ? '' : ' checked') + ' aria-label="Send ' + esc(i.invoice_number) + '">'
            : '<span class="inv-dim" title="' + esc(whyNotSendable(i)) + '" aria-label="' + esc(whyNotSendable(i)) + '">–</span>') + '</td>' +
          '<td><button type="button" class="inv-link" data-inv="open" data-id="' + esc(i.id) + '">' + esc(i.invoice_number) + '</button>' + (i.is_stale || i.source_changed_after_finalise ? '<div class="inv-dim" title="A source calendar event changed">⚠ source changed</div>' : '') + '</td>' +
          '<td>' + (i.payer_name ? esc(i.payer_name) : '<span class="inv-pill NEEDS_ATTENTION">Recipient missing</span>') + '</td>' +
          '<td>' + esc(i.client_name || '—') + (i.ndis_number ? '<div class="inv-dim">NDIS ' + esc(i.ndis_number) + '</div>' : '') + '</td>' +
          '<td>' + (loc ? '<span class="inv-pill mmm">' + esc(loc) + '</span>' : '—') + (i.trip_name ? '<div class="inv-dim">Trip: ' + esc(i.trip_name) + '</div>' : '') + '</td>' +
          '<td>' + esc(i.practitioner_names || '—') + '</td>' +
          '<td>' + dmy(i.issue_date) + '</td><td>' + dmy(i.due_date) + '</td>' +
          '<td class="num">' + money(i.total) + '</td><td class="num">' + money(i.outstanding) + '</td>' +
          '<td>' + pill(i.display_status) + (i.open_issues ? ' <span class="inv-dim">' + i.open_issues + ' issue' + (i.open_issues === 1 ? '' : 's') + '</span>' : '') + '</td>' +
          '<td>' + (i.xero_state === 'PUSHED' ? '<span class="inv-pill xero" title="Copied to Xero">Xero</span> ' : i.xero_state === 'FAILED' ? '<span class="inv-pill NEEDS_ATTENTION" title="Not copied to Xero">Xero ✕</span> ' : '') +
            (i.sent_status === 'SENT' ? '<span class="inv-pill SENT">Sent</span>'
            : i.sent_status === 'FAILED' ? '<span class="inv-pill NEEDS_ATTENTION" title="' + esc(i.email_last_error || '') + '">Send failed</span>'
            : '<span class="inv-dim">Not sent</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div><div class="inv-send-bar" id="inv-send-bar" hidden></div><div class="inv-dim" style="margin-top:6px">' + r.total + ' invoice' + (r.total === 1 ? '' : 's') + '</div>';
      renderSendBar();
    } catch (e) { denied(el, e); }
  }

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('inv-sel-row')) {
      if (t.checked) delete state.unticked[t.dataset.id]; else state.unticked[t.dataset.id] = true;
      renderSendBar();
    } else if (t && t.id === 'inv-sel-all') {
      state.listRows.filter(sendable).forEach(function (i) { if (t.checked) delete state.unticked[i.id]; else state.unticked[i.id] = true; });
      document.querySelectorAll('#inv-list .inv-sel-row').forEach(function (c) { c.checked = t.checked; });
      renderSendBar();
    }
  });

  var searchTimer = null;
  document.addEventListener('input', function (e) {
    if (!e.target.id || e.target.id.indexOf('inv-f-') !== 0) return;
    var f = state.filters;
    if (e.target.id === 'inv-f-q') f.q = e.target.value.trim();
    if (e.target.id === 'inv-f-payer') f.payer = e.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(loadInvoiceList, 250);
  });
  document.addEventListener('change', function (e) {
    var id = e.target.id || '';
    var f = state.filters;
    if (id === 'inv-f-prac') f.practitionerId = e.target.value;
    else if (id === 'inv-f-from') f.from = e.target.value;
    else if (id === 'inv-f-to') f.to = e.target.value;
    else if (id === 'inv-f-mmm') f.mmm = e.target.value;
    else if (id === 'inv-f-trip') f.trip = e.target.checked;
    else return;
    loadInvoiceList();
  });

  // ── Invoice detail ───────────────────────────────────────────────────────
  var COMPONENT_LABEL = { SESSION: 'Session', TRAVEL_LABOUR: 'Provider travel', TRAVEL_KM: 'Vehicle / non-labour', TRIP_COST: 'Trip cost', MANUAL: 'Added by hand', NF2F: 'Non-face-to-face', SPLOSE_ACTIVITY: 'Splose support activity' };
  /** The small grey label under a line's item code: what kind of charge it is. */
  function lineLabel(l) {
    var c = l.calculation || {};
    if (c.method === 'case_note') return 'Case noting';
    if (c.method === 'travel_block') return 'Provider travel';
    if (l.component === 'NF2F' && c.activity) return c.activity;
    return COMPONENT_LABEL[l.component] || l.component;
  }
  /** One editable header field on the invoice paper (edit mode). */
  function hdrEd(field, value, placeholder) {
    return '<span class="inv-ce" contenteditable="true" data-hdr="' + field + '" data-ph="' + esc(placeholder || '') + '">' + esc(value || '') + '</span>';
  }

  // ── Edit in place ────────────────────────────────────────────────────────
  // Every edit saves when the field loses focus. Reasons are recorded for the
  // audit trail automatically ("Edited on the invoice"). A recipient typed here
  // is also saved on the client's billing profile, so the next invoice has it.
  var EDIT_REASON = 'Edited on the invoice';
  function saveState(text, bad) {
    var s = document.getElementById('inv-save-state');
    if (s) { s.textContent = text; s.className = bad ? 'inv-save-bad' : 'inv-dim'; }
  }
  function parseNum(t) { var n = Number(String(t || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : NaN; }
  async function saveInline(el) {
    var inv = state.detail && state.detail.invoice;
    if (!inv || !state.editMode) return;
    var text = el.tagName === 'INPUT' ? el.value : el.textContent.replace(/ /g, ' ').trim();
    try {
      if (el.dataset.line) {
        var l = lineById(el.dataset.line); if (!l) return;
        var f = el.dataset.field, body = {};
        if (f === 'description') { if (!text || text === l.description) return; body.description = text; }
        else {
          var n = parseNum(text);
          var cur = Number(f === 'quantity' ? l.quantity : l.unit_price);
          if (!Number.isFinite(n) || n < 0 || (f === 'quantity' && n <= 0)) { saveState('Enter a number above zero', true); el.textContent = f === 'quantity' ? l.quantity : Number(l.unit_price).toFixed(2); return; }
          if (n === cur) return;
          body[f] = String(n); body.reason = EDIT_REASON;
        }
        saveState('Saving…');
        await patch('/invoices/' + inv.id + '/lines/' + l.id, body);
      } else if (el.dataset.hdr) {
        var k = el.dataset.hdr, col = { payerName: 'payer_name', payerEmail: 'payer_email', payerReference: 'payer_reference', notes: 'notes', issueDate: 'issue_date', dueDate: 'due_date' }[k];
        if ((text || '') === (inv[col] || '')) return;
        var b = {}; b[k] = text;
        if (k.indexOf('payer') === 0) { b.reason = EDIT_REASON; if (!inv.payer_type) b.payerType = 'PLAN_MANAGER'; }
        if ((k === 'issueDate' || k === 'dueDate') && !text) return;
        saveState('Saving…');
        await patch('/invoices/' + inv.id, b);
        // Remember the recipient for this client's next invoices.
        if (k.indexOf('payer') === 0 && inv.client_id) {
          var pb = {}; pb[k] = text || null; if (!inv.payer_type) pb.payerType = 'PLAN_MANAGER';
          await put('/clients/' + encodeURIComponent(inv.client_id), pb).catch(function () {});
        }
      } else return;
      saveState('Saved');
      softRefresh();
    } catch (e) { saveState(e.message, true); }
  }
  // Re-draw the invoice (totals, amounts) only once the person has stopped
  // typing in it, so moving from one field to the next never loses the cursor.
  var refreshTimer = null;
  function softRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      var a = document.activeElement;
      if (a && a.closest && a.closest('#inv-root .inv-ce, #inv-root .inv-ce-date, #inv-root .inv-new-line')) { softRefresh(); return; }
      refreshDetail();
    }, 700);
  }
  async function saveNewLine(row) {
    var inv = state.detail && state.detail.invoice;
    var val = function (n) { var c = row.querySelector('[data-new="' + n + '"]'); return c ? c.textContent.replace(/ /g, ' ').trim() : ''; };
    var desc = val('description'), price = parseNum(val('unitPrice')), qty = parseNum(val('quantity') || '1');
    if (!desc || !Number.isFinite(price)) return; // not finished yet
    if (!(qty > 0) || price < 0) { saveState('Quantity must be above zero and price not negative', true); return; }
    row.dataset.saving = '1';
    try {
      saveState('Saving…');
      await post('/invoices/' + inv.id + '/lines', { description: desc, itemCode: val('itemCode') || null, unitPrice: String(price), quantity: String(qty), reason: EDIT_REASON });
      saveState('Saved'); softRefresh();
    } catch (e) { row.dataset.saving = ''; saveState(e.message, true); }
  }
  function addInlineRow() {
    var tb = document.getElementById('inv-line-body');
    if (!tb) return;
    var empty = tb.querySelector('.inv-empty'); if (empty) empty.parentElement.remove();
    var tr = document.createElement('tr');
    tr.className = 'inv-new-line';
    tr.innerHTML = '<td><span class="inv-ce" contenteditable="true" data-new="itemCode" data-ph="Item code"></span></td>' +
      '<td><span class="inv-ce" contenteditable="true" data-new="description" data-ph="Description"></span></td>' +
      '<td class="num">$<span class="inv-ce num" contenteditable="true" inputmode="decimal" data-new="unitPrice" data-ph="0.00"></span></td>' +
      '<td class="num"><span class="inv-ce num" contenteditable="true" inputmode="decimal" data-new="quantity" data-ph="1">1</span></td><td class="num"></td><td class="num"></td>' +
      '<td class="acts"><button class="mini inv-line-x" type="button" data-inv="drop-new-line" aria-label="Discard this new line">✕</button></td>';
    tb.appendChild(tr);
    tr.querySelector('[data-new="description"]').focus();
  }
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (!el || !el.closest || !el.closest('#inv-root')) return;
    var row = el.closest('.inv-new-line');
    if (row) { if (!row.contains(e.relatedTarget) && !row.dataset.saving) saveNewLine(row); return; }
    if (el.matches('.inv-ce[data-line], .inv-ce[data-hdr], input.inv-ce-date')) saveInline(el);
  });
  document.addEventListener('keydown', function (e) {
    var el = e.target;
    if (e.key !== 'Enter' || !el || !el.classList || !el.classList.contains('inv-ce')) return;
    if (el.dataset.hdr === 'notes' && e.shiftKey) return; // notes may have line breaks
    e.preventDefault(); el.blur();
  });

  function calcHtml(l) {
    var c = l.calculation || {};
    var rows = [];
    function kv(k, v) { if (v !== undefined && v !== null && v !== '') rows.push('<div>' + esc(k) + '</div><div>' + v + '</div>'); }
    if (l.component === 'SESSION') {
      kv('Service date', dmy(c.serviceDate)); kv('Duration', esc(c.durationMinutes) + ' min → ' + esc(c.quantityHours) + ' h');
      kv('MMM', c.mmm ? 'MM' + esc(c.mmm) + (c.mmmSource && c.mmmSource.source ? ' (' + esc(String(c.mmmSource.source).replace(/_/g, ' ')) + (c.mmmSource.datasetVersion ? ', ' + esc(c.mmmSource.datasetVersion) : '') + ')' : '') : '—');
      kv('Rate card', c.rateCard ? esc(c.rateCard.name) + ' v' + esc(c.rateCard.version) + ' from ' + dmy(c.rateCard.effectiveFrom) : '—');
      kv('Zone rule', esc(c.zone)); kv('Session hourly rate', aud(c.sessionHourlyRate)); kv('Amount', aud(c.amount));
    } else if (l.component === 'TRAVEL_LABOUR' || l.component === 'TRAVEL_KM') {
      kv('Date', dmy(c.serviceDate)); kv('Practitioner', esc(c.practitioner || '—')); kv('MMM', c.mmm ? 'MM' + esc(c.mmm) : '—');
      kv('Day travel total', esc(c.dayTotalMinutes) + ' min · ' + esc(c.dayTotalKm) + ' km');
      kv('Billable sessions on route', esc(c.billableSessions));
      if (l.component === 'TRAVEL_LABOUR') {
        if (c.method === 'ndis_rule_book_2026_11') {
          var rep = c.dayReport || {};
          kv('Clients that day', esc(c.clientsInDay));
          kv('Cap per client', c.capMinutes == null ? 'No cap (MM6–7)' : esc(c.capMinutes) + ' min');
          kv('This client', esc(c.cappedMinutes) + ' min' + (Number(c.returnMinutes) ? ' + ' + esc(c.returnMinutes) + ' min return' : ''));
          kv('Day billed / not billed', esc(rep.billedMinutes) + ' / ' + esc(rep.unbilledMinutes) + ' min' + (rep.ceiling != null ? ' (ceiling ' + esc(rep.ceiling) + ')' : ''));
          kv('Rule', esc(String(c.rule || '').replace(/_/g, ' ')));
        } else {
          kv('Initial allocation', esc(c.allocatedMinutesBeforeCap) + ' min');
          kv('Client cap', c.capMinutes == null ? 'No cap (MM6–7)' : esc(c.capMinutes) + ' min' + (c.directions === 2 ? ' (' + esc(c.capMinutesEachWay) + ' each way, return paid)' : ''));
          kv('Cap applied', c.capApplied ? 'Yes — minutes above the cap are not redistributed' : 'No');
        }
        kv('Final claimable time', esc(c.claimableMinutes) + ' min (' + esc(c.quantityHours) + ' h)');
        kv('Rate', aud(c.travelHourlyRate) + '/hr');
      } else {
        kv('Allocated distance', esc(c.allocatedKm) + ' km'); kv('Rate', aud(c.vehicleRatePerKm) + '/km');
      }
      kv('Amount', aud(c.amount));
      kv('Rate card', c.rateCard ? esc(c.rateCard.name) + ' v' + esc(c.rateCard.version) : '—');
    } else if (l.component === 'SPLOSE_ACTIVITY') {
      kv('Service date', dmy(c.serviceDate)); kv('Logged in Splose', esc(c.serviceTitle || 'Support activity') + ' (activity ' + esc(c.sploseActivityId) + ')');
      kv('Duration', esc(c.durationMinutes) + ' min → ' + esc(c.quantityHours) + ' h');
      kv('MMM', c.mmm ? 'MM' + esc(c.mmm) + (c.mmmSource && c.mmmSource.source ? ' (' + esc(c.mmmSource.source) + ')' : '') : '—');
      kv('Rate card', c.rateCard ? esc(c.rateCard.name) + ' v' + esc(c.rateCard.version) : '—');
      kv('Hourly rate', aud(c.hourlyRate)); if (c.splosePricing != null) kv('Splose price', aud(c.splosePricing));
      kv('Amount', aud(c.amount));
    } else if (l.component === 'TRIP_COST') {
      kv('Trip', esc(c.tripName)); kv('Method', esc(String(c.method || '').replace(/_/g, ' ').toLowerCase()));
      kv('Eligible shared pool', aud(c.eligiblePool)); kv('Total trip costs', aud(c.totalCosts)); kv('Non-billable costs', aud(c.nonBillableCosts));
      kv('Participating clients', esc(c.clientCount)); if (c.method !== 'EQUAL_PER_CLIENT') kv('Weight', esc(c.weight) + ' of ' + esc(c.totalWeight));
      kv('This client', aud(c.amount)); if (c.reconciliation) kv('Pool reconciliation', 'allocated ' + aud(c.reconciliation.allocated) + ', unallocated ' + aud(c.reconciliation.unallocated));
    } else {
      kv('Method', esc(c.method || 'manual')); kv('Reason', esc(c.reason || ''));
    }
    var legs = '';
    if (Array.isArray(c.legs) && c.legs.length) {
      legs = '<div class="legs"><b>Route legs</b>' + c.legs.map(function (g) {
        return '<div class="' + (g.included ? '' : 'out') + '">' + (g.included ? '✓ ' : '✗ ') + esc(String(g.kind).toLowerCase()) + ' · ' + esc(g.minutes == null ? '?' : g.minutes) + ' min · ' + esc(g.km == null ? '?' : g.km) + ' km — ' + esc(String(g.reason || '').replace(/_/g, ' ')) + '</div>';
      }).join('') + '</div>';
    }
    var ovr = '';
    if (Array.isArray(c.overrides) && c.overrides.length) {
      ovr = '<div class="legs"><b>Owner overrides</b>' + c.overrides.map(function (o) {
        return '<div>' + dt(o.at) + ': qty ' + esc(o.from.quantity) + '→' + esc(o.to.quantity) + ', unit ' + esc(o.from.unit_price) + '→' + esc(o.to.unit_price) + (o.reason ? ' — “' + esc(o.reason) + '”' : '') + '</div>';
      }).join('') + '</div>';
    }
    return '<div class="calc"><div class="kv">' + rows.join('') + '</div>' + legs + ovr + '</div>';
  }

  async function renderInvoiceDetail(el, id) {
    el.innerHTML = skel(10);
    var d = await get('/invoices/' + encodeURIComponent(id));
    var inv = d.invoice, biz = d.business || {};
    var editable = inv.status === 'DRAFT' || inv.status === 'NEEDS_ATTENTION';
    var finalised = ['READY', 'SENT', 'PART_PAID', 'PAID'].indexOf(inv.status) >= 0;
    // Simple buttons: back, edit in place, finalise, delete / void, preview and download.
    // No "regenerate": drafts are refreshed by the background runs.
    if (state.editId !== inv.id) state.editMode = false;
    var editing = editable && state.editMode;
    var actions = [];
    actions.push('<button class="btn" data-inv="back">← All invoices</button>');
    if (editable) {
      actions.push('<button class="btn' + (editing ? ' primary' : '') + '" data-inv="toggle-edit" data-id="' + esc(inv.id) + '" aria-pressed="' + editing + '">' + (editing ? 'Done editing' : 'Edit') + '</button>');
      if (!editing) actions.push('<button class="btn primary" data-inv="finalise" data-id="' + esc(inv.id) + '">Finalise</button>');
    }
    actions.push('<a class="btn" href="' + API + '/invoices/' + encodeURIComponent(inv.id) + '/pdf?disposition=inline" target="_blank" rel="noopener">Preview PDF</a>');
    actions.push('<a class="btn" href="' + API + '/invoices/' + encodeURIComponent(inv.id) + '/pdf" download>Download PDF</a>');
    if (finalised) {
      actions.push('<button class="btn" data-inv="email" data-id="' + esc(inv.id) + '">Email invoice</button>');
      if (inv.sent_status !== 'SENT') actions.push('<button class="btn" data-inv="mark-sent" data-id="' + esc(inv.id) + '">Mark sent</button>');
      if (inv.xero_state !== 'PUSHED' && inv.xero_state !== 'VOIDED') actions.push('<button class="btn" data-inv="xero-push" data-id="' + esc(inv.id) + '" title="Copy this invoice to Xero with the same number">Copy to Xero</button>');
      if (inv.status !== 'PAID') actions.push('<button class="btn" data-inv="payment" data-id="' + esc(inv.id) + '" data-outstanding="' + esc(inv.outstanding) + '">Record payment</button>');
    }
    if (inv.status !== 'VOID') {
      actions.push('<button class="btn" data-inv="void" data-id="' + esc(inv.id) + '">Void</button>');
      if (finalised) actions.push('<button class="btn" data-inv="reissue" data-id="' + esc(inv.id) + '">Void &amp; reissue</button>');
    }
    if (editable && !inv.finalised_at) actions.push('<button class="btn danger" data-inv="delete-draft" data-id="' + esc(inv.id) + '">Delete</button>');

    var banners = '';
    if (inv.is_stale) banners += '<div class="inv-warn">⚠ ' + esc(inv.stale_reason || 'A source calendar event changed.') + ' <button class="btn btn-xs" data-inv="refresh-draft" data-id="' + esc(inv.id) + '">Update from calendar</button> (runs in the background)</div>';
    if (editing) banners += '<div class="inv-note inv-edit-hint">Editing: click any text on the invoice and type. Changes save when you click away. <b>✕</b> removes a line; <b>+ Add line</b> adds one.</div>';
    // Reviewer notes from the travel calculation: here only — never on the PDF or in Xero.
    var notes = [];
    (d.lines || []).forEach(function (l) { if (l.line_status === 'ACTIVE' && l.calculation && Array.isArray(l.calculation.reviewNotes)) l.calculation.reviewNotes.forEach(function (n) { if (notes.indexOf(n) < 0) notes.push(n); }); });
    if (notes.length) banners += '<div class="inv-note inv-review-notes"><b>For the reviewer — how travel was worked out</b> (not on the invoice)<ul>' + notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul></div>';
    if (inv.xero_state === 'PUSHED') banners += '<div class="inv-note">In Xero as ' + esc(inv.invoice_number) + (inv.xero_status ? ' (' + esc(String(inv.xero_status).toLowerCase()) + ')' : '') + '. Payments are recorded in Xero and come back with <strong>Update payments from Xero</strong>.</div>';
    else if (inv.xero_state === 'FAILED') banners += '<div class="inv-error">Not copied to Xero: ' + esc(inv.xero_error || 'unknown reason') + '</div>';
    if (inv.sent_status === 'FAILED') banners += '<div class="inv-error">The email was not sent: ' + esc(inv.email_last_error || 'unknown reason') + '</div>';
    if (inv.source_changed_after_finalise) banners += '<div class="inv-error">Source event changed after invoice finalisation. This invoice has not been altered — use <strong>Void &amp; reissue</strong> to correct it, or dismiss the attention item if no correction is needed.</div>';
    if (inv.status === 'VOID') banners += '<div class="inv-note">Voided ' + dt(inv.voided_at) + (inv.voided_by_name ? ' by ' + esc(inv.voided_by_name) : '') + ': ' + esc(inv.void_reason || '') + (inv.reissued_as_id ? ' · Reissued as <button class="inv-link" data-inv="open" data-id="' + esc(inv.reissued_as_id) + '">' + esc(inv.reissued_as_number) + '</button>' : '') + '</div>';
    if (inv.reissue_of_number) banners += '<div class="inv-note">Reissue of ' + esc(inv.reissue_of_number) + '.</div>';
    (d.issues || []).forEach(function (i) { banners += '<div class="' + (i.severity === 'BLOCKING' ? 'inv-warn' : 'inv-note') + '">' + esc(i.message) + ' ' + fixButton(i) + '</div>'; });

    var lines = d.lines.filter(function (l) { return l.line_status !== 'VOIDED'; });
    var lineRows = lines.map(function (l) {
      var removed = l.line_status === 'REMOVED';
      var src = l.calendar_event_id ? '<div class="src">Source: calendar event · ' + esc(l.event_title || '') + (l.event_start ? ' · ' + dt(l.event_start) : '') + (l.event_deleted ? ' (deleted)' : '') + '</div>' : '';
      var acts = editing ? '' : '<button class="mini" type="button" data-inv="calc" data-line="' + esc(l.id) + '" aria-expanded="false">How calculated</button>';
      if (editing) {
        acts += removed
          ? '<button class="mini" type="button" data-inv="restore-line" data-line="' + esc(l.id) + '">Restore</button>'
          : '<button class="mini inv-line-x" type="button" data-inv="remove-line" data-line="' + esc(l.id) + '" title="Remove this line" aria-label="Remove this line">✕</button>';
      }
      // In edit mode the description, unit price and quantity are typed straight into.
      var ce = editing && !removed;
      var ed = function (field, text, numeric) {
        return ce ? '<span class="inv-ce' + (numeric ? ' num' : '') + '" contenteditable="true" spellcheck="' + !numeric + '" data-line="' + esc(l.id) + '" data-field="' + field + '"' + (numeric ? ' inputmode="decimal"' : '') + '>' + esc(text) + '</span>' : esc(text);
      };
      var qty = Number(l.quantity).toFixed(Number(l.quantity) % 0.01 ? 4 : 2);
      return '<tr class="' + (removed ? 'removed' : '') + ' inv-line-' + esc(String(l.component).toLowerCase()) + '"><td><div class="code">' + esc(l.item_code || '') + '</div><div class="inv-dim" style="color:#7a868a">' + esc(lineLabel(l)) + (l.is_overridden ? ' · edited' : '') + '</div></td>' +
        '<td>' + ed('description', l.description) + (editing ? '' : src) + (removed ? '<div class="inv-dim">Removed: ' + esc(l.removed_reason || '') + '</div>' : '') + '</td>' +
        '<td class="num">' + (ce ? '$' + ed('unitPrice', Number(l.unit_price).toFixed(2), true) : money(l.unit_price)) + '</td><td class="num">' + ed('quantity', qty, true) + '</td>' +
        '<td class="num">' + Math.round(Number(l.gst_rate) * 100) + '%</td><td class="num"><b>' + money(l.amount) + '</b></td>' +
        '<td class="acts">' + acts + '</td></tr>' +
        '<tr class="calc-row" id="calc-' + esc(l.id) + '" hidden><td colspan="7">' + calcHtml(l) + '</td></tr>';
    }).join('');

    var paidPct = Number(inv.total) > 0 ? Math.min(100, Math.round(100 * Number(inv.amount_paid) / Number(inv.total))) : 0;
    el.innerHTML =
      '<div class="inv-detail-head"><h2>' + esc(inv.invoice_number) + ' ' + pill(inv.display_status) + '</h2><div class="inv-actions">' + actions.join('') + '</div></div>' + banners +
      '<div class="inv-detail-grid"><div class="inv-paper"><div class="band"></div><div class="pad">' +
      '<div class="top"><div><h2>Tax Invoice</h2>' + (editable ? '<div class="draft-mark">DRAFT</div>' : '') + '</div><img src="' + API + '/logo" alt="Opal Therapy"></div>' +
      '<div class="parties"><div><b>Client</b>' + esc(inv.client_name || '—') + '<br>NDIS Number: ' + esc(inv.ndis_number || 'not recorded') +
      (editing
        ? '<b>Invoice to</b>' + hdrEd('payerName', inv.payer_name, 'Who pays (e.g. plan manager)') + '<br>' + hdrEd('payerEmail', inv.payer_email, 'Recipient email') + '<br>Ref: ' + hdrEd('payerReference', inv.payer_reference, 'Reference') + '</div>'
        : '<b>Invoice to</b>' + (inv.payer_name ? esc(inv.payer_name) : '<span style="color:#c2412e">Recipient not set</span>') + (inv.payer_reference ? '<br>Ref: ' + esc(inv.payer_reference) : '') + (inv.payer_email ? '<br>' + esc(inv.payer_email) : '') + '</div>') +
      '<div><b>From</b>' + esc(biz.name || 'Opal Therapy') + '<b>ABN</b>' + (biz.abn ? esc(biz.abn) : '<span style="color:#c2412e">Not set — Billing settings</span>') + '<b>Provider</b>' + esc(inv.practitioner_names || '—') + '</div>' +
      '<div><b>Invoice #</b>' + esc(inv.invoice_number) + '<b>Issue date</b>' + (editing ? '<input type="date" class="inv-ce-date" data-hdr="issueDate" value="' + esc(inv.issue_date || '') + '">' : dmy(inv.issue_date)) +
      '<b>Due date</b>' + (editing ? '<input type="date" class="inv-ce-date" data-hdr="dueDate" value="' + esc(inv.due_date || '') + '">' : dmy(inv.due_date)) + '<b>Service period</b>' + dmy(inv.period_start) + ' – ' + dmy(inv.period_end) + '</div></div>' +
      '<table><thead><tr><th>Item code</th><th>Description</th><th class="num">Unit price</th><th class="num">Quantity</th><th class="num">GST</th><th class="num">Amount AUD</th><th></th></tr></thead><tbody id="inv-line-body">' + (lineRows || '<tr><td colspan="7" class="inv-empty">No lines.</td></tr>') + '</tbody></table>' +
      (editing ? '<div style="margin-top:8px"><button class="mini" type="button" data-inv="add-line-inline">+ Add line</button> <span id="inv-save-state" class="inv-dim" aria-live="polite"></span></div>' : '') +
      '<div class="totals"><div><span>Subtotal</span><span>' + money(inv.subtotal) + '</span></div><div><span>' + (inv.tax_treatment === 'GST_10_EXCLUSIVE' ? 'GST 10%' : 'GST (GST-free)') + '</span><span>' + money(inv.gst_total) + '</span></div>' +
      '<div class="strong"><span>Total AUD</span><span>' + money(inv.total) + '</span></div><div><span>Amount paid</span><span>' + money(inv.amount_paid) + '</span></div><div class="strong"><span>Outstanding</span><span>' + money(inv.outstanding) + '</span></div></div>' +
      (editing ? '<p style="font-size:12.5px;margin-top:14px"><b>Notes</b><br>' + hdrEd('notes', inv.notes, 'Notes printed on the invoice') + '</p>'
        : (inv.notes ? '<p style="font-size:12.5px;margin-top:14px"><b>Notes</b><br>' + esc(inv.notes) + '</p>' : '')) +
      '</div></div>' +
      '<aside class="inv-side">' +
      '<div class="inv-panel"><h3>Payments</h3><div class="inv-progress"><i style="width:' + paidPct + '%"></i></div><div class="inv-dim">' + money(inv.amount_paid) + ' / ' + money(inv.total) + ' AUD</div>' +
      (d.payments.length ? '<div style="margin-top:8px">' + d.payments.map(function (p) { return '<div class="inv-dim">' + dmy(p.paid_on) + ' · ' + aud(p.amount) + (p.method ? ' · ' + esc(p.method) : '') + (p.reference ? ' · ' + esc(p.reference) : '') + '</div>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="inv-panel"><h3>Details</h3><div class="inv-kv">' +
      '<div class="k">Status</div><div>' + pill(inv.display_status) + '</div>' +
      '<div class="k">Sent</div><div>' + (inv.sent_status === 'SENT' ? dt(inv.sent_at) + (inv.sent_to ? ' to ' + esc(inv.sent_to) : '') : 'Not sent') + '</div>' +
      (inv.finalised_at ? '<div class="k">Finalised</div><div>' + dt(inv.finalised_at) + (inv.finalised_by_name ? ' by ' + esc(inv.finalised_by_name) : '') + '</div>' : '') +
      (inv.trip_name ? '<div class="k">Trip</div><div><button class="inv-link" data-inv="open-trip" data-id="' + esc(inv.trip_id) + '">' + esc(inv.trip_name) + '</button></div>' : '') +
      '<div class="k">Client record</div><div><button class="inv-link" data-inv="open-client" data-client="' + esc(inv.client_id) + '">Billing profile</button></div>' +
      '</div></div>' +
      '<div class="inv-panel"><h3>Documents</h3>' + (d.documents.length ? d.documents.map(function (doc) {
        return '<div class="inv-dim"><a href="' + API + '/documents/' + encodeURIComponent(doc.id) + '" target="_blank" rel="noopener">' + esc(doc.file_name) + '</a> · v' + doc.version + (doc.is_final ? ' · final (locked)' : ' · draft') + ' · ' + dt(doc.generated_at) + '</div>';
      }).join('') : '<div class="inv-dim">No stored PDFs yet. Download or finalise to store one.</div>') + '</div>' +
      '<div class="inv-panel"><h3>Audit trail</h3><div id="inv-audit" class="inv-dim">' + skel(2) + '</div></div>' +
      '</aside></div>';
    state.detail = d;
    get('/invoices/' + encodeURIComponent(id) + '/audit').then(function (a) {
      var box = document.getElementById('inv-audit');
      if (!box) return;
      box.innerHTML = a.events.length ? a.events.slice(0, 40).map(function (ev) {
        return '<div style="margin-bottom:6px"><b>' + esc(ev.action.replace(/[._]/g, ' ')) + '</b> · ' + dt(ev.created_at) + (ev.actor_name ? ' · ' + esc(ev.actor_name) : '') + (ev.reason ? '<br>“' + esc(ev.reason) + '”' : '') + '</div>';
      }).join('') : 'No events.';
    }).catch(function () {});
  }

  // ── Quick fix ────────────────────────────────────────────────────────────
  // One small pop-up per attention item that asks only for the missing thing.
  // Client answers are saved on the client's billing profile (and a payer in the
  // payer directory), so later invoices — and other clients with the same payer —
  // already have them; block answers are remembered per calendar block.
  var QUICK_FIX = ['CLIENT_MISSING_PAYER', 'NDIS_NUMBER_MISSING', 'CLIENT_ADDRESS_MISSING', 'MMM_UNRESOLVED', 'MMM_REVIEW',
    'SESSION_MMM_UNRESOLVED', 'SESSION_MMM_REVIEW', 'CASE_NOTE_MISSING', 'REPORT_NOT_BILLED', 'TRAVEL_BLOCK_NOT_INVOICED',
    'TRAVEL_BLOCK_NO_CLIENT', 'FLIGHT_NO_TRIP'];
  state.issueCache = state.issueCache || {};
  function zoneSelect() {
    var o = '<option value="">Choose…</option>';
    for (var z = 1; z <= 7; z++) o += '<option value="' + z + '">MM' + z + (z === 1 ? ' — metro' : z >= 6 ? ' — remote' : '') + '</option>';
    return '<select name="zone" required>' + o + '</select>';
  }
  function qfButtons(list) {
    return '<button class="btn" data-inv="close-modal">Cancel</button>' + list.map(function (b, i) {
      return '<button class="btn' + (i === list.length - 1 ? ' primary' : '') + '" data-inv="qf-answer" data-answer="' + esc(b[0]) + '">' + esc(b[1]) + '</button>';
    }).join('');
  }
  async function openQuickFix(issueId) {
    var i = state.issueCache[issueId];
    if (!i) return;
    var t = i.fix_target || {};
    if (i.issue_type === 'NF2F_UNTIMED' && window.Nf2f) return window.Nf2f.openResolve(t.eventId);
    var who = t.clientName || '';
    var html = '', foot = '', title = 'Quick fix';
    state.qf = { issue: i, profile: null, payers: [] };
    switch (i.issue_type) {
      case 'CLIENT_MISSING_PAYER': {
        var cl = await get('/clients/' + encodeURIComponent(i.client_id)).catch(function () { return {}; });
        var py = await get('/payers').catch(function () { return { payers: [] }; });
        var p = cl.profile || {}, last = (cl.payerHistory || [])[0] || {};
        state.qf.payers = py.payers || [];
        who = p.participant_name || who;
        // Pattern: the payer this client was last invoiced to, else their plan type.
        var guessName = p.payer_name || last.payer_name || last.name || '';
        var guessType = p.payer_type || last.payer_type || (p.management_type === 'SELF_MANAGED' ? 'PARTICIPANT' : 'PLAN_MANAGER');
        var known = state.qf.payers.find(function (x) { return x.name === guessName; });
        title = 'Who pays for ' + (who || 'this client') + '?';
        html = '<form class="inv-form inv-qf" id="inv-qf-form"><label>Paid by<select name="payerType">' +
          [['PLAN_MANAGER', 'Plan manager'], ['PARTICIPANT', 'The participant'], ['NOMINEE', 'Nominee'], ['OTHER', 'Someone else']].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === guessType ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
          '</select></label><label>Name<input name="payerName" list="inv-qf-payers" value="' + esc(guessName) + '" autocomplete="off" required></label>' +
          '<label>Invoice email<input name="payerEmail" type="email" value="' + esc(p.payer_email || (known && known.email) || '') + '"></label>' +
          '<datalist id="inv-qf-payers">' + state.qf.payers.map(function (x) { return '<option value="' + esc(x.name) + '">'; }).join('') + '</datalist></form>' +
          (guessName ? '<div class="inv-dim">Suggested from ' + (p.payer_name ? 'the client record' : 'their last invoice') + '.</div>' : '');
        foot = qfButtons([['save', 'Save']]);
        break;
      }
      case 'NDIS_NUMBER_MISSING':
        title = 'NDIS number' + (who ? ' for ' + who : '');
        html = '<form class="inv-form inv-qf" id="inv-qf-form"><label>NDIS number<input name="ndisNumber" inputmode="numeric" pattern="[0-9 ]{9,12}" required></label></form>';
        foot = qfButtons([['save', 'Save']]); break;
      case 'CLIENT_ADDRESS_MISSING':
        title = 'Where are ' + (who ? who + "'s" : 'the') + ' sessions?';
        html = '<form class="inv-form inv-qf" id="inv-qf-form"><label class="wide">Address<input name="serviceAddress" autocomplete="street-address" required></label></form>';
        foot = qfButtons([['save', 'Save']]); break;
      case 'MMM_UNRESOLVED': case 'MMM_REVIEW':
        title = 'Which MMM zone' + (who ? ' is ' + who + ' in' : '') + '?';
        html = '<form class="inv-form inv-qf" id="inv-qf-form"><label>Zone' + zoneSelect() + '</label></form>';
        foot = qfButtons([['save', 'Save']]); break;
      case 'SESSION_MMM_UNRESOLVED': case 'SESSION_MMM_REVIEW':
        title = 'Which MMM zone was this session in?';
        html = '<div class="inv-dim">' + esc(i.message) + '</div><form class="inv-form inv-qf" id="inv-qf-form"><label>Zone' + zoneSelect() + '</label></form>';
        foot = qfButtons([['save', 'Save']]); break;
      case 'CASE_NOTE_MISSING':
        title = 'Case noting for this session';
        html = '<div class="inv-dim">' + esc(i.message.split('. ')[0]) + '.</div><form class="inv-form inv-qf" id="inv-qf-form"><label>Case-noting minutes<input name="minutes" inputmode="numeric" type="number" min="1" max="600" step="1" required></label></form>';
        foot = qfButtons([['leave', 'No case noting'], ['save', 'Add to invoice']]); break;
      case 'REPORT_NOT_BILLED':
        title = 'Bill ' + (t.label || 'this report') + '?';
        html = '<div>' + esc((t.label || 'Report writing') + (t.clientName ? ' for ' + t.clientName : '') + ', ' + dmy(t.date) + ', ' + (t.minutes || '?') + ' min') + '</div>';
        foot = qfButtons([['NOT_BILLABLE', 'Not billable'], ['SPLOSE', 'Billed in Splose'], ['BILL', 'Bill it']]); break;
      case 'TRAVEL_BLOCK_NOT_INVOICED':
        title = 'Bill this travel?';
        html = '<div>' + esc((t.minutes || '?') + ' min travel block, ' + dmy(t.date) + (t.clientName ? ', for ' + t.clientName : '')) + '</div>';
        foot = qfButtons([['NOT_BILLABLE', 'Already a travel leg'], ['BILL', 'Bill it']]); break;
      case 'TRAVEL_BLOCK_NO_CLIENT':
        title = 'Whose travel is this?';
        html = '<div>' + esc((t.minutes || '?') + ' min travel block, ' + dmy(t.date)) + ' names no client. Add the client on the calendar, or mark it not billable.</div>';
        foot = qfButtons([['calendar', 'Open calendar'], ['NOT_BILLABLE', 'Not billable']]); break;
      case 'FLIGHT_NO_TRIP':
        title = 'Flight not on a trip';
        html = '<div>' + esc(i.message) + '</div>';
        foot = qfButtons([['NOT_BILLABLE', 'Not billable'], ['trip', 'Create a trip']]); break;
      default: return;
    }
    modal(title, html + '<div id="inv-qf-msg"></div>', foot);
    var first = document.querySelector('#inv-qf-form input, #inv-qf-form select');
    if (first) first.focus();
    var nameIn = document.querySelector('#inv-qf-form [name="payerName"]');
    if (nameIn) nameIn.addEventListener('change', function () {
      // Picking a known payer fills its email: entered once, used for every client.
      var k = state.qf.payers.find(function (x) { return x.name === nameIn.value; });
      var em = document.querySelector('#inv-qf-form [name="payerEmail"]');
      if (k && em && !em.value) em.value = k.email || '';
      var ty = document.querySelector('#inv-qf-form [name="payerType"]');
      if (k && ty && k.payer_type) ty.value = k.payer_type;
    });
  }
  async function saveQuickFix(btn) {
    var q = state.qf; if (!q) return;
    var i = q.issue, t = i.fix_target || {}, ans = btn.dataset.answer;
    var msg = document.getElementById('inv-qf-msg');
    var f = document.getElementById('inv-qf-form');
    if (ans === 'save' && f && !f.reportValidity()) return;
    var v = function (n) { return f && f.elements[n] ? f.elements[n].value.trim() : ''; };
    btn.disabled = true;
    try {
      var out;
      switch (i.issue_type) {
        case 'CLIENT_MISSING_PAYER': {
          var known = q.payers.find(function (x) { return x.name === v('payerName'); });
          await put('/clients/' + encodeURIComponent(i.client_id), known && (!v('payerEmail') || v('payerEmail') === known.email)
            ? { payerId: known.id } : { payerType: v('payerType'), payerName: v('payerName'), payerEmail: v('payerEmail') || null });
          out = await post('/issues/' + i.id + '/quick-fix'); break;
        }
        case 'NDIS_NUMBER_MISSING':
          await put('/clients/' + encodeURIComponent(i.client_id), { ndisNumber: v('ndisNumber') });
          out = await post('/issues/' + i.id + '/quick-fix'); break;
        case 'CLIENT_ADDRESS_MISSING':
          await put('/clients/' + encodeURIComponent(i.client_id), { serviceAddress: v('serviceAddress') });
          out = await post('/issues/' + i.id + '/quick-fix'); break;
        case 'MMM_UNRESOLVED': case 'MMM_REVIEW':
          await put('/clients/' + encodeURIComponent(i.client_id) + '/mmm-override', { zone: v('zone'), reason: 'Quick fix' });
          out = await post('/issues/' + i.id + '/quick-fix'); break;
        case 'SESSION_MMM_UNRESOLVED': case 'SESSION_MMM_REVIEW':
          await put('/events/' + encodeURIComponent(t.eventId || i.calendar_event_id) + '/mmm', { zone: v('zone'), reason: 'Quick fix' });
          out = await post('/issues/' + i.id + '/quick-fix'); break;
        case 'CASE_NOTE_MISSING':
          out = await post('/issues/' + i.id + '/quick-fix', ans === 'leave' ? { leaveOff: true } : { minutes: v('minutes') }); break;
        case 'TRAVEL_BLOCK_NO_CLIENT':
          if (ans === 'calendar') { closeModal(); if (typeof window.switchTab === 'function') window.switchTab('calendar'); return; }
          out = await post('/issues/' + i.id + '/quick-fix', { decision: ans }); break;
        case 'FLIGHT_NO_TRIP':
          if (ans === 'trip') { closeModal(); await openNewTrip(); return; }
          out = await post('/issues/' + i.id + '/quick-fix', { decision: ans }); break;
        default:
          out = await post('/issues/' + i.id + '/quick-fix', { decision: ans });
      }
      closeModal();
      toast('Fixed', out && out.job ? 'The client\'s drafts are being updated in the background' : (out && out.stillMissing && out.stillMissing.length ? 'Something else is still missing for this client' : 'Saved for next time too'));
      if (out && out.job) watchJob(out.job.jobId, null);
      loadOverview();
      if (state.invoiceId) refreshDetail(); else if (state.section === 'attention') go('attention');
    } catch (e) { btn.disabled = false; if (msg) msg.innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
  }

  function fixButton(i) {
    if (i && i.id) state.issueCache[i.id] = i;
    if (i && QUICK_FIX.indexOf(i.issue_type) >= 0) return '<button class="btn btn-xs primary" data-inv="quick-fix" data-id="' + esc(i.id) + '">Quick fix</button>';
    if (i && i.issue_type === 'NF2F_UNTIMED') { var tt = i.fix_target || {}; return '<button class="btn btn-xs primary" data-inv="nf2f-resolve" data-id="' + esc(tt.eventId) + '">Quick fix</button>'; }
    var t = i.fix_target || {};
    if (t.kind === 'client') return '<button class="btn btn-xs" data-inv="open-client" data-client="' + esc(t.clientId) + '">Fix client</button>';
    if (t.kind === 'invoice') return '<button class="btn btn-xs" data-inv="open" data-id="' + esc(t.invoiceId) + '">Open invoice</button>';
    if (t.kind === 'rate_cards') return '<button class="btn btn-xs" data-inv="goto" data-sec="settings">Rate cards</button>';
    if (t.kind === 'trip') return '<button class="btn btn-xs" data-inv="open-trip" data-id="' + esc(t.tripId) + '" data-tab="' + esc(t.tab || 'costs') + '">Open trip</button>';
    if (t.kind === 'route') return '<button class="btn btn-xs" data-inv="manual-route" data-o="' + esc(t.origin) + '" data-d="' + esc(t.destination) + '">Enter route</button>';
    if (t.kind === 'nf2f') return '<button class="btn btn-xs" data-inv="nf2f-resolve" data-id="' + esc(t.eventId) + '">Enter the time</button>';
    if (t.kind === 'event' || t.kind === 'work_location') return '<button class="btn btn-xs" data-inv="to-calendar" data-date="' + esc(t.date || '') + '">Open calendar</button>';
    return '';
  }

  // ── Complete invoicing ───────────────────────────────────────────────────
  function openCompleteInvoicing(opts) {
    var today = new Date();
    var mon = mondayOf(today);
    var ranges = {
      today: [ymdLocal(today), ymdLocal(today)],
      week: [ymdLocal(mon), ymdLocal(addDays(mon, 6))],
      last: [ymdLocal(addDays(mon, -7)), ymdLocal(addDays(mon, -1))],
      // The Monday routine: the previous working week, every practitioner.
      lastwork: [ymdLocal(addDays(mon, -7)), ymdLocal(addDays(mon, -3))],
    };
    var body =
      '<div class="inv-seg" role="group" aria-label="Period"><button type="button" data-range="lastwork" class="on">Last Mon–Fri</button><button type="button" data-range="today">Today</button><button type="button" data-range="week">This week</button><button type="button" data-range="last">Last week</button><button type="button" data-range="custom">Custom</button></div>' +
      '<div class="inv-field-row"><label class="inv-dim">From <input type="date" id="inv-run-from" value="' + ranges.lastwork[0] + '"></label><label class="inv-dim">To <input type="date" id="inv-run-to" value="' + ranges.lastwork[1] + '"></label>' +
      '<label class="inv-dim">Practitioner <select id="inv-run-prac"><option value="">All practitioners</option>' + state.practitioners.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<div class="inv-note">Completed, billable sessions in this period are priced from each client\'s MMM zone and the rate card for the service date, travel is divided across each practitioner\'s day, and sessions are grouped into one draft per client and plan manager. Anything that cannot be billed safely goes to <b>Needs attention</b>. Running it again never duplicates a charge.</div>' +
      '<div id="inv-run-auto" class="inv-dim"></div>' +
      '<div id="inv-run-result"></div>';
    var bd = modal('Complete invoicing', body, '<button class="btn" data-inv="close-modal">Close</button><button class="btn" data-inv="goto" data-sec="invoices" data-status="DRAFT,NEEDS_ATTENTION" id="inv-run-open">Open invoices</button><button class="btn primary" id="inv-run-go" data-inv="run-go">Create drafts</button>');
    // What the background already did, how many drafts wait, and a run still going.
    get('/overview').then(function (ov) {
      var c = ov.counts || {}, pend = (Number(c.draft) || 0) + (Number(c.needs_attention || c.needsAttention) || 0);
      var ob = document.getElementById('inv-run-open'); if (ob && pend) ob.textContent = 'Open invoices (' + pend + ' pending)';
      var a = ov.autoDrafts || {}, box = document.getElementById('inv-run-auto');
      if (box && a.enabled && a.lastAt && a.lastPeriod) {
        box.innerHTML = 'Drafts were prepared automatically ' + dt(a.lastAt) + ' for ' + dmy(a.lastPeriod.from) + ' – ' + dmy(a.lastPeriod.to) +
          '. Create drafts now only adds what changed since.';
      } else if (box && a.enabled) box.textContent = 'Drafts for the current week are prepared automatically each night.';
      if (box && a.lastError) box.innerHTML += ' <span class="inv-save-bad">' + esc(a.lastError) + '</span>';
      var j = ov.job;
      if (j && j.state === 'RUNNING') {
        var out = document.getElementById('inv-run-result'), go = document.getElementById('inv-run-go');
        if (out && go) { go.disabled = true; go.textContent = 'Working…'; out.innerHTML = '<div class="inv-progress-line"><span class="inv-spin" aria-hidden="true"></span><span id="inv-run-stage">' + esc(j.stage) + '…</span></div>'; watchJob(j.jobId, { out: out, btn: go, from: j.from, to: j.to }); }
      }
    }).catch(function () {});
    bd.__ranges = ranges;
    // One press on Monday: "Invoice last week" opens this and starts the run
    // for the previous Mon–Fri across all practitioners straight away.
    if (opts && opts.autorun) {
      var go = document.getElementById('inv-run-go');
      if (go) runInvoicing(go);
    }
    if (!state.practitioners.length) get('/practitioners').then(function (r) {
      state.practitioners = r.practitioners || [];
      var sel = document.getElementById('inv-run-prac');
      if (sel) sel.innerHTML = '<option value="">All practitioners</option>' + state.practitioners.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>'; }).join('');
    }).catch(function () {});
  }

  async function runInvoicing(btn) {
    var from = document.getElementById('inv-run-from').value, to = document.getElementById('inv-run-to').value;
    var prac = document.getElementById('inv-run-prac').value;
    var out = document.getElementById('inv-run-result');
    btn.disabled = true; btn.textContent = 'Working…';
    out.innerHTML = '<div class="inv-progress-line"><span class="inv-spin" aria-hidden="true"></span><span id="inv-run-stage">Starting…</span></div><div class="inv-dim">This runs in the background — you can close this and keep working. Drafts appear as soon as it finishes.</div>';
    try {
      var j = await post('/runs', { from: from, to: to, practitionerId: prac || null, background: true });
      watchJob(j.jobId, { out: out, btn: btn, from: from, to: to });
    } catch (e) {
      out.innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>';
      btn.disabled = false; btn.textContent = 'Create drafts';
    }
  }

  /** Poll a background run; draw its stage, then its summary (if the pop-up is still open). */
  function watchJob(jobId, ui) {
    var tries = 0;
    (function poll() {
      get('/runs/jobs/' + encodeURIComponent(jobId)).then(function (j) {
        var stage = document.getElementById('inv-run-stage');
        if (stage) stage.textContent = j.stage + '…';
        if (j.state === 'RUNNING') { tries++; setTimeout(poll, tries < 10 ? 1000 : 2000); return; }
        loadOverview();
        if (state.section === 'invoices' && !state.invoiceId) loadInvoiceList();
        if (state.invoiceId) refreshDetail();
        if (j.state === 'FAILED') {
          if (ui && document.body.contains(ui.out)) { ui.out.innerHTML = '<div class="inv-error">' + esc(j.error) + '</div>'; ui.btn.disabled = false; ui.btn.textContent = 'Create drafts'; }
          else toast('Drafts not finished', j.error);
          return;
        }
        var s = (j.result && j.result.summary) || {};
        if (ui && document.body.contains(ui.out)) renderRunSummary(s, ui.from, ui.to, ui.out);
        else toast('Drafts ready', (s.invoicesCreated || 0) + ' new, ' + (s.invoicesUpdated || 0) + ' updated' + (s.itemsNeedAttention ? ' · ' + s.itemsNeedAttention + ' need attention' : ''));
      }).catch(function (e) {
        if (e.status === 404) { if (ui && document.body.contains(ui.out)) ui.out.innerHTML = '<div class="inv-note">' + esc(e.message) + '</div>'; loadOverview(); return; }
        tries++; if (tries < 60) setTimeout(poll, 3000);
      });
    })();
  }

  function renderRunSummary(s, from, to, out) {
    var skipped = Object.keys(s.skipped || {}).reduce(function (a, k) { return a + s.skipped[k]; }, 0);
    out.innerHTML = '<div class="inv-ok">Drafts ready for ' + dmy(from) + ' – ' + dmy(to) + '.</div><div class="inv-summary">' +
      '<div><b>' + (s.invoicesCreated || 0) + '</b><span>invoices created</span></div>' +
      '<div><b>' + (s.invoicesUpdated || 0) + '</b><span>drafts updated</span></div>' +
      '<div><b>' + (s.sessionsIncluded || 0) + '</b><span>sessions included</span></div>' +
      '<div><b>' + (s.nf2fIncluded || 0) + '</b><span>case noting / non-face-to-face / reports</span></div>' +
      '<div><b>' + (s.travelAllocations || 0) + '</b><span>travel allocations</span></div>' +
      '<div><b>' + (s.sploseActivitiesIncluded || 0) + '</b><span>Splose support activities</span></div>' +
      '<div><b>' + ((s.alreadyInvoiced || 0) + (s.invoicedInSplose || 0)) + '</b><span>skipped — already invoiced</span></div>' +
      '<div><b>' + skipped + '</b><span>not billable (cancelled, DNA, future…)</span></div>' +
      '<div><b>' + (s.itemsNeedAttention || 0) + '</b><span>items need attention</span></div>' +
      '<div><b>' + aud(s.total) + '</b><span>value of touched drafts</span></div></div>';
    var btn = document.getElementById('inv-run-go'); if (btn) { btn.disabled = false; btn.textContent = 'Create drafts'; }
    var foot = document.getElementById('inv-modal-foot');
    if (foot) foot.innerHTML = '<button class="btn" data-inv="close-modal">Close</button>' + (s.itemsNeedAttention ? '<button class="btn" data-inv="goto" data-sec="attention">Needs attention (' + s.itemsNeedAttention + ')</button>' : '') + '<button class="btn primary" data-inv="goto" data-sec="invoices" data-status="DRAFT,NEEDS_ATTENTION">Open drafts</button>';
  }

  // ── Needs attention ──────────────────────────────────────────────────────
  async function renderAttention(el) {
    var r = await get('/issues');
    if (!r.issues.length) { el.innerHTML = '<div class="inv-panel inv-empty">Nothing needs attention. 🎉</div>'; return; }
    el.innerHTML = '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Item</th><th>Client</th><th>Date</th><th>Detail</th><th></th></tr></thead><tbody>' + r.issues.map(function (i) {
      return '<tr><td><span class="inv-pill ' + esc(i.severity) + '">' + esc(i.label) + '</span></td><td>' + esc(i.client_name || i.client_id || '—') + '</td><td>' + dmy(i.service_date) + '</td>' +
        '<td>' + esc(i.message) + (i.invoice_number ? '<div class="inv-dim">Invoice ' + esc(i.invoice_number) + '</div>' : '') + '</td>' +
        '<td style="white-space:nowrap">' + fixButton(i) + (QUICK_FIX.indexOf(i.issue_type) >= 0 || i.issue_type === 'NF2F_UNTIMED' ? '' : ' <button class="btn btn-xs" data-inv="reprocess" data-id="' + esc(i.id) + '">Reprocess</button>') + ' <button class="btn btn-xs" data-inv="dismiss" data-id="' + esc(i.id) + '">Dismiss</button></td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ── Client billing profiles ──────────────────────────────────────────────
  async function renderClients(el) {
    el.innerHTML = '<div class="inv-filters"><input type="search" id="inv-cl-q" placeholder="Search client, NDIS number, plan manager" aria-label="Search clients"></div><div id="inv-cl-list">' + skel(5) + '</div>';
    await loadClients('');
  }
  async function loadClients(q) {
    var box = document.getElementById('inv-cl-list');
    var r = await get('/clients' + (q ? '?q=' + encodeURIComponent(q) : ''));
    if (!r.clients.length) { box.innerHTML = '<div class="inv-panel inv-empty">No billing profiles yet. They are created automatically the first time invoicing meets a client, or open one from an attention item.</div>'; return; }
    box.innerHTML = '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Participant</th><th>NDIS number</th><th>Management</th><th>Invoice to</th><th>MMM</th><th>Issues</th></tr></thead><tbody>' + r.clients.map(function (c) {
      var zone = c.mmm_manual_override ? 'MM' + c.mmm_manual_override + ' (override)' : (c.mmm_zone ? 'MM' + c.mmm_zone + (c.mmm_confidence === 'REVIEW' ? ' (review)' : '') : '—');
      return '<tr class="clickable" data-inv="open-client" data-client="' + esc(c.client_id) + '"><td><button type="button" class="inv-link" data-inv="open-client" data-client="' + esc(c.client_id) + '">' + esc(c.participant_name || c.client_id) + '</button></td>' +
        '<td>' + esc(c.ndis_number || '—') + '</td><td>' + esc(String(c.management_type || '—').replace(/_/g, ' ').toLowerCase()) + '</td><td>' + esc(c.payer_name || '—') + '</td>' +
        '<td>' + esc(zone) + '</td><td>' + (c.open_issues ? '<span class="inv-pill NEEDS_ATTENTION">' + c.open_issues + '</span>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  var clTimer = null;
  document.addEventListener('input', function (e) { if (e.target.id === 'inv-cl-q') { clearTimeout(clTimer); var v = e.target.value.trim(); clTimer = setTimeout(function () { loadClients(v); }, 250); } });

  function opt(v, label, cur) { return '<option value="' + esc(v) + '"' + (String(cur || '') === String(v) ? ' selected' : '') + '>' + esc(label) + '</option>'; }

  var PAYER_TYPE_LABEL = { PLAN_MANAGER: 'Plan manager', PARTICIPANT: 'Participant', NOMINEE: 'Nominee', OTHER: 'Other' };
  function payerHistoryHtml(h) {
    if (!h || !h.length) return '<div class="inv-panel" style="margin-top:12px"><h3>Invoice history</h3><div class="inv-dim">No invoices on record for this client yet, so there is nobody to remember. Choose or enter the payer above; it is remembered from then on.</div></div>';
    return '<div class="inv-panel" style="margin-top:12px"><h3>Invoice history</h3><div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Sent to</th><th>Type</th><th class="num">Invoices</th><th>Latest</th></tr></thead><tbody>' +
      h.map(function (x) { return '<tr><td>' + esc(x.name) + (x.email ? '<div class="inv-dim">' + esc(x.email) + '</div>' : '') + '</td><td>' + esc(PAYER_TYPE_LABEL[x.payer_type] || x.payer_type) + '</td><td class="num">' + x.invoices + '</td><td>' + esc(x.last_invoice_number || '—') + ' · ' + dmy(x.last_issue_date) + ' (' + (x.last_source === 'OPAL' ? 'Opal' : 'Splose') + ')</td></tr>'; }).join('') +
      '</tbody></table></div></div>';
  }

  async function openClient(clientId) {
    var bd = modal('Client billing profile', skel(8), null, { wide: true });
    try {
      var both = await Promise.all([get('/clients/' + encodeURIComponent(clientId)), get('/payers').catch(function () { return { payers: [] }; })]);
      var r = both[0], payers = both[1].payers;
      state.payerList = payers;
      var p = r.profile;
      var zone = r.effectiveMmm ? 'MM' + r.effectiveMmm : 'Unresolved';
      var mmmInfo = p.mmm_manual_override
        ? 'Manual override MM' + p.mmm_manual_override + ' — “' + esc(p.mmm_override_reason || '') + '” (computed: ' + (p.mmm_zone ? 'MM' + p.mmm_zone : '—') + ')'
        : (p.mmm_zone ? 'MM' + p.mmm_zone + ' from ' + esc(p.mmm_dataset_version || 'dataset') + (p.mmm_confidence === 'REVIEW' ? ' — <b>needs confirmation</b> (' + esc(String(p.mmm_review_reason || '').replace(/_/g, ' ')) + ')' : '') + ' · checked ' + dt(p.mmm_checked_at)
          : 'Not classified' + (p.mmm_review_reason ? ' (' + esc(String(p.mmm_review_reason).replace(/_/g, ' ')) + ')' : '') + '.');
      document.getElementById('inv-modal-body').innerHTML =
        '<div class="inv-note"><b>Effective MMM: ' + esc(zone) + '</b><br>' + mmmInfo + (r.mmmDataset ? '<br><span class="inv-dim">Dataset: ' + esc(r.mmmDataset.version) + ' — ' + esc(r.mmmDataset.source) + '</span>' : '<br><span class="inv-dim">No MMM dataset is loaded on this server — set a manual zone or import the dataset (see docs).</span>') + '</div>' +
        '<form class="inv-form" id="inv-client-form">' +
        '<label>Participant name<input name="participantName" value="' + esc(p.participant_name || '') + '"></label>' +
        '<label>NDIS number<input name="ndisNumber" inputmode="numeric" maxlength="9" value="' + esc(p.ndis_number || '') + '"></label>' +
        '<label>Plan start<input type="date" name="planStart" value="' + esc((p.plan_start || '').slice(0, 10)) + '"></label>' +
        '<label>Plan end<input type="date" name="planEnd" value="' + esc((p.plan_end || '').slice(0, 10)) + '"></label>' +
        '<label>Management type<select name="managementType">' + opt('', '—', p.management_type) + opt('PLAN_MANAGED', 'Plan managed', p.management_type) + opt('SELF_MANAGED', 'Self managed', p.management_type) + opt('NDIA_MANAGED', 'NDIA (agency) managed', p.management_type) + opt('OTHER', 'Other / private', p.management_type) + '</select></label>' +
        '<label class="wide">Choose a payer from the directory<select id="inv-payer-pick" aria-describedby="inv-payer-pick-hint"><option value="">— or type a new payer below —</option>' +
          (payers || []).map(function (y) { return '<option value="' + esc(y.id) + '"' + (y.id === p.payer_id ? ' selected' : '') + '>' + esc(y.name) + ' · ' + esc(PAYER_TYPE_LABEL[y.payer_type] || y.payer_type) + (y.email ? ' · ' + esc(y.email) : ' · no email') + '</option>'; }).join('') +
          '</select><span class="inv-dim" id="inv-payer-pick-hint">A payer typed in for the first time is added to the directory and remembered for this client\'s later invoices.</span><input type="hidden" name="payerId" value="' + esc(p.payer_id || '') + '"></label>' +
        '<label>Payer type<select name="payerType">' + opt('', '—', p.payer_type) + opt('PLAN_MANAGER', 'Plan manager', p.payer_type) + opt('PARTICIPANT', 'Participant', p.payer_type) + opt('NOMINEE', 'Nominee', p.payer_type) + opt('OTHER', 'Other', p.payer_type) + '</select></label>' +
        '<label>Invoice to (plan manager / payer)<input name="payerName" value="' + esc(p.payer_name || '') + '">' + (p.payer_source_detail ? '<span class="inv-dim">From ' + esc(p.payer_source_detail) + '</span>' : '') + '</label>' +
        '<label>Payer email<input type="email" name="payerEmail" value="' + esc(p.payer_email || '') + '"></label>' +
        '<label>Payer reference<input name="payerReference" value="' + esc(p.payer_reference || '') + '"></label>' +
        '<label>Payment terms (days, blank = default)<input type="number" min="0" max="365" name="paymentTermsDays" value="' + esc(p.payment_terms_days == null ? '' : p.payment_terms_days) + '"></label>' +
        '<label class="wide">Client service address (used for MMM)<input name="serviceAddress" value="' + esc(p.service_address || '') + '"></label>' +
        '<label class="wide">Payer billing address<textarea name="payerAddress">' + esc(p.payer_address || '') + '</textarea></label>' +
        '<label class="wide">Participant billing address<textarea name="participantBillingAddress">' + esc(p.participant_billing_address || '') + '</textarea></label>' +
        '<label class="wide">Billing notes<textarea name="billingNotes">' + esc(p.billing_notes || '') + '</textarea></label>' +
        '</form><div id="inv-client-msg"></div>' +
        payerHistoryHtml(r.payerHistory) +
        '<div class="inv-panel" style="margin-top:12px"><h3>MMM override</h3><div class="inv-field-row"><select id="inv-mmm-zone"><option value="">No override</option>' + [1, 2, 3, 4, 5, 6, 7].map(function (z) { return opt(z, 'MM' + z, p.mmm_manual_override); }).join('') + '</select>' +
        '<input id="inv-mmm-reason" placeholder="Reason (required)" style="flex:1;min-width:200px"><button class="btn" type="button" data-inv="mmm-override" data-client="' + esc(clientId) + '">Save override</button><button class="btn" type="button" data-inv="mmm-refresh" data-client="' + esc(clientId) + '">Re-check address</button></div></div>';
      document.getElementById('inv-modal-body').insertAdjacentHTML('afterend', '<footer id="inv-modal-foot"><button class="btn" data-inv="import-splose" data-client="' + esc(clientId) + '">Fill blanks from Splose</button><button class="btn" data-inv="close-modal">Close</button><button class="btn primary" data-inv="save-client" data-client="' + esc(clientId) + '">Save profile</button></footer>');
    } catch (e) { denied(document.getElementById('inv-modal-body'), e); }
    return bd;
  }

  async function saveClient(clientId) {
    var form = document.getElementById('inv-client-form');
    var body = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name) body[el.name] = el.value.trim() === '' ? null : el.value.trim(); });
    var msg = document.getElementById('inv-client-msg');
    try {
      var r = await put('/clients/' + encodeURIComponent(clientId), body);
      msg.innerHTML = '<div class="inv-ok">Saved. Effective MMM: ' + (r.effectiveMmm ? 'MM' + r.effectiveMmm : 'unresolved') + '. Use Reprocess on the attention item (or run invoicing again) to apply it.</div>';
      loadOverview();
    } catch (e) { msg.innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
  }

  // ── Payer directory ──────────────────────────────────────────────────────
  async function renderPayers(el) {
    el.innerHTML = '<div class="inv-note">Everyone invoices have gone to: plan managers, participants and nominees. Filled from every Splose invoice (on each invoicing run, or now with the button), and from each invoice Opal finalises. A client with no payer gets the payer of their latest invoice here; a new client is given one by choosing it on their billing profile.</div>' +
      '<div class="inv-filters"><input type="search" id="inv-py-q" placeholder="Search payer name or email" aria-label="Search payers">' +
      '<button class="btn" type="button" data-inv="payers-import">Import all Splose invoices</button><button class="btn primary" type="button" data-inv="payer-new">Add payer</button></div>' +
      '<div id="inv-py-msg"></div><div id="inv-py-list">' + skel(5) + '</div>';
    await loadPayers('');
  }
  async function loadPayers(q) {
    var box = document.getElementById('inv-py-list');
    var r = await get('/payers' + (q ? '?q=' + encodeURIComponent(q) : ''));
    state.payerList = r.payers;
    if (!r.payers.length) { box.innerHTML = '<div class="inv-panel inv-empty">' + (q ? 'No payer matches.' : 'The directory is empty. Import the Splose invoices, or add a payer.') + '</div>'; return; }
    box.innerHTML = '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Payer</th><th>Type</th><th>Email</th><th class="num">Clients</th><th class="num">Invoices</th><th>Last invoiced</th><th>Source</th></tr></thead><tbody>' + r.payers.map(function (y) {
      return '<tr class="clickable" data-inv="payer-edit" data-id="' + esc(y.id) + '"><td><button type="button" class="inv-link" data-inv="payer-edit" data-id="' + esc(y.id) + '">' + esc(y.name) + '</button></td>' +
        '<td>' + esc(PAYER_TYPE_LABEL[y.payer_type] || y.payer_type) + '</td><td>' + (y.email ? esc(y.email) : '<span class="inv-pill NEEDS_ATTENTION">No email</span>') + '</td>' +
        '<td class="num">' + Math.max(y.linked_clients, y.history_clients) + '</td><td class="num">' + y.invoices + '</td><td>' + dmy(y.last_issue_date) + '</td>' +
        '<td>' + (y.source === 'SPLOSE_IMPORT' ? 'Splose' : 'Added in Opal') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  var pyTimer = null;
  document.addEventListener('input', function (e) { if (e.target.id === 'inv-py-q') { clearTimeout(pyTimer); var v = e.target.value.trim(); pyTimer = setTimeout(function () { loadPayers(v); }, 250); } });
  function openPayer(id) {
    var y = id ? (state.payerList || []).find(function (x) { return x.id === id; }) : null;
    var t = y ? y.payer_type : 'PLAN_MANAGER';
    modal(y ? 'Payer' : 'Add payer', '<form class="inv-form" id="inv-payer-form">' +
      '<label>Name<input name="name" required value="' + esc(y ? y.name : '') + '"></label>' +
      '<label>Type<select name="payerType">' + ['PLAN_MANAGER', 'PARTICIPANT', 'NOMINEE', 'OTHER'].map(function (k) { return opt(k, PAYER_TYPE_LABEL[k], t); }).join('') + '</select></label>' +
      '<label>Invoice email<input type="email" name="email" value="' + esc(y && y.email ? y.email : '') + '"></label>' +
      '<label>Reference<input name="reference" value="' + esc(y && y.reference ? y.reference : '') + '"></label>' +
      '<label class="wide">Billing address<textarea name="address">' + esc(y && y.address ? y.address : '') + '</textarea></label>' +
      (y ? '<label class="wide"><span><input type="checkbox" name="archived"' + (y.archived ? ' checked' : '') + '> Archived (no longer offered for new clients)</span></label>' : '') +
      '</form>' + (y ? '<div class="inv-note">Changes apply to every client whose profile uses this payer (' + y.linked_clients + ') and to their drafts on the next run. Finalised invoices keep the details they were sent with.</div>' : '') +
      '<div id="inv-payer-msg"></div>',
      '<button class="btn" data-inv="close-modal">Close</button><button class="btn primary" data-inv="payer-save"' + (y ? ' data-id="' + esc(y.id) + '"' : '') + '>Save payer</button>');
  }
  async function savePayer(id) {
    var f = document.getElementById('inv-payer-form'), b = {};
    Array.prototype.forEach.call(f.elements, function (el) { if (!el.name) return; b[el.name] = el.type === 'checkbox' ? el.checked : (el.value.trim() || null); });
    try {
      if (id) await put('/payers/' + id, b); else await post('/payers', b);
      closeModal(); toast('Payer saved'); if (state.section === 'payers') loadPayers((document.getElementById('inv-py-q') || {}).value || '');
    } catch (e) { document.getElementById('inv-payer-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
  }
  // Choosing a directory payer fills the payer fields; editing the name afterwards makes it a new payer.
  document.addEventListener('change', function (e) {
    if (e.target.id !== 'inv-payer-pick') return;
    var form = document.getElementById('inv-client-form');
    var y = (state.payerList || []).find(function (x) { return x.id === e.target.value; });
    form.elements.payerId.value = y ? y.id : '';
    form.dataset.pickedFrom = y ? y.id : '';
    if (!y) return;
    form.elements.payerType.value = y.payer_type; form.elements.payerName.value = y.name;
    form.elements.payerEmail.value = y.email || ''; form.elements.payerReference.value = y.reference || ''; form.elements.payerAddress.value = y.address || '';
  });
  document.addEventListener('input', function (e) {
    var form = document.getElementById('inv-client-form');
    if (!form || e.target.form !== form || e.target.name !== 'payerName') return;
    form.elements.payerId.value = ''; var pick = document.getElementById('inv-payer-pick'); if (pick) pick.value = '';
    // A new name is a new payer: the picked payer's contact details must not carry over to it.
    if (form.dataset.pickedFrom) {
      form.dataset.pickedFrom = '';
      form.elements.payerEmail.value = ''; form.elements.payerReference.value = ''; form.elements.payerAddress.value = '';
    }
  });

  // ── Runs ─────────────────────────────────────────────────────────────────
  async function renderRuns(el) {
    var r = await get('/runs');
    if (!r.runs.length) { el.innerHTML = '<div class="inv-panel inv-empty">No invoicing runs yet.</div>'; return; }
    el.innerHTML = '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>When</th><th>Type</th><th>Period</th><th>By</th><th class="num">Created</th><th class="num">Updated</th><th class="num">Sessions</th><th class="num">Travel</th><th class="num">Attention</th><th class="num">Already invoiced</th></tr></thead><tbody>' + r.runs.map(function (x) {
      var s = x.summary || {};
      return '<tr><td>' + dt(x.created_at) + '</td><td>' + esc(x.kind === 'TRIP' ? 'Trip: ' + (x.trip_name || '') : x.kind.toLowerCase()) + '</td><td>' + dmy(x.period_start) + ' – ' + dmy(x.period_end) + '</td><td>' + esc(x.created_by || '—') + '</td>' +
        '<td class="num">' + (s.invoicesCreated || 0) + '</td><td class="num">' + (s.invoicesUpdated || 0) + '</td><td class="num">' + (s.sessionsIncluded || 0) + '</td><td class="num">' + (s.travelAllocations || 0) + '</td><td class="num">' + (s.itemsNeedAttention || 0) + '</td><td class="num">' + (s.alreadyInvoiced || 0) + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  // ── Trips ────────────────────────────────────────────────────────────────
  async function renderTrips(el) {
    if (state.tripId) return renderTripDetail(el, state.tripId);
    var r = await get('/trips');
    var head = '<div class="inv-field-row" style="margin-top:0"><button class="btn primary" data-inv="new-trip">New trip</button><span class="inv-dim">Rural and remote service trips: sessions, travel and shared operating costs invoiced together.</span></div>';
    if (!r.trips.length) { el.innerHTML = head + '<div class="inv-panel inv-empty">No trips yet.</div>'; return; }
    el.innerHTML = head + '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Trip</th><th>Location</th><th>Dates</th><th>Practitioner</th><th class="num">Clients</th><th class="num">Sessions invoiced</th><th class="num">Eligible shared costs</th><th class="num">Allocated</th><th>Status</th></tr></thead><tbody>' + r.trips.map(function (t) {
      return '<tr class="clickable" data-inv="open-trip" data-id="' + esc(t.id) + '"><td><button type="button" class="inv-link" data-inv="open-trip" data-id="' + esc(t.id) + '">' + esc(t.name) + '</button></td><td>' + esc(t.destination || '—') + (t.mmm_context ? ' <span class="inv-pill mmm">MM' + t.mmm_context + '</span>' : '') + '</td>' +
        '<td>' + dmy(t.start_date && String(t.start_date).slice(0, 10)) + ' – ' + dmy(t.end_date && String(t.end_date).slice(0, 10)) + '</td><td>' + esc(t.practitioner_names || '—') + '</td><td class="num">' + t.client_count + '</td><td class="num">' + t.invoiced_sessions + '</td>' +
        '<td class="num">' + money(t.eligible_costs) + '</td><td class="num">' + money(t.allocated) + '</td><td><span class="inv-pill">' + esc(t.status.replace(/_/g, ' ').toLowerCase()) + '</span></td></tr>';
    }).join('') + '</tbody></table></div>';
  }

  function tripForm(t) {
    t = t || {};
    var sel = (t.practitioners || []).map(function (p) { return p.user_id; });
    return '<form class="inv-form" id="inv-trip-form">' +
      '<label class="wide">Trip name<input name="name" required value="' + esc(t.name || '') + '" placeholder="East Kimberley – October 2026"></label>' +
      '<label>Destination<input name="destination" value="' + esc(t.destination || '') + '" placeholder="Kununurra / Derby"></label>' +
      '<label>MMM context<select name="mmmContext">' + opt('', '—', t.mmm_context) + [1, 2, 3, 4, 5, 6, 7].map(function (z) { return opt(z, 'MM' + z, t.mmm_context); }).join('') + '</select></label>' +
      '<label>Start date<input type="date" name="startDate" required value="' + esc(t.start_date ? String(t.start_date).slice(0, 10) : '') + '"></label>' +
      '<label>End date<input type="date" name="endDate" required value="' + esc(t.end_date ? String(t.end_date).slice(0, 10) : '') + '"></label>' +
      '<label>Allocation method<select name="allocationMethod">' + opt('EQUAL_PER_CLIENT', 'Equal per unique client', t.allocation_method) + opt('PER_SESSION', 'Per billable session', t.allocation_method) + opt('MANUAL_WEIGHTED', 'Manual weighted', t.allocation_method) + '</select></label>' +
      (t.id ? '<label>Status<select name="status">' + ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CLOSED'].map(function (s) { return opt(s, s.replace('_', ' ').toLowerCase(), t.status); }).join('') + '</select></label>' : '') +
      '<label class="wide">Practitioner(s)<select name="practitionerIds" multiple size="4">' + state.practitioners.map(function (p) { return '<option value="' + esc(p.id) + '"' + (sel.indexOf(p.id) >= 0 ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label>Trip travel hours (flying + driving)<input type="number" min="0" max="500" step="0.25" name="travelHours" value="' + esc(t.travel_hours == null ? '' : t.travel_hours) + '" title="MMM6–7: the whole trip\'s travel, divided by the clients seen on the trip. Blank = worked out day by day from the calendar."></label>' +
      '<label class="wide">Travel route information<textarea name="routeNotes">' + esc(t.route_notes || '') + '</textarea></label>' +
      '<label class="wide">Notes<textarea name="notes">' + esc(t.notes || '') + '</textarea></label></form><div id="inv-trip-msg"></div>';
  }
  function readTripForm() {
    var f = document.getElementById('inv-trip-form');
    var b = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name) return;
      if (el.name === 'practitionerIds') b.practitionerIds = Array.prototype.filter.call(el.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
      else b[el.name] = el.value === '' ? null : el.value;
    });
    return b;
  }

  async function openNewTrip() {
    if (!state.practitioners.length) { try { state.practitioners = (await get('/practitioners')).practitioners; } catch (_) { /* shown by the form */ } }
    modal('Invoice a trip — new trip', tripForm(null), '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="create-trip">Create trip</button>', { wide: true });
  }

  var TRIP_TABS = [['overview', 'Overview'], ['sessions', 'Sessions'], ['clients', 'Clients'], ['travel', 'Travel'], ['costs', 'Costs'], ['allocations', 'Allocations'], ['invoices', 'Invoices'], ['documents', 'Documents']];
  var COST_CATS = ['FLIGHTS', 'ACCOMMODATION', 'CAR_HIRE', 'FUEL', 'TAXI_RIDESHARE', 'PARKING', 'BAGGAGE', 'REMOTE_TRAVEL', 'OTHER'];
  var MODE_LABEL = { UNCLASSIFIED: 'Not classified', SHARED_BILLABLE: 'Shared billable trip cost', NON_BILLABLE: 'Business / non-billable' };

  async function renderTripDetail(el, id) {
    el.innerHTML = skel(10);
    var d = await get('/trips/' + encodeURIComponent(id));
    state.tripData = d;
    var t = d.trip, a = d.allocationPreview.totals;
    var head = '<div class="inv-detail-head"><h2 style="font-size:22px">' + esc(t.name) + ' <span class="inv-pill">' + esc(t.status.toLowerCase().replace('_', ' ')) + '</span></h2><div class="inv-actions">' +
      '<button class="btn" data-inv="trips-back">← All trips</button><button class="btn" data-inv="edit-trip" data-id="' + esc(t.id) + '">Edit trip</button>' +
      '<button class="btn primary" data-inv="gen-trip" data-id="' + esc(t.id) + '">Generate Trip Invoices</button></div></div>' +
      '<div class="inv-dim" style="margin:-8px 0 10px">' + esc(t.destination || '') + ' · ' + dmy(String(t.start_date).slice(0, 10)) + ' – ' + dmy(String(t.end_date).slice(0, 10)) + ' · ' + esc((t.practitioners || []).map(function (p) { return p.name; }).join(', ') || 'no practitioner') + ' · ' + d.clients.filter(function (c) { return c.included; }).length + ' clients</div>' +
      (d.allocationPreview.unclassifiedCount ? '<div class="inv-warn">' + d.allocationPreview.unclassifiedCount + ' cost(s) are not classified yet. Mark each as shared billable or business / non-billable before trip costs can be allocated.</div>' : '') +
      '<div class="inv-tabs" role="tablist">' + TRIP_TABS.map(function (x) { return '<button type="button" role="tab" data-inv="trip-tab" data-tab="' + x[0] + '" class="' + (state.tripTab === x[0] ? 'on' : '') + '">' + esc(x[1]) + '</button>'; }).join('') + '</div>';
    var recon = '<div class="inv-recon">' +
      '<div><b>' + aud(a.totalCosts) + '</b><span>Total trip costs</span></div><div><b>' + aud(a.nonBillableCosts) + '</b><span>Non-billable</span></div>' +
      '<div><b>' + aud(a.unclassifiedCosts) + '</b><span>Not classified</span></div><div><b>' + aud(a.eligibleSharedCosts) + '</b><span>Eligible shared costs</span></div>' +
      '<div><b>' + a.clientCount + '</b><span>Participating clients</span></div><div><b>' + aud(a.allocated) + '</b><span>Allocated</span></div><div><b>' + aud(a.unallocated) + '</b><span>Remaining / unallocated</span></div></div>';
    var body = '';
    var tab = state.tripTab;
    if (tab === 'overview') {
      body = '<div class="inv-panel"><h3>Cost reconciliation</h3>' + recon + '</div>' +
        '<div class="inv-panel"><h3>Summary</h3><div class="inv-kv"><div class="k">Allocation method</div><div>' + esc(String(t.allocation_method).replace(/_/g, ' ').toLowerCase()) + '</div>' +
        '<div class="k">Sessions in window</div><div>' + d.sessions.length + ' (' + d.sessions.filter(function (s) { return s.invoice; }).length + ' invoiced)</div>' +
        '<div class="k">Invoices</div><div>' + d.invoices.length + '</div>' +
        '<div class="k">MMM context</div><div>' + (t.mmm_context ? 'MM' + t.mmm_context : '—') + ' <span class="inv-dim">(each client is still priced from their own MMM)</span></div>' +
        (t.route_notes ? '<div class="k">Route</div><div>' + esc(t.route_notes) + '</div>' : '') + (t.notes ? '<div class="k">Notes</div><div>' + esc(t.notes) + '</div>' : '') + '</div></div>';
    } else if (tab === 'sessions') {
      body = d.sessions.length ? '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Date</th><th>Client</th><th>Practitioner</th><th>Location</th><th>Status</th><th>Invoice</th></tr></thead><tbody>' + d.sessions.map(function (s) {
        return '<tr><td>' + dmy(s.date) + ' ' + new Date(s.start).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) + '</td><td>' + esc(s.clientName || '—') + '</td><td>' + esc(s.practitioner) + '</td><td>' + esc(s.location || '—') + '</td>' +
          '<td>' + esc(s.attendance ? s.attendance.replace(/_/g, ' ').toLowerCase() : s.status) + '</td><td>' + (s.invoice ? '<button class="inv-link" data-inv="open" data-id="' + esc(s.invoice.invoice_id) + '">' + esc(s.invoice.invoice_number) + '</button>' : '<span class="inv-dim">not invoiced</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="inv-panel inv-empty">No calendar sessions for the trip\'s practitioners in these dates.</div>';
    } else if (tab === 'clients') {
      body = '<div class="inv-field-row" style="margin-top:0"><input id="inv-trip-add-client" placeholder="Splose client id to add manually"><button class="btn" data-inv="trip-add-client" data-id="' + esc(t.id) + '">Add client</button></div>' +
        '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Client</th><th>NDIS</th><th>Invoice to</th><th>MMM</th><th>Included</th><th class="num">Weight</th><th></th></tr></thead><tbody>' + d.clients.map(function (c) {
          return '<tr><td>' + esc(c.client_name || c.client_id) + (c.added_manually ? ' <span class="inv-dim">(added)</span>' : '') + '</td><td>' + esc(c.ndis_number || '—') + '</td><td>' + esc(c.payer_name || '—') + '</td><td>' + (c.mmm_manual_override ? 'MM' + c.mmm_manual_override : (c.mmm_zone ? 'MM' + c.mmm_zone : '—')) + '</td>' +
            '<td>' + (c.included ? 'Yes' : 'No') + '</td><td class="num">' + esc(c.weight) + '</td><td><button class="btn btn-xs" data-inv="trip-client" data-id="' + esc(t.id) + '" data-client="' + esc(c.client_id) + '" data-included="' + (c.included ? '1' : '0') + '" data-weight="' + esc(c.weight) + '">Change</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    } else if (tab === 'travel') {
      body = d.travel.length ? '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Date</th><th>Client</th><th class="num">Day total</th><th class="num">Sessions</th><th class="num">Share</th><th class="num">Cap</th><th class="num">Claimable</th><th class="num">Labour</th><th class="num">Km</th><th class="num">Vehicle</th></tr></thead><tbody>' + d.travel.map(function (x) {
        return '<tr><td>' + dmy(x.service_date) + '</td><td>' + esc(x.client_id) + '</td><td class="num">' + esc(x.day_total_minutes) + ' min / ' + esc(x.day_total_km) + ' km</td><td class="num">' + x.sessions_in_day + '</td><td class="num">' + esc(x.allocated_minutes_before_cap) + '</td><td class="num">' + (x.cap_minutes == null ? 'none' : esc(x.cap_minutes)) + '</td><td class="num">' + esc(x.claimable_minutes) + '</td><td class="num">' + money(x.labour_amount) + '</td><td class="num">' + esc(x.allocated_km) + '</td><td class="num">' + money(x.vehicle_amount) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="inv-panel inv-empty">Travel allocations appear here after Generate Trip Invoices.</div>';
    } else if (tab === 'costs') {
      body = '<div class="inv-panel"><h3>Add cost</h3><form class="inv-form" id="inv-cost-form">' +
        '<label>Category<select name="category">' + COST_CATS.map(function (c) { return opt(c, c.replace('_', ' ').toLowerCase(), ''); }).join('') + '</select></label>' +
        '<label>Amount (AUD)<input name="amount" inputmode="decimal" required></label><label>Date<input type="date" name="costDate"></label>' +
        '<label>Supplier<input name="supplier"></label><label class="wide">Description<input name="description"></label>' +
        '<label>Classification<select name="billableMode">' + opt('UNCLASSIFIED', MODE_LABEL.UNCLASSIFIED, '') + opt('SHARED_BILLABLE', MODE_LABEL.SHARED_BILLABLE, '') + opt('NON_BILLABLE', MODE_LABEL.NON_BILLABLE, '') + '</select></label>' +
        '<label class="wide">Notes<input name="notes"></label></form><div class="inv-field-row"><button class="btn primary" data-inv="add-cost" data-id="' + esc(t.id) + '">Add cost</button></div></div>' +
        (d.costs.length ? '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Supplier</th><th class="num">Amount</th><th>Classification</th><th>Receipt</th><th></th></tr></thead><tbody>' + d.costs.map(function (c) {
          return '<tr><td>' + dmy(c.cost_date && String(c.cost_date).slice(0, 10)) + '</td><td>' + esc(c.category.replace('_', ' ').toLowerCase()) + '</td><td>' + esc(c.description || '') + '</td><td>' + esc(c.supplier || '') + '</td><td class="num">' + money(c.amount) + '</td>' +
            '<td><select data-inv-cost-mode="' + esc(c.id) + '" data-trip="' + esc(t.id) + '" aria-label="Classification">' + ['UNCLASSIFIED', 'SHARED_BILLABLE', 'NON_BILLABLE'].map(function (m) { return opt(m, MODE_LABEL[m], c.billable_mode); }).join('') + '</select></td>' +
            '<td>' + (c.receipt_file_name ? '<a href="' + API + '/trips/' + encodeURIComponent(t.id) + '/costs/' + encodeURIComponent(c.id) + '/receipt?disposition=inline" target="_blank" rel="noopener">' + esc(c.receipt_file_name) + '</a>' : '') + ' <label class="btn btn-xs" style="cursor:pointer">Attach<input type="file" hidden accept="application/pdf,image/*" data-inv-receipt="' + esc(c.id) + '" data-trip="' + esc(t.id) + '"></label></td>' +
            '<td><button class="btn btn-xs" data-inv="del-cost" data-id="' + esc(t.id) + '" data-cost="' + esc(c.id) + '">Remove</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="inv-panel inv-empty">No costs recorded.</div>');
    } else if (tab === 'allocations') {
      var prev = d.allocationPreview.allocations;
      body = '<div class="inv-panel"><h3>Reconciliation</h3>' + recon + '</div>' +
        '<div class="inv-note">Preview using the current costs and clients (' + esc(String(a.method).replace(/_/g, ' ').toLowerCase()) + '). Generate Trip Invoices records this allocation and adds one trip-cost line per client. The allocation always sums exactly to the eligible pool.</div>' +
        (prev.length ? '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Client</th><th class="num">Sessions</th><th class="num">Weight</th><th class="num">Preview</th><th class="num">Recorded</th></tr></thead><tbody>' + prev.map(function (x) {
          var cur = d.currentAllocations.find(function (c) { return c.client_id === x.clientId; });
          return '<tr><td>' + esc(x.clientName || x.clientId) + '</td><td class="num">' + x.sessionCount + '</td><td class="num">' + esc(x.weight) + '</td><td class="num">' + money(x.amount) + '</td><td class="num">' + (cur ? money(cur.amount) : '—') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="inv-panel inv-empty">No participating clients yet.</div>');
    } else if (tab === 'invoices') {
      body = d.invoices.length ? '<div class="inv-table-wrap"><table class="inv-table"><thead><tr><th>Invoice #</th><th>Client</th><th>To</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>' + d.invoices.map(function (i) {
        return '<tr class="clickable" data-inv="open" data-id="' + esc(i.id) + '"><td><button class="inv-link" data-inv="open" data-id="' + esc(i.id) + '">' + esc(i.invoice_number) + '</button></td><td>' + esc(i.client_name || '') + '</td><td>' + esc(i.payer_name || '—') + '</td><td class="num">' + money(i.total) + '</td><td>' + pill(i.display_status) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="inv-panel inv-empty">No invoices yet — press Generate Trip Invoices.</div>';
    } else if (tab === 'documents') {
      var docs = d.costs.filter(function (c) { return c.receipt_file_name; });
      body = docs.length ? '<div class="inv-panel"><h3>Receipts</h3>' + docs.map(function (c) { return '<div><a href="' + API + '/trips/' + encodeURIComponent(t.id) + '/costs/' + encodeURIComponent(c.id) + '/receipt?disposition=inline" target="_blank" rel="noopener">' + esc(c.receipt_file_name) + '</a> <span class="inv-dim">' + esc(c.category.toLowerCase()) + ' · ' + aud(c.amount) + '</span></div>'; }).join('') + '</div>' : '<div class="inv-panel inv-empty">No receipts attached. Attach them on the Costs tab.</div>';
    }
    el.innerHTML = head + '<div id="inv-trip-body">' + body + '</div>';
  }

  // ── Settings ─────────────────────────────────────────────────────────────
  async function renderSettings(el) {
    var r = await get('/settings');
    state.settings = r;
    var s = r.settings, o = r.organisation || {};
    el.innerHTML =
      '<div class="inv-panel"><h3>Business &amp; invoice details</h3>' +
      '<div class="inv-note">Blank business fields fall back to Settings → Organisation (' + esc(o.name || 'not set') + '). Next invoice number: <b>' + esc(r.nextInvoiceNumberPreview) + '</b>' + (s.sploseInvoiceNumberHigh ? ' (continues after Splose\'s ' + esc(s.invoicePrefix || '') + esc(s.sploseInvoiceNumberHigh) + ')' : '') + '. Email: ' + (r.emailConfigured ? 'configured' : '<b>not configured</b> — use Mark sent') + '. Google Maps: ' + (r.mapsConfigured ? 'configured' : '<b>not configured</b> — travel legs need manual routes') + '.</div>' +
      '<form class="inv-form" id="inv-settings-form">' +
      '<label>Invoice prefix<input name="invoicePrefix" value="' + esc(s.invoicePrefix) + '"></label>' +
      '<label>Next invoice number<input type="number" min="1" name="nextInvoiceNumber" value="' + esc(s.nextInvoiceNumber) + '"></label>' +
      '<label>Number padding (digits)<input type="number" min="0" max="10" name="invoiceNumberPadding" value="' + esc(s.invoiceNumberPadding) + '"></label>' +
      '<label>Default payment terms (days)<input type="number" min="0" max="365" name="paymentTermsDays" value="' + esc(s.paymentTermsDays) + '"></label>' +
      '<label>Business name<input name="businessName" value="' + esc(s.businessName || '') + '" placeholder="' + esc(o.name || 'Opal Therapy') + '"></label>' +
      '<label>ABN<input name="abn" value="' + esc(s.abn || '') + '" placeholder="11 digits"></label>' +
      '<label>Business email<input name="businessEmail" value="' + esc(s.businessEmail || '') + '" placeholder="' + esc(o.businessEmail || '') + '"></label>' +
      '<label>Business phone<input name="businessPhone" value="' + esc(s.businessPhone || '') + '" placeholder="' + esc(o.businessPhone || '') + '"></label>' +
      '<label class="wide">Business address<input name="businessAddress" value="' + esc(s.businessAddress || '') + '" placeholder="' + esc(o.businessAddress || '') + '"></label>' +
      '<label class="wide">Payment details (printed on invoices)<textarea name="paymentDetails" placeholder="Account name, BSB, account number, reference instructions">' + esc(s.paymentDetails || '') + '</textarea></label>' +
      '<label class="wide">Invoice footer<input name="invoiceFooter" value="' + esc(s.invoiceFooter || '') + '"></label>' +
      '<label>Session description<input name="sessionDescription" value="' + esc(s.sessionDescription) + '"></label>' +
      '<label>Default tax treatment<select name="defaultTaxTreatment">' + opt('GST_FREE', 'GST-free (NDIS supports)', s.defaultTaxTreatment) + opt('GST_10_EXCLUSIVE', 'GST 10% added', s.defaultTaxTreatment) + '</select></label>' +
      '<label>Default trip allocation<select name="defaultTripAllocationMethod">' + opt('EQUAL_PER_CLIENT', 'Equal per unique client', s.defaultTripAllocationMethod) + opt('PER_SESSION', 'Per billable session', s.defaultTripAllocationMethod) + opt('MANUAL_WEIGHTED', 'Manual weighted', s.defaultTripAllocationMethod) + '</select></label>' +
      '<label>Completion rule<select name="completionRule">' + opt('PAST_CONFIRMED', 'Past confirmed sessions are delivered', s.completionRule) + opt('EXPLICIT_ONLY', 'Only sessions marked Completed', s.completionRule) + '</select></label>' +
      '<label>Timezone<input name="timezone" value="' + esc(s.timezone) + '"></label>' +
      '<label class="wide inv-check"><input type="checkbox" name="autoDraftsEnabled"' + (s.autoDraftsEnabled !== false ? ' checked' : '') + '> Prepare drafts every night for the current week (so Create drafts is quick)</label>' +
      '<label>Xero sales account code<input name="xeroSalesAccountCode" value="' + esc(s.xeroSalesAccountCode || '') + '" placeholder="e.g. 200" title="The revenue account in Xero these invoices post to. Blank = nothing is copied to Xero."></label>' +
      '<label>Xero tax type — GST-free<input name="xeroTaxTypeGstFree" value="' + esc(s.xeroTaxTypeGstFree || 'EXEMPTOUTPUT') + '"></label>' +
      '<label>Xero tax type — GST 10%<input name="xeroTaxTypeGst" value="' + esc(s.xeroTaxTypeGst || 'OUTPUT') + '"></label>' +
      '<div class="inv-note wide">Travel follows the NDIS rule book: the day\'s total client-to-client driving (including the trip home), capped at 30 min per client in MMM1–3 and 60 in MMM4–5 plus one return, none in MMM6–7. No kilometre charge in any zone; remote trip costs are billed through Trips.</div>' +
      '</form><div id="inv-settings-msg"></div><div class="inv-field-row"><button class="btn primary" data-inv="save-settings">Save settings</button></div></div>' +
      '<div class="inv-panel"><h3>MMM classification</h3>' + (r.mmmDataset
        ? '<div>Active dataset <b>' + esc(r.mmmDataset.version) + '</b> — ' + esc(r.mmmDataset.source) + (r.mmmDataset.published_on ? ', published ' + dmy(String(r.mmmDataset.published_on).slice(0, 10)) : '') + ' (' + esc(r.mmmDataset.ring_count) + ' boundary rings). Client addresses are geocoded once and classified against these official boundaries; a point within ~250 m of a zone boundary is sent for review.</div>'
        : '<div class="inv-warn">No MMM dataset is loaded. Import the Department of Health MMM 2023 boundaries with <code>node scripts/import-mmm-dataset.js</code> (see docs/accounting/INVOICING_ARCHITECTURE.md), or set each client\'s zone manually.</div>') + '</div>' +
      '<div class="inv-panel"><h3>Rate cards</h3><div class="inv-note">Prices live here, not in code. Each card has an effective period; a service is priced by the card in force on its date. A card that has priced a finalised invoice is locked — create a new version with a new effective date instead.</div>' +
      r.rateCards.map(rateCardHtml).join('') +
      '<div class="inv-field-row"><button class="btn" data-inv="new-rate-card">New rate card version</button></div></div>';
  }

  function rateCardHtml(c) {
    return '<div class="inv-panel" style="background:var(--panel-soft)"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><b>' + esc(c.name) + '</b> · ' + esc(c.discipline) + ' v' + c.version + ' · ' + dmy(c.effectiveFrom) + ' – ' + (c.effectiveTo ? dmy(c.effectiveTo) : 'open') + ' <span class="inv-pill ' + (c.status === 'ACTIVE' ? 'PAID' : '') + '">' + esc(c.status.toLowerCase()) + '</span>' + (c.locked ? ' <span class="inv-pill READY">locked — in use</span>' : '') + '</div>' +
      '<div>' + (c.locked ? '' : '<button class="btn btn-xs" data-inv="edit-rate-card" data-id="' + esc(c.id) + '">Edit</button> ') + '<button class="btn btn-xs" data-inv="copy-rate-card" data-id="' + esc(c.id) + '">New version from this</button>' + (c.status === 'ACTIVE' ? ' <button class="btn btn-xs" data-inv="retire-rate-card" data-id="' + esc(c.id) + '">Set end date</button>' : '') + '</div></div>' +
      '<div class="inv-table-wrap" style="margin-top:8px"><table class="inv-table"><thead><tr><th>Zone</th><th class="num">Session /hr</th><th class="num">Travel /hr</th><th class="num">Travel cap (each way)</th><th class="num">Vehicle /km</th><th>Item codes</th></tr></thead><tbody>' + c.rules.map(function (r) {
        return '<tr><td>' + esc(r.zoneLabel || ('MM' + r.mmmMin + '–' + r.mmmMax)) + '</td><td class="num">' + money(r.sessionHourlyRate) + '</td><td class="num">' + money(r.travelHourlyRate) + '</td><td class="num">' + (r.travelCapMinutesEachWay == null ? 'none' : r.travelCapMinutesEachWay + ' min') + '</td><td class="num">' + money(r.vehicleRatePerKm) + '</td><td class="inv-dim">' + esc([r.sessionItemCode, r.travelItemCode, r.vehicleItemCode].filter(Boolean).join(' · ')) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (c.notes ? '<div class="inv-dim" style="margin-top:6px">' + esc(c.notes) + '</div>' : '') + '</div>';
  }

  function rateCardEditor(c, isNew) {
    var rules = c.rules;
    return '<form class="inv-form" id="inv-rc-form"><label class="wide">Name<input name="name" value="' + esc(c.name) + '"></label>' +
      '<label>Effective from<input type="date" name="effectiveFrom" value="' + esc(isNew ? '' : c.effectiveFrom) + '" required></label>' +
      '<label>Effective to (blank = open)<input type="date" name="effectiveTo" value="' + esc(isNew ? '' : (c.effectiveTo || '')) + '"></label>' +
      '<label class="wide">Notes<input name="notes" value="' + esc(c.notes || '') + '"></label></form>' +
      '<div class="inv-table-wrap" style="margin-top:10px"><table class="inv-table" id="inv-rc-rules"><thead><tr><th>MMM from</th><th>MMM to</th><th>Label</th><th>Session /hr</th><th>Travel /hr</th><th>Cap each way (min, blank = none)</th><th>Vehicle /km</th><th>Session code</th><th>Travel code</th><th>Non-labour code</th></tr></thead><tbody>' +
      rules.map(function (r) {
        function cell(k, v, w) { return '<td><input data-k="' + k + '" value="' + esc(v == null ? '' : v) + '" style="width:' + (w || 80) + 'px"></td>'; }
        return '<tr>' + cell('mmmMin', r.mmmMin, 40) + cell('mmmMax', r.mmmMax, 40) + cell('zoneLabel', r.zoneLabel, 110) + cell('sessionHourlyRate', r.sessionHourlyRate) + cell('travelHourlyRate', r.travelHourlyRate) + cell('travelCapMinutesEachWay', r.travelCapMinutesEachWay, 60) + cell('vehicleRatePerKm', r.vehicleRatePerKm, 60) + cell('sessionItemCode', r.sessionItemCode, 130) + cell('travelItemCode', r.travelItemCode, 140) + cell('vehicleItemCode', r.vehicleItemCode, 130) + '</tr>';
      }).join('') + '</tbody></table></div><div id="inv-rc-msg"></div>';
  }
  function readRateCard() {
    var f = document.getElementById('inv-rc-form');
    var b = { name: f.elements.name.value.trim(), effectiveFrom: f.elements.effectiveFrom.value, effectiveTo: f.elements.effectiveTo.value || null, notes: f.elements.notes.value.trim() || null, discipline: 'OT' };
    b.rules = Array.prototype.map.call(document.querySelectorAll('#inv-rc-rules tbody tr'), function (tr) {
      var r = {};
      tr.querySelectorAll('input').forEach(function (i) { r[i.dataset.k] = i.value.trim() === '' ? null : i.value.trim(); });
      r.mmmMin = Number(r.mmmMin); r.mmmMax = Number(r.mmmMax);
      r.tripCostItemCode = r.vehicleItemCode;
      return r;
    });
    return b;
  }

  // ── Calendar integration ─────────────────────────────────────────────────
  function ensureCalendarButton() {
    if (!canInvoice()) return;
    var bar = document.querySelector('#view-calendar .cal-topbar');
    if (!bar || document.getElementById('inv-cal-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'inv-cal-btn';
    btn.type = 'button';
    btn.className = 'inv-cal-btn';
    btn.title = 'Turn completed sessions and travel into invoice drafts';
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>Complete invoicing';
    btn.addEventListener('click', function () { openCompleteInvoicing(); });
    var legend = document.getElementById('cal-legend-wrap');
    if (legend && legend.parentElement === bar) bar.insertBefore(btn, legend); else bar.appendChild(btn);
  }

  /** Called from openBlockDetail: shows the event's invoice(s) and billing mark. */
  window.invoicingDecorateDetail = function (s) {
    if (!canInvoice() || !s || !s.dbId) return;
    var host = document.getElementById('bd-body');
    if (!host) return;
    var box = document.createElement('div');
    box.className = 'inv-cal-billing';
    box.id = 'inv-cal-billing';
    box.innerHTML = '<b>Invoicing</b> <span class="inv-dim">loading…</span>';
    var old = document.getElementById('inv-cal-billing');
    if (old) old.remove();
    host.appendChild(box);
    // The default option names what the completion rule does — load it once.
    var settingsReady = state.settings ? Promise.resolve() : get('/settings').then(function (r) { state.settings = r; }).catch(function () { /* generic wording */ });
    Promise.all([post('/events/links', { eventIds: [s.dbId] }), settingsReady]).then(function (both) {
      var r = both[0];
      var l = (r.links || {})[s.dbId] || { invoices: [] };
      var seen = {};
      var invs = (l.invoices || []).filter(function (i) { if (seen[i.invoiceId]) return false; seen[i.invoiceId] = 1; return true; });
      box.innerHTML = '<b>Invoicing</b> ' + (invs.length
        ? invs.map(function (i) { return '<button type="button" class="inv-link" data-inv="open-from-cal" data-id="' + esc(i.invoiceId) + '">Invoiced ' + esc(i.invoiceNumber) + '</button> ' + pill(i.status); }).join(' ')
        : '<span class="inv-dim">Not invoiced yet</span>') +
        '<div class="row2"><label class="inv-dim" for="inv-att-sel">Bill this session</label><select id="inv-att-sel" data-event="' + esc(s.dbId) + '" title="' + esc(autoHelp()) + '">' +
        opt('', autoLabel(), l.attendance) + opt('COMPLETED', 'Completed — bill it', l.attendance) + opt('DID_NOT_ATTEND', 'Did not attend', l.attendance) + opt('CANCELLED', 'Cancelled', l.attendance) + opt('NOT_BILLABLE', 'Not billable', l.attendance) + '</select></div>' +
        '<div class="inv-dim inv-att-help">' + esc(autoHelp()) + '</div>' + mmmRow(s.dbId, l.mmm);
    }).catch(function () { box.remove(); });
  };

  /* The MMM zone this session is billed at: where it is delivered (its address
     through the built-in MMM 2023 table), unless a zone was set by hand. */
  function mmmAutoLabel(m) {
    if (m.telehealth) return 'Automatic — client\'s zone (telehealth)';
    var lk = m.lookup || {};
    if (lk.confident) return 'Automatic — MM' + lk.zone + (lk.locality ? ' (' + lk.locality + ')' : lk.postcode ? ' (' + lk.postcode + ')' : '');
    return 'Automatic — no zone, set one';
  }
  function mmmRow(eventId, m) {
    if (!m) return '';
    var sel = m.setZone != null ? String(m.setZone) : '';
    var lk = m.lookup || {};
    var help = m.setZone != null
      ? (m.setSource === 'BOOKING' ? 'Set at booking' : 'Set by owner') + (m.setReason ? ' — ' + m.setReason : '') + '.'
      : (m.telehealth ? 'Telehealth uses the client\'s billing-profile zone.'
        : lk.confident ? 'From the session address.'
        : 'Not billed until a zone is set: ' + (lk.reason || 'address not recognised') + (lk.zones && lk.zones.length ? ' (MM' + lk.zones.join(' or MM') + ')' : '') + '.');
    return '<div class="row2"><label class="inv-dim" for="inv-mmm-sel">MMM zone</label><select id="inv-mmm-sel" data-event="' + esc(eventId) + '">' +
      opt('', mmmAutoLabel(m), sel) + [1, 2, 3, 4, 5, 6, 7].map(function (z) { return opt(String(z), 'MM' + z, sel); }).join('') + '</select></div>' +
      '<div class="inv-dim inv-att-help" id="inv-mmm-help">' + esc(help) + '</div>';
  }

  /* The default billing mark follows Invoicing › Settings › Completion rule —
     say what that means for this session instead of naming the setting. */
  function completionRule() { return state.settings && state.settings.settings ? state.settings.settings.completionRule : null; }
  function autoLabel() {
    var rule = completionRule();
    if (rule === 'EXPLICIT_ONLY') return 'Automatic — only once marked Completed';
    if (rule === 'PAST_CONFIRMED') return 'Automatic — bill once it has happened';
    return 'Automatic (completion rule)';
  }
  function autoHelp() {
    var rule = completionRule();
    if (rule === 'EXPLICIT_ONLY') return 'Automatic: this session is billed only after you mark it Completed. Choose another option to override it.';
    if (rule === 'PAST_CONFIRMED') return 'Automatic: billed once the session time has passed. Choose another option to override it (e.g. Did not attend).';
    return 'Automatic follows the completion rule in Invoicing › Settings. Choose another option to override it for this session.';
  }

  // ── Actions (delegated) ──────────────────────────────────────────────────
  function openInvoice(id) {
    state.invoiceId = id;
    if (state.section !== 'invoices') { state.section = 'invoices'; }
    document.querySelectorAll('#inv-subnav button').forEach(function (b) { b.classList.toggle('active', b.dataset.sec === 'invoices'); });
    var el = section();
    if (el) renderInvoiceDetail(el, id).catch(function (e) { denied(el, e); });
    window.scrollTo(0, 0);
  }
  function openTrip(id, tab) {
    state.tripId = id; state.tripTab = tab || 'overview'; state.section = 'trips';
    document.querySelectorAll('#inv-subnav button').forEach(function (b) { b.classList.toggle('active', b.dataset.sec === 'trips'); });
    var el = section();
    if (el) renderTripDetail(el, id).catch(function (e) { denied(el, e); });
  }
  function refreshDetail() { if (state.invoiceId) openInvoice(state.invoiceId); loadOverview(); }
  function lineById(id) { return ((state.detail && state.detail.lines) || []).find(function (l) { return l.id === id; }); }
  function switchToInvoicing(then) {
    if (typeof window.switchTab === 'function') window.switchTab('invoicing');
    setTimeout(function () { boot(); if (then) then(); }, 80);
  }

  async function act(btn) {
    var a = btn.dataset.inv, id = btn.dataset.id;
    try {
      switch (a) {
        case 'close-modal': closeModal(); break;
        case 'complete': openCompleteInvoicing(); break;
        case 'complete-last': openCompleteInvoicing({ autorun: true }); break;
        case 'run-go': await runInvoicing(btn); break;
        case 'card': state.filters.status = btn.dataset.status; go('invoices'); break;
        case 'chip': state.filters.status = btn.dataset.status; go('invoices'); break;
        case 'sort': {
          var k = btn.dataset.sort; var f = state.filters;
          f.dir = f.sort === k && f.dir === 'desc' ? 'asc' : 'desc'; f.sort = k; loadInvoiceList(); break;
        }
        case 'goto':
          closeModal();
          if (!document.getElementById('inv-root') || !document.getElementById('view-invoicing').classList.contains('active')) {
            return switchToInvoicing(function () { if (btn.dataset.status) state.filters.status = btn.dataset.status; go(btn.dataset.sec); });
          }
          if (btn.dataset.status) state.filters.status = btn.dataset.status;
          go(btn.dataset.sec); break;
        case 'open': closeModal(); openInvoice(id); break;
        case 'open-from-cal':
          if (typeof window.closeBlockDetail === 'function') window.closeBlockDetail();
          switchToInvoicing(function () { openInvoice(id); }); break;
        case 'back': state.invoiceId = null; state.editMode = false; go('invoices'); break;
        case 'toggle-edit':
          state.editMode = !state.editMode; state.editId = id;
          if (!state.editMode) { clearTimeout(refreshTimer); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
          refreshDetail(); break;
        case 'add-line-inline': addInlineRow(); break;
        case 'drop-new-line': { var nl = btn.closest('.inv-new-line'); if (nl) nl.remove(); break; }
        case 'delete-draft': {
          if (!(await confirmIt('Delete this draft? It is removed for good (the deletion is kept in the audit trail). Its sessions are drafted again next time drafts are made — to stop a charge, remove its line instead.'))) return;
          await del('/invoices/' + id); state.invoiceId = null; state.editMode = false;
          toast('Draft deleted'); loadOverview(); go('invoices'); break;
        }
        case 'quick-fix': await openQuickFix(id); break;
        case 'refresh-draft': {
          btn.disabled = true; btn.textContent = 'Updating…';
          var rj = await post('/invoices/' + id + '/regenerate', { background: true });
          if (rj.job) watchJob(rj.job.jobId, null); else refreshDetail();
          break;
        }
        case 'qf-answer': await saveQuickFix(btn); break;
        case 'finalise': {
          if (!(await confirmIt('Finalise this invoice? Its amounts and PDF are locked afterwards; changes need void & reissue.'))) return;
          await post('/invoices/' + id + '/finalise'); toast('Invoice finalised', 'The final PDF is stored and locked'); refreshDetail(); break;
        }
        case 'void': {
          var why = await ask('Reason for voiding this invoice (recorded in the audit trail):');
          if (!why) return;
          await post('/invoices/' + id + '/void', { reason: why }); toast('Invoice voided', 'Its sessions can be invoiced again'); refreshDetail(); break;
        }
        case 'reissue': {
          var why2 = await ask('Reason for voiding and reissuing (recorded in the audit trail):');
          if (!why2) return;
          var re = await post('/invoices/' + id + '/reissue', { reason: why2 });
          toast('Reissued', re.reissued ? 'New draft ' + re.reissued.invoice_number : 'Voided — no billable sessions remained');
          if (re.reissued) openInvoice(re.reissued.id); else refreshDetail(); break;
        }
        case 'mark-sent': {
          var to = await ask('Sent to (email or note, optional):');
          if (to === null) return;
          await post('/invoices/' + id + '/mark-sent', { sentTo: to || null }); toast('Marked as sent'); refreshDetail(); break;
        }
        case 'send-selected': openSendSelected(); break;
        case 'nf2f-resolve':
          if (window.Nf2f && typeof window.Nf2f.openResolve === 'function') window.Nf2f.openResolve(id);
          break;
        case 'xero-payments': {
          btn.disabled = true;
          try {
            var xp = await post('/xero/sync-payments', {});
            toast('Payments updated from Xero', xp.updated + ' of ' + xp.checked + ' invoice' + (xp.checked === 1 ? '' : 's') + ' changed' + (xp.voidedInXero ? ' · ' + xp.voidedInXero + ' voided in Xero only — check them' : ''));
            loadOverview(); if (state.section === 'invoices' && !state.invoiceId) loadInvoiceList();
          } finally { btn.disabled = false; }
          break;
        }
        case 'xero-push': {
          btn.disabled = true;
          try {
            var xr = await post('/invoices/' + id + '/xero', {});
            toast(xr.already ? 'Already in Xero' : 'Copied to Xero', xr.adopted ? 'Xero already had this invoice; it is now linked.' : '');
            refreshDetail();
          } finally { btn.disabled = false; }
          break;
        }
        case 'send-go': await sendSelected(btn); break;
        case 'email': {
          var inv = state.detail && state.detail.invoice;
          var resend = !!(inv && inv.sent_status === 'SENT');
          if (resend && !(await confirmIt('This invoice was already sent' + (inv.sent_to ? ' to ' + inv.sent_to : '') + '. Send it again?'))) return;
          var addr = await ask('Email the final PDF to:', { value: (inv && inv.payer_email) || '' });
          if (!addr) return;
          var er = await post('/invoices/' + id + '/email', { to: addr, resend: resend });
          toast(er.sent ? 'Invoice emailed' : 'Email is not configured', er.sent ? addr : 'Send it yourself and use Mark sent');
          refreshDetail(); break;
        }
        case 'payment': {
          modal('Record payment', '<form class="inv-form" id="inv-pay-form"><label>Amount (AUD)<input name="amount" inputmode="decimal" value="' + esc(btn.dataset.outstanding || '') + '"></label><label>Paid on<input type="date" name="paidOn" value="' + ymdLocal(new Date()) + '"></label><label>Method<select name="method"><option>EFT</option><option>Plan manager remittance</option><option>Card</option><option>Other</option></select></label><label>Reference<input name="reference"></label></form><div id="inv-pay-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-payment" data-id="' + esc(id) + '">Record payment</button>');
          break;
        }
        case 'save-payment': {
          var pf = document.getElementById('inv-pay-form');
          try {
            await post('/invoices/' + id + '/payments', { amount: pf.elements.amount.value, paidOn: pf.elements.paidOn.value, method: pf.elements.method.value, reference: pf.elements.reference.value });
            closeModal(); toast('Payment recorded'); refreshDetail();
          } catch (e) { document.getElementById('inv-pay-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'edit-header': {
          var iv = state.detail.invoice;
          modal('Edit draft ' + iv.invoice_number, '<form class="inv-form" id="inv-hdr-form"><label>Issue date<input type="date" name="issueDate" value="' + esc(iv.issue_date) + '"></label><label>Due date<input type="date" name="dueDate" value="' + esc(iv.due_date || '') + '"></label>' +
            '<label class="wide">Notes (printed)<textarea name="notes">' + esc(iv.notes || '') + '</textarea></label>' +
            '<label>Invoice to<input name="payerName" value="' + esc(iv.payer_name || '') + '"></label><label>Payer email<input name="payerEmail" value="' + esc(iv.payer_email || '') + '"></label><label>Payer reference<input name="payerReference" value="' + esc(iv.payer_reference || '') + '"></label>' +
            '<label class="wide">Reason (required if the recipient changes)<input name="reason"></label></form><div class="inv-note">A recipient corrected here applies to this draft only; correct the client\'s billing profile so future invoices follow.</div><div id="inv-hdr-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-header" data-id="' + esc(iv.id) + '">Save</button>', { wide: true });
          break;
        }
        case 'save-header': {
          var hf = document.getElementById('inv-hdr-form'), cur = state.detail.invoice, b = { issueDate: hf.elements.issueDate.value, notes: hf.elements.notes.value };
          if (hf.elements.dueDate.value) b.dueDate = hf.elements.dueDate.value;
          ['payerName', 'payerEmail', 'payerReference'].forEach(function (k) {
            var col = { payerName: 'payer_name', payerEmail: 'payer_email', payerReference: 'payer_reference' }[k];
            if ((hf.elements[k].value || '') !== (cur[col] || '')) b[k] = hf.elements[k].value;
          });
          if (b.payerName !== undefined || b.payerEmail !== undefined || b.payerReference !== undefined) { b.reason = hf.elements.reason.value; if (!cur.payer_type) b.payerType = 'PLAN_MANAGER'; }
          try { await patch('/invoices/' + id, b); closeModal(); refreshDetail(); }
          catch (e) { document.getElementById('inv-hdr-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'calc': {
          var row = document.getElementById('calc-' + btn.dataset.line);
          if (row) { row.hidden = !row.hidden; btn.setAttribute('aria-expanded', String(!row.hidden)); }
          break;
        }
        case 'edit-line': {
          var l = lineById(btn.dataset.line);
          modal('Edit line', '<form class="inv-form" id="inv-line-form"><label class="wide">Description<input name="description" value="' + esc(l.description) + '"></label><label>Quantity<input name="quantity" value="' + esc(l.quantity) + '"></label><label>Unit price<input name="unitPrice" value="' + esc(l.unit_price) + '"></label><label class="wide">Reason (required for quantity or price)<input name="reason"></label></form><div class="inv-note">The amount is recalculated on the server as quantity × unit price. The original calculation and your override are both kept.</div><div id="inv-line-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-line" data-line="' + esc(l.id) + '">Save</button>');
          break;
        }
        case 'save-line': {
          var lf = document.getElementById('inv-line-form'), orig = lineById(btn.dataset.line), body = {};
          if (lf.elements.description.value !== orig.description) body.description = lf.elements.description.value;
          if (Number(lf.elements.quantity.value) !== Number(orig.quantity)) body.quantity = lf.elements.quantity.value;
          if (Number(lf.elements.unitPrice.value) !== Number(orig.unit_price)) body.unitPrice = lf.elements.unitPrice.value;
          if (lf.elements.reason.value) body.reason = lf.elements.reason.value;
          try { await patch('/invoices/' + state.invoiceId + '/lines/' + btn.dataset.line, body); closeModal(); refreshDetail(); }
          catch (e) { document.getElementById('inv-line-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'remove-line': case 'restore-line': {
          if (state.editMode) {
            await post('/invoices/' + state.invoiceId + '/lines/' + btn.dataset.line + '/' + (a === 'remove-line' ? 'remove' : 'restore'), { reason: a === 'remove-line' ? 'Removed on the invoice' : 'Restored on the invoice' });
            refreshDetail(); break;
          }
          var reason = await ask(a === 'remove-line' ? 'Why remove this charge? (kept in the audit trail; re-running will not add it back)' : 'Why restore this charge?');
          if (!reason) return;
          await post('/invoices/' + state.invoiceId + '/lines/' + btn.dataset.line + '/' + (a === 'remove-line' ? 'remove' : 'restore'), { reason: reason });
          refreshDetail(); break;
        }
        case 'add-line': {
          modal('Add line', '<form class="inv-form" id="inv-add-form"><label class="wide">Description<input name="description"></label><label>Item code<input name="itemCode"></label><label>Service date<input type="date" name="serviceDate"></label><label>Quantity<input name="quantity" value="1"></label><label>Unit price<input name="unitPrice"></label><label class="wide">Reason<input name="reason"></label></form><div id="inv-add-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-add-line">Add</button>');
          break;
        }
        case 'save-add-line': {
          var af = document.getElementById('inv-add-form'), ab = {};
          Array.prototype.forEach.call(af.elements, function (e) { if (e.name && e.value) ab[e.name] = e.value; });
          try { await post('/invoices/' + state.invoiceId + '/lines', ab); closeModal(); refreshDetail(); }
          catch (e) { document.getElementById('inv-add-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'open-client': await openClient(btn.dataset.client); break;
        case 'payer-new': openPayer(null); break;
        case 'payer-edit': openPayer(btn.dataset.id); break;
        case 'payer-save': await savePayer(btn.dataset.id || null); break;
        case 'payers-import': {
          var pm = document.getElementById('inv-py-msg');
          btn.disabled = true; pm.innerHTML = '<div class="inv-note">Reading every Splose invoice…</div>';
          try { var pi = await post('/payers/import-splose'); pm.innerHTML = '<div class="inv-ok">Read ' + pi.invoices + ' Splose invoices for ' + pi.clients + ' clients: ' + pi.payers + ' payers (' + pi.newPayers + ' new), ' + pi.newInvoices + ' invoices newly recorded.</div>'; await loadPayers(''); }
          catch (e) { pm.innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          btn.disabled = false;
          break;
        }
        case 'save-client': await saveClient(btn.dataset.client); break;
        case 'mmm-override': {
          var z = document.getElementById('inv-mmm-zone').value, rs = document.getElementById('inv-mmm-reason').value;
          try { await put('/clients/' + encodeURIComponent(btn.dataset.client) + '/mmm-override', { zone: z || null, reason: rs }); toast('MMM override saved'); await openClient(btn.dataset.client); }
          catch (e) { document.getElementById('inv-client-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'mmm-refresh': await post('/clients/' + encodeURIComponent(btn.dataset.client) + '/mmm/refresh'); await openClient(btn.dataset.client); break;
        case 'import-splose': {
          try { var ir = await post('/clients/' + encodeURIComponent(btn.dataset.client) + '/import-splose'); toast('Imported from Splose', ir.imported.length ? ir.imported.join(', ') : 'Nothing blank to fill'); await openClient(btn.dataset.client); }
          catch (e) { document.getElementById('inv-client-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'reprocess': {
          btn.disabled = true; btn.textContent = 'Reprocessing…';
          var rp = await post('/issues/' + id + '/reprocess');
          toast(rp.issueStatus === 'RESOLVED' ? 'Resolved' : 'Reprocessed', rp.issueStatus === 'OPEN' ? 'Still needs attention — check the record' : '');
          loadOverview(); go('attention'); break;
        }
        case 'dismiss': {
          var dr = await ask('Why dismiss this item? (recorded)');
          if (!dr) return;
          await post('/issues/' + id + '/dismiss', { reason: dr }); loadOverview(); go('attention'); break;
        }
        case 'manual-route': {
          modal('Enter route manually', '<div class="inv-note">Google could not route this leg. Enter the drive time and distance you verified; it is stored for future runs and audited.</div><div class="inv-kv"><div class="k">From</div><div>' + esc(btn.dataset.o) + '</div><div class="k">To</div><div>' + esc(btn.dataset.d) + '</div></div>' +
            '<form class="inv-form" id="inv-route-form" style="margin-top:10px"><label>Minutes<input name="minutes" inputmode="numeric"></label><label>Kilometres<input name="km" inputmode="decimal"></label><label class="wide">Reason / source<input name="reason"></label></form><div id="inv-route-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-route" data-o="' + esc(btn.dataset.o) + '" data-d="' + esc(btn.dataset.d) + '">Save route</button>');
          break;
        }
        case 'save-route': {
          var rf = document.getElementById('inv-route-form');
          try { await post('/routes/manual', { origin: btn.dataset.o, destination: btn.dataset.d, minutes: rf.elements.minutes.value, km: rf.elements.km.value, reason: rf.elements.reason.value }); closeModal(); toast('Route saved', 'Reprocess the item to apply it'); }
          catch (e) { document.getElementById('inv-route-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'to-calendar': {
          if (typeof window.switchTab === 'function') window.switchTab('calendar');
          break;
        }
        case 'new-trip': await openNewTrip(); break;
        case 'create-trip': {
          try { var ct = await post('/trips', readTripForm()); closeModal(); if (!document.getElementById('view-invoicing').classList.contains('active')) switchToInvoicing(function () { openTrip(ct.trip.id); }); else openTrip(ct.trip.id); }
          catch (e) { document.getElementById('inv-trip-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'open-trip': closeModal(); openTrip(id, btn.dataset.tab); break;
        case 'trips-back': state.tripId = null; go('trips'); break;
        case 'trip-tab': state.tripTab = btn.dataset.tab; renderTripDetail(section(), state.tripId); break;
        case 'edit-trip': {
          if (!state.practitioners.length) state.practitioners = (await get('/practitioners')).practitioners;
          modal('Edit trip', tripForm(state.tripData.trip), '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-trip" data-id="' + esc(id) + '">Save</button>', { wide: true });
          break;
        }
        case 'save-trip': {
          try { await put('/trips/' + id, readTripForm()); closeModal(); openTrip(id, state.tripTab); }
          catch (e) { document.getElementById('inv-trip-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'gen-trip': {
          if (!(await confirmIt('Generate draft invoices for every participating client on this trip? Sessions, travel and the shared trip-cost allocation are grouped per client. Re-running never duplicates charges.'))) return;
          btn.disabled = true; btn.textContent = 'Generating…';
          var g = await post('/trips/' + id + '/generate');
          var sm = g.summary;
          modal('Trip invoices generated', '<div class="inv-summary"><div><b>' + sm.invoicesCreated + '</b><span>invoices created</span></div><div><b>' + sm.invoicesUpdated + '</b><span>drafts updated</span></div><div><b>' + sm.sessionsIncluded + '</b><span>sessions</span></div><div><b>' + sm.travelAllocations + '</b><span>travel allocations</span></div><div><b>' + (sm.tripCostAllocations || 0) + '</b><span>trip-cost allocations</span></div><div><b>' + sm.itemsNeedAttention + '</b><span>need attention</span></div></div>' +
            (sm.trip ? '<div class="inv-note">Eligible shared costs ' + aud(sm.trip.eligibleSharedCosts) + ' across ' + sm.trip.clientCount + ' clients · allocated ' + aud(sm.trip.allocated) + ' · unallocated ' + aud(sm.trip.unallocated) + '</div>' : ''),
            '<button class="btn" data-inv="close-modal">Close</button>');
          state.tripTab = 'invoices'; openTrip(id, 'invoices'); loadOverview(); break;
        }
        case 'trip-add-client': {
          var cid = document.getElementById('inv-trip-add-client').value.trim();
          if (!cid) return;
          await post('/trips/' + id + '/clients', { clientId: cid }); openTrip(id, 'clients'); break;
        }
        case 'trip-client': {
          var inc = btn.dataset.included === '1';
          modal('Trip allocation input', '<form class="inv-form" id="inv-tc-form"><label class="check"><input type="checkbox" name="included"' + (inc ? ' checked' : '') + '> Included in the trip-cost allocation</label><label>Weight (manual weighted method)<input name="weight" value="' + esc(btn.dataset.weight) + '"></label><label class="wide">Reason (required)<input name="reason"></label></form><div id="inv-tc-msg"></div>',
            '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-trip-client" data-id="' + esc(id) + '" data-client="' + esc(btn.dataset.client) + '">Save</button>');
          break;
        }
        case 'save-trip-client': {
          var tf = document.getElementById('inv-tc-form');
          try { await put('/trips/' + id + '/clients/' + encodeURIComponent(btn.dataset.client), { included: tf.elements.included.checked, weight: tf.elements.weight.value, reason: tf.elements.reason.value }); closeModal(); openTrip(id, 'clients'); }
          catch (e) { document.getElementById('inv-tc-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'add-cost': {
          var cf = document.getElementById('inv-cost-form'), cb = {};
          Array.prototype.forEach.call(cf.elements, function (e) { if (e.name && e.value !== '') cb[e.name] = e.value; });
          await post('/trips/' + id + '/costs', cb); toast('Cost added'); openTrip(id, 'costs'); break;
        }
        case 'del-cost': {
          if (!(await confirmIt('Remove this cost from the trip? (kept in the audit trail)'))) return;
          await api('DELETE', '/trips/' + id + '/costs/' + btn.dataset.cost); openTrip(id, 'costs'); break;
        }
        case 'save-settings': {
          var sf = document.getElementById('inv-settings-form'), sb = {};
          Array.prototype.forEach.call(sf.elements, function (e) { if (!e.name) return; sb[e.name] = e.type === 'checkbox' ? e.checked : e.value; });
          try { await put('/settings', sb); document.getElementById('inv-settings-msg').innerHTML = '<div class="inv-ok">Saved.</div>'; renderSettings(section()); }
          catch (e) { document.getElementById('inv-settings-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'new-rate-card': case 'copy-rate-card': case 'edit-rate-card': {
          var cards = state.settings.rateCards;
          var base = cards.find(function (c) { return c.id === id; }) || cards[0];
          var isNew = a !== 'edit-rate-card';
          modal(isNew ? 'New rate card version' : 'Edit rate card', rateCardEditor(base, isNew), '<button class="btn" data-inv="close-modal">Cancel</button><button class="btn primary" data-inv="save-rate-card" data-id="' + (isNew ? '' : esc(base.id)) + '">Save</button>', { wide: true });
          break;
        }
        case 'save-rate-card': {
          try {
            var rc = readRateCard();
            if (id) await put('/rate-cards/' + id, rc); else await post('/rate-cards', rc);
            closeModal(); toast('Rate card saved'); renderSettings(section());
          } catch (e) { document.getElementById('inv-rc-msg').innerHTML = '<div class="inv-error">' + esc(e.message) + '</div>'; }
          break;
        }
        case 'retire-rate-card': {
          var endDate = await ask('Last date this card applies (YYYY-MM-DD):');
          if (!endDate) return;
          await put('/rate-cards/' + id, { effectiveTo: endDate }); renderSettings(section()); break;
        }
        default: return;
      }
    } catch (e) {
      toast(e.message || 'Something went wrong');
      if (btn.disabled) { btn.disabled = false; }
    }
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-inv]');
    if (t && (t.closest('#view-invoicing') || t.closest('#inv-backdrop') || t.closest('#inv-cal-billing'))) {
      if (t.tagName === 'TR' && e.target.closest('button, a, select, input')) return;
      e.preventDefault();
      act(t);
      return;
    }
    // Range presets in the Complete invoicing modal.
    var rb = e.target.closest && e.target.closest('#inv-backdrop [data-range]');
    if (rb) {
      var bd = document.getElementById('inv-backdrop');
      rb.parentElement.querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b === rb); });
      var rng = bd.__ranges && bd.__ranges[rb.dataset.range];
      if (rng) { document.getElementById('inv-run-from').value = rng[0]; document.getElementById('inv-run-to').value = rng[1]; }
      else document.getElementById('inv-run-from').focus();
      return;
    }
    var sub = e.target.closest && e.target.closest('#inv-subnav button');
    if (sub) { go(sub.dataset.sec); return; }
    var tab = e.target.closest && e.target.closest('.tab[data-tab="invoicing"]');
    if (tab) setTimeout(boot, 50);
  });
  document.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('#view-invoicing th[data-inv="sort"]')) { e.preventDefault(); act(e.target); }
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'inv-att-sel') {
      put('/events/' + t.dataset.event + '/attendance', { attendance: t.value || null, reason: 'Set from the calendar' })
        .then(function () { toast('Billing mark saved', 'Linked drafts are flagged for regeneration'); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    if (t.id === 'inv-mmm-sel') {
      put('/events/' + t.dataset.event + '/mmm', { zone: t.value || null, reason: 'Set from the calendar' })
        .then(function (r) {
          toast('MMM zone saved', 'Run invoicing again to reprice this session');
          var row = t.closest('.row2');
          if (row && r.mmm) {
            var help = document.getElementById('inv-mmm-help');
            if (help) help.remove();
            row.outerHTML = mmmRow(t.dataset.event, r.mmm);
          }
        })
        .catch(function (err) { toast(err.message); });
      return;
    }
    if (t.dataset && t.dataset.invCostMode) {
      put('/trips/' + t.dataset.trip + '/costs/' + t.dataset.invCostMode, { billableMode: t.value })
        .then(function () { toast('Cost classified'); if (state.tripId) openTrip(state.tripId, 'costs'); })
        .catch(function (err) { toast(err.message); });
      return;
    }
    if (t.dataset && t.dataset.invReceipt) {
      var file = t.files && t.files[0];
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { toast('Receipt must be under 8 MB'); return; }
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(',')[1] || '';
        post('/trips/' + t.dataset.trip + '/costs/' + t.dataset.invReceipt + '/receipt', { fileName: file.name, mime: file.type, base64: b64 })
          .then(function () { toast('Receipt attached'); openTrip(t.dataset.trip, 'costs'); })
          .catch(function (err) { toast(err.message); });
      };
      reader.readAsDataURL(file);
    }
  });

  // ── Boot ─────────────────────────────────────────────────────────────────
  var lastBoot = 0;
  function boot() {
    var view = document.getElementById('view-invoicing');
    if (!view || !view.classList.contains('active')) return;
    // A tab click and the view observer can both fire for one switch.
    if (Date.now() - lastBoot < 400) return;
    lastBoot = Date.now();
    renderShell();
    loadOverview();
    if (!view.dataset.booted) { view.dataset.booted = '1'; go(state.section, { keepIds: true }); }
  }
  window.invoicingOpen = function (sec) { switchToInvoicing(function () { go(sec || 'invoices'); }); };
  window.invoicingCompleteInvoicing = openCompleteInvoicing;

  // The calendar bar exists from load; APP_USER arrives asynchronously.
  var tries = 0;
  (function waitForUser() {
    if (window.APP_USER) { ensureCalendarButton(); return; }
    if (tries++ < 60) setTimeout(waitForUser, 500);
  })();
  window.addEventListener('hashchange', function () { setTimeout(boot, 80); });
  // Boot whenever the view becomes visible, however it got there — a reload
  // on #invoicing (the route is restored after sign-in, past the load-time
  // boot), Back/Forward (history.replaceState fires no hashchange), or any
  // programmatic switchTab. Without this the tab sat on "Loading invoicing…".
  (function watchView() {
    var view = document.getElementById('view-invoicing');
    if (!view || typeof MutationObserver !== 'function') return;
    new MutationObserver(function () { if (view.classList.contains('active')) setTimeout(boot, 30); })
      .observe(view, { attributes: true, attributeFilter: ['class'] });
  })();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 300); });
  else setTimeout(boot, 300);

  // Node test hook (pure helpers only).
  if (typeof module !== 'undefined' && module.exports) module.exports = { dmy: dmy, money: money, mondayOf: mondayOf, ymdLocal: ymdLocal };
})();
