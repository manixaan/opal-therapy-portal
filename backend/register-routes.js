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
const { getPermissions, requireAuth } = require('./permissions');
const { createIpRateLimiter } = require('./request-safety');
const wizardLink = require('./onboarding-wizard-link');

// /check-invite answers anonymous callers, so it gets the same per-IP limiter
// shape as login (audit M-3 / L-1): 10 per 15 minutes per client address.
const checkInviteRateLimit = createIpRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many attempts. Please wait a few minutes and try again.',
});

const SALT_ROUNDS = 12;

// ── Email allowlist ────────────────────────────────────────────────────────────
// Read from env so it's configurable without code changes.
// ALLOWED_DOMAINS: comma-separated, e.g. "opaltherapy.com.au"
// ALLOWED_EMAILS:  comma-separated exact addresses, e.g. "ant.manixavier@gmail.com"

// Defaults are empty strings — production MUST set these env vars explicitly.
// No personal email is ever hardcoded here; configure via ALLOWED_EMAILS in .env.
// Read on each call (not frozen at module load) so a test can exercise the
// allowlist and bootstrap paths; the cost is a split of a short string.
function envList(key) {
  return (process.env[key] || '').split(',').map(v => v.trim().toLowerCase()).filter(Boolean);
}

/**
 * Returns true if the email is permitted to self-register without an invite.
 * Server-side check — not relying on frontend validation.
 */
function isAllowlistedEmail(email) {
  const norm   = (email || '').trim().toLowerCase();
  if (envList('ALLOWED_EMAILS').includes(norm)) return true;
  const domain = norm.split('@')[1] || '';
  return !!domain && envList('ALLOWED_DOMAINS').includes(domain);
}

