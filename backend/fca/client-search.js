'use strict';

/**
 * CLIENT SEARCH for generated documents — shared by the FCA report and the
 * progress note letter, so both see exactly the same clients under exactly the
 * same rules.
 *
 * Splose is queried live. The only thing this database contributes is whether
 * THIS ORGANISATION already holds a client report profile for a given client
 * (and the preferred name on it) — another organisation's profile for the same
 * Splose client is invisible here.
 *
 * When Splose is unavailable the caller is told so. A client list is never
 * fabricated, never served stale from a cache, and never silently empty.
 */

const { pool } = require('../database');
const splose = require('../splose-api');

/**
 * @param {string} organisationId  the caller's organisation
 * @param {string} q              free-text filter over full name and NDIS number
 * @returns {Promise<Array>} contract-shaped client rows
 * @throws {Error} with .sploseFailure = true when Splose cannot be reached
 */
async function searchClients(organisationId, q) {
  const needle = String(q || '').trim().toLowerCase();

  let patients;
  try {
    patients = await splose.getPatients();
  } catch (err) {
    const wrapped = new Error('splose_unavailable');
    wrapped.sploseFailure = true;
    wrapped.cause = err.message;
    throw wrapped;
  }

  const filtered = needle
    ? patients.filter((p) => (
      String(p.fullName || '').toLowerCase().includes(needle)
      || String(p.ndisNumber || '').toLowerCase().includes(needle)
    ))
    : patients;

  const capped = filtered.slice(0, 200);

  const ids = capped.map((p) => String(p.id));
  const withProfile = new Set();
  const preferredById = new Map();
  if (ids.length) {
    const { rows } = await pool.query(
      `SELECT splose_client_id, preferred_name FROM fca_client_profiles
        WHERE organisation_id = $1 AND splose_client_id = ANY($2::text[])`,
      [organisationId, ids]
    );
    for (const r of rows) {
      withProfile.add(r.splose_client_id);
      preferredById.set(r.splose_client_id, r.preferred_name);
    }
  }

  return capped.map((p) => ({
    id: String(p.id),
    fullName: p.fullName || null,
    preferredName: preferredById.get(String(p.id)) || null,
    ndisNumber: p.ndisNumber || null,
    email: p.email || null,
    phone: p.mobilePhone || null,
    address: p.formattedAddress || null,
    hasProfile: withProfile.has(String(p.id)),
  }));
}

module.exports = { searchClients };
