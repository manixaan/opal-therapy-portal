'use strict';

/**
 * INTERACTIVE INDUCTION — per-user tutorial progress.
 *
 * The module catalogue (keys, versions, step counts, role gates) now lives
 * in the database (migration 045) behind backend/walkthrough-catalogue.js,
 * so the Owner can author walkthroughs without a deploy. The shipped
 * registry (frontend/current/induction-modules.js) is its seed and its
 * fallback. Per-user state stays in tutorial_progress (migration 032).
 *
 * The client no longer needs its own copy of the registry: the catalogue
 * endpoint returns the role-filtered steps the caller may actually see, so
 * client and server cannot disagree about what exists or what it contains.
 *
 * STRICTLY user-scoped: every read and write filters WHERE user_id =
 * req.user.id. The single exception is GET /api/tutorials/overview —
 * owner/admin induction-completion visibility, which returns counts and
 * module states per staff member, never step-level behaviour detail.
 *
 * Role gating: a user may only hold progress on modules their role can
 * take (a therapist cannot write progress against the owner-only
 * "Inviting Therapists" module — 404, indistinguishable from "does not
 * exist"). read_only: GETs allowed; writes are already blocked by the
 * choke point in permissions.requireAuth, so read_only accounts keep
 * their place client-side only.
 *
 * Completing a module also marks the matching Resource Hub tutorial
 * resource complete (same slug, user_learning_progress) so learning-path
 * percentages agree with the induction dashboard.
 *
 * Audit: completion/restart only, ids-only metadata. No external calls.
 */

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const log = require('./logger').createLogger('tutorials');

const { requireAuth, requireRole } = require('./permissions');
const catalogue = require('./walkthrough-catalogue');

const orgOf = (req) => req.user?.organisation_id || null;

