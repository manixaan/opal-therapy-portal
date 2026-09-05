'use strict';

/**
 * OPAL PORTAL SUPPORT — internal ticketing & feedback system.
 *
 * Every staff role can report an issue and follow their own tickets;
 * admin/owner run the support centre (triage, assignment, status workflow,
 * analytics). Backend-enforced RBAC:
 *   - therapist:  create tickets, view/comment/attach on OWN tickets,
 *                 verify fixes (ready_to_test → resolved / in_progress),
 *                 reopen own resolved/closed tickets
 *   - admin/owner: everything above on any org ticket, plus triage,
 *                 assignment, status transitions, analytics
 *   - read_only:  blocked from all writes by the global requireAuth choke
 *                 point; may view nothing here (no ticket of their own can
 *                 exist, and listing is reporter-scoped)
 *
 * Soft states only — no route deletes a ticket, comment, attachment or event.
 * Attachments are screenshots (PNG/JPEG/WEBP, 5 MB) stored via the shared
 * storage abstraction; downloads are authenticated and access-checked, never
 * public URLs. Captured technical context is length-capped and stripped of
 * credential-shaped keys server-side; the client helper only ever collects
 * route/module/version/browser/viewport — never page text.
 */

const express = require('express');
const { contentDisposition } = require('./content-disposition');
const router = express.Router();
const db = require('./database');
const { pool } = require('./database');
const { requireAuth, requireRole } = require('./permissions');
const log = require('./logger').createLogger('support');

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));
const orgOf = (req) => req.user?.organisation_id || null;
const isStaff = (u) => u?.role === 'owner' || u?.role === 'admin';

const TICKET_TYPES = ['bug', 'feature_request', 'resource_issue', 'data_issue', 'usability', 'other'];
const REPORTED_PRIORITIES = ['low', 'medium', 'high', 'critical'];
const TRIAGED_PRIORITIES = ['p1', 'p2', 'p3', 'p4'];
const OPEN_STATUSES = ['new', 'triaged', 'in_progress', 'ready_to_test'];

// ── Status workflow (single source of truth, enforced server-side) ───────────
// new → triaged → in_progress → ready_to_test → resolved → closed
// wont_fix (requires reason) from new/triaged/in_progress; duplicate (requires
// a valid duplicate_of ticket) from the same states; reopen resolved/closed →
// in_progress. wont_fix and duplicate are terminal.
const VALID_TRANSITIONS = {
  new:           ['triaged', 'in_progress', 'wont_fix', 'duplicate'],
  triaged:       ['in_progress', 'wont_fix', 'duplicate'],
  in_progress:   ['ready_to_test', 'wont_fix', 'duplicate'],
  ready_to_test: ['resolved', 'in_progress'],
  resolved:      ['closed', 'in_progress'],
  closed:        ['in_progress'],
  wont_fix:      [],
  duplicate:     [],
};

function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

// ── Ticket numbers — OPA-0001 style, allocated transactionally ───────────────
function formatTicketNumber(n) {
  return 'OPA-' + String(n).padStart(4, '0');
}

/** Atomically allocate the next ticket number (single-statement upsert). */
async function nextTicketNumber(client) {
  const { rows } = await client.query(
    `INSERT INTO support_ticket_counters (counter_key, last_number)
     VALUES ('tickets', 1)
     ON CONFLICT (counter_key)
     DO UPDATE SET last_number = support_ticket_counters.last_number + 1
     RETURNING last_number`);
  return formatTicketNumber(rows[0].last_number);
}

// ── Technical-context sanitiser (pure; unit-tested) ──────────────────────────
// Strips any key whose name contains token/cookie/secret/authorization/key
// (case-insensitive) at any depth, caps string lengths and total size, and
// never lets the stored JSON exceed ~4 KB. Arrays and objects are bounded.
const SENSITIVE_KEY_RE = /token|cookie|secret|authorization|passw|api[-_]?key|^key$/i;

