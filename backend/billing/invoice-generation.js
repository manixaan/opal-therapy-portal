'use strict';

/**
 * INVOICE GENERATION — "Complete invoicing" and "Generate Trip Invoices".
 *
 *   calendar events → eligibility → billing profile (payer, NDIS no., MMM)
 *   → rate card on the service date → session lines
 *   → practitioner-day route (day-route) + persisted route facts
 *   → travel allocation (travel-billing) → travel lines
 *   → group by client + payer → draft invoices
 *
 * Two phases:
 *   A. PREPARE (pool, no transaction): read events, create stub profiles,
 *      classify MMM (may geocode), resolve route facts (may call Google once
 *      per new route). All network work happens here.
 *   B. COMMIT (one transaction + per-organisation advisory lock): claims,
 *      lines, invoices, allocations, issues, audit. Two concurrent runs
 *      serialise on the lock, and the partial unique index on
 *      invoice_lines(calendar_event_id, component) makes a duplicate claim
 *      impossible even if the lock were bypassed.
 *
 * Idempotency: a component already claimed on a finalised invoice is skipped
 * and counted; one claimed on a draft is recalculated in place (unless the
 * owner overrode it or removed it); nothing is ever claimed twice.
 */

const { pool: defaultPool } = require('../database');
const M = require('./money');
const S = require('./session-billing');
const RC = require('./rate-cards');
const BP = require('./billing-profiles');
const MMM = require('./mmm-classification');
const T = require('./travel-billing');
const DR = require('./day-route');
const RF = require('./route-facts');
const Settings = require('./billing-settings');
const Issues = require('./billing-issues');
const { recordAudit } = require('./billing-audit');

const OPEN_STATUSES = ['DRAFT', 'NEEDS_ATTENTION'];
const RECIPIENT_ISSUES = new Set(['CLIENT_MISSING_PAYER', 'NDIS_NUMBER_MISSING']);

function ymd(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  return new Date(v).toISOString().slice(0, 10);
}

function validRange(from, to) {
  return /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '') && from <= to;
}

// ── Phase A ────────────────────────────────────────────────────────────────

async function loadCandidateEvents(q, orgId, { from, to, practitionerIds, clientIds, eventIds, tz }) {
  const params = [orgId, from, to, tz];
  const where = [
    'u.organisation_id = $1',
    `((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
    'COALESCE(e.is_deleted, FALSE) = FALSE',
    `(e.event_type = 'therapy' OR (e.event_type = 'outlook' AND e.client_id IS NOT NULL))`,
  ];
  if (practitionerIds && practitionerIds.length) { params.push(practitionerIds); where.push(`e.user_id = ANY($${params.length}::uuid[])`); }
  if (clientIds && clientIds.length) { params.push(clientIds); where.push(`e.client_id = ANY($${params.length}::text[])`); }
  if (eventIds && eventIds.length) { params.push(eventIds); where.push(`e.id = ANY($${params.length}::uuid[])`); }
  const { rows } = await q.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.location, e.manual_location, e.event_type,
            e.status, e.client_id, e.client_name, e.is_teams_meeting, e.is_deleted, e.custom_metadata,
            to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date,
            COALESCE(tp.display_name, u.name) AS practitioner_name,
            u.work_location_schedule, u.default_work_location,
            ceb.attendance
       FROM events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY e.user_id, e.start_time`, params);
  return rows;
}

/**
 * Evaluate everything that needs no transaction. Returns a plan the commit
 * phase applies. Exposed for tests and for a future "preview" endpoint.
 */
