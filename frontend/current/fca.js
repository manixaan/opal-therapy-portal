/* ═══════════════════════════════════════════════════════════════════════════
   OPAL FCA REPORT BUILDER — front end for the Functional Capacity Assessment
   report wizard. Renders the entry point into #fca-hub-entry (Resource Hub
   home) and the whole four-step wizard into #fca-root.

   THE WIZARD IS FOUR STEPS: Client, Therapist, Review data, Sections &
   document. Choosing sections, watching the document take shape and
   downloading it were three separate stages; they are one, because they are
   one decision. The therapist ticks a section on the left and sees it appear
   in the real document on the right, then downloads it from the same screen.
   A draft saved under the old numbering (step 5 or 6) opens at step 4 —
   see fcaMapStep().

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
     4. NOTHING DOWNLOADS BY ITSELF. Exactly one gesture starts a download:
        the therapist pressing "Download Word document". No render, no step
        change, no save and no preview ever fetches the file. What that one
        press does is compose the CURRENT document and hand it over — see
        downloadDocument(), the only caller of startDownload(), which is in
        turn the only place in this file that activates a link.
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
                                                   customSections?, scalarOverrides?,
                                                   excludedFields? }
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
  // The layers the server resolves, and the ONLY labels this UI is allowed to
  // show. The mapping is exact and total: an origin the server sends that is
  // not one of these is treated as 'missing', because the honest answer to
  // "where did this come from?" is never a guess.
  //
  // 'server' is the document control Opal ISSUES rather than looks up — the
  // document id, date, version and status. It reads "Generated by Opal"
  // because that is exactly what it is, and because telling a therapist their
  // own document's id is "Missing" was never a fact, it was a bug.
  var FCA_SOURCE_LABELS = {
    splose: 'Splose',
    client_profile: 'Opal client profile',
    report_override: 'Entered for this report',
    server: 'Generated by Opal',
    missing: 'Missing',
  };
  var FCA_SOURCE_ORDER = ['splose', 'client_profile', 'report_override', 'server', 'missing'];

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

  // ── THE NOTE ─────────────────────────────────────────────────────────────
  // One calm line at the top of the missing/exclude area. It states the two
  // real options and neither of the two wrong ones: no field is ever filled
  // with a guess, and no therapist is ever stuck. Worded identically in the
  // letter builder, because it is the same promise about the same thing.
  var FCA_BLANK_OR_EXCLUDE_NOTE = 'If we do not hold this information, you can '
    + 'leave it blank and complete it in Word after downloading — or exclude it '
    + 'so nothing is inserted.';

  // Add or remove one tag from the exclusion list. Returns a NEW array, which
  // is what the server is sent: exclusion is a set the therapist owns
  // outright, so it is replaced wholesale rather than merged.
  function fcaToggleExcluded(current, tag, on) {
    var list = (Array.isArray(current) ? current : []).map(String)
      .filter(function (t) { return t !== String(tag); });
    if (on) list.push(String(tag));
    return list;
  }

  // The tags the SERVER says are excluded. Read from the manifest and nowhere
  // else: exclusion changes what the DOCX contains, so a locally computed
  // version could disagree with the document that is actually produced.
  function fcaExcludedSet(manifest) {
    var m = manifest && typeof manifest === 'object' ? manifest : {};
    var out = {};
    (Array.isArray(m.excludedTags) ? m.excludedTags : []).forEach(function (t) {
      out[String(t)] = true;
    });
    return out;
  }

  // THE STEP-3 MODEL. Every field is (value, source) exactly as the server
  // resolved it. `missing` is the server's verdict — scalarSources is the
  // authority; a blank value only decides the matter when the server sent no
  // origin for that tag at all.
  //
  // `excluded` is a THIRD state, and deliberately not a flavour of missing.
  // Missing means "no layer holds this" — a gap to fill. Excluded means the
  // therapist has said there is nothing to hold, so nothing is inserted and
  // nothing is outstanding.
  function fcaScalarModel(manifest, profileEligibleTags) {
    var m = manifest && typeof manifest === 'object' ? manifest : {};
    var data = m.scalarData && typeof m.scalarData === 'object' ? m.scalarData : {};
    var sources = m.scalarSources && typeof m.scalarSources === 'object' ? m.scalarSources : {};
    var excluded = fcaExcludedSet(m);
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
      var isExcluded = !!excluded[tag];
      var missing = !isExcluded && (key === 'missing' || blank);
      var g = fcaTagGroup(tag);
      if (!buckets[g]) { buckets[g] = []; seen.push(g); }
      buckets[g].push({
        tag: tag,
        label: fcaTagLabel(tag),
        value: (missing || isExcluded) ? null : String(raw),
        source: missing ? 'missing' : key,
        sourceLabel: fcaSourceLabel(missing ? 'missing' : key),
        missing: missing,
        excluded: isExcluded,
        profileEligible: !!eligible[tag] && !isExcluded,
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
        if (f.profileEligible && f.source === 'report_override' && !f.missing && !f.excluded) out.push(f);
      });
    });
    return out;
  }

  // What the therapist must know before generating: which fields have no
  // value, grouped the way step 3 shows them. A value is missing when the
  // server says so OR when the composed manifest holds no value for it —
  // blank is blank, and we say so rather than papering over it.
  //
  // An EXCLUDED tag is never listed. It is not an outstanding gap; the
  // therapist has already answered the question, and re-asking would turn a
  // deliberate decision back into a nag.
  function fcaMissingSummary(missingFields, scalarData, excludedTags) {
    var data = scalarData && typeof scalarData === 'object' ? scalarData : {};
    var skip = {};
    (Array.isArray(excludedTags) ? excludedTags : []).forEach(function (t) { skip[String(t)] = true; });
    var flagged = {}, tags = [];
    (Array.isArray(missingFields) ? missingFields : []).forEach(function (t) {
      var k = String(t);
      if (flagged[k] || skip[k]) return;
      flagged[k] = true;
      tags.push(k);
    });
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      var blank = v == null || (typeof v === 'string' && v.trim() === '');
      if (blank && !flagged[k] && !skip[k]) { flagged[k] = true; tags.push(k); }
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
      documentControl: [], excludedFields: [],
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
    // step 3 renders, so a badge and a preview value can never disagree — and
    // an excluded field shows as excluded in both.
    base.scalarGroups = fcaScalarModel(manifest, null);
    // The values Opal issued, shown on the preview's document-control line so
    // the therapist can see the real document id and date before generating.
    // Membership comes from the SERVER's own source attribution — the tags are
    // never listed here, so a template change cannot leave this stale.
    base.scalarGroups.forEach(function (g) {
      g.fields.forEach(function (f) {
        if (f.source === 'server') base.documentControl.push(f);
        if (f.excluded) base.excludedFields.push(f);
      });
    });
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

  // ── THE STEPS ────────────────────────────────────────────────────────────
  // Four, and this list is the only place that says so: the stepper, the
  // "step X of Y" line, the footer and the navigation gate all read it.
  var FCA_STEPS = [
    { n: 1, label: 'Client' },
    { n: 2, label: 'Therapist' },
    { n: 3, label: 'Review data' },
    { n: 4, label: 'Sections & document' },
  ];
  var FCA_FINAL_STEP = FCA_STEPS.length;

  // Legacy compatibility, and the only place it lives. Drafts saved while the
  // wizard had six steps carry step 5 (Preview) or step 6 (Generate); both are
  // now part of step 4, so both open there. An out-of-range or unreadable
  // value opens at step 1 rather than stranding the draft.
  function fcaMapStep(step) {
    var n = parseInt(step, 10);
    if (!isFinite(n) || n < 1) return 1;
    return n > FCA_FINAL_STEP ? FCA_FINAL_STEP : n;
  }

  var helpers = {
    fcaEsc: fcaEsc,
    FCA_STEPS: FCA_STEPS,
    FCA_FINAL_STEP: FCA_FINAL_STEP,
    fcaMapStep: fcaMapStep,
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
    fcaExcludedSet: fcaExcludedSet,
    fcaScalarModel: fcaScalarModel,
    fcaToggleExcluded: fcaToggleExcluded,
    FCA_BLANK_OR_EXCLUDE_NOTE: FCA_BLANK_OR_EXCLUDE_NOTE,
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
    // step 4 — sections
    presets: null, presetName: '', presetErr: '',
    customTitle: '', customGuidance: '', customEditing: null, customErr: '',
    dragTag: null,
    // The last selection/order the SERVER acknowledged. A structural edit that
    // fails to save is returned to this, so the panel never claims an order the
    // report does not have. Typed prose is never rolled back — see
    // rollbackSectionEdit().
    confirmed: null,
    sectionErr: '',
    // draft (server truth)
    draft: null, draftErr: '', creating: false,
    save: 'idle',           // idle | saving | saved | error
    saveErr: '',
    // step 4 — document panel
    previewOpen: false,
    // Exact document preview. `rev` is a monotonic request number: a response
    // whose rev is not the newest is discarded, so a slow early request can
    // never overwrite a faster later one.
    // status is the single source of truth for the preview lifecycle:
    //   idle       nothing requested yet
    //   scheduled  a debounced render is pending
    //   rendering  a request is in flight
    //   ready      a document is drawn
    //   error      the last attempt failed; Try again is offered
    // `sig` fingerprints the inputs the document is composed from, so a render
    // is skipped when nothing that affects the document has changed, and forced
    // when it has. `ctrl` is the AbortController for the in-flight request.
    // `base` is the measured fitted scale (see measureFittedBase) and `scale`
    // the scale actually applied — base × zoom. `zoom` is therefore RELATIVE:
    // 1 means "the whole page fits", which is what the panel shows as 100%.
    exact: {
      rev: 0, status: 'idle', err: '', zoom: 1, fit: true, full: false,
      sig: '', renderedSig: '', ctrl: null, base: 1, scale: 1, anchor: '',
    },
    downloading: false, result: null, genErr: '',
    // hub entry
    drafts: null, draftsLoading: false, draftsErr: '',
    confirmDelete: null,
  };

  var STEPS = FCA_STEPS;
  var FINAL_STEP = FCA_FINAL_STEP;

  var API = '/api/fca';
  var searchTimer = null, patchTimer = null, pendingPatch = null, patchInFlight = null;

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
    // These builders live in the Templates collection — they are
    // template-driven document workflows, so that is where staff look.
    var onTemplates = !!hub && hub.dataset.view === 'library'
      && hub.dataset.collection === 'templates';
    host.hidden = !onTemplates;
    if (onTemplates && !S.drafts && !S.draftsLoading) loadDrafts(false);
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
    S.result = null; S.genErr = ''; S.sectionErr = '';
    S.open = true;
    // Sections, preview and download are one step now, so every resumed draft
    // has one place to land — including one saved when this opened at step 4
    // (Sections) or step 6 (Generate). Nothing becomes unreachable.
    S.step = fcaMapStep(FINAL_STEP);
    S.furthest = FINAL_STEP;
    rememberConfirmed();
    loadTemplate();
    loadPresets();
    render();
    focusWizard();
  }

  // Debounced PATCH. Typed prose is never rolled back on failure — the local
  // draft stays exactly as the therapist left it and Retry re-sends. A failed
  // SECTION edit is a different case and does revert; see rollbackSectionEdit.
  function queuePatch(patch) {
    pendingPatch = Object.assign({}, pendingPatch || {}, patch);
    S.save = 'saving'; S.saveErr = '';
    paintSave();
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(flushPatch, 600);
  }

  /** The selection/order the server last acknowledged — the rollback target. */
  function rememberConfirmed() {
    if (!S.draft) { S.confirmed = null; return; }
    S.confirmed = {
      selectedSections: (S.draft.selectedSections || []).slice(),
      sectionOrder: (S.draft.sectionOrder || []).slice(),
      customSections: (S.draft.customSections || []).slice(),
    };
  }

  function patchTouchesSections(body) {
    if (!body) return false;
    return Object.prototype.hasOwnProperty.call(body, 'selectedSections')
      || Object.prototype.hasOwnProperty.call(body, 'sectionOrder')
      || Object.prototype.hasOwnProperty.call(body, 'customSections');
  }

  /**
   * A structural edit that did not save is undone.
   *
   * The panel must not show an order the report does not have: the therapist
   * would download a document that disagrees with what they are looking at.
   * The change is not lost — the failed patch is still queued, and Retry
   * re-applies it — but until it saves, the screen shows the truth.
   *
   * Deliberately narrow. Typed values (scalarOverrides) and exclusions are
   * never touched by this: a sentence is expensive to lose and a tick is not.
   */
  function rollbackSectionEdit(body) {
    if (!S.confirmed || !S.draft || !patchTouchesSections(body)) return;
    S.draft.selectedSections = S.confirmed.selectedSections.slice();
    S.draft.sectionOrder = S.confirmed.sectionOrder.slice();
    S.draft.customSections = S.confirmed.customSections.slice();
    touchManifest();
    S.sectionErr = 'That change could not be saved, so the section list has been '
      + 'put back. Nothing else in your report was affected.';
    if (S.step === FINAL_STEP) paintSections();
  }

  /** Re-apply a queued patch to the local draft (used by Retry after a rollback). */
  function applyPatchLocally(body) {
    if (!S.draft || !body) return;
    if (Object.prototype.hasOwnProperty.call(body, 'selectedSections')) S.draft.selectedSections = body.selectedSections;
    if (Object.prototype.hasOwnProperty.call(body, 'sectionOrder')) S.draft.sectionOrder = body.sectionOrder;
    if (Object.prototype.hasOwnProperty.call(body, 'customSections')) S.draft.customSections = body.customSections;
    touchManifest();
  }

  function sectionsFingerprint() {
    if (!S.draft) return '';
    return JSON.stringify([S.draft.selectedSections || [], S.draft.sectionOrder || []]);
  }

  async function flushPatch() {
    if (!S.draft || !pendingPatch) return;
    var body = pendingPatch;
    pendingPatch = null;
    if (patchTimer) { clearTimeout(patchTimer); patchTimer = null; }
    var before = sectionsFingerprint();
    var request = api(API + '/drafts/' + encodeURIComponent(S.draft.id), { method: 'PATCH', body: body });
    patchInFlight = request;
    var r = await request;
    if (patchInFlight === request) patchInFlight = null;
    if (!r.ok || !r.draft) {
      S.save = 'error';
      S.saveErr = r.error;
      pendingPatch = Object.assign({}, body, pendingPatch || {});
      rollbackSectionEdit(body);
      paintSave();
      return;
    }
    // Reconcile: the server's manifest replaces the optimistic one.
    S.draft = r.draft;
    rememberConfirmed();
    S.save = 'saved';
    S.sectionErr = '';
    // On the consolidated step the panel is already showing the change — the
    // therapist made it. Rebuilding the whole wizard around a save that agreed
    // with them is what threw away their scroll position and their place in the
    // list, so the DOM is only touched when the server actually disagreed.
    if (S.step === FINAL_STEP) {
      paintSave();
      if (sectionsFingerprint() !== before) paintSections();
      // The GATE, not a fresh schedule: the therapist's own edit already
      // scheduled one, and a save that agreed with them has nothing to compose.
      // Scheduling here regardless left the panel saying "Updating preview…"
      // over a document that was already the newest one.
      ensureExactPreview();
      return;
    }
    // Never yank the caret out of a field mid-sentence just because a save
    // landed — repaint the preview and the indicator instead.
    if (typingNow()) { paintSave(); scheduleExactPreview(); return; }
    render();
    scheduleExactPreview();
  }

  /**
   * Land every edit that is still in the air. Called before anything that must
   * act on the therapist's latest intent rather than their last saved one —
   * which today is exactly one thing: Download.
   */
  async function flushPendingEdits() {
    if (patchTimer) { clearTimeout(patchTimer); patchTimer = null; }
    if (patchInFlight) { await patchInFlight; }
    if (pendingPatch) await flushPatch();
  }

  function typingNow() {
    var a = doc.activeElement;
    if (!a || !a.tagName) return false;
    var tag = a.tagName.toLowerCase();
    return tag === 'textarea' || (tag === 'input' && !/^(checkbox|radio|button)$/i.test(a.type || ''));
  }

  /* ── Exact document preview ────────────────────────────────────────────────
     Renders the REAL composed DOCX — the same bytes the Download Word action
     produces, from the same server-side composition helper. It is deliberately
     not built from the manifest: a preview assembled independently would be a
     second implementation of the report and the two would drift.

     What it is not: Microsoft Word. The browser has no Word layout engine, so
     pagination, page numbering and TOC page numbers are approximations. That is
     stated on the panel rather than left for a therapist to discover after
     sending a report. */

  var EXACT_NOTICE = 'Document preview — final pagination and page numbering may differ slightly in Microsoft Word.';

  /**
   * The panel is built ONCE and then painted in pieces.
   *
   * #fca-docx-fit and the rendered document inside it are never rebuilt by a
   * toolbar press, a status change or a section edit. That is what keeps the
   * therapist's scroll position, their zoom and the drawn document itself
   * alive across everything except an actual new render.
   */
  function renderExactPreview() {
    return '<div class="fca-preview-bar" id="fca-preview-bar" role="toolbar" aria-label="Preview controls">'
      + renderPreviewTools() + '</div>'
      + '<div class="fca-preview-stage" id="fca-preview-stage">'
      + '<div class="fca-docx-fit" id="fca-docx-fit"><div class="fca-docx" id="fca-docx-host"></div></div>'
      + '<div class="fca-preview-overlay" id="fca-preview-overlay">' + renderPreviewOverlay() + '</div>'
      + '</div>'
      + '<p class="fca-preview-note">' + fcaEsc(EXACT_NOTICE) + '</p>'
      + '<div id="fca-preview-fallback" data-err="' + fcaEsc(S.exact.err) + '">' + renderPreviewFallback() + '</div>';
  }

  function renderPreviewTools() {
    var e = S.exact;
    return '<span class="fca-preview-title">Document preview</span>'
      + '<span class="fca-preview-tools">'
      + '<button type="button" class="fca-preview-btn" data-fca="preview-refresh" aria-label="Refresh the preview" title="Rebuild the preview from the report as it stands now">Refresh</button>'
      + '<button type="button" class="fca-preview-btn" data-fca="zoom-out" aria-label="Zoom out" title="Zoom out">&minus;</button>'
      + '<span class="fca-preview-zoom" id="fca-preview-zoom" aria-live="polite">' + Math.round(e.zoom * 100) + '%</span>'
      + '<button type="button" class="fca-preview-btn" data-fca="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>'
      + '<button type="button" class="fca-preview-btn' + (e.fit ? ' is-on' : '') + '" data-fca="zoom-fit"'
      + ' aria-pressed="' + (e.fit ? 'true' : 'false') + '" title="Fit the whole page width">Fit width</button>'
      + '<button type="button" class="fca-preview-btn" data-fca="preview-full" aria-pressed="' + (e.full ? 'true' : 'false') + '">'
      + (e.full ? 'Exit full screen' : 'Full screen') + '</button>'
      + '</span>';
  }

  /**
   * Loading, updating, empty and error — as an OVERLAY, never as a replacement.
   * A routine edit leaves the document the therapist is reading on screen and
   * puts a small "Updating preview…" marker on top of it; the new render
   * replaces the old one only once it is ready.
   */
  function renderPreviewOverlay() {
    var e = S.exact;
    var out = '';
    var busy = e.status === 'rendering' || e.status === 'scheduled';
    if (busy) {
      out += '<div class="fca-preview-updating" role="status">'
        + (e.status === 'scheduled' || e.renderedSig ? 'Updating preview…' : 'Building the document preview…')
        + '</div>';
    }
    if (e.err) {
      out += '<div class="fca-preview-error" role="status">'
        + '<p>' + fcaEsc(exactErrorText(e.err)) + '</p>'
        + '<button type="button" class="fca-preview-btn" data-fca="preview-refresh">Try again</button>'
        + '</div>';
    }
    if (e.status === 'idle' && !e.renderedSig) {
      out += '<div class="fca-preview-empty">Preparing document preview…</div>';
    }
    return out;
  }

  function exactErrorText(err) {
    if (err === 'timed_out') {
      return 'The preview took too long to build. Your report is safe — editing '
        + 'and Download Word document still work.';
    }
    if (err === 'renderer_unavailable') {
      return 'The document viewer did not load, so there is nothing to show here. '
        + 'Your report is safe — editing and Download Word document still work.';
    }
    return 'Preview could not be updated. Your report is safe — editing and '
      + 'Download Word document still work.';
  }

  /**
   * Structural fallback: when the renderer cannot draw the document, the
   * therapist can still see which sections are in and in what order.
   */
  function renderPreviewFallback() {
    if (!S.exact.err) return '';
    return '<details class="fca-preview-fallback"><summary>Section summary</summary>'
      + renderPreview() + '</details>';
  }

  var exactTimer = null;

  /** Debounced: one composition per pause, not one per keystroke. */
  function scheduleExactPreview(delay, force) {
    if (exactTimer) clearTimeout(exactTimer);
    // A save that lands after the wizard closes must not start a render for a
    // panel that is no longer there.
    if (!S.open) { exactTimer = null; return; }
    S.exact.status = 'scheduled';
    // Said out loud straight away, over the document already on screen: the
    // therapist sees "Updating preview…" the moment they change something,
    // and keeps reading the version they have until the new one is drawn.
    paintExact();
    exactTimer = setTimeout(function () {
      exactTimer = null;
      runExactPreview(force);
    }, delay === undefined ? 800 : delay);
  }

  /** Longest a compose+render may take before the panel gives up and offers Try again. */
  var EXACT_TIMEOUT_MS = 30000;

  /**
   * Fingerprint of everything the composed document depends on. When this is
   * unchanged there is nothing to re-render, which is what stops step
   * navigation from throwing away a perfectly good preview and re-fetching.
   */
  function exactSignature() {
    if (!S.draft || !S.draft.id) return '';
    // Everything the composed document depends on, and nothing else. It is
    // deliberately built from the LOCAL draft rather than a server revision
    // stamp: the therapist ticks a section and the signature changes in that
    // instant, which is what schedules the new render — waiting for a save to
    // come back would leave the preview a beat behind the panel.
    //
    // Serialised as one structure rather than joined with string fallbacks:
    // frontend-stage3-guards pins the exact set of `|| '...'` fallbacks in this
    // file so no client field can quietly acquire invented text, and a
    // signature helper has no business adding to that list.
    return JSON.stringify([
      S.draft.id,
      selectedTags(),
      S.draft.sectionOrder || [],
      customList().map(function (c) { return [String(c.tag), String(c.title == null ? '' : c.title)]; }),
      currentExcluded(),
      S.overrides,
    ]);
  }

  /** True when the preview panel is actually mounted and measurable. */
  function previewVisible() {
    return !!el('fca-preview') && !!el('fca-docx-host');
  }

  /**
   * The lifecycle gate. Called after every render of the wizard, on any step.
   *
   * Replaces a hard-coded `S.step === 5` test, which was the original defect:
   * the preview aside is persistent, so on any other step nothing ever
   * requested a render and the panel sat on "Preparing document preview…"
   * forever with no request in flight and no error to retry.
   */
  function ensureExactPreview() {
    if (!previewVisible()) return;              // 1. panel mounted and visible
    var sig = exactSignature();
    if (!sig) return;                           // 2. minimum data to compose
    var e = S.exact;
    if (e.status === 'rendering' || e.status === 'scheduled') {
      if (e.sig === sig) return;                // 4. a matching request is running
    } else if (e.status === 'ready' && e.renderedSig === sig && previewPages().length) {
      // 3. a valid preview already exists AND is still in the DOM. The second
      // half matters: re-entering the step rebuilds the panel, so a signature
      // that still matches can belong to a document that is no longer drawn.
      applyZoom();
      return;
    } else if (e.status === 'error' && e.sig === sig) {
      return;                                   // failed for these inputs; Try again is offered
    }
    e.sig = sig;
    scheduleExactPreview(e.status === 'idle' ? 0 : undefined);
  }

  async function runExactPreview(force) {
    if (!S.open || !S.draft || !S.draft.id) return;
    if (!global.docx || !global.JSZip) {         // renderer not loaded
      S.exact.status = 'error';
      S.exact.err = 'renderer_unavailable';
      paintExact();
      return;
    }
    var sig = exactSignature();
    // Duplicate-request guard: an identical render already drawn is not redone
    // unless Refresh explicitly forces it. The status is settled on the way out
    // — a skipped render must not leave the panel claiming to be working.
    if (!force && S.exact.renderedSig === sig && previewPages().length) {
      S.exact.status = 'ready';
      S.exact.err = '';
      paintExact();
      return;
    }

    // Supersede any in-flight request rather than racing it.
    if (S.exact.ctrl) { try { S.exact.ctrl.abort(); } catch (_) {} }
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    S.exact.ctrl = ctrl;

    var rev = ++S.exact.rev;
    S.exact.status = 'rendering';
    S.exact.sig = sig;
    S.exact.err = '';
    paintExact();

    // Loading can never continue indefinitely.
    var timer = setTimeout(function () {
      if (rev !== S.exact.rev) return;
      if (ctrl) { try { ctrl.abort(); } catch (_) {} }
    }, EXACT_TIMEOUT_MS);

    try {
      var res = await fetch('/api/fca/drafts/' + encodeURIComponent(S.draft.id)
        + '/preview.docx?rev=' + rev, {
        credentials: 'same-origin',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined,
      });
      if (!res.ok) throw new Error('compose_failed');
      var buf = await res.arrayBuffer();

      // A newer request started while this one was in flight — drop it. This is
      // the guard that stops a slow early response replacing a fast later one.
      if (rev !== S.exact.rev) return;

      // Drawn off-screen first. The document the therapist is reading stays on
      // screen and under their scroll position for the whole render; it is
      // exchanged for the new one in a single step, so there is no blank frame
      // and no jump to the top of an empty viewer.
      var staged = doc.createElement('div');
      await global.docx.renderAsync(buf, staged, null, {
        className: 'fca-docx-render',
        inWrapper: true,
        ignoreWidth: false,
        ignoreHeight: false,
        breakPages: true,          // honour page breaks
        // The template's page breaks are w:pageBreakBefore properties, which
        // this renderer parses and ignores; the preview endpoint restates them
        // as explicit break runs (backend/fca/preview-pagination.js) so the
        // pages below are the document's real pages.
        ignoreLastRenderedPageBreak: false,
        renderHeaders: true,
        renderFooters: true,
        renderFootnotes: true,
        renderEndnotes: true,
        renderChanges: false,
        experimental: true,        // best-effort tabs and complex fields
        useBase64URL: true,
      });
      if (rev !== S.exact.rev) return;
      clearTimeout(timer);

      var host = el('fca-docx-host');
      if (!host) return;
      var pos = capturePreviewPos();
      host.innerHTML = '';
      while (staged.firstChild) host.appendChild(staged.firstChild);

      S.exact.status = 'ready';
      S.exact.renderedSig = sig;
      observeFit();
      S.exact.ctrl = null;
      S.exact.err = '';
      paintExact();
      applyZoom();
      restorePreviewPos(pos);
    } catch (err) {
      // Superseded requests are dropped without touching state, so a slow
      // failure cannot overwrite a newer success — and, critically, cannot
      // strand the panel: the newer request owns the status.
      if (rev !== S.exact.rev) return;
      clearTimeout(timer);
      S.exact.status = 'error';
      S.exact.ctrl = null;
      S.exact.err = (err && err.name === 'AbortError') ? 'timed_out' : 'render_failed';
      paintExact();
    }
  }

  /**
   * Repaint the chrome only. The stage, the fit box and the rendered document
   * inside them are never replaced here — a zoom press, a status change or a
   * section edit must not cost the therapist the document they are reading or
   * the place they had scrolled to.
   */
  function paintExact() {
    if (!el('fca-preview')) return;
    var bar = el('fca-preview-bar');
    if (bar) bar.innerHTML = renderPreviewTools();
    var overlay = el('fca-preview-overlay');
    if (overlay) overlay.innerHTML = renderPreviewOverlay();
    // The fallback holds a <details> the therapist may have opened. It is only
    // rewritten when the error it describes actually changed, so a routine
    // status repaint cannot fold it shut under them.
    var fallback = el('fca-preview-fallback');
    if (fallback && fallback.getAttribute('data-err') !== S.exact.err) {
      fallback.setAttribute('data-err', S.exact.err);
      fallback.innerHTML = renderPreviewFallback();
    }
  }

  /** Just the zoom read-out and the Fit-width pressed state. */
  function paintZoom() {
    var label = el('fca-preview-zoom');
    if (label) label.textContent = Math.round(S.exact.zoom * 100) + '%';
    var bar = el('fca-preview-bar');
    if (!bar) return;
    var fit = bar.querySelector('[data-fca="zoom-fit"]');
    if (!fit) return;
    fit.setAttribute('aria-pressed', S.exact.fit ? 'true' : 'false');
    if (S.exact.fit) fit.classList.add('is-on'); else fit.classList.remove('is-on');
  }

  /** Balanced breathing room around the page at the fitted baseline. */
  var FIT_MARGIN_PX = 32;
  var fitObserver = null;

  function previewPages() {
    var host = el('fca-docx-host');
    if (!host || !host.querySelectorAll) return [];
    return host.querySelectorAll('.fca-docx-render-wrapper > section');
  }

  /**
   * The scale at which a whole page fits the stage. THIS is the user-facing
   * 100%, not a literal CSS scale of 1 — the template's page is 8.5in wide
   * (816px at 96dpi) and the side panel is far narrower, so scale 1 clipped the
   * right-hand edge and with it the right columns of every table.
   *
   * Measured from ONE page, never from the wrapper: the wrapper is the whole
   * stack and is already inside the transformed host, so measuring it would
   * compound the scale on every recalculation.
   */
  function measureFittedBase() {
    var stage = el('fca-preview-stage');
    var page = previewPages()[0];
    if (!page || !stage || !stage.clientWidth) return 1;
    // offsetWidth is the UNSCALED layout width. getBoundingClientRect() would
    // report the already-transformed box.
    var pageW = page.offsetWidth;
    var avail = stage.clientWidth - FIT_MARGIN_PX;
    if (!pageW || avail <= 0) return 1;
    return Math.min(1, avail / pageW);
  }

  /**
   * Scale the page stack, and give it a real box.
   *
   * A CSS transform changes what you see and not what the browser lays out, so
   * on its own it leaves the stage scrolling to the UNSCALED size: dead space
   * under a shrunken document, and a hidden last page on an enlarged one, with
   * nothing to scroll sideways to when the page is wider than the panel.
   * #fca-docx-fit is that box — sized to the SCALED stack, so the scrollbars
   * describe what is actually on screen, and centred so a fitted page sits in
   * the middle of its canvas.
   */
  function applyZoom() {
    var host = el('fca-docx-host');
    var fit = el('fca-docx-fit');
    if (!host || !fit) return;
    var pages = previewPages();
    var page = pages[0];
    var wrap = host.querySelector('.fca-docx-render-wrapper');
    var base = measureFittedBase();
    S.exact.base = base;
    var eff = base * S.exact.zoom;
    S.exact.scale = eff;

    host.style.transformOrigin = 'top left';
    host.style.transform = 'scale(' + eff + ')';
    if (page && page.offsetWidth) host.style.width = page.offsetWidth + 'px';
    if (wrap) {
      var w = page && page.offsetWidth ? page.offsetWidth : wrap.offsetWidth;
      // offsetHeight spans every page AND every gap between them, so the last
      // page is always reachable and pages can never be scrolled into each
      // other.
      fit.style.width = (w * eff) + 'px';
      fit.style.height = (wrap.offsetHeight * eff) + 'px';
    }
    paintZoom();
  }

  /**
   * Where the therapist is looking, as a page and a fraction of that page —
   * not a raw scroll offset, which means nothing once the pages have changed
   * height or a section has been removed.
   */
  function capturePreviewPos() {
    var stage = el('fca-preview-stage');
    var fit = el('fca-docx-fit');
    var pages = previewPages();
    if (!stage || !fit || !pages.length) return null;
    var eff = S.exact.scale ? S.exact.scale : 1;
    var into = stage.scrollTop - fit.offsetTop;
    var index = 0, ratio = 0;
    for (var i = 0; i < pages.length; i++) {
      var top = (pages[i].offsetTop - fit.offsetTop) * eff;
      var h = pages[i].offsetHeight * eff;
      if (into >= top - 1) { index = i; ratio = h ? (into - top) / h : 0; }
    }
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    return { index: index, ratio: ratio, count: pages.length };
  }

  /**
   * …and back to it: to the edited section where one can be found, and
   * otherwise to the same page and the same fraction of it, clamped when the
   * new document has fewer pages than the old one.
   */
  function restorePreviewPos(pos) {
    var stage = el('fca-preview-stage');
    var fit = el('fca-docx-fit');
    var pages = previewPages();
    var anchor = S.exact.anchor;
    S.exact.anchor = '';
    if (!stage || !fit || !pages.length) return;
    var eff = S.exact.scale ? S.exact.scale : 1;

    var at = anchor ? findAnchorPage(anchor) : -1;
    if (at !== -1) {
      stage.scrollTop = fit.offsetTop + ((pages[at].offsetTop - fit.offsetTop) * eff);
      return;
    }
    if (!pos) return;
    var i = pos.index < pages.length ? pos.index : pages.length - 1;
    if (i < 0) i = 0;
    var page = pages[i];
    var top = (page.offsetTop - fit.offsetTop) * eff;
    stage.scrollTop = fit.offsetTop + top + (page.offsetHeight * eff * pos.ratio);
  }

  /** Rescale on container resize — never re-compose the DOCX for a resize. */
  function observeFit() {
    var stage = el('fca-preview-stage');
    if (!stage || typeof global.ResizeObserver !== 'function') return;
    if (fitObserver) { try { fitObserver.disconnect(); } catch (_) {} }
    fitObserver = new global.ResizeObserver(function () { applyZoom(); });
    fitObserver.observe(stage);
  }

  function teardownFit() {
    if (fitObserver) { try { fitObserver.disconnect(); } catch (_) {} fitObserver = null; }
  }

  /** How long to wait for a layout that an unpainted tab will never announce. */
  var POST_MOUNT_FALLBACK_MS = 60;

  /** 0.1 steps that stay 0.1 steps — floating point makes 110% read as 110.00000000000001%. */
  function round1(n) { return Math.round(n * 10) / 10; }

  /**
   * Measure again once the browser has laid the new geometry out. Full screen
   * and the narrow-screen drawer both change the stage's width through CSS, and
   * CSS has not been applied yet in the frame the class changed.
   */
  function remeasureSoon() {
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(function () { applyZoom(); });
    }
    // Both routes, for the same reason as schedulePostMountPreview: a browser
    // that is not painting runs no animation frames, and full screen would
    // then keep the fitted scale of the small panel it just left.
    setTimeout(applyZoom, POST_MOUNT_FALLBACK_MS);
  }
  function retryPatch() {
    if (!pendingPatch) return;
    // A rolled-back section edit is re-applied before it is re-sent, so Retry
    // means "try that change again" rather than "send an empty change".
    applyPatchLocally(pendingPatch);
    S.save = 'saving'; S.saveErr = ''; S.sectionErr = '';
    paintSave();
    if (S.step === FINAL_STEP) { paintSections(); scheduleExactPreview(); }
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

  /**
   * Every document-affecting edit ends here: the panel has already changed, so
   * all that is left is to tell the preview to catch up. It is debounced, so a
   * run of quick changes composes once, for the last of them.
   */
  var EDIT_PREVIEW_DELAY_MS = 600;
  function afterSectionEdit(tag) {
    S.sectionErr = '';
    // Where to look when the new document arrives. A section that is still in
    // the report is a place in it, so the preview comes back around the thing
    // the therapist just changed rather than around a scroll offset that the
    // new pagination has made meaningless.
    S.exact.anchor = anchorTitleFor(tag);
    scheduleExactPreview(EDIT_PREVIEW_DELAY_MS);
  }

  function anchorTitleFor(tag) {
    if (!tag || !isSelected(tag)) return '';
    var meta = orderableSections().filter(function (s) { return String(s.tag) === String(tag); })[0];
    if (!meta) return '';
    var title = meta.label == null ? meta.title : meta.label;
    return title == null ? '' : String(title);
  }

  /**
   * The page a section starts on. docx-preview keeps no trace of the content
   * control a section came from, so the anchor is the section's own heading —
   * which is the first thing on its page, because that is what the page break
   * before it is for. Unfound means unfound: the caller falls back to the
   * positional restore rather than guessing a page.
   */
  function findAnchorPage(title) {
    var needle = String(title).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!needle) return -1;
    var pages = previewPages();
    for (var i = 0; i < pages.length; i++) {
      var text = (pages[i].textContent == null ? '' : pages[i].textContent)
        .replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.indexOf(needle) === 0) return i;
    }
    return -1;
  }

  /**
   * Toggling a section changes one row and the order list. It does NOT rebuild
   * the wizard: the therapist keeps their scroll position, the focus stays on
   * the checkbox they just pressed, and the document on the right stays up.
   */
  function toggleSection(tag) {
    var meta = orderableSections().filter(function (s) { return String(s.tag) === tag; })[0];
    if (meta && meta.required === true) return; // required sections never move
    var sel = selectedTags().slice();
    var at = sel.indexOf(tag);
    if (at === -1) sel.push(tag); else sel.splice(at, 1);
    setSelection(sel);
    paintSectionRow(tag);
    paintOrderList(tag);
    paintSectionCounts();
    afterSectionEdit(tag);
  }

  function selectAllOptional() {
    var sel = orderableSections().map(function (s) { return String(s.tag); });
    setSelection(sel);
    paintSections();
    afterSectionEdit();
  }

  function clearOptional() {
    var sel = orderableSections().filter(function (s) { return s.required === true; })
      .map(function (s) { return String(s.tag); });
    setSelection(sel);
    paintSections();
    afterSectionEdit();
  }

  function resetDefaults() {
    var sel = fcaDefaultSelection(templateSections());
    (S.draft && S.draft.customSections ? S.draft.customSections : []).forEach(function (c) { sel.push(String(c.tag)); });
    setSelection(sel);
    paintSections();
    afterSectionEdit();
  }

  /**
   * Move one section, by button or by drag — both land here, so the keyboard
   * path is not a degraded version of the mouse one and the two can never
   * produce different orderings.
   *
   * The row is MOVED, not recreated: the same element that was under the
   * therapist's finger is the one that ends up in the new position, which is
   * what lets focus follow it and what makes the change look like a move
   * rather than a refresh.
   */
  function applyOrder(order, movedTag) {
    setOrder(order);
    var list = el('fca-orderlist');
    if (!list) { paintSections(); afterSectionEdit(movedTag); return; }

    var wanted = doc.activeElement && doc.activeElement.id ? doc.activeElement.id : null;
    var rows = {}, i;
    for (i = 0; i < list.children.length; i++) {
      rows[list.children[i].getAttribute('data-tag')] = list.children[i];
    }
    order.forEach(function (t) { if (rows[t]) list.appendChild(rows[t]); });

    paintOrderControls();
    var moved = rows[movedTag];
    if (moved) flashRow(moved);
    // Focus follows the row. If the control it was on has just become
    // unavailable — the section is now first or last — the neighbouring one
    // takes it, so the keyboard never lands on a dead button.
    if (wanted) {
      var again = el(wanted);
      if (again && !again.disabled) { try { again.focus(); } catch (e) { /* gone */ } }
      else if (moved) {
        var alt = moved.querySelector('button:not([disabled])');
        if (alt) { try { alt.focus(); } catch (e) { /* gone */ } }
      }
    }
    afterSectionEdit(movedTag);
  }

  /**
   * Remove a section from the report, from the order list. Required sections
   * are refused here as well as in the picker and again by the server — the
   * control is disabled, and this is the second of those three answers.
   */
  function removeFromReport(tag) {
    if (!tag || isLocked(tag)) return;
    var sel = selectedTags().filter(function (t) { return t !== tag; });
    setSelection(sel);
    paintSectionRow(tag);
    paintOrderList(null);
    paintSectionCounts();
    // No anchor: the section that was edited is no longer in the document.
    afterSectionEdit(null);
  }

  /** A brief, quiet marker so the therapist can see where the row landed. */
  var flashTimer = null;
  function flashRow(row) {
    if (!row || !row.classList) return;
    if (flashTimer) clearTimeout(flashTimer);
    var previous = doc.querySelector('.fca-just-moved');
    if (previous) previous.classList.remove('fca-just-moved');
    row.classList.add('fca-just-moved');
    flashTimer = setTimeout(function () {
      if (row.classList) row.classList.remove('fca-just-moved');
      flashTimer = null;
    }, 1100);
  }

  // ══ PRESETS ══════════════════════════════════════════════════════════════

  async function loadPresets() {
    if (S.presets) return;
    var r = await api(API + '/presets');
    S.presets = r.ok && Array.isArray(r.presets) ? r.presets : [];
    repaintStep();
  }

  async function savePreset() {
    var name = String(S.presetName).trim();
    if (!name) { S.presetErr = 'Give the preset a name first.'; repaintStep(); return; }
    S.presetErr = '';
    var r = await api(API + '/presets', {
      method: 'POST',
      body: { name: name, selectedSections: selectedTags(), sectionOrder: S.draft ? S.draft.sectionOrder : [] },
    });
    if (!r.ok) { S.presetErr = r.error; repaintStep(); return; }
    S.presets = (S.presets || []).concat(r.preset ? [r.preset] : []);
    S.presetName = '';
    repaintStep();
  }

  function applyPreset(id) {
    var p = (S.presets || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!p || !S.draft) return;
    var applied = fcaApplyPreset(p, templateSections(), S.draft.customSections);
    S.draft.selectedSections = applied.selectedSections;
    S.draft.sectionOrder = applied.sectionOrder;
    touchManifest();
    queuePatch({ selectedSections: applied.selectedSections, sectionOrder: applied.sectionOrder });
    repaintStep();
    afterSectionEdit();
  }

  async function deletePreset(id) {
    var r = await api(API + '/presets/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { S.presetErr = r.error; repaintStep(); return; }
    S.presets = (S.presets || []).filter(function (x) { return String(x.id) !== String(id); });
    repaintStep();
  }

  // ══ CUSTOM SECTIONS ══════════════════════════════════════════════════════

  function customList() {
    return S.draft && Array.isArray(S.draft.customSections) ? S.draft.customSections.slice() : [];
  }

  function saveCustom() {
    var title = String(S.customTitle).trim();
    if (!title) { S.customErr = 'A custom section needs a title.'; repaintStep(); return; }
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
    repaintStep();
    afterSectionEdit();
  }

  function editCustom(id) {
    var c = customList().filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    S.customEditing = String(c.id);
    S.customTitle = String(c.title == null ? '' : c.title);
    S.customGuidance = String(c.guidance == null ? '' : c.guidance);
    repaintStep();
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
    repaintStep();
    afterSectionEdit();
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

  // ══ DOWNLOAD ═════════════════════════════════════════════════════════════

  /**
   * The one primary action of the last step, and the whole of it.
   *
   * The therapist presses Download Word document and gets the document they
   * are looking at — not the one that was current when they last visited some
   * other stage. Anything still in the air lands first (a debounced section
   * edit, an in-flight save), so the ordering and the selections in the file
   * are the ones on screen; then the server composes from that saved state and
   * the finished document is handed over.
   *
   * A second press while this is running does nothing: the guard below and the
   * disabled button are two expressions of the same rule.
   */
  async function downloadDocument() {
    if (!S.draft || S.downloading) return;
    S.downloading = true; S.genErr = ''; S.result = null;
    paintFooter();
    // Every pending edit, landed — never download the previous ordering.
    await flushPendingEdits();
    if (S.save === 'error') {
      S.downloading = false;
      S.genErr = 'Your latest change has not saved yet, so the document was not '
        + 'built. Retry the save above and try again.';
      paintFooter(); repaintStep();
      return;
    }
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id) + '/generate', { method: 'POST' });
    S.downloading = false;
    // A failure loses nothing: the sections, the order and the wizard step are
    // exactly where they were, and the message says what happened.
    if (!r.ok) { S.genErr = r.error; paintFooter(); repaintStep(); return; }
    var excluded = Array.isArray(r.excludedFields) ? r.excludedFields.map(String) : [];
    S.result = {
      documentId: r.documentId,
      filename: r.filename,
      // Excluded fields are reported separately: one was a gap left visible in
      // the document, the other was a deliberate omission.
      missingFields: (Array.isArray(r.missingFields) ? r.missingFields : [])
        .filter(function (t) { return excluded.indexOf(String(t)) === -1; }),
      excludedFields: excluded,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
    };
    S.drafts = null;
    paintFooter();
    repaintStep();
    startDownload(r.documentId);
  }

  /**
   * Hand the finished document over. The ONLY place in this file that starts a
   * download, and it is reachable from one gesture: pressing Download Word
   * document. Nothing renders, saves, navigates or previews its way here.
   *
   * The link is the portal's own authenticated document route — the same one
   * the ready-note offers — so the bytes travel exactly as they always did.
   */
  function startDownload(documentId) {
    if (!documentId) return;
    var link = doc.createElement('a');
    link.href = API + '/documents/' + encodeURIComponent(documentId) + '/download';
    link.setAttribute('download', '');
    link.style.display = 'none';
    doc.body.appendChild(link);
    link.click();
    doc.body.removeChild(link);
  }

  // ══ WIZARD RENDER ════════════════════════════════════════════════════════

  function root() { return el('fca-root'); }

  function canEnter(step) {
    if (step <= 1) return true;
    if (step === 2) return !!S.client;
    return !!S.draft;
  }

  /**
   * The single door into a step. Every number that reaches it is mapped first,
   * so a legacy 5 (Preview) or 6 (Generate) — from a saved route, a bookmark or
   * an old draft — lands on the consolidated final step rather than nowhere.
   */
  function goStep(step) {
    var n = fcaMapStep(step);
    if (!canEnter(n)) return;
    S.step = n;
    if (window.OpalNav) window.OpalNav.pushStep('fca', n);
    if (n > S.furthest) S.furthest = n;
    if (n >= FINAL_STEP) loadPresets();
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

  /**
   * Schedule the preview AFTER the DOM is mounted and measurable.
   *
   * The first-render defect lived here: ensureExactPreview() was called inside
   * renderStep(), which RETURNS AN HTML STRING. At that moment #fca-preview
   * either did not exist or was the previous render, so previewVisible() was
   * false and the gate returned without scheduling anything. Refresh worked
   * because by then the panel was mounted. rAF runs after the browser has
   * inserted and laid out the markup, so the panel is both present and
   * measurable — which the fitted-zoom calculation also depends on.
   */
  function schedulePostMountPreview() {
    if (typeof global.requestAnimationFrame === 'function') {
      global.requestAnimationFrame(function () { ensureExactPreview(); });
    }
    // …and a plain timer as well, because a browser that is not painting does
    // not run animation frames: a hidden, occluded or throttled tab never
    // fired the callback above, and the panel sat on "Preparing document
    // preview…" with nothing in flight — the very state this is here to
    // prevent. The gate is idempotent, so whichever route arrives first wins
    // and the other one returns immediately.
    setTimeout(function () { ensureExactPreview(); }, POST_MOUNT_FALLBACK_MS);
  }

  /**
   * A tab that was hidden when the wizard opened measures nothing useful and
   * paints nothing at all. When it comes back, ask again — for the render if
   * one never started, and for the fit if it was measured against a stage the
   * browser had not laid out yet.
   */
  doc.addEventListener('visibilitychange', function () {
    if (doc.visibilityState !== 'visible' || !S.open) return;
    ensureExactPreview();
    applyZoom();
  });
  function render() {
    var host = root();
    if (!host) return;
    host.hidden = !S.open;
    if (!S.open) { host.innerHTML = ''; return; }

    // Ids are deterministic, so focus survives a rebuild: toggling a section
    // checkbox with the keyboard leaves the focus on that same checkbox.
    var active = doc.activeElement;
    var keepId = active && active.id ? active.id : null;
    var showPreview = S.step === FINAL_STEP;
    host.innerHTML =
      '<div class="fca-shell" role="dialog" aria-modal="true" aria-labelledby="fca-title">' +
      '<header class="fca-head">' +
      '<div><h1 id="fca-title">Functional Capacity Assessment report</h1>' +
      '<p class="fca-quiet">' + fcaEsc(headSubtitle()) + '</p></div>' +
      '<div class="fca-head-right">' + renderSaveIndicator() +
      '<button type="button" class="fca-iconbtn" data-fca="close" aria-label="Close the report builder">' + icn('x') + '</button>' +
      '</div></header>' +
      renderStepper() +
      '<div class="fca-body' + (showPreview ? ' fca-body-split' : '') + '">' +
      '<main class="fca-main" id="fca-step-body">' + renderStep() + '</main>' +
      (showPreview
        ? '<button type="button" class="fca-preview-toggle" data-fca="preview-toggle" aria-expanded="' + (S.previewOpen ? 'true' : 'false') + '" aria-controls="fca-preview">' +
          icn('doc') + ' ' + (S.previewOpen ? 'Hide preview' : 'Show preview') + '</button>' +
          '<aside class="fca-preview' + (S.previewOpen ? ' fca-preview-open' : '')
            + (S.exact.full ? ' fca-preview-full' : '') + '" id="fca-preview" aria-label="Report preview">' +
          renderExactPreview() + '</aside>'
        : '') +
      '</div>' +
      renderFooter() +
      '</div>';

    if (keepId) {
      var again = el(keepId);
      if (again) { try { again.focus(); } catch (e) { /* removed by this render */ } }
    }

    // The markup is now in the document. Only here is #fca-preview mounted and
    // measurable, which is what the gate and the fitted-zoom maths both need.
    schedulePostMountPreview();
  }

  function headSubtitle() {
    if (!S.client) return 'Step ' + S.step + ' of ' + FINAL_STEP;
    var who = S.client.fullName == null ? '' : String(S.client.fullName);
    return who + ' · step ' + S.step + ' of ' + FINAL_STEP;
  }

  /**
   * The last step has no Continue, because there is nowhere further to go: the
   * primary action IS the document. Back stays, on every step but the first.
   */
  function renderFooter() {
    var back = S.step > 1
      ? '<button type="button" class="fca-btn" data-fca="back">Back</button>'
      : '<span></span>';
    var next = '';
    if (S.step === 1) next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="next"' + (S.client ? '' : ' disabled') + '>Continue</button>';
    else if (S.step === 2) next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="confirm-therapist"' + (S.creating ? ' disabled' : '') + '>' + (S.creating ? 'Preparing…' : 'Confirm and continue') + '</button>';
    else if (S.step === FINAL_STEP) {
      next = '<button type="button" class="fca-btn fca-btn-primary fca-foot-download" data-fca="download"' +
        (S.downloading ? ' disabled aria-disabled="true"' : '') + '>' + icn('doc') + ' ' +
        (S.downloading ? 'Preparing your document…' : 'Download Word document') + '</button>';
    } else next = '<button type="button" class="fca-btn fca-btn-primary" data-fca="next">Continue</button>';
    return '<footer class="fca-foot" id="fca-foot">' + back +
      '<span class="fca-foot-note">' +
      (S.step === FINAL_STEP
        ? 'Your progress is saved as you go. The download always contains the sections and order shown here.'
        : 'Your progress is saved as you go — closing this window does not lose it.') +
      '</span>' + next + '</footer>';
  }

  function paintFooter() {
    var node = el('fca-foot');
    if (node) node.outerHTML = renderFooter();
  }

  function renderStep() {
    if (S.step === 1) return renderStepClient();
    if (S.step === 2) return renderStepTherapist();
    if (S.step === 3) return renderStepData();
    return renderStepFinal();
  }

  /**
   * Repaint the step's own column, in place.
   *
   * The wizard is a dialog the therapist is working inside: rebuilding all of
   * it to reflect one changed row threw away their scroll position, their
   * focus and the document drawn beside them. Only #fca-step-body is replaced
   * here, and the scroll position and focus are carried across it.
   */
  function paintSections() {
    var body = el('fca-step-body');
    if (!body) { render(); return; }
    var scroller = doc.querySelector('.fca-body');
    var top = scroller ? scroller.scrollTop : 0;
    var active = doc.activeElement;
    var keepId = active && active.id ? active.id : null;
    body.innerHTML = renderStep();
    if (scroller) scroller.scrollTop = top;
    if (keepId) {
      var again = el(keepId);
      if (again) { try { again.focus(); } catch (e) { /* removed by this paint */ } }
    }
  }

  /** Paint the step's column when it is mounted; otherwise build the wizard. */
  function repaintStep() {
    if (S.open && S.step === FINAL_STEP && el('fca-step-body')) { paintSections(); return; }
    render();
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
    var excludedCount = groups.reduce(function (n, g) {
      return n + g.fields.filter(function (f) { return f.excluded; }).length;
    }, 0);

    var out = '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Check the details we hold</h2>' +
      '<div class="fca-note fca-note-warn">' + icn('alert') +
      '<div><p><strong>Nothing here is guessed.</strong> Each field below shows where its value came from. ' +
      'Fields marked <em>Missing</em> have no source anywhere in the system — you can type a real value now, ' +
      'or leave them blank, in which case they appear in the Word document as a clearly marked placeholder ' +
      'for you to complete there.</p>' +
      (total
        ? '<p class="fca-quiet">' + missingCount + ' of ' + total + ' fields have no value yet' +
          (excludedCount ? ', and ' + excludedCount + ' ' + (excludedCount === 1 ? 'is' : 'are') + ' excluded' : '') +
          '.</p>'
        : '') +
      '</div></div>';

    if (!groups.length) {
      return out + '<p class="fca-quiet">The report data has not been composed yet.</p>';
    }

    // The calm line, at the top of the area where a therapist meets a gap.
    out += '<p class="fca-inline-note" id="fca-blank-note">' + fcaEsc(FCA_BLANK_OR_EXCLUDE_NOTE) + '</p>';

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
    var exId = 'fca-ex-' + f.tag;
    // An excluded row shows nothing typed: the server cleared the override the
    // moment it was excluded, so showing a stale local value would be a lie.
    var typed = f.excluded ? undefined : S.overrides[f.tag];
    var shown = typed === undefined ? (f.value === null ? '' : f.value) : typed;

    return '<div class="fca-field' +
      (f.excluded ? ' fca-field-excluded' : (f.missing ? ' fca-field-missing' : '')) + '">' +
      '<dt><label for="' + fcaEsc(id) + '">' + fcaEsc(f.label) + '</label></dt>' +
      '<dd>' +
      '<span class="fca-fieldtop">' +
      // The value slot states the fact; the badge beside it states the layer.
      // They do not repeat the same word — together they read "no value / and
      // the reason is that no layer holds one". An excluded row says outright
      // what will happen, rather than leaving the therapist to infer it.
      (f.excluded
        ? '<span class="fca-excluded-note">Excluded — nothing will be inserted</span>'
        : (f.missing
          ? '<span class="fca-missing">' + icn('alert') + ' No value</span>'
          : '<span class="fca-value">' + fcaEsc(f.value) + '</span>')) +
      (f.excluded
        ? ''
        : '<span class="fca-badge fca-badge-' + fcaEsc(f.source) + '">' + fcaEsc(f.sourceLabel) + '</span>') +
      '</span>' +
      '<input type="text" class="fca-input fca-input-sm" id="' + fcaEsc(id) + '"' +
      ' data-fca-input="override" data-tag="' + fcaEsc(f.tag) + '"' +
      ' value="' + fcaEsc(shown) + '"' +
      (f.excluded ? ' disabled' : '') +
      ' placeholder="' + (f.excluded
        ? 'Excluded from this report'
        : (f.missing ? 'Type the real value, or leave blank' : 'Correct this value for this report')) + '"' +
      ' aria-describedby="fca-ov-help">' +
      '<span class="fca-exclude">' +
      '<input type="checkbox" id="' + fcaEsc(exId) + '"' +
      ' data-fca-check="exclude" data-tag="' + fcaEsc(f.tag) + '"' +
      (f.excluded ? ' checked' : '') +
      ' aria-describedby="fca-blank-note">' +
      '<label for="' + fcaEsc(exId) + '">Exclude<span class="fca-sr-only">' +
      ' ' + fcaEsc(f.label) + ' from this report</span></label>' +
      '</span>' +
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

  // Exclude / un-exclude one field. The whole list is sent, because exclusion
  // is a set the therapist owns outright and a merge could not express
  // un-excluding. The SERVER decides what this means for the document; the
  // manifest it sends back is what the next render draws.
  function setExcluded(tag, on) {
    if (!S.draft || !tag) return;
    var next = fcaToggleExcluded(currentExcluded(), tag, on);
    // Excluding CLEARS any value typed for this field — the server does the
    // same to the stored override, and leaving a local one behind would
    // resurrect it the moment the field was un-excluded.
    if (on) delete S.overrides[tag];
    // Reflected locally so the row de-emphasises immediately; the server's
    // manifest replaces this the moment the PATCH lands.
    if (S.draft.manifest) S.draft.manifest.excludedTags = next;
    S.draft.excludedFields = next;
    queuePatch({ excludedFields: next });
    render();
  }

  function currentExcluded() {
    if (!S.draft) return [];
    if (S.draft.manifest && Array.isArray(S.draft.manifest.excludedTags)) {
      return S.draft.manifest.excludedTags;
    }
    return Array.isArray(S.draft.excludedFields) ? S.draft.excludedFields : [];
  }

  // ── Step 4: sections and document ─────────────────────────────────────────
  // One step, two columns: what goes in the report on the left, the report
  // itself on the right. They were three stages, and the seam between them was
  // the whole problem — a therapist chose sections without seeing them, then
  // looked at a preview they could not edit, then generated a document from a
  // third screen. Every control here changes the document beside it.

  function renderStepFinal() {
    if (S.templateErr) {
      return finalHeading() + '<p class="fca-err">' + fcaEsc(S.templateErr) + '</p>';
    }
    if (!S.template) {
      loadTemplate();
      return finalHeading() + '<p class="fca-quiet">Loading the template…</p>';
    }

    var groups = fcaGroupSections(orderableSections());
    var out = finalHeading() +
      '<p class="fca-quiet">Every section you include is written into the Word document with its Opal styling and ' +
      'drafting prompts; excluded optional sections are removed cleanly. The preview beside this updates as you go.</p>' +
      renderDownloadResult() +
      renderSectionError() +
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
    out += renderFinalSummary();
    return out;
  }

  function finalHeading() {
    return '<h2 class="fca-h2" id="fca-step-h" tabindex="-1">Sections &amp; document</h2>';
  }

  /** A failed structural save, said plainly, where the sections are. */
  function renderSectionError() {
    if (!S.sectionErr) return '';
    return '<div class="fca-note fca-note-warn" id="fca-section-err" role="alert">' + icn('alert') +
      '<div><p>' + fcaEsc(S.sectionErr) + '</p>' +
      '<div class="fca-row-actions">' +
      '<button type="button" class="fca-btn" data-fca="retry-save">Try that change again</button>' +
      '</div></div></div>';
  }

  /**
   * What the last download produced. The link stays on screen so the therapist
   * can fetch the same document again without rebuilding it.
   */
  function renderDownloadResult() {
    var out = '';
    if (S.genErr) out += '<p class="fca-err" role="alert">' + fcaEsc(S.genErr) + '</p>';
    if (!S.result) return out;
    out += '<div class="fca-note fca-note-ok">' + icn('check') +
      '<div><p><strong>Your report is ready.</strong></p>' +
      '<p class="fca-quiet">' + fcaEsc(S.result.filename) + '</p>' +
      '<a class="fca-btn" href="' + API + '/documents/' + encodeURIComponent(S.result.documentId) + '/download"' +
      ' download data-fca-download>' + icn('doc') + ' Download the Word document again</a></div></div>';
    if (S.result.missingFields.length) {
      out += '<div class="fca-note fca-note-warn">' + icn('alert') +
        '<div><p><strong>' + S.result.missingFields.length + ' field(s) were left blank</strong> and appear as placeholders in the document:</p>' +
        '<p class="fca-quiet">' + S.result.missingFields.map(function (t) { return fcaEsc(fcaTagLabel(t)); }).join(', ') + '</p></div></div>';
    }
    if ((S.result.excludedFields || []).length) {
      out += '<p class="fca-inline-note">' + S.result.excludedFields.length +
        ' field(s) were excluded, and nothing was inserted for them: ' +
        S.result.excludedFields.map(function (t) { return fcaEsc(fcaTagLabel(t)); }).join(', ') + '.</p>';
    }
    if (S.result.warnings.length) {
      out += '<div class="fca-note fca-note-warn">' + icn('info') + '<div><p><strong>From the generator:</strong></p><ul>' +
        S.result.warnings.map(function (w) { return '<li>' + fcaEsc(w) + '</li>'; }).join('') + '</ul></div></div>';
    }
    return out;
  }

  /**
   * What used to be the "check before you generate" stage, kept because it was
   * worth reading — as a summary under the controls rather than a screen the
   * therapist had to walk to.
   */
  function renderFinalSummary() {
    var counts = fcaSectionCounts(S.draft ? S.draft.manifest : null);
    // Excluded fields are deliberately absent: they are answered questions,
    // not outstanding ones, and must never hold up a download the therapist
    // has already thought about.
    var summary = fcaMissingSummary(
      S.draft ? S.draft.missingFields : [],
      S.draft && S.draft.manifest ? S.draft.manifest.scalarData : {},
      currentExcluded()
    );
    var model = fcaPreviewModel(S.draft);

    var out = '<section class="fca-card" aria-labelledby="fca-final-h"><h3 id="fca-final-h">This document</h3>' +
      '<dl class="fca-summary">' +
      '<div><dt>Client</dt><dd>' + (model.clientName ? fcaEsc(model.clientName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      '<div><dt>Prepared by</dt><dd>' + (model.therapistName ? fcaEsc(model.therapistName) : '<span class="fca-missing">Missing</span>') + '</dd></div>' +
      '<div><dt>Sections included</dt><dd id="fca-seccount">' + counts.included + ' of ' + counts.total +
      ' <span class="fca-quiet">(' + counts.required + ' required, ' + counts.optional + ' optional, ' + counts.custom + ' custom)</span></dd></div>' +
      '<div><dt>Expected filename</dt><dd>' + fcaEsc(fcaFilenamePreview(S.draft)) +
      ' <span class="fca-quiet">— the final name comes from the server</span></dd></div>' +
      '</dl></section>';

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
    return out;
  }

  /** The included/excluded count, repainted on its own after a toggle. */
  function paintSectionCounts() {
    var node = el('fca-seccount');
    if (!node) return;
    var counts = fcaSectionCounts(S.draft ? S.draft.manifest : null);
    node.innerHTML = counts.included + ' of ' + counts.total +
      ' <span class="fca-quiet">(' + counts.required + ' required, ' + counts.optional +
      ' optional, ' + counts.custom + ' custom)</span>';
  }

  /** One checkbox row, brought into line with the state — no rebuild. */
  function paintSectionRow(tag) {
    var box = el('fca-sec-' + tag);
    if (!box) return;
    var on = isSelected(tag);
    box.checked = on;
    var row = box.closest ? box.closest('.fca-secitem') : null;
    if (row && row.classList) {
      if (on) row.classList.add('fca-secitem-on'); else row.classList.remove('fca-secitem-on');
    }
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
  // the same applyOrder(), so the keyboard path is not a degraded fallback and
  // the two can never disagree about where a section landed.
  //
  // Every row is KEYED by its section tag and every control carries a stable
  // id derived from it. That is what lets a move be a move: the row the
  // therapist is holding is the row that travels, keeping its focus with it.
  function renderOrderList() {
    var model = fcaPreviewModel(S.draft);
    if (!model.ready) return '';
    var items = model.included;
    return '<section class="fca-card" aria-labelledby="fca-order-h">' +
      '<h3 id="fca-order-h">Order of sections</h3>' +
      '<p class="fca-quiet">Drag to reorder, or use the move buttons — both work the same way.</p>' +
      '<ul class="fca-orderlist" id="fca-orderlist">' +
      items.map(function (s, i) { return renderOrderRow(s, i, items.length); }).join('') +
      '</ul></section>';
  }

  function renderOrderRow(s, i, total) {
    var tag = String(s.tag);
    return '<li class="fca-orderitem" draggable="true" data-tag="' + fcaEsc(tag) + '"' +
      ' aria-label="' + fcaEsc(s.title) + ', position ' + (i + 1) + ' of ' + total + '">' +
      '<span class="fca-grip" aria-hidden="true" title="Drag to reorder">' + icn('grip') + '</span>' +
      '<span class="fca-ordername">' + fcaEsc(s.title) + '</span>' +
      '<span class="fca-row-actions">' +
      '<button type="button" class="fca-iconbtn" id="fca-up-' + fcaEsc(tag) + '" data-fca="move-up" data-tag="' + fcaEsc(tag) + '"' +
      (i === 0 ? ' disabled' : '') + ' title="Move earlier" aria-label="Move ' + fcaEsc(s.title) + ' earlier">↑</button>' +
      '<button type="button" class="fca-iconbtn" id="fca-down-' + fcaEsc(tag) + '" data-fca="move-down" data-tag="' + fcaEsc(tag) + '"' +
      (i === total - 1 ? ' disabled' : '') + ' title="Move later" aria-label="Move ' + fcaEsc(s.title) + ' later">↓</button>' +
      '<button type="button" class="fca-iconbtn fca-iconbtn-out" id="fca-out-' + fcaEsc(tag) + '" data-fca="section-remove" data-tag="' + fcaEsc(tag) + '"' +
      (isLocked(tag) ? ' disabled title="Required by the Opal template — this section cannot be removed"' : ' title="Remove from this report"') +
      ' aria-label="Remove ' + fcaEsc(s.title) + ' from this report">' + icn('trash') + '</button>' +
      '</span></li>';
  }

  function isLocked(tag) {
    var meta = orderableSections().filter(function (s) { return String(s.tag) === String(tag); })[0];
    return !!(meta && meta.required === true);
  }

  /** Rebuild just the order list — the cheapest honest answer to a toggle. */
  function paintOrderList(flashTag) {
    var list = el('fca-orderlist');
    if (!list) return;
    var model = fcaPreviewModel(S.draft);
    if (!model.ready) return;
    var items = model.included;
    list.innerHTML = items.map(function (s, i) { return renderOrderRow(s, i, items.length); }).join('');
    if (flashTag) {
      for (var i = 0; i < list.children.length; i++) {
        if (list.children[i].getAttribute('data-tag') === flashTag) { flashRow(list.children[i]); break; }
      }
    }
  }

  /**
   * First and last lose a move button. Updated in place after a reorder so the
   * ends of the list are honest without recreating a single row.
   */
  function paintOrderControls() {
    var list = el('fca-orderlist');
    if (!list) return;
    var rows = list.children;
    for (var i = 0; i < rows.length; i++) {
      var up = rows[i].querySelector('[data-fca="move-up"]');
      var down = rows[i].querySelector('[data-fca="move-down"]');
      if (up) up.disabled = (i === 0);
      if (down) down.disabled = (i === rows.length - 1);
      rows[i].setAttribute('aria-label', (rows[i].querySelector('.fca-ordername') || {}).textContent
        + ', position ' + (i + 1) + ' of ' + rows.length);
    }
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
      // The values Opal issued for this document. Straight from the manifest —
      // an excluded one shows as omitted here exactly as it will be omitted
      // from the .docx.
      model.documentControl.map(function (f) {
        return '<div><dt>' + fcaEsc(f.label) + '</dt><dd>' +
          (f.excluded
            ? '<span class="fca-excluded-note">Excluded</span>'
            : fcaEsc(f.value == null ? '' : f.value)) + '</dd></div>';
      }).join('') +
      '</dl>';

    if (model.excludedFields.length) {
      out += '<p class="fca-inline-note">Excluded from this document — nothing will be inserted: ' +
        model.excludedFields.map(function (f) { return fcaEsc(f.label); }).join(', ') + '.</p>';
    }

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
    // Review data → Sections & document. There is nothing between them any more.
    if (a === 'next') { goStep(Math.min(FINAL_STEP, S.step + 1)); return; }
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
    if (a === 'custom-cancel') { S.customEditing = null; S.customTitle = ''; S.customGuidance = ''; repaintStep(); return; }
    if (a === 'move-up') { applyOrder(fcaMoveTag(currentOrder(), tag, -1), tag); return; }
    if (a === 'move-down') { applyOrder(fcaMoveTag(currentOrder(), tag, 1), tag); return; }
    if (a === 'section-remove') { removeFromReport(tag); return; }
    if (a === 'preview-toggle') {
      // A class, not a rebuild: opening the drawer must not cost the document
      // that is already drawn inside it.
      S.previewOpen = !S.previewOpen;
      var drawer = el('fca-preview');
      if (drawer && drawer.classList) {
        if (S.previewOpen) drawer.classList.add('fca-preview-open');
        else drawer.classList.remove('fca-preview-open');
      }
      t.setAttribute('aria-expanded', S.previewOpen ? 'true' : 'false');
      t.innerHTML = icn('doc') + ' ' + (S.previewOpen ? 'Hide preview' : 'Show preview');
      if (S.previewOpen) { ensureExactPreview(); remeasureSoon(); }
      return;
    }
    if (a === 'profile-open') { S.profileOpen = true; S.profileErr = ''; render(); return; }
    if (a === 'profile-close') { S.profileOpen = false; render(); return; }
    if (a === 'profile-save') { saveToProfile(); return; }
    if (a === 'download') { downloadDocument(); return; }
    if (a === 'preview-refresh') { S.exact.err = ''; S.exact.renderedSig = ''; scheduleExactPreview(0, true); return; }
    if (a === 'preview-full') {
      // Full screen changes the stage width, so the fitted base is measured
      // again — entering and leaving both land on a correctly fitted page.
      S.exact.full = !S.exact.full;
      var panel = el('fca-preview');
      if (panel && panel.classList) {
        if (S.exact.full) panel.classList.add('fca-preview-full');
        else panel.classList.remove('fca-preview-full');
      }
      paintExact();
      remeasureSoon();
      return;
    }
    if (a === 'zoom-in') { S.exact.fit = false; S.exact.zoom = Math.min(3, round1(S.exact.zoom + 0.1)); applyZoom(); return; }
    if (a === 'zoom-out') { S.exact.fit = false; S.exact.zoom = Math.max(0.4, round1(S.exact.zoom - 0.1)); applyZoom(); return; }
    if (a === 'zoom-fit') { S.exact.fit = true; S.exact.zoom = 1; applyZoom(); return; }
  });

  // Checkboxes and selects.
  doc.addEventListener('change', function (e) {
    var box = e.target && e.target.closest ? e.target.closest('[data-fca-check]') : null;
    if (box && box.getAttribute('data-fca-check') === 'section') {
      toggleSection(box.getAttribute('data-tag'));
      return;
    }
    if (box && box.getAttribute('data-fca-check') === 'exclude') {
      setExcluded(box.getAttribute('data-tag'), box.checked);
      return;
    }
    // Ticking a field to save is a local choice only — it sends nothing.
    if (box && box.getAttribute('data-fca-check') === 'profile-pick') {
      var pt = box.getAttribute('data-tag');
      if (box.checked) S.profilePick[pt] = true; else delete S.profilePick[pt];
      render();
      return;
    }
    if (box) return;
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
    // The browser's own drop behaviour is a navigation. Stopped here, and
    // again on dragover above, so a dropped row never leaves the page.
    e.preventDefault();
    if (e.stopPropagation) e.stopPropagation();
    var target = li.getAttribute('data-tag');
    var moved = S.dragTag;
    S.dragTag = null;
    var n = doc.querySelector('.fca-dragging');
    if (n) n.classList.remove('fca-dragging');
    // Identical to the move buttons — same helper, same state, same repaint.
    applyOrder(fcaReorderTo(currentOrder(), moved, target), moved);
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

  /**
   * @param {number} [step] where to land. Mapped through fcaMapStep, so a
   *   restored route that still says step 5 or 6 — the wizard's old Preview and
   *   Generate stages — opens on the consolidated final step instead of
   *   nowhere. Without a draft the gate in goStep sends it back to step 1.
   */
  function openWizard(step) {
    lastFocus = doc.activeElement;
    S.open = true;
    var want = fcaMapStep(step === undefined || step === null ? 1 : step);
    S.step = canEnter(want) ? want : 1;
    S.furthest = Math.max(S.furthest, S.step);
    S.result = null; S.genErr = ''; S.sectionErr = '';
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
    S.exact.full = false;
    // Nothing scheduled is allowed to outlive the wizard: no observer watching
    // a stage that no longer exists, no debounce firing into a closed dialog.
    teardownFit();
    if (exactTimer) { clearTimeout(exactTimer); exactTimer = null; }
    if (flashTimer) { clearTimeout(flashTimer); flashTimer = null; }
    if (S.exact.ctrl) { try { S.exact.ctrl.abort(); } catch (_) {} S.exact.ctrl = null; }
    S.exact.rev += 1;                    // any response still in flight is stale
    S.exact.status = 'idle';
    S.exact.renderedSig = '';
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
        .observe(hub, { childList: true, subtree: false, attributes: true, attributeFilter: ['data-view', 'data-collection'] });
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
