'use strict';

/**
 * PRICING ENGINE (Accounting module)
 *
 * Given a Splose appointment context and a set of pricing rules, selects the
 * best-matching rule and produces invoice-candidate line items with warnings.
 * Pure functions — no DB, no network — so it is exhaustively unit-testable.
 *
 * No NDIS rates are hardcoded: rates come entirely from owner-managed
 * finance_pricing_rules. A context with no matching rule yields a
 * needs_pricing warning, never a guessed amount.
 */

/**
 * Rank rules by specificity. A rule matches a context if each of its
 * non-null selectors equals the context value. Among matches, the one with
 * the LOWEST priority number wins (most specific first); ties broken by most
 * recent effective_from.
 */
function ruleMatches(rule, ctx, onDate) {
  if (rule.active === false) return false;
  if (rule.splose_service_id && rule.splose_service_id !== ctx.sploseServiceId) return false;
  if (rule.appointment_type && rule.appointment_type !== ctx.appointmentType) return false;
  if (rule.funding_type && rule.funding_type !== ctx.fundingType) return false;
  if (rule.mmm_classification && rule.mmm_classification !== ctx.mmmClassification) return false;
  // Effective-date window
  const d = onDate || ctx.appointmentDate;
  if (d) {
    if (rule.effective_from && new Date(rule.effective_from) > new Date(d)) return false;
    if (rule.effective_to && new Date(rule.effective_to) < new Date(d)) return false;
  }
  return true;
}

function specificity(rule) {
  // More non-null selectors = more specific = should win regardless of priority.
  let s = 0;
  if (rule.splose_service_id) s++;
  if (rule.appointment_type) s++;
  if (rule.funding_type) s++;
  if (rule.mmm_classification) s++;
  return s;
}

function selectRule(rules, ctx) {
  const matches = rules.filter(r => ruleMatches(r, ctx));
  if (!matches.length) return null;
  matches.sort((a, b) => {
    const sd = specificity(b) - specificity(a);
    if (sd !== 0) return sd;
    const pd = (a.priority ?? 100) - (b.priority ?? 100);
    if (pd !== 0) return pd;
    return new Date(b.effective_from || 0) - new Date(a.effective_from || 0);
  });
  return matches[0];
}

/**
 * Price an appointment context.
 * @returns { lines, totalAmount, totalTax, warnings, pricingSource, status }
 *   status is one of: priced | needs_pricing | needs_mapping
 */
function priceAppointment(ctx, rules, mapping = {}) {
  const warnings = [];

  // Cancelled / non-billable appointments produce no lines.
  const status = String(ctx.appointmentStatus || '').toLowerCase();
  if (status.includes('cancel')) {
    return { lines: [], totalAmount: 0, totalTax: 0, warnings: ['appointment_cancelled'], pricingSource: null, status: 'ignored' };
  }

  const rule = selectRule(rules, ctx);
  if (!rule) {
    warnings.push('no_pricing_rule');
    return { lines: [], totalAmount: 0, totalTax: 0, warnings, pricingSource: null, status: 'needs_pricing' };
  }

  // Quantity: duration in hours if the rule is hourly, else 1 unit.
  const hours = ctx.durationMinutes ? Math.round((ctx.durationMinutes / 60) * 1000) / 1000 : 1;
  const quantity = ctx.quantity != null ? ctx.quantity : (ctx.durationMinutes ? hours : 1);

  const accountCode = rule.xero_account_code || mapping.xeroAccountCode || null;
  const itemCode = rule.xero_item_code || mapping.xeroItemCode || null;
  if (!accountCode && !itemCode) warnings.push('no_account_or_item_code');

  const taxType = rule.tax_type || mapping.taxType || 'NONE';
  const unitAmount = Number(rule.unit_amount);
  if (!(unitAmount > 0)) warnings.push('non_positive_rate');

  const lineTotal = Math.round(unitAmount * quantity * 100) / 100;
  // GST handling: if taxType indicates GST, compute 10% inclusive/exclusive is
  // left to Xero; we record the tax_type and let Xero calculate. totalTax is a
  // best-effort local estimate for the dashboard only.
  const gstApplies = /GST|OUTPUT|INPUT/i.test(taxType) && !/EXEMPT|NONE|FREE/i.test(taxType);
  const totalTax = gstApplies ? Math.round(lineTotal * 0.10 * 100) / 100 : 0;

  const description = ctx.description
    || [ctx.serviceName, ctx.appointmentDate].filter(Boolean).join(' — ')
    || 'Therapy service';

  const lines = [{
    description,
    quantity,
    unitAmount,
    taxType,
    accountCode,
    itemCode,
  }];

  const needsMapping = !ctx.xeroContactId;
  if (needsMapping) warnings.push('no_contact_mapping');

  return {
    lines,
    totalAmount: lineTotal,
    totalTax,
    warnings,
    pricingSource: rule.name || `rule:${rule.id}`,
    status: needsMapping ? 'needs_mapping' : 'priced',
  };
}

module.exports = { priceAppointment, selectRule, ruleMatches, specificity };
