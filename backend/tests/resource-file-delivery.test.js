/**
 * Secure Resource Hub file delivery.
 *
 * The endpoint's whole job is to refuse: wrong organisation, wrong role, wrong
 * governance state, wrong tier, missing row, missing bytes, or a key that tries
 * to leave the governed root. Every refusal must look identical from outside,
 * because distinguishing "not found" from "not allowed" tells an attacker which
 * clinical documents exist.
 *
 * The route is exercised through a real express app with a mocked auth layer,
 * so the access decisions are tested as HTTP behaviour, not just as functions.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Governed storage root must be set before the module under test loads it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-rh-files-'));
process.env.RESOURCE_HUB_STORAGE_PATH = ROOT;

const store = require('../resource-file-storage');
const G = require('../resource-governance');

// ── Storage containment ─────────────────────────────────────────────────────

describe('governed storage containment', () => {
  let outside;
  beforeAll(() => {
    outside = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-outside-'));
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'CLIENT DATA');
    store.put('legit/file.txt', Buffer.from('hello'));
    fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(store.root(), 'escape.txt'));
  });
  afterAll(() => {
    fs.rmSync(outside, { recursive: true, force: true });
  });

  test('a legitimate relative key reads back', () => {
    expect(store.get('legit/file.txt').toString()).toBe('hello');
  });

  test('traversal out of the root is refused', () => {
    expect(() => store.get('../secret.txt')).toThrow(/Invalid storage key/);
    expect(() => store.get('legit/../../secret.txt')).toThrow(/Invalid storage key/);
  });

  test('an absolute path is refused', () => {
    expect(() => store.get('/etc/hosts')).toThrow(/Invalid storage key/);
    expect(() => store.get(path.join(outside, 'secret.txt'))).toThrow(/Invalid storage key/);
  });

  test('a symlink escaping the root is refused even though it sits inside it', () => {
    expect(fs.existsSync(path.join(store.root(), 'escape.txt'))).toBe(true);
    expect(() => store.get('escape.txt')).toThrow(/Invalid storage key/);
  });

  test('a sibling directory sharing the root prefix is refused', () => {
    // The classic startsWith() bug: /root and /root-evil share a prefix.
    expect(() => store.get(`../${path.basename(ROOT)}-evil/x`)).toThrow(/Invalid storage key/);
  });

  test('empty, null and non-string keys are refused', () => {
    for (const k of ['', null, undefined, 42, {}]) {
      expect(() => store.get(k)).toThrow(/Invalid storage key/);
    }
  });
});

// ── Filename and MIME control ───────────────────────────────────────────────

describe('download filename sanitisation', () => {
  test('path separators cannot survive into the header', () => {
    expect(store.safeDownloadName('../../etc/passwd', 'pdf')).not.toMatch(/[\\/]/);
    expect(store.safeDownloadName('a/b\\c', 'pdf')).toBe('a-b-c.pdf');
  });

  test('CR and LF cannot split the response headers', () => {
    const out = store.safeDownloadName('report\r\nX-Injected: yes', 'pdf');
    expect(out).not.toMatch(/[\r\n]/);
  });

  test('quotes cannot escape the quoted filename', () => {
    expect(store.safeDownloadName('evil".pdf', 'pdf')).not.toMatch(/"/);
  });

  test('a name that sanitises to nothing still yields a usable filename', () => {
    expect(store.safeDownloadName('', 'pdf')).toBe('resource.pdf');
    expect(store.safeDownloadName('...', 'pdf')).toBe('resource.pdf');
  });

  test('the extension follows the format, not the supplied name', () => {
    expect(store.safeDownloadName('thing.exe', 'pdf')).toBe('thing.exe.pdf');
    expect(store.safeDownloadName('thing.pdf', 'pdf')).toBe('thing.pdf');
  });

  test('MIME comes from a controlled allow-list, never from stored input', () => {
    expect(store.mimeForFormat('pdf')).toBe('application/pdf');
    expect(store.mimeForFormat('docx'))
      .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    // anything unrecognised degrades to a non-executing generic type
    for (const f of ['exe', 'html', 'svg', '', null, undefined, 'text/html']) {
      expect(store.mimeForFormat(f)).toBe('application/octet-stream');
    }
  });
});

// ── Access decisions ────────────────────────────────────────────────────────

describe('effective access for files', () => {
  test('a clinician-tier DOCX on a staff resource is hidden from read_only', () => {
    expect(G.canReadFile('read_only', 'staff', 'clinician')).toBe(false);
    expect(G.canReadFile('therapist', 'staff', 'clinician')).toBe(true);
    expect(G.canReadFile('owner', 'staff', 'clinician')).toBe(true);
  });

  test('a staff-tier file cannot widen a clinician-only resource', () => {
    expect(G.effectiveAccessTier('clinician', 'staff')).toBe('clinician');
    expect(G.canReadFile('read_only', 'clinician', 'staff')).toBe(false);
  });

  test('an excluded-private resource serves nothing to anyone', () => {
    for (const role of ['owner', 'admin', 'therapist', 'read_only']) {
      expect(G.canReadFile(role, 'excluded-private', null)).toBe(false);
      expect(G.canReadFile(role, 'excluded-private', 'staff')).toBe(false);
    }
  });

  test('an unknown tier on either side fails closed', () => {
    expect(G.canReadFile('owner', 'staff', 'public')).toBe(false);
    expect(G.canReadFile('owner', 'participant', null)).toBe(false);
  });

  test('withdrawn and quarantined resources are not downloadable at all', () => {
    expect(G.canDownloadInState('retired')).toBe(false);
    expect(G.canDownloadInState('excluded-private')).toBe(false);
  });

  test('but a resource still in review IS downloadable — review means opening it', () => {
    for (const s of ['inventory', 'rights-review', 'clinical-review',
      'brand-accessibility-review', 'approved']) {
      expect(G.canDownloadInState(s)).toBe(true);
    }
  });
});

// ── The route ───────────────────────────────────────────────────────────────

jest.mock('../permissions', () => ({
  requireAuth: (req, res, next) => {
    if (!global.__TEST_USER) return res.status(401).json({ error: 'unauthenticated' });
    req.user = global.__TEST_USER;
    next();
  },
}));

const mockQuery = jest.fn();
jest.mock('../database', () => ({
  pool: { query: (...a) => mockQuery(...a), connect: jest.fn() },
  // Must return a promise: audit() chains .catch() on the result.
  logAuditEvent: jest.fn(() => Promise.resolve()),
}));

describe('GET /api/rh2/files/:fileId', () => {
  const request = require('supertest');
  const express = require('express');

  const ORG = '11111111-1111-1111-1111-111111111111';
  const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
  const FILE_ID = '33333333-3333-3333-3333-333333333333';
  const RES_ID = '44444444-4444-4444-4444-444444444444';

  let app;
  beforeAll(() => {
    app = express();
    app.use(require('../resource-hub-r2-routes'));
    store.put('t/ok.pdf', Buffer.from('%PDF-1.4 test'));
  });

  beforeEach(() => { mockQuery.mockReset(); });

  function row(over = {}) {
    return {
      id: FILE_ID, file_name: 'Feelings Check-In.pdf', file_mime: 'application/pdf',
      file_size_bytes: 13, file_data: null, storage_backend: 'rhub',
      storage_key: 't/ok.pdf', file_tier: null, format: 'pdf',
      checksum_sha256: crypto.createHash('sha256').update('%PDF-1.4 test').digest('hex'),
      resource_id: RES_ID, organisation_id: ORG, resource_tier: 'staff',
      // resource_status drives visibleTo(): 'approved' is the ordinary case.
      // A draft is author-only, exercised separately below.
      resource_status: 'approved',
      publication_state: 'clinical-review', archived_at: null,
      ...over,
    };
  }
  const serve = (over) => { mockQuery.mockResolvedValue({ rows: [row(over)] }); };
  const as = (role, organisation_id = ORG) => {
    global.__TEST_USER = { id: 'u1', role, organisation_id };
  };

  test('an authorised staff user downloads the file', async () => {
    as('owner'); serve();
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('attachment; filename="Feelings Check-In.pdf"');
    expect(res.body.toString()).toBe('%PDF-1.4 test');
  });

  test('a file belonging to another organisation is 404, not 403', async () => {
    as('owner'); serve({ organisation_id: OTHER_ORG });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('read_only is refused a clinician-tier file, with the same generic 404', async () => {
    as('read_only'); serve({ file_tier: 'clinician' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('a therapist may download a clinician-tier file', async () => {
    as('therapist'); serve({ file_tier: 'clinician' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(200);
  });

  test('a file tier more restrictive than its parent wins', async () => {
    as('read_only'); serve({ resource_tier: 'staff', file_tier: 'admin' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('a resource tier more restrictive than its file wins', async () => {
    as('read_only'); serve({ resource_tier: 'clinician', file_tier: 'staff' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('an excluded-private resource serves nothing, even to the owner', async () => {
    as('owner');
    serve({ resource_tier: 'excluded-private', publication_state: 'excluded-private' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('a retired resource serves nothing', async () => {
    as('owner'); serve({ publication_state: 'retired' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('an archived file serves nothing', async () => {
    as('owner'); serve({ archived_at: new Date().toISOString() });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('a therapist is refused a DRAFT resource file, matching the detail route', async () => {
    // The detail route 404s a therapist on a draft; the file surfaces must
    // agree, or the quieter one becomes a way to enumerate unpublished work.
    as('therapist'); serve({ resource_status: 'draft' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('an author still reaches a draft resource file', async () => {
    as('owner'); serve({ resource_status: 'draft' });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(200);
  });

  test('a missing database row is 404', async () => {
    as('owner'); mockQuery.mockResolvedValue({ rows: [] });
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(404);
  });

  test('a row whose bytes are gone is 404, not 500', async () => {
    as('owner'); serve({ storage_key: 't/does-not-exist.pdf' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  test('a stored key that escapes the root is refused, and says nothing about why', async () => {
    as('owner'); serve({ storage_key: '../../etc/passwd' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/passwd|storage|root|\//);
  });

  test('a malformed id never reaches the database', async () => {
    as('owner');
    const res = await request(app).get('/api/rh2/files/not-a-uuid');
    expect(res.status).toBe(404);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('an unauthenticated request is rejected', async () => {
    global.__TEST_USER = null;
    expect((await request(app).get(`/api/rh2/files/${FILE_ID}`)).status).toBe(401);
  });

  test('the response never discloses a storage key, root or absolute path', async () => {
    as('owner'); serve();
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    const headers = JSON.stringify(res.headers);
    expect(headers).not.toMatch(/t\/ok\.pdf/);
    expect(headers).not.toMatch(/rhub/);
    expect(headers).not.toMatch(new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    expect(headers).not.toMatch(/7 Resources/);
  });

  test('Content-Type is driven by format, not by the stored file_mime', async () => {
    // A poisoned row claiming text/html must not get to choose.
    as('owner'); serve({ file_mime: 'text/html', format: 'pdf' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.headers['content-type']).toBe('application/pdf');
  });

  test('an unrecognised format degrades to a non-rendering type', async () => {
    as('owner'); serve({ format: 'html', file_name: 'x.html' });
    const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  /* ── Inline preview and thumbnail: same ladder, different bytes ────────── */

  describe('preview and thumbnail delivery', () => {
    // Both routes issue a second query for the derivative row; serveWithDeriv
    // scripts the pair. The first query is always the shared decision ladder.
    const serveWithDeriv = (over, derivRows) => {
      mockQuery
        .mockResolvedValueOnce({ rows: [row(over)] })
        .mockResolvedValueOnce({ rows: derivRows });
    };

    beforeAll(() => {
      store.put('derivatives/aa/thumb.png', Buffer.from('\x89PNG fake'));
      store.put('derivatives/aa/legacy.docx', Buffer.from('PK docx fake'));
    });

    test('a PDF preview serves the original inline, not as an attachment', async () => {
      as('therapist'); serve();
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/preview`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toMatch(/^inline; /);
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    test('a legacy .doc preview serves its converted preview-docx derivative', async () => {
      as('therapist');
      serveWithDeriv({ format: null, storage_key: 't/ok.doc', file_name: 'Old Sheet.doc' },
        [{ storage_key: 'derivatives/aa/legacy.docx', format: 'docx' }]);
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/preview`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type'])
        .toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      expect(res.headers['content-disposition']).toMatch(/^inline; .*\.docx"/);
    });

    test('a format with no preview path is a uniform 404', async () => {
      as('therapist');
      serveWithDeriv({ format: null, storage_key: 't/ok.zip', file_name: 'pack.zip' }, []);
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/preview`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    test('a thumbnail serves the generated derivative image', async () => {
      as('read_only');
      serveWithDeriv({}, [{ storage_key: 'derivatives/aa/thumb.png', format: 'png' }]);
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/thumbnail`);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('image/png');
    });

    test('a file with no thumbnail row is a uniform 404', async () => {
      as('therapist'); serveWithDeriv({}, []);
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/thumbnail`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    test('an excluded-private resource serves no preview and no thumbnail — the ladder is shared', async () => {
      for (const route of ['preview', 'thumbnail']) {
        as('owner');
        mockQuery.mockReset();
        mockQuery.mockResolvedValue({
          rows: [row({ resource_tier: 'excluded-private', publication_state: 'excluded-private' })],
        });
        const res = await request(app).get(`/api/rh2/files/${FILE_ID}/${route}`);
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'Not found' });
      }
    });

    test('a tier the role cannot read refuses the thumbnail too — a first page IS content', async () => {
      as('read_only');
      mockQuery.mockResolvedValue({ rows: [row({ file_tier: 'clinician' })] });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/thumbnail`);
      expect(res.status).toBe(404);
    });

    test('an admin-tier resource (rights-review queue) previews for admin, not therapist', async () => {
      as('therapist');
      mockQuery.mockResolvedValue({ rows: [row({ resource_tier: 'admin', publication_state: 'rights-review' })] });
      expect((await request(app).get(`/api/rh2/files/${FILE_ID}/preview`)).status).toBe(404);

      as('admin');
      mockQuery.mockReset();
      mockQuery.mockResolvedValue({ rows: [row({ resource_tier: 'admin', publication_state: 'rights-review' })] });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}/preview`);
      expect(res.status).toBe(200);
    });
  });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});