async function prepare(q, orgId, opts) {
  const now = opts.now || new Date();
  const settings = await Settings.ensureSettings(q, orgId);
  await RC.ensureDefaultRateCard(q, orgId);
  const tz = settings.timezone || 'Australia/Perth';
  const events = await loadCandidateEvents(q, orgId, { ...opts, tz });
  const issues = new Issues.IssueCollector();
  const summary = {
    eventsExamined: events.length, skipped: {}, sessionsIncluded: 0, travelAllocations: 0,
    alreadyInvoiced: 0, excludedByOwner: 0, invoicesCreated: 0, invoicesUpdated: 0,
    itemsNeedAttention: 0, linesAdded: 0, linesUpdated: 0, totalCents: 0,
  };

  // 1. Event-level eligibility
  const evaluated = events.map(ev => ({ ev, res: S.evaluateEvent(ev, { now, completionRule: settings.completionRule, hasLocation: !!DR.eventAddress(ev) }) }));
  for (const { ev, res } of evaluated) {
    if (res.state === 'SKIP') summary.skipped[res.reason] = (summary.skipped[res.reason] || 0) + 1;
    if (res.state === 'ISSUE') {
      for (const type of res.issues) {
        issues.raise(type, {
          eventId: ev.id, clientId: ev.client_id || null, practitionerId: ev.user_id, serviceDate: ev.local_date,
          message: issueMessage(type, ev), fixTarget: { kind: 'event', eventId: ev.id, date: ev.local_date },
        });
      }
    }
  }

  // 2. Profiles (stub on first sight), MMM classification (may geocode)
  const clientNames = new Map();
  for (const { ev, res } of evaluated) {
    if (res.state !== 'SKIP' && ev.client_id && !clientNames.has(ev.client_id)) clientNames.set(ev.client_id, ev.client_name);
  }
  await BP.ensureStubProfiles(q, orgId, [...clientNames].map(([clientId, clientName]) => ({ clientId, clientName })));
  const profiles = await BP.getProfilesByClient(q, orgId, [...clientNames.keys()]);
  for (const [cid, p] of profiles) profiles.set(cid, await MMM.ensureClassified(q, p));
  const cards = await RC.loadRateCards(q, orgId);

  // 3. Client-level checks + pricing per event
  const sessions = []; // billable or calc-blocked, not skipped
  for (const { ev, res } of evaluated) {
    if (res.state === 'SKIP') continue;
    const p = ev.client_id ? profiles.get(ev.client_id) : null;
    const entry = { ev, res, profile: p, blocked: res.state === 'ISSUE', recipientIssues: [] };
    if (p) {
      const mmm = MMM.effectiveMmm(p);
      entry.mmm = mmm;
      if (mmm == null) {
        entry.blocked = true;
        const type = !p.service_address ? 'CLIENT_ADDRESS_MISSING' : (p.mmm_zone && p.mmm_confidence === 'REVIEW' ? 'MMM_REVIEW' : 'MMM_UNRESOLVED');
        issues.raise(type, { clientId: ev.client_id, message: issueMessage(type, ev, p), fixTarget: { kind: 'client', clientId: ev.client_id } });
      } else {
        entry.rate = RC.resolveRule(cards, { serviceDate: ev.local_date, mmm, discipline: 'OT' });
        if (!entry.rate) {
          entry.blocked = true;
          issues.raise('RATE_UNAVAILABLE', { eventId: ev.id, clientId: ev.client_id, practitionerId: ev.user_id,
            serviceDate: ev.local_date, message: issueMessage('RATE_UNAVAILABLE', ev, p, mmm), fixTarget: { kind: 'rate_cards' } });
        }
      }
      entry.payer = BP.resolvePayer(p);
      if (!entry.payer) {
        entry.recipientIssues.push('CLIENT_MISSING_PAYER');
        issues.raise('CLIENT_MISSING_PAYER', { clientId: ev.client_id, message: issueMessage('CLIENT_MISSING_PAYER', ev, p), fixTarget: { kind: 'client', clientId: ev.client_id } });
      }
      if (BP.ndisNumberRequired(p) && !p.ndis_number) {
        entry.recipientIssues.push('NDIS_NUMBER_MISSING');
        issues.raise('NDIS_NUMBER_MISSING', { clientId: ev.client_id, message: issueMessage('NDIS_NUMBER_MISSING', ev, p), fixTarget: { kind: 'client', clientId: ev.client_id } });
      }
    }
    sessions.push(entry);
  }

  // 4. Travel: one route per practitioner-day over its in-person sessions
  const days = new Map();
  for (const s of sessions) {
    if (s.res.telehealth || !s.ev.client_id) continue;
    const key = `${s.ev.user_id}|${s.ev.local_date}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(s);
  }
  const dayPlans = [];
  const pairs = [];
  for (const [key, list] of days) {
    const [userId, date] = key.split('|');
    const blocked = list.filter(s => s.blocked);
    if (blocked.length) {
      for (const s of list.filter(x => !x.blocked)) {
        issues.raise('TRAVEL_DAY_DEFERRED', { eventId: s.ev.id, clientId: s.ev.client_id, practitionerId: userId, serviceDate: date,
          message: `Travel for ${S.displayDate(date)} (${s.ev.practitioner_name}) waits until the day's other ${blocked.length === 1 ? 'session is' : `${blocked.length} sessions are`} billable, so the day's travel is divided correctly.`,
          fixTarget: { kind: 'event', eventId: blocked[0].ev.id, date } });
      }
      continue;
    }
    const ordered = list.map(s => s.ev).sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    // Facts for a possible trip home decide between chaining and going back to base.
    const cand = DR.candidatePairs({ user: list[0].ev, date, sessions: ordered });
    const candFacts = await RF.resolveRouteFacts(q, orgId, cand);
    const minutesFor = (o, d2) => { const f = candFacts.get(RF.routeKey(o, d2)); return f && f.status === 'ok' ? f.minutes : null; };
    const route = DR.buildDayLegs({ user: list[0].ev, date, sessions: ordered, minutesFor });
    if (route.baseUnset) {
      issues.raise('WORK_LOCATION_NOT_SET', { practitionerId: userId, serviceDate: date, extraKey: userId,
        message: `No work location is set for ${list[0].ev.practitioner_name} on ${S.displayDate(date)}, so there is no start or return leg. Set it in My Profile → Work locations, then reprocess.`,
        fixTarget: { kind: 'work_location', userId, date } });
    }
    route.legs.forEach(l => pairs.push({ origin: l.origin, destination: l.destination }));
    dayPlans.push({ userId, date, list, route });
  }
  const facts = await RF.resolveRouteFacts(q, orgId, pairs);
  for (const d of dayPlans) {
    let failed = false;
    for (const leg of d.route.legs) {
      const f = facts.get(RF.routeKey(leg.origin, leg.destination));
      const needed = leg.kind !== 'RETURN' || settings.returnTravelPayable;
      if (f && f.status === 'ok') { leg.minutes = f.minutes; leg.km = f.km; leg.provider = f.provider; }
      else if (needed) {
        failed = true;
        issues.raise('TRAVEL_ROUTE_FAILED', { eventId: leg.toEventId || leg.fromEventId, practitionerId: d.userId, serviceDate: d.date, extraKey: leg.id,
          clientId: (d.list.find(s => s.ev.id === (leg.toEventId || leg.fromEventId)) || {}).ev?.client_id || null,
          message: `No route could be calculated for ${S.displayDate(d.date)}: ${leg.origin} → ${leg.destination}. Check both addresses or enter the route manually.`,
          fixTarget: { kind: 'route', origin: leg.origin, destination: leg.destination, date: d.date } });
      }
    }
    if (failed) { d.failed = true; continue; }
    d.allocation = T.allocateDay({
      practitionerId: d.userId, date: d.date, returnPayable: settings.returnTravelPayable, legs: d.route.legs,
      sessions: d.list.map(s => ({ eventId: s.ev.id, clientId: s.ev.client_id, mmm: s.mmm, rule: {
        travelRateCents: s.rate.travelRateCents, travelCapMinutesEachWay: s.rate.travelCapMinutesEachWay,
        vehicleRateCents: s.rate.vehicleRateCents, rateCardId: s.rate.card.id, rateCardVersion: s.rate.card.version } })),
    });
    for (const a of d.allocation.allocations) {
      const s = d.list.find(x => x.ev.id === a.eventId);
      s.travel = { allocation: a, legs: d.allocation.legs, dayPlan: d };
    }
  }

  return { settings, tz, now, sessions, issues, summary, profiles, dayPlans };
}

function issueMessage(type, ev, p, mmm) {
  const who = (p && p.participant_name) || (ev && ev.client_name) || 'Client';
  const when = ev && ev.local_date ? S.displayDate(ev.local_date) : '';
  switch (type) {
    case 'EVENT_NO_CLIENT': return `"${ev.title || 'Event'}" on ${when} has no client linked.`;
    case 'EVENT_NO_SERVICE_TYPE': return `${who}'s event on ${when} has no service type (not categorised as a Client Appointment).`;
    case 'INVALID_DURATION': return `${who}'s session on ${when} has an invalid duration.`;
    case 'EVENT_NO_LOCATION': return `${who}'s in-person session on ${when} has no location.`;
    case 'CLIENT_ADDRESS_MISSING': return `${who} has no service address, so the MMM zone cannot be determined.`;
    case 'MMM_REVIEW': return `${who}'s address sits near an MMM boundary (computed MM${p.mmm_zone}). Confirm or override the zone.`;
    case 'MMM_UNRESOLVED': return `${who}'s MMM zone could not be resolved from their address${p && p.mmm_review_reason ? ` (${p.mmm_review_reason.replace(/_/g, ' ')})` : ''}.`;
    case 'RATE_UNAVAILABLE': return `No active rate card covers MM${mmm} on ${when} for ${who}.`;
    case 'CLIENT_MISSING_PAYER': return `${who} has no invoice recipient (plan manager / payer). The draft will not be addressed until one is set.`;
    case 'NDIS_NUMBER_MISSING': return `${who} has no NDIS number on their billing profile.`;
    default: return type;
  }
}

