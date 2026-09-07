/* Invoices tab (owner-only)
   The practice's own calendar plus every employee calendar → NDIS claims →
   invoices, one at a time or a whole week in a batch. Amounts are never
   computed here: the browser gathers event ids, travel legs and choices and
   the backend rules engine (ndis-billing-rules.js) prices everything.
   Backend enforces owner-only on every /api/invoicing route; the tab is also
   hidden for other roles by ROLE_NAV. */
(function () {
  'use strict';

  var TZ = 'Australia/Perth';
  var S = {
    view: 'board',
    weekStart: null,          // YYYY-MM-DD (Monday)
    therapistFilter: '',
    week: null,               // /api/invoicing/week payload
    claims: {},               // eventId → claim (latest preview)
    inputs: {},               // eventId → { deliveryMode, cancelledAt, legMinutes, legKm, selected }
    days: {},                 // dayKey (therapist|date) → { returnMinutes, returnKm, returnPaid }
    invoices: [],
    clients: [],
    rulebook: null,
    loading: false,
  };

  // ── helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(n) { if (n == null || isNaN(n)) return '—'; return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(n)); }
  function perthDate(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ }); }
  function perthTime(iso) { return new Date(iso).toLocaleTimeString('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }
  function niceDate(ymd) { if (!ymd) return '—'; ymd = String(ymd).slice(0, 10); var d = new Date(ymd + 'T00:00:00Z'); return d.toLocaleDateString('en-AU', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }); }
  function addDays(ymd, n) { var d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function mondayOf(ymd) { var d = new Date(ymd + 'T00:00:00Z'); var dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }
  function todayPerth() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
  function toast(msg, sub) { if (typeof window.showToast === 'function') window.showToast(msg, sub); else console.log(msg, sub || ''); }
  function minutesBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 60000); }
  function chip(status, text) { return '<span class="inv-chip ' + esc(status) + '">' + esc(text || labelFor(status)) + '</span>'; }
  function labelFor(s) { return ({ ready: 'Ready', needs_review: 'Review', blocked: 'Blocked', not_claimable: 'No claim', invoiced: 'Invoiced', draft: 'Draft', approved: 'Approved', sent: 'Sent', paid: 'Paid', void: 'Void' })[s] || s; }
  var WARN_TEXT = {
    client_billing_settings_missing: 'Add billing settings for this client',
    event_has_no_client: 'No client on the appointment',
    rate_above_price_limit: 'Agreed rate is above the NDIS limit',
    travel_rate_above_limit: 'Travel rate above the limit',
    travel_minutes_capped: 'Travel time capped at the MMM limit',
    per_km_rate_above_guide: 'Per-km rate above the $0.99 guide',
    travel_agreement_not_confirmed: 'Travel not agreed in the service agreement',
    telehealth_agreement_not_confirmed: 'Telehealth not agreed in the service agreement',
    non_f2f_agreement_not_confirmed: 'Non-face-to-face not agreed in the service agreement',
    ndia_report_agreement_not_confirmed: 'Reports not agreed in the service agreement',
    ndia_report_request_not_confirmed: 'Tick "NDIA requested" for this report',
    service_agreement_cancellation_term_not_confirmed: 'Cancellation fee not in the service agreement',
    public_holidays_not_supplied: 'Public holidays not checked for the notice period',
    no_agreed_rate_using_price_limit: 'No agreed rate set: billed at the price limit',
    self_managed_limits_not_binding: 'Self-managed: NDIS limits do not bind',
    travel_not_claimable_for_this_claim_type: 'Travel cannot be claimed on this claim type',
    sufficient_notice: 'Cancelled with enough notice: not claimable',
    price_limit_unresolved: 'No price limit for this date',
    support_item_unresolved: 'Could not pick a support item',
    return_leg_unpaid_not_claimed: 'Return leg not paid to staff: not claimed',
    leg_to_non_billable_session_pooled: 'A leg to a cancelled session is in the pool: check it',
    agency_managed_requires_registered_provider: 'NDIA-managed plan needs a registered provider',
  };
  function warnText(w) { return WARN_TEXT[w] || w.replace(/_/g, ' '); }

  async function api(path, opts) {
    var r = await fetch('/api/invoicing' + path, Object.assign({ credentials: 'include' }, opts || {}));
    if (r.status === 401 || r.status === 403) { toast('Invoices are owner-only'); return { _denied: true, status: r.status }; }
    var j = await r.json().catch(function () { return {}; });
    j._status = r.status; return j;
  }
  function post(path, body) { return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function put(path, body) { return api(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }

  // ── shell ────────────────────────────────────────────────────────────────
  function root() { return document.getElementById('inv-root'); }
  function render() {
    var r = root(); if (!r) return;
    r.innerHTML =
      '<div class="inv-page">' +
        '<div class="inv-head"><h2>Invoices</h2><div class="inv-actions">' +
          '<button class="inv-btn" data-act="rulebook">📖 Rule book</button>' +
          '<button class="inv-btn" data-act="new-invoice">＋ New invoice</button>' +
          '<button class="inv-btn primary" data-act="batch">Batch invoice this week</button>' +
        '</div></div>' +
        '<div class="inv-subnav">' +
          ['board', 'Week board', 'invoices', 'Invoices', 'clients', 'Client billing settings'].reduce(function (h, v, i, a) {
            return i % 2 ? h : h + '<button data-view="' + v + '" class="' + (S.view === v ? 'active' : '') + '">' + a[i + 1] + '</button>';
          }, '') +
        '</div>' +
        '<div id="inv-view"></div>' +
      '</div>';
    renderView();
  }
  function renderView() {
    var v = document.getElementById('inv-view'); if (!v) return;
    if (S.view === 'board') renderBoard(v);
    else if (S.view === 'invoices') renderInvoices(v);
    else renderClients(v);
  }

  // ── week board ───────────────────────────────────────────────────────────
  async function loadWeek() {
    if (!S.weekStart) S.weekStart = mondayOf(todayPerth());
    S.loading = true; renderView();
    var q = '?start=' + S.weekStart + (S.therapistFilter ? '&therapistIds=' + encodeURIComponent(S.therapistFilter) : '');
    var w = await api('/week' + q);
    S.loading = false;
    if (w._denied) return;
    S.week = w;
    (w.claims || []).forEach(function (c) { S.claims[c.eventId] = c; });
    seedInputsFromCalendar();
    renderView();
    await preview();
  }

  /* Travel defaults: the live calendar (travel.js) knows this week's legs when
     the calendar is showing the same week. Otherwise fall back to what the
     event row carries; the owner can type over either. */
  function seedInputsFromCalendar() {
    var segByDb = {};
    try {
      if (typeof window.computeDayTravelSegments === 'function' && window.SESSIONS) {
        var dbOf = {}; Object.keys(window.SESSIONS).forEach(function (k) { var s = window.SESSIONS[k]; if (s && s.dbId) dbOf[k] = s.dbId; });
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(function (d) {
          (window.computeDayTravelSegments(d) || []).forEach(function (seg) {
            if (seg.kind === 'gap') return;
            var km = null;
            try { var rc = (typeof ROUTE_CACHE !== 'undefined') ? ROUTE_CACHE.get(seg.cacheKey) : null; if (rc && rc.distanceMeters) km = Math.round(rc.distanceMeters / 100) / 10; } catch (e) {}
            if ((seg.kind === 'start' || seg.kind === 'between') && dbOf[seg.toSessionId]) segByDb[dbOf[seg.toSessionId]] = { minutes: seg.travelMin, km: km };
            if (seg.kind === 'end' && dbOf[seg.fromSessionId]) segByDb['return:' + dbOf[seg.fromSessionId]] = { minutes: seg.travelMin, km: km };
          });
        });
      }
    } catch (e) { /* calendar not loaded: manual legs */ }
    (S.week.events || []).forEach(function (ev) {
      var inp = S.inputs[ev.id] = S.inputs[ev.id] || {};
      if (inp.deliveryMode == null) inp.deliveryMode = ev.status === 'cancelled' ? 'cancelled' : 'in_person';
      if (inp.legMinutes == null) inp.legMinutes = segByDb[ev.id] ? segByDb[ev.id].minutes : (ev.travelMinutes || '');
      if (inp.legKm == null) inp.legKm = segByDb[ev.id] && segByDb[ev.id].km != null ? segByDb[ev.id].km : (ev.travelKm || '');
      if (inp.selected == null) inp.selected = !ev.invoicedNumber;
      var dk = dayKey(ev); var d = S.days[dk] = S.days[dk] || { returnMinutes: '', returnKm: '', returnPaid: true };
      var ret = segByDb['return:' + ev.id];
      if (ret && d.returnMinutes === '') { d.returnMinutes = ret.minutes; if (ret.km != null) d.returnKm = ret.km; }
    });
  }
  function dayKey(ev) { return ev.therapistProfileId + '|' + perthDate(ev.start); }

  function groupedDays() {
    var groups = {};
    (S.week && S.week.events || []).forEach(function (ev) {
      var k = dayKey(ev); (groups[k] = groups[k] || { key: k, therapistName: ev.therapistName, colour: ev.therapistColour, date: perthDate(ev.start), events: [] }).events.push(ev);
    });
    return Object.values(groups).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.therapistName || '').localeCompare(b.therapistName || ''); })
      .map(function (g) { g.events.sort(function (a, b) { return new Date(a.start) - new Date(b.start); }); return g; });
  }

  function payload(eventIds) {
    var ids = eventIds || (S.week.events || []).filter(function (e) { return !e.invoicedNumber; }).map(function (e) { return e.id; });
    var idSet = {}; ids.forEach(function (i) { idSet[i] = true; });
    var inputs = {};
    ids.forEach(function (id) {
      var i = S.inputs[id] || {};
      var mode = i.deliveryMode || 'in_person';
      inputs[id] = { deliveryMode: mode === 'cancelled' ? 'in_person' : mode, status: mode === 'cancelled' ? 'cancelled' : 'completed',
        cancelledAt: i.cancelledAt || null, ndiaRequested: !!i.ndiaRequested };
    });
    var days = groupedDays().map(function (g) {
      var d = S.days[g.key] || {};
      return { key: g.key,
        sessions: g.events.map(function (ev) { var i = S.inputs[ev.id] || {}; return { eventId: ev.id, legMinutes: Number(i.legMinutes) || 0, legKm: Number(i.legKm) || 0, billable: !!idSet[ev.id] && (i.deliveryMode || 'in_person') === 'in_person' }; }),
        returnMinutes: Number(d.returnMinutes) || 0, returnKm: Number(d.returnKm) || 0, returnPaid: d.returnPaid !== false };
    });
    return { eventIds: ids, inputs: inputs, days: days };
  }

  var previewTimer = null;
  function schedulePreview() { clearTimeout(previewTimer); previewTimer = setTimeout(preview, 350); }
  async function preview() {
    if (!S.week || !(S.week.events || []).length) return;
    var p = payload();
    if (!p.eventIds.length) { renderView(); return; }
    var r = await post('/preview', p);
    if (r._denied) return;
    (r.claims || []).forEach(function (c) { S.claims[c.eventId] = c; });
    S.dayPlans = {}; (r.dayPlans || []).forEach(function (d) { if (d.key) S.dayPlans[d.key] = d; });
    renderView();
  }

  function renderBoard(v) {
    if (!S.week) { v.innerHTML = '<div class="inv-empty">Loading the week…</div>'; if (!S.loading) loadWeek(); return; }
    var w = S.week, groups = groupedDays();
    var totals = { sessions: 0, ready: 0, review: 0, blocked: 0, invoiced: 0, amount: 0 };
    (w.events || []).forEach(function (ev) {
      totals.sessions++;
      if (ev.invoicedNumber) { totals.invoiced++; return; }
      var c = S.claims[ev.id]; if (!c) return;
      if (c.status === 'ready') totals.ready++; else if (c.status === 'needs_review') totals.review++; else if (c.status === 'blocked') totals.blocked++;
      if (S.inputs[ev.id] && S.inputs[ev.id].selected && (c.status === 'ready' || c.status === 'needs_review')) totals.amount += c.total || 0;
    });
    var thOpts = '<option value="">All practitioners</option>' + (w.therapists || []).map(function (t) { return '<option value="' + esc(t.id) + '"' + (S.therapistFilter === t.id ? ' selected' : '') + '>' + esc(t.display_name) + '</option>'; }).join('');
    v.innerHTML =
      '<div class="inv-toolbar">' +
        '<button class="inv-btn" data-act="prev-week">‹</button>' +
        '<div class="inv-week-label">Week of ' + niceDate(S.weekStart) + ' – ' + niceDate(addDays(S.weekStart, 6)) + '</div>' +
        '<button class="inv-btn" data-act="next-week">›</button>' +
        '<button class="inv-btn ghost" data-act="this-week">This week</button>' +
        '<select data-act="therapist">' + thOpts + '</select>' +
        '<span class="grow"></span>' +
        '<button class="inv-btn" data-act="reload">Recalculate</button>' +
      '</div>' +
      '<div class="inv-stats">' +
        stat('Sessions', totals.sessions) + stat('Ready', totals.ready) + stat('Needs review', totals.review) +
        stat('Blocked', totals.blocked) + stat('Already invoiced', totals.invoiced) + stat('Selected total', money(totals.amount)) +
      '</div>' +
      '<div class="inv-note"><b>How this reads.</b> One card per practitioner per day. Each session shows the leg that <i>arrives</i> at it (minutes and km); the card header holds the drive home. The rules engine pools every leg for the day, divides by the clients seen, caps each share at the MMM limit and bills travel at 50% of the session rate. Change anything and the amounts recalculate. Nothing is invoiced until you press Batch or create an invoice.</div>' +
      (groups.length ? '<div class="inv-board">' + groups.map(renderDay).join('') + '</div>' : '<div class="inv-empty">No therapy sessions on any calendar this week.</div>');
  }
  function stat(l, v) { return '<div class="inv-stat"><div class="lbl">' + esc(l) + '</div><div class="val">' + esc(v) + '</div></div>'; }

  function renderDay(g) {
    var d = S.days[g.key] || {};
    var plan = S.dayPlans && S.dayPlans[g.key];
    var pooled = plan ? (plan.pooledMinutes + ' min · ' + plan.pooledKm + ' km pooled ÷ ' + plan.divisor) : '';
    return '<div class="inv-day" data-day="' + esc(g.key) + '">' +
      '<div class="inv-day-head"><div class="who"><span class="inv-dot" style="background:' + esc(g.colour || '#5b6af0') + '"></span>' + esc(g.therapistName) + ' · ' + niceDate(g.date) + '</div>' +
      '<div class="inv-day-travel">Drive home <input type="number" min="0" step="1" data-day-field="returnMinutes" value="' + esc(d.returnMinutes) + '" placeholder="min"> min ' +
      '<input type="number" min="0" step="0.1" data-day-field="returnKm" value="' + esc(d.returnKm) + '" placeholder="km"> km ' +
      '<label><input type="checkbox" data-day-field="returnPaid"' + (d.returnPaid !== false ? ' checked' : '') + '> paid to staff</label>' +
      (pooled ? '<span class="inv-chip">' + esc(pooled) + '</span>' : '') + '</div></div>' +
      g.events.map(renderSession).join('') +
    '</div>';
  }

  function renderSession(ev) {
    var i = S.inputs[ev.id] || {}, c = S.claims[ev.id], mins = minutesBetween(ev.start, ev.end);
    var invoiced = !!ev.invoicedNumber;
    var status = invoiced ? 'invoiced' : (c ? c.status : 'blocked');
    var warn = c && c.warnings && c.warnings.length ? '<div class="inv-warn">' + c.warnings.slice(0, 3).map(warnText).map(esc).join(' · ') + '</div>' : '';
    var modes = [['in_person', 'In person'], ['telehealth', 'Telehealth'], ['non_f2f', 'Non-face-to-face'], ['ndia_report', 'NDIA report'], ['cancelled', 'Cancelled / no-show']];
    var lines = c && c.lines ? c.lines.map(function (l) { return labelForKind(l.kind) + ' ' + money(l.amount); }).join(' · ') : '';
    return '<div class="inv-sess' + (invoiced ? ' invoiced' : '') + '" data-ev="' + esc(ev.id) + '">' +
      '<input type="checkbox" data-field="selected"' + (i.selected && !invoiced && c && (c.status === 'ready' || c.status === 'needs_review') ? ' checked' : '') + (invoiced ? ' disabled' : '') + '>' +
      '<div>' + esc(perthTime(ev.start)) + '<div class="sub">' + mins + ' min</div></div>' +
      '<div><div class="client">' + esc(ev.clientName || 'No client') + (ev.hasSettings ? '' : ' <span class="inv-chip blocked">no settings</span>') + '</div><div class="sub">' + esc(ev.location || '') + '</div>' + warn + '</div>' +
      '<div class="mode-cell">' + (invoiced ? chip('invoiced', ev.invoicedNumber) : '<select data-field="deliveryMode">' + modes.map(function (m) { return '<option value="' + m[0] + '"' + (i.deliveryMode === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
        (i.deliveryMode === 'cancelled' ? '<div class="sub"><input type="datetime-local" data-field="cancelledAt" value="' + esc(i.cancelledAt ? i.cancelledAt.slice(0, 16) : '') + '" title="When was it cancelled? Blank = no-show"></div>' : '') +
        (i.deliveryMode === 'ndia_report' ? '<label class="sub"><input type="checkbox" data-field="ndiaRequested"' + (i.ndiaRequested ? ' checked' : '') + '> NDIA requested</label>' : '')) + '</div>' +
      '<div class="leg">Leg in <input type="number" min="0" data-field="legMinutes" value="' + esc(i.legMinutes) + '" placeholder="min"' + (invoiced ? ' disabled' : '') + '> min <input type="number" min="0" step="0.1" data-field="legKm" value="' + esc(i.legKm) + '" placeholder="km"' + (invoiced ? ' disabled' : '') + '> km</div>' +
      '<div class="amt-cell">' + chip(status) + '<div class="sub">' + esc(lines) + '</div></div>' +
      '<div class="inv-amt">' + (invoiced ? '' : money(c ? c.total : null)) + '</div>' +
    '</div>';
  }
  function labelForKind(k) { return ({ direct: 'Session', telehealth: 'Telehealth', non_f2f: 'NF2F', ndia_report: 'Report', cancellation: 'Cancellation', travel_labour: 'Travel', travel_non_labour: 'Km' })[k] || k; }

  // ── batch + individual invoicing ─────────────────────────────────────────
  function selectedEventIds() {
    return (S.week && S.week.events || []).filter(function (ev) { var i = S.inputs[ev.id]; var c = S.claims[ev.id]; return !ev.invoicedNumber && i && i.selected && c && (c.status === 'ready' || c.status === 'needs_review'); }).map(function (e) { return e.id; });
  }
  async function runBatch() {
    var ids = selectedEventIds();
    if (!ids.length) { toast('Nothing selected', 'Tick the sessions to invoice, or fix the blocked ones first.'); return; }
    var byClient = {}; ids.forEach(function (id) { var c = S.claims[id]; byClient[c.clientName || c.clientId] = (byClient[c.clientName || c.clientId] || 0) + (c.total || 0); });
    var summary = Object.keys(byClient).map(function (k) { return k + ': ' + money(byClient[k]); }).join('\n');
    var ok = await confirmDialog('Batch invoice ' + ids.length + ' sessions?', 'One draft invoice per client:\n' + summary);
    if (!ok) return;
    var issueDate = todayPerth();
    var r = await post('/batch', Object.assign(payload(ids), { issueDate: issueDate, dueDate: addDays(issueDate, 14) }));
    if (r._denied) return;
    var created = r.created || [], skipped = r.skipped || [];
    toast(created.length + ' invoice' + (created.length === 1 ? '' : 's') + ' created', skipped.length ? skipped.length + ' client(s) skipped: ' + skipped.map(function (s) { return (s.clientName || s.clientId) + ' (' + s.reason.replace(/_/g, ' ') + ')'; }).join(', ') : 'All selected sessions invoiced.');
    S.view = 'invoices'; render(); loadInvoices(); loadWeek();
  }

  function openNewInvoice(presetClientId) {
    if (!S.week) { toast('Load the week board first'); return; }
    var clients = {};
    (S.week.events || []).forEach(function (ev) { if (ev.clientId && !ev.invoicedNumber) (clients[ev.clientId] = clients[ev.clientId] || { id: ev.clientId, name: ev.clientName, events: [] }).events.push(ev); });
    var list = Object.values(clients).sort(function (a, b) { return (a.name || '').localeCompare(b.name || ''); });
    if (!list.length) { toast('No uninvoiced sessions this week'); return; }
    var sel = presetClientId || list[0].id;
    function body() {
      var c = clients[sel];
      return '<div class="inv-form"><div class="full"><label>Client</label><select id="ni-client">' + list.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === sel ? ' selected' : '') + '>' + esc(c.name || c.id) + '</option>'; }).join('') + '</select></div>' +
        '<div><label>Issue date</label><input type="date" id="ni-issue" value="' + todayPerth() + '"></div><div><label>Due date</label><input type="date" id="ni-due" value="' + addDays(todayPerth(), 14) + '"></div>' +
        '<div class="full"><label>Sessions this week</label>' + c.events.map(function (ev) { var cl = S.claims[ev.id]; return '<label class="inv-checks" style="margin:4px 0"><input type="checkbox" data-ni-ev="' + esc(ev.id) + '"' + (cl && cl.status !== 'blocked' && cl.status !== 'not_claimable' ? ' checked' : '') + '> ' + niceDate(perthDate(ev.start)) + ' ' + perthTime(ev.start) + ' · ' + esc(ev.therapistName) + ' · ' + (cl ? chip(cl.status) + ' ' + money(cl.total) : '') + '</label>'; }).join('') + '</div>' +
        '<div class="full"><label>Notes on the invoice</label><input id="ni-notes" maxlength="1000" placeholder="Optional"></div></div>';
    }
    var m = modal('New invoice', body(), '<button class="inv-btn" data-close>Cancel</button><button class="inv-btn primary" id="ni-create">Create draft invoice</button>');
    m.querySelector('#ni-client').onchange = function (e) { sel = e.target.value; m.querySelector('.inv-modal-body').innerHTML = body(); m.querySelector('#ni-client').onchange = arguments.callee; bind(); };
    function bind() {
      m.querySelector('#ni-create').onclick = async function () {
        var ids = Array.prototype.map.call(m.querySelectorAll('[data-ni-ev]:checked'), function (x) { return x.dataset.niEv; });
        if (!ids.length) { toast('Pick at least one session'); return; }
        var r = await post('/invoices', Object.assign(payload(ids), { clientId: sel, issueDate: m.querySelector('#ni-issue').value, dueDate: m.querySelector('#ni-due').value, notes: m.querySelector('#ni-notes').value }));
        if (r._denied) return;
        if (r._status !== 201) { toast('Could not create the invoice', r.error || ('HTTP ' + r._status) + (r.claims ? ': ' + r.claims.flatMap(function (c) { return c.warnings || []; }).map(warnText).join(', ') : '')); return; }
        closeModal(); toast('Invoice ' + r.invoice.invoice_number + ' created', money(r.invoice.total));
        S.view = 'invoices'; render(); loadInvoices(); loadWeek();
      };
    }
    bind();
  }

  // ── invoices list ────────────────────────────────────────────────────────
  var invQ = '', invStatus = '';
  async function loadInvoices() {
    var r = await api('/invoices?q=' + encodeURIComponent(invQ) + (invStatus ? '&status=' + invStatus : ''));
    if (r._denied) return; S.invoices = r.invoices || []; renderView();
  }
  function renderInvoices(v) {
    v.innerHTML = '<div class="inv-toolbar"><input class="grow" id="inv-q" placeholder="Search invoice number, client or contact" value="' + esc(invQ) + '">' +
      '<select id="inv-status"><option value="">All statuses</option>' + ['draft', 'approved', 'sent', 'paid', 'void'].map(function (s) { return '<option value="' + s + '"' + (invStatus === s ? ' selected' : '') + '>' + labelFor(s) + '</option>'; }).join('') + '</select>' +
      '<button class="inv-btn" id="inv-search">Search</button></div>' +
      (S.invoices.length ? '<table class="inv-table"><thead><tr><th>Invoice #</th><th>To</th><th>Client</th><th>Practitioner</th><th>Period</th><th>Issue date</th><th>Due date</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>' +
        S.invoices.map(function (i) { return '<tr class="row" data-inv="' + esc(i.id) + '"><td><b>' + esc(i.invoice_number) + '</b>' + (i.batch_id ? ' <span class="inv-chip">batch</span>' : '') + '</td><td>' + esc(i.invoice_to_name || '—') + '</td><td>' + esc(i.client_name || i.client_id) + '</td><td>' + esc(i.practitioner_name || '—') + '</td><td>' + esc(niceDate(i.period_start)) + (i.period_end && i.period_end !== i.period_start ? ' – ' + esc(niceDate(i.period_end)) : '') + '</td><td>' + esc(niceDate(i.issue_date)) + '</td><td>' + esc(niceDate(i.due_date)) + '</td><td class="num">' + money(i.total) + '</td><td>' + chip(i.status) + ((i.warnings || []).length ? ' <span class="inv-chip needs_review" title="' + esc(i.warnings.map(warnText).join('\n')) + '">' + i.warnings.length + ' note' + (i.warnings.length === 1 ? '' : 's') + '</span>' : '') + '</td></tr>'; }).join('') +
      '</tbody></table>' : '<div class="inv-empty">No invoices yet. Use the week board to batch a week, or “New invoice” for one client.</div>');
    v.querySelector('#inv-search').onclick = function () { invQ = v.querySelector('#inv-q').value; invStatus = v.querySelector('#inv-status').value; loadInvoices(); };
    v.querySelector('#inv-q').onkeydown = function (e) { if (e.key === 'Enter') v.querySelector('#inv-search').click(); };
    v.querySelector('#inv-status').onchange = function () { v.querySelector('#inv-search').click(); };
  }
  async function openInvoice(id) {
    var r = await api('/invoices/' + encodeURIComponent(id)); if (r._denied || !r.invoice) return;
    var i = r.invoice;
    var flow = { draft: ['approved', 'void'], approved: ['sent', 'draft', 'void'], sent: ['paid', 'void'], paid: [], void: [] }[i.status] || [];
    var body = '<div class="inv-kv">' + kv('Client', i.client_name || i.client_id) + kv('Invoice to', i.invoice_to_name || '—') + kv('Practitioner', i.practitioner_name || '—') + kv('Issue date', niceDate(i.issue_date)) + kv('Due date', niceDate(i.due_date)) + kv('Period', niceDate(i.period_start) + ' – ' + niceDate(i.period_end)) + kv('Status', chip(i.status)) + '</div>' +
      ((i.warnings || []).length ? '<div class="rb-callout"><b>Review notes:</b> ' + esc(i.warnings.map(warnText).join(' · ')) + '</div>' : '') +
      '<table class="inv-lines"><thead><tr><th>Date</th><th>Item</th><th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Limit</th><th class="num">Amount</th></tr></thead><tbody>' +
      (i.lines || []).map(function (l) { return '<tr><td>' + esc(niceDate(l.service_date)) + '</td><td><code>' + esc(l.item_code || '') + '</code></td><td>' + esc(l.description) + '</td><td class="num">' + esc(Number(l.quantity).toFixed(2)) + '</td><td class="num">' + money(l.unit_amount) + '</td><td class="num">' + (l.price_limit != null ? money(l.price_limit) : '—') + '</td><td class="num">' + money(l.amount) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><td colspan="6">Total (GST-free NDIS supports)</td><td class="num">' + money(i.total) + '</td></tr></tfoot></table>' +
      (i.notes ? '<p style="font-size:12.5px;margin-top:10px"><b>Notes:</b> ' + esc(i.notes) + '</p>' : '');
    var foot = flow.map(function (s) { return '<button class="inv-btn' + (s === 'void' ? ' danger' : s === 'paid' || s === 'approved' ? ' primary' : '') + '" data-status="' + s + '">' + (s === 'draft' ? 'Back to draft' : 'Mark ' + labelFor(s).toLowerCase()) + '</button>'; }).join('') + '<button class="inv-btn" data-close>Close</button>';
    var m = modal('Invoice ' + i.invoice_number, body, foot);
    m.querySelectorAll('[data-status]').forEach(function (b) {
      b.onclick = async function () {
        var s = b.dataset.status;
        if (s === 'void' && !(await confirmDialog('Void ' + i.invoice_number + '?', 'Its sessions become available to invoice again.'))) return;
        var rr = await post('/invoices/' + encodeURIComponent(id) + '/status', { status: s });
        if (rr._status === 200) { closeModal(); toast('Invoice ' + i.invoice_number + ' ' + labelFor(s).toLowerCase()); loadInvoices(); if (S.week) loadWeek(); }
        else toast('Could not update', rr.error || ('HTTP ' + rr._status));
      };
    });
  }
  function kv(k, v) { return '<div><div class="k">' + esc(k) + '</div><div>' + v + '</div></div>'; }

  // ── client billing settings ──────────────────────────────────────────────
  async function loadClients() { var r = await api('/clients'); if (r._denied) return; S.clients = r.clients || []; renderView(); }
  function renderClients(v) {
    var known = {}; S.clients.forEach(function (c) { known[c.client_id] = true; });
    var missing = {};
    (S.week && S.week.events || []).forEach(function (ev) { if (ev.clientId && !known[ev.clientId]) missing[ev.clientId] = ev.clientName; });
    (window.PATIENTS || []).forEach(function (p) { if (p && p.id && !known[p.id] && !missing[p.id]) missing[p.id] = (p.first + ' ' + p.last).trim(); });
    var missingIds = Object.keys(missing);
    v.innerHTML = '<div class="inv-note"><b>What the engine needs per client.</b> Funding type (NDIS limits bind plan- and agency-managed, not self-managed), age band (under 9 uses the early childhood item), budget line, the client’s MMM zone (1–5 metro/regional: 30 or 60 min travel cap; 6–7 remote: +40%/+50% and no cap), the agreed hourly rate (blank bills at the limit), the per-km rate, and which extras the service agreement allows.</div>' +
      '<div class="inv-toolbar">' + (missingIds.length ? '<select id="cl-add"><option value="">Add settings for a client…</option>' + missingIds.map(function (id) { return '<option value="' + esc(id) + '">' + esc(missing[id] || id) + '</option>'; }).join('') + '</select>' : '') + '<span class="grow"></span><button class="inv-btn" data-act="reload-clients">Refresh</button></div>' +
      (S.clients.length ? '<table class="inv-table"><thead><tr><th>Client</th><th>Invoice to</th><th>Funding</th><th>Age</th><th>Budget</th><th>MMM</th><th class="num">Rate</th><th class="num">$/km</th><th>Agreement</th></tr></thead><tbody>' +
        S.clients.map(function (c) { var a = c.agreement || {}; var on = ['telehealth', 'nonF2f', 'ndiaReports', 'cancellations', 'travel'].filter(function (k) { return a[k]; }); return '<tr class="row" data-client="' + esc(c.client_id) + '"><td><b>' + esc(c.client_name || c.client_id) + '</b>' + (c.ndis_number ? '<div class="sub" style="font-size:11px;color:var(--muted)">' + esc(c.ndis_number) + '</div>' : '') + '</td><td>' + esc(c.invoice_to_name || '—') + '</td><td>' + esc(c.funding_type.replace('_', ' ')) + '</td><td>' + esc(c.age_band === 'under_9' ? 'Under 9' : '9+') + '</td><td>' + esc(c.budget.replace('_', ' ')) + '</td><td>' + esc(c.mmm) + '</td><td class="num">' + (c.agreed_hourly_rate != null ? money(c.agreed_hourly_rate) : 'limit') + '</td><td class="num">' + money(c.per_km_rate) + '</td><td>' + (on.length ? on.map(function (k) { return '<span class="inv-chip ready">' + esc(k) + '</span>'; }).join(' ') : '<span class="inv-chip blocked">none</span>') + '</td></tr>'; }).join('') +
      '</tbody></table>' : '<div class="inv-empty">No client billing settings yet. Pick a client above to add the first.</div>');
    var add = v.querySelector('#cl-add'); if (add) add.onchange = function () { if (add.value) openClientForm(add.value, missing[add.value]); };
  }
  function openClientForm(clientId, name) {
    var c = S.clients.find(function (x) { return x.client_id === clientId; }) || {};
    var a = c.agreement || {};
    var p = (window.PATIENTS || []).find(function (x) { return x && x.id === clientId; });
    var fundingGuess = c.funding_type || (p && /self/i.test(p.plan || '') ? 'self_managed' : p && /agency|ndia/i.test(p.plan || '') ? 'ndia_managed' : 'plan_managed');
    function sel(id, opts, val) { return '<select id="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
    var body = '<div class="inv-form">' +
      '<div><label>Client name</label><input id="cf-name" value="' + esc(c.client_name || name || (p ? p.first + ' ' + p.last : '')) + '"></div>' +
      '<div><label>NDIS number</label><input id="cf-ndis" value="' + esc(c.ndis_number || (p && p.ndisNumber) || '') + '"></div>' +
      '<div><label>Funding</label>' + sel('cf-funding', [['plan_managed', 'Plan managed'], ['ndia_managed', 'NDIA (agency) managed'], ['self_managed', 'Self managed']], fundingGuess) + '</div>' +
      '<div><label>Age band</label>' + sel('cf-age', [['9_plus', '9 or older'], ['under_9', 'Younger than 9 (early childhood)']], c.age_band || '9_plus') + '</div>' +
      '<div><label>Budget line</label>' + sel('cf-budget', [['capacity_building', 'Capacity Building – Improved Daily Living'], ['core', 'Core – Disability-Related Health Supports'], ['employment', 'Capacity Building – Employment']], c.budget || 'capacity_building') + '</div>' +
      '<div><label>Client MMM zone</label>' + sel('cf-mmm', [[1, '1 Metropolitan (30 min cap)'], [2, '2 Regional centre (30 min)'], [3, '3 Regional centre (30 min)'], [4, '4 Regional (60 min)'], [5, '5 Regional (60 min)'], [6, '6 Remote (+40%, no cap)'], [7, '7 Very remote (+50%, no cap)']], Number(c.mmm) || 1) + '</div>' +
      '<div><label>Agreed hourly rate (blank = price limit)</label><input id="cf-rate" type="number" step="0.01" min="0" value="' + esc(c.agreed_hourly_rate != null ? c.agreed_hourly_rate : '') + '" placeholder="193.99"></div>' +
      '<div><label>Per-km rate (guide max $0.99)</label><input id="cf-km" type="number" step="0.01" min="0" value="' + esc(c.per_km_rate != null ? c.per_km_rate : 0.99) + '"></div>' +
      '<div><label>Invoice to (plan manager / nominee)</label><input id="cf-to" value="' + esc(c.invoice_to_name || '') + '"></div>' +
      '<div><label>Invoice email</label><input id="cf-email" type="email" value="' + esc(c.invoice_to_email || '') + '"></div>' +
      '<div class="full"><label>Service agreement allows</label><div class="inv-checks">' + [['telehealth', 'Telehealth'], ['nonF2f', 'Non-face-to-face'], ['ndiaReports', 'NDIA reports'], ['cancellations', 'Short-notice cancellation fee'], ['travel', 'Provider travel']].map(function (k) { return '<label><input type="checkbox" data-agree="' + k[0] + '"' + (a[k[0]] ? ' checked' : '') + '> ' + k[1] + '</label>'; }).join('') + '</div></div>' +
      '<div class="full"><label>Notes</label><input id="cf-notes" maxlength="500" value="' + esc(c.notes || '') + '"></div></div>';
    var m = modal('Billing settings · ' + esc(c.client_name || name || clientId), body, '<button class="inv-btn" data-close>Cancel</button><button class="inv-btn primary" id="cf-save">Save</button>');
    m.querySelector('#cf-save').onclick = async function () {
      var agreement = {}; m.querySelectorAll('[data-agree]').forEach(function (x) { agreement[x.dataset.agree] = x.checked; });
      var r = await put('/clients/' + encodeURIComponent(clientId), { clientName: m.querySelector('#cf-name').value, ndisNumber: m.querySelector('#cf-ndis').value, fundingType: m.querySelector('#cf-funding').value, ageBand: m.querySelector('#cf-age').value, budget: m.querySelector('#cf-budget').value, mmm: Number(m.querySelector('#cf-mmm').value), agreedHourlyRate: m.querySelector('#cf-rate').value, perKmRate: m.querySelector('#cf-km').value, invoiceToName: m.querySelector('#cf-to').value, invoiceToEmail: m.querySelector('#cf-email').value, agreement: agreement, notes: m.querySelector('#cf-notes').value });
      if (r._status === 200) { closeModal(); toast('Billing settings saved'); loadClients(); if (S.week) loadWeek(); }
      else toast('Could not save', r.error || ('HTTP ' + r._status));
    };
  }

  // ── rule book ────────────────────────────────────────────────────────────
  async function openRuleBook() {
    if (!S.rulebook) { var r = await api('/rulebook'); if (r._denied) return; S.rulebook = r; }
    var rb = S.rulebook, fy = rb.financialYear || 'FY2026-27', p = (rb.otPrices || {})[fy] || {};
    var ex = rb.examples || {};
    var body =
      '<div class="rb-hero"><h2>How Opal turns a week on the calendar into NDIS invoices</h2><p>Every number below comes from the same rules engine that prices your invoices, so what you read here is what the portal does. Sources: NDIS Pricing Arrangements and Price Limits 2025-26 v1.1 and the 2026-27 Pricing Schedule v1.2. Current year: <b>' + esc(fy) + '</b>.</p></div>' +
      '<div class="rb-grid">' +
        '<div class="rb-card"><h4>🧾 The OT hour</h4><div class="big">' + money(p.national) + '</div><p>Limit per hour for an OT (item 15_617_0128_1_3). Remote (MMM6) ' + money(p.remote) + ', very remote (MMM7) ' + money(p.veryRemote) + '. Same limit for telehealth, non-face-to-face, reports and cancellations. No evening or weekend loading for therapy.</p></div>' +
        '<div class="rb-card"><h4>⏱️ Minutes, not blocks</h4><p>A 45-minute session bills 0.75 of the hourly rate; 20 minutes bills a third. The engine uses the exact minutes on the calendar, rounded to the cent.</p><ul><li>10 min → ' + money(p.national / 6) + '</li><li>30 min → ' + money(p.national / 2) + '</li><li>50 min → ' + money(p.national * 5 / 6) + '</li></ul></div>' +
        '<div class="rb-card"><h4>🚗 Travel is half price, and capped</h4><div class="big">' + money(p.national / 2) + '</div><p>Per hour of driving. Cap per client per direction: 30 min in MMM1–3, 60 min in MMM4–5, none in MMM6–7. Vehicle costs go on a separate line at up to $0.99/km. Only on a face-to-face session, and only if the service agreement says so.</p></div>' +
        '<div class="rb-card"><h4>🔁 The drive home</h4><p>Claimable only when the practice pays the therapist for it. It goes into the day’s pool like any other leg. Untick “paid to staff” on the board and it drops out.</p></div>' +
        '<div class="rb-card"><h4>🧮 Pooling a multi-client day</h4><p>Add up every leg of the day (to the first client, between clients, home). Divide by the clients seen. Cap each share. That is the NDIA’s own worked method and it keeps bills even.</p></div>' +
        '<div class="rb-card"><h4>❌ Cancellations</h4><p>Under <b>2 clear business days</b> notice (or a no-show) you may bill up to 100% of the session, if the service agreement says so and no other billable work filled the slot. Weekends and public holidays do not count as notice. A Tuesday 10 am session after a Monday holiday can be cancelled free until Thursday 10 am.</p></div>' +
        '<div class="rb-card"><h4>💻 Telehealth, NF2F, reports</h4><p>All at the session rate, all needing advance agreement. Reports also need an NDIA request. Writing to another provider about the client is billable; service agreements, bookings, claiming and staff training never are.</p></div>' +
        '<div class="rb-card"><h4>👥 Groups &amp; funding</h4><p>Group price per client = limit ÷ group size. Self-managed clients sit outside the limits (the engine notes it and lets the agreed rate through). NDIA-managed plans need a registered provider. No surcharges, gap fees or late fees, ever.</p></div>' +
      '</div>' +
      '<h3 style="margin:18px 0 8px">The weekly workflow</h3>' +
      [['Calendars in', 'The week board reads your calendar and every employee calendar. Each therapy session is a candidate; cancelled ones come through too.'],
       ['Legs in', 'When the calendar is on the same week, the travel chain fills the legs. Otherwise type the minutes and km that arrive at each session, and the drive home in the card header.'],
       ['Check the chips', '<b>Ready</b> is within every limit. <b>Review</b> means a rate or leg is above a limit; nothing is clamped, you decide. <b>Blocked</b> needs client settings or a fix. <b>No claim</b> is a cancellation with enough notice.'],
       ['Batch or one-off', '“Batch invoice this week” makes one draft per client from the ticked sessions. “New invoice” does one client. A session can only ever sit on one live invoice; voiding frees it.'],
       ['Draft → approved → sent → paid', 'Each step is audited. Push approved invoices to Xero from the Accounting tab.']].map(function (s, i) { return '<div class="rb-step"><div class="rb-num">' + (i + 1) + '</div><p><b>' + s[0] + '</b>' + s[1] + '</p></div>'; }).join('') +
      '<h3 style="margin:18px 0 8px">Worked examples</h3>' +
      exampleHtml('Three clients back to back (metro, paid return)', 'Office → A 20 min/15 km → B 15 min/10 km → C 25 min/20 km → office 30 min/25 km. Pool 90 min and 70 km, divide by 3: every client gets 30 min at $97 and 23.3 km at $0.99.', ex.threeClientRun) +
      exampleHtml('A long metro run: the cap bites', 'Office → A 40 min → B 35 min → office 45 min. 120 minutes pooled over 2 clients is 60 each, but MMM1 caps at 30. The extra hour is not recoverable, which is why clusters matter.', ex.longRun) +
      exampleHtml('One remote client (MMM6)', 'A 90-minute session two hours away. Rates load by 40%, no travel cap, both legs claimable.', ex.remoteRun) +
      '<h3 style="margin:18px 0 8px">Try a day</h3><div class="rb-example"><div class="rb-sim" id="rb-sim">' + simRows([{ label: 'Client A', minutes: 60, legMinutes: 20, legKm: 15 }, { label: 'Client B', minutes: 45, legMinutes: 15, legKm: 10 }]) + '</div>' +
      '<div class="inv-toolbar" style="margin-top:8px"><label>MMM <select id="rb-mmm">' + [1, 2, 3, 4, 5, 6, 7].map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></label><label>Drive home <input type="number" id="rb-ret" value="30" style="width:70px"> min</label><label><input type="number" id="rb-retkm" value="25" style="width:70px"> km</label><label><input type="checkbox" id="rb-retpaid" checked> paid</label><button class="inv-btn" id="rb-add">＋ client</button><span class="grow"></span><button class="inv-btn primary" id="rb-run">Calculate</button></div><div class="rb-result" id="rb-result"></div></div>' +
      '<details class="rb-quiz" style="margin-top:14px"><summary>Quick quiz: five things people get wrong</summary><ul><li>Travel between two clients is the <i>arriving</i> leg of the second client, never counted twice.</li><li>A Saturday OT session bills exactly the weekday rate.</li><li>Writing the service agreement is not billable, even if the agreement pre-authorises non-face-to-face time.</li><li>“Two clear business days” runs hour to hour, so 9:59 am Thursday is fine for a 10 am Tuesday after a long weekend.</li><li>If a client cancels late while you are already driving, the wasted leg goes on their cancellation claim, and the other clients’ pool is recomputed without them.</li></ul></details>';
    var m = modal('📖 Rule book', body, '<button class="inv-btn" data-close>Close</button>');
    m.querySelector('#rb-add').onclick = function () { var box = m.querySelector('#rb-sim'); box.insertAdjacentHTML('beforeend', simRows([{ label: 'Client ' + String.fromCharCode(65 + box.querySelectorAll('.rb-sim-row[data-row]').length), minutes: 60, legMinutes: 20, legKm: 15 }], true)); };
    m.addEventListener('click', function (e) { var d = e.target.closest('[data-del]'); if (d) d.closest('.rb-sim-row').remove(); });
    m.querySelector('#rb-run').onclick = async function () {
      var sessions = Array.prototype.map.call(m.querySelectorAll('.rb-sim-row[data-row]'), function (row) { return { label: row.querySelector('[data-f=label]').value, minutes: Number(row.querySelector('[data-f=minutes]').value), legMinutes: Number(row.querySelector('[data-f=legMinutes]').value), legKm: Number(row.querySelector('[data-f=legKm]').value), billable: row.querySelector('[data-f=billable]').value === 'yes' }; });
      var r = await post('/simulate', { mmm: Number(m.querySelector('#rb-mmm').value), sessions: sessions, returnMinutes: Number(m.querySelector('#rb-ret').value), returnKm: Number(m.querySelector('#rb-retkm').value), returnPaid: m.querySelector('#rb-retpaid').checked });
      if (r._denied) return;
      m.querySelector('#rb-result').innerHTML = exampleTable(r);
    };
  }
  function simRows(rows, noHead) {
    return (noHead ? '' : '<div class="rb-sim-row rb-sim-head"><div>Client</div><div>Session min</div><div>Leg in min</div><div>Leg in km</div><div>Attended</div><div></div></div>') +
      rows.map(function (r) { return '<div class="rb-sim-row" data-row><input data-f="label" value="' + esc(r.label) + '"><input data-f="minutes" type="number" value="' + r.minutes + '"><input data-f="legMinutes" type="number" value="' + r.legMinutes + '"><input data-f="legKm" type="number" value="' + r.legKm + '"><select data-f="billable"><option value="yes">Yes</option><option value="no">Cancelled</option></select><button class="inv-btn ghost" data-del title="Remove">✕</button></div>'; }).join('');
  }
  function exampleHtml(title, story, ex) {
    if (!ex) return '';
    return '<div class="rb-example"><h4>' + esc(title) + '</h4><p style="font-size:12.5px;margin:0 0 6px">' + esc(story) + '</p>' + exampleTable(ex) + '</div>';
  }
  function exampleTable(ex) {
    var plan = ex.plan || {};
    var trip = '<div class="rb-trip"><span class="stop">Base</span>' + (ex.clients || []).map(function (c) { var s = c.share; return '<span class="leg">→</span><span class="stop">' + esc(c.label) + ' · ' + c.minutes + ' min' + (s ? ' <span class="leg">(share ' + s.minutes + ' min / ' + s.km + ' km)</span>' : ' <span class="leg">(cancelled)</span>') + '</span>'; }).join('') + '<span class="leg">→</span><span class="stop">Base</span></div>' +
      '<div class="inv-warn" style="color:var(--muted)">Pooled ' + plan.pooledMinutes + ' min and ' + plan.pooledKm + ' km ÷ ' + plan.divisor + ' client' + (plan.divisor === 1 ? '' : 's') + (plan.warnings && plan.warnings.length ? ' · ' + plan.warnings.map(warnText).join(' · ') : '') + '</div>';
    var rows = (ex.clients || []).map(function (c) {
      var cl = c.claim || {};
      return '<tr><td><b>' + esc(c.label) + '</b> ' + chip(cl.status) + '</td><td>' + (cl.lines || []).map(function (l) { return labelForKind(l.kind) + ' ' + (l.minutes ? l.minutes + ' min × ' + money(l.unitAmount) : l.kind === 'travel_non_labour' ? l.quantity + ' × $1' : '') + ' = <b>' + money(l.amount) + '</b>'; }).join('<br>') + ((cl.warnings || []).filter(function (w) { return w !== 'no_agreed_rate_using_price_limit'; }).length ? '<div class="inv-warn">' + esc(cl.warnings.filter(function (w) { return w !== 'no_agreed_rate_using_price_limit'; }).map(warnText).join(' · ')) + '</div>' : '') + '</td><td class="num"><b>' + money(cl.total) + '</b></td></tr>';
    }).join('');
    return trip + '<table class="inv-lines"><thead><tr><th>Client</th><th>Lines</th><th class="num">Invoice</th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td colspan="2">Day total</td><td class="num">' + money(ex.dayTotal) + '</td></tr></tfoot></table>';
  }

  // ── modal plumbing ───────────────────────────────────────────────────────
  function modal(title, body, foot) {
    closeModal();
    var bg = document.createElement('div'); bg.className = 'inv-modal-bg'; bg.id = 'inv-modal';
    bg.innerHTML = '<div class="inv-modal" role="dialog" aria-modal="true"><div class="inv-modal-head"><h3>' + title + '</h3><button class="inv-btn ghost" data-close aria-label="Close">✕</button></div><div class="inv-modal-body">' + body + '</div><div class="inv-modal-foot">' + (foot || '') + '</div></div>';
    bg.addEventListener('click', function (e) { if (e.target === bg || e.target.closest('[data-close]')) closeModal(); });
    document.body.appendChild(bg);
    return bg;
  }
  function closeModal() { var m = document.getElementById('inv-modal'); if (m) m.remove(); }
  function confirmDialog(title, text) {
    // dialog.js themes every confirm in the portal (portalConfirm); the native
    // confirm is only the fallback when the shell has not loaded it.
    if (typeof window.portalConfirm === 'function') return Promise.resolve(window.portalConfirm(text, { title: title }));
    return Promise.resolve(window.confirm(title + '\n\n' + text));
  }

  // ── events ───────────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var r = root(); if (!r || !r.contains(e.target)) return;
    var b = e.target.closest('[data-act], [data-view], tr.row');
    if (!b) return;
    if (b.dataset.view) { S.view = b.dataset.view; render(); if (S.view === 'invoices') loadInvoices(); if (S.view === 'clients') loadClients(); if (S.view === 'board' && !S.week) loadWeek(); return; }
    if (b.dataset.inv) { openInvoice(b.dataset.inv); return; }
    if (b.dataset.client) { openClientForm(b.dataset.client); return; }
    switch (b.dataset.act) {
      case 'rulebook': openRuleBook(); break;
      case 'new-invoice': openNewInvoice(); break;
      case 'batch': runBatch(); break;
      case 'prev-week': S.weekStart = addDays(S.weekStart, -7); S.week = null; loadWeek(); break;
      case 'next-week': S.weekStart = addDays(S.weekStart, 7); S.week = null; loadWeek(); break;
      case 'this-week': S.weekStart = mondayOf(todayPerth()); S.week = null; loadWeek(); break;
      case 'reload': loadWeek(); break;
      case 'reload-clients': loadClients(); break;
    }
  });
  document.addEventListener('change', function (e) {
    var r = root(); if (!r || !r.contains(e.target)) return;
    var t = e.target;
    if (t.dataset.act === 'therapist') { S.therapistFilter = t.value; S.week = null; loadWeek(); return; }
    var sess = t.closest('.inv-sess');
    if (sess && t.dataset.field) {
      var inp = S.inputs[sess.dataset.ev] = S.inputs[sess.dataset.ev] || {};
      var f = t.dataset.field;
      if (t.type === 'checkbox') inp[f] = t.checked;
      else if (f === 'cancelledAt') inp[f] = t.value ? new Date(t.value).toISOString() : null;
      else inp[f] = t.value;
      if (f === 'selected') { renderView(); return; }
      if (f === 'deliveryMode') { renderView(); }
      schedulePreview(); return;
    }
    var day = t.closest('.inv-day');
    if (day && t.dataset.dayField) {
      var d = S.days[day.dataset.day] = S.days[day.dataset.day] || {};
      d[t.dataset.dayField] = t.type === 'checkbox' ? t.checked : t.value;
      schedulePreview();
    }
  });
  document.addEventListener('input', function (e) {
    var r = root(); if (!r || !r.contains(e.target)) return;
    if (e.target.dataset.field === 'legMinutes' || e.target.dataset.field === 'legKm' || e.target.dataset.dayField === 'returnMinutes' || e.target.dataset.dayField === 'returnKm') {
      e.target.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  // Open when the tab is selected — by a click on the tab button, or by any
  // programmatic switchTab (deep link, restore, the More menu): the view
  // gaining .active is the one signal every route shares.
  document.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('.tab[data-tab="invoicing"]');
    if (t) setTimeout(render, 50); // renderBoard loads the week when it has none
  });
  function watchView() {
    var view = document.getElementById('view-invoicing');
    if (!view || !window.MutationObserver) return;
    var wasActive = view.classList.contains('active');
    new MutationObserver(function () {
      var active = view.classList.contains('active');
      if (active && !wasActive) render();
      wasActive = active;
    }).observe(view, { attributes: true, attributeFilter: ['class'] });
    if (wasActive) render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchView); else watchView();

  window.Invoicing = { open: function () { render(); if (!S.week) loadWeek(); }, openRuleBook: openRuleBook, state: S };
})();