function sanitizeTechnicalContext(input, depth = 0) {
  if (input === null || input === undefined) return {};
  if (depth > 4) return null;
  if (Array.isArray(input)) {
    return input.slice(0, 20).map((v) => sanitizeTechnicalContext(v, depth + 1));
  }
  if (typeof input === 'object') {
    const out = {};
    let n = 0;
    for (const [k, v] of Object.entries(input)) {
      if (n >= 30) break;
      if (SENSITIVE_KEY_RE.test(String(k))) continue;
      const key = String(k).slice(0, 60);
      if (v === null || v === undefined) continue;
      if (typeof v === 'string') out[key] = v.slice(0, 300);
      else if (typeof v === 'number' || typeof v === 'boolean') out[key] = v;
      else out[key] = sanitizeTechnicalContext(v, depth + 1);
      n += 1;
    }
    return out;
  }
  if (typeof input === 'string') return input.slice(0, 300);
  if (typeof input === 'number' || typeof input === 'boolean') return input;
  return null;
}

function boundedContext(input) {
  const clean = sanitizeTechnicalContext(input);
  const json = JSON.stringify(clean);
  return json.length > 4096 ? {} : clean;
}

// ── Rate limiting — 10 ticket creations per user per 10 minutes ──────────────
const _creations = new Map();
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const CREATE_MAX_IN_WINDOW = 10;
function createRateLimited(userId) {
  const now = Date.now();
  for (const [k, v] of _creations) { if (v.resetAt <= now) _creations.delete(k); }
  let e = _creations.get(userId);
  if (!e || e.resetAt <= now) { e = { n: 0, resetAt: now + CREATE_WINDOW_MS }; _creations.set(userId, e); }
  e.n += 1;
  return e.n > CREATE_MAX_IN_WINDOW;
}
function _resetSupportRateLimit() { _creations.clear(); }

// ── Shared wrappers ──────────────────────────────────────────────────────────

// Async-handler guard: an unhandled rejection in an Express 4 async handler
// never responds (the request hangs; jest never exits).
const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('support route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});

function audit(req, action, targetId, metadata) {
  return db.logAuditEvent({
    actorUserId: req.user?.id, action, targetType: 'support_ticket', targetId,
    ipAddress: req.ip, organisationId: orgOf(req), metadata: metadata || null,
  }).catch(() => {});
}

// Lazy import so tests can mount this module without app-routes.
// Type carries the ticket number so storeNotification's per-type 24 h dedupe
// works per-ticket-per-event instead of swallowing every later ticket.
function notify(userId, kind, ticket, { title, message, severity }) {
  return Promise.resolve()
    .then(() => require('./app-routes').storeNotification(userId, {
      type: `support_ticket_${kind}:${ticket.ticket_number}`,
      title, message, severity: severity || 'info',
      relatedEntity: 'support_ticket',
      actionPayload: { ticketId: ticket.id, ticketNumber: ticket.ticket_number },
    }))
    .catch(() => {});
}

function recordEvent(ticketId, actorUserId, event, detail) {
  return pool.query(
    'INSERT INTO support_ticket_events (ticket_id, actor_user_id, event, detail) VALUES ($1,$2,$3,$4)',
    [ticketId, actorUserId || null, event, JSON.stringify(detail || {})]);
}

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};

/** Load a ticket the caller may see; null → caller gets 404 (no enumeration). */
async function loadAccessibleTicket(req, id) {
  if (!isUuid(id)) return null;
  const { rows } = await pool.query(
    'SELECT * FROM support_tickets WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2',
    [id, orgOf(req)]);
  const t = rows[0];
  if (!t) return null;
  if (!isStaff(req.user) && t.reporter_user_id !== req.user.id) return null;
  return t;
}

