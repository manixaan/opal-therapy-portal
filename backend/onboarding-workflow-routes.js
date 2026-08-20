'use strict';

/**
 * THE ONBOARDING JOURNEY — starter pack, returned documents, account.
 *
 * 034 gave the practice a requirement workflow and a secure invitation. This
 * file adds the part that happens on paper first, which is how a small
 * practice actually onboards somebody:
 *
 *   generate the pack -> email it -> the forms come back -> upload them ->
 *   read them -> review what was read -> create the account -> invite them in
 *
 * Every step is resumable and every step is idempotent, because the Owner will
 * double-click, the network will drop, and an SMTP server will be down on the
 * day somebody starts. Nothing here loses a generated pack, an uploaded form
 * or a reviewed field because a later step failed.
 *
 * ── WHAT IS NOT NEW HERE ───────────────────────────────────────────────────
 * The assignment, its pinned package version, the requirement snapshot, the
 * four permission-tiered employee tables, the encryption, the audit allowlist,
 * the document library and its storage abstraction are all 034's, used as-is.
 * The account this file creates is an ordinary portal user made through the
 * ordinary bcrypt path; the only new mechanism is the temporary credential and
 * the gate that forces it to be replaced.
 *
 * ── PERMISSIONS ────────────────────────────────────────────────────────────
 * Reused, not invented. `onboarding.assign` prepares and sends; `.review`
 * handles returned documents and extraction; `.payroll` and
 * `.sensitive_identity` gate the values a reviewer may actually see; and
 * creating a portal account requires `.activate` AND the owner role, because
 * minting a login is the one action in this file that hands somebody a way in.
 */

const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const db = require('./database');
const email = require('./email');
const odb = require('./onboarding-db');
const wdb = require('./onboarding-workflow-db');
const engine = require('./onboarding-engine');
const starterPack = require('./onboarding-starter-pack');
const extraction = require('./onboarding-extraction');
const accounts = require('./onboarding-accounts');
const graphMail = require('./graph-mail');
const gateway = require('./ai/ai-gateway');
const { auditOnboarding } = require('./onboarding-audit');
const { requireAuth, requirePermission, hasPermission } = require('./permissions');
const log = require('./logger').createLogger('onboarding-workflow');

const { isUuid, str } = odb;
const orgOf = (req) => req.user?.organisation_id || null;

const safe = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((err) => {
  log.error('workflow route error', { error: err, path: req.path });
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' });
});
const notFound = (res) => res.status(404).json({ error: 'Not found' });

/** Sensitive bytes and one-time secrets must not sit in any cache. */
function noStore(res) {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('Pragma', 'no-cache');
  res.set('X-Content-Type-Options', 'nosniff');
}

/**
 * The reader's sensitive tiers, as the masking layer wants them.
 *
 * Computed per request from the live permission set rather than cached: an
 * Owner revoking `onboarding.payroll` should take effect on the next request,
 * which is exactly what requireAuth's per-request user reload already gives us.
 */
function capsOf(req) {
  return {
    payroll: hasPermission(req.user, 'onboarding.payroll'),
    sensitiveIdentity: hasPermission(req.user, 'onboarding.sensitive_identity'),
  };
}

/**
 * The practice's own name, and where completed forms should be sent back.
 *
 * The organisation record is the authority on the name — the onboarding
 * settings blob has no such key, and defaulting to a hard-coded "Opal Therapy"
 * would put the wrong practice's name on the pack of anyone else who ever runs
 * this code. The return address defaults to the Owner sending the pack, which
 * is who the employee would reply to anyway.
 */
async function practiceDetails(req, assignment) {
  const settings = await odb.getOnboardingSettings();
  let name = null;
  try {
    const { rows } = await odb.pool.query(
      'SELECT name FROM organisations WHERE id = $1',
      [assignment ? assignment.organisation_id : orgOf(req)]
    );
    name = rows[0]?.name || null;
  } catch (err) {
    log.warn('organisation name unavailable', { error: err });
  }
  return {
    settings,
    orgName: settings.organisationName || name || 'Opal Therapy',
    returnEmail: settings.returnEmail || req.user?.email || null,
  };
}

/** Load an assignment scoped to the caller's organisation, or null. */
async function loadAssignment(req) {
  if (!isUuid(req.params.id)) return null;
  return odb.getAssignment(orgOf(req), req.params.id);
}

/**
 * Move an assignment forward, never backward.
 *
 * The journey is ordered, and an out-of-order write — a late "documents
 * received" landing after an account already exists — must not undo real
 * progress. Comparing ordinals makes that structural instead of a rule
 * everybody has to remember at each call site.
 */
const JOURNEY_ORDER = [
  'created', 'starter_pack_ready', 'starter_pack_sent', 'documents_received',
  'details_extracted', 'ready_for_account', 'account_created', 'invite_sent',
  'invite_accepted', 'in_progress', 'employee_actions_complete', 'employer_review',
  'corrections_required', 'ready_to_activate', 'activated', 'completed',
];

async function advanceStatus(assignmentId, current, next, extraSets = {}, q = odb.pool) {
  const from = JOURNEY_ORDER.indexOf(current);
  const to = JOURNEY_ORDER.indexOf(next);
  const sets = ['last_activity_at = NOW()', 'updated_at = NOW()'];
  const params = [assignmentId];

  if (to > from && from !== -1 && to !== -1) {
    params.push(next);
    sets.push(`status = $${params.length}`);
  }
  for (const [col, value] of Object.entries(extraSets)) {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  }
  await q.query(`UPDATE onboarding_assignments SET ${sets.join(', ')} WHERE id = $1`, params);
  return to > from ? next : current;
}

// ═════════════════════════════════════════════════════════════════════════════
//  PACKAGE RECOMMENDATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Score the assignable packages against a role and employment type.
 *
 * A SUGGESTION, never a selection. The Owner picks; this only saves them
 * reading six near-identical names to find the obvious one. Returning a score
 * and a reason rather than a single answer is what keeps it that way — a UI
 * that shows "we think this one, because…" invites a check, and a UI that
 * silently pre-selects does not.
 */
function scorePackage(pkg, { roleCategory, employmentType }) {
  let score = 0;
  const reasons = [];
  if (roleCategory && pkg.role_category === roleCategory) { score += 60; reasons.push('role'); }
  if (employmentType && pkg.employment_type === employmentType) { score += 40; reasons.push('employment type'); }
  // A package that names no role/type is a general fallback; it should rank
  // below any genuine match but above an actively contradictory one.
  if (!pkg.role_category && !pkg.employment_type) score += 10;
  if (roleCategory && pkg.role_category && pkg.role_category !== roleCategory) score -= 40;
  if (employmentType && pkg.employment_type && pkg.employment_type !== employmentType) score -= 30;
  return { score, reasons };
}