router.use('/api/tutorials', requireAuth);

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('tutorial route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

/**
 * Resolve a module the CALLER may take, or null (→ 404). Unknown keys and
 * role-blocked modules answer identically.
 */
async function moduleFor(req, key) {
  const mod = await catalogue.moduleByKey(orgOf(req), String(key || ''));
  if (!mod) return null;
  if (!(mod.roles || []).includes(String(req.user.role || ''))) return null;
  return mod;
}

async function audit(req, action, tutorialKey, metadata) {
  await db.logAuditEvent({
    action,
    targetType: 'tutorial_progress',
    targetId: null,
    actorUserId: req.user?.id,
    organisationId: orgOf(req),
    ipAddress: req.ip,
    metadata: Object.assign({ tutorialKey }, metadata || {}),
  }).catch(() => {});
}

function serialiseRow(r) {
  return {
    tutorial_key: r.tutorial_key,
    version: r.version,
    status: r.status,
    current_step: r.current_step,
    furthest_step: r.furthest_step,
    step_count: r.step_count,
    started_at: r.started_at,
    last_viewed_at: r.last_viewed_at,
    completed_at: r.completed_at,
    completed_version: r.completed_version,
    restart_count: r.restart_count,
    evidence: r.evidence || {},
  };
}

// ── Catalogue ────────────────────────────────────────────────────────────────

/**
 * The modules the CALLER's role can take, WITH the steps that role sees.
 * The steps are the authored catalogue the player renders — role-narrowed
 * here, so a therapist's payload never carries an owner-gated step even
 * though the module admits them both.
 */
router.get('/api/tutorials/catalogue', safe(async (req, res) => {
  const mine = await catalogue.modulesForRole(orgOf(req), req.user.role);
  const mods = mine.map((m) => {
    // Role-narrowed, then stripped of anything a learner must not hold — a
    // checkpoint's answer above all.
    const steps = catalogue.learnerSteps(catalogue.stepsForRole(m.steps, req.user.role));
    return {
      key: m.key,
      version: m.version,
      title: m.title,
      minutes: m.minutes,
      description: m.description,
      group: m.group_key,
      roles: m.roles,
      thumb: m.thumb,
      start: m.start_context,
      stepCount: steps.length,
      steps,
    };
  });
  res.json({ modules: mods });
}));

/**
 * Seed the shipped built-ins into this organisation's catalogue so they
 * become editable. Owner only, idempotent, and it never overwrites a module
 * that already exists — an Owner's edits to a built-in survive re-seeding.
 */
router.post('/api/tutorials/seed', requireRole('owner'), safe(async (req, res) => {
  const { created, skipped } = await catalogue.seedBuiltIns(orgOf(req), req.user.id);
  if (created.length) await audit(req, 'walkthroughs.seeded', null, { created, count: created.length });
  res.json({ created, skipped });
}));

// ── Own progress ─────────────────────────────────────────────────────────────

router.get('/api/tutorials/progress', safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM tutorial_progress WHERE user_id = $1 ORDER BY last_viewed_at DESC`,
    [req.user.id]);
  // Rows for modules the role can no longer take (role changed, module
  // retired) are filtered out rather than surfaced.
  const mine = await catalogue.modulesForRole(orgOf(req), req.user.role);
  const allowed = new Set(mine.map((m) => m.key));
  const visible = rows.filter((r) => allowed.has(r.tutorial_key));
  res.json({ progress: visible.map(serialiseRow) });
}));

router.put('/api/tutorials/:key/progress', safe(async (req, res) => {
  const mod = await moduleFor(req, req.params.key);
  if (!mod) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  // typeof checks first: Number(null) is 0, so coercion alone would accept
  // a null step as "step 0" instead of refusing it.
  const version = typeof b.version === 'number' ? b.version : NaN;
  const step = typeof b.step === 'number' ? b.step : NaN;
  const stepCount = b.stepCount === undefined || b.stepCount === null
    ? null : (typeof b.stepCount === 'number' ? b.stepCount : NaN);

  if (!Number.isInteger(version) || version < 1 || version > mod.version) {
    return res.status(400).json({ error: 'version must be a known version of this tutorial' });
  }
  if (!Number.isInteger(step) || step < 0 || step > 500) {
    return res.status(400).json({ error: 'step must be a non-negative integer' });
  }
  if (stepCount !== null && (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 500)) {
    return res.status(400).json({ error: 'stepCount must be a positive integer' });
  }
  if (stepCount !== null && step >= stepCount + 1) {
    return res.status(400).json({ error: 'step is beyond the end of this tutorial' });
  }

  const { rows } = await pool.query(
    `INSERT INTO tutorial_progress
       (organisation_id, user_id, tutorial_key, version, status, current_step,
        furthest_step, step_count, started_at, last_viewed_at)
     VALUES ($1, $2, $3, $4, 'in_progress', $5, $5, $6, NOW(), NOW())
     ON CONFLICT (user_id, tutorial_key) DO UPDATE SET
       version        = EXCLUDED.version,
       status         = 'in_progress',
       current_step   = EXCLUDED.current_step,
       -- A version change resets the high-water mark: old step numbers do
       -- not mean the same thing in a new definition.
       furthest_step  = CASE WHEN tutorial_progress.version = EXCLUDED.version
                             THEN GREATEST(tutorial_progress.furthest_step, EXCLUDED.current_step)
                             ELSE EXCLUDED.current_step END,
       step_count     = COALESCE(EXCLUDED.step_count, tutorial_progress.step_count),
       last_viewed_at = NOW()
     RETURNING *`,
    [orgOf(req), req.user.id, mod.key, version, step, stepCount]);

  res.json({ progress: serialiseRow(rows[0]) });
}));

router.post('/api/tutorials/:key/complete', safe(async (req, res) => {
  const mod = await moduleFor(req, req.params.key);
  if (!mod) return res.status(404).json({ error: 'Not found' });

  const rawVersion = (req.body || {}).version;
  const version = typeof rawVersion === 'number' ? rawVersion : NaN;
  if (!Number.isInteger(version) || version < 1 || version > mod.version) {
    return res.status(400).json({ error: 'version must be a known version of this tutorial' });
  }

  // A blocking step is an obligation, not a screen: a module carrying
  // checkpoints or signatures is not complete until this user has evidence
  // for every one of them. The player already refuses to page past them, but
  // the player is not the gate — completion is claimed by a POST, and a POST
  // can be made without ever opening the walkthrough.
  const blocking = catalogue.stepsForRole(mod.steps, req.user.role)
    .filter((s) => s.blocking && s.key);
  if (blocking.length) {
    const { rows: prior } = await pool.query(
      `SELECT evidence FROM tutorial_progress WHERE user_id = $1 AND tutorial_key = $2`,
      [req.user.id, mod.key]);
    const evidence = (prior[0] && prior[0].evidence) || {};
    const outstanding = blocking.filter((s) => {
      const rec = evidence[s.key];
      if (!rec) return true;
      return s.type === 'checkpoint' ? rec.passed !== true : rec.type !== 'acknowledgement';
    });
    if (outstanding.length) {
      return res.status(409).json({
        error: 'This walkthrough has checkpoints that are not finished yet',
        outstanding: outstanding.length,
      });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO tutorial_progress
       (organisation_id, user_id, tutorial_key, version, status, current_step,
        furthest_step, started_at, last_viewed_at, completed_at, completed_version)
     VALUES ($1, $2, $3, $4, 'completed', 0, 0, NOW(), NOW(), NOW(), $4)
     ON CONFLICT (user_id, tutorial_key) DO UPDATE SET
       status            = 'completed',
       version           = EXCLUDED.version,
       completed_at      = NOW(),
       completed_version = EXCLUDED.completed_version,
       last_viewed_at    = NOW()
     RETURNING *`,
    [orgOf(req), req.user.id, mod.key, version]);

  // Keep the Resource Hub's learning paths in agreement: the tutorial
  // resource with the same slug becomes "completed" for this user too.
  // Best-effort — a hub without the resource (or the hub disabled) must
  // never fail the induction completion.
  try {
    const r = await pool.query(
      `SELECT id FROM resources
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND slug = $2`,
      [orgOf(req), mod.key]);
    if (r.rows[0]) {
      await pool.query(
        `INSERT INTO user_learning_progress (user_id, resource_id, completed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, resource_id) DO UPDATE SET completed_at = NOW()`,
        [req.user.id, r.rows[0].id]);
    }
  } catch (e) {
    log.warn('resource completion bridge failed', { error: e, key: mod.key });
  }

  await audit(req, 'tutorial.completed', mod.key, { version });
  res.json({ progress: serialiseRow(rows[0]) });
}));

