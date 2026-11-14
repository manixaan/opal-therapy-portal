'use strict';

/**
 * Opal Assist's body limit: the server's own parser chain (body-limits.js)
 * must let a maximum-length Assist message through. With only the global
 * 100 kB default a long or multi-byte draft answered 413 before the route's
 * own length check could run.
 */
const express = require('express');
const request = require('supertest');
const { applyBodyLimits } = require('../body-limits');

function app() {
  const a = express();
  applyBodyLimits(a);
  a.post('/api/assist/chat', (req, res) => res.json({ chars: (req.body.message || '').length }));
  a.post('/api/other', (req, res) => res.json({ ok: true }));
  return a;
}

test('a 30,000-character multi-byte message (≈ 90 kB+) reaches the Assist route', async () => {
  const message = 'é—'.repeat(15000) + ' and an attachment ' + 'x'.repeat(30000);
  const r = await request(app()).post('/api/assist/chat').send({ message });
  expect(r.status).toBe(200);
  expect(r.body.chars).toBe(message.length);
});

test('other routes keep the 100 kB default', async () => {
  const r = await request(app()).post('/api/other').send({ blob: 'x'.repeat(150000) });
  expect(r.status).toBe(413);
});