/** The practice name used when the first organisation is created (ORG_NAME). */
function defaultOrgName() {
  return (process.env.ORG_NAME || '').trim() || 'Opal Therapy';
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
    outlookConnectedEmail: user.access_token ? (user.outlook_connected_email || null) : null,
    profileCompleted:     !!user.profile_completed,
    onboardingStep:       user.onboarding_step || 'account',
    // Persisted wizard progress — the onboarding page reconciles its UI with
    // these on load (backend is the source of truth, not localStorage).
    onboardingCompletedSteps: user.onboarding_completed_steps || [],
    onboardingSkippedSteps:   user.onboarding_skipped_steps || [],
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

router.post('/api/auth/check-invite', checkInviteRateLimit, async (req, res) => {
  const { email: inputEmail, token } = req.body;

  if (!inputEmail && !token) {
    return res.status(400).json({ error: 'email or token is required' });
  }

  try {
    // ── Token path (from the email link) ──────────────────────────────────
    if (token) {
      // Look for any invite with this token first (to give specific error messages)
      const anyInvite = await db.findInviteByToken(token);

      // An onboarding invitation is redeemed on /onboarding-invite, never here.
      if (!anyInvite || anyInvite.onboarding_assignment_id) {
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
      const orgName = orgRow.rows[0]?.name || defaultOrgName();

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
    // Deliberately says NOTHING about whether this email has an account, a
    // pending invite, or what role an invite carries (audit H-1 / L-1): an
    // anonymous caller used to learn all three, and could then claim the
    // invite with a password of their choosing. Only the allowlist — which is
    // configuration, not account data — changes the answer. An invited person
    // registers through the link in their invitation (the token path above).
    const normEmail = String(inputEmail).trim().toLowerCase();

    if (isAllowlistedEmail(normEmail)) {
      const orgRow = await db.pool.query('SELECT name FROM organisations ORDER BY created_at ASC LIMIT 1');
      const orgName = orgRow.rows[0]?.name || defaultOrgName();
      return res.json({
        canRegister:      true,
        email:            normEmail,
        role:             'therapist', // default — the owner can change it later
        registrationPath: 'allowlist',
        organisationName: orgName,
      });
    }

    return res.json({ canRegister: false, reason: 'use_invite_link' });
  } catch (err) {
    console.error('POST /api/auth/check-invite error:', err);
    return res.status(500).json({ error: 'Failed to check invite' });
  }
});

// ── First-owner bootstrap ─────────────────────────────────────────────────────
// While no ACTIVE owner exists, an allowlist registration would make the
// registrant the practice owner, active, with no approval (audit H-4). That is
// now allowed only for the address named in BOOTSTRAP_OWNER_EMAIL
// (case-insensitive). In development with it unset the old behaviour stays, so
// a fresh local database is still one sign-up away from usable. Anywhere else
// with it unset, the bootstrap is refused and nothing is created.

const BOOTSTRAP_LOCK_KEY = 0x0BA1_0001; // pg_advisory_xact_lock key — one bootstrap at a time

function bootstrapDecision(email, env = process.env) {
  const configured = String(env.BOOTSTRAP_OWNER_EMAIL || '').trim().toLowerCase();
  const norm = String(email || '').trim().toLowerCase();
  if (configured) {
    if (norm && norm === configured) return { allowed: true };
    return {
      allowed: false,
      message: 'This portal has not been set up yet. Only the practice owner configured for this server can create the first account.',
    };
  }
  if ((env.NODE_ENV || 'development') === 'development') return { allowed: true };
  return {
    allowed: false,
    message: 'First-owner setup is not enabled on this server. Set BOOTSTRAP_OWNER_EMAIL to the practice owner\'s email address, then register with that address.',
  };
}

/**
 * Create an allowlist (self-registration) account in one transaction.
 * Returns { user, role, initialStatus, bootstrapped, orgName } or
 * { refused: { status, body } } — in which case nothing was written.
 *
 *  • No active owner → bootstrap (if bootstrapDecision allows it): role owner,
 *    active, and the practice organisation is created when none exists
 *    (audit C-1 — previously the first owner got organisation_id NULL and
 *    could never create an invite).
 *  • Otherwise → therapist, pending_verification → pending_approval, and the
 *    practice organisation MUST already exist: an account with a NULL
 *    organisation is refused rather than created.
 */
async function createAllowlistAccount({ email, profile, passwordHash }) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    // Serialise registrations that could bootstrap, so two simultaneous
    // first sign-ups cannot both become owner or create two organisations.
    await client.query('SELECT pg_advisory_xact_lock($1)', [BOOTSTRAP_LOCK_KEY]);

    const ownerCheck = await client.query(
      `SELECT COUNT(*) AS cnt FROM users WHERE role = 'owner' AND account_status = 'active'`
    );
    const hasOwner = parseInt(ownerCheck.rows[0]?.cnt, 10) > 0;

    let role = 'therapist';
    let initialStatus = 'pending_verification';
    let bootstrapped = false;
    if (!hasOwner) {
      const decision = bootstrapDecision(email);
      if (!decision.allowed) {
        await client.query('ROLLBACK');
        return { refused: { status: 403, body: { error: decision.message, code: 'bootstrap_not_permitted' } } };
      }
      role = 'owner';
      initialStatus = 'active';
      bootstrapped = true;
    }

    let org = (await client.query(
      'SELECT id, name FROM organisations ORDER BY created_at ASC LIMIT 1'
    )).rows[0];
    let createdOrganisation = false;
    if (!org) {
      if (!bootstrapped) {
        await client.query('ROLLBACK');
        return { refused: { status: 409, body: {
          error: 'The practice has not been set up yet, so accounts cannot be created. Please contact the practice owner.',
          code: 'no_organisation',
        } } };
      }
      org = (await client.query(
        'INSERT INTO organisations (name) VALUES ($1) RETURNING id, name', [defaultOrgName()]
      )).rows[0];
      createdOrganisation = true;
    }

    const verified = initialStatus === 'active';
    const verificationToken  = verified ? null : generateToken();
    const verificationExpiry = verified ? null : new Date(Date.now() + 24 * 60 * 60 * 1000);
    const { rows } = await client.query(
      `INSERT INTO users
         (email, name, display_name, phone, role, password_hash, is_active,
          account_status, email_verified, email_verification_token, email_verification_expires_at,
          email_verification_sent_at, organisation_id, profile_completed, onboarding_step, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7,$8,$9,$10,$11,$12,FALSE,'profile',NOW(),NOW())
       RETURNING *`,
      [
        email,
        profile.name.trim(),
        profile.displayName || profile.name.trim(),
        profile.phone || null,
        role,
        passwordHash,
        initialStatus,
        // The bootstrap owner is active with no emailed proof: the address
        // was named in server configuration, which is the proof. It is NOT
        // marked verified, so nothing downstream mistakes it for one.
        false,
        verificationToken,
        verificationExpiry,
        verified ? null : new Date(),
        org.id,
      ]
    );
    await client.query('COMMIT');
    const user = rows[0];
    user._createdOrganisation = createdOrganisation;
    return { user, role, initialStatus, bootstrapped, orgName: org.name };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
// Step 2: create the account.
//   - Invite path (token only): role from the invite; created active and
//     email-verified — the token came from the invitee's mailbox.
//   - Allowlist path: role defaults to 'therapist'; status = pending_verification
//     → pending_approval. While no active owner exists, only the configured
//     BOOTSTRAP_OWNER_EMAIL may register, and becomes the owner (see above).

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
    // Exactly two ways in (audit H-1):
    //   • the invitation TOKEN from the owner's email link — proves the
    //     person holds the invited mailbox;
    //   • the allowlist (ALLOWED_EMAILS / ALLOWED_DOMAINS) — self-registration
    //     that must still verify the email and wait for the owner.
    // An email alone no longer redeems a pending invite: anyone who knew an
    // invitee's address could previously claim their account and role.
    let invite           = null;
    let registrationPath = 'invite'; // 'invite' | 'allowlist'
    let resolvedEmail    = null;
    let resolvedRole     = 'therapist';

    if (token) {
      // Invite-link path
      invite = await db.findPendingInviteByToken(token);
      if (invite && invite.onboarding_assignment_id) invite = null; // redeemed on /onboarding-invite only
      if (!invite) {
        const anyInvite = await db.findInviteByToken(token);
        if (!anyInvite || anyInvite.onboarding_assignment_id) return res.status(400).json({ error: 'Invalid registration link.', code: 'invalid_token' });
        if (anyInvite.status === 'accepted') return res.status(400).json({ error: 'This invitation has already been used.', code: 'already_accepted' });
        if (anyInvite.status === 'revoked')  return res.status(400).json({ error: 'This invitation has been revoked.', code: 'revoked' });
        return res.status(400).json({ error: 'This invitation has expired. Please contact your administrator.', code: 'expired' });
      }
      resolvedEmail = invite.email;
      resolvedRole  = invite.role;
    } else if (inputEmail) {
      const norm = String(inputEmail).trim().toLowerCase();
      if (!isAllowlistedEmail(norm)) {
        // The same answer whether or not this email has a pending invite or
        // an account — nothing here may tell an anonymous caller either.
        return res.status(403).json({
          error: 'This email cannot be used to create an account here. If you were invited, please use the link in your invitation email.',
          code:  'not_authorised',
        });
      }
      registrationPath = 'allowlist';
      resolvedEmail    = norm;
      resolvedRole     = 'therapist'; // default; the owner elevates later
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

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    let user;
    let initialStatus;
    let orgName = defaultOrgName();
    let bootstrapped = false;

    if (invite) {
      // ── Invite path ─────────────────────────────────────────────────────
      // The token arrived in the invitee's mailbox, so holding it IS the
      // email verification: the account is created verified and active. (It
      // used to start at pending_verification, which left an invitee stuck
      // whenever email was not configured — the copy-link dead end.)
      const result = await db.registerUserFromInvite({
        invite,
        passwordHash,
        name:        profile.name.trim(),
        phone:       profile.phone || null,
        displayName: profile.displayName || profile.name.trim(),
        roleTitle:   profile.roleTitle || null,
      });
      initialStatus = 'active';
      const { rows } = await db.pool.query(
        `UPDATE users SET account_status = 'active', is_active = TRUE, email_verified = TRUE,
                email_verification_token = NULL, email_verification_expires_at = NULL,
                updated_at = NOW()
           WHERE id = $1
         RETURNING *`,
        [result.user.id]
      );
      user = rows[0] || result.user;
      const orgRow = await db.pool.query('SELECT name FROM organisations WHERE id = $1', [invite.organisation_id]);
      orgName = orgRow.rows[0]?.name || orgName;
    } else {
      // ── Allowlist path ──────────────────────────────────────────────────
      const outcome = await createAllowlistAccount({
        email: resolvedEmail, profile, passwordHash,
      });
      if (outcome.refused) {
        return res.status(outcome.refused.status).json(outcome.refused.body);
      }
      user          = outcome.user;
      initialStatus = outcome.initialStatus;
      resolvedRole  = outcome.role;
      bootstrapped  = outcome.bootstrapped;
      orgName       = outcome.orgName || orgName;
    }

    // ── Audit ─────────────────────────────────────────────────────────────
    await Promise.allSettled([
      db.logAuditEvent({ actorUserId: user.id, action: 'account.created', targetType: 'user', targetId: user.id,
        ipAddress: req.ip, organisationId: user.organisation_id,
        metadata: { role: resolvedRole, path: registrationPath, bootstrap: bootstrapped } }),
      invite ? db.logAuditEvent({ actorUserId: user.id, action: 'invite.accepted', targetType: 'invite', targetId: invite.id, ipAddress: req.ip }) : Promise.resolve(),
      bootstrapped ? db.logAuditEvent({ actorUserId: user.id, action: 'account.bootstrap_owner', targetType: 'user', targetId: user.id,
        ipAddress: req.ip, organisationId: user.organisation_id, metadata: { createdOrganisation: !!user._createdOrganisation } }) : Promise.resolve(),
    ]);
    if (bootstrapped) console.warn('🔑 Bootstrap: the first owner account was created via /register');

    // ── Email ─────────────────────────────────────────────────────────────
    if (initialStatus !== 'active') {
      emailSvc.sendVerificationEmail({
        toEmail: user.email,
        token:   user.email_verification_token,
        name:    user.display_name || user.name,
      }).catch(e => console.error('⚠️  Verification email failed:', e.message));
    } else {
      emailSvc.sendWelcomeEmail({
        toEmail: user.email, name: user.name, role: resolvedRole, orgName,
      }).catch(() => {});
    }

    // ── Response (no session — the person signs in with the new password) ─
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

// requireAuth (audit L-2): the single choke point — inactive / non-active
// accounts, the forced password change and the pre-employee allowlist all
// apply here too. All three routes sit under /api/auth/, which the
// pre-employee allowlist already admits; a temporary-password session is
// (deliberately) sent to change its password first.
router.get('/api/auth/onboarding', requireAuth, async (req, res) => {
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

router.post('/api/auth/complete-profile', requireAuth, async (req, res) => {
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

    // Identity-chain safety net (Stage 2): therapists get a profile here too.
    if (updated.role === 'therapist' && !updated.therapist_profile_id) {
      const prof = await db.ensureTherapistProfile(req.session.userId).catch(() => null);
      if (prof) updated.therapist_profile_id = String(prof.id);
    }

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

/**
 * The wizard's Work location / Travel bases steps, merged into the columns
 * My Profile → Work Locations reads. One transaction, row locked, so a
 * double-click cannot interleave two read-modify-writes.
 *
 *   work-location: { homeAddress: { address, lat?, lng?, placeId? }, weekKeys?: string[] }
 *                  (the old { defaultWorkLocation: { formattedAddress, … } } is still read)
 *   travel-bases:  { travelBases: [{ name, address, lat?, lng? }] }
 */
async function applyWorkLocationStep(userId, step, data) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT default_work_location, work_location_schedule FROM users WHERE id = $1 FOR UPDATE`, [userId]);
    const row = rows[0] || {};
    let bases = row.default_work_location;
    let schedule = row.work_location_schedule;
    let changed = false;

    if (step === 'work-location') {
      const legacy = data.defaultWorkLocation && typeof data.defaultWorkLocation === 'object'
        ? { address: data.defaultWorkLocation.formattedAddress, lat: data.defaultWorkLocation.lat,
            lng: data.defaultWorkLocation.lng, placeId: data.defaultWorkLocation.placeId }
        : null;
      const home = (data.homeAddress && typeof data.homeAddress === 'object') ? data.homeAddress : legacy;
      if (home && typeof home.address === 'string' && home.address.trim()) {
        bases = wizardLink.setPrimaryHome(bases, home);
        schedule = wizardLink.fillScheduleDefaults(schedule, data.weekKeys, 'home-1');
        changed = true;
      }
    } else if (Array.isArray(data.travelBases) && data.travelBases.length) {
      bases = wizardLink.appendExtraBases(bases, data.travelBases);
      changed = true;
    }

    if (changed) {
      await client.query(
        `UPDATE users SET default_work_location = $1::jsonb,
                          work_location_schedule = $2::jsonb,
                          updated_at = NOW()
          WHERE id = $3`,
        [JSON.stringify(bases), schedule == null ? null : JSON.stringify(schedule), userId]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ── POST /api/auth/complete-onboarding-step ──────────────────────────────────
// Saves individual onboarding step data. Called after each step is completed or skipped.
// Body: { step: string, data: object, skipped: boolean }

router.post('/api/auth/complete-onboarding-step', requireAuth, async (req, res) => {
  if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });

  const { step, skipped = false } = req.body || {};
  const data = req.body && req.body.data && typeof req.body.data === 'object' && !Array.isArray(req.body.data)
    ? req.body.data : {};
  if (!step) return res.status(400).json({ error: 'step is required' });

  const VALID_STEPS = ['profile','professional','outlook','work-location','travel-bases',
                       'credentials','cpd','notifications','review'];
  if (!VALID_STEPS.includes(step)) return res.status(400).json({ error: 'Invalid step' });

  try {
    const userId = req.session.userId;

    // Record step in completed/skipped arrays. The `?` guard keeps the
    // arrays idempotent — re-posting a step (page refresh, OAuth return,
    // wizard back/next) must not append duplicates.
    if (skipped) {
      await db.pool.query(
        `UPDATE users
            SET onboarding_skipped_steps = (
                  CASE WHEN COALESCE(onboarding_skipped_steps, '[]'::jsonb) ? $1
                       THEN onboarding_skipped_steps
                       ELSE COALESCE(onboarding_skipped_steps, '[]'::jsonb) || to_jsonb($1::text)
                  END
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
                  CASE WHEN COALESCE(onboarding_completed_steps, '[]'::jsonb) ? $1
                       THEN onboarding_completed_steps
                       ELSE COALESCE(onboarding_completed_steps, '[]'::jsonb) || to_jsonb($1::text)
                  END
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
      if (step === 'work-location' || step === 'travel-bases') {
        // Both steps write the portal's own shapes (WORK_BASES + the
        // week-keyed schedule) and MERGE: step 4 sets home-1, step 5 appends
        // homes, and neither overwrites the other, an office entry, or a day
        // the person already set. See onboarding-wizard-link.js.
        await applyWorkLocationStep(userId, step, data);
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
      // Identity-chain safety net (Stage 2): a therapist finishing onboarding
      // must end up with a therapist_profile even if the invite lacked the
      // treating-therapist flag. Idempotent.
      await db.ensureTherapistProfile(userId).catch(err =>
        console.error('ensureTherapistProfile at onboarding completion failed:', err.message));
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
module.exports.bootstrapDecision = bootstrapDecision;
module.exports.isAllowlistedEmail = isAllowlistedEmail;
// Test-only: clear the in-memory /check-invite limiter between test cases.
module.exports._resetCheckInviteRateLimit = () => checkInviteRateLimit.reset();
