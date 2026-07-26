'use strict';

/**
 * ACCOUNTING DATA ACCESS (Xero/finance tables)
 *
 * Uses the shared pg pool. Xero tokens are ENCRYPTED here on the way in
 * (AES-256-GCM via crypto-utils) and left encrypted in the row — callers
 * decrypt at the API choke point (xero-api.ensureValidToken). Nothing in
 * this module logs token values.
 */

const { pool } = require('./database');
const { encrypt } = require('./crypto-utils');

// ── Connections + tokens ─────────────────────────────────────────────────────

async function getConnection(organisationId) {
  const { rows } = await pool.query(
    `SELECT * FROM xero_connections
      WHERE (organisation_id IS NOT DISTINCT FROM $1) AND status = 'connected'
      ORDER BY connected_at DESC LIMIT 1`,
    [organisationId || null]
  );
  return rows[0] || null;
}

async function upsertConnection({ organisationId, tenantId, tenantName, tenantType,
                                  connectedByUserId, accessToken, refreshToken,
                                  tokenExpiresAt, baseCurrency }) {
  const { rows } = await pool.query(
    `INSERT INTO xero_connections
       (organisation_id, xero_tenant_id, xero_tenant_name, tenant_type,
        connected_by_user_id, access_token, refresh_token, token_expires_at,
        base_currency, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'connected',NOW())
     ON CONFLICT (organisation_id, xero_tenant_id) DO UPDATE
       SET xero_tenant_name = EXCLUDED.xero_tenant_name,
           tenant_type      = EXCLUDED.tenant_type,
           connected_by_user_id = EXCLUDED.connected_by_user_id,
           access_token     = EXCLUDED.access_token,
           refresh_token    = EXCLUDED.refresh_token,
           token_expires_at = EXCLUDED.token_expires_at,
           base_currency    = COALESCE(EXCLUDED.base_currency, xero_connections.base_currency),
           status           = 'connected',
           last_error       = NULL,
           updated_at       = NOW()
     RETURNING *`,
    [organisationId || null, tenantId, tenantName || null, tenantType || null,
     connectedByUserId || null, encrypt(accessToken), encrypt(refreshToken),
     tokenExpiresAt || null, baseCurrency || null]
  );
  return rows[0];
}

/** Persist a refreshed token set (rotating refresh token) on an existing row. */
async function updateConnectionTokens(connectionId, { accessToken, refreshToken, expiresAt }) {
  await pool.query(
    `UPDATE xero_connections
        SET access_token = $2, refresh_token = $3, token_expires_at = $4, updated_at = NOW()
      WHERE id = $1`,
    [connectionId, encrypt(accessToken), encrypt(refreshToken), expiresAt || null]
  );
}

async function markConnectionDisconnected(connectionId) {
  await pool.query(
    `UPDATE xero_connections
        SET status = 'disconnected', access_token = NULL, refresh_token = NULL, updated_at = NOW()
      WHERE id = $1`,
    [connectionId]
  );
}

async function setConnectionError(connectionId, message) {
  await pool.query(
    `UPDATE xero_connections SET status = 'error', last_error = $2, updated_at = NOW() WHERE id = $1`,
    [connectionId, String(message || '').slice(0, 500)]
  );
}

// ── Sync state + log ─────────────────────────────────────────────────────────

async function setSyncState(connectionId, resource, { status, records, lastModifiedRef, error }) {
  await pool.query(
    `INSERT INTO xero_sync_state (connection_id, resource, last_synced_at, last_modified_ref, last_status, records_synced, last_error, updated_at)
     VALUES ($1,$2,NOW(),$3,$4,$5,$6,NOW())
     ON CONFLICT (connection_id, resource) DO UPDATE
       SET last_synced_at    = NOW(),
           last_modified_ref = COALESCE(EXCLUDED.last_modified_ref, xero_sync_state.last_modified_ref),
           last_status       = EXCLUDED.last_status,
           records_synced    = EXCLUDED.records_synced,
           last_error        = EXCLUDED.last_error,
           updated_at        = NOW()`,
    [connectionId, resource, lastModifiedRef || null, status, records || 0, error ? String(error).slice(0, 500) : null]
  );
}

