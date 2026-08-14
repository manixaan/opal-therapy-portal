/**
 * Resource Hub preview surface.
 *
 * Three things are being defended here, and they are easy to lose one at a time:
 *
 *   1. INLINE IS EARNED, NOT ASKED FOR. `?disposition=inline` is untrusted query
 *      input. It may only ever change the header for a format the browser can
 *      render safely, and the decision is keyed on the same stored `format` that
 *      chooses the Content-Type — never on a stored MIME string, which is data
 *      written by whatever created the row.
 *   2. THE BYTES ARE THE BYTES. A fillable PDF must come back exactly as stored:
 *      previewing a form must never flatten it, and the checksum test below is
 *      what says so.
 *   3. AN ARCHIVE IS LISTED, NEVER EXTRACTED. Member names inside a ZIP are
 *      attacker-controlled; traversal, absolute paths and drive letters are
 *      refused rather than shown, and the listing is capped so a small hostile
 *      archive cannot produce an unbounded response.
 *
 * The policy module is exercised as pure functions; the routes are exercised
 * through a real express app with a mocked auth layer, exactly as
 * resource-file-delivery.test.js does, so refusals are tested as HTTP behaviour.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// Governed storage root must be set before the module under test loads it.
const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'opal-rh-preview-'));
process.env.RESOURCE_HUB_STORAGE_PATH = ROOT;

const store = require('../resource-file-storage');
const P = require('../resource-preview');

// ── Preview kind: one answer per format ─────────────────────────────────────

describe('previewKindFor — every format', () => {
  const kind = (over) => P.previewKindFor(over).previewKind;

  test('PDF previews as a PDF', () => {
    expect(kind({ format: 'pdf' })).toBe('pdf');
  });

  test('images preview as images', () => {
    for (const f of ['png', 'jpg', 'jpeg']) expect(kind({ format: f })).toBe('image');
  });

  test('DOCX previews through the vendored renderer', () => {
    expect(kind({ format: 'docx' })).toBe('docx');
  });

  test('a ZIP is a bundle — a listing, not a rendering', () => {
    expect(kind({ format: 'zip' })).toBe('bundle');
  });

  test('legacy binary Office is "none", and the reason names the missing converter', () => {
    for (const f of ['doc', 'ppt']) {
      const v = P.previewKindFor({ format: f });
      expect(v.previewKind).toBe('none');
      expect(v.reason).toMatch(/LibreOffice/);
      expect(v.reason).toMatch(/installed/);
    }
    // .doc is the one where pandoc is also a genuine option, so it is named too.
    expect(P.previewKindFor({ format: 'doc' }).reason).toMatch(/pandoc/);
  });

  test('PPTX is "none" too — there is no slide renderer here', () => {
    const v = P.previewKindFor({ format: 'pptx' });
    expect(v.previewKind).toBe('none');
    expect(v.reason).toMatch(/LibreOffice/);
    expect(v.reason).toMatch(/PowerPoint/);
  });

  test('spreadsheets are "none" with their own reason', () => {
    for (const f of ['xls', 'xlsx']) {
      const v = P.previewKindFor({ format: f });
      expect(v.previewKind).toBe('none');
      expect(v.reason).toMatch(/Excel/);
    }
  });

  test('a link resource has no bytes to preview at all', () => {
    const v = P.previewKindFor({ format: 'link' });
    expect(v.previewKind).toBe('none');
    expect(v.reason).toMatch(/link/i);
  });

  test('an unrecorded type is "none", and says what to do about it', () => {
    for (const f of [null, undefined, '', '   ', 'not a format!', 'x'.repeat(40)]) {
      const v = P.previewKindFor({ format: f });
      expect(v.previewKind).toBe('none');
      expect(v.reason).toMatch(/no recorded type/);
    }
  });

  test('an unknown but well-formed format names itself in the reason', () => {
    const v = P.previewKindFor({ format: 'heic' });
    expect(v.previewKind).toBe('none');
    expect(v.reason).toMatch(/\.heic/);
  });

  test('format is read case- and whitespace-insensitively', () => {
    expect(kind({ format: ' PDF ' })).toBe('pdf');
    expect(kind({ format: 'DocX' })).toBe('docx');
  });

  test('every answer is one of the five kinds the client handles', () => {
    for (const f of ['pdf', 'png', 'jpg', 'jpeg', 'docx', 'zip', 'doc', 'ppt',
      'pptx', 'xlsx', 'link', 'heic', null]) {
      expect(P.PREVIEW_KINDS).toContain(P.previewKindFor({ format: f }).previewKind);
    }
  });
});

describe('previewKindFor — the stored MIME explains, it never unlocks', () => {
  test('a recorded MIME cannot make an unrecorded format renderable', () => {
    // The ingestion script leaves format NULL for types outside migration 026's
    // vocabulary. A NULL format means the byte route will send
    // application/octet-stream, so claiming "pdf" here would promise a preview
    // the server will not serve.
    const v = P.previewKindFor({ format: null, mime: 'application/pdf' });
    expect(v.previewKind).toBe('none');
    expect(v.reason).toMatch(/never recorded/);
    expect(P.previewKindFor({ format: null, mime: 'image/png' }).previewKind).toBe('none');
    expect(P.previewKindFor({
      format: null,
      mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }).previewKind).toBe('none');
  });

  test('but it does explain a legacy file the ingestion stored with no format', () => {
    const v = P.previewKindFor({ format: null, mime: 'application/msword' });
    expect(v.previewKind).toBe('none');
    expect(v.reason).toMatch(/LibreOffice/);
    expect(P.previewKindFor({ format: null, mime: 'application/vnd.ms-powerpoint' }).reason)
      .toMatch(/PowerPoint/);
  });

  test('and it does identify an archive, whose listing needs no Content-Type', () => {
    expect(P.previewKindFor({ format: null, mime: 'application/zip' }).previewKind)
      .toBe('bundle');
    expect(P.previewKindFor({ format: null, mime: 'application/x-zip-compressed' }).previewKind)
      .toBe('bundle');
  });

  test('MIME parameters do not defeat the lookup', () => {
    expect(P.formatFromMime('application/zip; charset=binary')).toBe('zip');
  });

  test('an unrecognised MIME resolves to nothing', () => {
    for (const m of ['text/html', 'application/x-msdownload', '', null, 42]) {
      expect(P.formatFromMime(m)).toBeNull();
    }
  });
});

describe('previewKindFor — page count and fillable fields', () => {
  test('a page count survives only for the kinds that have pages', () => {
    expect(P.previewKindFor({ format: 'pdf', pageCount: 12 }).pageCount).toBe(12);
    expect(P.previewKindFor({ format: 'docx', pageCount: 4 }).pageCount).toBe(4);
    expect(P.previewKindFor({ format: 'png', pageCount: 9 }).pageCount).toBeNull();
    expect(P.previewKindFor({ format: 'zip', pageCount: 9 }).pageCount).toBeNull();
    expect(P.previewKindFor({ format: 'pptx', pageCount: 9 }).pageCount).toBeNull();
  });

  test('a nonsense page count becomes null rather than a confident zero', () => {
    for (const n of [0, -3, 1.5, NaN, Infinity, null, undefined, 999999, 'many', {}]) {
      expect(P.previewKindFor({ format: 'pdf', pageCount: n }).pageCount).toBeNull();
    }
  });

  test('a numeric string from the database is still a count', () => {
    expect(P.previewKindFor({ format: 'pdf', pageCount: '12' }).pageCount).toBe(12);
  });

  test('fillable fields are an AcroForm property, so only a PDF may claim them', () => {
    expect(P.previewKindFor({ format: 'pdf', hasFillableFields: true }).hasFillableFields)
      .toBe(true);
    for (const f of ['docx', 'png', 'zip', 'pptx', null]) {
      expect(P.previewKindFor({ format: f, hasFillableFields: true }).hasFillableFields)
        .toBe(false);
    }
  });

  test('only a real boolean true counts as fillable', () => {
    for (const v of ['true', 1, {}, 'yes']) {
      expect(P.previewKindFor({ format: 'pdf', hasFillableFields: v }).hasFillableFields)
        .toBe(false);
    }
  });
});

// ── Inline disposition ──────────────────────────────────────────────────────

describe('inline disposition is refused for anything the browser cannot render safely', () => {
  test('only PDF and images may go inline', () => {
    for (const f of ['pdf', 'png', 'jpg', 'jpeg', 'PDF']) {
      expect(P.canInline(f)).toBe(true);
    }
  });

  test('every other format stays an attachment, however it is asked for', () => {
    for (const f of ['docx', 'doc', 'ppt', 'pptx', 'xlsx', 'zip', 'link', 'html',
      'svg', 'exe', '', null, undefined]) {
      expect(P.canInline(f)).toBe(false);
      expect(P.dispositionFor(f, 'inline')).toBe('attachment');
    }
  });

  test('a stored MIME cannot buy inline for a format that has not earned it', () => {
    // dispositionFor deliberately takes no MIME argument at all: the only way to
    // influence the header is to hold an allow-listed format.
    expect(P.dispositionFor.length).toBe(2);
    expect(P.dispositionFor(null, 'inline')).toBe('attachment');
  });

  test('the parameter is honoured only when it says exactly "inline"', () => {
    expect(P.dispositionFor('pdf', 'inline')).toBe('inline');
    expect(P.dispositionFor('pdf', 'INLINE')).toBe('inline');
    expect(P.dispositionFor('pdf', ' inline ')).toBe('inline');
    for (const q of ['attachment', 'inline-please', 'true', '1', '', undefined, null,
      ['inline'], { toString: () => 'inline' }, 0]) {
      expect(P.dispositionFor('pdf', q)).toBe('attachment');
    }
  });

  test('nothing that a browser would parse as markup is on the inline list', () => {
    for (const bad of ['html', 'htm', 'svg', 'xml', 'js']) {
      expect(P.INLINE_FORMATS).not.toContain(bad);
    }
  });
});

// ── ZIP member names ────────────────────────────────────────────────────────

describe('zip member sanitiser', () => {
  test('traversal is refused', () => {
    for (const n of ['../secret.pdf', 'a/../../etc/passwd', 'x/..', '..',
      'docs/../../../root/.ssh/id_rsa']) {
      expect(P.safeZipMemberName(n)).toBeNull();
    }
  });

  test('absolute paths and UNC prefixes are refused', () => {
    for (const n of ['/etc/passwd', '/Users/antonyxavier/Documents/7 Resources/x.pdf',
      '\\\\server\\share\\x.pdf', '\\windows\\system32']) {
      expect(P.safeZipMemberName(n)).toBeNull();
    }
  });

  test('a Windows drive letter is refused', () => {
    for (const n of ['C:\\Windows\\x.pdf', 'c:/temp/x', 'D:x.pdf']) {
      expect(P.safeZipMemberName(n)).toBeNull();
    }
  });

  test('home expansion, control characters and over-long names are refused', () => {
    expect(P.safeZipMemberName('~/x.pdf')).toBeNull();
    expect(P.safeZipMemberName('report\r\nX-Injected: yes')).toBeNull();
    expect(P.safeZipMemberName('a\u0000b')).toBeNull();
    expect(P.safeZipMemberName('x'.repeat(P.ZIP_MEMBER_NAME_MAX + 1))).toBeNull();
  });

  test('empty and non-string names are refused', () => {
    for (const n of ['', '   ', null, undefined, 42, {}, []]) {
      expect(P.safeZipMemberName(n)).toBeNull();
    }
  });

  test('an ordinary member name is kept as it is, not rewritten', () => {
    expect(P.safeZipMemberName('Handouts/Session 1.pdf')).toBe('Handouts/Session 1.pdf');
    expect(P.safeZipMemberName(' notes.docx ')).toBe('notes.docx');
    expect(P.safeZipMemberName('Étirements — été.pdf')).toBe('Étirements — été.pdf');
  });

  test('a rejected name is never repaired into a plausible-looking one', () => {
    // Showing 'etc/passwd' for '../etc/passwd' would tell the reader the archive
    // contains something it does not.
    expect(P.safeZipMemberName('../etc/passwd')).toBeNull();
  });
});

describe('safeZipMembers', () => {
  const entry = (name, bytes = 10, dir = false) => ({ name, bytes, dir });

  test('directories are structure, not content, and are left out', () => {
    const out = P.safeZipMembers([entry('folder/', 0, true), entry('folder/a.pdf')]);
    expect(out.members).toEqual([{ name: 'folder/a.pdf', bytes: 10 }]);
    expect(out.total).toBe(1);
  });

  test('unsafe names are counted and dropped, never listed', () => {
    const out = P.safeZipMembers([
      entry('ok.pdf'), entry('../escape.pdf'), entry('/abs.pdf'), entry('C:\\x.pdf'),
    ]);
    expect(out.members).toEqual([{ name: 'ok.pdf', bytes: 10 }]);
    expect(out.rejected).toBe(3);
    expect(JSON.stringify(out.members)).not.toMatch(/\.\.|^\/|C:/);
  });

  test('a zip bomb cannot produce an unbounded listing', () => {
    const many = Array.from({ length: 5000 }, (_, i) => entry(`f${i}.pdf`, 1));
    const out = P.safeZipMembers(many);
    expect(out.members).toHaveLength(P.ZIP_MEMBER_LIMIT);
    expect(out.total).toBe(5000);
    expect(out.truncated).toBe(true);
  });

  test('a complete listing does not claim to be truncated', () => {
    const out = P.safeZipMembers([entry('a.pdf'), entry('b.pdf')]);
    expect(out.truncated).toBe(false);
    expect(out.rejected).toBe(0);
  });

  test('a declared size is echoed only when it is a sane number', () => {
    const out = P.safeZipMembers([
      entry('a.pdf', -5), entry('b.pdf', 'lots'), entry('c.pdf', null), entry('d.pdf', 7.9),
    ]);
    expect(out.members).toEqual([
      { name: 'a.pdf', bytes: null }, { name: 'b.pdf', bytes: null },
      { name: 'c.pdf', bytes: null }, { name: 'd.pdf', bytes: 7 },
    ]);
  });

  test('no input at all is an empty listing, not a crash', () => {
    expect(P.safeZipMembers(null).members).toEqual([]);
    expect(P.safeZipMembers([null, undefined]).members).toEqual([]);
  });
});

// ── Editable variants ───────────────────────────────────────────────────────

describe('isEditableVariant', () => {
  test('a DOCX beside a PDF of the same resource is the editable copy', () => {
    const docx = { format: 'docx' };
    const files = [{ format: 'pdf' }, docx];
    expect(P.isEditableVariant(docx, files)).toBe(true);
  });

  test('a DOCX on its own is just the document', () => {
    const docx = { format: 'docx' };
    expect(P.isEditableVariant(docx, [docx])).toBe(false);
  });

  test('the PDF itself is never the editable variant', () => {
    const pdf = { format: 'pdf' };
    expect(P.isEditableVariant(pdf, [pdf, { format: 'docx' }])).toBe(false);
  });

  test('a legacy .doc identified only by its MIME still counts', () => {
    const doc = { format: null, mime: 'application/msword' };
    expect(P.isEditableVariant(doc, [{ format: 'pdf' }, doc])).toBe(true);
  });
});

// ── The routes ──────────────────────────────────────────────────────────────

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

describe('preview routes', () => {
  const request = require('supertest');
  const express = require('express');
  const { PDFDocument } = require('pdf-lib');
  const JSZip = require('jszip');

  const ORG = '11111111-1111-1111-1111-111111111111';
  const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
  const FILE_ID = '33333333-3333-3333-3333-333333333333';
  const RES_ID = '44444444-4444-4444-4444-444444444444';

  let app;
  let flatPdf;         // three pages, no form
  let fillablePdf;     // one page, one AcroForm text field
  let zipBytes;        // an archive carrying a traversal member
  let docxBytes;       // minimal OOXML with a recorded page count

  beforeAll(async () => {
    app = express();
    app.use(require('../resource-hub-r2-routes'));

    const plain = await PDFDocument.create();
    plain.addPage([300, 300]);
    plain.addPage([300, 300]);
    plain.addPage([300, 300]);
    flatPdf = Buffer.from(await plain.save());
    store.put('p/flat.pdf', flatPdf);

    const form = await PDFDocument.create();
    const page = form.addPage([300, 300]);
    form.getForm().createTextField('participant.name')
      .addToPage(page, { x: 10, y: 10, width: 200, height: 20 });
    fillablePdf = Buffer.from(await form.save());
    store.put('p/fillable.pdf', fillablePdf);

    const zip = new JSZip();
    zip.file('Handouts/Session 1.pdf', 'x'.repeat(40));
    zip.file('Handouts/Session 2.pdf', 'y'.repeat(50));
    // Hostile member names, none of which may appear in a listing. JSZip
    // normalises a leading '../' away when WRITING an archive, so a realistic
    // fixture has to use the forms it preserves — an absolute path, a Windows
    // drive letter and a backslash traversal. A real archive from elsewhere is
    // under no such constraint, which is exactly why the sanitiser exists.
    zip.file('/abs.pdf', 'z');
    zip.file('C:\\Windows\\evil.pdf', 'z');
    zip.file('..\\back.pdf', 'z');
    zipBytes = await zip.generateAsync({ type: 'nodebuffer' });
    store.put('p/bundle.zip', zipBytes);

    const docx = new JSZip();
    docx.file('word/document.xml', '<w:document/>');
    docx.file('docProps/app.xml', '<Properties><Pages>7</Pages></Properties>');
    docxBytes = await docx.generateAsync({ type: 'nodebuffer' });
    store.put('p/doc.docx', docxBytes);
  });

  beforeEach(() => { mockQuery.mockReset(); });

  function row(over = {}) {
    return {
      id: FILE_ID, file_name: 'Feelings Check-In.pdf', file_mime: 'application/pdf',
      file_size_bytes: flatPdf.length, file_data: null, storage_backend: 'rhub',
      storage_key: 'p/flat.pdf', file_tier: null, format: 'pdf',
      checksum_sha256: crypto.createHash('sha256').update(flatPdf).digest('hex'),
      resource_id: RES_ID, organisation_id: ORG, resource_tier: 'staff',
      resource_status: 'approved', publication_state: 'approved', archived_at: null,
      ...over,
    };
  }

  /**
   * Route the mocked pool by the shape of the SQL, so the guard query and the
   * preview-facts query can answer differently — which is what the real schema
   * does, and what a single mockResolvedValue would hide.
   */
  function serve(over = {}, stored = {}) {
    mockQuery.mockImplementation((sql) => {
      if (/JOIN resources/.test(sql)) return Promise.resolve({ rows: [row(over)] });
      if (/preview_page_count/.test(sql)) return Promise.resolve({ rows: [stored] });
      return Promise.resolve({ rows: [] });
    });
  }

  const as = (role, organisation_id = ORG) => {
    global.__TEST_USER = { id: 'u1', role, organisation_id };
  };

  // ── 1. The byte route and ?disposition=inline ─────────────────────────────

  describe('GET /api/rh2/files/:fileId?disposition=inline', () => {
    test('a PDF may be rendered in place', async () => {
      as('owner'); serve();
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition'])
        .toBe('inline; filename="Feelings Check-In.pdf"');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    test('images may be rendered in place', async () => {
      as('owner'); serve({ format: 'png', file_name: 'chart.png' });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.headers['content-disposition']).toMatch(/^inline;/);
      expect(res.headers['content-type']).toBe('image/png');
    });

    test('a DOCX ignores the parameter and stays an attachment', async () => {
      as('owner'); serve({ format: 'docx', file_name: 'plan.docx', storage_key: 'p/doc.docx' });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.status).toBe(200);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
    });

    test('every non-viewable format stays an attachment', async () => {
      as('owner');
      for (const format of ['pptx', 'xlsx', 'link', 'html', null]) {
        serve({ format });
        const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
        expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      }
    });

    test('a stored MIME claiming PDF cannot win inline for an unrecorded format', async () => {
      as('owner'); serve({ format: null, file_mime: 'application/pdf' });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      expect(res.headers['content-type']).toBe('application/octet-stream');
    });

    test('any other value of the parameter is ignored', async () => {
      as('owner');
      for (const q of ['attachment', 'inline-please', 'INLINEX', '1', '']) {
        serve();
        const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=${q}`);
        expect(res.headers['content-disposition']).toMatch(/^attachment;/);
      }
    });

    test('the default, with no parameter at all, is unchanged', async () => {
      as('owner'); serve();
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}`);
      expect(res.headers['content-disposition'])
        .toBe('attachment; filename="Feelings Check-In.pdf"');
    });

    test('a fillable PDF is streamed byte-identical — never flattened', async () => {
      as('owner');
      serve({ storage_key: 'p/fillable.pdf', file_size_bytes: fillablePdf.length });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.status).toBe(200);
      expect(crypto.createHash('sha256').update(res.body).digest('hex'))
        .toBe(crypto.createHash('sha256').update(fillablePdf).digest('hex'));
      // And the form is still a form after the round trip.
      const back = await PDFDocument.load(res.body);
      expect(back.getForm().getFields().map((f) => f.getName())).toEqual(['participant.name']);
    });

    test('inline delivers the same bytes as the download', async () => {
      as('owner'); serve();
      const inline = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      serve();
      const attach = await request(app).get(`/api/rh2/files/${FILE_ID}`);
      expect(inline.body.equals(attach.body)).toBe(true);
    });

    test('inline does not weaken a single guard', async () => {
      as('read_only'); serve({ file_tier: 'clinician' });
      const res = await request(app).get(`/api/rh2/files/${FILE_ID}?disposition=inline`);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });
  });

  // ── 2. The preview metadata route ─────────────────────────────────────────

  describe('GET /api/rh2/files/:fileId/preview', () => {
    const get = () => request(app).get(`/api/rh2/files/${FILE_ID}/preview`);

    test('a PDF reports its kind, its real page count and its inline URL', async () => {
      as('therapist'); serve();
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        previewKind: 'pdf',
        reason: null,
        pageCount: 3,
        hasFillableFields: false,
        inlineUrl: `/api/rh2/files/${FILE_ID}?disposition=inline`,
        members: null,
      });
    });

    test('a fillable PDF says so, so the viewer can send the reader to a reader', async () => {
      as('owner'); serve({ storage_key: 'p/fillable.pdf', file_size_bytes: fillablePdf.length });
      const res = await get();
      expect(res.body.previewKind).toBe('pdf');
      expect(res.body.hasFillableFields).toBe(true);
      expect(res.body.pageCount).toBe(1);
    });

    test('a recorded page count is used without opening the file', async () => {
      as('owner');
      serve({ storage_key: 'p/does-not-exist.pdf' }, { preview_page_count: 42, has_fillable_fields: false });
      const res = await get();
      expect(res.body.pageCount).toBe(42);
      expect(res.body.previewKind).toBe('pdf');
    });

    test('a DOCX reports the page count Word recorded', async () => {
      as('owner');
      serve({ format: 'docx', storage_key: 'p/doc.docx', file_size_bytes: docxBytes.length });
      const res = await get();
      expect(res.body.previewKind).toBe('docx');
      expect(res.body.pageCount).toBe(7);
      expect(res.body.hasFillableFields).toBe(false);
      expect(res.body.inlineUrl).toBe(`/api/rh2/files/${FILE_ID}?disposition=inline`);
    });

    test('an image previews with no page count', async () => {
      as('owner'); serve({ format: 'png' });
      const res = await get();
      expect(res.body.previewKind).toBe('image');
      expect(res.body.pageCount).toBeNull();
      expect(res.body.inlineUrl).not.toBeNull();
    });

    test('PPTX is an honest "none" naming the missing converter, with no URL', async () => {
      as('owner'); serve({ format: 'pptx', file_name: 'training.pptx' });
      const res = await get();
      expect(res.body.previewKind).toBe('none');
      expect(res.body.reason).toMatch(/LibreOffice/);
      expect(res.body.inlineUrl).toBeNull();
      expect(res.body.members).toBeNull();
      expect(res.body.pageCount).toBeNull();
    });

    test('a legacy .doc with no recorded format still explains itself', async () => {
      as('owner');
      serve({ format: null, file_mime: 'application/msword', file_name: 'referral.doc' });
      const res = await get();
      expect(res.body.previewKind).toBe('none');
      expect(res.body.reason).toMatch(/Word/);
      expect(res.body.reason).toMatch(/LibreOffice|pandoc/);
    });

    test('an archive is listed, and the traversal member is not shown', async () => {
      as('owner');
      serve({ format: null, file_mime: 'application/zip', file_name: 'pack.zip',
        storage_key: 'p/bundle.zip', file_size_bytes: zipBytes.length });
      const res = await get();
      expect(res.body.previewKind).toBe('bundle');
      expect(res.body.members.map((m) => m.name).sort())
        .toEqual(['Handouts/Session 1.pdf', 'Handouts/Session 2.pdf']);
      expect(res.body.members[0].bytes).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toMatch(/abs\.pdf|evil\.pdf|back\.pdf|\.\.|C:/);
      expect(res.body.reason).toMatch(/3 entries had an unsafe name/);
      // Listed, not extracted: nothing was written to the governed root.
      expect(fs.existsSync(path.join(store.root(), 'Handouts'))).toBe(false);
      expect(fs.readdirSync(store.root()).sort()).toEqual(['p']);
    });

    test('a corrupt archive reports that, rather than an empty one', async () => {
      as('owner');
      store.put('p/broken.zip', Buffer.from('this is not a zip'));
      serve({ format: 'zip', storage_key: 'p/broken.zip', file_size_bytes: 17 });
      const res = await get();
      expect(res.body.previewKind).toBe('none');
      expect(res.body.reason).toMatch(/could not be read/);
      expect(res.body.members).toBeNull();
    });

    test('a file whose bytes are gone is 404, matching the byte route', async () => {
      as('owner'); serve({ storage_key: 'p/missing.pdf' });
      const res = await get();
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Not found' });
    });

    test('a key that escapes the governed root is 404 and says nothing about why', async () => {
      as('owner'); serve({ storage_key: '../../etc/passwd' });
      const res = await get();
      expect(res.status).toBe(404);
      expect(JSON.stringify(res.body)).not.toMatch(/passwd|storage|root/);
    });

    test('every guard the byte route applies applies here too', async () => {
      const cases = [
        ['another organisation', 'owner', { organisation_id: OTHER_ORG }],
        ['a tier the caller may not read', 'read_only', { file_tier: 'clinician' }],
        ['a resource tier that outranks the file', 'read_only', { resource_tier: 'clinician', file_tier: 'staff' }],
        ['a retired resource', 'owner', { publication_state: 'retired' }],
        ['an excluded-private resource', 'owner', { resource_tier: 'excluded-private', publication_state: 'excluded-private' }],
        ['an archived file', 'owner', { archived_at: new Date().toISOString() }],
        ['a draft resource seen by a therapist', 'therapist', { resource_status: 'draft' }],
      ];
      for (const [, role, over] of cases) {
        as(role); serve(over);
        const res = await get();
        expect(res.status).toBe(404);
        expect(res.body).toEqual({ error: 'Not found' });
      }
    });

    test('a missing row is the same 404', async () => {
      as('owner');
      mockQuery.mockResolvedValue({ rows: [] });
      expect((await get()).status).toBe(404);
    });

    test('a malformed id never reaches the database', async () => {
      as('owner');
      const res = await request(app).get('/api/rh2/files/not-a-uuid/preview');
      expect(res.status).toBe(404);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    test('an unauthenticated request is rejected', async () => {
      global.__TEST_USER = null;
      expect((await get()).status).toBe(401);
    });

    test('the answer is never cached and never names a storage location', async () => {
      as('owner'); serve();
      const res = await get();
      expect(res.headers['cache-control']).toBe('private, no-store');
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/p\/flat\.pdf|rhub|storage/i);
      expect(body).not.toMatch(new RegExp(ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });

    test('the schema not yet carrying the preview columns degrades, not 500s', async () => {
      as('owner');
      mockQuery.mockImplementation((sql) => {
        if (/JOIN resources/.test(sql)) return Promise.resolve({ rows: [row()] });
        // What Postgres does when migration 031 has not been applied.
        return Promise.reject(new Error('column "preview_page_count" does not exist'));
      });
      const res = await get();
      expect(res.status).toBe(200);
      expect(res.body.previewKind).toBe('pdf');
      expect(res.body.pageCount).toBe(3);      // derived from the bytes instead
    });
  });

  // ── 3. The files projection ───────────────────────────────────────────────

  describe('GET /api/rh2/resources/:id/files', () => {
    function serveList(files, resource = {}) {
      mockQuery.mockImplementation((sql) => {
        if (/FROM resource_files/.test(sql)) return Promise.resolve({ rows: files });
        if (/FROM resources/.test(sql)) {
          return Promise.resolve({
            rows: [{
              id: RES_ID, organisation_id: ORG, status: 'approved',
              publication_state: 'approved', access_tier: 'staff', ...resource,
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });
    }

    const listing = () => request(app).get(`/api/rh2/resources/${RES_ID}/files`);

    const file = (over) => ({
      id: FILE_ID, file_name: 'Guide.pdf', file_mime: 'application/pdf', format: 'pdf',
      file_size_bytes: 1000, checksum_sha256: null, access_tier: null, is_primary: true,
      uploaded_at: null, preview_page_count: null, has_fillable_fields: null, ...over,
    });

    test('each file carries the four new preview fields', async () => {
      as('therapist');
      serveList([file({ preview_page_count: 6, has_fillable_fields: true })]);
      const res = await listing();
      expect(res.status).toBe(200);
      expect(res.body.files[0]).toMatchObject({
        previewKind: 'pdf', pageCount: 6, hasFillableFields: true, isEditableVariant: false,
      });
    });

    test('a DOCX offered beside a PDF is marked as the editable variant', async () => {
      as('therapist');
      serveList([
        file({ id: FILE_ID, format: 'pdf' }),
        file({ id: '55555555-5555-5555-5555-555555555555', format: 'docx',
          file_name: 'Guide.docx', is_primary: false }),
      ]);
      const res = await listing();
      expect(res.body.files.map((f) => f.isEditableVariant)).toEqual([false, true]);
      expect(res.body.files.map((f) => f.previewKind)).toEqual(['pdf', 'docx']);
    });

    test('the hint is not derived from files the caller cannot see', async () => {
      // The PDF sits at a tier read_only cannot read, so it must not even exist
      // as far as the DOCX's label is concerned.
      as('read_only');
      serveList([
        file({ format: 'pdf', access_tier: 'clinician' }),
        file({ id: '55555555-5555-5555-5555-555555555555', format: 'docx',
          file_name: 'Guide.docx', is_primary: false }),
      ]);
      const res = await listing();
      expect(res.body.files).toHaveLength(1);
      expect(res.body.files[0].isEditableVariant).toBe(false);
    });

    test('an unpreviewable file is listed, and says so', async () => {
      as('owner');
      serveList([file({ format: 'pptx', file_name: 'Training.pptx' })]);
      const res = await listing();
      expect(res.body.files[0].previewKind).toBe('none');
      expect(res.body.files[0].pageCount).toBeNull();
    });

    test('no storage location reaches the client, old fields or new', async () => {
      as('owner');
      serveList([file({ storage_key: 'p/flat.pdf', storage_backend: 'rhub', file_data: 'AAA' })]);
      const res = await listing();
      const body = JSON.stringify(res.body);
      expect(body).not.toMatch(/storage_key|storageKey|storage_backend|rhub|file_data|AAA/);
      // file_mime is read to explain refusals; it is not published alongside the
      // server's own answer.
      expect(res.body.files[0]).not.toHaveProperty('mime');
      expect(res.body.files[0]).not.toHaveProperty('fileMime');
    });

    test('listing survives a schema without the preview columns', async () => {
      as('owner');
      let attempted = 0;
      mockQuery.mockImplementation((sql) => {
        if (/FROM resource_files/.test(sql)) {
          attempted++;
          if (/preview_page_count/.test(sql)) {
            return Promise.reject(new Error('column "preview_page_count" does not exist'));
          }
          return Promise.resolve({ rows: [file()] });
        }
        return Promise.resolve({
          rows: [{ id: RES_ID, organisation_id: ORG, status: 'approved',
            publication_state: 'approved', access_tier: 'staff' }],
        });
      });
      const res = await listing();
      expect(res.status).toBe(200);
      expect(attempted).toBe(2);                       // tried, fell back
      expect(res.body.files[0].previewKind).toBe('pdf');
      expect(res.body.files[0].pageCount).toBeNull();  // unknown, not zero
    });
  });
});

afterAll(() => {
  fs.rmSync(ROOT, { recursive: true, force: true });
});
