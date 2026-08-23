'use strict';

/**
 * SERVICE AGREEMENT — MANIFEST COMPOSER. Pure: no database, no network, no
 * clock beyond what the caller passes in.
 *
 * THE MANIFEST IS THE SINGLE SOURCE OF TRUTH, and here that claim is doing
 * more work than it does for the FCA report. There, one manifest drives one
 * renderer. Here ONE manifest drives THREE outputs — the Word document, the
 * fillable PDF and the wizard's live preview — and they must agree, because
 * the PDF is what a participant signs and the preview is what a staff member
 * approved. If the PDF re-derived "is this field blank?" from the form data
 * instead of reading it here, a field could be prefilled in the document and
 * left interactive in the PDF, and the participant would be invited to
 * overwrite a price nobody meant them to change.
 *
 * ── EVERY SCALAR GETS A STRING. ALWAYS. ────────────────────────────────────
 * The engine leaves a control alone when its value is null, which preserves
 * the template's own "[PORTAL — …]" placeholder. For the FCA report that is
 * right: the placeholder is a prompt to a therapist finishing the job in Word.
 * For a service agreement it is a leak, because the document goes to a
 * participant.
 *
 * So `scalarData` always carries all 83 tags. A field with no value gets one
 * of exactly two things, chosen by `blankStyle`:
 *
 *   'empty'   ''  — a blank, still-editable control. Correct for anything a
 *                   participant receives: the blank IS the question.
 *   'prompt'  the human-readable prompt from template-map — "Enter participant
 *             full name". Correct only for a manual Word copy that a person
 *             will complete in Word, where an unlabelled empty box in a table
 *             cell is indistinguishable from a field nobody needed.
 *
 * Neither is ever the template's bracketed placeholder.
 *
 * ── AUTHORITY IS ENFORCED HERE, NOT TRUSTED ────────────────────────────────
 * Values arrive from several places and are NOT equally trusted. Server
 * values, the organisation snapshot and signature values are taken from their
 * own arguments; `formData` — the only caller-supplied bag, and the one that
 * carries whatever a browser posted — is consulted ONLY for tags whose
 * authority is 'portal'. A signature, an ABN or an agreement reference sitting
 * in formData is silently ignored rather than written, which is what makes
 * "never accept signature values from an ordinary form save" true rather than
 * merely intended.
 *
 * ── MONEY ──────────────────────────────────────────────────────────────────
 * Estimated totals are computed in INTEGER CENTS. 0.1 + 0.2 is not 0.3 in
 * binary floating point, and an agreement is a price list: a cent of drift is
 * a wrong number in a contract. See money().
 */

const map = require('./template-map');

// ─────────────────────────────────────────────────────────────────────────────
//  Money
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a currency-ish string to integer cents, or null when it is not a
 * number at all.
 *
 * Accepts "$193.99", "193.99", "1,234.50", 193.99. Rejects "" and "TBC" by
 * returning null — a total is then left blank rather than computed as 0, since
 * "$0.00" in a service agreement is a claim, and the wrong one.
 */
