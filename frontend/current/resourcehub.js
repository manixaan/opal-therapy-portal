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
      if (!r.ok) return { ok: false, status: r.status, error: data.error || ('Request failed (' + r.status + ')') };
      data.ok = true;
      return data;
    } catch (_) {
      return { ok: false, status: 0, error: 'Network error — please try again.' };
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
  // Two-dimensional badge: authority x lifecycle. Internally authored content
  // ('internal', with 'opal_approved' as a display synonym) reads 'Opal Draft'
  // until it is approved, then 'Opal Approved'. External authorities keep
  // their own labels regardless of workflow status.
  function authBadge(level, status) {
    var a = AUTHORITY[level] || AUTHORITY.internal;
    if (a.cls === 'opal') {
      var approved = !status || status === 'approved';
      return '<span class="rh2-auth rh2-auth-opal">' + (approved ? 'Opal Approved' : 'Opal Draft') + '</span>';
    }
    return '<span class="rh2-auth rh2-auth-' + a.cls + '"' +
      (a.full ? ' title="' + esc(a.full) + '"' : '') + '>' + a.label + '</span>';
  }

  var POPULATIONS = [['paediatric', 'Paediatric'], ['adolescent', 'Adolescent'], ['adult', 'Adult'], ['older_adult', 'Older adult']];
  var SETTINGS = [['clinic', 'Clinic'], ['school', 'School'], ['home', 'Home'], ['telehealth', 'Telehealth'], ['community', 'Community']];
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
    view: 'home', // home | library | detail | learning | admin
    topics: null, // therapy_area tags [{id,name}]
    home: null, homeLoading: false,
    lib: { q: '', type: '', topic: '', population: '', setting: '', authority: '', sort: 'relevant', saved: false, rows: null, loading: false },
    detail: { id: null, data: null, loading: false, ackConfirm: false, fbKind: '', fbDone: false, showVersions: false, quizResult: null, backView: 'home' },
    learning: { data: null, loading: false, cpdOpen: false, cpd: null, pd: null, pdPastOpen: false },
    admin: {
      tab: 'content', status: '', q: '', list: null, loading: false,
      editing: null, // resource being edited (object) or {} for new
      formOpen: false,
      sources: null, pd: null, pdEditing: null, feedback: null, links: null, analytics: null,
      err: '',
    },
  };

  var libDebounce = null;

  // ── Root render ───────────────────────────────────────────────────────────

  function root() { return doc.getElementById('rh2-root'); }

  function render() {
    var host = root();
    if (!host) return;
    var body = '';
    if (S.view === 'home') body = renderHome();
    else if (S.view === 'library') body = renderLibrary();
    else if (S.view === 'detail') body = renderDetail();
    else if (S.view === 'learning') body = renderLearning();
    else if (S.view === 'admin') body = renderAdmin();
    host.innerHTML = renderNav() + body;
  }

  function renderNav() {
    var items = [
      ['home', 'Home'], ['library', 'Library'], ['saved', 'Saved'], ['learning', 'My Learning'],
    ];
    if (canAdmin()) items.push(['admin', 'Admin']);
    var active = S.view === 'detail' ? 'library' : S.view;
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
      S.lib = { q: '', type: '', topic: '', population: '', setting: '', authority: '', sort: 'relevant', saved: true, rows: null, loading: false };
      view = 'library';
    } else if (view === 'library' && S.lib.saved) {
      S.lib.saved = false;
      S.lib.rows = null;
    }
    S.view = view;
    if (view === 'home' && !S.home) loadHome();
    if (view === 'library' && !S.lib.rows) loadLibrary();
    if (view === 'learning') loadLearning();
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
      '<header class="rh2-hero"><h1>Resource Hub</h1>' +
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

    var cont = pick(h, 'continue_learning') || pick(h, 'continueLearning') || [];
    var required = pick(h, 'required_for_you') || pick(h, 'requiredForYou') || pick(h, 'required') || [];
    var whatsNew = pick(h, 'whats_new') || pick(h, 'whatsNew') || [];
    var collections = h.collections || [];
    var pd = pick(h, 'upcoming_pd') || pick(h, 'upcomingPd') || [];
    var links = pick(h, 'quick_links') || pick(h, 'quickLinks') || [];
    var recent = pick(h, 'recently_added') || pick(h, 'recentlyAdded') || [];

    // Continue Learning + Required for You
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

    // What's New
    if (whatsNew.length) {
      out += '<section class="rh2-card" aria-labelledby="rh2-h-new"><h2 id="rh2-h-new">What is new</h2>' +
        whatsNew.map(function (r) {
          return homeResRow(r, '<span class="rh2-row-sub">' + esc(fmtDate(pick(r, 'updated_at') || pick(r, 'created_at'))) + '</span>');
        }).join('') + '</section>';
    }

    // Collections
    out += '<section aria-labelledby="rh2-h-col"><h2 class="rh2-h2" id="rh2-h-col">Browse by collection</h2><div class="rh2-collections">';
    if (!collections.length) out += '<p class="rh2-quiet">Collections will appear here once content is published.</p>';
    else out += collections.map(function (c) {
      return '<button type="button" class="rh2-collection" onclick="RH2.openCollection(\'' + esc(pick(c, 'key') || pick(c, 'id')) + '\')">' +
        '<span class="rh2-collection-icn">' + icn(pick(c, 'icon'), 'folder', 18) + '</span>' +
        '<span class="rh2-collection-name">' + esc(pick(c, 'name')) + '</span>' +
        (pick(c, 'tagline') ? '<span class="rh2-collection-tag">' + esc(pick(c, 'tagline')) + '</span>' : '') +
        '</button>';
    }).join('');
    out += '</div></section>';

    // Upcoming PD + Quick links + Recently added
    out += '<div class="rh2-grid-2">';
    out += '<section class="rh2-card" aria-labelledby="rh2-h-pd"><h2 id="rh2-h-pd">Upcoming professional development</h2>';
    if (!pd.length) out += '<p class="rh2-quiet">No upcoming PD events listed.</p>';
    else out += pd.slice(0, 5).map(function (e) {
      var hours = pick(e, 'cpd_hours');
      return '<div class="rh2-pd-row"><div class="rh2-pd-date">' + esc(fmtDateTime(pick(e, 'starts_at'))) + '</div>' +
        '<div class="rh2-row-title">' + esc(pick(e, 'title')) + '</div>' +
        '<div class="rh2-row-sub">' + esc(pick(e, 'provider') || '') +
        (hours ? (pick(e, 'provider') ? ' · ' : '') + esc(hours) + ' CPD hours' : '') + '</div></div>';
    }).join('');
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

  function openCollection(key) {
    S.lib = { q: '', type: '', topic: '', population: '', setting: '', authority: '', sort: 'relevant', saved: false, rows: null, loading: false, collection: String(key || '') };
    nav('library');
  }

  // ── LIBRARY ───────────────────────────────────────────────────────────────

  async function loadTopics() {
    if (S.topics) return;
    var d = await api('/api/resources/tags');
    S.topics = (d.ok && d.tags) ? d.tags.filter(function (t) { return t.category === 'therapy_area'; }) : [];
  }

  async function loadLibrary() {
    S.lib.loading = true;
    render();
    await loadTopics();
    var f = S.lib;
    // Param names match the GET /api/rh2/resources contract:
    // contentType, tagId, collectionKey, authority, population, setting,
    // saved, sort (relevant|updated|az|popular).
    var qs = [];
    if (f.q) qs.push('q=' + encodeURIComponent(f.q));
    if (f.type) qs.push('contentType=' + encodeURIComponent(f.type));
    if (f.topic) qs.push('tagId=' + encodeURIComponent(f.topic));
    if (f.population) qs.push('population=' + encodeURIComponent(f.population));
    if (f.setting) qs.push('setting=' + encodeURIComponent(f.setting));
    if (f.authority) qs.push('authority=' + encodeURIComponent(f.authority));
    if (f.collection) qs.push('collectionKey=' + encodeURIComponent(f.collection));
    if (f.saved) qs.push('saved=1');
    if (f.sort) qs.push('sort=' + encodeURIComponent(f.sort));
    var d = await api('/api/rh2/resources' + (qs.length ? '?' + qs.join('&') : ''));
    f.loading = false;
    f.rows = d.ok ? (d.resources || []) : [];
    f.error = d.ok ? '' : d.error;
    render();
  }

  function sel(id, label, options, value, handler) {
    return '<label class="rh2-visually-hidden" for="' + id + '">' + label + '</label>' +
      '<select id="' + id + '" class="rh2-select" onchange="' + handler + '">' +
      '<option value="">' + label + '</option>' +
      options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
  }

  function renderLibrary() {
    var f = S.lib;
    var topicOpts = (S.topics || []).map(function (t) { return [t.id, t.name]; });
    var authOpts = Object.keys(AUTHORITY).map(function (k) { return [k, AUTHORITY[k].label]; });
    var out = '<div class="rh2-page"><h1 class="rh2-h1">' + (f.saved ? 'Saved' : 'Library') + '</h1>' +
      '<div class="rh2-filters">' +
      '<input type="search" id="rh2-lib-q" class="rh2-search" placeholder="Search the library..." aria-label="Search the library" value="' + esc(f.q) + '" ' +
      'oninput="RH2.libInput(this.value)">' +
      sel('rh2-f-type', 'All types', CONTENT_TYPES, f.type, "RH2.libFilter('type',this.value)") +
      sel('rh2-f-topic', 'All topics', topicOpts, f.topic, "RH2.libFilter('topic',this.value)") +
      sel('rh2-f-pop', 'All populations', POPULATIONS, f.population, "RH2.libFilter('population',this.value)") +
      sel('rh2-f-set', 'All settings', SETTINGS, f.setting, "RH2.libFilter('setting',this.value)") +
      sel('rh2-f-auth', 'All authorities', authOpts, f.authority, "RH2.libFilter('authority',this.value)") +
      '<label class="rh2-visually-hidden" for="rh2-f-sort">Sort</label>' +
      '<select id="rh2-f-sort" class="rh2-select" onchange="RH2.libFilter(\'sort\',this.value)">' +
      SORTS.map(function (o) {
        return '<option value="' + o[0] + '"' + (f.sort === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select>' +
      (f.collection ? '<button type="button" class="rh2-chip rh2-chip-clear" onclick="RH2.libFilter(\'collection\',\'\')">Collection filter — clear</button>' : '') +
      '</div>';

    if (f.loading || f.rows === null) {
      out += '<div class="rh2-card">' + skel(5, 58) + '</div>';
      if (f.rows === null && !f.loading) loadLibrary();
      return out + '</div>';
    }
    if (f.error) return out + '<div class="rh2-empty">' + esc(f.error) + '</div></div>';
    if (!f.rows.length) {
      if (f.saved) {
        return out + '<div class="rh2-empty">Save resources you use often and they will appear here.</div></div>';
      }
      return out + '<div class="rh2-empty">No resources match. Try clearing a filter, or tell us what is missing via feedback on any related resource.</div></div>';
    }

    var backView = f.saved ? 'saved' : 'library';
    out += '<div class="rh2-card rh2-list">' + f.rows.map(function (r) {
      var mins = pick(r, 'estimated_minutes');
      var fresh = pick(r, 'source_verified_at');
      return '<button type="button" class="rh2-row" onclick="RH2.openDetail(\'' + esc(pick(r, 'id')) + '\',\'' + backView + '\')">' +
        '<span class="rh2-row-icn">' + icn(TYPE_ICONS[pick(r, 'content_type')] || 'doc') + '</span>' +
        '<span class="rh2-row-main">' +
        '<span class="rh2-row-title">' + esc(pick(r, 'title')) +
        (pick(r, 'mandatory') ? ' <span class="rh2-chip rh2-chip-warn">Required</span>' : '') + '</span>' +
        (pick(r, 'description') ? '<span class="rh2-row-sub rh2-clamp">' + esc(pick(r, 'description')) + '</span>' : '') +
        '<span class="rh2-row-meta">' + esc(typeLabel(pick(r, 'content_type'))) +
        (mins ? ' · ' + esc(mins) + ' min' : '') +
        (fresh ? ' <span class="rh2-fresh" title="Source verified ' + esc(fmtDate(fresh)) + '" aria-label="Source verified ' + esc(fmtDate(fresh)) + '"></span>' : '') +
        '</span></span>' +
        authBadge(pick(r, 'authority_level'), pick(r, 'status')) +
        '</button>';
    }).join('') + '</div>';
    return out + '</div>';
  }

  function libInput(v) {
    S.lib.q = v;
    if (libDebounce) clearTimeout(libDebounce);
    libDebounce = setTimeout(function () { loadLibrary(); }, 320);
  }
  function libFilter(k, v) {
    S.lib[k] = v;
    loadLibrary();
  }

  // ── DETAIL ────────────────────────────────────────────────────────────────

  async function openDetail(id, backView) {
    S.detail = { id: id, data: null, loading: true, ackConfirm: false, fbKind: '', fbDone: false, showVersions: false, quizResult: null, backView: backView || S.view };
    S.view = 'detail';
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id));
    S.detail.loading = false;
    S.detail.data = d.ok ? d : { ok: false, error: d.error };
    render();
  }

  function detailRes() {
    var d = S.detail.data;
    return d ? (d.resource || d) : null;
  }

  function kvRow(k, vHtml) {
    return vHtml ? '<div class="rh2-kv"><span class="rh2-kv-k">' + k + '</span><span class="rh2-kv-v">' + vHtml + '</span></div>' : '';
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
      '<div class="rh2-article-titlebar"><h1>' + esc(pick(r, 'title')) + '</h1>' + authBadge(authority, pick(r, 'status')) + '</div>' +
      '<div class="rh2-row-meta">' + esc(typeLabel(pick(r, 'content_type'))) +
      (mins ? ' · ' + esc(mins) + ' min' : '') +
      (pick(r, 'status') && pick(r, 'status') !== 'approved' ? ' · <span class="rh2-chip">' + esc(String(pick(r, 'status')).replace(/_/g, ' ')) + '</span>' : '') +
      (pick(r, 'mandatory') ? ' · <span class="rh2-chip rh2-chip-warn">Required</span>' : '') +
      (pick(r, 'last_reviewed_at') ? ' · Last reviewed ' + esc(fmtDate(pick(r, 'last_reviewed_at'))) : '') +
      '</div>';

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

    // Content
    var content = pick(r, 'content');
    out += '<div class="rh2-content">';
    if (content) out += mdRender(content);
    else if (pick(r, 'description')) out += '<p>' + esc(pick(r, 'description')) + '</p>';
    else out += '<p class="rh2-quiet">No content yet.</p>';
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

  async function toggleFav() {
    var us = detailUserState(); if (!us) return;
    var st = S.detail;
    var on = !us.favourited;
    us.favourited = on; // optimistic; reverted on failure
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(st.id) + '/favourite', { method: on ? 'POST' : 'DELETE' });
    if (!d.ok) { us.favourited = !on; render(); toast('Could not update', d.error || 'Please try again.'); }
  }

  async function toggleComplete() {
    var us = detailUserState(); if (!us) return;
    var st = S.detail;
    var on = !us.completed;
    us.completed = on; // optimistic; reverted on failure
    render();
    var d = await api('/api/rh2/resources/' + encodeURIComponent(st.id) + '/complete', { method: on ? 'POST' : 'DELETE' });
    if (!d.ok) { us.completed = !on; render(); toast('Could not update', d.error || 'Please try again.'); }
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
    out += '<section class="rh2-card" aria-labelledby="rh2-h-cpd"><h2 id="rh2-h-cpd">CPD this registration year</h2>' +
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
    if (isOwner()) tabs.splice(1, 0, ['sources', 'Sources'], ['links', 'Quick Links']);
    return tabs;
  }

  function loadAdminTab() {
    var t = S.admin.tab;
    if (t === 'content') loadAdminContent();
    else if (t === 'sources') loadAdminSources();
    else if (t === 'pd') loadAdminPd();
    else if (t === 'feedback') loadAdminFeedback();
    else if (t === 'links') loadAdminLinks();
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
    var d = await api('/api/rh2/admin/analytics');
    S.admin.loading = false;
    S.admin.analytics = d.ok ? d : null;
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
    else if (a.tab === 'sources') out += renderAdminSources();
    else if (a.tab === 'pd') out += renderAdminPd();
    else if (a.tab === 'feedback') out += renderAdminFeedback();
    else if (a.tab === 'links') out += renderAdminLinks();
    else if (a.tab === 'analytics') out += renderAdminAnalytics();
    return out + '</div>';
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
        '<span class="rh2-row-sub">' + esc(typeLabel(pick(r, 'content_type'))) + ' · ' + authBadge(pick(r, 'authority_level'), status) +
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
  function adminFormClose() { S.admin.formOpen = false; S.admin.editing = null; render(); }

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

    if (editing && isApproved) {
      out += '<fieldset class="rh2-fieldset"><legend class="rh2-lbl">Change kind (this resource is published)</legend>' +
        '<div class="rh2-check-row">' +
        '<span class="rh2-check"><input type="radio" name="rh2-form-kind" id="rh2-kind-minor" value="minor" checked><label for="rh2-kind-minor">Minor (wording, typos)</label></span>' +
        '<span class="rh2-check"><input type="radio" name="rh2-form-kind" id="rh2-kind-material" value="material"><label for="rh2-kind-material">Material (staff must re-acknowledge)</label></span>' +
        '</div>' +
        '<label class="rh2-lbl" for="rh2-form-changenote">Change note</label>' +
        '<input type="text" id="rh2-form-changenote" class="rh2-input" maxlength="300"></fieldset>';
    }

    out += '<div class="rh2-form-actions">' +
      '<button type="button" class="rh2-btn rh2-btn-primary" onclick="RH2.adminSave(\'draft\')">' + (editing ? 'Save changes' : 'Save draft') + '</button>' +
      (!editing || pick(r, 'status') === 'draft'
        ? '<button type="button" class="rh2-btn" onclick="RH2.adminSave(\'submit\')">Save and submit for review</button>' : '') +
      (isOwner() ? '<button type="button" class="rh2-btn" onclick="RH2.adminSave(\'approve\')">Save and approve</button>' : '') +
      '<button type="button" class="rh2-btn rh2-btn-quiet" onclick="RH2.adminFormClose()">Cancel</button></div></section>';
    return out;
  }

  function adminFormAuthority(v) {
    var el = doc.getElementById('rh2-form-source');
    if (el) el.style.display = v === 'internal' ? 'none' : '';
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
    toast('Saved', then === 'approve' ? 'Approved and published.' : then === 'submit' ? 'Submitted for review.' : 'Saved.');
    S.admin.formOpen = false; S.admin.editing = null;
    loadAdminContent();
  }

  async function adminAction(id, action) {
    var d = await api('/api/rh2/resources/' + encodeURIComponent(id) + '/' + action, { method: 'POST' });
    if (!d.ok) { toast('Could not ' + action, d.error || 'Please try again.'); return; }
    toast('Done', action === 'approve' ? 'Approved and published.' : action === 'submit' ? 'Submitted for review.' : 'Archived.');
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
    } else {
      render();
    }
  }

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

  global.RH2 = {
    open: open,
    nav: nav,
    reloadHome: function () { S.home = null; loadHome(); },
    homeSearch: homeSearch,
    openCollection: openCollection,
    libInput: libInput,
    libFilter: libFilter,
    openDetail: openDetail,
    toggleFav: toggleFav,
    toggleComplete: toggleComplete,
    ackStart: ackStart,
    ackCancel: ackCancel,
    ackConfirm: ackConfirmFn,
    fbSelect: fbSelect,
    fbSubmit: fbSubmit,
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
    _md: mdRender, // exported for unit tests
    _esc: esc,
  };

})(typeof window !== 'undefined' ? window : this);
