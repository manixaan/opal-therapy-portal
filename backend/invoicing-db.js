'use strict';

/**
 * INVOICING DATA ACCESS (owner-only module)
 *
 * Calendar events (all therapists in the organisation) → invoice rows.
 * Raw parameterised SQL on the shared pool. No client content is written to
 * warnings; descriptions carry the service name and date only.
 */

const { pool } = require('./database');

// ── Client billing settings ────────────────────────────────────────────────
async function listClientSettings(organisationId) {
  const { rows } = await pool.query(
    `SELECT * FROM invoice_client_settings WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY client_name`,
    [organisationId || null]
  );
  return rows;
}

async function getClientSettings(organisationId, clientId) {
  const { rows } = await pool.query(
    `SELECT * FROM invoice_client_settings WHERE organisation_id IS NOT DISTINCT FROM $1 AND client_id = $2`,
    [organisationId || null, String(clientId)]
  );
  return rows[0] || null;
}

async function upsertClientSettings(organisationId, clientId, s, userId) {
  const { rows } = await pool.query(
    `INSERT INTO invoice_client_settings
       (organisation_id, client_id, client_name, funding_type, age_band, budget, mmm,
        agreed_hourly_rate, per_km_rate, agreement, invoice_to_name, invoice_to_email,
        ndis_number, notes, updated_by_user_id, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,NOW())
     ON CONFLICT (organisation_id, client_id) DO UPDATE SET
       client_name = EXCLUDED.client_name, funding_type = EXCLUDED.funding_type,
       age_band = EXCLUDED.age_band, budget = EXCLUDED.budget, mmm = EXCLUDED.mmm,
       agreed_hourly_rate = EXCLUDED.agreed_hourly_rate, per_km_rate = EXCLUDED.per_km_rate,
       agreement = EXCLUDED.agreement, invoice_to_name = EXCLUDED.invoice_to_name,
       invoice_to_email = EXCLUDED.invoice_to_email, ndis_number = EXCLUDED.ndis_number,
       notes = EXCLUDED.notes, updated_by_user_id = EXCLUDED.updated_by_user_id, updated_at = NOW()
     RETURNING *`,
    [organisationId || null, String(clientId), s.clientName || null, s.fundingType, s.ageBand, s.budget, s.mmm,
     s.agreedHourlyRate ?? null, s.perKmRate ?? 0.99, JSON.stringify(s.agreement || {}),
     s.invoiceToName || null, s.invoiceToEmail || null, s.ndisNumber || null, s.notes || null, userId || null]
  );
  return rows[0];
}

// ── Calendar events for a period (all therapists in the org) ──────────────
async function listBillableEvents(organisationId, { start, end, therapistProfileIds }) {
  const params = [organisationId || null, start, end];
  let therapistClause = '';
  if (therapistProfileIds && therapistProfileIds.length) {
    params.push(therapistProfileIds);
    therapistClause = `AND e.therapist_profile_id = ANY($${params.length}::uuid[])`;
  }
  const { rows } = await pool.query(
    `SELECT e.id, e.title, e.start_time, e.end_time, e.location, e.event_type, e.status,
            e.client_id, e.client_name, e.splose_id, e.therapist_profile_id,
            e.travel_time_minutes, e.travel_distance, e.custom_metadata,
            tp.display_name AS therapist_name, tp.colour AS therapist_colour,
            il.invoice_id AS invoiced_invoice_id, inv.invoice_number AS invoiced_number
       FROM events e
       JOIN therapist_profiles tp ON tp.id = e.therapist_profile_id
       LEFT JOIN LATERAL (
         SELECT invoice_id FROM invoice_lines l
          WHERE l.event_id = e.id AND l.active AND l.kind NOT IN ('travel_labour','travel_non_labour')
          LIMIT 1) il ON TRUE
       LEFT JOIN invoices inv ON inv.id = il.invoice_id
      WHERE tp.organisation_id IS NOT DISTINCT FROM $1
        AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)
        AND e.start_time >= $2 AND e.start_time < $3
        AND e.event_type IN ('therapy')
        ${therapistClause}
      ORDER BY e.therapist_profile_id, e.start_time`,
    params
  );
  return rows;
}

async function getEventsByIds(organisationId, ids) {
  if (!ids || !ids.length) return [];
  const { rows } = await pool.query(
    `SELECT e.*, tp.display_name AS therapist_name,
            EXISTS (SELECT 1 FROM invoice_lines l WHERE l.event_id = e.id AND l.active
                      AND l.kind NOT IN ('travel_labour','travel_non_labour')) AS already_invoiced
       FROM events e JOIN therapist_profiles tp ON tp.id = e.therapist_profile_id
      WHERE e.id = ANY($1::uuid[]) AND tp.organisation_id IS NOT DISTINCT FROM $2
        AND (e.is_deleted IS NULL OR e.is_deleted = FALSE)`,
    [ids, organisationId || null]
  );
  return rows;
}

