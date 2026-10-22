'use strict';

/**
 * LIBRARY UI — GUARDS.
 *
 * The Library's folder browsing is a SharePoint-style document library in
 * frontend/current/resourcelibrary.js (window.RHLib), mounted by
 * resourcehub.js into #rhl-root whenever the Library is browsed. Searches,
 * Saved and All Resources stay in resourcehub.js's flat list.
 *
 * Both files load cleanly against a stub window, so the rules that decide
 * what a person sees — sort order, range selection, the filter, which actions
 * a role is offered, what a folder can be moved into — are CALLED here rather
 * than pattern-matched. The rest are source guards on properties a refactor
 * would break silently:
 *
 *   - every server-supplied string is escaped; inline handlers carry ids only
 *   - every inline handler the markup calls is exported
 *   - the controls a therapist would be refused are not offered to them
 *     (the server is the control: permissions.js requireRole)
 *   - keyboard and ARIA: tree, grid, menu, dialog roles; arrow keys, F2,
 *     Delete, Enter, Escape, Shift+F10
 *   - search is not silently scoped to a folder (§21)
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const LIB = fs.readFileSync(path.join(FRONTEND, 'resourcelibrary.js'), 'utf8');
const LIBCSS = fs.readFileSync(path.join(FRONTEND, 'resourcelibrary.css'), 'utf8');
const JS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const NAV = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');

/** Load a frontend file against a stub window and return the sandbox. */
function load(source, filename, role) {
  const sandbox = {
    console, setTimeout, clearTimeout,
    fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
    location: { hash: '', origin: 'https://portal.test', pathname: '/' },
    localStorage: { getItem: () => null, setItem() {} },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {},
      body: {},
    },
    APP_USER: { role, permissions: ['service_agreements.access'] },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename });
  return sandbox;
}

const asOwner = load(LIB, 'resourcelibrary.js', 'owner');
const T = asOwner.RHLib._test;

// ═════════════════════════════════════════════════════════════════════════════
//  THE RULES, EXECUTED
// ═════════════════════════════════════════════════════════════════════════════

describe('sorting', () => {
  const items = [
    { kind: 'doc', name: 'beta', modifiedAt: '2026-01-02', size: 300, format: 'pdf', modifiedBy: 'Zoe' },
    { kind: 'folder', name: 'Zeta', modifiedAt: '2026-01-01' },
    { kind: 'doc', name: 'Alpha 10', modifiedAt: '2026-03-01', size: 10, format: 'docx', modifiedBy: 'amy' },
    { kind: 'doc', name: 'Alpha 9', modifiedAt: '2026-02-01', size: null, format: 'xlsx', modifiedBy: 'Bob' },
    { kind: 'folder', name: 'alpha folder', modifiedAt: '2026-05-01' },
  ];
  const names = (list) => list.map((i) => i.name);

  it('puts folders first in both directions', () => {
    expect(names(T.sortItems(items, 'name', 'asc')).slice(0, 2)).toEqual(['alpha folder', 'Zeta']);
    expect(names(T.sortItems(items, 'name', 'desc')).slice(0, 2)).toEqual(['Zeta', 'alpha folder']);
  });

  it('sorts names naturally and case-insensitively', () => {
    expect(names(T.sortItems(items, 'name', 'asc')).slice(2)).toEqual(['Alpha 9', 'Alpha 10', 'beta']);
  });

  it('sorts by modified, size, type and modified-by, ascending and descending', () => {
    expect(names(T.sortItems(items, 'modified', 'desc')).slice(2)).toEqual(['Alpha 10', 'Alpha 9', 'beta']);
    expect(names(T.sortItems(items, 'size', 'asc')).slice(2)).toEqual(['Alpha 9', 'Alpha 10', 'beta']);
    expect(names(T.sortItems(items, 'size', 'desc')).slice(2)).toEqual(['beta', 'Alpha 10', 'Alpha 9']);
    expect(names(T.sortItems(items, 'type', 'asc')).slice(2)).toEqual(['Alpha 9', 'beta', 'Alpha 10']);
    expect(names(T.sortItems(items, 'modifiedBy', 'asc')).slice(2)).toEqual(['Alpha 10', 'Alpha 9', 'beta']);
  });

  it('falls back to name for an unknown column and never mutates its input', () => {
    const copy = items.slice();
    T.sortItems(items, 'nonsense', 'asc');
    expect(items).toEqual(copy);
    expect(names(T.sortItems(items, 'nonsense', 'asc'))).toEqual(names(T.sortItems(items, 'name', 'asc')));
  });
});

