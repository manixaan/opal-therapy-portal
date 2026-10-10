'use strict';

/**
 * SMART BOOKING LOCATIONS — where a client is seen, and where a clinician goes.
 *
 *   GET  /api/client-locations/:clientId            every known location for a client
 *   POST /api/client-locations/:clientId            add one (deduplicated)
 *   POST /api/client-locations/:clientId/:id/used   a booking used a saved location
 *   GET  /api/travel-destinations                   the caller's remembered non-client destinations
 *   POST /api/travel-destinations                   remember one (deduplicated, bumps use)
 *
 * Rules, fail-closed:
 *   • only accounts that schedule (manage_own_schedule / manage_all_schedules)
 *     — read_only and pre_employee are refused;
 *   • a client is reachable only through splose-caseload.loadOwnClient: a
 *     therapist sees their own open-case clients, owner/admin the practice.
 *     "Not yours" and "does not exist" are the same 404;
 *   • Splose stays authoritative for the client's own address — it is read
 *     live and returned with source 'splose', never written to the portal;
 *   • destinations belong to the clinician who saved them and never name a
 *     client.
 *
 * Audit entries carry ids only — never an address.
 */

const express = require('express');
const db = require('./database');
const caseload = require('./splose-caseload');
const store = require('./client-locations-db');
const { requireAuth, requireAnyPermission } = require('./permissions');

const router = express.Router();
const SCHEDULERS = requireAnyPermission('manage_own_schedule', 'manage_all_schedules');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.use('/api/client-locations', requireAuth, SCHEDULERS);
router.use('/api/travel-destinations', requireAuth, SCHEDULERS);

const safe = (fn) => (req, res) => fn(req, res).catch((err) => {
  if (err instanceof caseload.CaseloadError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  console.error(`[client-locations] ${req.method} ${req.route && req.route.path} failed:`, err.message);
  res.status(500).json({ error: 'Locations are unavailable right now' });
});

/** The client, if the caller may book them; otherwise the response is sent. */
async function authorisedClient(req, res) {
  let client;
  try {
    client = await caseload.loadOwnClient(req, req.params.clientId);
  } catch (err) {
    if (err instanceof caseload.CaseloadError) throw err;
    res.status(502).json({ error: "Couldn't check this client in Splose just now.", code: 'client_lookup_failed' });
    return null;
  }
  if (!client) { res.status(404).json({ error: 'Client not found' }); return null; }
  return client;
}

const managesAll = (req) => req.user && (req.user.role === 'owner' || req.user.role === 'admin');

router.get('/api/client-locations/:clientId', safe(async (req, res) => {
  const client = await authorisedClient(req, res);
  if (!client) return;
  const orgId = req.user.organisation_id || null;
  const [saved, previous] = await Promise.all([
    store.listSavedClientLocations(db.pool, { clientId: client.id, organisationId: orgId }),
    store.previousBookingAddresses(db.pool, { clientId: client.id, userId: managesAll(req) ? null : req.user.id }),
  ]);

  const out = [];
  const seen = [];
  const push = (loc) => {
    const probe = { address: loc.address, placeId: loc.placeId, lat: loc.lat, lng: loc.lng };
    if (store.findDuplicate(seen, probe)) return;
    seen.push({ normalized_address: store.normaliseAddress(loc.address), place_id: loc.placeId || null, lat: loc.lat, lng: loc.lng });
    out.push(loc);
  };
  if (client.formattedAddress) {
    push({ id: null, label: 'Home', address: client.formattedAddress, placeId: null, lat: null, lng: null, source: 'splose', lastUsedAt: null });
  }
  saved.map(store.toClientLocation).forEach(push);
  previous.forEach((p) => push({ id: null, label: 'Previously used', address: p.address, placeId: null, lat: null, lng: null, source: 'previous_booking', lastUsedAt: p.lastUsedAt }));

  res.json({ clientId: client.id, locations: out, labels: store.LABELS });
}));

router.post('/api/client-locations/:clientId', safe(async (req, res) => {
  const client = await authorisedClient(req, res);
  if (!client) return;
  const parsed = store.cleanLocationInput(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const source = req.body && req.body.source === 'previous_booking' ? 'previous_booking' : 'manual';
  const result = await store.addClientLocation(db.pool, {
    clientId: client.id, organisationId: req.user.organisation_id || null, userId: req.user.id,
    input: parsed.value, source, authoritative: client.formattedAddress ? { address: client.formattedAddress } : null,
  });
  if (!result.duplicate && result.location) {
    await db.logAuditEvent({
      actorUserId: req.user.id, organisationId: req.user.organisation_id || null,
      action: 'client_location.added', targetType: 'client_service_location', targetId: result.location.id,
      metadata: { clientId: client.id, source, hasPlaceId: !!parsed.value.placeId }, ipAddress: req.ip,
    }).catch(() => {});
  }
  res.status(result.duplicate ? 200 : 201).json(result);
}));

router.post('/api/client-locations/:clientId/:id/used', safe(async (req, res) => {
  if (!UUID_RE.test(String(req.params.id))) return res.status(400).json({ error: 'Invalid location id' });
  const client = await authorisedClient(req, res);
  if (!client) return;
  const loc = await store.markClientLocationUsed(db.pool, { clientId: client.id, locationId: req.params.id });
  if (!loc) return res.status(404).json({ error: 'Location not found' });
  res.json({ ok: true, location: loc });
}));

router.get('/api/travel-destinations', safe(async (req, res) => {
  const rows = await store.listDestinations(db.pool, { userId: req.user.id });
  res.json({ destinations: rows.map(store.toDestination) });
}));

router.post('/api/travel-destinations', safe(async (req, res) => {
  const parsed = store.cleanLocationInput(req.body, { labelMax: 80 });
  if (parsed.error) return res.status(400).json({ error: parsed.error });
  const result = await store.upsertDestination(db.pool, { userId: req.user.id, input: parsed.value });
  res.status(result.duplicate ? 200 : 201).json(result);
}));

module.exports = router;
