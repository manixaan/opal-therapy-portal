'use strict';

/**
 * MAPS ADAPTER — the billing engine's only door to Google.
 *
 * Same endpoints, key (GOOGLE_MAPS_API_KEY) and request shape as the calendar's
 * /api/maps proxy (maps-routes.js), so a leg the calendar drew and a leg the
 * invoice bills come from the same Google Routes answer. Results are
 * persisted by route-facts.js / billing-profiles.js, so Google is called at
 * most once per route or address.
 *
 * Tests (and a future provider) replace the implementation with
 * `setMapsProvider`. With no key configured every call returns null and the
 * caller raises a Needs Attention issue — there is no estimated fallback,
 * because an estimate is a guess and guesses are not billed.
 */

const axios = require('axios');

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

const googleProvider = {
  name: 'google',
  async route(origin, destination) {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!key) return null;
    try {
      const resp = await axios.post(ROUTES_URL, {
        origin: { address: origin },
        destination: { address: destination },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_AWARE',
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters',
        },
        timeout: 8000,
      });
      const r0 = resp.data && resp.data.routes && resp.data.routes[0];
      if (!r0 || !r0.duration) return null;
      const seconds = parseInt(String(r0.duration).replace(/s$/, ''), 10) || 0;
      return { minutes: Math.round(seconds / 60), km: Math.round((Number(r0.distanceMeters) || 0)) / 1000, provider: 'google_routes' };
    } catch (_) {
      return null;
    }
  },
  async geocode(address) {
    const key = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!key) return null;
    try {
      const resp = await axios.get(GEOCODE_URL, { params: { address, key, region: 'au', components: 'country:AU' }, timeout: 8000 });
      const r0 = resp.data && resp.data.results && resp.data.results[0];
      if (!r0 || !r0.geometry || !r0.geometry.location) return null;
      return {
        lat: Number(r0.geometry.location.lat),
        lng: Number(r0.geometry.location.lng),
        formattedAddress: r0.formatted_address || null,
        precise: ['ROOFTOP', 'RANGE_INTERPOLATED'].includes(r0.geometry.location_type),
        provider: 'google_geocoding',
      };
    } catch (_) {
      return null;
    }
  },
};

let provider = googleProvider;

function setMapsProvider(p) { provider = p || googleProvider; }
function getMapsProvider() { return provider; }

module.exports = { setMapsProvider, getMapsProvider, googleProvider };
