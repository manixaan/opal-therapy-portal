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

// Test hooks: inject a fake transporter / reset the cached one so unit tests
// can exercise the sent/skipped/failed paths without touching the network.
function _setTransporterForTests(t) { transporter = t; }
function _resetTransporter() { transporter = null; }

// ── Helpers ──────────────────────────────────────────────────────────────────

const FROM = () => process.env.EMAIL_FROM || `Opal Therapy <${process.env.EMAIL_USER}>`;

/**
 * Base URL for every emailed link (invite/verify/reset). APP_BASE_URL is
 * REQUIRED outside development/test (enforced at boot by env-validation and
 * again here): a localhost link delivered to a real user is worse than a
 * hard error, so this fails loudly rather than guessing.
 */
function getBaseUrl() {
  const configured = process.env.APP_BASE_URL;
  if (configured) return configured.replace(/\/$/, '');
  const env = process.env.NODE_ENV || 'development';
  if (env !== 'development' && env !== 'test') {
    throw new Error('APP_BASE_URL is not set — refusing to build a localhost link outside development/test');
  }
  return 'http://localhost:5001';
}
const BASE = getBaseUrl;

/** Registration URL for an invite token — single source of truth for the link shape. */
function buildRegisterUrl(inviteToken) {
  return `${BASE()}/register?token=${encodeURIComponent(inviteToken)}`;
}

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
  const registerUrl = buildRegisterUrl(inviteToken);
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

// ── Email: Letter of offer ──────────────────────────────────────────────────

/** Response URL for an offer token — single source of truth for the shape. */
function buildOfferUrl(token) {
  return `${BASE()}/offer?token=${encodeURIComponent(token)}`;
}

/**
 * Tell a candidate a letter of offer is waiting for them.
 *
 * The TERMS ARE NOT IN THE EMAIL. Salary and employment conditions live behind
 * the link, on a page that answers only to the token, for the same reason the
 * onboarding invitation carries no personal details: an email is forwarded,
 * quoted and archived in places the practice does not control.
 */
