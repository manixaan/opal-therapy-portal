'use strict';

/**
 * INVOICING ROUTES — owner-only
 *
 * The Invoices tab: the practice's own calendar plus every employee calendar
 * become NDIS claims through ndis-billing-rules.js, reviewed on a week board,
 * then written as invoices individually or in a batch.
 *
 * Every route is owner-only (backend-enforced). Every write is audited.
 * The rules engine is the authority: the browser sends event ids, travel
 * legs and overrides; amounts are always recomputed here.
 */

const express = require('express');
const crypto = require('crypto');
const db = require('./database');
const idb = require('./invoicing-db');
const rules = require('./ndis-billing-rules');
const guide = require('./ndis/ot-price-guide');
const { requireAuth, requireRole } = require('./permissions');
const log = require('./logger').createLogger('invoicing');

const router = express.Router();
const ownerOnly = [requireAuth, requireRole('owner')];

function orgId(req) { return req.user?.organisation_id || null; }
function audit(req, action, targetType, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType, targetId,
    ipAddress: req.ip, organisationId: orgId(req), metadata: metadata || null,
  }).catch(() => {});
}
function safe(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (err) {
      log.error('invoicing route failed', { path: req.path, error: err.message });
      res.status(500).json({ error: 'Invoicing request failed' });
    }
  };
}
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
function isoDate(v) { return typeof v === 'string' && ISO_DATE.test(v) ? v : null; }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ── Settings validation ────────────────────────────────────────────────────
const FUNDING = ['ndia_managed', 'plan_managed', 'self_managed'];
const AGE_BANDS = ['9_plus', 'under_9'];
const BUDGETS = ['capacity_building', 'core', 'employment'];
const AGREEMENT_KEYS = ['telehealth', 'nonF2f', 'ndiaReports', 'cancellations', 'travel'];

function cleanSettings(b) {
  const out = {};
  out.clientName = typeof b.clientName === 'string' ? b.clientName.slice(0, 255) : null;
  out.fundingType = FUNDING.includes(b.fundingType) ? b.fundingType : 'plan_managed';
  out.ageBand = AGE_BANDS.includes(b.ageBand) ? b.ageBand : '9_plus';
  out.budget = BUDGETS.includes(b.budget) ? b.budget : 'capacity_building';
  const mmm = Number(b.mmm); out.mmm = mmm >= 1 && mmm <= 7 ? Math.round(mmm) : 1;
  out.agreedHourlyRate = b.agreedHourlyRate === '' || b.agreedHourlyRate == null ? null : Number(b.agreedHourlyRate);
  if (out.agreedHourlyRate != null && !(out.agreedHourlyRate >= 0 && out.agreedHourlyRate < 10000)) return { error: 'agreedHourlyRate out of range' };
  out.perKmRate = b.perKmRate == null || b.perKmRate === '' ? 0.99 : Number(b.perKmRate);
  if (!(out.perKmRate >= 0 && out.perKmRate < 100)) return { error: 'perKmRate out of range' };
  out.agreement = {};
  AGREEMENT_KEYS.forEach(k => { out.agreement[k] = !!(b.agreement && b.agreement[k]); });
  out.invoiceToName = typeof b.invoiceToName === 'string' ? b.invoiceToName.slice(0, 255) : null;
  out.invoiceToEmail = typeof b.invoiceToEmail === 'string' ? b.invoiceToEmail.slice(0, 255) : null;
  out.ndisNumber = typeof b.ndisNumber === 'string' ? b.ndisNumber.slice(0, 40) : null;
  out.notes = typeof b.notes === 'string' ? b.notes.slice(0, 500) : null;
  return out;
}

function settingsToEventInputs(s) {
  if (!s) return null;
  return {
    profession: 'occupational_therapist',
    ageBand: s.age_band, budget: s.budget, mmm: Number(s.mmm) || 1, providerMmm: 1,
    fundingType: s.funding_type,
    agreedHourlyRate: s.agreed_hourly_rate == null ? undefined : Number(s.agreed_hourly_rate),
    perKmRate: Number(s.per_km_rate) || 0.99,
    agreement: s.agreement || {},
  };
}