router.get('/api/onboarding/packages/recommend', requireAuth,
  requirePermission('onboarding.assign'), safe(async (req, res) => {
    const roleCategory = str(req.query.roleCategory, 40) || null;
    const employmentType = engine.EMPLOYMENT_TYPES.includes(req.query.employmentType)
      ? req.query.employmentType : null;

    const all = await odb.listPackages(orgOf(req), { kind: 'package' });
    const assignable = all.filter((p) => p.status === 'published' && Number(p.current_version) > 0);

    const ranked = assignable
      .map((p) => {
        const { score, reasons } = scorePackage(p, { roleCategory, employmentType });
        return {
          packageId: p.id,
          title: p.title,
          roleCategory: p.role_category,
          employmentType: p.employment_type,
          assignedCount: Number(p.assignment_count || 0),
          score,
          reason: reasons.length
            ? `Matches the ${reasons.join(' and ')} you chose.`
            : 'Applies to any role.',
        };
      })
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    const best = ranked[0];
    res.json({
      ok: true,
      // Only offered as a recommendation when something actually matched.
      // Presenting the top of a list of non-matches as "recommended" would be
      // a confident-sounding guess, which is worse than no suggestion.
      recommended: best && best.score > 0 ? best : null,
      packages: ranked,
      // Packages that cannot be assigned, with the reason, so an Owner who
      // expected one to appear is told why it did not.
      unavailable: all
        .filter((p) => p.kind === 'package' && !(p.status === 'published' && Number(p.current_version) > 0))
        .map((p) => ({
          packageId: p.id,
          title: p.title,
          reason: p.status === 'archived' ? 'Archived — no longer offered to new starters'
            : Number(p.current_version) > 0 ? 'Not published'
              : 'Has never been published',
        })),
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  STARTER PACK — generate, download, send
// ═════════════════════════════════════════════════════════════════════════════

router.use('/api/onboarding/assignments', requireAuth);

router.post('/api/onboarding/assignments/:id/starter-pack',
  requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    if (['cancelled', 'archived'].includes(assignment.status)) {
      return res.status(409).json({ error: 'This onboarding is closed.' });
    }

    const version = await odb.getPackageVersion(assignment.package_version_id);
    if (!version) return res.status(409).json({ error: 'The pinned package version is missing' });

    const pinned = starterPack.fromVersionContent(version.content);
    if (pinned.legacy) {
      return res.status(409).json({
        error: 'This package version was published before starter packs existed.',
        code: 'legacy_version',
        message: 'Publish the package again to record which documents belong in its starter pack, '
          + 'then update this onboarding to the new version.',
      });
    }
    if (!pinned.documents.length) {
      return res.status(409).json({
        error: 'This package has no starter-pack documents.',
        code: 'empty_pack',
        message: 'Add documents to the package, publish it, then try again.',
        omissions: pinned.omissions,
      });
    }

    // Idempotency: an existing live pack built from the SAME package version is
    // returned rather than rebuilt. A double-clicked button, or a retried
    // request, cannot produce a second ZIP or invalidate a link already emailed.
    const existing = await wdb.getLiveStarterPack(assignment.id);
    if (existing && existing.package_version_id === assignment.package_version_id
        && req.body?.regenerate !== true) {
      return res.json({ ok: true, reused: true, starterPack: packRow(existing) });
    }

    const practice = await practiceDetails(req, assignment);
    const built = await starterPack.buildZip(pinned.documents, {
      employeeName: assignment.applicant_name,
      orgName: practice.orgName,
      roleTitle: assignment.job_title || assignment.package_title,
      startDate: assignment.start_date,
      dueDate: assignment.due_at,
      returnEmail: practice.returnEmail,
      contactName: req.user.name || null,
    });

    if (!built.manifest.length) {
      return res.status(409).json({
        error: 'None of this package\'s documents could be read.',
        code: 'no_readable_documents',
        omissions: built.omissions,
      });
    }

    const row = await wdb.createStarterPack({
      organisationId: orgOf(req),
      assignmentId: assignment.id,
      packageId: assignment.package_id,
      packageVersionId: assignment.package_version_id,
      packageVersion: assignment.package_version,
      manifest: built.manifest,
      omissions: [...pinned.omissions, ...built.omissions],
      fileName: built.fileName,
      buffer: built.buffer,
      generatedBy: req.user.id,
    });

    await advanceStatus(assignment.id, assignment.status, 'starter_pack_ready', {
      starter_pack_generated_at: new Date(),
    });

    await auditOnboarding(req, 'starter_pack_generated', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, starterPackId: row.id,
        packageVersionId: assignment.package_version_id,
        documentCount: built.manifest.length,
        omissionCount: built.omissions.length,
        sizeBytes: built.buffer.length, sha256: row.file_sha256,
      },
    });

    res.status(201).json({ ok: true, reused: false, starterPack: packRow(row) });
  }));

function packRow(p) {
  return {
    id: p.id,
    fileName: p.file_name,
    sizeBytes: p.file_size_bytes,
    sha256: p.file_sha256,
    documentCount: p.document_count,
    packageVersion: p.package_version,
    manifest: Array.isArray(p.manifest) ? p.manifest.map((m) => ({
      position: m.position, title: m.title, fileName: m.fileName,
      // documentId as well as the code: the Owner's pack list links each entry
      // to its preview and its history, and building that link from a code
      // would mean a second lookup for something already known here.
      documentId: m.documentId, documentCode: m.documentCode,
      documentVersion: m.documentVersion,
      sourceVersionLabel: m.sourceVersionLabel || null, sizeBytes: m.sizeBytes,
    })) : [],
    omissions: Array.isArray(p.omissions) ? p.omissions : [],
    status: p.status,
    generatedAt: p.generated_at,
    downloadCount: p.download_count,
    lastDownloadedAt: p.last_downloaded_at,
    supersededAt: p.superseded_at,
  };
}

router.get('/api/onboarding/assignments/:id/starter-pack',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const live = await wdb.getLiveStarterPack(assignment.id);
    const version = await odb.getPackageVersion(assignment.package_version_id);
    const pinned = version ? starterPack.fromVersionContent(version.content) : null;

    res.json({
      ok: true,
      starterPack: live ? packRow(live) : null,
      history: await wdb.listStarterPacks(assignment.id),
      dispatches: await wdb.listDispatches(assignment.id),
      // What the CURRENT pinned version would produce, so an Owner can see the
      // pack before generating it.
      pinnedDocuments: pinned ? pinned.documents.map((d) => ({
        position: d.position, title: d.title, documentCode: d.documentCode,
        documentVersion: d.documentVersion, sourceVersionLabel: d.sourceVersionLabel,
        sizeBytes: d.fileSizeBytes,
      })) : [],
      pinnedOmissions: pinned ? pinned.omissions : [],
      legacyVersion: pinned ? pinned.legacy : false,
    });
  }));

/** Authenticated download, for the Owner. */
router.get('/api/onboarding/assignments/:id/starter-pack/download',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const pack = await wdb.getLiveStarterPack(assignment.id);
    if (!pack) return notFound(res);

    const bytes = await wdb.readStarterPackBytes(pack).catch(() => null);
    if (!bytes) {
      log.warn('starter pack bytes unreadable', { starterPackId: pack.id });
      return res.status(404).json({ error: 'That starter pack could not be read from storage.' });
    }

    await wdb.recordDownload(pack.id);
    await auditOnboarding(req, 'starter_pack_downloaded', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id, starterPackId: pack.id },
    });

    noStore(res);
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition',
      `attachment; filename="${starterPack.safeStem(pack.file_name || 'Starter Pack')}.zip"`);
    res.send(bytes);
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  SEND STARTER PACK
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Attachment ceiling for the SMTP path.
 *
 * Microsoft 365 accepts 25 MB per message but counts the base64-encoded size,
 * which is a third larger than the bytes. 15 MB raw leaves comfortable room
 * for the message and MIME overhead; anything larger takes the secure-link
 * path rather than being rejected at the far end, where the Owner would find
 * out days later from a confused new starter.
 */
const MAX_SMTP_ATTACHMENT_BYTES = 15 * 1024 * 1024;

function starterPackEmail({ assignment, orgName, packFileName, downloadUrl, senderName, dueDate }) {
  const esc = email.escapeHtml;
  const firstName = String(assignment.applicant_name || '').trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${esc(firstName)},` : 'Hello,';
  const role = assignment.job_title || assignment.package_title;
  const fmt = (d) => {
    if (!d) return null;
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
    });
  };
  const due = fmt(dueDate);
  const start = fmt(assignment.start_date);

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#241f1a;}
 .card{background:#fff;border-radius:10px;max-width:560px;margin:0 auto;padding:36px 40px;box-shadow:0 2px 8px rgba(0,0,0,.08);}
 .logo{font-size:20px;font-weight:700;color:#0f7c6c;margin-bottom:28px;}
 h2{font-size:22px;font-weight:700;color:#1a1a2e;margin:0 0 12px;}
 p{font-size:15px;line-height:1.6;color:#3a3a4a;margin:0 0 14px;}
 ul{font-size:15px;line-height:1.7;color:#3a3a4a;padding-left:20px;margin:0 0 18px;}
 .facts{background:#faf6f0;border-radius:8px;padding:14px 18px;margin:0 0 20px;}
 .facts p{margin:0 0 6px;font-size:14px;}
 .facts p:last-child{margin-bottom:0;}
 .btn{display:inline-block;background:#0f7c6c;color:#fff !important;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600;font-size:15px;margin:8px 0 18px;}
 .url{font-size:12px;color:#99928a;word-break:break-all;}
 .footer{font-size:12px;color:#99928a;margin-top:28px;border-top:1px solid #e9e3d9;padding-top:16px;}
</style></head>
<body><div class="card">
  <div class="logo">🌿 ${esc(orgName)}</div>
  <h2>Welcome to ${esc(orgName)}</h2>
  <p>${greeting}</p>
  <p>We are delighted you are joining us${role ? ` as <strong>${esc(role)}</strong>` : ''}.
     Everything we need before your first day is in the starter pack
     ${downloadUrl ? 'linked below' : 'attached to this email'}.</p>
  ${(start || due) ? `<div class="facts">
    ${start ? `<p><strong>Your start date:</strong> ${esc(start)}</p>` : ''}
    ${due ? `<p><strong>Please return your forms by:</strong> ${esc(due)}</p>` : ''}
  </div>` : ''}
  ${downloadUrl ? `<a href="${downloadUrl}" class="btn">Download my starter pack →</a>
    <p class="url">${esc(downloadUrl)}</p>` : ''}
  <p>Inside you will find:</p>
  <ul>
    <li>a short read-me explaining what to complete</li>
    <li>the forms we need back from you</li>
    <li>the policies and information statements you are entitled to receive</li>
  </ul>
  <p><strong>What to do next.</strong> Read the pack, complete the forms, and reply to this
     email with them attached. Scans and clear photographs are both fine.</p>
  <p>Once we have them we will set up your portal account and send you a sign-in link.
     Your details will already be filled in, so you will only need to check them.</p>
  <p><strong>Please do not email your tax file number.</strong> You will enter that directly
     into the secure portal once your account is ready.</p>
  <p>If anything is unclear, just reply to this email.</p>
  <div class="footer">
    ${esc(senderName || orgName)}<br>${esc(orgName)}
  </div>
</div></body></html>`;

  const text = [
    greeting.replace(/<[^>]+>/g, ''),
    '',
    `We are delighted you are joining ${orgName}${role ? ` as ${role}` : ''}.`,
    downloadUrl
      ? `Your starter pack is here: ${downloadUrl}`
      : `Your starter pack (${packFileName}) is attached to this email.`,
    '',
    start ? `Your start date: ${start}` : '',
    due ? `Please return your forms by: ${due}` : '',
    '',
    'Read the pack, complete the forms, and reply to this email with them attached.',
    'Once we have them we will set up your portal account and send you a sign-in link.',
    '',
    'Please do NOT email your tax file number — you will enter that in the secure portal.',
    '',
    senderName || orgName,
    orgName,
  ].filter((l) => l !== '').join('\n');

  return {
    subject: `Your ${orgName} starter pack${firstName ? ` — ${assignment.applicant_name}` : ''}`,
    html,
    text,
  };
}

