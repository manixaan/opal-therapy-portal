'use strict';

/**
 * SERVICE AGREEMENTS — FRONTEND SURFACE GUARDS.
 *
 * The portal frontend has no browser test harness, so — exactly as
 * interview-surface-guards.test.js and assessment-surface-guards.test.js do —
 * these are STATIC guards. They read serviceagreement.js, its stylesheet, the
 * shell and the participant signing page, and assert the properties that would
 * otherwise only be caught by somebody noticing them in production:
 *
 *   - every interpolated value is escaped before it reaches innerHTML, on BOTH
 *     surfaces. The signing page is the sharper case: it renders values from
 *     the database to a member of the public who has no account;
 *   - the participant page never renders a field the server did not send, and
 *     never posts a value the server did not assign;
 *   - Word actions are hidden unless the SERVER said so — the client never
 *     decides that for itself;
 *   - the shell wiring (stylesheet, script, hub mount, overlay mount, route)
 *     is all actually present, because a card that never mounts is a feature
 *     nobody can reach.
 *
 * Crude by design. If a refactor renames these, update the assertions
 * alongside it rather than deleting them.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'serviceagreement.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'serviceagreement.css'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const SIGN = fs.readFileSync(path.join(FRONTEND, 'service-agreement-sign.html'), 'utf8');
const SERVER = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const HUB = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const NAV = require(path.join(FRONTEND, 'navigation.js'));

const helpers = require(path.join(FRONTEND, 'serviceagreement.js'));

/** Strip comments and every esc() argument, so the scan sees only real sinks. */
function scannable(code) {
  const noComments = code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  // `esc(x.y)` becomes `esc()`, so an escaped interpolation cannot be mistaken
  // for a raw one.
  return noComments.replace(/\besc\((?:[^()]|\([^()]*\))*\)/g, 'esc()');
}

// ═══════════════════════════════════════════════════════════════════════════
//  Escaping
// ═══════════════════════════════════════════════════════════════════════════

