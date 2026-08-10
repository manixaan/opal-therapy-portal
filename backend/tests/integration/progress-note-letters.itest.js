'use strict';

/**
 * PROGRESS NOTE LETTERS — integration tests (real Express, real sessions,
 * real SQL, real DOCX bytes).
 *
 * Splose is the one thing stubbed: it is an external system, and the tests must
 * be able to assert exactly what the "live" layer returned. Everything else —
 * routing, RBAC, organisation isolation, the profile layer, the org-settings
 * letterhead layer, generation, storage and audit — runs for real.
 *
 * Covers the acceptance items that only exist above the engine: required blocks
 * refused at the API, missing required values blocking generation, preview and
 * document sharing one manifest, the frozen snapshot, recipient save-back being
 * explicit, audit carrying ids but never names, organisation isolation, and the
 * named end-to-end scenario.
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const JSZip = require('jszip');
const { DOMParser } = require('@xmldom/xmldom');

// Splose is stubbed before the route module loads. The state object is declared
// out here (jest allows out-of-scope names prefixed "mock") so the tests can
// drive it.
const mockSplose = { patients: new Map(), fail: false };

jest.mock('../../splose-api', () => ({
  getPatients: jest.fn(async () => {
    if (mockSplose.fail) throw new Error('splose down');
    return [...mockSplose.patients.values()];
  }),
  getPatient: jest.fn(async (id) => {
    if (mockSplose.fail) throw new Error('splose down');
    const p = mockSplose.patients.get(String(id));
    if (!p) { const e = new Error('not found'); e.response = { status: 404 }; throw e; }
    return p;
  }),
}));

const setPatients = (list) => {
  mockSplose.patients.clear();
  for (const p of list) mockSplose.patients.set(String(p.id), p);
};

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const ltm = require('../../fca/letter-template-map');

const PASSWORD = 'LetterPass123';

const RILEY = {
  id: 'splose-riley', firstname: 'Riley', lastname: 'Thompson', fullName: 'Riley Anne Thompson',
  email: 'riley@example.invalid', mobilePhone: '0400 111 111', ndisNumber: '430998877',
  formattedAddress: '1 River Road, Perth WA 6000',
};
const CASEY = {
  id: 'splose-casey', firstname: 'Casey', lastname: 'Nguyen', fullName: 'Casey Nguyen',
  email: 'casey@example.invalid', mobilePhone: '0400 222 222', ndisNumber: '431556677',
  formattedAddress: '2 Creek Lane, Perth WA 6000',
};

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '8mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false,
    saveUninitialized: false, cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../letter-routes'));
  return app;
}

let app;

/**
 * seedUser() only writes the columns it declares, so organisation membership
 * and the author's own contact details are applied here — this feature is
 * organisation-scoped and reads author facts off the user row.
 */
async function agentFor(role, {
  organisation_id = null, name = null, phone = null, role_title = null,
} = {}) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role });

  const { rows } = await db.pool.query(
    `UPDATE users SET organisation_id = $2,
            name = COALESCE($3, name), phone = COALESCE($4, phone),
            role_title = COALESCE($5, role_title)
      WHERE id = $1 RETURNING *`,
    [user.id, organisation_id, name, phone, role_title]
  );

  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user: rows[0] };
}

/** The four letterhead facts, stored where the portal already stores org settings. */
async function seedLetterhead(organisationId, overrides = {}) {
  const settings = {
    name: 'Opal Therapy',
    businessAddress: 'Unit 5, 120 Hay Street\nSubiaco WA 6008',
    businessPhone: '08 9000 2222',
    businessEmail: 'hello@opaltherapy.invalid',
    website: 'www.opaltherapy.invalid',
    ...overrides,
  };
  await db.pool.query(
    `INSERT INTO org_settings (org_id, settings) VALUES ($1, $2)
     ON CONFLICT (org_id) DO UPDATE SET settings = $2`,
    [String(organisationId), JSON.stringify(settings)]
  );
  return settings;
}

async function seedCredentials(userId, organisationId) {
  await db.pool.query(
    `INSERT INTO credentials (user_id, organisation_id, credential_type, credential_name,
                              issuing_body, registration_number, status)
     VALUES ($1,$2,'AHPRA registration','AHPRA Registered Occupational Therapist','AHPRA','OCC0001234567','active')`,
    [userId, organisationId]
  );
}

async function createDraft(agent, clientId) {
  const res = await agent.post('/api/letters/drafts').send({ clientId });
  expect(res.status).toBe(201);
  return res.body.draft;
}

/** A fully addressed, generation-ready draft. */
async function readyDraft(agent, clientId, patch = {}) {
  const draft = await createDraft(agent, clientId);
  const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({
    recipient: {
      name: 'Morgan Reid',
      role: 'Support Coordinator',
      organisation: 'Southern Rivers Coordination',
      address: 'Level 2, 88 Wellington Street\nEast Perth WA 6004',
      salutation: 'Morgan',
    },
    letterDetails: {
      letterDate: '2026-08-10',
      subject: 'Progress update and continued therapy funding',
      reportingPeriod: '1 February 2026 to 31 July 2026',
    },
    ...patch,
  });
  expect(res.status).toBe(200);
  return res.body.draft;
}

