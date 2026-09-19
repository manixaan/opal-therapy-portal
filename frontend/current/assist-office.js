/**
 * Opal Assist inside Word, Excel and Outlook — the Office.js glue.
 *
 * Loaded by assist.html only when ?surface=word|excel|outlook. Responsible
 * for three things and nothing else:
 *   1. sign-in: a Microsoft 365 token from Office (OfficeRuntime.auth) that
 *      assist.js presents as a bearer on every /api/assist call;
 *   2. reading the current selection (document text, cell values, email body);
 *   3. inserting a restored reply back at the cursor.
 *
 * The selection is checked and tokenised by the server before it is used —
 * this file never sends it anywhere itself.
 */
(function (global) {
  'use strict';
  if (!global.document) return;

  var params = new URLSearchParams(global.location.search);
  var surface = params.get('surface');
  if (['word', 'excel', 'outlook'].indexOf(surface) < 0) return;

  var state = { ready: false, token: null, tokenAt: 0, error: null };

  function loadOfficeJs() {
    return new Promise(function (resolve, reject) {
      if (global.Office) return resolve();
      var s = document.createElement('script');
      s.src = 'https://appsforoffice.microsoft.com/lib/1/hosted/office.js';
      s.onload = resolve; s.onerror = function () { reject(new Error('office_js_failed')); };
      document.head.appendChild(s);
    });
  }

  /** A fresh Microsoft token (Office caches and renews it; we re-ask every 20 min). */
  function token() {
    if (!state.ready || !global.OfficeRuntime || !global.OfficeRuntime.auth) return Promise.resolve(null);
    if (state.token && Date.now() - state.tokenAt < 20 * 60 * 1000) return Promise.resolve(state.token);
    return global.OfficeRuntime.auth.getAccessToken({ allowSignInPrompt: true, allowConsentPrompt: true, forMSGraphAccess: false })
      .then(function (t) { state.token = t; state.tokenAt = Date.now(); state.error = null; return t; })
      .catch(function (err) { state.error = (err && (err.code || err.message)) || 'sign_in_failed'; state.token = null; return null; });
  }

  // EXCEL: a column whose heading says it holds identifiers is withheld WHOLE,
  // before the text ever reaches the check — a list of names under "Client" is
  // not something to pattern-match cell by cell.
  var IDENTIFYING_HEADING = /^(?:(?:client|participant|patient|parent|carer|contact|staff|first|last|full|sur|given|family|preferred)?\s*names?|client|participant|patient|d\.?o\.?b\.?|date of birth|birth ?date|ndis(?:\s*(?:no\.?|number|#))?|medicare.*|crn|tfn|phone|mobile|telephone|tel|email|e-mail|address|street|suburb|post ?code|bsb|account.*|abn|licen[cs]e.*|passport.*|rego.*|emergency contact.*|next of kin.*)$/i;
  function withholdIdentifyingColumns(values) {
    if (!values || values.length < 2) return values;
    var hide = (values[0] || []).map(function (h) { return IDENTIFYING_HEADING.test(String(h === null || h === undefined ? '' : h).trim()); });
    if (!hide.some(Boolean)) return values;
    return values.map(function (row, r) { return row.map(function (v, c) { return hide[c] && r > 0 ? '[column withheld]' : v; }); });
  }

  // OUTLOOK: the header block of a quoted chain and the signature carry names,
  // numbers and addresses that are not the question. They are cut before the check.
  function stripEmailFurniture(text) {
    var lines = String(text || '').split(/\r?\n/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (/^\s*(?:from|sent|to|cc|bcc|subject|date|reply-to)\s*:/i.test(l)) continue;
      if (/^\s*(?:--\s*$|kind regards|warm regards|best regards|regards|many thanks|thanks and regards|cheers|yours sincerely|yours faithfully|sent from my )/i.test(l)) {
        // Skip the signature: everything up to the next quoted message or the end.
        while (i + 1 < lines.length && !/^\s*(?:on .+ wrote:|-{2,}\s*original message|_{5,}|from\s*:)/i.test(lines[i + 1])) i++;
        continue;
      }
      if (/this e-?mail (?:and any attachments )?(?:is|are|may be) confidential|intended (?:only )?for the (?:named )?(?:addressee|recipient)/i.test(l)) continue;
      out.push(l);
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function readSelection() {
    if (!state.ready) return Promise.resolve('');
    if (surface === 'word') {
      return global.Word.run(function (ctx) {
        var sel = ctx.document.getSelection(); sel.load('text');
        return ctx.sync().then(function () { return sel.text || ''; });
      });
    }
    if (surface === 'excel') {
      return global.Excel.run(function (ctx) {
        var r = ctx.workbook.getSelectedRange(); r.load('values,address');
        return ctx.sync().then(function () {
          return withholdIdentifyingColumns(r.values || []).map(function (row) { return row.map(function (v) { return v === null || v === undefined ? '' : String(v); }).join('\t'); }).join('\n');
        });
      });
    }
    if (surface === 'outlook') {
      return new Promise(function (resolve) {
        var item = global.Office.context.mailbox && global.Office.context.mailbox.item;
        if (!item || !item.body) return resolve('');
        item.body.getAsync(global.Office.CoercionType.Text, function (r) { resolve(r.status === 'succeeded' ? stripEmailFurniture(r.value || '') : ''); });
      });
    }
    return Promise.resolve('');
  }

  function insert(text) {
    if (!state.ready) return Promise.resolve(false);
    if (surface === 'word') {
      return global.Word.run(function (ctx) { ctx.document.getSelection().insertText(text, 'Replace'); return ctx.sync().then(function () { return true; }); });
    }
    if (surface === 'excel') {
      return global.Excel.run(function (ctx) {
        var cell = ctx.workbook.getActiveCell(); cell.values = [[text]]; return ctx.sync().then(function () { return true; });
      });
    }
    if (surface === 'outlook') {
      return new Promise(function (resolve) {
        var item = global.Office.context.mailbox && global.Office.context.mailbox.item;
        if (!item || !item.body || !item.body.setSelectedDataAsync) return resolve(false);
        item.body.setSelectedDataAsync(text, { coercionType: global.Office.CoercionType.Text }, function (r) { resolve(r.status === 'succeeded'); });
      });
    }
    return Promise.resolve(false);
  }

  global.OpalAssistOffice = { _withholdIdentifyingColumns: withholdIdentifyingColumns, _stripEmailFurniture: stripEmailFurniture, surface: surface, token: token, readSelection: readSelection, insert: insert, state: state };

  loadOfficeJs().then(function () {
    return new Promise(function (resolve) { global.Office.onReady(function () { resolve(); }); });
  }).then(function () {
    state.ready = true;
    document.dispatchEvent(new CustomEvent('opal-assist-office-ready'));
  }).catch(function (err) {
    state.error = err && err.message;
    document.dispatchEvent(new CustomEvent('opal-assist-office-ready'));
  });
})(typeof window !== 'undefined' ? window : globalThis);
