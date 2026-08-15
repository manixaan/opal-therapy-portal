'use strict';

/**
 * GOVERNED STORAGE for Resource Hub files.
 *
 * A dedicated root, deliberately separate from the employee-document store, so
 * that resource files cannot be addressed through the same keys as HR
 * documents and vice versa.
 *
 * THE ROOT IS THE WHOLE POINT. Every read and write resolves inside one
 * directory and is re-checked after following symlinks. Nothing here can be
 * pointed at `/Users/antonyxavier/Documents/7 Resources` — the 1.97GB
 * historical vault containing client-identifiable material — no matter what a
 * caller supplies, because callers supply a relative key and never a path.
 *
 * Keys look like:
 *   opal-originals/<slug>/<slug>-v<version>.<ext>     seeded Opal documents
 *   resources/<hh>/<sha256>.<ext>                     content-addressed imports
 *   derivatives/<hh>/<sha256>-<kind>.<ext>            generated previews
 *
 * BACKENDS. RESOURCE_HUB_STORAGE_BACKEND selects where the bytes live:
 *   'local' (default) — files under RESOURCE_HUB_STORAGE_PATH
 *                       (or backend/.resource-hub-files when unset)
 *   'blob'            — private Azure Blob Storage, the production target,
 *                       using AZURE_STORAGE_CONNECTION_STRING and the
 *                       RESOURCE_HUB_STORAGE_CONTAINER container (default
 *                       'resource-hub'; deliberately a different container
 *                       from employee documents).
 *
 * The async trio getBuffer/putBuffer/removeBlob is the backend-agnostic API
 * every route should use. The sync helpers (get/put/exists) remain for
 * local-only callers — seeds and maintenance scripts that by definition run
 * where the local store is.  Neither backend ever exposes a public URL:
 * delivery always goes through the authenticated /api/rh2 routes.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function backendName() {
  return (process.env.RESOURCE_HUB_STORAGE_BACKEND || 'local').toLowerCase();
}

function root() {
  const p = process.env.RESOURCE_HUB_STORAGE_PATH
    || path.join(__dirname, '.resource-hub-files');
  fs.mkdirSync(p, { recursive: true });
  return fs.realpathSync(p);
}

/**
 * Resolve a relative key to an absolute path inside the root, or throw.
 *
 * Containment is tested with path.relative rather than a string prefix: with a
 * root of `/data/hub`, a prefix test would also accept `/data/hub-evil/x`.
 * After resolving, symlinks are followed and the real destination re-checked,
 * so a link planted inside the root cannot reach outside it.
 */
function resolveWithin(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') throw new Error('Invalid storage key');
  if (path.isAbsolute(storageKey)) throw new Error('Invalid storage key');
  if (storageKey.indexOf('\0') !== -1) throw new Error('Invalid storage key');

  const base = root();
  const full = path.resolve(base, storageKey);

  const rel = path.relative(base, full);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid storage key');
  }

  if (fs.existsSync(full)) {
    const real = fs.realpathSync(full);
    const realRel = path.relative(base, real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      throw new Error('Invalid storage key');
    }
    return real;
  }
  return full;
}

/** Build a safe relative key from untrusted-ish parts. */
function buildKey(parts) {
  const clean = parts
    .map((p) => String(p || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/-+/g, '-'))
    .filter(Boolean);
  if (!clean.length) throw new Error('Invalid storage key');
  return clean.join('/');
}

/** @returns {{storageKey, bytes, sha256}} */
function put(storageKey, buffer) {
  const full = resolveWithin(storageKey);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, buffer);
  return {
    storageKey,
    bytes: buffer.length,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
  };
}

/** @returns {Buffer} @throws if the key escapes the root or the file is absent */
function get(storageKey) {
  return fs.readFileSync(resolveWithin(storageKey));
}

