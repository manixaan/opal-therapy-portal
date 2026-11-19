'use strict';

/**
 * SYNC SETTINGS — Settings → Integrations → Calendar sync (migration 081,
 * simplified 19 Nov 2026).
 *
 * Two settings only, Portal → Outlook and Outlook → Portal. Each has ONE
 * choice — Off, Sync now only, or Automatic — and, when it is on, a "sync
 * events from" date (anything earlier is left alone; clear it for all dates).
 * Choices save as they are made. Splose is not a setting: portal client
 * bookings always queue for Sync Splose, and Splose appointments are not
 * brought into the portal.
 *
 * "Sync now" opens one review across three tabs, each listing what that
 * system is missing:
 *   Outlook  — in the portal, not in Outlook   (portal_to_outlook plan)
 *   Splose   — in the portal, not in Splose    (portal_to_splose plan; queued, never sent here)
 *   Portal   — in Outlook, not in the portal   (outlook_to_portal plan)
 * Tick (or Select all) and press Sync selected: every tab is applied in one
 * go, Outlook → portal first. Nothing is written until then, and the server
 * re-plans before applying, so a stale review cannot write anything unexpected.
 *
 * Globals on window (no modules): window.SyncSettings. Reuses the shell's
 * escapeHtml / showToast and window.SploseSync.open.
 */
