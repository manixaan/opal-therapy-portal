'use strict';

/**
 * INVOICE CANDIDATE ENGINE (Accounting module)
 *
 * Turns billable Splose appointments into invoice candidates (idempotently —
 * keyed by appointment id, so re-running never duplicates). Read-only toward
 * both Splose and Xero. Draft invoice creation is a separate, flag-gated step.
 *
 * Injectable deps for testability:
 *   createCandidateEngine({ adb, pricing, logger })
 * Splose appointments are passed in (the caller fetches them via the existing
 * read-only Splose API), keeping this engine pure of network concerns.
 */

function createCandidateEngine({ adb, pricing, logger = console }) {
  /**
   * Generate/refresh candidates for a batch of Splose appointments.
   * @param appointments normalised Splose appointment objects
   * @param ctx { organisationId, pricingRules, serviceMappings, contactMappings }
   */
  async function generate(appointments, ctx) {
    const rules = ctx.pricingRules || [];
    const serviceMap = indexBy(ctx.serviceMappings || [], 'splose_service_id');
    const contactMap = indexBy(ctx.contactMappings || [], 'splose_client_id');

    const summary = { created: 0, updated: 0, ignored: 0, needsMapping: 0, needsPricing: 0, errors: 0 };

    for (const appt of appointments) {
      try {
        const sm = serviceMap[appt.serviceId] || {};
        const cm = contactMap[appt.clientId] || {};
        const priceCtx = {
          sploseServiceId: appt.serviceId,
          serviceName: appt.serviceName,
          appointmentType: appt.appointmentType || 'therapy',
          fundingType: appt.fundingType || null,
          mmmClassification: appt.mmmClassification || null,
          appointmentDate: appt.date,
          durationMinutes: appt.durationMinutes || null,
          appointmentStatus: appt.status,
          xeroContactId: cm.xero_contact_id || null,
          description: appt.description || appt.serviceName,
        };

        const priced = pricing.priceAppointment(priceCtx, rules, {
          xeroAccountCode: sm.xero_account_code, xeroItemCode: sm.xero_item_code, taxType: sm.tax_type,
        });

        // Service not mapped is its own explicit status (distinct from pricing).
        let status = priced.status;
        const warnings = [...priced.warnings];
        if (!sm.splose_service_id && status !== 'ignored') {
          status = 'needs_mapping';
          if (!warnings.includes('service_not_mapped')) warnings.push('service_not_mapped');
        }
        // Unresolved payer/contact mapping blocks readiness — a candidate can
        // never be reviewable without a confirmed Xero ContactID.
        if (!cm.xero_contact_id && status !== 'ignored') {
          status = 'needs_mapping';
          if (!warnings.includes('no_contact_mapping')) warnings.push('no_contact_mapping');
        }
        if (status === 'priced') status = 'ready_for_review';

        const saved = await adb.upsertCandidate({
          organisationId: ctx.organisationId,
          sploseAppointmentId: appt.id,
          sploseClientId: appt.clientId || null,
          sploseServiceId: appt.serviceId || null,
          practitionerRef: appt.practitionerId || null,
          appointmentDate: appt.date || null,
          appointmentStatus: appt.status || null,
          xeroContactId: cm.xero_contact_id || null,
          status,
          currencyCode: 'AUD',
          totalAmount: priced.totalAmount,
          totalTax: priced.totalTax,
          warnings,
          pricingSource: priced.pricingSource,
        }, priced.lines);

        if (status === 'ignored') summary.ignored++;
        else if (status === 'needs_mapping') summary.needsMapping++;
        else if (status === 'needs_pricing') summary.needsPricing++;
        else summary.created++;
        void saved;
      } catch (err) {
        summary.errors++;
        logger.warn?.('candidate generation failed', { appointmentId: appt.id, error: err.message });
      }
    }
    return summary;
  }

  return { generate };
}

function indexBy(arr, key) {
  const out = {};
  for (const x of arr) if (x[key] != null) out[x[key]] = x;
  return out;
}

module.exports = { createCandidateEngine };
