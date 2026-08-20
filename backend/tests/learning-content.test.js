'use strict';

/**
 * Learning content helpers — pure-logic unit tests.
 *
 * Focus: content normalisation (shape validation, key generation and
 * uniqueness, type-specific requirements), the counted-items completion
 * rule, progress arithmetic, quiz grading, the employee projection that
 * must strip correct answers, and snapshot equality.
 */

const lc = require('../learning-content');

const quiz = (over) => Object.assign({
  passThreshold: 80,
  questions: [
    { question: 'Q1', options: ['a', 'b'], correctIndex: 1 },
    { question: 'Q2', options: ['x', 'y', 'z'], correctIndex: 0 },
  ],
}, over || {});

function sampleContent() {
  return {
    sections: [
      {
        key: 's-one', title: 'Welcome',
        items: [
          { key: 'i-a', type: 'content', title: 'Read me', body: 'hello', required: true },
          { key: 'i-b', type: 'acknowledgement', title: 'Ack', ack_statement: 'I agree.', required: true },
          { key: 'i-c', type: 'content', title: 'Optional extra', required: false },
        ],
      },
      {
        key: 's-two', title: 'Check',
        items: [
          { key: 'i-d', type: 'quiz', title: 'Quiz', quiz: quiz(), required: true },
        ],
      },
    ],
  };
}

// ── normaliseContent ─────────────────────────────────────────────────────────

test('valid content passes through with keys preserved', () => {
  const r = lc.normaliseContent(sampleContent());
  expect(r.ok).toBe(true);
  expect(r.content.sections).toHaveLength(2);
  expect(r.content.sections[0].items.map((i) => i.key)).toEqual(['i-a', 'i-b', 'i-c']);
});

test('missing keys are generated and never collide', () => {
  const raw = sampleContent();
  delete raw.sections[0].items[0].key;
  raw.sections[0].items[1].key = '';
  const r = lc.normaliseContent(raw);
  expect(r.ok).toBe(true);
  const keys = [];
  r.content.sections.forEach((s) => s.items.forEach((i) => keys.push(i.key)));
  expect(new Set(keys).size).toBe(keys.length);
  keys.forEach((k) => expect(k).toMatch(/^[a-z0-9][a-z0-9-]*$/i));
});

test('duplicate keys are regenerated rather than trusted', () => {
  const raw = sampleContent();
  raw.sections[1].items[0].key = 'i-a'; // collides with section 1
  const r = lc.normaliseContent(raw);
  expect(r.ok).toBe(true);
  const keys = [];
  r.content.sections.forEach((s) => s.items.forEach((i) => keys.push(i.key)));
  expect(new Set(keys).size).toBe(keys.length);
});

test('empty / absent content normalises to an empty sections array', () => {
  expect(lc.normaliseContent(undefined)).toEqual({ ok: true, content: { sections: [] } });
  expect(lc.normaliseContent(null)).toEqual({ ok: true, content: { sections: [] } });
});

test('structural garbage is refused with a reason', () => {
  expect(lc.normaliseContent('nope').ok).toBe(false);
  expect(lc.normaliseContent([]).ok).toBe(false);
  expect(lc.normaliseContent({ sections: 'x' }).ok).toBe(false);
  expect(lc.normaliseContent({ sections: [{ title: '', items: [] }] }).ok).toBe(false);
  expect(lc.normaliseContent({ sections: [{ title: 'S', items: [{ type: 'content', title: '' }] }] }).ok).toBe(false);
  expect(lc.normaliseContent({ sections: [{ title: 'S', items: [{ type: 'wat', title: 'T' }] }] }).ok).toBe(false);
});

test('unknown fields are dropped (nothing smuggled into snapshots)', () => {
  const raw = sampleContent();
  raw.sections[0].items[0].evil = '<script>';
  raw.sections[0].evil = true;
  const r = lc.normaliseContent(raw);
  expect(r.ok).toBe(true);
  expect(r.content.sections[0].evil).toBeUndefined();
  expect(r.content.sections[0].items[0].evil).toBeUndefined();
});

test('acknowledgement items need a statement; resource items need a uuid', () => {
  const noAck = { sections: [{ title: 'S', items: [{ type: 'acknowledgement', title: 'A' }] }] };
  expect(lc.normaliseContent(noAck).ok).toBe(false);
  const badRes = { sections: [{ title: 'S', items: [{ type: 'resource', title: 'R', resource_id: '42' }] }] };
  expect(lc.normaliseContent(badRes).ok).toBe(false);
  const okRes = { sections: [{ title: 'S', items: [{ type: 'resource', title: 'R', resource_id: '5f0e7f3a-9f6f-4c58-9f0a-1a2b3c4d5e6f' }] }] };
  expect(lc.normaliseContent(okRes).ok).toBe(true);
});

