/* ═══════════════════════════════════════════════════════════════════════════
   THE WALKTHROUGH WORKSHOP — Owner authoring for the interactive induction.

   Phase 2 of docs/INDUCTION_WORKSHOP.md. Two surfaces:

     • THE SHELF — every walkthrough the Owner can edit or reuse. A tour built
       for one induction lands here and can be dropped into any other.
     • THE DOCK — the editor. It sits beside the LIVE portal rather than over
       it, because a walkthrough is authored against the real screen: pick a
       step and the player runs it for real, spotlight and all.

   The dock deliberately does not reimplement the player. "Play from here"
   hands an unsaved draft to OpalInduction.start({ module, at }), so what the
   author watches is exactly what a learner would get — same routing, same
   anchor resolution, same card. "As a new starter sees it" is the same call
   with the dock hidden.

   Save writes the draft and makes it the live version in one step; anyone
   part-way through a walkthrough stays on the version they started.

   Backend: backend/walkthrough-routes.js (owner only). Globals on window, no
   modules, matching every other file here.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  var doc = global && global.document;
  if (!doc) return;

  // ── Block vocabulary ──────────────────────────────────────────────────────
  // The step `type` is the stored contract (walkthrough-content.js). These are
  // the names an author reads — plain English, because the person building an
  // induction is not thinking in step types.
  var BLOCKS = [
    { type: 'intro',      name: 'Welcome',   hint: 'Opens the walkthrough. No spotlight.' },
    { type: 'callout',    name: 'Note',      hint: 'A pop-up with something to read.' },
    { type: 'highlight',  name: 'Spotlight', hint: 'Dims the screen and rings one control.' },
    { type: 'action',     name: 'Do this',   hint: 'Rings a control and waits for a real click.' },
    { type: 'warning',    name: 'Warning',   hint: 'A note that reads as “be careful here”.' },
    { type: 'screenshot', name: 'Picture',   hint: 'A screenshot, for what cannot be shown live.' },
    { type: 'quiz',       name: 'Question',  hint: 'Multiple choice, with why the answer is right.' },
    { type: 'page',       name: 'Page',      hint: 'A short read. No spotlight, no control.' },
    { type: 'checkpoint', name: 'Checkpoint', hint: 'A question they cannot get past until it is right.' },
    { type: 'acknowledgement', name: 'Sign here', hint: 'A statement they agree to. Recorded against their name.' },
    { type: 'complete',   name: 'Finish',    hint: 'Ends the walkthrough. Exactly one, at the end.' },
  ];
  var BLOCK_BY_TYPE = {};
  BLOCKS.forEach(function (b) { BLOCK_BY_TYPE[b.type] = b; });

  var TARGETED = { highlight: 1, action: 1 };

  var STABILITY = {
    anchor:  { tone: 'ok',   text: 'Named anchor — safe.' },
    id:      { tone: 'warn', text: 'Element id — usually stable, not guaranteed.' },
    css:     { tone: 'warn', text: 'CSS selector — fragile. It breaks if this part of the portal is redesigned.' },
    unknown: { tone: 'bad',  text: 'Nothing in the portal answers to this name — the spotlight will find nothing.' },
  };

  // ── State ─────────────────────────────────────────────────────────────────

  var W = {
    shelf: null,        // last loaded shelf payload
    wt: null,           // the walkthrough being edited
    steps: [],          // its draft steps
    idx: 0,             // selected step
    anchors: null,      // the portal map, loaded once
    dirty: false,
    picking: null,      // live target picker state
    recording: null,    // { steps: [], banner } while recording a skeleton
    hidden: false,      // dock hidden for "as a new starter sees it"
  };

  // ── Utilities ─────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(title, msg, kind) {
    if (typeof global.showToast === 'function') global.showToast(title, msg, kind);
    else if (kind === 'error') global.alert(title + '\n\n' + msg);
  }

  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      return { ok: r.ok, status: r.status, data: data };
    } catch (e) {
      return { ok: false, status: 0, data: {} };
    }
  }

  /** Surface the server's own message: its refusals are written for a reader. */
  function fail(res, fallback) {
    toast('Not saved', (res.data && res.data.error) || fallback, 'error');
  }

  function isOwner() {
    return String((global.APP_USER || {}).role || '') === 'owner';
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  THE SHELF
  // ═════════════════════════════════════════════════════════════════════════

  async function open() {
    if (!isOwner()) { toast('Owner only', 'Building walkthroughs is an owner task.'); return; }
    var res = await api('/api/walkthroughs');
    if (!res.ok) { fail(res, 'The walkthrough shelf could not be loaded.'); return; }
    W.shelf = res.data;
    renderShelf();
  }

  function shelfLayer() {
    var el = doc.getElementById('wk-shelf');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'wk-shelf';
      el.className = 'wk-shelf';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Walkthroughs');
      doc.body.appendChild(el);
    }
    return el;
  }

  function closeShelf() {
    var el = doc.getElementById('wk-shelf');
    if (el) el.remove();
  }

  function renderShelf() {
    var d = W.shelf || {};
    var list = d.walkthroughs || [];
    var h = '';

    h += '<div class="wk-shelf-inner">';
    h += '<div class="wk-shelf-head">' +
         '<div><h2 class="wk-h2">Walkthroughs</h2>' +
         '<p class="wk-muted">Built once, reusable in any induction. Saving makes the latest version the one staff and inductions use.</p></div>' +
         '<div class="wk-head-actions">' +
         '<button type="button" class="wk-btn" onclick="OpalWorkshop.report()">Check my walkthroughs</button>' +
         '<button type="button" class="wk-btn wk-btn-primary" onclick="OpalWorkshop.createNew()">New walkthrough</button>' +
         '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.closeShelf()">Close</button>' +
         '</div></div>';

    if (W.naming) {
      h += '<form class="wk-field wk-new" onsubmit="event.preventDefault();OpalWorkshop.createNew(this.elements.title.value)">' +
           '<label for="wk-new-title">What is this walkthrough called?</label>' +
           '<input type="text" id="wk-new-title" name="title" autocomplete="off" placeholder="e.g. Booking a client appointment">' +
           '<div class="wk-new-row">' +
           '<button type="submit" class="wk-btn wk-btn-primary">Create</button>' +
           '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.cancelNew()">Cancel</button>' +
           '</div></form>';
    }

    if (!d.seeded) {
      h += '<div class="wk-empty">' +
           '<p><strong>The built-in walkthroughs have not been imported yet.</strong></p>' +
           '<p class="wk-muted">Your staff are seeing the nine walkthroughs that ship with the portal. ' +
           'Import them to make them editable — importing changes nothing about what they see.</p>' +
           '<button type="button" class="wk-btn wk-btn-primary" onclick="OpalWorkshop.seed()">Import the built-in walkthroughs</button>' +
           '</div>';
    }

    if (W.report) h += reportHtml(W.report);

    if (list.length) {
      var groups = {};
      list.forEach(function (w) { (groups[w.group] = groups[w.group] || []).push(w); });
      Object.keys(groups).sort().forEach(function (g) {
        h += '<h3 class="wk-h3">' + esc(g) + '</h3><div class="wk-grid">';
        groups[g].forEach(function (w) { h += shelfCard(w); });
        h += '</div>';
      });
    }

    h += '</div>';
    shelfLayer().innerHTML = h;
  }

  function shelfCard(w) {
    var state = w.status === 'archived' ? 'Archived'
      : w.current_version < 1 ? 'Not saved yet'
      : w.has_unpublished_changes ? ('v' + w.current_version + ' · unsaved changes')
      : ('v' + w.current_version + ' · up to date');
    var tone = w.status === 'archived' ? 'muted'
      : w.current_version < 1 ? 'draft'
      : w.has_unpublished_changes ? 'draft' : 'ok';

    return '<div class="wk-card">' +
      '<div class="wk-card-top">' +
        '<h4>' + esc(w.title) + '</h4>' +
        '<span class="wk-pill wk-pill-' + tone + '">' + esc(state) + '</span>' +
      '</div>' +
      '<p class="wk-muted">' + esc(w.description || 'No description yet.') + '</p>' +
      '<p class="wk-meta">' + w.step_count + ' step' + (w.step_count === 1 ? '' : 's') +
        ' · ' + esc((w.roles || []).join(', ')) +
        (w.learners ? (' · ' + w.learners + ' staff have taken it') : '') + '</p>' +
      '<div class="wk-card-actions">' +
        '<button type="button" class="wk-btn wk-btn-primary" onclick="OpalWorkshop.edit(\'' + esc(w.id) + '\')">Edit</button>' +
        '<button type="button" class="wk-btn" onclick="OpalWorkshop.duplicate(\'' + esc(w.id) + '\')">Duplicate</button>' +
        (w.status === 'archived'
          ? '<button type="button" class="wk-btn" onclick="OpalWorkshop.unarchive(\'' + esc(w.id) + '\')">Restore</button>'
          : '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.archive(\'' + esc(w.id) + '\')">Archive</button>') +
        (w.current_version < 1 && !w.learners
          ? '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.remove(\'' + esc(w.id) + '\')">Delete</button>' : '') +
      '</div></div>';
  }

  async function seed() {
    var res = await api('/api/tutorials/seed', { method: 'POST' });
    if (!res.ok) { fail(res, 'The built-in walkthroughs could not be imported.'); return; }
    toast('Imported', res.data.created.length + ' walkthroughs are now editable.');
    open();
  }

  /**
   * Create a walkthrough. With a title (the New induction dialog collects
   * one) it is created straight away; without one the shelf shows its own
   * name field — never the browser's own dialog, which ignores the theme.
   */
  async function createNew(title) {
    title = String(title || '').trim();
    if (!title) {
      W.naming = true;
      if (!doc.getElementById('wk-shelf')) { await open(); } else { renderShelf(); }
      var el = doc.getElementById('wk-new-title');
      if (el) { try { el.focus(); } catch (e) { /* not painted yet */ } }
      return;
    }
    W.naming = false;
    var res = await api('/api/walkthroughs', {
      method: 'POST',
      body: {
        title: title.trim(),
        roles: ['owner', 'admin', 'therapist', 'read_only'],
        minutes: 5,
        steps: [
          { type: 'intro', title: title.trim(), body: 'Say what this walkthrough covers.' },
          { type: 'complete', title: 'All done', body: 'Say what they can now do.' },
        ],
      },
    });
    if (!res.ok) { fail(res, 'The walkthrough could not be created.'); return; }
    closeShelf();
    edit(res.data.walkthrough.id);
  }

  function cancelNew() { W.naming = false; renderShelf(); }

  async function duplicate(id) {
    var res = await api('/api/walkthroughs/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' });
    if (!res.ok) { fail(res, 'The walkthrough could not be duplicated.'); return; }
    open();
  }

  async function archive(id) {
    if (!global.confirm('Archive this walkthrough? Staff stop seeing it immediately. Completions are kept.')) return;
    var res = await api('/api/walkthroughs/' + encodeURIComponent(id) + '/archive', { method: 'POST' });
    if (!res.ok) { fail(res, 'The walkthrough could not be archived.'); return; }
    open();
  }

  async function unarchive(id) {
    var res = await api('/api/walkthroughs/' + encodeURIComponent(id) + '/unarchive', { method: 'POST' });
    if (!res.ok) { fail(res, 'The walkthrough could not be restored.'); return; }
    open();
  }

  async function remove(id) {
    if (!global.confirm('Delete this walkthrough permanently? Only one that was never published and never taken can be deleted.')) return;
    var res = await api('/api/walkthroughs/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { fail(res, 'The walkthrough could not be deleted.'); return; }
    open();
  }

  // ═════════════════════════════════════════════════════════════════════════
  //  THE DOCK
  // ═════════════════════════════════════════════════════════════════════════

  async function edit(id) {
    if (!isOwner()) return;
    var res = await api('/api/walkthroughs/' + encodeURIComponent(id));
    if (!res.ok) { fail(res, 'That walkthrough could not be opened.'); return; }
    if (!W.anchors) {
      var a = await api('/api/walkthroughs/anchors');
      W.anchors = (a.ok && a.data.anchors) || [];
    }
    closeShelf();
    W.wt = res.data.walkthrough;
    W.steps = res.data.steps || [];
    W.idx = 0;
    W.dirty = false;
    W.hidden = false;
    doc.body.classList.add('wk-open');
    renderDock();
    playCurrent();
  }

  function closeDock() {
    if (W.dirty && !global.confirm('You have unsaved changes. Close the editor anyway?')) return;
    stopPicking();
    if (global.OpalInduction) global.OpalInduction.close();
    var el = doc.getElementById('wk-dock');
    if (el) el.remove();
    doc.body.classList.remove('wk-open');
    W.wt = null; W.steps = []; W.dirty = false;
  }

  function dockLayer() {
    var el = doc.getElementById('wk-dock');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'wk-dock';
      el.className = 'wk-dock';
      el.setAttribute('role', 'region');
      el.setAttribute('aria-label', 'Walkthrough editor');
      doc.body.appendChild(el);
    }
    return el;
  }

  /** The module object the player is handed — the unsaved draft, as authored. */
  function draftModule() {
    return {
      key: W.wt.key,
      version: W.wt.current_version || 1,
      title: W.wt.title,
      minutes: W.wt.minutes,
      roles: W.wt.roles,
      description: W.wt.description,
      thumb: W.wt.thumb,
      start: W.wt.start || {},
      steps: W.steps,
    };
  }

  function playCurrent() {
    if (!W.wt || !W.steps.length) return;
    if (!global.OpalInduction) return;
    global.OpalInduction.start(W.wt.key, { module: draftModule(), at: W.idx });
  }

  function renderDock() {
    if (!W.wt) return;
    var w = W.wt;
    var state = w.current_version < 1 ? 'Not saved yet'
      : (W.dirty || w.has_unpublished_changes)
        ? ('Staff see v' + w.current_version + ' · unsaved changes')
        : ('Staff see v' + w.current_version + ' · up to date');

    var h = '';
    h += '<div class="wk-dock-head">' +
      '<div class="wk-dock-title">' +
        '<input type="text" class="wk-title-input" value="' + esc(w.title) + '" ' +
          'aria-label="Walkthrough title" onchange="OpalWorkshop._meta(\'title\', this.value)">' +
        '<p class="wk-state">' + esc(state) + '</p>' +
      '</div>' +
      '<button type="button" class="wk-x" onclick="OpalWorkshop.closeDock()" aria-label="Close the editor">×</button>' +
    '</div>';

    h += '<div class="wk-dock-bar">' +
      '<button type="button" class="wk-btn wk-btn-primary" onclick="OpalWorkshop.save()"' +
        (W.dirty ? '' : ' disabled') + '>Save</button>' +
      '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.previewAsLearner()">As a new starter sees it</button>' +
      '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.startRecording()">Record steps</button>' +
    '</div>';

    h += '<div class="wk-rail">';
    W.steps.forEach(function (s, i) {
      var block = BLOCK_BY_TYPE[s.type] || { name: s.type };
      h += '<div class="wk-rail-row' + (i === W.idx ? ' is-current' : '') + '" ' +
             'onclick="OpalWorkshop.select(' + i + ')">' +
        '<span class="wk-rail-n">' + (i + 1) + '</span>' +
        '<span class="wk-rail-body"><span class="wk-rail-type">' + esc(block.name) + '</span>' +
        '<span class="wk-rail-title">' + esc(s.title || '(untitled)') + '</span></span>' +
        '<span class="wk-rail-tools">' +
          '<button type="button" class="wk-mini" title="Move up" onclick="event.stopPropagation();OpalWorkshop.move(' + i + ',-1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="wk-mini" title="Move down" onclick="event.stopPropagation();OpalWorkshop.move(' + i + ',1)"' + (i === W.steps.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="wk-mini" title="Delete this step" onclick="event.stopPropagation();OpalWorkshop.removeStep(' + i + ')">×</button>' +
        '</span></div>';
    });
    h += '<div class="wk-rail-add"><button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.togglePalette()">+ Add a block here</button></div>';
    h += paletteHtml();
    h += '</div>';

    h += '<div class="wk-editor">' + stepEditorHtml() + '</div>';

    dockLayer().innerHTML = h;
  }

  var paletteOpen = false;

  function paletteHtml() {
    if (!paletteOpen) return '';
    var h = '<div class="wk-palette">';
    BLOCKS.forEach(function (b) {
      h += '<button type="button" class="wk-palette-item" onclick="OpalWorkshop.addStep(\'' + b.type + '\')">' +
        '<strong>' + esc(b.name) + '</strong><span>' + esc(b.hint) + '</span></button>';
    });
    h += '</div>';
    return h;
  }

  function stepEditorHtml() {
    var s = W.steps[W.idx];
    if (!s) return '<p class="wk-muted">This walkthrough has no steps yet. Add one to begin.</p>';
    var block = BLOCK_BY_TYPE[s.type] || { name: s.type, hint: '' };
    var h = '';

    h += '<div class="wk-field"><label>Block</label>' +
      '<select onchange="OpalWorkshop._step(\'type\', this.value)">';
    BLOCKS.forEach(function (b) {
      h += '<option value="' + b.type + '"' + (b.type === s.type ? ' selected' : '') + '>' + esc(b.name) + '</option>';
    });
    h += '</select><p class="wk-hint">' + esc(block.hint) + '</p></div>';

    h += '<div class="wk-field"><label>Heading</label>' +
      '<input type="text" value="' + esc(s.title || '') + '" onchange="OpalWorkshop._step(\'title\', this.value)"></div>';

    if (s.type === 'quiz' || s.type === 'checkpoint') {
      var q = s.quiz || { question: '', options: ['', ''], correctIndex: 0, explain: '' };
      h += '<div class="wk-field"><label>Question</label>' +
        '<textarea rows="2" onchange="OpalWorkshop._quiz(\'question\', this.value)">' + esc(q.question) + '</textarea></div>';
      h += '<div class="wk-field"><label>Answers <span class="wk-hint-inline">tick the right one</span></label>';
      (q.options || []).forEach(function (opt, i) {
        h += '<div class="wk-opt">' +
          '<input type="radio" name="wk-correct" ' + (q.correctIndex === i ? 'checked' : '') +
            ' onchange="OpalWorkshop._quiz(\'correctIndex\', ' + i + ')" aria-label="Answer ' + (i + 1) + ' is correct">' +
          '<input type="text" value="' + esc(opt) + '" onchange="OpalWorkshop._quizOption(' + i + ', this.value)">' +
          '<button type="button" class="wk-mini" onclick="OpalWorkshop._quizRemove(' + i + ')"' +
            ((q.options || []).length <= 2 ? ' disabled title="A question needs at least two answers"' : '') + '>×</button>' +
          '</div>';
      });
      h += '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop._quizAdd()">Add an answer</button></div>';
      h += '<div class="wk-field"><label>Why that answer</label>' +
        '<textarea rows="2" onchange="OpalWorkshop._quiz(\'explain\', this.value)">' + esc(q.explain || '') + '</textarea>' +
        (s.type === 'checkpoint'
          ? '<p class="wk-hint">A checkpoint is marked by the server, so the answer never travels to the ' +
            'browser and the gate is real. They cannot move on until they get it right.</p>' : '') +
        '</div>';
    } else if (s.type === 'acknowledgement') {
      h += '<div class="wk-field"><label>The statement they agree to</label>' +
        '<textarea rows="4" onchange="OpalWorkshop._step(\'ack_statement\', this.value)">' +
        esc(s.ack_statement || '') + '</textarea>' +
        '<p class="wk-hint">Recorded against their name with the date. The wording that is stored is the ' +
        'wording you publish, so say exactly what is being agreed to.</p></div>';
      h += '<div class="wk-field"><label>Anything to read first (optional)</label>' +
        '<textarea rows="3" onchange="OpalWorkshop._step(\'body\', this.value)">' + esc(s.body || '') + '</textarea></div>';
    } else {
      h += '<div class="wk-field"><label>What it says</label>' +
        '<textarea rows="6" onchange="OpalWorkshop._step(\'body\', this.value)">' + esc(s.body || '') + '</textarea>' +
        '<p class="wk-hint">Plain text. **Bold** works, and a blank line starts a new paragraph.</p></div>';
    }

    if (TARGETED[s.type]) h += targetFieldHtml(s);

    // Where the step runs. Recording fills this in, and it is the difference
    // between a spotlight that lands and one that finds an empty screen.
    if (s.route && (s.route.tab || s.route.open)) {
      h += '<p class="wk-hint wk-tone-ok">Runs on the <strong>' + esc(s.route.tab || 'current') +
        '</strong> tab' +
        (s.route.open ? ', and opens the <strong>' + esc(s.route.open) + '</strong> panel first' : '') +
        '.</p>';
    }

    if (s.type === 'action') {
      h += '<div class="wk-field wk-check">' +
        '<label><input type="checkbox" ' + (s.advance === 'click' ? 'checked' : '') +
        ' onchange="OpalWorkshop._advance(this.checked)"> Wait for them to actually click it</label>' +
        '<p class="wk-hint">Left off, the step explains the control and moves on with Next. ' +
        'Controls that send, delete or disconnect something can never be clicked through.</p></div>';
    }

    if (s.type === 'screenshot') {
      var img = s.image || {};
      h += '<div class="wk-field"><label>Picture</label>' +
        '<input type="text" value="' + esc(img.src || '') + '" placeholder="/assets/tutorials/example.png" ' +
        'onchange="OpalWorkshop._image(\'src\', this.value)">' +
        '<input type="text" value="' + esc(img.alt || '') + '" placeholder="Describe the picture for a screen reader" ' +
        'onchange="OpalWorkshop._image(\'alt\', this.value)"></div>';
    }

    h += '<div class="wk-field"><label>Show it to</label><div class="wk-roles">';
    ['owner', 'admin', 'therapist', 'read_only'].forEach(function (r) {
      var on = !s.roles || s.roles.indexOf(r) !== -1;
      var admitted = (W.wt.roles || []).indexOf(r) !== -1;
      h += '<label class="wk-role' + (admitted ? '' : ' is-off') + '">' +
        '<input type="checkbox" ' + (on && admitted ? 'checked' : '') + (admitted ? '' : ' disabled') +
        ' onchange="OpalWorkshop._stepRole(\'' + r + '\', this.checked)"> ' + esc(r.replace('_', ' ')) + '</label>';
    });
    h += '</div><p class="wk-hint">Greyed-out roles are not part of this walkthrough at all.</p></div>';

    h += '<div class="wk-editor-actions">' +
      '<button type="button" class="wk-btn" onclick="OpalWorkshop.playCurrent()">Play from here</button>' +
      '</div>';

    return h;
  }

  function targetFieldHtml(s) {
    var stability = classify(s.target);
    var info = STABILITY[stability] || STABILITY.unknown;
    var h = '<div class="wk-field"><label>Point at</label>';

    h += '<select onchange="OpalWorkshop._target(this.value)">';
    h += '<option value="">— choose a control —</option>';
    var groups = {};
    (W.anchors || []).forEach(function (a) { (groups[a.group] = groups[a.group] || []).push(a); });
    Object.keys(groups).sort().forEach(function (g) {
      h += '<optgroup label="' + esc(g) + '">';
      groups[g].forEach(function (a) {
        h += '<option value="' + esc(a.target) + '"' + (a.target === s.target ? ' selected' : '') + '>' +
          esc(a.label) + '</option>';
      });
      h += '</optgroup>';
    });
    h += '</select>';

    h += '<div class="wk-target-row">' +
      '<input type="text" value="' + esc(s.target || '') + '" onchange="OpalWorkshop._target(this.value)" ' +
        'aria-label="Target">' +
      '<button type="button" class="wk-btn wk-btn-quiet" onclick="OpalWorkshop.pickTarget()">Just show me</button>' +
      '</div>';
    h += '<p class="wk-hint wk-tone-' + info.tone + '">' + esc(info.text) + '</p>';
    h += '</div>';
    return h;
  }

  /** Classify a target the way the server does, so the warning agrees. */
  function classify(target) {
    var t = String(target || '');
    if (!t) return 'unknown';
    if ((W.anchors || []).some(function (a) { return a.target === t; })) return 'anchor';
    if (t.charAt(0) === '#') return 'id';
    if (t.charAt(0) !== '.' && t.indexOf('[') === -1) return 'unknown';
    return 'css';
  }

  // ── Editing ───────────────────────────────────────────────────────────────

  function touch(replay) {
    W.dirty = true;
    renderDock();
    if (replay) playCurrent();
  }

  function select(i) {
    W.idx = Math.max(0, Math.min(i, W.steps.length - 1));
    paletteOpen = false;
    renderDock();
    playCurrent();
  }

  function togglePalette() { paletteOpen = !paletteOpen; renderDock(); }

  function addStep(type) {
    var block = BLOCK_BY_TYPE[type] || {};
    var step = { type: type, title: block.name || 'New step', body: 'Say what this step is for.' };
    if (type === 'quiz' || type === 'checkpoint') {
      delete step.body;
      step.quiz = { question: 'Ask something.', options: ['First answer', 'Second answer'], correctIndex: 0, explain: '' };
    }
    if (type === 'acknowledgement') {
      delete step.body;
      step.ack_statement = 'I have read and understood this.';
    }
    if (type === 'screenshot') step.image = { src: '', alt: '' };
    W.steps.splice(W.idx + 1, 0, step);
    W.idx = Math.min(W.idx + 1, W.steps.length - 1);
    paletteOpen = false;
    touch(true);
  }

  function removeStep(i) {
    if (W.steps.length <= 1) { toast('Not removed', 'A walkthrough needs at least one step.'); return; }
    if (!global.confirm('Delete this step?')) return;
    W.steps.splice(i, 1);
    if (W.idx >= W.steps.length) W.idx = W.steps.length - 1;
    touch(true);
  }

  function move(i, delta) {
    var j = i + delta;
    if (j < 0 || j >= W.steps.length) return;
    var s = W.steps.splice(i, 1)[0];
    W.steps.splice(j, 0, s);
    W.idx = j;
    touch(false);
  }

  function _meta(field, value) {
    W.wt[field] = value;
    touch(false);
  }

  function _step(field, value) {
    var s = W.steps[W.idx];
    if (!s) return;
    if (field === 'type' && value !== s.type) {
      s.type = value;
      var wantsQuiz = value === 'quiz' || value === 'checkpoint';
      if (wantsQuiz && !s.quiz) {
        s.quiz = { question: 'Ask something.', options: ['First answer', 'Second answer'], correctIndex: 0, explain: '' };
        delete s.body;
      }
      if (value === 'acknowledgement' && !s.ack_statement) {
        s.ack_statement = 'I have read and understood this.';
        delete s.body;
      }
      if (!wantsQuiz && value !== 'acknowledgement' && !s.body) s.body = 'Say what this step is for.';
      if (!TARGETED[value]) { delete s.target; delete s.advance; }
      touch(true);
      return;
    }
    s[field] = value;
    touch(field === 'title' || field === 'body');
  }

  function _target(value) {
    var s = W.steps[W.idx];
    if (!s) return;
    s.target = String(value || '').trim();
    touch(true);
  }

  function _advance(on) {
    var s = W.steps[W.idx];
    if (!s) return;
    if (on) s.advance = 'click'; else delete s.advance;
    touch(true);
  }

  function _image(field, value) {
    var s = W.steps[W.idx];
    if (!s) return;
    s.image = s.image || { src: '', alt: '' };
    s.image[field] = value;
    touch(true);
  }

  function _stepRole(roleName, on) {
    var s = W.steps[W.idx];
    if (!s) return;
    var admitted = (W.wt.roles || []).slice();
    var current = s.roles ? s.roles.slice() : admitted.slice();
    var i = current.indexOf(roleName);
    if (on && i === -1) current.push(roleName);
    if (!on && i !== -1) current.splice(i, 1);
    if (!current.length) { toast('Not changed', 'A step has to be visible to somebody.'); renderDock(); return; }
    // Visible to everyone the walkthrough admits = no gate at all, which is
    // what the stored shape means by an absent roles array.
    if (current.length === admitted.length) delete s.roles;
    else s.roles = current;
    touch(false);
  }

  function _quiz(field, value) {
    var s = W.steps[W.idx];
    if (!s || !s.quiz) return;
    s.quiz[field] = field === 'correctIndex' ? Number(value) : value;
    touch(field === 'correctIndex' ? false : true);
  }

  function _quizOption(i, value) {
    var s = W.steps[W.idx];
    if (!s || !s.quiz) return;
    s.quiz.options[i] = value;
    touch(true);
  }

  function _quizAdd() {
    var s = W.steps[W.idx];
    if (!s || !s.quiz) return;
    if (s.quiz.options.length >= 8) { toast('Not added', 'Eight answers is the most a question can offer.'); return; }
    s.quiz.options.push('Another answer');
    touch(true);
  }

  function _quizRemove(i) {
    var s = W.steps[W.idx];
    if (!s || !s.quiz || s.quiz.options.length <= 2) return;
    s.quiz.options.splice(i, 1);
    if (s.quiz.correctIndex >= s.quiz.options.length) s.quiz.correctIndex = 0;
    else if (s.quiz.correctIndex > i) s.quiz.correctIndex--;
    touch(true);
  }

  // ── The live target picker ────────────────────────────────────────────────

  /**
   * "Just show me": point at a control on the real screen. The captured
   * selector prefers a data-help anchor, then an id, and only then a CSS
   * path — the same order induction.js resolves in, so what is captured is
   * what the player will find.
   */
  function pickTarget() {
    if (W.picking) return stopPicking();
    if (global.OpalInduction) global.OpalInduction.close();
    W.picking = { box: null };
    doc.body.classList.add('wk-picking');

    var box = doc.createElement('div');
    box.className = 'wk-pick-box';
    doc.body.appendChild(box);
    W.picking.box = box;

    var banner = doc.createElement('div');
    banner.className = 'wk-pick-banner';
    banner.textContent = 'Click the control this step should point at. Escape to cancel.';
    doc.body.appendChild(banner);
    W.picking.banner = banner;

    doc.addEventListener('mousemove', onPickMove, true);
    doc.addEventListener('click', onPickClick, true);
    doc.addEventListener('keydown', onPickKey, true);
  }

  function pickableFrom(el) {
    while (el && el !== doc.body) {
      if (el.id === 'wk-dock' || el.id === 'wk-shelf' ||
          (el.className && String(el.className).indexOf('wk-pick') === 0)) return null;
      el = el.parentElement;
    }
    return true;
  }

  function onPickMove(e) {
    if (!W.picking) return;
    var el = e.target;
    if (!pickableFrom(el)) { W.picking.box.style.display = 'none'; return; }
    var r = el.getBoundingClientRect();
    var b = W.picking.box;
    b.style.display = 'block';
    b.style.top = r.top + 'px';
    b.style.left = r.left + 'px';
    b.style.width = r.width + 'px';
    b.style.height = r.height + 'px';
  }

  function onPickKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); stopPicking(); }
  }

  function onPickClick(e) {
    if (!W.picking) return;
    var el = e.target;
    if (!pickableFrom(el)) return;
    e.preventDefault();
    e.stopPropagation();
    var sel = selectorFor(el);
    stopPicking();
    if (!sel) { toast('Nothing to point at', 'That element has nothing stable to identify it by.', 'error'); return; }
    _target(sel);
  }

  /** Walk up for the most stable identifier available. */
  function selectorFor(el) {
    for (var node = el; node && node !== doc.body; node = node.parentElement) {
      if (node.getAttribute && node.getAttribute('data-help')) return node.getAttribute('data-help');
      if (node.id) return '#' + node.id;
    }
    // Last resort: a class path. Fragile, and the editor says so.
    if (el.className && typeof el.className === 'string') {
      var cls = el.className.trim().split(/\s+/)[0];
      if (cls) return '.' + cls;
    }
    return '';
  }

  function stopPicking() {
    if (!W.picking) return;
    doc.removeEventListener('mousemove', onPickMove, true);
    doc.removeEventListener('click', onPickClick, true);
    doc.removeEventListener('keydown', onPickKey, true);
    if (W.picking.box) W.picking.box.remove();
    if (W.picking.banner) W.picking.banner.remove();
    W.picking = null;
    doc.body.classList.remove('wk-picking');
  }

  // ── Saving and publishing ─────────────────────────────────────────────────

  async function save() {
    if (!W.wt) return;
    var res = await api('/api/walkthroughs/' + encodeURIComponent(W.wt.id), {
      method: 'PUT',
      body: {
        key: W.wt.key, title: W.wt.title, description: W.wt.description,
        group: W.wt.group, minutes: W.wt.minutes, roles: W.wt.roles,
        thumb: W.wt.thumb, start: W.wt.start, steps: W.steps,
      },
    });
    if (!res.ok) { fail(res, 'This walkthrough could not be saved.'); return false; }
    W.wt = res.data.walkthrough;
    W.steps = res.data.steps;
    W.dirty = false;
    // Saving IS making it usable: the saved draft becomes the version staff
    // and inductions run. Anyone part-way through stays on the version they
    // started. There is no separate publish step to forget.
    var pub = await api('/api/walkthroughs/' + encodeURIComponent(W.wt.id) + '/publish', { method: 'POST' });
    if (!pub.ok) {
      renderDock();
      fail(pub, 'The walkthrough was saved but could not be made available to staff.');
      return false;
    }
    if (pub.data.published) {
      W.wt.current_version = pub.data.version;
      W.wt.has_unpublished_changes = false;
    }
    renderDock();
    toast('Saved', 'Staff and inductions now use v' + (W.wt.current_version || 1) + '.');
    return true;
  }

  /** The same player, with the dock out of the way. */
  function previewAsLearner() {
    W.hidden = true;
    doc.body.classList.add('wk-hidden');
    var back = doc.createElement('button');
    back.type = 'button';
    back.className = 'wk-return';
    back.textContent = 'Back to editing';
    back.onclick = function () {
      W.hidden = false;
      doc.body.classList.remove('wk-hidden');
      back.remove();
      renderDock();
    };
    doc.body.appendChild(back);
    if (global.OpalInduction) {
      global.OpalInduction.start(W.wt.key, { module: draftModule(), at: 0 });
    }
  }

  // The dock follows the player: selecting a step in one selects it in the
  // other, and a step whose anchor did not resolve says so where it is edited.
  doc.addEventListener('induction:step', function (e) {
    if (!W.wt || W.hidden) return;
    var d = e.detail || {};
    if (d.key !== W.wt.key) return;
    if (typeof d.index === 'number' && d.index !== W.idx) {
      W.idx = d.index;
      renderDock();
    }
    if (d.target && !d.resolved) {
      toast('That control is not on screen', 'The spotlight could not find "' + d.target + '" here.', 'error');
    }
  });

  // ═════════════════════════════════════════════════════════════════════════
  //  THE TARGET REPORT
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * "Check my walkthroughs": which spotlights point at something the portal
   * no longer offers. The answer belongs in a report the Owner reads, not in
   * front of a new employee on their first morning.
   */
  async function report() {
    var res = await api('/api/walkthroughs/report');
    if (!res.ok) { fail(res, 'The check could not be run.'); return; }
    W.report = res.data;
    renderShelf();
  }

  function reportHtml(r) {
    var h = '<div class="wk-report">';
    h += '<div class="wk-report-head"><h3 class="wk-h3">Checked ' + r.checkedCount +
      ' walkthrough' + (r.checkedCount === 1 ? '' : 's') + '</h3>' +
      '<button type="button" class="wk-mini" onclick="OpalWorkshop.dismissReport()" ' +
      'aria-label="Dismiss the check">×</button></div>';

    if (!r.walkthroughs.length) {
      h += '<p class="wk-tone-ok">Every spotlight points at something that exists. Nothing to fix.</p></div>';
      return h;
    }

    h += '<p class="wk-muted">' +
      (r.broken ? '<strong class="wk-tone-bad">' + r.broken + ' pointing at nothing.</strong> ' : '') +
      (r.fragile ? '<span class="wk-tone-warn">' + r.fragile + ' fragile.</span>' : '') +
      '</p>';

    r.walkthroughs.forEach(function (w) {
      h += '<div class="wk-report-item"><h4>' + esc(w.title) +
        ' <span class="wk-muted">(' + esc(w.checked === 'published' ? 'v' + w.version : 'unpublished draft') + ')</span></h4><ul>';
      w.issues.forEach(function (i) {
        var info = STABILITY[i.stability] || STABILITY.unknown;
        h += '<li class="wk-tone-' + info.tone + '">Step ' + (i.index + 1) + ' — ' +
          esc(i.title || '(untitled)') + ' → <code>' + esc(i.target) + '</code><br>' +
          '<span class="wk-hint">' + esc(info.text) + '</span></li>';
      });
      h += '</ul><button type="button" class="wk-btn" onclick="OpalWorkshop.edit(\'' + esc(w.id) + '\')">Fix it</button></div>';
    });
    h += '</div>';
    return h;
  }

  function dismissReport() { W.report = null; renderShelf(); }

  // ═════════════════════════════════════════════════════════════════════════
  //  RECORDING
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * Building a walkthrough from an empty screen means thinking of every step
   * in advance. Recording removes that half: use the portal the way you would
   * show a new therapist over your shoulder, and each control you click
   * becomes a step pointing at it, in order.
   *
   * It writes the SKELETON, never the words — every captured step carries a
   * placeholder the author replaces. A recording that invented copy would be
   * worse than none.
   */
  var RECORD_CAP = 60;

  /**
   * Anything that behaves like a pop-up. Deliberately broad and shape-based
   * rather than a list of known panels: the portal has modals, slide-overs,
   * drawers and detail panels built by several different features, and a
   * hand-kept list would miss the next one somebody adds.
   */
  var OVERLAY_SEL = '[role="dialog"], [class*="modal"], [class*="panel"], [class*="popup"],' +
    '[class*="pop-up"], [class*="overlay"], [class*="drawer"], [class*="slide"], [class*="sheet"]';

  /**
   * Panels the PLAYER knows how to open by itself (induction.js OPENERS). A
   * step inside one of these can carry route.open and be reached cold — a
   * learner resuming mid-walkthrough still gets the panel opened for them.
   * Anything else relies on the click-through step that opens it.
   */
  var OPENER_HINTS = [
    [/booking/i, 'booking'],
    [/notif/i, 'notifications'],
    [/invite-modal/i, 'invite-modal'],
    [/(^|[^a-z])opa([^a-z]|$)/i, 'opa'],
  ];

  /**
   * Mirrors DESTRUCTIVE_TARGET in backend/walkthrough-content.js. Recording
   * must not mark a send/delete/disconnect control as click-through: the
   * server would refuse the save, and the author would be left holding a
   * recording they cannot store. Those steps stay as spotlights.
   */
  var RECORD_NO_CLICK =
    /(disconnect|delete|remove|revoke|send|submit|publish|deactivate|suspend|approve|reject|mark-all|sign-?out|logout)/i;

  function overlayKeyFor(el) {
    return (el.getAttribute && el.getAttribute('data-help')) || el.id ||
      ('c:' + String(el.className || '').trim().split(/\s+/)[0]);
  }

  /** Which pop-ups are open right now, by identity. */
  function openOverlays() {
    var out = {};
    var nodes = doc.querySelectorAll(OVERLAY_SEL);
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!pickableFrom(el)) continue;              // the editor is not the subject
      var r = el.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;  // a sliver is not a pop-up
      if (r.right <= 4 || r.left >= (global.innerWidth || 0) - 4) continue; // parked off-canvas
      out[overlayKeyFor(el)] = el;
    }
    return out;
  }

  function openerKeyFor(identity) {
    for (var i = 0; i < OPENER_HINTS.length; i++) {
      if (OPENER_HINTS[i][0].test(identity)) return OPENER_HINTS[i][1];
    }
    return null;
  }

  function startRecording() {
    if (W.recording) return stopRecording();
    if (global.OpalInduction) global.OpalInduction.close();
    stopPicking();
    W.recording = { steps: [], inside: null };

    var banner = doc.createElement('div');
    banner.className = 'wk-rec-banner';
    banner.innerHTML = '<span class="wk-rec-dot" aria-hidden="true"></span>' +
      '<span id="wk-rec-count">Recording — use the portal. Nothing captured yet.</span>' +
      '<button type="button" class="wk-btn wk-btn-quiet" id="wk-rec-stop">Stop</button>';
    doc.body.appendChild(banner);
    banner.querySelector('#wk-rec-stop').onclick = stopRecording;
    W.recording.banner = banner;

    doc.addEventListener('click', onRecordClick, true);
    doc.addEventListener('keydown', onRecordKey, true);
    renderDock();
  }

  function onRecordKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); cancelRecording(); }
  }

  function currentTab() {
    var active = doc.querySelector('.tab.active[data-tab]');
    return active ? active.getAttribute('data-tab') : null;
  }

  function onRecordClick(e) {
    if (!W.recording) return;
    var el = e.target;
    // The dock, the banner and the shelf are the tools, not the subject.
    if (!pickableFrom(el)) return;
    if (W.recording.steps.length >= RECORD_CAP) return;

    var target = selectorFor(el);
    if (!target) return;

    var last = W.recording.steps[W.recording.steps.length - 1];
    if (last && last.target === target) return; // a double-click is one step

    var label = String(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    var step = {
      type: 'highlight',
      title: label || 'This control',
      body: 'Say what this step shows.',
      target: target,
    };
    var tab = currentTab();
    if (tab) step.route = { tab: tab };
    // Still inside the pop-up the last click opened? Then say so, if it is one
    // the player can open by itself. Without this, a learner who resumes on
    // this step gets a spotlight with nothing under it.
    if (W.recording.inside && !isInsideOverlay(el, W.recording.inside)) W.recording.inside = null;
    if (W.recording.inside && W.recording.inside.opener) {
      step.route = step.route || {};
      step.route.open = W.recording.inside.opener;
    }
    W.recording.steps.push(step);
    updateRecordCount();

    // Did this click OPEN something? The listener runs in the capture phase,
    // before the page reacts, so the comparison has to wait for the reaction.
    // This is the whole reason a recorded tour used to walk to a button that
    // opens a pop-up, point at it, and move on with the pop-up never opening.
    var before = openOverlays();
    global.setTimeout(function () {
      if (!W.recording || W.recording.steps.indexOf(step) === -1) return;
      var after = openOverlays();
      var appeared = Object.keys(after).filter(function (k) { return !before[k]; });
      if (!appeared.length) return;

      var identity = appeared[0];
      if (RECORD_NO_CLICK.test(target)) {
        // A control that sends or deletes is never clicked through. Say what
        // it opens; do not make a learner press it.
        step.body = 'Say what this control does. It opens something, but a learner is not asked ' +
                    'to press it here.';
      } else {
        step.type = 'action';
        step.advance = 'click';
        step.body = 'Say what to click. The walkthrough waits until they do.';
      }
      W.recording.inside = { key: identity, el: after[identity], opener: openerKeyFor(identity) };
      updateRecordCount();
    }, 450);
  }

  function isInsideOverlay(el, inside) {
    if (!inside || !inside.el || !doc.contains(inside.el)) return false;
    return inside.el.contains(el);
  }

  function updateRecordCount() {
    var count = doc.getElementById('wk-rec-count');
    if (!count || !W.recording) return;
    var n = W.recording.steps.length;
    var opens = W.recording.steps.filter(function (s) { return s.advance === 'click'; }).length;
    count.textContent = 'Recording — ' + n + ' step' + (n === 1 ? '' : 's') + ' captured' +
      (opens ? (', ' + opens + ' that open something') : '') + '.';
  }

  function teardownRecording() {
    if (!W.recording) return null;
    doc.removeEventListener('click', onRecordClick, true);
    doc.removeEventListener('keydown', onRecordKey, true);
    if (W.recording.banner) W.recording.banner.remove();
    var steps = W.recording.steps;
    W.recording = null;
    return steps;
  }

  function cancelRecording() {
    teardownRecording();
    renderDock();
    toast('Recording discarded', 'Nothing was added.');
  }

  function stopRecording() {
    var steps = teardownRecording();
    if (!steps) return;
    if (!steps.length) { renderDock(); toast('Nothing captured', 'No controls were clicked.'); return; }
    // Recorded steps land AFTER the step that was selected, so a recording
    // extends a walkthrough where the author was working rather than at the end.
    var at = W.idx + 1;
    W.steps.splice.apply(W.steps, [at, 0].concat(steps));
    W.idx = at;
    W.dirty = true;
    renderDock();
    playCurrent();
    toast('Captured', steps.length + ' steps added — now write what each one says.');
  }

  // ── Public surface ────────────────────────────────────────────────────────

  global.OpalWorkshop = {
    open: open,
    closeShelf: closeShelf,
    seed: seed,
    createNew: createNew,
    cancelNew: cancelNew,
    edit: edit,
    closeDock: closeDock,
    duplicate: duplicate,
    archive: archive,
    unarchive: unarchive,
    remove: remove,
    select: select,
    move: move,
    addStep: addStep,
    removeStep: removeStep,
    togglePalette: togglePalette,
    pickTarget: pickTarget,
    report: report,
    dismissReport: dismissReport,
    startRecording: startRecording,
    stopRecording: stopRecording,
    cancelRecording: cancelRecording,
    playCurrent: playCurrent,
    previewAsLearner: previewAsLearner,
    save: save,
    _meta: _meta,
    _step: _step,
    _target: _target,
    _advance: _advance,
    _image: _image,
    _stepRole: _stepRole,
    _quiz: _quiz,
    _quizOption: _quizOption,
    _quizAdd: _quizAdd,
    _quizRemove: _quizRemove,
    _state: W,
  };

})(typeof window !== 'undefined' ? window : this);
