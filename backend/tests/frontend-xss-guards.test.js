'use strict';

/**
 * FRONTEND XSS GUARD REGRESSION (Stage 1).
 *
 * The frontend has no test harness, so these are STATIC guards: they read the
 * served source and assert that every sink fixed in the Stage 1 escaping pass
 * still routes user-authored / Splose-sourced fields through escapeHtml(),
 * that the resource external_url is scheme-allowlisted, and that the invite UI
 * carries the truthful email states. Crude by design — if a refactor renames
 * these renderers, update the assertions alongside it rather than deleting
 * them.
 *
 * Four files, one surface. The leave, CPD, PD-document and credential sinks
 * moved to profile.js when the My Profile domain was lifted out of the shell,
 * the Snapshot work-list sinks moved to reports.js with the Daily & Weekly
 * Snapshot, and the travel overlay and details-panel sinks moved to travel.js
 * with the travel domain; the rest are still inline in mockup_v3.html. All four
 * are read together, so a raw interpolation cannot come back by changing which
 * file it lives in.
 */

const fs = require('fs');
const path = require('path');

const SRC = ['mockup_v3.html', 'profile.js', 'reports.js', 'travel.js']
  .map((f) => fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'current', f), 'utf8'))
  .join('\n');

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
      expect(SRC).toContain(needle);
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
      expect(SRC).not.toContain(needle);
    });
  }
});

// Calendar event fields (21 Nov 2026 audit, Q-01). Titles and locations arrive
// from Outlook, so anyone who can send the therapist a meeting invite controls
// them. typeFirstTitle() returns any title containing '<' unchanged, so the
// escape must wrap its result at the sink.
describe('calendar event fields are escaped (tile, drawer, move impact, feed)', () => {
  const MUST_CONTAIN = [
    ': escapeHtml(typeFirstTitle(opts.title));',
    '<span class="s-sub">${escapeHtml(opts.sub || \'\')}</span>',
    '${escapeHtml(s.note)}</div>',
    '<span style="font-weight:500;">${escapeHtml(s.locationName)}</span>',
    "rows.push(row('Suburb', escapeHtml(s.suburb)",
    'line-height:1.4;">${escapeHtml(addr)}</div>',
    '<span class="ttl">${escapeHtml(i.ttl)}</span><span class="sub">${escapeHtml(i.sub)}</span>',
    '<div class="feed-title">${escapeHtml(item.title)}</div>',
  ];
  for (const needle of MUST_CONTAIN) {
    test(`sink escaped: ${needle.slice(0, 60)}`, () => {
      expect(SRC).toContain(needle);
    });
  }
  const MUST_NOT_CONTAIN = [
    '    : typeFirstTitle(opts.title);\n',
    '<span class="s-sub">${opts.sub || \'\'}</span>',
    'color:var(--ink-soft);">${s.note}</div>',
    '<span style="font-weight:500;">${s.locationName}</span>',
    'line-height:1.4;">${addr}</div>',
    '<span class="ttl">${i.ttl}</span>',
    '<div class="feed-title">${item.title}</div>',
  ];
  for (const needle of MUST_NOT_CONTAIN) {
    test(`raw sink absent: ${needle.slice(0, 50)}`, () => {
      expect(SRC).not.toContain(needle);
    });
  }
});

describe('resource external_url is scheme-allowlisted', () => {
  test('href only rendered for http(s) URLs and escaped', () => {
    expect(SRC).toContain("/^https?:\\/\\//i.test(r.external_url || '')");
    expect(SRC).toContain("escapeHtml(r.external_url)");
    // The raw unguarded href is gone
    expect(SRC).not.toContain('href="\' + r.external_url + \'"');
  });
});

describe('invite UI email-state truthfulness', () => {
  test('success toast only in the emailSent branch; skipped/failed show the copy-link box', () => {
    expect(SRC).toContain('if (d.emailSent) {');
    expect(SRC).toContain('Invite created — email NOT sent');
    expect(SRC).toContain("d.emailFailed");
    expect(SRC).toContain('invite-link-box');
    // 22 Sep 2026: the pending-invite copy-link action moved to people.js
    // (Settings → Users & Roles side panel); it still fetches the real link.
    const PEOPLE = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'current', 'people.js'), 'utf8');
    expect(PEOPLE).toContain("'/api/invites/' + p.invite.id + '/link'");
    expect(PEOPLE).toContain('registerUrl');
    // The old unconditional lie is gone
    expect(SRC).not.toContain("showMsg('✓ Invite sent!', true)");
  });
});

describe('notification renders still escape (pre-existing, pinned)', () => {
  test('both notif-item builders use escapeHtml for title and message', () => {
    const matches = SRC.match(/'<div class="notif-title">' \+ escapeHtml\(n\.title\)/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

describe('escapeHtml helper contract', () => {
  test('helper exists and handles the core metacharacters', () => {
    expect(SRC).toContain('function escapeHtml(str)');
    expect(SRC).toContain("replace(/&/g,'&amp;')");
    expect(SRC).toContain("replace(/</g,'&lt;')");
  });
});