async function staffUserIds(orgId) {
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE organisation_id IS NOT DISTINCT FROM $1
      AND role IN ('owner','admin') AND is_active IS NOT FALSE`, [orgId]);
  return rows.map((r) => r.id);
}

// ── Create ───────────────────────────────────────────────────────────────────

router.post('/api/support/tickets', requireAuth, safe(async (req, res) => {
  const b = req.body || {};
  const type = String(b.type || '');
  if (!TICKET_TYPES.includes(type)) {
    return res.status(400).json({ error: 'type must be one of: ' + TICKET_TYPES.join(', ') });
  }
  const title = str(b.title, 200);
  const description = str(b.description, 5000);
  if (!title) return res.status(400).json({ error: 'title is required (max 200 characters)' });
  if (!description) return res.status(400).json({ error: 'description is required' });
  const reported = REPORTED_PRIORITIES.includes(b.reportedPriority) ? b.reportedPriority : 'medium';

  if (createRateLimited(req.user.id)) {
    return res.status(429).json({ error: 'rate_limited', message: 'Too many tickets in a short time — please wait a few minutes.' });
  }

  // Server-side context capture; client-sent context is advisory and capped.
  const environment = str(process.env.NODE_ENV, 20) || 'development';
  const appVersion = str(process.env.APP_VERSION, 40) || 'dev';
  const technicalContext = boundedContext(b.technicalContext);

  const client = await pool.connect();
  let ticket;
  try {
    await client.query('BEGIN');
    const ticketNumber = await nextTicketNumber(client);
    const ins = await client.query(
      `INSERT INTO support_tickets
         (organisation_id, ticket_number, reporter_user_id, type, title, description,
          expected_behaviour, reported_priority, source_module, source_route,
          environment, app_version, browser_context, technical_context)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [orgOf(req), ticketNumber, req.user.id, type, title, description,
       str(b.expectedBehaviour, 3000), reported, str(b.module, 60), str(b.route, 200),
       environment, appVersion,
       [str(b.browser, 200), str(b.viewport, 40)].filter(Boolean).join(' · ').slice(0, 300) || null,
       JSON.stringify(technicalContext)]);
    ticket = ins.rows[0];
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await recordEvent(ticket.id, req.user.id, 'created', { type, reportedPriority: reported });
  await audit(req, 'support.ticket_created', ticket.id, { ticketNumber: ticket.ticket_number, type, reportedPriority: reported });

  if (reported === 'high' || reported === 'critical') {
    for (const uid of await staffUserIds(orgOf(req))) {
      await notify(uid, 'new', ticket, {
        title: `New ${reported} priority ticket ${ticket.ticket_number}`,
        message: `${title} — reported by ${req.user.name || req.user.email}.`,
        severity: reported === 'critical' ? 'error' : 'warning',
      });
    }
  }

  res.status(201).json({ ticket });
}));

// ── List ─────────────────────────────────────────────────────────────────────

router.get('/api/support/tickets', requireAuth, safe(async (req, res) => {
  const params = [orgOf(req)];
  let where = 't.organisation_id IS NOT DISTINCT FROM $1';

  if (!isStaff(req.user)) {
    params.push(req.user.id);
    where += ` AND t.reporter_user_id = $${params.length}`;
  } else {
    if (req.query.status && VALID_TRANSITIONS[req.query.status] !== undefined) {
      params.push(req.query.status); where += ` AND t.status = $${params.length}`;
    }
    if (req.query.type && TICKET_TYPES.includes(req.query.type)) {
      params.push(req.query.type); where += ` AND t.type = $${params.length}`;
    }
    if (req.query.priority && TRIAGED_PRIORITIES.includes(req.query.priority)) {
      params.push(req.query.priority); where += ` AND t.triaged_priority = $${params.length}`;
    }
    if (req.query.reportedPriority && REPORTED_PRIORITIES.includes(req.query.reportedPriority)) {
      params.push(req.query.reportedPriority); where += ` AND t.reported_priority = $${params.length}`;
    }
    if (isUuid(req.query.assignee)) {
      params.push(req.query.assignee); where += ` AND t.assignee_user_id = $${params.length}`;
    }
    if (isUuid(req.query.reporter)) {
      params.push(req.query.reporter); where += ` AND t.reporter_user_id = $${params.length}`;
    }
    if (req.query.q) {
      params.push('%' + String(req.query.q).slice(0, 100) + '%');
      where += ` AND (t.ticket_number ILIKE $${params.length} OR t.title ILIKE $${params.length} OR t.description ILIKE $${params.length})`;
    }
    if (req.query.createdFrom && /^\d{4}-\d{2}-\d{2}$/.test(req.query.createdFrom)) {
      params.push(req.query.createdFrom); where += ` AND t.created_at >= $${params.length}::date`;
    }
    if (req.query.createdTo && /^\d{4}-\d{2}-\d{2}$/.test(req.query.createdTo)) {
      params.push(req.query.createdTo); where += ` AND t.created_at < ($${params.length}::date + INTERVAL '1 day')`;
    }
  }

  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const { rows } = await pool.query(
    `SELECT t.id, t.ticket_number, t.type, t.title, t.reported_priority, t.triaged_priority,
            t.status, t.source_module, t.created_at, t.updated_at,
            t.reporter_user_id, t.assignee_user_id,
            ru.name AS reporter_name, au.name AS assignee_name,
            (SELECT COUNT(*) FROM support_ticket_comments c WHERE c.ticket_id = t.id) AS comment_count
       FROM support_tickets t
       LEFT JOIN users ru ON ru.id = t.reporter_user_id
       LEFT JOIN users au ON au.id = t.assignee_user_id
      WHERE ${where}
      ORDER BY t.updated_at DESC
      LIMIT 100 OFFSET ${offset}`, params);
  res.json({ tickets: rows });
}));

