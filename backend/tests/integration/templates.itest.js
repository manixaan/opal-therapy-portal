'use strict';

/**
 * TEMPLATES — integration tests (real Express, real sessions, real SQL, real
 * DOCX and PDF bytes).
 *
 * Splose is the one thing stubbed, for the same reason the letter tests stub
 * it: it is an external system, and a test has to be able to say exactly what
 * the "live" layer returned. Everything else runs for real — routing, RBAC,
 * organisation isolation, own-only scoping, the profile layer, composition,
 * the export boundary, and audit.
 *
 * The questions these tests exist to answer:
 *   · can a user reach a document that is not theirs?              (no)
 *   · can a user in another organisation reach it?                 (no)
 *   · can completing a document change the master or the profile?  (no)
 *   · does an export still depend on Opal?                         (no)
 */

const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');

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

const { db, truncateAll, seedUser, seedOrganisation, closePool } = require('./helpers');
const catalogue = require('../../templates/catalogue');

jest.setTimeout(90000);

const PASSWORD = 'TemplatePass123';

const JANE = {
  id: 'splose-jane', firstname: 'Jane', lastname: 'Smith', fullName: 'Jane Smith',
  email: 'jane@example.invalid', mobilePhone: '0400 222 222', ndisNumber: '430000123',
  formattedAddress: '1 Example Street, Adelaide SA 5000',
};
const OTHER = {
  id: 'splose-other', firstname: 'Sam', lastname: 'Nguyen', fullName: 'Sam Nguyen',
  email: 'sam@example.invalid', mobilePhone: '0400 333 333', ndisNumber: '430777666',
  formattedAddress: '9 Other Way, Darwin NT 0800',
};

function buildApp() {
  const app = express();
  app.use(bodyParser.json({ limit: '4mb' }));
  app.use(session({
    secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
    cookie: { secure: false },
  }));
  app.use('/', require('../../auth'));
  app.use('/', require('../../templates-routes'));
  return app;
}

async function agentFor(app, role, organisationId) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  const user = await seedUser({ password_hash: hash, role, organisation_id: organisationId });
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  expect(res.status).toBe(200);
  return { agent, user };
}

let app;
let orgA;
let orgB;

beforeEach(async () => {
  await truncateAll();
  require('../../auth')._resetLoginRateLimit();
  mockSplose.fail = false;
  mockSplose.patients.clear();
  for (const p of [JANE, OTHER]) mockSplose.patients.set(String(p.id), p);
  app = buildApp();
  orgA = (await seedOrganisation('Org A')).id;
  orgB = (await seedOrganisation('Org B')).id;
});

afterAll(closePool);

// ═══════════════════════════════════════════════════════════════════════════
//  Catalogue and lifecycle
// ═══════════════════════════════════════════════════════════════════════════

test('the catalogue offers exactly the three required templates', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const res = await agent.get('/api/templates');
  expect(res.status).toBe(200);
  expect(res.body.templates.map((t) => t.name)).toEqual([
    'Service Agreement', 'Progress Note', 'Functional Capacity Assessment (FCA)',
  ]);
});

test('a document is created, completed, previewed and listed', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);

  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'Jane — 2026 plan', clientId: JANE.id });
  expect(created.status).toBe(201);
  const id = created.body.document.id;

  // The portal-populated value is resolved and ATTRIBUTED, without the tag
  // ever appearing as something the user reads.
  const nameField = created.body.document.groups
    .flatMap((g) => g.fields).find((f) => f.label === 'Participant full name');
  expect(nameField.value).toBe('Jane Smith');
  expect(nameField.source).toBe('splose');

  const patched = await agent.patch(`/api/templates/documents/${id}`)
    .send({ fieldValues: { OPAL_EMERGENCY_CONTACT_NAME: 'Dana Okoro' } });
  expect(patched.status).toBe(200);
  const manual = patched.body.document.groups
    .flatMap((g) => g.fields).find((f) => f.label === 'Emergency contact name');
  expect(manual.value).toBe('Dana Okoro');
  expect(manual.source).toBe('report_override');

  const preview = await agent.get(`/api/templates/documents/${id}/preview.docx`);
  expect(preview.status).toBe(200);
  expect(preview.headers['content-type']).toMatch(/wordprocessingml/);
  expect(preview.headers['cache-control']).toBe('no-store');

  const list = await agent.get('/api/templates/documents');
  expect(list.status).toBe(200);
  expect(list.body.documents.map((d) => d.id)).toContain(id);
});

