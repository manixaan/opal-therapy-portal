/**
 * EMAIL SERVICE
 *
 * Sends transactional emails using nodemailer.
 * Configure via .env — works with any SMTP provider including:
 *   - Microsoft 365 (smtp.office365.com:587)
 *   - Gmail (smtp.gmail.com:587, needs app password)
 *   - SendGrid / Mailgun / SES (use their SMTP bridge)
 *
 * Required .env vars:
 *   EMAIL_HOST      e.g. smtp.office365.com
 *   EMAIL_PORT      e.g. 587
 *   EMAIL_SECURE    true (port 465) | false (port 587 with STARTTLS)
 *   EMAIL_USER      your@email.com
 *   EMAIL_PASS      your SMTP password or app password
 *   EMAIL_FROM      Opal Therapy <your@email.com>
 *   APP_BASE_URL    https://your-app-domain.com  (for invite links)
 */

'use strict';

const nodemailer = require('nodemailer');

// ── Transport ────────────────────────────────────────────────────────────────

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host    = process.env.EMAIL_HOST;
  const port    = parseInt(process.env.EMAIL_PORT || '587', 10);
  const secure  = process.env.EMAIL_SECURE === 'true'; // true = TLS on connect (port 465)
  const user    = process.env.EMAIL_USER;
  const pass    = process.env.EMAIL_PASS;

  if (!host || !user || !pass) {
    console.warn('⚠️  EMAIL_HOST / EMAIL_USER / EMAIL_PASS not configured — invite emails will be logged only');
    return null;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    tls: { rejectUnauthorized: process.env.NODE_ENV === 'production' },
  });

  return transporter;
}

