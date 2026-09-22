/**
 * Opal Assist — document tools for Word.
 *
 * Formatting is done by CODE, not by the AI: nothing in this file sends a word
 * of the document anywhere. Each tool is a fixed, repeatable action against
 * the Opal Document Standard below, so two therapists pressing the same
 * button get the same document.
 *
 * Tools that need a detail (header wording, a style name, a table size) read
 * it from what the person typed in the pane — never from the model. The one
 * tool that touches the chat, "Attach layout", only ATTACHES a structure
 * summary (headings, breaks, headers and footers — no body text) as selected
 * content: the person still sees it in the check-before-send card, and it is
 * de-identified and guarded like any other selection.
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

  var supports = function (v) { try { return global.Office.context.requirements.isSetSupported('WordApi', v); } catch (e) { return false; } };
  // Page setup lives in the desktop-only sets: Word for Mac 16.99.2+ / Windows 2507+ (WordApiDesktop 1.3).
  var supportsDesktop = function (v) { try { return global.Office.context.requirements.isSetSupported('WordApiDesktop', v); } catch (e) { return false; } };
  var OLD_WORD = 'This version of Word cannot change page setup from an add-in (it needs Word for Mac 16.99 or Windows 2507, July 2025, or later). Use Layout > Margins / Orientation, or start from the Opal template.';
  // The Opal template's margins, in points (top 1701 / right 720 / bottom 1134 / left 720 twips).
  var MARGINS = { opal: [85, 36, 57, 36], normal: [72, 72, 72, 72], narrow: [36, 36, 36, 36], wide: [72, 144, 72, 144] };
  var FF = String.fromCharCode(12); var NBSP = String.fromCharCode(160);
  var isEmpty = function (t) { return !String(t || '').split(NBSP).join('').replace(/\s/g, ''); };
  var hasBreak = function (t) { return String(t || '').indexOf(FF) >= 0; };

  /** One table, to the standard. Shared by "Apply Opal format" and "Insert table". */
  function styleTable(t, headerRows) {
    t.font.name = STANDARD.font; t.font.size = STANDARD.table.size; t.font.color = STANDARD.colour.ink;
    t.headerRowCount = Math.max(1, headerRows || 0);
    t.styleBandedRows = true; t.styleFirstColumn = false;
    t.getBorder('All').color = STANDARD.colour[STANDARD.table.border]; t.getBorder('All').width = 0.5; t.getBorder('All').type = 'Single';
    var head = t.rows.getFirst();
    head.shadingColor = STANDARD.colour[STANDARD.table.headerFill];
    head.font.color = STANDARD.colour[STANDARD.table.headerText]; head.font.bold = true;
  }

  // ── Reading a detail out of what the person typed ─────────────────────────
  /** The wording for a header or footer: whatever is in quotes, else what follows "header to / : / saying". */
  function wordingFor(kind, typed) {
    typed = String(typed || '');
    var q = typed.match(/["\u201C]([^"\u201C\u201D]{1,200})["\u201D]/); // double quotes only: an apostrophe is not a quote
    if (q) return q[1].trim();
    var m = typed.match(new RegExp('\\b' + kind + '\\b\\s*(?:to say|to read|to|:|saying|that says|reading|text|as|of)\\s+(.{1,200})$', 'i'));
    return m ? m[1].replace(/\s+(?:and|with) page numbers?.*$/i, '').trim() : '';
  }
  var STYLE_WORDS = [
    [/heading\s*1|main heading/i, 'Heading1', 'Heading 1'], [/heading\s*2|sub-?heading/i, 'Heading2', 'Heading 2'],
    [/heading\s*3/i, 'Heading3', 'Heading 3'], [/heading\s*4/i, 'Heading4', 'Heading 4'],
    [/subtitle/i, 'Subtitle', 'Subtitle'], [/\btitle\b/i, 'Title', 'Title'], [/caption/i, 'Caption', 'Caption'],
    [/list paragraph/i, 'ListParagraph', 'List Paragraph'], [/normal|body( text)?|plain/i, 'Normal', 'Normal'],
  ];
  function styleFor(typed) { for (var i = 0; i < STYLE_WORDS.length; i++) if (STYLE_WORDS[i][0].test(String(typed || ''))) return STYLE_WORDS[i]; return null; }
  function tableSizeFor(typed) {
    typed = String(typed || '');
    var m = typed.match(/(\d{1,2})\s*(?:x|by|\u00D7)\s*(\d{1,2})/i); var rows = 3; var cols = 3;
    if (m) { rows = +m[1]; cols = +m[2]; }
    else {
      var r = typed.match(/(\d{1,2})\s*rows?/i); var c = typed.match(/(\d{1,2})\s*col(?:umn)?s?/i);
      if (r) rows = +r[1]; if (c) cols = +c[1];
    }
    return [Math.min(Math.max(rows, 1), 30), Math.min(Math.max(cols, 1), 10)];
  }

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
          styleTable(t, t.headerRowCount);
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
    }).then(function (found) { global.OpalAssistTools.report(found); return found.length ? 'Check finished: ' + found.length + ' to fix (listed below).' : 'Check finished: the document is clean.'; });
  }

  /** A real page break after the cursor (or after the selection). */
  function pageBreakHere() {
    return global.Word.run(function (ctx) {
      ctx.document.getSelection().insertBreak('Page', 'After');
      return ctx.sync().then(function () { return 'Page break added after the cursor.'; });
    });
  }

  /** A next-page section break: what follows can carry its own header, footer and page numbering. */
  function sectionBreakHere() {
    return global.Word.run(function (ctx) {
      ctx.document.getSelection().insertBreak('SectionNext', 'After');
      return ctx.sync().then(function () { return 'Section break added: what follows starts a new page and can have its own header and footer.'; });
    });
  }

  /** Header or footer wording on every section. The wording comes from what was typed; the footer can carry "Page X of Y". */
  function setHeaderFooter(kind, typed) {
    var text = wordingFor(kind, typed);
    var clear = /\b(remove|clear|delete|empty|no)\b/i.test(String(typed || '')) && !text;
    var numbers = kind === 'footer' && (/page numbers?|numbering|page x of y/i.test(String(typed || '')) || (!text && !clear && /\bfooter\b/i.test(String(typed || ''))));
    if (!text && !clear && !numbers) {
      return Promise.resolve(kind === 'header'
        ? 'Type the wording in the box first, in quotes — header "Functional Capacity Assessment" — then press Set header. "remove header" clears it.'
        : 'Type it in the box first — footer "Opal Therapy | Confidential" with page numbers — then press Set footer. "remove footer" clears it.');
    }
    return global.Word.run(function (ctx) {
      var sections = ctx.document.sections; sections.load('items');
      return ctx.sync().then(function () {
        var fields = numbers && supports('1.5');
        sections.items.forEach(function (sec) {
          var body = kind === 'header' ? sec.getHeader('Primary') : sec.getFooter('Primary');
          body.clear();
          if (clear) return;
          var p = body.paragraphs.getFirst();
          p.insertText(text + (fields ? (text ? '   |   ' : '') + 'Page ' : ''), 'Start');
          if (fields) { p.getRange('End').insertField('End', 'Page'); p.insertText(' of ', 'End'); p.getRange('End').insertField('End', 'NumPages'); }
          p.font.name = STANDARD.font; p.font.size = STANDARD.table.size; p.font.color = STANDARD.colour.slate;
          p.alignment = kind === 'footer' && !text ? 'Centered' : 'Left';
        });
        return ctx.sync().then(function () {
          var n = sections.items.length; var where = n > 1 ? ' on all ' + n + ' sections' : '';
          if (clear) return 'The ' + kind + ' is cleared' + where + '.';
          if (numbers && !fields) return 'The ' + kind + ' is set' + where + ', but this version of Word cannot add page numbers from an add-in: use Insert > Page Number.';
          return 'The ' + kind + ' is set' + where + (fields ? ', with Page X of Y' : '') + '.';
        });
      });
    });
  }
  function setHeader(typed) { return setHeaderFooter('header', typed); }
  function setFooter(typed) { return setHeaderFooter('footer', typed); }

  /** Give the selected paragraphs a built-in style, so the Opal standard and the contents page both reach them. */
  function styleSelection(typed) {
    var st = styleFor(typed);
    if (!st) return Promise.resolve('Say which style in the box — "make this a heading 2", or title, subtitle, caption, normal — select the text, then press Style selection.');
    return global.Word.run(function (ctx) {
      var paras = ctx.document.getSelection().paragraphs; paras.load('items');
      return ctx.sync().then(function () {
        paras.items.forEach(function (p) { p.styleBuiltIn = st[1]; });
        return ctx.sync().then(function () { return paras.items.length + ' paragraph' + (paras.items.length === 1 ? '' : 's') + ' set to ' + st[2] + '.'; });
      });
    });
  }

  /** An empty table in the Opal table standard after the cursor. Size from "4 x 3" or "5 rows 2 columns"; 3 x 3 otherwise. */
  function insertOpalTable(typed) {
    var size = tableSizeFor(typed);
    return global.Word.run(function (ctx) {
      var t = ctx.document.getSelection().insertTable(size[0], size[1], 'After');
      styleTable(t, 1);
      return ctx.sync().then(function () { return 'Table added: ' + size[0] + ' rows by ' + size[1] + ' columns, in the Opal table style.'; });
    });
  }

  /**
   * Read-only. The document's skeleton — headings, breaks, blank runs, tables, headers and footers —
   * with NO body text, attached to the chat as selected content so a layout question can be answered.
   * It leaves the pane only if the person then sends a message, after the usual check card.
   */
  function layoutSummary() {
    return global.Word.run(function (ctx) {
      var paras = ctx.document.body.paragraphs; paras.load('items/text,items/styleBuiltIn,items/style,items/tableNestingLevel');
      var tables = ctx.document.body.tables; tables.load('items/rowCount,items/headerRowCount');
      var sections = ctx.document.sections; sections.load('items');
      return ctx.sync().then(function () {
        var hf = sections.items.map(function (sec) { var h = sec.getHeader('Primary'); var f = sec.getFooter('Primary'); h.load('text'); f.load('text'); return [h, f]; });
        return ctx.sync().then(function () { return hf; });
      }).then(function (hf) {
        var level = function (p) { var m = String(p.styleBuiltIn || '').match(/^Heading([1-9])$/) || String(p.style || '').match(/heading\s*([1-9])$/i); return m ? +m[1] : 0; };
        var clip = function (t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n) + '...' : t; };
        var items = paras.items; var lines = []; var styles = {}; var blank = 0; var run = 0; var outline = 0;
        items.forEach(function (p, i) {
          var name = p.style || p.styleBuiltIn || 'unknown'; styles[name] = (styles[name] || 0) + 1;
          var empty = isEmpty(p.text) && !hasBreak(p.text);
          if (empty && p.tableNestingLevel === 0) { blank++; run++; return; }
          if (run > 1 && lines.length < 400) lines.push('  (' + run + ' blank paragraphs in a row before paragraph ' + (i + 1) + ')');
          run = 0;
          if (hasBreak(p.text) && lines.length < 400) lines.push('  [page break at paragraph ' + (i + 1) + ']');
          var l = level(p);
          if (l && outline < 150) { outline++; lines.push(new Array(l).join('  ') + 'H' + l + ': ' + clip(p.text, 70) + ' (paragraph ' + (i + 1) + ')'); }
          else if (/^(title|subtitle)$/i.test(name)) lines.push(name + ': ' + clip(p.text, 70));
        });
        if (run > 1) lines.push('  (' + run + ' blank paragraphs at the end)');
        var out = ['DOCUMENT LAYOUT SUMMARY — structure only, read by the Opal Assist pane. It holds headings, breaks, styles, headers and footers, and no body text.',
          'Paragraphs: ' + items.length + ' (' + blank + ' blank). Tables: ' + tables.items.length + (tables.items.length ? ' (rows: ' + tables.items.slice(0, 20).map(function (t) { return t.rowCount + (t.headerRowCount ? '' : ' no header row'); }).join(', ') + ')' : '') + '. Sections: ' + sections.items.length + '.'];
        hf.forEach(function (pair, i) { out.push('Section ' + (i + 1) + ' — header: ' + (clip(pair[0].text, 80) || '(empty)') + ' | footer: ' + (clip(pair[1].text, 80) || '(empty)')); });
        out.push('Styles in use: ' + Object.keys(styles).sort(function (a, b) { return styles[b] - styles[a]; }).slice(0, 15).map(function (k) { return k + ' x' + styles[k]; }).join(', '));
        out.push('OUTLINE (in document order)'); out = out.concat(lines.length ? lines : ['  (no headings, breaks or blank runs found)']);
        return out.join('\n').slice(0, 8000);
      });
    }).then(function (summary) {
      if (!global.OpalAssist || typeof global.OpalAssist.setSelection !== 'function') return 'The chat is not ready yet. Try again in a moment.';
      global.OpalAssist.setSelection(summary);
      return 'Layout summary attached to the chat — headings, breaks, headers and footers, no body text. Ask your question below; you will see exactly what is sent first.';
    });
  }

  /** Margins for the whole document. Opal's own unless the person named normal, narrow or wide. */
  function setMargins(typed) {
    if (!supportsDesktop('1.3')) return Promise.resolve(OLD_WORD);
    var m = String(typed || '').match(/\b(normal|narrow|wide)\b/i); var name = m ? m[1].toLowerCase() : 'opal'; var v = MARGINS[name];
    return global.Word.run(function (ctx) {
      var ps = ctx.document.pageSetup;
      ps.topMargin = v[0]; ps.rightMargin = v[1]; ps.bottomMargin = v[2]; ps.leftMargin = v[3];
      return ctx.sync().then(function () { return (name === 'opal' ? 'Opal' : name.charAt(0).toUpperCase() + name.slice(1)) + ' margins set on every page.'; });
    });
  }

  /** Landscape or portrait, from the typed word; with neither, the page turns the other way. */
  function setOrientation(typed) {
    if (!supportsDesktop('1.3')) return Promise.resolve(OLD_WORD);
    var t = String(typed || ''); var want = /landscape|sideways|wide page/i.test(t) ? 'Landscape' : /portrait|upright/i.test(t) ? 'Portrait' : null;
    return global.Word.run(function (ctx) {
      var ps = ctx.document.pageSetup; ps.load('orientation');
      return ctx.sync().then(function () {
        var next = want || (ps.orientation === 'Landscape' ? 'Portrait' : 'Landscape');
        ps.orientation = next;
        return ctx.sync().then(function () { return 'Pages are now ' + next.toLowerCase() + '. For one landscape page only, put a section break before and after it first.'; });
      });
    });
  }

  /** A first page with its own header and footer (a cover page), or the same on every page. */
  function firstPageHeader(typed) {
    if (!supportsDesktop('1.3')) return Promise.resolve(OLD_WORD);
    var off = /\b(same|remove|off|no different|turn off|undo)\b/i.test(String(typed || ''));
    return global.Word.run(function (ctx) {
      ctx.document.pageSetup.differentFirstPageHeaderFooter = !off;
      return ctx.sync().then(function () { return off ? 'The first page now shares the document header and footer.' : 'The first page now has its own header and footer, blank until you fill it. Set header / Set footer still write the ordinary ones.'; });
    });
  }

  global.OpalAssistWordFormat = { STANDARD: STANDARD, applyStandard: applyStandard, tidySpacing: tidySpacing, headingsOnNewPage: headingsOnNewPage, updateContents: updateContents, checkDocument: checkDocument,
    pageBreakHere: pageBreakHere, sectionBreakHere: sectionBreakHere, setHeader: setHeader, setFooter: setFooter, styleSelection: styleSelection, insertOpalTable: insertOpalTable, layoutSummary: layoutSummary, setMargins: setMargins, setOrientation: setOrientation, firstPageHeader: firstPageHeader,
    _wordingFor: wordingFor, _styleFor: styleFor, _tableSizeFor: tableSizeFor };
  global.OpalAssistTools.mount('word', 'Document tools', 'Runs inside Word. Nothing is sent. Undo reverses it.', [
    ['format', 'Apply Opal format', applyStandard], ['tidy', 'Tidy spacing', tidySpacing], ['pages', 'Headings on new page', headingsOnNewPage],
    ['toc', 'Update contents', updateContents], ['check', 'Check document', checkDocument],
    ['break', 'Page break here', pageBreakHere], ['section', 'Section break here', sectionBreakHere],
    ['header', 'Set header', setHeader], ['footer', 'Set footer', setFooter],
    ['style', 'Style selection', styleSelection], ['table', 'Insert table', insertOpalTable],
    ['layout', 'Attach layout to chat', layoutSummary],
    ['margins', 'Set margins', setMargins], ['orientation', 'Landscape / portrait', setOrientation], ['firstpage', 'First-page header', firstPageHeader],
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
