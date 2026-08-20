/* ═══════════════════════════════════════════════════════════════════════════
   INTERVIEW PREPARATION — portal module

   One IIFE, one global (window.Interviews), no build step, no dependencies —
   the same shape as onboarding.js, resourcehub.js and assessment.js. Renders
   string-built HTML into the static <div id="iv-root"> that mockup_v3.html
   declares inside <section class="view" id="view-interviews">.

   THREE SURFACES, ONE TAB
   ───────────────────────
     library   the template shelf and the practice's interview records
     preview   what a template ASKS, readable without creating a record
     record    the interview itself — the online document

   The Owner also gets an ACCESS panel for granting and revoking Interview
   Preparation to individual administrators. Everything it draws is decided by
   what the SERVER says (`capabilities` on /api/interviews/templates, `canEdit`
   on every record); no button in this file is enabled because of a role string
   the browser happens to hold. Client gating is honesty about what to draw,
   never the security boundary.

   THE DOCUMENT IS ONE PAGE, NOT SIX
   ─────────────────────────────────
   Every section renders at once, in order, as one continuous document — the
   digital form of the printed template rather than a paged wizard. The section
   strip scrolls to a heading; it never swaps a panel, so no answer is ever
   unmounted, nothing needs "preserving between steps", and a browser find
   searches the whole interview.

   ANSWER BOXES GROW
   ─────────────────
   Every narrative field is a real <textarea> with no maxlength, and it grows
   with what is typed (autoGrow below). The interviewer types a paragraph and
   the box becomes a paragraph tall; the questions below simply move down. The
   generated PDF reflows the same way — see backend/interview-pdf.js.

   NOTHING IS LOST
   ───────────────
   Typing marks the record dirty and schedules a save 1.2 seconds later;
   leaving a field, jumping sections, completing and closing all flush first.
   The unload guard is armed ONLY while there is genuinely something unsaved,
   so a user who has stopped typing long enough for autosave to land is never
   nagged. A save that fails says so and keeps the text on screen — the
   textarea, not the server response, is never overwritten from a failure.

   ACCESSIBILITY
   ─────────────
   Real <label for> on every control; ratings are a radiogroup with a visible
   numeral per option, so a score is never a bare unlabelled circle; status is
   carried by text as well as colour; the save state is announced through
   aria-live.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ── Pure helpers (defined before any DOM access so node can require this) ──

  /**
   * Escape before interpolation. Five characters, null-safe — the module-local
   * contract the rest of the portal's extracted modules use. Deliberately not
   * window.escapeHtml, which does not escape the single quote.
   */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(iso) {
    if (!iso) return '—';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-AU', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' });
  }

  /** yyyy-mm-dd for an <input type="date">, from an ISO string or a Date. */
  function dateInputValue(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v).slice(0, 10);
    return d.toISOString().slice(0, 10);
  }

  var STATUS_LABELS = {
    draft: 'Draft',
    in_progress: 'In Progress',
    completed: 'Completed',
    archived: 'Archived',
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || String(status || '');
  }

  /**
   * Is there anything a reader would see in this answer? Mirrors
   * interview-templates.js isAnswerEmpty so the on-screen progress figure and
   * the server's agree.
   */
  function answerIsEmpty(question, value) {
    if (value === undefined || value === null || !question) return true;
    var type = question.type;
    if (type === 'text' || type === 'date' || type === 'longtext') return String(value).trim() === '';
    if (type === 'checkboxes') return !Array.isArray(value) || value.length === 0;
    if (type === 'choice') return !value.option;
    if (type === 'ratings') return !value || Object.keys(value).length === 0;
    return true;
  }

  /** Walk a template's questions in document order. */
  function eachQuestion(template, fn) {
    (((template || {}).sections) || []).forEach(function (section) {
      (section.questions || []).forEach(function (q) { fn(q, section); });
      (section.signoff || []).forEach(function (q) { fn(q, section); });
    });
  }

  function progressOf(template, responses) {
    var total = 0;
    var answered = 0;
    eachQuestion(template, function (q) {
      total += 1;
      if (!answerIsEmpty(q, (responses || {})[q.key])) answered += 1;
    });
    return { total: total, answered: answered, percent: total ? Math.round((answered / total) * 100) : 0 };
  }

  /** The record's page title: "Occupational Therapist Interview — Jane Smith". */
  function recordTitle(record) {
    if (!record) return 'Interview';
    var name = (record.templateName || 'Interview');
    return record.candidateName ? (name + ' — ' + record.candidateName) : name;
  }

  var helpers = {
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    dateInputValue: dateInputValue,
    statusLabel: statusLabel,
    answerIsEmpty: answerIsEmpty,
    progressOf: progressOf,
    recordTitle: recordTitle,
    STATUS_LABELS: STATUS_LABELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;

  // node / test environments stop here — everything below needs a browser.
  var doc = global && global.document;
  if (!doc) return;

  // ── Module state ──────────────────────────────────────────────────────────

  var API = '/api/interviews';
  var AUTOSAVE_MS = 1200;

  var S = {
    view: 'library',        // library | preview | record | access
    loading: false,
    error: null,

    templates: [],
    upcoming: [],
    capabilities: {},

    records: [],
    scope: 'own',
    filters: { q: '', status: 'active' },

    preview: null,          // a full template, for the read-only preview
    record: null,           // the open interview record
    template: null,         // its snapshot, for rendering the form

    // Save machinery
    pending: {},            // field changes not yet sent
    pendingMeta: {},        // candidate/date/interviewer changes not yet sent
    dirty: false,
    saving: false,
    saveError: null,
    lastSavedAt: null,
    saveTimer: null,

    access: null,           // the Owner's delegation payload
  };

  function root() { return doc.getElementById('iv-root'); }

  /**
   * Make sure this module's view is the one on screen before rendering into it.
   *
   * A tab view is display:none while another tab is active, so rendering into
   * it without switching first produces a page that is populated and
   * invisible — the worst kind of failure, because nothing errors. Every
   * public entry point calls this, so a deep link, a colleague's link, a
   * restore that raced the auth handshake, or another module calling
   * Interviews.openRecord() all land somewhere the user can actually see.
   *
   * Not recursive: switchTab's own post-dispatch calls Interviews.open(),
   * which calls this again and finds the view already active.
   */
  function ensureVisible() {
    var view = doc.getElementById('view-interviews');
    if (view && view.classList.contains('active')) return;
    if (typeof global.switchTab === 'function') {
      try { global.switchTab('interviews'); } catch (_) { /* nav must never block a render */ }
    }
  }

  /**
   * A DOM id assembled from server-supplied keys (a question key, a user id).
   * The id is still esc()'d where it lands in an attribute — this exists so
   * ids are built one way, and so the escaping scan sees no bare
   * concatenation of a server value to reason about.
   */
  function domId() {
    return Array.prototype.slice.call(arguments).filter(Boolean).join('-');
  }

  /**
   * A key safe to place inside a CSS attribute selector.
   *
   * Question keys and option keys arrive from the server (from the record's
   * frozen template snapshot), and the template grammar restricts them to
   * lowercase, digits and underscore — interview-templates.test.js asserts
   * exactly that. Anything else is refused rather than concatenated into a
   * selector, so a snapshot edited in the database cannot make
   * querySelectorAll select something else.
   */
  function selectorKey(v) {
    var value = String(v === null || v === undefined ? '' : v);
    return /^[a-z0-9_]+$/.test(value) ? value : '';
  }

  /** The same rule for a user id, which is always a UUID. */
  function selectorId(v) {
    var value = String(v === null || v === undefined ? '' : v);
    return /^[0-9a-f-]{1,64}$/i.test(value) ? value : '';
  }

  // ── Server access ─────────────────────────────────────────────────────────

  /**
   * Never throws — the caller checks `ok`. Same shape as onboarding.js's, so
   * error handling reads identically across the portal.
   */
  async function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', credentials: 'include', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    try {
      var response = await fetch(API + path, init);
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          error: data.message || data.error || ('Request failed (' + response.status + ')'),
          details: data,
        };
      }
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, error: 'Network error — your answers are still on screen. Try saving again.' };
    }
  }

  function toast(message, isError) {
    // showToast in this app is (msg, isError); a subtitle string in the second
    // argument would read as truthy and render an error-styled toast.
    if (typeof global.showToast === 'function') global.showToast(message, !!isError);
  }

  // ── Small render primitives ───────────────────────────────────────────────

  function chip(status) {
    return '<span class="iv-chip is-' + esc(status) + '">' + esc(statusLabel(status)) + '</span>';
  }

  function btn(action, label, opts) {
    opts = opts || {};
    var cls = 'iv-btn' + (opts.variant ? ' is-' + opts.variant : '');
    var attrs = ' data-iv="' + esc(action) + '"';
    if (opts.id) attrs += ' data-id="' + esc(opts.id) + '"';
    if (opts.key) attrs += ' data-key="' + esc(opts.key) + '"';
    if (opts.title) attrs += ' title="' + esc(opts.title) + '"';
    if (opts.disabled) attrs += ' disabled';
    return '<button type="button" class="' + cls + '"' + attrs + '>' + esc(label) + '</button>';
  }

  function emptyState(title, body, actionHtml) {
    return ''
      + '<div class="iv-empty">'
      + '  <div class="iv-empty-title">' + esc(title) + '</div>'
      + '  <p>' + esc(body) + '</p>'
      + (actionHtml || '')
      + '</div>';
  }

  function loadingState(label) {
    return '<div class="iv-loading" role="status">' + esc(label || 'Loading…') + '</div>';
  }

  function errorState(message, retryAction) {
    return ''
      + '<div class="iv-error" role="alert">'
      + '  <div class="iv-error-title">Something went wrong</div>'
      + '  <p>' + esc(message) + '</p>'
      + (retryAction ? btn(retryAction, 'Try again', { variant: 'ghost' }) : '')
      + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════

  function templateCard(t) {
    var meta = [t.category, (t.approxPages || 6) + ' pages when printed',
      t.sectionCount + ' sections', t.questionCount + ' questions']
      .filter(Boolean);
    return ''
      + '<article class="iv-tpl-card">'
      + '  <div class="iv-tpl-head">'
      + '    <h3>' + esc(t.name) + '</h3>'
      + '    <span class="iv-tpl-badge">' + esc(t.discipline || t.category) + '</span>'
      + '  </div>'
      + '  <p class="iv-tpl-summary">' + esc(t.summary) + '</p>'
      + '  <ul class="iv-tpl-meta">'
      + (t.tags || []).map(function (tag) { return '<li>' + esc(tag) + '</li>'; }).join('')
      + '  </ul>'
      + '  <div class="iv-tpl-facts">' + esc(meta.join('  ·  ')) + '</div>'
      + '  <div class="iv-tpl-actions">'
      + btn('start', 'Start interview', { key: t.key, variant: 'primary' })
      + btn('preview', 'Preview template', { key: t.key, variant: 'ghost' })
      + btn('blank-pdf', 'Download blank PDF', { key: t.key, variant: 'ghost' })
      + btn('blank-print', 'Print blank copy', { key: t.key, variant: 'ghost' })
      + '  </div>'
      + '</article>';
  }

  function upcomingCard(t) {
    return ''
      + '<article class="iv-tpl-card is-upcoming" aria-disabled="true">'
      + '  <div class="iv-tpl-head"><h3>' + esc(t.name) + '</h3>'
      + '    <span class="iv-tpl-badge is-muted">Not available yet</span></div>'
      + '  <p class="iv-tpl-summary">' + esc(t.category)
      + ' — no interview has been written for this role yet. When one is, it appears here.</p>'
      + '</article>';
  }

  function recordRow(r) {
    var actions = ''
      + btn(r.status === 'completed' || r.status === 'archived' ? 'open' : 'continue',
        r.status === 'draft' ? 'Open' : (r.status === 'in_progress' ? 'Continue' : 'View'),
        { id: r.id, variant: 'primary' })
      + btn('record-pdf', 'PDF', { id: r.id, variant: 'ghost', title: 'Download this interview as a PDF' })
      + btn('record-print', 'Print', { id: r.id, variant: 'ghost' })
      + (r.canEdit && r.status !== 'archived' ? btn('archive', 'Archive', { id: r.id, variant: 'ghost' }) : '')
      + (r.canEdit && r.status === 'archived' ? btn('restore', 'Restore', { id: r.id, variant: 'ghost' }) : '')
      + (r.canDelete ? btn('delete', 'Delete', { id: r.id, variant: 'danger-ghost' }) : '');

    var progress = r.progress || { answered: 0, total: 0, percent: 0 };

    return ''
      + '<tr>'
      + '  <th scope="row"><button type="button" class="iv-link" data-iv="open" data-id="' + esc(r.id) + '">'
      + esc(r.candidateName) + '</button>'
      + (r.postCompletionEdits
        ? '<span class="iv-flag" title="This record was edited after it was completed">Edited after completion</span>' : '')
      + '</th>'
      + '  <td>' + esc(r.position || '—') + '</td>'
      + '  <td>' + esc(fmtDate(r.interviewDate)) + '</td>'
      + '  <td>' + esc(r.interviewers || '—') + '</td>'
      + '  <td>' + chip(r.status)
      + '    <span class="iv-progress-note">' + progress.answered + ' of ' + progress.total + ' answered</span>'
      + '  </td>'
      + '  <td>' + esc(r.recommendationLabel || '—') + '</td>'
      + '  <td>' + esc(r.createdByName || '—') + '</td>'
      + '  <td>' + esc(fmtDateTime(r.updatedAt)) + '</td>'
      + '  <td class="iv-row-actions">' + actions + '</td>'
      + '</tr>';
  }

  function recordsSection() {
    var f = S.filters;
    var statusOptions = [
      { value: 'active', label: 'Active (not archived)' },
      { value: 'all', label: 'All statuses' },
      { value: 'draft', label: 'Draft' },
      { value: 'in_progress', label: 'In Progress' },
      { value: 'completed', label: 'Completed' },
      { value: 'archived', label: 'Archived' },
    ];

    var filters = ''
      + '<div class="iv-filters">'
      + '  <label class="iv-field-inline"><span>Search</span>'
      + '    <input type="search" id="iv-filter-q" data-iv-filter="q" placeholder="Applicant or position"'
      + '           value="' + esc(f.q) + '" autocomplete="off" />'
      + '  </label>'
      + '  <label class="iv-field-inline"><span>Status</span>'
      + '    <select id="iv-filter-status" data-iv-filter="status">'
      + statusOptions.map(function (o) {
        return '<option value="' + esc(o.value) + '"' + (f.status === o.value ? ' selected' : '') + '>'
          + esc(o.label) + '</option>';
      }).join('')
      + '    </select>'
      + '  </label>'
      + '</div>';

    var body;
    if (!S.records.length) {
      var isFiltered = !!(f.q || (f.status && f.status !== 'active'));
      body = isFiltered
        ? emptyState('No interviews match those filters',
          'Try a different applicant name, or set the status filter back to Active.',
          btn('clear-filters', 'Clear filters', { variant: 'ghost' }))
        : emptyState('No interviews have been started yet',
          'Start one from a template above. Interviews save as you type and can be resumed at any time.',
          S.templates.length ? btn('start', 'Start interview', { key: S.templates[0].key, variant: 'primary' }) : '');
    } else {
      body = ''
        + '<div class="iv-table-wrap">'
        + '<table class="iv-table">'
        + '  <caption class="iv-sr-only">Interview records</caption>'
        + '  <thead><tr>'
        + '    <th scope="col">Applicant</th><th scope="col">Position</th>'
        + '    <th scope="col">Interview date</th><th scope="col">Interviewer</th>'
        + '    <th scope="col">Status</th><th scope="col">Recommendation</th>'
        + '    <th scope="col">Created by</th><th scope="col">Last edited</th>'
        + '    <th scope="col"><span class="iv-sr-only">Actions</span></th>'
        + '  </tr></thead>'
        + '  <tbody>' + S.records.map(recordRow).join('') + '</tbody>'
        + '</table>'
        + '</div>';
    }

    return ''
      + '<section class="iv-block" aria-labelledby="iv-records-h">'
      + '  <div class="iv-block-head">'
      + '    <h2 id="iv-records-h">Interviews</h2>'
      + '    <p>' + esc(S.scope === 'practice'
        ? 'Every interview recorded in this practice, including those conducted by authorised administrators.'
        : 'The interviews you have conducted.') + '</p>'
      + '  </div>'
      + filters
      + body
      + '</section>';
  }

  function libraryView() {
    var ownerActions = S.capabilities.manageAccess
      ? btn('access', 'Manage access', { variant: 'ghost' })
      : '';

    return ''
      + '<div class="iv-hero">'
      + '  <div>'
      + '    <h1>Interview Preparation</h1>'
      + '    <p>Prepare, complete and manage structured Opal Therapy interviews.</p>'
      + '  </div>'
      + '  <div class="iv-hero-actions">' + ownerActions + '</div>'
      + '</div>'
      + '<section class="iv-block" aria-labelledby="iv-templates-h">'
      + '  <div class="iv-block-head">'
      + '    <h2 id="iv-templates-h">Template library</h2>'
      + '    <p>Structured interview guides. Preview one before you use it, or start an interview straight from a card.</p>'
      + '  </div>'
      + '  <div class="iv-tpl-grid">'
      + S.templates.map(templateCard).join('')
      + S.upcoming.map(upcomingCard).join('')
      + '  </div>'
      + '</section>'
      + recordsSection();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  TEMPLATE PREVIEW  — what a template asks, without creating anything
  // ═══════════════════════════════════════════════════════════════════════════

  function previewQuestion(q) {
    var body = '';
    if (q.type === 'checkboxes' || q.type === 'choice') {
      body = '<ul class="iv-preview-options">'
        + (q.options || []).map(function (o) { return '<li>' + esc(o.label) + '</li>'; }).join('')
        + '</ul>';
    } else if (q.type === 'ratings') {
      body = '<ul class="iv-preview-options">'
        + (q.rows || []).map(function (r) {
          return '<li>' + esc(r.label) + ' — scored ' + esc((q.scale || []).join(' / ')) + '</li>';
        }).join('')
        + '</ul>'
        + (q.guide ? '<p class="iv-preview-guide">Rating guide: ' + esc(q.guide) + '</p>' : '');
    } else {
      body = '<p class="iv-preview-guide">Written response</p>';
    }
    return ''
      + '<li class="iv-preview-q">'
      + '  <p class="iv-preview-label">' + esc(q.label) + '</p>'
      + (q.guidance ? '<p class="iv-preview-guide">' + esc(q.guidance) + '</p>' : '')
      + body
      + '</li>';
  }

  function previewView() {
    var t = S.preview;
    if (!t) return loadingState('Loading the template…');
    return ''
      + '<div class="iv-crumbs">' + btn('library', '← Interview Preparation', { variant: 'ghost' }) + '</div>'
      + '<div class="iv-hero">'
      + '  <div>'
      + '    <h1>' + esc(t.documentTitle || t.name) + '</h1>'
      + '    <p>' + esc(t.summary) + '</p>'
      + '  </div>'
      + '  <div class="iv-hero-actions">'
      + btn('start', 'Start interview', { key: t.key, variant: 'primary' })
      + btn('blank-pdf', 'Download blank PDF', { key: t.key, variant: 'ghost' })
      + '  </div>'
      + '</div>'
      + '<div class="iv-doc iv-doc-preview">'
      + (t.sections || []).map(function (s) {
        return ''
          + '<section class="iv-section">'
          + '  <h2 class="iv-section-bar">' + esc(s.number + '. ' + s.title) + '</h2>'
          + '  <ol class="iv-preview-list">'
          + (s.questions || []).map(previewQuestion).join('')
          + (s.signoff || []).map(previewQuestion).join('')
          + '  </ol>'
          + '</section>';
      }).join('')
      + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  THE INTERVIEW DOCUMENT
  // ═══════════════════════════════════════════════════════════════════════════

  function answerOf(key) {
    if (Object.prototype.hasOwnProperty.call(S.pending, key)) return S.pending[key];
    return (S.record && S.record.responses ? S.record.responses[key] : undefined);
  }

  function ratingsValue() {
    if (Object.prototype.hasOwnProperty.call(S.pending, '__ratings')) return S.pending.__ratings;
    return (S.record && S.record.ratings) || {};
  }

  function recommendationValue() {
    if (Object.prototype.hasOwnProperty.call(S.pending, '__recommendation')) return S.pending.__recommendation;
    return (S.record && S.record.recommendation) || null;
  }

  function fieldLongtext(q) {
    var id = 'iv-f-' + q.key;
    var value = answerOf(q.key);
    var rows = Math.max(3, Number(q.rows) || 3);
    return ''
      + '<div class="iv-q">'
      + '  <label class="iv-q-label" for="' + esc(id) + '">' + esc(q.label) + '</label>'
      + (q.guidance ? '<p class="iv-q-guide" id="' + esc(id) + '-g">' + esc(q.guidance) + '</p>' : '')
      + '  <textarea class="iv-answer" id="' + esc(id) + '" rows="' + rows + '"'
      + '            data-iv-field="' + esc(q.key) + '" data-iv-type="longtext"'
      + (q.guidance ? ' aria-describedby="' + esc(id) + '-g"' : '')
      + '            spellcheck="true">' + esc(value === undefined || value === null ? '' : value) + '</textarea>'
      + '</div>';
  }

  function fieldText(q) {
    var id = 'iv-f-' + q.key;
    var value = answerOf(q.key);
    var type = q.type === 'date' ? 'date' : 'text';
    var shown = q.type === 'date' ? dateInputValue(value) : (value === undefined || value === null ? '' : value);
    return ''
      + '<div class="iv-q is-inline">'
      + '  <label class="iv-q-label" for="' + esc(id) + '">' + esc(q.label) + '</label>'
      + '  <input class="iv-input" id="' + esc(id) + '" type="' + type + '"'
      + '         data-iv-field="' + esc(q.key) + '" data-iv-type="' + esc(q.type) + '"'
      + '         value="' + esc(shown) + '" autocomplete="off" />'
      + '</div>';
  }

  function fieldCheckboxes(q) {
    var chosen = answerOf(q.key);
    var selected = Array.isArray(chosen) ? chosen : [];
    return ''
      + '<fieldset class="iv-q iv-fieldset">'
      + '  <legend class="iv-q-label">' + esc(q.label) + '</legend>'
      + '  <div class="iv-options is-grid">'
      + (q.options || []).map(function (o) {
        var id = domId('iv-f', q.key, o.key);
        return ''
          + '<div class="iv-option">'
          + '  <input type="checkbox" id="' + esc(id) + '" value="' + esc(o.key) + '"'
          + '         data-iv-field="' + esc(q.key) + '" data-iv-type="checkboxes"'
          + (selected.indexOf(o.key) >= 0 ? ' checked' : '') + ' />'
          + '  <label for="' + esc(id) + '">' + esc(o.label) + '</label>'
          + '</div>';
      }).join('')
      + '  </div>'
      + '</fieldset>';
  }

  function fieldChoice(q) {
    var isRecommendation = !!q.emphasis;
    var current = isRecommendation ? { option: recommendationValue(), detail: '' } : (answerOf(q.key) || {});
    var chosen = current.option || null;
    var detailOption = (q.options || []).filter(function (o) { return o.detail; })[0];

    var detailHtml = '';
    if (detailOption) {
      var did = domId('iv-f', q.key, 'detail');
      detailHtml = ''
        + '<div class="iv-detail' + (chosen === detailOption.key ? ' is-open' : '') + '"'
        + '     id="' + esc(did) + '-wrap">'
        + '  <label class="iv-q-sublabel" for="' + esc(did) + '">'
        + esc(detailOption.detailLabel || 'Details') + '</label>'
        + '  <input class="iv-input" id="' + esc(did) + '" type="text"'
        + '         data-iv-field="' + esc(q.key) + '" data-iv-type="choice-detail"'
        + '         value="' + esc(current.detail || '') + '" autocomplete="off" />'
        + '</div>';
    }

    return ''
      + '<fieldset class="iv-q iv-fieldset' + (isRecommendation ? ' is-emphasis' : '') + '">'
      + '  <legend class="iv-q-label">' + esc(q.label) + '</legend>'
      + '  <div class="iv-options">'
      + (q.options || []).map(function (o) {
        var id = domId('iv-f', q.key, o.key);
        return ''
          + '<div class="iv-option">'
          + '  <input type="radio" id="' + esc(id) + '" name="iv-' + esc(q.key) + '" value="' + esc(o.key) + '"'
          + '         data-iv-field="' + esc(q.key) + '"'
          + '         data-iv-type="' + (isRecommendation ? 'recommendation' : 'choice') + '"'
          + (chosen === o.key ? ' checked' : '') + ' />'
          + '  <label for="' + esc(id) + '">' + esc(o.label) + '</label>'
          + '</div>';
      }).join('')
      + '  </div>'
      + detailHtml
      + (chosen ? btn('clear-choice', 'Clear selection', { key: q.key, variant: 'link' }) : '')
      + '</fieldset>';
  }

  /**
   * The rating grid.
   *
   * Each row is its own radiogroup with a visible numeral in every option's
   * label, so "Communication — 3" is unambiguous to a reader, a keyboard and a
   * screen reader alike. Never a row of bare circles.
   */
  function fieldRatings(q) {
    var scores = ratingsValue();
    var scale = q.scale || [1, 2, 3, 4, 5];
    return ''
      + '<div class="iv-q iv-ratings">'
      + '  <p class="iv-q-label" id="iv-ratings-h">' + esc(q.label) + '</p>'
      + '  <div class="iv-ratings-grid" role="group" aria-labelledby="iv-ratings-h">'
      + '    <div class="iv-ratings-head" aria-hidden="true"><span></span>'
      + scale.map(function (n) { return '<span>' + esc(n) + '</span>'; }).join('')
      + '    </div>'
      + (q.rows || []).map(function (row) {
        var groupId = domId('iv-rate', row.key);
        return ''
          + '<fieldset class="iv-ratings-row">'
          + '  <legend class="iv-sr-only">' + esc(row.label) + '</legend>'
          + '  <span class="iv-ratings-label" aria-hidden="true">' + esc(row.label) + '</span>'
          + scale.map(function (n) {
            var id = domId(groupId, n);
            return ''
              + '<span class="iv-ratings-cell">'
              + '  <input type="radio" id="' + esc(id) + '" name="' + esc(groupId) + '" value="' + esc(n) + '"'
              + '         data-iv-field="' + esc(q.key) + '" data-iv-type="rating" data-iv-row="' + esc(row.key) + '"'
              + (Number(scores[row.key]) === Number(n) ? ' checked' : '') + ' />'
              + '  <label for="' + esc(id) + '"><span class="iv-sr-only">' + esc(row.label) + ' — </span>'
              + esc(n) + '</label>'
              + '</span>';
          }).join('')
          + '  <button type="button" class="iv-link iv-rate-clear" data-iv="clear-rating"'
          + '          data-key="' + esc(row.key) + '">Clear<span class="iv-sr-only"> the '
          + esc(row.label) + ' rating</span></button>'
          + '</fieldset>';
      }).join('')
      + '  </div>'
      + (q.guide ? '<p class="iv-q-guide">Rating guide: ' + esc(q.guide) + '</p>' : '')
      + '</div>';
  }

  function renderQuestion(q) {
    if (q.type === 'checkboxes') return fieldCheckboxes(q);
    if (q.type === 'choice') return fieldChoice(q);
    if (q.type === 'ratings') return fieldRatings(q);
    if (q.type === 'text' || q.type === 'date') return fieldText(q);
    return fieldLongtext(q);
  }

  function detailsPanel() {
    var r = S.record;
    var readOnly = !r.canEdit;
    return ''
      + '<div class="iv-details" role="group" aria-label="Interview details">'
      + '  <div class="iv-details-grid">'
      + '    <label class="iv-field"><span>Candidate name</span>'
      + '      <input class="iv-input" type="text" data-iv-meta="candidateName"'
      + '             value="' + esc(r.candidateName) + '" autocomplete="off"'
      + (readOnly ? ' readonly' : '') + ' /></label>'
      + '    <label class="iv-field"><span>Interview date</span>'
      + '      <input class="iv-input" type="date" data-iv-meta="interviewDate"'
      + '             value="' + esc(dateInputValue(r.interviewDate)) + '"'
      + (readOnly ? ' readonly' : '') + ' /></label>'
      + '    <label class="iv-field"><span>Interviewer(s)</span>'
      + '      <input class="iv-input" type="text" data-iv-meta="interviewers"'
      + '             value="' + esc(r.interviewers || '') + '" autocomplete="off"'
      + (readOnly ? ' readonly' : '') + ' /></label>'
      + '    <label class="iv-field"><span>Role / position</span>'
      + '      <input class="iv-input" type="text" data-iv-meta="position"'
      + '             value="' + esc(r.position || '') + '" autocomplete="off"'
      + (readOnly ? ' readonly' : '') + ' /></label>'
      + '  </div>'
      + '</div>';
  }

  function sectionStrip() {
    var sections = (S.template && S.template.sections) || [];
    return ''
      + '<nav class="iv-strip" aria-label="Interview sections">'
      + sections.map(function (s) {
        return '<button type="button" class="iv-strip-btn" data-iv="jump" data-key="' + esc(s.key) + '">'
          + esc(s.number + '. ' + (s.shortTitle || s.title)) + '</button>';
      }).join('')
      + '</nav>';
  }

  function recordHeader() {
    var r = S.record;
    var progress = progressOf(S.template, mergedResponses());
    var actions = ''
      + (r.canEdit && r.status !== 'archived'
        ? btn('save', 'Save', { variant: 'ghost' }) + btn('save-exit', 'Save & exit', { variant: 'ghost' })
        : '')
      + (r.canEdit && r.status !== 'completed' && r.status !== 'archived'
        ? btn('complete', 'Complete interview', { variant: 'primary' }) : '')
      + (r.canEdit && r.status === 'completed' ? btn('reopen', 'Reopen', { variant: 'ghost' }) : '')
      + btn('record-pdf', 'Download PDF', { id: r.id, variant: 'ghost' })
      + btn('record-print', 'Print', { id: r.id, variant: 'ghost' });

    return ''
      + '<div class="iv-crumbs">' + btn('library', '← Interview Preparation', { variant: 'ghost' }) + '</div>'
      + '<div class="iv-rec-head">'
      + '  <div class="iv-rec-title">'
      + '    <h1>' + esc(recordTitle(r)) + '</h1>'
      + '    <div class="iv-rec-meta">'
      + chip(r.status)
      + '      <span>' + esc(r.position || 'Position not set') + '</span>'
      + '      <span>' + esc(fmtDate(r.interviewDate)) + '</span>'
      + '      <span>Created by ' + esc(r.createdByName || '—') + '</span>'
      + '      <span id="iv-progress">' + progress.answered + ' of ' + progress.total + ' questions answered</span>'
      + (r.postCompletionEdits
        ? '<span class="iv-flag">Edited after completion (' + esc(r.postCompletionEdits) + ')</span>' : '')
      + '    </div>'
      + '  </div>'
      + '  <div class="iv-rec-actions">' + actions + '</div>'
      + '</div>'
      + '<div class="iv-savebar" id="iv-savebar" role="status" aria-live="polite"></div>'
      + (r.canEdit ? '' : '<p class="iv-readonly-note">This interview was conducted by '
        + esc(r.createdByName || 'another user') + '. You can read, download and print it, but not change it.</p>');
  }

  function recordView() {
    if (!S.record || !S.template) return loadingState('Opening the interview…');
    var sections = S.template.sections || [];
    return ''
      + recordHeader()
      + sectionStrip()
      + '<div class="iv-doc" id="iv-doc">'
      + detailsPanel()
      + sections.map(function (s) {
        return ''
          + '<section class="iv-section" id="iv-sec-' + esc(s.key) + '" aria-labelledby="iv-sec-h-' + esc(s.key) + '">'
          + '  <h2 class="iv-section-bar" id="iv-sec-h-' + esc(s.key) + '">'
          + esc(s.number + '. ' + s.title) + '</h2>'
          + (s.questions || []).map(renderQuestion).join('')
          + (s.signoff && s.signoff.length
            ? '<div class="iv-signoff">' + s.signoff.map(renderQuestion).join('') + '</div>' : '')
          + '</section>';
      }).join('')
      + '</div>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  OWNER — ACCESS DELEGATION
  // ═══════════════════════════════════════════════════════════════════════════

  function accessView() {
    var a = S.access;
    if (!a) return loadingState('Loading access…');

    var group = (a.groups || [])[0] || { label: 'Interview Preparation', description: '', permissions: [] };

    var rows = (a.users || []).map(function (u) {
      var granted = u.granted || [];
      var cells = (a.available || []).map(function (p) {
        var id = domId('iv-perm', u.id, p.replace(/[^a-z_]/gi, '_'));
        return ''
          + '<td class="iv-perm-cell">'
          + '  <div class="iv-option">'
          + '    <input type="checkbox" id="' + esc(id) + '" value="' + esc(p) + '"'
          + '           data-iv-perm="' + esc(u.id) + '"'
          + (granted.indexOf(p) >= 0 ? ' checked' : '')
          + (u.implicit ? ' disabled' : '') + ' />'
          + '    <label for="' + esc(id) + '"><span class="iv-sr-only">'
          + esc((a.labels || {})[p] || p) + ' for ' + esc(u.name) + '</span></label>'
          + '  </div>'
          + '</td>';
      }).join('');
      return ''
        + '<tr>'
        + '  <th scope="row">' + esc(u.name)
        + '    <span class="iv-perm-sub">' + esc(u.email) + ' · ' + esc(u.role) + '</span></th>'
        + cells
        + '  <td>' + (u.implicit
          ? '<span class="iv-perm-implicit">Always has full access</span>'
          : btn('save-access', 'Save', { id: u.id, variant: 'ghost' })) + '</td>'
        + '</tr>';
    }).join('');

    return ''
      + '<div class="iv-crumbs">' + btn('library', '← Interview Preparation', { variant: 'ghost' }) + '</div>'
      + '<div class="iv-hero">'
      + '  <div>'
      + '    <h1>Interview Preparation access</h1>'
      + '    <p>' + esc(group.description) + '</p>'
      + '  </div>'
      + '</div>'
      + '<div class="iv-table-wrap">'
      + '<table class="iv-table iv-perm-table">'
      + '  <thead><tr><th scope="col">Person</th>'
      + (a.available || []).map(function (p) {
        return '<th scope="col">' + esc((a.labels || {})[p] || p) + '</th>';
      }).join('')
      + '  <th scope="col"><span class="iv-sr-only">Save</span></th></tr></thead>'
      + '  <tbody>' + rows + '</tbody>'
      + '</table>'
      + '</div>'
      + '<p class="iv-note">Only administrators can be given Interview Preparation. '
      + 'Clinical and read-only accounts are never offered it — interview records hold recruitment '
      + 'information about people who are not employees.</p>';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  function render() {
    var host = root();
    if (!host) return;

    var html;
    if (S.error) html = errorState(S.error, 'reload');
    else if (S.loading) html = loadingState();
    else if (S.view === 'record') html = recordView();
    else if (S.view === 'preview') html = previewView();
    else if (S.view === 'access') html = accessView();
    else html = libraryView();

    host.innerHTML = html;

    if (S.view === 'record') {
      growAll();
      paintSaveBar();
      observeSections();
    }
  }

  // ── Growing textareas ─────────────────────────────────────────────────────

  /**
   * Grow a textarea to its content.
   *
   * The height is reset to 'auto' first so the box can SHRINK as well as grow
   * (without it, deleting a paragraph leaves the hole behind). scrollHeight is
   * read after that reset, which is the one ordering that reports the content
   * height rather than the current box height.
   */
  function autoGrow(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 56) + 'px';
  }

  function growAll() {
    var host = root();
    if (!host) return;
    Array.prototype.forEach.call(host.querySelectorAll('textarea.iv-answer'), autoGrow);
  }

  // ── Section strip ─────────────────────────────────────────────────────────

  var sectionObserver = null;

  function observeSections() {
    if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }
    if (typeof global.IntersectionObserver !== 'function') return;
    var host = root();
    if (!host) return;
    var sections = Array.prototype.slice.call(host.querySelectorAll('.iv-section'));
    if (!sections.length) return;

    sectionObserver = new global.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var key = String(entry.target.id || '').replace(/^iv-sec-/, '');
        Array.prototype.forEach.call(host.querySelectorAll('.iv-strip-btn'), function (b) {
          b.classList.toggle('is-current', b.getAttribute('data-key') === key);
        });
      });
    }, { rootMargin: '-80px 0px -70% 0px', threshold: 0 });

    sections.forEach(function (s) { sectionObserver.observe(s); });
  }

  // ── Save state ────────────────────────────────────────────────────────────

  function mergedResponses() {
    var out = {};
    var base = (S.record && S.record.responses) || {};
    Object.keys(base).forEach(function (k) { out[k] = base[k]; });
    Object.keys(S.pending).forEach(function (k) {
      if (k.charAt(0) !== '_') out[k] = S.pending[k];
    });
    return out;
  }

  function hasUnsaved() {
    return S.dirty || S.saving
      || Object.keys(S.pending).length > 0
      || Object.keys(S.pendingMeta).length > 0;
  }

  function paintSaveBar() {
    var bar = doc.getElementById('iv-savebar');
    if (!bar) return;
    var text;
    var cls = 'iv-savebar';
    if (S.saveError) { text = S.saveError; cls += ' is-error'; }
    else if (S.saving) { text = 'Saving…'; cls += ' is-busy'; }
    else if (hasUnsaved()) { text = 'Unsaved changes'; cls += ' is-dirty'; }
    else if (S.lastSavedAt) { text = 'Last saved ' + fmtTime(S.lastSavedAt); cls += ' is-saved'; }
    else { text = 'No changes yet'; }
    bar.className = cls;
    bar.textContent = text;
  }

  function markDirty() {
    S.dirty = true;
    S.saveError = null;
    paintSaveBar();
    refreshHeader();     // the answered count moves with the typing, not the save
    scheduleSave();
  }

  function scheduleSave() {
    if (S.saveTimer) global.clearTimeout(S.saveTimer);
    S.saveTimer = global.setTimeout(function () { flush(); }, AUTOSAVE_MS);
  }

  /**
   * Send everything outstanding.
   *
   * Returns true when the record is clean afterwards. Pending changes are
   * cleared only on success — a failed save leaves them queued AND on screen,
   * so the next keystroke, the next flush or an explicit Save retries the
   * whole set rather than silently dropping it.
   */
  async function flush() {
    if (S.saveTimer) { global.clearTimeout(S.saveTimer); S.saveTimer = null; }
    if (!S.record || !S.record.canEdit) return true;
    if (S.saving) return false;
    if (!Object.keys(S.pending).length && !Object.keys(S.pendingMeta).length) {
      S.dirty = false;
      paintSaveBar();
      return true;
    }

    var body = { expectedUpdatedAt: S.record.updatedAt };
    var responses = {};
    var hasResponses = false;
    Object.keys(S.pending).forEach(function (k) {
      if (k === '__ratings') { body.ratings = S.pending[k]; return; }
      if (k === '__recommendation') { body.recommendation = S.pending[k]; return; }
      responses[k] = S.pending[k];
      hasResponses = true;
    });
    if (hasResponses) body.responses = responses;
    Object.keys(S.pendingMeta).forEach(function (k) { body[k] = S.pendingMeta[k]; });

    var sending = S.pending;
    var sendingMeta = S.pendingMeta;
    S.pending = {};
    S.pendingMeta = {};
    S.saving = true;
    S.dirty = false;
    paintSaveBar();

    var res = await api('/records/' + encodeURIComponent(S.record.id), { method: 'PATCH', body: body });
    S.saving = false;

    if (!res.ok) {
      // Re-queue underneath anything typed since, so newer keystrokes win.
      var pending = {};
      Object.keys(sending).forEach(function (k) { pending[k] = sending[k]; });
      Object.keys(S.pending).forEach(function (k) { pending[k] = S.pending[k]; });
      S.pending = pending;
      var meta = {};
      Object.keys(sendingMeta).forEach(function (k) { meta[k] = sendingMeta[k]; });
      Object.keys(S.pendingMeta).forEach(function (k) { meta[k] = S.pendingMeta[k]; });
      S.pendingMeta = meta;
      S.dirty = true;

      if (res.status === 409 && res.details && res.details.error === 'stale') {
        S.saveError = 'This interview changed somewhere else. Your text is still here — reload to merge it.';
      } else {
        S.saveError = res.error + ' Nothing has been lost; it will retry.';
      }
      paintSaveBar();
      return false;
    }

    // Adopt the server's record for identity and timestamps, but never let it
    // overwrite text the interviewer has typed since the request left.
    var fresh = res.record;
    fresh.responses = fresh.responses || {};
    S.record = fresh;
    S.lastSavedAt = fresh.updatedAt || new Date().toISOString();
    S.saveError = null;
    paintSaveBar();
    refreshHeader();
    return !Object.keys(S.pending).length && !Object.keys(S.pendingMeta).length;
  }

  /**
   * Refresh the header in place after a save.
   *
   * Targeted writes rather than a re-render: rebuilding the document would
   * unmount every textarea and take the interviewer's cursor with it. Only
   * the three things a save can change are touched — the status chip, the
   * title (the candidate's name is editable) and the answered count.
   */
  function refreshHeader() {
    var host = root();
    if (!host || !S.record) return;

    var chipEl = host.querySelector('.iv-rec-meta .iv-chip');
    if (chipEl) {
      chipEl.className = 'iv-chip is-' + S.record.status;
      chipEl.textContent = statusLabel(S.record.status);
    }

    var h1 = host.querySelector('.iv-rec-title h1');
    if (h1) h1.textContent = recordTitle(S.record);

    var progressEl = doc.getElementById('iv-progress');
    if (progressEl) {
      var progress = progressOf(S.template, mergedResponses());
      progressEl.textContent = progress.answered + ' of ' + progress.total + ' questions answered';
    }
  }

  // ── Field capture ─────────────────────────────────────────────────────────

  function captureCheckboxes(key) {
    var host = root();
    var safe = selectorKey(key);
    var boxes = (host && safe)
      ? host.querySelectorAll('input[type="checkbox"][data-iv-field="' + safe + '"]') : [];
    var out = [];
    Array.prototype.forEach.call(boxes, function (b) { if (b.checked) out.push(b.value); });
    return out;
  }

  function currentChoice(key) {
    var value = answerOf(key);
    return (value && typeof value === 'object') ? { option: value.option || null, detail: value.detail || '' }
      : { option: null, detail: '' };
  }

  function onFieldChange(el) {
    if (!S.record || !S.record.canEdit) return;
    var key = el.getAttribute('data-iv-field');
    var type = el.getAttribute('data-iv-type');
    if (!key) return;

    if (type === 'longtext' || type === 'text' || type === 'date') {
      S.pending[key] = el.value;
    } else if (type === 'checkboxes') {
      S.pending[key] = captureCheckboxes(key);
    } else if (type === 'choice') {
      var choice = currentChoice(key);
      choice.option = el.value;
      S.pending[key] = choice;
      var wrap = doc.getElementById(domId('iv-f', key, 'detail-wrap'));
      if (wrap) {
        var opts = (findQuestion(key) || {}).options || [];
        var detailKey = (opts.filter(function (o) { return o.detail; })[0] || {}).key;
        wrap.classList.toggle('is-open', el.value === detailKey);
      }
    } else if (type === 'choice-detail') {
      var withDetail = currentChoice(key);
      withDetail.detail = el.value;
      S.pending[key] = withDetail;
    } else if (type === 'recommendation') {
      S.pending.__recommendation = el.value;
    } else if (type === 'rating') {
      var row = el.getAttribute('data-iv-row');
      var scores = {};
      var current = ratingsValue();
      Object.keys(current).forEach(function (k) { scores[k] = current[k]; });
      scores[row] = Number(el.value);
      S.pending.__ratings = scores;
    } else {
      return;
    }
    markDirty();
  }

  function findQuestion(key) {
    var found = null;
    eachQuestion(S.template, function (q) { if (q.key === key) found = q; });
    return found;
  }

  function onMetaChange(el) {
    if (!S.record || !S.record.canEdit) return;
    var key = el.getAttribute('data-iv-meta');
    if (!key) return;
    S.pendingMeta[key] = el.value;
    markDirty();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  async function loadLibrary() {
    S.loading = true; S.error = null; render();
    var cat = await api('/templates');
    // The user may have moved on while the request was in flight (switchTab's
    // post-dispatch calls open(), and a deep link to a record or a preview can
    // land immediately after). Painting the library over them would replace
    // the screen they actually asked for.
    if (S.view !== 'library') { S.loading = false; return; }
    if (!cat.ok) {
      S.loading = false;
      S.error = cat.status === 403
        ? 'You do not have access to Interview Preparation. Please contact the practice owner if you believe this is incorrect.'
        : cat.error;
      render();
      return;
    }
    S.templates = cat.templates || [];
    S.upcoming = cat.upcoming || [];
    S.capabilities = cat.capabilities || {};
    await loadRecords(true);
    S.loading = false;
    if (S.view !== 'library') return;
    render();
  }

  async function loadRecords(silent) {
    var qs = [];
    if (S.filters.q) qs.push('q=' + encodeURIComponent(S.filters.q));
    if (S.filters.status) qs.push('status=' + encodeURIComponent(S.filters.status));
    var res = await api('/records' + (qs.length ? '?' + qs.join('&') : ''));
    if (!res.ok) {
      if (!silent) toast(res.error, true);
      return;
    }
    S.records = res.records || [];
    S.scope = res.scope || 'own';
    if (!silent) render();
  }

  function open() {
    ensureVisible();
    if (S.view === 'record' && S.record) return;   // already showing an interview
    S.view = 'library';
    loadLibrary();
  }

  async function openPreview(key) {
    ensureVisible();
    S.view = 'preview'; S.preview = null; S.error = null; render();
    var res = await api('/templates/' + encodeURIComponent(key));
    if (!res.ok) { S.error = res.error; render(); return; }
    S.preview = res.template;
    render();
  }

  /**
   * Start an interview.
   *
   * A small dialog rather than a prompt(): four fields are what the record
   * needs to be findable and to print correctly, and three of them already
   * have a right answer — today, the signed-in user, the template's own
   * default position. The interviewer confirms or changes them in one place
   * instead of discovering them scattered through the document later.
   */
  function startInterview(key) {
    var template = S.templates.filter(function (t) { return t.key === key; })[0]
      || (S.preview && S.preview.key === key ? S.preview : null);
    var me = (global.APP_USER && (global.APP_USER.displayName || global.APP_USER.name)) || '';

    openModal({
      title: 'Start interview',
      subtitle: template ? template.name : 'New interview',
      body: ''
        + '<div class="iv-modal-grid">'
        + '  <label class="iv-field"><span>Applicant name</span>'
        + '    <input class="iv-input" type="text" name="candidateName" required'
        + '           autocomplete="off" placeholder="Full name" /></label>'
        + '  <label class="iv-field"><span>Interview date</span>'
        + '    <input class="iv-input" type="date" name="interviewDate"'
        + '           value="' + esc(dateInputValue(new Date())) + '" /></label>'
        + '  <label class="iv-field"><span>Interviewer(s)</span>'
        + '    <input class="iv-input" type="text" name="interviewers"'
        + '           value="' + esc(me) + '" autocomplete="off" /></label>'
        + '  <label class="iv-field"><span>Role / position</span>'
        + '    <input class="iv-input" type="text" name="position"'
        + '           value="' + esc(template ? (template.defaultPosition || '') : '') + '"'
        + '           autocomplete="off" /></label>'
        + '</div>'
        + '<p class="iv-note">Everything here can be changed inside the interview. '
        + 'Answers save as you type.</p>',
      footer: btn('modal-cancel', 'Cancel', { variant: 'ghost' })
        + btn('modal-start', 'Start interview', { key: key, variant: 'primary' }),
    });
  }

  async function submitStart(key) {
    var v = modalValues();
    var name = String(v.candidateName || '').trim();
    if (!name) { modalError('An applicant name is needed to start an interview.'); return; }

    var res = await api('/records', {
      method: 'POST',
      body: {
        templateKey: key,
        candidateName: name,
        interviewDate: v.interviewDate || undefined,
        interviewers: v.interviewers || undefined,
        position: v.position || undefined,
      },
    });
    if (!res.ok) { modalError(res.error); return; }
    closeModal();
    adoptRecord(res.record);
    toast('Interview started for ' + name);
    syncRoute();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────

  var _modalReturnFocus = null;

  function modalHost() {
    var host = doc.getElementById('iv-modal-host');
    if (!host) {
      host = doc.createElement('div');
      host.id = 'iv-modal-host';
      host.className = 'iv-modal-host';
      host.setAttribute('role', 'dialog');
      host.setAttribute('aria-modal', 'true');
      var view = doc.getElementById('view-interviews') || doc.body;
      view.appendChild(host);
    }
    return host;
  }

  function openModal(opts) {
    var host = modalHost();
    _modalReturnFocus = doc.activeElement;
    host.setAttribute('aria-labelledby', 'iv-modal-title');
    host.innerHTML = ''
      + '<div class="iv-modal">'
      + '  <div class="iv-modal-head">'
      + '    <div>'
      + '      <h2 id="iv-modal-title">' + esc(opts.title) + '</h2>'
      + (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '')
      + '    </div>'
      + '    <button type="button" class="iv-modal-close" data-iv="modal-cancel" aria-label="Close">&times;</button>'
      + '  </div>'
      + '  <div class="iv-modal-body" id="iv-modal-body">' + (opts.body || '') + '</div>'
      + (opts.footer ? '<div class="iv-modal-foot">' + opts.footer + '</div>' : '')
      + '</div>';
    host.classList.add('open');

    var first = host.querySelector('input, select, textarea, button:not(.iv-modal-close)');
    if (first) first.focus(); else host.querySelector('.iv-modal-close').focus();
  }

  function closeModal() {
    var host = doc.getElementById('iv-modal-host');
    if (!host) return;
    host.classList.remove('open');
    host.innerHTML = '';
    if (_modalReturnFocus && _modalReturnFocus.focus) _modalReturnFocus.focus();
    _modalReturnFocus = null;
  }

  function modalError(message) {
    var body = doc.getElementById('iv-modal-body');
    if (!body) { toast(message, true); return; }
    var existing = body.querySelector('.iv-note.is-danger');
    if (existing) existing.remove();
    var el = doc.createElement('div');
    el.className = 'iv-note is-danger';
    el.setAttribute('role', 'alert');
    el.textContent = message;
    body.insertBefore(el, body.firstChild);
    body.scrollTop = 0;
  }

  /** Read every named field inside the open modal. */
  function modalValues() {
    var body = doc.getElementById('iv-modal-body');
    var out = {};
    if (!body) return out;
    Array.prototype.forEach.call(body.querySelectorAll('[name]'), function (el) {
      if (el.type === 'checkbox') out[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
      else out[el.name] = el.value;
    });
    return out;
  }

  // Escape closes; Tab is trapped inside the dialog while it is open.
  doc.addEventListener('keydown', function (e) {
    var host = doc.getElementById('iv-modal-host');
    if (!host || !host.classList.contains('open')) return;
    if (e.key === 'Escape') { closeModal(); return; }
    if (e.key !== 'Tab') return;
    var focusable = host.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function adoptRecord(record) {
    S.record = record;
    S.template = record.template;
    S.pending = {};
    S.pendingMeta = {};
    S.dirty = false;
    S.saving = false;
    S.saveError = null;
    S.lastSavedAt = null;
    S.view = 'record';
    S.error = null;
    render();
  }

  async function openRecord(id) {
    ensureVisible();
    if (S.record && S.record.id === id && S.view === 'record') return;
    S.view = 'record'; S.record = null; S.template = null; S.error = null;
    S.loading = true; render();
    var res = await api('/records/' + encodeURIComponent(id));
    S.loading = false;
    if (!res.ok) {
      S.error = res.status === 404
        ? 'That interview no longer exists, or is not one you can see.'
        : res.error;
      render();
      return;
    }
    adoptRecord(res.record);
    syncRoute();
  }

  async function backToLibrary(skipFlush) {
    if (!skipFlush && hasUnsaved()) {
      var saved = await flush();
      if (!saved) {
        var leave = global.confirm(
          'Some changes have not saved yet. Leave the interview anyway?\n\n'
          + 'Nothing typed is deleted — but unsaved text will not be in the record.');
        if (!leave) return;
      }
    }
    S.view = 'library';
    S.record = null;
    S.template = null;
    S.pending = {};
    S.pendingMeta = {};
    if (sectionObserver) { sectionObserver.disconnect(); sectionObserver = null; }
    render();
    loadRecords(false);
    syncRoute();
  }

  async function saveNow(andExit) {
    var ok = await flush();
    if (!ok) { toast(S.saveError || 'Save failed', true); return; }
    toast('Interview saved');
    if (andExit) backToLibrary(true);
  }

  async function completeInterview() {
    await flush();
    var progress = progressOf(S.template, mergedResponses());
    var blank = progress.total - progress.answered;
    if (blank > 0) {
      var proceed = global.confirm(
        blank + ' of ' + progress.total + ' questions are still blank.\n\n'
        + 'Completing an interview with blank questions is fine — this is a note-taking tool, not a form. '
        + 'Complete it now?');
      if (!proceed) return;
    }
    var res = await api('/records/' + encodeURIComponent(S.record.id) + '/complete', { method: 'POST' });
    if (!res.ok) {
      if (res.status === 422 && res.details && res.details.missing) {
        toast(res.error, true);
      } else {
        toast(res.error, true);
      }
      return;
    }
    S.record = res.record;
    toast('Interview completed');
    render();
  }

  async function reopenInterview() {
    var res = await api('/records/' + encodeURIComponent(S.record.id) + '/reopen', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    S.record = res.record;
    toast('Interview reopened — later changes are recorded as edits after completion.');
    render();
  }

  async function archiveRecord(id) {
    if (!global.confirm('Archive this interview? It stays readable and can be restored at any time.')) return;
    var res = await api('/records/' + encodeURIComponent(id) + '/archive', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Interview archived');
    if (S.view === 'record') { backToLibrary(true); } else { loadRecords(false); }
  }

  async function restoreRecord(id) {
    var res = await api('/records/' + encodeURIComponent(id) + '/restore', { method: 'POST' });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Interview restored');
    loadRecords(false);
  }

  async function deleteRecord(id) {
    var row = S.records.filter(function (r) { return r.id === id; })[0];
    var who = row ? row.candidateName : 'this applicant';
    if (!global.confirm('Permanently delete the interview record for ' + who + '?\n\n'
      + 'This cannot be undone. Archive it instead if you may need it later.')) return;
    var res = await api('/records/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!res.ok) { toast(res.error, true); return; }
    toast('Interview deleted');
    loadRecords(false);
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  /**
   * A plain navigation to an authenticated endpoint — the browser handles the
   * Content-Disposition. No candidate detail ever goes in a query string, and
   * no shareable URL is produced: the endpoint checks the session and the
   * caller's permission on every request.
   */
  function download(path) {
    global.location.href = path;
  }

  /**
   * Print the SAME document that downloads.
   *
   * The PDF is opened inline in a new tab and printed from the browser's own
   * viewer, so what comes out of the printer is the generated document —
   * identical pagination, identical branding — rather than a screen-styled
   * approximation of it. Nothing of the portal (nav, buttons, sidebars) can
   * appear on the page, because the page is not the portal.
   */
  function printDocument(path) {
    var url = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'disposition=inline';
    var w = global.open(url, '_blank');
    if (!w) { toast('Allow pop-ups for this site to print, or download the PDF instead.', true); return; }
    try {
      w.addEventListener('load', function () { try { w.print(); } catch (_) { /* the viewer prints */ } });
    } catch (_) { /* cross-document access refused — the user prints from the tab */ }
  }

  // ── Owner access panel ────────────────────────────────────────────────────

  async function openAccess() {
    ensureVisible();
    S.view = 'access'; S.access = null; S.error = null; render();
    var res = await api('/permissions');
    if (!res.ok) { S.error = res.error; render(); return; }
    S.access = res;
    render();
  }

  async function saveAccess(userId) {
    var host = root();
    if (!host) return;
    var safeUser = selectorId(userId);
    if (!safeUser) return;
    var boxes = host.querySelectorAll('input[data-iv-perm="' + safeUser + '"]');
    var perms = [];
    Array.prototype.forEach.call(boxes, function (b) { if (b.checked) perms.push(b.value); });
    var res = await api('/permissions/' + encodeURIComponent(userId), {
      method: 'PUT', body: { permissions: perms },
    });
    if (!res.ok) { toast(res.error, true); return; }
    toast(perms.length ? 'Interview Preparation access updated' : 'Interview Preparation access revoked');
    openAccess();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  EVENTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Is this node one of ours?
   *
   * The delegated listeners are on `document`, so they must refuse anything
   * outside this module — otherwise a data-iv attribute elsewhere in the
   * portal would drive it. The modal host is a sibling of #iv-root rather
   * than a child (it is position:fixed, and a fixed element inside a
   * transformed or scrolled panel positions against the wrong box), so it is
   * named explicitly here rather than being caught by the root test.
   */
  function inRoot(node) {
    if (!node) return false;
    var host = root();
    if (host && host.contains(node)) return true;
    var modal = doc.getElementById('iv-modal-host');
    return !!(modal && modal.contains(node));
  }

  doc.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-iv]');
    if (!t || !inRoot(t)) return;
    var action = t.getAttribute('data-iv');
    var id = t.getAttribute('data-id');
    var key = t.getAttribute('data-key');

    if (action === 'library') return void backToLibrary();
    if (action === 'reload') return void loadLibrary();
    if (action === 'preview') return void openPreview(key);
    if (action === 'start') return void startInterview(key);
    if (action === 'open' || action === 'continue') return void openRecord(id);
    if (action === 'save') return void saveNow(false);
    if (action === 'save-exit') return void saveNow(true);
    if (action === 'complete') return void completeInterview();
    if (action === 'reopen') return void reopenInterview();
    if (action === 'archive') return void archiveRecord(id);
    if (action === 'restore') return void restoreRecord(id);
    if (action === 'delete') return void deleteRecord(id);
    if (action === 'access') return void openAccess();
    if (action === 'save-access') return void saveAccess(id);
    if (action === 'modal-cancel') return void closeModal();
    if (action === 'modal-start') return void submitStart(key);

    if (action === 'blank-pdf') return void download(API + '/templates/' + encodeURIComponent(key) + '/pdf');
    if (action === 'blank-print') return void printDocument(API + '/templates/' + encodeURIComponent(key) + '/pdf');
    if (action === 'record-pdf') return void download(API + '/records/' + encodeURIComponent(id) + '/pdf');
    if (action === 'record-print') return void printDocument(API + '/records/' + encodeURIComponent(id) + '/pdf');

    if (action === 'clear-filters') {
      S.filters = { q: '', status: 'active' };
      loadRecords(false);
      return;
    }

    if (action === 'jump') {
      var section = doc.getElementById('iv-sec-' + key);
      if (section && section.scrollIntoView) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (action === 'clear-choice') {
      var host = root();
      var safeField = selectorKey(key);
      if (host && safeField) {
        Array.prototype.forEach.call(
          host.querySelectorAll('input[type="radio"][data-iv-field="' + safeField + '"]'),
          function (radio) { radio.checked = false; }
        );
      }
      var q = findQuestion(key);
      if (q && q.emphasis) S.pending.__recommendation = null;
      else S.pending[key] = { option: null, detail: '' };
      markDirty();
      render();
      return;
    }

    if (action === 'clear-rating') {
      var scores = {};
      var current = ratingsValue();
      Object.keys(current).forEach(function (k) { if (k !== key) scores[k] = current[k]; });
      S.pending.__ratings = scores;
      var group = doc.getElementsByName(domId('iv-rate', key));
      Array.prototype.forEach.call(group || [], function (r) { r.checked = false; });
      markDirty();
    }
  });

  doc.addEventListener('input', function (e) {
    var el = e.target;
    if (!inRoot(el)) return;
    if (el.matches && el.matches('textarea.iv-answer')) autoGrow(el);
    if (el.getAttribute && el.getAttribute('data-iv-field')) return void onFieldChange(el);
    if (el.getAttribute && el.getAttribute('data-iv-meta')) return void onMetaChange(el);
  });

  doc.addEventListener('change', function (e) {
    var el = e.target;
    if (!inRoot(el)) return;
    if (el.getAttribute && el.getAttribute('data-iv-field')) return void onFieldChange(el);
    if (el.getAttribute && el.getAttribute('data-iv-meta')) return void onMetaChange(el);

    var filter = el.getAttribute && el.getAttribute('data-iv-filter');
    if (filter) {
      S.filters[filter] = el.value;
      loadRecords(false);
    }
  });

  /* Leaving a field is a natural save point: it makes the "Last saved" line
     truthful the moment attention moves, rather than 1.2s later. */
  doc.addEventListener('focusout', function (e) {
    if (!inRoot(e.target)) return;
    if (!S.record || S.view !== 'record') return;
    if (!hasUnsaved()) return;
    flush();
  });

  /* The unload guard is armed ONLY while something is genuinely unsaved. A
     user who paused long enough for autosave to land is never prompted. */
  global.addEventListener('beforeunload', function (e) {
    if (S.view !== 'record' || !S.record || !hasUnsaved()) return undefined;
    e.preventDefault();
    e.returnValue = '';
    return '';
  });

  // ── Portal navigation ─────────────────────────────────────────────────────

  function syncRoute() {
    if (global.OpalNav && typeof global.OpalNav.pushInterview === 'function') {
      try { global.OpalNav.pushInterview(currentRecordId()); }
      catch (_) { /* routing must never block the UI */ }
    }
  }

  /** navigation.js reads this to keep the address bar on the open record. */
  function currentRecordId() {
    return (S.view === 'record' && S.record) ? S.record.id : null;
  }

  /*
     Switching tabs while an interview is open must not silently strand
     unsaved text. The same self-installing switchTab wrapper assessment.js
     uses: flush first, let the navigation proceed either way — a save that
     is still in flight completes on its own, and the record is on the list
     to resume.
  */
  function hookSwitchTab() {
    var orig = global.switchTab;
    if (typeof orig !== 'function' || orig.__ivHooked) return;
    var wrapped = function (name) {
      if (name !== 'interviews' && S.view === 'record' && hasUnsaved()) {
        try { flush(); } catch (_) { /* leaving must never block nav */ }
      }
      return orig.apply(this, arguments);
    };
    wrapped.__ivHooked = true;
    global.switchTab = wrapped;
  }

  (function retryHook(attempt) {
    hookSwitchTab();
    if (global.switchTab && global.switchTab.__ivHooked) return;
    if ((attempt || 0) < 40) global.setTimeout(function () { retryHook((attempt || 0) + 1); }, 150);
  })(0);

  // ── Public surface ────────────────────────────────────────────────────────

  global.Interviews = {
    open: open,
    openRecord: openRecord,
    openPreview: openPreview,
    openAccess: openAccess,
    back: backToLibrary,
    reload: loadLibrary,
    currentRecordId: currentRecordId,
    closeModal: closeModal,
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
