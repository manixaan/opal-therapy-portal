'use strict';

/**
 * INTERACTIVE INDUCTION — registry validity, engine pure helpers, and the
 * anchor-drift gate.
 *
 * Three jobs:
 *   1. The module registry (frontend/current/induction-modules.js) is
 *      require()d by the BACKEND for validation — malformed data would break
 *      the API, so its invariants are enforced here.
 *   2. The engine's pure geometry/formatting helpers (induction.js exports
 *      them Node-side, same shape as opa.js/navigation.js).
 *   3. DRIFT DETECTION: every live-highlight step targets a real element.
 *      If a developer renames or removes a data-help anchor / id that a
 *      tutorial points at, THIS file fails CI and names the step — the
 *      tutorial gets updated instead of silently degrading for every user.
 */

const fs = require('fs');
const path = require('path');

const registry = require('../../frontend/current/induction-modules.js');
const engine = require('../../frontend/current/induction.js');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const SHELL_SOURCES = [
  'mockup_v3.html', 'resourcehub.js', 'scheduler.js', 'opa.js',
  'supportpop.js', 'navigation.js', 'induction.js', 'casenotes.js',
].map((f) => fs.readFileSync(path.join(FRONTEND, f), 'utf8')).join('\n');

const KNOWN_ROLES = ['owner', 'admin', 'therapist', 'read_only'];
const STEP_TYPES = ['intro', 'highlight', 'action', 'screenshot', 'callout', 'warning', 'quiz', 'complete'];

// ── 1. Registry invariants ──────────────────────────────────────────────────

