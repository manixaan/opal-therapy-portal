'use strict';

/**
 * THE GENERATED POLICY DRAFTS — what must stay true about them.
 *
 * 29 plain-text files that end up in front of a workforce. The risks worth a
 * test are not typos; they are the four ways this set can quietly rot:
 *
 *   drift        a policy file whose title, category or acknowledgement flag no
 *                longer matches the library slot it fills, so the portal shows
 *                one thing and the document says another.
 *   raw tokens   a {{OPAL_ORG_…}} tag reaching an employee unresolved, or a tag
 *                that no longer exists in organisation settings.
 *   lost markup  markdown pasted into a body that renders as literal asterisks
 *                in `.ob-doc` and as literal asterisks in the starter-pack .txt.
 *   silent
 *   publication  a future edit to versionPayload that lets this path publish
 *                something. Every other guard here is about content; this one
 *                is about the boundary that makes generating the content safe.
 */

const catalogue = require('../onboarding-catalogue');
const policies = require('../onboarding-policies');

const ALL = policies.loadAll();
const BY_CODE = new Map(ALL.map((p) => [p.code, p]));
const CATALOGUE_BY_CODE = new Map(catalogue.OPAL_POLICIES.map((p) => [p.code, p]));

/**
 * The tier each policy sits in, from docs/ONBOARDING_DOCUMENT_CHECKLIST.md.
 * Duplicated here on purpose: re-tiering a document is a decision, and a
 * decision that can be made by editing one header line without anything
 * noticing is not a decision anybody made.
 */
const EXPECTED_TIERS = {
  DOC_HANDBOOK: 1, DOC_WELCOME: 1, POL_CODE_OF_CONDUCT: 1, POL_COLLECTION_NOTICE: 1,
  POL_COMPLAINTS: 1, POL_INCIDENT: 1, POL_LEAVE: 1, POL_PRIVACY: 1,
  POL_SAFEGUARDING: 1, POL_WHS: 1,
  POL_BOUNDARIES: 2, POL_BULLYING: 2, POL_CLINICAL_DOC: 2, POL_CONFLICT: 2,
  POL_EEO: 2, POL_INFECTION: 2, POL_INFOSEC: 2, POL_INJURY_MANAGEMENT: 2,
  POL_PARTICIPANT_RIGHTS: 2, POL_RECORDS: 2, POL_SOCIAL_MEDIA: 2, POL_SUPERVISION: 2,
  POL_EMERGENCY: 3, POL_EXPENSES: 3, POL_GIFTS: 3, POL_HOME_VISIT: 3,
  POL_LONE_WORKER: 3, POL_TELEHEALTH: 3, POL_VEHICLE: 3,
};

// ═════════════════════════════════════════════════════════════════════════════

describe('the set of policy files', () => {
  it('covers every Opal-authored slot in the catalogue, and invents none', () => {
    expect([...BY_CODE.keys()].sort()).toEqual([...CATALOGUE_BY_CODE.keys()].sort());
  });

  it('is the 29 documents the checklist says Opal must write', () => {
    expect(ALL).toHaveLength(29);
    const tiers = ALL.reduce((acc, p) => ({ ...acc, [p.tier]: (acc[p.tier] || 0) + 1 }), {});
    expect(tiers).toEqual({ 1: 10, 2: 12, 3: 7 });
  });

  it('keeps each document in the tier the checklist assigned it', () => {
    for (const p of ALL) expect([p.code, p.tier]).toEqual([p.code, EXPECTED_TIERS[p.code]]);
  });
});

