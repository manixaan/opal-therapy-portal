'use strict';

/**
 * PREVIEW DERIVATIVES for Resource Hub files.
 *
 * One service owns the pipeline from stored original to cached preview
 * artefacts, so no controller ever renders a document ad hoc:
 *
 *   original file row ─→ eligibility (privacy/state guards)
 *                     ─→ renderer by format
 *                     ─→ blob under derivatives/<hh>/<sha>-<kind>.<ext>
 *                     ─→ resource_file_derivatives row (idempotent upsert)
 *
 * WHAT GETS GENERATED
 *   pdf          thumbnail (first page, PNG)           — poppler pdftoppm
 *   docx/pptx/   thumbnail (first page/slide, PNG)     — macOS QuickLook
 *   doc/ppt/xlsx
 *   doc          preview-docx (modern rendition for the in-browser viewer)
 *                                                      — macOS textutil
 *
 * RENDERERS ARE OPTIONAL, PREVIEWS ARE NOT LOAD-BEARING. Every renderer is
 * feature-detected; on a host with none of them (e.g. a bare Linux container)
 * generation reports 'renderer-unavailable' and the UI falls back to a
 * file-type card. A missing preview never blocks ingestion, delivery or
 * browsing. Derivatives are cached bytes: generated once on a machine that has
 * the tools, they serve from any backend afterwards.
 *
 * PRIVACY GUARD. Generation refuses files whose resource is excluded-private,
 * retired or archived — a quarantined document must not leave a rendered
 * ghost behind, and cleanup deletes derivative rows (CASCADE) plus blobs.
 *
 * Idempotent: (resource_file_id, kind) is unique and the stored
 * source_checksum tells a re-run "already current" without reading bytes.
 */

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');

const fileStorage = require('./resource-file-storage');

const execFileP = promisify(execFile);

/** Version stamp on every derivative row; bump to invalidate old renders. */
const RENDERER_VERSION = '1';

const THUMB_WIDTH = 480;   // card thumbnails; 2x display width of ~240px
const RENDER_TIMEOUT_MS = 60000;

// ── Renderer availability (feature detection, cached per process) ───────────

const availability = new Map();

async function toolAvailable(tool) {
  if (availability.has(tool)) return availability.get(tool);
  let ok = false;
  try {
    await execFileP('which', [tool], { timeout: 5000 });
    ok = true;
  } catch (_) { ok = false; }
  availability.set(tool, ok);
  return ok;
}

// ── Individual renderers (Buffer in, Buffer out, via temp files) ────────────