function toCents(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  const cleaned = String(value).replace(/[\s$,]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  // Round half away from zero on the cent, rather than trusting the binary
  // representation of the parsed float at the third decimal place.
  return Math.round(parseFloat(cleaned) * 100);
}

/** Integer cents → "1234.50". Never a float in the middle. */
function centsToString(cents) {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Integer cents → "$1,234.50", for display. */
function money(cents) {
  if (cents === null || cents === undefined) return '';
  const plain = centsToString(cents);
  const [whole, frac] = plain.replace('-', '').split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}$${grouped}.${frac}`;
}

/**
 * A support's estimated total.
 *
 * Only computed when BOTH rate and quantity parse. A quantity of "as needed"
 * is a real and common answer, and multiplying it by anything is a fiction; in
 * that case the caller's own estimated-total value is used if they supplied
 * one, and the field is left blank if they did not.
 */
function estimatedTotalCents(rate, quantity) {
  const rateCents = toCents(rate);
  if (rateCents === null) return null;
  const qty = quantity === null || quantity === undefined
    ? null
    : parseFloat(String(quantity).replace(/[\s,]/g, ''));
  if (qty === null || !Number.isFinite(qty)) return null;
  // cents × quantity, rounded once, at the end.
  return Math.round(rateCents * qty);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Dates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Australian English: DD/MM/YYYY. ISO components are read in UTC because the
 * process is pinned to UTC and an agreement date must not shift by a day for a
 * reader in another timezone. Matches fca/document-id.js.
 */
function australianDate(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const iso = d.toISOString().slice(0, 10);
  const [y, m, dd] = iso.split('-');
  return `${dd}/${m}/${y}`;
}

/** Already-formatted DD/MM/YYYY passes through untouched. */
function asDate(value) {
  if (value === null || value === undefined || value === '') return '';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(value))) return String(value);
  return australianDate(value);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Composition
// ─────────────────────────────────────────────────────────────────────────────

const MAX_SUPPORTS = 40;
const MAX_CUSTOM_CLAUSES = 20;
const MAX_VALUE_CHARS = 4000;

function trimmed(value, maxChars = MAX_VALUE_CHARS) {
  if (value === null || value === undefined) return null;
  const s = String(value).replace(/\r\n/g, '\n').trim();
  if (!s) return null;
  return s.length > maxChars ? s.slice(0, maxChars) : s;
}

/**
 * Compose the manifest.
 *
 * @param {object}  input
 * @param {object}  input.formData      portal-authority values, {tag: value}
 * @param {Array}   input.supports      [{tag: value}] one per agreed support
 * @param {object}  input.serverValues  server-authority values, {tag: value}
 * @param {object}  input.organisation  owner-authority values, {tag: value}
 * @param {object}  input.signatures    e-sign values, {tag: value}. Only ever
 *                  passed by the signing path; every other caller omits it.
 * @param {object}  input.clauseSnapshot {clauses:[{tag,enabled,order,title,body}],
 *                  custom:[{tag,title,body,order}]}
 * @param {'empty'|'prompt'} input.blankStyle
 * @param {'participant'|'owner'} input.audience
 * @returns {object} manifest
 */
function composeAgreementManifest(input) {
  const {
    formData = {},
    supports = [],
    serverValues = {},
    organisation = {},
    signatures = {},
    clauseSnapshot = {},
    blankStyle = 'empty',
    audience = 'participant',
  } = input || {};

  const warnings = [];
  const scalarData = Object.create(null);
  const sources = Object.create(null);
  const blanks = [];

  const blankFor = (tag) => (blankStyle === 'prompt' ? map.promptFor(tag) : '');

  // ── Supports, normalised first: the detail panel reads from support #1 ────
  const rows = normaliseSupports(supports, warnings);

  // ── Every scalar, by authority ───────────────────────────────────────────
  for (const field of map.SCALARS) {
    const { tag, authority } = field;

    let raw = null;
    let source = null;

    if (authority === map.AUTHORITY.SERVER) {
      raw = serverValues[tag];
      source = 'server';
    } else if (authority === map.AUTHORITY.OWNER) {
      raw = organisation[tag];
      source = 'organisation';
    } else if (authority === map.AUTHORITY.ESIGN) {
      // ONLY from the signatures argument. A signature in formData is ignored.
      raw = signatures[tag];
      source = 'esign';
    } else if (field.repeatRow) {
      // Cloned per support — the canonical control is populated from the first
      // row so a single-support agreement reads correctly even before the
      // clone pass, and every row carries its own value via repeatRows below.
      raw = rows.length ? rows[0][tag] : null;
      source = rows.length ? 'supports' : null;
    } else if (field.detail) {
      raw = rows.length ? rows[0][tag] : null;
      source = rows.length ? 'supports' : null;
    } else {
      raw = formData[tag];
      source = 'portal';
    }

    let value = trimmed(raw);
    if (value !== null && field.kind === map.KIND.DATE) value = asDate(value);
    if (value !== null && field.kind === map.KIND.CHOICE && field.choices) {
      value = matchChoice(value, field.choices, tag, warnings);
    }

    if (value === null) {
      scalarData[tag] = blankFor(tag);
      blanks.push(tag);
      sources[tag] = null;
    } else {
      scalarData[tag] = value;
      sources[tag] = source;
    }
  }

  // More than one support means the single detail panel describes only the
  // first. Say so rather than letting a reader assume it describes all three.
  if (rows.length > 1) {
    warnings.push(
      `The agreement has ${rows.length} supports, but the template's support-detail panel has one `
      + 'set of controls. It describes the first support; the remaining supports appear in the '
      + 'schedule table only.'
    );
  }

  // ── Clause sections ──────────────────────────────────────────────────────
  const sections = composeSections(clauseSnapshot, audience, warnings);

  // ── Repeat rows ──────────────────────────────────────────────────────────
  const repeatRows = [{
    tag: map.REPEAT_SUPPORT_ROW,
    rows: rows.map((r) => {
      const out = Object.create(null);
      for (const tag of map.REPEAT_ROW_TAGS) {
        const f = map.SCALAR_BY_TAG[tag];
        let v = trimmed(r[tag]);
        if (v !== null && f.kind === map.KIND.CHOICE && f.choices) {
          v = matchChoice(v, f.choices, tag, warnings);
        }
        out[tag] = v === null ? blankFor(tag) : v;
      }
      return out;
    }),
  }];

  return {
    scalarData,
    sections,
    repeatRows,
    // Nothing uses the engine's exclusion path here: a blank service-agreement
    // control must SURVIVE as a blank control, which is the opposite of what
    // exclusion does.
    excludedTags: [],

    // Consumed by the PDF renderer and the preview. Not by the engine.
    fields: map.SCALARS.map((f) => ({
      tag: f.tag,
      kind: f.kind,
      authority: f.authority,
      prompt: f.prompt,
      pdfName: f.pdfName,
      choices: f.choices,
      group: f.group,
      repeatRow: f.repeatRow,
      detail: f.detail,
      participantEditable: f.participantEditable,
      value: scalarData[f.tag],
      blank: blanks.includes(f.tag),
      source: sources[f.tag],
    })),
    supports: rows,
    supportTotals: totals(rows),
    blanks,
    sources,
    audience,
    blankStyle,
    warnings,
  };
}

