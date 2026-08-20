'use strict';

/**
 * INTERVIEW TEMPLATES — the catalogue's shape, and the OT interview's content.
 *
 * Two jobs:
 *
 *   1. The GRAMMAR holds. Every question has a key, a type the renderers
 *      switch on, and options where its type needs them. A template that
 *      breaks this renders a blank box on screen and a blank box on paper,
 *      silently — the failure mode a schema-driven feature has instead of a
 *      crash, so it is asserted rather than hoped for.
 *
 *   2. The OT interview says what Opal Therapy's document says. The wording is
 *      pinned verbatim, question by question. If somebody edits a question,
 *      this test fails and they have to bump the template version — which is
 *      the point, because a stored record snapshots the version it was created
 *      against and an unversioned reword would silently re-label old answers.
 */

const tpl = require('../interview-templates');

// ── Grammar ─────────────────────────────────────────────────────────────────

describe('template grammar', () => {
  test('every shipped template declares the fields the renderers require', () => {
    expect(tpl.allTemplates().length).toBeGreaterThan(0);
    for (const t of tpl.allTemplates()) {
      expect(typeof t.key).toBe('string');
      expect(t.key).toMatch(/^[a-z0-9-]+$/);
      expect(Number.isInteger(t.version)).toBe(true);
      expect(t.version).toBeGreaterThanOrEqual(1);
      expect(typeof t.name).toBe('string');
      expect(typeof t.documentTitle).toBe('string');
      expect(typeof t.summary).toBe('string');
      expect(Array.isArray(t.sections)).toBe(true);
      expect(t.sections.length).toBeGreaterThan(0);
    }
  });

  test('question keys are unique across the whole template', () => {
    for (const t of tpl.allTemplates()) {
      const seen = new Set();
      const duplicates = [];
      tpl.eachQuestion(t, (q) => {
        if (seen.has(q.key)) duplicates.push(q.key);
        seen.add(q.key);
      });
      // A duplicate key is how the SOURCE PDF broke: three answer boxes shared
      // one field name, so typing in one wrote all three.
      expect(duplicates).toEqual([]);
    }
  });

  test('every question has a known type, a key and a label', () => {
    for (const t of tpl.allTemplates()) {
      tpl.eachQuestion(t, (q) => {
        expect(tpl.FIELD_TYPES).toContain(q.type);
        expect(q.key).toMatch(/^[a-z0-9_]+$/);
        expect(typeof q.label).toBe('string');
        expect(q.label.length).toBeGreaterThan(0);
      });
    }
  });

  test('choice and checkbox questions carry unique option keys', () => {
    for (const t of tpl.allTemplates()) {
      tpl.eachQuestion(t, (q) => {
        if (q.type !== 'choice' && q.type !== 'checkboxes') return;
        expect(Array.isArray(q.options)).toBe(true);
        expect(q.options.length).toBeGreaterThan(1);
        const keys = q.options.map((o) => o.key);
        expect(new Set(keys).size).toBe(keys.length);
        q.options.forEach((o) => expect(typeof o.label).toBe('string'));
      });
    }
  });

  test('rating questions carry a scale, labelled rows and a written guide', () => {
    for (const t of tpl.allTemplates()) {
      tpl.eachQuestion(t, (q) => {
        if (q.type !== 'ratings') return;
        expect(Array.isArray(q.scale)).toBe(true);
        expect(q.scale.every(Number.isFinite)).toBe(true);
        expect(Array.isArray(q.rows)).toBe(true);
        expect(q.rows.length).toBeGreaterThan(0);
        q.rows.forEach((r) => {
          expect(r.key).toMatch(/^[a-z0-9_]+$/);
          expect(typeof r.label).toBe('string');
        });
        // A score with no written meaning is an unlabelled circle.
        expect(typeof q.guide).toBe('string');
        expect(q.guide).toMatch(/significant concerns/);
      });
    }
  });

  test('sections are numbered from 1 without gaps', () => {
    for (const t of tpl.allTemplates()) {
      expect(t.sections.map((s) => s.number)).toEqual(
        t.sections.map((_, i) => i + 1)
      );
      t.sections.forEach((s) => {
        expect(s.key).toMatch(/^[a-z0-9]+$/);
        expect(typeof s.title).toBe('string');
      });
    }
  });

  test('NO question anywhere declares a maximum length', () => {
    // The source PDF put MaxLen 100 on every field, so a PDF reader refused
    // the 101st character of every narrative answer. Nothing in this system
    // carries a length limit; MAX_ANSWER_CHARS is a storage ceiling applied at
    // the API, not a property a question may declare.
    for (const t of tpl.allTemplates()) {
      tpl.eachQuestion(t, (q) => {
        expect(q.maxLength).toBeUndefined();
        expect(q.maxlength).toBeUndefined();
        expect(q.max).toBeUndefined();
      });
    }
    expect(tpl.MAX_ANSWER_CHARS).toBeGreaterThanOrEqual(100000);
  });
});

