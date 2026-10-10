'use strict';

/**
 * TRIPS — rural / remote service trips and their shared operating costs.
 *
 * "Generate Trip Invoices" = the normal invoicing run over the trip window and
 * the trip's practitioners (sessions + travel priced exactly as any other
 * week), plus one extra phase in the same transaction that allocates the
 * trip's eligible shared costs across the participating clients and adds one
 * TRIP_COST line to each client's invoice.
 *
 * Compliance control: a cost is UNCLASSIFIED until the owner marks it
 * SHARED_BILLABLE or NON_BILLABLE. Any unclassified cost blocks the cost
 * allocation (a TRIP_COST_INCOMPLETE issue) — sessions still invoice.
 */

const { pool: defaultPool } = require('../database');
const M = require('./money');
const TA = require('./trip-allocation');
const S = require('./session-billing');
const BP = require('./billing-profiles');
const RC = require('./rate-cards');
const MMM = require('./mmm-classification');
const Gen = require('./invoice-generation');
const { recordAudit } = require('./billing-audit');

const COST_CATEGORIES = ['FLIGHTS', 'ACCOMMODATION', 'CAR_HIRE', 'FUEL', 'TAXI_RIDESHARE', 'PARKING', 'BAGGAGE', 'REMOTE_TRAVEL', 'OTHER'];
const TRIP_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED', 'CLOSED'];

function validateTrip(input, { partial = false } = {}) {
  const errors = [];
  const v = {};
  const has = k => Object.prototype.hasOwnProperty.call(input || {}, k);
  if (!partial || has('name')) {
    if (!input.name || String(input.name).trim().length < 2) errors.push('name is required'); else v.name = String(input.name).trim().slice(0, 200);
  }
  for (const k of ['startDate', 'endDate']) {
    if (!partial || has(k)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input[k] || ''))) errors.push(`${k} must be YYYY-MM-DD`); else v[k] = input[k];
    }
  }
  if (v.startDate && v.endDate && v.endDate < v.startDate) errors.push('endDate is before startDate');
  if (has('destination')) v.destination = input.destination ? String(input.destination).slice(0, 255) : null;
  if (has('status')) { if (!TRIP_STATUSES.includes(input.status)) errors.push('status is invalid'); else v.status = input.status; }
  if (has('mmmContext')) {
    const z = input.mmmContext === '' || input.mmmContext == null ? null : Number(input.mmmContext);
    if (z != null && !(z >= 1 && z <= 7)) errors.push('mmmContext must be 1–7'); else v.mmmContext = z;
  }
  if (has('allocationMethod')) { if (!TA.METHODS.includes(input.allocationMethod)) errors.push('allocationMethod is invalid'); else v.allocationMethod = input.allocationMethod; }
  if (has('notes')) v.notes = input.notes ? String(input.notes).slice(0, 4000) : null;
  if (has('routeNotes')) v.routeNotes = input.routeNotes ? String(input.routeNotes).slice(0, 4000) : null;
  if (has('practitionerIds')) {
    const ids = Array.isArray(input.practitionerIds) ? input.practitionerIds : [];
    if (ids.some(id => !/^[0-9a-f-]{36}$/i.test(String(id)))) errors.push('practitionerIds are invalid'); else v.practitionerIds = ids;
  }
  return { errors, values: v };
}

function validateCost(input, { partial = false } = {}) {
  const errors = [];
  const v = {};
  const has = k => Object.prototype.hasOwnProperty.call(input || {}, k);
  if (!partial || has('category')) { if (!COST_CATEGORIES.includes(input.category)) errors.push('category is invalid'); else v.category = input.category; }
  if (!partial || has('amount')) {
    let c = null;
    try { c = M.toCents(input.amount); } catch (_) { c = null; }
    if (c == null || c < 0) errors.push('amount must be a non-negative amount'); else v.amount = M.fromCents(c);
  }
  if (has('billableMode')) {
    if (!['UNCLASSIFIED', 'SHARED_BILLABLE', 'NON_BILLABLE'].includes(input.billableMode)) errors.push('billableMode is invalid');
    else v.billableMode = input.billableMode;
  }
  if (has('costDate')) {
    if (input.costDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.costDate))) errors.push('costDate must be YYYY-MM-DD'); else v.costDate = input.costDate || null;
  }
  for (const k of ['description', 'supplier', 'notes']) if (has(k)) v[k] = input[k] ? String(input[k]).slice(0, k === 'notes' ? 4000 : 255) : null;
  return { errors, values: v };
}

