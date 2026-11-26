/**
 * Opal Assist — the Report builder. No framework.
 *
 * In a client chat, "Report" opens a panel that turns the practitioner's own
 * case notes into a first draft of an NDIS PROGRESS REPORT or SUPPORT LETTER:
 *
 *   1. pick the kind, the period, and type the NDIS goals (or what is being
 *      recommended);
 *   2. the period's notes are listed (the client-file route, caseload-scoped)
 *      and all ticked; untick any that should not be used;
 *   3. "Draft" attaches the ticked notes — numbered N1, N2 … oldest first —
 *      and the goals as ordinary attachments, so they meet the same name
 *      check and "will be hidden" review as any file, and sends the chat
 *      message with report: { kind, goals }. The server asks for the
 *      Templates master's own headings and a note reference, "(N3)", after
 *      every statement taken from a note (backend/assist/report-kinds.js);
 *   4. the reply opens in the document editor, references as chips that show
 *      the note when clicked — check each claim against its source;
 *   5. "Word file" downloads it without the references; "Fill the template"
 *      creates the matching Templates document (letterhead, participant and
 *      therapist details from Splose and the portal), pours each section into
 *      its field, saves it under Resources → Templates and downloads it.
 *
 * The notes' text (names included) is held in this page's memory only, to
 * show behind the chips: never stored in the browser, never logged. Nothing
 * reaches the AI except through the composer's check.
 *
 * Pure helpers are exported for node tests; open() and fillTemplate() need a document.
 */
