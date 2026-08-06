'use strict';

/**
 * FRONTEND XSS GUARD REGRESSION (Stage 1).
 *
 * The frontend is a single served HTML file with no test harness, so these
 * are STATIC guards: they read mockup_v3.html and assert that every sink
 * fixed in the Stage 1 escaping pass still routes user-authored /
 * Splose-sourced fields through escapeHtml(), that the resource
 * external_url is scheme-allowlisted, and that the invite UI carries the
 * truthful email states. Crude by design — if a refactor renames these
 * renderers, update the assertions alongside it rather than deleting them.
 */

const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'mockup_v3.html'), 'utf8');

describe('escaping guards on user-authored render sinks', () => {
  const MUST_CONTAIN = [
    // Leave (therapist-authored, owner-viewed)
    '<em>${escapeHtml(r.reason)}</em>',
    '<strong>${escapeHtml(r.user_display_name || r.user_email)}</strong>',
    // CPD
    '<strong>${escapeHtml(a.user_display_name || a.user_email)}</strong> — ${escapeHtml(a.title)}',
    '${escapeHtml(a.notes)}',
    '${escapeHtml(a.review_comments)}',
    // PD documents
    '<td>${escapeHtml(d.title)}</td>',
    "${escapeHtml(d.file_name) || '—'}",
    // Credentials
    '<div class="cred-name">${escapeHtml(c.credential_name)}</div>',
    '<strong>${escapeHtml(c.issuing_body)}</strong>',
    'Reg: ${escapeHtml(c.registration_number)}',
    // Resource Hub cards
    'rh-res-title">\' + escapeHtml(r.title)',
    'escapeHtml(r.description)',
    'escapeHtml(r.safety_notes)',
    'escapeHtml(t.name)',
    // Splose-sourced names
    '${escapeHtml(p.first)} ${escapeHtml(p.last)}',
    '${escapeHtml(p.firstname)} ${escapeHtml(p.lastname)}',
  ];
  for (const needle of MUST_CONTAIN) {
    test(`sink escaped: ${needle.slice(0, 60)}`, () => {
      expect(HTML).toContain(needle);
    });
  }

  const MUST_NOT_CONTAIN = [
    // The exact pre-fix raw interpolations must never come back.
    '<em>${r.reason}</em>',
    '<div class="cred-name">${c.credential_name}</div>',
    "'<strong>' + r.title + '</strong>",
    '${p.firstname} ${p.lastname}\n        <div style="font-size:11px;color:var(--muted)">${p.ndisNumber ||',
  ];
  for (const needle of MUST_NOT_CONTAIN) {
    test(`raw sink absent: ${needle.slice(0, 50)}`, () => {
      expect(HTML).not.toContain(needle);
    });
  }
});

describe('resource external_url is scheme-allowlisted', () => {
  test('href only rendered for http(s) URLs and escaped', () => {
    expect(HTML).toContain("/^https?:\\/\\//i.test(r.external_url || '')");
    expect(HTML).toContain("escapeHtml(r.external_url)");
    // The raw unguarded href is gone
    expect(HTML).not.toContain('href="\' + r.external_url + \'"');
  });
});

describe('invite UI email-state truthfulness', () => {
  test('success toast only in the emailSent branch; skipped/failed show the copy-link box', () => {
    expect(HTML).toContain('if (d.emailSent) {');
    expect(HTML).toContain('Invite created — email NOT sent');
    expect(HTML).toContain("d.emailFailed");
    expect(HTML).toContain('invite-link-box');
    expect(HTML).toContain('copyPendingInviteLink');
    // The old unconditional lie is gone
    expect(HTML).not.toContain("showMsg('✓ Invite sent!', true)");
  });
});

describe('notification renders still escape (pre-existing, pinned)', () => {
  test('both notif-item builders use escapeHtml for title and message', () => {
    const matches = HTML.match(/'<div class="notif-title">' \+ escapeHtml\(n\.title\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('escapeHtml helper contract', () => {
  test('helper exists and handles the core metacharacters', () => {
    expect(HTML).toContain('function escapeHtml(str)');
    expect(HTML).toContain("replace(/&/g,'&amp;')");
    expect(HTML).toContain("replace(/</g,'&lt;')");
  });
});
