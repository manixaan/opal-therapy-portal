/**
 * LOCAL AUTHENTICATION ROUTES
 *
 * Handles email/password login that is separate from the Microsoft OAuth flow.
 * The Microsoft OAuth integration (for Outlook/Graph sync) remains unchanged
 * in routes.js — it now links an existing local account rather than creating
 * a new one.
 *
 * Routes:
 *   POST /api/auth/login   — verify email + password, create session
 *   POST /api/auth/logout  — destroy session
 *   GET  /api/auth/me      — return safe current-user profile
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();

const db      = require('./database');
const emailSvc = require('./email');
const { getPermissions } = require('./permissions');
const accounts = require('./onboarding-accounts');

// ─────────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Generate a cryptographically random URL-safe token. */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function validatePassword(password) {
  if (!password || password.length < 8)   return 'Password must be at least 8 characters';
  if (!/[A-Z]/.test(password))            return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password))            return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password))            return 'Password must contain at least one number';
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Login rate limiters — 10 attempts per IP per 15 minutes, and 10 FAILED
//  attempts per submitted email per 15 minutes.
//
//  In-memory (request-safety.js) to avoid an extra dependency. Resets on
//  server restart and is per instance (acceptable for this deployment size —
//  the window is short enough that a restart-based bypass provides no
//  meaningful advantage).
// ─────────────────────────────────────────────────────────────────────────────

const LOGIN_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 10;
const ACCOUNT_MAX_FAILURES = 10;           // per submitted email, same window

const { createIpRateLimiter, createFailureTracker } = require('./request-safety');

const tooManyAttempts = (retryAfterSec) =>
  `Too many login attempts. Please try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`;

// Per-IP — keyed on the NORMALISED client address (request-safety.js), so an
// Azure "ip:port" forwarded value no longer makes every connection a new key.
const loginRateLimit = createIpRateLimiter({
  windowMs: LOGIN_WINDOW_MS, max: LOGIN_MAX_ATTEMPTS, message: tooManyAttempts,
});