describe('every value reaching innerHTML is escaped', () => {
  it('esc() escapes all five characters and is null-safe', () => {
    expect(helpers.esc('<script>"x"&\'y\'</script>'))
      .toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
    expect(helpers.esc(null)).toBe('');
    expect(helpers.esc(undefined)).toBe('');
    expect(helpers.esc(0)).toBe('0');
  });

  it('no bare identifier is concatenated between two quoted literals', () => {
    // The house rule the other extracted modules follow: '…' + ident + '…'
    // must be esc(ident).
    //
    // The exemptions are the two kinds of value that CANNOT come from a
    // stranger: HTML fragments this file has already built and escaped, and
    // values this module computed itself. Everything a server row supplies
    // must be escaped.
    const ALLOWED = new RegExp('^\'\\s*\\+\\s*('
      + [
        // already-built, already-escaped HTML fragments
        'body', 'aside', 'rows', 'list', 'control', 'actions', 'detail',
        // values this module chose itself, never a server string
        'i', 'n', 'ci', 'lvl', 'tag', 't', 'S\\.step',
        // strings that reach confirm()/prompt() or S.notice — the latter is
        // itself escaped by shell(), asserted separately below.
        'to', 'res\\.draft\\.versionLabel', 'res\\.master\\.versionLabel',
        'r\\.status',
      ].join('|')
      + ')\\b');
    const raw = scannable(JS).match(/'\s*\+\s*(?!esc\()[a-zA-Z_$][\w.$]*\s*\+\s*'/g) || [];
    const offenders = [...new Set(raw.filter((x) => !ALLOWED.test(x)))];
    expect(offenders).toEqual([]);
  });

  it('escapes the notice and error banners, which carry server text', () => {
    // `to`, versionLabel and the rest reach S.notice / S.error rather than
    // innerHTML directly, and shell() is where they are escaped.
    expect(JS).toMatch(/esc\(S\.error\)/);
    expect(JS).toMatch(/esc\(S\.notice\)/);
  });

  it('renders document runs as text, never as markup', () => {
    // The preview shows the composed agreement. A clause containing "<b>" must
    // read as those characters, not become bold — and a clause containing a
    // script tag must never execute in a staff member's browser.
    const html = helpers.runsHtml([
      { type: 'text', text: '<img src=x onerror=alert(1)>' },
      { type: 'field', tag: 'OPAL_PARTICIPANT_FULL_NAME', prompt: 'Enter <b>name</b>' },
    ]);
    expect(html).not.toMatch(/<img/);
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;b&gt;name&lt;/b&gt;');
  });

  it('escapes cell and heading text in the preview', () => {
    const heading = helpers.renderBlock({ type: 'heading', level: 1, text: '<script>x</script>', runs: [] });
    expect(heading).not.toMatch(/<script>/);

    const table = helpers.renderBlock({
      type: 'table',
      rows: [{ header: false, cells: [{ paragraphs: [[{ type: 'text', text: '</td><script>x</script>' }]] }] }],
    });
    expect(table).not.toMatch(/<script>/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The client reflects the server; it never decides
// ═══════════════════════════════════════════════════════════════════════════

describe('the client does not invent the document', () => {
  it('carries no clause list, field list or agreement prose of its own', () => {
    // A locally-assembled preview would be a DIFFERENT document from the one
    // the participant receives, which is the failure this design prevents.
    expect(JS).not.toMatch(/OPAL_CLAUSE_/);
    expect(JS).not.toMatch(/OPAL_SCHEDULE_/);
    expect(JS).not.toMatch(/OPAL_BLOCK_/);
    // The only tags named are the two the wizard reads back for the
    // participant's own email address, which is instance data, not structure.
    const tags = [...JS.matchAll(/OPAL_[A-Z_]+/g)].map((m) => m[0]);
    expect([...new Set(tags)].sort()).toEqual(['OPAL_PARTICIPANT_EMAIL']);
  });

  it('renders only portal-authority fields as inputs', () => {
    // A signature, an ABN or an agreement reference must never appear as
    // something a staff member can type into.
    expect(JS).toMatch(/f\.authority === 'portal'/);
  });

  it('builds the preview only from the server-composed blocks', () => {
    expect(JS).toMatch(/\/preview/);
    expect(JS).toMatch(/S\.preview\.blocks/);
  });

  it('shows a value’s origin verbatim rather than guessing it', () => {
    expect(typeof helpers.sourceLabel).toBe('function');
    expect(helpers.sourceLabel('splose')).toMatch(/client record/i);
    expect(helpers.sourceLabel('manual')).toMatch(/you typed/i);
    // An unknown source produces nothing rather than an invented label.
    expect(helpers.sourceLabel('something-new')).toBe('');
  });

  it('says plainly when a value is not recorded anywhere', () => {
    expect(JS).toMatch(/Not recorded anywhere in Opal/);
  });
});

describe('Word actions follow the server’s answer', () => {
  it('gates every Word link on canDownloadWord from the server', () => {
    // Hiding the button is a courtesy; the route refuses it anyway. But the
    // client must not decide for itself that somebody is an owner.
    const docxLinks = [...JS.matchAll(/\/docx[^\n]*/g)];
    expect(docxLinks.length).toBeGreaterThan(0);
    // Every occurrence sits inside the S.canWord branch.
    const canWordBlock = JS.slice(JS.indexOf('if (S.canWord)'), JS.indexOf('actions += \'</div>\''));
    for (const link of docxLinks) {
      expect(canWordBlock).toContain('/docx');
    }
    expect(JS).toMatch(/S\.canWord\s*=\s*res\.canDownloadWord === true/);
  });

  it('gates the master console on canManageMaster from the server', () => {
    expect(JS).toMatch(/S\.canManageMaster\s*=\s*m\.canManageMaster === true/);
  });

  it('never assumes a role locally', () => {
    expect(JS).not.toMatch(/role\s*===\s*'owner'/);
    expect(JS).not.toMatch(/user\.role/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Wiring
// ═══════════════════════════════════════════════════════════════════════════

describe('the shell mounts the feature', () => {
  it('loads the stylesheet and the script', () => {
    expect(SHELL).toMatch(/serviceagreement\.css/);
    expect(SHELL).toMatch(/serviceagreement\.js/);
  });

  it('has exactly ONE mount — the surface — and no separate hub card', () => {
    // The workflow used to also mount a card of its own beside the hub. Two
    // discovery points for one workflow is two places to manage one master,
    // so the card is now a native entry in the Templates grid and this is the
    // only mount left.
    expect(SHELL).toMatch(/id="sva-root"/);
    expect(SHELL).not.toMatch(/id="sva-hub-entry"/);
    expect(JS).not.toMatch(/sva-hub-entry/);
  });

  it('puts the surface at the top level, not inside a tab view', () => {
    // A position:fixed overlay inside a display:none ancestor never paints —
    // the same trap fca.js and letter.js document.
    const rootAt = SHELL.indexOf('id="sva-root"');
    const bodyEnd = SHELL.lastIndexOf('</body>');
    expect(rootAt).toBeGreaterThan(SHELL.lastIndexOf('</script>', bodyEnd) - 1);
    expect(rootAt).toBeLessThan(bodyEnd);
  });

  it('serves the participant signing page from the server', () => {
    expect(SERVER).toMatch(/app\.get\('\/service-agreement-sign'/);
    expect(SERVER).toMatch(/service-agreement-sign\.html/);
  });

  it('scopes every style rule to the sva- prefix', () => {
    // Nothing here may reach another surface.
    const selectors = [...CSS.matchAll(/^\s*(\.[A-Za-z][\w-]*)/gm)].map((m) => m[1]);
    const stray = selectors.filter((s) => !s.startsWith('.sva-'));
    expect(stray).toEqual([]);
  });

  it('exposes the eight wizard steps in order', () => {
    expect(helpers.STEPS).toHaveLength(8);
    expect(helpers.STEPS.map((s) => s.key)).toEqual([
      'participant', 'plan', 'supports', 'preferences',
      'consents', 'provider', 'method', 'issue',
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  The participant signing page
// ═══════════════════════════════════════════════════════════════════════════

describe('the participant signing page', () => {
  it('escapes every value it renders', () => {
    expect(SIGN).toMatch(/function esc\(/);
    const script = SIGN.slice(SIGN.indexOf('<script>'));
    // `id` is the only exemption and it is built as 'f-' + esc(f.tag), so it
    // is already escaped by the time it is interpolated.
    // `id` is built as 'f-' + esc(f.tag) and `attemptsRemaining` is a number
    // the server counted that reaches alertBox(), which writes textContent.
    const ALLOWED = /^'\s*\+\s*(id|value|res\.attemptsRemaining)\b/;
    const raw = scannable(script).match(/'\s*\+\s*(?!esc\()[a-zA-Z_$][\w.$]*\s*\+\s*'/g) || [];
    const offenders = [...new Set(raw.filter((x) => !ALLOWED.test(x)))];
    expect(offenders).toEqual([]);
  });

  it('builds that exempted id from an escaped tag', () => {
    expect(SIGN).toMatch(/var id = 'f-' \+ esc\(f\.tag\)/);
  });

  it('refuses to be indexed or to leak a referrer', () => {
    // The page carries a participant's NDIS number, disability information
    // and their prices.
    expect(SIGN).toMatch(/name="robots"\s+content="noindex, nofollow, noarchive"/);
    expect(SIGN).toMatch(/name="referrer"\s+content="no-referrer"/);
  });

  it('reveals nothing before the recipient confirms their address', () => {
    // The verify step renders only the masked hint the server sent.
    expect(SIGN).toMatch(/id="email-hint"/);
    expect(SIGN).toMatch(/res\.state === 'verify'/);
  });

  it('renders only the fields the server assigned to the session', () => {
    expect(SIGN).toMatch(/res\.assignedFields/);
    // And posts back only what it rendered.
    expect(SIGN).toMatch(/\$\('fields'\)\.querySelectorAll\('\[data-tag\]'\)/);
  });

  it('requires consent, a typed name and explicit intent before signing', () => {
    expect(SIGN).toMatch(/Please agree to sign electronically/);
    expect(SIGN).toMatch(/Please confirm you intend to be bound/);
    expect(SIGN).toMatch(/Please type your full name to sign/);
  });

  it('saves answers before it signs', () => {
    // A signature must never be recorded against a document missing what the
    // participant just typed.
    const signHandler = SIGN.slice(SIGN.indexOf("$('sign-form').addEventListener"));
    const saveAt = signHandler.indexOf("/save");
    const signAt = signHandler.indexOf("/sign'");
    expect(saveAt).toBeGreaterThan(-1);
    expect(saveAt).toBeLessThan(signAt);
  });

  it('describes the signature honestly to the person giving it', () => {
    // Calling a typed name a cryptographic signature would be a false
    // assurance in a legal document.
    expect(SIGN).toMatch(/not a cryptographic digital\s*\n?\s*signature/);
  });

  it('does not explain WHY a dead link is dead', () => {
    // Distinguishing expired from revoked from never-existed tells somebody
    // probing tokens which of their guesses was close. Comments are stripped
    // first — the rule is about what a READER sees, and the file explains the
    // rule to maintainers in prose that would otherwise trip its own check.
    const visible = SIGN
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(visible).not.toMatch(/link (has )?expired/i);
    expect(visible).not.toMatch(/was revoked/i);
    // What it DOES say is the same thing for every dead link.
    expect(SIGN).toMatch(/alertBox\(res\.error\)/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
//  Templates is the canonical home
// ═══════════════════════════════════════════════════════════════════════════

describe('the Service Agreement is a native entry in the Templates collection', () => {
  const tool = (() => {
    // The declaration is data, so it is read out of the source rather than
    // re-typed here — a test that restates the value it is checking proves
    // nothing.
    const m = /var TOOLS = \[([\s\S]*?)\n  \];/.exec(HUB);
    return m ? m[1] : '';
  })();

  it('is declared as a library tool, in the templates collection', () => {
    expect(tool).toMatch(/key: 'service-agreement'/);
    expect(tool).toMatch(/collections: \['templates'\]/);
  });

  it('is categorised "Agreements and forms"', () => {
    expect(tool).toMatch(/category: 'Agreements and forms'/);
  });

  it('carries the title and description the change asked for', () => {
    expect(tool).toMatch(/title: 'Service Agreement'/);
    expect(tool).toMatch(/Create, complete and issue an Opal Therapy Service Agreement/);
  });

  it('answers every search a person would actually type', () => {
    for (const term of ['service agreement', 'ndis agreement', 'participant agreement',
      'agreement', 'service booking']) {
      expect(tool.toLowerCase()).toContain(`'${term}'`);
    }
  });

  it('is permission-gated in the grid, as a courtesy on top of the route', () => {
    expect(tool).toMatch(/permission: 'service_agreements\.access'/);
    // And the gate reads the signed-in user rather than guessing from a role.
    expect(HUB).toMatch(/var perms = user\(\)\.permissions \|\| \[\]/);
  });

  it('opens the one canonical surface and nothing else', () => {
    expect(tool).toMatch(/global\.SVA\.route\(''\)/);
  });

  it('renders with the library’s own card markup, not a bespoke one', () => {
    // It must read as a native member of the grid; a person should not have to
    // learn that some cards are a different kind of thing.
    expect(HUB).toMatch(/function toolCard\(t\) \{[\s\S]*?class="rh2-cardtile rh2-cardtile-tool"/);
    expect(HUB).toMatch(/rh2-cardtile-body/);
    expect(HUB).toMatch(/rh2-row-title/);
  });

  it('leads the grid and is counted with the resources beside it', () => {
    expect(HUB).toMatch(/tools\.map\(toolCard\)\.join\(''\)\s*\n?\s*\+ f\.rows\.map/);
    expect(HUB).toMatch(/f\.rows\.length \+ tools\.length/);
  });

  it('still appears when it is the ONLY match for a search', () => {
    // Otherwise a search for "service booking" would report "no resources
    // match" while the thing being searched for sat one branch away.
    //
    // The empty-result branch renders the tools it was given. (This used to
    // assert a `var onlyTools = toolsFor(f)` line; the folder-view rewrite
    // hoisted that call to a single `var tools = toolsFor(f)` above the
    // branch, so the assertion follows the behaviour rather than the old
    // variable name.)
    expect(HUB).toMatch(/var tools = toolsFor\(f\);/);
    expect(HUB).toMatch(/if \(!f\.rows\.length\) \{\s*\n\s*if \(tools\.length\) \{/);
    expect(HUB).toMatch(/tools\.map\(toolCard\)\.join\(''\)/);
  });

  it('steps aside for a governance facet it cannot honestly answer', () => {
    // A workflow has no authority, cost, population or setting — narrowing by
    // one of those is a request for real resources.
    expect(HUB).toMatch(/f\.topic \|\| f\.cost \|\| f\.population \|\| f\.setting \|\| f\.authority \|\| f\.saved/);
  });
});

describe('the role-aware template surface', () => {
  const { visibleActions } = helpers;

  it('offers an owner the template AND the master', () => {
    const owner = visibleActions({ canManageMaster: true, canWord: true });
    expect(owner).toContain('use-template');
    expect(owner).toContain('manage-master');
    expect(owner).toContain('master-word');
    expect(owner).toContain('versions');
  });

  it('offers an employee the template and NOTHING about the master', () => {
    const staff = visibleActions({ canManageMaster: false, canWord: false });
    expect(staff).toEqual(['use-template']);
    expect(staff).not.toContain('manage-master');
    expect(staff).not.toContain('master-word');
    expect(staff).not.toContain('versions');
  });

  it('decides from the server’s flags, never from a role in the client', () => {
    expect(JS).toMatch(/S\.canManageMaster\s*=\s*m\.canManageMaster === true/);
    expect(JS).toMatch(/S\.canWord\s*=\s*m\.canDownloadWord === true/);
    expect(JS).not.toMatch(/role\s*===\s*'owner'/);
  });

  it('drives the overflow menu off the same decision', () => {
    expect(JS).toMatch(/var allowed = visibleActions\(\{ canManageMaster: S\.canManageMaster, canWord: S\.canWord \}\)/);
  });

  it('makes "Use template" the primary action', () => {
    expect(JS).toMatch(/sva-btn sva-btn-primary" data-sva="new">[\s\S]{0,40}Use template/);
    // and Manage master a secondary one
    expect(JS).toMatch(/sva-btn sva-btn-ghost" data-sva="master">Manage master/);
  });

  it('never calls an individual agreement a template', () => {
    for (const heading of ['Draft agreements', 'Awaiting participant', 'Completed and signed']) {
      expect(JS).toContain(heading);
    }
    expect(JS).not.toMatch(/Draft templates|My templates/);
  });

  it('tells somebody without access what to do, rather than showing an empty screen', () => {
    expect(JS).toMatch(/You do not have access to Service Agreements/);
  });
});

describe('routing', () => {
  const { decodeRoute, encodeRoute } = NAV;

  it('addresses the surface under the Resources tab', () => {
    const r = decodeRoute('#resources/service-agreement');
    expect(r.tab).toBe('resources');
    expect(r.view).toBe('service-agreement');
    expect(encodeRoute(r)).toBe('#resources/service-agreement');
  });

  it('addresses the wizard, an agreement, the master and the history', () => {
    for (const [seg, id] of [['new', 'new'], ['master', 'master'], ['versions', 'versions'],
      ['b1e4d70d-fb1d-4881-b67e-9a4201b31931', 'b1e4d70d-fb1d-4881-b67e-9a4201b31931']]) {
      const r = decodeRoute(`#resources/service-agreement/${seg}`);
      expect(r.view).toBe('service-agreement');
      expect(r.id).toBe(id);
      expect(encodeRoute(r)).toBe(`#resources/service-agreement/${seg}`);
    }
  });

  it('redirects the spellings somebody would plausibly have kept', () => {
    // The card never had an address of its own, so there is no released URL to
    // redirect — these are the forms a person types or a colleague pastes.
    for (const alias of ['#resources/agreements', '#resources/service-agreements',
      '#resources/serviceagreement', '#resources/agreement']) {
      expect(encodeRoute(decodeRoute(alias))).toBe('#resources/service-agreement');
    }
    // An id survives the redirect.
    expect(encodeRoute(decodeRoute('#resources/service-agreements/master')))
      .toBe('#resources/service-agreement/master');
  });

  it('never redirects to itself in a loop', () => {
    const canonical = '#resources/service-agreement';
    expect(encodeRoute(decodeRoute(canonical))).toBe(canonical);
    expect(encodeRoute(decodeRoute(encodeRoute(decodeRoute(canonical))))).toBe(canonical);
  });

  it('degrades a nonsense address to the hub rather than a blank screen', () => {
    expect(decodeRoute('#resources/not-a-view').view).toBe('home');
  });

  it('keeps the Resources tab selected on every child screen', () => {
    for (const seg of ['', '/new', '/master', '/versions', '/some-agreement-id']) {
      expect(decodeRoute(`#resources/service-agreement${seg}`).tab).toBe('resources');
    }
  });

  it('is restored by navigation.js through the one entry point', () => {
    const navSrc = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');
    expect(navSrc).toMatch(/t\.view === 'service-agreement'[\s\S]{0,200}global\.SVA\.route/);
    // and it leaves the Templates collection open underneath, so Back lands
    // where the card was.
    expect(navSrc).toMatch(/openCollection\('templates'\)/);
  });
});

describe('one way in', () => {
  it('exposes a single canonical entry point', () => {
    expect(JS).toMatch(/route: route,/);
    expect(JS).toMatch(/async function route\(what, opts\)/);
  });

  it('gives a participant record a shortcut into the SAME wizard', () => {
    // A contextual "Create service agreement" is a useful shortcut, but it
    // must not become a second creation path with its own engine.
    expect(JS).toMatch(/createFor: function \(clientId\) \{ return route\('new', \{ clientId: clientId \}\); \}/);
    expect(JS).toMatch(/if \(opts && opts\.clientId\)/);
  });

  it('refuses a participant the signed-in user may not see', () => {
    // The client list is server-scoped, so an id absent from it is one they
    // are not entitled to.
    expect(JS).toMatch(/if \(match\) return createFor\(match\);/);
  });

  it('leaves the participant signing page outside the portal entirely', () => {
    expect(SERVER).toMatch(/app\.get\('\/service-agreement-sign'/);
    // It is a served page, not a hash route inside the shell.
    expect(NAV.KNOWN_TABS).not.toContain('service-agreement-sign');
    expect(SIGN).not.toMatch(/id="sva-root"|rh2-nav/);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
//  The participant-record shortcut
// ═══════════════════════════════════════════════════════════════════════════

describe('Create service agreement on a participant record', () => {
  // The action is built inline in the shell, which is not requireable, so —
  // as frontend-stage3-guards.test.js does for every other shell surface —
  // these read the source as text.
  const mount = (() => {
    const start = SHELL.indexOf('function mountClientServiceAgreement(');
    return start === -1 ? '' : SHELL.slice(start, SHELL.indexOf('\n}', start));
  })();

  it('exists, and is mounted from the participant record', () => {
    expect(mount).not.toBe('');
    expect(SHELL).toMatch(/mountClientServiceAgreement\(patientId\);/);
    expect(SHELL).toMatch(/sectionHead\('Documents'\) \+ '<div id="cp-documents"><\/div>'/);
  });

  it('is shown ONLY to a user holding service_agreements.access', () => {
    // Owners hold it implicitly (permissions.js), so this one check covers
    // owner, delegated administrator and delegated employee alike.
    expect(mount).toMatch(/const perms = \(window\.APP_USER && window\.APP_USER\.permissions\) \|\| \[\]/);
    expect(mount).toMatch(/perms\.indexOf\('service_agreements\.access'\) !== -1/);
    expect(mount).toMatch(/if \(!allowed[\s\S]{0,80}hideDocumentsSection\(\);/);
  });

  it('leaves no empty heading behind when it is hidden', () => {
    // An orphaned "Documents" heading is worse than no section.
    expect(SHELL).toMatch(/function hideDocumentsSection\(\)/);
    expect(SHELL).toMatch(/\/documents\/i\.test\(heading\.textContent \|\| ''\)/);
  });

  it('uses the ONE canonical entry point, not a second workflow', () => {
    expect(mount).toMatch(/SVA\.createFor\(String\(patientId\)\)/);
    // and refuses to render at all if that entry point is not there.
    expect(mount).toMatch(/typeof SVA\.createFor !== 'function'/);
    // No second wizard, no second engine, no bespoke agreement call.
    expect(mount).not.toMatch(/fetch\(|\/api\/service-agreements/);
  });

  it('lands on the canonical home rather than painting over another tab', () => {
    expect(mount).toMatch(/switchTab\('resources'\)/);
    expect(mount).toMatch(/closeClientProfile\(\)/);
  });

  it('carries no participant identity in the DOM or the URL', () => {
    // The id travels in a closure, not an attribute a page-source reader or a
    // referrer header would pick up.
    expect(mount).toMatch(/addEventListener\('click'/);
    expect(mount).not.toMatch(/onclick=/);
    expect(mount).not.toMatch(/location\.hash|history\.pushState|\?client|&client/);
    // And the wizard's own address never names a participant.
    expect(JS).toMatch(/setHash\('new'\)/);
    expect(JS).not.toMatch(/setHash\([^)]*clientId/);
  });

  it('matches the panel’s existing action styling and responsive behaviour', () => {
    // Same full-width button in the same padded wrapper as "Book appointment";
    // secondary rather than primary so booking stays the panel's main action.
    expect(mount).toMatch(/btn\.className = 'btn';/);
    expect(mount).toMatch(/btn\.style\.width = '100%';/);
    expect(mount).toMatch(/wrap\.style\.padding = '16px';/);
    expect(SHELL).toMatch(/class="btn primary" style="width:100%"[^>]*quickBook/);
  });

  it('preselects the participant only after the server confirms them', () => {
    // The client list is server-scoped, so an id absent from it belongs to
    // somebody this user is not entitled to see — including anybody in
    // another organisation.
    expect(JS).toMatch(/await searchClients\(''\)/);
    expect(JS).toMatch(/var match = \(S\.clients \|\| \[\]\)\.filter/);
    expect(JS).toMatch(/if \(match\) return createFor\(match\);/);
    expect(JS).toMatch(/That participant could not be opened/);
  });

  it('keeps Templates as the canonical home', () => {
    // The shortcut opens the same surface; it does not become a home of its own.
    expect(mount).not.toMatch(/renderOverview|sva-tpl-head|TOOLS/);
    expect(JS).toMatch(/route: route,/);
  });
});
