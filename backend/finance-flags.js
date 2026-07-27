'use strict';

/**
 * FINANCE / XERO FEATURE FLAGS (Accounting module)
 *
 * Stricter than the Outlook/Splose flags: money is involved, so every WRITE
 * flag fails closed in EVERY environment — including development and test.
 * Only the literal string 'true' enables a write; anything else (unset,
 * empty, 'false', 'yes', garbage) means OFF. There is no dev-convenience
 * default-on for writes.
 *
 *   ENABLE_XERO_READ                 read-only Xero sync + dashboards
 *   ENABLE_FINANCE_DASHBOARD         finance dashboard UI/data
 *   ENABLE_XERO_WRITE                master write gate (must also be on)
 *   ENABLE_XERO_DRAFT_INVOICE_CREATE create DRAFT invoices in Xero
 *   ENABLE_XERO_APPROVE_INVOICE      approve invoices (deferred)
 *   ENABLE_XERO_SEND_INVOICE         email invoices (deferred)
 *   ENABLE_XERO_PAYMENT_CREATE       apply payments to invoices (deferred)
 *   ENABLE_XERO_AUTO_RECONCILIATION  automatic reconciliation (deferred)
 *   ENABLE_XERO_WEBHOOKS             accept Xero webhooks
 *
 * Read flags (ENABLE_XERO_READ, ENABLE_FINANCE_DASHBOARD) default ON so the
 * read-only module works out of the box; every write flag defaults OFF.
 */

/** A write flag is ON only when explicitly 'true'. No environment default. */
function writeFlag(name) {
  return process.env[name] === 'true';
}

/** A read flag defaults ON unless explicitly 'false'. */
function readFlag(name) {
  return process.env[name] !== 'false';
}

const isXeroReadEnabled = () => readFlag('ENABLE_XERO_READ');
const isFinanceDashboardEnabled = () => readFlag('ENABLE_FINANCE_DASHBOARD');
const isExceptionDashboardEnabled = () => readFlag('ENABLE_ACCOUNTING_EXCEPTION_DASHBOARD');

// Every write requires BOTH the master write gate AND the specific action flag.
const isXeroWriteEnabled = () => writeFlag('ENABLE_XERO_WRITE');
const isDraftInvoiceCreateEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_DRAFT_INVOICE_CREATE');
const isContactCreateEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_CONTACT_CREATE');
const isApproveInvoiceEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_APPROVE_INVOICE');
const isSendInvoiceEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_SEND_INVOICE');
const isPaymentCreateEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_PAYMENT_CREATE');
const isAutoReconciliationEnabled = () =>
  isXeroWriteEnabled() && writeFlag('ENABLE_XERO_AUTO_RECONCILIATION');
const isWebhooksEnabled = () => writeFlag('ENABLE_XERO_WEBHOOKS');

/** Sanitised snapshot for diagnostics / boot logs / UI. */
function financeFlagState() {
  return {
    xeroRead: isXeroReadEnabled(),
    financeDashboard: isFinanceDashboardEnabled(),
    exceptionDashboard: isExceptionDashboardEnabled(),
    xeroWrite: isXeroWriteEnabled(),
    draftInvoiceCreate: isDraftInvoiceCreateEnabled(),
    contactCreate: isContactCreateEnabled(),
    approveInvoice: isApproveInvoiceEnabled(),
    sendInvoice: isSendInvoiceEnabled(),
    paymentCreate: isPaymentCreateEnabled(),
    autoReconciliation: isAutoReconciliationEnabled(),
    webhooks: isWebhooksEnabled(),
  };
}

/** Error a finance write throws / a route returns when its flag is off. */
function financeDisabledError(flagName, what) {
  const err = new Error(
    `${what} is disabled (${flagName}=false). This is a fail-closed finance ` +
    'control — see docs/accounting/XERO_API_CAPABILITY_MATRIX.md.'
  );
  err.code = 'FINANCE_DISABLED';
  err.flag = flagName;
  err.statusCode = 403;
  return err;
}

module.exports = {
  isXeroReadEnabled,
  isFinanceDashboardEnabled,
  isExceptionDashboardEnabled,
  isXeroWriteEnabled,
  isDraftInvoiceCreateEnabled,
  isContactCreateEnabled,
  isApproveInvoiceEnabled,
  isSendInvoiceEnabled,
  isPaymentCreateEnabled,
  isAutoReconciliationEnabled,
  isWebhooksEnabled,
  financeFlagState,
  financeDisabledError,
};
