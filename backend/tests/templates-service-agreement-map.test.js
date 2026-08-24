'use strict';

/**
 * SERVICE AGREEMENT MAP — asserted against the REAL shipped master.
 *
 * templates/service-agreement-map.js is a hand-written description of
 * service-agreement-v1.0.1.docx. A description can drift from the thing it
 * describes, and a drifted map means a field that silently never populates.
 * Every number and every tag below is read out of the .docx at test time, so
 * the map cannot claim a control the master does not have, and cannot miss one
 * the master does.
 */

const fs = require('fs');
const JSZip = require('jszip');
const crypto = require('crypto');

const sam = require('../templates/service-agreement-map');
const catalogue = require('../templates/catalogue');

jest.setTimeout(30000);

let master;          // tag -> occurrence count, across control parts
let masterParts;

beforeAll(async () => {
  const zip = await JSZip.loadAsync(fs.readFileSync(sam.TEMPLATE_FILE));
  masterParts = Object.keys(zip.files).filter((n) => !n.endsWith('/'));
  master = new Map();
  for (const part of sam.CONTROL_PARTS) {
    const f = zip.file(part);
    if (!f) continue;
    const xml = await f.async('string');
    for (const m of xml.matchAll(/<w:tag w:val="([^"]*)"/g)) {
      master.set(m[1], (master.get(m[1]) || 0) + 1);
    }
  }
});

describe('the shipped master', () => {
  test('is present and is the version the map names', () => {
    expect(fs.existsSync(sam.TEMPLATE_FILE)).toBe(true);
    expect(sam.TEMPLATE_FILENAME).toBe('service-agreement-v1.0.1.docx');
    expect(sam.TEMPLATE_VERSION).toBe('v1.0.1');
  });

  test('is committed, not a local-only file', () => {
    // .gitignore carries "*.docx"; the three masters are force-added, exactly
    // as fca-v1.docx and progress-note-letter-v1.docx are. Without this the
    // feature runs on one laptop and nowhere else.
    const sha = crypto.createHash('sha256').update(fs.readFileSync(sam.TEMPLATE_FILE)).digest('hex');
    expect(sha).toBe('afb1e1e8ae5dafde60e3cf04220f00ec557cc3cc87ce21ff11d27c6b8a334d14');
  });

  test('carries controls in the header and footer, not only the body', () => {
    // A body-only implementation would ship a blank header and footer.
    expect(masterParts).toContain('word/header6.xml');
    expect(masterParts).toContain('word/footer6.xml');
  });
});

describe('every mapped tag exists in the master', () => {
  test('scalars', () => {
    const missing = sam.SCALAR_TAG_LIST.filter((t) => !master.has(t));
    expect(missing).toEqual([]);
  });

  test('clause and schedule blocks', () => {
    const missing = sam.CLAUSE_TAGS.filter((t) => !master.has(t));
    expect(missing).toEqual([]);
  });

  test('internal blocks', () => {
    const missing = sam.INTERNAL_TAGS.filter((t) => !master.has(t));
    expect(missing).toEqual([]);
  });

  test('anchors', () => {
    const missing = sam.ANCHOR_TAGS.filter((t) => !master.has(t));
    expect(missing).toEqual([]);
  });

  test('declared occurrence counts match the master', () => {
    const wrong = sam.SCALAR_TAGS
      .filter((s) => master.get(s.tag) !== s.occurrences)
      .map((s) => `${s.tag}: map ${s.occurrences}, master ${master.get(s.tag)}`);
    expect(wrong).toEqual([]);
  });
});

describe('every master control is accounted for', () => {
  test('nothing in the master is unmapped and unexplained', () => {
    const known = new Set([
      ...sam.SCALAR_TAG_LIST, ...sam.CLAUSE_TAGS, ...sam.INTERNAL_TAGS, ...sam.ANCHOR_TAGS,
    ]);
    const unaccounted = [...master.keys()].filter((t) => !known.has(t));
    expect(unaccounted).toEqual([]);
  });
});

