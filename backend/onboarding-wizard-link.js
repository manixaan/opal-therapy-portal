'use strict';

/**
 * onboarding-wizard-link.js — what the first-login profile wizard writes,
 * in the shapes the portal actually reads.
 *
 * The wizard (frontend/current/onboarding.html) used to save its Work
 * location step as `{ formattedAddress, lat, lng }` and its Travel bases step
 * as an ARRAY, both into users.default_work_location — the second overwriting
 * the first. The portal's Work Locations page reads that column as WORK_BASES
 * (`{ office, homes: [{ id, label, kind, addr, suburb, region, … }] }`) and
 * the week-keyed users.work_location_schedule, so a new starter saw "Not set"
 * every day and an empty Home address however carefully they filled the
 * wizard in.
 *
 * Everything here is pure: the route reads the row, calls these, writes the
 * result. Merges never drop what the person already has — an office entry,
 * other homes, or a day they set themselves.
 */

/* Same rules as the shell (mockup_v3.html WORK_BASES / addHomeBase and
   travel.js addrSuburb / suburbRegion). Kept in step by hand: the shell has
   no module system to share them through. */
const HOME_COLOR = '#9a5f0e';
const WL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const WEEK_KEY_RE = /^\d{4}-W\d{2}$/;
const MAX_WEEK_KEYS = 8;
const MAX_EXTRA_BASES = 20;

