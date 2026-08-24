/**
 * TEMPLATES — Resource Hub destination for completing an Opal master in the
 * portal and taking an independent document away.
 *
 * Mounted at #templates-root, a sibling of #rh2-root. It is deliberately NOT
 * rendered by resourcehub.js: that file rebuilds its subtree wholesale on every
 * render, which would tear out a form mid-keystroke. The hub publishes its
 * current destination on #rh2-root's data-view, and this module shows or hides
 * itself accordingly — the same arrangement fca.js and letter.js already use.
 *
 * ── Two screens ─────────────────────────────────────────────────────────────
 *   catalogue  the three templates, and this user's own documents
 *   editor     the fields on the left, the live document on the right
 *
 * ── Why the form is rendered once ───────────────────────────────────────────
 * The editor's fields are built ONCE when a document opens and are never
 * re-rendered while the user is in them. Typing updates an in-memory model and
 * schedules a save; only the preview, the source chips and the progress count
 * are repainted. An FCA has 33 fields and a service agreement 82 — re-rendering
 * that form on every keystroke is what would make a long template unusable, and
 * it is how entered text gets discarded.
 *
 * ── What the user sees in a field ───────────────────────────────────────────
 * The RESOLVED VALUE, never the binding. A field backed by the participant's
 * Splose record shows "Jane Smith" and a small chip saying where it came from;
 * it never shows the tag that fetched it. Typing over it sets an override for
 * THIS DOCUMENT only — the server never writes back to the client profile or to
 * the master — and clearing the box returns the field to the resolved value.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var API = '/api/templates';
  var SAVE_DEBOUNCE_MS = 700;
  var PREVIEW_TIMEOUT_MS = 20000;

  var S = {
    view: 'catalogue',
    templates: null,
    templatesErr: '',
    documents: null,
    documentsErr: '',
    creating: null,          // { templateId, title, clientId, clientLabel }
    clients: null,
    clientQuery: '',
    clientsLoading: false,
    docu: null,              // the open document
    values: {},              // tag → user-entered value, the live model
    sections: null,          // section rows, present only when the template has them
    dirty: false,
    saving: false,
    saveErr: '',
    exporting: '',
    banner: null,
    preview: { rev: 0, status: 'idle', err: '' },
  };

  // ── Helpers ───────────────────────────────────────────────────────────────

  function el(id) { return doc.getElementById(id); }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(title, msg) {
    if (typeof global.showToast === 'function') global.showToast(title, msg);
  }

  function fmtDateTime(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
      + ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
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
        return {
          ok: false,
          status: r.status,
          code: data.error || null,
          error: data.message || data.error || ('Request failed (' + r.status + ')'),
        };
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, code: null, error: 'Network error — please try again.' };
    }
  }

  /**
   * Where a value came from, in words. The user is told the ORIGIN, never the
   * mechanism: "From the client record", not the tag that fetched it.
   */
  var SOURCE_LABEL = {
    splose: 'From the client record',
    client_profile: 'From the client profile',
    portal: 'From your Opal profile',
    server: 'Issued by Opal',
    report_override: 'You entered this',
    missing: 'Not yet completed',
  };

  function sourceClass(source) {
    if (source === 'missing') return 'tpl-chip tpl-chip-missing';
    if (source === 'report_override') return 'tpl-chip tpl-chip-entered';
    return 'tpl-chip tpl-chip-portal';
  }

  // ── Root visibility ───────────────────────────────────────────────────────

  function root() { return el('templates-root'); }

  function syncVisibility() {
    var host = root();
    if (!host) return;
    var hub = el('rh2-root');
    var on = !!hub && hub.dataset.view === 'templates';
    host.hidden = !on;
    if (!on) return;
    if (!S.templates && !S.templatesErr) loadCatalogue();
    else render();
  }

  // ── Data ──────────────────────────────────────────────────────────────────

  async function loadCatalogue() {
    var r = await api(API);
    if (r.ok) { S.templates = r.templates || []; S.templatesErr = ''; }
    else { S.templatesErr = r.error; S.templates = []; }
    render();
    loadDocuments();
  }

  async function loadDocuments() {
    var r = await api(API + '/documents');
    if (r.ok) { S.documents = r.documents || []; S.documentsErr = ''; }
    else { S.documents = []; S.documentsErr = r.error; }
    if (S.view === 'catalogue') render();
  }

  async function searchClients(q) {
    S.clientsLoading = true;
    var r = await api(API + '/clients?q=' + encodeURIComponent(q || ''));
    S.clientsLoading = false;
    if (r.ok) { S.clients = r.clients || []; }
    else { S.clients = []; toast('Clients unavailable', r.error); }
    renderClientResults();
  }

  // ── Catalogue screen ──────────────────────────────────────────────────────

  function renderCatalogue() {
    var t = S.templates || [];
    var cards = t.map(function (x) {
      return '' +
        '<article class="tpl-card">' +
          '<h3 class="tpl-card-title">' + esc(x.name) + '</h3>' +
          '<p class="tpl-card-desc">' + esc(x.description) + '</p>' +
          '<p class="tpl-card-meta">' + esc(x.fieldCount) + ' fields · master ' + esc(x.version) + '</p>' +
          '<button type="button" class="tpl-btn tpl-btn-primary" ' +
            'onclick="OpalTemplates.startNew(\'' + esc(x.id) + '\')">Start a document</button>' +
        '</article>';
    }).join('');

    var docs = '';
    if (S.documents === null) {
      docs = '<p class="tpl-quiet">Loading your documents…</p>';
    } else if (!S.documents.length) {
      docs = '<p class="tpl-quiet">You have not started any documents yet.</p>';
    } else {
      docs = '<ul class="tpl-doclist">' + S.documents.map(function (d) {
        return '' +
          '<li class="tpl-docrow">' +
            '<button type="button" class="tpl-doclink" onclick="OpalTemplates.open(\'' + esc(d.id) + '\')">' +
              '<span class="tpl-docname">' + esc(d.title) + '</span>' +
              '<span class="tpl-docmeta">' + esc(d.templateName) + ' · updated ' + esc(fmtDateTime(d.updatedAt)) + '</span>' +
            '</button>' +
            '<button type="button" class="tpl-btn tpl-btn-quiet" title="Delete this document" ' +
              'onclick="OpalTemplates.remove(\'' + esc(d.id) + '\')">Delete</button>' +
          '</li>';
      }).join('') + '</ul>';
    }

    return '' +
      '<header class="tpl-head">' +
        '<h2 class="tpl-h2">Templates</h2>' +
        '<p class="tpl-sub">Complete an Opal template here, then download it as Word or PDF. ' +
          'The downloaded file is a document in its own right — it keeps everything already filled in, ' +
          'and anything still outstanding becomes an ordinary field you can complete in Word or a PDF reader.</p>' +
      '</header>' +
      (S.templatesErr ? '<p class="tpl-error">' + esc(S.templatesErr) + '</p>' : '') +
      '<div class="tpl-cards">' + cards + '</div>' +
      '<section class="tpl-section">' +
        '<h3 class="tpl-h3">Your documents</h3>' +
        (S.documentsErr ? '<p class="tpl-error">' + esc(S.documentsErr) + '</p>' : '') +
        docs +
      '</section>' +
      (S.creating ? renderNewDialog() : '');
  }

  function renderNewDialog() {
    var c = S.creating;
    var tpl = (S.templates || []).filter(function (x) { return x.id === c.templateId; })[0];
    return '' +
      '<div class="tpl-modal-backdrop" onclick="OpalTemplates.cancelNew(event)">' +
        '<div class="tpl-modal" role="dialog" aria-modal="true" aria-labelledby="tpl-new-title" onclick="event.stopPropagation()">' +
          '<h3 class="tpl-h3" id="tpl-new-title">New ' + esc(tpl ? tpl.name : 'document') + '</h3>' +
          '<label class="tpl-label" for="tpl-new-name">Document name</label>' +
          '<input class="tpl-input" id="tpl-new-name" type="text" value="' + esc(c.title) + '" ' +
            'oninput="OpalTemplates.setNewTitle(this.value)" placeholder="e.g. Service agreement — 2026 plan">' +
          '<label class="tpl-label" for="tpl-client-q">Participant <span class="tpl-quiet">(optional)</span></label>' +
          '<p class="tpl-hint">Choosing a participant fills in the details you already have access to. ' +
            'Leave it blank to complete every field by hand.</p>' +
          (c.clientId
            ? '<p class="tpl-chosen">' + esc(c.clientLabel) +
              ' <button type="button" class="tpl-btn tpl-btn-quiet" onclick="OpalTemplates.clearClient()">Change</button></p>'
            : '<input class="tpl-input" id="tpl-client-q" type="search" placeholder="Search by name or NDIS number" ' +
              'oninput="OpalTemplates.onClientQuery(this.value)" autocomplete="off">' +
              '<div id="tpl-client-results" class="tpl-results"></div>') +
          '<div class="tpl-modal-actions">' +
            '<button type="button" class="tpl-btn tpl-btn-quiet" onclick="OpalTemplates.cancelNew()">Cancel</button>' +
            '<button type="button" class="tpl-btn tpl-btn-primary" onclick="OpalTemplates.confirmNew()">Create</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function renderClientResults() {
    var host = el('tpl-client-results');
    if (!host) return;
    if (S.clientsLoading) { host.innerHTML = '<p class="tpl-quiet">Searching…</p>'; return; }
    if (S.clients === null) { host.innerHTML = ''; return; }
    if (!S.clients.length) { host.innerHTML = '<p class="tpl-quiet">No matching participants.</p>'; return; }
    host.innerHTML = S.clients.slice(0, 20).map(function (c) {
      var label = (c.fullName || 'Unnamed') + (c.ndisNumber ? ' · ' + c.ndisNumber : '');
      return '<button type="button" class="tpl-result" onclick="OpalTemplates.pickClient(' +
        '\'' + esc(c.id) + '\',\'' + esc(label).replace(/'/g, '&#39;') + '\')">' + esc(label) + '</button>';
    }).join('');
  }

  // ── Editor screen ─────────────────────────────────────────────────────────

  function progressLine() {
    var d = S.docu;
    if (!d) return '';
    return d.completedCount + ' of ' + d.fieldCount + ' completed · ' +
      d.missingCount + ' will export as blank fields';
  }

  function renderEditorShell() {
    var d = S.docu;
    return '' +
      '<header class="tpl-head tpl-head-editor">' +
        '<button type="button" class="tpl-btn tpl-btn-quiet" onclick="OpalTemplates.back()">← Templates</button>' +
        '<div class="tpl-head-main">' +
          '<h2 class="tpl-h2">' + esc(d.title) + '</h2>' +
          '<p class="tpl-sub">' + esc(d.templateName) + ' · master ' + esc(d.templateVersion) +
            ' <span id="tpl-progress" class="tpl-progress">' + esc(progressLine()) + '</span></p>' +
        '</div>' +
        '<div class="tpl-actions">' +
          '<span id="tpl-savestate" class="tpl-savestate" role="status" aria-live="polite"></span>' +
          '<button type="button" class="tpl-btn" id="tpl-dl-docx" onclick="OpalTemplates.download(\'docx\')">Download Word</button>' +
          '<button type="button" class="tpl-btn" id="tpl-dl-pdf" onclick="OpalTemplates.download(\'pdf\')">Download PDF</button>' +
        '</div>' +
      '</header>' +
      '<p class="tpl-boundary-note">Downloads are independent files. Values already filled in are kept; ' +
        'anything outstanding becomes a standalone field you can complete in Word or a PDF reader, ' +
        'with no connection back to Opal.</p>' +
      '<div class="tpl-split">' +
        '<section class="tpl-fields" aria-label="Document fields">' +
          '<div id="tpl-sectionhost"></div>' +
          '<div id="tpl-fieldhost"></div>' +
        '</section>' +
        '<section class="tpl-previewpane" aria-label="Document preview">' +
          '<div class="tpl-preview-bar">' +
            '<span class="tpl-preview-title">Document preview</span>' +
            '<span id="tpl-preview-state" class="tpl-quiet"></span>' +
          '</div>' +
          '<div id="tpl-preview-host" class="tpl-preview-host"></div>' +
        '</section>' +
      '</div>';
  }

  /**
   * The fields, built once. `data-tag` is how an input finds its own field on
   * the way back in; it is an ordinary DOM hook, and no binding syntax is ever
   * put on screen.
   */
  function fieldsHtml() {
    var d = S.docu;
    return (d.groups || []).map(function (g, gi) {
      var rows = g.fields.map(function (f) {
        var v = S.values[f.tag] !== undefined ? S.values[f.tag] : (f.entered ? (f.value || '') : '');
        var shown = f.entered ? v : (f.value == null ? '' : f.value);
        var isOverride = f.entered;
        var placeholder = f.source === 'missing' && !isOverride ? 'Not yet completed' : '';
        var input = f.multiline
          ? '<textarea class="tpl-input tpl-textarea" rows="3" data-tag="' + esc(f.tag) + '" ' +
            'id="tplf-' + esc(f.tag) + '" placeholder="' + esc(placeholder) + '">' + esc(shown) + '</textarea>'
          : '<input class="tpl-input" type="text" data-tag="' + esc(f.tag) + '" ' +
            'id="tplf-' + esc(f.tag) + '" value="' + esc(shown) + '" placeholder="' + esc(placeholder) + '">';
        return '' +
          '<div class="tpl-field">' +
            '<label class="tpl-label" for="tplf-' + esc(f.tag) + '">' + esc(f.label) + '</label>' +
            input +
            '<span class="' + sourceClass(f.source) + '" data-chip="' + esc(f.tag) + '">' +
              esc(SOURCE_LABEL[f.source] || 'Not yet completed') + '</span>' +
          '</div>';
      }).join('');
      return '' +
        '<details class="tpl-group"' + (gi === 0 ? ' open' : '') + '>' +
          '<summary class="tpl-group-summary">' + esc(g.group) +
            ' <span class="tpl-quiet">(' + g.fields.length + ')</span></summary>' +
          '<div class="tpl-group-body">' + rows + '</div>' +
        '</details>';
    }).join('');
  }

  function mountFields() {
    var host = el('tpl-fieldhost');
    if (!host) return;
    host.innerHTML = fieldsHtml();
    host.addEventListener('input', onFieldInput);
  }

  // ── Section structure (templates that offer it — the FCA) ─────────────────

  /**
   * The rows live in S.sections, seeded from the server's EFFECTIVE state and
   * replaced by it after every save — the panel always shows what the preview
   * and the exports will actually compose with.
   */
  function seedSections() {
    S.sections = (S.docu && S.docu.sections) ? S.docu.sections.map(function (s) {
      return {
        tag: s.tag, label: s.label, description: s.description, parent: s.parent,
        required: s.required, included: s.included,
      };
    }) : null;
  }

  function parentIncluded(row) {
    if (!row.parent) return true;
    var p = (S.sections || []).filter(function (x) { return x.tag === row.parent; })[0];
    return !p || p.included;
  }

  function sectionsHtml() {
    var rows = (S.sections || []).map(function (s, i) {
      var dimmed = !parentIncluded(s);
      var effectiveOff = dimmed || !s.included;
      return '' +
        '<div class="tpl-sectionrow' + (s.parent ? ' tpl-section-child' : '') +
          (effectiveOff ? ' tpl-section-off' : '') + '">' +
          '<label class="tpl-section-main" title="' + esc(s.description) + '">' +
            '<input type="checkbox"' + (s.included ? ' checked' : '') +
              (s.required || dimmed ? ' disabled' : '') +
              ' onchange="OpalTemplates.toggleSection(\'' + esc(s.tag) + '\', this.checked)">' +
            '<span class="tpl-section-label">' + esc(s.label) + '</span>' +
            (s.required ? '<span class="tpl-quiet"> · required</span>' : '') +
          '</label>' +
          '<span class="tpl-section-move">' +
            '<button type="button" class="tpl-btn tpl-btn-quiet" title="Move up" aria-label="Move ' + esc(s.label) + ' up" ' +
              'onclick="OpalTemplates.moveSection(\'' + esc(s.tag) + '\', -1)">↑</button>' +
            '<button type="button" class="tpl-btn tpl-btn-quiet" title="Move down" aria-label="Move ' + esc(s.label) + ' down" ' +
              'onclick="OpalTemplates.moveSection(\'' + esc(s.tag) + '\', 1)">↓</button>' +
          '</span>' +
        '</div>';
    }).join('');
    return '' +
      '<details class="tpl-group" open>' +
        '<summary class="tpl-group-summary">Report sections' +
          ' <span class="tpl-quiet">(' + (S.sections || []).length + ')</span></summary>' +
        '<p class="tpl-hint">Untick an optional section to leave it out of this report, and use the arrows ' +
          'to reorder. Required sections always stay. The preview and both downloads follow this structure.</p>' +
        '<div class="tpl-group-body">' + rows + '</div>' +
      '</details>';
  }

  function mountSections() {
    var host = el('tpl-sectionhost');
    if (!host) return;
    host.innerHTML = S.sections ? sectionsHtml() : '';
  }

  /** Persist the panel's state; the response is the server's effective view. */
  async function saveSections() {
    if (!S.docu || !S.sections) return;
    var body = {
      sections: {
        selected: S.sections.filter(function (s) { return s.included; }).map(function (s) { return s.tag; }),
        order: S.sections.map(function (s) { return s.tag; }),
      },
    };
    setSaveState('Saving…');
    var r = await api(API + '/documents/' + encodeURIComponent(S.docu.id), {
      method: 'PATCH', body: body,
    });
    if (!r.ok) {
      setSaveState('Not saved');
      toast('Could not update sections', r.error);
      seedSections();       // fall back to the last server state
      mountSections();
      return;
    }
    S.docu = r.document;
    seedSections();
    mountSections();
    setSaveState('Saved');
    repaintChips();
    refreshPreview();
  }

  function onFieldInput(e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var tag = t.getAttribute('data-tag');
    if (!tag) return;
    S.values[tag] = t.value;
    S.dirty = true;
    setSaveState('Saving…');
    scheduleSave();
  }

  function setSaveState(text) {
    var n = el('tpl-savestate');
    if (n) n.textContent = text;
  }

  var saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  }

  /**
   * Persist this document's own answers, then repaint everything EXCEPT the
   * form. The inputs are left exactly as the user left them — same nodes, same
   * caret — which is the whole reason the form is not re-rendered here.
   */
  async function save() {
    if (!S.docu || S.saving) { if (S.dirty) scheduleSave(); return; }
    S.saving = true;
    var sending = {};
    Object.keys(S.values).forEach(function (k) { sending[k] = S.values[k]; });
    S.dirty = false;

    var r = await api(API + '/documents/' + encodeURIComponent(S.docu.id), {
      method: 'PATCH', body: { fieldValues: sending },
    });
    S.saving = false;

    if (!r.ok) {
      S.saveErr = r.error;
      setSaveState('Not saved');
      toast('Could not save', r.error);
      return;
    }
    S.saveErr = '';
    S.docu = r.document;
    setSaveState('Saved');
    repaintChips();
    refreshPreview();
    if (S.dirty) scheduleSave();
  }

  /** Source chips and the progress line — everything but the inputs. */
  function repaintChips() {
    var d = S.docu;
    if (!d) return;
    (d.groups || []).forEach(function (g) {
      g.fields.forEach(function (f) {
        var chip = doc.querySelector('[data-chip="' + f.tag + '"]');
        if (!chip) return;
        chip.className = sourceClass(f.source);
        chip.textContent = SOURCE_LABEL[f.source] || 'Not yet completed';
      });
    });
    var p = el('tpl-progress');
    if (p) p.textContent = progressLine();
  }

  // ── Live preview ──────────────────────────────────────────────────────────

  function previewState(text) {
    var n = el('tpl-preview-state');
    if (n) n.textContent = text;
  }

  /**
   * The composed document, rendered by the vendored docx-preview. Staged
   * off-screen and swapped in one step, under the reader's scroll position, so
   * a refresh never blanks the pane or jumps a long FCA back to page one.
   */
  async function refreshPreview() {
    if (!S.docu) return;
    if (!global.docx || typeof global.docx.renderAsync !== 'function') {
      previewState('Preview unavailable in this browser.');
      return;
    }
    var rev = ++S.preview.rev;
    previewState('Updating…');

    var ctrl = global.AbortController ? new global.AbortController() : null;
    var timer = setTimeout(function () {
      if (rev !== S.preview.rev) return;
      if (ctrl) { try { ctrl.abort(); } catch (_) {} }
    }, PREVIEW_TIMEOUT_MS);

    try {
      var res = await fetch(API + '/documents/' + encodeURIComponent(S.docu.id)
        + '/preview.docx?rev=' + rev, {
        credentials: 'same-origin', cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) throw new Error('compose_failed');
      var buf = await res.arrayBuffer();
      if (rev !== S.preview.rev) return;

      var staged = doc.createElement('div');
      await global.docx.renderAsync(buf, staged, null, {
        className: 'tpl-docx-render',
        inWrapper: true,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        experimental: true,
        useBase64URL: true,
      });
      if (rev !== S.preview.rev) return;
      clearTimeout(timer);

      var host = el('tpl-preview-host');
      if (!host) return;
      var top = host.scrollTop;
      host.innerHTML = '';
      while (staged.firstChild) host.appendChild(staged.firstChild);
      host.scrollTop = top;
      previewState('Up to date');
    } catch (err) {
      clearTimeout(timer);
      if (rev !== S.preview.rev) return;
      previewState('Preview could not be updated.');
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  function render() {
    var host = root();
    if (!host || host.hidden) return;
    if (S.view === 'editor' && S.docu) {
      host.innerHTML = renderEditorShell();
      mountSections();
      mountFields();
      refreshPreview();
      return;
    }
    host.innerHTML = renderCatalogue();
    renderClientResults();
  }

  // ── Public surface ────────────────────────────────────────────────────────

  var clientTimer = null;

  var PUBLIC = {
    startNew: function (templateId) {
      var tpl = (S.templates || []).filter(function (x) { return x.id === templateId; })[0];
      S.creating = { templateId: templateId, title: tpl ? tpl.name : '', clientId: '', clientLabel: '' };
      S.clients = null;
      render();
    },

    cancelNew: function (e) {
      if (e && e.target && e.target.className !== 'tpl-modal-backdrop') return;
      S.creating = null;
      render();
    },

    setNewTitle: function (v) { if (S.creating) S.creating.title = v; },

    onClientQuery: function (v) {
      S.clientQuery = v;
      if (clientTimer) clearTimeout(clientTimer);
      if (String(v || '').trim().length < 2) { S.clients = null; renderClientResults(); return; }
      clientTimer = setTimeout(function () { searchClients(S.clientQuery); }, 300);
    },

    pickClient: function (id, label) {
      if (!S.creating) return;
      S.creating.clientId = id;
      S.creating.clientLabel = label;
      render();
    },

    clearClient: function () {
      if (!S.creating) return;
      S.creating.clientId = '';
      S.creating.clientLabel = '';
      S.clients = null;
      render();
    },

    confirmNew: async function () {
      if (!S.creating) return;
      var tpl = (S.templates || []).filter(function (x) { return x.id === S.creating.templateId; })[0];
      var title = S.creating.title;
      // A document about a participant is named for them from the start —
      // "Functional Capacity Assessment (FCA) — Jane Smith" — unless the user
      // already typed their own name for it.
      if (S.creating.clientId && tpl && (!title || title === tpl.name)) {
        var clientName = String(S.creating.clientLabel || '').split(' · ')[0].trim();
        if (clientName && clientName !== 'Unnamed') title = tpl.name + ' — ' + clientName;
      }
      var body = { templateId: S.creating.templateId, title: title };
      if (S.creating.clientId) body.clientId = S.creating.clientId;
      var r = await api(API + '/documents', { method: 'POST', body: body });
      if (!r.ok) { toast('Could not create', r.error); return; }
      S.creating = null;
      S.docu = r.document;
      S.values = {};
      seedSections();
      S.view = 'editor';
      render();
      loadDocuments();
    },

    open: async function (id) {
      var r = await api(API + '/documents/' + encodeURIComponent(id));
      if (!r.ok) { toast('Could not open', r.error); return; }
      S.docu = r.document;
      S.values = {};
      // Seed the model from the answers already stored, so a save never blanks
      // a field the user did not touch this session.
      (r.document.groups || []).forEach(function (g) {
        g.fields.forEach(function (f) { if (f.entered) S.values[f.tag] = f.value || ''; });
      });
      seedSections();
      S.view = 'editor';
      render();
    },

    toggleSection: function (tag, on) {
      var rows = S.sections;
      if (!rows) return;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].tag !== tag) continue;
        if (rows[i].required) return;          // not negotiable, mirror the server
        rows[i].included = !!on;
        break;
      }
      mountSections();
      saveSections();
    },

    /**
     * Move a section among its own siblings, carrying its child rows with it.
     * Crossing a parent boundary would be silently overruled by the composer
     * (sections reorder within their parent), so the panel only offers moves
     * that will actually happen.
     */
    moveSection: function (tag, dir) {
      var rows = S.sections;
      if (!rows) return;
      var i = -1;
      var k;
      for (k = 0; k < rows.length; k++) if (rows[k].tag === tag) { i = k; break; }
      if (i < 0) return;

      // A block is a row plus its contiguous children (the server keeps
      // children directly after their parent).
      function blockEnd(start) {
        var end = start + 1;
        while (end < rows.length && rows[end].parent === rows[start].tag) end++;
        return end;
      }

      var sibs = [];
      for (k = 0; k < rows.length; k++) if (rows[k].parent === rows[i].parent) sibs.push(k);
      var pos = sibs.indexOf(i);
      var target = pos + dir;
      if (target < 0 || target >= sibs.length) return;
      var j = sibs[target];

      var aStart = Math.min(i, j); var aEnd = blockEnd(aStart);
      var bStart = Math.max(i, j); var bEnd = blockEnd(bStart);

      S.sections = rows.slice(0, aStart)
        .concat(rows.slice(bStart, bEnd), rows.slice(aEnd, bStart),
          rows.slice(aStart, aEnd), rows.slice(bEnd));
      mountSections();
      saveSections();
    },

    remove: async function (id) {
      if (!global.confirm('Delete this document? The template itself is not affected.')) return;
      var r = await api(API + '/documents/' + encodeURIComponent(id), { method: 'DELETE' });
      if (!r.ok) { toast('Could not delete', r.error); return; }
      loadDocuments();
    },

    back: function () {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (S.dirty) save();
      S.view = 'catalogue';
      S.docu = null;
      S.values = {};
      S.sections = null;
      render();
      loadDocuments();
    },

    /**
     * Download. Any pending edit is flushed FIRST, so the file can never be a
     * version behind what is on screen.
     */
    download: async function (format) {
      if (!S.docu) return;
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (S.dirty || S.saving) await save();

      var btn = el(format === 'pdf' ? 'tpl-dl-pdf' : 'tpl-dl-docx');
      if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
      try {
        var res = await fetch(API + '/documents/' + encodeURIComponent(S.docu.id)
          + '/export.' + format, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) {
          var msg = 'The download could not be prepared.';
          try { var j = await res.json(); if (j && j.message) msg = j.message; } catch (_) {}
          toast('Download failed', msg);
          return;
        }
        var blob = await res.blob();
        // The server names the file — template, title and participant — so the
        // saved document identifies itself; fall back to the title if the
        // header is unreadable.
        var name = '';
        var cd = res.headers.get('Content-Disposition') || '';
        var m = cd.match(/filename="([^"]+)"/);
        if (m) { try { name = decodeURIComponent(m[1]); } catch (_) { name = m[1]; } }
        if (!name) {
          name = (S.docu.title.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'Document') + '.' + format;
        }
        var a = doc.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        doc.body.appendChild(a);
        a.click();
        doc.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.textContent = format === 'pdf' ? 'Download PDF' : 'Download Word';
        }
      }
    },

    // Exported for the frontend guard tests.
    _state: S,
    _sourceLabel: SOURCE_LABEL,
  };

  global.OpalTemplates = PUBLIC;

  // ── Boot ──────────────────────────────────────────────────────────────────

  function boot() {
    if (!root()) return;
    syncVisibility();
    var hub = el('rh2-root');
    if (hub && global.MutationObserver) {
      new global.MutationObserver(function () { syncVisibility(); })
        .observe(hub, { childList: true, subtree: false, attributes: true, attributeFilter: ['data-view'] });
    }
  }

  doc.addEventListener('DOMContentLoaded', boot);
  if (doc.readyState !== 'loading') boot();

  // The Resources tab mounts the hub lazily — re-check shortly after it opens.
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.tab[data-tab="resources"]');
    if (t) setTimeout(syncVisibility, 80);
  });
}(window));
