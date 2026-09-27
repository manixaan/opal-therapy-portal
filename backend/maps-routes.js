/**
 * GOOGLE MAPS PROXY ROUTES
 *
 * Proxies only the three Google Maps APIs the frontend needs so that the
 * GOOGLE_MAPS_API_KEY never appears in browser-served HTML or network requests.
 *
 * Routes (all require authentication):
 *   POST /api/maps/routes   — Google Routes API  (travel time / distance)
 *   POST /api/maps/places   — Places Text Search  (cafes/clinics near suburb)
 *   POST /api/maps/autocomplete — Place Autocomplete (address fields, as you type)
 *   GET  /api/maps/place/:id    — Place Details      (lat/lng of a picked suggestion)
 *   GET  /api/maps/geocode  — Geocoding API       (address → lat/lng)
 *   GET  /api/maps/sdk-url  — Returns the Maps JS SDK URL so the frontend can
 *                             dynamically load it without a hardcoded key
 *
 * Inputs are validated and sanitised before forwarding.  The proxy never
 * forwards arbitrary URLs — each endpoint calls a single, fixed Google URL.
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { requireAuth } = require('./permissions');

const GOOGLE_BASE = 'https://maps.googleapis.com';
const ROUTES_URL  = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const PLACES_URL  = 'https://places.googleapis.com/v1/places:searchText';
const AUTOCOMPLETE_URL  = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACE_DETAILS_URL = 'https://places.googleapis.com/v1/places';

// Western Australia's bounding box — suggestions are limited to it, as the old ", WA" query was.
const WA_BOUNDS = { low: { latitude: -35.2, longitude: 112.9 }, high: { latitude: -13.6, longitude: 129.0 } };
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getKey() {
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

function mapsUnavailable(res) {
  return res.status(503).json({ error: 'Google Maps is not configured on this server.' });
}

// Basic string sanitiser — strips null bytes, limits length.
function sanitiseString(val, maxLen = 500) {
  if (typeof val !== 'string') return '';
  return val.replace(/\0/g, '').trim().slice(0, maxLen);
}

// Google bills autocomplete keystrokes + the final details call as one session
// when they share a token; accept only a plain token, otherwise send none.
function sanitiseSessionToken(val) {
  return typeof val === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(val) ? val : '';
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * GET /api/maps/sdk-url
 * Returns the Google Maps JS SDK URL with the key injected server-side.
 * The frontend uses this to dynamically load the SDK without a hardcoded key.
 */
router.get('/api/maps/sdk-url', requireAuth, (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);
  res.json({
    url: `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&libraries=places&callback=onGoogleMapsReady`,
  });
});

/**
 * POST /api/maps/routes
 * Body: { origin: string, destination: string, mode?: 'driving'|'walking' }
 * Proxies to the Google Routes API.
 */
router.post('/api/maps/routes', requireAuth, async (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);

  const origin      = sanitiseString(req.body?.origin);
  const destination = sanitiseString(req.body?.destination);
  const mode        = sanitiseString(req.body?.mode || 'driving', 20);

  if (!origin || !destination) {
    return res.status(400).json({ error: 'origin and destination are required' });
  }

  const travelMode = mode.toUpperCase() === 'WALKING' ? 'WALK' : 'DRIVE';

  try {
    const resp = await axios.post(
      ROUTES_URL,
      {
        origin:            { address: origin },
        destination:       { address: destination },
        travelMode,
        routingPreference: 'TRAFFIC_AWARE',
      },
      {
        headers: {
          'Content-Type':    'application/json',
          'X-Goog-Api-Key':  key,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        timeout: 8000,
      }
    );
    res.json(resp.data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: 'Routes API error', detail: err.response?.data || err.message });
  }
});

/**
 * POST /api/maps/places
 * Body: { query: string, maxResultCount?: number }
 * Proxies to the Google Places Text Search API.
 */
router.post('/api/maps/places', requireAuth, async (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);

  const query          = sanitiseString(req.body?.query);
  const maxResultCount = Math.min(parseInt(req.body?.maxResultCount || 8, 10), 20);

  if (!query) return res.status(400).json({ error: 'query is required' });

  try {
    const resp = await axios.post(
      PLACES_URL,
      { textQuery: query, maxResultCount },
      {
        headers: {
          'Content-Type':    'application/json',
          'X-Goog-Api-Key':  key,
          'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.rating,places.userRatingCount,places.primaryType,places.location,places.id',
        },
        timeout: 8000,
      }
    );
    res.json(resp.data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: 'Places API error', detail: err.response?.data || err.message });
  }
});

/**
 * POST /api/maps/autocomplete
 * Body: { input: string, sessionToken?: string }
 * Proxies to Place Autocomplete (New) — matches partial words as the user
 * types, restricted to Australia and to WA. Returns
 * { suggestions: [{ placeId, name, addr }] }; coordinates come from
 * GET /api/maps/place/:placeId once one is picked.
 */
router.post('/api/maps/autocomplete', requireAuth, async (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);

  const input = sanitiseString(req.body?.input, 200);
  if (!input) return res.status(400).json({ error: 'input is required' });
  const sessionToken = sanitiseSessionToken(req.body?.sessionToken);

  try {
    const resp = await axios.post(
      AUTOCOMPLETE_URL,
      {
        input,
        includedRegionCodes: ['au'],
        locationRestriction: { rectangle: WA_BOUNDS },
        ...(sessionToken ? { sessionToken } : {}),
      },
      { headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key }, timeout: 8000 }
    );
    const suggestions = (resp.data?.suggestions || [])
      .map((s) => s.placePrediction)
      .filter((p) => p && p.placeId)
      .map((p) => ({
        placeId: p.placeId,
        name: p.structuredFormat?.mainText?.text || p.text?.text || '',
        addr: p.text?.text || '',
      }));
    res.json({ suggestions });
  } catch (err) {
    res.status(err.response?.status || 502).json({ error: 'Autocomplete API error' });
  }
});

/**
 * GET /api/maps/place/:placeId?sessionToken=…
 * Place Details (New) for a picked suggestion → { addr, lat, lng }.
 */
router.get('/api/maps/place/:placeId', requireAuth, async (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);

  const placeId = String(req.params.placeId || '');
  if (!PLACE_ID_RE.test(placeId)) return res.status(400).json({ error: 'Invalid place id' });
  const sessionToken = sanitiseSessionToken(req.query?.sessionToken);

  try {
    const resp = await axios.get(`${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`, {
      params: sessionToken ? { sessionToken } : {},
      headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': 'formattedAddress,location' },
      timeout: 8000,
    });
    const d = resp.data || {};
    res.json({
      addr: d.formattedAddress || '',
      lat: d.location?.latitude ?? null,
      lng: d.location?.longitude ?? null,
    });
  } catch (err) {
    res.status(err.response?.status || 502).json({ error: 'Place Details API error' });
  }
});

/**
 * GET /api/maps/geocode?address=…
 * Proxies to the Google Geocoding API.
 */
router.get('/api/maps/geocode', requireAuth, async (req, res) => {
  const key = getKey();
  if (!key) return mapsUnavailable(res);

  const address = sanitiseString(req.query?.address);
  if (!address) return res.status(400).json({ error: 'address query parameter is required' });

  try {
    const resp = await axios.get(
      `${GOOGLE_BASE}/maps/api/geocode/json`,
      {
        params: {
          address,
          key,
          region:     'au',
          components: 'country:AU|administrative_area:WA',
        },
        timeout: 8000,
      }
    );
    res.json(resp.data);
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: 'Geocoding API error', detail: err.response?.data || err.message });
  }
});

module.exports = router;
