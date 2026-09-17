'use strict';

/**
 * FINANCE PORTAL — read-only aggregations over the Xero cache.
 *
 * Everything here reads the tables the accounting sync already fills
 * (xero_invoices_cache carries both ACCREC sales invoices and ACCPAY bills)
 * and the invoice-candidate table. Nothing writes. Every query is scoped to
 * one Xero connection, which is itself scoped to one organisation.
 */

const { pool } = require('./database');

function n(v) { return Number(v || 0); }

/** Money in / money out for the current month and the trailing months. */
async function computeFinancials(connectionId, { months = 6 } = {}) {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const iso = monthStart.toISOString().slice(0, 10);

  const totals = (await pool.query(
    `SELECT
        COALESCE(SUM(total) FILTER (WHERE type='ACCREC' AND status IN ('AUTHORISED','PAID') AND invoice_date >= $2), 0) AS revenue_month,
        COALESCE(SUM(total) FILTER (WHERE type='ACCPAY' AND status IN ('AUTHORISED','PAID') AND invoice_date >= $2), 0) AS expenses_month,
        COALESCE(SUM(amount_due) FILTER (WHERE type='ACCREC' AND status='AUTHORISED'), 0) AS receivable,
        COALESCE(SUM(amount_due) FILTER (WHERE type='ACCREC' AND status='AUTHORISED' AND due_date < CURRENT_DATE), 0) AS receivable_overdue,
        COALESCE(SUM(amount_due) FILTER (WHERE type='ACCPAY' AND status='AUTHORISED'), 0) AS payable,
        COALESCE(SUM(amount_due) FILTER (WHERE type='ACCPAY' AND status='AUTHORISED' AND due_date < CURRENT_DATE), 0) AS payable_overdue,
        COUNT(*) FILTER (WHERE type='ACCPAY' AND status='AUTHORISED' AND amount_due > 0) AS bills_unpaid,
        COUNT(*) FILTER (WHERE type='ACCPAY' AND status='AUTHORISED' AND amount_due > 0 AND due_date < CURRENT_DATE) AS bills_overdue
       FROM xero_invoices_cache WHERE connection_id = $1`, [connectionId, iso]
  )).rows[0];

  const series = (await pool.query(
    `SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
            COALESCE(SUM(total) FILTER (WHERE type='ACCREC'), 0) AS revenue,
            COALESCE(SUM(total) FILTER (WHERE type='ACCPAY'), 0) AS expenses
       FROM xero_invoices_cache
      WHERE connection_id = $1 AND status IN ('AUTHORISED','PAID')
        AND invoice_date >= (date_trunc('month', CURRENT_DATE) - ($2::int - 1) * INTERVAL '1 month')
      GROUP BY 1 ORDER BY 1`, [connectionId, months]
  )).rows.map((r) => ({ month: r.month, revenue: n(r.revenue), expenses: n(r.expenses), net: n(r.revenue) - n(r.expenses) }));

  const topSuppliers = (await pool.query(
    `SELECT contact_name, COALESCE(SUM(total), 0) AS total, COUNT(*) AS bills
       FROM xero_invoices_cache
      WHERE connection_id = $1 AND type='ACCPAY' AND status IN ('AUTHORISED','PAID')
        AND invoice_date >= (date_trunc('month', CURRENT_DATE) - ($2::int - 1) * INTERVAL '1 month')
      GROUP BY contact_name ORDER BY total DESC LIMIT 8`, [connectionId, months]
  )).rows.map((r) => ({ name: r.contact_name || 'Unknown supplier', total: n(r.total), bills: n(r.bills) }));

  const recentBills = (await pool.query(
    `SELECT xero_invoice_id, invoice_number, contact_name, status, invoice_date, due_date, total, amount_due, reference
       FROM xero_invoices_cache
      WHERE connection_id = $1 AND type='ACCPAY' AND status <> 'DELETED'
      ORDER BY invoice_date DESC NULLS LAST LIMIT 25`, [connectionId]
  )).rows.map((r) => ({ ...r, total: n(r.total), amount_due: n(r.amount_due) }));

  return {
    month: {
      revenue: n(totals.revenue_month),
      expenses: n(totals.expenses_month),
      net: n(totals.revenue_month) - n(totals.expenses_month),
    },
    receivable: { outstanding: n(totals.receivable), overdue: n(totals.receivable_overdue) },
    payable: {
      outstanding: n(totals.payable), overdue: n(totals.payable_overdue),
      billsUnpaid: n(totals.bills_unpaid), billsOverdue: n(totals.bills_overdue),
    },
    series,
    topSuppliers,
    recentBills,
  };
}

/** Sales invoices, newest first, for the Invoicing section. */
async function listRecentSalesInvoices(connectionId, { limit = 40, status } = {}) {
  const params = [connectionId, limit];
  let where = '';
  if (status) { params.push(status); where = ` AND status = $${params.length}`; }
  const rows = (await pool.query(
    `SELECT xero_invoice_id, invoice_number, contact_name, status, invoice_date, due_date, total, amount_due, amount_paid, reference, currency_code
       FROM xero_invoices_cache
      WHERE connection_id = $1 AND type='ACCREC' AND status <> 'DELETED'${where}
      ORDER BY invoice_date DESC NULLS LAST, invoice_number DESC LIMIT $2`, params
  )).rows;
  return rows.map((r) => ({ ...r, total: n(r.total), amount_due: n(r.amount_due), amount_paid: n(r.amount_paid) }));
}

/** Candidate pipeline counts by status (Splose appointments → invoices). */
async function candidatePipeline(organisationId) {
  const rows = (await pool.query(
    `SELECT status, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
       FROM finance_invoice_candidates
      WHERE organisation_id IS NOT DISTINCT FROM $1
      GROUP BY status`, [organisationId]
  )).rows;
  return rows.map((r) => ({ status: r.status, count: n(r.count), amount: n(r.amount) }));
}

module.exports = { computeFinancials, listRecentSalesInvoices, candidatePipeline };
