'use strict';

/**
 * Flight lookup proxy (flight-routes.js, 14 Nov 2026) — Calendar → Add a
 * flight. In-process with supertest; auth and AeroDataBox are mocked.
 */

let mockUser = { id: 1, role: 'therapist' };
jest.mock('../permissions', () => ({
  requireAuth: (req, res, next) => {
    if (!mockUser) return res.status(401).json({ error: 'Not authenticated' });
    req.user = mockUser; next();
  },
}));
jest.mock('axios', () => ({ post: jest.fn(), get: jest.fn() }));

const request = require('supertest');
const express = require('express');
const axios = require('axios');
const router = require('../flight-routes');

function buildApp() {
  const app = express();
  app.use('/', router);
  return app;
}
const ymd = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const DATE = ymd(3);
const KEY = 'rapid-secret-key-1234567890';

const UPSTREAM = [{
  number: 'QF 643', status: 'Expected', airline: { name: 'Qantas' },
  departure: {
    airport: { iata: 'PER', icao: 'YPPH', name: 'Perth', municipalityName: 'Perth', countryCode: 'AU', location: { lat: -31.94, lon: 115.97 } },
    scheduledTime: { utc: '2026-11-20 01:35Z', local: '2026-11-20 09:35+08:00' },
    revisedTime: { utc: '2026-11-20 02:00Z', local: '2026-11-20 10:00+08:00' },
    terminal: '3', gate: '12', checkInDesk: '1-20',
  },
  arrival: {
    airport: { iata: 'SYD', name: 'Sydney Kingsford Smith', municipalityName: 'Sydney', countryCode: 'AU' },
    scheduledTime: { utc: '2026-11-20 05:45Z', local: '2026-11-20 16:45+11:00' },
  },
}];

