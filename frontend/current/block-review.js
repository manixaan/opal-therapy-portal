'use strict';

/**
 * BLOCK REVIEW — Calendar → "Blocks to review" (migration 086).
 *
 * Blocks booked straight into Outlook or Splose arrive without a booking type,
 * client or place. The server guesses each one (backend/block-review.js); this
 * panel shows the guesses as a table and lets the clinician fill what is
 * missing or correct what was guessed:
 *
 *   Guessed — check   the guess is already on the calendar but is held out of
 *                     invoicing until confirmed
 *   Needs info        nothing was changed; choose what is missing
 *
 * Billable and Travel are worked out here from the row's choices, the same way
 * the rest of the portal reads them (a client service with a client is
 * billable; a face-to-face service at a place needs travel).
 *
 * Globals on window (no modules): window.BlockReview. Reuses the shell's
 * escapeHtml / showToast / BOOKING_LEAVES / loadOutlookEventsToCalendar.
 */
(function () {
  var POLL_MS = 5 * 60 * 1000;
  var LOOKBACK_DAYS = 30;

  // Fallback labels when the shell's BOOKING_LEAVES is not there.
  var GROUPS = [
    { key: 'direct', label: 'Direct services', kinds: ['assessment', 'assessment-ei', 'initial', 'initial-ei', 'mdt', 'mdu', 'telehealth', 'telehealth-ei', 'therapy', 'therapy-ei'] },
    { key: 'report', label: 'Requested reports', kinds: ['fca', 'at-report', 'progress-report', 'support-letter'] },
    { key: 'nf2f', label: 'Non-face-to-face', kinds: ['case-noting', 'case-management', 'resource-prep', 'emails', 'phone-calls'] },
    { key: 'other', label: 'Not billable', kinds: ['pd', 'supervision', 'lunch', 'custom'] },
  ];
  var GROUP_OF = {};
  GROUPS.forEach(function (g) { g.kinds.forEach(function (k) { GROUP_OF[k] = g.key; }); });
  var NO_PLACE = { mdt: 1, mdu: 1, telehealth: 1, 'telehealth-ei': 1 };
  var FIELD_LABEL = { kind: 'what it is', client: 'client', location: 'location' };

  var state = { blocks: [], clients: null, since: null, open: false, busy: {}, edits: {} };

  var esc = function (s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (msg, isError) { if (window.showToast) window.showToast(msg, !!isError); };
  var api = function (url, opts) {
    var o = Object.assign({ credentials: 'include' }, opts || {});
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    }).catch(function () { return { ok: false, status: 0, data: { error: 'Could not reach the server' } }; });
  };

  function kindLabel(k) {
    var leaves = window.BOOKING_LEAVES;
    if (leaves && leaves[k] && leaves[k].label) return leaves[k].label;
    return String(k || '').replace(/-/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });
  }
  function ymd(d) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); }
  function defaultSince() { return ymd(new Date(Date.now() - LOOKBACK_DAYS * 86400000)); }
  function when(b) {
    var s = new Date(b.start), e = new Date(b.end);
    var day = s.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
    var t = function (d) { return d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Perth' }); };
    return day + ' · ' + t(s) + '–' + t(e);
  }

  /** The row's current choice: the person's edit, else the server's guess. */
  function choice(b) {
    var e = state.edits[b.eventId] || {};
    var g = b.guess || {};
    return {
      kind: e.kind !== undefined ? e.kind : (g.kind || ''),
      clientId: e.clientId !== undefined ? e.clientId : (g.clientId || ''),
      location: e.location !== undefined ? e.location : (g.location || b.location || ''),
    };
  }
  /** PURE-ish — what the choice means for billing and travel. */
  function outcome(b, c) {
    var group = GROUP_OF[c.kind] || null;
    var virtual = !!(b.guess && b.guess.virtual) || /^telehealth/.test(c.kind);
    var needsClient = group === 'direct' || group === 'report';
    var needsPlace = group === 'direct' && !NO_PLACE[c.kind] && !virtual;
    var missing = [];
    if (!group) missing.push('kind');
    if (needsClient && !c.clientId) missing.push('client');
    if (needsPlace && !String(c.location || '').trim()) missing.push('location');
    // nf2f time bills only through its timer (billing/nf2f-timer.js).
    var billable = !group ? null : (group === 'other' ? false : (group === 'nf2f' ? (c.clientId ? 'timer' : false) : !!c.clientId));
    var travel = !group ? null : (group === 'direct' && !NO_PLACE[c.kind] && !virtual && !!String(c.location || '').trim());
    return { group: group, missing: missing, billable: billable, travel: travel, needsClient: needsClient || group === 'nf2f', needsPlace: needsPlace };
  }

  // ── Toolbar button ────────────────────────────────────────────────────────
  function button() {
    var btn = document.getElementById('cal-block-review-btn');
    if (btn) return btn;
    var add = document.querySelector('#view-calendar .btn-add-event');
    if (!add || !add.parentNode) return null;
    btn = document.createElement('button');
    btn.id = 'cal-block-review-btn';
    btn.type = 'button';
    btn.className = 'br-toolbar-btn';
    btn.hidden = true;
    btn.title = 'Blocks added in Outlook or Splose that the portal could not fully place';
    btn.addEventListener('click', openPanel);
    add.parentNode.insertBefore(btn, add);
    return btn;
  }
  function paintButton() {
    var btn = button();
    if (!btn) return;
    var n = state.blocks.length;
    var needs = state.blocks.filter(function (b) { return b.status === 'needs_input'; }).length;
    btn.hidden = n === 0;
    btn.classList.toggle('has-needs', needs > 0);
    btn.innerHTML = '<span class="br-dot" aria-hidden="true"></span>' + n + (n === 1 ? ' block' : ' blocks') + ' to review';
    btn.setAttribute('aria-label', n + ' blocks added outside the portal to review' + (needs ? ', ' + needs + ' need information' : ''));
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  function refresh() {
    var since = state.since || defaultSince();
    return api('/api/block-review?since=' + encodeURIComponent(since)).then(function (r) {
      if (!r.ok) { if (r.status !== 401 && r.status !== 403 && state.open) toast(r.data.error || 'Blocks could not be checked', true); return; }
      state.blocks = r.data.blocks || [];
      state.clientsAvailable = r.data.clientsAvailable !== false;
      state.since = r.data.since || since;
      // Forget edits for blocks that are gone.
      var live = {};
      state.blocks.forEach(function (b) { live[b.eventId] = 1; });
      Object.keys(state.edits).forEach(function (id) { if (!live[id]) delete state.edits[id]; });
      paintButton();
      if (state.open) render();
    });
  }
  function loadClients() {
    if (state.clients) return Promise.resolve(state.clients);
    return api('/api/splose/my-patients').then(function (r) {
      var list = (r.ok && r.data && r.data.data) || [];
      state.clients = list.map(function (p) {
        return { id: String(p.id), fullName: (p.fullName || ((p.firstname || '') + ' ' + (p.lastname || ''))).trim() || ('Client ' + p.id), address: p.formattedAddress || '' };
      }).sort(function (a, b) { return a.fullName.localeCompare(b.fullName, 'en-AU'); });
      return state.clients;
    });
  }
  function clientName(id, b) {
    if (!id) return '';
    var c = (state.clients || []).find(function (x) { return x.id === String(id); });
    if (c) return c.fullName;
    if (b && b.guess && String(b.guess.clientId) === String(id)) return b.guess.clientName || ('Client ' + id);
    return 'Client ' + id;
  }

  // ── Panel ─────────────────────────────────────────────────────────────────
  function shell() {
    var el = document.getElementById('br-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'br-overlay';
    el.className = 'br-overlay';
    el.hidden = true;
    el.innerHTML =
      '<div class="br-panel" role="dialog" aria-modal="true" aria-labelledby="br-title">' +
        '<header class="br-head">' +
          '<div><h2 id="br-title">Blocks added outside the portal</h2>' +
          '<p class="br-sub">Booked straight into Outlook or Splose. The portal has worked out what it can — check the guesses, fill the gaps, and they bill and route like any other booking. Nothing is changed in Outlook or Splose.</p></div>' +
          '<button type="button" class="br-x" data-br="close" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="br-bar">' +
          '<label class="br-since">Look back from <input type="date" id="br-since"></label>' +
          '<span class="br-counts" id="br-counts"></span>' +
          '<span class="br-spacer"></span>' +
          '<button type="button" class="br-btn" data-br="confirm-all" id="br-confirm-all">Confirm all guesses</button>' +
        '</div>' +
        '<div class="br-body" id="br-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });
    return el;
  }

  function openPanel() {
    var el = shell();
    state.open = true;
    el.hidden = false;
    document.getElementById('br-since').value = state.since || defaultSince();
    render();
    loadClients().then(render);
    refresh();
    var x = el.querySelector('.br-x');
    if (x) x.focus();
  }
  function closePanel() {
    var el = document.getElementById('br-overlay');
    if (el) el.hidden = true;
    state.open = false;
    var btn = document.getElementById('cal-block-review-btn');
    if (btn && !btn.hidden) btn.focus();
  }

  function kindSelect(b, c) {
    var html = '<select data-br-field="kind" data-id="' + esc(b.eventId) + '" aria-label="What this block is"><option value="">Choose…</option>';
    GROUPS.forEach(function (g) {
      html += '<optgroup label="' + esc(g.label) + '">';
      g.kinds.forEach(function (k) { html += '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + esc(kindLabel(k)) + '</option>'; });
      html += '</optgroup>';
    });
    return html + '</select>';
  }
  function clientSelect(b, c, o) {
    if (o.group === 'other') return '<span class="br-na">—</span>';
    var list = state.clients || [];
    var cands = (b.guess && b.guess.clientCandidates) || [];
    var html = '<select data-br-field="clientId" data-id="' + esc(b.eventId) + '" aria-label="Client"' + (state.clientsAvailable === false && !list.length ? ' disabled' : '') + '>';
    html += '<option value="">' + (o.needsClient && o.group !== 'nf2f' ? 'Choose a client…' : 'No client') + '</option>';
    if (cands.length) {
      html += '<optgroup label="Named in the title">';
      cands.forEach(function (x) { html += '<option value="' + esc(x.id) + '"' + (String(c.clientId) === String(x.id) ? ' selected' : '') + '>' + esc(x.fullName) + '</option>'; });
      html += '</optgroup><optgroup label="All your clients">';
    }
    var seen = false;
    list.forEach(function (x) {
      if (String(c.clientId) === x.id) seen = true;
      html += '<option value="' + esc(x.id) + '"' + (String(c.clientId) === x.id && !cands.some(function (y) { return y.id === x.id; }) ? ' selected' : '') + '>' + esc(x.fullName) + '</option>';
    });
    if (c.clientId && !seen && !cands.some(function (y) { return String(y.id) === String(c.clientId); })) {
      html += '<option value="' + esc(c.clientId) + '" selected>' + esc(clientName(c.clientId, b)) + '</option>';
    }
    if (cands.length) html += '</optgroup>';
    return html + '</select>';
  }
  function confidence(b, field) {
    var f = b.guess && b.guess.fields && b.guess.fields[field];
    if (!f || !f.value || state.edits[b.eventId] && state.edits[b.eventId][field === 'client' ? 'clientId' : field] !== undefined) return '';
    var src = { title: 'from the title', 'title+address': 'from the title and address', address: 'from the address', splose: 'from Splose', category: 'from the Outlook category', event: 'from the block', client_address: "client's address", location: 'from the location' }[f.source] || '';
    return '<span class="br-conf br-conf-' + esc(f.confidence) + '" title="' + esc(f.confidence + ' confidence' + (src ? ', ' + src : '')) + '">' + esc(src || f.confidence) + '</span>';
  }
  function yesNo(v) {
    if (v === 'timer') return '<span class="br-yes" title="Billed through the block\'s timer">With timer</span>';
    return v == null ? '<span class="br-na">—</span>' : (v ? '<span class="br-yes">Yes</span>' : '<span class="br-no">No</span>');
  }

  function render() {
    var body = document.getElementById('br-body');
    if (!body) return;
    var guessed = state.blocks.filter(function (b) { return b.status === 'guessed'; }).length;
    var needs = state.blocks.length - guessed;
    document.getElementById('br-counts').textContent = state.blocks.length
      ? guessed + ' guessed · ' + needs + ' need information' : '';
    document.getElementById('br-confirm-all').disabled = !guessed;
    if (!state.blocks.length) {
      body.innerHTML = '<p class="br-empty">Nothing to review — every block from Outlook and Splose since ' + esc(state.since || defaultSince()) + ' is accounted for.</p>';
      return;
    }
    var rows = state.blocks.map(function (b) {
      var c = choice(b);
      var o = outcome(b, c);
      var busy = !!state.busy[b.eventId];
      var status = b.status === 'guessed'
        ? '<span class="br-chip br-chip-guess">Guessed — check</span>'
        : '<span class="br-chip br-chip-needs">Needs info</span>';
      var miss = o.missing.length ? '<div class="br-miss">Missing: ' + o.missing.map(function (m) { return FIELD_LABEL[m]; }).join(', ') + '</div>' : '';
      return '<tr data-id="' + esc(b.eventId) + '"' + (busy ? ' class="is-busy"' : '') + '>' +
        '<td class="br-when">' + esc(when(b)) + '<div class="br-origin">' + (b.origin === 'splose' ? 'Splose' : 'Outlook') + '</div></td>' +
        '<td class="br-title">' + esc(b.title || '(No subject)') + (b.location ? '<div class="br-loc-orig">' + esc(b.location) + '</div>' : '') + '</td>' +
        '<td' + (o.missing.indexOf('kind') >= 0 ? ' class="br-gap"' : '') + '>' + kindSelect(b, c) + confidence(b, 'kind') + '</td>' +
        '<td' + (o.missing.indexOf('client') >= 0 ? ' class="br-gap"' : '') + '>' + clientSelect(b, c, o) + confidence(b, 'client') + '</td>' +
        '<td' + (o.missing.indexOf('location') >= 0 ? ' class="br-gap"' : '') + '>' +
          (o.needsPlace || c.location
            ? '<input type="text" data-br-field="location" data-id="' + esc(b.eventId) + '" value="' + esc(c.location) + '" placeholder="' + (o.needsPlace ? 'Address' : 'Optional') + '" aria-label="Location">' + confidence(b, 'location')
            : '<span class="br-na">' + (/^telehealth/.test(c.kind) || (b.guess && b.guess.virtual) ? 'Online' : 'Not needed') + '</span>') +
        '</td>' +
        '<td class="br-c">' + yesNo(o.billable) + '</td>' +
        '<td class="br-c">' + yesNo(o.travel) + '</td>' +
        '<td class="br-act">' + status + miss +
          '<div class="br-act-btns">' +
            '<button type="button" class="br-btn primary" data-br="confirm" data-id="' + esc(b.eventId) + '"' + (o.missing.length || busy ? ' disabled' : '') + '>Confirm</button>' +
            '<button type="button" class="br-link" data-br="dismiss" data-id="' + esc(b.eventId) + '"' + (busy ? ' disabled' : '') + ' title="Keep the block as it came in — not billed, no booking type">Leave as is</button>' +
          '</div>' +
        '</td></tr>';
    }).join('');
    body.innerHTML =
      (state.clientsAvailable === false ? '<p class="br-warn">Your client list could not be read, so clients could not be matched. You can still choose what each block is.</p>' : '') +
      '<div class="br-scroll"><table class="br-table"><thead><tr>' +
        '<th>When</th><th>Block</th><th>What it is</th><th>Client</th><th>Location</th><th class="br-c">Billable</th><th class="br-c">Travel</th><th></th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  function edit(id, field, value) {
    state.edits[id] = state.edits[id] || {};
    state.edits[id][field] = value;
  }
  function onChange(e) {
    var t = e.target;
    if (t.id === 'br-since') { state.since = t.value || defaultSince(); refresh(); return; }
    var field = t.getAttribute('data-br-field');
    if (!field) return;
    var id = t.getAttribute('data-id');
    edit(id, field, t.value);
    if (field === 'clientId' && t.value) {
      // A face-to-face service takes the client's address when none is set.
      var b = state.blocks.find(function (x) { return x.eventId === id; });
      var c = choice(b);
      var o = outcome(b, c);
      var cl = (state.clients || []).find(function (x) { return x.id === t.value; });
      if (o.needsPlace && !String(c.location || '').trim() && cl && cl.address) edit(id, 'location', cl.address);
    }
    render();
  }
  function onInput(e) {
    var t = e.target;
    if (t.getAttribute('data-br-field') !== 'location') return;
    edit(t.getAttribute('data-id'), 'location', t.value);
    // Re-evaluate the row without stealing focus from the input.
    var row = t.closest('tr');
    var b = state.blocks.find(function (x) { return x.eventId === t.getAttribute('data-id'); });
    if (!row || !b) return;
    var o = outcome(b, choice(b));
    var btn = row.querySelector('[data-br="confirm"]');
    if (btn) btn.disabled = o.missing.length > 0;
    t.parentNode.classList.toggle('br-gap', o.missing.indexOf('location') >= 0);
    var cells = row.querySelectorAll('td.br-c');
    if (cells[1]) cells[1].innerHTML = yesNo(o.travel);
  }

  function afterChange() {
    if (typeof window.loadOutlookEventsToCalendar === 'function') { try { window.loadOutlookEventsToCalendar(); } catch (_) { /* calendar reload is best effort */ } }
    return refresh();
  }

  function onClick(e) {
    var t = e.target.closest('[data-br]');
    if (!t) { if (e.target.id === 'br-overlay') closePanel(); return; }
    var act = t.getAttribute('data-br');
    var id = t.getAttribute('data-id');
    if (act === 'close') return closePanel();
    if (act === 'confirm-all') {
      var ids = state.blocks.filter(function (b) { return b.status === 'guessed' && !state.edits[b.eventId]; }).map(function (b) { return b.eventId; });
      if (!ids.length) { toast('Edited guesses are confirmed one at a time'); return; }
      t.disabled = true;
      return api('/api/block-review/confirm-guessed', { method: 'POST', body: { eventIds: ids } }).then(function (r) {
        if (!r.ok) toast(r.data.error || 'Could not confirm', true);
        else toast(r.data.confirmed + (r.data.confirmed === 1 ? ' block confirmed' : ' blocks confirmed'));
        return afterChange();
      });
    }
    if (act === 'confirm' || act === 'dismiss') {
      var b = state.blocks.find(function (x) { return x.eventId === id; });
      if (!b) return;
      state.busy[id] = true; render();
      var req = act === 'dismiss'
        ? api('/api/block-review/' + encodeURIComponent(id) + '/dismiss', { method: 'POST' })
        : (function () {
            var c = choice(b);
            return api('/api/block-review/' + encodeURIComponent(id) + '/confirm', { method: 'POST', body: { kind: c.kind, clientId: c.clientId || null, location: c.location || null } });
          })();
      return req.then(function (r) {
        delete state.busy[id];
        if (!r.ok) { toast(r.data.error || 'Could not save this block', true); render(); return; }
        delete state.edits[id];
        toast(act === 'dismiss' ? 'Left as it came in' : 'Block confirmed');
        return afterChange();
      });
    }
  }

  function start() {
    if (!button()) return; // not the authenticated shell
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
  }

  window.BlockReview = { open: openPanel, refresh: refresh, _outcome: outcome };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 2500); });
  else setTimeout(start, 2500);
})();
