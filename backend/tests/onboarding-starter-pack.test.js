'use strict';

/**
 * STARTER PACKS — composition, filenames and the ZIP.
 *
 * Pure tests: no database, no network, no clock. What is pinned here is the
 * set of properties a starter pack has to hold whatever else changes.
 *
 *   - a filename built from a document TITLE can never address a path,
 *     because titles come from a library an Owner types into;
 *   - a package version published before this feature existed produces an
 *     empty pack rather than an exception, so an old onboarding still opens;
 *   - the ZIP is deterministic, so its sha256 identifies its CONTENT rather
 *     than the second it was built — which is the whole basis for claiming
 *     later that two packs were the same;
 *   - a document that cannot be read is reported as an omission, never
 *     silently dropped. A starter pack quietly missing the Fair Work
 *     statement is a compliance failure that looks like a success.
 */

const JSZip = require('jszip');
const pack = require('../onboarding-starter-pack');

// ═════════════════════════════════════════════════════════════════════════════
//  FILENAMES
// ═════════════════════════════════════════════════════════════════════════════

describe('safeStem', () => {
  test('keeps an ordinary document title readable', () => {
    expect(pack.safeStem('Fair Work Information Statement')).toBe('Fair Work Information Statement');
    expect(pack.safeStem('Employee Handbook (2026)')).toBe('Employee Handbook (2026)');
    expect(pack.safeStem("Opal's Code of Conduct")).toBe("Opal's Code of Conduct");
  });

  test('no separator survives, so a title cannot address a path', () => {
    for (const evil of [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'a/b/c',
      'a\\b\\c',
      '....//....//etc',
    ]) {
      const out = pack.safeStem(evil);
      expect(out).not.toMatch(/[/\\]/);
      expect(out).not.toContain('..');
    }
  });

  test('a leading dot cannot survive, so nothing becomes a hidden file', () => {
    expect(pack.safeStem('.bashrc').startsWith('.')).toBe(false);
    expect(pack.safeStem('...')).toBe('Document');
  });

  test('an empty or unusable title falls back rather than producing ""', () => {
    expect(pack.safeStem('')).toBe('Document');
    expect(pack.safeStem(null)).toBe('Document');
    expect(pack.safeStem('***')).toBe('Document');
    expect(pack.safeStem('!!!', 'Fallback')).toBe('Fallback');
  });

  test('a Windows device name is defused', () => {
    // CON.pdf is unopenable on Windows whatever the extension.
    expect(pack.safeStem('CON')).toBe('CON document');
    expect(pack.safeStem('lpt1')).toBe('lpt1 document');
    expect(pack.safeStem('NUL')).toBe('NUL document');
  });

  test('is length-capped, so no filesystem refuses the archive', () => {
    expect(pack.safeStem('A'.repeat(400)).length).toBeLessThanOrEqual(90);
  });
});