// Assignee options for the triage panel (admin/owner users in the org).
router.get('/api/support/staff', requireAuth, requireRole('owner', 'admin'), safe(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, email, role FROM users
      WHERE organisation_id IS NOT DISTINCT FROM $1
        AND role IN ('owner','admin') AND is_active IS NOT FALSE
      ORDER BY name NULLS LAST, email`, [orgOf(req)]);
  res.json({ staff: rows });
}));

// ── Analytics (declared before /tickets/:id so 'analytics' never matches :id) ─

router.get('/api/support/analytics', requireAuth, requireRole('owner', 'admin'), safe(async (req, res) => {
  const org = orgOf(req);
  const [core, byType, modules, triage, resolve, reopened] = await Promise.all([
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = ANY($2)) AS open_count,
              COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS new_this_week,
              COUNT(*) FILTER (WHERE triaged_priority IN ('p1','p2') AND status = ANY($2)) AS p1_p2_open
         FROM support_tickets WHERE organisation_id IS NOT DISTINCT FROM $1`,
      [org, OPEN_STATUSES]),
    pool.query(
      `SELECT type, COUNT(*)::int AS count FROM support_tickets
        WHERE organisation_id IS NOT DISTINCT FROM $1 GROUP BY type ORDER BY count DESC`, [org]),
    pool.query(
      `SELECT source_module, COUNT(*)::int AS count FROM support_tickets
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND source_module IS NOT NULL
        GROUP BY source_module ORDER BY count DESC LIMIT 5`, [org]),
    pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (e.first_triage - t.created_at)) / 3600) AS hours
         FROM support_tickets t
         JOIN (SELECT ticket_id, MIN(created_at) AS first_triage
                 FROM support_ticket_events
                WHERE event = 'status_changed' AND detail->>'to' = 'triaged'
                GROUP BY ticket_id) e ON e.ticket_id = t.id
        WHERE t.organisation_id IS NOT DISTINCT FROM $1`, [org]),
    pool.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600) AS hours
         FROM support_tickets
        WHERE organisation_id IS NOT DISTINCT FROM $1 AND resolved_at IS NOT NULL`, [org]),
    pool.query(
      `SELECT COUNT(DISTINCT e.ticket_id)::int AS count
         FROM support_ticket_events e
         JOIN support_tickets t ON t.id = e.ticket_id
        WHERE t.organisation_id IS NOT DISTINCT FROM $1
          AND e.event = 'status_changed' AND e.detail->>'to' = 'in_progress'
          AND e.detail->>'from' IN ('resolved','closed')`, [org]),
  ]);
  const c = core.rows[0];
  res.json({
    openCount: Number(c.open_count),
    newThisWeek: Number(c.new_this_week),
    p1p2OpenCount: Number(c.p1_p2_open),
    byType: byType.rows,
    topModules: modules.rows,
    avgHoursToTriage: triage.rows[0].hours === null ? null : Math.round(Number(triage.rows[0].hours) * 10) / 10,
    avgHoursToResolve: resolve.rows[0].hours === null ? null : Math.round(Number(resolve.rows[0].hours) * 10) / 10,
    reopenedCount: Number(reopened.rows[0].count),
  });
}));