// ── The Occupational Therapist interview's content ──────────────────────────

describe('Occupational Therapist interview — content fidelity', () => {
  const t = tpl.OT_INTERVIEW;
  const labels = [];
  tpl.eachQuestion(t, (q) => labels.push(q.label));

  test('it is the template the library ships, at version 1', () => {
    expect(tpl.templateKeys()).toContain('ot-interview');
    expect(t.version).toBe(1);
    expect(t.documentTitle).toBe('Occupational Therapist Interview Template');
    expect(t.approxPages).toBe(6);
  });

  test('the eight sections are the document\'s eight sections, in order', () => {
    expect(t.sections.map((s) => s.title)).toEqual([
      'Experience and Client Groups',
      'Understanding of NDIS / Community OT',
      'Support and Learning Style',
      'Practical Screening',
      'Communication and Multidisciplinary Working',
      'Self-awareness and Reflective Practice',
      'Values and Culture',
      'Interview Summary',
    ]);
  });

  test('the six client groups are the document\'s six', () => {
    const q = tpl.questionIndex(t).get('client_groups');
    expect(q.type).toBe('checkboxes');
    expect(q.options.map((o) => o.label)).toEqual([
      'Paediatrics', 'Adults', 'Disability',
      'Mental health', 'Neurological conditions', 'Intellectual disability',
    ]);
  });

  // Pinned verbatim. Changing any of these is a template change and must be
  // accompanied by a version bump, or existing records silently re-label.
  const VERBATIM = [
    'What client groups have you worked with so far?',
    'Notes / examples of experience',
    'How comfortable would you be seeing clients independently in their home, school or community?',
    'How would you feel about having a caseload where clients have very different diagnoses and support needs?',
    'How comfortable are you writing clinical documentation such as case notes, reports and assessments?',
    "When you come across something clinically that you don't know how to manage, what would you do?",
    'What does good supervision look like to you?',
    'How do you prefer to receive feedback?',
    'What areas do you think you would need the most support with during your next 6–12 months?',
    'What availability are you looking for — full time, part time or something else?',
    'When would you potentially be available to start?',
    'What is your expected salary?',
    'What are you looking for in your next OT role?',
    'Tell me about a time you have had to communicate something difficult to a client, parent or colleague. How did you approach it?',
    'What do you feel confident doing as an OT already, and what do you not feel confident doing yet?',
    'Tell me about a mistake you have made during placement or work. What did you do afterwards?',
    "OT sessions don't always go according to plan. Tell me about a session or situation that didn't go well and what you learned from it.",
    'What makes a good workplace for you?',
    'What qualities do you value in a supervisor or team leader?',
    'What qualities do you think make someone a good OT?',
    "How do you build rapport with someone who doesn't particularly want to engage in therapy?",
    'How would your previous supervisors or placement educators describe you?',
    'What motivates you at work?',
    'What frustrates you at work?',
    'Where would you like your clinical skills to be in 12 months?',
    "Are there particular areas of OT you'd like additional training in?",
    'What would make you stay with an organisation for several years?',
    'What are you hoping your employer will provide that helps you become a good clinician?',
    'Overall observations',
    'Key strengths',
    'Areas requiring support / development',
    'Any concerns, risks or follow-up questions',
    'Overall comments',
    'Recommendation',
    'Proposed employment details / next steps',
    'Interviewer name',
    'Date',
  ];

  for (const label of VERBATIM) {
    test(`asks: ${label.slice(0, 62)}`, () => {
      expect(labels).toContain(label);
    });
  }

  test('the two guidance notes are reproduced', () => {
    const index = tpl.questionIndex(t);
    expect(index.get('difficult_communication').guidance)
      .toBe('Consider: clarity, empathy, professionalism, boundaries, escalation and outcome.');
    expect(index.get('mistake').guidance)
      .toBe('Consider: accountability, reflection, communication, learning and changes made afterwards.');
    expect(index.get('overall_observations').guidance)
      .toMatch(/^Use this section to capture your overall impression after the interview\./);
  });

  test('the five rating categories are scored 1–5 with the document\'s guide', () => {
    const q = tpl.questionIndex(t).get('ratings');
    expect(q.scale).toEqual([1, 2, 3, 4, 5]);
    expect(q.rows.map((r) => r.label)).toEqual([
      'Clinical reasoning', 'Communication', 'Self-awareness',
      'Community readiness', 'Culture / values fit',
    ]);
    expect(q.guide).toBe(
      '1 = significant concerns, 3 = developing / acceptable with support, 5 = strong evidence.'
    );
  });

  test('the recommendation is mutually exclusive, with the document\'s three options', () => {
    const q = tpl.questionIndex(t).get('recommendation');
    expect(q.type).toBe('choice');   // not checkboxes — no contradictory pair
    expect(q.emphasis).toBe(true);
    expect(q.options.map((o) => o.label)).toEqual([
      'Progress to next stage / reference checks',
      'Hold / discuss further',
      'Do not progress',
    ]);
  });

  test('availability offers Other with a details field', () => {
    const q = tpl.questionIndex(t).get('availability');
    expect(q.options.map((o) => o.label)).toEqual(['Full time', 'Part time', 'Other']);
    expect(q.options.find((o) => o.key === 'other').detail).toBe(true);
  });

  test('every narrative question has its own field — the values section is 11 boxes, not one', () => {
    const values = t.sections.find((s) => s.title === 'Values and Culture');
    expect(values.questions.length).toBe(11);
    expect(values.questions.every((q) => q.type === 'longtext')).toBe(true);
  });
});

