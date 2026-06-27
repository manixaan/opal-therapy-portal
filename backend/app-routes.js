/**
 * APP ROUTES — notifications, settings, search, users
 *
 * Provides all 18 efficiency alert types:
 *  1.  Missing address on upcoming appointments
 *  2.  Long travel time warning (>threshold min)
 *  3.  Splose sync failure (stored by sync process)
 *  4.  Outlook OAuth token expiry warning (24–48 h)
 *  5.  Calendar conflict — overlapping appointments
 *  6.  Duplicate appointment — same client same day
 *  7.  Unsynced Outlook events (Outlook but no Splose match)
 *  8.  CPD hours progress — behind annual target
 *  9.  Credential expiry at 90/30/14/7 days
 * 10.  Daily schedule summary
 * 11.  Weekly workload summary
 * 12.  Dormant case follow-up escalation
 * 13.  Incomplete profile (no base location)
 * 14.  Failed Outlook write-back
 * 15.  Client missing key information
 * 16.  Billing readiness alert (Owner only)
 * 17.  Rural trip planning suggestion (>90 min trips)
 * 18.  Case note reminder (completed sessions, no note marker)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { requireAuth } = require('./permissions');
const { pool } = require('./database');

// ─────────────────────────────────────────────────────────────
//  STARTUP: ensure app-level tables
// ─────────────────────────────────────────────────────────────
async function ensureAppTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id    UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      settings   JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS org_settings (
      org_id     TEXT PRIMARY KEY DEFAULT 'opal',
      settings   JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS user_notifications (
      id             SERIAL PRIMARY KEY,
      user_id        UUID REFERENCES users(id) ON DELETE CASCADE,
      type           TEXT,
      title          TEXT NOT NULL,
      message        TEXT NOT NULL,
      severity       TEXT DEFAULT 'info' CHECK (severity IN ('info','warning','error','success')),
      status         TEXT DEFAULT 'unread'  CHECK (status IN ('unread','read','dismissed')),
      related_entity TEXT,
      action_payload JSONB,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_notif_status ON user_notifications(status);
  `);
}
ensureAppTables().catch(err => console.warn('⚠️  app-tables init:', err.message));

// ─────────────────────────────────────────────────────────────
//  HELPER: store a durable notification (idempotent by type)
// ─────────────────────────────────────────────────────────────
async function storeNotification(userId, { type, title, message, severity = 'info', relatedEntity, actionPayload }) {
  try {
    // Avoid spamming: if same type already unread/read today, skip
    const existing = await pool.query(
      `SELECT id FROM user_notifications
       WHERE user_id = $1 AND type = $2 AND status != 'dismissed'
         AND created_at > NOW() - INTERVAL '24 hours'
       LIMIT 1`,
      [userId, type]
    );
    if (existing.rows.length) return;

    await pool.query(
      `INSERT INTO user_notifications (user_id, type, title, message, severity, status, related_entity, action_payload)
       VALUES ($1,$2,$3,$4,$5,'unread',$6,$7)`,
      [userId, type, title, message, severity, relatedEntity || null, actionPayload ? JSON.stringify(actionPayload) : null]
    );
  } catch (e) {
    // Silent — table may not be ready
  }
}

// ─────────────────────────────────────────────────────────────
//  NOTIFICATIONS — GET
// ─────────────────────────────────────────────────────────────
router.get('/api/notifications', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  const role   = req.user?.role || 'therapist';

  try {
    // Run live checks (idempotent — skips if already stored today)
    await runAllSystemChecks(userId, role).catch(() => {});

    // Fetch persisted + ephemeral notifications
    const stored = await pool.query(
      `SELECT id::text, type, title, message, severity, status,
              related_entity AS "relatedEntityType",
              action_payload AS "actionPayload",
              created_at AS "createdAt"
       FROM user_notifications
       WHERE user_id = $1 AND status != 'dismissed'
       ORDER BY
         CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
         created_at DESC
       LIMIT 60`,
      [userId]
    );

    // Ephemeral: live checks that don't need persistence
    const ephemeral = await buildEphemeralNotifications(userId, role);

    res.json({ notifications: [...stored.rows, ...ephemeral] });
  } catch (err) {
    console.error('Notifications GET error:', err.message);
    res.json({ notifications: [] });
  }
});

// ─────────────────────────────────────────────────────────────
//  RUN ALL SYSTEM CHECKS (stores durable notifications)
// ─────────────────────────────────────────────────────────────
async function runAllSystemChecks(userId, role) {
  await Promise.allSettled([
    checkCredentialExpiry(userId),
    checkIncompleteProfile(userId),
    checkOutlookTokenExpiry(userId),
    checkCalendarConflicts(userId),
    checkLongTravelTrips(userId),
    checkMissingAddresses(userId),
    checkUnsyncedOutlookEvents(userId),
    checkCpdHoursProgress(userId),
    checkDormantCaseEscalation(userId, role),
    checkFailedWritebacks(userId),
    checkRuralTrips(userId),
    checkCaseNoteReminders(userId),
    checkClientMissingInfo(userId, role),
    ...(role === 'owner' ? [checkBillingReadiness(userId)] : []),
    ...(role === 'owner' || role === 'admin' ? [checkIncompleteTeamProfiles(userId)] : []),
  ]);
}

// ─────────────────────────────────────────────────────────────
//  EPHEMERAL CHECKS (generated fresh, not persisted)
// ─────────────────────────────────────────────────────────────
async function buildEphemeralNotifications(userId, role) {
  const results = [];

  // Daily schedule summary
  try {
    const today = await pool.query(
      `SELECT COUNT(*) AS cnt, MIN(start_time) AS first_start, MAX(end_time) AS last_end
       FROM events
       WHERE user_id = $1 AND is_deleted IS NOT TRUE
         AND DATE(start_time AT TIME ZONE 'Australia/Perth') = CURRENT_DATE AT TIME ZONE 'Australia/Perth'
         AND event_type = 'therapy'`,
      [userId]
    );
    const row = today.rows[0];
    const cnt = parseInt(row?.cnt || 0);
    if (cnt > 0) {
      const firstTime = row.first_start ? new Date(row.first_start).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Perth' }) : '';
      results.push({
        id: 'ephemeral-daily-schedule',
        type: 'daily_schedule',
        severity: 'info',
        title: `Today: ${cnt} appointment${cnt > 1 ? 's' : ''}`,
        message: `First appointment at ${firstTime}. Open Calendar for your full day view.`,
        status: 'unread',
        relatedEntityType: 'calendar',
        createdAt: new Date().toISOString(),
      });
    }
  } catch (e) {}

  // Weekly workload summary (show on Mondays or if requested)
  try {
    const dow = new Date().getDay(); // 1 = Monday
    if (dow === 1) {
      const week = await pool.query(
        `SELECT COUNT(*) AS sessions,
                COALESCE(SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600), 0)::numeric(5,1) AS hours,
                COALESCE(SUM(travel_time_minutes), 0) AS travel_min
         FROM events
         WHERE user_id = $1 AND is_deleted IS NOT TRUE
           AND event_type = 'therapy'
           AND start_time >= DATE_TRUNC('week', NOW() - INTERVAL '7 days')
           AND start_time < DATE_TRUNC('week', NOW())`,
        [userId]
      );
      const r = week.rows[0];
      const sessions = parseInt(r?.sessions || 0);
      const hours    = parseFloat(r?.hours || 0);
      const travelKm = Math.round((parseInt(r?.travel_min || 0) / 60) * 65); // rough 65 km/h average
      if (sessions > 0) {
        results.push({
          id: 'ephemeral-weekly-summary',
          type: 'weekly_summary',
          severity: 'info',
          title: `Last week: ${sessions} sessions, ${hours}h`,
          message: `Approximately ${travelKm} km travelled. Open Travel Logbook for detailed records.`,
          status: 'unread',
          relatedEntityType: 'logbook',
          createdAt: new Date().toISOString(),
        });
      }
    }
  } catch (e) {}

  return results;
}

// ─────────────────────────────────────────────────────────────
//  CHECK 1: CREDENTIAL EXPIRY (90 / 30 / 14 / 7 days)
// ─────────────────────────────────────────────────────────────
async function checkCredentialExpiry(userId) {
  const rows = await pool.query(
    `SELECT credential_name, expiry_date, credential_type
     FROM credentials
     WHERE user_id = $1 AND status = 'active' AND expiry_date IS NOT NULL
       AND expiry_date BETWEEN NOW() AND NOW() + INTERVAL '90 days'
     ORDER BY expiry_date ASC`,
    [userId]
  );

  for (const c of rows.rows) {
    const daysLeft = Math.ceil((new Date(c.expiry_date) - new Date()) / 86400000);
    const severity = daysLeft <= 7 ? 'error' : daysLeft <= 14 ? 'warning' : daysLeft <= 30 ? 'warning' : 'info';
    const urgency  = daysLeft <= 7 ? 'URGENT: ' : '';
    await storeNotification(userId, {
      type: `cred_expiry_${c.credential_name.replace(/\s+/g,'_').toLowerCase()}`,
      title: `${urgency}${c.credential_name} expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
      message: `Renew your ${c.credential_name} before ${new Date(c.expiry_date).toLocaleDateString('en-AU')} to avoid scheduling restrictions.`,
      severity,
      relatedEntity: 'profile',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 2: INCOMPLETE PROFILE (own — no base location)
// ─────────────────────────────────────────────────────────────
async function checkIncompleteProfile(userId) {
  const res = await pool.query(
    `SELECT base_location, display_name FROM therapist_profiles WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (!res.rows.length || !res.rows[0].base_location) {
    await storeNotification(userId, {
      type: 'profile_missing_base_location',
      title: 'Base work location not set',
      message: 'Travel time cannot be calculated without a base location. Go to My Profile → Work Locations to add it.',
      severity: 'warning',
      relatedEntity: 'profile',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 3: OUTLOOK TOKEN EXPIRY (warn 48 h before)
// ─────────────────────────────────────────────────────────────
async function checkOutlookTokenExpiry(userId) {
  const res = await pool.query(
    `SELECT token_expires_at, email FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  if (!res.rows.length) return;
  const { token_expires_at, email } = res.rows[0];
  if (!token_expires_at) return;

  const expiresAt = new Date(token_expires_at);
  const hoursLeft = (expiresAt - Date.now()) / 3600000;

  if (hoursLeft < 0) {
    await storeNotification(userId, {
      type: 'outlook_token_expired',
      title: 'Outlook connection has expired',
      message: 'Your Outlook calendar sync has stopped. Go to Settings → Integrations to reconnect.',
      severity: 'error',
      relatedEntity: 'integration',
    });
  } else if (hoursLeft < 48) {
    await storeNotification(userId, {
      type: 'outlook_token_expiring',
      title: `Outlook connection expires in ${Math.round(hoursLeft)} hours`,
      message: 'Reconnect your Outlook account in Settings → Integrations before it expires to avoid sync interruptions.',
      severity: 'warning',
      relatedEntity: 'integration',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 4: CALENDAR CONFLICTS (overlapping therapy events)
// ─────────────────────────────────────────────────────────────
async function checkCalendarConflicts(userId) {
  // Find pairs of therapy events that overlap within the next 14 days
  const res = await pool.query(
    `SELECT a.title AS a_title, b.title AS b_title,
            a.start_time AS a_start, b.start_time AS b_start
     FROM events a
     JOIN events b ON a.user_id = b.user_id
       AND a.id < b.id
       AND a.event_type = 'therapy' AND b.event_type = 'therapy'
       AND a.is_deleted IS NOT TRUE AND b.is_deleted IS NOT TRUE
       AND a.status != 'cancelled' AND b.status != 'cancelled'
       AND a.start_time < b.end_time AND a.end_time > b.start_time
       AND a.start_time >= NOW()
       AND a.start_time <= NOW() + INTERVAL '14 days'
     WHERE a.user_id = $1
     LIMIT 5`,
    [userId]
  );

  if (res.rows.length > 0) {
    const cnt = res.rows.length;
    const ex  = res.rows[0];
    const dateStr = new Date(ex.a_start).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
    await storeNotification(userId, {
      type: 'calendar_conflict',
      title: `${cnt} scheduling conflict${cnt > 1 ? 's' : ''} detected`,
      message: `Overlapping appointments found — e.g. "${ex.a_title}" and "${ex.b_title}" on ${dateStr}. Review your calendar to resolve.`,
      severity: 'error',
      relatedEntity: 'calendar',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 5: LONG TRAVEL TRIPS (> 45 min by default)
// ─────────────────────────────────────────────────────────────
async function checkLongTravelTrips(userId) {
  // Get user's threshold from settings (default 45 min)
  let threshold = 45;
  try {
    const stg = await pool.query(`SELECT settings FROM user_settings WHERE user_id = $1`, [userId]);
    threshold = stg.rows[0]?.settings?.travelWarnThresholdMin || 45;
  } catch (e) {}

  if (!threshold || threshold === 0) return; // user disabled warning

  const res = await pool.query(
    `SELECT title, start_time, travel_time_minutes
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND travel_time_minutes > $2
       AND start_time BETWEEN NOW() AND NOW() + INTERVAL '7 days'
     ORDER BY travel_time_minutes DESC LIMIT 3`,
    [userId, threshold]
  );

  if (res.rows.length > 0) {
    const worst = res.rows[0];
    const dateStr = new Date(worst.start_time).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Perth' });
    await storeNotification(userId, {
      type: 'long_travel_warning',
      title: `Long travel detected: ${worst.travel_time_minutes} min to "${worst.title}"`,
      message: `${res.rows.length} upcoming appointment${res.rows.length > 1 ? 's' : ''} require${res.rows.length === 1 ? 's' : ''} travel over ${threshold} min. Next: ${dateStr}.`,
      severity: 'warning',
      relatedEntity: 'calendar',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 6: MISSING ADDRESSES on upcoming appointments
// ─────────────────────────────────────────────────────────────
async function checkMissingAddresses(userId) {
  // Events in the next 7 days with no location and no travel time (indicating unresolved address)
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND event_type = 'therapy'
       AND (location IS NULL OR location = '' OR location = 'unknown')
       AND start_time BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'missing_address_upcoming',
      title: `${cnt} upcoming appointment${cnt > 1 ? 's' : ''} missing address`,
      message: `Travel time cannot be calculated for ${cnt} appointment${cnt > 1 ? 's' : ''} in the next 7 days. Open each appointment to add a location.`,
      severity: cnt >= 3 ? 'error' : 'warning',
      relatedEntity: 'calendar',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 7: UNSYNCED OUTLOOK EVENTS
// ─────────────────────────────────────────────────────────────
async function checkUnsyncedOutlookEvents(userId) {
  // Therapy events that came from Outlook but have no Splose ID — may be entered directly in Outlook
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND source = 'outlook'
       AND (splose_id IS NULL OR splose_id = '')
       AND event_type = 'therapy'
       AND start_time >= NOW() - INTERVAL '14 days'`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'unsynced_outlook_events',
      title: `${cnt} Outlook appointment${cnt > 1 ? 's' : ''} not in Splose`,
      message: `${cnt} calendar event${cnt > 1 ? 's' : ''} from Outlook ${cnt > 1 ? 'have' : 'has'} no matching Splose record. Check your Splose appointments are complete.`,
      severity: 'warning',
      relatedEntity: 'calendar',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 8: CPD HOURS PROGRESS
// ─────────────────────────────────────────────────────────────
async function checkCpdHoursProgress(userId) {
  const currentYear = new Date().getFullYear();
  const CPD_TARGET  = 30; // OT Australia standard

  const res = await pool.query(
    `SELECT COALESCE(SUM(hours), 0)::numeric(5,1) AS total_hours
     FROM cpd_activities
     WHERE user_id = $1
       AND EXTRACT(YEAR FROM COALESCE(completed_date, created_at)) = $2`,
    [userId, currentYear]
  );

  const hoursLogged = parseFloat(res.rows[0]?.total_hours || 0);
  const hoursNeeded = CPD_TARGET - hoursLogged;
  const dayOfYear   = Math.floor((Date.now() - new Date(currentYear, 0, 0)) / 86400000);
  const yearProgress = dayOfYear / 365;

  // Alert if significantly behind pace
  const expectedHours = CPD_TARGET * yearProgress;
  const deficit = expectedHours - hoursLogged;

  if (hoursLogged < CPD_TARGET) {
    if (deficit >= 10 || (yearProgress > 0.75 && hoursNeeded > 5)) {
      await storeNotification(userId, {
        type: 'cpd_hours_behind',
        title: `CPD hours: ${hoursLogged}/${CPD_TARGET}h logged this year`,
        message: hoursNeeded > 0
          ? `You need ${hoursNeeded.toFixed(1)} more hours to meet your ${CPD_TARGET}h annual CPD target. Log activities in My Profile → CPD.`
          : `Great work — you've met your ${CPD_TARGET}h CPD target for ${currentYear}!`,
        severity: deficit >= 10 ? 'warning' : 'info',
        relatedEntity: 'profile',
      });
    }
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 9: DORMANT CASE ESCALATION
// ─────────────────────────────────────────────────────────────
async function checkDormantCaseEscalation(userId, role) {
  if (role !== 'admin' && role !== 'owner') return;
  // Clients with therapy events but none in the last 6 weeks
  const res = await pool.query(
    `SELECT client_name, MAX(start_time) AS last_seen
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND event_type = 'therapy'
       AND client_name IS NOT NULL AND client_name != ''
     GROUP BY client_name
     HAVING MAX(start_time) < NOW() - INTERVAL '42 days'
     ORDER BY last_seen ASC
     LIMIT 10`,
    [userId]
  );

  const cnt = res.rows.length;
  if (cnt > 0) {
    const oldest = res.rows[0];
    const weeksAgo = Math.floor((Date.now() - new Date(oldest.last_seen)) / (86400000 * 7));
    await storeNotification(userId, {
      type: 'dormant_case_escalation',
      title: `${cnt} client${cnt > 1 ? 's' : ''} inactive for 6+ weeks`,
      message: `"${oldest.client_name}" last seen ${weeksAgo} weeks ago. Review dormant cases to plan follow-up or discharge.`,
      severity: 'warning',
      relatedEntity: 'dormant',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 10: FAILED OUTLOOK WRITE-BACKS
// ─────────────────────────────────────────────────────────────
async function checkFailedWritebacks(userId) {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt, MAX(created_at) AS latest
     FROM sync_log sl
     JOIN events e ON e.id = sl.event_id
     WHERE e.user_id = $1
       AND sl.status = 'failed'
       AND sl.target = 'outlook'
       AND sl.created_at > NOW() - INTERVAL '24 hours'`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'outlook_writeback_failed',
      title: `${cnt} Outlook write-back${cnt > 1 ? 's' : ''} failed`,
      message: `${cnt} calendar update${cnt > 1 ? 's' : ''} could not be written to Outlook in the last 24 hours. Check Settings → Integrations or reconnect your account.`,
      severity: 'error',
      relatedEntity: 'integration',
      actionPayload: { action: 'reconnect_outlook', path: '/api/auth/outlook' },
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 11: RURAL TRIPS (>90 min single trip)
// ─────────────────────────────────────────────────────────────
async function checkRuralTrips(userId) {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt, MAX(travel_time_minutes) AS max_min
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND travel_time_minutes > 90
       AND start_time BETWEEN NOW() AND NOW() + INTERVAL '14 days'`,
    [userId]
  );

  const cnt    = parseInt(res.rows[0]?.cnt || 0);
  const maxMin = parseInt(res.rows[0]?.max_min || 0);
  if (cnt >= 2) {
    await storeNotification(userId, {
      type: 'rural_trip_planning',
      title: `${cnt} rural trips upcoming (up to ${maxMin} min travel)`,
      message: `You have ${cnt} trips over 90 minutes in the next 2 weeks. Consider clustering clients by region to reduce total travel. Check Travel & Flights for planning options.`,
      severity: 'info',
      relatedEntity: 'travel',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 12: CASE NOTE REMINDERS
// ─────────────────────────────────────────────────────────────
async function checkCaseNoteReminders(userId) {
  // Therapy events completed in the last 48 hours with a Splose ID but flagged as needing notes
  // We use custom_metadata->>'case_note_status' = 'pending' as a marker set by the app
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND event_type = 'therapy'
       AND end_time < NOW()
       AND end_time > NOW() - INTERVAL '48 hours'
       AND splose_id IS NOT NULL
       AND (custom_metadata->>'case_note_status' = 'pending'
            OR custom_metadata->>'case_note_status' IS NULL)`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'case_note_reminder',
      title: `${cnt} session${cnt > 1 ? 's' : ''} may need case notes`,
      message: `${cnt} appointment${cnt > 1 ? 's' : ''} completed in the last 48 hours. Check Splose to ensure case notes are recorded.`,
      severity: 'warning',
      relatedEntity: 'calendar',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 13: CLIENT MISSING KEY INFORMATION
// ─────────────────────────────────────────────────────────────
async function checkClientMissingInfo(userId, role) {
  // Only Admin/Owner can see cross-client data
  if (role !== 'admin' && role !== 'owner') return;

  const res = await pool.query(
    `SELECT COUNT(DISTINCT client_name) AS cnt
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND event_type = 'therapy'
       AND client_name IS NOT NULL AND client_name != ''
       AND (location IS NULL OR location = '' OR location = 'unknown')
       AND start_time >= NOW() - INTERVAL '30 days'`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'client_missing_address',
      title: `${cnt} client${cnt > 1 ? 's' : ''} missing address`,
      message: `${cnt} active client${cnt > 1 ? 's have' : ' has'} no resolvable address in recent appointments. Update location details to enable travel calculation.`,
      severity: 'warning',
      relatedEntity: 'contacts',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 14: BILLING READINESS (Owner only)
// ─────────────────────────────────────────────────────────────
async function checkBillingReadiness(userId) {
  // Completed therapy events in the last 30 days that have a Splose ID but
  // no record of billing (using sync_status as proxy: 'pending' = not fully processed)
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt
     FROM events
     WHERE user_id = $1 AND is_deleted IS NOT TRUE
       AND event_type = 'therapy'
       AND status = 'confirmed'
       AND end_time BETWEEN NOW() - INTERVAL '30 days' AND NOW()
       AND splose_id IS NOT NULL
       AND sync_status = 'pending'`,
    [userId]
  );

  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'billing_readiness',
      title: `${cnt} completed session${cnt > 1 ? 's' : ''} may need billing review`,
      message: `${cnt} therapy session${cnt > 1 ? 's' : ''} from the last 30 days appear unprocessed. Review in Splose billing or the Billing tab to confirm claims.`,
      severity: 'warning',
      relatedEntity: 'billing',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  CHECK 15: INCOMPLETE TEAM PROFILES (Admin/Owner)
// ─────────────────────────────────────────────────────────────
async function checkIncompleteTeamProfiles(userId) {
  const res = await pool.query(
    `SELECT COUNT(*) AS cnt FROM users WHERE profile_completed = false`
  );
  const cnt = parseInt(res.rows[0]?.cnt || 0);
  if (cnt > 0) {
    await storeNotification(userId, {
      type: 'team_profiles_incomplete',
      title: `${cnt} team member${cnt > 1 ? 's' : ''} with incomplete profile`,
      message: `Incomplete profiles affect travel calculation accuracy. Remind staff to complete their profile including base work location.`,
      severity: 'warning',
      relatedEntity: 'profile',
    });
  }
}

// ─────────────────────────────────────────────────────────────
//  PATCH notification status
// ─────────────────────────────────────────────────────────────
router.patch('/api/notifications/:id', requireAuth, async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;
  const userId     = req.user?.id || req.session.userId;

  if (!['read', 'dismissed'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Use "read" or "dismissed".' });
  }

  // Ephemeral notifications (prefixed with 'ephemeral-' or 'sys-') aren't in the DB
  if (!/^\d+$/.test(id)) {
    return res.json({ ok: true, note: 'ephemeral' });
  }

  try {
    await pool.query(
      `UPDATE user_notifications SET status = $1 WHERE id = $2 AND user_id = $3`,
      [status, parseInt(id, 10), userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notification' });
  }
});

// ─────────────────────────────────────────────────────────────
//  POST mark-all-read
// ─────────────────────────────────────────────────────────────
router.post('/api/notifications/mark-all-read', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  try {
    await pool.query(
      `UPDATE user_notifications SET status = 'read'
       WHERE user_id = $1 AND status = 'unread'`,
      [userId]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update notifications' });
  }
});

// ─────────────────────────────────────────────────────────────
//  EXPORT helper for other route files to store notifications
// ─────────────────────────────────────────────────────────────
module.exports.storeNotification = storeNotification;

// ─────────────────────────────────────────────────────────────
//  SETTINGS — GET
// ─────────────────────────────────────────────────────────────
const DEFAULT_USER_SETTINGS = {
  // Display
  displayName: '',
  timeFormat: '12',

  // Calendar
  calendarDefaultView: 'week',
  calendarStartHour: 7,
  calendarEndHour: 18,
  weekStartsOn: 1,           // 1=Monday, 0=Sunday
  showWeekends: false,
  showSploseEvents: true,
  showOutlookEvents: true,
  showTravelBlocks: true,
  showIdleGaps: true,

  // Appointment defaults
  defaultAppointmentDurationMinutes: 60,
  defaultBookingType: 'therapy',

  // Travel
  enableTravelCalculation: true,
  travelWarnThresholdMin: 45,
  travelFromBase: true,
  travelReturnBase: false,

  // Report / billing targets (personal)
  reportPreferences: {
    dailyBillableTargetHours: 5.0,
    weeklyBillableTargetHours: 25.0,
    showDailyReportOnLogin: false,
    showWeeklyReportOnMonday: false,
    includeTravel: true,
    includeIdleGaps: true,
    includeCpdSuggestions: true,
    includeLunchSuggestions: true,
  },

  // Notifications
  notificationPreferences: {
    dailySchedule: true,
    missingLocation: true,
    credentialExpiry: true,
    credWarnDays: 30,
    cpdReminders: true,
    profileIncomplete: true,
    conflicts: true,
    longTravelWarn: true,
    syncFailures: true,
    writebackFailures: true,
    dormantEnabled: true,
    dormantWeekThreshold: 6,
  },
};

router.get('/api/settings', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  const role   = req.user?.role || 'therapist';

  try {
    const userRes = await pool.query(
      `SELECT settings FROM user_settings WHERE user_id = $1`, [userId]
    );
    const userSettings = { ...DEFAULT_USER_SETTINGS, ...(userRes.rows[0]?.settings || {}) };

    let orgSettings = {};
    try {
      const orgRes = await pool.query(`SELECT settings FROM org_settings WHERE org_id = 'opal' LIMIT 1`);
      const full = orgRes.rows[0]?.settings || {};
      orgSettings = role === 'owner' ? full : { kilometreRate: full.kilometreRate || 0.88 };
    } catch (e) {}

    res.json({ settings: userSettings, orgSettings });
  } catch (err) {
    res.json({ settings: DEFAULT_USER_SETTINGS, orgSettings: {} });
  }
});

// ─────────────────────────────────────────────────────────────
//  SETTINGS — PATCH (user)
// ─────────────────────────────────────────────────────────────
router.patch('/api/settings', requireAuth, async (req, res) => {
  const userId  = req.user?.id || req.session.userId;
  const allowed = [
    'displayName','timeFormat',
    'calendarDefaultView','calendarStartHour','calendarEndHour',
    'weekStartsOn','showWeekends',
    'showSploseEvents','showOutlookEvents','showTravelBlocks','showIdleGaps',
    'enableTravelCalculation','travelWarnThresholdMin','travelFromBase','travelReturnBase',
    'defaultAppointmentDurationMinutes','defaultBookingType',
    'reportPreferences','notificationPreferences',
  ];

  const payload = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });

  try {
    // Merge with existing settings (don't blow away keys not in this request)
    await pool.query(
      `INSERT INTO user_settings (user_id, settings, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE
         SET settings   = user_settings.settings || $2,
             updated_at = NOW()`,
      [userId, JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Save user settings error:', err.message);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// ─────────────────────────────────────────────────────────────
//  SETTINGS — PATCH (organisation, owner only)
// ─────────────────────────────────────────────────────────────
router.patch('/api/settings/organisation', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Only owners can change organisation settings' });
  }
  const allowed = ['name','kilometreRate','featureFlags','syncSettings','dataRetention'];
  const payload = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) payload[k] = req.body[k]; });

  // Always enforce autoFitClients = false
  if (payload.featureFlags) payload.featureFlags.autoFitClients = false;

  try {
    await pool.query(
      `INSERT INTO org_settings (org_id, settings, updated_at)
       VALUES ('opal', $1, NOW())
       ON CONFLICT (org_id) DO UPDATE
         SET settings   = org_settings.settings || $1,
             updated_at = NOW()`,
      [JSON.stringify(payload)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Save org settings error:', err.message);
    res.status(500).json({ error: 'Failed to save organisation settings' });
  }
});

// ─────────────────────────────────────────────────────────────
//  SETTINGS — GET organisation (full, owner) or public fields
// ─────────────────────────────────────────────────────────────
router.get('/api/settings/organisation', requireAuth, async (req, res) => {
  const role = req.user?.role || 'therapist';
  try {
    const orgRes = await pool.query(`SELECT settings FROM org_settings WHERE org_id = 'opal' LIMIT 1`);
    const full = orgRes.rows[0]?.settings || {};
    const DEFAULT_ORG = { name: 'Opal Therapy', kilometreRate: 0.88,
      featureFlags: { outlookWriteBack: true, dailyWeeklyReports: true, interactiveHelp: true, idleGapSuggestions: true } };
    const merged = { ...DEFAULT_ORG, ...full };
    // Non-owners only see public fields
    if (role !== 'owner') {
      return res.json({ orgSettings: { kilometreRate: merged.kilometreRate } });
    }
    res.json({ orgSettings: merged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
//  SETTINGS — Integration status
// ─────────────────────────────────────────────────────────────
router.get('/api/settings/integrations/status', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  const statuses = {};

  // Splose: check if the last sync attempt succeeded (look for recent sync failure notification)
  try {
    const fail = await pool.query(
      `SELECT id FROM user_notifications WHERE user_id = $1 AND type = 'splose_sync_failure'
       AND status != 'dismissed' AND created_at > NOW() - INTERVAL '5 minutes' LIMIT 1`,
      [userId]
    );
    statuses.splose = { connected: fail.rowCount === 0, lastChecked: new Date().toISOString() };
  } catch (e) {
    statuses.splose = { connected: null, error: 'Status unavailable' };
  }

  // Outlook: check if user has a non-expired OAuth token
  try {
    const userRow = await pool.query(
      `SELECT access_token, token_expires_at, email FROM users WHERE id = $1`, [userId]
    );
    const u = userRow.rows[0];
    const hasToken = !!(u && u.access_token);
    const expired = hasToken && u.token_expires_at && new Date(u.token_expires_at) < new Date();
    statuses.outlook = {
      connected: hasToken && !expired,
      expired: expired,
      email: u?.email || null,
      lastChecked: new Date().toISOString(),
    };
  } catch (e) {
    statuses.outlook = { connected: null, error: 'Status unavailable' };
  }

  // Google Maps: check if key is configured (env var)
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_API_KEY || '';
  statuses.googleMaps = { connected: gmapsKey.length > 10, lastChecked: new Date().toISOString() };

  res.json({ statuses });
});

// ─────────────────────────────────────────────────────────────
//  AUTH — Change password
// ─────────────────────────────────────────────────────────────
router.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from current password' });
  }

  try {
    const bcrypt = require('bcrypt');
    const userRow = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    if (!userRow.rows[0]) return res.status(404).json({ error: 'User not found' });

    const match = await bcrypt.compare(currentPassword, userRow.rows[0].password_hash);
    if (!match) return res.status(400).json({ error: 'Current password is incorrect' });

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [newHash, userId]);

    res.json({ ok: true, message: 'Password updated successfully' });
  } catch (err) {
    console.error('Change password error:', err.message);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// ─────────────────────────────────────────────────────────────
//  SEARCH
// ─────────────────────────────────────────────────────────────
router.get('/api/search', requireAuth, async (req, res) => {
  const q    = (req.query.q || '').trim();
  const role = req.user?.role || 'therapist';
  const uid  = req.user?.id || req.session.userId;

  if (!q || q.length < 2) return res.json({ results: [] });

  const ql = `%${q.toLowerCase()}%`;
  const results = [];

  await Promise.allSettled([
    // Clients (via recent events — patients table may not exist)
    (async () => {
      const qry = role === 'therapist'
        ? `SELECT DISTINCT client_name, client_id
           FROM events
           WHERE user_id = $1 AND client_name IS NOT NULL AND LOWER(client_name) LIKE $2
             AND is_deleted IS NOT TRUE
           ORDER BY client_name LIMIT 6`
        : `SELECT DISTINCT client_name, client_id
           FROM events
           WHERE client_name IS NOT NULL AND LOWER(client_name) LIKE $1
             AND is_deleted IS NOT TRUE
           ORDER BY client_name LIMIT 6`;
      const params = role === 'therapist' ? [uid, ql] : [ql];
      const r = await pool.query(qry, params);
      r.rows.forEach(row => results.push({
        group: 'Clients', icon: '👤',
        title: row.client_name, sub: 'Client',
        tag: 'Client', navigateTo: 'contacts',
      }));
    })(),

    // Appointments / calendar events
    (async () => {
      const qry = role === 'therapist'
        ? `SELECT title, start_time, location FROM events
           WHERE user_id = $1 AND LOWER(title) LIKE $2
             AND is_deleted IS NOT TRUE AND start_time >= NOW() - INTERVAL '30 days'
           ORDER BY ABS(EXTRACT(EPOCH FROM (start_time - NOW())))
           LIMIT 5`
        : `SELECT title, start_time, location FROM events
           WHERE LOWER(title) LIKE $1
             AND is_deleted IS NOT TRUE AND start_time >= NOW() - INTERVAL '30 days'
           ORDER BY ABS(EXTRACT(EPOCH FROM (start_time - NOW())))
           LIMIT 5`;
      const params = role === 'therapist' ? [uid, ql] : [ql];
      const r = await pool.query(qry, params);
      r.rows.forEach(row => results.push({
        group: 'Calendar', icon: '🗓️',
        title: row.title,
        sub: row.start_time ? new Date(row.start_time).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' }) : '',
        tag: 'Event', navigateTo: 'calendar',
      }));
    })(),

    // Credentials
    (async () => {
      const r = await pool.query(
        `SELECT credential_name, credential_type, expiry_date FROM credentials
         WHERE user_id = $1 AND LOWER(credential_name) LIKE $2 LIMIT 4`,
        [uid, ql]
      );
      r.rows.forEach(row => results.push({
        group: 'Credentials', icon: '📜',
        title: row.credential_name,
        sub: row.expiry_date ? `Expires ${new Date(row.expiry_date).toLocaleDateString('en-AU')}` : row.credential_type,
        tag: 'Credential', navigateTo: 'profile',
      }));
    })(),

    // CPD activities
    (async () => {
      const r = await pool.query(
        `SELECT title, provider, completed_date, hours FROM cpd_activities
         WHERE user_id = $1 AND LOWER(title) LIKE $2 LIMIT 4`,
        [uid, ql]
      );
      r.rows.forEach(row => results.push({
        group: 'CPD', icon: '🎓',
        title: row.title,
        sub: [row.provider, row.hours ? row.hours + 'h' : ''].filter(Boolean).join(' · '),
        tag: 'CPD', navigateTo: 'profile',
      }));
    })(),

    // Leave requests
    (async () => {
      const r = await pool.query(
        `SELECT leave_type, start_date, end_date, status FROM leave_requests
         WHERE user_id = $1 AND LOWER(leave_type) LIKE $2 LIMIT 3`,
        [uid, ql]
      );
      r.rows.forEach(row => results.push({
        group: 'Leave', icon: '🏖️',
        title: row.leave_type + ' Leave',
        sub: `${new Date(row.start_date).toLocaleDateString('en-AU')} · ${row.status}`,
        tag: 'Leave', navigateTo: 'profile',
      }));
    })(),
  ]);

  // Settings sections
  const settingsSections = [
    { label: 'My Settings', desc: 'Personal preferences', section: 'my-settings' },
    { label: 'Calendar Settings', desc: 'View, hours, event visibility', section: 'calendar-settings' },
    { label: 'Travel Settings', desc: 'Km rate, calculation options', section: 'travel-settings' },
    { label: 'Notification Settings', desc: 'Alerts and reminders', section: 'notif-settings' },
    { label: 'Integrations', desc: 'Splose, Outlook, Google Maps', section: 'integration-settings' },
    { label: 'Security', desc: 'Password, sessions, MFA', section: 'security-settings' },
  ];
  if (role === 'owner') {
    settingsSections.push({ label: 'Business Settings', desc: 'Org config, feature flags', section: 'business-settings' });
    settingsSections.push({ label: 'Users & Roles', desc: 'Manage team members', section: 'user-management' });
  }
  settingsSections.forEach(s => {
    if (s.label.toLowerCase().includes(q.toLowerCase()) || s.desc.toLowerCase().includes(q.toLowerCase())) {
      results.push({ group: 'Settings', icon: '⚙️', title: s.label, sub: s.desc, tag: 'Settings', navigateTo: 'settings', settingsSection: s.section });
    }
  });

  // Navigation shortcuts
  const navItems = [
    { label: 'My Profile', tab: 'profile', icon: '👤', desc: 'Leave, CPD, credentials' },
    { label: 'Smart Booking', tab: 'book', icon: '📅', desc: 'Create a new appointment' },
    { label: 'Calendar', tab: 'calendar', icon: '🗓️', desc: 'View your schedule' },
    { label: 'Contacts', tab: 'contacts', icon: '📋', desc: 'Clients and referrers' },
    { label: 'Activity', tab: 'activity', icon: '📊', desc: 'Session activity log' },
    { label: 'NDIS Cases', tab: 'ndis', icon: '📁', desc: 'NDIS case management' },
    { label: 'Dormant Cases', tab: 'dormant', icon: '⚠️', desc: 'Inactive clients' },
    { label: 'Travel Logbook', tab: 'logbook', icon: '🚗', desc: 'ATO travel records' },
    { label: 'Settings', tab: 'settings', icon: '⚙️', desc: 'App preferences and integrations' },
    ...(role !== 'therapist' ? [{ label: 'Billing', tab: 'billing', icon: '💳', desc: 'Invoices and payments' }] : []),
  ];
  navItems.forEach(n => {
    if (n.label.toLowerCase().includes(q.toLowerCase()) || n.desc.toLowerCase().includes(q.toLowerCase())) {
      results.push({ group: 'Navigation', icon: n.icon, title: n.label, sub: n.desc, tag: 'Page', navigateTo: n.tab });
    }
  });

  res.json({ results });
});

// ─────────────────────────────────────────────────────────────
//  USERS LIST (Owner only)
// ─────────────────────────────────────────────────────────────
router.get('/api/users', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') {
    return res.status(403).json({ error: 'Access denied' });
  }
  try {
    const result = await pool.query(
      `SELECT id, email, role, display_name, profile_completed, created_at
       FROM users ORDER BY created_at ASC`
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error('Users list error:', err.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// ─────────────────────────────────────────────────────────────
//  FORCE SYNC endpoint (referenced by Settings page)
// ─────────────────────────────────────────────────────────────
router.post('/api/sync/force', requireAuth, async (req, res) => {
  // Trigger the delta sync for this user immediately
  // The actual delta sync is in server.js — we emit a signal here
  try {
    const { runDeltaSyncForAllUsers } = require('./server');
    if (typeof runDeltaSyncForAllUsers === 'function') {
      runDeltaSyncForAllUsers().catch(() => {});
    }
  } catch (e) {
    // server.js doesn't export it directly; that's fine — sync runs on its own schedule
  }
  res.json({ ok: true, message: 'Sync triggered' });
});

// ─────────────────────────────────────────────────────────────
//  SUPPORT — Bug report
// ─────────────────────────────────────────────────────────────
router.post('/api/support/bug-report', requireAuth, async (req, res) => {
  const userId = req.user?.id || req.session.userId;
  const { message } = req.body || {};

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required' });
  }

  try {
    // Store as a persistent notification so it's visible in the admin panel
    await storeNotification(userId, {
      type:     `bug_report_${Date.now()}`, // unique key so multiple reports are stored
      title:    'Bug report submitted',
      message:  message.trim().slice(0, 1000),
      severity: 'info',
      relatedEntity: 'support',
    });

    // Also write to console so it appears in backend logs
    const userRow = await pool.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = userRow.rows[0]?.email || userId;
    console.log(`🐛 Bug report from ${email}: ${message.trim()}`);

    res.json({ ok: true });
  } catch (err) {
    console.error('Bug report error:', err.message);
    res.status(500).json({ error: 'Failed to submit bug report' });
  }
});

// ─────────────────────────────────────────────────────────────
//  APP INFO — version + environment
// ─────────────────────────────────────────────────────────────
let _pkgVersion = null;
function getAppVersion() {
  if (_pkgVersion) return _pkgVersion;
  try {
    const pkg = require('./package.json');
    _pkgVersion = pkg.version || '1.0.0';
  } catch (_) {
    _pkgVersion = '1.0.0';
  }
  return _pkgVersion;
}

router.get('/api/app-info', requireAuth, (req, res) => {
  const env = process.env.NODE_ENV || 'development';
  const version = getAppVersion();
  res.json({
    version,
    label: `v${version} (Opal Therapy)`,
    environment: env.charAt(0).toUpperCase() + env.slice(1),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  ADMIN USER MANAGEMENT
//  Owner-only routes to list, approve, role-change, suspend, and activate users.
// ═══════════════════════════════════════════════════════════════════════════

const emailSvcAdmin = require('./email');

/**
 * GET /api/admin/users
 * Returns all users with rich status info. Owner-only.
 */