router.post('/api/onboarding/assignments/:id/starter-pack/send',
  requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const pack = await wdb.getLiveStarterPack(assignment.id);
    if (!pack) {
      return res.status(409).json({
        error: 'Generate the starter pack first.', code: 'no_pack',
      });
    }

    const toEmail = str(req.body?.toEmail, 255) || assignment.applicant_email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: 'That is not a valid email address.' });
    }

    const { orgName } = await practiceDetails(req, assignment);

    const bytes = await wdb.readStarterPackBytes(pack).catch(() => null);
    if (!bytes) {
      await wdb.recordDispatch({
        organisationId: orgOf(req), assignmentId: assignment.id, starterPackId: pack.id,
        kind: 'starter_pack', toEmail, method: 'smtp', status: 'failed',
        errorReason: 'pack_unreadable', requestedBy: req.user.id,
      });
      return res.status(500).json({
        error: 'The starter pack could not be read from storage.',
        code: 'pack_unreadable',
        message: 'Your onboarding is safe. Regenerate the pack and try again.',
      });
    }

    // Oversize packs travel as a secure link rather than an attachment (§62).
    // The Owner's experience does not change; what changes is what arrives.
    const method = req.body?.method === 'graph_draft' ? 'graph_draft' : 'smtp';
    const ceiling = method === 'graph_draft'
      ? graphMail.MAX_SIMPLE_ATTACHMENT_BYTES : MAX_SMTP_ATTACHMENT_BYTES;
    const useLink = bytes.length > ceiling;

    let downloadUrl = null;
    if (useLink) {
      const token = await wdb.issueDownloadToken(pack.id, { days: 21 });
      // Straight at the endpoint rather than through a landing page: the link
      // does exactly one thing, and a page whose only content is a second
      // button is friction, not reassurance.
      downloadUrl = `${email.getBaseUrl()}/api/onboarding/starter-pack/download`
        + `?token=${encodeURIComponent(token)}`;
    }

    const composed = starterPackEmail({
      assignment, orgName,
      packFileName: pack.file_name,
      downloadUrl,
      senderName: req.user.name || null,
      dueDate: assignment.due_at,
    });

    let outcome;
    if (method === 'graph_draft') {
      outcome = await sendViaGraphDraft(req, {
        toEmail, composed, bytes: useLink ? null : bytes, pack,
      });
    } else {
      outcome = await sendViaSmtp({
        toEmail, composed, bytes: useLink ? null : bytes, pack,
      });
    }

    await wdb.recordDispatch({
      organisationId: orgOf(req), assignmentId: assignment.id, starterPackId: pack.id,
      kind: 'starter_pack', toEmail, subject: composed.subject,
      method: outcome.method, status: outcome.status,
      attachmentIncluded: outcome.attached === true,
      attachmentBytes: outcome.attached ? bytes.length : null,
      downloadLinkUsed: useLink,
      providerMessageId: outcome.messageId, providerDraftId: outcome.draftId,
      webLink: outcome.webLink, errorReason: outcome.errorReason,
      requestedBy: req.user.id,
    });

    // A failed email must never lose the onboarding. The pack stays, the
    // status only advances when something actually left the building, and the
    // Owner is handed a way to deliver it by hand.
    const delivered = outcome.status === 'sent' || outcome.status === 'draft_created';
    if (delivered) {
      await advanceStatus(assignment.id, assignment.status, 'starter_pack_sent', {
        starter_pack_sent_at: new Date(),
        starter_pack_sent_to: toEmail,
      });
    }

    await auditOnboarding(req, 'starter_pack_sent', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, starterPackId: pack.id,
        method: outcome.method, status: outcome.status,
        attachmentIncluded: outcome.attached === true,
        attachmentBytes: outcome.attached ? bytes.length : null,
        downloadLinkUsed: useLink,
        emailSent: outcome.status === 'sent',
        emailSkipped: outcome.status === 'skipped',
        emailFailed: outcome.status === 'failed',
      },
    });

    const status = outcome.status === 'failed' ? 502 : 200;
    res.status(status).json({
      ok: outcome.status !== 'failed',
      status: outcome.status,
      method: outcome.method,
      attached: outcome.attached === true,
      downloadLinkUsed: useLink,
      webLink: outcome.webLink || null,
      message: outcome.message,
      // Always returned, so a failed send is recoverable by hand.
      downloadPath: `/api/onboarding/assignments/${assignment.id}/starter-pack/download`,
      error: outcome.status === 'failed' ? outcome.message : undefined,
    });
  }));

async function sendViaSmtp({ toEmail, composed, bytes, pack }) {
  if (!email.isEmailConfigured()) {
    return {
      method: 'smtp', status: 'skipped', attached: false,
      message: 'Email is not configured for this practice. Download the pack and send it yourself.',
    };
  }
  try {
    const result = await email.sendTemplated({
      to: toEmail,
      subject: composed.subject,
      html: composed.html,
      text: composed.text,
      attachments: bytes ? [{
        filename: pack.file_name || 'Starter Pack.zip',
        content: bytes,
        contentType: 'application/zip',
      }] : undefined,
    });
    if (result.skipped) {
      return {
        method: 'smtp', status: 'skipped', attached: false,
        message: 'Email is not configured. Download the pack and send it yourself.',
      };
    }
    return {
      method: 'smtp', status: 'sent', attached: !!bytes, messageId: result.messageId,
      message: bytes
        ? 'Starter pack sent with the documents attached.'
        : 'Starter pack sent with a secure download link.',
    };
  } catch (err) {
    log.warn('starter pack email failed', { error: err });
    return {
      method: 'smtp', status: 'failed', attached: false,
      errorReason: 'smtp_error',
      message: 'We could not send the email just now. Your starter pack is still saved — please try again.',
    };
  }
}

/**
 * Prepare the message as a draft in the Owner's own Outlook.
 *
 * Requires a Microsoft scope the portal does not yet hold, so this reports its
 * own unavailability rather than failing obscurely — see graph-mail.js.
 */
async function sendViaGraphDraft(req, { toEmail, composed, bytes, pack }) {
  const reason = graphMail.unavailableReason(req.user);
  if (reason) {
    return {
      method: 'graph_draft', status: 'failed', attached: false,
      errorReason: 'graph_unavailable', message: reason,
    };
  }

  const accessToken = await graphMail.getAccessToken(req.user);
  if (!accessToken) {
    return {
      method: 'graph_draft', status: 'failed', attached: false,
      errorReason: 'graph_no_token',
      message: 'Your Microsoft connection needs renewing. Reconnect it from Settings → Integrations.',
    };
  }

  const draft = await graphMail.createDraft({
    accessToken, to: toEmail, subject: composed.subject, html: composed.html,
    attachment: bytes, attachmentName: pack.file_name, attachmentMime: 'application/zip',
  });
  if (!draft.ok) {
    return {
      method: 'graph_draft', status: 'failed', attached: false,
      errorReason: draft.code, message: draft.reason,
    };
  }
  return {
    method: 'graph_draft', status: 'draft_created', attached: !!bytes,
    draftId: draft.id, webLink: draft.webLink,
    message: 'A draft is waiting in your Outlook. Read it over and press Send.',
  };
}

/**
 * Token download — the oversize-pack fallback.
 *
 * Unauthenticated by necessity: the recipient has no account yet. What makes
 * it safe is that the token authorises exactly one thing (download this one
 * ZIP), is 256 bits of randomness, is stored only as a hash, and expires.
 */
