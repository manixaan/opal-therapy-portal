'use strict';

/**
 * OPAL POLICY LIBRARY — the drafted text behind the document slots.
 *
 * onboarding-catalogue.js seeds 29 Opal-authored document SLOTS as
 * `content_status = 'document_required'` and deliberately writes no words into
 * them. This directory holds the words: one plain-text file per slot, keyed by
 * the same code, parsed here into a version payload the library can store.
 *
 * ── WHY PLAIN TEXT, NOT MARKDOWN OR HTML ───────────────────────────────────
 * A version body is rendered escaped inside `white-space: pre-wrap`
 * (onboarding.css `.ob-doc`) and shipped in a starter pack as `.txt`
 * (onboarding-starter-pack.js). Markdown syntax would reach an employee as
 * literal asterisks. So structure is carried by numbered headings, blank lines
 * and `•` bullets — the same vocabulary opal-document-builder renders, which
 * is what lets render.js turn one of these into a branded Word file without
 * re-authoring it.
 *
 * ── WHY NOTHING HERE IS PUBLISHED ──────────────────────────────────────────
 * These are DRAFTS. The seeder's refusal to invent authoritative-sounding
 * policy text (onboarding-seed.js) is not weakened by generating one: the slot
 * still holds no published version, the acknowledgement workflow still has
 * nothing to point at, and an employee still sees nothing, until a human reads
 * the draft and presses publish. load-policy-drafts.js can only ever create a
 * draft version; it has no publish path.
 *
 * ── THE TWO PLACEHOLDER KINDS, AND WHY THEY DIFFER ─────────────────────────
 *   {{OPAL_ORG_ABN}}         A fact the portal already stores. The loader
 *                            substitutes it from organisation settings, and
 *                            any tag it cannot resolve becomes a visible
 *                            [TO CONFIRM: …] rather than reaching an employee
 *                            as a raw template token.
 *   [TO CONFIRM: a named     A decision only the Owner can make — who holds a
 *   WHS contact]             role, which insurer, which timeframe. Left in the
 *                            text on purpose: a policy that names an invented
 *                            person is worse than one that visibly asks.
 *
 * Both are counted by review.js and by the test suite, so "how much of this is
 * still placeholder" is a number rather than an impression.
 */

const fs = require('fs');
const path = require('path');

const DIR = __dirname;

/** Org-settings tags a policy body may reference. Mirrors service-agreements/organisation.js. */
const ORG_TAGS = {
  OPAL_ORG_LEGAL_NAME: 'legal entity name',
  OPAL_ORG_TRADING_NAME: 'trading name',
  OPAL_ORG_ABN: 'ABN',
  OPAL_ORG_NDIS_REGISTRATION_NUMBER: 'NDIS registration number',
  OPAL_ORG_ADDRESS: 'business address',
  OPAL_ORG_PHONE: 'business phone number',
  OPAL_ORG_EMAIL: 'business email address',
  OPAL_ORG_WEBSITE: 'website',
  OPAL_ORG_COMPLAINTS_CONTACT: 'complaints contact',
  OPAL_ORG_PRIVACY_CONTACT: 'privacy contact',
};

const REQUIRED_KEYS = ['code', 'title', 'category', 'tier', 'acknowledgement', 'summary', 'reviewCycleMonths'];

const TOKEN_RE = /\{\{([A-Z0-9_]+)\}\}/g;
const CONFIRM_RE = /\[TO CONFIRM:[^\]]*\]/g;

/**
 * Parse one policy file.
 *
 * Header is `---` delimited `key: value` lines. Deliberately not YAML: the
 * header carries seven scalars, and a parser small enough to read in full is
 * worth more here than a dependency that would also accept anchors, aliases
 * and arbitrary object graphs from a file that ends up in front of employees.
 */