/**
 * Normalise the supports array: keep only known tags, cap the count, and fill
 * in an estimated total where one can be computed and none was given.
 */
function normaliseSupports(supports, warnings) {
  const input = Array.isArray(supports) ? supports : [];
  if (input.length > MAX_SUPPORTS) {
    warnings.push(`Only the first ${MAX_SUPPORTS} supports were included; ${input.length} were supplied.`);
  }

  return input.slice(0, MAX_SUPPORTS).map((raw) => {
    const row = Object.create(null);
    for (const tag of map.SUPPORT_ROW_TAGS) {
      row[tag] = trimmed(raw && raw[tag]);
    }

    // Compute the estimated total only when it was not supplied. A staff
    // member who typed a negotiated total meant it, and rate × quantity is an
    // estimate, not an authority.
    if (row.OPAL_SUPPORT_ESTIMATED_TOTAL === null) {
      const cents = estimatedTotalCents(
        row.OPAL_SUPPORT_RATE, row.OPAL_SUPPORT_ESTIMATED_QUANTITY
      );
      if (cents !== null) row.OPAL_SUPPORT_ESTIMATED_TOTAL = money(cents);
    }
    return row;
  });
}

/** Decimal-safe sum across supports. Returns cents plus a display string. */
function totals(rows) {
  let cents = 0;
  let counted = 0;
  let uncounted = 0;
  for (const r of rows) {
    const c = toCents(r.OPAL_SUPPORT_ESTIMATED_TOTAL);
    if (c === null) uncounted += 1;
    else { cents += c; counted += 1; }
  }
  return {
    cents: counted ? cents : null,
    display: counted ? money(cents) : '',
    counted,
    // Supports whose total could not be read. A grand total that silently
    // omits two lines is worse than no grand total.
    uncounted,
  };
}

