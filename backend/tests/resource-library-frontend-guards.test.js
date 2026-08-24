'use strict';

/**
 * LIBRARY FOLDER UI — STATIC GUARDS.
 *
 * resourcehub.js has no browser test harness, so these read the source and
 * assert the properties that a refactor would break silently. They are crude
 * on purpose: if a renderer is renamed, update the assertion beside it rather
 * than deleting it.
 *
 * What is protected here is what a reviewer cannot see by reading a diff:
 *
 *   - the folder view never renders a name, description or count without
 *     escaping it — folder names can come from a model
 *   - search is not silently scoped to a folder (§21)
 *   - the Owner-only controls are gated in the client TOO, so a therapist is
 *     never offered a button that would 403. (The server is the control; this
 *     is manners.)
 *   - no model id, token count or job id reaches a user (§16)
 *   - every inline handler the markup calls is actually exported on RH2
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.css'), 'utf8');

describe('the folder view exists and is the default', () => {
  it('renders folders before falling through to a flat list (§48)', () => {
    expect(JS).toContain('function renderFolderGrid()');
    expect(JS).toContain('function folderCard(');
    expect(JS).toContain("browse: 'folders'");
  });

  it('keeps a way to the flat list (§49)', () => {
    expect(JS).toContain('function allResourcesRow()');
    expect(JS).toContain('All Resources');
    // The handler is written inside a single-quoted JS string, so the source
    // carries the escaped form.
    expect(JS).toContain("RH2.libBrowse(\\'all\\')");
  });

  it('shows breadcrumbs (§20)', () => {
    expect(JS).toContain('function libCrumbs()');
    expect(JS).toContain('aria-label="Library location"');
    expect(JS).toContain('aria-current="page"');
  });
});

describe('escaping every folder-derived string', () => {
  const MUST_CONTAIN = [
    // Folder name, description and count all pass through esc().
    "'<span class=\"rh2-folder-name\">' + esc(node.name) + '</span>'",
    "esc(node.description)",
    "esc(countLabel(node.count))",
    // Breadcrumb segments.
    'esc(b.name)',
    'esc(meta.folder.name)',
    // The folder id in an inline handler.
    "RH2.libOpenFolder(\\'' + esc(node.id) + '\\')",
  ];

  it.each(MUST_CONTAIN)('escapes: %s', (snippet) => {
    expect(JS).toContain(snippet);
  });

  it('never interpolates a folder field raw into markup', () => {
    // Any `+ node.<field> +` outside an esc() call would be a raw sink.
    const raw = JS.match(/\+\s*node\.(name|description|id|slug)\s*\+/g) || [];
    expect(raw).toEqual([]);
  });
});

describe('search stays global (§21)', () => {
  it('only adds a folder to the query when browsing it, or on request', () => {
    expect(JS).toContain('if (f.folderId && (!libSearching(f) || f.folderSearch))');
    expect(JS).toContain("qs.push('folderId=' + encodeURIComponent(f.folderId))");
  });

  it('labels the search box as spanning everything', () => {
    expect(JS).toContain('placeholder="Search all resources..."');
    expect(JS).toContain('aria-label="Search all resources"');
  });

  it('offers folder-only search rather than imposing it', () => {
    expect(JS).toContain('Searching the whole library.');
    expect(JS).toContain('RH2.libScopeSearch(true)');
    expect(JS).toContain('RH2.libScopeSearch(false)');
  });
});

describe('Owner-only controls are gated in the client too (§34)', () => {
  it('renders the folder controls only inside an owner check', () => {
    const bar = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('function libMovePanel()'));
    expect(bar).toContain("if (!isOwner()) return '';");
    for (const control of ['RH2.libPickFiles(', 'RH2.libFolderForm(true)', 'RH2.libSelectMode(']) {
      expect(bar).toContain(control);
    }
  });

  it('passes an owner flag into every folder card rather than assuming', () => {
    expect(JS).toContain('function folderCard(node, owner)');
    expect(JS).toContain('var owner = isOwner();');
  });

  it('attaches drop handlers only for an Owner', () => {
    // A therapist dragging a file onto a folder should get the browser's
    // default, not a silent no-op that looks broken.
    expect(JS).toContain('var dnd = owner');
    const drag = JS.slice(JS.indexOf('function libDragOver('), JS.indexOf('function uploadPanel()'));
    expect(drag).toContain('if (!isOwner()) return;');
  });

  it('gives a therapist the browser\'s own right-click menu', () => {
    const menu = JS.slice(JS.indexOf('function libMenu('), JS.indexOf('function libMenuClose()'));
    expect(menu).toContain('if (!isOwner()) return true;');
    expect(JS).toContain('if (!isOwner()) return resourceCard(r, backView);');
  });
});

describe('the AI organisation is gone, not hidden', () => {
  /**
   * The practice asked for automatic organisation to be removed. A button that
   * merely stops being rendered is not removal — the handler, the polling and
   * the phase vocabulary all have to be absent, or the next person to read
   * this file will reasonably assume the feature still exists.
   */
  it('leaves no organise handler, poller or phase vocabulary behind', () => {
    for (const gone of ['libOrganise', 'libUndoOrganise', 'loadOrgStatus', 'ORG_PHASES',
      'Organise Library', 'Reorganise Library', 'Undo last organisation',
      '/api/rh2/library/organise', '/api/rh2/library/rollback', '/api/rh2/library/status',
      '/api/rh2/library/reclassify']) {
      expect(JS).not.toContain(gone);
    }
  });

  it('leaves no organise styling behind', () => {
    expect(CSS).not.toContain('rh2-organising');
  });
});

