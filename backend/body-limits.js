'use strict';

/**
 * REQUEST BODY LIMITS - the server's JSON parser chain, in one place.
 *
 * server.js calls applyBodyLimits(app) exactly where these mounts used to sit
 * inline. They live here so a test can mount the SAME chain the server runs:
 * a route test that installs its own generous parser proves nothing about the
 * limit a real request meets, and that is how the Library upload shipped with
 * the global 100 kB default (every file over ~75 kB answered 413).
 *
 * Order matters: a more specific path is mounted before a broader one
 * (express runs the first parser that matches, and a parsed body is not
 * re-parsed), and every subtree limit comes before the global default.
 */

const bodyParser = require('body-parser');

function applyBodyLimits(app) {
  // Document uploads carry base64 file bytes (documented cap: 5 MB binary ≈
  // 6.7 MB base64) — that one route gets a larger JSON limit. Everything else
  // keeps the small default limit as a request-size defence.
  app.use('/api/profile/documents', bodyParser.json({ limit: '8mb' }));

  // Credential scans: the certificate itself (5 MB binary cap enforced in the
  // route, ≈ 6.7 MB base64) and, for a read, the page images the browser
  // rasterised from it (credential-extraction.js caps those at 3 pages × 2 MB).
  // Without this the subtree keeps the 100kb default and a photographed WWCC
  // card 413s before any route sees it.
  app.use('/api/profile/credentials', bodyParser.json({ limit: '12mb' }));

  // Support-ticket screenshots use the same base64 upload pattern (5 MB cap
  // enforced in the route) — the /api/support subtree gets the larger limit.
  app.use('/api/support', bodyParser.json({ limit: '8mb' }));

  // Template appendices: an attached PDF travels as base64 (15 MB binary cap
  // enforced in templates/appendices.js ≈ 20 MB of base64).
  app.use('/api/templates/documents', bodyParser.json({ limit: '21mb' }));

  // Resource Hub file uploads: base64 bytes, 25 MB binary cap enforced in the
  // route (≈ 34 MB of base64). Same pattern as the two subtrees above.
  app.use('/api/rh2/resources', bodyParser.json({ limit: '36mb' }));

  // The Library's own doors take the same bytes: upload into a folder and
  // replace a document with a new version (25 MB binary cap enforced in
  // resource-file-intake.js ≈ 34 MB of base64). Without this mount they fell
  // through to the 100 kB global default below.
  app.use('/api/rh2/library', bodyParser.json({ limit: '36mb' }));

  // Learning workflow drafts carry whole-course content (learning-content.js
  // permits up to 200 items of markdown ≈ 4 MB) — the global 100kb default
  // would 413 a legitimately large draft before the route could validate it.
  app.use('/api/learning', bodyParser.json({ limit: '8mb' }));

  // Onboarding document-library imports: a whole ZIP of official resources,
  // 45 MB binary cap enforced in the route (≈ 60 MB of base64). Mounted BEFORE
  // the broader /api/onboarding limit so the more specific path wins.
  app.use('/api/onboarding/imports', bodyParser.json({ limit: '62mb' }));

  // Onboarding evidence and policy uploads: base64 bytes, 5 MB (employee) and
  // 10 MB (library) caps enforced in the routes.
  app.use('/api/onboarding', bodyParser.json({ limit: '16mb' }));

  // Interview answers are long-form narrative typed live during an interview.
  // The per-answer ceiling (interview-templates.js MAX_ANSWER_CHARS, 200k chars)
  // is a storage-sanity limit rather than a UX one, so a full interview can
  // legitimately exceed the 100kb default and must not 413 mid-save. 4 MB is
  // several times the largest interview anyone could type.
  app.use('/api/interviews', bodyParser.json({ limit: '4mb' }));

  // A template document holds one answer per control the master declares — the
  // Service Agreement has 82, each accepting up to 4,000 characters. A fully
  // completed agreement therefore exceeds the 100kb default and would 413 on
  // save before the route could validate a single field.
  app.use('/api/templates', bodyParser.json({ limit: '4mb' }));

  // Trip-cost receipts (PDF / photo, ≤ 8 MB decoded) travel as base64 JSON.
  app.use('/api/invoicing/trips', bodyParser.json({ limit: '12mb' }));

  app.use(bodyParser.json());
  app.use(bodyParser.urlencoded({ extended: true }));
  return app;
}

module.exports = { applyBodyLimits };
