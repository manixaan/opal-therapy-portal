'use strict';

/**
 * TRIP ALLOCATION — divides a rural trip's eligible shared operating costs
 * across the participating clients. Pure.
 *
 * Methods:
 *   EQUAL_PER_CLIENT  (default) pool ÷ unique participating clients
 *   PER_SESSION       pool ∝ each client's billable session count
 *   MANUAL_WEIGHTED   pool ∝ an owner-entered weight per client
 *
 * Guarantee: Σ allocations === eligible pool, to the cent. Remainder cents
 * from an uneven split go to clients by largest remainder, ties broken by
 * the stable client ordering, so re-running produces the same split. An
 * allocation can never exceed the pool because it is derived from it.
 */

const M = require('./money');

const METHODS = Object.freeze(['EQUAL_PER_CLIENT', 'PER_SESSION', 'MANUAL_WEIGHTED']);
const COST_MODES = Object.freeze({ SHARED: 'SHARED_BILLABLE', NON_BILLABLE: 'NON_BILLABLE' });

/**
 * @param {Array} costs  [{id, amount, billableMode}]
 * @returns {{totalCents, nonBillableCents, eligibleCents, eligibleCostIds}}
 */
function summariseCosts(costs) {
  let totalCents = 0, nonBillableCents = 0, eligibleCents = 0;
  const eligibleCostIds = [];
  for (const c of costs) {
    const cents = M.toCents(c.amount) || 0;
    totalCents += cents;
    if (c.billableMode === COST_MODES.SHARED) { eligibleCents += cents; eligibleCostIds.push(c.id); }
    else nonBillableCents += cents;
  }
  return { totalCents, nonBillableCents, eligibleCents, eligibleCostIds };
}

/**
 * @param {object} p
 * @param {number} p.eligibleCents
 * @param {string} p.method
 * @param {Array}  p.clients [{clientId, sessionCount, weight}] — only included clients
 */
function allocate({ eligibleCents, method = 'EQUAL_PER_CLIENT', clients }) {
  if (!METHODS.includes(method)) throw new Error(`Unknown allocation method ${method}`);
  const list = [...clients].sort((a, b) => String(a.clientId).localeCompare(String(b.clientId)));
  const weights = list.map(c => {
    if (method === 'EQUAL_PER_CLIENT') return 1;
    if (method === 'PER_SESSION') return Math.max(0, Number(c.sessionCount) || 0);
    // manual weights may be decimals; scale to integers (4 dp)
    return Math.max(0, Math.round((Number(c.weight) || 0) * 10000));
  });
  const totalWeight = weights.reduce((a, w) => a + w, 0);
  const parts = M.allocateCents(eligibleCents, weights);
  const allocatedCents = parts.reduce((a, b) => a + b, 0);
  return {
    method,
    eligibleCents,
    clientCount: list.length,
    totalWeight,
    allocatedCents,
    unallocatedCents: eligibleCents - allocatedCents,
    allocations: list.map((c, i) => ({
      clientId: c.clientId,
      weight: weights[i],
      sessionCount: c.sessionCount || 0,
      amountCents: parts[i],
    })),
  };
}

module.exports = { METHODS, COST_MODES, summariseCosts, allocate };
