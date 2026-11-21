'use strict';

/**
 * NON-FACE-TO-FACE BILLABLE TIME (migration 076, 11 Oct 2026).
 *
 * A non-face-to-face block that names clients carries a timer. The clinician
 * starts it, works, and stops it; start/stop again adds to the same total.
 * The timer can never run longer than the block itself: once it has, it is
 * stopped at that moment ("auto-stopped") — worked out whenever the row is
 * read, so no background job is needed and nothing depends on the browser.
 *
 * The timed seconds are split between the block's clients: equally by
 * default, or by the "Allocate billing" percentages. A non-billable share
 * (0% by default) comes off the top. Seconds are whole; rounding remainders
 * go to the largest shares, so the parts always add up to the billable total.
 *
 * Pure functions first; the db helpers below take a pg client or pool.
 */

/** Seconds timed so far (a running timer counts up to its limit). */
function elapsedSeconds(row, now = new Date()) {
  if (!row) return 0;
  const acc = Number(row.accumulated_seconds) || 0;
  if (row.status !== 'RUNNING' || !row.run_started_at) return Math.min(acc, Number(row.limit_seconds) || acc);
  const run = Math.max(0, Math.floor((now - new Date(row.run_started_at)) / 1000));
  return Math.min(Number(row.limit_seconds), acc + run);
}

