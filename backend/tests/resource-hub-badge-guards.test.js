/**
 * Frontend guards for the Resource Hub badges.
 *
 * Two regressions must never come back:
 *   1. "Approved and published" — approval and publication are different
 *      claims, and publication is impossible in this release, so the phrase is
 *      untrue as well as conflated.
 *   2. An Opal badge on work Opal did not write.
 *
 * These parse the shipped source rather than a copy, so they fail if someone
 * reintroduces either in resourcehub.js.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'resourcehub.js'), 'utf8');

/**
 * Comment-free view of the module. These guards are about what the code DOES,
 * so prose explaining a removed behaviour must not trip them — otherwise the
 * only way to document why "Opal Approved" was wrong is to not mention it.
 * Conservative: drops block comments and whole-line // comments, leaving
 * inline URLs and string literals untouched.
 */
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(\/\/|\*)/.test(l))
  .join('\n');

describe('publication language', () => {
  test('the phrase "Approved and published" appears nowhere', () => {
    expect(SRC).not.toMatch(/Approved and published/i);
  });

  test('approving reports that the resource remains unpublished', () => {
    const toasts = SRC.match(/'Resource approved\. It remains unpublished\.'/g) || [];
    // Both the admin save path and the workflow action path must say it.
    expect(toasts.length).toBeGreaterThanOrEqual(2);
  });

  test('no success message claims something was published', () => {
    // \b after publish(ed) so the word "publisher" — which is about authorship,
    // not publication — does not trip this guard.
    const claims = SRC.match(/toast\([^)]*\bpublish(ed)?\b[^)]*\)/gi) || [];
    const bad = claims.filter((c) => !/unpublished/i.test(c));
    expect(bad).toEqual([]);
  });
});

describe('source attribution is independent of governance state', () => {
  test('the conflated authBadge() is gone, replaced by two functions', () => {
    expect(SRC).not.toMatch(/function authBadge\s*\(/);
    expect(SRC).toMatch(/function sourceBadge\s*\(/);
    expect(SRC).toMatch(/function governanceBadge\s*\(/);
  });

  test('the "Opal Approved" label — authorship fused to workflow — is gone', () => {
    expect(CODE).not.toMatch(/Opal Approved/);
    expect(CODE).not.toMatch(/Opal Draft/);
  });

  test('the Opal badge is emitted only under source_class === opal-original', () => {
    const fn = CODE.slice(CODE.indexOf('function sourceBadge'), CODE.indexOf('function governanceBadge'));
    expect(fn).toMatch(/opal-original/);

    // Find the branch that emits the Opal badge and inspect its CONDITION.
    // Asserting only that source_class appears somewhere before it is too weak:
    // `cls === 'opal-original' || authority_level === 'internal'` satisfies that
    // while badging third-party work as Opal. The condition must rest on
    // source_class alone.
    const lines = fn.split('\n');
    const opalIdx = lines.findIndex((l) => /Opal Therapy/.test(l));
    expect(opalIdx).toBeGreaterThan(0);
    const condition = lines.slice(0, opalIdx).reverse().find((l) => /if\s*\(/.test(l));
    expect(condition).toBeTruthy();
    expect(condition).toMatch(/cls === 'opal-original'/);
    expect(condition).not.toMatch(/\|\|/);              // no alternative route in
    expect(condition).not.toMatch(/authority_level/);   // authorship != authority level
    expect(condition).not.toMatch(/status/);            // nor workflow state

    // and the function must not consult governance state anywhere
    expect(fn).not.toMatch(/publication_state|approval_ready/);
  });

  test('governanceBadge never emits an authorship claim', () => {
    const fn = SRC.slice(SRC.indexOf('function governanceBadge'), SRC.indexOf('function badges'));
    expect(fn).not.toMatch(/Opal/);
    expect(fn).toMatch(/publication_state/);
  });

  test('"Published" is shown only for publication_state === published', () => {
    const fn = SRC.slice(SRC.indexOf('function governanceBadge'), SRC.indexOf('function badges'));
    const published = fn.slice(0, fn.indexOf('Published') + 10);
    expect(published).toMatch(/publication_state'\)\s*===\s*'published'/);
  });

  test('"Approved" requires the server verdict, never legacy status', () => {
    const fn = SRC.slice(SRC.indexOf('function governanceBadge'), SRC.indexOf('function badges'));
    expect(fn).toMatch(/approval_ready'\)\s*===\s*true/);
    // legacy `status` must not be what grants the Approved badge
    expect(fn).not.toMatch(/pick\(r, 'status'\)/);
  });

  test('an unclassified source shows nothing on an ordinary card', () => {
    const fn = SRC.slice(SRC.indexOf('function sourceBadge'), SRC.indexOf('function governanceBadge'));
    expect(fn).toMatch(/admin \?/);
    expect(fn).toMatch(/Source review pending/);
    // the non-admin branch returns an empty string
    expect(fn).toMatch(/:\s*''/);
  });
});

describe('the server decides approval, not the client', () => {
  const ROUTES = fs.readFileSync(
    path.join(__dirname, '..', 'resource-hub-r2-routes.js'), 'utf8');

  test('approval_ready is computed from the same approvalBlockers the route enforces', () => {
    expect(ROUTES).toMatch(/approval_ready:\s*blockers\.length === 0/);
    expect(ROUTES).toMatch(/governance\.approvalBlockers\(row\)/);
  });

  test('the client never recomputes the blocker policy itself', () => {
    expect(CODE).not.toMatch(/rights_status'\)\s*===\s*'opal-owned'/);
    expect(CODE).not.toMatch(/approvalBlockers\s*\(/);
  });
});
