'use strict';

/**
 * Calendar legend colours — each user's category → Outlook preset choices are
 * kept in user_settings.calendarCategoryColours via PATCH /api/settings.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { truncateAll, seedUser, closePool } = require('./helpers');

const PASSWORD = 'ColourPass1';

function buildApp() {
  const app = express();
  app.use(bodyParser.json());
  app.use(session({ secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false, cookie: { secure: false } }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../app-routes'));
  return app;
}

async function agentFor(app, overrides) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, ...overrides });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

beforeEach(truncateAll);
afterAll(closePool);

describe('calendar category colours', () => {
  test('signed-out requests are refused', async () => {
    const res = await request(buildApp()).patch('/api/settings')
      .send({ calendarCategoryColours: { travel: 'preset8' } });
    expect(res.status).toBe(401);
  });

  test('a therapist saves colours, gets them back, and the map is replaced on the next save', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    let res = await agent.patch('/api/settings')
      .send({ calendarCategoryColours: { 'Client Appointments': 'preset7', Travel: 'preset8' } });
    expect(res.status).toBe(200);
    res = await agent.get('/api/settings');
    expect(res.body.settings.calendarCategoryColours)
      .toEqual({ 'client appointments': 'preset7', travel: 'preset8' });

    await agent.patch('/api/settings').send({ calendarCategoryColours: { travel: 'preset24' } });
    res = await agent.get('/api/settings');
    expect(res.body.settings.calendarCategoryColours).toEqual({ travel: 'preset24' });
  });

  test('unknown presets and oversized names are dropped; a non-object is refused', async () => {
    const app = buildApp();
    const { agent } = await agentFor(app, { role: 'therapist' });

    let res = await agent.patch('/api/settings').send({ calendarCategoryColours: {
      admin: 'preset25', meetings: '#ff0000', ['x'.repeat(81)]: 'preset1', 'do not book': 'preset24',
    } });
    expect(res.status).toBe(200);
    res = await agent.get('/api/settings');
    expect(res.body.settings.calendarCategoryColours).toEqual({ 'do not book': 'preset24' });

    res = await agent.patch('/api/settings').send({ calendarCategoryColours: ['preset1'] });
    expect(res.status).toBe(400);
  });
});
