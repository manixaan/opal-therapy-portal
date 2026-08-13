'use strict';

/**
 * Step 2 of the federation: exchange the Entra token for temporary AWS
 * credentials via STS AssumeRoleWithWebIdentity.
 *
 * WHY THIS IS A PLAIN HTTPS CALL AND NOT AN SDK
 * AssumeRoleWithWebIdentity is the one STS action that is NOT SigV4-signed —
 * it is the bootstrap, so there are no credentials to sign with. The web
 * identity token IS the authentication. That means the whole exchange is a
 * form POST, and pulling in an AWS SDK to make it would add a dependency
 * without adding a control.
 *
 * WHAT NEVER LEAVES THIS MODULE
 * The web identity token goes out in the request body and is never logged. The
 * returned SecretAccessKey and SessionToken are returned to the caller for
 * in-memory use and are never written to disk, never put in an error, and never
 * placed on an object that gets serialised into a log line. Errors carry an STS
 * error *code* only — the message can echo the role ARN and the token subject.
 *
 * There are no static AWS credentials anywhere in this path. If the exchange
 * fails there is nothing to fall back to, which is the intent.
 */

const DEFAULT_TIMEOUT_MS = 8000;
/** AWS caps web-identity sessions at 1 hour unless the role allows more. */
const DEFAULT_DURATION_SECONDS = 3600;

class StsFederationError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'StsFederationError';
    this.reason = reason;
    // TEMPORARY STAGING DIAGNOSTIC — remove with the rest of this patch.
    this.stage = 'sts_exchange';
  }
}

/** Pull a single tag's text out of the STS XML response without an XML parser. */
function tag(xml, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/**
 * @param {object} opts
 * @param {string} opts.roleArn
 * @param {string} opts.webIdentityToken  the Entra JWT
 * @param {string} opts.region            STS regional endpoint to use
 * @param {string} [opts.sessionName]
 * @param {number} [opts.durationSeconds]
 * @param {function} [opts.fetchImpl]
 * @returns {Promise<{accessKeyId, secretAccessKey, sessionToken, expiration: Date}>}
 */
async function assumeRole({
  roleArn, webIdentityToken, region, sessionName = 'opal-portal-staging',
  durationSeconds = DEFAULT_DURATION_SECONDS, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!roleArn) throw new StsFederationError('role_arn_missing');
  if (!webIdentityToken) throw new StsFederationError('web_identity_token_missing');
  if (!region) throw new StsFederationError('region_missing');

  // Regional STS endpoint, not the global one: the Australia-only
  // service-control policy does not permit global routing, and a regional
  // endpoint keeps the exchange in the same jurisdiction as the inference.
  const url = `https://sts.${region}.amazonaws.com/`;

  const form = new URLSearchParams({
    Action: 'AssumeRoleWithWebIdentity',
    Version: '2011-06-15',
    RoleArn: roleArn,
    // Appears in CloudTrail; must not contain anything about a patient.
    RoleSessionName: String(sessionName).replace(/[^\w+=,.@-]/g, '-').slice(0, 64),
    WebIdentityToken: webIdentityToken,
    DurationSeconds: String(durationSeconds),
  });

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new StsFederationError('no_fetch_implementation');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/xml',
      },
      body: form.toString(),
      signal: controller.signal,
    });
  } catch (err) {
    throw new StsFederationError(err && err.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }

  const xml = await res.text().catch(() => '');

  if (!res.ok) {
    // The STS <Code> is safe and genuinely diagnostic — InvalidIdentityToken,
    // AccessDenied, ExpiredTokenException. The <Message> is not: it quotes the
    // role ARN and the token's subject.
    const code = tag(xml, 'Code') || `http_${res.status}`;
    throw new StsFederationError(`sts_${code}`);
  }

  const accessKeyId = tag(xml, 'AccessKeyId');
  const secretAccessKey = tag(xml, 'SecretAccessKey');
  const sessionToken = tag(xml, 'SessionToken');
  const expirationRaw = tag(xml, 'Expiration');

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new StsFederationError('sts_response_incomplete');
  }

  const expiration = expirationRaw ? new Date(expirationRaw) : null;
  if (!expiration || Number.isNaN(expiration.getTime())) {
    // Without a real expiry we cannot refresh safely, and silently assuming an
    // hour would risk using a dead credential mid-request.
    throw new StsFederationError('sts_expiration_unparseable');
  }

  return { accessKeyId, secretAccessKey, sessionToken, expiration };
}

module.exports = { assumeRole, StsFederationError, DEFAULT_DURATION_SECONDS };
