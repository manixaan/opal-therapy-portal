'use strict';

/**
 * GLOBAL UNDO (Cmd+Z / Ctrl+Z) STATIC GUARDS — pin the OpalUndo manager, its
 * native-text-editing guard, and the undo wiring of each reversible flow
 * against regression (same approach as the Stage 1/2/3 guards).
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'mockup_v3.html'), 'utf8');
const RH = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'resourcehub.js'), 'utf8');
// The To-Do flows live in the Snapshot work list, which moved out of the shell
// with the Daily & Weekly Snapshot domain.
const REPORTS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'reports.js'), 'utf8');

describe('OpalUndo manager presence and limits', () => {
  test('window.OpalUndo exists with register/unregister and the _trigger test hook', () => {
    expect(HTML).toContain('window.OpalUndo = (function () {');
    expect(HTML).toContain('register: register');
    expect(HTML).toContain('unregister: unregister');
    expect(HTML).toContain('_trigger: trigger');
  });
  test('stack is session-only and bounded: max 20 entries, 10-minute expiry', () => {
    expect(HTML).toContain('var MAX_ENTRIES = 20;');
    expect(HTML).toContain('var TTL_MS = 10 * 60 * 1000;');
    expect(HTML).toContain('if (Date.now() - e.ts > TTL_MS) continue;');
  });
});

describe('native text editing is never intercepted', () => {
  test('focus guard covers input/textarea/select/contenteditable', () => {
    expect(HTML).toContain(
      "if (tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable) return true;");
    expect(HTML).toContain('if (inNativeEditSurface()) return;');
  });
  test('selections inside editing surfaces stay native too', () => {
    expect(HTML).toContain("host.closest('input, textarea, select, [contenteditable]')");
  });
  test('Cmd+Shift+Z redo is deliberately NOT intercepted (out of scope)', () => {
    expect(HTML).toContain('ev.shiftKey || ev.altKey) return;');
  });
});

describe('reversible flows are wired into the stack', () => {
  test('calendar delete registers the backend restore with the cascaded travel ids', () => {
    expect(HTML).toContain('${dbId}/restore');
    expect(HTML).toContain('JSON.stringify({ travelBlockIds: restoreTravelIds })');
  });
  test('only the calendar event-deleted toast advertises the shortcut', () => {
    expect(HTML.match(/ \(Cmd\+Z to undo\)/g)).toHaveLength(1);
  });
  test('booking create undoes via the existing cascade DELETE using the response dbId', () => {
    expect(HTML).toContain('function __registerBookingUndo(');
    expect(HTML).toContain('__registerBookingUndo(oResult.dbId');
  });
  test('To-Do flows: create, complete, and delete each register (delete shares one restore with the toast button)', () => {
    expect(REPORTS).toContain("label: 'Task created'");
    expect(REPORTS).toContain("label: 'Task completed'");
    expect(REPORTS).toContain('OpalUndo.unregister(undoEntry)');
  });
  test('Resource Hub toggles register the inverse toggle; acknowledgements and quizzes stay append-only', () => {
    expect(RH).toContain('function registerToggleUndo(');
    expect(RH).toContain("registerToggleUndo(on ? 'Favourite added'");
    expect(RH).toContain("registerToggleUndo(on ? 'Marked complete'");
    // append-only flows must never appear in the undo stack
    const ackSection = RH.slice(RH.indexOf('function ackStart'), RH.indexOf('function fbSelect'));
    expect(ackSection).not.toContain('OpalUndo');
    const quizSection = RH.slice(RH.indexOf('async function quizSubmit'), RH.indexOf('function cpdToggle'));
    expect(quizSection).not.toContain('OpalUndo');
  });
});
