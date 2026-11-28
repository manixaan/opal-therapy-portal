/**
 * Opal Assist — Plan reviews (the plan review radar). No framework.
 *
 * "Plan reviews" in the Assist sidebar lists the caller's clients whose NDIS
 * plan (their open Splose case) ends in the next 8 weeks, or ended in the
 * last 2: how much of the funding is used against how much of the plan's
 * time has gone, whether a progress report is started, and how many of
 * your notes the plan has. "Start report" opens that client's chat and the
 * Report builder already set to the plan's dates.
 *
 * Reads GET /api/assist/plan-reviews only (caseload-scoped, no model call).
 * Nothing is stored in the browser. Pure helpers are exported for node tests.
 */
(function (global) {
  'use strict';

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function dayLabel(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
    return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : '';
  }

  /** "in 3 weeks", "in 5 days", "today", "ended 4 days ago". */
  function whenLabel(days) {
    if (days === 0) return 'ends today';
    if (days < 0) return 'ended ' + (-days) + (days === -1 ? ' day' : ' days') + ' ago';
    if (days < 14) return 'in ' + days + (days === 1 ? ' day' : ' days');
    return 'in ' + Math.round(days / 7) + ' weeks';
  }

  function money(n) { return '$' + Math.round(n).toLocaleString('en-AU'); }

  /** One line about the funding, in words. */
  function fundingLine(f) {
    if (!f || !f.available) return 'Funding used: Splose invoices could not be read just now.';
    if (f.allowed == null || f.used == null) {
      return f.track ? 'Tracked by ' + String(f.track).toLowerCase() + ' in Splose, with no allowance set on the case.' : 'No budget, hours or appointment limit is set on the Splose case.';
    }
    var used = f.unit === '$' ? money(f.used) + ' of ' + money(f.allowed) : (Math.round(f.used * 10) / 10) + ' of ' + f.allowed + ' ' + f.unit;
    return used + ' used (' + f.pct + '%)' + (f.timePct != null ? ' · ' + f.timePct + '% of the plan\'s time gone' : '');
  }

  var PACE = {
    over: ['bad', 'Allowance used up'],
    fast: ['warn', 'Using funds faster than time'],
    slow: ['warn', 'Underused — funds may be left'],
    on_track: ['ok', 'On track'],
    unknown: ['', ''],
  };
  function paceBadge(p) { return PACE[p] || PACE.unknown; }

  /** Rows needing attention first are already soonest-first from the server; the count is what the button shows. */
  function buttonLabel(n) { return n > 0 ? 'Plan reviews · ' + n : 'Plan reviews'; }

  /** The Report builder's period for this plan: plan start (or 6 months back) to today, never past the plan end. */
  function reportPeriod(row, todayIso) {
    var to = row.planEnd && row.planEnd < todayIso ? row.planEnd : todayIso;
    var from = row.planStart && row.planStart <= to ? row.planStart : null;
    return from ? { from: from, to: to } : null;
  }

  var api = { dayLabel: dayLabel, whenLabel: whenLabel, fundingLine: fundingLine, paceBadge: paceBadge, buttonLabel: buttonLabel, reportPeriod: reportPeriod };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (!global.document) { global.OpalAssistPlanRadar = api; return; }

  function call(fetcher) {
    return fetcher('/api/assist/plan-reviews').then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || 'Plan reviews could not be loaded just now.'); return j; });
    });
  }
  function count(fetcher) { return call(fetcher).then(function (j) { return (j.rows || []).length; }, function () { return null; }); }

  function todayIso() {
    var p = new Date(Date.now() + 8 * 3600000);
    return p.getUTCFullYear() + '-' + String(p.getUTCMonth() + 1).padStart(2, '0') + '-' + String(p.getUTCDate()).padStart(2, '0');
  }

  function close() { var el = document.getElementById('oa-pr'); if (el) el.remove(); }

  /** opts: { api, onCount(n), startReport(row, period) } */
  function open(opts) {
    close();
    var el = document.createElement('div');
    el.className = 'oa-cf-backdrop'; el.id = 'oa-pr';
    el.innerHTML = '<div class="oa-cf oa-pr" role="dialog" aria-modal="true" aria-labelledby="oa-pr-title">'
      + '<div class="oa-cf-head"><h2 id="oa-pr-title">Plan reviews</h2><button type="button" class="oa-btn ghost sm" data-pr="close" aria-label="Close">×</button></div>'
      + '<p class="oa-cf-lede">NDIS plans (open Splose cases) ending in the next 8 weeks: funding used, and whether the progress report is under way.</p>'
      + '<div class="oa-cf-body" id="oa-pr-body"><div class="oa-cf-empty">Loading…</div></div></div>';
    document.body.appendChild(el);
    var body = el.querySelector('#oa-pr-body');
    var rows = [];

    function render(j) {
      rows = j.rows || [];
      if (opts.onCount) opts.onCount(rows.length);
      if (!rows.length) { body.innerHTML = '<div class="oa-no-done">No plans end in the next ' + Math.round((j.windowDays || 56) / 7) + ' weeks.</div>'; return; }
      body.innerHTML = (j.fundingAvailable ? '' : '<div class="oa-cf-empty bad">Splose invoices could not be read just now, so funding used is not shown.</div>')
        + '<ul class="oa-pr-list">' + rows.map(function (r, i) {
          var f = r.funding || {}; var badge = paceBadge(f.pace);
          var bar = f.pct != null ? '<div class="oa-pr-bar" role="img" aria-label="' + esc(f.pct + '% used, ' + (f.timePct != null ? f.timePct + '% of the time gone' : '')) + '"><span class="used ' + esc(badge[0]) + '" style="width:' + Math.min(100, f.pct) + '%"></span>'
            + (f.timePct != null ? '<i style="left:' + f.timePct + '%"></i>' : '') + '</div>' : '';
          var report = r.report && r.report.started
            ? '<li class="done">Progress report started ' + esc(dayLabel(String(r.report.startedAt).slice(0, 10))) + ' — in Resources → Templates</li>'
            : '<li>Progress report not started</li>';
          return '<li class="oa-pr-item' + (r.daysLeft < 0 ? ' ended' : '') + '">'
            + '<div class="oa-pr-top"><b>' + esc(r.clientName || 'Client') + '</b><span class="oa-pr-when">' + esc(dayLabel(r.planEnd)) + ' · ' + esc(whenLabel(r.daysLeft)) + '</span></div>'
            + '<small>' + (r.caseNumber ? 'Case ' + esc(r.caseNumber) + ' · ' : '') + 'from ' + esc(dayLabel(r.planStart) || 'unknown') + (r.planEndSource === 'billing_profile' ? ' · end date from the billing profile' : '') + '</small>'
            + bar
            + '<div class="oa-pr-fund">' + esc(fundingLine(f)) + (badge[1] ? ' <span class="oa-pr-pace ' + esc(badge[0]) + '">' + esc(badge[1]) + '</span>' : '') + (f.approximate ? ' <span class="oa-pr-note">before discounts</span>' : '') + '</div>'
            + '<ul class="oa-pr-check">' + report + '<li' + (r.notesThisPlan ? ' class="done"' : '') + '>' + r.notesThisPlan + (r.notesThisPlan === 1 ? ' case note' : ' case notes') + ' of yours this plan</li></ul>'
            + '<div class="oa-pr-actions"><button type="button" class="oa-btn ' + (r.report && r.report.started ? 'ghost' : 'primary') + ' sm" data-pr="report" data-i="' + i + '">' + (r.report && r.report.started ? 'Draft again' : 'Start report') + '</button></div>'
            + '</li>';
        }).join('') + '</ul>'
        + '<p class="oa-cf-note">Funding used adds up the Splose invoice lines for this case\'s appointments and activities, plus portal invoices in the plan. Booked but not yet invoiced sessions are not counted.</p>';
    }

    call(opts.api).then(render, function (err) { body.innerHTML = '<div class="oa-cf-empty bad">' + esc(err.message) + '</div>'; });

    el.addEventListener('click', function (e) {
      if (e.target === el) return close();
      var b = e.target.closest('[data-pr]'); if (!b) return;
      if (b.dataset.pr === 'close') close();
      else if (b.dataset.pr === 'report') {
        var r = rows[+b.dataset.i]; if (!r) return;
        close();
        opts.startReport(r, reportPeriod(r, todayIso()));
      }
    });
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  }

  api.open = open; api.close = close; api.count = count;
  global.OpalAssistPlanRadar = api;
})(typeof window !== 'undefined' ? window : globalThis);
