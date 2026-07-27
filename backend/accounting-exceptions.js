'use strict';

/**
 * ACCOUNTING EXCEPTION ENGINE (Phase 2 slice 1)
 *
 * Scans current accounting state and UPSERTS exception items — the
 * operational control centre feed. Read-only over source data; writes only
 * to accounting_exception_items. No client content ever stored: identifiers,
 * warning codes and counts only.
 */

const { pool } = require('./database');

const SEVERITY = {
  unmapped_contact: 'high',
  missing_account_code: 'high',
  missing_tax_rate: 'high',
  missing_tracking: 'medium',
  duplicate_invoice_risk: 'high',
  candidate_blocked: 'medium',
  not_invoiced: 'medium',
  sync_error: 'high',
  stale_draft: 'low',
  needs_review: 'medium',
};

async function upsertException(orgId, item) {
  await pool.query(
    `INSERT INTO accounting_exception_items
       (organisation_id, exception_type, severity, source, affected_type,
        affected_id, explanation, suggested_action, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid),
                  exception_type, affected_type, affected_id)
     DO UPDATE SET last_seen_at = NOW(),
                   explanation = EXCLUDED.explanation,
                   suggested_action = EXCLUDED.suggested_action,
                   -- re-open only if it was resolved and the condition recurs
                   status = CASE WHEN accounting_exception_items.status = 'dismissed'
                                 THEN 'dismissed' ELSE 'open' END`,
    [orgId, item.type, SEVERITY[item.type] || 'medium', item.source,
     item.affectedType, String(item.affectedId), item.explanation, item.action]);
}

/** Regenerate exception items from current state. Returns summary counts. */
async function generateExceptions(orgId) {
  const counts = {};
  const add = async (item) => { await upsertException(orgId, item); counts[item.type] = (counts[item.type] || 0) + 1; };

  // 1. Candidates blocked by mapping / pricing / tracking (warning codes set
  //    by the candidate engine) + duplicate risk.
  const { rows: cands } = await pool.query(
    `SELECT id, status, warnings, duplicate_reason FROM finance_invoice_candidates
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND status IN ('needs_mapping','needs_pricing','duplicate_risk','draft_candidate','error')`,
    [orgId]);
  for (const c of cands) {
    const warns = Array.isArray(c.warnings) ? c.warnings : [];
    if (c.status === 'needs_mapping' || warns.includes('no_contact_mapping')) {
      await add({ type: 'unmapped_contact', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Invoice candidate has no Xero contact mapping for its payer.',
        action: 'Map the payer under Accounting → Contacts, then regenerate candidates.' });
    }
    if (warns.includes('no_account_code')) {
      await add({ type: 'missing_account_code', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Line items missing a Xero account code.',
        action: 'Set the service → account code mapping under Accounting → Mappings.' });
    }
    if (warns.includes('no_tax_type')) {
      await add({ type: 'missing_tax_rate', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Line items missing a tax rate/TaxType.',
        action: 'Set the service → tax mapping under Accounting → Mappings.' });
    }
    if (warns.includes('no_tracking')) {
      await add({ type: 'missing_tracking', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Tracking category required but not mapped.',
        action: 'Configure tracking mapping, or mark tracking optional.' });
    }
    if (c.status === 'duplicate_risk') {
      await add({ type: 'duplicate_invoice_risk', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Candidate resembles another (' + (c.duplicate_reason || 'same appointment/payer/amount') + ').',
        action: 'Review and approve or ignore this candidate explicitly.' });
    }
    if (c.status === 'error') {
      await add({ type: 'needs_review', source: 'candidates', affectedType: 'invoice_candidate', affectedId: c.id,
        explanation: 'Candidate generation hit an error.', action: 'Open the candidate and review warnings.' });
    }
  }

  // 2. Unmapped contact-mapping records.
  const { rows: unmapped } = await pool.query(
    `SELECT id FROM finance_contact_mappings
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND status IN ('unmapped','needs_review')`,
    [orgId]);
  for (const m of unmapped) {
    await add({ type: 'unmapped_contact', source: 'contacts', affectedType: 'contact_mapping', affectedId: m.id,
      explanation: 'Payer/contact is not confidently mapped to a Xero contact.',
      action: 'Resolve under Accounting → Contacts (manual map or review suggestion).' });
  }

  // 3. Recent sync errors.
  const { rows: errs } = await pool.query(
    `SELECT id, resource FROM finance_sync_log
      WHERE status = 'error' AND created_at > NOW() - INTERVAL '48 hours' LIMIT 50`);
  for (const e of errs) {
    await add({ type: 'sync_error', source: 'sync', affectedType: 'sync_run', affectedId: e.id,
      explanation: `Xero sync error (${e.resource || 'unknown'}).`,
      action: 'Check Accounting → Sync Log; re-run sync after fixing the cause.' });
  }

  // 4. Ready candidates sitting unreviewed (>3 days) = delivered-not-invoiced signal.
  const { rows: stale } = await pool.query(
    `SELECT id FROM finance_invoice_candidates
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND status = 'ready_for_review'
        AND created_at < NOW() - INTERVAL '3 days'`, [orgId]);
  for (const s of stale) {
    await add({ type: 'not_invoiced', source: 'candidates', affectedType: 'invoice_candidate', affectedId: s.id,
      explanation: 'Ready invoice candidate has waited more than 3 days.',
      action: 'Review and approve (or ignore) the candidate.' });
  }

  // Auto-resolve: open items whose condition no longer exists (not re-seen
  // in this run) are closed as resolved-by-system.
  await pool.query(
    `UPDATE accounting_exception_items
        SET status='resolved', resolved_at=NOW()
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND status='open'
        AND last_seen_at < NOW() - INTERVAL '1 minute'`, [orgId]);

  return counts;
}

module.exports = { generateExceptions };