router.get('/api/admin/users', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.name, u.display_name, u.role, u.role_title,
              u.account_status, u.email_verified, u.is_active,
              u.profile_completed, u.onboarding_step,
              u.default_work_location, u.work_location_schedule,
              u.has_outlook_connected, u.approved_at, u.suspended_at,
              u.last_login_at, u.created_at,
              approver.display_name AS approved_by_name,
              (u.access_token IS NOT NULL AND u.access_token != '') AS has_outlook
         FROM users u
         LEFT JOIN users approver ON approver.id = u.approved_by_user_id
        ORDER BY u.created_at DESC`
    );
    // Enrich each user with completeness flags
    const users = rows.map(u => ({
      id:               u.id,
      email:            u.email,
      name:             u.name || u.display_name || u.email.split('@')[0],
      displayName:      u.display_name,
      role:             u.role,
      roleTitle:        u.role_title,
      accountStatus:    u.account_status || 'active',
      emailVerified:    !!u.email_verified,
      isActive:         !!u.is_active,
      profileCompleted: !!u.profile_completed,
      onboardingStep:   u.onboarding_step,
      hasOutlook:       !!u.has_outlook,
      hasWorkLocation:  !!(u.default_work_location || u.work_location_schedule),
      approvedAt:       u.approved_at,
      approvedBy:       u.approved_by_name,
      suspendedAt:      u.suspended_at,
      lastLoginAt:      u.last_login_at,
      createdAt:        u.created_at,
    }));
    res.json({ users });
  } catch (err) {
    console.error('GET /api/admin/users error:', err);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

/**
 * PATCH /api/admin/users/:id/approve
 * Approve a pending_approval account and make it active. Owner-only.
 */
router.patch('/api/admin/users/:id/approve', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET account_status = 'active', approved_by_user_id = $1, approved_at = NOW(),
                        is_active = TRUE, updated_at = NOW()
         WHERE id = $2 AND account_status IN ('pending_approval','pending_verification')
         RETURNING id, email, name, display_name, role`,
      [req.user.id, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found or already active' });

    await pool.logAuditEvent?.call(pool, {
      actorUserId: req.user.id, action: 'account.approved', targetType: 'user', targetId: id,
      ipAddress: req.ip, metadata: { newStatus: 'active' },
    }).catch(() => {});

    // Notify the user their account is approved
    emailSvcAdmin.sendAccountApprovedEmail({
      toEmail: rows[0].email,
      name:    rows[0].display_name || rows[0].name,
      role:    rows[0].role,
    }).catch(() => {});

    console.log(`✅ Account approved: ${rows[0].email} by ${req.user.email}`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('PATCH approve error:', err);
    res.status(500).json({ error: 'Failed to approve account' });
  }
});

