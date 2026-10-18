'use strict';

/**
 * REQUEST SAFETY HELPERS — small, pure, unit-tested.
 *
 *   normaliseClientIp(ip)        the key the rate limiters use for a client
 *   createIpRateLimiter(opts)    in-memory per-IP limiter (Express middleware)
 *   createFailureTracker(opts)   in-memory per-key failure backoff (e.g. per account)
 *   safeReturnPath(path)         a same-origin, relative redirect target or '/'
 *
 * In-memory by design, like the login limiter that preceded it: counters reset
 * on restart and are per instance. That is acceptable at this deployment's
 * size and adds no dependency; the per-account tracker is what stops a
 * distributed guesser that the per-IP limiter alone could not.
 */

/**
 * The client address a rate limiter should key on.
 *
 * Azure App Service forwards `X-Forwarded-For: <ip>:<port>`, and with
 * `trust proxy` Express hands that through as req.ip — so every new TCP
 * connection looked like a new client and the login limiter never tripped
 * (audit M-3). Handles:
 *   203.0.113.5:51001       → 203.0.113.5
 *   [2001:db8::1]:443       → 2001:db8::1
 *   ::ffff:203.0.113.5      → 203.0.113.5   (IPv4-mapped IPv6)
 *   2001:DB8::1             → 2001:db8::1   (bare IPv6 is left whole — its
 *                                            colons are not a port)
 *   '', null                → 'unknown'
 */
function normaliseClientIp(ip) {
  let s = String(ip == null ? '' : ip).trim();
  if (!s) return 'unknown';
  // A forwarded list that reached us unparsed: the left-most is the client.
  if (s.includes(',')) s = s.split(',')[0].trim();

  // [IPv6]:port or [IPv6]
  const bracketed = s.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) s = bracketed[1];

  // IPv4:port — exactly one colon and a dotted quad before it.
  const v4port = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (v4port) s = v4port[1];

  // IPv4-mapped IPv6.
  const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) s = mapped[1];

  // Strip an IPv6 zone id (fe80::1%eth0).
  if (s.includes(':')) s = s.split('%')[0];

  return s.toLowerCase() || 'unknown';
}

function clientIpOf(req) {
  return normaliseClientIp(req && (req.ip || (req.connection && req.connection.remoteAddress)));
}

/**
 * A per-IP limiter: at most `max` requests per `windowMs`; the request after
 * that gets a 429 with `message` and Retry-After.
 */
function createIpRateLimiter({ windowMs, max, message }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
  }, Math.min(windowMs, 10 * 60 * 1000));
  if (timer.unref) timer.unref();

  function middleware(req, res, next) {
    const key = clientIpOf(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfterSec));
      const text = typeof message === 'function' ? message(retryAfterSec) : message;
      return res.status(429).json({ error: text });
    }
    return next();
  }
  middleware.reset = () => hits.clear();
  return middleware;
}

/**
 * Counts failures per key (a lower-cased email for login) inside a window.
 * isLocked(key) is true once `max` failures have been recorded in the
 * current window. Keyed on what the CALLER submitted, so an unknown email
 * locks exactly like a real one and nothing reveals which exists.
 */
function createFailureTracker({ windowMs, max }) {
  const entries = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
  }, Math.min(windowMs, 10 * 60 * 1000));
  if (timer.unref) timer.unref();

  const norm = (key) => String(key || '').trim().toLowerCase();
  function live(key) {
    const entry = entries.get(norm(key));
    if (!entry) return null;
    if (entry.resetAt <= Date.now()) { entries.delete(norm(key)); return null; }
    return entry;
  }
  return {
    isLocked(key) {
      const entry = live(key);
      return !!entry && entry.count >= max;
    },
    retryAfterSec(key) {
      const entry = live(key);
      return entry ? Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) : 0;
    },
    recordFailure(key) {
      const k = norm(key);
      if (!k) return;
      let entry = live(k);
      if (!entry) { entry = { count: 0, resetAt: Date.now() + windowMs }; entries.set(k, entry); }
      entry.count += 1;
    },
    clear(key) { entries.delete(norm(key)); },
    reset() { entries.clear(); },
  };
}

/**
 * A redirect target that can only ever land back on this app (audit L-10).
 * Accepts a relative path ("/x?y#z"); refuses protocol-relative ("//host"),
 * backslashes ("/\host", which browsers treat as "//host"), control
 * characters, and anything whose resolved origin is not the app's own.
 */
function safeReturnPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return '/';
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return '/';
  const BASE = 'http://opal-app.invalid';
  let url;
  try { url = new URL(value, BASE); } catch (_) { return '/'; }
  if (url.origin !== BASE) return '/';
  return `${url.pathname}${url.search}${url.hash}` || '/';
}

module.exports = {
  normaliseClientIp,
  clientIpOf,
  createIpRateLimiter,
  createFailureTracker,
  safeReturnPath,
};
