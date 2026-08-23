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
      const estMin = estimateTravelMinFromTable(origin, destination);
      result = { durationMin: estMin, distanceMeters: estMin * 850, source: 'estimate' };
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
  return regionDistance(suburbRegion(f), suburbRegion(t));
}

/* Best-effort suburb extractor — handles "100 Burrendah Blvd, Willetton WA 6155"
   and bare "Willetton" strings alike. */
function addrSuburb(addr) {
  if (!addr) return '';
  // If it looks like a bare suburb, return it.
  if (!/,/.test(addr) && addr.split(/\s+/).length <= 3) return String(addr).trim();
  const m = String(addr).match(/,\s*([A-Za-z ]+?)\s+(?:WA|Western Australia)?\s*\d{0,4}\s*$/i);
  return m ? m[1].trim() : String(addr).split(',').pop().replace(/\bWA\b.*$/i, '').trim();
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
function dayAnchorBase(day) {
  const weekObj = (typeof wlThisWeek === 'function') ? wlThisWeek() : {};
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
  // Fallback: Perth metro office
  const o = WORK_BASES.office || {};
  return { suburb: o.suburb || 'Willetton', label: o.label || 'Perth metro office', addr: o.addr || null, region: o.region || 'central', remote: false };
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
  const baseKey  = base.addr  || base.suburb;
  const firstKey = locTravelKey(firstLoc);
  if (!base.remote && baseKey && firstKey && baseKey !== firstKey) {
    const travel = travelMinutes(baseKey, firstKey);
    if (travel > 0) {
      const endMin   = sessionStartMin(first);
      const startMin = Math.max(0, endMin - travel);
      segs.push({
        day, kind: 'start',
        fromLoc: { suburb: base.suburb, label: base.label, region: base.region, address: base.addr || null },
        toLoc:   { suburb: firstLoc.suburb, label: firstLoc.label, region: firstLoc.region, address: firstLoc.address || null },
        startMin, endMin,
        travelMin: travel, freeMin: 0,
        fromSessionId: null, toSessionId: first.id,
        anchorBaseId: (typeof wlThisWeek === 'function' && wlThisWeek()[day]) || 'office',
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
  const baseKeyEnd = base.addr || base.suburb;
  if (!base.remote && baseKeyEnd && lastKey && baseKeyEnd !== lastKey) {
    const travel = travelMinutes(lastKey, baseKeyEnd);
    if (travel > 0) {
      const startMin = sessionEndMin(last);
      const endMin   = startMin + travel;
      segs.push({
        day, kind: 'end',
        fromLoc: { suburb: lastLoc.suburb, label: lastLoc.label, region: lastLoc.region, address: lastLoc.address || null },
        toLoc:   { suburb: base.suburb,    label: base.label,    region: base.region,    address: base.addr || null },
        startMin, endMin,
        travelMin: travel, freeMin: 0,
        fromSessionId: last.id, toSessionId: null,
        anchorBaseId: (typeof wlThisWeek === 'function' && wlThisWeek()[day]) || 'office',
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
  ['mon','tue','wed','thu','fri'].forEach(d => refreshDayOverlays(d));
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
  var fromAddr = from.addr   || from.formattedAddress || fromSub + ' WA';
  var toAddr   = to.addr     || to.formattedAddress   || toSub   + ' WA';

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

  // Route display
  html += '<div class="tp-section-title">Route</div>';
  html += '<div class="tp-route-block">';

  // From
  html += '<div class="tp-route-row">';
  html += '<div><div class="tp-route-dot from"></div><div class="tp-route-line"></div></div>';
  html += '<div>';
  if (fromSession && !isTravelBlock(fromSession)) {
    html += '<div class="tp-location-name">After: '+ (fromSession.patient || fromSession.title || 'Session') + '</div>';
  }
  html += '<div class="tp-location-name">' + fromSub + '</div>';
  if (fromAddr && fromAddr !== fromSub + ' WA') html += '<div class="tp-location-addr">' + fromAddr + '</div>';
  html += '</div></div>';

  // To
  html += '<div class="tp-route-row">';
  html += '<div class="tp-route-dot to"></div>';
  html += '<div>';
  if (toSession && !isTravelBlock(toSession)) {
    html += '<div class="tp-location-name">Next: '+ (toSession.patient || toSession.title || 'Session') + '</div>';
  }
  html += '<div class="tp-location-name">' + toSub + '</div>';
  if (toAddr && toAddr !== toSub + ' WA') html += '<div class="tp-location-addr">' + toAddr + '</div>';
  html += '</div></div>';

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
    var mapsUrl = mapsLink(fromAddr || fromSub + ' WA', toAddr || toSub + ' WA');
    html += '<a class="tp-maps-btn" href="' + mapsUrl + '" target="_blank" rel="noopener">';
    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
    html += 'Open in Google Maps</a>';
  }

  // Travel Logbook link
  html += '<div style="margin-top:12px;text-align:center;">';
  html += '<button onclick="closeTravelPanel();switchTab(\'logbook\')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:13px;text-decoration:underline;">View Travel Logbook →</button>';
  html += '</div>';

  body.innerHTML = html;
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