router.get('/api/onboarding/starter-pack/download', safe(async (req, res) => {
  const pack = await wdb.redeemDownloadToken(req.query.token);
  if (!pack) {
    return res.status(404).json({
      error: 'That link is not valid or has expired. Please ask the practice to send a new one.',
    });
  }
  const bytes = await wdb.readStarterPackBytes(pack).catch(() => null);
  if (!bytes) return res.status(404).json({ error: 'That starter pack is no longer available.' });

  await wdb.recordDownload(pack.id);
  await db.logAuditEvent({
    actorUserId: null, action: 'onboarding.starter_pack_downloaded',
    targetType: 'onboarding_assignment', targetId: pack.assignment_id,
    organisationId: pack.organisation_id, ipAddress: req.ip,
    metadata: { starterPackId: pack.id, viaLink: true },
  }).catch(() => {});

  noStore(res);
  res.set('Content-Type', 'application/zip');
  res.set('Content-Disposition',
    `attachment; filename="${starterPack.safeStem(pack.file_name || 'Starter Pack')}.zip"`);
  res.send(bytes);
}));

// ═════════════════════════════════════════════════════════════════════════════
//  RETURNED DOCUMENTS
// ═════════════════════════════════════════════════════════════════════════════

/**
 * What the practice will accept back.
 *
 * Identical to the employee-evidence allowlist in onboarding-employee-routes,
 * plus text/plain: executables, HTML and SVG are refused, and the extension
 * must agree with the declared MIME type so a .exe cannot arrive labelled as a
 * PDF.
 */
const RETURN_ALLOWED = {
  'application/pdf': ['pdf'],
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'text/plain': ['txt'],
};
const MAX_RETURN_BASE64 = 14 * 1024 * 1024; // ≈ 10 MB binary
const MAX_RETURN_FILES = 12;

function validateReturnedFile(file) {
  if (!file || typeof file !== 'object') return 'Each file must be an object';
  if (!file.fileData) return 'A file is required';
  if (typeof file.fileData !== 'string' || file.fileData.length > MAX_RETURN_BASE64) {
    return 'That file is larger than 10 MB';
  }
  const exts = RETURN_ALLOWED[String(file.fileMime || '').toLowerCase()];
  if (!exts) return 'File type not allowed. Accepted: PDF, PNG, JPEG, DOC, DOCX, TXT';
  const ext = String(file.fileName || '').split('.').pop().toLowerCase();
  if (!exts.includes(ext)) return `A ".${ext}" file does not match the declared type`;
  if (/[/\\]|\.\./.test(String(file.fileName || ''))) return 'That file name is not allowed';
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(String(file.fileData).slice(0, 1000))) {
    return 'File content must be base64-encoded';
  }
  return null;
}

router.post('/api/onboarding/assignments/:id/returned-documents',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    if (['cancelled', 'archived'].includes(assignment.status)) {
      return res.status(409).json({ error: 'This onboarding is closed.' });
    }

    const files = Array.isArray(req.body?.files) ? req.body.files
      : (req.body?.fileData ? [req.body] : []);
    if (!files.length) return res.status(400).json({ error: 'At least one file is required' });
    if (files.length > MAX_RETURN_FILES) {
      return res.status(413).json({ error: `Please upload at most ${MAX_RETURN_FILES} files at a time.` });
    }

    const stored = [];
    const rejected = [];

    for (const file of files) {
      const problem = validateReturnedFile(file);
      if (problem) {
        rejected.push({ fileName: str(file?.fileName, 255) || 'unnamed', reason: problem });
        continue;
      }
      const buffer = Buffer.from(file.fileData, 'base64');

      // Read the text NOW rather than at extraction time: it is cheap, it is
      // the answer to "can this be read at all?", and the Owner needs that
      // answer while they are still looking at the upload — not two clicks
      // later when extraction returns nothing.
      let text = { status: 'pending', pages: [], chars: 0 };
      try {
        text = await extraction.readDocumentText(buffer, file.fileMime);
      } catch (err) {
        log.warn('returned document text read failed', { error: err });
        text = { status: 'failed', pages: [], chars: 0 };
      }

      const { row, duplicate } = await wdb.createReturnedDocument({
        organisationId: orgOf(req),
        assignmentId: assignment.id,
        title: str(file.title, 250) || str(file.fileName, 250),
        fileName: str(file.fileName, 255),
        fileMime: str(file.fileMime, 100),
        buffer,
        uploadedBy: req.user.id,
        pageCount: text.pages.length || null,
        textStatus: text.status,
        textChars: text.chars,
      });

      stored.push({ ...returnedRow(row), duplicate });
      if (!duplicate) {
        await auditOnboarding(req, 'returned_document_uploaded', {
          targetType: 'onboarding_assignment', targetId: assignment.id,
          metadata: {
            assignmentId: assignment.id, returnedDocumentId: row.id,
            fileName: row.file_name, mimeType: row.file_mime,
            sizeBytes: row.file_size_bytes, sha256: row.file_sha256,
            pageCount: row.page_count, textStatus: row.text_status,
          },
        });
      }
    }

    if (stored.some((s) => !s.duplicate)) {
      await advanceStatus(assignment.id, assignment.status, 'documents_received', {
        documents_received_at: new Date(),
      });
    }

    const readable = stored.filter((s) => s.textStatus === 'extracted').length;
    res.status(201).json({
      ok: true,
      stored,
      rejected,
      readable,
      // Said plainly, because a scanned pack is the common case rather than the
      // exception, and an Owner who is told now will not wait for an extraction
      // that was never going to find anything.
      message: readable === 0 && stored.length
        ? 'These look like scans or photographs. We cannot read text from them, '
          + 'so you will need to enter the details yourself.'
        : null,
    });
  }));

function returnedRow(d) {
  return {
    id: d.id,
    title: d.title,
    fileName: d.file_name,
    fileMime: d.file_mime,
    sizeBytes: d.file_size_bytes,
    pageCount: d.page_count,
    textStatus: d.text_status,
    readable: d.text_status === 'extracted',
    status: d.status,
    uploadedAt: d.uploaded_at,
    previewKind: d.file_mime === 'application/pdf' ? 'pdf'
      : (d.file_mime || '').includes('wordprocessingml') ? 'docx' : null,
  };
}

router.get('/api/onboarding/assignments/:id/returned-documents',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    const rows = await wdb.listReturnedDocuments(assignment.id, {
      includeArchived: req.query.includeArchived === 'true',
    });
    res.json({
      ok: true,
      documents: rows.map((d) => ({
        ...returnedRow(d),
        previewUrl: `/api/onboarding/assignments/${assignment.id}/returned-documents/${d.id}/preview`,
        downloadUrl: `/api/onboarding/assignments/${assignment.id}/returned-documents/${d.id}/download`,
      })),
    });
  }));

/** Inline bytes for the shared document viewer. */
router.get('/api/onboarding/assignments/:id/returned-documents/:docId/preview',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    await serveReturned(req, res, 'inline');
  }));

router.get('/api/onboarding/assignments/:id/returned-documents/:docId/download',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    await serveReturned(req, res, 'attachment');
  }));

async function serveReturned(req, res, disposition) {
  const assignment = await loadAssignment(req);
  if (!assignment) return notFound(res);
  const doc = await wdb.getReturnedDocument(assignment.id, req.params.docId);
  if (!doc) return notFound(res);

  const bytes = await wdb.readReturnedDocumentBytes(doc).catch(() => null);
  if (!bytes) return res.status(404).json({ error: 'That document could not be read.' });

  noStore(res);
  res.set('Content-Type', doc.file_mime || 'application/octet-stream');
  res.set('Content-Disposition',
    `${disposition}; filename="${starterPack.safeStem(doc.file_name || 'document')}.`
    + `${String(doc.file_name || '').split('.').pop().toLowerCase() || 'bin'}"`);
  return res.send(bytes);
}

