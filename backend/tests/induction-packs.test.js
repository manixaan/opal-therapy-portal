'use strict';

/**
 * Induction packs — every shipped pack is checked here, so a pack that would
 * import broken (a dead walkthrough link, a missing picture, text the editor
 * would have silently cut) fails review rather than reaching the Owner.
 *
 * Plus the loader's own refusals: wrong format, a slug that disagrees with
 * its file name, malformed walkthroughs.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const packs = require('../induction-packs');
const lc = require('../learning-content');
const registry = require('../../frontend/current/induction-modules.js');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const files = fs.readdirSync(packs.DIR).filter((f) => f.endsWith('.json')).sort();
const raw = (f) => JSON.parse(fs.readFileSync(path.join(packs.DIR, f), 'utf8'));

test('there is at least one pack, and every pack loads', () => {
  expect(files.length).toBeGreaterThan(0);
  const { packs: loaded, invalid } = packs.loadPacks();
  expect(invalid).toEqual([]);
  expect(loaded).toHaveLength(files.length);
});

describe.each(files)('%s', (file) => {
  const pack = raw(file);
  const v = packs.validatePack(pack, file.replace(/\.json$/, ''));

  test('validates as a pack', () => {
    expect(v.error).toBeUndefined();
    expect(v.ok).toBe(true);
  });

  test('nothing the learner reads is trimmed by the portal limits', () => {
    const items = pack.workflow.sections.flatMap((s) => s.items);
    expect(pack.workflow.title.length).toBeLessThanOrEqual(lc.LIMITS.title);
    expect((pack.workflow.description || '').length).toBeLessThanOrEqual(1000);
    pack.workflow.sections.forEach((s) => expect(s.title.length).toBeLessThanOrEqual(lc.LIMITS.sectionTitle));
    items.forEach((it) => {
      expect(it.title.length).toBeLessThanOrEqual(lc.LIMITS.itemTitle);
      expect((it.body || '').length).toBeLessThanOrEqual(lc.LIMITS.body);
      if (it.ack_statement) expect(it.ack_statement.length).toBeLessThanOrEqual(lc.LIMITS.ackStatement);
    });
    // Step-level trimming would show as a normalised step differing from
    // its source; compare titles and bodies one-for-one.
    (pack.walkthroughs || []).forEach((w, wi) => {
      const out = v.pack.walkthroughs[wi];
      expect(out.title).toBe(w.title);
      w.steps.forEach((s, si) => {
        expect(out.steps[si].title).toBe(s.title);
        if (s.body && s.type !== 'quiz' && s.type !== 'checkpoint') expect(out.steps[si].body).toBe(s.body);
        if (s.quiz) {
          expect(out.steps[si].quiz.question).toBe(s.quiz.question);
          expect(out.steps[si].quiz.explain).toBe(s.quiz.explain);
        }
      });
    });
  });

  test('every walkthrough a task launches exists, and every pack walkthrough is launched', () => {
    const own = new Set((pack.walkthroughs || []).map((w) => w.key));
    const builtIn = new Set(registry.MODULES.map((m) => m.key));
    const launched = pack.workflow.sections.flatMap((s) => s.items)
      .filter((it) => it.type === 'task' && it.walkthrough_key)
      .map((it) => it.walkthrough_key);
    launched.forEach((k) => expect(own.has(k) || builtIn.has(k)).toBe(true));
    own.forEach((k) => expect(launched).toContain(k));
  });

  test('a pack walkthrough never reuses a built-in key (it would be skipped on import)', () => {
    const builtIn = new Set(registry.MODULES.map((m) => m.key));
    (pack.walkthroughs || []).forEach((w) => expect(builtIn.has(w.key)).toBe(false));
  });

  test('every picture it shows ships with the frontend', () => {
    const srcs = [];
    (pack.walkthroughs || []).forEach((w) => {
      if (w.thumb) srcs.push(w.thumb);
      w.steps.forEach((s) => { if (s.image) srcs.push(s.image.src); });
    });
    srcs.forEach((src) => {
      expect(src).toMatch(/^\/assets\//);
      expect(fs.existsSync(path.join(FRONTEND, src))).toBe(true);
    });
  });

  test('every walkthrough ends on a complete step', () => {
    (v.pack.walkthroughs || []).forEach((w) => {
      expect(w.steps[w.steps.length - 1].type).toBe('complete');
    });
  });
});

describe('validatePack refusals', () => {
  const good = () => JSON.parse(JSON.stringify(raw(files[0])));
  const slug = files[0].replace(/\.json$/, '');

  test('wrong format', () => {
    const p = good(); p.format = 'something-else/9';
    expect(packs.validatePack(p, slug).ok).toBe(false);
  });

  test('slug that disagrees with the file name', () => {
    expect(packs.validatePack(good(), 'another-name').error).toMatch(/does not match/);
  });

  test('a workflow with no items', () => {
    const p = good(); p.workflow.sections = [];
    expect(packs.validatePack(p, slug).ok).toBe(false);
  });

  test('a walkthrough without a key, or with a duplicate key', () => {
    const p = good();
    p.walkthroughs = [{ title: 'No key here', roles: ['owner'], steps: [{ type: 'intro', title: 'Hi', body: 'x' }] }];
    expect(packs.validatePack(p, slug).ok).toBe(false);
    const w = { key: 'dup-key', title: 'Twice over', roles: ['owner'], steps: [{ type: 'intro', title: 'Hi', body: 'x' }] };
    p.walkthroughs = [w, w];
    expect(packs.validatePack(p, slug).error).toMatch(/twice/);
  });

  test('a walkthrough step the workshop would refuse', () => {
    const p = good();
    p.walkthroughs = [{ key: 'bad-step', title: 'Bad step', roles: ['owner'], steps: [{ type: 'explode', title: 'Boom' }] }];
    expect(packs.validatePack(p, slug).error).toMatch(/unknown type/);
  });

  test('a malformed file is reported, not thrown, and the rest still load', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'packs-'));
    try {
      fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json');
      fs.writeFileSync(path.join(dir, slug + '.json'), JSON.stringify(good()));
      const out = packs.loadPacks(dir);
      expect(out.packs).toHaveLength(1);
      expect(out.invalid).toEqual([{ file: 'broken.json', error: 'not valid JSON' }]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