describe('each file against the library slot it fills', () => {
  it('uses the catalogue title verbatim', () => {
    for (const p of ALL) {
      expect([p.code, p.title]).toEqual([p.code, CATALOGUE_BY_CODE.get(p.code).title]);
    }
  });

  it('uses the catalogue category', () => {
    for (const p of ALL) {
      expect([p.code, p.category]).toEqual([p.code, CATALOGUE_BY_CODE.get(p.code).category]);
    }
  });

  it('agrees with the catalogue about which documents must be acknowledged', () => {
    for (const p of ALL) {
      expect([p.code, p.acknowledgement]).toEqual([p.code, CATALOGUE_BY_CODE.get(p.code).ack === true]);
    }
  });

  it('fits the columns the version row provides', () => {
    for (const p of ALL) {
      expect(p.title.length).toBeLessThanOrEqual(250);   // onboarding_document_versions.title
      expect(p.summary.length).toBeLessThanOrEqual(2000); // .summary — str() truncates silently
    }
  });
});

describe('the body, as an employee will actually see it', () => {
  // `.ob-doc` renders the body escaped inside white-space: pre-wrap, and the
  // starter pack ships it as text/plain. Markdown does not render in either.
  it('carries no markdown that would reach the reader as punctuation', () => {
    for (const p of ALL) {
      expect([p.code, /\*\*|__|^#{1,6}\s|\[[^\]]*\]\(/m.test(p.body)]).toEqual([p.code, false]);
    }
  });

  it('has no tabs, no carriage returns and no trailing whitespace', () => {
    for (const p of ALL) {
      expect([p.code, /\t|\r| +$/m.test(p.body)]).toEqual([p.code, false]);
    }
  });

  it('is a working draft rather than an outline', () => {
    for (const p of ALL) {
      const words = p.body.split(/\s+/).length;
      expect([p.code, words > 500]).toEqual([p.code, true]);
    }
  });

  it('ends with a document control block, so nothing can be published undated', () => {
    for (const p of ALL) {
      expect([p.code, p.body.includes('DOCUMENT CONTROL')]).toEqual([p.code, true]);
      expect([p.code, /Approved by: \[TO CONFIRM/.test(p.body)]).toEqual([p.code, true]);
    }
  });

  it('states a review cycle in both the header and the body', () => {
    for (const p of ALL) {
      expect(p.reviewCycleMonths).toBeGreaterThan(0);
      expect([p.code, /Review cycle:/.test(p.body)]).toEqual([p.code, true]);
    }
  });

  it('still says out loud that it is an unreviewed draft', () => {
    for (const p of ALL) {
      expect([p.code, /Version: 0\.1 — generated draft, pending Owner review/.test(p.body)])
        .toEqual([p.code, true]);
    }
  });
});

describe('placeholders', () => {
  it('only references organisation tags that exist in settings', () => {
    const known = Object.keys(policies.ORG_TAGS);
    for (const p of ALL) {
      for (const tag of p.tokens) expect([p.code, tag, known.includes(tag)]).toEqual([p.code, tag, true]);
    }
  });

  it('closes every [TO CONFIRM: …] marker it opens', () => {
    for (const p of ALL) {
      const opens = (p.body.match(/\[TO CONFIRM/g) || []).length;
      expect([p.code, p.confirmations.length]).toEqual([p.code, opens]);
    }
  });

  it('says what each [TO CONFIRM] wants, rather than leaving a bare marker', () => {
    for (const p of ALL) {
      for (const c of p.confirmations) {
        expect([p.code, c, c.length > 'TO CONFIRM: x'.length + 2]).toEqual([p.code, c, true]);
      }
    }
  });

  it('resolves a tag when the organisation has the value', () => {
    const { body, unresolved } = policies.applyOrganisation(
      'Issued by {{OPAL_ORG_LEGAL_NAME}}.', { OPAL_ORG_LEGAL_NAME: 'Opal Therapy Pty Ltd' }
    );
    expect(body).toBe('Issued by Opal Therapy Pty Ltd.');
    expect(unresolved).toEqual([]);
  });

  it('turns an unresolved tag into a visible request, never a raw token', () => {
    const { body, unresolved } = policies.applyOrganisation('ABN {{OPAL_ORG_ABN}}.', {});
    expect(body).toBe('ABN [TO CONFIRM: ABN].');
    expect(unresolved).toEqual(['OPAL_ORG_ABN']);
  });

  it('treats an empty setting as unresolved rather than substituting a blank', () => {
    const { body } = policies.applyOrganisation('Phone {{OPAL_ORG_PHONE}}.', { OPAL_ORG_PHONE: '   ' });
    expect(body).toBe('Phone [TO CONFIRM: business phone number].');
  });

  it('leaves no organisation token behind in any rendered policy', () => {
    for (const p of ALL) {
      const { body } = policies.applyOrganisation(p.body, {});
      expect([p.code, /\{\{OPAL_ORG_[A-Z_]+\}\}/.test(body)]).toEqual([p.code, false]);
    }
  });
});

describe('cross-references', () => {
  it('points only at documents that exist in the library', () => {
    const known = new Set([
      ...CATALOGUE_BY_CODE.keys(),
      ...catalogue.OFFICIAL_DOCUMENTS.map((d) => d.code),
    ]);
    for (const p of ALL) {
      for (const code of p.related) expect([p.code, code, known.has(code)]).toEqual([p.code, code, true]);
    }
  });

  it('never lists a document as related to itself', () => {
    for (const p of ALL) expect([p.code, p.related.includes(p.code)]).toEqual([p.code, false]);
  });
});

describe('the version payload — the boundary that keeps this safe', () => {
  const p = BY_CODE.get('POL_WHS');

  it('carries only the four fields a draft needs', () => {
    const { payload } = policies.versionPayload(p);
    expect(Object.keys(payload).sort()).toEqual(['body', 'changeNote', 'summary', 'title']);
  });

  it('cannot express a published status, a file or a source url', () => {
    const { payload } = policies.versionPayload(p);
    for (const forbidden of ['status', 'publishedAt', 'publishedBy', 'fileData', 'sourceUrl']) {
      expect(payload[forbidden]).toBeUndefined();
    }
  });

  it('records where the text came from and that nobody has reviewed it', () => {
    const { payload } = policies.versionPayload(p);
    expect(payload.changeNote).toContain('POL_WHS.txt');
    expect(payload.changeNote).toContain('Not reviewed, not in force');
  });

  it('reports how much of the draft is still placeholder', () => {
    const { confirmations } = policies.versionPayload(p, { orgValues: {} });
    expect(confirmations).toBeGreaterThan(0);
  });
});

describe('the parser', () => {
  const header = ['---', 'code: X', 'title: T', 'category: C', 'tier: 1',
    'acknowledgement: yes', 'summary: S', 'reviewCycleMonths: 24', '---', 'Body.'].join('\n');

  it('accepts a well-formed file', () => {
    expect(policies.parse(header, 'x.txt').code).toBe('X');
  });

  it('rejects a file with no header', () => {
    expect(() => policies.parse('Just a body.', 'x.txt')).toThrow(/delimited header/);
  });

  it('rejects a missing required key', () => {
    expect(() => policies.parse(header.replace('summary: S\n', ''), 'x.txt')).toThrow(/missing "summary"/);
  });

  it('rejects a duplicate key rather than silently taking the last one', () => {
    expect(() => policies.parse(header.replace('tier: 1', 'tier: 1\ntier: 3'), 'x.txt'))
      .toThrow(/duplicate header key/);
  });

  it('rejects an acknowledgement value that is not yes or no', () => {
    expect(() => policies.parse(header.replace('acknowledgement: yes', 'acknowledgement: true'), 'x.txt'))
      .toThrow(/must be yes or no/);
  });

  it('rejects an empty body', () => {
    expect(() => policies.parse(header.replace('\nBody.', '\n'), 'x.txt')).toThrow(/body is empty/);
  });

  it('normalises CRLF so a file edited on Windows parses identically', () => {
    expect(policies.parse(header.replace(/\n/g, '\r\n'), 'x.txt').body).toBe('Body.');
  });
});
