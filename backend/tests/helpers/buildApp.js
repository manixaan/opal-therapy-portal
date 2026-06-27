'use strict';

/**
 * Build a minimal Express app for integration tests.
 *
 * Uses an in-memory session store (no PostgreSQL required).
 * All external dependencies (database, email, APIs) are mocked by the caller
 * via jest.mock() before this module is required.
 *
 * `trust proxy` is enabled so tests can set X-Forwarded-For to get distinct
 * req.ip values, preventing cross-test rate-limit pollution.
 */

const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const helmet     = require('helmet');

module.exports = function buildApp() {
  const app = express();

  // Allow X-Forwarded-For header so tests can control req.ip per request
  app.set('trust proxy', 1);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));

  // In-memory sessions — no PostgreSQL needed in tests
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, httpOnly: true },
  }));

  // Mount all route modules (their database/email imports are mocked by jest.mock())
  app.use('/', require('../../auth'));
  app.use('/', require('../../register-routes'));
  app.use('/', require('../../routes'));
  app.use('/', require('../../app-routes'));
  app.use('/', require('../../calendar-routes'));
  app.use('/', require('../../invite-routes'));
  app.use('/', require('../../profile-routes'));
  app.use('/', require('../../maps-routes'));

  return app;
};