// ── Claim building shared by preview, create and batch ─────────────────────
/**
 * @param events  DB rows from getEventsByIds
 * @param settingsByClient  { clientId → settings row }
 * @param inputs  { eventId → { deliveryMode, status, cancelledAt, publicHolidays,
 *                              travel: { minutes, km, participantsOnTrip }, agreedHourlyRate } }
 */
function buildClaimsForEvents(events, settingsByClient, inputs) {
  return events.map(ev => {
    const inp = (inputs && inputs[ev.id]) || {};
    const s = settingsToEventInputs(settingsByClient[String(ev.client_id)]);
    const serviceDate = new Date(ev.start_time).toISOString().slice(0, 10);
    const ident = { eventId: ev.id, clientId: ev.client_id ? String(ev.client_id) : null, clientName: ev.client_name,
                    therapistProfileId: ev.therapist_profile_id, therapistName: ev.therapist_name, serviceDate,
                    alreadyInvoiced: !!ev.already_invoiced };
    if (!ev.client_id) return { ...ident, status: 'blocked', lines: [], warnings: ['event_has_no_client'] };
    if (!s) return { ...ident, status: 'blocked', lines: [], warnings: ['client_billing_settings_missing'] };

    const status = inp.status || (ev.status === 'cancelled' ? 'cancelled' : 'completed');
    const travel = inp.travel && (Number(inp.travel.minutes) > 0 || Number(inp.travel.km) > 0)
      ? { minutesTo: Number(inp.travel.minutes) || 0, kilometres: Number(inp.travel.km) || 0,
          perKmRate: s.perKmRate, participantsOnTrip: 1 }
      : undefined;

    const claim = rules.buildClaim({
      id: ev.id, start: ev.start_time, end: ev.end_time, status,
      deliveryMode: inp.deliveryMode || 'in_person',
      ndiaRequested: inp.ndiaRequested === true,
      ...s,
      agreedHourlyRate: inp.agreedHourlyRate != null ? Number(inp.agreedHourlyRate) : s.agreedHourlyRate,
      cancellation: { cancelledAt: inp.cancelledAt || null, publicHolidays: inp.publicHolidays || [] },
      travel,
    });
    const lines = (claim.lines || []).map(l => ({
      eventId: ev.id, kind: l.kind, itemCode: l.itemCode,
      description: lineDescription(l, ev, serviceDate),
      serviceDate, minutes: l.minutes ?? null,
      quantity: l.kind === 'travel_non_labour' ? l.quantity : l.quantityHours,
      unitAmount: l.unitAmount, priceLimit: l.priceLimit ?? null, amount: l.amount,
      warnings: [],
    }));
    return { ...claim, ...ident, lines };
  });
}

function lineDescription(l, ev, date) {
  const labels = {
    direct: 'Occupational therapy session', telehealth: 'Occupational therapy (telehealth)',
    non_f2f: 'Occupational therapy (non-face-to-face)', ndia_report: 'NDIA requested report',
    cancellation: 'Short notice cancellation', travel_labour: 'Provider travel',
    travel_non_labour: 'Provider travel - non-labour costs',
  };
  const mins = l.minutes ? ` ${l.minutes} min` : '';
  return `${labels[l.kind] || l.kind}${mins} - ${date}`;
}

async function loadSettingsMap(org, events) {
  const ids = [...new Set(events.map(e => e.client_id).filter(Boolean).map(String))];
  const map = {};
  for (const id of ids) { const s = await idb.getClientSettings(org, id); if (s) map[id] = s; }
  return map;
}

