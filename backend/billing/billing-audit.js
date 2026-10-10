'use strict';

/**
 * BILLING AUDIT — append-only financial audit trail (billing_audit_events).
 *
 * Written inside the same transaction as the change it records, so an
 * audited change and its audit row commit or roll back together. The table
 * rejects UPDATE/DELETE at the database level. Before/after carry financial
 * fields and ids only — never case-note or clinical content.
 */

async function recordAudit(q, { orgId, actorUserId, action, entityType, entityId, invoiceId, before, after, reason }) {
  await q.query(
    `INSERT INTO billing_audit_events (organisation_id, actor_user_id, action, entity_type, entity_id,
       invoice_id, before_state, after_state, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [orgId, actorUserId || null, action, entityType, entityId == null ? null : String(entityId),
      invoiceId || null, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
      reason || null]);
}

async function listAudit(q, orgId, { invoiceId, entityType, entityId, limit = 200 } = {}) {
  const params = [orgId];
  const where = ['a.organisation_id = $1'];
  if (invoiceId) { params.push(invoiceId); where.push(`a.invoice_id = $${params.length}`); }
  if (entityType) { params.push(entityType); where.push(`a.entity_type = $${params.length}`); }
  if (entityId) { params.push(String(entityId)); where.push(`a.entity_id = $${params.length}`); }
  params.push(Math.min(Number(limit) || 200, 1000));
  const { rows } = await q.query(
    `SELECT a.id, a.action, a.entity_type, a.entity_id, a.invoice_id, a.before_state, a.after_state,
            a.reason, a.created_at, u.name AS actor_name
       FROM billing_audit_events a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
  return rows;
}

module.exports = { recordAudit, listAudit };
