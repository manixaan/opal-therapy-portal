'use strict';

/**
 * RATE CARD SERVICE — versioned, effective-dated prices.
 *
 * `resolveRule` is pure: given the organisation's cards, a service date, an
 * MMM zone and a discipline it returns the one rule that applies, or null.
 * Selection: ACTIVE cards of that discipline whose [effective_from,
 * effective_to] contains the date; the latest effective_from wins, then the
 * highest version. Deterministic, so a re-run prices a date identically.
 *
 * A card that has priced a finalised invoice line is frozen — editing it
 * returns RATE_CARD_IN_USE and the owner creates a new version instead. Lines
 * also snapshot every rate they used, so history never depends on this table.
 */

const M = require('./money');
const { DEFAULT_RATE_CARD } = require('./default-rate-card');

function ruleFromRow(r) {
  return {
    id: r.id,
    mmmMin: Number(r.mmm_min),
    mmmMax: Number(r.mmm_max),
    zoneLabel: r.zone_label,
    sessionHourlyRate: String(r.session_hourly_rate),
    travelHourlyRate: String(r.travel_hourly_rate),
    travelCapMinutesEachWay: r.travel_cap_minutes_each_way == null ? null : Number(r.travel_cap_minutes_each_way),
    vehicleRatePerKm: String(r.vehicle_rate_per_km),
    sessionItemCode: r.session_item_code,
    travelItemCode: r.travel_item_code,
    vehicleItemCode: r.vehicle_item_code,
    tripCostItemCode: r.trip_cost_item_code,
  };
}

function isoDate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  const x = new Date(d);
  return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`;
}

/**
 * @param {Array} cards  [{id, discipline, version, effectiveFrom, effectiveTo, status, rules:[...]}]
 * @returns {null | {card, rule, sessionRateCents, travelRateCents, vehicleRateCents, travelCapMinutesEachWay}}
 */
function resolveRule(cards, { serviceDate, mmm, discipline = 'OT' }) {
  const d = isoDate(serviceDate);
  const zone = Number(mmm);
  if (!d || !(zone >= 1 && zone <= 7)) return null;
  const candidates = cards
    .filter(c => c.status === 'ACTIVE' && c.discipline === discipline)
    .filter(c => isoDate(c.effectiveFrom) <= d && (!c.effectiveTo || isoDate(c.effectiveTo) >= d))
    .sort((a, b) => (isoDate(b.effectiveFrom).localeCompare(isoDate(a.effectiveFrom))) || (b.version - a.version));
  for (const card of candidates) {
    const rule = card.rules.find(r => zone >= r.mmmMin && zone <= r.mmmMax);
    if (rule) {
      return {
        card: { id: card.id, name: card.name, version: card.version, effectiveFrom: isoDate(card.effectiveFrom) },
        rule,
        sessionRateCents: M.toCents(rule.sessionHourlyRate),
        travelRateCents: M.toCents(rule.travelHourlyRate),
        vehicleRateCents: M.toCents(rule.vehicleRatePerKm),
        travelCapMinutesEachWay: rule.travelCapMinutesEachWay,
      };
    }
    return null; // the governing card has no rule for this zone — do not fall back to an older card
  }
  return null;
}

// ── DB ─────────────────────────────────────────────────────────────────────

async function loadRateCards(q, orgId) {
  const cards = (await q.query(
    `SELECT * FROM billing_rate_cards WHERE organisation_id = $1 ORDER BY discipline, version DESC`, [orgId])).rows;
  if (!cards.length) return [];
  const rules = (await q.query(
    `SELECT * FROM billing_rate_rules WHERE rate_card_id = ANY($1::uuid[]) ORDER BY mmm_min`, [cards.map(c => c.id)])).rows;
  const used = (await q.query(
    `SELECT DISTINCT l.rate_card_id FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.rate_card_id = ANY($1::uuid[]) AND i.status NOT IN ('DRAFT','NEEDS_ATTENTION')`,
    [cards.map(c => c.id)])).rows.map(r => r.rate_card_id);
  return cards.map(c => ({
    id: c.id,
    discipline: c.discipline,
    name: c.name,
    version: Number(c.version),
    effectiveFrom: isoDate(c.effective_from),
    effectiveTo: c.effective_to ? isoDate(c.effective_to) : null,
    status: c.status,
    notes: c.notes,
    locked: used.includes(c.id),
    createdAt: c.created_at,
    rules: rules.filter(r => r.rate_card_id === c.id).map(ruleFromRow),
  }));
}

function validateCardInput(input) {
  const errors = [];
  if (!input || typeof input !== 'object') return ['Rate card is required'];
  if (!input.name || String(input.name).trim().length < 2) errors.push('name is required');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveFrom || ''))) errors.push('effectiveFrom must be YYYY-MM-DD');
  if (input.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(String(input.effectiveTo))) errors.push('effectiveTo must be YYYY-MM-DD');
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) errors.push('effectiveTo is before effectiveFrom');
  if (input.status && !['DRAFT', 'ACTIVE', 'RETIRED'].includes(input.status)) errors.push('status is invalid');
  const rules = Array.isArray(input.rules) ? input.rules : [];
  if (!rules.length) errors.push('at least one zone rule is required');
  const covered = new Array(8).fill(0);
  for (const [i, r] of rules.entries()) {
    const lo = Number(r.mmmMin), hi = Number(r.mmmMax);
    if (!(lo >= 1 && hi <= 7 && lo <= hi)) { errors.push(`rule ${i + 1}: MMM range invalid`); continue; }
    for (let z = lo; z <= hi; z++) covered[z]++;
    for (const k of ['sessionHourlyRate', 'travelHourlyRate', 'vehicleRatePerKm']) {
      let c = null;
      try { c = M.toCents(r[k]); } catch (_) { c = null; }
      if (c == null || c < 0) errors.push(`rule ${i + 1}: ${k} must be a non-negative amount`);
    }
    if (r.travelCapMinutesEachWay != null && r.travelCapMinutesEachWay !== ''
        && !(Number.isInteger(Number(r.travelCapMinutesEachWay)) && Number(r.travelCapMinutesEachWay) >= 0)) {
      errors.push(`rule ${i + 1}: travel cap must be whole minutes or blank for none`);
    }
  }
  if (covered.slice(1).some(n => n > 1)) errors.push('MMM zones overlap between rules');
  return errors;
}

async function insertRules(q, cardId, rules) {
  for (const r of rules) {
    await q.query(
      `INSERT INTO billing_rate_rules (rate_card_id, mmm_min, mmm_max, zone_label, session_hourly_rate,
         travel_hourly_rate, travel_cap_minutes_each_way, vehicle_rate_per_km, session_item_code,
         travel_item_code, vehicle_item_code, trip_cost_item_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [cardId, r.mmmMin, r.mmmMax, r.zoneLabel || null, M.fromCents(M.toCents(r.sessionHourlyRate)),
        M.fromCents(M.toCents(r.travelHourlyRate)),
        r.travelCapMinutesEachWay === '' || r.travelCapMinutesEachWay == null ? null : Number(r.travelCapMinutesEachWay),
        M.fromCents(M.toCents(r.vehicleRatePerKm)), r.sessionItemCode || null, r.travelItemCode || null,
        r.vehicleItemCode || null, r.tripCostItemCode || null]);
  }
}