async function withTempDir(fn) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'rhub-preview-'));
  try {
    return await fn(dir);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** PDF first page → PNG at thumbnail width. */
async function pdfThumbnail(buffer) {
  if (!(await toolAvailable('pdftoppm'))) return null;
  return withTempDir(async (dir) => {
    const src = path.join(dir, 'in.pdf');
    await fs.promises.writeFile(src, buffer);
    await execFileP(
      'pdftoppm',
      ['-png', '-f', '1', '-l', '1', '-scale-to-x', String(THUMB_WIDTH), '-scale-to-y', '-1', src, path.join(dir, 'out')],
      { timeout: RENDER_TIMEOUT_MS });
    for (const name of ['out-1.png', 'out-01.png', 'out-001.png']) {
      const p = path.join(dir, name);
      if (fs.existsSync(p)) return fs.promises.readFile(p);
    }
    return null;
  });
}

/** Any document QuickLook understands → PNG thumbnail (macOS only). */
async function quicklookThumbnail(buffer, ext) {
  if (!(await toolAvailable('qlmanage'))) return null;
  return withTempDir(async (dir) => {
    const src = path.join(dir, `in${ext}`);
    await fs.promises.writeFile(src, buffer);
    await execFileP('qlmanage', ['-t', '-s', String(THUMB_WIDTH), '-o', dir, src],
      { timeout: RENDER_TIMEOUT_MS });
    const out = path.join(dir, `in${ext}.png`);
    return fs.existsSync(out) ? fs.promises.readFile(out) : null;
  });
}

/** Legacy .doc → .docx, so the browser viewer (docx-preview) can render it. */
async function docToDocx(buffer) {
  if (!(await toolAvailable('textutil'))) return null;
  return withTempDir(async (dir) => {
    const src = path.join(dir, 'in.doc');
    await fs.promises.writeFile(src, buffer);
    await execFileP('textutil', ['-convert', 'docx', '-output', path.join(dir, 'out.docx'), src],
      { timeout: RENDER_TIMEOUT_MS });
    const out = path.join(dir, 'out.docx');
    return fs.existsSync(out) ? fs.promises.readFile(out) : null;
  });
}

// ── Plans: which derivatives a format should have ───────────────────────────

const OFFICE_EXT = { docx: '.docx', pptx: '.pptx', xlsx: '.xlsx', doc: '.doc', ppt: '.ppt' };

/**
 * What SHOULD exist for a file of this format. Preview capability in the UI:
 *   pdf   → thumbnail + full in-browser preview from the original
 *   docx  → thumbnail + full in-browser preview from the original
 *   doc   → thumbnail + preview-docx derivative for the viewer
 *   pptx/ppt/xlsx → thumbnail + fallback detail panel
 *   others → nothing (type card)
 */
function plannedKinds(format) {
  switch (String(format || '').toLowerCase()) {
    case 'pdf': return ['thumbnail'];
    case 'docx': case 'pptx': case 'xlsx': case 'ppt': return ['thumbnail'];
    case 'doc': return ['thumbnail', 'preview-docx'];
    default: return [];
  }
}

/** Formats whose ORIGINAL bytes the preview route may serve inline. */
const INLINE_PREVIEWABLE = new Set(['pdf', 'docx']);

/** The format value stored on a file row, falling back to its key's extension. */
function formatOf(fileRow) {
  if (fileRow.format) return String(fileRow.format).toLowerCase();
  const m = /\.([a-z0-9]+)$/i.exec(fileRow.storage_key || '');
  return m ? m[1].toLowerCase() : '';
}

function derivativeKey(sourceChecksum, kind, ext) {
  return `derivatives/${sourceChecksum.slice(0, 2)}/${sourceChecksum}-${kind}${ext}`;
}

// ── Generation ──────────────────────────────────────────────────────────────

/**
 * Ensure the planned derivatives exist for one file row.
 *
 * @param {object} db  a pg Pool or client with .query
 * @param {object} fileRow  { id, storage_key, format, checksum_sha256,
 *                            publication_state, access_tier, archived_at }
 *                 (join resources for the last three)
 * @returns {Promise<{fileId, format, results: Array<{kind, outcome}>}>}
 *          outcome ∈ generated | current | renderer-unavailable |
 *                    render-failed | not-eligible | no-plan
 */
async function ensureDerivatives(db, fileRow) {
  const format = formatOf(fileRow);
  const out = { fileId: fileRow.id, format, results: [] };

  // Privacy/state guard: no rendered ghosts of withdrawn material.
  if (fileRow.access_tier === 'excluded-private'
      || fileRow.publication_state === 'excluded-private'
      || fileRow.publication_state === 'retired'
      || fileRow.archived_at) {
    out.results.push({ kind: '*', outcome: 'not-eligible' });
    return out;
  }
  if (!fileRow.storage_key || !fileRow.checksum_sha256) {
    out.results.push({ kind: '*', outcome: 'not-eligible' });
    return out;
  }

  const kinds = plannedKinds(format);
  if (!kinds.length) {
    out.results.push({ kind: '*', outcome: 'no-plan' });
    return out;
  }

  const { rows: existing } = await db.query(
    `SELECT kind, source_checksum_sha256, renderer_version
       FROM resource_file_derivatives WHERE resource_file_id = $1`, [fileRow.id]);
  const current = new Map(existing.map((r) => [r.kind, r]));

  let original = null; // read lazily, once, only if something needs generating

  for (const kind of kinds) {
    const have = current.get(kind);
    if (have && have.source_checksum_sha256 === fileRow.checksum_sha256
        && have.renderer_version === RENDERER_VERSION) {
      out.results.push({ kind, outcome: 'current' });
      continue;
    }

    try {
      if (original === null) original = await fileStorage.getBuffer(fileRow.storage_key);
    } catch (err) {
      out.results.push({ kind, outcome: 'render-failed' });
      continue;
    }

    let rendered = null;
    let renderer = null;
    let ext = '.png';
    let outFormat = 'png';
    try {
      if (kind === 'thumbnail') {
        if (format === 'pdf') {
          rendered = await pdfThumbnail(original);
          renderer = 'poppler-pdftoppm';
        } else if (OFFICE_EXT[format]) {
          rendered = await quicklookThumbnail(original, OFFICE_EXT[format]);
          renderer = 'quicklook';
        }
      } else if (kind === 'preview-docx') {
        rendered = await docToDocx(original);
        renderer = 'textutil';
        ext = '.docx';
        outFormat = 'docx';
      }
    } catch (err) {
      rendered = null;
    }

    if (!rendered) {
      const toolsChecked = kind === 'preview-docx' ? ['textutil']
        : format === 'pdf' ? ['pdftoppm'] : ['qlmanage'];
      let anyTool = false;
      for (const t of toolsChecked) anyTool = anyTool || await toolAvailable(t);
      out.results.push({ kind, outcome: anyTool ? 'render-failed' : 'renderer-unavailable' });
      continue;
    }

    const key = derivativeKey(fileRow.checksum_sha256, kind, ext);
    const putRes = await fileStorage.putBuffer(key, rendered);
    await db.query(
      `INSERT INTO resource_file_derivatives
         (resource_file_id, kind, storage_backend, storage_key, format,
          size_bytes, checksum_sha256, source_checksum_sha256, renderer, renderer_version)
       VALUES ($1,$2,'rhub',$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (resource_file_id, kind) DO UPDATE
         SET storage_key = EXCLUDED.storage_key,
             format = EXCLUDED.format,
             size_bytes = EXCLUDED.size_bytes,
             checksum_sha256 = EXCLUDED.checksum_sha256,
             source_checksum_sha256 = EXCLUDED.source_checksum_sha256,
             renderer = EXCLUDED.renderer,
             renderer_version = EXCLUDED.renderer_version,
             generated_at = NOW()`,
      [fileRow.id, kind, key, outFormat, rendered.length,
        putRes.sha256, fileRow.checksum_sha256, renderer, RENDERER_VERSION]);
    out.results.push({ kind, outcome: 'generated' });
  }
  return out;
}

/**
 * Remove every derivative row and blob for a file — the cleanup half of the
 * privacy guard. Reference-aware on blobs: two file rows sharing one original
 * share derivative keys too, so the blob goes only when the LAST row using
 * that key is gone.
 */
async function removeDerivatives(db, resourceFileId) {
  const { rows } = await db.query(
    `DELETE FROM resource_file_derivatives WHERE resource_file_id = $1
     RETURNING storage_key`, [resourceFileId]);
  for (const r of rows) {
    const { rows: still } = await db.query(
      `SELECT 1 FROM resource_file_derivatives WHERE storage_key = $1 LIMIT 1`, [r.storage_key]);
    if (!still.length) await fileStorage.removeBlob(r.storage_key);
  }
  return rows.length;
}

module.exports = {
  RENDERER_VERSION,
  THUMB_WIDTH,
  INLINE_PREVIEWABLE,
  plannedKinds,
  formatOf,
  derivativeKey,
  ensureDerivatives,
  removeDerivatives,
  // exposed for tests
  toolAvailable,
};
