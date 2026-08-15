/* ═══════════════════════════════════════════════════════════════════════════
   OPAL PROGRESS NOTE LETTER BUILDER — front end for the progress-note letter
   wizard. Renders the entry point into #letter-hub-entry (Resource Hub home,
   beside the FCA card) and the whole five-step wizard into #letter-root.

   This is the SIMPLER SIBLING of fca.js, not a copy of it. It reuses the same
   conventions — single IIFE, esc() on every untrusted value, pure helpers
   exported for node tests, delegated data-ltr handlers, debounced PATCH,
   manifest-driven preview — but the letter is a one-page document, so the
   block picker is a short locked/optional list rather than the FCA's grouped
   section menus, and there is no preset system and no template reordering.

   NON-NEGOTIABLES ENCODED HERE:
     1. THE MANIFEST IS THE SINGLE SOURCE OF TRUTH FOR STRUCTURE AND VALUES.
        Which blocks exist, what they are called, whether they are included
        and in what order all come from draft.manifest.sections; every merged
        value and its origin come from draft.manifest.scalarData /
        .scalarSources. There is deliberately NO block list and NOT ONE
        template tag literal in this file — a second copy of either would be
        a second source of truth that could silently disagree with the DOCX
        the generator produces. If the manifest is absent the preview says
        so rather than reconstructing a letter locally.
        The recipient block, CC line and letter details render from the
        draft's own structured fields (draft.recipient / draft.ccRecipients /
        draft.letterDetails) — these are server state echoed back by PATCH,
        never a locally computed structure.
     2. NEVER INVENT PARTICIPANT DATA. Every scalar arrives already resolved by
        the server and carries its origin verbatim in scalarSources. The badge
        beside a field is that origin — this file never decides where a value
        came from, and an origin it does not recognise reads as Missing rather
        than as an optimistic guess. There is not one '|| fallback' to invented
        text here. The therapist may TYPE a real value; typed values are real
        data and travel as scalarOverrides. Nothing is ever guessed for them.
     3. THE TWO REQUIRED BLOCKS CANNOT BE UNCHECKED. They render checked,
        disabled, with a lock affordance and an explanatory tooltip. The server
        enforces this independently; this is the honest reflection of it.
     4. SAVING A RECIPIENT TO THE PARTICIPANT'S PROFILE IS EXPLICIT AND NARROW.
        Nothing here writes to the reusable report profile implicitly: not on
        PATCH, not on Continue, not on generate. Only the therapist pressing
        "Save this recipient to the participant's report profile", having
        chosen where it should be filed, calls save-recipient-to-profile. The
        step says plainly that letter-specific edits are not otherwise kept.
     5. REQUIRED MISSING VALUES BLOCK GENERATION. The generate button is dead
        while anything the letter cannot be written without is absent, and the
        reason is stated with a link back to the step that fixes it.
     6. NOTHING DOWNLOADS BY ITSELF. Generation is an explicit confirmation,
        and the finished document is offered as a link the therapist clicks.
     7. NO PARTICIPANT DATA LEAVES THE PAGE. There is deliberately no console.*
        call, no storage write, no analytics call and no participant field in
        any query string — only opaque ids travel in URLs.
     8. AUSTRALIAN ENGLISH AND AUSTRALIAN DATES. Dates are dd/mm/yyyy on entry
        and "10 August 2026" in the letter preview, formatted from explicit
        parts rather than from the viewer's locale, so a US-configured browser
        can never render an Australian clinical letter in US order.

   API (fixed contract — consumed exactly, nothing invented):
     GET    /api/letters/template
     GET    /api/letters/clients?q=
     GET    /api/letters/clients/:clientId/contacts
     POST   /api/letters/drafts                  { clientId, therapistProfileId? }
     GET    /api/letters/drafts
     GET    /api/letters/drafts/:id
     PATCH  /api/letters/drafts/:id              { recipient?, ccRecipients?,
                                                   letterDetails?, selectedSections?,
                                                   customSections?, scalarOverrides?,
                                                   excludedFields? }
     POST   /api/letters/drafts/:id/save-recipient-to-profile { target }
     POST   /api/letters/drafts/:id/generate
     GET    /api/letters/documents/:documentId/download
     DELETE /api/letters/drafts/:id
   The one non-/api/letters call is GET /api/therapists — the portal's existing
   therapist-profile list, reused (not re-invented) for step 3.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // ══ PURE HELPERS (node-exported for unit tests) ═══════════════════════════

  function ltrEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Title-case an unknown server key for display: 'saved_contact' → 'Saved contact'.
  function ltrHumanise(key) {
    var words = String(key == null ? '' : key).replace(/[_\-]+/g, ' ').trim().toLowerCase();
    if (!words) return '';
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  // ── TAG DERIVATION ───────────────────────────────────────────────────────
  // Labels and groupings are DERIVED from the merge tag itself, never from a
  // hand-maintained dictionary in this file: a dictionary would be a second
  // copy of the template contract and would drift the moment the template did.
  //   OPAL_CLIENT_NDIS_NUMBER → group 'client', label 'NDIS number'
  var LTR_TAG_ACRONYMS = { ndis: 'NDIS', id: 'ID', dob: 'DOB', cc: 'CC', ahpra: 'AHPRA' };

  function ltrTagParts(tag) {
    var parts = String(tag == null ? '' : tag).split('_').filter(Boolean);
    if (parts.length && parts[0].toUpperCase() === 'OPAL') parts = parts.slice(1);
    return parts;
  }
  function ltrTagGroup(tag) {
    var parts = ltrTagParts(tag);
    if (!parts.length) return 'other';
    return parts[0].toLowerCase();
  }
  function ltrTagLabel(tag) {
    var parts = ltrTagParts(tag);
    if (parts.length > 1) parts = parts.slice(1);
    if (!parts.length) return String(tag == null ? '' : tag);
    return parts.map(function (p, i) {
      var low = p.toLowerCase();
      if (LTR_TAG_ACRONYMS[low]) return LTR_TAG_ACRONYMS[low];
      return i === 0 ? low.charAt(0).toUpperCase() + low.slice(1) : low;
    }).join(' ');
  }

  // ── SOURCE ATTRIBUTION ───────────────────────────────────────────────────
  // The server emits a documented superset of origins:
  //   'splose' | 'client_profile' | 'report_override' | 'missing' | 'portal' | 'server'
  // 'portal' is split by the tag's own group so the badge names the setting
  // screen the therapist would actually go and edit; everything else maps one
  // to one. The mapping is TOTAL and CLOSED: an origin the server does not
  // name reads as Missing, because the honest answer to "where did this come
  // from?" is never a guess.
  var LTR_SOURCE_LABELS = {
    splose: 'Splose',
    client_profile: 'Opal client profile',
    portal_therapist: 'Therapist profile',
    portal_organisation: 'Organisation settings',
    report_override: 'Entered for this letter',
    server: 'Generated by Opal',
    missing: 'Missing',
  };
  // The six labels the badge legend shows. 'Generated by Opal' is deliberately
  // not in the legend: it is the server-issued document id, not a value the
  // therapist can source or change.
  var LTR_SOURCE_ORDER = [
    'splose', 'client_profile', 'portal_therapist',
    'portal_organisation', 'report_override', 'missing',
  ];

  function ltrSourceKey(source, tag) {
    var k = String(source == null ? '' : source).trim().toLowerCase();
    if (k === 'portal') {
      return ltrTagGroup(tag) === 'organisation' ? 'portal_organisation' : 'portal_therapist';
    }
    return LTR_SOURCE_LABELS[k] ? k : 'missing';
  }
  function ltrSourceLabel(source, tag) {
    return LTR_SOURCE_LABELS[ltrSourceKey(source, tag)];
  }

  // ── AUSTRALIAN DATES ─────────────────────────────────────────────────────
  // Built from explicit parts, never from toLocaleDateString: a browser set to
  // en-US would otherwise print 08/10/2026 for the tenth of August and nothing
  // on screen would say which reading was meant.
  var LTR_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  function ltrDateParts(value) {
    if (value == null || value === '') return null;
    var s = String(value).trim();
    var iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (iso) {
      var y = Number(iso[1]), mo = Number(iso[2]), d = Number(iso[3]);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return { year: y, month: mo, day: d };
    }
    var dt = value instanceof Date ? value : new Date(s);
    if (!dt || isNaN(dt.getTime())) return null;
    return { year: dt.getFullYear(), month: dt.getMonth() + 1, day: dt.getDate() };
  }

  function ltrPad2(n) { return (n < 10 ? '0' : '') + n; }

  // ISO (or Date) → 'dd/mm/yyyy'. Unparseable input returns '' — never a
  // half-formed date and never today's date standing in for a real one.
  function ltrFormatAUDate(value) {
    var p = ltrDateParts(value);
    if (!p) return '';
    return ltrPad2(p.day) + '/' + ltrPad2(p.month) + '/' + p.year;
  }

  // ISO (or Date) → '10 August 2026', the form the letter itself carries.
  function ltrLongAUDate(value) {
    var p = ltrDateParts(value);
    if (!p) return '';
    return p.day + ' ' + LTR_MONTHS[p.month - 1] + ' ' + p.year;
  }

  // 'dd/mm/yyyy' (or d/m/yyyy) → 'YYYY-MM-DD'. Day-first ALWAYS: 03/04/2026 is
  // the third of April. A two-digit year is rejected rather than assumed, and
  // a day/month out of range is rejected rather than rolled over.
  function ltrParseAUDate(text) {
    var m = /^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})\s*[\/\-.]\s*(\d{4})$/.exec(String(text == null ? '' : text).trim());
    if (!m) return null;
    var d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var probe = new Date(Date.UTC(y, mo - 1, d));
    if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
    return y + '-' + ltrPad2(mo) + '-' + ltrPad2(d);
  }

  function ltrTodayISO(now) {
    var d = now instanceof Date ? now : new Date();
    if (isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + ltrPad2(d.getMonth() + 1) + '-' + ltrPad2(d.getDate());
  }

  // ── BLOCK GROUPING ───────────────────────────────────────────────────────
  // Two buckets only — the letter is short. Tags, labels, descriptions and
  // defaults all arrive from GET /api/letters/template; `required` always wins
  // so a required block can never be presented as optional.
  var LTR_BLOCK_GROUPS = [
    { key: 'required', label: 'Always included', locked: true },
    { key: 'optional', label: 'Optional sections', locked: false },
  ];

  function ltrBlockGroupKey(section) {
    return section && section.required === true ? 'required' : 'optional';
  }

  function ltrGroupBlocks(sections) {
    var list = (Array.isArray(sections) ? sections : []).filter(function (s) { return s && s.tag; });
    function byOrder(a, b) {
      var ao = Number(a.defaultOrder), bo = Number(b.defaultOrder);
      if (isFinite(ao) && isFinite(bo) && ao !== bo) return ao - bo;
      return 0;
    }
    return LTR_BLOCK_GROUPS.map(function (g) {
      return {
        key: g.key,
        label: g.label,
        locked: g.locked,
        sections: list.filter(function (s) { return ltrBlockGroupKey(s) === g.key; }).slice().sort(byOrder),
      };
    }).filter(function (g) { return g.sections.length > 0; });
  }

  // Default selection straight from the template: required always, optional
  // where the template says defaultSelected.
  function ltrDefaultSelection(sections) {
    return (Array.isArray(sections) ? sections : []).filter(function (s) {
      return s && s.tag && (s.required === true || s.defaultSelected === true);
    }).map(function (s) { return String(s.tag); });
  }

  // A selection that keeps every required tag no matter what arrives.
  function ltrEnforceRequired(selected, sections) {
    var out = [], seen = {};
    (Array.isArray(sections) ? sections : []).forEach(function (s) {
      if (!s || !s.tag || s.required !== true) return;
      var t = String(s.tag);
      if (!seen[t]) { seen[t] = true; out.push(t); }
    });
    (Array.isArray(selected) ? selected : []).forEach(function (t) {
      var k = String(t);
      if (!seen[k]) { seen[k] = true; out.push(k); }
    });
    return out;
  }

  // ── CUSTOM CONTENT ───────────────────────────────────────────────────────
  // Letter-sized by construction: a short optional label and a drafting
  // prompt. An entry with neither is not content, so it is dropped rather
  // than written into the document as an empty heading.
  var LTR_CUSTOM_LABEL_MAX = 120;
  var LTR_CUSTOM_GUIDANCE_MAX = 600;

  function ltrNormaliseCustom(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (c, i) {
      if (!c || typeof c !== 'object') return;
      var label = String(c.label == null ? '' : c.label).replace(/\s+/g, ' ').trim().slice(0, LTR_CUSTOM_LABEL_MAX);
      var guidance = String(c.guidance == null ? '' : c.guidance).trim().slice(0, LTR_CUSTOM_GUIDANCE_MAX);
      if (!label && !guidance) return;
      var id = String(c.id == null || c.id === '' ? ('custom-' + (i + 1)) : c.id);
      if (seen[id]) return;
      seen[id] = true;
      out.push({
        id: id,
        tag: String(c.tag == null || c.tag === '' ? id : c.tag),
        label: label,
        guidance: guidance,
        order: out.length,
      });
    });
    return out;
  }

  // Move a custom block one place up (-1) or down (+1). This is the keyboard
  // path and the pointer path both — there is no mouse-only reordering here.
  function ltrMoveCustom(list, id, delta) {
    var arr = (Array.isArray(list) ? list : []).slice();
    var from = -1;
    arr.forEach(function (c, i) { if (c && String(c.id) === String(id)) from = i; });
    if (from === -1) return arr;
    var to = from + (Number(delta) || 0);
    if (to < 0 || to >= arr.length) return arr;
    var moved = arr.splice(from, 1)[0];
    arr.splice(to, 0, moved);
    return arr.map(function (c, i) { return Object.assign({}, c, { order: i }); });
  }

  // ── RECIPIENTS ───────────────────────────────────────────────────────────
  var LTR_CONTACT_LABELS = {
    support_coordinator: 'Support coordinator',
    nominee: 'Nominee',
    referrer: 'Referrer',
    saved_contact: 'Saved contact',
  };
  var LTR_CONTACT_TARGETS = ['support_coordinator', 'nominee', 'referrer', 'saved_contact'];

  function ltrContactSourceLabel(source) {
    var k = String(source == null ? '' : source).trim().toLowerCase();
    return LTR_CONTACT_LABELS[k] ? LTR_CONTACT_LABELS[k] : ltrHumanise(k);
  }

  // A salutation SUGGESTION, derived only from a name the therapist can see.
  // No name means no suggestion — a letter is never addressed to a guess.
  function ltrSuggestSalutation(recipient) {
    var name = recipient && recipient.name != null ? String(recipient.name).replace(/\s+/g, ' ').trim() : '';
    if (!name) return '';
    return 'Dear ' + name;
  }

  // What the CC line will actually look like in the document — including the
  // fact that it will not appear at all, which matters because the template
  // deletes the whole CC paragraph when it is unused.
  function ltrCcSummary(ccRecipients) {
    var names = [];
    (Array.isArray(ccRecipients) ? ccRecipients : []).forEach(function (c) {
      if (!c || typeof c !== 'object') return;
      var name = String(c.name == null ? '' : c.name).replace(/\s+/g, ' ').trim();
      var org = String(c.organisation == null ? '' : c.organisation).replace(/\s+/g, ' ').trim();
      if (!name && !org) return;
      names.push(name && org ? (name + ', ' + org) : (name || org));
    });
    return {
      count: names.length,
      names: names,
      willAppear: names.length > 0,
      text: names.length
        ? 'CC: ' + names.join('; ')
        : 'No CC line will appear — the whole line is removed from the letter.',
    };
  }

  // ── SCALAR MODEL ─────────────────────────────────────────────────────────
  // Every field is (value, source) exactly as the server resolved it. The
  // server's scalarSources is the authority; a blank value only settles the
  // matter when the server sent no origin for that tag at all.
  var LTR_FIELD_GROUP_ORDER = ['client', 'letter', 'recipient', 'therapist', 'organisation'];
  var LTR_FIELD_GROUP_LABELS = {
    client: 'Participant',
    letter: 'Letter',
    recipient: 'Recipient',
    therapist: 'Therapist',
    organisation: 'Organisation',
  };

  function ltrFieldGroupLabel(key) {
    return LTR_FIELD_GROUP_LABELS[key] ? LTR_FIELD_GROUP_LABELS[key] : ltrHumanise(key);
  }

  // ── THE NOTE ─────────────────────────────────────────────────────────────
  // One calm line at the top of the missing/exclude area. It states the two
  // real options and neither of the two wrong ones: no field is ever filled
  // with a guess, and no therapist is ever stuck. Worded identically in the
  // FCA report builder, because it is the same promise about the same thing.
  var LTR_BLANK_OR_EXCLUDE_NOTE = 'If we do not hold this information, you can '
    + 'leave it blank and complete it in Word after downloading — or exclude it '
    + 'so nothing is inserted.';

  // Add or remove one tag from the exclusion list. Returns a NEW array, which
  // is what the server is sent: exclusion is a set the therapist owns
  // outright, so it is replaced wholesale rather than merged.
  function ltrToggleExcluded(current, tag, on) {
    var list = (Array.isArray(current) ? current : []).map(String)
      .filter(function (t) { return t !== String(tag); });
    if (on) list.push(String(tag));
    return list;
  }

  // The tags the SERVER says are excluded. Read from the manifest and nowhere
  // else: exclusion changes what the DOCX contains, so a locally computed
  // version could disagree with the letter that is actually produced.
  function ltrExcludedSet(manifest) {
    var m = manifest && typeof manifest === 'object' ? manifest : {};
    var out = {};
    (Array.isArray(m.excludedTags) ? m.excludedTags : []).forEach(function (t) {
      out[String(t)] = true;
    });
    return out;
  }

  // The SAME exclusion, restated by the server in the wizard's own field
  // vocabulary — recipientName, subject, cc and so on. This is what lets the
  // addressing preview honour an exclusion without this file ever naming a
  // merge tag; the tag → field mapping is part of the template contract, and
  // the template contract lives on the server.
  function ltrExcludedFields(draft) {
    var d = draft && typeof draft === 'object' ? draft : {};
    var raw = d.excludedLetterFields;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  }

  function ltrScalarModel(manifest) {
    var m = manifest && typeof manifest === 'object' ? manifest : {};
    var data = m.scalarData && typeof m.scalarData === 'object' ? m.scalarData : {};
    var sources = m.scalarSources && typeof m.scalarSources === 'object' ? m.scalarSources : {};
    var excluded = ltrExcludedSet(m);

    var buckets = {}, seen = [];
    Object.keys(data).forEach(function (tag) {
      var raw = data[tag];
      var blank = raw == null || (typeof raw === 'string' && raw.trim() === '');
      var hasOrigin = Object.prototype.hasOwnProperty.call(sources, tag);
      var key = hasOrigin ? ltrSourceKey(sources[tag], tag) : (blank ? 'missing' : 'report_override');
      // `excluded` is a THIRD state, not a flavour of missing. Missing means
      // "no layer holds this" — a gap to fill. Excluded means the therapist
      // has said there is nothing to hold, so nothing is inserted and nothing
      // is outstanding.
      var isExcluded = !!excluded[tag];
      var missing = !isExcluded && (key === 'missing' || blank);
      var g = ltrTagGroup(tag);
      if (!buckets[g]) { buckets[g] = []; seen.push(g); }
      buckets[g].push({
        tag: tag,
        label: ltrTagLabel(tag),
        value: (missing || isExcluded) ? null : String(raw),
        source: missing ? 'missing' : key,
        sourceLabel: LTR_SOURCE_LABELS[missing ? 'missing' : key],
        missing: missing,
        excluded: isExcluded,
        // Everything is editable, the issued document id included: Opal
        // supplies a sensible default and a practice that numbers its own
        // correspondence is not overruled. An excluded row is the exception —
        // there is nothing to type into a field that will not be inserted.
        editable: !isExcluded,
      });
    });

    var keys = [];
    LTR_FIELD_GROUP_ORDER.forEach(function (k) { if (buckets[k]) keys.push(k); });
    seen.forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); });
    return keys.map(function (k) {
      return { key: k, label: ltrFieldGroupLabel(k), fields: buckets[k] };
    });
  }

  function ltrScalarFields(manifest, groupKey) {
    var groups = ltrScalarModel(manifest).filter(function (g) { return g.key === groupKey; });
    return groups.length ? groups[0].fields : [];
  }

  // ── PREVIEW MODEL ────────────────────────────────────────────────────────
  // Built from draft.manifest for structure and merged values, and from the
  // draft's own server-echoed recipient / CC / letter-detail snapshots for the
  // addressing. If the server has not composed a manifest yet there is nothing
  // honest to show, so the model reports that instead of assembling a letter
  // out of local guesses.
  function ltrPreviewModel(draft) {
    var d = draft && typeof draft === 'object' ? draft : null;
    var manifest = d && d.manifest && typeof d.manifest === 'object' ? d.manifest : null;
    var details = d && d.letterDetails && typeof d.letterDetails === 'object' ? d.letterDetails : {};
    var recipient = d && d.recipient && typeof d.recipient === 'object' ? d.recipient : {};
    var custom = ltrNormaliseCustom(d ? d.customSections : []);

    var base = {
      ready: false,
      clientName: d ? String(d.clientName == null ? '' : d.clientName) : '',
      clientPreferredName: d ? String(d.clientPreferredName == null ? '' : d.clientPreferredName) : '',
      therapistName: d ? String(d.therapistName == null ? '' : d.therapistName) : '',
      templateVersion: d ? String(d.templateVersion == null ? '' : d.templateVersion) : '',
      letterDate: String(details.letterDate == null ? '' : details.letterDate),
      letterDateLong: ltrLongAUDate(details.letterDate),
      subject: String(details.subject == null ? '' : details.subject),
      reportingPeriod: String(details.reportingPeriod == null ? '' : details.reportingPeriod),
      documentId: String(details.documentId == null ? '' : details.documentId),
      recipient: {
        name: String(recipient.name == null ? '' : recipient.name),
        role: String(recipient.role == null ? '' : recipient.role),
        organisation: String(recipient.organisation == null ? '' : recipient.organisation),
        address: String(recipient.address == null ? '' : recipient.address),
        salutation: String(recipient.salutation == null ? '' : recipient.salutation),
      },
      cc: ltrCcSummary(d ? d.ccRecipients : []),
      custom: custom,
      blocks: [], included: [], excluded: [],
      letterhead: [], participantFields: [], signatureFields: [], letterFields: [],
      scalarGroups: [], excludedFields: [],
    };
    if (!manifest || !Array.isArray(manifest.sections)) return base;

    var blocks = manifest.sections.map(function (s, i) {
      return {
        tag: s && s.tag ? String(s.tag) : '',
        title: s && s.title == null ? '' : String(s.title),
        kind: s && s.kind ? String(s.kind) : '',
        included: !!(s && s.included),
        order: isFinite(Number(s && s.order)) ? Number(s.order) : i,
      };
    }).filter(function (s) { return s.tag; });

    function bySeq(a, b) { return a.order === b.order ? 0 : a.order - b.order; }
    base.ready = true;
    base.blocks = blocks.slice().sort(bySeq);
    base.included = blocks.filter(function (s) { return s.included; }).sort(bySeq);
    base.excluded = blocks.filter(function (s) { return !s.included; }).sort(bySeq);
    // One model, one truth: the preview's values are the same computation the
    // review step renders, so a badge and a preview line can never disagree.
    base.scalarGroups = ltrScalarModel(manifest);
    base.letterhead = ltrScalarFields(manifest, 'organisation');
    base.participantFields = ltrScalarFields(manifest, 'client');
    base.signatureFields = ltrScalarFields(manifest, 'therapist');
    base.letterFields = ltrScalarFields(manifest, 'letter');
    // What the therapist has excluded, so the preview can say so rather than
    // silently showing a line that will not be there. Every list below is
    // filtered by this, because an excluded value is not in the letter.
    base.scalarGroups.forEach(function (g) {
      g.fields.forEach(function (f) { if (f.excluded) base.excludedFields.push(f); });
    });
    var drop = function (list) { return list.filter(function (f) { return !f.excluded; }); };
    base.letterhead = drop(base.letterhead);
    base.participantFields = drop(base.participantFields);
    base.signatureFields = drop(base.signatureFields);
    base.letterFields = drop(base.letterFields);

    // The addressing block is drawn from the draft's own snapshots rather than
    // from the manifest's scalar list, so exclusion has to be applied to it
    // explicitly — otherwise the preview would show a line the .docx will not
    // contain, which is exactly the disagreement this design exists to stop.
    //
    // The SERVER says which of these fields are excluded, in the wizard's own
    // vocabulary (draft.excludedLetterFields). This file therefore still
    // contains no merge tag: the tag → field mapping belongs to the template
    // contract, and the template contract lives on the server.
    var ex = ltrExcludedFields(d);
    if (ex.documentId) base.documentId = '';
    if (ex.subject) base.subject = '';
    if (ex.reportingPeriod) base.reportingPeriod = '';
    if (ex.letterDate) { base.letterDate = ''; base.letterDateLong = ''; }
    if (ex.recipientName) base.recipient.name = '';
    if (ex.recipientRole) base.recipient.role = '';
    if (ex.recipientOrganisation) base.recipient.organisation = '';
    if (ex.recipientAddress) base.recipient.address = '';
    if (ex.salutation) base.recipient.salutation = '';
    if (ex.cc) {
      base.cc = {
        count: 0, names: [], willAppear: false,
        text: 'No CC line will appear — the whole line is removed from the letter.',
      };
    }
    return base;
  }

  function ltrBlockCounts(manifest) {
    var sections = manifest && Array.isArray(manifest.sections) ? manifest.sections : [];
    var inc = sections.filter(function (s) { return s && s.included; });
    return {
      total: sections.length,
      included: inc.length,
      excluded: sections.length - inc.length,
      required: inc.filter(function (s) { return s && s.kind === 'required'; }).length,
      optional: inc.filter(function (s) { return s && s.kind === 'optional'; }).length,
      custom: inc.filter(function (s) { return s && s.kind === 'custom'; }).length,
    };
  }

  // ── WHAT BLOCKS GENERATION ───────────────────────────────────────────────
  // A letter cannot be written without a participant, someone to address it
  // to, a subject line and a date. Beyond those four the authority is the
  // SERVER: a template scalar the template itself marks required, which the
  // server reports in draft.missingFields, blocks too. Nothing else does —
  // an optional blank becomes a marked placeholder in the document, which is
  // a completion prompt, not an error.
  //
  // NOTHING EXCLUDED EVER BLOCKS. The server accepts a generate with an
  // excluded required field, so a UI that refused it would simply be wrong,
  // and would leave the therapist unable to act on a decision they had
  // already made.
  function ltrRequiredScalarTags(template) {
    var out = [];
    var list = template && Array.isArray(template.scalarTags) ? template.scalarTags : [];
    list.forEach(function (t) {
      if (t && typeof t === 'object' && t.required === true && t.tag) out.push(String(t.tag));
    });
    return out;
  }

  function ltrBlockingIssues(draft, template) {
    var d = draft && typeof draft === 'object' ? draft : {};
    var details = d.letterDetails && typeof d.letterDetails === 'object' ? d.letterDetails : {};
    var recipient = d.recipient && typeof d.recipient === 'object' ? d.recipient : {};
    var issues = [];
    var excluded = ltrExcludedSet(d.manifest);
    var exField = ltrExcludedFields(d);

    function blank(v) { return v == null || String(v).trim() === ''; }

    if (blank(d.clientId) && blank(d.clientName)) {
      issues.push({ key: 'participant', step: 1, label: 'Participant', message: 'Choose the participant this letter is about.' });
    }
    if (blank(recipient.name) && !exField.recipientName) {
      issues.push({ key: 'recipient', step: 2, label: 'Addressee', message: 'The letter needs a named recipient before it can be produced.' });
    }
    if (blank(details.subject) && !exField.subject) {
      issues.push({ key: 'subject', step: 3, label: 'Subject', message: 'Enter the subject line for this letter.' });
    }
    if (!ltrDateParts(details.letterDate) && !exField.letterDate) {
      issues.push({ key: 'letterDate', step: 3, label: 'Letter date', message: 'Enter the letter date as dd/mm/yyyy.' });
    }

    // An EXCLUDED tag never blocks. The therapist has already answered the
    // question, the engine inserts nothing for it, and the server accepts the
    // generate — so refusing here would be the UI disagreeing with the truth.
    var excluded = ltrExcludedSet(d.manifest);
    var missing = {};
    (Array.isArray(d.missingFields) ? d.missingFields : []).forEach(function (t) {
      if (!excluded[String(t)]) missing[String(t)] = true;
    });
    ltrRequiredScalarTags(template).forEach(function (tag) {
      if (!missing[tag]) return;
      issues.push({
        key: tag, step: 3, label: ltrTagLabel(tag),
        message: 'The template requires ' + ltrTagLabel(tag).toLowerCase() + ' and no source holds a value for it.',
      });
    });
    return issues;
  }

  // Everything blank, blocking or not, grouped the way the review step reads.
  // An EXCLUDED tag is never listed: it is an answered question, not an
  // outstanding one, and re-asking would turn a decision back into a nag.
  function ltrMissingSummary(missingFields, scalarData, excludedTags) {
    var data = scalarData && typeof scalarData === 'object' ? scalarData : {};
    var skip = {};
    (Array.isArray(excludedTags) ? excludedTags : []).forEach(function (t) { skip[String(t)] = true; });
    var flagged = {}, tags = [];
    (Array.isArray(missingFields) ? missingFields : []).forEach(function (t) {
      var k = String(t);
      if (!flagged[k] && !skip[k]) { flagged[k] = true; tags.push(k); }
    });
    Object.keys(data).forEach(function (k) {
      var v = data[k];
      var blank = v == null || (typeof v === 'string' && v.trim() === '');
      if (blank && !flagged[k] && !skip[k]) { flagged[k] = true; tags.push(k); }
    });
    var groups = {}, order = [];
    tags.forEach(function (t) {
      var g = ltrTagGroup(t);
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push({ tag: t, label: ltrTagLabel(t) });
    });
    return {
      count: tags.length,
      tags: tags,
      groups: order.map(function (g) { return { key: g, label: ltrFieldGroupLabel(g), fields: groups[g] }; }),
    };
  }

  // ── FILENAME PREVIEW ─────────────────────────────────────────────────────
  // The SERVER owns the real filename and returns it from generate; this is
  // what the confirmation step shows beforehand, always labelled as the
  // expected name. Components are sanitised the way a filename must be —
  // separators and reserved characters out, spacing collapsed — while the
  // contracted shape "Progress Note Letter - Name - YYYY-MM-DD.docx" is kept.
  function ltrSanitiseFilePart(s) {
    return String(s == null ? '' : s)
      /* eslint-disable-next-line no-control-regex */
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^[\s.-]+|[\s.-]+$/g, '')
      .slice(0, 60)
      .trim();
  }

  function ltrFilenamePreview(draft, now) {
    var d = draft && typeof draft === 'object' ? draft : {};
    var details = d.letterDetails && typeof d.letterDetails === 'object' ? d.letterDetails : {};
    var preferred = ltrSanitiseFilePart(d.clientPreferredName);
    var full = ltrSanitiseFilePart(d.clientName);
    var who = preferred || full;
    var iso = ltrDateParts(details.letterDate) ? String(details.letterDate).slice(0, 10) : ltrTodayISO(now);
    var parts = ['Progress Note Letter'];
    if (who) parts.push(who);
    if (iso) parts.push(ltrSanitiseFilePart(iso));
    return parts.join(' - ') + '.docx';
  }

  var helpers = {
    ltrEsc: ltrEsc,
    ltrHumanise: ltrHumanise,
    ltrTagGroup: ltrTagGroup,
    ltrTagLabel: ltrTagLabel,
    ltrSourceKey: ltrSourceKey,
    ltrSourceLabel: ltrSourceLabel,
    ltrFormatAUDate: ltrFormatAUDate,
    ltrLongAUDate: ltrLongAUDate,
    ltrParseAUDate: ltrParseAUDate,
    ltrTodayISO: ltrTodayISO,
    ltrBlockGroupKey: ltrBlockGroupKey,
    ltrGroupBlocks: ltrGroupBlocks,
    ltrDefaultSelection: ltrDefaultSelection,
    ltrEnforceRequired: ltrEnforceRequired,
    ltrNormaliseCustom: ltrNormaliseCustom,
    ltrMoveCustom: ltrMoveCustom,
    ltrContactSourceLabel: ltrContactSourceLabel,
    ltrSuggestSalutation: ltrSuggestSalutation,
    ltrCcSummary: ltrCcSummary,
    ltrFieldGroupLabel: ltrFieldGroupLabel,
    ltrExcludedSet: ltrExcludedSet,
    ltrExcludedFields: ltrExcludedFields,
    ltrToggleExcluded: ltrToggleExcluded,
    ltrScalarModel: ltrScalarModel,
    ltrScalarFields: ltrScalarFields,
    ltrPreviewModel: ltrPreviewModel,
    ltrBlockCounts: ltrBlockCounts,
    ltrRequiredScalarTags: ltrRequiredScalarTags,
    ltrBlockingIssues: ltrBlockingIssues,
    ltrMissingSummary: ltrMissingSummary,
    ltrSanitiseFilePart: ltrSanitiseFilePart,
    ltrFilenamePreview: ltrFilenamePreview,
    LTR_SOURCE_LABELS: LTR_SOURCE_LABELS,
    LTR_SOURCE_ORDER: LTR_SOURCE_ORDER,
    LTR_BLANK_OR_EXCLUDE_NOTE: LTR_BLANK_OR_EXCLUDE_NOTE,
    LTR_CONTACT_LABELS: LTR_CONTACT_LABELS,
    LTR_CONTACT_TARGETS: LTR_CONTACT_TARGETS,
    LTR_FIELD_GROUP_ORDER: LTR_FIELD_GROUP_ORDER,
    LTR_CUSTOM_LABEL_MAX: LTR_CUSTOM_LABEL_MAX,
    LTR_CUSTOM_GUIDANCE_MAX: LTR_CUSTOM_GUIDANCE_MAX,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = helpers;
  if (!global || !global.document) return; // node/test stops here

  var doc = global.document;

  // ══ STATE — ONE object; Back never discards any of it ═════════════════════

  var S = {
    open: false,
    step: 1,
    furthest: 1,
    template: null, templateErr: '', templateLoading: false,
    // step 1 — participant
    q: '', results: null, searching: false, searchErr: '', client: null,
    // step 2 — addressee
    contacts: null, contactsLoading: false, contactsErr: '',
    contactPick: null,        // index of the chosen contact, or 'custom'
    salutationTouched: false, // a suggestion never overwrites a typed salutation
    saveTarget: 'support_coordinator',
    saveBusy: false, saveResult: null, saveContactErr: '',
    // step 3 — letter details
    dateText: '', dateErr: '',
    therapists: null, therapistId: null, therapistErr: '',
    overrides: {},            // tag → typed value, not yet acknowledged by PATCH
    detailsOpen: false,       // the merged-values card is disclosed, not dumped
    // step 4 — narrative blocks
    customLabel: '', customGuidance: '', customEditing: null, customErr: '',
    // step 5 — review and generate
    confirming: false, generating: false, result: null, genErr: '',
    // draft (server truth)
    draft: null, draftErr: '', creating: false,
    save: 'idle', saveErr: '',
    previewOpen: false,
    // hub entry
    drafts: null, draftsLoading: false, draftsErr: '',
    confirmDelete: null,
  };

  var STEPS = [
    { n: 1, label: 'Participant' },
    { n: 2, label: 'Addressee' },
    { n: 3, label: 'Letter details' },
    { n: 4, label: 'Sections' },
    { n: 5, label: 'Review' },
  ];

  var API = '/api/letters';
  var searchTimer = null, patchTimer = null, pendingPatch = null;

  // ══ PLUMBING ═════════════════════════════════════════════════════════════

  function el(id) { return doc.getElementById(id); }

  function icn(name, size) {
    if (typeof global.opIcon !== 'function') return '';
    var known = global.OP_ICONS && global.OP_ICONS[name];
    return global.opIcon(known ? name : 'mail', size || 14);
  }

  function user() { return global.APP_USER || {}; }

  function fmtWhen(v) {
    var p = ltrDateParts(v);
    return p ? ltrFormatAUDate(v) : '';
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
    return STATUS_LABEL[k] ? STATUS_LABEL[k] : ltrHumanise(k);
  }

  function renderEntry() {
    var host = el('letter-hub-entry');
    if (!host) return;

    var rows = '';
    if (S.draftsLoading && !S.drafts) {
      rows = '<p class="ltr-quiet">Loading your letters…</p>';
    } else if (S.draftsErr) {
      rows = '<p class="ltr-quiet">' + ltrEsc(S.draftsErr) +
        ' <button type="button" class="ltr-link" data-ltr="drafts-reload">Retry</button></p>';
    } else if (!S.drafts || !S.drafts.length) {
      rows = '<p class="ltr-quiet">No progress note letters in progress.</p>';
    } else {
      rows = '<ul class="ltr-draftlist">' + S.drafts.slice(0, 6).map(function (d) {
        var st = String(d.status == null ? '' : d.status);
        var who = d.clientPreferredName ? d.clientPreferredName : d.clientName;
        return '<li class="ltr-draftrow">' +
          '<button type="button" class="ltr-draftopen" data-ltr="draft-open" data-id="' + ltrEsc(d.id) + '">' +
          '<span class="ltr-draftname">' + ltrEsc(who) +
          (d.subject ? '<span class="ltr-quiet"> · ' + ltrEsc(d.subject) + '</span>' : '') + '</span>' +
          '<span class="ltr-draftmeta">' +
          '<span class="ltr-status ltr-status-' + ltrEsc(st) + '">' + ltrEsc(statusLabel(st)) + '</span>' +
          (fmtWhen(d.updatedAt) ? '<span class="ltr-quiet">Updated ' + ltrEsc(fmtWhen(d.updatedAt)) + '</span>' : '') +
          '</span></button>' +
          '<button type="button" class="ltr-iconbtn" data-ltr="draft-archive" data-id="' + ltrEsc(d.id) + '"' +
          ' aria-label="Archive the letter for ' + ltrEsc(who) + '" title="Archive this letter">' + icn('trash') + '</button>' +
          '</li>';
      }).join('') + '</ul>';
    }

    host.innerHTML =
      '<section class="ltr-entry" aria-labelledby="ltr-entry-h">' +
      '<div class="ltr-entry-main">' +
      '<span class="ltr-entry-icn" aria-hidden="true">' + icn('mail', 20) + '</span>' +
      '<div>' +
      '<h2 id="ltr-entry-h">Progress note letters</h2>' +
      '<p class="ltr-entry-sub">Write a short progress update on the Opal letterhead — addressed to a support ' +
      'coordinator, nominee or referrer — and download a Word document to finish in.</p>' +
      '</div>' +
      '<button type="button" class="ltr-btn ltr-btn-primary ltr-entry-cta" data-ltr="start">' +
      icn('plus') + ' Create progress note letter</button>' +
      '</div>' +
      '<div class="ltr-entry-drafts">' +
      '<h3>Your letters in progress</h3>' + rows +
      '</div>' +
      (S.confirmDelete ? renderArchiveConfirm() : '') +
      '</section>';
  }

  function renderArchiveConfirm() {
    var d = (S.drafts || []).filter(function (x) { return String(x.id) === String(S.confirmDelete); })[0];
    return '<div class="ltr-inline-confirm" role="alertdialog" aria-labelledby="ltr-arch-h">' +
      '<p id="ltr-arch-h"><strong>Archive this letter?</strong> ' +
      (d ? 'The draft for ' + ltrEsc(d.clientName) + ' will be archived. ' : '') +
      'It is kept, not deleted, but it leaves this list.</p>' +
      '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn ltr-btn-danger" data-ltr="draft-archive-confirm">Archive</button>' +
      '<button type="button" class="ltr-btn" data-ltr="draft-archive-cancel">Keep it</button>' +
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

  // The Resource Hub owns #rh2-root and rebuilds it wholesale, so this card
  // lives in its own sibling mount (beside the FCA card) and is shown only
  // while the hub is on its home view.
  function syncEntryVisibility() {
    var host = el('letter-hub-entry');
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
    else { S.templateErr = r.error ? r.error : 'The letter template could not be loaded.'; }
    render();
  }

  function templateSections() {
    return S.template && Array.isArray(S.template.sections) ? S.template.sections : [];
  }

  function selectedTags() {
    return S.draft && Array.isArray(S.draft.selectedSections) ? S.draft.selectedSections : [];
  }

  function isSelected(tag) { return selectedTags().indexOf(String(tag)) !== -1; }

  function draftRecipient() {
    var r = S.draft && S.draft.recipient && typeof S.draft.recipient === 'object' ? S.draft.recipient : {};
    return {
      name: String(r.name == null ? '' : r.name),
      role: String(r.role == null ? '' : r.role),
      organisation: String(r.organisation == null ? '' : r.organisation),
      address: String(r.address == null ? '' : r.address),
      salutation: String(r.salutation == null ? '' : r.salutation),
    };
  }

  function draftDetails() {
    var d = S.draft && S.draft.letterDetails && typeof S.draft.letterDetails === 'object' ? S.draft.letterDetails : {};
    return {
      letterDate: String(d.letterDate == null ? '' : d.letterDate),
      subject: String(d.subject == null ? '' : d.subject),
      reportingPeriod: String(d.reportingPeriod == null ? '' : d.reportingPeriod),
      documentId: String(d.documentId == null ? '' : d.documentId),
    };
  }

  function ccList() {
    return S.draft && Array.isArray(S.draft.ccRecipients) ? S.draft.ccRecipients.slice() : [];
  }

  function customList() {
    return ltrNormaliseCustom(S.draft ? S.draft.customSections : []);
  }

  async function createDraft() {
    if (!S.client || S.creating) return;
    S.creating = true; S.draftErr = ''; S.therapistErr = '';
    render();
    var body = { clientId: S.client.id };
    if (S.therapistId && S.therapistId !== user().therapistProfileId) body.therapistProfileId = S.therapistId;
    var r = await api(API + '/drafts', { method: 'POST', body: body });
    S.creating = false;
    if (!r.ok || !r.draft) {
      // The server's own message, verbatim — including any refusal.
      S.draftErr = r.error;
      render();
      return;
    }
    adoptDraft(r.draft);
    S.drafts = null; // the hub list is stale now
    ensureLetterDate();
    goStep(2);
  }

  function adoptDraft(draft) {
    S.draft = draft;
    S.dateText = ltrFormatAUDate(draftDetails().letterDate);
    S.dateErr = '';
  }

  // The letter date DEFAULTS to today. That is a real, checkable fact about
  // when the letter is being written — not invented participant data — and it
  // stays editable in Australian order.
  function ensureLetterDate() {
    if (!S.draft) return;
    if (draftDetails().letterDate) { S.dateText = ltrFormatAUDate(draftDetails().letterDate); return; }
    var iso = ltrTodayISO();
    setDetails({ letterDate: iso });
    S.dateText = ltrFormatAUDate(iso);
  }

  async function openDraft(id) {
    S.draftErr = '';
    var r = await api(API + '/drafts/' + encodeURIComponent(id));
    if (!r.ok || !r.draft) { S.draftsErr = r.error; renderEntry(); return; }
    adoptDraft(r.draft);
    S.client = {
      id: r.draft.clientId,
      fullName: r.draft.clientName,
      preferredName: r.draft.clientPreferredName,
    };
    S.therapistId = r.draft.therapistProfileId;
    S.overrides = {};
    S.contacts = null; S.contactPick = null; S.salutationTouched = !!draftRecipient().salutation;
    S.saveResult = null; S.saveContactErr = '';
    S.result = null; S.genErr = ''; S.confirming = false;
    S.open = true;
    S.step = r.draft.status === 'generated' ? 5 : 2;
    S.furthest = 5;
    loadTemplate();
    loadContacts();
    render();
    focusWizard();
  }

  // Debounced PATCH. The therapist's state is never rolled back on failure —
  // the local draft stays exactly as they left it and Retry re-sends.
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
    // Reconcile: the server's manifest and snapshots replace the optimistic ones.
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

  function retryPatch() {
    if (!pendingPatch) return;
    S.save = 'saving'; S.saveErr = '';
    paintSave();
    flushPatch();
  }

  // ══ OPTIMISTIC MANIFEST ══════════════════════════════════════════════════
  // The preview always reads draft.manifest. While a PATCH is in flight we
  // flip `included` ON THE EXISTING manifest entries so the preview reacts
  // instantly — we never build a block list from the template. A brand-new
  // custom block is the one addition, and its title is the therapist's own
  // typed text, not a value invented for them.

  function touchManifest() {
    if (!S.draft || !S.draft.manifest || !Array.isArray(S.draft.manifest.sections)) return;
    var sel = selectedTags();
    S.draft.manifest.sections.forEach(function (s) {
      if (!s || !s.tag) return;
      // Required blocks are always in. Custom blocks are governed by
      // customSections, NOT by selectedSections — reading the selection for
      // them would silently drop the therapist's own content off the letter
      // the moment they ticked an unrelated template block.
      if (s.kind === 'required') { s.included = true; return; }
      if (s.kind === 'custom') return;
      s.included = sel.indexOf(String(s.tag)) !== -1;
    });
  }

  function setSelection(tags) {
    if (!S.draft) return;
    var safe = ltrEnforceRequired(tags, templateSections());
    S.draft.selectedSections = safe;
    touchManifest();
    queuePatch({ selectedSections: safe });
  }

  function toggleBlock(tag) {
    var meta = templateSections().filter(function (s) { return String(s.tag) === String(tag); })[0];
    if (meta && meta.required === true) return; // required blocks never move
    var sel = selectedTags().slice();
    var at = sel.indexOf(String(tag));
    if (at === -1) sel.push(String(tag)); else sel.splice(at, 1);
    setSelection(sel);
    render();
  }

  function resetBlockDefaults() {
    setSelection(ltrDefaultSelection(templateSections()));
    render();
  }

  // ══ RECIPIENT ════════════════════════════════════════════════════════════

  function setRecipient(patch, opts) {
    if (!S.draft) return;
    var next = Object.assign(draftRecipient(), patch);
    // A salutation is SUGGESTED from the recipient and stays editable. Once
    // the therapist has typed one, nothing overwrites it.
    if (!S.salutationTouched && (opts && opts.suggest)) {
      var suggested = ltrSuggestSalutation(next);
      if (suggested) next.salutation = suggested;
    }
    S.draft.recipient = next;
    queuePatch({ recipient: next });
    paintPreview();
  }

  function setCc(list) {
    if (!S.draft) return;
    S.draft.ccRecipients = list;
    queuePatch({ ccRecipients: list });
    paintPreview();
  }

  function setDetails(patch) {
    if (!S.draft) return;
    var next = Object.assign(draftDetails(), patch);
    S.draft.letterDetails = next;
    // documentId is the server's to allocate — it is never sent back up.
    queuePatch({ letterDetails: { letterDate: next.letterDate, subject: next.subject, reportingPeriod: next.reportingPeriod } });
    paintPreview();
  }

  async function loadContacts() {
    var id = S.client ? S.client.id : (S.draft ? S.draft.clientId : null);
    if (!id || S.contactsLoading || S.contacts) return;
    S.contactsLoading = true; S.contactsErr = '';
    render();
    var r = await api(API + '/clients/' + encodeURIComponent(id) + '/contacts');
    S.contactsLoading = false;
    if (r.ok) { S.contacts = Array.isArray(r.contacts) ? r.contacts : []; }
    else { S.contacts = []; S.contactsErr = r.error; }
    render();
  }

  function chooseContact(idx) {
    var c = (S.contacts || [])[Number(idx)];
    if (!c) return;
    S.contactPick = Number(idx);
    S.salutationTouched = false;
    setRecipient({
      name: String(c.name == null ? '' : c.name),
      role: String(c.role == null ? '' : c.role),
      organisation: String(c.organisation == null ? '' : c.organisation),
      address: String(c.address == null ? '' : c.address),
      salutation: String(c.salutation == null ? '' : c.salutation),
    }, { suggest: !c.salutation });
    render();
  }

  async function saveRecipientToProfile() {
    if (!S.draft || S.saveBusy) return;
    if (!draftRecipient().name) { S.saveContactErr = 'Enter the recipient\'s name first.'; render(); return; }
    // Anything still queued is the therapist's own typing — land it first so
    // the server files the recipient they can actually see on screen.
    if (pendingPatch) await flushPatch();
    S.saveBusy = true; S.saveContactErr = ''; S.saveResult = null;
    render();
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id) + '/save-recipient-to-profile', {
      method: 'POST', body: { target: S.saveTarget },
    });
    S.saveBusy = false;
    if (!r.ok) { S.saveContactErr = r.error; render(); return; }
    S.saveResult = { saved: !!r.saved, target: S.saveTarget };
    S.contacts = null;
    loadContacts();
    render();
  }

  // ══ CUSTOM CONTENT ═══════════════════════════════════════════════════════

  function pushCustom(list) {
    if (!S.draft) return;
    var norm = ltrNormaliseCustom(list);
    S.draft.customSections = norm;
    queuePatch({ customSections: norm });
  }

  function saveCustom() {
    var label = String(S.customLabel).replace(/\s+/g, ' ').trim();
    var guidance = String(S.customGuidance).trim();
    if (!label && !guidance) {
      S.customErr = 'Add a short label or some drafting guidance — custom content needs one of them.';
      render();
      return;
    }
    S.customErr = '';
    var list = customList();
    if (S.customEditing) {
      list = list.map(function (c) {
        return String(c.id) === String(S.customEditing)
          ? Object.assign({}, c, { label: label, guidance: guidance })
          : c;
      });
    } else {
      // A local id until the server answers; the PATCH response replaces the
      // whole customSections array (and its server-issued tags) verbatim.
      var localId = 'custom-' + (list.length + 1) + '-' + Date.now();
      list.push({ id: localId, tag: localId, label: label, guidance: guidance, order: list.length });
      if (S.draft && S.draft.manifest && Array.isArray(S.draft.manifest.sections)) {
        S.draft.manifest.sections.push({
          tag: localId, kind: 'custom', title: label, included: true,
          order: S.draft.manifest.sections.length,
        });
      }
    }
    S.customLabel = ''; S.customGuidance = ''; S.customEditing = null;
    pushCustom(list);
    render();
  }

  function editCustom(id) {
    var c = customList().filter(function (x) { return String(x.id) === String(id); })[0];
    if (!c) return;
    S.customEditing = String(c.id);
    S.customLabel = c.label;
    S.customGuidance = c.guidance;
    render();
  }

  function removeCustom(id) {
    var gone = customList().filter(function (x) { return String(x.id) === String(id); })[0];
    var list = customList().filter(function (x) { return String(x.id) !== String(id); });
    if (S.draft && gone && S.draft.manifest && Array.isArray(S.draft.manifest.sections)) {
      S.draft.manifest.sections = S.draft.manifest.sections.filter(function (s) {
        return String(s.tag) !== String(gone.tag);
      });
    }
    if (S.customEditing === String(id)) { S.customEditing = null; S.customLabel = ''; S.customGuidance = ''; }
    pushCustom(list);
    render();
  }

  function moveCustom(id, delta) {
    pushCustom(ltrMoveCustom(customList(), id, delta));
    render();
  }

  // ══ PARTICIPANT SEARCH ═══════════════════════════════════════════════════

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
    // A different participant means a different letter: nothing typed for the
    // previous one may follow them across.
    S.draft = null;
    S.contacts = null; S.contactPick = null; S.salutationTouched = false;
    S.overrides = {}; S.result = null; S.genErr = ''; S.confirming = false;
    S.saveResult = null; S.saveContactErr = '';
    render();
  }

  // ══ GENERATE ═════════════════════════════════════════════════════════════

  function blockingIssues() {
    return ltrBlockingIssues(S.draft, S.template);
  }

  async function generate() {
    if (!S.draft || S.generating) return;
    if (blockingIssues().length) return;
    if (pendingPatch) await flushPatch();
    S.generating = true; S.genErr = ''; S.result = null;
    render();
    var r = await api(API + '/drafts/' + encodeURIComponent(S.draft.id) + '/generate', { method: 'POST' });
    S.generating = false;
    if (!r.ok) { S.genErr = r.error; S.confirming = false; render(); return; }
    var excluded = Array.isArray(r.excludedFields) ? r.excludedFields.map(String) : [];
    S.result = {
      documentId: r.documentId,
      filename: r.filename,
      // Excluded fields are reported separately: one was a gap the letter
      // shows, the other was a deliberate omission.
      missingFields: (Array.isArray(r.missingFields) ? r.missingFields : [])
        .filter(function (t) { return excluded.indexOf(String(t)) === -1; }),
      excludedFields: excluded,
      warnings: Array.isArray(r.warnings) ? r.warnings : [],
    };
    S.confirming = false;
    S.drafts = null;
    render();
  }

  // ══ WIZARD RENDER ════════════════════════════════════════════════════════

  function root() { return el('letter-root'); }

  function canEnter(step) {
    if (step <= 1) return true;
    return !!S.draft;
  }

  function goStep(n) {
    if (!canEnter(n)) return;
    S.step = n;
    if (window.OpalNav) window.OpalNav.pushStep('letter', n);
    if (n > S.furthest) S.furthest = n;
    if (n === 2) loadContacts();
    if (n >= 3) ensureLetterDate();
    if (n >= 4) loadTemplate();
    render();
    var h = el('ltr-step-h');
    if (h) { try { h.focus(); } catch (e) { /* not focusable */ } }
  }

  function renderStepper() {
    return '<nav class="ltr-stepper" aria-label="Letter steps"><ol>' + STEPS.map(function (s) {
      var state = S.step === s.n ? 'current' : (s.n < S.step ? 'done' : 'todo');
      var reachable = canEnter(s.n) && s.n <= S.furthest;
      return '<li class="ltr-step ltr-step-' + state + '">' +
        '<button type="button" class="ltr-stepbtn" data-ltr="step" data-step="' + s.n + '"' +
        (reachable ? '' : ' disabled aria-disabled="true"') +
        (S.step === s.n ? ' aria-current="step"' : '') + '>' +
        '<span class="ltr-stepnum" aria-hidden="true">' + s.n + '</span>' +
        '<span class="ltr-steplabel">' + ltrEsc(s.label) + '</span></button></li>';
    }).join('') + '</ol></nav>';
  }

  function renderSaveIndicator() {
    var txt = '', cls = '';
    if (S.save === 'saving') { txt = 'Saving…'; cls = ' ltr-saving'; }
    else if (S.save === 'saved') { txt = 'All changes saved'; cls = ' ltr-saved'; }
    else if (S.save === 'error') { txt = S.saveErr ? S.saveErr : 'Could not save your changes.'; cls = ' ltr-savefail'; }
    return '<div class="ltr-saveind' + cls + '" id="ltr-saveind" role="status" aria-live="polite">' +
      ltrEsc(txt) +
      (S.save === 'error' ? ' <button type="button" class="ltr-link" data-ltr="retry-save">Retry</button>' : '') +
      '</div>';
  }

  function paintSave() {
    var node = el('ltr-saveind');
    if (!node) return;
    node.outerHTML = renderSaveIndicator();
  }

  function paintPreview() {
    var node = el('ltr-preview');
    if (node) node.innerHTML = renderPreview();
    var inline = doc.querySelector('.ltr-preview-inline');
    if (inline) inline.innerHTML = renderPreview();
  }

  function paintResults() {
    var node = el('ltr-results');
    if (node) node.innerHTML = renderResults();
  }

  function render() {
    var host = root();
    if (!host) return;
    host.hidden = !S.open;
    if (!S.open) { host.innerHTML = ''; return; }

    // Ids are deterministic, so focus survives a rebuild: toggling a block
    // checkbox with the keyboard leaves focus on that same checkbox.
    var active = doc.activeElement;
    var keepId = active && active.id ? active.id : null;
    var showPreview = !!S.draft;

    host.innerHTML =
      '<div class="ltr-shell" role="dialog" aria-modal="true" aria-labelledby="ltr-title">' +
      '<header class="ltr-head">' +
      '<div><h1 id="ltr-title">Progress note letter</h1>' +
      '<p class="ltr-quiet">' + ltrEsc(headSubtitle()) + '</p></div>' +
      '<div class="ltr-head-right">' + renderSaveIndicator() +
      '<button type="button" class="ltr-iconbtn" data-ltr="close" aria-label="Close the letter builder">' + icn('x') + '</button>' +
      '</div></header>' +
      renderStepper() +
      '<div class="ltr-body' + (showPreview ? ' ltr-body-split' : '') + '">' +
      '<main class="ltr-main" id="ltr-step-body">' + renderStep() + '</main>' +
      (showPreview
        ? '<button type="button" class="ltr-preview-toggle" data-ltr="preview-toggle" aria-expanded="' + (S.previewOpen ? 'true' : 'false') + '" aria-controls="ltr-preview">' +
          icn('doc') + ' ' + (S.previewOpen ? 'Hide letter preview' : 'Show letter preview') + '</button>' +
          '<aside class="ltr-preview' + (S.previewOpen ? ' ltr-preview-open' : '') + '" id="ltr-preview" aria-label="Letter preview">' +
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
    var who = S.client ? String(S.client.preferredName || S.client.fullName || '') : '';
    return (who ? who + ' · ' : '') + 'step ' + S.step + ' of ' + STEPS.length;
  }

  function renderFooter() {
    var back = S.step > 1
      ? '<button type="button" class="ltr-btn" data-ltr="back">Back</button>'
      : '<span></span>';
    var next = '';
    if (S.step === 1) {
      next = '<button type="button" class="ltr-btn ltr-btn-primary" data-ltr="start-draft"' +
        (S.client && !S.creating ? '' : ' disabled') + '>' +
        (S.creating ? 'Preparing…' : 'Continue') + '</button>';
    } else if (S.step < STEPS.length) {
      next = '<button type="button" class="ltr-btn ltr-btn-primary" data-ltr="next">Continue</button>';
    }
    return '<footer class="ltr-foot">' + back +
      '<span class="ltr-foot-note">Your progress is saved as you go — closing this window does not lose it.</span>' +
      next + '</footer>';
  }

  function renderStep() {
    if (S.step === 1) return renderStepParticipant();
    if (S.step === 2) return renderStepAddressee();
    if (S.step === 3) return renderStepDetails();
    if (S.step === 4) return renderStepBlocks();
    return renderStepReview();
  }

  // ── Step 1: participant ───────────────────────────────────────────────────

  function renderStepParticipant() {
    var out = '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Who is this letter about?</h2>' +
      '<p class="ltr-quiet">Search the practice records. Participant details come from Splose — only what Splose holds is available here.</p>' +
      '<div class="ltr-searchbar">' + icn('search', 16) +
      '<label class="ltr-sr-only" for="ltr-q">Search participants by name</label>' +
      '<input type="search" id="ltr-q" data-ltr-input="q" autocomplete="off" placeholder="Search by name…" value="' + ltrEsc(S.q) + '">' +
      '</div>' +
      '<div id="ltr-results" role="region" aria-live="polite">' + renderResults() + '</div>';

    if (S.client) {
      out += '<section class="ltr-card" aria-labelledby="ltr-chosen-h">' +
        '<h3 id="ltr-chosen-h">Selected participant</h3>' +
        '<dl class="ltr-summary">' +
        '<div><dt>Full name</dt><dd>' + val(S.client.fullName) + '</dd></div>' +
        '<div><dt>Preferred name</dt><dd>' + val(S.client.preferredName) + '</dd></div>' +
        '<div><dt>NDIS number</dt><dd>' + val(S.client.ndisNumber) + '</dd></div>' +
        '</dl>' +
        '<p class="ltr-quiet">A blank above means no source holds that detail. Nothing is filled in on your behalf — ' +
        'you can add a real value on the letter details step.</p>' +
        renderTherapistChoice() + '</section>';
    }
    if (S.draftErr) out += '<p class="ltr-err" role="alert">' + ltrEsc(S.draftErr) + '</p>';
    return out;
  }

  // The signing therapist is fixed when the draft is created — the PATCH
  // contract has no therapist field — so the choice is offered here, before
  // that happens, and reported as settled afterwards.
  function renderTherapistChoice() {
    var u = user();
    var mine = u.displayName ? u.displayName : u.name;
    if (S.draft) {
      return '<p class="ltr-quiet">Signing therapist: <strong>' +
        ltrEsc(S.draft.therapistName ? S.draft.therapistName : mine) + '</strong> — set when this letter was started.</p>';
    }
    if (!u.canViewMasterCalendar || !Array.isArray(S.therapists) || S.therapists.length < 2) {
      return '<p class="ltr-quiet">Signing therapist: <strong>' + ltrEsc(mine) + '</strong> (you).</p>';
    }
    return '<label class="ltr-lbl" for="ltr-therapist">Signing therapist</label>' +
      '<select class="ltr-input" id="ltr-therapist" data-ltr-change="therapist">' +
      '<option value="">' + ltrEsc(mine) + ' (me)</option>' +
      S.therapists.map(function (t) {
        if (String(t.id) === String(u.therapistProfileId)) return '';
        return '<option value="' + ltrEsc(t.id) + '"' + (String(S.therapistId) === String(t.id) ? ' selected' : '') + '>' +
          ltrEsc(t.displayName) + '</option>';
      }).join('') + '</select>' +
      '<p class="ltr-quiet">The server decides whether preparing on another therapist\'s behalf is allowed.</p>';
  }

  // A value, or an unmistakable statement that there is none. Never a dash,
  // never "Unknown", never a plausible-looking stand-in.
  function val(v) {
    var s = v == null ? '' : String(v).trim();
    return s ? ltrEsc(s) : '<span class="ltr-missing">' + icn('alert') + ' Not held</span>';
  }

  function renderResults() {
    if (S.searching) return '<p class="ltr-quiet">Searching…</p>';
    if (S.searchErr) return '<p class="ltr-err">' + ltrEsc(S.searchErr) + '</p>';
    if (S.results === null) return '<p class="ltr-quiet">Type at least two characters to search.</p>';
    if (!S.results.length) return '<p class="ltr-quiet">No participants matched that search.</p>';
    return '<ul class="ltr-results">' + S.results.map(function (c) {
      var sel = S.client && String(S.client.id) === String(c.id);
      return '<li><button type="button" class="ltr-result' + (sel ? ' ltr-result-on' : '') + '"' +
        ' data-ltr="pick-client" data-id="' + ltrEsc(c.id) + '" aria-pressed="' + (sel ? 'true' : 'false') + '">' +
        '<span class="ltr-result-name">' + ltrEsc(c.fullName) +
        (c.hasProfile ? ' <span class="ltr-profilechip">' + icn('check') + ' Has saved profile</span>' : '') + '</span>' +
        '<span class="ltr-quiet">' +
        (c.ndisNumber ? 'NDIS ' + ltrEsc(c.ndisNumber) : '<em>No NDIS number on file</em>') + '</span></button></li>';
    }).join('') + '</ul>';
  }

  // ── Step 2: addressee ─────────────────────────────────────────────────────

  function renderStepAddressee() {
    var r = draftRecipient();
    var out = '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Who is the letter addressed to?</h2>' +
      '<p class="ltr-quiet">Choose a contact Opal already holds for this participant, or enter a recipient just for this letter.</p>';

    out += '<section class="ltr-card" aria-labelledby="ltr-contacts-h">' +
      '<h3 id="ltr-contacts-h">' + icn('user') + ' Contacts on this participant\'s report profile</h3>';

    if (S.contactsLoading) {
      out += '<p class="ltr-quiet">Loading contacts…</p>';
    } else if (S.contactsErr) {
      out += '<p class="ltr-err">' + ltrEsc(S.contactsErr) +
        ' <button type="button" class="ltr-link" data-ltr="contacts-reload">Retry</button></p>';
    } else if (!S.contacts || !S.contacts.length) {
      out += '<p class="ltr-quiet">No contacts are held for this participant yet. Enter the recipient below — ' +
        'you can then choose to save them to the profile for next time.</p>';
    } else {
      out += '<ul class="ltr-contacts">' + S.contacts.map(function (c, i) {
        var on = S.contactPick === i;
        return '<li><button type="button" class="ltr-contact' + (on ? ' ltr-contact-on' : '') + '"' +
          ' data-ltr="pick-contact" data-idx="' + i + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
          '<span class="ltr-contact-top">' +
          '<span class="ltr-contact-name">' + ltrEsc(c.name) + '</span>' +
          '<span class="ltr-srcchip">' + ltrEsc(ltrContactSourceLabel(c.source)) + '</span></span>' +
          '<span class="ltr-quiet">' +
          [c.role, c.organisation].filter(function (x) { return x; }).map(ltrEsc).join(' · ') +
          '</span></button></li>';
      }).join('') + '</ul>';
    }

    out += '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn' + (S.contactPick === 'custom' ? ' ltr-btn-on' : '') + '"' +
      ' data-ltr="custom-recipient" aria-pressed="' + (S.contactPick === 'custom' ? 'true' : 'false') + '">' +
      icn('edit') + ' Enter a custom recipient</button></div></section>';

    out += '<section class="ltr-card" aria-labelledby="ltr-recip-h">' +
      '<h3 id="ltr-recip-h">Recipient on this letter</h3>' +
      field('ltr-r-name', 'Recipient name', 'recip-name', r.name, 'e.g. Jane Doe') +
      field('ltr-r-role', 'Role or position', 'recip-role', r.role, 'e.g. Support Coordinator') +
      field('ltr-r-org', 'Organisation', 'recip-org', r.organisation, 'e.g. Horizon Support Services') +
      '<label class="ltr-lbl" for="ltr-r-addr">Postal address</label>' +
      '<textarea class="ltr-input" id="ltr-r-addr" rows="3" data-ltr-input="recip-address"' +
      ' aria-describedby="ltr-addr-help" placeholder="One line per line of the address">' + ltrEsc(r.address) + '</textarea>' +
      '<p class="ltr-quiet" id="ltr-addr-help">Each line you type becomes its own line in the letter\'s address block.</p>' +
      field('ltr-r-sal', 'Salutation', 'recip-salutation', r.salutation, 'e.g. Dear Jane') +
      '<p class="ltr-quiet">The salutation is suggested from the recipient\'s name and stays yours to change.</p>' +
      '</section>';

    out += renderCcEditor();
    out += renderSaveRecipient();
    return out;
  }

  function field(id, label, kind, value, placeholder) {
    return '<label class="ltr-lbl" for="' + ltrEsc(id) + '">' + ltrEsc(label) + '</label>' +
      '<input type="text" class="ltr-input" id="' + ltrEsc(id) + '" data-ltr-input="' + ltrEsc(kind) + '"' +
      ' value="' + ltrEsc(value) + '" placeholder="' + ltrEsc(placeholder) + '">';
  }

  function renderCcEditor() {
    var list = ccList();
    var summary = ltrCcSummary(list);
    return '<section class="ltr-card" aria-labelledby="ltr-cc-h">' +
      '<h3 id="ltr-cc-h">CC recipients <span class="ltr-quiet">(optional)</span></h3>' +
      (list.length
        ? '<ul class="ltr-cclist">' + list.map(function (c, i) {
            return '<li>' +
              '<label class="ltr-sr-only" for="ltr-cc-n-' + i + '">CC name, row ' + (i + 1) + '</label>' +
              '<input type="text" class="ltr-input" id="ltr-cc-n-' + i + '" data-ltr-input="cc-name" data-idx="' + i + '"' +
              ' value="' + ltrEsc(c && c.name) + '" placeholder="Name">' +
              '<label class="ltr-sr-only" for="ltr-cc-o-' + i + '">CC organisation, row ' + (i + 1) + '</label>' +
              '<input type="text" class="ltr-input" id="ltr-cc-o-' + i + '" data-ltr-input="cc-org" data-idx="' + i + '"' +
              ' value="' + ltrEsc(c && c.organisation) + '" placeholder="Organisation">' +
              '<button type="button" class="ltr-iconbtn" data-ltr="cc-remove" data-idx="' + i + '"' +
              ' aria-label="Remove CC row ' + (i + 1) + '">' + icn('trash') + '</button></li>';
          }).join('') + '</ul>'
        : '') +
      '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn" data-ltr="cc-add">' + icn('plus') + ' Add a CC recipient</button></div>' +
      '<p class="ltr-quiet" role="status" aria-live="polite">' + ltrEsc(summary.text) + '</p>' +
      '</section>';
  }

  // Explicit, narrow, and never automatic: the ONLY way anything reaches the
  // participant's durable report profile is this button.
  function renderSaveRecipient() {
    var r = draftRecipient();
    var out = '<section class="ltr-card ltr-profile" aria-labelledby="ltr-save-h">' +
      '<h3 id="ltr-save-h">' + icn('folder') + ' Reuse this recipient on the participant\'s next letter</h3>' +
      '<p class="ltr-quiet">Everything you have typed on this step belongs to this letter alone. ' +
      '<strong>Letter-specific edits are not saved to the participant\'s report profile</strong> unless you ask for it here.</p>';

    if (!r.name) {
      return out + '<p class="ltr-quiet">Enter a recipient name above and this becomes available.</p></section>';
    }

    out += '<label class="ltr-lbl" for="ltr-save-target">Save this recipient as</label>' +
      '<select class="ltr-input" id="ltr-save-target" data-ltr-change="save-target">' +
      LTR_CONTACT_TARGETS.map(function (t) {
        return '<option value="' + ltrEsc(t) + '"' + (S.saveTarget === t ? ' selected' : '') + '>' +
          ltrEsc(ltrContactSourceLabel(t)) + '</option>';
      }).join('') + '</select>' +
      (S.saveContactErr ? '<p class="ltr-err" role="alert">' + ltrEsc(S.saveContactErr) + '</p>' : '') +
      '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn ltr-btn-primary" data-ltr="save-recipient"' + (S.saveBusy ? ' disabled' : '') + '>' +
      (S.saveBusy ? 'Saving…' : 'Save this recipient to the participant\'s report profile') + '</button></div>';

    if (S.saveResult) {
      out += S.saveResult.saved
        ? '<div class="ltr-note ltr-note-ok">' + icn('check') + '<div><p><strong>Saved.</strong> ' +
          ltrEsc(r.name) + ' is now held as this participant\'s ' +
          ltrEsc(ltrContactSourceLabel(S.saveResult.target).toLowerCase()) + '.</p></div></div>'
        : '<div class="ltr-note ltr-note-warn">' + icn('alert') +
          '<div><p>The server did not save this recipient and gave no reason.</p></div></div>';
    }
    return out + '</section>';
  }

  // ── Step 3: letter details ────────────────────────────────────────────────

  function renderStepDetails() {
    var d = draftDetails();
    var u = user();
    var mine = u.displayName ? u.displayName : u.name;
    var out = '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Letter details</h2>' +
      '<section class="ltr-card" aria-labelledby="ltr-det-h"><h3 id="ltr-det-h">The letter itself</h3>' +
      '<label class="ltr-lbl" for="ltr-date">Letter date <span class="ltr-quiet">(dd/mm/yyyy)</span></label>' +
      '<input type="text" class="ltr-input ltr-input-date" id="ltr-date" data-ltr-input="letter-date"' +
      ' inputmode="numeric" autocomplete="off" placeholder="dd/mm/yyyy" aria-describedby="ltr-date-help"' +
      ' value="' + ltrEsc(S.dateText) + '">' +
      '<p class="ltr-quiet" id="ltr-date-help">Australian order — day, then month, then year. Defaults to today; change it if you are back-dating.</p>' +
      (S.dateErr ? '<p class="ltr-err" role="alert">' + ltrEsc(S.dateErr) + '</p>' : '') +
      '<label class="ltr-lbl" for="ltr-subject">Subject <span class="ltr-req">required</span></label>' +
      '<input type="text" class="ltr-input" id="ltr-subject" data-ltr-input="subject" required' +
      ' aria-required="true" placeholder="e.g. Occupational therapy progress update"' +
      ' value="' + ltrEsc(d.subject) + '">' +
      (d.subject ? '' : '<p class="ltr-quiet">The subject line is required — the letter cannot be produced without it.</p>') +
      '<label class="ltr-lbl" for="ltr-period">Reporting period</label>' +
      '<input type="text" class="ltr-input" id="ltr-period" data-ltr-input="reporting-period"' +
      ' placeholder="e.g. 1 April 2026 to 30 June 2026" value="' + ltrEsc(d.reportingPeriod) + '">' +
      '<label class="ltr-lbl" for="ltr-docid">Document ID</label>' +
      '<input type="text" class="ltr-input" id="ltr-docid" readonly aria-readonly="true"' +
      ' aria-describedby="ltr-docid-help" value="' + ltrEsc(d.documentId) + '">' +
      // Shown here, changed below. One value with two editors on one screen is
      // a way to lose an edit, so this slot displays the issued reference and
      // the merged-values list is the single place it can be overridden.
      '<p class="ltr-quiet" id="ltr-docid-help">Issued by Opal when this draft was created, and printed in the letter footer. ' +
      'To use your own reference, change it under &ldquo;Details Opal will merge into this letter&rdquo; below.</p>' +
      '</section>';

    out += '<section class="ltr-card" aria-labelledby="ltr-ther-h"><h3 id="ltr-ther-h">Signing therapist</h3>' +
      '<p class="ltr-strong">' + ltrEsc(S.draft && S.draft.therapistName ? S.draft.therapistName : mine) + '</p>' +
      '<p class="ltr-quiet">Signed in as you' + (u.roleTitle ? ' · ' + ltrEsc(u.roleTitle) : '') + '. ' +
      'The signature block and role come from the therapist profile, and are shown with their source below. ' +
      'The signing therapist is chosen when the letter is started — go back to step 1 to start a letter for someone else.</p>';
    if (S.therapistErr) out += '<p class="ltr-err" role="alert">' + ltrEsc(S.therapistErr) + '</p>';
    out += '</section>';

    out += renderMergedValues();
    return out;
  }

  // The permitted overrides, disclosed rather than dumped: the letter is short
  // and most of these are already correct.
  function renderMergedValues() {
    var groups = ltrScalarModel(S.draft ? S.draft.manifest : null);
    var total = groups.reduce(function (n, g) { return n + g.fields.length; }, 0);
    var missing = groups.reduce(function (n, g) {
      return n + g.fields.filter(function (f) { return f.missing; }).length;
    }, 0);
    var excluded = groups.reduce(function (n, g) {
      return n + g.fields.filter(function (f) { return f.excluded; }).length;
    }, 0);

    var out = '<section class="ltr-card" aria-labelledby="ltr-merge-h">' +
      '<h3 id="ltr-merge-h">Details Opal will merge into this letter</h3>';
    if (!total) {
      return out + '<p class="ltr-quiet">The letter has not been composed on the server yet.</p></section>';
    }
    out += '<p class="ltr-quiet">' + missing + ' of ' + total + ' merged values have no source yet' +
      (excluded ? ', and ' + excluded + ' ' + (excluded === 1 ? 'is' : 'are') + ' excluded' : '') +
      '. Each one shows where its value came from; nothing here is guessed.</p>';

    if (!S.detailsOpen) {
      return out + '<div class="ltr-row-actions">' +
        '<button type="button" class="ltr-btn" data-ltr="details-open" aria-expanded="false" aria-controls="ltr-merge-list">' +
        'Review and correct these ' + total + ' values</button></div></section>';
    }

    // The calm line, at the top of the area where a therapist meets a gap.
    out += '<p class="ltr-inline-note" id="ltr-blank-note">' + ltrEsc(LTR_BLANK_OR_EXCLUDE_NOTE) + '</p>';

    out += renderSourceLegend() + '<div id="ltr-merge-list">' + groups.map(function (g) {
      return '<h4 class="ltr-subh" id="ltr-mg-' + ltrEsc(g.key) + '">' + ltrEsc(g.label) + '</h4>' +
        '<dl class="ltr-fields" aria-labelledby="ltr-mg-' + ltrEsc(g.key) + '">' +
        g.fields.map(renderDataField).join('') + '</dl>';
    }).join('') +
      '<p class="ltr-quiet" id="ltr-ov-help">Anything you type here is stored with this letter exactly as you enter it, ' +
      'and applies to this letter only. Do not enter a value you are not certain of.</p>' +
      '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn" data-ltr="details-close">Done</button></div></div>';
    return out + '</section>';
  }

  function renderSourceLegend() {
    return '<div class="ltr-legend"><span class="ltr-legend-lbl">Where values come from:</span>' +
      LTR_SOURCE_ORDER.map(function (k) {
        return '<span class="ltr-badge ltr-badge-' + ltrEsc(k) + '">' + ltrEsc(LTR_SOURCE_LABELS[k]) + '</span>';
      }).join('') + '</div>';
  }

  function renderDataField(f) {
    var id = 'ltr-ov-' + f.tag;
    var exId = 'ltr-ex-' + f.tag;
    // An excluded row shows nothing typed: the server cleared the override the
    // moment it was excluded, so showing a stale local value would be a lie.
    var typed = f.excluded ? undefined : S.overrides[f.tag];
    var shown = typed === undefined ? (f.value === null ? '' : f.value) : typed;

    return '<div class="ltr-field' +
      (f.excluded ? ' ltr-field-excluded' : (f.missing ? ' ltr-field-missing' : '')) + '">' +
      '<dt><label for="' + ltrEsc(id) + '">' + ltrEsc(f.label) + '</label></dt>' +
      '<dd><span class="ltr-fieldtop">' +
      (f.excluded
        ? '<span class="ltr-excluded-note">Excluded — nothing will be inserted</span>'
        : (f.missing
          ? '<span class="ltr-missing">' + icn('alert') + ' No value</span>'
          : '<span class="ltr-value">' + ltrEsc(f.value) + '</span>')) +
      (f.excluded
        ? ''
        : '<span class="ltr-badge ltr-badge-' + ltrEsc(f.source) + '">' + ltrEsc(f.sourceLabel) + '</span>') +
      '</span>' +
      '<input type="text" class="ltr-input ltr-input-sm" id="' + ltrEsc(id) + '"' +
      ' data-ltr-input="override" data-tag="' + ltrEsc(f.tag) + '" value="' + ltrEsc(shown) + '"' +
      (f.editable ? '' : ' disabled') +
      ' placeholder="' + (f.excluded
        ? 'Excluded from this letter'
        : (f.missing ? 'Type the real value, or leave blank' : 'Correct this value for this letter')) + '"' +
      ' aria-describedby="ltr-ov-help">' +
      '<span class="ltr-exclude">' +
      '<input type="checkbox" id="' + ltrEsc(exId) + '"' +
      ' data-ltr-check="exclude" data-tag="' + ltrEsc(f.tag) + '"' +
      (f.excluded ? ' checked' : '') +
      ' aria-describedby="ltr-blank-note">' +
      '<label for="' + ltrEsc(exId) + '">Exclude<span class="ltr-sr-only">' +
      ' ' + ltrEsc(f.label) + ' from this letter</span></label>' +
      '</span>' +
      '</dd></div>';
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

  function currentExcluded() {
    if (!S.draft) return [];
    if (S.draft.manifest && Array.isArray(S.draft.manifest.excludedTags)) {
      return S.draft.manifest.excludedTags;
    }
    return Array.isArray(S.draft.excludedFields) ? S.draft.excludedFields : [];
  }

  // Exclude / un-exclude one field. The whole list is sent, because exclusion
  // is a set the therapist owns outright and a merge could not express
  // un-excluding. The SERVER decides what this means for the letter; the
  // manifest it sends back is what the next render draws.
  function setExcluded(tag, on) {
    if (!S.draft || !tag) return;
    var next = ltrToggleExcluded(currentExcluded(), tag, on);
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

  // ── Step 4: narrative blocks ──────────────────────────────────────────────

  function renderStepBlocks() {
    if (S.templateErr) {
      return '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Sections of the letter</h2>' +
        '<p class="ltr-err">' + ltrEsc(S.templateErr) + '</p>';
    }
    if (!S.template) {
      loadTemplate();
      return '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Sections of the letter</h2>' +
        '<p class="ltr-quiet">Loading the template…</p>';
    }

    var out = '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Sections of the letter</h2>' +
      '<p class="ltr-quiet">A progress note letter is short. Two sections are always included; the other three are on by ' +
      'default and can be left out. Anything you leave out is removed cleanly from the document.</p>';

    out += ltrGroupBlocks(templateSections()).map(function (g) {
      return '<section class="ltr-card" aria-labelledby="ltr-bg-' + ltrEsc(g.key) + '">' +
        '<h3 id="ltr-bg-' + ltrEsc(g.key) + '">' + ltrEsc(g.label) +
        (g.locked ? ' <span class="ltr-lockchip">' + icn('lock') + ' Always included</span>' : '') + '</h3>' +
        (g.locked ? '<p class="ltr-quiet">These sections are the letter itself and cannot be removed.</p>' : '') +
        '<ul class="ltr-blocklist">' + g.sections.map(function (s) { return renderBlockItem(s, g.locked); }).join('') +
        '</ul></section>';
    }).join('');

    out += '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn" data-ltr="reset-blocks">Reset to the template defaults</button></div>';

    out += renderCustomContent();
    return out;
  }

  function renderBlockItem(s, locked) {
    var tag = String(s.tag);
    var id = 'ltr-blk-' + tag;
    var on = locked || isSelected(tag);
    var desc = s.description == null ? '' : String(s.description);
    return '<li class="ltr-blockitem' + (locked ? ' ltr-blockitem-locked' : '') + '">' +
      '<input type="checkbox" id="' + ltrEsc(id) + '"' + (on ? ' checked' : '') +
      (locked ? ' disabled aria-disabled="true"' : '') +
      ' data-ltr-check="block" data-tag="' + ltrEsc(tag) + '">' +
      '<label for="' + ltrEsc(id) + '">' +
      '<span class="ltr-blockname">' + ltrEsc(s.label == null ? s.title : s.label) +
      (locked
        ? ' <span class="ltr-lockicn" title="Required by the Opal letter template — this section cannot be removed"' +
          ' aria-label="Required section, cannot be removed">' + icn('lock') + '</span>'
        : '') +
      '</span>' +
      (desc ? '<span class="ltr-blockdesc">' + ltrEsc(desc) + '</span>' : '') +
      '</label></li>';
  }

  function renderCustomContent() {
    var list = customList();
    return '<section class="ltr-card" aria-labelledby="ltr-cc2-h">' +
      '<h3 id="ltr-cc2-h">Add custom content <span class="ltr-quiet">(optional)</span></h3>' +
      '<p class="ltr-quiet">A short label and a prompt to yourself, inserted at the letter\'s custom-content anchor. ' +
      'Keep it letter-sized — this is a page, not a report.</p>' +
      (list.length
        ? '<ul class="ltr-customlist">' + list.map(function (c, i) {
            var name = c.label ? c.label : 'Custom content ' + (i + 1);
            return '<li>' +
              '<span class="ltr-customtext"><span class="ltr-blockname">' + ltrEsc(name) + '</span>' +
              (c.guidance ? '<span class="ltr-blockdesc">' + ltrEsc(c.guidance) + '</span>' : '') + '</span>' +
              '<span class="ltr-row-actions">' +
              '<button type="button" class="ltr-iconbtn" data-ltr="custom-up" data-id="' + ltrEsc(c.id) + '"' +
              (i === 0 ? ' disabled' : '') + ' aria-label="Move ' + ltrEsc(name) + ' earlier">↑</button>' +
              '<button type="button" class="ltr-iconbtn" data-ltr="custom-down" data-id="' + ltrEsc(c.id) + '"' +
              (i === list.length - 1 ? ' disabled' : '') + ' aria-label="Move ' + ltrEsc(name) + ' later">↓</button>' +
              '<button type="button" class="ltr-iconbtn" data-ltr="custom-edit" data-id="' + ltrEsc(c.id) + '"' +
              ' aria-label="Edit ' + ltrEsc(name) + '">' + icn('edit') + '</button>' +
              '<button type="button" class="ltr-iconbtn" data-ltr="custom-remove" data-id="' + ltrEsc(c.id) + '"' +
              ' aria-label="Remove ' + ltrEsc(name) + '">' + icn('trash') + '</button>' +
              '</span></li>';
          }).join('') + '</ul>'
        : '') +
      '<label class="ltr-lbl" for="ltr-custom-label">Short label <span class="ltr-quiet">(optional)</span></label>' +
      '<input type="text" class="ltr-input" id="ltr-custom-label" data-ltr-input="custom-label"' +
      ' maxlength="' + LTR_CUSTOM_LABEL_MAX + '" value="' + ltrEsc(S.customLabel) + '" placeholder="e.g. Equipment trial">' +
      '<label class="ltr-lbl" for="ltr-custom-guide">Drafting guidance</label>' +
      '<textarea class="ltr-input" id="ltr-custom-guide" rows="2" data-ltr-input="custom-guidance"' +
      ' maxlength="' + LTR_CUSTOM_GUIDANCE_MAX + '" placeholder="A prompt to yourself for what belongs here">' +
      ltrEsc(S.customGuidance) + '</textarea>' +
      (S.customErr ? '<p class="ltr-err" role="alert">' + ltrEsc(S.customErr) + '</p>' : '') +
      '<div class="ltr-row-actions">' +
      '<button type="button" class="ltr-btn" data-ltr="custom-save">' +
      (S.customEditing ? 'Update custom content' : 'Add custom content') + '</button>' +
      (S.customEditing ? '<button type="button" class="ltr-btn" data-ltr="custom-cancel">Cancel</button>' : '') +
      '</div></section>';
  }

  // ── Step 5: review, preview and generate ──────────────────────────────────

  function renderStepReview() {
    var counts = ltrBlockCounts(S.draft ? S.draft.manifest : null);
    var issues = blockingIssues();
    // Excluded fields are deliberately absent from this summary: they are
    // answered questions, not outstanding ones.
    var summary = ltrMissingSummary(S.draft ? S.draft.missingFields : [],
      S.draft && S.draft.manifest ? S.draft.manifest.scalarData : {},
      currentExcluded());
    var model = ltrPreviewModel(S.draft);

    var out = '<h2 class="ltr-h2" id="ltr-step-h" tabindex="-1">Review and generate</h2>';

    if (S.result) {
      out += '<div class="ltr-note ltr-note-ok">' + icn('check') +
        '<div><p><strong>Your letter is ready.</strong></p>' +
        '<p class="ltr-quiet">' + ltrEsc(S.result.filename) + '</p>' +
        '<a class="ltr-btn ltr-btn-primary" href="' + API + '/documents/' + encodeURIComponent(S.result.documentId) + '/download"' +
        ' download data-ltr-download>' + icn('doc') + ' Download the Word document</a></div></div>';
      if (S.result.missingFields.length) {
        out += '<div class="ltr-note ltr-note-warn">' + icn('alert') +
          '<div><p><strong>' + S.result.missingFields.length + ' value(s) were left blank</strong> and appear as placeholders:</p>' +
          '<p class="ltr-quiet">' + S.result.missingFields.map(function (t) { return ltrEsc(ltrTagLabel(t)); }).join(', ') +
          '</p></div></div>';
      }
      if ((S.result.excludedFields || []).length) {
        out += '<p class="ltr-inline-note">' + S.result.excludedFields.length +
          ' value(s) were excluded, and nothing was inserted for them: ' +
          S.result.excludedFields.map(function (t) { return ltrEsc(ltrTagLabel(t)); }).join(', ') + '.</p>';
      }
      if (S.result.warnings.length) {
        out += '<div class="ltr-note ltr-note-warn">' + icn('info') + '<div><p><strong>From the generator:</strong></p><ul>' +
          S.result.warnings.map(function (w) { return '<li>' + ltrEsc(w) + '</li>'; }).join('') + '</ul></div></div>';
      }
      out += '<div class="ltr-row-actions">' +
        '<button type="button" class="ltr-btn" data-ltr="step" data-step="4">Change the sections and generate again</button>' +
        '<button type="button" class="ltr-btn" data-ltr="close">Done</button></div>';
      return out;
    }

    // Every value, with the badge that says where it came from.
    out += renderSourceLegend();
    out += '<section class="ltr-card" aria-labelledby="ltr-rev-h"><h3 id="ltr-rev-h">Every value in this letter</h3>' +
      (model.scalarGroups.length
        ? model.scalarGroups.map(function (g) {
            return '<h4 class="ltr-subh">' + ltrEsc(g.label) + '</h4><dl class="ltr-fields">' +
              g.fields.map(function (f) {
                return '<div class="ltr-field' + (f.missing ? ' ltr-field-missing' : '') + '">' +
                  '<dt>' + ltrEsc(f.label) + '</dt><dd><span class="ltr-fieldtop">' +
                  (f.missing
                    ? '<span class="ltr-missing">' + icn('alert') + ' No value</span>'
                    : '<span class="ltr-value">' + ltrEsc(f.value) + '</span>') +
                  '<span class="ltr-badge ltr-badge-' + ltrEsc(f.source) + '">' + ltrEsc(f.sourceLabel) + '</span>' +
                  '</span></dd></div>';
              }).join('') + '</dl>';
          }).join('')
        : '<p class="ltr-quiet">The letter has not been composed on the server yet.</p>') +
      '</section>';

    out += '<section class="ltr-card" aria-labelledby="ltr-conf-h"><h3 id="ltr-conf-h">Check before you generate</h3>' +
      '<dl class="ltr-summary">' +
      '<div><dt>Participant</dt><dd>' + val(model.clientName) + '</dd></div>' +
      '<div><dt>Addressed to</dt><dd>' + val([model.recipient.name, model.recipient.organisation].filter(function (x) { return x; }).join(', ')) + '</dd></div>' +
      '<div><dt>Subject</dt><dd>' + val(model.subject) + '</dd></div>' +
      '<div><dt>Letter date</dt><dd>' + val(ltrFormatAUDate(model.letterDate)) + '</dd></div>' +
      '<div><dt>CC</dt><dd>' + ltrEsc(model.cc.text) + '</dd></div>' +
      '<div><dt>Sections included</dt><dd>' + counts.included + ' of ' + counts.total +
      ' <span class="ltr-quiet">(' + counts.required + ' required, ' + counts.optional + ' optional, ' +
      counts.custom + ' custom)</span></dd></div>' +
      '<div><dt>Expected filename</dt><dd>' + ltrEsc(ltrFilenamePreview(S.draft)) +
      ' <span class="ltr-quiet">— the final name comes from the server</span></dd></div>' +
      '</dl></section>';

    if (issues.length) {
      out += '<div class="ltr-note ltr-note-block" role="alert">' + icn('alert') +
        '<div><p><strong>This letter cannot be generated yet.</strong> ' +
        issues.length + ' required value(s) are missing:</p><ul class="ltr-issues">' +
        issues.map(function (i) {
          return '<li>' + ltrEsc(i.label) + ' — ' + ltrEsc(i.message) +
            ' <button type="button" class="ltr-link" data-ltr="step" data-step="' + i.step + '">Fix this</button></li>';
        }).join('') + '</ul></div></div>';
    } else if (summary.count) {
      out += '<div class="ltr-note ltr-note-warn">' + icn('info') +
        '<div><p><strong>' + summary.count + ' optional value(s) have no source.</strong> They appear in the document ' +
        'as placeholders styled for completion — nothing is filled in on your behalf.</p>' +
        summary.groups.map(function (g) {
          return '<p class="ltr-quiet"><strong>' + ltrEsc(g.label) + ':</strong> ' +
            g.fields.map(function (f) { return ltrEsc(f.label); }).join(', ') + '</p>';
        }).join('') + '</div></div>';
    }

    if (S.genErr) out += '<p class="ltr-err" role="alert">' + ltrEsc(S.genErr) + '</p>';

    out += '<div class="ltr-preview-inline">' + renderPreview() + '</div>';

    if (S.confirming && !issues.length) {
      out += '<div class="ltr-note ltr-note-ok" role="alertdialog" aria-labelledby="ltr-gen-h">' + icn('doc') +
        '<div><p id="ltr-gen-h"><strong>Generate this letter now?</strong> ' +
        'A Word document will be produced from the Opal template and offered for download.</p>' +
        '<div class="ltr-row-actions">' +
        '<button type="button" class="ltr-btn ltr-btn-primary" data-ltr="generate"' + (S.generating ? ' disabled' : '') + '>' +
        (S.generating ? 'Generating…' : 'Yes, generate the letter') + '</button>' +
        '<button type="button" class="ltr-btn" data-ltr="generate-cancel">Not yet</button>' +
        '</div></div></div>';
    } else {
      out += '<div class="ltr-row-actions">' +
        '<button type="button" class="ltr-btn ltr-btn-primary" data-ltr="generate-confirm"' +
        (issues.length || S.generating ? ' disabled aria-disabled="true"' : '') + '>' +
        'Generate the Word document</button>' +
        (issues.length ? '<span class="ltr-quiet">Fill in the required values above first.</span>' : '') +
        '</div>';
    }
    if (S.generating) {
      out += '<p class="ltr-quiet" role="status" aria-live="polite">Building the letter from the Opal template…</p>';
    }
    return out;
  }

  // ══ LIVE PREVIEW ═════════════════════════════════════════════════════════
  // Structure and merged values come from draft.manifest; the addressing comes
  // from the draft's own server-echoed snapshots. Nothing here is assembled
  // from a local list of what a letter "should" contain.

  function renderPreview() {
    var m = ltrPreviewModel(S.draft);
    if (!m.ready) {
      return '<div class="ltr-doc"><p class="ltr-quiet">The preview appears once the letter has been composed on the server.</p></div>';
    }

    var out = '<p class="ltr-preview-status" role="status" aria-live="polite">' +
      'Preview: ' + m.included.length + ' of ' + m.blocks.length + ' sections included' +
      (m.cc.willAppear ? ', CC line will appear' : ', no CC line') + '.</p>' +
      '<div class="ltr-doc">';

    // Letterhead — every organisation value the manifest carries, in its order.
    out += '<div class="ltr-doc-head"><div class="ltr-doc-brand">' + icn('mail', 16) + ' Opal Therapy Services</div>' +
      (m.letterhead.length
        ? '<ul class="ltr-doc-letterhead">' + m.letterhead.map(function (f) {
            return '<li>' + (f.missing
              ? '<span class="ltr-missing">' + ltrEsc(f.label) + ' missing</span>'
              : ltrEsc(f.value)) + '</li>';
          }).join('') + '</ul>'
        : '') +
      '</div>';

    out += '<p class="ltr-doc-date">' + (m.letterDateLong
      ? ltrEsc(m.letterDateLong)
      : '<span class="ltr-missing">No letter date</span>') + '</p>';

    // Recipient block — multiline address kept as separate lines, exactly as
    // the template writes it with w:br between them.
    out += '<div class="ltr-doc-to">' +
      (m.recipient.name ? '<div>' + ltrEsc(m.recipient.name) + '</div>' : '<div class="ltr-missing">No recipient yet</div>') +
      (m.recipient.role ? '<div>' + ltrEsc(m.recipient.role) + '</div>' : '') +
      (m.recipient.organisation ? '<div>' + ltrEsc(m.recipient.organisation) + '</div>' : '') +
      m.recipient.address.split(/\r?\n/).filter(function (l) { return l.trim(); })
        .map(function (l) { return '<div>' + ltrEsc(l.trim()) + '</div>'; }).join('') +
      '</div>';

    out += '<p class="ltr-doc-subject">' + (m.subject
      ? ltrEsc(m.subject)
      : '<span class="ltr-missing">No subject yet</span>') + '</p>';

    // Participant reference line — the manifest's own participant values.
    out += '<p class="ltr-doc-ref"><span class="ltr-doc-reflbl">Participant:</span> ' +
      (m.participantFields.length
        ? m.participantFields.map(function (f) {
            return f.missing
              ? '<span class="ltr-missing">' + ltrEsc(f.label) + ' missing</span>'
              : '<span class="ltr-doc-refbit">' + ltrEsc(f.label) + ' ' + ltrEsc(f.value) + '</span>';
          }).join(' · ')
        : (m.clientName ? ltrEsc(m.clientName) : '<span class="ltr-missing">No participant details</span>')) +
      '</p>';

    if (m.reportingPeriod) {
      out += '<p class="ltr-doc-ref"><span class="ltr-doc-reflbl">Reporting period:</span> ' + ltrEsc(m.reportingPeriod) + '</p>';
    }

    out += '<p class="ltr-doc-sal">' + (m.recipient.salutation
      ? ltrEsc(m.recipient.salutation)
      : '<span class="ltr-missing">No salutation yet</span>') + '</p>';

    out += '<ol class="ltr-doc-blocks">' + (m.included.length
      ? m.included.map(function (s) {
          return '<li><span class="ltr-doc-block">' + ltrEsc(s.title) + '</span>' +
            (s.kind === 'required' ? '<span class="ltr-tag-req">' + icn('lock', 11) + ' Always</span>' : '') +
            (s.kind === 'custom' ? '<span class="ltr-tag-custom">Custom</span>' : '') + '</li>';
        }).join('')
      : '<li class="ltr-quiet">No sections are included yet.</li>') + '</ol>';

    if (m.excluded.length) {
      out += '<p class="ltr-quiet ltr-doc-out">Left out: ' +
        m.excluded.map(function (s) { return ltrEsc(s.title); }).join(', ') + '</p>';
    }

    if (m.excludedFields.length) {
      out += '<p class="ltr-quiet ltr-doc-out">Excluded — nothing will be inserted: ' +
        m.excludedFields.map(function (f) { return ltrEsc(f.label); }).join(', ') + '</p>';
    }

    // Signature block — the therapist values the manifest carries.
    out += '<div class="ltr-doc-sign"><p class="ltr-doc-signoff">Yours sincerely</p>' +
      (m.signatureFields.length
        ? '<ul class="ltr-doc-signlist">' + m.signatureFields.map(function (f) {
            return '<li>' + (f.missing
              ? '<span class="ltr-missing">' + ltrEsc(f.label) + ' missing</span>'
              : ltrEsc(f.value)) + '</li>';
          }).join('') + '</ul>'
        : (m.therapistName ? '<p>' + ltrEsc(m.therapistName) + '</p>' : '')) +
      '</div>';

    out += '<p class="ltr-doc-cc' + (m.cc.willAppear ? '' : ' ltr-doc-cc-off') + '">' + ltrEsc(m.cc.text) + '</p>';

    if (m.documentId) {
      out += '<p class="ltr-doc-foot">' + ltrEsc(m.documentId) + '</p>';
    }
    return out + '</div>';
  }

  // ══ EVENTS ═══════════════════════════════════════════════════════════════

  doc.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-ltr]') : null;
    if (!t) return;
    var a = t.getAttribute('data-ltr');
    var id = t.getAttribute('data-id');
    var idx = t.getAttribute('data-idx');

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
    if (a === 'start-draft') { if (S.draft) goStep(2); else createDraft(); return; }
    if (a === 'pick-client') { chooseClient(id); return; }
    if (a === 'retry-save') { retryPatch(); return; }
    if (a === 'contacts-reload') { S.contacts = null; loadContacts(); return; }
    if (a === 'pick-contact') { chooseContact(idx); return; }
    if (a === 'custom-recipient') { S.contactPick = 'custom'; render(); focusId('ltr-r-name'); return; }
    if (a === 'cc-add') { setCc(ccList().concat([{ name: '', organisation: '' }])); render(); return; }
    if (a === 'cc-remove') {
      var list = ccList();
      list.splice(Number(idx), 1);
      setCc(list);
      render();
      return;
    }
    if (a === 'save-recipient') { saveRecipientToProfile(); return; }
    if (a === 'details-open') { S.detailsOpen = true; render(); return; }
    if (a === 'details-close') { S.detailsOpen = false; render(); return; }
    if (a === 'reset-blocks') { resetBlockDefaults(); return; }
    if (a === 'custom-save') { saveCustom(); return; }
    if (a === 'custom-edit') { editCustom(id); return; }
    if (a === 'custom-remove') { removeCustom(id); return; }
    if (a === 'custom-up') { moveCustom(id, -1); return; }
    if (a === 'custom-down') { moveCustom(id, 1); return; }
    if (a === 'custom-cancel') { S.customEditing = null; S.customLabel = ''; S.customGuidance = ''; render(); return; }
    if (a === 'preview-toggle') { S.previewOpen = !S.previewOpen; render(); return; }
    if (a === 'generate-confirm') { S.confirming = true; render(); return; }
    if (a === 'generate-cancel') { S.confirming = false; render(); return; }
    if (a === 'generate') { generate(); return; }
  });

  function focusId(id) {
    var n = el(id);
    if (n) { try { n.focus(); } catch (e) { /* not focusable */ } }
  }

  // Checkboxes and selects.
  doc.addEventListener('change', function (e) {
    var box = e.target && e.target.closest ? e.target.closest('[data-ltr-check]') : null;
    if (box && box.getAttribute('data-ltr-check') === 'block') {
      toggleBlock(box.getAttribute('data-tag'));
      return;
    }
    if (box && box.getAttribute('data-ltr-check') === 'exclude') {
      setExcluded(box.getAttribute('data-tag'), box.checked);
      return;
    }
    var sel = e.target && e.target.closest ? e.target.closest('[data-ltr-change]') : null;
    if (!sel) return;
    var kind = sel.getAttribute('data-ltr-change');
    if (kind === 'save-target') { S.saveTarget = sel.value; return; }
    if (kind === 'therapist') { S.therapistId = sel.value ? sel.value : user().therapistProfileId; }
  });

  // Text inputs never trigger a full re-render — typing must not move the
  // caret. They update the local draft, queue the debounced PATCH, and repaint
  // the preview only.
  doc.addEventListener('input', function (e) {
    var f = e.target && e.target.closest ? e.target.closest('[data-ltr-input]') : null;
    if (!f) return;
    var kind = f.getAttribute('data-ltr-input');

    if (kind === 'q') { searchClients(f.value); return; }
    if (kind === 'override') { setOverride(f.getAttribute('data-tag'), f.value); return; }
    if (kind === 'custom-label') { S.customLabel = f.value; return; }
    if (kind === 'custom-guidance') { S.customGuidance = f.value; return; }

    if (kind === 'recip-name') { setRecipient({ name: f.value }, { suggest: true }); return; }
    if (kind === 'recip-role') { setRecipient({ role: f.value }); return; }
    if (kind === 'recip-org') { setRecipient({ organisation: f.value }); return; }
    if (kind === 'recip-address') { setRecipient({ address: f.value }); return; }
    if (kind === 'recip-salutation') { S.salutationTouched = true; setRecipient({ salutation: f.value }); return; }

    if (kind === 'cc-name' || kind === 'cc-org') {
      var list = ccList();
      var i = Number(f.getAttribute('data-idx'));
      if (!list[i]) return;
      list[i] = Object.assign({}, list[i], kind === 'cc-name' ? { name: f.value } : { organisation: f.value });
      setCc(list);
      var live = doc.querySelector('.ltr-cclist');
      if (live && live.parentNode) {
        var status = live.parentNode.querySelector('[role="status"]');
        if (status) status.textContent = ltrCcSummary(list).text;
      }
      return;
    }

    if (kind === 'subject') { setDetails({ subject: f.value }); return; }
    if (kind === 'reporting-period') { setDetails({ reportingPeriod: f.value }); return; }
    if (kind === 'letter-date') {
      S.dateText = f.value;
      var iso = ltrParseAUDate(f.value);
      var errNode = doc.querySelector('#ltr-date ~ .ltr-err');
      if (iso) {
        S.dateErr = '';
        setDetails({ letterDate: iso });
      } else {
        // Never silently reinterpret a half-typed date, and never guess.
        S.dateErr = String(f.value).trim() ? 'Enter the date as dd/mm/yyyy — for example 03/04/2026 for 3 April 2026.' : '';
      }
      if (errNode) errNode.textContent = S.dateErr;
      return;
    }
  });

  doc.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && S.open) { closeWizard(); }
  });

  async function archiveDraft() {
    var id = S.confirmDelete;
    if (!id) return;
    S.confirmDelete = null;
    var r = await api(API + '/drafts/' + encodeURIComponent(id), { method: 'DELETE' });
    if (!r.ok) { S.draftsErr = r.error; renderEntry(); return; }
    S.drafts = (S.drafts || []).filter(function (d) { return String(d.id) !== String(id); });
    renderEntry();
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

  // ══ OPEN / CLOSE ═════════════════════════════════════════════════════════

  var lastFocus = null;

  function openWizard() {
    lastFocus = doc.activeElement;
    S.open = true;
    S.step = 1;
    S.furthest = Math.max(S.furthest, 1);
    S.result = null; S.genErr = ''; S.confirming = false;
    loadTemplate();
    loadTherapists();
    render();
    focusWizard();
  }

  function focusWizard() {
    focusId(el('ltr-q') ? 'ltr-q' : 'ltr-step-h');
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
    if (!el('letter-hub-entry')) return;
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

  global.LetterBuilder = {
    open: openWizard,
    close: closeWizard,
    openDraft: openDraft,
    reloadDrafts: function () { return loadDrafts(true); },
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
