/* ═══════════════════════════════════════════════════════════════════════════
   OPAL RESOURCE LIBRARY — a SharePoint-style document library
   Renders the Library's folder browsing into #rhl-root, a mount resourcehub.js
   places inside #rh2-root whenever the Library is browsed (rather than
   searched, filtered or saved — those stay in resourcehub.js's flat list).

   What is here: a folder tree, breadcrumbs, a sortable list view (Name,
   Modified, Modified by, Size, Type) and a tiles view, a filter box, checkbox
   + Shift/Ctrl selection, a command bar that follows the selection, a "…"
   button and a right-click menu on every item (the same actions everywhere),
   drag-and-drop to move and to upload, the recycle bin, version history and a
   details pane — with Undo for move, rename and delete.

   Conventions (mirrors resourcehub.js):
     - single IIFE, string-built HTML, esc() on EVERY server-supplied value;
       inline handlers only ever carry ids, never names
     - one state object, one paint()
     - the server enforces every permission (permissions.js requireRole); the
       client only hides what would be refused
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  var doc = global.document;
  if (!doc) return;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function icn(name, size) {
    if (typeof global.opIcon !== 'function' || !global.OP_ICONS || !global.OP_ICONS[name]) return '';
    return global.opIcon(name, size || 15);
  }

  function role() { return String((global.APP_USER || {}).role || ''); }
  function isOwner() { return role() === 'owner'; }
  /** Owner and Admin manage the library. The server is the control. */
  function canManage() { return role() === 'owner' || role() === 'admin'; }

  function store(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) { /* private window */ }
  }
  function recall(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        data.ok = false;
        data.status = r.status;
        data.code = data.code || null;
        data.error = errorText(r.status, data);
        return data;
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, error: 'Network error — please try again.' };
    }
  }

  /** What a person is told when the server says no. */
  function errorText(status, data) {
    if (status === 403) return 'You do not have permission to do that. Only the practice owner or an admin can change the library.';
    if (status === 413) return 'That file is larger than the 25 MB limit.';
    if (status === 0) return 'Network error — please try again.';
    return (data && (data.message && data.error === 'Forbidden' ? data.message : data.error))
      || ('Something went wrong (' + status + ').');
  }

  function toast(title, sub, kind) {
    if (typeof global.showToast === 'function') global.showToast(title, sub, kind);
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    var now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return 'Today, ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function fmtSize(bytes) {
    if (bytes == null || bytes === '') return '';
    var n = Number(bytes);
    if (!isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
    return (n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0) + ' MB';
  }

  var TYPE_LABELS = {
    pdf: 'PDF', docx: 'Word', xlsx: 'Excel', pptx: 'PowerPoint', png: 'Image', jpg: 'Image',
  };
  function typeLabel(item) {
    if (item.kind === 'folder') return 'Folder';
    if (item.format) return TYPE_LABELS[item.format] || String(item.format).toUpperCase();
    return item.external ? 'Link' : 'Page';
  }

  // ── Pure rules (exported for tests) ──────────────────────────────────────

  var SORT_KEYS = ['name', 'modified', 'modifiedBy', 'size', 'type'];

  /**
   * Sort library items the way a file explorer does: folders first (always,
   * whichever direction), then by the chosen column, ties broken by name.
   */
  function sortItems(items, key, dir) {
    var k = SORT_KEYS.indexOf(key) === -1 ? 'name' : key;
    var sign = dir === 'desc' ? -1 : 1;
    var byName = function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base', numeric: true });
    };
    var value = function (it) {
      if (k === 'modified') return it.modifiedAt ? new Date(it.modifiedAt).getTime() : 0;
      if (k === 'size') return it.size == null ? -1 : Number(it.size);
      if (k === 'modifiedBy') return String(it.modifiedBy || '').toLowerCase();
      if (k === 'type') return typeLabel(it).toLowerCase();
      return null;
    };
    return items.slice().sort(function (a, b) {
      var fa = a.kind === 'folder' ? 0 : 1;
      var fb = b.kind === 'folder' ? 0 : 1;
      if (fa !== fb) return fa - fb;
      var c;
      if (k === 'name') c = byName(a, b);
      else {
        var va = value(a); var vb = value(b);
        c = (va < vb ? -1 : va > vb ? 1 : 0);
        if (c === 0) return byName(a, b);
      }
      return c * sign;
    });
  }

  /** The keys from `anchor` to `target` inclusive, in display order. */
  function rangeKeys(order, anchor, target) {
    var a = order.indexOf(anchor);
    var b = order.indexOf(target);
    if (b === -1) return [];
    if (a === -1) return [target];
    var lo = Math.min(a, b); var hi = Math.max(a, b);
    return order.slice(lo, hi + 1);
  }

  /** Case-insensitive "contains" over the name and file name. */
  function filterItems(items, q) {
    var needle = String(q || '').trim().toLowerCase();
    if (!needle) return items;
    return items.filter(function (it) {
      return String(it.name || '').toLowerCase().indexOf(needle) !== -1
        || String(it.fileName || '').toLowerCase().indexOf(needle) !== -1;
    });
  }

  // ── State ─────────────────────────────────────────────────────────────────

  var VIEW_KEY = 'opal.rhl.view';
  var LAST_KEY = 'opal.rhl.lastFolder';
  var BIN = 'recycle-bin';

  var L = {
    folderId: '',           // '' = the top of the Library; BIN = recycle bin
    data: null, loading: false, err: '',
    tree: null, treeLoading: false, treeOpen: {}, treeShown: false,
    view: recall(VIEW_KEY) === 'tiles' ? 'tiles' : 'list',
    sort: { key: 'name', dir: 'asc' },
    filter: '',
    sel: {}, anchor: '', focus: '',
    menu: null,
    details: null,
    uploads: [], uploading: false, dupChoice: '',
    bin: { items: null, loading: false, err: '', sel: {}, canPurge: false },
    dialog: null,
    busy: false,
  };

  function root() { return doc.getElementById('rhl-root'); }

  // ── Items ─────────────────────────────────────────────────────────────────

  function key(kind, id) { return (kind === 'folder' ? 'f-' : 'd-') + id; }

  function allItems() {
    var d = L.data;
    if (!d) return [];
    var out = (d.folders || []).map(function (f) {
      return {
        key: key('folder', f.id), kind: 'folder', id: f.id, name: f.name,
        description: f.description, modifiedAt: f.modifiedAt, modifiedBy: f.modifiedBy,
        size: null, count: f.count, isReviewBucket: !!f.isReviewBucket,
      };
    });
    (d.documents || []).forEach(function (r) {
      out.push({
        key: key('doc', r.id), kind: 'doc', id: r.id, name: r.title,
        fileName: r.file ? r.file.fileName : '', format: r.file ? r.file.format : '',
        size: r.file ? r.file.sizeBytes : null, file: r.file, external: r.external,
        modifiedAt: r.modifiedAt, modifiedBy: r.modifiedBy, state: r.publicationState,
        versionNo: r.versionNo, mandatory: r.mandatory,
      });
    });
    return out;
  }

  function shownItems() {
    return sortItems(filterItems(allItems(), L.filter), L.sort.key, L.sort.dir);
  }

  function itemByKey(k) {
    var all = allItems();
    for (var i = 0; i < all.length; i++) if (all[i].key === k) return all[i];
    return null;
  }

  function selectedItems() {
    return shownItems().filter(function (it) { return L.sel[it.key]; });
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  async function loadTree(force) {
    if (L.treeLoading || (L.tree && !force)) return;
    L.treeLoading = true;
    var d = await api('/api/rh2/library/folders');
    L.treeLoading = false;
    L.tree = d.ok ? (d.folders || []) : [];
    L.total = d.ok ? (d.totalResources || 0) : 0;
    paint();
  }

  async function loadFolder() {
    var id = L.folderId;
    if (id === BIN) return loadBin();
    L.loading = true;
    L.err = '';
    paint();
    var d = await api('/api/rh2/library/browse?folderId=' + encodeURIComponent(id || 'root'));
    if (L.folderId !== id) return; // the reader moved on
    L.loading = false;
    if (!d.ok) {
      L.data = null;
      L.err = d.status === 404
        ? 'That folder no longer exists. It may have been deleted or moved.'
        : d.error;
      if (d.status === 404 && recall(LAST_KEY) === id) store(LAST_KEY, '');
    } else {
      L.data = d;
      // Opening a folder reveals it in the tree.
      (d.breadcrumb || []).forEach(function (b) { L.treeOpen[b.id] = true; });
    }
    paint();
  }

  async function loadBin() {
    L.bin.loading = true;
    L.bin.err = '';
    paint();
    var d = await api('/api/rh2/library/recycle-bin');
    L.bin.loading = false;
    L.bin.items = d.ok ? (d.items || []) : [];
    L.bin.canPurge = !!(d.ok && d.canPurge);
    L.bin.err = d.ok ? '' : d.error;
    paint();
  }

  function refresh() {
    loadTree(true);
    loadFolder();
    if (L.details) loadDetails(L.details.key, L.details.tab);
  }

  // ── Opening ───────────────────────────────────────────────────────────────

  /**
   * Show a folder. Called by resourcehub.js's libOpenFolder, which is the
   * function navigation.js hooks — so every folder change goes through it and
   * gets a history entry. Inline handlers here therefore call
   * RH2.libOpenFolder, never this directly.
   */
  function open(id) {
    id = String(id || '');
    if (id === BIN && !canManage()) id = '';
    var changed = id !== L.folderId || !L.data;
    L.folderId = id;
    if (changed) {
      L.sel = {}; L.anchor = ''; L.focus = ''; L.filter = '';
      L.menu = null; L.dialog = null;
      if (L.details && id === BIN) L.details = null;
      L.data = null;
    }
    if (id && id !== BIN) store(LAST_KEY, id);
    if (!id) store(LAST_KEY, '');
    loadTree();
    if (id === BIN) { L.bin.sel = {}; loadBin(); } else loadFolder();
  }

  function current() { return L.folderId; }

  /** The folder last open, for a session that starts at the Library. */
  function remembered() { return recall(LAST_KEY) || ''; }

  function go(id) {
    if (global.RH2 && typeof global.RH2.libOpenFolder === 'function') global.RH2.libOpenFolder(id || '');
    else open(id);
  }

  function openItem(k) {
    var it = itemByKey(k);
    if (!it) return;
    if (it.kind === 'folder') return go(it.id);
    if (global.RH2 && typeof global.RH2.openDetail === 'function') global.RH2.openDetail(it.id, 'library');
  }

  // ── Painting ──────────────────────────────────────────────────────────────

  var mounted = null;

  /** resourcehub.js calls this after every render of the Library view. */
  function mount(el) {
    mounted = el || root();
    if (!L.data && !L.loading && L.folderId !== BIN) loadFolder();
    if (L.folderId === BIN && !L.bin.items && !L.bin.loading) loadBin();
    if (!L.tree && !L.treeLoading) loadTree();
    paint();
  }

  function paint() {
    var host = root();
    if (!host) return;
    var prev = doc.activeElement;
    var focusId = (prev && prev.id && host.contains(prev)) ? prev.id : '';
    var caret = null;
    if (focusId) { try { caret = [prev.selectionStart, prev.selectionEnd]; } catch (e) { caret = null; } }

    host.innerHTML = renderAll();
    host.setAttribute('data-mode', L.folderId === BIN ? 'bin' : 'browse');

    var want = focusId || (L.focus ? 'rhl-row-' + L.focus : '');
    if (want) {
      var el = doc.getElementById(want);
      if (el && (focusId || host.contains(doc.activeElement) || doc.activeElement === doc.body)) {
        try { el.focus({ preventScroll: true }); } catch (e) { /* gone */ }
        if (caret && caret[0] != null) { try { el.setSelectionRange(caret[0], caret[1]); } catch (e2) { /* type */ } }
      }
    }
    if (L.menu) placeMenu();
  }

  function renderAll() {
    var bin = L.folderId === BIN;
    var out = '<div class="rhl' + (L.details ? ' has-details' : '') + '">';
    out += renderHead();
    out += '<div class="rhl-body">';
    out += renderTree();
    out += '<section class="rhl-main" id="rhl-main" aria-label="' + (bin ? 'Recycle bin' : 'Folder contents') + '"'
      + (bin ? '' : ' oncontextmenu="return RHLib.ctx(event,\'\')"'
        + ' ondragover="RHLib.dragOver(event,\'here\')" ondragleave="RHLib.dragLeave(event)"'
        + ' ondrop="RHLib.drop(event,\'here\')"')
      + '>';
    out += bin ? renderBin() : renderBrowse();
    out += '</section>';
    if (L.details && !bin) out += renderDetails();
    out += '</div>';
    out += renderMenu();
    out += renderDialog();
    return out + '</div>';
  }

  // ── Header: breadcrumbs and the library-wide search ───────────────────────

  function crumbTarget(id) {
    return canManage()
      ? ' ondragover="RHLib.dragOver(event,\'' + esc(id || 'root') + '\')" ondragleave="RHLib.dragLeave(event)"'
        + ' ondrop="RHLib.drop(event,\'' + esc(id || 'root') + '\')"'
      : '';
  }

  function renderHead() {
    var bin = L.folderId === BIN;
    var d = L.data;
    var parts = ['<li><button type="button" class="rhl-crumb" onclick="RH2.libOpenFolder(\'\')"' + crumbTarget('') + '>Library</button></li>'];
    if (bin) {
      parts.push('<li><span class="rhl-crumb-here" aria-current="page">Recycle bin</span></li>');
    } else if (d && d.folder) {
      (d.breadcrumb || []).forEach(function (b) {
        parts.push('<li><button type="button" class="rhl-crumb" onclick="RH2.libOpenFolder(\'' + esc(b.id) + '\')"'
          + crumbTarget(b.id) + '>' + esc(b.name) + '</button></li>');
      });
      parts.push('<li><span class="rhl-crumb-here" aria-current="page">' + esc(d.folder.name) + '</span></li>');
    }
    var title = bin ? 'Recycle bin' : (d && d.folder ? d.folder.name : 'Library');
    return '<header class="rhl-head">'
      + '<nav aria-label="Library location"><ol class="rhl-crumbs">'
      + parts.join('<li class="rhl-crumb-sep" aria-hidden="true">›</li>') + '</ol></nav>'
      + '<div class="rhl-titlebar"><h1 class="rh2-h1 rhl-title">' + esc(title) + '</h1>'
      + '<form class="rhl-search" role="search" onsubmit="return RHLib.search(event)">'
      + '<label class="rh2-visually-hidden" for="rhl-search">Search all resources</label>'
      + '<input type="search" id="rhl-search" class="rh2-search" placeholder="Search all resources…">'
      + '</form></div>'
      + (d && d.folder && d.folder.description && !bin ? '<p class="rhl-lede">' + esc(d.folder.description) + '</p>' : '')
      + '</header>';
    // (Layout: .rhl-head neutralises the app shell's global <header> bar style.)
  }

  function search(ev) {
    if (ev) ev.preventDefault();
    var input = doc.getElementById('rhl-search');
    var q = input ? input.value.trim() : '';
    if (q && global.RH2 && typeof global.RH2.libSearch === 'function') global.RH2.libSearch(q);
    return false;
  }

  // ── The folder tree ───────────────────────────────────────────────────────

  /** The ids of every node currently visible in the tree, in order. */
  function treeOrder() {
    var out = [''];
    (function walk(nodes) {
      (nodes || []).forEach(function (n) {
        out.push(n.id);
        if (L.treeOpen[n.id] && (n.children || []).length) walk(n.children);
      });
    })(L.tree || []);
    if (canManage()) out.push(BIN);
    return out;
  }

  function treeNode(n, level, posinset, setsize) {
    var kids = n.children || [];
    var open = !!L.treeOpen[n.id];
    var here = L.folderId === n.id;
    var out = '<li role="treeitem" id="rhl-tree-' + esc(n.id) + '" class="rhl-tnode' + (here ? ' is-current' : '') + '"'
      + ' aria-level="' + level + '" aria-posinset="' + posinset + '" aria-setsize="' + setsize + '"'
      + ' aria-selected="' + (here ? 'true' : 'false') + '"'
      + (kids.length ? ' aria-expanded="' + (open ? 'true' : 'false') + '"' : '')
      + ' tabindex="' + (here ? '0' : '-1') + '"'
      + ' onclick="RHLib.treeClick(event,\'' + esc(n.id) + '\')"'
      + ' onkeydown="RHLib.treeKey(event,\'' + esc(n.id) + '\')"'
      + (canManage() ? ' ondragover="RHLib.dragOver(event,\'' + esc(n.id) + '\')" ondragleave="RHLib.dragLeave(event)"'
        + ' ondrop="RHLib.drop(event,\'' + esc(n.id) + '\')"' : '')
      + '>'
      + '<span class="rhl-trow" style="padding-left:' + (6 + (level - 1) * 14) + 'px">'
      + (kids.length
        ? '<span class="rhl-twist" aria-hidden="true" data-toggle="1">' + (open ? '▾' : '▸') + '</span>'
        : '<span class="rhl-twist" aria-hidden="true"></span>')
      + '<span class="rhl-ticon" aria-hidden="true">' + icn('folder', 14) + '</span>'
      + '<span class="rhl-tname">' + esc(n.name) + '</span>'
      + '<span class="rhl-tcount" aria-label="' + esc(n.count) + ' documents">' + esc(n.count) + '</span>'
      + '</span>';
    if (kids.length && open) {
      out += '<ul role="group">' + kids.map(function (c, i) { return treeNode(c, level + 1, i + 1, kids.length); }).join('') + '</ul>';
    }
    return out + '</li>';
  }

  function renderTree() {
    var nodes = L.tree || [];
    var top = !L.folderId;
    var out = '<aside class="rhl-tree' + (L.treeShown ? ' is-shown' : '') + '" aria-label="Folders">'
      + '<button type="button" class="rh2-btn rhl-tree-toggle" aria-expanded="' + (L.treeShown ? 'true' : 'false') + '"'
      + ' aria-controls="rhl-tree" onclick="RHLib.toggleTree()">Folders ' + (L.treeShown ? '▾' : '▸') + '</button>'
      + '<ul class="rhl-tlist" id="rhl-tree" role="tree" aria-label="Library folders">'
      + '<li role="treeitem" id="rhl-tree-root" class="rhl-tnode' + (top ? ' is-current' : '') + '" aria-level="1"'
      + ' aria-selected="' + (top ? 'true' : 'false') + '" tabindex="' + (top ? '0' : '-1') + '"'
      + ' onclick="RHLib.treeClick(event,\'\')" onkeydown="RHLib.treeKey(event,\'\')"' + crumbTarget('') + '>'
      + '<span class="rhl-trow"><span class="rhl-twist" aria-hidden="true"></span>'
      + '<span class="rhl-tname"><strong>Library</strong></span></span></li>';
    if (L.tree === null) out += '<li class="rhl-tnote" role="none">Loading folders…</li>';
    out += nodes.map(function (n, i) { return treeNode(n, 1, i + 1, nodes.length); }).join('');
    if (canManage()) {
      var inBin = L.folderId === BIN;
      out += '<li role="treeitem" id="rhl-tree-' + BIN + '" class="rhl-tnode rhl-tbin' + (inBin ? ' is-current' : '') + '"'
        + ' aria-level="1" aria-selected="' + (inBin ? 'true' : 'false') + '" tabindex="' + (inBin ? '0' : '-1') + '"'
        + ' onclick="RHLib.treeClick(event,\'' + BIN + '\')" onkeydown="RHLib.treeKey(event,\'' + BIN + '\')">'
        + '<span class="rhl-trow"><span class="rhl-twist" aria-hidden="true"></span>'
        + '<span class="rhl-ticon" aria-hidden="true">' + icn('trash', 14) + '</span>'
        + '<span class="rhl-tname">Recycle bin</span></span></li>';
    }
    out += '</ul>'
      + '<button type="button" class="rh2-linkbtn rhl-allres" onclick="RH2.libBrowse(\'all\')">All resources'
      + (typeof L.total === 'number' ? ' (' + esc(L.total) + ')' : '') + '</button>'
      + '</aside>';
    return out;
  }

  function toggleTree() { L.treeShown = !L.treeShown; paint(); }

  function treeClick(ev, id) {
    var t = ev && ev.target;
    if (t && t.getAttribute && t.getAttribute('data-toggle')) {
      if (ev.stopPropagation) ev.stopPropagation();
      L.treeOpen[id] = !L.treeOpen[id];
      paint();
      focusTree(id);
      return;
    }
    if (ev && ev.stopPropagation) ev.stopPropagation();
    L.treeShown = false;
    go(id);
  }

  function focusTree(id) {
    var el = doc.getElementById('rhl-tree-' + (id || 'root'));
    if (el) { try { el.focus(); } catch (e) { /* gone */ } }
  }

  function findNode(id, nodes, parent) {
    nodes = nodes || L.tree || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].id === id) return { node: nodes[i], parent: parent || null };
      var hit = findNode(id, nodes[i].children || [], nodes[i]);
      if (hit) return hit;
    }
    return null;
  }

  /** WAI-ARIA tree keyboard: arrows walk and fold, Enter opens. */
  function treeKey(ev, id) {
    var order = treeOrder();
    var at = order.indexOf(id);
    var hit = id && id !== BIN ? findNode(id) : null;
    var k = ev.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') {
      ev.preventDefault(); ev.stopPropagation();
      var next = order[Math.max(0, Math.min(order.length - 1, at + (k === 'ArrowDown' ? 1 : -1)))];
      focusTree(next);
    } else if (k === 'ArrowRight') {
      ev.preventDefault(); ev.stopPropagation();
      if (hit && (hit.node.children || []).length) {
        if (!L.treeOpen[id]) { L.treeOpen[id] = true; paint(); focusTree(id); } else focusTree(hit.node.children[0].id);
      }
    } else if (k === 'ArrowLeft') {
      ev.preventDefault(); ev.stopPropagation();
      if (hit && L.treeOpen[id]) { L.treeOpen[id] = false; paint(); focusTree(id); } else if (hit && hit.parent) focusTree(hit.parent.id);
      else focusTree('');
    } else if (k === 'Home' || k === 'End') {
      ev.preventDefault(); ev.stopPropagation();
      focusTree(k === 'Home' ? order[0] : order[order.length - 1]);
    } else if (k === 'Enter' || k === ' ') {
      ev.preventDefault(); ev.stopPropagation();
      L.treeShown = false;
      go(id);
    }
  }

  // ── The command bar ───────────────────────────────────────────────────────

  /**
   * Every action that applies to the given items, in one list. The command
   * bar, the "…" button and the right-click menu all read from here, so the
   * three can never offer different things.
   */
  function actionsFor(items, where) {
    // where: 'bar' for the command bar, anything else for the "…"/right-click
    // menus. The bar is kept short so it fits one row (Oct 2026): Version
    // history is only in the menus, Details is gone.
    var out = [];
    var mgr = canManage();
    var one = items.length === 1 ? items[0] : null;
    var docs = items.filter(function (i) { return i.kind === 'doc'; });
    if (!items.length) return out;
    if (one) out.push({ act: 'open', label: 'Open', icon: 'forward' });
    if (docs.some(function (d) { return d.file; })) {
      out.push({ act: 'download', label: docs.length > 1 ? 'Download (' + docs.filter(function (d) { return d.file; }).length + ')' : 'Download', icon: 'doc' });
    }
    if (one) out.push({ act: 'copyLink', label: 'Copy link', icon: 'pin' });
    if (mgr && one) out.push({ act: 'rename', label: 'Rename', icon: 'edit', key: 'F2' });
    if (mgr) out.push({ act: 'move', label: 'Move to…', icon: 'folder' });
    if (mgr && one && one.kind === 'doc') out.push({ act: 'replace', label: 'Replace (new version)', icon: 'refresh' });
    if (one && one.kind === 'doc' && where !== 'bar') out.push({ act: 'versions', label: 'Version history', icon: 'clock' });
    if (mgr && !items.some(function (i) { return i.isReviewBucket; })) {
      out.push({ act: 'delete', label: 'Delete', icon: 'trash', danger: true, key: 'Del' });
    }
    return out;
  }

  function newActions() {
    var here = L.folderId && L.folderId !== BIN;
    var out = [{ act: 'newFolder', label: here ? 'Folder' : 'Folder (top level)', icon: 'folder' }];
    if (here) out.push({ act: 'newDocument', label: 'Document (written page)', icon: 'doc' });
    return out;
  }

  function cmdBtn(id, label, icon, handler, extra) {
    return '<button type="button" class="rh2-btn rhl-cmd" id="rhl-cmd-' + id + '" onclick="' + handler + '"' + (extra || '') + '>'
      + (icon ? '<span class="rh2-btn-icon" aria-hidden="true">' + icn(icon, 15) + '</span>' : '')
      + esc(label) + '</button>';
  }

  function renderCommandBar() {
    var sel = selectedItems();
    var mgr = canManage();
    var here = L.folderId && L.folderId !== BIN;
    var out = '<div class="rhl-cmdbar" role="toolbar" aria-label="Library commands">';
    if (!sel.length) {
      if (mgr) {
        out += cmdBtn('new', 'New', 'plus', 'RHLib.menuFor(event,\'new\')', ' aria-haspopup="menu" aria-expanded="' + (L.menu && L.menu.kind === 'new' ? 'true' : 'false') + '"');
        if (here) out += cmdBtn('upload', 'Upload', 'plus', 'RHLib.menuFor(event,\'upload\')', ' aria-haspopup="menu" aria-expanded="' + (L.menu && L.menu.kind === 'upload' ? 'true' : 'false') + '"');
      }
      if (L.data && L.data.folder) out += cmdBtn('copyfolder', 'Copy link', 'pin', 'RHLib.copyFolderLink()');
    } else {
      actionsFor(sel, 'bar').forEach(function (a) {
        out += cmdBtn(a.act, a.label, a.icon, 'RHLib.act(\'' + a.act + '\')', a.danger ? ' data-danger="1"' : '');
      });
      out += '<span class="rhl-selcount" role="status">' + sel.length + ' selected</span>'
        + '<button type="button" class="rh2-btn rh2-btn-quiet" id="rhl-cmd-clear" onclick="RHLib.clearSel()" aria-label="Clear selection">✕</button>';
    }
    out += '<span class="rhl-cmd-spacer"></span>';
    if (!sel.length) out += '<label class="rh2-visually-hidden" for="rhl-filter">Filter this folder</label>'
      + '<input type="search" id="rhl-filter" class="rhl-filter" placeholder="Filter this folder" value="' + esc(L.filter) + '"'
      + ' oninput="RHLib.setFilter(this.value)">';
    out += '<div class="rhl-viewtoggle" role="group" aria-label="View">'
      + '<button type="button" class="rh2-btn' + (L.view === 'list' ? ' is-on' : '') + '" id="rhl-view-list" aria-pressed="' + (L.view === 'list') + '" onclick="RHLib.setView(\'list\')">List</button>'
      + '<button type="button" class="rh2-btn' + (L.view === 'tiles' ? ' is-on' : '') + '" id="rhl-view-tiles" aria-pressed="' + (L.view === 'tiles') + '" onclick="RHLib.setView(\'tiles\')">Tiles</button>'
      + '</div>';
    return out + '</div>';
  }

  // ── Browsing: list and tiles ──────────────────────────────────────────────

  function stateChip(it) {
    if (it.kind !== 'doc' || !canManage() || !it.state) return '';
    if (it.state === 'approved' || it.state === 'published') return '';
    var label = it.state === 'retired' ? 'Withdrawn' : it.state === 'inventory' ? 'Catalogued' : 'In review';
    return ' <span class="rh2-chip rhl-chip">' + esc(label) + '</span>';
  }

  function itemIcon(it) {
    if (it.kind === 'folder') return '<span class="rhl-icon rhl-icon-folder" aria-hidden="true">' + icn('folder', 18) + '</span>';
    var f = String(it.format || (it.external ? 'link' : 'page'));
    return '<span class="rhl-icon rhl-icon-' + esc(f) + '" aria-hidden="true">' + esc(typeLabel(it).slice(0, 3).toUpperCase()) + '</span>';
  }

  /** The "…" button. Only the focused row's is a Tab stop, so a long list is not a hundred stops. */
  function moreBtn(it, focusable) {
    return '<button type="button" class="rhl-more" id="rhl-more-' + esc(it.key) + '" aria-haspopup="menu"'
      + ' tabindex="' + (focusable ? '0' : '-1') + '"'
      + ' aria-label="More actions for ' + esc(it.name) + '" onclick="RHLib.more(event,\'' + esc(it.key) + '\')">…</button>';
  }

  function dragAttrs(it) {
    if (!canManage()) return '';
    var out = ' draggable="true" ondragstart="RHLib.dragStart(event,\'' + esc(it.key) + '\')" ondragend="RHLib.dragEnd()"';
    if (it.kind === 'folder') {
      out += ' ondragover="RHLib.dragOver(event,\'' + esc(it.id) + '\')" ondragleave="RHLib.dragLeave(event)"'
        + ' ondrop="RHLib.drop(event,\'' + esc(it.id) + '\')"';
    }
    return out;
  }

  function sortHead(k, label, extraClass) {
    var on = L.sort.key === k;
    var dir = on ? (L.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none';
    return '<th scope="col" role="columnheader" class="rhl-col-' + k + (extraClass || '') + '" aria-sort="' + dir + '">'
      + '<button type="button" class="rhl-sort" id="rhl-sort-' + k + '" onclick="RHLib.sortBy(\'' + k + '\')">'
      + esc(label) + '<span class="rhl-sortmark" aria-hidden="true">' + (on ? (L.sort.dir === 'asc' ? ' ↑' : ' ↓') : '') + '</span></button></th>';
  }

  function renderList(items) {
    var allOn = items.length && items.every(function (it) { return L.sel[it.key]; });
    var focusKey = L.focus && items.some(function (i) { return i.key === L.focus; }) ? L.focus : (items[0] ? items[0].key : '');
    var out = '<table class="rhl-list" role="grid" aria-multiselectable="true" aria-rowcount="' + (items.length + 1) + '"'
      + ' aria-label="Contents of ' + esc(L.data && L.data.folder ? L.data.folder.name : 'Library') + '"'
      + ' onkeydown="RHLib.listKey(event)">'
      + '<thead><tr role="row">'
      + '<th scope="col" class="rhl-col-check"><input type="checkbox" id="rhl-selall" aria-label="Select all"'
      + (allOn ? ' checked' : '') + ' onclick="RHLib.selectAll(this.checked)"></th>'
      + sortHead('name', 'Name') + sortHead('modified', 'Modified') + sortHead('modifiedBy', 'Modified by', ' rhl-hide-sm')
      + sortHead('size', 'Size', ' rhl-hide-sm') + sortHead('type', 'Type', ' rhl-hide-xs')
      + '<th scope="col" class="rhl-col-more"><span class="rh2-visually-hidden">Actions</span></th>'
      + '</tr></thead><tbody>';
    items.forEach(function (it, i) {
      var on = !!L.sel[it.key];
      out += '<tr role="row" id="rhl-row-' + esc(it.key) + '" class="rhl-row' + (on ? ' is-selected' : '') + '"'
        + ' aria-rowindex="' + (i + 2) + '" aria-selected="' + on + '" tabindex="' + (it.key === focusKey ? '0' : '-1') + '"'
        + ' data-key="' + esc(it.key) + '"'
        + ' onclick="RHLib.rowClick(event,\'' + esc(it.key) + '\')" ondblclick="RHLib.openKey(\'' + esc(it.key) + '\')"'
        + ' onfocus="RHLib.rowFocus(\'' + esc(it.key) + '\')"'
        + ' oncontextmenu="return RHLib.ctx(event,\'' + esc(it.key) + '\')"' + dragAttrs(it) + '>'
        + '<td role="gridcell" class="rhl-col-check"><input type="checkbox" tabindex="-1" aria-label="Select ' + esc(it.name) + '"'
        + (on ? ' checked' : '') + ' onclick="RHLib.checkClick(event,\'' + esc(it.key) + '\')"></td>'
        + '<td role="gridcell" class="rhl-col-name">' + itemIcon(it)
        + '<button type="button" class="rhl-name" tabindex="-1" onclick="RHLib.openKey(\'' + esc(it.key) + '\')">' + esc(it.name) + '</button>'
        + stateChip(it)
        + (it.kind === 'folder' ? ' <span class="rhl-count">' + esc(it.count) + '</span>' : '')
        + '</td>'
        + '<td role="gridcell" class="rhl-col-modified">' + esc(fmtDate(it.modifiedAt)) + '</td>'
        + '<td role="gridcell" class="rhl-col-modifiedBy rhl-hide-sm">' + esc(it.modifiedBy || '') + '</td>'
        + '<td role="gridcell" class="rhl-col-size rhl-hide-sm">' + esc(fmtSize(it.size)) + '</td>'
        + '<td role="gridcell" class="rhl-col-type rhl-hide-xs">' + esc(typeLabel(it)) + '</td>'
        + '<td role="gridcell" class="rhl-col-more">' + moreBtn(it, it.key === focusKey) + '</td>'
        + '</tr>';
    });
    return out + '</tbody></table>';
  }

  function renderTiles(items) {
    var focusKey = L.focus && items.some(function (i) { return i.key === L.focus; }) ? L.focus : (items[0] ? items[0].key : '');
    var out = '<div class="rhl-tiles" role="listbox" aria-multiselectable="true" aria-orientation="horizontal"'
      + ' aria-label="Contents" onkeydown="RHLib.listKey(event)">';
    items.forEach(function (it) {
      var on = !!L.sel[it.key];
      var thumb = it.file && it.file.thumbnailUrl
        ? '<img class="rhl-thumb" src="' + esc(it.file.thumbnailUrl) + '" alt="" loading="lazy">'
        : '<span class="rhl-thumb rhl-thumb-glyph">' + itemIcon(it) + '</span>';
      out += '<div role="option" id="rhl-row-' + esc(it.key) + '" class="rhl-tile' + (on ? ' is-selected' : '') + '"'
        + ' aria-selected="' + on + '" tabindex="' + (it.key === focusKey ? '0' : '-1') + '" data-key="' + esc(it.key) + '"'
        + ' onclick="RHLib.rowClick(event,\'' + esc(it.key) + '\')" ondblclick="RHLib.openKey(\'' + esc(it.key) + '\')"'
        + ' onfocus="RHLib.rowFocus(\'' + esc(it.key) + '\')"'
        + ' oncontextmenu="return RHLib.ctx(event,\'' + esc(it.key) + '\')"' + dragAttrs(it) + '>'
        + '<input type="checkbox" class="rhl-tile-check" tabindex="-1" aria-label="Select ' + esc(it.name) + '"'
        + (on ? ' checked' : '') + ' onclick="RHLib.checkClick(event,\'' + esc(it.key) + '\')">'
        + thumb
        + '<span class="rhl-tile-name">' + esc(it.name) + stateChip(it) + '</span>'
        + '<span class="rhl-tile-meta">' + esc(it.kind === 'folder' ? (it.count + (it.count === 1 ? ' item' : ' items')) : [typeLabel(it), fmtSize(it.size)].filter(Boolean).join(' · ')) + '</span>'
        + moreBtn(it, it.key === focusKey)
        + '</div>';
    });
    return out + '</div>';
  }

  function renderEmpty() {
    var here = L.folderId && L.folderId !== BIN;
    if (L.filter) {
      return '<div class="rhl-empty" role="status"><p>Nothing in this folder matches “' + esc(L.filter) + '”.</p>'
        + '<button type="button" class="rh2-btn" onclick="RHLib.setFilter(\'\')">Clear filter</button></div>';
    }
    if (!here) {
      return '<div class="rhl-empty"><p>No folders yet.</p>'
        + (canManage() ? '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RHLib.act(\'newFolder\')">New folder</button>' : '')
        + '</div>';
    }
    return '<div class="rhl-empty"><span class="rhl-empty-icon" aria-hidden="true">' + icn('folder', 32) + '</span>'
      + '<p><strong>This folder is empty.</strong></p>'
      + (canManage()
        ? '<p>Drag files here, or:</p><div class="rhl-empty-actions">'
          + '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RHLib.act(\'upload\')">Upload files</button>'
          + '<button type="button" class="rh2-btn" onclick="RHLib.act(\'newFolder\')">New folder</button></div>'
        : '<p>Nothing has been filed here yet.</p>')
      + '</div>';
  }

  function renderBrowse() {
    var out = renderCommandBar();
    out += renderUploads();
    if (L.loading && !L.data) return out + '<div class="rhl-loading" role="status">Loading…</div>';
    if (L.err) {
      return out + '<div class="rhl-empty" role="alert"><p>' + esc(L.err) + '</p>'
        + '<button type="button" class="rh2-btn" onclick="RH2.libOpenFolder(\'\')">Go to the top of the Library</button></div>';
    }
    var items = shownItems();
    if (!items.length) return out + renderEmpty();
    out += '<p class="rh2-visually-hidden" role="status">' + items.length + (items.length === 1 ? ' item' : ' items') + '</p>';
    out += L.view === 'tiles' ? renderTiles(items) : renderList(items);
    if (canManage() && L.folderId) {
      out += '<p class="rhl-hint">Tip: drag files from your computer onto this list to upload, or drag items onto a folder to move them.</p>';
    }
    return out;
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function orderKeys() { return shownItems().map(function (i) { return i.key; }); }

  function selectOnly(k) { L.sel = {}; if (k) L.sel[k] = true; L.anchor = k; }

  function rowClick(ev, k) {
    var t = ev && ev.target;
    if (t && t.closest && t.closest('button, a, input, .rhl-more')) return;
    applyClick(ev, k);
  }

  function applyClick(ev, k) {
    if (ev && ev.shiftKey && L.anchor) {
      var keep = (ev.ctrlKey || ev.metaKey) ? Object.assign({}, L.sel) : {};
      rangeKeys(orderKeys(), L.anchor, k).forEach(function (x) { keep[x] = true; });
      L.sel = keep;
    } else if (ev && (ev.ctrlKey || ev.metaKey)) {
      if (L.sel[k]) delete L.sel[k]; else L.sel[k] = true;
      L.anchor = k;
    } else {
      selectOnly(k);
    }
    L.focus = k;
    if (L.details && Object.keys(L.sel).length === 1) loadDetails(k, L.details.tab);
    paint();
  }

  /** A checkbox toggles; with Shift it extends from the anchor. */
  function checkClick(ev, k) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    if (ev && ev.shiftKey && L.anchor) {
      rangeKeys(orderKeys(), L.anchor, k).forEach(function (x) { L.sel[x] = true; });
    } else {
      if (L.sel[k]) delete L.sel[k]; else L.sel[k] = true;
      L.anchor = k;
    }
    L.focus = k;
    paint();
  }

  function selectAll(on) {
    L.sel = {};
    if (on) orderKeys().forEach(function (k) { L.sel[k] = true; });
    paint();
  }

  function clearSel() { L.sel = {}; L.anchor = ''; paint(); }

  function rowFocus(k) { L.focus = k; }

  function focusRow(k) {
    L.focus = k;
    var el = doc.getElementById('rhl-row-' + k);
    if (el) {
      var all = root() ? root().querySelectorAll('[data-key]') : [];
      for (var i = 0; i < all.length; i++) all[i].setAttribute('tabindex', '-1');
      var mores = root().querySelectorAll('.rhl-more');
      for (var j = 0; j < mores.length; j++) mores[j].setAttribute('tabindex', '-1');
      el.setAttribute('tabindex', '0');
      var mine = doc.getElementById('rhl-more-' + k);
      if (mine) mine.setAttribute('tabindex', '0');
      try { el.focus(); } catch (e) { /* gone */ }
    }
  }

  /**
   * The list owns the keyboard while focus is in it: arrows move, Shift
   * extends, Space selects, Enter opens, F2 renames, Delete deletes (to the
   * bin), Ctrl/Cmd+A selects all, Shift+F10 / the menu key opens the menu.
   */
  function listKey(ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox')) return;
    var order = orderKeys();
    if (!order.length) return;
    var at = order.indexOf(L.focus);
    var k = ev.key;
    var step = 0;
    if (k === 'ArrowDown' || (L.view === 'tiles' && k === 'ArrowRight')) step = 1;
    if (k === 'ArrowUp' || (L.view === 'tiles' && k === 'ArrowLeft')) step = -1;
    if (step || k === 'Home' || k === 'End') {
      ev.preventDefault();
      var next = k === 'Home' ? 0 : k === 'End' ? order.length - 1 : Math.max(0, Math.min(order.length - 1, (at === -1 ? 0 : at + step)));
      var nk = order[next];
      if (ev.shiftKey) {
        if (!L.anchor) L.anchor = order[at === -1 ? 0 : at];
        L.sel = {};
        rangeKeys(order, L.anchor, nk).forEach(function (x) { L.sel[x] = true; });
        L.focus = nk;
        paint();
        focusRow(nk);
      } else {
        focusRow(nk);
      }
      return;
    }
    var cur = L.focus || order[0];
    if (k === ' ') { ev.preventDefault(); checkClick({ shiftKey: ev.shiftKey }, cur); focusRow(cur); return; }
    if (k === 'Enter') { ev.preventDefault(); openItem(cur); return; }
    if ((k === 'a' || k === 'A') && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); selectAll(true); focusRow(cur); return; }
    if (k === 'Escape') { if (Object.keys(L.sel).length) { ev.preventDefault(); clearSel(); focusRow(cur); } return; }
    if (k === 'F2' && canManage()) { ev.preventDefault(); ensureSelected(cur); act('rename'); return; }
    if ((k === 'Delete' || (k === 'Backspace' && (ev.metaKey))) && canManage()) { ev.preventDefault(); ensureSelected(cur); act('delete'); return; }
    if (k === 'ContextMenu' || (k === 'F10' && ev.shiftKey)) {
      ev.preventDefault();
      ensureSelected(cur);
      var el = doc.getElementById('rhl-more-' + cur) || doc.getElementById('rhl-row-' + cur);
      var box = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 40, bottom: 40 };
      openMenu('items', box.left, box.bottom, 'rhl-row-' + cur);
    }
  }

  function ensureSelected(k) {
    if (!L.sel[k]) selectOnly(k);
    L.focus = k;
  }

  function openKey(k) { openItem(k); }

  function setFilter(v) { L.filter = String(v || ''); L.sel = {}; paint(); }
  function setView(v) { L.view = v === 'tiles' ? 'tiles' : 'list'; store(VIEW_KEY, L.view); paint(); }
  function sortBy(k) {
    if (L.sort.key === k) L.sort.dir = L.sort.dir === 'asc' ? 'desc' : 'asc';
    else { L.sort.key = k; L.sort.dir = k === 'modified' ? 'desc' : 'asc'; }
    paint();
  }

  // ── Menus ─────────────────────────────────────────────────────────────────

  function openMenu(kind, x, y, returnTo) {
    var items;
    if (kind === 'new') items = newActions();
    else if (kind === 'upload') items = [{ act: 'upload', label: 'Files', icon: 'doc' }];
    else if (kind === 'space') {
      items = [];
      if (canManage()) {
        items = items.concat(newActions().map(function (a) { return Object.assign({}, a, { label: 'New ' + a.label.toLowerCase() }); }));
        if (L.folderId) items.push({ act: 'upload', label: 'Upload files…', icon: 'plus' });
      }
      if (orderKeys().length) items.push({ act: 'selectAll', label: 'Select all', icon: 'check' });
      items.push({ act: 'refresh', label: 'Refresh', icon: 'refresh' });
      if (L.data && L.data.folder) items.push({ act: 'copyFolderLink', label: 'Copy link to this folder', icon: 'pin' });
    } else items = actionsFor(selectedItems());
    if (!items.length) return;
    L.menu = { kind: kind, x: x, y: y, items: items, returnTo: returnTo || '' };
    paint();
    var first = doc.querySelector('.rhl-menu [role="menuitem"]');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
  }

  function menuFor(ev, kind) {
    var el = ev && ev.currentTarget;
    var box = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 40, bottom: 40 };
    if (L.menu && L.menu.kind === kind) return closeMenu();
    openMenu(kind, box.left, box.bottom + 4, el && el.id);
  }

  /** The "…" button: the same menu as right-click, reachable by touch and keyboard. */
  function more(ev, k) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    ensureSelected(k);
    var el = ev && ev.currentTarget;
    var box = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 40, bottom: 40 };
    openMenu('items', box.left, box.bottom + 4, 'rhl-more-' + k);
  }

  /** Right-click: an item's actions, or what can be made here on empty space. */
  function ctx(ev, k) {
    var t = ev.target;
    if (t && t.closest && t.closest('input, textarea, select, a[href], .rhl-menu, .rhl-dialog')) return true;
    if (L.folderId === BIN) return true;
    ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    if (k) {
      ensureSelected(k);
      openMenu('items', ev.clientX, ev.clientY, 'rhl-row-' + k);
    } else {
      openMenu('space', ev.clientX, ev.clientY, '');
    }
    return false;
  }

  function closeMenu(keepFocus) {
    var back = L.menu && L.menu.returnTo;
    L.menu = null;
    paint();
    if (back && !keepFocus) {
      var el = doc.getElementById(back);
      if (el) { try { el.focus(); } catch (e) { /* gone */ } }
    }
  }

  function placeMenu() {
    var el = doc.querySelector('.rhl-menu');
    if (!el || !L.menu || !el.getBoundingClientRect) return;
    var box = el.getBoundingClientRect();
    var vw = global.innerWidth || 1200;
    var vh = global.innerHeight || 800;
    el.style.left = Math.round(Math.max(8, Math.min(L.menu.x, vw - box.width - 8))) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(L.menu.y, vh - box.height - 8))) + 'px';
  }

  function renderMenu() {
    var m = L.menu;
    if (!m) return '';
    return '<div class="rhl-veil" onclick="RHLib.closeMenu()" oncontextmenu="RHLib.closeMenu();return false;"></div>'
      + '<div class="rhl-menu" role="menu" aria-label="Actions" style="left:' + Math.round(m.x) + 'px;top:' + Math.round(m.y) + 'px">'
      + m.items.map(function (a, i) {
        return '<button type="button" role="menuitem" class="rhl-menuitem' + (a.danger ? ' is-danger' : '') + '" id="rhl-mi-' + i + '"'
          + ' tabindex="-1" onclick="RHLib.menuPick(\'' + esc(a.act) + '\')">'
          + '<span class="rhl-mi-icon" aria-hidden="true">' + icn(a.icon, 15) + '</span>'
          + '<span class="rhl-mi-label">' + esc(a.label) + '</span>'
          + (a.key ? '<span class="rhl-mi-key" aria-hidden="true">' + esc(a.key) + '</span>' : '')
          + '</button>';
      }).join('') + '</div>';
  }

  function menuPick(a) { closeMenu(true); act(a); }

  /* The open menu owns the keyboard: arrows walk it, Escape closes it and
     returns focus to whatever opened it, Tab cannot wander off it. One
     document listener, because the menu is rebuilt on every paint. */
  doc.addEventListener('keydown', function (e) {
    if (!L.menu) return;
    if (e.key === 'Escape') { e.preventDefault(); closeMenu(); return; }
    if (['ArrowDown', 'ArrowUp', 'Tab', 'Home', 'End'].indexOf(e.key) === -1) return;
    var items = doc.querySelectorAll('.rhl-menu [role="menuitem"]');
    if (!items.length) return;
    var at = -1;
    for (var i = 0; i < items.length; i++) if (items[i] === doc.activeElement) at = i;
    e.preventDefault();
    if (e.key === 'Home') at = 0;
    else if (e.key === 'End') at = items.length - 1;
    else at = (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) ? at - 1 : at + 1;
    if (at < 0) at = items.length - 1;
    if (at >= items.length) at = 0;
    try { items[at].focus({ preventScroll: true }); } catch (err) { /* gone */ }
  });

  // ── Actions ───────────────────────────────────────────────────────────────

  function act(a) {
    var sel = selectedItems();
    var one = sel.length === 1 ? sel[0] : null;
    switch (a) {
      case 'open': if (one) openItem(one.key); break;
      case 'download': downloadItems(sel); break;
      case 'copyLink': if (one) copyLink(one); break;
      case 'copyFolderLink': copyFolderLink(); break;
      case 'details': if (one) openDetails(one.key, 'details'); break;
      case 'versions': if (one) openDetails(one.key, 'versions'); break;
      case 'rename': if (one) renameItem(one); break;
      case 'move': if (sel.length) openMoveDialog(sel); break;
      case 'replace': if (one && one.kind === 'doc') pickReplacement(one); break;
      case 'delete': if (sel.length) deleteItems(sel); break;
      case 'newFolder': newFolder(); break;
      case 'newDocument':
        if (global.RH2 && typeof global.RH2.libNewDocument === 'function') global.RH2.libNewDocument();
        break;
      case 'upload': pickFiles(L.folderId); break;
      case 'selectAll': selectAll(true); break;
      case 'refresh': refresh(); break;
      default: break;
    }
  }

  function linkTo(hash) {
    var loc = global.location || {};
    return String(loc.origin || '') + String(loc.pathname || '/') + hash;
  }

  async function copyText(text, what) {
    var done = false;
    try {
      if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
        await global.navigator.clipboard.writeText(text);
        done = true;
      }
    } catch (e) { done = false; }
    if (!done) {
      // Fallback: a field to copy from, in the portal's own prompt.
      if (typeof global.portalPrompt === 'function') {
        await global.portalPrompt('Copy this link:', text, { title: 'Copy link', ok: 'Done' });
        return;
      }
    }
    toast('Link copied', what);
  }

  function copyLink(it) {
    var hash = it.kind === 'folder' ? '#resources/library/' + encodeURIComponent(it.id)
      : '#resources/detail/' + encodeURIComponent(it.id);
    copyText(linkTo(hash), it.name);
  }

  function copyFolderLink() {
    if (!L.data || !L.data.folder) return;
    copyText(linkTo('#resources/library/' + encodeURIComponent(L.data.folder.id)), L.data.folder.name);
  }

  /**
   * Download each selected document through the governed file route. One
   * link per file, a beat apart: browsers may ask once to allow several
   * downloads. There is no zip — nothing is bundled server-side.
   */
  function downloadItems(items) {
    var files = items.filter(function (i) { return i.kind === 'doc' && i.file && i.file.downloadUrl; });
    if (!files.length) { toast('Nothing to download', 'Choose documents that have a file.', 'warn'); return; }
    files.forEach(function (it, i) {
      setTimeout(function () {
        var a = doc.createElement('a');
        a.href = it.file.downloadUrl;
        a.setAttribute('download', it.file.fileName || '');
        a.style.display = 'none';
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
      }, i * 400);
    });
    if (files.length > 1) toast('Downloading ' + files.length + ' files', 'Your browser may ask to allow multiple downloads.');
  }

  // ── Undo ──────────────────────────────────────────────────────────────────

  var undoTimer = null;

  /**
   * A toast with an Undo button, and the same step on the portal's Cmd/Ctrl+Z
   * stack. Using either consumes both, so an action can never be undone twice.
   */
  function offerUndo(message, label, undoFn) {
    var entry = null;
    var used = false;
    var run = async function () {
      if (used) return;
      used = true;
      if (entry && global.OpalUndo && global.OpalUndo.unregister) global.OpalUndo.unregister(entry);
      hideUndo();
      try { await undoFn(); toast('Undone', label); } catch (e) { toast('Could not undo', (e && e.message) || label, 'warn'); }
      refresh();
    };
    if (global.OpalUndo && global.OpalUndo.register) {
      entry = global.OpalUndo.register({ label: label, undo: async function () {
        if (used) return;
        used = true;
        hideUndo();
        await undoFn();
        refresh();
      } });
    }
    var el = doc.getElementById('rhl-undo');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'rhl-undo';
      el.className = 'rhl-undo';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      doc.body.appendChild(el);
    }
    el.innerHTML = '<span class="rhl-undo-msg">' + esc(message) + '</span>'
      + '<button type="button" class="rhl-undo-btn">Undo</button>'
      + '<button type="button" class="rhl-undo-x" aria-label="Dismiss">✕</button>';
    el.querySelector('.rhl-undo-btn').onclick = run;
    el.querySelector('.rhl-undo-x').onclick = hideUndo;
    el.classList.add('is-shown');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, 10000);
  }

  function hideUndo() {
    var el = doc.getElementById('rhl-undo');
    if (el) el.classList.remove('is-shown');
  }

  // ── Rename / new folder ───────────────────────────────────────────────────

  async function askName(title, message, value, ok) {
    if (typeof global.portalPrompt !== 'function') return null;
    var v = await global.portalPrompt(message, value, { title: title, ok: ok || 'Save' });
    return v === null || v === undefined ? null : String(v).trim();
  }

  async function renameItem(it) {
    var value = it.name;
    for (;;) {
      var next = await askName('Rename', 'New name for “' + it.name + '”', value, 'Rename');
      if (next === null || next === it.name) return;
      if (!next) { toast('A name is required', '', 'warn'); continue; }
      var d = it.kind === 'folder'
        ? await api('/api/rh2/library/folders/' + encodeURIComponent(it.id), { method: 'PATCH', body: { name: next } })
        : await api('/api/rh2/library/resources/' + encodeURIComponent(it.id), { method: 'PATCH', body: { title: next } });
      if (!d.ok) { toast('Could not rename', d.error, 'warn'); value = next; if (d.status === 403 || d.status === 404) return refresh(); continue; }
      var before = it.name;
      offerUndo('Renamed to “' + next + '”', 'rename of ' + next, async function () {
        var u = it.kind === 'folder'
          ? await api('/api/rh2/library/folders/' + encodeURIComponent(it.id), { method: 'PATCH', body: { name: before } })
          : await api('/api/rh2/library/resources/' + encodeURIComponent(it.id), { method: 'PATCH', body: { title: before } });
        if (!u.ok) throw new Error(u.error);
      });
      L.focus = it.key;
      refresh();
      return;
    }
  }

  async function newFolder() {
    var parent = L.folderId && L.folderId !== BIN ? L.folderId : '';
    var where = parent && L.data && L.data.folder ? L.data.folder.name : 'the top level of the Library';
    var value = '';
    for (;;) {
      var name = await askName('New folder', 'Name for the new folder in ' + where, value, 'Create');
      if (name === null) return;
      var d = await api('/api/rh2/library/folders', { method: 'POST', body: { name: name, parentId: parent || null } });
      if (!d.ok) { toast('Could not create the folder', d.error, 'warn'); value = name; if (d.status === 403) return; continue; }
      toast('Folder created', name);
      L.focus = key('folder', d.folder.id);
      refresh();
      return;
    }
  }

  // ── Move ──────────────────────────────────────────────────────────────────

  /** Flattened tree for the move picker, without the folders being moved (or anything inside them). */
  function moveTargets(excludeIds) {
    var out = [];
    (function walk(nodes, depth, blocked) {
      (nodes || []).forEach(function (n) {
        var isBlocked = blocked || excludeIds.indexOf(n.id) !== -1;
        if (!isBlocked) out.push({ id: n.id, name: n.name, depth: depth, review: !!n.isReviewBucket });
        walk(n.children, depth + 1, isBlocked);
      });
    })(L.tree || [], 0, false);
    return out;
  }

  function openMoveDialog(items) {
    var folderIds = items.filter(function (i) { return i.kind === 'folder'; }).map(function (i) { return i.id; });
    var hasDocs = items.some(function (i) { return i.kind === 'doc'; });
    L.dialog = {
      type: 'move', items: items, choice: '', err: '',
      targets: moveTargets(folderIds), allowRoot: !hasDocs && folderIds.length > 0,
    };
    paint();
    var first = doc.querySelector('.rhl-dialog input[type="radio"]');
    if (first) { try { first.focus(); } catch (e) { /* gone */ } }
  }

  function moveChoose(id) { if (L.dialog) { L.dialog.choice = id; L.dialog.err = ''; } }

  async function moveConfirm() {
    var dl = L.dialog;
    if (!dl || dl.type !== 'move') return;
    if (!dl.choice) { dl.err = 'Choose a folder to move to.'; paint(); return; }
    await moveItems(dl.items, dl.choice);
  }

  /** The one move path: dialog, drag onto a folder, tree or breadcrumb. */
  async function moveItems(items, target) {
    var resourceIds = items.filter(function (i) { return i.kind === 'doc'; }).map(function (i) { return i.id; });
    var folderIds = items.filter(function (i) { return i.kind === 'folder'; }).map(function (i) { return i.id; });
    if (folderIds.indexOf(target) !== -1) { toast('Cannot move a folder into itself', '', 'warn'); return; }
    if (L.busy) return;
    L.busy = true;
    var d = await api('/api/rh2/library/move', {
      method: 'POST', body: { folderId: target || 'root', resourceIds: resourceIds, folderIds: folderIds },
    });
    L.busy = false;
    if (!d.ok) {
      if (L.dialog && L.dialog.type === 'move') { L.dialog.err = d.error; paint(); }
      else toast('Could not move', d.error, 'warn');
      return;
    }
    L.dialog = null;
    L.sel = {};
    var prev = d.previous || { resources: [], folders: [] };
    var n = d.moved || 0;
    offerUndo('Moved ' + n + (n === 1 ? ' item' : ' items') + ' to ' + (d.folder || 'Library'), 'move', async function () {
      // Put each item back where it came from, one request per origin.
      var groups = {};
      prev.resources.forEach(function (r) {
        if (!r.folderId) return;
        (groups[r.folderId] = groups[r.folderId] || { r: [], f: [] }).r.push(r.id);
      });
      prev.folders.forEach(function (f) {
        var k2 = f.parentId || 'root';
        (groups[k2] = groups[k2] || { r: [], f: [] }).f.push(f.id);
      });
      for (var g in groups) {
        if (!Object.prototype.hasOwnProperty.call(groups, g)) continue;
        var u = await api('/api/rh2/library/move', { method: 'POST', body: { folderId: g, resourceIds: groups[g].r, folderIds: groups[g].f } });
        if (!u.ok) throw new Error(u.error);
      }
    });
    refresh();
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  function describe(items) {
    var f = items.filter(function (i) { return i.kind === 'folder'; }).length;
    var d = items.length - f;
    var parts = [];
    if (d) parts.push(d + (d === 1 ? ' document' : ' documents'));
    if (f) parts.push(f + (f === 1 ? ' folder' : ' folders'));
    return items.length === 1 ? '“' + items[0].name + '”' : parts.join(' and ');
  }

  async function deleteItems(items) {
    if (L.busy) return;
    var body = {
      resourceIds: items.filter(function (i) { return i.kind === 'doc'; }).map(function (i) { return i.id; }),
      folderIds: items.filter(function (i) { return i.kind === 'folder'; }).map(function (i) { return i.id; }),
    };
    var check = await api('/api/rh2/library/delete-check', { method: 'POST', body: body });
    var workflows = check.ok ? (check.workflows || []) : [];
    var hasFolders = body.folderIds.length > 0;
    var msg = 'Delete ' + describe(items) + '?'
      + (hasFolders ? '\n\nEverything inside ' + (body.folderIds.length === 1 ? 'the folder' : 'those folders') + ' goes too.' : '')
      + '\n\nDeleted items go to the recycle bin, where an owner or admin can restore them for 90 days.';
    if (workflows.length) {
      msg += '\n\nUsed in ' + (workflows.length === 1 ? 'this learning workflow' : 'these learning workflows') + ':\n'
        + workflows.map(function (w) { return '• ' + w.title; }).join('\n')
        + '\n\nLearners will see “This resource was removed” in its place.';
    }
    if (typeof global.portalConfirm === 'function'
      && !await global.portalConfirm(msg, { title: workflows.length ? 'Delete — in use' : 'Delete', ok: 'Delete', danger: true })) return;
    body.confirm = workflows.length > 0;
    L.busy = true;
    var d = await api('/api/rh2/library/delete', { method: 'POST', body: body });
    L.busy = false;
    if (!d.ok) { toast('Could not delete', d.error, 'warn'); refresh(); return; }
    L.sel = {};
    if (L.details && items.some(function (i) { return i.key === L.details.key; })) L.details = null;
    var restoreItems = (d.deleted.resources || []).map(function (id) { return { kind: 'resource', id: id }; })
      .concat((d.deleted.folders || []).map(function (id) { return { kind: 'folder', id: id }; }));
    offerUndo('Deleted ' + describe(items) + ' — in the recycle bin', 'delete', async function () {
      var u = await api('/api/rh2/library/recycle-bin/restore', { method: 'POST', body: { items: restoreItems } });
      if (!u.ok) throw new Error(u.error);
    });
    refresh();
  }

  // ── Upload ────────────────────────────────────────────────────────────────

  var UPLOAD_EXT = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg'];
  var UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg';
  var UPLOAD_MAX = 25 * 1024 * 1024;
  var uploadSeq = 0;

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('unreadable')); };
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.readAsDataURL(file);
    });
  }

  function pickFiles(folderId, single, onPick) {
    if (!folderId || folderId === BIN) { toast('Open a folder first', 'Files are uploaded into the folder you are in.', 'warn'); return; }
    var input = doc.createElement('input');
    input.type = 'file';
    input.multiple = !single;
    input.accept = UPLOAD_ACCEPT;
    input.onchange = function () {
      if (onPick) onPick(input.files);
      else queueUpload(input.files, folderId);
    };
    input.click();
  }

  function pickReplacement(it) {
    pickFiles(L.folderId || 'x', true, function (files) {
      if (files && files[0]) queueUpload([files[0]], L.folderId, { replaceId: it.id, replaceName: it.name });
    });
  }

  /**
   * Add files to the upload queue. A second drop while a batch is running
   * JOINS the queue — it never replaces the panel, so the first batch's
   * results (and refusals) stay on screen.
   */
  function queueUpload(fileList, folderId, opts) {
    var files = [].slice.call(fileList || []);
    if (!files.length) return;
    opts = opts || {};
    var folderName = folderId === L.folderId && L.data && L.data.folder ? L.data.folder.name : '';
    if (!L.uploading) {
      // A fresh batch starts a fresh panel; finished rows from last time go.
      L.uploads = L.uploads.filter(function (u) { return u.state === 'waiting' || u.state === 'uploading'; });
      L.dupChoice = '';
    }
    files.forEach(function (f) {
      L.uploads.push({
        id: ++uploadSeq, file: f, name: f.name, folderId: folderId, folderName: folderName,
        state: 'waiting', message: '', progress: 0, replaceId: opts.replaceId || '',
      });
    });
    paint();
    if (!L.uploading) runQueue();
  }

  async function runQueue() {
    L.uploading = true;
    for (;;) {
      var entry = null;
      for (var i = 0; i < L.uploads.length; i++) if (L.uploads[i].state === 'waiting') { entry = L.uploads[i]; break; }
      if (!entry) break;
      await uploadOne(entry);
      paint();
    }
    L.uploading = false;
    var done = L.uploads.filter(function (u) { return u.state === 'done'; }).length;
    var failed = L.uploads.filter(function (u) { return u.state === 'error'; }).length;
    var skipped = L.uploads.filter(function (u) { return u.state === 'skipped'; }).length;
    toast(done + (done === 1 ? ' file uploaded' : ' files uploaded'),
      [failed ? failed + ' refused' : '', skipped ? skipped + ' skipped' : ''].filter(Boolean).join(', '),
      failed ? 'warn' : undefined);
    refresh();
  }

  /** POST with upload progress (fetch cannot report it). Resolves {status, data}. */
  function postWithProgress(url, body, onProgress) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/json');
      if (xhr.upload) {
        xhr.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); };
      }
      xhr.onload = function () {
        var data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch (e) { data = {}; }
        resolve({ status: xhr.status, data: data });
      };
      xhr.onerror = function () { resolve({ status: 0, data: {} }); };
      xhr.send(JSON.stringify(body));
    });
  }

  async function uploadOne(entry) {
    var ext = String(entry.name.split('.').pop() || '').toLowerCase();
    if (UPLOAD_EXT.indexOf(ext) === -1) {
      entry.state = 'error'; entry.message = 'Not a supported file type (PDF, Word, Excel, PowerPoint or an image).'; return;
    }
    if (entry.file.size > UPLOAD_MAX) { entry.state = 'error'; entry.message = 'Larger than the 25 MB limit.'; return; }
    entry.state = 'uploading'; entry.progress = 0;
    paint();
    var base64;
    try { base64 = await readAsBase64(entry.file); } catch (e) {
      entry.state = 'error'; entry.message = 'Could not read that file.'; return;
    }
    var onConflict = entry.onConflict || '';
    for (var attempt = 0; attempt < 3; attempt++) {
      var url = entry.replaceId
        ? '/api/rh2/library/resources/' + encodeURIComponent(entry.replaceId) + '/replace'
        : '/api/rh2/library/folders/' + encodeURIComponent(entry.folderId) + '/upload';
      var body = { fileName: entry.name, fileData: base64 };
      if (onConflict) body.onConflict = onConflict;
      var lastPaint = 0;
      var r = await postWithProgress(url, body, function (p) {
        entry.progress = p;
        var now = Date.now();
        if (now - lastPaint > 150) { lastPaint = now; paintUploads(); }
      });
      if (r.status === 409 && r.data && r.data.code === 'duplicate_name' && !entry.replaceId) {
        var choice = L.dupChoice || await askDuplicate(entry, r.data);
        if (choice === 'skip') { entry.state = 'skipped'; entry.message = 'Skipped — a file with this name is already here.'; return; }
        onConflict = choice;
        entry.state = 'uploading';
        continue;
      }
      if (r.status >= 200 && r.status < 300) {
        entry.state = 'done';
        entry.progress = 1;
        var d = r.data || {};
        entry.message = d.replaced || entry.replaceId ? 'New version ' + (d.versionNo || '') + ' is live.'
          : d.renamedTo ? 'Kept both — saved as “' + d.renamedTo + '”.'
            : (d.privacyScanned === false ? 'Uploaded. (This format is not text-scanned.)' : '');
        if ((d.warnings || []).length) entry.message += (entry.message ? ' ' : '') + d.warnings.join(' ');
        return;
      }
      entry.state = 'error';
      entry.message = r.status === 422 && r.data && r.data.code === 'privacy_rejected'
        ? (r.data.error || 'Refused: it appears to contain a person’s details.')
        : errorText(r.status, r.data);
      return;
    }
    entry.state = 'error';
    entry.message = 'Could not upload.';
  }

  /** Ask what to do about a name already in the folder. Resolves replace | keepBoth | skip. */
  function askDuplicate(entry, data) {
    return new Promise(function (resolve) {
      L.dialog = {
        type: 'duplicate', entry: entry, existing: data.existing || {}, suggested: data.suggestedName || '',
        all: false, resolve: resolve,
      };
      paint();
      var first = doc.querySelector('.rhl-dialog .rh2-btn-primary');
      if (first) { try { first.focus(); } catch (e) { /* gone */ } }
    });
  }

  function dupPick(choice) {
    var dl = L.dialog;
    if (!dl || dl.type !== 'duplicate') return;
    var box = doc.getElementById('rhl-dup-all');
    if (box && box.checked) L.dupChoice = choice;
    L.dialog = null;
    paint();
    dl.resolve(choice);
  }

  function paintUploads() {
    var el = doc.getElementById('rhl-uploads');
    if (el) el.outerHTML = renderUploads();
  }

  function renderUploads() {
    var ups = L.uploads;
    if (!ups.length) return '';
    var done = ups.filter(function (u) { return u.state === 'done'; }).length;
    var failed = ups.filter(function (u) { return u.state === 'error'; }).length;
    var skipped = ups.filter(function (u) { return u.state === 'skipped'; }).length;
    var busy = ups.some(function (u) { return u.state === 'uploading' || u.state === 'waiting'; });
    var head = busy
      ? 'Uploading ' + (done + failed + skipped + 1) + ' of ' + ups.length + '…'
      : 'Uploaded ' + done + ' of ' + ups.length + (failed ? ' · ' + failed + ' refused' : '') + (skipped ? ' · ' + skipped + ' skipped' : '');
    return '<div class="rhl-uploads" id="rhl-uploads" role="status" aria-live="polite">'
      + '<div class="rhl-uploads-head"><strong>' + esc(head) + '</strong>'
      + (busy ? '' : '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RHLib.dismissUploads()">Dismiss</button>')
      + '</div><ul class="rhl-uplist">'
      + ups.map(function (u) {
        var mark = u.state === 'done' ? '✓' : u.state === 'error' ? '✗' : u.state === 'skipped' ? '–' : '·';
        var pct = Math.round((u.progress || 0) * 100);
        return '<li class="rhl-up rhl-up-' + esc(u.state) + '">'
          + '<span class="rhl-up-mark" aria-hidden="true">' + mark + '</span>'
          + '<span class="rhl-up-name">' + esc(u.name) + (u.folderName ? ' <span class="rhl-up-where">→ ' + esc(u.folderName) + '</span>' : '') + '</span>'
          + (u.state === 'uploading'
            ? '<span class="rhl-up-bar" role="progressbar" aria-label="Uploading ' + esc(u.name) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></span>'
            : '')
          + (u.message ? '<span class="rhl-up-msg">' + esc(u.message) + '</span>' : '')
          + '</li>';
      }).join('') + '</ul>'
      + (failed ? '<p class="rhl-note">Refused files were not stored. Nothing else was affected.</p>' : '')
      + '</div>';
  }

  function dismissUploads() { L.uploads = []; paint(); }

  // ── Drag and drop ─────────────────────────────────────────────────────────

  var DRAG_TYPE = 'application/x-opal-library';
  var dragKeys = null;

  function dragStart(ev, k) {
    if (!canManage()) return;
    if (!L.sel[k]) selectOnly(k);
    dragKeys = Object.keys(L.sel);
    try {
      ev.dataTransfer.setData(DRAG_TYPE, JSON.stringify(dragKeys));
      ev.dataTransfer.setData('text/plain', dragKeys.length + ' item(s)');
      ev.dataTransfer.effectAllowed = 'move';
    } catch (e) { /* old browser */ }
    var row = doc.getElementById('rhl-row-' + k);
    if (row) row.classList.add('is-dragging');
  }

  function dragEnd() {
    dragKeys = null;
    var marked = doc.querySelectorAll('.is-drop, .is-dragging');
    for (var i = 0; i < marked.length; i++) marked[i].classList.remove('is-drop', 'is-dragging');
  }

  function dragKind(dt) {
    if (!dt || !dt.types) return '';
    var types = [].slice.call(dt.types);
    if (types.indexOf(DRAG_TYPE) !== -1 || dragKeys) return 'move';
    if (types.indexOf('Files') !== -1) return 'files';
    return '';
  }

  /** Folder ids being dragged, plus everything inside them — not valid targets. */
  function draggedFolderIds() {
    return (dragKeys || []).filter(function (k2) { return k2.indexOf('f-') === 0; }).map(function (k2) { return k2.slice(2); });
  }

  function isInside(targetId, folderIds) {
    var hit = findNode(targetId);
    var cursor = hit;
    var guard = 0;
    while (cursor && guard++ < 500) {
      if (folderIds.indexOf(cursor.node.id) !== -1) return true;
      cursor = cursor.parent ? findNode(cursor.parent.id) : null;
    }
    return false;
  }

  function resolveTarget(target) {
    if (target === 'here') return L.folderId && L.folderId !== BIN ? L.folderId : '';
    if (target === 'root') return '';
    return target;
  }

  function dragOver(ev, target) {
    if (!canManage()) return;
    var kind = dragKind(ev.dataTransfer);
    if (!kind) return;
    var id = resolveTarget(target);
    if (kind === 'files' && !id) return;             // files need a folder
    if (kind === 'move') {
      if (target === 'here') return;                 // dropping where it already is
      if (id && isInside(id, draggedFolderIds())) return;
      if (!id && (dragKeys || []).some(function (k2) { return k2.indexOf('d-') === 0; })) return;
    }
    ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    try { ev.dataTransfer.dropEffect = kind === 'files' ? 'copy' : 'move'; } catch (e) { /* ignore */ }
    var el = ev.currentTarget;
    if (el && el.classList && !el.classList.contains('is-drop')) {
      var marked = doc.querySelectorAll('.is-drop');
      for (var i = 0; i < marked.length; i++) marked[i].classList.remove('is-drop');
      el.classList.add('is-drop');
    }
  }

  function dragLeave(ev) {
    var el = ev.currentTarget;
    var to = ev.relatedTarget;
    if (el && to && el.contains && el.contains(to)) return;
    if (el && el.classList) el.classList.remove('is-drop');
  }

  function drop(ev, target) {
    if (!canManage()) return;
    var kind = dragKind(ev.dataTransfer);
    if (!kind) return;
    ev.preventDefault();
    if (ev.stopPropagation) ev.stopPropagation();
    var id = resolveTarget(target);
    var keys = dragKeys;
    dragEnd();
    if (kind === 'files') {
      var files = ev.dataTransfer && ev.dataTransfer.files;
      if (id && files && files.length) queueUpload(files, id);
      return;
    }
    if (!keys) {
      try { keys = JSON.parse(ev.dataTransfer.getData(DRAG_TYPE) || '[]'); } catch (e) { keys = []; }
    }
    var items = keys.map(itemByKey).filter(Boolean);
    if (!items.length || target === 'here') return;
    moveItems(items, id);
  }

  // ── Details pane and version history ──────────────────────────────────────

  function togglePane() {
    if (L.details) { L.details = null; paint(); return; }
    var sel = selectedItems();
    L.details = { key: sel.length === 1 ? sel[0].key : '', tab: 'details', data: null, versions: null, loading: false };
    if (sel.length === 1) loadDetails(sel[0].key, 'details');
    else paint();
  }

  function openDetails(k, tab) {
    L.details = { key: k, tab: tab || 'details', data: null, versions: null, loading: false };
    loadDetails(k, tab);
  }

  async function loadDetails(k, tab) {
    if (!L.details) return;
    var it = itemByKey(k);
    L.details.key = k;
    L.details.tab = tab || 'details';
    L.details.data = null; L.details.versions = null; L.details.err = '';
    if (!it || it.kind === 'folder') { paint(); return; }
    L.details.loading = true;
    paint();
    var want = L.details.tab === 'versions'
      ? api('/api/rh2/library/resources/' + encodeURIComponent(it.id) + '/versions')
      : api('/api/rh2/library/resources/' + encodeURIComponent(it.id) + '/details');
    var d = await want;
    if (!L.details || L.details.key !== k) return;
    L.details.loading = false;
    if (!d.ok) L.details.err = d.error;
    else if (L.details.tab === 'versions') L.details.versions = d;
    else L.details.data = d.resource;
    paint();
  }

  function detailsTab(t) { if (L.details) loadDetails(L.details.key, t); }

  async function restoreVersion(n) {
    var it = L.details && itemByKey(L.details.key);
    if (!it) return;
    if (typeof global.portalConfirm === 'function'
      && !await global.portalConfirm('Make version ' + n + ' the current version of “' + it.name + '”? The current file stays in the history.', { title: 'Restore version', ok: 'Restore' })) return;
    var d = await api('/api/rh2/library/resources/' + encodeURIComponent(it.id) + '/versions/' + encodeURIComponent(n) + '/restore', { method: 'POST', body: {} });
    if (!d.ok) { toast('Could not restore that version', d.error, 'warn'); return; }
    toast('Version ' + n + ' restored', 'It is now version ' + d.versionNo + '.');
    loadFolder();
    loadDetails(it.key, 'versions');
  }

  function dl(label, value) {
    return value ? '<dt>' + esc(label) + '</dt><dd>' + value + '</dd>' : '';
  }

  var STATE_WORDS = {
    approved: 'Approved', published: 'Published', inventory: 'Catalogued', retired: 'Withdrawn',
    'rights-review': 'Rights review', 'clinical-review': 'Clinical review',
    'brand-accessibility-review': 'Brand & accessibility review',
  };

  function renderDetails() {
    var p = L.details;
    var it = p.key ? itemByKey(p.key) : null;
    var out = '<aside class="rhl-details" aria-label="Details">'
      + '<div class="rhl-details-head"><h2 class="rh2-h2">' + esc(it ? it.name : 'Details') + '</h2>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" id="rhl-details-close" aria-label="Close details" onclick="RHLib.togglePane()">✕</button></div>';
    if (!it) {
      return out + '<p class="rhl-note">Select one item to see its details.</p></aside>';
    }
    if (it.kind === 'folder') {
      var path = (L.data && L.data.breadcrumb ? L.data.breadcrumb.map(function (b) { return b.name; }) : [])
        .concat(L.data && L.data.folder ? [L.data.folder.name] : []);
      return out + '<dl class="rhl-dl">'
        + dl('Type', 'Folder')
        + dl('Location', esc(['Library'].concat(path).join(' › ')))
        + dl('Contains', esc(it.count + (it.count === 1 ? ' document' : ' documents')))
        + dl('Modified', esc(fmtDate(it.modifiedAt)))
        + dl('Modified by', esc(it.modifiedBy || ''))
        + '</dl><div class="rhl-details-actions">'
        + '<button type="button" class="rh2-btn" onclick="RHLib.openKey(\'' + esc(it.key) + '\')">Open</button>'
        + '<button type="button" class="rh2-btn" onclick="RHLib.act(\'copyLink\')">Copy link</button></div></aside>';
    }
    out += '<div class="rhl-tabs" role="tablist" aria-label="Document information">'
      + '<button type="button" role="tab" id="rhl-tab-details" aria-selected="' + (p.tab === 'details') + '" onclick="RHLib.detailsTab(\'details\')">Details</button>'
      + '<button type="button" role="tab" id="rhl-tab-versions" aria-selected="' + (p.tab === 'versions') + '" onclick="RHLib.detailsTab(\'versions\')">Version history</button>'
      + '</div><div role="tabpanel" aria-labelledby="rhl-tab-' + esc(p.tab) + '">';
    if (p.loading) return out + '<p class="rhl-note" role="status">Loading…</p></div></aside>';
    if (p.err) return out + '<p class="rhl-note rhl-note-warn" role="alert">' + esc(p.err) + '</p></div></aside>';

    if (p.tab === 'versions' && p.versions) {
      var vs = p.versions.versions || [];
      if (!vs.length) return out + '<p class="rhl-note">No file versions are recorded for this document.</p></div></aside>';
      out += '<ol class="rhl-versions">' + vs.map(function (v) {
        return '<li class="rhl-version' + (v.isCurrent ? ' is-current' : '') + '">'
          + '<div class="rhl-version-head"><strong>Version ' + esc(v.versionNo) + '</strong>'
          + (v.isCurrent ? ' <span class="rh2-chip rh2-chip-ok">Current</span>' : '')
          + (v.action === 'restore' && v.restoredFrom ? ' <span class="rhl-note">restored from version ' + esc(v.restoredFrom) + '</span>' : '')
          + '</div>'
          + '<div class="rhl-version-meta">' + esc([fmtDate(v.createdAt), v.createdBy, fmtSize(v.sizeBytes)].filter(Boolean).join(' · ')) + '</div>'
          + '<div class="rhl-version-file">' + esc(v.fileName || '') + '</div>'
          + '<div class="rhl-version-actions">'
          + (v.downloadUrl ? '<a class="rh2-btn" href="' + esc(v.downloadUrl) + '" download>Download</a>' : '')
          + (p.versions.canRestore && !v.isCurrent && v.downloadUrl
            ? '<button type="button" class="rh2-btn" onclick="RHLib.restoreVersion(' + Number(v.versionNo) + ')">Restore</button>' : '')
          + '</div></li>';
      }).join('') + '</ol></div></aside>';
      return out;
    }

    var r = p.data;
    if (!r) return out + '</div></aside>';
    var tags = (r.tags || []).map(function (t) { return '<span class="rh2-chip">' + esc(t.name) + '</span>'; }).join(' ');
    out += '<dl class="rhl-dl">'
      + dl('Name', esc(r.title))
      + dl('Type', esc(typeLabel({ kind: 'doc', format: r.file && r.file.format })))
      + dl('File', r.file ? esc(r.file.fileName) : '')
      + dl('Size', r.file ? esc(fmtSize(r.file.sizeBytes)) : '')
      + dl('Location', r.folder ? esc(['Library'].concat(r.folder.path).join(' › ')) : '<span class="rhl-note">Not in a folder</span>')
      + dl('Created', esc([fmtDate(r.createdAt), r.createdBy].filter(Boolean).join(' by ')))
      + dl('Modified', esc([fmtDate(r.modifiedAt), r.modifiedBy].filter(Boolean).join(' by ')))
      + dl('Version', r.versionNo ? esc(r.versionNo) + (r.versionCount > 1 ? ' (' + esc(r.versionCount) + ' in history)' : '') : '')
      + dl('Status', esc(STATE_WORDS[r.publicationState] || r.publicationState || ''))
      + dl('Owner', esc(r.owner || ''))
      + dl('Review due', esc(fmtDate(r.reviewDueAt)))
      + dl('Tags', tags)
      + '</dl><div class="rhl-details-actions">'
      + '<button type="button" class="rh2-btn" onclick="RHLib.openKey(\'' + esc(it.key) + '\')">Open</button>'
      + (r.file ? '<a class="rh2-btn" href="' + esc(r.file.downloadUrl) + '" download>Download</a>' : '')
      + '<button type="button" class="rh2-btn" onclick="RHLib.act(\'copyLink\')">Copy link</button>'
      + '</div></div></aside>';
    return out;
  }

  // ── The recycle bin ───────────────────────────────────────────────────────

  function binSelected() {
    return (L.bin.items || []).filter(function (i) { return L.bin.sel[i.kind + ':' + i.id]; });
  }

  function binToggle(k) {
    if (L.bin.sel[k]) delete L.bin.sel[k]; else L.bin.sel[k] = true;
    paint();
  }

  function binAll(on) {
    L.bin.sel = {};
    if (on) (L.bin.items || []).forEach(function (i) { L.bin.sel[i.kind + ':' + i.id] = true; });
    paint();
  }

  function binDescribe(items) {
    return items.length === 1 ? '“' + items[0].name + '”' : items.length + ' items';
  }

  async function binRestore() {
    var items = binSelected();
    if (!items.length) return;
    var d = await api('/api/rh2/library/recycle-bin/restore', {
      method: 'POST', body: { items: items.map(function (i) { return { kind: i.kind, id: i.id }; }) },
    });
    if (!d.ok) { toast('Could not restore', d.error, 'warn'); loadBin(); return; }
    var places = [];
    (d.restored.resources || []).concat(d.restored.folders || []).forEach(function (r) {
      var where = (r.path || []).length ? r.path.join(' › ') : 'Library';
      if (places.indexOf(where) === -1) places.push(where);
    });
    toast('Restored ' + binDescribe(items), places.length ? 'Back in ' + places.slice(0, 3).join(', ') : '');
    L.bin.sel = {};
    loadTree(true);
    loadBin();
  }

  async function binPurge(all) {
    var items = all ? (L.bin.items || []) : binSelected();
    if (!items.length) return;
    var msg = all
      ? 'Empty the recycle bin? All ' + items.length + (items.length === 1 ? ' item' : ' items') + ' and everything inside them will be deleted permanently.\n\nThis cannot be undone.'
      : 'Permanently delete ' + binDescribe(items) + '?\n\nThis cannot be undone.';
    if (typeof global.portalConfirm === 'function'
      && !await global.portalConfirm(msg, { title: all ? 'Empty recycle bin' : 'Delete permanently', ok: 'Delete permanently', danger: true })) return;
    var d = all
      ? await api('/api/rh2/library/recycle-bin/empty', { method: 'POST', body: {} })
      : await api('/api/rh2/library/recycle-bin/purge', {
        method: 'POST', body: { items: items.map(function (i) { return { kind: i.kind, id: i.id }; }) },
      });
    if (!d.ok) { toast('Could not delete', d.error, 'warn'); loadBin(); return; }
    toast('Deleted permanently', (d.purged.resources || 0) + ' documents, ' + (d.purged.folders || 0) + ' folders');
    L.bin.sel = {};
    loadBin();
  }

  function renderBin() {
    var b = L.bin;
    var sel = binSelected();
    var out = '<div class="rhl-cmdbar" role="toolbar" aria-label="Recycle bin commands">';
    if (sel.length) {
      out += cmdBtn('restore', 'Restore', 'refresh', 'RHLib.binRestore()');
      if (b.canPurge) out += cmdBtn('purge', 'Delete permanently', 'trash', 'RHLib.binPurge(false)', ' data-danger="1"');
      out += '<span class="rhl-selcount" role="status">' + sel.length + ' selected</span>';
    }
    out += '<span class="rhl-cmd-spacer"></span>';
    if (b.canPurge && (b.items || []).length) out += cmdBtn('empty', 'Empty recycle bin', 'trash', 'RHLib.binPurge(true)', ' data-danger="1"');
    out += '</div>';
    out += '<p class="rhl-note">Deleted documents and folders stay here for 90 days, then are removed automatically. '
      + (b.canPurge ? 'Only the owner can delete permanently.' : 'Only the practice owner can delete permanently.') + '</p>';
    if (b.loading && !b.items) return out + '<div class="rhl-loading" role="status">Loading…</div>';
    if (b.err) return out + '<div class="rhl-empty" role="alert"><p>' + esc(b.err) + '</p></div>';
    var items = b.items || [];
    if (!items.length) return out + '<div class="rhl-empty"><span class="rhl-empty-icon" aria-hidden="true">' + icn('trash', 32) + '</span><p>The recycle bin is empty.</p></div>';
    var allOn = items.every(function (i) { return b.sel[i.kind + ':' + i.id]; });
    out += '<table class="rhl-list rhl-binlist" aria-label="Recycle bin"><thead><tr>'
      + '<th scope="col" class="rhl-col-check"><input type="checkbox" id="rhl-bin-all" aria-label="Select all"' + (allOn ? ' checked' : '') + ' onclick="RHLib.binAll(this.checked)"></th>'
      + '<th scope="col">Name</th><th scope="col" class="rhl-hide-xs">Original location</th>'
      + '<th scope="col" class="rhl-hide-sm">Deleted by</th><th scope="col">Deleted</th><th scope="col">Days left</th>'
      + '</tr></thead><tbody>';
    items.forEach(function (i) {
      var k = i.kind + ':' + i.id;
      var on = !!b.sel[k];
      var inner = i.kind === 'folder'
        ? ' <span class="rhl-note">(' + esc(i.documentCount) + (i.documentCount === 1 ? ' document' : ' documents')
          + (i.folderCount ? ', ' + esc(i.folderCount) + (i.folderCount === 1 ? ' subfolder' : ' subfolders') : '') + ')</span>'
        : '';
      out += '<tr class="rhl-row' + (on ? ' is-selected' : '') + '" onclick="RHLib.binToggle(\'' + esc(k) + '\')">'
        + '<td class="rhl-col-check"><input type="checkbox" id="rhl-bin-' + esc(i.id) + '" aria-label="Select ' + esc(i.name) + '"'
        + (on ? ' checked' : '') + ' onclick="event.stopPropagation();RHLib.binToggle(\'' + esc(k) + '\')"></td>'
        + '<td class="rhl-col-name">' + itemIcon({ kind: i.kind === 'folder' ? 'folder' : 'doc', format: i.format }) + esc(i.name) + inner + '</td>'
        + '<td class="rhl-hide-xs">' + esc(['Library'].concat(i.originalPath || []).join(' › ')) + '</td>'
        + '<td class="rhl-hide-sm">' + esc(i.deletedBy || '') + '</td>'
        + '<td>' + esc(fmtDate(i.deletedAt)) + '</td>'
        + '<td>' + esc(i.daysLeft) + '</td></tr>';
    });
    return out + '</tbody></table>';
  }

  // ── Dialogs (move and duplicate; confirm and prompt use portal dialogs) ───

  function renderDialog() {
    var dlg = L.dialog;
    if (!dlg) return '';
    var body = '';
    var title = '';
    if (dlg.type === 'move') {
      title = 'Move ' + describe(dlg.items) + ' to…';
      body = '<fieldset class="rhl-picker"><legend class="rh2-visually-hidden">Destination folder</legend>'
        + (dlg.allowRoot ? '<label class="rhl-pick" style="padding-left:6px"><input type="radio" name="rhl-move" value="root"'
          + (dlg.choice === 'root' ? ' checked' : '') + ' onchange="RHLib.moveChoose(\'root\')"> Library (top level)</label>' : '')
        + dlg.targets.map(function (t) {
          return '<label class="rhl-pick" style="padding-left:' + (6 + t.depth * 16) + 'px"><input type="radio" name="rhl-move" value="' + esc(t.id) + '"'
            + (dlg.choice === t.id ? ' checked' : '') + ' onchange="RHLib.moveChoose(\'' + esc(t.id) + '\')"> '
            + icn('folder', 14) + ' ' + esc(t.name) + '</label>';
        }).join('')
        + (!dlg.targets.length ? '<p class="rhl-note">There is no other folder to move to.</p>' : '')
        + '</fieldset>'
        + (dlg.err ? '<p class="rhl-note rhl-note-warn" role="alert">' + esc(dlg.err) + '</p>' : '')
        + '<div class="rhl-dialog-actions">'
        + '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RHLib.moveConfirm()">Move here</button>'
        + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RHLib.closeDialog()">Cancel</button></div>';
    } else if (dlg.type === 'duplicate') {
      title = 'A file with this name is already here';
      body = '<p>“' + esc(dlg.existing.fileName || dlg.existing.title || dlg.entry.name) + '” is already in '
        + esc(dlg.entry.folderName || 'this folder') + '.</p>'
        + '<p>Replace it with a new version (the current file is kept in its version history), or keep both'
        + (dlg.suggested ? ' and save this one as “' + esc(dlg.suggested) + '”' : '') + '?</p>'
        + '<label class="rhl-checkline"><input type="checkbox" id="rhl-dup-all"> Do this for the remaining duplicates too</label>'
        + '<div class="rhl-dialog-actions">'
        + '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RHLib.dupPick(\'replace\')">Replace (new version)</button>'
        + '<button type="button" class="rh2-btn" onclick="RHLib.dupPick(\'keepBoth\')">Keep both</button>'
        + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RHLib.dupPick(\'skip\')">Skip this file</button></div>';
    }
    return '<div class="rhl-dialog-veil" onclick="RHLib.closeDialog()"></div>'
      + '<div class="rhl-dialog" role="dialog" aria-modal="true" aria-labelledby="rhl-dialog-title" onkeydown="RHLib.dialogKey(event)">'
      + '<h2 class="rh2-h2" id="rhl-dialog-title">' + esc(title) + '</h2>' + body + '</div>';
  }

  function closeDialog() {
    var dlg = L.dialog;
    if (!dlg) return;
    if (dlg.type === 'duplicate') return dupPick('skip');
    L.dialog = null;
    paint();
  }

  /** Escape closes; Tab stays inside the dialog. */
  function dialogKey(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); closeDialog(); return; }
    if (ev.key !== 'Tab') return;
    var box = doc.querySelector('.rhl-dialog');
    if (!box) return;
    var f = box.querySelectorAll('button, input, [tabindex="0"]');
    if (!f.length) return;
    var first = f[0]; var last = f[f.length - 1];
    if (ev.shiftKey && doc.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && doc.activeElement === last) { ev.preventDefault(); first.focus(); }
  }

  // ── Public surface ────────────────────────────────────────────────────────

  global.RHLib = {
    mount: mount, open: open, current: current, remembered: remembered, refresh: refresh,
    search: search, toggleTree: toggleTree, treeClick: treeClick, treeKey: treeKey,
    rowClick: rowClick, rowFocus: rowFocus, checkClick: checkClick, openKey: openKey,
    selectAll: selectAll, clearSel: clearSel, listKey: listKey,
    setFilter: setFilter, setView: setView, sortBy: sortBy,
    menuFor: menuFor, more: more, ctx: ctx, closeMenu: closeMenu, menuPick: menuPick, act: act,
    copyFolderLink: copyFolderLink,
    moveChoose: moveChoose, moveConfirm: moveConfirm, closeDialog: closeDialog, dialogKey: dialogKey,
    dupPick: dupPick, dismissUploads: dismissUploads,
    dragStart: dragStart, dragEnd: dragEnd, dragOver: dragOver, dragLeave: dragLeave, drop: drop,
    togglePane: togglePane, detailsTab: detailsTab, restoreVersion: restoreVersion,
    binToggle: binToggle, binAll: binAll, binRestore: binRestore, binPurge: binPurge,
    BIN: BIN,
    // Pure rules, for the unit tests.
    _test: {
      sortItems: sortItems, rangeKeys: rangeKeys, filterItems: filterItems, typeLabel: typeLabel,
      fmtSize: fmtSize, actionsFor: actionsFor, moveTargets: moveTargets, errorText: errorText,
      state: L, setTree: function (t) { L.tree = t; },
    },
  };

})(typeof window !== 'undefined' ? window : this);
