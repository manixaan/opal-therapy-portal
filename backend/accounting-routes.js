'use strict';

/**
 * ACCOUNTING / XERO ROUTES (owner-only finance module)
 *
 * Every route requires an authenticated OWNER (backend-enforced — frontend
 * hiding is not sufficient). All writes to Xero are fail-closed behind
 * finance-flags and never happen without an explicit owner action.
 *
 * Route map:
 *   GET  /api/accounting/xero/status
 *   GET  /api/accounting/xero/connect                → { authUrl }
 *   GET  /api/accounting/xero/callback               (OAuth redirect)
 *   POST /api/accounting/xero/disconnect
 *   POST /api/accounting/xero/refresh
 *   POST /api/accounting/xero/sync
 *   GET  /api/accounting/xero/sync/status
 *   GET  /api/accounting/xero/contacts|invoices|payments|accounts|items
 *   GET  /api/accounting/dashboard
 *   GET  /api/accounting/candidates
 *   POST /api/accounting/candidates/generate
 *   POST /api/accounting/candidates/:id/review        { status, overrideReason }
 *   POST /api/accounting/candidates/:id/create-draft-invoice   (flag-gated)
 *   GET  /api/accounting/reconciliation
 *   POST /api/accounting/reconciliation/refresh
 *   POST /api/accounting/reconciliation/:id/decide    { decision }
 *   GET|POST /api/accounting/pricing-rules
 *   GET|POST /api/accounting/service-mappings
 *   GET  /api/accounting/sync-log
 *   POST /api/accounting/webhooks/xero                (signature-verified; flag-gated)
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('./database');
const adb = require('./accounting-db');
const xeroApi = require('./xero-api');
const flags = require('./finance-flags');
const pricing = require('./pricing-engine');
const recon = require('./reconciliation-engine');
const { createXeroSync } = require('./xero-sync');
const { createCandidateEngine } = require('./candidate-engine');
const { requireAuth, requireRole } = require('./permissions');

const log = require('./logger').createLogger('accounting');
const sync = createXeroSync({ xeroApi, adb, logger: log });
const candidateEngine = createCandidateEngine({ adb, pricing, logger: log });

// Owner-only guard applied to every route below (except the raw webhook,
// which is mounted separately with signature auth).
const ownerOnly = [requireAuth, requireRole('owner')];

function orgId(req) { return req.user?.organisation_id || null; }
function audit(req, action, targetType, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType, targetId,
    ipAddress: req.ip, organisationId: orgId(req),
    metadata: metadata || null,
  }).catch(() => {});
}

// ── OAuth ────────────────────────────────────────────────────────────────────

router.get('/api/accounting/xero/status', ...ownerOnly, async (req, res) => {
  try {
    const conn = await adb.getConnection(orgId(req));
    res.json({
      configured: xeroApi.isConfigured(),
      connected: !!conn,
      organisation: conn ? { name: conn.xero_tenant_name, tenantIdSuffix: conn.xero_tenant_id?.slice(-6) } : null,
      baseCurrency: conn?.base_currency || null,
      lastConnectedAt: conn?.connected_at || null,
      tokenExpiresAt: conn?.token_expires_at || null,
      flags: flags.financeFlagState(),
    });
  } catch (err) {
    log.error('xero status failed', { error: err });
    res.status(500).json({ error: 'Failed to read Xero status' });
  }
});

router.get('/api/accounting/xero/connect', ...ownerOnly, (req, res) => {
  if (!xeroApi.isConfigured()) {
    return res.status(503).json({ error: 'Xero is not configured on this environment', code: 'xero_not_configured' });
  }
  const { url, state } = xeroApi.buildAuthorizeUrl();
  req.session.xeroOauthState = state;
  req.session.save(() => res.json({ authUrl: url }));
});

router.get('/api/accounting/xero/callback', requireAuth, async (req, res) => {
  const errPage = (title, msg) =>
    `<html><body style="font-family:sans-serif;padding:40px;"><h2>${title}</h2><p>${msg}</p></body></html>`;
  try {
    // Owner-only, even though this is a redirect target.
    if (req.user?.role !== 'owner') {
      return res.status(403).send(errPage('Not permitted', 'Only the practice owner can connect Xero.'));
    }
    const { code, state } = req.query;
    // State validation (CSRF). Strict outside development/test.
    const expected = req.session.xeroOauthState;
    if (!state || state !== expected) {
      const strict = process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test';
      if (strict) {
        await audit(req, 'finance.xero_oauth_state_mismatch', 'xero', null);
        return res.status(403).send(errPage('Sign-in could not be verified', 'Security state mismatch — please reconnect Xero.'));
      }
    }
    if (!code) return res.status(400).send(errPage('Missing code', 'No authorization code returned.'));

    const tokens = await xeroApi.exchangeCodeForTokens(code);
    const connections = await xeroApi.getConnections(tokens.accessToken);
    if (!connections.length) {
      return res.status(400).send(errPage('No organisation', 'No Xero organisation was authorised.'));
    }
    // Single-org pilot: take the first tenant. (Tenant selection UI is a
    // future enhancement; the schema already supports multiple.)
    const tenant = connections[0];
    let baseCurrency = null;
    try {
      const org = await xeroApi.apiGet(tokens.accessToken, tenant.tenantId, '/Organisation');
      baseCurrency = org?.Organisations?.[0]?.BaseCurrency || null;
    } catch (_) { /* non-fatal */ }

    await adb.upsertConnection({
      organisationId: orgId(req),
      tenantId: tenant.tenantId, tenantName: tenant.tenantName, tenantType: tenant.tenantType,
      connectedByUserId: req.user.id,
      accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      tokenExpiresAt: tokens.expiresAt, baseCurrency,
    });
    // Session is NEVER switched — Xero connects to the org, not a Xero-email user.
    delete req.session.xeroOauthState;
    await audit(req, 'finance.xero_connected', 'xero', tenant.tenantId, { org: tenant.tenantName });

    res.send(`<html><body style="font-family:sans-serif;padding:40px;text-align:center;">
      <h2 style="color:#16a34a;">Xero connected</h2>
      <p>Connected to <strong>${escapeHtml(tenant.tenantName)}</strong>.</p>
      <p><a href="/">Return to the portal</a></p></body></html>`);
  } catch (err) {
    log.error('xero callback failed', { error: err, status: err.response?.status });
    res.status(500).send(errPage('Connection failed', 'Could not complete the Xero connection. Please try again.'));
  }
});

