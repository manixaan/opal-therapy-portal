'use strict';

/**
 * WALKTHROUGH CONTENT — validation and normalisation of the Owner-authorable
 * interactive induction catalogue (migration 045).
 *
 * The invariants that matter are the two the code review used to provide,
 * and no longer can once anyone with the Owner role may author a step:
 *
 *   • body text reaches a pop-up as text, never as markup;
 *   • no step makes a learner CLICK a destructive or externally visible
 *     control.
 *
 * Everything else here pins the shape tutorial-routes validates completions
 * against — a malformed catalogue is a broken induction for every user.
 */

const content = require('../walkthrough-content');
const registry = require('../../frontend/current/induction-modules.js');

const ROLES = ['owner', 'admin', 'therapist', 'read_only'];

const step = (over) => Object.assign({ type: 'callout', title: 'T', body: 'B' }, over);

// ── Text is never markup ────────────────────────────────────────────────────

describe('authored text never carries markup', () => {
  test('tags are stripped from body and title before storage', () => {
    const r = content.normaliseSteps(
      [step({ title: 'Hi <b>there</b>', body: '<img src=x onerror=alert(1)> ok' })], ROLES);
    expect(r.ok).toBe(true);
    expect(r.steps[0].title).toBe('Hi there');
    expect(r.steps[0].body).toBe('ok');
    expect(r.steps[0].body).not.toMatch(/[<>]/);
  });

  test('quiz questions, options and explanations are stripped too', () => {
    const r = content.normaliseSteps([{
      type: 'quiz', title: 'Q',
      quiz: {
        question: '<b>Which</b>?', options: ['<i>a</i>', 'b'], correctIndex: 0,
        explain: '<script>x</script>because',
      },
    }], ROLES);
    expect(r.ok).toBe(true);
    expect(r.steps[0].quiz.question).toBe('Which?');
    expect(r.steps[0].quiz.options).toEqual(['a', 'b']);
    expect(r.steps[0].quiz.explain).toBe('xbecause');
  });

  test('an image src must be a site-relative path, never a remote URL', () => {
    const remote = content.normaliseSteps(
      [{ type: 'screenshot', title: 'S', body: 'b', image: { src: 'https://evil.test/a.png', alt: 'a' } }],
      ROLES);
    expect(remote.ok).toBe(false);
    const protocolRelative = content.normaliseSteps(
      [{ type: 'screenshot', title: 'S', body: 'b', image: { src: '//evil.test/a.png', alt: 'a' } }],
      ROLES);
    expect(protocolRelative.ok).toBe(false);
    const local = content.normaliseSteps(
      [{ type: 'screenshot', title: 'S', body: 'b', image: { src: '/assets/tutorials/a.png', alt: 'a' } }],
      ROLES);
    expect(local.ok).toBe(true);
  });
});

// ── The destructive-click guard ─────────────────────────────────────────────

describe('no step may click through a destructive action', () => {
  const clickStep = (target) => ({ type: 'action', title: 'Do it', body: 'b', target, advance: 'click' });

  test.each([
    'settings-outlook-disconnect',
    'notif-mark-all',
    '#delete-note-btn',
    '.send-invoice',
    '#invite-send',
    'stg-user-deactivate',
  ])('refuses advance:click on "%s"', (target) => {
    const r = content.normaliseSteps([clickStep(target)], ROLES);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/destructive or externally visible/);
  });

  test('the same control may still be EXPLAINED with a spotlight', () => {
    const r = content.normaliseSteps(
      [{ type: 'highlight', title: 'This one', body: 'Never press this in training.',
         target: 'settings-outlook-disconnect' }], ROLES);
    expect(r.ok).toBe(true);
    expect(r.steps[0].advance).toBeUndefined();
  });

  test('a harmless control may still be clicked through', () => {
    const r = content.normaliseSteps([clickStep('cal-view-week')], ROLES);
    expect(r.ok).toBe(true);
    expect(r.steps[0].advance).toBe('click');
  });

  test('an opener is not a send: the invite FORM may be opened', () => {
    // The shipped Inviting Therapists walkthrough does exactly this, and
    // opening the form sends nothing. The button that sends is refused above.
    const r = content.normaliseSteps([clickStep('settings-invite-user')], ROLES);
    expect(r.ok).toBe(true);
  });
});

// ── Role gating ─────────────────────────────────────────────────────────────

