'use strict';

/**
 * Integration tests for the ingestion register and the launch rules.
 *
 * Real PostgreSQL, real routes, real sessions. The privacy assertions matter
 * most here: the unit tests prove the redaction FUNCTION strips identity, and
 * these prove the DATABASE refuses to hold it and the API refuses to serve it,
 * which are the two claims that actually protect a participant.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');

const PASSWORD = 'IngestPass123';

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../resource-hub-r2-routes'));
  app.use('/', require('../../resource-ingestion-routes'));
  return app;
}

let app;
let org;

beforeAll(() => { app = buildApp(); });
afterAll(closePool);

beforeEach(async () => {
  await truncateAll();
  // These tests log in once per role per case, which trips the brute-force
  // limiter well before the suite finishes. Clearing it keeps the limiter in
  // place for the code under test without letting it fail unrelated cases.
  require('../../auth')._resetLoginRateLimit();
  org = await seedOrganisation('Opal Therapy');
});

async function agentFor(role, organisationId = null) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });
  await db.pool.query('UPDATE users SET organisation_id = $2 WHERE id = $1',
    [user.id, organisationId === null ? org.id : organisationId]);
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

/** Insert a register row directly — the importer is exercised separately. */
async function seedRegister(catalogueId, overrides = {}) {
  const row = {
    treatment: 'rights-review',
    ingestion_status: 'held',
    quality_status: 'not-applicable',
    proposed_title: `Title ${catalogueId}`,
    source_filename: `${catalogueId}.pdf`,
    source_reference: 'MENTAL HEALTH',
    checksum_sha256: null,
    topic: 'general-occupational-therapy',
    resource_type: 'reference-or-handout',
    source_organisation: 'Some Publisher',
    ...overrides,
  };
  const { rows } = await db.pool.query(
    `INSERT INTO resource_ingestion_register (
       organisation_id, catalogue_id, treatment, ingestion_status, quality_status,
       proposed_title, source_filename, source_reference, checksum_sha256,
       topic, resource_type, source_organisation)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [org.id, catalogueId, row.treatment, row.ingestion_status, row.quality_status,
      row.proposed_title, row.source_filename, row.source_reference, row.checksum_sha256,
      row.topic, row.resource_type, row.source_organisation]);
  return rows[0];
}

const PRIVATE = {
  treatment: 'privacy-excluded', ingestion_status: 'excluded', quality_status: 'not-applicable',
  proposed_title: null, source_filename: null, source_reference: null, checksum_sha256: null,
  source_organisation: null,
};

async function seedResource(overrides = {}) {
  const r = {
    title: 'A resource', status: 'approved', publication_state: 'approved',
    access_tier: 'staff', source_class: 'opal-original', rights_status: 'opal-owned',
    external_url: null, ...overrides,
  };
  const { rows } = await db.pool.query(
    `INSERT INTO resources (organisation_id, title, status, visibility, version, content_format,
        mandatory, acknowledgement_required, cpd_eligible, authority_level, target_roles,
        clinical_population, clinical_setting, publication_state, access_tier,
        source_class, rights_status, external_url)
     VALUES ($1,$2,$3,'staff',1,'markdown',FALSE,FALSE,FALSE,'internal','[]'::jsonb,
        '[]'::jsonb,'[]'::jsonb,$4,$5,$6,$7,$8) RETURNING *`,
    [org.id, r.title, r.status, r.publication_state, r.access_tier,
      r.source_class, r.rights_status, r.external_url]);
  return rows[0];
}

// ── The database refuses to hold private identity ───────────────────────────

describe('privacy is enforced by the schema', () => {
  test('a privacy-excluded row cannot be given a filename', async () => {
    const row = await seedRegister('res-0001', PRIVATE);
    await expect(db.pool.query(
      'UPDATE resource_ingestion_register SET source_filename = $2 WHERE id = $1',
      [row.id, 'Jane-Doe-report.pdf'])).rejects.toThrow(/privacy_excluded_stores_nothing_identifying/);
  });

  test.each(['proposed_title', 'source_reference', 'checksum_sha256', 'official_url'])(
    'a privacy-excluded row cannot be given %s', async (column) => {
      const row = await seedRegister('res-0002', PRIVATE);
      const value = column === 'official_url' ? 'https://example.invalid/x' : 'something-identifying';
      await expect(db.pool.query(
        `UPDATE resource_ingestion_register SET ${column} = $2 WHERE id = $1`, [row.id, value]))
        .rejects.toThrow(/privacy_excluded_stores_nothing_identifying/);
    });

  test('an ordinary row cannot be flipped to privacy-excluded while keeping its identity', async () => {
    const row = await seedRegister('res-0003');
    await expect(db.pool.query(
      `UPDATE resource_ingestion_register SET treatment = 'privacy-excluded' WHERE id = $1`, [row.id]))
      .rejects.toThrow(/privacy_excluded_stores_nothing_identifying/);
  });

  test('a private row cannot be linked to a resource', async () => {
    const row = await seedRegister('res-0004', PRIVATE);
    const resource = await seedResource();
    await expect(db.pool.query(
      'UPDATE resource_ingestion_register SET linked_resource_id = $2 WHERE id = $1',
      [row.id, resource.id])).rejects.toThrow(/privacy_excluded_stores_nothing_identifying/);
  });

  test('a source reference can never be an absolute path or a traversal', async () => {
    for (const bad of ['/Users/x/CLIENTS', '~/vault', 'a/../../etc', 'C:/vault']) {
      await expect(db.pool.query(
        `INSERT INTO resource_ingestion_register
           (organisation_id, catalogue_id, treatment, source_reference)
         VALUES ($1, 'res-bad', 'rights-review', $2)`, [org.id, bad]))
        .rejects.toThrow(/ingestion_source_reference_is_redacted/);
    }
  });

  test('an official URL must be https', async () => {
    await expect(db.pool.query(
      `INSERT INTO resource_ingestion_register
         (organisation_id, catalogue_id, treatment, official_url)
       VALUES ($1, 'res-http', 'live-official-link', 'http://insecure.invalid/x')`, [org.id]))
      .rejects.toThrow(/ingestion_official_url_is_https/);
  });
});

// ── Idempotency ─────────────────────────────────────────────────────────────

describe('idempotency', () => {
  test('the same catalogue id cannot be registered twice', async () => {
    await seedRegister('res-0010');
    await expect(seedRegister('res-0010')).rejects.toThrow(/uniq_ingestion_register_catalogue/);
  });

  test('two organisations may each hold the same catalogue id', async () => {
    const other = await seedOrganisation('Other Practice');
    await seedRegister('res-0011');
    const { rows } = await db.pool.query(
      `INSERT INTO resource_ingestion_register (organisation_id, catalogue_id, treatment)
       VALUES ($1, 'res-0011', 'rights-review') RETURNING id`, [other.id]);
    expect(rows).toHaveLength(1);
  });
});

// ── Role and organisation isolation ─────────────────────────────────────────

describe('access control', () => {
  test.each(['therapist', 'read_only'])('%s is refused the ingestion register', async (role) => {
    const { agent } = await agentFor(role);
    for (const url of [
      '/api/rh2/admin/ingestion/summary',
      '/api/rh2/admin/ingestion/records',
      '/api/rh2/admin/ingestion/cleanroom',
      '/api/rh2/admin/ingestion/instruments',
    ]) {
      const res = await agent.get(url);
      expect(res.status).toBe(403);
      // The refusal must not confirm what it is guarding.
      expect(JSON.stringify(res.body)).not.toMatch(/ingestion|catalogue|register/i);
    }
  });

  test('a therapist cannot alter a register record', async () => {
    await seedRegister('res-0020');
    const { agent } = await agentFor('therapist');
    const res = await agent.patch('/api/rh2/admin/ingestion/records/res-0020')
      .send({ ingestionStatus: 'imported' });
    expect(res.status).toBe(403);
  });

  test.each(['owner', 'admin'])('%s may read the register', async (role) => {
    await seedRegister('res-0021');
    const { agent } = await agentFor(role);
    const res = await agent.get('/api/rh2/admin/ingestion/records');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
  });

  test('one organisation never sees another organisation\'s register', async () => {
    const other = await seedOrganisation('Other Practice');
    await db.pool.query(
      `INSERT INTO resource_ingestion_register (organisation_id, catalogue_id, treatment, proposed_title)
       VALUES ($1, 'res-0030', 'rights-review', 'Other org record')`, [other.id]);
    await seedRegister('res-0031');

    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/admin/ingestion/records');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.records[0].catalogueId).toBe('res-0031');
    expect(JSON.stringify(res.body)).not.toMatch(/Other org record/);
  });
});

// ── What the API discloses ──────────────────────────────────────────────────

describe('register API disclosure', () => {
  test('a private record appears as an outcome but discloses nothing', async () => {
    await seedRegister('res-0040', PRIVATE);
    const { agent } = await agentFor('owner');

    const list = await agent.get('/api/rh2/admin/ingestion/records?treatment=privacy-excluded');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    const record = list.body.records[0];
    expect(record.catalogueId).toBe('res-0040');
    expect(record.title).toBe('Private record res-0040 — excluded');
    expect(record.sourceFilename).toBeNull();
    expect(record.sourceReference).toBeNull();
    expect(record.hasChecksum).toBe(false);

    const detail = await agent.get('/api/rh2/admin/ingestion/records/res-0040');
    expect(detail.status).toBe(200);
    expect(detail.body.checksumSha256).toBeNull();
    expect(detail.body.sourceFilename).toBeNull();
  });

  test('a private record cannot be re-treated through the API', async () => {
    await seedRegister('res-0041', PRIVATE);
    const { agent } = await agentFor('owner');
    const res = await agent.patch('/api/rh2/admin/ingestion/records/res-0041')
      .send({ treatment: 'live-vendor-link' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('privacy_excluded_is_permanent');
  });

  test('privacy exclusion cannot be applied by hand', async () => {
    await seedRegister('res-0042');
    const { agent } = await agentFor('owner');
    const res = await agent.patch('/api/rh2/admin/ingestion/records/res-0042')
      .send({ treatment: 'privacy-excluded' });
    expect(res.status).toBe(400);
  });

  test('an unknown filter value is rejected rather than silently ignored', async () => {
    await seedRegister('res-0043');
    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/admin/ingestion/records?treatment=not-a-treatment');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('invalid_filter_value');
  });

  test('a reviewer decision is stamped and audited', async () => {
    await seedRegister('res-0044');
    const { agent, user } = await agentFor('owner');
    const res = await agent.patch('/api/rh2/admin/ingestion/records/res-0044')
      .send({ ingestionStatus: 'imported', reason: 'Confirmed by hand.' });
    expect(res.status).toBe(200);
    expect(res.body.reviewerUserId).toBe(user.id);

    const detail = await agent.get('/api/rh2/admin/ingestion/records/res-0044');
    const event = detail.body.auditHistory.find((e) => e.field === 'ingestion_status');
    expect(event).toBeTruthy();
    expect(event.to_value).toBe('imported');
    expect(event.reason).toBe('Confirmed by hand.');
  });

  test('the summary reports whether the register still reconciles', async () => {
    await seedRegister('res-0050');
    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/admin/ingestion/summary');
    expect(res.status).toBe(200);
    expect(res.body.expectedTotal).toBe(650);
    expect(res.body.total).toBe(1);
    // Honest rather than flattering: one row is not 650.
    expect(res.body.reconciles).toBe(false);
  });
});

// ── The register is not part of the Resource Hub ────────────────────────────

describe('register isolation from the staff library', () => {
  test('a register entry does not become a searchable resource', async () => {
    await seedRegister('res-0060', { proposed_title: 'Distinctive Register Title' });
    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/resources?q=Distinctive');
    expect(res.status).toBe(200);
    const titles = JSON.stringify(res.body);
    expect(titles).not.toMatch(/Distinctive Register Title/);
  });

  test('an excluded-private RESOURCE is invisible to everyone, including the owner', async () => {
    await seedResource({
      title: 'Quarantined Client Material', access_tier: 'excluded-private',
      publication_state: 'excluded-private', status: 'approved',
    });
    for (const role of ['owner', 'admin', 'therapist']) {
      const { agent } = await agentFor(role);
      const list = await agent.get('/api/rh2/resources');
      expect(JSON.stringify(list.body)).not.toMatch(/Quarantined Client Material/);
      const search = await agent.get('/api/rh2/resources?q=Quarantined');
      expect(JSON.stringify(search.body)).not.toMatch(/Quarantined Client Material/);
    }
  });

  test('an excluded-private resource cannot be fetched directly', async () => {
    const r = await seedResource({
      title: 'Quarantined', access_tier: 'excluded-private', publication_state: 'excluded-private',
    });
    const { agent } = await agentFor('owner');
    const res = await agent.get(`/api/rh2/resources/${r.id}`);
    expect(res.status).toBe(404);
  });
});

// ── Launch rules ────────────────────────────────────────────────────────────

describe('what a therapist may see', () => {
  test('a staged resource is not offered as available', async () => {
    await seedResource({ title: 'Staged Draft', status: 'draft', publication_state: 'clinical-review' });
    await seedResource({ title: 'Live Guide', status: 'approved', publication_state: 'approved' });
    const { agent } = await agentFor('therapist');
    const res = await agent.get('/api/rh2/resources');
    const body = JSON.stringify(res.body);
    expect(body).toMatch(/Live Guide/);
    expect(body).not.toMatch(/Staged Draft/);
  });

  test('a legacy-approved record still in governance review is not offered', async () => {
    // The exact drift the two lifecycles exist to expose.
    await seedResource({ title: 'Legacy Mismatch', status: 'approved', publication_state: 'rights-review' });
    const { agent } = await agentFor('therapist');
    const res = await agent.get('/api/rh2/resources');
    expect(JSON.stringify(res.body)).not.toMatch(/Legacy Mismatch/);
  });
});

describe('link and instrument records host no files', () => {
  test('an official-link resource has no file rows', async () => {
    const r = await seedResource({
      title: 'Official Link', source_class: 'government-official',
      rights_status: 'official-link-only', external_url: 'https://example.invalid/page',
    });
    const { rows } = await db.pool.query(
      'SELECT COUNT(*)::int AS n FROM resource_files WHERE resource_id = $1', [r.id]);
    expect(rows[0].n).toBe(0);
  });

  test('the instrument view reports zero hosted proprietary files', async () => {
    await db.pool.query(
      `INSERT INTO controlled_instruments
         (organisation_id, key, name, abbreviation, access_restriction, rights_status,
          clinical_status, evidence_checked, state)
       VALUES ($1,'moca','Montreal Cognitive Assessment','MoCA','clinician','restricted',
          'unreviewed',FALSE,'active')`, [org.id]);
    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/admin/ingestion/instruments');
    expect(res.status).toBe(200);
    expect(res.body.hostedProprietaryFiles).toBe(0);
  });
});

describe('clean-room drafts stay staged', () => {
  test('a clean-room provenance record blocks a legal-tier item explicitly', async () => {
    await db.pool.query(
      `INSERT INTO resource_cleanroom_provenance
         (organisation_id, catalogue_id, clinical_purpose, risk_tier, legal_gate, blocker_note)
       VALUES ($1,'res-0624','Service terms.','legal','blocked','Legal review required.')`, [org.id]);
    const { agent } = await agentFor('owner');
    const res = await agent.get('/api/rh2/admin/ingestion/cleanroom');
    expect(res.status).toBe(200);
    const item = res.body.items.find((i) => i.catalogue_id === 'res-0624');
    expect(item.legal_gate).toBe('blocked');
    expect(item.resource_id).toBeNull();
  });

  test('a legal-tier item cannot silently carry "not-required" for its legal gate', async () => {
    await expect(db.pool.query(
      `INSERT INTO resource_cleanroom_provenance
         (organisation_id, catalogue_id, clinical_purpose, risk_tier, legal_gate)
       VALUES ($1,'res-0700','Contract terms.','legal','not-required')`, [org.id]))
      .rejects.toThrow(/legal_tier_requires_legal_gate/);
  });
});