router.delete('/api/onboarding/assignments/:id/returned-documents/:docId',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    const ok = await wdb.archiveReturnedDocument(assignment.id, req.params.docId, req.user.id);
    if (!ok) return notFound(res);

    await auditOnboarding(req, 'returned_document_archived', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: { assignmentId: assignment.id, returnedDocumentId: req.params.docId },
    });
    // Archived, not deleted — the file remains an employment record.
    res.json({ ok: true, archived: true });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  EXTRACTION
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/onboarding/assignments/:id/extraction',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    if (!gateway.isAvailable(extraction.AI_FEATURE)) {
      const reason = gateway.unavailableReason(extraction.AI_FEATURE);
      return res.status(503).json({
        error: 'Reading documents is not available just now.',
        // The gateway's reason is a machine code — 'region_not_configured',
        // 'ai_globally_disabled:setting'. It is exactly right for a log and
        // exactly wrong on an Owner's screen, so it travels in `code` and the
        // sentence beside it is written for a person.
        code: reason || 'ai_unavailable',
        message: aiUnavailableText(reason),
      });
    }

    const docs = await wdb.listReturnedDocuments(assignment.id);
    const readable = docs.filter((d) => d.text_status === 'extracted');
    if (!docs.length) {
      return res.status(409).json({ error: 'Upload the returned documents first.', code: 'no_documents' });
    }
    if (!readable.length) {
      return res.status(409).json({
        error: 'None of these documents contains readable text.',
        code: 'no_readable_text',
        message: 'They are most likely scans or photographs. Enter the details manually — '
          + 'the employee will be asked to check them either way.',
      });
    }

    const { run, joined } = await wdb.startRun({
      organisationId: orgOf(req),
      assignmentId: assignment.id,
      documentCount: readable.length,
      requestedBy: req.user.id,
    });
    if (joined) {
      return res.status(202).json({ ok: true, joined: true, runId: run.id, status: run.status });
    }

    await auditOnboarding(req, 'extraction_started', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, runId: run.id,
        documentCount: docs.length, readableCount: readable.length,
      },
    });

    let outcome;
    try {
      outcome = await runExtraction(req, assignment, readable, run);
    } catch (err) {
      const reason = err instanceof gateway.AiPolicyError ? err.reason
        : err.code === 'ENCRYPTION_UNAVAILABLE' ? 'encryption_unavailable'
          : 'extraction_failed';
      await wdb.finishRun(run.id, { status: 'failed', errorReason: reason });
      log.warn('extraction failed', { error: err, runId: run.id });
      return res.status(err.code === 'ENCRYPTION_UNAVAILABLE' ? 503 : 502).json({
        error: 'We could not read those documents.',
        code: reason,
        message: err.code === 'ENCRYPTION_UNAVAILABLE'
          ? 'Field encryption is not configured, so bank details cannot be stored. '
            + 'Set ONBOARDING_ENCRYPTION_KEY, then try again.'
          : 'Your documents are safe. You can try again, or enter the details yourself.',
      });
    }

    await advanceStatus(assignment.id, assignment.status, 'details_extracted', {
      extraction_completed_at: new Date(),
    });

    await auditOnboarding(req, 'extraction_completed', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, runId: run.id,
        fieldsProposed: outcome.stored, readableCount: readable.length,
      },
    });

    res.status(201).json({
      ok: true,
      runId: run.id,
      fieldsProposed: outcome.stored,
      fieldsSkipped: outcome.skipped,
      notes: outcome.notes || null,
      summary: await wdb.reviewSummary(assignment.id),
    });
  }));

/**
 * Say why document reading is off, in a sentence rather than a code.
 *
 * Each case has a different remedy and a different owner: a kill switch is
 * somebody's deliberate decision, a missing region is a deployment setting,
 * and neither is something the person looking at this screen can fix. What
 * they CAN do is type the details in, so every branch ends by saying so.
 */
function aiUnavailableText(reason) {
  const code = String(reason || '');
  if (code.startsWith('ai_globally_disabled')) {
    return 'AI features are switched off for this practice. '
      + 'Enter the details yourself, or ask your administrator to turn them back on.';
  }
  if (code.startsWith('region_')) {
    return 'This portal is not configured to read documents yet. '
      + 'Enter the details yourself — your uploads are saved either way.';
  }
  if (code.startsWith('unknown_feature') || code.startsWith('ai_boundary')) {
    return 'Document reading is not available in this version of the portal. '
      + 'Enter the details yourself.';
  }
  return 'Enter the details yourself, and try reading again later. '
    + 'Your uploaded documents are saved either way.';
}

/**
 * Read the documents and store the proposals.
 *
 * Runs inline rather than on a queue. That is a deliberate call for this
 * workload: a handful of form pages is a single model call of a few seconds,
 * and a background job would add a state machine, a sweeper and a polling UI
 * to save an Owner from a short spinner. If pack sizes ever make this slow the
 * seam is already here — the run row exists, with `queued` in its CHECK.
 */
async function runExtraction(req, assignment, readableDocs, run) {
  const corpusDocs = [];
  const byIndex = new Map();

  let index = 0;
  for (const meta of readableDocs) {
    const doc = await wdb.getReturnedDocument(assignment.id, meta.id);
    if (!doc) continue;
    const bytes = await wdb.readReturnedDocumentBytes(doc).catch(() => null);
    if (!bytes) continue;
    const text = await extraction.readDocumentText(bytes, doc.file_mime);
    if (text.status !== 'extracted') {
      await wdb.setReturnedDocumentText(doc.id, {
        textStatus: text.status, textChars: text.chars, pageCount: text.pages.length,
      });
      continue;
    }
    index += 1;
    const entry = { index, id: doc.id, title: doc.title || doc.file_name, pages: text.pages };
    corpusDocs.push(entry);
    byIndex.set(index, entry);
  }

  if (!corpusDocs.length) {
    await wdb.finishRun(run.id, { status: 'failed', readableCount: 0, errorReason: 'no_readable_text' });
    const err = new Error('no_readable_text');
    err.code = 'NO_READABLE_TEXT';
    throw err;
  }

  const corpus = extraction.buildCorpus(corpusDocs);
  const answer = await extraction.callModel({
    corpus: corpus.text,
    userId: req.user.id,
    organisationId: orgOf(req),
  });

  const { fields, dropped } = extraction.normaliseFields(answer.fields, byIndex);

  let stored = 0;
  for (const field of fields) {
    const row = await wdb.upsertProposedField({
      organisationId: orgOf(req),
      assignmentId: assignment.id,
      runId: run.id,
      field,
    });
    if (row) stored += 1;
  }

  await wdb.finishRun(run.id, {
    status: stored ? 'succeeded' : 'partial',
    readableCount: corpusDocs.length,
    fieldCount: stored,
    modelKey: answer.meta?.modelKey || null,
    provider: answer.meta?.provider || null,
    aiAuditId: answer.meta?.interactionId || null,
  });

  return { stored, skipped: dropped, notes: answer.notes };
}

router.get('/api/onboarding/assignments/:id/extraction',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const caps = capsOf(req);
    const fields = await wdb.listExtractedFields(assignment.id, caps);
    const run = await wdb.getLatestRun(assignment.id);

    // A read of somebody's payroll or identity data is itself an event worth
    // recording — the same discipline the tiered assignment reads already use.
    if (caps.payroll || caps.sensitiveIdentity) {
      await auditOnboarding(req, 'extracted_details_viewed', {
        targetType: 'onboarding_assignment', targetId: assignment.id,
        metadata: {
          assignmentId: assignment.id,
          sensitivity: caps.payroll ? 'payroll' : 'identity',
        },
      });
    }

    const groups = extraction.GROUP_ORDER
      .map((key) => ({
        key,
        label: extraction.GROUP_LABELS[key],
        fields: fields.filter((f) => f.group === key),
      }))
      .filter((g) => g.fields.length);

    res.json({
      ok: true,
      status: assignment.status,
      run: run ? {
        id: run.id, status: run.status, fieldCount: run.field_count,
        documentCount: run.document_count, readableCount: run.readable_count,
        errorReason: run.error_reason, startedAt: run.started_at, finishedAt: run.finished_at,
      } : null,
      groups,
      summary: await wdb.reviewSummary(assignment.id),
      canSeePayroll: caps.payroll,
      canSeeIdentity: caps.sensitiveIdentity,
      aiAvailable: gateway.isAvailable(extraction.AI_FEATURE),
    });
  }));

router.patch('/api/onboarding/assignments/:id/extraction/fields/:fieldId',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const existing = await wdb.getExtractedField(assignment.id, req.params.fieldId);
    if (!existing) return notFound(res);

    // A reviewer who may not SEE a value may not silently overwrite it either.
    const needed = extraction.requiredPermissionFor(existing.field_key);
    if (needed !== 'onboarding.review' && !hasPermission(req.user, needed)) {
      return res.status(403).json({
        error: 'Forbidden', message: `Missing permission: ${needed}`,
      });
    }

    const decision = String(req.body?.decision || '');
    if (!['accept', 'correct', 'reject'].includes(decision)) {
      return res.status(400).json({ error: 'decision must be accept, correct or reject' });
    }

    let row;
    try {
      row = await wdb.reviewField(assignment.id, req.params.fieldId, {
        decision, value: req.body?.value,
        actorUserId: req.user.id, actorRole: req.user.role,
      });
    } catch (err) {
      if (err.code === 'INVALID_VALUE') {
        return res.status(400).json({
          error: `That is not a valid ${extraction.FIELDS[existing.field_key]?.label || 'value'}.`,
          code: 'invalid_value',
        });
      }
      if (err.code === 'ENCRYPTION_UNAVAILABLE') {
        return res.status(503).json({
          error: 'Field encryption is not configured.', code: 'ENCRYPTION_UNAVAILABLE',
        });
      }
      throw err;
    }
    if (!row) return notFound(res);

    await auditOnboarding(req, 'extracted_field_reviewed', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, fieldId: row.id, field: row.field_key,
        fieldGroup: row.field_group, decision, toStatus: row.status,
        sensitivity: row.sensitivity,
      },
    });

    const caps = capsOf(req);
    const fields = await wdb.listExtractedFields(assignment.id, caps);
    res.json({
      ok: true,
      field: fields.find((f) => f.id === row.id) || null,
      summary: await wdb.reviewSummary(assignment.id),
    });
  }));