async function sendOfferEmail({ toEmail, token, displayName, roleTitle, orgName, expiresAt, isReminder }) {
  const offerUrl = buildOfferUrl(token);
  const org = escapeHtml(orgName || 'Opal Therapy');
  const greeting = displayName ? `Hi ${escapeHtml(String(displayName).split(' ')[0])},` : 'Hello,';
  const role = roleTitle ? escapeHtml(roleTitle) : null;
  const expires = expiresAt ? new Date(expiresAt) : null;
  const expiresText = expires && !Number.isNaN(expires.getTime())
    ? expires.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth' })
    : null;
  const subject = isReminder
    ? `Reminder: your letter of offer from ${orgName || 'Opal Therapy'}`
    : `Your letter of offer from ${orgName || 'Opal Therapy'}`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 24px; color: #241f1a; }
  .card { background: #fff; border-radius: 10px; max-width: 560px; margin: 0 auto; padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  .logo { font-size: 20px; font-weight: 700; color: #0f7c6c; margin-bottom: 28px; }
  h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
  p { font-size: 15px; line-height: 1.6; color: #3a3a4a; margin: 0 0 14px; }
  .btn { display: inline-block; background: #0f7c6c; color: #fff !important; text-decoration: none; padding: 13px 26px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0 18px; }
  .url { font-size: 12px; color: #99928a; word-break: break-all; }
  .footer { font-size: 12px; color: #99928a; margin-top: 28px; border-top: 1px solid #e9e3d9; padding-top: 16px; }
</style></head>
<body><div class="card">
  <div class="logo">🌿 ${org}</div>
  <h2>${isReminder ? 'A reminder about your offer' : 'Your letter of offer'}</h2>
  <p>${greeting}</p>
  <p>${isReminder ? 'Your letter of offer' : 'We are delighted to send you a letter of offer'}${role ? ` for the position of <strong>${role}</strong>` : ''} ${isReminder ? 'is still waiting for your response' : 'is ready for you to read'}. Please use the secure link below to read the full letter and let us know your decision.</p>
  <a href="${offerUrl}" class="btn">Read my letter of offer →</a>
  ${expiresText ? `<p>This link is valid until <strong>${escapeHtml(expiresText)}</strong>.</p>` : ''}
  <p class="url">If the button does not work, copy this address into your browser:<br>${offerUrl}</p>
  <div class="footer">This email was sent by ${org}. If you were not expecting it, you can safely ignore it.</div>
</div></body></html>`;

  const text = `${greeting}\n\n${isReminder ? 'Your letter of offer' : 'We are delighted to send you a letter of offer'}${roleTitle ? ` for the position of ${roleTitle}` : ''} ${isReminder ? 'is still waiting for your response' : 'is ready for you to read'}.\n\nRead it and respond here:\n${offerUrl}\n${expiresText ? `\nThis link is valid until ${expiresText}.\n` : ''}\n${orgName || 'Opal Therapy'}`;

  const result = await sendTemplated({ to: toEmail, subject, html, text });
  return { ...result, offerUrl, subject };
}

// ── Email: Onboarding invitation ─────────────────────────────────────────────

/** Onboarding URL for an invite token — single source of truth for the shape. */
function buildOnboardingInviteUrl(inviteToken) {
  return `${BASE()}/onboarding-invite?token=${encodeURIComponent(inviteToken)}`;
}

/**
 * Invite a new starter to complete their onboarding in the portal.
 *
 * WHAT THIS EMAIL DELIBERATELY DOES NOT CONTAIN
 * ─────────────────────────────────────────────
 *  • No temporary password. The recipient sets their own through the link.
 *  • No employment terms, salary, or personal details — an email is forwarded,
 *    quoted and archived in places the practice does not control.
 *  • No attachments and no completed forms. Everything sensitive is collected
 *    inside the authenticated portal, which is the entire point of the
 *    feature: the old model of emailing a starter pack around as a ZIP is
 *    exactly what this replaces.
 *
 * The email carries one thing: a secure link, and a plain description of what
 * the person will be asked to do when they follow it.
 */
async function sendOnboardingInviteEmail({
  toEmail, inviteToken, displayName, roleTitle, startDate, dueAt, invitedBy, orgName,
}) {
  const onboardingUrl = buildOnboardingInviteUrl(inviteToken);
  const org = escapeHtml(orgName || 'Opal Therapy');
  const greeting = displayName ? `Hi ${escapeHtml(displayName)},` : 'Hello,';
  const sender = escapeHtml(invitedBy || 'The practice owner');
  const role = roleTitle ? escapeHtml(roleTitle) : null;

  const fmtDate = (d) => {
    if (!d) return null;
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
    });
  };
  const start = fmtDate(startDate);
  const due = fmtDate(dueAt);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; color: #241f1a; }
    .card { background: #fff; border-radius: 10px; max-width: 560px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #0f7c6c; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.6; color: #3a3a4a; margin: 0 0 14px; }
    .badge { display: inline-block; background: #e4f2ec; color: #0a5d51; font-size: 13px;
             font-weight: 600; padding: 5px 12px; border-radius: 6px; margin-bottom: 16px; }
    .facts { background: #faf6f0; border-radius: 8px; padding: 14px 18px; margin: 0 0 20px; }
    .facts p { margin: 0 0 6px; font-size: 14px; }
    .facts p:last-child { margin-bottom: 0; }
    ul { font-size: 15px; line-height: 1.7; color: #3a3a4a; padding-left: 20px; margin: 0 0 18px; }
    .btn { display: inline-block; background: #0f7c6c; color: #fff !important; text-decoration: none;
           padding: 13px 26px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0 18px; }
    .url { font-size: 12px; color: #99928a; word-break: break-all; }
    .footer { font-size: 12px; color: #99928a; margin-top: 28px; border-top: 1px solid #e9e3d9;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">🌿 ${org}</div>
    <h2>Welcome to ${org}</h2>
    <p>${greeting}</p>
    <p>We are pleased to begin your onboarding${role ? ` for <strong>${role}</strong>` : ''}.</p>
    ${role ? `<span class="badge">${role}</span>` : ''}
    ${(start || due) ? `<div class="facts">
      ${start ? `<p><strong>Start date:</strong> ${escapeHtml(start)}</p>` : ''}
      ${due ? `<p><strong>Please complete by:</strong> ${escapeHtml(due)}</p>` : ''}
    </div>` : ''}
    <p>Please use the secure link below to complete your onboarding. You will
       create your own password on the first screen.</p>
    <a href="${onboardingUrl}" class="btn">Start my onboarding →</a>
    <p>The onboarding portal will guide you through:</p>
    <ul>
      <li>your employment documents</li>
      <li>your payroll, tax and superannuation information</li>
      <li>your professional credentials</li>
      <li>NDIS requirements</li>
      <li>Opal Therapy policies</li>
      <li>required training</li>
    </ul>
    <p>You can save your progress and come back at any time. Everything you
       provide is entered securely in the portal — please do not email us
       documents containing your tax file number or bank details.</p>
    <p class="url">Or copy this link: ${onboardingUrl}</p>
    <p>This invitation is for <strong>${escapeHtml(toEmail)}</strong> only.
       If you were not expecting it, please let ${sender} know.</p>
    <div class="footer">
      Sent by ${org}<br>
      Do not reply to this email.
    </div>
  </div>
</body>
</html>`;

  const text = `
${displayName ? `Hi ${displayName},` : 'Hello,'}

We are pleased to begin your onboarding${roleTitle ? ` for ${roleTitle}` : ''} at ${orgName || 'Opal Therapy'}.
${start ? `\nStart date: ${start}` : ''}${due ? `\nPlease complete by: ${due}` : ''}

Please use the secure link below to complete your onboarding. You will create
your own password on the first screen.

${onboardingUrl}

The onboarding portal will guide you through:
  - your employment documents
  - your payroll, tax and superannuation information
  - your professional credentials
  - NDIS requirements
  - Opal Therapy policies
  - required training

You can save your progress and come back at any time. Everything you provide is
entered securely in the portal — please do not email us documents containing
your tax file number or bank details.

This invitation is for ${toEmail} only.
`.trim();

  const transport = getTransporter();
  if (!transport) {
    // Not configured — surface the link so the owner can deliver it manually.
    // The link is logged; nothing about the person is.
    console.log('\n📧  [ONBOARDING INVITE SKIPPED — email not configured]');
    console.log(`    To: ${toEmail}`);
    console.log(`    Onboarding link: ${onboardingUrl}\n`);
    return { skipped: true, onboardingUrl };
  }

  const info = await transport.sendMail({
    from: FROM(),
    to: toEmail,
    subject: `Welcome to ${orgName || 'Opal Therapy'} — start your onboarding`,
    text,
    html,
  });
  console.log(`📧  Onboarding invite sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId, onboardingUrl };
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

/**
 * Sign-in details for a new starter whose account the Owner has just created.
 *
 * DIFFERENT FROM sendOnboardingInviteEmail, and the difference is the point.
 * That one carries a single-use link on which the recipient CHOOSES a
 * password. This one is for the other path the practice uses: the Owner has
 * created the account and the system has issued a temporary password.
 *
 * WHETHER THE PASSWORD TRAVELS IN THIS EMAIL IS THE OWNER'S CALL, NOT OURS.
 * `temporaryPassword` is optional. Omit it and the email says the practice
 * will pass the password on separately — which is the safer habit, because an
 * email is forwarded, quoted and archived in places nobody controls. Include
 * it and the email is self-contained, which is what a practice with one
 * administrator and a new starter on a phone will actually want. The portal
 * records which way it went (onboarding_email_dispatches) and neither choice
 * is made silently.
 *
 * What is NOT negotiable: the password is temporary, expires, and cannot reach
 * anything except the change-password screen until it is replaced. That is
 * enforced server-side at requireAuth, not by this email's wording.
 */
async function sendEmployeeLoginInviteEmail({
  toEmail, displayName, roleTitle, orgName, invitedBy, temporaryPassword, startDate,
}) {
  const loginUrl = `${BASE()}/login`;
  const org = escapeHtml(orgName || 'Opal Therapy');
  const greeting = displayName ? `Hi ${escapeHtml(String(displayName).split(' ')[0])},` : 'Hello,';
  const sender = escapeHtml(invitedBy || 'The practice owner');
  const role = roleTitle ? escapeHtml(roleTitle) : null;

  const fmtDate = (d) => {
    if (!d) return null;
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
    });
  };
  const start = fmtDate(startDate);

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
           background: #f5f5f5; margin: 0; padding: 24px; color: #241f1a; }
    .card { background: #fff; border-radius: 10px; max-width: 560px; margin: 0 auto;
            padding: 36px 40px; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .logo { font-size: 20px; font-weight: 700; color: #0f7c6c; margin-bottom: 28px; }
    h2 { font-size: 22px; font-weight: 700; color: #1a1a2e; margin: 0 0 12px; }
    p { font-size: 15px; line-height: 1.6; color: #3a3a4a; margin: 0 0 14px; }
    ul { font-size: 15px; line-height: 1.7; color: #3a3a4a; padding-left: 20px; margin: 0 0 18px; }
    .creds { background: #faf6f0; border-radius: 8px; padding: 16px 18px; margin: 0 0 20px;
             border: 1px solid #e9e3d9; }
    .creds p { margin: 0 0 8px; font-size: 14px; }
    .creds p:last-child { margin-bottom: 0; }
    .creds code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 15px;
                  background: #fff; padding: 3px 8px; border-radius: 4px; border: 1px solid #e9e3d9; }
    .btn { display: inline-block; background: #0f7c6c; color: #fff !important; text-decoration: none;
           padding: 13px 26px; border-radius: 8px; font-weight: 600; font-size: 15px; margin: 8px 0 18px; }
    .url { font-size: 12px; color: #99928a; word-break: break-all; }
    .footer { font-size: 12px; color: #99928a; margin-top: 28px; border-top: 1px solid #e9e3d9;
              padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">&#127807; ${org}</div>
    <h2>Your ${org} account is ready</h2>
    <p>${greeting}</p>
    <p>Thank you for returning your forms${role ? ` for <strong>${role}</strong>` : ''}.
       Your portal account is set up and waiting for you.</p>
    ${start ? `<p>Your start date is <strong>${escapeHtml(start)}</strong>.</p>` : ''}
    <div class="creds">
      <p><strong>Sign in with</strong></p>
      <p>Email: <code>${escapeHtml(toEmail)}</code></p>
      ${temporaryPassword
    ? `<p>Temporary password: <code>${escapeHtml(temporaryPassword)}</code></p>`
    : '<p>Password: we will pass this on to you separately.</p>'}
    </div>
    <a href="${loginUrl}" class="btn">Sign in &rarr;</a>
    <p class="url">${escapeHtml(loginUrl)}</p>
    <p><strong>You will be asked to choose your own password straight away.</strong>
       The one above is temporary and stops working as soon as you replace it.</p>
    <p>After that you will go to <em>Complete your onboarding</em>, where the details you
       gave us on the forms are already filled in. You will mostly be checking that we
       have them right, and adding anything we are still missing:</p>
    <ul>
      <li>your personal and emergency contact details</li>
      <li>your tax and superannuation information</li>
      <li>your professional credentials</li>
      <li>the policies we need you to read and acknowledge</li>
    </ul>
    <p>You can save as you go and come back at any time.</p>
    <p>If anything looks wrong, or you did not expect this email, just reply and let us know.</p>
    <div class="footer">
      ${sender}<br>${org}
    </div>
  </div>
</body>
</html>`;

  const text = [
    greeting,
    '',
    `Thank you for returning your forms${roleTitle ? ` for ${roleTitle}` : ''}.`,
    'Your portal account is ready.',
    start ? `Your start date is ${start}.` : '',
    '',
    'Sign in at: ' + loginUrl,
    `Email: ${toEmail}`,
    temporaryPassword
      ? `Temporary password: ${temporaryPassword}`
      : 'Password: we will pass this on to you separately.',
    '',
    'You will be asked to choose your own password straight away. The temporary one',
    'stops working as soon as you replace it.',
    '',
    'After that you will go to "Complete your onboarding", where the details from your',
    'forms are already filled in. You will mostly be checking them and adding anything',
    'still missing. You can save as you go.',
    '',
    invitedBy || '',
    orgName || 'Opal Therapy',
  ].filter((l) => l !== '').join('\n');

  const transport = getTransporter();
  const subject = `Your ${orgName || 'Opal Therapy'} sign-in details`;
  if (!transport) {
    console.log(`\u{1F4E7}  [EMAIL SKIPPED] ${subject} -> ${toEmail}`);
    return { skipped: true, loginUrl };
  }
  const info = await transport.sendMail({ from: FROM(), to: toEmail, subject, html, text });
  console.log(`\u{1F4E7}  Login invitation sent to ${toEmail} (${info.messageId})`);
  return { sent: true, messageId: info.messageId, loginUrl };
}

/**
 * The largest single attachment this transport will carry, and how many.
 *
 * Microsoft 365 rejects a message above 25 MB and counts the BASE64 size,
 * which is a third larger than the bytes. 18 MB raw is the last size that
 * reliably fits once headers and MIME overhead are added. A caller should
 * choose a download link well before this; the cap exists so that one which
 * did not gets a clear local error rather than a silent bounce two hops away.
 */
const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;
const MAX_ATTACHMENTS = 5;

/**
 * Send an already-composed message through the shared transport.
 *
 * Every other sender here owns its subject and its HTML because every other
 * message is one fixed template. A feature whose message depends on data only
 * it holds — a starter pack's document list, an agreement's terms — composes
 * its own subject and body, but it MUST NOT create its own transporter: a
 * second nodemailer instance would bypass _setTransporterForTests, and a test
 * that thought it had stubbed email would quietly send a real one.
 *
 * Same three-state contract as the rest of this module: `{ skipped: true }`
 * when SMTP is unconfigured, `{ sent: true, messageId }` on success, and a
 * thrown error on failure.
 */
async function sendTemplated({ to, subject, html, text, attachments }) {
  const transport = getTransporter();
  if (!transport) {
    console.log(`📧  [EMAIL SKIPPED] ${subject} → ${to}`);
    return { skipped: true };
  }
  const message = { from: FROM(), to, subject, html, text };

  // ATTACHMENTS. Deliberately absent from every fixed template above, and the
  // onboarding INVITE keeps that rule: a link into the authenticated portal is
  // safer than a document sitting in a mailbox nobody controls.
  //
  // A starter pack is the one genuine exception, and it is an exception on the
  // facts rather than on convenience. It carries no personal information at
  // all — it is the practice's own policies and BLANK forms going out to
  // somebody who has no account yet, which is exactly why it cannot be a
  // portal link. Refusing to attach it would make nothing safer; it would move
  // the same files into whatever the Owner reached for instead.
  //
  // Buffers only, size-capped, and never more than a few, so this cannot
  // quietly become an arbitrary file-sending API.
  if (Array.isArray(attachments) && attachments.length) {
    if (attachments.length > MAX_ATTACHMENTS) {
      throw new Error('Too many attachments');
    }
    message.attachments = attachments.map((a) => {
      if (!a || !Buffer.isBuffer(a.content)) {
        throw new Error('Attachment content must be a Buffer');
      }
      if (a.content.length > MAX_ATTACHMENT_BYTES) {
        throw new Error('Attachment exceeds the size limit');
      }
      return {
        filename: String(a.filename || 'attachment')
          .replace(/[/\\]/g, '_')
          .replace(/\.{2,}/g, '.')
          .slice(0, 200),
        content: a.content,
        contentType: String(a.contentType || 'application/octet-stream').slice(0, 100),
      };
    });
  }

  const info = await transport.sendMail(message);
  return { sent: true, messageId: info.messageId };
}

module.exports = {
  escapeHtml,
  sendTemplated,
  sendInviteEmail,
  sendOnboardingInviteEmail,
  sendEmployeeLoginInviteEmail,
  buildOnboardingInviteUrl,
  sendOfferEmail,
  buildOfferUrl,
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendAccountApprovedEmail,
  isEmailConfigured,
  getBaseUrl,
  buildRegisterUrl,
  _setTransporterForTests,
  _resetTransporter,
};