/**
 * Map a submitted value onto one of the template's option strings.
 *
 * Case- and punctuation-insensitive, because "yes", "Yes" and "YES" are the
 * same answer and a consent that fails to register because of a capital letter
 * is a clinical-governance failure, not a typo. An unrecognised value is kept
 * verbatim with a warning rather than discarded: the participant said
 * something, and dropping it would be worse than showing it.
 */
function matchChoice(value, choices, tag, warnings) {
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = norm(value);
  const hit = choices.find((c) => norm(c) === target);
  if (hit) return hit;
  // Accept a leading-word match: "Yes, I agree" → "Yes".
  const loose = choices.find((c) => target.startsWith(norm(c)));
  if (loose) return loose;
  warnings.push(`${tag}: "${String(value).slice(0, 40)}" is not one of ${choices.join(' / ')}.`);
  return String(value);
}

/**
 * Turn the pinned clause snapshot into the engine's section list.
 *
 * A snapshot that says nothing about a clause means "as the template has it" —
 * included, in template order. That default matters: an agreement issued
 * before a clause existed must not lose it, and an empty snapshot must produce
 * the complete document rather than an empty one.
 */
function composeSections(snapshot, audience, warnings) {
  const declared = new Map();
  for (const c of (snapshot && Array.isArray(snapshot.clauses) ? snapshot.clauses : [])) {
    if (c && c.tag) declared.set(c.tag, c);
  }

  const sections = [];
  for (const tag of map.CLAUSE_TAGS) {
    const d = declared.get(tag);
    const optional = map.OPTIONAL_CLAUSE_TAGS.includes(tag);
    // A mandatory clause cannot be switched off, whatever the snapshot says.
    // The owner editor refuses it too, but a snapshot is data that has been
    // sitting in a database and this is the layer that renders it.
    let included = true;
    if (d && d.enabled === false) {
      if (optional) included = false;
      else warnings.push(`${tag} is a required clause and was included despite the snapshot.`);
    }
    sections.push({
      tag,
      included,
      order: d && Number.isFinite(d.order) ? d.order : (map.BLOCK_BY_TAG[tag] || {}).order,
    });
  }

  const custom = (snapshot && Array.isArray(snapshot.custom) ? snapshot.custom : [])
    .filter((c) => c && map.CUSTOM_CLAUSE_PATTERN.test(String(c.tag)))
    .slice(0, MAX_CUSTOM_CLAUSES)
    .map((c, i) => ({
      kind: 'custom',
      tag: c.tag,
      title: trimmed(c.title, 160) || '',
      body: trimmed(c.body, 20000) || '',
      order: Number.isFinite(c.order) ? c.order : i,
      included: c.enabled !== false,
    }));

  const dropped = (snapshot && Array.isArray(snapshot.custom) ? snapshot.custom.length : 0)
    - custom.length;
  if (dropped > 0) {
    warnings.push(`${dropped} custom clause(s) were dropped: an unrecognised tag or over the limit of ${MAX_CUSTOM_CLAUSES}.`);
  }

  // The owner's own copy keeps the internal blocks; the participant path adds
  // their exclusion in docx.js so removal goes through one code path.
  if (audience === 'owner') {
    for (const tag of map.INTERNAL_BLOCK_TAGS) sections.push({ tag, included: true });
  }

  return [...sections, ...custom];
}

module.exports = {
  composeAgreementManifest,
  normaliseSupports,
  composeSections,
  matchChoice,
  totals,
  // Money and dates are exported because the PDF renderer, the routes and the
  // tests must format a figure exactly as the document does.
  toCents,
  centsToString,
  money,
  estimatedTotalCents,
  australianDate,
  asDate,
  MAX_SUPPORTS,
  MAX_CUSTOM_CLAUSES,
};
