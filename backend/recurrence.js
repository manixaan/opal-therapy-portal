'use strict';

/**
 * RECURRENCE — Outlook's "Repeat every" rules, expanded to dates. Pure.
 *
 * A rule is what the Smart Booking panel's Repeat section sends:
 *   { freq: 'day' | 'week' | 'month' | 'year',
 *     interval: 1–99,                       // "Repeat every N"
 *     days: ['mon', …],                     // week: the weekday circles
 *     monthly: 'date' | 'weekday',          // month: "On day 12" | "On the second Monday"
 *     end: { type: 'date', until: 'YYYY-MM-DD' } | { type: 'count', count: N } }
 *
 * The first appointment is the anchor and stays where it is booked; the
 * repeats are the rule's dates after it. Like Outlook, a monthly "day 31"
 * lands on the last day of a shorter month, and "the fifth Monday" is
 * "the last Monday".
 *
 * A series is capped at 12 months after the anchor or 52 appointments,
 * whichever comes first (11 Oct 2026); `capped` says when the cap cut it.
 * Dates are Perth calendar dates (WA has no daylight saving), so a repeat
 * keeps the anchor's clock time.
 */

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MAX_APPOINTMENTS = 52;  // including the anchor
const MAX_MONTHS = 12;
const ORDINALS = ['first', 'second', 'third', 'fourth', 'last'];
const DAY_NAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parseYmd(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? d : null;
}
function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(d, n) { return new Date(d.getTime() + n * 86400000); }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
function addMonthsClamped(anchor, months, dayOfMonth) {
  const y = anchor.getUTCFullYear(), m = anchor.getUTCMonth() + months;
  const yy = y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  return new Date(Date.UTC(yy, mm, Math.min(dayOfMonth, daysInMonth(yy, mm))));
}
/** nth (1–4) or last (5) weekday of a month. */
function nthWeekday(y, m, dow, nth) {
  if (nth >= 5) {
    const last = new Date(Date.UTC(y, m, daysInMonth(y, m)));
    return addDays(last, -((last.getUTCDay() - dow + 7) % 7));
  }
  const first = new Date(Date.UTC(y, m, 1));
  return addDays(first, ((dow - first.getUTCDay() + 7) % 7) + (nth - 1) * 7);
}
function weekdayOrdinal(d) { return Math.min(5, Math.ceil(d.getUTCDate() / 7)); }

/**
 * Validate and normalise a rule against its anchor date. Returns
 * { ok: true, rule } or { ok: false, error }.
 */