describe('range selection and filtering', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('selects from the anchor to the target, either direction', () => {
    expect(T.rangeKeys(order, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(T.rangeKeys(order, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(T.rangeKeys(order, 'zz', 'c')).toEqual(['c']);
    expect(T.rangeKeys(order, 'a', 'zz')).toEqual([]);
  });

  it('filters on name and file name, case-insensitively', () => {
    const items = [{ name: 'Policy', fileName: 'p.pdf' }, { name: 'Form', fileName: 'NDIS intake.docx' }];
    expect(T.filterItems(items, 'ndis').map((i) => i.name)).toEqual(['Form']);
    expect(T.filterItems(items, '  ').length).toBe(2);
  });

  it('labels sizes and types the way a person reads them', () => {
    expect(T.fmtSize(512)).toBe('512 B');
    expect(T.fmtSize(2048)).toBe('2 KB');
    expect(T.fmtSize(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(T.typeLabel({ kind: 'folder' })).toBe('Folder');
    expect(T.typeLabel({ kind: 'doc', format: 'docx' })).toBe('Word');
  });
});

describe('the actions each role is offered (the server refuses the rest)', () => {
  const doc = { kind: 'doc', id: 'd1', key: 'd-d1', name: 'Policy', file: { downloadUrl: '/x' } };
  const folder = { kind: 'folder', id: 'f1', key: 'f-f1', name: 'HR' };
  const acts = (sandbox, items) => sandbox.RHLib._test.actionsFor(items).map((a) => a.act);

  it('gives an owner and an admin every management action', () => {
    const admin = load(LIB, 'resourcelibrary.js', 'admin');
    for (const sb of [asOwner, admin]) {
      expect(acts(sb, [doc])).toEqual(['open', 'download', 'copyLink', 'rename', 'move', 'replace', 'versions', 'details', 'delete']);
      expect(acts(sb, [folder])).toEqual(['open', 'copyLink', 'rename', 'move', 'details', 'delete']);
      expect(acts(sb, [doc, folder])).toEqual(['download', 'move', 'delete']);
    }
  });

  it('gives a therapist and read_only only what they may do: open, download, link, history, details', () => {
    for (const role of ['therapist', 'read_only']) {
      const sb = load(LIB, 'resourcelibrary.js', role);
      expect(acts(sb, [doc])).toEqual(['open', 'download', 'copyLink', 'versions', 'details']);
      expect(acts(sb, [doc, folder])).toEqual(['download']);
    }
  });

  it('never offers Delete on Needs Review', () => {
    expect(acts(asOwner, [{ ...folder, isReviewBucket: true }])).not.toContain('delete');
  });
});

describe('the move picker', () => {
  it('leaves out the folders being moved and everything inside them', () => {
    T.setTree([
      { id: 'a', name: 'A', children: [{ id: 'b', name: 'B', children: [{ id: 'c', name: 'C', children: [] }] }] },
      { id: 'd', name: 'D', children: [] },
    ]);
    expect(T.moveTargets(['b']).map((t) => t.id)).toEqual(['a', 'd']);
    expect(T.moveTargets([]).map((t) => [t.id, t.depth])).toEqual([['a', 0], ['b', 1], ['c', 2], ['d', 0]]);
    T.setTree(null);
  });
});

describe('error messages a person can act on', () => {
  it('names the permission, the size limit and passes the server sentence through', () => {
    expect(T.errorText(403, {})).toMatch(/permission/i);
    expect(T.errorText(413, {})).toMatch(/25 MB/);
    expect(T.errorText(415, { error: 'That file type is not supported.' })).toBe('That file type is not supported.');
    expect(T.errorText(422, { error: 'This file appears to contain a person\'s completed details' }))
      .toMatch(/completed details/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  SOURCE GUARDS
// ═════════════════════════════════════════════════════════════════════════════

describe('escaping', () => {
  it('escapes every name, path and message it renders', () => {
    for (const s of ['esc(it.name)', 'esc(d.folder.name)', 'esc(b.name)', 'esc(n.name)', 'esc(u.name)',
      'esc(u.message)', 'esc(i.name)', 'esc(t.name)', 'esc(v.fileName', 'esc(r.title)']) {
      expect(LIB).toContain(s);
    }
  });

  it('never puts a name inside an inline handler — ids and keys only', () => {
    const handlers = LIB.match(/on[a-z]+="RHLib\.[^"]*"/g) || [];
    expect(handlers.length).toBeGreaterThan(20);
    for (const h of handlers) expect(h).not.toMatch(/\.name|\.title|fileName/);
  });

  it('defines the same esc() as resourcehub.js', () => {
    expect(LIB).toContain(".replace(/\"/g, '&quot;').replace(/'/g, '&#39;')");
  });
});

describe('every inline handler is reachable', () => {
  it('exports each RHLib.* the markup calls', () => {
    const called = new Set((LIB.match(/RHLib\.([a-zA-Z]+)\(/g) || []).map((m) => m.slice(6, -1)));
    for (const name of called) expect(typeof asOwner.RHLib[name]).toBe('function');
  });

  it('exports each RH2.* the library markup calls', () => {
    const hub = load(JS, 'resourcehub.js', 'owner');
    const called = new Set((LIB.match(/RH2\.([a-zA-Z]+)\(/g) || []).map((m) => m.slice(4, -1)));
    expect(called.size).toBeGreaterThan(2);
    for (const name of called) expect(typeof hub.RH2[name]).toBe('function');
    const rhCalled = new Set((JS.match(/RH2\.lib[a-zA-Z]+\(/g) || []).map((m) => m.slice(4, -1)));
    for (const name of rhCalled) expect(typeof hub.RH2[name]).toBe('function');
  });
});

describe('the document library replaces the old folder grid', () => {
  it('mounts into #rhl-root from the Library view', () => {
    expect(JS).toContain('<div id="rhl-root" class="rhl-root"></div>');
    expect(JS).toContain('global.RHLib.mount(lib)');
  });

  it('left no old folder-grid, right-click or upload code behind in resourcehub.js', () => {
    for (const gone of ['function renderFolderGrid', 'function folderCard', 'function libUploadFiles',
      'function libMenu(', 'function libMoveTo', 'function libFolderArchive', 'libSelectMode']) {
      expect(JS).not.toContain(gone);
    }
  });

  it('is loaded by the shell before resourcehub.js', () => {
    const lib = SHELL.indexOf('/resourcelibrary.js?v=');
    const hub = SHELL.indexOf('/resourcehub.js?v=');
    expect(lib).toBeGreaterThan(-1);
    expect(lib).toBeLessThan(hub);
    expect(SHELL).toContain('/resourcelibrary.css?v=');
  });
});

describe('navigation: tree, breadcrumbs, deep links', () => {
  it('renders an ARIA tree with levels, expansion and the current folder', () => {
    for (const s of ['role="tree"', 'role="treeitem"', 'aria-expanded', 'aria-level', 'role="group"', 'aria-selected']) {
      expect(LIB).toContain(s);
    }
    expect(LIB).toContain('function treeKey(');
    for (const k of ["'ArrowDown'", "'ArrowRight'", "'ArrowLeft'", "'Home'", "'End'"]) {
      expect(LIB.slice(LIB.indexOf('function treeKey('))).toContain(k);
    }
  });

  it('shows breadcrumbs with the current folder marked', () => {
    expect(LIB).toContain('aria-label="Library location"');
    expect(LIB).toContain('aria-current="page"');
  });

  it('navigates through RH2.libOpenFolder, which navigation.js hooks for history', () => {
    expect(LIB).toContain("global.RH2.libOpenFolder(id || '')");
    expect(NAV).toContain("hookMethod('RH2', 'libOpenFolder'");
    expect(NAV).toContain("'lwedit', 'library']");
    expect(NAV).toContain("out += '/library' + (s.id ?");
    expect(NAV).toContain("t.view === 'library' && t.id && isFn(global.RH2.libOpenFolder)");
  });

  it('remembers the last folder and the chosen view', () => {
    expect(LIB).toContain("var LAST_KEY = 'opal.rhl.lastFolder'");
    expect(LIB).toContain("var VIEW_KEY = 'opal.rhl.view'");
    // Storage can throw (private windows); every access is guarded.
    expect(LIB).toMatch(/function store\([^)]*\) \{\s*try \{/);
    expect(LIB).toMatch(/function recall\([^)]*\) \{\s*try \{/);
  });
});

describe('list view, selection and keyboard', () => {
  it('is an ARIA grid with sortable headers', () => {
    expect(LIB).toContain('role="grid" aria-multiselectable="true"');
    expect(LIB).toContain('aria-sort="');
    for (const col of ["'name', 'Name'", "'modified', 'Modified'", "'modifiedBy', 'Modified by'", "'size', 'Size'", "'type', 'Type'"]) {
      expect(LIB).toContain(col);
    }
  });

  it('supports Shift ranges, Ctrl/Cmd toggles and select all', () => {
    const click = LIB.slice(LIB.indexOf('function applyClick('), LIB.indexOf('function checkClick('));
    expect(click).toContain('ev.shiftKey && L.anchor');
    expect(click).toContain('ev.ctrlKey || ev.metaKey');
    expect(LIB).toContain('aria-label="Select all"');
  });

  it('handles arrows, Enter, Space, F2, Delete, Escape and the menu key in the list', () => {
    const keys = LIB.slice(LIB.indexOf('function listKey('), LIB.indexOf('function ensureSelected('));
    for (const k of ["'ArrowDown'", "'ArrowUp'", "'Enter'", "' '", "'F2'", "'Delete'", "'Escape'", "'ContextMenu'", "'F10'"]) {
      expect(keys).toContain(k);
    }
    // F2 and Delete are management actions — offered to managers only.
    expect(keys).toContain("k === 'F2' && canManage()");
  });

  it('uses one roving tab stop per list, not one per row', () => {
    expect(LIB).toContain("tabindex=\"' + (it.key === focusKey ? '0' : '-1')");
  });
});

describe('command bar, "…" button and context menu share one action list', () => {
  it('builds all three from actionsFor()', () => {
    expect(LIB).toContain('actionsFor(sel).forEach');
    expect(LIB).toContain("else items = actionsFor(selectedItems());");
    expect(LIB).toContain('function more(ev, k)');
    expect(LIB).toContain('oncontextmenu="return RHLib.ctx(event,');
  });

  it('labels the menu and returns focus on close', () => {
    expect(LIB).toContain('role="menu"');
    expect(LIB).toContain('role="menuitem"');
    expect(LIB).toContain('returnTo');
    expect(LIB).toContain("if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }");
  });

  it('leaves fields and links to the browser menu', () => {
    expect(LIB).toContain("t.closest('input, textarea, select, a[href], .rhl-menu, .rhl-dialog')");
  });

  it('offers New ▸ Folder and Upload ▸ Files as menus', () => {
    expect(LIB).toContain("RHLib.menuFor(event,\\'new\\')");
    expect(LIB).toContain("RHLib.menuFor(event,\\'upload\\')");
    expect(LIB).toContain('aria-haspopup="menu"');
  });
});

describe('moving uses an explicit Move button, never a select that fires on change (B7)', () => {
  it('has a dialog with a radio tree and a Move here button', () => {
    expect(LIB).toContain('Move here');
    expect(LIB).toContain('type="radio" name="rhl-move"');
    expect(LIB).not.toMatch(/<select[^>]*onchange="RHLib\.move/);
  });

  it('creates a new folder in exactly the folder that is open (B9)', () => {
    const nf = LIB.slice(LIB.indexOf('async function newFolder('), LIB.indexOf('// ── Move'));
    expect(nf).toContain("parentId: parent || null");
    expect(nf).toContain("var parent = L.folderId && L.folderId !== BIN ? L.folderId : ''");
  });
});

describe('uploads', () => {
  it('queues a second drop instead of replacing the first batch (P1)', () => {
    const q = LIB.slice(LIB.indexOf('function queueUpload('), LIB.indexOf('async function runQueue('));
    expect(q).toContain('L.uploads.push(');
    expect(q).toContain('if (!L.uploading) runQueue();');
  });

  it('reports per-file progress and a results summary', () => {
    expect(LIB).toContain('xhr.upload.onprogress');
    expect(LIB).toContain('role="progressbar"');
    expect(LIB).toContain("' refused' : ''");
  });

  it('asks Replace / Keep both / Skip on a duplicate name, with apply-to-all', () => {
    expect(LIB).toContain("r.data.code === 'duplicate_name'");
    expect(LIB).toContain('Replace (new version)');
    expect(LIB).toContain('Keep both');
    expect(LIB).toContain('id="rhl-dup-all"');
  });

  it('accepts the formats the server accepts, and no more', () => {
    expect(LIB).toContain("var UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg'");
  });

  it('tells a drag of files from a drag of library items', () => {
    expect(LIB).toContain("var DRAG_TYPE = 'application/x-opal-library'");
    expect(LIB).toContain("types.indexOf('Files')");
  });

  it('accepts drops on folder rows, the tree and breadcrumbs', () => {
    expect(LIB).toContain('function crumbTarget(');
    expect(LIB).toMatch(/treeNode[\s\S]*RHLib\.drop\(event/);
    expect(LIB).toMatch(/function dragAttrs[\s\S]*RHLib\.drop\(event/);
  });
});

describe('safety: confirmation and undo', () => {
  it('confirms delete, permanent delete and emptying the bin', () => {
    const del = LIB.slice(LIB.indexOf('async function deleteItems('), LIB.indexOf('// ── Upload'));
    expect(del).toContain('portalConfirm');
    expect(del).toContain('danger: true');
    const purge = LIB.slice(LIB.indexOf('async function binPurge('), LIB.indexOf('function renderBin('));
    expect(purge).toContain('portalConfirm');
    expect(purge).toContain('This cannot be undone.');
  });

  it('warns about learning workflows before deleting a document they use', () => {
    expect(LIB).toContain('/api/rh2/library/delete-check');
    expect(LIB).toContain('This resource was removed');
    expect(LIB).toContain('body.confirm = workflows.length > 0');
  });

  it('offers Undo for move, rename and delete, on the toast and on Cmd/Ctrl+Z', () => {
    expect(LIB).toContain('function offerUndo(');
    expect(LIB).toContain('global.OpalUndo.register');
    expect(LIB).toContain('global.OpalUndo.unregister');
    expect((LIB.match(/offerUndo\('/g) || []).length).toBeGreaterThanOrEqual(3);
    // Undo of a delete is a restore from the bin.
    expect(LIB).toContain("api('/api/rh2/library/recycle-bin/restore'");
  });
});

describe('recycle bin, versions and details', () => {
  it('lists original location, who deleted it, when, and days left', () => {
    for (const s of ['Original location', 'Deleted by', 'Days left']) expect(LIB).toContain(s);
  });

  it('only offers permanent delete when the server says this user may', () => {
    expect(LIB).toContain('if (b.canPurge) out += cmdBtn(\'purge\'');
    expect(LIB).toContain("if (b.canPurge && (b.items || []).length) out += cmdBtn('empty'");
  });

  it('shows version history with download and (for managers) restore', () => {
    expect(LIB).toContain("'/versions'");
    expect(LIB).toContain('p.versions.canRestore && !v.isCurrent');
  });

  it('copies links to documents and folders', () => {
    expect(LIB).toContain("'#resources/library/' + encodeURIComponent(it.id)");
    expect(LIB).toContain("'#resources/detail/' + encodeURIComponent(it.id)");
  });
});

describe('search stays global (§21)', () => {
  it('sends the library search box to the whole-library search', () => {
    expect(LIB).toContain('global.RH2.libSearch(q)');
    expect(JS).toContain('function libSearch(q)');
    expect(JS).toContain('S.lib.folderSearch = false;');
  });

  it('only adds a folder to the query when the reader asks for it', () => {
    expect(JS).toContain("if (f.folderId && (!libSearching(f) || f.folderSearch))");
    expect(JS).toContain('Search the whole library');
  });
});

describe('accessibility and layout (§53, §54)', () => {
  it('signals selection, the current folder and drop targets by more than colour', () => {
    expect(LIBCSS).toMatch(/\.rhl-row\.is-selected \{[^}]*box-shadow: inset 3px 0 0/);
    expect(LIBCSS).toMatch(/\.rhl-tnode\.is-current > \.rhl-trow \{[^}]*border-left-color/);
    expect(LIBCSS).toMatch(/is-drop[^{]*\{[^}]*dashed/);
  });

  it('shows a visible focus ring on rows, tree items, menu items and sort headers', () => {
    for (const s of ['.rhl-row:focus-visible', '.rhl-tnode:focus-visible', '.rhl-menuitem:focus-visible', '.rhl-sort:focus-visible']) {
      expect(LIBCSS).toContain(s);
    }
  });

  it('collapses the tree and hides secondary columns on narrow screens', () => {
    expect(LIBCSS).toContain('@media (max-width: 760px)');
    expect(LIBCSS).toContain('.rhl-tree-toggle { display: flex; }');
    expect(LIBCSS).toContain('.rhl-hide-sm { display: none; }');
  });

  it('respects a reduced-motion preference', () => {
    expect(LIBCSS).toContain('prefers-reduced-motion');
  });

  it('traps Tab inside its dialogs and closes them on Escape', () => {
    expect(LIB).toContain('role="dialog" aria-modal="true"');
    const k = LIB.slice(LIB.indexOf('function dialogKey('));
    expect(k).toContain("ev.key === 'Escape'");
    expect(k).toContain("ev.key !== 'Tab'");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  resourcehub.js — the flat list's rules, executed
// ═════════════════════════════════════════════════════════════════════════════

describe('the rules the flat list is rendered by', () => {
  const RH2 = load(JS, 'resourcehub.js', 'owner').RH2;

  it('offers the workflow tools when the reader is browsing the library', () => {
    expect(RH2._toolsFor({}).length).toBeGreaterThan(0);
  });

  it('offers none of them inside a folder however the reader got there', () => {
    for (const extra of [{}, { q: 'agreement' }, { folderSearch: true }, { collection: 'templates' }]) {
      expect(RH2._toolsFor(Object.assign({ folderId: 'f0000000-0000-4000-8000-000000000000' }, extra)))
        .toEqual([]);
    }
  });

  it('still offers them in the Templates collection, which is where they belong', () => {
    expect(RH2._toolsFor({ collection: 'templates' }).length).toBeGreaterThan(0);
  });

  it('counts the way a person writes it', () => {
    expect(RH2._countLabel(0)).toBe('0 resources');
    expect(RH2._countLabel(1)).toBe('1 resource');
    expect(RH2._countLabel(451)).toBe('451 resources');
  });

  it('says plainly when a linked resource was removed', () => {
    expect(JS).toContain('This resource was removed');
    expect(JS).toContain('it.resource_removed');
  });
});
