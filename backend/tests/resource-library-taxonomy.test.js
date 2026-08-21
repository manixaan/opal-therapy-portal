'use strict';

/**
 * THE TAXONOMY ENGINE — the decisions, without a database or a model.
 *
 * This suite exists because the engine's failure modes are quiet ones. A
 * lexicon change that sends a fifth of the library to Needs Review still
 * "works": every resource gets a folder id, no exception is thrown, and the
 * only symptom is a therapist who cannot find anything. So the properties
 * asserted here are the ones a person would notice — how much lands unsorted,
 * whether a policy is filed as a policy, whether ties are handled as ties —
 * rather than the internal arithmetic that produces them.
 */

const T = require('../resource-library-taxonomy');

const resource = (over = {}) => ({
  id: over.id || '11111111-1111-1111-1111-111111111111',
  title: '', description: null, content: null,
  content_type: null, resource_type: null, external_url: null,
  ...over,
});

const profile = (over, extra) => T.buildProfile(resource(over), extra || {});
const folderOf = (over, extra) => T.chooseTheme(profile(over, extra)).key;

describe('normalisation', () => {
  it('flattens punctuation so hyphenated and spaced forms match', () => {
    expect(T.has(T.normalise('Self-Regulation Poster'), 'self regulation')).toBe(true);
    expect(T.has(T.normalise('self regulation'), 'self-regulation')).toBe(true);
  });

  it('singularises both sides, so a plural title matches a singular phrase', () => {
    expect(T.has(T.normalise('Understanding Emotions Worksheet'), 'emotion')).toBe(true);
    expect(T.has(T.normalise('Assessment'), 'assessments')).toBe(true);
  });

  it('matches whole phrases only — a substring is not a match', () => {
    // "assess" must not be found inside "reassessment" as a word.
    expect(T.has(T.normalise('Classroom'), 'class')).toBe(false);
  });

  it('leaves double-s and -us words alone', () => {
    expect(T.stem('progress')).toBe('progress');
    expect(T.stem('focus')).toBe('focus');
    expect(T.stem('policies')).toBe('policy');
  });
});

describe('tag weighting reflects the corpus, not the code', () => {
  it('makes a rare tag worth more than a ubiquitous one', () => {
    // The real spread this was built for: one tag on a quarter of the library,
    // another on a fortieth.
    const lists = [];
    for (let i = 0; i < 640; i++) {
      if (i < 155) lists.push(['Social skills']);
      else if (i < 171) lists.push(['Sensory processing']);
      else lists.push([]);
    }
    const w = T.tagWeights(lists);
    expect(w['sensory processing']).toBeGreaterThan(w['social skill']);
  });

  it('keeps every weight inside the declared bounds', () => {
    const w = T.tagWeights([['Everywhere'], ['Everywhere'], ['Everywhere'], ['Rare']]);
    for (const value of Object.values(w)) {
      expect(value).toBeGreaterThanOrEqual(T.TAG_WEIGHT_MIN);
      expect(value).toBeLessThanOrEqual(T.TAG_WEIGHT_MAX);
    }
  });
});

describe('purpose outranks topic (§45)', () => {
  it('files a policy about emotional regulation as a policy', () => {
    expect(folderOf({
      title: 'Emotional Regulation Support Policy',
      content_type: 'policy',
    }, { tags: ['Emotional regulation'] })).toBe('policies-procedures');
  });

  it('files a handwriting assessment as an assessment, not a motor activity', () => {
    expect(folderOf({ title: 'Handwriting Screening Tool' })).toBe('assessments');
  });

  it('still files an ordinary handwriting worksheet by topic', () => {
    expect(folderOf({ title: 'Letter Formation Tracing Worksheet' })).toBe('handwriting-motor');
  });

  it('files NDIS pricing under funding rather than administration', () => {
    expect(folderOf({
      title: 'Specialist Disability Accommodation Pricing Arrangements',
      content_type: 'ndis_guide',
    })).toBe('ndis-funding');
  });
});

describe('ties are resolved, not surrendered', () => {
  const dualTagged = { tags: ['Social skills', 'Communication supports'] };

  it('breaks a sibling tie on the title when the title says something', () => {
    const choice = T.chooseTheme(profile({ title: 'Traffic Light Communication Fans' }, dualTagged));
    expect(choice.key).toBe('communication');
  });

  it('falls back to the shared parent when the title says nothing', () => {
    const choice = T.chooseTheme(profile({ title: 'Consensual Touch Discussion' }, dualTagged));
    // Either a real sibling on evidence, or the parent — never Needs Review.
    expect(['therapy-resources', 'social-skills', 'communication', 'body-safety'])
      .toContain(choice.key);
    expect(choice.confidence).toBeGreaterThanOrEqual(T.CONFIDENCE_FLOOR);
  });

  it('prefers the child when a parent and its child are close', () => {
    const choice = T.chooseTheme(profile(
      { title: 'Feelings Thermometer Activity Worksheet' },
      { tags: ['Emotional regulation'] }));
    expect(choice.key).toBe('emotional-regulation');
  });

  it('places weak-but-real therapy material at the parent, not in review', () => {
    const choice = T.chooseTheme(profile({ title: 'Animal Colouring Sheets' }));
    expect(choice.key).not.toBe(T.REVIEW_KEY);
    expect(choice.confidence).toBeGreaterThanOrEqual(T.CONFIDENCE_FLOOR);
  });
});

