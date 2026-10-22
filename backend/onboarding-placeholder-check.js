'use strict';

/**
 * PLACEHOLDER CHECK — a document that still has gaps in it is never put in
 * front of a starter (owner decision 4, Oct 2026).
 *
 * A policy, handbook, agreement, contract or position description whose text
 * or file still contains "[TO CONFIRM …]", a "PLACEHOLDER - …" file the portal
 * published to stand in for a missing one, a "Dev QA content" stub, or an
 * empty version, is refused at every door it could leave by: the release,
 * the employee's acknowledgement, the per-record document upload, and the
 * paper pack's send. The refusal names the document. Nothing here writes or
 * invents wording — the practice supplies it.
 *
 *   textProblem(text)                      → null | reason
 *   fileProblem({ buffer, mime, fileName }) → Promise<null | reason>
 *   versionProblem(version)                → Promise<null | reason>
 */

const PLACEHOLDER_PREFIX = 'PLACEHOLDER - ';

/** Gaps the drafts mark for the owner, and the seed's stand-in body. */
const GAP_PATTERNS = [
  { re: /\[\s*TO\s+CONFIRM\b/i, reason: 'still contains "[TO CONFIRM …]" gaps' },
  { re: /\bDev QA content\b/i, reason: 'is a development stub, not the practice document' },
  { re: /^\s*PLACEHOLDER\b/i, reason: 'is a placeholder, not the practice document' },
];

function textProblem(text) {
  const t = String(text || '');
  for (const p of GAP_PATTERNS) if (p.re.test(t)) return p.reason;
  return null;
}

function isPlaceholderName(name) {
  return String(name || '').startsWith(PLACEHOLDER_PREFIX);
}

/** Read the words out of a PDF / Word / text file and look for gaps. */
async function fileProblem({ buffer, mime, fileName }) {
  if (isPlaceholderName(fileName)) return 'is a placeholder file, not the practice document';
  if (!buffer || !buffer.length) return 'is an empty file';
  let read;
  try {
    read = await require('./onboarding-extraction').readDocumentText(buffer, mime);
  } catch (_) {
    read = null;
  }
  const text = read && Array.isArray(read.pages) ? read.pages.join('\n') : '';
  return textProblem(text);
}

async function versionBytes(version) {
  if (version.file_data) return Buffer.from(version.file_data, 'base64');
  if (version.storage_key) {
    try {
      const { getBackend } = require('./storage');
      const out = await getBackend(version.storage_backend).get({ backend: version.storage_backend, storageKey: version.storage_key });
      return out && out.base64 ? Buffer.from(out.base64, 'base64') : null;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/** A published library version: its body, and its file if it has one. */
async function versionProblem(version) {
  if (!version) return 'has no published version';
  const body = textProblem(version.body) || textProblem(version.summary);
  if (body) return body;
  if (isPlaceholderName(version.file_name)) return 'is a placeholder file, not the practice document';
  const hasFile = !!(version.file_data || version.storage_key);
  if (hasFile) {
    const bytes = await versionBytes(version);
    if (!bytes || !bytes.length) return 'is an empty file';
    const f = await fileProblem({ buffer: bytes, mime: version.file_mime, fileName: version.file_name });
    if (f) return f;
  }
  if (!hasFile && !String(version.body || '').trim() && !version.source_url) return 'is empty';
  return null;
}

/** "Staff Handbook still contains …" — the message the Owner reads. */
function describe(title, reason) {
  return `${title || 'This document'} ${reason}`;
}

module.exports = { PLACEHOLDER_PREFIX, GAP_PATTERNS, textProblem, fileProblem, versionProblem, isPlaceholderName, describe };
