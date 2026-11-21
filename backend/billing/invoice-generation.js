'use strict';

/**
 * INVOICE GENERATION — "Complete invoicing" and "Generate Trip Invoices".
 *
 *   calendar events → eligibility → billing profile (payer, NDIS no., MMM)
 *   → rate card on the service date → session lines
 *   → practitioner-day route (day-route) + persisted route facts
 *   → travel allocation (travel-billing) → travel lines
 *   + Splose support activities (report writing…) → activity lines
 *   → group by client + payer → draft invoices
 *
 * Splose (billing/splose-billing-source.js) is read in phase A: it fills
 * blank payers from the client's latest Splose invoice, supplies support
 * activities, and says what Splose has already invoiced, which Opal skips.
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
const Loc = require('./mmm-locality');
const NF = require('./nf2f-timer');
const CTM = require('./calendar-travel-minutes');
const T = require('./travel-billing');
const DR = require('./day-route');
const RF = require('./route-facts');
const Settings = require('./billing-settings');
const Issues = require('./billing-issues');
const SB = require('./splose-billing-source');
const PD = require('./payer-directory');
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

// A block booked outside the portal whose booking the portal only guessed
// (block-review.js, migration 086) is not invoiced until a person confirms it.
// A block made outside the portal bills only once a person has reviewed it
// (19 Nov 2026: needs_input is held too — it may carry a Splose client).
const HELD_FOR_REVIEW =
  `NOT EXISTS (SELECT 1 FROM event_block_reviews br WHERE br.event_id = e.id AND br.status IN ('guessed', 'needs_input'))`;

async function loadCandidateEvents(q, orgId, { from, to, practitionerIds, clientIds, eventIds, tz }) {
  const params = [orgId, from, to, tz];
  const where = [
    'u.organisation_id = $1',
    `((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
    'COALESCE(e.is_deleted, FALSE) = FALSE',
    `(e.event_type = 'therapy' OR (e.event_type = 'outlook' AND e.client_id IS NOT NULL))`,
    HELD_FOR_REVIEW,
  ];
  if (practitionerIds && practitionerIds.length) { params.push(practitionerIds); where.push(`e.user_id = ANY($${params.length}::uuid[])`); }
  if (clientIds && clientIds.length) { params.push(clientIds); where.push(`e.client_id = ANY($${params.length}::text[])`); }
  if (eventIds && eventIds.length) { params.push(eventIds); where.push(`e.id = ANY($${params.length}::uuid[])`); }
  const { rows } = await q.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.location, e.manual_location, e.event_type,
            e.status, e.splose_id, e.client_id, e.client_name, e.is_teams_meeting, e.is_deleted, e.custom_metadata,
            to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date,
            COALESCE(tp.display_name, u.name) AS practitioner_name,
            u.work_location_schedule, u.default_work_location,
            ceb.attendance, cem.mmm_zone AS mmm_set_zone, cem.source AS mmm_set_source
       FROM events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
       LEFT JOIN calendar_event_mmm cem ON cem.event_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY e.user_id, e.start_time`, params);
  return rows;
}

/**
 * Non-face-to-face blocks in the period that name clients (migration 076).
 * Their timed work is billed per client as NF2F lines. A block with no timer
 * row is still loaded: if it ended with no time entered and was never
 * resolved (migration 089) its clients are held, never silently billed $0.
 */
