/**
 * REGISTRATION ROUTES
 *
 * Supports two registration paths:
 *   1. Invite-based  — admin sends an invite, user registers via token in email link.
 *   2. Allowlist     — email matches opaltherapy.com.au domain or approved personal emails.
 *
 * Routes:
 *   POST /api/auth/check-invite      — validates email/token and returns canRegister
 *   POST /api/auth/register          — creates account, sends verification email
 *   GET  /api/auth/onboarding        — returns current onboarding state for logged-in user
 *   POST /api/auth/complete-profile  — saves profile step, marks onboarding complete
 *   POST /api/auth/complete-onboarding-step — saves individual onboarding step
 */

'use strict';

const express  = require('express');
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const router   = express.Router();

const db      = require('./database');
const emailSvc = require('./email');
const { getPermissions } = require('./permissions');

const SALT_ROUNDS = 12;

// ── Email allowlist ────────────────────────────────────────────────────────────
// Read from env so it's configurable without code changes.
// ALLOWED_DOMAINS: comma-separated, e.g. "opaltherapy.com.au"
// ALLOWED_EMAILS:  comma-separated exact addresses, e.g. "ant.manixavier@gmail.com"

const ALLOWED_DOMAINS = (process.env.ALLOWED_DOMAINS || 'opaltherapy.com.au')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

const ALLOWED_EMAILS  = (process.env.ALLOWED_EMAILS  || 'ant.manixavier@gmail.com')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

/**
 * Returns true if the email is permitted to self-register without an invite.
 * Server-side check — not relying on frontend validation.
 */
function isAllowlistedEmail(email) {
  const norm   = (email || '').trim().toLowerCase();
  if (ALLOWED_EMAILS.includes(norm)) return true;
  const domain = norm.split('@')[1] || '';
  return ALLOWED_DOMAINS.includes(domain);
}

function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function safeProfile(user, permissions) {
  return {
    id:                   user.id,
    name:                 user.name || user.email?.split('@')[0],
    email:                user.email,
    role:                 user.role || 'therapist',
    organisationId:       user.organisation_id || null,
    isActive:             user.is_active !== false,
    isTreatingTherapist:  !!user.is_treating_therapist,
    therapistProfileId:   user.therapist_profile_id || null,
    therapistProfile:     user.therapistProfile || null,
    canViewMasterCalendar: ['owner', 'admin'].includes(user.role || 'therapist'),
    hasOutlookConnected:  !!user.access_token,
    profileCompleted:     !!user.profile_completed,
    onboardingStep:       user.onboarding_step || 'account',
    permissions,
  };
}

function validatePassword(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters';
  }
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number';
  return null; // valid
}

// ── POST /api/auth/check-invite ───────────────────────────────────────────────
// Step 1 of registration: validate the email or token before showing the form.
// Accepts either { email } or { token } (from the email link).

