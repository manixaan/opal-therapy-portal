'use strict';

/**
 * Jest globalSetup for the integration suite.
 *
 * Runs once before all integration test files:
 *   1. Applies the same env + safety guards as env.js (globalSetup does not
 *      receive setupFiles, so it loads them explicitly).
 *   2. Creates the *_test database if it does not exist.
 *   3. Applies the full application schema (INIT_QUERIES via initializeDatabase).
 */

module.exports = async function globalSetup() {
  require('./env'); // env + hard safety guards

  const { Client } = require('pg');

  const admin = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${process.env.DB_NAME}"`);
    console.log(`[integration] created test database ${process.env.DB_NAME}`);
  } catch (err) {
    if (err.code !== '42P04') throw err; // 42P04 = already exists
  } finally {
    await admin.end();
  }

  // Apply schema using the application's own initialiser so the test schema
  // is always exactly what production boot would create.
  const db = require('../../database');
  const ok = await db.initializeDatabase();
  if (!ok) throw new Error('[integration] schema initialisation failed');
  await db.pool.end();
  console.log(`[integration] schema ready on ${process.env.DB_NAME}`);
};
