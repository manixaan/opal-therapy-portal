/**
 * Opal Assist — the shared tool bar for the Word and Excel panes.
 *
 * Buttons run fixed code. The "in your own words" box turns a typed request
 * into those same buttons: first by plain keyword rules here in the pane
 * (instant, nothing sent), and only when no rule fits by asking the server
 * which tools match. That request carries the typed instruction and the
 * surface name — never the document or the sheet.
 *
 * Loaded by assist.html inside Word and Excel, before the surface's own tools.
 */
(function (global) {
  'use strict';
  if (!global.document) return;
  var surface = new URLSearchParams(global.location.search).get('surface');
  if (surface !== 'word' && surface !== 'excel') return;

  // Keyword rules, per surface. Order is the order the tools should run in.
  var RULES = {
    word: [
      ['format', /(opal (format|standard|style|styling|template)|format(ting)? (this|the|it|to|accord)|house style|fix (the )?(fonts?|styles?|colou?rs?)|make it look|brand)/i],
      ['tidy', /(blank (page|line)s?|empty (page|line|paragraph)s?|extra (space|spacing|line)s?|spacing|tidy|clean ?up|gaps?)/i],
      ['pages', /(heading|section|chapter)s? .*(new|own|separate|fresh) page|new page .*(heading|section)|page break/i],
      ['toc', /(contents?( page)?|table of contents|toc|page numbers?|cross[- ]?ref)/i],
      ['check', /(check|review|proof|audit|anything (wrong|missing)|missing|appendi(x|ces)|placeholder|problems?|issues?|errors?|typos?)/i],
    ],
    excel: [
      ['table', /(opal (format|table|style)|format (this|the|it|as)|table format|make it look|header row|banded|brand)/i],
      ['numbers', /(number format|currency|dollars?|decimals?|date format|tidy (the )?numbers?)/i],
      ['totals', /(totals?|sum|add (them |it )?up|subtotal)/i],
      ['fit', /(fit|auto-?fit|column widths?|wrap|too (narrow|wide)|cut off|####)/i],
      ['freeze', /(freeze|lock|keep) .*(top|header|heading|first) ?row|freeze panes?/i],
      ['check', /(check|review|audit|duplicates?|blanks?|missing|problems?|issues?|errors?)/i],
    ],
  };

  var tools = {}; var bar = null;
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  var say = function (msg, kind) { var s = document.getElementById('oa-tools-status'); if (s) { s.textContent = msg; s.className = 'oa-tools-status' + (kind ? ' ' + kind : ''); } };

  function report(found) {
    var box = document.getElementById('oa-tools-report'); if (!box) return;
    box.hidden = false; box.innerHTML = '';
    box.appendChild(el('strong', null, found.length ? found.length + ' thing' + (found.length > 1 ? 's' : '') + ' to fix' : 'Nothing to fix'));
    var ul = el('ul'); found.forEach(function (f) { ul.appendChild(el('li', null, f)); }); box.appendChild(ul);
  }

  function busy(on) { if (bar) bar.querySelectorAll('button,input').forEach(function (x) { x.disabled = on; }); }

  /** Run tools one after another; stop at the first that fails. */
  function run(ids) {
    busy(true); var done = [];
    return ids.reduce(function (chain, id) {
      return chain.then(function () { say('Working: ' + tools[id].label + '…'); return tools[id].fn(); }).then(function (msg) { done.push(msg); });
    }, Promise.resolve()).then(function () { say(done.join(' '), 'ok'); })
      .catch(function (err) { say((done.length ? done.join(' ') + ' Then: ' : '') + 'that step did not work in this version of Office (' + ((err && (err.code || err.message)) || 'error') + '). Use Undo if needed.', 'warn'); })
      .then(function () { busy(false); });
  }

  function localMatch(text) { return RULES[surface].filter(function (r) { return r[1].test(text) && tools[r[0]]; }).map(function (r) { return r[0]; }); }

  /** Only the instruction and the surface leave the pane. */
  function askServer(instruction) {
    var office = global.OpalAssistOffice;
    var headers = { 'Content-Type': 'application/json' };
    return (office ? office.token() : Promise.resolve(null)).then(function (tok) {
      if (tok) headers.Authorization = 'Bearer ' + tok;
      return fetch('/api/assist/actions', { method: 'POST', credentials: 'include', headers: headers, body: JSON.stringify({ surface: surface, instruction: instruction }) });
    }).then(function (r) { return r.ok ? r.json() : { actions: [], note: 'Opal Assist could not work that out just now. Use the buttons instead.' }; });
  }

  function doInWords(text) {
    text = String(text || '').trim(); if (!text) return Promise.resolve();
    var ids = localMatch(text);
    if (ids.length) return run(ids);
    busy(true); say('Working out which tools fit…');
    return askServer(text).then(function (r) {
      busy(false);
      var valid = (r.actions || []).filter(function (id) { return tools[id]; });
      if (!valid.length) { say(r.note || 'None of the tools fits that. Ask it in the chat below instead.', 'warn'); return null; }
      return run(valid);
    }).catch(function () { busy(false); say('Opal Assist could not be reached. Use the buttons instead.', 'warn'); });
  }

  function mount(forSurface, title, blurb, list) {
    if (forSurface !== surface) return;
    var build = function () {
      var host = document.querySelector('.oa-compose-inner');
      if (!host || document.getElementById('oa-tools')) return;
      bar = el('div', 'oa-tools-bar'); bar.id = 'oa-tools';
      bar.appendChild(el('span', 'oa-tools-label', title));
      list.forEach(function (t) {
        tools[t[0]] = { label: t[1], fn: t[2] };
        var b = el('button', 'oa-btn sm', t[1]); b.type = 'button'; b.id = 'oa-tool-' + t[0];
        b.addEventListener('click', function () { run([t[0]]); }); bar.appendChild(b);
      });
      var words = el('div', 'oa-tools-words');
      var input = el('input'); input.type = 'text'; input.id = 'oa-tools-words'; input.setAttribute('aria-label', 'Tell Opal Assist what to fix');
      input.placeholder = surface === 'word' ? 'Or say it: "remove blank pages and update the contents"' : 'Or say it: "format as a table and add totals"';
      var go = el('button', 'oa-btn sm primary', 'Do it'); go.type = 'button'; go.id = 'oa-tools-go';
      go.addEventListener('click', function () { doInWords(input.value); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doInWords(input.value); } });
      words.appendChild(input); words.appendChild(go); bar.appendChild(words);
      if (surface === 'word') {
        // Margins, heading rules and numbered headings live in the template — an add-in cannot set them.
        var link = el('a', 'oa-tools-template', 'Start a new document from the Opal template'); link.href = '/office/Opal-Document-Template.dotx'; link.target = '_blank'; link.rel = 'noopener';
        bar.appendChild(link);
      }
      var status = el('div', 'oa-tools-status', blurb); status.id = 'oa-tools-status'; status.setAttribute('aria-live', 'polite');
      var rep = el('div', 'oa-tools-report'); rep.id = 'oa-tools-report'; rep.hidden = true;
      host.insertBefore(rep, host.firstChild); host.insertBefore(status, host.firstChild); host.insertBefore(bar, host.firstChild);
    };
    var ready = function () { return (surface === 'word' && global.Word) || (surface === 'excel' && global.Excel); };
    if (global.OpalAssistOffice && global.OpalAssistOffice.state.ready && ready()) build();
    document.addEventListener('opal-assist-office-ready', function () { if (ready()) build(); });
  }

  global.OpalAssistTools = { mount: mount, report: report, say: say, run: run, _localMatch: localMatch, _register: function (id, label, fn) { tools[id] = { label: label, fn: fn }; } };
})(typeof window !== 'undefined' ? window : globalThis);
