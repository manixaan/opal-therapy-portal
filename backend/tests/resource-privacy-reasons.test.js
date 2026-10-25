'use strict';

/**
 * The refusal checklist (resource-privacy-reasons.js) and the page locator
 * behind it (resource-file-quality.js locateFindings).
 *
 * The case that prompted it, 25 Oct 2026: a de-identified 46-page FCA example
 * was refused with one generic sentence. The real cause was a participant
 * number left in the running header on every page; the rest were report dates
 * and the practice's own email. These tests pin that a refusal now says which,
 * where, and how to fix — and still never echoes the matched text.
 */

const { buildChecklist } = require('../resource-privacy-reasons');
const quality = require('../resource-file-quality');

const NDIS = '430782072';
const EMAIL = 'someone@example.com.au';

describe('locateFindings', () => {
  it('reports the 1-based pages each kind appears on', () => {
    const pages = quality.locateFindings([
      `REPORT | NDIS ${NDIS} Participant Name: XX XX Plan Dates 22/06/2026`,
      `REPORT | NDIS ${NDIS} plain body text`,
      `REPORT | NDIS ${NDIS} Contact ${EMAIL} Date 18/09/2026`,
    ]);
    expect(pages['ndis-participant-number']).toEqual([1, 2, 3]);
    expect(pages['date-of-birth']).toEqual([1, 3]);
    expect(pages.email).toEqual([3]);
    // "XX XX" is a blanked name, not a filled one.
    expect(pages['populated-client-name-field']).toBeUndefined();
  });

  it('copes with no pages', () => {
    expect(quality.locateFindings([])).toEqual({});
    expect(quality.locateFindings(undefined)).toEqual({});
  });
});

describe('buildChecklist', () => {
  // Shaped like the real example's report.
  const report = {
    pageCount: 46,
    identifierFindings: [
      { kind: 'email', count: 3 },
      { kind: 'ndis-participant-number', count: 43 },
      { kind: 'date-of-birth', count: 12 },
    ],
    privacy: { strong: [{ kind: 'ndis-participant-number', count: 43 }], weak: [], verdict: 'client-confidential' },
    findingPages: {
      'ndis-participant-number': Array.from({ length: 43 }, (_, i) => i + 4),
      'date-of-birth': [4, 9, 41],
      email: [4, 41],
    },
  };

  it('gives one item per kind, client identifiers first, with pages and counts', () => {
    const list = buildChecklist(report);
    expect(list.map((i) => i.id)).toEqual(['ndis-number', 'date', 'email']);
    const [ndis, date, email] = list;
    // Seen by both scanners — counted once, not summed to 86.
    expect(ndis).toMatchObject({ type: 'personal', count: 43, repeatsOnEveryPage: true });
    expect(ndis.pages[0]).toBe(4);
    expect(ndis.pages).toHaveLength(43);
    expect(ndis.fix).toMatch(/header and footer/);
    expect(date).toMatchObject({ type: 'pattern', count: 12, pages: [4, 9, 41], repeatsOnEveryPage: false });
    expect(email).toMatchObject({ type: 'pattern', count: 3, pages: [4, 41] });
  });

  it('a labelled finding outranks a bare pattern of the same thing', () => {
    const list = buildChecklist({
      identifierFindings: [{ kind: 'australian-phone', count: 2 }],
      privacy: { strong: [], weak: [{ kind: 'populated-phone-field', count: 1 }] },
    });
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'phone', type: 'personal', count: 2, pages: [] });
  });

  it('merges the two Medicare kinds and still lists a kind it has no words for', () => {
    const list = buildChecklist({
      identifierFindings: [{ kind: 'medicare-number', count: 1 }, { kind: 'brand-new-kind', count: 2 }],
      privacy: { strong: [{ kind: 'medicare-shaped-number', count: 1 }], weak: [] },
    });
    expect(list.map((i) => i.id)).toEqual(['medicare-number', 'other:brand-new-kind']);
  });

  it('is empty for a report with nothing found, or no report', () => {
    expect(buildChecklist({ identifierFindings: [], privacy: { strong: [], weak: [] } })).toEqual([]);
    expect(buildChecklist(undefined)).toEqual([]);
  });

  it('never carries the matched text', async () => {
    const builder = require('../opal-document-builder');
    const pdf = await builder.buildPdf({
      title: 'Example report',
      sections: [{ heading: 'Participant', paragraphs: [`NDIS ${NDIS}. Contact ${EMAIL} on 18/09/2026.`] }],
    });
    const verdict = await quality.assessFile(pdf, { declaredFormat: 'pdf', declaredName: 'r.pdf' });
    const list = buildChecklist(verdict.report);
    expect(list.map((i) => i.id)).toEqual(expect.arrayContaining(['ndis-number', 'date', 'email']));
    expect(list.find((i) => i.id === 'ndis-number').pages.length).toBeGreaterThan(0);
    const wire = JSON.stringify(list);
    for (const secret of [NDIS, EMAIL, '18/09/2026']) expect(wire).not.toContain(secret);
  });
});