router.post('/api/accounting/xero/disconnect', ...ownerOnly, async (req, res) => {
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.json({ ok: true, alreadyDisconnected: true });
    // Best-effort revoke at Xero, then mark locally (authoritative).
    try {
      const at = await xeroApi.ensureValidToken(conn, (r) => adb.updateConnectionTokens(conn.id, r));
      const conns = await xeroApi.getConnections(at);
      const match = conns.find(c => c.tenantId === conn.xero_tenant_id);
      if (match) await xeroApi.revokeConnection(at, match.connectionId);
    } catch (_) { /* revoke best-effort */ }
    await adb.markConnectionDisconnected(conn.id);
    await audit(req, 'finance.xero_disconnected', 'xero', conn.xero_tenant_id);
    res.json({ ok: true });
  } catch (err) {
    log.error('xero disconnect failed', { error: err });
    res.status(500).json({ error: 'Failed to disconnect Xero' });
  }
});

router.post('/api/accounting/xero/refresh', ...ownerOnly, async (req, res) => {
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.status(404).json({ error: 'Not connected' });
    await xeroApi.ensureValidToken({ ...conn, token_expires_at: new Date(0) },
      (r) => adb.updateConnectionTokens(conn.id, r));
    await audit(req, 'finance.xero_token_refreshed', 'xero', conn.xero_tenant_id);
    res.json({ ok: true });
  } catch (err) {
    log.error('xero refresh failed', { error: err });
    res.status(500).json({ error: 'Token refresh failed — reconnect may be required' });
  }
});

// ── Read-only sync ───────────────────────────────────────────────────────────

router.post('/api/accounting/xero/sync', ...ownerOnly, async (req, res) => {
  if (!flags.isXeroReadEnabled()) {
    return res.status(403).json({ error: 'Xero read is disabled', code: 'xero_read_disabled' });
  }
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.status(404).json({ error: 'Not connected to Xero' });
    const summary = await sync.syncAll(conn, { organisationId: orgId(req) });
    await audit(req, 'finance.xero_synced', 'xero', conn.xero_tenant_id, summary.synced);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('xero sync failed', { error: err });
    res.status(500).json({ error: 'Xero sync failed' });
  }
});

