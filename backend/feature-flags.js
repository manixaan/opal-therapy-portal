'use strict';

/**
 * STAGED-INTEGRATION FEATURE FLAGS (Phase 10)
 *
 * The pilot goes live in stages: first the portal mirrors Outlook/Splose
 * read-only, then write-back is enabled deliberately, environment by
 * environment. These flags are the switchboard:
 *
 *   ENABLE_OUTLOOK_WRITE           — create/update/delete events in Outlook
 *   ENABLE_SPLOSE_WRITE            — create/update appointments in Splose
 *   ENABLE_AUTOMATIC_REMOTE_DELETE — sync-initiated deletions pushed to remote
 *                                    systems (e.g. Splose cancellation
 *                                    cascading a delete into Outlook)
 *   ENABLE_SPLOSE_CALENDAR_SYNC    — Splose CALENDAR coupling (appointment
 *                                    poller + frontend appointment merge).
 *                                    OFF by default in EVERY environment:
 *                                    calendar integration is Outlook-only
 *                                    (two-way mirror); Splose serves patient/
 *                                    client data only. Set to the string
 *                                    'true' to re-enable the legacy coupling.
 *
 * Resolution: explicit env value ('true'/'false') always wins. When unset:
 * development/test default TRUE (full functionality locally), staging and
 * production default FALSE (fail-safe: a forgotten setting can only make the
 * pilot read-only, never surprise-write into a clinician's calendar).
 * EXCEPTION: ENABLE_SPLOSE_CALENDAR_SYNC defaults FALSE everywhere — the
 * Outlook-only mirror is the intended state, so this flag fails closed even
 * in development.
 *
 * Enforcement is layered:
 *   - outlook-oauth.js / splose-api.js write functions throw
 *     err.code='FEATURE_DISABLED' (module boundary — covers every caller)
 *   - user-facing routes turn that into a clear 403 feature_disabled
 *   - the Splose poller checks the delete flag explicitly and counts skips
 */

function resolveFlag(name) {
  const raw = process.env[name];
  if (raw !== undefined && raw !== '') return raw === 'true';
  const env = process.env.NODE_ENV || 'development';
  return env === 'development' || env === 'test';
}

function isOutlookWriteEnabled() { return resolveFlag('ENABLE_OUTLOOK_WRITE'); }
function isSploseWriteEnabled() { return resolveFlag('ENABLE_SPLOSE_WRITE'); }
function isAutomaticRemoteDeleteEnabled() { return resolveFlag('ENABLE_AUTOMATIC_REMOTE_DELETE'); }

/**
 * Splose CALENDAR coupling (appointment poller + frontend appointment merge).
 * Fails closed in every environment — only the exact string 'true' enables it.
 * Calendar integration is Outlook-only; Splose remains for patient data.
 */
function isSploseCalendarSyncEnabled() {
  return process.env.ENABLE_SPLOSE_CALENDAR_SYNC === 'true';
}

/**
 * Splose DRAFT-AND-PUBLISH sync (migration 058): the calendar queues client
 * appointment changes and "Sync Splose" publishes them; a watcher flags
 * changes made inside Splose. Standard staged-rollout resolution — on in
 * development/test, off in staging/production until set to 'true'. Publishing
 * additionally needs ENABLE_SPLOSE_WRITE (enforced in splose-api.js).
 */
function isSploseDraftSyncEnabled() { return resolveFlag('ENABLE_SPLOSE_DRAFT_SYNC'); }

/**
 * Splose AUTO-SYNC: queued calendar changes are written to Splose on their
 * own once the calendar has been quiet for a while (splose-draft-sync.js
 * createAutoSync), instead of only when "Sync Splose" is pressed. Needs the
 * draft sync on. Standard staged-rollout resolution — on in development/test,
 * off in staging/production until set to 'true'.
 */
function isSploseAutoSyncEnabled() { return isSploseDraftSyncEnabled() && resolveFlag('ENABLE_SPLOSE_AUTO_SYNC'); }

/**
 * WHODAS 2.0 digital assessment module.
 *
 * Fails closed in EVERY environment, development included — only the exact
 * string 'true' enables it. This is deliberately the strict pattern rather than
 * resolveFlag(): WHODAS 2.0 is a WHO instrument, and production release is
 * gated on Opal Therapy completing WHO's registration and licensing checklist
 * (docs/whodas/03_LICENSING_COMPLIANCE.md). A forgotten environment variable
 * must never be the reason WHO-copyrighted content becomes reachable.
 */
function isWhodasAssessmentEnabled() {
  return process.env.ENABLE_WHODAS_ASSESSMENT === 'true';
}

/** Sanitised snapshot for diagnostics/boot logs. */
function featureFlagState() {
  return {
    outlookWrite: isOutlookWriteEnabled(),
    sploseWrite: isSploseWriteEnabled(),
    automaticRemoteDelete: isAutomaticRemoteDeleteEnabled(),
    sploseCalendarSync: isSploseCalendarSyncEnabled(),
    sploseDraftSync: isSploseDraftSyncEnabled(),
    sploseAutoSync: isSploseAutoSyncEnabled(),
    whodasAssessment: isWhodasAssessmentEnabled(),
  };
}

/** Error a write function throws when its flag is off. */
function featureDisabledError(flagName, what) {
  const err = new Error(
    `${what} is disabled in this environment (${flagName}=false). ` +
    'This is a staged-rollout control — see deploy/AZURE_DEPLOYMENT.md.'
  );
  err.code = 'FEATURE_DISABLED';
  err.flag = flagName;
  return err;
}

module.exports = {
  isOutlookWriteEnabled,
  isSploseWriteEnabled,
  isAutomaticRemoteDeleteEnabled,
  isSploseCalendarSyncEnabled,
  isSploseDraftSyncEnabled,
  isSploseAutoSyncEnabled,
  isWhodasAssessmentEnabled,
  featureFlagState,
  featureDisabledError,
};
