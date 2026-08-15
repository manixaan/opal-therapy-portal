'use strict';

/**
 * OPAL MANIFEST COMPOSER — pure. No database, no network.
 *
 * THE MANIFEST IS THE SINGLE SOURCE OF TRUTH. The server composes it here; the
 * DOCX engine consumes it; the wizard preview renders from the SAME object. The
 * frontend never computes its own section list, scalar values or source
 * attribution — if it did, the preview a therapist approved could differ from
 * the document that reached a plan manager, which is exactly the failure this
 * design exists to prevent.
 *
 * ONE composer, TWO document types. Every function takes an optional
 * `catalogue` describing the template being composed (sections, required tags,
 * overridable tags, custom-section limits and the tag pattern). It defaults to
 * the FCA report's catalogue, so the FCA call sites are unchanged.
 *
 * Server-side rules enforced here, not in the browser:
 *   - REQUIRED sections cannot be deselected. A request that omits one is not
 *     an error at this layer, it is simply overruled; the section is included
 *     regardless. (The letter routes ALSO reject such a request with a 400, so
 *     a therapist is told rather than silently corrected — but the composer
 *     stays safe on its own.)
 *   - Unknown tags are dropped rather than trusted.
 *   - Ordering falls back to the template's own default order.
 *   - Custom sections are capped, trimmed and given a server-minted tag.
 *   - Excluded tags are validated against the template's own tag catalogue.
 *
 * ── EXCLUDED TAGS ───────────────────────────────────────────────────────────
 * `excludedTags` is the therapist's explicit statement that a field should
 * contribute NOTHING to the document. It is not the same as a missing value:
 * a missing value keeps the template's own "[PORTAL — …]" placeholder, which is
 * a visible prompt to finish the job in Word, whereas an excluded tag leaves an
 * empty control (or, where the template says the tag owns a whole optional
 * line, no line at all). It travels on the manifest so the engine and the
 * preview act on ONE list, and so the frozen snapshot records what was
 * deliberately omitted from a document that has already been issued.
 */

const fcaMap = require('./template-map');

/**
 * A catalogue is everything the composer needs to know about one template.
 * `requireTitle` is the one genuine difference between the two document types:
 * an FCA custom section is a HEADING and is meaningless without a title, while
 * a letter custom block may legitimately be a bare paragraph with no label.
 */
const DEFAULT_CATALOGUE = {
  SECTIONS: fcaMap.SECTIONS,
  SECTION_BY_TAG: fcaMap.SECTION_BY_TAG,
  REQUIRED_SECTION_TAGS: fcaMap.REQUIRED_SECTION_TAGS,
  OVERRIDABLE_TAGS: fcaMap.OVERRIDABLE_TAGS,
  EXCLUDABLE_TAGS: fcaMap.EXCLUDABLE_TAGS,
  MAX_CUSTOM_SECTIONS: fcaMap.MAX_CUSTOM_SECTIONS,
  MAX_CUSTOM_TITLE_CHARS: fcaMap.MAX_CUSTOM_TITLE_CHARS,
  MAX_CUSTOM_GUIDANCE_CHARS: fcaMap.MAX_CUSTOM_GUIDANCE_CHARS,
  MAX_OVERRIDE_CHARS: fcaMap.MAX_OVERRIDE_CHARS,
  customSectionTag: fcaMap.customSectionTag,
  CUSTOM_TAG_PATTERN: /^OPAL_SECTION_CUSTOM_[A-Z0-9_]+$/,
  requireTitle: true,
};

const trimTo = (value, max) => String(value ?? '').trim().slice(0, max);

/**
 * Which sections are in, in what order.
 * @returns {{ selectedSections: string[], sectionOrder: string[] }}
 */
function normaliseSelection({ selectedSections, sectionOrder } = {}, catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;

  const requested = new Set(
    Array.isArray(selectedSections)
      ? selectedSections.filter((t) => cat.SECTION_BY_TAG.has(t))
      : cat.SECTIONS.filter((s) => s.defaultSelected).map((s) => s.tag)
  );

  // Required sections are not negotiable, whatever the client sent.
  for (const tag of cat.REQUIRED_SECTION_TAGS) requested.add(tag);

  const selected = cat.SECTIONS.filter((s) => requested.has(s.tag)).map((s) => s.tag);

  const requestedOrder = Array.isArray(sectionOrder)
    ? sectionOrder.filter((t) => cat.SECTION_BY_TAG.has(t))
    : [];

  const order = [];
  const seen = new Set();
  for (const tag of requestedOrder) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    order.push(tag);
  }
  // Anything the client did not place keeps its template position.
  for (const s of cat.SECTIONS) if (!seen.has(s.tag)) order.push(s.tag);

  return { selectedSections: selected, sectionOrder: order };
}

/**
 * Clean, cap and tag the therapist's custom sections.
 * `idFactory` supplies the uuid used in the generated w:tag, so this module
 * stays pure and the caller decides where ids come from.
 */
/**
 * Rows the document must lose because their section was excluded.
 * Only EXCLUDED sections contribute; an included section keeps its row.
 */