/**
 * Write the confirmed values into the canonical employee record.
 *
 * This is the moment a proposal becomes a fact, and it only happens for fields
 * a person accepted or corrected. Everything is written through 034's existing
 * writers — which encrypt, mask and stamp `updated_by` — so this step adds no
 * new path to the sensitive tables.
 *
 * Runs before OR after account creation. Before it, there is no user row to
 * attach to, so the values wait; the create-account step calls this again.
 */
router.post('/api/onboarding/assignments/:id/extraction/apply',
  requirePermission('onboarding.review'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const summary = await wdb.reviewSummary(assignment.id);
    if (!summary || !summary.total) {
      return res.status(409).json({ error: 'There is nothing to apply yet.', code: 'no_fields' });
    }

    const result = await applyExtractedFields(req, assignment);

    await advanceStatus(assignment.id, assignment.status, 'ready_for_account', {
      details_reviewed_at: new Date(),
      details_reviewed_by: req.user.id,
    });

    await auditOnboarding(req, 'extracted_details_applied', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id,
        fieldsApplied: result.applied,
        fieldsAccepted: summary.confirmed,
      },
    });

    res.json({
      ok: true,
      applied: result.applied,
      pending: result.pending,
      message: result.pending
        ? 'Saved. The remaining details will be written to the employee record when their account is created.'
        : 'Employee record updated.',
      summary: await wdb.reviewSummary(assignment.id),
    });
  }));

/**
 * Write accepted/corrected values into the four tiered tables.
 *
 * Without a user row there is nowhere to write yet — the proposals stay
 * accepted and `pending` comes back true, so the Owner is told the truth
 * rather than shown a success that did nothing.
 */
async function applyExtractedFields(req, assignment) {
  const { byTarget, applied } = await wdb.collectApplicable(assignment.id);
  const userId = assignment.user_id;
  if (!userId) return { applied: 0, pending: applied.length };

  const org = assignment.organisation_id;
  let written = 0;

  const personal = byTarget.personal || {};
  if (Object.keys(personal).length) {
    await odb.upsertPersonalDetails(userId, org, {
      assignmentId: assignment.id,
      legalFirstName: personal.legal_first_name,
      middleName: personal.middle_name,
      surname: personal.surname,
      preferredName: personal.preferred_name,
      dateOfBirth: personal.date_of_birth,
      personalEmail: personal.personal_email,
      mobile: personal.mobile,
      addressLine1: personal.address_line1,
      addressLine2: personal.address_line2,
      suburb: personal.suburb,
      state: personal.state,
      postcode: personal.postcode,
      postalLine1: personal.postal_line1,
      postalSuburb: personal.postal_suburb,
      postalState: personal.postal_state,
      postalPostcode: personal.postal_postcode,
      emergencyName: personal.emergency_name,
      emergencyRelationship: personal.emergency_relationship,
      emergencyPhone: personal.emergency_phone,
      emergencyAltPhone: personal.emergency_alt_phone,
      // completed_at is stamped by the writer either way; what marks these
      // details as CONFIRMED is the requirement's own status, which only the
      // employee's submission can move. An extraction is our reading of their
      // handwriting, not their sign-off.
    });
    written += Object.keys(personal).length;
  }

  const employment = byTarget.employment || {};
  if (Object.keys(employment).length) {
    await odb.upsertEmploymentProfile(userId, org, {
      assignmentId: assignment.id,
      jobTitle: employment.job_title || assignment.job_title,
      employmentType: employment.employment_type || assignment.employment_type,
      roleCategory: assignment.role_category,
      startDate: employment.start_date || assignment.start_date,
      hoursPerWeek: employment.hours_per_week,
      awardClassification: employment.award_classification,
      workLocation: employment.work_location || assignment.work_location,
      childRelatedWork: assignment.facts?.child_related_work || 'assessment_required',
      ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
      status: 'onboarding',
    });
    written += Object.keys(employment).length;
  }

  const payroll = byTarget.payroll || {};
  if (payroll.bsb || payroll.account_number || payroll.account_holder_name) {
    await odb.savePayrollBank(userId, org, {
      assignmentId: assignment.id,
      accountHolderName: payroll.account_holder_name,
      bsb: payroll.bsb,
      accountNumber: payroll.account_number,
    }, req.user.id);
    written += 3;
  }
  if (payroll.super_fund_name || payroll.super_fund_usi || payroll.super_member_number) {
    await odb.savePayrollSuper(userId, org, {
      assignmentId: assignment.id,
      superChoiceType: payroll.super_choice_type || 'employee_choice',
      superFundName: payroll.super_fund_name,
      superFundUsi: payroll.super_fund_usi,
      superMemberNumber: payroll.super_member_number,
    }, req.user.id);
    written += 3;
  }

  for (const field of applied) {
    await wdb.markApplied(field.id, `${field.target}.${field.column}`);
  }
  return { applied: applied.length, pending: 0, written };
}

// ═════════════════════════════════════════════════════════════════════════════
//  PORTAL ACCOUNT
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create the account and issue a temporary password.
 *
 * OWNER-GATED ON ROLE AS WELL AS PERMISSION. `onboarding.activate` is
 * delegable, and it should be — an authorised Admin can finish somebody's
 * onboarding. Minting a login credential is a different act: it is the one
 * thing in this file that hands somebody a way into the practice, so it stays
 * with the practice owner.
 */
