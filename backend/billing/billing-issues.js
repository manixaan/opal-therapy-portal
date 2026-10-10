'use strict';

/**
 * BILLING ISSUES — the Needs Attention queue.
 *
 * An issue is keyed by a deterministic `dedupe_key`, so re-running invoicing
 * refreshes an open issue instead of duplicating it. After each run the
 * issues in that run's scope that were NOT raised again are resolved
 * automatically — that is what "fix the record, then Reprocess" relies on.
 */

const ISSUE_TYPES = Object.freeze({
  CLIENT_MISSING_PAYER:      { severity: 'BLOCKING', label: 'Client missing payer' },
  NDIS_NUMBER_MISSING:       { severity: 'BLOCKING', label: 'NDIS number missing' },
  CLIENT_PROFILE_MISSING:    { severity: 'BLOCKING', label: 'Client has no billing profile' },
  CLIENT_ADDRESS_MISSING:    { severity: 'BLOCKING', label: 'Client address missing' },
  MMM_UNRESOLVED:            { severity: 'BLOCKING', label: 'MMM cannot be resolved' },
  MMM_REVIEW:                { severity: 'BLOCKING', label: 'MMM needs confirmation' },
  SESSION_MMM_UNRESOLVED:    { severity: 'BLOCKING', label: 'Session MMM zone unknown' },
  SESSION_MMM_REVIEW:        { severity: 'BLOCKING', label: 'Session MMM zone needs confirmation' },
  EVENT_NO_CLIENT:           { severity: 'BLOCKING', label: 'Event has no client' },
  EVENT_NO_LOCATION:         { severity: 'BLOCKING', label: 'Event has no location' },
  EVENT_NO_SERVICE_TYPE:     { severity: 'BLOCKING', label: 'Event has no service type' },
  INVALID_DURATION:          { severity: 'BLOCKING', label: 'Invalid duration' },
  RATE_UNAVAILABLE:          { severity: 'BLOCKING', label: 'Rate unavailable for service date' },
  TRAVEL_ROUTE_FAILED:       { severity: 'BLOCKING', label: 'Travel route failed' },
  TRAVEL_DAY_DEFERRED:       { severity: 'WARNING',  label: 'Travel for this day is waiting on another session' },
  WORK_LOCATION_NOT_SET:     { severity: 'WARNING',  label: 'Day work location not set (no start/end travel leg)' },
  TRIP_COST_INCOMPLETE:      { severity: 'BLOCKING', label: 'Trip cost incomplete' },
  TRIP_ALLOCATION_CHANGED:   { severity: 'BLOCKING', label: 'Trip allocation changed after invoice finalised' },
  ALREADY_BILLED_CONFLICT:   { severity: 'WARNING',  label: 'Already billed conflict' },
  SOURCE_CHANGED_AFTER_FINALISE: { severity: 'BLOCKING', label: 'Source event changed after invoice finalisation' },
});

/**
 * Collects issues during a run, then flushes them in one pass.
 */
class IssueCollector {
  constructor() { this.items = new Map(); }
  raise(type, fields) {
    const def = ISSUE_TYPES[type];
    if (!def) throw new Error(`Unknown billing issue type ${type}`);
    const key = [type, fields.clientId || '', fields.eventId || '', fields.tripId || '',
      fields.serviceDate || '', fields.extraKey || ''].join('|');
    if (!this.items.has(key)) {
      this.items.set(key, { type, severity: fields.severity || def.severity, dedupeKey: key, ...fields });
    }
    return key;
  }
  list() { return [...this.items.values()]; }
  count() { return this.items.size; }
  forClient(clientId) { return this.list().filter(i => i.clientId === clientId); }
}