describe('extensionFor', () => {
  test('prefers the stored MIME type', () => {
    expect(pack.extensionFor({ file_mime: 'application/pdf', file_name: 'x.doc' })).toBe('pdf');
    expect(pack.extensionFor({
      file_mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })).toBe('docx');
  });

  test('falls back to the filename when the MIME is unknown', () => {
    expect(pack.extensionFor({ file_mime: 'application/octet-stream', file_name: 'policy.rtf' })).toBe('rtf');
  });

  test('never returns something that could extend the path', () => {
    expect(pack.extensionFor({ file_name: 'a/b' })).toBe('bin');
    expect(pack.extensionFor({})).toBe('bin');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  VERSION CONTENT
// ═════════════════════════════════════════════════════════════════════════════

describe('fromVersionContent', () => {
  test('reads a pinned pack out of a published version', () => {
    const out = pack.fromVersionContent({
      requirements: [],
      starterPack: {
        documents: [{ position: 1, title: 'Handbook' }],
        omissions: [{ code: 'X', reason: 'never published' }],
      },
    });
    expect(out.legacy).toBe(false);
    expect(out.documents).toHaveLength(1);
    expect(out.omissions).toHaveLength(1);
  });

  test('a version published before starter packs existed is EMPTY, not an error', () => {
    // The migration is additive and old versions are immutable, so this is the
    // permanent state of every pre-038 package version. Throwing here would
    // make an old onboarding unopenable.
    const out = pack.fromVersionContent({ requirements: [], chain: [] });
    expect(out.legacy).toBe(true);
    expect(out.documents).toEqual([]);
  });

  test('malformed content degrades to empty rather than throwing', () => {
    expect(pack.fromVersionContent(null).legacy).toBe(true);
    expect(pack.fromVersionContent({ starterPack: 'nonsense' }).legacy).toBe(true);
    expect(pack.fromVersionContent({ starterPack: { documents: 'no' } }).legacy).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE READ-ME
// ═════════════════════════════════════════════════════════════════════════════

describe('the read-me', () => {
  const readme = () => pack.buildReadme({
    employeeName: 'Jane Smith',
    orgName: 'Opal Therapy',
    roleTitle: 'Occupational Therapist',
    startDate: '2026-09-01',
    dueDate: '2026-08-28',
    returnEmail: 'hr@example.com',
    contactName: 'Antony',
    documents: [
      { position: 1, title: 'Employee Details Form', classification: 'OPAL_FORM' },
      { position: 2, title: 'Fair Work Information Statement', classification: 'OFFICIAL_DOCUMENT' },
    ],
  });

  test('addresses the person and names the role', () => {
    const text = readme();
    expect(text).toContain('Jane Smith');
    expect(text).toContain('Occupational Therapist');
  });

  test('separates what to COMPLETE from what to READ', () => {
    const text = readme();
    expect(text).toContain('WHAT TO COMPLETE');
    expect(text).toContain('Employee Details Form');
    expect(text).toContain('WHAT TO READ AND KEEP');
    expect(text).toContain('Fair Work Information Statement');
    // The form is listed under "complete", not under "read".
    expect(text.indexOf('Employee Details Form'))
      .toBeLessThan(text.indexOf('WHAT TO READ AND KEEP'));
  });

  test('tells them how to send the forms back', () => {
    expect(readme()).toContain('hr@example.com');
    expect(readme()).toMatch(/HOW TO RETURN/i);
  });

  test('tells them NOT to email their tax file number', () => {
    // The whole pack goes through email, so this is the one instruction the
    // read-me genuinely has to carry.
    expect(readme()).toMatch(/do NOT email your tax file number/i);
  });

  test('formats dates for an Australian reader, not ISO', () => {
    const text = readme();
    expect(text).toContain('1 September 2026');
    expect(text).not.toContain('2026-09-01');
  });

  test('omits a section it has nothing for, rather than leaving a heading', () => {
    const text = pack.buildReadme({
      employeeName: 'Sam', orgName: 'Opal Therapy',
      documents: [{ position: 1, title: 'Handbook', classification: 'OPAL_POLICY' }],
    });
    expect(text).not.toContain('WHAT TO COMPLETE');
    expect(text).toContain('WHAT TO READ AND KEEP');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE ZIP
// ═════════════════════════════════════════════════════════════════════════════

describe('buildZip', () => {
  /**
   * A stub `q` standing in for the pool. buildZip reads document versions
   * through onboarding-db, so the test supplies them directly — which is the
   * point of keeping the ZIP builder free of its own queries.
   */
  function stubVersions(map) {
    const odb = require('../onboarding-db');
    jest.spyOn(odb, 'getDocumentVersion').mockImplementation(async (id) => map[id] || null);
  }

  afterEach(() => jest.restoreAllMocks());

  const META = {
    employeeName: 'Jane Smith',
    orgName: 'Opal Therapy',
    roleTitle: 'Occupational Therapist',
    returnEmail: 'hr@example.com',
  };

  const DOCS = [
    {
      position: 1, documentId: 'v1', documentCode: 'FORM', documentVersionId: 'v1',
      title: 'Employee Details Form', documentVersion: 2, classification: 'OPAL_FORM',
    },
    {
      position: 2, documentId: 'v2', documentCode: 'FWIS', documentVersionId: 'v2',
      title: 'Fair Work Information Statement', documentVersion: 5,
      classification: 'OFFICIAL_DOCUMENT', sourceVersionLabel: 'Last updated: July 2026',
    },
  ];

  const VERSIONS = {
    v1: {
      id: 'v1', file_name: 'form.pdf', file_mime: 'application/pdf',
      storage_backend: 'db', file_data: Buffer.from('%PDF-1.4 form').toString('base64'),
    },
    v2: {
      id: 'v2', file_name: 'fwis.pdf', file_mime: 'application/pdf',
      storage_backend: 'db', file_data: Buffer.from('%PDF-1.4 fwis').toString('base64'),
    },
  };

  test('produces a readable archive with a read-me and every document', async () => {
    stubVersions(VERSIONS);
    const out = await pack.buildZip(DOCS, META);

    const zip = await JSZip.loadAsync(out.buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      '00 - Read Me First.txt',
      '01 - Employee Details Form.pdf',
      '02 - Fair Work Information Statement.pdf',
    ]);
    expect(out.manifest).toHaveLength(2);
    expect(out.omissions).toHaveLength(0);
  });

  test('names the file after the person, never after an internal id', async () => {
    stubVersions(VERSIONS);
    const out = await pack.buildZip(DOCS, META);
    expect(out.fileName).toBe('Opal Therapy - Jane Smith - Starter Pack.zip');
    expect(out.fileName).not.toMatch(/PKG_|[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  test('the manifest records the exact version and hash of every document', async () => {
    stubVersions(VERSIONS);
    const out = await pack.buildZip(DOCS, META);
    const entry = out.manifest.find((m) => m.documentCode === 'FWIS');
    expect(entry.documentVersion).toBe(5);
    expect(entry.sourceVersionLabel).toBe('Last updated: July 2026');
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  test('is DETERMINISTIC — the same inputs give byte-identical output', async () => {
    // Without this the sha256 records when the ZIP was built rather than what
    // is in it, and "this is the same pack we sent" becomes unprovable.
    stubVersions(VERSIONS);
    const a = await pack.buildZip(DOCS, META);
    const b = await pack.buildZip(DOCS, META);
    expect(a.buffer.equals(b.buffer)).toBe(true);
  });

  test('an unreadable document becomes a reported omission, never a silent gap', async () => {
    stubVersions({ v1: VERSIONS.v1 }); // v2 resolves to null
    const out = await pack.buildZip(DOCS, META);

    expect(out.manifest).toHaveLength(1);
    expect(out.omissions).toHaveLength(1);
    expect(out.omissions[0].code).toBe('FWIS');
    expect(out.omissions[0].reason).toMatch(/no longer available/i);
  });

  test('a document with no file behind it is an omission, not an empty entry', async () => {
    stubVersions({ v1: VERSIONS.v1, v2: { id: 'v2', storage_backend: 'db' } });
    const out = await pack.buildZip(DOCS, META);
    expect(out.manifest).toHaveLength(1);
    expect(out.omissions[0].reason).toMatch(/no file behind it/i);
  });

  test('positions renumber around an omission — no gap in the read-me', async () => {
    stubVersions({ v2: VERSIONS.v2 });
    const out = await pack.buildZip(DOCS, META);
    expect(out.manifest[0].position).toBe(1);
    expect(out.manifest[0].fileName).toBe('01 - Fair Work Information Statement.pdf');
  });

  test('an Opal-authored policy with body text but no file ships as text', async () => {
    stubVersions({ v1: { id: 'v1', storage_backend: 'db', body: 'Our privacy policy says…' } });
    const out = await pack.buildZip([DOCS[0]], META);
    expect(out.manifest[0].fileName).toBe('01 - Employee Details Form.txt');
    expect(out.manifest[0].mime).toBe('text/plain');
  });

  test('two documents with the same title do not overwrite one another', async () => {
    stubVersions({ v1: VERSIONS.v1, v2: VERSIONS.v2 });
    const out = await pack.buildZip([
      { ...DOCS[0], title: 'Policy' },
      { ...DOCS[1], title: 'Policy' },
    ], META);
    const names = out.manifest.map((m) => m.fileName);
    expect(new Set(names).size).toBe(2);
  });

  test('the read-me is present even when every document was omitted', async () => {
    stubVersions({});
    const out = await pack.buildZip(DOCS, META);
    const zip = await JSZip.loadAsync(out.buffer);
    expect(Object.keys(zip.files)).toEqual(['00 - Read Me First.txt']);
    expect(out.manifest).toHaveLength(0);
    expect(out.omissions).toHaveLength(2);
  });

  test('a malicious document title cannot escape the archive', async () => {
    stubVersions({ v1: VERSIONS.v1 });
    const out = await pack.buildZip(
      [{ ...DOCS[0], title: '../../../etc/cron.d/evil' }], META
    );
    const zip = await JSZip.loadAsync(out.buffer);
    for (const name of Object.keys(zip.files)) {
      expect(name).not.toContain('..');
      expect(name).not.toMatch(/^\//);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
//  THE EMAIL
// ═════════════════════════════════════════════════════════════════════════════

describe('the starter-pack email', () => {
  const ASSIGNMENT = {
    applicant_name: 'Jane Smith',
    job_title: 'Occupational Therapist',
    start_date: '2026-09-01',
  };
  const compose = (extra) => pack.composeStarterPackEmail({
    assignment: ASSIGNMENT,
    orgName: 'Opal Therapy',
    packFileName: 'Opal Therapy - Jane Smith - Starter Pack.zip',
    downloadUrl: null,
    senderName: 'Antony',
    dueDate: '2026-08-28',
    ...extra,
  });

  test('an unedited send carries EXACTLY the wording the template serves', () => {
    // Start Onboarding shows defaultStarterPackMessage for the Owner to edit;
    // if they leave it alone, the send must contain those same words — one
    // source, no drift.
    const shown = pack.defaultStarterPackMessage({
      applicantName: 'Jane Smith', orgName: 'Opal Therapy',
      roleTitle: 'Occupational Therapist',
    });
    const sent = compose({});
    expect(sent.text.startsWith(shown)).toBe(true);
  });

  test('the default wording greets by first name and keeps the TFN caution', () => {
    const msg = pack.defaultStarterPackMessage({
      applicantName: 'Jane Smith', orgName: 'Opal Therapy', roleTitle: null,
    });
    expect(msg).toMatch(/^Hi Jane,/);
    expect(msg).toMatch(/do not email your tax file number/i);
  });

  test('the default subject names the practice and the person', () => {
    expect(compose({}).subject).toBe('Your Opal Therapy starter pack — Jane Smith');
    expect(pack.defaultStarterPackSubject('Opal Therapy', ''))
      .toBe('Your Opal Therapy starter pack');
  });

  test('an edited message and subject are used in place of the defaults', () => {
    const out = compose({
      customSubject: 'Welcome aboard, Jane',
      customMessage: 'Hi Jane,\n\nThank you for joining Opal Therapy.',
    });
    expect(out.subject).toBe('Welcome aboard, Jane');
    expect(out.text).toContain('Thank you for joining Opal Therapy.');
    expect(out.html).toContain('Thank you for joining Opal Therapy.');
    expect(out.text).not.toMatch(/delighted/);
  });

  test('a blank edit falls back to the default rather than sending nothing', () => {
    const out = compose({ customSubject: '   ', customMessage: '  \n ' });
    expect(out.subject).toBe('Your Opal Therapy starter pack — Jane Smith');
    expect(out.text).toMatch(/delighted you are joining/);
  });

  test('an edited message cannot smuggle markup into the email', () => {
    const out = compose({ customMessage: 'Hello <script>alert(1)</script> & <b>bold</b>' });
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).toContain('&lt;b&gt;');
  });

  test('the delivery machinery survives an edit — dates and the secure link', () => {
    // The message is prose; the facts box and the oversize-pack download link
    // are delivery machinery the Owner must not be able to edit away.
    const out = compose({
      customMessage: 'Short note.',
      downloadUrl: 'https://portal.example/api/onboarding/starter-pack/download?token=abc',
    });
    expect(out.html).toContain('Your start date:');
    expect(out.html).toContain('Please return your forms by:');
    expect(out.html).toContain('starter-pack/download?token=abc');
    expect(out.text).toContain('Your starter pack is here: https://portal.example');
  });

  test('with no link, the attachment is named in the plain-text fallback', () => {
    const out = compose({ customMessage: 'Short note.' });
    expect(out.text).toContain('Opal Therapy - Jane Smith - Starter Pack.zip');
  });
});
