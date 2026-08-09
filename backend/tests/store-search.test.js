/**
 * Therapy Store supplier search — config gating, result mapping, quota care.
 * The Google CSE call itself is mocked; no network in tests.
 */

'use strict';

jest.mock('axios');
const axios = require('axios');

const { mapItems } = require('../store-search-routes');

describe('store search result mapping', () => {
  test('maps title/link/snippet/site and caps at 8', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: 'Weighted Lap Pad ' + i,
      link: 'https://sensorytools.net/products/pad-' + i,
      snippet: 'A calming weighted pad.',
      displayLink: 'www.sensorytools.net',
      pagemap: { cse_thumbnail: [{ src: 'https://img.example/t.jpg' }] },
    }));
    const out = mapItems(items);
    expect(out).toHaveLength(8);
    expect(out[0]).toEqual({
      title: 'Weighted Lap Pad 0',
      link: 'https://sensorytools.net/products/pad-0',
      snippet: 'A calming weighted pad.',
      site: 'sensorytools.net',
      thumbnail: 'https://img.example/t.jpg',
    });
  });

  test('drops non-https links and unsafe thumbnails', () => {
    const out = mapItems([
      { title: 'A', link: 'http://insecure.example/x', displayLink: 'x' },
      { title: 'B', link: 'javascript:alert(1)', displayLink: 'x' },
      { title: 'C', link: 'https://ok.example/p', displayLink: 'ok.example',
        pagemap: { cse_thumbnail: [{ src: 'data:image/png;base64,x' }] } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('C');
    expect(out[0].thumbnail).toBeNull();
  });

  test('empty input yields empty results', () => {
    expect(mapItems(undefined)).toEqual([]);
    expect(mapItems([])).toEqual([]);
  });
});

jest.mock('../permissions', () => ({
  requireAuth: (req, res, next) => {
    const u = global.__TEST_USER;
    if (!u) return res.status(401).json({ error: 'unauthenticated' });
    req.user = u;
    next();
  },
}));

describe('store search route behaviour', () => {
  const request = require('supertest');
  const express = require('express');
  const routes = require('../store-search-routes');
  const appOnce = express();
  appOnce.use(routes);

  function buildAppWith(user) {
    global.__TEST_USER = user;
    routes._resetStoreSearchRateLimit();
    return appOnce;
  }

  afterEach(() => {
    delete process.env.GOOGLE_CSE_KEY;
    delete process.env.GOOGLE_CSE_CX;
  });

  test('unauthenticated requests are rejected', async () => {
    const a = buildAppWith(null);
    const res = await request(a).get('/api/store/search?q=putty');
    expect(res.status).toBe(401);
  });

  test('missing config degrades gracefully, never errors', async () => {
    const a = buildAppWith({ id: 'u1', role: 'therapist' });
    const cfg = await request(a).get('/api/store/search/config');
    expect(cfg.body).toEqual({ enabled: false });
    const res = await request(a).get('/api/store/search?q=putty');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, results: [] });
  });

  test('configured search proxies the CSE and returns mapped results', async () => {
    process.env.GOOGLE_CSE_KEY = 'k';
    process.env.GOOGLE_CSE_CX = 'cx';
    axios.get.mockResolvedValueOnce({ data: { items: [
      { title: 'Theraputty 4oz', link: 'https://performancehealth.com.au/theraputty',
        snippet: 'Hand therapy putty.', displayLink: 'www.performancehealth.com.au' },
    ] } });
    const a = buildAppWith({ id: 'u2', role: 'therapist' });
    const res = await request(a).get('/api/store/search?q=theraputty');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.results[0].site).toBe('performancehealth.com.au');
    // key stays server-side: response carries no config
    expect(JSON.stringify(res.body)).not.toContain('GOOGLE');
  });

  test('identical queries within the hour are served from cache (one upstream call)', async () => {
    process.env.GOOGLE_CSE_KEY = 'k';
    process.env.GOOGLE_CSE_CX = 'cx';
    axios.get.mockResolvedValue({ data: { items: [
      { title: 'Pencil grips', link: 'https://teaching.com.au/grips', snippet: 's', displayLink: 'teaching.com.au' },
    ] } });
    const a = buildAppWith({ id: 'u3', role: 'therapist' });
    axios.get.mockClear();
    await request(a).get('/api/store/search?q=Pencil Grips');
    const second = await request(a).get('/api/store/search?q=pencil grips');
    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(second.body.cached).toBe(true);
  });

  test('short queries are rejected with 400', async () => {
    process.env.GOOGLE_CSE_KEY = 'k';
    process.env.GOOGLE_CSE_CX = 'cx';
    const a = buildAppWith({ id: 'u4', role: 'therapist' });
    const res = await request(a).get('/api/store/search?q=a');
    expect(res.status).toBe(400);
  });

  test('per-user rate limit returns a controlled 429', async () => {
    process.env.GOOGLE_CSE_KEY = 'k';
    process.env.GOOGLE_CSE_CX = 'cx';
    axios.get.mockResolvedValue({ data: { items: [] } });
    const a = buildAppWith({ id: 'u5', role: 'therapist' });
    let last;
    for (let i = 0; i < 31; i++) {
      last = await request(a).get('/api/store/search?q=unique' + i);
    }
    expect(last.status).toBe(429);
    expect(last.body.error).toBe('rate_limited');
  });

  test('upstream failure yields a friendly 502, catalogue unaffected', async () => {
    process.env.GOOGLE_CSE_KEY = 'k';
    process.env.GOOGLE_CSE_CX = 'cx';
    axios.get.mockRejectedValueOnce(Object.assign(new Error('boom'), { response: { status: 500 } }));
    const a = buildAppWith({ id: 'u6', role: 'therapist' });
    const res = await request(a).get('/api/store/search?q=weighted blanket');
    expect(res.status).toBe(502);
    expect(res.body.message).toContain('catalogue still works');
  });
});
