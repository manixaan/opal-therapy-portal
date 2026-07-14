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
 *
 * Resolution: explicit env value ('true'/'false') always wins. When unset:
 * development/test default TRUE (full functionality locally), staging and
 * production default FALSE (fail-safe: a forgotten setting can only make the
 * pilot read-only, never surprise-write into a clinician's calendar).
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

/** Sanitised snapshot for diagnostics/boot logs. */
function featureFlagState() {
  return {
    outlookWrite: isOutlookWriteEnabled(),
    sploseWrite: isSploseWriteEnabled(),
    automaticRemoteDelete: isAutomaticRemoteDeleteEnabled(),
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
  featureFlagState,
  featureDisabledError,
};