// ── Reference data ─────────────────────────────────────────────────────────
router.get('/api/invoicing/therapists', ...ownerOnly, safe(async (req, res) => {
  res.json({ therapists: await idb.listTherapists(orgId(req)) });
}));

// ── Client settings ────────────────────────────────────────────────────────
router.get('/api/invoicing/clients', ...ownerOnly, safe(async (req, res) => {
  res.json({ clients: await idb.listClientSettings(orgId(req)) });
}));
router.get('/api/invoicing/clients/:clientId', ...ownerOnly, safe(async (req, res) => {
  const s = await idb.getClientSettings(orgId(req), req.params.clientId);
  if (!s) return res.status(404).json({ error: 'No billing settings for this client yet' });
  res.json({ settings: s });
}));
router.put('/api/invoicing/clients/:clientId', ...ownerOnly, safe(async (req, res) => {
  const clean = cleanSettings(req.body || {});
  if (clean.error) return res.status(400).json({ error: clean.error });
  const s = await idb.upsertClientSettings(orgId(req), req.params.clientId, clean, req.user.id);
  await audit(req, 'invoicing.client_settings_saved', 'invoice_client_settings', s.id, { clientId: req.params.clientId });
  res.json({ settings: s });
}));

// ── Week board ─────────────────────────────────────────────────────────────
router.get('/api/invoicing/week', ...ownerOnly, safe(async (req, res) => {
  const start = isoDate(req.query.start);
  if (!start) return res.status(400).json({ error: 'start=YYYY-MM-DD required' });
  const end = addDays(start, 7);
  const therapistIds = typeof req.query.therapistIds === 'string' && req.query.therapistIds
    ? req.query.therapistIds.split(',').filter(Boolean) : null;
  const events = await idb.listBillableEvents(orgId(req), { start, end: end + 'T00:00:00Z', therapistProfileIds: therapistIds });
  const settings = await loadSettingsMap(orgId(req), events);
  const claims = buildClaimsForEvents(events, settings, {});
  res.json({
    start, end,
    therapists: await idb.listTherapists(orgId(req)),
    events: events.map(e => ({
      id: e.id, title: e.title, start: e.start_time, end: e.end_time, location: e.location,
      status: e.status, clientId: e.client_id, clientName: e.client_name,
      therapistProfileId: e.therapist_profile_id, therapistName: e.therapist_name, therapistColour: e.therapist_colour,
      travelMinutes: e.travel_time_minutes, travelKm: e.travel_distance,
      invoicedNumber: e.invoiced_number || null, invoicedInvoiceId: e.invoiced_invoice_id || null,
      hasSettings: !!settings[String(e.client_id)],
    })),
    claims,
  });
}));

// ── Preview (no writes) ────────────────────────────────────────────────────
/**
 * Body: { eventIds: [...], inputs: { eventId: {...} }, days: [ { sessions:[{eventId, legMinutes, legKm}], returnMinutes, returnKm, returnPaid } ] }
 * `days` pools travel per therapist-day (PAPL p.25) and feeds each session's share into inputs.travel.
 */
function applyDayTravel(body, inputs) {
  const dayPlans = [];
  (Array.isArray(body.days) ? body.days : []).forEach(d => {
    const plan = rules.planDayTravel(d);
    dayPlans.push({ ...plan, key: d.key || null });
    Object.entries(plan.shares).forEach(([eventId, share]) => {
      inputs[eventId] = { ...(inputs[eventId] || {}), travel: { minutes: share.minutes, km: share.km } };
    });
  });
  return dayPlans;
}

router.post('/api/invoicing/preview', ...ownerOnly, safe(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.eventIds) ? body.eventIds.filter(x => typeof x === 'string').slice(0, 500) : [];
  if (!ids.length) return res.status(400).json({ error: 'eventIds required' });
  const inputs = { ...(body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) };
  const dayPlans = applyDayTravel(body, inputs);
  const events = await idb.getEventsByIds(orgId(req), ids);
  const settings = await loadSettingsMap(orgId(req), events);
  const claims = buildClaimsForEvents(events, settings, inputs);
  res.json({ claims, dayPlans, missingEvents: ids.filter(id => !events.some(e => e.id === id)) });
}));