async function getTrip(q, orgId, tripId) {
  const { rows: [t] } = await q.query(`SELECT * FROM trips WHERE id = $1 AND organisation_id = $2`, [tripId, orgId]);
  if (!t) return null;
  const pr = await q.query(
    `SELECT tp.user_id, COALESCE(p.display_name, u.name) AS name FROM trip_practitioners tp
       JOIN users u ON u.id = tp.user_id LEFT JOIN therapist_profiles p ON p.user_id = u.id
      WHERE tp.trip_id = $1 ORDER BY 2`, [tripId]);
  t.practitioners = pr.rows;
  return t;
}

async function listTrips(q, orgId) {
  const { rows } = await q.query(
    `SELECT t.*,
       (SELECT string_agg(COALESCE(p.display_name, u.name), ', ' ORDER BY u.name) FROM trip_practitioners tp
          JOIN users u ON u.id = tp.user_id LEFT JOIN therapist_profiles p ON p.user_id = u.id WHERE tp.trip_id = t.id) AS practitioner_names,
       (SELECT COUNT(*)::int FROM trip_clients c WHERE c.trip_id = t.id AND c.included) AS client_count,
       (SELECT COALESCE(SUM(amount),0) FROM trip_costs c WHERE c.trip_id = t.id AND c.deleted_at IS NULL) AS total_costs,
       (SELECT COALESCE(SUM(amount),0) FROM trip_costs c WHERE c.trip_id = t.id AND c.deleted_at IS NULL AND c.billable_mode = 'SHARED_BILLABLE') AS eligible_costs,
       (SELECT COALESCE(SUM(amount),0) FROM trip_allocations a WHERE a.trip_id = t.id AND a.is_current) AS allocated,
       (SELECT COUNT(*)::int FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.trip_id = t.id AND l.component = 'SESSION' AND l.line_status = 'ACTIVE' AND i.status <> 'VOID') AS invoiced_sessions
       FROM trips t WHERE t.organisation_id = $1 ORDER BY t.start_date DESC`, [orgId]);
  return rows;
}

async function createTrip(q, orgId, userId, v) {
  const { rows: [t] } = await q.query(
    `INSERT INTO trips (organisation_id, name, destination, start_date, end_date, status, mmm_context, allocation_method, notes, route_notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6,'PLANNED'),$7,COALESCE($8,'EQUAL_PER_CLIENT'),$9,$10,$11) RETURNING *`,
    [orgId, v.name, v.destination || null, v.startDate, v.endDate, v.status || null, v.mmmContext ?? null,
      v.allocationMethod || null, v.notes || null, v.routeNotes || null, userId || null]);
  await setPractitioners(q, orgId, t.id, v.practitionerIds || []);
  return t;
}

async function setPractitioners(q, orgId, tripId, ids) {
  await q.query(`DELETE FROM trip_practitioners WHERE trip_id = $1`, [tripId]);
  if (!ids.length) return;
  // Only users of this organisation may be attached.
  await q.query(
    `INSERT INTO trip_practitioners (trip_id, user_id)
     SELECT $1, u.id FROM users u WHERE u.id = ANY($2::uuid[]) AND u.organisation_id = $3 ON CONFLICT DO NOTHING`,
    [tripId, ids, orgId]);
}

async function updateTrip(q, orgId, tripId, v) {
  const map = { name: 'name', destination: 'destination', startDate: 'start_date', endDate: 'end_date', status: 'status',
    mmmContext: 'mmm_context', allocationMethod: 'allocation_method', notes: 'notes', routeNotes: 'route_notes' };
  const sets = []; const params = [tripId, orgId];
  for (const [k, col] of Object.entries(map)) if (k in v) { params.push(v[k]); sets.push(`${col} = $${params.length}`); }
  if (sets.length) await q.query(`UPDATE trips SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1 AND organisation_id = $2`, params);
  if (v.practitionerIds) await setPractitioners(q, orgId, tripId, v.practitionerIds);
}

/** Calendar sessions in the trip window for the trip's practitioners. */
async function tripSessions(q, orgId, trip, tz) {
  const ids = (trip.practitioners || []).map(p => p.user_id);
  if (!ids.length) return [];
  const events = await Gen.loadCandidateEvents(q, orgId, { from: Gen.ymd(trip.start_date), to: Gen.ymd(trip.end_date), practitionerIds: ids, tz });
  const claims = events.length ? (await q.query(
    `SELECT l.calendar_event_id, i.invoice_number, i.status, i.id AS invoice_id FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.calendar_event_id = ANY($1::uuid[]) AND l.component = 'SESSION' AND l.line_status = 'ACTIVE'`,
    [events.map(e => e.id)])).rows : [];
  const byEvent = new Map(claims.map(c => [c.calendar_event_id, c]));
  return events.map(e => ({ ...e, invoice: byEvent.get(e.id) || null }));
}

