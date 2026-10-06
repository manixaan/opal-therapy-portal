/* ═══════════════════════════════════════════════════════════════════════════
   TRAVEL — portal module

   Lifted out of mockup_v3.html unchanged (2026-08-23). This is the travel
   domain: the routing engine that turns two addresses into minutes, the
   segment store every consumer reads instead of re-walking the day, the
   calendar overlay renderer, and the travel details panel behind a leg.

   WHAT IS HERE
     Routing engine  ROUTE_CACHE / ROUTE_INFLIGHT / PLACES_CACHE, canonAddr,
                     routeKey, isFresh, fetchRoute (Google Routes via the
                     backend proxy), the SUBURB_TRAVEL_FALLBACK matrix and
                     estimateTravelMinFromTable, the travelDurationMinSync /
                     travelMinutes sync facade, invalidateRouteCacheFor,
                     fetchPlacesNear, suburbRegion and the mapsLink /
                     mapsSearchLink deep-link helpers
     Session→place   sessionsForDay, sploseLocationForSession, sessionLocation,
                     stripSuburb, addrSuburb, locTravelKey, dayAnchorBase
     Segment store   DAY_SEGMENTS, isTravelBlock and computeDayTravelSegments —
                     the one place the day is walked into start/between/end
                     travel legs and gap windows
     Overlays        clearDayOverlays / refreshDayOverlays / renderSegmentOverlay
                     / renderTravelOverlay / refreshAllOverlays / previewAllTravel
     Details panel   TASK #118 — openTravelPanel / closeTravelPanel /
                     _renderTravelPanel / _tpFmtTime, _travelPanelOpen and the
                     Escape handler

   NOT A MODULE PATTERN, DELIBERATELY
   No IIFE and no namespace object, and not strict-mode — the same reasoning as
   profile.js and reports.js. Every name below is reached by bare identifier
   from the shell's inline script, from an onclick= attribute in its markup, or
   from another module, so all of it stays global exactly as it was. Nothing is
   renamed and nothing is wrapped.

   LOAD ORDER
   Loaded with defer, ahead of profile.js and reports.js, so it executes after
   every inline <script> in the shell has parsed and before the two modules that
   depend on it. It reaches the shell's globals at call time: SESSIONS,
   sessionStartMin()/sessionEndMin(), WORK_S/WORK_E, HOUR_PX, tToY(),
   HOME_BASED_TYPES, WORK_BASES/getBase(), wlThisWeek(), regionDistance(),
   PLACES_NEAR, showToast() and switchTab().

   WHAT reports.js CONSUMES
   computeDayTravelSegments() for the daily travel total, its legs and the idle
   gaps, and mapsLink() for the report's directions link. Both are plain function
   declarations here, so they are window properties by the time reports.js runs,
   and reports.js already calls them behind `typeof … === 'function'` guards.

   WHAT STAYED IN THE SHELL
   Three things, on purpose. WORK_BASES and its editors (setOfficeBase,
   addHomeBase, renderHomeBases, getBase …) are read at parse time by the shell's
   own rebuildLocationCatalogue() and seedWorkLocations() and by profile.js, so
   they are work-location state that travel borrows rather than travel state.
   The idle-gap recommender (PLACES_NEAR, placesForContext, the venue scorer)
   is a neighbouring domain that calls in here. And the #travel-panel markup and
   every .travel-overlay / .tp-* style rule stay put: moving markup needs a
   templating step this repository does not have, and moving the CSS would change
   cascade order for no gain.

   THE ONE PARSE-TIME CALL
   The shell used to finish its work-location section with a top-level
   `refreshAllOverlays()` — the first paint of the travel legs, once SESSIONS is
   populated. A deferred file cannot be called from parse-time code, so that call
   moved to the foot of this file. It still runs before DOMContentLoaded, still
   after SESSIONS is built, and nothing between the old call site and the end of
   the document reads .travel-overlay: applyUserSettings() does, but at boot it
   is reached only through _applySettingsAtBoot(), which finds APP_SETTINGS empty
   and returns without touching anything.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ---------- Dynamic travel module — Google Routes API + local cache ---------- */
/* Architecture:
   1. travelMinutes(fromSuburb, toSuburb)  — public, SYNCHRONOUS sync facade.
      Every consumer (overlay renderer, impact evaluator, gap-option scorer)
      calls this and gets a usable number back immediately.
   2. travelDurationMinSync(from, to, mode) — looks up ROUTE_CACHE. If the
      route is cached returns its `durationMin`. If not, it (a) returns a
      sensible fallback (suburb table → region distance) AND (b) fires off
      an async fetchRoute() that warms the cache so the NEXT render is real.
   3. fetchRoute(origin, destination, mode) — wraps Google Routes API
      `directions/v2:computeRoutes` with `TRAFFIC_AWARE` routing preference.
      When no API key is configured (the mockup default) it falls back to
      the suburb table so the UI still renders. The function is also the
      single entry point that writes into ROUTE_CACHE.
   4. ROUTE_CACHE key = `${canonAddr(origin)}|${canonAddr(destination)}|${mode}`.
      Canonicalising here means "Willetton", "Willetton WA", and
      "Willetton 6155" all hit the same cache entry.
   5. Cache entries age out after CACHE_TTL_MS; invalidateRouteCacheFor(base)
      purges any entry involving that address (called from base edits).
*/

// ---- Fallback matrix kept as a fast sync estimate when the cache is cold ----
// Minutes one-way in typical mid-morning Perth metro traffic.
const SUBURB_TRAVEL_FALLBACK = {
  'Willetton-Canning Vale':   8, 'Willetton-Riverton':       7,
  'Willetton-Bateman':       10, 'Willetton-Rossmoyne':      9,
  'Willetton-Parkwood':       6, 'Willetton-Leeming':        9,
  'Willetton-Shelley':        8, 'Willetton-Bull Creek':    11,
  'Willetton-Thornlie':      12, 'Willetton-Gosnells':      18,
  'Willetton-Maddington':    17, 'Willetton-Kelmscott':     22,
  'Willetton-Armadale':      26, 'Willetton-Atwell':        20,
  'Willetton-Success':       22, 'Willetton-Cockburn':      18,
  'Willetton-Jandakot':      14, 'Willetton-Melville':      15,
  'Willetton-Applecross':    18, 'Willetton-Palmyra':       22,
  'Willetton-Bicton':        20, 'Willetton-Perth':         22,
  'Willetton-Victoria Park': 16, 'Thornlie-Canning Vale':    8,
  'Gosnells-Thornlie':       10, 'Canning Vale-Atwell':     14,
  'Applecross-Melville':      6, 'Rossmoyne-Riverton':       4
};

// ---- Runtime caches ----
const ROUTE_CACHE  = new Map(); // key → { durationMin, distanceMeters, fetchedAt, source }
const PLACES_CACHE = new Map(); // key → { fetchedAt, places:[{ name, type, suburb, rating, reviews, lat, lng, placeId }] }
const ROUTE_INFLIGHT = new Map(); // dedupe concurrent fetches per key
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — route conditions change throughout the day

// API key removed from frontend — Maps calls are proxied through /api/maps/*.
// This variable is kept as a feature-flag: truthy = live API, falsy = fallback estimates.
// The backend proxy injects the real key server-side.
let GOOGLE_MAPS_API_KEY = true; // presence flag only — key is never in browser code

/* Canonicalise any address-like input so "Willetton", "Willetton WA",
   and "100 Burrendah Blvd, Willetton WA 6155" collapse into a stable
   lower-case cache key. */
function canonAddr(input) {
  if (input == null) return '';
  return String(input)
    .toLowerCase()
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/\b(wa|western australia|australia)\b/g, '')
    .replace(/\s*\d{4}\b/g, '')        // strip postcodes
    .replace(/[^\w ,\-]/g, '')
    .trim();
}

function routeKey(origin, destination, mode) {
  return `${canonAddr(origin)}|${canonAddr(destination)}|${mode || 'driving'}`;
}

function isFresh(entry) {
  return entry && (Date.now() - entry.fetchedAt) < CACHE_TTL_MS;
}

/* Async route fetch. Writes into ROUTE_CACHE. Dedupes in-flight requests.
   Falls back gracefully to the suburb table when no API key is configured.
   opts (Smart Booking, 2 Oct 2026):
     departureTime  ISO string — routes the leg at the time it will be driven.
                    Cached under its own 15-minute bucket, and the answer also
                    warms the plain key so the calendar's legs show the same
                    number instead of an estimate.
     fresh          true — ignore a cached ESTIMATE (a Retry after a failure).
   result.source is 'routes-api' for a real answer and 'estimate' when the
   Routes call failed: Smart Booking treats an estimate as "not calculated". */
function _departureBucket(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return String(Math.floor(t / (15 * 60 * 1000)));
}
async function fetchRoute(origin, destination, mode, opts) {
  const o = opts || {};
  const bucket = _departureBucket(o.departureTime);
  const plainKey = routeKey(origin, destination, mode);
  const key = bucket ? plainKey + '|t' + bucket : plainKey;
  const cached = ROUTE_CACHE.get(key);
  if (isFresh(cached) && !(o.fresh && cached.source !== 'routes-api')) return cached;
  if (o.fresh && cached && cached.source !== 'routes-api') ROUTE_CACHE.delete(key);
  if (ROUTE_INFLIGHT.has(key)) return ROUTE_INFLIGHT.get(key);

  const work = (async () => {
    let result;
    if (GOOGLE_MAPS_API_KEY) {
      try {
        const body = { origin, destination, mode: mode || 'driving' };
        if (bucket) body.departureTime = new Date(Date.parse(o.departureTime)).toISOString();
        const resp = await fetch('/api/maps/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(body)
        });
        const json = await resp.json();
        const r0 = json.routes && json.routes[0];
        if (r0 && r0.duration) {
          const seconds = parseInt(String(r0.duration).replace(/s$/, ''), 10) || 0;
          result = { durationMin: Math.round(seconds / 60), distanceMeters: r0.distanceMeters || 0, source: 'routes-api' };
        }
      } catch (e) { /* fall through to estimate */ }
    }
    if (!result) {
      // Synchronous fallback via suburb table → caller still gets something useful.
      // Held for a minute only: a failed or unroutable lookup (a half-typed
      // base address, a network blip) must not pin a leg for 10 minutes.
      const estMin = estimateTravelMinFromTable(origin, destination);
      result = { durationMin: estMin, distanceMeters: estMin * 850, source: 'estimate',
                 fetchedAt: Date.now() - (CACHE_TTL_MS - 60 * 1000) };
      ROUTE_CACHE.set(key, result);
      return result;
    }
    result.fetchedAt = Date.now();
    ROUTE_CACHE.set(key, result);
    if (key !== plainKey) {
      const plain = ROUTE_CACHE.get(plainKey);
      if (!isFresh(plain) || plain.source !== 'routes-api') ROUTE_CACHE.set(plainKey, Object.assign({}, result));
    }
    return result;
  })();

  ROUTE_INFLIGHT.set(key, work);
  try { return await work; } finally { ROUTE_INFLIGHT.delete(key); }
}

/* Pure sync fallback — the suburb-pair table plus region distance.
   Used when ROUTE_CACHE is cold AND (or until) fetchRoute resolves. */
function estimateTravelMinFromTable(fromAddr, toAddr) {
  const f = stripSuburb(addrSuburb(fromAddr));
  const t = stripSuburb(addrSuburb(toAddr));
  if (!f || !t) return 0;
  if (f === t) return 0;
  const k1 = `${f}-${t}`, k2 = `${t}-${f}`;
  if (SUBURB_TRAVEL_FALLBACK[k1] != null) return SUBURB_TRAVEL_FALLBACK[k1];
  if (SUBURB_TRAVEL_FALLBACK[k2] != null) return SUBURB_TRAVEL_FALLBACK[k2];
  // Two different suburbs in the same region are still a drive. Without this
  // floor a cold cache estimated 0, no leg was drawn, and a failed Routes call
  // left it that way.
  return Math.max(15, regionDistance(suburbRegion(f), suburbRegion(t)) || 0);
}

/* Best-effort suburb extractor — handles "100 Burrendah Blvd, Willetton WA 6155"
   and bare "Willetton" strings alike. */
