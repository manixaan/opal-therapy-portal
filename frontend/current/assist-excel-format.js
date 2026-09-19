/**
 * Opal Assist — sheet tools for Excel.
 *
 * Like the Word tools: fixed CODE against the Opal standard, nothing from the
 * workbook sent anywhere. Every tool works on the SELECTED range (or the used
 * range of the sheet when a single cell is selected), so nothing outside what
 * the person pointed at is touched.
 *
 * Loaded by assist.html only inside Excel (?surface=excel).
 */
(function (global) {
  'use strict';
  if (!global.document) return;
  if (new URLSearchParams(global.location.search).get('surface') !== 'excel') return;

  var C = { primary: '#2F5651', ink: '#263633', mint: '#C5E1CC', mist: '#F4F7F5', white: '#FFFFFF' };
  var FONT = 'Arial';
  var MONEY = /(\$|amount|cost|price|fee|total|budget|funding|rate|invoice|paid|balance|gst)/i;
  var DATEISH = /(date|dob|start|end|due|review|expiry)/i;

  /** The range to work on: the selection, or the sheet's used range when one cell is selected. */
  function target(ctx) {
    var sel = ctx.workbook.getSelectedRange(); sel.load('cellCount');
    return ctx.sync().then(function () {
      var r = sel.cellCount > 1 ? sel : ctx.workbook.worksheets.getActiveWorksheet().getUsedRange();
      r.load('values,rowCount,columnCount,address,numberFormat');
      return ctx.sync().then(function () { return r; });
    });
  }
  var isNum = function (v) { return typeof v === 'number' && isFinite(v); };
  var colLetter = function (i) { var s = ''; i++; while (i > 0) { var m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };

  function opalTable() {
    return global.Excel.run(function (ctx) {
      return target(ctx).then(function (r) {
        if (r.rowCount < 2) return 'Select the table first: a heading row and at least one row beneath it.';
        r.format.font.name = FONT; r.format.font.size = 10; r.format.font.color = C.ink; r.format.verticalAlignment = 'Center';
        var head = r.getRow(0);
        head.format.fill.color = C.primary; head.format.font.color = C.white; head.format.font.bold = true; head.format.wrapText = true;
        for (var i = 1; i < r.rowCount; i++) r.getRow(i).format.fill.color = i % 2 === 0 ? C.mist : C.white;
        ['InsideHorizontal', 'InsideVertical'].forEach(function (e) { var b = r.format.borders.getItem(e); b.style = 'Continuous'; b.color = C.mint; b.weight = 'Thin'; });
        ['EdgeTop', 'EdgeBottom', 'EdgeLeft', 'EdgeRight'].forEach(function (e) { var b = r.format.borders.getItem(e); b.style = 'Continuous'; b.color = C.primary; b.weight = 'Thin'; });
        r.format.autofitColumns();
        return ctx.sync().then(function () { return 'Opal table format applied to ' + r.address.split('!').pop() + '.'; });
      });
    });
  }

  function fitColumns() {
    return global.Excel.run(function (ctx) {
      return target(ctx).then(function (r) {
        r.format.wrapText = false; r.format.autofitColumns();
        return ctx.sync().then(function () {
          // A column of long notes should wrap at a readable width, not run off the screen.
          r.load('format/columnWidth'); var cols = [];
          for (var c = 0; c < r.columnCount; c++) { var col = r.getColumn(c); col.load('format/columnWidth'); cols.push(col); }
          return ctx.sync().then(function () {
            var wrapped = 0;
            cols.forEach(function (col) { if (col.format.columnWidth > 320) { col.format.columnWidth = 320; col.format.wrapText = true; wrapped++; } });
            r.format.autofitRows();
            return ctx.sync().then(function () { return 'Columns fitted' + (wrapped ? '; ' + wrapped + ' long column' + (wrapped > 1 ? 's' : '') + ' wrapped.' : '.'); });
          });
        });
      });
    });
  }

  function freezeTop() {
    return global.Excel.run(function (ctx) {
      var sheet = ctx.workbook.worksheets.getActiveWorksheet();
      sheet.freezePanes.unfreeze(); sheet.freezePanes.freezeRows(1);
      return ctx.sync().then(function () { return 'Top row frozen.'; });
    });
  }

  function totalsRow() {
    return global.Excel.run(function (ctx) {
      return target(ctx).then(function (r) {
        if (r.rowCount < 2) return 'Select the table first: a heading row and the rows to add up.';
        var last = r.values[r.rowCount - 1];
        if (String(last[0]).trim().toLowerCase() === 'total') return 'This table already ends with a Total row.';
        var start = r.address.split('!').pop().split(':')[0];
        var firstCol = start.replace(/\d+/g, ''); var firstRow = parseInt(start.replace(/\D+/g, ''), 10);
        var base = 0; for (var k = 0; k < firstCol.length; k++) base = base * 26 + (firstCol.charCodeAt(k) - 64); base -= 1;
        var row = r.getLastRow().getOffsetRange(1, 0); var formulas = [[]]; var summed = 0;
        for (var c = 0; c < r.columnCount; c++) {
          var numeric = 0; var filled = 0;
          for (var i = 1; i < r.rowCount; i++) { var v = r.values[i][c]; if (v !== '' && v !== null) { filled++; if (isNum(v)) numeric++; } }
          if (filled && numeric === filled) { var L = colLetter(base + c); formulas[0].push('=SUM(' + L + (firstRow + 1) + ':' + L + (firstRow + r.rowCount - 1) + ')'); summed++; }
          else formulas[0].push(c === 0 ? 'Total' : '');
        }
        if (!summed) return 'No column in the selection is entirely numbers, so there is nothing to total.';
        row.formulas = formulas; row.format.font.bold = true; row.format.font.name = FONT;
        var top = row.format.borders.getItem('EdgeTop'); top.style = 'Continuous'; top.color = C.primary; top.weight = 'Medium';
        return ctx.sync().then(function () { return 'Totals row added for ' + summed + ' column' + (summed > 1 ? 's' : '') + '.'; });
      });
    });
  }

  function numberFormats() {
    return global.Excel.run(function (ctx) {
      return target(ctx).then(function (r) {
        if (r.rowCount < 2) return 'Select the table first, including its heading row.';
        var changed = 0;
        for (var c = 0; c < r.columnCount; c++) {
          var heading = String(r.values[0][c] || ''); var numeric = 0; var filled = 0;
          for (var i = 1; i < r.rowCount; i++) { var v = r.values[i][c]; if (v !== '' && v !== null) { filled++; if (isNum(v)) numeric++; } }
          if (!filled || numeric !== filled) continue;
          var body = r.getColumn(c).getResizedRange(0, 0).getOffsetRange(1, 0).getResizedRange(-1, 0);
          var fmt = MONEY.test(heading) ? '$#,##0.00' : DATEISH.test(heading) ? 'd/mm/yyyy' : '#,##0.00';
          var grid = []; for (var k = 1; k < r.rowCount; k++) grid.push([fmt]);
          body.numberFormat = grid; body.format.horizontalAlignment = 'Right'; changed++;
        }
        return ctx.sync().then(function () { return changed ? changed + ' numeric column' + (changed > 1 ? 's' : '') + ' formatted (money as $, dates as d/mm/yyyy, the rest to two decimals).' : 'No all-numeric columns found in the selection.'; });
      });
    });
  }

  /** Read-only. */
  function checkSheet() {
    return global.Excel.run(function (ctx) {
      return target(ctx).then(function (r) {
        var found = []; var v = r.values; var blanks = 0; var textNums = 0; var seen = {}; var dupes = 0;
        for (var i = 1; i < r.rowCount; i++) {
          var key = JSON.stringify(v[i]); if (v[i].some(function (x) { return x !== '' && x !== null; })) { if (seen[key]) dupes++; seen[key] = true; }
          for (var c = 0; c < r.columnCount; c++) {
            var x = v[i][c];
            if (x === '' || x === null) blanks++;
            else if (typeof x === 'string' && /^\s*-?\$?[\d,]+(\.\d+)?\s*$/.test(x)) textNums++;
          }
        }
        for (var c2 = 0; c2 < r.columnCount; c2++) {
          var kinds = {}; for (var j = 1; j < r.rowCount; j++) { var y = v[j][c2]; if (typeof y === 'string' && /^\d{1,4}[\/.-]\d{1,2}[\/.-]\d{1,4}$/.test(y.trim())) kinds[y.indexOf('/') >= 0 ? '/' : y.indexOf('-') >= 0 ? '-' : '.'] = true; }
          if (Object.keys(kinds).length > 1 || (Object.keys(kinds).length === 1)) found.push('Column "' + (v[0][c2] || colLetter(c2)) + '" has dates typed as text' + (Object.keys(kinds).length > 1 ? ' in mixed formats' : '') + ' — Excel cannot sort or filter them as dates');
        }
        if (blanks) found.push(blanks + ' blank cell' + (blanks > 1 ? 's' : '') + ' inside the table');
        if (textNums) found.push(textNums + ' number' + (textNums > 1 ? 's' : '') + ' stored as text (they will not add up)');
        if (dupes) found.push(dupes + ' duplicate row' + (dupes > 1 ? 's' : ''));
        (v[0] || []).forEach(function (h, c3) { if (h === '' || h === null) found.push('Column ' + colLetter(c3) + ' has no heading'); });
        return found;
      });
    }).then(function (found) { global.OpalAssistTools.report(found); return found.length ? 'Check finished: ' + found.length + ' to fix (listed below).' : 'Check finished: the table is clean.'; });
  }

  global.OpalAssistTools.mount('excel', 'Sheet tools', 'These tools run inside Excel on the cells you select. Nothing from the workbook is sent anywhere. Undo reverses any of them.', [
    ['table', 'Opal table format', opalTable], ['fit', 'Fit columns', fitColumns], ['freeze', 'Freeze top row', freezeTop],
    ['totals', 'Add totals row', totalsRow], ['numbers', 'Tidy number formats', numberFormats], ['check', 'Check table', checkSheet],
  ]);
})(typeof window !== 'undefined' ? window : globalThis);
