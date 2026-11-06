'use strict';
/**
 * The "Change made in Splose" dialog must never strand the person: its answer
 * buttons used to disable themselves with no failure path, so one lost request
 * left a greyed-out button and blocked every later alert (Nov 2026).
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/splose-sync.js'), 'utf8');
const body = src.slice(src.indexOf('function showNextAlert()'), src.indexOf('// ── Boot'));

test('a failed or lost request puts the question back, with the buttons working', () => {
  expect(body).toMatch(/\.catch\(function \(err\) \{[\s\S]*x\.disabled = false[\s\S]*btn\.textContent = label/);
  expect(body).toContain('ctrl.abort()');
  expect(src).toMatch(/ALERT_ACK_TIMEOUT_MS = \d+/);
});

test('one answer at a time: both buttons wait, and the pressed one says it is working', () => {
  expect(body).toMatch(/buttons\.forEach\(function \(x\) \{ x\.disabled = true; \}\)/);
  expect(body).toContain("btn.textContent = 'Working on it…'");
});

test('already answered (404) closes the dialog instead of showing an error', () => {
  expect(body).toMatch(/r\.status === 404[\s\S]*return finish\(\)/);
});

test('a poll does not queue the alert that is already on screen', () => {
  expect(src).toContain('if (S.alertCurrentId) seen[S.alertCurrentId] = true;');
  expect(body).toContain('S.alertCurrentId = null;');
});
