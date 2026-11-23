'use strict';

/**
 * EVENT MOVE — the one way a calendar edit (time / title / location) is saved
 * and passed on (23 Nov 2026, extracted from PATCH /api/outlook/events/:dbId so
 * the phone's move goes down exactly the same road as a portal drag).
 *
 * Order is fixed and local-first:
 *   1. the portal row is written FIRST (last_modified_by 'app'); an Outlook-
 *      linked row that will not be mirrored now is held 'pending' in the same
 *      write, so a delta sync cannot put Outlook's older times back;
 *   2. a time change on a Splose-linked (or Splose-queued) appointment is
 *      queued for the draft-and-publish sync (058) and the auto-sync nudged;
 *   3. Outlook is mirrored when write-back and the user's sync settings allow.
 *      A Graph failure keeps the local change, marks the row 'pending', logs
 *      sync_log + a notification, and is reported — never thrown.
 *
 * The caller owns the ownership check. `writeLocal: false` lets a caller that
 * has already written the row inside its own transaction run steps 2–3 only
 * (the mobile move writes a session and its linked travel blocks atomically).
 *
 * Dependencies are resolved lazily so routes.js / mobile-routes.js can both
 * require this module without a load-order cycle; tests inject them.
 */

function defaultDeps() {
  /* eslint-disable global-require */
  return {
    db: require('./database'),
    outlookApi: require('./outlook-oauth'),
    draftSync: require('./splose-draft-sync'),
    flags: require('./feature-flags'),
    syncPrefs: require('./sync-preferences'),
    getValidAccessToken: (user) => require('./routes').getValidAccessToken(user),
    notifyQueued: (userId) => require('./splose-sync-routes').notifyQueued(userId),
    storeNotification: (userId, payload) => {
      try {
        const { storeNotification } = require('./app-routes');
        if (typeof storeNotification === 'function') return storeNotification(userId, payload);
      } catch (e) { /* app-routes not loaded — skip */ }
      return Promise.resolve();
    },
  };
  /* eslint-enable global-require */
}

/**
 * Decide whether this edit can be mirrored to Outlook now.
 * @returns {Promise<{prefs:object|null, mirrorToOutlook:boolean}>}
 */
async function mirrorPlan(deps, userId, outlookId) {
  const prefs = await deps.syncPrefs.effectiveOrNull(deps.db, userId);
  const mirrorToOutlook = !!outlookId && deps.flags.isOutlookWriteEnabled()
    && deps.syncPrefs.allowsLinked(prefs, 'portal_to_outlook');
  return { prefs, mirrorToOutlook };
}

/** The sync_status the local write should carry (undefined = leave as is). */
function localSyncStatus(outlookId, mirrorToOutlook) {
  return (outlookId && !mirrorToOutlook) ? 'pending' : undefined;
}

/**
 * Step 2 — queue the time change for Splose. Non-fatal by design.
 * @returns {Promise<'queued'|'not_linked'|'off'>}
 */
async function queueSplose(deps, { dbId, actorId, prefs, title }) {
  if (!deps.flags.isSploseDraftSyncEnabled()
      || !deps.syncPrefs.allowsLinked(prefs, 'portal_to_splose', { manual: true })) return 'off';
  try {
    const link = await deps.db.pool.query(
      `SELECT e.splose_id, e.start_time, e.end_time, e.user_id,
              (SELECT COUNT(*) FROM splose_sync_queue q WHERE q.event_id = e.id AND q.status IN ('pending','failed')) AS live
         FROM events e WHERE e.id = $1`, [dbId]);
    const l = link.rows[0];
    if (!l || !(l.splose_id || Number(l.live) > 0)) return 'not_linked';
    const qrow = await deps.draftSync.enqueueChange(deps.db, {
      userId: l.user_id, createdBy: actorId, eventId: dbId, action: 'update',
      payload: { start: new Date(l.start_time).toISOString(), end: new Date(l.end_time).toISOString(), summary: title || undefined },
    });
    if (qrow) deps.notifyQueued(l.user_id);
    return qrow ? 'queued' : 'not_linked';
  } catch (qErr) {
    console.warn('⚠️  Splose draft queue (update) failed (non-fatal):', qErr.message);
    return 'not_linked';
  }
}