// ── Detail ───────────────────────────────────────────────────────────────────

router.get('/api/support/tickets/:id', requireAuth, safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });

  const [names, comments, attachments, events, dup] = await Promise.all([
    pool.query('SELECT id, name, email FROM users WHERE id IN ($1, $2)',
      [t.reporter_user_id, t.assignee_user_id || t.reporter_user_id]),
    pool.query(
      `SELECT c.id, c.body, c.created_at, c.author_user_id, u.name AS author_name, u.role AS author_role
         FROM support_ticket_comments c LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.ticket_id = $1 ORDER BY c.created_at ASC`, [t.id]),
    pool.query(
      `SELECT id, file_name, file_mime, file_size_bytes, uploaded_by, uploaded_at
         FROM support_ticket_attachments WHERE ticket_id = $1 ORDER BY uploaded_at ASC`, [t.id]),
    pool.query(
      `SELECT e.id, e.event, e.detail, e.created_at, e.actor_user_id, u.name AS actor_name
         FROM support_ticket_events e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.ticket_id = $1 ORDER BY e.id ASC`, [t.id]),
    t.duplicate_of_id
      ? pool.query('SELECT id, ticket_number, title, status FROM support_tickets WHERE id = $1', [t.duplicate_of_id])
      : Promise.resolve({ rows: [] }),
  ]);

  const byId = {};
  for (const u of names.rows) byId[u.id] = u;
  res.json({
    ticket: {
      ...t,
      reporter_name: byId[t.reporter_user_id]?.name || null,
      assignee_name: t.assignee_user_id ? (byId[t.assignee_user_id]?.name || null) : null,
    },
    comments: comments.rows,
    attachments: attachments.rows,
    events: events.rows,
    duplicateOf: dup.rows[0] || null,
  });
}));

// ── Triage (admin/owner): priority, assignee, source module ──────────────────