(function (global) {
  'use strict';

  var MAX_GOALS = 8; // mirrors report-kinds.js
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // The Templates master behind each kind: heading → narrative field. The
  // headings are report-kinds.js's (a test pins them together); the tags are
  // the masters' own (templates/progress-report-map.js, support-letter-map.js).
  var KINDS = {
    progress_report: {
      label: 'Progress report', template: 'progress_report', maxChars: 12000,
      headings: function (goals) {
        var h = ['Background information'];
        for (var i = 1; i <= goals; i++) h.push('Goal ' + i + ' progress');
        return h.concat(['Overall summary of progress', 'Core supports', 'Capacity building']);
      },
      field: function (heading) {
        var m = /^Goal (\d) progress$/.exec(heading);
        if (m) return 'OPAL_REPORT_GOAL_' + m[1] + '_PROGRESS';
        return { 'Background information': 'OPAL_REPORT_BACKGROUND', 'Overall summary of progress': 'OPAL_REPORT_SUMMARY', 'Core supports': 'OPAL_REPORT_CORE_SUPPORTS', 'Capacity building': 'OPAL_REPORT_CAPACITY_BUILDING' }[heading] || null;
      },
    },
    support_letter: {
      label: 'Support letter', template: 'support_letter', maxChars: 8000,
      headings: function () {
        return ['Purpose of this letter', 'Background and current situation', 'Recommended support', 'Clinical justification',
          'Value for money and alternatives considered', 'Alignment with NDIS goals', 'Impact if not funded', 'Recommendation'];
      },
      field: function (heading) {
        return { 'Purpose of this letter': 'OPAL_LETTER_PURPOSE', 'Background and current situation': 'OPAL_LETTER_BACKGROUND', 'Recommended support': 'OPAL_LETTER_RECOMMENDED_SUPPORT',
          'Clinical justification': 'OPAL_LETTER_CLINICAL_JUSTIFICATION', 'Value for money and alternatives considered': 'OPAL_LETTER_VALUE_FOR_MONEY',
          'Alignment with NDIS goals': 'OPAL_LETTER_NDIS_GOALS', 'Impact if not funded': 'OPAL_LETTER_IMPACT_IF_NOT_FUNDED', 'Recommendation': 'OPAL_LETTER_CONCLUSION' }[heading] || null;
      },
    },
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /** YYYY-MM-DD for a Date, in Perth. */
  function isoDay(d) {
    var p = new Date(d.getTime() + 8 * 3600000);
    return p.getUTCFullYear() + '-' + pad(p.getUTCMonth() + 1) + '-' + pad(p.getUTCDate());
  }
  /** "3 May 2026" for YYYY-MM-DD. */
  function dayLabel(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }
  /** "3 May 2026" for a timestamp, in Perth. */
  function noteDate(v) {
    var d = new Date(v);
    return isNaN(d) ? '' : dayLabel(isoDay(d));
  }
  /** The default period: six months back to today. */
  function defaultPeriod(now) {
    var to = now || new Date();
    var from = new Date(to.getTime());
    from.setUTCMonth(from.getUTCMonth() - 6);
    return { from: isoDay(from), to: isoDay(to) };
  }
  function periodLabel(p) { return dayLabel(p.from) + ' to ' + dayLabel(p.to); }

  /** Goals typed one per line → a clean list (no numbering, no bullets, at most MAX_GOALS). */
  function goalLines(text) {
    return String(text || '').split(/\r?\n/).map(function (l) { return l.replace(/^\s*(?:\d+[.)]|[-•*])\s*/, '').trim(); }).filter(Boolean).slice(0, MAX_GOALS);
  }

  /**
   * The ticked notes, oldest first, numbered N1 … → { text, sources }.
   * `sources` is what the chips show: { N1: { date, title, text } }.
   */
  function numberNotes(notes) {
    var sorted = (notes || []).slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
    var sources = {};
    var parts = sorted.map(function (n, i) {
      var code = 'N' + (i + 1);
      sources[code] = { date: noteDate(n.date), title: n.title || '', text: n.text || '' };
      return '--- ' + code + ' — ' + noteDate(n.date) + (n.title ? ' — ' + n.title : '') + (n.review === 'approved' ? '' : ' (not yet reviewed)') + ' ---\n' + String(n.text || '').trim();
    });
    return {
      text: 'REPORT MATERIAL — ' + sorted.length + (sorted.length === 1 ? ' case note' : ' case notes') + ', oldest first. Cite them by number.\n\n' + parts.join('\n\n'),
      sources: sources,
      count: sorted.length,
    };
  }

  /** The request attachment: goals in order, and for a letter what is recommended. */
  function requestText(kind, goals, recommend) {
    var out = [];
    if (kind === 'support_letter') out.push('WHAT IS RECOMMENDED:\n' + String(recommend || '').trim());
    if (goals.length) out.push('NDIS GOALS, in order:\n' + goals.map(function (g, i) { return (i + 1) + '. ' + g; }).join('\n'));
    return out.join('\n\n');
  }

  /** The visible chat message. The client's name is in it on purpose: the check hides it like any other. */
  function message(kind, clientName, period) {
    return 'Write a ' + KINDS[kind].label.toLowerCase() + ' for ' + (clientName || 'this client') + ', covering ' + periodLabel(period)
      + ', from the attached case notes' + (kind === 'support_letter' ? ' and recommendation.' : ' and NDIS goals.');
  }

  /**
   * A report document → the template's field values. Names are put back,
   * note references taken out; each heading's blocks become one narrative
   * (a line per paragraph, "• " for dot points). Returns { values, missing }:
   * `missing` lists headings the reply did not carry.
   */
  function templateValues(doc, kind, restore, strip) {
    var spec = KINDS[kind];
    var values = {}; var seen = {}; var cur = null; var lines = [];
    function flush() {
      if (cur && lines.length) {
        var tag = spec.field(cur);
        if (tag) values[tag] = lines.join('\n').slice(0, spec.maxChars);
      }
      lines = [];
    }
    (doc.blocks || []).forEach(function (b) {
      if (b.t === 'h') { flush(); cur = String(b.text || '').trim(); seen[cur] = true; return; }
      var text = strip(restore(b.text));
      if (b.t === 'li') text = '• ' + (b.lead ? strip(restore(b.lead)) + ': ' : '') + text;
      if (text.trim()) lines.push(text.trim());
    });
    flush();
    var missing = spec.headings((doc.report && doc.report.goals) || 1).filter(function (h) { return !seen[h]; });
    return { values: values, missing: missing };
  }

  /**
   * Which template sections to print: the master's defaults, plus every goal
   * slot the report used (and no more), plus "Impact if not funded" when the
   * letter has it.
   */
  function sectionSelection(sections, kind, goals, values) {
    var picked = (sections || []).filter(function (s) { return !s.custom && s.included; }).map(function (s) { return s.tag; });
    var all = (sections || []).map(function (s) { return s.tag; });
    function set(tag, on) {
      if (all.indexOf(tag) < 0) return;
      var i = picked.indexOf(tag);
      if (on && i < 0) picked.push(tag);
      if (!on && i >= 0) picked.splice(i, 1);
    }
    if (kind === 'progress_report') for (var g = 1; g <= MAX_GOALS; g++) set('OPAL_SECTION_REPORT_GOAL_' + g, g <= goals);
    if (kind === 'support_letter') set('OPAL_SECTION_SUPPORT_LETTER_IMPACT_IF_NOT_FUNDED', !!values.OPAL_LETTER_IMPACT_IF_NOT_FUNDED);
    return picked;
  }

  var api = {
    KINDS: KINDS, MAX_GOALS: MAX_GOALS, isoDay: isoDay, dayLabel: dayLabel, defaultPeriod: defaultPeriod, periodLabel: periodLabel,
    goalLines: goalLines, numberNotes: numberNotes, requestText: requestText, message: message, templateValues: templateValues, sectionSelection: sectionSelection,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) { global.OpalAssistReport = api; return; }

  // ── The panel ───────────────────────────────────────────────────────────────
  function close() { var el = document.getElementById('oa-rb'); if (el) el.remove(); }

  /**
   * opts: { client: {ref, name}, api: Assist's fetch, composer, start(pending) }
   * start() is called with the pending report once everything is attached.
   */
  function open(opts) {
    close();
    var P = { kind: 'progress_report', period: defaultPeriod(), notes: null, picked: {}, error: '', seq: 0, goals: '', recommend: '' };
    var el = document.createElement('div');
    el.className = 'oa-cf-backdrop'; el.id = 'oa-rb';
    el.innerHTML = '<div class="oa-cf oa-rb" role="dialog" aria-modal="true" aria-labelledby="oa-rb-title">'
      + '<div class="oa-cf-head"><h2 id="oa-rb-title">Report builder <span>' + esc(opts.client.name || '') + '</span></h2>'
      + '<button type="button" class="oa-btn ghost sm" data-rb="close" aria-label="Close">×</button></div>'
      + '<p class="oa-cf-lede">A first draft from your own case notes, in the template\'s headings. Every statement is marked with the note it came from, so you can check it before anything is used.</p>'
      + '<div class="oa-cf-body">'
      + '<section><h3>Report</h3><div class="oa-rb-kinds" role="radiogroup" aria-label="Kind of report">'
      + '<label><input type="radio" name="oa-rb-kind" value="progress_report" checked> Progress report</label>'
      + '<label><input type="radio" name="oa-rb-kind" value="support_letter"> Support letter</label></div>'
      + '<div class="oa-rb-period"><label>From <input type="date" id="oa-rb-from" value="' + P.period.from + '"></label><label>To <input type="date" id="oa-rb-to" value="' + P.period.to + '"></label></div></section>'
      + '<section id="oa-rb-asks"></section>'
      + '<section><h3>Case notes in this period</h3><div id="oa-rb-notes"><div class="oa-cf-empty">Loading…</div></div>'
      + '<p class="oa-cf-note">Your notes from the portal and Opa. Notes written directly in Splose are not here — Splose does not share them.</p></section>'
      + '</div>'
      + '<div class="oa-cf-foot"><span id="oa-rb-count"></span><button type="button" class="oa-btn primary sm" data-rb="draft" disabled>Draft the report</button></div></div>';
    document.body.appendChild(el);
    var q = function (s) { return el.querySelector(s); };

    function renderAsks() {
      q('#oa-rb-asks').innerHTML = P.kind === 'progress_report'
        ? '<h3>NDIS goals</h3><label class="oa-rb-label" for="oa-rb-goals">One per line, in plan order (up to ' + MAX_GOALS + '). Each gets its own progress section.</label>'
          + '<textarea id="oa-rb-goals" rows="4" placeholder="e.g. I want to cook simple meals for myself safely">' + esc(P.goals) + '</textarea>'
        : '<h3>Recommendation</h3><label class="oa-rb-label" for="oa-rb-recommend">What are you recommending? Include the specification or quote details.</label>'
          + '<textarea id="oa-rb-recommend" rows="4" placeholder="e.g. A shower chair with backrest and armrests, quote #1234 from …">' + esc(P.recommend) + '</textarea>'
          + '<label class="oa-rb-label" for="oa-rb-goals">Their NDIS goals (optional, one per line)</label>'
          + '<textarea id="oa-rb-goals" rows="3">' + esc(P.goals) + '</textarea>';
      updateFoot();
    }

    function load() {
      var seq = ++P.seq; P.error = ''; P.notes = null; renderNotes();
      var path = '/api/assist/client-file?client=' + encodeURIComponent(opts.client.ref) + '&from=' + encodeURIComponent(P.period.from) + '&to=' + encodeURIComponent(P.period.to);
      opts.api(path).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || j.answer || 'Your notes could not be loaded just now.'); return j; });
      }).then(function (j) {
        if (seq !== P.seq) return;
        P.notes = (j.notes || []).slice().sort(function (a, b) { return new Date(a.date) - new Date(b.date); });
        P.more = !!j.moreNotes;
        P.picked = {}; P.notes.forEach(function (n) { P.picked[n.id] = true; });
        renderNotes();
      }, function (err) { if (seq !== P.seq) return; P.error = err.message; renderNotes(); });
    }

    function renderNotes() {
      var host = q('#oa-rb-notes');
      if (P.error) host.innerHTML = '<div class="oa-cf-empty bad">' + esc(P.error) + '</div>';
      else if (!P.notes) host.innerHTML = '<div class="oa-cf-empty">Loading…</div>';
      else if (!P.notes.length) host.innerHTML = '<div class="oa-cf-empty">No case notes for this client in that period.</div>';
      else {
        host.innerHTML = '<div class="oa-rb-tools"><button type="button" class="oa-btn ghost sm" data-rb="all">Tick all</button><button type="button" class="oa-btn ghost sm" data-rb="none">Untick all</button></div>'
          + '<ul class="oa-cf-notes">' + P.notes.map(function (n) {
            return '<li><label class="oa-cf-row"><input type="checkbox" data-note="' + esc(n.id) + '"' + (P.picked[n.id] ? ' checked' : '') + '><span><b>' + esc(noteDate(n.date)) + (n.title ? ' — ' + esc(n.title) : '') + '</b>'
              + (n.review === 'approved' ? '' : '<em>not yet reviewed</em>') + '<small>' + esc(String(n.text || '').slice(0, 160)) + (String(n.text || '').length > 160 ? '…' : '') + '</small></span></label></li>';
          }).join('') + '</ul>'
          + (P.more ? '<div class="oa-cf-empty">Only the newest ' + P.notes.length + ' notes are shown — shorten the period to include older ones.</div>' : '');
      }
      updateFoot();
    }

    function chosen() { return (P.notes || []).filter(function (n) { return P.picked[n.id]; }); }
    function build() {
      var goals = goalLines(P.goals);
      var material = numberNotes(chosen());
      var request = requestText(P.kind, goals, P.recommend);
      return { goals: goals, material: material, request: request };
    }
    function problem(b) {
      if (!P.notes) return 'Loading your notes…';
      if (!b.material.count) return 'Tick at least one case note.';
      if (P.kind === 'progress_report' && !b.goals.length) return 'Add at least one NDIS goal.';
      if (P.kind === 'support_letter' && !P.recommend.trim()) return 'Say what you are recommending.';
      var chars = b.material.text.length + b.request.length + 120;
      var room = opts.composer.roomLeft();
      if (chars > room) return chars.toLocaleString() + ' of ' + room.toLocaleString() + ' characters — too much. Untick some notes or shorten the period.';
      return '';
    }
    function updateFoot() {
      var b = build(); var why = problem(b);
      var count = q('#oa-rb-count');
      count.textContent = why || (b.material.count + (b.material.count === 1 ? ' note' : ' notes') + ' · ' + (b.material.text.length + b.request.length).toLocaleString() + ' characters');
      count.className = why && P.notes ? 'warn' : '';
      q('[data-rb="draft"]').disabled = !!why;
    }

    function draft() {
      var b = build(); if (problem(b)) return;
      var name = KINDS[P.kind].label;
      opts.composer.addText('Report material: ' + b.material.count + (b.material.count === 1 ? ' case note' : ' case notes'), b.material.text);
      if (b.request) opts.composer.addText('Report request: ' + (P.kind === 'support_letter' ? 'recommendation and goals' : 'NDIS goals'), b.request);
      var pending = {
        kind: P.kind, goals: P.kind === 'progress_report' ? b.goals.length : 0, label: name,
        sources: b.material.sources, period: periodLabel(P.period), goalsText: b.goals.join('\n'),
      };
      close();
      opts.start(pending, message(P.kind, opts.client.name, P.period));
    }

    el.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'oa-rb-kind') { P.kind = t.value; renderAsks(); return; }
      if (t.id === 'oa-rb-from' || t.id === 'oa-rb-to') {
        var from = q('#oa-rb-from').value; var to = q('#oa-rb-to').value;
        if (from && to && from <= to) { P.period = { from: from, to: to }; load(); }
        return;
      }
      if (t.dataset.note) { if (t.checked) P.picked[t.dataset.note] = true; else delete P.picked[t.dataset.note]; updateFoot(); }
    });
    el.addEventListener('input', function (e) {
      if (e.target.id === 'oa-rb-goals') { P.goals = e.target.value; updateFoot(); }
      if (e.target.id === 'oa-rb-recommend') { P.recommend = e.target.value; updateFoot(); }
    });
    el.addEventListener('click', function (e) {
      if (e.target === el) return close();
      var b = e.target.closest('[data-rb]'); if (!b || b.disabled) return;
      if (b.dataset.rb === 'close') close();
      else if (b.dataset.rb === 'all') { (P.notes || []).forEach(function (n) { P.picked[n.id] = true; }); renderNotes(); }
      else if (b.dataset.rb === 'none') { P.picked = {}; renderNotes(); }
      else if (b.dataset.rb === 'draft') draft();
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

    renderAsks();
    load();
  }

  // ── Fill the template ───────────────────────────────────────────────────────
  function json(r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var err = new Error(j.message || j.error || 'failed'); err.status = r.status; throw err; } return j; }); }

  /**
   * Create the Templates document for this report, fill it, download it.
   * opts: { doc, api, client: {ref, name}, restore(text), strip(text), meta: pending|null }
   * Resolves { missing } (headings the reply lacked); rejects with a person-readable message.
   */
  function fillTemplate(opts) {
    var kind = opts.doc.report && opts.doc.report.kind;
    var spec = KINDS[kind];
    if (!spec) return Promise.reject(new Error('This is not a report from the Report builder.'));
    var m = /^splose:patient:([A-Za-z0-9_-]+)$/.exec(String(opts.client && opts.client.ref || ''));
    var filled = templateValues(opts.doc, kind, opts.restore, opts.strip);
    var values = filled.values;
    if (opts.meta && kind === 'progress_report') {
      if (opts.meta.period) values.OPAL_REPORT_PERIOD = opts.meta.period;
      if (opts.meta.goalsText) values.OPAL_REPORT_GOALS_LIST = opts.meta.goalsText;
    }
    var title = spec.label + ' — Opal Assist draft';
    var docId = null;
    return opts.api('/api/templates/documents', { body: { templateId: spec.template, clientId: m ? m[1] : undefined, title: title } }).then(json).then(function (j) {
      docId = j.document.id;
      var body = { fieldValues: values };
      if (j.document.sections) body.sections = { selected: sectionSelection(j.document.sections, kind, (opts.doc.report.goals || 1), values) };
      return opts.api('/api/templates/documents/' + encodeURIComponent(docId), { method: 'PATCH', body: body }).then(json);
    }).then(function () {
      return opts.api('/api/templates/documents/' + encodeURIComponent(docId) + '/export.docx');
    }).then(function (r) {
      if (!r.ok) { var err = new Error('export'); err.status = r.status; err.saved = true; throw err; }
      var cd = r.headers.get('Content-Disposition') || ''; var fm = cd.match(/filename="([^"]+)"/);
      var name = fm ? (function () { try { return decodeURIComponent(fm[1]); } catch (x) { return fm[1]; } })() : spec.label + '.docx';
      return r.blob().then(function (blob) {
        var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        return { missing: filled.missing, documentId: docId };
      });
    }, function (err) { throw err; }).catch(function (err) {
      if (err.saved) throw new Error('Saved in Resources → Templates, but the Word file could not be built just now. Open it there to download.');
      if (err.status === 403) throw new Error('Templates are available to therapists and the owner.');
      if (err.status === 503) throw new Error('Splose could not be reached for the participant details. Try again in a minute.');
      throw new Error('The template could not be filled just now.');
    });
  }

  api.open = open; api.close = close; api.fillTemplate = fillTemplate;
  global.OpalAssistReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
