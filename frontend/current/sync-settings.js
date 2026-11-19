'use strict';

/**
 * SYNC SETTINGS + the Sync popup's Outlook / Portal tabs (migration 081;
 * reshaped 19 Nov 2026).
 *
 * Settings → Calendar sync: four directions, each ONE choice — Off, Sync now
 * only, or Automatic — plus a "sync events from" date when it is on:
 *   Outlook   Outlook → Portal, Portal → Outlook
 *   Splose    Splose → Portal, Portal → Splose
 * "Sync now only" means it runs when you press Sync on the Calendar.
 *
 * The Calendar's Sync button opens ONE popup (splose-sync.js owns the shell)
 * with three tabs, each listing what that system is missing:
 *   Outlook  in the portal, not in Outlook             (portal_to_outlook plan)
 *   Splose   changes waiting to be written to Splose   (splose-sync.js's queue)
 *            + in the portal, not in Splose            (portal_to_splose plan, rendered here)
 *   Portal   in Outlook / in Splose, not in the portal  (outlook_to_portal + splose_to_portal plans)
 * Tick (or Select all) and sync that tab. Nothing is written before that; the
 * server re-plans before applying, so a stale list cannot write anything
 * unexpected. Anything brought into the portal lands in "Blocks to review".
 *
 * Globals on window (no modules): window.SyncSettings. Reuses the shell's
 * escapeHtml / showToast, window.SploseSync (open / rerender / refresh) and
 * window.BlockReview.refresh.
 */