router.patch('/api/support/tickets/:id', requireAuth, requireRole('owner', 'admin'), safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const changes = {};

  if ('triagedPriority' in b) {
    const p = b.triagedPriority === null ? null : String(b.triagedPriority);
    if (p !== null && !TRIAGED_PRIORITIES.includes(p)) {
      return res.status(400).json({ error: 'triagedPriority must be p1–p4 or null' });
    }
    changes.triaged_priority = p;
  }
  if ('assigneeUserId' in b) {
    if (b.assigneeUserId === null) {
      changes.assignee_user_id = null;
    } else {
      if (!isUuid(b.assigneeUserId)) return res.status(400).json({ error: 'assigneeUserId must be a user id or null' });
      const { rows } = await pool.query(
        `SELECT id, name FROM users WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2
          AND role IN ('owner','admin') AND is_active IS NOT FALSE`, [b.assigneeUserId, orgOf(req)]);
      if (!rows.length) return res.status(400).json({ error: 'Assignee must be an active admin or owner in this organisation' });
      changes.assignee_user_id = rows[0].id;
    }
  }
  if ('sourceModule' in b) changes.source_module = str(b.sourceModule, 60);

  if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });

  const sets = Object.keys(changes).map((k, i) => `${k} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE support_tickets SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [t.id, ...Object.values(changes)]);
  const updated = rows[0];

  for (const [field, value] of Object.entries(changes)) {
    await recordEvent(t.id, req.user.id, field === 'assignee_user_id' ? 'assigned' : 'triage_updated',
      { field, from: t[field], to: value });
    await audit(req, 'support.ticket_' + (field === 'assignee_user_id' ? 'assigned' : 'triaged'), t.id,
      { ticketNumber: t.ticket_number, field, from: t[field], to: value });
  }

  if (changes.assignee_user_id && changes.assignee_user_id !== t.assignee_user_id
      && changes.assignee_user_id !== req.user.id) {
    await notify(changes.assignee_user_id, 'assigned', updated, {
      title: `Ticket ${updated.ticket_number} assigned to you`,
      message: `${updated.title}`,
    });
  }

  res.json({ ticket: updated });
}));

// ── Status workflow ──────────────────────────────────────────────────────────

async function applyStatusChange(req, res, t, to, extra) {
  const from = t.status;
  if (!canTransition(from, to)) {
    return res.status(409).json({
      error: `Cannot move a ${from.replace(/_/g, ' ')} ticket to ${to.replace(/_/g, ' ')}`,
      code: 'invalid_transition', from, to,
    });
  }

  const sets = ['status = $2', 'updated_at = NOW()'];
  const params = [t.id, to];
  const push = (frag, val) => { params.push(val); sets.push(`${frag} $${params.length}`); };

  if (to === 'resolved') { sets.push('resolved_at = NOW()'); if (extra.resolution) push('resolution =', extra.resolution); }
  if (to === 'closed') sets.push('closed_at = NOW()');
  if (to === 'wont_fix') push('wont_fix_reason =', extra.wontFixReason);
  if (to === 'duplicate') push('duplicate_of_id =', extra.duplicateOfId);

  const { rows } = await pool.query(
    `UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  const updated = rows[0];

  const detail = { from, to };
  if (extra.resolution) detail.resolution = String(extra.resolution).slice(0, 300);
  if (extra.wontFixReason) detail.reason = String(extra.wontFixReason).slice(0, 300);
  if (extra.duplicateOfNumber) detail.duplicateOf = extra.duplicateOfNumber;
  if (extra.verifyOutcome) detail.verifyOutcome = extra.verifyOutcome;
  await recordEvent(t.id, req.user.id, 'status_changed', detail);
  await audit(req, 'support.ticket_status_changed', t.id, { ticketNumber: t.ticket_number, ...detail });

  // Reporter notifications (§18): progress they can act on or should know about.
  if (req.user.id !== t.reporter_user_id) {
    if (to === 'ready_to_test') {
      await notify(t.reporter_user_id, 'ready', updated, {
        title: `Ticket ${updated.ticket_number} is ready to test`,
        message: 'Please confirm whether the issue is fixed for you.',
        severity: 'success',
      });
    } else if (to === 'resolved' || to === 'closed') {
      await notify(t.reporter_user_id, to, updated, {
        title: `Ticket ${updated.ticket_number} ${to}`,
        message: updated.resolution ? String(updated.resolution).slice(0, 300) : `Your ticket "${updated.title}" has been ${to}.`,
        severity: 'success',
      });
    }
  }
  // Reopens started by the reporter alert the assignee (or all staff if unassigned).
  if ((from === 'resolved' || from === 'closed') && to === 'in_progress' && req.user.id === t.reporter_user_id) {
    const targets = updated.assignee_user_id ? [updated.assignee_user_id] : await staffUserIds(orgOf(req));
    for (const uid of targets) {
      await notify(uid, 'reopened', updated, {
        title: `Ticket ${updated.ticket_number} reopened`,
        message: `${updated.title} — the reporter says the issue is back.`,
        severity: 'warning',
      });
    }
  }

  return res.json({ ticket: updated });
}

router.post('/api/support/tickets/:id/status', requireAuth, safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const b = req.body || {};
  const to = String(b.status || '');
  if (VALID_TRANSITIONS[to] === undefined) {
    return res.status(400).json({ error: 'Unknown status' });
  }

  // Reporters may only reopen their own resolved/closed tickets here; every
  // other transition is admin/owner. (Verification has its own route.)
  const isReopen = (t.status === 'resolved' || t.status === 'closed') && to === 'in_progress';
  if (!isStaff(req.user) && !(isReopen && t.reporter_user_id === req.user.id)) {
    return res.status(403).json({ error: 'Only admins or the practice owner can change ticket status' });
  }

  const extra = {};
  if (to === 'resolved') extra.resolution = str(b.resolution, 3000);
  if (to === 'wont_fix') {
    extra.wontFixReason = str(b.reason, 3000);
    if (!extra.wontFixReason) return res.status(400).json({ error: "A reason is required for won't fix" });
  }
  if (to === 'duplicate') {
    const dupId = b.duplicateOfId;
    if (!isUuid(dupId)) return res.status(400).json({ error: 'duplicateOfId is required for duplicate' });
    if (dupId === t.id) return res.status(400).json({ error: 'A ticket cannot duplicate itself' });
    const { rows } = await pool.query(
      'SELECT id, ticket_number, status FROM support_tickets WHERE id = $1 AND organisation_id IS NOT DISTINCT FROM $2',
      [dupId, orgOf(req)]);
    if (!rows.length) return res.status(400).json({ error: 'duplicateOfId must reference a ticket in this organisation' });
    if (rows[0].status === 'duplicate') return res.status(400).json({ error: 'Cannot mark as duplicate of a ticket that is itself a duplicate' });
    extra.duplicateOfId = rows[0].id;
    extra.duplicateOfNumber = rows[0].ticket_number;
  }

  return applyStatusChange(req, res, t, to, extra);
}));

