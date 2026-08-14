'use strict';

/**
 * WHODAS 2.0 — TEMPLATE INTEGRITY, FIELD MAPS AND COMPLETED-PDF TESTS
 *
 * The claim these tests defend is "this is the official WHO instrument, and a
 * completed assessment is a copy of it with the responses marked on". That is
 * only true if the template bytes never change, the overlay coordinates were
 * measured on the document they are used with, and generation never writes to
 * the source. Each of those is asserted here rather than assumed.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PDFDocument } = require('pdf-lib');

const registry = require('../whodas/template-registry');
const instrument = require('../whodas/instrument');
const { generateCompletedPdf, assertTemplateUnchanged } = require('../whodas/completed-pdf');

const TEMPLATES_DIR = path.join(__dirname, '..', 'whodas', 'templates');

const allItems = (v) => Object.fromEntries(instrument.ITEM_IDS.map((id) => [id, v]));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ── Manifest and provenance ──────────────────────────────────────────────────

describe('WHODAS template manifest', () => {
  const manifest = registry.manifest();

  test('records the WHO publication it was extracted from', () => {
    expect(manifest.source.sha256)
      .toBe('a78fcb2503c726c84be7e74361aa225d0e2a34de7ecd4cbecac4e4d1ec22da6d');
    expect(manifest.source.title).toMatch(/WHO Disability Assessment Schedule/i);
    expect(manifest.source.copyright).toMatch(/World Health Organization/i);
    expect(manifest.source.pageCount).toBe(152);
  });

  test('states that page content was copied, not re-rendered', () => {
    expect(manifest.extraction.method).toMatch(/copyPages/);
    expect(manifest.extraction.modifications).toBe('none to page content');
  });

  test('registers one instrument template per administration method', () => {
    const methods = registry.instrumentTemplates().map((t) => t.method).sort();
    expect(methods).toEqual(['interviewer', 'proxy', 'self']);
  });

  test('page counts match the ranges recorded in the source audit', () => {
    const byKey = Object.fromEntries(registry.allTemplates().map((t) => [t.key, t]));
    expect(byKey['whodas-36-interviewer'].pageCount).toBe(10);
    expect(byKey['whodas-36-self'].pageCount).toBe(4);
    expect(byKey['whodas-36-proxy'].pageCount).toBe(5);
    expect(byKey['whodas-36-flashcards'].pageCount).toBe(2);
  });
});

// ── Integrity ────────────────────────────────────────────────────────────────

describe('WHODAS template integrity', () => {
  test('every template on disk matches its recorded hash', () => {
    const result = registry.verifyTemplates();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('readTemplateBytes returns bytes whose hash matches the manifest', () => {
    for (const tpl of registry.allTemplates()) {
      expect(sha(registry.readTemplateBytes(tpl.key))).toBe(tpl.sha256);
    }
  });

  test('readTemplateBytes refuses a template whose bytes have changed', () => {
    const tpl = registry.templateByKey('whodas-36-self');
    const file = path.join(TEMPLATES_DIR, tpl.filename);
    const original = fs.readFileSync(file);
    try {
      // A single appended byte is enough — the point is that ANY change is refused.
      fs.writeFileSync(file, Buffer.concat([original, Buffer.from('\n')]));
      expect(() => registry.readTemplateBytes('whodas-36-self')).toThrow(/integrity check/i);
      expect(registry.verifyTemplates().ok).toBe(false);
    } finally {
      fs.writeFileSync(file, original);
    }
    expect(registry.verifyTemplates().ok).toBe(true);
  });

  test('an unknown template key is refused rather than guessed at', () => {
    expect(() => registry.readTemplateBytes('whodas-36-nope')).toThrow(/Unknown WHODAS template/);
  });
});

// ── Field maps ───────────────────────────────────────────────────────────────

describe('WHODAS field maps', () => {
  test('every field map is pinned to the hash of the document it was derived from', () => {
    const result = registry.verifyFieldMaps();
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('each method maps all 36 scored items to five printed options', () => {
    for (const tpl of registry.instrumentTemplates()) {
      const map = registry.fieldMap(tpl.key);
      const scored = map.fields.filter((f) => f.scored);
      expect(scored).toHaveLength(36);
      expect(scored.map((f) => f.field).sort()).toEqual([...instrument.ITEM_IDS].sort());

      for (const f of scored) {
        expect(f.options.map((o) => o.value))
          .toEqual(['none', 'mild', 'moderate', 'severe', 'extreme']);
      }
    }
  });

  test('field names are unique within a map', () => {
    for (const tpl of registry.instrumentTemplates()) {
      const names = registry.fieldMap(tpl.key).fields.map((f) => f.field);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test('every control sits inside the page it belongs to', () => {
    for (const tpl of registry.instrumentTemplates()) {
      const map = registry.fieldMap(tpl.key);
      const [, , mw, mh] = map.mediaBox;

      for (const f of map.fields) {
        expect(f.page).toBeGreaterThanOrEqual(1);
        expect(f.page).toBeLessThanOrEqual(map.pageCount);

        const boxes = f.options ? f.options.map((o) => o.hit) : [f.writeIn];
        for (const b of boxes) {
          expect(b.x).toBeGreaterThanOrEqual(0);
          expect(b.y).toBeGreaterThanOrEqual(0);
          expect(b.x + b.w).toBeLessThanOrEqual(mw);
          expect(b.y + b.h).toBeLessThanOrEqual(mh);
        }
      }
    }
  });

  test('controls fall inside the CropBox, which is the area a viewer shows', () => {
    for (const tpl of registry.instrumentTemplates()) {
      const map = registry.fieldMap(tpl.key);
      const [cx, cy, cw, ch] = map.cropBox;

      for (const f of map.fields.filter((x) => x.scored)) {
        for (const o of f.options) {
          expect(o.mark.cx).toBeGreaterThan(cx);
          expect(o.mark.cx).toBeLessThan(cx + cw);
          expect(o.mark.cy).toBeGreaterThan(cy);
          expect(o.mark.cy).toBeLessThan(cy + ch);
        }
      }
    }
  });

  test('the five option targets of an item never overlap', () => {
    for (const tpl of registry.instrumentTemplates()) {
      for (const f of registry.fieldMap(tpl.key).fields.filter((x) => x.scored)) {
        const sorted = [...f.options].sort((a, b) => a.hit.x - b.hit.x);
        for (let i = 1; i < sorted.length; i += 1) {
          const prev = sorted[i - 1].hit;
          expect(`${f.field}:${sorted[i].hit.x >= prev.x + prev.w - 0.01}`).toBe(`${f.field}:true`);
        }
      }
    }
  });

  test('the interviewer form carries its face sheet and conditional follow-ups', () => {
    const map = registry.fieldMap('whodas-36-interviewer');
    const coded = Object.fromEntries(
      map.fields.filter((f) => f.type === 'coded-radio').map((f) => [f.field, f.options.length])
    );
    // Counts read off the printed form during the source audit.
    expect(coded).toEqual({ F5: 3, A1: 2, A4: 6, A5: 9, 'D5.9': 2, 'D5.10': 2 });

    const text = map.fields.filter((f) => f.type === 'text').map((f) => f.field);
    expect(text).toEqual(expect.arrayContaining(['D5.01', 'D5.02', 'H1', 'H2', 'H3', 'A2', 'A3']));
  });

  test('the proxy form carries H4 with its eight printed relationship codes', () => {
    const h4 = registry.fieldMap('whodas-36-proxy').fields.find((f) => f.field === 'H4');
    expect(h4.type).toBe('coded-radio');
    expect(h4.options.map((o) => o.code)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(instrument.PROXY_RELATIONSHIP_OPTIONS).toHaveLength(8);
  });

  test('the self-administered form has no face sheet, only the H1-H3 day counts', () => {
    const map = registry.fieldMap('whodas-36-self');
    expect(map.fields.filter((f) => f.type === 'coded-radio')).toHaveLength(0);
    expect(map.fields.filter((f) => f.type === 'text').map((f) => f.field)).toEqual(['H1', 'H2', 'H3']);
  });
});

// ── Derived item wording ─────────────────────────────────────────────────────

describe('WHODAS item wording', () => {
  const data = registry.instrumentData();

  test('every method supplies wording for all 36 items', () => {
    for (const method of ['interviewer', 'self', 'proxy']) {
      const items = data.methods[method].items;
      for (const id of instrument.ITEM_IDS) {
        expect(`${method}:${id}:${Boolean(items[id] && items[id].text)}`).toBe(`${method}:${id}:true`);
      }
    }
  });

  test('proxy wording is in the third person, as printed', () => {
    const proxy = data.methods.proxy.items;
    expect(proxy['D3.1'].text).toBe('Washing his or her whole body?');
    expect(proxy['D2.3'].text).toBe('Moving around inside their home?');
  });

  test('self-administered wording is in the second person, as printed', () => {
    const self = data.methods.self.items;
    expect(self['D3.1'].text).toBe('Washing your whole body?');
    expect(self['D1.1'].text).toBe('Concentrating on doing something for ten minutes?');
  });

  test('wording is taken per form, not shared — D6.1 genuinely differs', () => {
    // The interviewer form prints "did you have joining"; self prints
    // "did you have in joining". Deriving from each PDF preserves that.
    expect(data.methods.interviewer['D6.1'] || data.methods.interviewer.items['D6.1'].text)
      .not.toBe(data.methods.self.items['D6.1'].text);
  });
});

// ── Completed PDF ────────────────────────────────────────────────────────────

describe('WHODAS completed PDF generation', () => {
  const mixed = Object.fromEntries(
    instrument.ITEM_IDS.map((id, i) => [id, ['none', 'mild', 'moderate', 'severe', 'extreme'][i % 5]])
  );

  test.each([
    ['whodas-36-self', 4],
    ['whodas-36-proxy', 5],
    ['whodas-36-interviewer', 10],
  ])('%s produces a readable PDF with the source page count', async (key, pages) => {
    const out = await generateCompletedPdf({ templateKey: key, responses: mixed });
    expect(out.warnings).toEqual([]);
    expect(out.pageCount).toBe(pages);

    const loaded = await PDFDocument.load(out.bytes);
    expect(loaded.getPageCount()).toBe(pages);
  });

  test.each(['whodas-36-self', 'whodas-36-proxy', 'whodas-36-interviewer'])(
    '%s keeps the exact page dimensions of the source', async (key) => {
      const source = await PDFDocument.load(registry.readTemplateBytes(key));
      const out = await generateCompletedPdf({ templateKey: key, responses: mixed });
      const completed = await PDFDocument.load(out.bytes);

      const geometry = (d) => d.getPages().map((p) => {
        const m = p.getMediaBox();
        const c = p.getCropBox();
        const r = (n) => Math.round(n * 100) / 100;
        return [r(m.width), r(m.height), r(c.x), r(c.y), r(c.width), r(c.height)].join(',');
      });
      expect(geometry(completed)).toEqual(geometry(source));
    }
  );

  test('one mark is drawn per answered item', async () => {
    const out = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    expect(out.marksDrawn).toBe(36);
  });

  test('the generated document differs from the blank source', async () => {
    const out = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    const blank = registry.readTemplateBytes('whodas-36-self');
    expect(sha(out.bytes)).not.toBe(sha(blank));
    expect(out.bytes.length).toBeGreaterThan(0);
  });

  test('the canonical template is byte-identical after generation', async () => {
    const before = sha(registry.readTemplateBytes('whodas-36-self'));
    await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    expect(sha(registry.readTemplateBytes('whodas-36-self'))).toBe(before);
    expect(assertTemplateUnchanged('whodas-36-self')).toBe(true);
  });

  test('an empty assessment draws nothing at all', async () => {
    const out = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: {} });
    expect(out.marksDrawn).toBe(0);
    expect(out.warnings).toEqual([]);
  });

  test('skipped work items are left blank, exactly as on paper', async () => {
    const out = await generateCompletedPdf({
      templateKey: 'whodas-36-self',
      responses: mixed,
      notApplicableItems: instrument.WORK_SCHOOL_ITEMS,
    });
    expect(out.marksDrawn).toBe(32);
    expect(out.warnings).toEqual([]);
  });

  test('write-in values and coded options are rendered', async () => {
    const bare = await generateCompletedPdf({ templateKey: 'whodas-36-proxy', responses: {} });
    const filled = await generateCompletedPdf({
      templateKey: 'whodas-36-proxy',
      responses: {},
      formData: { H4: 3, 'H4#1': 'daughter', H1: '14', H2: '2', H3: '6' },
    });
    expect(bare.marksDrawn).toBe(0);
    expect(filled.marksDrawn).toBe(5);
    expect(filled.warnings).toEqual([]);
  });

  test('an unrecognised response is reported, never silently dropped', async () => {
    const out = await generateCompletedPdf({
      templateKey: 'whodas-36-self',
      responses: { 'D1.1': 'catastrophic' },
    });
    expect(out.marksDrawn).toBe(0);
    expect(out.warnings).toEqual([expect.stringMatching(/D1\.1: no printed option/)]);
  });

  test('generation is deterministic for the same input', async () => {
    const a = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    const b = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    expect(sha(a.bytes)).toBe(sha(b.bytes));
  });

  test('a stale field map is refused rather than used to place marks', async () => {
    const original = registry.fieldMap('whodas-36-self');
    const spy = jest.spyOn(registry, 'fieldMap').mockReturnValue({
      ...original,
      templateSha256: '0'.repeat(64),
    });
    try {
      await expect(generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed }))
        .rejects.toThrow(/derived from a different document/);
    } finally {
      spy.mockRestore();
    }
  });

  test('no Opal branding or metadata is written onto the WHO document', async () => {
    const out = await generateCompletedPdf({ templateKey: 'whodas-36-self', responses: mixed });
    const loaded = await PDFDocument.load(out.bytes);
    expect(loaded.getTitle()).toBeUndefined();
    expect(loaded.getAuthor()).toBeUndefined();
    expect(loaded.getSubject()).toBeUndefined();
    expect(out.bytes.toString('latin1')).not.toMatch(/Opal Therapy/i);
  });
});
