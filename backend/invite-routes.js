/**
 * INVITE MANAGEMENT ROUTES — owner-only (RBAC 2026-08-06).
 *
 * The practice owner creates, lists, resends and revokes invites. The invite
 * record pre-assigns the email+role before the person registers; the person
 * registers ONLY through the token in the invitation link (/register?token=),
 * which also counts as their email verification.
 *
 * Onboarding invitations (onboarding_assignment_id set) are not managed here —
 * they are redeemed on /onboarding-invite and handled from Onboarding.
 *
 * Routes:
 *   POST   /api/invites            — create invite (sends email)
 *   GET    /api/invites            — list the organisation's invites
 *   DELETE /api/invites/:id        — revoke a pending invite
 *   GET    /api/invites/:id/link   — the registration link, for manual delivery
 *   POST   /api/invites/:id/resend — resend; an expired invite gets a fresh link
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const DEFAULT_INVITE_DAYS = 14;
const MAX_INVITE_DAYS     = 30;

/** expiresInDays from the request, clamped to 1–30 (default 14). */
function clampInviteDays(value) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return DEFAULT_INVITE_DAYS;
  return Math.max(1, Math.min(n, MAX_INVITE_DAYS));
}

const db    = require('./database');
const email = require('./email');

// requireAuth from the single permissions.js choke point (read_only
// write-block included) — this file used to carry its own copy without it.
const { requireAuth, requireRole } = require('./permissions');

// ── POST /api/invites ─────────────────────────────────────────────────────────
// Create a new invite and send the invite email. Owner-only.

router.post('/api/invites', requireAuth, async (req, res) => {
  const { role: actorRole, organisation_id: orgId, name: actorName } = req.user;

  // Permission (RBAC 2026-08-06): team management is owner-only. Admin's
  // remit is scheduling + travel; inviting users is a team/settings control.
  if (actorRole !== 'owner') {
    return res.status(403).json({ error: 'Only the practice owner can create invites' });
  }

  const { email: inviteEmail, role: inviteRole, isTreatingTherapist, displayNameHint, expiresInDays } = req.body;

  if (!inviteEmail || !inviteRole) {
    return res.status(400).json({ error: 'email and role are required' });
  }

  // Matches the DB CHECK constraint (user_invites_role_check_v2) — read_only
  // was previously missing here, making the role impossible to invite.
  const VALID_ROLES = ['owner', 'admin', 'therapist', 'read_only'];
  if (!VALID_ROLES.includes(inviteRole)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail.trim())) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    // Check if user already exists with this email
    const existingUser = await db.getUserByEmail(inviteEmail.trim());
    if (existingUser) {
      return res.status(409).json({
        error: 'An account already exists for this email address.',
        code:  'account_exists',
      });
    }

    // Check for an existing pending invite for this email
    const existingInvite = await db.findPendingInviteByEmail(inviteEmail.trim());
    if (existingInvite) {
      return res.status(409).json({
        error: 'A pending invite already exists for this email address.',
        code:  'invite_exists',
        inviteId: existingInvite.id,
      });
    }

    // Calculate expiry — clamped to 1–30 days (audit M-1c: a negative value
    // used to create an already-expired invite, and 100000 was accepted).
    const expiresAt = new Date(Date.now() + clampInviteDays(expiresInDays) * 24 * 60 * 60 * 1000);

    // Create invite
    const invite = await db.createInvite({
      organisationId:     orgId,
      email:              inviteEmail.trim(),
      role:               inviteRole,
      invitedByUserId:    req.user.id,
      isTreatingTherapist: !!isTreatingTherapist,
      displayNameHint:    displayNameHint || null,
      expiresAt,
    });

    // Audit log
    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'invite.created',
      targetType:     'invite',
      targetId:       invite.id,
      organisationId: orgId,
      ipAddress:      req.ip,
      metadata: {
        targetEmail:    inviteEmail.trim(),
        role:           inviteRole,
        isTreatingTherapist: !!isTreatingTherapist,
      },
    }).catch(() => {});

    // Send invite email
    let emailResult = null;
    try {
      emailResult = await email.sendInviteEmail({
        toEmail:     invite.email,
        inviteToken: invite.invite_token,
        role:        inviteRole,
        displayName: displayNameHint || null,
        invitedBy:   actorName || req.user.email,
        orgName:     null, // will use default 'Opal Therapy'
      });
    } catch (emailErr) {
      // Send FAILED (configured but SMTP errored) — still hand back the link
      // so the owner can deliver it manually instead of silently stalling.
      console.error('⚠️  Failed to send invite email:', emailErr.message);
      emailResult = { failed: true, registerUrl: email.buildRegisterUrl(invite.invite_token) };
    }

    // Return invite info (never expose the token in the list response).
    // The UI must distinguish sent / not-configured / failed — never claim
    // "sent" unless emailSent is true (audit blocker #1).
    return res.status(201).json({
      ok: true,
      invite: safeInvite(invite),
      emailSent: emailResult?.sent || false,
      emailSkipped: emailResult?.skipped || false,
      emailFailed: emailResult?.failed || false,
      registerUrl: emailResult?.registerUrl || null,
    });
  } catch (err) {
    console.error('POST /api/invites error:', err);
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

// ── GET /api/invites ──────────────────────────────────────────────────────────
// List the organisation's invites (onboarding invitations excluded). Owner-only.

router.get('/api/invites', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const invites = await db.getInvitesByOrganisation(req.user.organisation_id);
    return res.json({ invites: invites.map(safeInvite) });
  } catch (err) {
    console.error('GET /api/invites error:', err);
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// ── DELETE /api/invites/:id ───────────────────────────────────────────────────
// Revoke a pending invite. Owner-only. Onboarding invitations are cancelled
// from Onboarding, not here.

router.delete('/api/invites/:id', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const existing = await db.pool.query(
      `SELECT * FROM user_invites
        WHERE id = $1 AND organisation_id = $2 AND onboarding_assignment_id IS NULL
        LIMIT 1`,
      [req.params.id, req.user.organisation_id]
    );
    const invite = existing.rows[0];

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    if (invite.status !== 'pending') {
      return res.status(409).json({ error: `Invite is already ${invite.status} — cannot revoke` });
    }

    const revoked = await db.revokeInvite(req.params.id, req.user.id);

    if (!revoked) {
      return res.status(404).json({ error: 'Invite not found or already used/revoked' });
    }

    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'invite.revoked',
      targetType:     'invite',
      targetId:       req.params.id,
      organisationId: req.user.organisation_id,
      ipAddress:      req.ip,
      metadata: { targetEmail: revoked.email, role: revoked.role },
    }).catch(() => {});

    return res.json({ ok: true, invite: safeInvite(revoked) });
  } catch (err) {
    console.error('DELETE /api/invites/:id error:', err);
    return res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// ── GET /api/invites/:id/link ─────────────────────────────────────────────────
// Retrieve the registration link for a still-pending invite so the owner can
// share it manually (email not configured, or the recipient never got it).
// The token is deliberately stripped from list responses; this explicit,
// audited endpoint is the ONLY post-creation way to obtain the link.

router.get('/api/invites/:id/link', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const invites = await db.getInvitesByOrganisation(req.user.organisation_id);
    const invite  = invites.find(i => i.id === req.params.id && i.status === 'pending');
    if (!invite) return res.status(404).json({ error: 'Pending invite not found' });

    await db.logAuditEvent({
      actorUserId:    req.user.id,
      action:         'invite.link_retrieved',
      targetType:     'invite',
      targetId:       invite.id,
      organisationId: req.user.organisation_id,
      ipAddress:      req.ip,
      metadata: { targetEmail: invite.email, role: invite.role },
    }).catch(() => {});

    return res.json({
      ok: true,
      registerUrl: email.buildRegisterUrl(invite.invite_token),
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expires_at,
    });
  } catch (err) {
    console.error('GET /api/invites/:id/link error:', err);
    return res.status(500).json({ error: 'Failed to fetch invite link' });
  }
});

