'use strict';

/**
 * AI KILL SWITCH — stop every AI call immediately, without a deploy.
 *
 * For a clinical system the ability to halt AI in seconds matters more than
 * it does elsewhere: a model behaving badly, a provider incident, a privacy
 * concern raised by a therapist, or an AWS problem should not require a code
 * push and a release window to contain.
 *
 * Two independent mechanisms, either sufficient to disable:
 *
 *   1. `system_settings.ai_global_enabled = 'false'` — instant, operator
 *      controlled, no redeploy. The normal path.
 *   2. `AI_GLOBAL_DISABLE=true` — works even if the database is unreachable,
 *      which is precisely when you might most want to stop things.
 *
 * ── THE FAILURE-MODE DECISION ─────────────────────────────────────────────
 * On a database read error the last known value is retained. If the setting
 * has never been read successfully, AI is treated as ENABLED.
 *
 * That is deliberate and worth understanding. Failing closed here would mean
 * a brief database hiccup halts clinical documentation mid-clinic — and the
 * call is already gated by a per-feature flag and by gateway policy, so the
 * kill switch is a fourth control rather than the only one. The residual
 * risk is narrow: an operator disables AI during an incident AND the setting
 * has never once been read since boot. Against that, the env-var mechanism
 * needs no database at all.
 *
 * Cached briefly so an incident response takes effect quickly without a
 * database read on every generation.
 */

const CACHE_TTL_MS = 15000;
const SETTING_KEY = 'ai_global_enabled';

/**
 * `_lastKnown` and freshness are tracked separately on purpose. Expiring the
 * cache must force a re-read WITHOUT discarding the last value we actually
 * saw — otherwise an operator disables AI, the cache expires, the next
 * database read fails, and the switch silently flips back to enabled. Last
 * known survives until a successful read replaces it.
 */
let _lastKnown = null;        // null = never successfully read
let _cachedAt = 0;
let _readSeq = 0;             // incremented when a read starts
let _acceptedSeq = 0;         // the newest read whose result we accepted
let _invalidReported = null;  // last unparseable value already reported
let _readerOverride = null;

/**
 * Env kill switch — checked first, needs nothing external.
 *
 * Polarity is deliberately fail-safe: for a variable named *_DISABLE, ANY set
 * value disables unless it is explicitly negative. Matching only 'true' would
 * mean `AI_GLOBAL_DISABLE=1` — or `yes`, or `on` — left AI running while the
 * operator believed it was stopped.
 */
function envDisabled() {
  const raw = String(process.env.AI_GLOBAL_DISABLE || '').trim().toLowerCase();
  if (raw === '') return false;
  return !['false', '0', 'no', 'off'].includes(raw);
}

/**
 * Returns the raw value, plus who changed it and why if they recorded that in
 * the same UPDATE. The reason is the part nobody writes down at the time and
 * everybody wants six months later.
 */
async function readSetting() {
  if (_readerOverride) {
    const raw = await _readerOverride();
    return raw && typeof raw === 'object' ? raw : { value: raw, updatedBy: null, reason: null };
  }
  // Lazily required so policy evaluation does not drag in pg. Uses the pool
  // directly rather than adding a helper to the large, shared database.js.
  // eslint-disable-next-line global-require
  const db = require('../database');
  const { rows } = await db.pool.query(
    'SELECT value, reason, updated_by FROM system_settings WHERE key = $1', [SETTING_KEY]
  );
  if (!rows.length) return { value: null, updatedBy: null, reason: null };
  return { value: rows[0].value, updatedBy: rows[0].updated_by, reason: rows[0].reason };
}

/**
 * The ONLY two values the switch accepts. Exact match — no trimming, no case
 * folding, no synonyms.
 *
 * Being permissive here was the bug. Accepting 'enabled' as a second spelling
 * for on, and quietly treating everything else as off, meant a misconfiguration
 * was *interpreted* rather than surfaced. During an incident that is the wrong
 * behaviour twice over: the operator who typed 'OFF' gets no signal that the
 * system did not understand them, and the operator who typed 'true ' gets AI
 * disabled with no explanation.
 *
 * Strict parsing plus a fail-closed default plus a security event gives all
 * three properties at once: safe, visible, and diagnosable.
 */
const VALID_VALUES = Object.freeze({ true: true, false: false });

/**
 * @returns {{missing: true}|{ok: true, enabled: boolean}|{ok: false}}
 */
function parseSwitchValue(raw) {
  if (raw === null || raw === undefined) return { missing: true };
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(VALID_VALUES, raw)) {
    return { ok: true, enabled: VALID_VALUES[raw] };
  }
  return { ok: false };
}

