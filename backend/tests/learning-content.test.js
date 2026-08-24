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

test('a task may carry a walkthrough key; anything else may not', () => {
  // The Splose lessons: a task item names its interactive walkthrough and the
  // player renders a launch tile. The key lives on the item — not derived
  // from the item's own key — so duplication (fresh keys) never severs it.
  const mk = (item) => ({ sections: [{ title: 'S', items: [item] }] });
  const ok = lc.normaliseContent(mk({ type: 'task', title: 'T', walkthrough_key: 'splose-booking' }));
  expect(ok.ok).toBe(true);
  expect(ok.content.sections[0].items[0].walkthrough_key).toBe('splose-booking');

  // An invalid key is dropped, not refused — the task still stands as words.
  const bad = lc.normaliseContent(mk({ type: 'task', title: 'T', walkthrough_key: 'has spaces!' }));
  expect(bad.ok).toBe(true);
  expect(bad.content.sections[0].items[0].walkthrough_key).toBeUndefined();

  // On any other type it is an unknown field, dropped like the rest.
  const onContent = lc.normaliseContent(mk({ type: 'content', title: 'C', walkthrough_key: 'splose-booking' }));
  expect(onContent.ok).toBe(true);
  expect(onContent.content.sections[0].items[0].walkthrough_key).toBeUndefined();

  // The employee projection keeps it — the player launches from it.
  const emp = lc.serialiseForEmployee(ok.content);
  expect(emp.sections[0].items[0].walkthrough_key).toBe('splose-booking');
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

// ── screen-sized sections (what the importer hands the step renderer) ─────────

let _rid = 0;
const entry = (group, label, title) => ({
  group, label,
  item: {
    type: 'resource', title, required: true,
    // A resource item is only valid with a linked resource, and the point of
    // the last assertion here is that what the importer builds normalises.
    resource_id: '00000000-0000-4000-8000-' + String(++_rid).padStart(12, '0'),
    resource_title: title,
  },
});
const titlesOf = (sections) => sections.map((s) => [s.title, s.items.map((i) => i.title)]);

test('an empty list produces no sections at all', () => {
  expect(lc.sectionsFromOrderedItems([], 'Modules')).toEqual([]);
  expect(lc.sectionsFromOrderedItems(null, 'Modules')).toEqual([]);
});

test('a short single-kind list stays one section, named for its kind', () => {
  const out = lc.sectionsFromOrderedItems([
    entry('article', 'Orientation', 'Welcome'),
    entry('article', 'Orientation', 'How we work'),
  ], 'Modules');
  expect(titlesOf(out)).toEqual([['Orientation', ['Welcome', 'How we work']]]);
});

test('it divides where the source data changes kind', () => {
  const out = lc.sectionsFromOrderedItems([
    entry('article', 'Orientation', 'A1'),
    entry('article', 'Orientation', 'A2'),
    entry('policy', 'Policies and standards', 'P1'),
    entry('policy', 'Policies and standards', 'P2'),
  ], 'Modules');
  expect(titlesOf(out)).toEqual([
    ['Orientation', ['A1', 'A2']],
    ['Policies and standards', ['P1', 'P2']],
  ]);
});

test('a run too short to be a screen joins the section beside it', () => {
  const out = lc.sectionsFromOrderedItems([
    entry('article', 'Orientation', 'A1'),
    entry('article', 'Orientation', 'A2'),
    entry('ndis_guide', 'NDIS essentials', 'G1'), // alone — folds backwards
  ], 'Modules');
  expect(titlesOf(out)).toEqual([['Orientation', ['A1', 'A2', 'G1']]]);
});

test('a lone FIRST run folds forwards, because nothing precedes it', () => {
  const out = lc.sectionsFromOrderedItems([
    entry('video', 'Watch and listen', 'V1'),
    entry('policy', 'Policies and standards', 'P1'),
    entry('policy', 'Policies and standards', 'P2'),
  ], 'Modules');
  expect(titlesOf(out)).toEqual([['Watch and listen', ['V1', 'P1', 'P2']]]);
});

test('nothing is longer than a screen; the overflow continues', () => {
  const many = Array.from({ length: 9 }, (_, i) => entry('tutorial', 'Using the portal', 'T' + (i + 1)));
  const out = lc.sectionsFromOrderedItems(many, 'Modules');
  expect(out).toHaveLength(2);
  expect(out[0].items).toHaveLength(lc.SECTION_MAX);
  expect(out[1].title).toBe('Using the portal (continued)');
  expect(out[1].items).toHaveLength(9 - lc.SECTION_MAX);
});

test('the original order survives exactly — only the screen breaks are new', () => {
  const src = [
    entry('article', 'Orientation', 'A1'), entry('article', 'Orientation', 'A2'),
    entry('article', 'Orientation', 'A3'), entry('article', 'Orientation', 'A4'),
    entry('article', 'Orientation', 'A5'), entry('article', 'Orientation', 'A6'),
    entry('policy', 'Policies and standards', 'P1'), entry('policy', 'Policies and standards', 'P2'),
    entry('tutorial', 'Using the portal', 'T1'), entry('tutorial', 'Using the portal', 'T2'),
  ];
  const out = lc.sectionsFromOrderedItems(src, 'Modules');
  const flat = out.flatMap((s) => s.items.map((i) => i.title));
  expect(flat).toEqual(src.map((e) => e.item.title));
});

test('entries with no label of their own fall back to the given one', () => {
  const out = lc.sectionsFromOrderedItems([
    { group: '', label: '', item: { type: 'task', title: 'X', required: true } },
    { group: '', label: '', item: { type: 'task', title: 'Y', required: true } },
  ], 'Portal walkthroughs');
  expect(out[0].title).toBe('Portal walkthroughs');
});

test('what it produces is valid content the renderer can take', () => {
  const out = lc.sectionsFromOrderedItems([
    entry('article', 'Orientation', 'A1'), entry('article', 'Orientation', 'A2'),
    entry('policy', 'Policies and standards', 'P1'), entry('policy', 'Policies and standards', 'P2'),
  ], 'Modules');
  const norm = lc.normaliseContent({ sections: out });
  expect(norm.ok).toBe(true);
  expect(norm.content.sections).toHaveLength(2);
  expect(lc.contentStats(norm.content).items).toBe(4);
});

test('a kind that recurs later continues rather than repeating its name', () => {
  // Order is preserved, so a list that returns to an earlier kind produces a
  // second section of that kind. Two identically named steps in one rail is
  // a reader's problem even when the data is right.
  const out = lc.sectionsFromOrderedItems([
    entry('article', 'Orientation', 'A1'), entry('article', 'Orientation', 'A2'),
    entry('policy', 'Policies and standards', 'P1'), entry('policy', 'Policies and standards', 'P2'),
    entry('article', 'Orientation', 'A3'), entry('article', 'Orientation', 'A4'),
  ], 'Modules');
  expect(out.map((s) => s.title)).toEqual([
    'Orientation', 'Policies and standards', 'Orientation (continued)',
  ]);
  expect(new Set(out.map((s) => s.title)).size).toBe(out.length);
});
