'use strict';

/**
 * Health/readiness integration tests — real router, real DB, real migration
 * ledger.
 */

const express = require('express');
const request = require('supertest');

const { db, closePool } = require('./helpers');
const migrate = require('../../migrate');

function buildApp() {
  const app = express();
  const health = require('../../health-routes');
  app.use(health.router);
  return { app, health };
}

afterAll(async () => {
  // Restore a clean, fully-applied ledger for later suites.
  await db.pool.query('DROP TABLE IF EXISTS schema_migrations');
  await migrate.migrate();
  await closePool();
});

describe('GET /health (liveness)', () => {
  test('200 with sanitised process info only', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.version).toBeTruthy();
    expect(typeof res.body.uptimeSeconds).toBe('number');
    // Must not leak infrastructure details
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/password|secret|connection|host|5432/i);
  });
});

describe('GET /ready (readiness)', () => {
  test('200 ready when DB up and migrations applied', async () => {
    await migrate.migrate(); // ensure applied
    const { app } = buildApp();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    expect(res.body.checks.database).toBe('ok');
    expect(res.body.checks.migrations).toBe('ok');
    expect(res.body.checks.config).toBe('ok');
  });

  test('503 with migrations pending', async () => {
    await db.pool.query('DROP TABLE IF EXISTS schema_migrations');
    // Recreate empty ledger → all files count as pending
    await migrate.ensureMigrationsTable();
    const { app } = buildApp();
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.ready).toBe(false);
    expect(res.body.checks.migrations).toMatch(/^pending:/);
    await migrate.migrate(); // restore
  });

  test('503 while draining (shutdown)', async () => {
    const { app, health } = buildApp();
    health.setDraining(true);
    const res = await request(app).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.reason).toBe('shutting_down');
    health.setDraining(false);
  });

  test('never exposes connection details in any state', async () => {
    const { app } = buildApp();
    const res = await request(app).get('/ready');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/postgres|localhost|password|connection/i);
  });
});