/**
 * Report an unparseable value once, not once per cache expiry.
 *
 * Without this the switch would emit a security event every 15 seconds for as
 * long as the bad value sat in the table, burying the events that matter under
 * the one that is already understood.
 */
function noteInvalidValue(rawValue, meta) {
  const fingerprint = String(rawValue);
  if (_invalidReported === fingerprint) return;
  _invalidReported = fingerprint;

  console.warn(`[ai-kill-switch] ${SETTING_KEY} holds an unrecognised value — AI DISABLED (fail closed)`);

  // eslint-disable-next-line global-require
  const audit = require('./ai-audit');
  audit.securityEvent({
    eventType: 'invalid_kill_switch_value',
    actorUserId: meta.updatedBy || null,
    previousState: _lastKnown === null ? null : (_lastKnown ? 'enabled' : 'disabled'),
    newState: 'disabled',
    reason: meta.reason || 'invalid_kill_switch_value',
    // The offending value, so an operator can see what they actually typed.
    // This is a configuration string, never clinical content.
    detail: `${SETTING_KEY} = ${JSON.stringify(fingerprint).slice(0, 120)} (expected "true" or "false")`,
  }).catch(() => {});
}

/**
 * Emit a break-glass record when the switch actually changes state.
 *
 * Only a genuine transition counts — the first successful read is
 * initialisation, not somebody flipping a switch. Best effort and never
 * awaited into the caller's path: recording why AI stopped must not be able
 * to stop anything itself.
 */
function noteTransition(previous, next, meta) {
  if (previous === null || previous === next) return;
  // eslint-disable-next-line global-require
  const audit = require('./ai-audit');
  audit.securityEvent({
    eventType: next ? 'ai_enabled' : 'ai_disabled',
    actorUserId: meta.updatedBy || null,
    previousState: previous ? 'enabled' : 'disabled',
    newState: next ? 'enabled' : 'disabled',
    reason: meta.reason || null,
    detail: `via ${SETTING_KEY}`,
  }).catch(() => {});
}

/**
 * Whether AI is globally permitted right now.
 * Never throws — a kill switch that can crash the caller is not a safety
 * control.
 */
async function isGloballyEnabled() {
  if (envDisabled()) return false;

  const fresh = Date.now() - _cachedAt < CACHE_TTL_MS;
  if (fresh && _lastKnown !== null) return _lastKnown;

  // Sequence guard: two reads can be in flight at once, and without this the
  // slower one wins. A read that STARTED before the switch was pulled could
  // land after the read that saw it and re-enable AI for a whole TTL.
  const seq = ++_readSeq;

  try {
    const setting = await readSetting();
    if (seq < _acceptedSeq) return _lastKnown === null ? true : _lastKnown;
    _acceptedSeq = seq;

    const previous = _lastKnown;
    const parsed = parseSwitchValue(setting.value);

    if (parsed.missing) {
      // No row (pre-migration, fresh database, or one somebody deleted). If we
      // have already observed the switch disabled, a vanished row must not
      // resurrect AI — that would be the same silent recovery the failure path
      // below exists to prevent. Otherwise treat as enabled; the per-feature
      // flags are off by default anyway.
      _lastKnown = _lastKnown === false ? false : true;
      _invalidReported = null;
    } else if (!parsed.ok) {
      // FAIL CLOSED, LOUDLY. Nobody types carefully during an incident, and
      // 'OFF' meaning "still running" is how a contained problem becomes an
      // uncontained one.
      _lastKnown = false;
      noteInvalidValue(setting.value, setting);
    } else {
      _lastKnown = parsed.enabled;
      _invalidReported = null;
    }
    _cachedAt = Date.now();
    noteTransition(previous, _lastKnown, setting);
    return _lastKnown;
  } catch (err) {
    console.warn(`[ai-kill-switch] could not read ${SETTING_KEY} (reason: ${err?.message || 'unknown'}) — using last known value`);
    // If we ever saw 'disabled', it STAYS disabled. Only a never-read switch
    // defaults to enabled.
    return _lastKnown === null ? true : _lastKnown;
  }
}

/**
 * Expire the cache so the next call re-reads. Deliberately does NOT clear the
 * last known value — see the note above.
 */
function invalidate() {
  _cachedAt = 0;
}

/** Full reset, including last known. For test isolation only. */
function _setReaderForTests(fn) {
  _readerOverride = typeof fn === 'function' ? fn : null;
  _lastKnown = null;
  _cachedAt = 0;
  _readSeq = 0;
  _acceptedSeq = 0;
  _invalidReported = null;
}

module.exports = {
  SETTING_KEY,
  VALID_VALUES,
  parseSwitchValue,
  isGloballyEnabled,
  invalidate,
  envDisabled,
  _setReaderForTests,
};