describe('Home no longer browses by collection', () => {
  /**
   * Organised browsing belongs to the Library's folders. Home's collection
   * grid was the older answer to the same question, and two of them on one
   * hub is one too many. Same standard as the AI organisation above: the
   * cards, the heading, the empty state and the handler all have to be gone,
   * not merely unrendered.
   */
  const home = (() => {
    const start = JS.indexOf('function renderHome()');
    return JS.slice(start, JS.indexOf('\n  function ', start + 10));
  })();

  it('renders no collection heading, cards or empty state on Home', () => {
    for (const gone of ['rh2-h-col', 'Browse by collection', 'rh2-collections',
      'Collections will appear here once content is approved']) {
      expect(home).not.toContain(gone);
    }
  });

  it('leaves no Home-only handler behind', () => {
    expect(JS).not.toContain('RH2.openCollection');
    expect(JS).not.toContain('function openCollection(');
    expect(JS).not.toContain('openCollection: openCollection');
  });

  it('keeps the Library folders as the way in', () => {
    expect(JS).toContain('function renderFolderGrid()');
    expect(JS).toContain("browse: 'folders'");
  });

  it('takes the shared collection cards with it, now nothing renders them', () => {
    // The .rh2-collection* rules were kept when Home's grid went, because
    // Assign Learning still drew the same cards. It no longer does — its
    // catalogue is one unified list — so the rules are dead CSS and the
    // handlers are unreachable code.
    expect(JS).not.toContain('RH2.aslOpenCollection(');
    expect(JS).not.toContain('function aslOpenCollection(');
    for (const gone of ['.rh2-collections', '.rh2-collection-icn', '.rh2-collection-name',
      '.rh2-collection-tag', '.rh2-collection-on']) {
      expect(`${gone}:${CSS.includes(gone)}`).toBe(`${gone}:false`);
    }
  });
});