// Reporter verification when a fix is ready to test.
router.post('/api/support/tickets/:id/verify', requireAuth, safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  if (t.reporter_user_id !== req.user.id) {
    return res.status(403).json({ error: 'Only the reporter can verify a fix' });
  }
  const outcome = String(req.body?.outcome || '');
  if (!['fixed', 'still_happening'].includes(outcome)) {
    return res.status(400).json({ error: "outcome must be 'fixed' or 'still_happening'" });
  }
  if (t.status !== 'ready_to_test') {
    return res.status(409).json({ error: 'This ticket is not awaiting verification', code: 'invalid_transition' });
  }

  const comment = str(req.body?.comment, 3000);
  if (comment) {
    await pool.query(
      'INSERT INTO support_ticket_comments (ticket_id, author_user_id, body) VALUES ($1,$2,$3)',
      [t.id, req.user.id, comment]);
    await recordEvent(t.id, req.user.id, 'commented', { length: comment.length });
  }

  if (outcome === 'fixed') {
    return applyStatusChange(req, res, t, 'resolved', {
      resolution: comment || 'Verified fixed by the reporter.',
      verifyOutcome: 'fixed',
    });
  }
  // still_happening → back to in_progress; alert the assignee (or all staff).
  const resp = await applyStatusChange(req, res, t, 'in_progress', { verifyOutcome: 'still_happening' });
  const targets = t.assignee_user_id ? [t.assignee_user_id] : await staffUserIds(orgOf(req));
  for (const uid of targets) {
    if (uid === req.user.id) continue;
    await notify(uid, 'still_happening', t, {
      title: `Ticket ${t.ticket_number}: still happening`,
      message: `${t.title} — the reporter says the issue is not fixed.`,
      severity: 'warning',
    });
  }
  return resp;
}));

// ── Comments (append-only) ───────────────────────────────────────────────────

router.post('/api/support/tickets/:id/comments', requireAuth, safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const body = str(req.body?.body, 3000);
  if (!body) return res.status(400).json({ error: 'Comment text is required (max 3000 characters)' });

  const { rows } = await pool.query(
    'INSERT INTO support_ticket_comments (ticket_id, author_user_id, body) VALUES ($1,$2,$3) RETURNING *',
    [t.id, req.user.id, body]);
  await pool.query('UPDATE support_tickets SET updated_at = NOW() WHERE id = $1', [t.id]);
  await recordEvent(t.id, req.user.id, 'commented', { length: body.length });
  await audit(req, 'support.ticket_commented', t.id, { ticketNumber: t.ticket_number });

  // A staff comment on someone else's ticket alerts the reporter.
  if (isStaff(req.user) && req.user.id !== t.reporter_user_id) {
    await notify(t.reporter_user_id, 'comment', t, {
      title: `New reply on ticket ${t.ticket_number}`,
      message: body.slice(0, 200),
    });
  }
  res.status(201).json({ comment: rows[0] });
}));

// ── Attachments (screenshots: PNG/JPEG/WEBP, 5 MB, max 3 per ticket) ─────────

const ATTACHMENT_ALLOWED = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
};

function validateTicketAttachment({ fileName, fileMime, fileData }) {
  if (!fileData) return 'File content is required';
  const exts = ATTACHMENT_ALLOWED[String(fileMime || '').toLowerCase()];
  if (!exts) return 'File type not allowed. Accepted: PNG, JPEG, WEBP';
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `File extension ".${ext}" does not match the declared type`;
  if (/[/\\]|\.\./.test(String(fileName))) return 'Invalid file name';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(fileData).slice(0, 1000))) {
    return 'File content must be base64-encoded';
  }
  return null;
}