async function listTherapists(organisationId) {
  const { rows } = await pool.query(
    `SELECT id, display_name, colour, role_title, is_active FROM therapist_profiles
      WHERE organisation_id IS NOT DISTINCT FROM $1 ORDER BY display_name`,
    [organisationId || null]
  );
  return rows;
}

// ── Invoices ───────────────────────────────────────────────────────────────
async function nextInvoiceNumber(client, organisationId) {
  const { rows } = await client.query(
    `INSERT INTO invoice_counters (organisation_id, next_number) VALUES ($1, 2)
     ON CONFLICT (organisation_id) DO UPDATE SET next_number = invoice_counters.next_number + 1
     RETURNING next_number - 1 AS n`,
    [organisationId]
  );
  return 'INV-' + String(rows[0].n).padStart(6, '0');
}

/**
 * Create one invoice with its lines in a single transaction. Throws
 * { code: 'event_already_invoiced' } if a line's event already carries a
 * live claim of the same kind (the partial unique index enforces it).
 */
async function createInvoice(organisationId, inv, lines, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The counter needs a non-null org key. Fall back to the nil UUID for
    // single-tenant installs without an organisation row.
    const counterKey = organisationId || '00000000-0000-0000-0000-000000000000';
    const number = inv.invoiceNumber || await nextInvoiceNumber(client, counterKey);
    const subtotal = Math.round(lines.reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;
    const { rows } = await client.query(
      `INSERT INTO invoices
         (organisation_id, invoice_number, batch_id, client_id, client_name, invoice_to_name, invoice_to_email,
          practitioner_profile_id, practitioner_name, issue_date, due_date, period_start, period_end,
          status, subtotal, total, warnings, reference, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'draft',$14,$14,$15::jsonb,$16,$17,$18)
       RETURNING *`,
      [organisationId || null, number, inv.batchId || null, String(inv.clientId), inv.clientName || null,
       inv.invoiceToName || null, inv.invoiceToEmail || null, inv.practitionerProfileId || null,
       inv.practitionerName || null, inv.issueDate, inv.dueDate || null, inv.periodStart || null, inv.periodEnd || null,
       subtotal, JSON.stringify(inv.warnings || []), inv.reference || null, inv.notes || null, userId || null]
    );
    const invoice = rows[0];
    let i = 0;
    for (const l of lines) {
      await client.query(
        `INSERT INTO invoice_lines
           (invoice_id, event_id, kind, item_code, description, service_date, minutes, quantity,
            unit_amount, price_limit, amount, warnings, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)`,
        [invoice.id, l.eventId || null, l.kind, l.itemCode || null, l.description || null, l.serviceDate || null,
         l.minutes ?? null, l.quantity ?? 1, l.unitAmount, l.priceLimit ?? null, l.amount,
         JSON.stringify(l.warnings || []), i++]
      );
    }
    await client.query('COMMIT');
    return invoice;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505' && /uq_invoice_lines_event_kind_active/.test(err.message || '')) {
      const e = new Error('An event on this invoice is already invoiced'); e.code = 'event_already_invoiced'; throw e;
    }
    throw err;
  } finally {
    client.release();
  }
}

async function listInvoices(organisationId, { status, q, limit = 200 } = {}) {
  const params = [organisationId || null];
  const where = ['organisation_id IS NOT DISTINCT FROM $1'];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (q) { params.push('%' + q + '%'); where.push(`(invoice_number ILIKE $${params.length} OR client_name ILIKE $${params.length} OR invoice_to_name ILIKE $${params.length})`); }
  params.push(Math.min(500, Number(limit) || 200));
  const { rows } = await pool.query(
    `SELECT * FROM invoices WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${params.length}`, params
  );
  return rows;
}

async function getInvoice(organisationId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM invoices WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2`, [id, organisationId || null]
  );
  if (!rows[0]) return null;
  const lines = await pool.query(`SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY sort_order`, [id]);
  return { ...rows[0], lines: lines.rows };
}

const STATUS_FLOW = { draft: ['approved', 'void'], approved: ['sent', 'draft', 'void'], sent: ['paid', 'void'], paid: [], void: [] };

async function setInvoiceStatus(organisationId, id, status) {
  const inv = await getInvoice(organisationId, id);
  if (!inv) return { error: 'not_found' };
  if (!(STATUS_FLOW[inv.status] || []).includes(status)) return { error: 'invalid_transition', from: inv.status };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE invoices SET status = $2::text, voided_at = CASE WHEN $2::text = 'void' THEN NOW() ELSE voided_at END, updated_at = NOW() WHERE id = $1`,
      [id, status]
    );
    if (status === 'void') await client.query(`UPDATE invoice_lines SET active = FALSE WHERE invoice_id = $1`, [id]);
    await client.query('COMMIT');
  } catch (err) { await client.query('ROLLBACK').catch(() => {}); throw err; } finally { client.release(); }
  return { invoice: await getInvoice(organisationId, id) };
}

module.exports = {
  listClientSettings, getClientSettings, upsertClientSettings,
  listBillableEvents, getEventsByIds, listTherapists,
  createInvoice, listInvoices, getInvoice, setInvoiceStatus, STATUS_FLOW,
};
