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
    // It no longer promises browsing, because there is nothing to browse
    // through — the intro names the three things the page does instead.
    expect(page).toMatch(/Assign one to the people who need it/);
    expect(page).toMatch(/edit it exactly as they will see it/);
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

describe('the owner page is ONE catalogue, not a set of shelves', () => {
  const page = fn('renderAssignLearning');

  test('nothing has to be opened before the library is visible', () => {
    // Collections stood between the Owner and their own library: a shelf had
    // to be chosen before anything could be seen, and an item filed under a
    // category nobody thought to click was effectively invisible.
    for (const gone of ['Browse by collection', 'rh2-collections', 'rh2-collection-name',
      'aslCollections', 'aslOpenCollection', 'aslClearCollection']) {
      expect(`${gone}:${page.includes(gone)}`).toBe(`${gone}:false`);
    }
    expect(VISIBLE).not.toContain('function aslCollections(');
    expect(VISIBLE).not.toContain('aslOpenCollection:');
  });

  test('the shelves went, the records did not', () => {
    // Removing a presentation must not remove content: the page still renders
    // every workflow the API returns, archived ones included when asked for.
    expect(page).toContain('var all = la.workflows || []');
    expect(page).toContain('RH2.laToggleArchived');
    expect(fn('aslVisible')).toContain('S.la.workflows || []');
  });

  test('category survives on the record, and stays searchable', () => {
    // Only the browsing workflow built on top of the vocabulary is gone. The
    // card still prints the category and search still matches it, so somebody
    // who thinks in categories can still type "rural" and find the rural items.
    expect(fn('laWorkflowCard')).toContain('aslCatLabel(w.category)');
    expect(fn('aslVisible')).toContain('aslCatLabel(w.category).toLowerCase()');
  });

  test('the search box is filtered state, with no collection cursor behind it', () => {
    expect(fn('aslResetFilters')).not.toContain('collection');
    expect(VISIBLE).toContain("asl: { q: '' }");
  });

  test('Upcoming professional development', () => {
    expect(page).toContain('Upcoming professional development');
  });

  test('Recently added', () => {
    expect(page).toContain('Recently added');
    expect(page).toContain('ASL_RECENT_LIMIT');
  });

  test('Recently added reports; it is no longer a way into a collection', () => {
    const recent = page.slice(page.indexOf('Recently added'));
    expect(recent).not.toContain('aslOpenCollection');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE CATALOGUE SEARCH
// ═════════════════════════════════════════════════════════════════════════════

describe('the catalogue search sits in the header, not beside it', () => {
  const page = fn('renderAssignLearning');

  test('the field has its own full-width row under the heading', () => {
    expect(page).toContain('rh2-learn-cat-search');
    expect(CSS).toMatch(/\.rh2-learn-cat-search\s*\{[^}]*grid-column:\s*1 \/ -1/);
  });

  test('the header is a grid, so the heading and the actions cannot drift apart', () => {
    // It used to be one flex row, where the field was pushed rightwards by
    // whatever happened to sit beside it and settled at a different height
    // from the heading it belongs to.
    expect(CSS).toMatch(/\.rh2-learn-cat-head\s*\{[^}]*display:\s*grid/);
    expect(CSS).toMatch(/\.rh2-learn-cat-head\s*\{[^}]*align-items:\s*center/);
  });

  test('it collapses to one column on a phone rather than overflowing', () => {
    expect(CSS).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.rh2-learn-cat-head \{ grid-template-columns: 1fr; \}/);
  });

  test('search still filters, and can still be cleared', () => {
    expect(page).toContain('RH2.aslSearch(this.value)');
    expect(page).toContain('RH2.aslResetFilters()');
    expect(page).toContain('id="asl-q"');
  });

  test('the field is labelled for a screen reader', () => {
    expect(page).toContain('for="asl-q"');
  });
});
// ═════════════════════════════════════════════════════════════════════════════
//  ITEM ACTIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('an item on Assign Learning offers three actions, and only three', () => {
  const card = fn('laWorkflowCard');
  /** The half of the card every surface renders — everything outside the
   *  `lifecycle` branch is what Assign Learning actually shows. */
  const primary = card.slice(0, card.indexOf('(lifecycle'));

  test('one card renderer is still shared by both owner surfaces', () => {
    // Two copies would drift: an action added to one would silently be missing
    // from the other. What differs between the surfaces is WHICH actions are
    // offered — never how the item itself is described.
    expect(HUB).toContain('rows.map(aslWorkflowCard).join');
    expect(HUB).toContain('rows.map(laLibraryCard).join');
    expect(fn('aslWorkflowCard')).toContain("laWorkflowCard(w, { actions: 'primary' })");
    expect(fn('laLibraryCard')).toContain("laWorkflowCard(w, { actions: 'lifecycle' })");
  });

  test('Assign is present and is the primary action', () => {
    expect(card).toContain('RH2.laAssignOpen');
    expect(card).toContain('rh2-btn-primary');
  });

  test('Assign, Edit and Preview are the actions this surface carries', () => {
    for (const action of ['laAssignOpen', 'laEdit', 'laPreview']) {
      expect(`${action}:${primary.includes(`RH2.${action}`)}`).toBe(`${action}:true`);
    }
  });

  test('the crowding actions are behind the lifecycle branch, not on this page', () => {
    // Each of these sent the Owner somewhere other than the job in hand.
    for (const action of ['laViewAssignments', 'laDuplicate', 'laArchive', 'laDelete']) {
      expect(`${action}:${primary.includes(`RH2.${action}`)}`).toBe(`${action}:false`);
    }
  });

  test('hiding them removed BUTTONS, not capability', () => {
    // The Admin > Learning console still carries the whole lifecycle, and the
    // handlers and the routes behind it are untouched. Simplifying one surface
    // must never quietly become a data cleanup.
    for (const action of ['laViewAssignments', 'laDuplicate', 'laArchive', 'laUnarchive', 'laDelete']) {
      expect(`${action}:${card.includes(`RH2.${action}`)}`).toBe(`${action}:true`);
      expect(`${action} exported:${HUB.includes(`${action}: ${action}`)}`).toBe(`${action} exported:true`);
    }
    for (const route of ['/duplicate', '/archive', '/unarchive']) {
      expect(`${route}:${ROUTES.includes(route)}`).toBe(`${route}:true`);
    }
  });

  test('an archived item can still be brought back from this surface', () => {
    // The one lifecycle action that has to survive here: an archived row with
    // no way out is unreachable content.
    expect(primary).toContain('RH2.laUnarchive');
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
//  ONE INDUCTION, THREE MODES
//
//  Learner, Owner preview and Owner edit are the SAME screens. That is the
//  whole point of the change, and it is exactly the kind of thing that decays
//  quietly: someone adds a control to the editor, the learner never sees it,
//  and a year later the Owner is editing something nobody receives. These
//  assertions pin the shared shell, and — more importantly — pin that edit
//  capability is decided by the render path and the server, never by a flag a
//  learner's page could carry.
// ═════════════════════════════════════════════════════════════════════════════

describe('learner, preview and edit walk the same steps', () => {
  const player = fn('renderAssignment');
  const editor = fn('renderLaEditor');

  test('both modes render through the shared header, rail and nav', () => {
    for (const shared of ['indHeader(', 'indNav(', 'indStep(']) {
      expect(`player ${shared}:${player.includes(shared)}`).toBe(`player ${shared}:true`);
      expect(`editor ${shared}:${editor.includes(shared)}`).toBe(`editor ${shared}:true`);
    }
    expect(fn('indHeader')).toContain('indRail(');
  });

  test('the step model is identical: overview, each section, a close', () => {
    expect(fn('indStepCount')).toContain('+ 2');
    // Both dispatch the same three ways round the same cursor.
    for (const body of [player, editor]) {
      expect(body).toContain('if (step === 0)');
      expect(body).toContain('step > sections.length');
    }
  });

  test('Next and Back exist, are bounded, and are the same control', () => {
    const nav = fn('indNav');
    expect(nav).toContain('RH2.indGo(-1)');
    expect(nav).toContain('RH2.indGo(1)');
    expect(nav).toContain('Back');
    expect(nav).toContain('Next');
    // The first step cannot go back and the last cannot go on.
    expect(nav).toContain("(step === 0 ? 'disabled ' : '')");
    expect(nav).toContain("(step === last ? 'disabled ' : '')");
    expect(fn('indGo')).toContain('Math.max(0, Math.min(n - 1');
  });

  test('a section is a SCREEN, not a card in a stack', () => {
    // The old player rendered every section at once and hid the content in
    // accordions. One section per step is the change; a forEach over all of
    // them inside the renderer would be the regression.
    expect(player).toContain('indSectionRead(sections[step - 1]');
    expect(editor).toContain('indSectionEdit(sections[step - 1]');
    expect(player).not.toMatch(/sections\s*\|\|\s*\[\]\)\.forEach/);
    expect(VISIBLE).not.toContain('RH2.alToggle(');
  });

  test('every mode can jump to a named step, so nothing is a dead end', () => {
    expect(fn('indRail')).toContain('RH2.indJump(');
    expect(fn('indTocRow')).toContain('RH2.indJump(');
  });

  test('the rail marks the current step by more than colour', () => {
    expect(fn('indRail')).toContain('aria-current="step"');
    expect(CSS).toMatch(/\.rh2-ind-railbtn\.is-on\s*\{[^}]*border-color/);
  });
});

describe('edit mode is the learner\'s screen with the fields exposed', () => {
  const editor = fn('renderLaEditor');

  test('opening Edit is already editing — there is no second control', () => {
    // The failure this pins: an "Edit" button that opens something read-only
    // with another "Edit" inside it.
    expect(fn('laEdit')).toContain("api('/api/learning/workflows/'");
    expect(editor).not.toMatch(/Enable editing|Edit content<|>Edit<\/button>/);
    expect(fn('indSectionEdit')).toContain('RH2.laSecField(');
    expect(fn('laEditorItemHtml')).toContain("\\'title\\',this.value");
    expect(fn('laEditorItemHtml')).toContain("\\'body\\',this.value");
  });

  test('the heading is the input, in the place the learner reads it', () => {
    expect(fn('indHeader')).toContain("mode === 'edit'");
    expect(fn('indHeader')).toContain("RH2.laMeta(\\'title\\',this.value)");
    expect(fn('indSectionEdit')).toContain('rh2-ind-sectitle-in');
  });

  test('every content element the model supports stays editable', () => {
    const item = fn('laEditorItemHtml');
    for (const editable of ['ack_statement', 'required', 'minutes', 'laQField(', 'laResPickOpen(']) {
      expect(`${editable}:${item.includes(editable)}`).toBe(`${editable}:true`);
    }
  });

  test('saving goes through the existing draft lifecycle, not a new one', () => {
    // Draft is saved; a version is cut by Publish or by assigning. Nothing
    // here may publish silently.
    const save = fn('laSave');
    expect(save).toContain("method: 'PUT'");
    expect(save).toContain('expectedUpdatedAt');
    expect(save).not.toContain('/publish');
    expect(editor).toContain('RH2.laPublish(');
    expect(editor).toContain('Learners receive v');
  });

  test('the step the Owner was on survives a save', () => {
    // laSave re-opens from the server's normalised copy; being thrown back to
    // the overview on every save is how an editor teaches people not to save.
    expect(fn('laEdit')).toContain('keepStep');
  });
});

describe('preview shows the learner experience and changes nothing', () => {
  const prev = fn('laPreview');

  test('it reads the owner preview endpoint, which writes nothing', () => {
    expect(prev).toContain("/preview'");
    expect(ROUTES).toMatch(/workflows\/:id\/preview[\s\S]{0,400}serialiseForEmployee/);
  });

  test('it renders through the learner renderer, not a copy of it', () => {
    expect(prev).toContain("S.view = 'assignment'");
    expect(prev).toContain('preview: true');
  });

  test('no completion is posted from a preview', () => {
    // The guard is in alComplete itself, so every item type inherits it.
    expect(fn('alComplete')).toMatch(/if \(st\.preview\) \{[\s\S]{0,200}return \{ ok: true, completed: true, preview: true \}/);
    expect(fn('alQuizSubmit')).toContain('if (st.preview)');
  });

  test('and it says plainly that it is a preview', () => {
    expect(fn('renderAssignment')).toContain('Preview &mdash; read only, nothing is saved');
  });
});

describe('a learner cannot reach editing through the shared renderer', () => {
  test('edit mode is inferred from the render path, not stored on the page', () => {
    // A stored mode flag is something a learner's state could hold. This one
    // is read from which view is open, and the editor only ever opens from an
    // owner-only surface.
    const mode = fn('indMode');
    expect(mode).toContain("S.view === 'assignment'");
    expect(mode).toContain("'edit'");
    expect(VISIBLE).toContain("body = isOwner() ? renderAssignLearning() : renderLearning()");
  });

  test('the learner view never opens the editor', () => {
    expect(fn('renderLearning')).not.toContain('laEdit');
    expect(fn('renderLearning')).not.toContain('renderLaEditor');
  });

  test('and the server refuses regardless of what the browser renders', () => {
    for (const route of [
      "router.get('/api/learning/workflows/:id', ownerOnly",
      "router.put('/api/learning/workflows/:id', ownerOnly",
      "router.get('/api/learning/workflows/:id/preview', ownerOnly",
      "router.post('/api/learning/workflows/:id/publish', ownerOnly",
    ]) {
      expect(`${route}:${ROUTES.includes(route)}`).toBe(`${route}:true`);
    }
  });

  test('learner progress still posts to the user-scoped route only', () => {
    expect(fn('alComplete')).toContain("'/api/learning/my/'");
    expect(ROUTES).toMatch(/my\/:id\/items\/:itemKey\/complete[\s\S]{0,600}loadMyAssignment/);
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
    // is shared, so the version is shared. r25/r16 was one unified catalogue,
    // three actions, one induction renderer; r26 is the Library folder fix
    // (no workflow tool inside a folder, and the folder's own count in its
    // header), which touched the JS and not the CSS. Bump both this and the
    // list in assessment-surface-guards.test.js together, or CI fails on the
    // half that was forgotten.
    expect(SHELL).toContain('/resourcehub.css?v=r16');
    expect(SHELL).toContain('/resourcehub.js?v=r26');
  });

  test('the dialog and its styles exist for every class the JS renders', () => {
    for (const cls of [
      'rh2-dialog-backdrop', 'rh2-dialog', 'rh2-dialog-head', 'rh2-dialog-body',
      'rh2-dialog-foot', 'rh2-avatar', 'rh2-learn-staff-has', 'rh2-learn-assign-bar',
      'rh2-page-intro', 'rh2-learn-cannot', 'rh2-row-btn',
      'rh2-learn-cat-head', 'rh2-learn-cat-search', 'rh2-ind-rail', 'rh2-ind-nav',
      'rh2-ind-item', 'rh2-ind-toc',
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

  test('search and the archived toggle are not offered against an empty list', () => {
    // Controls that cannot do anything are noise: with nothing to filter, the
    // empty state below carries the only call to action.
    expect(page).toMatch(/\(all\.length[\s\S]{0,220}rh2-learn-cat-actions/);
    expect(page).toMatch(/rh2-learn-cat-search[\s\S]{0,1200}: ''\)/);
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
