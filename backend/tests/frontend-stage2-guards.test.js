'use strict';

/**
 * STAGE 2 FRONTEND STATIC GUARDS — freshness honesty, per-user Outlook UI,
 * identity chain UI, practitioner resolution. Same approach as the Stage 1
 * XSS guards: the 24k-line served file has no JS harness, so these pin the
 * shipped source text against regressions.
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'mockup_v3.html'), 'utf8');

describe('fake freshness removed, honest pill + polling present', () => {
  test('the fake "Synced with Splose · 14s ago" pill is gone', () => {
    expect(HTML).not.toContain('Synced with Splose · 14s ago');
  });
  test('real freshness updater + refresh affordance exist', () => {
    expect(HTML).toContain('async function refreshFreshnessNow(');
    expect(HTML).toContain('id="hdr-sync-text"');
    expect(HTML).toContain("refreshFreshnessNow(true)"); // click-to-refresh
    expect(HTML).toContain("txt.textContent = 'Refresh failed — check connection'");
  });
  test('CSP-blocked CDN socket.io is gone; modest hidden-aware polling instead', () => {
    expect(HTML).not.toContain('cdn.socket.io');
    expect(HTML).toContain('function startLivePolling()');
    expect(HTML).toContain('if (document.hidden) return;');
    // Guard against runaway polling: exactly the two documented intervals
    const intervals = HTML.match(/setInterval\(function \(\) \{\s*\n\s*if \(document\.hidden\) return;/g) || [];
    expect(intervals.length).toBe(2);
  });
});

describe('Outlook connect-state UI', () => {
  test('re-auth fetches the auth URL instead of navigating to the JSON endpoint', () => {
    expect(HTML).not.toContain("window.location.href = '/auth/outlook-login?returnUrl=");
    expect(HTML).toContain("await fetch('/auth/outlook-login?returnUrl='");
  });
  test('disconnect flow exists and calls the backend', () => {
    expect(HTML).toContain('async function disconnectOutlookFromSettings(');
    expect(HTML).toContain("fetch('/api/outlook/disconnect', { method: 'POST'");
  });
  test('connected label distinguishes first-sync and empty states', () => {
    expect(HTML).toContain("status.status === 'waiting_first_sync'");
  });
});

describe('identity chain UI', () => {
  test('header identity is bound to the signed-in user, not hardcoded Ann', () => {
    expect(HTML).not.toContain('<div style="font-weight:600;" id="prac-name">Ann Mary Mathew</div>');
    expect(HTML).toContain('bindHeaderIdentity');
  });
  test('booking practitioner comes from the user\'s own mapping, never practitioners[0] blindly', () => {
    expect(HTML).not.toContain('window.SPLOSE_CONFIG.practitionerId = practitioners[0].id;');
    // 18 Sep 2026: owners/admins are no longer handed practitioners[0] either.
    expect(HTML).not.toContain('chosen = practitioners[0]');
    expect(HTML).toContain('/api/splose/my-practitioner');
    expect(HTML).toContain('/api/profile/setup-status');
    expect(HTML).toContain('splosePractitionerId || null');
  });
  test('confirm screen shows the resolved practitioner, not a hardcoded name', () => {
    expect(HTML).not.toContain('<span class="k">Practitioner</span><span class="v">Ann Mary Mathew</span>');
    expect(HTML).toContain('window.SPLOSE_CONFIG.practitionerName');
  });
  test('invite modal carries the treating-therapist flag', () => {
    expect(HTML).toContain('id="invite-treating"');
    expect(HTML).toContain('isTreatingTherapist: inviteRole ===');
  });
  test('setup-status card + owner people surface exist', () => {
    expect(HTML).toContain('id="pf-setup-card"');
    expect(HTML).toContain('async function loadSetupStatusCard()');
    // 22 Sep 2026: Users & Roles is people.js — one row per person, a side
    // panel, and the Splose practitioner picked from a dropdown of names.
    expect(HTML).toContain('id="people-root"');
    expect(HTML).toMatch(/<script src="\/people\.js\?v=\d+" defer><\/script>/);
    const PEOPLE = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'people.js'), 'utf8');
    expect(PEOPLE).toContain("'/api/admin/people'");
    expect(PEOPLE).toContain('/splose-link');
    expect(PEOPLE).toContain('/api/splose/practitioners');
    expect(PEOPLE).not.toMatch(/portalPrompt|window\.prompt\('Splose/);
    // The old typed-id prompt and per-block loaders are gone from the shell.
    for (const gone of ['teamSetSploseId', 'loadTeamSetup', 'id="stg-team-setup"', "fetch('/api/admin/team-setup'"]) {
      expect(`${gone}:${HTML.includes(gone)}`).toBe(`${gone}:false`);
    }
  });
});
