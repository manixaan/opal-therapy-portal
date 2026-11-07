'use strict';

/**
 * INDUCTION PACKS — Owner-planned inductions shipped as reviewed JSON files.
 *
 * Each `<slug>.json` in this directory is one induction, written outside the
 * portal (e.g. planned in a directors' workshop) and committed as content.
 * Resource Hub › Learning › Inductions › New induction › Import existing
 * brings every pack in as an ordinary DRAFT workflow (see
 * importExistingInductions in learning-routes.js) — the Owner reviews, edits
 * and assigns it like any other. Import is idempotent by title, so a pack the
 * Owner has already imported (and perhaps edited) is never overwritten.
 *
 * Pack shape (format "opal-induction-pack/1"):
 *
 *   {
 *     format: 'opal-induction-pack/1',
 *     slug:   'writing-a-case-note',     // must equal the file name
 *     workflow: { title, category, description, sequential, sections: [...] },
 *                                         // sections as learning-content.js
 *     walkthroughs: [{ key, title, description, group, minutes, roles,
 *                      thumb, steps: [...] }],
 *                                         // interactive walkthroughs the
 *                                         // workflow's task items launch by
 *                                         // walkthrough_key; steps as
 *                                         // walkthrough-content.js
 *     meta: { source, policy, openQuestions, ... }
 *                                         // planning record; never imported
 *   }
 *
 * Content is validated by the same normaliseContent / normaliseSteps the
 * editors use, so a pack can never hold anything the Owner could not have
 * built by hand in Assign Learning and the walkthrough workshop.
 */

const fs = require('fs');
const path = require('path');
const lc = require('../learning-content');
const wc = require('../walkthrough-content');

const FORMAT = 'opal-induction-pack/1';
const DIR = __dirname;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Validate one parsed pack. Returns { ok: true, pack } with the workflow
 * content normalised, or { ok: false, error }.
 */
function validatePack(raw, expectedSlug) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'pack must be an object' };
  if (raw.format !== FORMAT) return { ok: false, error: `format must be "${FORMAT}"` };
  const slug = String(raw.slug || '');
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug must be lower-case letters, digits and hyphens' };
  if (expectedSlug !== undefined && slug !== expectedSlug) {
    return { ok: false, error: `slug "${slug}" does not match file name "${expectedSlug}"` };
  }
  const wf = raw.workflow;
  if (!wf || typeof wf !== 'object') return { ok: false, error: 'pack needs a workflow' };
  const title = typeof wf.title === 'string' ? wf.title.trim() : '';
  if (!title) return { ok: false, error: 'workflow needs a title' };
  if (title.length > lc.LIMITS.title) return { ok: false, error: 'workflow title is too long' };
  const description = typeof wf.description === 'string' ? wf.description.trim() : '';
  if (description.length > 1000) return { ok: false, error: 'workflow description is too long' };
  const category = (typeof wf.category === 'string' && wf.category.trim()) || 'induction';
  if (category.length > 60) return { ok: false, error: 'workflow category is too long' };

  const norm = lc.normaliseContent({ sections: wf.sections, sequential: wf.sequential });
  if (!norm.ok) return { ok: false, error: norm.error };
  if (!lc.contentStats(norm.content).items) return { ok: false, error: 'workflow has no learning items' };

  const wv = validateWalkthroughs(raw.walkthroughs);
  if (!wv.ok) return wv;

  return {
    ok: true,
    pack: {
      slug, title, description: description || null, category,
      sections: norm.content.sections, sequential: !!norm.content.sequential,
      walkthroughs: wv.walkthroughs,
    },
  };
}

/**
 * The pack's own walkthroughs. A key is required and kept exactly — the
 * workflow's task items name it, so a generated key would sever the link.
 */
function validateWalkthroughs(raw) {
  if (raw === undefined || raw === null) return { ok: true, walkthroughs: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'walkthroughs must be an array' };
  const seen = new Set();
  const walkthroughs = [];
  for (const w of raw) {
    const key = String((w && w.key) || '');
    if (!SLUG_RE.test(key)) return { ok: false, error: 'every walkthrough needs a lower-case key' };
    if (seen.has(key)) return { ok: false, error: `walkthrough key "${key}" is used twice` };
    seen.add(key);
    const meta = wc.normaliseModuleMeta(w);
    if (!meta.ok) return { ok: false, error: `walkthrough "${key}": ${meta.error}` };
    const steps = wc.normaliseSteps(w.steps, meta.meta.roles);
    if (!steps.ok) return { ok: false, error: `walkthrough "${key}": ${steps.error}` };
    if (!steps.steps.length) return { ok: false, error: `walkthrough "${key}" has no steps` };
    walkthroughs.push(Object.assign({}, meta.meta, { version: 1, steps: steps.steps }));
  }
  return { ok: true, walkthroughs };
}

/**
 * Every pack in the directory, in file-name order. A malformed pack is
 * reported in `invalid` rather than thrown, so one bad file never blocks the
 * Owner's import of the rest.
 */
function loadPacks(dir = DIR) {
  const packs = [];
  const invalid = [];
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  } catch (e) {
    return { packs, invalid };
  }
  for (const file of files) {
    const slug = file.slice(0, -'.json'.length);
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    } catch (e) {
      invalid.push({ file, error: 'not valid JSON' });
      continue;
    }
    const v = validatePack(raw, slug);
    if (v.ok) packs.push(v.pack);
    else invalid.push({ file, title: raw?.workflow?.title, error: v.error });
  }
  return { packs, invalid };
}

module.exports = { FORMAT, DIR, validatePack, validateWalkthroughs, loadPacks };