router.post('/api/onboarding/assignments/:id/account',
  requirePermission('onboarding.activate'), safe(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Only the practice owner can create a portal account.',
      });
    }

    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    if (['cancelled', 'archived'].includes(assignment.status)) {
      return res.status(409).json({ error: 'This onboarding is closed.' });
    }

    const roleChoice = accounts.resolvePortalRole(req.body?.portalRole || 'employee');
    if (!roleChoice.ok) return res.status(400).json({ error: roleChoice.error });

    const loginEmail = String(req.body?.loginEmail || assignment.login_email
      || assignment.applicant_email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginEmail) || loginEmail.length > 255) {
      return res.status(400).json({ error: 'That is not a valid login email address.' });
    }

    // Refuse to create an account that will be asked for a TFN we cannot
    // encrypt — the same gate the release route already applies.
    if (!odb.isEncryptionConfigured()
        && process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
      return res.status(503).json({
        error: 'Field encryption is not configured',
        message: 'ONBOARDING_ENCRYPTION_KEY must be set before onboarding can collect tax or bank details.',
        code: 'ENCRYPTION_UNAVAILABLE',
      });
    }

    // Idempotency: an account already made for this onboarding is reported,
    // not remade. A retried request cannot mint a second credential and
    // silently invalidate the one already emailed.
    if (assignment.account_created_at && assignment.user_id) {
      return res.status(409).json({
        error: 'A portal account already exists for this onboarding.',
        code: 'account_exists',
        message: 'Use "Reissue temporary password" if they need a new one.',
        userId: assignment.user_id,
      });
    }

    const existingUser = await db.getUserByEmail(loginEmail);
    const target = accounts.classifyAccountTarget(existingUser, assignment);
    if (target.action === 'conflict') {
      return res.status(409).json({
        error: target.reason, code: 'email_in_use',
        existingUserName: existingUser?.name || null,
      });
    }

    const version = await odb.getPackageVersion(assignment.package_version_id);
    if (!version) return res.status(409).json({ error: 'The pinned package version is missing' });
    const settings = await odb.getOnboardingSettings();

    const tempPassword = accounts.generateTemporaryPassword();
    const passwordHash = await accounts.hashPassword(tempPassword);
    const expiresAt = accounts.temporaryPasswordExpiry(req.body?.expiresInDays);

    const outcome = await odb.withTransaction(async (q) => {
      let userId = target.userId || null;

      if (userId) {
        await q.query(
          `UPDATE users
              SET email = LOWER($2), name = COALESCE($3, name), role = 'pre_employee',
                  organisation_id = $4, is_active = TRUE, account_status = 'active',
                  email_verified = FALSE, profile_completed = TRUE,
                  password_hash = $5, password_is_temporary = TRUE,
                  must_change_password = TRUE, temp_password_expires_at = $6,
                  temp_password_issued_at = NOW(), temp_password_issued_by = $7,
                  is_treating_therapist = $8, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1`,
          [
            userId, loginEmail, assignment.applicant_name, assignment.organisation_id,
            passwordHash, expiresAt, req.user.id, assignment.is_treating_therapist,
          ]
        );
      } else {
        const { rows } = await q.query(
          `INSERT INTO users
             (email, name, role, organisation_id, is_active, account_status, email_verified,
              profile_completed, is_treating_therapist, password_hash,
              password_is_temporary, must_change_password, temp_password_expires_at,
              temp_password_issued_at, temp_password_issued_by)
           VALUES (LOWER($1), $2, 'pre_employee', $3, TRUE, 'active', FALSE, TRUE, $4,
                   $5, TRUE, TRUE, $6, NOW(), $7)
           RETURNING id`,
          [
            loginEmail, assignment.applicant_name, assignment.organisation_id,
            assignment.is_treating_therapist, passwordHash, expiresAt, req.user.id,
          ]
        );
        userId = rows[0].id;
      }

      // The requirement list, materialised from the pinned snapshot. Reuses
      // the release path's own function so there is one definition of what an
      // onboarding actually asks for.
      const issued = await require('./onboarding-assignment-routes')
        ._materialiseRequirements(q, { ...assignment, user_id: userId }, version.content, settings);

      await require('./onboarding-learning-bridge')
        .assignLearningForOnboarding(q, { ...assignment, user_id: userId })
        .catch(() => 0);

      await odb.upsertEmploymentProfile(userId, assignment.organisation_id, {
        assignmentId: assignment.id,
        jobTitle: assignment.job_title,
        employmentType: assignment.employment_type,
        roleCategory: assignment.role_category,
        startDate: assignment.start_date,
        endDate: assignment.end_date,
        managerUserId: assignment.manager_user_id,
        workLocation: assignment.work_location,
        childRelatedWork: assignment.facts?.child_related_work || 'assessment_required',
        ndisRiskAssessedRole: assignment.facts?.ndis_risk_assessed_role || 'requires_determination',
        mobileCommunityRole: assignment.facts?.mobile_community_role === true,
        usesOwnVehicle: assignment.facts?.uses_own_vehicle === true,
        determinedBy: req.user.id,
        determinedAt: new Date(),
        status: 'onboarding',
      }, q);

      await q.query(
        `UPDATE onboarding_assignments
            SET user_id = $2, login_email = $3, proposed_role = $4,
                status = 'account_created', account_created_at = NOW(),
                account_created_by = $5, last_activity_at = NOW(), updated_at = NOW()
          WHERE id = $1`,
        [assignment.id, userId, loginEmail, roleChoice.role, req.user.id]
      );

      await odb.recomputeAssignment(q, assignment.id);
      return { userId, issued };
    });

    // Now that a user row exists, the reviewed details can land on it.
    const refreshed = await odb.getAssignment(orgOf(req), assignment.id);
    let appliedFields = 0;
    try {
      const applyResult = await applyExtractedFields(req, refreshed);
      appliedFields = applyResult.applied;
    } catch (err) {
      // The account is the important artefact and it already exists. A failed
      // apply is retryable from the review screen and must not roll it back.
      log.warn('applying extracted details after account creation failed', {
        error: err, assignmentId: assignment.id,
      });
    }

    await auditOnboarding(req, 'portal_account_created', {
      targetType: 'user', targetId: outcome.userId,
      metadata: {
        assignmentId: assignment.id, subjectUserId: outcome.userId,
        portalRole: roleChoice.key, accountRole: roleChoice.role,
        requirementCount: outcome.issued, fieldsApplied: appliedFields,
        tempPasswordIssued: true,
      },
    });

    // The plaintext credential leaves the server exactly once, here, and is
    // never cached, never logged and never stored.
    noStore(res);
    res.status(201).json({
      ok: true,
      userId: outcome.userId,
      loginEmail,
      portalRole: roleChoice.key,
      portalRoleLabel: accounts.PORTAL_ROLES[roleChoice.key].label,
      requirementsIssued: outcome.issued,
      fieldsApplied: appliedFields,
      temporaryPassword: tempPassword,
      temporaryPasswordExpiresAt: expiresAt,
      loginUrl: `${email.getBaseUrl()}/login`,
      notice: 'This is the only time this password is shown. Send the invitation now, '
        + 'or copy it somewhere safe.',
    });
  }));

/**
 * Issue a fresh temporary password.
 *
 * The remedy for the expired credential and the lost email alike (§51). It
 * replaces the standing password, so the previous one stops working the moment
 * this succeeds — which is what makes it safe to have handed the old one out.
 */
