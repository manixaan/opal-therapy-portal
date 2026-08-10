/* ═══════════════════════════════════════════════════════════════════════════
   OPAL FCA REPORT BUILDER — front end for the Functional Capacity Assessment
   report wizard. Renders the entry point into #fca-hub-entry (Resource Hub
   home) and the whole six-step wizard into #fca-root.

   Conventions (mirrors resourcehub.js / casenotes.js / supportpop.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - no raw-HTML passthrough anywhere; every server string renders as text
     - pure helpers exported for node tests (fca-frontend-helpers.test.js)
     - delegated data-fca click/input handlers — no inline onclick carrying
       server-supplied ids into an attribute
     - the backend enforces every boundary; the client only reflects it

   NON-NEGOTIABLES ENCODED HERE:
     1. THE MANIFEST IS THE SINGLE SOURCE OF TRUTH. The preview is built from
        draft.manifest and nothing else. There is deliberately NO section list
        in this file: section tags, labels, descriptions, grouping keys and
        default selections all arrive from GET /api/fca/template, and the
        included/excluded split arrives from the draft the server composed.
        If the manifest is absent the preview says so — it never reconstructs
        one locally, because a locally-invented list would not be what the
        DOCX generator is about to produce.
     2. NEVER INVENT CLIENT DATA. Every scalar value arrives already resolved
        through the server's four-layer precedence (Splose > Opal client
        profile > report override > missing), and every value carries its
        origin in manifest.scalarSources. The badge shown beside a field is
        that origin verbatim — the client NEVER decides where a value came
        from. Anything the server marks 'missing' renders as an explicit
        Missing state. There is not one '|| fallback' to invented text in
        this file. The therapist may TYPE a real value — typed values are
        real data and are sent as scalarOverrides — but nothing is ever
        guessed on their behalf.
     6. SAVING TO THE CLIENT PROFILE IS EXPLICIT AND NARROW. Nothing this
        file does writes to the reusable client profile implicitly: not on
        PATCH, not on Next, not on generate. Only the therapist pressing
        "Save eligible changes to the client's report profile", having ticked
        the individual fields, calls save-to-profile — and only fields the
        server listed in template.profileEligibleTags are even offered.
        Report-specific values are never offered and the UI says so.
     3. REQUIRED SECTIONS CANNOT BE UNCHECKED. They render checked, disabled,
        with a lock affordance and an explanatory tooltip. The server rejects
        it independently; this is the honest reflection of that rule.
     4. NOTHING DOWNLOADS BY ITSELF. Generation is an explicit confirmation
        step, and the finished document is offered as a link the user clicks.
     5. NO CLIENT DATA LEAVES THE PAGE. There is deliberately no console.*
        call, no storage write and no client field in any query string —
        only opaque ids travel in URLs.

   API (fixed contract — consumed exactly, nothing invented):
     GET    /api/fca/template
     GET    /api/fca/clients?q=
     POST   /api/fca/drafts/:id/save-to-profile  { fields: [tag] }
     POST   /api/fca/drafts                      { clientId, therapistProfileId? }
     GET    /api/fca/drafts
     GET    /api/fca/drafts/:id
     PATCH  /api/fca/drafts/:id                  { selectedSections?, sectionOrder?,
                                                   customSections?, scalarOverrides? }
     POST   /api/fca/drafts/:id/generate
     GET    /api/fca/documents/:documentId/download
     DELETE /api/fca/drafts/:id
     GET/POST/DELETE /api/fca/presets
   The one non-/api/fca call is GET /api/therapists — the portal's existing
   owner/admin therapist-profile list, reused (not re-invented) for step 2.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ══ PURE HELPERS (node-exported for unit tests) ═══════════════════════════

  function fcaEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Group buckets for the section picker. These are PRESENTATION buckets, not
  // a section list: the tags, labels and descriptions inside them always come
  // from the template response. A group the server sends that we do not know
  // about is still shown (labelled from the server's own key) rather than
  // dropped, so a template change can never silently hide a section.
  var FCA_GROUP_ORDER = ['required', 'tools', 'domains', 'recommendations', 'appendices', 'other', 'custom'];
  var FCA_GROUP_LABELS = {
    required: 'Required report framework',
    tools: 'Assessment tools',
    domains: 'Functional domains',
    recommendations: 'Recommendation groups',
    appendices: 'Appendices',
    other: 'Other optional sections',
    custom: 'Custom sections',
  };
  var FCA_GROUP_ALIASES = {
    required: 'required', require: 'required', framework: 'required', core: 'required',
    tool: 'tools', tools: 'tools', assessment_tool: 'tools', assessment_tools: 'tools',
    domain: 'domains', domains: 'domains', functional_domain: 'domains', functional_domains: 'domains',
    recommendation: 'recommendations', recommendations: 'recommendations',
    recommendation_group: 'recommendations', recommendation_groups: 'recommendations',
    appendix: 'appendices', appendices: 'appendices',
    custom: 'custom', custom_section: 'custom', custom_sections: 'custom',
  };

  // Title-case an unknown server key for display: 'my_new_group' → 'My new group'.
  function fcaHumanise(key) {
    var words = String(key == null ? '' : key).replace(/[_\-]+/g, ' ').trim().toLowerCase();
    if (!words) return '';
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  // Which bucket a template/manifest section belongs to. `required` always
  // wins so a required section can never be presented as optional.
  function fcaGroupKey(section) {
    if (!section) return 'other';
    if (section.required === true || section.kind === 'required') return 'required';
    if (section.kind === 'custom') return 'custom';
    var raw = String(section.group == null ? '' : section.group).trim().toLowerCase();
    if (!raw) return 'other';
    if (FCA_GROUP_ALIASES[raw]) return FCA_GROUP_ALIASES[raw];
    return raw;
  }

  function fcaGroupLabel(key, sample) {
    if (FCA_GROUP_LABELS[key]) return FCA_GROUP_LABELS[key];
    if (sample && sample.groupLabel) return String(sample.groupLabel);
    return fcaHumanise(key);
  }

  // Group template sections into ordered buckets. Known buckets keep the
  // sequence above; unknown server groups follow, in first-seen order.
  function fcaGroupSections(sections) {
    var list = Array.isArray(sections) ? sections : [];
    var buckets = {}, seen = [];
    list.forEach(function (s) {
      var k = fcaGroupKey(s);
      if (!buckets[k]) { buckets[k] = []; seen.push(k); }
      buckets[k].push(s);
    });
    var keys = [];
    FCA_GROUP_ORDER.forEach(function (k) { if (buckets[k]) keys.push(k); });
    seen.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    return keys.map(function (k) {
      var items = buckets[k].slice().sort(function (a, b) {
        var ao = Number(a.defaultOrder), bo = Number(b.defaultOrder);
        if (isFinite(ao) && isFinite(bo) && ao !== bo) return ao - bo;
        return 0;
      });
      return { key: k, label: fcaGroupLabel(k, items[0]), required: k === 'required', sections: items };
    });
  }

  // A complete, duplicate-free ordering over every known tag. Unknown tags in
  // the stored order are dropped (the template moved on); tags missing from
  // it are appended in defaultOrder sequence, so the order is always total.
  function fcaNormaliseOrder(sectionOrder, sections) {
    var known = [], meta = {};
    (Array.isArray(sections) ? sections : []).forEach(function (s) {
      if (!s || !s.tag) return;
      var t = String(s.tag);
      if (meta[t]) return;
      meta[t] = s;
      known.push(t);
    });
    known.sort(function (a, b) {
      var ao = Number(meta[a].defaultOrder), bo = Number(meta[b].defaultOrder);
      if (isFinite(ao) && isFinite(bo) && ao !== bo) return ao - bo;
      return 0;
    });
    var out = [], seen = {};
    (Array.isArray(sectionOrder) ? sectionOrder : []).forEach(function (t) {
      var k = String(t);
      if (!meta[k] || seen[k]) return;
      seen[k] = true;
      out.push(k);
    });
    known.forEach(function (t) { if (!seen[t]) { seen[t] = true; out.push(t); } });
    return out;
  }

  // Move a tag one place up (-1) or down (+1) — the keyboard equivalent of a
  // drag. Out-of-range moves are no-ops, and the array is never mutated.
  function fcaMoveTag(order, tag, delta) {
    var list = (Array.isArray(order) ? order : []).slice();
    var from = list.indexOf(tag);
    if (from === -1) return list;
    var to = from + (Number(delta) || 0);
    if (to < 0 || to >= list.length) return list;
    list.splice(from, 1);
    list.splice(to, 0, tag);
    return list;
  }

  // Drop `tag` immediately before `beforeTag` (the drag-and-drop equivalent).
  function fcaReorderTo(order, tag, beforeTag) {
    var list = (Array.isArray(order) ? order : []).slice();
    var from = list.indexOf(tag);
    if (from === -1 || tag === beforeTag) return list;
    list.splice(from, 1);
    var at = beforeTag == null ? list.length : list.indexOf(beforeTag);
    if (at === -1) at = list.length;
    list.splice(at, 0, tag);
    return list;
  }

  // Applying a preset can never deselect a required section and can never
  // select a tag the current template does not have. Custom sections the
  // draft already carries are preserved — presets describe template sections.
  function fcaApplyPreset(preset, sections, customSections) {
    var list = Array.isArray(sections) ? sections : [];
    var valid = {}, required = [];
    list.forEach(function (s) {
      if (!s || !s.tag) return;
      valid[String(s.tag)] = true;
      if (s.required === true) required.push(String(s.tag));
    });
    var customTags = (Array.isArray(customSections) ? customSections : [])
      .map(function (c) { return c && c.tag ? String(c.tag) : null; })
      .filter(Boolean);
    customTags.forEach(function (t) { valid[t] = true; });

    var chosen = [], seen = {};
    required.forEach(function (t) { if (!seen[t]) { seen[t] = true; chosen.push(t); } });
    ((preset && preset.selectedSections) || []).forEach(function (t) {
      var k = String(t);
      if (!valid[k] || seen[k]) return;
      seen[k] = true;
      chosen.push(k);
    });
    customTags.forEach(function (t) { if (!seen[t]) { seen[t] = true; chosen.push(t); } });

    var orderable = list.concat(customTags.map(function (t) { return { tag: t, defaultOrder: 9999 }; }));
    return {
      selectedSections: chosen,
      sectionOrder: fcaNormaliseOrder((preset && preset.sectionOrder) || [], orderable),
    };
  }

  // Default selection straight from the template: required always, optional
  // where the template says defaultSelected.
  function fcaDefaultSelection(sections) {
    return (Array.isArray(sections) ? sections : []).filter(function (s) {
      return s && s.tag && (s.required === true || s.defaultSelected === true);
    }).map(function (s) { return String(s.tag); });
  }

  // Human label for a merge tag, derived from the tag itself — never from a
  // hand-maintained dictionary that could drift from the template.
  //   OPAL_CLIENT_NDIS_NUMBER → 'NDIS number' (group 'client')
  var FCA_TAG_ACRONYMS = { ndis: 'NDIS', id: 'ID', dob: 'DOB' };
  function fcaTagParts(tag) {
    var parts = String(tag == null ? '' : tag).split('_').filter(Boolean);
    if (parts.length && parts[0].toUpperCase() === 'OPAL') parts = parts.slice(1);
    return parts;
  }
  function fcaTagGroup(tag) {
    var parts = fcaTagParts(tag);
    if (!parts.length) return 'other';
    return parts[0].toLowerCase();
  }
  function fcaTagLabel(tag) {
    var parts = fcaTagParts(tag);
    if (parts.length > 1) parts = parts.slice(1);
    if (!parts.length) return String(tag == null ? '' : tag);
    var words = parts.map(function (p, i) {
      var low = p.toLowerCase();
      if (FCA_TAG_ACRONYMS[low]) return FCA_TAG_ACRONYMS[low];
      return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    });
    return words.join(' ');
  }

  // ── SOURCE ATTRIBUTION ───────────────────────────────────────────────────
  // The four layers the server resolves, and the ONLY four labels this UI is
  // allowed to show. The mapping is exact and total: an origin the server
  // sends that is not one of these four is treated as 'missing', because the
  // honest answer to "where did this come from?" is never a guess.
  var FCA_SOURCE_LABELS = {
    splose: 'Splose',
    client_profile: 'Opal client profile',
    report_override: 'Entered for this report',
    missing: 'Missing',
  };
  var FCA_SOURCE_ORDER = ['splose', 'client_profile', 'report_override', 'missing'];

  function fcaSourceKey(source) {
    var k = String(source == null ? '' : source).trim().toLowerCase();
    return FCA_SOURCE_LABELS[k] ? k : 'missing';
  }
  function fcaSourceLabel(source) {
    return FCA_SOURCE_LABELS[fcaSourceKey(source)];
  }

  // Step 3 shows fields in three plain buckets. The bucket comes from the tag
  // prefix the template already uses (OPAL_CLIENT_/OPAL_THERAPIST_/OPAL_REPORT_)
  // — no separate list to drift out of step with the template.
  var FCA_FIELD_GROUP_ORDER = ['client', 'therapist', 'report'];
  var FCA_FIELD_GROUP_LABELS = { client: 'Client', therapist: 'Therapist', report: 'Report' };

  function fcaFieldGroupLabel(key) {
    return FCA_FIELD_GROUP_LABELS[key] ? FCA_FIELD_GROUP_LABELS[key] : fcaHumanise(key);
  }

  // THE STEP-3 MODEL. Every field is (value, source) exactly as the server
  // resolved it. `missing` is the server's verdict — scalarSources is the
  // authority; a blank value only decides the matter when the server sent no
  // origin for that tag at all.
  function fcaScalarModel(manifest, profileEligibleTags) {
    var m = manifest && typeof manifest === 'object' ? manifest : {};
    var data = m.scalarData && typeof m.scalarData === 'object' ? m.scalarData : {};
    var sources = m.scalarSources && typeof m.scalarSources === 'object' ? m.scalarSources : {};
    var eligible = {};
    (Array.isArray(profileEligibleTags) ? profileEligibleTags : []).forEach(function (t) {
      eligible[String(t)] = true;
    });

    var buckets = {}, seen = [];
    Object.keys(data).forEach(function (tag) {
      var raw = data[tag];
      var blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
      var hasOrigin = Object.prototype.hasOwnProperty.call(sources, tag);
      var key = hasOrigin ? fcaSourceKey(sources[tag]) : (blank ? 'missing' : 'report_override');
      var missing = key === 'missing' || blank;
      var g = fcaTagGroup(tag);
      if (!buckets[g]) { buckets[g] = []; seen.push(g); }
      buckets[g].push({
        tag: tag,
        label: fcaTagLabel(tag),
        value: missing ? null : String(raw),
        source: missing ? 'missing' : key,
        sourceLabel: fcaSourceLabel(missing ? 'missing' : key),
        missing: missing,
        profileEligible: !!eligible[tag],
      });
    });

    var keys = [];
    FCA_FIELD_GROUP_ORDER.forEach(function (k) { if (buckets[k]) keys.push(k); });
    seen.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    return keys.map(function (k) {
      return { key: k, label: fcaFieldGroupLabel(k), fields: buckets[k] };
    });
  }

  // Which of the therapist's OWN entered values may be offered for saving back
  // to the reusable client profile. Two independent conditions, both required:
  // the server listed the tag as profile-eligible, AND the value actually came
  // from this report (a Splose value is not the therapist's to save, and a
  // value already on the profile has nothing to write).
  function fcaProfileSavableFields(manifest, profileEligibleTags) {
    var out = [];
    fcaScalarModel(manifest, profileEligibleTags).forEach(function (g) {
      g.fields.forEach(function (f) {
        if (f.profileEligible && f.source === 'report_override' && !f.missing) out.push(f);
      });
    });
    return out;
  }

  // What the therapist must know before generating: which fields have no
  // value, grouped the way step 3 shows them. A value is missing when the
  // server says so OR when the composed manifest holds no value for it —
  // blank is blank, and we say so rather than papering over it.
  function fcaMissingSummary(missingFields, scalarData) {
    var data = scalarData && typeof scalarData === 'object' ? scalarData : {};
    var flagged = {}, tags = [];
    (Array.isArray(missingFields) ? missingFields : []).forEach(function (t) {
      var k = String(t);
      if (flagged[k]) return;
      flagged[k] = true;
      tags.push(k);
    });
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      var blank = v == null || (typeof v === 'string' && v.trim() === '');
      if (blank && !flagged[k]) { flagged[k] = true; tags.push(k); }
    });
    var groups = {}, order = [];
    tags.forEach(function (t) {
      var g = fcaTagGroup(t);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push({ tag: t, label: fcaTagLabel(t) });
    });
    return {
      count: tags.length,
      tags: tags,
      groups: order.map(function (g) {
        return { key: g, label: fcaHumanise(g), fields: groups[g] };
      }),
    };
  }

  // THE PREVIEW MODEL. Built from draft.manifest and nothing else: if the
  // server has not composed a manifest yet there is nothing honest to show,
  // so the model reports that instead of reconstructing a list locally.
  function fcaPreviewModel(draft) {
    var d = draft && typeof draft === 'object' ? draft : null;
    var manifest = d && d.manifest && typeof d.manifest === 'object' ? d.manifest : null;
    var base = {
      ready: false,
      clientName: d ? (d.clientName == null ? '' : String(d.clientName)) : '',
      clientPreferredName: d ? (d.clientPreferredName == null ? '' : String(d.clientPreferredName)) : '',
      therapistName: d ? (d.therapistName == null ? '' : String(d.therapistName)) : '',
      templateVersion: d ? (d.templateVersion == null ? '' : String(d.templateVersion)) : '',
      included: [], excluded: [], customCount: 0, scalarGroups: [],
    };
    if (!manifest || !Array.isArray(manifest.sections)) return base;

    var sections = manifest.sections.map(function (s, i) {
      return {
        tag: s && s.tag ? String(s.tag) : '',
        title: s && s.title == null ? '' : String(s.title),
        kind: s && s.kind ? String(s.kind) : '',
        group: fcaGroupKey(s),
        included: !!(s && s.included),
        order: isFinite(Number(s && s.order)) ? Number(s.order) : i,
      };
    }).filter(function (s) { return s.tag; });

    function bySeq(a, b) { return a.order === b.order ? 0 : a.order - b.order; }
    var included = sections.filter(function (s) { return s.included; }).sort(bySeq);
    var excluded = sections.filter(function (s) { return !s.included; }).sort(bySeq);

    base.ready = true;
    base.included = included;
    base.excluded = excluded;
    base.customCount = included.filter(function (s) { return s.kind === 'custom'; }).length;
    // One model, one truth: the preview's field list is the same computation
    // step 3 renders, so a badge and a preview value can never disagree.
    base.scalarGroups = fcaScalarModel(manifest, null);
    return base;
  }

  // Filename PREVIEW only. The server owns the real filename and returns it
  // from generate — this is what we show beforehand so the step-6 summary is
  // not blank, and it is always labelled as an expectation.
  function fcaSanitiseFilePart(s) {
    return String(s == null ? '' : s)
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
  function fcaFilenamePreview(draft, now) {
    var d = draft && typeof draft === 'object' ? draft : {};
    var when = now instanceof Date ? now : new Date();
    var iso = isNaN(when.getTime()) ? '' : when.toISOString().slice(0, 10);
    var client = fcaSanitiseFilePart(d.clientName);
    var parts = ['FCA-Report'];
    if (client) parts.push(client);
    if (iso) parts.push(iso);
    return parts.join('_') + '.docx';
  }

  // Section counts for the step-6 confirmation.
  function fcaSectionCounts(manifest) {
    var sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
    var inc = sections.filter(function (s) { return s && s.included; });
    return {
      total: sections.length,
      included: inc.length,
      excluded: sections.length - inc.length,
      required: inc.filter(function (s) { return s.kind === 'required'; }).length,
      optional: inc.filter(function (s) { return s.kind === 'optional'; }).length,
      custom: inc.filter(function (s) { return s.kind === 'custom'; }).length,
    };
  }

  var helpers = {
    fcaEsc: fcaEsc,
    fcaHumanise: fcaHumanise,
    fcaGroupKey: fcaGroupKey,
    fcaGroupLabel: fcaGroupLabel,
    fcaGroupSections: fcaGroupSections,
    fcaNormaliseOrder: fcaNormaliseOrder,
    fcaMoveTag: fcaMoveTag,
    fcaReorderTo: fcaReorderTo,
    fcaApplyPreset: fcaApplyPreset,
    fcaDefaultSelection: fcaDefaultSelection,
    fcaTagGroup: fcaTagGroup,
    fcaTagLabel: fcaTagLabel,
    fcaSourceKey: fcaSourceKey,
    fcaSourceLabel: fcaSourceLabel,
    fcaFieldGroupLabel: fcaFieldGroupLabel,
    fcaScalarModel: fcaScalarModel,
    fcaProfileSavableFields: fcaProfileSavableFields,
    fcaMissingSummary: fcaMissingSummary,
    fcaPreviewModel: fcaPreviewModel,
    fcaSanitiseFilePart: fcaSanitiseFilePart,
    fcaFilenamePreview: fcaFilenamePreview,
    fcaSectionCounts: fcaSectionCounts,
    FCA_GROUP_ORDER: FCA_GROUP_ORDER,
    FCA_GROUP_LABELS: FCA_GROUP_LABELS,
    FCA_SOURCE_LABELS: FCA_SOURCE_LABELS,
    FCA_SOURCE_ORDER: FCA_SOURCE_ORDER,
    FCA_FIELD_GROUP_ORDER: FCA_FIELD_GROUP_ORDER,
    FCA_FIELD_GROUP_LABELS: FCA_FIELD_GROUP_LABELS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  var doc = global.document;

  // ══ STATE — ONE object; going Back never discards any of it ══════════════

  var S = {
    open: false,
    step: 1,
    furthest: 1,
    template: null, templateErr: '', templateLoading: false,
    // step 1
    q: '', results: null, searching: false, searchErr: '', client: null,
    // step 2
    therapists: null, therapistId: null, therapistErr: '',
    // step 3
    overrides: {},          // tag → typed value, not yet acknowledged by PATCH
    // step 3 — save-to-profile. Deliberately its own state: the panel is
    // closed by default, the ticks start empty, and none of this is ever
    // consulted by PATCH, Next or generate.
    profileOpen: false,     // the panel is disclosed only when asked for
    profilePick: {},        // tag → true, the therapist's explicit ticks
    profileBusy: false,
    profileResult: null,    // { savedFields: [tag], rejected: [{tag,reason}] }
    profileErr: '',
    // step 4
    presets: null, presetName: '', presetErr: '',
    customTitle: '', customGuidance: '', customEditing: null, customErr: '',
    dragTag: null,
    // draft (server truth)
    draft: null, draftErr: '', creating: false,
    save: 'idle',           // idle | saving | saved | error
    saveErr: '',
    // step 5/6
    previewOpen: false,
    generating: false, result: null, genErr: '',
    // hub entry
    drafts: null, draftsLoading: false, draftsErr: '',
    confirmDelete: null,
  };

  var STEPS = [
    { n: 1, label: 'Client' },
    { n: 2, label: 'Therapist' },
    { n: 3, label: 'Review data' },
    { n: 4, label: 'Sections' },
    { n: 5, label: 'Preview' },
    { n: 6, label: 'Generate' },
  ];

  var API = '/api/fca';
  var searchTimer = null, patchTimer = null, pendingPatch = null;

  // ══ PLUMBING ═════════════════════════════════════════════════════════════

  function el(id) { return doc.getElementById(id); }

  function icn(name, size) {
    if (typeof global.opIcon !== 'function') return '';
    var known = global.OP_ICONS && global.OP_ICONS[name];
    return global.opIcon(known ? name : 'doc', size || 14);
  }

  function user() { return global.APP_USER || {}; }

  function fmtWhen(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ', ' + d.toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });
  }

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
        return { ok: false, status: r.status, error: data.error ? String(data.error) : ('Request failed (' + r.status + ')') };
      }
      data.ok = true;
      return data;
    } catch (e) {
      return { ok: false, status: 0, error: 'Network error — your work is still here. Please try again.' };
    }
  }

  // ══ HUB ENTRY POINT ══════════════════════════════════════════════════════

  var STATUS_LABEL = { draft: 'In progress', generated: 'Generated', archived: 'Archived' };

  function statusLabel(s) {
    var k = String(s == null ? '' : s);
    return STATUS_LABEL[k] ? STATUS_LABEL[k] : fcaHumanise(k);
  }

  function renderEntry() {
    var host = el('fca-hub-entry');
    if (!host) return;

    var rows = '';
    if (S.draftsLoading && !S.drafts) {
      rows = '<p class="fca-quiet">Loading your reports…</p>';
    } else if (S.draftsErr) {
      rows = '<p class="fca-quiet">' + fcaEsc(S.draftsErr) +
        ' <button type="button" class="fca-link" data-fca="drafts-reload">Retry</button></p>';
    } else if (!S.drafts || !S.drafts.length) {
      rows = '<p class="fca-quiet">No FCA reports in progress. Starting one takes about a minute.</p>';
    } else {
      rows = '<ul class="fca-draftlist">' + S.drafts.slice(0, 6).map(function (d) {
        var st = String(d.status == null ? '' : d.status);
        return '<li class="fca-draftrow">' +
          '<button type="button" class="fca-draftopen" data-fca="draft-open" data-id="' + fcaEsc(d.id) + '">' +
          '<span class="fca-draftname">' + fcaEsc(d.clientName) + '</span>' +
          '<span class="fca-draftmeta">' +
          '<span class="fca-status fca-status-' + fcaEsc(st) + '">' + fcaEsc(statusLabel(st)) + '</span>' +
          '<span class="fca-quiet">Updated ' + fcaEsc(fmtWhen(d.updatedAt)) + '</span>' +
          '</span></button>' +
          '<button type="button" class="fca-iconbtn" data-fca="draft-archive" data-id="' + fcaEsc(d.id) + '"' +
          ' aria-label="Archive the report for ' + fcaEsc(d.clientName) + '" title="Archive this report">' + icn('trash') + '</button>' +
          '</li>';
      }).join('') + '</ul>';
    }

    host.innerHTML =
      '<section class="fca-entry" aria-labelledby="fca-entry-h">' +
      '<div class="fca-entry-main">' +
      '<span class="fca-entry-icn" aria-hidden="true">' + icn('doc', 20) + '</span>' +
      '<div>' +
      '<h2 id="fca-entry-h">Functional Capacity Assessment reports</h2>' +
      '<p class="fca-entry-sub">Build an FCA report on the Opal template — choose the sections you need, ' +
      'check the details we hold, and download a Word document to finish writing in.</p>' +
      '</div>' +
      '<button type="button" class="fca-btn fca-btn-primary fca-entry-cta" data-fca="start">' +
      icn('plus') + ' Create a new FCA report</button>' +
      '</div>' +
      '<div class="fca-entry-drafts">' +
      '<h3>Your reports in progress</h3>' + rows +
      '</div>' +
      (S.confirmDelete ? renderArchiveConfirm() : '') +
      '</section>';
  }

  function renderArchiveConfirm() {
    var d = (S.drafts || []).filter(function (x) { return x.id === S.confirmDelete; })[0];
    return '<div class="fca-inline-confirm" role="alertdialog" aria-labelledby="fca-arch-h">' +
      '<p id="fca-arch-h"><strong>Archive this report?</strong> ' +
      (d ? 'The draft for ' + fcaEsc(d.clientName) + ' will be archived. ' : '') +
      'It is kept, not deleted, but it leaves this list.</p>' +
      '<div class="fca-row-actions">' +
      '<button type="button" class="fca-btn fca-btn-danger" data-fca="draft-archive-confirm">Archive</button>' +
      '<button type="button" class="fca-btn" data-fca="draft-archive-cancel">Keep it</button>' +
      '</div></div>';
  }

  async function loadDrafts(force) {
    if (S.draftsLoading) return;
    if (S.drafts && !force) return;
    S.draftsLoading = true;
    S.draftsErr = '';
    renderEntry();
    var r = await api(API + '/drafts');
    S.draftsLoading = false;
    if (r.ok) { S.drafts = Array.isArray(r.drafts) ? r.drafts : []; }
    else { S.draftsErr = r.error; }
    renderEntry();
  }

  // The Resource Hub owns #rh2-root and re-renders it wholesale. Rather than
  // editing that file, the entry card lives in its own sibling mount and is
  // shown only while the hub is on its home view (the hub hero is the marker).
  function syncEntryVisibility() {
    var host = el('fca-hub-entry');
    var hub = el('rh2-root');
    if (!host) return;
    var onHome = !hub || !!hub.querySelector('.rh2-hero');
    host.hidden = !onHome;
    if (onHome && !S.drafts && !S.draftsLoading) loadDrafts(false);
  }

  // ══ DRAFT LIFECYCLE ══════════════════════════════════════════════════════

  async function loadTemplate() {
    if (S.template || S.templateLoading) return;
    S.templateLoading = true;
    var r = await api(API + '/template');
    S.templateLoading = false;
    if (r.ok && r.template) { S.template = r.template; S.templateErr = ''; }
    else { S.templateErr = r.error ? r.error : 'The report template could not be loaded.'; }
    render();
  }

  function templateSections() {
    return S.template && Array.isArray(S.template.sections) ? S.template.sections : [];
  }

  // Template sections plus this draft's custom sections — the orderable set.
  function orderableSections() {
    var custom = (S.draft && Array.isArray(S.draft.customSections) ? S.draft.customSections : [])
      .map(function (c) {
        return { tag: String(c.tag), label: String(c.title == null ? '' : c.title), kind: 'custom', group: 'custom', required: false, defaultOrder: 9000 + (Number(c.order) || 0) };
      });
    return templateSections().concat(custom);
  }

  function selectedTags() {
    return S.draft && Array.isArray(S.draft.selectedSections) ? S.draft.selectedSections : [];
  }

  function isSelected(tag) { return selectedTags().indexOf(tag) !== -1; }

  async function createDraft() {
    if (!S.client || S.creating) return;
    S.creating = true; S.draftErr = ''; S.therapistErr = '';
    render();
    var body = { clientId: S.client.id };
    if (S.therapistId && S.therapistId !== user().therapistProfileId) body.therapistProfileId = S.therapistId;
    var r = await api(API + '/drafts', { method: 'POST', body: body });
    S.creating = false;
    if (!r.ok || !r.draft) {
      // The server's own message, verbatim — including a refusal to prepare a
      // report on another therapist's behalf.
      S.therapistErr = r.error;
      render();
      return;
    }
    S.draft = r.draft;
    S.drafts = null; // the hub list is stale now
    goStep(3);
  }

  async function openDraft(id) {
    S.draftErr = '';
    var r = await api(API + '/drafts/' + encodeURIComponent(id));
    if (!r.ok || !r.draft) { S.draftsErr = r.error; renderEntry(); return; }
    S.draft = r.draft;
    S.client = { id: r.draft.clientId, fullName: r.draft.clientName, preferredName: r.draft.clientPreferredName };
    S.therapistId = r.draft.therapistProfileId;
    S.overrides = {};
    S.profileOpen = false; S.profilePick = {}; S.profileResult = null; S.profileErr = '';
    S.result = null; S.genErr = '';
    S.open = true;
    S.step = r.draft.status === 'generated' ? 6 : 4;
    S.furthest = 6;
    loadTemplate();
    loadPresets();
    render();
    focusWizard();
  }

  // Debounced PATCH. The user's state is never rolled back on failure — the
  // local draft stays exactly as they left it and Retry re-sends.
  function queuePatch(patch) {
    pendingPatch = Object.assign({}, pendingPatch || {}, patch);
    S.save = 'saving'; S.saveErr = '';
    paintSave();
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(flushPatch, 600);
  }

  async function flushPatch() {
    if (!S.draft || !pendingPatch) return;
    var body = pendingPatch;
    pendingPatch = null;
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id), { method: 'PATCH', body: body });
    if (!r.ok || !r.draft) {
      S.save = 'error';
      S.saveErr = r.error;
      pendingPatch = Object.assign({}, body, pendingPatch || {});
      paintSave();
      return;
    }
    // Reconcile: the server's manifest replaces the optimistic one.
    S.draft = r.draft;
    S.save = 'saved';
    // Never yank the caret out of a field mid-sentence just because a save
    // landed — repaint the preview and the indicator instead.
    if (typingNow()) { paintSave(); paintPreview(); return; }
    render();
  }

  function typingNow() {
    var a = doc.activeElement;
    if (!a || !a.tagName) return false;
    var tag = a.tagName.toLowerCase();
    return tag === 'textarea' || (tag === 'input' && !/^(checkbox|radio|button)$/i.test(a.type || ''));
  }

  function paintPreview() {
    var node = el('fca-preview');
    if (node) node.innerHTML = renderPreview();
    var inline = doc.querySelector('.fca-preview-inline');
    if (inline) inline.innerHTML = renderPreview();
  }

  function retryPatch() {
    if (!pendingPatch) return;
    S.save = 'saving'; S.saveErr = '';
    paintSave();
    flushPatch();
  }

  // ══ OPTIMISTIC MANIFEST ══════════════════════════════════════════════════
  // The preview always reads draft.manifest. While a PATCH is in flight we
  // flip `included`/`order` ON THE EXISTING manifest entries so the preview
  // reacts instantly — we never build a section list from the template. A
  // brand-new custom section is the one addition, and its title is the
  // therapist's own typed text, not a value invented for them.

  function touchManifest() {
    if (!S.draft || !S.draft.manifest || !Array.isArray(S.draft.manifest.sections)) return;
    var sel = selectedTags();
    var order = Array.isArray(S.draft.sectionOrder) ? S.draft.sectionOrder : [];
    S.draft.manifest.sections.forEach(function (s) {
      if (!s || !s.tag) return;
      s.included = sel.indexOf(String(s.tag)) !== -1;
      var at = order.indexOf(String(s.tag));
      if (at !== -1) s.order = at;
    });
  }

  function setSelection(tags) {
    if (!S.draft) return;
    S.draft.selectedSections = tags;
    touchManifest();
    queuePatch({ selectedSections: tags });
  }

  function setOrder(order) {
    if (!S.draft) return;
    S.draft.sectionOrder = order;
    touchManifest();
    queuePatch({ sectionOrder: order });
  }

  function toggleSection(tag) {
    var meta = orderableSections().filter(function (s) { return String(s.tag) === tag; })[0];
    if (meta && meta.required === true) return; // required sections never move
    var sel = selectedTags().slice();
    var at = sel.indexOf(tag);
    if (at === -1) sel.push(tag); else sel.splice(at, 1);
    setSelection(sel);
    render();
  }

  function selectAllOptional() {
    var sel = orderableSections().map(function (s) { return String(s.tag); });
    setSelection(sel);
    render();
  }

  function clearOptional() {
    var sel = orderableSections().filter(function (s) { return s.required === true; })
      .map(function (s) { return String(s.tag); });
    setSelection(sel);
    render();
  }

  function resetDefaults() {
    var sel = fcaDefaultSelection(templateSections());
    (S.draft && S.draft.customSections ? S.draft.customSections : []).forEach(function (c) { sel.push(String(c.tag)); });
    setSelection(sel);
    render();
  }

  // ══ PRESETS ══════════════════════════════════════════════════════════════

  async function loadPresets() {
    if (S.presets) return;
    var r = await api(API + '/presets');
    S.presets = r.ok && Array.isArray(r.presets) ? r.presets : [];
    render();
  }

  async function savePreset() {
    var name = String(S.presetName).trim();
    if (!name) { S.presetErr = 'Give the preset a name first.'; render(); return; }
    S.presetErr = '';
    var r = await api(API + '/presets', {
      method: 'POST',
      body: { name: name, selectedSections: selectedTags(), sectionOrder: S.draft ? S.draft.sectionOrder : [] },
    });
    if (!r.ok) { S.presetErr = r.error; render(); return; }
    S.presets = (S.presets || []).concat(r.preset ? [r.preset] : []);
    S.presetName = '';
    render();
  }

  function applyPreset(id) {
    var p = (S.presets || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p || !S.draft) return;
    var applied = fcaApplyPreset(p, templateSections(), S.draft.customSections);
    S.draft.selectedSections = applied.selectedSections;
    S.draft.sectionOrder = applied.sectionOrder;
    touchManifest();
    queuePatch({ selectedSections: applied.selectedSections, sectionOrder: applied.sectionOrder });
    render();
  }

  async function deletePreset(id) {
    var r = await api(API + '/presets/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { S.presetErr = r.error; render(); return; }
    S.presets = (S.presets || []).filter(function (x) { return String(x.id) !== String(id); });
    render();
  }

  // ══ CUSTOM SECTIONS ══════════════════════════════════════════════════════

  function customList() {
    return S.draft && Array.isArray(S.draft.customSections) ? S.draft.customSections.slice() : [];
  }

  function saveCustom() {
    var title = String(S.customTitle).trim();
    if (!title) { S.customErr = 'A custom section needs a title.'; render(); return; }
    S.customErr = '';
    var list = customList();
    if (S.customEditing) {
      list = list.map(function (c) {
        return String(c.id) === String(S.customEditing)
          ? Object.assign({}, c, { title: title, guidance: String(S.customGuidance) })
          : c;
      });
    } else {
      // A local id/tag until the server answers; the PATCH response replaces
      // the whole customSections array (and its server-issued tags) verbatim.
      var seq = list.length + 1;
      var localTag = 'CUSTOM_' + seq + '_' + Date.now();
      list.push({ id: localTag, tag: localTag, title: title, guidance: String(S.customGuidance), order: list.length });
      if (S.draft) {
        S.draft.selectedSections = selectedTags().concat([localTag]);
        S.draft.sectionOrder = (S.draft.sectionOrder || []).concat([localTag]);
        if (S.draft.manifest && Array.isArray(S.draft.manifest.sections)) {
          S.draft.manifest.sections.push({
            tag: localTag, kind: 'custom', group: 'custom', title: title,
            included: true, order: S.draft.manifest.sections.length,
          });
        }
      }
    }
    if (S.draft) S.draft.customSections = list;
    S.customTitle = ''; S.customGuidance = ''; S.customEditing = null;
    touchManifest();
    queuePatch({ customSections: list, selectedSections: selectedTags(), sectionOrder: S.draft ? S.draft.sectionOrder : [] });
    render();
  }

  function editCustom(id) {
    var c = customList().filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    S.customEditing = String(c.id);
    S.customTitle = String(c.title == null ? '' : c.title);
    S.customGuidance = String(c.guidance == null ? '' : c.guidance);
    render();
  }

  function removeCustom(id) {
    var list = customList().filter(function (x) { return String(x.id) !== String(id); });
    var tag = String(id);
    if (S.draft) {
      var gone = customList().filter(function (x) { return String(x.id) === String(id); })[0];
      if (gone) tag = String(gone.tag);
      S.draft.customSections = list;
      S.draft.selectedSections = selectedTags().filter(function (t) { return t !== tag; });
      S.draft.sectionOrder = (S.draft.sectionOrder || []).filter(function (t) { return t !== tag; });
      if (S.draft.manifest && Array.isArray(S.draft.manifest.sections)) {
        S.draft.manifest.sections = S.draft.manifest.sections.filter(function (s) { return String(s.tag) !== tag; });
      }
    }
    if (S.customEditing === String(id)) { S.customEditing = null; S.customTitle = ''; S.customGuidance = ''; }
    queuePatch({ customSections: list, selectedSections: selectedTags(), sectionOrder: S.draft ? S.draft.sectionOrder : [] });
    render();
  }

  // ══ CLIENT SEARCH ════════════════════════════════════════════════════════

  function searchClients(q) {
    S.q = q;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(async function () {
      var query = String(S.q).trim();
      if (query.length < 2) { S.results = null; S.searching = false; paintResults(); return; }
      S.searching = true; S.searchErr = '';
      paintResults();
      var r = await api(API + '/clients?q=' + encodeURIComponent(query));
      S.searching = false;
      if (r.ok) { S.results = Array.isArray(r.clients) ? r.clients : []; S.searchErr = ''; }
      else { S.results = null; S.searchErr = r.error; }
      paintResults();
    }, 300);
  }

  function chooseClient(id) {
    var c = (S.results || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    S.client = c;
    S.draft = null;      // a different client means a different draft
    S.result = null;
    // A different client must never inherit the previous one's typed values
    // or their pending save-to-profile ticks.
    S.overrides = {};
    S.profileOpen = false; S.profilePick = {}; S.profileResult = null; S.profileErr = '';
    goStep(2);
  }

  // ══ GENERATE ═════════════════════════════════════════════════════════════

  async function generate() {
    if (!S.draft || S.generating) return;
    if (pendingPatch) { await flushPatch(); }
    S.generating = true; S.genErr = ''; S.result = null;
    render();
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id) + '/generate', { method: 'POST' });
    S.generating = false;
    if (!r.ok) { S.genErr = r.error; render(); return; }
    S.result = {
      documentId: r.documentId,
      filename: r.filename,
      missingFields: Array.isArray(r.missingFields) ? r.missingFields : [],
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
    };
    S.drafts = null;
    render();
  }

  // ══ WIZARD RENDER ════════════════════════════════════════════════════════

  function root() { return el('fca-root'); }

  function canEnter(step) {
    if (step <= 1) return true;
    if (step === 2) return !!S.client;
    return !!S.draft;
  }

  function goStep(n) {
    if (!canEnter(n)) return;
    S.step = n;
    if (window.OpalNav) window.OpalNav.pushStep('fca', n);
    if (n > S.furthest) S.furthest = n;
    if (n >= 4) loadPresets();
    render();
    var h = el('fca-step-h');
    if (h) { try { h.focus(); } catch (e) { /* not focusable */ } }
  }

  function renderStepper() {
    return '<nav class="fca-stepper" aria-label="Report steps"><ol>' + STEPS.map(function (s) {
      var state = S.step === s.n ? 'current' : (s.n < S.step ? 'done' : 'todo');
      var reachable = canEnter(s.n) && s.n <= S.furthest;
      return '<li class="fca-step fca-step-' + state + '">' +
        '<button type="button" class="fca-stepbtn" data-fca="step" data-step="' + s.n + '"' +
        (reachable ? '' : ' disabled aria-disabled="true"') +
        (S.step === s.n ? ' aria-current="step"' : '') + '>' +
        '<span class="fca-stepnum" aria-hidden="true">' + s.n + '</span>' +
        '<span class="fca-steplabel">' + fcaEsc(s.label) + '</span></button></li>';
    }).join('') + '</ol></nav>';
  }

  function renderSaveIndicator() {
    var txt = '', cls = '';
    if (S.save === 'saving') { txt = 'Saving…'; cls = ' fca-saving'; }
    else if (S.save === 'saved') { txt = 'All changes saved'; cls = ' fca-saved'; }
    else if (S.save === 'error') { txt = S.saveErr ? S.saveErr : 'Could not save your changes.'; cls = ' fca-savefail'; }
    return '<div class="fca-saveind' + cls + '" id="fca-saveind" role="status" aria-live="polite">' +
      fcaEsc(txt) +
      (S.save === 'error' ? ' <button type="button" class="fca-link" data-fca="retry-save">Retry</button>' : '') +
      '</div>';
  }

  function paintSave() {
    var node = el('fca-saveind');
    if (!node) return;
    node.outerHTML = renderSaveIndicator();
  }

  function render() {
    var host = root();
    if (!host) return;
    host.hidden = !S.open;
    if (!S.open) { host.innerHTML = ''; return; }

    // Ids are deterministic, so focus survives a rebuild: toggling a section
    // checkbox with the keyboard leaves the focus on that same checkbox.
    var active = doc.activeElement;
    var keepId = active && active.id ? active.id : null;
    var showPreview = S.step >= 4;
    host.innerHTML =
      '<div class="fca-shell" role="dialog" aria-modal="true" aria-labelledby="fca-title">' +
      '<header class="fca-head">' +
      '<div><h1 id="fca-title">Functional Capacity Assessment report</h1>' +
      '<p class="fca-quiet">' + fcaEsc(headSubtitle()) + '</p></div>' +
      '<div class="fca-head-right">' + renderSaveIndicator() +
      '<button type="button" class="fca-iconbtn" data-fca="close" aria-label="Close the report builder">' + icn('ban') + '</button>' +
      '</div></header>' +
      renderStepper() +
      '<div class="fca-body' + (showPreview ? ' fca-body-split' : '') + '">' +
      '<main class="fca-main" id="fca-step-body">' + renderStep() + '</main>' +
      (showPreview
        ? '<button type="button" class="fca-preview-toggle" data-fca="preview-toggle" aria-expanded="' + (S.previewOpen ? 'true' : 'false') + '" aria-controls="fca-preview">' +
          icn('doc') + ' ' + (S.previewOpen ? 'Hide preview' : 'Show preview') + '</button>' +
          '<aside class="fca-preview' + (S.previewOpen ? ' fca-preview-open' : '') + '" id="fca-preview" aria-label="Report preview">' +
          renderPreview() + '</aside>'
        : '') +
      '</div>' +
      renderFooter() +
      '</div>';

    if (keepId) {
      var again = el(keepId);
      if (again) { try { again.focus(); } catch (e) { /* removed by this render */ } }
    }
  }

  function headSubtitle() {
    if (!S.client) return 'Step ' + S.step + ' of 6';
    var who = S.client.fullName == null ? '' : String(S.client.fullName);
    return who + ' · step ' + S.step + ' of 6';
  }

  function renderFooter() {
    var back = S.step > 1
      ? '<button type="button" class="fca-btn" data-fca="back">Back</button>'
      : '<span></span>';
    var next = '';
    if (S.step === 1) next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="next"' + (S.client ? '' : ' disabled') + '>Continue</button>';
    else if (S.step === 2) next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="confirm-therapist"' + (S.creating ? ' disabled' : '') + '>' + (S.creating ? 'Preparing…' : 'Confirm and continue') + '</button>';
    else if (S.step < 6) next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="next">Continue</button>';
    return '<footer class="fca-foot">' + back +
      '<span class="fca-foot-note">Your progress is saved as you go — closing this window does not lose it.</span>' +
      next + '</footer>';
  }

  function renderStep() {
    if (S.step === 1) return renderStepClient();
    if (S.step === 2) return renderStepTherapist();
    if (S.step === 3) return renderStepData();
    if (S.step === 4) return renderStepSections();
    if (S.step === 5) return renderStepPreview();
    return renderStepGenerate();
  }

  // ── Step 1: client ────────────────────────────────────────────────────────

  function renderStepClient() {
    return '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Who is this report for?</h2>' +
      '<p class="fca-quiet">Search the practice records. Client details come from Splose — only what Splose holds is available here.</p>' +
      '<div class="fca-searchbar">' + icn('search', 16) +
      '<label class="fca-sr-only" for="fca-q">Search clients by name</label>' +
      '<input type="search" id="fca-q" data-fca-input="q" autocomplete="off" placeholder="Search by name…" value="' + fcaEsc(S.q) + '">' +
      '</div>' +
      '<div id="fca-results" role="region" aria-live="polite">' + renderResults() + '</div>' +
      (S.client
        ? '<div class="fca-chosen"><strong>Selected:</strong> ' + fcaEsc(S.client.fullName) +
          (S.client.ndisNumber ? ' <span class="fca-quiet">· NDIS ' + fcaEsc(S.client.ndisNumber) + '</span>' : '') + '</div>'
        : '');
  }

  function renderResults() {
    if (S.searching) return '<p class="fca-quiet">Searching…</p>';
    if (S.searchErr) return '<p class="fca-err">' + fcaEsc(S.searchErr) + '</p>';
    if (S.results === null) return '<p class="fca-quiet">Type at least two characters to search.</p>';
    if (!S.results.length) return '<p class="fca-quiet">No clients matched that search.</p>';
    return '<ul class="fca-results">' + S.results.map(function (c) {
      var sel = S.client && String(S.client.id) === String(c.id);
      return '<li><button type="button" class="fca-result' + (sel ? ' fca-result-on' : '') + '"' +
        ' data-fca="pick-client" data-id="' + fcaEsc(c.id) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        '<span class="fca-result-name">' + fcaEsc(c.fullName) +
        // A quiet marker only: a saved profile means fewer blanks to fill,
        // it is never a reason to prefer one client over another.
        (c.hasProfile ? ' <span class="fca-profilechip">' + icn('check') + ' Has saved profile</span>' : '') +
        '</span>' +
        '<span class="fca-quiet">' +
        (c.ndisNumber ? 'NDIS ' + fcaEsc(c.ndisNumber) : '<em>No NDIS number on file</em>') +
        (c.email ? ' · ' + fcaEsc(c.email) : '') + '</span></button></li>';
    }).join('') + '</ul>';
  }

  function paintResults() {
    var node = el('fca-results');
    if (node) node.innerHTML = renderResults();
  }

  // ── Step 2: therapist ─────────────────────────────────────────────────────

  function renderStepTherapist() {
    var u = user();
    var mine = u.displayName ? u.displayName : u.name;
    var out = '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Who is preparing this report?</h2>' +
      '<p class="fca-quiet">The preparing therapist is named in the declaration and in the report header.</p>' +
      '<div class="fca-card"><p class="fca-strong">' + fcaEsc(mine) + '</p>' +
      '<p class="fca-quiet">Signed in as you' + (u.roleTitle ? ' · ' + fcaEsc(u.roleTitle) : '') + '</p></div>';

    if (u.canViewMasterCalendar && Array.isArray(S.therapists) && S.therapists.length > 1) {
      out += '<label class="fca-lbl" for="fca-therapist">Prepare on behalf of</label>' +
        '<select class="fca-input" id="fca-therapist" data-fca-change="therapist">' +
        '<option value="">' + fcaEsc(mine) + ' (me)</option>' +
        S.therapists.map(function (t) {
          if (String(t.id) === String(u.therapistProfileId)) return '';
          return '<option value="' + fcaEsc(t.id) + '"' + (String(S.therapistId) === String(t.id) ? ' selected' : '') + '>' +
            fcaEsc(t.displayName) + '</option>';
        }).join('') + '</select>' +
        '<p class="fca-quiet">The server decides whether preparing on another therapist\'s behalf is allowed.</p>';
    }
    if (S.therapistErr) out += '<p class="fca-err" role="alert">' + fcaEsc(S.therapistErr) + '</p>';
    return out;
  }

  async function loadTherapists() {
    if (S.therapists || !user().canViewMasterCalendar) return;
    var r = await api('/api/therapists');
    if (!r.ok) { S.therapists = []; return; }
    S.therapists = (r.profiles || []).map(function (p) {
      return { id: p.id, displayName: p.display_name == null ? '' : String(p.display_name) };
    });
    render();
  }

  // ── Step 3: review data ───────────────────────────────────────────────────

  // Every field in step 3 is rendered from the manifest the server composed:
  // the value, and beside it the layer that value came from. The four badge
  // labels are fixed and total (see FCA_SOURCE_LABELS) — this file never
  // decides an origin, it only reports the one the server resolved.
  function renderStepData() {
    var manifest = S.draft && S.draft.manifest ? S.draft.manifest : null;
    var groups = fcaScalarModel(manifest, profileEligibleTags());
    var total = groups.reduce(function (n, g) { return n + g.fields.length; }, 0);
    var missingCount = groups.reduce(function (n, g) {
      return n + g.fields.filter(function (f) { return f.missing; }).length;
    }, 0);

    var out = '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Check the details we hold</h2>' +
      '<div class="fca-note fca-note-warn">' + icn('alert') +
      '<div><p><strong>Nothing here is guessed.</strong> Each field below shows where its value came from. ' +
      'Fields marked <em>Missing</em> have no source anywhere in the system — you can type a real value now, ' +
      'or leave them blank, in which case they appear in the Word document as a clearly marked placeholder ' +
      'for you to complete there.</p>' +
      (total
        ? '<p class="fca-quiet">' + missingCount + ' of ' + total + ' fields have no value yet.</p>'
        : '') +
      '</div></div>';

    if (!groups.length) {
      return out + '<p class="fca-quiet">The report data has not been composed yet.</p>';
    }

    out += renderSourceLegend();

    out += groups.map(function (g) {
      return '<section class="fca-card" aria-labelledby="fca-sg-' + fcaEsc(g.key) + '">' +
        '<h3 id="fca-sg-' + fcaEsc(g.key) + '">' + fcaEsc(g.label) + '</h3>' +
        '<dl class="fca-fields">' + g.fields.map(renderDataField).join('') + '</dl></section>';
    }).join('');

    out += renderSaveToProfile();

    out += '<p class="fca-quiet" id="fca-ov-help">Anything you type here is stored with this report exactly as you enter it. ' +
      'Do not enter a value you are not certain of.</p>';
    return out;
  }

  function renderSourceLegend() {
    return '<div class="fca-legend"><span class="fca-legend-lbl">Where values come from:</span>' +
      FCA_SOURCE_ORDER.map(function (k) {
        return '<span class="fca-badge fca-badge-' + fcaEsc(k) + '">' + fcaEsc(FCA_SOURCE_LABELS[k]) + '</span>';
      }).join('') +
      '<span class="fca-quiet">Splose is the practice record and always wins; the Opal client profile fills durable ' +
      'gaps Splose does not hold; anything you type applies to this report only.</span></div>';
  }

  function renderDataField(f) {
    var id = 'fca-ov-' + f.tag;
    var typed = S.overrides[f.tag];
    var shown = typed === undefined ? (f.value === null ? '' : f.value) : typed;
    return '<div class="fca-field' + (f.missing ? ' fca-field-missing' : '') + '">' +
      '<dt><label for="' + fcaEsc(id) + '">' + fcaEsc(f.label) + '</label></dt>' +
      '<dd>' +
      '<span class="fca-fieldtop">' +
      // The value slot states the fact; the badge beside it states the layer.
      // They do not repeat the same word — together they read "no value / and
      // the reason is that no layer holds one".
      (f.missing
        ? '<span class="fca-missing">' + icn('alert') + ' No value</span>'
        : '<span class="fca-value">' + fcaEsc(f.value) + '</span>') +
      '<span class="fca-badge fca-badge-' + fcaEsc(f.source) + '">' + fcaEsc(f.sourceLabel) + '</span>' +
      '</span>' +
      '<input type="text" class="fca-input fca-input-sm" id="' + fcaEsc(id) + '"' +
      ' data-fca-input="override" data-tag="' + fcaEsc(f.tag) + '"' +
      ' value="' + fcaEsc(shown) + '"' +
      ' placeholder="' + (f.missing ? 'Type the real value, or leave blank' : 'Correct this value for this report') + '"' +
      ' aria-describedby="fca-ov-help">' +
      '</dd></div>';
  }

  // ── SAVE BACK TO THE CLIENT PROFILE ───────────────────────────────────────
  // Explicit, permissioned and narrow. Only values the therapist entered for
  // THIS report, and only tags the server declared profile-eligible, are ever
  // offered. Nothing here runs on PATCH, on Next or on generate.
  function renderSaveToProfile() {
    var savable = fcaProfileSavableFields(S.draft ? S.draft.manifest : null, profileEligibleTags());

    var out = '<section class="fca-card fca-profile" aria-labelledby="fca-profile-h">' +
      '<h3 id="fca-profile-h">' + icn('user') + ' Reuse these details on the client\'s next report</h3>' +
      '<p class="fca-quiet">The Opal client profile is a durable record for this client, shared across their reports. ' +
      'Saving is never automatic — nothing below is written unless you tick it and press the button.</p>' +
      '<p class="fca-quiet"><strong>Report-specific values are never saved:</strong> report date, document ID, version and ' +
      'status, reviewer, authorised recipients, the referral reason and assessment purpose, and your clinical ' +
      'conclusions all stay with this report alone.</p>';

    if (!savable.length) {
      out += '<p class="fca-quiet">Nothing to save yet — this offers the durable client details you have typed ' +
        'yourself on this step, once you have entered some.</p></section>';
      return out;
    }

    if (!S.profileOpen) {
      out += '<div class="fca-row-actions">' +
        '<button type="button" class="fca-btn" data-fca="profile-open" aria-expanded="false" aria-controls="fca-profile-pick">' +
        'Review ' + savable.length + ' detail(s) you could reuse</button></div></section>';
      return out;
    }

    out += '<div id="fca-profile-pick">' +
      '<p class="fca-strong">These values you entered can be saved to the client\'s report profile:</p>' +
      '<ul class="fca-picklist">' + savable.map(function (f) {
        var id = 'fca-pp-' + f.tag;
        return '<li><input type="checkbox" id="' + fcaEsc(id) + '"' +
          (S.profilePick[f.tag] ? ' checked' : '') +
          ' data-fca-check="profile-pick" data-tag="' + fcaEsc(f.tag) + '">' +
          '<label for="' + fcaEsc(id) + '"><span class="fca-secname">' + fcaEsc(f.label) + '</span>' +
          '<span class="fca-secdesc">' + fcaEsc(f.value) + '</span></label></li>';
      }).join('') + '</ul>';

    var picked = savable.filter(function (f) { return S.profilePick[f.tag]; }).length;
    out += (S.profileErr ? '<p class="fca-err" role="alert">' + fcaEsc(S.profileErr) + '</p>' : '') +
      '<div class="fca-row-actions">' +
      '<button type="button" class="fca-btn fca-btn-primary" data-fca="profile-save"' +
      (S.profileBusy || !picked ? ' disabled' : '') + '>' +
      (S.profileBusy ? 'Saving…' : 'Save eligible changes to the client\'s report profile') + '</button>' +
      '<button type="button" class="fca-btn" data-fca="profile-close">Not now</button>' +
      '</div>' +
      '<p class="fca-quiet" role="status" aria-live="polite">' +
      (picked ? picked + ' of ' + savable.length + ' selected.' : 'Tick the details you want kept for next time.') +
      '</p></div>';

    // The server's answer, verbatim — including anything it refused.
    if (S.profileResult) {
      var saved = S.profileResult.savedFields || [];
      var rejected = S.profileResult.rejected || [];
      if (saved.length) {
        out += '<div class="fca-note fca-note-ok">' + icn('check') +
          '<div><p><strong>Saved to the client\'s profile:</strong> ' +
          saved.map(function (t) { return fcaEsc(fcaTagLabel(t)); }).join(', ') + '</p></div></div>';
      }
      if (rejected.length) {
        out += '<div class="fca-note fca-note-warn">' + icn('alert') +
          '<div><p><strong>Not saved:</strong></p><ul>' +
          rejected.map(function (r) {
            return '<li>' + fcaEsc(fcaTagLabel(r && r.tag)) +
              (r && r.reason ? ' — ' + fcaEsc(r.reason) : '') + '</li>';
          }).join('') + '</ul></div></div>';
      }
      if (!saved.length && !rejected.length) {
        out += '<p class="fca-quiet">The server saved nothing and reported no reason.</p>';
      }
    }
    return out + '</section>';
  }

  function profileEligibleTags() {
    return S.template && Array.isArray(S.template.profileEligibleTags) ? S.template.profileEligibleTags : [];
  }

  async function saveToProfile() {
    if (!S.draft || S.profileBusy) return;
    var savable = fcaProfileSavableFields(S.draft.manifest, profileEligibleTags());
    var fields = savable.filter(function (f) { return S.profilePick[f.tag]; })
      .map(function (f) { return f.tag; });
    if (!fields.length) return;
    // Anything still queued is the therapist's own typing — land it first so
    // the server saves the value they can actually see on screen.
    if (pendingPatch) await flushPatch();
    S.profileBusy = true; S.profileErr = ''; S.profileResult = null;
    render();
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id) + '/save-to-profile', {
      method: 'POST', body: { fields: fields },
    });
    S.profileBusy = false;
    if (!r.ok) { S.profileErr = r.error; render(); return; }
    S.profileResult = {
      savedFields: Array.isArray(r.savedFields) ? r.savedFields : [],
      rejected: Array.isArray(r.rejected) ? r.rejected : [],
    };
    // Clear only what the server confirmed it saved.
    S.profileResult.savedFields.forEach(function (t) { delete S.profilePick[t]; });
    render();
  }

  function setOverride(tag, value) {
    S.overrides[tag] = value;
    var payload = {};
    Object.keys(S.overrides).forEach(function (k) {
      var v = String(S.overrides[k]).trim();
      payload[k] = v === '' ? null : v;
    });
    queuePatch({ scalarOverrides: payload });
  }

  // ── Step 4: sections ──────────────────────────────────────────────────────

  function renderStepSections() {
    if (S.templateErr) {
      return '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Choose the sections</h2>' +
        '<p class="fca-err">' + fcaEsc(S.templateErr) + '</p>';
    }
    if (!S.template) {
      loadTemplate();
      return '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Choose the sections</h2><p class="fca-quiet">Loading the template…</p>';
    }

    var groups = fcaGroupSections(orderableSections());
    var out = '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Choose the sections</h2>' +
      '<p class="fca-quiet">Every section you include is written into the Word document with its Opal styling and drafting prompts. ' +
      'Excluded optional sections are removed cleanly.</p>' +
      '<div class="fca-toolbar">' +
      '<button type="button" class="fca-btn" data-fca="select-all">Select all optional sections</button>' +
      '<button type="button" class="fca-btn" data-fca="clear-all">Clear optional selections</button>' +
      '<button type="button" class="fca-btn" data-fca="reset-defaults">Reset to defaults</button>' +
      '</div>' + renderPresets();

    out += groups.map(function (g) {
      return '<section class="fca-card" aria-labelledby="fca-g-' + fcaEsc(g.key) + '">' +
        '<h3 id="fca-g-' + fcaEsc(g.key) + '">' + fcaEsc(g.label) +
        (g.required ? ' <span class="fca-lockchip">' + icn('lock') + ' Always included</span>' : '') + '</h3>' +
        (g.required
          ? '<p class="fca-quiet">These sections form the assessment report itself and cannot be removed.</p>'
          : '') +
        '<ul class="fca-seclist">' + g.sections.map(function (s) { return renderSectionItem(s, g.required); }).join('') + '</ul>' +
        (g.key === 'custom' ? renderCustomForm() : '') +
        '</section>';
    }).join('');

    if (groups.filter(function (g) { return g.key === 'custom'; }).length === 0) {
      out += '<section class="fca-card" aria-labelledby="fca-g-custom"><h3 id="fca-g-custom">Custom sections</h3>' +
        '<p class="fca-quiet">Add a section of your own — it is inserted at the custom-section anchor in the template.</p>' +
        renderCustomForm() + '</section>';
    }

    out += renderOrderList();
    return out;
  }

  function renderSectionItem(s, locked) {
    var tag = String(s.tag);
    var id = 'fca-sec-' + tag;
    var on = locked || isSelected(tag);
    var desc = s.description == null ? '' : String(s.description);
    return '<li class="fca-secitem' + (locked ? ' fca-secitem-locked' : '') + '">' +
      '<input type="checkbox" id="' + fcaEsc(id) + '"' +
      (on ? ' checked' : '') +
      (locked ? ' disabled aria-disabled="true"' : '') +
      ' data-fca-check="section" data-tag="' + fcaEsc(tag) + '">' +
      '<label for="' + fcaEsc(id) + '">' +
      '<span class="fca-secname">' + fcaEsc(s.label == null ? s.title : s.label) +
      (locked ? ' <span class="fca-lockicn" title="Required by the Opal template — this section cannot be removed" aria-label="Required section, cannot be removed">' + icn('lock') + '</span>' : '') +
      '</span>' +
      (desc ? '<span class="fca-secdesc">' + fcaEsc(desc) + '</span>' : '') +
      '</label></li>';
  }

  function renderPresets() {
    var list = S.presets || [];
    return '<div class="fca-presets">' +
      '<label class="fca-lbl" for="fca-preset-name">Section presets</label>' +
      '<div class="fca-presetrow">' +
      '<input type="text" class="fca-input" id="fca-preset-name" data-fca-input="preset-name" placeholder="Name this selection…" value="' + fcaEsc(S.presetName) + '">' +
      '<button type="button" class="fca-btn" data-fca="preset-save">Save preset</button>' +
      '</div>' +
      (list.length
        ? '<ul class="fca-presetlist">' + list.map(function (p) {
            return '<li><button type="button" class="fca-chip" data-fca="preset-apply" data-id="' + fcaEsc(p.id) + '">' +
              fcaEsc(p.name) + '</button>' +
              '<button type="button" class="fca-iconbtn" data-fca="preset-delete" data-id="' + fcaEsc(p.id) + '"' +
              ' aria-label="Delete the preset ' + fcaEsc(p.name) + '">' + icn('trash') + '</button></li>';
          }).join('') + '</ul>'
        : '<p class="fca-quiet">No presets saved yet.</p>') +
      (S.presetErr ? '<p class="fca-err">' + fcaEsc(S.presetErr) + '</p>' : '') +
      '</div>';
  }

  function renderCustomForm() {
    var list = customList();
    return '<div class="fca-custom">' +
      (list.length
        ? '<ul class="fca-customlist">' + list.map(function (c) {
            return '<li><span class="fca-secname">' + fcaEsc(c.title) + '</span>' +
              (c.guidance ? '<span class="fca-secdesc">' + fcaEsc(c.guidance) + '</span>' : '') +
              '<span class="fca-row-actions">' +
              '<button type="button" class="fca-iconbtn" data-fca="custom-edit" data-id="' + fcaEsc(c.id) + '" aria-label="Edit ' + fcaEsc(c.title) + '">' + icn('edit') + '</button>' +
              '<button type="button" class="fca-iconbtn" data-fca="custom-remove" data-id="' + fcaEsc(c.id) + '" aria-label="Remove ' + fcaEsc(c.title) + '">' + icn('trash') + '</button>' +
              '</span></li>';
          }).join('') + '</ul>'
        : '') +
      '<label class="fca-lbl" for="fca-custom-title">Custom section title</label>' +
      '<input type="text" class="fca-input" id="fca-custom-title" data-fca-input="custom-title" value="' + fcaEsc(S.customTitle) + '" placeholder="e.g. Sensory profile">' +
      '<label class="fca-lbl" for="fca-custom-guide">Drafting guidance (optional)</label>' +
      '<textarea class="fca-input" id="fca-custom-guide" rows="2" data-fca-input="custom-guidance" placeholder="A prompt to yourself for what belongs in this section">' + fcaEsc(S.customGuidance) + '</textarea>' +
      (S.customErr ? '<p class="fca-err">' + fcaEsc(S.customErr) + '</p>' : '') +
      '<div class="fca-row-actions">' +
      '<button type="button" class="fca-btn" data-fca="custom-save">' + (S.customEditing ? 'Update section' : 'Add custom section') + '</button>' +
      (S.customEditing ? '<button type="button" class="fca-btn" data-fca="custom-cancel">Cancel</button>' : '') +
      '</div></div>';
  }

  // Ordering list — drag with a mouse, or move with the buttons. Both drive
  // the same setOrder(), so the keyboard path is not a degraded fallback.
  function renderOrderList() {
    var model = fcaPreviewModel(S.draft);
    if (!model.ready) return '';
    var items = model.included;
    return '<section class="fca-card" aria-labelledby="fca-order-h">' +
      '<h3 id="fca-order-h">Order of sections</h3>' +
      '<p class="fca-quiet">Drag to reorder, or use the move buttons — both work the same way.</p>' +
      '<ul class="fca-orderlist" id="fca-orderlist">' + items.map(function (s, i) {
        return '<li class="fca-orderitem" draggable="true" data-tag="' + fcaEsc(s.tag) + '">' +
          '<span class="fca-grip" aria-hidden="true">' + icn('refresh') + '</span>' +
          '<span class="fca-ordername">' + fcaEsc(s.title) + '</span>' +
          '<span class="fca-row-actions">' +
          '<button type="button" class="fca-iconbtn" data-fca="move-up" data-tag="' + fcaEsc(s.tag) + '"' +
          (i === 0 ? ' disabled' : '') + ' aria-label="Move ' + fcaEsc(s.title) + ' earlier">↑</button>' +
          '<button type="button" class="fca-iconbtn" data-fca="move-down" data-tag="' + fcaEsc(s.tag) + '"' +
          (i === items.length - 1 ? ' disabled' : '') + ' aria-label="Move ' + fcaEsc(s.title) + ' later">↓</button>' +
          '</span></li>';
      }).join('') + '</ul></section>';
  }

  // ── Step 5: preview (full width) ──────────────────────────────────────────

  function renderStepPreview() {
    return '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Preview</h2>' +
      '<p class="fca-quiet">This is the structure of the document that will be produced — read from the report the server has composed, not a local guess.</p>' +
      '<div class="fca-preview-inline">' + renderPreview() + '</div>';
  }

  function renderPreview() {
    var model = fcaPreviewModel(S.draft);
    if (!model.ready) {
      return '<div class="fca-doc"><p class="fca-quiet">The preview appears once the report has been composed on the server.</p></div>';
    }
    var out = '<div class="fca-doc">' +
      '<div class="fca-doc-brand">' + icn('doc', 16) + ' Opal Therapy Services</div>' +
      '<h3 class="fca-doc-title">Functional Capacity Assessment Report</h3>' +
      '<dl class="fca-doc-meta">' +
      '<div><dt>Client</dt><dd>' + (model.clientName ? fcaEsc(model.clientName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      (model.clientPreferredName ? '<div><dt>Preferred name</dt><dd>' + fcaEsc(model.clientPreferredName) + '</dd></div>' : '') +
      '<div><dt>Prepared by</dt><dd>' + (model.therapistName ? fcaEsc(model.therapistName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      (model.templateVersion ? '<div><dt>Template</dt><dd>' + fcaEsc(model.templateVersion) + '</dd></div>' : '') +
      '</dl>';

    out += '<h4 class="fca-doc-h">Contents</h4>' +
      (model.included.length
        ? '<ol class="fca-doc-toc">' + model.included.map(function (s) {
            return '<li>' + fcaEsc(s.title) +
              (s.kind === 'custom' ? ' <span class="fca-tag-custom">Custom</span>' : '') + '</li>';
          }).join('') + '</ol>'
        : '<p class="fca-quiet">No sections are included yet.</p>');

    out += '<h4 class="fca-doc-h">Included sections</h4><ul class="fca-doc-secs">' +
      model.included.map(function (s) {
        return '<li><span class="fca-doc-sec">' + fcaEsc(s.title) + '</span>' +
          '<span class="fca-quiet">' + fcaEsc(fcaGroupLabel(s.group)) + '</span></li>';
      }).join('') + '</ul>';

    if (model.excluded.length) {
      out += '<h4 class="fca-doc-h fca-doc-h-out">Not included (' + model.excluded.length + ')</h4>' +
        '<ul class="fca-doc-secs fca-doc-out">' + model.excluded.map(function (s) {
          return '<li><span class="fca-doc-sec">' + fcaEsc(s.title) + '</span>' +
            '<span class="fca-quiet">' + fcaEsc(fcaGroupLabel(s.group)) + '</span></li>';
        }).join('') + '</ul>';
    }
    return out + '</div>';
  }

  // ── Step 6: generate ──────────────────────────────────────────────────────

  function renderStepGenerate() {
    var counts = fcaSectionCounts(S.draft ? S.draft.manifest : null);
    var summary = fcaMissingSummary(S.draft ? S.draft.missingFields : [], S.draft && S.draft.manifest ? S.draft.manifest.scalarData : {});
    var model = fcaPreviewModel(S.draft);

    var out = '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Generate the document</h2>';

    if (S.result) {
      out += '<div class="fca-note fca-note-ok">' + icn('check') +
        '<div><p><strong>Your report is ready.</strong></p>' +
        '<p class="fca-quiet">' + fcaEsc(S.result.filename) + '</p>' +
        '<a class="fca-btn fca-btn-primary" href="' + API + '/documents/' + encodeURIComponent(S.result.documentId) + '/download"' +
        ' download data-fca-download>' + icn('doc') + ' Download the Word document</a></div></div>';
      if (S.result.missingFields.length) {
        out += '<div class="fca-note fca-note-warn">' + icn('alert') +
          '<div><p><strong>' + S.result.missingFields.length + ' field(s) were left blank</strong> and appear as placeholders in the document:</p>' +
          '<p class="fca-quiet">' + S.result.missingFields.map(function (t) { return fcaEsc(fcaTagLabel(t)); }).join(', ') + '</p></div></div>';
      }
      if (S.result.warnings.length) {
        out += '<div class="fca-note fca-note-warn">' + icn('info') + '<div><p><strong>From the generator:</strong></p><ul>' +
          S.result.warnings.map(function (w) { return '<li>' + fcaEsc(w) + '</li>'; }).join('') + '</ul></div></div>';
      }
      out += '<div class="fca-row-actions">' +
        '<button type="button" class="fca-btn" data-fca="step" data-step="4">Change the sections and generate again</button>' +
        '<button type="button" class="fca-btn" data-fca="close">Done</button></div>';
      return out;
    }

    out += '<div class="fca-card"><h3>Check before you generate</h3><dl class="fca-summary">' +
      '<div><dt>Client</dt><dd>' + (model.clientName ? fcaEsc(model.clientName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      '<div><dt>Prepared by</dt><dd>' + (model.therapistName ? fcaEsc(model.therapistName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      '<div><dt>Sections included</dt><dd>' + counts.included + ' of ' + counts.total +
      ' <span class="fca-quiet">(' + counts.required + ' required, ' + counts.optional + ' optional, ' + counts.custom + ' custom)</span></dd></div>' +
      '<div><dt>Expected filename</dt><dd>' + fcaEsc(fcaFilenamePreview(S.draft)) +
      ' <span class="fca-quiet">— the final name comes from the server</span></dd></div>' +
      '</dl></div>';

    if (summary.count) {
      out += '<div class="fca-note fca-note-warn">' + icn('alert') +
        '<div><p><strong>' + summary.count + ' field(s) have no value.</strong> They will appear in the document as ' +
        'placeholders styled for completion — nothing is filled in on your behalf.</p>' +
        summary.groups.map(function (g) {
          return '<p class="fca-quiet"><strong>' + fcaEsc(g.label) + ':</strong> ' +
            g.fields.map(function (f) { return fcaEsc(f.label); }).join(', ') + '</p>';
        }).join('') +
        '<button type="button" class="fca-link" data-fca="step" data-step="3">Go back and fill some in</button>' +
        '</div></div>';
    }

    if (S.genErr) out += '<p class="fca-err" role="alert">' + fcaEsc(S.genErr) + '</p>';

    out += '<div class="fca-row-actions">' +
      '<button type="button" class="fca-btn fca-btn-primary" data-fca="generate"' + (S.generating ? ' disabled' : '') + '>' +
      (S.generating ? 'Generating…' : 'Generate the Word document') + '</button></div>' +
      (S.generating ? '<p class="fca-quiet" role="status" aria-live="polite">Building the document from the Opal template…</p>' : '');
    return out;
  }

  // ══ EVENTS ═══════════════════════════════════════════════════════════════

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-fca]') : null;
    if (!t) return;
    var a = t.getAttribute('data-fca');
    var id = t.getAttribute('data-id');
    var tag = t.getAttribute('data-tag');

    if (a === 'start') { openWizard(); return; }
    if (a === 'close') { closeWizard(); return; }
    if (a === 'drafts-reload') { loadDrafts(true); return; }
    if (a === 'draft-open') { openDraft(id); return; }
    if (a === 'draft-archive') { S.confirmDelete = id; renderEntry(); return; }
    if (a === 'draft-archive-cancel') { S.confirmDelete = null; renderEntry(); return; }
    if (a === 'draft-archive-confirm') { archiveDraft(); return; }
    if (a === 'step') { goStep(Number(t.getAttribute('data-step'))); return; }
    if (a === 'back') { goStep(Math.max(1, S.step - 1)); return; }
    if (a === 'next') { goStep(S.step + 1); return; }
    if (a === 'confirm-therapist') {
      if (S.draft) goStep(3); else createDraft();
      return;
    }
    if (a === 'pick-client') { chooseClient(id); return; }
    if (a === 'retry-save') { retryPatch(); return; }
    if (a === 'select-all') { selectAllOptional(); return; }
    if (a === 'clear-all') { clearOptional(); return; }
    if (a === 'reset-defaults') { resetDefaults(); return; }
    if (a === 'preset-save') { savePreset(); return; }
    if (a === 'preset-apply') { applyPreset(id); return; }
    if (a === 'preset-delete') { deletePreset(id); return; }
    if (a === 'custom-save') { saveCustom(); return; }
    if (a === 'custom-edit') { editCustom(id); return; }
    if (a === 'custom-remove') { removeCustom(id); return; }
    if (a === 'custom-cancel') { S.customEditing = null; S.customTitle = ''; S.customGuidance = ''; render(); return; }
    if (a === 'move-up') { setOrder(fcaMoveTag(currentOrder(), tag, -1)); render(); return; }
    if (a === 'move-down') { setOrder(fcaMoveTag(currentOrder(), tag, 1)); render(); return; }
    if (a === 'preview-toggle') { S.previewOpen = !S.previewOpen; render(); return; }
    if (a === 'profile-open') { S.profileOpen = true; S.profileErr = ''; render(); return; }
    if (a === 'profile-close') { S.profileOpen = false; render(); return; }
    if (a === 'profile-save') { saveToProfile(); return; }
    if (a === 'generate') { generate(); return; }
  });

  // Checkboxes and selects.
  doc.addEventListener('change', function (e) {
    var box = e.target && e.target.closest ? e.target.closest('[data-fca-check]') : null;
    if (box && box.getAttribute('data-fca-check') === 'section') {
      toggleSection(box.getAttribute('data-tag'));
      return;
    }
    // Ticking a field to save is a local choice only — it sends nothing.
    if (box && box.getAttribute('data-fca-check') === 'profile-pick') {
      var pt = box.getAttribute('data-tag');
      if (box.checked) S.profilePick[pt] = true; else delete S.profilePick[pt];
      render();
      return;
    }
    var sel = e.target && e.target.closest ? e.target.closest('[data-fca-change]') : null;
    if (sel && sel.getAttribute('data-fca-change') === 'therapist') {
      S.therapistId = sel.value ? sel.value : user().therapistProfileId;
    }
  });

  // Text inputs never trigger a re-render — typing must not move the caret.
  doc.addEventListener('input', function (e) {
    var f = e.target && e.target.closest ? e.target.closest('[data-fca-input]') : null;
    if (!f) return;
    var kind = f.getAttribute('data-fca-input');
    if (kind === 'q') { searchClients(f.value); return; }
    if (kind === 'override') { setOverride(f.getAttribute('data-tag'), f.value); return; }
    if (kind === 'preset-name') { S.presetName = f.value; return; }
    if (kind === 'custom-title') { S.customTitle = f.value; return; }
    if (kind === 'custom-guidance') { S.customGuidance = f.value; return; }
  });

  // Drag reordering — the mouse equivalent of the move buttons.
  doc.addEventListener('dragstart', function (e) {
    var li = e.target && e.target.closest ? e.target.closest('.fca-orderitem') : null;
    if (!li) return;
    S.dragTag = li.getAttribute('data-tag');
    li.classList.add('fca-dragging');
    if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', S.dragTag); } catch (err) { /* IE-era guard */ } }
  });
  doc.addEventListener('dragover', function (e) {
    var li = e.target && e.target.closest ? e.target.closest('.fca-orderitem') : null;
    if (!li || !S.dragTag) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  doc.addEventListener('drop', function (e) {
    var li = e.target && e.target.closest ? e.target.closest('.fca-orderitem') : null;
    if (!li || !S.dragTag) return;
    e.preventDefault();
    var target = li.getAttribute('data-tag');
    setOrder(fcaReorderTo(currentOrder(), S.dragTag, target));
    S.dragTag = null;
    render();
  });
  doc.addEventListener('dragend', function () {
    S.dragTag = null;
    var n = doc.querySelector('.fca-dragging');
    if (n) n.classList.remove('fca-dragging');
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.open) { closeWizard(); }
  });

  function currentOrder() {
    return fcaNormaliseOrder(S.draft ? S.draft.sectionOrder : [], orderableSections());
  }

  async function archiveDraft() {
    var id = S.confirmDelete;
    if (!id) return;
    S.confirmDelete = null;
    var r = await api(API + '/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { S.draftsErr = r.error; renderEntry(); return; }
    S.drafts = (S.drafts || []).filter(function (d) { return String(d.id) !== String(id); });
    renderEntry();
  }

  // ══ OPEN / CLOSE ═════════════════════════════════════════════════════════

  var lastFocus = null;

  function openWizard() {
    lastFocus = doc.activeElement;
    S.open = true;
    S.step = 1;
    S.furthest = Math.max(S.furthest, 1);
    S.result = null; S.genErr = '';
    loadTemplate();
    loadTherapists();
    render();
    focusWizard();
  }

  function focusWizard() {
    var q = el('fca-q') ? el('fca-q') : el('fca-step-h');
    if (q) { try { q.focus(); } catch (e) { /* not focusable */ } }
  }

  function closeWizard() {
    S.open = false;
    S.previewOpen = false;
    render();
    S.drafts = null;
    loadDrafts(true);
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
  }

  // ══ BOOT ═════════════════════════════════════════════════════════════════

  function boot() {
    if (!el('fca-hub-entry')) return;
    syncEntryVisibility();
    var hub = el('rh2-root');
    if (hub && global.MutationObserver) {
      new global.MutationObserver(function () { syncEntryVisibility(); })
        .observe(hub, { childList: true, subtree: false });
    }
  }

  doc.addEventListener('DOMContentLoaded', boot);
  if (doc.readyState !== 'loading') boot();

  // The Resources tab mounts the hub lazily — re-check shortly after it opens.
  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('.tab[data-tab="resources"]');
    if (t) setTimeout(syncEntryVisibility, 80);
  });

  // ══ PUBLIC SURFACE ═══════════════════════════════════════════════════════

  global.FCA = {
    open: openWizard,
    close: closeWizard,
    openDraft: openDraft,
    reloadDrafts: function () { return loadDrafts(true); },
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