router.post('/api/auth/check-invite', async (req, res) => {
  const { email: inputEmail, token } = req.body;

  if (!inputEmail && !token) {
    return res.status(400).json({ error: 'email or token is required' });
  }

  try {
    // ── Token path (from the email link) ──────────────────────────────────
    if (token) {
      // Look for any invite with this token first (to give specific error messages)
      const anyInvite = await db.findInviteByToken(token);

      if (!anyInvite) {
        return res.json({ canRegister: false, reason: 'not_invited' });
      }
      if (anyInvite.status === 'accepted') {
        return res.json({ canRegister: false, reason: 'already_accepted' });
      }
      if (anyInvite.status === 'revoked') {
        return res.json({ canRegister: false, reason: 'revoked' });
      }
      if (anyInvite.status === 'expired' ||
          (anyInvite.expires_at && new Date(anyInvite.expires_at) < new Date())) {
        return res.json({ canRegister: false, reason: 'expired' });
      }

      // Check the user doesn't already have an account
      const existingUser = await db.getUserByEmail(anyInvite.email);
      if (existingUser) {
        return res.json({ canRegister: false, reason: 'account_exists' });
      }

      // Get organisation name
      const orgRow = await db.pool.query('SELECT name FROM organisations WHERE id = $1', [anyInvite.organisation_id]);
      const orgName = orgRow.rows[0]?.name || 'Opal Therapy';

      return res.json({
        canRegister:          true,
        email:                anyInvite.email,
        role:                 anyInvite.role,
        isTreatingTherapist:  anyInvite.is_treating_therapist,
        displayNameHint:      anyInvite.display_name_hint || null,
        organisationName:     orgName,
      });
    }

    // ── Email path (manual entry flow) ────────────────────────────────────
    const normEmail = inputEmail.trim().toLowerCase();

    // Check if account already exists — generic message to limit enumeration
    const existingUser = await db.getUserByEmail(normEmail);
    if (existingUser) {
      return res.json({ canRegister: false, reason: 'account_exists' });
    }

    // ── Allowlist path — no invite required ───────────────────────────────
    if (isAllowlistedEmail(normEmail)) {
      // Valid domain or exact email — can self-register
      const orgRow = await db.pool.query('SELECT name FROM organisations ORDER BY created_at ASC LIMIT 1');
      const orgName = orgRow.rows[0]?.name || 'Opal Therapy';
      return res.json({
        canRegister:      true,
        email:            normEmail,
        role:             'therapist', // default — admin can elevate later
        registrationPath: 'allowlist',
        organisationName: orgName,
      });
    }

    // ── Invite-only path ──────────────────────────────────────────────────
    // Look for a valid pending invite
    const invite = await db.findPendingInviteByEmail(normEmail);
    if (!invite) {
      // Also check if there's an expired/revoked invite to give a better message
      const anyResult = await db.pool.query(
        "SELECT status FROM user_invites WHERE LOWER(email) = $1 ORDER BY invited_at DESC LIMIT 1",
        [normEmail]
      );
      const anyStatus = anyResult.rows[0]?.status;
      if (anyStatus === 'accepted') return res.json({ canRegister: false, reason: 'already_accepted' });
      if (anyStatus === 'revoked')  return res.json({ canRegister: false, reason: 'revoked' });
      if (anyStatus === 'expired')  return res.json({ canRegister: false, reason: 'expired' });
      // Not on allowlist and no invite — explicitly blocked
      return res.json({ canRegister: false, reason: 'not_authorised' });
    }

    const orgRow = await db.pool.query('SELECT name FROM organisations WHERE id = $1', [invite.organisation_id]);
    const orgName = orgRow.rows[0]?.name || 'Opal Therapy';

    return res.json({
      canRegister:          true,
      email:                invite.email,
      role:                 invite.role,
      isTreatingTherapist:  invite.is_treating_therapist,
      displayNameHint:      invite.display_name_hint || null,
      organisationName:     orgName,
    });
  } catch (err) {
    console.error('POST /api/auth/check-invite error:', err);
    return res.status(500).json({ error: 'Failed to check invite' });
  }
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Step 2: create the account.
//   - Invite path:    role from invite; skips pending_approval (admin already pre-approved).
//   - Allowlist path: role defaults to 'therapist'; status = pending_verification → pending_approval.

router.post('/api/auth/register', async (req, res) => {
  const {
    token,                 // from email invite link (preferred for invite path)
    email: inputEmail,     // for allowlist or manual invite path
    password,
    confirmPassword,
    profile = {},
  } = req.body;

  if (!password) return res.status(400).json({ error: 'Password is required' });

  const pwError = validatePassword(password);
  if (pwError) return res.status(400).json({ error: pwError });

  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match' });
  }
  if (!profile.name || !profile.name.trim()) {
    return res.status(400).json({ error: 'Full name is required' });
  }

  try {
    // ── Determine registration path ───────────────────────────────────────
    let invite          = null;
    let registrationPath = 'invite'; // 'invite' | 'allowlist'
    let resolvedEmail   = null;
    let resolvedRole    = 'therapist';

    if (token) {
      // Invite-link path
      invite = await db.findPendingInviteByToken(token);
      if (!invite) {
        const anyInvite = await db.findInviteByToken(token);
        if (!anyInvite) return res.status(400).json({ error: 'Invalid registration link.', code: 'invalid_token' });
        if (anyInvite.status === 'accepted') return res.status(400).json({ error: 'This invitation has already been used.', code: 'already_accepted' });
        if (anyInvite.status === 'revoked')  return res.status(400).json({ error: 'This invitation has been revoked.', code: 'revoked' });
        return res.status(400).json({ error: 'This invitation has expired. Please contact your administrator.', code: 'expired' });
      }
      resolvedEmail = invite.email;
      resolvedRole  = invite.role;
    } else if (inputEmail) {
      const norm = inputEmail.trim().toLowerCase();

      // MUST be on allowlist OR have a pending invite — backend enforces, no client bypass
      invite = await db.findPendingInviteByEmail(norm);
      if (invite) {
        resolvedEmail = invite.email;
        resolvedRole  = invite.role;
      } else if (isAllowlistedEmail(norm)) {
        registrationPath = 'allowlist';
        resolvedEmail    = norm;
        resolvedRole     = 'therapist'; // default; admin elevates later
      } else {
        return res.status(403).json({
          error: 'This email is not authorised to create an Opal Therapy account. Please contact the practice owner if you believe this is a mistake.',
          code:  'not_authorised',
        });
      }
    } else {
      return res.status(400).json({ error: 'token or email is required' });
    }

    // Race-condition guard
    const existingUser = await db.getUserByEmail(resolvedEmail);
    if (existingUser) {
      return res.status(409).json({
        error: 'An account already exists for this email address. Please sign in instead.',
        code:  'account_exists',
      });
    }

    // ── Determine initial account status ──────────────────────────────────
    // Invite path → pending_verification (must verify email, then auto-active since admin invited them)
    // Allowlist path → pending_verification (must verify email, then pending_approval for admin to activate)
    //
    // Special case: if no owner exists yet AND this is the owner allowlist email, auto-approve as owner.
    let initialStatus = 'pending_verification';
    const ownerCheck = await db.pool.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'owner' AND account_status = 'active'`
    );
    const hasOwner = parseInt(ownerCheck.rows[0]?.cnt, 10) > 0;

    // First owner bootstrap: if no active owner exists, first allowlist signup becomes owner + active
    if (!hasOwner && registrationPath === 'allowlist') {
      resolvedRole  = 'owner';
      initialStatus = 'active'; // bootstrap — no approval needed for first owner
      console.log(`🔑 Bootstrap: first owner account being created for ${resolvedEmail}`);
    }

    // ── Create account ────────────────────────────────────────────────────
    const passwordHash       = await bcrypt.hash(password, SALT_ROUNDS);
    const verificationToken  = generateToken();
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

    let user, therapistProfile;

    if (invite) {
      // Use existing invite-creation path in database.js
      const result = await db.registerUserFromInvite({
        invite,
        passwordHash,
        name:        profile.name.trim(),
        phone:       profile.phone || null,
        displayName: profile.displayName || profile.name.trim(),
        roleTitle:   profile.roleTitle || null,
      });
      user             = result.user;
      therapistProfile = result.therapistProfile;

      // Apply status + verification token on top
      await db.pool.query(
        `UPDATE users SET account_status = $1, email_verified = FALSE,
                email_verification_token = $2, email_verification_expires_at = $3,
                email_verification_sent_at = NOW(), updated_at = NOW()
           WHERE id = $4`,
        [initialStatus, verificationToken, verificationExpiry, user.id]
      );
    } else {
      // Allowlist self-registration — create user directly
      const orgRow = await db.pool.query(`SELECT id, name FROM organisations ORDER BY created_at ASC LIMIT 1`);
      const org    = orgRow.rows[0];

      const { rows } = await db.pool.query(
        `INSERT INTO users
           (email, name, display_name, phone, role, password_hash, is_active,
            account_status, email_verified, email_verification_token, email_verification_expires_at,
            email_verification_sent_at, organisation_id, profile_completed, onboarding_step, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,FALSE,$8,$9,NOW(),$10,FALSE,'profile',NOW(),NOW())
         RETURNING *`,
        [
          resolvedEmail,
          profile.name.trim(),
          profile.displayName || profile.name.trim(),
          profile.phone || null,
          resolvedRole,
          passwordHash,
          initialStatus,
          verificationToken,
          verificationExpiry,
          org?.id || null,
        ]
      );
      user = rows[0];
    }

    // ── Audit ─────────────────────────────────────────────────────────────
    await Promise.allSettled([
      db.logAuditEvent({ actorUserId: user.id, action: 'account.created', targetType: 'user', targetId: user.id,
        ipAddress: req.ip, organisationId: user.organisation_id,
        metadata: { role: resolvedRole, path: registrationPath } }),
      invite ? db.logAuditEvent({ actorUserId: user.id, action: 'invite.accepted', targetType: 'invite', targetId: invite.id, ipAddress: req.ip }) : Promise.resolve(),
    ]);

    // ── Send verification email ───────────────────────────────────────────
    if (initialStatus !== 'active') {
      // Only send verification if not already bootstrapped as active
      emailSvc.sendVerificationEmail({
        toEmail: user.email,
        token:   verificationToken,
        name:    user.display_name || user.name,
      }).catch(e => console.error('⚠️  Verification email failed:', e.message));
    } else {
      // Bootstrap owner — send welcome email instead
      emailSvc.sendWelcomeEmail({
        toEmail: user.email, name: user.name, role: resolvedRole, orgName: 'Opal Therapy',
      }).catch(() => {});
    }

    // ── Response (no session yet — user must verify email first) ──────────
    return res.status(201).json({
      ok:              true,
      requiresVerification: initialStatus !== 'active',
      accountStatus:   initialStatus,
      email:           user.email,
    });
  } catch (err) {
    console.error('POST /api/auth/register error:', err);
    db.logAuditEvent({
      actorUserId: null, action: 'registration.failed',
      targetType: 'email', targetId: inputEmail || null,
      ipAddress: req.ip, metadata: { reason: err.message?.substring(0, 100) },
    }).catch(() => {});
    return res.status(500).json({ error: 'Account creation failed. Please try again.' });
  }
});

// ── GET /api/auth/onboarding ──────────────────────────────────────────────────
// Returns the current user's onboarding state. Used by onboarding.html to know
// what step to show and what data has already been saved.

router.get('/api/auth/onboarding', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await db.getUser(req.session.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const permissions = getPermissions(user.role, user.permissions || []);
    return res.json({
      user:                safeProfile(user, permissions),
      profileCompleted:    !!user.profile_completed,
      onboardingStep:      user.onboarding_step || 'profile',
      defaultWorkLocation: user.default_work_location || null,
      workLocationSchedule: user.work_location_schedule || null,
    });
  } catch (err) {
    console.error('GET /api/auth/onboarding error:', err);
    return res.status(500).json({ error: 'Failed to load onboarding data' });
  }
});

// ── POST /api/auth/complete-profile ──────────────────────────────────────────
// Called when the user submits the onboarding profile form.
// Updates the user's profile fields and marks onboarding complete.

router.post('/api/auth/complete-profile', async (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const {
    displayName, roleTitle, phone,
    defaultWorkLocation, workLocationSchedule,
  } = req.body;

  try {
    const updated = await db.completeOnboardingProfile(req.session.userId, {
      displayName, roleTitle, phone, defaultWorkLocation, workLocationSchedule,
    });

    if (!updated) return res.status(404).json({ error: 'User not found' });

    // If the user has a therapist profile, update its display_name and role_title too
    if (updated.therapist_profile_id) {
      await db.pool.query(`
        UPDATE therapist_profiles
        SET display_name = COALESCE($1, display_name),
            role_title   = COALESCE($2, role_title),
            updated_at   = CURRENT_TIMESTAMP
        WHERE id = $3::uuid
      `, [displayName || null, roleTitle || null, updated.therapist_profile_id]);
    }

    // Audit log
    await db.logAuditEvent({
      actorUserId:    req.session.userId,
      action:         'onboarding.completed',
      targetType:     'user',
      targetId:       req.session.userId,
      organisationId: updated.organisation_id,
      ipAddress:      req.ip,
      metadata: {
        hasWorkLocation: !!defaultWorkLocation,
        profileFields:  ['displayName', 'roleTitle', 'phone', 'defaultWorkLocation']
                          .filter(f => req.body[f]),
      },
    }).catch(() => {});

    const fullUser = await db.getUser(req.session.userId);
    const permissions = getPermissions(fullUser.role, fullUser.permissions || []);

    return res.json({
      ok:   true,
      user: safeProfile(fullUser, permissions),
    });
  } catch (err) {
    console.error('POST /api/auth/complete-profile error:', err);
    return res.status(500).json({ error: 'Failed to save profile' });
  }
});

// ── POST /api/auth/complete-onboarding-step ──────────────────────────────────
// Saves individual onboarding step data. Called after each step is completed or skipped.
// Body: { step: string, data: object, skipped: boolean }

router.post('/api/auth/complete-onboarding-step', async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { step, data = {}, skipped = false } = req.body || {};
  if (!step) return res.status(400).json({ error: 'step is required' });

  const VALID_STEPS = ['profile','professional','outlook','work-location','travel-bases',
                       'credentials','cpd','notifications','review'];
  if (!VALID_STEPS.includes(step)) return res.status(400).json({ error: 'Invalid step' });

  try {
    const userId = req.session.userId;

    // Record step in completed/skipped arrays
    if (skipped) {
      await db.pool.query(
        `UPDATE users
            SET onboarding_skipped_steps = (
                  COALESCE(onboarding_skipped_steps, '[]'::jsonb)
                  || to_jsonb($1::text)
                ),
                onboarding_step  = $1,
                updated_at       = NOW()
          WHERE id = $2`,
        [step, userId]
      );
    } else {
      await db.pool.query(
        `UPDATE users
            SET onboarding_completed_steps = (
                  COALESCE(onboarding_completed_steps, '[]'::jsonb)
                  || to_jsonb($1::text)
                ),
                onboarding_step  = $1,
                updated_at       = NOW()
          WHERE id = $2`,
        [step, userId]
      );
    }

    // Apply step-specific data updates
    if (!skipped && Object.keys(data).length) {
      if (step === 'profile') {
        const { displayName, name, phone, roleTitle } = data;
        await db.pool.query(
          `UPDATE users SET
              name         = COALESCE($1, name),
              display_name = COALESCE($2, display_name),
              phone        = COALESCE($3, phone),
              role_title   = COALESCE($4, role_title),
              updated_at   = NOW()
            WHERE id = $5`,
          [name || null, displayName || null, phone || null, roleTitle || null, userId]
        );
      }
      if (step === 'work-location') {
        const { workLocationSchedule, defaultWorkLocation } = data;
        await db.pool.query(
          `UPDATE users SET
              work_location_schedule = COALESCE($1::jsonb, work_location_schedule),
              default_work_location  = COALESCE($2::jsonb, default_work_location),
              updated_at             = NOW()
            WHERE id = $3`,
          [workLocationSchedule ? JSON.stringify(workLocationSchedule) : null,
           defaultWorkLocation   ? JSON.stringify(defaultWorkLocation)  : null,
           userId]
        );
      }
      if (step === 'travel-bases') {
        const { travelBases } = data;
        if (travelBases) {
          await db.pool.query(
            `UPDATE users SET default_work_location = $1::jsonb, updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(travelBases), userId]
          );
        }
      }
      if (step === 'notifications') {
        const { prefs } = data;
        if (prefs) {
          await db.pool.query(
            `UPDATE users SET notification_preferences = COALESCE(notification_preferences,'{}') || $1::jsonb,
                              updated_at = NOW() WHERE id = $2`,
            [JSON.stringify(prefs), userId]
          );
        }
      }
    }

    // Mark profile complete when review step is done
    if (step === 'review' && !skipped) {
      await db.pool.query(
        `UPDATE users SET profile_completed = TRUE, profile_completed_at = NOW(),
                          onboarding_step = 'complete', updated_at = NOW() WHERE id = $1`,
        [userId]
      );
    }

    const fullUser   = await db.getUser(userId);
    const permissions = getPermissions(fullUser.role, fullUser.permissions || []);
    res.json({ ok: true, user: safeProfile(fullUser, permissions) });
  } catch (err) {
    console.error('POST complete-onboarding-step error:', err);
    res.status(500).json({ error: 'Failed to save onboarding step' });
  }
});

module.exports = router;