function parse(text, sourceName) {
  const normalised = String(text).replace(/\r\n?/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(normalised);
  if (!m) throw new Error(`${sourceName}: expected a --- delimited header followed by the body`);

  const meta = {};
  for (const line of m[1].split('\n')) {
    if (!line.trim()) continue;
    const kv = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!kv) throw new Error(`${sourceName}: header line is not "key: value" — ${line}`);
    if (Object.prototype.hasOwnProperty.call(meta, kv[1])) {
      throw new Error(`${sourceName}: duplicate header key "${kv[1]}"`);
    }
    meta[kv[1]] = kv[2].trim();
  }

  for (const key of REQUIRED_KEYS) {
    if (!meta[key]) throw new Error(`${sourceName}: header is missing "${key}"`);
  }
  if (!/^[1-3]$/.test(meta.tier)) throw new Error(`${sourceName}: tier must be 1, 2 or 3`);
  if (!/^(yes|no)$/.test(meta.acknowledgement)) {
    throw new Error(`${sourceName}: acknowledgement must be yes or no`);
  }
  if (!/^\d{1,3}$/.test(meta.reviewCycleMonths)) {
    throw new Error(`${sourceName}: reviewCycleMonths must be a number of months`);
  }

  const body = m[2].replace(/\s+$/, '');
  if (!body) throw new Error(`${sourceName}: body is empty`);

  return {
    code: meta.code,
    title: meta.title,
    category: meta.category,
    tier: Number(meta.tier),
    acknowledgement: meta.acknowledgement === 'yes',
    summary: meta.summary,
    reviewCycleMonths: Number(meta.reviewCycleMonths),
    basis: meta.basis ? meta.basis.split(';').map((s) => s.trim()).filter(Boolean) : [],
    related: meta.related ? meta.related.split(';').map((s) => s.trim()).filter(Boolean) : [],
    body,
    tokens: [...new Set([...body.matchAll(TOKEN_RE)].map((t) => t[1]))],
    confirmations: body.match(CONFIRM_RE) || [],
    fileName: `${meta.code}.txt`,
  };
}

/** Every policy on disk, in code order. Throws on the first malformed file. */
function loadAll() {
  return fs.readdirSync(DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()
    .map((f) => parse(fs.readFileSync(path.join(DIR, f), 'utf8'), f));
}

function loadOne(code) {
  const file = path.join(DIR, `${String(code).replace(/[^A-Z0-9_]/g, '')}.txt`);
  if (!fs.existsSync(file)) return null;
  return parse(fs.readFileSync(file, 'utf8'), path.basename(file));
}

/**
 * Substitute org tags, and make every unresolved one visible.
 *
 * The fallback is the point. A policy that reaches an employee saying
 * "{{OPAL_ORG_ABN}}" looks like a broken system; one saying
 * "[TO CONFIRM: ABN]" looks like an unfinished document, which is what it is.
 */
function applyOrganisation(body, orgValues = {}) {
  const unresolved = new Set();
  const rendered = String(body).replace(TOKEN_RE, (whole, tag) => {
    if (!Object.prototype.hasOwnProperty.call(ORG_TAGS, tag)) return whole;
    const value = orgValues[tag];
    if (value === null || value === undefined || String(value).trim() === '') {
      unresolved.add(tag);
      return `[TO CONFIRM: ${ORG_TAGS[tag]}]`;
    }
    return String(value).trim();
  });
  return { body: rendered, unresolved: [...unresolved] };
}

/** The payload createDocumentVersion() expects for a policy draft. */
function versionPayload(policy, { orgValues = {}, changeNote = null } = {}) {
  const { body, unresolved } = applyOrganisation(policy.body, orgValues);
  return {
    payload: {
      title: policy.title,
      summary: policy.summary,
      body,
      changeNote: changeNote
        || `Generated draft from onboarding-policies/${policy.fileName}. Not reviewed, not in force.`,
    },
    unresolved,
    confirmations: (body.match(CONFIRM_RE) || []).length,
  };
}

module.exports = { ORG_TAGS, DIR, parse, loadAll, loadOne, applyOrganisation, versionPayload };