router.post('/api/tutorials/:key/restart', safe(async (req, res) => {
  const mod = await moduleFor(req, req.params.key);
  if (!mod) return res.status(404).json({ error: 'Not found' });

  const { rows } = await pool.query(
    `UPDATE tutorial_progress SET
       status        = 'in_progress',
       version       = $3,
       current_step  = 0,
       furthest_step = 0,
       restart_count = restart_count + 1,
       last_viewed_at = NOW()
       -- completed_at / completed_version are kept: historical record that
       -- the module WAS completed survives a restart.
     WHERE user_id = $1 AND tutorial_key = $2
     RETURNING *`,
    [req.user.id, mod.key, mod.version]);

  if (!rows[0]) return res.status(404).json({ error: 'Not found' });
  await audit(req, 'tutorial.restarted', mod.key, {});
  res.json({ progress: serialiseRow(rows[0]) });
}));

// ── Evidence: checkpoints and signatures ────────────────────────────────────

/**
 * Record what a learner DID inside a walkthrough (migration 046).
 *
 * Two kinds, both graded or witnessed HERE rather than in the browser:
 *
 *   checkpoint      — the client sends the option it chose; the server checks
 *                     it against the published step and answers with the
 *                     verdict and the explanation. The answer never leaves
 *                     the server, so the gate cannot be walked around by
 *                     reading the payload.
 *   acknowledgement — the client says it was agreed; the server records the
 *                     statement it actually published, with a hash, so what
 *                     was signed is answerable later. It never trusts the
 *                     client's copy of the wording.
 *
 * Only successes are stored: a wrong attempt increments a counter and nothing
 * else. This is a record that an obligation was met, not surveillance of how
 * a member of staff got there.
 *
 * A preview run sends nothing; read_only accounts are blocked from writing by
 * the choke point in requireAuth, exactly as their progress writes are.
 */