async function docxOf(agent, documentId) {
  const res = await agent.get(`/api/letters/documents/${documentId}/download`).buffer().parse((r, cb) => {
    const chunks = [];
    r.on('data', (c) => chunks.push(Buffer.from(c)));
    r.on('end', () => cb(null, Buffer.concat(chunks)));
  });
  expect(res.status).toBe(200);
  return res.body;
}

const partText = async (buffer, name) => {
  const zip = await JSZip.loadAsync(buffer);
  return zip.file(name).async('string');
};

const auditRows = async (action) => (await db.pool.query(
  'SELECT * FROM audit_logs WHERE action = $1 ORDER BY created_at DESC', [action]
)).rows;

beforeAll(() => { app = buildApp(); });

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit?.();
  mockSplose.fail = false;
  setPatients([RILEY, CASEY]);
});

afterAll(closePool);

// ═══════════════════════════════════════════════════════════════════════════
//  Access control
// ═══════════════════════════════════════════════════════════════════════════

describe('access control', () => {
  test('unauthenticated requests are refused', async () => {
    const res = await request(app).get('/api/letters/template');
    expect([401, 403]).toContain(res.status);
  });

  test('admin — a non-clinical scheduling role here — has no access at all', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('admin', { organisation_id: org.id });

    expect((await agent.get('/api/letters/template')).status).toBe(403);
    expect((await agent.get('/api/letters/clients')).status).toBe(403);
    expect((await agent.get('/api/letters/drafts')).status).toBe(403);
    expect((await agent.post('/api/letters/drafts').send({ clientId: RILEY.id })).status).toBe(403);
  });

  test('read_only can read the template but cannot create or generate', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('read_only', { organisation_id: org.id });

    expect((await agent.get('/api/letters/template')).status).toBe(200);
    expect((await agent.get('/api/letters/clients')).status).toBe(200);
    expect((await agent.post('/api/letters/drafts').send({ clientId: RILEY.id })).status).toBe(403);
  });

  test('a user with no organisation is refused', async () => {
    const { agent } = await agentFor('therapist', { organisation_id: null });
    const res = await agent.get('/api/letters/template');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_organisation');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Template
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/letters/template', () => {
  test('returns the fixed contract shape', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const { body } = await agent.get('/api/letters/template');
    expect(body.template.documentType).toBe('progress_note_letter');
    expect(body.template.version).toBe('v1');
    expect(body.template.sections).toHaveLength(5);
    expect(body.template.sections.filter((s) => s.required).map((s) => s.label))
      .toEqual(['Purpose and context', 'Therapy and progress update']);
    expect(body.template.sections.every((s) => s.defaultSelected)).toBe(true);
    expect(body.template.scalarTags).toHaveLength(24);
    expect(body.template.profileEligibleTags).toEqual(['OPAL_CLIENT_PREFERRED_NAME']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Clients and contacts
// ═══════════════════════════════════════════════════════════════════════════

describe('clients and contacts', () => {
  test('client search behaves exactly as the FCA wizard\'s does', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const all = await agent.get('/api/letters/clients');
    expect(all.body.clients.map((c) => c.id).sort()).toEqual([CASEY.id, RILEY.id].sort());

    const filtered = await agent.get('/api/letters/clients?q=riley');
    expect(filtered.body.clients.map((c) => c.id)).toEqual([RILEY.id]);
  });

  test('a Splose outage is reported, never papered over with an empty list', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    mockSplose.fail = true;

    const res = await agent.get('/api/letters/clients');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('splose_unavailable');
  });

  test('contacts are derived from the client report profile, and nothing is invented', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', { organisation_id: org.id });

    await db.pool.query(
      `INSERT INTO fca_client_profiles
         (organisation_id, splose_client_id, created_by_user_id,
          support_coordinator_details, nominee_details, other_contacts)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [org.id, RILEY.id, user.id,
        'Morgan Reid\nLevel 2, 88 Wellington Street\nEast Perth WA 6004',
        'Pat Thompson',
        JSON.stringify([{ name: 'Alex Tan', role: 'Plan Manager', organisation: 'Bright Futures' }])]
    );

    const { body } = await agent.get(`/api/letters/clients/${RILEY.id}/contacts`);
    const bySource = Object.fromEntries(body.contacts.map((c) => [c.source, c]));

    expect(bySource.support_coordinator).toEqual({
      source: 'support_coordinator',
      name: 'Morgan Reid',
      role: 'Support Coordinator',
      organisation: null, // never guessed out of free text
      address: 'Level 2, 88 Wellington Street\nEast Perth WA 6004',
      salutation: 'Morgan Reid',
    });
    expect(bySource.nominee).toEqual({
      source: 'nominee', name: 'Pat Thompson', role: 'Nominee',
      organisation: null, address: null, salutation: 'Pat Thompson',
    });
    expect(bySource.saved_contact.organisation).toBe('Bright Futures');
    // The referrer column is empty, so no referrer contact is offered.
    expect(bySource.referrer).toBeUndefined();
  });

  test('another organisation\'s profile is invisible', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { user: userB } = await agentFor('therapist', { organisation_id: orgB.id });
    const { agent: agentA } = await agentFor('therapist', { organisation_id: orgA.id });

    await db.pool.query(
      `INSERT INTO fca_client_profiles
         (organisation_id, splose_client_id, created_by_user_id, support_coordinator_details)
       VALUES ($1,$2,$3,$4)`,
      [orgB.id, RILEY.id, userB.id, 'Secret Coordinator']
    );

    const { body } = await agentA.get(`/api/letters/clients/${RILEY.id}/contacts`);
    expect(body.contacts).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Drafts
// ═══════════════════════════════════════════════════════════════════════════

describe('drafts', () => {
  test('a new draft has every block selected and today\'s date', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    const draft = await createDraft(agent, RILEY.id);
    expect(draft.documentType).toBe('progress_note_letter');
    expect(draft.selectedSections).toEqual(ltm.LETTER_SECTIONS.map((s) => s.tag));
    expect(draft.letterDetails.letterDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(draft.recipient).toEqual({});
    expect(draft.ccRecipients).toEqual([]);
    expect(draft.status).toBe('draft');
  });

  test('it is stored on the SAME tables as the FCA report, tagged by document type', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const { rows } = await db.pool.query('SELECT document_type FROM fca_report_drafts WHERE id = $1', [draft.id]);
    expect(rows[0].document_type).toBe('progress_note_letter');

    const tpl = await db.pool.query('SELECT document_type, template_key FROM fca_templates');
    expect(tpl.rows).toEqual([{ document_type: 'progress_note_letter', template_key: 'progress_note_letter' }]);
  });

  test('an unknown client is 404, not a fabricated draft', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const res = await agent.post('/api/letters/drafts').send({ clientId: 'nope' });
    expect(res.status).toBe(404);
  });

  test('drafts are own-only — not even an owner in the same org sees another\'s', async () => {
    const org = await seedOrganisation('Org A');
    const { agent: therapist } = await agentFor('therapist', { organisation_id: org.id });
    const { agent: owner } = await agentFor('owner', { organisation_id: org.id });

    const draft = await createDraft(therapist, RILEY.id);
    expect((await owner.get(`/api/letters/drafts/${draft.id}`)).status).toBe(404);
    expect((await owner.get('/api/letters/drafts')).body.drafts).toEqual([]);
  });

  test('a draft in another organisation is 404, never 403', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { agent: a } = await agentFor('therapist', { organisation_id: orgA.id });
    const { agent: b } = await agentFor('therapist', { organisation_id: orgB.id });

    const draft = await createDraft(a, RILEY.id);
    const res = await b.get(`/api/letters/drafts/${draft.id}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  test('an FCA draft is not reachable through the letter routes', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', { organisation_id: org.id });

    const { rows } = await db.pool.query(
      `INSERT INTO fca_report_drafts
         (organisation_id, client_id, created_by_user_id, template_version, document_type)
       VALUES ($1,$2,$3,'v1','fca_report') RETURNING id`,
      [org.id, RILEY.id, user.id]
    );
    expect((await agent.get(`/api/letters/drafts/${rows[0].id}`)).status).toBe(404);
    expect((await agent.get('/api/letters/drafts')).body.drafts).toEqual([]);
  });

  test('PATCH stores the recipient, CC list and letter details as a snapshot', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({
      recipient: { name: 'Morgan Reid', role: 'Support Coordinator', address: 'Level 2\nEast Perth' },
      ccRecipients: [{ name: 'Alex Tan', organisation: 'Bright Futures' }, { name: 'Jordan Blake' }],
      letterDetails: { subject: 'Progress update' },
    });

    expect(res.status).toBe(200);
    expect(res.body.draft.recipient.name).toBe('Morgan Reid');
    expect(res.body.draft.ccRecipients).toHaveLength(2);
    expect(res.body.draft.letterDetails.subject).toBe('Progress update');
    // PATCHing one detail must not wipe the others.
    expect(res.body.draft.letterDetails.letterDate).toBe(draft.letterDetails.letterDate);
  });

  test('the recipient reaches the manifest as letter scalars', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await readyDraft(agent, RILEY.id, {
      ccRecipients: [{ name: 'Alex Tan', organisation: 'Bright Futures' }, { name: 'Jordan Blake' }],
    });

    const d = draft.manifest.scalarData;
    expect(d.OPAL_LETTER_RECIPIENT_NAME).toBe('Morgan Reid');
    expect(d.OPAL_LETTER_SALUTATION).toBe('Morgan');
    expect(d.OPAL_LETTER_CC).toBe('Alex Tan, Bright Futures\nJordan Blake');
    expect(draft.manifest.scalarSources.OPAL_LETTER_RECIPIENT_NAME).toBe('report_override');
  });

  test('DELETE archives rather than destroys', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    expect((await agent.delete(`/api/letters/drafts/${draft.id}`)).body).toEqual({ ok: true });
    const { rows } = await db.pool.query('SELECT status FROM fca_report_drafts WHERE id = $1', [draft.id]);
    expect(rows[0].status).toBe('archived');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Required blocks
// ═══════════════════════════════════════════════════════════════════════════

describe('required blocks', () => {
  test('deselecting a required block is REFUSED, not silently corrected', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({
      selectedSections: ['OPAL_SECTION_LETTER_PROGRESS_UPDATE', 'OPAL_SECTION_LETTER_NEXT_STEPS'],
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('required_section');
    expect(res.body.requiredSections).toEqual(['OPAL_SECTION_LETTER_PURPOSE_CONTEXT']);
    expect(res.body.message).toContain('Purpose and context');

    // And nothing was written.
    const after = await agent.get(`/api/letters/drafts/${draft.id}`);
    expect(after.body.draft.selectedSections).toEqual(draft.selectedSections);
  });

  test('an empty selection is refused for the same reason', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({ selectedSections: [] });
    expect(res.status).toBe(400);
    expect(res.body.requiredSections).toEqual(ltm.LETTER_REQUIRED_SECTION_TAGS);
  });

  test('deselecting only optional blocks is accepted', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({
      selectedSections: [...ltm.LETTER_REQUIRED_SECTION_TAGS, 'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS'],
    });
    expect(res.status).toBe(200);
    expect(res.body.draft.selectedSections).toEqual([
      'OPAL_SECTION_LETTER_PURPOSE_CONTEXT',
      'OPAL_SECTION_LETTER_PROGRESS_UPDATE',
      'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS',
    ]);
    expect(res.body.draft.manifest.sections.find((s) => s.tag === 'OPAL_SECTION_LETTER_NEXT_STEPS').included)
      .toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Generation guards
// ═══════════════════════════════════════════════════════════════════════════

describe('generation guards', () => {
  test('a letter with no recipient and no subject cannot be generated', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    await seedLetterhead(org.id);
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('missing_required_fields');
    expect(res.body.missingFields).toEqual(expect.arrayContaining([
      'OPAL_LETTER_RECIPIENT_NAME', 'OPAL_LETTER_SALUTATION',
      'OPAL_LETTER_SUBJECT', 'OPAL_LETTER_REPORTING_PERIOD',
    ]));
    expect(res.body.message).toContain('Recipient name');

    const { rows } = await db.pool.query('SELECT status FROM fca_report_drafts WHERE id = $1', [draft.id]);
    expect(rows[0].status).toBe('draft'); // nothing was written
    expect(await db.pool.query('SELECT 1 FROM fca_generated_documents')).toHaveProperty('rowCount', 0);
  });

  test('an unconfigured organisation letterhead blocks generation rather than inventing one', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana Whitfield', phone: '08 9000 1111', role_title: 'Senior Occupational Therapist',
    });
    await seedCredentials(user.id, org.id);
    const draft = await readyDraft(agent, RILEY.id);

    const res = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(res.status).toBe(400);
    expect(res.body.missingFields).toEqual(expect.arrayContaining([
      'OPAL_ORGANISATION_ADDRESS', 'OPAL_ORGANISATION_PHONE',
      'OPAL_ORGANISATION_EMAIL', 'OPAL_ORGANISATION_WEBSITE',
    ]));
    expect(res.body.message).toContain('Business address');
  });

  test('a therapist can unblock any required field with an override', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana Whitfield', phone: '08 9000 1111', role_title: 'Senior OT',
    });
    await seedCredentials(user.id, org.id);
    await seedLetterhead(org.id);
    const draft = await readyDraft(agent, CASEY.id);

    // Casey's Splose record has an NDIS number; blank it to create a real gap.
    setPatients([RILEY, { ...CASEY, ndisNumber: null }]);
    const blocked = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(blocked.status).toBe(400);
    expect(blocked.body.missingFields).toEqual(['OPAL_CLIENT_NDIS_NUMBER']);

    await agent.patch(`/api/letters/drafts/${draft.id}`)
      .send({ scalarOverrides: { OPAL_CLIENT_NDIS_NUMBER: 'Not applicable' } });

    const ok = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(ok.status).toBe(200);
  });

  test('read_only cannot generate', async () => {
    const org = await seedOrganisation('Org A');
    const { agent: therapist } = await agentFor('therapist', { organisation_id: org.id });
    const { agent: reader } = await agentFor('read_only', { organisation_id: org.id });
    const draft = await createDraft(therapist, RILEY.id);

    expect((await reader.post(`/api/letters/drafts/${draft.id}/generate`)).status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE NAMED SCENARIO
// ═══════════════════════════════════════════════════════════════════════════

describe('end to end: a real letter', () => {
  /**
   * Sample participant and therapist; the support coordinator as recipient;
   * both required blocks; Current presentation REMOVED; Clinical opinion
   * INCLUDED; Next steps REMOVED; ONE custom block; full recipient,
   * participant, therapist, organisation and letter data. Generate, then read
   * the actual bytes back.
   */
  async function scenario() {
    const org = await seedOrganisation('Opal Therapy');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id,
      name: 'Dana Whitfield',
      phone: '08 9000 1111',
      role_title: 'Senior Occupational Therapist',
    });
    await seedCredentials(user.id, org.id);
    const letterhead = await seedLetterhead(org.id);

    // The participant's durable facts, and the support coordinator on file.
    await db.pool.query(
      `INSERT INTO fca_client_profiles
         (organisation_id, splose_client_id, created_by_user_id, preferred_name, support_coordinator_details)
       VALUES ($1,$2,$3,$4,$5)`,
      [org.id, RILEY.id, user.id, 'Riley',
        'Morgan Reid\nSouthern Rivers Coordination\nLevel 2, 88 Wellington Street\nEast Perth WA 6004']
    );

    const contacts = await agent.get(`/api/letters/clients/${RILEY.id}/contacts`);
    const coordinator = contacts.body.contacts.find((c) => c.source === 'support_coordinator');
    expect(coordinator.name).toBe('Morgan Reid');

    const draft = await createDraft(agent, RILEY.id);
    const patched = await agent.patch(`/api/letters/drafts/${draft.id}`).send({
      recipient: {
        name: coordinator.name,
        role: coordinator.role,
        organisation: 'Southern Rivers Coordination',
        address: 'Level 2, 88 Wellington Street\nEast Perth WA 6004',
        salutation: 'Morgan',
      },
      ccRecipients: [{ name: 'Alex Tan', organisation: 'Bright Futures Plan Management' }],
      letterDetails: {
        letterDate: '2026-08-10',
        subject: 'Progress update and continued therapy funding',
        reportingPeriod: '1 February 2026 to 31 July 2026',
      },
      selectedSections: [
        'OPAL_SECTION_LETTER_PURPOSE_CONTEXT',
        'OPAL_SECTION_LETTER_PROGRESS_UPDATE',
        'OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS',
      ],
      customSections: [{ label: 'Equipment trial', guidance: 'A shower chair trial ran over four sessions.' }],
      scalarOverrides: {
        OPAL_THERAPIST_QUALIFICATIONS: 'BSc (Hons) Occupational Therapy\nGraduate Certificate in Neurological Rehabilitation',
      },
    });
    expect(patched.status).toBe(200);

    const gen = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);

    const buffer = await docxOf(agent, gen.body.documentId);
    return { org, user, agent, draft: patched.body.draft, gen: gen.body, buffer, letterhead };
  }

  test('generates, and the filename follows the contract', async () => {
    const { gen } = await scenario();
    expect(gen.filename).toBe('Progress Note Letter - Riley - 2026-08-10.docx');
    expect(gen.missingFields).toEqual([]);
  });

  test('the removed blocks are absent, the included one is present', async () => {
    const { buffer } = await scenario();
    const xml = await partText(buffer, 'word/document.xml');

    expect(xml).not.toContain('OPAL_SECTION_LETTER_CURRENT_PRESENTATION');
    expect(xml).not.toContain('current functional presentation');
    expect(xml).not.toContain('OPAL_SECTION_LETTER_NEXT_STEPS');
    expect(xml).not.toContain('agreed next steps');

    expect(xml).toContain('OPAL_SECTION_LETTER_PURPOSE_CONTEXT');
    expect(xml).toContain('OPAL_SECTION_LETTER_PROGRESS_UPDATE');
    expect(xml).toContain('OPAL_SECTION_LETTER_CLINICAL_OPINION_RECOMMENDATIONS');
  });

  test('the custom block is present, styled and in place of the anchor', async () => {
    const { buffer } = await scenario();
    const xml = await partText(buffer, 'word/document.xml');

    expect(xml).not.toContain(ltm.LETTER_CUSTOM_SECTION_ANCHOR);
    expect(xml).toMatch(/OPAL_SECTION_LETTER_CUSTOM_EQUIPMENT_TRIAL_[A-F0-9]+/);
    expect(xml).toContain('Equipment trial');
    expect(xml).toContain('A shower chair trial ran over four sessions.');
    expect(xml).toContain(`w:val="${ltm.STYLE.BODY_EMPHASIS}"`);
  });

  test('every layer of data reached the page', async () => {
    const { buffer, letterhead, user } = await scenario();
    const doc = await partText(buffer, 'word/document.xml');
    const header = await partText(buffer, 'word/header6.xml');
    const footer = await partText(buffer, 'word/footer6.xml');

    // Participant (Splose + profile)
    expect(doc).toContain('Riley Anne Thompson');
    expect(doc).toContain('430998877');
    // Recipient (letter)
    expect(doc).toContain('Morgan Reid');
    expect(doc).toContain('Southern Rivers Coordination');
    expect(doc).toContain('East Perth WA 6004');
    expect(doc).toContain('Alex Tan, Bright Futures Plan Management');
    // Therapist (portal)
    expect(doc).toContain('Dana Whitfield');
    expect(doc).toContain('Senior Occupational Therapist');
    expect(doc).toContain('OCC0001234567');
    expect(doc).toContain(user.email); // read straight off the author's user row
    // Organisation (org settings)
    expect(header).toContain('Subiaco WA 6008');
    expect(header).toContain(letterhead.businessPhone);
    expect(header).toContain(letterhead.website);
    // Server-issued
    expect(footer).toMatch(/LTR-[0-9A-F]{8}/);
    expect(footer).toMatch(/<w:instrText[^>]*>\s*PAGE\s*<\/w:instrText>/);
  });

  test('the package is valid and carries no unresolved placeholder', async () => {
    const { buffer } = await scenario();
    const zip = await JSZip.loadAsync(buffer);
    const template = await JSZip.loadAsync(
      require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'fca', 'templates', ltm.LETTER_TEMPLATE_FILENAME))
    );

    expect(Object.keys(zip.files).sort()).toEqual(Object.keys(template.files).sort());

    for (const name of ['word/document.xml', 'word/header6.xml', 'word/footer6.xml']) {
      const xml = await zip.file(name).async('string');
      expect(xml).not.toMatch(/\[PORTAL\s*[—–-]/);
      expect(new DOMParser().parseFromString(xml, 'text/xml').documentElement).toBeTruthy();
    }

    // Branding bytes untouched.
    for (const name of ['word/media/image1.png', 'word/theme/theme1.xml', 'word/styles.xml']) {
      expect([name, Buffer.compare(
        await template.file(name).async('nodebuffer'),
        await zip.file(name).async('nodebuffer')
      )]).toEqual([name, 0]);
    }
  });

  test('the preview and the document are composed from ONE manifest', async () => {
    const { agent, draft, buffer } = await scenario();

    // The preview the therapist approved.
    const beforeIncluded = draft.manifest.sections.filter((s) => s.included).map((s) => s.tag);

    // The frozen draft, read back after generation.
    const after = await agent.get(`/api/letters/drafts/${draft.id}`);
    expect(after.body.draft.status).toBe('generated');
    const afterIncluded = after.body.draft.manifest.sections.filter((s) => s.included).map((s) => s.tag);
    expect(afterIncluded).toEqual(beforeIncluded);

    // And the document contains exactly the block controls the manifest said.
    const xml = await partText(buffer, 'word/document.xml');
    for (const s of after.body.draft.manifest.sections) {
      if (s.kind === 'custom') { expect(xml).toContain(s.tag); continue; }
      expect([s.tag, xml.includes(`w:val="${s.tag}"`)]).toEqual([s.tag, s.included]);
    }

    // Every scalar the manifest carries is the value on the page.
    for (const [tag, value] of Object.entries(after.body.draft.manifest.scalarData)) {
      if (value === null) continue;
      const parts = await Promise.all(
        ['word/document.xml', 'word/header6.xml', 'word/footer6.xml'].map((n) => partText(buffer, n))
      );
      const first = String(value).split('\n')[0];
      expect([tag, parts.some((p) => p.includes(first))]).toEqual([tag, true]);
    }
  });

  test('the snapshot is frozen — a later profile change cannot alter the issued letter', async () => {
    const { agent, org, draft, gen } = await scenario();

    await db.pool.query(
      'UPDATE fca_client_profiles SET preferred_name = $2 WHERE organisation_id = $1',
      [org.id, 'CHANGED-AFTERWARDS']
    );
    setPatients([{ ...RILEY, fullName: 'CHANGED FULL NAME' }, CASEY]);
    await seedLetterhead(org.id, { businessPhone: '08 9999 9999' });

    const buffer = await docxOf(agent, gen.body ? gen.body.documentId : gen.documentId);
    const doc = await partText(buffer, 'word/document.xml');
    const header = await partText(buffer, 'word/header6.xml');
    expect(doc).toContain('Riley Anne Thompson');
    expect(doc).not.toContain('CHANGED FULL NAME');
    expect(header).not.toContain('08 9999 9999');

    const reread = await agent.get(`/api/letters/drafts/${draft.id}`);
    expect(reread.body.draft.manifest.scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('Riley');
  });

  test('a generated letter can no longer be edited', async () => {
    const { agent, draft } = await scenario();
    const res = await agent.patch(`/api/letters/drafts/${draft.id}`).send({ letterDetails: { subject: 'New' } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_editable');
  });

  test('audit records ids, versions and counts — and no names at all', async () => {
    const { org, user, draft } = await scenario();
    const rows = await auditRows('letter.generated');
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row.organisation_id).toBe(org.id);
    expect(row.actor_user_id).toBe(user.id);
    expect(row.target_id).toBe(draft.id);
    expect(row.metadata).toMatchObject({
      clientId: RILEY.id,
      templateVersion: 'v1',
      documentType: 'progress_note_letter',
      sectionCount: 3,
      customSectionCount: 1,
      ccCount: 1,
    });

    const blob = JSON.stringify(row.metadata);
    for (const secret of ['Riley', 'Thompson', 'Morgan', 'Reid', 'Dana', 'Whitfield',
      'Alex Tan', 'shower chair', 'Southern Rivers']) {
      expect(blob).not.toContain(secret);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  No CC, no AHPRA
// ═══════════════════════════════════════════════════════════════════════════

describe('a letter with no CC and no AHPRA registration', () => {
  test('ships no empty labels and no dangling separators', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana Whitfield', phone: '08 9000 1111', role_title: 'Senior OT',
    });
    // Deliberately NO credentials row → no AHPRA number, and no credential name.
    await seedLetterhead(org.id);
    const draft = await readyDraft(agent, RILEY.id, {
      recipient: { name: 'Morgan Reid', salutation: 'Morgan' }, // no role, org or address either
      letterDetails: { letterDate: '2026-08-10', subject: 'Progress update', reportingPeriod: 'Feb to Jul 2026' },
      // Credentials have no portal source here, so supply them explicitly.
      scalarOverrides: { OPAL_THERAPIST_CREDENTIALS: 'Occupational Therapist' },
    });
    expect(draft.ccRecipients).toEqual([]);

    const gen = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);
    expect(gen.body.missingFields.sort()).toEqual([
      'OPAL_LETTER_CC',
      'OPAL_LETTER_RECIPIENT_ADDRESS',
      'OPAL_LETTER_RECIPIENT_ORGANISATION',
      'OPAL_LETTER_RECIPIENT_ROLE',
      'OPAL_THERAPIST_AHPRA_NUMBER',
      'OPAL_THERAPIST_QUALIFICATIONS',
    ]);
    expect(gen.body.warnings.join(' ')).toMatch(/lines were removed/);

    const buffer = await docxOf(agent, gen.body.documentId);
    const xml = await partText(buffer, 'word/document.xml');

    expect(xml).not.toContain('CC:');
    expect(xml).not.toContain('AHPRA registration');
    expect(xml).not.toMatch(/\[PORTAL\s*[—–-]/);

    // Walk the visible paragraphs: none may be a bare label or separator.
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    for (const p of Array.from(doc.getElementsByTagName('w:p'))) {
      let text = '';
      for (const t of Array.from(p.getElementsByTagName('w:t'))) text += t.textContent || '';
      text = text.trim();
      expect(text).not.toMatch(/^(CC|AHPRA registration|Phone|Email)\s*:?$/i);
      expect(text).not.toMatch(/[:|]\s*$/);
      expect(text).not.toMatch(/^[|·]+$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Save the recipient back to the profile
// ═══════════════════════════════════════════════════════════════════════════

describe('save-recipient-to-profile', () => {
  test('nothing is written to the profile just by choosing a recipient', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    await readyDraft(agent, RILEY.id);

    const { rows } = await db.pool.query('SELECT * FROM fca_client_profiles');
    expect(rows).toHaveLength(0);
  });

  test('an explicit save writes the named target and nothing else', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await readyDraft(agent, RILEY.id);

    const res = await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`)
      .send({ target: 'support_coordinator' });

    expect(res.status).toBe(200);
    expect(res.body.saved).toBe('support_coordinator');
    expect(res.body.profile.supportCoordinatorDetails)
      .toBe('Morgan Reid\nSouthern Rivers Coordination\nLevel 2, 88 Wellington Street\nEast Perth WA 6004');
    expect(res.body.profile.nomineeDetails).toBeNull();
    expect(res.body.profile.referrerDetails).toBeNull();
  });

  test('a saved contact is appended to the profile\'s structured contact list', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await readyDraft(agent, RILEY.id);

    await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`).send({ target: 'saved_contact' });
    const again = await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`).send({ target: 'saved_contact' });

    // Saving twice does not duplicate the entry.
    expect(again.body.profile.otherContacts).toHaveLength(1);
    expect(again.body.profile.otherContacts[0]).toMatchObject({
      name: 'Morgan Reid', role: 'Support Coordinator', salutation: 'Morgan',
    });

    // And it comes back as a contact suggestion.
    const contacts = await agent.get(`/api/letters/clients/${RILEY.id}/contacts`);
    expect(contacts.body.contacts.some((c) => c.source === 'saved_contact' && c.name === 'Morgan Reid')).toBe(true);
  });

  test('an unknown target is refused and nothing is written', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await readyDraft(agent, RILEY.id);

    const res = await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`)
      .send({ target: 'gp' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_target');
    expect((await db.pool.query('SELECT * FROM fca_client_profiles')).rows).toHaveLength(0);
  });

  test('a draft with no recipient has nothing to save', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await createDraft(agent, RILEY.id);

    const res = await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`)
      .send({ target: 'nominee' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_recipient');
  });

  test('the audit row names the target but never the recipient', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });
    const draft = await readyDraft(agent, RILEY.id);
    await agent.post(`/api/letters/drafts/${draft.id}/save-recipient-to-profile`).send({ target: 'referrer' });

    const rows = await auditRows('letter.recipient_saved_to_profile');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ target: 'referrer', draftId: draft.id, clientId: RILEY.id });
    expect(JSON.stringify(rows[0].metadata)).not.toContain('Morgan');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Download
// ═══════════════════════════════════════════════════════════════════════════

describe('download', () => {
  async function generateFor(agent, clientId, org, user) {
    await seedCredentials(user.id, org.id);
    await seedLetterhead(org.id);
    const draft = await readyDraft(agent, clientId);
    const gen = await agent.post(`/api/letters/drafts/${draft.id}/generate`);
    expect(gen.status).toBe(200);
    return gen.body;
  }

  test('another user cannot download someone else\'s letter', async () => {
    const org = await seedOrganisation('Org A');
    const { agent: mine, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana', phone: '08 9000 1111', role_title: 'OT',
    });
    const { agent: theirs } = await agentFor('owner', { organisation_id: org.id });

    const gen = await generateFor(mine, RILEY.id, org, user);
    expect((await theirs.get(`/api/letters/documents/${gen.documentId}/download`)).status).toBe(404);
    expect((await mine.get(`/api/letters/documents/${gen.documentId}/download`)).status).toBe(200);
  });

  test('a user in another organisation cannot download it either', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    const { agent: a, user } = await agentFor('therapist', {
      organisation_id: orgA.id, name: 'Dana', phone: '08 9000 1111', role_title: 'OT',
    });
    const { agent: b } = await agentFor('therapist', { organisation_id: orgB.id });

    const gen = await generateFor(a, RILEY.id, orgA, user);
    expect((await b.get(`/api/letters/documents/${gen.documentId}/download`)).status).toBe(404);
  });

  test('serves a real .docx with safe headers', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana', phone: '08 9000 1111', role_title: 'OT',
    });
    const gen = await generateFor(agent, RILEY.id, org, user);

    const res = await agent.get(`/api/letters/documents/${gen.documentId}/download`);
    expect(res.headers['content-type']).toContain('wordprocessingml.document');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  test('a download is audited', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana', phone: '08 9000 1111', role_title: 'OT',
    });
    const gen = await generateFor(agent, RILEY.id, org, user);
    await agent.get(`/api/letters/documents/${gen.documentId}/download`);

    const rows = await auditRows('letter.downloaded');
    expect(rows).toHaveLength(1);
    expect(rows[0].metadata).toMatchObject({ documentId: gen.documentId, templateVersion: 'v1' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Isolation under concurrency
// ═══════════════════════════════════════════════════════════════════════════

describe('concurrent generation', () => {
  test('two participants generated at once never bleed into each other', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana Whitfield', phone: '08 9000 1111', role_title: 'Senior OT',
    });
    await seedCredentials(user.id, org.id);
    await seedLetterhead(org.id);

    const draftRiley = await readyDraft(agent, RILEY.id);
    const draftCasey = await readyDraft(agent, CASEY.id);

    const [genRiley, genCasey] = await Promise.all([
      agent.post(`/api/letters/drafts/${draftRiley.id}/generate`),
      agent.post(`/api/letters/drafts/${draftCasey.id}/generate`),
    ]);
    expect(genRiley.status).toBe(200);
    expect(genCasey.status).toBe(200);

    const [bufRiley, bufCasey] = await Promise.all([
      docxOf(agent, genRiley.body.documentId),
      docxOf(agent, genCasey.body.documentId),
    ]);

    const docRiley = await partText(bufRiley, 'word/document.xml');
    const docCasey = await partText(bufCasey, 'word/document.xml');

    expect(docRiley).toContain('Riley Anne Thompson');
    expect(docRiley).not.toContain('Casey Nguyen');
    expect(docRiley).not.toContain(CASEY.ndisNumber);

    expect(docCasey).toContain('Casey Nguyen');
    expect(docCasey).not.toContain('Riley Anne Thompson');
    expect(docCasey).not.toContain(RILEY.ndisNumber);

    // Distinct document ids in the footers.
    const footers = await Promise.all([partText(bufRiley, 'word/footer6.xml'), partText(bufCasey, 'word/footer6.xml')]);
    const ids = footers.map((f) => (f.match(/LTR-[0-9A-F]{8}/) || [])[0]);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  Data sources
// ═══════════════════════════════════════════════════════════════════════════

describe('source attribution', () => {
  test('each tag reports where its value actually came from', async () => {
    const org = await seedOrganisation('Org A');
    const { agent, user } = await agentFor('therapist', {
      organisation_id: org.id, name: 'Dana Whitfield', phone: '08 9000 1111', role_title: 'Senior OT',
    });
    await seedCredentials(user.id, org.id);
    await seedLetterhead(org.id);
    await db.pool.query(
      `INSERT INTO fca_client_profiles (organisation_id, splose_client_id, created_by_user_id, preferred_name)
       VALUES ($1,$2,$3,'Riley')`,
      [org.id, RILEY.id, user.id]
    );

    const draft = await readyDraft(agent, RILEY.id);
    const s = draft.manifest.scalarSources;

    expect(s.OPAL_CLIENT_FULL_NAME).toBe('splose');
    expect(s.OPAL_CLIENT_NDIS_NUMBER).toBe('splose');
    expect(s.OPAL_CLIENT_PREFERRED_NAME).toBe('client_profile');
    expect(s.OPAL_THERAPIST_FULL_NAME).toBe('portal');
    expect(s.OPAL_THERAPIST_AHPRA_NUMBER).toBe('portal');
    expect(s.OPAL_ORGANISATION_ADDRESS).toBe('portal');
    expect(s.OPAL_LETTER_RECIPIENT_NAME).toBe('report_override');
    expect(s.OPAL_THERAPIST_QUALIFICATIONS).toBe('missing');
    // Not yet generated, so the server has issued nothing.
    expect(s.OPAL_LETTER_DOCUMENT_ID).toBe('missing');

    // Every source is drawn from the documented vocabulary.
    const vocabulary = new Set(['splose', 'client_profile', 'report_override', 'missing', 'portal', 'server']);
    for (const value of Object.values(s)) expect(vocabulary.has(value)).toBe(true);
  });

  test('the preferred name falls back to the Splose given name, attributed honestly', async () => {
    const org = await seedOrganisation('Org A');
    const { agent } = await agentFor('therapist', { organisation_id: org.id });

    // No profile at all for this client.
    const draft = await readyDraft(agent, RILEY.id);
    expect(draft.manifest.scalarData.OPAL_CLIENT_PREFERRED_NAME).toBe('Riley');
    expect(draft.manifest.scalarSources.OPAL_CLIENT_PREFERRED_NAME).toBe('splose');
  });

  test('the letterhead is read from the organisation\'s own settings, not another org\'s', async () => {
    const orgA = await seedOrganisation('Org A');
    const orgB = await seedOrganisation('Org B');
    await seedLetterhead(orgA.id, { businessPhone: '08 1111 1111' });
    await seedLetterhead(orgB.id, { businessPhone: '08 2222 2222' });

    const { agent } = await agentFor('therapist', { organisation_id: orgB.id });
    const draft = await readyDraft(agent, RILEY.id);
    expect(draft.manifest.scalarData.OPAL_ORGANISATION_PHONE).toBe('08 2222 2222');
  });
});