router.get('/api/accounting/xero/sync/status', ...ownerOnly, async (req, res) => {
  const conn = await adb.getConnection(orgId(req));
  if (!conn) return res.json({ connected: false, resources: [] });
  res.json({ connected: true, running: sync.isRunning(), resources: await adb.getSyncState(conn.id) });
});

for (const resource of ['contacts', 'invoices', 'payments', 'accounts', 'items']) {
  router.get(`/api/accounting/xero/${resource}`, ...ownerOnly, async (req, res) => {
    if (!flags.isXeroReadEnabled()) return res.status(403).json({ error: 'Xero read disabled' });
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.json({ connected: false, items: [] });
    res.json({ connected: true, items: await adb.listCache(resource, conn.id) });
  });
}

// ── Dashboard ────────────────────────────────────────────────────────────────

router.get('/api/accounting/dashboard', ...ownerOnly, async (req, res) => {
  if (!flags.isFinanceDashboardEnabled()) {
    return res.status(403).json({ error: 'Finance dashboard disabled', code: 'dashboard_disabled' });
  }
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.json({ connected: false, overview: null });
    const overview = await adb.computeOverview(conn.id);
    res.json({ connected: true, organisation: conn.xero_tenant_name, overview });
  } catch (err) {
    log.error('dashboard failed', { error: err });
    res.status(500).json({ error: 'Failed to compute dashboard' });
  }
});

// ── Invoice candidates ───────────────────────────────────────────────────────

router.get('/api/accounting/candidates', ...ownerOnly, async (req, res) => {
  res.json({ candidates: await adb.listCandidates(orgId(req), { status: req.query.status }) });
});

// Generate candidates from Splose appointments (read-only toward Splose).
router.post('/api/accounting/candidates/generate', ...ownerOnly, async (req, res) => {
  try {
    const sploseApi = require('./splose-api');
    const { startDate, endDate } = req.body || {};
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate required (YYYY-MM-DD)' });

    const raw = await sploseApi.getAppointments(startDate, endDate);
    // Normalise to the candidate-engine shape. Only completed appointments bill.
    const appts = (Array.isArray(raw) ? raw : []).map(a => ({
      id: a.id, clientId: a.patientId || a.clientId, serviceId: a.serviceId,
      serviceName: a.serviceName || a.service, practitionerId: a.practitionerId,
      date: a.start ? String(a.start).slice(0, 10) : null,
      durationMinutes: a.durationMinutes || null,
      status: a.status || 'completed',
      appointmentType: a.appointmentType || 'therapy',
      fundingType: a.fundingType || null, mmmClassification: a.mmm || null,
      description: a.note ? undefined : a.serviceName, // never pull clinical notes
    }));

    const ctx = {
      organisationId: orgId(req),
      pricingRules: await adb.listPricingRules(orgId(req)),
      serviceMappings: await adb.listServiceMappings(orgId(req)),
      contactMappings: [],
    };
    const summary = await candidateEngine.generate(appts, ctx);
    await audit(req, 'finance.candidates_generated', 'invoice_candidate', null, summary);
    res.json({ ok: true, summary });
  } catch (err) {
    log.error('candidate generation failed', { error: err });
    res.status(500).json({ error: 'Failed to generate invoice candidates' });
  }
});

