'use strict';
/** An Office task pane reaches /api/assist with a Microsoft bearer and no cookie. */
jest.mock('../database', () => ({ pool: { query: jest.fn().mockResolvedValue({ rows: [] }) }, getUserByEmail: jest.fn(), getUser: jest.fn(), logAuditEvent: jest.fn() }));
jest.mock('../splose-api', () => ({ isConfigured: () => false }));
jest.mock('../assist/entra-auth', () => ({
  entraBearerAuth: (req, res, next) => {
    if (!req.headers.authorization) return next();
    if (req.headers.authorization === 'Bearer good') { req.user = { id: 'u1', role: 'therapist', permissions: [] }; req.authVia = 'entra'; return next(); }
    return res.status(401).json({ code: 'bad_signature' });
  },
}));
const request = require('supertest');
const express = require('express');
const session = require('express-session');
function app() { const a = express(); a.use(express.json()); a.use(session({ secret: 't', resave: false, saveUninitialized: false })); a.use('/', require('../assist-routes')); return a; }

test('a good Microsoft bearer signs in without a session; a bad one is 401; none falls back to the session (401)', async () => {
  expect((await request(app()).get('/api/assist/config').set('Authorization', 'Bearer good')).status).toBe(200);
  expect((await request(app()).get('/api/assist/config').set('Authorization', 'Bearer forged')).status).toBe(401);
  expect((await request(app()).get('/api/assist/config')).status).toBe(401);
});