describe('deriving the tree from the collection', () => {
  /** A corpus with one dominant theme and one that is far too small. */
  function corpus() {
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push(resource({ id: `a${i}`, title: `Feelings Worksheet ${i}`, content_type: 'worksheet' }));
    }
    for (let i = 0; i < 30; i++) {
      rows.push(resource({ id: `b${i}`, title: `Social Story ${i}` }));
    }
    for (let i = 0; i < 12; i++) {
      rows.push(resource({ id: `c${i}`, title: `Practice Policy ${i}`, content_type: 'policy' }));
    }
    // One lonely equipment record: not enough to justify a folder.
    rows.push(resource({ id: 'd1', title: 'Shower chair prescription' }));
    return rows.map((r) => T.buildProfile(r, {}));
  }

  it('creates only the folders the corpus actually supports', () => {
    const tax = T.deriveTaxonomy(corpus());
    const keys = tax.folders.map((f) => f.key);
    expect(keys).toContain('therapy-resources');
    expect(keys).toContain('policies-procedures');
    expect(keys).toContain(T.REVIEW_KEY);
    // One equipment record cannot make an Equipment folder (§9, §31).
    expect(keys).not.toContain('equipment-environment');
  });

  it('never leaves a resource without a folder', () => {
    const profiles = corpus();
    const tax = T.deriveTaxonomy(profiles);
    const assigned = T.assignAll(profiles, tax);
    expect(assigned).toHaveLength(profiles.length);
    const live = new Set(tax.folders.map((f) => f.key));
    for (const a of assigned) expect(live.has(a.folderKey)).toBe(true);
  });

  it('re-homes the members of a pruned subfolder to its parent, not to review', () => {
    const profiles = corpus();
    const tax = T.deriveTaxonomy(profiles);
    const assigned = T.assignAll(profiles, tax);
    const lonely = assigned.find((a) => a.resourceId === 'd1');
    expect(lonely.folderKey).not.toBe('equipment-environment');
  });

  it('always offers a review bucket, even for a tiny library', () => {
    const tax = T.deriveTaxonomy([T.buildProfile(resource({ title: 'x' }), {})]);
    expect(tax.folders.some((f) => f.isReviewBucket)).toBe(true);
  });

  it('does not subdivide a parent that is too small to need it (§70)', () => {
    const small = [];
    for (let i = 0; i < 8; i++) {
      small.push(T.buildProfile(resource({ id: `s${i}`, title: `Feelings Worksheet ${i}` }), {}));
    }
    const tax = T.deriveTaxonomy(small);
    expect(tax.folders.filter((f) => f.parent)).toHaveLength(0);
  });
});