async function loadNf2fBlocks(q, orgId, { from, to, practitionerIds, eventIds, tz }) {
  const params = [orgId, from, to, tz];
  const where = [
    'u.organisation_id = $1',
    `((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
    'COALESCE(e.is_deleted, FALSE) = FALSE',
    `e.custom_metadata->'booking'->>'group' = 'nf2f'`,
    HELD_FOR_REVIEW,
  ];
  if (practitionerIds && practitionerIds.length) { params.push(practitionerIds); where.push(`e.user_id = ANY($${params.length}::uuid[])`); }
  if (eventIds && eventIds.length) { params.push(eventIds); where.push(`e.id = ANY($${params.length}::uuid[])`); }
  const { rows } = await q.query(
    `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.status, e.custom_metadata,
            to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date,
            COALESCE(tp.display_name, u.name) AS practitioner_name, ceb.attendance,
            t.event_id AS t_event_id, t.status AS t_status, t.run_started_at, t.accumulated_seconds, t.limit_seconds,
            t.auto_stopped, t.stopped_at, t.non_billable_percent, t.allocation, t.resolution, t.client_seconds
       FROM events e
       JOIN users u ON u.id = e.user_id
       LEFT JOIN event_billing_timers t ON t.event_id = e.id
       LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
       LEFT JOIN calendar_event_billing ceb ON ceb.event_id = e.id
      WHERE ${where.join(' AND ')}
      ORDER BY e.user_id, e.start_time`, params);
  return rows;
}

const NF2F_ACTIVITY = { 'case-noting': 'Case noting', 'case-management': 'Case management', 'resource-prep': 'Resource preparation',
  emails: 'Emails', 'phone-calls': 'Phone calls' };

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
    eventsExamined: events.length, skipped: {}, sessionsIncluded: 0, nf2fIncluded: 0, travelAllocations: 0,
    alreadyInvoiced: 0, excludedByOwner: 0, invoicesCreated: 0, invoicesUpdated: 0,
    itemsNeedAttention: 0, linesAdded: 0, linesUpdated: 0, totalCents: 0,
    sploseActivitiesIncluded: 0, invoicedInSplose: 0, splose: null,
  };
  const skip = reason => { summary.skipped[reason] = (summary.skipped[reason] || 0) + 1; };

  // 0. Splose: read once. Anything Splose must judge is held back when it cannot be read.
  const splose = await SB.loadForRun({ from: opts.from, to: opts.to });
  summary.splose = splose.status;
  const sploseHeld = splose.status !== 'OK';
  const eventScoped = !!(opts.eventIds && opts.eventIds.length);
  if (splose.status === 'OK') {
    await SB.recordSploseHigh(q, orgId, SB.highestNumber([...splose.invoiceNumbers], settings.invoicePrefix));
    // Keep the payer directory current with every Splose invoice (idempotent).
    summary.payerDirectory = await PD.syncFromSplose(q, orgId, { invoices: splose.invoices, contacts: splose.contactList }, opts.userId || null);
  }
  let sploseIssueRaised = false;
  const raiseSploseUnavailable = () => {
    if (sploseIssueRaised) return;
    sploseIssueRaised = true;
    issues.raise('SPLOSE_UNAVAILABLE', { serviceDate: opts.from, extraKey: 'splose',
      message: splose.status === 'NOT_CONNECTED'
        ? 'Splose is not connected, so Opal cannot check what Splose has already invoiced. Sessions synced from Splose are held back. Connect Splose in Settings, then reprocess.'
        : 'Splose could not be read completely, so Opal cannot check what Splose has already invoiced. Sessions synced from Splose and Splose support activities are held back. Reprocess shortly.',
      fixTarget: { kind: 'settings' } });
  };
  if (splose.status === 'UNAVAILABLE' && !eventScoped) raiseSploseUnavailable();
  const sploseInvoicedEventIds = [];
  const sploseInvoicedActivityIds = [];

  // 1b. Non-face-to-face blocks: each client's share of the timed work.
  const nf2fParts = [];
  for (const b of await loadNf2fBlocks(q, orgId, { ...opts, tz })) {
    const clients = NF.blockClients(b);
    if (!clients.length) continue;                                   // no clients = not billable
    if (String(b.status || '').toLowerCase() === 'cancelled' || ['CANCELLED', 'NOT_BILLABLE', 'DID_NOT_ATTEND'].includes(b.attendance)) continue;
    if (new Date(b.end_time) > now) continue;                       // not over yet
    summary.eventsExamined++;
    const timer = b.t_event_id ? await NF.settleRow(q, { event_id: b.t_event_id, status: b.t_status, run_started_at: b.run_started_at,
      accumulated_seconds: b.accumulated_seconds, limit_seconds: b.limit_seconds, auto_stopped: b.auto_stopped,
      stopped_at: b.stopped_at, non_billable_percent: b.non_billable_percent, allocation: b.allocation,
      resolution: b.resolution, client_seconds: b.client_seconds }, now) : null;
    if (timer && timer.resolution === 'DID_NOT_HAPPEN') { skip('nf2f_did_not_happen'); continue; }
    const blockSecs = NF.blockSeconds(b);
    if (NF.needsResolution(timer, clients, b.end_time, now, blockSecs)) {
      // No time entered: hold each client's draft until the clinician says how to bill it.
      for (const c of clients) {
        if (opts.clientIds && opts.clientIds.length && !opts.clientIds.includes(c.clientId)) continue;
        issues.raise('NF2F_UNTIMED', { eventId: b.id, clientId: c.clientId, practitionerId: b.user_id, serviceDate: b.local_date,
          message: timer && timer.resolution === 'PER_CLIENT'
            ? `"${b.title || 'Non-face-to-face'}" on ${S.displayDate(b.local_date)} changed (clients or length) after each client's minutes were entered. Enter them again.`
            : `"${b.title || 'Non-face-to-face'}" on ${S.displayDate(b.local_date)} ended with no time entered. ${b.practitioner_name || 'The clinician'} must claim the block, enter each client's minutes, or mark it as not done.`,
          fixTarget: { kind: 'nf2f', eventId: b.id, date: b.local_date } });
      }
      continue;
    }
    if (timer && timer.status === 'RUNNING') {
      issues.raise('NF2F_TIMER_RUNNING', { eventId: b.id, practitionerId: b.user_id, serviceDate: b.local_date,
        message: `"${b.title || 'Non-face-to-face'}" on ${S.displayDate(b.local_date)} still has its timer running. Stop it to bill the time.`,
        fixTarget: { kind: 'event', eventId: b.id, date: b.local_date } });
      continue;
    }
    // Never more than the block as it is now (a resized block, a FULL_BLOCK answer).
    const timed = timer && timer.resolution === 'FULL_BLOCK' ? blockSecs : Math.min(Number(timer && timer.accumulated_seconds) || 0, blockSecs);
    if (timed <= 0) continue;
    const alloc = NF.allocationFor(timer, clients);
    for (const part of NF.clientParts(timer, clients, timed, blockSecs)) {
      if (part.seconds <= 0) continue;
      if (opts.clientIds && opts.clientIds.length && !opts.clientIds.includes(part.clientId)) continue;
      nf2fParts.push({ ev: { ...b, client_id: part.clientId, client_name: part.clientName }, block: b, part, timed, alloc,
        clientsOnBlock: clients.length, activity: NF2F_ACTIVITY[(b.custom_metadata.booking || {}).kind] || null });
    }
  }

  // 1. Event-level eligibility
  const evaluated = events.map(ev => ({ ev, res: S.evaluateEvent(ev, { now, completionRule: settings.completionRule, hasLocation: !!DR.eventAddress(ev) }) }));
  // 1a. A session synced from Splose that Splose has already invoiced (or marked
  //     do-not-invoice) is Splose's; Opal skips it. Unknown → held, not billed.
  for (const item of evaluated) {
    const { ev, res } = item;
    if (res.state === 'SKIP' || !ev.splose_id || !ev.client_id) continue;
    if (sploseHeld) {
      raiseSploseUnavailable();
      item.res = { ...res, state: 'ISSUE', issues: res.state === 'ISSUE' ? res.issues : [], heldForSplose: true };
      continue;
    }
    const pt = splose.apptPatients.get(`${ev.splose_id}|${ev.client_id}`);
    if (pt && pt.invoiceId) { item.res = { state: 'SKIP', reason: 'invoiced_in_splose' }; sploseInvoicedEventIds.push(ev.id); summary.invoicedInSplose++; }
    else if (pt && pt.doNotInvoice) item.res = { state: 'SKIP', reason: 'splose_do_not_invoice' };
  }
  for (const { ev, res } of evaluated) {
    if (res.state === 'SKIP') skip(res.reason);
    if (res.state === 'ISSUE') {
      for (const type of res.issues) {
        issues.raise(type, {
          eventId: ev.id, clientId: ev.client_id || null, practitionerId: ev.user_id, serviceDate: ev.local_date,
          message: issueMessage(type, ev), fixTarget: { kind: 'event', eventId: ev.id, date: ev.local_date },
        });
      }
    }
  }

  // 1c. Splose support activities in the period (not for an event-scoped run).
  const activityParts = [];
  if (splose.status === 'OK' && !eventScoped) {
    const pmap = await SB.practitionerMap(q, orgId);
    for (const x of SB.activitiesInRange(splose, { from: opts.from, to: opts.to, tz })) {
      if (opts.clientIds && opts.clientIds.length && !opts.clientIds.includes(x.clientId)) continue;
      const prac = x.practitionerSploseId ? pmap.get(x.practitionerSploseId) || null : null;
      if (opts.practitionerIds && opts.practitionerIds.length && !(prac && opts.practitionerIds.includes(prac.userId))) continue;
      x.practitioner = prac;
      x.clientName = (splose.patients.get(x.clientId) || {}).fullName || null;
      if (x.skip) {
        skip(x.skip);
        if (x.skip === 'invoiced_in_splose') { sploseInvoicedActivityIds.push(x.id); summary.invoicedInSplose++; }
        continue;
      }
      summary.eventsExamined++;
      const what = `${x.serviceTitle || 'Support activity'} on ${S.displayDate(x.date)}`;
      if (!prac) {
        x.blocked = true;
        issues.raise('SPLOSE_ACTIVITY_PRACTITIONER_UNMAPPED', { clientId: x.clientId, serviceDate: x.date, extraKey: x.id,
          message: `${x.clientName || 'Client'}'s Splose ${what} is by a Splose practitioner who is not linked to a portal user. Link them in Users & Roles, then reprocess.`,
          fixTarget: { kind: 'users' } });
      } else {
        // Work timed on an Opal non-face-to-face block for the same client at the same time is the same work: Opal's timer wins.
        const start = Date.parse(x.activity.start), end = Date.parse(x.activity.end);
        const dup = nf2fParts.find(n => n.block.user_id === prac.userId && n.part.clientId === x.clientId
          && Date.parse(n.block.start_time) < end && Date.parse(n.block.end_time) > start);
        if (dup) {
          skip('duplicates_nf2f');
          issues.raise('SPLOSE_ACTIVITY_DUPLICATES_NF2F', { clientId: x.clientId, practitionerId: prac.userId, serviceDate: x.date, extraKey: x.id,
            message: `${x.clientName || 'Client'}'s Splose ${what} overlaps the timed non-face-to-face block "${dup.block.title || 'Non-face-to-face'}". Only the Opal timer is billed.`,
            fixTarget: { kind: 'event', eventId: dup.block.id, date: x.date } });
          continue;
        }
      }
      activityParts.push(x);
    }
  }

  // 2. Profiles (stub on first sight). Only a telehealth session with no zone set
  //    falls back to the client's own address, so only those profiles are classified (may geocode).
  const clientNames = new Map();
  const profileZoneClients = new Set();
  for (const { ev, res } of evaluated) {
    if (res.state === 'SKIP' || !ev.client_id) continue;
    if (!clientNames.has(ev.client_id)) clientNames.set(ev.client_id, ev.client_name);
    if (res.telehealth && ev.mmm_set_zone == null) profileZoneClients.add(ev.client_id);
  }
  // Non-face-to-face work has no session address: it is priced at the client's own zone.
  for (const n of nf2fParts) {
    if (!clientNames.has(n.part.clientId)) clientNames.set(n.part.clientId, n.part.clientName);
    profileZoneClients.add(n.part.clientId);
  }
  for (const x of activityParts) {
    if (!clientNames.has(x.clientId)) clientNames.set(x.clientId, x.clientName);
    profileZoneClients.add(x.clientId);
  }
  await BP.ensureStubProfiles(q, orgId, [...clientNames].map(([clientId, clientName]) => ({ clientId, clientName })));
  const profiles = await BP.getProfilesByClient(q, orgId, [...clientNames.keys()]);
  // Blank NDIS number / address / management from Splose, and a blank payer from the
  // payer directory's history, which still answers with Splose switched off. Never owner data.
  for (const [cid, p] of profiles) {
    if (SB.needsFill(p)) profiles.set(cid, (await SB.fillProfile(q, orgId, p, splose.status === 'OK' ? splose : null, opts.userId)).profile);
  }
  for (const cid of profileZoneClients) if (profiles.has(cid)) profiles.set(cid, await MMM.ensureClassified(q, profiles.get(cid)));
  const cards = await RC.loadRateCards(q, orgId);

  // 3. Client-level checks + pricing per event
  const sessions = []; // billable or calc-blocked, not skipped
  for (const { ev, res } of evaluated) {
    if (res.state === 'SKIP') continue;
    const p = ev.client_id ? profiles.get(ev.client_id) : null;
    const entry = { ev, res, profile: p, blocked: res.state === 'ISSUE', recipientIssues: [] };
    if (p) {
      // An event already blocked (no location, no client…) is not zoned — its own issue says why.
      const zone = res.state === 'ISSUE' ? { mmm: null } : sessionZone(ev, res, p);
      const mmm = zone.mmm;
      entry.mmm = mmm;
      entry.mmmSnapshot = zone.snapshot || null;
      if (res.state === 'ISSUE') {
        entry.blocked = true;
      } else if (mmm == null) {
        entry.blocked = true;
        if (zone.issue) {
          issues.raise(zone.issue, { eventId: ev.id, clientId: ev.client_id, practitionerId: ev.user_id, serviceDate: ev.local_date,
            message: sessionZoneMessage(zone, ev, p), fixTarget: { kind: 'event', eventId: ev.id, date: ev.local_date } });
        } else {
          const type = !p.service_address ? 'CLIENT_ADDRESS_MISSING' : (p.mmm_zone && p.mmm_confidence === 'REVIEW' ? 'MMM_REVIEW' : 'MMM_UNRESOLVED');
          issues.raise(type, { clientId: ev.client_id, message: issueMessage(type, ev, p), fixTarget: { kind: 'client', clientId: ev.client_id } });
        }
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

  // 3b. Non-face-to-face shares: the client's zone, the session rate, the client's payer.
  const nf2f = [];
  for (const n of nf2fParts) {
    const p = profiles.get(n.part.clientId);
    const entry = { ...n, profile: p, blocked: false, recipientIssues: [] };
    const mmm = MMM.effectiveMmm(p);
    entry.mmm = mmm;
    entry.mmmSnapshot = mmm == null ? null : { ...MMM.mmmSnapshot(p), source: 'client profile (non-face-to-face)' };
    if (mmm == null) {
      entry.blocked = true;
      const type = !p || !p.service_address ? 'CLIENT_ADDRESS_MISSING' : (p.mmm_zone && p.mmm_confidence === 'REVIEW' ? 'MMM_REVIEW' : 'MMM_UNRESOLVED');
      issues.raise(type, { clientId: n.part.clientId, message: issueMessage(type, n.ev, p), fixTarget: { kind: 'client', clientId: n.part.clientId } });
    } else {
      entry.rate = RC.resolveRule(cards, { serviceDate: n.block.local_date, mmm, discipline: 'OT' });
      if (!entry.rate) {
        entry.blocked = true;
        issues.raise('RATE_UNAVAILABLE', { eventId: n.block.id, clientId: n.part.clientId, practitionerId: n.block.user_id,
          serviceDate: n.block.local_date, message: issueMessage('RATE_UNAVAILABLE', n.ev, p, mmm), fixTarget: { kind: 'rate_cards' } });
      }
    }
    entry.payer = BP.resolvePayer(p);
    if (!entry.payer) {
      entry.recipientIssues.push('CLIENT_MISSING_PAYER');
      issues.raise('CLIENT_MISSING_PAYER', { clientId: n.part.clientId, message: issueMessage('CLIENT_MISSING_PAYER', n.ev, p), fixTarget: { kind: 'client', clientId: n.part.clientId } });
    }
    if (BP.ndisNumberRequired(p) && !(p && p.ndis_number)) {
      entry.recipientIssues.push('NDIS_NUMBER_MISSING');
      issues.raise('NDIS_NUMBER_MISSING', { clientId: n.part.clientId, message: issueMessage('NDIS_NUMBER_MISSING', n.ev, p), fixTarget: { kind: 'client', clientId: n.part.clientId } });
    }
    nf2f.push(entry);
  }

  // 3c. Splose support activities: the client's zone, the session rate, Splose's item code, the client's payer.
  const activities = [];
  for (const x of activityParts) {
    const p = profiles.get(x.clientId);
    const entry = { ...x, profile: p, blocked: !!x.blocked, recipientIssues: [] };
    const zone = clientZone(p);
    entry.mmm = zone.mmm;
    entry.mmmSnapshot = zone.snapshot;
    const ev = { client_name: x.clientName, local_date: x.date };
    if (zone.mmm == null) {
      entry.blocked = true;
      const type = !p || !p.service_address ? 'CLIENT_ADDRESS_MISSING' : (p.mmm_zone && p.mmm_confidence === 'REVIEW' ? 'MMM_REVIEW' : 'MMM_UNRESOLVED');
      issues.raise(type, { clientId: x.clientId, message: issueMessage(type, ev, p), fixTarget: { kind: 'client', clientId: x.clientId } });
    } else {
      entry.rate = RC.resolveRule(cards, { serviceDate: x.date, mmm: zone.mmm, discipline: 'OT' });
      if (!entry.rate) {
        entry.blocked = true;
        issues.raise('RATE_UNAVAILABLE', { clientId: x.clientId, serviceDate: x.date, extraKey: x.id,
          message: issueMessage('RATE_UNAVAILABLE', ev, p, zone.mmm), fixTarget: { kind: 'rate_cards' } });
      } else if (x.activity.itemCode && SB.baseItemCode(x.activity.itemCode) !== entry.rate.rule.sessionItemCode) {
        entry.blocked = true;
        issues.raise('SPLOSE_ACTIVITY_ITEM_UNSUPPORTED', { clientId: x.clientId, serviceDate: x.date, extraKey: x.id,
          message: `${x.clientName || 'Client'}'s Splose ${x.serviceTitle || 'support activity'} on ${S.displayDate(x.date)} uses support item ${x.activity.itemCode}, which the rate card does not price (it prices ${entry.rate.rule.sessionItemCode}). Bill it by hand or add a rate card for it.`,
          fixTarget: { kind: 'rate_cards' } });
      }
    }
    entry.payer = BP.resolvePayer(p);
    if (!entry.payer) {
      entry.recipientIssues.push('CLIENT_MISSING_PAYER');
      issues.raise('CLIENT_MISSING_PAYER', { clientId: x.clientId, message: issueMessage('CLIENT_MISSING_PAYER', ev, p), fixTarget: { kind: 'client', clientId: x.clientId } });
    }
    if (BP.ndisNumberRequired(p) && !(p && p.ndis_number)) {
      entry.recipientIssues.push('NDIS_NUMBER_MISSING');
      issues.raise('NDIS_NUMBER_MISSING', { clientId: x.clientId, message: issueMessage('NDIS_NUMBER_MISSING', ev, p), fixTarget: { kind: 'client', clientId: x.clientId } });
    }
    activities.push(entry);
  }

  // 4. Travel: one route per practitioner-day over its in-person sessions —
  //    except remote (MMM6–7) sessions inside a trip with total travel hours
  //    (migration 093, rule 11): the trip's hours ÷ clients seen on the trip.
  const tripsWithHours = [];
  {
    const { rows } = await q.query(
      `SELECT t.id, t.name, t.travel_hours, to_char(t.start_date,'YYYY-MM-DD') AS start_date, to_char(t.end_date,'YYYY-MM-DD') AS end_date,
              ARRAY(SELECT tp.user_id::text FROM trip_practitioners tp WHERE tp.trip_id = t.id) AS practitioners
         FROM trips t
        WHERE t.organisation_id = $1 AND t.travel_hours IS NOT NULL AND t.start_date <= $3::date AND t.end_date >= $2::date`,
      [orgId, opts.from, opts.to]);
    tripsWithHours.push(...rows);
  }
  const tripOf = s => tripsWithHours.find(t => t.practitioners.includes(String(s.ev.user_id))
    && s.ev.local_date >= t.start_date && s.ev.local_date <= t.end_date) || null;
  const tripPools = new Map();
  const days = new Map();
  for (const s of sessions) {
    if (s.res.telehealth || !s.ev.client_id) continue;
    const trip = s.mmm != null && T.zoneGroup(s.mmm) === 'R' ? tripOf(s) : null;
    if (trip) {
      // Billed by its trip (Generate Trip Invoices). A weekly run leaves its travel alone.
      if (opts.trip && String(opts.trip.id) === String(trip.id)) {
        if (!tripPools.has(trip.id)) tripPools.set(trip.id, { trip, list: [] });
        tripPools.get(trip.id).list.push(s);
      } else {
        s.travelByTrip = trip.id;
      }
      continue;
    }
    const key = `${s.ev.user_id}|${s.ev.local_date}`;
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(s);
  }
  const dayPlans = [];
  const pairs = [];
  // Desk work the therapist chose to do "at home" (travel.desk = 'home') is a mid-day detour.
  const deskHome = new Map();
  if (days.size) {
    const users = [...new Set([...days.keys()].map(k => k.split('|')[0]))];
    const { rows: desk } = await q.query(
      `SELECT e.user_id, e.start_time, e.end_time,
              to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date
         FROM events e
        WHERE e.user_id = ANY($1::uuid[]) AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND e.custom_metadata->'travel'->>'desk' = 'home'
          AND ((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date`,
      [users, opts.from, opts.to, tz]);
    for (const r of desk) {
      const k = `${r.user_id}|${r.local_date}`;
      if (!deskHome.has(k)) deskHome.set(k, []);
      deskHome.get(k).push(r);
    }
  }
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
    // Rule book: travel time is client-to-client driving only (mid-day detours billed as the direct drive).
    const route = DR.buildDayLegs({ user: list[0].ev, date, sessions: ordered, minutesFor, clientToClient: true,
      deskHome: deskHome.get(key) || [] });
    if (route.baseUnset) {
      issues.raise('WORK_LOCATION_NOT_SET', { practitionerId: userId, serviceDate: date, extraKey: userId,
        message: `No work location is set for ${list[0].ev.practitioner_name} on ${S.displayDate(date)}, so there is no start or return leg. Set it in My Profile → Work locations, then reprocess.`,
        fixTarget: { kind: 'work_location', userId, date } });
    }
    route.legs.forEach(l => pairs.push({ origin: l.origin, destination: l.destination }));
    (route.detours || []).forEach(dt => dt.legs.forEach(l => pairs.push({ origin: l.origin, destination: l.destination })));
    // Each client's normal commute from the day's base (a mixed-zone day compares against it).
    if (route.base && !route.base.remote && route.base.address) {
      for (const s of list) { const a = DR.eventAddress(s.ev); if (a) pairs.push({ origin: route.base.address, destination: a }, { origin: a, destination: route.base.address }); }
    }
    dayPlans.push({ userId, date, list, route });
  }
  const facts = await RF.resolveRouteFacts(q, orgId, pairs);
  // The calendar's own (traffic-aware) minutes win over the cached lookup, so
  // the invoice bills what the calendar showed (migration 090). Kilometres
  // still come from the route facts — distance does not depend on traffic.
  const calendarMinutes = await CTM.loadForDays(q, dayPlans.map(d => ({ userId: d.userId, date: d.date })));
  for (const d of dayPlans) {
    let failed = false;
    const dayCal = calendarMinutes.get(`${d.userId}|${d.date}`) || null;
    let estimated = 0;
    for (const leg of d.route.legs) {
      const f = facts.get(RF.routeKey(leg.origin, leg.destination));
      const needed = true;            // the trip home is part of the day's total T (rule book)
      let cal = CTM.minutesFor(dayCal, leg.origin, leg.destination);
      // A calendar figure far from the route lookup is not trusted blindly (a bug or a tampered client).
      if (cal != null && f && f.status === 'ok' && !CTM.plausible(cal, f.minutes)) {
        if (needed) {
          failed = true;
          issues.raise('TRAVEL_MINUTES_IMPLAUSIBLE', { eventId: leg.toEventId || leg.fromEventId, practitionerId: d.userId, serviceDate: d.date, extraKey: leg.id,
            clientId: (d.list.find(s => s.ev.id === (leg.toEventId || leg.fromEventId)) || {}).ev?.client_id || null,
            message: `The calendar recorded ${cal} min for ${leg.origin} → ${leg.destination} on ${S.displayDate(d.date)}, but the route is about ${f.minutes} min. Check the day on the calendar, then reprocess.`,
            fixTarget: { kind: 'event', eventId: leg.toEventId || leg.fromEventId, date: d.date } });
        }
        cal = null;
      }
      if (f && f.status === 'ok') {
        leg.minutes = cal != null ? cal : f.minutes; leg.km = f.km; leg.provider = f.provider;
        leg.minutesSource = cal != null ? 'calendar' : 'route lookup';
        if (cal == null && needed && !leg.detour) estimated++;   // a detour's direct drive is a comparison, not a drive
      }
      else if (needed) {
        failed = true;
        issues.raise('TRAVEL_ROUTE_FAILED', { eventId: leg.toEventId || leg.fromEventId, practitionerId: d.userId, serviceDate: d.date, extraKey: leg.id,
          clientId: (d.list.find(s => s.ev.id === (leg.toEventId || leg.fromEventId)) || {}).ev?.client_id || null,
          message: `No route could be calculated for ${S.displayDate(d.date)}: ${leg.origin} → ${leg.destination}. Check both addresses or enter the route manually.`,
          fixTarget: { kind: 'route', origin: leg.origin, destination: leg.destination, date: d.date } });
      }
    }
    if (failed) { d.failed = true; continue; }
    // Mid-day detours: bill the LESSER of the direct drive and the detour (owner, 21 Nov 2026).
    d.reviewNotes = [];
    const minsOf = (o, de) => {
      const c = CTM.minutesFor(dayCal, o, de);
      if (c != null) return c;
      const f = facts.get(RF.routeKey(o, de));
      return f && f.status === 'ok' ? f.minutes : null;
    };
    const placeName = a => String(a || '').split(',').slice(-2, -1)[0]?.replace(/\b(WA|NSW|VIC|QLD|SA|TAS|NT|ACT)\b.*$/, '').trim() || String(a || '').split(',')[0];
    for (const dt of d.route.detours || []) {
      const parts = dt.legs.map(l => minsOf(l.origin, l.destination));
      const detourMin = parts.some(m => m == null) ? null : parts.reduce((x, y) => x + y, 0);
      const leg = d.route.legs.find(l => l.detour === dt);
      const directMin = leg ? leg.minutes : 0;
      const via = dt.via === 'home' ? 'home' : (dt.viaLabel || placeName(dt.viaAddress));
      const fromS = d.list.find(x => x.ev.id === dt.fromEventId), toS = d.list.find(x => x.ev.id === dt.toEventId);
      const fromP = placeName(fromS && DR.eventAddress(fromS.ev)), toP = placeName(toS && DR.eventAddress(toS.ev));
      let billed = directMin, chose = 'direct';
      if (detourMin != null && detourMin < directMin) { billed = detourMin; chose = 'detour'; }
      if (leg) { leg.directMinutes = directMin; leg.detourMinutes = detourMin; leg.minutes = billed; leg.billedAs = chose; }
      d.reviewNotes.push(`${S.displayDate(d.date)}: ${fromP} → ${via} → ${toP} = ${detourMin == null ? 'not priced' : detourMin + ' min'}; direct ${directMin} min; billed the lesser (${billed} min, ${chose}).`);
    }
    if (estimated) {
      issues.raise('TRAVEL_MINUTES_NOT_FROM_CALENDAR', { practitionerId: d.userId, serviceDate: d.date, extraKey: d.userId,
        message: `${estimated} travel leg${estimated === 1 ? '' : 's'} on ${S.displayDate(d.date)} (${d.list[0].ev.practitioner_name}) ${estimated === 1 ? 'was' : 'were'} priced from the route lookup, because the calendar had not recorded ${estimated === 1 ? 'its' : 'their'} minutes. Open that day on the calendar while it shows the travel, then reprocess — or check the minutes on the draft.`,
        fixTarget: { kind: 'event', eventId: d.list[0].ev.id, date: d.date } });
    }
    const inOrder = [...d.list].sort((a, b) => new Date(a.ev.start_time) - new Date(b.ev.start_time));
    d.allocation = T.allocateDay({
      practitionerId: d.userId, date: d.date, legs: d.route.legs,
      sessions: inOrder.map(s => ({ eventId: s.ev.id, clientId: s.ev.client_id, clientName: s.ev.client_name || null, mmm: s.mmm, address: DR.eventAddress(s.ev),
        commuteMinutes: d.route.base && d.route.base.address && !d.route.base.remote ? minsOf(d.route.base.address, DR.eventAddress(s.ev)) : null,
        commuteHomeMinutes: d.route.base && d.route.base.address && !d.route.base.remote ? minsOf(DR.eventAddress(s.ev), d.route.base.address) : null, rule: {
        travelRateCents: s.rate.travelRateCents, travelCapMinutesEachWay: s.rate.travelCapMinutesEachWay,
        rateCardId: s.rate.card.id, rateCardVersion: s.rate.card.version } })),
    });
    for (const a of d.allocation.allocations) {
      a.reviewNotes = [...(d.reviewNotes || []), ...(d.allocation.reviewNotes || [])];
      const s = d.list.find(x => x.ev.id === a.eventId);
      s.travel = { allocation: a, legs: d.allocation.legs, dayPlan: d };
    }
    // A client's second session that day carries no travel of its own (the client
    // counts once); mark it judged so an old travel line on it is cleared.
    for (const s of d.list) if (!s.travel) s.travel = { allocation: null, legs: d.allocation.legs, dayPlan: d };
    const rep = d.allocation.report;
    summary.travelUnbilledMinutes = (summary.travelUnbilledMinutes || 0) + Number(rep.unbilledMinutes || 0);
    if (rep.mixedZones) {
      // Rule 10 (owner decision): draft it, but leave it for review with a note.
      for (const s of d.list) {
        issues.raise('TRAVEL_MIXED_ZONE_DAY', { eventId: s.ev.id, clientId: s.ev.client_id, practitionerId: d.userId, serviceDate: d.date,
          message: `${S.displayDate(d.date)} (${d.list[0].ev.practitioner_name}) mixes MMM zones (${rep.zoneGroups.map(g => ({ A: 'MMM1–3', B: 'MMM4–5', R: 'MMM6–7' })[g]).join(', ')}). Travel was drafted with each metro client at the lesser of the drive in and their normal commute — see the reviewer notes on the travel line before sending.`,
          fixTarget: { kind: 'event', eventId: s.ev.id, date: d.date } });
      }
    }
  }

  // 4b. Remote trips with total travel hours: all of it ÷ clients seen on the trip (rule 11).
  for (const { trip, list } of tripPools.values()) {
    if (list.some(s => s.blocked)) {
      for (const s of list.filter(x => !x.blocked)) {
        issues.raise('TRAVEL_DAY_DEFERRED', { eventId: s.ev.id, clientId: s.ev.client_id, practitionerId: s.ev.user_id, serviceDate: s.ev.local_date,
          message: `Travel for trip "${trip.name}" waits until every session on the trip is billable, so its ${trip.travel_hours} h are divided correctly.`,
          fixTarget: { kind: 'trip', tripId: trip.id } });
      }
      continue;
    }
    const inOrder = [...list].sort((a, b) => new Date(a.ev.start_time) - new Date(b.ev.start_time));
    const minutes = Math.round(Number(trip.travel_hours) * 6000) / 100;
    const pool = T.allocateDay({
      legs: [{ id: `trip:${trip.id}`, kind: 'OUTBOUND', toEventId: inOrder[0].ev.id, minutes, minutesSource: 'trip travel hours' }],
      sessions: inOrder.map(s => ({ eventId: s.ev.id, clientId: s.ev.client_id, clientName: s.ev.client_name || null, mmm: s.mmm,
        address: DR.eventAddress(s.ev), rule: { travelRateCents: s.rate.travelRateCents, travelCapMinutesEachWay: s.rate.travelCapMinutesEachWay,
          rateCardId: s.rate.card.id, rateCardVersion: s.rate.card.version } })),
    });
    const note = `Trip "${trip.name}": ${trip.travel_hours} h of travel (flying + driving) ÷ ${pool.report.clients} client${pool.report.clients === 1 ? '' : 's'} seen on the trip (rule 11).`;
    for (const a of pool.allocations) {
      a.reviewNotes = [note];
      const s = list.find(x => x.ev.id === a.eventId);
      s.travel = { allocation: a, legs: pool.legs, dayPlan: null };
    }
    for (const s of list) if (!s.travel) s.travel = { allocation: null, legs: pool.legs, dayPlan: null };
  }

  // 5. Travel blocks (Smart Booking "Travel", event_type 'travel') are not
  //    priced automatically yet: they could repeat a leg the day route
  //    already bills. Each one with a client is surfaced so it is added by
  //    hand (a manual line) rather than silently left off.
  if (!eventScoped) {
    const tparams = [orgId, opts.from, opts.to, tz];
    let tw = '';
    if (opts.practitionerIds && opts.practitionerIds.length) { tparams.push(opts.practitionerIds); tw = ' AND e.user_id = ANY($5::uuid[])'; }
    const { rows: tblocks } = await q.query(
      `SELECT e.id, e.user_id, e.title, e.start_time, e.end_time, e.custom_metadata,
              to_char(((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date, 'YYYY-MM-DD') AS local_date,
              COALESCE(tp.display_name, u.name) AS practitioner_name
         FROM events e JOIN users u ON u.id = e.user_id LEFT JOIN therapist_profiles tp ON tp.user_id = u.id
        WHERE u.organisation_id = $1 AND e.event_type = 'travel' AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND LOWER(COALESCE(e.status, '')) <> 'cancelled' AND e.end_time <= NOW()
          AND ((e.start_time AT TIME ZONE 'UTC') AT TIME ZONE $4)::date BETWEEN $2::date AND $3::date` + tw, tparams);
    for (const t of tblocks) {
      const b = (t.custom_metadata && t.custom_metadata.booking) || {};
      const clientId = b.clientId != null ? String(b.clientId) : null;
      if (!clientId) continue;                                       // no client: not billable
      if (opts.clientIds && opts.clientIds.length && !opts.clientIds.includes(clientId)) continue;
      const mins = Math.round((new Date(t.end_time) - new Date(t.start_time)) / 60000);
      issues.raise('TRAVEL_BLOCK_NOT_INVOICED', { eventId: t.id, clientId, practitionerId: t.user_id, serviceDate: t.local_date,
        message: `Travel block "${t.title || 'Travel'}" on ${S.displayDate(t.local_date)} (${t.practitioner_name}, ${mins} min) is not priced automatically. If it is not already one of the day's travel legs, add it to ${b.clientName || 'the client'}'s draft as a line.`,
        fixTarget: { kind: 'event', eventId: t.id, date: t.local_date } });
    }
  }

  return { settings, tz, now, sessions, nf2f, activities, issues, summary, profiles, dayPlans,
    splose: { status: splose.status, invoicedEventIds: sploseInvoicedEventIds, invoicedActivityIds: sploseInvoicedActivityIds,
      activitiesJudged: splose.status === 'OK' && !eventScoped } };
}

/**
 * The zone work with no session address (a Splose support activity) is priced
 * at: the client profile's zone (manual override or confident classification),
 * else the WA locality table on the client's service address. Never a guess.
 */
function clientZone(p) {
  const mmm = MMM.effectiveMmm(p);
  if (mmm != null) return { mmm, snapshot: { ...MMM.mmmSnapshot(p), source: 'client profile (support activity)' } };
  if (p && p.service_address) {
    const r = Loc.lookupAddress(p.service_address);
    if (r.confident) {
      return { mmm: r.zone, snapshot: { zone: r.zone, source: 'client address (support activity)', locality: r.locality,
        postcode: r.postcode, matchedBy: r.matchedBy, datasetVersion: r.datasetVersion } };
    }
  }
  return { mmm: null, snapshot: null };
}

/**
 * The MMM zone a session is priced at — where it is delivered:
 *   1. a zone set by hand for this session (Smart Booking or the owner), else
 *   2. the WA MMM 2023 locality table on the session's address, else
 *   3. telehealth only: the client's own zone from their billing profile.
 * In person with no confident lookup → a SESSION_MMM_* issue; nothing is guessed.
 */
function sessionZone(ev, res, profile) {
  if (ev.mmm_set_zone != null) {
    const zone = Number(ev.mmm_set_zone);
    return { mmm: zone, snapshot: { zone, source: ev.mmm_set_source === 'OWNER' ? 'set by owner' : 'set at booking' } };
  }
  if (!res.telehealth) {
    const address = DR.eventAddress(ev);
    const r = Loc.lookupAddress(address);
    if (r.confident) {
      return { mmm: r.zone, snapshot: { zone: r.zone, source: 'session address', locality: r.locality, postcode: r.postcode,
        matchedBy: r.matchedBy, datasetVersion: r.datasetVersion } };
    }
    return { mmm: null, lookup: r, issue: r.zones.length ? 'SESSION_MMM_REVIEW' : 'SESSION_MMM_UNRESOLVED' };
  }
  const mmm = MMM.effectiveMmm(profile);
  return { mmm, snapshot: mmm == null ? null : { ...MMM.mmmSnapshot(profile), source: 'client profile (telehealth)' } };
}

function sessionZoneMessage(zone, ev, p) {
  const who = (p && p.participant_name) || ev.client_name || 'Client';
  const r = zone.lookup;
  const where = r.locality ? `${r.locality}${r.postcode ? ` ${r.postcode}` : ''}` : (r.postcode || DR.eventAddress(ev) || 'no address');
  const zones = r.zones.length ? ` (could be ${r.zones.map(z => `MM${z}`).join(' or ')})` : '';
  return `${who}'s session on ${S.displayDate(ev.local_date)} at ${where}: no MMM zone — ${Loc.reasonText(r.reason)}${zones}. Set the session's zone.`;
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

/** One live claim per event per component — and, for non-face-to-face, per client. */
function claimKey(eventId, component, clientId) {
  return component === 'NF2F' ? `${eventId}|NF2F|${clientId}` : `${eventId}|${component}`;
}

async function loadClaims(tx, eventIds) {
  if (!eventIds.length) return new Map();
  const { rows } = await tx.query(
    `SELECT l.*, i.status AS invoice_status, i.invoice_number
       FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.calendar_event_id = ANY($1::uuid[]) AND l.line_status IN ('ACTIVE','REMOVED')`, [eventIds]);
  return new Map(rows.map(r => [claimKey(r.calendar_event_id, r.component, r.client_id), r]));
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
        item_code, description, duration_minutes, quantity, unit_price, gst_rate, gst_amount, amount, calculation, sort_order,
        splose_activity_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id`,
    [invoiceId, orgId, line.component, extra.eventId || null, extra.clientId || null, extra.practitionerId || null,
      extra.travelAllocationId || null, extra.tripId || null, extra.tripAllocationId || null, line.rateCardId || null,
      line.rateCardVersion ?? null, line.mmm ?? null, line.serviceDate || null, line.itemCode || null,
      line.description.slice(0, 500), line.durationMinutes ?? null, M.qtyToString(line.quantityE4),
      M.fromCents(line.unitCents), gst.rate, M.fromCents(gst.cents), M.fromCents(line.amountCents),
      JSON.stringify(line.calculation || {}), extra.sortOrder || 0, extra.sploseActivityId || null]);
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
  return (t % 100000000) * 10 + ({ SESSION: 1, TRAVEL_LABOUR: 2, TRAVEL_KM: 3, NF2F: 4 }[component] || 5);
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
      M.fromCents(a.vehicleCents || 0), a.directions === 2, a.mmm, a.rateCardId, a.rateCardVersion,
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
  const { settings, sessions, nf2f, activities, issues, summary, profiles } = plan;

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
    const claims = await loadClaims(tx, [...new Set(sessions.map(s => s.ev.id).concat(nf2f.map(n => n.block.id)))]);
    const alreadyCounted = new Set();
    const clientRecipient = new Map(); // clientId → {profile, payer, recipientIssues}

    for (const s of sessions) {
      if (s.blocked) continue;
      const ev = s.ev;
      clientRecipient.set(ev.client_id, { profile: s.profile, payer: s.payer, recipientIssues: s.recipientIssues });
      const planned = [S.buildSessionLine({ serviceDate: ev.local_date, minutes: s.res.minutes, rate: s.rate, mmm: s.mmm,
        sessionLabel: settings.sessionDescription, telehealth: s.res.telehealth, mmmSnapshot: s.mmmSnapshot })];
      if (s.travel && s.travel.allocation) {
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

    // Non-face-to-face: one line per client share, claimed per block per client.
    for (const n of nf2f) {
      if (n.blocked) continue;
      const clientId = n.part.clientId;
      clientRecipient.set(clientId, { profile: n.profile, payer: n.payer, recipientIssues: n.recipientIssues });
      const line = S.buildNf2fLine({ serviceDate: n.block.local_date, seconds: n.part.seconds, rate: n.rate, mmm: n.mmm,
        activity: n.activity, sharePercent: n.part.percent, timedSeconds: n.timed, clientsOnBlock: n.clientsOnBlock,
        nonBillablePercent: n.alloc.nonBillablePercent, mmmSnapshot: n.mmmSnapshot });
      const claim = claims.get(claimKey(n.block.id, 'NF2F', clientId));
      const extra = { eventId: n.block.id, clientId, practitionerId: n.block.user_id, taxTreatment: settings.defaultTaxTreatment,
        tripId: null, sortOrder: sortKey(n.block, 'NF2F') };
      if (claim) {
        if (!OPEN_STATUSES.includes(claim.invoice_status)) { summary.alreadyInvoiced++; continue; }
        if (claim.line_status === 'REMOVED') { summary.excludedByOwner++; continue; }
        book.touch(claim.invoice_id);
        if (claim.is_overridden) continue;
        await updateLine(tx, claim.id, line, extra);
        summary.linesUpdated++;
      } else {
        const invoiceId = await book.forClient(clientId, n.profile, n.payer, { from, to, tripId: null });
        await insertLine(tx, orgId, invoiceId, line, extra);
        summary.linesAdded++;
      }
      summary.nf2fIncluded++;
    }

    // Draft NF2F lines whose block / client share no longer bills (timer reset,
    // client removed, block cancelled or deleted) leave the draft.
    const nf2fKeep = nf2f.map(n => `${n.block.id}|${n.part.clientId}`);
    const nfParams = [orgId, from, to, nf2fKeep];
    let nfScope = '';
    if (opts.practitionerIds && opts.practitionerIds.length) { nfParams.push(opts.practitionerIds); nfScope += ` AND l.practitioner_user_id = ANY($${nfParams.length}::uuid[])`; }
    if (opts.clientIds && opts.clientIds.length) { nfParams.push(opts.clientIds); nfScope += ` AND l.client_id = ANY($${nfParams.length}::text[])`; }
    if (opts.eventIds && opts.eventIds.length) { nfParams.push(opts.eventIds); nfScope += ` AND l.calendar_event_id = ANY($${nfParams.length}::uuid[])`; }
    const { rows: nfDropped } = await tx.query(
      `UPDATE invoice_lines l SET line_status = 'VOIDED', removed_reason = 'Non-face-to-face time no longer billable for this client',
              removed_at = NOW(), updated_at = NOW()
         FROM invoices i
        WHERE i.id = l.invoice_id AND i.organisation_id = $1 AND i.status IN ('DRAFT','NEEDS_ATTENTION')
          AND l.line_status = 'ACTIVE' AND l.component = 'NF2F' AND l.is_overridden IS NOT TRUE
          AND l.service_date BETWEEN $2::date AND $3::date
          AND NOT ((l.calendar_event_id::text || '|' || l.client_id) = ANY($4::text[]))${nfScope}
      RETURNING l.invoice_id, l.id, l.amount`, nfParams);
    for (const d of nfDropped) {
      book.touch(d.invoice_id);
      await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_removed', entityType: 'invoice_line', entityId: d.id,
        invoiceId: d.invoice_id, before: { component: 'NF2F', amount: d.amount }, reason: 'Non-face-to-face time no longer billable for this client' });
    }

    // Splose support activities: one line each, claimed by the Splose activity id.
    const actIds = [...new Set(activities.map(a => a.id).concat(plan.splose.invoicedActivityIds))];
    const actClaims = new Map();
    if (actIds.length) {
      const { rows } = await tx.query(
        `SELECT l.*, i.status AS invoice_status, i.invoice_number FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.organisation_id = $1 AND l.splose_activity_id = ANY($2::text[]) AND l.line_status IN ('ACTIVE','REMOVED')`, [orgId, actIds]);
      for (const r of rows) actClaims.set(r.splose_activity_id, r);
    }
    for (const a of activities) {
      if (a.blocked) continue;
      clientRecipient.set(a.clientId, { profile: a.profile, payer: a.payer, recipientIssues: a.recipientIssues });
      const line = S.buildSploseActivityLine({ serviceDate: a.date, minutes: a.minutes, rate: a.rate, mmm: a.mmm,
        itemCode: a.activity.itemCode || null, serviceTitle: a.serviceTitle, sploseActivityId: a.id,
        splosePricing: a.activity.pricing ?? null, mmmSnapshot: a.mmmSnapshot });
      const claim = actClaims.get(a.id);
      const extra = { clientId: a.clientId, practitionerId: a.practitioner.userId, taxTreatment: settings.defaultTaxTreatment,
        tripId: null, sortOrder: sortKey({ start_time: a.activity.start }, 'SPLOSE_ACTIVITY'), sploseActivityId: a.id };
      if (claim) {
        if (!OPEN_STATUSES.includes(claim.invoice_status)) { summary.alreadyInvoiced++; continue; }
        if (claim.line_status === 'REMOVED') { summary.excludedByOwner++; continue; }
        book.touch(claim.invoice_id);
        if (claim.is_overridden) continue;
        await updateLine(tx, claim.id, line, extra);
        summary.linesUpdated++;
      } else {
        const invoiceId = await book.forClient(a.clientId, a.profile, a.payer, { from, to, tripId: null });
        await insertLine(tx, orgId, invoiceId, line, extra);
        summary.linesAdded++;
      }
      summary.sploseActivitiesIncluded++;
    }
    // Draft activity lines whose activity no longer bills (invoiced in Splose, do-not-invoice, deleted, moved) leave the draft.
    // Only when this run read Splose completely; otherwise nothing is judged.
    if (plan.splose.activitiesJudged) {
      const keep = activities.map(a => a.id);
      const aParams = [orgId, from, to, keep];
      let aScope = '';
      if (opts.practitionerIds && opts.practitionerIds.length) { aParams.push(opts.practitionerIds); aScope += ` AND l.practitioner_user_id = ANY($${aParams.length}::uuid[])`; }
      if (opts.clientIds && opts.clientIds.length) { aParams.push(opts.clientIds); aScope += ` AND l.client_id = ANY($${aParams.length}::text[])`; }
      const { rows: aDropped } = await tx.query(
        `UPDATE invoice_lines l SET line_status = 'VOIDED', removed_reason = 'Splose support activity no longer billable here',
                removed_at = NOW(), updated_at = NOW()
           FROM invoices i
          WHERE i.id = l.invoice_id AND i.organisation_id = $1 AND i.status IN ('DRAFT','NEEDS_ATTENTION')
            AND l.line_status = 'ACTIVE' AND l.component = 'SPLOSE_ACTIVITY' AND l.is_overridden IS NOT TRUE
            AND l.service_date BETWEEN $2::date AND $3::date
            AND NOT (l.splose_activity_id = ANY($4::text[]))${aScope}
        RETURNING l.invoice_id, l.id, l.amount`, aParams);
      for (const d of aDropped) {
        book.touch(d.invoice_id);
        await recordAudit(tx, { orgId, actorUserId: userId, action: 'invoice.line_removed', entityType: 'invoice_line', entityId: d.id,
          invoiceId: d.invoice_id, before: { component: 'SPLOSE_ACTIVITY', amount: d.amount }, reason: 'Splose support activity no longer billable here' });
      }
    }

    // Work Splose has invoiced that is also on a finalised Opal invoice: billed twice. Flag it; never rewrite either.
    const doubleClaims = [];
    if (plan.splose.invoicedEventIds.length) {
      const { rows } = await tx.query(
        `SELECT l.invoice_id, l.client_id, l.service_date, l.calendar_event_id::text AS source_id, i.invoice_number
           FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
          WHERE l.calendar_event_id = ANY($1::uuid[]) AND l.line_status = 'ACTIVE' AND i.status NOT IN ('DRAFT','NEEDS_ATTENTION','VOID')`,
        [plan.splose.invoicedEventIds]);
      doubleClaims.push(...rows);
    }
    for (const id of plan.splose.invoicedActivityIds) {
      const c = actClaims.get(id);
      if (c && c.line_status === 'ACTIVE' && !OPEN_STATUSES.includes(c.invoice_status) && c.invoice_status !== 'VOID') {
        doubleClaims.push({ invoice_id: c.invoice_id, client_id: c.client_id, service_date: c.service_date, source_id: id, invoice_number: c.invoice_number });
      }
    }
    for (const d of doubleClaims) {
      issues.raise('SPLOSE_DOUBLE_BILLED', { clientId: d.client_id, invoiceId: d.invoice_id, serviceDate: ymd(d.service_date), extraKey: d.source_id,
        message: `Work on ${S.displayDate(ymd(d.service_date))} is on Opal invoice ${d.invoice_number} and has also been invoiced in Splose. Void one of them.`,
        fixTarget: { kind: 'invoice', invoiceId: d.invoice_id } });
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
      raisedKeys: issues.list().map(i => i.dedupeKey), clientIds: [...new Set(sessions.map(s => s.ev.client_id).concat(nf2f.map(n => n.part.clientId), activities.map(a => a.clientId)).filter(Boolean))],
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

module.exports = { runInvoicing, prepare, loadCandidateEvents, refreshDraft, insertLine, issueMessage, sessionZone, clientZone, ymd, validRange };