// ── Phase B ────────────────────────────────────────────────────────────────

async function loadClaims(tx, eventIds) {
  if (!eventIds.length) return new Map();
  const { rows } = await tx.query(
    `SELECT l.*, i.status AS invoice_status, i.invoice_number
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.calendar_event_id = ANY($1::uuid[]) AND l.line_status IN ('ACTIVE','REMOVED')`, [eventIds]);
  return new Map(rows.map(r => [`${r.calendar_event_id}|${r.component}`, r]));
}

class DraftBook {
  constructor(tx, orgId, userId, runId, ctx) {
    Object.assign(this, { tx, orgId, userId, runId, ctx });
    this.byKey = new Map();
    this.touched = new Map(); // invoiceId → {created:boolean}
  }

  async forClient(clientId, profile, payer, { from, to, tripId }) {
    const key = `${clientId}|${BP.payerKey(payer)}`;
    if (this.byKey.has(key)) return this.byKey.get(key);
    const pk = BP.payerKey(payer);
    const params = [this.orgId, clientId, pk, from, to];
    let tripClause = '';
    if (tripId) { params.push(tripId); tripClause = `AND (trip_id = $${params.length} OR trip_id IS NULL)`; }
    const { rows: [existing] } = await this.tx.query(
      `SELECT id FROM invoices
        WHERE organisation_id = $1 AND client_id = $2 AND status IN ('DRAFT','NEEDS_ATTENTION')
          AND (payer_key = $3 OR payer_key = 'MISSING' OR $3 = 'MISSING')
          AND period_start <= $5::date AND period_end >= $4::date ${tripClause}
        ORDER BY (payer_key = $3) DESC, created_at LIMIT 1 FOR UPDATE`, params);
    let invoiceId;
    if (existing) {
      invoiceId = existing.id;
      await this.tx.query(
        `UPDATE invoices SET period_start = LEAST(period_start, $2::date), period_end = GREATEST(period_end, $3::date),
                trip_id = COALESCE(trip_id, $4), run_id = $5, updated_at = NOW() WHERE id = $1`,
        [invoiceId, from, to, tripId || null, this.runId]);
      if (!this.touched.has(invoiceId)) this.touched.set(invoiceId, { created: false });
    } else {
      const number = await Settings.allocateInvoiceNumber(this.tx, this.orgId);
      const issue = S.todayInTz(this.ctx.tz, this.ctx.now);
      const terms = profile && profile.payment_terms_days != null ? Number(profile.payment_terms_days) : this.ctx.settings.paymentTermsDays;
      const { rows: [inv] } = await this.tx.query(
        `INSERT INTO invoices (organisation_id, invoice_number, run_id, trip_id, client_id, billing_profile_id, payer_key,
            issue_date, due_date, period_start, period_end, status, tax_treatment, created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'DRAFT',$12,$13) RETURNING id`,
        [this.orgId, number, this.runId, tripId || null, clientId, profile ? profile.id : null, pk, issue,
          S.addDays(issue, terms), from, to, this.ctx.settings.defaultTaxTreatment, this.userId || null]);
      invoiceId = inv.id;
      this.touched.set(invoiceId, { created: true, number });
      await recordAudit(this.tx, { orgId: this.orgId, actorUserId: this.userId, action: 'invoice.generated',
        entityType: 'invoice', entityId: invoiceId, invoiceId, after: { invoiceNumber: number, clientId, runId: this.runId } });
    }
    this.byKey.set(key, invoiceId);
    return invoiceId;
  }

