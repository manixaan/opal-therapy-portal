'use strict';

/**
 * BLOCK REVIEW — Calendar → "Blocks to review" (migration 086; quality
 * control for outside events, 19 Nov 2026).
 *
 * Every block that reaches the portal from Outlook or Splose — the delta
 * poll, Sync now, a Splose import — is checked by a person before it bills
 * or routes like a portal booking. The server guesses what it can
 * (backend/block-review.js); this panel walks each block through, one card
 * per block:
 *
 *   ⚠ Created outside the portal (Outlook / Splose) — the warning, also shown
 *     as a chip on the block's calendar tile
 *   1  What it is      the Smart Booking categories: direct services, reports,
 *                      non-face-to-face (billable) and not billable
 *   2  Client          matched from the title where possible, otherwise typed:
 *                      the list narrows to your Splose clients as you type
 *   3  Where           the Google address helper; a face-to-face service takes
 *                      the client's address when none is set
 *   4  Before / after  where you were before and went after — Home or an
 *                      address — so the day's travel legs and trip billing work.
 *                      Asked whenever the block is at a real place.
 *
 * A guessed block is already on the calendar but is held out of invoicing
 * until confirmed; a needs-info block is held too. Nothing is written to
 * Outlook or Splose.
 *
 * Where it lives (21 Nov 2026): the "To check" tab of the Calendar's one
 * Sync popup (splose-sync.js calls renderInto). The old separate toolbar
 * button is gone; the Sync button's count includes these blocks. The
 * standalone overlay remains only as a fallback when the Sync popup is absent.
 *
 * Globals on window (no modules): window.BlockReview. Reuses the shell's
 * escapeHtml / showToast / BOOKING_LEAVES / attachPlacesAutocomplete /
 * loadOutlookEventsToCalendar / SESSIONS.
 */
