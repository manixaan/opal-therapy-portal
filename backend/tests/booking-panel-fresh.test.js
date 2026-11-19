'use strict';

/**
 * Smart Booking opens fresh (19 Nov 2026): a new booking starts at the top of
 * the panel with every booking-type group folded — it used to come back
 * scrolled to where the last booking left it, groups still open. A type
 * picked for you (Book Another Client) opens its own group.
 */
const fs = require('fs');
const path = require('path');
const SHELL = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');

test('a fresh open folds every group and scrolls to the top; re-opening with keepState does not', () => {
  const open = SHELL.slice(SHELL.indexOf('function openBookingPanel('), SHELL.indexOf('function closeBookingPanel('));
  expect(open).toMatch(/if \(!opts\.keepState && typeof resetWizard === 'function'\) resetWizard\(\);\s+[\s\S]{0,300}if \(!opts\.keepState\) bspOpenFresh\(\);/);
  const fresh = SHELL.slice(SHELL.indexOf('function bspOpenFresh() {'), SHELL.indexOf('function closeBookingPanel('));
  expect(fresh).toContain("document.querySelectorAll('#booking-cat-chips details.bk-group').forEach(d => { d.open = false; });");
  expect(fresh).toContain('body.scrollTop = 0');
});

test('picking a type opens its group so the choice is visible', () => {
  const pick = SHELL.slice(SHELL.indexOf('function selectBookingLeaf(id) {'), SHELL.indexOf('function selectBookingLeaf(id) {') + 1200);
  expect(pick).toContain("var grp = chosen && chosen.closest('details.bk-group'); if (grp) grp.open = true;");
});
