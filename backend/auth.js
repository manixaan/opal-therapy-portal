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
//  Login rate limiter — 10 attempts per IP per 15 minutes
//
//  Implemented inline to avoid an extra dependency.  Resets on server restart
//  (acceptable for this deployment size — the window is short enough that a
//  restart-based bypass provides no meaningful advantage).
//
//  Map structure:  ip → { count: Number, resetAt: Date }
// ─────────────────────────────────────────────────────────────────────────────

const LOGIN_WINDOW_MS   = 15 * 60 * 1000; // 15 minutes
const LOGIN_MAX_ATTEMPTS = 10;
const _loginAttempts     = new Map();

// Prune stale entries every 10 minutes so the map doesn't grow unbounded
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of _loginAttempts) {
    if (entry.resetAt <= now) _loginAttempts.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function loginRateLimit(req, res, next) {
  const ip  = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  let entry = _loginAttempts.get(ip);

  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    _loginAttempts.set(ip, entry);
  }

  entry.count++;

  if (entry.count > LOGIN_MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json({
      error: `Too many login attempts. Please try again in ${Math.ceil(retryAfterSec / 60)} minute(s).`,
    });
  }

  next();
}

// ─────────────────────────────────────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────────────────────────────────────

router.post('/api/auth/login', loginRateLimit, async (req, res) => {
  const { email, password } = req.body;

  // Basic input validation — generic messages to avoid user enumeration
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = await db.getUserByEmail(email.trim().toLowerCase());

    // Use a constant-time comparison even when user doesn't exist to prevent
    // timing-based email enumeration attacks.
    const DUMMY_HASH = '$2a$12$invalidhashusedfortimingprotectiononly000000000000000';
    const hashToCompare = user ? (user.password_hash || DUMMY_HASH) : DUMMY_HASH;
    const passwordMatch = await bcrypt.compare(password, hashToCompare);

    if (!user || !passwordMatch) {
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
    permissions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
//  GET /api/auth/verify-email?token=…
//  Called when user clicks the verification link in their email.
// ─────────────────────────────────────────────────────────────────────────────

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

    // Determine next status: invite-based → active, allowlist self-reg → pending_approval
    // If account was pending_verification, advance to pending_approval.
    // Exception: if this is the only owner, auto-activate.
    const newStatus = user.account_status === 'pending_verification' ? 'pending_approval' : user.account_status;

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
//  Accepts email, sends a reset link if the account exists and is active/verified.
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

    // Only send if account exists, is email-verified, and is active or pending_approval
    if (user && user.email_verified && ['active', 'pending_approval'].includes(user.account_status)) {
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