// ── Create (individual) ────────────────────────────────────────────────────
async function createFromClaims(req, { clientId, claims, settings, issueDate, dueDate, periodStart, periodEnd, batchId, notes }) {
  const usable = claims.filter(c => c.clientId === String(clientId) && (c.status === 'ready' || c.status === 'needs_review'));
  if (!usable.length) return { error: 'no_claimable_events' };
  if (usable.some(c => c.alreadyInvoiced)) return { error: 'event_already_invoiced' };
  const lines = usable.flatMap(c => c.lines);
  const warnings = [...new Set(usable.flatMap(c => c.warnings || []))];
  const therapists = [...new Set(usable.map(c => c.therapistProfileId).filter(Boolean))];
  const s = settings[String(clientId)] || {};
  const invoice = await idb.createInvoice(orgId(req), {
    clientId, clientName: s.client_name || usable[0].clientName,
    invoiceToName: s.invoice_to_name || null, invoiceToEmail: s.invoice_to_email || null,
    practitionerProfileId: therapists.length === 1 ? therapists[0] : null,
    practitionerName: therapists.length === 1 ? usable[0].therapistName : (therapists.length > 1 ? 'Multiple' : null),
    issueDate, dueDate, periodStart, periodEnd, batchId, warnings, notes,
  }, lines, req.user.id);
  await audit(req, 'invoicing.invoice_created', 'invoice', invoice.id, {
    invoiceNumber: invoice.invoice_number, lines: lines.length, total: invoice.total, batchId: batchId || null,
    needsReview: usable.some(c => c.status === 'needs_review'),
  });
  return { invoice };
}

router.post('/api/invoicing/invoices', ...ownerOnly, safe(async (req, res) => {
  const body = req.body || {};
  const clientId = body.clientId != null ? String(body.clientId) : null;
  const ids = Array.isArray(body.eventIds) ? body.eventIds.filter(x => typeof x === 'string').slice(0, 200) : [];
  const issueDate = isoDate(body.issueDate) || new Date().toISOString().slice(0, 10);
  const dueDate = isoDate(body.dueDate) || addDays(issueDate, 14);
  if (!clientId || !ids.length) return res.status(400).json({ error: 'clientId and eventIds required' });

  const inputs = { ...(body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) };
  applyDayTravel(body, inputs);
  const events = await idb.getEventsByIds(orgId(req), ids);
  if (events.some(e => String(e.client_id) !== clientId)) return res.status(400).json({ error: 'All events must belong to the invoiced client' });
  const settings = await loadSettingsMap(orgId(req), events);
  const claims = buildClaimsForEvents(events, settings, inputs);
  if (claims.some(c => c.status === 'blocked')) {
    return res.status(422).json({ error: 'Some events cannot be billed yet', claims });
  }
  const dates = claims.map(c => c.serviceDate).sort();
  let out;
  try {
    out = await createFromClaims(req, { clientId, claims, settings, issueDate, dueDate,
      periodStart: dates[0], periodEnd: dates[dates.length - 1], notes: typeof body.notes === 'string' ? body.notes.slice(0, 1000) : null });
  } catch (err) {
    if (err.code === 'event_already_invoiced') return res.status(409).json({ error: 'An event is already on a live invoice' });
    throw err;
  }
  if (out.error === 'event_already_invoiced') return res.status(409).json({ error: 'An event is already on a live invoice' });
  if (out.error) return res.status(422).json({ error: out.error, claims });
  res.status(201).json({ invoice: await idb.getInvoice(orgId(req), out.invoice.id), claims });
}));