(function () {
  var POLL_MS = 5 * 60 * 1000;
  var LOOKBACK_DAYS = 30;

  // The Smart Booking catalogue, grouped the way the booking panel shows it.
  var GROUPS = [
    { key: 'direct', label: 'Direct services (billable)', kinds: ['assessment', 'assessment-ei', 'initial', 'initial-ei', 'mdt', 'mdu', 'telehealth', 'telehealth-ei', 'therapy', 'therapy-ei'] },
    { key: 'report', label: 'Requested reports (billable)', kinds: ['fca', 'at-report', 'progress-report', 'support-letter'] },
    { key: 'nf2f', label: 'Non-face-to-face (billable with a client)', kinds: ['case-noting', 'case-management', 'resource-prep', 'emails', 'phone-calls'] },
    { key: 'other', label: 'Not billable', kinds: ['pd', 'supervision', 'lunch', 'custom'] },
  ];
  var GROUP_OF = {};
  GROUPS.forEach(function (g) { g.kinds.forEach(function (k) { GROUP_OF[k] = g.key; }); });
  var NO_PLACE = { mdt: 1, mdu: 1, telehealth: 1, 'telehealth-ei': 1 };
  var VIRTUAL_PLACE = /\b(teams|zoom|google meet|webex|skype|telehealth|online|virtual|phone)\b|https?:\/\//i;
  var FIELD_LABEL = { kind: 'what it is', client: 'client', location: 'where', before: 'where you were before', after: 'where you went after' };

  var state = { blocks: [], clients: null, since: null, open: false, inline: false, busy: {}, edits: {}, focusId: null };
  function sync() { return window.SploseSync && typeof window.SploseSync.paint === 'function' ? window.SploseSync : null; }

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
  function blockOf(id) { return state.blocks.filter(function (x) { return x.eventId === id; })[0] || null; }
  function originName(b) { return b.origin === 'splose' ? 'Splose' : 'Outlook'; }

  /** The card's current choice: the person's edit, else the server's guess. */
  function choice(b) {
    var e = state.edits[b.eventId] || {};
    var g = b.guess || {};
    var clientId = e.clientId !== undefined ? e.clientId : (g.clientId || '');
    return {
      kind: e.kind !== undefined ? e.kind : (g.kind || ''),
      clientId: clientId,
      clientQuery: e.clientQuery !== undefined ? e.clientQuery : (clientId ? clientName(clientId, b) : ''),
      location: e.location !== undefined ? e.location : (g.location || b.location || ''),
      before: e.before || { mode: '', address: '' },
      after: e.after || { mode: '', address: '' },
    };
  }
  function isPhysical(b, c) {
    var loc = String(c.location || '').trim();
    if (!loc || VIRTUAL_PLACE.test(loc)) return false;
    if (/^telehealth/.test(c.kind)) return false;
    return true;
  }
  function sideDone(s) { return s.mode === 'home' || (s.mode === 'address' && String(s.address || '').trim().length >= 3); }

  /** PURE-ish — what the choice means for billing, travel and what is still missing. */
  function outcome(b, c) {
    var group = GROUP_OF[c.kind] || null;
    var virtual = !!(b.guess && b.guess.virtual) || /^telehealth/.test(c.kind);
    var needsClient = group === 'direct' || group === 'report';
    var needsPlace = group === 'direct' && !NO_PLACE[c.kind] && !virtual;
    var travel = !!group && !virtual && !NO_PLACE[c.kind] && isPhysical(b, c);
    var missing = [];
    if (!group) missing.push('kind');
    if (needsClient && !c.clientId) missing.push('client');
    if (needsPlace && !String(c.location || '').trim()) missing.push('location');
    if (travel && !sideDone(c.before)) missing.push('before');
    if (travel && !sideDone(c.after)) missing.push('after');
    // nf2f time bills only through its timer (billing/nf2f-timer.js).
    var billable = !group ? null : (group === 'other' ? false : (group === 'nf2f' ? (c.clientId ? 'timer' : 'nf2f-noclient') : (c.clientId ? true : 'needs-client')));
    return { group: group, missing: missing, billable: billable, travel: travel, virtual: virtual,
      needsClient: needsClient, clientAllowed: group !== 'other', needsPlace: needsPlace };
  }

  // ── Toolbar button ────────────────────────────────────────────────────────
  function button() {
    var btn = document.getElementById('cal-block-review-btn');
    if (sync()) { if (btn) btn.remove(); return null; } // the Sync button carries the count
    if (btn) return btn;
    var add = document.querySelector('#view-calendar .btn-add-event');
    if (!add || !add.parentNode) return null;
    btn = document.createElement('button');
    btn.id = 'cal-block-review-btn';
    btn.type = 'button';
    btn.className = 'br-toolbar-btn';
    btn.hidden = true;
    btn.title = 'Blocks created in Outlook or Splose that need checking before they bill or route';
    btn.addEventListener('click', function () { openPanel(); });
    add.parentNode.insertBefore(btn, add);
    return btn;
  }
  function paintButton() {
    if (sync()) { button(); sync().paint(); return; }
    var btn = button();
    if (!btn) return;
    var n = state.blocks.length;
    btn.hidden = n === 0;
    btn.classList.toggle('has-needs', n > 0);
    var html = '<span class="br-dot" aria-hidden="true"></span>' + n + (n === 1 ? ' outside block' : ' outside blocks') + ' to review';
    if (btn.innerHTML !== html) btn.innerHTML = html;
    btn.setAttribute('aria-label', n + ' blocks created outside the portal to review');
  }

  // ── Calendar tiles: the "created outside the portal" chip ─────────────────
  var decorating = false;
  function decorateTiles() {
    if (decorating) return;
    decorating = true;
    try {
      var open = {};
      state.blocks.forEach(function (b) { open[b.eventId] = b; });
      var sessions = window.SESSIONS || {};
      Object.keys(sessions).forEach(function (k) {
        var s = sessions[k];
        if (!s || !s.element) return;
        var b = s.dbId ? open[s.dbId] : null;
        var chip = s.element.querySelector('.br-tile-chip');
        if (!b) { if (chip) chip.remove(); if (s.element.classList.contains('br-outside')) s.element.classList.remove('br-outside'); return; }
        if (!s.element.classList.contains('br-outside')) s.element.classList.add('br-outside');
        if (!chip) {
          chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'br-tile-chip';
          chip.textContent = '!';
          // The tile opens its detail drawer on pointerdown/up, so the chip must
          // act on pointerdown and keep the tile from seeing the press at all.
          var stop = function (e) { e.stopPropagation(); e.preventDefault(); };
          chip.addEventListener('pointerdown', function (e) { stop(e); openPanel(chip.getAttribute('data-id')); });
          chip.addEventListener('pointerup', stop);
          chip.addEventListener('mousedown', stop);
          chip.addEventListener('click', stop);
          chip.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { stop(e); openPanel(chip.getAttribute('data-id')); } });
          s.element.appendChild(chip);
        }
        var tip = 'Created outside the portal (' + originName(b) + ') — check it before it bills or routes';
        if (chip.title !== tip) { chip.title = tip; chip.setAttribute('aria-label', tip); }
        if (chip.getAttribute('data-id') !== b.eventId) chip.setAttribute('data-id', b.eventId);
      });
    } finally { decorating = false; }
  }
  var decorateTimer = null;
  function watchGrid() {
    var grid = document.getElementById('cal-grid') || document.querySelector('#view-calendar');
    if (!grid || grid.__brWatched || typeof MutationObserver !== 'function') return;
    grid.__brWatched = true;
    // Writes are idempotent (no change → no mutation), so this cannot loop.
    new MutationObserver(function () {
      if (decorating || !state.blocks.length) return;
      clearTimeout(decorateTimer);
      decorateTimer = setTimeout(decorateTiles, 150);
    }).observe(grid, { childList: true, subtree: true });
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  function refresh() {
    var since = state.since || defaultSince();
    return api('/api/block-review?since=' + encodeURIComponent(since)).then(function (r) {
      if (!r.ok) { if (r.status !== 401 && r.status !== 403 && state.open) toast(r.data.error || 'Blocks could not be checked', true); return; }
      state.blocks = r.data.blocks || [];
      state.clientsAvailable = r.data.clientsAvailable !== false;
      state.since = r.data.since || since;
      var live = {};
      state.blocks.forEach(function (b) { live[b.eventId] = 1; });
      Object.keys(state.edits).forEach(function (id) { if (!live[id]) delete state.edits[id]; });
      paintButton();
      decorateTiles();
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
    var c = (state.clients || []).filter(function (x) { return x.id === String(id); })[0];
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
          '<div><h2 id="br-title">Blocks created outside the portal</h2>' +
          '<p class="br-sub">Bookings made straight in Outlook or Splose. Check what each one is, the client, where it was, and where you were before and after, so it bills and routes like a portal booking. Nothing is changed in Outlook or Splose.</p></div>' +
          '<button type="button" class="br-x" data-br="close" aria-label="Close">×</button>' +
        '</header>' +
        '<div class="br-bar">' +
          '<label class="br-since">Look back from <input type="date" id="br-since"></label>' +
          '<span class="br-counts" id="br-counts"></span>' +
          '<span class="br-spacer"></span>' +
          '<button type="button" class="br-btn" data-br="confirm-all" id="br-confirm-all" title="Online and desk blocks whose guess is complete. Blocks at a place need before/after, one at a time.">Confirm complete guesses</button>' +
        '</div>' +
        '<div class="br-body" id="br-body"></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', onClick);
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    // Capture phase: note whether an address suggestion list was open BEFORE
    // the helper's own Escape handler (on the input) closes and empties it.
    el.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var t = e.target, pac = t && t.classList && t.classList.contains('br-place') && t.parentNode && t.parentNode.querySelector('.pac-panel');
      e.__brPacOpen = !!(pac && pac.style.display !== 'none' && pac.innerHTML);
    }, true);
    el.addEventListener('keydown', onKeydown);
    return el;
  }

  function openPanel(focusId) {
    if (sync()) {
      state.focusId = typeof focusId === 'string' ? focusId : null;
      if (sync().isReviewOpen()) { render(); return; }
      sync().open('review');
      return;
    }
    var el = shell();
    state.open = true;
    state.focusId = typeof focusId === 'string' ? focusId : null;
    el.hidden = false;
    document.getElementById('br-since').value = state.since || defaultSince();
    var target = state.focusId;
    render();
    if (!target) { var x = el.querySelector('.br-x'); if (x) x.focus(); }
    loadClients().then(render);
    refresh();
  }
  /** Mount the review inside the Sync popup's "To check" tab. Re-renders of
   *  the tab (the popup repaints on its own polls) only repaint the cards. */
  function renderInto(body, foot) {
    var el = shell();
    var first = el.parentNode !== body;
    el.classList.add('br-inline');
    el.hidden = false;
    var panel = el.querySelector('.br-panel');
    if (panel) { panel.removeAttribute('role'); panel.removeAttribute('aria-modal'); }
    if (first) { body.innerHTML = ''; body.appendChild(el); }
    state.open = true; state.inline = true;
    if (foot) {
      foot.innerHTML = '<button type="button" class="btn" data-br-foot="close">Close</button>';
      foot.querySelector('[data-br-foot=close]').addEventListener('click', function () { if (sync()) sync().close(); });
    }
    if (!first) { render(); return; }
    document.getElementById('br-since').value = state.since || defaultSince();
    render();
    loadClients().then(render);
    refresh();
  }
  /** The Sync popup closed or moved to another tab. */
  function detach() {
    if (!state.inline) return;
    state.open = false; state.inline = false;
    hideLists();
  }

  function closePanel() {
    if (state.inline) { if (sync()) sync().close(); return; }
    var el = document.getElementById('br-overlay');
    if (el) el.hidden = true;
    state.open = false;
    var btn = document.getElementById('cal-block-review-btn');
    if (btn && !btn.hidden) btn.focus();
  }

  function kindSelect(b, c) {
    var html = '<select class="br-in" data-br-field="kind" data-id="' + esc(b.eventId) + '" aria-label="What this block is"><option value="">Choose what this is…</option>';
    GROUPS.forEach(function (g) {
      html += '<optgroup label="' + esc(g.label) + '">';
      g.kinds.forEach(function (k) { html += '<option value="' + k + '"' + (c.kind === k ? ' selected' : '') + '>' + esc(kindLabel(k)) + '</option>'; });
      html += '</optgroup>';
    });
    return html + '</select>';
  }

  function conf(b, field) {
    var f = b.guess && b.guess.fields && b.guess.fields[field];
    var e = state.edits[b.eventId] || {};
    if (!f || !f.value || e[field === 'client' ? 'clientId' : field] !== undefined) return '';
    var src = { title: 'matched from the title', 'title+address': 'matched from the title and address', address: 'matched from the address', splose: 'from Splose', category: 'from the Outlook category', event: 'from the block', client_address: "the client's address", location: 'from the location' }[f.source] || '';
    return '<span class="br-conf br-conf-' + esc(f.confidence) + '">' + esc(src || f.confidence) + (f.confidence !== 'high' ? ' — please check' : '') + '</span>';
  }

  function clientField(b, c, o) {
    if (!o.clientAllowed) return '<p class="br-na">Not billable — no client needed.</p>';
    var cands = (b.guess && b.guess.clientCandidates) || [];
    var hint = cands.length && !c.clientId
      ? '<div class="br-cands">Named in the title: ' + cands.map(function (x) { return '<button type="button" class="br-chip-btn" data-br="pick-client" data-id="' + esc(b.eventId) + '" data-client="' + esc(x.id) + '">' + esc(x.fullName) + '</button>'; }).join('') + '</div>' : '';
    var disabled = state.clientsAvailable === false && !(state.clients || []).length;
    return '<div class="br-ta">' +
        '<input type="text" class="br-in" autocomplete="off" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="br-ta-' + esc(b.eventId) + '"' +
          ' data-br-field="clientQuery" data-id="' + esc(b.eventId) + '" value="' + esc(c.clientQuery) + '"' +
          ' placeholder="' + (disabled ? 'Client list unavailable' : 'Start typing a client name…') + '"' + (disabled ? ' disabled' : '') + ' aria-label="Client">' +
        (c.clientId ? '<button type="button" class="br-link br-clear" data-br="clear-client" data-id="' + esc(b.eventId) + '">Clear</button>' : '') +
        '<ul class="br-ta-list" id="br-ta-' + esc(b.eventId) + '" role="listbox" hidden></ul>' +
      '</div>' + conf(b, 'client') + hint +
      (o.needsClient ? '' : '<p class="br-hint">Optional — add one if this time was for a client.</p>');
  }

  function placeField(b, c, o) {
    if (o.virtual || NO_PLACE[c.kind]) {
      return '<p class="br-na">Online — no place or travel.</p>';
    }
    return '<input type="text" class="br-in br-place" autocomplete="off" data-br-field="location" data-id="' + esc(b.eventId) + '" value="' + esc(c.location) + '"' +
      ' placeholder="' + (o.needsPlace ? 'Search for the address' : 'Address — leave blank if at your desk or online') + '" aria-label="Where it was">' + conf(b, 'location');
  }

  function sideField(b, c, side) {
    var s = c[side];
    var label = side === 'before' ? 'Before — where were you?' : 'After — where did you go?';
    var id = esc(b.eventId);
    return '<div class="br-side" data-side="' + side + '">' +
      '<span class="br-side-label">' + label + '</span>' +
      '<div class="br-seg" role="radiogroup" aria-label="' + esc(label) + '">' +
        '<button type="button" role="radio" aria-checked="' + (s.mode === 'home') + '" class="br-seg-btn' + (s.mode === 'home' ? ' on' : '') + '" data-br="side" data-side="' + side + '" data-mode="home" data-id="' + id + '">Home</button>' +
        '<button type="button" role="radio" aria-checked="' + (s.mode === 'address') + '" class="br-seg-btn' + (s.mode === 'address' ? ' on' : '') + '" data-br="side" data-side="' + side + '" data-mode="address" data-id="' + id + '">Another address</button>' +
      '</div>' +
      (s.mode === 'address'
        ? '<input type="text" class="br-in br-place" autocomplete="off" data-br-field="' + side + '" data-id="' + id + '" value="' + esc(s.address || '') + '" placeholder="Search for the address" aria-label="' + esc(label) + '">'
        : '') +
      '</div>';
  }

  function yesNo(v) {
    if (v === 'timer') return '<span class="br-yes">Billable with timer</span>';
    if (v === 'needs-client') return '<span class="br-no">Billable once the client is chosen</span>';
    if (v === 'nf2f-noclient') return '<span class="br-no">Billable only with a client</span>';
    return v == null ? '' : (v ? '<span class="br-yes">Billable</span>' : '<span class="br-no">Not billable</span>');
  }

  function card(b) {
    var c = choice(b);
    var o = outcome(b, c);
    var busy = !!state.busy[b.eventId];
    var id = esc(b.eventId);
    var status = b.status === 'guessed'
      ? '<span class="br-chip br-chip-guess">Guessed — check</span>'
      : '<span class="br-chip br-chip-needs">Needs info</span>';
    var miss = o.missing.length ? '<span class="br-miss">Still needed: ' + o.missing.map(function (m) { return FIELD_LABEL[m]; }).join(', ') + '</span>' : '<span class="br-ready">Ready to confirm</span>';
    return '<article class="br-card' + (busy ? ' is-busy' : '') + (state.focusId === b.eventId ? ' is-focus' : '') + '" data-card="' + id + '">' +
      '<div class="br-warn-strip" role="note"><span aria-hidden="true">⚠</span> Created outside the portal — in ' + esc(originName(b)) + '. Check it before it bills or routes.</div>' +
      '<div class="br-card-head">' +
        '<div><div class="br-card-title">' + esc(b.title || '(No subject)') + '</div>' +
        '<div class="br-card-when">' + esc(when(b)) + (b.location ? ' · ' + esc(b.location) : '') + '</div></div>' +
        status +
      '</div>' +
      '<ol class="br-steps">' +
        '<li class="br-step' + (o.missing.indexOf('kind') >= 0 ? ' br-gap' : '') + '"><span class="br-step-n">1</span><div class="br-step-body"><label class="br-step-label">What is it?</label>' + kindSelect(b, c) + conf(b, 'kind') + ' ' + yesNo(o.billable) + '</div></li>' +
        '<li class="br-step' + (o.missing.indexOf('client') >= 0 ? ' br-gap' : '') + '"><span class="br-step-n">2</span><div class="br-step-body"><label class="br-step-label">Client</label>' + clientField(b, c, o) + '</div></li>' +
        '<li class="br-step' + (o.missing.indexOf('location') >= 0 ? ' br-gap' : '') + '"><span class="br-step-n">3</span><div class="br-step-body"><label class="br-step-label">Where was it?</label>' + placeField(b, c, o) + '</div></li>' +
        (o.travel
          ? '<li class="br-step' + (o.missing.indexOf('before') >= 0 || o.missing.indexOf('after') >= 0 ? ' br-gap' : '') + '"><span class="br-step-n">4</span><div class="br-step-body"><label class="br-step-label">Travel</label>' +
              sideField(b, c, 'before') + sideField(b, c, 'after') + '</div></li>'
          : '') +
      '</ol>' +
      '<div class="br-card-foot">' + miss + '<span class="br-spacer"></span>' +
        '<button type="button" class="br-link" data-br="dismiss" data-id="' + id + '"' + (busy ? ' disabled' : '') + ' title="Keep the block as it came in — not billed, no booking type">Leave as is</button>' +
        '<button type="button" class="br-btn primary" data-br="confirm" data-id="' + id + '"' + (o.missing.length || busy ? ' disabled' : '') + '>Confirm</button>' +
      '</div>' +
    '</article>';
  }

  /** Remember the focused control so a re-render can put focus back on it. */
  function focusKey() {
    var a = document.activeElement;
    if (!a || !a.closest || !a.closest('#br-body')) return null;
    var card = a.closest('[data-card]');
    var sel = a.getAttribute('data-br-field') ? '[data-br-field="' + a.getAttribute('data-br-field') + '"]'
      : a.getAttribute('data-br') ? '[data-br="' + a.getAttribute('data-br') + '"]' + (a.getAttribute('data-side') ? '[data-side="' + a.getAttribute('data-side') + '"][data-mode="' + a.getAttribute('data-mode') + '"]' : '')
      : null;
    return card && sel ? { card: card.getAttribute('data-card'), sel: sel } : null;
  }
  function restoreFocus(k) {
    if (!k) return;
    var el = document.querySelector('#br-body [data-card="' + k.card + '"] ' + k.sel);
    if (!el) { var c = document.querySelector('#br-body [data-card="' + k.card + '"]'); el = c && c.querySelector('select, input, button'); }
    if (!el) { var x = document.querySelector('#br-overlay .br-x'); el = x; }
    if (el) el.focus();
  }

  function render() {
    var body = document.getElementById('br-body');
    if (!body) return;
    var keep = focusKey();
    var guessed = state.blocks.filter(function (b) { return b.status === 'guessed'; }).length;
    var needs = state.blocks.length - guessed;
    document.getElementById('br-counts').textContent = state.blocks.length
      ? state.blocks.length + ' to check · ' + guessed + ' guessed · ' + needs + ' need information' : '';
    var quick = state.blocks.filter(function (b) { return b.status === 'guessed' && !state.edits[b.eventId] && !outcome(b, choice(b)).travel; }).length;
    document.getElementById('br-confirm-all').disabled = !quick;
    if (!state.blocks.length) {
      body.innerHTML = '<p class="br-empty">Nothing to check — every block from Outlook and Splose since ' + esc(state.since || defaultSince()) + ' has been reviewed.</p>';
      return;
    }
    body.innerHTML =
      (state.clientsAvailable === false ? '<p class="br-warn">Your client list could not be read, so clients could not be matched. You can still choose what each block is.</p>' : '') +
      state.blocks.map(card).join('');
    attachPlaces(body);
    if (state.focusId) {
      var f = body.querySelector('[data-card="' + state.focusId + '"]');
      if (f) {
        f.scrollIntoView({ block: 'start' });
        var first = f.querySelector('select, input, button');
        if (first) first.focus();
        state.focusId = null; // found: later re-renders keep focus via restoreFocus
      }
      return;
    }
    restoreFocus(keep);
  }

  function attachPlaces(root) {
    if (typeof window.attachPlacesAutocomplete !== 'function') return;
    Array.prototype.forEach.call(root.querySelectorAll('input.br-place'), function (inp) {
      window.attachPlacesAutocomplete(inp, function (address, lat, lng, placeId) {
        var id = inp.getAttribute('data-id'), field = inp.getAttribute('data-br-field');
        if (field === 'location') edit(id, 'location', address || inp.value);
        else edit(id, field, { mode: 'address', address: address || inp.value, lat: lat, lng: lng, placeId: placeId });
        render();
      });
    });
  }

  // ── Client type-ahead ─────────────────────────────────────────────────────
  function matches(q) {
    var list = state.clients || [];
    q = String(q || '').trim().toLowerCase();
    if (!q) return list.slice(0, 8);
    var words = q.split(/\s+/);
    return list.filter(function (c) {
      var n = c.fullName.toLowerCase();
      return words.every(function (w) { return n.indexOf(w) >= 0; });
    }).slice(0, 8);
  }
  function showList(inp) {
    var id = inp.getAttribute('data-id');
    var ul = document.getElementById('br-ta-' + id);
    if (!ul) return;
    var list = matches(inp.value);
    ul.innerHTML = list.length
      ? list.map(function (c, i) { return '<li role="option" id="br-ta-' + esc(id) + '-' + i + '" class="br-ta-item" data-br="choose-client" data-id="' + esc(id) + '" data-client="' + esc(c.id) + '">' + esc(c.fullName) + (c.address ? '<small>' + esc(c.address) + '</small>' : '') + '</li>'; }).join('')
      : '<li class="br-ta-empty">No client by that name on your Splose caseload</li>';
    ul.hidden = false;
    ul.__hi = -1;
    inp.setAttribute('aria-expanded', 'true');
  }
  function hideLists(except) {
    Array.prototype.forEach.call(document.querySelectorAll('#br-overlay .br-ta-list'), function (ul) {
      if (ul === except) return;
      ul.hidden = true;
      var inp = ul.parentNode.querySelector('input'); if (inp) inp.setAttribute('aria-expanded', 'false');
    });
  }
  function chooseClient(id, clientId) {
    var b = blockOf(id);
    if (!b) return;
    var cl = (state.clients || []).filter(function (x) { return x.id === String(clientId); })[0];
    edit(id, 'clientId', String(clientId));
    edit(id, 'clientQuery', cl ? cl.fullName : clientName(clientId, b));
    // A face-to-face service takes the client's address when none is set.
    var c = choice(b), o = outcome(b, c);
    if (o.needsPlace && !String(c.location || '').trim() && cl && cl.address) edit(id, 'location', cl.address);
    render();
    // Chosen with the mouse, focus was on the list item that is now gone.
    var inp = document.querySelector('#br-overlay [data-card="' + id + '"] [data-br-field="clientQuery"]');
    if (inp && (!document.activeElement || document.activeElement === document.body)) inp.focus();
  }

  function edit(id, field, value) {
    state.edits[id] = state.edits[id] || {};
    state.edits[id][field] = value;
  }

  function onChange(e) {
    var t = e.target;
    if (t.id === 'br-since') { state.since = t.value || defaultSince(); refresh(); return; }
    if (t.getAttribute('data-br-field') === 'kind') { edit(t.getAttribute('data-id'), 'kind', t.value); render(); }
  }

  /** Re-check one card's gaps without re-rendering (keeps focus in the input). */
  function repaintFoot(id) {
    var b = blockOf(id), el = document.querySelector('#br-overlay [data-card="' + id + '"]');
    if (!b || !el) return;
    var o = outcome(b, choice(b));
    var btn = el.querySelector('[data-br="confirm"]');
    if (btn) btn.disabled = o.missing.length > 0 || !!state.busy[id];
    // Step numbers turn red while that step is still needed.
    var steps = el.querySelectorAll('.br-step');
    var gaps = [o.missing.indexOf('kind') >= 0, o.missing.indexOf('client') >= 0, o.missing.indexOf('location') >= 0,
      o.missing.indexOf('before') >= 0 || o.missing.indexOf('after') >= 0];
    Array.prototype.forEach.call(steps, function (li, i) { if (li.classList.contains('br-gap') !== gaps[i]) li.classList.toggle('br-gap', gaps[i]); });
    var foot = el.querySelector('.br-miss, .br-ready');
    if (foot) {
      foot.className = o.missing.length ? 'br-miss' : 'br-ready';
      foot.textContent = o.missing.length ? 'Still needed: ' + o.missing.map(function (m) { return FIELD_LABEL[m]; }).join(', ') : 'Ready to confirm';
    }
    // A place typed or cleared changes whether travel is asked: re-render once it flips.
    var hasTravel = !!el.querySelector('.br-side');
    return hasTravel !== o.travel;
  }

  function onInput(e) {
    var t = e.target;
    var field = t.getAttribute('data-br-field');
    var id = t.getAttribute('data-id');
    if (!field || !id) return;
    if (field === 'clientQuery') {
      edit(id, 'clientQuery', t.value);
      // Typing over a chosen client un-chooses it until a name is picked again.
      if ((state.edits[id] || {}).clientId) edit(id, 'clientId', '');
      showList(t);
      repaintFoot(id);
      return;
    }
    if (field === 'location') edit(id, 'location', t.value);
    if (field === 'before' || field === 'after') edit(id, field, { mode: 'address', address: t.value });
    if (repaintFoot(id)) {
      // Travel appeared/disappeared: re-render, then put the caret back.
      var pos = t.selectionStart;
      render();
      var again = document.querySelector('#br-overlay [data-card="' + id + '"] [data-br-field="' + field + '"]');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (_) { /* not a text input */ } }
    }
  }

  function onKeydown(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-br-field') === 'clientQuery') {
      var ul = document.getElementById('br-ta-' + t.getAttribute('data-id'));
      var items = ul ? ul.querySelectorAll('.br-ta-item') : [];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!ul || ul.hidden) showList(t);
        items = ul.querySelectorAll('.br-ta-item');
        if (!items.length) return;
        ul.__hi = ((ul.__hi == null ? -1 : ul.__hi) + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        Array.prototype.forEach.call(items, function (li, i) { li.classList.toggle('hi', i === ul.__hi); });
        t.setAttribute('aria-activedescendant', items[ul.__hi].id);
        e.preventDefault();
        return;
      }
      if (e.key === 'Enter' && ul && !ul.hidden && items.length) {
        var li = items[ul.__hi >= 0 ? ul.__hi : 0];
        chooseClient(li.getAttribute('data-id'), li.getAttribute('data-client'));
        e.preventDefault();
        return;
      }
      if (e.key === 'Escape' && ul && !ul.hidden) { hideLists(); e.stopPropagation(); return; }
    }
    if (e.key === 'Escape') {
      // The Google address helper closes its own suggestion list on Escape.
      if (e.__brPacOpen) return;
      if (state.inline) return; // the Sync popup's own Escape closes it
      closePanel();
    }
  }

  function afterChange() {
    if (typeof window.loadOutlookEventsToCalendar === 'function') { try { window.loadOutlookEventsToCalendar(); } catch (_) { /* calendar reload is best effort */ } }
    return refresh();
  }

  function travelBody(c) {
    var side = function (s) {
      if (s.mode === 'home') return { mode: 'home' };
      var o = { mode: 'address', address: String(s.address || '').trim() };
      if (s.placeId) o.placeId = s.placeId;
      var lat = parseFloat(s.lat), lng = parseFloat(s.lng);
      if (isFinite(lat) && isFinite(lng)) { o.lat = lat; o.lng = lng; }
      return o;
    };
    return { before: side(c.before), after: side(c.after) };
  }

  function onClick(e) {
    var t = e.target.closest ? e.target.closest('[data-br]') : null;
    if (!e.target.closest || !e.target.closest('.br-ta')) hideLists();
    if (!t) { if (e.target.id === 'br-overlay' && !state.inline) closePanel(); return; }
    var act = t.getAttribute('data-br');
    var id = t.getAttribute('data-id');
    if (act === 'close') return closePanel();
    if (act === 'pick-client' || act === 'choose-client') return chooseClient(id, t.getAttribute('data-client'));
    if (act === 'clear-client') { edit(id, 'clientId', ''); edit(id, 'clientQuery', ''); render(); return; }
    if (act === 'side') {
      var c0 = choice(blockOf(id)), side = t.getAttribute('data-side'), mode = t.getAttribute('data-mode');
      edit(id, side, mode === 'home' ? { mode: 'home' } : { mode: 'address', address: c0[side].mode === 'address' ? c0[side].address : '' });
      render();
      if (mode === 'address') {
        var inp = document.querySelector('#br-overlay [data-card="' + id + '"] [data-br-field="' + side + '"]');
        if (inp) inp.focus();
      }
      return;
    }
    if (act === 'confirm-all') {
      var ids = state.blocks.filter(function (b) { return b.status === 'guessed' && !state.edits[b.eventId] && !outcome(b, choice(b)).travel; }).map(function (b) { return b.eventId; });
      if (!ids.length) { toast('Blocks at a place need before/after — confirm those one at a time'); return; }
      t.disabled = true;
      return api('/api/block-review/confirm-guessed', { method: 'POST', body: { eventIds: ids } }).then(function (r) {
        if (!r.ok) toast(r.data.error || 'Could not confirm', true);
        else toast(r.data.confirmed + (r.data.confirmed === 1 ? ' block confirmed' : ' blocks confirmed') + (r.data.needTravel ? ' · ' + r.data.needTravel + ' at a place still need before/after' : ''));
        return afterChange();
      });
    }
    if (act === 'confirm' || act === 'dismiss') {
      var b = blockOf(id);
      if (!b) return;
      state.busy[id] = true; render();
      var req;
      if (act === 'dismiss') req = api('/api/block-review/' + encodeURIComponent(id) + '/dismiss', { method: 'POST' });
      else {
        var c = choice(b), o = outcome(b, c);
        // A blanked place is sent as '' — "at my desk / online" — so the
        // block's own Outlook/Splose place is cleared, not kept.
        var body = { kind: c.kind, clientId: o.clientAllowed ? (c.clientId || null) : null, location: o.virtual || NO_PLACE[c.kind] ? null : String(c.location || '').trim() };
        if (o.travel) body.travel = travelBody(c);
        req = api('/api/block-review/' + encodeURIComponent(id) + '/confirm', { method: 'POST', body: body });
      }
      return req.then(function (r) {
        delete state.busy[id];
        if (!r.ok) { toast(r.data.error || 'Could not save this block', true); render(); return; }
        delete state.edits[id];
        toast(act === 'dismiss' ? 'Left as it came in' : 'Block confirmed — it now bills and routes like a portal booking');
        return afterChange();
      });
    }
  }

  function start() {
    if (!document.getElementById('view-calendar')) return; // not the authenticated shell
    button();
    watchGrid();
    refresh();
    setInterval(function () { if (!document.hidden) refresh(); }, POLL_MS);
  }

  window.BlockReview = { open: openPanel, refresh: refresh, renderInto: renderInto, detach: detach,
    count: function () { return state.blocks.length; }, _outcome: outcome, _state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 2500); });
  else setTimeout(start, 2500);
})();