/** Returns true if email is fully configured. */
function isEmailConfigured() {
  return !!(process.env.EMAIL_HOST && process.env.EMAIL_USER && process.env.EMAIL_PASS);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const FROM = () => process.env.EMAIL_FROM || `Opal Therapy <${process.env.EMAIL_USER}>`;
const BASE = () => (process.env.APP_BASE_URL || 'http://localhost:5001').replace(/\/$/, '');

function roleLabel(role) {
  return { owner: 'Practice Owner', admin: 'Administrator', therapist: 'Therapist', read_only: 'Read-only user' }[role] || role;
}

/**
 * Escape user-supplied values before interpolating them into HTML email
 * bodies (names, display-name hints, inviter names). Without this, a value
 * like `<img src=x onerror=…>` would be delivered to the recipient as live
 * markup inside a trusted practice email.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Email: User Invite ────────────────────────────────────────────────────────

/**
 * Send an invite email to a new team member.
 * @param {object} opts
 * @param {string} opts.toEmail        Recipient email
 * @param {string} opts.inviteToken    The invite token stored in user_invites
 * @param {string} opts.role           'owner' | 'admin' | 'therapist'
 * @param {string} [opts.displayName]  Optional "Hi [name]" personalisation
 * @param {string} [opts.invitedBy]    Name of the person who sent the invite
 * @param {string} [opts.orgName]      Organisation name, e.g. "Opal Therapy"
 */
async function sendInviteEmail({ toEmail, inviteToken, role, displayName, invitedBy, orgName }) {
  const registerUrl = `${BASE()}/register?token=${encodeURIComponent(inviteToken)}`;
  const greeting    = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hello,';
  const org         = escapeHtml(orgName || 'Opal Therapy');
  const sender      = escapeHtml(invitedBy || 'The practice owner');
  const roleName    = escapeHtml(roleLabel(role));

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 10px; max-width: 540px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #5b6af0; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 14px; }
    .badge { display: inline-block; background: #f0f0ff; color: #5b6af0;
             font-size: 13px; font-weight: 600; border-radius: 20px;
             padding: 3px 12px; margin-bottom: 20px; }
    .btn { display: inline-block; background: #5b6af0; color: #fff !important;
           text-decoration: none; font-size: 15px; font-weight: 600;
           border-radius: 8px; padding: 13px 28px; margin: 20px 0; }
    .url { font-size: 12px; color: #888; word-break: break-all; margin-top: -8px; }
    .footer { font-size: 12px; color: #aaa; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>You're invited to ${org}</h2>
    <p>${greeting}</p>
    <p>${sender} has invited you to join <strong>${org}</strong> as a
       <strong>${roleName}</strong>.</p>
    <span class="badge">${roleName}</span>
    <p>Click the button below to create your account. You'll set up your
       password and complete your profile during sign-up.</p>
    <a href="${registerUrl}" class="btn">Create my account →</a>
    <p class="url">Or copy this link: ${registerUrl}</p>
    <p>This invitation is for <strong>${toEmail}</strong> only.
       If you weren't expecting this, you can ignore it.</p>
    <div class="footer">
      This email was sent by ${org} · Opal Therapy Scheduling App<br>
      Do not reply to this email.
    </div>
  </div>
</body>
</html>`;

  const text = `
You have been invited to join ${org} as a ${roleName}.

Create your account here:
${registerUrl}

This invitation is for ${toEmail} only.
If you weren't expecting this, you can ignore it.
`.trim();

  const mailOptions = {
    from:    FROM(),
    to:      toEmail,
    subject: `You're invited to ${org}`,
    text,
    html,
  };

  const transport = getTransporter();
  if (!transport) {
    // Email not configured — log the invite link so the owner can share it manually
    console.log(`\n📧  [EMAIL SKIPPED — not configured]`);
    console.log(`    To: ${toEmail}`);
    console.log(`    Role: ${roleName}`);
    console.log(`    Register link: ${registerUrl}\n`);
    return { skipped: true, registerUrl };
  }

  const info = await transport.sendMail(mailOptions);
  console.log(`📧  Invite email sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId, registerUrl };
}

// ── Email: Registration Confirmation ─────────────────────────────────────────

/**
 * Send a welcome email after account creation.
 */
async function sendWelcomeEmail({ toEmail, name, role, orgName }) {
  const org      = escapeHtml(orgName || 'Opal Therapy');
  const appUrl   = BASE();
  const roleName = escapeHtml(roleLabel(role));
  name           = escapeHtml(name);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 10px; max-width: 540px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #5b6af0; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 14px; }
    .btn { display: inline-block; background: #5b6af0; color: #fff !important;
           text-decoration: none; font-size: 15px; font-weight: 600;
           border-radius: 8px; padding: 13px 28px; margin: 20px 0; }
    .footer { font-size: 12px; color: #aaa; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>Welcome to ${org}, ${name}!</h2>
    <p>Your account has been created. You are set up as a <strong>${roleName}</strong>.</p>
    <p>Complete your profile to get started — especially your work location, which
       the app uses for travel calculations.</p>
    <a href="${appUrl}" class="btn">Open ${org} →</a>
    <div class="footer">
      ${org} · Opal Therapy Scheduling App
    </div>
  </div>
</body>
</html>`;

  const transport = getTransporter();
  if (!transport) {
    console.log(`📧  [EMAIL SKIPPED] Welcome email for ${toEmail}`);
    return { skipped: true };
  }

  const info = await transport.sendMail({
    from:    FROM(),
    to:      toEmail,
    subject: `Welcome to ${org}!`,
    html,
    text: `Welcome to ${org}, ${name}!\n\nYour account is ready. Visit ${appUrl} to complete your profile.`,
  });
  console.log(`📧  Welcome email sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

// ── Email: Email Verification ─────────────────────────────────────────────────

/**
 * Send a verification email after signup.
 * @param {object} opts
 * @param {string} opts.toEmail
 * @param {string} opts.token       — raw verification token
 * @param {string} [opts.name]
 */
async function sendVerificationEmail({ toEmail, token, name }) {
  const org      = 'Opal Therapy';
  const verifyUrl = `${BASE()}/verify-email?token=${encodeURIComponent(token)}`;
  const greeting  = name ? `Hi ${escapeHtml(name)},` : 'Hello,';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 10px; max-width: 540px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #5b6af0; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 14px; }
    .btn { display: inline-block; background: #5b6af0; color: #fff !important;
           text-decoration: none; font-size: 15px; font-weight: 600;
           border-radius: 8px; padding: 13px 28px; margin: 20px 0; }
    .note { font-size: 13px; color: #6b7280; background: #f9fafb; border-radius: 6px;
            padding: 10px 14px; margin-top: 8px; }
    .footer { font-size: 12px; color: #aaa; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>Verify your email address</h2>
    <p>${greeting}</p>
    <p>To complete your ${org} account setup, please verify your email address by clicking the button below.</p>
    <a href="${verifyUrl}" class="btn">Verify my email →</a>
    <p class="note">This link expires in <strong>24 hours</strong>. If you didn't create an account, you can safely ignore this email.</p>
    <div class="footer">${org} · Opal Therapy Scheduling App</div>
  </div>
</body>
</html>`;

  const transport = getTransporter();
  if (!transport) {
    console.log(`📧  [EMAIL SKIPPED] Verification email for ${toEmail}`);
    console.log(`📧  Verify URL (dev): ${verifyUrl}`);
    return { skipped: true, verifyUrl };
  }

  const info = await transport.sendMail({
    from:    FROM(),
    to:      toEmail,
    subject: `Verify your email — ${org}`,
    html,
    text: `${greeting}\n\nVerify your ${org} account: ${verifyUrl}\n\nThis link expires in 24 hours.`,
  });
  console.log(`📧  Verification email sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

// ── Email: Password Reset ─────────────────────────────────────────────────────

/**
 * Send a password reset email.
 * @param {object} opts
 * @param {string} opts.toEmail
 * @param {string} opts.token       — raw reset token
 * @param {string} [opts.name]
 */
async function sendPasswordResetEmail({ toEmail, token, name }) {
  const org       = 'Opal Therapy';
  const resetUrl  = `${BASE()}/reset-password?token=${encodeURIComponent(token)}`;
  const greeting  = name ? `Hi ${escapeHtml(name)},` : 'Hello,';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 10px; max-width: 540px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #5b6af0; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 14px; }
    .btn { display: inline-block; background: #5b6af0; color: #fff !important;
           text-decoration: none; font-size: 15px; font-weight: 600;
           border-radius: 8px; padding: 13px 28px; margin: 20px 0; }
    .note { font-size: 13px; color: #6b7280; background: #f9fafb; border-radius: 6px;
            padding: 10px 14px; margin-top: 8px; }
    .footer { font-size: 12px; color: #aaa; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>Reset your password</h2>
    <p>${greeting}</p>
    <p>We received a request to reset the password for your ${org} account. Click the button below to choose a new password.</p>
    <a href="${resetUrl}" class="btn">Reset my password →</a>
    <p class="note">This link expires in <strong>1 hour</strong> and can only be used once. If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
    <div class="footer">${org} · Opal Therapy Scheduling App</div>
  </div>
</body>
</html>`;

  const transport = getTransporter();
  if (!transport) {
    console.log(`📧  [EMAIL SKIPPED] Password reset email for ${toEmail}`);
    console.log(`📧  Reset URL (dev): ${resetUrl}`);
    return { skipped: true, resetUrl };
  }

  const info = await transport.sendMail({
    from:    FROM(),
    to:      toEmail,
    subject: `Reset your password — ${org}`,
    html,
    text: `${greeting}\n\nReset your ${org} password: ${resetUrl}\n\nThis link expires in 1 hour and can only be used once.`,
  });
  console.log(`📧  Password reset email sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

// ── Email: Account Approved ───────────────────────────────────────────────────

/**
 * Notify a user that their account has been approved by an admin.
 */
async function sendAccountApprovedEmail({ toEmail, name, role }) {
  const org      = 'Opal Therapy';
  const appUrl   = BASE();
  const roleName = escapeHtml(roleLabel(role));
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hello,';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; }
    .card { background: #fff; border-radius: 10px; max-width: 540px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #5b6af0; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p  { font-size: 15px; color: #444; line-height: 1.6; margin: 0 0 14px; }
    .badge { display: inline-block; background: #f0fdf4; color: #166534;
             font-size: 13px; font-weight: 600; border-radius: 20px; padding: 4px 12px;
             margin-bottom: 16px; }
    .btn { display: inline-block; background: #5b6af0; color: #fff !important;
           text-decoration: none; font-size: 15px; font-weight: 600;
           border-radius: 8px; padding: 13px 28px; margin: 20px 0; }
    .footer { font-size: 12px; color: #aaa; margin-top: 28px; border-top: 1px solid #eee;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>Your account is approved!</h2>
    <p>${greeting}</p>
    <div class="badge">✓ Account activated — ${roleName}</div>
    <p>Your ${org} account has been approved by the practice administrator. You can now sign in and access the scheduling app.</p>
    <a href="${appUrl}/login" class="btn">Sign in now →</a>
    <p>If you haven't already completed your profile setup, you'll be guided through it on first sign-in.</p>
    <div class="footer">${org} · Opal Therapy Scheduling App</div>
  </div>
</body>
</html>`;

  const transport = getTransporter();
  if (!transport) {
    console.log(`📧  [EMAIL SKIPPED] Account approved email for ${toEmail}`);
    return { skipped: true };
  }

  const info = await transport.sendMail({
    from:    FROM(),
    to:      toEmail,
    subject: `Your ${org} account is approved`,
    html,
    text: `${greeting}\n\nYour ${org} account has been approved as ${roleName}. Sign in at: ${appUrl}/login`,
  });
  console.log(`📧  Account approved email sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId };
}

module.exports = {
  escapeHtml,
  sendInviteEmail,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountApprovedEmail,
  isEmailConfigured,
};
