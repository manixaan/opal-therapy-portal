'use strict';

/**
 * The two federation steps, composed and cached.
 *
 * Managed identity → Entra JWT → STS AssumeRoleWithWebIdentity → temporary AWS
 * credentials. Held in a module-local variable and nowhere else: not on disk,
 * not in the database, not in an environment variable, not on any object that
 * is logged or serialised.
 *
 * REFRESH BEFORE EXPIRY, NOT ON FAILURE
 * Credentials are renewed once they are within REFRESH_MARGIN_MS of expiring.
 * Waiting for a 403 and retrying would mean a clinical request occasionally
 * pays for a failed round trip, and would make expiry indistinguishable from a
 * genuine permission problem.
 *
 * ONE EXCHANGE AT A TIME
 * Concurrent callers share a single in-flight promise. Without that, a burst of
 * requests after a cold start would each start their own AssumeRole and STS
 * would throttle the lot.
 *
 * FAIL CLOSED
 * Any failure clears the cache and rejects. There is no static-credential
 * fallback and no environment-variable escape hatch: if federation is broken,
 * the feature is unavailable, which is the correct outcome for a clinical
 * system reaching a model.
 */

const entra = require('./entra-token');
const sts = require('./sts-web-identity');
const config = require('./bedrock-config');

/** Renew this long before expiry. AWS issues one-hour sessions. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let _cached = null;      // { accessKeyId, secretAccessKey, sessionToken, expiration }
let _inFlight = null;    // Promise, so concurrent callers share one exchange

function isFresh(creds, now) {
  return !!creds
    && creds.expiration instanceof Date
    && creds.expiration.getTime() - now > REFRESH_MARGIN_MS;
}

class CredentialError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'CredentialError';
    this.reason = reason;
  }
}

async function exchange({ fetchImpl } = {}) {
  const resolved = config.resolve();
  if (!resolved.ok) throw new CredentialError(resolved.reason);
  const cfg = resolved.config;

  const { token } = await entra.acquire({ audience: cfg.audience, fetchImpl });
  const creds = await sts.assumeRole({
    roleArn: cfg.roleArn,
    webIdentityToken: token,
    region: cfg.region,
    sessionName: cfg.sessionName,
    fetchImpl,
  });
  return creds;
}

/**
 * Temporary credentials, from cache when fresh.
 *
 * @param {object} [opts]
 * @param {function} [opts.fetchImpl]  injected in tests
 * @param {number}   [opts.now]        injected clock, ms
 * @returns {Promise<{accessKeyId, secretAccessKey, sessionToken, expiration}>}
 */
async function getCredentials({ fetchImpl, now = Date.now() } = {}) {
  if (isFresh(_cached, now)) return _cached;
  if (_inFlight) return _inFlight;

  _inFlight = exchange({ fetchImpl })
    .then((creds) => {
      _cached = creds;
      return creds;
    })
    .catch((err) => {
      // Never serve a stale credential after a failed refresh.
      _cached = null;
      const reason = (err && err.reason) || 'credential_exchange_failed';
      const wrapped = new CredentialError(reason);
      // TEMPORARY STAGING DIAGNOSTIC — remove with the rest of this patch.
      // Re-wrapping here previously erased which federation step failed, so
      // an Entra fault and an STS fault arrived at the provider identical.
      if (err && typeof err.stage === 'string') wrapped.stage = err.stage;
      throw wrapped;
    })
    .finally(() => {
      _inFlight = null;
    });

  return _inFlight;
}

/**
 * Seconds until the cached credential expires, or null when there is none.
 * For the health endpoint — a number, never the credential itself.
 */
function cacheStatus(now = Date.now()) {
  if (!_cached) return { cached: false, secondsRemaining: null };
  return {
    cached: true,
    secondsRemaining: Math.max(0, Math.floor((_cached.expiration.getTime() - now) / 1000)),
  };
}

function _resetForTests() {
  _cached = null;
  _inFlight = null;
}

module.exports = {
  getCredentials,
  cacheStatus,
  CredentialError,
  REFRESH_MARGIN_MS,
  _resetForTests,
};
