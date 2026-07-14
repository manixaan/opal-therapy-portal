'use strict';

/**
 * STRUCTURED APPLICATION LOGGER (Phase 8)
 *
 * - JSON lines in production/staging (one object per line for log ingestion);
 *   human-readable lines in development/test.
 * - Correlation: requestContext middleware assigns/propagates X-Request-Id via
 *   AsyncLocalStorage, so every log emitted while handling that request
 *   carries the same requestId without threading it through call sites.
 * - Redaction: keys that look sensitive are masked, and free-text strings are
 *   scrubbed of token-shaped values (Bearer …, JWTs, long hex, secret-bearing
 *   query params). Identifier-based logging: log user IDs, never credentials.
 *
 * NEVER log: passwords/hashes, session ids/cookies, OAuth access or refresh
 * tokens, API keys, DB passwords, client secrets, reset tokens, clinical
 * notes, or full appointment descriptions. The redactor is a backstop —
 * call sites must not pass those values in the first place.
 */

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function currentLevel() {
  const configured = (process.env.LOG_LEVEL || '').toLowerCase();
  if (LEVELS[configured]) return LEVELS[configured];
  return process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug;
}

function jsonMode() {
  const env = process.env.NODE_ENV || 'development';
  return env === 'production' || env === 'staging';
}

// ── Redaction ────────────────────────────────────────────────────────────────

const SENSITIVE_KEY = new RegExp(
  'pass(word)?|secret|token|cookie|authorization|api[-_]?key|credential' +
  '|refresh|access[-_]?token|client[-_]?state|session[-_]?id|connection[-_]?string',
  'i'
);

function scrubString(s) {
  return String(s)
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9._-]{20,}/g, '[REDACTED_JWT]')
    .replace(/\b[a-f0-9]{32,}\b/gi, '[REDACTED_HEX]')
    .replace(
      /([?&](code|token|state|access_token|refresh_token|client_secret|api_key|apikey|password|session)=)[^&\s"']+/gi,
      '$1[REDACTED]'
    );
}

/** Deep-copy `value` masking sensitive keys and scrubbing strings. */
function redact(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return '[depth-limit]';
  if (typeof value === 'string') return scrubString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(v => redact(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

// ── Emission ─────────────────────────────────────────────────────────────────

function emit(level, component, msg, meta) {
  if (LEVELS[level] < currentLevel()) return;

  const store = als.getStore();
  const record = {
    ts: new Date().toISOString(),
    level,
    env: process.env.NODE_ENV || 'development',
    component,
    msg: scrubString(msg),
    ...(store?.requestId ? { requestId: store.requestId } : {}),
    ...(meta ? redact(meta) : {}),
  };

  const line = jsonMode()
    ? JSON.stringify(record)
    : `[${record.ts}] ${level.toUpperCase().padEnd(5)} ${component}: ${record.msg}` +
      (meta ? ' ' + JSON.stringify(redact(meta)) : '') +
      (store?.requestId ? ` (req ${store.requestId.slice(0, 8)})` : '');

  // stdout for info/debug, stderr for warn/error — matches platform collectors.
  (LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout).write(line + '\n');
}

function createLogger(component) {
  return {
    debug: (msg, meta) => emit('debug', component, msg, meta),
    info:  (msg, meta) => emit('info',  component, msg, meta),
    warn:  (msg, meta) => emit('warn',  component, msg, meta),
    error: (msg, meta) => emit('error', component, msg, meta),
  };
}

// ── Express middleware ───────────────────────────────────────────────────────

/**
 * Assigns a correlation id to every request (honouring a well-formed incoming
 * X-Request-Id from the platform load balancer) and exposes it via
 * AsyncLocalStorage + `req.requestId` + the X-Request-Id response header.
 */
function requestContext(req, res, next) {
  const incoming = req.get('x-request-id');
  const requestId =
    incoming && /^[A-Za-z0-9._-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);
  als.run({ requestId }, next);
}

/**
 * One structured line per completed request: method, path (never the query
 * string — OAuth codes and reset tokens travel in query params), status,
 * duration, internal user id. /health and /ready probes are skipped.
 */
function requestLogger(logger) {
  return (req, res, next) => {
    if (req.path === '/health' || req.path === '/ready') return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Math.round(Number(process.hrtime.bigint() - start) / 1e6);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        userId: req.session?.userId || null,
      });
    });
    next();
  };
}

module.exports = { createLogger, redact, scrubString, requestContext, requestLogger, als };
