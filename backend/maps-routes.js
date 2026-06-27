/**
 * GOOGLE MAPS PROXY ROUTES
 *
 * Proxies only the three Google Maps APIs the frontend needs so that the
 * GOOGLE_MAPS_API_KEY never appears in browser-served HTML or network requests.
 *
 * Routes (all require authentication):
 *   POST /api/maps/routes   — Google Routes API  (travel time / distance)
 *   POST /api/maps/places   — Places Text Search  (cafes/clinics near suburb)
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