function exists(storageKey) {
  try { return fs.existsSync(resolveWithin(storageKey)); } catch (e) { return false; }
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

// ── Azure Blob backend (loaded only when selected) ───────────────────────────

let containerClientPromise = null;
function blobContainer() {
  if (!containerClientPromise) {
    // Lazy require, same pattern as storage/index.js: the pilot runs without
    // the @azure/storage-blob dependency unless 'blob' is actually selected.
    const { BlobServiceClient } = require('@azure/storage-blob');
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    const container = process.env.RESOURCE_HUB_STORAGE_CONTAINER || 'resource-hub';
    const svc = BlobServiceClient.fromConnectionString(conn);
    containerClientPromise = Promise.resolve(svc.getContainerClient(container));
  }
  return containerClientPromise;
}

/** Validate a key without touching the filesystem — the blob path needs the
 * same traversal rules even though there is no directory to escape. */
function assertSafeKey(storageKey) {
  if (!storageKey || typeof storageKey !== 'string') throw new Error('Invalid storage key');
  if (path.isAbsolute(storageKey)) throw new Error('Invalid storage key');
  if (storageKey.indexOf('\0') !== -1) throw new Error('Invalid storage key');
  if (storageKey.split('/').some((part) => part === '..' || part === '')) {
    throw new Error('Invalid storage key');
  }
  return storageKey;
}

// ── Backend-agnostic async API (what routes use) ─────────────────────────────

/** @returns {Promise<Buffer>} @throws when the key is unsafe or the blob is absent */
async function getBuffer(storageKey) {
  if (backendName() === 'blob') {
    const container = await blobContainer();
    return container.getBlockBlobClient(assertSafeKey(storageKey)).downloadToBuffer();
  }
  return fs.promises.readFile(resolveWithin(storageKey));
}

/** @returns {Promise<{storageKey, bytes, sha256}>} */
async function putBuffer(storageKey, buffer) {
  if (backendName() === 'blob') {
    const container = await blobContainer();
    await container.getBlockBlobClient(assertSafeKey(storageKey)).uploadData(buffer);
    return { storageKey, bytes: buffer.length, sha256: sha256(buffer) };
  }
  return put(storageKey, buffer);
}

/** Missing blobs are fine — remove is called during cleanup, not delivery. */
async function removeBlob(storageKey) {
  if (backendName() === 'blob') {
    const container = await blobContainer();
    await container.getBlockBlobClient(assertSafeKey(storageKey)).deleteIfExists();
    return;
  }
  let full;
  try { full = resolveWithin(storageKey); } catch (e) { return; }
  await fs.promises.unlink(full).catch(() => {});
}

async function existsBlob(storageKey) {
  if (backendName() === 'blob') {
    const container = await blobContainer();
    return container.getBlockBlobClient(assertSafeKey(storageKey)).exists();
  }
  return exists(storageKey);
}

/* ── HTTP presentation helpers ───────────────────────────────────────────────
   Kept here so the download route and the seed agree on format/MIME, and so
   tests can exercise them without an HTTP server. */

/**
 * Controlled MIME allow-list. The response Content-Type is chosen from the
 * record's `format`, NEVER echoed from a stored file_mime value — a stored
 * string is data, and echoing it would let whatever wrote the row choose how a
 * browser interprets the bytes.
 */
const MIME_BY_FORMAT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
};

function mimeForFormat(format) {
  return MIME_BY_FORMAT[String(format || '').toLowerCase()] || 'application/octet-stream';
}

// Control characters, including CR and LF, which would otherwise let a stored
// filename split the response headers.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Sanitise a filename for Content-Disposition.
 *
 * Strips directory separators, control characters, quotes and leading dots, so
 * the header cannot be split and the name cannot suggest a path. Falls back to
 * a generic name when nothing usable survives.
 */
function safeDownloadName(name, format) {
  const ext = String(format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let base = String(name || '')
    .replace(/[\\/]/g, '-')           // no path separators
    .replace(CONTROL_CHARS, '')       // no header splitting
    .replace(/["';]/g, '')            // no quote-escaping the header
    .replace(/\.{2,}/g, '.')           // no dot-runs that read like a path
    .replace(/^\.+/, '')              // no leading dots
    .trim();
  if (ext) base = base.replace(new RegExp('\\.' + ext + '$', 'i'), '');
  base = base.slice(0, 120).trim();
  if (!base) base = 'resource';
  return ext ? `${base}.${ext}` : base;
}

module.exports = {
  root, resolveWithin, buildKey, put, get, exists, sha256,
  backendName, assertSafeKey,
  getBuffer, putBuffer, removeBlob, existsBlob,
  MIME_BY_FORMAT, mimeForFormat, safeDownloadName,
};