router.post('/api/tutorials/:key/evidence', safe(async (req, res) => {
  const mod = await moduleFor(req, req.params.key);
  if (!mod) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const stepKey = String(b.stepKey || '');
  const steps = catalogue.stepsForRole(mod.steps, req.user.role);
  const step = steps.find((s) => s.key === stepKey);
  // A step the caller's role cannot see is indistinguishable from one that
  // does not exist — the same rule the module gate follows.
  if (!step) return res.status(400).json({ error: 'That step is not part of this walkthrough' });

  let record;
  let response;

  if (step.type === 'checkpoint') {
    const chosen = typeof b.chosen === 'number' ? b.chosen : NaN;
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= (step.quiz.options || []).length) {
      return res.status(400).json({ error: 'chosen must be one of the answers offered' });
    }
    const passed = chosen === step.quiz.correctIndex;
    response = { passed, explain: step.quiz.explain || '' };
    if (!passed) {
      // Count the attempt, record nothing about it.
      await pool.query(
        `UPDATE tutorial_progress
            SET evidence = jsonb_set(evidence, ARRAY[$3::text],
                  COALESCE(evidence -> $3, '{}'::jsonb) ||
                  jsonb_build_object('type', 'checkpoint', 'attempts',
                    COALESCE((evidence -> $3 ->> 'attempts')::int, 0) + 1), true)
          WHERE user_id = $1 AND tutorial_key = $2`,
        [req.user.id, mod.key, stepKey]).catch(() => {});
      return res.json(response);
    }
    record = { type: 'checkpoint', passed: true, at: new Date().toISOString() };
  } else if (step.type === 'acknowledgement') {
    if (b.agreed !== true) {
      return res.status(400).json({ error: 'An acknowledgement has to be agreed to' });
    }
    // The statement recorded is the PUBLISHED one, never the client's copy.
    record = {
      type: 'acknowledgement',
      statement: step.ack_statement,
      hash: crypto.createHash('sha256').update(String(step.ack_statement)).digest('hex'),
      at: new Date().toISOString(),
    };
    response = { recorded: true };
  } else {
    return res.status(400).json({ error: 'That step does not record anything' });
  }

  const { rows } = await pool.query(
    `INSERT INTO tutorial_progress
       (organisation_id, user_id, tutorial_key, version, status, current_step,
        furthest_step, started_at, last_viewed_at, evidence)
     VALUES ($1, $2, $3, $4, 'in_progress', 0, 0, NOW(), NOW(),
             jsonb_build_object($5::text, $6::jsonb))
     ON CONFLICT (user_id, tutorial_key) DO UPDATE SET
       evidence = COALESCE(tutorial_progress.evidence, '{}'::jsonb) ||
                  jsonb_build_object($5::text, COALESCE(tutorial_progress.evidence -> $5, '{}'::jsonb) || $6::jsonb),
       last_viewed_at = NOW()
     RETURNING *`,
    [orgOf(req), req.user.id, mod.key, Number(mod.version) || 1,
     stepKey, JSON.stringify(record)]);

  await audit(req, 'tutorial.evidence_recorded', mod.key, {
    stepKey, kind: record.type,
  });
  res.json(Object.assign({ progress: serialiseRow(rows[0]) }, response));
}));

// ── Owner/admin completion overview ─────────────────────────────────────────

/**
 * Induction management view: per active staff member, how many of THEIR
 * role's modules are complete. Deliberately coarse — module states only,
 * no timestamps of individual behaviour beyond last activity.
 */
router.get('/api/tutorials/overview', safe(async (req, res) => {
  if (!['owner', 'admin'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied' });
  }
  const org = orgOf(req);
  const { rows: users } = await pool.query(
    `SELECT id, name, role FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1 AND is_active = TRUE
      ORDER BY name ASC`, [org]);
  const { rows: prog } = await pool.query(
    `SELECT user_id, tutorial_key, version, status, completed_version, last_viewed_at
       FROM tutorial_progress
      WHERE organisation_id IS NOT DISTINCT FROM $1`, [org]);

  const byUser = new Map();
  prog.forEach((r) => {
    if (!byUser.has(String(r.user_id))) byUser.set(String(r.user_id), {});
    byUser.get(String(r.user_id))[r.tutorial_key] = r;
  });

  const all = await catalogue.catalogueFor(org);
  const staff = users.map((u) => {
    const mods = all.filter((m) => (m.roles || []).indexOf(String(u.role || '')) !== -1);
    const mine = byUser.get(String(u.id)) || {};
    let completed = 0, inProgress = 0, lastActivity = null;
    mods.forEach((m) => {
      const st = catalogue.moduleState(m, mine[m.key]);
      if (st === 'completed' || st === 'updated') completed++;
      else if (st === 'in_progress') inProgress++;
    });
    Object.values(mine).forEach((r) => {
      const t = r.last_viewed_at && new Date(r.last_viewed_at).getTime();
      if (t && (!lastActivity || t > lastActivity)) lastActivity = t;
    });
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      total: mods.length,
      completed,
      inProgress,
      lastActivityAt: lastActivity ? new Date(lastActivity).toISOString() : null,
    };
  });

  res.json({ staff });
}));

module.exports = router;