async function getSyncState(connectionId) {
  const { rows } = await pool.query(
    'SELECT resource, last_synced_at, last_status, records_synced, last_error FROM xero_sync_state WHERE connection_id = $1 ORDER BY resource',
    [connectionId]
  );
  return rows;
}

async function logFinanceSync(connectionId, { resource, status, records, durationMs, message }) {
  await pool.query(
    `INSERT INTO finance_sync_log (connection_id, resource, status, records, duration_ms, message)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [connectionId, resource, status, records || 0, durationMs || null, message ? String(message).slice(0, 500) : null]
  );
}

async function getFinanceSyncLog(connectionId, limit = 50) {
  const { rows } = await pool.query(
    'SELECT resource, status, records, duration_ms, message, created_at FROM finance_sync_log WHERE connection_id = $1 ORDER BY created_at DESC LIMIT $2',
    [connectionId, limit]
  );
  return rows;
}

// ── Generic cache upsert (contacts / invoices / payments / accounts / items) ──

const CACHE_SPECS = {
  contacts: {
    table: 'xero_contacts_cache', idCol: 'xero_contact_id',
    cols: ['xero_contact_id', 'name', 'email', 'is_customer', 'updated_date_utc'],
  },
  invoices: {
    table: 'xero_invoices_cache', idCol: 'xero_invoice_id',
    cols: ['xero_invoice_id', 'invoice_number', 'xero_contact_id', 'contact_name', 'type',
           'status', 'invoice_date', 'due_date', 'currency_code', 'sub_total', 'total_tax',
           'total', 'amount_due', 'amount_paid', 'reference', 'updated_date_utc'],
  },
  payments: {
    table: 'xero_payments_cache', idCol: 'xero_payment_id',
    cols: ['xero_payment_id', 'xero_invoice_id', 'invoice_number', 'xero_contact_id', 'contact_name',
           'amount', 'currency_code', 'payment_date', 'reference', 'status', 'updated_date_utc'],
  },
  accounts: {
    table: 'xero_accounts_cache', idCol: 'xero_account_id',
    cols: ['xero_account_id', 'code', 'name', 'type', 'tax_type', 'class', 'status'],
  },
  items: {
    table: 'xero_items_cache', idCol: 'xero_item_id',
    cols: ['xero_item_id', 'code', 'name', 'description', 'sales_unit_price', 'sales_account_code', 'sales_tax_type'],
  },
};

/** Upsert an array of already-mapped rows into a cache table. */
async function upsertCache(resource, connectionId, rows) {
  const spec = CACHE_SPECS[resource];
  if (!spec || !rows.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rows) {
      const cols = ['connection_id', ...spec.cols, 'synced_at'];
      const vals = [connectionId, ...spec.cols.map(c => r[c] ?? null), new Date()];
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(',');
      const updates = spec.cols.map(c => `${c} = EXCLUDED.${c}`).join(', ');
      await client.query(
        `INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${placeholders})
         ON CONFLICT (connection_id, ${spec.idCol}) DO UPDATE SET ${updates}, synced_at = NOW()`,
        vals
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listCache(resource, connectionId, { limit = 500 } = {}) {
  const spec = CACHE_SPECS[resource];
  if (!spec) return [];
  const { rows } = await pool.query(
    `SELECT * FROM ${spec.table} WHERE connection_id = $1 ORDER BY synced_at DESC LIMIT $2`,
    [connectionId, limit]
  );
  return rows;
}

// ── Dashboard aggregation (from caches — no live API calls) ───────────────────

async function computeOverview(connectionId) {
  const q = (sql, p = []) => pool.query(sql, [connectionId, ...p]);
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const iso = monthStart.toISOString().slice(0, 10);

  const inv = (await q(
    `SELECT
        COUNT(*) FILTER (WHERE status IN ('AUTHORISED','PAID','SUBMITTED')) AS issued,
        COUNT(*) FILTER (WHERE status = 'DRAFT') AS draft,
        COUNT(*) FILTER (WHERE status = 'PAID') AS paid,
        COUNT(*) FILTER (WHERE status = 'AUTHORISED' AND amount_due > 0) AS unpaid,
        COUNT(*) FILTER (WHERE status = 'AUTHORISED' AND amount_due > 0 AND due_date < CURRENT_DATE) AS overdue,
        COALESCE(SUM(amount_due) FILTER (WHERE status = 'AUTHORISED'), 0) AS outstanding,
        COALESCE(SUM(total) FILTER (WHERE type='ACCREC' AND invoice_date >= $2), 0) AS revenue_month,
        COALESCE(AVG(total) FILTER (WHERE type='ACCREC' AND total > 0), 0) AS avg_invoice
       FROM xero_invoices_cache WHERE connection_id = $1 AND type = 'ACCREC'`, [iso]
  )).rows[0];

  // Candidate counts are scoped to the connection's organisation.
  const cand = (await pool.query(
    `SELECT
        COUNT(*) FILTER (WHERE c.status IN ('ready_for_review','draft_candidate')) AS uninvoiced,
        COUNT(*) FILTER (WHERE c.status = 'needs_mapping') AS needs_mapping,
        COUNT(*) FILTER (WHERE c.status = 'needs_pricing') AS needs_pricing
       FROM finance_invoice_candidates c
      WHERE c.organisation_id IS NOT DISTINCT FROM
            (SELECT organisation_id FROM xero_connections WHERE id = $1)`,
    [connectionId]
  )).rows[0];

  const currency = (await q('SELECT base_currency FROM xero_connections WHERE id = $1')).rows[0]?.base_currency || 'AUD';

  return {
    currency,
    revenueThisMonth: Number(inv.revenue_month),
    outstandingBalance: Number(inv.outstanding),
    invoices: {
      issued: Number(inv.issued), draft: Number(inv.draft), paid: Number(inv.paid),
      unpaid: Number(inv.unpaid), overdue: Number(inv.overdue),
    },
    averageInvoiceValue: Number(inv.avg_invoice),
    uninvoicedCandidates: Number(cand.uninvoiced),
    candidatesNeedingMapping: Number(cand.needs_mapping),
    candidatesNeedingPricing: Number(cand.needs_pricing),
  };
}

// ── Invoice candidates ───────────────────────────────────────────────────────

async function getCandidate(id) {
  const { rows } = await pool.query('SELECT * FROM finance_invoice_candidates WHERE id = $1', [id]);
  if (!rows[0]) return null;
  const lines = (await pool.query(
    'SELECT * FROM finance_invoice_candidate_lines WHERE candidate_id = $1 ORDER BY sort_order', [id])).rows;
  return { ...rows[0], lines };
}

async function listCandidates(organisationId, { status } = {}) {
  const params = [organisationId || null];
  let sql = 'SELECT * FROM finance_invoice_candidates WHERE organisation_id IS NOT DISTINCT FROM $1';
  if (status) { params.push(status); sql += ` AND status = $${params.length}`; }
  sql += ' ORDER BY appointment_date DESC NULLS LAST, created_at DESC LIMIT 500';
  return (await pool.query(sql, params)).rows;
}

/** Idempotent upsert of a candidate keyed by (org, splose_appointment_id). */
async function upsertCandidate(cand, lines = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO finance_invoice_candidates
         (organisation_id, splose_appointment_id, splose_client_id, splose_service_id,
          practitioner_ref, appointment_date, appointment_status, xero_contact_id,
          status, currency_code, total_amount, total_tax, warnings, pricing_source, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
       ON CONFLICT (organisation_id, splose_appointment_id) DO UPDATE
         SET splose_client_id = EXCLUDED.splose_client_id,
             splose_service_id = EXCLUDED.splose_service_id,
             practitioner_ref = EXCLUDED.practitioner_ref,
             appointment_date = EXCLUDED.appointment_date,
             appointment_status = EXCLUDED.appointment_status,
             xero_contact_id = EXCLUDED.xero_contact_id,
             -- Never regress a candidate that has already produced a Xero draft.
             status = CASE WHEN finance_invoice_candidates.status = 'draft_created_in_xero'
                           THEN finance_invoice_candidates.status ELSE EXCLUDED.status END,
             currency_code = EXCLUDED.currency_code,
             total_amount = EXCLUDED.total_amount,
             total_tax = EXCLUDED.total_tax,
             warnings = EXCLUDED.warnings,
             pricing_source = EXCLUDED.pricing_source,
             updated_at = NOW()
       RETURNING *`,
      [cand.organisationId || null, cand.sploseAppointmentId, cand.sploseClientId || null,
       cand.sploseServiceId || null, cand.practitionerRef || null, cand.appointmentDate || null,
       cand.appointmentStatus || null, cand.xeroContactId || null, cand.status || 'draft_candidate',
       cand.currencyCode || 'AUD', cand.totalAmount ?? null, cand.totalTax ?? null,
       cand.warnings ? JSON.stringify(cand.warnings) : null, cand.pricingSource || null]
    );
    const candidateId = rows[0].id;
    // Replace lines only when the candidate has not yet produced a Xero draft.
    if (rows[0].status !== 'draft_created_in_xero') {
      await client.query('DELETE FROM finance_invoice_candidate_lines WHERE candidate_id = $1', [candidateId]);
      let order = 0;
      for (const ln of lines) {
        await client.query(
          `INSERT INTO finance_invoice_candidate_lines
             (candidate_id, description, quantity, unit_amount, tax_type, account_code, item_code, line_total, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [candidateId, ln.description || null, ln.quantity || 1, ln.unitAmount || 0,
           ln.taxType || null, ln.accountCode || null, ln.itemCode || null,
           (ln.quantity || 1) * (ln.unitAmount || 0), order++]
        );
      }
    }
    await client.query('COMMIT');
    return rows[0];
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function setCandidateStatus(id, status, { userId, xeroInvoiceId, overrideReason } = {}) {
  const { rows } = await pool.query(
    `UPDATE finance_invoice_candidates
        SET status = $2,
            reviewed_by_user_id = COALESCE($3, reviewed_by_user_id),
            reviewed_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE reviewed_at END,
            xero_invoice_id = COALESCE($4, xero_invoice_id),
            manual_override_reason = COALESCE($5, manual_override_reason),
            updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, status, userId || null, xeroInvoiceId || null, overrideReason || null]
  );
  return rows[0];
}