// ── Resend invite email ───────────────────────────────────────────────────────
// POST /api/invites/:id/resend  — resend the email for a still-pending invite.
// An EXPIRED pending invite is renewed first (fresh token, fresh expiry), so
// the resent email never carries a link that already says "expired"
// (audit M-1a). The old token stops working the moment it is replaced.

router.post('/api/invites/:id/resend', requireAuth, requireRole('owner'), async (req, res) => {
  try {
    const invites = await db.getInvitesByOrganisation(req.user.organisation_id);
    let invite    = invites.find(i => i.id === req.params.id && i.status === 'pending');

    if (!invite) {
      return res.status(404).json({ error: 'Pending invite not found' });
    }

    let renewed = false;
    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      const { rows } = await db.pool.query(
        `UPDATE user_invites
            SET invite_token = $1, expires_at = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $3 AND status = 'pending'
          RETURNING *`,
        [crypto.randomBytes(32).toString('hex'),
         new Date(Date.now() + DEFAULT_INVITE_DAYS * 24 * 60 * 60 * 1000), invite.id]
      );
      if (!rows[0]) return res.status(404).json({ error: 'Pending invite not found' });
      invite  = rows[0];
      renewed = true;
      await db.logAuditEvent({
        actorUserId: req.user.id, action: 'invite.renewed', targetType: 'invite', targetId: invite.id,
        organisationId: req.user.organisation_id, ipAddress: req.ip,
        metadata: { targetEmail: invite.email, role: invite.role },
      }).catch(() => {});
    }

    let emailResult;
    try {
      emailResult = await email.sendInviteEmail({
        toEmail:     invite.email,
        inviteToken: invite.invite_token,
        role:        invite.role,
        displayName: invite.display_name_hint || null,
        invitedBy:   req.user.name || req.user.email,
      });
    } catch (err) {
      console.error('⚠️  Failed to resend invite email:', err.message);
      emailResult = { failed: true };
    }

    // Same three-state contract as creation: the UI says "Sent" only when
    // emailSent is true, and otherwise offers the link.
    return res.json({
      ok: true,
      renewed,
      expiresAt: invite.expires_at,
      emailSent: emailResult?.sent || false,
      emailSkipped: emailResult?.skipped || false,
      emailFailed: emailResult?.failed || false,
    });
  } catch (err) {
    console.error('POST /api/invites/:id/resend error:', err);
    return res.status(500).json({ error: 'Failed to resend invite' });
  }
});

// ── Helper: strip invite_token from responses ─────────────────────────────────
// Never expose the raw invite token in list/get responses.
// The token is only ever sent in the email link.

function safeInvite(invite) {
  const { invite_token, ...safe } = invite; // eslint-disable-line no-unused-vars
  return safe;
}

module.exports = router;
module.exports.clampInviteDays = clampInviteDays;