(function () {
  var DIRS = {
    portal_to_outlook: { from: 'Portal', to: 'Outlook', help: 'Bookings and edits made in the portal are written to your Outlook calendar.' },
    outlook_to_portal: { from: 'Outlook', to: 'Portal', help: 'Events added or changed in Outlook appear in the portal.' },
  };
  var SETTABLE = ['outlook_to_portal', 'portal_to_outlook'];
  var MODES = [
    { key: 'off', label: 'Off', help: 'Nothing is copied this way.' },
    { key: 'manual', label: 'Sync now only', help: 'Only when you press Sync now.' },
    { key: 'auto', label: 'Automatic', help: 'Runs by itself as things change.' },
  ];
  // The three review tabs: which plan feeds each, and how its rows read.
  var TABS = [
    { key: 'outlook', title: 'Outlook', dir: 'portal_to_outlook', empty: 'Outlook has everything the portal has.',
      status: { create: 'In portal · not in Outlook', update: 'Changed in portal · not in Outlook yet', delete: 'Deleted in portal · still in Outlook',
                link: 'In both · not joined up yet', review: 'Maybe in Outlook · pick the match' } },
    { key: 'splose', title: 'Splose', dir: 'portal_to_splose', empty: 'Splose has every client booking the portal has.',
      status: { create: 'In portal · not in Splose', link: 'In both · not joined up yet', review: 'Maybe in Splose · pick the match' } },
    { key: 'portal', title: 'Portal', dir: 'outlook_to_portal', empty: 'The portal has everything Outlook has.',
      status: { create: 'In Outlook · not in portal', link: 'In both · not joined up yet', review: 'Maybe in portal · pick the match' } },
  ];
  // Applied in this order: bring Outlook in first, then push out.
  var APPLY_ORDER = ['outlook_to_portal', 'portal_to_outlook', 'portal_to_splose'];
  var BLOCKED = {
    ENABLE_OUTLOOK_WRITE: 'Writing to Outlook is switched off on this server (ENABLE_OUTLOOK_WRITE), so nothing can be copied into Outlook. The practice owner turns it on in the server settings.',
    ENABLE_SPLOSE_DRAFT_SYNC: 'Splose sync is switched off on this server (ENABLE_SPLOSE_DRAFT_SYNC).',
    SPLOSE_NOT_CONNECTED: 'Splose is not connected (Settings → Integrations).',
    ENABLE_SPLOSE_WRITE: 'Writing to Splose is switched off on this server (ENABLE_SPLOSE_WRITE) — bookings queue in Sync Splose but are not sent.',
  };
  var ORDER = ['create', 'update', 'delete', 'review', 'link'];

  var state = { effective: null, loading: false, preview: null };
  var modeTimer = null;

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

  // ── Load + render the settings ─────────────────────────────────────────────

  function load() {
    var root = $('sync-settings-root');
    if (!root || state.loading) return Promise.resolve();
    state.loading = true;
    return api('/api/sync-settings').then(function (r) {
      state.loading = false;
      if (!r.ok) { root.innerHTML = '<p class="sys-quiet">' + esc(r.data.error || 'Sync settings are unavailable') + '</p>'; return; }
      state.effective = r.data.effective;
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
    var mode = modeOf(e);
    var notes = [];
    if (e.blockedBy) notes.push('<span class="sys-note warn">' + esc(BLOCKED[e.blockedBy] || 'Switched off on this server.') + '</span>');
    var modeHelp = MODES.filter(function (x) { return x.key === mode; })[0].help;
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

  function sploseNote() {
    var e = state.effective.portal_to_splose || {};
    var bits = ['Client bookings made in the portal queue for Splose — review and send them with Sync Splose on the Calendar. Appointments made in Splose are not brought into the portal.'];
    var note = '';
    if (e.blockedBy) note = BLOCKED[e.blockedBy] || '';
    else if (e.writeBlockedBy) note = BLOCKED[e.writeBlockedBy] || '';
    return '<p class="sys-help sys-pad">' + esc(bits[0]) + '</p>' +
      (note ? '<div class="sys-notes sys-pad-x"><span class="sys-note warn">' + esc(note) + '</span></div>' : '');
  }

  function render() {
    var root = $('sync-settings-root');
    if (!root || !state.effective) return;
    root.innerHTML = '' +
      '<div class="settings-group sys-card" data-card="sync-now">' +
        '<div class="settings-group-header sys-card-head"><span>Bring everything in line</span>' +
          '<button type="button" class="sys-btn primary" id="sys-syncnow">Sync now</button></div>' +
        '<p class="sys-help sys-pad sys-pad-b">Checks Outlook, Splose and the portal side by side and lists what each one is missing. Tick what you want — or Select all — and sync it in one go. Nothing is written until you press Sync selected.</p>' +
      '</div>' +
      '<div class="settings-group sys-card" data-card="outlook">' +
        '<div class="settings-group-header sys-card-head"><span>Outlook</span></div>' +
        SETTABLE.map(dirRow).join('') +
      '</div>' +
      '<div class="settings-group sys-card" data-card="splose">' +
        '<div class="settings-group-header sys-card-head"><span>Splose</span></div>' +
        sploseNote() +
      '</div>';
  }

  // ── Saving ─────────────────────────────────────────────────────────────────

  function saveMine(d, change) {
    var body = { directions: {} }; body.directions[d] = change;
    var active = document.activeElement && document.activeElement.id;
    return api('/api/sync-settings', { method: 'PUT', body: body }).then(function (r) {
      if (!r.ok) toast(r.data.error || 'Could not save', true);
      else { state.effective = r.data.effective; toast('Sync setting saved'); }
      render();
      // Put focus back where it was (the re-render replaced the element).
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
      clearTimeout(modeTimer);
      return new Promise(function (res) {
        modeTimer = setTimeout(function () {
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
    if (t.id === 'sys-syncnow') return syncNow(t);
  }

  // ── Sync now: plan all three → one tabbed review → apply ───────────────────

  function syncNow(btn) {
    var original = btn.textContent;
    btn.disabled = true; btn.textContent = 'Checking…';
    var eff = state.effective;
    // Catch up on Outlook's own changes first, so the plans see them.
    var first = eff.outlook_to_portal && eff.outlook_to_portal.runs
      ? api('/api/sync-settings/outlook/pull', { method: 'POST' }) : Promise.resolve(null);
    return first.then(function (pull) {
      return Promise.all(TABS.map(function (tab) {
        var e = eff[tab.dir] || {};
        if (!e.runs) return Promise.resolve({ tab: tab, off: offReason(tab.dir, e) });
        return api('/api/sync-settings/' + tab.dir + '/plan', { method: 'POST' }).then(function (r) { return { tab: tab, r: r }; });
      })).then(function (plans) {
        btn.disabled = false; btn.textContent = original;
        openPreview(plans, pull);
      });
    });
  }

  function offReason(d, e) {
    if (e.blockedBy) return BLOCKED[e.blockedBy] || 'Switched off on this server.';
    if (DIRS[d]) return DIRS[d].from + ' → ' + DIRS[d].to + ' is set to Off. Turn it on below to sync this way.';
    return 'Switched off.';
  }

  function counterpartLabel(c) {
    var bits = [c.title || c.patientName || c.clientName || '', when(c.start)];
    if (c.serviceName) bits.push(c.serviceName);
    return bits.filter(Boolean).join(' · ');
  }

  function itemTitle(it) {
    var x = it.local || it.remote || (it.candidates && it.candidates[0]) || {};
    var name = (it.local && (it.local.clientName || it.local.title)) || (it.remote && (it.remote.title || it.remote.patientName)) || 'Untitled';
    if (it.local && it.local.clientName && it.local.title && it.local.title !== it.local.clientName) name = it.local.title;
    return { name: name, start: x.start };
  }

  function rowHtml(tab, it, checked, disabled) {
    var d = tab.dir, t = itemTitle(it);
    var dis = disabled ? ' disabled' : '';
    var id = 'sysi-' + d + '-' + it.key.replace(/[^a-zA-Z0-9_-]/g, '_');
    var detail = '';
    if (it.action === 'link') detail = 'Same as: ' + esc(counterpartLabel(it.key.indexOf('local:') === 0 ? it.remote : it.local));
    if (it.action === 'review') {
      detail = '<select class="sys-choose" data-key="' + esc(it.key) + '" data-dir="' + d + '" aria-label="What to do with this event"' + dis + '>' +
        '<option value="">Skip for now</option>' +
        (it.candidates || []).map(function (c) { return '<option value="link:' + esc(c.id) + '">Same as ' + esc(counterpartLabel(c)) + '</option>'; }).join('') +
        '<option value="create">Not there — copy it across</option></select>';
    }
    var box = it.action === 'review' ? '<span class="sys-check-spacer"></span>'
      : '<input type="checkbox" id="' + id + '" class="sys-pick" data-key="' + esc(it.key) + '" data-dir="' + d + '" data-action="' + it.action + '"' +
        (it.action === 'link' ? ' data-counterpart="' + esc(it.key.indexOf('local:') === 0 ? it.remote.id : it.local.id) + '"' : '') + (checked ? ' checked' : '') + dis + '>';
    return '<li class="sys-item">' + box +
      '<label for="' + id + '"><span class="sys-item-top"><span class="sys-item-title">' + esc(t.name) + '</span>' +
        '<span class="sys-status s-' + it.action + '">' + esc(tab.status[it.action] || it.action) + '</span></span>' +
        '<span class="sys-item-when">' + esc(when(t.start)) + '</span>' +
      (detail ? '<span class="sys-item-detail">' + detail + '</span>' : '') + '</label></li>';
  }

  /** Count of rows a tab offers (for the tab badge). */
  function tabCount(p) { return p.r && p.r.ok && p.r.data.complete !== false ? p.r.data.items.length : 0; }
  function tabBadge(p) {
    if (p.off) return '–';
    if (!p.r.ok || p.r.data.complete === false) return '!';
    return String(tabCount(p));
  }

  function tabPanel(p) {
    var tab = p.tab;
    if (p.off) return '<p class="sys-p-empty">' + esc(p.off) + '</p>';
    if (!p.r.ok) return '<p class="sys-p-err">' + esc(p.r.data.error || 'Could not read') + '</p>';
    var plan = p.r.data;
    var scope = plan.syncFrom ? 'From ' + day(plan.syncFrom) : 'From ' + instantDay(plan.window.from) + ' (no date set: the last 90 days)';
    var meta = '<p class="sys-p-meta">' + esc(scope) + ' to ' + esc(instantDay(plan.window.to)) + '.' +
      (plan.complete === false ? ' <strong>' + esc(tab.title) + ' could not be read in full — this tab cannot be synced right now.</strong>' : '') + '</p>';
    var queued = tab.dir === 'portal_to_splose' && plan.queuedChanges
      ? '<p class="sys-p-meta">' + plan.queuedChanges + ' change(s) already waiting in Sync Splose. <button type="button" class="sys-link" data-opensplose="1">Open Sync Splose</button></p>' : '';
    if (!plan.items.length) return meta + '<p class="sys-p-empty">' + esc(tab.empty) + '</p>' + queued;
    var defaults = {};
    (plan.defaults || []).forEach(function (x) { defaults[x.key] = true; });
    var items = plan.items.slice().sort(function (a, b) { return ORDER.indexOf(a.action) - ORDER.indexOf(b.action); });
    var disabled = plan.complete === false;
    var selectable = items.filter(function (i) { return i.action !== 'review'; }).length;
    return meta +
      (selectable && !disabled ? '<label class="sys-selectall"><input type="checkbox" class="sys-all" data-dir="' + tab.dir + '"> Select all in ' + esc(tab.title) + '</label>' : '') +
      '<ul class="sys-list' + (disabled ? ' is-disabled' : '') + '">' + items.map(function (it) { return rowHtml(tab, it, !disabled && !!defaults[it.key], disabled); }).join('') + '</ul>' +
      (tab.dir === 'portal_to_splose' ? '<p class="sys-p-meta">Splose bookings are queued, not sent — you review and send them in Sync Splose.</p>' : '') + queued;
  }

  function openPreview(plans, pull) {
    closePreview();
    state.preview = { plans: plans, active: (plans.filter(function (p) { return tabCount(p); })[0] || plans[0]).tab.key };
    var pullNote = '';
    if (pull) {
      pullNote = pull.ok
        ? '<p class="sys-p-meta">Outlook checked: ' + (pull.data.upserted || 0) + ' updated, ' + (pull.data.removed || 0) + ' removed' + (pull.data.skippedOld ? ', ' + pull.data.skippedOld + ' older than your date left out' : '') + '.</p>'
        : '<p class="sys-p-err">Outlook could not be checked: ' + esc(pull.data.error || 'unavailable') + '</p>';
    }
    var tabs = plans.map(function (p) {
      var n = tabCount(p);
      return '<button type="button" role="tab" class="sys-tab" id="sys-tab-' + p.tab.key + '" data-tab="' + p.tab.key + '" aria-controls="sys-panel-' + p.tab.key + '">' +
        esc(p.tab.title) + '<span class="n' + (n ? ' has' : '') + '" title="' + (p.off ? 'Switched off' : (!p.r.ok ? 'Could not be read' : (p.r.data.complete === false ? 'Not read in full' : n + ' to sync'))) + '">' + tabBadge(p) + '</span></button>';
    }).join('');
    var panels = plans.map(function (p) {
      return '<div role="tabpanel" class="sys-panel" id="sys-panel-' + p.tab.key + '" aria-labelledby="sys-tab-' + p.tab.key + '" data-panel="' + p.tab.key + '">' + tabPanel(p) + '</div>';
    }).join('');
    var el = document.createElement('div');
    el.className = 'sys-modal'; el.id = 'sys-modal';
    el.innerHTML = '<div class="sys-backdrop" data-close="1"></div>' +
      '<div class="sys-dialog" role="dialog" aria-modal="true" aria-labelledby="sys-modal-title">' +
        '<div class="sys-dialog-head"><div><div class="sys-eyebrow">Sync now</div>' +
          '<h2 id="sys-modal-title">What each calendar is missing</h2></div>' +
          '<button type="button" class="sys-x" data-close="1" aria-label="Close">×</button></div>' +
        '<div class="sys-tabs" role="tablist">' + tabs + '</div>' +
        '<div class="sys-dialog-body">' + pullNote + panels + '</div>' +
        '<div class="sys-dialog-foot"><label class="sys-selectall sys-everything"><input type="checkbox" id="sys-all-everything"> Select everything</label>' +
          '<span class="sys-foot-count" id="sys-count"></span><span class="spacer"></span>' +
          '<button type="button" class="sys-btn" data-close="1">Cancel</button>' +
          '<button type="button" class="sys-btn primary" id="sys-apply" disabled>Sync selected</button></div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', onPreviewClick);
    el.addEventListener('change', onPreviewChange);
    el.addEventListener('keydown', onTabKey);
    document.addEventListener('keydown', onKey);
    showTab(state.preview.active);
    updateCount();
    var x = el.querySelector('.sys-x'); if (x) x.focus();
  }

  function showTab(key) {
    var el = $('sys-modal'); if (!el) return;
    state.preview.active = key;
    Array.prototype.forEach.call(el.querySelectorAll('.sys-tab'), function (b) {
      var on = b.getAttribute('data-tab') === key;
      b.classList.toggle('active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1;
    });
    Array.prototype.forEach.call(el.querySelectorAll('.sys-panel'), function (p) { p.hidden = p.getAttribute('data-panel') !== key; });
  }

  function onTabKey(e) {
    if (!e.target.classList || !e.target.classList.contains('sys-tab')) return;
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var keys = TABS.map(function (t) { return t.key; });
    var i = keys.indexOf(state.preview.active) + (e.key === 'ArrowRight' ? 1 : -1);
    var next = keys[(i + keys.length) % keys.length];
    showTab(next); var b = $('sys-tab-' + next); if (b) b.focus();
    e.preventDefault();
  }

  function onKey(e) { if (e.key === 'Escape' && !(state.preview && state.preview.applying)) closePreview(); }
  function closePreview() {
    if (state.preview && state.preview.applying) return; // results would be lost
    var el = $('sys-modal');
    if (el) el.parentNode.removeChild(el);
    document.removeEventListener('keydown', onKey);
    state.preview = null;
    var b = $('sys-syncnow'); if (b) b.focus();
  }

  function picks(scope) {
    var el = $('sys-modal'); if (!el) return [];
    return Array.prototype.slice.call(el.querySelectorAll('.sys-list:not(.is-disabled) .sys-pick' + (scope ? '[data-dir="' + scope + '"]' : '')));
  }

  function collect() {
    var by = {};
    var el = $('sys-modal'); if (!el) return by;
    picks().forEach(function (c) {
      if (!c.checked) return;
      var d = c.getAttribute('data-dir');
      var dec = { key: c.getAttribute('data-key'), action: c.getAttribute('data-action') };
      if (dec.action === 'link') dec.counterpartId = c.getAttribute('data-counterpart');
      (by[d] = by[d] || []).push(dec);
    });
    Array.prototype.forEach.call(el.querySelectorAll('.sys-list:not(.is-disabled) .sys-choose'), function (s) {
      if (!s.value) return;
      var d = s.getAttribute('data-dir');
      var dec = { key: s.getAttribute('data-key') };
      if (s.value === 'create') dec.action = 'create'; else { dec.action = 'link'; dec.counterpartId = s.value.slice(5); }
      (by[d] = by[d] || []).push(dec);
    });
    return by;
  }

  function syncAllBoxes() {
    var el = $('sys-modal'); if (!el) return;
    Array.prototype.forEach.call(el.querySelectorAll('.sys-all'), function (a) {
      var list = picks(a.getAttribute('data-dir'));
      var n = list.filter(function (c) { return c.checked; }).length;
      a.checked = !!list.length && n === list.length; a.indeterminate = n > 0 && n < list.length;
    });
    var every = $('sys-all-everything'), all = picks();
    if (every) {
      var n2 = all.filter(function (c) { return c.checked; }).length;
      every.disabled = !all.length;
      every.checked = !!all.length && n2 === all.length; every.indeterminate = n2 > 0 && n2 < all.length;
    }
  }

  function updateCount() {
    var by = collect(), n = 0, tabs = 0;
    Object.keys(by).forEach(function (d) { n += by[d].length; tabs++; });
    var c = $('sys-count'); if (c) c.textContent = n ? n + ' selected' + (tabs > 1 ? ' across ' + tabs + ' tabs' : '') : 'Nothing selected';
    var b = $('sys-apply'); if (b) b.disabled = !n;
    syncAllBoxes();
  }

  function onPreviewChange(e) {
    var t = e.target;
    if (t.classList && t.classList.contains('sys-all')) picks(t.getAttribute('data-dir')).forEach(function (c) { c.checked = t.checked; });
    if (t.id === 'sys-all-everything') picks().forEach(function (c) { c.checked = t.checked; });
    updateCount();
  }

  function onPreviewClick(e) {
    var t = e.target.closest ? (e.target.closest('[data-close],[data-opensplose],[data-tab],#sys-apply') || e.target) : e.target;
    if (t.getAttribute && t.getAttribute('data-close')) return closePreview();
    if (t.getAttribute && t.getAttribute('data-opensplose')) { closePreview(); if (window.SploseSync && window.SploseSync.open) window.SploseSync.open(); return; }
    if (t.getAttribute && t.getAttribute('data-tab')) return showTab(t.getAttribute('data-tab'));
    if (t.id === 'sys-apply') return apply(t);
  }

  function apply(btn) {
    var by = collect();
    var order = APPLY_ORDER.filter(function (d) { return by[d]; });
    if (!order.length) return;
    btn.disabled = true; btn.textContent = 'Syncing…';
    state.preview.applying = true;
    var results = [];
    var chain = order.reduce(function (p, d) {
      return p.then(function () {
        return api('/api/sync-settings/' + d + '/apply', { method: 'POST', body: { decisions: by[d] } }).then(function (r) { results.push({ direction: d, r: r }); });
      });
    }, Promise.resolve());
    return chain.then(function () { if (state.preview) state.preview.applying = false; showResults(results); });
  }

  function showResults(results) {
    var body = document.querySelector('#sys-modal .sys-dialog-body');
    var foot = document.querySelector('#sys-modal .sys-dialog-foot');
    var tabsEl = document.querySelector('#sys-modal .sys-tabs');
    if (!body) return;
    if (tabsEl) tabsEl.hidden = true;
    var queued = false;
    body.innerHTML = results.map(function (x) {
      var tab = TABS.filter(function (t) { return t.dir === x.direction; })[0];
      var head = '<h3 class="sys-p-head">' + esc(tab.title) + '</h3>';
      if (!x.r.ok) return head + '<p class="sys-p-err">' + esc(x.r.data.error || 'Failed') + '</p>';
      var tally = {};
      (x.r.data.done || []).forEach(function (d) { tally[d.action] = (tally[d.action] || 0) + 1; });
      if (x.direction === 'portal_to_splose' && tally.create) queued = true;
      var verb = { link: 'joined up', create: x.direction === 'portal_to_splose' ? 'queued for Splose' : (x.direction === 'outlook_to_portal' ? 'brought into the portal' : 'copied to Outlook'), update: 'updated', delete: 'removed' };
      var parts = Object.keys(tally).map(function (a) { return tally[a] + ' ' + (verb[a] || a); });
      var failed = (x.r.data.failed || []).length;
      return head + '<p class="sys-p-ok">' + (parts.length ? esc(parts.join(', ')) : 'Nothing changed') + '.</p>' +
        (failed ? '<p class="sys-p-err">' + failed + ' could not be done — they changed since the check or were refused. Run Sync now again to see them.</p>' : '');
    }).join('') + (queued ? '<p class="sys-p-meta">New Splose bookings are queued, not sent. <button type="button" class="sys-link" data-opensplose="1">Open Sync Splose</button> to review and send them.</p>' : '');
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