router.post('/api/support/tickets/:id/attachments', requireAuth, safe(async (req, res) => {
  const t = await loadAccessibleTicket(req, req.params.id);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const { fileName, fileMime, fileData, fileSizeBytes } = req.body || {};
  if (fileData && fileData.length > 7 * 1024 * 1024) {
    return res.status(413).json({ error: 'File exceeds 5 MB limit' });
  }
  const uploadError = validateTicketAttachment({ fileName, fileMime, fileData });
  if (uploadError) return res.status(415).json({ error: uploadError });

  const { rows: countRows } = await pool.query(
    'SELECT COUNT(*)::int AS n FROM support_ticket_attachments WHERE ticket_id = $1', [t.id]);
  if (countRows[0].n >= 3) return res.status(400).json({ error: 'A ticket can carry at most 3 attachments' });

  const { getBackend, getBackendName } = require('./storage');
  const backendName = getBackendName();
  const ins = await pool.query(
    `INSERT INTO support_ticket_attachments
       (ticket_id, file_name, file_mime, file_size_bytes, file_data, storage_backend, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [t.id, fileName, fileMime, fileSizeBytes || null,
     backendName === 'db' ? fileData : null, backendName, req.user.id]);
  const fileId = ins.rows[0].id;
  if (backendName !== 'db') {
    try {
      const put = await getBackend().put({ userId: req.user.id, docId: fileId, fileName, mime: fileMime, base64: fileData });
      await pool.query('UPDATE support_ticket_attachments SET storage_backend=$2, storage_key=$3, file_data=NULL WHERE id=$1',
        [fileId, put.backend, put.storageKey]);
    } catch (putErr) {
      await pool.query('DELETE FROM support_ticket_attachments WHERE id=$1', [fileId]);
      throw putErr;
    }
  }
  await pool.query('UPDATE support_tickets SET updated_at = NOW() WHERE id = $1', [t.id]);
  await recordEvent(t.id, req.user.id, 'attachment_added', { fileName: String(fileName).slice(0, 120) });
  await audit(req, 'support.ticket_attachment_added', t.id, { ticketNumber: t.ticket_number, fileName, mime: fileMime });
  res.status(201).json({ ok: true, attachmentId: fileId });
}));

// Private, authenticated download — ticket access is re-checked here.
router.get('/api/support/attachments/:id/download', requireAuth, safe(async (req, res) => {
  if (!isUuid(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { rows } = await pool.query(
    `SELECT a.*, t.reporter_user_id, t.organisation_id
       FROM support_ticket_attachments a JOIN support_tickets t ON t.id = a.ticket_id
      WHERE a.id = $1 AND t.organisation_id IS NOT DISTINCT FROM $2`,
    [req.params.id, orgOf(req)]);
  const f = rows[0];
  if (!f) return res.status(404).json({ error: 'Not found' });
  if (!isStaff(req.user) && f.reporter_user_id !== req.user.id) {
    return res.status(404).json({ error: 'Not found' });
  }

  const { getBackend } = require('./storage');
  let base64 = null;
  try {
    ({ base64 } = await getBackend(f.storage_backend || 'db').get({
      backend: f.storage_backend, storageKey: f.storage_key, fileData: f.file_data }));
  } catch (_) { /* missing object → 404 below */ }
  if (!base64) return res.status(404).json({ error: 'File content unavailable' });
  res.setHeader('Content-Type', f.file_mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition('attachment', f.file_name || 'attachment'));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.send(Buffer.from(base64, 'base64'));
}));

module.exports = router;
module.exports.VALID_TRANSITIONS = VALID_TRANSITIONS;
module.exports.canTransition = canTransition;
module.exports.formatTicketNumber = formatTicketNumber;
module.exports.sanitizeTechnicalContext = sanitizeTechnicalContext;
module.exports.validateTicketAttachment = validateTicketAttachment;
module.exports._resetSupportRateLimit = _resetSupportRateLimit;
