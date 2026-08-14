'use strict';

/**
 * WHODAS 2.0 — TEMPLATE REGISTRY
 *
 * The immutable WHO source documents: verifying them, serving their bytes, and
 * keeping the `whodas_templates` table in step with what is actually on disk.
 *
 * The hash is the whole point. Every assessment records the SHA-256 of the
 * document it was rendered from, so "this is a completed copy of the WHO
 * instrument" is a checkable claim rather than a promise. A template whose
 * bytes have changed is refused at boot rather than allowed to quietly serve
 * a different document than the one an earlier assessment was completed on.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const MANIFEST_PATH = path.join(TEMPLATES_DIR, 'manifest.json');
const FIELD_MAPS_DIR = path.join(__dirname, 'field-maps');

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

let cachedManifest = null;

function manifest() {
  if (!cachedManifest) {
    cachedManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  }
  return cachedManifest;
}

/** Every registered template, including the interviewer flashcards. */
function allTemplates() {
  return manifest().templates;
}

/** The instrument templates only — the flashcards are administration support. */
function instrumentTemplates() {
  return allTemplates().filter((t) => t.key !== 'whodas-36-flashcards');
}

function templateByKey(key) {
  return allTemplates().find((t) => t.key === key) || null;
}

/** The 36-item instrument for one administration method. */
function templateForMethod(method) {
  return instrumentTemplates().find((t) => t.method === method) || null;
}

function flashcardsTemplate() {
  return templateByKey('whodas-36-flashcards');
}

/**
 * Read a template's bytes, re-checking the hash on every read.
 *
 * Re-hashing on read rather than trusting the boot check is deliberate: these
 * bytes are about to be sent to a clinician as "the official WHO form", or used
 * as the base of a completed clinical document. The cost is a hash of a
 * few hundred KB; the alternative is serving a silently altered instrument.
 */
function readTemplateBytes(key) {
  const tpl = templateByKey(key);
  if (!tpl) throw new Error(`Unknown WHODAS template: ${key}`);

  const file = path.join(TEMPLATES_DIR, tpl.filename);
  const bytes = fs.readFileSync(file);
  const actual = sha256(bytes);

  if (actual !== tpl.sha256) {
    const err = new Error(
      `WHODAS template ${key} failed integrity check. Expected ${tpl.sha256}, got ${actual}. ` +
      'Refusing to serve a modified copy of the WHO instrument.'
    );
    err.code = 'TEMPLATE_INTEGRITY_FAILURE';
    throw err;
  }
  return bytes;
}

let cachedFieldMaps = null;

/** Field maps derived from the templates by build-instrument-data.js. */
function fieldMap(key) {
  if (!cachedFieldMaps) cachedFieldMaps = {};
  if (!cachedFieldMaps[key]) {
    const file = path.join(FIELD_MAPS_DIR, `${key}.json`);
    if (!fs.existsSync(file)) return null;
    cachedFieldMaps[key] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return cachedFieldMaps[key];
}

let cachedInstrumentData = null;

/** Item wording per administration method, derived from the template PDFs. */
function instrumentData() {
  if (!cachedInstrumentData) {
    cachedInstrumentData = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'instrument-data.json'), 'utf8')
    );
  }
  return cachedInstrumentData;
}

/**
 * Verify every template on disk against the manifest.
 * @returns {{ ok: boolean, checked: number, failures: Array }}
 */
function verifyTemplates() {
  const failures = [];
  for (const tpl of allTemplates()) {
    const file = path.join(TEMPLATES_DIR, tpl.filename);
    if (!fs.existsSync(file)) {
      failures.push({ key: tpl.key, reason: 'missing', file: tpl.filename });
      continue;
    }
    const actual = sha256(fs.readFileSync(file));
    if (actual !== tpl.sha256) {
      failures.push({ key: tpl.key, reason: 'hash_mismatch', expected: tpl.sha256, actual });
    }
  }
  return { ok: failures.length === 0, checked: allTemplates().length, failures };
}

/**
 * Verify the field maps still describe the templates they were derived from.
 * A field map pinned to an older hash would place response marks using
 * coordinates measured on a different document.
 */
