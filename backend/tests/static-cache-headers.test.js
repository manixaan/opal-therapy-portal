'use strict';

/**
 * Static cache headers (audit P-06 part 2). An app wired exactly as server.js
 * wires the frontend — express.static with static-cache.js's setHeaders, a
 * sendFile page route and an /api route — over the real frontend/current.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const { setStaticCacheHeaders, hasVersionPin, IMMUTABLE } = require('../static-cache');

const FRONTEND = path.join(__dirname, '../../frontend/current');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');

function app() {
  const a = express();
  a.use(express.static(FRONTEND, { setHeaders: setStaticCacheHeaders }));
  a.get('/login', (req, res) => res.sendFile(path.join(FRONTEND, 'login.html')));
  a.get('/api/ping', (req, res) => res.json({ ok: true }));
  return a;
}

/* A real pin from the shell, so the test follows the files that exist. */
const PIN = (SHELL.match(/<script[^>]+src="\/([\w.-]+\.js)\?v=([^"&]+)"/) || []).slice(1);

describe('static cache headers', () => {
  test('server.js wires static-cache.js into express.static', () => {
    const src = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
    expect(src).toMatch(/express\.static\(frontendPath, \{ setHeaders: require\('\.\/static-cache'\)\.setStaticCacheHeaders \}\)/);
  });

  test('a ?v=-pinned asset from the shell is immutable for a year', async () => {
    expect(PIN).toHaveLength(2);
    const r = await request(app()).get(`/${PIN[0]}?v=${PIN[1]}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe(IMMUTABLE);
  });

  test('a pinned stylesheet is immutable too', async () => {
    const r = await request(app()).get('/dialog.css?v=2');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe(IMMUTABLE);
  });

  test('the same asset without ?v= keeps the default (revalidated) behaviour', async () => {
    const r = await request(app()).get(`/${PIN[0]}`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=0');
    expect(r.headers.etag).toBeTruthy();
  });

  test('another query parameter is not a version pin', async () => {
    const r = await request(app()).get(`/${PIN[0]}?vv=1&x=v=2`);
    expect(r.headers['cache-control']).toBe('public, max-age=0');
  });

  test('HTML is never cached without revalidation — even with ?v=', async () => {
    for (const url of ['/login.html', '/mockup_v3.html', '/login.html?v=9']) {
      const r = await request(app()).get(url);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-cache');
    }
    // A page served by sendFile keeps today's revalidated default.
    const page = await request(app()).get('/login');
    expect(page.headers['cache-control']).toBe('public, max-age=0');
  });

  test('/api is untouched', async () => {
    const r = await request(app()).get('/api/ping?v=3');
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBeUndefined();
  });

  test('a missing pinned file is a plain 404, not a cached one', async () => {
    const r = await request(app()).get('/no-such-file.js?v=1');
    expect(r.status).toBe(404);
    expect(r.headers['cache-control'] || '').not.toMatch(/immutable/);
  });

  test('hasVersionPin', () => {
    expect(hasVersionPin('/a.js?v=12')).toBe(true);
    expect(hasVersionPin('/a.js?x=1&v=r33')).toBe(true);
    expect(hasVersionPin('/a.js?v=')).toBe(false);
    expect(hasVersionPin('/a.js')).toBe(false);
    expect(hasVersionPin('/a.js?version=2')).toBe(false);
  });
});
