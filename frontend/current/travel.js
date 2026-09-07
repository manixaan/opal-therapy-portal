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
   Falls back gracefully to the suburb table when no API key is configured. */
async function fetchRoute(origin, destination, mode) {
  const key = routeKey(origin, destination, mode);
  const cached = ROUTE_CACHE.get(key);
  if (isFresh(cached)) return cached;
  if (ROUTE_INFLIGHT.has(key)) return ROUTE_INFLIGHT.get(key);

  const work = (async () => {
    let result;
    if (GOOGLE_MAPS_API_KEY) {
      try {
        const resp = await fetch('/api/maps/routes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ origin, destination, mode: mode || 'driving' })
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
  fetchRoute(from, to, modeKey).then(() => {
    // Repaint affected day(s) once the fresh route lands, if segments exist.
    if (typeof refreshAllOverlays === 'function') refreshAllOverlays();
  }).catch(() => {});
  return estimateTravelMinFromTable(from, to);
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

/* Real-world lookup: the authoritative session location lives on the Splose
   appointment (appointment.locationId → /locations/{id}) for onsite sessions,
   and on the patient's address (patient.suburb / .postalCode) for mobile visits.
   This stub mirrors that shape so the rest of the travel engine can be wired
   against it today and only the fetch layer swaps in production. */
function sploseLocationForSession(s) {
  // 0) Explicit per-session address takes precedence. This is the field the
  //    Splose integration will eventually populate from appointment.locationId
  //    or patient.address; storing it on the session keeps the dependency
  //    one-way and future-proofs travel routing for address-level precision.
  if (s.address) {
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
  // 1) Mobile / home visit — the therapist is wherever the patient lives
  if (s.patient && s.suburb) {
    return {
      source: 'splose:/patients/' + (s.patientId || '?'),
      address: null,
      suburb: stripSuburb(s.suburb),
      label:  `${s.patient} (${stripSuburb(s.suburb)})`,
      region: s.region || suburbRegion(stripSuburb(s.suburb)),
      kind:   'visit'
    };
  }
  // 2) Remote session (MDT on Teams, CPD webinar) — no physical suburb
  const isRemote = /^(teams|webinar)/i.test(s.suburb || '');
  if (isRemote) {
    return {
      source: 'splose:/appointments/… (remote)',
      address: null, suburb: null, label: 'Remote / online', region: 'remote', kind: 'remote'
    };
  }
  // 3) Admin / case-noting — home-based by default. Resolves to the day's
  //    anchor base (home if set in the Mon–Fri dropdown, else the office).
  //    This is what gives us "session → home" travel blocks automatically
  //    whenever a patient session is followed by an admin/case-noting block.
  if (HOME_BASED_TYPES.has(s.type)) {
    const anchor = dayAnchorBase(s.day);
    return {
      source: 'home-base anchor',
      address: anchor.addr || null,
      suburb: anchor.suburb || null,
      label:  anchor.label || 'Home base',
      region: anchor.region || 'central',
      kind:   'home-base'
    };
  }
  // 4) Onsite — Splose appointment.locationId points at Opal Therapy (office).
  //    Fall back to the user's configured Perth metro office.
  const office = WORK_BASES.office || {};
  return {
    source: 'splose:/locations/{office}',
    address: office.addr || null,
    suburb: office.suburb || 'Willetton',
    label:  office.label  || 'Perth metro office',
    region: office.region || 'central',
    kind:   'onsite'
  };
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
  if (locKey && locKey !== 'leave' && locKey !== 'unset') {
    const base = getBase(locKey);
    if (base) {
      return {
        suburb: base.suburb || null,
        label:  base.label  || 'Base',
        addr:   base.addr   || null,
        region: base.region || suburbRegion(base.suburb) || 'central',
        remote: base.kind === 'remote'
      };
    }
  }
  // Fallback: the first local home base with an address (the office is
  // "coming soon" and not a real place yet); the office only if nothing else.
  const home = ((typeof WORK_BASES !== 'undefined' && WORK_BASES.homes) || []).find(h => h.kind !== 'remote' && (h.addr || h.suburb));
  if (home) {
    return { suburb: home.suburb || null, label: home.label || 'Home', addr: home.addr || null, region: home.region || suburbRegion(home.suburb) || 'central', remote: false };
  }
  const o = (typeof WORK_BASES !== 'undefined' && WORK_BASES.office) || {};
  return { suburb: o.suburb || null, label: o.label || 'Perth metro office', addr: o.addr || null, region: o.region || 'central', remote: !o.addr && !o.suburb };
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
  const next = Object.assign({}, s.travel || {});
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
  return true;
}

/* Ask once for the day's base when a booking lands on a day that has none
   (owner's call, 7 Sep 2026: ask, don't silently assume the office). */
function ensureDayBase(day) {
  try {
    const wk = calendarWeekLocations();
    if (!wk || (wk[day] && wk[day] !== 'unset')) return Promise.resolve(wk ? wk[day] : null);
    if (typeof rebuildLocationCatalogue === 'function') rebuildLocationCatalogue();
    const opts = Object.keys(typeof LOCATIONS !== 'undefined' ? LOCATIONS : {})
      .filter(k => k !== 'leave' && k !== 'unset' && !LOCATIONS[k].comingSoon)
      .map(k => ({ key: k, label: LOCATIONS[k].label || k }));
    if (!opts.length) return Promise.resolve(null);
    const dayName = ({ mon:'Monday', tue:'Tuesday', wed:'Wednesday', thu:'Thursday', fri:'Friday', sat:'Saturday', sun:'Sunday' })[day] || day;
    return travelChooser('Where are you based on ' + dayName + '?',
      'Travel to the first session and back from the last one is worked out from here. You can change it any day in My Profile › Work locations.', opts)
      .then(key => {
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
    if (typeof selectBookingLeaf === 'function' && typeof BOOKING_LEAVES !== 'undefined') {
      const cur = BOOKING_STATE.serviceType && BOOKING_LEAVES[BOOKING_STATE.serviceType];
      if (!cur || cur.cat !== 'client') {
        const firstClientLeaf = Object.keys(BOOKING_LEAVES).find(k => BOOKING_LEAVES[k].cat === 'client');
        if (firstClientLeaf) selectBookingLeaf(firstClientLeaf);
      }
    }
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

/* After a stop is booked: the new session inherits the predecessor's `after`
   (where the day was going to end), so the chain forms without another step.
   The predecessor keeps its own answer — if the stop is later cancelled, the
   day closes back to where it used to. */
async function applyTravelChainAfterBooking(newDbId, ctx) {
  if (!newDbId || !ctx) return;
  const pred = ctx.sessionId && window.SESSIONS ? window.SESSIONS[ctx.sessionId] : null;
  const inherit = pred ? sessionTravelOverride(pred, 'after') : null;
  if (!inherit) return; // the day default carries over on its own
  try {
    await fetch('/api/events/' + encodeURIComponent(newDbId) + '/travel', {
      method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ before: null, after: inherit }),
    });
  } catch (e) { /* best effort — the default is the same base most days */ }
}

function computeDayTravelSegments(day) {
  const sessions = sessionsForDay(day);
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

  // --- start: base → first session ---
  const first = sessions[0];
  const firstLoc = sessionLocation(first);
  // Prefer the full street address when the session was booked with one —
  // gives the Routes API a precise origin/destination rather than the suburb
  // centroid, which matters for the 5-10 min disparity between, say,
  // "Willetton 6155" and "31 Yale Rd, Willetton WA 6155".
  // The first session may say where the day starts (travel.before); the day's
  // base is the default. Between legs always chain in time order.
  const startPt  = resolveTravelPoint(sessionTravelOverride(first, 'before'), day) || base;
  const baseKey  = startPt.addr  || startPt.suburb;
  const firstKey = locTravelKey(firstLoc);
  if (!startPt.remote && baseKey && firstKey && baseKey !== firstKey) {
    const travel = travelMinutes(baseKey, firstKey);
    if (travel > 0) {
      const endMin   = sessionStartMin(first);
      const startMin = Math.max(0, endMin - travel);
      segs.push({
        day, kind: 'start',
        fromLoc: { suburb: startPt.suburb, label: startPt.label, region: startPt.region, address: startPt.addr || null },
        toLoc:   { suburb: firstLoc.suburb, label: firstLoc.label, region: firstLoc.region, address: firstLoc.address || null },
        startMin, endMin,
        travelMin: travel, freeMin: 0,
        fromSessionId: null, toSessionId: first.id,
        anchorBaseId: startPt.baseId || calendarWeekLocations()[day] || 'office',
        overridden: !!sessionTravelOverride(first, 'before'),
        cacheKey: routeKey(baseKey, firstKey, 'driving')
      });
    }
  }

  // --- leading free window: working-day start → (travel to) first session ---
  {
    const startSeg = segs.find(x => x.kind === 'start');
    const leadEnd = startSeg ? startSeg.startMin : sessionStartMin(first);
    if (leadEnd - workS >= 45) {
      segs.push({ day, kind: 'gap', fromLoc: {}, toLoc: sessionLocation(first),
        startMin: workS, endMin: leadEnd, travelMin: 0, freeMin: leadEnd - workS,
        fromSessionId: null, toSessionId: first.id, anchorBaseId: null, cacheKey: '' });
    }
  }

  // --- between consecutive pairs ---
  for (let i = 0; i < sessions.length - 1; i++) {
    const curr = sessions[i], next = sessions[i + 1];
    const gapStart = sessionEndMin(curr);
    const gapEnd   = sessionStartMin(next);
    const gapMin   = gapEnd - gapStart;
    if (gapMin <= 0) continue;

    const from = sessionLocation(curr);
    const to   = sessionLocation(next);
    const fromKey = locTravelKey(from);
    const toKey   = locTravelKey(to);
    const travel  = travelMinutes(fromKey, toKey);

    // Lunch block inside this gap? Don't emit — lunch is its own block.
    const lunchIn = sessions.some(x => x.type === 'lunch' && sessionStartMin(x) >= gapStart && sessionEndMin(x) <= gapEnd);
    if (lunchIn) continue;

    const freeAfterTravel = Math.max(0, gapMin - travel);
    const kind = (gapMin >= 45 && freeAfterTravel >= 25) ? 'gap' : 'between';

    // Same-location + tight gap → skip (nothing interesting to render).
    if (kind === 'between' && travel === 0 && gapMin < 45) continue;

    segs.push({
      day, kind,
      fromLoc: from, toLoc: to,
      startMin: gapStart, endMin: gapEnd,
      travelMin: travel, freeMin: freeAfterTravel,
      fromSessionId: curr.id, toSessionId: next.id,
      anchorBaseId: null,
      cacheKey: routeKey(fromKey || '', toKey || '', 'driving')
    });
  }

  // --- end: last session → base ---
  const last = sessions[sessions.length - 1];
  const lastLoc = sessionLocation(last);
  const lastKey = locTravelKey(lastLoc);
  // The last session may say where the day ends (travel.after).
  const endPt = resolveTravelPoint(sessionTravelOverride(last, 'after'), day) || base;
  const baseKeyEnd = endPt.addr || endPt.suburb;
  if (!endPt.remote && baseKeyEnd && lastKey && baseKeyEnd !== lastKey) {
    const travel = travelMinutes(lastKey, baseKeyEnd);
    if (travel > 0) {
      const startMin = sessionEndMin(last);
      const endMin   = startMin + travel;
      segs.push({
        day, kind: 'end',
        fromLoc: { suburb: lastLoc.suburb, label: lastLoc.label, region: lastLoc.region, address: lastLoc.address || null },
        toLoc:   { suburb: endPt.suburb,   label: endPt.label,   region: endPt.region,   address: endPt.addr || null },
        startMin, endMin,
        travelMin: travel, freeMin: 0,
        fromSessionId: last.id, toSessionId: null,
        anchorBaseId: endPt.baseId || calendarWeekLocations()[day] || 'office',
        overridden: !!sessionTravelOverride(last, 'after'),
        cacheKey: routeKey(lastKey, baseKeyEnd, 'driving')
      });
    }
  }

  // --- trailing free window: last session (after return travel) → working-day end ---
  {
    const endSeg = segs.find(x => x.kind === 'end');
    const tailStart = endSeg ? endSeg.endMin : sessionEndMin(last);
    if (workE - tailStart >= 45) {
      segs.push({ day, kind: 'gap', fromLoc: sessionLocation(last), toLoc: {},
        startMin: tailStart, endMin: workE, travelMin: 0, freeMin: workE - tailStart,
        fromSessionId: last.id, toSessionId: null, anchorBaseId: null, cacheKey: '' });
    }
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
}

/* Segment-aware renderer. Dispatches by kind so start/between/end/gap
   share a single entry point and the renderer can't drift from the
   segment store. */
function renderSegmentOverlay(col, seg) {
  if (seg.kind === 'gap') {
    // FREE-TIME/GAP OVERLAY REMOVED (2026-08-09, Antony's directive): the
    // green hatched "Free window / Idle gap" bands and cards made the calendar
    // look crowded. Gap SEGMENTS are still computed — the Snapshot report and
    // idle-slot suggestion engine read them from DAY_SEGMENTS — but nothing is
    // painted on the calendar canvas. Travel-leg indicators below still render.
    return;
  }
  // Travel kinds: 'start' | 'between' | 'end'
  const el = document.createElement('div');
  el.className = 'travel-overlay ' + seg.kind;
  el.style.top    = tToY(Math.floor(seg.startMin/60), seg.startMin%60) + 'px';
  // Floor for readability, but NEVER cross the slot boundary — a sub-15-min
  // leg renders as a thin strip inside its own gap instead of overrunning
  // the neighbouring session tile.
  const segSlotPx = (seg.endMin - seg.startMin) / 60 * HOUR_PX;
  el.style.height = Math.min(Math.max(12, segSlotPx - 4), Math.max(4, segSlotPx - 2)) + 'px';
  const tight = seg.kind === 'between' && (seg.endMin - seg.startMin) < seg.travelMin + 5;
  if (tight) el.style.borderLeftColor = '#9c3322';
  const icon = seg.kind === 'start' ? 'Start' : seg.kind === 'end' ? 'End' : 'Travel';
  const from = seg.fromLoc.label || seg.fromLoc.suburb || 'Base';
  const to   = seg.toLoc.label   || seg.toLoc.suburb   || 'Base';
  el.innerHTML = `<span class="t-ico" style="font-size: 10px; font-weight: 600; opacity: 0.7;">${icon}</span>
    <span class="t-label">${seg.travelMin} min · ${seg.fromLoc.suburb || from} → ${seg.toLoc.suburb || to}</span>`;
  const kindLabel = seg.kind === 'start' ? 'Morning drive from' :
                    seg.kind === 'end'   ? 'Evening drive to'    :
                                           'Travel';
  el.title = `${kindLabel} ${seg.fromLoc.suburb || from} → ${seg.toLoc.suburb || to} ≈ ${seg.travelMin} min. Click for travel details.`;
  el.dataset.segJson = JSON.stringify({
    kind: seg.kind, travelMin: seg.travelMin, startMin: seg.startMin, endMin: seg.endMin,
    fromSuburb: seg.fromLoc.suburb || from, toSuburb: seg.toLoc.suburb || to,
    fromLabel: seg.fromLoc.label || from, toLabel: seg.toLoc.label || to,
    fromAddr: seg.fromLoc.addr || '', toAddr: seg.toLoc.addr || ''
  });
  el.onclick = (ev) => {
    ev.stopPropagation();
    openTravelPanel(seg);
  };
  col.appendChild(el);
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
  var tight    = allotted < seg.travelMin - 5;

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
    html += 'Only ' + allotted + ' minutes is blocked, but travel is estimated at ' + seg.travelMin + ' minutes. Consider allowing ' + (seg.travelMin + 5) + ' minutes or more.';
    html += '</div>';
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
  showToast('Client location updated', fromPlaces ? 'Pinned from Google Maps. Travel recalculated.' : 'Travel recalculated.');
  return true;
}