/** Creates the next version of a discipline's card. */
async function createRateCard(q, orgId, userId, input) {
  const discipline = String(input.discipline || 'OT').toUpperCase().slice(0, 40);
  const { rows: [{ v }] } = await q.query(
    `SELECT COALESCE(MAX(version), 0) + 1 AS v FROM billing_rate_cards WHERE organisation_id = $1 AND discipline = $2`,
    [orgId, discipline]);
  const { rows: [card] } = await q.query(
    `INSERT INTO billing_rate_cards (organisation_id, discipline, name, version, effective_from, effective_to, status, notes, created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, version`,
    [orgId, discipline, String(input.name).trim().slice(0, 160), v, input.effectiveFrom, input.effectiveTo || null,
      input.status || 'ACTIVE', input.notes || null, userId || null]);
  await insertRules(q, card.id, input.rules);
  return card;
}

/** Replaces a card's fields/rules — refused once any finalised line used it. */
async function updateRateCard(q, orgId, cardId, input) {
  const { rows: [card] } = await q.query(
    `SELECT id FROM billing_rate_cards WHERE id = $1 AND organisation_id = $2`, [cardId, orgId]);
  if (!card) return { error: 'NOT_FOUND' };
  const { rows: [{ n }] } = await q.query(
    `SELECT COUNT(*)::int AS n FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
      WHERE l.rate_card_id = $1 AND i.status NOT IN ('DRAFT','NEEDS_ATTENTION')`, [cardId]);
  if (n > 0 && (input.rules || input.effectiveFrom)) return { error: 'RATE_CARD_IN_USE' };
  await q.query(
    `UPDATE billing_rate_cards SET name = COALESCE($3, name), effective_from = COALESCE($4, effective_from),
            effective_to = $5, status = COALESCE($6, status), notes = COALESCE($7, notes), updated_at = NOW()
      WHERE id = $1 AND organisation_id = $2`,
    [cardId, orgId, input.name || null, input.effectiveFrom || null, input.effectiveTo || null, input.status || null, input.notes ?? null]);
  if (Array.isArray(input.rules)) {
    await q.query(`DELETE FROM billing_rate_rules WHERE rate_card_id = $1`, [cardId]);
    await insertRules(q, cardId, input.rules);
  }
  return { ok: true };
}

async function ensureDefaultRateCard(q, orgId) {
  const { rows } = await q.query(`SELECT 1 FROM billing_rate_cards WHERE organisation_id = $1 LIMIT 1`, [orgId]);
  if (rows.length) return false;
  await createRateCard(q, orgId, null, { ...DEFAULT_RATE_CARD, status: 'ACTIVE' });
  return true;
}

module.exports = {
  resolveRule, ruleFromRow, isoDate, validateCardInput,
  loadRateCards, createRateCard, updateRateCard, ensureDefaultRateCard,
};
