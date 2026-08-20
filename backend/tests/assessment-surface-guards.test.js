'use strict';

/**
 * THE ASSESSMENT SURFACE — frontend guards.
 *
 * Follows the repository's shell-parsing convention (frontend-stage3-guards,
 * whodas-frontend-guards, fca-frontend-helpers): the static assets are read and
 * asserted on structurally, since there is no DOM test harness.
 *
 * THE REGRESSION THIS FILE EXISTS FOR
 * Choosing a client for a WHODAS assessment and pressing "Complete
 * electronically" called openClientProfile(). That opens the client profile
 * DRAWER — appointment history, cancellation statistics, invoices and a "Book
 * appointment →" button — so the clinician was delivered into the appointment
 * experience instead of the assessment, and the assessment itself opened as a
 * panel inside it. Every test under "no assessment action opens an appointment
 * surface" is there to stop that returning.
 *
 * The rest guard what would be clinically dangerous to lose in a refactor: a
 * Back button that actually goes back, a form that is a page rather than a
 * dialog, state that is never signalled by colour alone, no invented clinical
 * meaning, XSS discipline, and a share action that cannot send.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'assessment.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'assessment.css'), 'utf8');
const RH = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const WHODAS = fs.readFileSync(path.join(FRONTEND, 'whodas.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');

/**
 * Comments state the rules this file enforces, so scanning them would flag the
 * prohibition itself as a violation. These scans look at code only.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}

/** Blank out every esc(...) argument so escaped values cannot read as raw. */
function stripEscArgs(src) {
  let out = '';
  for (let i = 0; i < src.length; i += 1) {
    if (src.startsWith('esc(', i)) {
      let depth = 1;
      let j = i + 4;
      for (; j < src.length && depth > 0; j += 1) {
        if (src[j] === '(') depth += 1;
        else if (src[j] === ')') depth -= 1;
      }
      out += 'esc(ESCAPED)';
      i = j - 1;
      continue;
    }
    out += src[i];
  }
  return out;
}

const CODE = stripComments(JS);
const SCANNABLE = stripEscArgs(CODE);
const RH_CODE = stripComments(RH);
const WHODAS_CODE = stripComments(WHODAS);

const { _helpers: helpers } = require(path.join(FRONTEND, 'assessment.js'));

// ── The regression ──────────────────────────────────────────────────────────