test('FCA section structure: shape, store, export, and return to default (migration 044)', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const fcaMap = require('../../fca/template-map');
  const allTags = fcaMap.SECTIONS.map((s) => s.tag);

  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Sectioned FCA' });
  expect(created.status).toBe(201);
  const id = created.body.document.id;

  // The document carries its section structure — every section in, by default.
  const initial = created.body.document.sections;
  expect(initial.map((s) => s.tag)).toEqual(allTags);
  expect(initial.every((s) => s.included)).toBe(true);

  // Drop an optional section; the stored row survives a re-read (the column
  // exists and round-trips — the thing migration 044 has to prove).
  const selected = allTags.filter((t) => t !== 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA');
  const shaped = await agent.patch(`/api/templates/documents/${id}`)
    .send({ sections: { selected, order: allTags } });
  expect(shaped.status).toBe(200);
  expect(shaped.body.document.sections.find((s) => s.tag === 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA').included).toBe(false);

  const reread = await agent.get(`/api/templates/documents/${id}`);
  expect(reread.body.document.sections.find((s) => s.tag === 'OPAL_SECTION_ASSESSMENT_TOOL_MOCA').included).toBe(false);

  // The export composes without the excluded section.
  const exported = await agent.get(`/api/templates/documents/${id}/export.docx`)
    .buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(exported.status).toBe(200);
  const zip = await JSZip.loadAsync(exported.body);
  const xml = await zip.file('word/document.xml').async('string');
  expect(xml).not.toContain('Montreal Cognitive Assessment');

  // A required section cannot be dropped.
  const refused = await agent.patch(`/api/templates/documents/${id}`)
    .send({ sections: { selected: selected.filter((t) => t !== 'OPAL_SECTION_REFERRAL_INFORMATION') } });
  expect(refused.status).toBe(400);
  expect(refused.body.error).toBe('required_section');

  // null returns the document to the master's own structure.
  const reset = await agent.patch(`/api/templates/documents/${id}`).send({ sections: null });
  expect(reset.status).toBe(200);
  expect(reset.body.document.sections.every((s) => s.included)).toBe(true);
});

test('custom sections and heading levels round-trip and reach the export', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);

  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Custom-section FCA' });
  const id = created.body.document.id;

  const shaped = await agent.patch(`/api/templates/documents/${id}`)
    .send({ sections: {
      custom: [{ title: 'Sensory Profile Observations', level: 3 }],
      levels: { OPAL_SECTION_DOMAIN_MOBILITY: 1 },
    } });
  expect(shaped.status).toBe(200);

  const rows = shaped.body.document.sections;
  const custom = rows.find((s) => s.custom);
  expect(custom).toBeDefined();
  expect(custom.label).toBe('Sensory Profile Observations');
  expect(custom.headingLevel).toBe(3);
  expect(custom.id).toMatch(/^[0-9a-f-]{36}$/);           // server-minted
  expect(rows.find((s) => s.tag === 'OPAL_SECTION_DOMAIN_MOBILITY').headingLevel).toBe(1);

  // Survives a re-read with the SAME id, and reaches the Word export.
  const reread = await agent.get(`/api/templates/documents/${id}`);
  expect(reread.body.document.sections.find((s) => s.custom).id).toBe(custom.id);

  const exported = await agent.get(`/api/templates/documents/${id}/export.docx`)
    .buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  const zip = await JSZip.loadAsync(exported.body);
  const xml = await zip.file('word/document.xml').async('string');
  expect(xml).toContain('Sensory Profile Observations');
  expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
});

test('clearing a field returns it to the resolved value rather than blanking the document', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'T', clientId: JANE.id });
  const id = created.body.document.id;

  await agent.patch(`/api/templates/documents/${id}`)
    .send({ fieldValues: { OPAL_PARTICIPANT_FULL_NAME: 'Override Name' } });
  let f = (await agent.get(`/api/templates/documents/${id}`)).body.document.groups
    .flatMap((g) => g.fields).find((x) => x.label === 'Participant full name');
  expect([f.value, f.source]).toEqual(['Override Name', 'report_override']);

  await agent.patch(`/api/templates/documents/${id}`)
    .send({ fieldValues: { OPAL_PARTICIPANT_FULL_NAME: '' } });
  f = (await agent.get(`/api/templates/documents/${id}`)).body.document.groups
    .flatMap((g) => g.fields).find((x) => x.label === 'Participant full name');
  expect([f.value, f.source]).toEqual(['Jane Smith', 'splose']);
});

// ═══════════════════════════════════════════════════════════════════════════
//  Scope: own-only, organisation-isolated
// ═══════════════════════════════════════════════════════════════════════════

