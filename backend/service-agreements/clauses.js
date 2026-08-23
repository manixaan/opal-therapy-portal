'use strict';

/**
 * SERVICE AGREEMENT — THE OWNER'S CLAUSE EDITOR
 *
 * Validates and sanitises the clause configuration an owner submits: which
 * clauses are on, what order they run in, and the text of any custom clause
 * they have added.
 *
 * ── WHY SANITISING IS A SECURITY BOUNDARY, NOT A TIDY-UP ───────────────────
 * Text an owner types here is written into a Word document that a participant
 * opens, and into a PDF and an HTML preview. Word's XML will happily carry
 * field codes, external references and embedded objects; a browser preview
 * will happily run a script. So this reduces every clause to PLAIN TEXT
 * PARAGRAPHS before it is stored — not on the way out, on the way IN, because
 * a value that was never stored cannot be forgotten about at one of the three
 * render sites.
 *
 * The approved-formatting list in the specification (headings, lists, bold,
 * italic, simple tables, Opal colours) is expressed here as STYLES rather than
 * as inline markup: a clause paragraph may be body text, an emphasis line, a
 * bullet or a sub-heading, and it takes its appearance from the template's own
 * OPAL– styles. That gives the owner the formatting vocabulary they need while
 * making arbitrary inline formatting — the part that carries the risk —
 * impossible to express at all.
 *
 * ── CLAUSE IDENTITY ────────────────────────────────────────────────────────
 * A custom clause's tag is minted by the SERVER as
 * `OPAL_CUSTOM_CLAUSE_<UUID>` and never accepted from the client. A client
 * that could choose the tag could choose `OPAL_CLAUSE_PRICING_PAYMENT` and
 * replace the pricing clause by submitting a custom one.
 */

const { randomUUID } = require('crypto');

const map = require('./template-map');

const MAX_CUSTOM_CLAUSES = 20;
const MAX_TITLE_CHARS = 160;
const MAX_BODY_CHARS = 20000;
const MAX_PARAGRAPHS = 120;

/**
 * Reduce arbitrary submitted text to plain paragraphs.
 *
 * Strips control characters, collapses runs of blank lines, and removes
 * anything that looks like markup rather than trying to interpret it. An owner
 * pasting from Word gets their words; they do not get Word's formatting, and
 * neither does anything else.
 */
function sanitiseText(value, maxChars) {
  if (value === null || value === undefined) return '';
  let s = String(value);

  // Normalise line endings first so paragraph splitting is predictable.
  s = s.replace(/\r\n?/g, '\n');
  // Strip HTML/XML tags outright. Not "escape" — a clause has no legitimate
  // reason to contain a tag, so keeping the text and dropping the markup is
  // both safer and closer to what the owner meant.
  s = s.replace(/<[^>]*>/g, ' ');
  // Control characters, including the ones Word smuggles in from a paste.
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
  // Zero-width and bidi-override characters: invisible, and a bidi override in
  // a contract can make the rendered text read differently from the stored
  // text, which is a genuine trick rather than a theoretical one.
  s = s.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '');
  // Decode the handful of entities a paste realistically carries, AFTER tag
  // stripping so "&lt;script&gt;" cannot be resurrected into a tag.
  s = s.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");

  s = s.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).join('\n');
  s = s.replace(/\n{3,}/g, '\n\n').trim();

  return s.length > maxChars ? s.slice(0, maxChars).trim() : s;
}