/** A running timer that has reached its block's length is stopped at that moment. Returns the row as it now is. */
function settled(row, now = new Date()) {
  if (!row || row.status !== 'RUNNING' || !row.run_started_at) return row;
  const limit = Number(row.limit_seconds), acc = Number(row.accumulated_seconds) || 0;
  const startedMs = new Date(row.run_started_at).getTime();
  if (acc + Math.floor((now - startedMs) / 1000) < limit) return row;
  return Object.assign({}, row, {
    status: 'STOPPED', accumulated_seconds: limit, run_started_at: null, auto_stopped: true,
    stopped_at: new Date(startedMs + (limit - acc) * 1000),
  });
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * The allocation to use for a set of clients: the saved one when it covers
 * exactly these clients, else an equal split of what is billable.
 * Returns { clients: [{clientId, clientName, percent}], nonBillablePercent }.
 */
function allocationFor(row, clients) {
  const nb = row && row.non_billable_percent != null ? Number(row.non_billable_percent) : 0;
  const saved = row && Array.isArray(row.allocation) ? row.allocation : null;
  const ids = clients.map(c => String(c.clientId));
  if (saved && saved.length === ids.length && saved.every(a => ids.includes(String(a.clientId)))) {
    const byId = new Map(saved.map(a => [String(a.clientId), Number(a.percent) || 0]));
    return { nonBillablePercent: nb, clients: clients.map(c => ({ clientId: String(c.clientId), clientName: c.clientName || null, percent: byId.get(String(c.clientId)) })) };
  }
  return { nonBillablePercent: nb, clients: equalSplit(clients, 100 - nb) };
}

function equalSplit(clients, total) {
  if (!clients.length) return [];
  const each = Math.floor((total / clients.length) * 100) / 100;
  const out = clients.map(c => ({ clientId: String(c.clientId), clientName: c.clientName || null, percent: each }));
  out[0].percent = round2(total - each * (clients.length - 1));
  return out;
}

/**
 * Validate an allocation from "Allocate billing". Percentages 0–100, two
 * decimals, the clients exactly the block's, and with the non-billable share
 * they add up to 100 (±0.05). Returns { ok, allocation, nonBillablePercent } or { ok:false, error }.
 */
function validateAllocation(input, clients) {
  const nb = round2(Number(input && input.nonBillablePercent) || 0);
  if (!(nb >= 0 && nb <= 100)) return { ok: false, error: 'Non-billable must be 0–100%' };
  const list = Array.isArray(input && input.allocation) ? input.allocation : null;
  if (!list) return { ok: false, error: 'An allocation is required' };
  const ids = clients.map(c => String(c.clientId));
  if (list.length !== ids.length || !list.every(a => a && ids.includes(String(a.clientId)))
      || new Set(list.map(a => String(a.clientId))).size !== ids.length) {
    return { ok: false, error: 'The allocation must list exactly this block\'s clients' };
  }
  const names = new Map(clients.map(c => [String(c.clientId), c.clientName || null]));
  const allocation = list.map(a => ({ clientId: String(a.clientId), clientName: names.get(String(a.clientId)), percent: round2(Number(a.percent)) }));
  if (allocation.some(a => !(a.percent >= 0 && a.percent <= 100))) return { ok: false, error: 'Each share must be 0–100%' };
  const total = allocation.reduce((s, a) => s + a.percent, 0) + nb;
  if (Math.abs(total - 100) > 0.05) return { ok: false, error: `The shares add up to ${round2(total)}%, not 100%` };
  return { ok: true, allocation, nonBillablePercent: nb };
}

/**
 * Split timed seconds by an allocation. Returns [{clientId, clientName, seconds, percent}]
 * whose seconds add up to the billable part (total × (100 − non-billable)%).
 */
function splitSeconds(totalSeconds, alloc) {
  const parts = alloc.clients.map(c => ({ ...c, exact: totalSeconds * (Number(c.percent) || 0) / 100 }));
  const billable = Math.round(parts.reduce((s, p) => s + p.exact, 0));
  parts.forEach(p => { p.seconds = Math.floor(p.exact); });
  let left = billable - parts.reduce((s, p) => s + p.seconds, 0);
  [...parts].sort((a, b) => (b.exact - b.seconds) - (a.exact - a.seconds)).forEach(p => { if (left > 0) { p.seconds++; left--; } });
  return parts.map(({ exact, ...p }) => p);
}

/**
 * A block that ended with no time entered must be resolved (migration 089):
 *   { mode: 'FULL_BLOCK' }                                  the whole block, split evenly
 *   { mode: 'PER_CLIENT', minutes: [{clientId, minutes}] }  each client's own minutes
 *   { mode: 'DID_NOT_HAPPEN', reason }                      not billed; the owner is told
 * Returns { ok, resolution, seconds, allocation, clientSeconds, note } or { ok:false, error }.
 * Per-client minutes are whole minutes, at least one client above zero, and
 * together no longer than the block.
 */
function validateResolution(input, clients, blockSecs) {
  const mode = input && input.mode;
  if (mode === 'FULL_BLOCK') {
    return { ok: true, resolution: 'FULL_BLOCK', seconds: blockSecs, allocation: equalSplit(clients, 100), clientSeconds: null, note: null };
  }
  if (mode === 'DID_NOT_HAPPEN') {
    const note = String((input && input.reason) || '').trim().slice(0, 500);
    if (!note) return { ok: false, error: 'Say briefly why this work did not happen' };
    return { ok: true, resolution: 'DID_NOT_HAPPEN', seconds: 0, allocation: null, clientSeconds: null, note };
  }
  if (mode === 'PER_CLIENT') {
    const list = Array.isArray(input && input.minutes) ? input.minutes : null;
    const ids = clients.map(c => String(c.clientId));
    if (!list || list.length !== ids.length || !list.every(m => m && ids.includes(String(m.clientId)))
        || new Set(list.map(m => String(m.clientId))).size !== ids.length) {
      return { ok: false, error: 'Give minutes for exactly this block\'s clients' };
    }
    const parts = list.map(m => ({ clientId: String(m.clientId), minutes: Number(m.minutes) }));
    if (parts.some(m => !Number.isInteger(m.minutes) || m.minutes < 0)) return { ok: false, error: 'Minutes must be whole numbers, 0 or more' };
    const total = parts.reduce((a, m) => a + m.minutes, 0) * 60;
    if (total <= 0) return { ok: false, error: 'Enter the minutes worked for at least one client, or choose "This work did not happen"' };
    if (total > blockSecs) return { ok: false, error: `That is ${Math.round(total / 60)} minutes, longer than the ${Math.round(blockSecs / 60)}-minute block` };
    const names = new Map(clients.map(c => [String(c.clientId), c.clientName || null]));
    const clientSeconds = parts.map(m => ({ clientId: m.clientId, clientName: names.get(m.clientId), seconds: m.minutes * 60 }));
    const allocation = clientSeconds.map(c => ({ clientId: c.clientId, clientName: c.clientName, percent: round2(c.seconds * 100 / total) }));
    return { ok: true, resolution: 'PER_CLIENT', seconds: total, allocation, clientSeconds, note: null };
  }
  return { ok: false, error: 'Choose how to bill this block' };
}

/**
 * Each client's billable seconds for a block. A PER_CLIENT resolution bills
 * exactly the minutes entered; otherwise the timed total is split by the
 * allocation (splitSeconds). DID_NOT_HAPPEN bills nothing.
 */
function clientParts(row, clients, timedSeconds) {
  if (row && row.resolution === 'DID_NOT_HAPPEN') return [];
  if (row && row.resolution === 'PER_CLIENT' && Array.isArray(row.client_seconds)) {
    const ids = new Set(clients.map(c => String(c.clientId)));
    const names = new Map(clients.map(c => [String(c.clientId), c.clientName || null]));
    const saved = row.client_seconds.filter(c => c && ids.has(String(c.clientId)));
    if (saved.length === ids.size) {
      const total = saved.reduce((a, c) => a + (Number(c.seconds) || 0), 0);
      return saved.map(c => ({ clientId: String(c.clientId), clientName: names.get(String(c.clientId)),
        seconds: Number(c.seconds) || 0, percent: total ? round2((Number(c.seconds) || 0) * 100 / total) : 0 }));
    }
  }
  return splitSeconds(timedSeconds, allocationFor(row, clients));
}

/** Ended, billable, no time entered and not yet resolved: the clinician must answer. */
function needsResolution(row, clients, endTime, now = new Date()) {
  if (!clients.length) return false;
  if (new Date(endTime) > now) return false;
  if (row && row.resolution) return false;
  if (row && row.status === 'RUNNING') return false;
  return !(row && Number(row.accumulated_seconds) > 0);
}

/** The clients a block names (custom_metadata.booking.clients), or []. */
function blockClients(ev) {
  const b = ev && ev.custom_metadata && ev.custom_metadata.booking;
  if (!b || b.group !== 'nf2f') return [];
  if (Array.isArray(b.clients)) return b.clients.filter(c => c && c.clientId).map(c => ({ clientId: String(c.clientId), clientName: c.clientName || null }));
  return b.clientId ? [{ clientId: String(b.clientId), clientName: b.clientName || null }] : [];
}

function blockSeconds(ev) {
  return Math.max(60, Math.round((new Date(ev.end_time) - new Date(ev.start_time)) / 1000));
}

/* ── db helpers ─────────────────────────────────────────────────────────── */

/** Persist an auto-stop if the row has reached its limit. Returns the current row. */
async function settleRow(q, row, now = new Date()) {
  const s = settled(row, now);
  if (s === row || !s) return row;
  const { rows: [r] } = await q.query(
    `UPDATE event_billing_timers SET status = 'STOPPED', accumulated_seconds = $2, run_started_at = NULL,
            auto_stopped = TRUE, stopped_at = $3, updated_at = NOW()
      WHERE event_id = $1 AND status = 'RUNNING' RETURNING *`, [row.event_id, s.accumulated_seconds, s.stopped_at]);
  return r || s;
}

module.exports = {
  elapsedSeconds, settled, allocationFor, equalSplit, validateAllocation, splitSeconds,
  blockClients, blockSeconds, settleRow, validateResolution, clientParts, needsResolution,
};
