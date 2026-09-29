'use strict';

/**
 * MONEY — decimal-safe arithmetic for invoicing.
 *
 * Every monetary value inside the billing engine is an integer number of
 * cents; every quantity is an integer number of ten-thousandths (4 dp). No
 * float is ever accumulated. Rounding is half-up (away from zero), applied
 * once, at the point a value becomes an invoice figure.
 *
 * Strings/numbers from the database (NUMERIC arrives as a string from `pg`)
 * are parsed without going through binary floating point.
 */

const QTY_SCALE = 10000n; // quantities carry 4 decimal places

/** Parse "193.99" | 193.99 | "-5" into integer cents (half-up beyond 2 dp). */
function toCents(value) {
  if (value == null || value === '') return null;
  const s = String(typeof value === 'number' ? value.toFixed(6) : value).trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a monetary value: ${value}`);
  const neg = !!m[1];
  const whole = BigInt(m[2] || '0');
  const frac = (m[3] || '').padEnd(3, '0');
  let cents = whole * 100n + BigInt(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1n; // half-up on the third decimal
  return Number(neg ? -cents : cents);
}

/** Integer cents → "193.99" (always two decimals, for NUMERIC columns). */
function fromCents(cents) {
  if (cents == null) return null;
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** Parse a quantity into integer ten-thousandths ("0.4111" → 4111). */
function toQtyE4(value) {
  const s = String(typeof value === 'number' ? value.toFixed(8) : value).trim();
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m) throw new Error(`Not a quantity: ${value}`);
  const frac = (m[3] || '').padEnd(5, '0');
  let q = BigInt(m[2] || '0') * QTY_SCALE + BigInt(frac.slice(0, 4));
  if (Number(frac[4]) >= 5) q += 1n;
  return Number(m[1] ? -q : q);
}

function qtyToString(qtyE4) {
  const abs = Math.abs(qtyE4);
  const s = `${Math.floor(abs / 10000)}.${String(abs % 10000).padStart(4, '0')}`;
  return qtyE4 < 0 ? `-${s}` : s;
}

/** Half-up integer division on BigInts (numerator may be negative). */
function divRound(num, den) {
  const n = BigInt(num), d = BigInt(den);
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

/**
 * A rational number of minutes {num, den} → hours as a 4-dp quantity.
 * 74 min shared by 3 → {num:74, den:3} → 0.4111 h.
 */
function minutesToHoursQty(num, den = 1) {
  return Number(divRound(BigInt(num) * QTY_SCALE, BigInt(den) * 60n));
}

/** Round a rational to `dp` decimals and return a Number (for display/storage). */
function rationalToFixed(num, den, dp = 2) {
  const scale = 10n ** BigInt(dp);
  const v = divRound(BigInt(num) * scale, BigInt(den));
  return Number(v) / Number(scale);
}

/** amount (cents) = quantity × unit price, rounded half-up to the cent. */
function lineAmount(qtyE4, unitCents) {
  return Number(divRound(BigInt(qtyE4) * BigInt(unitCents), QTY_SCALE));
}

/** rational quantity × cents (e.g. km {num,den} × 99c) → cents, half-up. */
function rationalTimesCents(num, den, unitCents) {
  return Number(divRound(BigInt(num) * BigInt(unitCents), BigInt(den)));
}

function sumCents(values) {
  return values.reduce((a, v) => a + (v || 0), 0);
}

/**
 * Split `totalCents` into parts proportional to integer `weights` so the parts
 * sum EXACTLY to the total (largest-remainder method; ties go to the earlier
 * key so the result is deterministic). Never over-allocates.
 */
function allocateCents(totalCents, weights) {
  const W = weights.reduce((a, w) => a + BigInt(w), 0n);
  if (W <= 0n || totalCents <= 0) return weights.map(() => 0);
  const T = BigInt(totalCents);
  const base = weights.map(w => (T * BigInt(w)) / W);
  const rem = weights.map((w, i) => ({ i, r: (T * BigInt(w)) % W }));
  let left = T - base.reduce((a, b) => a + b, 0n);
  rem.sort((a, b) => (b.r === a.r ? a.i - b.i : (b.r > a.r ? 1 : -1)));
  for (let k = 0; left > 0n; k++, left--) base[rem[k % rem.length].i] += 1n;
  return base.map(Number);
}

function formatAud(cents) {
  const s = fromCents(cents);
  const [w, f] = s.replace('-', '').split('.');
  return `${cents < 0 ? '-' : ''}$${w.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${f}`;
}

module.exports = {
  QTY_SCALE, toCents, fromCents, toQtyE4, qtyToString, divRound,
  minutesToHoursQty, rationalToFixed, lineAmount, rationalTimesCents,
  sumCents, allocateCents, formatAud,
};