router.post('/api/onboarding/assignments/:id/account/reissue-password',
  requirePermission('onboarding.activate'), safe(async (req, res) => {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        error: 'Forbidden', message: 'Only the practice owner can issue a temporary password.',
      });
    }
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    if (!assignment.user_id) {
      return res.status(409).json({ error: 'No portal account has been created yet.', code: 'no_account' });
    }

    const user = await db.getUser(assignment.user_id);
    if (!user) return notFound(res);
    // Once somebody has chosen their own password, an Owner may not silently
    // replace it. That is a password RESET, and it belongs to the user via the
    // forgotten-password flow — not to an administrator via this button.
    if (user.password_hash && user.password_is_temporary !== true) {
      return res.status(409).json({
        error: 'This person has already set their own password.',
        code: 'password_already_set',
        message: 'Ask them to use "Forgot password" on the sign-in page.',
      });
    }

    const tempPassword = accounts.generateTemporaryPassword();
    const passwordHash = await accounts.hashPassword(tempPassword);
    const expiresAt = accounts.temporaryPasswordExpiry(req.body?.expiresInDays);

    await odb.pool.query(
      `UPDATE users
          SET password_hash = $2, password_is_temporary = TRUE, must_change_password = TRUE,
              temp_password_expires_at = $3, temp_password_issued_at = NOW(),
              temp_password_issued_by = $4, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [assignment.user_id, passwordHash, expiresAt, req.user.id]
    );

    await auditOnboarding(req, 'temporary_password_reissued', {
      targetType: 'user', targetId: assignment.user_id,
      metadata: {
        assignmentId: assignment.id, subjectUserId: assignment.user_id,
        tempPasswordIssued: true,
      },
    });

    noStore(res);
    res.json({
      ok: true,
      temporaryPassword: tempPassword,
      temporaryPasswordExpiresAt: expiresAt,
      loginUrl: `${email.getBaseUrl()}/login`,
      notice: 'The previous temporary password no longer works.',
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  LOGIN INVITATION
// ═════════════════════════════════════════════════════════════════════════════

router.post('/api/onboarding/assignments/:id/account/invite',
  requirePermission('onboarding.assign'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);
    if (!assignment.user_id || !assignment.account_created_at) {
      return res.status(409).json({ error: 'Create the portal account first.', code: 'no_account' });
    }

    const { orgName } = await practiceDetails(req, assignment);
    const loginEmail = assignment.login_email || assignment.applicant_email;

    // The password is carried only when the Owner passes it back from the
    // create-account response they are looking at. The server cannot recover
    // it — it was hashed the moment it was made — so an Owner who has lost it
    // reissues rather than resends.
    const temporaryPassword = typeof req.body?.temporaryPassword === 'string'
      && req.body.temporaryPassword.length <= 200
      ? req.body.temporaryPassword : null;

    let outcome;
    try {
      const result = await email.sendEmployeeLoginInviteEmail({
        toEmail: loginEmail,
        displayName: assignment.applicant_name,
        roleTitle: assignment.job_title || assignment.package_title,
        orgName,
        invitedBy: req.user.name || req.user.email,
        temporaryPassword,
        startDate: assignment.start_date,
      });
      outcome = result.skipped
        ? { status: 'skipped', message: 'Email is not configured. Send the sign-in details yourself.' }
        : { status: 'sent', messageId: result.messageId, message: `Sign-in details sent to ${loginEmail}.` };
    } catch (err) {
      log.warn('login invitation email failed', { error: err, assignmentId: assignment.id });
      outcome = {
        status: 'failed',
        message: 'We could not send the email. The account exists and the password still works — '
          + 'you can pass the details on yourself.',
      };
    }

    await wdb.recordDispatch({
      organisationId: orgOf(req), assignmentId: assignment.id,
      kind: 'login_invitation', toEmail: loginEmail,
      subject: 'Your Opal Therapy sign-in details',
      method: 'smtp', status: outcome.status,
      providerMessageId: outcome.messageId,
      errorReason: outcome.status === 'failed' ? 'smtp_error' : null,
      requestedBy: req.user.id,
    });

    if (outcome.status === 'sent' || outcome.status === 'skipped') {
      await advanceStatus(assignment.id, assignment.status, 'invite_sent', {
        invitation_sent_at: new Date(),
      });
    }

    await auditOnboarding(req, 'login_invitation_sent', {
      targetType: 'onboarding_assignment', targetId: assignment.id,
      metadata: {
        assignmentId: assignment.id, subjectUserId: assignment.user_id,
        emailSent: outcome.status === 'sent',
        emailSkipped: outcome.status === 'skipped',
        emailFailed: outcome.status === 'failed',
        // Whether the credential travelled in the email. Recorded because it
        // is a real risk decision the Owner made, and a reviewer should be
        // able to see which way it went.
        tempPasswordIssued: !!temporaryPassword,
      },
    });

    res.status(outcome.status === 'failed' ? 502 : 200).json({
      ok: outcome.status !== 'failed',
      status: outcome.status,
      message: outcome.message,
      loginUrl: `${email.getBaseUrl()}/login`,
      loginEmail,
      error: outcome.status === 'failed' ? outcome.message : undefined,
    });
  }));

// ═════════════════════════════════════════════════════════════════════════════
//  THE WORKSPACE — everything about one onboarding, in one call
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The Owner's command centre for a single onboarding.
 *
 * One request rather than seven, because the screen shows one thing: where
 * this person is and what to do next. Splitting it across endpoints would put
 * the job of assembling that answer in the browser, where it would be
 * reassembled slightly differently by every caller.
 */
router.get('/api/onboarding/assignments/:id/journey',
  requirePermission('onboarding.view'), safe(async (req, res) => {
    const assignment = await loadAssignment(req);
    if (!assignment) return notFound(res);

    const caps = capsOf(req);
    const [pack, returned, run, summary, dispatches] = await Promise.all([
      wdb.getLiveStarterPack(assignment.id),
      wdb.listReturnedDocuments(assignment.id),
      wdb.getLatestRun(assignment.id),
      wdb.reviewSummary(assignment.id),
      wdb.listDispatches(assignment.id),
    ]);

    const steps = buildJourneySteps(assignment, { pack, returned, run, summary });
    res.json({
      ok: true,
      assignment: {
        id: assignment.id,
        name: assignment.applicant_name,
        email: assignment.applicant_email,
        loginEmail: assignment.login_email,
        jobTitle: assignment.job_title,
        packageTitle: assignment.package_title,
        employmentType: assignment.employment_type,
        status: assignment.status,
        statusLabel: statusLabel(assignment.status),
        startDate: assignment.start_date,
        dueAt: assignment.due_at,
        userId: assignment.user_id,
        proposedRole: assignment.proposed_role,
      },
      steps,
      progressPercent: Math.round(
        (steps.filter((s) => s.state === 'done').length / steps.length) * 100
      ),
      nextAction: steps.find((s) => s.state === 'current') || null,
      starterPack: pack ? packRow(pack) : null,
      returnedDocuments: returned.map(returnedRow),
      extraction: {
        run: run ? { id: run.id, status: run.status, fieldCount: run.field_count } : null,
        summary,
      },
      dispatches,
      canSeePayroll: caps.payroll,
      canCreateAccount: req.user.role === 'owner' && hasPermission(req.user, 'onboarding.activate'),
    });
  }));

/**
 * Human labels for every status.
 *
 * The database vocabulary is a state machine; this is what a person reads.
 * `activated` says "Complete" because that IS what it means — the run is
 * finished and the person is staff. Renaming the state itself would have
 * required rewriting five guards for a word.
 */
const STATUS_LABELS = Object.freeze({
  created: 'Draft',
  starter_pack_ready: 'Starter pack ready',
  starter_pack_sent: 'Awaiting documents',
  documents_received: 'Documents received',
  details_extracted: 'Details ready for review',
  ready_for_account: 'Ready for account',
  account_created: 'Account created',
  invite_sent: 'Invitation sent',
  invite_accepted: 'Employee reviewing',
  in_progress: 'Employee reviewing',
  employee_actions_complete: 'Employee finished — awaiting submission',
  employer_review: 'Our review',
  corrections_required: 'Actions outstanding',
  ready_to_activate: 'Ready to activate',
  activated: 'Complete',
  completed: 'Complete',
  cancelled: 'Cancelled',
  archived: 'Archived',
});

function statusLabel(status) {
  return STATUS_LABELS[status] || String(status || '').replace(/_/g, ' ');
}

/**
 * The progress list the Owner reads top to bottom.
 *
 * Each step carries its own state and, when it is the current one, the action
 * that moves it on. The screen therefore never has to infer "what next" from a
 * status string — the server, which knows the rules, says so.
 */
function buildJourneySteps(a, { pack, returned, run, summary }) {
  const steps = [
    {
      key: 'pack_generated',
      label: 'Starter pack prepared',
      state: pack ? 'done' : (a.status === 'created' ? 'current' : 'todo'),
      detail: pack ? `${pack.document_count} documents` : 'Not generated yet',
      action: pack ? null : { label: 'Generate starter pack', verb: 'generate' },
      at: a.starter_pack_generated_at,
    },
    {
      key: 'pack_sent',
      label: 'Starter pack sent',
      state: a.starter_pack_sent_at ? 'done' : (pack ? 'current' : 'todo'),
      detail: a.starter_pack_sent_at
        ? `Sent to ${a.starter_pack_sent_to || a.applicant_email}`
        : 'Not sent yet',
      action: a.starter_pack_sent_at
        ? { label: 'Resend starter pack', verb: 'send' }
        : (pack ? { label: 'Send starter pack', verb: 'send' } : null),
      at: a.starter_pack_sent_at,
    },
    {
      key: 'documents_returned',
      label: 'Documents returned',
      state: returned.length ? 'done' : (a.starter_pack_sent_at ? 'current' : 'todo'),
      detail: returned.length
        ? `${returned.length} file${returned.length === 1 ? '' : 's'} received`
        : 'Waiting for the completed forms',
      action: { label: 'Upload returned documents', verb: 'upload' },
      at: a.documents_received_at,
    },
    {
      key: 'details_read',
      label: 'Details read from the documents',
      state: (summary && summary.total) ? 'done' : (returned.length ? 'current' : 'todo'),
      detail: summary && summary.total
        ? `${summary.total} details found, ${summary.needsReview} still to check`
        : (run && run.status === 'failed' ? 'Could not be read — enter them manually' : 'Not read yet'),
      action: returned.length && !(summary && summary.total)
        ? { label: 'Read the documents', verb: 'extract' } : null,
      at: a.extraction_completed_at,
    },
    {
      key: 'details_reviewed',
      label: 'Details checked',
      state: a.details_reviewed_at ? 'done'
        : ((summary && summary.total) ? 'current' : 'todo'),
      detail: summary && summary.total
        ? `${summary.confirmed} of ${summary.total} confirmed`
        : 'Nothing to check yet',
      action: (summary && summary.needsReview) ? { label: 'Review details', verb: 'review' } : null,
      at: a.details_reviewed_at,
    },
    {
      key: 'account',
      label: 'Portal account created',
      state: a.account_created_at ? 'done' : (a.details_reviewed_at ? 'current' : 'todo'),
      detail: a.account_created_at ? `Sign in as ${a.login_email || a.applicant_email}` : 'Not created yet',
      action: a.account_created_at ? null : { label: 'Create portal account', verb: 'account' },
      at: a.account_created_at,
    },
    {
      key: 'invited',
      label: 'Invitation sent',
      state: a.invitation_sent_at ? 'done' : (a.account_created_at ? 'current' : 'todo'),
      detail: a.invitation_sent_at ? 'Sign-in details emailed' : 'Not sent yet',
      action: a.account_created_at
        ? { label: a.invitation_sent_at ? 'Resend invitation' : 'Send invitation', verb: 'invite' }
        : null,
      at: a.invitation_sent_at,
    },
    {
      key: 'employee_review',
      label: 'Employee checking their details',
      state: a.first_login_at ? 'done' : (a.invitation_sent_at ? 'current' : 'todo'),
      detail: a.first_login_at
        ? `${a.employee_done || 0} of ${a.employee_total || 0} items done`
        : 'Waiting for their first sign-in',
      action: null,
      at: a.first_login_at,
    },
    {
      key: 'complete',
      label: 'Onboarding complete',
      state: ['activated', 'completed'].includes(a.status) ? 'done' : 'todo',
      detail: ['activated', 'completed'].includes(a.status)
        ? 'This person is now an active employee'
        : 'Everything mandatory must be finished first',
      action: null,
      at: a.activated_at || a.completed_at,
    },
  ];

  // Exactly one step is "current": the first that is not done. Computing it
  // here rather than per-step keeps the list from showing two next actions.
  let markedCurrent = false;
  for (const step of steps) {
    if (step.state === 'done') continue;
    step.state = markedCurrent ? 'todo' : 'current';
    markedCurrent = true;
  }
  return steps;
}

module.exports = router;
module.exports._internals = {
  aiUnavailableText,
  scorePackage,
  validateReturnedFile,
  buildJourneySteps,
  statusLabel,
  STATUS_LABELS,
  JOURNEY_ORDER,
  starterPackEmail,
  MAX_SMTP_ATTACHMENT_BYTES,
  RETURN_ALLOWED,
};