// Per-account — failures against one submitted email, from anywhere. Stops a
// guesser spread across many addresses (audit M-3). Keyed on what was typed,
// so an unknown email locks exactly like a real one: nothing here reveals
// whether an account exists.
const accountFailures = createFailureTracker({ windowMs: LOGIN_WINDOW_MS, max: ACCOUNT_MAX_FAILURES });

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;

  // Basic input validation — generic messages to avoid user enumeration
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const accountKey = String(email).trim().toLowerCase();
  if (accountFailures.isLocked(accountKey)) {
    const retryAfterSec = accountFailures.retryAfterSec(accountKey);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({ error: tooManyAttempts(retryAfterSec) });
  }

  try {
    const user = await db.getUserByEmail(accountKey);

    // Use a constant-time comparison even when user doesn't exist to prevent
    // timing-based email enumeration attacks.
    const DUMMY_HASH = '$2a$12$invalidhashusedfortimingprotectiononly000000000000000';
    const hashToCompare = user ? (user.password_hash || DUMMY_HASH) : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatch) {
      accountFailures.recordFailure(accountKey);
      // Log failed attempt (best-effort — don't let logging failure break login)
      try {
        await db.logAuditEvent({
          actorUserId:    user ? user.id : null,
          action:         'login_failed',
          targetType:     'user',
          targetId:       email,
          metadata:       { reason: user ? 'wrong_password' : 'user_not_found' },
          ipAddress:      req.ip,
          organisationId: user?.organisation_id || null,
        });
      } catch (_) {}

      // Always return the same generic error
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    accountFailures.clear(accountKey); // the correct password ends the backoff

    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is inactive. Please contact your administrator.' });
    }

    // ── Account status checks ─────────────────────────────────────────────
    const status = user.account_status || 'active';
    if (status === 'pending_verification') {
      return res.status(403).json({
        error: 'Please verify your email address before signing in. Check your inbox for a verification link.',
        code:  'pending_verification',
      });
    }
    if (status === 'pending_approval') {
      return res.status(403).json({
        error: 'Your account is awaiting approval by a practice administrator.',
        code:  'pending_approval',
      });
    }
    if (status === 'suspended') {
      return res.status(403).json({
        error: 'Your account has been suspended. Please contact the practice owner.',
        code:  'suspended',
      });
    }
    if (status === 'deactivated') {
      return res.status(403).json({
        error: 'This account has been deactivated.',
        code:  'deactivated',
      });
    }

    // ── Temporary credential expiry ───────────────────────────────────────
    // Checked HERE rather than in requireAuth, so an unused temporary password
    // simply stops working instead of granting a session that is then refused
    // on every subsequent request. Fails closed: an expired credential is
    // never a way in, and the remedy names itself.
    //
    // Only ever true while password_is_temporary is set — a password somebody
    // chose for themselves does not expire, and this portal does not do forced
    // rotation.
    if (accounts.temporaryPasswordExpired(user)) {
      try {
        await db.logAuditEvent({
          actorUserId:    user.id,
          action:         'login_failed',
          targetType:     'user',
          targetId:       user.id,
          metadata:       { reason: 'temporary_password_expired' },
          ipAddress:      req.ip,
          organisationId: user.organisation_id || null,
        });
      } catch (_) {}
      return res.status(403).json({
        error: 'That temporary password has expired. Please ask the practice for a new one.',
        code:  'temporary_password_expired',
      });
    }

    // Regenerate session to prevent session fixation
    req.session.regenerate(async (err) => {
      if (err) {
        console.error('Session regeneration error:', err);
        return res.status(500).json({ error: 'Login failed — please try again' });
      }

      req.session.userId = user.id;

      // Record last login (best-effort)
      try { await db.recordLogin(user.id); } catch (_) {}

      // Audit log
      try {
        await db.logAuditEvent({
          actorUserId:    user.id,
          action:         'login_success',
          targetType:     'user',
          targetId:       user.id,
          ipAddress:      req.ip,
          organisationId: user.organisation_id,
        });
      } catch (_) {}

      const permissions = getPermissions(user.role, user.permissions || []);
      console.log(`🔐 Login: ${user.email} (${user.role})`);

      res.json({
        ok: true,
        user: safeProfile(user, permissions),
        // Surfaced at the top level as well as on the profile, because the
        // login screen acts on it before it has done anything with the user
        // object.
        mustChangePassword: user.must_change_password === true,
        next: user.must_change_password === true ? 'change_password' : 'portal',
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed — please try again' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/logout
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/auth/logout', (req, res) => {
  const userId = req.session?.userId;

  req.session.destroy((err) => {
    if (err) {
      console.error('Session destroy error:', err);
      return res.status(500).json({ error: 'Logout failed' });
    }

    // Clear the session cookie
    res.clearCookie('connect.sid', { path: '/' });

    if (userId) {
      db.logAuditEvent({
        actorUserId: userId,
        action:      'logout',
        targetType:  'user',
        targetId:    userId,
        ipAddress:   req.ip,
      }).catch(() => {});
    }

    console.log(`🔓 Logout: user ${userId || 'unknown'}`);
    res.json({ ok: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/sign-out-all
//  Deletes every session row for the current user, then destroys the current
//  session. Client is redirected to /login (or returned { ok: true } for JSON).
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/auth/sign-out-all', async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Delete every session whose payload contains this userId.
    // PgSessionStore stores sessions as JSONB with a top-level "userId" key.
    await db.pool.query(
      `DELETE FROM sessions WHERE sess->>'userId' = $1`,
      [userId]
    );
  } catch (err) {
    console.error('sign-out-all DB error:', err.message);
    // Even if the bulk delete fails, fall through and destroy the current session
  }

  // Audit log (best-effort)
  try {
    await db.logAuditEvent({
      actorUserId: userId,
      action:      'sign_out_all',
      targetType:  'user',
      targetId:    userId,
      ipAddress:   req.ip,
    });
  } catch (_) {}

  // Destroy the in-process session object (already gone from DB, but cleans memory)
  req.session.destroy(() => {});
  res.clearCookie('connect.sid', { path: '/' });
  console.log(`🔒 Sign-out-all: user ${userId}`);
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/auth/me
// ─────────────────────────────────────────────────────────────────────────────

router.get('/api/auth/me', async (req, res) => {
  // WHO IS SIGNED IN MUST NEVER BE SERVED FROM CACHE.
  //
  // Express adds an ETag to every JSON response, and without Cache-Control the
  // browser applies heuristic freshness — so after a user switch it can render
  // the PREVIOUS person's name, role and permissions from disk cache without
  // revalidating. Found while testing onboarding activation: an employee whose
  // role had just changed from pre_employee to therapist kept the pre-employee
  // shell (one tab, no calendar) until the cache expired, and on a shared
  // machine one person's identity could appear in another's session.
  //
  // The frontend's entire role-gating layer is built from this response, so it
  // is exactly the response that must always come from the server.
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');

  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await db.getUser(req.session.userId);
    if (!user || !user.is_active) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Session expired or account inactive' });
    }

    const permissions = getPermissions(user.role, user.permissions || []);
    res.json(safeProfile(user, permissions));
  } catch (err) {
    console.error('/api/auth/me error:', err);
    res.status(500).json({ error: 'Failed to fetch user profile' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  Helper: build safe user profile (never includes password_hash or raw tokens)
// ─────────────────────────────────────────────────────────────────────────────

function safeProfile(user, permissions) {
  return {
    id:                    user.id,
    name:                  user.name   || user.email.split('@')[0],
    email:                 user.email,
    role:                  user.role   || 'therapist',
    organisationId:        user.organisation_id || null,
    isActive:              user.is_active !== false,
    accountStatus:         user.account_status || 'active',
    emailVerified:         !!user.email_verified,
    isTreatingTherapist:   !!user.is_treating_therapist,
    therapistProfileId:    user.therapist_profile_id || null,
    therapistProfile:      user.therapistProfile || null,
    canViewMasterCalendar: ['owner', 'admin'].includes(user.role || 'therapist'),
    hasOutlookConnected:   !!user.access_token,
    profileCompleted:      !!user.profile_completed,
    onboardingStep:        user.onboarding_step || 'profile',
    displayName:           user.display_name   || null,
    phone:                 user.phone          || null,
    roleTitle:             user.role_title     || null,
    defaultWorkLocation:   user.default_work_location || null,
    // The portal shell reads this to send a first-time user straight to
    // "Create your password". It is a CONVENIENCE, not the control: the
    // control is the choke point in requireAuth, which refuses every other
    // path regardless of what any client does with this field.
    mustChangePassword:    user.must_change_password === true,
    passwordIsTemporary:   user.password_is_temporary === true,
    permissions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/auth/verify-email?token=…
//  Called when user clicks the verification link in their email.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Was this account created through an owner's invite? True only when an
 * invite for the same email and organisation was ACCEPTED at the moment the
 * account was created — registerUserFromInvite creates the user and accepts
 * the invite in one transaction. The time match keeps an old accepted invite
 * from activating a later self-registration with the same email. Fail-closed:
 * anything unexpected (or an error) answers false → pending_approval.
 */
async function registeredThroughInvite(user) {
  if (!user || !user.id) return false;
  try {
    // Compared in SQL, against the stored row, so no timezone round trip.
    const { rows } = await db.pool.query(
      `SELECT 1
         FROM users u
         JOIN user_invites i
           ON LOWER(i.email) = LOWER(u.email)
          AND i.organisation_id IS NOT DISTINCT FROM u.organisation_id
        WHERE u.id = $1
          AND i.status = 'accepted'
          AND i.accepted_at IS NOT NULL
          AND ABS(EXTRACT(EPOCH FROM (i.accepted_at - u.created_at))) <= 120
        LIMIT 1`,
      [user.id]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('verify-email invite check failed (defaulting to approval):', err.message);
    return false;
  }
}

router.get('/api/auth/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Verification token is required', code: 'missing_token' });

  try {
    const { rows } = await db.pool.query(
      `SELECT id, email, name, display_name, role, email_verified, account_status,
              email_verification_token, email_verification_expires_at
         FROM users
        WHERE email_verification_token = $1`,
      [token]
    );
    const user = rows[0];

    if (!user) return res.status(400).json({ error: 'Invalid or expired verification link.', code: 'invalid_token' });
    if (user.email_verified) return res.json({ ok: true, alreadyVerified: true, code: 'already_verified' });
    if (user.email_verification_expires_at && new Date(user.email_verification_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This verification link has expired. Please request a new one.', code: 'expired' });
    }

    // Next status: an account created through an owner's invite is already
    // approved — verifying the email activates it. A self-registration
    // (allowlist) waits for the owner: pending_approval. Previously every
    // account went to pending_approval, so invitees had to be approved twice.
    let newStatus = user.account_status;
    if (user.account_status === 'pending_verification') {
      newStatus = (await registeredThroughInvite(user)) ? 'active' : 'pending_approval';
    }

    await db.pool.query(
      `UPDATE users
          SET email_verified               = TRUE,
              email_verification_token     = NULL,
              email_verification_expires_at = NULL,
              account_status               = $1,
              updated_at                   = NOW()
        WHERE id = $2`,
      [newStatus, user.id]
    );

    await db.logAuditEvent({
      actorUserId: user.id, action: 'email_verified',
      targetType: 'user', targetId: user.id, ipAddress: req.ip,
    }).catch(() => {});

    res.json({ ok: true, newStatus, code: 'verified' });
  } catch (err) {
    console.error('GET verify-email error:', err);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/resend-verification
//  Resend the email verification link. Rate-limited to once per 2 minutes.
// ─────────────────────────────────────────────────────────────────────────────

const _resendCooldowns = new Map(); // email → lastSentAt ms
const RESEND_COOLDOWN_MS = 2 * 60 * 1000;

router.post('/api/auth/resend-verification', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const norm = email.trim().toLowerCase();

  // Rate limit
  const last = _resendCooldowns.get(norm) || 0;
  if (Date.now() - last < RESEND_COOLDOWN_MS) {
    return res.status(429).json({ error: 'Please wait a moment before requesting another verification email.' });
  }

  try {
    const { rows } = await db.pool.query(
      `SELECT id, email, name, display_name, email_verified, account_status FROM users WHERE LOWER(email) = $1`,
      [norm]
    );
    const user = rows[0];

    // Generic response to prevent enumeration
    if (!user || user.email_verified || user.account_status !== 'pending_verification') {
      return res.json({ ok: true }); // silent no-op
    }

    const token   = generateToken();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.pool.query(
      `UPDATE users SET email_verification_token = $1, email_verification_expires_at = $2,
              email_verification_sent_at = NOW(), updated_at = NOW() WHERE id = $3`,
      [token, expires, user.id]
    );

    await emailSvc.sendVerificationEmail({
      toEmail: user.email,
      token,
      name: user.display_name || user.name,
    }).catch(e => console.error('resend-verification email error:', e.message));

    _resendCooldowns.set(norm, Date.now());
    res.json({ ok: true });
  } catch (err) {
    console.error('POST resend-verification error:', err);
    res.status(500).json({ error: 'Failed to resend verification email.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/forgot-password
//  Accepts email, sends a reset link if the account exists and is active
//  (or verified and pending approval).
//  Always returns the same response to avoid email enumeration.
// ─────────────────────────────────────────────────────────────────────────────

const _resetRateLimit = new Map(); // email → lastSentAt ms
const RESET_COOLDOWN_MS = 3 * 60 * 1000;

router.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required' });

  const norm = email.trim().toLowerCase();

  // Rate limit per email
  const last = _resetRateLimit.get(norm) || 0;
  if (Date.now() - last < RESET_COOLDOWN_MS) {
    return res.json({ ok: true }); // silent — don't reveal timing
  }

  try {
    const { rows } = await db.pool.query(
      `SELECT id, email, name, display_name, account_status, email_verified FROM users WHERE LOWER(email) = $1`,
      [norm]
    );
    const user = rows[0];

    // Send to any ACTIVE account, verified or not (audit M-7): owner-approved
    // and onboarding-provisioned accounts are active with email_verified =
    // FALSE, and used to be silently refused a reset — a dead end once a
    // temporary password expired. Receiving the link is itself proof of the
    // mailbox. A pending_approval account still has to have verified first.
    const eligible = user && (
      user.account_status === 'active'
      || (user.account_status === 'pending_approval' && user.email_verified)
    );
    if (eligible) {
      const token   = generateToken();
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      await db.pool.query(
        `UPDATE users SET password_reset_token = $1, password_reset_expires_at = $2, updated_at = NOW() WHERE id = $3`,
        [token, expires, user.id]
      );

      await emailSvc.sendPasswordResetEmail({
        toEmail: user.email,
        token,
        name: user.display_name || user.name,
      }).catch(e => console.error('forgot-password email error:', e.message));

      _resetRateLimit.set(norm, Date.now());

      await db.logAuditEvent({
        actorUserId: user.id, action: 'password_reset_requested',
        targetType: 'user', targetId: user.id, ipAddress: req.ip,
      }).catch(() => {});
    }

    // Always return ok to prevent enumeration
    res.json({ ok: true });
  } catch (err) {
    console.error('POST forgot-password error:', err);
    res.status(500).json({ error: 'Failed to process request. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/reset-password
//  Validates the token and sets a new password.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/auth/reset-password', async (req, res) => {
  const { token, password, confirmPassword } = req.body || {};

  if (!token)    return res.status(400).json({ error: 'Reset token is required',  code: 'missing_token' });
  if (!password) return res.status(400).json({ error: 'New password is required', code: 'missing_password' });

  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr, code: 'weak_password' });
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match', code: 'mismatch' });
  }

  try {
    const { rows } = await db.pool.query(
      `SELECT id, email, password_reset_token, password_reset_expires_at FROM users
        WHERE password_reset_token = $1`,
      [token]
    );
    const user = rows[0];

    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link.', code: 'invalid_token' });
    if (user.password_reset_expires_at && new Date(user.password_reset_expires_at) < new Date()) {
      return res.status(400).json({ error: 'This reset link has expired. Please request a new one.', code: 'expired' });
    }

    const hash = await bcrypt.hash(password, 12);

    await db.pool.query(
      `UPDATE users
          SET password_hash           = $1,
              password_reset_token    = NULL,
              password_reset_expires_at = NULL,
              -- A password the person chose for themselves (audit M-7): the
              -- temporary-password gates have nothing left to enforce, exactly
              -- as change-password clears them. Without this a starter whose
              -- temporary password had expired could reset and STILL be told
              -- "that temporary password has expired".
              password_is_temporary   = FALSE,
              must_change_password    = FALSE,
              temp_password_expires_at = NULL,
              password_changed_at     = NOW(),
              -- The reset link arrived in their mailbox: that verifies it.
              email_verified          = TRUE,
              updated_at              = NOW()
        WHERE id = $2`,
      [hash, user.id]
    );

    // Invalidate all sessions for this user for security
    await db.pool.query(
      `DELETE FROM sessions WHERE sess->>'userId' = $1`,
      [user.id]
    ).catch(() => {});

    await db.logAuditEvent({
      actorUserId: user.id, action: 'password_reset_completed',
      targetType: 'user', targetId: user.id, ipAddress: req.ip,
    }).catch(() => {});

    console.log(`🔑 Password reset completed: ${user.email}`);
    res.json({ ok: true });
  } catch (err) {
    console.error('POST reset-password error:', err);
    res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

module.exports = router;

/**
 * The password policy, exported so the two other places that set a password
 * — the authenticated change-password route and the onboarding invitation —
 * enforce the SAME rules. register-routes.js already holds a verbatim copy;
 * a third would be the one that drifted.
 */
module.exports.validatePassword = validatePassword;

// Test-only: clear the in-memory login rate-limit window so a test file that
// logs in many distinct users from the same IP is not throttled. Not used in
// production; does not weaken the limiter (which stays fully active).
module.exports._resetLoginRateLimit = () => { loginRateLimit.reset(); accountFailures.reset(); };
