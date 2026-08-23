/* ═══════════════════════════════════════════════════════════════════════════
   OPAL SERVICE AGREEMENTS — front end for the participant service agreement
   workflow.

   CANONICAL HOME: Templates → Service Agreement, addressed as
   #resources/service-agreement. The Templates collection is where the FCA
   report and the progress-note letter already live, so it is where a person
   looks for the thing that builds a document. resourcehub.js renders the card
   in that grid; everything else renders into #sva-root from here.

   ONE WAY IN. The card, a restored deep link and a contextual "Create service
   agreement" on a participant record all call SVA.route(). There is
   deliberately no second entry point and no second dashboard: two places to
   manage the same master is how two masters get published.

   Conventions (mirrors fca.js / letter.js / resourcehub.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - no raw-HTML passthrough anywhere; every server string renders as text
     - delegated data-sva click/input handlers — no inline onclick carrying a
       server-supplied id into an attribute
     - pure helpers exported for node tests
     - the backend enforces every boundary; the client only reflects it

   NON-NEGOTIABLES ENCODED HERE:

     1. THE SERVER COMPOSES THE DOCUMENT; THIS FILE ONLY SHOWS IT. The preview
        is rendered from GET /:id/preview, which returns the blocks of the
        REAL composed Word document. There is deliberately no clause list, no
        field list and no layout in this file. A locally-assembled preview
        would be a different document from the one the participant receives,
        which is the exact failure this design exists to prevent.

     2. FIELD AUTHORITY IS THE SERVER'S. Fields arrive from the server with an
        `authority`, and only 'portal' fields are rendered as inputs. The
        client does not decide that a signature is not typeable — it renders
        what it is given, and the server discards anything else regardless.

     3. WORD IS OWNER-ONLY, AND THE BUTTON IS NOT THE CONTROL. The Word
        actions are hidden unless the server said canDownloadWord. Hiding them
        is a courtesy to staff; the route refuses them anyway.

     4. NOTHING IS INVENTED. A value the portal could not resolve renders as an
        explicit "Not recorded" state carrying its own explanation. There is
        not one '|| fallback' to plausible text in this file.
   ═══════════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ── Pure helpers (defined before any DOM access so node can require this) ──

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function el(id) { return doc.getElementById(id); }

  /** Human label for an agreement state. The server sends the raw state. */
  var STATE_LABELS = {
    draft: 'Draft',
    ready: 'Ready to issue',
    issued: 'Issued',
    viewed: 'Viewed by participant',
    partially_completed: 'Partly completed',
    completed: 'Completed',
    signed: 'Signed',
    expired: 'Expired',
    revoked: 'Revoked',
    'void': 'Void'
  };
  function stateLabel(s) { return STATE_LABELS[s] || 'Draft'; }

  /** Where a value came from, in words a person can act on. */
  var SOURCE_LABELS = {
    splose: 'From the client record',
    client_profile: 'From the Opal client profile',
    ndis_plan: 'From the current NDIS plan',
    organisation_settings: 'From your practice details',
    portal_user: 'From your Opal profile',
    manual: 'You typed this',
    server: 'Issued by Opal',
    esign: 'From the signature',
    supports: 'From the supports schedule',
    portal: 'Entered for this agreement'
  };
  function sourceLabel(s) { return SOURCE_LABELS[s] || ''; }

  /** The wizard's steps, in order. Titles only — the fields come from the server. */
  var STEPS = [
    { key: 'participant', title: 'Participant and representative', groups: ['participant', 'representative'] },
    { key: 'plan', title: 'Plan and funding', groups: ['plan', 'funding'] },
    { key: 'supports', title: 'Supports, rates and delivery', groups: ['supports'] },
    { key: 'preferences', title: 'Communication, access and continuity', groups: ['preferences'] },
    { key: 'consents', title: 'Consents and information sharing', groups: ['consents'] },
    { key: 'provider', title: 'Provider and agreement details', groups: ['agreement', 'organisation', 'signature'] },
    { key: 'method', title: 'Completion method', groups: [] },
    { key: 'issue', title: 'Preview and issue', groups: [] }
  ];

  /**
   * Which actions the template surface offers, given the SERVER's answer.
   *
   * Extracted and pure so there is exactly one place that decides, and so the
   * decision can be tested without a browser. The inputs are the two flags the
   * server sends on every load — the client never infers them from a role.
   *
   *   use-template   everybody who can reach the surface at all
   *   manage-master  owner holding service_agreements.manage_master
   *   master-word    owner (a .docx is editable; staff get PDF)
   *   master-pdf     everybody — it is the participant-facing preview
   *   versions       owner holding the master permission
   *
   * Hiding an action is a courtesy. Every one of these opens a route that
   * enforces the same rule server-side, which is the actual control.
   */
  function visibleActions(flags) {
    var f = flags || {};
    var out = ['use-template'];
    if (f.canManageMaster) out.push('manage-master');
    if (f.canWord) out.push('master-word');
    if (f.canManageMaster || f.canWord) out.push('master-pdf');
    if (f.canManageMaster) out.push('versions');
    return out;
  }

  function renderBlock(b) {
    if (b.type === 'spacer') return '<div class="sva-doc-space"></div>';
    if (b.type === 'heading') {
      var lvl = Math.min(4, Math.max(1, (b.level || 1) + 1));
      return '<h' + lvl + ' class="sva-doc-h sva-doc-h' + (b.level || 1) + '">'
        + esc(b.text) + '</h' + lvl + '>';
    }
    if (b.type === 'list') {
      return '<p class="sva-doc-li">' + runsHtml(b.runs) + '</p>';
    }
    if (b.type === 'table') {
      return '<table class="sva-doc-table"><tbody>' + (b.rows || []).map(function (r) {
        return '<tr' + (r.header ? ' class="hdr"' : '') + '>' + (r.cells || []).map(function (c) {
          var tag = r.header ? 'th' : 'td';
          return '<' + tag + '>' + (c.paragraphs || []).map(runsHtml).join('<br>') + '</' + tag + '>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table>';
    }
    return '<p class="sva-doc-p' + (b.emphasis ? ' em' : '') + (b.small ? ' sm' : '') + '">'
      + runsHtml(b.runs) + '</p>';
  }

  /** Runs render as TEXT. A field renders as a visible blank, never an input. */
  function runsHtml(runs) {
    return (runs || []).map(function (r) {
      if (r.type === 'field') {
        return '<span class="sva-doc-field" title="' + esc(r.prompt) + '">'
          + esc(r.prompt) + '</span>';
      }
      var t = esc(r.text);
      if (r.bold) t = '<strong>' + t + '</strong>';
      if (r.italic) t = '<em>' + t + '</em>';
      return t;
    }).join('');
  }


  // ══ NODE EXPORT ══════════════════════════════════════════════════════════
  // Everything above is pure. The surface-guard test requires this file
  // directly, so the helpers are published before any DOM access happens.

  var helpers = {
    esc: esc,
    stateLabel: stateLabel,
    sourceLabel: sourceLabel,
    runsHtml: runsHtml,
    renderBlock: renderBlock,
    visibleActions: visibleActions,
    STEPS: STEPS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;

  // node / test environments stop here — everything below needs a browser.
  var doc = global && global.document;
  if (!doc) return;

  // ══ STATE ════════════════════════════════════════════════════════════════

  var S = {
    view: null,            // null | 'wizard' | 'master'
    step: 0,
    agreement: null,
    fields: [],
    master: null,
    settings: null,
    canEdit: false,
    canWord: false,
    canManageMaster: false,
    list: null,
    listLoading: false,
    preview: null,
    previewLoading: false,
    busy: false,
    error: null,
    notice: null,
    clients: null,
    clientQuery: '',
    dirty: false,
    saving: false,
    versions: null,
    clauseCatalogue: null,
    clauseSnapshot: null,
    accessDenied: false,
    viewAll: false,
    menuOpen: false
  };

  // ══ API ══════════════════════════════════════════════════════════════════

  async function api(path, opts) {
    var o = opts || {};
    var init = { method: o.method || 'GET', credentials: 'include', headers: {} };
    if (o.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(o.body);
    }
    try {
      var r = await fetch(path, init);
      var data = await r.json().catch(function () { return {}; });
      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          error: data.error ? String(data.error) : ('Request failed (' + r.status + ')'),
          missing: data.missing,
          errors: data.errors,
          validation: data.validation
        };
      }
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, status: 0, error: 'Network error — your work is still here. Please try again.' };
    }
  }

  // ══ THE TEMPLATE SURFACE ═════════════════════════════════════════════════
  //
  // Templates → Service Agreement is the CANONICAL home of this workflow.
  // Everything below renders into #sva-root behind
  // #resources/service-agreement[/<what>], and there is exactly one of it:
  // the card in the Templates grid, a contextual "create" action on a
  // participant record and a pasted link all arrive here.

  function icn(name) {
    var paths = {
      doc: '<path d="M6 2h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M13 2v5h5"/>',
      plus: '<path d="M12 5v14M5 12h14"/>',
      check: '<path d="M20 6L9 17l-5-5"/>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
      + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + (paths[name] || paths.doc) + '</svg>';
  }

  /**
   * The one entry point. `what` is the route's id segment:
   *   ''          the template overview
   *   'new'       the creation wizard
   *   'master'    the owner's master console
   *   'versions'  master version history
   *   <uuid>      one agreement
   *
   * Called by the Templates card, by navigation.js when a route is restored,
   * and by any contextual shortcut on a participant record. There is no second
   * way in, which is what keeps "one canonical location" true.
   */
  async function route(what, opts) {
    var id = String(what || '').trim();
    if (!id) return openOverview(opts);
    if (id === 'new') return startNew(opts);
    if (id === 'master' || id === 'versions') return openMaster(id === 'versions');
    return openAgreement(id);
  }

  /** Write the canonical address without re-entering the router. */
  function setHash(what) {
    if (!global.history || !global.history.replaceState) return;
    var target = '#resources/service-agreement' + (what ? '/' + encodeURIComponent(what) : '');
    if (global.location.hash !== target) {
      try { global.history.pushState(null, '', target); } catch (e) { /* address only */ }
    }
  }

  async function openOverview(opts) {
    S.view = 'overview';
    S.error = null;
    if (!opts || opts.keepNotice !== true) S.notice = null;
    render();
    if (!opts || opts.silent !== true) setHash('');
    await loadOverview();
  }

  /**
   * Load everything the overview shows.
   *
   * The counts come from the agreement list the server already scopes for this
   * user: a delegate without `view_all` counts THEIR drafts, an owner counts
   * the practice's. The client never computes who may see what.
   */
  async function loadOverview() {
    S.listLoading = true;
    render();

    var res = await api('/api/service-agreements');
    S.listLoading = false;

    if (!res.ok) {
      // 403 is the honest answer for somebody the Owner has not authorised.
      // The Templates card is permission-gated too, so reaching this means a
      // pasted link — say so rather than showing an empty screen.
      S.list = [];
      S.accessDenied = res.status === 403;
      S.error = res.status === 403 ? null : res.error;
      render();
      return;
    }

    S.accessDenied = false;
    S.list = res.agreements || [];
    S.viewAll = res.viewAll === true;

    var m = await api('/api/service-agreements/master');
    if (m.ok) {
      S.master = m.master;
      S.settings = m.settings;
      S.canManageMaster = m.canManageMaster === true;
      S.canWord = m.canDownloadWord === true;
    }
    render();
  }

  /** Agreements grouped the way the overview lists them. */
  function buckets(list) {
    var rows = list || [];
    var inState = function (states) {
      return rows.filter(function (a) { return states.indexOf(a.state) !== -1; });
    };
    return {
      drafts: inState(['draft', 'ready']),
      awaiting: inState(['issued', 'viewed', 'partially_completed']),
      issued: inState(['issued', 'viewed', 'partially_completed', 'completed', 'signed']),
      completed: inState(['completed', 'signed']),
      closed: inState(['expired', 'revoked', 'void'])
    };
  }

  function renderOverview() {
    if (S.accessDenied) {
      return shell('Service Agreement',
        '<section class="sva-step"><h3>You do not have access to Service Agreements</h3>'
        + '<p class="sva-quiet">Ask the practice owner to grant you Service Agreements access. '
        + 'Until then this template is not available to you.</p></section>', '');
    }

    var b = buckets(S.list);
    var master = S.master;
    var settingsWarning = (S.settings && S.settings.complete === false)
      ? '<div class="sva-alert sva-alert-error">Your practice details are incomplete'
        + (S.canManageMaster ? ': ' + esc((S.settings.missing || []).join(', ')) : '')
        + '. Service agreements cannot be created until the owner completes them.</div>'
      : '';

    // ── The header every role sees ─────────────────────────────────────────
    var head =
      '<section class="sva-tpl-head">'
      + '<div class="sva-tpl-headmain">'
      + '<span class="sva-entry-icn" aria-hidden="true">' + icn('doc') + '</span>'
      + '<div>'
      + '<h3>Service Agreement</h3>'
      + '<p class="sva-entry-sub">Create, complete and issue an Opal Therapy Service Agreement '
      + 'using participant and portal information.</p>'
      + '<p class="sva-tpl-meta">'
      + '<span class="sva-chip">Agreements and forms</span>'
      + (master
        ? '<span class="sva-chip sva-chip-ok">Published v' + esc(master.versionLabel) + '</span>'
          + '<span class="sva-tpl-date">Updated '
          + esc(String(master.publishedAt || master.createdAt || '').slice(0, 10)) + '</span>'
        : '<span class="sva-chip">Loading…</span>')
      + '</p>'
      + '</div>'
      + '<div class="sva-entry-actions">'
      + '<button type="button" class="sva-btn sva-btn-primary" data-sva="new">'
      + icn('plus') + ' Use template</button>'
      + (S.canManageMaster
        ? '<button type="button" class="sva-btn sva-btn-ghost" data-sva="master">Manage master</button>'
        : '')
      + (S.canManageMaster || S.canWord ? renderOverflow() : '')
      + '</div>'
      + '</div>'
      + '</section>';

    // ── The lists. An individual agreement is never called a template. ─────
    var lists =
      agreementList('Draft agreements', b.drafts,
        'Agreements you have started. Nothing has been sent to a participant yet.')
      + agreementList('Awaiting participant', b.awaiting,
        'Issued and waiting on the participant to complete or sign.')
      + agreementList('Completed and signed', b.completed,
        'Signed agreements, kept on file.')
      + (b.closed.length
        ? agreementList('Expired, revoked or void', b.closed, 'No longer in force.')
        : '');

    return shell('Service Agreement', settingsWarning + head + lists, '');
  }

  /**
   * Downloads and version history sit behind an overflow menu.
   *
   * They are governance, not the everyday action — putting them beside
   * "Use template" would make an employee's primary task compete with an
   * owner's occasional one.
   */
  function renderOverflow() {
    var master = S.master;
    if (!master) return '';
    var allowed = visibleActions({ canManageMaster: S.canManageMaster, canWord: S.canWord });
    var items = [];
    if (allowed.indexOf('master-word') !== -1) {
      items.push('<a role="menuitem" href="/api/service-agreements/master/' + esc(master.id)
        + '/docx" download>Download master Word</a>');
    }
    if (allowed.indexOf('master-pdf') !== -1) {
      items.push('<a role="menuitem" href="/api/service-agreements/master/' + esc(master.id)
        + '/pdf?disposition=inline" target="_blank" rel="noopener">Participant PDF preview</a>');
    }
    if (allowed.indexOf('versions') !== -1) {
      items.push('<button type="button" role="menuitem" data-sva="versions">Version history</button>');
    }
    if (!items.length) return '';

    return '<div class="sva-menu">'
      + '<button type="button" class="sva-btn sva-btn-ghost sva-menu-btn" data-sva="overflow" '
      + 'aria-haspopup="menu" aria-expanded="' + (S.menuOpen ? 'true' : 'false') + '">'
      + '<span aria-hidden="true">\u22EF</span><span class="sva-visually-hidden">More actions</span>'
      + '</button>'
      + (S.menuOpen
        ? '<div class="sva-menu-list" role="menu">' + items.join('') + '</div>'
        : '')
      + '</div>';
  }

  function agreementList(title, rows, blurb) {
    var body;
    if (S.listLoading) {
      body = '<p class="sva-quiet">Loading…</p>';
    } else if (!rows.length) {
      body = '<p class="sva-quiet">' + esc(blurb) + '</p>';
    } else {
      body = '<ul class="sva-entry-list">' + rows.map(function (a) {
        return '<li><button type="button" class="sva-entry-row" data-sva="open" data-id="'
          + esc(a.id) + '">'
          + '<span class="sva-entry-name">' + esc(a.participant_name || 'Unnamed participant') + '</span>'
          + '<span class="sva-entry-meta">' + esc(a.reference || 'Not yet issued')
          + ' \u00B7 <span class="sva-state sva-state-' + esc(a.state) + '">'
          + esc(stateLabel(a.state)) + '</span></span>'
          + '</button></li>';
      }).join('') + '</ul>';
    }
    return '<section class="sva-step"><h3>' + esc(title)
      + ' <span class="sva-count">' + esc(rows.length) + '</span></h3>' + body + '</section>';
  }

  // ══ WIZARD ═══════════════════════════════════════════════════════════════

  async function openAgreement(id, opts) {
    S.view = 'wizard';
    if (!opts || opts.silent !== true) setHash(id);
    S.step = 0;
    S.error = null;
    S.notice = null;
    S.preview = null;
    render();

    var res = await api('/api/service-agreements/' + encodeURIComponent(id));
    if (!res.ok) { S.error = res.error; render(); return; }

    S.agreement = res.agreement;
    S.fields = res.fields || [];
    S.master = res.master;
    S.canEdit = res.canEdit === true;
    S.canWord = res.canDownloadWord === true;
    S.artifacts = res.artifacts || [];
    S.sessions = res.sessions || [];
    S.deliveries = res.deliveries || [];
    render();
    loadPreview();
  }

  /**
   * Start a new agreement.
   *
   * `opts.clientId` lets a contextual shortcut on a participant record skip
   * the picker and land on that participant — the SAME wizard, the same engine,
   * the same route. There is deliberately no second creation path.
   */
  async function startNew(opts) {
    S.view = 'wizard';
    if (!opts || opts.silent !== true) setHash('new');
    S.agreement = null;
    S.step = -1;                 // participant picker
    S.clients = null;
    S.clientQuery = '';
    S.error = null;
    render();

    if (opts && opts.clientId) {
      await searchClients('');
      var want = String(opts.clientId);
      var match = (S.clients || []).filter(function (c) { return String(c.id) === want; })[0];
      // Only proceed when the participant is one this user may actually see:
      // the list is server-scoped, so a client id that is not in it is one
      // they are not entitled to.
      if (match) return createFor(match);
      S.error = 'That participant could not be opened. Choose them from the list below.';
      render();
      return;
    }
    searchClients('');
  }

  async function searchClients(q) {
    S.clientQuery = q;
    var res = await api('/api/service-agreements/clients?q=' + encodeURIComponent(q));
    if (!res.ok) {
      S.clients = [];
      S.error = res.status === 503
        ? 'The client record system is unavailable right now, so participants cannot be listed.'
        : res.error;
    } else {
      S.clients = res.clients || [];
      S.error = null;
    }
    render();
  }

  async function createFor(client) {
    S.busy = true;
    render();
    var res = await api('/api/service-agreements', {
      method: 'POST',
      body: {
        participantClientId: client.id,
        participantName: client.fullName,
        participantPreferredName: client.preferredName,
        participantEmail: client.email
      }
    });
    S.busy = false;
    if (!res.ok) {
      S.error = res.error;
      if (res.missing && res.missing.length) {
        S.error += ' Missing: ' + res.missing.join(', ') + '.';
      }
      render();
      return;
    }
    await openAgreement(res.agreement.id);
    // Mode A: pull everything the portal already knows.
    await prefill();
  }

  async function prefill() {
    if (!S.agreement) return;
    S.busy = true;
    render();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id) + '/resolve', {
      method: 'POST', body: {}
    });
    S.busy = false;
    if (!res.ok) { S.error = res.error; render(); return; }

    S.agreement.form_data = Object.assign({}, S.agreement.form_data, res.values);
    S.agreement.field_sources = Object.assign({}, S.agreement.field_sources, res.sources);
    S.notice = res.sploseUnavailable
      ? 'The client record system was unavailable, so participant details could not be filled in.'
      : 'Filled in everything Opal already knows. Check it before you issue.';
    S.dirty = true;
    render();
    scheduleSave();
    loadPreview();
  }

  // ── Autosave ───────────────────────────────────────────────────────────────
  // Debounced and coalescing, the same shape fca.js uses: a wizard the user is
  // typing into must not fire a request per keystroke, and must never lose the
  // last one.

  /**
   * Only portal-authority values are sent.
   *
   * `resolve` legitimately returns the organisation block so the wizard can
   * DISPLAY the provider's details, but those are the owner's to set, not this
   * form's. The server discards them either way — this exists so a staff
   * member is not told, on every save, that ten fields "were not saved",
   * when nothing they did was wrong.
   */
  function portalOnly(formData) {
    var writable = {};
    (S.fields || []).forEach(function (f) {
      if (f.authority === 'portal') writable[f.tag] = true;
    });
    var out = {};
    Object.keys(formData || {}).forEach(function (tag) {
      if (writable[tag]) out[tag] = formData[tag];
    });
    return out;
  }

  var saveTimer = null;
  function scheduleSave() {
    if (!S.canEdit || !S.agreement) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 700);
  }

  async function save(opts) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!S.agreement || !S.canEdit) return { ok: true };

    S.saving = true;
    renderStatus();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id), {
      method: 'PATCH',
      body: {
        formData: portalOnly(S.agreement.form_data),
        supports: S.agreement.support_rows || [],
        completionMode: S.agreement.completion_mode,
        participantEmail: (S.agreement.form_data || {}).OPAL_PARTICIPANT_EMAIL || null,
        ready: (opts && opts.ready) === true
      }
    });
    S.saving = false;

    if (res.ok) {
      S.agreement = res.agreement;
      S.dirty = false;
      // The server tells us what it refused rather than silently dropping it.
      if (res.rejectedFields && res.rejectedFields.length) {
        S.notice = 'Some values were not saved because they are not yours to set: '
          + res.rejectedFields.join(', ') + '.';
      }
    } else {
      S.error = res.error;
    }
    render();
    return res;
  }

  async function loadPreview() {
    if (!S.agreement) return;
    S.previewLoading = true;
    renderPreview();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id) + '/preview');
    S.previewLoading = false;
    S.preview = res.ok ? res : null;
    if (!res.ok) S.previewError = res.error;
    renderPreview();
  }

  // ══ RENDER ═══════════════════════════════════════════════════════════════

  function render() {
    var root = el('sva-root');
    if (!root) return;

    if (!S.view) { root.hidden = true; root.innerHTML = ''; return; }
    root.hidden = false;

    if (S.view === 'overview') { root.innerHTML = renderOverview(); return; }
    if (S.view === 'master') { root.innerHTML = renderMaster(); return; }
    root.innerHTML = renderWizard();
  }

  function renderStatus() {
    var n = el('sva-savestate');
    if (n) n.textContent = S.saving ? 'Saving…' : (S.dirty ? 'Unsaved changes' : 'Saved');
  }

  /**
   * Breadcrumbs.
   *
   * The trail always starts at the Templates collection, because that is where
   * this workflow lives and where Back should land. `crumbs` is the tail —
   * everything after "Service Agreement".
   */
  function renderCrumbs(crumbs) {
    var tail = crumbs || [];

    // Ancestors are always links; only the last crumb is the current page.
    var items = [
      { label: 'Resources', action: 'crumb-resources' },
      { label: 'Templates', action: 'crumb-templates' },
      { label: 'Service Agreement', action: tail.length ? 'crumb-template' : null }
    ];
    tail.forEach(function (label, i) {
      items.push({ label: label, action: i === tail.length - 1 ? null : 'crumb-template' });
    });

    return '<nav class="sva-crumbs" aria-label="Breadcrumb"><ol>' + items.map(function (c) {
      return '<li>' + (c.action
        ? '<button type="button" class="sva-crumb" data-sva="' + esc(c.action) + '">'
          + esc(c.label) + '</button>'
        : '<span class="sva-crumb sva-crumb-here" aria-current="page">' + esc(c.label) + '</span>')
        + '</li>';
    }).join('') + '</ol></nav>';
  }

  function shell(title, body, aside, crumbs) {
    return '<div class="sva-overlay" role="dialog" aria-modal="true" aria-label="' + esc(title) + '">'
      + '<div class="sva-panel">'
      + '<header class="sva-head">'
      + '<div class="sva-head-left">'
      + renderCrumbs(crumbs)
      + '<h2>' + esc(title) + '</h2>'
      + '</div>'
      + '<div class="sva-head-right">'
      + '<span id="sva-savestate" class="sva-savestate">' + (S.saving ? 'Saving…' : (S.dirty ? 'Unsaved changes' : '')) + '</span>'
      + '<button type="button" class="sva-close" data-sva="close" aria-label="Close">×</button>'
      + '</div>'
      + '</header>'
      + (S.error ? '<div class="sva-alert sva-alert-error" role="alert">' + esc(S.error) + '</div>' : '')
      + (S.notice ? '<div class="sva-alert sva-alert-note">' + esc(S.notice) + '</div>' : '')
      + '<div class="sva-body">'
      + '<div class="sva-main">' + body + '</div>'
      + (aside ? '<aside class="sva-aside" aria-label="Live preview">' + aside + '</aside>' : '')
      + '</div>'
      + '</div></div>';
  }

  function renderWizard() {
    if (S.step === -1) {
      return shell('New agreement', renderClientPicker(), '', ['New agreement']);
    }
    if (!S.agreement) {
      return shell('Agreement details', '<p class="sva-quiet">Loading…</p>', '', ['Agreement details']);
    }

    var step = STEPS[S.step] || STEPS[0];
    var body =
      renderSteps()
      + '<section class="sva-step" aria-labelledby="sva-step-h">'
      + '<h3 id="sva-step-h">' + esc(step.title) + '</h3>'
      + renderStepBody(step)
      + '</section>'
      + renderNav();

    return shell(
      'Agreement — ' + (S.agreement.participant_name || 'participant'),
      body,
      '<div id="sva-preview">' + renderPreviewInner() + '</div>',
      ['Agreement details']
    );
  }

  function renderSteps() {
    return '<ol class="sva-steps">' + STEPS.map(function (s, i) {
      return '<li class="' + (i === S.step ? 'current' : (i < S.step ? 'done' : '')) + '">'
        + '<button type="button" data-sva="step" data-step="' + i + '">'
        + '<span class="sva-step-n">' + (i + 1) + '</span>'
        + '<span class="sva-step-t">' + esc(s.title) + '</span>'
        + '</button></li>';
    }).join('') + '</ol>';
  }

  function renderClientPicker() {
    var list;
    if (!S.clients) list = '<p class="sva-quiet">Searching…</p>';
    else if (!S.clients.length) list = '<p class="sva-quiet">No participants matched.</p>';
    else {
      list = '<ul class="sva-clients">' + S.clients.slice(0, 40).map(function (c) {
        return '<li><button type="button" data-sva="pick" data-client="' + esc(c.id) + '">'
          + '<span class="sva-client-name">' + esc(c.fullName) + '</span>'
          + (c.ndisNumber ? '<span class="sva-client-meta">NDIS ' + esc(c.ndisNumber) + '</span>' : '')
          + '</button></li>';
      }).join('') + '</ul>';
    }
    return '<section class="sva-step"><h3>Choose a participant</h3>'
      + '<label class="sva-label" for="sva-client-q">Search by name or NDIS number</label>'
      + '<input id="sva-client-q" class="sva-input" type="search" data-sva="clientq" '
      + 'value="' + esc(S.clientQuery) + '" autocomplete="off">'
      + list + '</section>';
  }

  /** Fields for this step, taken from the server's own field manifest. */
  function fieldsFor(step) {
    return S.fields.filter(function (f) {
      if (step.groups.indexOf(f.group) === -1) return false;
      // Only what this user may actually set. Server, owner and e-sign values
      // are shown read-only in the review step, never as inputs.
      return f.authority === 'portal' && !f.repeatRow && !f.detail;
    });
  }

  function renderStepBody(step) {
    if (step.key === 'supports') return renderSupports();
    if (step.key === 'method') return renderMethod();
    if (step.key === 'issue') return renderIssue();

    var fields = fieldsFor(step);
    if (!fields.length) return '<p class="sva-quiet">Nothing to complete on this step.</p>';
    return '<div class="sva-fields">' + fields.map(renderField).join('') + '</div>';
  }

  function renderField(f) {
    var data = S.agreement.form_data || {};
    var sources = S.agreement.field_sources || {};
    var value = data[f.tag] == null ? '' : String(data[f.tag]);
    var src = sourceLabel(sources[f.tag]);
    var id = 'sva-f-' + f.tag;

    var control;
    if (f.kind === 'choice' && f.choices && f.choices.length) {
      control = '<div class="sva-choices" role="radiogroup" aria-labelledby="' + esc(id) + '-l">'
        + f.choices.map(function (c, i) {
          return '<label class="sva-choice"><input type="radio" name="' + esc(id) + '" '
            + 'data-sva="field" data-tag="' + esc(f.tag) + '" value="' + esc(c) + '"'
            + (value === c ? ' checked' : '') + '> <span>' + esc(c) + '</span></label>';
        }).join('') + '</div>';
    } else if (f.kind === 'multiline') {
      control = '<textarea id="' + esc(id) + '" class="sva-input sva-textarea" rows="3" '
        + 'data-sva="field" data-tag="' + esc(f.tag) + '">' + esc(value) + '</textarea>';
    } else {
      control = '<input id="' + esc(id) + '" class="sva-input" '
        + 'type="' + (f.kind === 'date' ? 'text' : 'text') + '" '
        + (f.kind === 'date' ? 'placeholder="DD/MM/YYYY" inputmode="numeric" ' : '')
        + 'data-sva="field" data-tag="' + esc(f.tag) + '" value="' + esc(value) + '">';
    }

    return '<div class="sva-field">'
      + '<label class="sva-label" id="' + esc(id) + '-l" for="' + esc(id) + '">' + esc(f.prompt) + '</label>'
      + control
      + (src ? '<span class="sva-src">' + esc(src) + '</span>'
        : '<span class="sva-src sva-src-missing">Not recorded anywhere in Opal — type it if it applies</span>')
      + '</div>';
  }

  function renderSupports() {
    var rows = S.agreement.support_rows || [];
    var repeatTags = S.fields.filter(function (f) { return f.repeatRow; });
    var detailTags = S.fields.filter(function (f) { return f.detail; });

    var body = rows.map(function (row, i) {
      return '<fieldset class="sva-support"><legend>Support ' + (i + 1) + '</legend>'
        + repeatTags.concat(i === 0 ? detailTags : []).map(function (f) {
          var value = row[f.tag] == null ? '' : String(row[f.tag]);
          var id = 'sva-s' + i + '-' + f.tag;
          var control = f.kind === 'multiline'
            ? '<textarea id="' + esc(id) + '" class="sva-input sva-textarea" rows="2" '
              + 'data-sva="support" data-row="' + i + '" data-tag="' + esc(f.tag) + '">' + esc(value) + '</textarea>'
            : '<input id="' + esc(id) + '" class="sva-input" type="text" '
              + 'data-sva="support" data-row="' + i + '" data-tag="' + esc(f.tag) + '" value="' + esc(value) + '">';
          return '<div class="sva-field"><label class="sva-label" for="' + esc(id) + '">'
            + esc(f.prompt) + '</label>' + control + '</div>';
        }).join('')
        + (i === 0 ? '<p class="sva-quiet">The seven detail fields above describe the FIRST support. '
          + 'The template gives them one set of controls; further supports appear in the schedule table.</p>' : '')
        + '<button type="button" class="sva-btn sva-btn-quiet" data-sva="delsupport" data-row="' + i + '">'
        + 'Remove this support</button>'
        + '</fieldset>';
    }).join('');

    return (rows.length ? body : '<p class="sva-quiet">No supports added yet.</p>')
      + '<button type="button" class="sva-btn" data-sva="addsupport">Add a support</button>';
  }

  function renderMethod() {
    var mode = S.agreement.completion_mode;
    return '<div class="sva-modes">'
      + '<label class="sva-mode"><input type="radio" name="sva-mode" data-sva="mode" value="portal"'
      + (mode === 'portal' ? ' checked' : '') + '>'
      + '<span><strong>Secure portal completion</strong><br>'
      + 'Email the participant a personal link. They review, complete their own fields and sign online. '
      + 'Opal records the time, their stated capacity and a hash of the exact document they signed.</span></label>'
      + '<label class="sva-mode"><input type="radio" name="sva-mode" data-sva="mode" value="manual"'
      + (mode === 'manual' ? ' checked' : '') + '>'
      + '<span><strong>Fillable PDF</strong><br>'
      + 'Download or print a form the participant completes in any PDF reader and returns. '
      + 'You upload the returned file against this agreement.</span></label>'
      + '</div>';
  }

  function renderIssue() {
    var a = S.agreement;
    var issued = ['issued', 'viewed', 'partially_completed', 'completed', 'signed'].indexOf(a.state) !== -1;
    var missing = (a.missing_fields || []).length;

    var actions = '<div class="sva-actions">';
    if (!issued && S.canEdit) {
      actions += '<button type="button" class="sva-btn sva-btn-primary" data-sva="issue">Issue this agreement</button>';
    }
    actions += '<a class="sva-btn" href="/api/service-agreements/' + esc(a.id) + '/pdf" download>'
      + 'Download fillable PDF</a>';
    actions += '<a class="sva-btn" href="/api/service-agreements/' + esc(a.id)
      + '/pdf?disposition=inline" target="_blank" rel="noopener">Print</a>';
    if (issued && S.canEdit) {
      actions += '<button type="button" class="sva-btn" data-sva="email">Email for completion and signing</button>';
      actions += '<button type="button" class="sva-btn" data-sva="finalise">Finalise completed agreement</button>';
    }
    if (S.canWord) {
      actions += '<a class="sva-btn sva-btn-ghost" href="/api/service-agreements/' + esc(a.id)
        + '/docx" download>Download Word</a>';
      actions += '<a class="sva-btn sva-btn-ghost" href="/api/service-agreements/' + esc(a.id)
        + '/docx?blank=1" download>Download blank Word</a>';
    }
    actions += '</div>';

    return '<dl class="sva-summary">'
      + '<dt>Status</dt><dd>' + esc(stateLabel(a.state)) + '</dd>'
      + '<dt>Reference</dt><dd>' + esc(a.reference || 'Issued when you issue the agreement') + '</dd>'
      + '<dt>Master version</dt><dd>' + esc(a.master_version_label
        || (S.master ? S.master.versionLabel + ' (current)' : 'Unknown')) + '</dd>'
      + '<dt>Supports</dt><dd>' + esc((a.support_rows || []).length) + '</dd>'
      + '<dt>Fields still blank</dt><dd>' + esc(missing) + '</dd>'
      + '</dl>'
      + (missing
        ? '<p class="sva-quiet">Blank fields are not an error. Each one becomes a question the '
          + 'participant answers in the PDF or the signing page.</p>'
        : '')
      + actions
      + renderSessions();
  }

  function renderSessions() {
    if (!S.sessions || !S.sessions.length) return '';
    return '<h4>Completion links</h4><ul class="sva-sessions">' + S.sessions.map(function (s) {
      return '<li><span>' + esc(s.recipient_email) + '</span>'
        + '<span class="sva-state">' + esc(s.status) + '</span>'
        + (['pending', 'viewed', 'in_progress'].indexOf(s.status) !== -1 && S.canEdit
          ? '<button type="button" class="sva-btn sva-btn-quiet" data-sva="revoke" data-session="'
            + esc(s.id) + '">Revoke</button>' : '')
        + '</li>';
    }).join('') + '</ul>';
  }

  // ── Live preview ───────────────────────────────────────────────────────────

  function renderPreview() {
    var n = el('sva-preview');
    if (n) n.innerHTML = renderPreviewInner();
  }

  function renderPreviewInner() {
    if (S.previewLoading) return '<p class="sva-quiet">Building the preview…</p>';
    if (!S.preview) {
      return '<p class="sva-quiet">' + esc(S.previewError
        || 'The preview will appear once the agreement loads.') + '</p>';
    }

    var head = '<div class="sva-preview-head">'
      + '<strong>Participant preview</strong>'
      + '<span>' + esc(S.preview.fieldCount) + ' field(s) for the participant to complete</span>'
      + (S.preview.supportTotals && S.preview.supportTotals.display
        ? '<span>Estimated total ' + esc(S.preview.supportTotals.display) + '</span>' : '')
      + '</div>';

    var warn = (S.preview.warnings || []).length
      ? '<div class="sva-alert sva-alert-note">' + S.preview.warnings.map(esc).join('<br>') + '</div>'
      : '';

    return head + warn + '<div class="sva-doc">'
      + (S.preview.blocks || []).map(renderBlock).join('') + '</div>';
  }

  function renderNav() {
    return '<nav class="sva-nav">'
      + '<button type="button" class="sva-btn" data-sva="prev"' + (S.step <= 0 ? ' disabled' : '') + '>Back</button>'
      + '<button type="button" class="sva-btn" data-sva="savenow">Save draft</button>'
      + '<button type="button" class="sva-btn sva-btn-primary" data-sva="next"'
      + (S.step >= STEPS.length - 1 ? ' disabled' : '') + '>Next</button>'
      + '</nav>';
  }

  // ══ OWNER MASTER CONSOLE ═════════════════════════════════════════════════

  async function openMaster(showVersions) {
    S.view = 'master';
    S.showVersions = showVersions === true;
    if (!S.silentRoute) setHash(showVersions === true ? 'versions' : 'master');
    S.error = null;
    S.notice = null;
    render();

    var m = await api('/api/service-agreements/master');
    if (!m.ok) { S.error = m.error; render(); return; }
    S.master = m.master;
    S.settings = m.settings;
    S.canManageMaster = m.canManageMaster === true;
    S.canWord = m.canDownloadWord === true;

    var v = await api('/api/service-agreements/master/versions');
    S.versions = v.ok ? v.versions : [];

    var c = await api('/api/service-agreements/master/clauses');
    if (c.ok) { S.clauseCatalogue = c.catalogue; S.clauseSnapshot = c.snapshot; }

    render();
  }

  function renderMaster() {
    var crumbs = [S.showVersions ? 'Version history' : 'Manage master'];
    if (!S.master) {
      return shell('Manage master', '<p class="sva-quiet">Loading…</p>', '', crumbs);
    }

    var m = S.master;
    var body =
      '<section class="sva-step"><h3>Current published master</h3>'
      + '<dl class="sva-summary">'
      + '<dt>Version</dt><dd>' + esc(m.versionLabel) + '</dd>'
      + '<dt>Published</dt><dd>' + esc(m.publishedAt ? String(m.publishedAt).slice(0, 10) : '—') + '</dd>'
      + '<dt>Source hash</dt><dd><code>' + esc(String(m.sha256).slice(0, 16)) + '…</code></dd>'
      + '<dt>Validation</dt><dd>' + (m.validation && m.validation.ok
        ? 'Passed' : 'Not validated') + '</dd>'
      + '</dl>'
      + '<div class="sva-actions">'
      + (S.canWord
        ? '<a class="sva-btn" href="/api/service-agreements/master/' + esc(m.id) + '/docx" download>'
          + 'Download master Word</a>' : '')
      + '<a class="sva-btn" href="/api/service-agreements/master/' + esc(m.id)
      + '/pdf?disposition=inline" target="_blank" rel="noopener">Preview master PDF</a>'
      + (S.canManageMaster
        ? '<button type="button" class="sva-btn" data-sva="upload">Upload a revised Word master</button>' : '')
      + '</div>'
      + (S.settings && !S.settings.complete
        ? '<div class="sva-alert sva-alert-error">Your practice details are incomplete: '
          + esc((S.settings.missing || []).join(', '))
          + '. Agreements cannot be created until these are set.</div>'
        : '')
      + '</section>'
      + renderClauseEditor()
      + renderVersions();

    return shell(S.showVersions ? 'Version history' : 'Manage master', body, '', crumbs);
  }

  function renderClauseEditor() {
    if (!S.clauseSnapshot || !S.canManageMaster) return '';
    var clauses = S.clauseSnapshot.clauses || [];
    var custom = S.clauseSnapshot.custom || [];

    return '<section class="sva-step"><h3>Clauses</h3>'
      + '<p class="sva-quiet">Editing clauses creates a new DRAFT version. The published master is '
      + 'unchanged until you publish.</p>'
      + '<ul class="sva-clauses">' + clauses.map(function (c) {
        return '<li>'
          + '<label class="sva-choice">'
          + '<input type="checkbox" data-sva="clause" data-tag="' + esc(c.tag) + '"'
          + (c.enabled ? ' checked' : '') + (c.optional ? '' : ' disabled') + '>'
          + '<span>' + esc(c.label) + '</span></label>'
          + (c.optional ? '' : '<span class="sva-req">Required</span>')
          + '</li>';
      }).join('') + '</ul>'
      + '<h4>Custom clauses</h4>'
      + (custom.length
        ? '<ul class="sva-clauses">' + custom.map(function (c, i) {
          return '<li><div class="sva-field">'
            + '<input class="sva-input" type="text" data-sva="customtitle" data-i="' + i + '" '
            + 'value="' + esc(c.title) + '" aria-label="Custom clause title">'
            + '<textarea class="sva-input sva-textarea" rows="3" data-sva="custombody" data-i="' + i + '" '
            + 'aria-label="Custom clause text">' + esc(c.body) + '</textarea>'
            + '<button type="button" class="sva-btn sva-btn-quiet" data-sva="delcustom" data-i="' + i + '">'
            + 'Remove</button>'
            + '</div></li>';
        }).join('') + '</ul>'
        : '<p class="sva-quiet">No custom clauses.</p>')
      + '<div class="sva-actions">'
      + '<button type="button" class="sva-btn" data-sva="addcustom">Add a custom clause</button>'
      + '<button type="button" class="sva-btn sva-btn-primary" data-sva="saveclauses">'
      + 'Save as a new draft version</button>'
      + '</div></section>';
  }

  function renderVersions() {
    if (!S.versions || !S.versions.length) return '';
    return '<section class="sva-step"><h3>Version history</h3>'
      + '<table class="sva-versions"><thead><tr>'
      + '<th>Version</th><th>Status</th><th>Published</th><th>Agreements</th><th></th>'
      + '</tr></thead><tbody>' + S.versions.map(function (v) {
        return '<tr>'
          + '<td>' + esc(v.version_label) + '</td>'
          + '<td>' + esc(v.status) + '</td>'
          + '<td>' + esc(v.published_at ? String(v.published_at).slice(0, 10) : '—') + '</td>'
          + '<td>' + esc(v.agreement_count) + '</td>'
          + '<td>' + (S.canManageMaster ? versionActions(v) : '') + '</td>'
          + '</tr>';
      }).join('') + '</tbody></table></section>';
  }

  function versionActions(v) {
    if (v.status === 'draft' || v.status === 'validated') {
      return '<button type="button" class="sva-btn sva-btn-quiet" data-sva="publish" data-id="'
        + esc(v.id) + '">Publish</button>';
    }
    if (v.status === 'published') {
      return '<button type="button" class="sva-btn sva-btn-quiet" data-sva="retire" data-id="'
        + esc(v.id) + '">Retire</button>';
    }
    return '<button type="button" class="sva-btn sva-btn-quiet" data-sva="republish" data-id="'
      + esc(v.id) + '">Republish as new</button>';
  }

  // ══ EVENTS ═══════════════════════════════════════════════════════════════

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-sva]');
    // An open overflow menu closes on any click that is not the menu itself.
    if (S.menuOpen && (!t || t.getAttribute('data-sva') !== 'overflow')) {
      var inMenu = e.target && e.target.closest && e.target.closest('.sva-menu-list');
      if (!inMenu) { S.menuOpen = false; if (S.view) render(); }
    }
    if (!t) return;
    var action = t.getAttribute('data-sva');

    if (action === 'new') { e.preventDefault(); startNew(); return; }
    if (action === 'master') { e.preventDefault(); openMaster(false); return; }
    if (action === 'versions') { e.preventDefault(); S.menuOpen = false; openMaster(true); return; }
    if (action === 'open') { e.preventDefault(); openAgreement(t.getAttribute('data-id')); return; }
    if (action === 'close') { e.preventDefault(); closeAll(); return; }
    if (action === 'overflow') { e.preventDefault(); S.menuOpen = !S.menuOpen; render(); return; }
    // Breadcrumbs. 'Service Agreement' returns to the template overview;
    // the two above it leave for the hub, which is where they point.
    if (action === 'crumb-template') { e.preventDefault(); openOverview(); return; }
    if (action === 'crumb-templates') {
      e.preventDefault();
      closeAll();
      if (global.RH2 && global.RH2.openCollection) global.RH2.openCollection('templates');
      return;
    }
    if (action === 'crumb-resources') {
      e.preventDefault();
      closeAll();
      if (global.RH2 && global.RH2.nav) global.RH2.nav('home');
      return;
    }
    if (action === 'step') { e.preventDefault(); S.step = Number(t.getAttribute('data-step')); render(); return; }
    if (action === 'prev') { e.preventDefault(); if (S.step > 0) { S.step -= 1; render(); } return; }
    if (action === 'next') {
      e.preventDefault();
      if (S.step < STEPS.length - 1) { S.step += 1; render(); loadPreview(); }
      return;
    }
    if (action === 'savenow') { e.preventDefault(); save().then(loadPreview); return; }
    if (action === 'pick') {
      e.preventDefault();
      var id = t.getAttribute('data-client');
      var c = (S.clients || []).filter(function (x) { return String(x.id) === id; })[0];
      if (c) createFor(c);
      return;
    }
    if (action === 'addsupport') {
      e.preventDefault();
      S.agreement.support_rows = (S.agreement.support_rows || []).concat([{}]);
      S.dirty = true; render(); scheduleSave();
      return;
    }
    if (action === 'delsupport') {
      e.preventDefault();
      var i = Number(t.getAttribute('data-row'));
      S.agreement.support_rows = (S.agreement.support_rows || []).filter(function (_, n) { return n !== i; });
      S.dirty = true; render(); scheduleSave();
      return;
    }
    if (action === 'issue') { e.preventDefault(); issue(); return; }
    if (action === 'email') { e.preventDefault(); sendLink(); return; }
    if (action === 'finalise') { e.preventDefault(); finalise(); return; }
    if (action === 'revoke') { e.preventDefault(); revoke(t.getAttribute('data-session')); return; }
    if (action === 'addcustom') {
      e.preventDefault();
      S.clauseSnapshot.custom = (S.clauseSnapshot.custom || []).concat([{ title: '', body: '' }]);
      render();
      return;
    }
    if (action === 'delcustom') {
      e.preventDefault();
      var ci = Number(t.getAttribute('data-i'));
      S.clauseSnapshot.custom = (S.clauseSnapshot.custom || []).filter(function (_, n) { return n !== ci; });
      render();
      return;
    }
    if (action === 'saveclauses') { e.preventDefault(); saveClauses(); return; }
    if (action === 'publish') { e.preventDefault(); masterAction(t.getAttribute('data-id'), 'publish'); return; }
    if (action === 'retire') { e.preventDefault(); masterAction(t.getAttribute('data-id'), 'retire'); return; }
    if (action === 'republish') { e.preventDefault(); masterAction(t.getAttribute('data-id'), 'republish'); return; }
    if (action === 'upload') { e.preventDefault(); pickUpload(); return; }
  });

  doc.addEventListener('input', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-sva]');
    if (!t) return;
    var action = t.getAttribute('data-sva');

    if (action === 'clientq') {
      clearTimeout(t._svaTimer);
      t._svaTimer = setTimeout(function () { searchClients(t.value); }, 250);
      return;
    }
    if (action === 'field') {
      S.agreement.form_data = S.agreement.form_data || {};
      S.agreement.form_data[t.getAttribute('data-tag')] = t.value;
      S.dirty = true; renderStatus(); scheduleSave();
      return;
    }
    if (action === 'support') {
      var i = Number(t.getAttribute('data-row'));
      var rows = S.agreement.support_rows || [];
      rows[i] = rows[i] || {};
      rows[i][t.getAttribute('data-tag')] = t.value;
      S.agreement.support_rows = rows;
      S.dirty = true; renderStatus(); scheduleSave();
      return;
    }
    if (action === 'customtitle' || action === 'custombody') {
      var ci = Number(t.getAttribute('data-i'));
      var c = (S.clauseSnapshot.custom || [])[ci];
      if (c) c[action === 'customtitle' ? 'title' : 'body'] = t.value;
    }
  });

  doc.addEventListener('change', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-sva]');
    if (!t) return;
    var action = t.getAttribute('data-sva');

    if (action === 'field' && t.type === 'radio') {
      S.agreement.form_data = S.agreement.form_data || {};
      S.agreement.form_data[t.getAttribute('data-tag')] = t.value;
      S.dirty = true; scheduleSave();
      return;
    }
    if (action === 'mode') {
      S.agreement.completion_mode = t.value;
      S.dirty = true; scheduleSave();
      return;
    }
    if (action === 'clause') {
      var tag = t.getAttribute('data-tag');
      (S.clauseSnapshot.clauses || []).forEach(function (c) {
        if (c.tag === tag) c.enabled = t.checked;
      });
    }
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !S.view) return;
    if (S.menuOpen) { S.menuOpen = false; render(); return; }
    closeAll();
  });

  // ══ ACTIONS ══════════════════════════════════════════════════════════════

  async function issue() {
    S.error = null;
    await save({ ready: true });
    S.busy = true; render();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id) + '/issue', {
      method: 'POST', body: {}
    });
    S.busy = false;
    if (!res.ok) {
      S.error = res.error + (res.missing && res.missing.length ? ' Missing: ' + res.missing.join(', ') + '.' : '');
      render(); return;
    }
    S.agreement = res.agreement;
    S.notice = 'Issued as ' + (res.agreement.reference || '') + '. '
      + 'This agreement is now pinned to master version ' + (res.agreement.master_version_label || '') + '.';
    await openAgreement(S.agreement.id);
    S.step = STEPS.length - 1;
    render();
  }

  async function sendLink() {
    var to = global.prompt('Email address for the participant or their representative:',
      (S.agreement.form_data || {}).OPAL_PARTICIPANT_EMAIL || '');
    if (!to) return;
    var message = global.prompt('Add a short message (optional):', '') || '';

    S.busy = true; render();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id) + '/email', {
      method: 'POST', body: { recipientEmail: to, message: message }
    });
    S.busy = false;
    if (!res.ok) { S.error = res.error; render(); return; }
    S.notice = res.delivery.result === 'skipped'
      ? 'Email is not configured in this environment, so nothing was sent. The link is: ' + res.signingUrl
      : 'Sent to ' + to + '.';
    await openAgreement(S.agreement.id);
  }

  async function finalise() {
    if (!global.confirm('Finalise this agreement? The final PDF is locked and cannot be edited.')) return;
    S.busy = true; render();
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id) + '/finalise', {
      method: 'POST', body: {}
    });
    S.busy = false;
    if (!res.ok) { S.error = res.error; render(); return; }
    S.notice = 'Finalised. The locked copy is on file.';
    await openAgreement(S.agreement.id);
  }

  async function revoke(sessionId) {
    var res = await api('/api/service-agreements/' + encodeURIComponent(S.agreement.id)
      + '/sessions/' + encodeURIComponent(sessionId) + '/revoke', { method: 'POST', body: {} });
    if (!res.ok) { S.error = res.error; render(); return; }
    await openAgreement(S.agreement.id);
  }

  async function saveClauses() {
    S.busy = true; render();
    var res = await api('/api/service-agreements/master/clauses', {
      method: 'PUT',
      body: { clauses: S.clauseSnapshot.clauses, custom: S.clauseSnapshot.custom }
    });
    S.busy = false;
    if (!res.ok) {
      S.error = res.error + (res.errors ? ' ' + res.errors.map(function (x) { return x.message; }).join(' ') : '');
      render(); return;
    }
    S.notice = 'Saved as draft version ' + res.draft.versionLabel + '. Publish it when you are ready.';
    await openMaster();
  }

  async function masterAction(id, what) {
    var prompts = {
      publish: 'Publish this version? Every agreement issued from now on will use it. '
        + 'Agreements already issued are unaffected.',
      retire: 'Retire the current published master? No new agreements can be issued until '
        + 'another version is published.',
      republish: 'Republish this version as a NEW version? The historic version is left untouched.'
    };
    if (!global.confirm(prompts[what])) return;

    S.busy = true; render();
    var res = await api('/api/service-agreements/master/' + encodeURIComponent(id) + '/' + what, {
      method: 'POST', body: {}
    });
    S.busy = false;
    if (!res.ok) { S.error = res.error; render(); return; }
    S.notice = what === 'retire' ? 'Retired.' : 'Version ' + res.master.versionLabel + ' is now current.';
    await openMaster();
  }

  function pickUpload() {
    var input = doc.createElement('input');
    input.type = 'file';
    input.accept = '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = async function () {
        var b64 = String(reader.result).split(',')[1] || '';
        S.busy = true; render();
        var res = await api('/api/service-agreements/master/upload', {
          method: 'POST', body: { fileBase64: b64, mimeType: file.type }
        });
        S.busy = false;
        if (!res.ok) {
          var detail = res.validation && res.validation.errors
            ? ' ' + res.validation.errors.map(function (x) { return x.message; }).join(' ')
            : '';
          S.error = res.error + detail;
          render(); return;
        }
        S.notice = 'Uploaded as draft version ' + res.draft.versionLabel
          + '. Preview it, then publish when you are satisfied.';
        await openMaster();
      };
      reader.readAsDataURL(file);
    });
    input.click();
  }

  function closeAll() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (S.dirty && S.agreement) save();
    S.view = null;
    S.agreement = null;
    S.preview = null;
    S.menuOpen = false;
    render();
    // Leave the address on the Templates collection the surface sits in, so
    // Back does not walk into a screen that is no longer open.
    if (global.history && global.history.pushState
        && String(global.location.hash).indexOf('#resources/service-agreement') === 0) {
      try { global.history.pushState(null, '', '#resources/library'); } catch (e) { /* address only */ }
    }
  }

  // ══ BOOT ═════════════════════════════════════════════════════════════════
  //
  // There is no hub-entry mount to keep in sync any more: the workflow's only
  // discovery point is the Service Agreement card in the Templates collection,
  // which resourcehub.js renders, and its only address is
  // #resources/service-agreement, which navigation.js restores. A surface with
  // one way in cannot drift out of step with a second one.

  function boot() {
    // A deep link that arrived before this script parsed. navigation.js
    // restores routes on its own, but it can only call SVA.route() if SVA
    // already exists — so an arrival straight onto the address is picked up
    // here instead.
    var hash = String((global.location && global.location.hash) || '');
    if (hash.indexOf('#resources/service-agreement') === 0) {
      var rest = hash.slice('#resources/service-agreement'.length).replace(/^\/+/, '');
      route(decodeURIComponent(rest.split('/')[0] || ''), { silent: true });
    }
  }

  doc.addEventListener('DOMContentLoaded', boot);
  if (doc.readyState !== 'loading') boot();

  // ══ PUBLIC SURFACE ═══════════════════════════════════════════════════════

  global.SVA = {
    /**
     * The canonical entry point, called by:
     *   - the Service Agreement card in the Templates collection
     *   - navigation.js, restoring #resources/service-agreement[/<what>]
     *   - any contextual "Create service agreement" action on a participant
     *     record, as SVA.route('new', { clientId })
     * All three land on the same wizard and the same document engine.
     */
    route: route,
    open: openAgreement,
    close: closeAll,
    master: openMaster,
    /** Contextual shortcut for a participant record. */
    createFor: function (clientId) { return route('new', { clientId: clientId }); },
    reload: function () { return loadOverview(); },
    _state: S,
    _helpers: helpers
  };

})(typeof window !== 'undefined' ? window : null);