test('another therapist in the SAME organisation cannot reach the document', async () => {
  const { agent: mine } = await agentFor(app, 'therapist', orgA);
  const { agent: theirs } = await agentFor(app, 'therapist', orgA);

  const created = await mine.post('/api/templates/documents')
    .send({ templateId: 'progress_note', title: 'Mine', clientId: JANE.id });
  const id = created.body.document.id;

  for (const path of [
    `/api/templates/documents/${id}`,
    `/api/templates/documents/${id}/preview.docx`,
    `/api/templates/documents/${id}/export.docx`,
    `/api/templates/documents/${id}/export.pdf`,
  ]) {
    const res = await theirs.get(path);
    expect([path, res.status]).toEqual([path, 404]);
  }
  expect((await theirs.patch(`/api/templates/documents/${id}`).send({ title: 'Hijacked' })).status).toBe(404);
  expect((await theirs.delete(`/api/templates/documents/${id}`)).status).toBe(404);

  // And it really is untouched.
  expect((await mine.get(`/api/templates/documents/${id}`)).body.document.title).toBe('Mine');
});

test('a therapist in ANOTHER organisation cannot reach it either', async () => {
  const { agent: mine } = await agentFor(app, 'therapist', orgA);
  const { agent: outsider } = await agentFor(app, 'owner', orgB);

  const created = await mine.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Org A document', clientId: JANE.id });
  const id = created.body.document.id;

  expect((await outsider.get(`/api/templates/documents/${id}`)).status).toBe(404);
  expect((await outsider.get(`/api/templates/documents/${id}/export.docx`)).status).toBe(404);
  expect((await outsider.get('/api/templates/documents')).body.documents).toHaveLength(0);
});

test('another organisation profile for the same client never bleeds across', async () => {
  const { agent: a, user: ua } = await agentFor(app, 'therapist', orgA);
  const { agent: b } = await agentFor(app, 'therapist', orgB);

  // Org A records a preferred name for Jane. Org B must not see it.
  await db.pool.query(
    `INSERT INTO fca_client_profiles (organisation_id, splose_client_id, preferred_name, created_by_user_id)
     VALUES ($1,$2,$3,$4)`,
    [orgA, JANE.id, 'Janey', ua.id]
  );

  const docA = await a.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'A', clientId: JANE.id });
  const docB = await b.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'B', clientId: JANE.id });

  const pick = (r) => r.body.document.groups.flatMap((g) => g.fields)
    .find((f) => f.label === 'Preferred name');

  expect(pick(docA).value).toBe('Janey');
  expect(pick(docA).source).toBe('client_profile');
  expect(pick(docB).value).toBeNull();
  expect(pick(docB).source).toBe('missing');
});