function verifyFieldMaps() {
  const failures = [];
  for (const tpl of instrumentTemplates()) {
    const map = fieldMap(tpl.key);
    if (!map) {
      failures.push({ key: tpl.key, reason: 'missing_field_map' });
      continue;
    }
    if (map.templateSha256 !== tpl.sha256) {
      failures.push({
        key: tpl.key,
        reason: 'field_map_stale',
        expected: tpl.sha256,
        actual: map.templateSha256,
      });
    }
    const radioGroups = map.fields.filter((f) => f.type === 'radio-group' && f.scored).length;
    if (radioGroups !== 36) {
      failures.push({ key: tpl.key, reason: 'wrong_scored_field_count', count: radioGroups });
    }
  }
  return { ok: failures.length === 0, failures };
}

/**
 * Bring `whodas_templates` into step with the manifest.
 *
 * Insert-or-reactivate only: an existing row is never rewritten, because the
 * table's trigger freezes any version an assessment has already been rendered
 * from. Publishing a changed document means a new version, which is exactly the
 * property that keeps old assessments explicable.
 */
async function syncTemplates(pool, { logger } = {}) {
  const integrity = verifyTemplates();
  if (!integrity.ok) {
    const err = new Error(
      `WHODAS template integrity check failed: ${JSON.stringify(integrity.failures)}`
    );
    err.code = 'TEMPLATE_INTEGRITY_FAILURE';
    throw err;
  }

  const source = manifest().source;
  let inserted = 0;

  for (const tpl of allTemplates()) {
    const provenance = {
      sourceTitle: source.title,
      sourceSha256: source.sha256,
      sourcePages: tpl.sourcePages,
      copyright: source.copyright,
      extraction: manifest().extraction,
    };

    const { rowCount } = await pool.query(
      `INSERT INTO whodas_templates
         (template_key, version, instrument, item_set, method, name, storage_path,
          sha256, page_count, media_box, crop_box, source_provenance, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,TRUE)
       ON CONFLICT (template_key, version) DO NOTHING`,
      [
        tpl.key,
        tpl.version,
        tpl.instrument,
        tpl.itemSet,
        tpl.method,
        tpl.name,
        tpl.filename,
        tpl.sha256,
        tpl.pageCount,
        JSON.stringify(tpl.mediaBox),
        JSON.stringify(tpl.cropBox),
        JSON.stringify(provenance),
      ]
    );
    inserted += rowCount;
  }

  // A registered version whose bytes changed on disk is a hard stop: assessments
  // already reference that hash.
  const { rows } = await pool.query(
    'SELECT template_key, version, sha256 FROM whodas_templates WHERE is_active = TRUE'
  );
  const drifted = rows.filter((r) => {
    const tpl = allTemplates().find((t) => t.key === r.template_key && t.version === r.version);
    return tpl && tpl.sha256 !== r.sha256;
  });
  if (drifted.length) {
    const err = new Error(
      'WHODAS templates registered in the database no longer match the files on disk: ' +
      `${drifted.map((d) => `${d.template_key}@${d.version}`).join(', ')}. ` +
      'Register a new version rather than editing a published one.'
    );
    err.code = 'TEMPLATE_INTEGRITY_FAILURE';
    throw err;
  }

  if (logger) {
    logger.info('whodas templates synced', {
      registered: allTemplates().length,
      inserted,
    });
  }
  return { registered: allTemplates().length, inserted };
}

/** Look up the DB row for a template key at its manifest version. */
async function activeTemplateRow(pool, key) {
  const tpl = templateByKey(key);
  if (!tpl) return null;
  const { rows } = await pool.query(
    `SELECT * FROM whodas_templates
      WHERE template_key = $1 AND version = $2 AND is_active = TRUE
      LIMIT 1`,
    [key, tpl.version]
  );
  return rows[0] || null;
}

module.exports = {
  TEMPLATES_DIR,
  manifest,
  allTemplates,
  instrumentTemplates,
  templateByKey,
  templateForMethod,
  flashcardsTemplate,
  readTemplateBytes,
  fieldMap,
  instrumentData,
  verifyTemplates,
  verifyFieldMaps,
  syncTemplates,
  activeTemplateRow,
  sha256,
};