  touch(invoiceId) { if (!this.touched.has(invoiceId)) this.touched.set(invoiceId, { created: false }); }
}

async function insertLine(tx, orgId, invoiceId, line, extra) {
  const gst = S.gstFor(line.amountCents, extra.taxTreatment);
  const { rows: [r] } = await tx.query(
    `INSERT INTO invoice_lines (invoice_id, organisation_id, component, calendar_event_id, client_id, practitioner_user_id,
        travel_allocation_id, trip_id, trip_allocation_id, rate_card_id, rate_card_version, mmm_zone, service_date,
        item_code, description, duration_minutes, quantity, unit_price, gst_rate, gst_amount, amount, calculation, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING id`,
    [invoiceId, orgId, line.component, extra.eventId || null, extra.clientId || null, extra.practitionerId || null,
      extra.travelAllocationId || null, extra.tripId || null, extra.tripAllocationId || null, line.rateCardId || null,
      line.rateCardVersion ?? null, line.mmm ?? null, line.serviceDate || null, line.itemCode || null,
      line.description.slice(0, 500), line.durationMinutes ?? null, M.qtyToString(line.quantityE4),
      M.fromCents(line.unitCents), gst.rate, M.fromCents(gst.cents), M.fromCents(line.amountCents),
      JSON.stringify(line.calculation || {}), extra.sortOrder || 0]);
  return r.id;
}

