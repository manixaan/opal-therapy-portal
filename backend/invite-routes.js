/**
 * INVITE MANAGEMENT ROUTES
 *
 * Owner/Admin can create, list, and revoke invites.
 * The invite record pre-assigns the email+role before the person registers.
 *
 * Routes:
 *   POST   /api/invites          — create invite (sends email)
 *   GET    /api/invites          — list all invites for the organisation
 *   DELETE /api/invites/:id      — revoke a pending invite
 */

'use strict';

const express = require('express');
const router  = express.Router();

const db    = require('./database');
const email = require('./email');

// ── Auth middleware ───────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  if (!req.session?.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const user = await db.getUser(req.session.userId);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: 'Authentication error' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied', required: roles });
    }
    next();
  };
}

// ── POST /api/invites ─────────────────────────────────────────────────────────
// Create a new invite and send the invite email.
// Owner can invite any role. Admin can invite therapists only.

router.post('/api/invites', requireAuth, async (req, res) => {
  const { role: actorRole, organisation_id: orgId, name: actorName } = req.user;

  // Permission: only Owner and Admin can create invites
  if (!['owner', 'admin'].includes(actorRole)) {
    return res.status(403).json({ error: 'Only Owner or Admin can create invites' });
  }

  const { email: inviteEmail, role: inviteRole, isTreatingTherapist, displayNameHint, expiresInDays } = req.body;

  if (!inviteEmail || !inviteRole) {
    return res.status(400).json({ error: 'email and role are required' });
  }

  const VALID_ROLES = ['owner', 'admin', 'therapist'];
  if (!VALID_ROLES.includes(inviteRole)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }

  // Admin can only invite therapists
  if (actorRole === 'admin' && inviteRole !== 'therapist') {
    return res.status(403).json({ error: 'Admin can only invite Therapists. Owner role required for Owner/Admin invites.' });
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

    // Calculate expiry
    const days = parseInt(expiresInDays, 10) || 14;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

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
      console.error('⚠️  Failed to send invite email:', emailErr.message);
      emailResult = { error: emailErr.message };
    }

    // Return invite info (never expose the token in the list response)
    return res.status(201).json({
      ok: true,
      invite: safeInvite(invite),
      emailSent: emailResult?.sent || false,
      emailSkipped: emailResult?.skipped || false,
      registerUrl: emailResult?.registerUrl || null,
    });
  } catch (err) {
    console.error('POST /api/invites error:', err);
    return res.status(500).json({ error: 'Failed to create invite' });
  }
});

// ── GET /api/invites ──────────────────────────────────────────────────────────
// List all invites for the organisation. Owner and Admin only.

router.get('/api/invites', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const invites = await db.getInvitesByOrganisation(req.user.organisation_id);
    return res.json({ invites: invites.map(safeInvite) });
  } catch (err) {
    console.error('GET /api/invites error:', err);
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// ── DELETE /api/invites/:id ───────────────────────────────────────────────────
// Revoke a pending invite. Owner can revoke any. Admin can revoke therapist invites only.

router.delete('/api/invites/:id', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    // Fetch the invite FIRST so we can check role permissions before writing
    const existing = await db.pool.query(
      'SELECT * FROM user_invites WHERE id = $1 AND organisation_id = $2 LIMIT 1',
      [req.params.id, req.user.organisation_id]
    );
    const invite = existing.rows[0];

    if (!invite) {
      return res.status(404).json({ error: 'Invite not found' });
    }
    if (invite.status !== 'pending') {
      return res.status(409).json({ error: `Invite is already ${invite.status} — cannot revoke` });
    }

    // Admin cannot revoke owner or admin invites
    if (req.user.role === 'admin' && ['owner', 'admin'].includes(invite.role)) {
      return res.status(403).json({ error: 'Admin can only revoke Therapist invites' });
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

// ── Resend invite email ───────────────────────────────────────────────────────
// POST /api/invites/:id/resend  — resend the email for a still-pending invite

router.post('/api/invites/:id/resend', requireAuth, requireRole('owner', 'admin'), async (req, res) => {
  try {
    const invites = await db.getInvitesByOrganisation(req.user.organisation_id);
    const invite  = invites.find(i => i.id === req.params.id && i.status === 'pending');

    if (!invite) {
      return res.status(404).json({ error: 'Pending invite not found' });
    }

    const emailResult = await email.sendInviteEmail({
      toEmail:     invite.email,
      inviteToken: invite.invite_token,
      role:        invite.role,
      displayName: invite.display_name_hint || null,
      invitedBy:   req.user.name || req.user.email,
    }).catch(err => ({ error: err.message }));

    return res.json({
      ok: true,
      emailSent: emailResult?.sent || false,
      emailSkipped: emailResult?.skipped || false,
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
