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
    expect(HUB).toContain("if (e.key === 'Escape') { e.preventDefault(); laAssignClose(); return; }");
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
    expect(SHELL).toContain('/resourcehub.css?v=r13');
    expect(SHELL).toContain('/resourcehub.js?v=r19');
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