describe('manual control is offered where the mistake is noticed (§35, §36)', () => {
  it('supports selecting several resources and moving them at once', () => {
    expect(JS).toContain('function selectableCard(');
    expect(JS).toContain('function libMoveTo(');
    expect(JS).toContain("api('/api/rh2/library/move'");
  });

  it('leaves the resource card itself untouched when not selecting (§19)', () => {
    // Selection and right-click are both WRAPPERS. The card markup, its
    // handler and its classes are the same ones every other view renders.
    const sel = JS.slice(JS.indexOf('function selectableCard('), JS.indexOf('function renderLibrary()'));
    expect(sel).toContain('if (!isOwner()) return resourceCard(r, backView);');
    expect(sel).toContain("+ resourceCard(r, backView) + '</div>'");
    expect(sel).toContain('resourceCard(r, backView)');
  });

  it('warns that removing a folder does not delete anything', () => {
    expect(JS).toContain('Its resources move to Needs Review — nothing is deleted.');
  });
});

describe('the api() contract', () => {
  /**
   * api() JSON-stringifies opts.body itself. Passing an already-stringified
   * body double-encodes it, and the server then receives a JSON *string*
   * where it expects an object — which fails silently as "nothing selected"
   * rather than as an error. Every library call must pass a plain object.
   */
  it('never hands api() a pre-stringified body', () => {
    const calls = [...JS.matchAll(/api\('\/api\/rh2\/library[^)]*\{[^}]*body:\s*([^,\n}]+)/g)];
    for (const [, body] of calls) {
      expect(body).not.toMatch(/JSON\.stringify/);
      expect(body.trim()).not.toMatch(/^'/);
    }
  });

  it('passes objects on the multi-line call sites too', () => {
    const block = JS.slice(JS.indexOf('async function libOrganise('), JS.indexOf('function libFolderArchive('));
    expect(block).not.toMatch(/body:\s*JSON\.stringify/);
    expect(block).not.toMatch(/body:\s*'\{/);
  });
});

describe('uploading (drag-and-drop and the button)', () => {
  it('offers both doors, and both end up in one place', () => {
    expect(JS).toContain('function libUploadFiles(');
    expect(JS).toContain('function libPickFiles(');
    expect(JS).toContain("api('/api/rh2/library/folders/'");
    // The button builds an <input type=file> that routes into the same call.
    const pick = JS.slice(JS.indexOf('function libPickFiles('), JS.indexOf('function libUploadsDismiss()'));
    expect(pick).toContain('libUploadFiles(folderId, input.files)');
  });

  it('accepts the formats the server accepts, and no more', () => {
    expect(JS).toContain("var UPLOAD_EXT = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg'];");
    expect(JS).toContain("'.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg'");
  });

  it('reads files one at a time rather than all at once', () => {
    // Twenty base64 copies of twenty PDFs in memory at once is how a browser
    // tab dies; the loop awaits each read before starting the next.
    const up = JS.slice(JS.indexOf('async function libUploadFiles('), JS.indexOf('function libPickFiles('));
    expect(up).toContain('for (var i = 0; i < files.length; i++)');
    expect(up).toContain('await readAsBase64(file)');
  });

  it('reports each file\'s outcome separately', () => {
    expect(JS).toContain('function uploadPanel()');
    expect(JS).toContain("entry.state = 'error'");
    expect(JS).toContain("entry.state = 'done'");
    expect(JS).toContain('Files that were refused have not been stored.');
  });

  it('refreshes the counts and the open folder once uploading ends', () => {
    const up = JS.slice(JS.indexOf('async function libUploadFiles('), JS.indexOf('function libPickFiles('));
    expect(up).toContain('loadFolders(true)');
    expect(up).toContain('loadLibrary()');
  });

  it('shows a drop target before the file lands', () => {
    // The strip stays as the resting explanation of what may be dropped; the
    // live affordance is the folder card on the grid and, inside a folder, the
    // workspace overlay (see 'the workspace is a drop target' below).
    expect(JS).toContain('rh2-dropzone');
    expect(JS).toContain('Drop to upload');
    expect(CSS).toContain('.rh2-folder.is-dropping');
    expect(CSS).toContain('.rh2-ws.is-dropping .rh2-wsdrop');
  });

  it('signals a drop target by more than colour (§54)', () => {
    // Border and a label, so the affordance survives a monochrome display.
    expect(CSS).toContain('border-style: dashed');
    expect(JS).toContain('rh2-folder-dropmsg');
  });
});

describe('right-click', () => {
  it('opens one menu for folders and documents alike', () => {
    expect(JS).toContain('function libMenu(');
    expect(JS).toContain('function renderMenu()');
    expect(JS).toContain("oncontextmenu=\"return RH2.libMenu(event,\\'folder\\'");
    expect(JS).toContain("oncontextmenu=\"return RH2.libMenu(event,\\'resource\\'");
  });

  it('offers rename on both, and upload on a folder', () => {
    const menu = JS.slice(JS.indexOf('function renderMenu()'), JS.indexOf('/* ── Renaming'));
    expect(menu).toContain("RH2.libRenameStart('folder'");
    expect(menu).toContain("RH2.libRenameStart('resource'");
    expect(menu).toContain('RH2.libPickFiles(');
    expect(menu).toContain('RH2.libMoveOne(');
  });

  it('closes on an outside click and is dismissible', () => {
    expect(JS).toContain('rh2-menu-veil');
    expect(JS).toContain('RH2.libMenuClose()');
  });

  it('escapes every name it renders', () => {
    const menu = JS.slice(JS.indexOf('function renderMenu()'), JS.indexOf('/* ── Renaming'));
    expect(menu).toContain('esc(m.name)');
    expect(menu).toContain('esc(it[0])');
  });

  it('labels the menu for a screen reader', () => {
    expect(JS).toContain('role="menu"');
    expect(JS).toContain('role="menuitem"');
  });
});

describe('renaming', () => {
  it('uses an inline panel, never window.prompt', () => {
    // A native prompt cannot be styled, cannot show the server's refusal, and
    // is blocked outright in some browsers.
    expect(JS).toContain('function renameDialog()');
    const rename = JS.slice(JS.indexOf('function libRenameStart('), JS.indexOf('function renameDialog()'));
    expect(rename).not.toMatch(/(?:window|global)\.prompt\(/);
    expect(JS).toContain("<input id=\"rh2-rename\"");
  });

  it('sends a folder rename and a document rename to different routes', () => {
    const save = JS.slice(JS.indexOf('async function libRenameSave()'), JS.indexOf('function renameDialog()'));
    expect(save).toContain("'/api/rh2/library/folders/'");
    expect(save).toContain("'/api/rh2/library/resources/'");
  });

  it('shows the server\'s refusal rather than swallowing it', () => {
    const save = JS.slice(JS.indexOf('async function libRenameSave()'), JS.indexOf('function renameDialog()'));
    expect(save).toContain('r.err = d.error');
  });
});

describe('the workspace is a drop target, not just the strip', () => {
  it('accepts a drag on the whole workspace, and only inside a folder', () => {
    // Attached to the library page element itself, and only when the reader is
    // standing in a folder — on the grid there is no one destination.
    expect(JS).toContain('function libWsCanDrop() { return isOwner() && !!S.lib.folderId; }');
    expect(JS).toContain('RH2.libWsDragOver(event)');
    expect(JS).toContain('RH2.libWsDragLeave(event)');
    expect(JS).toContain('RH2.libWsDrop(event)');
    const ws = JS.slice(JS.indexOf('var ws = isOwner()'), JS.indexOf('out += renderMenu();'));
    expect(ws).toContain('inFolder');
  });

  it('drops into the folder that is open, through the one upload path', () => {
    const drop = JS.slice(JS.indexOf('function libWsDrop('), JS.indexOf('function uploadPanel()'));
    expect(drop).toContain('if (!libWsCanDrop()) return;');
    expect(drop).toContain('libUploadFiles(S.lib.folderId, dt.files)');
    // No second upload implementation: the workspace, the folder cards and the
    // button all end in libUploadFiles.
    expect(JS.match(/api\('\/api\/rh2\/library\/folders\/' \+ encodeURIComponent\(folderId\) \+ '\/upload'/g))
      .toHaveLength(1);
  });

  it('ignores a drag that is not carrying files', () => {
    // Dragging text or a card across the workspace must not raise an upload
    // affordance the drop could never satisfy.
    expect(JS).toContain('function dragHasFiles(dt)');
    expect(JS).toContain("if (types[i] === 'Files') return true;");
    expect(JS).toContain('if (!libWsCanDrop() || !dragHasFiles(ev.dataTransfer)) return;');
    expect(JS).toContain('if (!isOwner() || !dragHasFiles(ev.dataTransfer)) return;');
  });

  it('only ends the drag when the pointer really left the workspace', () => {
    // dragleave fires at every child boundary; a naive handler flickers the
    // overlay off as the pointer crosses between two cards.
    const leave = JS.slice(JS.indexOf('function libWsDragLeave('), JS.indexOf('function libWsDrop('));
    expect(leave).toContain('host.contains(to)');
  });

  it('does not re-render the page while a file is over it', () => {
    // render() replaces the whole subtree, which would tear out the element the
    // pointer is on mid-drag. The class is written straight onto the node.
    const mark = JS.slice(JS.indexOf('function libWsMark('), JS.indexOf('function libWsDragOver('));
    expect(mark).toContain("doc.getElementById('rh2-lib-ws')");
    expect(mark).toContain("classList.toggle('is-dropping'");
    expect(mark).not.toContain('render()');
  });

  it('announces the drop by border and words, not colour alone (§54)', () => {
    expect(JS).toContain('Drop files here to upload');
    expect(CSS).toContain('.rh2-ws.is-dropping .rh2-wsdrop');
    expect(CSS).toContain('border: 2px dashed var(--accent)');
    // The overlay must not eat the events of the element beneath it.
    const overlay = CSS.slice(CSS.indexOf('.rh2-wsdrop {'), CSS.indexOf('.rh2-ws.is-dropping'));
    expect(overlay).toContain('pointer-events: none');
  });
});

describe('right-clicking the workspace', () => {
  it('offers exactly New document, New folder and Upload', () => {
    const menu = JS.slice(JS.indexOf('function renderMenu()'), JS.indexOf('The open menu owns the keyboard'));
    const ws = menu.slice(menu.indexOf("m.kind === 'workspace'"), menu.indexOf("m.kind === 'folder'"));
    expect(ws).toContain("['New document', 'RH2.libNewDocument()'");
    expect(ws).toContain("['New folder', 'RH2.libFolderForm(true)'");
    expect(ws).toContain('RH2.libPickFiles(');
  });

  it('leaves fields, links and the menu itself to the browser', () => {
    expect(JS).toContain("var MENU_KEEP_NATIVE = 'input, textarea, select, a[href], .rh2-menu, .rh2-menu-veil';");
    const wsm = JS.slice(JS.indexOf('function libWorkspaceMenu('), JS.indexOf('/** The name of the place'));
    expect(wsm).toContain('if (!isOwner()) return true;');
    expect(wsm).toContain('t.closest(MENU_KEEP_NATIVE)');
  });

  it('lets a folder or a document win over the background', () => {
    // Both item handlers stop the event, so it never reaches the workspace.
    const lm = JS.slice(JS.indexOf('function libMenu(ev, kind, id, name, review)'), JS.indexOf('The background menu'));
    expect(lm).toContain('ev.stopPropagation();');
  });

  it('says why Upload is unavailable rather than hiding it', () => {
    const menu = JS.slice(JS.indexOf('function renderMenu()'), JS.indexOf('The open menu owns the keyboard'));
    expect(menu).toContain("note = 'Open a folder to upload into it.'");
    expect(menu).toContain('aria-disabled="true"');
  });

  it('closes on Escape and walks with the arrows', () => {
    const keys = JS.slice(JS.indexOf('The open menu owns the keyboard'), JS.indexOf('── Renaming'));
    expect(keys).toContain("if (e.key === 'Escape') { e.preventDefault(); libMenuClose(); return; }");
    expect(keys).toContain("e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab'");
    expect(keys).toContain('items[at].focus');
  });

  it('moves focus onto the menu when it opens', () => {
    const lm = JS.slice(JS.indexOf('function libMenu(ev, kind, id, name, review)'), JS.indexOf('The background menu'));
    expect(lm).toContain(".rh2-menu .rh2-menu-item:not([aria-disabled=\"true\"])");
    expect(lm).toContain('first.focus(');
  });

  it('measures the menu instead of guessing its size', () => {
    expect(JS).toContain('function libMenuPlace()');
    expect(JS).toContain('el.getBoundingClientRect()');
    // The old hard-coded clamp is gone.
    expect(JS).not.toContain('(global.innerWidth || 1200) - 210');
  });

  it('does not survive a move between folders', () => {
    const open = JS.slice(JS.indexOf('function libOpenFolder(id)'), JS.indexOf('async function loadFolderMeta('));
    expect(open).toContain('f.menu = null;');
    const browse = JS.slice(JS.indexOf('function libBrowse(mode)'), JS.indexOf('/** Search this folder instead'));
    expect(browse).toContain('S.lib.menu = null;');
  });

  it('stops offering Remove on the folder the server refuses to remove', () => {
    // libMenu now carries the flag renderMenu was already testing; before this
    // it was always undefined, so Needs Review was offered a button that could
    // only ever come back 400.
    expect(JS).toContain('function libMenu(ev, kind, id, name, review)');
    expect(JS).toContain('review: !!review');
    expect(JS).toContain("(node.isReviewBucket ? 'true' : 'false')");
  });
});

describe('new document is the existing author, not a second one', () => {
  it('opens the resource form that Admin already uses', () => {
    const nd = JS.slice(JS.indexOf('function libNewDocument()'), JS.indexOf('function libFolderForm('));
    expect(nd).toContain("nav('admin')");
    expect(nd).toContain('adminNew()');
    // No new create route, no new document type.
    expect(JS).not.toContain('/api/rh2/library/documents');
  });

  it('files it into the folder it was started from, through the move route', () => {
    const nd = JS.slice(JS.indexOf('function libNewDocument()'), JS.indexOf('function libFolderForm('));
    expect(nd).toContain('S.admin.fileInto = S.lib.folderId');
    const save = JS.slice(JS.indexOf('async function adminSave('), JS.indexOf('async function adminAction('));
    expect(save).toContain("api('/api/rh2/library/move'");
    expect(save).toContain('resourceIds: [id]');
    // Only a NEW resource is filed, and the destination is consumed once.
    expect(save).toContain("var into = !editing ? S.admin.fileInto : '';");
    expect(save).toContain("S.admin.fileInto = ''; S.admin.fileIntoName = '';");
  });

  it('forgets the destination when the form is abandoned', () => {
    const close = JS.slice(JS.indexOf('function adminFormClose()'), JS.indexOf('function renderResourceForm('));
    expect(close).toContain("S.admin.fileInto = ''");
  });

  it('says a refusal rather than swallowing it', () => {
    const save = JS.slice(JS.indexOf('async function adminSave('), JS.indexOf('async function adminAction('));
    expect(save).toContain('It could not be filed into that folder');
  });
});

describe('the Library actions read as controls', () => {
  it('gives New folder and Select resources a button surface', () => {
    const bar = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('/** The move panel'));
    // rh2-btn-quiet is a transparent border on the page background — correct
    // for a Cancel, wrong for the only two things you can do to a folder.
    expect(bar).not.toContain('rh2-btn-quiet');
    expect(bar).toContain("class=\"rh2-btn\" onclick=\"RH2.libFolderForm(true)\"");
    expect(bar).toContain('RH2.libSelectMode(');
  });

  it('gives them hover, focus and pressed states', () => {
    expect(CSS).toContain('.rh2-libtools .rh2-btn:hover');
    expect(CSS).toContain('.rh2-libtools .rh2-btn:active');
    expect(CSS).toContain('.rh2-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }');
    // The scoped shadow rules tie with .rh2-btn:focus-visible on specificity and
    // come later, so the ring must be restated inside the scope or keyboard
    // focus goes invisible on the very buttons this made visible.
    expect(CSS).toContain('.rh2-libtools .rh2-btn:focus-visible { outline: none; box-shadow: var(--focus-ring); }');
    expect(CSS).toContain('.rh2-libtools .rh2-btn[aria-pressed="true"]');
  });

  it('keeps a text label beside every icon', () => {
    const bar = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('/** The move panel'));
    expect(bar).toContain('New folder</button>');
    expect(bar).toContain('rh2-btn-icon');
    expect(bar).toContain('aria-hidden="true"');
    expect(bar).toContain("role=\"group\" aria-label=\"Library actions\"");
  });

  it('says the selection mode is on', () => {
    const bar = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('/** The move panel'));
    expect(bar).toContain("aria-pressed=\"' + (f.selMode ? 'true' : 'false') + '\"");
  });

  it('respects a reduced-motion preference', () => {
    const rm = CSS.slice(CSS.indexOf('THE LIBRARY AS A WORKSPACE'));
    expect(rm).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('every inline handler is reachable', () => {
  it('exports each RH2.lib* function the markup calls', () => {
    const called = new Set(
      [...JS.matchAll(/RH2\.(lib[A-Za-z]+)\s*\(/g)].map((m) => m[1]));
    expect(called.size).toBeGreaterThan(8);
    const exportBlock = JS.slice(JS.indexOf('global.RH2 = {'));
    for (const name of called) {
      expect(exportBlock).toContain(`${name}:`);
    }
  });
});

describe('accessibility (§54)', () => {
  it('gives the folder controls text labels, not icon-only buttons', () => {
    expect(JS).toContain('aria-label="Rename ');
    expect(JS).toContain('aria-label="Remove ');
    expect(JS).toContain('rh2-visually-hidden');
  });

  it('announces progress and results to a screen reader', () => {
    expect(JS).toContain('role="status" aria-live="polite"');
  });

  it('marks folder icons decorative', () => {
    expect(JS).toContain("'<span class=\"rh2-folder-glyph\" aria-hidden=\"true\">'");
  });

  it('does not leave the folder tools hover-only', () => {
    expect(CSS).toContain('.rh2-folder:focus-within .rh2-folder-tools');
    expect(CSS).toContain('@media (hover: none) { .rh2-folder-tools { opacity: 1; } }');
  });

  it('distinguishes the review folder by more than colour', () => {
    expect(CSS).toContain('.rh2-folder-review { border-style: dashed; }');
  });

  it('respects a reduced-motion preference', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('responsive layout (§53)', () => {
  it('lays folders out as rows rather than a wide card grid', () => {
    expect(CSS).toContain('.rh2-folders { display: flex; flex-direction: column;');
  });

  it('adapts the folder row, the form and the dropzone on a narrow screen', () => {
    // There is more than one narrow-screen block now, so gather them all
    // rather than assuming the last one carries every rule.
    const blocks = CSS.split('@media (max-width: 640px)').slice(1).join('\n');
    for (const rule of ['.rh2-folder-open', '.rh2-folderform', '.rh2-dropzone']) {
      expect(blocks).toContain(rule);
    }
  });
});