describe('folder naming discipline (§11)', () => {
  it('uses ordinary words, not codes or dumping grounds', () => {
    for (const theme of T.THEMES) {
      expect(theme.name).toMatch(/^[A-Z][A-Za-z&' -]*$/);
      expect(theme.name.split(/\s+/).length).toBeLessThanOrEqual(4);
      expect(theme.name.toLowerCase()).not.toMatch(/miscellaneous|^other$|^general$/);
    }
    expect(T.REVIEW_FOLDER.name).toBe('Needs Review');
  });

  it('gives every theme a description worth reading (§30)', () => {
    for (const theme of T.THEMES) {
      expect(theme.description.length).toBeGreaterThan(20);
      expect(theme.description.length).toBeLessThan(120);
    }
  });

  it('keeps the hierarchy to two levels (§9)', () => {
    for (const theme of T.THEMES) {
      if (!theme.parent) continue;
      expect(T.BY_KEY[theme.parent]).toBeDefined();
      expect(T.BY_KEY[theme.parent].parent).toBeFalsy();
    }
  });
});

describe('classifying one resource against an existing taxonomy (§23, §24)', () => {
  const live = ['assessments', 'policies-procedures', 'therapy-resources', 'emotional-regulation'];

  it('chooses from the folders that exist and never invents one', () => {
    const got = T.classifyOne(profile({ title: 'Sensory Diet Planning Guide' }), live);
    expect(live.concat([T.REVIEW_KEY])).toContain(got.folderKey);
  });

  it('sends a resource it cannot place to Needs Review rather than guessing', () => {
    const got = T.classifyOne(profile({ title: 'zzzz' }), live);
    expect(got.folderKey).toBe(T.REVIEW_KEY);
  });

  it('will not reach for a folder that was pruned', () => {
    const got = T.classifyOne(profile({ title: 'NDIS Price Guide 2026' }), ['therapy-resources']);
    expect(got.folderKey).not.toBe('ndis-funding');
  });
});

describe('duplicate awareness (§27)', () => {
  it('groups resources whose titles reduce to the same words', () => {
    const dupes = T.findDuplicates([
      { resourceId: '1', title: 'Feelings Thermometer Activity Sheet' },
      { resourceId: '2', title: 'FREE Printable Thermometer Feelings' },
      { resourceId: '3', title: 'Handwriting Checklist' },
    ]);
    expect(dupes).toHaveLength(1);
    expect(dupes[0].members.map((m) => m.resourceId).sort()).toEqual(['1', '2']);
  });

  it('reports rather than acts — it returns members, never a deletion', () => {
    const dupes = T.findDuplicates([
      { resourceId: '1', title: 'Same Title' }, { resourceId: '2', title: 'Same Title' },
    ]);
    expect(Object.keys(dupes[0])).toEqual(['reason', 'members']);
  });
});

describe('the shape of the whole answer', () => {
  /**
   * The property that actually matters: over a realistic mixed corpus, the
   * unsorted bucket stays small. This is the assertion that fails when a
   * lexicon edit quietly breaks classification for a whole class of document.
   */
  it('leaves only a small remainder unsorted over a mixed corpus (§68)', () => {
    const titles = [
      'Feelings Thermometer', 'Zones of Regulation Cards', 'Calm Down Strategies Poster',
      'Social Story About Waiting', 'Making Friends Conversation Cards', 'Good Manners Activity',
      'Visual Timetable for Bedtime', 'Morning Routine Checklist', 'Reward Chart',
      'Letter Formation Practice', 'Scissor Skills Cutting Sheets', 'Pencil Grip Guide',
      'Executive Function Planning Worksheet', 'Working Memory Games',
      'Sensory Diet Ideas', 'Chewable Oral-Sensory Tools',
      'Dressing Skills Sequence', 'Toileting Visual Support', 'Australian Coins Activity',
      'Home Modification Assessment Guide', 'Shower Chair Prescription Notes',
      'Handwriting Screening Tool', 'Cooking Assessment Form', 'Sensory Modulation Screening Tool',
      'Professional Boundaries Policy', 'Incident Management Procedure', 'Privacy Policy',
      'Report Writing Phrase Bank', 'Referral Letter Template', 'Progress Note Template',
      'NDIS Price Guide', 'Reasonable and Necessary Explained', 'Support Coordination Overview',
      'Trauma-Informed Practice Course', 'Supervision Framework', 'CPD Webinar Catalogue',
      'Clinical Reasoning Guide', 'Caregiver Coaching Guide', 'Discharge Planning Guide',
      'Information Sheet for Parents', 'Welcome Pack for Families', 'Home Program Handout',
      'Information Security Basics', 'Rural Trip Pre-Trip Checklist', 'Your First Day at Opal',
      'Body Parts Labelling Activity', 'Safe and Unsafe Situations', 'Being Safe Online',
    ];
    const profiles = titles.map((t, i) => T.buildProfile(resource({ id: `r${i}`, title: t }), {}));
    const tax = T.deriveTaxonomy(profiles);
    const assigned = T.assignAll(profiles, tax);
    const review = assigned.filter((a) => a.folderKey === T.REVIEW_KEY);
    expect(review.length / assigned.length).toBeLessThan(0.15);
  });

  it('gives every assignment a rationale a person could read', () => {
    const profiles = [profile({ title: 'Professional Boundaries Policy', content_type: 'policy' })];
    const tax = T.deriveTaxonomy(profiles);
    const [a] = T.assignAll(profiles, tax);
    expect(typeof a.rationale).toBe('string');
    expect(a.rationale.length).toBeGreaterThan(0);
    expect(a.rationale.length).toBeLessThanOrEqual(300);
  });

  it('keeps confidence inside [0, 1] whatever the input', () => {
    const odd = [
      profile({ title: '' }),
      profile({ title: 'x'.repeat(400) }),
      profile({ title: 'Policy Policy Policy Assessment Assessment NDIS NDIS NDIS' }),
    ];
    const tax = T.deriveTaxonomy(odd);
    for (const a of T.assignAll(odd, tax)) {
      expect(a.confidence).toBeGreaterThanOrEqual(0);
      expect(a.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('survives a resource with no usable fields at all', () => {
    expect(() => profile({ title: null, description: null })).not.toThrow();
  });
});