function normaliseRule(raw, anchorYmd) {
  const anchor = parseYmd(anchorYmd);
  if (!anchor) return { ok: false, error: 'The first appointment has no valid date' };
  const r = raw && typeof raw === 'object' ? raw : null;
  if (!r) return { ok: false, error: 'A repeat rule is required' };
  if (!['day', 'week', 'month', 'year'].includes(r.freq)) return { ok: false, error: 'Repeat must be daily, weekly, monthly or yearly' };
  const interval = Number(r.interval == null ? 1 : r.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return { ok: false, error: 'Repeat every must be 1–99' };
  const out = { freq: r.freq, interval };
  if (r.freq === 'week') {
    const days = Array.isArray(r.days) ? [...new Set(r.days.map(String).filter(d => DAY_KEYS.includes(d)))] : [];
    out.days = days.length ? DAY_KEYS.filter(d => days.includes(d)) : [DAY_KEYS[anchor.getUTCDay()]];
  }
  if (r.freq === 'month') out.monthly = r.monthly === 'weekday' ? 'weekday' : 'date';
  const end = r.end && typeof r.end === 'object' ? r.end : null;
  if (!end) return { ok: false, error: 'Choose when the series ends' };
  if (end.type === 'date') {
    const until = parseYmd(end.until);
    if (!until) return { ok: false, error: 'The end date is not a valid date' };
    if (until < anchor) return { ok: false, error: 'The end date is before the first appointment' };
    out.end = { type: 'date', until: ymd(until) };
  } else if (end.type === 'count') {
    const count = Number(end.count);
    if (!Number.isInteger(count) || count < 2) return { ok: false, error: 'A series needs at least 2 appointments' };
    out.end = { type: 'count', count: Math.min(count, MAX_APPOINTMENTS) };
  } else {
    return { ok: false, error: 'Choose when the series ends' };
  }
  return { ok: true, rule: out };
}

/**
 * The dates of a series (anchor first). Returns
 * { dates: ['YYYY-MM-DD', …], capped: boolean } — dates[0] is the anchor.
 */
function expand(rule, anchorYmd) {
  const anchor = parseYmd(anchorYmd);
  const limitDate = addMonthsClamped(anchor, MAX_MONTHS, anchor.getUTCDate());
  const until = rule.end.type === 'date' ? parseYmd(rule.end.until) : null;
  const wanted = rule.end.type === 'count' ? rule.end.count : MAX_APPOINTMENTS;
  const lastAllowed = until && until < limitDate ? until : limitDate;
  const dates = [ymd(anchor)];
  let capped = false;
  // false = stop. capped = the 12-month / 52-appointment cap ended it, not the rule.
  const take = (d) => {
    if (d <= anchor) return true;               // the anchor is already first
    if (dates.length >= wanted) { if (rule.end.type === 'date') capped = true; return false; }
    if (d > lastAllowed) { if (!until || until > limitDate) capped = true; return false; }
    dates.push(ymd(d));
    return true;
  };

  if (rule.freq === 'day') {
    for (let k = 1; ; k++) if (!take(addDays(anchor, k * rule.interval))) break;
  } else if (rule.freq === 'week') {
    const monday = addDays(anchor, -((anchor.getUTCDay() + 6) % 7));
    const offsets = rule.days.map(d => (DAY_KEYS.indexOf(d) + 6) % 7).sort((a, b) => a - b);
    outer: for (let w = 0; ; w += rule.interval) {
      for (const off of offsets) {
        if (!take(addDays(monday, w * 7 + off))) break outer;
      }
    }
  } else if (rule.freq === 'month') {
    const dom = anchor.getUTCDate(), dow = anchor.getUTCDay(), nth = weekdayOrdinal(anchor);
    for (let k = 1; ; k++) {
      const months = k * rule.interval;
      const d = rule.monthly === 'weekday'
        ? (() => { const base = addMonthsClamped(anchor, months, 1); return nthWeekday(base.getUTCFullYear(), base.getUTCMonth(), dow, nth); })()
        : addMonthsClamped(anchor, months, dom);
      if (!take(d)) break;
    }
  } else {
    for (let k = 1; ; k++) if (!take(addMonthsClamped(anchor, 12 * k * rule.interval, anchor.getUTCDate()))) break;
  }
  return { dates, capped };
}

function fmtDate(ymdStr) {
  const d = parseYmd(ymdStr);
  return d ? `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` : ymdStr;
}

/** Outlook-style sentence: "Occurs every 2 weeks on Monday until 11 Dec 2026". */
function describe(rule, anchorYmd) {
  const anchor = parseYmd(anchorYmd);
  const every = (unit) => rule.interval === 1 ? `every ${unit}` : `every ${rule.interval} ${unit}s`;
  let what;
  if (rule.freq === 'day') what = every('day');
  else if (rule.freq === 'week') {
    const names = rule.days.map(d => DAY_NAMES[d]);
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1] : names[0];
    what = (rule.interval === 2 ? 'every 2 weeks (fortnightly)' : every('week')) + ' on ' + list;
  } else if (rule.freq === 'month') {
    what = every('month') + (rule.monthly === 'weekday'
      ? ` on the ${ORDINALS[weekdayOrdinal(anchor) - 1]} ${DAY_NAMES[DAY_KEYS[anchor.getUTCDay()]]}`
      : ` on day ${anchor.getUTCDate()}`);
  } else what = every('year') + ` on ${anchor.getUTCDate()} ${MONTHS[anchor.getUTCMonth()]}`;
  const end = rule.end.type === 'date' ? ` until ${fmtDate(rule.end.until)}` : ` for ${rule.end.count} appointments`;
  return 'Occurs ' + what + end;
}

module.exports = { MAX_APPOINTMENTS, MAX_MONTHS, DAY_KEYS, normaliseRule, expand, describe, fmtDate, parseYmd };