/**
 * Step 3 — mirror to Outlook. Returns the result fields the portal route has
 * always answered with: { savedToOutlook, outlookStatus?, syncError? }.
 */
async function mirrorOutlook(deps, { userId, dbId, outlookId, fields }) {
  try {
    const user = await deps.db.getUser(userId);
    const accessToken = await deps.getValidAccessToken(user);
    await deps.outlookApi.updateOutlookEvent(accessToken, outlookId, fields);
  } catch (outlookErr) {
    console.error('Outlook update failed (local change kept):', outlookErr.response?.data || outlookErr.message);
    await deps.db.updateEvent(dbId, { syncStatus: 'pending' }).catch(() => {});
    await deps.db.pool.query(
      `INSERT INTO sync_log (event_id, action, source, target, status, error_message) VALUES ($1, 'updated', 'app', 'outlook', 'failed', $2)`,
      [dbId, outlookErr.message]
    ).catch(() => {});
    if (userId) {
      deps.storeNotification(userId, {
        type: 'outlook_writeback_failed',
        title: 'Outlook event update failed',
        message: `Could not sync appointment changes to Outlook: ${outlookErr.message}. Your local changes are saved and will be reconciled.`,
        severity: 'error',
        relatedEntity: 'integration',
        actionPayload: { action: 'reconnect_outlook' },
      }).catch(() => {});
    }
    return { savedToOutlook: false, outlookStatus: 'failed', syncError: outlookErr.message };
  }
  await deps.db.updateEvent(dbId, { syncStatus: 'synced' }).catch(() => {});
  await deps.db.pool.query(
    `INSERT INTO sync_log (event_id, action, source, target, status) VALUES ($1, 'updated', 'app', 'outlook', 'success')`,
    [dbId]
  ).catch(() => {});
  console.log(`✏️ Outlook event updated: ${outlookId}`);
  return { savedToOutlook: true, outlookStatus: 'saved' };
}

/**
 * Save an edit and pass it on.
 * @param {object} p
 * @param {string} p.userId    the event's owner (whose Outlook / sync settings apply)
 * @param {string} [p.actorId] who made the change (queue created_by); defaults to userId
 * @param {string} p.dbId
 * @param {string|null} p.outlookId  events.outlook_id, already read by the caller
 * @param {object} p.fields    { title?, startTime?, endTime?, location? }
 * @param {boolean} [p.writeLocal=true]
 * @param {object} [deps]
 * @returns {Promise<{ok:true, outlookId, savedToDb:true, savedToOutlook:boolean,
 *   outlookStatus?:string, syncError?:string, splose:'queued'|'not_linked'|'off'}>}
 */
async function moveEvent(p, deps = defaultDeps()) {
  const { userId, dbId, outlookId = null, fields = {}, writeLocal = true } = p;
  const actorId = p.actorId || userId;
  const { title, startTime, endTime, location } = fields;
  const { prefs, mirrorToOutlook } = await mirrorPlan(deps, userId, outlookId);

  if (writeLocal) {
    await deps.db.updateEvent(dbId, {
      title, startTime, endTime, location, lastModifiedBy: 'app',
      syncStatus: localSyncStatus(outlookId, mirrorToOutlook),
    });
  }

  const splose = (startTime || endTime)
    ? await queueSplose(deps, { dbId, actorId, prefs, title })
    : 'off';

  if (!mirrorToOutlook) {
    return { ok: true, outlookId: outlookId || null, savedToDb: true, savedToOutlook: false,
      outlookStatus: outlookId ? 'disabled' : 'not_linked', splose };
  }
  const mirrored = await mirrorOutlook(deps, { userId, dbId, outlookId, fields: { title, startTime, endTime, location } });
  return { ok: true, outlookId, savedToDb: true, ...mirrored, splose };
}

module.exports = { moveEvent, mirrorPlan, localSyncStatus, queueSplose, mirrorOutlook, defaultDeps };
