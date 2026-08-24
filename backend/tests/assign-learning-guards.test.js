'use strict';

/**
 * ASSIGN LEARNING — what an Owner sees, and what they must not.
 *
 * Static-source assertions in the house style. The whole point of this change
 * is a ROLE-DEPENDENT surface: the same route renders a personal record for a
 * therapist and a management repository for an Owner. That distinction lives
 * in a handful of branches, and nothing else in the app fails if one of them
 * is accidentally deleted — so the branches are pinned here.
 *
 * The single most important assertion in this file is that the personal
 * panels are wrapped in a role check rather than a CSS class. A stylesheet can
 * be overridden, a `display:none` can be inspected away, and either would put
 * another employee's learning record on the Owner's screen. Not rendering is
 * the only version of "hidden" that holds.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const HUB = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.css'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'learning-routes.js'), 'utf8');

/** The hub body with comments stripped — what a user can actually reach. */
const VISIBLE = HUB
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !/^\s*(\/\/|\*)/.test(line))
  .join('\n');

/** The text of one function, from its declaration to the next one. */
function fn(name) {
  const start = HUB.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const next = HUB.indexOf('\n  function ', start + 10);
  return HUB.slice(start, next === -1 ? HUB.length : next);
}

// ═════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═════════════════════════════════════════════════════════════════════════════

