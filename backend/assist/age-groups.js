'use strict';

/**
 * AGE GROUPS — what the model is told in place of a birth date.
 *
 * A birth date identifies a person; "a child of five to ten" does not, and it
 * is what the clinical reasoning actually needs. Bands follow the life stages
 * an NDIS occupational therapist plans around.
 */
const { parseDate } = require('../ai/deidentify');

const BANDS = [
  [0, 4, 'early childhood, 0–4 years'], [5, 10, 'child, 5–10 years'], [11, 14, 'early adolescent, 11–14 years'],
  [15, 17, 'adolescent, 15–17 years'], [18, 24, 'young adult, 18–24 years'], [25, 44, 'adult, 25–44 years'],
  [45, 64, 'adult, 45–64 years'], [65, 200, 'older adult, 65 years and over'],
];

/** @returns the band label for a written birth date, or null when it cannot be read. */
function ageGroupOf(written, today = new Date()) {
  const p = parseDate(written);
  if (!p || p.y === null) return null;
  let y = p.y;
  if (y < 100) y += (2000 + y > today.getFullYear()) ? 1900 : 2000;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < p.m || (today.getMonth() + 1 === p.m && today.getDate() < p.d)) age--;
  if (age < 0 || age > 120) return null;
  const band = BANDS.find(([lo, hi]) => age >= lo && age <= hi);
  return band ? band[2] : null;
}

/** @returns the band label for an age in years (fractions allowed for months). */
function ageGroupOfYears(years) {
  if (!Number.isFinite(years) || years < 0 || years > 120) return null;
  const band = BANDS.find(([lo, hi]) => Math.floor(years) >= lo && Math.floor(years) <= hi);
  return band ? band[2] : null;
}

module.exports = { ageGroupOf, ageGroupOfYears, BANDS };