function addrSuburb(addr) {
  if (!addr) return '';
  // Google formats addresses as "4 Jarrah Ln, Mount Claremont WA 6010, Australia":
  // drop the trailing country first, or "Australia" is read as the suburb
  // (7 Sep 2026 — every estimate for such an address came out as 0).
  let a = String(addr).trim().replace(/,\s*(Australia|AU)\s*$/i, '').trim();
  // If it looks like a bare suburb, return it.
  if (!/,/.test(a) && a.split(/\s+/).length <= 3) return a.replace(/\s+(WA|Western Australia)\s*\d{0,4}$/i, '').trim();
  const m = a.match(/,\s*([A-Za-z' ]+?)\s+(?:WA|Western Australia)?\s*\d{0,4}\s*$/i);
  return m ? m[1].trim() : a.split(',').pop().replace(/\bWA\b.*$/i, '').replace(/\d{4}\s*$/, '').trim();
}

/* Synchronous facade used by UI renderers. Returns cached minutes when warm,
   else the fallback estimate — and fires off fetchRoute() in the background
   so the next paint has the real number. */
function travelDurationMinSync(from, to, mode) {
  const modeKey = mode || 'driving';
  const key = routeKey(from, to, modeKey);
  const entry = ROUTE_CACHE.get(key);
  if (isFresh(entry)) return entry.durationMin;
  // Warm the cache in the background — don't await.
  fetchRoute(from, to, modeKey).then(scheduleOverlayRefresh).catch(() => {});
  return estimateTravelMinFromTable(from, to);
}

/* ONE repaint for a burst of route answers, not one per answer.
   A cold page load asks the Routes API for every leg of the week — thirty or
   so requests that resolve within a second of each other — and each answer
   used to call refreshAllOverlays() directly: drop every session's cached
   location, recompute every day's segments, redraw all seven columns. Thirty
   full repaints back to back is the "page freezes for ten seconds after a
   refresh" report (17 Sep 2026). Now the answers are coalesced: the repaint
   runs once, shortly after the last answer lands. Direct callers (a base
   edit, a booking) still call refreshAllOverlays() immediately. */
let _overlayRefreshTimer = null;
function scheduleOverlayRefresh() {
  if (typeof refreshAllOverlays !== 'function') return;
  clearTimeout(_overlayRefreshTimer);
  _overlayRefreshTimer = setTimeout(() => { _overlayRefreshTimer = null; refreshAllOverlays(); }, 250);
}

/* Public facade — every caller (impact evaluator, gap-option scorer,
   overlay renderer) uses this. The signature is unchanged from the old
   static version so nothing downstream needs editing. */
function travelMinutes(fromSuburb, toSuburb) {
  if (!fromSuburb || !toSuburb) return 0;
  if (fromSuburb === toSuburb) return 0;
  return travelDurationMinSync(fromSuburb, toSuburb, 'driving');
}

/* Pick the richest address string a given location object can offer for
   routing. Prefers full street address (when the session was booked with
   one) and falls back to suburb — the travel module's canonAddr() collapses
   both forms onto the same cache key, but the real Routes API call in
   production wants the fully-qualified string so it can resolve to the
   precise building rather than the suburb centroid. */
function locTravelKey(loc) {
  if (!loc) return null;
  return loc.address || loc.suburb || null;
}

/* Invalidate any ROUTE_CACHE entry involving a given address/suburb.
   Called from base-edit handlers so stale routes disappear immediately. */
function invalidateRouteCacheFor(addressOrSuburb) {
  if (!addressOrSuburb) { ROUTE_CACHE.clear(); DAY_SEGMENTS.clear(); return; }
  const needle = canonAddr(addressOrSuburb);
  if (!needle) return;
  for (const key of Array.from(ROUTE_CACHE.keys())) {
    if (key.includes(needle)) ROUTE_CACHE.delete(key);
  }
  DAY_SEGMENTS.clear();
}

/* Places API — used by the smart-gap recommender. Cached per anchor suburb.
   Falls back to the PLACES_NEAR mock when no API key is configured. */
async function fetchPlacesNear(anchorSuburb, types) {
  const key = `${canonAddr(anchorSuburb)}|${(types || []).join(',')}`;
  const cached = PLACES_CACHE.get(key);
  if (isFresh(cached)) return cached.places;
  let places;
  if (GOOGLE_MAPS_API_KEY) {
    try {
      const query = `${(types||['cafe']).join(' or ')} near ${anchorSuburb} WA`;
      const resp = await fetch('/api/maps/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ query, maxResultCount: 8 })
      });
      const json = await resp.json();
      places = (json.places || []).map(p => ({
        name: p.displayName && p.displayName.text || 'Unnamed',
        type: (p.primaryType || 'cafe').replace(/_/g, ' '),
        suburb: (p.formattedAddress || '').split(',').slice(-3, -2)[0] || anchorSuburb,
        rating: p.rating || 0,
        reviews: p.userRatingCount || 0,
        placeId: p.id,
        lat: p.location && p.location.latitude,
        lng: p.location && p.location.longitude
      }));
    } catch (e) { /* fall through to mock */ }
  }
  if (!places) places = (PLACES_NEAR[suburbRegion(anchorSuburb)] || []).map(p => ({ ...p }));
  PLACES_CACHE.set(key, { fetchedAt: Date.now(), places });
  return places;
}

function suburbRegion(suburb) {
  const m = {
    'Willetton':'central','Riverton':'south','Parkwood':'central','Leeming':'central',
    'Bateman':'central','Rossmoyne':'central','Shelley':'central','Bull Creek':'central','Canning Vale':'central',
    'Thornlie':'east','Gosnells':'east','Maddington':'east','Kelmscott':'east','Armadale':'east',
    'Atwell':'south','Success':'south','Cockburn':'south','Jandakot':'south',
    'Melville':'west','Applecross':'west','Palmyra':'west','Bicton':'west',
    'Perth':'central','Victoria Park':'central'
  };
  return m[suburb] || 'central';
}

/* ---------- Google Maps deep-link helper ---------- */
function mapsLink(origin, destination, mode) {
  // Uses the Maps "Directions" URL scheme — opens Maps app on phone, web on desktop
  const o = encodeURIComponent(origin || '');
  const d = encodeURIComponent(destination || '');
  const m = encodeURIComponent(mode || 'driving');
  return `https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${m}`;
}
function mapsSearchLink(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || '')}`;
}

/* ---------- Session helpers used by travel / gap engine ---------- */
function sessionsForDay(day) {
  return Object.values(SESSIONS)
    .filter(s => s.day === day && !s.cancelled)
    .sort((a, b) => sessionStartMin(a) - sessionStartMin(b));
}

/* Where a session puts the therapist — LAST KNOWN PHYSICAL LOCATION model
   (4 Oct 2026). The calendar is a chronological record of the day:

     an event WITH an address   → the therapist is now at that address
     an event WITHOUT one       → the therapist has NOT moved

   so a location comes only from the event's own data — its address, or the
   suburb of a home visit Splose recorded — never from its type. Telehealth
   is not "at home", an MDT is not "online", admin is not "at the office":
   with no address each simply leaves the therapist where they were, and
   travel is routed between the physical stops either side
   (computeDayTravelSegments). kind 'none' / 'unknown' / 'remote' are the
   no-move kinds; isPhysicalLocation() is the test. */
const CLIENT_ROUTE_TYPES = new Set(['therapy', 'initial', 'assessment', 'mdt']);
/* An address string that names a call, not a place ("Microsoft Teams
   Meeting", "Zoom", "Phone call"). Outlook copies the meeting link's label
   into location, which used to be routed as if it were a street. */
const NON_PLACE_ADDRESS = /^\s*(microsoft\s+teams(\s+meeting)?|teams(\s+meeting|\s+call)?|zoom(\s+meeting)?|google\s+meet|webex|skype|online|virtual|remote|telehealth|phone(\s+call)?|by\s+phone|n\/?a|none|tbc|tbd)\b/i;
function isPlaceAddress(addr) {
  const a = String(addr || '').trim();
  if (!a || NON_PLACE_ADDRESS.test(a) || /^https?:\/\//i.test(a)) return false;
  return true;
}
function sploseLocationForSession(s) {
  // 1) The event's own address: the therapist is there.
  if (s.address && isPlaceAddress(s.address)) {
    const sub = s.suburb ? stripSuburb(s.suburb) : addrSuburb(s.address);
    return {
      source: 'session.address',
      address: s.address,
      suburb: sub || null,
      label:  s.patient ? `${s.patient} · ${s.address}` : s.address,
      region: s.region || (sub ? suburbRegion(sub) : 'central'),
      kind:   s.patient ? 'visit' : 'session'
    };
  }
  // 2) Remote by the event's own data (Quick Add online mode, a Teams link).
  const isRemote = /^(teams|webinar|online)/i.test(s.suburb || '') || (s.address && !isPlaceAddress(s.address));
  if (isRemote) {
    return { source: 'remote', address: null, suburb: null, label: 'Remote / online', region: 'remote', kind: 'remote' };
  }
  // 3) A home visit Splose recorded by suburb only (no street yet).
  if (s.patient && s.suburb && !s.locationUnknown) {
    return {
      source: 'splose:/patients/' + (s.patientId || '?'),
      address: null,
      suburb: stripSuburb(s.suburb),
      label:  `${s.patient} (${stripSuburb(s.suburb)})`,
      region: s.region || suburbRegion(stripSuburb(s.suburb)),
      kind:   'visit'
    };
  }
  // 4) No address: the therapist stays where they were. 'unknown' marks a
  //    client session whose place may be set later; 'none' is everything else.
  const clientish = s.locationUnknown || CLIENT_ROUTE_TYPES.has(s.type);
  return {
    source: 'no-address', address: null, suburb: null,
    label: clientish ? (s.patient ? s.patient + ' (no address)' : 'No address') : 'No address — location unchanged',
    region: s.region || 'central', kind: clientish ? 'unknown' : 'none'
  };
}
/* Does this location move the therapist? */
function isPhysicalLocation(loc) {
  return !!(loc && loc.kind !== 'none' && loc.kind !== 'unknown' && loc.kind !== 'remote' && locTravelKey(loc));
}
/* A session that is a stop on the day's route: a real appointment (not a
   travel block) with a physical location. */
function isPhysicalStop(s) {
  return !!s && !isTravelBlock(s) && isPhysicalLocation(sessionLocation(s));
}

function sessionLocation(s) {
  // Cached per session so overlays don't re-compute each scroll.
  if (!s.__loc) s.__loc = sploseLocationForSession(s);
  return s.__loc;
}
function stripSuburb(s) {
  // "Willetton 6155" → "Willetton"; keeps bare names untouched.
  return (s || '').replace(/\s*\d{4}$/, '').trim();
}

/* The day-anchor base is the location the therapist starts/ends the day at —
   determined by the Mon–Fri work-location dropdown in My Profile. */
/* The work-location object for the week the CALENDAR is showing. The profile
   editor keeps its own cursor (WL_CURRENT_MONDAY); reading that from the
   calendar meant a base edit or a day change showed up on the wrong week, or
   not at all, until the two cursors happened to agree (7 Sep 2026). */
function calendarWeekLocations() {
  try {
    const mon = window.__currentWeekMonday;
    if (mon && typeof weekKeyFor === 'function' && typeof WORK_LOCATION !== 'undefined') {
      const local = new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
      const key = weekKeyFor(local);
      return WORK_LOCATION[key] || (WORK_LOCATION[key] = {});
    }
  } catch (e) { /* fall through */ }
  return (typeof wlThisWeek === 'function') ? wlThisWeek() : {};
}
function dayAnchorBase(day) {
  const weekObj = calendarWeekLocations();
  const locKey = weekObj && weekObj[day];
  // Only a base the therapist actually chose for this day anchors travel. The
  // office is "coming soon" (no real office yet) and never counts. With no
  // base there is no start/end leg — no guessing from another base
  // (27 Sep 2026: "Start 19 min · Como" came from an unset week).
  const base = (locKey && locKey !== 'leave' && locKey !== 'unset' && locKey !== 'office') ? getBase(locKey) : null;
  if (base && (base.addr || base.suburb || base.kind === 'remote')) {
    return {
      suburb: base.suburb || null,
      label:  base.label  || 'Base',
      addr:   base.addr   || null,
      region: base.region || suburbRegion(base.suburb) || 'central',
      remote: base.kind === 'remote'
    };
  }
  return { suburb: null, label: 'Work location not set', addr: null, region: 'central', remote: false, unset: true };
}

/* Is this day ready to book? 'set' | 'unset' | 'leave' — the booking gate. */
function dayWorkLocationStatus(day) {
  const locKey = (calendarWeekLocations() || {})[day];
  if (locKey === 'leave') return 'leave';
  return dayAnchorBase(day).unset ? 'unset' : 'set';
}

/* ---------- Normalized travel-segment store ----------
   Every consumer that wants to reason about travel on a day (overlays,
   totals, future route optimiser) reads DAY_SEGMENTS[day] instead of
   duplicating the pair-walking logic. A segment is self-describing:

   TravelSegment = {
     day: 'mon'|'tue'|...,
     kind: 'start' | 'between' | 'end' | 'gap',
     fromLoc: { suburb, label, region },
     toLoc:   { suburb, label, region },
     startMin, endMin,                       // minutes from midnight
     travelMin,                              // route duration (cached or estimate)
     freeMin,                                // minutes of slack inside the window (gap/between only)
     fromSessionId, toSessionId,             // nullable at edges
     anchorBaseId,                           // set on 'start' and 'end'
     cacheKey                                // route cache key for debugging
   }
*/
const DAY_SEGMENTS = new Map();

/* ─── isTravelBlock ────────────────────────────────────────────────────────
   Returns true if a session object represents an Outlook or app-created
   travel block rather than a client appointment.                           */
function isTravelBlock(s) {
  if (!s) return false;
  if (s.type === 'travel') return true;
  var title = (s.title || '').toLowerCase();
  var TRAVEL_KW = ['travel to', 'travel from', 'drive to', 'drive from', 'driving to',
                   'driving from', 'transit', 'commute', 'journey'];
  if (TRAVEL_KW.some(function(kw) { return title.includes(kw); })) return true;
  // Outlook category-based detection
  if (s.categories && Array.isArray(s.categories)) {
    var cats = s.categories.map(function(c) { return (c || '').toLowerCase(); });
    if (cats.some(function(c) { return c.includes('travel') || c.includes('drive'); })) return true;
  }
  return false;
}

/* ---------- Per-session travel answers (before / after) ----------
   A client session can say where the therapist is coming from and where they
   go next. The answers live on the event (custom_metadata.travel) and travel
   with it; absent means "the day's base". Between-session legs always chain
   in time order, so only the first session's `before` and the last session's
   `after` are read — a stop added after a session simply becomes the next
   session, and the old `after` passes to it (see applyTravelChainAfterBooking).
   Shape: { kind: 'base', id } | { kind: 'address', address, suburb, label }. */
function sessionTravelOverride(s, side) {
  const t = s && s.travel;
  const v = t && t[side];
  return (v && typeof v === 'object' && v.kind) ? v : null;
}
function resolveTravelPoint(spec, day) {
  if (!spec) return null;
  if (spec.kind === 'base') {
    const b = (typeof getBase === 'function') ? getBase(spec.id) : null;
    if (!b) return null;
    return { suburb: b.suburb || null, label: b.label || 'Base', addr: b.addr || null,
             region: b.region || suburbRegion(b.suburb) || 'central', remote: b.kind === 'remote', baseId: spec.id };
  }
  if (spec.kind === 'address') {
    const addr = String(spec.address || '').trim();
    if (!addr) return null;
    const suburb = spec.suburb || (typeof addrSuburb === 'function' ? addrSuburb(addr) : null) || addr;
    return { suburb, label: spec.label || suburb, addr, region: suburbRegion(suburb) || 'central', remote: false, baseId: null };
  }
  return null;
}
function describeTravelPoint(spec, day) {
  const p = resolveTravelPoint(spec, day);
  if (p) return p.label + (p.suburb && p.suburb !== p.label ? ' · ' + p.suburb : '');
  const b = dayAnchorBase(day);
  return (b.label || 'Base') + (b.suburb && b.suburb !== b.label ? ' · ' + b.suburb : '') + ' (day default)';
}
/* Persist an answer on the event and redraw. side: 'before' | 'after'. spec null = back to default. */
async function setTravelOverride(sessionId, side, spec) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s || !s.dbId) { showToast('Not saved', 'This block has no saved appointment behind it yet.'); return false; }
  const prev = Object.assign({}, s.travel || {});
  const next = Object.assign({}, prev);
  if (spec) next[side] = spec; else delete next[side];
  try {
    const r = await fetch('/api/events/' + encodeURIComponent(s.dbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: next.before || null, after: next.after || null }),
    });
    if (!r.ok) { const j = await r.json().catch(() => ({})); showToast('Could not save travel plan', j.error || ('HTTP ' + r.status)); return false; }
  } catch (e) { showToast('Could not save travel plan', e.message); return false; }
  s.travel = next;
  if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
  registerTravelUndo(s, prev, side === 'before' ? 'Where travel starts' : 'Where travel ends');
  return true;
}

/* ---------- Cmd+Z for travel (6 Oct 2026) ----------
   Every travel click — a leg dragged or nudged, a where-from / where-to
   answer, go direct / go home — is one undo step (OpalUndo merges whatever
   the same click also changed). The inverse writes the event's whole
   previous travel plan back in one PATCH: the route replaces exactly the
   fields it is sent, so it does not matter which one the click moved. */
function registerTravelUndo(s, prev, label) {
  if (!window.OpalUndo || !s || !s.dbId) return;
  const dbId = s.dbId, id = s.id;
  const was = Object.assign({}, prev || {});
  window.OpalUndo.register({ group: 'calendar', label: label, undo: async () => {
    const r = await fetch('/api/events/' + encodeURIComponent(dbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        before: was.before || null, after: was.after || null, next: was.next || null,
        beforeOffsetMin: was.beforeOffsetMin == null ? null : was.beforeOffsetMin,
        afterOffsetMin:  was.afterOffsetMin  == null ? null : was.afterOffsetMin,
      }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || ('HTTP ' + r.status));
    // A calendar reload re-keys tiles, so find the block by its saved id.
    const cur = _sessionByDbId(dbId) || (window.SESSIONS && window.SESSIONS[id]);
    if (cur) { cur.travel = was; if (typeof refreshDayOverlays === 'function') refreshDayOverlays(cur.day); }
  } });
}

/* An address save's undo puts the previous address back the same way it was
   saved. A block that had no address cannot be blanked from here (the
   location route needs one), so that undo says so instead of skipping. */
function captureSessionAddress(s) {
  if (!s) return null;
  return { id: s.id, dbId: s.dbId || null, sploseId: s.sploseId || null, address: s.address || '',
           lat: s.lat || null, lng: s.lng || null, location: s.location, addressSource: s.addressSource,
           locationObj: s.locationObj };
}
function registerSessionAddressUndo(s, was) {
  if (!window.OpalUndo || !s || !was) return;
  window.OpalUndo.register({ group: 'calendar', label: 'Location change — ' + (s.patient || s.title || 'session'), undo: async () => {
    if (!was.address) throw new Error('it had no address before');
    const cur = (was.dbId && _sessionByDbId(was.dbId)) || (window.SESSIONS && window.SESSIONS[was.id]);
    if (!cur) throw new Error('that block is no longer on the calendar');
    if (cur.dbId) {
      const r = await fetch('/api/outlook/events/' + encodeURIComponent(cur.dbId) + '/location', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: was.address, lat: was.lat, lng: was.lng }),
      });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || ('HTTP ' + r.status));
    }
    const replaced = cur.address;
    cur.address = was.address; cur.lat = was.lat; cur.lng = was.lng;
    cur.location = was.location; cur.addressSource = was.addressSource; cur.locationObj = was.locationObj;
    delete cur.__loc;
    invalidateRouteCacheFor(replaced); invalidateRouteCacheFor(was.address);
    try {
      const key = cur.sploseId ? 'manual_addr_splose_' + cur.sploseId : (cur.dbId ? 'manual_addr_db_' + cur.dbId : null);
      if (key) localStorage.setItem(key, JSON.stringify({ formattedAddress: was.address, lat: was.lat, lng: was.lng, savedAt: new Date().toISOString() }));
    } catch (e) { /* storage unavailable */ }
    if (cur.element) {
      const ok = (typeof isValidRoutingLocation === 'function' ? isValidRoutingLocation(was.address) : true) || !!(was.lat && was.lng);
      cur.element.classList.toggle('has-addr', ok);
      cur.element.classList.toggle('missing-addr', !ok && (typeof sessionNeedsFullAddress === 'function' ? sessionNeedsFullAddress(cur) : false));
    }
    if (typeof refreshDayOverlays === 'function') refreshDayOverlays(cur.day);
  } });
}

/* Ask once for the day's base when a booking lands on a day that has none
   (owner's call, 7 Sep 2026: ask, don't silently assume the office). */
/* The booking gate: resolves the day's base key once one is set, or null —
   and a null means do NOT book. A day with no real base (blank, or the
   "coming soon" office) must be given one first, here or in My Profile. */
function ensureDayBase(day, afterLoad) {
  // "Not set" is only true once the saved week has arrived (6 Oct 2026).
  if (!afterLoad && typeof window.workScheduleReady === 'function' &&
      !(window.workScheduleLoaded && window.workScheduleLoaded())) {
    return window.workScheduleReady().then(() => ensureDayBase(day, true));
  }
  try {
    const wk = calendarWeekLocations();
    if (!wk) return Promise.resolve(null);
    const status = dayWorkLocationStatus(day);
    if (status !== 'unset') return Promise.resolve(wk[day]);
    if (typeof rebuildLocationCatalogue === 'function') rebuildLocationCatalogue();
    const opts = Object.keys(typeof LOCATIONS !== 'undefined' ? LOCATIONS : {})
      .filter(k => k !== 'leave' && k !== 'unset' && !LOCATIONS[k].comingSoon)
      .filter(k => { const b = getBase(k); return b && (b.addr || b.suburb || b.kind === 'remote'); })
      .map(k => ({ key: k, label: LOCATIONS[k].label || k }));
    opts.push({ key: '__setup', label: 'Set up work locations for this week →' });
    const dayName = ({ mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' })[day] || day;
    return travelChooser('Where are you working on ' + dayName + '?',
      'Set this before booking — travel to the first session and back from the last one is worked out from it.', opts)
      .then(key => {
        if (key === '__setup') { openWorkLocationsForCalendarWeek(); return null; }
        if (key) {
          // Write to the calendar's week (not the profile editor's cursor) and save.
          wk[day] = key;
          if (typeof renderWorkLocationEditor === 'function') renderWorkLocationEditor();
          if (typeof debouncedSaveWorkSchedule === 'function') debouncedSaveWorkSchedule();
          refreshAllOverlays();
        }
        return key;
      });
  } catch (e) { return Promise.resolve(null); }
}

/* My Profile › Work locations, on the week the calendar is showing. */
function openWorkLocationsForCalendarWeek() {
  const mon = window.__currentWeekMonday;
  if (typeof closeBookingPanel === 'function') closeBookingPanel(false);
  // Closing the panel rewrites the hash; switch tab after the router has run.
  setTimeout(() => {
    if (typeof switchTab === 'function') switchTab('profile');
    if (mon && typeof WL_CURRENT_MONDAY !== 'undefined') {
      WL_CURRENT_MONDAY = new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate());
    }
    if (typeof renderWorkLocationEditor === 'function') renderWorkLocationEditor();
    if (typeof pfOpenArea === 'function') pfOpenArea('pf-location');
  }, 40);
}

/* A small themed chooser (dialog.css look) — resolves the chosen key or null. */
function travelChooser(title, message, options) {
  return new Promise(resolve => {
    const el = document.createElement('div');
    el.className = 'pd-backdrop';
    const esc = (v) => String(v == null ? '' : v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
    el.innerHTML = '<section class="pd-dialog" role="dialog" aria-modal="true" aria-labelledby="tc-title">' +
      '<div class="pd-head"><h2 class="pd-title" id="tc-title">' + esc(title) + '</h2></div>' +
      '<div class="pd-body"><p>' + esc(message) + '</p><div class="tc-opts">' +
        options.map(o => '<button type="button" class="pd-btn tc-opt" data-key="' + esc(o.key) + '" style="display:block;width:100%;text-align:left;margin:6px 0;">' + esc(o.label) + '</button>').join('') +
      '</div></div>' +
      '<div class="pd-foot"><button type="button" class="pd-btn" data-key="">Not now</button></div></section>';
    document.body.appendChild(el); document.body.classList.add('pd-open');
    let done = false;
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); finish(null); } };
    const finish = (k) => {
      if (done) return; done = true;
      document.removeEventListener('keydown', onKey, true);
      el.remove(); document.body.classList.remove('pd-open'); resolve(k || null);
    };
    el.querySelectorAll('[data-key]').forEach(b => b.addEventListener('click', () => finish(b.getAttribute('data-key'))));
    el.addEventListener('mousedown', e => { if (e.target === el) finish(null); });
    document.addEventListener('keydown', onKey, true);
    const first = el.querySelector('.tc-opt'); if (first) first.focus();
  });
}

/* "Add a stop": open Smart Booking for a client straight after a session, at
   the earliest start the travel allows, carrying the travelling-from context. */
function addStopAfterSession(sessionId, patientId) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  const p = (window.PATIENTS || []).find(x => String(x.id) === String(patientId));
  if (!s || !p) return;
  const fromLoc = sessionLocation(s);
  const fromKey = locTravelKey(fromLoc);
  const toKey   = p.address || p.suburb;
  const travel  = (fromKey && toKey && fromKey !== toKey) ? travelMinutes(fromKey, toKey) : 0;
  const endMin  = sessionEndMin(s);
  const earliest = Math.ceil((endMin + travel) / 15) * 15;
  const dur = 60, finish = earliest + dur;
  const ctx = { sessionId: s.id, dbId: s.dbId || null, label: (s.patient || s.title || 'the previous session'), suburb: fromLoc.suburb || '', travelMin: travel, patientId: p.id };
  if (typeof closeTravelPanel === 'function') closeTravelPanel();
  if (typeof openBookingPanel !== 'function') return;
  openBookingPanel({ day: s.day, date: (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[s.day] : null,
                     startH: Math.floor(earliest / 60), startM: earliest % 60, endH: Math.floor(finish / 60), endM: finish % 60, travelFrom: ctx });
  // openBookingPanel resets the wizard; select the client and stamp the context afterwards.
  setTimeout(() => {
    if (typeof BOOKING_STATE !== 'undefined') BOOKING_STATE.travelFrom = ctx;
    // The client is the one just picked; the booking type is the therapist's
    // choice — none is pre-selected. Show the client list with them chosen.
    if (typeof selectBookingCat === 'function') selectBookingCat('client');
    const card = document.querySelector('.patient-card[data-patient-id="' + String(p.id).replace(/"/g, '') + '"]');
    if (card) card.click();
    const strip = document.getElementById('bsp-prefill-strip'), text = document.getElementById('bsp-prefill-text');
    if (strip && text) {
      strip.style.display = '';
      text.textContent += ' · travelling from ' + ctx.label + (ctx.suburb ? ', ' + ctx.suburb : '') + (travel ? ' · ' + travel + ' min' : '');
    }
  }, 60);
}

/* ---------- Chain maintenance (concept §4) ----------
   Insert: a session that becomes the LAST of its day inherits the previous
   last session's `after` (where the day was going to end), unless it has one.
   Delete: when the last session goes, its `after` passes back to the session
   that is now last (if that one has none of its own).
   Move: a session dragged to the end of a day inherits the same way. */

/* Before a booking is saved: what the new session should inherit, if its slot
   lands after everything else on that day. Returns a spec or null. */
function travelInheritSpecFor(day, startMin) {
  const sessions = sessionsForDay(day);
  if (!sessions.length) return null;
  const last = sessions[sessions.length - 1];
  if (startMin < sessionEndMin(last)) return null;      // not going to be the last
  return sessionTravelOverride(last, 'after');
}

/* After a booking is saved: write the inherited `after` onto the new event. */
async function travelChainInherit(newDbId, spec) {
  if (!newDbId || !spec) return;
  try {
    await fetch('/api/events/' + encodeURIComponent(newDbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: null, after: spec }),
    });
  } catch (e) { /* best effort — the default is the same base most days */ }
}

/* Before a delete: if the doomed session is last on its day and carries an
   `after`, hand it to the session that becomes last (only if that one has no
   answer of its own). Returns { sessionId, spec } to apply, or null. */
function travelGapClosingFor(sessionId) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s) return null;
  const spec = sessionTravelOverride(s, 'after');
  if (!spec) return null;
  const sessions = sessionsForDay(s.day);
  const idx = sessions.findIndex(x => x.id === sessionId);
  if (idx !== sessions.length - 1 || idx < 1) return null;
  const pred = sessions[idx - 1];
  if (!pred.dbId || sessionTravelOverride(pred, 'after')) return null;
  return { sessionId: pred.id, spec };
}

/* After a move: if the moved session is now last on its day with no `after`
   of its own, take over the one the previous last session held. */
function travelChainAfterMove(sessionId) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s || !s.dbId || sessionTravelOverride(s, 'after')) return;
  const sessions = sessionsForDay(s.day);
  if (!sessions.length || sessions[sessions.length - 1].id !== sessionId || sessions.length < 2) return;
  const prevLast = sessions[sessions.length - 2];
  const spec = sessionTravelOverride(prevLast, 'after');
  if (spec) setTravelOverride(sessionId, 'after', spec);
}

/* ---------- Route-aware Smart Booking (2 Oct 2026) ----------
   The next appointment and the drive into it are ONE unit: given where the
   clinician finishes the previous stop, the system works out the earliest
   realistic start and keeps the proposed appointment there as the client,
   location, day, duration or previous stop change. The clinician can still
   move it LATER; earlier than the drive allows is clamped with a warning.

   Three numbers, kept apart on purpose:
     route minutes   what Google says the drive takes (never invented — a
                     failed lookup is an error state, not an estimate)
     buffer minutes  an operational allowance, SMART_ROUTE_CONFIG / settings
     booking grid    appointment starts snap UP to the next 15-minute slot;
                     the travel block itself shows the real duration.

   Nothing here writes a record: the proposed travel and appointment are
   previews until Create appointment. */
var SMART_ROUTE_CONFIG = { slotMin: 15, defaultBufferMin: 0, maxBufferMin: 60, debounceMs: 300 };

/* Operational buffer added to every routed leg. APP_SETTINGS.travelBufferMin
   overrides the default when it is a whole number of minutes in range. */
function routeBufferMin() {
  const s = (typeof window !== 'undefined' && window.APP_SETTINGS) || {};
  const v = Number(s.travelBufferMin);
  if (s.travelBufferMin != null && s.travelBufferMin !== '' && Number.isFinite(v) && v >= 0 && v <= SMART_ROUTE_CONFIG.maxBufferMin) return Math.round(v);
  return SMART_ROUTE_CONFIG.defaultBufferMin;
}
function ceilToSlot(min, slot) { const g = slot || SMART_ROUTE_CONFIG.slotMin; return Math.ceil(min / g) * g; }
function snapToSlot(min, slot) { const g = slot || SMART_ROUTE_CONFIG.slotMin; return Math.round(min / g) * g; }

/* PURE — where can the next appointment start?
   in:  prevEndMin, travelMin, bufferMin, durationMin, desiredStartMin (null =
        "earliest"), busy [{ id, startMin, endMin, label }] (confirmed blocks,
        the previous stop excluded), dayEndMin, slotMin
   out: { earliestStartMin, startMin, endMin, travelStartMin, travelEndMin,
          clampedFromMin, movedForConflicts: [busy…], conflicts: [busy…] (at a
          manual start), fits } — duration is never changed. */
function planNextStop(input) {
  const i = input || {};
  const slot = i.slotMin || SMART_ROUTE_CONFIG.slotMin;
  const prevEnd = Number(i.prevEndMin) || 0;
  const travel = Math.max(0, Math.round(Number(i.travelMin) || 0));
  const buffer = Math.max(0, Math.round(Number(i.bufferMin) || 0));
  const dur = Math.max(slot, Math.round(Number(i.durationMin) || 60));
  const dayEnd = i.dayEndMin != null ? i.dayEndMin : 24 * 60;
  const busy = (i.busy || []).filter(b => b && b.endMin > prevEnd).slice().sort((a, b) => a.startMin - b.startMin);
  const earliest = ceilToSlot(prevEnd + travel + buffer, slot);
  const overlapping = (s) => busy.filter(b => b.startMin < s + dur && b.endMin > s);
  const out = {
    earliestStartMin: earliest, travelStartMin: prevEnd, travelEndMin: prevEnd + travel,
    travelMin: travel, bufferMin: buffer, durationMin: dur,
    clampedFromMin: null, movedForConflicts: [], conflicts: [], fits: true,
  };
  let start;
  if (i.desiredStartMin != null && Number.isFinite(Number(i.desiredStartMin))) {
    const want = snapToSlot(Number(i.desiredStartMin), slot);
    if (want < earliest) { out.clampedFromMin = want; start = earliest; }
    else start = want;
    // A start the clinician chose is kept; a collision there is reported, not moved.
    if (out.clampedFromMin == null) {
      out.conflicts = overlapping(start);
      out.startMin = start; out.endMin = start + dur; out.fits = start + dur <= dayEnd;
      placeProposalTravel(out, prevEnd, busy);
      return out;
    }
  } else {
    start = earliest;
  }
  // Earliest (or clamped) start: walk past confirmed blocks to the next slot
  // where the whole appointment fits. No whole-day optimisation.
  for (let guard = 0; guard < 96; guard++) {
    const hit = overlapping(start);
    if (!hit.length) break;
    hit.forEach(h => { if (out.movedForConflicts.indexOf(h) < 0) out.movedForConflicts.push(h); });
    start = ceilToSlot(Math.max.apply(null, hit.map(h => h.endMin)), slot);
  }
  out.startMin = start; out.endMin = start + dur;
  out.fits = start + dur <= dayEnd && !overlapping(start).length;
  placeProposalTravel(out, prevEnd, busy);
  return out;
}
/* The proposed drive sits against the proposed appointment (arrive, buffer,
   start) in the latest free slot after the previous stop — the same rule as
   the calendar's legs (latestFreeSlot). */
function placeProposalTravel(out, prevEnd, busy) {
  if (!out.travelMin) { out.travelStartMin = out.travelEndMin = prevEnd; return out; }
  const slot = latestFreeSlot(out.startMin - out.bufferMin, prevEnd, out.travelMin, busy);
  const st = slot ? slot.startMin : prevEnd;
  out.travelStartMin = st; out.travelEndMin = st + out.travelMin;
  return out;
}

/* The live state of the route preview. `context` is the previous CONFIRMED
   stop when continuing a route ("Book another client"); manualStart is set
   when the clinician types a start or drags the proposed block. */
var BOOKING_ROUTE = { context: null, manualStart: false, manualTiming: false, lastClamp: null, status: null, seq: 0, timer: null, viaMode: 'auto', lastPredId: null, shownMode: null, suggestedStartMin: null };

function _sessionByDbId(dbId) {
  if (!dbId || !window.SESSIONS) return null;
  return Object.values(window.SESSIONS).find(s => s && String(s.dbId) === String(dbId) && !s.cancelled) || null;
}
/* The stop this booking continues from. An explicit route context (Book
   another client / add a stop) is resolved by its saved event id — the
   calendar re-renders tiles under new ids — and falls back to the context's
   own structured copy of the stop. Otherwise the last session that ends
   before the slot. */
function _bspPredecessor(day, startMin) {
  const ctx = (BOOKING_ROUTE && BOOKING_ROUTE.context) ||
              ((typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE && BOOKING_STATE.travelFrom) || null);
  if (ctx && (!ctx.day || ctx.day === day)) {
    const s = (ctx.sessionId && window.SESSIONS && window.SESSIONS[ctx.sessionId]) || _sessionByDbId(ctx.dbId);
    if (s && s.day === day) {
      // Continuing from an event with no address (a telehealth): the drive
      // starts from the last place the therapist actually was.
      const at = isPhysicalStop(s) ? s : _lastPhysicalStopBefore(day, sessionEndMin(s), s);
      const loc = sessionLocation(at || s);
      return { s, explicit: true, endMin: sessionEndMin(s), fromKey: at ? locTravelKey(loc) : null, suburb: at ? (loc.suburb || '') : '',
               label: ctx.label || _stopName(at || s) || 'previous stop' };
    }
    if (ctx.day === day && ctx.endMin != null) {
      return { s: { id: ctx.sessionId || '' }, explicit: true, endMin: ctx.endMin, fromKey: ctx.address || ctx.suburb || null,
               suburb: ctx.suburb || (ctx.address ? addrSuburb(ctx.address) : ''), label: ctx.label || 'previous stop' };
    }
  }
  // The last PHYSICAL stop: events with no address in between leave the
  // therapist where they were, so they are not where the drive starts.
  const s = _lastPhysicalStopBefore(day, startMin, null);
  if (!s) return null;
  const loc = sessionLocation(s);
  return { s, explicit: false, endMin: sessionEndMin(s), fromKey: locTravelKey(loc), suburb: loc.suburb || '', label: _stopName(s) || 'previous session' };
}
function _lastPhysicalStopBefore(day, endByMin, include) {
  const before = sessionsForDay(day).filter(x => (x === include || sessionEndMin(x) <= endByMin) && isPhysicalStop(x));
  return before.length ? before[before.length - 1] : null;
}
/* A stop's display name: the client, not the Outlook title convention. */
function _stopName(s) {
  if (!s) return '';
  return s.patient || String(s.title || '').replace(/^Client Appointment\s+[—–-]\s+/i, '').trim();
}
function _bspUnsure() { const u = document.getElementById('bsp-location-unsure'); return !!(u && u.checked); }
/* Where the proposed appointment is. "Unsure" means unknown — never the
   client's address on file. */
function _bspTargetAddress() {
  if (_bspUnsure()) return '';
  const typed = (document.getElementById('bsp-location') || {}).value || '';
  if (typed.trim()) return typed.trim();
  const p = (typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE && BOOKING_STATE.selectedPatient) || null;
  return p ? (p.address || p.suburb || '') : '';
}
function _bspIsClientBooking() {
  return !(typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE && BOOKING_STATE.category && BOOKING_STATE.category !== 'client');
}
function clearBspTravelPreview() {
  document.querySelectorAll('.travel-overlay.preview').forEach(el => el.remove());
  document.querySelectorAll('.travel-overlay.suppressed').forEach(el => el.classList.remove('suppressed'));
}
function _hhmm(min) { return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); }

/* The compact route line under Location. kind: hidden | info | loading | error | warn | ok */
function setBspRouteStatus(kind, html) {
  BOOKING_ROUTE.status = kind;
  const el = document.getElementById('bsp-route-status');
  if (!el) return;
  if (kind === 'hidden' || !html) { el.hidden = true; el.innerHTML = ''; el.className = 'bsp-route-status'; return; }
  el.hidden = false;
  el.className = 'bsp-route-status ' + kind;
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = html;
}

function _previewLeg(col, startMin, endMin, cls, html, title) {
  const el = document.createElement('div');
  el.className = cls === 'placeholder' ? 'travel-overlay between preview placeholder' : 'travel-overlay between preview' + (cls ? ' ' + cls : '');
  el.style.top = tToY(Math.floor(startMin / 60), startMin % 60) + 'px';
  const px = Math.max(0, endMin - startMin) / 60 * HOUR_PX;
  el.style.height = (endMin > startMin ? Math.min(Math.max(12, px - 4), Math.max(4, px - 2)) : 16) + 'px';
  el.innerHTML = html;
  if (title) el.title = title;
  col.appendChild(el);
  return el;
}

/* Debounced entry point — every panel change lands here. */
function bspTravelPreview() {
  clearTimeout(BOOKING_ROUTE.timer);
  BOOKING_ROUTE.timer = setTimeout(runBspRoutePreview, SMART_ROUTE_CONFIG.debounceMs);
  // Repaint the cached state at once so the calendar never lags a keystroke.
  runBspRoutePreview({ cachedOnly: true });
}

function runBspRoutePreview(opts) {
  const o = opts || {};
  clearBspTravelPreview();
  const panel = document.getElementById('booking-side-panel');
  if (!panel || !panel.classList.contains('open') || !_bspIsClientBooking()) { setBspRouteStatus('hidden'); return; }
  const chip = document.querySelector('.bsp-day-chip.active');
  const day = chip && chip.dataset ? chip.dataset.day : null;
  const startEl = document.getElementById('bsp-start');
  if (!day || !startEl || !startEl.value) { setBspRouteStatus('hidden'); return; }
  const [sh, sm] = startEl.value.split(':').map(Number);
  const startMin = sh * 60 + (sm || 0);
  const dur = parseInt((document.getElementById('bsp-dur-slider') || {}).value || '60', 10) || 60;
  let pred = _bspPredecessor(day, startMin);
  if (!pred) { setBspRouteStatus('hidden'); return; }
  BOOKING_ROUTE.lastPredId = pred.s && pred.s.id ? pred.s.id : null;
  const col = document.getElementById('day-' + day);
  const esc = _tpEsc;
  let fromName = esc(pred.label) + (pred.suburb ? ' (' + esc(pred.suburb) + ')' : '');
  // The previous stop's own legs stay exactly as they are until the new
  // client's location is known (6 Oct 2026). A placeholder never sits on
  // top of them: until then it waits below the previous stop's own legs.
  const predS = pred.s;
  let legTop = pred.endMin;
  const placeholder = (text) => { if (col) _previewLeg(col, legTop, legTop, 'placeholder', '<span class="t-ico">Travel</span><span class="t-label">' + text + '</span>'); };
  const ownLegsEnd = _bspPredLegsEnd(day, predS);

  if (_bspUnsure()) {
    if (ownLegsEnd != null) legTop = Math.max(legTop, ownLegsEnd);
    placeholder('location not set');
    setBspRouteStatus('warn', '<strong>Smart Travel is off for this booking.</strong> Travel from ' + fromName + ' is calculated once the location is set on the calendar.');
    return;
  }
  const toKey = _bspTargetAddress();
  if (!pred.fromKey) {
    if (ownLegsEnd != null) legTop = Math.max(legTop, ownLegsEnd);
    placeholder('previous stop has no address');
    setBspRouteStatus('warn', 'The previous stop has no address, so travel cannot be calculated. Set it on that appointment.');
    return;
  }
  if (!toKey) {
    // No location yet is the normal starting state, not a warning: the panel
    // line asks for it. A chip on the calendar here sat at the previous
    // stop's end, away from the proposal, and read like a stray travel leg.
    setBspRouteStatus('info', 'After ' + fromName + ' — choose the location to calculate travel.');
    return;
  }
  // Straight from the last stop, or home in between? Same rule as the
  // calendar (betweenTravelPlan): home when there is time, unless the
  // therapist chose; Book Another Client means "go straight on" by default.
  const homePlan = _bspHomePlan(day, pred, toKey, startMin);
  const prevName = fromName;
  if (homePlan.home) {
    // The drive home after the last stop stays on the calendar; the proposal
    // starts from home once the therapist is back there.
    pred = Object.assign({}, pred, { fromKey: homePlan.baseKey, suburb: homePlan.base.suburb || '', label: homePlan.base.label || 'Home',
                                     endMin: pred.endMin + (homePlan.toBase || 0), viaHome: true });
    fromName = esc(pred.label) + (pred.suburb ? ' (' + esc(pred.suburb) + ')' : '');
  }
  // From here the way is known, so the calendar shows it at once — even
  // while the route is still being calculated:
  //   Via home  the drive home stays fixed; the new travel starts after it.
  //   Direct    the drive home goes; the new travel takes its place.
  _bspReplaceLegsOf(predS, homePlan.home);
  legTop = homePlan.home ? Math.max(pred.endMin, ownLegsEnd != null ? ownLegsEnd : pred.endMin) : legTop;
  // The same two-way switch as on the calendar's legs: it names what the
  // proposal does now; a click flips it.
  const switchBtn = !homePlan.available ? ''
    : homePlan.home ? ' <button type="button" class="bsp-route-btn bsp-route-switch" data-route="direct" title="Going home in between. Click to go direct instead.">Via home ⇄</button>'
    : ' <button type="button" class="bsp-route-btn bsp-route-switch" data-route="home" title="Going direct. Click to go home in between instead.">Direct ⇄</button>';
  if (BOOKING_ROUTE.manualTiming) {
    setBspRouteStatus('warn', 'Manual timing — travel from ' + fromName + ' is not calculated. <button type="button" class="bsp-route-btn" data-route="retry">Calculate travel</button>');
    return;
  }

  // The route: same place = no drive; otherwise a REAL routed answer.
  let route = null;
  if (canonAddr(pred.fromKey) === canonAddr(toKey)) {
    route = { durationMin: 0, distanceMeters: 0, source: 'routes-api' };
  } else {
    const dep = (typeof DAY_DATES !== 'undefined' && DAY_DATES && DAY_DATES[day]) ? DAY_DATES[day] + 'T' + _hhmm(pred.endMin) + ':00+08:00' : null;
    const bucket = _departureBucket(dep);
    const key = routeKey(pred.fromKey, toKey, 'driving') + (bucket ? '|t' + bucket : '');
    const cached = ROUTE_CACHE.get(key);
    // Retry skips a cached failure; anything else fresh is reused (no new call).
    if (isFresh(cached) && !(o.fresh && cached.source !== 'routes-api')) route = cached;
    else {
      placeholder('calculating travel…');
      setBspRouteStatus('loading', '<span class="bsp-route-spin" aria-hidden="true"></span>Calculating travel from ' + fromName + '…');
      if (o.cachedOnly) {
        // A repaint never routes; make sure a full run is on its way.
        if (!ROUTE_INFLIGHT.has(key)) { clearTimeout(BOOKING_ROUTE.timer); BOOKING_ROUTE.timer = setTimeout(runBspRoutePreview, SMART_ROUTE_CONFIG.debounceMs); }
        return;
      }
      const mySeq = ++BOOKING_ROUTE.seq;
      fetchRoute(pred.fromKey, toKey, 'driving', { departureTime: dep, fresh: !!o.fresh })
        .catch(() => null)
        .then(() => { if (mySeq === BOOKING_ROUTE.seq) runBspRoutePreview(); });
      return;
    }
  }
  if (route.source !== 'routes-api') {
    // A failed lookup: keep everything the clinician chose, invent nothing.
    placeholder('travel not calculated');
    setBspRouteStatus('error', '<strong>Unable to calculate travel right now.</strong> Retry or continue with manual timing. ' +
      '<button type="button" class="bsp-route-btn" data-route="retry">Retry</button> ' +
      '<button type="button" class="bsp-route-btn" data-route="manual">Continue with manual timing</button>');
    return;
  }

  const busy = sessionsForDay(day)
    .filter(s => s !== pred.s && !isTravelBlock(s) && sessionEndMin(s) > pred.endMin)
    .map(s => ({ id: s.id, startMin: sessionStartMin(s), endMin: sessionEndMin(s), label: s.patient || s.title || 'appointment' }));
  const plan = planNextStop({
    prevEndMin: pred.endMin, travelMin: route.durationMin, bufferMin: routeBufferMin(), durationMin: dur,
    desiredStartMin: (pred.explicit && !BOOKING_ROUTE.manualStart) ? null : startMin,
    busy, dayEndMin: (typeof END_H !== 'undefined' ? END_H : 24) * 60,
  });

  // An explicit route moves the proposal; an implicit neighbour only advises.
  let shownStart = startMin;
  if (pred.explicit && plan.startMin !== startMin) {
    shownStart = plan.startMin;
    startEl.value = _hhmm(plan.startMin);
    if (typeof _bspRecomputeEnd === 'function') _bspRecomputeEnd();
  }
  if (typeof renderCalendarPreviewBlocks === 'function' && pred.explicit) {
    renderCalendarPreviewBlocks([{ day, dayLabel: day, startH: Math.floor(shownStart / 60), startM: shownStart % 60, startMin: shownStart, durationMin: dur, score: 100 }]);
  }
  // Now the proposal's own travel replaces the previous stop's way out —
  // except its drive home when going via home, which still happens.
  _bspReplaceLegsOf(predS, homePlan.home);
  BOOKING_ROUTE.shownMode = homePlan.available ? (homePlan.home ? 'home' : 'direct') : null;

  const toSub = addrSuburb(toKey) || 'next stop';
  const fmt = (m) => (typeof fmtTime === 'function') ? fmtTime(Math.floor(m / 60), m % 60) : _hhmm(m);
  const tight = shownStart < plan.earliestStartMin;
  if (col && plan.travelMin > 0) {
    const small = plan.travelMin < 20;
    _previewLeg(col, plan.travelStartMin, plan.travelEndMin, tight ? 'tight' : '',
      '<span class="t-ico">' + (tight ? 'Tight' : 'Travel') + '</span><span class="t-label">' + plan.travelMin + ' min' +
      (small ? '' : ' · ' + esc(pred.suburb || 'previous') + ' → ' + esc(toSub)) + '</span>',
      'Travel ' + plan.travelMin + ' min · ' + (pred.suburb || 'previous stop') + ' → ' + toSub + (plan.bufferMin ? ' (+' + plan.bufferMin + ' min buffer)' : ''));
  } else if (col) {
    _previewLeg(col, legTop, legTop, '', '<span class="t-ico">Travel</span><span class="t-label">no drive · same place</span>');
  }
  // The drive home is never deleted, only moved: if the proposal becomes the
  // day's last stop, the day now ends with a drive home from it.
  if (col) _bspPreviewHomeAfter(col, day, predS, toKey, shownStart + dur);

  const parts = [];
  if (pred.viaHome) parts.push('Home after ' + prevName + ' (' + (homePlan.toBase || 0) + ' min)');
  parts.push(plan.travelMin > 0 ? '<strong>' + plan.travelMin + ' min</strong> drive from ' + fromName : 'Same place as ' + fromName + ' — no drive');
  if (plan.bufferMin) parts.push('+' + plan.bufferMin + ' min buffer');
  parts.push('earliest start <strong>' + fmt(plan.earliestStartMin) + '</strong>');
  let kind = 'ok';
  const notes = [];
  // A clamp is remembered until the clinician picks another start, so the
  // follow-up repaint (which now sees the clamped time) keeps the warning.
  if (pred.explicit && plan.clampedFromMin != null) BOOKING_ROUTE.lastClamp = { from: plan.clampedFromMin, to: plan.startMin };
  const clamp = pred.explicit && BOOKING_ROUTE.lastClamp && BOOKING_ROUTE.lastClamp.to === shownStart ? BOOKING_ROUTE.lastClamp : null;
  if (clamp) { kind = 'warn'; notes.push(fmt(clamp.from) + ' is earlier than the drive allows — moved to ' + fmt(clamp.to) + '.'); }
  if (plan.movedForConflicts.length) notes.push('Moved to ' + fmt(plan.startMin) + ': ' + plan.movedForConflicts.map(b => esc(b.label)).join(', ') + ' is already booked then.');
  if (plan.conflicts.length) { kind = 'warn'; notes.push('Overlaps ' + plan.conflicts.map(b => esc(b.label)).join(', ') + '.'); }
  if (!pred.explicit && tight) {
    // Too early for the drive (6 Oct 2026): say when it CAN start — the first
    // free slot after the drive, for the way chosen above. Flipping Direct ⇄
    // Via home re-runs this, so the suggested time follows the switch.
    kind = 'warn';
    const best = planNextStop({ prevEndMin: pred.endMin, travelMin: route.durationMin, bufferMin: routeBufferMin(), durationMin: dur,
      desiredStartMin: null, busy, dayEndMin: (typeof END_H !== 'undefined' ? END_H : 24) * 60 });
    BOOKING_ROUTE.suggestedStartMin = best.fits ? best.startMin : null;
    notes.push('Not enough time to get here from ' + fromName + '.' + (best.fits
      ? ' Earliest you can see ' + esc(_bspClientName()) + ': <strong>' + fmt(best.startMin) + '</strong>' +
        (homePlan.available ? ' (' + (homePlan.home ? 'via home' : 'direct') + ')' : '') + '. ' +
        '<button type="button" class="bsp-route-btn" data-route="earliest">Move to ' + fmt(best.startMin) + '</button>'
      : ' There is no free time left on this day after the drive.'));
  }
  if (!plan.fits) { kind = 'warn'; notes.push('No free slot left on this day after the drive.'); }
  setBspRouteStatus(kind, parts.join(' · ') + switchBtn + (notes.length ? '<div class="bsp-route-note">' + notes.join(' ') + '</div>' : ''));
}

function _bspClientName() {
  const p = (typeof BOOKING_STATE !== 'undefined' && BOOKING_STATE && BOOKING_STATE.selectedPatient) || null;
  return (p && ([p.first, p.last].filter(Boolean).join(' ') || p.name)) || 'this client';
}
/* Where the previous stop's own legs end (its drive home / onward), or null. */
function _bspPredLegsEnd(day, predS) {
  if (!predS || !predS.id || typeof DAY_SEGMENTS === 'undefined') return null;
  const segs = DAY_SEGMENTS.get(day) || [];
  const ends = segs.filter(x => x.kind !== 'gap' && x.fromSessionId === predS.id).map(x => x.endMin);
  return ends.length ? Math.max.apply(null, ends) : null;
}
/* Hide the previous stop's legs the proposal replaces. Via home, its drive
   home (the day's end leg, or the return of a via-home gap) stays. */
function _bspReplaceLegsOf(predS, viaHome) {
  if (!predS || !predS.id) return;
  document.querySelectorAll('.travel-overlay[data-from-session="' + String(predS.id).replace(/"/g, '') + '"]:not(.preview)').forEach(el => {
    const homeLeg = el.classList.contains('end') || el.dataset.via === 'home-return';
    if (!(viaHome && homeLeg)) el.classList.add('suppressed');
  });
}
/* The day's drive home, moved to after the proposal when it is the last
   stop. Where the day ends is what the previous stop said (the new session
   inherits it on Create), else the day's base. A cached route or the table
   estimate — a preview never spends a Routes call; Create routes it for real. */
function _bspPreviewHomeAfter(col, day, predS, toKey, endMin) {
  const later = sessionsForDay(day).some(x => x !== predS && !isTravelBlock(x) && isPhysicalStop(x) && sessionEndMin(x) > endMin);
  if (later) return;
  const endPt = resolveTravelPoint(predS ? sessionTravelOverride(predS, 'after') : null, day) || dayAnchorBase(day);
  const endKey = endPt && !endPt.remote && !endPt.unset ? (endPt.addr || endPt.suburb) : null;
  if (!endKey || canonAddr(endKey) === canonAddr(toKey)) return;
  const cached = ROUTE_CACHE.get(routeKey(toKey, endKey, 'driving'));
  const min = isFresh(cached) ? cached.durationMin : estimateTravelMinFromTable(toKey, endKey);
  if (!(min > 0)) return;
  const from = addrSuburb(toKey) || 'this stop', to = endPt.suburb || endPt.label || 'Home';
  _previewLeg(col, endMin, endMin + min, 'home-after',
    '<span class="t-ico">Home</span><span class="t-label">' + min + ' min · ' + _tpEsc(from) + ' → ' + _tpEsc(to) + '</span>',
    'Drive home after this appointment ≈ ' + min + ' min');
}

/* For the proposal: go home between the last stop and it? { mode, available,
   home, baseKey, base, toBase, fromBase }. Estimates decide (no routing call);
   the leg shown is still routed for real. */
function _bspHomePlan(day, pred, toKey, startMin) {
  const mode = BOOKING_ROUTE.viaMode || 'auto';
  const base = dayAnchorBase(day);
  const baseKey = base && !base.unset && !base.remote ? (base.addr || base.suburb) : null;
  const out = { mode, available: false, home: false, baseKey, base, toBase: 0, fromBase: 0 };
  if (!baseKey || !pred || !pred.fromKey || !toKey) return out;
  if (canonAddr(baseKey) === canonAddr(pred.fromKey) || canonAddr(baseKey) === canonAddr(toKey)) return out;
  out.available = true;
  out.toBase = travelMinutes(pred.fromKey, baseKey);
  out.fromBase = travelMinutes(baseKey, toKey);
  if (mode === 'home') out.home = true;
  else if (mode === 'auto' && !pred.explicit) out.home = (startMin - pred.endMin) >= out.toBase + out.fromBase + TRAVEL_HOME_MIN_STAY;
  return out;
}
/* After Create: an explicit "go direct" / "go home" becomes the previous
   stop's choice for the gap, so the calendar keeps showing what was booked. */
function bspCommitBetweenChoice() {
  // What the preview SHOWED is what gets kept — the clinician's pick, or the
  // suggestion they saw — so the calendar never redraws the gap differently.
  const mode = BOOKING_ROUTE.viaMode !== 'auto' ? BOOKING_ROUTE.viaMode : BOOKING_ROUTE.shownMode;
  const id = BOOKING_ROUTE.lastPredId;
  BOOKING_ROUTE.viaMode = 'auto';
  BOOKING_ROUTE.shownMode = null;
  if ((mode === 'direct' || mode === 'home') && id) return setBetweenTravel(id, mode);
  return null;
}

/* Retry / manual-timing buttons in the status line. */
document.addEventListener('click', e => {
  const b = e.target && e.target.closest && e.target.closest('[data-route]');
  if (!b || !b.closest('#bsp-route-status')) return;
  if (b.dataset.route === 'retry') { BOOKING_ROUTE.manualTiming = false; runBspRoutePreview({ fresh: true }); }
  if (b.dataset.route === 'manual') { BOOKING_ROUTE.manualTiming = true; runBspRoutePreview(); }
  if (b.dataset.route === 'direct' || b.dataset.route === 'home') { BOOKING_ROUTE.viaMode = b.dataset.route; runBspRoutePreview(); }
  if (b.dataset.route === 'earliest' && BOOKING_ROUTE.suggestedStartMin != null) {
    // Same path as typing the time: the panel, the proposal and the end follow.
    const el = document.getElementById('bsp-start');
    if (el) {
      el.value = _hhmm(BOOKING_ROUTE.suggestedStartMin);
      if (typeof window.bspOnStartChange === 'function') window.bspOnStartChange();
      else el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
});

// Hook the panel: every timing / location change re-runs the preview.
(function installBspTravelPreview() {
  const wrap = (name, after) => {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__travelWrapped) return;
    const w = function () { const out = orig.apply(this, arguments); try { after(); } catch (e) { /* preview only */ } return out; };
    w.__travelWrapped = true; window[name] = w;
  };
  const run = () => setTimeout(bspTravelPreview, 0);
  wrap('_bspUpdateLivePreview', run);
  wrap('clearPreviewBlocks', clearBspTravelPreview);
  // A clinician-chosen start (typed, or a dragged proposal) is kept if the drive allows it.
  wrap('bspOnStartChange', () => { BOOKING_ROUTE.manualStart = true; BOOKING_ROUTE.lastClamp = null; });
  document.addEventListener('input',  e => { if (e.target && e.target.id === 'bsp-location') run(); });
  document.addEventListener('change', e => { if (e.target && (e.target.id === 'bsp-location' || e.target.id === 'bsp-location-unsure')) run(); });
})();

/* After a stop is booked: the new session inherits the predecessor's `after`
   (where the day was going to end), so the chain forms without another step.
   The predecessor keeps its own answer — if the stop is later cancelled, the
   day closes back to where it used to. */
async function applyTravelChainAfterBooking(newDbId, ctx) {
  if (!newDbId || !ctx) return;
  const pred = (ctx.sessionId && window.SESSIONS ? window.SESSIONS[ctx.sessionId] : null) || _sessionByDbId(ctx.dbId);
  const inherit = pred ? sessionTravelOverride(pred, 'after') : null;
  if (!inherit) return; // the day default carries over on its own
  try {
    await fetch('/api/events/' + encodeURIComponent(newDbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: null, after: inherit }),
    });
  } catch (e) { /* best effort — the default is the same base most days */ }
}

/* PURE — free-slot search for a travel leg of `len` minutes (4 Oct 2026).
   A leg sits as CLOSE to its appointment as it can: a 10-minute drive into a
   12:00 session after an 11:30 one is 11:50–12:00, not the whole half hour.
   `busy` is [{ startMin, endMin }] — other events the leg must not cover (a
   telehealth taken in the gap). Returns the slot, or null if none fits. */
function latestFreeSlot(endBy, floorMin, len, busy) {
  let end = endBy;
  for (let guard = 0; guard < 100; guard++) {
    const start = end - len;
    if (floorMin != null && start < floorMin) return null;
    const hit = (busy || []).filter(b => b.startMin < end && b.endMin > start);
    if (!hit.length) return { startMin: start, endMin: end };
    end = Math.min.apply(null, hit.map(b => b.startMin));
  }
  return null;
}
function earliestFreeSlot(startAt, len, busy, ceilMin) {
  let start = startAt;
  for (let guard = 0; guard < 100; guard++) {
    if (ceilMin != null && start + len > ceilMin) return null;
    const hit = (busy || []).filter(b => b.startMin < start + len && b.endMin > start);
    if (!hit.length) return { startMin: start, endMin: start + len };
    start = Math.max.apply(null, hit.map(b => b.endMin));
  }
  return null;
}

/* PURE — when a travel leg sits on the calendar. The leg itself (who, from
   where, to where, how long) is computed; only its time is the therapist's.
     arrival legs ('start', 'between'): auto = arrive as the next stop starts
       — the latest free slot before it, never before the previous physical
       stop ends (floorMin); offsetMin is minutes from the next stop's START.
     the leg home ('end'): auto = leave as the last physical stop ends — the
       earliest free slot after it; offsetMin is minutes from its END.
   `busy` are the other events the automatic time steps around (a telehealth
   in the gap); when nothing fits the leg hugs its appointment and is tight.
   A dragged leg keeps its offset — it moves with its appointment and never
   snaps back to the automatic time. */
function placeTravelLeg(input) {
  const i = input || {};
  const travel = Math.max(0, Math.round(Number(i.travelMin) || 0));
  const anchor = Number(i.anchorMin) || 0;
  const manual = i.offsetMin != null && Number.isFinite(Number(i.offsetMin));
  const busy = i.busy || [];
  let start, tight = false;
  if (i.kind === 'end') {
    if (manual) start = anchor + Number(i.offsetMin);
    else { const slot = earliestFreeSlot(anchor, travel, busy, 24 * 60); start = slot ? slot.startMin : anchor; }
    tight = start < anchor;                       // leaving before the session ends
  } else if (manual) {
    start = anchor + Number(i.offsetMin);
    tight = start + travel > anchor || (i.floorMin != null && start < i.floorMin);
  } else {
    const slot = latestFreeSlot(anchor, i.floorMin, travel, busy);
    if (slot) start = slot.startMin;
    else {
      // No free slot that long: hug the appointment, flagged.
      start = anchor - travel;
      if (i.floorMin != null && start < i.floorMin) start = i.floorMin;
      tight = true;
    }
  }
  return { startMin: start, endMin: start + travel, travelMin: travel, moved: manual, tight };
}

/* Between two physical stops: drive straight to the next client, or go home
   in between (5 Oct 2026)? Exactly those two options (6 Oct 2026): `mode`
   is always 'direct' or 'home'. The session's own choice wins (travel.next);
   with none, the SUGGESTION is home whenever the drive home, a stay of
   TRAVEL_HOME_MIN_STAY minutes and the drive out all fit in the gap
   (`auto` = true marks it as the suggestion, not a third option). The same
   rule bills travel (backend/billing/day-route.js viaBase), so the calendar
   shows what is invoiced. Returns { mode, auto, home|null, toBase, fromBase,
   homeAvailable }. */
const TRAVEL_HOME_MIN_STAY = 30;
function betweenTravelPlan(curr, next, base) {
  const choice = curr && curr.travel && (curr.travel.next === 'direct' || curr.travel.next === 'home') ? curr.travel.next : null;
  const out = { mode: 'direct', auto: !choice, home: null, toBase: 0, fromBase: 0, homeAvailable: false,
                place: null, toPlace: 0, fromPlace: 0, placeAvailable: false };
  const fromKey = locTravelKey(sessionLocation(curr)), toKey = locTravelKey(sessionLocation(next));
  // "Go Somewhere Else" (6 Oct 2026): the place saved as this session's
  // "after" is where the therapist goes next — between two sessions too, not
  // only at the end of the day. It is the way unless Direct / Home has been
  // chosen since (Go Somewhere Else clears that choice when it is saved).
  const placeSpec = curr ? sessionTravelOverride(curr, 'after') : null;
  const place = placeSpec && placeSpec.purpose === 'elsewhere' ? resolveTravelPoint(placeSpec, curr.day) : null;
  const placeKey = place ? (place.addr || place.suburb) : null;
  if (place && fromKey && toKey && placeKey) {
    const toPlace = canonAddr(placeKey) === canonAddr(fromKey) ? 0 : travelMinutes(fromKey, placeKey);
    const fromPlace = canonAddr(placeKey) === canonAddr(toKey) ? 0 : travelMinutes(placeKey, toKey);
    out.placeAvailable = true;
    if (!choice) {
      Object.assign(out, { mode: 'elsewhere', auto: false, place: Object.assign({}, place), toPlace, fromPlace });
      // Home stays offered as the other way, so the switch can still flip.
      const bk = base && !base.unset && !base.remote ? (base.addr || base.suburb) : null;
      out.homeAvailable = !!(bk && canonAddr(bk) !== canonAddr(fromKey) && canonAddr(bk) !== canonAddr(toKey));
      return out;
    }
  }
  const baseKey = base && !base.unset && !base.remote ? (base.addr || base.suburb) : null;
  if (!fromKey || !toKey || !baseKey) return out;
  if (canonAddr(baseKey) === canonAddr(fromKey) || canonAddr(baseKey) === canonAddr(toKey)) return out;
  out.homeAvailable = true;
  const toBase = travelMinutes(fromKey, baseKey), fromBase = travelMinutes(baseKey, toKey);
  if (!(toBase > 0) || !(fromBase > 0)) return out;
  const gap = sessionStartMin(next) - sessionEndMin(curr);
  const goHome = choice === 'home' || (!choice && gap >= toBase + fromBase + TRAVEL_HOME_MIN_STAY);
  if (goHome) Object.assign(out, { mode: 'home', home: Object.assign({}, base, { baseId: base.baseId || null }), toBase, fromBase });
  return out;
}
/* Save the choice for the gap after this session. mode: 'direct' | 'home' | null (automatic). */
async function setBetweenTravel(sessionId, mode) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s || !s.dbId) { showToast('Not saved', 'This block has no saved appointment behind it yet.'); return false; }
  const prev = Object.assign({}, s.travel || {});
  const next = Object.assign({}, prev);
  if (mode) next.next = mode; else delete next.next;
  // A moved return leg belonged to the old plan; start the new one clean.
  delete next.afterOffsetMin;
  s.travel = next;
  if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
  try {
    const r = await fetch('/api/events/' + encodeURIComponent(s.dbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ next: mode || null, afterOffsetMin: null }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || ('HTTP ' + r.status));
    registerTravelUndo(s, prev, mode === 'direct' ? 'Go straight on' : mode === 'home' ? 'Home in between' : 'Travel between sessions');
    return true;
  } catch (e) {
    s.travel = prev;
    if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
    showToast('Could not change the travel plan', e.message);
    return false;
  }
}

function computeDayTravelSegments(day) {
  const sessions = sessionsForDay(day).filter(s => !isTravelBlock(s));
  const segs = [];
  const workS = (typeof WORK_S !== 'undefined' ? WORK_S : 8) * 60;
  const workE = (typeof WORK_E !== 'undefined' ? WORK_E : 18) * 60;
  if (!sessions.length) {
    // Empty day: the whole working window is one free window — the old
    // between-sessions-only algorithm reported ZERO free time on free days.
    segs.push({ day, kind: 'gap', fromLoc: {}, toLoc: {},
      startMin: workS, endMin: workE, travelMin: 0, freeMin: workE - workS,
      fromSessionId: null, toSessionId: null, anchorBaseId: null, cacheKey: '' });
    DAY_SEGMENTS.set(day, segs); return segs;
  }

  const base = dayAnchorBase(day); // base for start/end of day (from Mon-Fri dropdown)
  const offsetOf = (s, side) => {
    const v = s && s.travel ? s.travel[side === 'before' ? 'beforeOffsetMin' : 'afterOffsetMin'] : null;
    return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
  };
  const locOf = (l) => ({ suburb: l.suburb || null, label: l.label, region: l.region, address: l.address || l.addr || null, addr: l.address || l.addr || null });

  // The route: only events that put the therapist somewhere. An event with
  // no address (telehealth, a remote MDT, emails…) leaves them where they
  // were, so travel runs between the physical stops either side of it.
  const stops = sessions.filter(isPhysicalStop);
  // What an automatic leg steps around: every other event on the day.
  const busyFor = (...skip) => sessions.filter(x => skip.indexOf(x) < 0)
    .map(x => ({ startMin: sessionStartMin(x), endMin: sessionEndMin(x) }));

  if (stops.length) {
    // --- start: base → first physical stop ---
    // The first stop may say where the day starts (travel.before).
    const first = stops[0];
    const firstLoc = sessionLocation(first);
    const startPt  = resolveTravelPoint(sessionTravelOverride(first, 'before'), day) || base;
    const baseKey  = startPt.addr || startPt.suburb;
    const firstKey = locTravelKey(firstLoc);
    if (!startPt.remote && baseKey && firstKey && baseKey !== firstKey) {
      const travel = travelMinutes(baseKey, firstKey);
      if (travel > 0) {
        const at = placeTravelLeg({ kind: 'start', anchorMin: sessionStartMin(first), travelMin: travel, offsetMin: offsetOf(first, 'before'), busy: busyFor(first) });
        segs.push({
          day, kind: 'start',
          fromLoc: { suburb: startPt.suburb, label: startPt.label, region: startPt.region, address: startPt.addr || null, addr: startPt.addr || null },
          toLoc:   locOf(firstLoc),
          startMin: Math.max(0, at.startMin), endMin: at.endMin,
          travelMin: travel, freeMin: 0, moved: at.moved, tight: at.tight,
          autoStartMin: at.moved ? placeTravelLeg({ kind: 'start', anchorMin: sessionStartMin(first), travelMin: travel, busy: busyFor(first) }).startMin : at.startMin,
          fromSessionId: null, toSessionId: first.id,
          ownerSessionId: first.id, ownerSide: 'before',
          anchorBaseId: startPt.baseId || calendarWeekLocations()[day] || 'office',
          overridden: !!sessionTravelOverride(first, 'before'),
          cacheKey: routeKey(baseKey, firstKey, 'driving')
        });
      }
    }

    // --- between physical stops (non-physical events in between are skipped) ---
    // Each gap is either a direct drive or a trip home in between
    // (betweenTravelPlan): two legs, curr → home and home → next.
    for (let i = 0; i < stops.length - 1; i++) {
      const curr = stops[i], next = stops[i + 1];
      const from = sessionLocation(curr), to = sessionLocation(next);
      const fromKey = locTravelKey(from), toKey = locTravelKey(to);
      const plan = betweenTravelPlan(curr, next, base);
      if (plan.home || plan.place) {
        // Two legs through a stop: home (via 'home-return' / 'home-out') or
        // the place saved with Go Somewhere Else ('place-in' / 'place-out').
        const atPlace = !plan.home;
        const hb = plan.home || plan.place, homeLoc = { suburb: hb.suburb, label: hb.label, region: hb.region, address: hb.addr || null, addr: hb.addr || null };
        const toMin = atPlace ? plan.toPlace : plan.toBase, fromMin = atPlace ? plan.fromPlace : plan.fromBase;
        const ret = placeTravelLeg({ kind: 'end', anchorMin: sessionEndMin(curr), travelMin: toMin, offsetMin: offsetOf(curr, 'after'), busy: busyFor(curr, next) });
        const retAuto = ret.moved ? placeTravelLeg({ kind: 'end', anchorMin: sessionEndMin(curr), travelMin: toMin, busy: busyFor(curr, next) }).startMin : ret.startMin;
        if (toMin > 0) segs.push({
          day, kind: 'between', via: atPlace ? 'place-in' : 'home-return', plan: plan.mode, auto: plan.auto, homeAvailable: plan.homeAvailable,
          fromLoc: locOf(from), toLoc: homeLoc,
          startMin: ret.startMin, endMin: ret.endMin, travelMin: toMin, freeMin: 0,
          moved: ret.moved, tight: ret.tight || ret.endMin > sessionStartMin(next), autoStartMin: retAuto,
          fromSessionId: curr.id, toSessionId: null, gapFromSessionId: curr.id, gapToSessionId: next.id,
          ownerSessionId: curr.id, ownerSide: 'after', anchorBaseId: hb.baseId || calendarWeekLocations()[day] || null,
          cacheKey: routeKey(fromKey, hb.addr || hb.suburb, 'driving')
        });
        const out = placeTravelLeg({ kind: 'between', anchorMin: sessionStartMin(next), floorMin: ret.endMin, travelMin: fromMin, offsetMin: offsetOf(next, 'before'), busy: busyFor(curr, next) });
        const outAuto = out.moved ? placeTravelLeg({ kind: 'between', anchorMin: sessionStartMin(next), floorMin: ret.endMin, travelMin: fromMin, busy: busyFor(curr, next) }).startMin : out.startMin;
        if (fromMin > 0) segs.push({
          day, kind: 'between', via: atPlace ? 'place-out' : 'home-out', plan: plan.mode, auto: plan.auto,
          fromLoc: homeLoc, toLoc: locOf(to),
          startMin: out.startMin, endMin: out.endMin, travelMin: fromMin, freeMin: 0,
          moved: out.moved, tight: out.tight, autoStartMin: outAuto,
          fromSessionId: null, toSessionId: next.id, gapFromSessionId: curr.id, gapToSessionId: next.id,
          ownerSessionId: next.id, ownerSide: 'before', anchorBaseId: hb.baseId || calendarWeekLocations()[day] || null,
          cacheKey: routeKey(hb.addr || hb.suburb, toKey, 'driving')
        });
        continue;
      }
      const travel  = travelMinutes(fromKey, toKey);
      if (travel <= 0) continue;                    // same place — no drive
      const at = placeTravelLeg({ kind: 'between', anchorMin: sessionStartMin(next), floorMin: sessionEndMin(curr),
                                  travelMin: travel, offsetMin: offsetOf(next, 'before'), busy: busyFor(curr, next) });
      segs.push({
        day, kind: 'between', via: null, plan: plan.mode, auto: plan.auto, homeAvailable: plan.homeAvailable,
        fromLoc: locOf(from), toLoc: locOf(to),
        startMin: at.startMin, endMin: at.endMin,
        travelMin: travel, freeMin: 0, moved: at.moved, tight: at.tight,
        autoStartMin: at.moved ? placeTravelLeg({ kind: 'between', anchorMin: sessionStartMin(next), floorMin: sessionEndMin(curr), travelMin: travel, busy: busyFor(curr, next) }).startMin : at.startMin,
        fromSessionId: curr.id, toSessionId: next.id, gapFromSessionId: curr.id, gapToSessionId: next.id,
        ownerSessionId: next.id, ownerSide: 'before',
        anchorBaseId: null,
        cacheKey: routeKey(fromKey, toKey, 'driving')
      });
    }

    // --- end: last physical stop → base ---
    const last = stops[stops.length - 1];
    const lastLoc = sessionLocation(last);
    const lastKey = locTravelKey(lastLoc);
    // The last stop may say where the day ends (travel.after).
    const endPt = resolveTravelPoint(sessionTravelOverride(last, 'after'), day) || base;
    const baseKeyEnd = endPt.addr || endPt.suburb;
    if (!endPt.remote && baseKeyEnd && lastKey && baseKeyEnd !== lastKey) {
      const travel = travelMinutes(lastKey, baseKeyEnd);
      if (travel > 0) {
        const at = placeTravelLeg({ kind: 'end', anchorMin: sessionEndMin(last), travelMin: travel, offsetMin: offsetOf(last, 'after'), busy: busyFor(last) });
        segs.push({
          day, kind: 'end',
          fromLoc: locOf(lastLoc),
          toLoc:   { suburb: endPt.suburb, label: endPt.label, region: endPt.region, address: endPt.addr || null, addr: endPt.addr || null },
          startMin: at.startMin, endMin: at.endMin,
          travelMin: travel, freeMin: 0, moved: at.moved, tight: at.tight,
          autoStartMin: at.moved ? placeTravelLeg({ kind: 'end', anchorMin: sessionEndMin(last), travelMin: travel, busy: busyFor(last) }).startMin : at.startMin,
          fromSessionId: last.id, toSessionId: null,
          ownerSessionId: last.id, ownerSide: 'after',
          anchorBaseId: endPt.baseId || calendarWeekLocations()[day] || 'office',
          overridden: !!sessionTravelOverride(last, 'after'),
          cacheKey: routeKey(lastKey, baseKeyEnd, 'driving')
        });
      }
    }
  }

  // --- free windows (Snapshot report, idle-slot suggestions) ---
  // Time not covered by any event or travel leg: before the day's first
  // commitment, between consecutive commitments, after the last.
  const legs = segs.slice();
  const busy = sessions.map(s => [sessionStartMin(s), sessionEndMin(s), s])
    .concat(legs.map(l => [l.startMin, l.endMin, null]))
    .sort((x, y) => x[0] - y[0]);
  const last0 = sessions[sessions.length - 1];
  let cursor = workS, prevSession = null;
  busy.forEach(([st, en, s]) => {
    if (st - cursor >= 45) {
      segs.push({ day, kind: 'gap', fromLoc: prevSession ? sessionLocation(prevSession) : {}, toLoc: s ? sessionLocation(s) : {},
        startMin: cursor, endMin: st, travelMin: 0, freeMin: st - cursor,
        fromSessionId: prevSession ? prevSession.id : null, toSessionId: s ? s.id : null, anchorBaseId: null, cacheKey: '' });
    }
    if (en > cursor) cursor = en;
    if (s) prevSession = s;
  });
  if (workE - cursor >= 45) {
    segs.push({ day, kind: 'gap', fromLoc: sessionLocation(last0), toLoc: {},
      startMin: cursor, endMin: workE, travelMin: 0, freeMin: workE - cursor,
      fromSessionId: last0.id, toSessionId: null, anchorBaseId: null, cacheKey: '' });
  }

  DAY_SEGMENTS.set(day, segs);
  return segs;
}

/* ---------- Travel + gap overlay renderer ---------- */
function clearDayOverlays(day) {
  const col = document.getElementById('day-' + day);
  if (!col) return;
  col.querySelectorAll('.travel-overlay').forEach(el => el.remove());
}
function refreshDayOverlays(day) {
  const col = document.getElementById('day-' + day);
  if (!col) return;
  clearDayOverlays(day);
  const segs = computeDayTravelSegments(day);
  segs.forEach(seg => renderSegmentOverlay(col, seg));
  decorateTravelBadges(day, segs);
  scheduleTravelOutlookSync(day, segs);
  // Clearing the column also removed Smart Booking's proposed travel: put it
  // back (from cache — no new routing call) while the panel is open.
  if (typeof _scheduleBspRepaint === 'function') _scheduleBspRepaint();
}
let _bspRepaintTimer = null;
function _scheduleBspRepaint() {
  const panel = document.getElementById('booking-side-panel');
  if (!panel || !panel.classList || !panel.classList.contains('open')) return;
  clearTimeout(_bspRepaintTimer);
  _bspRepaintTimer = setTimeout(() => { _bspRepaintTimer = null; runBspRoutePreview({ cachedOnly: true }); }, 0);
}

/* Segment-aware renderer. Dispatches by kind so start/between/end/gap
   share a single entry point and the renderer can't drift from the
   segment store. */
function renderSegmentOverlay(col, seg) {
  if (seg.kind === 'gap') {
    // FREE-TIME/GAP OVERLAY REMOVED (2026-08-09, Antony's directive): the
    // green hatched "Free window / Idle gap" bands and cards made the calendar
    // look crowded. Gap SEGMENTS are still computed — the Snapshot report and
    // idle-slot suggestion engine read them from DAY_SEGMENTS. Travel legs are
    // their own segments now, so a gap never draws a drive.
    return;
  }
  // Travel kinds: 'start' | 'between' | 'end'
  // Keep the block inside the day: a long drive home after a late session ran
  // past midnight, stretched the column and left a white band under the grid
  // (29 Sep 2026). The label still carries the full travel time.
  const dayStart = START_H * 60, dayEnd = END_H * 60;
  if (seg.startMin < dayStart || seg.endMin > dayEnd) {
    seg = Object.assign({}, seg, { startMin: Math.max(seg.startMin, dayStart), endMin: Math.min(seg.endMin, dayEnd) });
    if (seg.endMin <= seg.startMin) return;
  }
  const el = document.createElement('div');
  el.className = 'travel-overlay ' + seg.kind + (seg.moved ? ' moved' : '') + (seg.tight ? ' tight' : '');
  el.style.top    = tToY(Math.floor(seg.startMin/60), seg.startMin%60) + 'px';
  // Floor for readability, but NEVER cross the slot boundary — a sub-15-min
  // leg renders as a thin strip inside its own gap instead of overrunning
  // the neighbouring session tile.
  const segSlotPx = (seg.endMin - seg.startMin) / 60 * HOUR_PX;
  el.style.height = Math.min(Math.max(12, segSlotPx - 4), Math.max(4, segSlotPx - 2)) + 'px';
  if (seg.tight) el.style.borderLeftColor = '#9c3322';
  const overlaps = (typeof SESSIONS !== 'undefined') && sessionsForDay(seg.day).some(x => !isTravelBlock(x) && sessionStartMin(x) < seg.endMin && sessionEndMin(x) > seg.startMin);
  if (overlaps) el.classList.add('overlaps');
  const icon = seg.kind === 'start' ? 'Start' : seg.kind === 'end' ? 'End'
    : seg.via === 'home-return' ? 'Home' : seg.via === 'home-out' ? 'From home'
    : seg.via === 'place-in' ? 'To ' + (seg.toLoc.label || 'stop') : seg.via === 'place-out' ? 'From ' + (seg.fromLoc.label || 'stop') : 'Travel';
  const from = seg.fromLoc.label || seg.fromLoc.suburb || 'Base';
  const to   = seg.toLoc.label   || seg.toLoc.suburb   || 'Base';
  el.innerHTML = `<span class="t-ico" style="font-size: 10px; font-weight: 600; opacity: 0.7;">${icon}</span>
    <span class="t-label">${seg.travelMin} min · ${_tpEsc(seg.fromLoc.suburb || from)} → ${_tpEsc(seg.toLoc.suburb || to)}</span>`;
  const kindLabel = seg.kind === 'start' ? 'Morning drive from' :
                    seg.kind === 'end'   ? 'Evening drive to'    :
                                           'Travel';
  const owner = seg.ownerSessionId && window.SESSIONS ? window.SESSIONS[seg.ownerSessionId] : null;
  const canMove = !!(owner && owner.dbId);
  el.title = `${kindLabel} ${seg.fromLoc.suburb || from} → ${seg.toLoc.suburb || to} ≈ ${seg.travelMin} min.` +
    (seg.moved ? ' Moved by you.' : '') + (seg.tight ? ' Tight — overlaps the appointment.' : '') +
    (canMove ? ' Drag to change when you travel. Click for travel details.' : ' Click for travel details.');
  el.dataset.segJson = JSON.stringify({
    kind: seg.kind, travelMin: seg.travelMin, startMin: seg.startMin, endMin: seg.endMin,
    fromSuburb: seg.fromLoc.suburb || from, toSuburb: seg.toLoc.suburb || to,
    fromLabel: seg.fromLoc.label || from, toLabel: seg.toLoc.label || to,
    fromAddr: seg.fromLoc.addr || '', toAddr: seg.toLoc.addr || ''
  });
  el.dataset.fromSession = seg.fromSessionId || '';
  el.dataset.toSession   = seg.toSessionId   || '';
  el.dataset.ownerSession = seg.ownerSessionId || '';
  el.dataset.ownerSide    = seg.ownerSide || '';
  el.dataset.via          = seg.via || '';
  // The one travel switch (6 Oct 2026): between two clients there are exactly
  // two ways to go, and the leg says which one it is. A click flips it (one
  // Cmd+Z flips it back). It sits on the direct leg, or on the drive home of
  // a via-home gap — one switch per gap.
  const gapFrom = seg.kind === 'between' && seg.via !== 'home-out' && seg.via !== 'place-out' && seg.gapFromSessionId && window.SESSIONS
    ? window.SESSIONS[seg.gapFromSessionId] : null;
  if (gapFrom && gapFrom.dbId && (seg.via === 'home-return' || seg.via === 'place-in' || seg.homeAvailable)) {
    // Via home or via a saved place flips to Direct; Direct flips to home.
    const viaHome = seg.via === 'home-return' || seg.via === 'place-in';
    const viaName = seg.via === 'place-in' ? 'Via ' + (seg.toLoc.label || 'stop') : 'Via home';
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 't-switch';
    sw.textContent = (viaHome ? viaName : 'Direct') + ' ⇄';
    sw.title = viaHome ? 'Going ' + (seg.via === 'place-in' ? 'to ' + (seg.toLoc.label || 'the stop') : 'home') + ' in between. Click to go direct to the next client instead.'
                       : 'Going direct to the next client. Click to go home in between instead.';
    sw.setAttribute('aria-label', sw.title);
    sw.addEventListener('pointerdown', (e) => e.stopPropagation());   // not a leg drag, not a create-drag
    sw.addEventListener('click', (e) => { e.stopPropagation(); setBetweenTravel(gapFrom.id, viaHome ? 'direct' : 'home'); });
    el.appendChild(sw);
  }
  el.onclick = (ev) => {
    ev.stopPropagation();
    if (el.__dragged) { el.__dragged = false; return; } // the end of a drag is not a click
    openTravelPanel(seg);
  };
  if (canMove) attachTravelLegDrag(el, seg);
  col.appendChild(el);
}

/* ---------- Travel legs mirrored to Outlook (5 Oct 2026) ----------
   After a day's legs are drawn, the same set goes to PUT /api/travel/
   outlook-sync, which makes Outlook match: one 'Travel' event per leg,
   moved or removed as the legs change — never duplicated (each leg is keyed
   "<appointment id>|before|after", migration 073). The server refuses a day
   unless this view holds exactly the user's own events, so another
   therapist's calendar or a stale view can never delete anything. Nothing
   goes to Splose. Debounced per day; an unchanged set is not resent. */
const TRAVEL_OUTLOOK_SYNC = { timers: {}, sent: {}, delayMs: 1500 };
function _perthStamp(dateStr, min) {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(min)));
  return dateStr + 'T' + _hhmm(m) + ':00+08:00';
}
/* PURE-ish — the request for a day, or null when there is nothing to say. */
function travelOutlookPayload(day, segs) {
  const date = (typeof DAY_DATES !== 'undefined' && DAY_DATES) ? DAY_DATES[day] : null;
  if (!date || !window.SESSIONS) return null;
  const seen = sessionsForDay(day).map(s => s.dbId).filter(Boolean).map(String);
  const legs = [];
  (segs || []).forEach(seg => {
    if (seg.kind === 'gap' || !seg.ownerSessionId || !(seg.travelMin > 0)) return;
    const owner = window.SESSIONS[seg.ownerSessionId];
    if (!owner || !owner.dbId) return;
    const from = seg.fromLoc.suburb || seg.fromLoc.label || 'previous stop';
    const to = seg.toLoc.suburb || seg.toLoc.label || 'next stop';
    const what = seg.via === 'place-in' ? 'Travel to ' + to : seg.via === 'place-out' ? 'Travel from ' + from
      : seg.via === 'home-return' || (seg.kind === 'end') ? 'Travel home' : seg.via === 'home-out' || seg.kind === 'start' ? 'Travel from home' : 'Travel';
    const start = Math.max(0, seg.startMin), end = Math.min(24 * 60 - 1, seg.endMin);
    if (end <= start) return;
    legs.push({
      key: String(owner.dbId) + '|' + seg.ownerSide,
      start: _perthStamp(date, start), end: _perthStamp(date, end),
      title: what + ' · ' + seg.travelMin + ' min · ' + from + ' → ' + to,
      location: seg.toLoc.address || seg.toLoc.addr || seg.toLoc.suburb || '',
    });
  });
  return { date, legs, seenEventIds: seen };
}
function scheduleTravelOutlookSync(day, segs) {
  if (typeof fetch !== 'function') return;
  clearTimeout(TRAVEL_OUTLOOK_SYNC.timers[day]);
  TRAVEL_OUTLOOK_SYNC.timers[day] = setTimeout(() => runTravelOutlookSync(day, segs), TRAVEL_OUTLOOK_SYNC.delayMs);
}
async function runTravelOutlookSync(day, segs) {
  const payload = travelOutlookPayload(day, segs);
  if (!payload) return null;
  // Past days are history: the server leaves them alone, so don't ask.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Perth' }).format(new Date());
  if (payload.date < today) return null;
  const sig = JSON.stringify(payload);
  if (TRAVEL_OUTLOOK_SYNC.sent[payload.date] === sig) return null;
  try {
    const r = await fetch('/api/travel/outlook-sync', {
      method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const j = await r.json().catch(() => ({}));
    // A refusal (not your day, stale view, Outlook off) is final for this
    // exact set — don't hammer; a changed set is tried again.
    if (r.ok || r.status === 403 || r.status === 409) TRAVEL_OUTLOOK_SYNC.sent[payload.date] = sig;
    return { status: r.status, body: j };
  } catch (e) { return null; }
}

/* ---------- Travel badge on each event (4 Oct 2026) ----------
   Travel is an optional function of an event, not a booking type. A small
   badge on the tile says which of three states the event is in:
     on    travel is linked to it (click: the leg's details)
     here  it has an address but no drive (same place as the stop before)
     add   no address — the therapist stays where they were; click to give
           it an address so travel is routed to it */
const TRAVEL_BADGE_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17h14l-1.5-6.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5z"/><circle cx="7.5" cy="17.5" r="1.5"/><circle cx="16.5" cy="17.5" r="1.5"/></svg>';
function travelBadgeState(s, segs) {
  const legs = (segs || []).filter(x => x.kind !== 'gap' && (x.ownerSessionId === s.id || x.fromSessionId === s.id || x.toSessionId === s.id));
  if (legs.length) {
    const into = legs.find(x => x.toSessionId === s.id) || legs[0];
    return { state: 'on', leg: into, text: 'Travel linked: ' + legs.map(x => x.travelMin + ' min ' + (x.toSessionId === s.id ? 'from ' + (x.fromLoc.suburb || x.fromLoc.label || 'previous stop') : 'to ' + (x.toLoc.suburb || x.toLoc.label || 'next stop'))).join(', ') + '. Click for details.' };
  }
  if (isPhysicalStop(s)) return { state: 'here', text: 'At ' + (sessionLocation(s).address || sessionLocation(s).suburb) + ' — no drive needed (same place as before).' };
  return { state: 'add', text: 'No address — travel treats you as staying where you were.' + (s.dbId ? ' Click to add an address and route travel here.' : '') };
}
function decorateTravelBadges(day, segs) {
  sessionsForDay(day).forEach(s => {
    const el = s.element;
    if (!el || !el.isConnected) return;
    const old = el.querySelector('.travel-badge'); if (old) old.remove();
    if (isTravelBlock(s) || s.type === 'leave' || s.cancelled) return;
    const st = travelBadgeState(s, segs);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'travel-badge tb-' + st.state;
    b.innerHTML = TRAVEL_BADGE_SVG;
    b.title = st.text;
    b.setAttribute('aria-label', st.text);
    // The tile drags and opens on its own events: the badge keeps its clicks.
    ['pointerdown', 'mousedown', 'touchstart'].forEach(t => b.addEventListener(t, e => e.stopPropagation()));
    b.addEventListener('click', async (e) => {
      e.stopPropagation(); e.preventDefault();
      if (st.state === 'on' && st.leg) { openTravelPanel(st.leg); return; }
      if (st.state === 'add' && s.dbId) {
        const ask = typeof portalPrompt === 'function' ? portalPrompt : (m, d) => Promise.resolve(window.prompt(m, d));
        const addr = await ask('Where is this? An address moves you there for travel; leave it empty to stay where you were.', '');
        if (addr && String(addr).trim()) saveSessionAddress(s.id, String(addr).trim());
      }
    });
    el.appendChild(b);
  });
}

/* ---------- Movable travel (4 Oct 2026) ----------
   A leg's TIME is the therapist's; its association (owner appointment,
   client, origin, destination, duration) is computed and never touched. A
   drag stores minutes from the owner's start (arrival) or end (leg home) on
   the owner (custom_metadata.travel.beforeOffsetMin / afterOffsetMin), so
   the leg moves with its appointment, survives reloads, and is never
   duplicated — there is still exactly one leg per owner and side. */
const TRAVEL_DRAG_STEP_MIN = 5;
function travelLegAnchorMin(seg) {
  const owner = seg && seg.ownerSessionId && window.SESSIONS ? window.SESSIONS[seg.ownerSessionId] : null;
  if (!owner) return null;
  return seg.ownerSide === 'after' ? sessionEndMin(owner) : sessionStartMin(owner);
}
/* Save a leg's time. offsetMin null = back to the calculated time. */
async function setTravelTiming(sessionId, side, offsetMin) {
  const s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s || !s.dbId) { showToast('Not saved', 'This block has no saved appointment behind it yet.'); return false; }
  const key = side === 'after' ? 'afterOffsetMin' : 'beforeOffsetMin';
  const prev = Object.assign({}, s.travel || {});
  const next = Object.assign({}, prev);
  if (offsetMin == null) delete next[key]; else next[key] = Math.round(offsetMin);
  s.travel = next;                                   // optimistic: no snap-back while saving
  const hadFocus = document.activeElement && document.activeElement.dataset &&
    document.activeElement.dataset.ownerSession === String(sessionId) && document.activeElement.dataset.ownerSide === side;
  if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
  if (hadFocus) {                                    // keyboard moves keep their place
    const again = document.querySelector('.travel-overlay[data-owner-session="' + String(sessionId).replace(/"/g, '') + '"][data-owner-side="' + side + '"]');
    if (again) again.focus();
  }
  try {
    const r = await fetch('/api/events/' + encodeURIComponent(s.dbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: offsetMin == null ? null : Math.round(offsetMin) }),
    });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error) || ('HTTP ' + r.status));
    registerTravelUndo(s, prev, 'Travel leg moved');
    return true;
  } catch (e) {
    s.travel = prev;
    if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
    showToast('Could not move travel', e.message);
    return false;
  }
}
function _commitLegMove(seg, newStartMin) {
  const anchor = travelLegAnchorMin(seg);
  if (anchor == null) return;
  // Dropped back on the calculated time: forget the manual time.
  const offset = newStartMin === seg.autoStartMin ? null : newStartMin - anchor;
  setTravelTiming(seg.ownerSessionId, seg.ownerSide, offset);
}
function attachTravelLegDrag(el, seg) {
  el.classList.add('movable');
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.setAttribute('aria-label', el.title + ' Arrow keys move it by ' + TRAVEL_DRAG_STEP_MIN + ' minutes.');
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();                             // not the column's create-drag
    drag = { y: e.clientY, top: parseFloat(el.style.top) || 0, moved: false, id: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (_) { /* jsdom */ }
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    el.classList.add('dragging');
    const stepPx = TRAVEL_DRAG_STEP_MIN / 60 * HOUR_PX;
    el.style.top = (drag.top + Math.round(dy / stepPx) * stepPx) + 'px';
  });
  const end = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    el.classList.remove('dragging');
    try { el.releasePointerCapture(d.id); } catch (_) { /* jsdom */ }
    if (!d.moved) return;
    el.__dragged = true;
    const stepPx = TRAVEL_DRAG_STEP_MIN / 60 * HOUR_PX;
    const steps = Math.round((e.clientY - d.y) / stepPx);
    if (steps) _commitLegMove(seg, seg.startMin + steps * TRAVEL_DRAG_STEP_MIN);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', () => { if (drag) { el.style.top = drag.top + 'px'; el.classList.remove('dragging'); drag = null; } });
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    _commitLegMove(seg, seg.startMin + (e.key === 'ArrowUp' ? -1 : 1) * TRAVEL_DRAG_STEP_MIN);
  });
}

function renderTravelOverlay(col, day, curr, next, from, to, gapStart, gapMin, travel) {
  const el = document.createElement('div');
  el.className = 'travel-overlay';
  el.style.top    = tToY(Math.floor(gapStart/60), gapStart%60) + 'px';
  const legacySlotPx = gapMin / 60 * HOUR_PX;
  el.style.height = Math.min(Math.max(12, legacySlotPx - 4), Math.max(4, legacySlotPx - 2)) + 'px';
  const tight = gapMin < travel + 5;
  el.style.borderLeftColor = tight ? '#9c3322' : '#0f7c6c';
  el.innerHTML = `<span class="t-ico" style="font-size: 10px; font-weight: 600; opacity: 0.7;">Travel</span>
    <span class="t-label">${travel} min · ${from.suburb} → ${to.suburb}</span>`;
  el.title = `Google Maps travel ${from.suburb} → ${to.suburb} ≈ ${travel} min. Gap is ${gapMin} min. Click for directions.`;
  el.onclick = (ev) => {
    ev.stopPropagation();
    const url = mapsLink(from.suburb + ' WA', to.suburb + ' WA');
    showToast('Opening Google Maps…', `${from.suburb} → ${to.suburb} · ~${travel} min drive. (Link: ${url.slice(0, 60)}…)`);
    window.open(url, '_blank', 'noopener');
  };
  col.appendChild(el);
}

/* renderGapOverlay REMOVED (2026-08-09): the free-time/gap overlay no longer
   exists — see the note in renderSegmentOverlay. */

function refreshAllOverlays() {
  // Bases or day locations may have changed: drop every session's cached
  // location so home-based blocks re-anchor, then redraw every rendered column.
  Object.values(window.SESSIONS || {}).forEach(s => { if (s) delete s.__loc; });
  ['mon','tue','wed','thu','fri','sat','sun'].forEach(d => { if (document.getElementById('day-' + d)) refreshDayOverlays(d); });
  applyLeaveShading();
}

/* ---------- Leave days ----------
   A day whose work location is "On leave" is shaded on the calendar (a quiet
   hatch on the column, an "On leave" tag in the header) so it reads as
   unavailable at a glance. Nothing is blocked: booking on a leave day asks
   first (confirmBooking). Client reminders around leave come later. */
function isLeaveDay(day) {
  const wk = calendarWeekLocations();
  return !!(wk && wk[day] === 'leave');
}
function applyLeaveShading() {
  ['mon','tue','wed','thu','fri','sat','sun'].forEach(d => {
    const on = isLeaveDay(d);
    const col = document.getElementById('day-' + d);
    if (col) col.classList.toggle('on-leave', on);
    const head = document.querySelector('.cal-head[data-day="' + d + '"]');
    if (head) {
      head.classList.toggle('on-leave', on);
      let tag = head.querySelector('.leave-tag');
      if (on && !tag) { tag = document.createElement('div'); tag.className = 'leave-tag'; tag.textContent = 'On leave'; head.appendChild(tag); }
      if (!on && tag) tag.remove();
    }
  });
  renderDayLocationPickers();
}

/* ---------- Where am I working? — on each day of the calendar (6 Oct 2026) ----------
   A small picker under each weekday's name: the SAME week My Profile › Work
   locations edits (WORK_LOCATION, keyed by the calendar's week), so a change
   in either place shows in the other and both save the same way. My Profile
   stays the place for bulk set-up (whole week, next week, last month). One
   change = one Cmd+Z step. Disabled until the saved week has loaded, so it
   never shows "Not set" for a day that is set. */
function renderDayLocationPickers() {
  if (typeof WL_DAYS === 'undefined' || typeof LOCATIONS === 'undefined') return;
  const loaded = !window.workScheduleLoaded || window.workScheduleLoaded();
  if (typeof rebuildLocationCatalogue === 'function') rebuildLocationCatalogue();
  const wk = loaded ? calendarWeekLocations() : {};
  WL_DAYS.forEach(d => {
    const head = document.querySelector('.cal-head[data-day="' + d + '"]');
    if (!head) return;
    let wrap = head.querySelector('.day-loc-wrap');
    if (!wrap) {
      wrap = document.createElement('label');
      wrap.className = 'day-loc-wrap';
      wrap.innerHTML = '<span class="day-loc-dot"></span><span class="day-loc-text"></span><svg class="day-loc-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      const sel = document.createElement('select');
      sel.className = 'day-loc';
      // The header itself opens Day View; the picker is not that click.
      ['pointerdown', 'mousedown', 'click'].forEach(t => wrap.addEventListener(t, e => e.stopPropagation()));
      sel.addEventListener('change', () => setDayWorkLocation(d, sel.value));
      wrap.appendChild(sel);
      head.appendChild(wrap);
    }
    const sel = wrap.querySelector('select.day-loc');
    const key = wk[d] || '';
    const loc = key ? LOCATIONS[key] : null;
    const dayName = (typeof WL_DAY_LABEL !== 'undefined' && WL_DAY_LABEL[d]) || d;
    sel.innerHTML = (loaded ? '<option value="">Not set</option>' : '<option value="">Loading…</option>') +
      Object.keys(LOCATIONS).filter(k => k !== 'unset').map(k => {
        const v = LOCATIONS[k];
        return '<option value="' + _tpEsc(k) + '"' + (k === key ? ' selected' : '') +
          (v.comingSoon && k !== key ? ' disabled' : '') + '>' + _tpEsc(v.label || k) + '</option>';
      }).join('');
    sel.value = key;
    sel.disabled = !loaded;
    wrap.querySelector('.day-loc-text').textContent = !loaded ? 'Loading…' : loc ? (loc.label || key) : 'Set location';
    wrap.querySelector('.day-loc-dot').style.background = loc && loc.color ? loc.color : '';
    wrap.classList.toggle('unset', loaded && !key);
    wrap.classList.toggle('loading', !loaded);
    wrap.title = 'Where you are working on ' + dayName + ' — the same setting as My Profile › Work locations';
    sel.setAttribute('aria-label', 'Work location, ' + dayName);
  });
}
function setDayWorkLocation(day, key, fromUndo, weekObj) {
  // The undo carries the week it changed, even if the calendar moved on since.
  const wk = weekObj || calendarWeekLocations();
  const prev = wk[day] || '';
  if ((key || '') === prev) return;
  if (key) wk[day] = key; else delete wk[day];
  if (!fromUndo && window.OpalUndo) {
    const dayName = (typeof WL_DAY_LABEL !== 'undefined' && WL_DAY_LABEL[day]) || day;
    window.OpalUndo.register({ group: 'calendar', label: 'Work location — ' + dayName, undo: async () => setDayWorkLocation(day, prev, true, wk) });
  }
  if (typeof renderWorkLocationEditor === 'function') renderWorkLocationEditor();
  if (typeof debouncedSaveWorkSchedule === 'function') debouncedSaveWorkSchedule();
  refreshAllOverlays();   // redraws legs and these pickers
}

function previewAllTravel() {
  // Invalidate cached per-session Splose lookups so edits to bases propagate
  Object.values(SESSIONS).forEach(s => { delete s.__loc; });
  refreshAllOverlays();
  // Count travel legs rendered (the free-time/gap overlay was removed 2026-08-09)
  const legs = document.querySelectorAll('.travel-overlay').length;
  const office = WORK_BASES.office;
  const homesN = (WORK_BASES.homes || []).length;
  const homeSummary = homesN
    ? `${homesN} home base${homesN === 1 ? '' : 's'} (${WORK_BASES.homes.map(h => h.label).join(', ')})`
    : 'no home bases configured';
  showToast('Travel matrix refreshed',
    `${legs} travel leg${legs===1?'':'s'} computed via Google Distance Matrix (sample). Office: ${office.suburb}; ${homeSummary}.`);
}

// ═══════════════════════════════════════════════════════════════
//  TASK #118 — TRAVEL DETAILS PANEL
// ═══════════════════════════════════════════════════════════════

var _travelPanelOpen = false;

function openTravelPanel(seg) {
  if (!seg) return;
  _travelPanelOpen = true;
  document.getElementById('travel-panel-overlay').classList.add('open');
  document.getElementById('travel-panel').classList.add('open');
  _renderTravelPanel(seg);
}

function closeTravelPanel() {
  _travelPanelOpen = false;
  document.getElementById('travel-panel-overlay').classList.remove('open');
  document.getElementById('travel-panel').classList.remove('open');
}

function _renderTravelPanel(seg) {
  var body = document.getElementById('travel-panel-body');
  if (!body) return;

  var from     = seg.fromLoc || {};
  var to       = seg.toLoc   || {};
  var fromSub  = from.suburb || from.label || 'Base';
  var toSub    = to.suburb   || to.label   || 'Destination';
  // Segments carry the street address as `address`; older callers used `addr`.
  var fromAddr = from.address || from.addr || from.formattedAddress || '';
  var toAddr   = to.address   || to.addr   || to.formattedAddress   || '';

  // Determine source type
  var fromSession = seg.fromSessionId ? (window.SESSIONS && window.SESSIONS[seg.fromSessionId]) : null;
  var toSession   = seg.toSessionId   ? (window.SESSIONS && window.SESSIONS[seg.toSessionId])   : null;
  var isOutlook   = (fromSession && isTravelBlock(fromSession)) || (toSession && isTravelBlock(toSession));
  var sourceLabel = isOutlook ? 'Outlook travel block' : 'Calculated by Opal';
  var sourceClass = isOutlook ? 'outlook' : 'calculated';

  // Times
  var depH = Math.floor(seg.startMin / 60), depM = seg.startMin % 60;
  var arrH = Math.floor(seg.endMin   / 60), arrM = seg.endMin   % 60;
  var depT = _tpFmtTime(depH, depM);
  var arrT = _tpFmtTime(arrH, arrM);
  var allotted = seg.endMin - seg.startMin;
  var tight    = seg.tight != null ? !!seg.tight : allotted < seg.travelMin - 5;

  var html = '';

  // Source chip
  html += '<span class="tp-source-chip ' + sourceClass + '">' +
    (isOutlook ? 'Outlook event' : 'Calculated route') + '</span>';

  // Stat row
  html += '<div class="tp-stat-row">';
  html += '<div class="tp-stat"><div class="tp-stat-val">' + (seg.travelMin || '—') + ' min</div><div class="tp-stat-lbl">Est. travel</div></div>';
  html += '<div class="tp-stat"><div class="tp-stat-val">' + allotted + ' min</div><div class="tp-stat-lbl">Time blocked</div></div>';
  html += '<div class="tp-stat"><div class="tp-stat-val">' + depT + '</div><div class="tp-stat-lbl">Depart</div></div>';
  html += '<div class="tp-stat"><div class="tp-stat-val">' + arrT + '</div><div class="tp-stat-lbl">Arrive</div></div>';
  html += '</div>';

  // Warning if tight
  if (tight) {
    html += '<div class="tp-warn-block">';
    html += '<strong>Travel time may be insufficient</strong>';
    html += seg.kind === 'end'
      ? 'This drive starts before the appointment it follows has finished.'
      : 'The ' + seg.travelMin + '-minute drive overlaps the appointment it leads to or the one before it. Move the leg, or the appointment.';
    html += '</div>';
  }

  // Between two sessions: straight to the next client, or home in between.
  var gapFrom = seg.gapFromSessionId && window.SESSIONS ? window.SESSIONS[seg.gapFromSessionId] : null;
  var gapTo   = seg.gapToSessionId && window.SESSIONS ? window.SESSIONS[seg.gapToSessionId] : null;
  if (gapFrom && gapTo) {
    var plan = betweenTravelPlan(gapFrom, gapTo, dayAnchorBase(seg.day));
    var goingHome = !!plan.home;
    var placeName = plan.placeAvailable ? (resolveTravelPoint(sessionTravelOverride(gapFrom, 'after'), seg.day) || {}).label || 'the saved place' : '';
    var why = plan.mode === 'elsewhere' ? 'Going to ' + placeName + ' in between (chosen with Go Somewhere Else).'
      : !plan.homeAvailable ? 'No home base set for this day (or a stop is at home), so it is a direct drive.'
      : plan.auto ? (goingHome ? 'Suggested: there is time to go home (' + plan.toBase + ' min home, ' + TRAVEL_HOME_MIN_STAY + ' min there, ' + plan.fromBase + ' min out).'
                               : 'Suggested: not enough time to go home in between.')
      : 'Your choice.';
    // The two appointments either side of the gap, by time: the same client
    // twice in a day read as "Noah Mathew and Noah Mathew".
    var stopAt = function (x) { return _tpEsc(_tpFmtTime(x.startH, x.startM || 0) + ' ' + (_stopName(x) || 'session')); };
    html += '<div class="tp-section-title">Travel from ' + stopAt(gapFrom) + ' to ' + stopAt(gapTo) + '</div>';
    html += '<div class="tp-plan-opts tp-between" data-between="' + _tpEsc(gapFrom.id) + '">' +
      '<button type="button" class="tp-plan-opt' + (plan.mode === 'direct' ? ' on' : '') + '" data-mode="direct">Go direct to next client</button>' +
      (plan.homeAvailable ? '<button type="button" class="tp-plan-opt' + (plan.mode === 'home' ? ' on' : '') + '" data-mode="home">Go home in between</button>' : '') +
      // A saved Go Somewhere Else place is its own way; choosing it clears the
      // Direct / Home choice so the place applies again.
      (plan.placeAvailable ? '<button type="button" class="tp-plan-opt' + (plan.mode === 'elsewhere' ? ' on' : '') + '" data-mode="">Go to ' + _tpEsc(placeName) + ' in between</button>' : '') +
      '</div><div class="tp-plan-hint">' + _tpEsc(why) + '</div>';
  }

  // What the leg belongs to, and whose time it keeps. The association is
  // computed from the day; only the time can be moved (drag on the calendar).
  var owner = seg.ownerSessionId && window.SESSIONS ? window.SESSIONS[seg.ownerSessionId] : null;
  if (owner) {
    html += '<div class="tp-section-title">Linked to</div>';
    html += '<div class="tp-linked"><strong>' + _tpEsc(owner.patient || owner.title || 'Appointment') + '</strong> · ' +
      (seg.ownerSide === 'after' ? 'travel after this appointment' : 'travel to this appointment') + '</div>';
    html += '<div class="tp-timing">' + (seg.moved
      ? 'You set this time. <button type="button" class="tp-plan-reset" data-timing="reset">Use calculated time</button>'
      : (owner.dbId ? 'Calculated time — drag the block on the calendar to travel at another time.' : 'Calculated time.')) + '</div>';
  }

  // Before / After — the session's own answer to where the day starts or ends.
  // Only the day's ends carry one; between-session legs chain in time order.
  var planSession = seg.kind === 'start' ? toSession : seg.kind === 'end' ? fromSession : null;
  if (planSession && !isTravelBlock(planSession) && planSession.dbId) {
    var side = seg.kind === 'start' ? 'before' : 'after';
    var current = sessionTravelOverride(planSession, side);
    var cur = describeTravelPoint(current, seg.day);
    if (typeof rebuildLocationCatalogue === 'function') rebuildLocationCatalogue();
    var bases = Object.keys(typeof LOCATIONS !== 'undefined' ? LOCATIONS : {}).filter(function (k) { return k !== 'leave' && k !== 'unset' && !LOCATIONS[k].comingSoon; });
    html += '<div class="tp-section-title">' + (side === 'before' ? 'Before this session, coming from' : 'After this session, go to') + '</div>';
    html += '<div class="tp-plan" data-session="' + _tpEsc(planSession.id) + '" data-side="' + side + '">';
    html += '<div class="tp-plan-current">' + _tpEsc(cur) + (current ? ' <button type="button" class="tp-plan-reset" data-plan="reset">Use day default</button>' : '') + '</div>';
    html += '<div class="tp-plan-opts">';
    bases.forEach(function (k) {
      var sel = current && current.kind === 'base' && current.id === k;
      html += '<button type="button" class="tp-plan-opt' + (sel ? ' on' : '') + '" data-plan="base" data-key="' + _tpEsc(k) + '">' + _tpEsc(LOCATIONS[k].label || k) + '</button>';
    });
    html += '</div>';
    // A one-off address for this day only — the base itself is left alone.
    html += '<div class="tp-plan-oneoff"><label>' + (side === 'before' ? 'Or start this day from' : 'Or finish this day at') +
      ' <input type="text" class="tp-addr" data-plan="address" autocomplete="off" placeholder="Start typing an address…" value="' + _tpEsc(current && current.kind === 'address' ? current.address : '') + '"></label>' +
      '<div class="tp-plan-hint">Pick from the suggestions. Changes this day only; your travel bases in My Profile stay as they are.</div></div>';
    if (side === 'after') {
      var pts = (window.PATIENTS || []).slice().sort(function (a, b) { return ((a.last || '') + (a.first || '')).localeCompare((b.last || '') + (b.first || '')); });
      html += '<div class="tp-plan-stop"><label>Or add a stop at another client ';
      html += '<select data-plan="stop"' + (pts.length ? '' : ' disabled') + '><option value="">' + (pts.length ? 'Choose from my caseload…' : 'No clients in your caseload yet') + '</option>' +
        pts.map(function (p) { return '<option value="' + _tpEsc(p.id) + '">' + _tpEsc((p.first || '') + ' ' + (p.last || '')) + (p.suburb ? ' · ' + _tpEsc(p.suburb) : '') + '</option>'; }).join('') +
        '</select></label>';
      html += '<div class="tp-plan-hint">' + (pts.length ? 'Picking a client opens Smart Booking at the earliest start the travel allows.' : 'A client appears once they have an open case with you in Splose.') + '</div></div>';
    }
    html += '</div>';
  }

  // Route display
  html += '<div class="tp-section-title">Route</div>';
  html += '<div class="tp-route-block">';

  // Each end: the full address, and for a client session an editable field
  // that changes the client's location on the appointment itself.
  var endHtml = function (sess, loc, sub, addr, role) {
    var h = '<div>';
    var isClient = sess && !isTravelBlock(sess);
    if (isClient) h += '<div class="tp-location-name">' + role + ': ' + _tpEsc(sess.patient || sess.title || 'Session') + '</div>';
    else h += '<div class="tp-location-name">' + _tpEsc(loc.label || sub) + '</div>';
    if (isClient && sess.dbId) {
      h += '<label class="tp-addr-edit">Client location <input type="text" class="tp-addr" data-session-addr="' + _tpEsc(sess.id) + '" autocomplete="off" placeholder="Start typing the client\'s address…" value="' + _tpEsc(addr) + '"></label>';
      h += '<div class="tp-plan-hint">Saved to this appointment (and its Outlook copy). Travel recalculates.</div>';
    } else {
      h += '<div class="tp-location-addr">' + _tpEsc(addr || (sub ? sub + ' WA' : 'Address not set')) + '</div>';
    }
    return h + '</div>';
  };
  html += '<div class="tp-route-row"><div><div class="tp-route-dot from"></div><div class="tp-route-line"></div></div>' + endHtml(fromSession, from, fromSub, fromAddr, 'After') + '</div>';
  html += '<div class="tp-route-row"><div class="tp-route-dot to"></div>' + endHtml(toSession, to, toSub, toAddr, 'Next') + '</div>';

  html += '</div>'; // tp-route-block

  // Missing location warnings
  if (!from.suburb && !from.addr) {
    html += '<div class="tp-warn-block"><strong>Origin address missing</strong>Travel cannot be accurately calculated without a starting address.</div>';
  }
  if (!to.suburb && !to.addr) {
    html += '<div class="tp-warn-block"><strong>Destination address missing</strong>Travel cannot be accurately calculated without a destination address.</div>';
  }

  // Google Maps button
  if (typeof mapsLink === 'function') {
    var mapsUrl = mapsLink(fromAddr || (fromSub + ' WA'), toAddr || (toSub + ' WA'));
    html += '<a class="tp-maps-btn" href="' + mapsUrl + '" target="_blank" rel="noopener">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    html += 'Open in Google Maps</a>';
  }

  // Travel Logbook link
  html += '<div style="margin-top:12px;text-align:center;">';
  html += '<button onclick="closeTravelPanel();switchTab(\'logbook\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:13px;text-decoration:underline;">View Travel Logbook →</button>';
  html += '</div>';

  body.innerHTML = html;
  _wireTravelPlan(body, seg);
  _wireRouteAddressEdits(body, seg);
  var between = body.querySelector('.tp-between');
  if (between) between.querySelectorAll('[data-mode]').forEach(function (b) {
    b.addEventListener('click', function () {
      var fromId = between.getAttribute('data-between'), mode = b.getAttribute('data-mode') || null;
      setBetweenTravel(fromId, mode).then(function (ok) {
        if (!ok) return;
        var o = window.SESSIONS && window.SESSIONS[fromId];
        var again = o ? computeDayTravelSegments(o.day).find(function (x) { return x.gapFromSessionId === fromId; }) : null;
        if (again) _renderTravelPanel(again); else closeTravelPanel();
      });
    });
  });
  var timingReset = body.querySelector('[data-timing="reset"]');
  if (timingReset) timingReset.addEventListener('click', function () {
    setTravelTiming(seg.ownerSessionId, seg.ownerSide, null).then(function (ok) {
      if (!ok) return;
      var o = window.SESSIONS && window.SESSIONS[seg.ownerSessionId];
      var again = o ? computeDayTravelSegments(o.day).find(function (x) { return x.ownerSessionId === seg.ownerSessionId && x.ownerSide === seg.ownerSide; }) : null;
      if (again) _renderTravelPanel(again); else closeTravelPanel();
    });
  });
}

function _tpFmtTime(h, m) {
  var ap = h < 12 ? 'am' : 'pm';
  return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ap;
}

// Escape closes travel panel
(function() {
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && _travelPanelOpen) { closeTravelPanel(); }
  });
})();


// ═══════════════════════════════════════════════════════════════
//  FIRST PAINT
//  Was a top-level call at the foot of the shell's work-location section,
//  guarded by `typeof refreshAllOverlays === 'function'`. It lives here now
//  because a deferred module cannot be reached from parse-time code — see
//  THE ONE PARSE-TIME CALL in the header. Paints travel legs onto every day
//  column now that SESSIONS is populated. (The idle-gap/free-window overlay
//  was removed 2026-08-09.)
// ═══════════════════════════════════════════════════════════════
refreshAllOverlays();


/* ---------- Before / After controls behind the travel panel ---------- */
function _tpEsc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }
function _wireTravelPlan(body, seg) {
  var box = body.querySelector('.tp-plan');
  if (!box) return;
  var sessionId = box.getAttribute('data-session'), side = box.getAttribute('data-side');
  var rerender = function () {
    var s = window.SESSIONS && window.SESSIONS[sessionId];
    if (!s) return;
    var segs = computeDayTravelSegments(s.day);
    var again = segs.find(function (x) { return x.kind === seg.kind; });
    if (again) _renderTravelPanel(again); else closeTravelPanel();
  };
  box.querySelectorAll('[data-plan="base"]').forEach(function (b) {
    b.addEventListener('click', function () { setTravelOverride(sessionId, side, { kind: 'base', id: b.getAttribute('data-key') }).then(function (ok) { if (ok) rerender(); }); });
  });
  var addr = box.querySelector('[data-plan="address"]');
  if (addr) {
    var applyOneOff = function (a, lat, lng) {
      a = String(a || '').trim(); if (!a) return;
      var spec = { kind: 'address', address: a, suburb: (typeof addrSuburb === 'function' ? addrSuburb(a) : null) || a, label: a };
      if (lat && lng) { spec.lat = Number(lat); spec.lng = Number(lng); }
      setTravelOverride(sessionId, side, spec).then(function (ok) { if (ok) rerender(); });
    };
    if (typeof attachPlacesAutocomplete === 'function') attachPlacesAutocomplete(addr, applyOneOff);
    addr.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); applyOneOff(addr.value, addr.dataset.lat, addr.dataset.lng); } });
  }
  var reset = box.querySelector('[data-plan="reset"]');
  if (reset) reset.addEventListener('click', function () { setTravelOverride(sessionId, side, null).then(function (ok) { if (ok) rerender(); }); });
  var stop = box.querySelector('[data-plan="stop"]');
  if (stop) stop.addEventListener('change', function () { if (stop.value) addStopAfterSession(sessionId, stop.value); });
}

/* Client location inputs in the Route block (both ends may be sessions). */
function _wireRouteAddressEdits(body, seg) {
  body.querySelectorAll('[data-session-addr]').forEach(function (input) {
    var sid = input.getAttribute('data-session-addr');
    var apply = function (a, lat, lng) {
      a = String(a || '').trim(); if (!a) return;
      saveSessionAddress(sid, a, lat, lng).then(function (ok) {
        if (!ok) return;
        var s = window.SESSIONS && window.SESSIONS[sid];
        var segs = s ? computeDayTravelSegments(s.day) : [];
        var again = segs.find(function (x) { return x.kind === seg.kind && (x.fromSessionId === seg.fromSessionId) && (x.toSessionId === seg.toSessionId); }) || segs.find(function (x) { return x.kind === seg.kind; });
        if (again) _renderTravelPanel(again);
      });
    };
    if (typeof attachPlacesAutocomplete === 'function') attachPlacesAutocomplete(input, apply);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); apply(input.value, input.dataset.lat, input.dataset.lng); } });
  });
}

/* Change a client session's location from the travel panel: the same effect
   as the detail panel's address save — the appointment (and its Outlook copy)
   carries the new address, the tile chip updates, travel recalculates. */
async function saveSessionAddress(sessionId, newAddr, lat, lng) {
  var s = window.SESSIONS && window.SESSIONS[sessionId];
  if (!s) return false;
  if (!s.dbId) { showToast('Not saved yet', 'This appointment has not finished saving. Try again in a moment.'); return false; }
  newAddr = String(newAddr || '').trim(); if (!newAddr) return false;
  lat = parseFloat(lat) || null; lng = parseFloat(lng) || null;
  var fromPlaces = !!(lat && lng);
  var addrBefore = captureSessionAddress(s);
  var oldAddr = s.address;
  s.address = newAddr; s.lat = lat; s.lng = lng; s.addressSource = 'manual';
  s.location = newAddr;
  s.locationObj = { formattedAddress: newAddr, latitude: lat, longitude: lng, source: 'manual', isMissing: false, isManualOverride: true,
                    isValidForRouting: (typeof isValidRoutingLocation === 'function' ? isValidRoutingLocation(newAddr) : true) || fromPlaces };
  delete s.__loc;
  invalidateRouteCacheFor(oldAddr); invalidateRouteCacheFor(newAddr);
  try {
    var key = s.sploseId ? 'manual_addr_splose_' + s.sploseId : (s.dbId ? 'manual_addr_db_' + s.dbId : null);
    if (key) localStorage.setItem(key, JSON.stringify({ formattedAddress: newAddr, lat: lat, lng: lng, savedAt: new Date().toISOString() }));
  } catch (e) { /* storage unavailable */ }
  if (s.element) {
    var ok = s.locationObj.isValidForRouting;
    s.element.classList.toggle('has-addr', ok);
    s.element.classList.toggle('missing-addr', !ok && (typeof sessionNeedsFullAddress === 'function' ? sessionNeedsFullAddress(s) : false));
    var chip = s.element.querySelector('.addr-chip'); if (ok && chip) chip.remove();
  }
  if (s.dbId) {
    try {
      var r = await fetch('/api/outlook/events/' + encodeURIComponent(s.dbId) + '/location', {
        method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: newAddr, lat: lat, lng: lng }),
      });
      if (!r.ok) { var j = await r.json().catch(function () { return {}; }); showToast('Address kept locally', j.error || 'Could not write it to the appointment.'); }
    } catch (e) { showToast('Address kept locally', e.message); }
  }
  if (typeof refreshDayOverlays === 'function') refreshDayOverlays(s.day);
  registerSessionAddressUndo(s, addrBefore);
  showToast(s.patient ? 'Client location updated' : 'Location updated', fromPlaces ? 'Pinned from Google Maps. Travel recalculated.' : 'Travel recalculated.');
  return true;
}
