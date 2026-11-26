/**
 * Opal Assist — the Client file panel. No framework.
 *
 * In a client chat, "Client file" opens a panel with what the portal knows
 * about this client: the Splose case(s), the session history, and the
 * practitioner's own case notes from the portal and Opa, searchable. The
 * practitioner TICKS what the AI should see; Attach adds it to the message
 * as ordinary attachments, so it is checked for names (and shown in the
 * "will be hidden" review) exactly like a file they had attached.
 *
 * Nothing is sent to the AI from here, and the AI cannot open the file by
 * itself: it sees only what was ticked. Notes written directly in Splose are
 * not here (Splose's API does not expose them) — the panel says so.
 *
 * Pure formatters are exported for node tests; open() needs a document.
 */
(function (global) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** "24 Nov 2026" — Splose's "YYYY-MM-DD HH:MM:SS" read as a calendar date; a timestamp in Perth time. */
  function fmtDate(v) {
    if (!v) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(String(v));
    if (m && String(v).indexOf('Z') < 0) return (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1];
    var d = new Date(v);
    if (isNaN(d)) return '';
    try { return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Perth' }); } catch (e) { return d.toDateString(); }
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-AU', { maximumFractionDigits: 2 }); }

  function casesText(cases) {
    if (!cases || !cases.length) return '';
    return cases.map(function (c) {
      var lines = ['Splose case' + (c.number ? ' ' + c.number : '') + (c.open ? ' (open)' : ' (closed)')];
      var dates = [c.issued ? 'issued ' + fmtDate(c.issued) : '', c.expires ? 'expires ' + fmtDate(c.expires) : ''].filter(Boolean).join(' · ');
      if (dates) lines.push('- ' + dates.charAt(0).toUpperCase() + dates.slice(1));
      if (c.track === 'Budget' && c.budget != null) lines.push('- Tracked by budget: ' + money(c.budget));
      else if (c.track === 'Hours' && c.hours != null) lines.push('- Tracked by hours: ' + c.hours + ' hours');
      else if (c.track) lines.push('- Tracked by ' + String(c.track).toLowerCase());
      if (c.appointments != null) lines.push('- Appointments on the case: ' + c.appointments);
      if (c.note) lines.push('- Case note: ' + c.note);
      return lines.join('\n');
    }).join('\n\n');
  }

  function sessionsText(s) {
    if (!s || (!s.past.length && !s.next.length)) return '';
    var line = function (x) { return '- ' + fmtDate(x.start) + (x.title ? ' — ' + x.title : '') + (x.cancelled ? ' (cancelled)' : ''); };
    var out = [];
    if (s.past.length) out.push('Recent sessions (newest first):\n' + s.past.map(line).join('\n'));
    if (s.next.length) out.push('Upcoming sessions:\n' + s.next.map(line).join('\n'));
    return out.join('\n\n');
  }

  function noteHeading(n) {
    return 'Case note — ' + fmtDate(n.date) + (n.title ? ' — ' + n.title : '') + (n.review === 'approved' ? '' : ' (not yet reviewed)');
  }
  /** Notes oldest first, so the AI reads them as a timeline. */
  function notesText(notes) {
    return notes.slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); })
      .map(function (n) { return noteHeading(n) + '\n' + n.text + (n.cut ? '\n[note shortened]' : ''); }).join('\n\n');
  }

  /** A short preview: around the first search word if there is one, else the opening. */
  function snippet(text, query, len) {
    len = len || 200;
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    var words = String(query || '').toLowerCase().replace(/["()]/g, ' ').split(/\s+/)
      .filter(function (w) { return w && w !== 'or' && w.charAt(0) !== '-'; });
    var lower = t.toLowerCase(); var at = -1;
    for (var i = 0; i < words.length && at < 0; i++) { var stem = words[i].slice(0, Math.max(4, words[i].length - 2)); at = lower.indexOf(stem); }
    if (at < 0 || t.length <= len) return t.length > len ? t.slice(0, len) + '…' : t;
    var start = Math.max(0, at - Math.round(len / 3));
    return (start ? '…' : '') + t.slice(start, start + len) + (start + len < t.length ? '…' : '');
  }

  var api = { fmtDate: fmtDate, casesText: casesText, sessionsText: sessionsText, notesText: notesText, noteHeading: noteHeading, snippet: snippet };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) { global.OpalAssistClientFile = api; return; }

  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  /**
   * Open the panel. opts: { client: {ref, name}, api(path) → Promise<Response>, composer }.
   */
  function open(opts) {
    close();
    var P = { client: opts.client, picked: {}, caseOn: true, sessionsOn: false, data: null, notes: [], query: '', timer: null, seq: 0 };
    var el = document.createElement('div');
    el.className = 'oa-cf-backdrop'; el.id = 'oa-cf';
    el.innerHTML = '<div class="oa-cf" role="dialog" aria-modal="true" aria-labelledby="oa-cf-title">'
      + '<div class="oa-cf-head"><h2 id="oa-cf-title">Client file <span>' + esc(P.client.name || '') + '</span></h2>'
      + '<button type="button" class="oa-btn ghost sm" data-cf="close" aria-label="Close">×</button></div>'
      + '<p class="oa-cf-lede">Tick what Opal Assist should read. Only what you tick is attached, and names are hidden before anything is sent.</p>'
      + '<div class="oa-cf-body" id="oa-cf-body"><div class="oa-cf-empty">Loading…</div></div>'
      + '<div class="oa-cf-foot"><span id="oa-cf-count"></span><button type="button" class="oa-btn sm" id="oa-cf-attach" data-cf="attach" disabled>Attach</button></div>'
      + '</div>';
    document.body.appendChild(el);
    var body = el.querySelector('#oa-cf-body');

    function load(query) {
      var seq = ++P.seq;
      var path = '/api/assist/client-file?client=' + encodeURIComponent(P.client.ref) + (query ? '&q=' + encodeURIComponent(query) : '');
      return opts.api(path).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.answer || j.message || 'The client file could not be loaded just now.'); return j; });
      }).then(function (j) {
        if (seq !== P.seq) return;
        if (!query) P.data = j;
        P.notes = j.notes || []; P.query = j.query || ''; P.more = !!j.moreNotes;
        render();
      }, function (err) {
        if (seq !== P.seq) return;
        if (!P.data) body.innerHTML = '<div class="oa-cf-empty bad">' + esc(err.message) + '</div>';
        else { P.notes = []; P.searchError = err.message; render(); }
      });
    }

    function selectedParts() {
      var parts = [];
      var d = P.data || {};
      if (P.caseOn && d.cases && d.cases.length) parts.push(['Client file: case summary', casesText(d.cases)]);
      if (P.sessionsOn && d.sessions) { var st = sessionsText(d.sessions); if (st) parts.push(['Client file: sessions', st]); }
      var notes = Object.keys(P.picked).map(function (k) { return P.picked[k]; });
      if (notes.length) parts.push(['Client file: ' + notes.length + (notes.length === 1 ? ' case note' : ' case notes'), notesText(notes)]);
      return parts;
    }
    function updateFoot() {
      var parts = selectedParts();
      var chars = parts.reduce(function (n, p) { return n + p[0].length + p[1].length + 30; }, 0);
      var room = opts.composer.roomLeft();
      var over = chars > room;
      el.querySelector('#oa-cf-count').textContent = parts.length
        ? chars.toLocaleString() + ' of ' + room.toLocaleString() + ' characters' + (over ? ' — too much, untick some notes' : '') : 'Nothing ticked yet';
      el.querySelector('#oa-cf-count').className = over ? 'warn' : '';
      var btn = el.querySelector('#oa-cf-attach'); btn.disabled = !parts.length || over;
    }

    function render() {
      var d = P.data || {};
      var html = '';
      // Case
      html += '<section><h3>Case</h3>';
      if (d.casesAvailable === false) html += '<div class="oa-cf-empty">Splose could not be reached for the case details just now.</div>';
      else if (!d.cases || !d.cases.length) html += '<div class="oa-cf-empty">No Splose case found for this client.</div>';
      else html += '<label class="oa-cf-row"><input type="checkbox" data-cf="case"' + (P.caseOn ? ' checked' : '') + '><span><b>Case summary</b><small>' + esc(casesText(d.cases).split('\n').slice(0, 3).join(' · ')) + '</small></span></label>';
      html += '</section>';
      // Sessions
      var s = d.sessions || { past: [], next: [] };
      html += '<section><h3>Sessions</h3>';
      if (!s.past.length && !s.next.length) html += '<div class="oa-cf-empty">No sessions with this client in your calendar.</div>';
      else html += '<label class="oa-cf-row"><input type="checkbox" data-cf="sessions"' + (P.sessionsOn ? ' checked' : '') + '><span><b>Session history</b><small>' + s.past.length + ' recent' + (s.past[0] ? ', last ' + esc(fmtDate(s.past[0].start)) : '') + (s.next.length ? ' · ' + s.next.length + ' upcoming' : '') + '</small></span></label>';
      html += '</section>';
      // Notes
      html += '<section><h3>Your case notes</h3>'
        + '<div class="oa-cf-search"><input type="search" id="oa-cf-q" placeholder="Search your notes — e.g. stove, shower, &quot;restraining order&quot;" value="' + esc(P.query) + '" aria-label="Search your case notes">'
        + (P.notes.length ? '<button type="button" class="oa-btn ghost sm" data-cf="all">Tick all shown</button>' : '') + '</div>';
      if (P.searchError) html += '<div class="oa-cf-empty bad">' + esc(P.searchError) + '</div>';
      else if (!P.notes.length) html += '<div class="oa-cf-empty">' + (P.query ? 'No notes match that search.' : 'No case notes for this client in the portal yet.') + '</div>';
      else html += '<ul class="oa-cf-notes">' + P.notes.map(function (n) {
        return '<li><label class="oa-cf-row"><input type="checkbox" data-note="' + esc(n.id) + '"' + (P.picked[n.id] ? ' checked' : '') + '><span><b>' + esc(fmtDate(n.date)) + (n.title ? ' — ' + esc(n.title) : '') + '</b>'
          + (n.review === 'approved' ? '' : '<em>not yet reviewed</em>') + '<small>' + esc(snippet(n.text, P.query)) + '</small></span></label></li>';
      }).join('') + '</ul>' + (P.more ? '<div class="oa-cf-empty">Showing the newest ' + P.notes.length + '. Search to find older notes.</div>' : '');
      html += '<p class="oa-cf-note">Notes written directly in Splose are not shown — Splose does not share them with the portal.</p></section>';
      var hadFocus = document.activeElement && document.activeElement.id === 'oa-cf-q';
      var caret = hadFocus ? document.activeElement.selectionStart : null;
      body.innerHTML = html;
      if (hadFocus) { var q = body.querySelector('#oa-cf-q'); q.focus(); try { q.setSelectionRange(caret, caret); } catch (e) { /* type=search */ } }
      updateFoot();
    }

    el.addEventListener('input', function (e) {
      if (e.target.id !== 'oa-cf-q') return;
      clearTimeout(P.timer);
      var v = e.target.value;
      P.timer = setTimeout(function () { P.searchError = null; P.query = v; load(v.trim()); }, 350);
    });
    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.dataset.cf === 'case') P.caseOn = t.checked;
      else if (t.dataset.cf === 'sessions') P.sessionsOn = t.checked;
      else if (t.dataset.note) {
        var n = P.notes.filter(function (x) { return x.id === t.dataset.note; })[0];
        if (t.checked && n) P.picked[n.id] = n; else delete P.picked[t.dataset.note];
      }
      updateFoot();
    });
    el.addEventListener('click', function (e) {
      if (e.target === el) return close();
      var b = e.target.closest('[data-cf]'); if (!b || b.tagName === 'INPUT') return;
      if (b.dataset.cf === 'close') close();
      else if (b.dataset.cf === 'all') { P.notes.forEach(function (n) { P.picked[n.id] = n; }); render(); }
      else if (b.dataset.cf === 'attach') {
        selectedParts().forEach(function (p) { opts.composer.addText(p[0], p[1]); });
        close();
        var input = document.getElementById('oa-input'); if (input) input.focus();
      }
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    load('');
    setTimeout(function () { var b = el.querySelector('[data-cf="close"]'); if (b) b.focus(); }, 0);
  }

  function close() { var el = document.getElementById('oa-cf'); if (el) el.remove(); }

  api.open = open; api.close = close;
  global.OpalAssistClientFile = api;
})(typeof window !== 'undefined' ? window : globalThis);