describe('GET /api/flights/lookup', () => {
  let app;
  beforeEach(() => {
    mockUser = { id: 1, role: 'therapist' };
    process.env.AERODATABOX_API_KEY = KEY;
    delete process.env.AERODATABOX_API_HOST;
    axios.get.mockReset();
    router._test.cache.clear();
    app = buildApp();
  });
  afterAll(() => { delete process.env.AERODATABOX_API_KEY; });

  test('401 without a session, 403 for read_only and pre_employee — no upstream call', async () => {
    mockUser = null;
    expect((await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`)).status).toBe(401);
    for (const role of ['read_only', 'pre_employee']) {
      mockUser = { id: 2, role };
      expect((await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`)).status).toBe(403);
    }
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('400 for a bad number or a date out of range', async () => {
    for (const q of ['number=Q&date=' + DATE, 'number=QF643210&date=' + DATE, 'number=QF/643&date=' + DATE,
      'number=QF643&date=2026-13-01', 'number=QF643&date=' + ymd(-3), 'number=QF643&date=' + ymd(400), 'number=QF643']) {
      expect((await request(app).get('/api/flights/lookup?' + q)).status).toBe(400);
    }
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('503 flight_lookup_unconfigured without a key', async () => {
    delete process.env.AERODATABOX_API_KEY;
    const r = await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`);
    expect(r.status).toBe(503);
    expect(r.body).toEqual({ error: 'flight_lookup_unconfigured' });
    expect(axios.get).not.toHaveBeenCalled();
  });

  test('normalises the flight; calls the fixed URL with the key in headers only', async () => {
    axios.get.mockResolvedValue({ status: 200, data: UPSTREAM });
    const r = await request(app).get(`/api/flights/lookup?number=qf 643&date=${DATE}`);
    expect(r.status).toBe(200);
    const [url, opts] = axios.get.mock.calls[0];
    expect(url).toBe(`https://aerodatabox.p.rapidapi.com/flights/number/QF643/${DATE}`);
    expect(opts.headers).toEqual({ 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': 'aerodatabox.p.rapidapi.com' });
    expect(opts.params).toEqual({ withAircraftImage: 'false', withLocation: 'false' });
    expect(opts.timeout).toBe(8000);
    expect(r.body).toEqual({ flights: [{
      number: 'QF643', airline: 'Qantas', status: 'Expected',
      departure: { iata: 'PER', name: 'Perth', city: 'Perth', countryCode: 'AU', lat: -31.94, lon: 115.97,
        scheduledUtc: '2026-11-20T01:35:00.000Z', revisedUtc: '2026-11-20T02:00:00.000Z', terminal: '3', gate: '12', checkInDesk: '1-20' },
      arrival: { iata: 'SYD', name: 'Sydney Kingsford Smith', city: 'Sydney', countryCode: 'AU', lat: null, lon: null,
        scheduledUtc: '2026-11-20T05:45:00.000Z', revisedUtc: null, terminal: null, gate: null, checkInDesk: null },
    }] });
    expect(JSON.stringify(r.body)).not.toContain(KEY);
  });

  test('a configured host is used; a malformed one falls back to the default', async () => {
    axios.get.mockResolvedValue({ status: 200, data: [] });
    process.env.AERODATABOX_API_HOST = 'aerodatabox.example.com';
    await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`);
    expect(axios.get.mock.calls[0][0]).toMatch(/^https:\/\/aerodatabox\.example\.com\/flights\/number\//);
    process.env.AERODATABOX_API_HOST = 'evil.com/x?';
    await request(app).get(`/api/flights/lookup?number=QF644&date=${DATE}`);
    expect(axios.get.mock.calls[1][0]).toMatch(/^https:\/\/aerodatabox\.p\.rapidapi\.com\//);
  });

  test('missing fields come back null, not as errors', async () => {
    axios.get.mockResolvedValue({ status: 200, data: [{ number: 'VA1', departure: {}, arrival: null }, null, 'junk'] });
    const r = await request(app).get(`/api/flights/lookup?number=VA1&date=${DATE}`);
    expect(r.status).toBe(200);
    expect(r.body.flights).toHaveLength(1);
    expect(r.body.flights[0].airline).toBeNull();
    expect(r.body.flights[0].departure.scheduledUtc).toBeNull();
    expect(r.body.flights[0].arrival.iata).toBeNull();
  });

  test('a repeat within five minutes is served from the cache', async () => {
    axios.get.mockResolvedValue({ status: 200, data: UPSTREAM });
    const a = await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`);
    const b = await request(app).get(`/api/flights/lookup?number=qf643&date=${DATE}`);
    expect(b.body).toEqual(a.body);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  test('upstream 404 and 204 → no flights', async () => {
    axios.get.mockResolvedValueOnce({ status: 404, data: { message: 'not found' } });
    expect((await request(app).get(`/api/flights/lookup?number=QF1&date=${DATE}`)).body).toEqual({ flights: [] });
    axios.get.mockResolvedValueOnce({ status: 204, data: '' });
    expect((await request(app).get(`/api/flights/lookup?number=QF2&date=${DATE}`)).body).toEqual({ flights: [] });
  });

  test('upstream failure → 502 with a generic message; nothing upstream echoed, not cached', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const err = Object.assign(new Error('Request failed ' + KEY), { response: { status: 429, data: { message: 'quota exceeded for key ' + KEY } } });
    axios.get.mockRejectedValueOnce(err);
    const r = await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`);
    expect(r.status).toBe(502);
    expect(r.body).toEqual({ error: 'The flight lookup is not answering right now' });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(KEY);
    spy.mockRestore();
    axios.get.mockResolvedValueOnce({ status: 200, data: UPSTREAM });
    expect((await request(app).get(`/api/flights/lookup?number=QF643&date=${DATE}`)).body.flights).toHaveLength(1);
  });

  test('the cache is capped — the oldest entry goes first', () => {
    const { cache, cacheSet, CACHE_MAX } = router._test;
    for (let i = 0; i < CACHE_MAX + 25; i++) cacheSet('K' + i + '|' + DATE, { flights: [] }, Date.now());
    expect(cache.size).toBe(CACHE_MAX);
    expect(cache.has('K0|' + DATE)).toBe(false);
    expect(cache.has('K' + (CACHE_MAX + 24) + '|' + DATE)).toBe(true);
  });
});