async function updateLine(tx, lineId, line, extra) {
  const gst = S.gstFor(line.amountCents, extra.taxTreatment);
  await tx.query(
    `UPDATE invoice_lines SET travel_allocation_id = $2, rate_card_id = $3, rate_card_version = $4, mmm_zone = $5,
            service_date = $6, item_code = $7, description = $8, duration_minutes = $9, quantity = $10,
            unit_price = $11, gst_rate = $12, gst_amount = $13, amount = $14, calculation = $15,
            practitioner_user_id = $16, sort_order = $17, updated_at = NOW()
      WHERE id = $1`,
    [lineId, extra.travelAllocationId || null, line.rateCardId || null, line.rateCardVersion ?? null, line.mmm ?? null,
      line.serviceDate || null, line.itemCode || null, line.description.slice(0, 500), line.durationMinutes ?? null,
      M.qtyToString(line.quantityE4), M.fromCents(line.unitCents), gst.rate, M.fromCents(gst.cents),
      M.fromCents(line.amountCents), JSON.stringify(line.calculation || {}), extra.practitionerId || null, extra.sortOrder || 0]);
}

function sortKey(ev, component) {
  const t = Math.floor(new Date(ev.start_time).getTime() / 60000);
  return (t % 100000000) * 10 + ({ SESSION: 1, TRAVEL_LABOUR: 2, TRAVEL_KM: 3 }[component] || 5);
}