/** Adds every client seen in the trip's sessions to trip_clients (manual exclusions are kept). */
async function syncTripClients(q, trip, events) {
  const seen = new Map();
  for (const e of events) if (e.client_id && !['cancelled'].includes(String(e.status).toLowerCase())) seen.set(e.client_id, e.client_name);
  for (const [clientId, name] of seen) {
    await q.query(
      `INSERT INTO trip_clients (trip_id, client_id, client_name) VALUES ($1,$2,$3)
       ON CONFLICT (trip_id, client_id) DO UPDATE SET client_name = COALESCE(trip_clients.client_name, EXCLUDED.client_name)`,
      [trip.id, clientId, name || null]);
  }
}

async function listCosts(q, tripId) {
  const { rows } = await q.query(
    `SELECT id, trip_id, category, description, cost_date, supplier, amount, billable_mode, notes,
            receipt_file_name, receipt_mime, created_at, updated_at
       FROM trip_costs WHERE trip_id = $1 AND deleted_at IS NULL ORDER BY cost_date NULLS LAST, created_at`, [tripId]);
  return rows;
}

async function tripClients(q, orgId, tripId) {
  const { rows } = await q.query(
    `SELECT c.*, bp.ndis_number, bp.payer_name, bp.mmm_zone, bp.mmm_manual_override
       FROM trip_clients c LEFT JOIN billing_profiles bp ON bp.organisation_id = $2 AND bp.client_id = c.client_id
      WHERE c.trip_id = $1 ORDER BY LOWER(COALESCE(c.client_name, c.client_id))`, [tripId, orgId]);
  return rows;
}

/**
 * Allocation preview (pure over DB reads) — also what Generate persists.
 * Session counts use billable sessions (not cancelled / DNA / future).
 */
async function computeAllocation(q, orgId, trip, { now = new Date(), tz = 'Australia/Perth' } = {}) {
  const costs = await listCosts(q, trip.id);
  const sum = TA.summariseCosts(costs.map(c => ({ id: c.id, amount: c.amount, billableMode: c.billable_mode })));
  const unclassified = costs.filter(c => c.billable_mode === 'UNCLASSIFIED');
  const clients = (await tripClients(q, orgId, trip.id)).filter(c => c.included);
  const events = await tripSessions(q, orgId, trip, tz);
  const counts = new Map();
  for (const e of events) {
    const r = S.evaluateEvent(e, { now });
    if (r.state !== 'SKIP' && e.client_id) counts.set(e.client_id, (counts.get(e.client_id) || 0) + 1);
  }
  const alloc = TA.allocate({
    eligibleCents: sum.eligibleCents, method: trip.allocation_method,
    clients: clients.map(c => ({ clientId: c.client_id, sessionCount: counts.get(c.client_id) || 0, weight: c.weight })),
  });
  return {
    totals: {
      totalCosts: M.fromCents(sum.totalCents), nonBillableCosts: M.fromCents(sum.nonBillableCents),
      unclassifiedCosts: M.fromCents(unclassified.reduce((a, c) => a + M.toCents(c.amount), 0)),
      eligibleSharedCosts: M.fromCents(sum.eligibleCents), clientCount: alloc.clientCount,
      allocated: M.fromCents(alloc.allocatedCents), unallocated: M.fromCents(alloc.unallocatedCents),
      method: alloc.method,
    },
    unclassifiedCount: unclassified.length,
    eligibleCostIds: sum.eligibleCostIds,
    allocations: alloc.allocations.map(a => ({
      clientId: a.clientId, clientName: (clients.find(c => c.client_id === a.clientId) || {}).client_name || null,
      weight: a.weight, sessionCount: a.sessionCount, amount: M.fromCents(a.amountCents), amountCents: a.amountCents,
    })),
    raw: alloc,
  };
}

/**
 * Generate Trip Invoices: sessions + travel + trip-cost allocation, grouped
 * per client into draft invoices, in one run.
 */