router.post('/api/accounting/candidates/:id/review', ...ownerOnly, async (req, res) => {
  const { status, overrideReason } = req.body || {};
  const allowed = ['ready_for_review', 'approved_for_draft', 'ignored'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  const updated = await adb.setCandidateStatus(req.params.id, status, { userId: req.user.id, overrideReason });
  if (!updated) return res.status(404).json({ error: 'Candidate not found' });
  await audit(req, 'finance.candidate_reviewed', 'invoice_candidate', req.params.id, { status });
  res.json({ candidate: updated });
});

// Draft invoice creation — FLAG-GATED. Never approves or sends.
router.post('/api/accounting/candidates/:id/create-draft-invoice', ...ownerOnly, async (req, res) => {
  if (!flags.isDraftInvoiceCreateEnabled()) {
    return res.status(403).json({
      error: 'Draft invoice creation is disabled', code: 'draft_create_disabled',
      hint: 'Requires ENABLE_XERO_WRITE=true and ENABLE_XERO_DRAFT_INVOICE_CREATE=true',
    });
  }
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.status(404).json({ error: 'Not connected to Xero' });

    const cand = await adb.getCandidate(req.params.id);
    if (!cand) return res.status(404).json({ error: 'Candidate not found' });

    // Validation gauntlet before any write.
    if (cand.xero_invoice_id) return res.status(409).json({ error: 'Candidate already has a Xero invoice', xeroInvoiceId: cand.xero_invoice_id });
    if (cand.status !== 'approved_for_draft') return res.status(400).json({ error: 'Candidate not approved for draft (status: ' + cand.status + ')' });
    if (!cand.xero_contact_id) return res.status(400).json({ error: 'Candidate has no mapped Xero contact' });
    if (!cand.lines?.length) return res.status(400).json({ error: 'Candidate has no line items' });
    for (const ln of cand.lines) {
      if (!(Number(ln.unit_amount) >= 0)) return res.status(400).json({ error: 'Invalid line amount' });
      if (!ln.account_code && !ln.item_code) return res.status(400).json({ error: 'Line missing account/item code' });
    }

    const accessToken = await xeroApi.ensureValidToken(conn, (r) => adb.updateConnectionTokens(conn.id, r));
    const payload = {
      Type: 'ACCREC',
      Status: 'DRAFT',                 // DRAFT ONLY — never AUTHORISED
      Contact: { ContactID: cand.xero_contact_id },
      Date: cand.appointment_date || undefined,
      LineItems: cand.lines.map(ln => ({
        Description: ln.description, Quantity: Number(ln.quantity), UnitAmount: Number(ln.unit_amount),
        AccountCode: ln.account_code || undefined, ItemCode: ln.item_code || undefined,
        TaxType: ln.tax_type || undefined,
      })),
      Reference: `Opal candidate ${cand.id}`,
    };

    // POST kept here (xero-api stays read-focused); this is the only write path.
    const axios = require('axios');
    const created = await axios.post('https://api.xero.com/api.xro/2.0/Invoices',
      { Invoices: [payload] },
      { headers: { Authorization: `Bearer ${accessToken}`, 'Xero-tenant-id': conn.xero_tenant_id, Accept: 'application/json' }, timeout: 30000 });
    const inv = created.data?.Invoices?.[0];
    if (!inv?.InvoiceID) throw new Error('Xero did not return an invoice id');

    await adb.setCandidateStatus(cand.id, 'draft_created_in_xero', { userId: req.user.id, xeroInvoiceId: inv.InvoiceID });
    await adb.recordInvoiceAction({ candidateId: cand.id, action: 'draft_created', actorUserId: req.user.id, xeroInvoiceId: inv.InvoiceID, result: 'success', detail: inv.InvoiceNumber });
    await audit(req, 'finance.draft_invoice_created', 'xero_invoice', inv.InvoiceID, { candidateId: cand.id, invoiceNumber: inv.InvoiceNumber, status: inv.Status });

    res.status(201).json({ ok: true, xeroInvoiceId: inv.InvoiceID, invoiceNumber: inv.InvoiceNumber, status: inv.Status });
  } catch (err) {
    log.error('draft invoice create failed', { error: err, status: err.response?.status });
    await adb.recordInvoiceAction({ candidateId: req.params.id, action: 'draft_created', actorUserId: req.user.id, result: 'error', detail: err.response?.data?.Message || err.message }).catch(() => {});
    res.status(502).json({ error: 'Failed to create draft invoice in Xero' });
  }
});

// ── Reconciliation assistant (suggestion-only) ───────────────────────────────

router.get('/api/accounting/reconciliation', ...ownerOnly, async (req, res) => {
  res.json({
    note: 'Suggestions only. Xero bank reconciliation is performed in Xero — the public API cannot reconcile bank statement lines.',
    candidates: await adb.listReconciliationCandidates(orgId(req), { decision: req.query.decision }),
  });
});