test('quiz validation: needs questions, 2+ options, a sane correctIndex', () => {
  const mk = (q) => ({ sections: [{ title: 'S', items: [{ type: 'quiz', title: 'Q', quiz: q }] }] });
  expect(lc.normaliseContent(mk(null)).ok).toBe(false);
  expect(lc.normaliseContent(mk({ questions: [] })).ok).toBe(false);
  expect(lc.normaliseContent(mk({ questions: [{ question: 'q', options: ['only'], correctIndex: 0 }] })).ok).toBe(false);
  expect(lc.normaliseContent(mk({ questions: [{ question: 'q', options: ['a', 'b'], correctIndex: 2 }] })).ok).toBe(false);
  const ok = lc.normaliseContent(mk({ passThreshold: 999, questions: [{ question: 'q', options: ['a', 'b'], correctIndex: 1 }] }));
  expect(ok.ok).toBe(true);
  expect(ok.content.sections[0].items[0].quiz.passThreshold).toBe(80); // silly threshold falls back
});

// ── counted items / progress ─────────────────────────────────────────────────

test('counted keys are the required items', () => {
  expect(lc.countedKeys(sampleContent())).toEqual(['i-a', 'i-b', 'i-d']);
});

test('when nothing is required, every item counts (workflow stays completable)', () => {
  const c = sampleContent();
  c.sections.forEach((s) => s.items.forEach((i) => { i.required = false; }));
  expect(lc.countedKeys(c)).toEqual(['i-a', 'i-b', 'i-c', 'i-d']);
});

test('progress arithmetic: honest floor percentage, complete only at 100', () => {
  const c = sampleContent(); // counted: i-a, i-b, i-d
  expect(lc.progressFor(c, [])).toEqual({ countedTotal: 3, countedDone: 0, percent: 0, complete: false });
  const one = lc.progressFor(c, ['i-a']);
  expect(one.percent).toBe(33);
  expect(one.complete).toBe(false);
  // optional item completion does not move the needle
  expect(lc.progressFor(c, ['i-a', 'i-c']).percent).toBe(33);
  const all = lc.progressFor(c, ['i-a', 'i-b', 'i-d']);
  expect(all).toEqual({ countedTotal: 3, countedDone: 3, percent: 100, complete: true });
});

test('progress ignores keys that no longer exist in the version', () => {
  const p = lc.progressFor(sampleContent(), ['i-a', 'ghost-key', 'i-b', 'i-d']);
  expect(p.complete).toBe(true);
});

test('an empty workflow is never "complete"', () => {
  expect(lc.progressFor({ sections: [] }, []).complete).toBe(false);
});

// ── quiz grading ─────────────────────────────────────────────────────────────

test('grading: pass at threshold, fail below, missing answers are wrong', () => {
  const q = quiz(); // 2 questions, threshold 80
  expect(lc.gradeQuiz(q, [1, 0])).toEqual({ score: 2, total: 2, percent: 100, passed: true });
  expect(lc.gradeQuiz(q, [1])).toEqual({ score: 1, total: 2, percent: 50, passed: false });
  expect(lc.gradeQuiz(q, undefined).passed).toBe(false);
  expect(lc.gradeQuiz(quiz({ passThreshold: 50 }), [1, 2]).passed).toBe(true);
});

test('grading never passes an empty quiz', () => {
  expect(lc.gradeQuiz({ passThreshold: 0, questions: [] }, []).passed).toBe(false);
});

// ── employee projection ──────────────────────────────────────────────────────

test('serialiseForEmployee strips correct answers but keeps questions', () => {
  const out = lc.serialiseForEmployee(sampleContent());
  const quizItem = out.sections[1].items[0];
  expect(quizItem.quiz.questions).toHaveLength(2);
  expect(quizItem.quiz.questions[0].options).toEqual(['a', 'b']);
  quizItem.quiz.questions.forEach((q) => {
    expect(q.correctIndex).toBeUndefined();
    expect(q.explain).toBeUndefined();
  });
  // and it is a copy — the original still has the answers
  expect(sampleContent().sections[1].items[0].quiz.questions[0].correctIndex).toBe(1);
});

// ── snapshot equality ────────────────────────────────────────────────────────

test('equalContent is key-order independent and value sensitive', () => {
  const a = sampleContent();
  const b = JSON.parse(JSON.stringify(a));
  // shuffle key order in one item
  b.sections[0].items[0] = { required: true, body: 'hello', title: 'Read me', type: 'content', key: 'i-a' };
  expect(lc.equalContent(a, b)).toBe(true);
  b.sections[0].items[0].title = 'Read me v2';
  expect(lc.equalContent(a, b)).toBe(false);
});
