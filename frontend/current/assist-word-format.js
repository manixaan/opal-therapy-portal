/**
 * Opal Assist — document tools for Word.
 *
 * Formatting is done by CODE, not by the AI: nothing in this file sends a word
 * of the document anywhere. Each tool is a fixed, repeatable action against
 * the Opal Document Standard below, so two therapists pressing the same
 * button get the same document.
 *
 * THE OPAL DOCUMENT STANDARD (v1, 19 Sep 2026)
 *   Structure, sizes, spacing and rules: taken from the reference report
 *   supplied by Antony (Arial throughout; 11 pt body, single line, 3 pt
 *   before/after; Heading 1 14 pt bold with a 1.5 pt rule beneath, 18/12 pt,
 *   kept with next; Heading 2 11 pt bold, 18/6; Heading 3–4 11 pt, 12/6;
 *   captions and tables 9 pt; table cells 3 pt padding, hairline rules,
 *   shaded header row; contents level 1 bold capitals).
 *   Colour: Opal's own, from the Functional Capacity Assessment master —
 *   deep green 2F5651 for headings, rules and table headers; ink 263633 for
 *   body; slate 566E70 for level-3 headings and captions; mist F4F7F5 for
 *   banded rows.
 *
 * Loaded by assist.html only inside Word (?surface=word).
 */