test('read_only may open and export, but may not create or edit', async () => {
  const { agent: therapist } = await agentFor(app, 'therapist', orgA);
  const { agent: ro } = await agentFor(app, 'read_only', orgA);

  expect((await ro.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Nope' })).status).toBe(403);

  const created = await therapist.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Theirs' });
  // read_only owns nothing, so own-only scoping hides it — the same rule, not a
  // second one.
  expect((await ro.get(`/api/templates/documents/${created.body.document.id}`)).status).toBe(404);
});

test('admin is refused outright, and the refusal touches no client data', async () => {
  const { agent: admin } = await agentFor(app, 'admin', orgA);
  expect((await admin.get('/api/templates')).status).toBe(403);
  expect((await admin.get('/api/templates/clients?q=jane')).status).toBe(403);
  expect((await admin.get('/api/templates/documents')).status).toBe(403);
});

// ═══════════════════════════════════════════════════════════════════════════
//  The export boundary, over the wire
// ═══════════════════════════════════════════════════════════════════════════

describe('export over HTTP', () => {
  let agent;
  let id;

  beforeEach(async () => {
    ({ agent } = await agentFor(app, 'therapist', orgA));
    const created = await agent.post('/api/templates/documents')
      .send({ templateId: 'service_agreement', title: 'Regression case', clientId: JANE.id });
    id = created.body.document.id;
    await agent.patch(`/api/templates/documents/${id}`)
      .send({ fieldValues: { OPAL_EMERGENCY_CONTACT_NAME: 'Dana Okoro' } });
  });

  test('Word download is a real .docx with the values and no portal bindings', async () => {
    const res = await agent.get(`/api/templates/documents/${id}/export.docx`)
      .buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/wordprocessingml/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);

    const zip = await JSZip.loadAsync(res.body);
    // A real OOXML package, not HTML with a .docx name.
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(zip.file('[Content_Types].xml')).not.toBeNull();
    expect(res.body.slice(0, 2).toString('latin1')).toBe('PK');

    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Jane Smith');       // portal-populated
    expect(xml).toContain('430000123');        // portal-populated
    expect(xml).toContain('Dana Okoro');       // manually entered
    expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
    expect(xml).not.toMatch(/\[(?:PORTAL|OWNER|SERVER|E-SIGN)\b/);
    expect(xml).not.toMatch(/CONTROLLED MASTER|OMIT FROM PARTICIPANT/);
  });

  test('PDF download is a real, fillable PDF with the same values', async () => {
    const res = await agent.get(`/api/templates/documents/${id}/export.pdf`)
      .buffer(true).parse((r, cb) => {
        const chunks = [];
        r.on('data', (c) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.body.slice(0, 5).toString('latin1')).toBe('%PDF-');

    const pdf = await PDFDocument.load(res.body);
    const names = pdf.getForm().getFields().map((f) => f.getName());
    // An unfinished field is a standalone input the reader can complete.
    expect(names).toContain('Plan end date');
    // A resolved one is text, not an empty box.
    expect(names).not.toContain('Participant full name');

    const raw = res.body.toString('latin1');
    expect(raw).not.toMatch(/OPAL_[A-Z0-9_]+/);
    expect(raw).not.toMatch(/\[PORTAL/);
  });

  test('nothing is stored: an export leaves no copy of client data behind', async () => {
    await agent.get(`/api/templates/documents/${id}/export.docx`);
    const { rows } = await db.pool.query('SELECT field_values FROM template_documents WHERE id = $1', [id]);
    // Only the user's own answer — no rendered document, no resolved snapshot.
    expect(Object.keys(rows[0].field_values)).toEqual(['OPAL_EMERGENCY_CONTACT_NAME']);
    expect(JSON.stringify(rows[0].field_values)).not.toContain('Jane Smith');
  });

  test('completing the document changed neither the master nor the client profile', async () => {
    const master = catalogue.getTemplate('service_agreement').file;
    const before = fs.readFileSync(master);

    await agent.get(`/api/templates/documents/${id}/export.docx`);
    await agent.get(`/api/templates/documents/${id}/export.pdf`);

    expect(fs.readFileSync(master).equals(before)).toBe(true);
    const { rows } = await db.pool.query('SELECT * FROM fca_client_profiles');
    expect(rows).toHaveLength(0);            // no profile was created or written
  });

  test('audit records the export with ids only — never a name or a value', async () => {
    await agent.get(`/api/templates/documents/${id}/export.docx`);
    const { rows } = await db.pool.query(
      "SELECT * FROM audit_logs WHERE action = 'template.document_exported' ORDER BY created_at DESC LIMIT 1"
    );
    expect(rows).toHaveLength(1);
    const blob = JSON.stringify(rows[0]);
    expect(blob).toContain('template.document_exported');
    expect(blob).not.toContain('Jane Smith');
    expect(blob).not.toContain('Dana Okoro');
    expect(blob).not.toContain('430000123');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  External failure
// ═══════════════════════════════════════════════════════════════════════════

test('when Splose is down the API says so rather than inventing a client', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'T', clientId: JANE.id });
  const id = created.body.document.id;

  mockSplose.fail = true;
  for (const path of [
    `/api/templates/clients?q=jane`,
    `/api/templates/documents/${id}`,
    `/api/templates/documents/${id}/export.docx`,
  ]) {
    const res = await agent.get(path);
    expect([path, res.status]).toEqual([path, 503]);
    expect(res.body.error).toBe('splose_unavailable');
  }
});

test('a client the practice does not have is 404, and no document is created', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const res = await agent.post('/api/templates/documents')
    .send({ templateId: 'fca', title: 'Ghost', clientId: 'no-such-client' });
  expect(res.status).toBe(404);
  const { rows } = await db.pool.query('SELECT COUNT(*)::int AS n FROM template_documents');
  expect(rows[0].n).toBe(0);
});

test('a document with no client resolves no client data at all', async () => {
  const { agent } = await agentFor(app, 'therapist', orgA);
  const created = await agent.post('/api/templates/documents')
    .send({ templateId: 'service_agreement', title: 'Unbound' });
  expect(created.status).toBe(201);
  const fields = created.body.document.groups.flatMap((g) => g.fields);
  const name = fields.find((f) => f.label === 'Participant full name');
  expect([name.value, name.source]).toEqual([null, 'missing']);

  // It still exports, with that field as a standalone input.
  const res = await agent.get(`/api/templates/documents/${created.body.document.id}/export.docx`)
    .buffer(true).parse((r, cb) => {
      const chunks = [];
      r.on('data', (c) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  expect(res.status).toBe(200);
  const zip = await JSZip.loadAsync(res.body);
  const xml = await zip.file('word/document.xml').async('string');
  expect(xml).toContain('<w:alias w:val="Participant full name"');
  expect(xml).not.toMatch(/OPAL_[A-Z0-9_]+/);
});