/** Paragraphs, capped, for rendering. */
function paragraphsOf(body) {
  return String(body || '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, MAX_PARAGRAPHS);
}

/**
 * Validate a submitted clause configuration.
 *
 * @param {object} input      { clauses: [...], custom: [...] }
 * @param {object} [existing] the currently stored snapshot, so custom clauses
 *        keep the tags they already have across an edit
 * @returns {{ ok: boolean, snapshot: object, errors: Array }}
 */
function validateClauseConfig(input, existing = null) {
  const errors = [];
  const src = input && typeof input === 'object' ? input : {};

  // ── Built-in clauses ─────────────────────────────────────────────────────
  const submitted = new Map();
  for (const c of (Array.isArray(src.clauses) ? src.clauses : [])) {
    if (!c || typeof c !== 'object') continue;
    const tag = String(c.tag || '');
    if (!map.CLAUSE_TAGS.includes(tag)) {
      errors.push({ field: 'clauses', message: `"${tag.slice(0, 60)}" is not a clause in this template.` });
      continue;
    }
    submitted.set(tag, c);
  }

  const clauses = map.CLAUSE_TAGS.map((tag, i) => {
    const c = submitted.get(tag);
    const meta = map.BLOCK_BY_TAG[tag];
    const optional = map.OPTIONAL_CLAUSE_TAGS.includes(tag);

    let enabled = true;
    if (c && c.enabled === false) {
      if (optional) enabled = false;
      else {
        errors.push({
          field: 'clauses',
          message: `"${meta.label}" is a required clause and cannot be switched off.`,
        });
      }
    }

    return {
      tag,
      label: meta.label,
      role: meta.role,
      optional,
      enabled,
      order: c && Number.isFinite(Number(c.order)) ? Number(c.order) : (meta.order ?? i * 10),
    };
  });

  // Schedules keep their lettered sequence whatever the submitted order says.
  // "Schedule C" appearing before "Schedule A" is not a layout preference, it
  // is a document that contradicts its own cross-references.
  const scheduleOrder = new Map(
    map.CLAUSE_TAGS.filter((t) => map.BLOCK_BY_TAG[t].role === 'schedule')
      .map((t) => [t, map.BLOCK_BY_TAG[t].order])
  );
  for (const c of clauses) {
    if (scheduleOrder.has(c.tag)) c.order = scheduleOrder.get(c.tag);
  }

  // ── Custom clauses ───────────────────────────────────────────────────────
  const existingTags = new Set(
    ((existing && Array.isArray(existing.custom)) ? existing.custom : [])
      .map((c) => String(c && c.tag || ''))
      .filter((t) => map.CUSTOM_CLAUSE_PATTERN.test(t))
  );

  const rawCustom = Array.isArray(src.custom) ? src.custom : [];
  if (rawCustom.length > MAX_CUSTOM_CLAUSES) {
    errors.push({
      field: 'custom',
      message: `A master may have at most ${MAX_CUSTOM_CLAUSES} custom clauses.`,
    });
  }

  const custom = [];
  for (const [i, c] of rawCustom.slice(0, MAX_CUSTOM_CLAUSES).entries()) {
    if (!c || typeof c !== 'object') continue;

    const title = sanitiseText(c.title, MAX_TITLE_CHARS).replace(/\n/g, ' ').trim();
    const body = sanitiseText(c.body, MAX_BODY_CHARS);

    if (!title) {
      errors.push({ field: 'custom', message: `Custom clause ${i + 1} needs a title.` });
      continue;
    }
    if (!body) {
      errors.push({ field: 'custom', message: `Custom clause "${title}" has no text.` });
      continue;
    }

    // Keep an existing tag; mint a new one otherwise. Never take one from the
    // client — see the file header.
    const submittedTag = String(c.tag || '');
    const tag = (map.CUSTOM_CLAUSE_PATTERN.test(submittedTag) && existingTags.has(submittedTag))
      ? submittedTag
      : map.customClauseTag(randomUUID());

    custom.push({
      tag,
      title,
      body,
      paragraphs: paragraphsOf(body),
      enabled: c.enabled !== false,
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : i,
    });
  }

  custom.sort((a, b) => a.order - b.order);
  custom.forEach((c, i) => { c.order = i; });

  return {
    ok: errors.length === 0,
    snapshot: { clauses, custom, revisedAt: null },
    errors,
  };
}

/**
 * The snapshot a master starts life with: every clause on, template order, no
 * custom clauses. Used when the v1.0 seed is registered and whenever an
 * uploaded revision arrives without an explicit configuration.
 */
function defaultClauseSnapshot() {
  return {
    clauses: map.CLAUSE_TAGS.map((tag, i) => {
      const meta = map.BLOCK_BY_TAG[tag];
      return {
        tag,
        label: meta.label,
        role: meta.role,
        optional: map.OPTIONAL_CLAUSE_TAGS.includes(tag),
        enabled: true,
        order: meta.order ?? i * 10,
      };
    }),
    custom: [],
    revisedAt: null,
  };
}

module.exports = {
  validateClauseConfig,
  defaultClauseSnapshot,
  sanitiseText,
  paragraphsOf,
  MAX_CUSTOM_CLAUSES,
  MAX_TITLE_CHARS,
  MAX_BODY_CHARS,
};
