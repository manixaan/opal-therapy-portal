/* ═══════════════════════════════════════════════════════════════════════════
   OPAL PORTAL — THEMED DIALOGS (confirm / alert / prompt)

   The browser's own confirm(), alert() and prompt() render in the browser's
   chrome: no portal styling, no theme, and some browsers suppress them
   outright. Every "are you sure?", every error notice and every one-line
   question in the portal goes through here instead.

   Promise-based, so a caller reads exactly like the native form once it is
   in an async function:

     if (!(await portalConfirm('Delete this document?'))) return;
     var reason = await portalPrompt('Reason (optional):', '');   // null = cancelled
     await portalAlert('Saving failed.');

   Options (second argument for confirm/alert, third for prompt):
     { title, ok, cancel, danger }  — danger paints the OK button red for
     destructive actions. Enter confirms, Escape cancels, focus is trapped in
     the dialog and returned afterwards. Globals on window, no modules, the
     same house pattern as every other file here.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {
  var doc = global && global.document;
  if (!doc) return;

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /** Paragraphs from a plain-text message: blank lines break paragraphs. */
  function paragraphs(text) {
    return String(text || '').split(/\n\s*\n/).map(function (p) {
      return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  var queue = [];      // dialogs wait their turn; two at once is chaos
  var current = null;

  function show(kind, message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      queue.push({ kind: kind, message: message, opts: opts, resolve: resolve });
      if (!current) next();
    });
  }

  function next() {
    current = queue.shift() || null;
    if (!current) return;
    var d = current;
    var opts = d.opts;
    var restoreTo = doc.activeElement;

    var okLabel = opts.ok || (d.kind === 'alert' ? 'OK' : d.kind === 'prompt' ? 'OK' : 'Yes');
    var cancelLabel = opts.cancel || (d.kind === 'alert' ? '' : 'Cancel');
    var title = opts.title || (d.kind === 'alert' ? 'Notice' : d.kind === 'prompt' ? 'Enter a value' : 'Please confirm');

    var el = doc.createElement('div');
    el.className = 'pd-backdrop';
    el.innerHTML =
      '<section class="pd-dialog" role="' + (d.kind === 'alert' ? 'alertdialog' : 'dialog') + '" aria-modal="true" aria-labelledby="pd-title">' +
        '<div class="pd-head"><h2 class="pd-title" id="pd-title">' + esc(title) + '</h2></div>' +
        '<div class="pd-body">' + paragraphs(d.message) +
          (d.kind === 'prompt'
            ? '<label class="pd-lbl" for="pd-input">' + esc(opts.label || 'Your answer') + '</label>' +
              '<input class="pd-input" id="pd-input" type="text" autocomplete="off" value="' + esc(opts.value || '') + '"' +
              (opts.placeholder ? ' placeholder="' + esc(opts.placeholder) + '"' : '') + '>'
            : '') +
        '</div>' +
        '<div class="pd-foot">' +
          (cancelLabel ? '<button type="button" class="pd-btn" data-pd="cancel">' + esc(cancelLabel) + '</button>' : '') +
          '<button type="button" class="pd-btn pd-btn-primary' + (opts.danger ? ' pd-btn-danger' : '') + '" data-pd="ok">' + esc(okLabel) + '</button>' +
        '</div>' +
      '</section>';
    doc.body.appendChild(el);
    doc.body.classList.add('pd-open');

    var input = el.querySelector('#pd-input');
    var okBtn = el.querySelector('[data-pd="ok"]');
    var cancelBtn = el.querySelector('[data-pd="cancel"]');

    function finish(value) {
      doc.removeEventListener('keydown', onKey, true);
      el.remove();
      if (!queue.length) doc.body.classList.remove('pd-open');
      current = null;
      try { if (restoreTo && restoreTo.focus && doc.contains(restoreTo)) restoreTo.focus(); } catch (e) { /* gone */ }
      d.resolve(value);
      next();
    }
    function ok() {
      if (d.kind === 'prompt') finish(input ? input.value : '');
      else finish(true);
    }
    function cancel() { finish(d.kind === 'prompt' ? null : (d.kind === 'alert' ? true : false)); }

    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); return; }
      if (e.key === 'Enter') {
        // Enter is OK wherever focus sits — except on Cancel, where it is
        // Cancel. The prompt's value is read from the field at that moment.
        if (e.target === cancelBtn) { e.preventDefault(); e.stopPropagation(); cancel(); return; }
        e.preventDefault(); e.stopPropagation(); ok(); return;
      }
      if (e.key === 'Tab') {
        // Keep focus inside: the dialog is the whole page while it is up.
        var focusables = Array.prototype.slice.call(el.querySelectorAll('input, button'));
        if (!focusables.length) return;
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    doc.addEventListener('keydown', onKey, true);
    okBtn.addEventListener('click', ok);
    if (cancelBtn) cancelBtn.addEventListener('click', cancel);
    // Clicking the dim backdrop is Cancel — the same as Escape.
    el.addEventListener('mousedown', function (e) { if (e.target === el) cancel(); });

    try {
      if (input) { input.focus(); input.select(); }
      else if (d.kind === 'confirm' && opts.danger && cancelBtn) cancelBtn.focus();
      else okBtn.focus();
    } catch (e) { /* not focusable yet */ }
  }

  var OpalDialog = {
    /** Resolves true (OK) or false (Cancel / Escape / backdrop). */
    confirm: function (message, opts) { return show('confirm', message, opts); },
    /** Resolves true once dismissed. */
    alert: function (message, opts) { return show('alert', message, opts); },
    /** Resolves the entered string, or null when cancelled — like prompt(). */
    prompt: function (message, value, opts) {
      opts = Object.assign({}, opts || {}, { value: value === undefined || value === null ? '' : String(value) });
      return show('prompt', message, opts);
    },
  };

  global.OpalDialog = OpalDialog;
  global.portalConfirm = OpalDialog.confirm;
  global.portalAlert = OpalDialog.alert;
  global.portalPrompt = OpalDialog.prompt;
})(typeof window !== 'undefined' ? window : this);