(function () {
  var DIRS = {
    outlook_to_portal: { from: 'Outlook', to: 'Portal', help: 'Events added or changed in Outlook appear in the portal.',
      modes: { manual: 'Only when you press Sync on the Calendar.', auto: 'Runs by itself as things change.' } },
    portal_to_outlook: { from: 'Portal', to: 'Outlook', help: 'Bookings and edits made in the portal are written to your Outlook calendar.',
      modes: { manual: 'Only when you press Sync on the Calendar.', auto: 'Runs by itself as things change.' } },
    splose_to_portal: { from: 'Splose', to: 'Portal', help: 'Appointments booked in Splose come into the portal, where they wait under Blocks to review.',
      modes: { manual: 'Asks about each new Splose appointment, or bring them in with Sync on the Calendar.', auto: 'New Splose appointments come in by themselves.' } },
    portal_to_splose: { from: 'Portal', to: 'Splose', help: 'Client bookings made in the portal are queued for Splose.',
      modes: { manual: 'Queued — you send them with Sync on the Calendar.', auto: 'Queued and sent by themselves after a quiet moment.' } },
  };
  var CARDS = [
    { key: 'outlook', title: 'Outlook', dirs: ['outlook_to_portal', 'portal_to_outlook'] },
    { key: 'splose', title: 'Splose', dirs: ['splose_to_portal', 'portal_to_splose'] },
  ];
  var MODES = [
    { key: 'off', label: 'Off', help: 'Nothing is copied this way.' },
    { key: 'manual', label: 'Sync now only' },
    { key: 'auto', label: 'Automatic' },
  ];
  var BLOCKED = {
    ENABLE_OUTLOOK_WRITE: 'Writing to Outlook is switched off on this server (ENABLE_OUTLOOK_WRITE), so nothing can be copied into Outlook. The practice owner turns it on in the server settings.',
    ENABLE_SPLOSE_DRAFT_SYNC: 'Splose sync is switched off on this server (ENABLE_SPLOSE_DRAFT_SYNC).',
    SPLOSE_NOT_CONNECTED: 'Splose is not connected (Settings → Integrations).',
    ENABLE_SPLOSE_WRITE: 'Writing to Splose is switched off on this server (ENABLE_SPLOSE_WRITE) — bookings queue but are not sent.',
    ENABLE_SPLOSE_AUTO_SYNC: 'Automatic sending to Splose is switched off on this server — press Sync on the Calendar to send.',
  };

  // The review: which plans feed which tab, and how rows read.
  var STATUS = {
    portal_to_outlook: { create: 'In portal · not in Outlook', update: 'Changed in portal · not in Outlook yet', delete: 'Deleted in portal · still in Outlook', link: 'In both · not joined up yet', review: 'Maybe in Outlook · pick the match' },
    outlook_to_portal: { create: 'In Outlook · not in portal', link: 'In both · not joined up yet', review: 'Maybe in portal · pick the match' },
    splose_to_portal:  { create: 'In Splose · not in portal', link: 'In both · not joined up yet', review: 'Maybe in portal · pick the match' },
    portal_to_splose:  { create: 'In portal · not in Splose', link: 'In both · not joined up yet', review: 'Maybe in Splose · pick the match' },
  };
  var GROUPS = {
    outlook: { dirs: ['portal_to_outlook'], verb: 'Sync', with: 'with Outlook', empty: 'Outlook has everything the portal has.' },
    portal: { dirs: ['outlook_to_portal', 'splose_to_portal'], verb: 'Bring', with: 'into the portal', empty: 'The portal has everything Outlook and Splose have.' },
    splose: { dirs: ['portal_to_splose'], verb: 'Queue', with: 'for Splose', empty: 'Splose has every client booking the portal has.' },
  };
  var SECTION = { portal_to_outlook: 'In the portal, not in Outlook', outlook_to_portal: 'From Outlook', splose_to_portal: 'From Splose', portal_to_splose: 'In the portal, not in Splose' };
  var ORDER = ['create', 'update', 'delete', 'review', 'link'];
  var ALL_PLAN_DIRS = ['outlook_to_portal', 'splose_to_portal', 'portal_to_outlook', 'portal_to_splose'];

  var state = { effective: null, loading: false };
  var rv = { loading: false, loadedAt: 0, pull: null, plans: {}, picks: {}, chooses: {}, applying: null, results: {} };
  var modeTimers = {};   // per direction: two quick changes must both save

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
  var modeOf = function (e) { return !e.enabled ? 'off' : (e.auto ? 'auto' : 'manual'); };

  // ── Settings page ──────────────────────────────────────────────────────────

  function loadEffective() {
    return api('/api/sync-settings').then(function (r) {
      if (r.ok) state.effective = r.data.effective;
      return r;
    });
  }

  function load() {
    var root = $('sync-settings-root');
    if (!root || state.loading) return Promise.resolve();
    state.loading = true;
    return loadEffective().then(function (r) {
      state.loading = false;
      if (!r.ok) { root.innerHTML = '<p class="sys-quiet">' + esc(r.data.error || 'Sync settings are unavailable') + '</p>'; return; }
      render();
    });
  }

  function segmented(d, mode) {
    var m = DIRS[d];
    return '<div class="sys-seg" role="radiogroup" aria-label="' + esc(m.from + ' to ' + m.to) + '">' +
      MODES.map(function (x) {
        var id = 'sys-mode-' + d + '-' + x.key;
        return '<input type="radio" name="sys-mode-' + d + '" id="' + id + '" value="' + x.key + '" data-dir="' + d + '"' + (mode === x.key ? ' checked' : '') + '>' +
          '<label for="' + id + '">' + esc(x.label) + '</label>';
      }).join('') + '</div>';
  }

  function dirRow(d) {
    var e = state.effective[d], m = DIRS[d];
    if (!e) return '';
    var mode = modeOf(e);
    var notes = [];
    if (e.blockedBy) notes.push('<span class="sys-note warn">' + esc(BLOCKED[e.blockedBy] || 'Switched off on this server.') + '</span>');
    else if (e.writeBlockedBy && mode !== 'off') notes.push('<span class="sys-note warn">' + esc(BLOCKED[e.writeBlockedBy] || '') + '</span>');
    if (!e.blockedBy && mode === 'auto' && e.autoBlockedBy) notes.push('<span class="sys-note">' + esc(BLOCKED[e.autoBlockedBy] || '') + '</span>');
    var modeHelp = mode === 'off' ? MODES[0].help : m.modes[mode];
    var fromHint = e.syncFrom ? 'Events before ' + day(e.syncFrom) + ' are left alone.' : 'All dates.';
    return '' +
      '<div class="sys-dir" data-dir="' + d + '">' +
        '<div class="sys-dir-head">' +
          '<div class="sys-dir-name"><span>' + esc(m.from) + '</span><span class="sys-arrow" aria-hidden="true">→</span><span>' + esc(m.to) + '</span></div>' +
          segmented(d, mode) +
        '</div>' +
        '<p class="sys-help">' + esc(m.help) + ' <strong>' + esc(modeHelp) + '</strong></p>' +
        (mode === 'off' ? '' :
          '<div class="sys-dir-controls">' +
            '<label class="sys-field"><span>Sync events from</span>' +
              '<span class="sys-date"><input type="date" id="sys-from-' + d + '" value="' + esc(e.user.syncFrom || '') + '">' +
              '<button type="button" class="sys-link" data-clear="' + d + '"' + (e.user.syncFrom ? '' : ' hidden') + '>All dates</button></span>' +
              '<small>' + esc(fromHint) + '</small>' +
            '</label>' +
          '</div>') +
        (notes.length ? '<div class="sys-notes">' + notes.join('') + '</div>' : '') +
      '</div>';
  }

  function render() {
    var root = $('sync-settings-root');
    if (!root || !state.effective) return;
    root.innerHTML = '' +
      '<div class="settings-group sys-card" data-card="sync-now">' +
        '<div class="settings-group-header sys-card-head"><span>Sync now</span>' +
          '<button type="button" class="sys-btn primary" id="sys-syncnow">Open Sync</button></div>' +
        '<p class="sys-help sys-pad sys-pad-b">The <strong>Sync</strong> button on the Calendar opens this too: three tabs — Outlook, Splose and Portal — each listing what that calendar is missing. Tick what you want, or Select all, and sync it. Nothing is written until you do.</p>' +
      '</div>' +
      CARDS.map(function (c) {
        return '<div class="settings-group sys-card" data-card="' + c.key + '">' +
          '<div class="settings-group-header sys-card-head"><span>' + esc(c.title) + '</span></div>' +
          c.dirs.map(dirRow).join('') +
        '</div>';
      }).join('');
  }

  function saveMine(d, change) {
    var body = { directions: {} }; body.directions[d] = change;
    var active = document.activeElement && document.activeElement.id;
    return api('/api/sync-settings', { method: 'PUT', body: body }).then(function (r) {
      if (!r.ok) toast(r.data.error || 'Could not save', true);
      else { state.effective = r.data.effective; toast('Sync setting saved'); }
      render();
      var again = active && $(active);
      if (!again && active && /^sys-mode-/.test(active)) again = document.querySelector('input[name="sys-mode-' + d + '"]:checked');
      if (again) again.focus();
    });
  }

  function onChange(ev) {
    var t = ev.target;
    if (!t) return;
    if (t.type === 'radio' && t.name && t.name.indexOf('sys-mode-') === 0) {
      var d = t.getAttribute('data-dir');
      // Arrow keys move the choice one step at a time: save once it settles.
      clearTimeout(modeTimers[d]);
      return new Promise(function (res) {
        modeTimers[d] = setTimeout(function () {
          var cur = document.querySelector('input[name="sys-mode-' + d + '"]:checked');
          var v = cur ? cur.value : t.value;
          res(v === 'off' ? saveMine(d, { enabled: false }) : saveMine(d, { enabled: true, auto: v === 'auto' }));
        }, 450);
      });
    }
    var m = t.id && /^sys-from-(.+)$/.exec(t.id);
    if (m) return saveMine(m[1], { syncFrom: t.value || null });
  }

  function onClick(ev) {
    var t = ev.target.closest ? ev.target.closest('button') : null;
    if (!t) return;
    if (t.hasAttribute('data-clear')) return saveMine(t.getAttribute('data-clear'), { syncFrom: null });
    if (t.id === 'sys-syncnow') {
      if (window.SploseSync && window.SploseSync.open) window.SploseSync.open('outlook');
      else toast('Open the Calendar and press Sync', true);
    }
  }

  // ── The review (Sync popup: Outlook tab, Portal tab, Splose tab's plan) ────

  function rerender() { if (window.SploseSync && window.SploseSync.rerender) window.SploseSync.rerender(); }

  function offReason(d, e) {
    if (!e) return 'Unavailable.';
    if (e.blockedBy) return BLOCKED[e.blockedBy] || 'Switched off on this server.';
    return DIRS[d].from + ' → ' + DIRS[d].to + ' is set to Off in Settings → Calendar sync.';
  }

  /** Read every plan afresh (writes nothing). */
  function loadReview(opts) {
    if (rv.loading) return Promise.resolve();
    rv.loading = true;
    if (opts && opts.fresh) rv.results = {};   // a banner from an earlier visit is not news
    rv.picks = {}; rv.chooses = {};
    ALL_PLAN_DIRS.forEach(function (d) { rv.plans[d] = { state: 'loading' }; });
    rerender();
    return loadEffective().then(function (r) {
      var eff = state.effective || {};
      if (!r.ok) {
        ALL_PLAN_DIRS.forEach(function (d) { rv.plans[d] = { state: 'err', error: r.data.error || 'Sync settings are unavailable' }; });
        return;
      }
      // Catch up on Outlook's own changes first, so the plans see them.
      var first = eff.outlook_to_portal && eff.outlook_to_portal.runs
        ? api('/api/sync-settings/outlook/pull', { method: 'POST' }) : Promise.resolve(null);
      return first.then(function (pull) {
        rv.pull = pull;
        return Promise.all(ALL_PLAN_DIRS.map(function (d) {
          var e = eff[d];
          if (!e || !e.runs) { rv.plans[d] = { state: 'off', error: offReason(d, e) }; return null; }
          return api('/api/sync-settings/' + d + '/plan', { method: 'POST' }).then(function (p) {
            if (!p.ok) { rv.plans[d] = { state: 'err', error: p.data.error || 'Could not be read' }; return; }
            rv.plans[d] = { state: 'ok', data: p.data };
            if (p.data.complete !== false) (p.data.defaults || []).forEach(function (x) { rv.picks[d + '|' + x.key] = true; });
          });
        }));
      });
    }).then(function () {
      rv.loading = false;
      rv.loadedAt = Date.now();
      rerender();
    });
  }

  function counterpartLabel(c) {
    var bits = [c.title || c.patientName || c.clientName || '', when(c.start)];
    if (c.serviceName) bits.push(c.serviceName);
    return bits.filter(Boolean).join(' · ');
  }
  function itemTitle(it) {
    var x = it.local || it.remote || (it.candidates && it.candidates[0]) || {};
    var name = (it.local && it.local.title) || (it.remote && (it.remote.title || it.remote.patientName)) || 'Untitled';
    return { name: name, start: x.start };
  }

  function usable(d) { var p = rv.plans[d]; return !!(p && p.state === 'ok' && p.data.complete !== false); }
  function selectable(d) {
    if (!usable(d)) return [];
    return rv.plans[d].data.items.filter(function (i) { return i.action !== 'review'; }).map(function (i) { return d + '|' + i.key; });
  }
  function pickedCount(dirs) {
    var n = 0;
    dirs.forEach(function (d) {
      selectable(d).forEach(function (k) { if (rv.picks[k]) n++; });
      if (usable(d)) Object.keys(rv.chooses).forEach(function (k) { if (k.indexOf(d + '|') === 0 && rv.chooses[k]) n++; });
    });
    return n;
  }
  function countFor(dirs) {
    return dirs.reduce(function (n, d) { return n + (usable(d) ? rv.plans[d].data.items.length : 0); }, 0);
  }

  function rowHtml(d, it) {
    var t = itemTitle(it), k = d + '|' + it.key;
    var id = 'sri-' + k.replace(/[^a-zA-Z0-9_-]/g, '_');
    var dis = usable(d) ? '' : ' disabled';
    var detail = '';
    if (it.action === 'link') detail = 'Same as: ' + esc(counterpartLabel(it.key.indexOf('local:') === 0 ? it.remote : it.local));
    if (it.action === 'review') {
      var cur = rv.chooses[k] || '';
      detail = '<select class="sys-choose" data-sr-choose="' + esc(k) + '" aria-label="What to do with this event"' + dis + '>' +
        '<option value="">Skip for now</option>' +
        (it.candidates || []).map(function (c) { var v = 'link:' + c.id; return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>Same as ' + esc(counterpartLabel(c)) + '</option>'; }).join('') +
        '<option value="create"' + (cur === 'create' ? ' selected' : '') + '>Not there — copy it across</option></select>';
    }
    var box = it.action === 'review' ? '<span class="sys-check-spacer"></span>'
      : '<input type="checkbox" id="' + id + '" class="sys-pick" data-sr-pick="' + esc(k) + '"' + (rv.picks[k] ? ' checked' : '') + dis + '>';
    return '<li class="sys-item">' + box +
      '<label for="' + id + '"><span class="sys-item-top"><span class="sys-item-title">' + esc(t.name) + '</span>' +
        '<span class="sys-status s-' + esc(it.action) + '">' + esc((STATUS[d] || {})[it.action] || it.action) + '</span></span>' +
        '<span class="sys-item-when">' + esc(when(t.start)) + '</span>' +
      (detail ? '<span class="sys-item-detail">' + detail + '</span>' : '') + '</label></li>';
  }

  function sectionHtml(d, showHead) {
    var p = rv.plans[d] || { state: 'loading' };
    var head = showHead ? '<h3 class="sys-p-head">' + esc(SECTION[d]) + '</h3>' : '';
    if (p.state === 'loading') return head + '<p class="sys-p-empty">Checking…</p>';
    if (p.state === 'off') return head + '<p class="sys-p-empty">' + esc(p.error) + '</p>';
    if (p.state === 'err') return head + '<p class="sys-p-err">' + esc(p.error) + '</p>';
    var plan = p.data;
    var scope = plan.syncFrom ? 'From ' + day(plan.syncFrom) : 'From ' + instantDay(plan.window.from) + ' (no date set: the last 90 days)';
    var meta = '<p class="sys-p-meta">' + esc(scope) + ' to ' + esc(instantDay(plan.window.to)) + '.' +
      (plan.complete === false ? ' <strong>The other side could not be read in full — this cannot be synced right now.</strong>' : '') + '</p>';
    if (!plan.items.length) return head + meta + '<p class="sys-p-empty">Nothing missing.</p>';
    var items = plan.items.slice().sort(function (a, b) { return ORDER.indexOf(a.action) - ORDER.indexOf(b.action); });
    var sel = selectable(d);
    var all = sel.length && sel.every(function (k) { return rv.picks[k]; });
    return head + meta +
      (sel.length ? '<label class="sys-selectall"><input type="checkbox" data-sr-all="' + d + '"' + (all ? ' checked' : '') + '> Select all</label>' : '') +
      '<ul class="sys-list' + (usable(d) ? '' : ' is-disabled') + '">' + items.map(function (it) { return rowHtml(d, it); }).join('') + '</ul>';
  }

  function resultHtml(group) {
    var r = rv.results[group];
    return r ? '<div class="sys-result ' + (r.err ? 'sys-p-err' : 'sys-p-ok') + '">' + r.html + '</div>' : '';
  }

  /** Paint the Outlook or Portal tab into the Sync popup's body and footer. */
  function renderTab(tab, body, foot) {
    var g = GROUPS[tab];
    if (!g) return;
    if (!rv.loadedAt && !rv.loading) { loadReview(); }
    var pull = '';
    if (tab === 'portal' && rv.pull) {
      pull = rv.pull.ok
        ? '<p class="sys-p-meta">Outlook checked just now: ' + (rv.pull.data.upserted || 0) + ' updated, ' + (rv.pull.data.removed || 0) + ' removed.</p>'
        : '<p class="sys-p-err">Outlook could not be checked: ' + esc(rv.pull.data.error || 'unavailable') + '</p>';
    }
    var intro = tab === 'outlook'
      ? '<p class="ssp-intro">What Outlook is missing from the portal. Tick what to copy across, or Select all.</p>'
      : '<p class="ssp-intro">What Outlook and Splose have that the portal does not. Anything brought in waits under <strong>Blocks to review</strong> so you can say what it is, the client and where you were before and after.</p>';
    var html = resultHtml(tab) + intro + pull + g.dirs.map(function (d) { return sectionHtml(d, g.dirs.length > 1); }).join('');
    if (!rv.loading && countFor(g.dirs) === 0 && g.dirs.every(function (d) { return rv.plans[d] && rv.plans[d].state === 'ok'; })) {
      html = resultHtml(tab) + intro + pull + '<div class="ssp-empty">' + esc(g.empty) + '</div>';
    }
    body.innerHTML = html;
    wire(body, foot);
    paintFoot(tab, foot);
  }

  function paintFoot(tab, foot) {
    var g = GROUPS[tab];
    var n = pickedCount(g.dirs);
    var sel = [];
    g.dirs.forEach(function (d) { sel = sel.concat(selectable(d)); });
    var all = sel.length && sel.every(function (k) { return rv.picks[k]; });
    var busy = rv.applying === tab;
    foot.innerHTML =
      (sel.length ? '<label class="sys-selectall sys-everything"><input type="checkbox" data-sr-tab-all="' + tab + '"' + (all ? ' checked' : '') + '> Select all</label>' : '') +
      '<span class="sys-foot-count">' + (n ? n + ' selected' : 'Nothing selected') + '</span>' +
      '<span class="ssp-spacer"></span>' +
      '<button type="button" class="btn" data-sr-reload="1"' + (rv.loading || busy ? ' disabled' : '') + '>' + (rv.loading ? 'Checking…' : 'Check again') + '</button>' +
      '<button type="button" class="btn primary" data-sr-apply="' + tab + '"' + (n && !busy && !rv.loading ? '' : ' disabled') + '>' + (busy ? 'Syncing…' : esc(g.verb + (n ? ' ' + n : '') + ' ' + g.with)) + '</button>';
  }

  /** The Splose tab's "in the portal, not in Splose" section (below the queue). */
  function renderSplosePlan(container) {
    if (!rv.loadedAt && !rv.loading) loadReview();
    var d = 'portal_to_splose';
    var n = pickedCount(GROUPS.splose.dirs);
    var busy = rv.applying === 'splose';
    container.innerHTML = '<div class="sys-splose-plan">' + resultHtml('splose') + sectionHtml(d, true) +
      (usable(d) && rv.plans[d].data.items.length
        ? '<div class="sys-inline-actions"><button type="button" class="btn primary" data-sr-apply="splose"' + (n && !busy ? '' : ' disabled') + '>' +
            (busy ? 'Queuing…' : 'Queue ' + (n || '') + ' for Splose') + '</button><small>Queued bookings then appear in the list above to send.</small></div>'
        : '') + '</div>';
    wire(container, null);
  }

  function wire(body, foot) {
    body.onchange = function (e) {
      var t = e.target;
      if (t.hasAttribute('data-sr-pick')) rv.picks[t.getAttribute('data-sr-pick')] = t.checked;
      else if (t.hasAttribute('data-sr-choose')) rv.chooses[t.getAttribute('data-sr-choose')] = t.value;
      else if (t.hasAttribute('data-sr-all')) selectable(t.getAttribute('data-sr-all')).forEach(function (k) { rv.picks[k] = t.checked; });
      else return;
      rerender();
    };
    if (!foot) {
      body.onclick = function (e) {
        var b = e.target.closest && e.target.closest('[data-sr-apply]');
        if (b) apply(b.getAttribute('data-sr-apply'));
      };
      return;
    }
    body.onclick = null;
    foot.onchange = function (e) {
      var t = e.target;
      if (!t.hasAttribute('data-sr-tab-all')) return;
      GROUPS[t.getAttribute('data-sr-tab-all')].dirs.forEach(function (d) { selectable(d).forEach(function (k) { rv.picks[k] = t.checked; }); });
      rerender();
    };
    foot.onclick = function (e) {
      var b = e.target.closest && e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-sr-reload')) { rv.results = {}; loadReview(); }
      else if (b.hasAttribute('data-sr-apply')) apply(b.getAttribute('data-sr-apply'));
    };
  }

  function decisionsFor(d) {
    var out = [];
    if (!usable(d)) return out;
    rv.plans[d].data.items.forEach(function (it) {
      var k = d + '|' + it.key;
      if (it.action === 'review') {
        var c = rv.chooses[k];
        if (!c) return;
        out.push(c === 'create' ? { key: it.key, action: 'create' } : { key: it.key, action: 'link', counterpartId: c.slice(5) });
        return;
      }
      if (!rv.picks[k]) return;
      var dec = { key: it.key, action: it.action };
      if (it.action === 'link') dec.counterpartId = it.key.indexOf('local:') === 0 ? it.remote.id : it.local.id;
      out.push(dec);
    });
    return out;
  }

  function apply(tab) {
    var g = GROUPS[tab];
    if (!g || rv.applying) return;
    var work = g.dirs.map(function (d) { return { d: d, decisions: decisionsFor(d) }; }).filter(function (x) { return x.decisions.length; });
    if (!work.length) return;
    rv.applying = tab;
    rerender();
    var lines = [], anyErr = false, broughtIn = 0, queued = 0;
    var chain = work.reduce(function (p, x) {
      return p.then(function () {
        return api('/api/sync-settings/' + x.d + '/apply', { method: 'POST', body: { decisions: x.decisions } }).then(function (r) {
          var label = SECTION[x.d];
          if (!r.ok) { anyErr = true; lines.push(esc(label) + ': ' + esc(r.data.error || 'failed')); return; }
          var tally = {};
          (r.data.done || []).forEach(function (dn) { tally[dn.action] = (tally[dn.action] || 0) + 1; });
          if (/_to_portal$/.test(x.d)) broughtIn += tally.create || 0;
          if (x.d === 'portal_to_splose') queued += tally.create || 0;
          var verb = { link: 'joined up', create: x.d === 'portal_to_splose' ? 'queued for Splose' : (/_to_portal$/.test(x.d) ? 'brought into the portal' : 'copied to Outlook'), update: 'updated', delete: 'removed' };
          var parts = Object.keys(tally).map(function (a) { return tally[a] + ' ' + (verb[a] || a); });
          var failed = (r.data.failed || []).length;
          if (failed) anyErr = true;
          lines.push(esc(label) + ': ' + esc(parts.length ? parts.join(', ') : 'nothing changed') + (failed ? ' — ' + failed + ' could not be done (changed since the check, or refused)' : ''));
        });
      });
    }, Promise.resolve());
    return chain.then(function () {
      rv.applying = null;
      var extra = broughtIn ? '<br>' + broughtIn + ' brought in — check them under <strong>Blocks to review</strong> on the Calendar.' : '';
      if (queued) extra += '<br>' + queued + ' queued — they are listed above to send to Splose.';
      rv.results[tab] = { err: anyErr, html: lines.join('<br>') + extra };
      if (typeof window.loadOutlookEventsToCalendar === 'function') { try { window.loadOutlookEventsToCalendar(); } catch (_) { /* best effort */ } }
      if (window.BlockReview && window.BlockReview.refresh) window.BlockReview.refresh();
      if (window.SploseSync && window.SploseSync.refresh) window.SploseSync.refresh();
      return loadReview().then(function () {
        // The re-render replaced the button that had focus: put focus on the tab.
        var t = document.getElementById('ssp-tab-' + tab);
        if (t && !(document.activeElement && document.activeElement.closest && document.activeElement.closest('#splose-sync-panel'))) t.focus();
      });
    });
  }

  /** Counts for the popup's tab badges (null while unknown). */
  function tabCount(tab) {
    var g = GROUPS[tab];
    if (!g || rv.loading || !rv.loadedAt) return null;
    var states = g.dirs.map(function (d) { return rv.plans[d] ? rv.plans[d].state : 'err'; });
    if (states.every(function (x) { return x === 'off'; })) return '–';
    if (!g.dirs.some(usable)) return '!';   // could not be read — not "nothing missing"
    return countFor(g.dirs);
  }

  // ── Wiring ─────────────────────────────────────────────────────────────────

  function init() {
    var root = $('sync-settings-root');
    if (!root || root.__sysWired) return;
    root.__sysWired = true;
    root.addEventListener('change', onChange);
    root.addEventListener('click', onClick);
    var orig = window.showSettingsSection;
    if (typeof orig === 'function' && !orig.__sysWrapped) {
      var wrapped = function (name) { var r = orig.apply(this, arguments); if (name === 'sync-settings') load(); return r; };
      wrapped.__sysWrapped = true;
      window.showSettingsSection = wrapped;
    }
    var section = $('settings-sync-settings');
    if (section && section.classList.contains('active')) load();
  }

  window.SyncSettings = {
    load: load, init: init, _state: state, _rv: rv,
    review: { load: loadReview, renderTab: renderTab, renderSplosePlan: renderSplosePlan, count: tabCount, isLoading: function () { return rv.loading; } },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
