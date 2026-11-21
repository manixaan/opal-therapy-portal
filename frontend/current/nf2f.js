/* ═══════════════════════════════════════════════════════════════════════════
   NON-FACE-TO-FACE BILLABLE TIME (11 Oct 2026)

   Case noting, case management, emails, phone calls and resource prep:
     • Smart Booking: pick several clients, or none. No clients = the block is
       not billable (NON_BILLABLE); with clients its timed work is billed.
     • The block on the calendar lists its clients and has a "Start billable
       time" button. While a timer runs, a chip on the calendar shows it and
       stops it from anywhere. A timer left running stops itself once it has
       run for the block's length (worked out by the server).
     • The block's detail panel: the timed time, each client's share and
       "Allocate billing" — equal by default; change one client's % or time
       and the rest is shared by the clients you have not set; a greyed-out
       Non-billable share (0%) can be switched on for unrelated work.
     • Invoicing bills each client's share at their MMM zone and the session
       rate (backend/billing/nf2f-timer.js, invoice-generation.js).

   Globals reached at call time: BOOKING_STATE, PATIENTS, SESSIONS,
   currentBookingLeaf, clearBookingClient, openBookingPanel, openBlockDetail,
   showToast, addSession.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  var NF = global.Nf2f = global.Nf2f || {};
  var PICK = { clients: [] };          // Smart Booking: the clients on this block
  var RUN = { list: [], fetchedAt: 0, tick: null, poll: null };

  function $(id) { return document.getElementById(id); }
  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function fn(name) { return typeof global[name] === 'function'; }
  function toast(a, b, kind) { if (fn('showToast')) global.showToast(a, b, kind); }
  async function api(url, opts) {
    var r = await fetch(url, Object.assign({ credentials: 'include' }, opts || {}));
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  function send(url, method, body) {
    return api(url, { method: method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
  }
  function mins(sec) { var m = Math.round(sec / 60); return m + ' min'; }
  // A client's share, to the second (m:ss) — whole minutes showed "0 min" for
  // short timings (12 Oct 2026).
  function share(sec) { return clock(Math.round(sec)); }
  function isNf2fLeaf() { var l = fn('currentBookingLeaf') ? global.currentBookingLeaf() : null; return !!(l && l.group === 'nf2f'); }
  function blockOf(s) { var b = s && s.booking; return b && b.group === 'nf2f' ? b : null; }
  function clientsOf(s) {
    var b = blockOf(s); if (!b) return [];
    if (Array.isArray(b.clients)) return b.clients.filter(function (c) { return c && c.clientId; });
    return b.clientId ? [{ clientId: String(b.clientId), clientName: b.clientName || null }] : [];
  }
  function namesOf(list, max) {
    var n = list.map(function (c) { return c.clientName || ('Client ' + c.clientId); });
    return n.length > max ? n.slice(0, max).join(', ') + ' +' + (n.length - max) : n.join(', ');
  }

  /* ───────────── Smart Booking: several clients, or none ───────────── */
  function patientById(id) {
    return (global.PATIENTS || []).find(function (p) { return String(p.id) === String(id); }) || null;
  }
  function pickName(p) { return ((p.first || '') + ' ' + (p.last || '')).trim() || p.name || ('Client ' + p.id); }
  function renderPicked() {
    var host = $('nf2f-picked');
    var section = $('cat-client-section');
    if (!isNf2fLeaf()) { if (host) host.hidden = true; return; }
    if (!host && section) {
      host = document.createElement('div');
      host.id = 'nf2f-picked'; host.className = 'nf2f-picked';
      section.insertBefore(host, section.firstChild);
    }
    if (!host) return;
    host.hidden = false;
    host.innerHTML = PICK.clients.length
      ? '<div class="nf2f-picked-head"><strong>' + PICK.clients.length + (PICK.clients.length === 1 ? ' client' : ' clients') +
          '</strong> · billable time is split between them</div><div class="nf2f-chips">' +
          PICK.clients.map(function (c) {
            return '<span class="nf2f-chip">' + esc(c.clientName) + ' <button type="button" data-nf2f-unpick="' + esc(c.clientId) + '" aria-label="Remove ' + esc(c.clientName) + '">×</button></span>';
          }).join('') + '</div>'
      : '<div class="nf2f-picked-head"><strong>No clients</strong> · this block is non-billable. Pick one or more clients to bill the time.</div>';
    // The list shows every picked client as selected.
    document.querySelectorAll('#patient-list .patient-card').forEach(function (card) {
      var on = PICK.clients.some(function (c) { return String(c.clientId) === String(card.dataset.patientId); });
      card.classList.toggle('selected', on);
      card.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  function syncSelectedPatient() {
    if (typeof BOOKING_STATE === 'undefined' || !BOOKING_STATE) return;
    var first = PICK.clients[0];
    BOOKING_STATE.selectedPatient = first ? patientById(first.clientId) : null;
  }
  // Capture phase: on a non-face-to-face booking a click adds or removes the
  // client instead of replacing the one selected.
  document.addEventListener('click', function (e) {
    var unpick = e.target.closest && e.target.closest('[data-nf2f-unpick]');
    if (unpick) {
      var id = unpick.getAttribute('data-nf2f-unpick');
      PICK.clients = PICK.clients.filter(function (c) { return String(c.clientId) !== id; });
      syncSelectedPatient(); renderPicked();
      return;
    }
    var card = e.target.closest && e.target.closest('#patient-list .patient-card');
    if (!card || !isNf2fLeaf()) return;
    e.stopPropagation(); e.preventDefault();
    var p = patientById(card.dataset.patientId);
    if (!p) return;
    var i = PICK.clients.findIndex(function (c) { return String(c.clientId) === String(p.id); });
    if (i >= 0) PICK.clients.splice(i, 1);
    else PICK.clients.push({ clientId: String(p.id), clientName: pickName(p) });
    syncSelectedPatient(); renderPicked();
  }, true);

  /** The clients picked for a non-face-to-face booking: [{clientId, clientName}]. */
  NF.selectedClients = function () { return PICK.clients.map(function (c) { return { clientId: c.clientId, clientName: c.clientName }; }); };

  /* ─────────────────────── Running timers ─────────────────────── */
  function runningFor(dbId) { return RUN.list.find(function (r) { return String(r.eventId) === String(dbId); }) || null; }
  function liveElapsed(r) {
    var base = r.timer.elapsedSeconds + Math.floor((Date.now() - RUN.fetchedAt) / 1000);
    return Math.min(r.timer.limitSeconds, base);
  }
  async function refreshRunning() {
    try {
      var j = await api('/api/nf2f/running');
      RUN.list = j.running || []; RUN.fetchedAt = Date.now();
    } catch (e) { /* signed out or offline — keep what we have */ }
    renderChip(); decorateAllTiles();
    if (global.__nf2fDetailRefresh) global.__nf2fDetailRefresh();
  }
  NF.refreshRunning = refreshRunning;

  function tick() {
    var reached = false;
    RUN.list.forEach(function (r) { if (liveElapsed(r) >= r.timer.limitSeconds) reached = true; });
    if (reached) { refreshRunning(); return; }   // the server stops it at the block's length
    var chip = $('nf2f-run-chip');
    if (chip && RUN.list[0]) { var t = chip.querySelector('.nf2f-run-time'); if (t) t.textContent = clock(liveElapsed(RUN.list[0])); }
  }

  function renderChip() {
    var chip = $('nf2f-run-chip');
    var r = RUN.list[0];
    if (!r) { if (chip) chip.remove(); return; }
    if (!chip) {
      chip = document.createElement('div');
      chip.id = 'nf2f-run-chip'; chip.className = 'nf2f-run-chip'; chip.setAttribute('role', 'status');
      document.body.appendChild(chip);
    }
    chip.innerHTML = '<span class="nf2f-run-dot" aria-hidden="true"></span>' +
      '<button type="button" class="nf2f-run-open" data-nf2f-open="' + esc(r.eventId) + '" title="Open the block">' +
        '<span class="nf2f-run-title">' + esc(r.title || 'Billable time') + '</span>' +
        '<span class="nf2f-run-sub">' + esc(namesOf(r.clients, 2)) + '</span></button>' +
      '<span class="nf2f-run-time" aria-label="Time so far">' + clock(liveElapsed(r)) + '</span>' +
      '<button type="button" class="nf2f-run-stop" data-nf2f-stop="' + esc(r.eventId) + '">Stop</button>';
  }

  async function start(dbId) {
    try { await send('/api/events/' + encodeURIComponent(dbId) + '/nf2f/start', 'POST'); toast('Billable time started', 'Stop it from the block or the timer on the calendar.'); }
    catch (e) { toast('Could not start the timer', e.message, 'warn'); }
    await refreshRunning();
  }
  async function stop(dbId) {
    try {
      var v = await send('/api/events/' + encodeURIComponent(dbId) + '/nf2f/stop', 'POST');
      toast('Billable time stopped', clock(v.timer.elapsedSeconds) + ' timed · split across ' + v.clients.length + (v.clients.length === 1 ? ' client' : ' clients'));
    } catch (e) { toast('Could not stop the timer', e.message, 'warn'); }
    await refreshRunning();
  }
  NF.start = start; NF.stop = stop;

  function sessionByDbId(dbId) {
    return Object.values(global.SESSIONS || {}).find(function (s) { return s && String(s.dbId) === String(dbId); }) || null;
  }

  // Buttons on tiles, the chip and the panel. Pointer events stop here so a
  // click on the timer never starts a drag or opens the block.
  ['pointerdown', 'mousedown'].forEach(function (t) {
    document.addEventListener(t, function (e) {
      if (e.target.closest && e.target.closest('.nf2f-btn, .nf2f-run-chip')) e.stopPropagation();
    }, true);
  });
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-nf2f-start],[data-nf2f-stop],[data-nf2f-open],[data-nf2f-alloc]');
    if (!b) return;
    e.stopPropagation(); e.preventDefault();
    if (fn('closeCalContextMenu')) global.closeCalContextMenu();
    if (b.hasAttribute('data-nf2f-start')) start(b.getAttribute('data-nf2f-start'));
    else if (b.hasAttribute('data-nf2f-stop')) stop(b.getAttribute('data-nf2f-stop'));
    else if (b.hasAttribute('data-nf2f-alloc')) openAllocate(b.getAttribute('data-nf2f-alloc'));
    else {
      var s = sessionByDbId(b.getAttribute('data-nf2f-open'));
      if (s && fn('openBlockDetail')) global.openBlockDetail(s.id);
      else toast('That block is in another week', 'Go to its week to open it.');
    }
  }, true);

  /* ─────────────────────── The block on the calendar ─────────────────────── */
  function decorateTile(s) {
    if (!s || !s.element || !blockOf(s)) return;
    var el = s.element;
    var bar = el.querySelector('.nf2f-bar');
    var clients = clientsOf(s);
    if (!clients.length) {
      // No clients: nothing to show on the tile. The "Non-billable" pill was
      // removed on request (19 Nov 2026) — the drawer still says so.
      if (bar) bar.remove();
      el.classList.add('nf2f-nonbillable');
      return;
    }
    if (!bar) { bar = document.createElement('div'); bar.className = 'nf2f-bar'; el.appendChild(bar); }
    el.classList.remove('nf2f-nonbillable');
    var r = s.dbId ? runningFor(s.dbId) : null;
    // Start / Stop live in the right-click menu and the calendar chip
    // (12 Oct 2026). The block lists its clients; while its timer runs it
    // carries a small blinking red dot in the corner — a number got cut off
    // on short blocks.
    bar.innerHTML = '<span class="nf2f-clients" title="' + esc(namesOf(clients, 99)) + '">' + esc(namesOf(clients, 3)) + '</span>';
    var dot = el.querySelector('.nf2f-live-dot');
    if (r && !dot) {
      dot = document.createElement('span');
      dot.className = 'nf2f-live-dot';
      dot.setAttribute('role', 'img');
      dot.setAttribute('aria-label', 'Billable time is recording for this block');
      dot.title = 'Billable time is recording — right-click the block or use the timer chip to stop it';
      el.appendChild(dot);
    } else if (!r && dot) dot.remove();
  }
  function decorateAllTiles() {
    Object.values(global.SESSIONS || {}).forEach(function (s) { try { decorateTile(s); } catch (e) { /* tile gone */ } });
  }
  NF.decorateAllTiles = decorateAllTiles;

  /** Right-click menu items for a block (mockup_v3.html showCalContextMenu): Start / Stop, Allocate billing. */
  NF.menuItems = function (s) {
    if (!s || !s.dbId || !blockOf(s) || !clientsOf(s).length) return '';
    var r = runningFor(s.dbId);
    var id = esc(s.dbId);
    return (r
      ? '<div class="cal-ctx-menu-item" data-nf2f-stop="' + id + '"><span class="ctx-icon">■</span> Stop billable time (' + clock(liveElapsed(r)) + ')</div>'
      : '<div class="cal-ctx-menu-item" data-nf2f-start="' + id + '"><span class="ctx-icon">▶</span> Start billable time</div>') +
      '<div class="cal-ctx-menu-item" data-nf2f-alloc="' + id + '"><span class="ctx-icon">%</span> Allocate billing…</div>';
  };

  /* ─────────────────────── The block's detail panel ─────────────────────── */
  global.nf2fDecorateDetail = function (s) {
    var host = $('bd-body');
    var old = $('nf2f-detail'); if (old) old.remove();
    global.__nf2fDetailRefresh = null;
    if (!host || !s || !blockOf(s)) return;
    var box = document.createElement('div');
    box.className = 'nf2f-detail'; box.id = 'nf2f-detail';
    host.appendChild(box);
    var clients = clientsOf(s);
    if (!clients.length) {
      box.innerHTML = '<b>Billable time</b> <span class="nf2f-dim">Non-billable — no clients on this block. Add clients when booking to bill the time.</span>';
      return;
    }
    if (!s.dbId) { box.innerHTML = '<b>Billable time</b> <span class="nf2f-dim">Saving…</span>'; return; }
    var load = function () {
      api('/api/events/' + encodeURIComponent(s.dbId) + '/nf2f').then(function (v) {
        var st = v.timer.status, nb = v.allocation.nonBillablePercent;
        box.innerHTML = '<b>Billable time</b> ' +
          '<div class="nf2f-detail-row"><span class="nf2f-big">' + clock(v.timer.elapsedSeconds) + '</span>' +
            '<span class="nf2f-dim">of ' + mins(v.timer.limitSeconds) + (st === 'RUNNING' ? ' · running' : v.timer.autoStopped ? ' · stopped at the block\'s length' : st === 'STOPPED' ? ' · stopped' : ' · not started') + '</span>' +
            (st === 'RUNNING'
              ? '<button type="button" class="pd-btn pd-btn-danger nf2f-act" data-nf2f-stop="' + esc(s.dbId) + '">Stop</button>'
              : '<button type="button" class="pd-btn pd-btn-primary nf2f-act" data-nf2f-start="' + esc(s.dbId) + '">' + (v.timer.elapsedSeconds ? 'Resume' : 'Start billable time') + '</button>') +
          '</div>' +
          '<table class="nf2f-split"><tbody>' + v.split.map(function (p) {
            return '<tr><td>' + esc(p.clientName || ('Client ' + p.clientId)) + '</td><td>' + p.percent + '%</td><td>' + share(p.seconds) + '</td></tr>';
          }).join('') + (nb ? '<tr class="nf2f-nb"><td>Non-billable</td><td>' + nb + '%</td><td>' + share(v.timer.elapsedSeconds * nb / 100) + '</td></tr>' : '') + '</tbody></table>' +
          '<button type="button" class="pd-btn nf2f-act" data-nf2f-alloc="' + esc(s.dbId) + '">Allocate billing</button>';
      }).catch(function (e) { box.innerHTML = '<b>Billable time</b> <span class="nf2f-dim">' + esc(e.message) + '</span>'; });
    };
    global.__nf2fDetailRefresh = load;
    load();
  };

  /* ─────────────────────── Allocate billing ───────────────────────
     Equal by default. A client you change is "set"; whatever is left after
     the set clients and the non-billable share is divided equally between
     the clients you have not set — e.g. 5 clients at 20%: set one to 40% and
     the other four share 60% (15% each). */
  function round2(n) { return Math.round(n * 100) / 100; }
  function redistribute(rows, nb) {
    var set = rows.filter(function (r) { return r.locked; });
    var free = rows.filter(function (r) { return !r.locked; });
    var left = round2(100 - nb - set.reduce(function (a, r) { return a + r.percent; }, 0));
    if (free.length) {
      var each = Math.floor((Math.max(0, left) / free.length) * 100) / 100;
      free.forEach(function (r) { r.percent = each; });
      free[0].percent = round2(Math.max(0, left) - each * (free.length - 1));
    }
    return round2(rows.reduce(function (a, r) { return a + r.percent; }, 0) + nb);
  }
  NF._redistribute = redistribute;

  /* Typing never redraws the box being typed in (12 Oct 2026: a redraw on
     every keystroke kept only one digit). Each change updates the other
     shares, the times and the total in place. Any number can be typed; a
     share over 100%, or a total that is not 100%, is a warning and Save
     waits until it is fixed. */
  function parsePct(text) {
    var t = String(text == null ? '' : text).replace(',', '.').replace(/[^0-9.]/g, '');
    var n = parseFloat(t);
    return Number.isFinite(n) ? round2(n) : 0;
  }
  /* A typed time → seconds: "12" is 12 minutes, "12:30" is m:ss, "1:05:00"
     is h:mm:ss (the same form the Time column shows). */
  function parseTime(text) {
    var parts = String(text == null ? '' : text).trim().replace(',', '.').split(':')
      .map(function (p) { var n = parseFloat(p.replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : 0; });
    if (parts.length === 1) return parts[0] * 60;
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  NF._parseTime = parseTime;
  async function openAllocate(dbId) {
    var v;
    try { v = await api('/api/events/' + encodeURIComponent(dbId) + '/nf2f'); }
    catch (e) { toast('Could not open the allocation', e.message, 'warn'); return; }
    var rows = v.allocation.clients.map(function (c) { return { clientId: c.clientId, clientName: c.clientName, percent: Number(c.percent), locked: false }; });
    var nb = Number(v.allocation.nonBillablePercent) || 0;
    var nbOn = nb > 0;
    var timed = v.timer.elapsedSeconds;
    // Times are shares of the timed total; before the timer has run they are
    // shares of the block's length, so a split can be set up in advance.
    var base = timed > 0 ? timed : (Number(v.timer.limitSeconds) || 0);
    var timeBox = function (attr, label, disabled) {
      return '<input type="text" inputmode="numeric" autocomplete="off" class="pd-input nf2f-min" ' + attr +
        ' aria-label="' + esc(label) + '" title="Minutes, or m:ss"' + (disabled ? ' disabled' : '') + '>';
    };
    var el = document.createElement('div');
    el.className = 'pd-backdrop nf2f-backdrop';
    el.innerHTML = '<section class="pd-dialog nf2f-alloc" role="dialog" aria-modal="true" aria-labelledby="nf2f-alloc-title">' +
      '<div class="pd-head"><h2 class="pd-title" id="nf2f-alloc-title">Allocate billing</h2></div>' +
      '<div class="pd-body"><p class="nf2f-dim">' + esc(v.title || 'This block') + ' · ' + (timed > 0 ? clock(timed) + ' timed' : 'not timed yet — times are of the ' + mins(base) + ' block') +
        '. Change a client’s share or time and the rest is divided between the clients you have not changed.</p>' +
      '<table class="nf2f-alloc-table"><thead><tr><th>Client</th><th>Share</th><th>Time</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr data-tr="' + i + '"><td>' + esc(r.clientName || ('Client ' + r.clientId)) + '</td>' +
          '<td><input type="text" inputmode="decimal" autocomplete="off" class="pd-input nf2f-pct" data-row="' + i + '" value="' + r.percent + '" aria-label="Share for ' + esc(r.clientName || r.clientId) + '"> %</td>' +
          '<td class="nf2f-time">' + timeBox('data-time-row="' + i + '"', 'Time for ' + (r.clientName || r.clientId), !base) + '</td></tr>';
      }).join('') +
      '<tr class="nf2f-nb" data-tr="nb"><td><label><input type="checkbox" data-nb-on' + (nbOn ? ' checked' : '') + '> Non-billable</label></td>' +
        '<td><input type="text" inputmode="decimal" autocomplete="off" class="pd-input nf2f-pct" data-nb value="' + nb + '"' + (nbOn ? '' : ' disabled') + ' aria-label="Non-billable share"> %</td>' +
        '<td class="nf2f-time">' + timeBox('data-time-nb', 'Non-billable time', !nbOn || !base) + '</td></tr>' +
      '</tbody></table>' +
      '<div class="nf2f-total" aria-live="polite"></div></div>' +
      '<div class="pd-foot"><button type="button" class="pd-btn" data-act="equal">Equal split</button>' +
        '<button type="button" class="pd-btn" data-act="cancel">Cancel</button>' +
        '<button type="button" class="pd-btn pd-btn-primary" data-act="save">Save</button></div></section>';
    document.body.appendChild(el);

    // Refresh everything except the box being typed in.
    var paint = function (typing) {
      rows.forEach(function (r, i) {
        var inp = el.querySelector('[data-row="' + i + '"]');
        if (inp && inp !== typing) inp.value = r.percent;
        var tr = el.querySelector('[data-tr="' + i + '"]');
        tr.classList.toggle('set', r.locked);
        tr.classList.toggle('over', r.percent > 100);
        var tIn = el.querySelector('[data-time-row="' + i + '"]');
        if (tIn !== typing) tIn.value = share(base * Math.min(100, r.percent) / 100);
      });
      var nbRow = el.querySelector('[data-tr="nb"]'), nbInp = el.querySelector('[data-nb]');
      nbRow.classList.toggle('on', nbOn);
      nbRow.classList.toggle('over', nb > 100);
      nbInp.disabled = !nbOn;
      if (nbInp !== typing) nbInp.value = nb;
      var nbTime = el.querySelector('[data-time-nb]');
      nbTime.disabled = !nbOn || !base;
      if (nbTime !== typing) nbTime.value = share(base * Math.min(100, nb) / 100);
      var total = round2(rows.reduce(function (a, r) { return a + r.percent; }, 0) + nb);
      var over = rows.some(function (r) { return r.percent > 100; }) || nb > 100;
      var ok = !over && Math.abs(total - 100) <= 0.05;
      var t = el.querySelector('.nf2f-total');
      t.classList.toggle('bad', !ok);
      t.textContent = 'Total ' + total + '%' + (over ? ' — a share cannot be over 100%' : total > 100.05 ? ' — over 100%, lower a share' : total < 99.95 ? ' — must add up to 100%' : '');
      el.querySelector('[data-act="save"]').disabled = !ok;
    };
    var update = function (typing) { redistribute(rows, nb); paint(typing); };

    el.addEventListener('input', function (e) {
      var t = e.target;
      // A typed time becomes that client's share of the total: 15:00 of a
      // 60-minute block is 25%, and the rest re-divides exactly as for a %.
      var pctOfTime = function () { return base ? round2(parseTime(t.value) / base * 100) : 0; };
      if (t.hasAttribute('data-nb')) nb = parsePct(t.value);
      else if (t.hasAttribute('data-time-nb')) nb = pctOfTime();
      else if (t.hasAttribute('data-row') || t.hasAttribute('data-time-row')) {
        var r = rows[Number(t.getAttribute('data-row') || t.getAttribute('data-time-row'))];
        r.percent = t.hasAttribute('data-row') ? parsePct(t.value) : pctOfTime();
        r.locked = true;
      } else return;
      update(t);
    });
    // Leaving a box tidies what was typed (e.g. "40." → 40).
    el.addEventListener('focusout', function (e) {
      if (e.target.classList && (e.target.classList.contains('nf2f-pct') || e.target.classList.contains('nf2f-min'))) paint(null);
    });
    el.addEventListener('change', function (e) {
      if (!e.target.hasAttribute('data-nb-on')) return;
      nbOn = e.target.checked;
      if (!nbOn) nb = 0;
      update(null);
      if (nbOn) { var inp = el.querySelector('[data-nb]'); inp.focus(); inp.select(); }
    });
    var close = function () { el.remove(); document.removeEventListener('keydown', onKey, true); };
    var onKey = function (e) { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    el.addEventListener('click', async function (e) {
      var b = e.target.closest && e.target.closest('[data-act]'); if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'cancel') close();
      else if (act === 'equal') { rows.forEach(function (r) { r.locked = false; }); update(null); }
      else if (act === 'save') {
        b.disabled = true;
        try {
          await send('/api/events/' + encodeURIComponent(dbId) + '/nf2f/allocation', 'PUT', {
            allocation: rows.map(function (r) { return { clientId: r.clientId, percent: r.percent }; }), nonBillablePercent: nb });
          close();
          toast('Billing allocation saved', 'Drafts holding this block are recalculated on the next invoicing run.');
          if (global.__nf2fDetailRefresh) global.__nf2fDetailRefresh();
        } catch (err) { b.disabled = false; toast('Could not save the allocation', err.message, 'warn'); }
      }
    });
    paint(null);
    var first = el.querySelector('[data-row="0"]'); if (first) { first.focus(); first.select(); }
  }
  NF.openAllocate = openAllocate;

  /* ─────────────── Blocks that ended with no time entered ───────────────
     A billable non-face-to-face block that finished without its timer run
     must be answered before carrying on: claim the whole block (split evenly
     across its clients), enter each client's minutes, or say the work did not
     happen (not billed; the owner is notified). There is no close button,
     Escape and the backdrop do nothing — the only way out is an answer.
     Until answered, Invoicing holds those clients' drafts (NF2F_UNTIMED). */
  var UNTIMED = { open: false, checking: false };
  async function checkUntimed() {
    if (UNTIMED.open || UNTIMED.checking || document.hidden) return;
    UNTIMED.checking = true;
    try {
      var r = await api('/api/nf2f/untimed');
      if (r.blocks && r.blocks.length) showUntimed(r.blocks[0], r.blocks.length);
    } catch (e) { /* signed out or offline: ask again later */ }
    finally { UNTIMED.checking = false; }
  }
  function whenText(b) {
    var st = new Date(b.start), en = new Date(b.end);
    var day = st.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
    var t = function (d) { return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }); };
    return day + ', ' + t(st) + '–' + t(en);
  }
  function showUntimed(b, count) {
    UNTIMED.open = true;
    var many = b.clients.length > 1;
    var bd = document.createElement('div');
    bd.id = 'nf2f-untimed';
    bd.className = 'nf2f-untimed-backdrop';
    bd.innerHTML =
      '<div class="nf2f-untimed" role="alertdialog" aria-modal="true" aria-labelledby="nf2f-untimed-h" aria-describedby="nf2f-untimed-d">' +
        '<h2 id="nf2f-untimed-h">No time was entered for billable work</h2>' +
        '<p id="nf2f-untimed-d"><b>' + esc(b.title || 'Non-face-to-face') + '</b><br>' + esc(whenText(b)) + ' · ' + b.blockMinutes + ' min block<br>' +
          'Client' + (many ? 's' : '') + ': ' + esc(namesOf(b.clients, 6)) + '</p>' +
        (count > 1 ? '<p class="nf2f-untimed-count">' + count + ' blocks need an answer. This is the earliest.</p>' : '') +
        '<fieldset class="nf2f-untimed-opts"><legend>How should this be billed?</legend>' +
          '<label><input type="radio" name="nf2f-u" value="FULL_BLOCK" checked> Claim the full ' + b.blockMinutes + ' minutes' +
            (many ? ', split evenly across ' + b.clients.length + ' clients' : '') + '</label>' +
          '<label><input type="radio" name="nf2f-u" value="PER_CLIENT"> Enter the minutes for ' + (many ? 'each client' : 'this client') + '</label>' +
          '<div class="nf2f-untimed-mins" hidden>' + b.clients.map(function (c) {
            return '<label>' + esc(c.clientName || ('Client ' + c.clientId)) + ' <input type="number" min="0" max="' + b.blockMinutes + '" step="1" inputmode="numeric" data-client="' + esc(c.clientId) + '" value=""> min</label>';
          }).join('') + '</div>' +
          '<label><input type="radio" name="nf2f-u" value="DID_NOT_HAPPEN"> This work did not happen — do not bill</label>' +
          '<div class="nf2f-untimed-why" hidden><label>Why not? (sent to the owner)<textarea maxlength="500" rows="2"></textarea></label></div>' +
        '</fieldset>' +
        '<div class="nf2f-untimed-err" role="alert"></div>' +
        '<div class="nf2f-untimed-foot"><button type="button" class="btn primary" data-u="save">Save</button></div>' +
      '</div>';
    document.body.appendChild(bd);
    var dlg = bd.querySelector('.nf2f-untimed');
    var err = bd.querySelector('.nf2f-untimed-err');
    var sync = function () {
      var m = (bd.querySelector('input[name="nf2f-u"]:checked') || {}).value;
      bd.querySelector('.nf2f-untimed-mins').hidden = m !== 'PER_CLIENT';
      bd.querySelector('.nf2f-untimed-why').hidden = m !== 'DID_NOT_HAPPEN';
      bd.querySelector('[data-u="save"]').textContent = m === 'DID_NOT_HAPPEN' ? 'Do not bill' : 'Save and bill';
      err.textContent = '';
    };
    bd.addEventListener('change', sync);
    bd.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      if (e.key === 'Tab') {
        var f = Array.prototype.filter.call(dlg.querySelectorAll('input, textarea, button'), function (x) { return x.offsetParent !== null; });
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }, true);
    bd.querySelector('[data-u="save"]').addEventListener('click', async function () {
      var btn = this;
      var mode = (bd.querySelector('input[name="nf2f-u"]:checked') || {}).value;
      var body = { mode: mode };
      if (mode === 'PER_CLIENT') {
        body.minutes = Array.prototype.map.call(bd.querySelectorAll('.nf2f-untimed-mins input'), function (i) {
          return { clientId: i.dataset.client, minutes: i.value === '' ? 0 : Number(i.value) };
        });
      }
      if (mode === 'DID_NOT_HAPPEN') body.reason = bd.querySelector('.nf2f-untimed-why textarea').value;
      btn.disabled = true;
      try {
        await send('/api/events/' + encodeURIComponent(b.eventId) + '/nf2f/resolve', 'POST', body);
        bd.remove();
        UNTIMED.open = false;
        toast(mode === 'DID_NOT_HAPPEN' ? 'Marked as not done' : 'Time entered',
          mode === 'DID_NOT_HAPPEN' ? 'It will not be billed. The owner has been told.' : 'It will be on the next invoice run.');
        setTimeout(checkUntimed, 300);
      } catch (e) {
        err.textContent = e.message || 'Could not save. Try again.';
        btn.disabled = false;
      }
    });
    sync();
    setTimeout(function () { var first = dlg.querySelector('input[name="nf2f-u"]'); if (first) first.focus(); }, 0);
  }
  NF.checkUntimed = checkUntimed;

  /* ───────────────────────────── Wiring ───────────────────────────── */
  function wrapGlobal(name, after) {
    var orig = global[name];
    if (typeof orig !== 'function' || orig['__nf2f_' + name]) return;
    var w = function () { var out = orig.apply(this, arguments); try { after.apply(this, arguments); } catch (e) { /* enhancement only */ } return out; };
    w['__nf2f_' + name] = true;
    global[name] = w;
  }
  function wire() {
    // A week loads tile by tile: decorate once after the burst.
    var pending = false;
    wrapGlobal('addSession', function () {
      if (pending) return;
      pending = true;
      setTimeout(function () { pending = false; decorateAllTiles(); }, 0);
    });
    wrapGlobal('openBookingPanel', function (o) { if (!(o && o.keepState)) PICK.clients = []; setTimeout(renderPicked, 50); });
    wrapGlobal('selectBookingLeaf', function () {
      // Moving to a non-face-to-face type keeps a client already chosen.
      if (isNf2fLeaf() && !PICK.clients.length && typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE && BOOKING_STATE.selectedPatient) {
        var p = BOOKING_STATE.selectedPatient;
        if (p && p.id != null) PICK.clients = [{ clientId: String(p.id), clientName: pickName(p) }];
      }
      renderPicked();
    });
    wrapGlobal('clearBookingClient', function () { PICK.clients = []; renderPicked(); });
    wrapGlobal('renderPatients', function () { renderPicked(); });
    refreshRunning();
    RUN.tick = setInterval(tick, 1000);
    RUN.poll = setInterval(refreshRunning, 60000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { refreshRunning(); checkUntimed(); } });
    setTimeout(checkUntimed, 4000);
    setInterval(checkUntimed, 10 * 60000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})(window);