describe('no assessment action opens an appointment surface', () => {
  test('the assessment surface never calls the client profile drawer or the booking composer', () => {
    for (const forbidden of ['openClientProfile', 'quickBook', 'openBookingPanel', 'closeBookingPanel']) {
      expect(`${forbidden}:${CODE.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
  });

  test('choosing a client in the Assessments tab goes to the assessment page', () => {
    // The old pathway. If either call comes back, so does the defect.
    const assessSection = RH_CODE.slice(
      RH_CODE.indexOf('function assessPick'),
      RH_CODE.indexOf('function findInstrument'));
    expect(assessSection).not.toMatch(/openClientProfile|quickBook/);
    expect(assessSection).toMatch(/openAssessmentPage/);
    expect(RH_CODE).toMatch(/Assess\.openForClient/);
  });

  test('the Assessments tab no longer offers the drawer-based pathways at all', () => {
    expect(RH_CODE).not.toMatch(/function assessElectronic/);
    expect(RH_CODE).not.toMatch(/function assessDownload/);
    expect(RH_CODE).not.toMatch(/openClientProfile/);
  });

  test('WHODAS itself never opens an appointment surface', () => {
    for (const forbidden of ['openClientProfile', 'quickBook', 'openBookingPanel']) {
      // closeClientProfile is permitted and required: leaving the drawer for
      // the assessment page is the fix, not the defect.
      expect(`${forbidden}:${WHODAS_CODE.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
    expect(WHODAS_CODE).toMatch(/closeClientProfile/);
  });

  test('the client profile drawer summarises assessments and links out', () => {
    expect(WHODAS_CODE).toMatch(/function renderSummary/);
    expect(WHODAS_CODE).toMatch(/data-whodas="open-page"/);
    expect(SHELL).toMatch(/WHODAS\.mountSummary/);
  });
});

// ── A page, not a panel ─────────────────────────────────────────────────────

describe('the assessment is a page', () => {
  test('the shell loads the stylesheet, the module and the mount point', () => {
    expect(SHELL).toMatch(/<link rel="stylesheet" href="\/assessment\.css/);
    expect(SHELL).toMatch(/<script src="\/assessment\.js/);
    expect(SHELL).toMatch(/id="assessment-root"/);
  });

  test('the mount is a direct child of <body>, after every script', () => {
    // Inside a tab view it would sit under display:none whenever another tab is
    // active and would never paint.
    expect(SHELL.indexOf('id="assessment-root"')).toBeGreaterThan(SHELL.lastIndexOf('</script>'));
  });

  test('it is never rendered as a dialog', () => {
    expect(CODE).not.toMatch(/role="dialog"|aria-modal|showModal|<dialog/);
    expect(CODE).not.toMatch(/modal-backdrop|drawer|side-panel/);
    // And nothing is appended to the body: the surface renders into its mount.
    expect(CODE).not.toMatch(/document\.body\.appendChild|doc\.body\.appendChild/);
  });

  test('the stylesheet gives it a page INSIDE the portal shell, not a takeover of it', () => {
    // The shell's <body> is a flex column whose active view is the scroll
    // container. The surface follows that rule. It was position:fixed;inset:0
    // once — which covered the portal header and navigation, trapped the user
    // behind its own Back button, and killed scrolling because the body never
    // scrolls in this app.
    const root = (CSS.match(/\.assess-root \{[^}]*\}/) || [''])[0];
    expect(root).not.toMatch(/position:\s*fixed/);
    expect(root).not.toMatch(/inset:/);
    expect(root).toMatch(/flex:\s*1 1 auto/);       // fills the space below the header
    expect(root).toMatch(/min-height:\s*0/);
    expect(root).toMatch(/overflow-y:\s*auto/);     // scrolls like every tab view
    expect(root).not.toMatch(/box-shadow/);         // nothing hovering over anything
    expect(CSS).not.toMatch(/backdrop-filter|rgba\(0,\s*0,\s*0,\s*\.[0-9]+\)/);
  });

  test('the portal header and navigation stay visible while an assessment is open', () => {
    // Only the active VIEW yields its space; the header and nav are not views.
    expect(CSS).toMatch(/body\.assess-open \.view\.active \{ display: none; \}/);
    // And the body scroll lock that accompanied the old overlay is gone.
    expect(CSS).not.toMatch(/body\.assess-open \{[^}]*overflow:\s*hidden/);
  });

  test('pressing a portal nav tab closes the surface instead of stranding it', () => {
    // While the page is up the active view is hidden, so switching tabs
    // without closing the surface would land on a blank screen. The wrap
    // follows the shell's own self-installing patch pattern.
    expect(CODE).toMatch(/function hookSwitchTab/);
    expect(CODE).toMatch(/__assessHooked/);
    const hook = CODE.slice(CODE.indexOf('function hookSwitchTab'), CODE.indexOf('function retryHook'));
    expect(hook).toMatch(/if \(S\.open\)/);
    expect(hook).toMatch(/close\(\)/);
    expect(hook).toMatch(/orig\.apply\(this, arguments\)/);   // always calls through
  });

  test('each page starts at the top of its own scroll container', () => {
    expect(CODE).toMatch(/function resetScroll/);
    expect(CODE).toMatch(/host\.scrollTop = 0/);
  });

  test('the WHODAS form is mounted inside the page, not stacked over the app', () => {
    expect(WHODAS_CODE).toMatch(/whodas-viewer--page/);
    expect(WHODAS_CODE).toMatch(/S\.pageHost\.appendChild\(v\)/);
    const pageCss = fs.readFileSync(path.join(FRONTEND, 'whodas.css'), 'utf8');
    const block = (pageCss.match(/\.whodas-viewer--page \{[^}]*\}/) || [''])[0];
    expect(block).toMatch(/position:\s*static/);
  });

  test('Escape does not dismiss a form that is mid-administration', () => {
    expect(WHODAS_CODE).toMatch(/if \(S\.pageHost\) return undefined;/);
  });
});

// ── Back ────────────────────────────────────────────────────────────────────

describe('back navigation', () => {
  test('a record goes back to that client\'s assessments; the list to the tab', () => {
    expect(helpers.backTargetFor({ view: 'record', key: 'k', clientId: '9' }))
      .toEqual({ kind: 'client', key: 'k', clientId: '9' });
    expect(helpers.backTargetFor({ view: 'client', key: 'k', clientId: '9' }))
      .toEqual({ kind: 'assessments-tab' });
    // A record with no client still has somewhere to go.
    expect(helpers.backTargetFor({ view: 'record' })).toEqual({ kind: 'assessments-tab' });
    expect(helpers.backTargetFor(null)).toEqual({ kind: 'assessments-tab' });
  });

  test('Back is a real button and it says where it goes', () => {
    expect(CODE).toMatch(/data-assess="back"/);
    expect(CODE).toMatch(/function backLabel/);
    expect(CODE).toMatch(/'Back to Assessments'/);
  });

  test('Back never calls history.back(), which a deep link has nothing to pop', () => {
    expect(CODE).not.toMatch(/history\.back\(\)/);
  });

  test('every move publishes an address, so the browser Back matches the button', () => {
    expect(CODE).toMatch(/OpalNav\.pushAssessment/);
    expect(helpers.routeFor('record', 'abc')).toBe('#assessment/record/abc');
    expect(helpers.routeFor('client', '9')).toBe('#assessment/client/9');
    expect(helpers.routeFor('record', null)).toBeNull();
    // Ids are URL-encoded, never concatenated raw.
    expect(helpers.routeFor('record', 'a b/c')).toBe('#assessment/record/a%20b%2Fc');
  });

  test('leaving the surface returns to the Assessments tab, not to Calendar', () => {
    expect(CODE).toMatch(/function exitToAssessmentsTab/);
    expect(CODE).toMatch(/RH2\.nav\('instruments'\)/);
  });
});

// ── Availability ────────────────────────────────────────────────────────────

describe('availability is shown as a state, never as a rights verdict', () => {
  test('all five states have labels', () => {
    expect(Object.keys(helpers.AVAILABILITY_LABELS).sort()).toEqual([
      'electronic', 'electronic-and-pdf', 'pdf', 'source-required', 'temporarily-unavailable',
    ]);
    for (const state of Object.keys(helpers.AVAILABILITY_LABELS)) {
      expect(helpers.availabilityLabel({ state })).toBe(helpers.AVAILABILITY_LABELS[state]);
    }
  });

  test('an unknown state renders as itself rather than as "available"', () => {
    expect(helpers.availabilityLabel({ state: 'wibble' })).toBe('wibble');
    expect(helpers.availabilityLabel(null)).toBe('Unknown');
  });

  test('the blanket rights-confirmation blocker is gone from the tab', () => {
    expect(RH_CODE).not.toMatch(/function instrumentIsUsable/);
    expect(RH_CODE).not.toMatch(/rights and clinical review are not\s*'?\s*\+?\s*'?\s*confirmed/);
    expect(RH_CODE).not.toMatch(/Awaiting human confirmation/);
    expect(RH_CODE).not.toMatch(/licensed-for-use/);
  });

  test('actions are gated on what the server said is possible', () => {
    expect(RH_CODE).toMatch(/av\.canStart/);
    expect(CODE).toMatch(/av\.canStart/);
    expect(CODE).toMatch(/av\.canDownloadBlank/);
  });

  test('a missing source is named rather than hinted at', () => {
    expect(CODE).toMatch(/function renderMissingSources/);
    expect(CODE).toMatch(/missingSources/);
    expect(RH_CODE).toMatch(/What is needed before this can be administered/);
  });

  test('the badge is legible without colour', () => {
    // Each state prints its own words; the colour only repeats them.
    expect(CODE).toMatch(/assess-badge--'\s*\+\s*esc\(av\.state/);
    expect(CSS).toMatch(/\.assess-badge--source-required/);
    expect(CSS).toMatch(/\.assess-badge--temporarily-unavailable/);
  });
});

// ── The information page ────────────────────────────────────────────────────

describe('the information page', () => {
  test('it exists, has its own address and a Back control', () => {
    expect(RH_CODE).toMatch(/function renderInstrumentDetail/);
    expect(RH_CODE).toMatch(/RH2\.openInstrument/);
    expect(RH_CODE).toMatch(/RH2\.closeInstrument/);
    expect(RH_CODE).toMatch(/Back to Assessments/);
  });

  test('attribution is always rendered', () => {
    const detail = RH_CODE.slice(RH_CODE.indexOf('function renderInstrumentDetail'));
    expect(detail).toMatch(/Rights holder/);
    expect(detail).toMatch(/attribution/);
  });

  test('governance review is shown as information, not as a gate', () => {
    const detail = RH_CODE.slice(RH_CODE.indexOf('function renderInstrumentDetail'));
    expect(detail).toMatch(/Governance review/);
    // The Start button is decided by availability, never by the review fields.
    const startBlock = detail.slice(detail.indexOf('assessActionable'), detail.indexOf('Source and attribution'));
    expect(startBlock).not.toMatch(/rightsStatus|clinicalStatus/);
  });

  test('no item wording is rendered outside the instrument\'s own document', () => {
    // Bounded to the detail renderer itself: the file continues with the
    // source-review and learning modules, whose own `.items` arrays are
    // learning content, not controlled instrument wording.
    const detail = RH_CODE.slice(
      RH_CODE.indexOf('function renderInstrumentDetail'),
      RH_CODE.indexOf('async function loadSourceReview'));
    expect(detail).toMatch(/itemCount/);           // counts, not questions
    expect(detail).not.toMatch(/\.items\b/);
  });
});

// ── Clinical safety ─────────────────────────────────────────────────────────

describe('no invented clinical meaning', () => {
  test('no severity classification language appears', () => {
    expect(CODE).not.toMatch(/\b(mild|moderate|severe|extreme)\s+disability\b/i);
    expect(CODE).not.toMatch(/severityBand|severityLabel|interpretScore|classifyScore/i);
    expect(CSS).not.toMatch(/--severity|\.severity-/);
  });

  test('nothing is scored in the browser', () => {
    expect(CODE).not.toMatch(/\b106\b/);
    expect(CODE).not.toMatch(/st_s3[26]/);
    expect(CODE).not.toMatch(/toFixed\(/);
  });

  test('a score is never rendered without the method that produced it', () => {
    const cell = CODE.slice(CODE.indexOf('r.overallScore !== null'), CODE.indexOf('</td>', CODE.indexOf('r.overallScore !== null')));
    expect(cell).toMatch(/overallScoreLabel/);
  });

  test('status prints its own word rather than relying on its colour', () => {
    expect(CODE).toMatch(/assess-status--'\s*\+\s*esc\(r\.status\)/);
    expect(CODE).toMatch(/esc\(statusLabel\(r\.status\)\)/);
    expect(helpers.statusLabel('draft')).toBe('Draft');
    expect(helpers.statusLabel('completed')).toBe('Completed');
    expect(helpers.statusLabel('voided')).toBe('Voided');
    expect(helpers.statusLabel('amended')).toBe('Amended');
    expect(helpers.statusLabel('surprise')).toBe('surprise');
  });

  test('an externally completed record is marked as such', () => {
    expect(CODE).toMatch(/completionSource === 'uploaded'/);
    expect(CODE).toMatch(/Completed on paper/);
  });
});

// ── Share ───────────────────────────────────────────────────────────────────

describe('the share action opens for review and cannot send', () => {
  test('there is no send call anywhere in the surface', () => {
    expect(CODE).not.toMatch(/mailto:/);
    expect(CODE).not.toMatch(/\/send\b/);
    expect(CODE).toMatch(/share'/);            // it asks the server to PREPARE
  });

  test('the prepared message is editable before anything happens to it', () => {
    expect(CODE).toMatch(/id="assess-share-subject"/);
    expect(CODE).toMatch(/id="assess-share-body"/);
    expect(CODE).toMatch(/Email \/ share — review before sending/);
  });

  test('the server\'s delivery instruction is shown rather than assumed', () => {
    expect(CODE).toMatch(/s\.delivery \? s\.delivery\.instruction/);
  });

  test('the attachment is fetched from the authenticated path, with no id in a query string', () => {
    expect(CODE).toMatch(/s\.attachment\.downloadPath/);
    expect(CODE).not.toMatch(/\?clientId=|\?client=|&clientName=/);
  });
});

// ── Accessibility and XSS ───────────────────────────────────────────────────

describe('accessibility', () => {
  test('the page has one h1 and focus moves to it on navigation', () => {
    expect(CODE).toMatch(/<h1 class="assess-title" id="assess-title" tabindex="-1">/);
    expect(CODE).toMatch(/function focusTitle/);
  });

  test('loading and error states are announced', () => {
    expect(CODE).toMatch(/role="status"/);
    expect(CODE).toMatch(/role="alert"/);
    expect(CODE).toMatch(/aria-live="polite"/);
  });

  test('every card is labelled and every field has a label element', () => {
    expect(CODE).toMatch(/aria-labelledby="assess-about-h"/);
    expect(CODE).toMatch(/<label for="assess-share-subject">/);
    expect(CODE).toMatch(/<label for="assess-share-body">/);
  });

  test('focus is always visible, and reduced motion is respected', () => {
    expect(CSS).toMatch(/:focus-visible/);
    expect(CSS).toMatch(/prefers-reduced-motion/);
  });

  test('the surface is responsive and the history table stacks on a phone', () => {
    expect(CSS).toMatch(/@media \(max-width: 760px\)/);
    expect(CSS).toMatch(/\.assess-table thead \{ display: none; \}/);
  });
});

describe('XSS discipline', () => {
  test('esc() escapes every dangerous character', () => {
    expect(helpers.esc('<img src=x onerror=alert(1)>'))
      .toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(helpers.esc('"\'&')).toBe('&quot;&#39;&amp;');
    expect(helpers.esc(null)).toBe('');
    expect(helpers.esc(undefined)).toBe('');
  });

  test('server-supplied values are interpolated through esc()', () => {
    const raw = SCANNABLE.match(/'\s*\+\s*(?!esc\()[a-zA-Z_$][\w.$]*\s*\+\s*'/g) || [];
    const allowed = /^'\s*\+\s*(h|out|html)\b/;
    expect([...new Set(raw.filter((s) => !allowed.test(s)))]).toEqual([]);
  });

  test('no inline onclick carries a server id', () => {
    expect(CODE).not.toMatch(/onclick="/);
    expect(CODE).toMatch(/data-assess=/);
  });

  test('the delegated handler only acts on clicks inside its own surface', () => {
    expect(CODE).toMatch(/!root\(\)\.contains\(t\)/);
  });
});

// ── Draft safety ────────────────────────────────────────────────────────────

describe('a mounted form is never torn out from under the clinician', () => {
  test('the page frame updates in place instead of re-rendering', () => {
    expect(CODE).toMatch(/function updateHeader/);
    expect(CODE).toMatch(/if \(frameBuilt && doc\.getElementById\('assess-body'\)\) \{ updateHeader\(\); return; \}/);
  });

  test('the form host is built once per record', () => {
    expect(CODE).toMatch(/mountedFor !== S\.recordId/);
    expect(CODE).toMatch(/mountedFor = S\.recordId/);
  });

  test('moving away releases the instrument module first', () => {
    expect(CODE).toMatch(/function unmountInstrument/);
    expect(CODE).toMatch(/if \(S\.view === 'record'\) unmountInstrument\(\)/);
  });

  test('an amendment moves the address to the new record', () => {
    expect(CODE).toMatch(/onNavigate/);
    expect(WHODAS_CODE).toMatch(/hooks\.onNavigate/);
  });

  test('a duplicate start resumes the existing draft rather than creating a second', () => {
    expect(WHODAS_CODE).toMatch(/err\.status === 409[\s\S]{0,140}landOnAssessment/);
  });
});

// ── Defects found by the post-implementation sweep ──────────────────────────
//
// Each of these was a real, reproduced failure. They are grouped here because
// they share a cause worth naming: a surface that re-renders wholesale, and a
// client that assumed the happy path.

describe('a re-render never steals what the user is typing', () => {
  test('render() saves and restores focus and the caret', () => {
    // Without this the Assessments client search was unusable: the first
    // keystroke tore out its own <input>, focus fell to <body>, and the second
    // keystroke went nowhere — so the two-character minimum needed to search
    // could never be reached by typing.
    const render = RH_CODE.slice(RH_CODE.indexOf('function render()'), RH_CODE.indexOf('function renderNav'));
    expect(render).toMatch(/doc\.activeElement/);
    expect(render).toMatch(/selectionStart/);
    expect(render).toMatch(/\.focus\(/);
    expect(render).toMatch(/setSelectionRange/);
    // The restore must happen after the subtree is replaced, not before.
    expect(render.indexOf('host.innerHTML')).toBeLessThan(render.indexOf('.focus('));
  });

  test('the search debounce is cancelled whenever the panel is torn down', () => {
    expect(RH_CODE).toMatch(/function assessClearDebounce/);
    expect(RH_CODE).toMatch(/function assessCancel\(\) \{ assessClearDebounce\(\);/);
    const openPage = RH_CODE.slice(RH_CODE.indexOf('function openAssessmentPage'));
    expect(openPage.slice(0, 200)).toMatch(/assessClearDebounce\(\)/);
  });

  test('an in-flight search that outlives its panel is discarded, not applied', () => {
    // The timer used to fire against a null S.assess and throw where nothing
    // could catch it. Identity, not key: the key repeats every time the panel
    // reopens.
    const fn = RH_CODE.slice(RH_CODE.indexOf('function assessSearch'), RH_CODE.indexOf('function assessPick'));
    expect(fn).toMatch(/var a = S\.assess/);
    expect((fn.match(/S\.assess !== a/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

describe('a failed load never reads as an empty result', () => {
  test('the history carries its own error, distinct from "none recorded"', () => {
    expect(CODE).toMatch(/recordsErr/);
    const load = CODE.slice(CODE.indexOf('function loadRecords'), CODE.indexOf('function reloadRecords'));
    expect(load).toMatch(/S\.recordsErr = err\.message/);
    expect(load).not.toMatch(/\.catch\(function \(\) \{ S\.records = \[\]; return \[\]; \}\)/);
  });

  test('the empty sentence is scoped to this instrument, not to the client', () => {
    // renderHistory filters by S.key, so an unscoped sentence claimed the
    // client had no assessments at all when they had others.
    const hist = CODE.slice(CODE.indexOf('function renderHistory'), CODE.indexOf('function renderRecordView'));
    expect(hist).toMatch(/S\.recordsErr/);
    expect(hist).not.toMatch(/No assessments have been recorded for this client yet/);
  });

  test('an unavailable instrument module says so instead of doing nothing', () => {
    // startAssessment / blankForm / uploadCompleted each dropped the rejection,
    // so a switched-off module produced a button that silently did nothing.
    expect(WHODAS_CODE).toMatch(/function instrumentFailed/);
    for (const fn of ['startAssessment', 'blankForm', 'uploadCompleted']) {
      const body = WHODAS_CODE.slice(WHODAS_CODE.indexOf('function ' + fn));
      expect(`${fn}:${/\.catch\(instrumentFailed\(/.test(body.slice(0, 700))}`).toBe(`${fn}:true`);
    }
  });
});

describe('the surface knows which instrument it is showing', () => {
  test('S.key is seeded before anything renders or mounts', () => {
    // A restored #assessment/record/:id arrives with no options. Without this
    // S.key stayed null, which made Back a no-op and stopped the module
    // fallback firing.
    const open = CODE.slice(CODE.indexOf('function openRecord'), CODE.indexOf('function close()'));
    expect(open).toMatch(/if \(!S\.key\) S\.key = defKey;/);
    expect(open.indexOf('if (!S.key) S.key = defKey;')).toBeLessThan(open.indexOf('loadDefinition(defKey)'));
  });

  test('the record itself overrides the guess', () => {
    expect(CODE).toMatch(/if \(rec && rec\.assessmentKey\) S\.key = rec\.assessmentKey;/);
  });
});

describe('leaving the surface restores the tab it came from', () => {
  test('the Resources sub-panel is raised, not just the tab', () => {
    // #rh2-root lives inside rh-panel-shared; without this the catalogue could
    // render into a display:none panel.
    const exit = CODE.slice(CODE.indexOf('function exitToAssessmentsTab'), CODE.indexOf('function renderChrome'));
    expect(exit).toMatch(/rhSwitch\('shared'\)/);
    expect(exit.indexOf("switchTab('resources')")).toBeLessThan(exit.indexOf("rhSwitch('shared')"));
  });

  test('a restored Resources route raises it too', () => {
    const nav = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');
    expect(nav).toMatch(/rhSwitch\('shared'\)/);
  });

  test('a deep-linked information page loads the catalogue behind it', () => {
    // Otherwise "Back to Assessments" landed on "No assessments are configured".
    const open = RH_CODE.slice(RH_CODE.indexOf('async function openInstrument'), RH_CODE.indexOf('function closeInstrument'));
    expect(open).toMatch(/if \(!st\.data && !st\.loading\) loadInstruments\(\)/);
  });
});

describe('a button is only offered to someone who can use it', () => {
  test('actions are gated on role as well as on availability', () => {
    // Availability says whether the INSTRUMENT can be administered. It says
    // nothing about whether this user may.
    expect(RH_CODE).toMatch(/function canAdministerAssessment\(\) \{ return isOwner\(\) \|\| role\(\) === 'therapist'; \}/);
    const gate = RH_CODE.slice(RH_CODE.indexOf('function assessActionable'));
    expect(gate.slice(0, 260)).toMatch(/if \(!canAdministerAssessment\(\)\) return false;/);
  });

  test('read_only can see the catalogue the backend grants them', () => {
    const routes = fs.readFileSync(path.join(__dirname, '..', 'assessments-routes.js'), 'utf8');
    expect(routes).toMatch(/CATALOGUE_ROLES = new Set\(\[[^\]]*'read_only'/);
    expect(RH_CODE).toMatch(/function canSeeInstruments\(\)[\s\S]{0,200}read_only/);
  });

  test('the assessment route is role-checked, not just module-checked', () => {
    // assessment.js loads for every role, so "the module exists" says nothing
    // about permission — a deep link would otherwise open a clinical surface.
    const nav = stripComments(fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8'));
    const fn = nav.slice(nav.indexOf('function tabAllowed'), nav.indexOf('function closePage'));
    expect(fn).toMatch(/inList\(allowedForPage, 'resources'\)/);
  });
});

describe('the client is named, not numbered', () => {
  test('a restored client view resolves the name from the roster', () => {
    const nav = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');
    expect(nav).toMatch(/clientNameById/);
    expect(SHELL).toMatch(/window\.clientNameById = function/);
    // PATIENTS is a lexical `let`, so it is NOT reachable as window.PATIENTS —
    // the accessor has to live inside that script.
    expect(CODE).toMatch(/global\.clientNameById/);
  });
});

describe('changed assets are cache-busted', () => {
  test('every asset this feature changed carries a bumped ?v=', () => {
    // express.static sends ETags so a local browser revalidates, but the Azure
    // staging proxy does not — a stale resourcehub.js there would serve the
    // old Assessments tab against the new API.
    for (const [file, version] of [
      ['assessment.js', 3], ['assessment.css', 3],
      ['whodas.js', 5], ['whodas.css', 3],
      // r16/r10: owner-controlled learning (assignment player + admin console)
      ['resourcehub.js', 'r16'], ['resourcehub.css', 'r10'],
      // 6: Onboarding Packages added an 'onboarding' route to the grammar
      ['navigation.js', 6],
      // 8: the onboarding journey — starter packs, returned documents,
      // extracted-detail review, account provisioning — and its styles
      ['onboarding.js', 8], ['onboarding.css', 8],
    ]) {
      const ext = file.endsWith('.css') ? 'href' : 'src';
      expect(`${file}:${SHELL.includes(`${ext}="/${file}?v=${version}"`)}`).toBe(`${file}:true`);
    }
  });
});

describe('the assessment page lays out as a stack', () => {
  test('the card container has its own gap, and empty slots collapse', () => {
    expect(CSS).toMatch(/\.assess-body \{[^}]*gap:\s*16px/);
    expect(CSS).toMatch(/:empty \{ display: none; \}/);
  });
});

// ── Draft deletion ──────────────────────────────────────────────────────────

describe('a draft can be deleted, carefully', () => {
  test('Delete is offered beside Continue, and only on drafts', () => {
    const hist = CODE.slice(CODE.indexOf('function renderHistory'), CODE.indexOf('function renderRecordView'));
    const deleteBlock = hist.slice(hist.indexOf('delete-record') - 220, hist.indexOf('delete-record') + 100);
    expect(hist).toMatch(/data-assess="delete-record"/);
    expect(deleteBlock).toMatch(/r\.status === 'draft'/);
    // Completed records get no delete affordance at all.
    expect((hist.match(/delete-record/g) || []).length).toBe(1);
  });

  test('deletion is confirmed through the module\'s existing dialog, with the agreed copy', () => {
    expect(WHODAS_CODE).toMatch(/function deleteDraft/);
    expect(WHODAS_CODE).toMatch(/Delete this assessment\?/);
    expect(WHODAS_CODE).toMatch(/This will permanently delete the saved assessment and any answers/);
    // Cancel is the module's standard modal-cancel; nothing is sent until the
    // Delete inside the dialog is pressed.
    const dlg = WHODAS_CODE.slice(WHODAS_CODE.indexOf('function deleteDraft'), WHODAS_CODE.indexOf('function openRecordDocument'));
    expect(dlg).toMatch(/data-whodas="modal-cancel">Cancel/);
    expect(dlg).toMatch(/data-whodas="delete-confirm"/);
    expect(dlg).not.toMatch(/method: 'DELETE'/);   // the dialog only asks
  });

  test('the DELETE happens on confirm, and the list reloads without a manual refresh', () => {
    const confirm = WHODAS_CODE.slice(WHODAS_CODE.indexOf("action === 'delete-confirm'"));
    expect(confirm.slice(0, 900)).toMatch(/method: 'DELETE'/);
    expect(confirm.slice(0, 900)).toMatch(/refreshList\(\)/);
    // A failed delete says so rather than silently keeping the row.
    expect(confirm.slice(0, 1400)).toMatch(/Could not delete this assessment/);
  });

  test('the backend deletes softly, per the module\'s own convention', () => {
    const wr = fs.readFileSync(path.join(__dirname, '..', 'whodas-routes.js'), 'utf8');
    const route = wr.slice(wr.indexOf("router.delete('/api/whodas/assessments/:id'"));
    // Migration 021: voided records are retained, never deleted.
    expect(route.slice(0, 1600)).toMatch(/SET status = 'voided'/);
    expect(route.slice(0, 1600)).not.toMatch(/DELETE FROM/);
    // Drafts only; the write re-checks so a just-completed record cannot be swept.
    expect(route.slice(0, 1600)).toMatch(/row\.status !== 'draft'/);
    expect(route.slice(0, 1600)).toMatch(/AND status = 'draft'/);
    // Audited like every other assessment mutation, counts only.
    expect(route.slice(0, 2400)).toMatch(/WHODAS_DRAFT_DELETED/);
    expect(route.slice(0, 2400)).toMatch(/responsesDiscarded/);
    expect(route.slice(0, 2400)).not.toMatch(/client_name|responses:/);
  });

  test('a deleted draft leaves every list; a voided completed record stays', () => {
    const wr = fs.readFileSync(path.join(__dirname, '..', 'whodas-routes.js'), 'utf8');
    const ar = fs.readFileSync(path.join(__dirname, '..', 'assessments-routes.js'), 'utf8');
    for (const src of [wr, ar]) {
      expect(src).toMatch(/NOT \(a\.status = 'voided' AND a\.completed_at IS NULL\)/);
    }
  });

  test('the danger styling repeats the word, never replaces it', () => {
    expect(CSS).toMatch(/\.assess-btn--danger/);
    const whodasCss = fs.readFileSync(path.join(FRONTEND, 'whodas.css'), 'utf8');
    expect(whodasCss).toMatch(/\.whodas-btn--danger/);
    // The button's accessible name is the word Delete, in both surfaces.
    expect(CODE).toMatch(/assess-btn--danger[^>]*data-assess="delete-record"[^>]*>Delete</);
  });
});