/** Best-effort suburb from an address — a copy of travel.js addrSuburb. */
function addrSuburb(addr) {
  if (!addr) return '';
  const a = String(addr).trim().replace(/,\s*(Australia|AU)\s*$/i, '').trim();
  if (!/,/.test(a) && a.split(/\s+/).length <= 3) return a.replace(/\s+(WA|Western Australia)\s*\d{0,4}$/i, '').trim();
  const m = a.match(/,\s*([A-Za-z' ]+?)\s+(?:WA|Western Australia)?\s*\d{0,4}\s*$/i);
  return m ? m[1].trim() : a.split(',').pop().replace(/\bWA\b.*$/i, '').replace(/\d{4}\s*$/, '').trim();
}

/** A copy of travel.js suburbRegion. */
const SUBURB_REGION = {
  'Willetton':'central','Riverton':'south','Parkwood':'central','Leeming':'central',
  'Bateman':'central','Rossmoyne':'central','Shelley':'central','Bull Creek':'central','Canning Vale':'central',
  'Thornlie':'east','Gosnells':'east','Maddington':'east','Kelmscott':'east','Armadale':'east',
  'Atwell':'south','Success':'south','Cockburn':'south','Jandakot':'south',
  'Melville':'west','Applecross':'west','Palmyra':'west','Bicton':'west',
  'Perth':'central','Victoria Park':'central',
};
function suburbRegion(suburb) { return SUBURB_REGION[suburb] || 'central'; }

function cleanText(v, max = 300) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function coord(v, lim) {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= lim ? n : undefined;
}

function homeFrom({ id, label, addr, lat, lng, placeId }) {
  const a = cleanText(addr);
  const suburb = addrSuburb(a);
  const h = {
    id, label: cleanText(label, 80) || 'Home', kind: 'local',
    addr: a, suburb, region: suburbRegion(suburb), icon: '', color: HOME_COLOR,
  };
  const la = coord(lat, 90), ln = coord(lng, 180);
  if (la !== undefined && ln !== undefined) { h.lat = la; h.lng = ln; }
  const pid = cleanText(placeId, 300);
  if (pid) h.placeId = pid;
  return h;
}

/**
 * Whatever is stored, as WORK_BASES. Also reads the two shapes the old wizard
 * wrote, so an account that went through it keeps what survived:
 *   · `{ formattedAddress, lat, lng }`  → home-1
 *   · `[{ name, address, lat, lng }]`   → home-1, home-2, …
 * Returns null for "nothing stored" so callers can tell the two apart.
 */
function toWorkBases(stored) {
  if (!stored || typeof stored !== 'object') return null;
  if (Array.isArray(stored.homes)) {
    return JSON.parse(JSON.stringify(stored));
  }
  if (Array.isArray(stored)) {
    // The old Travel bases step: these were EXTRA bases (it had just
    // overwritten the home address), so they follow an empty Home.
    const homes = [homeFrom({ id: 'home-1', label: 'Home', addr: '' })];
    stored
      .filter((b) => b && typeof b === 'object' && cleanText(b.address || b.addr))
      .forEach((b, i) => homes.push(homeFrom({
        id: `home-${i + 2}`, label: b.name || `Home ${i + 2}`,
        addr: b.address || b.addr, lat: b.lat, lng: b.lng, placeId: b.placeId,
      })));
    return { homes };
  }
  if (typeof stored.formattedAddress === 'string') {
    if (!cleanText(stored.formattedAddress)) return { homes: [] };
    return { homes: [homeFrom({ id: 'home-1', label: 'Home', addr: stored.formattedAddress,
      lat: stored.lat, lng: stored.lng, placeId: stored.placeId })] };
  }
  return null;
}

/** Step 4: the address becomes home-1. Office and other homes are kept. */
function setPrimaryHome(stored, { address, lat, lng, placeId } = {}) {
  const bases = toWorkBases(stored) || { homes: [] };
  const addr = cleanText(address);
  if (!addr) return bases;
  const idx = bases.homes.findIndex((h) => h && h.id === 'home-1');
  const prev = idx >= 0 ? bases.homes[idx] : null;
  const next = homeFrom({ id: 'home-1', label: (prev && prev.label) || 'Home', addr, lat, lng, placeId });
  const merged = Object.assign({}, prev || {}, next);
  // A typed (unpicked) address must not keep the old pin.
  if (next.lat === undefined) { delete merged.lat; delete merged.lng; }
  if (!next.placeId) delete merged.placeId;
  if (idx >= 0) bases.homes[idx] = merged;
  else bases.homes.unshift(merged);
  return bases;
}

/**
 * Step 5: extra bases are APPENDED as more homes. A base whose address is
 * already a home is not added twice — re-posting the step (back/next,
 * refresh) is a no-op.
 */
function appendExtraBases(stored, list, idFor = defaultIdFor) {
  const bases = toWorkBases(stored) || { homes: [] };
  if (!Array.isArray(list)) return bases;
  const norm = (s) => cleanText(s).toLowerCase().replace(/\s+/g, ' ');
  const seen = new Set(bases.homes.map((h) => norm(h && h.addr)).filter(Boolean));
  const taken = new Set(bases.homes.map((h) => h && h.id));
  let added = 0;
  for (const b of list) {
    if (added >= MAX_EXTRA_BASES) break;
    if (!b || typeof b !== 'object') continue;
    const addr = cleanText(b.address || b.addr);
    if (!addr || seen.has(norm(addr))) continue;
    let id = idFor(bases.homes.length);
    while (taken.has(id)) id = id + 'x';
    taken.add(id); seen.add(norm(addr));
    bases.homes.push(homeFrom({
      id, label: cleanText(b.name, 80) || `Home ${bases.homes.length + 1}`,
      addr, lat: b.lat, lng: b.lng, placeId: b.placeId,
    }));
    added += 1;
  }
  return bases;
}

/** Same id scheme as the shell's addHomeBase ('home-' + base-36 time). */
function defaultIdFor(n) {
  return 'home-' + Date.now().toString(36) + n.toString(36);
}

/**
 * Fill Mon–Fri of the given weeks with `baseId`, only where the day is not
 * already set. Week keys are computed by the browser with the shell's own
 * weekKeyFor (browser-local, not ISO); anything not shaped like one is
 * ignored rather than trusted.
 */
function fillScheduleDefaults(stored, weekKeys, baseId = 'home-1') {
  const schedule = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? JSON.parse(JSON.stringify(stored)) : {};
  if (!Array.isArray(weekKeys)) return schedule;
  const keys = [...new Set(weekKeys.filter((k) => typeof k === 'string' && WEEK_KEY_RE.test(k)))]
    .slice(0, MAX_WEEK_KEYS);
  for (const k of keys) {
    const week = schedule[k] && typeof schedule[k] === 'object' && !Array.isArray(schedule[k]) ? schedule[k] : {};
    for (const d of WL_DAYS) if (!week[d]) week[d] = baseId;
    schedule[k] = week;
  }
  return schedule;
}

/** True when a base anchors travel: some home or the office has an address. */
function hasUsableBase(stored) {
  const b = toWorkBases(stored);
  if (!b) return false;
  if (b.office && cleanText(b.office.addr)) return true;
  return (b.homes || []).some((h) => h && h.kind !== 'remote' && cleanText(h.addr));
}

module.exports = {
  addrSuburb, suburbRegion, toWorkBases, setPrimaryHome, appendExtraBases,
  fillScheduleDefaults, hasUsableBase, WEEK_KEY_RE, WL_DAYS,
};
