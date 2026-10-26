'use strict';

/**
 * SYNC SETTINGS — Settings → Integrations → Calendar sync (migration 081).
 *
 * Two cards, Outlook and Splose. Each direction has three choices: on/off,
 * "sync events from" (anything earlier is left alone in that direction; clear
 * the date to include everything) and Automatic (otherwise it only runs when
 * "Sync now" is pressed). Choices save as they are made.
 *
 * "Sync now" never writes straight away: it asks the server for a plan — per
 * event, link (the other side already has it), create, update, delete, or
 * choose — shows it, and applies only what is ticked. The server re-plans
 * before applying, so a stale preview cannot write anything unexpected.
 *
 * The Owner also sees the practice defaults and limits.
 *
 * Globals on window (no modules): window.SyncSettings. Reuses the shell's
 * escapeHtml / showToast / portalConfirm and window.SploseSync.open.
 */
(function () {
  var DIRS = {
    portal_to_outlook: { from: 'Portal', to: 'Outlook', help: 'Bookings and edits made in the portal are written to your Outlook calendar.' },
    outlook_to_portal: { from: 'Outlook', to: 'Portal', help: 'Events added or changed in Outlook appear in the portal.' },
    portal_to_splose:  { from: 'Portal', to: 'Splose', help: 'Client bookings made in the portal are queued for Splose. Publishing needs Splose writing switched on.' },
    splose_to_portal:  { from: 'Splose', to: 'Portal', help: 'Appointments booked in Splose appear in the portal. Off: the "new in Splose" alerts stop too.' },
    splose_to_outlook: { from: 'Splose', to: 'Outlook', help: 'Appointments that came from Splose are copied on to your Outlook, through the portal.' },
  };
  var CARDS = [
    { key: 'outlook', title: 'Outlook', dirs: ['portal_to_outlook', 'outlook_to_portal'] },
    { key: 'splose', title: 'Splose', dirs: ['portal_to_splose', 'splose_to_portal', 'splose_to_outlook'] },
  ];
  var BLOCKED = {
    ENABLE_OUTLOOK_WRITE: 'Outlook writing is switched off on this server.',
    ENABLE_SPLOSE_DRAFT_SYNC: 'Splose sync is switched off on this server.',
    SPLOSE_NOT_CONNECTED: 'Splose is not connected (Settings → Integrations).',
    ENABLE_SPLOSE_WRITE: 'Splose writing is switched off on this server — changes queue but are not sent.',
    ENABLE_SPLOSE_AUTO_SYNC: 'Automatic Splose publishing is switched off on this server.',
  };
  var ACTION = {
    link:   { label: 'Already there — link', help: 'The other side already has this. They are joined up; nothing is copied.' },
    create: { label: 'Copy across', help: 'Not on the other side yet. A copy is made.' },
    update: { label: 'Send edit', help: 'Changed in the portal while this sync was held.' },
    delete: { label: 'Remove copy', help: 'Deleted in the portal, still in Outlook. Tick to remove it there too.' },
    review: { label: 'Choose', help: 'More than one possible match — pick the right one, copy it, or skip.' },
  };
  var ORDER = ['review', 'link', 'create', 'update', 'delete'];

  var state = { effective: null, isOwner: false, loading: false, saving: {}, preview: null };

  var esc = function (s) { return window.escapeHtml ? window.escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (msg, isError) { if (window.showToast) window.showToast(msg, !!isError); };
  var $ = function (id) { return document.getElementById(id); };
  var api = function (url, opts) {
    var o = Object.assign({ credentials: 'include' }, opts || {});
    if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); o.headers = Object.assign({ 'Content-Type': 'application/json' }, o.headers || {}); }
    return fetch(url, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; });
    }).catch(function () { return { ok: false, status: 0, data: { error: 'Could not reach the server' } }; });
  };
  var when = function (iso) {
    if (!iso) return '';
    var d = new Date(iso); if (isNaN(d)) return '';
    return d.toLocaleString('en-AU', { timeZone: 'Australia/Perth', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  };
  var day = function (ymd) {
    if (!ymd) return '';
    var d = new Date(ymd + 'T00:00:00+08:00');
    return isNaN(d) ? ymd : d.toLocaleDateString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric' });
  };

  var instantDay = function (iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-AU', { timeZone: 'Australia/Perth', day: 'numeric', month: 'short', year: 'numeric' });
  };

  // ── Load + render ──────────────────────────────────────────────────────────

  function load() {
    var root = $('sync-settings-root');
    if (!root || state.loading) return Promise.resolve();
    state.loading = true;
    return api('/api/sync-settings').then(function (r) {
      state.loading = false;
      if (!r.ok) { root.innerHTML = '<p class="sys-quiet">' + esc(r.data.error || 'Sync settings are unavailable') + '</p>'; return; }
      state.effective = r.data.effective;
      state.isOwner = !!r.data.isOwner;
      render();
    });
  }

  function toggle(id, checked, disabled, label) {
    return '<label class="settings-toggle" title="' + esc(label) + '"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (disabled ? ' disabled' : '') +
      ' aria-label="' + esc(label) + '"><span class="settings-toggle-slider"></span></label>';
  }

  function dirRow(d) {
    var e = state.effective[d], m = DIRS[d];
    var notes = [];
    if (e.blockedBy) notes.push('<span class="sys-note warn">' + esc(BLOCKED[e.blockedBy] || 'Switched off on this server.') + '</span>');
    if (!e.practice.allowed) notes.push('<span class="sys-note">The Owner has switched this off for the practice.</span>');
    if (e.writeBlockedBy) notes.push('<span class="sys-note">' + esc(BLOCKED[e.writeBlockedBy]) + '</span>');
    if (e.auto && e.autoBlockedBy) notes.push('<span class="sys-note">' + esc(BLOCKED[e.autoBlockedBy]) + '</span>');
    var limit = e.practice.earliestFrom ? ' min="' + esc(e.practice.earliestFrom) + '"' : '';
    var fromHint = e.syncFrom ? 'Events before ' + day(e.syncFrom) + ' are left alone.' : 'All dates.';
    return '' +
      '<div class="sys-dir" data-dir="' + d + '">' +
        '<div class="sys-dir-head">' +
          '<div class="sys-dir-name"><span>' + esc(m.from) + '</span><span class="sys-arrow" aria-hidden="true">→</span><span>' + esc(m.to) + '</span></div>' +
          toggle('sys-on-' + d, e.enabled, !e.practice.allowed, m.from + ' to ' + m.to + ' on') +
        '</div>' +
        '<p class="sys-help">' + esc(m.help) + '</p>' +
        '<div class="sys-dir-controls' + (e.enabled ? '' : ' is-off') + '">' +
          '<label class="sys-field"><span>Sync events from</span>' +
            '<span class="sys-date"><input type="date" id="sys-from-' + d + '" value="' + esc(e.user.syncFrom || '') + '"' + limit + (e.enabled ? '' : ' disabled') + '>' +
            '<button type="button" class="sys-link" data-clear="' + d + '"' + (e.user.syncFrom && e.enabled ? '' : ' hidden') + '>All dates</button></span>' +
            '<small>' + esc(fromHint) + (e.practice.earliestFrom ? ' Earliest allowed: ' + esc(day(e.practice.earliestFrom)) + '.' : '') + '</small>' +
          '</label>' +
          '<label class="sys-field sys-auto"><span>Automatic</span>' +
            toggle('sys-auto-' + d, e.auto, !e.enabled || !e.practice.allowAuto, m.from + ' to ' + m.to + ' automatic') +
            '<small>' + (e.practice.allowAuto ? (e.auto ? 'Runs by itself.' : 'Only when you press Sync now.') : 'The Owner allows Sync now only.') + '</small>' +
          '</label>' +
        '</div>' +
        (notes.length ? '<div class="sys-notes">' + notes.join('') + '</div>' : '') +
      '</div>';
  }

  function render() {
    var root = $('sync-settings-root');
    if (!root || !state.effective) return;
    var html = CARDS.map(function (c) {
      return '' +
        '<div class="settings-group sys-card" data-card="' + c.key + '">' +
          '<div class="settings-group-header sys-card-head"><span>' + esc(c.title) + '</span>' +
            '<button type="button" class="sys-btn primary" data-syncnow="' + c.key + '">Sync now</button></div>' +
          c.dirs.map(dirRow).join('') +
        '</div>';
    }).join('');
    if (state.isOwner) html += practiceCard();
    root.innerHTML = html;
  }

  function practiceCard() {
    var rows = Object.keys(DIRS).map(function (d) {
      var p = state.effective[d].practice, m = DIRS[d];
      var cb = function (k, label) { return '<td>' + toggle('sysp-' + k + '-' + d, !!p[k], false, m.from + ' to ' + m.to + ' ' + label) + '</td>'; };
      return '<tr data-dir="' + d + '"><th scope="row">' + esc(m.from) + ' → ' + esc(m.to) + '</th>' +
        cb('allowed', 'allowed') + cb('allowAuto', 'may run automatically') + cb('enabled', 'on by default') + cb('auto', 'automatic by default') +
        '<td><input type="date" id="sysp-syncFrom-' + d + '" value="' + esc(p.syncFrom || '') + '" aria-label="Default sync-from date"></td>' +
        '<td><input type="date" id="sysp-earliestFrom-' + d + '" value="' + esc(p.earliestFrom || '') + '" aria-label="Earliest date anyone may choose"></td></tr>';
    }).join('');
    return '' +
      '<div class="settings-group sys-card sys-practice">' +
        '<div class="settings-group-header sys-card-head"><span>Practice defaults &amp; limits <small>(Owner)</small></span>' +
          '<button type="button" class="sys-btn" id="sysp-save">Save practice settings</button></div>' +
        '<p class="sys-help sys-pad">Defaults apply to anyone who has not chosen for themselves. Limits apply to everyone: a direction that is not allowed stays off, one that may not run automatically is Sync now only, and nobody can bring across events from before the earliest date.</p>' +
        '<div class="sys-table-wrap"><table class="sys-table"><thead><tr><th>Direction</th><th>Allowed</th><th>May be automatic</th><th>On by default</th><th>Automatic by default</th><th>Default from</th><th>Earliest from</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div>' +
      '</div>';
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  function saveMine(d, change) {
    var body = { directions: {} }; body.directions[d] = change;
    return api('/api/sync-settings', { method: 'PUT', body: body }).then(function (r) {
      if (!r.ok) { toast(r.data.error || 'Could not save', true); render(); return; }
      state.effective = r.data.effective;
      render();
      toast('Sync setting saved');
    });
  }

  function savePractice() {
    var body = { directions: {} };
    Object.keys(DIRS).forEach(function (d) {
      var c = {};
      ['allowed', 'allowAuto', 'enabled', 'auto'].forEach(function (k) { var el = $('sysp-' + k + '-' + d); if (el) c[k] = el.checked; });
      ['syncFrom', 'earliestFrom'].forEach(function (k) { var el = $('sysp-' + k + '-' + d); if (el) c[k] = el.value || null; });
      body.directions[d] = c;
    });
    var btn = $('sysp-save'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    return api('/api/sync-settings/practice', { method: 'PUT', body: body }).then(function (r) {
      if (!r.ok) { toast(r.data.error || 'Could not save', true); if (btn) { btn.disabled = false; btn.textContent = 'Save practice settings'; } return; }
      state.effective = r.data.effective;
      render();
      toast('Practice sync settings saved');
    });
  }

  function onChange(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    var m = /^sys-(on|auto|from)-(.+)$/.exec(t.id);
    if (!m) return;
    var d = m[2];
    if (m[1] === 'on') return saveMine(d, { enabled: t.checked });
    if (m[1] === 'auto') return saveMine(d, { auto: t.checked });
    if (m[1] === 'from') return saveMine(d, { syncFrom: t.value || null });
  }

  function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-clear')) return saveMine(t.getAttribute('data-clear'), { syncFrom: null });
    if (t.id === 'sysp-save') return savePractice();
    if (t.hasAttribute('data-syncnow')) return syncNow(t.getAttribute('data-syncnow'), t);
  }

  // ── Sync now: plan → preview → apply ───────────────────────────────────────

  function syncNow(cardKey, btn) {
    var card = CARDS.filter(function (c) { return c.key === cardKey; })[0];
    var runnable = card.dirs.filter(function (d) { return state.effective[d].runs; });
    if (!runnable.length) { toast('Every ' + card.title + ' direction is switched off', true); return; }
    var original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Reading…';
    var first = Promise.resolve(null);
    // Outlook: catch up on Outlook's own changes first, so the plan sees them.
    if (cardKey === 'outlook' && state.effective.outlook_to_portal.runs) {
      first = api('/api/sync-settings/outlook/pull', { method: 'POST' });
    }
    return first.then(function (pull) {
      return Promise.all(runnable.map(function (d) {
        return api('/api/sync-settings/' + d + '/plan', { method: 'POST' }).then(function (r) { return { direction: d, r: r }; });
      })).then(function (plans) {
        btn.disabled = false; btn.textContent = original;
        openPreview(card, plans, pull);
      });
    });
  }

  function itemTitle(it) {
    var x = it.local || it.remote || (it.candidates && it.candidates[0]) || {};
    var name = (it.local && it.local.title) || (it.remote && (it.remote.title || it.remote.patientName)) || 'Untitled';
    return { name: name, start: x.start };
  }

  function counterpartLabel(c) {
    var bits = [c.title || c.patientName || c.clientName || '', when(c.start)];
    if (c.serviceName) bits.push(c.serviceName);
    return bits.filter(Boolean).join(' · ');
  }

  function rowHtml(direction, it, checked) {
    var t = itemTitle(it);
    var id = 'sysi-' + direction + '-' + it.key.replace(/[^a-zA-Z0-9_-]/g, '_');
    var detail = '';
    if (it.action === 'link') detail = 'Matches: ' + esc(counterpartLabel(it.key.indexOf('local:') === 0 ? it.remote : it.local));
    if (it.action === 'review') {
      detail = '<select class="sys-choose" data-key="' + esc(it.key) + '" data-dir="' + direction + '" aria-label="What to do with this event">' +
        '<option value="">Skip for now</option>' +
        (it.candidates || []).map(function (c) { return '<option value="link:' + esc(c.id) + '">Link to ' + esc(counterpartLabel(c)) + '</option>'; }).join('') +
        '<option value="create">Copy across as a new event</option></select>';
    }
    var box = it.action === 'review' ? '<span class="sys-check-spacer"></span>'
      : '<input type="checkbox" id="' + id + '" class="sys-pick" data-key="' + esc(it.key) + '" data-dir="' + direction + '" data-action="' + it.action + '"' +
        (it.action === 'link' ? ' data-counterpart="' + esc(it.key.indexOf('local:') === 0 ? it.remote.id : it.local.id) + '"' : '') + (checked ? ' checked' : '') + '>';
    return '<li class="sys-item">' + box +
      '<label for="' + id + '"><span class="sys-item-title">' + esc(t.name) + '</span><span class="sys-item-when">' + esc(when(t.start)) + '</span>' +
      (detail ? '<span class="sys-item-detail">' + detail + '</span>' : '') + '</label></li>';
  }

  function planSection(p) {
    var d = p.direction, m = DIRS[d];
    var head = '<h3 class="sys-p-head">' + esc(m.from) + ' → ' + esc(m.to) + '</h3>';
    if (!p.r.ok) return head + '<p class="sys-p-err">' + esc(p.r.data.error || 'Could not read') + '</p>';
    var plan = p.r.data;
    var scope = plan.syncFrom ? 'From ' + day(plan.syncFrom) : 'From ' + instantDay(plan.window.from) + ' (no date set: the last 90 days)';
    var meta = '<p class="sys-p-meta">' + esc(scope) + ' to ' + esc(instantDay(plan.window.to)) + '.' +
      (plan.complete === false ? ' <strong>The other side could not be read in full — applying is disabled.</strong>' : '') + '</p>';
    if (!plan.items.length) return head + meta + '<p class="sys-p-empty">Nothing to do — both sides already agree.</p>' + queuedNote(plan);
    var defaults = {};
    (plan.defaults || []).forEach(function (x) { defaults[x.key] = true; });
    var groups = ORDER.map(function (a) {
      var list = plan.items.filter(function (i) { return i.action === a; });
      if (!list.length) return '';
      return '<div class="sys-group"><div class="sys-group-head"><span>' + esc(ACTION[a].label) + '</span><span class="n">' + list.length + '</span>' +
        '<small>' + esc(ACTION[a].help) + '</small></div><ul class="sys-list">' +
        list.map(function (it) { return rowHtml(d, it, !!defaults[it.key]); }).join('') + '</ul></div>';
    }).join('');
    return head + meta + groups + queuedNote(plan);
  }

  function queuedNote(plan) {
    if (!plan.queuedChanges) return '';
    return '<p class="sys-p-meta">' + plan.queuedChanges + ' change(s) already waiting in Sync Splose. <button type="button" class="sys-link" data-opensplose="1">Open Sync Splose</button></p>';
  }

  function openPreview(card, plans, pull) {
    closePreview();
    state.preview = { card: card, plans: plans };
    var pullNote = '';
    if (pull) {
      pullNote = pull.ok
        ? '<p class="sys-p-meta">Outlook checked: ' + (pull.data.upserted || 0) + ' updated, ' + (pull.data.removed || 0) + ' removed' + (pull.data.skippedOld ? ', ' + pull.data.skippedOld + ' older than your date left out' : '') + '.</p>'
        : '<p class="sys-p-err">Outlook could not be checked: ' + esc(pull.data.error || 'unavailable') + '</p>';
    }
    var anyItems = plans.some(function (p) { return p.r.ok && p.r.data.items.length && p.r.data.complete !== false; });
    var el = document.createElement('div');
    el.className = 'sys-modal'; el.id = 'sys-modal';
    el.innerHTML = '<div class="sys-backdrop" data-close="1"></div>' +
      '<div class="sys-dialog" role="dialog" aria-modal="true" aria-labelledby="sys-modal-title">' +
        '<div class="sys-dialog-head"><div><div class="sys-eyebrow">Sync now · ' + esc(card.title) + '</div>' +
          '<h2 id="sys-modal-title">Check before anything is written</h2></div>' +
          '<button type="button" class="sys-x" data-close="1" aria-label="Close">×</button></div>' +
        '<div class="sys-dialog-body">' + pullNote + plans.map(planSection).join('') + '</div>' +
        '<div class="sys-dialog-foot"><span class="sys-foot-count" id="sys-count"></span><span class="spacer"></span>' +
          '<button type="button" class="sys-btn" data-close="1">Cancel</button>' +
          '<button type="button" class="sys-btn primary" id="sys-apply"' + (anyItems ? '' : ' disabled') + '>Apply</button></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', onPreviewClick);
    el.addEventListener('change', updateCount);
    document.addEventListener('keydown', onKey);
    updateCount();
    var x = el.querySelector('.sys-x'); if (x) x.focus();
  }

  function onKey(e) { if (e.key === 'Escape') closePreview(); }
  function closePreview() {
    var el = $('sys-modal');
    if (el) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', onKey);
    state.preview = null;
  }

  function collect() {
    var by = {};
    var el = $('sys-modal'); if (!el) return by;
    Array.prototype.forEach.call(el.querySelectorAll('.sys-pick:checked'), function (c) {
      var d = c.getAttribute('data-dir');
      var dec = { key: c.getAttribute('data-key'), action: c.getAttribute('data-action') };
      if (dec.action === 'link') dec.counterpartId = c.getAttribute('data-counterpart');
      (by[d] = by[d] || []).push(dec);
    });
    Array.prototype.forEach.call(el.querySelectorAll('.sys-choose'), function (s) {
      if (!s.value) return;
      var d = s.getAttribute('data-dir');
      var dec = { key: s.getAttribute('data-key') };
      if (s.value === 'create') dec.action = 'create'; else { dec.action = 'link'; dec.counterpartId = s.value.slice(5); }
      (by[d] = by[d] || []).push(dec);
    });
    return by;
  }

  function updateCount() {
    var by = collect(), n = 0;
    Object.keys(by).forEach(function (d) { n += by[d].length; });
    var c = $('sys-count'); if (c) c.textContent = n ? n + ' to apply' : 'Nothing ticked';
    var b = $('sys-apply'); if (b) b.disabled = !n;
  }

  function onPreviewClick(e) {
    var t = e.target;
    if (t.getAttribute && t.getAttribute('data-close')) return closePreview();
    if (t.getAttribute && t.getAttribute('data-opensplose')) { closePreview(); if (window.SploseSync && window.SploseSync.open) window.SploseSync.open(); return; }
    if (t.id === 'sys-apply') return apply(t);
  }

  function apply(btn) {
    var by = collect();
    var dirs = Object.keys(by);
    if (!dirs.length) return;
    btn.disabled = true; btn.textContent = 'Applying…';
    // One direction at a time, in the card's order: Outlook pull-in before push-out.
    var order = state.preview.card.dirs.filter(function (d) { return by[d]; });
    var results = [];
    var chain = order.reduce(function (p, d) {
      return p.then(function () {
        return api('/api/sync-settings/' + d + '/apply', { method: 'POST', body: { decisions: by[d] } }).then(function (r) { results.push({ direction: d, r: r }); });
      });
    }, Promise.resolve());
    return chain.then(function () { showResults(results); });
  }

  function showResults(results) {
    var body = document.querySelector('#sys-modal .sys-dialog-body');
    var foot = document.querySelector('#sys-modal .sys-dialog-foot');
    if (!body) return;
    var queued = false;
    body.innerHTML = results.map(function (x) {
      var m = DIRS[x.direction];
      if (!x.r.ok) return '<h3 class="sys-p-head">' + esc(m.from) + ' → ' + esc(m.to) + '</h3><p class="sys-p-err">' + esc(x.r.data.error || 'Failed') + '</p>';
      var tally = {};
      (x.r.data.done || []).forEach(function (d) { tally[d.action] = (tally[d.action] || 0) + 1; });
      if (x.direction === 'portal_to_splose' && tally.create) queued = true;
      var parts = Object.keys(tally).map(function (a) { return tally[a] + ' ' + ({ link: 'linked', create: x.direction === 'portal_to_splose' ? 'queued for Splose' : 'copied', update: 'updated', delete: 'removed' }[a] || a); });
      var failed = (x.r.data.failed || []).length;
      return '<h3 class="sys-p-head">' + esc(m.from) + ' → ' + esc(m.to) + '</h3>' +
        '<p class="sys-p-ok">' + (parts.length ? esc(parts.join(', ')) : 'Nothing changed') + '.</p>' +
        (failed ? '<p class="sys-p-err">' + failed + ' could not be done — they have changed since the preview or were refused. Run Sync now again to see them.</p>' : '');
    }).join('') + (queued ? '<p class="sys-p-meta">New Splose bookings are queued, not sent. <button type="button" class="sys-link" data-opensplose="1">Open Sync Splose</button> to review and publish them.</p>' : '');
    if (foot) foot.innerHTML = '<span class="spacer"></span><button type="button" class="sys-btn primary" data-close="1">Done</button>';
    if (typeof window.loadEvents === 'function') { try { window.loadEvents(); } catch (_) { /* calendar refresh is a nicety */ } }
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  function init() {
    var root = $('sync-settings-root');
    if (!root || root.__sysWired) return;
    root.__sysWired = true;
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    // Load when the section is opened (the shell's showSettingsSection).
    var orig = window.showSettingsSection;
    if (typeof orig === 'function' && !orig.__sysWrapped) {
      var wrapped = function (name) { var r = orig.apply(this, arguments); if (name === 'sync-settings') load(); return r; };
      wrapped.__sysWrapped = true;
      window.showSettingsSection = wrapped;
    }
    // Already open (a reload on this section): load now.
    var section = $('settings-sync-settings');
    if (section && section.classList.contains('active')) load();
  }

  window.SyncSettings = { load: load, init: init, _state: state };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