async function upsertIssue(q, orgId, runId, it) {
  const { rows } = await q.query(
    `INSERT INTO billing_issues (organisation_id, run_id, issue_type, severity, calendar_event_id, client_id,
        practitioner_user_id, trip_id, invoice_id, service_date, message, fix_target, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (organisation_id, dedupe_key) WHERE status = 'OPEN'
     DO UPDATE SET last_seen_at = NOW(), run_id = EXCLUDED.run_id, message = EXCLUDED.message,
                   invoice_id = COALESCE(EXCLUDED.invoice_id, billing_issues.invoice_id),
                   fix_target = EXCLUDED.fix_target
     RETURNING id`,
    [orgId, runId || null, it.type, it.severity, it.eventId || null, it.clientId || null,
      it.practitionerId || null, it.tripId || null, it.invoiceId || null, it.serviceDate || null,
      it.message, JSON.stringify(it.fixTarget || {}), it.dedupeKey]);
  return rows[0].id;
}

/**
 * Resolve open issues in scope that this run did not raise again.
 * Scope: service_date within [from, to] (and practitioner when filtered), the
 * trip for a trip run, and client-level issues of the clients the run examined. SOURCE_CHANGED_AFTER_FINALISE is never auto-resolved.
 */
async function resolveStale(q, orgId, { runId, from, to, practitionerIds, tripId, raisedKeys, clientIds = [] }) {
  const params = [orgId, raisedKeys, runId || null, clientIds];
  // Client-level issues (no service date) are in scope for the clients this run looked at.
  let scope;
  if (tripId) { params.push(tripId, from, to); scope = `(trip_id = $5 OR service_date BETWEEN $6 AND $7 OR (service_date IS NULL AND trip_id IS NULL AND client_id = ANY($4::text[])))`; }
  else { params.push(from, to); scope = `(service_date BETWEEN $5 AND $6 OR (service_date IS NULL AND trip_id IS NULL AND client_id = ANY($4::text[])))`; }
  let prac = '';
  if (practitionerIds && practitionerIds.length) {
    params.push(practitionerIds);
    prac = ` AND (practitioner_user_id IS NULL OR practitioner_user_id = ANY($${params.length}::uuid[]))`;
  }
  const { rowCount } = await q.query(
    `UPDATE billing_issues SET status = 'RESOLVED', resolved_at = NOW(),
            resolution_note = 'Not raised again by run ' || COALESCE($3::text, '')
      WHERE organisation_id = $1 AND status = 'OPEN' AND issue_type <> 'SOURCE_CHANGED_AFTER_FINALISE'
        AND NOT (dedupe_key = ANY($2::text[])) AND ${scope}${prac}`, params);
  return rowCount;
}

async function listIssues(q, orgId, { status = 'OPEN', type, clientId, limit = 500 } = {}) {
  const params = [orgId];
  const where = ['b.organisation_id = $1'];
  if (status) { params.push(status); where.push(`b.status = $${params.length}`); }
  if (type) { params.push(type); where.push(`b.issue_type = $${params.length}`); }
  if (clientId) { params.push(clientId); where.push(`b.client_id = $${params.length}`); }
  params.push(Math.min(Number(limit) || 500, 2000));
  const { rows } = await q.query(
    `SELECT b.*, i.invoice_number, t.name AS trip_name, u.name AS practitioner_name,
            bp.participant_name AS client_name
       FROM billing_issues b
       LEFT JOIN invoices i ON i.id = b.invoice_id
       LEFT JOIN trips t ON t.id = b.trip_id
       LEFT JOIN users u ON u.id = b.practitioner_user_id
       LEFT JOIN billing_profiles bp ON bp.organisation_id = b.organisation_id AND bp.client_id = b.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY CASE b.severity WHEN 'BLOCKING' THEN 0 ELSE 1 END, b.created_at DESC
      LIMIT $${params.length}`, params);
  return rows.map(r => ({ ...r, label: (ISSUE_TYPES[r.issue_type] || {}).label || r.issue_type }));
}

module.exports = { ISSUE_TYPES, IssueCollector, upsertIssue, resolveStale, listIssues };
