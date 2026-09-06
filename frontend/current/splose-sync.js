/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — SPLOSE DRAFT-AND-PUBLISH SYNC (frontend)

   The calendar is where a client appointment is created, moved or cancelled.
   Those changes queue up on the server (splose_sync_queue) and nothing goes to
   Splose until the user presses "Sync Splose". This module:

     • puts the Sync Splose button (with a pending count) in the calendar bar
     • draws the review panel: every queued change, a service/case/reason
       chooser where one is needed, Publish, and live progress
     • marks unsynced tiles on the calendar grid
     • asks before the user leaves the Calendar tab with unsynced changes,
       and warns on page close
     • makes a drag / resize / time-edit real: the existing commitMove only
       repainted the tile — this persists the new time (PATCH), which the
       backend queues for Splose
     • polls for "changed inside Splose" alerts and shows each one, asking
       whether the change was valid

   Globals on window (window.SploseSync), no modules — the house pattern.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  var doc = global.document;
  if (!doc) return;

  var S = {
    enabled: false,
    writeEnabled: false,
    pending: [],            // rows from /api/splose-sync/pending
    pendingByEvent: {},     // eventId → row
    services: null, reasons: null, cases: {},
    panelOpen: false,
    publishing: null,       // status object while a run is active
    alertQueue: [], alertShowing: false,
    pollTimer: null,
    lastRunShown: null,
  };

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fetchJson(url, opts) {
    opts = opts || {};
    opts.credentials = 'include';
    if (opts.body && typeof opts.body !== 'string') {
      opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
      opts.body = JSON.stringify(opts.body);
    }
    return fetch(url, opts).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, json: j }; });
    });
  }
  function toast(msg, isError) {
    if (typeof global.showToast === 'function') global.showToast(msg, isError);
  }
  function confirmDialog(msg, opts) {
    if (typeof global.portalConfirm === 'function') return global.portalConfirm(msg, opts);
    return Promise.resolve(global.confirm(msg));
  }
  function fmtPerth(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
    } catch (e) { return iso; }
  }
  function fmtTimeOnly(iso) {
    try { return new Date(iso).toLocaleTimeString('en-AU', { timeZone: 'Australia/Perth', hour: 'numeric', minute: '2-digit' }); } catch (e) { return iso; }
  }
  function isCalendarActive() {
    var el = doc.querySelector('.tab.active[data-tab]');
    return !!(el && el.dataset.tab === 'calendar');
  }
  function canUse() {
    var u = global.APP_USER;
    return S.enabled && u && u.role !== 'read_only' && u.role !== 'pre_employee';
  }

  // ── Server state ──────────────────────────────────────────────────────────

  function refreshPending() {
    if (!canUse()) return Promise.resolve();
    return fetchJson('/api/splose-sync/pending').then(function (r) {
      if (!r.ok) { if (r.status === 403 && r.json.code === 'feature_disabled') { S.enabled = false; renderButton(); } return; }
      S.pending = r.json.changes || [];
      S.pendingByEvent = {};
      S.pending.forEach(function (c) { S.pendingByEvent[c.eventId] = c; });
      renderButton();
      decorateTiles();
      if (S.panelOpen) renderPanel();
    }).catch(function () {});
  }

  function refreshStatus() {
    if (!canUse()) return Promise.resolve(null);
    return fetchJson('/api/splose-sync/status').then(function (r) {
      if (!r.ok) return null;
      S.writeEnabled = r.json.writeEnabled === true;
      S.publishing = r.json.running || null;
      if (!S.publishing && r.json.lastRun && S.lastRunShown !== r.json.lastRun.finishedAt) {
        S.lastRunShown = r.json.lastRun.finishedAt;
        S.lastRun = r.json.lastRun;
      }
      return r.json;
    }).catch(function () { return null; });
  }

  function loadReference() {
    var jobs = [];
    if (!S.services) jobs.push(fetchJson('/api/splose/services').then(function (r) { S.services = r.ok ? (r.json.data || []) : []; }));
    if (!S.reasons) jobs.push(fetchJson('/api/splose/cancellation-reasons').then(function (r) { S.reasons = r.ok ? (r.json.data || []) : []; }));
    return Promise.all(jobs);
  }

  function casesFor(patientId) {
    if (!patientId) return Promise.resolve([]);
    if (S.cases[patientId]) return Promise.resolve(S.cases[patientId]);
    return fetchJson('/api/splose/cases?patientId=' + encodeURIComponent(patientId)).then(function (r) {
      var list = r.ok ? (r.json.data || []) : [];
      S.cases[patientId] = list;
      return list;
    });
  }

  // Session type → the Splose service the practice actually uses for it.
  var SERVICE_HINT = {
    initial: /initial/i, therapy: /^therapy session/i, assessment: /^assessment session/i, mdt: /mdt/i,
  };
  function defaultServiceId(change) {
    if (change.payload.serviceId) return change.payload.serviceId;
    var hint = SERVICE_HINT[change.payload.sessionType];
    if (!hint || !S.services) return null;
    var hit = S.services.find(function (s) { return hint.test(s.name || ''); });
    return hit ? hit.id : null;
  }

  // ── Button in the calendar bar ────────────────────────────────────────────

  function ensureButton() {
    var bar = doc.querySelector('#view-calendar .cal-topbar');
    if (!bar || doc.getElementById('splose-sync-btn')) return;
    var btn = doc.createElement('button');
    btn.id = 'splose-sync-btn';
    btn.className = 'splose-sync-btn';
    btn.type = 'button';
    btn.title = 'Review the changes waiting to be written to Splose';
    btn.setAttribute('data-help', 'cal-splose-sync');
    btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg><span class="lbl">Sync Splose</span><span class="cnt" hidden>0</span>';
    btn.addEventListener('click', function () { openPanel(); });
    var legend = doc.getElementById('cal-legend-wrap');
    if (legend && legend.parentElement === bar) bar.insertBefore(btn, legend); else bar.appendChild(btn);
  }

  function renderButton() {
    ensureButton();
    var btn = doc.getElementById('splose-sync-btn');
    if (!btn) return;
    btn.hidden = !canUse();
    var n = S.pending.filter(function (c) { return c.status !== 'publishing'; }).length;
    var cnt = btn.querySelector('.cnt');
    cnt.textContent = String(n);
    cnt.hidden = n === 0;
    btn.classList.toggle('has-pending', n > 0);
    btn.classList.toggle('publishing', !!S.publishing);
    btn.querySelector('.lbl').textContent = S.publishing ? 'Syncing…' : 'Sync Splose';
  }

  // ── Tile decoration ───────────────────────────────────────────────────────

  function decorateTiles() {
    var sessions = global.SESSIONS || {};
    Object.keys(sessions).forEach(function (k) {
      var s = sessions[k];
      if (!s || !s.element) return;
      var row = s.dbId ? S.pendingByEvent[s.dbId] : null;
      s.element.classList.toggle('splose-unsynced', !!row);
      var chip = s.element.querySelector('.splose-chip');
      if (row && !chip) {
        chip = doc.createElement('span');
        chip.className = 'splose-chip';
        s.element.appendChild(chip);
      }
      if (chip) {
        if (!row) { chip.remove(); return; }
        chip.textContent = row.status === 'failed' ? '!' : '↑';
        chip.title = row.status === 'failed' ? ('Splose sync failed: ' + (row.error || '')) : ('Not yet in Splose — ' + row.action);
        chip.classList.toggle('failed', row.status === 'failed');
      }
    });
  }

  // ── Review panel ──────────────────────────────────────────────────────────

  function ensurePanel() {
    var p = doc.getElementById('splose-sync-panel');
    if (p) return p;
    p = doc.createElement('div');
    p.id = 'splose-sync-panel';
    p.className = 'splose-sync-panel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-labelledby', 'splose-sync-title');
    p.hidden = true;
    p.innerHTML =
      '<div class="ssp-backdrop"></div>' +
      '<div class="ssp-card">' +
        '<header class="ssp-head"><div><div class="ssp-eyebrow">Splose</div><h2 id="splose-sync-title">Changes waiting to be written to Splose</h2></div>' +
        '<button type="button" class="ssp-close" aria-label="Close">×</button></header>' +
        '<div class="ssp-body"></div>' +
        '<footer class="ssp-foot"></footer>' +
      '</div>';
    doc.body.appendChild(p);
    p.querySelector('.ssp-close').addEventListener('click', closePanel);
    p.querySelector('.ssp-backdrop').addEventListener('click', closePanel);
    p.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    return p;
  }

  function openPanel() {
    if (!canUse()) return;
    S.panelOpen = true;
    var p = ensurePanel();
    p.hidden = false;
    p.querySelector('.ssp-body').innerHTML = '<div class="ssp-empty">Loading…</div>';
    Promise.all([refreshPending(), refreshStatus(), loadReference()]).then(function () {
      renderPanel();
      var first = p.querySelector('button, select, input');
      if (first) first.focus();
    });
  }
  function closePanel() {
    S.panelOpen = false;
    var p = doc.getElementById('splose-sync-panel');
    if (p) p.hidden = true;
  }

  var ACTION_LABEL = { create: 'New appointment', update: 'Moved', cancel: 'Cancelled' };

  function renderPanel() {
    var p = ensurePanel();
    var body = p.querySelector('.ssp-body');
    var foot = p.querySelector('.ssp-foot');
    var rows = S.pending;

    if (S.publishing) {
      var st = S.publishing;
      var pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
      body.innerHTML =
        '<div class="ssp-progress"><div class="ssp-bar"><div class="ssp-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<div class="ssp-progress-text">' + st.done + ' of ' + st.total + ' written' + (st.failed ? ' · ' + st.failed + ' failed' : '') +
        (st.current ? ' · now: ' + esc(ACTION_LABEL[st.current.action] || st.current.action) + ' — ' + esc(st.current.title || '') : '') + '</div>' +
        '<p class="ssp-note">Splose allows 60 calls a minute across the whole practice. Changes are sent one at a time with a short gap so the calendar watchers keep working. A full week for one therapist takes about a minute.</p></div>';
      foot.innerHTML = '<button type="button" class="btn" data-act="close">Keep working</button>';
      foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
      return;
    }

    var html = '';
    if (S.lastRun && S.lastRun.results && S.lastRun.results.length) {
      var lr = S.lastRun;
      var failed = lr.results.filter(function (r) { return !r.ok; });
      html += '<div class="ssp-lastrun ' + (failed.length ? 'has-fail' : 'all-ok') + '">' +
        '<b>Last sync:</b> ' + (lr.total - lr.failed) + ' written' + (lr.failed ? ', ' + lr.failed + ' failed — still listed below' : '') +
        '</div>';
    }
    if (!S.writeEnabled) {
      html += '<div class="ssp-warn">Writing to Splose is switched off in this environment. You can review and shape the week; publishing will be refused until the practice owner turns it on.</div>';
    }
    if (!rows.length) {
      html += '<div class="ssp-empty">Nothing waiting. Every client appointment on your calendar is in Splose.</div>';
      body.innerHTML = html;
      foot.innerHTML = '<button type="button" class="btn" data-act="close">Close</button>';
      foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
      return;
    }

    var groups = { cancel: [], update: [], create: [] };
    rows.forEach(function (r) { (groups[r.action] || groups.create).push(r); });
    html += '<p class="ssp-intro">Tick what should go to Splose now. Cancellations are sent first so their slots are free, then moves, then new appointments.</p>';
    ['cancel', 'update', 'create'].forEach(function (act) {
      var list = groups[act];
      if (!list.length) return;
      html += '<h3 class="ssp-group">' + esc(ACTION_LABEL[act]) + ' <span class="n">' + list.length + '</span></h3><ul class="ssp-list">';
      list.forEach(function (c) {
        var when = fmtPerth(c.start) + (c.end ? ' – ' + fmtTimeOnly(c.end) : '');
        var who = c.clientName ? esc(c.clientName) : (c.payload.patientId ? 'Client #' + esc(c.payload.patientId) : '');
        html += '<li class="ssp-row ' + (c.status === 'failed' ? 'failed' : '') + '" data-id="' + esc(c.id) + '">' +
          '<label class="ssp-check"><input type="checkbox" checked data-pick="' + esc(c.id) + '"></label>' +
          '<div class="ssp-main"><div class="ssp-title">' + esc(c.title || 'Appointment') + (who ? ' <span class="who">' + who + '</span>' : '') + '</div>' +
          '<div class="ssp-when">' + esc(when) + '</div>' +
          (c.status === 'failed' ? '<div class="ssp-err">' + esc(c.error || 'Failed last time') + '</div>' : '') +
          renderRowControls(c) +
          '</div>' +
          '<button type="button" class="ssp-discard" data-discard="' + esc(c.id) + '" title="Drop this change from the queue (the calendar keeps it)">Discard</button>' +
          '</li>';
      });
      html += '</ul>';
    });
    body.innerHTML = html;

    body.querySelectorAll('[data-discard]').forEach(function (b) {
      b.addEventListener('click', function () { discardChange(b.getAttribute('data-discard')); });
    });
    // Case chooser for creates that have none yet
    rows.filter(function (c) { return c.action === 'create' && !c.payload.caseId && c.payload.patientId; }).forEach(function (c) {
      casesFor(c.payload.patientId).then(function (list) {
        var sel = body.querySelector('select[data-case="' + c.id + '"]');
        if (!sel) return;
        var live = list.filter(function (k) { return !k.archived; });
        if (live.length <= 1) { sel.closest('.ssp-field').hidden = true; return; }
        sel.innerHTML = '<option value="">Choose a case…</option>' + live.map(function (k) {
          return '<option value="' + esc(k.id) + '">' + esc(k.name || k.title || ('Case #' + k.id)) + (k.status ? ' · ' + esc(k.status) : '') + '</option>';
        }).join('');
        sel.closest('.ssp-field').hidden = false;
      });
    });

    foot.innerHTML =
      '<button type="button" class="btn" data-act="close">Not now</button>' +
      '<span class="spacer"></span>' +
      '<button type="button" class="btn primary" data-act="publish"' + (S.writeEnabled ? '' : ' disabled') + '>Write to Splose</button>';
    foot.querySelector('[data-act=close]').addEventListener('click', closePanel);
    foot.querySelector('[data-act=publish]').addEventListener('click', function () { publishSelected(); });
  }

  function renderRowControls(c) {
    if (c.action === 'create') {
      var svc = S.services || [];
      var chosen = defaultServiceId(c);
      var html = '<div class="ssp-field"><label>Service <select data-service="' + esc(c.id) + '">' +
        '<option value="">Choose a service…</option>' +
        svc.map(function (s) { return '<option value="' + esc(s.id) + '"' + (String(s.id) === String(chosen) ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
        '</select></label></div>';
      if (!c.payload.caseId) html += '<div class="ssp-field" hidden><label>Case <select data-case="' + esc(c.id) + '"></select></label></div>';
      return html;
    }
    if (c.action === 'cancel') {
      var rs = S.reasons || [];
      var def = c.payload.reasonId || (rs.find(function (r) { return /^other$/i.test(r.reason); }) || {}).id;
      return '<div class="ssp-field"><label>Reason <select data-reason="' + esc(c.id) + '">' +
        rs.map(function (r) { return '<option value="' + esc(r.id) + '"' + (String(r.id) === String(def) ? ' selected' : '') + '>' + esc(r.reason) + '</option>'; }).join('') +
        '</select></label><span class="ssp-hint">The reason drives short-notice charging in Splose.</span></div>';
    }
    return '';
  }

  function discardChange(id) {
    confirmDialog('Drop this change from the Splose queue? The calendar keeps what you did; Splose simply will not hear about it.', { title: 'Discard change', ok: 'Discard', danger: true })
      .then(function (yes) {
        if (!yes) return;
        return fetchJson('/api/splose-sync/pending/' + encodeURIComponent(id), { method: 'DELETE' }).then(function (r) {
          if (!r.ok) { toast(r.json.error || 'Could not discard', true); return; }
          return refreshPending();
        });
      });
  }

  function collectOverrides(body, ids) {
    var overrides = {};
    ids.forEach(function (id) {
      var o = {};
      var s = body.querySelector('select[data-service="' + id + '"]'); if (s && s.value) o.serviceId = s.value;
      var k = body.querySelector('select[data-case="' + id + '"]');    if (k && k.value) o.caseId = k.value;
      var r = body.querySelector('select[data-reason="' + id + '"]');  if (r && r.value) o.reasonId = r.value;
      overrides[id] = o;
    });
    return overrides;
  }

  function publishSelected(opts) {
    opts = opts || {};
    var p = ensurePanel();
    var body = p.querySelector('.ssp-body');
    var ids = [];
    body.querySelectorAll('input[data-pick]:checked').forEach(function (i) { ids.push(i.getAttribute('data-pick')); });
    if (opts.all) ids = S.pending.map(function (c) { return c.id; });
    if (!ids.length) { toast('Nothing ticked'); return Promise.resolve(); }
    var overrides = collectOverrides(body, ids);
    // A new appointment cannot go without a service.
    var missing = ids.filter(function (id) {
      var c = S.pendingByEvent[(S.pending.find(function (x) { return x.id === id; }) || {}).eventId];
      return c && c.action === 'create' && !(overrides[id] && overrides[id].serviceId) && !defaultServiceId(c);
    });
    if (missing.length) { toast('Choose a service for every new appointment first', true); return Promise.resolve(); }
    // Fill defaults for creates we could infer.
    ids.forEach(function (id) {
      var c = S.pending.find(function (x) { return x.id === id; });
      if (c && c.action === 'create' && !overrides[id].serviceId) overrides[id].serviceId = defaultServiceId(c);
    });
    var cancels = ids.filter(function (id) { var c = S.pending.find(function (x) { return x.id === id; }); return c && c.action === 'cancel'; });
    var go = cancels.length
      ? confirmDialog(cancels.length + ' cancellation' + (cancels.length === 1 ? '' : 's') + ' will be sent to Splose. Cancelling there may trigger a short-notice charge and a client message. Continue?', { title: 'Confirm cancellations', ok: 'Send', danger: true })
      : Promise.resolve(true);
    return go.then(function (yes) {
      if (!yes) return;
      return fetchJson('/api/splose-sync/publish', { method: 'POST', body: { queueIds: ids, overrides: overrides } }).then(function (r) {
        if (!r.ok) { toast(r.json.error || 'Could not start the sync', true); return; }
        S.publishing = { total: ids.length, done: 0, failed: 0, current: null };
        renderButton(); if (S.panelOpen) renderPanel();
        return watchPublish();
      });
    });
  }

  function watchPublish() {
    return new Promise(function (resolve) {
      var tick = function () {
        refreshStatus().then(function (st) {
          if (st && st.running) { if (S.panelOpen) renderPanel(); renderButton(); setTimeout(tick, 1200); return; }
          S.publishing = null;
          refreshPending().then(function () {
            renderButton();
            if (S.panelOpen) renderPanel();
            if (S.lastRun) {
              var ok = S.lastRun.total - S.lastRun.failed;
              toast(ok + ' change' + (ok === 1 ? '' : 's') + ' written to Splose' + (S.lastRun.failed ? ' · ' + S.lastRun.failed + ' failed' : ''), S.lastRun.failed > 0);
            }
            if (typeof global.loadOutlookEventsToCalendar === 'function') { try { global.loadOutlookEventsToCalendar(); } catch (e) {} }
            resolve();
          });
        });
      };
      setTimeout(tick, 800);
    });
  }

  // ── Leaving with unsynced changes ─────────────────────────────────────────

  var leaving = false;
  function installTabGuard() {
    if (global.__sploseSyncTabGuard) return;
    global.__sploseSyncTabGuard = true;
    var orig = global.switchTab;
    if (typeof orig !== 'function') return;
    global.switchTab = function (name) {
      var args = arguments;
      var self = this;
      var n = S.pending.filter(function (c) { return c.status !== 'publishing'; }).length;
      if (!leaving && canUse() && isCalendarActive() && name !== 'calendar' && n > 0 && !S.publishing) {
        leaving = true;
        confirmDialog('You have ' + n + ' change' + (n === 1 ? '' : 's') + ' on the calendar that ' + (n === 1 ? 'has' : 'have') + ' not been written to Splose yet. Write ' + (n === 1 ? 'it' : 'them') + ' now?', { title: 'Sync Splose?', ok: 'Review and write', cancel: 'Later' })
          .then(function (yes) {
            leaving = false;
            if (yes) { openPanel(); return; }
            orig.apply(self, args);
          });
        return;
      }
      return orig.apply(self, args);
    };
    global.addEventListener('beforeunload', function (e) {
      var n = S.pending.filter(function (c) { return c.status !== 'publishing'; }).length;
      if (canUse() && n > 0) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  // ── Making a move real ────────────────────────────────────────────────────

  var DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  function perthYmdOf(iso) {
    var t = new Date(iso).getTime() + 8 * 3600000;
    var d = new Date(t);
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  function shiftYmd(ymd, days) {
    var d = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2] + days));
    return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function perthIso(ymd, h, m) {
    return ymd[0] + '-' + pad(ymd[1]) + '-' + pad(ymd[2]) + 'T' + pad(h) + ':' + pad(m) + ':00+08:00';
  }

  function installMovePersist() {
    if (global.__sploseSyncMovePersist) return;
    global.__sploseSyncMovePersist = true;
    var origCommit = global.commitMove;
    if (typeof origCommit !== 'function') return;
    global.commitMove = function () {
      var pm = global.pendingMove;
      var before = pm && global.SESSIONS ? global.SESSIONS[pm.id] : null;
      var snapshot = before ? { day: before.day, iso: before.startTimeIso, dbId: before.dbId, type: before.type, cancelled: before.cancelled } : null;
      var out = origCommit.apply(this, arguments);
      if (!snapshot || !snapshot.dbId || !pm) return out;
      try {
        var s = global.SESSIONS[pm.id];
        var origIdx = DAYS.indexOf(snapshot.day), newIdx = DAYS.indexOf(s.day);
        var baseYmd = snapshot.iso ? perthYmdOf(snapshot.iso) : null;
        if (!baseYmd || origIdx < 0 || newIdx < 0) return out;
        var ymd = shiftYmd(baseYmd, newIdx - origIdx);
        var startIso = perthIso(ymd, s.startH, s.startM || 0);
        var endIso = perthIso(ymd, s.endH, s.endM || 0);
        s.startTimeIso = new Date(startIso).toISOString();
        s.endTimeIso = new Date(endIso).toISOString();
        fetchJson('/api/outlook/events/' + encodeURIComponent(snapshot.dbId), { method: 'PATCH', body: { startTime: startIso, endTime: endIso } })
          .then(function (r) {
            if (!r.ok) {
              toast(r.json.error || 'The move could not be saved', true);
              if (typeof global.loadOutlookEventsToCalendar === 'function') global.loadOutlookEventsToCalendar();
              return;
            }
            toast(r.json.savedToOutlook ? 'Moved — Outlook updated. Sync Splose when the week is right.' : 'Moved — saved. Outlook will catch up; Sync Splose when the week is right.');
            refreshPending();
          });
      } catch (e) { /* the visual move already happened; nothing else to undo */ }
      return out;
    };
  }

  // ── Changes made inside Splose ────────────────────────────────────────────

  var KIND_TEXT = {
    cancelled: 'was cancelled in Splose',
    moved: 'was moved in Splose',
    deleted: 'was deleted in Splose',
    created: 'was booked directly in Splose',
  };

  function pollAlerts() {
    if (!canUse() || doc.hidden) return Promise.resolve();
    return fetchJson('/api/splose-sync/alerts').then(function (r) {
      if (!r.ok) return;
      var seen = {};
      S.alertQueue.forEach(function (a) { seen[a.id] = true; });
      (r.json.alerts || []).forEach(function (a) { if (!seen[a.id]) S.alertQueue.push(a); });
      showNextAlert();
    }).catch(function () {});
  }

  function ensureAlertBox() {
    var b = doc.getElementById('splose-alert-box');
    if (b) return b;
    b = doc.createElement('div');
    b.id = 'splose-alert-box';
    b.className = 'splose-alert';
    b.setAttribute('role', 'alertdialog');
    b.setAttribute('aria-labelledby', 'splose-alert-title');
    b.hidden = true;
    doc.body.appendChild(b);
    return b;
  }

  function showNextAlert() {
    if (S.alertShowing || !S.alertQueue.length) return;
    var a = S.alertQueue.shift();
    S.alertShowing = true;
    var b = ensureAlertBox();
    var d = a.details || {};
    var when = a.kind === 'moved'
      ? 'From ' + fmtPerth(d.from && d.from.start) + ' to <b>' + esc(fmtPerth(d.to && d.to.start)) + '</b>'
      : fmtPerth(d.start || (d.from && d.from.start));
    b.innerHTML =
      '<div class="sa-backdrop"></div><div class="sa-card">' +
      '<div class="sa-eyebrow">Change made in Splose</div>' +
      '<h2 id="splose-alert-title">' + esc(a.title || 'A client appointment') + ' ' + esc(KIND_TEXT[a.kind] || 'changed in Splose') + '</h2>' +
      '<div class="sa-when">' + when + (d.reason ? ' · reason: ' + esc(d.reason) : '') + '</div>' +
      '<p class="sa-rule">Bookings are made and changed in the portal, not in Splose. The portal only found this out by checking. Was this change meant to happen?</p>' +
      '<div class="sa-actions">' +
        '<button type="button" class="btn" data-verdict="invalid">No — it was a mistake</button>' +
        '<button type="button" class="btn primary" data-verdict="valid">Yes — apply it to the calendar</button>' +
      '</div>' +
      '<div class="sa-foot">Yes: the portal and Outlook are updated to match Splose. No: the portal keeps its own copy, the owner is told, and the correction is made in Splose.</div>' +
      '</div>';
    b.hidden = false;
    b.querySelectorAll('[data-verdict]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        fetchJson('/api/splose-sync/alerts/' + encodeURIComponent(a.id) + '/ack', { method: 'POST', body: { verdict: btn.getAttribute('data-verdict') } })
          .then(function (r) {
            if (!r.ok) toast(r.json.error || 'Could not record your answer', true);
            else if (r.json.verdict === 'valid') {
              toast('Calendar updated to match Splose');
              if (typeof global.loadOutlookEventsToCalendar === 'function') { try { global.loadOutlookEventsToCalendar(); } catch (e) {} }
            } else toast('Noted. Please correct it in Splose so the systems agree.');
            b.hidden = true;
            S.alertShowing = false;
            showNextAlert();
          });
      });
    });
    var first = b.querySelector('[data-verdict=valid]');
    if (first) first.focus();
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    var u = global.APP_USER;
    if (!u) { setTimeout(boot, 400); return; }
    if (u.role === 'read_only' || u.role === 'pre_employee') return;
    fetchJson('/api/splose/sync-status').then(function (r) {
      S.enabled = !!(r.ok && r.json.draftSyncEnabled === true);
      if (!S.enabled) return;
      installTabGuard();
      installMovePersist();
      ensureButton();
      refreshStatus().then(function (st) { if (st && st.running) watchPublish(); });
      refreshPending();
      pollAlerts();
      // Modest polling, paused while hidden: pending every 60 s, alerts every 2 min.
      S.pollTimer = setInterval(function () { if (!doc.hidden) refreshPending(); }, 60000);
      setInterval(function () { pollAlerts(); }, 120000);
      doc.addEventListener('visibilitychange', function () { if (!doc.hidden) { refreshPending(); pollAlerts(); } });
      // Re-decorate whenever the grid is repainted.
      var grid = doc.getElementById('cal-grid');
      if (grid && global.MutationObserver) {
        var pendingDecor = null;
        new MutationObserver(function () {
          if (pendingDecor) return;
          pendingDecor = setTimeout(function () { pendingDecor = null; decorateTiles(); }, 120);
        }).observe(grid, { childList: true, subtree: true });
      }
    });
  }

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', boot); else boot();

  global.SploseSync = {
    open: openPanel, close: closePanel, refresh: refreshPending, publishAll: function () { return openPanel(); },
    _state: S,
  };
})(window);
