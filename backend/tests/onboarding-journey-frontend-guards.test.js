'use strict';

/**
 * THE ONBOARDING SURFACE — what the Owner and the employee actually read.
 *
 * Static-source assertions, in the style of onboarding-frontend-guards.test.js.
 * Half of this feature's specification is about LANGUAGE — hide the PKG_
 * codes, stop saying "blocking", say "assigned to 3 people" instead of a bare
 * number — and language is exactly the kind of thing that regresses silently
 * because nothing breaks when it does.
 *
 * So the vocabulary is pinned here. A future edit that reintroduces a database
 * word into the interface fails a test rather than shipping.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const MODULE = fs.readFileSync(path.join(FRONTEND, 'onboarding.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'onboarding.css'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const LOGIN = fs.readFileSync(path.join(FRONTEND, 'login.html'), 'utf8');
const CREATE_PW = fs.readFileSync(path.join(FRONTEND, 'create-password.html'), 'utf8');

/** The module body, with comments stripped — what a USER can actually see. */
const VISIBLE = MODULE
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join('\n');

// ═════════════════════════════════════════════════════════════════════════════
//  DATABASE VOCABULARY STAYS IN THE DATABASE
// ═════════════════════════════════════════════════════════════════════════════

describe('no internal code reaches the screen', () => {
  test('a PKG_ code is never rendered as a subtitle', () => {
    // The specific regression: `esc(p.code)` under `esc(p.title)` in the list,
    // and `esc(p.code)` in the detail header.
    expect(VISIBLE).not.toMatch(/ob-quiet[^']*'\s*\+\s*esc\(p\.code\)/);
    expect(VISIBLE).not.toContain("esc(p.code)\n");
  });

  test('a package code that IS shown is humanised first', () => {
    expect(MODULE).toContain('function packageLabel(');
    expect(MODULE).toContain("esc(packageLabel(r.inheritedFrom))");
    // The old inline strip is gone; there is one definition of the rule.
    expect(VISIBLE).not.toContain("r.inheritedFrom.replace('PKG_', '')");
  });

  test('a raw version number is never printed next to a package name', () => {
    for (const needle of [
      "'v' + p.currentVersion",
      "' · published v' + p.currentVersion",
      "'Publish v' + (p.currentVersion + 1)",
      "' v' + esc(a.packageVersion)",
      "'v' + esc(v.version)",
    ]) {
      expect(`${needle}:${VISIBLE.includes(needle)}`).toBe(`${needle}:false`);
    }
  });

  test('publishing is described by what it does, not by a number', () => {
    expect(MODULE).toContain("'Publish changes'");
    expect(MODULE).toContain("'Publish this package'");
  });
});

describe('"blocking" is gone from the interface', () => {
  test('no chip, badge or sentence says it', () => {
    expect(VISIBLE).not.toContain('>Blocking<');
    expect(VISIBLE).not.toContain("'Blocks activation'");
    expect(VISIBLE).not.toMatch(/blocking activation/);
  });

  test('the replacement says what it actually means', () => {
    expect(MODULE).toContain('Required before they start');
    expect(MODULE).toMatch(/still to finish before this person can start/);
  });

  test('the CSS hook survives — the copy changed, not the styling', () => {
    // Renaming the class as well would have been a bigger, riskier change for
    // no benefit: the dashed-border treatment is still correct.
    expect(CSS).toContain('.ob-chip.is-blocking');
    expect(MODULE).toContain('ob-chip is-blocking');
  });
});

describe('"in use" became a sentence', () => {
  test('the column says what the number counts', () => {
    expect(MODULE).toContain('Assigned to');
    expect(VISIBLE).not.toContain('>In use<');
  });

  test('it is pluralised, so it never reads "1 people"', () => {
    expect(MODULE).toMatch(/people === 1 \? 'person' : 'people'/);
  });

  test('and says so plainly when it is nobody', () => {
    expect(MODULE).toContain('Nobody yet');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  EMPTY STATES
// ═════════════════════════════════════════════════════════════════════════════

describe('empty states explain rather than showing a blank pane', () => {
  test('the packages screen has one', () => {
    expect(MODULE).toContain("empty('No packages yet'");
  });

  test('a package with no documents has one', () => {
    expect(MODULE).toContain("empty('No documents yet'");
  });

  test('an onboarding with no starter pack has one', () => {
    expect(MODULE).toContain("empty('No starter pack yet'");
  });

  test('an onboarding with nothing returned has one', () => {
    expect(MODULE).toContain("empty('Nothing returned yet'");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE SHARED DOCUMENT VIEWER
// ═════════════════════════════════════════════════════════════════════════════

describe('documents open in the portal viewer', () => {
  test('the module calls DocPreview rather than building its own', () => {
    expect(MODULE).toContain('global.DocPreview.open({');
    expect(MODULE).toMatch(/kind:\s*opts\.kind/);
  });

  test('the viewer and its two vendor renderers are loaded by the shell', () => {
    expect(SHELL).toContain('/docpreview.js?v=');
    expect(SHELL).toContain('/vendor/docx-preview.min.js');
    expect(SHELL).toMatch(/vendor\/(pdfjs|jszip)/);
  });

  test('there is a fallback when the viewer is absent or the type unknown', () => {
    // A missing global must not leave a Preview button that does nothing.
    expect(MODULE).toMatch(/global\.open\(opts\.downloadUrl \|\| opts\.url/);
  });

  test('the client never builds a document path itself', () => {
    // previewUrl and downloadUrl come from the server, which is the only place
    // that knows which version is current.
    expect(MODULE).toContain('previewVersionId(d)');
    expect(MODULE).toMatch(/d\.previewUrl/);
  });

  test('the employee document modal offers the full-screen viewer', () => {
    expect(MODULE).toContain('Onboarding.previewMineDocument');
    // The iframe stays as the fallback rather than being replaced outright.
    expect(MODULE).toContain('ob-doc-frame');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE JOURNEY PANEL
// ═════════════════════════════════════════════════════════════════════════════

describe('the journey panel', () => {
  test('renders into a host the assignment view creates', () => {
    expect(MODULE).toContain("getElementById('ob-journey-host')");
    expect(MODULE).toContain('<div id="ob-journey-host">');
  });

  test('takes its next action from the SERVER, never from a local rule', () => {
    // Two places deciding "what next" is two answers that disagree the first
    // time one changes.
    expect(MODULE).toContain('res.nextAction');
    expect(MODULE).toContain('function journeyAction(verb)');
    expect(MODULE).toContain("s.action.verb");
  });

  test('state is carried by a MARK as well as a colour', () => {
    expect(MODULE).toMatch(/var mark = s\.state === 'done' \? '✓'/);
    // And announced to a screen reader.
    expect(MODULE).toContain('ob-sr');
  });

  test('every verb the server can send has a handler', () => {
    const WORKFLOW = fs.readFileSync(
      path.join(__dirname, '..', 'onboarding-workflow-routes.js'), 'utf8'
    );
    const verbs = [...WORKFLOW.matchAll(/verb: '([a-z]+)'/g)].map((m) => m[1]);
    expect(verbs.length).toBeGreaterThan(4);
    for (const verb of [...new Set(verbs)]) {
      expect(`${verb}:${MODULE.includes(`if (verb === '${verb}')`)}`).toBe(`${verb}:true`);
    }
  });

  test('the styles exist for every class it renders', () => {
    for (const cls of [
      'ob-journey', 'ob-journey-step', 'ob-journey-mark', 'ob-journey-main',
      'ob-journey-label', 'ob-journey-detail',
      'ob-pack-list', 'ob-pack-doc', 'ob-pack-title', 'ob-pack-meta', 'ob-pack-actions',
      'ob-review-row', 'ob-review-label', 'ob-review-value', 'ob-review-source',
      'ob-cred', 'ob-details', 'ob-btn-icon',
    ]) {
      expect(`${cls}:${CSS.includes(`.${cls}`)}`).toBe(`${cls}:true`);
    }
  });

  test('introduces no new raw colour — every hex already existed in the file', () => {
    // The file's own rule (see its header) is that colour comes from tokens.
    // Chip borders are the one documented exception and predate this change,
    // so the property that actually holds is narrower and checkable: nothing
    // added here invents a colour the design system had not already agreed.
    const start = CSS.indexOf('/* ── The onboarding journey');
    const end = CSS.indexOf('/* ── Responsive');
    const block = CSS.slice(start, end);
    const rest = CSS.slice(0, start) + CSS.slice(end);
    const hexes = [...new Set(block.match(/#[0-9a-fA-F]{3,8}\b/g) || [])];
    for (const hex of hexes) {
      expect(`${hex}:${rest.includes(hex)}`).toBe(`${hex}:true`);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE ONE-TIME CREDENTIAL
// ═════════════════════════════════════════════════════════════════════════════

describe('the temporary password on screen', () => {
  test('is held only in memory, and dropped once the email is sent', () => {
    expect(MODULE).toContain('pendingCredential');
    expect(MODULE).toContain('S.pendingCredential = null;');
  });

  test('is never written to storage the browser keeps', () => {
    const block = MODULE.slice(MODULE.indexOf('function showCredential'), MODULE.length);
    expect(block).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });

  test('says plainly that it will not be shown again', () => {
    expect(MODULE).toMatch(/only time this password is shown/i);
  });

  test('lets the Owner choose whether it travels in the email', () => {
    expect(MODULE).toContain('includePassword');
    expect(MODULE).toMatch(/rather pass the password on by phone/i);
  });

  test('says what to do when it is already gone', () => {
    expect(MODULE).toMatch(/no longer available to include/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  PRE-POPULATION
// ═════════════════════════════════════════════════════════════════════════════

describe('a pre-filled form explains itself', () => {
  test('the notice renders when the server sends provenance', () => {
    expect(MODULE).toContain('r.prefill');
    expect(MODULE).toMatch(/We filled this in for you/);
  });

  test('it speaks about the forms they returned, not about a model', () => {
    const block = MODULE.slice(MODULE.indexOf('r.prefill'), MODULE.indexOf('r.prefill') + 400);
    expect(block).not.toMatch(/\bAI\b|model|extraction|confidence/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  FIRST SIGN-IN
// ═════════════════════════════════════════════════════════════════════════════

describe('the create-your-password screen', () => {
  test('login sends a gated user there instead of into the portal', () => {
    expect(LOGIN).toContain("window.location.replace('/create-password')");
    expect(LOGIN).toContain('json.mustChangePassword');
  });

  test('login explains an expired temporary password', () => {
    expect(LOGIN).toContain('temporary_password_expired');
  });

  test('the page posts to the shared change-password endpoint', () => {
    expect(CREATE_PW).toContain("fetch('/api/auth/change-password'");
    expect(CREATE_PW).toContain('currentPassword');
    expect(CREATE_PW).toContain('newPassword');
  });

  test('it shows the SAME four rules the server enforces', () => {
    const AUTH = fs.readFileSync(path.join(__dirname, '..', 'auth.js'), 'utf8');
    const policy = AUTH.slice(AUTH.indexOf('function validatePassword'), AUTH.indexOf('const LOGIN_WINDOW_MS'));
    // Showing fewer rules than the server enforces means submitting to find
    // out; showing more means refusing a password the server would accept.
    expect(policy).toContain('length < 8');
    expect(policy).toContain('/[A-Z]/');
    expect(policy).toContain('/[a-z]/');
    expect(policy).toContain('/[0-9]/');
    for (const rule of ['r-len', 'r-upper', 'r-lower', 'r-num']) {
      expect(`${rule}:${CREATE_PW.includes(rule)}`).toBe(`${rule}:true`);
    }
  });

  test('it sends a new starter to their onboarding, on the server\'s say-so', () => {
    expect(CREATE_PW).toContain("json.next === 'onboarding'");
  });

  test('it is not indexed — the URL is only ever reached by a signed-in user', () => {
    expect(CREATE_PW).toContain('name="robots" content="noindex, nofollow"');
  });

  test('it handles an expired session rather than looping on a 403', () => {
    expect(CREATE_PW).toContain('r.status === 401');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE SHELL
// ═════════════════════════════════════════════════════════════════════════════

describe('the changed assets are cache-busted', () => {
  test('both onboarding assets carry the new version', () => {
    // Azure staging does not revalidate on ETag; a stale onboarding.js there
    // would call routes the old code does not know about.
    expect(SHELL).toContain('href="/onboarding.css?v=8"');
    // 10: the management surface is handed to onboarding-journey.js.
    expect(SHELL).toContain('src="/onboarding.js?v=10"');
    expect(SHELL).toContain('src="/onboarding-journey.js?v=7"');
    expect(SHELL).toContain('href="/onboarding-journey.css?v=5"');
  });

  test('no new tab was added — this all lives inside the existing one', () => {
    const tabs = (SHELL.match(/data-tab="onboarding"/g) || []).length;
    expect(tabs).toBe(1);
  });
});

describe('accessibility', () => {
  test('the reorder buttons carry labels, not just arrows', () => {
    expect(MODULE).toContain('aria-label="Move up"');
    expect(MODULE).toContain('aria-label="Move down"');
  });

  test('a disabled reorder button is genuinely disabled, not just faded', () => {
    expect(MODULE).toMatch(/index === 0 \? 'disabled' : ''/);
    expect(CSS).toContain('.ob-btn-icon[disabled]');
  });

  test('the upload progress region announces itself', () => {
    expect(MODULE).toContain('aria-live="polite"');
  });

  test('errors are announced, not only coloured', () => {
    expect(MODULE).toMatch(/role="alert"/);
    expect(CREATE_PW).toContain('role="alert"');
  });

  test('the spinner respects a reduced-motion preference', () => {
    expect(CREATE_PW).toContain('prefers-reduced-motion');
    expect(CSS).toContain('prefers-reduced-motion');
  });

  test('the new panels reflow on a narrow screen', () => {
    const responsive = CSS.slice(CSS.indexOf('@media (max-width: 640px)'));
    for (const cls of ['ob-journey-step', 'ob-pack-list', 'ob-review-row']) {
      expect(`${cls}:${responsive.includes(cls)}`).toBe(`${cls}:true`);
    }
  });
});