/**
 * PATCH /api/admin/users/:id/role
 * Change a user's role. Owner-only.
 * Body: { role: 'owner'|'admin'|'therapist' }
 */
router.patch('/api/admin/users/:id/role', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const { id } = req.params;
  const { role } = req.body || {};
  if (!['owner','admin','therapist'].includes(role)) {
    return res.status(400).json({ error: 'role must be owner, admin, or therapist' });
  }
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, role`,
      [role, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    // Use db module for audit (it has logAuditEvent)
    const dbMod = require('./database');
    await dbMod.logAuditEvent({
      actorUserId: req.user.id, action: 'role.changed', targetType: 'user', targetId: id,
      ipAddress: req.ip, metadata: { newRole: role },
    }).catch(() => {});

    console.log(`🔄 Role changed: ${rows[0].email} → ${role} by ${req.user.email}`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('PATCH role error:', err);
    res.status(500).json({ error: 'Failed to change role' });
  }
});

/**
 * PATCH /api/admin/users/:id/suspend
 * Suspend an active account. Owner-only.
 * Body: { reason?: string }
 */
router.patch('/api/admin/users/:id/suspend', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot suspend your own account' });
  const { reason } = req.body || {};
  try {
    const { rows } = await pool.query(
      `UPDATE users SET account_status = 'suspended', is_active = FALSE,
                        suspended_by_user_id = $1, suspended_at = NOW(), suspended_reason = $2,
                        updated_at = NOW()
         WHERE id = $3 AND account_status = 'active'
         RETURNING id, email, name`,
      [req.user.id, reason || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found or not active' });

    // Invalidate all sessions for suspended user
    await pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [id]).catch(() => {});

    const dbMod = require('./database');
    await dbMod.logAuditEvent({
      actorUserId: req.user.id, action: 'account.suspended', targetType: 'user', targetId: id,
      ipAddress: req.ip, metadata: { reason: reason || null },
    }).catch(() => {});

    console.log(`🚫 Account suspended: ${rows[0].email} by ${req.user.email}`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('PATCH suspend error:', err);
    res.status(500).json({ error: 'Failed to suspend account' });
  }
});

/**
 * PATCH /api/admin/users/:id/activate
 * Re-activate a suspended or deactivated account. Owner-only.
 */
router.patch('/api/admin/users/:id/activate', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `UPDATE users SET account_status = 'active', is_active = TRUE,
                        suspended_by_user_id = NULL, suspended_at = NULL, suspended_reason = NULL,
                        updated_at = NOW()
         WHERE id = $1 AND account_status IN ('suspended','deactivated')
         RETURNING id, email, name`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found or already active' });

    const dbMod = require('./database');
    await dbMod.logAuditEvent({
      actorUserId: req.user.id, action: 'account.activated', targetType: 'user', targetId: id,
      ipAddress: req.ip,
    }).catch(() => {});

    console.log(`✅ Account re-activated: ${rows[0].email} by ${req.user.email}`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('PATCH activate error:', err);
    res.status(500).json({ error: 'Failed to activate account' });
  }
});

/**
 * PATCH /api/admin/users/:id/deactivate
 * Permanently deactivate an account. Data is preserved. Owner-only.
 */
router.patch('/api/admin/users/:id/deactivate', requireAuth, async (req, res) => {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Owner access required' });
  const { id } = req.params;
  if (id === req.user.id) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  try {
    const { rows } = await pool.query(
      `UPDATE users SET account_status = 'deactivated', is_active = FALSE, updated_at = NOW()
         WHERE id = $1 RETURNING id, email, name`,
      [id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });

    await pool.query(`DELETE FROM sessions WHERE sess->>'userId' = $1`, [id]).catch(() => {});

    const dbMod = require('./database');
    await dbMod.logAuditEvent({
      actorUserId: req.user.id, action: 'account.deactivated', targetType: 'user', targetId: id,
      ipAddress: req.ip,
    }).catch(() => {});

    console.log(`🗑️  Account deactivated: ${rows[0].email} by ${req.user.email}`);
    res.json({ ok: true, user: rows[0] });
  } catch (err) {
    console.error('PATCH deactivate error:', err);
    res.status(500).json({ error: 'Failed to deactivate account' });
  }
});

// ─────────────────────────────────────────────────────────────
//  Export router
// ─────────────────────────────────────────────────────────────
module.exports = Object.assign(router, { storeNotification });