function dependentRowsFor(sections) {
  const map = require('./template-map').SECTION_DEPENDENT_ROWS || {};
  const out = [];
  for (const s of sections) {
    if (s.included) continue;
    const label = map[s.tag];
    if (label && out.indexOf(label) === -1) out.push(label);
  }
  return out;
}

function normaliseCustomSections(customSections, idFactory, catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;
  if (!Array.isArray(customSections)) return [];

  return customSections
    .filter((c) => {
      if (!c) return false;
      const title = trimTo(c.title ?? c.label, cat.MAX_CUSTOM_TITLE_CHARS);
      if (cat.requireTitle) return Boolean(title);
      // A letter block may be a bare paragraph, but an entry with neither a
      // label nor any content is nothing at all and is dropped.
      return Boolean(title) || Boolean(trimTo(c.guidance, cat.MAX_CUSTOM_GUIDANCE_CHARS));
    })
    .slice(0, cat.MAX_CUSTOM_SECTIONS)
    .map((c, index) => {
      const title = trimTo(c.title ?? c.label, cat.MAX_CUSTOM_TITLE_CHARS);
      const id = c.id || idFactory();
      return {
        id,
        // The tag is always server-minted: a client-supplied tag could collide
        // with a template control and delete real content.
        tag: c.tag && cat.CUSTOM_TAG_PATTERN.test(c.tag)
          ? c.tag
          : cat.customSectionTag(title, id),
        title,
        guidance: trimTo(c.guidance, cat.MAX_CUSTOM_GUIDANCE_CHARS) || null,
        order: Number.isFinite(c.order) ? c.order : index,
      };
    });
}

/** Drop unknown and read-only tags, and cap length. Never trust the client. */
function normaliseOverrides(overrides, catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;
  const overridable = new Set(cat.OVERRIDABLE_TAGS);

  const out = {};
  if (!overrides || typeof overrides !== 'object') return out;
  for (const [tag, value] of Object.entries(overrides)) {
    if (!overridable.has(tag)) continue;
    if (value === null || value === undefined) { out[tag] = null; continue; }
    if (typeof value === 'object') continue;
    out[tag] = trimTo(value, cat.MAX_OVERRIDE_CHARS);
  }
  return out;
}

/**
 * Clean the therapist's exclusion list.
 *
 * Unknown tags are dropped, not trusted, exactly as section tags and overrides
 * are. Order is the therapist's own toggle order, de-duplicated, because it is
 * a set and re-sorting it would make a diff of two drafts unreadable.
 */
function normaliseExcludedFields(excludedFields, catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;
  const known = new Set(cat.EXCLUDABLE_TAGS || []);
  if (!Array.isArray(excludedFields)) return [];

  const out = [];
  const seen = new Set();
  for (const raw of excludedFields) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim();
    if (!known.has(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/**
 * Compose the manifest the engine renders and the preview displays.
 *
 * @param {string[]} selectedSections
 * @param {string[]} sectionOrder
 * @param {object[]} customSections  already normalised
 * @param {object}   scalarData      from resolveScalars
 * @param {object}   scalarSources   from resolveScalars
 * @param {string[]} excludedFields  already normalised; surfaces as excludedTags
 */
function buildManifest({
  selectedSections = [],
  sectionOrder = [],
  customSections = [],
  scalarData = {},
  scalarSources = {},
  excludedFields = [],
} = {}, catalogue = null) {
  const cat = catalogue || DEFAULT_CATALOGUE;

  const included = new Set(selectedSections);
  for (const tag of cat.REQUIRED_SECTION_TAGS) included.add(tag);

  const orderIndex = new Map(sectionOrder.map((tag, i) => [tag, i]));

  const sections = cat.SECTIONS.map((s) => ({
    tag: s.tag,
    kind: s.required ? 'required' : 'optional',
    group: s.group,
    title: s.title,
    included: s.required ? true : included.has(s.tag),
    order: orderIndex.has(s.tag) ? orderIndex.get(s.tag) : s.defaultOrder,
  }));

  // Custom sections render at the template's custom anchor, so they carry
  // their own ordering among themselves rather than joining the section order.
  const custom = customSections
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((c, i) => ({
      tag: c.tag,
      kind: 'custom',
      group: 'custom',
      title: c.title,
      guidance: c.guidance || null,
      included: true,
      order: i,
    }));

  return {
    scalarData: { ...scalarData },
    scalarSources: { ...scalarSources },
    // Re-validated here rather than trusted from the caller: the manifest is
    // what the engine acts on, so an unknown tag must not be able to reach it
    // through a path that skipped normalisation.
    excludedTags: normaliseExcludedFields(excludedFields, cat),
    sections: [...sections, ...custom],
    // Content elsewhere in the document that belongs to an excluded section.
    // Computed here so the engine never has to reason about which sections
    // imply which rows — it just removes what the manifest names.
    dependentRows: dependentRowsFor(sections),
  };
}

module.exports = {
  normaliseSelection,
  normaliseCustomSections,
  normaliseOverrides,
  normaliseExcludedFields,
  buildManifest,
  DEFAULT_CATALOGUE,
};
