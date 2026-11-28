/**
 * Opal Assist — "Outlook draft" on a document reply. No framework.
 *
 * Saves the document in the practitioner's OWN Outlook Drafts (POST
 * /api/assist/outlook-draft → Microsoft Graph). Never sent: Outlook is where
 * they read it and press Send. The dialog asks for the recipients (filled
 * with any email address the document mentions) and the subject.
 *
 * The document goes as plain-text blocks with names put back — it is going
 * to their own mailbox — and without a report's note references. The server
 * builds the email itself; no HTML leaves this page.
 *
 * Pure helpers are exported for node tests; open() needs a document.
 */
(function (global) {
  'use strict';

  var TOKEN_RE = /\[([A-Z][A-Z0-9_]*)\]/g;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /** Email addresses behind the document's [EMAIL_n] tokens, in order of appearance. */
  function recipientsFrom(doc, names) {
    var out = [];
    (doc && doc.blocks || []).forEach(function (b) {
      [b.lead, b.text].forEach(function (t) {
        var m; TOKEN_RE.lastIndex = 0;
        while ((m = TOKEN_RE.exec(String(t || ''))) !== null) {
          if (/^EMAIL_\d+$/.test(m[1]) && names && names[m[1]] && out.indexOf(names[m[1]]) < 0) out.push(names[m[1]]);
        }
      });
    });
    return out;
  }

  /** The draft's blocks: names restored, note references out. */
  function draftBlocks(doc, restore, strip) {
    return (doc && doc.blocks || []).map(function (b) {
      var o = { t: b.t, text: strip(restore(b.text)) };
      if (b.lead) o.lead = strip(restore(b.lead));
      return o;
    });
  }

  /** A subject from the title, else the first heading. */
  function subjectFor(doc, restore) {
    if (doc && doc.title) return restore(doc.title);
    var h = (doc && doc.blocks || []).filter(function (b) { return b.t === 'h'; })[0];
    return h ? restore(h.text) : '';
  }

  var api = { recipientsFrom: recipientsFrom, draftBlocks: draftBlocks, subjectFor: subjectFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) { global.OpalAssistOutlook = api; return; }

  function close() { var el = document.getElementById('oa-od'); if (el) el.remove(); }

  /**
   * opts: { doc, names, restore(text), strip(text), api, status: {available, reason} }
   */
  function open(opts) {
    close();
    var available = !!(opts.status && opts.status.available);
    var el = document.createElement('div');
    el.className = 'oa-cf-backdrop oa-od-backdrop'; el.id = 'oa-od';
    el.innerHTML = '<div class="oa-cf oa-od" role="dialog" aria-modal="true" aria-labelledby="oa-od-title">'
      + '<div class="oa-cf-head"><h2 id="oa-od-title">Save as an Outlook draft</h2><button type="button" class="oa-btn ghost sm" data-od="close" aria-label="Close">×</button></div>'
      + '<p class="oa-cf-lede">It goes to the Drafts folder of your own Outlook and is never sent from here. Open it in Outlook, check it, and press Send yourself.</p>'
      + '<div class="oa-cf-body">'
      + (available ? '' : '<div class="oa-cf-empty bad">' + esc((opts.status && opts.status.reason) || 'Outlook drafts are not available.') + '</div>')
      + '<label class="oa-rb-label" for="oa-od-to">To (optional — separate addresses with a comma)</label>'
      + '<input id="oa-od-to" class="oa-od-input" type="text" autocomplete="off" value="' + esc(recipientsFrom(opts.doc, opts.names).join(', ')) + '">'
      + '<label class="oa-rb-label" for="oa-od-subject">Subject</label>'
      + '<input id="oa-od-subject" class="oa-od-input" type="text" maxlength="250" value="' + esc(subjectFor(opts.doc, opts.restore)) + '">'
      + '<div class="oa-no-msg" id="oa-od-msg" role="status" aria-live="polite"></div>'
      + '</div>'
      + '<div class="oa-cf-foot"><span></span><button type="button" class="oa-btn primary sm" data-od="save"' + (available ? '' : ' disabled') + '>Save to Drafts</button></div></div>';
    document.body.appendChild(el);
    var q = function (s) { return el.querySelector(s); };
    function msg(kind, text, link) {
      var m = q('#oa-od-msg'); m.className = 'oa-no-msg ' + kind; m.textContent = text;
      if (link) { var a = document.createElement('a'); a.href = link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = ' Open it in Outlook'; m.appendChild(a); }
    }
    function save() {
      var btn = q('[data-od="save"]'); btn.disabled = true; btn.textContent = 'Saving…'; msg('info', '');
      opts.api('/api/assist/outlook-draft', { body: {
        to: q('#oa-od-to').value, subject: q('#oa-od-subject').value,
        blocks: draftBlocks(opts.doc, opts.restore, opts.strip),
      } }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw new Error(j.message || 'The draft could not be saved just now.');
          btn.textContent = 'Saved';
          msg('info', 'Saved in your Outlook Drafts.', j.webLink || null);
        });
      }).catch(function (err) { btn.disabled = false; btn.textContent = 'Save to Drafts'; msg('bad', err.message); });
    }
    el.addEventListener('click', function (e) {
      if (e.target === el) return close();
      var b = e.target.closest('[data-od]'); if (!b || b.disabled) return;
      if (b.dataset.od === 'close') close(); else if (b.dataset.od === 'save') save();
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
    q('#oa-od-to').focus();
  }

  api.open = open; api.close = close;
  global.OpalAssistOutlook = api;
})(typeof window !== 'undefined' ? window : globalThis);