describe('the owner navigates to Assign Learning', () => {
  test('the nav label depends on the role', () => {
    expect(HUB).toContain("['learning', isOwner() ? 'Assign Learning' : 'My Learning']");
  });

  test('staff keep My Learning — the label is not renamed globally', () => {
    expect(HUB).toContain("'My Learning'");
    expect(fn('renderLearning')).toContain("<h1 class=\"rh2-h1\">My Learning</h1>");
  });

  test('the route key is unchanged, so existing links still work', () => {
    // Renaming the view key would break every RH2.nav('learning') call, the
    // notification deep links, and the induction walkthrough.
    expect(HUB).toContain("RH2.nav(\\'learning\\')");
    expect(HUB).toContain("if (view === 'learning')");
    expect(HUB).toContain("S.view === 'learning'");
  });

  test('the owner heading and intro say what the page is for', () => {
    const page = fn('renderAssignLearning');
    expect(page).toContain('Assign Learning</h1>');
    expect(page).toMatch(/browse|Browse/);
    expect(page).toContain('rh2-page-intro');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE PERSONAL PANELS ARE NOT RENDERED FOR AN OWNER
// ═════════════════════════════════════════════════════════════════════════════

describe('an owner has no personal learning panels', () => {
  test('Continue learning and Required for you are inside a role branch', () => {
    const home = fn('renderHome');
    const guard = home.indexOf('if (!isOwner()) {');
    expect(guard).toBeGreaterThan(-1);
    // Both headings must come AFTER the guard opens.
    expect(home.indexOf('Continue learning</h2>')).toBeGreaterThan(guard);
    expect(home.indexOf('Required for you</h2>')).toBeGreaterThan(guard);
  });

  test('they are NOT hidden with CSS', () => {
    // The failure this forbids: shipping the markup and hiding it, which
    // leaves another person's learning record one inspector click away.
    expect(CSS).not.toMatch(/rh2-h-cont[\s\S]{0,80}display:\s*none/);
    expect(CSS).not.toMatch(/rh2-h-req[\s\S]{0,80}display:\s*none/);
    expect(VISIBLE).not.toMatch(/hidden[^\n]*rh2-h-cont/);
  });

  test('the grid wrapper is inside the branch too, so no empty row is left', () => {
    const home = fn('renderHome');
    const guard = home.indexOf('if (!isOwner()) {');
    const gridOpen = home.indexOf("out += '<div class=\"rh2-grid-2\">';", guard);
    expect(gridOpen).toBeGreaterThan(guard);
    // And it closes before the branch does.
    expect(home.indexOf("out += '</section></div>';", gridOpen)).toBeGreaterThan(gridOpen);
  });

  test('the owner learning view is a different function entirely', () => {
    expect(HUB).toContain("body = isOwner() ? renderAssignLearning() : renderLearning()");
  });

  test('the owner view never calls the personal loaders', () => {
    const page = fn('renderAssignLearning');
    expect(page).not.toContain('renderMyAssignments');
    expect(page).not.toContain('Continue learning');
    expect(page).not.toContain('Required for you');
  });

  test('and the owner branch loads the library instead of a personal record', () => {
    expect(HUB).toMatch(/if \(isOwner\(\)\) \{\s*\n\s*\/\/[^\n]*\n\s*loadLa\(\);/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE THREE SECTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('the owner page shows the three required sections', () => {
  const page = fn('renderAssignLearning');

  test('Browse by collection', () => {
    expect(page).toContain('Browse by collection');
    expect(page).toContain('aslCollections');
  });

  test('Upcoming professional development', () => {
    expect(page).toContain('Upcoming professional development');
  });

  test('Recently added', () => {
    expect(page).toContain('Recently added');
    expect(page).toContain('ASL_RECENT_LIMIT');
  });

  test('collections come from the DATA, not a hardcoded list', () => {
    // The categories are a free vocabulary in the schema; a practice inventing
    // its own must get a collection for it without a code change.
    const group = fn('aslCollections');
    expect(group).toContain('w.category');
    expect(group).not.toMatch(/\[\s*'induction'\s*,\s*'clinical'/);
  });

  test('an item with no category still appears, in an honest bucket', () => {
    expect(fn('aslCollections')).toContain("'uncategorised'");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ITEM ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('learning items keep every management action, and gain Assign', () => {
  const card = fn('laWorkflowCard');

  test('one card renderer is shared by both owner surfaces', () => {
    // Two copies would drift: an action added to one would silently be missing
    // from the other.
    expect(HUB).toContain('rows.map(laWorkflowCard).join');
    expect(fn('renderAssignLearning')).toContain('rows.map(laWorkflowCard).join');
  });

  test('Assign is present and is the primary action', () => {
    expect(card).toContain('RH2.laAssignOpen');
    expect(card).toContain('rh2-btn-primary');
  });

  test('the existing management actions survive', () => {
    for (const action of ['laEdit', 'laPreview', 'laViewAssignments', 'laDuplicate', 'laArchive']) {
      expect(`${action}:${card.includes(`RH2.${action}`)}`).toBe(`${action}:true`);
    }
  });

  test('an item that cannot be assigned says why instead of offering a dead button', () => {
    expect(card).toContain('var assignable =');
    expect(card).toContain('Add at least one module before this can be assigned');
  });

  test('the metadata shown is only what the system actually stores', () => {
    // module_count, duration, version, counts and updated_at all come from the
    // API. Nothing here invents an audience or a content type.
    expect(card).toContain('w.module_count');
    expect(card).toContain('aslDuration(w)');
    expect(card).toContain('w.updated_at');
    expect(card).not.toMatch(/audience|contentType/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE ASSIGNMENT DIALOG
// ═════════════════════════════════════════════════════════════════════════════

describe('the assignment dialog', () => {
  const dlg = fn('renderLaAssign');

  test('is a real dialog, not a styled div', () => {
    expect(dlg).toContain('role="dialog"');
    expect(dlg).toContain('aria-modal="true"');
    expect(dlg).toContain('aria-labelledby="la-as-title"');
  });

  test('names the learning item being assigned', () => {
    expect(dlg).toContain('a.wfTitle');
    expect(dlg).toContain('rh2-learn-assign-what');
  });

  test('supports search and a role filter', () => {
    expect(dlg).toContain('RH2.laAssignQ');
    expect(dlg).toContain('RH2.laAssignRole');
    expect(fn('laAssignVisible')).toContain('a.roleFilter');
  });

  test('the role filter is built from the roles actually present', () => {
    expect(dlg).toMatch(/roleKeys/);
    expect(dlg).not.toMatch(/\['owner', 'admin', 'therapist'\]/);
  });

  test('offers select-all-visible and a live count', () => {
    expect(dlg).toContain('RH2.laAssignSelectAllVisible');
    expect(dlg).toContain('selected</span>');
    expect(dlg).toContain('aria-live="polite"');
  });

  test('selection is state, not DOM — so it survives a search or filter change', () => {
    // The bug this forbids: reading checked boxes out of the DOM, which the
    // next re-render destroys.
    expect(fn('laAssignToggle')).toContain('a.selected[userId]');
    expect(dlg).toContain('a.selected[u.id]');
    expect(fn('laAssignVisible')).not.toContain('querySelector');
  });

  test('the primary action counts the selection and is disabled until there is one', () => {
    // The pick stage leads to a REVIEW step now (nothing is written until the
    // Owner has seen exactly what will happen), but the original contract
    // stands: the button carries the live count and is disabled with nothing
    // selected.
    expect(dlg).toContain("'Review assignment' + (selCount ? ' (' + selCount + ' '");
    expect(dlg).toContain("(a.busy || !selCount || !(a.wfIds || []).length)");
    expect(dlg).toContain(' disabled');
  });

  test('a submission in flight cannot be submitted again, and only from the review step', () => {
    expect(fn('laAssignSubmit')).toContain("if (!a || a.busy || a.stage !== 'review') return;");
    expect(fn('laAssignSubmit')).toContain('a.busy = true;');
  });

  test('the review step never sends active duplicates, and completed pairs only with an explicit reassign', () => {
    const payload = fn('laAssignPayloadPairs');
    expect(payload).toContain("if (p.state === 'new') return true;");
    expect(payload).toContain("if (p.state === 'completed') return !!a.reassign[");
    expect(payload).toContain('return false; // active duplicates are never sent');
  });

  test('somebody who already has it is marked, and not offered a checkbox', () => {
    const row = fn('laAssignRow');
    expect(row).toContain('laAssignHas(u)');
    expect(row).toContain('Already assigned');
    // Not colour alone — the words carry it.
    expect(row).toContain('rh2-learn-staff-has');
  });

  test('select-all skips people who already have it', () => {
    expect(fn('laAssignSelectAllVisible')).toContain('!laAssignHas(u)');
  });

  test('an error keeps the selection so the owner can retry', () => {
    const submit = fn('laAssignSubmit');
    expect(submit).toContain('a.err = d.error');
    expect(submit).not.toMatch(/a\.err = d\.error[\s\S]{0,120}a\.selected = \{\}/);
  });

  test('partial failure keeps the successes and names who missed out', () => {
    expect(dlg).toContain('a.done.skipped');
    expect(dlg).toContain('could not be assigned:');
    expect(dlg).toContain('already has this in progress');
    expect(dlg).toContain('read-only account');
  });

  test('success names the item and the number assigned', () => {
    expect(dlg).toContain("esc(a.wfTitle || 'This learning') + ' assigned to ' + okCount");
    expect(dlg).toContain('role="status"');
  });

  test('a people list that fails to load says so and offers a way out', () => {
    // Without this the dialog rendered a skeleton for ever, which reads as
    // "still loading" and never resolves.
    expect(dlg).toContain('S.la.staffErr');
    expect(dlg).toContain('RH2.laAssignRetryStaff()');
    expect(dlg).toContain('role="alert"');
    expect(HUB).toContain('laAssignRetryStaff: loadLaStaff');
    expect(fn('loadLaStaff')).toContain("api('/api/learning/staff')");
  });

  test('the people list has a loading state and real empty states', () => {
    expect(dlg).toContain('if (!staff) {');
    expect(dlg).toContain('There are no active people to assign learning to');
    expect(dlg).toContain('Nobody matches');
    expect(dlg).toContain('Everyone shown already has this learning');
  });

  test('escape closes and tab is trapped', () => {
    // The handler now serves both learning dialogs, so it closes whichever is
    // open rather than naming laAssignClose inline.
    expect(HUB).toContain("if (e.key === 'Escape') { e.preventDefault(); close(); return; }");
    expect(HUB).toContain("close = laAssignClose;");
    expect(HUB).toContain("if (e.key !== 'Tab') return;");
    expect(HUB).toContain('e.shiftKey && doc.activeElement === first');
  });

  test('focus moves in on open and returns to the opener on close', () => {
    expect(fn('laAssignOpen')).toContain("doc.getElementById('la-as-q')");
    expect(fn('laAssignOpen')).toContain("openerId: wf ? ('asl-assign-' + wf.id) : ''");
    expect(fn('laAssignClose')).toContain('opener.focus()');
  });

  test('cancel closes without assigning anything', () => {
    expect(dlg).toContain('onclick="RH2.laAssignClose()">Cancel');
    expect(fn('laAssignClose')).not.toContain('api(');
  });

  test('people are shown with initials, because no avatar image is stored', () => {
    expect(fn('laAssignRow')).toContain('initials(u.name, u.email)');
    expect(CSS).toContain('.rh2-avatar');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  SERVER-SIDE ENFORCEMENT
// ═════════════════════════════════════════════════════════════════════════════

describe('the server, not the button, is what protects this', () => {
  test('every management and assignment route is ownerOnly', () => {
    const guarded = [
      "router.get('/api/learning/workflows'",
      "router.post('/api/learning/workflows'",
      "router.post('/api/learning/workflows/:id/assign'",
      "router.get('/api/learning/staff'",
      "router.get('/api/learning/assignments'",
    ];
    for (const decl of guarded) {
      const at = ROUTES.indexOf(decl);
      expect(`${decl}:${at > -1}`).toBe(`${decl}:true`);
      expect(ROUTES.slice(at, at + 200)).toContain('ownerOnly');
    }
  });

  test('the employee routes are NOT owner-gated — staff must reach their own', () => {
    const at = ROUTES.indexOf("router.get('/api/learning/my'");
    expect(at).toBeGreaterThan(-1);
    expect(ROUTES.slice(at, at + 120)).not.toContain('ownerOnly');
  });

  test('duplicate active assignments are refused by the database, not by the UI', () => {
    expect(ROUTES).toContain("ON CONFLICT (user_id, workflow_id) WHERE status IN ('assigned','in_progress')");
    expect(ROUTES).toContain('DO NOTHING');
  });

  test('the assigning owner and the time are recorded', () => {
    expect(ROUTES).toMatch(/assigned_by[\s\S]{0,200}req\.user\.id/);
  });

  test('the staff list excludes accounts that cannot do the work', () => {
    const at = ROUTES.indexOf("router.get('/api/learning/staff'");
    const body = ROUTES.slice(at, at + 1800);
    expect(body).toContain('u.is_active = TRUE');
    expect(body).toContain("COALESCE(u.account_status, 'active') = 'active'");
    expect(body).toContain("u.role <> 'read_only'");
  });

  test('and tells the client who already holds what', () => {
    const at = ROUTES.indexOf("router.get('/api/learning/staff'");
    expect(ROUTES.slice(at, at + 1800)).toContain('active_workflow_ids');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE SHELL
// ═════════════════════════════════════════════════════════════════════════════

describe('the shell', () => {
  test('the changed hub assets are cache-busted', () => {
    // These pins move whenever ANY feature changes the hub assets — the file
    // is shared, so the version is shared. r22/r15 is the Library's
    // hand-managed filing rewrite; bump both this and the list in
    // assessment-surface-guards.test.js together, or CI fails on the half
    // that was forgotten.
    expect(SHELL).toContain('/resourcehub.css?v=r15');
    expect(SHELL).toContain('/resourcehub.js?v=r24');
  });

  test('the dialog and its styles exist for every class the JS renders', () => {
    for (const cls of [
      'rh2-dialog-backdrop', 'rh2-dialog', 'rh2-dialog-head', 'rh2-dialog-body',
      'rh2-dialog-foot', 'rh2-avatar', 'rh2-learn-staff-has', 'rh2-learn-assign-bar',
      'rh2-page-intro', 'rh2-collection-on', 'rh2-learn-cannot', 'rh2-row-btn',
    ]) {
      expect(`${cls}:${CSS.includes('.' + cls)}`).toBe(`${cls}:true`);
    }
  });

  test('the dialog works on a phone', () => {
    const responsive = CSS.slice(CSS.indexOf('@media (max-width: 640px)', CSS.indexOf('.rh2-dialog-backdrop')));
    expect(responsive).toContain('.rh2-dialog');
    expect(responsive).toContain('.rh2-dialog-foot');
  });

  test('focus is visible on the new controls', () => {
    expect(CSS).toContain('.rh2-row-btn:focus-visible');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  CREATING A LEARNING ITEM IS A PORTAL DIALOG, NOT A BROWSER PROMPT
//
//  window.prompt() renders in the browser's own chrome: no portal styling, no
//  category field, no validation message — and Safari and Firefox suppress it
//  outright in some configurations, which makes the primary "create" action
//  look broken. It is a portal dialog now.
// ═════════════════════════════════════════════════════════════════════════════

describe('the new learning item dialog', () => {
  test('no native prompt is used to name a learning item', () => {
    expect(fn('laCreate')).not.toMatch(/\bprompt\(/);
    // And nowhere in the learning surface at all.
    expect(VISIBLE).not.toMatch(/=\s*prompt\(/);
  });

  test('it is a real dialog, labelled and modal, like the assignment one', () => {
    const dlg = fn('renderLaCreate');
    expect(dlg).toContain('role="dialog"');
    expect(dlg).toContain('aria-modal="true"');
    expect(dlg).toContain('aria-labelledby="la-new-title-h"');
    expect(dlg).toContain('rh2-dialog-backdrop');
  });

  test('it collects a name and a category, and the category list is data-driven', () => {
    const dlg = fn('renderLaCreate');
    expect(dlg).toContain('la-new-title');
    expect(dlg).toContain('la-new-cat');
    expect(dlg).toContain('S.la.categories');
  });

  test('an empty name is refused in the dialog rather than posted', () => {
    const submit = fn('laCreateSubmit');
    expect(submit).toContain("if (!title) {");
    expect(submit).toContain('Give the learning item a name.');
    // The guard comes before the request.
    expect(submit.indexOf('Give the learning item a name.')).toBeLessThan(submit.indexOf("api('/api/learning/workflows'"));
  });

  test('a submission in flight cannot be double-sent, and closing is blocked while it is', () => {
    expect(fn('laCreateSubmit')).toContain('if (!c || c.busy) return;');
    expect(fn('laCreateClose')).toContain('if (S.la.create && S.la.create.busy) return;');
  });

  test('Escape closes whichever learning dialog is open', () => {
    // One document-level handler serves both; the create dialog is checked
    // first because it opens from the library with no assign dialog present.
    expect(VISIBLE).toContain("if (S.la.create) { dlg = doc.getElementById('la-new-dialog'); close = laCreateClose; }");
    expect(VISIBLE).toContain("else if (S.la.assign) { dlg = doc.getElementById('la-as-dialog'); close = laAssignClose; }");
  });

  test('the dialog is mounted wherever the assignment dialog is', () => {
    // Otherwise it would be unreachable from one of the owner surfaces.
    expect(HUB.match(/renderLaAssign\(\) \+ renderLaCreate\(\)/g).length).toBe(3);
  });

  test('it is narrower than the people picker', () => {
    expect(CSS).toContain('.rh2-dialog-sm');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE EMPTY LIBRARY OFFERS ONE ACTION, NOT TWO
// ═════════════════════════════════════════════════════════════════════════════

describe('the empty library', () => {
  const page = fn('renderAssignLearning');

  test('the collections section is skipped entirely when nothing exists', () => {
    // It used to render an explanation plus its own "New learning item"
    // button directly above a library header carrying the same button.
    expect(page).toContain('if (all.length) {');
    expect(page.indexOf('if (all.length) {')).toBeLessThan(page.indexOf('Browse by collection</h2>'));
  });

  test('search and the archived toggle are not offered against an empty list', () => {
    expect(page).toMatch(/\(all\.length[\s\S]{0,120}rh2-learn-lib-tools/);
  });

  test('the empty state offers the import as well as a fresh start', () => {
    // The practice's inductions already exist as Resource Hub learning paths
    // and portal walkthroughs, so an empty library is almost never "you have
    // no inductions" — it is "they are not in here yet".
    const empty = page.slice(page.indexOf('No learning items here yet'));
    expect(empty).toContain('rh2-empty-act');
    expect(empty).toContain('RH2.laImport()');
    expect(empty).toContain('RH2.laCreate()');
  });

  test('importing is idempotent and owner-triggered, never automatic', () => {
    // An import that ran on its own could resurrect an induction the Owner
    // deliberately archived.
    expect(fn('laImport')).toContain("api('/api/learning/workflows/import'");
    expect(VISIBLE).not.toMatch(/loadLa\(\)[\s\S]{0,200}laImport\(\)/);
  });

  test('exactly one create button renders when the library is empty', () => {
    // Two identical primary buttons on one screen is the defect this pins.
    const emptyBranch = page.slice(page.indexOf('if (!all.length) {'), page.indexOf('} else if (!rows.length) {'));
    expect((emptyBranch.match(/RH2\.laCreate\(\)/g) || []).length).toBe(1);
    expect((emptyBranch.match(/RH2\.laImport\(\)/g) || []).length).toBe(1);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  ASSIGNMENT STATUS — THE MONITOR LIVES ON THE PAGE THAT ASSIGNS
// ═════════════════════════════════════════════════════════════════════════════

describe('the Owner can see assignment status without leaving Assign Learning', () => {
  const page = fn('renderAssignLearning');

  test('the workspace renders the monitor in place', () => {
    expect(page).toContain('id="asl-assignments"');
    expect(page).toContain('Assignment status');
    expect(page).toContain('renderLaAssignments()');
  });

  test('it is the SAME renderer the Admin tab uses, not a second copy', () => {
    // A parallel assignments table is the failure this pins: two surfaces
    // answering "who is overdue" from different code will eventually disagree,
    // and the Owner has no way to tell which one is lying.
    expect((VISIBLE.match(/function renderLaAssignments\(/g) || []).length).toBe(1);
    expect(VISIBLE).toContain("else if (la.tab === 'assignments') out += renderLaAssignments();");
  });

  test('opening it from a card no longer throws the Owner over to Admin', () => {
    const view = fn('laViewAssignments');
    expect(view).not.toContain("S.view = 'admin'");
    expect(view).toContain("var inPlace = S.view === 'learning'");
    // A filter applied to a table below the fold reads as a dead button.
    expect(view).toContain('scrollIntoView');
  });

  test('landing on Assign Learning loads the assignments, not just the library', () => {
    // Without this the section renders its skeleton forever: nothing else on
    // this page calls loadLaAssignments on first paint.
    expect(fn('loadLa')).toContain("(S.view === 'learning' && isOwner())");
  });

  test('every required status filter is offered, from one control', () => {
    const render = fn('renderLaAssignments');
    for (const label of ['All', 'Not started', 'In progress', 'Completed', 'Overdue']) {
      expect(`${label}:${render.includes(`'${label}'`)}`).toBe(`${label}:true`);
    }
    // The dropdown-plus-tickbox pair it replaced could express Completed AND
    // overdue, which is empty by definition rather than by the data.
    expect(render).not.toContain('afOverdue');
    expect(VISIBLE).not.toContain('Overdue only');
  });

  test('overdue is asked for as a derived flag, never as a stored status', () => {
    // The data model has four lifecycle states and overdue is not one of them.
    const load = fn('loadLaAssignments');
    expect(load).toContain("if (la.afStatus === 'overdue') qs.push('overdue=1');");
    expect(load).toContain("else if (la.afStatus) qs.push('status=' + encodeURIComponent(la.afStatus));");
  });

  test('the table shows recipient, learning item, due date and status', () => {
    const render = fn('renderLaAssignments');
    expect(render).toContain('<th>Employee</th>');
    expect(render).toContain('<th>Learning</th>');
    expect(render).toContain('<th>Due</th>');
    expect(render).toContain('<th>Status</th>');
    expect(render).toContain('laStatusChip(r)');
  });

  test('a completed assignment reads Completed even when its due date passed', () => {
    // The chip is ordered: completion and cancellation are checked before the
    // overdue flag, so a late finish is never labelled Overdue.
    const chip = fn('laStatusChip');
    expect(chip.indexOf("a.status === 'completed'")).toBeLessThan(chip.indexOf('a.overdue'));
    expect(chip.indexOf("a.status === 'cancelled'")).toBeLessThan(chip.indexOf('a.overdue'));
  });
});

describe('the assignment-status data is owner-only on the server', () => {
  test('overdue is derived from the same three facts in the serialiser and the SQL', () => {
    // Two definitions of overdue is the drift this pins: the row the Owner
    // reads and the rows the filter returns must agree.
    expect(ROUTES).toMatch(
      /overdue: !!\(r\.due_at && !r\.completed_at &&\s*\n\s*\(r\.status === 'assigned' \|\| r\.status === 'in_progress'\)/);
    expect(ROUTES).toContain(
      "AND a.status IN ('assigned','in_progress') AND a.due_at < NOW()");
  });

  test('the filters are applied in SQL, not left to the browser', () => {
    // A client-side filter over a 500-row page would silently under-report,
    // and would have sent every employee's record to a screen that only
    // needed one of them.
    const at = ROUTES.indexOf("router.get('/api/learning/assignments'");
    const body = ROUTES.slice(at, at + 1600);
    expect(body).toContain('ownerOnly');
    expect(body).toContain("['assigned', 'in_progress', 'completed', 'cancelled'].includes(status)");
    expect(body).toContain('u.name ILIKE');
    expect(body).toContain('v.title ILIKE');
    // Parameterised, never interpolated.
    expect(body).toContain('params.push');
    expect(body).not.toMatch(/WHERE[\s\S]{0,200}\$\{req\.query/);
  });
});
