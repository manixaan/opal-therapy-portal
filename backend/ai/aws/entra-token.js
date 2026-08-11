'use strict';

/**
 * Step 1 of the federation: an Entra access token from the App Service
 * managed identity.
 *
 * App Service injects IDENTITY_ENDPOINT and IDENTITY_HEADER into the process.
 * The endpoint is loopback and the header is the only thing that authorises the
 * call, so no secret of ours is involved and nothing is stored anywhere.
 *
 * The `resource` is the Entra application's Application ID URI
 * (AZURE_BEDROCK_AUDIENCE). That value becomes the `aud` claim of the issued
 * JWT, and AWS's OIDC provider matches it against the role trust policy's
 * audience condition. Get it wrong and STS refuses — which is the correct
 * outcome, not something to paper over.
 *
 * THE TOKEN IS NEVER LOGGED, NEVER RETURNED IN AN ERROR, NEVER PERSISTED.
 * It is a bearer credential for an identity that can reach clinical
 * infrastructure. Errors carry a status code and nothing else.
 *
 * `fetchImpl` is injectable so the unit tests exercise every branch without a
 * network and without pretending to be App Service.
 */

const API_VERSION = '2019-08-01';
const DEFAULT_TIMEOUT_MS = 8000;

class EntraTokenError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'EntraTokenError';
    this.reason = reason;
  }
}

/**
 * @param {object} opts
 * @param {string} opts.audience    Application ID URI, becomes the `aud` claim
 * @param {function} [opts.fetchImpl]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<{token: string, expiresOnSeconds: number|null}>}
 */
async function acquire({ audience, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!audience) throw new EntraTokenError('audience_missing');

  const endpoint = process.env.IDENTITY_ENDPOINT;
  const header = process.env.IDENTITY_HEADER;
  if (!endpoint || !header) {
    // A laptop, or an App Service with managed identity switched off. Either
    // way there is no identity to federate and the caller must not continue.
    throw new EntraTokenError('managed_identity_unavailable');
  }

  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}`
    + `api-version=${API_VERSION}&resource=${encodeURIComponent(audience)}`;

  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') throw new EntraTokenError('no_fetch_implementation');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(url, {
      method: 'GET',
      headers: { 'X-IDENTITY-HEADER': header },
      signal: controller.signal,
    });
  } catch (err) {
    // Never include err.message: a fetch error can echo the URL, and the URL
    // carries the audience.
    throw new EntraTokenError(err && err.name === 'AbortError' ? 'timeout' : 'network_error');
  } finally {
    clearTimeout(timer);
  }

  if (!res || !res.ok) {
    // Status only. A 400 body from IMDS repeats the resource parameter.
    throw new EntraTokenError(`identity_endpoint_status_${(res && res.status) || 'unknown'}`);
  }

  let body;
  try {
    body = await res.json();
  } catch (_) {
    throw new EntraTokenError('identity_endpoint_malformed_response');
  }

  const token = body && body.access_token;
  if (typeof token !== 'string' || !token) throw new EntraTokenError('token_missing_from_response');

  // expires_on is documented as seconds-since-epoch, but has historically been
  // returned as a string and occasionally as a date. Parse defensively and fall
  // back to null — the credential layer treats an unknown expiry as "short".
  let expiresOnSeconds = null;
  const raw = body.expires_on;
  if (raw != null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) expiresOnSeconds = Math.floor(n);
    else {
      const parsed = Date.parse(String(raw));
      if (Number.isFinite(parsed)) expiresOnSeconds = Math.floor(parsed / 1000);
    }
  }

  return { token, expiresOnSeconds };
}

module.exports = { acquire, EntraTokenError, API_VERSION };