// ── Batch (one invoice per client for a set of events) ─────────────────────
router.post('/api/invoicing/batch', ...ownerOnly, safe(async (req, res) => {
  const body = req.body || {};
  const ids = Array.isArray(body.eventIds) ? body.eventIds.filter(x => typeof x === 'string').slice(0, 1000) : [];
  const issueDate = isoDate(body.issueDate) || new Date().toISOString().slice(0, 10);
  const dueDate = isoDate(body.dueDate) || addDays(issueDate, 14);
  if (!ids.length) return res.status(400).json({ error: 'eventIds required' });
  const inputs = { ...(body.inputs && typeof body.inputs === 'object' ? body.inputs : {}) };
  applyDayTravel(body, inputs);
  const events = await idb.getEventsByIds(orgId(req), ids);
  const settings = await loadSettingsMap(orgId(req), events);
  const claims = buildClaimsForEvents(events, settings, inputs);
  const batchId = crypto.randomUUID();

  const byClient = {};
  claims.forEach(c => { if (c.clientId) (byClient[c.clientId] = byClient[c.clientId] || []).push(c); });
  const created = [], skipped = [];
  for (const [clientId, cs] of Object.entries(byClient)) {
    const blocked = cs.filter(c => c.status === 'blocked' || c.alreadyInvoiced);
    const usable = cs.filter(c => !blocked.includes(c) && c.status !== 'not_claimable');
    if (!usable.length) { skipped.push({ clientId, clientName: cs[0].clientName, reason: blocked.length ? 'blocked' : 'nothing_claimable', warnings: [...new Set(cs.flatMap(c => c.warnings))] }); continue; }
    const dates = usable.map(c => c.serviceDate).sort();
    try {
      const out = await createFromClaims(req, { clientId, claims: usable, settings, issueDate, dueDate, periodStart: dates[0], periodEnd: dates[dates.length - 1], batchId });
      if (out.invoice) created.push({ id: out.invoice.id, invoiceNumber: out.invoice.invoice_number, clientId, clientName: out.invoice.client_name, total: out.invoice.total, status: out.invoice.status, needsReview: usable.some(c => c.status === 'needs_review'), skippedEvents: blocked.length });
      else skipped.push({ clientId, clientName: cs[0].clientName, reason: out.error });
    } catch (err) {
      if (err.code !== 'event_already_invoiced') log.error('batch invoice failed for a client', { error: err.message });
      skipped.push({ clientId, clientName: cs[0].clientName, reason: err.code === 'event_already_invoiced' ? 'event_already_invoiced' : 'error' });
    }
  }
  await audit(req, 'invoicing.batch_run', 'invoice_batch', batchId, { created: created.length, skipped: skipped.length, events: ids.length });
  res.status(created.length ? 201 : 200).json({ batchId, created, skipped });
}));