router.post('/api/accounting/reconciliation/refresh', ...ownerOnly, async (req, res) => {
  try {
    const conn = await adb.getConnection(orgId(req));
    if (!conn) return res.status(404).json({ error: 'Not connected' });
    const payments = await adb.listCache('payments', conn.id);
    const invoices = (await adb.listCache('invoices', conn.id)).filter(i => i.type === 'ACCREC');
    const suggestions = recon.suggestMatches(payments, invoices);
    const n = await adb.replaceReconciliationCandidates(orgId(req), conn.id, suggestions);
    await audit(req, 'finance.reconciliation_refreshed', 'reconciliation', null, { suggestions: n });
    res.json({ ok: true, suggestions: n });
  } catch (err) {
    log.error('reconciliation refresh failed', { error: err });
    res.status(500).json({ error: 'Failed to refresh reconciliation suggestions' });
  }
});

router.post('/api/accounting/reconciliation/:id/decide', ...ownerOnly, async (req, res) => {
  const { decision } = req.body || {};
  const allowed = ['accepted', 'rejected', 'needs_xero_reconciliation'];
  if (!allowed.includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
  // Accepting only RECORDS the decision. Applying a payment to Xero is a
  // separate flag (ENABLE_XERO_PAYMENT_CREATE) and deferred.
  const updated = await adb.decideReconciliation(req.params.id, decision, req.user.id);
  if (!updated) return res.status(404).json({ error: 'Suggestion not found' });
  await audit(req, 'finance.reconciliation_decided', 'reconciliation', req.params.id, { decision });
  res.json({ candidate: updated });
});

// ── Pricing rules + service mappings ─────────────────────────────────────────

router.get('/api/accounting/pricing-rules', ...ownerOnly, async (req, res) => {
  res.json({ rules: await adb.listPricingRules(orgId(req)) });
});
router.post('/api/accounting/pricing-rules', ...ownerOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.name || b.unitAmount == null) return res.status(400).json({ error: 'name and unitAmount required' });
  const rule = await adb.createPricingRule({ ...b, organisationId: orgId(req), createdByUserId: req.user.id });
  await audit(req, 'finance.pricing_rule_created', 'pricing_rule', rule.id, { name: rule.name });
  res.status(201).json({ rule });
});

router.get('/api/accounting/service-mappings', ...ownerOnly, async (req, res) => {
  res.json({ mappings: await adb.listServiceMappings(orgId(req)) });
});
router.post('/api/accounting/service-mappings', ...ownerOnly, async (req, res) => {
  const b = req.body || {};
  if (!b.sploseServiceId) return res.status(400).json({ error: 'sploseServiceId required' });
  const mapping = await adb.upsertServiceMapping({ ...b, organisationId: orgId(req), createdByUserId: req.user.id });
  await audit(req, 'finance.service_mapping_changed', 'service_mapping', mapping.id, { service: mapping.splose_service_id });
  res.json({ mapping });
});

router.get('/api/accounting/sync-log', ...ownerOnly, async (req, res) => {
  const conn = await adb.getConnection(orgId(req));
  if (!conn) return res.json({ log: [] });
  res.json({ log: await adb.getFinanceSyncLog(conn.id) });
});

// ── Xero webhook (signature-verified, flag-gated) ────────────────────────────
// Mounted with a raw body parser in server.js BEFORE bodyParser.json so the
// HMAC can be computed over the exact bytes Xero sent.
function xeroWebhookHandler(req, res) {
  if (!flags.isWebhooksEnabled()) return res.status(404).end();
  const signature = req.get('x-xero-signature') || '';
  const key = process.env.XERO_WEBHOOK_KEY || '';
  const raw = req.body instanceof Buffer ? req.body : Buffer.from(req.body || '');
  const computed = crypto.createHmac('sha256', key).update(raw).digest('base64');
  // Constant-time compare; mismatch → 401 (Xero's required response).
  const ok = key && signature.length === computed.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  if (!ok) return res.status(401).end();

  // Respond fast; process asynchronously + idempotently (dedupe by event id).
  res.status(200).end();
  try {
    const payload = JSON.parse(raw.toString('utf8'));
    log.info('xero webhook received', { events: Array.isArray(payload.events) ? payload.events.length : 0 });
    // Deferred: enqueue invoice-changed events for incremental re-sync.
  } catch (_) { /* already 200'd */ }
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = router;
module.exports.xeroWebhookHandler = xeroWebhookHandler;