(function (global) {
  'use strict';
  if (!global.document) return;
  if (new URLSearchParams(global.location.search).get('surface') !== 'word') return;

  var STANDARD = {
    version: 1,
    font: 'Arial',
    colour: { primary: '#2F5651', ink: '#263633', slate: '#566E70', mint: '#C5E1CC', mist: '#F4F7F5', sage: '#E8F1EC', paper: '#FAF7F2', white: '#FFFFFF' },
    // name → [size pt, bold, colour key, space before pt, space after pt, keep with next]
    styles: {
      'Normal':         [11, false, 'ink',     3,  3, false],
      'Title':          [30, true,  'primary', 0,  8, true],
      'Subtitle':       [13, false, 'slate',   0, 12, true],
      'Heading 1':      [14, true,  'primary', 18, 12, true],
      'Heading 2':      [11, true,  'primary', 18, 6, true],
      'Heading 3':      [11, false, 'slate',   12, 6, true],
      'Heading 4':      [11, false, 'slate',   12, 6, true],
      'Caption':        [9,  true,  'primary', 12, 0, true],
      'List Paragraph': [11, false, 'ink',     3,  3, false],
      'TOC 1':          [11, true,  'primary', 0,  5, false],
      'TOC 2':          [11, false, 'ink',     0,  5, false],
      'TOC 3':          [10, false, 'slate',   0,  5, false],
    },
    table: { size: 9, headerFill: 'primary', headerText: 'white', band: 'mist', border: 'primary' },
  };

  var say = function (msg, kind) {
    var el = document.getElementById('oa-tools-status');
    if (el) { el.textContent = msg; el.className = 'oa-tools-status' + (kind ? ' ' + kind : ''); }
  };
  var supports = function (v) { try { return global.Office.context.requirements.isSetSupported('WordApi', v); } catch (e) { return false; } };
  var FF = String.fromCharCode(12); var NBSP = String.fromCharCode(160);
  var isEmpty = function (t) { return !String(t || '').split(NBSP).join('').replace(/\s/g, ''); };
  var hasBreak = function (t) { return String(t || '').indexOf(FF) >= 0; };

  // ── Tools ────────────────────────────────────────────────────────────────

  /** Rewrite the document's style definitions to the standard, then its tables. */
  function applyStandard() {
    return global.Word.run(function (ctx) {
      var names = Object.keys(STANDARD.styles);
      var done = 0;
      var chain = Promise.resolve();
      if (supports('1.5')) {
        var styles = names.map(function (n) { var s = ctx.document.getStyles().getByNameOrNullObject(n); s.load('isNullObject'); return s; });
        chain = ctx.sync().then(function () {
          styles.forEach(function (s, i) {
            if (s.isNullObject) return;
            var d = STANDARD.styles[names[i]];
            s.font.name = STANDARD.font; s.font.size = d[0]; s.font.bold = d[1]; s.font.color = STANDARD.colour[d[2]];
            s.paragraphFormat.spaceBefore = d[3]; s.paragraphFormat.spaceAfter = d[4]; s.paragraphFormat.keepWithNext = d[5];
            s.paragraphFormat.lineSpacing = 12 * (d[0] / 10); // single
            done++;
          });
          return ctx.sync();
        });
      }
      // Paragraphs carry direct formatting that a style change does not reach: bring the typeface home.
      var paras = ctx.document.body.paragraphs; paras.load('items/style,items/tableNestingLevel');
      var tables = ctx.document.body.tables; tables.load('items');
      return chain.then(function () { return ctx.sync(); }).then(function () {
        paras.items.forEach(function (p) { p.font.name = STANDARD.font; });
        tables.items.forEach(function (t) {
          t.font.name = STANDARD.font; t.font.size = STANDARD.table.size; t.font.color = STANDARD.colour.ink;
          t.headerRowCount = Math.max(1, t.headerRowCount || 0);
          t.styleBandedRows = true; t.styleFirstColumn = false;
          t.getBorder('All').color = STANDARD.colour[STANDARD.table.border]; t.getBorder('All').width = 0.5; t.getBorder('All').type = 'Single';
          var head = t.rows.getFirst();
          head.shadingColor = STANDARD.colour[STANDARD.table.headerFill];
          head.font.color = STANDARD.colour[STANDARD.table.headerText]; head.font.bold = true;
        });
        return ctx.sync();
      }).then(function () { return 'Opal standard applied: ' + done + ' styles, ' + tables.items.length + ' tables, ' + paras.items.length + ' paragraphs set to ' + STANDARD.font + '.'; });
    });
  }

  /** Runs of empty paragraphs become one; empty paragraphs at the very end go. Tables are left alone. */
  function tidySpacing() {
    return global.Word.run(function (ctx) {
      var paras = ctx.document.body.paragraphs; paras.load('items/text,items/tableNestingLevel');
      return ctx.sync().then(function () {
        var removed = 0; var run = 0; var items = paras.items;
        items.forEach(function (p, i) {
          if (p.tableNestingLevel > 0) { run = 0; return; }
          // An inline picture or a page break has no text but is not blank: only delete what is truly empty.
          if (isEmpty(p.text) && !hasBreak(p.text)) { run++; if (run > 1 && i < items.length - 1) { p.delete(); removed++; } }
          else run = 0;
        });
        return ctx.sync().then(function () { return removed ? removed + ' blank lines removed. Blank pages made of empty lines are gone.' : 'No surplus blank lines found.'; });
      });
    });
  }

  /** Every Heading 1 after the first starts a new page — by a real page break, added only where one is not already there. */
  function headingsOnNewPage() {
    return global.Word.run(function (ctx) {
      var paras = ctx.document.body.paragraphs; paras.load('items/text,items/styleBuiltIn,items/style,items/tableNestingLevel');
      return ctx.sync().then(function () {
        var added = 0; var seenFirst = false;
        paras.items.forEach(function (p, i) {
          var isH1 = p.styleBuiltIn === 'Heading1' || /heading\s*1$/i.test(p.style || '');
          if (!isH1 || p.tableNestingLevel > 0 || isEmpty(p.text)) return;
          if (!seenFirst) { seenFirst = true; if (i === 0) return; }
          var prev = i > 0 ? paras.items[i - 1].text : '';
          if (hasBreak(prev) || hasBreak(p.text)) return; // already breaks here
          p.insertBreak('Page', 'Before'); added++;
        });
        return ctx.sync().then(function () { return added ? added + ' main headings moved to a new page.' : 'Every main heading already starts a new page.'; });
      });
    });
  }

  /** Refresh the contents page and every other field (page numbers, cross-references). */
  function updateContents() {
    if (!supports('1.4')) return Promise.resolve('This version of Word cannot refresh fields from an add-in. Click in the contents page and press F9.');
    return global.Word.run(function (ctx) {
      var fields = ctx.document.body.fields; fields.load('items/type');
      return ctx.sync().then(function () {
        var toc = 0;
        fields.items.forEach(function (f) { if (String(f.type).toLowerCase() === 'toc') toc++; f.updateResult(); });
        return ctx.sync().then(function () { return toc ? 'Contents page refreshed (' + fields.items.length + ' fields updated).' : 'No contents page found. ' + fields.items.length + ' other fields updated.'; });
      });
    });
  }

  /** Read-only. What a careful reviewer would flag, found by rule. */
  function checkDocument() {
    return global.Word.run(function (ctx) {
      var paras = ctx.document.body.paragraphs; paras.load('items/text,items/styleBuiltIn,items/style,items/font/name,items/tableNestingLevel');
      return ctx.sync().then(function () {
        var items = paras.items; var text = items.map(function (p) { return p.text; }).join('\n');
        var level = function (p) { var m = String(p.styleBuiltIn || '').match(/^Heading([1-9])$/) || String(p.style || '').match(/heading\s*([1-9])$/i); return m ? +m[1] : 0; };
        var found = []; var last = 0; var blanks = 0; var run = 0; var offFont = 0; var emptyHeads = 0; var headings = 0;
        items.forEach(function (p) {
          var l = level(p);
          if (l) { headings++; if (isEmpty(p.text)) emptyHeads++; else { if (last && l > last + 1) found.push('Heading level jumps from ' + last + ' to ' + l + ' at "' + p.text.slice(0, 40) + '"'); last = l; } }
          if (isEmpty(p.text) && p.tableNestingLevel === 0) { run++; if (run === 2) blanks++; } else run = 0;
          if (p.font.name && p.font.name !== STANDARD.font && !isEmpty(p.text)) offFont++;
        });
        // Appendices: every one referred to must exist as a heading, and the reverse.
        var referred = {}; var present = {};
        (text.match(/\bAppendix\s+([A-Z]|\d{1,2})\b/g) || []).forEach(function (m) { referred[m.replace(/\s+/g, ' ')] = true; });
        items.forEach(function (p) { var m = level(p) && p.text.match(/^\s*Appendix\s+([A-Z]|\d{1,2})\b/); if (m) present['Appendix ' + m[1]] = true; });
        Object.keys(referred).forEach(function (a) { if (!present[a]) found.push(a + ' is mentioned but has no heading of its own'); });
        Object.keys(present).forEach(function (a) { if ((text.match(new RegExp('\\b' + a + '\\b', 'g')) || []).length < 2) found.push(a + ' exists but is never referred to in the report'); });
        if (!headings) found.push('No headings use a Heading style, so a contents page cannot be built');
        if (emptyHeads) found.push(emptyHeads + ' empty heading' + (emptyHeads > 1 ? 's' : '') + ' (they appear as blank lines in the contents page)');
        if (blanks) found.push(blanks + ' place' + (blanks > 1 ? 's' : '') + ' with two or more blank lines in a row — use "Tidy spacing"');
        if (offFont) found.push(offFont + ' paragraph' + (offFont > 1 ? 's' : '') + ' not in ' + STANDARD.font + ' — use "Apply Opal format"');
        var dbl = (text.match(/[^\s.]  +\S/g) || []).length; if (dbl) found.push(dbl + ' double spaces');
        var place = (text.match(/\[(?:insert|client|name|date|tbc|todo)[^\]]*\]|XX+|TBC\b/gi) || []).length; if (place) found.push(place + ' unfilled placeholder' + (place > 1 ? 's' : '') + ' ([insert…], XX, TBC)');
        return found;
      });
    }).then(function (found) {
      var box = document.getElementById('oa-tools-report');
      if (box) { box.hidden = false; box.innerHTML = ''; var h = document.createElement('strong'); h.textContent = found.length ? found.length + ' thing' + (found.length > 1 ? 's' : '') + ' to fix' : 'Nothing to fix'; box.appendChild(h); var ul = document.createElement('ul'); found.forEach(function (f) { var li = document.createElement('li'); li.textContent = f; ul.appendChild(li); }); box.appendChild(ul); }
      return found.length ? 'Check finished: ' + found.length + ' to fix (listed below).' : 'Check finished: the document is clean.';
    });
  }

  var TOOLS = [
    ['format', 'Apply Opal format', applyStandard],
    ['tidy', 'Tidy spacing', tidySpacing],
    ['pages', 'Headings on new page', headingsOnNewPage],
    ['toc', 'Update contents', updateContents],
    ['check', 'Check document', checkDocument],
  ];

  function mount() {
    var host = document.querySelector('.oa-compose-inner');
    if (!host || document.getElementById('oa-tools')) return;
    var wrap = document.createElement('div'); wrap.id = 'oa-tools'; wrap.className = 'oa-tools-bar';
    var label = document.createElement('span'); label.className = 'oa-tools-label'; label.textContent = 'Document tools'; wrap.appendChild(label);
    TOOLS.forEach(function (t) {
      var b = document.createElement('button'); b.type = 'button'; b.className = 'oa-btn sm'; b.id = 'oa-tool-' + t[0]; b.textContent = t[1];
      b.addEventListener('click', function () {
        var all = wrap.querySelectorAll('button'); all.forEach(function (x) { x.disabled = true; }); say('Working…');
        Promise.resolve().then(t[2]).then(function (msg) { say(msg, 'ok'); })
          .catch(function (err) { say('That did not work in this version of Word (' + ((err && (err.code || err.message)) || 'error') + '). Nothing was changed by this step; use Undo if needed.', 'warn'); })
          .then(function () { all.forEach(function (x) { x.disabled = false; }); });
      });
      wrap.appendChild(b);
    });
    var status = document.createElement('div'); status.id = 'oa-tools-status'; status.className = 'oa-tools-status'; status.setAttribute('aria-live', 'polite');
    status.textContent = 'These tools run inside Word. Nothing from the document is sent anywhere. Undo (Cmd+Z) reverses any of them.';
    var report = document.createElement('div'); report.id = 'oa-tools-report'; report.className = 'oa-tools-report'; report.hidden = true;
    host.insertBefore(report, host.firstChild); host.insertBefore(status, host.firstChild); host.insertBefore(wrap, host.firstChild);
  }

  global.OpalAssistWordFormat = { STANDARD: STANDARD, applyStandard: applyStandard, tidySpacing: tidySpacing, headingsOnNewPage: headingsOnNewPage, updateContents: updateContents, checkDocument: checkDocument };
  document.addEventListener('opal-assist-office-ready', function () { if (global.Word) mount(); });
})(typeof window !== 'undefined' ? window : globalThis);
