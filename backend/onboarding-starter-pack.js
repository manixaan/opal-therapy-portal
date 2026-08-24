'use strict';

/**
 * STARTER PACKS — the documents a new starter is actually sent.
 *
 * A package (034) says what somebody must COMPLETE. A starter pack says what
 * they RECEIVE. The two are nearly the same list and are deliberately derived
 * from one source, because keeping them as two hand-maintained lists is how a
 * practice ends up emailing the 2025 Fair Work statement for a year after
 * publishing the 2026 one.
 *
 * ── COMPOSITION ────────────────────────────────────────────────────────────
 * The pack is DERIVED from the package's resolved requirements: any
 * requirement that references a library document contributes that document,
 * in requirement order. `onboarding_package_documents` then holds the Owner's
 * deltas on top:
 *
 *   an extra row (excluded = FALSE)  adds a document no requirement asks for —
 *                                    a welcome letter, a position description
 *   an extra row (excluded = TRUE)   keeps the requirement but leaves the
 *                                    document out of the emailed pack, because
 *                                    it is read in the portal instead
 *   display_title                    renames the entry FOR THIS PACKAGE ONLY.
 *                                    The library title is untouched, so a
 *                                    rename can never rewrite what a previous
 *                                    onboarding record says it received.
 *
 * ── VERSION PINNING ────────────────────────────────────────────────────────
 * `snapshot()` resolves each entry to a specific onboarding_document_versions
 * row and is called during publishPackage, landing in the version's immutable
 * `content.starterPack`. Generating a pack reads THAT, never the live library.
 * So an Owner who publishes a new handbook tomorrow does not retroactively
 * change what today's ZIP contained, and the manifest can still name the exact
 * version years later.
 *
 * ── WHAT THE ZIP IS NOT ────────────────────────────────────────────────────
 * It is not a directory listing of the document store. Filenames are built
 * from human titles and a position prefix, never from internal codes or ids,
 * and every one is sanitised: no separators, no traversal, no leading dot, no
 * device names. Only documents resolved through the pinned snapshot are ever
 * read, so there is no path by which a caller-supplied string reaches storage.
 */

const crypto = require('crypto');
const odb = require('./onboarding-db');
const log = require('./logger').createLogger('onboarding-starter-pack');

/** Read-Me is position 00; real documents start at 01. */
const README_POSITION = '00';

/**
 * Reduce a document title to a safe, readable filename stem.
 *
 * Everything outside a conservative allowlist becomes a space, runs collapse,
 * and the result is trimmed and capped. `..`, `/`, `\`, NUL and control
 * characters cannot survive this, so a manifest entry can never address a path
 * outside the archive.
 */