describe('per-step roles narrow, never widen', () => {
  test('a step cannot admit a role the walkthrough does not', () => {
    const r = content.normaliseSteps([step({ roles: ['owner'] })], ['therapist']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/does not admit/);
  });

  test('a step may narrow within the walkthrough audience', () => {
    const r = content.normaliseSteps([step({ roles: ['owner'] })], ['owner', 'therapist']);
    expect(r.ok).toBe(true);
    expect(r.steps[0].roles).toEqual(['owner']);
  });

  test('unknown roles are dropped, and a step left with none is refused', () => {
    const r = content.normaliseSteps([step({ roles: ['superuser'] })], ROLES);
    expect(r.ok).toBe(false);
  });

  test('stepsForRole hides narrowed steps and keeps ungated ones', () => {
    const steps = [step({ title: 'all' }), step({ title: 'owners', roles: ['owner'] })];
    expect(content.stepsForRole(steps, 'therapist').map((s) => s.title)).toEqual(['all']);
    expect(content.stepsForRole(steps, 'owner').map((s) => s.title)).toEqual(['all', 'owners']);
  });
});

// ── Shape ───────────────────────────────────────────────────────────────────

describe('step shape', () => {
  test('an unknown type is refused', () => {
    expect(content.normaliseSteps([step({ type: 'iframe' })], ROLES).ok).toBe(false);
  });

  test('a highlight step without a target is refused', () => {
    expect(content.normaliseSteps([{ type: 'highlight', title: 'T', body: 'B' }], ROLES).ok).toBe(false);
  });

  test('a non-quiz step needs body text; a quiz needs a valid quiz', () => {
    expect(content.normaliseSteps([{ type: 'callout', title: 'T' }], ROLES).ok).toBe(false);
    expect(content.normaliseSteps([{ type: 'quiz', title: 'T' }], ROLES).ok).toBe(false);
    expect(content.normaliseSteps([{
      type: 'quiz', title: 'T', quiz: { question: 'q', options: ['a'], correctIndex: 0 },
    }], ROLES).ok).toBe(false);
    expect(content.normaliseSteps([{
      type: 'quiz', title: 'T', quiz: { question: 'q', options: ['a', 'b'], correctIndex: 5 },
    }], ROLES).ok).toBe(false);
  });

  test('unknown fields are dropped rather than stored', () => {
    const r = content.normaliseSteps([step({ onclick: 'alert(1)', pad: 4 })], ROLES);
    expect(r.ok).toBe(true);
    expect(r.steps[0].onclick).toBeUndefined();
    expect(r.steps[0].pad).toBe(4);
  });

  test('the step ceiling is enforced', () => {
    const many = Array.from({ length: content.LIMITS.steps + 1 }, () => step());
    expect(content.normaliseSteps(many, ROLES).ok).toBe(false);
  });
});

describe('module metadata', () => {
  test('a walkthrough admitting no known role is refused', () => {
    expect(content.normaliseModuleMeta({ title: 'Fine', roles: ['nobody'] }).ok).toBe(false);
  });

  test('a missing key is generated rather than left blank', () => {
    const r = content.normaliseModuleMeta({ title: 'Fine', roles: ['owner'] });
    expect(r.ok).toBe(true);
    expect(r.meta.key).toMatch(/^wt-[0-9a-f]{8}$/);
  });

  test('minutes outside the sane band fall back to the default', () => {
    expect(content.normaliseModuleMeta({ title: 'Fine', roles: ['owner'], minutes: 9999 }).meta.minutes).toBe(5);
    expect(content.normaliseModuleMeta({ title: 'Fine', roles: ['owner'], minutes: 8 }).meta.minutes).toBe(8);
  });
});

describe('moduleState', () => {
  test('matches the registry semantics it replaces', () => {
    const m = { version: 3 };
    expect(content.moduleState(m, null)).toBe('not_started');
    expect(content.moduleState(m, { status: 'in_progress', version: 3 })).toBe('in_progress');
    expect(content.moduleState(m, { status: 'completed', completed_version: 3 })).toBe('completed');
    expect(content.moduleState(m, { status: 'completed', completed_version: 2 })).toBe('updated');
  });
});

// ── The shipped built-ins survive their own validator ───────────────────────

describe('the shipped registry seeds cleanly', () => {
  test('every shipped module maps to a valid catalogue row', () => {
    const failures = [];
    for (const m of registry.MODULES) {
      const r = content.fromRegistryModule(m);
      if (!r.ok) failures.push(r.error);
    }
    expect(failures).toEqual([]);
  });

  test('seeding preserves keys, versions, role gates and step counts', () => {
    for (const m of registry.MODULES) {
      const r = content.fromRegistryModule(m);
      expect(r.module.key).toBe(m.key);
      expect(r.module.version).toBe(m.version);
      expect(r.module.roles.sort()).toEqual([...m.roles].sort());
      expect(r.module.steps).toHaveLength(m.steps.length);
    }
  });
});