async function generateTripInvoices({ pool = defaultPool, orgId, userId, tripId, now }) {
  const trip = await getTrip(pool, orgId, tripId);
  if (!trip) throw Object.assign(new Error('Trip not found'), { status: 404 });
  if (!trip.practitioners.length) throw Object.assign(new Error('Add at least one practitioner to the trip first'), { status: 400 });
  const from = Gen.ymd(trip.start_date), to = Gen.ymd(trip.end_date);

  return Gen.runInvoicing({
    pool, orgId, userId, from, to, now, kind: 'TRIP', trip,
    practitionerIds: trip.practitioners.map(p => p.user_id),
    preparePhase: async (q, plan) => {
      await syncTripClients(q, trip, plan.sessions.map(s => s.ev));
    },
    extraPhase: async (tx, ctx) => {
      const { plan, book, summary, runId } = ctx;
      const issues = plan.issues;
      const allocation = await computeAllocation(tx, orgId, trip, { now: plan.now, tz: plan.tz });
      summary.trip = { ...allocation.totals };
      if (allocation.unclassifiedCount) {
        issues.raise('TRIP_COST_INCOMPLETE', { tripId, message: `${allocation.unclassifiedCount} cost(s) on "${trip.name}" are not yet marked shared-billable or non-billable. Trip costs are not allocated until every cost is classified.`, fixTarget: { kind: 'trip', tripId, tab: 'costs' } });
        return;
      }
      if (allocation.raw.eligibleCents <= 0 || !allocation.allocations.length) return;
      if (allocation.raw.allocatedCents !== allocation.raw.eligibleCents) {
        // Defensive: the allocator guarantees equality; never write a pool that does not reconcile.
        throw new Error('Trip allocation does not reconcile with the eligible pool');
      }

      // Existing live trip-cost claims.
      const { rows: existingLines } = await tx.query(
        `SELECT l.*, i.status AS invoice_status FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.trip_id = $1 AND l.component = 'TRIP_COST' AND l.line_status IN ('ACTIVE','REMOVED')`, [tripId]);
      const claimByClient = new Map(existingLines.map(l => [l.client_id, l]));
      const finalised = existingLines.filter(l => !['DRAFT', 'NEEDS_ATTENTION'].includes(l.invoice_status));

      // Replace the current allocation set (history kept via is_current = FALSE).
      const { rows: prev } = await tx.query(`SELECT client_id, amount FROM trip_allocations WHERE trip_id = $1 AND is_current`, [tripId]);
      const prevMap = new Map(prev.map(p => [p.client_id, M.toCents(p.amount)]));
      const changed = allocation.allocations.some(a => prevMap.get(a.clientId) !== a.amountCents) || prev.length !== allocation.allocations.length;
      if (finalised.length && changed) {
        for (const l of finalised) {
          const now = allocation.allocations.find(a => a.clientId === l.client_id);
          if (!now || now.amountCents !== M.toCents(l.amount)) {
            issues.raise('TRIP_ALLOCATION_CHANGED', { tripId, clientId: l.client_id, invoiceId: l.invoice_id,
              message: `The trip-cost allocation for this client changed after their invoice was finalised (billed ${M.formatAud(M.toCents(l.amount))}, now ${now ? M.formatAud(now.amountCents) : 'not allocated'}). Void and reissue, or revert the cost change.`,
              fixTarget: { kind: 'invoice', invoiceId: l.invoice_id } });
          }
        }
      }
      const batchId = require('crypto').randomUUID();
      await tx.query(`UPDATE trip_allocations SET is_current = FALSE WHERE trip_id = $1 AND is_current`, [tripId]);
      const cards = await RC.loadRateCards(tx, orgId);
      for (const a of allocation.allocations) {
        const calc = {
          method: allocation.totals.method, eligiblePool: allocation.totals.eligibleSharedCosts,
          totalCosts: allocation.totals.totalCosts, nonBillableCosts: allocation.totals.nonBillableCosts,
          clientCount: allocation.totals.clientCount, weight: a.weight, totalWeight: allocation.raw.totalWeight,
          sessionCount: a.sessionCount, amount: a.amount, eligibleCostIds: allocation.eligibleCostIds,
          reconciliation: { allocated: allocation.totals.allocated, unallocated: allocation.totals.unallocated },
        };
        const { rows: [ta] } = await tx.query(
          `INSERT INTO trip_allocations (trip_id, batch_id, client_id, method, weight, session_count, pool_amount, amount, calculation, created_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [tripId, batchId, a.clientId, allocation.totals.method, a.weight, a.sessionCount, allocation.totals.eligibleSharedCosts,
            a.amount, JSON.stringify(calc), userId || null]);
        if (a.amountCents <= 0) continue;

        const claim = claimByClient.get(a.clientId);
        const profile = ctx.profiles.get(a.clientId) || await BP.getProfile(tx, orgId, a.clientId);
        const mmm = MMM.effectiveMmm(profile) || trip.mmm_context || null;
        const rate = mmm ? RC.resolveRule(cards, { serviceDate: to, mmm, discipline: 'OT' }) : null;
        const line = {
          component: 'TRIP_COST',
          itemCode: rate ? (rate.rule.tripCostItemCode || rate.rule.vehicleItemCode) : null,
          description: `Remote Trip Shared Travel Cost – ${trip.name}`,
          serviceDate: to, durationMinutes: null, quantityE4: 10000, unitCents: a.amountCents, amountCents: a.amountCents,
          mmm, rateCardId: rate ? rate.card.id : null, rateCardVersion: rate ? rate.card.version : null,
          calculation: { ...calc, tripId, tripName: trip.name, tripDates: { from, to } },
        };
        const extra = { clientId: a.clientId, tripId, tripAllocationId: ta.id, taxTreatment: plan.settings.defaultTaxTreatment, sortOrder: 2000000000 };
        if (claim) {
          if (!['DRAFT', 'NEEDS_ATTENTION'].includes(claim.invoice_status)) continue;
          if (claim.line_status === 'REMOVED' || claim.is_overridden) { book.touch(claim.invoice_id); continue; }
          await tx.query(
            `UPDATE invoice_lines SET trip_allocation_id = $2, unit_price = $3, amount = $3, quantity = 1, description = $4,
                    item_code = $5, calculation = $6, mmm_zone = $7, rate_card_id = $8, rate_card_version = $9, updated_at = NOW()
              WHERE id = $1`,
            [claim.id, ta.id, a.amount, line.description, line.itemCode, JSON.stringify(line.calculation), mmm, line.rateCardId, line.rateCardVersion]);
          book.touch(claim.invoice_id);
          summary.linesUpdated++;
        } else {
          const payer = BP.resolvePayer(profile);
          if (!ctx.clientRecipient.has(a.clientId)) {
            const recipientIssues = [];
            if (!payer) recipientIssues.push('CLIENT_MISSING_PAYER');
            if (BP.ndisNumberRequired(profile) && !(profile && profile.ndis_number)) recipientIssues.push('NDIS_NUMBER_MISSING');
            ctx.clientRecipient.set(a.clientId, { profile, payer, recipientIssues });
          }
          const invoiceId = await book.forClient(a.clientId, profile, payer, { from, to, tripId });
          await Gen.insertLine(tx, orgId, invoiceId, line, extra);
          summary.linesAdded++;
        }
      }
      // A client no longer allocated (excluded, or zero share) leaves their draft.
      for (const [clientId, claim] of claimByClient) {
        const live = allocation.allocations.find(a => a.clientId === clientId && a.amountCents > 0);
        if (!live && ['DRAFT', 'NEEDS_ATTENTION'].includes(claim.invoice_status) && claim.line_status === 'ACTIVE') {
          await tx.query(`UPDATE invoice_lines SET line_status = 'VOIDED', removed_reason = 'Client no longer in the trip allocation',
                                  removed_at = NOW(), updated_at = NOW() WHERE id = $1`, [claim.id]);
          book.touch(claim.invoice_id);
        }
      }
      summary.tripCostAllocations = allocation.allocations.length;
      await recordAudit(tx, { orgId, actorUserId: userId, action: 'trip.allocation_changed', entityType: 'trip', entityId: tripId,
        before: prev.length ? { allocations: prev.map(p => ({ clientId: p.client_id, amount: p.amount })) } : null,
        after: { batchId, method: allocation.totals.method, eligiblePool: allocation.totals.eligibleSharedCosts,
          allocated: allocation.totals.allocated, allocations: allocation.allocations.map(a => ({ clientId: a.clientId, amount: a.amount })), runId } });
      await tx.query(`UPDATE trips SET status = CASE WHEN status IN ('PLANNED','IN_PROGRESS','COMPLETED') THEN 'INVOICED' ELSE status END, updated_at = NOW() WHERE id = $1`, [tripId]);
    },
  });
}

module.exports = {
  COST_CATEGORIES, TRIP_STATUSES, validateTrip, validateCost, getTrip, listTrips, createTrip, updateTrip,
  tripSessions, syncTripClients, listCosts, tripClients, computeAllocation, generateTripInvoices,
};