// ── Invoice list / detail / status ─────────────────────────────────────────
router.get('/api/invoicing/invoices', ...ownerOnly, safe(async (req, res) => {
  const status = typeof req.query.status === 'string' && Object.keys(idb.STATUS_FLOW).includes(req.query.status) ? req.query.status : null;
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : null;
  res.json({ invoices: await idb.listInvoices(orgId(req), { status, q }) });
}));
router.get('/api/invoicing/invoices/:id', ...ownerOnly, safe(async (req, res) => {
  const inv = await idb.getInvoice(orgId(req), req.params.id);
  if (!inv) return res.status(404).json({ error: 'Invoice not found' });
  res.json({ invoice: inv });
}));
router.post('/api/invoicing/invoices/:id/status', ...ownerOnly, safe(async (req, res) => {
  const status = req.body && req.body.status;
  if (!Object.keys(idb.STATUS_FLOW).includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const out = await idb.setInvoiceStatus(orgId(req), req.params.id, status);
  if (out.error === 'not_found') return res.status(404).json({ error: 'Invoice not found' });
  if (out.error) return res.status(409).json({ error: `Cannot move from ${out.from} to ${status}` });
  await audit(req, 'invoicing.invoice_status', 'invoice', req.params.id, { status });
  res.json({ invoice: out.invoice });
}));

// ── Rule book + simulator (pure; no DB) ────────────────────────────────────
router.get('/api/invoicing/rulebook', ...ownerOnly, (req, res) => {
  const fy = rules.financialYearFor(new Date());
  const ot = guide.SUPPORT_ITEMS.find(i => i.code === '15_617_0128_1_3');
  res.json({
    financialYear: fy,
    sources: guide.FINANCIAL_YEARS,
    otPrices: ot ? ot.prices : {},
    claimTypes: guide.CLAIM_TYPES,
    mmm: guide.MMM_ZONES,
    rules: guide.CLAIMING_RULES,
    examples: {
      threeClientRun: simulate({
        mmm: 1, sessions: [
          { label: 'Client A', minutes: 60, legMinutes: 20, legKm: 15 },
          { label: 'Client B', minutes: 60, legMinutes: 15, legKm: 10 },
          { label: 'Client C', minutes: 60, legMinutes: 25, legKm: 20 },
        ], returnMinutes: 30, returnKm: 25, returnPaid: true,
      }),
      longRun: simulate({
        mmm: 1, sessions: [
          { label: 'Client A', minutes: 45, legMinutes: 40, legKm: 35 },
          { label: 'Client B', minutes: 60, legMinutes: 35, legKm: 30 },
        ], returnMinutes: 45, returnKm: 40, returnPaid: true,
      }),
      remoteRun: simulate({
        mmm: 6, sessions: [{ label: 'Client A', minutes: 90, legMinutes: 110, legKm: 120 }],
        returnMinutes: 110, returnKm: 120, returnPaid: true,
      }),
    },
  });
});

function simulate(q) {
  const date = q.date || new Date().toISOString().slice(0, 10);
  const mmm = Number(q.mmm) || 1;
  const rate = q.agreedHourlyRate != null ? Number(q.agreedHourlyRate) : undefined;
  const perKm = q.perKmRate != null ? Number(q.perKmRate) : 0.99;
  const sessions = (Array.isArray(q.sessions) ? q.sessions : []).slice(0, 12).map((s, i) => ({
    eventId: 's' + i, label: String(s.label || ('Client ' + (i + 1))).slice(0, 40),
    minutes: Math.max(5, Math.min(600, Number(s.minutes) || 60)),
    legMinutes: Math.max(0, Number(s.legMinutes) || 0), legKm: Math.max(0, Number(s.legKm) || 0),
    billable: s.billable !== false,
  }));
  const plan = rules.planDayTravel({ sessions, returnMinutes: q.returnMinutes, returnKm: q.returnKm, returnPaid: q.returnPaid !== false });
  const clients = sessions.map(s => {
    const share = plan.shares[s.eventId];
    const start = new Date(date + 'T01:00:00Z');
    const claim = rules.buildClaim({
      id: s.eventId, start, end: new Date(start.getTime() + s.minutes * 60000),
      status: s.billable ? 'completed' : 'cancelled', deliveryMode: 'in_person',
      profession: 'occupational_therapist', ageBand: '9_plus', mmm, fundingType: 'plan_managed',
      agreedHourlyRate: rate, agreement: { travel: true, cancellations: true },
      cancellation: { cancelledAt: null, publicHolidays: [] },
      travel: share ? { minutesTo: share.minutes, kilometres: share.km, perKmRate: perKm } : undefined,
    });
    return { label: s.label, minutes: s.minutes, share, claim };
  });
  return { plan, clients, dayTotal: Math.round(clients.reduce((t, c) => t + (c.claim.total || 0), 0) * 100) / 100 };
}

router.post('/api/invoicing/simulate', ...ownerOnly, (req, res) => {
  res.json(simulate(req.body || {}));
});

module.exports = router;
module.exports._internal = { buildClaimsForEvents, simulate, cleanSettings };
