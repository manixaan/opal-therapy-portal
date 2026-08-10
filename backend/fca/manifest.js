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
 * Compose the manifest the engine renders and the preview displays.
 *
 * @param {string[]} selectedSections
 * @param {string[]} sectionOrder
 * @param {object[]} customSections  already normalised
 * @param {object}   scalarData      from resolveScalars
 * @param {object}   scalarSources   from resolveScalars
 */
function buildManifest({
  selectedSections = [],
  sectionOrder = [],
  customSections = [],
  scalarData = {},
  scalarSources = {},
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
    sections: [...sections, ...custom],
  };
}

module.exports = {
  normaliseSelection,
  normaliseCustomSections,
  normaliseOverrides,
  buildManifest,
  DEFAULT_CATALOGUE,
};
