/* ═══════════════════════════════════════════════════════════════════════════
   OPAL RESOURCE HUB — R2 (Learning, Knowledge, Standards & Clinical Excellence)
   Renders the whole R2 experience into #rh2-root (inside the "Hub" panel of
   the Resources tab). Client-side sub-navigation over the /api/rh2/* module.

   Conventions (mirrors scheduler.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - one state object + one render() per view
     - backend enforces all RBAC; the client only hides what a role cannot use
     - no modals: confirmations and forms are inline panels
     - markdown-ish content rendered by a tiny safe renderer (escape first,
       then a whitelist of transforms — no raw HTML passthrough, ever)
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

  // Tolerant field access: canonical snake_case, camelCase fallback.
  function pick(o, k) {
    if (!o) return undefined;
    if (o[k] !== undefined && o[k] !== null) return o[k];
    var c = k.replace(/_([a-z])/g, function (_, x) { return x.toUpperCase(); });
    return o[c];
  }

  function icn(name, fallback, size) {
    if (typeof global.opIcon !== 'function') return '';
    var ok = global.OP_ICONS && global.OP_ICONS[name];
    return global.opIcon(ok ? name : (fallback || 'book'), size || 14);
  }

  function user() { return global.APP_USER || {}; }
  function role() { return String(user().role || ''); }
  function isOwner() { return role() === 'owner'; }
  function isAdminRole() { return role() === 'admin'; }
  function canAdmin() { return isOwner() || isAdminRole(); }
  function canWrite() { return role() !== 'read_only'; }
  // Governance reviewers, matching resource-governance.js REVIEW_ROLES. The
  // server enforces this; hiding the controls just avoids offering a therapist
  // a button that would 403.
  function canReview() { return isOwner() || isAdminRole(); }
  // Mirrors CATALOGUE_ROLES in backend/assessments-routes.js — every signed-in
  // role may READ the assessment catalogue. The comment this replaces described
  // the old register endpoint, which read_only genuinely could not see; the
  // catalogue that replaced it admits them, and hiding the tab invented a
  // restriction the server does not make. Being able to look is not being able
  // to act: canAdministerAssessment() below is what gates every button.
  function canSeeInstruments() {
    return isOwner() || isAdminRole() || role() === 'therapist' || role() === 'read_only';
  }

  /**
   * Who may actually administer an assessment. CLINICAL_ROLES on the server
   * (backend/assessments-routes.js) is therapist|owner, and /api/fca/clients
   * refuses admin outright, so offering either of the other roles a "Start
   * assessment" button produces a client picker that 403s on the first
   * keystroke. Availability says whether the INSTRUMENT can be administered;
   * it says nothing about whether THIS user may. Both have to hold.
   */
  function canAdministerAssessment() { return isOwner() || role() === 'therapist'; }

  /**
   * Who sees Templates. Mirrors requireTemplateRead in backend/templates-routes.js,
   * which is itself the FCA's clinical read guard: therapist and owner may
   * complete a document, read_only may look, and ADMIN IS EXCLUDED — a template
   * resolves client data, and /api/templates refuses admin exactly as /api/fca
   * does. Showing admin the tab would offer a screen that 403s on open.
   */
  function canUseTemplates() {
    return isOwner() || role() === 'therapist' || role() === 'read_only';
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDateTime(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) +
      ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }

  /**
   * The same instant as two separately renderable parts.
   *
   * PD listings put the date and the time on their own lines in a fixed-width
   * column, which only aligns if the two are separate strings — a single
   * "Wed, 3 Sep, 9:00 am" wraps at whatever point the column width happens to
   * fall, which is what made the rows read as one run-on block.
   *
   * An unparseable value keeps its raw text in `date` so nothing is lost.
   */
  function fmtDateParts(v) {
    if (!v) return { date: '', time: '' };
    var d = new Date(v);
    if (isNaN(d.getTime())) return { date: String(v), time: '' };
    return {
      date: d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }),
      time: d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }),
    };
  }

  /** Spoken form of a date/time, for an accessible name. */
  function whenLabel(parts) {
    if (!parts.date) return '';
    return parts.date + (parts.time ? ' at ' + parts.time : '');
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
      // `error` is the machine code ('forbidden', 'no_organisation'); `message`
      // is the sentence the server wrote for a person to read. Preferring the
      // code put things like "forbidden" and "not_found" on screen as if they
      // were an explanation. The code is kept alongside so nothing is lost.
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

  function toast(title, msg) {
    if (typeof global.showToast === 'function') global.showToast(title, msg);
  }

  // ── Safe markdown-ish renderer ────────────────────────────────────────────
  // Escape EVERYTHING first, then apply a small whitelist of transforms on the
  // escaped text: ## headings, **bold**, - bullets, numbered lists,
  // [text](https://…) links (http/https only) and blank-line paragraphs.

  function mdInline(escaped) {
    var out = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    return out;
  }

  function mdRender(text) {
    if (!text) return '';
    var lines = esc(String(text).replace(/\r\n?/g, '\n')).split('\n');
    var html = [], para = [], list = null; // list: {kind:'ul'|'ol', items:[]}

    function flushPara() {
      if (para.length) { html.push('<p>' + mdInline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (list) {
        html.push('<' + list.kind + '>' + list.items.map(function (it) {
          return '<li>' + mdInline(it) + '</li>';
        }).join('') + '</' + list.kind + '>');
        list = null;
      }
    }

    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var trimmed = ln.trim();
      if (!trimmed) { flushPara(); flushList(); continue; }
      var h = trimmed.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        var lvl = Math.min(h[1].length + 1, 5); // # → h2, ## → h3, ### → h4
        html.push('<h' + lvl + '>' + mdInline(h[2]) + '</h' + lvl + '>');
        continue;
      }
      var bullet = trimmed.match(/^-\s+(.*)$/);
      if (bullet) {
        flushPara();
        if (!list || list.kind !== 'ul') { flushList(); list = { kind: 'ul', items: [] }; }
        list.items.push(bullet[1]);
        continue;
      }
      var num = trimmed.match(/^\d+[.)]\s+(.*)$/);
      if (num) {
        flushPara();
        if (!list || list.kind !== 'ol') { flushList(); list = { kind: 'ol', items: [] }; }
        list.items.push(num[1]);
        continue;
      }
      flushList();
      para.push(trimmed);
    }
    flushPara(); flushList();
    return html.join('');
  }

  // ── Vocabulary ────────────────────────────────────────────────────────────

  // Canonical content-type vocabulary — matches the backend/seed exactly.
  var CONTENT_TYPES = [
    ['article', 'Article'], ['clinical_guide', 'Clinical guide'], ['policy', 'Policy'],
    ['standard', 'Standard'], ['tutorial', 'Tutorial'], ['checklist', 'Checklist'],
    ['template', 'Template'], ['download', 'Download'], ['external_link', 'External link'],
    ['video', 'Video'], ['course', 'Course'], ['pd_event', 'PD event'],
    ['regulatory_update', 'Regulatory update'], ['ndis_guide', 'NDIS guide'],
    ['starter_kit', 'Starter kit'], ['learning_module', 'Learning module'],
  ];
  function typeLabel(t) {
    for (var i = 0; i < CONTENT_TYPES.length; i++) if (CONTENT_TYPES[i][0] === t) return CONTENT_TYPES[i][1];
    return t ? String(t).replace(/_/g, ' ') : 'Resource';
  }

  var AUTHORITY = {
    internal:            { label: 'Opal',              cls: 'opal' },
    opal_approved:       { label: 'Opal approved',     cls: 'opal' },
    official_regulatory: { label: 'Official',          cls: 'official', full: 'Official Regulatory Source' },
    professional_body:   { label: 'Professional Body', cls: 'profbody' },
    external_reference:  { label: 'External',          cls: 'external' },
  };
  /* ── Two badges, two questions ──────────────────────────────────────────────
     WHO WROTE THIS?  and  IS IT APPROVED?  are independent, and the old single
     "Opal Approved" badge answered them as one — which meant workflow status
     could manufacture an authorship claim, and an unrecognised authority level
     silently inherited the Opal badge. They are now separate functions that
     share no inputs.

     Neither may be derived from legacy `status`. A record can carry
     status='approved' from before governance existed while failing every gate
     the word now implies, so approval comes from the server's approval_ready
     and publication only ever from publication_state === 'published'. */

  // ── 1. Source: who authored the work ──────────────────────────────────────
  function sourceBadge(r, opts) {
    var cls = pick(r, 'source_class');
    var publisher = String(pick(r, 'source_publisher') || '').trim();
    var admin = !!(opts && opts.admin);

    if (cls === 'opal-original') {
      return '<span class="rh2-auth rh2-auth-opal">Opal Therapy</span>';
    }
    // Unclassified: say nothing on an ordinary card rather than guess. The
    // prompt to classify belongs in admin and detail views, not in front of
    // someone browsing for a worksheet.
    if (!cls || cls === 'unknown') {
      return admin ? '<span class="rh2-auth rh2-auth-external">Source review pending</span>' : '';
    }
    var known = AUTHORITY[pick(r, 'authority_level')];
    var kind = (known && known.cls !== 'opal') ? known.cls : 'external';
    var label = publisher
      || (cls === 'government-official' ? 'Official guidance'
        : cls === 'standardised-instrument' ? 'Standardised instrument' : 'Third party');
    return '<span class="rh2-auth rh2-auth-' + kind + '">' + esc(label) + '</span>';
  }

  // ── 2. Governance: has it passed the gates? ───────────────────────────────
  function governanceBadge(r) {
    if (pick(r, 'publication_state') === 'published') {
      return '<span class="rh2-gov rh2-gov-published">Published</span>';
    }
    // approval_ready is the server's verdict from the same approvalBlockers()
    // the approve route enforces. Absent or false means no badge at all — an
    // unapproved resource simply carries none.
    if (pick(r, 'publication_state') === 'approved' && pick(r, 'approval_ready') === true) {
      return '<span class="rh2-gov rh2-gov-approved">Approved</span>';
    }
    return '';
  }

  function badges(r, opts) {
    return sourceBadge(r, opts) + governanceBadge(r);
  }

  /* These lists mirror the server's controlled vocabulary
     (resource-hub-r2-routes.js CLINICAL_POPULATIONS / CLINICAL_SETTINGS) — the
     server validates every selection, so an option that is not in its list is
     rejected rather than quietly matching nothing.

     'Unclassified' is listed FIRST and deliberately: no resource in the
     catalogue carries a clinical population or setting yet, so it is the only
     selection that currently returns anything. Offering the four age bands
     alone would be a filter that always says "no results" — the exact thing
     these controls used to do. The counts appended at render time say plainly
     how many records are in each state. */
  var POPULATIONS = [['unclassified', 'Unclassified'], ['paediatric', 'Paediatric'], ['adolescent', 'Adolescent'], ['adult', 'Adult'], ['older_adult', 'Older adult']];
  var SETTINGS = [['unclassified', 'Unclassified'], ['clinic', 'Clinic'], ['school', 'School'], ['home', 'Home'], ['telehealth', 'Telehealth'], ['community', 'Community']];
  // Sort keys match the GET /api/rh2/resources contract exactly.
  var SORTS = [['relevant', 'Most relevant'], ['updated', 'Recently updated'], ['az', 'Title A to Z'], ['popular', 'Most popular']];

  var TYPE_ICONS = {
    policy: 'lock', standard: 'lock', regulatory_update: 'lock',
    clinical_guide: 'book', ndis_guide: 'doc', article: 'doc', tutorial: 'spark',
    learning_module: 'book', course: 'book', starter_kit: 'book',
    template: 'doc', checklist: 'check', download: 'doc',
    external_link: 'forward', video: 'forward', pd_event: 'spark',
  };

  // ── State ─────────────────────────────────────────────────────────────────

  var S = {
    booted: false,
    clinicalCounts: null,
    assess: null,
    sourceReview: { data: null, loading: false, err: '', q: '', offset: 0, limit: 25 },
    // Assessments. `openKey` is the information page for one assessment —
    // a sub-view of this one, addressable as #resources/instruments/<key>.
    instruments: {
      data: null, loading: false, err: '',
      openKey: null, detail: null, detailLoading: false, detailErr: '',
    },
    pd: {
      data: null, loading: false, err: '', when: 'upcoming',
      q: '', mode: '', topic: '', cost: '', cpd: '',
      offset: 0, limit: 50, facets: null,
      // Detail is a sub-view of the same page: null = list, id = that event.
      openId: null, detail: null, detailLoading: false, detailErr: '',
    },
    view: 'home', // home | library | detail | learning | assignment | admin
    topics: null, // therapy_area tags [{id,name}]
    costs: null,  // cost tags (Free/Paid) [{id,name}]
    home: null, homeLoading: false,
    // Owner-assigned learning (my own assignments; every role has these).
    myl: { rows: null, loading: false, err: '' },
    // The induction experience in read mode. preview=true is the Owner's
    // read-only twin: nothing is posted, completion is simulated locally.
    // `step` is the cursor into the section flow (0 = overview).
    assignment: {
      id: null, data: null, loading: false, err: '', backView: 'learning',
      step: 0, quizAnswers: {}, quizResult: null, ackArmed: false,
      busy: false, preview: false, previewDone: {}, celebrate: false,
    },
    // Owner learning console (Admin → Learning). Sub-tabs: library |
    // assignments | staff. `editor` is the workflow being edited (deep copy —
    // Save posts it back); `assign` is the assign panel state.
    la: {
      tab: 'library', loading: false, err: '',
      workflows: null, includeArchived: false, categories: null,
      editor: null, editorErr: '', editorSaving: false,
      preview: null,
      assign: null, // { wfId, wfTitle, q, selected:{}, dueAt, note, mandatory, priority, busy, err, done }
      importing: false, importNote: '', // bringing existing inductions in
      create: null, // the New learning item dialog: { title, category, busy, err }
      staff: null, staffErr: '', staffLoading: false,
      assignments: null, afStatus: '', afWorkflow: '', afUser: '', afQ: '',
      openAssignment: null, openData: null, openLoading: false,
      resPick: null, // resource picker inside the editor: { q, rows, loading, forItem }
    },
    // Owner-only: the Assign Learning catalogue search. There is no
    // collection cursor — the catalogue is one unified list.
    asl: { q: '' },
    // The Library. `folders`/`folderId` are the semantic shelving added in
    // migration 039; everything else is the flat-list state it was before, and
    // is still used unchanged by Saved, All Resources and every search.
    lib: {
      q: '', kind: '', type: '', topic: '', cost: '', population: '', setting: '', authority: '',
      sort: 'relevant', saved: false, rows: null, loading: false, offset: 0, hasMore: false, loadingMore: false,
      browse: 'folders', folders: null, foldersLoading: false, foldersErr: '', organised: false,
      totalResources: 0, folderId: '', folderMeta: null, folderSearch: false,
      orgErr: '', busy: '',
      selMode: false, sel: {}, moveOpen: false, moveErr: '', moveNote: '', folderForm: null,
      // Uploading, right-click and renaming.
      uploads: null, dropTarget: '', wsDrop: false, menu: null, renaming: null,
    },
    detail: { id: null, data: null, loading: false, ackConfirm: false, fbKind: '', fbDone: false, showVersions: false, quizResult: null, backView: 'home', files: null, filesLoading: false, filesErr: '' },
    learning: { data: null, loading: false, cpdOpen: false, cpd: null, pd: null, pdPastOpen: false },
    admin: {
      tab: 'content', status: '', q: '', list: null, loading: false,
      editing: null, // resource being edited (object) or {} for new
      formOpen: false,
      // Set only by RH2.libNewDocument: the Library folder a new resource
      // should be filed into once it saves. Cleared the moment it is used or
      // the form is abandoned, so it can never attach itself to an unrelated
      // resource authored later in the same session.
      fileInto: '', fileIntoName: '',
      sources: null, pd: null, pdEditing: null, feedback: null, links: null, analytics: null,
      induction: null, // owner/admin induction-completion overview
      // Ingestion register: the 650-record source-vault accounting.
      ing: null, ingRecords: null, ingTreatment: '', ingLoading: false, ingCleanroom: null,
      err: '',
    },
  };

  var libDebounce = null;
  var srDebounce = null;

  // ── Root render ───────────────────────────────────────────────────────────

  function root() { return doc.getElementById('rh2-root'); }

  function render() {
    var host = root();
    if (!host) return;

    /* Every render replaces the whole subtree, which destroys whatever the
       user was typing into. Remember the focused field and its caret, and put
       both back afterwards.

       Without this, the client search in the Assessments panel was unusable:
       the first keystroke tore out its own <input>, focus fell to <body>, and
       the second keystroke went nowhere — so the two-character minimum could
       never be reached by typing. The library, PD and source-review searches
       lost focus the same way whenever their debounce fired. */
    var prev = doc.activeElement;
    var focusId = (prev && prev.id && host.contains(prev)) ? prev.id : '';
    var selStart = null;
    var selEnd = null;
    if (focusId) {
      try { selStart = prev.selectionStart; selEnd = prev.selectionEnd; } catch (e) { /* not a text field */ }
    }

    var body = '';
    if (S.view === 'home') body = renderHome();
    else if (S.view === 'library') body = renderLibrary();
    else if (S.view === 'detail') body = renderDetail();
    else if (S.view === 'learning') body = isOwner() ? renderAssignLearning() : renderLearning();
    else if (S.view === 'assignment') body = renderAssignment();
    // Templates renders nothing here on purpose: resourcehub.js rebuilds this
    // subtree wholesale on every keystroke, which would tear out a form the
    // user is typing into. The surface lives in #templates-root, a sibling
    // mount templates.js owns and this file never touches.
    else if (S.view === 'templates') body = '';
    else if (S.view === 'pd') body = renderPd();
    else if (S.view === 'instruments') body = renderInstruments();
    else if (S.view === 'admin') body = renderAdmin();
    host.innerHTML = renderNav() + body;

    if (focusId) {
      var next = doc.getElementById(focusId);
      if (next) {
        try { next.focus({ preventScroll: true }); } catch (e) { try { next.focus(); } catch (e2) { /* gone */ } }
        // setSelectionRange throws on some input types (search, email, number);
        // losing the caret position is survivable, losing focus is not.
        if (selStart !== null && selStart !== undefined) {
          try { next.setSelectionRange(selStart, selEnd); } catch (e3) { /* unsupported type */ }
        }
      }
    }
    // Publish the current surface so sibling modules (the FCA and letter
    // builders, which mount outside #rh2-root) can show their entry cards on
    // the right screen without parsing our markup.
    host.dataset.view = S.view;
    host.dataset.collection = (S.view === 'library' && S.lib && S.lib.collection) ? S.lib.collection : '';
  }

  function renderNav() {
    // The same route, a different job. An Owner manages and assigns the
    // library; everybody else works through their own. Renaming only the label
    // keeps every existing link, bookmark and notification target working.
    var items = [
      ['home', 'Home'], ['library', 'Library'], ['saved', 'Saved'],
      ['learning', isOwner() ? 'Assign Learning' : 'My Learning'],
    ];
    // The instrument register is clinical reference material, so it belongs in
    // the hub proper rather than behind Admin. It was previously only reachable
    // from the admin area, which hid it from the therapists who actually
    // administer these assessments.
    // Templates sits between learning and PD: it is day-to-day document work,
    // not reference material. It is a destination of its own rather than a
    // Library collection — templates.js owns the surface, mounted outside
    // #rh2-root for the same reason the FCA and letter builders are.
    if (canUseTemplates()) items.push(['templates', 'Templates']);
    items.push(['pd', 'Professional development']);
    if (canSeeInstruments()) items.push(['instruments', 'Assessments']);
    if (canAdmin()) items.push(['admin', 'Admin']);
    var active = S.view === 'detail' ? 'library' : S.view;
    if (S.view === 'assignment') active = 'learning';
    if (S.view === 'library') active = S.lib.saved ? 'saved' : 'library';
    return '<nav class="rh2-nav" aria-label="Resource Hub sections">' + items.map(function (it) {
      return '<button type="button" class="rh2-nav-btn' + (active === it[0] ? ' active' : '') +
        '" onclick="RH2.nav(\'' + it[0] + '\')" aria-current="' + (active === it[0] ? 'true' : 'false') + '">' + it[1] + '</button>';
    }).join('') + '</nav>';
  }

  function nav(view) {
    // 'Saved' is the library filtered to the user's favourites — entering it
    // clears other filters so the saved list is never silently narrowed.
    if (view === 'saved') {
      // Clear the QUESTION, keep the STRUCTURE. Rebuilding S.lib wholesale
      // here used to be harmless; it now discards the loaded folder tree and
      // the run status, so Saved would blank the folders behind it.
      Object.assign(S.lib, {
        q: '', kind: '', type: '', topic: '', cost: '', population: '', setting: '', authority: '',
        sort: 'relevant', saved: true, rows: null, loading: false, offset: 0, hasMore: false,
        folderId: '', folderMeta: null, folderSearch: false, browse: 'folders',
        selMode: false, sel: {}, moveOpen: false, folderForm: null,
        menu: null, renaming: null, uploads: null, dropTarget: '', wsDrop: false,
      });
      view = 'library';
    } else if (view === 'library' && S.lib.saved) {
      S.lib.saved = false;
      S.lib.rows = null;
    }
    // 'assignment' is only addressable with an id: re-enter the one that is
    // open (or the Owner preview that is open), otherwise degrade to
    // My Learning rather than an empty player.
    if (view === 'assignment') {
      if (S.assignment.preview && S.assignment.previewWfId) return laPreview(S.assignment.previewWfId);
      if (S.assignment.id) return openAssignment(S.assignment.id);
      view = 'learning';
    }
    // The workflow editor has an address of its own ('lwedit/<id>', see
    // navigation.js) but it is not a view: it renders over the Learning
    // console. Navigating anywhere else — Back included — must close it,
    // otherwise the editor stays on screen and Back appears to do nothing.
    // An unsaved editor asks first; declining keeps the editor and the view.
    if (view === 'lwedit') {
      if (S.la.editor) return;
      view = 'learning';
    } else if (S.la.editor) {
      if (S.la.editor._dirty && !confirm('Discard unsaved changes to this workflow?')) return;
      S.la.editor = null;
      S.la.resPick = null;
      S.la.publishNote = '';
      S.la.editorStale = false;
    }
    S.view = view;
    if (view === 'home' && !S.home) loadHome();
    if (view === 'library') {
      if (!S.lib.rows) loadLibrary();
      loadFolders();
    }
    if (view === 'learning') {
      if (isOwner()) {
        // The library and the staff list; Home supplies the PD panel.
        loadLa();
        if (!S.home && !S.homeLoading) loadHome();
      } else {
        loadLearning();
        loadMyLearning();
      }
    }
    if (view === 'pd') { S.pd.openId = null; if (!S.pd.data) loadPd(); }
    if (view === 'instruments') {
      // Navigating to the section always lands on the catalogue, never on the
      // information page that happened to be open last time.
      S.instruments.openKey = null;
      S.instruments.detail = null;
      if (!S.instruments.data) loadInstruments();
    }
    if (view === 'admin') loadAdminTab();
    render();
  }

  // ── HOME ──────────────────────────────────────────────────────────────────

  async function loadHome() {
    if (S.homeLoading) return;
    S.homeLoading = true;
    var d = await api('/api/rh2/home');
    S.homeLoading = false;
    S.home = d.ok ? d : { ok: false, error: d.error };
    render();
  }

  function skel(n, h) {
    var out = '';
    for (var i = 0; i < n; i++) out += '<div class="rh2-skel" style="height:' + (h || 44) + 'px;"></div>';
    return out;
  }

  function homeResRow(r, extraChip) {
    var mins = pick(r, 'estimated_minutes');
    return '<button type="button" class="rh2-row" onclick="RH2.openDetail(\'' + esc(pick(r, 'id')) + '\',\'home\')">' +
      '<span class="rh2-row-icn">' + icn(TYPE_ICONS[pick(r, 'content_type')] || 'doc') + '</span>' +
      '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(pick(r, 'title')) + '</span>' +
      '<span class="rh2-row-sub">' + esc(typeLabel(pick(r, 'content_type'))) +
      (mins ? ' · ' + esc(mins) + ' min' : '') + '</span></span>' +
      (extraChip || '') + '</button>';
  }

  function renderHome() {
    var h = S.home;
    var out = '<div class="rh2-page">' +
      '<header class="rh2-hero">' +
      '<p class="rh2-tagline">Everything you need to work, learn and grow at Opal.</p>' +
      '<div class="rh2-hero-search">' + icn('search', 'search', 16) +
      '<input type="search" id="rh2-home-search" placeholder="Search resources, policies, tutorials, NDIS guidance..." ' +
      'aria-label="Search the resource hub" onkeydown="if(event.key===\'Enter\')RH2.homeSearch(this.value)">' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.homeSearch(document.getElementById(\'rh2-home-search\').value)">Search</button>' +
      '</div></header>';

    if (!h) {
      out += '<div class="rh2-grid-2">' +
        '<section class="rh2-card">' + skel(3) + '</section><section class="rh2-card">' + skel(3) + '</section></div>' +
        '<section class="rh2-card">' + skel(2, 64) + '</section></div>';
      if (!S.homeLoading) loadHome();
      return out;
    }
    if (!h.ok) {
      return out + '<div class="rh2-empty">' + esc(h.error || 'The Resource Hub could not be loaded.') +
        ' <button type="button" class="rh2-btn" onclick="RH2.reloadHome()">Retry</button></div></div>';
    }

    // Induction teaser: while the user's induction is incomplete, Home leads
    // with "continue where you left off". typeof-guarded bridge.
    if (typeof global.OpalInduction !== 'undefined' && global.OpalInduction.homeCardHtml) {
      out += global.OpalInduction.homeCardHtml();
    }

    var cont = pick(h, 'continue_learning') || pick(h, 'continueLearning') || [];
    var required = pick(h, 'required_for_you') || pick(h, 'requiredForYou') || pick(h, 'required') || [];
    var pd = pick(h, 'upcoming_pd') || pick(h, 'upcomingPd') || [];
    var links = pick(h, 'quick_links') || pick(h, 'quickLinks') || [];
    var recent = pick(h, 'recently_added') || pick(h, 'recentlyAdded') || [];

    /* CONTINUE LEARNING + REQUIRED FOR YOU — staff only.
       Both are a personal record, and an Owner does not have one: they assign
       the work rather than complete it. The panels are not rendered at all for
       an owner, so there is no empty card, no orphaned heading and nothing a
       stylesheet could bring back. The grid below opens only when they do,
       which is what keeps the layout from leaving a hole. */
    if (!isOwner()) {
      out += '<div class="rh2-grid-2">';
      out += '<section class="rh2-card" aria-labelledby="rh2-h-cont"><h2 id="rh2-h-cont">Continue learning</h2>';
      if (!cont.length) out += '<p class="rh2-quiet">Nothing in progress — explore the Library or open My Learning to start a path.</p>';
      else out += cont.map(function (p) {
        var done = Number(pick(p, 'completed') || 0), total = Number(pick(p, 'total') || 0);
        var pct = pick(p, 'percent');
        if (pct == null) pct = total ? Math.round(done / total * 100) : 0;
        return '<div class="rh2-cont"><div class="rh2-cont-main">' +
          '<div class="rh2-cont-name">' + esc(pick(p, 'name')) + '</div>' +
          '<div class="rh2-row-sub">' + done + ' of ' + total + ' complete</div>' +
          '<div class="rh2-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100">' +
          '<span style="width:' + Math.max(0, Math.min(100, pct)) + '%"></span></div></div>' +
          '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.nav(\'learning\')">Continue</button></div>';
      }).join('');
      out += '</section>';

      out += '<section class="rh2-card" aria-labelledby="rh2-h-req"><h2 id="rh2-h-req">Required for you</h2>';
      if (!required.length) out += '<p class="rh2-quiet">You are up to date — nothing outstanding.</p>';
      else out += required.map(function (r) {
        var chip = pick(r, 'acknowledgement_required')
          ? '<span class="rh2-chip rh2-chip-warn">Acknowledgement required</span>'
          : '<span class="rh2-chip">Required</span>';
        return homeResRow(r, chip);
      }).join('');
      out += '</section></div>';
    }

    // Upcoming PD + Quick links + Recently added
    out += '<div class="rh2-grid-2">';
    /* The heading is the way into the full catalogue, and each row opens that
       event. Both are real buttons rather than clickable divs, so they are
       reachable by keyboard and announced as controls without extra ARIA. */
    /* aria-labelledby points at the PLAIN heading text, not at the whole <h2>.
       Naming the region from the h2 subtree pulled in the visually-hidden
       button hint, so the landmark announced as "Upcoming professional
       development — open the professional development page". The button keeps
       the hint, because on the button it is accurate and useful. */
    out += '<section class="rh2-card rh2-pd-preview" aria-labelledby="rh2-h-pd">'
      + '<h2 class="rh2-h-link">'
      + '<button type="button" class="rh2-heading-btn" onclick="RH2.nav(\'pd\')">'
      + '<span id="rh2-h-pd">Upcoming professional development</span>'
      + '<span class="rh2-heading-more" aria-hidden="true">&rsaquo;</span>'
      + '<span class="rh2-visually-hidden"> — open the professional development page</span>'
      + '</button></h2>';
    if (!pd.length) out += '<p class="rh2-quiet">No upcoming PD events listed.</p>';
    /* One row per event: a fixed-width date/time block, then the title as the
       primary line with provider and CPD hours beneath it. The date lives in
       its own column so it can never wrap into the title — which is what made
       the previous rows read as a single undifferentiated block. */
    else out += '<ul class="rh2-pdp-list">' + pd.slice(0, 5).map(function (e) {
      var hours = pick(e, 'cpd_hours');
      var title = pick(e, 'title');
      var provider = pick(e, 'provider') || '';
      var when = fmtDateParts(pick(e, 'starts_at'));
      var spoken = whenLabel(when);
      // The accessible name carries what the visual row conveys through layout,
      // so a screen-reader user hears the event, not "button".
      var label = title + (provider ? ', ' + provider : '') + (spoken ? ', ' + spoken : '')
        + (hours ? ', ' + hours + ' CPD hours' : '');
      var sub = '';
      if (provider) sub += '<span class="rh2-pdp-provider">' + esc(provider) + '</span>';
      if (hours) {
        sub += '<span class="rh2-pdp-cpd">' + (provider ? '<span aria-hidden="true"> · </span>' : '')
          + esc(hours) + ' CPD hours</span>';
      }
      return '<li class="rh2-pdp-item">'
        + '<button type="button" class="rh2-pdp-row" '
        + 'onclick="RH2.openPd(\'' + esc(pick(e, 'id')) + '\')" '
        + 'aria-label="' + esc(label) + '">'
        + '<span class="rh2-pdp-when" aria-hidden="true">'
        + '<span class="rh2-pdp-date">' + esc(when.date) + '</span>'
        + (when.time ? '<span class="rh2-pdp-time">' + esc(when.time) + '</span>' : '')
        + '</span>'
        + '<span class="rh2-pdp-main">'
        + '<span class="rh2-pdp-title">' + esc(title) + '</span>'
        + (sub ? '<span class="rh2-pdp-sub">' + sub + '</span>' : '')
        + '</span></button></li>';
    }).join('') + '</ul>';
    if (pd.length) {
      out += '<button type="button" class="rh2-btn rh2-pd-all" onclick="RH2.nav(\'pd\')">'
        + 'See all professional development</button>';
    }
    out += '</section>';

    out += '<section class="rh2-card" aria-labelledby="rh2-h-rec"><h2 id="rh2-h-rec">Recently added</h2>';
    if (!recent.length) out += '<p class="rh2-quiet">New resources will appear here.</p>';
    else out += recent.slice(0, 6).map(function (r) { return homeResRow(r); }).join('');
    out += '</section></div>';

    // Quick links — external http(s) links open in a new tab; app-internal
    // '/path' links navigate in place (no target="_blank").
    if (links.length) {
      out += '<section aria-labelledby="rh2-h-ql"><h2 class="rh2-h2" id="rh2-h-ql">Quick links</h2><div class="rh2-links">' +
        links.map(function (l) {
          var url = String(pick(l, 'url') || '');
          var body = icn(pick(l, 'icon'), 'forward') + ' ' + esc(pick(l, 'label'));
          if (/^https?:\/\//i.test(url)) {
            return '<a class="rh2-link-chip" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + body + '</a>';
          }
          if (/^\/(?!\/)/.test(url)) {
            return '<a class="rh2-link-chip" href="' + esc(url) + '">' + body + '</a>';
          }
          return '';
        }).join('') + '</div></section>';
    }

    return out + '</div>';
  }

  function homeSearch(q) {
    S.lib.q = String(q || '').trim();
    S.lib.rows = null;
    nav('library');
  }

  // ── LIBRARY ───────────────────────────────────────────────────────────────

  async function loadTopics() {
    if (S.topics) return;
    var d = await api('/api/resources/tags');
    var all = (d.ok && d.tags) ? d.tags : [];
    S.topics = all.filter(function (t) { return t.category === 'therapy_area'; });
    S.costs = all.filter(function (t) { return t.category === 'cost'; }); // Free, Paid (name order)
  }

  var LIB_PAGE = 48; // divisible by 2/3/4-column grids, under the server's cap

  function libQuery(f, offset) {
    // Param names match the GET /api/rh2/resources contract:
    // contentType, tagId, collectionKey, authority, population, setting,
    // kind, saved, sort (relevant|updated|az|popular), limit, offset.
    var qs = [];
    if (f.q) qs.push('q=' + encodeURIComponent(f.q));
    if (f.kind) qs.push('kind=' + encodeURIComponent(f.kind));
    if (f.type) qs.push('contentType=' + encodeURIComponent(f.type));
    if (f.topic) qs.push('tagId=' + encodeURIComponent(f.topic));
    if (f.cost) qs.push('tagId=' + encodeURIComponent(f.cost)); // repeated tagId params AND together server-side
    if (f.population) qs.push('population=' + encodeURIComponent(f.population));
    if (f.setting) qs.push('setting=' + encodeURIComponent(f.setting));
    if (f.authority) qs.push('authority=' + encodeURIComponent(f.authority));
    if (f.collection) qs.push('collectionKey=' + encodeURIComponent(f.collection));
    if (f.saved) qs.push('saved=1');
    /* Folder scoping is added ONLY when the reader is browsing a folder, or has
       deliberately narrowed a search back to it. A plain search never carries a
       folder, so search keeps spanning the whole library (§21). */
    if (f.folderId && (!libSearching(f) || f.folderSearch)) {
      qs.push('folderId=' + encodeURIComponent(f.folderId));
      qs.push('folderScope=tree');
    }
    if (f.sort) qs.push('sort=' + encodeURIComponent(f.sort));
    qs.push('limit=' + LIB_PAGE);
    if (offset) qs.push('offset=' + offset);
    return '/api/rh2/resources?' + qs.join('&');
  }

  async function loadLibrary() {
    S.lib.loading = true;
    S.lib.offset = 0;
    render();
    await loadTopics();
    var f = S.lib;
    var d = await api(libQuery(f, 0));
    f.loading = false;
    f.rows = d.ok ? (d.resources || []) : [];
    f.hasMore = !!(d.ok && d.hasMore);
    f.error = d.ok ? '' : d.error;
    render();
  }

  /** Append the next page; the earlier cards stay where the reader left them. */
  async function libMore() {
    var f = S.lib;
    if (f.loadingMore || !f.hasMore) return;
    f.loadingMore = true;
    render();
    var next = (f.offset || 0) + LIB_PAGE;
    var d = await api(libQuery(f, next));
    f.loadingMore = false;
    if (d.ok) {
      f.offset = next;
      f.rows = (f.rows || []).concat(d.resources || []);
      f.hasMore = !!d.hasMore;
    }
    render();
  }

  /**
   * Annotate the Unclassified option with how many resources are actually in
   * that state, so the control is self-describing: "Unclassified (168)" tells a
   * staff member immediately that nothing has been classified yet.
   */
  function countedVocab(options, countKey) {
    var counts = S.clinicalCounts;
    if (!counts) return options;
    return options.map(function (o) {
      if (o[0] !== 'unclassified') return o;
      return [o[0], o[1] + ' (' + counts[countKey] + ')'];
    });
  }

  async function loadClinicalVocabulary() {
    var d = await api('/api/rh2/clinical-vocabulary');
    if (!d.ok) return;
    S.clinicalCounts = d.counts || null;
    if (S.view === 'library') render();
  }

  function sel(id, label, options, value, handler) {
    return '<label class="rh2-visually-hidden" for="' + id + '">' + label + '</label>' +
      '<select id="' + id + '" class="rh2-select" onchange="' + handler + '">' +
      '<option value="">' + label + '</option>' +
      options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }

  /* ── Library cards ─────────────────────────────────────────────────────────
     A resource is delivered one of three ways, and the card must say which at
     a glance: a HOSTED document (thumbnail or file-type panel), an EXTERNAL
     resource (domain + outward glyph — it is a signpost, not a broken
     document), or a written GUIDE (in-portal content page). Thumbnails come
     from the authorised derivative route and lazy-load; a card never fetches
     document bytes. */

  function hostname(u) {
    var m = /^https?:\/\/([^/:?#]+)/i.exec(String(u || ''));
    return m ? m[1].replace(/^www\./, '') : '';
  }

  function deliveryKind(r) {
    if (pick(r, 'primary_file_id')) return 'hosted';
    if (pick(r, 'external_url')) return 'external';
    return 'guide';
  }

  function formatChip(fmt) {
    if (!fmt) return '';
    var f = String(fmt).toUpperCase();
    return '<span class="rh2-fmt rh2-fmt-' + esc(String(fmt).toLowerCase()) + '">' + esc(f) + '</span>';
  }

  function cardMedia(r) {
    var kind = deliveryKind(r);
    // Interactive tutorials carry code-owned thumbnails (screenshots of the
    // feature they teach), bridged from the induction registry by slug.
    // typeof-guarded like the OpalSupport bridge — a missing induction
    // module leaves the ordinary type-glyph panel.
    if (pick(r, 'content_type') === 'tutorial' &&
        typeof window.OpalInduction !== 'undefined' && window.OpalInduction.thumbFor) {
      var tuThumb = window.OpalInduction.thumbFor(pick(r, 'slug'));
      if (tuThumb) {
        return '<span class="rh2-card-thumb rh2-thumb-tutorial">'
          + '<img src="' + esc(tuThumb) + '" alt="" loading="lazy" '
          + 'onerror="this.parentNode.className=\'rh2-card-thumb rh2-thumb-type\';this.parentNode.innerHTML=window.opIcon?window.opIcon(\'spark\',14):\'\';">'
          + '</span>';
      }
    }
    // The thumbnail URL is server-supplied, like every file URL in this
    // module — the client never assembles one from ids.
    if (kind === 'hosted' && pick(r, 'primary_file_thumbnail_url')) {
      return '<span class="rh2-card-thumb">'
        + '<img src="' + esc(pick(r, 'primary_file_thumbnail_url')) + '" '
        + 'alt="" loading="lazy" onerror="this.parentNode.className+=\' rh2-thumb-broken\';this.remove();">'
        + formatChip(pick(r, 'primary_file_format')) + '</span>';
    }
    if (kind === 'external') {
      return '<span class="rh2-card-thumb rh2-thumb-ext">' + icn('forward')
        + '<span class="rh2-thumb-domain">' + esc(hostname(pick(r, 'external_url'))) + '</span></span>';
    }
    var glyph = TYPE_ICONS[pick(r, 'content_type')] || 'doc';
    return '<span class="rh2-card-thumb rh2-thumb-type">' + icn(glyph)
      + (kind === 'hosted' ? formatChip(pick(r, 'primary_file_format')) : '') + '</span>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WORKFLOW TOOLS IN THE LIBRARY

     Most library entries are CONTENT: a row in `resources` with a file or a
     body of markdown. A few are WORKFLOWS — a document the portal builds with
     you rather than one you read — and the Service Agreement is the first.

     They belong in the same grid because that is where a person looks for
     them, and they carry a `category` because "Agreements and forms" is how
     somebody describes what they want before they know what it is called.
     They are declared here rather than seeded as resource rows because a
     workflow has no file, no version to review and no governance record — it
     is code, and a `resources` row describing code would need a governance
     lifecycle nobody could complete.

     `collections` and `keywords` are what make them findable: the collection
     puts a tool in the same place as the templates it belongs with, and the
     keywords answer the searches people actually type. `permission` is a
     COURTESY gate only — every one of these opens a surface whose server
     routes enforce their own access.
     ═══════════════════════════════════════════════════════════════════════ */
  var TOOLS = [
    {
      key: 'service-agreement',
      title: 'Service Agreement',
      description: 'Create, complete and issue an Opal Therapy Service Agreement using '
        + 'participant and portal information.',
      category: 'Agreements and forms',
      contentType: 'template',
      collections: ['templates'],
      permission: 'service_agreements.access',
      keywords: [
        'service agreement', 'ndis agreement', 'participant agreement', 'agreement',
        'service booking', 'agreements and forms', 'sign', 'signing', 'consent',
        'schedule of supports', 'ndis',
      ],
      open: function () { if (global.SVA && global.SVA.route) global.SVA.route(''); },
    },
  ];

  /** Tools the signed-in user may see, for the current filters. */
  function toolsFor(f) {
    /* A TOOL IS NOT FILED ANYWHERE, SO IT IS NEVER INSIDE A FOLDER.
       Shelving is `resource_folder_assignments`, which can only hold a
       resource id — a workflow has no row there and no folder it belongs to.
       Offering one inside every folder made each folder show a document it
       does not hold, put the Service Agreement (and, as Templates grows, the
       FCA and Progress Note masters) in front of a reader who had opened
       Handwriting & Motor Skills, and counted those cards in the tally above
       the grid. An empty folder went as far as reporting "1 resource" and
       showing a template instead of saying it was empty.
       They stay on the Library front page, in All Resources, in a search and
       in the Templates collection — every place that is the library rather
       than one shelf of it. */
    if (f && f.folderId) return [];
    // The hub reads the signed-in user from APP_USER, like every other gate
    // in this file. An owner holds every service-agreement permission
    // implicitly (permissions.js), and APP_USER carries the expanded list.
    var perms = user().permissions || [];
    var q = String((f && f.q) || '').trim().toLowerCase();
    return TOOLS.filter(function (t) {
      if (t.permission && perms.indexOf(t.permission) === -1) return false;
      // A collection filter must match, but no collection filter means the
      // whole library — where a tool still belongs.
      if (f && f.collection && t.collections.indexOf(f.collection) === -1) return false;
      if (f && f.type && f.type !== t.contentType) return false;
      // The tag/authority/cost facets describe content governance, which a
      // workflow has none of. Any of them narrows the list to real resources.
      if (f && (f.topic || f.cost || f.population || f.setting || f.authority || f.saved)) return false;
      if (!q) return true;
      var hay = (t.title + ' ' + t.description + ' ' + t.category + ' ' + t.keywords.join(' ')).toLowerCase();
      return hay.indexOf(q) !== -1 || q.split(/\s+/).every(function (w) { return hay.indexOf(w) !== -1; });
    });
  }

  /**
   * A tool rendered as an ordinary library card.
   *
   * Deliberately the same markup, classes and shape as resourceCard() so it
   * reads as a native member of the grid — a person should not have to learn
   * that some cards are a different kind of thing.
   */
  function toolCard(t) {
    return '<button type="button" class="rh2-cardtile rh2-cardtile-tool" '
      + 'onclick="RH2.openTool(\'' + esc(t.key) + '\')">'
      + '<span class="rh2-card-thumb rh2-thumb-type">' + icn('file-text', 'file-text', 16) + '</span>'
      + '<span class="rh2-cardtile-body">'
      + '<span class="rh2-row-title">' + esc(t.title)
      + ' <span class="rh2-chip rh2-chip-tool">Workflow</span></span>'
      + '<span class="rh2-row-sub rh2-clamp">' + esc(t.description) + '</span>'
      + '<span class="rh2-row-meta">' + esc(t.category) + '</span>'
      + '</span></button>';
  }

  function openTool(key) {
    var t = TOOLS.filter(function (x) { return x.key === String(key); })[0];
    if (t) t.open();
  }

  function resourceCard(r, backView) {
    var mins = pick(r, 'estimated_minutes');
    var fresh = pick(r, 'source_verified_at');
    var kind = deliveryKind(r);
    return '<button type="button" class="rh2-cardtile" onclick="RH2.openDetail(\'' + esc(pick(r, 'id')) + '\',\'' + backView + '\')">'
      + cardMedia(r)
      + '<span class="rh2-cardtile-body">'
      + '<span class="rh2-row-title">' + esc(pick(r, 'title'))
      + (pick(r, 'mandatory') ? ' <span class="rh2-chip rh2-chip-warn">Required</span>' : '')
      + (pick(r, 'favourited') ? ' <span class="rh2-fav-star" title="Saved" aria-label="Saved">★</span>' : '')
      + '</span>'
      + (pick(r, 'description') ? '<span class="rh2-row-sub rh2-clamp">' + esc(pick(r, 'description')) + '</span>' : '')
      + '<span class="rh2-row-meta">'
      + esc(kind === 'external' ? 'External resource' : typeLabel(pick(r, 'content_type')))
      + (mins ? ' · ' + esc(mins) + ' min' : '')
      + (fresh ? ' <span class="rh2-fresh" title="Source verified ' + esc(fmtDate(fresh)) + '" aria-label="Source verified ' + esc(fmtDate(fresh)) + '"></span>' : '')
      + '</span>'
      + '<span class="rh2-cardtile-badges">' + badges(r) + '</span>'
      + '</span></button>';
  }

  /* ═══════════════════════════════════════════════════════════════════════
     THE LIBRARY AS FOLDERS

     The Library used to open onto every document at once — six hundred cards
     with a search box above them. Folders replace that first screen, and only
     that first screen: the card, the detail page, the previews, the filters,
     the favourites and the search all still work exactly as they did, because
     a folder here is a place to look rather than a place a file has been moved
     to. Nothing about a resource changes when it is shelved.

     Four things can be on screen, and which one is decided by what the reader
     asked for rather than by a mode they have to set:

       folder grid     the default. Folders, counts, and All Resources.
       folder contents a folder was opened. Breadcrumb, subfolders, resources.
       search results  anything was typed or filtered. Spans the WHOLE library
                       (§21) unless the reader deliberately narrows it back to
                       the folder they were in.
       all resources   the flat list, kept for people who prefer it (§49).

     Owner controls live in the same place as the browsing they affect. There
     is no separate management screen, because the moment somebody notices a
     document is in the wrong folder is the moment they are looking at it.
     ═══════════════════════════════════════════════════════════════════════ */

  /** True when the reader has asked a question, rather than browsing. */
  function libSearching(f) {
    return !!(f.q || f.kind || f.type || f.topic || f.cost || f.population || f.setting || f.authority);
  }

  async function loadFolders(force) {
    var f = S.lib;
    if (f.foldersLoading) return;
    if (f.folders && !force) return;
    f.foldersLoading = true;
    var d = await api('/api/rh2/library/folders');
    f.foldersLoading = false;
    f.folders = (d.ok && d.folders) ? d.folders : [];
    f.totalResources = d.ok ? (d.totalResources || 0) : 0;
    f.organised = !!(d.ok && d.organised);
    f.foldersErr = d.ok ? '' : (d.error || 'Folders could not be loaded.');
    if (S.view === 'library') render();
  }

  /**
   * Everything the Library shows a number for comes from two server reads: the
   * folder grid, and — when one is open — that folder. Anything that changes
   * what is filed invalidates both, so they are refreshed together. Refreshing
   * only the grid was how the card and the folder header came to hold two
   * different figures until the next navigation reconciled them.
   */
  function libRefreshFolders() {
    loadFolders(true);
    if (S.lib.folderId) loadFolderMeta(S.lib.folderId);
  }

  /* ── Uploading ────────────────────────────────────────────────────────────
     Two ways in, one path: drag files onto a folder, or press Upload and pick
     them. Both end up in libUploadFiles, so the two doors cannot behave
     differently.

     Files are read one at a time rather than all at once. A person dropping
     twenty PDFs would otherwise have twenty base64 copies in memory
     simultaneously, and the browser tab is not the place to discover that. */

  var UPLOAD_EXT = ['pdf', 'docx', 'xlsx', 'pptx', 'png', 'jpg', 'jpeg'];
  var UPLOAD_ACCEPT = '.pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg';
  var UPLOAD_MAX = 25 * 1024 * 1024;

  function readAsBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('unreadable')); };
      reader.onload = function () { resolve(String(reader.result).split(',')[1] || ''); };
      reader.readAsDataURL(file);
    });
  }

  /**
   * Send each file to the folder, one after another, reporting as it goes.
   *
   * Rejections are per FILE, not per batch: an Excel sheet with client details
   * in it stops that file and nothing else. The server decides — the checks
   * here only save a round trip on the obvious cases.
   */
  async function libUploadFiles(folderId, fileList) {
    var files = [].slice.call(fileList || []);
    if (!files.length || !folderId) return;

    S.lib.uploads = files.map(function (f) { return { name: f.name, state: 'waiting' }; });
    S.lib.dropTarget = '';
    S.lib.wsDrop = false;
    render();

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      var entry = S.lib.uploads[i];
      var ext = String(file.name.split('.').pop() || '').toLowerCase();

      if (UPLOAD_EXT.indexOf(ext) === -1) {
        entry.state = 'error';
        entry.message = 'Not a supported file type.';
        render();
        continue;
      }
      if (file.size > UPLOAD_MAX) {
        entry.state = 'error';
        entry.message = 'Larger than 25 MB.';
        render();
        continue;
      }

      entry.state = 'uploading';
      render();
      try {
        var base64 = await readAsBase64(file);
        var d = await api('/api/rh2/library/folders/' + encodeURIComponent(folderId) + '/upload', {
          method: 'POST',
          body: { fileName: file.name, fileData: base64 },
        });
        if (d.ok) {
          entry.state = 'done';
          entry.message = (d.warnings || []).join(' ');
        } else {
          entry.state = 'error';
          entry.message = d.error || 'Upload failed.';
        }
      } catch (e) {
        entry.state = 'error';
        entry.message = 'Could not read that file.';
      }
      render();
    }

    // The folder counts and the open list are both stale now.
    libRefreshFolders();
    if (S.lib.folderId) loadLibrary();
  }

  function libPickFiles(folderId) {
    var input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = UPLOAD_ACCEPT;
    input.onchange = function () { libUploadFiles(folderId, input.files); };
    input.click();
  }

  function libUploadsDismiss() { S.lib.uploads = null; render(); }

  /**
   * A drag only counts when it is carrying files from outside the browser.
   *
   * Dragging selected text, an image already on the page or a card across the
   * workspace must not raise an upload affordance the drop could never
   * satisfy — the promise has to be one the drop can keep.
   */
  function dragHasFiles(dt) {
    if (!dt) return false;
    var types = dt.types;
    if (!types) return false;
    for (var i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
    return false;
  }

  /* Drag state is kept as the id of the folder currently under the pointer, so
     only that card highlights. dragleave is unreliable across child elements,
     so entering another card simply replaces the value. */
  function libDragOver(ev, folderId) {
    if (!isOwner() || !dragHasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    if (S.lib.dropTarget !== folderId) { S.lib.dropTarget = folderId; render(); }
  }

  function libDragLeave(ev, folderId) {
    if (S.lib.dropTarget === folderId) { S.lib.dropTarget = ''; render(); }
  }

  function libDrop(ev, folderId) {
    if (!isOwner()) return;
    ev.preventDefault();
    ev.stopPropagation();
    S.lib.dropTarget = '';
    var dt = ev.dataTransfer;
    if (dt && dt.files && dt.files.length) libUploadFiles(folderId, dt.files);
    else render();
  }

  /* ── The workspace itself as a drop target ────────────────────────────────
     Inside a folder the whole page takes a file, not just the strip: somebody
     dragging a PDF out of Finder aims at the window, not at a band of it. The
     destination is still the folder they are looking at and the route is still
     libUploadFiles, so widening the target widens nothing else — the server
     decides exactly as it did before.

     On the folder grid there is no single destination, so the workspace does
     not invent one; the cards keep their own drop handlers and each names the
     folder it would file into.

     Unlike every other state on this surface, the drag class is written
     straight onto the node instead of going through render(). Re-rendering
     replaces the whole subtree, which would tear out the element the pointer
     is currently over mid-drag; the flag is mirrored into S.lib.wsDrop so a
     render triggered by something else still paints the right state. */

  function libWsCanDrop() { return isOwner() && !!S.lib.folderId; }

  function libWsMark(on) {
    S.lib.wsDrop = !!on;
    var el = doc.getElementById('rh2-lib-ws');
    if (el && el.classList) el.classList.toggle('is-dropping', !!on);
  }

  function libWsDragOver(ev) {
    if (!libWsCanDrop() || !dragHasFiles(ev.dataTransfer)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    if (!S.lib.wsDrop) libWsMark(true);
  }

  /* dragleave fires at every child boundary. Only a leave whose destination is
     outside the workspace is a real one; anything else is the pointer crossing
     between two cards inside it. */
  function libWsDragLeave(ev) {
    if (!S.lib.wsDrop) return;
    var to = ev.relatedTarget;
    var host = ev.currentTarget;
    if (to && host && host.contains && host.contains(to)) return;
    libWsMark(false);
  }

  function libWsDrop(ev) {
    if (!libWsCanDrop()) return;
    ev.preventDefault();
    libWsMark(false);
    var dt = ev.dataTransfer;
    if (dt && dt.files && dt.files.length) libUploadFiles(S.lib.folderId, dt.files);
  }

  function uploadPanel() {
    var ups = S.lib.uploads;
    if (!ups || !ups.length) return '';
    var done = ups.filter(function (u) { return u.state === 'done'; }).length;
    var failed = ups.filter(function (u) { return u.state === 'error'; });
    var busy = ups.some(function (u) { return u.state === 'uploading' || u.state === 'waiting'; });
    return '<div class="rh2-uploads" role="status" aria-live="polite">'
      + '<div class="rh2-uploads-head">'
      + '<strong>' + (busy ? 'Uploading…' : ('Uploaded ' + done + ' of ' + ups.length)) + '</strong>'
      + (busy ? '' : '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.libUploadsDismiss()">Dismiss</button>')
      + '</div>'
      + ups.map(function (u) {
        var mark = u.state === 'done' ? '✓' : u.state === 'error' ? '✗' : '·';
        return '<div class="rh2-upload-row rh2-upload-' + esc(u.state) + '">'
          + '<span class="rh2-upload-mark" aria-hidden="true">' + mark + '</span>'
          + '<span class="rh2-upload-name">' + esc(u.name) + '</span>'
          + (u.message ? '<span class="rh2-upload-msg">' + esc(u.message) + '</span>' : '')
          + '</div>';
      }).join('')
      + (failed.length
        ? '<p class="rh2-libnote">Files that were refused have not been stored. Nothing else was affected.</p>'
        : '')
      + '</div>';
  }

  /* ── Right-click ──────────────────────────────────────────────────────────
     One menu, three kinds of target: a folder, a document, and the workspace
     behind them. It is Owner-only because every action on it is: a therapist
     right-clicking gets their browser's own menu, which is the correct outcome
     rather than a menu of buttons that would all be refused.

     Nothing on the menu is an authority. Every entry calls the handler its
     toolbar equivalent already calls, so the menu can do nothing the surface
     could not do without it, and the server refuses the same things either
     way. */

  /* Where a right-click still belongs to the browser: copy, paste and
     spell-check on a field are not ours to take away, and the menu's own
     surfaces must not re-open it on top of itself. */
  var MENU_KEEP_NATIVE = 'input, textarea, select, a[href], .rh2-menu, .rh2-menu-veil';

  function libMenu(ev, kind, id, name, review) {
    if (!isOwner()) return true;
    ev.preventDefault();
    ev.stopPropagation();
    S.lib.menu = { kind: kind, id: id, name: name, review: !!review, x: ev.clientX, y: ev.clientY };
    render();
    // Measured, not guessed: the workspace menu is a different height from the
    // folder one, so one fixed clamp would put one of them off the short edge.
    libMenuPlace();
    var first = doc.querySelector('.rh2-menu .rh2-menu-item:not([aria-disabled="true"])');
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
    return false;
  }

  /**
   * The background menu: what can be made HERE.
   *
   * Only blank workspace opens it. A folder or a document stops the event on
   * its own handler long before it reaches here, so an item's menu always wins
   * over the room's — right-clicking a folder still offers the folder's actions.
   */
  function libWorkspaceMenu(ev) {
    if (!isOwner()) return true;
    var t = ev.target;
    if (t && t.closest && t.closest(MENU_KEEP_NATIVE)) return true;
    return libMenu(ev, 'workspace', S.lib.folderId || '', libHereName(), false);
  }

  /** The name of the place the reader is standing in. */
  function libHereName() {
    var meta = S.lib.folderMeta;
    if (S.lib.folderId && meta && meta.folder) return meta.folder.name;
    return 'Library';
  }

  /** Keep the whole menu on screen, whichever edge the pointer was near. */
  function libMenuPlace() {
    var m = S.lib.menu;
    var el = doc.querySelector('.rh2-menu');
    if (!m || !el) return;
    var box = el.getBoundingClientRect();
    var vw = global.innerWidth || 1200;
    var vh = global.innerHeight || 800;
    el.style.left = Math.round(Math.max(8, Math.min(m.x, vw - box.width - 8))) + 'px';
    el.style.top = Math.round(Math.max(8, Math.min(m.y, vh - box.height - 8))) + 'px';
  }

  function libMenuClose() { S.lib.menu = null; render(); }

  function renderMenu() {
    var m = S.lib.menu;
    if (!m) return '';
    // Each entry is [label, handler, icon, disabled].
    var items = [];
    var note = '';
    if (m.kind === 'workspace') {
      var here = S.lib.folderId || '';
      items.push(['New document', 'RH2.libNewDocument()', 'doc', false]);
      items.push(['New folder', 'RH2.libFolderForm(true)', 'folder', false]);
      items.push(['Upload…', here ? "RH2.libPickFiles('" + esc(here) + "')" : '', 'plus', !here]);
      // Said rather than hidden. On the folder grid there is no one folder to
      // upload into; a greyed entry with the reason beats a menu that quietly
      // changes shape depending on where it was opened.
      if (!here) note = 'Open a folder to upload into it.';
    } else if (m.kind === 'folder') {
      items.push(['Open', "RH2.libOpenFolder('" + esc(m.id) + "')", 'forward', false]);
      items.push(['Rename…', "RH2.libRenameStart('folder','" + esc(m.id) + "')", 'edit', false]);
      items.push(['Upload files here…', "RH2.libPickFiles('" + esc(m.id) + "')", 'plus', false]);
      // Needs Review is fixed — the server refuses to remove it (400
      // review_bucket_fixed) — so the menu stops offering it. Until libMenu
      // carried the flag this test could never be true and the entry always
      // showed, on a folder where it could only ever fail.
      if (!m.review) items.push(['Remove folder…', "RH2.libFolderArchive('" + esc(m.id) + "','" + esc(String(m.name).replace(/'/g, '')) + "')", 'trash', false]);
    } else {
      items.push(['Open', "RH2.openDetail('" + esc(m.id) + "','library')", 'forward', false]);
      items.push(['Rename…', "RH2.libRenameStart('resource','" + esc(m.id) + "')", 'edit', false]);
      items.push(['Move to folder…', "RH2.libMoveOne('" + esc(m.id) + "')", 'folder', false]);
    }
    return '<div class="rh2-menu-veil" onclick="RH2.libMenuClose()" oncontextmenu="RH2.libMenuClose();return false;"></div>'
      + '<div class="rh2-menu" role="menu" aria-label="Actions for ' + esc(m.name) + '" '
      + 'style="left:' + Math.round(m.x) + 'px; top:' + Math.round(m.y) + 'px;">'
      + '<div class="rh2-menu-title">' + esc(m.name) + '</div>'
      + items.map(function (it, i) {
        var face = '<span class="rh2-menu-icon" aria-hidden="true">' + icn(it[2], 'doc', 15) + '</span>'
          + '<span class="rh2-menu-label">' + esc(it[0]) + '</span>';
        if (it[3]) {
          return '<span class="rh2-menu-item is-disabled" role="menuitem" aria-disabled="true">' + face + '</span>';
        }
        return '<button type="button" role="menuitem" class="rh2-menu-item" id="rh2-menu-i' + i + '" '
          + 'onclick="RH2.libMenuClose();' + it[1] + '">' + face + '</button>';
      }).join('')
      + (note ? '<p class="rh2-menu-note">' + esc(note) + '</p>' : '')
      + '</div>';
  }

  /**
   * The open menu owns the keyboard.
   *
   * One document-level listener rather than a per-render binding, for the same
   * reason the learning dialogs give further down: this module replaces its
   * whole subtree on every render, so a handler attached to the menu would be
   * thrown away and rebuilt constantly. Escape closes it, the arrows walk it,
   * and Tab cannot wander off and leave it hanging over the page.
   */
  doc.addEventListener('keydown', function (e) {
    if (!S.lib || !S.lib.menu) return;
    if (e.key === 'Escape') { e.preventDefault(); libMenuClose(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return;
    var menu = doc.querySelector('.rh2-menu');
    if (!menu) return;
    var items = menu.querySelectorAll('.rh2-menu-item:not([aria-disabled="true"])');
    if (!items.length) return;
    var at = -1;
    for (var i = 0; i < items.length; i++) if (items[i] === doc.activeElement) at = i;
    e.preventDefault();
    var back = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey);
    at = back ? at - 1 : at + 1;
    if (at < 0) at = items.length - 1;
    if (at >= items.length) at = 0;
    try { items[at].focus({ preventScroll: true }); } catch (err) { /* gone */ }
  });

  /* ── Renaming ─────────────────────────────────────────────────────────────
     An inline panel rather than window.prompt: prompt cannot be styled, cannot
     show the server's refusal, and is blocked outright in some browsers. */

  function libRenameStart(kind, id) {
    var name = '';
    if (kind === 'folder') {
      (S.lib.folders || []).forEach(function (f) {
        if (f.id === id) name = f.name;
        (f.children || []).forEach(function (c) { if (c.id === id) name = c.name; });
      });
    } else {
      (S.lib.rows || []).forEach(function (r) { if (pick(r, 'id') === id) name = pick(r, 'title'); });
    }
    S.lib.renaming = { kind: kind, id: id, name: name, err: '' };
    render();
  }

  function libRenameField(v) { if (S.lib.renaming) S.lib.renaming.name = v; }
  function libRenameCancel() { S.lib.renaming = null; render(); }

  async function libRenameSave() {
    var r = S.lib.renaming;
    if (!r || S.lib.busy) return;
    S.lib.busy = 'rename';
    render();
    var d = r.kind === 'folder'
      ? await api('/api/rh2/library/folders/' + encodeURIComponent(r.id), {
        method: 'PATCH', body: { name: r.name },
      })
      : await api('/api/rh2/library/resources/' + encodeURIComponent(r.id), {
        method: 'PATCH', body: { title: r.name },
      });
    S.lib.busy = '';
    if (!d.ok) { r.err = d.error || 'That name could not be saved.'; render(); return; }
    S.lib.renaming = null;
    libRefreshFolders();
    if (r.kind === 'resource') loadLibrary();
    render();
  }

  function renameDialog() {
    var r = S.lib.renaming;
    if (!r) return '';
    return '<div class="rh2-folderform" role="group" aria-label="Rename">'
      + '<h2 class="rh2-h2">Rename ' + (r.kind === 'folder' ? 'folder' : 'document') + '</h2>'
      + '<label class="rh2-label" for="rh2-rename">Name</label>'
      + '<input id="rh2-rename" class="rh2-input" maxlength="300" value="' + esc(r.name) + '" '
      + 'oninput="RH2.libRenameField(this.value)">'
      + (r.err ? '<p class="rh2-libnote rh2-libnote-warn" role="status">' + esc(r.err) + '</p>' : '')
      + '<div class="rh2-folderform-actions">'
      + '<button type="button" class="rh2-btn rh2-btn-primary" ' + (S.lib.busy ? 'disabled' : '') + ' onclick="RH2.libRenameSave()">Save</button>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.libRenameCancel()">Cancel</button>'
      + '</div></div>';
  }

  /** Move a single resource — the right-click counterpart to bulk selection. */
  function libMoveOne(id) {
    S.lib.sel = {};
    S.lib.sel[id] = true;
    S.lib.selMode = true;
    S.lib.moveOpen = true;
    render();
  }

  function libOpenFolder(id) {
    var f = S.lib;
    f.folderId = id || '';
    f.folderMeta = null;
    f.folderSearch = false;
    f.browse = 'folders';
    f.q = ''; f.kind = ''; f.type = ''; f.topic = ''; f.cost = '';
    f.population = ''; f.setting = ''; f.authority = '';
    // A collection left over from wherever the reader came from would narrow
    // the list this folder returns while its count stayed unnarrowed — the
    // folder would look emptier than its card, with nothing on screen saying
    // why. Opening a folder asks one question: what is filed in here.
    f.collection = '';
    f.sel = {}; f.selMode = false;
    f.menu = null; f.renaming = null; f.wsDrop = false;
    // The shelves are needed inside a folder too — the move picker reads them,
    // and a reader who arrived here without passing the grid has none. It is
    // cached, so this is free on every path that already loaded them.
    loadFolders();
    if (id) loadFolderMeta(id);
    loadLibrary();
  }

  async function loadFolderMeta(id) {
    var d = await api('/api/rh2/library/folders/' + encodeURIComponent(id));
    if (S.lib.folderId !== id) return; // the reader moved on
    S.lib.folderMeta = d.ok ? d : null;
    if (S.view === 'library') render();
  }

  function libBrowse(mode) {
    S.lib.browse = mode;
    S.lib.folderId = '';
    S.lib.folderMeta = null;
    S.lib.sel = {}; S.lib.selMode = false;
    // Moving is leaving: a menu opened in the old place must not survive into
    // the new one, where its target may no longer be on screen.
    S.lib.menu = null; S.lib.wsDrop = false;
    // All Resources states the library's size from the same tree read the
    // "All Resources · 653" row uses, so the row and the page it opens cannot
    // give two answers. Cached, so this costs nothing on the usual path.
    loadFolders();
    loadLibrary();
  }

  /** Search this folder instead of the whole library — the reader's choice (§21). */
  function libScopeSearch(on) {
    S.lib.folderSearch = !!on;
    loadLibrary();
  }

  // ── Owner: selection and moving ─────────────────────────────────────────

  function libSelectMode(on) {
    S.lib.selMode = !!on;
    if (!on) S.lib.sel = {};
    render();
  }

  function libToggleSel(id) {
    if (S.lib.sel[id]) delete S.lib.sel[id];
    else S.lib.sel[id] = true;
    render();
  }

  function libSelCount() { return Object.keys(S.lib.sel || {}).length; }

  function libMoveOpen(on) {
    S.lib.moveOpen = !!on;
    S.lib.moveErr = '';
    render();
  }

  /** Every folder as a flat list, for the move picker. */
  function libFolderOptions() {
    var out = [];
    (S.lib.folders || []).forEach(function (p) {
      out.push({ id: p.id, label: p.name });
      (p.children || []).forEach(function (c) {
        out.push({ id: c.id, label: p.name + ' → ' + c.name });
      });
    });
    return out;
  }

  async function libMoveTo(folderId) {
    if (!folderId) return;
    var ids = Object.keys(S.lib.sel || {});
    if (!ids.length) return;
    S.lib.busy = 'move';
    render();
    var d = await api('/api/rh2/library/move', {
      method: 'POST', body: { folderId: folderId, resourceIds: ids },
    });
    S.lib.busy = '';
    if (!d.ok) { S.lib.moveErr = d.error || 'Those resources could not be moved.'; render(); return; }
    S.lib.sel = {}; S.lib.selMode = false; S.lib.moveOpen = false; S.lib.moveErr = '';
    S.lib.moveNote = d.moved + (d.moved === 1 ? ' resource moved to ' : ' resources moved to ') + d.folder;
    libRefreshFolders();
    loadLibrary();
  }

  // ── Owner: folder management ────────────────────────────────────────────

  /**
   * New document — the Library's door onto the resource author that already
   * exists, not a second one.
   *
   * Admin → Content is where a document with no file is written (title, type,
   * markdown body, classification, review state). Nothing about that changes
   * here: this opens it, and remembers the folder the person was standing in
   * so the finished resource lands there instead of making them walk back and
   * move it by hand.
   *
   * Creating and filing stay two separate server-enforced steps — POST
   * /api/rh2/resources then POST /api/rh2/library/move — because that is what
   * they already were. The remembered folder is a convenience the server never
   * trusts: move re-checks the owner role, the organisation and the folder, so
   * a tampered value buys nothing a hand-typed one would not have.
   */
  function libNewDocument() {
    S.lib.menu = null;
    S.admin.fileInto = S.lib.folderId || '';
    S.admin.fileIntoName = libHereName();
    S.admin.tab = 'content';
    nav('admin');
    adminNew();
  }

  function libFolderForm(open, folder) {
    S.lib.folderForm = open ? {
      id: folder ? folder.id : '',
      name: folder ? folder.name : '',
      description: folder ? (folder.description || '') : '',
      parentId: folder ? (folder.parentId || '') : (S.lib.folderId || ''),
      err: '',
    } : null;
    render();
  }

  function libFolderFormField(k, v) {
    if (S.lib.folderForm) S.lib.folderForm[k] = v;
  }

  async function libFolderSave() {
    var form = S.lib.folderForm;
    if (!form || S.lib.busy) return;
    S.lib.busy = 'folder';
    render();
    var body = { name: form.name, description: form.description };
    var d;
    if (form.id) {
      d = await api('/api/rh2/library/folders/' + encodeURIComponent(form.id), {
        method: 'PATCH', body: body,
      });
    } else {
      body.parentId = form.parentId || null;
      d = await api('/api/rh2/library/folders', { method: 'POST', body: body });
    }
    S.lib.busy = '';
    if (!d.ok) { form.err = d.error || 'That folder could not be saved.'; render(); return; }
    S.lib.folderForm = null;
    libRefreshFolders();
    render();
  }

  async function libFolderArchive(id, name) {
    if (S.lib.busy) return;
    if (!global.confirm('Remove the folder "' + name + '"? Its resources move to Needs Review — nothing is deleted.')) return;
    S.lib.busy = 'folder';
    render();
    var d = await api('/api/rh2/library/folders/' + encodeURIComponent(id), { method: 'DELETE' });
    S.lib.busy = '';
    if (!d.ok) { S.lib.orgErr = d.error || 'That folder could not be removed.'; render(); return; }
    if (S.lib.folderId === id) { S.lib.folderId = ''; S.lib.folderMeta = null; }
    libRefreshFolders();
    loadLibrary();
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function folderIcon() {
    return '<span class="rh2-folder-glyph" aria-hidden="true">' + icn('folder', 'doc', 18) + '</span>';
  }

  function countLabel(n) {
    return n + (n === 1 ? ' resource' : ' resources');
  }

  /**
   * A folder row. The name is the heading and the count is the fact; there is
   * deliberately nothing else on it. Metadata belongs on the resource, not on
   * the shelf (§18).
   */
  function folderCard(node, owner) {
    var kids = (node.children || []).length;
    var dropping = owner && S.lib.dropTarget === node.id;
    // The drop handlers are only attached for an Owner: a therapist dragging a
    // file onto a folder they cannot write to should get the browser's default
    // (open the file), not a silent no-op that looks broken.
    var dnd = owner
      ? ' ondragover="RH2.libDragOver(event,\'' + esc(node.id) + '\')"'
        + ' ondragleave="RH2.libDragLeave(event,\'' + esc(node.id) + '\')"'
        + ' ondrop="RH2.libDrop(event,\'' + esc(node.id) + '\')"'
        + ' oncontextmenu="return RH2.libMenu(event,\'folder\',\'' + esc(node.id) + '\',\''
        + esc(String(node.name).replace(/'/g, '')) + '\',' + (node.isReviewBucket ? 'true' : 'false') + ')"'
      : '';
    return '<div class="rh2-folder' + (node.isReviewBucket ? ' rh2-folder-review' : '')
      + (dropping ? ' is-dropping' : '') + '"' + dnd + '>'
      + '<button type="button" class="rh2-folder-open" onclick="RH2.libOpenFolder(\'' + esc(node.id) + '\')">'
      + folderIcon()
      + '<span class="rh2-folder-body">'
      + '<span class="rh2-folder-name">' + esc(node.name) + '</span>'
      + (node.description ? '<span class="rh2-folder-desc">' + esc(node.description) + '</span>' : '')
      + '<span class="rh2-folder-count">' + esc(countLabel(node.count))
      + (kids ? ' · ' + kids + (kids === 1 ? ' subfolder' : ' subfolders') : '') + '</span>'
      + '</span></button>'
      + (dropping ? '<span class="rh2-folder-dropmsg" aria-hidden="true">Drop to upload</span>' : '')
      + (owner ? '<span class="rh2-folder-tools">'
        + '<button type="button" class="rh2-iconbtn" title="Upload files here" aria-label="Upload files into ' + esc(node.name) + '" '
        + 'onclick="RH2.libPickFiles(\'' + esc(node.id) + '\')">' + icn('plus', 'doc', 14) + '</button>'
        + '<button type="button" class="rh2-iconbtn" title="Rename folder" aria-label="Rename ' + esc(node.name) + '" '
        + 'onclick="RH2.libRenameStart(\'folder\',\'' + esc(node.id) + '\')">' + icn('edit', 'doc', 14) + '</button>'
        + (node.isReviewBucket ? '' : '<button type="button" class="rh2-iconbtn" title="Remove folder" aria-label="Remove ' + esc(node.name) + '" '
          + 'onclick="RH2.libFolderArchive(\'' + esc(node.id) + '\',\'' + esc(String(node.name).replace(/'/g, '')) + '\')">'
          + icn('trash', 'x', 14) + '</button>')
        + '</span>' : '')
      + '</div>';
  }

  /** Where the reader is. Always present once they are inside a folder (§20). */
  function libCrumbs() {
    var meta = S.lib.folderMeta;
    var parts = ['<button type="button" class="rh2-crumb-link" onclick="RH2.libOpenFolder(\'\')">Library</button>'];
    if (meta) {
      (meta.breadcrumb || []).forEach(function (b) {
        parts.push('<button type="button" class="rh2-crumb-link" onclick="RH2.libOpenFolder(\'' + esc(b.id) + '\')">' + esc(b.name) + '</button>');
      });
      parts.push('<span class="rh2-crumb-here" aria-current="page">' + esc(meta.folder.name) + '</span>');
    }
    return '<nav class="rh2-crumbs" aria-label="Library location">'
      + parts.join('<span class="rh2-crumb-sep" aria-hidden="true">›</span>')
      + '</nav>';
  }

  /**
   * The Owner's controls.
   *
   * Everything here acts on the folder the reader is actually looking at, so
   * "Upload files" inside Assessments puts them in Assessments. On the folder
   * grid there is no single target, so uploading is offered per folder instead
   * — by dropping onto a card or right-clicking it.
   *
   * These read as buttons and not as prose. They used to be rh2-btn-quiet,
   * which is a transparent border on the page's own background and muted text:
   * correct for a Cancel sitting beside a primary action, wrong for the only
   * two things you can do to a folder. They now carry the standard button
   * surface, an icon, and a pressed state, because a control nobody recognises
   * as a control is not a control.
   */
  function libOwnerBar() {
    if (!isOwner()) return '';
    var f = S.lib;
    var out = '<div class="rh2-libtools" role="group" aria-label="Library actions">';

    if (f.folderId) {
      out += '<button type="button" class="rh2-btn rh2-btn-primary" '
        + 'onclick="RH2.libPickFiles(\'' + esc(f.folderId) + '\')">'
        + '<span class="rh2-btn-icon" aria-hidden="true">' + icn('plus', 'doc', 15) + '</span>Upload files</button>';
    }
    out += '<button type="button" class="rh2-btn" onclick="RH2.libFolderForm(true)">'
      + '<span class="rh2-btn-icon" aria-hidden="true">' + icn('folder', 'doc', 15) + '</span>New folder</button>';
    if ((f.folders || []).length) {
      out += '<button type="button" class="rh2-btn" aria-pressed="' + (f.selMode ? 'true' : 'false') + '" '
        + 'onclick="RH2.libSelectMode(' + (f.selMode ? 'false' : 'true') + ')">'
        + '<span class="rh2-btn-icon" aria-hidden="true">' + icn('check', 'doc', 15) + '</span>'
        + (f.selMode ? 'Done selecting' : 'Select resources') + '</button>';
    }
    out += '<span class="rh2-libhint">Right-click the workspace to add something here, or a folder or document to act on it.</span>';

    if (f.orgErr) out += '<p class="rh2-libnote rh2-libnote-warn" role="status">' + esc(f.orgErr) + '</p>';
    if (f.moveNote) out += '<p class="rh2-libnote" role="status">' + esc(f.moveNote) + '</p>';
    return out + '</div>';
  }

  /** The move panel: a folder list, not a tree widget. */
  function libMovePanel() {
    if (!S.lib.moveOpen) return '';
    var options = libFolderOptions();
    return '<div class="rh2-movebar" role="group" aria-label="Move selected resources">'
      + '<span class="rh2-movebar-count">' + esc(countLabel(libSelCount())) + ' selected</span>'
      + '<label class="rh2-visually-hidden" for="rh2-move-to">Move to folder</label>'
      + '<select id="rh2-move-to" class="rh2-select" onchange="RH2.libMoveTo(this.value)">'
      + '<option value="">Move to folder…</option>'
      + options.map(function (o) { return '<option value="' + esc(o.id) + '">' + esc(o.label) + '</option>'; }).join('')
      + '</select>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.libMoveOpen(false)">Cancel</button>'
      + (S.lib.moveErr ? '<span class="rh2-libnote rh2-libnote-warn">' + esc(S.lib.moveErr) + '</span>' : '')
      + '</div>';
  }

  function libFolderDialog() {
    var form = S.lib.folderForm;
    if (!form) return '';
    var parents = (S.lib.folders || []).filter(function (p) { return !p.isReviewBucket; });
    return '<div class="rh2-folderform" role="group" aria-label="' + (form.id ? 'Rename folder' : 'New folder') + '">'
      + '<h2 class="rh2-h2">' + (form.id ? 'Rename folder' : 'New folder') + '</h2>'
      + '<label class="rh2-label" for="rh2-ff-name">Name</label>'
      + '<input id="rh2-ff-name" class="rh2-input" maxlength="60" value="' + esc(form.name) + '" '
      + 'oninput="RH2.libFolderFormField(\'name\',this.value)">'
      + '<label class="rh2-label" for="rh2-ff-desc">Short description</label>'
      + '<input id="rh2-ff-desc" class="rh2-input" maxlength="200" value="' + esc(form.description) + '" '
      + 'oninput="RH2.libFolderFormField(\'description\',this.value)">'
      + (form.id ? '' : '<label class="rh2-label" for="rh2-ff-parent">Inside</label>'
        + '<select id="rh2-ff-parent" class="rh2-select" onchange="RH2.libFolderFormField(\'parentId\',this.value)">'
        + '<option value="">Top level</option>'
        + parents.map(function (p) {
          return '<option value="' + esc(p.id) + '"' + (form.parentId === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>';
        }).join('') + '</select>')
      + (form.err ? '<p class="rh2-libnote rh2-libnote-warn" role="status">' + esc(form.err) + '</p>' : '')
      + '<div class="rh2-folderform-actions">'
      + '<button type="button" class="rh2-btn rh2-btn-primary" ' + (S.lib.busy ? 'disabled' : '') + ' onclick="RH2.libFolderSave()">Save</button>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.libFolderForm(false)">Cancel</button>'
      + '</div></div>';
  }

  /** The default screen: folders, then the way out to the flat list (§48, §49). */
  function renderFolderGrid() {
    var f = S.lib;
    if (f.foldersLoading || f.folders === null) {
      if (f.folders === null && !f.foldersLoading) loadFolders();
      return '<div class="rh2-folders">' + skel(4, 44) + '</div>';
    }
    if (f.foldersErr) {
      return '<div class="rh2-empty">' + esc(f.foldersErr)
        + ' <button type="button" class="rh2-btn" onclick="RH2.libReloadFolders()">Retry</button></div>';
    }
    if (!f.folders.length) {
      return '<div class="rh2-empty">'
        + (isOwner()
          ? 'No folders yet. Choose <strong>New folder</strong> to make one, then drag documents onto it or use <strong>Upload files</strong>.'
          : 'No folders yet. Search, or open All Resources to browse everything.')
        + '</div>' + allResourcesRow();
    }
    var owner = isOwner();
    return '<div class="rh2-folders">'
      + f.folders.map(function (n) { return folderCard(n, owner); }).join('')
      + '</div>' + allResourcesRow();
  }

  function allResourcesRow() {
    var n = S.lib.totalResources || 0;
    return '<div class="rh2-allrow">'
      + '<button type="button" class="rh2-allrow-btn" onclick="RH2.libBrowse(\'all\')">'
      + '<span class="rh2-allrow-name">All Resources</span>'
      + '<span class="rh2-folder-count">' + esc(countLabel(n)) + '</span>'
      + '</button></div>';
  }

  /**
   * Subfolders of the open folder, above its own resources.
   *
   * Counts come from the folder route with the subfolders themselves. Looking
   * them up in the folder tree meant a reader who had not passed the grid was
   * shown "0 resources" on a shelf that was full, and the number changed under
   * them the moment the tree happened to load.
   */
  function renderSubfolders() {
    var meta = S.lib.folderMeta;
    if (!meta || !(meta.children || []).length) return '';
    var owner = isOwner();
    return '<div class="rh2-folders rh2-folders-sub">'
      + meta.children.map(function (c) {
        return folderCard({
          id: c.id, name: c.name, description: c.description,
          count: c.count || 0, children: [], parentId: meta.folder.id,
        }, owner);
      }).join('') + '</div>';
  }

  var KINDS = [['hosted', 'Documents'], ['external', 'External links'], ['guide', 'Guides']];

  /**
   * One card, optionally with a selection box in front of it.
   *
   * The card itself is untouched — same markup, same handler, same everything
   * (§19). Selection is a wrapper the Owner turns on, so a therapist's Library
   * is exactly the Library it always was.
   */
  function selectableCard(r, backView) {
    var id = pick(r, 'id');
    // Right-click is Owner-only, so a therapist keeps the browser's own menu.
    if (!S.lib.selMode) {
      if (!isOwner()) return resourceCard(r, backView);
      return '<div class="rh2-ctxwrap" oncontextmenu="return RH2.libMenu(event,\'resource\',\''
        + esc(id) + '\',\'' + esc(String(pick(r, 'title') || '').replace(/'/g, '')) + '\')">'
        + resourceCard(r, backView) + '</div>';
    }
    var on = !!S.lib.sel[id];
    return '<div class="rh2-selwrap' + (on ? ' is-selected' : '') + '">'
      + '<label class="rh2-selbox">'
      + '<input type="checkbox"' + (on ? ' checked' : '')
      + ' onchange="RH2.libToggleSel(\'' + esc(id) + '\')">'
      + '<span class="rh2-visually-hidden">Select ' + esc(pick(r, 'title')) + '</span>'
      + '</label>' + resourceCard(r, backView) + '</div>';
  }

  function renderLibrary() {
    var f = S.lib;
    var searching = libSearching(f);
    var inFolder = !!f.folderId;
    // Saved, All Resources and any search are all "a list of resources".
    // Only an unqualified browse shows folders.
    var flat = f.saved || f.browse === 'all' || searching || inFolder;

    var title = 'Library';
    if (f.saved) title = 'Saved';
    else if (f.browse === 'all' && !searching) title = 'All Resources';
    else if (inFolder && f.folderMeta && !searching) title = f.folderMeta.folder.name;

    /* The workspace.
       Right-click anywhere blank in here offers what can be made here, and —
       once the reader is inside a folder — the whole surface accepts a dropped
       file rather than only the strip below the filters. Both are Owner-only,
       both end in handlers that already existed, and neither is attached
       outside this element, so a drag across the nav or another tab does
       nothing. */
    var ws = isOwner()
      ? ' oncontextmenu="return RH2.libWorkspaceMenu(event)"'
        + (inFolder
          ? ' ondragover="RH2.libWsDragOver(event)" ondragleave="RH2.libWsDragLeave(event)"'
            + ' ondrop="RH2.libWsDrop(event)"'
          : '')
      : '';
    var out = '<div id="rh2-lib-ws" class="rh2-page rh2-library'
      + (isOwner() ? ' rh2-ws' : '') + (f.wsDrop ? ' is-dropping' : '') + '"' + ws + '>';
    if (isOwner() && inFolder) {
      out += '<div class="rh2-wsdrop" aria-hidden="true"><span class="rh2-wsdrop-face">'
        + icn('plus', 'doc', 22) + 'Drop files here to upload</span></div>';
    }
    out += renderMenu();
    out += '<h1 class="rh2-h1">' + esc(title) + '</h1>';

    // Breadcrumbs whenever the reader is anywhere other than the front page.
    if (!f.saved && (inFolder || f.browse === 'all')) {
      out += (inFolder ? libCrumbs()
        : '<nav class="rh2-crumbs" aria-label="Library location">'
          + '<button type="button" class="rh2-crumb-link" onclick="RH2.libBrowse(\'folders\')">Library</button>'
          + '<span class="rh2-crumb-sep" aria-hidden="true">›</span>'
          + '<span class="rh2-crumb-here" aria-current="page">All Resources</span></nav>');
    }
    if (inFolder && f.folderMeta && f.folderMeta.folder.description && !searching) {
      out += '<p class="rh2-folder-lede">' + esc(f.folderMeta.folder.description) + '</p>';
    }

    // ── search and filters ────────────────────────────────────────────────
    // The search box is always the first control, and it always searches the
    // whole library. A reader inside a folder is offered the narrower search
    // rather than given it (§21).
    out += '<div class="rh2-filters">'
      + '<input type="search" id="rh2-lib-q" class="rh2-search" '
      + 'placeholder="Search all resources..." aria-label="Search all resources" value="' + esc(f.q) + '" '
      + 'oninput="RH2.libInput(this.value)">';

    if (flat && !f.saved) {
      out += sel('rh2-f-kind', 'All kinds', KINDS, f.kind, "RH2.libFilter('kind',this.value)")
        + sel('rh2-f-type', 'All types', CONTENT_TYPES, f.type, "RH2.libFilter('type',this.value)")
        + sel('rh2-f-topic', 'All topics', (S.topics || []).map(function (t) { return [t.id, t.name]; }), f.topic, "RH2.libFilter('topic',this.value)")
        + sel('rh2-f-cost', 'All costs', (S.costs || []).map(function (t) { return [t.id, t.name]; }), f.cost, "RH2.libFilter('cost',this.value)")
        + sel('rh2-f-pop', 'All populations', countedVocab(POPULATIONS, 'populationUnclassified'), f.population, "RH2.libFilter('population',this.value)")
        + sel('rh2-f-set', 'All settings', countedVocab(SETTINGS, 'settingUnclassified'), f.setting, "RH2.libFilter('setting',this.value)")
        + sel('rh2-f-auth', 'All authorities', Object.keys(AUTHORITY).map(function (k) { return [k, AUTHORITY[k].label]; }), f.authority, "RH2.libFilter('authority',this.value)")
        + '<label class="rh2-visually-hidden" for="rh2-f-sort">Sort</label>'
        + '<select id="rh2-f-sort" class="rh2-select" onchange="RH2.libFilter(\'sort\',this.value)">'
        + SORTS.map(function (o) {
          return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>';
    }
    if (f.collection) {
      out += '<button type="button" class="rh2-chip rh2-chip-clear" onclick="RH2.libFilter(\'collection\',\'\')">Collection filter — clear</button>';
    }
    out += '</div>';

    // Searching from inside a folder spans the whole library by default, and
    // says so, because silently narrowing a search is the behaviour §21 exists
    // to prevent.
    if (searching && inFolder) {
      out += '<p class="rh2-libnote" role="status">'
        + (f.folderSearch
          ? 'Searching ' + esc(f.folderMeta ? f.folderMeta.folder.name : 'this folder') + ' only. '
            + '<button type="button" class="rh2-linkbtn" onclick="RH2.libScopeSearch(false)">Search the whole library</button>'
          : 'Searching the whole library. '
            + '<button type="button" class="rh2-linkbtn" onclick="RH2.libScopeSearch(true)">Search '
            + esc(f.folderMeta ? f.folderMeta.folder.name : 'this folder') + ' only</button>')
        + '</p>';
    }

    out += libOwnerBar();
    out += uploadPanel();
    out += libFolderDialog();
    out += renameDialog();
    if (f.selMode) {
      out += libSelCount()
        ? (S.lib.moveOpen ? libMovePanel()
          : '<div class="rh2-movebar"><span class="rh2-movebar-count">' + esc(countLabel(libSelCount())) + ' selected</span>'
            + '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.libMoveOpen(true)">Move to folder</button>'
            + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.libSelectMode(false)">Cancel</button></div>')
        : '<p class="rh2-libnote" role="status">Tick the resources you want to move.</p>';
    }

    // ── the folder front page ─────────────────────────────────────────────
    if (!flat) return out + renderFolderGrid() + '</div>';

    // ── a list of resources ───────────────────────────────────────────────
    if (inFolder && !searching) out += renderSubfolders();
    /* The strip stays as the resting explanation — what may be dropped, and
       the way in for anyone not dragging anything. It no longer carries its
       own drag handlers: the workspace around it does, so there is one drop
       state instead of two competing ones, and no flicker as the pointer
       crosses the strip's edge. Its highlight comes from the workspace class
       in CSS. */
    if (inFolder && isOwner()) {
      out += '<div class="rh2-dropzone">'
        + 'Drop files here, or <button type="button" class="rh2-linkbtn" onclick="RH2.libPickFiles(\''
        + esc(f.folderId) + '\')">choose files</button> — PDF, Word, Excel, PowerPoint or images'
        + '</div>';
    }

    if (f.loading || f.rows === null) {
      out += '<div class="rh2-grid">' + skelCards(8) + '</div>';
      if (f.rows === null && !f.loading) loadLibrary();
      return out + '</div>';
    }
    if (f.error) {
      return out + '<div class="rh2-empty">' + esc(f.error)
        + ' <button type="button" class="rh2-btn" onclick="RH2.libFilter(\'sort\',\'' + esc(f.sort) + '\')">Retry</button></div></div>';
    }

    var backView = f.saved ? 'saved' : 'library';
    var tools = toolsFor(f);

    if (!f.rows.length) {
      if (tools.length) {
        return out + '<p class="rh2-count" role="status">' + tools.length
          + (tools.length === 1 ? ' resource' : ' resources') + '</p>'
          + '<div class="rh2-grid">' + tools.map(toolCard).join('') + '</div></div>';
      }
      if (f.saved) return out + '<div class="rh2-empty">Save resources you use often and they will appear here.</div></div>';
      if (inFolder && !searching) {
        return out + '<div class="rh2-empty">Nothing is filed here yet.'
          + (isOwner() ? ' Select resources elsewhere in the Library and move them in.' : '') + '</div></div>';
      }
      return out + '<div class="rh2-empty">No resources match. Try clearing a filter, or tell us what is missing via feedback on any related resource.</div></div>';
    }

    /* BROWSING STATES THE SIZE OF THE SHELF; SEARCHING STATES THE HITS.
       A page is 48 cards, and counting them made a folder of 451 announce
       "48+ resources" one line below the card that had just said 451 — then a
       third number as soon as Load more ran. Whenever the reader is browsing
       a known set, the tally is that set's server count: the folder's, sent
       with the folder, or the library's, sent with the tree. A search or a
       filter is a different question — how many matched — and keeps counting
       what came back. */
    var known = null;
    if (inFolder && !searching && f.folderMeta && f.folderMeta.folder
      && typeof f.folderMeta.folder.count === 'number') known = f.folderMeta.folder.count;
    else if (!inFolder && !searching && !f.saved && !f.collection
      && f.browse === 'all' && typeof f.totalResources === 'number') known = f.totalResources;

    var tally = known !== null ? countLabel(known)
      : (f.rows.length + tools.length) + (f.hasMore ? '+' : '')
        + ((f.rows.length + tools.length) === 1 ? ' resource' : ' resources');
    out += '<p class="rh2-count" role="status">' + esc(tally) + '</p>';
    out += '<div class="rh2-grid">'
      + tools.map(toolCard).join('')
      + f.rows.map(function (r) { return selectableCard(r, backView); }).join('') + '</div>';
    if (f.hasMore) {
      out += '<div class="rh2-loadmore"><button type="button" class="rh2-btn" '
        + (f.loadingMore ? 'disabled' : '') + ' onclick="RH2.libMore()">'
        + (f.loadingMore ? 'Loading…' : 'Load more') + '</button></div>';
    }
    return out + '</div>';
  }

  function skelCards(n) {
    var out = '';
    for (var i = 0; i < n; i++) {
      out += '<div class="rh2-cardtile rh2-skel-tile"><span class="rh2-card-thumb"></span>'
        + '<span class="rh2-cardtile-body">' + skel(2, 16) + '</span></div>';
    }
    return out;
  }

  function libInput(v) {
    S.lib.q = v;
    if (libDebounce) clearTimeout(libDebounce);
    libDebounce = setTimeout(function () { loadLibrary(); }, 320);
  }
  function libFilter(k, v) {
    S.lib[k] = v;
    // A filter is a question about the library, so leaving a half-made
    // selection behind would move resources the reader can no longer see.
    S.lib.sel = {};
    loadLibrary();
  }

  function libReloadFolders() { loadFolders(true); }

  // ── DETAIL ────────────────────────────────────────────────────────────────

  async function openDetail(id, backView) {
    S.detail = { id: id, data: null, loading: true, ackConfirm: false, fbKind: '', fbDone: false, showVersions: false, quizResult: null, backView: backView || S.view, files: null, filesLoading: false, filesErr: '' };
    S.view = 'detail';
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id));
    S.detail.loading = false;
    S.detail.data = d.ok ? d : { ok: false, error: d.error };
    render();
    loadDetailFiles(id);
  }

  /**
   * Files come from the authorised metadata endpoint and nowhere else. The
   * server has already removed anything this user may not download, so the view
   * renders exactly what it is given and never decides visibility itself — and
   * never has a storage key or path to leak, because the endpoint does not
   * return one.
   *
   * A 404 is the ordinary answer for most resources (they have no files), so it
   * is treated as "none", not as an error.
   */
  async function loadDetailFiles(id) {
    S.detail.filesLoading = true;
    S.detail.filesErr = '';
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/files');
    if (S.detail.id !== id) return;            // navigated away mid-flight
    S.detail.filesLoading = false;
    if (d.ok) S.detail.files = d.files || [];
    else if (d.status === 404) S.detail.files = [];
    else { S.detail.files = []; S.detail.filesErr = d.error || 'Files are unavailable right now.'; }
    render();
  }

  function detailRes() {
    var d = S.detail.data;
    return d ? (d.resource || d) : null;
  }

  function kvRow(k, vHtml) {
    return vHtml ? '<div class="rh2-kv"><span class="rh2-kv-k">' + k + '</span><span class="rh2-kv-v">' + vHtml + '</span></div>' : '';
  }

  /* ── Governance readiness ─────────────────────────────────────────────────
     Nine distinct concepts that used to blur into one "approved" chip:
     authorship, rights review, clinical review, brand/accessibility review,
     approval, publication, retirement and quarantine.

     Every judgement here comes from the server. approval_ready and
     approval_blockers are computed by the same approvalBlockers() the approve
     route enforces, so this panel can never tell a reviewer a record is ready
     when the server would refuse it — or list a blocker the server does not
     actually apply. The browser holds no copy of the policy. */
  var STATE_WORDS = {
    'inventory': 'In inventory — review not started',
    'rights-review': 'In rights review',
    'clinical-review': 'In clinical review',
    'brand-accessibility-review': 'In brand and accessibility review',
    'approved': 'Approved for use',
    'published': 'Published',
    'retired': 'Withdrawn (inactive)',
    'excluded-private': 'Quarantined — private, never served',
  };

  /* Raw column values are internal vocabulary, not English. A reviewer should
     read "Not reviewed", not "unreviewed"; "Opal Therapy", not "opal-original".
     Anything unmapped falls back to the raw value rather than being hidden, so
     a new vocabulary entry is visible rather than silently blank. */
  var GOV_WORDS = {
    // source_class
    'opal-original': 'Opal Therapy',
    'government-official': 'Official / government',
    'nonprofit': 'Nonprofit publisher',
    'standardised-instrument': 'Standardised instrument',
    'commercial': 'Commercial publisher',
    'provider-company': 'Another provider',
    'internal': 'Internal material',
    'unknown': 'Not yet established',
    // rights_status
    'unreviewed': 'Not reviewed',
    'opal-owned': 'Opal owns this',
    'licensed-for-portal': 'Licensed for the portal',
    'official-link-only': 'Link to official source only',
    'reference-only': 'Reference only — not hostable',
    'restricted': 'Restricted — not hostable',
    // clinical_status
    'draft': 'Draft',
    'clinically-reviewed': 'Reviewed',
    'superseded': 'Superseded',
    // brand_review_status
    'pending': 'Pending',
    'approved': 'Approved',
    'not-required': 'Not required',
  };

  function govWord(value) {
    if (!value) return 'Not recorded';
    return GOV_WORDS[value] || String(value);
  }

  function reviewChip(label, value, okWhen) {
    var done = okWhen.indexOf(value) !== -1;
    return '<div class="rh2-gov-item' + (done ? ' is-done' : '') + '">'
      + '<span class="rh2-gov-item-k">' + esc(label) + '</span>'
      + '<span class="rh2-gov-item-v">' + esc(govWord(value)) + '</span></div>';
  }

  function renderGovernance(r) {
    if (!canWrite()) return '';               // reviewers only
    var pub = pick(r, 'publication_state');
    var ready = pick(r, 'approval_ready') === true;
    var blockers = pick(r, 'approval_blockers') || [];

    var out = '<section class="rh2-card rh2-gov-panel" aria-labelledby="rh2-gov-h">'
      + '<h2 id="rh2-gov-h">Governance</h2>'
      + '<p class="rh2-gov-state">' + esc(STATE_WORDS[pub] || pub || 'Unknown state') + '</p>';

    // Approval and publication are separate claims and are shown separately.
    out += '<div class="rh2-gov-grid">'
      + reviewChip('Source', pick(r, 'source_class'), ['opal-original', 'government-official',
        'nonprofit', 'standardised-instrument', 'commercial', 'provider-company', 'internal'])
      + reviewChip('Rights review', pick(r, 'rights_status'),
        ['opal-owned', 'licensed-for-portal', 'official-link-only'])
      + reviewChip('Clinical review', pick(r, 'clinical_status'), ['clinically-reviewed'])
      + reviewChip('Brand & accessibility', pick(r, 'brand_review_status'), ['approved', 'not-required'])
      + '</div>';

    if (pub === 'published') {
      out += '<p class="rh2-gov-ok">Published.</p>';
    } else if (ready) {
      out += '<p class="rh2-gov-ok">All approval requirements are met. '
        + 'Approving does not publish — publication is unavailable in this release.</p>';
    } else if (blockers.length) {
      out += '<p class="rh2-gov-blocked-h" id="rh2-gov-blockers-h">'
        + 'This resource cannot be approved yet:</p>'
        + '<ul class="rh2-gov-blockers" aria-labelledby="rh2-gov-blockers-h">';
      for (var i = 0; i < blockers.length; i++) {
        out += '<li>' + esc(blockers[i]) + '</li>';
      }
      out += '</ul>';
    }
    return out + '</section>';
  }

  /* ── Files ────────────────────────────────────────────────────────────────
     Renders ONLY what GET /api/rh2/resources/:id/files returned. That endpoint
     has already dropped every file the caller may not download, so a control
     shown here is always a control that works — the view never renders an
     action and then discovers it is forbidden. The href is the database-ID URL
     the server supplied verbatim; storage keys and local paths are not part of
     the contract and are never reconstructed.

     The status line is an aria-live region so a screen reader hears the list
     arrive, and each action is a real link so it is keyboard reachable and
     focusable without extra work. */
  function fileActionLabel(f) {
    if (f.isPrimary && f.format === 'pdf') return 'View or download PDF';
    if (f.format === 'docx') return 'Editable Word version';
    return 'Download ' + esc(String(f.format || 'file').toUpperCase());
  }

  function fileSizeLabel(bytes) {
    if (bytes === null || bytes === undefined) return '';
    if (bytes < 1024) return bytes + ' bytes';
    if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  /* ── Document hero ────────────────────────────────────────────────────────
     The primary file's first page IS the resource for a hosted document, so
     the detail view leads with it: a real thumbnail (authorised derivative
     route), a Preview button that opens the shared DocPreview viewer, and the
     download. Falls back silently when the file list has not arrived or the
     file has no visual. */
  function primaryFile() {
    var files = S.detail.files || [];
    for (var i = 0; i < files.length; i++) if (files[i].isPrimary) return files[i];
    return files[0] || null;
  }

  function renderDetailHero() {
    var f = primaryFile();
    if (!f) return '';
    var meta = [String(f.displayFormat || f.format || '').toUpperCase(), fileSizeLabel(f.sizeBytes)]
      .filter(Boolean).join(' · ');
    var out = '<section class="rh2-card rh2-dochero" aria-label="Document preview">';
    if (f.thumbnailUrl) {
      out += f.previewKind
        ? '<button type="button" class="rh2-dochero-thumb" aria-label="Preview document" '
          + 'onclick="RH2.previewFile(\'' + esc(f.id) + '\')">'
          + '<img src="' + esc(f.thumbnailUrl) + '" alt="First page of the document" loading="lazy"></button>'
        : '<span class="rh2-dochero-thumb"><img src="' + esc(f.thumbnailUrl) + '" alt="First page of the document" loading="lazy"></span>';
    }
    out += '<span class="rh2-dochero-actions">';
    if (f.previewKind) {
      out += '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.previewFile(\'' + esc(f.id) + '\')">Preview</button>';
    }
    out += '<a class="rh2-btn" href="' + esc(f.downloadUrl) + '" download>Download</a>'
      + (meta ? '<span class="rh2-quiet">' + esc(meta) + '</span>' : '')
      + '</span></section>';
    return out;
  }

  /** Admin repair: rebuild a file's cached derivatives, then refresh.
      POSTs to the server-supplied regenerateUrl — never a client-built path. */
  async function regenPreview(fileId) {
    var files = (S.detail && S.detail.files) || [];
    var f = null;
    for (var i = 0; i < files.length; i++) if (files[i].id === fileId) f = files[i];
    if (!f || !f.regenerateUrl) return;
    var d = await api(f.regenerateUrl, { method: 'POST' });
    if (!d.ok) { toast('Preview rebuild failed', d.error || ''); return; }
    toast('Preview rebuilt', (d.results || []).map(function (r) { return r.kind + ': ' + r.outcome; }).join(', '));
    if (S.detail && S.detail.id) loadDetailFiles(S.detail.id);
  }

  /** Open the shared viewer for one of the detail view's files. */
  function previewFile(fileId) {
    var files = S.detail.files || [];
    var f = null;
    for (var i = 0; i < files.length; i++) if (files[i].id === fileId) f = files[i];
    if (!f || !f.previewKind || !global.DocPreview) return;
    var r = detailRes() || {};
    global.DocPreview.open({
      kind: f.previewKind,
      url: f.previewUrl,
      downloadUrl: f.downloadUrl,
      title: pick(r, 'title') || f.fileName || 'Document',
      meta: [String(f.displayFormat || '').toUpperCase(), fileSizeLabel(f.sizeBytes),
        String(pick(r, 'source_publisher') || '')].filter(Boolean).join(' · '),
    });
  }

  function renderDetailFiles() {
    var st = S.detail;
    var out = '<section class="rh2-card rh2-files" aria-labelledby="rh2-files-h">'
      + '<h2 class="rh2-files-h" id="rh2-files-h">Files</h2>';

    if (st.filesLoading) {
      out += '<p class="rh2-quiet" role="status">Loading files…</p></section>';
      return out;
    }
    if (st.filesErr) {
      out += '<p class="rh2-empty" role="status">' + esc(st.filesErr) + '</p></section>';
      return out;
    }
    var files = st.files || [];
    if (!files.length) {
      out += '<p class="rh2-quiet" role="status">No files are attached to this resource.</p></section>';
      return out;
    }

    out += '<p class="rh2-visually-hidden" role="status">'
      + files.length + (files.length === 1 ? ' file available' : ' files available') + '</p>';
    out += '<ul class="rh2-file-list">';
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var restricted = f.effectiveAccessTier && f.effectiveAccessTier !== 'staff';
      var meta = [String(f.format || '').toUpperCase(), fileSizeLabel(f.sizeBytes)]
        .filter(Boolean).join(' · ');
      out += '<li class="rh2-file' + (f.isPrimary ? ' rh2-file-primary' : '') + '">'
        + (f.previewKind
          ? '<button type="button" class="rh2-btn" onclick="RH2.previewFile(\'' + esc(f.id) + '\')" '
            + 'aria-describedby="rh2-file-meta-' + esc(f.id) + '">Preview</button>'
          : '')
        + '<a class="rh2-btn ' + (f.isPrimary ? 'rh2-btn-primary' : '') + '" '
        + 'href="' + esc(f.downloadUrl) + '" download '
        + 'aria-describedby="rh2-file-meta-' + esc(f.id) + '">'
        + esc(fileActionLabel(f)) + '</a>'
        + (f.regenerateUrl
          ? '<button type="button" class="rh2-btn rh2-btn-quiet" title="Regenerate the cached preview and thumbnail" '
            + 'onclick="RH2.regenPreview(\'' + esc(f.id) + '\')">Rebuild preview</button>'
          : '')
        + '<span class="rh2-file-meta" id="rh2-file-meta-' + esc(f.id) + '">'
        + esc(f.fileName || '') + (meta ? ' <span class="rh2-quiet">(' + esc(meta) + ')</span>' : '')
        + (restricted
          ? ' <span class="rh2-file-tier">' + esc(tierLabel(f.effectiveAccessTier)) + '</span>'
          : '')
        + '</span>'
        + '</li>';
    }
    out += '</ul></section>';
    return out;
  }

  function tierLabel(tier) {
    if (tier === 'clinician') return 'Clinician access';
    if (tier === 'admin') return 'Administrator access';
    return '';
  }

  function renderDetail() {
    var st = S.detail;
    var out = '<div class="rh2-page">' +
      '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.nav(\'' + esc(st.backView === 'detail' ? 'library' : st.backView) + '\')">Back</button>';
    if (st.loading || !st.data) return out + '<div class="rh2-card" style="margin-top:12px;">' + skel(4, 40) + '</div></div>';
    if (!st.data.ok) return out + '<div class="rh2-empty">' + esc(st.data.error || 'This resource could not be loaded.') + '</div></div>';

    var d = st.data, r = detailRes();
    var authority = pick(r, 'authority_level') || 'internal';
    var external = /^https?:\/\//i.test(String(pick(r, 'external_url') || pick(r, 'source_url') || ''));
    var extUrl = String(pick(r, 'external_url') || pick(r, 'source_url') || '');
    var regulatory = authority === 'official_regulatory' || authority === 'professional_body';
    // User state is server-computed and nested — the client never infers it.
    var us = pick(d, 'userState') || {};
    var acked = !!pick(us, 'acknowledgedCurrent');
    var completed = !!pick(us, 'completed');
    var fav = !!pick(us, 'favourited');
    var version = pick(r, 'version') || pick(d, 'current_version') || 1;
    var mins = pick(r, 'estimated_minutes');

    out += '<article class="rh2-article"><header class="rh2-article-head">' +
      '<div class="rh2-article-titlebar"><h1>' + esc(pick(r, 'title')) + '</h1>' + badges(r, { admin: true }) + '</div>' +
      '<div class="rh2-row-meta">' + esc(typeLabel(pick(r, 'content_type'))) +
      (mins ? ' · ' + esc(mins) + ' min' : '') +
      (pick(r, 'status') && pick(r, 'status') !== 'approved' ? ' · <span class="rh2-chip">' + esc(String(pick(r, 'status')).replace(/_/g, ' ')) + '</span>' : '') +
      (pick(r, 'mandatory') ? ' · <span class="rh2-chip rh2-chip-warn">Required</span>' : '') +
      (pick(r, 'last_reviewed_at') ? ' · Last reviewed ' + esc(fmtDate(pick(r, 'last_reviewed_at'))) : '') +
      '</div>';

    // Tutorial resources with an interactive walkthrough lead with it: the
    // written page below stays as reference material. typeof-guarded bridge.
    var indMod = (typeof global.OpalInduction !== 'undefined' && global.OpalInduction.moduleForSlug)
      ? global.OpalInduction.moduleForSlug(pick(r, 'slug')) : null;
    if (indMod) {
      var indLabel = indMod.state === 'in_progress' ? 'Continue interactive walkthrough'
        : (indMod.state === 'completed' || indMod.state === 'updated') ? 'Replay interactive walkthrough'
        : 'Start interactive walkthrough';
      out += '<div class="rh2-article-actions">' +
        '<button type="button" class="rh2-btn rh2-btn-primary" onclick="OpalInduction.start(\'' + esc(indMod.key) + '\')">' +
        indLabel + '</button>' +
        (indMod.state === 'completed' ? '<span class="rh2-chip rh2-chip-ok">Walkthrough completed</span>' : '') +
        (indMod.state === 'updated' ? '<span class="rh2-chip rh2-chip-warn">Walkthrough updated since you completed it</span>' : '') +
        '</div>';
    }

    if (canWrite()) {
      out += '<div class="rh2-article-actions">' +
        '<button type="button" class="rh2-btn" aria-pressed="' + fav + '" onclick="RH2.toggleFav()">' + (fav ? 'Saved' : 'Save') + '</button>' +
        '<button type="button" class="rh2-btn" aria-pressed="' + completed + '" onclick="RH2.toggleComplete()">' + (completed ? 'Completed' : 'Mark complete') + '</button>';
      if (pick(r, 'acknowledgement_required') && !acked) {
        if (st.ackConfirm) {
          out += '<span class="rh2-ack-confirm">Confirm you have read and understood version ' + esc(version) + '. ' +
            '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.ackConfirm()">Confirm</button>' +
            '<button type="button" class="rh2-btn" onclick="RH2.ackCancel()">Cancel</button></span>';
        } else {
          out += '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.ackStart()">Acknowledge</button>';
        }
      } else if (pick(r, 'acknowledgement_required') && acked) {
        out += '<span class="rh2-chip rh2-chip-ok">Acknowledged</span>';
      }
      out += '</div>';
    }
    out += '</header>';

    // External resources are signposts: the destination is the resource, so
    // the way out is the hero, not a footnote in the info panel.
    if (external && !((st.files || []).length)) {
      out += '<section class="rh2-card rh2-external-hero">'
        + '<span class="rh2-ext-glyph">' + icn('forward') + '</span>'
        + '<span class="rh2-ext-main"><span class="rh2-ext-domain">' + esc(hostname(extUrl)) + '</span>'
        + '<span class="rh2-quiet">This resource opens on the publisher’s website.</span></span>'
        + '<a class="rh2-btn rh2-btn-primary" href="' + esc(extUrl) + '" target="_blank" rel="noopener noreferrer">'
        + 'Open resource</a>'
        + '</section>';
    }

    // Hosted documents lead with the document: first-page thumbnail, preview.
    out += renderDetailHero();

    // Content
    var content = pick(r, 'content');
    out += '<div class="rh2-content">';
    if (content) out += mdRender(content);
    else if (pick(r, 'description')) out += '<p>' + esc(pick(r, 'description')) + '</p>';
    else if (!external && !(st.files || []).length) out += '<p class="rh2-quiet">No content yet.</p>';
    out += '</div>';

    // Info panel
    out += '<aside class="rh2-info" aria-label="Resource information">' +
      kvRow('Owner', esc(pick(r, 'content_owner_name') || pick(r, 'owner_name') || '')) +
      kvRow('Version', esc(version)) +
      kvRow('Last reviewed', esc(fmtDate(pick(r, 'last_reviewed_at')))) +
      kvRow('Next review', esc(fmtDate(pick(r, 'review_due_at') || pick(r, 'next_review_at')))) +
      (external ? kvRow('Official source', '<a href="' + esc(extUrl) + '" target="_blank" rel="noopener noreferrer">Check current source</a>') : '') +
      kvRow('Source', esc([pick(r, 'source_publisher'), pick(r, 'source_title')].filter(Boolean).join(' — '))) +
      kvRow('Source verified', esc(fmtDate(pick(r, 'source_verified_at'))));
    if (regulatory) {
      out += '<p class="rh2-disclaimer">This summary is provided for convenience. The official source remains the authoritative version — always check it for current requirements.</p>';
    }
    out += '</aside>';

    out += renderDetailFiles();
    out += renderGovernance(r);

    // Quiz
    var quiz = pick(d, 'quiz');
    if (quiz && (quiz.questions || []).length) out += renderQuiz(quiz);

    // Related
    var related = pick(d, 'related') || [];
    if (related.length) {
      out += '<section class="rh2-card" aria-labelledby="rh2-h-rel"><h2 id="rh2-h-rel">Related resources</h2>' +
        related.map(function (rr) { return homeResRow(rr); }).join('') + '</section>';
    }

    // Feedback
    if (canWrite()) {
      out += '<section class="rh2-card" aria-labelledby="rh2-h-fb"><h2 id="rh2-h-fb">Feedback</h2>' +
        '<p class="rh2-quiet">Do not include participant-identifying information in Resource Hub feedback.</p>';
      if (st.fbDone) out += '<p class="rh2-quiet">Thanks — your feedback has been recorded.</p>';
      else {
        out += '<div class="rh2-fb-row">' + [['helpful', 'Helpful'], ['needs_update', 'Needs updating'], ['missing', 'Something missing']].map(function (k) {
          return '<button type="button" class="rh2-btn' + (st.fbKind === k[0] ? ' rh2-btn-primary' : '') + '" aria-pressed="' + (st.fbKind === k[0]) + '" onclick="RH2.fbSelect(\'' + k[0] + '\')">' + k[1] + '</button>';
        }).join('') + '</div>';
        if (st.fbKind) {
          out += '<label class="rh2-lbl" for="rh2-fb-comment">Comment (optional)</label>' +
            '<textarea id="rh2-fb-comment" class="rh2-input" rows="2" maxlength="1000"></textarea>' +
            '<button type="button" class="rh2-btn rh2-btn-primary" style="margin-top:8px;" onclick="RH2.fbSubmit()">Send feedback</button>';
          // Support bridge: content problems can become a tracked ticket.
          // Guarded so the hub keeps working if the support module is absent.
          if ((st.fbKind === 'needs_update' || st.fbKind === 'missing') &&
              typeof window.OpalSupport !== 'undefined' && window.OpalSupport.openReport) {
            out += '<p class="rh2-quiet" style="margin-top:8px;">Needs a fix rather than a note? ' +
              '<a href="#" onclick="RH2.raiseTicket();return false;">Raise a support ticket</a></p>';
          }
        }
      }
      out += '</section>';
    }

    // Version history
    var versions = pick(d, 'versions') || [];
    if (versions.length) {
      out += '<section class="rh2-card"><button type="button" class="rh2-collapse" aria-expanded="' + st.showVersions + '" onclick="RH2.toggleVersions()">Version history (' + versions.length + ')</button>';
      if (st.showVersions) {
        out += versions.map(function (v) {
          return '<div class="rh2-ver"><span class="rh2-ver-no">v' + esc(pick(v, 'version')) + '</span>' +
            '<span class="rh2-ver-date">' + esc(fmtDate(pick(v, 'created_at'))) + '</span>' +
            '<span class="rh2-chip">' + esc(pick(v, 'change_kind') || 'minor') + '</span>' +
            (pick(v, 'change_note') ? '<span class="rh2-row-sub">' + esc(pick(v, 'change_note')) + '</span>' : '') + '</div>';
        }).join('');
      }
      out += '</section>';
    }

    return out + '</article></div>';
  }

  function renderQuiz(quiz) {
    var st = S.detail;
    var out = '<section class="rh2-card rh2-quiz" aria-labelledby="rh2-h-quiz"><h2 id="rh2-h-quiz">Knowledge check</h2>';
    if (st.quizResult) {
      var qr = st.quizResult;
      out += '<p class="rh2-quiz-result ' + (qr.passed ? 'pass' : 'fail') + '">' +
        'Score: ' + esc(qr.score) + ' of ' + esc(qr.total) + ' — ' + (qr.passed ? 'passed' : 'not passed yet') + '.</p>';
      if (!qr.passed) out += '<button type="button" class="rh2-btn" onclick="RH2.quizRetry()">Try again</button>';
      return out + '</section>';
    }
    out += (quiz.questions || []).map(function (q, i) {
      var opts = pick(q, 'options') || [];
      if (pick(q, 'kind') === 'true_false' && !opts.length) opts = ['True', 'False'];
      return '<fieldset class="rh2-quiz-q"><legend>' + (i + 1) + '. ' + esc(pick(q, 'question')) + '</legend>' +
        opts.map(function (o, j) {
          var id = 'rh2-q' + i + 'o' + j;
          return '<div class="rh2-quiz-opt"><input type="radio" name="rh2-q' + i + '" id="' + id + '" value="' + j + '">' +
            '<label for="' + id + '">' + esc(o) + '</label></div>';
        }).join('') + '</fieldset>';
    }).join('');
    out += '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.quizSubmit()">Submit answers</button>';
    return out + '</section>';
  }

  function detailUserState() {
    var st = S.detail;
    if (!st.data || !st.data.ok) return null;
    if (!st.data.userState) st.data.userState = {};
    return st.data.userState;
  }

  /** Cmd+Z bridge (typeof-guarded like the OpalSupport bridge): after a
   *  successful favourite/complete toggle, register the inverse toggle with
   *  the portal's global undo stack. The resource id and direction are
   *  captured, so the undo stays correct even after navigating away; the UI
   *  only re-renders when that detail view is still open. Acknowledgements
   *  and quiz attempts are append-only by design — never registered. */
  function registerToggleUndo(label, id, endpoint, on, field) {
    if (typeof global.OpalUndo === 'undefined' || !global.OpalUndo.register) return;
    global.OpalUndo.register({ label: label, undo: async function () {
      var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/' + endpoint,
        { method: on ? 'DELETE' : 'POST' });
      if (!d.ok) throw new Error(d.error || 'undo failed');
      var st = S.detail;
      if (st && st.id === id && st.data && st.data.ok) {
        (st.data.userState = st.data.userState || {})[field] = !on;
        render();
      }
    } });
  }

  async function toggleFav() {
    var us = detailUserState(); if (!us) return;
    var st = S.detail;
    var id = st.id;
    var on = !us.favourited;
    us.favourited = on; // optimistic; reverted on failure
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/favourite', { method: on ? 'POST' : 'DELETE' });
    if (!d.ok) { us.favourited = !on; render(); toast('Could not update', d.error || 'Please try again.'); return; }
    registerToggleUndo(on ? 'Favourite added' : 'Favourite removed', id, 'favourite', on, 'favourited');
  }

  async function toggleComplete() {
    var us = detailUserState(); if (!us) return;
    var st = S.detail;
    var id = st.id;
    var on = !us.completed;
    us.completed = on; // optimistic; reverted on failure
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/complete', { method: on ? 'POST' : 'DELETE' });
    if (!d.ok) { us.completed = !on; render(); toast('Could not update', d.error || 'Please try again.'); return; }
    registerToggleUndo(on ? 'Marked complete' : 'Marked incomplete', id, 'complete', on, 'completed');
  }

  function ackStart() { S.detail.ackConfirm = true; render(); }
  function ackCancel() { S.detail.ackConfirm = false; render(); }
  async function ackConfirmFn() {
    var st = S.detail;
    var d = await api('/api/rh2/resources/' + encodeURIComponent(st.id) + '/acknowledge', { method: 'POST' });
    if (d.ok) {
      toast('Acknowledged', 'Your acknowledgement has been recorded.');
      // Re-fetch so the server recomputes version-aware userState — the
      // client never infers acknowledgement state.
      await openDetail(st.id, st.backView);
    } else {
      toast('Could not acknowledge', d.error || 'Please try again.');
      render();
    }
  }

  function fbSelect(kind) { S.detail.fbKind = kind; render(); }
  async function fbSubmit() {
    var st = S.detail;
    var comment = (doc.getElementById('rh2-fb-comment') || {}).value || '';
    var d = await api('/api/rh2/resources/' + encodeURIComponent(st.id) + '/feedback', {
      method: 'POST', body: { kind: st.fbKind, comment: comment.trim() || undefined },
    });
    if (d.ok) { st.fbDone = true; render(); }
    else toast('Could not send feedback', d.error || 'Please try again.');
  }

  function toggleVersions() { S.detail.showVersions = !S.detail.showVersions; render(); }

  /** Support bridge — opens the portal's report modal prefilled for this
   *  resource. typeof-guarded: nothing breaks when the module is absent. */
  function raiseTicket() {
    if (typeof window.OpalSupport === 'undefined' || !window.OpalSupport.openReport) return;
    var r = detailRes() || {};
    var title = String(pick(r, 'title') || 'resource');
    window.OpalSupport.openReport({
      type: 'resource_issue',
      title: ('Issue with "' + title + '"').slice(0, 200),
      technicalContext: { resourceId: S.detail.id },
    });
  }

  async function quizSubmit() {
    var st = S.detail;
    var quiz = pick(st.data, 'quiz') || {};
    var qs = quiz.questions || [];
    var answers = [];
    for (var i = 0; i < qs.length; i++) {
      var checked = doc.querySelector('input[name="rh2-q' + i + '"]:checked');
      if (!checked) { toast('Not finished', 'Answer every question before submitting.'); return; }
      answers.push(Number(checked.value));
    }
    var d = await api('/api/rh2/resources/' + encodeURIComponent(st.id) + '/quiz-attempt', {
      method: 'POST', body: { answers: answers },
    });
    if (d.ok) { st.quizResult = { score: pick(d, 'score'), total: pick(d, 'total'), passed: !!pick(d, 'passed') }; render(); }
    else toast('Could not submit', d.error || 'Please try again.');
  }
  function quizRetry() { S.detail.quizResult = null; render(); }

  // ── MY LEARNING ───────────────────────────────────────────────────────────

  async function loadLearning() {
    S.learning.loading = true;
    render();
    var results = await Promise.all([
      api('/api/rh2/learning'),
      api('/api/rh2/cpd'),
      api('/api/rh2/cpd/summary'),
      api('/api/rh2/pd'),
    ]);
    var d = results[0], cpdList = results[1], cpdSummary = results[2], pd = results[3];
    S.learning.loading = false;
    S.learning.data = d.ok ? d : { ok: false, error: d.error };
    S.learning.cpd = {
      entries: cpdList.ok ? (cpdList.entries || []) : [],
      summary: cpdSummary.ok ? cpdSummary : null,
    };
    S.learning.pd = pd.ok ? { upcoming: pd.upcoming || [], past: pd.past || [] } : null;
    render();
  }

  function pathStatus(done, total, required) {
    if (total && done >= total) return '<span class="rh2-chip rh2-chip-ok">Completed</span>';
    if (done > 0) return '<span class="rh2-chip">In progress</span>';
    return '<span class="rh2-chip rh2-chip-quiet">Not started</span>' + (required ? ' <span class="rh2-chip rh2-chip-warn">Required</span>' : '');
  }

  function renderLearning() {
    var st = S.learning;
    var out = '<div class="rh2-page"><h1 class="rh2-h1">My Learning</h1>';

    // Owner-assigned learning leads: it is the formal, monitored work — the
    // walkthroughs and starter paths below are self-serve.
    out += renderMyAssignments();

    // The interactive induction dashboard follows. It renders from the
    // induction engine's own state, so it appears even while the path
    // data below is still loading. typeof-guarded bridge.
    if (typeof global.OpalInduction !== 'undefined' && global.OpalInduction.dashboardHtml) {
      out += global.OpalInduction.dashboardHtml();
    }

    if (st.loading || !st.data) return out + '<div class="rh2-card">' + skel(3, 64) + '</div></div>';
    if (!st.data.ok) return out + '<div class="rh2-empty">' + esc(st.data.error || 'My Learning could not be loaded.') + '</div></div>';

    var paths = pick(st.data, 'paths') || [];
    if (!paths.length) out += '<div class="rh2-empty">No learning paths are set up yet.</div>';
    else out += paths.map(function (p) {
      var items = pick(p, 'items') || [];
      var done = items.filter(function (it) { return pick(it, 'completed'); }).length;
      var pct = items.length ? Math.round(done / items.length * 100) : 0;
      return '<section class="rh2-card rh2-path"><div class="rh2-path-head">' +
        '<h2>' + esc(pick(p, 'name')) + '</h2>' + pathStatus(done, items.length, pick(p, 'required')) +
        '</div>' +
        (pick(p, 'description') ? '<p class="rh2-quiet">' + esc(pick(p, 'description')) + '</p>' : '') +
        '<div class="rh2-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(pick(p, 'name')) + ' progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="rh2-row-sub" style="margin:4px 0 10px;">' + done + ' of ' + items.length + ' modules · ' + pct + '%</div>' +
        '<ol class="rh2-modules">' + items.map(function (it, i) {
          var mins = pick(it, 'estimated_minutes') || pick(it, 'minutes');
          var ack = pick(it, 'acknowledgement_required')
            ? (pick(it, 'acknowledged') ? ' <span class="rh2-chip rh2-chip-ok">Acknowledged</span>' : ' <span class="rh2-chip rh2-chip-warn">Acknowledge</span>')
            : '';
          return '<li><button type="button" class="rh2-module" onclick="RH2.openDetail(\'' + esc(pick(it, 'resource_id') || pick(it, 'id')) + '\',\'learning\')">' +
            '<span class="rh2-module-no">' + (i + 1) + '</span>' +
            '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(pick(it, 'title')) + ack + '</span>' +
            '<span class="rh2-row-sub">' + (mins ? esc(mins) + ' min' : '') + '</span></span>' +
            (pick(it, 'completed') ? '<span class="rh2-module-done" aria-label="Completed">' + icn('check', 'check') + '</span>' : '') +
            '</button></li>';
        }).join('') + '</ol></section>';
    }).join('');

    // Professional development — upcoming plus a collapsed Past section, so
    // therapists can reach past events without the admin area.
    var pd = st.pd;
    if (pd) {
      var pdRow = function (e) {
        var hours2 = pick(e, 'cpd_hours');
        return '<div class="rh2-pd-row"><div class="rh2-pd-date">' + esc(fmtDateTime(pick(e, 'starts_at'))) + '</div>' +
          '<div class="rh2-row-title">' + esc(pick(e, 'title')) + '</div>' +
          '<div class="rh2-row-sub">' + esc(pick(e, 'provider') || '') +
          (hours2 ? (pick(e, 'provider') ? ' · ' : '') + esc(hours2) + ' CPD hours' : '') + '</div></div>';
      };
      out += '<section class="rh2-card" aria-labelledby="rh2-h-lpd"><h2 id="rh2-h-lpd">Professional development</h2>';
      if (!pd.upcoming.length) out += '<p class="rh2-quiet">No upcoming PD events listed.</p>';
      else out += pd.upcoming.map(pdRow).join('');
      if (pd.past.length) {
        out += '<button type="button" class="rh2-collapse" aria-expanded="' + !!st.pdPastOpen +
          '" onclick="RH2.pdPastToggle()">Past (' + pd.past.length + ')</button>';
        if (st.pdPastOpen) out += pd.past.map(pdRow).join('');
      }
      out += '</section>';
    }

    // CPD summary — hours come from GET /api/rh2/cpd/summary (registration
    // year totals), entries from GET /api/rh2/cpd.
    var cpd = st.cpd || {};
    var summary = pick(cpd, 'summary') || {};
    var entries = pick(cpd, 'entries') || [];
    var hours = Number(pick(summary, 'totalHours') || 0);
    var interactive = Number(pick(summary, 'interactiveHours') || 0);
    out += '<section class="rh2-card" data-help="rh2-cpd" aria-labelledby="rh2-h-cpd"><h2 id="rh2-h-cpd">CPD this registration year</h2>' +
      '<div class="rh2-cpd-stats"><div class="rh2-cpd-stat"><span class="rh2-cpd-n">' + hours.toFixed(1) + '</span><span class="rh2-row-sub">hours logged</span></div>' +
      '<div class="rh2-cpd-stat"><span class="rh2-cpd-n">' + interactive.toFixed(1) + '</span><span class="rh2-row-sub">interactive hours</span></div></div>' +
      '<p class="rh2-quiet">This tracker is informational only — your professional body’s own CPD record remains the authoritative source.</p>';

    if (canWrite()) {
      if (S.learning.cpdOpen) {
        out += '<div class="rh2-form"><div class="rh2-form-grid">' +
          '<div><label class="rh2-lbl" for="rh2-cpd-date">Date</label><input type="date" id="rh2-cpd-date" class="rh2-input"></div>' +
          '<div><label class="rh2-lbl" for="rh2-cpd-activity">Activity</label><input type="text" id="rh2-cpd-activity" class="rh2-input" maxlength="300"></div>' +
          '<div><label class="rh2-lbl" for="rh2-cpd-provider">Provider</label><input type="text" id="rh2-cpd-provider" class="rh2-input" maxlength="200"></div>' +
          '<div><label class="rh2-lbl" for="rh2-cpd-hours">Hours</label><input type="number" id="rh2-cpd-hours" class="rh2-input" step="0.25" min="0"></div>' +
          '<div><label class="rh2-lbl" for="rh2-cpd-int">Interactive hours</label><input type="number" id="rh2-cpd-int" class="rh2-input" step="0.25" min="0"></div>' +
          '</div>' +
          '<label class="rh2-lbl" for="rh2-cpd-reflection">Reflection</label>' +
          '<textarea id="rh2-cpd-reflection" class="rh2-input" rows="2"></textarea>' +
          '<div class="rh2-form-actions">' +
          '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.cpdSave()">Add entry</button>' +
          '<button type="button" class="rh2-btn" onclick="RH2.cpdToggle()">Cancel</button></div></div>';
      } else {
        out += '<button type="button" class="rh2-btn" onclick="RH2.cpdToggle()">Add CPD entry</button>';
      }
    }

    if (entries.length) {
      out += '<div class="rh2-cpd-list">' + entries.map(function (e) {
        return '<div class="rh2-cpd-entry"><span class="rh2-cpd-date">' + esc(fmtDate(pick(e, 'activity_date'))) + '</span>' +
          '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(pick(e, 'activity')) + '</span>' +
          '<span class="rh2-row-sub">' + esc(pick(e, 'provider') || '') +
          (pick(e, 'reflection') ? ' · ' + esc(pick(e, 'reflection')) : '') + '</span></span>' +
          '<span class="rh2-cpd-hrs">' + esc(Number(pick(e, 'hours') || 0)) + ' h' +
          (Number(pick(e, 'interactive_hours') || 0) ? ' (' + esc(Number(pick(e, 'interactive_hours'))) + ' interactive)' : '') + '</span></div>';
      }).join('') + '</div>';
    }
    out += '</section>';
    return out + '</div>';
  }

  function cpdToggle() { S.learning.cpdOpen = !S.learning.cpdOpen; render(); }
  function pdPastToggle() { S.learning.pdPastOpen = !S.learning.pdPastOpen; render(); }

  async function cpdSave() {
    var val = function (id) { return (doc.getElementById(id) || {}).value || ''; };
    // Body keys match POST /api/rh2/cpd: activityDate, activity, provider,
    // hours, interactiveHours, reflection.
    var body = {
      activityDate: val('rh2-cpd-date'),
      activity: val('rh2-cpd-activity').trim(),
      provider: val('rh2-cpd-provider').trim() || undefined,
      hours: Number(val('rh2-cpd-hours') || 0),
      interactiveHours: Number(val('rh2-cpd-int') || 0),
      reflection: val('rh2-cpd-reflection').trim() || undefined,
    };
    if (!body.activityDate || !body.activity) { toast('Missing details', 'A date and activity are required.'); return; }
    var d = await api('/api/rh2/cpd', { method: 'POST', body: body });
    if (d.ok) { S.learning.cpdOpen = false; toast('CPD entry added', 'Your CPD record has been updated.'); loadLearning(); }
    else toast('Could not save', d.error || 'Please try again.');
  }

  // ── ADMIN ─────────────────────────────────────────────────────────────────

  var R2_STATUSES = ['draft', 'submitted_for_review', 'approved', 'needs_update', 'archived', 'rejected'];

  function adminTabs() {
    var tabs = [['content', 'Content'], ['pd', 'PD Events'], ['feedback', 'Feedback'], ['analytics', 'Analytics']];
    // Learning administration is OWNER-ONLY (matching the server: workflow
    // authoring and assignment are HR-style controls, not admin scheduling).
    if (isOwner()) tabs.splice(1, 0, ['learning', 'Learning']);
    // Source review is a governance task: owner and admin only, like Sources.
    if (canReview()) tabs.splice(1, 0, ['sourcereview', 'Source review']);
    // The ingestion register accounts for the catalogued source vault. It is
    // administrative rather than a library view, so it sits at the end.
    if (canReview()) tabs.push(['ingestion', 'Ingestion register']);
    if (isOwner()) tabs.splice(1, 0, ['sources', 'Sources'], ['links', 'Quick Links']);
    return tabs;
  }

  function loadAdminTab() {
    var t = S.admin.tab;
    if (t === 'content') loadAdminContent();
    else if (t === 'learning') loadLa();
    else if (t === 'sourcereview') loadSourceReview();
    else if (t === 'sources') loadAdminSources();
    else if (t === 'pd') loadAdminPd();
    else if (t === 'feedback') loadAdminFeedback();
    else if (t === 'links') loadAdminLinks();
    else if (t === 'ingestion') loadIngestion();
    else if (t === 'analytics') loadAdminAnalytics();
  }

  function adminNav(t) { S.admin.tab = t; S.admin.err = ''; loadAdminTab(); render(); }

  async function loadAdminContent() {
    S.admin.loading = true; render();
    var qs = [];
    if (S.admin.status) qs.push('status=' + encodeURIComponent(S.admin.status));
    if (S.admin.q) qs.push('q=' + encodeURIComponent(S.admin.q));
    var d = await api('/api/rh2/resources' + (qs.length ? '?' + qs.join('&') : ''));
    S.admin.loading = false;
    S.admin.list = d.ok ? (d.resources || []) : [];
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }
  async function loadAdminSources() {
    S.admin.loading = true; render();
    var d = await api('/api/rh2/sources');
    S.admin.loading = false;
    S.admin.sources = d.ok ? (d.sources || []) : [];
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }
  async function loadAdminPd() {
    S.admin.loading = true; render();
    var d = await api('/api/rh2/pd');
    S.admin.loading = false;
    S.admin.pd = d.ok ? [].concat(d.upcoming || [], d.past || []) : [];
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }
  async function loadAdminFeedback() {
    S.admin.loading = true; render();
    var d = await api('/api/rh2/admin/analytics');
    S.admin.loading = false;
    S.admin.feedback = d.ok ? (d.feedback || []) : [];
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }
  async function loadAdminLinks() {
    S.admin.loading = true; render();
    var d = await api('/api/rh2/quick-links');
    S.admin.loading = false;
    S.admin.links = d.ok ? (d.links || d.quick_links || d.quickLinks || []) : [];
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }
  async function loadAdminAnalytics() {
    S.admin.loading = true; render();
    // Induction completion rides along with hub analytics: same audience
    // (owner/admin), same screen. Its failure never blanks the hub numbers.
    var results = await Promise.all([
      api('/api/rh2/admin/analytics'),
      api('/api/tutorials/overview'),
    ]);
    var d = results[0], ind = results[1];
    S.admin.loading = false;
    S.admin.analytics = d.ok ? d : null;
    S.admin.induction = ind.ok ? (ind.staff || []) : null;
    S.admin.err = d.ok ? '' : (d.error || '');
    render();
  }

  function renderAdmin() {
    if (!canAdmin()) return '<div class="rh2-empty">This area is available to practice administrators only.</div>';
    var a = S.admin;
    var out = '<div class="rh2-page"><h1 class="rh2-h1">Hub administration</h1>' +
      '<div class="rh2-subnav" role="tablist" aria-label="Administration sections">' + adminTabs().map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (a.tab === t[0]) + '" class="rh2-subnav-btn' + (a.tab === t[0] ? ' active' : '') + '" onclick="RH2.adminNav(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>';
    if (a.err) out += '<div class="rh2-empty">' + esc(a.err) + '</div>';

    if (a.tab === 'content') out += renderAdminContent();
    else if (a.tab === 'learning') out += renderLa();
    else if (a.tab === 'sourcereview') out += renderSourceReview();
    else if (a.tab === 'sources') out += renderAdminSources();
    else if (a.tab === 'pd') out += renderAdminPd();
    else if (a.tab === 'feedback') out += renderAdminFeedback();
    else if (a.tab === 'links') out += renderAdminLinks();
    else if (a.tab === 'ingestion') out += renderIngestion();
    else if (a.tab === 'analytics') out += renderAdminAnalytics();
    return out + '</div>';
  }

  /* ── Ingestion register ───────────────────────────────────────────────────
     Accounts for every catalogued source file, including the ones that must
     never become a resource. The headline is the reconciliation figure: if the
     register stops totalling the catalogue size, that is stated plainly rather
     than smoothed over, because a register that has quietly lost records is
     worse than no register.

     Private records are listed with a generated label and no other detail. The
     server sends nothing identifying for them — their filename, title, path and
     checksum are NULL in the database — so there is nothing here to hide. */

  var ING_TREATMENT_LABELS = {
    'reconciled-existing': 'Already held',
    'live-official-link': 'Official source',
    'live-vendor-link': 'Vendor resource',
    'controlled-register': 'Controlled instrument',
    'staff-only': 'Staff-only',
    'opal-original-draft': 'Opal original draft',
    'rights-review': 'Licensing review required',
    'privacy-excluded': 'Private — excluded',
    'duplicate-archived': 'Duplicate archived',
    'unavailable-placeholder': 'Unavailable source file',
    'rejected-quality': 'Rejected on quality',
    superseded: 'Superseded',
  };

  var ING_STATUS_LABELS = {
    'needs-link-verification': 'Link verification required',
    'needs-human-review': 'Human review required',
    registered: 'Registered',
    imported: 'Imported',
    excluded: 'Excluded',
    archived: 'Archived',
    blocked: 'Blocked',
    held: 'Held',
  };

  function ingLabel(t) { return ING_TREATMENT_LABELS[t] || t; }

  async function loadIngestion() {
    var a = S.admin;
    a.ingLoading = true; a.err = ''; render();
    try {
      var q = a.ingTreatment ? '?treatment=' + encodeURIComponent(a.ingTreatment) + '&limit=200' : '?limit=200';
      var res = await Promise.all([
        api('/api/rh2/admin/ingestion/summary'),
        api('/api/rh2/admin/ingestion/records' + q),
        api('/api/rh2/admin/ingestion/cleanroom'),
      ]);
      a.ing = res[0]; a.ingRecords = res[1]; a.ingCleanroom = res[2];
    } catch (e) {
      a.err = 'Could not load the ingestion register.';
    }
    a.ingLoading = false; render();
  }

  function renderIngestion() {
    var a = S.admin;
    if (a.ingLoading || !a.ing) return '<div class="rh2-card">' + skel(5, 44) + '</div>';
    var s = a.ing;

    var out = '<div class="rh2-card">' +
      '<h2 class="rh2-h2">Source catalogue accounting</h2>' +
      '<p class="rh2-muted">Every catalogued file has one recorded outcome. Most must never become a ' +
      'Resource Hub resource; a register entry records the decision, not an intention to publish.</p>' +
      '<p class="rh2-ing-total' + (s.reconciles ? '' : ' rh2-ing-total-bad') + '">' +
      '<strong>' + esc(String(s.total)) + '</strong> of <strong>' + esc(String(s.expectedTotal)) + '</strong>' +
      ' catalogue records accounted for' +
      (s.reconciles ? ' — reconciles.' : ' — DOES NOT RECONCILE. Investigate before relying on these figures.') +
      '</p></div>';

    // Counts by treatment. Clicking one filters the list below.
    out += '<div class="rh2-card"><h3 class="rh2-h3">By treatment</h3><div class="rh2-ing-grid">';
    Object.keys(s.byTreatment).forEach(function (k) {
      var active = a.ingTreatment === k;
      out += '<button type="button" class="rh2-ing-tile' + (active ? ' active' : '') + '" ' +
        'onclick="RH2.ingFilter(\'' + esc(active ? '' : k) + '\')">' +
        '<span class="rh2-ing-n">' + esc(String(s.byTreatment[k])) + '</span>' +
        '<span class="rh2-ing-l">' + esc(ingLabel(k)) + '</span></button>';
    });
    out += '</div></div>';

    out += '<div class="rh2-card"><h3 class="rh2-h3">Work outstanding</h3><div class="rh2-ing-grid">';
    Object.keys(s.byIngestionStatus).forEach(function (k) {
      out += '<div class="rh2-ing-tile"><span class="rh2-ing-n">' + esc(String(s.byIngestionStatus[k])) + '</span>' +
        '<span class="rh2-ing-l">' + esc(ING_STATUS_LABELS[k] || k) + '</span></div>';
    });
    out += '</div></div>';

    out += '<div class="rh2-card"><h3 class="rh2-h3">Controlled instruments and clean-room drafts</h3>' +
      '<p class="rh2-muted">' + esc(String(s.instrumentsMapped)) + ' instruments cover ' +
      esc(String(s.instrumentRecordsMapped)) + ' catalogue records. No instrument document is held.</p>';
    if (a.ingCleanroom) {
      out += '<p class="rh2-muted">' + esc(String(a.ingCleanroom.drafted)) + ' clean-room drafts written, ' +
        esc(String(a.ingCleanroom.blocked)) + ' blocked pending clinical or legal review.</p>' +
        '<div class="rh2-list">' + a.ingCleanroom.items.map(function (i) {
          return '<div class="rh2-adm-row"><span class="rh2-row-main">' +
            '<span class="rh2-row-title">' + esc(i.title || i.catalogue_id) + '</span>' +
            '<span class="rh2-row-sub">' + esc(i.risk_tier) +
            (i.resource_id ? ' · draft written' : ' · blocked') +
            (i.blocker_note ? ' · ' + esc(String(i.blocker_note).slice(0, 120)) : '') +
            '</span></span></div>';
        }).join('') + '</div>';
    }
    out += '</div>';

    var recs = a.ingRecords || { records: [], total: 0 };
    out += '<div class="rh2-card"><h3 class="rh2-h3">Records' +
      (a.ingTreatment ? ' — ' + esc(ingLabel(a.ingTreatment)) : '') +
      ' <span class="rh2-muted">(' + esc(String(recs.total)) + ')</span></h3>';
    if (a.ingTreatment) {
      out += '<button type="button" class="rh2-btn" onclick="RH2.ingFilter(\'\')">Show all</button>';
    }
    if (!recs.records.length) {
      out += '<div class="rh2-empty">No records match.</div>';
    } else {
      out += '<div class="rh2-list">' + recs.records.map(function (r) {
        return '<div class="rh2-adm-row"><span class="rh2-row-main">' +
          '<span class="rh2-row-title">' + esc(r.title || r.catalogueId) + '</span>' +
          '<span class="rh2-row-sub">' + esc(r.catalogueId) + ' · ' + esc(ingLabel(r.treatment)) +
          ' · ' + esc(ING_STATUS_LABELS[r.ingestionStatus] || r.ingestionStatus) +
          (r.officialUrl ? ' · linked' : '') +
          (r.duplicateOf ? ' · duplicate of ' + esc(r.duplicateOf) : '') +
          '</span></span>' +
          '<span class="rh2-chip">' + esc(ingLabel(r.treatment)) + '</span></div>';
      }).join('') + '</div>';
      if (recs.total > recs.records.length) {
        out += '<p class="rh2-muted">Showing ' + esc(String(recs.records.length)) + ' of ' +
          esc(String(recs.total)) + '. Filter by treatment to narrow.</p>';
      }
    }
    return out + '</div>';
  }

  /* ── Unresolved source review ─────────────────────────────────────────────
     Lists resources whose authorship nobody has established. The evidence
     already on each record is shown so a reviewer can judge — labelled as
     evidence, never as a suggestion. The UI proposes no answer and pre-selects
     nothing.

     The two decisions are deliberately separate controls. Recording who wrote
     something does not touch rights: that is enforced server-side, and the
     response says so explicitly, but the form is laid out to make it obvious
     too. Removing a logo has never been a rights status. */

  function renderSourceReview() {
    if (!canReview()) {
      return '<div class="rh2-empty">Source review is available to owners and administrators.</div>';
    }
    var q = S.sourceReview;
    if (q.loading) return '<div class="rh2-card">' + skel(4, 40) + '</div>';
    if (q.err) return '<div class="rh2-empty">' + esc(q.err) + '</div>';
    if (!q.data) return '<div class="rh2-card">' + skel(3, 40) + '</div>';

    var items = q.data.items || [];
    var total = q.data.total || 0;
    var out = '<section class="rh2-card" aria-labelledby="rh2-sr-h">'
      + '<h2 id="rh2-sr-h">Unresolved source classifications</h2>'
      + '<p class="rh2-quiet">' + esc(q.data.evidenceNote || '') + '</p>'
      + '<p class="rh2-quiet" role="status">' + total + ' resource'
      + (total === 1 ? '' : 's') + ' awaiting review.</p>';

    if (!items.length) {
      return out + '<p class="rh2-empty">Nothing is awaiting source review.</p></section>';
    }

    out += '<div class="rh2-sr-controls">'
      + '<label class="rh2-visually-hidden" for="rh2-sr-q">Search unresolved resources</label>'
      + '<input id="rh2-sr-q" class="rh2-input" type="search" placeholder="Search title or publisher…" '
      + 'value="' + esc(q.q || '') + '" oninput="RH2.sourceReviewSearch(this.value)">'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.sourceReviewClear()">Clear</button>'
      + '</div>';

    out += '<ul class="rh2-sr-list">';
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var ev = it.evidence || {};
      out += '<li class="rh2-sr-item">'
        + '<h3 class="rh2-sr-title">' + esc(it.title) + '</h3>'
        + '<p class="rh2-quiet">' + esc(it.resourceType || '') + '</p>'
        + '<dl class="rh2-sr-evidence">'
        + '<dt>Publisher string on the record</dt><dd>' + esc(ev.publisherString || 'none recorded') + '</dd>'
        + '<dt>Cited source</dt><dd>' + esc(ev.citedSourceTitle || 'none recorded') + '</dd>'
        + '<dt>Authority level</dt><dd>' + esc(ev.authorityLevel || 'none recorded') + '</dd>'
        + '</dl>'
        + '<p class="rh2-sr-warn">Evidence only. This does not establish authorship or any right to redistribute.</p>'
        + '<div class="rh2-sr-form">'
        + '<label for="rh2-sr-class-' + esc(it.id) + '">Source class</label>'
        + '<select id="rh2-sr-class-' + esc(it.id) + '" class="rh2-select">'
        + '<option value="">— not decided —</option>'
        + ['opal-original', 'government-official', 'nonprofit', 'standardised-instrument',
           'commercial', 'provider-company', 'internal'].map(function (c) {
             return '<option value="' + c + '">' + c + '</option>';
           }).join('')
        + '</select>'
        + '<label for="rh2-sr-pub-' + esc(it.id) + '">Actual publisher (optional)</label>'
        + '<input id="rh2-sr-pub-' + esc(it.id) + '" class="rh2-input" type="text" '
        + 'placeholder="Who published this work">'
        + '<label for="rh2-sr-rights-' + esc(it.id) + '">Rights status (separate decision)</label>'
        + '<select id="rh2-sr-rights-' + esc(it.id) + '" class="rh2-select">'
        + '<option value="">— leave unchanged —</option>'
        + ['opal-owned', 'licensed-for-portal', 'official-link-only', 'reference-only',
           'restricted', 'unknown'].map(function (c) {
             return '<option value="' + c + '">' + c + '</option>';
           }).join('')
        + '</select>'
        + '<p class="rh2-quiet">Leaving rights unchanged is the safe default. Classifying who wrote '
        + 'something grants no permission to host or redistribute it.</p>'
        + '<label for="rh2-sr-reason-' + esc(it.id) + '">Reason or evidence note (required)</label>'
        + '<textarea id="rh2-sr-reason-' + esc(it.id) + '" class="rh2-input" rows="2"></textarea>'
        + '<button type="button" class="rh2-btn rh2-btn-primary" '
        + 'onclick="RH2.submitSourceReview(\'' + esc(it.id) + '\')">Record decision</button>'
        + '</div></li>';
    }
    out += '</ul>';

    // Pagination — the catalogue is larger than one page and the queue must not
    // silently truncate.
    var limit = q.data.limit || 25;
    var offset = q.data.offset || 0;
    var from = total ? offset + 1 : 0;
    var to = Math.min(offset + limit, total);
    out += '<div class="rh2-sr-pager" role="navigation" aria-label="Source review pages">'
      + '<span class="rh2-quiet" role="status">Showing ' + from + '–' + to + ' of ' + total + '</span>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (offset <= 0 ? 'disabled' : '')
      + ' onclick="RH2.sourceReviewPage(-1)">Previous</button>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (to >= total ? 'disabled' : '')
      + ' onclick="RH2.sourceReviewPage(1)">Next</button>'
      + '</div>';
    return out + '</section>';
  }

  /* ── Controlled instrument register ───────────────────────────────────────
     Metadata and permitted use only. No instrument content is fetched, stored
     or rendered — the register links to an implementing module (WHODAS) rather
     than reproducing anything. Unresolved fields are shown as unresolved, so a
     blank licence never reads as an approved one. */

  /* ── Professional development ─────────────────────────────────────────────
     A catalogue over the SAME pd_events the Home preview and the admin tab
     already use — no second store, no separate sync. An event an administrator
     adds appears here immediately.

     Booking always happens on the provider's site. Nothing here is styled as an
     in-app booking control, because Opal has no booking integration and a
     button that looked like one would be a promise the product cannot keep. */

  function money(cents) {
    if (cents === null || cents === undefined) return null;
    if (cents === 0) return 'Free';
    return '$' + (cents / 100).toFixed(2).replace(/\.00$/, '');
  }

  var PD_MODE_LABEL = { online: 'Online', in_person: 'In person', hybrid: 'Hybrid' };

  async function loadPd() {
    var st = S.pd;
    st.loading = true; st.err = ''; render();
    var qs = ['when=' + encodeURIComponent(st.when), 'limit=' + st.limit, 'offset=' + st.offset];
    if (st.q) qs.push('q=' + encodeURIComponent(st.q));
    if (st.mode) qs.push('mode=' + encodeURIComponent(st.mode));
    if (st.topic) qs.push('topic=' + encodeURIComponent(st.topic));
    if (st.cost) qs.push('cost=' + encodeURIComponent(st.cost));
    if (st.cpd) qs.push('cpd=1');
    var d = await api('/api/rh2/pd/catalogue?' + qs.join('&'));
    st.loading = false;
    if (d.ok) { st.data = d; st.facets = d.facets || null; }
    else { st.data = null; st.err = d.error || 'Professional development is unavailable right now.'; }
    render();
  }

  var pdDebounce = null;
  function pdSearch(v) {
    S.pd.q = v; S.pd.offset = 0;
    if (pdDebounce) clearTimeout(pdDebounce);
    pdDebounce = setTimeout(loadPd, 320);
  }
  function pdFilter(k, v) { S.pd[k] = v; S.pd.offset = 0; loadPd(); }
  function pdClear() {
    S.pd.q = ''; S.pd.mode = ''; S.pd.topic = ''; S.pd.cost = ''; S.pd.cpd = '';
    S.pd.offset = 0; loadPd();
  }
  function pdPage(dir) {
    S.pd.offset = Math.max(0, S.pd.offset + dir * S.pd.limit);
    loadPd();
  }

  /** Open one event. Reached from the Home preview and from the catalogue. */
  /**
   * Move focus to the new page's heading after a full re-render.
   *
   * render() replaces the hub's entire DOM, which destroys whatever had focus
   * and drops it to <body>. A keyboard user was left at the top of the document
   * with no announcement that the page had changed, and a screen-reader user
   * heard nothing at all. Focusing the heading both announces the new page and
   * puts the next Tab press in the right place.
   *
   * tabindex="-1" makes the heading programmatically focusable without adding
   * it to the tab sequence.
   */
  function focusHeading(selector) {
    if (typeof document === 'undefined') return;
    var el = document.querySelector(selector);
    if (!el) return;
    el.setAttribute('tabindex', '-1');
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { /* no-op */ } }
  }

  async function openPd(id) {
    S.view = 'pd';
    S.pd.openId = id;
    S.pd.detail = null; S.pd.detailErr = ''; S.pd.detailLoading = true;
    render();
    var d = await api('/api/rh2/pd/' + encodeURIComponent(id));
    if (S.pd.openId !== id) return;              // navigated on
    S.pd.detailLoading = false;
    if (d.ok) S.pd.detail = d.event;
    else S.pd.detailErr = d.status === 404
      ? 'This event is no longer listed.'
      : (d.error || 'This event could not be loaded.');
    render();
    focusHeading('.rh2-pdd-title, .rh2-page > .rh2-empty');
    // Load the catalogue behind the event so returning to it — by Back, or by
    // the hub's own navigation — lands on a populated list.
    if (!S.pd.data) loadPd();
  }

  function renderPd() {
    if (S.pd.openId) return renderPdDetail();

    var st = S.pd;
    var out = '<div class="rh2-page"><h1 class="rh2-h1">Professional development</h1>'
      + '<p class="rh2-quiet">Courses, workshops and events from external providers. '
      + 'Booking is completed on the provider\'s own website.</p>';

    // ── Controls ──
    out += '<div class="rh2-pd-controls">'
      + '<label class="rh2-visually-hidden" for="rh2-pd-q">Search professional development</label>'
      + '<input id="rh2-pd-q" class="rh2-input" type="search" placeholder="Search title, provider or topic…" '
      + 'value="' + esc(st.q) + '" oninput="RH2.pdSearch(this.value)">'
      + sel('rh2-pd-mode', 'All delivery modes',
          (st.facets ? st.facets.modes : ['online', 'in_person', 'hybrid'])
            .map(function (m) { return [m, PD_MODE_LABEL[m] || m]; }),
          st.mode, "RH2.pdFilter('mode',this.value)")
      + sel('rh2-pd-topic', 'All topics',
          (st.facets && st.facets.topics ? st.facets.topics : []).map(function (t) { return [t, t]; }),
          st.topic, "RH2.pdFilter('topic',this.value)")
      + sel('rh2-pd-cost', 'Any cost', [['free', 'Free'], ['paid', 'Paid']], st.cost,
          "RH2.pdFilter('cost',this.value)")
      + '<span class="rh2-check"><input type="checkbox" id="rh2-pd-cpd"' + (st.cpd ? ' checked' : '')
      + ' onchange="RH2.pdFilter(\'cpd\', this.checked ? \'1\' : \'\')">'
      + '<label for="rh2-pd-cpd">CPD hours only</label></span>'
      + '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.pdClear()">Clear</button>'
      + '</div>';

    out += '<div class="rh2-subnav" role="tablist" aria-label="When">'
      + ['upcoming', 'past'].map(function (w) {
          return '<button type="button" role="tab" aria-selected="' + (st.when === w) + '" '
            + 'class="rh2-subnav-btn' + (st.when === w ? ' active' : '') + '" '
            + 'onclick="RH2.pdFilter(\'when\',\'' + w + '\')">'
            + (w === 'upcoming' ? 'Upcoming' : 'Past') + '</button>';
        }).join('') + '</div>';

    if (st.loading) return out + '<div class="rh2-card">' + skel(4, 44) + '</div></div>';
    if (st.err) {
      return out + '<div class="rh2-empty"><p>' + esc(st.err) + '</p>'
        + '<button type="button" class="rh2-btn" onclick="RH2.pdReload()">Try again</button></div></div>';
    }
    if (!st.data) return out + '<div class="rh2-card">' + skel(3, 44) + '</div></div>';

    var events = st.data.events || [];
    var total = st.data.total || 0;
    out += '<p class="rh2-quiet" role="status">' + total + ' event' + (total === 1 ? '' : 's')
      + (st.when === 'past' ? ' (past)' : '') + '</p>';

    if (!events.length) {
      out += '<div class="rh2-empty">No professional development matches these filters. '
        + 'Try clearing them, or check the Past tab.</div></div>';
      return out;
    }

    out += '<ul class="rh2-pd-list">';
    for (var i = 0; i < events.length; i++) out += renderPdCard(events[i]);
    out += '</ul>';

    var from = total ? st.offset + 1 : 0;
    var to = Math.min(st.offset + st.limit, total);
    if (total > st.limit) {
      out += '<div class="rh2-pd-pager" role="navigation" aria-label="Pages">'
        + '<span class="rh2-quiet" role="status">Showing ' + from + '–' + to + ' of ' + total + '</span>'
        + '<button type="button" class="rh2-btn rh2-btn-quiet"' + (st.offset <= 0 ? ' disabled' : '')
        + ' onclick="RH2.pdPage(-1)">Previous</button>'
        + '<button type="button" class="rh2-btn rh2-btn-quiet"' + (to >= total ? ' disabled' : '')
        + ' onclick="RH2.pdPage(1)">Next</button></div>';
    }
    return out + '</div>';
  }

  /**
   * One catalogue entry.
   *
   * Same column shape as the home preview — fixed-width date/time, then the
   * content — so a therapist reads both surfaces the same way. The extra line
   * here is the restrained metadata run; it is deliberately last and quietest,
   * because mode, location, cost and CPD hours are what you check AFTER an
   * event has caught your eye, not what you scan for.
   *
   * Missing values simply do not render. An event with no location, no price
   * and no CPD hours produces a row with no metadata line rather than a row of
   * empty labels.
   */
  function renderPdCard(e) {
    var bits = [];
    if (e.mode) bits.push(PD_MODE_LABEL[e.mode] || e.mode);
    if (e.location) bits.push(e.location);
    var cost = money(e.costCents);
    if (cost) bits.push(cost);
    if (e.cpdHours) bits.push(e.cpdHours + ' CPD hours');

    var when = fmtDateParts(e.startsAt);
    var spoken = whenLabel(when);
    var label = e.title + (e.provider ? ', ' + e.provider : '')
      + (spoken ? ', ' + spoken : '')
      + (bits.length ? ', ' + bits.join(', ') : '');

    return '<li class="rh2-pdc-item">'
      + '<button type="button" class="rh2-pdc-row" onclick="RH2.openPd(\'' + esc(e.id) + '\')" '
      + 'aria-label="' + esc(label) + '">'
      + '<span class="rh2-pdc-when" aria-hidden="true">'
      + '<span class="rh2-pdc-date">' + esc(when.date) + '</span>'
      + (when.time ? '<span class="rh2-pdc-time">' + esc(when.time) + '</span>' : '')
      + '</span>'
      + '<span class="rh2-pdc-main">'
      + '<span class="rh2-pdc-title">' + esc(e.title) + '</span>'
      + (e.provider ? '<span class="rh2-pdc-provider">' + esc(e.provider) + '</span>' : '')
      + (bits.length ? '<span class="rh2-pdc-meta">' + esc(bits.join(' · ')) + '</span>' : '')
      + '</span></button></li>';
  }

  /** Small outward-pointing arrow. Decorative — the label carries the meaning. */
  var EXTERNAL_ICON = '<svg class="rh2-ext-icon" viewBox="0 0 16 16" width="13" height="13" '
    + 'aria-hidden="true" focusable="false">'
    + '<path d="M6.5 3.5h-3v9h9v-3" fill="none" stroke="currentColor" stroke-width="1.4" '
    + 'stroke-linecap="round"/>'
    + '<path d="M9.5 2.5h4v4M13.5 2.5 8 8" fill="none" stroke="currentColor" stroke-width="1.4" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /**
   * One event.
   *
   * There is no in-page "back" control: 'Professional development' is a
   * permanent item in the hub navigation and returns here cleanly, so a second
   * route back was redundant chrome on every event page. Browser Back works
   * because opening an event now writes '#resources/pd/<id>' — see the openPd
   * hook in navigation.js.
   *
   * The booking panel sits immediately after the heading in DOM order, so on a
   * phone it appears with the key details rather than below the whole record.
   * On wide screens the grid lifts it into a right-hand action column without
   * changing that order, which keeps the reading and tab sequence identical at
   * every width.
   */
  function renderPdDetail() {
    var st = S.pd;
    var out = '<div class="rh2-page">';

    if (st.detailLoading) return out + '<div class="rh2-card">' + skel(5, 34) + '</div></div>';
    if (st.detailErr) return out + '<div class="rh2-empty">' + esc(st.detailErr) + '</div></div>';
    var e = st.detail;
    if (!e) return out + '</div>';

    out += '<article class="rh2-pdd">'
      + '<header class="rh2-pdd-head">'
      + '<h1 class="rh2-pdd-title">' + esc(e.title) + '</h1>'
      + '<p class="rh2-pdd-when">' + esc(fmtDateTime(e.startsAt))
      + (e.endsAt ? ' – ' + esc(fmtDateTime(e.endsAt)) : '')
      + (e.timezone ? ' (' + esc(e.timezone) + ')' : '')
      + (e.provider ? '<span class="rh2-pdd-provider"> · ' + esc(e.provider) + '</span>' : '')
      + '</p></header>';

    // ── One booking action ──────────────────────────────────────────────────
    // A single primary control, an explicit new-tab label for screen readers,
    // and one short line saying where booking actually happens. Nothing here
    // suggests Opal takes the booking, because Opal has no booking integration.
    out += '<aside class="rh2-pdd-action" aria-labelledby="rh2-h-book">'
      + '<h2 id="rh2-h-book" class="rh2-pdd-action-h">Booking</h2>';
    if (e.bookingUrl) {
      out += '<a class="rh2-btn rh2-btn-primary rh2-pdd-cta" href="' + esc(e.bookingUrl) + '" '
        + 'target="_blank" rel="noopener noreferrer">'
        + '<span>View and book on provider website</span>' + EXTERNAL_ICON
        + '<span class="rh2-visually-hidden"> (opens in a new tab)</span></a>'
        + '<p class="rh2-pdd-note">Booking is completed on the provider\'s website.</p>';
    } else {
      out += '<p class="rh2-pdd-note">No booking link was recorded for this event. '
        + 'Contact the provider directly.</p>';
    }
    if (e.sourceUrl && e.sourceUrl !== e.bookingUrl) {
      out += '<a class="rh2-pdd-alt" href="' + esc(e.sourceUrl) + '" '
        + 'target="_blank" rel="noopener noreferrer">Event listing' + EXTERNAL_ICON
        + '<span class="rh2-visually-hidden"> (opens in a new tab)</span></a>';
    }
    out += '</aside>';

    out += '<div class="rh2-pdd-body">';
    if (e.description) out += '<div class="rh2-content"><p>' + esc(e.description) + '</p></div>';
    out += '<aside class="rh2-info" aria-label="Event information">'
      + kvRow('Provider', esc(e.provider || 'Not stated'))
      + kvRow('Delivery', esc(PD_MODE_LABEL[e.mode] || e.mode || ''))
      + kvRow('Location', esc(e.location || ''))
      + kvRow('Cost', esc(money(e.costCents) || 'Not stated'))
      + kvRow('CPD hours', e.cpdHours ? esc(String(e.cpdHours)) : '')
      + kvRow('Topic', esc(e.topic || ''))
      + kvRow('Listing source', esc(e.sourceName || (e.providerKey === 'manual' ? 'Added by your practice' : e.providerKey)))
      + kvRow('Last updated', esc(fmtDate(e.updatedAt)))
      + '</aside></div>';

    return out + '</article></div>';
  }

  /* ── Assessments ──────────────────────────────────────────────────────────
     The catalogue of standardised assessments, their information pages, and
     the client selection that starts one.

     WHAT CHANGED, AND WHY IT HAD TO
     This tab used to decide "may this be used?" from the governance register
     alone: rights_status had to be 'licensed-for-use' or 'official-link-only'
     AND clinical_status had to be 'current'. Both default to 'unreviewed', so
     every assessment in the list — including WHODAS 2.0, whose authoritative
     WHO source documents ship with this application — rendered the same
     sentence: "cannot be started yet: its rights and clinical review are not
     confirmed." A clinician could not tell an instrument we hold in full from
     one we hold nothing of, and neither could be opened.

     Two different questions had been folded into one. Governance review is
     real, and it is still shown on every information page. What decides
     whether a button appears is now a checkable fact — does the portal hold
     the instrument? — and the server answers it per assessment in
     `availability.state`, one of five values rather than a single blanket no.

     WHERE STARTING GOES
     Choosing a client opens the assessment's own full page (#assessment/...).
     It does NOT open the client profile drawer, which was the previous
     behaviour: that drawer carries appointment history, invoices and a "Book
     appointment" action, so selecting a client for WHODAS put the clinician in
     the appointment experience instead of the assessment. */

  var AVAILABILITY_LABELS = {
    'electronic-and-pdf': 'Electronic and PDF',
    electronic: 'Available electronically',
    pdf: 'PDF available',
    'source-required': 'Source required',
    'temporarily-unavailable': 'Temporarily unavailable',
  };

  function availLabel(a) {
    if (!a) return 'Unknown';
    return AVAILABILITY_LABELS[a.state] || a.label || a.state || 'Unknown';
  }

  function assessBadge(a) {
    var state = (a && a.state) || 'unknown';
    return '<span class="rh2-avail rh2-avail--' + esc(state) + '">' + esc(availLabel(a)) + '</span>';
  }

  /** Can this assessment be opened for a client, by this user, right now? */
  function assessActionable(r) {
    if (!canAdministerAssessment()) return false;
    var a = r && r.availability;
    return !!(a && (a.canStart || a.canDownloadBlank));
  }

  function startAssessment(key) {
    S.assess = { key: key, q: '', results: null, loading: false, err: '', starting: false };
    render();
  }

  /**
   * Client selection, rendered INLINE above the catalogue rather than in a
   * modal — this module states at the top of the file that confirmations and
   * forms are inline panels, and a dialog here would be the only one in the hub.
   *
   * Choosing a client is the LAST thing that happens here: the pathways
   * (complete on screen, print a blank form, upload a completed one, email)
   * all live on the assessment page, together with that client's history, so
   * there is one place where an assessment is worked on rather than two.
   */
  function renderAssessPanel() {
    var a = S.assess;
    if (!a) return '';
    var def = findInstrument(a.key);
    var title = def ? (def.abbreviation || def.name) : 'assessment';

    var h = '<section class="rh2-card rh2-assess-panel" aria-labelledby="rh2-as-h">'
      + '<h2 id="rh2-as-h">Start ' + esc(title) + '</h2>'
      + '<p>Choose the client this assessment is for. It opens on its own page, '
      + 'with their assessment history.</p>'
      + '<label class="rh2-visually-hidden" for="rh2-as-q">Search clients</label>'
      + '<input id="rh2-as-q" class="rh2-input" type="search" placeholder="Search by name…" '
      + 'value="' + esc(a.q) + '" oninput="RH2.assessSearch(this.value)" autocomplete="off">';

    if (a.starting) h += '<p class="rh2-quiet" role="status">Opening the assessment…</p>';
    else if (a.loading) h += '<p class="rh2-quiet" role="status">Searching…</p>';
    else if (a.err) h += '<p class="rh2-empty" role="status">' + esc(a.err) + '</p>';
    else if (a.results && !a.results.length) h += '<p class="rh2-quiet" role="status">No clients match.</p>';
    else if (a.results) {
      h += '<ul class="rh2-as-list">' + a.results.slice(0, 12).map(function (c) {
        return '<li><button type="button" class="rh2-btn rh2-as-client" '
          + 'onclick="RH2.assessPick(\'' + esc(c.id) + '\')">'
          + esc(c.fullName || c.preferredName || 'Unnamed client') + '</button></li>';
      }).join('') + '</ul>';
    } else {
      h += '<p class="rh2-quiet">Type at least two characters to search.</p>';
    }

    h += '<div class="rh2-as-actions">'
      + '<button type="button" class="rh2-btn" onclick="RH2.assessCancel()">Cancel</button></div>';
    return h + '</section>';
  }

  var assessDebounce = null;

  function assessClearDebounce() {
    if (assessDebounce) { clearTimeout(assessDebounce); assessDebounce = null; }
  }

  /**
   * The panel state object is captured at schedule time and re-checked on both
   * sides of the request. Cancelling the panel — or picking a client — inside
   * the debounce window used to leave a timer that fired against a null
   * S.assess and threw out of a setTimeout, where nothing could catch it.
   * Identity, not `key`: the same key is used every time the panel reopens.
   */
  function assessSearch(v) {
    if (!S.assess) return;
    var a = S.assess;
    a.q = v;
    assessClearDebounce();
    if (String(v || '').trim().length < 2) { a.results = null; a.err = ''; render(); return; }
    var q = v;
    assessDebounce = setTimeout(async function () {
      assessDebounce = null;
      if (S.assess !== a) return;                     // panel closed or replaced
      a.loading = true; a.err = ''; render();
      // The client search shared by the document builders — org-scoped, live
      // from Splose, never fabricated.
      var d = await api('/api/fca/clients?q=' + encodeURIComponent(q));
      if (S.assess !== a) return;                     // closed while in flight
      a.loading = false;
      if (d.ok) a.results = d.clients || [];
      else { a.results = []; a.err = d.error || 'Client search is unavailable.'; }
      render();
    }, 300);
  }

  /**
   * Client chosen → the assessment's own page.
   *
   * The one function this must never call is openClientProfile(). That is the
   * appointment-centric client drawer, and routing an assessment through it is
   * the regression this replaces.
   */
  function assessPick(id) {
    var c = (S.assess.results || []).find(function (x) { return String(x.id) === String(id); });
    if (!c) return;
    var key = S.assess.key;
    S.assess.starting = true;
    render();
    openAssessmentPage(key, c.id, c.fullName || c.preferredName || null);
  }

  function assessCancel() { assessClearDebounce(); S.assess = null; render(); }

  /** Hand off to the assessment surface. One caller, one destination. */
  function openAssessmentPage(key, clientId, clientName) {
    assessClearDebounce();
    S.assess = null;
    render();
    if (global.Assess && typeof global.Assess.openForClient === 'function') {
      global.Assess.openForClient(key, clientId, clientName);
      return;
    }
    // The surface script has not loaded. Say so rather than silently doing
    // something else — least of all opening an unrelated panel.
    S.instruments.err = 'The assessment surface is not available in this browser session. '
      + 'Reload the page and try again.';
    render();
  }

  function findInstrument(key) {
    return (S.instruments.data || []).find(function (r) { return r.key === key; }) || null;
  }

  // — Catalogue —

  function renderInstruments() {
    var st = S.instruments;
    if (st.openKey) return renderInstrumentDetail();
    if (st.loading) return '<div class="rh2-card">' + skel(4, 40) + '</div>';
    if (st.err) return '<div class="rh2-empty">' + esc(st.err) + '</div>';
    var rows = st.data || [];
    var out = renderAssessPanel();

    out += '<section class="rh2-card" aria-labelledby="rh2-inst-h">'
      + '<h2 id="rh2-inst-h">Assessments</h2>'
      + '<p class="rh2-quiet">Standardised assessments the practice uses. Each one shows what '
      + 'can be done with it here: completed on screen, issued as a form, or — where the portal '
      + 'does not hold the instrument — exactly which source documents are still needed. Opal is '
      + 'never the rights holder of an assessment; every entry names whose work it is.</p>';

    if (!rows.length) return out + '<p class="rh2-empty">No assessments are configured.</p></section>';

    out += '<ul class="rh2-inst-list">';
    rows.forEach(function (r) {
      var av = r.availability || {};
      out += '<li class="rh2-inst">'
        + '<div class="rh2-inst-top">'
        + '<h3 class="rh2-inst-name">' + esc(r.abbreviation) + ' <span class="rh2-quiet">'
        + esc(r.name) + '</span></h3>'
        + assessBadge(av)
        + '</div>';

      if (r.description) out += '<p class="rh2-inst-desc">' + esc(r.description) + '</p>';
      else if (av.summary) out += '<p class="rh2-inst-desc">' + esc(av.summary) + '</p>';

      out += '<div class="rh2-inst-actions">'
        + '<button type="button" class="rh2-btn" onclick="RH2.openInstrument(\'' + esc(r.key) + '\')">'
        + 'About this assessment</button>';
      if (assessActionable(r)) {
        out += '<button type="button" class="rh2-btn rh2-btn-primary" '
          + 'onclick="RH2.startAssessment(\'' + esc(r.key) + '\')">'
          + (av.canStart ? 'Start assessment' : 'Open for a client') + '</button>';
      }
      out += '</div>';

      if (av.state === 'temporarily-unavailable' && av.reason) {
        out += '<p class="rh2-inst-unresolved">' + esc(av.reason) + '</p>';
      } else if (av.state === 'source-required') {
        out += '<p class="rh2-inst-unresolved">Not held by the portal — see '
          + '“About this assessment” for the documents required.</p>';
      }
      out += '</li>';
    });
    return out + '</ul></section>';
  }

  // — Information page —

  /**
   * Everything a clinician needs before administering it: what it measures,
   * whose it is, what the portal can do with it, what its scoring produces,
   * and where its governance review stands. The review is INFORMATION here,
   * not a gate.
   */
  function renderInstrumentDetail() {
    var st = S.instruments;
    if (st.detailLoading) return '<div class="rh2-card">' + skel(5, 40) + '</div>';
    if (st.detailErr) return '<div class="rh2-empty">' + esc(st.detailErr) + '</div>';
    var r = st.detail;
    if (!r) return '<div class="rh2-empty">This assessment could not be found.</div>';

    var av = r.availability || {};
    var out = renderAssessPanel();

    out += '<section class="rh2-card" aria-labelledby="rh2-instd-h">';
    out += '<button type="button" class="rh2-back" onclick="RH2.closeInstrument()">'
      + '&larr; Back to Assessments</button>';
    out += '<div class="rh2-inst-top">'
      + '<h2 id="rh2-instd-h">' + esc(r.abbreviation) + ' <span class="rh2-quiet">'
      + esc(r.name) + '</span></h2>' + assessBadge(av) + '</div>';

    if (r.description) out += '<p>' + esc(r.description) + '</p>';
    if (av.summary) out += '<p class="rh2-quiet">' + esc(av.summary) + '</p>';
    if (av.reason) out += '<p class="rh2-inst-unresolved">' + esc(av.reason) + '</p>';

    out += '<div class="rh2-inst-actions">';
    if (assessActionable(r)) {
      out += '<button type="button" class="rh2-btn rh2-btn-primary" '
        + 'onclick="RH2.startAssessment(\'' + esc(r.key) + '\')">'
        + (av.canStart ? 'Start assessment' : 'Open for a client') + '</button>';
    }
    out += '</div>';

    // Attribution. Never omitted, never Opal's.
    var at = r.attribution || {};
    out += '<h3>Source and attribution</h3><dl class="rh2-inst-kv">'
      + '<dt>Rights holder</dt><dd>' + esc(at.rightsHolder || 'not yet confirmed') + '</dd>'
      + '<dt>Version</dt><dd>' + esc(r.edition || 'not yet confirmed') + '</dd>';
    if (at.sourceTitle) out += '<dt>Source document</dt><dd>' + esc(at.sourceTitle) + '</dd>';
    if (at.copyright) out += '<dt>Copyright</dt><dd>' + esc(at.copyright) + '</dd>';
    out += '</dl>';
    if (at.sourceNote) out += '<p class="rh2-inst-notes">' + esc(at.sourceNote) + '</p>';
    if (r.notes) out += '<p class="rh2-inst-notes">' + esc(r.notes) + '</p>';

    // Structure — counts and domain names only. No item wording ever appears
    // outside the instrument's own document.
    if (r.structure) {
      out += '<h3>What it covers</h3><p class="rh2-quiet">'
        + esc(String(r.structure.itemCount)) + ' items'
        + (r.structure.conditionalItemIds && r.structure.conditionalItemIds.length
          ? esc(', ' + r.structure.conditionalItemIds.length
              + ' of which are administered only when the respondent works or studies')
          : '')
        + '.</p>';
      if (r.structure.domains && r.structure.domains.length) {
        out += '<ul class="rh2-inst-domains">' + r.structure.domains.map(function (d) {
          return '<li><strong>' + esc(d.title) + '</strong> <span class="rh2-quiet">'
            + esc(String(d.itemCount)) + ' items</span></li>';
        }).join('') + '</ul>';
      }
    }
    if (r.administrationMethods && r.administrationMethods.length) {
      out += '<h3>Administration</h3><ul class="rh2-inst-domains">'
        + r.administrationMethods.map(function (m) {
          return '<li>' + esc(m.name) + '</li>';
        }).join('') + '</ul>';
    }

    // Scoring and interpretation, strictly as the source states them.
    if (r.interpretation) {
      out += '<h3>Scoring and interpretation</h3><dl class="rh2-inst-kv">'
        + '<dt>Scale</dt><dd>' + esc(r.interpretation.scale || '—') + '</dd>'
        + '<dt>Interpretation</dt><dd>' + esc(r.interpretation.statement || '—') + '</dd>'
        + '<dt>Stated in</dt><dd>' + esc(r.interpretation.source || '—') + '</dd>'
        + '</dl>';
      if (r.interpretation.cutPointsNote) {
        out += '<p class="rh2-inst-notes">' + esc(r.interpretation.cutPointsNote) + '</p>';
      }
    }

    // What is missing, named, when anything is.
    var missing = av.missingSources || r.missingSources || [];
    if (missing.length) {
      out += '<h3>What is needed before this can be administered</h3>'
        + '<ul class="rh2-inst-domains">' + missing.map(function (m) {
          return '<li>' + esc(m) + '</li>';
        }).join('') + '</ul>'
        + '<p class="rh2-quiet">Supply these and the assessment becomes available here without '
        + 'any further change to the portal.</p>';
    }

    // Governance. Shown because a clinician should see it — not as a gate.
    var g = r.governance || {};
    out += '<h3>Governance review</h3>';
    if (!g.registered) {
      out += '<p class="rh2-quiet">' + esc(g.note || 'Not in the governance register.') + '</p>';
    } else {
      out += '<dl class="rh2-inst-kv">'
        + '<dt>Rights review</dt><dd>' + esc(String(g.rightsStatus || 'unreviewed')) + '</dd>'
        + '<dt>Clinical review</dt><dd>' + esc(String(g.clinicalStatus || 'unreviewed')) + '</dd>'
        + '<dt>Evidence checked</dt><dd>' + (g.evidenceChecked ? 'yes' : 'no') + '</dd>'
        + '<dt>Last reviewed</dt><dd>' + esc(g.reviewedAt ? fmtDate(g.reviewedAt) : 'never') + '</dd>'
        + '<dt>Permitted use</dt><dd>' + esc(g.permittedUse || 'not yet recorded') + '</dd>'
        + '</dl>';
      if (g.licensingNotes) out += '<p class="rh2-inst-notes">' + esc(g.licensingNotes) + '</p>';
      out += '<p class="rh2-quiet">Review status is recorded for governance. It describes what a '
        + 'person has confirmed about the licence, and is separate from whether the portal holds '
        + 'the instrument.</p>';
    }

    return out + '</section>';
  }

  async function loadSourceReview() {
    var q = S.sourceReview;
    q.loading = true; q.err = ''; render();
    var qs = ['limit=' + q.limit, 'offset=' + q.offset];
    if (q.q) qs.push('q=' + encodeURIComponent(q.q));
    var d = await api('/api/rh2/admin/source-review?' + qs.join('&'));
    q.loading = false;
    if (d.ok) q.data = d;
    else { q.data = null; q.err = d.error || 'The review queue is unavailable.'; }
    render();
  }

  function sourceReviewSearch(v) {
    S.sourceReview.q = v;
    S.sourceReview.offset = 0;
    if (srDebounce) clearTimeout(srDebounce);
    srDebounce = setTimeout(loadSourceReview, 320);
  }

  function sourceReviewClear() {
    S.sourceReview.q = '';
    S.sourceReview.offset = 0;
    loadSourceReview();
  }

  function sourceReviewPage(dir) {
    var q = S.sourceReview;
    q.offset = Math.max(0, q.offset + dir * q.limit);
    loadSourceReview();
  }

  /**
   * Sends whichever decisions the reviewer actually made. An untouched select
   * sends nothing at all — so leaving rights alone genuinely leaves it alone,
   * rather than posting a default that would overwrite it.
   */
  async function submitSourceReview(id) {
    var cls = (doc.getElementById('rh2-sr-class-' + id) || {}).value || '';
    var pub = (doc.getElementById('rh2-sr-pub-' + id) || {}).value || '';
    var rights = (doc.getElementById('rh2-sr-rights-' + id) || {}).value || '';
    var reason = (doc.getElementById('rh2-sr-reason-' + id) || {}).value || '';

    if (!reason.trim()) { toast('Reason required', 'Record why this decision was made.'); return; }
    if (!cls && !pub && !rights) { toast('Nothing to record', 'Choose a source class, publisher or rights status.'); return; }

    var body = { reason: reason };
    if (cls) body.sourceClass = cls;
    if (pub.trim()) body.publisher = pub.trim();
    if (rights) body.rightsStatus = rights;

    var d = await api('/api/rh2/admin/source-review/' + encodeURIComponent(id), { method: 'POST', body: body });
    if (!d.ok) { toast('Not recorded', d.error || 'Please try again.'); return; }
    toast('Recorded', d.note || 'Decision recorded.');
    loadSourceReview();
    loadClinicalVocabulary();
  }

  /** Does this user's role include the client list at all? */
  function canReachClients() {
    if (typeof global.navAllowedTabs !== 'function') return false;
    try { return global.navAllowedTabs(role()).indexOf('contacts') !== -1; }
    catch (e) { return false; }
  }

  function goToClients() {
    if (!canReachClients()) return;
    if (typeof global.switchTab === 'function') global.switchTab('contacts');
  }

  /**
   * The assessment catalogue.
   *
   * Read from /api/assessments/catalogue, not from the governance register:
   * the catalogue knows which assessments the portal actually holds and what
   * each one can do here, and it answers even when an instrument's module is
   * switched off — which is precisely the case a clinician needs told. The
   * register's review fields travel with each entry, for the information page.
   */
  async function loadInstruments() {
    var st = S.instruments;
    st.loading = true; st.err = ''; render();
    var d = await api('/api/assessments/catalogue');
    st.loading = false;
    if (d.ok) st.data = d.assessments || [];
    else { st.data = []; st.err = d.error || 'The assessment catalogue is unavailable.'; }
    render();
  }

  /** The information page for one assessment. A sub-view, with its own address. */
  async function openInstrument(key) {
    var st = S.instruments;
    st.openKey = key;
    st.detail = findInstrument(key);
    st.detailErr = '';
    st.detailLoading = !st.detail;
    S.view = 'instruments';
    render();
    var d = await api('/api/assessments/catalogue/' + encodeURIComponent(key));
    st.detailLoading = false;
    if (d.ok && d.assessment) st.detail = d.assessment;
    else if (!st.detail) st.detailErr = d.error || 'This assessment could not be loaded.';
    render();
    // Load the catalogue behind the information page. A deep link (or a
    // browser Back into one) reaches this function without going through
    // nav('instruments'), so without this "Back to Assessments" landed on
    // "No assessments are configured."
    if (!st.data && !st.loading) loadInstruments();
  }

  function closeInstrument() {
    S.instruments.openKey = null;
    S.instruments.detail = null;
    S.instruments.detailErr = '';
    render();
  }

  // — Content —

  function renderAdminContent() {
    var a = S.admin;
    var out = '<div class="rh2-filters">' +
      '<input type="search" class="rh2-search" placeholder="Search all content..." aria-label="Search all content" value="' + esc(a.q) + '" ' +
      'onkeydown="if(event.key===\'Enter\'){RH2.adminContentSearch(this.value)}">' +
      '<label class="rh2-visually-hidden" for="rh2-adm-status">Status</label>' +
      '<select id="rh2-adm-status" class="rh2-select" onchange="RH2.adminContentStatus(this.value)">' +
      '<option value="">All statuses</option>' + R2_STATUSES.map(function (s) {
        return '<option value="' + s + '"' + (a.status === s ? ' selected' : '') + '>' + s.replace(/_/g, ' ') + '</option>';
      }).join('') + '</select>' +
      '<span style="flex:1"></span>' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.adminNew()">New resource</button></div>';

    if (a.formOpen) out += renderResourceForm();

    if (a.loading || a.list === null) return out + '<div class="rh2-card">' + skel(4, 48) + '</div>';
    if (!a.list.length) return out + '<div class="rh2-empty">No content matches.</div>';

    out += '<div class="rh2-card rh2-list">' + a.list.map(function (r) {
      var status = String(pick(r, 'status') || 'draft');
      return '<div class="rh2-adm-row">' +
        '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(pick(r, 'title')) + '</span>' +
        '<span class="rh2-row-sub">' + esc(typeLabel(pick(r, 'content_type'))) + ' · ' + badges(r, { admin: true }) +
        (pick(r, 'mandatory') ? ' · required' : '') + '</span></span>' +
        '<span class="rh2-chip rh2-status-' + esc(status) + '">' + esc(status.replace(/_/g, ' ')) + '</span>' +
        '<span class="rh2-adm-actions">' +
        '<button type="button" class="rh2-btn" onclick="RH2.adminEdit(\'' + esc(pick(r, 'id')) + '\')">Edit</button>' +
        (status === 'draft' ? '<button type="button" class="rh2-btn" onclick="RH2.adminAction(\'' + esc(pick(r, 'id')) + '\',\'submit\')">Submit</button>' : '') +
        (isOwner() && (status === 'draft' || status === 'submitted_for_review' || status === 'needs_update')
          ? '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.adminAction(\'' + esc(pick(r, 'id')) + '\',\'approve\')">Approve</button>' : '') +
        (status !== 'archived' ? '<button type="button" class="rh2-btn" onclick="RH2.adminAction(\'' + esc(pick(r, 'id')) + '\',\'archive\')">Archive</button>' : '') +
        '</span></div>';
    }).join('') + '</div>';
    return out;
  }

  function adminContentSearch(v) { S.admin.q = v; loadAdminContent(); }
  function adminContentStatus(v) { S.admin.status = v; loadAdminContent(); }

  function adminNew() { S.admin.editing = {}; S.admin.formOpen = true; render(); }
  async function adminEdit(id) {
    var r = (S.admin.list || []).filter(function (x) { return String(pick(x, 'id')) === String(id); })[0];
    if (!r) return;
    S.admin.editing = r;
    S.admin.formOpen = true;
    render();
    // The list rows carry no collection membership — fetch the detail so the
    // form's collection checkboxes reflect (and can safely resave) reality.
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id));
    if (d.ok && S.admin.formOpen && S.admin.editing && String(pick(S.admin.editing, 'id')) === String(id)) {
      var merged = {};
      var full = d.resource || {};
      Object.keys(full).forEach(function (k) { merged[k] = full[k]; });
      merged.collections = d.collections || [];
      S.admin.editing = merged;
      render();
    }
    var el = doc.getElementById('rh2-form-title');
    if (el) el.focus();
  }
  function adminFormClose() {
    S.admin.formOpen = false;
    S.admin.editing = null;
    S.admin.fileInto = ''; S.admin.fileIntoName = '';
    render();
  }

  function renderResourceForm() {
    var r = S.admin.editing || {};
    var editing = !!pick(r, 'id');
    var isApproved = pick(r, 'status') === 'approved';
    var authority = pick(r, 'authority_level') || 'internal';
    var collections = ((S.home && S.home.collections) || []);
    // The backend contract takes collection KEYS, not UUIDs.
    var colKeys = (pick(r, 'collections') || pick(r, 'collection_keys') || []).map(function (c) {
      return String(typeof c === 'object' ? pick(c, 'key') : c);
    });
    var authOpts = Object.keys(AUTHORITY);
    var out = '<section class="rh2-card rh2-form" aria-label="' + (editing ? 'Edit resource' : 'New resource') + '">' +
      '<h2>' + (editing ? 'Edit resource' : 'New resource') + '</h2>' +
      // Started from a Library folder: say so, so nobody wonders later where
      // it went, and so the destination is visible before they commit to it.
      (!editing && S.admin.fileInto
        ? '<p class="rh2-quiet" role="status">This will be filed in <strong>'
          + esc(S.admin.fileIntoName || 'the folder you came from') + '</strong> when you save it.</p>'
        : '') +
      '<label class="rh2-lbl" for="rh2-form-title">Title</label>' +
      '<input type="text" id="rh2-form-title" class="rh2-input" maxlength="300" value="' + esc(pick(r, 'title') || '') + '">' +
      '<div class="rh2-form-grid">' +
      '<div><label class="rh2-lbl" for="rh2-form-type">Type</label><select id="rh2-form-type" class="rh2-select rh2-w100">' +
      CONTENT_TYPES.map(function (t) {
        return '<option value="' + t[0] + '"' + (pick(r, 'content_type') === t[0] ? ' selected' : '') + '>' + t[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="rh2-lbl" for="rh2-form-auth">Authority</label><select id="rh2-form-auth" class="rh2-select rh2-w100" onchange="RH2.adminFormAuthority(this.value)">' +
      authOpts.map(function (k) {
        return '<option value="' + k + '"' + (authority === k ? ' selected' : '') + '>' + AUTHORITY[k].label + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="rh2-lbl" for="rh2-form-mins">Estimated minutes</label>' +
      '<input type="number" id="rh2-form-mins" class="rh2-input" min="0" value="' + esc(pick(r, 'estimated_minutes') || '') + '"></div>' +
      '</div>' +
      '<label class="rh2-lbl" for="rh2-form-desc">Description</label>' +
      '<input type="text" id="rh2-form-desc" class="rh2-input" maxlength="500" value="' + esc(pick(r, 'description') || '') + '">' +
      '<label class="rh2-lbl" for="rh2-form-content">Content (markdown: ## headings, **bold**, - bullets, links)</label>' +
      '<textarea id="rh2-form-content" class="rh2-input" rows="10">' + esc(pick(r, 'content') || '') + '</textarea>';

    if (collections.length) {
      out += '<fieldset class="rh2-fieldset"><legend class="rh2-lbl">Collections</legend><div class="rh2-check-row">' +
        collections.map(function (c, i) {
          var id = 'rh2-form-col-' + i;
          var key = String(pick(c, 'key'));
          return '<span class="rh2-check"><input type="checkbox" id="' + id + '" class="rh2-form-col" value="' + esc(key) + '"' +
            (colKeys.indexOf(key) >= 0 ? ' checked' : '') + '><label for="' + id + '">' + esc(pick(c, 'name')) + '</label></span>';
        }).join('') + '</div></fieldset>';
    }

    var showSource = authority !== 'internal';
    out += '<div id="rh2-form-source" class="rh2-form-grid"' + (showSource ? '' : ' style="display:none;"') + '>' +
      '<div><label class="rh2-lbl" for="rh2-form-srcpub">Source publisher</label><input type="text" id="rh2-form-srcpub" class="rh2-input" value="' + esc(pick(r, 'source_publisher') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-form-srctitle">Source title</label><input type="text" id="rh2-form-srctitle" class="rh2-input" value="' + esc(pick(r, 'source_title') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-form-srcurl">Source URL</label><input type="url" id="rh2-form-srcurl" class="rh2-input" placeholder="https://" value="' + esc(pick(r, 'external_url') || pick(r, 'source_url') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-form-srcdate">Source effective date</label><input type="date" id="rh2-form-srcdate" class="rh2-input" value="' + esc(String(pick(r, 'source_effective_date') || '').slice(0, 10)) + '"></div>' +
      '</div>';

    out += '<div class="rh2-check-row" style="margin-top:10px;">' +
      '<span class="rh2-check"><input type="checkbox" id="rh2-form-mandatory"' + (pick(r, 'mandatory') ? ' checked' : '') + '><label for="rh2-form-mandatory">Mandatory</label></span>' +
      '<span class="rh2-check"><input type="checkbox" id="rh2-form-ack"' + (pick(r, 'acknowledgement_required') ? ' checked' : '') + '><label for="rh2-form-ack">Acknowledgement required</label></span>' +
      '<span class="rh2-check"><input type="checkbox" id="rh2-form-cpd"' + (pick(r, 'cpd_eligible') ? ' checked' : '') + '><label for="rh2-form-cpd">CPD eligible</label></span>' +
      '<span class="rh2-check"><label class="rh2-lbl" for="rh2-form-cpdh" style="margin:0 4px 0 0;">CPD hours</label>' +
      '<input type="number" id="rh2-form-cpdh" class="rh2-input" style="width:90px;" step="0.25" min="0" value="' + esc(pick(r, 'cpd_hours') || '') + '"></span>' +
      '</div>';

    /* Clinical classification. Until this control existed nothing in the
       application ever wrote these columns, which is why the Population and
       Setting filters matched nothing. Values come from the server-owned
       vocabulary and are validated again on save, so a stored classification is
       always one the filter can find. Leaving every box unticked is a valid
       answer and means "unclassified". */
    out += '<fieldset class="rh2-fieldset"><legend class="rh2-lbl">Clinical classification</legend>' +
      '<p class="rh2-quiet">Optional. Leave blank if this resource is not specific to a '
      + 'population or setting — it will show as Unclassified.</p>' +
      '<div class="rh2-check-row">' + POPULATIONS.filter(function (o) { return o[0] !== 'unclassified'; })
        .map(function (o) {
          return '<span class="rh2-check"><input type="checkbox" class="rh2-form-pop" id="rh2-form-pop-' + o[0] + '" value="' + o[0] + '"'
            + (clinicalHas(r, 'clinical_population', o[0]) ? ' checked' : '') + '>'
            + '<label for="rh2-form-pop-' + o[0] + '">' + esc(o[1]) + '</label></span>';
        }).join('') + '</div>' +
      '<div class="rh2-check-row">' + SETTINGS.filter(function (o) { return o[0] !== 'unclassified'; })
        .map(function (o) {
          return '<span class="rh2-check"><input type="checkbox" class="rh2-form-set" id="rh2-form-set-' + o[0] + '" value="' + o[0] + '"'
            + (clinicalHas(r, 'clinical_setting', o[0]) ? ' checked' : '') + '>'
            + '<label for="rh2-form-set-' + o[0] + '">' + esc(o[1]) + '</label></span>';
        }).join('') + '</div>' +
      '</fieldset>';

    if (editing && isApproved) {
      out += '<fieldset class="rh2-fieldset"><legend class="rh2-lbl">Change kind (this resource is approved)</legend>' +
        '<div class="rh2-check-row">' +
        '<span class="rh2-check"><input type="radio" name="rh2-form-kind" id="rh2-kind-minor" value="minor" checked><label for="rh2-kind-minor">Minor (wording, typos)</label></span>' +
        '<span class="rh2-check"><input type="radio" name="rh2-form-kind" id="rh2-kind-material" value="material"><label for="rh2-kind-material">Material (staff must re-acknowledge)</label></span>' +
        '</div>' +
        '<label class="rh2-lbl" for="rh2-form-changenote">Change note</label>' +
        '<input type="text" id="rh2-form-changenote" class="rh2-input" maxlength="300"></fieldset>';
    }

    if (editing) {
      // File upload runs through the server's full gate (format allow-list,
      // magic bytes, privacy scan, dedupe, derivatives). Metadata-first flow:
      // create → save → attach the document here.
      out += '<fieldset class="rh2-fieldset"><legend class="rh2-lbl">Document file</legend>' +
        '<p class="rh2-quiet">PDF, Word, PowerPoint, Excel or image, up to 25 MB. ' +
        'Files are checked for client-identifying content before they are stored.</p>' +
        '<input type="file" id="rh2-form-file" class="rh2-input" ' +
        'accept=".pdf,.docx,.pptx,.xlsx,.png,.jpg,.jpeg" onchange="RH2.adminUpload(this)">' +
        '<p class="rh2-quiet" id="rh2-upload-status" role="status"></p></fieldset>';
    }

    out += '<div class="rh2-form-actions">' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.adminSave(\'draft\')">' + (editing ? 'Save changes' : 'Save draft') + '</button>' +
      (!editing || pick(r, 'status') === 'draft'
        ? '<button type="button" class="rh2-btn" onclick="RH2.adminSave(\'submit\')">Save and submit for review</button>' : '') +
      (isOwner() ? '<button type="button" class="rh2-btn" onclick="RH2.adminSave(\'approve\')">Save and approve</button>' : '') +
      '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.adminFormClose()">Cancel</button></div></section>';
    return out;
  }

  var UPLOAD_FORMATS = { pdf: 'pdf', docx: 'docx', pptx: 'pptx', xlsx: 'xlsx', png: 'png', jpg: 'jpg', jpeg: 'jpg' };

  /** Read the chosen file, ship it as base64, report the server's verdict. */
  function adminUpload(input) {
    var file = input && input.files && input.files[0];
    var status = doc.getElementById('rh2-upload-status');
    var resourceId = S.admin.editing && pick(S.admin.editing, 'id');
    if (!file || !resourceId) return;
    var ext = String(file.name.split('.').pop() || '').toLowerCase();
    var format = UPLOAD_FORMATS[ext];
    if (!format) { if (status) status.textContent = 'That file type is not supported.'; return; }
    if (file.size > 25 * 1024 * 1024) { if (status) status.textContent = 'Files can be up to 25 MB.'; return; }
    if (status) status.textContent = 'Checking and uploading…';
    var reader = new FileReader();
    reader.onerror = function () { if (status) status.textContent = 'Could not read that file.'; };
    reader.onload = async function () {
      var base64 = String(reader.result).split(',')[1] || '';
      var d = await api('/api/rh2/resources/' + encodeURIComponent(resourceId) + '/files', {
        method: 'POST',
        body: { fileName: file.name, format: format, fileData: base64 },
      });
      if (!d.ok) {
        if (status) status.textContent = d.error || 'Upload failed.';
        return;
      }
      if (status) {
        status.textContent = 'Uploaded ' + file.name
          + ((d.warnings || []).length ? ' — ' + d.warnings.join(' ') : '');
      }
      input.value = '';
      toast('File uploaded', file.name);
    };
    reader.readAsDataURL(file);
  }

  function adminFormAuthority(v) {
    var el = doc.getElementById('rh2-form-source');
    if (el) el.style.display = v === 'internal' ? 'none' : '';
  }

  function checkedValues(sel) {
    return Array.prototype.slice.call(doc.querySelectorAll(sel))
      .filter(function (c) { return c.checked; })
      .map(function (c) { return c.value; });
  }

  function clinicalHas(r, field, value) {
    var arr = pick(r, field);
    return Array.isArray(arr) && arr.indexOf(value) !== -1;
  }

  async function adminSave(then) {
    var val = function (id) { return (doc.getElementById(id) || {}).value || ''; };
    var chk = function (id) { return !!(doc.getElementById(id) || {}).checked; };
    var r = S.admin.editing || {};
    var editing = !!pick(r, 'id');
    // Body keys match the POST/PATCH /api/rh2/resources contract: camelCase
    // throughout, and collections as an array of collection KEYS.
    var body = {
      title: val('rh2-form-title').trim(),
      contentType: val('rh2-form-type'),
      authorityLevel: val('rh2-form-auth'),
      description: val('rh2-form-desc').trim() || undefined,
      content: val('rh2-form-content'),
      estimatedMinutes: Number(val('rh2-form-mins')) || undefined,
      mandatory: chk('rh2-form-mandatory'),
      acknowledgementRequired: chk('rh2-form-ack'),
      cpdEligible: chk('rh2-form-cpd'),
      cpdHours: Number(val('rh2-form-cpdh')) || undefined,
      collections: Array.prototype.slice.call(doc.querySelectorAll('.rh2-form-col'))
        .filter(function (c) { return c.checked; }).map(function (c) { return c.value; }),
      // Always sent, so unticking every box genuinely clears a classification
      // rather than leaving a stale one in place.
      clinicalPopulation: checkedValues('.rh2-form-pop'),
      clinicalSetting: checkedValues('.rh2-form-set'),
    };
    if (body.authorityLevel !== 'internal') {
      body.sourcePublisher = val('rh2-form-srcpub').trim() || undefined;
      body.sourceTitle = val('rh2-form-srctitle').trim() || undefined;
      body.externalUrl = val('rh2-form-srcurl').trim() || undefined;
      body.sourceEffectiveDate = val('rh2-form-srcdate') || undefined;
    }
    if (!body.title) { toast('Missing title', 'A title is required.'); return; }
    if (editing && pick(r, 'status') === 'approved') {
      var kindEl = doc.querySelector('input[name="rh2-form-kind"]:checked');
      body.changeKind = kindEl ? kindEl.value : 'minor';
      body.changeNote = val('rh2-form-changenote').trim() || undefined;
    }
    var d = editing
      ? await api('/api/rh2/resources/' + encodeURIComponent(pick(r, 'id')), { method: 'PATCH', body: body })
      : await api('/api/rh2/resources', { method: 'POST', body: body });
    if (!d.ok) { toast('Could not save', d.error || 'Please try again.'); return; }
    var id = pick(r, 'id') || pick(d.resource || d, 'id');
    if (then === 'submit' && id) await api('/api/rh2/resources/' + encodeURIComponent(id) + '/submit', { method: 'POST' });
    if (then === 'approve' && id) await api('/api/rh2/resources/' + encodeURIComponent(id) + '/approve', { method: 'POST' });

    /* A document started from a Library folder belongs in it.
       Filing is the existing owner-only move route, unchanged and unwidened:
       if it refuses — not the owner, wrong organisation, folder gone — the
       resource still exists and is said to be unfiled, rather than the failure
       being swallowed and the person left believing it landed somewhere. */
    var into = !editing ? S.admin.fileInto : '';
    S.admin.fileInto = ''; S.admin.fileIntoName = '';
    var filed = '';
    if (into && id) {
      var mv = await api('/api/rh2/library/move', {
        method: 'POST', body: { folderId: into, resourceIds: [id] },
      });
      if (mv.ok) {
        filed = ' Filed in ' + mv.folder + '.';
        // The folder and the grid refresh together (§ libRefreshFolders):
        // a still-open folder's header must not read one short of its card.
        libRefreshFolders();
        S.lib.rows = null;
      } else {
        filed = ' It could not be filed into that folder — it is in the Library, unfiled.';
      }
    }

    toast('Saved', (then === 'approve' ? 'Resource approved. It remains unpublished.' : then === 'submit' ? 'Submitted for review.' : 'Saved.') + filed);
    S.admin.formOpen = false; S.admin.editing = null;
    loadAdminContent();
  }

  async function adminAction(id, action) {
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
    if (!d.ok) { toast('Could not ' + action, d.error || 'Please try again.'); return; }
    toast('Done', action === 'approve' ? 'Resource approved. It remains unpublished.' : action === 'submit' ? 'Submitted for review.' : 'Archived.');
    loadAdminContent();
  }

  // — Sources —

  function renderAdminSources() {
    var a = S.admin;
    var out = '<div class="rh2-toolbar"><p class="rh2-quiet" style="flex:1;">External sources are checked for changes; a change never auto-updates content — it flags the source for human review.</p>' +
      (isOwner() ? '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.sourcesCheck()">Check sources now</button>' : '') + '</div>';
    if (a.loading || a.sources === null) return out + '<div class="rh2-card">' + skel(4, 44) + '</div>';
    if (!a.sources.length) return out + '<div class="rh2-empty">No external sources registered yet.</div>';
    out += '<div class="rh2-card rh2-tablewrap"><table class="rh2-table"><thead><tr>' +
      '<th scope="col">Source</th><th scope="col">Publisher</th><th scope="col">Status</th><th scope="col">Last verified</th><th scope="col">Next verify</th><th scope="col"></th>' +
      '</tr></thead><tbody>' +
      a.sources.map(function (s) {
        var status = String(pick(s, 'status') || 'current');
        return '<tr><td>' + esc(pick(s, 'name')) + '</td><td>' + esc(pick(s, 'publisher') || '') + '</td>' +
          '<td><span class="rh2-chip rh2-src-' + esc(status) + '">' + esc(status.replace(/_/g, ' ')) + '</span></td>' +
          '<td>' + esc(fmtDate(pick(s, 'last_verified_at'))) + '</td>' +
          '<td>' + esc(fmtDate(pick(s, 'next_verify_at'))) + '</td>' +
          '<td>' + (isOwner() ? '<button type="button" class="rh2-btn" onclick="RH2.sourceVerify(\'' + esc(pick(s, 'id')) + '\')">Verify</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return out;
  }

  async function sourcesCheck() {
    toast('Checking sources', 'This can take a moment.');
    var d = await api('/api/rh2/sources/check-now', { method: 'POST' });
    if (!d.ok) toast('Check failed', d.error || 'Please try again.');
    loadAdminSources();
  }
  async function sourceVerify(id) {
    var d = await api('/api/rh2/sources/' + encodeURIComponent(id) + '/verify', { method: 'POST' });
    if (!d.ok) toast('Could not verify', d.error || 'Please try again.');
    else toast('Verified', 'Source marked as verified today.');
    loadAdminSources();
  }

  // — PD events —

  function renderAdminPd() {
    var a = S.admin;
    var out = '<div class="rh2-toolbar"><span style="flex:1"></span>' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.pdNew()">New PD event</button></div>';
    if (a.pdEditing) out += renderPdForm();
    if (a.loading || a.pd === null) return out + '<div class="rh2-card">' + skel(3, 48) + '</div>';
    if (!a.pd.length) return out + '<div class="rh2-empty">No PD events yet.</div>';
    out += '<div class="rh2-card rh2-list">' + a.pd.map(function (e) {
      return '<div class="rh2-adm-row"><span class="rh2-row-main">' +
        '<span class="rh2-row-title">' + esc(pick(e, 'title')) + '</span>' +
        '<span class="rh2-row-sub">' + esc(fmtDateTime(pick(e, 'starts_at'))) +
        (pick(e, 'provider') ? ' · ' + esc(pick(e, 'provider')) : '') +
        (pick(e, 'cpd_hours') ? ' · ' + esc(pick(e, 'cpd_hours')) + ' CPD hours' : '') +
        ' · ' + esc(pick(e, 'mode') || 'online') + '</span></span>' +
        '<span class="rh2-chip">' + esc(pick(e, 'status') || 'upcoming') + '</span>' +
        '<button type="button" class="rh2-btn" onclick="RH2.pdEdit(\'' + esc(pick(e, 'id')) + '\')">Edit</button></div>';
    }).join('') + '</div>';
    return out;
  }

  function pdNew() { S.admin.pdEditing = {}; render(); }
  function pdEdit(id) {
    var e = (S.admin.pd || []).filter(function (x) { return String(pick(x, 'id')) === String(id); })[0];
    if (e) { S.admin.pdEditing = e; render(); }
  }
  function pdClose() { S.admin.pdEditing = null; render(); }

  function renderPdForm() {
    var e = S.admin.pdEditing || {};
    var starts = String(pick(e, 'starts_at') || '');
    var local = '';
    if (starts) {
      var dt = new Date(starts);
      if (!isNaN(dt.getTime())) {
        var p2 = function (n) { return String(n).padStart(2, '0'); };
        local = dt.getFullYear() + '-' + p2(dt.getMonth() + 1) + '-' + p2(dt.getDate()) + 'T' + p2(dt.getHours()) + ':' + p2(dt.getMinutes());
      }
    }
    return '<section class="rh2-card rh2-form" aria-label="PD event form"><h2>' + (pick(e, 'id') ? 'Edit PD event' : 'New PD event') + '</h2>' +
      '<label class="rh2-lbl" for="rh2-pd-title">Title</label>' +
      '<input type="text" id="rh2-pd-title" class="rh2-input" maxlength="300" value="' + esc(pick(e, 'title') || '') + '">' +
      '<div class="rh2-form-grid">' +
      '<div><label class="rh2-lbl" for="rh2-pd-provider">Provider</label><input type="text" id="rh2-pd-provider" class="rh2-input" value="' + esc(pick(e, 'provider') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-pd-start">Starts</label><input type="datetime-local" id="rh2-pd-start" class="rh2-input" value="' + esc(local) + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-pd-mode">Mode</label><select id="rh2-pd-mode" class="rh2-select rh2-w100">' +
      ['online', 'in_person', 'hybrid'].map(function (m) {
        return '<option value="' + m + '"' + ((pick(e, 'mode') || 'online') === m ? ' selected' : '') + '>' + m.replace('_', ' ') + '</option>';
      }).join('') + '</select></div>' +
      '<div><label class="rh2-lbl" for="rh2-pd-location">Location</label><input type="text" id="rh2-pd-location" class="rh2-input" value="' + esc(pick(e, 'location') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-pd-hours">CPD hours</label><input type="number" id="rh2-pd-hours" class="rh2-input" step="0.25" min="0" value="' + esc(pick(e, 'cpd_hours') || '') + '"></div>' +
      '<div><label class="rh2-lbl" for="rh2-pd-url">Registration URL</label><input type="url" id="rh2-pd-url" class="rh2-input" placeholder="https://" value="' + esc(pick(e, 'registration_url') || '') + '"></div>' +
      '</div>' +
      '<label class="rh2-lbl" for="rh2-pd-desc">Description</label>' +
      '<textarea id="rh2-pd-desc" class="rh2-input" rows="2">' + esc(pick(e, 'description') || '') + '</textarea>' +
      '<div class="rh2-form-actions">' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.pdSave()">Save event</button>' +
      '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.pdClose()">Cancel</button></div></section>';
  }

  async function pdSave() {
    var val = function (id) { return (doc.getElementById(id) || {}).value || ''; };
    var e = S.admin.pdEditing || {};
    var starts = val('rh2-pd-start');
    // Body keys match POST/PATCH /api/rh2/pd: camelCase throughout.
    var body = {
      title: val('rh2-pd-title').trim(),
      provider: val('rh2-pd-provider').trim() || undefined,
      startsAt: starts ? new Date(starts).toISOString() : undefined,
      mode: val('rh2-pd-mode'),
      location: val('rh2-pd-location').trim() || undefined,
      cpdHours: Number(val('rh2-pd-hours')) || undefined,
      registrationUrl: val('rh2-pd-url').trim() || undefined,
      description: val('rh2-pd-desc').trim() || undefined,
    };
    if (!body.title) { toast('Missing title', 'A title is required.'); return; }
    var d = pick(e, 'id')
      ? await api('/api/rh2/pd/' + encodeURIComponent(pick(e, 'id')), { method: 'PATCH', body: body })
      : await api('/api/rh2/pd', { method: 'POST', body: body });
    if (!d.ok) { toast('Could not save', d.error || 'Please try again.'); return; }
    S.admin.pdEditing = null;
    toast('Saved', 'PD event saved.');
    loadAdminPd();
  }

  // — Feedback —

  function renderAdminFeedback() {
    var a = S.admin;
    if (a.loading || a.feedback === null) return '<div class="rh2-card">' + skel(3, 48) + '</div>';
    if (!a.feedback.length) return '<div class="rh2-empty">No feedback yet.</div>';
    var kinds = { helpful: 'Helpful', needs_update: 'Needs updating', missing: 'Something missing' };
    return '<div class="rh2-card rh2-list">' + a.feedback.map(function (f) {
      return '<div class="rh2-adm-row"><span class="rh2-row-main">' +
        '<button type="button" class="rh2-linklike" onclick="RH2.openDetail(\'' + esc(pick(f, 'resource_id')) + '\',\'admin\')">' + esc(pick(f, 'resource_title') || 'Resource') + '</button>' +
        (pick(f, 'comment') ? '<span class="rh2-row-sub">' + esc(pick(f, 'comment')) + '</span>' : '') + '</span>' +
        '<span class="rh2-chip' + (pick(f, 'kind') === 'helpful' ? ' rh2-chip-ok' : ' rh2-chip-warn') + '">' + esc(kinds[pick(f, 'kind')] || pick(f, 'kind')) + '</span>' +
        '<span class="rh2-row-sub">' + esc(fmtDate(pick(f, 'created_at'))) + '</span></div>';
    }).join('') + '</div>';
  }

  // — Quick links (owner) —

  function renderAdminLinks() {
    var a = S.admin;
    var out = '<section class="rh2-card rh2-form" aria-label="Add quick link"><h2>Add quick link</h2><div class="rh2-form-grid">' +
      '<div><label class="rh2-lbl" for="rh2-ql-label">Label</label><input type="text" id="rh2-ql-label" class="rh2-input" maxlength="100"></div>' +
      '<div><label class="rh2-lbl" for="rh2-ql-url">URL</label><input type="url" id="rh2-ql-url" class="rh2-input" placeholder="https://"></div>' +
      '</div><div class="rh2-form-actions"><button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.qlSave()">Add link</button></div></section>';
    if (a.loading || a.links === null) return out + '<div class="rh2-card">' + skel(3, 40) + '</div>';
    if (!a.links.length) return out + '<div class="rh2-empty">No quick links yet.</div>';
    out += '<div class="rh2-card rh2-list">' + a.links.map(function (l) {
      var active = pick(l, 'is_active') !== false;
      return '<div class="rh2-adm-row"><span class="rh2-row-main">' +
        '<span class="rh2-row-title">' + esc(pick(l, 'label')) + '</span>' +
        '<span class="rh2-row-sub">' + esc(pick(l, 'url')) + '</span></span>' +
        '<span class="rh2-chip' + (active ? ' rh2-chip-ok' : '') + '">' + (active ? 'active' : 'hidden') + '</span>' +
        '<button type="button" class="rh2-btn" onclick="RH2.qlToggle(\'' + esc(pick(l, 'id')) + '\',' + (!active) + ')">' + (active ? 'Hide' : 'Show') + '</button></div>';
    }).join('') + '</div>';
    return out;
  }

  async function qlSave() {
    var label = ((doc.getElementById('rh2-ql-label') || {}).value || '').trim();
    var url = ((doc.getElementById('rh2-ql-url') || {}).value || '').trim();
    if (!label || !(/^https?:\/\//i.test(url) || /^\/(?!\/)/.test(url))) {
      toast('Check the details', 'A label and an http(s) URL or internal /path are required.');
      return;
    }
    var d = await api('/api/rh2/quick-links', { method: 'POST', body: { label: label, url: url } });
    if (!d.ok) { toast('Could not save', d.error || 'Please try again.'); return; }
    loadAdminLinks();
  }
  async function qlToggle(id, on) {
    var d = await api('/api/rh2/quick-links/' + encodeURIComponent(id), { method: 'PATCH', body: { isActive: !!on } });
    if (!d.ok) toast('Could not update', d.error || 'Please try again.');
    loadAdminLinks();
  }

  // — Analytics —

  function analyticsList(title, rows, valueKey, valueLabel) {
    var out = '<section class="rh2-card"><h2>' + title + '</h2>';
    if (!rows || !rows.length) return out + '<p class="rh2-quiet">No data yet.</p></section>';
    return out + rows.slice(0, 8).map(function (r) {
      return '<div class="rh2-ana-row"><span class="rh2-row-title">' + esc(pick(r, 'title') || pick(r, 'term')) + '</span>' +
        '<span class="rh2-row-sub">' + esc(pick(r, valueKey) || 0) + ' ' + valueLabel + '</span></div>';
    }).join('') + '</section>';
  }

  function renderAdminAnalytics() {
    var a = S.admin;
    if (a.loading || !a.analytics) return '<div class="rh2-grid-2"><div class="rh2-card">' + skel(3, 36) + '</div><div class="rh2-card">' + skel(3, 36) + '</div></div>';
    var d = a.analytics;
    var out = '<div class="rh2-grid-2">';
    out += analyticsList('Most viewed', pick(d, 'most_viewed') || pick(d, 'mostViewed'), 'views', 'views');
    out += analyticsList('Most saved', pick(d, 'most_saved') || pick(d, 'mostSaved'), 'saves', 'saves');
    out += analyticsList('Most completed', pick(d, 'most_completed') || pick(d, 'mostCompleted'), 'completions', 'completions');
    out += analyticsList('Content gaps (searches with no results)', pick(d, 'search_misses') || pick(d, 'gaps') || pick(d, 'searchMisses'), 'miss_count', 'searches');
    out += '</div>';

    var acks = pick(d, 'ack_completion') || pick(d, 'acknowledgements') || [];
    out += '<section class="rh2-card"><h2>Acknowledgement completion</h2>';
    if (!acks.length) out += '<p class="rh2-quiet">No policies require acknowledgement yet.</p>';
    else out += acks.map(function (p) {
      var done = Number(pick(p, 'acknowledged_users') || pick(p, 'acknowledged') || 0),
        total = Number(pick(p, 'active_users') || pick(p, 'total') || pick(p, 'staff_count') || 0);
      var pct = total ? Math.round(done / total * 100) : 0;
      return '<div class="rh2-ana-ack"><div class="rh2-row-title">' + esc(pick(p, 'title')) + '</div>' +
        '<div class="rh2-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><span style="width:' + pct + '%"></span></div>' +
        '<div class="rh2-row-sub">' + done + ' of ' + total + ' staff (' + pct + '%)</div></div>';
    }).join('');
    out += '</section>';

    var stale = pick(d, 'stale') || pick(d, 'stale_resources') || [];
    out += '<section class="rh2-card"><h2>Stale resources</h2>';
    if (!stale.length) out += '<p class="rh2-quiet">Nothing is overdue for review.</p>';
    else out += stale.map(function (r) {
      return '<div class="rh2-ana-row"><span class="rh2-row-title">' + esc(pick(r, 'title')) + '</span>' +
        '<span class="rh2-row-sub">review due ' + esc(fmtDate(pick(r, 'review_due_at') || pick(r, 'next_review_at'))) + '</span></div>';
    }).join('');
    out += '</section>';

    // Induction completion — module states only, per staff member. This is
    // onboarding management, not behaviour tracking: no step-level detail.
    var staff = S.admin.induction;
    out += '<section class="rh2-card" aria-labelledby="rh2-h-ind-ana"><h2 id="rh2-h-ind-ana">Induction completion</h2>';
    if (!staff) out += '<p class="rh2-quiet">Induction progress could not be loaded.</p>';
    else if (!staff.length) out += '<p class="rh2-quiet">No active staff yet.</p>';
    else out += staff.map(function (s) {
      var pct = s.total ? Math.round(Number(s.completed) / Number(s.total) * 100) : 0;
      var stateTxt = Number(s.completed) >= Number(s.total) && s.total
        ? 'Complete'
        : (Number(s.completed) + Number(s.inProgress)) > 0 ? 'In progress' : 'Not started';
      return '<div class="rh2-ana-ack">' +
        '<div class="rh2-row-title">' + esc(s.name) + ' <span class="rh2-chip rh2-chip-quiet">' + esc(String(s.role).replace(/_/g, ' ')) + '</span></div>' +
        '<div class="rh2-bar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(s.name) + ' induction progress"><span style="width:' + pct + '%"></span></div>' +
        '<div class="rh2-row-sub">' + esc(s.completed) + ' of ' + esc(s.total) + ' modules · ' + stateTxt +
        (s.lastActivityAt ? ' · last activity ' + esc(fmtDate(s.lastActivityAt)) : '') + '</div></div>';
    }).join('');
    out += '</section>';
    return out;
  }

  // ── Boot / activation ─────────────────────────────────────────────────────

  function open() {
    var host = root();
    if (!host) return;
    if (!S.booted) {
      S.booted = true;
      render();
      loadHome();
      loadTopics();
      loadClinicalVocabulary();
    } else {
      render();
    }
  }

  // Induction progress changes (module completed, restarted, paused) should
  // repaint the surfaces that show it without the engine reaching into our
  // render internals.
  doc.addEventListener('induction:progress', function (e) {
    // A walkthrough opened from inside an induction hands control back the
    // moment its overlay is gone — paused or finished, the reader lands back
    // on the induction, in place.
    if (pendingWalk && !doc.getElementById('ind-layer')) {
      var p = pendingWalk;
      var d = e && e.detail;
      // The event must belong to the armed run: a preview arm is answered
      // only by that module's preview event, a learner arm only by a bare
      // one. A mismatch means the armed run was silently torn down by a
      // later start() — drop the stale arm rather than hijack the run that
      // actually just ended.
      var match = p.preview
        ? !!(d && d.preview && String(d.key) === String(p.moduleKey))
        : !(d && d.preview);
      pendingWalk = null;
      if (match) { alWalkReturn(p, d); return; }
    }
    if (S.booted && (S.view === 'learning' || S.view === 'home')) render();
  });

  // The Resources nav tab click predates RH2 — activate ourselves when the
  // shared panel becomes visible (R1's listener only calls resReload, which
  // exits early now that #res-list is gone).
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.tab[data-tab="resources"]');
    if (t) setTimeout(function () {
      var panel = doc.getElementById('rh-panel-shared');
      if (panel && panel.classList.contains('active')) open();
    }, 60);
  });

  // ── Public surface ────────────────────────────────────────────────────────

  /* ══════════════════════════════════════════════════════════════════════════
     OWNER-CONTROLLED LEARNING
     Employee side: assigned-learning cards on My Learning + the assignment
     player ('assignment' view, #resources/assignment/<id>). Owner side: the
     Admin → Learning console (library / assignments / staff). All authority
     lives server-side in backend/learning-routes.js — everything here is
     rendering and optimistic state.
     ═══════════════════════════════════════════════════════════════════════ */

  var LA_CATEGORY_LABELS = {
    induction: 'Induction', clinical: 'Clinical', compliance: 'Compliance',
    safety: 'Safety', administration: 'Administration', rural_remote: 'Rural / Remote',
    professional_development: 'Professional development', policy_update: 'Policy update',
    other: 'Other',
  };
  function laCatLabel(c) { return LA_CATEGORY_LABELS[c] || (c ? String(c) : ''); }

  var LA_ITEM_TYPE_LABELS = {
    content: 'Reading', resource: 'Resource', acknowledgement: 'Acknowledgement',
    quiz: 'Knowledge check', task: 'Task',
  };

  function laStatusChip(a) {
    if (a.status === 'completed') return '<span class="rh2-chip rh2-chip-ok">Completed</span>';
    if (a.status === 'cancelled') return '<span class="rh2-chip rh2-chip-quiet">Cancelled</span>';
    if (a.overdue) return '<span class="rh2-chip rh2-chip-warn">Overdue</span>';
    if (a.status === 'in_progress') return '<span class="rh2-chip">In progress</span>';
    return '<span class="rh2-chip rh2-chip-quiet">Not started</span>';
  }

  function laBar(pct, label) {
    var p = Math.max(0, Math.min(100, Number(pct) || 0));
    return '<div class="rh2-bar" role="progressbar" aria-valuenow="' + p +
      '" aria-valuemin="0" aria-valuemax="100" aria-label="' + esc(label || 'Progress') +
      '"><span style="width:' + p + '%"></span></div>';
  }

  // ── Employee: my assigned learning ─────────────────────────────────────────

  async function loadMyLearning() {
    if (S.myl.loading) return;
    S.myl.loading = true;
    var d = await api('/api/learning/my');
    S.myl.loading = false;
    S.myl.err = d.ok ? '' : (d.error || 'Assigned learning could not be loaded.');
    S.myl.rows = d.ok ? (d.assignments || []) : (S.myl.rows || []);
    render();
  }

  function myAssignmentCard(a) {
    var total = pick(a, 'required_total') || 0;
    var done = pick(a, 'required_done') || 0;
    var pct = pick(a, 'progress_percent') || 0;
    var hint = a.status === 'completed' ? 'Revisit'
      : (a.status === 'in_progress' ? 'Continue' : 'Start');
    var dueTxt = pick(a, 'due_at') ? 'Due ' + fmtDate(pick(a, 'due_at')) : '';
    // ONE interaction: the whole card is the button, and it opens the
    // induction. Starting, resuming and completing all live inside the player.
    return '<button type="button" class="rh2-learn-card rh2-learn-tile' + (a.overdue ? ' rh2-learn-overdue' : '') + '" ' +
      'onclick="RH2.openAssignment(\'' + esc(a.id) + '\')" ' +
      'aria-label="' + esc(hint + ': ' + pick(a, 'title')) + '">' +
      '<span class="rh2-learn-card-head">' +
        '<span class="rh2-row-title">' + esc(pick(a, 'title')) + '</span>' +
        laStatusChip(a) +
      '</span>' +
      '<span class="rh2-row-sub">' +
        esc(laCatLabel(pick(a, 'category'))) +
        (pick(a, 'mandatory') ? ' · Mandatory' : ' · Optional') +
      '</span>' +
      laBar(pct, pick(a, 'title') + ' progress') +
      '<span class="rh2-row-sub">' + done + ' of ' + total + ' required modules · ' + pct + '%' +
        (dueTxt ? ' · <span class="' + (a.overdue ? 'rh2-learn-due-warn' : '') + '">' + esc(dueTxt) + '</span>' : '') +
        (a.status === 'completed' ? ' · Completed ' + esc(fmtDate(pick(a, 'completed_at'))) : '') +
      '</span>' +
      (pick(a, 'owner_note') ? '<span class="rh2-quiet rh2-learn-note">' + esc(pick(a, 'owner_note')) + '</span>' : '') +
      '<span class="rh2-learn-tile-hint">' + hint + ' &rarr;</span>' +
    '</button>';
  }

  function renderMyAssignments() {
    var st = S.myl;
    if (st.loading && !st.rows) {
      return '<section class="rh2-card" aria-labelledby="rh2-h-myl"><h2 id="rh2-h-myl">Assigned learning</h2>' + skel(2, 88) + '</section>';
    }
    if (st.err && !(st.rows && st.rows.length)) {
      return '<section class="rh2-card" aria-labelledby="rh2-h-myl"><h2 id="rh2-h-myl">Assigned learning</h2>' +
        '<div class="rh2-empty">' + esc(st.err) + ' <button type="button" class="rh2-btn" onclick="RH2.reloadMyLearning()">Retry</button></div></section>';
    }
    var rows = st.rows || [];
    if (!rows.length) {
      return '<section class="rh2-card" aria-labelledby="rh2-h-myl"><h2 id="rh2-h-myl">Assigned learning</h2>' +
        '<div class="rh2-empty">You’re all up to date — no outstanding learning has been assigned to you.</div></section>';
    }
    var todo = rows.filter(function (a) { return a.status === 'assigned'; });
    var doing = rows.filter(function (a) { return a.status === 'in_progress'; });
    var doneRows = rows.filter(function (a) { return a.status === 'completed'; });
    var group = function (label, list) {
      if (!list.length) return '';
      return '<h3 class="rh2-learn-group">' + label + '</h3>' +
        '<div class="rh2-learn-cards">' + list.map(myAssignmentCard).join('') + '</div>';
    };
    return '<section class="rh2-card" aria-labelledby="rh2-h-myl"><h2 id="rh2-h-myl">Assigned learning</h2>' +
      group('In progress', doing) + group('To do', todo) + group('Completed', doneRows) +
    '</section>';
  }

  // ── The induction experience: ONE renderer, three modes ────────────────────
  //
  //  learner — the assigned employee; progress persists.
  //  preview — the Owner; identical screens, nothing persists.
  //  edit    — the Owner; identical screens, the content directly editable.
  //
  //  All three walk the SAME steps — one screen per section and a closing
  //  screen — moved through with Back / Next. Edit mode alone keeps a step 0
  //  before the sections (the workflow's own title and description, which are
  //  fields there); a reader has no settings, so the learner and the preview
  //  open straight onto the first section. There is deliberately no second,
  //  administrative representation of a workflow: what the Owner edits IS the
  //  screen the learner receives, which is the only arrangement in which the
  //  two cannot drift apart.
  //
  //  Mode is READ FROM THE RENDER PATH rather than stored: the assignment view
  //  is the learner (or its preview twin), and an open editor is edit mode. A
  //  stored mode flag could be set to 'edit' by anything on the page; this one
  //  cannot, and the server refuses an unauthorised save regardless.

  function indMode() {
    if (S.view === 'assignment') return (S.assignment && S.assignment.preview) ? 'preview' : 'learner';
    return 'edit';
  }

  /** The state object that owns the step cursor for the active mode. */
  function indState(mode) { return (mode || indMode()) === 'edit' ? S.la.editor : S.assignment; }

  function indSections(mode) {
    if ((mode || indMode()) === 'edit') return (S.la.editor && S.la.editor.sections) || [];
    var d = S.assignment && S.assignment.data;
    return (d && d.content && d.content.sections) || [];
  }

  /** Overview (edit only) + one screen per section + the closing screen. */
  function indStepCount(sections) { return (sections ? sections.length : 0) + 2; }

  /** The first step a mode can stand on: readers have no overview to stand on. */
  function indFirstStep(mode) { return (mode || indMode()) === 'edit' ? 0 : 1; }

  function indStep(mode, sections) {
    var st = indState(mode);
    if (!st) return indFirstStep(mode);
    return Math.max(indFirstStep(mode), Math.min(indStepCount(sections) - 1, Number(st.step) || 0));
  }

  /** A step change is a page change: start it at the top, not mid-paragraph. */
  function indScrollTop() {
    try {
      var el = root();
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'start' });
    } catch (e) { /* rendering must never depend on scrolling */ }
  }

  function indGo(delta) {
    var mode = indMode();
    var st = indState(mode);
    if (!st) return;
    var n = indStepCount(indSections(mode));
    var first = indFirstStep(mode);
    var from = Math.max(first, Math.min(n - 1, Number(st.step) || 0));
    var to = Math.max(first, Math.min(n - 1, from + Number(delta || 0)));
    st.step = to;
    indScrollTop();
    render();
  }

  function indJump(i) {
    var mode = indMode();
    var st = indState(mode);
    if (!st) return;
    st.step = Math.max(indFirstStep(mode), Math.min(indStepCount(indSections(mode)) - 1, Number(i) || 0));
    indScrollTop();
    render();
  }

  function indStepLabel(step, secCount, mode) {
    if (step === 0) return 'Overview';
    if (step > secCount) return mode === 'edit' ? 'Finish' : 'Complete';
    return 'Section ' + step + ' of ' + secCount;
  }

  /** The rail: where the reader is, and every step they may jump to. */
  function indRail(mode, step, sections) {
    var last = sections.length + 1;
    var entries = mode === 'edit' ? [{ i: 0, no: '&bull;', label: 'Overview' }] : [];
    sections.forEach(function (s, i) {
      entries.push({ i: i + 1, no: String(i + 1), label: String((s && s.title) || ('Section ' + (i + 1))) });
    });
    entries.push({ i: last, no: '&#10003;', label: mode === 'edit' ? 'Finish' : 'Complete' });
    return '<ol class="rh2-ind-rail">' + entries.map(function (e) {
      return '<li class="rh2-ind-railitem"><button type="button" class="rh2-ind-railbtn' +
        (e.i === step ? ' is-on' : '') + (e.i < step ? ' is-past' : '') + '"' +
        (e.i === step ? ' aria-current="step"' : '') +
        ' onclick="RH2.indJump(' + e.i + ')">' +
        '<span class="rh2-ind-railno" aria-hidden="true">' + e.no + '</span>' +
        '<span class="rh2-ind-raillbl">' + esc(e.label) + '</span></button></li>';
    }).join('') + '</ol>';
  }

  /** Back / where-am-I / Next. The same control in all three modes. */
  function indNav(mode, step, secCount) {
    var last = secCount + 1;
    // A reader's Back always goes somewhere: from the first section it leaves
    // the induction the way it was entered. Only the editor's settings step
    // has nothing before it.
    var backOut = mode !== 'edit' && step <= indFirstStep(mode);
    var backClick = backOut ? 'RH2.alBack()' : 'RH2.indGo(-1)';
    return '<nav class="rh2-ind-nav" aria-label="Induction navigation">' +
      '<button type="button" class="rh2-btn rh2-ind-back" ' +
        (mode === 'edit' ? (step === 0 ? 'disabled ' : '') : '') +
        'onclick="' + backClick + '">&larr; Back</button>' +
      '<span class="rh2-ind-count" role="status" aria-live="polite">' +
        esc(indStepLabel(step, secCount, mode)) + '</span>' +
      '<button type="button" class="rh2-btn rh2-btn-primary rh2-ind-next" ' + (step === last ? 'disabled ' : '') +
        'onclick="RH2.indGo(1)">Next &rarr;</button>' +
    '</nav>';
  }

  /**
   * The head every mode shares: what this induction is, where the reader is in
   * it, and — learner only — how much of it is done. In edit mode the title IS
   * the input: a heading you type straight into is the whole point of opening
   * the learner's own screen to edit rather than a form beside it.
   */
  function indHeader(mode, meta, sections, step) {
    var title = mode === 'edit'
      ? '<input class="rh2-input rh2-ind-title-in" id="la-ed-title" value="' + esc(meta.title || '') + '"' +
        ' placeholder="Learning title" aria-label="Learning title" oninput="RH2.laMeta(\'title\',this.value)">'
      : '<h1 class="rh2-h1 rh2-ind-title">' + esc(meta.title || '') + '</h1>';
    return '<header class="rh2-card rh2-ind-head">' + title +
      (meta.sub ? '<div class="rh2-row-sub">' + meta.sub + '</div>' : '') +
      (meta.progress
        ? laBar(meta.progress.percent, 'Overall progress') +
          '<div class="rh2-row-sub">' + meta.progress.done + ' of ' + meta.progress.total +
            ' required modules &middot; ' + meta.progress.percent + '%</div>'
        : '') +
      // The rail is the editor's: a reader gets the whole induction on one
      // page, so there is nothing to step between.
      (mode === 'edit' ? indRail(mode, step, sections) : '') +
    '</header>';
  }

  /** A section row in a contents list — used by every mode's overview. */
  function indTocRow(title, sub, stepIndex, no) {
    return '<li><button type="button" class="rh2-ind-tocbtn" onclick="RH2.indJump(' + stepIndex + ')">' +
      '<span class="rh2-ind-item-no">' + no + '</span>' +
      '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(title) + '</span>' +
      '<span class="rh2-row-sub">' + esc(sub) + '</span></span></button></li>';
  }

  // ── Employee: assigned learning, and the Owner's read-only twin ────────────

  /** The items that count for completion — the server's countedKeys, mirrored:
   *  the required items count, and when nothing is required, everything does. */
  function alCountedItems(sections) {
    var all = [];
    (sections || []).forEach(function (s, si) {
      ((s && s.items) || []).forEach(function (it) { all.push({ section: si + 1, item: it }); });
    });
    var req = all.filter(function (e) { return e.item.required !== false; });
    return req.length ? req : all;
  }

  async function openAssignment(id) {
    // Re-entering the induction that is already open — back from a resource,
    // back from a walkthrough, a history restore — keeps its loaded data.
    var sameId = !!(S.assignment && !S.assignment.preview &&
      S.assignment.id === String(id || '') && S.assignment.data);
    S.assignment = {
      id: String(id || ''), data: sameId ? S.assignment.data : null,
      loading: !sameId, err: '', backView: 'learning',
      quizAnswers: sameId ? S.assignment.quizAnswers : {}, quizResult: null, ackArmed: false,
      busy: false, preview: false, previewDone: {}, celebrate: false,
    };
    S.view = 'assignment';
    render();
    var d = await api('/api/learning/my/' + encodeURIComponent(String(id || '')));
    // Stale guard: the user may have opened a different assignment while this
    // response was in flight — a late answer must not clobber the newer one.
    if (S.assignment.id !== String(id || '') || S.assignment.preview) return;
    S.assignment.loading = false;
    if (!d.ok) {
      S.assignment.err = d.status === 404
        ? 'This learning assignment is no longer available.'
        : (d.error || 'The assignment could not be loaded.');
      return render();
    }
    S.assignment.data = d;
    // A previously started induction asks ONCE: continue where you left off,
    // or restart from the beginning. Never on re-entry, never for a fresh
    // start, never for a completed one being revisited.
    // Opening an untouched assignment starts it — deliberate, visible in the
    // owner's dashboard as In progress from the first real look.
    if (d.assignment && d.assignment.status === 'assigned') {
      api('/api/learning/my/' + encodeURIComponent(S.assignment.id) + '/start', { method: 'POST' })
        .then(function (r) {
          if (r.ok && r.assignment && S.assignment.data && S.assignment.id === String(id)) {
            S.assignment.data.assignment = r.assignment;
            render();
          }
          loadMyLearning();
        });
    }
    render();
  }

  /**
   * Owner preview — the learner's screens exactly, and nothing persisted.
   *
   * Preview is the same renderer in read mode: same sections, same Next/Back,
   * same interactions. Ticking through an acknowledgement or a knowledge check
   * here moves a flag in `previewDone` and posts nothing, so no learner's
   * progress and no content can be changed from this screen.
   */
  async function laPreview(wfId) {
    // Re-entering the SAME preview (back from a resource detour, a history
    // restore) keeps the origin and the place. Recomputing backView mid-flight
    // is what used to strand a Close in Hub administration.
    var again = !!(S.assignment && S.assignment.preview &&
      S.assignment.previewWfId === String(wfId || ''));
    S.assignment = {
      // Back goes where the Owner actually came from: Assign Learning or
      // the Admin > Learning tab.
      id: null, data: null, loading: true, err: '',
      backView: again ? S.assignment.backView : (S.view === 'learning' ? 'learning' : 'admin'),
      // Un-submitted quiz picks survive a detour, exactly as the learner's do.
      quizAnswers: again ? S.assignment.quizAnswers : {}, quizResult: null, ackArmed: false,
      busy: false, preview: true, previewWfId: String(wfId || ''),
      previewDone: again ? S.assignment.previewDone : {}, celebrate: false,
    };
    S.view = 'assignment';
    render();
    var d = await api('/api/learning/workflows/' + encodeURIComponent(String(wfId || '')) + '/preview');
    // Stale guard: a newer open (another preview, a real assignment) wins.
    if (!S.assignment.preview || S.assignment.previewWfId !== String(wfId || '')) return;
    S.assignment.loading = false;
    if (!d.ok) { S.assignment.err = d.error || 'Preview failed.'; return render(); }
    S.assignment.data = {
      assignment: {
        title: d.workflow.title, category: d.workflow.category, status: 'in_progress',
        description: d.workflow.description || '',
        progress_percent: 0, required_done: 0,
        required_total: (d.stats && d.stats.countedTotal) || 0,
        mandatory: true,
      },
      content: d.content,
      completed_items: {},
    };
    render();
  }

  function alBack() {
    var back = S.assignment.backView === 'admin' ? 'admin' : 'learning';
    // An Admin-launched preview closes onto the Learning console it came
    // from — never whichever Hub administration tab happened to be open last.
    if (back === 'admin') S.admin.tab = 'learning';
    S.assignment.id = null;
    S.assignment.preview = false;
    S.assignment.previewWfId = null;
    // Through the PUBLIC nav, not the closure-local one: navigation.js wraps
    // RH2.nav to sync the URL/history, and leaving the player must move the
    // address off #resources/assignment/<id>.
    (global.RH2 && global.RH2.nav ? global.RH2.nav : nav)(back);
  }

  function alItemDone(key) {
    var st = S.assignment;
    if (st.preview) return !!st.previewDone[key];
    return !!(st.data && st.data.completed_items && st.data.completed_items[key]);
  }

  async function alComplete(key, body, opts) {
    var st = S.assignment;
    if (st.busy) return null;
    if (st.preview) {
      st.previewDone[key] = true;
      st.ackArmed = false;
      render();
      return { ok: true, completed: true, preview: true };
    }
    st.busy = true;
    render();
    var d = await api('/api/learning/my/' + encodeURIComponent(st.id) +
      '/items/' + encodeURIComponent(key) + '/complete', { method: 'POST', body: body || {} });
    st.busy = false;
    if (!d.ok) {
      st.err = '';
      // Background recording (reading past a section) fails silently — the
      // closing screen's own completion still covers whatever was missed.
      if (!(opts && opts.quiet)) alert(d.error || 'Saving your progress failed — please try again.');
      render();
      return null;
    }
    if (d.completed) {
      if (st.data.completed_items) st.data.completed_items[key] = new Date().toISOString();
      if (d.assignment) st.data.assignment = d.assignment;
      st.ackArmed = false;
      if (d.assignment_completed && !(opts && opts.stay)) {
        st.celebrate = true;
        // Finishing the last required step earns the closing screen rather
        // than leaving the reader on a section that has nothing left in it.
        st.step = indStepCount(indSections('learner')) - 1;
      }
      loadMyLearning();
    }
    render();
    return d;
  }

  /**
   * The one deliberate completion: the closing screen's Mark as Complete. It
   * records every counted reading, task and resource still open — the reader
   * has been through the sections — and the server flips the assignment
   * complete on the last one. Acknowledgements and knowledge checks are never
   * swept up: those are the learner's own acts, and the closing screen lists
   * them instead while any are outstanding.
   */
  async function alFinish() {
    var st = S.assignment;
    if (!st || st.preview || !st.data || st.busy) return;
    var a = st.data.assignment;
    if (!a || a.status === 'completed') return;
    var todo = alCountedItems(indSections('learner')).filter(function (e) {
      var t = e.item.type;
      return (t === 'content' || t === 'task' || t === 'resource') && !alItemDone(e.item.key);
    });
    for (var i = 0; i < todo.length; i++) {
      var d = await alComplete(todo[i].item.key, {}, { stay: true });
      if (!d) return;
    }
    render();
  }

  /**
   * The learner's own reset. The server clears every recorded item on this
   * assignment and zeroes the counters; it stays theirs and stays In progress.
   * Deliberate and confirmed — it is the one action here that undoes work.
   */
  async function alRestart() {
    var st = S.assignment;
    if (!st || st.preview || !st.data || st.busy) return;
    var a = st.data.assignment;
    if (!a || a.status !== 'in_progress') return;
    if (!confirm('Restart this induction? Everything you have ticked off in it is cleared and you start again from the top.')) return;
    st.busy = true;
    render();
    var d = await api('/api/learning/my/' + encodeURIComponent(st.id) + '/restart', { method: 'POST' });
    st.busy = false;
    if (!d.ok) { alert(d.error || 'The induction could not be restarted.'); return render(); }
    st.data = { assignment: d.assignment, content: d.content, completed_items: {} };
    st.quizAnswers = {};
    st.quizResult = null;
    st.ackArmed = false;
    loadMyLearning();
    indScrollTop();
    render();
  }

  /** Bring one item into view — the closing block lists what is still owed. */
  function alJumpItem(key) {
    try {
      var el = global.document.getElementById('rh2-item-' + String(key || ''));
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (e) { /* scrolling is never fatal */ }
  }

  function alAckArm(key) { S.assignment.ackArmed = String(key); render(); }
  function alAckCancel() { S.assignment.ackArmed = false; render(); }
  function alAckConfirm(key) { alComplete(key, { acknowledged: true }); }

  function alQuizPick(key, qi, oi) {
    var st = S.assignment;
    if (!st.quizAnswers[key]) st.quizAnswers[key] = {};
    st.quizAnswers[key][qi] = Number(oi);
    // No render: the radio itself holds the visible state.
  }

  async function alQuizSubmit(key, questionCount) {
    var st = S.assignment;
    var picks = st.quizAnswers[key] || {};
    var answers = [];
    for (var i = 0; i < questionCount; i++) {
      if (picks[i] === undefined) {
        alert('Please answer every question before submitting.');
        return;
      }
      answers.push(picks[i]);
    }
    if (st.preview) {
      st.previewDone[key] = true;
      st.quizResult = { forItem: key, passed: true, preview: true };
      render();
      return;
    }
    var d = await alComplete(key, { answers: answers });
    if (d && d.quiz) {
      st.quizResult = { forItem: key, passed: !!d.completed, score: d.quiz.score, total: d.quiz.total, percent: d.quiz.percent };
      render();
    }
  }

  function alQuizRetry(key) {
    S.assignment.quizResult = null;
    S.assignment.quizAnswers[key] = {};
    render();
  }

  // ── A walkthrough launched from inside the induction ───────────────────────
  //
  //  A resource item whose resource carries an interactive walkthrough IS that
  //  walkthrough: the tile launches it directly — no resource detail page, no
  //  separate completion button. When the overlay closes (paused or finished)
  //  the reader lands back on the induction, in place, and a finished
  //  walkthrough records the item by itself.

  /** Who to tell when the overlay closes. Armed only once the overlay is
   *  really up, so a refused launch can never yank the reader around later. */
  var pendingWalk = null;

  /** The interactive walkthrough behind an item, when there is one this user
   *  can run. A resource item finds it through its hub slug; a task item may
   *  name one directly with `walkthrough_key` (the Splose lessons — external
   *  system, no hub page to link). */
  function alWalkModule(item) {
    if (!item) return null;
    if (typeof global.OpalInduction === 'undefined' || !global.OpalInduction.moduleForSlug) return null;
    if (item.type === 'resource' && item.resource_slug) {
      return global.OpalInduction.moduleForSlug(item.resource_slug) || null;
    }
    if (item.type === 'task' && item.walkthrough_key) {
      return global.OpalInduction.moduleForSlug(item.walkthrough_key) || null;
    }
    return null;
  }

  function alFindItem(key) {
    var sections = indSections(indMode());
    for (var i = 0; i < sections.length; i++) {
      var items = (sections[i] && sections[i].items) || [];
      for (var j = 0; j < items.length; j++) {
        if (items[j].key === key) return items[j];
      }
    }
    return null;
  }

  /** The resource tile's one action: the walkthrough when there is one, the
   *  resource itself otherwise. Opening it is doing it. */
  function alOpenWalk(key) {
    var st = S.assignment;
    var item = alFindItem(key);
    if (!st || !item) return;
    var mod = alWalkModule(item);
    if (st.preview) {
      // The preview opens the real thing, read-only: the walkthrough runs in
      // its own preview mode (nothing saved — not even the Owner's place),
      // and the tile ticks only when it is finished, the learner's contract.
      if (mod) {
        var pLaunch = { preview: true, itemKey: key, moduleKey: mod.key, wfId: st.previewWfId, step: st.step };
        Promise.resolve(global.OpalInduction.start(mod.key, { preview: true })).then(function () {
          if (doc.getElementById('ind-layer')) pendingWalk = pLaunch;
        });
        return;
      }
      if (item.type !== 'resource') return;
      st.previewDone[key] = true;
      return openDetail(item.resource_id, 'assignment');
    }
    if (!mod) {
      // A task's launch tile only renders when its walkthrough resolves, so a
      // task landing here has nothing to open — a resource opens its hub page.
      if (item.type !== 'resource') return;
      if (!alItemDone(key) && st.data && st.data.assignment && st.data.assignment.status !== 'completed') {
        alComplete(key, {}, { quiet: true, stay: true });
      }
      return openDetail(item.resource_id, 'assignment');
    }
    var launch = { itemKey: key, moduleKey: mod.key, assignmentId: st.id, step: st.step };
    Promise.resolve(global.OpalInduction.start(mod.key)).then(function () {
      if (doc.getElementById('ind-layer')) pendingWalk = launch;
    });
  }

  /** Back from a walkthrough: restore the induction where the reader left it,
   *  and record the item when the walkthrough was finished. A preview return
   *  is the same journey with nothing recorded — the engine's event says
   *  whether the preview run finished, and the tick lands in previewDone. */
  async function alWalkReturn(p, detail) {
    var st = S.assignment;
    if (!st) return;
    if (p.preview) {
      if (!st.preview || String(st.previewWfId) !== String(p.wfId)) return;
    } else if (!st.id || st.preview || String(st.id) !== String(p.assignmentId)) {
      return;
    }
    st.step = p.step;
    try { if (typeof global.switchTab === 'function') global.switchTab('resources'); } catch (e) { /* the player renders regardless */ }
    try { if (typeof global.rhSwitch === 'function') global.rhSwitch('shared'); } catch (e) { /* as above */ }
    if (p.preview) {
      if (detail && detail.preview && detail.finished) st.previewDone[p.itemKey] = true;
    } else {
      var mod = (typeof global.OpalInduction !== 'undefined' && global.OpalInduction.moduleForSlug)
        ? global.OpalInduction.moduleForSlug(p.moduleKey) : null;
      var finished = mod && (mod.state === 'completed' || mod.state === 'updated');
      var a = st.data && st.data.assignment;
      if (finished && !alItemDone(p.itemKey) && a && a.status !== 'completed') {
        await alComplete(p.itemKey, {}, { quiet: true });
      }
    }
    S.view = 'assignment';
    // Through the PUBLIC nav so the URL lands back on the player; re-entry of
    // the same assignment (or the same preview) keeps the step set above.
    (global.RH2 && global.RH2.nav ? global.RH2.nav : nav)('assignment');
  }

  function alItemBody(item, done) {
    var st = S.assignment;
    var key = item.key;
    var out = '<div class="rh2-learn-item-body">';
    if (item.body) out += '<div class="rh2-learn-prose">' + mdRender(item.body) + '</div>';

    if (item.type === 'acknowledgement') {
      out += '<blockquote class="rh2-learn-ack">' + mdRender(item.ack_statement || '') + '</blockquote>';
      if (!done) {
        if (st.ackArmed === key) {
          out += '<div class="rh2-learn-actions"><span class="rh2-quiet">Confirm you have read and understood the statement above.</span>' +
            '<button type="button" class="rh2-btn rh2-btn-primary" ' + (st.busy ? 'disabled ' : '') +
              'onclick="RH2.alAckConfirm(\'' + esc(key) + '\')">Confirm acknowledgement</button>' +
            '<button type="button" class="rh2-btn" onclick="RH2.alAckCancel()">Cancel</button></div>';
        } else {
          out += '<div class="rh2-learn-actions"><button type="button" class="rh2-btn rh2-btn-primary" ' +
            'onclick="RH2.alAckArm(\'' + esc(key) + '\')">I acknowledge</button></div>';
        }
      }
    } else if (item.type === 'quiz') {
      var quiz = item.quiz || { questions: [] };
      var result = st.quizResult && st.quizResult.forItem === key ? st.quizResult : null;
      if (done) {
        out += '<p class="rh2-quiet">Knowledge check passed.</p>';
      } else if (result && !result.passed) {
        out += '<div class="rh2-learn-quiz-result rh2-learn-quiz-fail">Not quite — ' +
          result.score + ' of ' + result.total + ' correct (' + result.percent + '%). ' +
          'Pass mark is ' + esc(quiz.passThreshold || 80) + '%.' +
          ' <button type="button" class="rh2-btn" onclick="RH2.alQuizRetry(\'' + esc(key) + '\')">Try again</button></div>';
      } else {
        var picks = st.quizAnswers[key] || {};
        out += quiz.questions.map(function (q, qi) {
          return '<fieldset class="rh2-learn-q"><legend>' + (qi + 1) + '. ' + esc(q.question) + '</legend>' +
            (q.options || []).map(function (opt, oi) {
              var rid = 'la-q-' + esc(key) + '-' + qi + '-' + oi;
              // checked renders from state so a re-render (progress save,
              // another item completing) never visually clears a selection
              // that S.assignment.quizAnswers still holds.
              return '<label class="rh2-learn-opt" for="' + rid + '">' +
                '<input type="radio" id="' + rid + '" name="la-q-' + esc(key) + '-' + qi + '" ' +
                (picks[qi] === oi ? 'checked ' : '') +
                'onchange="RH2.alQuizPick(\'' + esc(key) + '\',' + qi + ',' + oi + ')">' +
                '<span>' + esc(opt) + '</span></label>';
            }).join('') + '</fieldset>';
        }).join('');
        out += '<div class="rh2-learn-actions"><button type="button" class="rh2-btn rh2-btn-primary" ' +
          (st.busy ? 'disabled ' : '') +
          'onclick="RH2.alQuizSubmit(\'' + esc(key) + '\',' + (quiz.questions || []).length + ')">Submit answers</button></div>';
      }
    }
    // content, task and resource items carry no completion buttons: reading
    // past the section records readings and tasks, and a resource records
    // itself when its tile is opened.
    if (done && !st.preview) {
      var when = st.data.completed_items && st.data.completed_items[key];
      out += '<p class="rh2-quiet">Completed' + (when ? ' ' + esc(fmtDate(when)) : '') + '.</p>';
    }
    return out + '</div>';
  }

  /** One section. In the editor it is one screen; a reader sees every
   *  section on the one page (`flat`), where the section title is a heading
   *  only when there is more than one section to tell apart. */
  function indSectionRead(s, step, secCount, flat) {
    if (!s) return '<div class="rh2-empty">This section is empty.</div>';
    var items = s.items || [];
    var out = flat
      ? (secCount > 1 ? '<h2 class="rh2-ind-sectitle">' + esc(s.title) + '</h2>' : '')
      : '<div class="rh2-ind-steplbl">Section ' + step + ' of ' + secCount + '</div>' +
        '<h2 class="rh2-ind-sectitle">' + esc(s.title) + '</h2>';
    if (!items.length) return out + '<p class="rh2-quiet">There is nothing in this section yet.</p>';
    return out + '<ol class="rh2-ind-items">' + items.map(function (it) {
      var done = alItemDone(it.key);
      // Only the interactions announce themselves; readings and resources are
      // simply content, not labelled mechanics.
      var typeLabel = (it.type === 'acknowledgement' || it.type === 'quiz')
        ? ' <span class="rh2-chip rh2-chip-quiet">' + esc(LA_ITEM_TYPE_LABELS[it.type]) + '</span>' : '';
      var reqLabel = it.required === false ? ' <span class="rh2-chip rh2-chip-quiet">Optional</span>' : '';
      var head = '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(it.title) + typeLabel + reqLabel + '</span>' +
        (it.minutes ? '<span class="rh2-row-sub">' + esc(it.minutes) + ' min</span>' : '') + '</span>' +
        (done ? '<span class="rh2-module-done" aria-label="Completed">' + icn('check', 'check') + '</span>' : '');
      // The tile IS the action: click anywhere on it to run the interactive
      // walkthrough, or to open the resource when there is no walkthrough.
      // Tasks join the launch-tile club only when they name a walkthrough
      // this user can actually run; otherwise a task is plain content.
      var mod = alWalkModule(it);
      if (it.type === 'resource' || mod) {
        var verb = mod
          ? ((done ? 'Replay' : 'Open') + ' the interactive walkthrough')
          : ('Open' + (it.resource_title ? ': ' + it.resource_title : ' the resource'));
        return '<li class="rh2-ind-item rh2-ind-item-launch' + (done ? ' is-done' : '') + '" id="rh2-item-' + esc(it.key) + '">' +
          '<button type="button" class="rh2-ind-launch" onclick="RH2.alOpenWalk(\'' + esc(it.key) + '\')">' +
            '<span class="rh2-ind-item-head">' + head + '</span>' +
            '<span class="rh2-ind-launch-hint">' + esc(verb) + ' &rarr;</span>' +
          '</button>' + alItemBody(it, done) + '</li>';
      }
      return '<li class="rh2-ind-item' + (done ? ' is-done' : '') + '" id="rh2-item-' + esc(it.key) + '">' +
        '<div class="rh2-ind-item-head">' + head + '</div>' + alItemBody(it, done) + '</li>';
    }).join('') + '</ol>';
  }

  /** The closing screen: the deliberate completion, or what is still owed. */
  function indFinishRead(a, sections, mode) {
    var outstanding = alCountedItems(sections).filter(function (e) { return !alItemDone(e.item.key); });
    // Acknowledgements and knowledge checks are the learner's own acts —
    // completion waits for them. Everything else the completion records.
    var interactive = outstanding.filter(function (e) {
      return e.item.type === 'acknowledgement' || e.item.type === 'quiz';
    });
    var out = '<div class="rh2-ind-steplbl">' + (mode === 'preview' ? 'End of preview' : 'Complete') + '</div>';
    if (mode === 'preview') {
      out += '<h2 class="rh2-ind-sectitle">That is the whole induction</h2>' +
        '<p class="rh2-quiet">This is exactly what the person you assign it to works through. ' +
        'Nothing on this screen has been saved, and no learner&rsquo;s progress has changed.</p>';
    } else if (a.status === 'completed') {
      out += '<h2 class="rh2-ind-sectitle">All done &#127881;</h2>' +
        '<p>This learning is recorded as completed' +
        (pick(a, 'completed_at') ? ' on ' + esc(fmtDate(pick(a, 'completed_at'))) : '') +
        '. You can come back through it any time.</p>';
    } else if (interactive.length) {
      out += '<h2 class="rh2-ind-sectitle">Nearly there</h2>' +
        '<p class="rh2-quiet">' + interactive.length + ' step' + (interactive.length === 1 ? ' needs' : 's need') +
        ' you before this can be completed:</p><ol class="rh2-ind-toc">' + interactive.map(function (e, i) {
          // Everything is on this page: the row scrolls to the item itself.
          return '<li><button type="button" class="rh2-ind-tocbtn" onclick="RH2.alJumpItem(\'' + esc(e.item.key) + '\')">' +
            '<span class="rh2-ind-item-no">' + (i + 1) + '</span>' +
            '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(e.item.title) + '</span>' +
            '<span class="rh2-row-sub">' + esc((sections[e.section - 1] || {}).title || '') + '</span></span></button></li>';
        }).join('') + '</ol>';
    } else {
      out += '<h2 class="rh2-ind-sectitle">That is the whole induction</h2>' +
        '<p class="rh2-quiet">Marking it complete records it on your learning record — you can still revisit it any time.</p>' +
        '<div class="rh2-learn-actions"><button type="button" class="rh2-btn rh2-btn-primary" ' +
          (S.assignment.busy ? 'disabled ' : '') +
          'onclick="RH2.alFinish()">Mark as Complete</button></div>';
    }
    // A started induction can be restarted by the person doing it: every
    // recorded item is cleared server-side and they begin again from the top.
    var restart = (mode === 'learner' && a.status === 'in_progress')
      ? '<button type="button" class="rh2-btn" ' + (S.assignment.busy ? 'disabled ' : '') +
        'onclick="RH2.alRestart()">Restart induction</button>'
      : '';
    return out + '<div class="rh2-learn-actions"><button type="button" class="rh2-btn" onclick="RH2.alBack()">' +
      (mode === 'preview' ? 'Close preview' : 'Back to My Learning') + '</button>' + restart + '</div>';
  }

  function renderAssignment() {
    var st = S.assignment;
    var mode = st.preview ? 'preview' : 'learner';
    var out = '<div class="rh2-page rh2-learn-player rh2-ind">';
    var backBtn = '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.alBack()">&larr; ' +
      (st.preview ? 'Back to Learning' : 'Back to My Learning') + '</button>';
    if (st.loading || (!st.data && !st.err)) return out + backBtn + '<div class="rh2-card">' + skel(4, 64) + '</div></div>';
    if (st.err) return out + backBtn + '<div class="rh2-empty">' + esc(st.err) + '</div></div>';

    var a = st.data.assignment || {};
    var sections = (st.data.content && st.data.content.sections) || [];

    out += '<div class="rh2-learn-player-top">' + backBtn +
      (st.preview
        ? '<span class="rh2-chip rh2-chip-warn">Preview &mdash; read only, nothing is saved</span>'
        : laStatusChip(a)) +
      '</div>';

    var sub = esc(laCatLabel(pick(a, 'category'))) +
      (pick(a, 'version') ? ' &middot; Version ' + esc(pick(a, 'version')) : '') +
      (pick(a, 'mandatory') === false ? ' &middot; Optional' : ' &middot; Mandatory') +
      (st.preview ? '' :
        ' &middot; Assigned ' + esc(fmtDate(pick(a, 'assigned_at'))) +
        (pick(a, 'assigned_by_name') ? ' by ' + esc(pick(a, 'assigned_by_name')) : '') +
        (pick(a, 'due_at') ? ' &middot; Due ' + esc(fmtDate(pick(a, 'due_at'))) : ''));

    out += indHeader(mode, {
      title: pick(a, 'title'),
      sub: sub,
      progress: st.preview ? null : {
        percent: pick(a, 'progress_percent') || 0,
        done: pick(a, 'required_done') || 0,
        total: pick(a, 'required_total') || 0,
      },
    }, sections, 0);

    if (!st.preview && pick(a, 'owner_note')) {
      out += '<p class="rh2-quiet rh2-learn-note">' + esc(pick(a, 'owner_note')) + '</p>';
    }

    // The whole induction on one page: every section's items in order, then
    // the closing block (Mark as Complete, or what is still owed). No steps,
    // no tabs — a reader scrolls, and their place is simply what is ticked.
    out += '<section class="rh2-card rh2-ind-stage rh2-ind-flat">';
    out += sections.length
      ? sections.map(function (s, i) {
          return '<div class="rh2-ind-flatsec">' + indSectionRead(s, i + 1, sections.length, true) + '</div>';
        }).join('')
      : '<div class="rh2-empty">There is nothing in this induction yet.</div>';
    out += '<div class="rh2-ind-flatsec rh2-ind-flatclose">' + indFinishRead(a, sections, mode) + '</div>';
    out += '</section>';
    return out + '</div>';
  }

  // ── Owner: learning console (Admin → Learning) ─────────────────────────────

  async function loadLa() {
    var la = S.la;
    la.loading = true;
    la.err = '';
    render();
    var results = await Promise.all([
      api('/api/learning/workflows' + (la.includeArchived ? '?includeArchived=1' : '')),
      api('/api/learning/staff'),
    ]);
    la.loading = false;
    var wf = results[0], staff = results[1];
    if (!wf.ok) la.err = wf.error || 'Learning workflows could not be loaded.';
    la.workflows = wf.ok ? (wf.workflows || []) : la.workflows;
    la.categories = wf.ok ? (wf.categories || null) : la.categories;
    la.staff = staff.ok ? (staff.staff || []) : la.staff;
    // A failed people list used to leave `staff` null forever, which the assign
    // dialog rendered as a skeleton that never resolved. Remember the failure so
    // it can say so and offer a way out.
    la.staffErr = staff.ok ? '' : (staff.error || 'The list of people could not be loaded.');
    // Both surfaces that show the monitor need its data: the Admin subnav tab
    // when it is the open one, and Assign Learning, which shows it inline.
    if (la.tab === 'assignments' || (S.view === 'learning' && isOwner())) loadLaAssignments();
    render();
  }

  /** Reload only the people list — used to retry after it failed to load. */
  async function loadLaStaff() {
    S.la.staffErr = '';
    S.la.staffLoading = true;
    render();
    var d = await api('/api/learning/staff');
    S.la.staffLoading = false;
    if (d.ok) S.la.staff = d.staff || [];
    else S.la.staffErr = d.error || 'The list of people could not be loaded.';
    render();
  }

  async function loadLaAssignments() {
    var la = S.la;
    var qs = [];
    // `overdue` is not a stored lifecycle state — the server derives it from the
    // due date and completion — so it travels as its own flag. Sending it as a
    // status would either invent a state the data model does not have or filter
    // on one that does not exist.
    if (la.afStatus === 'overdue') qs.push('overdue=1');
    else if (la.afStatus) qs.push('status=' + encodeURIComponent(la.afStatus));
    if (la.afWorkflow) qs.push('workflowId=' + encodeURIComponent(la.afWorkflow));
    if (la.afUser) qs.push('userId=' + encodeURIComponent(la.afUser));
    if (la.afQ) qs.push('q=' + encodeURIComponent(la.afQ));
    var d = await api('/api/learning/assignments' + (qs.length ? '?' + qs.join('&') : ''));
    la.assignments = d.ok ? (d.assignments || []) : [];
    if (!d.ok) la.err = d.error || 'Assignments could not be loaded.';
    render();
  }

  function laNav(t) {
    // The editor and assign panel render INSTEAD of tab content, so switching
    // tabs while one is open would highlight a tab that shows nothing —
    // close them first (the editor close warns about unsaved changes and can
    // be declined, in which case the tab stays put).
    if (S.la.editor) {
      if (S.la.editor._dirty && !confirm('Discard unsaved changes to this workflow?')) return;
      S.la.editor = null;
      S.la.resPick = null;
    }
    S.la.assign = null;
    S.la.tab = t;
    S.la.err = '';
    S.la.openAssignment = null;
    S.la.openData = null;
    if (t === 'assignments' && !S.la.assignments) loadLaAssignments();
    render();
  }

  function renderLa() {
    var la = S.la;
    var subnav = [['library', 'Library'], ['assignments', 'Assignments'], ['staff', 'Staff progress']];
    var out = '<div class="rh2-learn-admin">' +
      '<div class="rh2-subnav" role="tablist" aria-label="Learning administration">' + subnav.map(function (t) {
        return '<button type="button" role="tab" aria-selected="' + (la.tab === t[0]) + '" class="rh2-subnav-btn' +
          (la.tab === t[0] ? ' active' : '') + '" onclick="RH2.laNav(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>';
    if (la.err) out += '<div class="rh2-empty">' + esc(la.err) + '</div>';
    if (la.editor) return out + renderLaEditor() + '</div>';
    // The dialog goes ON TOP of the library rather than replacing it: the
    // Owner keeps sight of what they were working through, and closing it
    // returns them exactly where they were.
    if (la.loading && !la.workflows) return out + '<div class="rh2-card">' + skel(3, 72) + '</div>' + renderLaAssign() + renderLaCreate() + '</div>';
    if (la.tab === 'library') out += renderLaLibrary();
    else if (la.tab === 'assignments') out += renderLaAssignments();
    else if (la.tab === 'staff') out += renderLaStaff();
    return out + renderLaAssign() + renderLaCreate() + '</div>';
  }

  // ── Owner: library ──────────────────────────────────────────────────────────

  function renderLaLibrary() {
    var la = S.la;
    var rows = la.workflows || [];
    var out = '<div class="rh2-learn-lib-head">' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.laCreate()">+ New learning workflow</button>' +
      '<label class="rh2-learn-inline-check"><input type="checkbox" ' + (la.includeArchived ? 'checked ' : '') +
        'onchange="RH2.laToggleArchived(this.checked)"> Show archived</label>' +
      '</div>';
    if (!rows.length) {
      return out + '<div class="rh2-empty">No learning workflows yet. Create your first learning workflow to begin assigning staff learning.</div>';
    }
    out += rows.map(laLibraryCard).join('');
    return out;
  }

  /**
   * One learning item, rendered once for both Owner surfaces.
   *
   * `opts.actions` decides WHICH actions the card offers, never how the item
   * is described — the title, state, counts and warnings are identical
   * wherever it appears, so the two surfaces cannot drift.
   *
   *   'primary'   Assign Learning: the three things the Owner came to do —
   *               Assign, Edit, Preview. Nothing else: the second-stage Edit,
   *               Assignments, Duplicate, Archive and Delete draft each sent
   *               the Owner somewhere other than the job in hand.
   *   'lifecycle' Admin > Learning: the same three plus the lifecycle actions.
   *               Removing them from Assign Learning hides the buttons, not
   *               the capability — the routes, the records and the history are
   *               untouched, and this console is still where they live.
   *
   * `Assign` leads because assigning is what the Owner came to do, but it is
   * withheld from an archived item and from one with nothing in it — a button
   * the server would refuse is worse than no button.
   */
  function laWorkflowCard(w, opts) {
    var lifecycle = !!(opts && opts.actions === 'lifecycle');
    var archived = w.status === 'archived';
    var empty = !(w.module_count || 0);
    var assignable = !archived && !empty;
    var duration = aslDuration(w);
    // The selection checkbox belongs to the Assign Learning page only — the
    // Admin > Learning tab shares this card but has no batch assignment bar.
    var selectable = S.view === 'learning' && assignable;
    var selOn = selectable && !!aslSel()[w.id];
    return '<section class="rh2-card rh2-learn-wf' + (archived ? ' rh2-learn-wf-archived' : '') +
      (selOn ? ' rh2-learn-wf-sel' : '') + '">' +
      '<div class="rh2-learn-card-head">' +
      (selectable
        ? '<input type="checkbox" class="rh2-learn-selbox" ' + (selOn ? 'checked ' : '') +
          'aria-label="Select ' + esc(w.title) + ' for assignment" ' +
          'onchange="RH2.aslToggleSel(\'' + esc(w.id) + '\')">'
        : '') +
      '<span class="rh2-row-title">' + esc(w.title) + '</span>' +
        (archived ? '<span class="rh2-chip rh2-chip-quiet">Archived</span>'
          : (w.has_unpublished_changes ? '<span class="rh2-chip rh2-chip-warn">Draft changes</span>' : '<span class="rh2-chip rh2-chip-ok">Up to date</span>')) +
      '</div>' +
      '<div class="rh2-row-sub">' + esc(aslCatLabel(w.category)) +
        ' · ' + (w.module_count || 0) + ' modules' +
        (duration ? ' · ' + esc(duration) : '') +
        (w.current_version ? ' · Version ' + w.current_version : ' · Never assigned') +
        ' · ' + (w.active_assignments || 0) + ' active / ' + (w.completed_assignments || 0) + ' completed' +
        ' · Updated ' + esc(fmtDate(w.updated_at)) + '</div>' +
      (w.description ? '<p class="rh2-quiet">' + esc(w.description) + '</p>' : '') +
      (!archived && empty
        ? '<p class="rh2-quiet rh2-learn-cannot">Add at least one module before this can be assigned.</p>'
        : '') +
      '<div class="rh2-learn-card-actions">' +
        (assignable ? '<button type="button" class="rh2-btn rh2-btn-primary" id="asl-assign-' + esc(w.id) +
          '" onclick="RH2.laAssignOpen(\'' + esc(w.id) + '\')">Assign</button>' : '') +
        (!archived ? '<button type="button" class="rh2-btn" onclick="RH2.laEdit(\'' + esc(w.id) + '\')">Edit</button>' : '') +
        '<button type="button" class="rh2-btn" onclick="RH2.laPreview(\'' + esc(w.id) + '\')">Preview</button>' +
        // An archived row needs a way back on EVERY surface — hiding both the
        // archive action and its undo would leave the item unreachable.
        (archived ? '<button type="button" class="rh2-btn" onclick="RH2.laUnarchive(\'' + esc(w.id) + '\')">Unarchive</button>' : '') +
        (lifecycle
          ? '<button type="button" class="rh2-btn" onclick="RH2.laViewAssignments(\'' + esc(w.id) + '\')">Assignments</button>' +
            '<button type="button" class="rh2-btn" onclick="RH2.laDuplicate(\'' + esc(w.id) + '\')">Duplicate</button>' +
            (archived ? ''
              : '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laArchive(\'' + esc(w.id) + '\')">Archive</button>') +
            (!w.active_assignments && !w.completed_assignments && !w.current_version
              ? '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laDelete(\'' + esc(w.id) + '\')">Delete draft</button>' : '')
          : '') +
      '</div></section>';
  }

  /** Assign Learning: Assign, Edit, Preview — nothing else. */
  function aslWorkflowCard(w) { return laWorkflowCard(w, { actions: 'primary' }); }

  /** Admin > Learning: the same card, plus the lifecycle actions. */
  function laLibraryCard(w) { return laWorkflowCard(w, { actions: 'lifecycle' }); }

  // ═══════════════════════════════════════════════════════════════════════════
  //  OWNER: ASSIGN LEARNING
  //
  //  The Owner's learning surface is a REPOSITORY, not a personal record. Where
  //  a therapist sees "My Learning" — what they must do — an Owner sees the
  //  practice's whole library and who to give it to.
  //
  //  "Continue learning" and "Required for you" are therefore not merely hidden
  //  here: renderHome and the view dispatch never build them for an owner, so
  //  there is nothing in the DOM to reveal. An Owner's own progress is not a
  //  thing this product tracks, and an empty personal panel shown to the person
  //  who assigns the work reads as a bug.
  //
  //  The catalogue is ONE list. Category remains a free vocabulary on the
  //  record and is printed on every card and searchable by name, but it no
  //  longer groups the page into shelves the Owner has to open before they can
  //  see their own library.
  // ═══════════════════════════════════════════════════════════════════════════

  /** How many of the most recently updated items "Recently added" shows. */
  var ASL_RECENT_LIMIT = 6;

  /** Initials for a person chip. No avatar image is stored, so this is it. */
  function initials(name, email) {
    var src = String(name || '').trim() || String(email || '').split('@')[0].replace(/[._-]+/g, ' ');
    // Leading punctuation is not a name: display names here include things like
    // "Ann (Owner)", which must initial as AO rather than "A(".
    var parts = src.split(/\s+/).map(function (w) {
      return w.replace(/^[^0-9A-Za-z\u00C0-\uFFFF]+/, '');
    }).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  /** "graduate_foundations" → "Graduate Foundations". */
  function titleish(s) {
    return String(s || '').replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  /**
   * A collection name: the seeded label where there is one, and a readable
   * version of whatever the practice typed where there is not.
   */
  function aslCatLabel(key) { return titleish(laCatLabel(key) || key || 'Uncategorised'); }

  /** A portal role, in the words the Owner uses for it. */
  var ASL_ROLE_LABELS = {
    owner: 'Owner', admin: 'Admin', therapist: 'Therapist',
    read_only: 'Read-only', pre_employee: 'New starter',
  };
  function roleLabel(r) { return ASL_ROLE_LABELS[r] || titleish(r); }

  /** Estimated duration, only when the author actually recorded one. */
  function aslDuration(w) {
    var m = Number(w.estimated_minutes || 0);
    if (!m) return '';
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60), rem = m % 60;
    return h + ' hr' + (h === 1 ? '' : 's') + (rem ? ' ' + rem + ' min' : '');
  }

  /**
   * The whole catalogue, narrowed only by the search box.
   *
   * Category is still on every record and still printed on every card; it no
   * longer decides what the Owner is permitted to see. Search reads the title,
   * the description AND the category label, so somebody who thinks in
   * categories can still type "rural" and get the rural items — without a
   * shelf standing between them and their own library.
   */
  function aslVisible() {
    var rows = (S.la.workflows || []).slice();
    var q = String(S.asl.q || '').trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(function (w) {
      return String(w.title || '').toLowerCase().indexOf(q) !== -1 ||
             String(w.description || '').toLowerCase().indexOf(q) !== -1 ||
             aslCatLabel(w.category).toLowerCase().indexOf(q) !== -1;
    });
  }

  function aslSearch(v) { S.asl.q = v; render(); }
  function aslResetFilters() { S.asl.q = ''; render(); }
  function aslReload() { loadLa(); }

  // ── Library multi-select (checkbox per card → one Assign for the batch) ────

  function aslSel() { if (!S.asl.sel) S.asl.sel = {}; return S.asl.sel; }

  /**
   * The selected items that can ACTUALLY be assigned right now.
   *
   * Selection is held by id, and the library behind it can move: an item can
   * be archived, emptied or deleted in another tab between the tick and the
   * click. Counting raw keys would then advertise "Assign selected (3)" and
   * open a dialog with two items — or, if every key is stale, a button that
   * does nothing at all. Resolving against the live library each render is
   * what keeps the count honest.
   */
  function aslSelectedWorkflows() {
    var sel = aslSel();
    return (S.la.workflows || []).filter(function (w) {
      return sel[w.id] && w.status === 'active' && (w.module_count || 0) > 0;
    });
  }

  function aslSelCount() { return aslSelectedWorkflows().length; }

  function aslToggleSel(id) {
    var s = aslSel();
    if (s[id]) delete s[id];
    else s[id] = true;
    render();
  }

  function aslClearSel() { S.asl.sel = {}; render(); }

  /** Every assignable card currently shown (active, has modules). */
  function aslSelectable() {
    return aslVisible().filter(function (w) {
      return w.status === 'active' && (w.module_count || 0) > 0;
    });
  }

  /** Toggle: select every assignable card shown, or clear them all. */
  function aslSelectAllShown() {
    var s = aslSel();
    var shown = aslSelectable();
    var allOn = shown.length > 0 && shown.every(function (w) { return s[w.id]; });
    shown.forEach(function (w) {
      if (allOn) delete s[w.id];
      else s[w.id] = true;
    });
    render();
  }

  function renderAssignLearning() {
    var la = S.la;
    var a = S.asl;
    var out = '<div class="rh2-page">' +
      '<h1 class="rh2-h1">Assign Learning</h1>' +
      '<p class="rh2-page-intro">Every induction and learning item the practice holds, in one list. ' +
      'Assign one to the people who need it, edit it exactly as they will see it, or preview it first.</p>';

    if (la.loading && !la.workflows) {
      return out + '<div class="rh2-card">' + skel(3, 72) + '</div></div>';
    }
    if (la.err && !la.workflows) {
      return out + '<div class="rh2-empty">' + esc(la.err) +
        ' <button type="button" class="rh2-btn" onclick="RH2.aslReload()">Retry</button></div></div>';
    }
    // Edit opens the induction itself, in place, and takes the whole page.
    if (la.editor) return out + renderLaEditor() + '</div>';

    // ── The catalogue ───────────────────────────────────────────────────────
    // One unified list. Collections used to stand between the Owner and their
    // own library: a shelf had to be opened before anything could be seen, and
    // an item filed under a category nobody thought to click was invisible.
    // Category still exists on the record (and still shows on every card) —
    // it just no longer decides what the Owner is allowed to look at.
    var all = la.workflows || [];
    var rows = aslVisible();

    out += '<section class="rh2-card" aria-labelledby="asl-h-lib">' +
      '<div class="rh2-learn-cat-head">' +
      '<div class="rh2-learn-cat-heading">' +
        '<h2 class="rh2-h2" id="asl-h-lib">All learning</h2>' +
        (all.length
          ? '<p class="rh2-row-sub">' + (a.q ? rows.length + ' of ' + all.length : all.length) +
            ' item' + ((a.q ? rows.length : all.length) === 1 ? '' : 's') + '</p>'
          : '') +
      '</div>' +
      // Search, the archived toggle and the create actions filter or add to a
      // list. With no items they are controls that cannot do anything, so only
      // the empty state below survives — where the eye already is.
      (all.length
        ? '<div class="rh2-learn-cat-actions">' +
            '<label class="rh2-learn-inline-check"><input type="checkbox" ' + (la.includeArchived ? 'checked ' : '') +
              'onchange="RH2.laToggleArchived(this.checked)"> Show archived</label>' +
            '<button type="button" class="rh2-btn" ' + (la.importing ? 'disabled ' : '') +
              'onclick="RH2.laImport()" title="Bring the Resource Hub learning paths and the portal ' +
              'induction in as editable, assignable items">' +
              (la.importing ? 'Importing…' : 'Import existing') + '</button>' +
            // The walkthrough workshop is a sibling of this console, not a
            // child of any one learning item: a tour built here goes on the
            // shelf and can be used by any induction.
            '<button type="button" class="rh2-btn" onclick="OpalWorkshop.open()" ' +
              'title="Build and edit the interactive walkthroughs — the pop-ups and spotlights">' +
              'Walkthroughs</button>' +
            '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.laCreate()">+ New learning item</button>' +
          '</div>' +
          // Its own full-width row beneath the heading, so the field lines up
          // with the cards it filters instead of floating off to the right.
          '<div class="rh2-learn-cat-search">' +
            '<label class="rh2-visually-hidden" for="asl-q">Search learning</label>' +
            '<span class="rh2-learn-cat-search-icn" aria-hidden="true">' + icn('search', 'search', 16) + '</span>' +
            '<input class="rh2-input" id="asl-q" type="search" placeholder="Search learning…" value="' + esc(a.q) + '"' +
              ' oninput="RH2.aslSearch(this.value)">' +
            (a.q ? '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.aslResetFilters()">Clear</button>' : '') +
          '</div>'
        : '') +
      '</div>' +
      (la.importNote
        ? '<div class="rh2-learn-done-banner" role="status">' + esc(la.importNote) +
          ' <button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laImportDismiss()">Dismiss</button></div>'
        : '');

    if (!all.length) {
      // The practice almost certainly HAS inductions already — as Resource Hub
      // learning paths and the portal walkthroughs. Offering to import them is
      // more use than an empty page that implies none exist.
      out += '<div class="rh2-empty">No learning items here yet. Import the practice&rsquo;s existing ' +
        'inductions to edit and assign them, or start something new.' +
        '<div class="rh2-empty-act">' +
        '<button type="button" class="rh2-btn rh2-btn-primary" ' + (la.importing ? 'disabled ' : '') +
          'onclick="RH2.laImport()">' + (la.importing ? 'Importing…' : 'Import existing inductions') + '</button>' +
        '<button type="button" class="rh2-btn" onclick="RH2.laCreate()">+ New learning item</button>' +
        '</div></div>';
    } else if (!rows.length) {
      out += '<div class="rh2-empty">Nothing matches &ldquo;' + esc(a.q) + '&rdquo;.' +
        ' <button type="button" class="rh2-btn" onclick="RH2.aslResetFilters()">Clear search</button></div>';
    } else {
      // Batch bar: tick several items, assign them all in one pass. Lives
      // above the cards so the count and the action stay in view together.
      var selCount = aslSelCount();
      var selectable = aslSelectable();
      var allOn = selectable.length > 0 && selectable.every(function (w) { return aslSel()[w.id]; });
      out += '<div class="rh2-learn-selbar">' +
        (selectable.length > 1
          ? '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.aslSelectAllShown()">' +
            (allOn ? 'Clear shown' : 'Select all shown (' + selectable.length + ')') + '</button>'
          : '') +
        '<span class="rh2-learn-assign-count" role="status" aria-live="polite">' +
          (selCount ? selCount + ' selected' : 'Tick items to assign several at once') + '</span>' +
        (selCount
          ? '<button type="button" class="rh2-btn rh2-btn-primary" id="asl-bulk-assign" ' +
            'onclick="RH2.laAssignOpenMulti()">Assign selected (' + selCount + ')</button>' +
            '<button type="button" class="rh2-btn" onclick="RH2.aslClearSel()">Clear selection</button>'
          : '') +
        '</div>';
      out += rows.map(aslWorkflowCard).join('');
    }
    out += '</section>';

    // ── Assignment status ───────────────────────────────────────────────────
    // The same monitor the Admin > Learning tab carries, rendered here in
    // place. Assigning and checking who is behind on what are one job, and
    // splitting them across two tabs meant the Owner had to leave this page to
    // answer the obvious follow-up question.
    //
    // Shared renderer, shared `S.la` state, shared endpoint — deliberately no
    // second assignments view that could drift from this one.
    //
    // An empty library with no assignments has nothing to monitor, and the
    // library's own empty state is already the invitation; but assignments can
    // outlive a library filtered down to nothing (everything archived), so the
    // section stays whenever there is something to show.
    if (all.length || (la.assignments && la.assignments.length)) {
      out += '<section class="rh2-card" id="asl-assignments" aria-labelledby="asl-h-assign">' +
        '<h2 class="rh2-h2" id="asl-h-assign">Assignment status</h2>' +
        '<p class="rh2-page-intro">Who has been assigned what, how far they have got, ' +
        'and what has passed its due date.</p>' +
        renderLaAssignments() +
        '</section>';
    }

    out += '<div class="rh2-grid-2">';

    // ── Upcoming professional development ───────────────────────────────────
    var pd = (S.home && (pick(S.home, 'upcoming_pd') || pick(S.home, 'upcomingPd'))) || [];
    out += '<section class="rh2-card rh2-pd-preview" aria-labelledby="asl-h-pd">' +
      '<h2 class="rh2-h-link"><button type="button" class="rh2-heading-btn" onclick="RH2.nav(\'pd\')">' +
      '<span id="asl-h-pd">Upcoming professional development</span>' +
      '<span class="rh2-heading-more" aria-hidden="true">&rsaquo;</span>' +
      '<span class="rh2-visually-hidden"> — open the professional development page</span>' +
      '</button></h2>';
    if (S.homeLoading && !S.home) out += skel(2);
    else if (!pd.length) out += '<p class="rh2-quiet">No upcoming professional development is scheduled.</p>';
    else out += pd.map(function (e) {
      return '<div class="rh2-pd-row"><div class="rh2-pd-date">' + esc(fmtDateTime(pick(e, 'starts_at'))) + '</div>' +
        '<div class="rh2-row-title">' + esc(pick(e, 'title')) + '</div>' +
        '<div class="rh2-row-sub">' + esc(pick(e, 'provider') || '') + '</div></div>';
    }).join('');
    out += '</section>';

    // ── Recently added ──────────────────────────────────────────────────────
    // A plain list, not a way in: the catalogue above already shows every item,
    // so these rows report what changed rather than filtering anything.
    var recent = all.slice().sort(function (x, y) {
      return String(y.updated_at || '').localeCompare(String(x.updated_at || ''));
    }).slice(0, ASL_RECENT_LIMIT);
    out += '<section class="rh2-card" aria-labelledby="asl-h-recent">' +
      '<h2 id="asl-h-recent">Recently added</h2>';
    if (!recent.length) out += '<p class="rh2-quiet">Nothing has been added yet.</p>';
    else out += recent.map(function (w) {
      return '<div class="rh2-row"><span class="rh2-row-main">' +
        '<span class="rh2-row-title">' + esc(w.title) + '</span>' +
        '<span class="rh2-row-sub">' + esc(aslCatLabel(w.category)) +
        ' · Updated ' + esc(fmtDate(w.updated_at)) + '</span></span></div>';
    }).join('');
    out += '</section></div>';

    // The assignment dialog goes ON TOP of the page rather than replacing it,
    // so closing it returns the Owner exactly where they were.
    return out + renderLaAssign() + renderLaCreate() + '</div>';
  }

  function laToggleArchived(on) { S.la.includeArchived = !!on; loadLa(); }

  async function laDuplicate(id) {
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' });
    if (!d.ok) { alert(d.error || 'Duplicating failed.'); return; }
    await loadLa();
    laEdit(d.workflow.id);
  }

  async function laArchive(id) {
    if (!confirm('Archive this workflow? It can no longer be assigned; existing assignments and completion history are kept.')) return;
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id) + '/archive', { method: 'POST' });
    if (!d.ok) alert(d.error || 'Archiving failed.');
    loadLa();
  }

  async function laUnarchive(id) {
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id) + '/unarchive', { method: 'POST' });
    if (!d.ok) alert(d.error || 'Unarchiving failed.');
    loadLa();
  }

  async function laDelete(id) {
    if (!confirm('Delete this draft workflow permanently? Only drafts that were never assigned can be deleted.')) return;
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!d.ok) alert(d.error || 'Deleting failed.');
    loadLa();
  }

  /**
   * Naming a new learning item.
   *
   * This used to be window.prompt(). A native prompt is unstyled, ignores the
   * portal's design language, cannot show a category or a validation message,
   * and on some browsers is suppressed entirely — which made the primary
   * "create" action look broken. It is a portal dialog now, the same component
   * the assignment flow uses.
   */
  function laCreate() {
    S.la.create = { title: '', category: 'induction', busy: false, err: '' };
    render();
    var input = doc.getElementById('la-new-title');
    if (input) { try { input.focus(); } catch (e) { /* not yet painted */ } }
  }

  function laCreateClose() {
    if (S.la.create && S.la.create.busy) return;
    S.la.create = null;
    render();
  }

  /**
   * Bring the practice's existing inductions into the assignable library.
   *
   * The Resource Hub's learning paths and the interactive portal induction
   * are real content that predates this page, but neither can be assigned to
   * a named person or edited step by step. Importing copies them in as
   * workflows the Owner owns outright. Idempotent, so the button is safe to
   * press twice.
   */
  async function laImport() {
    if (S.la.importing) return;
    S.la.importing = true;
    S.la.err = '';
    render();
    var d = await api('/api/learning/workflows/import', { method: 'POST' });
    S.la.importing = false;
    if (!d.ok) {
      S.la.err = d.error || 'The existing inductions could not be imported.';
      return render();
    }
    var made = (d.created || []).length;
    S.la.importNote = made
      ? made + ' induction' + (made === 1 ? '' : 's') + ' imported. Edit any of them, then assign.'
      : 'Nothing new to import — the existing inductions are already in this library.';
    await loadLa();
    render();
  }

  function laImportDismiss() { S.la.importNote = ''; render(); }

  function laCreateField(field, value) {
    if (!S.la.create) return;
    S.la.create[field] = value;
    // No re-render: the field already shows what was typed, and re-rendering
    // mid-keystroke would fight the caret.
  }

  function laCreateBackdrop(ev) {
    if (ev && ev.target && ev.target.classList &&
        ev.target.classList.contains('rh2-dialog-backdrop')) laCreateClose();
  }

  async function laCreateSubmit() {
    var c = S.la.create;
    if (!c || c.busy) return;
    var title = String(c.title || '').trim();
    if (!title) {
      c.err = 'Give the learning item a name.';
      render();
      var input = doc.getElementById('la-new-title');
      if (input) { try { input.focus(); } catch (e) { /* gone */ } }
      return;
    }
    c.busy = true;
    c.err = '';
    render();
    var d = await api('/api/learning/workflows', {
      method: 'POST', body: { title: title, category: c.category },
    });
    c.busy = false;
    if (!d.ok) { c.err = d.error || 'The learning item could not be created.'; return render(); }
    S.la.create = null;
    await loadLa();
    // Straight into the editor: naming it is the start of building it.
    laEdit(d.workflow.id);
  }

  function renderLaCreate() {
    var c = S.la.create;
    if (!c) return '';
    var cats = S.la.categories || ['induction', 'clinical', 'compliance', 'safety',
      'administration', 'rural_remote', 'professional_development', 'policy_update', 'other'];
    return '<div class="rh2-dialog-backdrop" onclick="RH2.laCreateBackdrop(event)">' +
      '<section class="rh2-dialog rh2-dialog-sm" role="dialog" aria-modal="true"' +
      ' aria-labelledby="la-new-title-h" id="la-new-dialog">' +
      '<div class="rh2-dialog-head">' +
        '<h2 class="rh2-h2" id="la-new-title-h">New learning item</h2>' +
        '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laCreateClose()"' +
        ' aria-label="Close without creating">Close</button>' +
      '</div>' +
      '<div class="rh2-dialog-body">' +
        '<p class="rh2-quiet rh2-learn-new-hint">Name it now — you can add sections, modules and ' +
        'assessments on the next screen. Nothing is visible to anyone until you assign it.</p>' +
        '<div class="rh2-form-grid">' +
          '<label class="rh2-lbl" for="la-new-title">Name</label>' +
          '<input class="rh2-input" id="la-new-title" value="' + esc(c.title) + '"' +
            ' placeholder="e.g. New Graduate OT Induction" autocomplete="off"' +
            ' oninput="RH2.laCreateField(\'title\',this.value)"' +
            ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();RH2.laCreateSubmit();}">' +
          '<label class="rh2-lbl" for="la-new-cat">Category</label>' +
          '<select class="rh2-select" id="la-new-cat" onchange="RH2.laCreateField(\'category\',this.value)">' +
            cats.map(function (k) {
              return '<option value="' + esc(k) + '"' + (c.category === k ? ' selected' : '') + '>' +
                esc(aslCatLabel(k)) + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
        (c.err ? '<div class="rh2-empty rh2-learn-assign-err" role="alert">' + esc(c.err) + '</div>' : '') +
      '</div>' +
      '<div class="rh2-dialog-foot">' +
        '<button type="button" class="rh2-btn" onclick="RH2.laCreateClose()">Cancel</button>' +
        '<button type="button" class="rh2-btn rh2-btn-primary"' + (c.busy ? ' disabled' : '') +
          ' onclick="RH2.laCreateSubmit()">' + (c.busy ? 'Creating…' : 'Create and edit') + '</button>' +
      '</div></section></div>';
  }

  /**
   * Open the induction in edit mode. There is no intermediate form and no
   * second "enable editing" control — Edit lands the Owner on the learner's
   * own screens with the fields already live.
   *
   * Saving re-opens from the server's normalised copy, so the step the Owner
   * was working on is carried across: being thrown back to the overview every
   * time you save is how an editor teaches people not to save.
   */
  async function laEdit(id) {
    var keepStep = (S.la.editor && S.la.editor.id === id) ? (Number(S.la.editor.step) || 0) : 0;
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id));
    if (!d.ok) { alert(d.error || 'The workflow could not be opened.'); return; }
    // The walkthrough shelf, so a task step in an EXISTING induction can name
    // one and open its editor. Fetched once per editor session and never
    // fatal: an induction stays editable if the shelf is unavailable.
    if (!S.la.walkthroughs) {
      var wl = await api('/api/walkthroughs');
      S.la.walkthroughs = (wl.ok && wl.walkthroughs) || [];
    }
    var w = d.workflow;
    S.la.editor = {
      id: w.id,
      step: keepStep,
      // Click-to-edit state: `editing` names the ONE region currently open as
      // a field; `settingsOpen` names the one step/section settings strip.
      editing: null,
      settingsOpen: null,
      title: w.title,
      description: w.description || '',
      category: w.category || 'induction',
      sections: (w.draft_content && w.draft_content.sections || []).map(function (s) {
        return {
          key: s.key, title: s.title,
          items: (s.items || []).map(function (it) {
            var q = it.quiz || null;
            return {
              key: it.key, type: it.type, title: it.title, body: it.body || '',
              minutes: it.minutes || '', required: it.required !== false,
              resource_id: it.resource_id || '', resource_title: it.resource_title || '',
              walkthrough_key: it.walkthrough_key || '',
              ack_statement: it.ack_statement || '',
              quiz: q ? {
                passThreshold: q.passThreshold || 80,
                questions: (q.questions || []).map(function (qq) {
                  return { question: qq.question, optionsText: (qq.options || []).join('\n'), correctIndex: qq.correctIndex || 0 };
                }),
              } : null,
            };
          }),
        };
      }),
      versions: d.versions || [],
      counts: d.assignment_counts || {},
      // Optimistic lock token: sent back on Save so a save over another
      // session's newer edit is refused (409) instead of clobbering it.
      _loadedUpdatedAt: w.updated_at || null,
      // What learners currently receive, for the editor's publish line.
      _currentVersion: Number(w.current_version) || 0,
      _hasUnpublished: !!w.has_unpublished_changes,
    };
    S.la.editorErr = '';
    S.la.editorStale = false;
    S.la.resPick = null;
    render();
  }

  /** Returns false when the close was declined (unsaved changes kept), so the
   *  navigation wrapper only moves the address when the editor really closed. */
  function laEditorClose() {
    if (S.la.editor && S.la.editor._dirty &&
        !confirm('Discard unsaved changes to this workflow?')) return false;
    S.la.editor = null;
    S.la.resPick = null;
    S.la.publishNote = '';
    S.la.editorStale = false;
    loadLa();
    return true;
  }

  function laEditorContentForApi(ed) {
    return {
      sections: ed.sections.map(function (s) {
        return {
          key: s.key, title: s.title,
          items: s.items.map(function (it) {
            var out = {
              key: it.key, type: it.type, title: it.title, body: it.body,
              required: !!it.required,
            };
            var mins = parseInt(it.minutes, 10);
            if (mins > 0) out.minutes = mins;
            if (it.type === 'resource') { out.resource_id = it.resource_id; out.resource_title = it.resource_title; }
            // Not edited anywhere in the editor UI — carried so an Owner's
            // save never severs a task from its walkthrough.
            if (it.type === 'task' && it.walkthrough_key) out.walkthrough_key = it.walkthrough_key;
            if (it.type === 'acknowledgement') out.ack_statement = it.ack_statement;
            if (it.type === 'quiz' && it.quiz) {
              out.quiz = {
                passThreshold: parseInt(it.quiz.passThreshold, 10) || 80,
                questions: it.quiz.questions.map(function (q) {
                  return {
                    question: q.question,
                    options: String(q.optionsText || '').split('\n').map(function (o) { return o.trim(); }).filter(Boolean),
                    correctIndex: parseInt(q.correctIndex, 10) || 0,
                  };
                }),
              };
            }
            return out;
          }),
        };
      }),
    };
  }

  async function laSave() {
    var ed = S.la.editor;
    if (!ed || S.la.editorSaving) return;
    S.la.editorSaving = true;
    render();
    S.la.publishNote = '';
    var d = await api('/api/learning/workflows/' + encodeURIComponent(ed.id), {
      method: 'PUT',
      body: {
        title: ed.title,
        description: ed.description,
        category: ed.category,
        content: laEditorContentForApi(ed),
        // The updated_at this editor loaded. If another session saved since,
        // the server answers 409 rather than letting this save clobber it.
        expectedUpdatedAt: ed._loadedUpdatedAt || undefined,
      },
    });
    S.la.editorSaving = false;
    if (!d.ok) {
      S.la.editorErr = d.error || 'Saving failed.';
      // A stale edit gets its own recovery path: the fix is to reload, not
      // to hammer Save until the other session's work is overwritten.
      S.la.editorStale = d.status === 409 && d.code === 'stale_edit';
      return render();
    }
    S.la.editorErr = '';
    S.la.editorStale = false;
    // Re-open from the server's normalised copy (keys may have been assigned).
    await laEdit(ed.id);
  }

  /** Discard this editor's unsaved work and load what the server now holds. */
  function laEditorReload() {
    var ed = S.la.editor;
    if (!ed) return;
    if (ed._dirty && !confirm('Discard your unsaved changes and load the latest version?')) return;
    laEdit(ed.id);
  }

  /**
   * Deliberate publish: snapshot the saved draft as the latest version without
   * assigning anyone. Unsaved edits are saved first — publishing what is on
   * the server while the screen shows something newer would mislead.
   */
  async function laPublish(id) {
    var ed = S.la.editor;
    if (S.la.editorSaving || S.la.publishBusy) return;
    if (ed && ed._dirty) {
      await laSave();
      ed = S.la.editor;
      if (S.la.editorErr) return; // save failed (or stale) — surfaced already
    }
    S.la.publishBusy = true;
    render();
    var d = await api('/api/learning/workflows/' + encodeURIComponent(id) + '/publish', { method: 'POST' });
    S.la.publishBusy = false;
    if (!d.ok) {
      if (ed) { S.la.editorErr = d.error || 'Publishing failed.'; render(); }
      else alert(d.error || 'Publishing failed.');
      return;
    }
    var msg = d.published
      ? 'Published version ' + d.version + ' — learners now receive it.'
      : 'Already up to date — learners already receive version ' + d.version + '.';
    if (ed) { S.la.publishNote = msg; await laEdit(id); S.la.publishNote = msg; render(); }
    else { alert(msg); loadLa(); }
  }

  // Editor field handlers deliberately do NOT re-render on keystroke — the
  // input already shows the value; a full re-render would fight the caret.
  // Every mutation flags _dirty so closing the editor can warn honestly.
  function laMeta(field, value) { if (S.la.editor) { S.la.editor[field] = value; S.la.editor._dirty = true; } }
  function laSecField(si, value) { var ed = S.la.editor; if (ed && ed.sections[si]) { ed.sections[si].title = value; ed._dirty = true; } }
  /**
   * The editor's counterpart of the learner's launch tile. A task step that
   * runs an interactive walkthrough says so here, and opens the side-panel
   * editor for it — the pop-ups, spotlights and questions are edited in the
   * induction that uses them, not in a separate console.
   *
   * A key the shelf does not know yet (a built-in nobody has imported) still
   * gets a tile: it offers the import rather than pretending the walkthrough
   * is not there.
   */
  function laItemWalkHtml(it) {
    if (it.type !== 'task' || !it.walkthrough_key) return '';
    var key = it.walkthrough_key;
    var shelf = S.la.walkthroughs || [];
    var known = shelf.some(function (w) { return w.key === key; });

    return '<div class="rh2-learn-ed-walk">' +
      '<button type="button" class="rh2-ind-launch" ' +
        'onclick="RH2.laEditWalkthrough(\'' + esc(key) + '\')">' +
        '<span class="rh2-ind-launch-hint">' +
        (known ? 'Edit the interactive walkthrough' : 'Import to edit the interactive walkthrough') +
        ' &rarr;</span></button>' +
      '<button type="button" class="rh2-btn rh2-btn-quiet" ' +
        'onclick="RH2.laPlayWalkthrough(\'' + esc(key) + '\')">Play it as a learner</button>' +
      '</div>';
  }

  /** Run the walkthrough exactly as a new starter meets it. Nothing recorded. */
  function laPlayWalkthrough(key) {
    if (!global.OpalInduction) return;
    global.OpalInduction.start(String(key || ''), { preview: true });
  }

  /**
   * The walkthrough row inside a task step's settings: which walkthrough this
   * step runs, and the way into its editor. The editor is the same side panel
   * used to build one from scratch — one place to edit a walkthrough, reached
   * from wherever you happen to be.
   */
  function laItemWalkthroughHtml(it, si, ii) {
    var shelf = S.la.walkthroughs || [];
    var current = it.walkthrough_key || '';
    var known = shelf.some(function (w) { return w.key === current; });

    var opts = '<option value="">— no walkthrough —</option>';
    shelf.forEach(function (w) {
      opts += '<option value="' + esc(w.key) + '"' + (w.key === current ? ' selected' : '') + '>' +
        esc(w.title) + '</option>';
    });
    // A key the shelf does not know is kept and shown rather than silently
    // dropped: the built-ins are not on the shelf until they are imported.
    if (current && !known) {
      opts += '<option value="' + esc(current) + '" selected>' + esc(current) + ' (not imported)</option>';
    }

    return '<label class="rh2-lbl">Walkthrough ' +
      '<select class="rh2-input" onchange="RH2.laItemField(' + si + ',' + ii + ',\'walkthrough_key\',this.value)">' +
      opts + '</select></label>' +
      (current
        ? '<button type="button" class="rh2-btn rh2-btn-quiet" ' +
          'onclick="RH2.laEditWalkthrough(\'' + esc(current) + '\')">Edit this walkthrough</button>'
        : '<button type="button" class="rh2-btn rh2-btn-quiet" ' +
          'onclick="OpalWorkshop.open()">Build one</button>');
  }

  /**
   * Open the walkthrough editor for a key named by a learning step.
   *
   * The nine walkthroughs that ship with the portal are served from code
   * until they are imported, so the first time an Owner tries to edit one
   * there is nothing on the shelf to open. Offer the import here rather than
   * sending them to another screen to find a button — importing changes
   * nothing about what staff see.
   */
  async function laEditWalkthrough(key) {
    key = String(key || '');
    var found = (S.la.walkthroughs || []).filter(function (w) { return w.key === key; })[0];

    if (!found) {
      if (!confirm('The walkthroughs that ship with the portal have not been imported yet, so this one ' +
                   'cannot be edited.\n\nImport them now? Nothing changes for staff — they carry on ' +
                   'seeing exactly what they see today.')) return;
      var d = await api('/api/tutorials/seed', { method: 'POST' });
      if (!d.ok) { alert(d.error || 'The walkthroughs could not be imported.'); return; }
      var wl = await api('/api/walkthroughs');
      S.la.walkthroughs = (wl.ok && wl.walkthroughs) || [];
      found = S.la.walkthroughs.filter(function (w) { return w.key === key; })[0];
      if (!found) {
        alert('Imported, but "' + key + '" was not among them — the step may name a walkthrough that no ' +
              'longer exists. Its Settings can point it at another one.');
        render();
        return;
      }
      render();
    }

    if (!global.OpalWorkshop) return;
    global.OpalWorkshop.edit(found.id);
  }

  function laItemField(si, ii, field, value) {
    var ed = S.la.editor;
    if (ed && ed.sections[si] && ed.sections[si].items[ii]) { ed.sections[si].items[ii][field] = value; ed._dirty = true; }
  }
  function laQuizField(si, ii, field, value) {
    var ed = S.la.editor;
    var it = ed && ed.sections[si] && ed.sections[si].items[ii];
    if (it && it.quiz) { it.quiz[field] = value; ed._dirty = true; }
  }
  function laQField(si, ii, qi, field, value) {
    var ed = S.la.editor;
    var it = ed && ed.sections[si] && ed.sections[si].items[ii];
    if (it && it.quiz && it.quiz.questions[qi]) { it.quiz.questions[qi][field] = value; ed._dirty = true; }
  }

  function laSecAdd() {
    var ed = S.la.editor;
    ed.sections.push({ key: '', title: 'New section', items: [] });
    ed._dirty = true;
    // Land ON the new section's screen with its title open: adding a section
    // is the start of writing it, not a row appended to a list somewhere.
    ed.step = ed.sections.length;
    laEditStart('s-' + (ed.sections.length - 1));
  }
  function laSecRemove(si) {
    var ed = S.la.editor;
    var s = ed.sections[si];
    if (!s) return;
    if (s.items.length && !confirm('Remove the section "' + s.title + '" and its ' + s.items.length + ' item(s)?')) return;
    ed.sections.splice(si, 1);
    // Editing/settings keys are positional; a removal renumbers everything after it.
    ed.editing = null;
    ed.settingsOpen = null;
    ed._dirty = true;
    render();
  }
  function laSecMove(si, dir) {
    var ed = S.la.editor;
    var to = si + dir;
    if (to < 0 || to >= ed.sections.length) return;
    var s = ed.sections.splice(si, 1)[0];
    ed.sections.splice(to, 0, s);
    // The screen and the open settings strip both follow the section they
    // belong to — a move must not leave the Owner looking at the neighbour.
    if (Number(ed.step) === si + 1) ed.step = to + 1;
    else if (Number(ed.step) === to + 1) ed.step = si + 1;
    if (ed.settingsOpen === 's-' + si) ed.settingsOpen = 's-' + to;
    else if (ed.settingsOpen === 's-' + to) ed.settingsOpen = 's-' + si;
    ed.editing = null;
    ed._dirty = true;
    render();
  }
  function laItemAdd(si, type) {
    var ed = S.la.editor;
    if (!ed.sections[si] || !type) return;
    var it = { key: '', type: type, title: '', body: '', minutes: '', required: true, resource_id: '', resource_title: '', ack_statement: '', quiz: null };
    if (type === 'quiz') it.quiz = { passThreshold: 80, questions: [{ question: '', optionsText: '', correctIndex: 0 }] };
    ed.sections[si].items.push(it);
    ed._dirty = true;
    // A new step starts with its title open — the first thing it needs.
    laEditStart('i-' + si + '-' + (ed.sections[si].items.length - 1) + '-title');
  }
  function laItemRemove(si, ii) {
    var ed = S.la.editor;
    if (!ed.sections[si]) return;
    ed.sections[si].items.splice(ii, 1);
    ed.editing = null;
    ed.settingsOpen = null;
    ed._dirty = true;
    render();
  }
  function laItemMove(si, ii, dir) {
    var ed = S.la.editor;
    var items = ed.sections[si] && ed.sections[si].items;
    if (!items) return;
    var to = ii + dir;
    if (to < 0 || to >= items.length) return;
    var it = items.splice(ii, 1)[0];
    items.splice(to, 0, it);
    // The open settings strip follows the step it belongs to.
    if (ed.settingsOpen === 'i-' + si + '-' + ii) ed.settingsOpen = 'i-' + si + '-' + to;
    else if (ed.settingsOpen === 'i-' + si + '-' + to) ed.settingsOpen = 'i-' + si + '-' + ii;
    ed.editing = null;
    ed._dirty = true;
    render();
  }
  function laQAdd(si, ii) {
    var it = S.la.editor.sections[si].items[ii];
    if (!it.quiz) return;
    it.quiz.questions.push({ question: '', optionsText: '', correctIndex: 0 });
    S.la.editor._dirty = true;
    laEditStart('i-' + si + '-' + ii + '-q' + (it.quiz.questions.length - 1));
  }
  function laQRemove(si, ii, qi) {
    var it = S.la.editor.sections[si].items[ii];
    if (it.quiz) { it.quiz.questions.splice(qi, 1); S.la.editor._dirty = true; render(); }
  }

  // ── Click-to-edit: the learner's rendering until a click, the field after ──
  //
  // `editing` names the ONE region currently open as a field ('i-0-2-body',
  // 's-1', 'desc', a quiz question or option). Everything else on the screen
  // renders exactly as the learner receives it, so what the Owner reads while
  // editing IS what will be shipped. Closing a field is blur (or Enter/Escape
  // on a one-line field); the value is already in state from oninput, so the
  // close only swaps the field back to the learner's rendering of it.

  function laEditing(key) { var ed = S.la.editor; return !!(ed && ed.editing === String(key)); }

  function laEditStart(key) {
    var ed = S.la.editor;
    if (!ed) return;
    ed.editing = String(key);
    render();
    var el = doc.getElementById('la-in-' + ed.editing);
    if (el) {
      try {
        el.focus();
        // A one-line field opens selected (renaming replaces); prose opens
        // with the caret at the end (writing continues).
        if (el.setSelectionRange) {
          if (el.tagName === 'TEXTAREA') el.setSelectionRange(el.value.length, el.value.length);
          else el.setSelectionRange(0, el.value.length);
        }
      } catch (e) { /* focus is a courtesy, not a contract */ }
    }
  }

  /** Deferred, so a click that OPENS another region wins over this blur —
   *  otherwise the blur's re-render swallows the click and every move between
   *  two fields takes two clicks. */
  function laEditStop(key) {
    setTimeout(function () {
      var ed = S.la.editor;
      if (!ed || ed.editing !== String(key)) return;
      // The user came straight back to the same field: a blur-and-refocus
      // inside the window must not close it under their caret.
      var el = doc.getElementById('la-in-' + String(key));
      if (el && doc.activeElement === el) return;
      ed.editing = null;
      // The close re-renders the screen; whatever ELSE the user has since
      // focused (a settings field, say) is rebuilt by that render, so put
      // their focus back where it was rather than dropping their keystrokes.
      var focusId = doc.activeElement && doc.activeElement.id;
      render();
      if (focusId) {
        var back = doc.getElementById(focusId);
        if (back) { try { back.focus(); } catch (e) { /* gone */ } }
      }
    }, 200);
  }

  /** One settings strip open at a time: 's-<si>' or 'i-<si>-<ii>'. */
  function laSettings(key) {
    var ed = S.la.editor;
    if (!ed) return;
    ed.settingsOpen = ed.settingsOpen === String(key) ? null : String(key);
    render();
  }

  /** Checkbox edits re-render immediately — there is no caret to fight, and
   *  the learner-facing chips beside them must stay honest. */
  function laItemFlag(si, ii, field, value) { laItemField(si, ii, field, value); render(); }

  // Quiz options live as one newline-joined string (optionsText) — the shape
  // laEditorContentForApi already ships. Inline editing addresses one line.
  function laQOption(si, ii, qi, oi, value) {
    var ed = S.la.editor;
    var it = ed && ed.sections[si] && ed.sections[si].items[ii];
    if (!it || !it.quiz || !it.quiz.questions[qi]) return;
    var q = it.quiz.questions[qi];
    var lines = String(q.optionsText || '').split('\n');
    lines[oi] = value;
    q.optionsText = lines.join('\n');
    ed._dirty = true;
  }

  /** Closing an option's field drops emptied lines — clearing an option IS
   *  removing it, the way deleting a paragraph removes it from a document.
   *  The tick follows its answer down; clearing the TICKED option itself
   *  resets the tick to the first option rather than letting it slide onto a
   *  neighbour. Dropping lines renumbers every option, so that close renders
   *  NOW: the usual deferred close would leave the on-screen radios carrying
   *  stale indexes for a beat, and a tick landed in that window would mark
   *  the wrong answer. */
  function laQOptionDone(si, ii, qi, key) {
    var ed = S.la.editor;
    var it = ed && ed.sections[si] && ed.sections[si].items[ii];
    var dropped = false;
    if (it && it.quiz && it.quiz.questions[qi]) {
      var q = it.quiz.questions[qi];
      var lines = String(q.optionsText || '').split('\n');
      var ci0 = Number(q.correctIndex) || 0;
      var ci = ci0;
      var ciDropped = false;
      var kept = [];
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].trim()) kept.push(lines[i]);
        else if (i === ci0) ciDropped = true;
        else if (i < ci0) ci -= 1;
      }
      if (ciDropped || ci >= kept.length) ci = 0;
      dropped = kept.length !== lines.length;
      if (dropped) {
        q.optionsText = kept.join('\n');
        q.correctIndex = ci;
        ed._dirty = true;
      }
    }
    if (dropped && ed && ed.editing === String(key)) {
      ed.editing = null;
      render();
      return;
    }
    laEditStop(key);
  }

  function laQOptionAdd(si, ii, qi) {
    var ed = S.la.editor;
    var it = ed && ed.sections[si] && ed.sections[si].items[ii];
    if (!it || !it.quiz || !it.quiz.questions[qi]) return;
    var q = it.quiz.questions[qi];
    var lines = String(q.optionsText || '').split('\n').filter(function (l) { return l.trim(); });
    lines.push('');
    q.optionsText = lines.join('\n');
    ed._dirty = true;
    laEditStart('i-' + si + '-' + ii + '-q' + qi + '-o' + (lines.length - 1));
  }

  /** The ticked radio IS the correct answer — configured by answering the
   *  question, the way the learner will. */
  function laQCorrect(si, ii, qi, oi) {
    laQField(si, ii, qi, 'correctIndex', Number(oi));
    render();
  }

  /**
   * A click-to-edit region. Until it is clicked it shows `viewHtml` — the
   * learner's own rendering of the value; clicked, it swaps to `inputHtml`,
   * which must carry id="la-in-<key>" and close itself through laEditStop.
   * The region is keyboard-reachable: Enter or Space opens it.
   */
  function laEditable(key, viewHtml, inputHtml, label) {
    if (laEditing(key)) return inputHtml;
    // A link inside the rendered prose stays a link: clicking it to check it
    // must not also dump the region into its editor.
    return '<div class="rh2-ind-editable" role="button" tabindex="0" title="Click to edit" ' +
      'aria-label="' + esc(label || 'Edit') + '" ' +
      'onclick="if(event.target&&event.target.closest&&event.target.closest(\'a\'))return;RH2.laEditStart(\'' + key + '\')" ' +
      'onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();RH2.laEditStart(\'' + key + '\')}">' +
      viewHtml + '</div>';
  }

  /** The attributes every inline field shares: its identity, commit-on-blur,
   *  and — one-line fields — Enter/Escape closing it. */
  function laInAttrs(key, oneLine) {
    return 'id="la-in-' + key + '" onblur="RH2.laEditStop(\'' + key + '\')"' +
      (oneLine
        ? ' onkeydown="if(event.key===\'Enter\'||event.key===\'Escape\'){event.preventDefault();this.blur();}"'
        : ' onkeydown="if(event.key===\'Escape\'){this.blur();}"');
  }

  // Resource picker: inline search against the hub catalogue.
  function laResPickOpen(si, ii) {
    S.la.resPick = { si: si, ii: ii, q: '', rows: null, loading: false };
    render();
  }
  function laResPickClose() { S.la.resPick = null; render(); }
  async function laResSearch(q) {
    var rp = S.la.resPick;
    if (!rp) return;
    rp.q = q;
    if (!q || q.trim().length < 2) { rp.rows = null; return render(); }
    rp.loading = true;
    var d = await api('/api/rh2/resources?q=' + encodeURIComponent(q.trim()));
    if (!S.la.resPick || S.la.resPick.q !== q) return; // stale response
    rp.loading = false;
    rp.rows = d.ok ? (pick(d, 'resources') || pick(d, 'rows') || []) : [];
    render();
  }
  /** Choose by ROW INDEX, not by inlined values: a title containing a
   *  backslash or quote must reach the state verbatim, and inlining it into
   *  an onclick string literal cannot guarantee that. */
  function laResChoose(idx) {
    var rp = S.la.resPick;
    var row = rp && rp.rows && rp.rows[idx];
    if (!row) return;
    laItemField(rp.si, rp.ii, 'resource_id', String(pick(row, 'id') || ''));
    laItemField(rp.si, rp.ii, 'resource_title', String(pick(row, 'title') || ''));
    S.la.resPick = null;
    render();
  }

  /**
   * One learning item, editable in place.
   *
   * This is the LEARNER'S OWN RENDERING of the step — the rendered prose, the
   * acknowledgement blockquote, the knowledge-check options, the resource
   * button — where every piece of content opens as a field when clicked
   * (laEditable). Configuration — required, minutes, ordering, removal, the
   * linked resource, the pass mark — sits behind the step's Settings toggle so
   * the screen reads as the tutorial, never as the form that produces it. The
   * learner's action buttons appear where the learner will see them, inert:
   * this surface edits content, it does not complete it.
   */
  function laEditorItemHtml(it, si, ii, count) {
    var k = 'i-' + si + '-' + ii;
    var setOpen = S.la.editor.settingsOpen === k;
    var typeChip = it.type !== 'content'
      ? ' <span class="rh2-chip rh2-chip-quiet">' + esc(LA_ITEM_TYPE_LABELS[it.type] || it.type) + '</span>' : '';
    var reqChip = !it.required ? ' <span class="rh2-chip rh2-chip-quiet">Optional</span>' : '';
    var mins = parseInt(it.minutes, 10) > 0
      ? '<span class="rh2-row-sub">' + parseInt(it.minutes, 10) + ' min</span>' : '';

    var out = '<div class="rh2-learn-ed-item">' +
      '<div class="rh2-ind-item-head">' +
        laEditable(k + '-title',
          '<span class="rh2-row-main"><span class="rh2-row-title">' +
            (it.title ? esc(it.title) : '<span class="rh2-ind-ed-empty">Untitled step &mdash; click to name it</span>') +
            typeChip + reqChip + '</span>' + mins + '</span>',
          '<input class="rh2-input rh2-learn-ed-title" ' + laInAttrs(k + '-title', true) +
            ' placeholder="Step title" value="' + esc(it.title) + '" ' +
            'oninput="RH2.laItemField(' + si + ',' + ii + ',\'title\',this.value)">',
          'Edit the title of step ' + (ii + 1)) +
        '<button type="button" class="rh2-btn rh2-btn-quiet rh2-learn-ed-setbtn" ' +
          'aria-expanded="' + (setOpen ? 'true' : 'false') + '" ' +
          'onclick="RH2.laSettings(\'' + k + '\')">Settings</button>' +
      '</div>' +
      // The learner's own screen shows a launch tile for a task that carries a
      // walkthrough; the editor showed text boxes and nothing else, so the
      // pop-ups were invisible in the one place they are meant to be edited.
      // Same tile, same position — it opens the walkthrough EDITOR instead.
      laItemWalkHtml(it);

    // The secondary settings strip — configuration, off the primary surface.
    if (setOpen) {
      out += '<div class="rh2-learn-ed-set">' +
        '<label class="rh2-learn-inline-check"><input type="checkbox" ' + (it.required ? 'checked ' : '') +
          'onchange="RH2.laItemFlag(' + si + ',' + ii + ',\'required\',this.checked)"> Required</label>' +
        '<label class="rh2-lbl">Minutes <input type="number" min="1" max="600" class="rh2-input rh2-learn-ed-mins" id="la-set-' + k + '-mins" value="' + esc(it.minutes) + '" ' +
          'oninput="RH2.laItemField(' + si + ',' + ii + ',\'minutes\',this.value)"></label>' +
        (it.type === 'quiz' && it.quiz
          ? '<label class="rh2-lbl">Pass mark % <input type="number" min="0" max="100" class="rh2-input rh2-learn-ed-mins" id="la-set-' + k + '-thr" value="' + esc(it.quiz.passThreshold) + '" ' +
              'oninput="RH2.laQuizField(' + si + ',' + ii + ',\'passThreshold\',this.value)"></label>'
          : '') +
        // A task step can BE an interactive walkthrough. Editing that
        // walkthrough belongs here, next to the step that uses it — sending
        // the Owner off to a separate console to change a pop-up in the
        // induction they already have open is the long way round.
        (it.type === 'task' ? laItemWalkthroughHtml(it, si, ii) : '') +
        '<span class="rh2-learn-ed-tools">' +
          '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (ii === 0 ? 'disabled ' : '') + 'aria-label="Move step up" onclick="RH2.laItemMove(' + si + ',' + ii + ',-1)">&uarr;</button>' +
          '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (ii === count - 1 ? 'disabled ' : '') + 'aria-label="Move step down" onclick="RH2.laItemMove(' + si + ',' + ii + ',1)">&darr;</button>' +
          '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laItemRemove(' + si + ',' + ii + ')">Remove step</button>' +
        '</span>';
      if (it.type === 'resource') {
        var rp = S.la.resPick;
        out += '<div class="rh2-learn-ed-row">' +
          (it.resource_id
            ? '<span class="rh2-chip rh2-chip-ok">Linked: ' + esc(it.resource_title || it.resource_id) + '</span>'
            : '<span class="rh2-chip rh2-chip-warn">No resource linked yet</span>') +
          '<button type="button" class="rh2-btn" onclick="RH2.laResPickOpen(' + si + ',' + ii + ')">' +
            (it.resource_id ? 'Change resource' : 'Choose resource') + '</button></div>';
        if (rp && rp.si === si && rp.ii === ii) {
          out += '<div class="rh2-learn-ed-respick">' +
            '<input class="rh2-input" id="la-respick-q" placeholder="Search the Resource Hub…" value="' + esc(rp.q) + '" ' +
              'oninput="RH2.laResSearch(this.value)">' +
            '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laResPickClose()">Close</button>';
          if (rp.loading) out += skel(2, 34);
          else if (rp.rows && !rp.rows.length) out += '<div class="rh2-empty">No matching resources.</div>';
          else if (rp.rows) {
            out += rp.rows.slice(0, 8).map(function (r, ri) {
              return '<button type="button" class="rh2-row rh2-learn-ed-resrow" onclick="RH2.laResChoose(' + ri + ')">' +
                '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(pick(r, 'title')) + '</span>' +
                '<span class="rh2-row-sub">' + esc(pick(r, 'content_type') || pick(r, 'resource_type') || '') + '</span></span></button>';
            }).join('');
          }
          out += '</div>';
        }
      }
      out += '</div>';
    }

    out += '<div class="rh2-learn-item-body">';

    // The prose the learner reads — click it to write it.
    out += laEditable(k + '-body',
      it.body
        ? '<div class="rh2-learn-prose">' + mdRender(it.body) + '</div>'
        : '<p class="rh2-ind-ed-empty">No content yet &mdash; click to write it.</p>',
      '<textarea class="rh2-input rh2-learn-ed-body" rows="6" ' + laInAttrs(k + '-body', false) +
        ' placeholder="Instructions / content (markdown: ## headings, **bold**, - bullets, links)" ' +
        'oninput="RH2.laItemField(' + si + ',' + ii + ',\'body\',this.value)">' + esc(it.body) + '</textarea>',
      'Edit the content of step ' + (ii + 1));

    if (it.type === 'resource') {
      // The learner's resource item is ONE launch tile — mirror it inert.
      // Opening is the learner's click, and opening records the step; there
      // is no separate button to depict.
      out += '<div class="rh2-learn-actions">' +
        '<span class="rh2-ind-launch-hint">Opens' +
          (it.resource_title ? ': ' + esc(it.resource_title) : ' the linked resource') +
          ' &rarr;</span>' +
        (it.resource_id ? '' : '<span class="rh2-quiet">Link the resource in Settings.</span>') +
      '</div>';
    }

    if (it.type === 'acknowledgement') {
      out += laEditable(k + '-ack',
        '<blockquote class="rh2-learn-ack">' +
          (it.ack_statement
            ? mdRender(it.ack_statement)
            : '<span class="rh2-ind-ed-empty">No statement yet &mdash; click to write what the employee must acknowledge.</span>') +
        '</blockquote>',
        '<textarea class="rh2-input" rows="2" ' + laInAttrs(k + '-ack', false) +
          ' placeholder="The statement the employee must acknowledge" ' +
          'oninput="RH2.laItemField(' + si + ',' + ii + ',\'ack_statement\',this.value)">' + esc(it.ack_statement) + '</textarea>',
        'Edit the acknowledgement statement') +
        '<div class="rh2-learn-actions"><button type="button" class="rh2-btn rh2-btn-primary" disabled>I acknowledge</button></div>';
    }

    if (it.type === 'quiz' && it.quiz) {
      out += it.quiz.questions.map(function (q, qi) {
        var qk = k + '-q' + qi;
        var lines = q.optionsText ? String(q.optionsText).split('\n') : [];
        // A question's FIRST option: '' cannot hold "one empty line" (the
        // join of [''] is ''), so while that option's field is open the line
        // is synthesised here — the text typed lands in state via laQOption.
        if (laEditing(qk + '-o' + lines.length)) lines.push('');
        var ci = Number(q.correctIndex) || 0;
        return '<fieldset class="rh2-learn-q">' +
          '<legend>' + laEditable(qk,
            (qi + 1) + '. ' + (q.question ? esc(q.question) : '<span class="rh2-ind-ed-empty">Click to write question ' + (qi + 1) + '</span>'),
            '<input class="rh2-input rh2-learn-ed-title" ' + laInAttrs(qk, true) +
              ' placeholder="Question ' + (qi + 1) + '" value="' + esc(q.question) + '" ' +
              'oninput="RH2.laQField(' + si + ',' + ii + ',' + qi + ',\'question\',this.value)">',
            'Edit question ' + (qi + 1)) + '</legend>' +
          lines.map(function (opt, oi) {
            var ok = qk + '-o' + oi;
            return '<div class="rh2-learn-opt">' +
              '<input type="radio" name="la-ed-q-' + si + '-' + ii + '-' + qi + '" ' + (ci === oi ? 'checked ' : '') +
                'aria-label="Mark option ' + (oi + 1) + ' as the correct answer" ' +
                'onchange="RH2.laQCorrect(' + si + ',' + ii + ',' + qi + ',' + oi + ')">' +
              laEditable(ok,
                opt.trim() ? '<span>' + esc(opt) + '</span>' : '<span class="rh2-ind-ed-empty">Empty option</span>',
                '<input class="rh2-input" id="la-in-' + ok + '" value="' + esc(opt) + '" ' +
                  'placeholder="Answer option &mdash; leave empty to remove" ' +
                  'onblur="RH2.laQOptionDone(' + si + ',' + ii + ',' + qi + ',\'' + ok + '\')" ' +
                  'onkeydown="if(event.key===\'Enter\'||event.key===\'Escape\'){event.preventDefault();this.blur();}" ' +
                  'oninput="RH2.laQOption(' + si + ',' + ii + ',' + qi + ',' + oi + ',this.value)">',
                'Edit answer option ' + (oi + 1)) +
            '</div>';
          }).join('') +
          '<div class="rh2-learn-ed-qtools">' +
            '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laQOptionAdd(' + si + ',' + ii + ',' + qi + ')">+ Add option</button>' +
            (setOpen
              ? '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laQRemove(' + si + ',' + ii + ',' + qi + ')">Remove question</button>'
              : '') +
          '</div>' +
        '</fieldset>';
      }).join('') +
      '<p class="rh2-quiet rh2-learn-ed-hint">The ticked option is the correct answer &mdash; learners see the options unticked.</p>' +
      '<div class="rh2-learn-actions">' +
        '<button type="button" class="rh2-btn" onclick="RH2.laQAdd(' + si + ',' + ii + ')">+ Add question</button>' +
        '<button type="button" class="rh2-btn rh2-btn-primary" disabled>Submit answers</button>' +
      '</div>';
    }

    if (it.type === 'content' || it.type === 'task') {
      // The learner has no button here: reading past the section records the
      // step. Say so rather than depicting a control that no longer exists.
      out += '<p class="rh2-quiet rh2-learn-ed-hint">The learner has nothing to press here &mdash; reading past the section records this step.</p>';
    }

    out += '</div>';
    return out + '</div>';
  }

  /** Step 0, edit mode. The title lives in the shared header, where the
   *  learner's title is; what is left is what the overview screen shows. */
  function indOverviewEdit(ed) {
    var cats = S.la.categories ||
      ['induction', 'clinical', 'compliance', 'safety', 'administration', 'rural_remote', 'professional_development', 'policy_update', 'other'];
    return '<div class="rh2-ind-steplbl">Overview</div>' +
      '<h2 class="rh2-ind-sectitle">What this covers</h2>' +
      laEditable('desc',
        ed.description
          ? '<div class="rh2-learn-prose">' + mdRender(ed.description) + '</div>'
          : '<p class="rh2-ind-ed-empty">No description yet &mdash; click to write the sentence the learner reads first.</p>',
        '<textarea class="rh2-input rh2-ind-desc-in" rows="3" ' + laInAttrs('desc', false) +
          ' placeholder="Describe this learning in a sentence — the learner reads it first" ' +
          'aria-label="Description" oninput="RH2.laMeta(\'description\',this.value)">' + esc(ed.description) + '</textarea>',
        'Edit the description') +
      '<div class="rh2-learn-ed-row">' +
        '<label class="rh2-lbl" for="la-ed-cat">Category</label>' +
        '<select class="rh2-select" id="la-ed-cat" onchange="RH2.laMeta(\'category\',this.value)">' +
          cats.map(function (c) {
            return '<option value="' + esc(c) + '"' + (ed.category === c ? ' selected' : '') + '>' + esc(laCatLabel(c)) + '</option>';
          }).join('') +
        '</select>' +
      '</div>' +
      '<ol class="rh2-ind-toc">' + ed.sections.map(function (s, i) {
        var n = (s.items || []).length;
        return indTocRow(s.title || ('Section ' + (i + 1)), n + ' step' + (n === 1 ? '' : 's'), i + 1, i + 1);
      }).join('') + '</ol>' +
      '<div class="rh2-learn-actions">' +
        (ed.sections.length
          ? '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.indGo(1)">Edit section 1 &rarr;</button>'
          : '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.laSecAdd()">+ Add the first section</button>') +
      '</div>';
  }

  /** One section, one screen — the learner's screen; the title opens on a
   *  click, and the section's ordering/removal sits behind its own Settings
   *  toggle rather than dominating the head of every screen. */
  function indSectionEdit(s, si, secCount) {
    var items = s.items || [];
    var sk = 's-' + si;
    var setOpen = S.la.editor.settingsOpen === sk;
    return '<div class="rh2-ind-steplbl">Section ' + (si + 1) + ' of ' + secCount + '</div>' +
      '<div class="rh2-ind-sechead">' +
        laEditable(sk,
          '<h2 class="rh2-ind-sectitle">' +
            (s.title ? esc(s.title) : '<span class="rh2-ind-ed-empty">Untitled section &mdash; click to name it</span>') +
          '</h2>',
          '<input class="rh2-input rh2-ind-sectitle-in" ' + laInAttrs(sk, true) + ' value="' + esc(s.title) + '" ' +
            'placeholder="Section title" aria-label="Section ' + (si + 1) + ' title" ' +
            'oninput="RH2.laSecField(' + si + ',this.value)">',
          'Edit the title of section ' + (si + 1)) +
        '<button type="button" class="rh2-btn rh2-btn-quiet rh2-learn-ed-setbtn" ' +
          'aria-expanded="' + (setOpen ? 'true' : 'false') + '" ' +
          'onclick="RH2.laSettings(\'' + sk + '\')">Section settings</button>' +
      '</div>' +
      (setOpen
        ? '<div class="rh2-learn-ed-set"><span class="rh2-learn-ed-tools">' +
            '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (si === 0 ? 'disabled ' : '') + 'aria-label="Move section up" onclick="RH2.laSecMove(' + si + ',-1)">&uarr;</button>' +
            '<button type="button" class="rh2-btn rh2-btn-quiet" ' + (si === secCount - 1 ? 'disabled ' : '') + 'aria-label="Move section down" onclick="RH2.laSecMove(' + si + ',1)">&darr;</button>' +
            '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laSecRemove(' + si + ')">Remove section</button>' +
          '</span></div>'
        : '') +
      '<ol class="rh2-ind-items">' + items.map(function (it, ii) {
        return '<li class="rh2-ind-item rh2-ind-item-edit">' +
          '<span class="rh2-ind-item-no">' + (ii + 1) + '</span>' +
          laEditorItemHtml(it, si, ii, items.length) + '</li>';
      }).join('') + '</ol>' +
      (items.length ? '' : '<p class="rh2-quiet">There is nothing in this section yet — add the first step below.</p>') +
      '<div class="rh2-learn-ed-additem">' +
        '<label class="rh2-visually-hidden" for="la-ed-addtype-' + si + '">New step type</label>' +
        '<select class="rh2-select" id="la-ed-addtype-' + si + '">' +
          '<option value="content">Reading / content</option>' +
          '<option value="resource">Hub resource</option>' +
          '<option value="acknowledgement">Acknowledgement</option>' +
          '<option value="quiz">Knowledge check</option>' +
          '<option value="task">Task</option>' +
        '</select>' +
        '<button type="button" class="rh2-btn" onclick="RH2.laItemAdd(' + si + ',document.getElementById(\'la-ed-addtype-' + si + '\').value)">+ Add step</button>' +
      '</div>';
  }

  /** The closing screen in edit mode: the shape of the whole thing, plus the
   *  publish history the Owner needs to read draft state honestly. */
  function indFinishEdit(ed) {
    var out = '<div class="rh2-ind-steplbl">Finish</div>' +
      '<h2 class="rh2-ind-sectitle">Sections</h2>' +
      '<ol class="rh2-ind-toc">' + ed.sections.map(function (s, i) {
        var n = (s.items || []).length;
        return indTocRow(s.title || ('Section ' + (i + 1)), n + ' step' + (n === 1 ? '' : 's'), i + 1, i + 1);
      }).join('') + '</ol>' +
      '<div class="rh2-learn-actions">' +
        '<button type="button" class="rh2-btn" onclick="RH2.laSecAdd()">+ Add section</button>' +
        '<button type="button" class="rh2-btn rh2-btn-primary" ' + (S.la.editorSaving ? 'disabled ' : '') +
          'onclick="RH2.laSave()">' + (S.la.editorSaving ? 'Saving…' : 'Save changes') + '</button>' +
      '</div>';
    if (ed.versions && ed.versions.length) {
      out += '<h2 class="rh2-ind-sectitle">Published versions</h2>' +
        ed.versions.map(function (v) {
          return '<div class="rh2-row-sub">v' + esc(v.version) + ' — ' + esc(v.title) + ' · published ' + esc(fmtDate(v.published_at)) +
            (v.published_by_name ? ' by ' + esc(v.published_by_name) : '') + ' · ' + esc(v.assignment_count) + ' assignment(s)</div>';
        }).join('') +
        '<p class="rh2-quiet">A new version is published automatically when you assign after making changes.</p>';
    }
    return out;
  }

  /**
   * EDIT MODE — the learner's induction, with the fields exposed.
   *
   * Deliberately the same shell, the same step rail and the same Back / Next
   * as renderAssignment: opening Edit puts the Owner INSIDE the induction with
   * editing already on. There is no second "enable editing" control, and no
   * separate administration form that could drift from what is delivered.
   */
  function renderLaEditor() {
    var ed = S.la.editor;
    var sections = ed.sections || [];
    var step = indStep('edit', sections);
    // What learners receive right now, stated plainly next to Save/Publish so
    // the Owner can always tell draft state from published state.
    var pubLine = ed._currentVersion
      ? 'Learners receive v' + ed._currentVersion + (ed._hasUnpublished ? ' · unpublished draft changes' : ' · up to date')
      : 'Never published — assigning (or Publish) creates version 1';
    var out = '<div class="rh2-learn-ed rh2-ind rh2-ind-edit">' +
      '<div class="rh2-learn-ed-bar">' +
        '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laEditorClose()">&larr; Learning</button>' +
        '<span class="rh2-chip rh2-chip-warn">Editing &mdash; this is the learner&rsquo;s own screen</span>' +
        '<span class="rh2-quiet">' +
          esc(pubLine) + ' · ' +
          (ed.counts.total ? ed.counts.total + ' assignment(s) pinned to published versions — saving edits never changes them' : 'nothing assigned yet') +
        '</span>' +
        '<span class="rh2-learn-ed-bar-actions">' +
          '<button type="button" class="rh2-btn" onclick="RH2.laPreview(\'' + esc(ed.id) + '\')">Preview</button>' +
          '<button type="button" class="rh2-btn" ' + ((S.la.editorSaving || S.la.publishBusy) ? 'disabled ' : '') +
            'onclick="RH2.laPublish(\'' + esc(ed.id) + '\')">' +
            (S.la.publishBusy ? 'Publishing…' : 'Publish version') + '</button>' +
          '<button type="button" class="rh2-btn rh2-btn-primary" ' + (S.la.editorSaving ? 'disabled ' : '') + 'onclick="RH2.laSave()">' +
            (S.la.editorSaving ? 'Saving…' : 'Save') + '</button>' +
        '</span>' +
      '</div>' +
      (S.la.publishNote ? '<div class="rh2-learn-done-banner" role="status">' + esc(S.la.publishNote) + '</div>' : '') +
      (S.la.editorErr
        ? '<div class="rh2-empty" role="alert">' + esc(S.la.editorErr) +
          (S.la.editorStale
            ? ' <button type="button" class="rh2-btn" onclick="RH2.laEditorReload()">Reload latest version</button>'
            : '') + '</div>'
        : '') +
      indHeader('edit', {
        title: ed.title,
        sub: esc(laCatLabel(ed.category)) + ' &middot; ' + sections.length + ' section' +
          (sections.length === 1 ? '' : 's'),
      }, sections, step) +
      '<section class="rh2-card rh2-ind-stage">';

    if (step === 0) out += indOverviewEdit(ed);
    else if (step > sections.length) out += indFinishEdit(ed);
    else out += indSectionEdit(sections[step - 1], step - 1, sections.length);

    out += '</section>';
    return out + indNav('edit', step, sections.length) + '</div>';
  }

  // ── Owner: assign panel ─────────────────────────────────────────────────────

  /**
   * THE ASSIGNMENT DIALOG.
   *
   * A real dialog rather than an inline panel: choosing several people out of
   * a list is a task that wants the rest of the page to stop competing for
   * attention, and it is the one place in this module where focus has to be
   * managed deliberately. `aria-modal` plus the Tab trap in the keydown
   * handler below keep a keyboard user inside it; closing puts focus back on
   * the Assign button that opened it.
   *
   * Selection lives in a map keyed by user id, NOT in the rendered checkboxes,
   * which is what lets somebody search for "Sam", tick Sam, clear the search,
   * filter to therapists, and still have Sam selected. Every render reads the
   * map; nothing reads the DOM.
   */
  function laAssignOpen(wfId, userId) {
    var wf = (S.la.workflows || []).find(function (w) { return w.id === wfId; }) || null;
    var selected = {};
    if (userId) selected[userId] = true;
    S.la.assign = {
      wfId: wf ? wf.id : '', wfTitle: wf ? wf.title : '',
      // The dialog works on a LIST of learning items; opening from one card is
      // simply a list of one. stage: 'pick' → 'review' → done.
      wfIds: wf ? [wf.id] : [],
      stage: 'pick', reassign: {}, pairs: null,
      q: '', roleFilter: '', selected: selected, dueAt: '', note: '',
      mandatory: true, priority: 'normal', busy: false, err: '', done: null,
      openerId: wf ? ('asl-assign-' + wf.id) : '',
    };
    render();
    // Land on the search box: it is what the Owner reaches for first, and it
    // is inside the trap so Tab immediately moves through the list.
    var q = doc.getElementById('la-as-q');
    if (q) { try { q.focus(); } catch (e) { /* not yet painted */ } }
  }

  /** Open the dialog for the library's checkbox selection (1..n items). */
  function laAssignOpenMulti() {
    var chosen = aslSelectedWorkflows();
    // Every selected item became unassignable while the selection sat there.
    // Say so rather than presenting a button that appears to do nothing.
    if (!chosen.length) {
      S.asl.sel = {};
      S.la.err = 'Those learning items can no longer be assigned — they may have been archived or emptied. The selection has been cleared.';
      render();
      return;
    }
    S.la.assign = {
      wfId: chosen.length === 1 ? chosen[0].id : '',
      wfTitle: chosen.length === 1 ? chosen[0].title : '',
      wfIds: chosen.map(function (w) { return w.id; }),
      stage: 'pick', reassign: {}, pairs: null,
      q: '', roleFilter: '', selected: {}, dueAt: '', note: '',
      mandatory: true, priority: 'normal', busy: false, err: '', done: null,
      openerId: 'asl-bulk-assign',
    };
    render();
    var q = doc.getElementById('la-as-q');
    if (q) { try { q.focus(); } catch (e) { /* not yet painted */ } }
  }

  /** Titles of the learning items currently in the dialog, in library order. */
  function laAssignWfList() {
    var a = S.la.assign;
    var byId = {};
    (S.la.workflows || []).forEach(function (w) { byId[w.id] = w; });
    return (a.wfIds || []).map(function (id) { return byId[id]; }).filter(Boolean);
  }

  function laAssignClose() {
    var a = S.la.assign;
    var openerId = a && a.openerId;
    S.la.assign = null;
    render();
    if (openerId) {
      var opener = doc.getElementById(openerId);
      if (opener) { try { opener.focus(); } catch (e) { /* the card may have gone */ } }
    }
  }

  function laAssignQ(v) { S.la.assign.q = v; render(); }
  function laAssignRole(v) { S.la.assign.roleFilter = v; render(); }

  function laAssignToggle(userId) {
    var a = S.la.assign;
    if (a.selected[userId]) delete a.selected[userId];
    else a.selected[userId] = true;
    render();
  }

  function laAssignField(f, v) { S.la.assign[f] = v; }

  function laAssignWf(wfId) {
    var a = S.la.assign;
    a.wfId = wfId;
    a.wfIds = wfId ? [wfId] : [];
    var wf = (S.la.workflows || []).find(function (w) { return w.id === wfId; });
    a.wfTitle = wf ? wf.title : '';
    render();
  }

  /** Everybody who currently passes the search box and the role filter. */
  function laAssignVisible() {
    var a = S.la.assign;
    var staff = S.la.staff || [];
    var q = String(a.q || '').trim().toLowerCase();
    return staff.filter(function (u) {
      if (a.roleFilter && u.role !== a.roleFilter) return false;
      if (!q) return true;
      return String(u.name || '').toLowerCase().indexOf(q) !== -1 ||
             String(u.email || '').toLowerCase().indexOf(q) !== -1;
    });
  }

  /**
   * Does this person already have EVERY selected item active? With one item
   * that is the old behaviour; with several, someone who has only some of
   * them stays selectable — the review step resolves the rest per pair.
   */
  function laAssignHas(u) {
    var a = S.la.assign;
    if (!a || !(a.wfIds || []).length) return false;
    return a.wfIds.every(function (id) {
      return (u.active_workflow_ids || []).indexOf(id) !== -1;
    });
  }

  /** One (workflow, user) pair's current state, from the staff rollups. */
  function laPairState(u, wfId) {
    if ((u.active_workflow_ids || []).indexOf(wfId) !== -1) return 'active';
    if ((u.completed_workflow_ids || []).indexOf(wfId) !== -1) return 'completed';
    return 'new';
  }

  /**
   * Select every visible person who could actually receive this.
   *
   * Deliberately skips anybody who already has it: ticking somebody the server
   * would refuse just to report it back as "skipped" is a worse experience
   * than not offering the tick.
   */
  function laAssignSelectAllVisible() {
    var a = S.la.assign;
    var eligible = laAssignVisible().filter(function (u) { return !laAssignHas(u); });
    var allOn = eligible.length > 0 && eligible.every(function (u) { return a.selected[u.id]; });
    eligible.forEach(function (u) {
      if (allOn) delete a.selected[u.id];
      else a.selected[u.id] = true;
    });
    render();
  }

  /**
   * From the picker to the review step: every (learning, person) pair is
   * classified before anything is written, so the Owner sees exactly what
   * will be created, what is skipped as an active duplicate, and which
   * completed pairs need a deliberate Reassign tick.
   */
  function laAssignReview() {
    var a = S.la.assign;
    if (!a || a.busy) return;
    var userIds = Object.keys(a.selected);
    if (!(a.wfIds || []).length) { a.err = 'Choose at least one learning item.'; return render(); }
    if (!userIds.length) { a.err = 'Select at least one person.'; return render(); }
    var byId = {};
    (S.la.staff || []).forEach(function (u) { byId[u.id] = u; });
    var pairs = [];
    a.wfIds.forEach(function (wfId) {
      userIds.forEach(function (userId) {
        var u = byId[userId];
        if (!u) return;
        pairs.push({ workflowId: wfId, userId: userId, state: laPairState(u, wfId) });
      });
    });
    a.pairs = pairs;
    a.err = '';
    a.stage = 'review';
    render();
    var heading = doc.getElementById('la-as-review-h');
    if (heading) { try { heading.focus(); } catch (e) { /* not yet painted */ } }
  }

  function laAssignBack() {
    var a = S.la.assign;
    if (!a || a.busy) return;
    a.stage = 'pick';
    a.err = '';
    render();
  }

  function laAssignReassign(pairKey) {
    var a = S.la.assign;
    if (!a) return;
    a.reassign[pairKey] = !a.reassign[pairKey];
    render();
  }

  /** The pairs the review step will actually send. */
  function laAssignPayloadPairs() {
    var a = S.la.assign;
    return (a.pairs || []).filter(function (p) {
      if (p.state === 'new') return true;
      if (p.state === 'completed') return !!a.reassign[p.workflowId + ':' + p.userId];
      return false; // active duplicates are never sent
    }).map(function (p) {
      return { workflowId: p.workflowId, userId: p.userId, reassign: p.state === 'completed' };
    });
  }

  async function laAssignSubmit() {
    var a = S.la.assign;
    if (!a || a.busy || a.stage !== 'review') return;
    var payload = laAssignPayloadPairs();
    if (!payload.length) {
      a.err = 'Nothing to assign — everyone selected already has the selected learning.';
      return render();
    }
    a.busy = true;
    a.err = '';
    render();
    var d = await api('/api/learning/assign', {
      method: 'POST',
      body: {
        pairs: payload,
        dueAt: a.dueAt || null,
        note: a.note || null,
        mandatory: a.mandatory,
        priority: a.priority,
      },
    });
    a.busy = false;
    // The selection survives a failure on purpose: the Owner picked those
    // people, and making them pick again is the cost of our error.
    if (!d.ok) { a.err = d.error || 'Assigning failed. Nothing was saved — try again.'; return render(); }
    a.done = d;
    if (S.asl) S.asl.sel = {};
    render();
    // Refresh the library and the staff list so counts, and who already has
    // what, are right the moment the dialog closes.
    loadLa();
  }

  function renderLaAssign() {
    var a = S.la.assign;
    if (!a) return '';
    var staff = S.la.staff;
    var visible = staff ? laAssignVisible() : [];
    var selCount = Object.keys(a.selected).length;

    var out = '<div class="rh2-dialog-backdrop" onclick="RH2.laAssignBackdrop(event)">' +
      '<section class="rh2-dialog rh2-learn-assign" role="dialog" aria-modal="true"' +
      ' aria-labelledby="la-as-title" id="la-as-dialog">' +
      '<div class="rh2-dialog-head">' +
      '<h2 class="rh2-h2" id="la-as-title">Assign learning</h2>' +
      '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laAssignClose()"' +
      ' aria-label="Close the assignment dialog">Close</button></div>' +
      '<div class="rh2-dialog-body">';

    var wfTitleById = {};
    (S.la.workflows || []).forEach(function (w) { wfTitleById[w.id] = w.title; });
    var multi = (a.wfIds || []).length > 1;

    // ── Success ────────────────────────────────────────────────────────────
    if (a.done) {
      var okCount = (a.done.assigned || []).length;
      var skipped = a.done.skipped || [];
      out += '<div class="rh2-learn-done-banner" role="status">' +
        (okCount
          ? (multi
            ? '✓ ' + okCount + ' assignment' + (okCount === 1 ? '' : 's') + ' created across ' +
              a.wfIds.length + ' learning items.'
            : '✓ ' + esc(a.wfTitle || 'This learning') + ' assigned to ' + okCount +
              ' ' + (okCount === 1 ? 'person' : 'people') + '.')
          : 'Nothing new was assigned.') +
        '</div>';
      if (skipped.length) {
        // Partial failure: the successes above stand, and every person who did
        // not get it is named with the reason, so the Owner knows exactly who
        // to follow up rather than re-running the whole thing.
        out += '<div class="rh2-empty rh2-learn-partial" role="alert"><strong>' + skipped.length +
          ' could not be assigned:</strong><ul class="rh2-learn-skipped">' +
          skipped.map(function (sk) {
            var why = 'could not be assigned.';
            if (sk.reason === 'already_active') why = 'already has this in progress.';
            else if (sk.reason === 'already_completed') why = 'has already completed this (tick Reassign to issue it again).';
            else if (sk.reason === 'read_only_account') why = 'has a read-only account and cannot complete learning.';
            else if (sk.reason === 'not_found') why = 'is no longer an active account.';
            else if (sk.reason === 'workflow_archived') why = 'that learning item is archived.';
            else if (sk.reason === 'workflow_empty') why = 'that learning item has no modules.';
            else if (sk.reason === 'workflow_not_found') why = 'that learning item no longer exists.';
            var what = multi && sk.workflowId && wfTitleById[sk.workflowId]
              ? ' (' + esc(wfTitleById[sk.workflowId]) + ')' : '';
            return '<li>' + esc(sk.name || sk.userId) + what + ' — ' + why + '</li>';
          }).join('') + '</ul></div>';
      }
      out += '</div><div class="rh2-dialog-foot">' +
        '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.laAssignClose()">Done</button>' +
        '</div></section></div>';
      return out;
    }

    // ── Review step ────────────────────────────────────────────────────────
    if (a.stage === 'review') {
      var byId = {};
      (S.la.staff || []).forEach(function (u) { byId[u.id] = u; });
      var pairs = a.pairs || [];
      var creating = pairs.filter(function (p) { return p.state === 'new'; });
      var actives = pairs.filter(function (p) { return p.state === 'active'; });
      var completes = pairs.filter(function (p) { return p.state === 'completed'; });
      var reassignCount = completes.filter(function (p) { return a.reassign[p.workflowId + ':' + p.userId]; }).length;
      var willCreate = creating.length + reassignCount;
      var personName = function (id) { var u = byId[id]; return u ? (u.name || u.email) : 'One person'; };

      out += '<h3 class="rh2-h2" id="la-as-review-h" tabindex="-1">Review before assigning</h3>' +
        '<div class="rh2-learn-review-cols">' +
        '<section aria-labelledby="la-as-rv-l"><h4 class="rh2-learn-review-h" id="la-as-rv-l">Learning selected</h4><ul class="rh2-learn-review-list">' +
          (a.wfIds || []).map(function (id) { return '<li>' + esc(wfTitleById[id] || 'Learning item') + '</li>'; }).join('') +
        '</ul></section>' +
        '<section aria-labelledby="la-as-rv-p"><h4 class="rh2-learn-review-h" id="la-as-rv-p">Assigned to</h4><ul class="rh2-learn-review-list">' +
          Object.keys(a.selected).map(function (id) { return '<li>' + esc(personName(id)) + '</li>'; }).join('') +
        '</ul></section></div>';

      out += '<p class="rh2-learn-review-sum" role="status">' + willCreate + ' assignment' +
        (willCreate === 1 ? '' : 's') + ' will be created' +
        (a.dueAt ? ', due ' + esc(fmtDate(a.dueAt)) : '') + '.</p>';

      if (actives.length) {
        out += '<div class="rh2-learn-review-block"><strong>Already assigned — skipped:</strong><ul class="rh2-learn-review-list">' +
          actives.map(function (p) {
            return '<li>' + esc(personName(p.userId)) +
              (multi ? ' — ' + esc(wfTitleById[p.workflowId] || '') : '') +
              ' <span class="rh2-quiet">(in progress or not started)</span></li>';
          }).join('') + '</ul></div>';
      }
      if (completes.length) {
        out += '<div class="rh2-learn-review-block"><strong>Previously completed — tick to reassign:</strong><ul class="rh2-learn-review-list">' +
          completes.map(function (p) {
            var key = p.workflowId + ':' + p.userId;
            return '<li><label class="rh2-learn-inline-check">' +
              '<input type="checkbox" ' + (a.reassign[key] ? 'checked ' : '') +
              'onchange="RH2.laAssignReassign(\'' + esc(key) + '\')"> Reassign to ' + esc(personName(p.userId)) +
              (multi ? ' — ' + esc(wfTitleById[p.workflowId] || '') : '') +
              '</label> <span class="rh2-quiet">The completed record is kept either way.</span></li>';
          }).join('') + '</ul></div>';
      }

      if (a.err) out += '<div class="rh2-empty rh2-learn-assign-err" role="alert">' + esc(a.err) + '</div>';

      out += '</div><div class="rh2-dialog-foot">' +
        '<button type="button" class="rh2-btn" ' + (a.busy ? 'disabled ' : '') + 'onclick="RH2.laAssignBack()">Back</button>' +
        '<button type="button" class="rh2-btn" onclick="RH2.laAssignClose()">Cancel</button>' +
        '<button type="button" class="rh2-btn rh2-btn-primary"' + ((a.busy || !willCreate) ? ' disabled' : '') +
          ' onclick="RH2.laAssignSubmit()">' +
          (a.busy ? 'Assigning…' : 'Assign learning') + '</button>' +
        '</div></section></div>';
      return out;
    }

    // ── What is being assigned ─────────────────────────────────────────────
    if (multi) {
      out += '<p class="rh2-learn-assign-what"><span class="rh2-quiet">Assigning ' + a.wfIds.length + ' learning items</span></p>' +
        '<ul class="rh2-learn-review-list rh2-learn-assign-whatlist">' +
        laAssignWfList().map(function (w) { return '<li>' + esc(w.title) + '</li>'; }).join('') +
        '</ul>';
    } else if (a.wfTitle) {
      out += '<p class="rh2-learn-assign-what"><span class="rh2-quiet">Assigning</span><br>' +
        '<strong>' + esc(a.wfTitle) + '</strong></p>';
    } else {
      out += '<label class="rh2-lbl" for="la-as-wf">Learning item</label>' +
        '<select class="rh2-select" id="la-as-wf" onchange="RH2.laAssignWf(this.value)">' +
        '<option value="">Choose…</option>' +
        (S.la.workflows || []).filter(function (w) { return w.status === 'active' && (w.module_count || 0) > 0; })
          .map(function (w) { return '<option value="' + esc(w.id) + '"' + (a.wfId === w.id ? ' selected' : '') + '>' + esc(w.title) + '</option>'; }).join('') +
        '</select>';
    }

    // ── Who ────────────────────────────────────────────────────────────────
    var roles = {};
    (staff || []).forEach(function (u) { if (u.role) roles[u.role] = true; });
    var roleKeys = Object.keys(roles).sort();

    out += '<div class="rh2-learn-assign-filters">' +
      '<label class="rh2-visually-hidden" for="la-as-q">Search people by name or email</label>' +
      '<input class="rh2-input" id="la-as-q" type="search" placeholder="Search by name…" value="' + esc(a.q) + '"' +
        ' oninput="RH2.laAssignQ(this.value)">' +
      (roleKeys.length > 1
        ? '<label class="rh2-visually-hidden" for="la-as-role">Filter by role</label>' +
          '<select class="rh2-select" id="la-as-role" onchange="RH2.laAssignRole(this.value)">' +
          '<option value="">All roles</option>' +
          roleKeys.map(function (r) {
            return '<option value="' + esc(r) + '"' + (a.roleFilter === r ? ' selected' : '') + '>' +
              esc(roleLabel(r)) + '</option>';
          }).join('') + '</select>'
        : '') +
      '</div>';

    if (!staff && S.la.staffErr && !S.la.staffLoading) {
      // The people list failed. Without this the dialog showed a skeleton for
      // ever, which reads as "still loading" and never resolves.
      out += '<div class="rh2-empty" role="alert">' + esc(S.la.staffErr) +
        ' <button type="button" class="rh2-btn" onclick="RH2.laAssignRetryStaff()">Try again</button></div>';
    } else if (!staff) {
      // Loading the people list.
      out += '<div class="rh2-learn-staff-pick">' + skel(3) + '</div>';
    } else if (!staff.length) {
      out += '<div class="rh2-empty">There are no active people to assign learning to. ' +
        'Invite a team member first.</div>';
    } else {
      var eligible = visible.filter(function (u) { return !laAssignHas(u); });
      var allOn = eligible.length > 0 && eligible.every(function (u) { return a.selected[u.id]; });

      out += '<div class="rh2-learn-assign-bar">' +
        (eligible.length
          ? '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laAssignSelectAllVisible()">' +
            (allOn ? 'Clear visible' : 'Select all visible (' + eligible.length + ')') + '</button>'
          : '') +
        '<span class="rh2-learn-assign-count" role="status" aria-live="polite">' +
        selCount + ' selected</span></div>';

      out += '<div class="rh2-learn-staff-pick">';
      if (!visible.length) {
        out += '<div class="rh2-empty">Nobody matches ' +
          (a.q ? '“' + esc(a.q) + '”' : 'that filter') + '.</div>';
      } else if (!eligible.length) {
        out += '<div class="rh2-empty">Everyone shown already has this learning. ' +
          'Clear the filters to see other people.</div>';
        out += visible.map(laAssignRow).join('');
      } else {
        out += visible.map(laAssignRow).join('');
      }
      out += '</div>';
    }

    // ── The rest of the assignment ─────────────────────────────────────────
    out += '<div class="rh2-form-grid rh2-learn-assign-meta">' +
      '<label class="rh2-lbl" for="la-as-due">Due date (optional)</label>' +
      '<input type="date" class="rh2-input" id="la-as-due" value="' + esc(a.dueAt) + '" onchange="RH2.laAssignField(\'dueAt\',this.value)">' +
      '<label class="rh2-lbl" for="la-as-note">Note to them (optional)</label>' +
      '<textarea class="rh2-input" id="la-as-note" rows="2" oninput="RH2.laAssignField(\'note\',this.value)">' + esc(a.note) + '</textarea>' +
      '<label class="rh2-lbl" for="la-as-pri">Priority</label>' +
      '<select class="rh2-select" id="la-as-pri" onchange="RH2.laAssignField(\'priority\',this.value)">' +
        ['low', 'normal', 'high'].map(function (p) { return '<option value="' + p + '"' + (a.priority === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>'; }).join('') +
      '</select>' +
      '<label class="rh2-learn-inline-check"><input type="checkbox" ' + (a.mandatory ? 'checked ' : '') +
        'onchange="RH2.laAssignField(\'mandatory\',this.checked)"> Mandatory</label>' +
      '</div>';

    if (a.err) out += '<div class="rh2-empty rh2-learn-assign-err" role="alert">' + esc(a.err) + '</div>';

    out += '</div><div class="rh2-dialog-foot">' +
      '<button type="button" class="rh2-btn" onclick="RH2.laAssignClose()">Cancel</button>' +
      '<button type="button" class="rh2-btn rh2-btn-primary"' +
        ((a.busy || !selCount || !(a.wfIds || []).length) ? ' disabled' : '') +
        ' onclick="RH2.laAssignReview()">' +
        'Review assignment' + (selCount ? ' (' + selCount + ' ' + (selCount === 1 ? 'person' : 'people') + ')' : '') +
      '</button></div></section></div>';
    return out;
  }

  /** One person in the picker. */
  function laAssignRow(u) {
    var a = S.la.assign;
    var has = laAssignHas(u);
    var on = !!a.selected[u.id];
    // Somebody who already has it is not offered a checkbox at all — the state
    // is carried by a word ("Already assigned"), never by colour alone.
    return '<label class="rh2-learn-staff-row' + (on ? ' rh2-learn-staff-on' : '') +
      (has ? ' rh2-learn-staff-has' : '') + '">' +
      (has
        ? '<span class="rh2-learn-staff-check" aria-hidden="true">' + icn('check', 'check') + '</span>'
        : '<input type="checkbox" ' + (on ? 'checked ' : '') +
          'onchange="RH2.laAssignToggle(\'' + esc(u.id) + '\')">') +
      '<span class="rh2-avatar" aria-hidden="true">' + esc(initials(u.name, u.email)) + '</span>' +
      '<span class="rh2-row-main"><span class="rh2-row-title">' + esc(u.name || u.email) + '</span>' +
      '<span class="rh2-row-sub">' + esc(roleLabel(u.role)) +
      (has ? ' · Already assigned' : '') + '</span></span></label>';
  }

  /** Clicking the backdrop, but not the dialog itself, closes it. */
  function laAssignBackdrop(ev) {
    if (ev && ev.target && ev.target.classList &&
        ev.target.classList.contains('rh2-dialog-backdrop')) laAssignClose();
  }

  /**
   * Escape closes; Tab cycles inside.
   *
   * One document-level listener rather than per-render bindings, because this
   * module replaces its whole subtree on every keystroke — a handler attached
   * to the dialog would be thrown away and re-created constantly.
   */
  doc.addEventListener('keydown', function (e) {
    if (!S.la) return;
    // Whichever learning dialog is open owns the keyboard. The create dialog
    // is checked first because it can be opened from inside the library while
    // no assignment dialog exists.
    var dlg = null;
    var close = null;
    if (S.la.create) { dlg = doc.getElementById('la-new-dialog'); close = laCreateClose; }
    else if (S.la.assign) { dlg = doc.getElementById('la-as-dialog'); close = laAssignClose; }
    if (!dlg) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    var focusable = dlg.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ── Owner: assignments monitor ──────────────────────────────────────────────

  function laViewAssignments(wfId) {
    S.la.assign = null;
    S.la.editor = null;
    S.la.afWorkflow = wfId || '';
    S.la.afUser = '';
    S.la.tab = 'assignments';
    // Assign Learning now shows the monitor itself, so stay on it and bring the
    // section into view. Previously this had to jump to Admin > Learning
    // because nothing on this page could have displayed the answer.
    var inPlace = S.view === 'learning';
    loadLaAssignments();
    render();
    if (inPlace) {
      var el = doc.getElementById('asl-assignments');
      // Without this the click looks inert: the filter applies to a table
      // sitting below the fold.
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function laAf(field, value) {
    S.la[field] = value;
    loadLaAssignments();
  }

  async function laOpenAssignment(id) {
    var la = S.la;
    if (la.openAssignment === id) { la.openAssignment = null; la.openData = null; return render(); }
    la.openAssignment = id;
    la.openData = null;
    la.openLoading = true;
    render();
    var d = await api('/api/learning/assignments/' + encodeURIComponent(id));
    // Stale guard: the owner may have clicked another row while this loaded —
    // rendering employee A's modules (and Cancel button) under employee B's
    // row would act on the wrong assignment.
    if (S.la.openAssignment !== id) return;
    la.openLoading = false;
    la.openData = d.ok ? d : { err: d.error || 'The assignment could not be loaded.' };
    render();
  }

  async function laCancelAssignment(id) {
    if (!confirm('Cancel this learning assignment? The employee will no longer see it. Progress is kept for the record.')) return;
    var d = await api('/api/learning/assignments/' + encodeURIComponent(id) + '/cancel', { method: 'POST' });
    if (!d.ok) { alert(d.error || 'Cancelling failed.'); return; }
    S.la.openAssignment = null;
    S.la.openData = null;
    loadLaAssignments();
    loadLa();
  }

  async function laPushLatest(id) {
    if (!confirm('Update this assignment to the latest version of the workflow? Completed modules that still exist are kept.')) return;
    var d = await api('/api/learning/assignments/' + encodeURIComponent(id) + '/push-latest', { method: 'POST' });
    if (!d.ok) { alert(d.error || 'The update failed.'); return; }
    laOpenAssignment(id);
    loadLaAssignments();
  }

  function renderLaAssignments() {
    var la = S.la;
    var out = '<div class="rh2-learn-af">' +
      // One control, not a dropdown plus an "Overdue only" tickbox. The pair
      // could express combinations that are always empty by definition —
      // Completed AND overdue — which reads as "no results" when the honest
      // answer is that the question cannot have any.
      '<select class="rh2-select" aria-label="Filter by status" onchange="RH2.laAf(\'afStatus\',this.value)">' +
        [['', 'All'], ['assigned', 'Not started'], ['in_progress', 'In progress'],
         ['completed', 'Completed'], ['overdue', 'Overdue'], ['cancelled', 'Cancelled']].map(function (o) {
          return '<option value="' + o[0] + '"' + (la.afStatus === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('') + '</select>' +
      '<select class="rh2-select" aria-label="Filter by workflow" onchange="RH2.laAf(\'afWorkflow\',this.value)">' +
        '<option value="">All workflows</option>' +
        (la.workflows || []).map(function (w) {
          return '<option value="' + esc(w.id) + '"' + (la.afWorkflow === w.id ? ' selected' : '') + '>' + esc(w.title) + '</option>';
        }).join('') + '</select>' +
      '<input class="rh2-input" id="la-af-q" placeholder="Search employee or learning…" value="' + esc(la.afQ) + '" ' +
        'oninput="RH2.laAfQ(this.value)">' +
      '</div>';

    // The employee filter arrives from Staff progress → View learning; it has
    // to be visible and clearable or later visits silently show a subset.
    if (la.afUser) {
      var filteredStaff = (la.staff || []).find(function (u) { return u.id === la.afUser; });
      out += '<div class="rh2-learn-af"><span class="rh2-chip">Showing ' +
        esc(filteredStaff ? (filteredStaff.name || filteredStaff.email) : 'one employee') + ' only</span> ' +
        '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.laAf(\'afUser\',\'\')">Show all employees</button></div>';
    }

    if (!la.assignments) return out + '<div class="rh2-card">' + skel(3, 48) + '</div>';
    if (!la.assignments.length) return out + '<div class="rh2-empty">No assignments match these filters.</div>';

    out += '<div class="rh2-learn-tablewrap"><table class="rh2-learn-table"><thead><tr>' +
      '<th>Employee</th><th>Learning</th><th>Assigned</th><th>Progress</th><th>Status</th><th>Due</th><th>Completed</th></tr></thead><tbody>';
    la.assignments.forEach(function (r) {
      var open = la.openAssignment === r.id;
      out += '<tr class="rh2-learn-tr' + (open ? ' rh2-learn-tr-open' : '') + '" onclick="RH2.laOpenAssignment(\'' + esc(r.id) + '\')" ' +
        'tabindex="0" onkeydown="if(event.key===\'Enter\')RH2.laOpenAssignment(\'' + esc(r.id) + '\')">' +
        '<td>' + esc(r.user_name || r.user_email) + '</td>' +
        '<td>' + esc(r.title) + ' <span class="rh2-quiet">v' + esc(r.version) + '</span></td>' +
        '<td>' + esc(fmtDate(r.assigned_at)) + '</td>' +
        '<td class="rh2-learn-td-progress">' + laBar(r.progress_percent, (r.user_name || '') + ' progress') + ' ' + (r.progress_percent || 0) + '%</td>' +
        '<td>' + laStatusChip(r) + '</td>' +
        '<td>' + (r.due_at ? esc(fmtDate(r.due_at)) : '—') + '</td>' +
        '<td>' + (r.completed_at ? esc(fmtDate(r.completed_at)) : '—') + '</td>' +
      '</tr>';
      if (open) {
        out += '<tr class="rh2-learn-tr-detail"><td colspan="7">' + renderLaAssignmentDetail(r) + '</td></tr>';
      }
    });
    return out + '</tbody></table></div>';
  }

  function renderLaAssignmentDetail(r) {
    var la = S.la;
    if (la.openLoading || !la.openData) return skel(2, 40);
    if (la.openData.err) return '<div class="rh2-empty">' + esc(la.openData.err) + '</div>';
    var d = la.openData;
    var a = d.assignment;
    var active = a.status === 'assigned' || a.status === 'in_progress';
    var out = '<div class="rh2-learn-adetail">' +
      '<div class="rh2-row-sub">Assigned ' + esc(fmtDate(a.assigned_at)) +
        (a.assigned_by_name ? ' by ' + esc(a.assigned_by_name) : '') +
        ' · Version ' + esc(a.version) +
        (a.last_activity_at ? ' · Last activity ' + esc(fmtDate(a.last_activity_at)) : '') +
        (a.cancelled_at ? ' · Cancelled ' + esc(fmtDate(a.cancelled_at)) : '') +
        (a.owner_note ? ' · Note: ' + esc(a.owner_note) : '') + '</div>';
    (d.sections || []).forEach(function (s) {
      out += '<div class="rh2-learn-adetail-sec"><strong>' + esc(s.title) + '</strong><ul class="rh2-learn-adetail-items">' +
        (s.items || []).map(function (it) {
          var ev = it.evidence || {};
          var evTxt = '';
          if (ev.kind === 'quiz') evTxt = ' — scored ' + esc(ev.score) + '/' + esc(ev.total) + ' (' + esc(ev.percent) + '%)';
          else if (ev.kind === 'acknowledgement') evTxt = ' — acknowledged';
          return '<li class="' + (it.completed_at ? 'rh2-learn-adone' : '') + '">' +
            (it.completed_at ? '✓ ' : '○ ') + esc(it.title) +
            (it.required ? '' : ' <span class="rh2-quiet">(optional)</span>') +
            (it.completed_at ? ' <span class="rh2-quiet">' + esc(fmtDate(it.completed_at)) + evTxt + '</span>' : '') +
          '</li>';
        }).join('') + '</ul></div>';
    });
    out += '<div class="rh2-learn-card-actions">';
    if (active) {
      out += '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="event.stopPropagation();RH2.laCancelAssignment(\'' + esc(a.id) + '\')">Cancel assignment</button>';
      if (d.workflow_current_version && Number(a.version) < Number(d.workflow_current_version)) {
        out += '<button type="button" class="rh2-btn" onclick="event.stopPropagation();RH2.laPushLatest(\'' + esc(a.id) + '\')">Update to v' + esc(d.workflow_current_version) + '</button>';
      }
    }
    return out + '</div></div>';
  }

  var laAfQDebounce = null;
  function laAfQ(v) {
    S.la.afQ = v;
    if (laAfQDebounce) clearTimeout(laAfQDebounce);
    laAfQDebounce = setTimeout(function () { loadLaAssignments(); }, 300);
  }

  // ── Owner: staff progress ───────────────────────────────────────────────────

  function renderLaStaff() {
    var staff = S.la.staff || [];
    if (!staff.length) return '<div class="rh2-empty">No active staff accounts found.</div>';
    return '<div class="rh2-learn-cards">' + staff.map(function (u) {
      return '<div class="rh2-learn-card">' +
        '<div class="rh2-learn-card-head"><span class="rh2-row-title">' + esc(u.name || u.email) + '</span>' +
          '<span class="rh2-chip rh2-chip-quiet">' + esc(u.role) + '</span></div>' +
        '<div class="rh2-row-sub">' + esc(u.email) + '</div>' +
        '<div class="rh2-row-sub">' + esc(u.active_assignments) + ' active · ' + esc(u.completed_assignments) + ' completed' +
          (u.last_activity_at ? ' · Last activity ' + esc(fmtDate(u.last_activity_at)) : '') + '</div>' +
        '<div class="rh2-learn-card-actions">' +
          '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.laAssignOpen(\'\',\'' + esc(u.id) + '\')">+ Assign learning</button>' +
          '<button type="button" class="rh2-btn" onclick="RH2.laStaffAssignments(\'' + esc(u.id) + '\')">View learning</button>' +
        '</div></div>';
    }).join('') + '</div>';
  }

  function laStaffAssignments(userId) {
    S.la.afUser = userId || '';
    S.la.afWorkflow = '';
    S.la.tab = 'assignments';
    loadLaAssignments();
    render();
  }

  global.RH2 = {
    open: open,
    nav: nav,
    // Source review + instrument register (inline onclick handlers only work
    // if they are exported here — the module uses no event delegation).
    sourceReviewSearch: sourceReviewSearch,
    sourceReviewClear: sourceReviewClear,
    sourceReviewPage: sourceReviewPage,
    submitSourceReview: submitSourceReview,
    ingFilter: function (t) { S.admin.ingTreatment = t || ''; loadIngestion(); },
    goToClients: goToClients,
    openPd: openPd,
    startAssessment: startAssessment,
    assessSearch: assessSearch,
    assessPick: assessPick,
    assessCancel: assessCancel,
    openInstrument: openInstrument,
    closeInstrument: closeInstrument,
    pdSearch: pdSearch,
    pdFilter: pdFilter,
    pdClear: pdClear,
    pdPage: pdPage,
    pdReload: function () { S.pd.data = null; loadPd(); },
    reloadHome: function () { S.home = null; loadHome(); },
    homeSearch: homeSearch,
    openTool: openTool,
    _tools: TOOLS,
    libInput: libInput,
    libFilter: libFilter,
    libMore: libMore,
    libOpenFolder: libOpenFolder,
    libBrowse: libBrowse,
    libScopeSearch: libScopeSearch,
    libReloadFolders: libReloadFolders,
    libPickFiles: libPickFiles,
    libUploadFiles: libUploadFiles,
    libUploadsDismiss: libUploadsDismiss,
    libDragOver: libDragOver,
    libDragLeave: libDragLeave,
    libDrop: libDrop,
    libMenu: libMenu,
    libMenuClose: libMenuClose,
    libRenameStart: libRenameStart,
    libRenameField: libRenameField,
    libRenameCancel: libRenameCancel,
    libRenameSave: libRenameSave,
    libMoveOne: libMoveOne,
    libSelectMode: libSelectMode,
    libWorkspaceMenu: libWorkspaceMenu,
    libWsDragOver: libWsDragOver,
    libWsDragLeave: libWsDragLeave,
    libWsDrop: libWsDrop,
    libNewDocument: libNewDocument,
    libToggleSel: libToggleSel,
    libMoveOpen: libMoveOpen,
    libMoveTo: libMoveTo,
    libFolderForm: libFolderForm,
    libFolderFormField: libFolderFormField,
    libFolderSave: libFolderSave,
    libFolderArchive: libFolderArchive,
    previewFile: previewFile,
    regenPreview: regenPreview,
    adminUpload: adminUpload,
    openDetail: openDetail,
    toggleFav: toggleFav,
    toggleComplete: toggleComplete,
    ackStart: ackStart,
    ackCancel: ackCancel,
    ackConfirm: ackConfirmFn,
    fbSelect: fbSelect,
    fbSubmit: fbSubmit,
    raiseTicket: raiseTicket,
    toggleVersions: toggleVersions,
    quizSubmit: quizSubmit,
    quizRetry: quizRetry,
    cpdToggle: cpdToggle,
    cpdSave: cpdSave,
    pdPastToggle: pdPastToggle,
    adminNav: adminNav,
    adminContentSearch: adminContentSearch,
    adminContentStatus: adminContentStatus,
    adminNew: adminNew,
    adminEdit: adminEdit,
    adminFormClose: adminFormClose,
    adminFormAuthority: adminFormAuthority,
    adminSave: adminSave,
    adminAction: adminAction,
    sourcesCheck: sourcesCheck,
    sourceVerify: sourceVerify,
    pdNew: pdNew,
    pdEdit: pdEdit,
    pdClose: pdClose,
    pdSave: pdSave,
    qlSave: qlSave,
    qlToggle: qlToggle,

    // ── Owner-controlled learning ────────────────────────────────────────────
    // The shared induction experience — learner, preview and edit modes
    indGo: indGo,
    indJump: indJump,
    // Employee: assigned learning + player
    openAssignment: openAssignment,
    reloadMyLearning: function () { S.myl.rows = null; loadMyLearning(); },
    alBack: alBack,
    alFinish: alFinish,
    alRestart: alRestart,
    alJumpItem: alJumpItem,
    alOpenWalk: alOpenWalk,
    alAckArm: alAckArm,
    alAckCancel: alAckCancel,
    alAckConfirm: alAckConfirm,
    alQuizPick: alQuizPick,
    alQuizSubmit: alQuizSubmit,
    alQuizRetry: alQuizRetry,
    // Owner: learning console
    laNav: laNav,
    laCreate: laCreate,
    laEdit: laEdit,
    laEditorClose: laEditorClose,
    laSave: laSave,
    laMeta: laMeta,
    laSecField: laSecField,
    laItemField: laItemField,
    laQuizField: laQuizField,
    laQField: laQField,
    laSecAdd: laSecAdd,
    laSecRemove: laSecRemove,
    laSecMove: laSecMove,
    laItemAdd: laItemAdd,
    laItemRemove: laItemRemove,
    laItemMove: laItemMove,
    laQAdd: laQAdd,
    laQRemove: laQRemove,
    // Click-to-edit: the learner's rendering until a click, the field after
    laEditStart: laEditStart,
    laEditStop: laEditStop,
    laSettings: laSettings,
    laItemFlag: laItemFlag,
    laQCorrect: laQCorrect,
    laQOption: laQOption,
    laQOptionAdd: laQOptionAdd,
    laQOptionDone: laQOptionDone,
    laResPickOpen: laResPickOpen,
    laResPickClose: laResPickClose,
    laResSearch: laResSearch,
    laResChoose: laResChoose,
    laPreview: laPreview,
    laDuplicate: laDuplicate,
    laArchive: laArchive,
    laUnarchive: laUnarchive,
    laDelete: laDelete,
    laToggleArchived: laToggleArchived,
    laAssignOpen: laAssignOpen,
    laAssignClose: laAssignClose,
    laAssignQ: laAssignQ,
    laAssignToggle: laAssignToggle,
    laAssignField: laAssignField,
    laAssignWf: laAssignWf,
    laAssignSubmit: laAssignSubmit,
    laAssignRole: laAssignRole,
    laAssignSelectAllVisible: laAssignSelectAllVisible,
    laAssignBackdrop: laAssignBackdrop,
    laAssignRetryStaff: loadLaStaff,
    // New learning item — a portal dialog, not window.prompt
    laCreateClose: laCreateClose,
    laCreateField: laCreateField,
    laCreateSubmit: laCreateSubmit,
    laCreateBackdrop: laCreateBackdrop,
    laEditWalkthrough: laEditWalkthrough,
    laPlayWalkthrough: laPlayWalkthrough,
    laImport: laImport,
    laImportDismiss: laImportDismiss,
    // Batch assignment + review step + reassignment
    laAssignOpenMulti: laAssignOpenMulti,
    laAssignReview: laAssignReview,
    laAssignBack: laAssignBack,
    laAssignReassign: laAssignReassign,
    // Deliberate publish + stale-edit recovery
    laPublish: laPublish,
    laEditorReload: laEditorReload,
    // Owner: Assign Learning
    aslSearch: aslSearch,
    aslResetFilters: aslResetFilters,
    aslReload: aslReload,
    aslToggleSel: aslToggleSel,
    aslSelectAllShown: aslSelectAllShown,
    aslClearSel: aslClearSel,
    laViewAssignments: laViewAssignments,
    laAf: laAf,
    laAfQ: laAfQ,
    laOpenAssignment: laOpenAssignment,
    laCancelAssignment: laCancelAssignment,
    laPushLatest: laPushLatest,
    laStaffAssignments: laStaffAssignments,

    _md: mdRender, // exported for unit tests
    _esc: esc,
    // The two rules behind every number and card in a Library folder. Exported
    // so they can be exercised rather than pattern-matched in the source:
    // which cards a folder is allowed to add, and how a count reads.
    _toolsFor: toolsFor,
    _countLabel: countLabel,
  };

})(typeof window !== 'undefined' ? window : this);