describe('layers are declared honestly', () => {
  test('no tag claims a source Opal cannot actually read', () => {
    // loadOrganisationSettings reads exactly five keys; a tag claiming
    // layer:'organisation' for anything else would resolve to nothing while
    // telling the user it came from the portal.
    const ORG_FIELDS = new Set([
      'organisationName', 'businessAddress', 'businessPhone', 'businessEmail', 'website',
    ]);
    const bad = sam.SCALAR_TAGS
      .filter((s) => s.layer === 'organisation' && !ORG_FIELDS.has(s.field))
      .map((s) => s.tag);
    expect(bad).toEqual([]);
  });

  test('ABN, NDIS registration and payment terms are user-entered — Opal stores none of them', () => {
    for (const tag of [
      'OPAL_ORG_ABN', 'OPAL_ORG_NDIS_REGISTRATION_NUMBER',
      'OPAL_PAYMENT_TERMS_DAYS', 'OPAL_ORG_PRIVACY_CONTACT', 'OPAL_ORG_COMPLAINTS_CONTACT',
    ]) {
      expect(`${tag}:${sam.SCALAR_BY_TAG.get(tag).layer}`).toBe(`${tag}:report`);
    }
  });

  test('participant identity binds to Splose, never to a cached profile copy', () => {
    for (const tag of [
      'OPAL_PARTICIPANT_FULL_NAME', 'OPAL_PARTICIPANT_NDIS_NUMBER',
      'OPAL_PARTICIPANT_EMAIL', 'OPAL_PARTICIPANT_PHONE', 'OPAL_PARTICIPANT_ADDRESS',
    ]) {
      expect(`${tag}:${sam.SCALAR_BY_TAG.get(tag).layer}`).toBe(`${tag}:splose`);
    }
  });

  test('the internal governance blocks are NOT offered as fields', () => {
    for (const tag of sam.INTERNAL_TAGS) {
      expect(`${tag}:${sam.SCALAR_BY_TAG.has(tag)}`).toBe(`${tag}:false`);
    }
  });
});

describe('the catalogue exposes exactly the three required templates', () => {
  test('three, in the required order, with the required names', () => {
    expect(catalogue.listTemplates().map((t) => t.id))
      .toEqual(['service_agreement', 'progress_note', 'fca']);
    expect(catalogue.listTemplates().map((t) => t.name)).toEqual([
      'Service Agreement',
      'Progress Note',
      'Functional Capacity Assessment (FCA)',
    ]);
  });

  test('each points at a master that exists', () => {
    for (const t of catalogue.TEMPLATES) {
      expect(`${t.id}:${fs.existsSync(t.file)}`).toBe(`${t.id}:true`);
    }
  });

  test('each reuses an existing Opal master rather than inventing wording', () => {
    expect(catalogue.getTemplate('fca').file).toMatch(/fca\/templates\/fca-v1\.docx$/);
    expect(catalogue.getTemplate('progress_note').file)
      .toMatch(/fca\/templates\/progress-note-letter-v1\.docx$/);
    expect(catalogue.getTemplate('service_agreement').file)
      .toMatch(/service-agreements\/templates\/service-agreement-v1\.0\.1\.docx$/);
  });

  test('every field is grouped, and no group is empty', () => {
    for (const t of catalogue.TEMPLATES) {
      const spec = catalogue.fieldSpec(t);
      const total = spec.reduce((n, g) => n + g.fields.length, 0);
      expect(`${t.id}:${total}`).toBe(`${t.id}:${t.scalars.length}`);
      for (const g of spec) expect(g.fields.length).toBeGreaterThan(0);
    }
  });

  test('no field spec leaks a binding identifier as a user-facing label', () => {
    for (const t of catalogue.TEMPLATES) {
      for (const g of catalogue.fieldSpec(t)) {
        for (const f of g.fields) {
          expect(`${f.tag}:${/OPAL_|PORTAL —|E-SIGN/.test(f.label)}`).toBe(`${f.tag}:false`);
        }
      }
    }
  });
});