// ── Catalogue ───────────────────────────────────────────────────────────────

describe('catalogue', () => {
  test('lists the shipped template as available and the future ones as not', () => {
    const cat = tpl.catalogue();
    expect(cat.templates.map((t) => t.key)).toEqual(['ot-interview']);
    expect(cat.templates[0].available).toBe(true);
    expect(cat.templates[0].questionCount).toBeGreaterThan(35);
    expect(cat.templates[0].sectionCount).toBe(8);
    expect(cat.upcoming.length).toBeGreaterThan(0);
    expect(cat.upcoming.every((t) => t.available === false)).toBe(true);
    // The extension point is real, not decorative: nothing in `upcoming`
    // pretends to hold questions.
    expect(cat.upcoming.every((t) => !t.sections)).toBe(true);
  });

  test('templateByKey is exact — no fuzzy or case-insensitive match', () => {
    expect(tpl.templateByKey('ot-interview')).toBe(tpl.OT_INTERVIEW);
    expect(tpl.templateByKey('OT-INTERVIEW')).toBeNull();
    expect(tpl.templateByKey('ot-interview ')).toBeNull();
    expect(tpl.templateByKey('')).toBeNull();
    expect(tpl.templateByKey(null)).toBeNull();
    expect(tpl.templateByKey('../../etc/passwd')).toBeNull();
  });

  test('a snapshot is a deep copy — mutating it never reaches the live template', () => {
    const snap = tpl.snapshotOf(tpl.OT_INTERVIEW);
    snap.sections[0].questions[0].label = 'TAMPERED';
    snap.name = 'TAMPERED';
    expect(tpl.OT_INTERVIEW.sections[0].questions[0].label)
      .toBe('What client groups have you worked with so far?');
    expect(tpl.OT_INTERVIEW.name).toBe('Occupational Therapist Interview');
  });
});

// ── Answer coercion ─────────────────────────────────────────────────────────

