/**
 * FLIGHT LOOKUP ROUTES (14 Nov 2026)
 *
 * "Add a flight" on the Calendar (frontend/current/flights.js) looks a flight
 * up by number and date, then books the drive to the airport, a check-in
 * buffer, the flight and the drive onward as Travel blocks. Live status on a
 * booked flight polls the same lookup.
 *
 *   GET /api/flights/lookup?number=QF643&date=2026-11-20
 *     → { flights: [{ number, airline, status, departure: {...}, arrival: {...} }] }
 *
 * The provider is AeroDataBox through RapidAPI. The key stays on the server
 * (AERODATABOX_API_KEY; host AERODATABOX_API_HOST, default below) and is never
 * sent to the browser. Without a key the route answers 503
 * { error: 'flight_lookup_unconfigured' } and the dialog offers manual entry.
 *
 * The proxy calls one fixed upstream path built from a validated number and
 * date only. Upstream bodies are never echoed. Answers are cached for five
 * minutes per number + date to keep the paid lookup budget small.
 */

'use strict';

const express = require('express');
const axios   = require('axios');
const router  = express.Router();
const { requireAuth } = require('./permissions');

const DEFAULT_HOST = 'aerodatabox.p.rapidapi.com';
const HOST_RE = /^[a-z0-9.-]{3,253}$/i;
const NUMBER_RE = /^[A-Z0-9]{2,3}\s?\d{1,4}[A-Z]?$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

const cache = new Map(); // `${number}|${date}` → { at, body }

function getKey() { return String(process.env.AERODATABOX_API_KEY || '').trim(); }
function getHost() {
  const h = String(process.env.AERODATABOX_API_HOST || '').trim();
  return h && HOST_RE.test(h) ? h : DEFAULT_HOST;
}

/* PURE — 'qf 643' → 'QF643'; null when it is not a flight number. */
function normaliseNumber(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!NUMBER_RE.test(s)) return null;
  return s.replace(/\s+/g, '').toUpperCase();
}

/* PURE — a real calendar date from yesterday to a year ahead, else null. */
function validDate(v, now = Date.now()) {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null;
  const t = Date.parse(v + 'T00:00:00Z');
  if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== v) return null;
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  const day = 24 * 3600 * 1000;
  if (t < today - day || t > today + 365 * day) return null;
  return v;
}

function str(v, max = 120) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
  return s || null;
}
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
/* AeroDataBox writes UTC as "2026-11-20 01:35Z"; make it a proper ISO string. */
function utc(t) {
  const raw = t && typeof t === 'object' ? t.utc : null;
  if (typeof raw !== 'string') return null;
  const ms = Date.parse(raw.replace(' ', 'T'));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normaliseEnd(e) {
  const end = e && typeof e === 'object' ? e : {};
  const ap = end.airport && typeof end.airport === 'object' ? end.airport : {};
  const loc = ap.location && typeof ap.location === 'object' ? ap.location : {};
  return {
    iata: str(ap.iata, 4), name: str(ap.name), city: str(ap.municipalityName),
    countryCode: str(ap.countryCode, 3), lat: num(loc.lat), lon: num(loc.lon),
    scheduledUtc: utc(end.scheduledTime), revisedUtc: utc(end.revisedTime),
    terminal: str(end.terminal, 20), gate: str(end.gate, 20), checkInDesk: str(end.checkInDesk, 40),
  };
}

/* PURE — the provider's array → our shape. Anything missing is null. */
function normaliseFlights(data) {
  if (!Array.isArray(data)) return [];
  return data.slice(0, 10).filter(f => f && typeof f === 'object').map(f => ({
    number: str(f.number, 12) ? str(f.number, 12).replace(/\s+/g, '') : null,
    airline: f.airline && typeof f.airline === 'object' ? str(f.airline.name) : null,
    status: str(f.status, 40),
    departure: normaliseEnd(f.departure),
    arrival: normaliseEnd(f.arrival),
  }));
}

function cacheGet(key, now) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (now - hit.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.body;
}
function cacheSet(key, body, now) {
  cache.set(key, { at: now, body });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

router.get('/api/flights/lookup', requireAuth, async (req, res) => {
  const role = req.user && req.user.role;
  if (role === 'read_only' || role === 'pre_employee') {
    return res.status(403).json({ error: 'Your account cannot book travel' });
  }
  const number = normaliseNumber(req.query.number);
  if (!number) return res.status(400).json({ error: 'Enter a flight number like QF643' });
  const date = validDate(req.query.date);
  if (!date) return res.status(400).json({ error: 'Enter a date from yesterday to a year ahead' });

  const key = getKey();
  if (!key) return res.status(503).json({ error: 'flight_lookup_unconfigured' });

  const now = Date.now();
  const ck = number + '|' + date;
  const cached = cacheGet(ck, now);
  if (cached) return res.json(cached);

  const host = getHost();
  try {
    const resp = await axios.get(
      `https://${host}/flights/number/${encodeURIComponent(number)}/${date}`,
      {
        params: { withAircraftImage: 'false', withLocation: 'false' },
        headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': host },
        timeout: 8000,
        validateStatus: s => (s >= 200 && s < 300) || s === 404,
      }
    );
    const body = { flights: resp.status === 404 ? [] : normaliseFlights(resp.data) };
    cacheSet(ck, body, now);
    return res.json(body);
  } catch (err) {
    console.error('[flights] lookup failed:', (err && err.response && err.response.status) || (err && err.code) || 'error');
    return res.status(502).json({ error: 'The flight lookup is not answering right now' });
  }
});

router._test = { normaliseNumber, validDate, normaliseFlights, cache, cacheSet, CACHE_MAX };
module.exports = router;