async function recordInvoiceAction({ candidateId, action, actorUserId, xeroInvoiceId, result, detail }) {
  await pool.query(
    `INSERT INTO finance_invoice_actions (candidate_id, action, actor_user_id, xero_invoice_id, xero_result, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [candidateId || null, action, actorUserId || null, xeroInvoiceId || null, result || null,
     detail ? String(detail).slice(0, 500) : null]
  );
}

// ── Pricing rules + mappings ─────────────────────────────────────────────────

async function listPricingRules(organisationId) {
  return (await pool.query(
    `SELECT * FROM finance_pricing_rules WHERE organisation_id IS NOT DISTINCT FROM $1 AND active = TRUE
      ORDER BY priority ASC, effective_from DESC`, [organisationId || null])).rows;
}

async function createPricingRule(rule) {
  const { rows } = await pool.query(
    `INSERT INTO finance_pricing_rules
       (organisation_id, name, splose_service_id, appointment_type, funding_type, mmm_classification,
        support_item_code, unit_amount, tax_type, xero_account_code, xero_item_code,
        effective_from, effective_to, priority, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12,CURRENT_DATE),$13,$14,$15) RETURNING *`,
    [rule.organisationId || null, rule.name, rule.sploseServiceId || null, rule.appointmentType || null,
     rule.fundingType || null, rule.mmmClassification || null, rule.supportItemCode || null,
     rule.unitAmount, rule.taxType || 'NONE', rule.xeroAccountCode || null, rule.xeroItemCode || null,
     rule.effectiveFrom || null, rule.effectiveTo || null, rule.priority || 100, rule.createdByUserId || null]
  );
  return rows[0];
}

async function listServiceMappings(organisationId) {
  return (await pool.query(
    'SELECT * FROM finance_service_mappings WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY splose_service_name',
    [organisationId || null])).rows;
}

async function upsertServiceMapping(m) {
  const { rows } = await pool.query(
    `INSERT INTO finance_service_mappings
       (organisation_id, splose_service_id, splose_service_name, xero_item_code, xero_account_code, tax_type, status, created_by_user_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (organisation_id, splose_service_id) DO UPDATE
       SET splose_service_name = EXCLUDED.splose_service_name,
           xero_item_code = EXCLUDED.xero_item_code,
           xero_account_code = EXCLUDED.xero_account_code,
           tax_type = EXCLUDED.tax_type,
           status = EXCLUDED.status,
           updated_at = NOW()
     RETURNING *`,
    [m.organisationId || null, m.sploseServiceId, m.sploseServiceName || null, m.xeroItemCode || null,
     m.xeroAccountCode || null, m.taxType || null, m.status || 'mapped', m.createdByUserId || null]
  );
  return rows[0];
}

// ── Reconciliation candidates ────────────────────────────────────────────────

async function replaceReconciliationCandidates(organisationId, connectionId, candidates) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Only clear still-suggested rows; keep owner decisions.
    await client.query(
      `DELETE FROM finance_reconciliation_candidates WHERE connection_id = $1 AND decision = 'suggested'`,
      [connectionId]
    );
    for (const c of candidates) {
      await client.query(
        `INSERT INTO finance_reconciliation_candidates
           (organisation_id, connection_id, xero_payment_id, xero_invoice_id, match_type, confidence,
            amount_payment, amount_invoice, reasons, decision)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'suggested')`,
        [organisationId || null, connectionId, c.xeroPaymentId || null, c.xeroInvoiceId || null,
         c.matchType, c.confidence, c.amountPayment ?? null, c.amountInvoice ?? null,
         c.reasons ? JSON.stringify(c.reasons) : null]
      );
    }
    await client.query('COMMIT');
    return candidates.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function listReconciliationCandidates(organisationId, { decision } = {}) {
  const params = [organisationId || null];
  let sql = 'SELECT * FROM finance_reconciliation_candidates WHERE organisation_id IS NOT DISTINCT FROM $1';
  if (decision) { params.push(decision); sql += ` AND decision = $${params.length}`; }
  sql += ' ORDER BY confidence, created_at DESC LIMIT 500';
  return (await pool.query(sql, params)).rows;
}

async function decideReconciliation(id, decision, userId) {
  const { rows } = await pool.query(
    `UPDATE finance_reconciliation_candidates
        SET decision = $2, decided_by_user_id = $3, decided_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, decision, userId || null]
  );
  return rows[0];
}

module.exports = {
  pool,
  getConnection, upsertConnection, updateConnectionTokens, markConnectionDisconnected, setConnectionError,
  setSyncState, getSyncState, logFinanceSync, getFinanceSyncLog,
  upsertCache, listCache, computeOverview,
  getCandidate, listCandidates, upsertCandidate, setCandidateStatus, recordInvoiceAction,
  listPricingRules, createPricingRule, listServiceMappings, upsertServiceMapping,
  replaceReconciliationCandidates, listReconciliationCandidates, decideReconciliation,
};