function safeStem(title, fallback = 'Document') {
  // A single allowlist pass. Everything outside it - separators, dots that
  // could pair into `..`, control characters, NUL - becomes a space, so there
  // is no second rule that has to be kept in step with the first.
  const cleaned = String(title || '')
    .replace(/[^A-Za-z0-9 ()\-_,.&']/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '');
  const stem = cleaned.slice(0, 90).trim();
  if (!stem) return fallback;
  // Windows reserves these regardless of extension.
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) return `${stem} document`;
  return stem;
}

/** Extension for a stored document version, from its MIME then its filename. */
function extensionFor(version) {
  const byMime = {
    'application/pdf': 'pdf',
    'application/msword': 'doc',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'text/plain': 'txt',
  }[String(version?.file_mime || '').toLowerCase()];
  if (byMime) return byMime;
  const fromName = String(version?.file_name || '').split('.').pop().toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(fromName) ? fromName : 'bin';
}

// ═════════════════════════════════════════════════════════════════════════════
//  COMPOSITION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The starter-pack entries for a package's CURRENT DRAFT.
 *
 * Used by the package detail screen, where the Owner manages the list. The
 * live library is read here on purpose: the draft is meant to show what a new
 * onboarding would receive today.
 *
 * @returns {Promise<Array<object>>} ordered entries, excluded ones included
 *   and flagged so the UI can show them as deliberately left out
 */
async function resolveDraft(orgId, pkg, q = odb.pool) {
  const { rows: resolved } = await odb.resolvePackage(orgId, pkg, q);

  // Requirement-derived entries, in requirement order, de-duplicated: two
  // requirements may legitimately reference the same policy.
  const entries = [];
  const byDocument = new Map();
  let order = 0;

  for (const row of resolved) {
    if (row.template_status === 'archived') continue;
    if (!row.document_id) continue;
    if (byDocument.has(row.document_id)) {
      byDocument.get(row.document_id).requirementCodes.push(row.template_code);
      continue;
    }
    order += 10;
    const entry = {
      documentId: row.document_id,
      source: 'requirement',
      sortOrder: order,
      requirementCodes: [row.template_code],
      inheritedFrom: row.inherited_from || null,
      excluded: false,
      displayTitle: null,
    };
    byDocument.set(row.document_id, entry);
    entries.push(entry);
  }

  // The Owner's deltas.
  const { rows: overrides } = await q.query(
    `SELECT * FROM onboarding_package_documents WHERE package_id = $1 ORDER BY sort_order, created_at`,
    [pkg.id]
  );
  for (const o of overrides) {
    const existing = byDocument.get(o.document_id);
    if (existing) {
      existing.excluded = o.excluded === true;
      existing.displayTitle = o.display_title || null;
      existing.overrideId = o.id;
      existing.note = o.note || null;
      if (o.sort_order != null) existing.sortOrder = o.sort_order;
      continue;
    }
    order += 10;
    const entry = {
      documentId: o.document_id,
      source: 'manual',
      sortOrder: o.sort_order != null ? o.sort_order : order,
      requirementCodes: [],
      inheritedFrom: null,
      excluded: o.excluded === true,
      displayTitle: o.display_title || null,
      overrideId: o.id,
      note: o.note || null,
    };
    byDocument.set(o.document_id, entry);
    entries.push(entry);
  }

  if (!entries.length) return [];

  // Hydrate from the library in one query rather than N.
  const ids = entries.map((e) => e.documentId);
  const { rows: docs } = await q.query(
    `SELECT d.id, d.code, d.title, d.category, d.classification, d.audience,
            d.content_status, d.status, d.official_source_url, d.current_version,
            v.id AS version_id, v.version, v.file_name, v.file_mime,
            v.file_size_bytes, v.file_sha256, v.source_version_label, v.body
       FROM onboarding_documents d
       LEFT JOIN onboarding_document_versions v
              ON v.document_id = d.id AND v.version = d.current_version
      WHERE d.id = ANY($1::uuid[])`,
    [ids]
  );
  const docById = new Map(docs.map((d) => [d.id, d]));

  return entries
    .map((e) => {
      const d = docById.get(e.documentId);
      if (!d) return null;
      return {
        ...e,
        code: d.code,
        libraryTitle: d.title,
        title: e.displayTitle || d.title,
        category: d.category,
        classification: d.classification,
        audience: d.audience,
        contentStatus: d.content_status,
        documentStatus: d.status,
        officialSourceUrl: d.official_source_url,
        documentVersionId: d.version_id || null,
        documentVersion: d.version || null,
        fileName: d.file_name || null,
        fileMime: d.file_mime || null,
        fileSizeBytes: d.file_size_bytes || null,
        fileSha256: d.file_sha256 || null,
        sourceVersionLabel: d.source_version_label || null,
        hasBody: !!d.body,
        // Why this entry cannot ship, if it cannot. The Owner needs the reason,
        // not a silently shorter pack.
        unavailableReason: d.version_id
          ? (d.file_name || d.body ? null : 'The published version has no file behind it')
          : (d.content_status === 'link_only'
            ? 'This document is published as an official link rather than a file'
            : 'No version of this document has been published yet'),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The immutable starter-pack snapshot for a package VERSION.
 *
 * Called during publish; the result is stored in the version's `content`. Only
 * shippable entries are kept — an excluded one is not part of the pack, and an
 * unavailable one is recorded as an omission so the Owner sees why.
 */
async function snapshot(orgId, pkg, q = odb.pool) {
  const entries = await resolveDraft(orgId, pkg, q);
  const included = [];
  const omissions = [];
  let position = 0;

  for (const e of entries) {
    if (e.excluded) continue;
    if (e.unavailableReason) {
      omissions.push({ code: e.code, title: e.title, reason: e.unavailableReason });
      continue;
    }
    position += 1;
    included.push({
      position,
      documentId: e.documentId,
      documentCode: e.code,
      documentVersionId: e.documentVersionId,
      documentVersion: e.documentVersion,
      title: e.title,
      libraryTitle: e.libraryTitle,
      category: e.category,
      classification: e.classification,
      sourceVersionLabel: e.sourceVersionLabel,
      officialSourceUrl: e.officialSourceUrl,
      fileName: e.fileName,
      fileMime: e.fileMime,
      fileSizeBytes: e.fileSizeBytes,
      fileSha256: e.fileSha256,
      requirementCodes: e.requirementCodes,
    });
  }

  return { documents: included, omissions };
}

/**
 * Read the pinned starter pack out of a package version's content.
 *
 * Versions published before this feature existed have no `starterPack` key.
 * They return an empty pack rather than throwing: an old onboarding still
 * works, it simply has nothing to email, and the Owner is told so.
 */
function fromVersionContent(content) {
  const pack = content && content.starterPack;
  if (!pack || !Array.isArray(pack.documents)) {
    return { documents: [], omissions: [], legacy: true };
  }
  return { documents: pack.documents, omissions: pack.omissions || [], legacy: false };
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE READ-ME
// ═════════════════════════════════════════════════════════════════════════════

/**
 * The plain-text guide that sits at the top of every pack.
 *
 * Text, not PDF, deliberately: it opens on any device with no reader, it can
 * be read from a phone preview, and it costs no rendering dependency. The
 * content answers the only three questions a new starter has — what is in
 * here, what do I fill in, how do I send it back.
 */
function buildReadme({ employeeName, orgName, roleTitle, startDate, dueDate, returnEmail, documents, contactName }) {
  const line = '─'.repeat(66);
  const fmt = (d) => {
    if (!d) return null;
    const parsed = new Date(d);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleDateString('en-AU', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
    });
  };

  const toComplete = documents.filter((d) => d.classification === 'OPAL_FORM');
  const toRead = documents.filter((d) => d.classification !== 'OPAL_FORM');

  const parts = [];
  parts.push(`${orgName} — Starter Pack`);
  parts.push(line);
  parts.push('');
  parts.push(`Prepared for: ${employeeName}`);
  if (roleTitle) parts.push(`Role: ${roleTitle}`);
  const start = fmt(startDate);
  if (start) parts.push(`Start date: ${start}`);
  const due = fmt(dueDate);
  if (due) parts.push(`Please return by: ${due}`);
  parts.push('');
  parts.push('Welcome. This pack contains everything we need before your first day,');
  parts.push('along with the policies and information statements you are entitled to');
  parts.push('receive. Please read all of it and complete the forms.');
  parts.push('');

  if (toComplete.length) {
    parts.push('WHAT TO COMPLETE');
    parts.push(line);
    for (const d of toComplete) {
      parts.push(`  ${String(d.position).padStart(2, '0')}. ${d.title}`);
    }
    parts.push('');
  }

  if (toRead.length) {
    parts.push('WHAT TO READ AND KEEP');
    parts.push(line);
    for (const d of toRead) {
      const label = d.sourceVersionLabel ? ` (${d.sourceVersionLabel})` : '';
      parts.push(`  ${String(d.position).padStart(2, '0')}. ${d.title}${label}`);
    }
    parts.push('');
  }

  parts.push('HOW TO RETURN YOUR FORMS');
  parts.push(line);
  parts.push('Complete the forms, then send them back to us as attachments by');
  parts.push(`email${returnEmail ? ` to ${returnEmail}` : ''}. Scans and clear photographs are both fine.`);
  parts.push('');
  parts.push('Once we have them we will set up your portal account and email you a');
  parts.push('sign-in link. Your details will already be filled in, so you will only');
  parts.push('need to check them rather than type them again.');
  parts.push('');
  parts.push('A NOTE ON YOUR TAX FILE NUMBER AND BANK DETAILS');
  parts.push(line);
  parts.push('Please do NOT email your tax file number. You will enter it directly');
  parts.push('into the secure portal once your account is ready. Bank details are');
  parts.push('safest entered there too, though we can accept them on the form if');
  parts.push('you prefer.');
  parts.push('');
  if (contactName) {
    parts.push(`If anything is unclear, contact ${contactName}.`);
    parts.push('');
  }
  parts.push(line);
  parts.push(`Generated by the ${orgName} portal.`);
  parts.push('');

  return parts.join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
//  THE EMAIL
// ═════════════════════════════════════════════════════════════════════════════

/** The date format every email in this workflow uses. */
function fmtEmailDate(d) {
  if (!d) return null;
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-AU', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Australia/Perth',
  });
}

function defaultStarterPackSubject(orgName, applicantName) {
  const name = String(applicantName || '').trim();
  return `Your ${orgName} starter pack${name ? ` — ${name}` : ''}`;
}

/**
 * The editable body of the starter-pack email, as plain text.
 *
 * ONE source of truth: Start Onboarding fetches this text for the Owner to
 * read and edit before sending, and composeStarterPackEmail falls back to it
 * when no edited message arrives — so the wording the Owner was shown and the
 * wording the server sends can never drift apart.
 *
 * Structural facts — start date, return-by date, the download link for an
 * oversize pack — are NOT part of this text. They are appended by the
 * composer from the assignment itself, so an Owner editing the greeting
 * cannot accidentally delete the link the whole email exists to carry.
 */
function defaultStarterPackMessage({ applicantName, orgName, roleTitle }) {
  const firstName = String(applicantName || '').trim().split(/\s+/)[0];
  return [
    firstName ? `Hi ${firstName},` : 'Hello,',
    '',
    `We are delighted you are joining ${orgName}`
      + `${roleTitle ? ` as ${roleTitle}` : ''}. Everything we need before your `
      + 'first day is in the starter pack that comes with this email.',
    '',
    'Read the pack, complete the forms, and reply to this email with them '
      + 'attached. Scans and clear photographs are both fine.',
    '',
    'Once we have them we will set up your portal account and send you a '
      + 'sign-in link. Your details will already be filled in, so you will '
      + 'only need to check them rather than type them again.',
    '',
    'Please do not email your tax file number. You will enter that directly '
      + 'into the secure portal once your account is ready.',
    '',
    'If anything is unclear, just reply to this email.',
  ].join('\n');
}

/**
 * Compose the starter-pack email — subject, HTML and plain text.
 *
 * `customMessage` / `customSubject` are the Owner's per-send edits from Start
 * Onboarding. The message is plain text, escaped here and rendered as
 * paragraphs; it can never carry markup. Whatever the message says, the
 * composer still renders the facts box (start / return-by dates) and, for an
 * oversize pack, the secure download link — those are delivery machinery, not
 * prose, and an edit must not be able to lose them.
 */
function composeStarterPackEmail({
  assignment, orgName, packFileName, downloadUrl, senderName, dueDate,
  customSubject, customMessage,
}) {
  const { escapeHtml: esc } = require('./email');

  const message = String(customMessage || '').trim() || defaultStarterPackMessage({
    applicantName: assignment.applicant_name,
    orgName,
    roleTitle: assignment.job_title || assignment.package_title,
  });

  const due = fmtEmailDate(dueDate);
  const start = fmtEmailDate(assignment.start_date);

  const paragraphs = message
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n  ');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#f5f5f5;margin:0;padding:24px;color:#241f1a;}
 .card{background:#fff;border-radius:10px;max-width:560px;margin:0 auto;padding:36px 40px;box-shadow:0 2px 8px rgba(0,0,0,.08);}
 .logo{font-size:20px;font-weight:700;color:#0f7c6c;margin-bottom:28px;}
 h2{font-size:22px;font-weight:700;color:#1a1a2e;margin:0 0 12px;}
 p{font-size:15px;line-height:1.6;color:#3a3a4a;margin:0 0 14px;}
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
  ${paragraphs}
  ${(start || due) ? `<div class="facts">
    ${start ? `<p><strong>Your start date:</strong> ${esc(start)}</p>` : ''}
    ${due ? `<p><strong>Please return your forms by:</strong> ${esc(due)}</p>` : ''}
  </div>` : ''}
  ${downloadUrl ? `<a href="${downloadUrl}" class="btn">Download my starter pack →</a>
    <p class="url">${esc(downloadUrl)}</p>` : ''}
  <div class="footer">
    ${esc(senderName || orgName)}<br>${esc(orgName)}
  </div>
</div></body></html>`;

  const text = [
    message,
    '',
    start ? `Your start date: ${start}` : '',
    due ? `Please return your forms by: ${due}` : '',
    downloadUrl
      ? `Your starter pack is here: ${downloadUrl}`
      : `Your starter pack (${packFileName}) is attached to this email.`,
    '',
    senderName || orgName,
    orgName,
  ].filter((l) => l !== '').join('\n');

  return {
    subject: String(customSubject || '').trim()
      || defaultStarterPackSubject(orgName, assignment.applicant_name),
    html,
    text,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
//  ZIP BUILD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Build the starter-pack ZIP.
 *
 * Deterministic by construction: entries are emitted in manifest order with a
 * fixed date, so regenerating an unchanged pack produces byte-identical output
 * and the sha256 is a real identity rather than a timestamp.
 *
 * @param {object[]} documents  the PINNED snapshot entries
 * @param {object}   meta       employee/org details for the read-me and folder name
 * @returns {Promise<{buffer:Buffer, manifest:object[], omissions:object[], fileName:string}>}
 */
async function buildZip(documents, meta, q = odb.pool) {
  const JSZip = require('jszip');
  const zip = new JSZip();

  const orgName = meta.orgName || 'Opal Therapy';
  const employeeName = meta.employeeName || 'New starter';

  const manifest = [];
  const omissions = [];
  const usedNames = new Set();
  let position = 0;

  for (const entry of documents) {
    let bytes = null;
    let mime = entry.fileMime || 'application/octet-stream';
    let ext = 'pdf';

    try {
      const version = await odb.getDocumentVersion(entry.documentVersionId, q);
      if (!version) {
        omissions.push({ code: entry.documentCode, title: entry.title, reason: 'That document version is no longer available' });
        continue;
      }
      if (version.file_name || version.storage_key || version.file_data) {
        bytes = await readVersionBytes(version);
        mime = version.file_mime || mime;
        ext = extensionFor(version);
      } else if (version.body) {
        // An Opal-authored policy that lives as portal content rather than an
        // uploaded file. Shipping it as text is honest and readable; inventing
        // a PDF wrapper for it would add a rendering dependency for nothing.
        bytes = Buffer.from(String(version.body), 'utf8');
        mime = 'text/plain';
        ext = 'txt';
      }
      if (!bytes || !bytes.length) {
        omissions.push({ code: entry.documentCode, title: entry.title, reason: 'That document has no file behind it' });
        continue;
      }
    } catch (err) {
      log.warn('starter pack document unreadable', {
        error: err, documentCode: entry.documentCode,
      });
      omissions.push({ code: entry.documentCode, title: entry.title, reason: 'That document could not be read from storage' });
      continue;
    }

    position += 1;
    const prefix = String(position).padStart(2, '0');
    let name = `${prefix} - ${safeStem(entry.title)}.${ext}`;
    // Two documents with the same title would otherwise silently overwrite one
    // another inside the archive.
    let dedupe = 1;
    while (usedNames.has(name.toLowerCase())) {
      dedupe += 1;
      name = `${prefix} - ${safeStem(entry.title)} (${dedupe}).${ext}`;
    }
    usedNames.add(name.toLowerCase());

    zip.file(name, bytes, { date: new Date(0), binary: true });
    manifest.push({
      position,
      fileName: name,
      title: entry.title,
      documentId: entry.documentId,
      documentCode: entry.documentCode,
      documentVersionId: entry.documentVersionId,
      documentVersion: entry.documentVersion,
      sourceVersionLabel: entry.sourceVersionLabel || null,
      sizeBytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      mime,
    });
  }

  const readme = buildReadme({
    employeeName,
    orgName,
    roleTitle: meta.roleTitle,
    startDate: meta.startDate,
    dueDate: meta.dueDate,
    returnEmail: meta.returnEmail,
    contactName: meta.contactName,
    documents: manifest.map((m, i) => ({
      position: i + 1,
      title: m.title,
      classification: documents.find((d) => d.documentId === m.documentId)?.classification,
      sourceVersionLabel: m.sourceVersionLabel,
    })),
  });
  zip.file(`${README_POSITION} - Read Me First.txt`, Buffer.from(readme, 'utf8'), { date: new Date(0) });

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
    // No platform/date entropy: the archive must hash the same twice.
    platform: 'UNIX',
  });

  return {
    buffer,
    manifest,
    omissions,
    fileName: `${safeStem(orgName, 'Opal Therapy')} - ${safeStem(employeeName, 'Starter')} - Starter Pack.zip`,
  };
}

/** Read a document version's bytes through whichever backend holds them. */
async function readVersionBytes(version) {
  if (version.storage_backend === 'db' || !version.storage_key) {
    if (!version.file_data) return null;
    return Buffer.from(version.file_data, 'base64');
  }
  const { getBackend } = require('./storage');
  const backend = getBackend(version.storage_backend);
  const out = await backend.get({
    backend: version.storage_backend,
    storageKey: version.storage_key,
    fileData: version.file_data,
  });
  return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
}

module.exports = {
  resolveDraft,
  snapshot,
  fromVersionContent,
  buildZip,
  buildReadme,
  readVersionBytes,
  safeStem,
  extensionFor,
  defaultStarterPackSubject,
  defaultStarterPackMessage,
  composeStarterPackEmail,
};
