/* ═══════════════════════════════════════════════════════════════════════════
   OPAL — ASSESSMENTS: THE FULL-PAGE SURFACE

   One page for administering and reading standardised assessments. It owns the
   page frame — Back, breadcrumb, client and instrument context, status, the
   action bar, history and the share panel — and hands the FORM ITSELF to the
   instrument's own module (today: WHODAS 2.0, via window.WHODAS).

   Conventions (mirrors fca.js / resourcehub.js / whodas.js):
     - single IIFE, string-built HTML, esc() on EVERY untrusted value
     - delegated data-assess handlers; no inline onclick carrying server ids
     - pure helpers exported for node tests before anything touches the DOM
     - the backend enforces every boundary; the client only reflects it

   NON-NEGOTIABLES ENCODED HERE:

     1. AN ASSESSMENT IS A PAGE, NOT A PANEL. This surface is a routed
        full-page view at #assessment/record/:id and #assessment/client/:id.
        It is never a drawer, a modal, a floating window or a side panel, and
        starting one NEVER opens the client profile drawer or the booking
        composer. Those are appointment surfaces; an assessment is not an
        appointment. The regression this replaces did exactly that: choosing a
        client and pressing "Complete electronically" called openClientProfile(),
        which opens the profile drawer complete with its "Book appointment"
        action, so the clinician was sent to the appointment experience instead
        of the assessment.

     2. BACK IS ALWAYS TRUE. Every view states where Back goes and goes there:
        a record returns to that client's assessment list, the list returns to
        the Assessments tab. The button and the browser's own Back press
        produce the same movement, because both run through the same route.

     3. NO CLINICAL CONTENT IS INVENTED HERE. This file contains no item
        wording, no response options, no scoring, no severity language and no
        interpretation. Everything clinical is rendered from what the server
        sends, already labelled with the method and source that produced it.

     4. NOTHING IS SENT SILENTLY. The share action asks the server to PREPARE a
        message and shows it for review. There is no send call in this file.
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

(function (global) {

  // `global` is null under the node test harness. The pure helpers below are
  // still defined and exported there; everything that touches the DOM is gated
  // on `doc` further down.
  var doc = global && global.document;

  var API = '/api/assessments';

  // ══ PURE HELPERS (exported for node tests) ════════════════════════════════

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

  /**
   * The five availability states the server publishes. Kept as a lookup rather
   * than a conditional so an unknown state renders as itself instead of
   * silently becoming "available".
   */
  var AVAILABILITY_LABELS = {
    'electronic-and-pdf': 'Electronic and PDF',
    electronic: 'Available electronically',
    pdf: 'PDF available',
    'source-required': 'Source required',
    'temporarily-unavailable': 'Temporarily unavailable',
  };

  function availabilityLabel(a) {
    if (!a) return 'Unknown';
    return AVAILABILITY_LABELS[a.state] || a.label || a.state || 'Unknown';
  }

  var STATUS_LABELS = {
    draft: 'Draft',
    completed: 'Completed',
    voided: 'Voided',
    amended: 'Amended',
  };

  function statusLabel(s) { return STATUS_LABELS[s] || s || '—'; }

  var METHOD_LABELS = {
    interviewer: 'Interviewer-administered',
    self: 'Self-administered',
    proxy: 'Proxy-administered',
  };

  function methodLabel(m) { return METHOD_LABELS[m] || m || '—'; }

  /**
   * Route grammar for this surface. Two addressable views:
   *   #assessment/record/:id   one assessment record
   *   #assessment/client/:id   one client's records for one instrument
   * A bare "#assessment/:id" is accepted as a record, because that is the
   * shorter form a human would type.
   */
  function routeFor(view, id) {
    var v = view === 'client' ? 'client' : 'record';
    if (!id) return null;
    // Built by join, not by interpolation: `v` is one of two literals above and
    // the id is percent-encoded, so nothing here can grow a route separator.
    return ['#assessment', v, encodeURIComponent(String(id))].join('/');
  }

  /**
   * Where Back goes from a given view. Returned as a description rather than
   * performed, so the same rule can be asserted in a node test and used by the
   * router without a DOM.
   */
  function backTargetFor(state) {
    if (!state) return { kind: 'assessments-tab' };
    if (state.view === 'record' && state.clientId) {
      return { kind: 'client', key: state.key, clientId: state.clientId };
    }
    return { kind: 'assessments-tab' };
  }

  var helpers = {
    esc: esc,
    fmtDate: fmtDate,
    fmtDateTime: fmtDateTime,
    availabilityLabel: availabilityLabel,
    statusLabel: statusLabel,
    methodLabel: methodLabel,
    routeFor: routeFor,
    backTargetFor: backTargetFor,
    AVAILABILITY_LABELS: AVAILABILITY_LABELS,
  };

  // Node test harness stops here — nothing below runs without a DOM.
  if (!doc) {
    if (typeof module !== 'undefined' && module.exports) module.exports = { _helpers: helpers };
    return;
  }

  // ══ STATE ═════════════════════════════════════════════════════════════════

  var S = {
    open: false,
    view: null,          // 'client' | 'record'
    key: null,           // assessment definition key
    def: null,           // catalogue entry for `key`
    clientId: null,
    clientName: null,
    recordId: null,
    record: null,        // summary of the open record (from the history list)
    records: [],
    loading: false,
    err: '',
    recordsErr: '',      // why the history could not be loaded, if it could not
    share: null,         // prepared share draft awaiting review
    shareBusy: false,
    // Set while the instrument module owns the body, so a re-render of the
    // frame does not tear its form out from under it.
    formMounted: false,
  };

  var lastFocus = null;

  // ══ NETWORK ═══════════════════════════════════════════════════════════════

  function api(path, options) {
    var opts = options || {};
    return fetch(API + path, {
      method: opts.method || 'GET',
      credentials: 'same-origin',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }).then(function (res) {
      var ct = res.headers.get('content-type') || '';
      var parse = ct.indexOf('application/json') !== -1 ? res.json() : Promise.resolve(null);
      return parse.then(function (data) {
        if (!res.ok) {
          var err = new Error((data && data.message) || (data && data.error) || ('HTTP ' + res.status));
          err.status = res.status;
          err.payload = data;
          throw err;
        }
        return data;
      });
    });
  }

  function root() { return doc.getElementById('assessment-root'); }
  function bodyHost() { return doc.getElementById('assess-body'); }

  // ══ NAVIGATION ════════════════════════════════════════════════════════════

  /**
   * Publish the current address. OpalNav owns the history stack; when it is
   * absent (a page that does not load navigation.js) this is a silent no-op and
   * the surface still works, it just has no Back entry.
   */
  function publishRoute() {
    if (!global.OpalNav || typeof global.OpalNav.pushAssessment !== 'function') return;
    try { global.OpalNav.pushAssessment(S.view, S.view === 'client' ? S.clientId : S.recordId); }
    catch (e) { /* routing is never allowed to break the surface */ }
  }

  /**
   * Back. Never history.back(): a deep link arrives with no previous entry, and
   * a Back button that sometimes leaves the application is worse than one that
   * always lands where it says. The browser's own Back is handled separately by
   * OpalNav, which restores whichever route the stack actually holds.
   */
  function goBack() {
    var target = backTargetFor(S);
    if (target.kind === 'client' && target.clientId) {
      return openForClient(target.key, target.clientId, S.clientName);
    }
    return exitToAssessmentsTab();
  }

  /** Close the surface and return to the Resource Hub's Assessments tab. */
  function exitToAssessmentsTab() {
    close();
    if (typeof global.switchTab === 'function') { try { global.switchTab('resources'); } catch (e) {} }
    // #rh2-root lives inside the Resources tab's "shared" sub-panel. If the
    // clinician was on the AI Studio or Store sub-panel before opening an
    // assessment, returning without this renders the catalogue into a panel
    // that is display:none — a blank Resources tab.
    if (typeof global.rhSwitch === 'function') { try { global.rhSwitch('shared'); } catch (e) {} }
    if (global.RH2 && typeof global.RH2.open === 'function') { try { global.RH2.open(); } catch (e) {} }
    if (global.RH2 && typeof global.RH2.nav === 'function') { try { global.RH2.nav('instruments'); } catch (e) {} }
  }

  // ══ FRAME ═════════════════════════════════════════════════════════════════

  /**
   * The page frame.
   *
   * Built once, then updated in place. A wholesale re-render here would tear
   * out #assess-body — and with it a mounted, half-completed assessment form —
   * every time the status line changed.
   */
  var frameBuilt = false;

  function renderChrome() {
    var host = root();
    if (!host) return;

    host.hidden = !S.open;
    doc.body.classList.toggle('assess-open', S.open);
    if (!S.open) { host.innerHTML = ''; frameBuilt = false; mountedFor = null; return; }

    if (frameBuilt && doc.getElementById('assess-body')) { updateHeader(); return; }

    host.innerHTML =
      '<div class="assess-page">'
      + '<header class="assess-head">'
      + '<button type="button" class="assess-back" data-assess="back">'
      + '<span aria-hidden="true">&larr;</span> <span id="assess-back-label"></span></button>'
      + '<div class="assess-head__id">'
      + '<h1 class="assess-title" id="assess-title" tabindex="-1"></h1>'
      + '<p class="assess-sub" id="assess-subtitle" hidden></p>'
      + '</div>'
      + '<div id="assess-context"></div>'
      + '</header>'
      + '<div id="assess-error"></div>'
      + '<div class="assess-body" id="assess-body"></div>'
      + '</div>';
    frameBuilt = true;
    mountedFor = null;
    updateHeader();
  }

  function updateHeader() {
    var d = S.def;
    var back = doc.getElementById('assess-back-label');
    var title = doc.getElementById('assess-title');
    var sub = doc.getElementById('assess-subtitle');
    var ctx = doc.getElementById('assess-context');
    var err = doc.getElementById('assess-error');

    if (back) back.textContent = backLabel();
    if (title) title.textContent = d ? (d.abbreviation || d.name) : 'Assessment';
    if (sub) {
      var subtitle = d && d.name && d.abbreviation && d.name !== d.abbreviation ? d.name : '';
      sub.textContent = subtitle;
      sub.hidden = !subtitle;
    }
    if (ctx) ctx.innerHTML = renderContext();
    if (err) {
      err.innerHTML = S.err
        ? '<div class="assess-notice assess-notice--error" role="alert">' + esc(S.err) + '</div>'
        : '';
    }
  }

  function backLabel() {
    var t = backTargetFor(S);
    if (t.kind !== 'client') return 'Back to Assessments';
    if (!S.clientName) return 'Back to this client’s assessments';
    // Joined rather than interpolated. The label is written with textContent,
    // never innerHTML, and building it this way keeps that visibly true.
    return ['Back to ', S.clientName, '’s assessments'].join('');
  }

  /**
   * Client and assessment context, and nothing else. No appointment counts, no
   * booking action, no invoice summary — this is a clinical assessment page and
   * the controls on it are the assessment's own.
   */
  function renderContext() {
    var bits = [];
    if (S.clientName || S.clientId) {
      bits.push(['Client', S.clientName || S.clientId]);
    }
    if (S.def && S.def.edition) bits.push(['Version', S.def.edition]);
    var r = S.record;
    if (r) {
      bits.push(['Status', statusLabel(r.status)]);
      if (r.administrationMethod) bits.push(['Administration', methodLabel(r.administrationMethod)]);
      if (r.status === 'completed' && r.completedAt) {
        bits.push(['Completed', fmtDateTime(r.completedAt)]);
        if (r.completedByName) bits.push(['Completed by', r.completedByName]);
      } else if (r.startedAt) {
        bits.push(['Started', fmtDateTime(r.startedAt)]);
        if (r.startedByName) bits.push(['Started by', r.startedByName]);
      }
    }
    if (!bits.length) return '';
    return '<dl class="assess-context">' + bits.map(function (b) {
      return '<div><dt>' + esc(b[0]) + '</dt><dd>' + esc(b[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  /** The surface scrolls itself (like every tab view); each page starts at the top. */
  function resetScroll() {
    var host = root();
    if (host) host.scrollTop = 0;
  }

  function focusTitle() {
    var t = doc.getElementById('assess-title');
    if (t) { try { t.focus(); } catch (e) { /* not focusable */ } }
  }

  // ══ CLIENT VIEW ═══════════════════════════════════════════════════════════

  function renderClientView() {
    var host = bodyHost();
    if (!host) return;
    var d = S.def;
    var h = '';

    if (!d) {
      host.innerHTML = S.err
        ? '<p class="assess-empty">This assessment could not be loaded. '
          + 'Go back and try again.</p>'
        : '<p class="assess-quiet" role="status">Loading…</p>';
      return;
    }

    var av = d.availability || {};

    h += '<section class="assess-card" aria-labelledby="assess-about-h">';
    h += '<div class="assess-card__head">';
    h += '<h2 id="assess-about-h">About this assessment</h2>';
    h += '<span class="assess-badge assess-badge--' + esc(av.state || 'unknown') + '">'
      + esc(availabilityLabel(av)) + '</span>';
    h += '</div>';
    if (d.description) h += '<p>' + esc(d.description) + '</p>';
    h += renderAttribution(d);
    if (av.summary) h += '<p class="assess-quiet">' + esc(av.summary) + '</p>';
    if (av.reason) h += '<p class="assess-notice assess-notice--warn">' + esc(av.reason) + '</p>';
    h += '</section>';

    // Actions. Every one is gated on what the SERVER said is possible, so a
    // switched-off module or a missing source never produces a dead button.
    h += '<section class="assess-card" aria-labelledby="assess-do-h">';
    h += '<h2 id="assess-do-h">Actions</h2>';
    h += '<div class="assess-actions">';
    if (av.canStart) {
      h += '<button type="button" class="assess-btn assess-btn--primary" data-assess="start">'
        + 'Start assessment</button>';
    }
    if (av.canDownloadBlank) {
      h += '<button type="button" class="assess-btn" data-assess="blank" data-mode="download">'
        + 'Download blank form</button>';
      h += '<button type="button" class="assess-btn" data-assess="blank" data-mode="print">'
        + 'Print blank form</button>';
      h += '<button type="button" class="assess-btn" data-assess="share-blank">'
        + 'Email / share blank form</button>';
    }
    if (d.capabilities && d.capabilities.upload && av.canDownloadBlank) {
      h += '<button type="button" class="assess-btn" data-assess="upload">'
        + 'Upload completed form</button>';
    }
    h += '</div>';
    if (!av.canStart && !av.canDownloadBlank) {
      h += renderMissingSources(d);
    }
    h += '</section>';

    h += renderShare();
    h += renderHistory();

    host.innerHTML = h;

    // The instrument module supplies the method chooser and the upload form for
    // its own document set; mounting it here gives it a place to render those
    // without this file knowing what a WHO administration method is.
    mountInstrumentClientTools();
  }

  function renderAttribution(d) {
    var a = d.attribution || {};
    var rows = [];
    if (a.rightsHolder) rows.push(['Rights holder', a.rightsHolder]);
    if (d.edition) rows.push(['Version', d.edition]);
    if (a.sourceTitle) rows.push(['Source', a.sourceTitle]);
    if (a.copyright) rows.push(['Copyright', a.copyright]);
    if (!rows.length) return '';
    return '<dl class="assess-kv">' + rows.map(function (r) {
      return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
    }).join('') + '</dl>';
  }

  /**
   * What is actually missing, named. The state this replaces said only
   * "awaiting human confirmation", which told a clinician nothing they could
   * act on and applied equally to instruments we hold in full.
   */
  function renderMissingSources(d) {
    var missing = (d.availability && d.availability.missingSources) || d.missingSources || [];
    if (!missing.length) return '';
    return '<div class="assess-missing">'
      + '<h3>What is needed before this can be administered</h3>'
      + '<ul>' + missing.map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') + '</ul>'
      + '<p class="assess-quiet">Supply these and the assessment becomes available here '
      + 'without any further change to the portal.</p>'
      + '</div>';
  }

  function renderHistory() {
    var h = '<section class="assess-card" aria-labelledby="assess-hist-h">';
    h += '<h2 id="assess-hist-h">Assessment history</h2>';

    var rows = (S.records || []).filter(function (r) {
      return !S.key || r.assessmentKey === S.key;
    });

    if (S.loading) return h + '<p class="assess-quiet" role="status">Loading history…</p></section>';
    // Could-not-load and genuinely-empty are different facts and must never
    // render as the same sentence.
    if (S.recordsErr) {
      return h + '<div class="assess-notice assess-notice--error" role="alert">'
        + 'This client’s assessment history could not be loaded, so what is shown here may be '
        + 'incomplete. ' + esc(S.recordsErr) + '</div></section>';
    }
    if (!rows.length) {
      // Scoped to this instrument: the client may well have records of others.
      return h + '<p class="assess-empty">No '
        + esc((S.def && S.def.abbreviation) || 'assessments of this kind')
        + ' assessments have been recorded for this client yet.</p></section>';
    }

    h += '<table class="assess-table"><thead><tr>'
      + '<th scope="col">Date</th><th scope="col">Clinician</th>'
      + '<th scope="col">Administration</th><th scope="col">Status</th>'
      + '<th scope="col">Score</th><th scope="col"><span class="assess-sr">Actions</span></th>'
      + '</tr></thead><tbody>';

    rows.forEach(function (r) {
      h += '<tr>';
      h += '<td>' + esc(fmtDate(r.completedAt || r.startedAt)) + '</td>';
      h += '<td>' + esc(r.completedByName || r.startedByName || '—') + '</td>';
      h += '<td>' + esc(methodLabel(r.administrationMethod)) + '</td>';
      h += '<td><span class="assess-status assess-status--' + esc(r.status) + '">'
        + esc(statusLabel(r.status)) + '</span>'
        + (r.completionSource === 'uploaded'
          ? '<span class="assess-note">Completed on paper</span>' : '')
        + '</td>';

      h += '<td>';
      if (r.overallScore !== null && r.overallScore !== undefined) {
        // The number never travels without the method that produced it.
        h += esc(String(r.overallScore)) + ' <small>/ 100</small>'
          + '<span class="assess-note">' + esc(r.overallScoreLabel || '') + '</span>';
      } else {
        h += '—';
      }
      h += '</td>';

      h += '<td class="assess-row-actions">'
        + '<button type="button" class="assess-btn assess-btn--small" data-assess="open-record" '
        + 'data-id="' + esc(r.id) + '">'
        + (r.status === 'draft' ? 'Continue' : 'View') + '</button>';
      if (r.status === 'draft') {
        // Only a draft can be deleted. A completed assessment is a filed
        // clinical record; the server refuses, so the button is never offered.
        h += '<button type="button" class="assess-btn assess-btn--small assess-btn--danger" '
          + 'data-assess="delete-record" data-id="' + esc(r.id) + '">Delete</button>';
      }
      if (r.hasDocument) {
        h += '<button type="button" class="assess-btn assess-btn--small" data-assess="doc" '
          + 'data-id="' + esc(r.id) + '" data-mode="download">PDF</button>';
      }
      h += '</td>';
      h += '</tr>';
    });

    return h + '</tbody></table></section>';
  }

  // ══ RECORD VIEW ═══════════════════════════════════════════════════════════

  /**
   * The record page.
   *
   * The form host is built ONCE per record and never rebuilt while that record
   * is open. Everything else on this view — the heading, the action bar, the
   * share panel — updates in place. Re-rendering the body wholesale would
   * destroy the mounted form, and with it any response the clinician had
   * entered since the last autosave.
   */
  var mountedFor = null;

  function renderRecordView() {
    var host = bodyHost();
    if (!host) return;

    if (mountedFor !== S.recordId || !doc.getElementById('assess-form-host')) {
      host.innerHTML =
        '<section class="assess-card assess-card--flush" aria-labelledby="assess-form-h">'
        + '<div class="assess-card__head">'
        + '<h2 id="assess-form-h">Assessment</h2>'
        + '<div class="assess-actions assess-actions--inline" id="assess-record-actions"></div>'
        + '</div>'
        + '<div id="assess-form-host" class="assess-form-host"></div>'
        + '</section>'
        + '<div id="assess-share-slot"></div>';
      mountedFor = S.recordId;
      renderRecordActions();
      mountInstrumentRecord();
      renderShareSlot();
      return;
    }

    renderRecordActions();
    renderShareSlot();
  }

  function renderRecordActions() {
    var head = doc.getElementById('assess-form-h');
    var bar = doc.getElementById('assess-record-actions');
    if (!head || !bar) return;
    var r = S.record;

    head.textContent = r && r.status === 'draft' ? 'Complete the assessment' : 'Completed assessment';

    if (!r || r.status === 'draft') { bar.innerHTML = ''; return; }

    var h = '';
    if (r.hasDocument) {
      h += '<button type="button" class="assess-btn assess-btn--small" data-assess="doc" '
        + 'data-id="' + esc(r.id) + '" data-mode="download">Download PDF</button>';
      h += '<button type="button" class="assess-btn assess-btn--small" data-assess="doc" '
        + 'data-id="' + esc(r.id) + '" data-mode="print">Print</button>';
    }
    h += '<button type="button" class="assess-btn assess-btn--small" data-assess="share-record" '
      + 'data-id="' + esc(r.id) + '">Email / share</button>';
    bar.innerHTML = h;
  }

  function renderShareSlot() {
    var slot = doc.getElementById('assess-share-slot');
    if (!slot) return;
    slot.innerHTML = renderShare();
  }

  // ══ SHARE ═════════════════════════════════════════════════════════════════

  /**
   * The prepared message, shown for review. It is never sent from here: the
   * portal has no approved clinical mail transport, and the server says so in
   * `delivery.instruction` rather than this file assuming it.
   */
  function renderShare() {
    if (!S.share && !S.shareBusy) return '';
    var h = '<section class="assess-card assess-share" aria-labelledby="assess-share-h">';
    h += '<div class="assess-card__head"><h2 id="assess-share-h">Email / share — review before sending</h2>'
      + '<button type="button" class="assess-btn assess-btn--small" data-assess="share-close">Close</button></div>';

    if (S.shareBusy) return h + '<p class="assess-quiet" role="status">Preparing…</p></section>';

    var s = S.share;
    (s.notices || []).forEach(function (n) {
      h += '<p class="assess-notice assess-notice--warn">' + esc(n) + '</p>';
    });

    h += '<div class="assess-field"><label for="assess-share-subject">Subject</label>'
      + '<input id="assess-share-subject" class="assess-input" type="text" value="' + esc(s.subject) + '"></div>';
    h += '<div class="assess-field"><label for="assess-share-body">Message</label>'
      + '<textarea id="assess-share-body" class="assess-input assess-textarea" rows="12">'
      + esc(s.body) + '</textarea></div>';

    if (s.attachment) {
      h += '<p class="assess-quiet">Attachment: <strong>' + esc(s.attachment.filename) + '</strong></p>';
    }
    h += '<p class="assess-notice">' + esc(s.delivery ? s.delivery.instruction : '') + '</p>';

    h += '<div class="assess-actions">';
    h += '<button type="button" class="assess-btn" data-assess="share-copy">Copy message</button>';
    if (s.attachment) {
      h += '<button type="button" class="assess-btn assess-btn--primary" data-assess="share-download">'
        + 'Download the attachment</button>';
    }
    h += '</div>';
    h += '<p class="assess-quiet" id="assess-share-state" role="status" aria-live="polite"></p>';
    return h + '</section>';
  }

  function prepareShare(path, body) {
    S.shareBusy = true; S.share = null;
    renderView();
    return api(path, { method: 'POST', body: body || {} })
      .then(function (data) {
        S.shareBusy = false;
        S.share = data.share;
        renderView();
        var el = doc.getElementById('assess-share-subject');
        if (el) el.focus();
      })
      .catch(function (err) {
        S.shareBusy = false;
        S.share = null;
        S.err = err.message || 'The message could not be prepared.';
        renderChrome();
        renderView();
      });
  }

  function copyShare() {
    var subject = doc.getElementById('assess-share-subject');
    var bodyEl = doc.getElementById('assess-share-body');
    var state = doc.getElementById('assess-share-state');
    if (!subject || !bodyEl) return;
    var text = subject.value + '\n\n' + bodyEl.value;
    var done = function (ok) {
      if (state) state.textContent = ok ? 'Copied. Paste it into your mail client.' : 'Copy failed — select the text and copy it manually.';
    };
    if (global.navigator && global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(false); });
      return;
    }
    bodyEl.select();
    done(false);
  }

  // ══ INSTRUMENT MODULES ════════════════════════════════════════════════════

  /**
   * The registry. An instrument plugs into this surface by exposing three
   * functions; nothing else about it is known here. WHODAS is the only entry
   * today because it is the only instrument whose authoritative source ships
   * with the application.
   */
  var MODULES = {
    whodas: function () {
      var m = global.WHODAS;
      if (!m || typeof m.mountClientTools !== 'function') return null;
      return m;
    },
  };

  /**
   * Which module implements which assessment. The server says so in the
   * catalogue entry; this map is the fallback for when the catalogue could not
   * be reached, so a saved link to an assessment record still opens instead of
   * reporting the instrument missing because a metadata request failed.
   */
  var MODULE_BY_KEY = { 'whodas-2.0-36': 'whodas' };

  function moduleFor(def) {
    var name = (def && def.module) || MODULE_BY_KEY[S.key] || null;
    if (!name || !MODULES[name]) return null;
    return MODULES[name]();
  }

  function mountInstrumentClientTools() {
    var m = moduleFor(S.def);
    if (!m) return;
    try { m.mountClientTools({ clientId: S.clientId, clientName: S.clientName, onChange: reloadRecords }); }
    catch (e) { /* the surface still renders without the instrument's own tools */ }
  }

  function unmountInstrument() {
    var m = moduleFor(S.def);
    if (m && typeof m.unmount === 'function') { try { m.unmount(); } catch (e) {} }
    S.formMounted = false;
    mountedFor = null;
  }

  function mountInstrumentRecord() {
    var m = moduleFor(S.def);
    var host = doc.getElementById('assess-form-host');
    if (!host) return;
    if (!m || typeof m.mountRecord !== 'function') {
      host.innerHTML = '<p class="assess-notice assess-notice--warn">'
        + 'This assessment cannot be displayed here: its module is not available in this environment.</p>';
      return;
    }
    S.formMounted = true;
    m.mountRecord(host, S.recordId, {
      onRecord: function (rec) {
        // The module owns the record; the frame only mirrors its context line.
        S.record = Object.assign({}, S.record || {}, rec);
        if (rec && rec.clientId && !S.clientId) S.clientId = rec.clientId;
        if (rec && rec.clientName && !S.clientName) S.clientName = rec.clientName;
        // Unconditional: the record knows which instrument it is, and a
        // restored address only guessed. Back must target the real one.
        if (rec && rec.assessmentKey) S.key = rec.assessmentKey;
        renderChrome();
        renderRecordView();
      },
      onExit: goBack,
      // An amendment supersedes this record with a new one, which has its own
      // address. The module asks for the move; the frame performs it.
      onNavigate: function (rec) {
        if (!rec || !rec.id) return undefined;
        return loadRecords().then(function () {
          return openRecord(rec.id, { key: S.key, clientId: S.clientId, clientName: S.clientName });
        });
      },
      onChange: reloadRecords,
      onError: function (message) {
        S.err = message || 'The assessment could not be opened.';
        renderChrome();
        renderRecordView();
      },
    });
  }

  // ══ LOADING ═══════════════════════════════════════════════════════════════

  function loadDefinition(key) {
    if (S.def && S.def.key === key) return Promise.resolve(S.def);
    return api('/catalogue/' + encodeURIComponent(key)).then(function (d) {
      S.def = d.assessment;
      return S.def;
    });
  }

  /**
   * The client's assessment history.
   *
   * A failure here is never allowed to read as "there is nothing". Swallowing
   * it meant a 403, a missing organisation or a network blip all rendered as
   * the affirmative clinical claim "No assessments have been recorded for this
   * client yet" — which a clinician could reasonably act on.
   */
  function loadRecords() {
    if (!S.clientId) { S.records = []; S.recordsErr = ''; return Promise.resolve([]); }
    return api('/clients/' + encodeURIComponent(S.clientId) + '/records')
      .then(function (d) { S.records = d.records || []; S.recordsErr = ''; return S.records; })
      .catch(function (err) {
        S.records = [];
        S.recordsErr = err.message || 'The assessment history could not be loaded.';
        return [];
      });
  }

  function reloadRecords() {
    return loadRecords().then(function () { if (S.view === 'client') renderClientView(); });
  }

  function renderView() {
    if (!S.open) return;
    renderChrome();
    if (S.view === 'client') renderClientView();
    else if (S.view === 'record') renderRecordView();
  }

  // ══ OPEN / CLOSE ══════════════════════════════════════════════════════════

  /**
   * One client's assessments for one instrument. This is where "Start
   * assessment" from the Assessments tab lands after a client is chosen — a
   * full page about the assessment, not the client profile drawer.
   */
  function openForClient(key, clientId, clientName) {
    if (!key || !clientId) return Promise.resolve();
    if (!S.open) lastFocus = doc.activeElement;
    // Leaving a record: the instrument module must let go of its host before
    // the body is rebuilt, or an autosave could fire into a detached form.
    if (S.view === 'record') unmountInstrument();
    S.open = true;
    S.view = 'client';
    S.key = key;
    S.clientId = String(clientId);
    S.clientName = clientName || S.clientName || null;
    S.recordId = null;
    S.record = null;
    S.share = null;
    S.err = '';
    S.recordsErr = '';
    S.loading = true;
    S.formMounted = false;

    renderChrome();
    publishRoute();
    focusTitle();
    resetScroll();

    return Promise.all([loadDefinition(key), loadRecords()])
      .then(function () {
        S.loading = false;
        // A restored '#assessment/client/:id' carries no name. The portal
        // already holds the roster, so ask it rather than showing a bare
        // Splose id where the client's name belongs.
        if (!S.clientName && typeof global.clientNameById === 'function') {
          try { S.clientName = global.clientNameById(S.clientId) || null; } catch (e) {}
        }
        renderView();
      })
      .catch(function (err) {
        S.loading = false;
        S.err = err.message || 'This assessment could not be loaded.';
        renderView();
      });
  }

  /**
   * One assessment record: the form when it is a draft, the results profile
   * when it is completed. A dedicated page, always.
   */
  function openRecord(recordId, opts) {
    if (!recordId) return Promise.resolve();
    var o = opts || {};
    if (!S.open) lastFocus = doc.activeElement;
    // Moving between records (an amendment, or picking another from history)
    // releases the previous form before the next one mounts.
    if (S.view === 'record' && String(S.recordId) !== String(recordId)) unmountInstrument();
    S.open = true;
    S.view = 'record';
    S.recordId = String(recordId);
    S.share = null;
    S.err = '';
    S.formMounted = false;

    var known = (S.records || []).filter(function (r) { return String(r.id) === String(recordId); })[0];
    S.record = known || o.record || null;
    if (S.record) {
      S.key = S.record.assessmentKey || S.key;
      if (S.record.clientId) S.clientId = String(S.record.clientId);
    }
    if (o.clientId) S.clientId = String(o.clientId);
    if (o.clientName) S.clientName = o.clientName;
    if (o.key) S.key = o.key;

    S.loading = !S.def;
    renderChrome();
    publishRoute();
    focusTitle();
    resetScroll();

    // The record's own module supplies the authoritative record; the catalogue
    // entry only supplies chrome, so a slow catalogue never delays the form.
    var defKey = S.key || 'whodas-2.0-36';
    // Seed S.key BEFORE anything renders or mounts. Restoring a bookmarked
    // #assessment/record/:id calls openRecord(id) with no options, so without
    // this S.key stayed null for the life of the view — which left Back a
    // no-op (openForClient refuses a null key) and stopped MODULE_BY_KEY from
    // ever supplying the module fallback it exists for.
    if (!S.key) S.key = defKey;
    return loadDefinition(defKey)
      .catch(function () { return null; })
      .then(function () {
        S.loading = false;
        renderView();
        if (S.clientId && !(S.records || []).length) loadRecords();
      });
  }

  function close() {
    if (!S.open) return;
    unmountInstrument();
    S.open = false;
    S.view = null;
    S.recordId = null;
    S.record = null;
    S.share = null;
    S.formMounted = false;
    renderChrome();
    if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { /* gone */ } }
    lastFocus = null;
  }

  // ══ EVENTS ════════════════════════════════════════════════════════════════

  doc.addEventListener('click', function (e) {
    var t = e.target.closest && e.target.closest('[data-assess]');
    if (!t || !root() || !root().contains(t)) return;
    var action = t.getAttribute('data-assess');

    if (action === 'back') return goBack();

    if (action === 'open-record') {
      return openRecord(t.getAttribute('data-id'), { key: S.key, clientId: S.clientId, clientName: S.clientName });
    }

    if (action === 'start' || action === 'blank' || action === 'upload') {
      // Administration-method choice and the upload form belong to the
      // instrument: only it knows which official forms exist.
      var m = moduleFor(S.def);
      if (!m) return undefined;
      if (action === 'start' && typeof m.startAssessment === 'function') {
        return m.startAssessment({
          clientId: S.clientId,
          clientName: S.clientName,
          onStarted: function (rec) {
            return loadRecords().then(function () {
              return openRecord(rec.id, { key: S.key, clientId: S.clientId, clientName: S.clientName });
            });
          },
        });
      }
      if (action === 'blank' && typeof m.blankForm === 'function') {
        return m.blankForm(t.getAttribute('data-mode') === 'print' ? 'print' : 'download');
      }
      if (action === 'upload' && typeof m.uploadCompleted === 'function') {
        return m.uploadCompleted({
          clientId: S.clientId, clientName: S.clientName, onUploaded: reloadRecords,
        });
      }
      return undefined;
    }

    if (action === 'delete-record') {
      var mdel = moduleFor(S.def);
      if (mdel && typeof mdel.deleteDraft === 'function') {
        return mdel.deleteDraft(t.getAttribute('data-id'), { onDeleted: reloadRecords });
      }
      return undefined;
    }

    if (action === 'doc') {
      var m2 = moduleFor(S.def);
      if (m2 && typeof m2.openDocument === 'function') {
        return m2.openDocument(t.getAttribute('data-id'),
          t.getAttribute('data-mode') === 'print' ? 'print' : 'download');
      }
      return undefined;
    }

    if (action === 'share-blank') {
      return prepareShare('/catalogue/' + encodeURIComponent(S.key) + '/share', {});
    }
    if (action === 'share-record') {
      return prepareShare('/records/' + encodeURIComponent(t.getAttribute('data-id')) + '/share', {});
    }
    if (action === 'share-close') { S.share = null; renderView(); return undefined; }
    if (action === 'share-copy') return copyShare();
    if (action === 'share-download') {
      var s = S.share;
      if (s && s.attachment && s.attachment.downloadPath) {
        // A plain navigation to an authenticated endpoint. Nothing clinical is
        // ever put in a query string and no shareable URL is produced.
        global.location.href = s.attachment.downloadPath;
      }
      return undefined;
    }

    return undefined;
  });

  // ══ PORTAL NAVIGATION ═════════════════════════════════════════════════════

  /*
     The surface lives in the portal shell: the header and nav tabs stay
     visible above it (see assessment.css). That means the user can press a
     nav tab while an assessment is open — and while the page is up, the
     active tab view is display:none, so switching tabs without closing the
     surface would land on a blank screen. Wrapping switchTab (the same
     self-installing pattern navigation.js and mockup_v3.html's own patches
     use) closes the surface first. Nothing is lost by leaving this way: the
     form autosaves, and the draft is on the client's list to resume.
  */
  function hookSwitchTab() {
    var orig = global.switchTab;
    if (typeof orig !== 'function' || orig.__assessHooked) return;
    var wrapped = function () {
      if (S.open) { try { close(); } catch (e) { /* leaving must never block nav */ } }
      return orig.apply(this, arguments);
    };
    wrapped.__assessHooked = true;
    global.switchTab = wrapped;
  }

  // switchTab is defined by the shell's inline script, which runs before any
  // deferred module; other modules wrap it later, and every layer calls
  // through, so order does not matter. Retried briefly all the same, because
  // this file must work wherever the integrator puts the <script> line.
  (function retryHook(attempt) {
    hookSwitchTab();
    if (global.switchTab && global.switchTab.__assessHooked) return;
    if ((attempt || 0) < 40) setTimeout(function () { retryHook((attempt || 0) + 1); }, 150);
  })(0);

  // ══ PUBLIC SURFACE ════════════════════════════════════════════════════════

  global.Assess = {
    openForClient: openForClient,
    openRecord: openRecord,
    close: close,
    back: goBack,
    reload: reloadRecords,
    _state: S,
    _helpers: helpers,
  };

})(typeof window !== 'undefined' ? window : null);
