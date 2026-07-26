'use strict';

/**
 * XERO READ-ONLY SYNC LAYER
 *
 * Pulls Contacts, Invoices, Payments, Accounts and Items from Xero into the
 * local caches. Read-only: never writes to Xero. Handles token refresh
 * (persisting the rotated refresh token), rate-limit backoff (in xero-api),
 * pagination, per-resource sync state, and a sanitised sync log.
 *
 * Injectable deps make it unit-testable without real Xero:
 *   createXeroSync({ xeroApi, adb, logger })
 */

function mapContact(c) {
  return {
    xero_contact_id: c.ContactID,
    name: c.Name,
    email: c.EmailAddress || null,
    is_customer: c.IsCustomer ?? null,
    updated_date_utc: parseXeroDate(c.UpdatedDateUTC),
  };
}

function mapInvoice(i) {
  return {
    xero_invoice_id: i.InvoiceID,
    invoice_number: i.InvoiceNumber || null,
    xero_contact_id: i.Contact?.ContactID || null,
    contact_name: i.Contact?.Name || null,
    type: i.Type || null,
    status: i.Status || null,
    invoice_date: parseXeroDate(i.DateString || i.Date),
    due_date: parseXeroDate(i.DueDateString || i.DueDate),
    currency_code: i.CurrencyCode || null,
    sub_total: num(i.SubTotal),
    total_tax: num(i.TotalTax),
    total: num(i.Total),
    amount_due: num(i.AmountDue),
    amount_paid: num(i.AmountPaid),
    reference: i.Reference || null,
    updated_date_utc: parseXeroDate(i.UpdatedDateUTC),
  };
}

function mapPayment(p) {
  return {
    xero_payment_id: p.PaymentID,
    xero_invoice_id: p.Invoice?.InvoiceID || null,
    invoice_number: p.Invoice?.InvoiceNumber || null,
    xero_contact_id: p.Invoice?.Contact?.ContactID || null,
    contact_name: p.Invoice?.Contact?.Name || null,
    amount: num(p.Amount),
    currency_code: p.CurrencyRate ? null : (p.Invoice?.CurrencyCode || null),
    payment_date: parseXeroDate(p.DateString || p.Date),
    reference: p.Reference || null,
    status: p.Status || null,
    updated_date_utc: parseXeroDate(p.UpdatedDateUTC),
  };
}

function mapAccount(a) {
  return {
    xero_account_id: a.AccountID,
    code: a.Code || null,
    name: a.Name || null,
    type: a.Type || null,
    tax_type: a.TaxType || null,
    class: a.Class || null,
    status: a.Status || null,
  };
}

function mapItem(it) {
  return {
    xero_item_id: it.ItemID,
    code: it.Code || null,
    name: it.Name || null,
    description: it.Description || null,
    sales_unit_price: num(it.SalesDetails?.UnitPrice),
    sales_account_code: it.SalesDetails?.AccountCode || null,
    sales_tax_type: it.SalesDetails?.TaxType || null,
  };
}

// Xero dates arrive as "/Date(1656633600000+0000)/" or ISO strings.
function parseXeroDate(v) {
  if (!v) return null;
  const m = /\/Date\((\d+)/.exec(v);
  if (m) return new Date(Number(m[1]));
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}
function num(v) { return (v === undefined || v === null) ? null : Number(v); }

const RESOURCES = [
  { name: 'accounts', path: '/Accounts', key: 'Accounts', map: mapAccount },
  { name: 'items', path: '/Items', key: 'Items', map: mapItem },
  { name: 'contacts', path: '/Contacts', key: 'Contacts', map: mapContact },
  { name: 'invoices', path: '/Invoices', key: 'Invoices', map: mapInvoice },
  { name: 'payments', path: '/Payments', key: 'Payment', map: mapPayment },
];

function createXeroSync({ xeroApi, adb, logger = console }) {
  let running = false;

  /** Run a full read-only sync of all resources for a connection. */
  async function syncAll(connection, { organisationId } = {}) {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    const summary = { synced: {}, errors: [], blocked: [] };
    try {
      const accessToken = await xeroApi.ensureValidToken(connection, async (refreshed) => {
        await adb.updateConnectionTokens(connection.id, refreshed);
      });
      const tenantId = connection.xero_tenant_id;

      for (const r of RESOURCES) {
        const started = Date.now();
        try {
          const { items, complete } = await xeroApi.apiGetAll(accessToken, tenantId, r.path, r.key);
          if (!complete) {
            // Truncated fetch — record but do not treat as authoritative.
            summary.blocked.push(r.name);
            await adb.setSyncState(connection.id, r.name, { status: 'blocked', records: items.length, error: 'pagination_truncated' });
            await adb.logFinanceSync(connection.id, { resource: r.name, status: 'blocked', records: items.length, durationMs: Date.now() - started, message: 'pagination truncated' });
            continue;
          }
          const mapped = items.map(r.map).filter(x => x[Object.keys(x)[0]]);
          const n = await adb.upsertCache(r.name, connection.id, mapped);
          summary.synced[r.name] = n;
          await adb.setSyncState(connection.id, r.name, { status: 'ok', records: n });
          await adb.logFinanceSync(connection.id, { resource: r.name, status: 'ok', records: n, durationMs: Date.now() - started });
        } catch (err) {
          const code = err.response?.data?.Detail || err.response?.status || err.message;
          summary.errors.push({ resource: r.name, code: String(code).slice(0, 120) });
          await adb.setSyncState(connection.id, r.name, { status: 'error', error: String(code) });
          await adb.logFinanceSync(connection.id, { resource: r.name, status: 'error', durationMs: Date.now() - started, message: String(code) });
          logger.warn?.(`Xero sync ${r.name} failed`, { code: String(code).slice(0, 120) });
        }
      }
      return summary;
    } finally {
      running = false;
    }
  }

  return { syncAll, isRunning: () => running };
}

module.exports = { createXeroSync, _maps: { mapContact, mapInvoice, mapPayment, mapAccount, mapItem, parseXeroDate } };