async function insertAllocation(tx, orgId, runId, s, settings) {
  const a = s.travel.allocation;
  const { rows: [r] } = await tx.query(
    `INSERT INTO travel_billing_allocations (organisation_id, run_id, practitioner_user_id, service_date, calendar_event_id,
        client_id, day_total_minutes, day_total_km, sessions_in_day, directions, allocated_minutes_before_cap, cap_minutes,
        cap_applied, claimable_minutes, travel_rate, labour_amount, allocated_km, vehicle_rate_per_km, vehicle_amount,
        return_payable, mmm_zone, rate_card_id, rate_card_version, legs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
    [orgId, runId, s.ev.user_id, s.ev.local_date, s.ev.id, s.ev.client_id, a.dayTotalMinutes, a.dayTotalKm,
      a.sessionsInDay, a.directions, a.allocatedMinutesBeforeCap, a.capMinutes, a.capApplied, a.claimableMinutes,
      M.fromCents(a.travelRateCents), M.fromCents(a.labourCents || 0), a.allocatedKm, M.fromCents(a.vehicleRateCents),
      M.fromCents(a.vehicleCents || 0), !!settings.returnTravelPayable, a.mmm, a.rateCardId, a.rateCardVersion,
      JSON.stringify(s.travel.legs.map(l => ({ id: l.id, kind: l.kind, origin: l.origin, destination: l.destination,
        minutes: l.minutes ?? null, km: l.km ?? null, provider: l.provider || null, included: l.included, reason: l.reason })))]);
  return r.id;
}

/** Recompute totals, practitioner names, recipient snapshot and status for a draft. */
async function refreshDraft(tx, invoiceId, { profile, payer, recipientIssues }) {
  const { rows: lines } = await tx.query(
    `SELECT l.amount, l.gst_amount, l.line_status, u.name AS practitioner_name
       FROM invoice_lines l LEFT JOIN users u ON u.id = l.practitioner_user_id WHERE l.invoice_id = $1`, [invoiceId]);
  const t = S.invoiceTotals(lines);
  const practitioners = [...new Set(lines.filter(l => l.line_status === 'ACTIVE' && l.practitioner_name).map(l => l.practitioner_name))];
  const status = recipientIssues && recipientIssues.length ? 'NEEDS_ATTENTION' : 'DRAFT';
  await tx.query(
    `UPDATE invoices SET subtotal = $2, gst_total = $3, total = $4, practitioner_names = $5,
            practitioner_user_id = COALESCE((SELECT l.practitioner_user_id FROM invoice_lines l WHERE l.invoice_id = $1
                                              AND l.line_status = 'ACTIVE' AND l.practitioner_user_id IS NOT NULL
                                              GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1), practitioner_user_id),
            status = $6, is_stale = FALSE, stale_reason = NULL,
            client_name = $7, ndis_number = $8, management_type = $9, payer_type = $10, payer_name = $11,
            payer_email = $12, payer_reference = $13, payer_address = $14, payer_key = $15,
            billing_profile_id = COALESCE($16, billing_profile_id), updated_at = NOW()
      WHERE id = $1 AND status IN ('DRAFT','NEEDS_ATTENTION')`,
    [invoiceId, M.fromCents(t.subtotalCents), M.fromCents(t.gstCents), M.fromCents(t.totalCents),
      practitioners.join(', ') || null, status,
      profile ? profile.participant_name : null, profile ? profile.ndis_number : null, profile ? profile.management_type : null,
      payer ? payer.type : null, payer ? payer.name : null, payer ? payer.email : null, payer ? payer.reference : null,
      payer ? payer.address : null, BP.payerKey(payer), profile ? profile.id : null]);
  return t;
}

/**
 * Run invoicing.
 * @param {object} opts
 * @param {string} opts.orgId
 * @param {string} opts.userId
 * @param {string} opts.from  YYYY-MM-DD
 * @param {string} opts.to    YYYY-MM-DD
 * @param {string[]} [opts.practitionerIds]
 * @param {string[]} [opts.clientIds]      restrict (regenerate one invoice)
 * @param {string}   [opts.kind]           NORMAL | TRIP | REISSUE
 * @param {object}   [opts.trip]           trip row (trip runs)
 * @param {Function} [opts.extraPhase]     async (tx, ctx) → extra lines (trip costs)
 * @param {Date}     [opts.now]
 */
async function runInvoicing(opts) {
  const q = opts.pool || defaultPool;
  const { orgId, userId, from, to } = opts;
  if (!validRange(from, to)) throw Object.assign(new Error('from/to must be YYYY-MM-DD with from <= to'), { status: 400 });
  const plan = await prepare(q, orgId, opts);
  if (opts.preparePhase) await opts.preparePhase(q, plan);
  const { settings, sessions, issues, summary, profiles } = plan;

  const tx = await q.connect();
  try {
    await tx.query('BEGIN');
    await tx.query(`SELECT pg_advisory_xact_lock(hashtext('opal-invoicing:' || $1::text))`, [orgId]);
    const { rows: [run] } = await tx.query(
      `INSERT INTO invoice_runs (organisation_id, kind, trip_id, period_start, period_end, practitioner_user_id, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [orgId, opts.kind || 'NORMAL', opts.trip ? opts.trip.id : null, from, to,
        opts.practitionerIds && opts.practitionerIds.length === 1 ? opts.practitionerIds[0] : null, userId || null]);
    const runId = run.id;
    const book = new DraftBook(tx, orgId, userId, runId, plan);
    const claims = await loadClaims(tx, sessions.map(s => s.ev.id));
    const alreadyCounted = new Set();
    const clientRecipient = new Map(); // clientId → {profile, payer, recipientIssues}

    for (const s of sessions) {
      if (s.blocked) continue;
      const ev = s.ev;
      clientRecipient.set(ev.client_id, { profile: s.profile, payer: s.payer, recipientIssues: s.recipientIssues });
      const planned = [S.buildSessionLine({ serviceDate: ev.local_date, minutes: s.res.minutes, rate: s.rate, mmm: s.mmm,
        sessionLabel: settings.sessionDescription, telehealth: s.res.telehealth, mmmSnapshot: MMM.mmmSnapshot(s.profile) })];
      if (s.travel) {
        planned.push(...S.buildTravelLines({ serviceDate: ev.local_date, allocation: s.travel.allocation, rate: s.rate,
          practitionerName: ev.practitioner_name, legs: s.travel.legs }));
      }
      let allocationId = null;
      let sessionCounted = false;
      const plannedComponents = new Set(planned.map(l => l.component));
      for (const line of planned) {
        const claim = claims.get(`${ev.id}|${line.component}`);
        const extra = { eventId: ev.id, clientId: ev.client_id, practitionerId: ev.user_id, taxTreatment: settings.defaultTaxTreatment,
          tripId: opts.trip ? opts.trip.id : null, sortOrder: sortKey(ev, line.component) };
        if (line.component !== 'SESSION' && !allocationId && (!claim || OPEN_STATUSES.includes(claim.invoice_status))) {
          allocationId = await insertAllocation(tx, orgId, runId, s, settings);
          summary.travelAllocations++;
        }
        extra.travelAllocationId = line.component === 'SESSION' ? null : allocationId;
        if (claim) {
          if (!OPEN_STATUSES.includes(claim.invoice_status)) {
            if (!alreadyCounted.has(ev.id)) { alreadyCounted.add(ev.id); summary.alreadyInvoiced++; }
            continue;
          }
          if (claim.line_status === 'REMOVED') { summary.excludedByOwner++; continue; }
          book.touch(claim.invoice_id);
          if (claim.is_overridden) continue; // owner's audited override stands
          await updateLine(tx, claim.id, line, extra);
          summary.linesUpdated++;
        } else {
          const invoiceId = await book.forClient(ev.client_id, s.profile, s.payer, { from, to, tripId: opts.trip ? opts.trip.id : null });
          await insertLine(tx, orgId, invoiceId, line, extra);
          summary.linesAdded++;
        }
        if (line.component === 'SESSION' && !sessionCounted) { summary.sessionsIncluded++; sessionCounted = true; }
      }
      // A travel component this run no longer produces (e.g. the day's route now has no km) leaves a draft.
      // (Only when this run could judge travel: a computed day, or a session now marked telehealth.)
      if (s.travel || s.res.telehealth) {
        for (const comp of ['TRAVEL_LABOUR', 'TRAVEL_KM']) {
          const claim = claims.get(`${ev.id}|${comp}`);
          if (claim && !plannedComponents.has(comp) && OPEN_STATUSES.includes(claim.invoice_status)
              && claim.line_status === 'ACTIVE' && !claim.is_overridden) {
            await tx.query(`UPDATE invoice_lines SET line_status = 'VOIDED', removed_reason = $2, removed_at = NOW(), updated_at = NOW() WHERE id = $1`,
              [claim.id, 'Recalculation produced no claimable amount for this component']);
            book.touch(claim.invoice_id);
          }
        }
      }
    }

    // Draft lines whose source event is no longer billable (cancelled, DNA, deleted, moved out) leave the draft.
    const billableIds = sessions.filter(s => !s.blocked).map(s => s.ev.id);
    const blockedIds = sessions.filter(s => s.blocked).map(s => s.ev.id);
    const dropParams = [orgId, from, to, billableIds.concat(blockedIds)];
    let dropScope = '';
    if (opts.practitionerIds && opts.practitionerIds.length) { dropParams.push(opts.practitionerIds); dropScope += ` AND l.practitioner_user_id = ANY($${dropParams.length}::uuid[])`; }
    if (opts.clientIds && opts.clientIds.length) { dropParams.push(opts.clientIds); dropScope += ` AND l.client_id = ANY($${dropParams.length}::text[])`; }
    const { rows: dropped } = await tx.query(
      `UPDATE invoice_lines l SET line_status = 'VOIDED', removed_reason = 'Source calendar event is no longer billable',
              removed_at = NOW(), updated_at = NOW()
         FROM invoices i
        WHERE i.id = l.invoice_id AND i.organisation_id = $1 AND i.status IN ('DRAFT','NEEDS_ATTENTION')
          AND l.line_status = 'ACTIVE' AND l.component IN ('SESSION','TRAVEL_LABOUR','TRAVEL_KM')
          AND l.service_date BETWEEN $2::date AND $3::date
          AND (l.calendar_event_id IS NULL OR NOT (l.calendar_event_id = ANY($4::uuid[])))${dropScope}
      RETURNING l.invoice_id, l.id, l.component, l.amount`, dropParams);
    for (const d of dropped) {
      book.touch(d.invoice_id);
      await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_removed', entityType: 'invoice_line', entityId: d.id,
        invoiceId: d.invoice_id, before: { component: d.component, amount: d.amount }, reason: 'Source calendar event is no longer billable' });
    }

    // Extra phase (trip costs) runs inside the same transaction.
    if (opts.extraPhase) await opts.extraPhase(tx, { runId, book, plan, summary, clientRecipient, profiles });

    // Totals, status and recipient snapshot for every touched draft.
    for (const [invoiceId, info] of book.touched) {
      const { rows: [inv] } = await tx.query(`SELECT client_id, total FROM invoices WHERE id = $1`, [invoiceId]);
      let rec = clientRecipient.get(inv.client_id);
      if (!rec) {
        const p = profiles.get(inv.client_id) || await BP.getProfile(tx, orgId, inv.client_id);
        const recipientIssues = [];
        if (!BP.resolvePayer(p)) recipientIssues.push('CLIENT_MISSING_PAYER');
        if (BP.ndisNumberRequired(p) && !(p && p.ndis_number)) recipientIssues.push('NDIS_NUMBER_MISSING');
        rec = { profile: p, payer: BP.resolvePayer(p), recipientIssues };
      }
      const before = M.toCents(inv.total);
      const t = await refreshDraft(tx, invoiceId, rec);
      if (info.created) summary.invoicesCreated++;
      else summary.invoicesUpdated++;
      summary.totalCents += t.totalCents;
      if (!info.created && before !== t.totalCents) {
        await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.recalculated', entityType: 'invoice', entityId: invoiceId,
          invoiceId, before: { total: M.fromCents(before) }, after: { total: M.fromCents(t.totalCents), runId } });
      }
    }

    // Link recipient issues to the invoices they hold up.
    const invoiceByClient = new Map();
    for (const [key, invoiceId] of book.byKey) invoiceByClient.set(key.split('|')[0], invoiceId);
    for (const it of issues.list()) {
      if (RECIPIENT_ISSUES.has(it.type) && invoiceByClient.has(it.clientId)) it.invoiceId = invoiceByClient.get(it.clientId);
      await Issues.upsertIssue(tx, orgId, runId, it);
    }
    await Issues.resolveStale(tx, orgId, {
      runId, from, to, practitionerIds: opts.practitionerIds, tripId: opts.trip ? opts.trip.id : null,
      raisedKeys: issues.list().map(i => i.dedupeKey), clientIds: [...new Set(sessions.map(s => s.ev.client_id).filter(Boolean))],
    });
    summary.itemsNeedAttention = issues.list().filter(i => i.severity === 'BLOCKING').length;
    summary.warnings = issues.list().filter(i => i.severity === 'WARNING').length;
    summary.total = M.fromCents(summary.totalCents);
    summary.invoiceIds = [...book.touched.keys()];

    await tx.query(`UPDATE invoice_runs SET status = 'COMPLETED', summary = $2, completed_at = NOW() WHERE id = $1`,
      [runId, JSON.stringify(summary)]);
    await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice_run.created', entityType: 'invoice_run', entityId: runId,
      after: { kind: opts.kind || 'NORMAL', from, to, practitionerIds: opts.practitionerIds || 'all',
        invoicesCreated: summary.invoicesCreated, invoicesUpdated: summary.invoicesUpdated, total: summary.total } });
    await tx.query('COMMIT');
    return { runId, summary };
  } catch (err) {
    await tx.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    tx.release();
  }
}

module.exports = { runInvoicing, prepare, loadCandidateEvents, refreshDraft, insertLine, issueMessage, ymd, validRange };