describe('answer coercion', () => {
  const t = tpl.OT_INTERVIEW;
  const index = tpl.questionIndex(t);

  test('narrative answers keep every character, including paragraph breaks', () => {
    const q = index.get('client_groups_notes');
    const text = 'Para one.\n\nPara two, with  double  spaces.\n\tIndented.';
    expect(tpl.coerceAnswer(q, text)).toBe(text);
  });

  test('a narrative answer is not truncated below the storage ceiling', () => {
    const q = index.get('independent_visits');
    const long = 'x'.repeat(150000);
    expect(tpl.coerceAnswer(q, long)).toHaveLength(150000);
  });

  test('the storage ceiling is the only cut, and it is far beyond real use', () => {
    const q = index.get('independent_visits');
    const absurd = 'x'.repeat(tpl.MAX_ANSWER_CHARS + 5000);
    expect(tpl.coerceAnswer(q, absurd)).toHaveLength(tpl.MAX_ANSWER_CHARS);
  });

  test('checkboxes keep only real option keys, in template order, deduplicated', () => {
    const q = index.get('client_groups');
    expect(tpl.coerceAnswer(q, ['disability', 'paediatrics', 'disability', 'nonsense']))
      .toEqual(['paediatrics', 'disability']);
    expect(tpl.coerceAnswer(q, [])).toEqual([]);
    expect(tpl.coerceAnswer(q, 'paediatrics')).toBeUndefined();
  });

  test('a choice accepts only its own options, and drops a detail it has no field for', () => {
    const q = index.get('availability');
    expect(tpl.coerceAnswer(q, { option: 'full_time', detail: 'ignored' }))
      .toEqual({ option: 'full_time', detail: '' });
    expect(tpl.coerceAnswer(q, { option: 'other', detail: '0.8 FTE' }))
      .toEqual({ option: 'other', detail: '0.8 FTE' });
    expect(tpl.coerceAnswer(q, { option: 'evenings' })).toEqual({ option: null, detail: '' });
    expect(tpl.coerceAnswer(q, '')).toEqual({ option: null, detail: '' });
  });

  test('ratings accept only in-scale integers for known rows', () => {
    const q = index.get('ratings');
    // 4 and '5' are in scale (a numeric string is still a score a form posts).
    // 0 and 9 are off the scale, 2.5 is not on it, and invented_row is not a
    // row of this template — all four are dropped rather than stored.
    expect(tpl.coerceAnswer(q, {
      clinical_reasoning: 4, communication: '5', self_awareness: 0,
      community_readiness: 9, culture_fit: 2.5, invented_row: 3,
    })).toEqual({ clinical_reasoning: 4, communication: 5 });
  });

  test('unknown question keys are dropped, never stored', () => {
    const out = tpl.coerceResponses(t, {
      client_groups_notes: 'kept',
      __proto__polluted: 'dropped',
      'not-a-question': 'dropped',
      constructor: 'dropped',
    });
    expect(out).toEqual({ client_groups_notes: 'kept' });
  });

  test('coercion is against the SNAPSHOT, so a template edit cannot widen an old record', () => {
    const oldSnapshot = tpl.snapshotOf(t);
    oldSnapshot.sections = oldSnapshot.sections.slice(0, 1);   // an older, smaller template
    const out = tpl.coerceResponses(oldSnapshot, {
      client_groups_notes: 'in the old template',
      overall_observations: 'added to the template later',
    });
    expect(out).toEqual({ client_groups_notes: 'in the old template' });
  });
});

describe('progress', () => {
  const t = tpl.OT_INTERVIEW;

  test('counts every question and names the blank ones', () => {
    const p = tpl.progressOf(t, {});
    expect(p.answered).toBe(0);
    expect(p.percent).toBe(0);
    expect(p.blank.length).toBe(p.total);
    expect(p.blank[0]).toHaveProperty('label');
    expect(p.blank[0]).toHaveProperty('section');
  });

  test('whitespace is not an answer; a single ticked box is', () => {
    const p = tpl.progressOf(t, {
      client_groups_notes: '   \n  ',
      client_groups: ['adults'],
      ratings: { communication: 3 },
      availability: { option: null, detail: '' },
    });
    expect(p.answered).toBe(2);
  });
});