describe('induction module registry', () => {
  test('exports a non-empty module list with unique keys', () => {
    expect(Array.isArray(registry.MODULES)).toBe(true);
    expect(registry.MODULES.length).toBeGreaterThanOrEqual(10);
    const keys = registry.MODULES.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every module carries sane metadata', () => {
    for (const m of registry.MODULES) {
      expect(m.key).toMatch(/^[a-z0-9-]+$/);
      expect(Number.isInteger(m.version) && m.version >= 1).toBe(true);
      expect(typeof m.title).toBe('string');
      expect(m.title.length).toBeGreaterThan(3);
      expect(Number.isInteger(m.minutes) && m.minutes >= 1 && m.minutes <= 30).toBe(true);
      expect(Array.isArray(m.roles) && m.roles.length >= 1).toBe(true);
      m.roles.forEach((r) => expect(KNOWN_ROLES).toContain(r));
      expect(typeof m.description).toBe('string');
      expect(typeof m.thumb).toBe('string');
      expect(m.thumb).toMatch(/^\/assets\/tutorials\//);
      expect(m.start && typeof m.start.tab).toBe('string');
    }
  });

  test('the ten portal tutorial slugs all have a module', () => {
    const expected = [
      'portal-getting-started', 'portal-profile-documents', 'portal-connecting-outlook',
      'portal-using-calendar', 'portal-master-scheduler', 'portal-booking-appointment',
      'portal-travel-logbook', 'portal-resource-hub', 'portal-notifications',
      'portal-inviting-therapists',
    ];
    for (const slug of expected) expect(registry.moduleByKey(slug)).toBeTruthy();
  });

  test('every module has authored steps (no placeholder cards ship)', () => {
    for (const m of registry.MODULES) {
      expect(m.steps.length).toBeGreaterThanOrEqual(5);
    }
  });

  test('every step is schema-valid', () => {
    for (const m of registry.MODULES) {
      m.steps.forEach((s, i) => {
        const where = `${m.key}[${i}]`;
        expect(STEP_TYPES).toContain(s.type);
        expect(typeof s.title === 'string' && s.title.length > 0).toBe(true);
        if (s.type === 'quiz') {
          expect(s.quiz && typeof s.quiz.question).toBe('string');
          expect(Array.isArray(s.quiz.options) && s.quiz.options.length >= 2).toBe(true);
          expect(
            Number.isInteger(s.quiz.correctIndex) &&
            s.quiz.correctIndex >= 0 && s.quiz.correctIndex < s.quiz.options.length
          ).toBe(true);
        } else {
          expect(typeof s.body === 'string' && s.body.length > 0).toBe(true);
        }
        if (s.type === 'highlight' || s.type === 'action') {
          expect(typeof s.target === 'string' && s.target.length > 0).toBe(true);
        }
        if (s.type === 'screenshot') {
          expect(s.image && typeof s.image.src === 'string').toBe(true);
          expect(typeof s.image.alt).toBe('string');
        }
        if (s.roles) s.roles.forEach((r) => {
          expect(m.roles).toContain(r); // a step cannot widen the module gate
        });
        if (s.next) {
          expect(registry.moduleByKey(s.next)).toBeTruthy();
        }
        void where;
      });
    }
  });

  test('every module ends with exactly one complete step', () => {
    for (const m of registry.MODULES) {
      const completes = m.steps.filter((s) => s.type === 'complete');
      expect(completes).toHaveLength(1);
      expect(m.steps[m.steps.length - 1].type).toBe('complete');
    }
  });

  test('every role sees a non-trivial induction, ending in completion', () => {
    for (const role of KNOWN_ROLES) {
      const mods = registry.modulesForRole(role);
      expect(mods.length).toBeGreaterThanOrEqual(4);
      for (const m of mods) {
        const steps = registry.stepsForRole(m, role);
        expect(steps.length).toBeGreaterThanOrEqual(4);
        expect(steps[steps.length - 1].type).toBe('complete');
      }
    }
  });

  test('role gating: owner-only and admin-gated modules', () => {
    expect(registry.moduleByKey('portal-inviting-therapists').roles).toEqual(['owner']);
    const sched = registry.moduleByKey('portal-master-scheduler').roles;
    expect(sched.sort()).toEqual(['admin', 'owner']);
    const therapistKeys = registry.modulesForRole('therapist').map((m) => m.key);
    expect(therapistKeys).not.toContain('portal-inviting-therapists');
    expect(therapistKeys).not.toContain('portal-master-scheduler');
  });

  test('moduleState versioning: old completions read as updated, not lost', () => {
    const m = { version: 3 };
    expect(registry.moduleState(m, null)).toBe('not_started');
    expect(registry.moduleState(m, { status: 'in_progress', version: 3 })).toBe('in_progress');
    expect(registry.moduleState(m, { status: 'completed', completed_version: 3 })).toBe('completed');
    expect(registry.moduleState(m, { status: 'completed', completed_version: 2 })).toBe('updated');
  });
});

// ── 2. Anchor drift gate ────────────────────────────────────────────────────

describe('anchor drift detection', () => {
  const failures = [];
  for (const m of registry.MODULES) {
    m.steps.forEach((s, i) => {
      if (!s.target || (s.type !== 'highlight' && s.type !== 'action')) return;
      const t = s.target;
      let found;
      if (t.startsWith('#')) {
        // Static markup and string-built markup both contain the literal
        // id="…" text; JS-assigned ids appear as id = '…'.
        const id = t.slice(1);
        found = SHELL_SOURCES.includes(`id="${id}"`) ||
          SHELL_SOURCES.includes(`id='${id}'`) ||
          SHELL_SOURCES.includes(`id = '${id}'`) ||
          SHELL_SOURCES.includes(`getElementById('${id}')`);
      } else if (t.startsWith('.') || t.includes('[')) {
        // CSS selector: require its class/attribute text to appear in a source
        const cls = t.match(/\.([a-z0-9-]+)/i);
        const attr = t.match(/\[data-([a-z-]+)=["']?([a-z0-9-]+)/i);
        found = (cls && SHELL_SOURCES.includes(cls[1])) || (attr && SHELL_SOURCES.includes(attr[2]));
      } else {
        // Bare token = data-help name (the designed anchor system)
        found = SHELL_SOURCES.includes(`data-help="${t}"`) || SHELL_SOURCES.includes(`data-help=\\"${t}\\"`) ||
          SHELL_SOURCES.includes(`data-help='${t}'`);
      }
      if (!found) failures.push(`${m.key} step ${i + 1} ("${s.title}") targets "${t}" — not found in any shell source`);
    });
  }

  test('every live step target resolves to a real anchor in the frontend', () => {
    expect(failures).toEqual([]);
  });
});

// ── 3. The Splose induction group ───────────────────────────────────────────

describe('the Splose induction group', () => {
  const SPLOSE_KEYS = [
    'splose-at-opal', 'splose-account-setup', 'splose-booking',
    'splose-appointments', 'splose-progress-notes', 'splose-teams-outlook',
    'splose-performance', 'splose-daily-workflow',
  ];
  const splose = registry.MODULES.filter((m) => m.group === 'splose');

  test('the eight Splose lessons exist, in curriculum order', () => {
    expect(splose.map((m) => m.key)).toEqual(SPLOSE_KEYS);
  });

  test('portal modules carry no group — the default group stays portal', () => {
    registry.MODULES.filter((m) => m.key.startsWith('portal-'))
      .forEach((m) => expect(m.group).toBeUndefined());
  });

  test('Splose steps never target a live anchor — it is an external system', () => {
    // A highlight or action step would point the spotlight at an Opal Portal
    // element while teaching Splose; screenshots are the honest medium here.
    for (const m of splose) {
      m.steps.forEach((s) => {
        expect(s.type).not.toBe('highlight');
        expect(s.type).not.toBe('action');
        expect(s.target).toBeUndefined();
      });
    }
  });

  test('every Splose image and thumbnail exists on disk', () => {
    // The failure this prevents: an image path that drifts from the file on
    // disk ships a silently broken picture — no build step catches it.
    const missing = [];
    for (const m of splose) {
      const paths = [m.thumb].concat(
        m.steps.filter((s) => s.image && s.image.src).map((s) => s.image.src));
      for (const p of paths) {
        if (!fs.existsSync(path.join(FRONTEND, p.replace(/^\//, '')))) {
          missing.push(`${m.key}: ${p}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('every Splose lesson checks knowledge and explains its answers', () => {
    for (const m of splose) {
      const quizzes = m.steps.filter((s) => s.type === 'quiz');
      expect(quizzes.length).toBeGreaterThanOrEqual(3);
      quizzes.forEach((s) => {
        expect(typeof s.quiz.explain).toBe('string');
        expect(s.quiz.explain.length).toBeGreaterThan(10);
      });
    }
  });

  test('unfinalised Opal policy is flagged, never invented', () => {
    // The content contract with the source curriculum: where an Opal rule is
    // not final, the lesson says so and points at administration. The six
    // modules whose source spec carries VERIFY items each show the marker.
    const flagged = splose.filter((m) =>
      m.steps.some((s) => s.type === 'callout' && /still being finalised/i.test(s.title)));
    expect(flagged.length).toBeGreaterThanOrEqual(6);
  });

  test('manager-only performance content is gated to owner and admin', () => {
    const perf = registry.moduleByKey('splose-performance');
    const managerSteps = perf.steps.filter((s) => s.roles);
    expect(managerSteps.length).toBeGreaterThanOrEqual(1);
    managerSteps.forEach((s) => expect([...s.roles].sort()).toEqual(['admin', 'owner']));
    // A therapist's run of the lesson never shows the manager overview.
    const therapistSteps = registry.stepsForRole(perf, 'therapist');
    expect(therapistSteps.some((s) => s.image && /performance-overview/.test(s.image.src))).toBe(false);
  });

  test('the lessons chain: each complete step suggests the next', () => {
    for (let i = 0; i < splose.length - 1; i++) {
      const complete = splose[i].steps[splose[i].steps.length - 1];
      expect(`${splose[i].key} -> ${complete.next}`).toBe(`${splose[i].key} -> ${splose[i + 1].key}`);
    }
  });

  test('a step screenshot links to its full size, and a broken image disarms the link', () => {
    // Dense Splose captures need the full-size view; the same onerror that
    // reveals the text fallback must also take the dead link out of the tab
    // order, or keyboard users land on an invisible anchor to a 404.
    const src = fs.readFileSync(path.join(FRONTEND, 'induction.js'), 'utf8');
    expect(src).toContain('class="ind-fig-link"');
    expect(src).toMatch(/onerror="[^"]*ind-fig-broken[^"]*removeAttribute\(\\'href\\'\)[^"]*tabIndex=-1/);
  });
});

// ── 4. Engine pure helpers ──────────────────────────────────────────────────

describe('indFormat', () => {
  test('escapes HTML before formatting', () => {
    expect(engine.indFormat('<img src=x onerror=alert(1)>'))
      .toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
  });
  test('bold and paragraphs only', () => {
    expect(engine.indFormat('One **two**\n\nThree'))
      .toBe('<p>One <strong>two</strong></p><p>Three</p>');
  });
  test('single newlines become line breaks', () => {
    expect(engine.indFormat('a\nb')).toBe('<p>a<br>b</p>');
  });
  test('empty input renders nothing', () => {
    expect(engine.indFormat('')).toBe('');
    expect(engine.indFormat(null)).toBe('');
  });
});

describe('indPlaceCard', () => {
  const VP = { w: 1280, h: 800 };
  const CARD = { w: 400, h: 240 };
  test('prefers below the target', () => {
    const p = engine.indPlaceCard({ top: 100, left: 100, right: 220, bottom: 140 }, CARD.w, CARD.h, VP.w, VP.h);
    expect(p.placement).toBe('below');
    expect(p.top).toBeGreaterThanOrEqual(140);
  });
  test('flips above when below does not fit', () => {
    const p = engine.indPlaceCard({ top: 700, left: 100, right: 220, bottom: 780 }, CARD.w, CARD.h, VP.w, VP.h);
    expect(p.placement).toBe('above');
    expect(p.top + CARD.h).toBeLessThanOrEqual(700);
  });
  test('never leaves the viewport, even for edge targets', () => {
    const rects = [
      { top: 0, left: 0, right: 40, bottom: 30 },
      { top: 0, left: 1240, right: 1280, bottom: 30 },
      { top: 770, left: 0, right: 40, bottom: 800 },
      { top: 770, left: 1240, right: 1280, bottom: 800 },
      { top: 380, left: 600, right: 700, bottom: 420 },
    ];
    for (const r of rects) {
      const p = engine.indPlaceCard(r, CARD.w, CARD.h, VP.w, VP.h);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.left + CARD.w).toBeLessThanOrEqual(VP.w);
      expect(p.top + CARD.h).toBeLessThanOrEqual(VP.h);
    }
  });
  test('tiny viewport centres rather than overflowing negative', () => {
    const p = engine.indPlaceCard({ top: 10, left: 10, right: 300, bottom: 300 }, 400, 240, 320, 480);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.top).toBeGreaterThanOrEqual(0);
  });
});

describe('indShadeRects', () => {
  test('no hole → one full-viewport shade', () => {
    const r = engine.indShadeRects(null, 1000, 600);
    expect(r).toHaveLength(1);
    expect(r[0]).toEqual({ top: 0, left: 0, width: 1000, height: 600 });
  });
  test('a hole tiles into four rects that never cover it', () => {
    const hole = { top: 100, left: 200, width: 120, height: 40 };
    const r = engine.indShadeRects(hole, 1000, 600);
    expect(r).toHaveLength(4);
    // No shade rect intersects the hole interior
    for (const s of r) {
      const overlapX = Math.max(0, Math.min(s.left + s.width, hole.left + hole.width) - Math.max(s.left, hole.left));
      const overlapY = Math.max(0, Math.min(s.top + s.height, hole.top + hole.height) - Math.max(s.top, hole.top));
      expect(overlapX * overlapY).toBe(0);
    }
    // The four rects + hole cover the viewport exactly
    const area = r.reduce((a, s) => a + s.width * s.height, 0) + hole.width * hole.height;
    expect(area).toBe(1000 * 600);
  });
  test('a hole clipped by the viewport edge still tiles safely', () => {
    const r = engine.indShadeRects({ top: -10, left: -10, width: 50, height: 50 }, 1000, 600);
    for (const s of r) {
      expect(s.width).toBeGreaterThanOrEqual(0);
      expect(s.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('indSummary', () => {
  const mods = [
    { key: 'a', roles: ['therapist'] },
    { key: 'b', roles: ['therapist'] },
    { key: 'c', roles: ['owner'] },
  ];
  const state = (m, row) => registry.moduleState({ version: 1, ...m }, row);
  test('counts only the role\'s modules', () => {
    const s = engine.indSummary(mods, 'therapist', {}, state);
    expect(s.total).toBe(2);
    expect(s.done).toBe(0);
    expect(s.nextKey).toBe('a');
  });
  test('an in-progress module wins the continue slot over a fresh one', () => {
    const s = engine.indSummary(mods, 'therapist', {
      b: { status: 'in_progress', version: 1 },
    }, state);
    expect(s.nextKey).toBe('b');
  });
  test('completed modules count and percent rounds', () => {
    const s = engine.indSummary(mods, 'therapist', {
      a: { status: 'completed', completed_version: 1 },
    }, state);
    expect(s.done).toBe(1);
    expect(s.percent).toBe(50);
  });
});
