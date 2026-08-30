'use strict';

/**
 * WALKTHROUGH CATALOGUE — the published interactive-induction catalogue,
 * read from the database (migration 045) with the shipped registry as the
 * seed and the fallback.
 *
 * backend/tutorial-routes.js used to require()
 * frontend/current/induction-modules.js directly, which made the catalogue
 * uneditable without a deploy. It now asks this module instead. Three rules
 * govern what comes back:
 *
 *  1. **Published versions only.** A learner is never validated against a
 *     draft. Rows with current_version = 0 (an Owner's unpublished work in
 *     progress) are invisible here; the authoring surface reads drafts
 *     directly and is not this module's job.
 *
 *  2. **The shipped registry is the fallback**, used when an organisation has
 *     no seeded rows yet — or when the table is absent because migration 045
 *     has not run in that environment. This is deliberately fail-OPEN on
 *     *existence* and unchanged on *access*: the fallback modules carry their
 *     own `roles` arrays, and tutorial-routes applies the role gate to
 *     whatever this returns, so a fallback can never widen what a role may
 *     take. Failing closed here would instead delete every staff member's
 *     induction the moment a query hiccuped.
 *
 *  3. **Role gating is the caller's.** This module returns the catalogue;
 *     tutorial-routes decides who may see a module and answers 404 —
 *     indistinguishable from "does not exist" — when they may not.
 *
 * Cached per organisation for CACHE_TTL_MS. Authoring writes must call
 * invalidate(orgId); the TTL is the backstop, not the mechanism.
 */

const { pool } = require('./database');
const log = require('./logger').createLogger('walkthroughs');
const content = require('./walkthrough-content');

/** The shipped default catalogue. Loaded defensively: a broken registry must
 *  degrade to "no built-ins", never take the server down at require time. */
let registry = { MODULES: [] };
try {
  registry = require('../frontend/current/induction-modules.js');
} catch (e) {
  log.warn('shipped induction registry unavailable', { error: e });
}

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map(); // orgKey -> { at, modules }

const orgKey = (orgId) => String(orgId || '__none__');

function invalidate(orgId) {
  if (orgId === undefined) cache.clear();
  else cache.delete(orgKey(orgId));
}

/** The shipped built-ins, normalised into catalogue shape. */
function builtInCatalogue() {
  const out = [];
  for (const m of registry.MODULES || []) {
    const mapped = content.fromRegistryModule(m);
    if (!mapped.ok) {
      log.warn('shipped walkthrough failed validation and was skipped', { reason: mapped.error });
      continue;
    }
    out.push(Object.assign({ source: 'builtin', id: null }, mapped.module));
  }
  return out;
}

function rowToModule(r) {
  return {
    id: r.module_id,
    key: r.key,
    version: r.version,
    title: r.title,
    description: r.description || '',
    group_key: r.group_key || 'portal',
    minutes: r.minutes || 5,
    roles: Array.isArray(r.roles) ? r.roles : [],
    thumb: r.thumb || '',
    start_context: r.start_context || {},
    steps: Array.isArray(r.steps) ? r.steps : [],
    source: r.source,
  };
}

/**
 * Every published module for an organisation, in seeded/authored order.
 * Falls back to the shipped built-ins per rule 2 above.
 */
async function catalogueFor(orgId) {
  const k = orgKey(orgId);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.modules;

  let modules;
  try {
    const { rows } = await pool.query(
      `SELECT m.id AS module_id, m.key, m.source, m.created_at,
              v.version, v.title, v.description, v.minutes, v.roles,
              v.thumb, v.start_context, v.steps,
              m.group_key
         FROM walkthrough_modules m
         JOIN walkthrough_module_versions v
           ON v.module_id = m.id AND v.version = m.current_version
        WHERE m.organisation_id IS NOT DISTINCT FROM $1
          AND m.status = 'active'
          AND m.current_version >= 1
        ORDER BY m.created_at ASC, m.key ASC`,
      [orgId || null]);
    modules = rows.map(rowToModule);
  } catch (e) {
    log.warn('walkthrough catalogue query failed — serving the shipped built-ins', { error: e });
    modules = [];
  }

  if (!modules.length) modules = builtInCatalogue();

  cache.set(k, { at: Date.now(), modules });
  return modules;
}

async function moduleByKey(orgId, key) {
  const wanted = String(key || '');
  if (!wanted) return null;
  const mods = await catalogueFor(orgId);
  return mods.find((m) => m.key === wanted) || null;
}

/** Modules a role may take, in induction order. Unknown role → none. */
async function modulesForRole(orgId, role) {
  const r = String(role || '');
  const mods = await catalogueFor(orgId);
  return mods.filter((m) => (m.roles || []).indexOf(r) !== -1);
}

/**
 * Seed the shipped built-ins for an organisation. Idempotent by key: a module
 * that already exists is left alone, so re-running never overwrites an Owner's
 * edits to a built-in (they are editable in place — see migration 045).
 *
 * Returns { created: [...keys], skipped: [...keys] }.
 */
async function seedBuiltIns(orgId, createdBy) {
  const built = builtInCatalogue();
  const created = [];
  const skipped = [];
  const client = await pool.connect();
  try {
    for (const m of built) {
      await client.query('BEGIN');
      try {
        const ins = await client.query(
          `INSERT INTO walkthrough_modules
             (organisation_id, key, title, description, group_key, minutes, roles,
              thumb, start_context, draft_steps, current_version, source, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, 'builtin', $12)
           ON CONFLICT (COALESCE(organisation_id, '00000000-0000-0000-0000-000000000000'::uuid), key)
             DO NOTHING
           RETURNING id`,
          [orgId || null, m.key, m.title, m.description, m.group_key, m.minutes,
           JSON.stringify(m.roles), m.thumb || null, JSON.stringify(m.start_context),
           JSON.stringify(m.steps), m.version, createdBy || null]);

        if (!ins.rows[0]) {
          await client.query('ROLLBACK');
          skipped.push(m.key);
          continue;
        }
        await client.query(
          `INSERT INTO walkthrough_module_versions
             (module_id, version, title, description, minutes, roles, thumb,
              start_context, steps, published_by)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9::jsonb, $10)
           ON CONFLICT (module_id, version) DO NOTHING`,
          [ins.rows[0].id, m.version, m.title, m.description, m.minutes,
           JSON.stringify(m.roles), m.thumb || null, JSON.stringify(m.start_context),
           JSON.stringify(m.steps), createdBy || null]);
        await client.query('COMMIT');
        created.push(m.key);
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    client.release();
  }
  invalidate(orgId);
  return { created, skipped };
}

module.exports = {
  catalogueFor,
  moduleByKey,
  modulesForRole,
  seedBuiltIns,
  invalidate,
  builtInCatalogue,
  stepsForRole: content.stepsForRole,
  learnerSteps: content.learnerSteps,
  moduleState: content.moduleState,
  CACHE_TTL_MS,
};
