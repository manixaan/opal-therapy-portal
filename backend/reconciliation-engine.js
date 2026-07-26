'use strict';

/**
 * RECONCILIATION ASSISTANT (Accounting module)
 *
 * Suggestion-only. Given cached Xero payments and invoices, proposes matches
 * with a confidence level. This is NOT bank reconciliation — the Xero public
 * API cannot reconcile bank statement lines (see
 * docs/accounting/XERO_API_CAPABILITY_MATRIX.md). The owner reviews each
 * suggestion in the portal; the portal only records the decision.
 *
 * Pure function — no DB, no network — for exhaustive unit testing.
 */

const AMOUNT_TOLERANCE = 0.01;

/**
 * @param payments  array of cached payment rows (may reference an invoice)
 * @param invoices  array of cached ACCREC invoice rows
 * @returns array of suggestion objects (see shape below)
 */
function suggestMatches(payments, invoices) {
  const invByXeroId = new Map();
  const invByNumber = new Map();
  for (const inv of invoices) {
    if (inv.xero_invoice_id) invByXeroId.set(inv.xero_invoice_id, inv);
    if (inv.invoice_number) invByNumber.set(String(inv.invoice_number).toLowerCase(), inv);
  }

  const suggestions = [];
  const matchedInvoiceIds = new Set();

  for (const p of payments) {
    const payAmt = Number(p.amount) || 0;

    // 1. Direct link — payment already references an invoice.
    let inv = p.xero_invoice_id ? invByXeroId.get(p.xero_invoice_id) : null;
    let matchReasonBase = inv ? ['payment_links_invoice'] : [];

    // 2. Reference matches an invoice number.
    if (!inv && p.reference) {
      const cand = invByNumber.get(String(p.reference).toLowerCase());
      if (cand) { inv = cand; matchReasonBase = ['reference_matches_invoice_number']; }
    }

    if (!inv) {
      suggestions.push({
        xeroPaymentId: p.xero_payment_id, xeroInvoiceId: null,
        matchType: 'unmatched_payment', confidence: 'manual_review_required',
        amountPayment: payAmt, amountInvoice: null,
        reasons: ['no_matching_invoice'],
      });
      continue;
    }

    matchedInvoiceIds.add(inv.xero_invoice_id);
    const invTotal = Number(inv.total) || 0;
    const reasons = [...matchReasonBase];
    let matchType = 'exact';
    let confidence = 'high';

    const diff = Math.round((payAmt - invTotal) * 100) / 100;
    if (Math.abs(diff) <= AMOUNT_TOLERANCE) {
      matchType = 'exact';
      reasons.push('amount_exact');
    } else if (payAmt < invTotal) {
      matchType = payAmt > 0 && payAmt < invTotal ? 'partial' : 'underpayment';
      reasons.push('amount_less_than_invoice');
      confidence = 'medium';
    } else {
      matchType = 'overpayment';
      reasons.push('amount_greater_than_invoice');
      confidence = 'medium';
    }

    // Contact cross-check lowers confidence on mismatch.
    if (p.contact_name && inv.contact_name &&
        p.contact_name.trim().toLowerCase() !== inv.contact_name.trim().toLowerCase()) {
      reasons.push('contact_name_mismatch');
      confidence = confidence === 'high' ? 'medium' : 'low';
    }

    // Reference-only matches (no direct link) never rate "high".
    if (matchReasonBase[0] === 'reference_matches_invoice_number' && confidence === 'high') {
      confidence = 'medium';
    }

    suggestions.push({
      xeroPaymentId: p.xero_payment_id, xeroInvoiceId: inv.xero_invoice_id,
      matchType, confidence, amountPayment: payAmt, amountInvoice: invTotal, reasons,
    });
  }

  // Unmatched AUTHORISED invoices with an outstanding balance.
  for (const inv of invoices) {
    if (matchedInvoiceIds.has(inv.xero_invoice_id)) continue;
    if (inv.status === 'AUTHORISED' && Number(inv.amount_due) > 0) {
      suggestions.push({
        xeroPaymentId: null, xeroInvoiceId: inv.xero_invoice_id,
        matchType: 'unmatched_invoice', confidence: 'low',
        amountPayment: null, amountInvoice: Number(inv.total) || 0,
        reasons: [inv.due_date && new Date(inv.due_date) < new Date() ? 'overdue' : 'awaiting_payment'],
      });
    }
  }

  return suggestions;
}

module.exports = { suggestMatches, AMOUNT_TOLERANCE };
