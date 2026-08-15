'use strict';

/**
 * DOCUMENT STORAGE ABSTRACTION
 *
 * One interface, three backends, selected by DOCUMENT_STORAGE_BACKEND:
 *   'db'    (default) — base64 bytes in pd_documents.file_data (current pilot
 *                       behaviour; kept so nothing has to migrate on day one)
 *   'local'           — files under DOCUMENT_STORAGE_PATH (dev/self-host)
 *   'blob'            — private Azure Blob Storage (production target)
 *
 * Contract (all async):
 *   put({ userId, docId, fileName, mime, base64 }) → { backend, storageKey }
 *   get({ backend, storageKey, fileData })         → { mime, base64 }
 *   remove({ backend, storageKey })                → void
 *
 * The backend NEVER exposes a public URL. Downloads always go through the
 * authenticated GET /api/profile/documents/:id/download route, which checks
 * ownership/role before streaming bytes. This is what keeps employee
 * documents private (no anonymous blob URLs).
 *
 * The Azure backend is loaded lazily and only when selected, so the pilot
 * runs without the @azure/storage-blob dependency installed.
 */

const path = require('path');
const fs = require('fs');

function getBackendName() {
  return (process.env.DOCUMENT_STORAGE_BACKEND || 'db').toLowerCase();
}

// ── db backend (base64 in Postgres) ──────────────────────────────────────────
const dbBackend = {
  name: 'db',
  async put({ base64 }) {
    // Bytes are written to pd_documents.file_data by the caller's INSERT;
    // there is no separate object to create.
    return { backend: 'db', storageKey: null, inlineData: base64 };
  },
  async get({ fileData }) {
    return { base64: fileData || null };
  },
  async remove() { /* row delete cascades the bytes */ },
};

// ── local filesystem backend ─────────────────────────────────────────────────
const localBackend = {
  name: 'local',
  _root() {
    const root = process.env.DOCUMENT_STORAGE_PATH || path.join(__dirname, '..', '.local-documents');
    fs.mkdirSync(root, { recursive: true });
    return root;
  },
  _safeKey(userId, docId, fileName) {
    // Namespaced by user; filename sanitised to prevent traversal.
    const clean = String(fileName || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
    return path.posix.join(String(userId), `${docId}__${clean}`);
  },
  async put({ userId, docId, fileName, base64 }) {
    const key = this._safeKey(userId, docId, fileName);
    const full = path.join(this._root(), key);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, Buffer.from(base64, 'base64'));
    return { backend: 'local', storageKey: key, inlineData: null };
  },
  /**
   * Resolve a storage key to an absolute path INSIDE the root, or throw.
   *
   * The previous check was `full.startsWith(root)`, which is a prefix test on
   * strings rather than a containment test on paths: with a root of
   * `/data/docs`, the path `/data/docs-evil/x` passes it. It also ignored
   * symlinks entirely, so a link inside the root could point anywhere — at, for
   * instance, the 1.97GB historical resource vault full of client material.
   *
   * This resolves both sides, compares with path.relative (the canonical
   * containment test), and then re-checks after following symlinks.
   */
  _resolveWithin(storageKey) {
    if (!storageKey || typeof storageKey !== 'string') throw new Error('Invalid storage key');
    if (path.isAbsolute(storageKey)) throw new Error('Invalid storage key');

    const root = fs.realpathSync(this._root());
    const full = path.resolve(root, storageKey);

    const rel = path.relative(root, full);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('Invalid storage key');
    }

    // Follow symlinks and verify the REAL destination is still inside. Done
    // only when the target exists; callers that create files check the parent.
    if (fs.existsSync(full)) {
      const real = fs.realpathSync(full);
      const realRel = path.relative(root, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new Error('Invalid storage key');
      }
      return real;
    }
    return full;
  },
  async get({ storageKey }) {
    const full = this._resolveWithin(storageKey);
    const buf = fs.readFileSync(full);
    return { base64: buf.toString('base64') };
  },
  async remove({ storageKey }) {
    if (!storageKey) return;
    let full;
    try { full = this._resolveWithin(storageKey); } catch (e) { return; }
    if (fs.existsSync(full)) fs.unlinkSync(full);
  },
};

// ── Azure Blob backend (loaded only when selected) ───────────────────────────
function makeAzureBackend() {
  let containerClient = null;
  function client() {
    if (containerClient) return containerClient;
    // Lazy require so the pilot doesn't need the package unless blob is used.
    const { BlobServiceClient } = require('@azure/storage-blob');
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    const container = process.env.AZURE_STORAGE_CONTAINER || 'employee-documents';
    if (!conn) throw new Error('AZURE_STORAGE_CONNECTION_STRING is not set');
    const svc = BlobServiceClient.fromConnectionString(conn);
    containerClient = svc.getContainerClient(container);
    return containerClient;
  }
  return {
    name: 'blob',
    _key: (userId, docId, fileName) => {
      const clean = String(fileName || 'file').replace(/[^A-Za-z0-9._-]/g, '_');
      return `${userId}/${docId}__${clean}`;
    },
    async put({ userId, docId, fileName, mime, base64 }) {
      const key = this._key(userId, docId, fileName);
      const buf = Buffer.from(base64, 'base64');
      const block = client().getBlockBlobClient(key);
      await block.uploadData(buf, { blobHTTPHeaders: { blobContentType: mime || 'application/octet-stream' } });
      return { backend: 'blob', storageKey: key, inlineData: null };
    },
    async get({ storageKey }) {
      const block = client().getBlockBlobClient(storageKey);
      const buf = await block.downloadToBuffer();
      return { base64: buf.toString('base64') };
    },
    async remove({ storageKey }) {
      if (!storageKey) return;
      await client().getBlockBlobClient(storageKey).deleteIfExists();
    },
  };
}

function getBackend(name = getBackendName()) {
  switch (name) {
    case 'local': return localBackend;
    case 'blob':  return makeAzureBackend();
    case 'db':
    default:      return dbBackend;
  }
}

module.exports = { getBackend, getBackendName };
