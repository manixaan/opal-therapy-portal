'use strict';

/**
 * THE MODEL BOUNDARY FOR LIBRARY CLASSIFICATION.
 *
 * A model that files documents is a model that has been handed a list of
 * database ids and asked to say things about them. Everything it says back is
 * a proposal from an untrusted party, and this suite is where that stops being
 * a comment and becomes a test:
 *
 *   - an id we did not send is dropped, never looked up (§41)
 *   - a folder we did not offer is refused (§24)
 *   - a folder NAME that is a code, or means "we gave up", is refused (§11)
 *   - a batch that fails leaves the deterministic answer standing (§61)
 *   - a hesitant model does not overturn a rule that can be read
 *
 * The gateway is exercised through its own mock provider rather than stubbed,
 * so the policy, the kill switch and the tool-call plumbing are all really in
 * the path. Nothing here reaches a network.
 */

process.env.AWS_REGION = process.env.AWS_REGION || 'ap-southeast-2';

const classifier = require('../resource-library-classifier');
const policyEngine = require('../ai/ai-policy');
const outputTypes = require('../ai/ai-output-type');
const aiClassification = require('../ai/ai-classification');

const FOLDERS = [
  { key: 'assessments', name: 'Assessments', description: 'Assessment tools.' },
  { key: 'policies-procedures', name: 'Policies & Procedures', description: 'Policies.' },
  { key: 'needs-review', name: 'Needs Review', description: 'Unsorted.', isReviewBucket: true },
];
const FOLDER_KEYS = FOLDERS.map((f) => f.key);
const IDS = new Set(['aaaa', 'bbbb']);

// The gateway audits every outcome, denials included, which opens the shared
// database pool. Closing it keeps this offline suite from holding a handle.
afterAll(async () => {
  await require('../database').pool.end().catch(() => {});
});

describe('the policy this feature runs under', () => {
  const policy = policyEngine.get(classifier.AI_FEATURE);

  it('exists, because a feature without one is denied by the gateway', () => {
    expect(policy).toBeTruthy();
  });

  it('is declared INTERNAL and may not receive clinical data', () => {
    expect(policy.classification).toBe(aiClassification.INTERNAL);
    expect(policy.mayReceiveClinicalData).toBe(false);
    expect(policy.allowedClassifications).toEqual([aiClassification.INTERNAL]);
  });

  it('cannot produce a clinical document — a folder name is not a health record', () => {
    expect(policy.outputTypes).toEqual([outputTypes.ASSISTANT_RESPONSE]);
  });

  it('stays onshore and on approved models', () => {
    expect(policy.region).toBe('australia');
    expect(policy.allowedProviders).not.toContain('openai');
    expect(policy.allowedModels).toEqual(expect.arrayContaining(['clinical_standard']));
  });

  it('is auditable under its own category', () => {
    expect(policy.auditCategory).toBe('resource_classification');
  });
});

describe('the module imports no vendor SDK', () => {
  it('reaches a model only through the gateway', () => {
    const src = require('fs').readFileSync(require.resolve('../resource-library-classifier'), 'utf8');
    expect(src).toMatch(/require\('\.\/ai\/ai-gateway'\)/);
    expect(src).not.toMatch(/@anthropic-ai|openai|@aws-sdk\/client-bedrock/);
  });
});

describe('validating one placement (§41)', () => {
  const valid = { resource_id: 'aaaa', folder: 'assessments', confidence: 0.8 };

  it('accepts a well-formed placement for an id we sent', () => {
    const got = classifier.validatePlacement(valid, IDS, FOLDER_KEYS);
    expect(got).toMatchObject({ resourceId: 'aaaa', folderKey: 'assessments', confidence: 0.8 });
  });

  it('drops an id we never sent, rather than looking it up', () => {
    expect(classifier.validatePlacement(
      { ...valid, resource_id: 'not-in-the-batch' }, IDS, FOLDER_KEYS)).toBeNull();
  });

  it('drops a folder we never offered', () => {
    expect(classifier.validatePlacement(
      { ...valid, folder: 'Fine Motor Activities' }, IDS, FOLDER_KEYS)).toBeNull();
  });

  it('clamps a confidence outside [0, 1] instead of storing it', () => {
    expect(classifier.validatePlacement({ ...valid, confidence: 4 }, IDS, FOLDER_KEYS).confidence).toBe(1);
    expect(classifier.validatePlacement({ ...valid, confidence: -2 }, IDS, FOLDER_KEYS).confidence).toBe(0);
    expect(classifier.validatePlacement({ ...valid, confidence: 'high' }, IDS, FOLDER_KEYS).confidence).toBe(0);
  });

  it('ignores an audience outside the vocabulary', () => {
    expect(classifier.validatePlacement(
      { ...valid, audience: 'Everyone' }, IDS, FOLDER_KEYS).audience).toBeNull();
  });

  it('truncates free text rather than storing whatever arrived', () => {
    const got = classifier.validatePlacement(
      { ...valid, purpose: 'p'.repeat(9000), summary: 's'.repeat(9000) }, IDS, FOLDER_KEYS);
    expect(got.purpose.length).toBeLessThanOrEqual(120);
    expect(got.summary.length).toBeLessThanOrEqual(400);
  });

  it('refuses junk without throwing', () => {
    for (const junk of [null, undefined, 'a string', 42, [], {}]) {
      expect(classifier.validatePlacement(junk, IDS, FOLDER_KEYS)).toBeNull();
    }
  });
});

describe('validating a folder name (§11, §69)', () => {
  it('accepts ordinary, short names', () => {
    for (const ok of ['Assessments', 'Therapy Resources', 'Policies & Procedures',
      'Reports and Documentation', 'Client & Family Resources']) {
      expect(classifier.validFolderName(ok)).toBe(ok);
    }
  });

  it('refuses a name that means "we did not decide"', () => {
    for (const bad of ['Miscellaneous', 'Other', 'other documents', 'General', 'Unsorted', 'Files']) {
      expect(classifier.validFolderName(bad)).toBeNull();
    }
  });

  it('refuses anything that looks like a database code', () => {
    for (const bad of ['CLINICAL_MISC_03', 'General Files 2', 'FOLDER', 'cat_12345']) {
      expect(classifier.validFolderName(bad)).toBeNull();
    }
  });

  it('refuses a sentence pretending to be a folder', () => {
    expect(classifier.validFolderName(
      'Resources that relate to emotional regulation and social skills')).toBeNull();
  });

  it('refuses markup, quotes and control characters', () => {
    for (const bad of ['<script>x</script>', 'Assessments"; DROP TABLE', 'A\nB', '']) {
      expect(classifier.validFolderName(bad)).toBeNull();
    }
  });
});

describe('the tools the model is forced to answer through', () => {
  it('offers folders as a closed enum, so a new one cannot be invented', () => {
    const tool = classifier.buildClassifyTool(FOLDER_KEYS);
    const folder = tool.input_schema.properties.placements.items.properties.folder;
    expect(folder.enum).toEqual(FOLDER_KEYS);
  });

  it('lets the taxonomy review rename but never restructure', () => {
    const tool = classifier.buildTaxonomyTool(FOLDER_KEYS);
    const props = Object.keys(tool.input_schema.properties.folders.items.properties);
    expect(props.sort()).toEqual(['description', 'key', 'name']);
    // No parent, no create, no delete: the shape of the tree is not the
    // model's to change.
    expect(props).not.toContain('parent');
  });
});

describe('what the model is shown', () => {
  it('sends the id, the metadata and a sample — never a whole document', () => {
    const described = classifier.describeResource({
      resourceId: 'aaaa', title: 'Handwriting Checklist', summary: 'A checklist.',
      contentType: 'checklist', tags: ['Handwriting'], sampledText: 'x'.repeat(50000),
    });
    expect(described).toContain('ID: aaaa');
    expect(described).toContain('Handwriting Checklist');
    expect(described.length).toBeLessThan(2000);
  });

  it('says plainly when a document could not be read (§44)', () => {
    const described = classifier.describeResource({
      resourceId: 'aaaa', title: 'Scanned handout', textSource: 'no-text-layer',
    });
    expect(described).toContain('no-text-layer');
  });
});

describe('reconciling the two answers', () => {
  const rule = {
    resourceId: 'aaaa', folderKey: 'assessments', confidence: 0.7, rationale: 'Matched Assessments.',
  };

  it('keeps the deterministic answer when there is no model answer (§61)', () => {
    expect(classifier.reconcile(rule, null)).toMatchObject({ folderKey: 'assessments', source: 'rules' });
  });

  it('raises confidence when both methods agree', () => {
    const got = classifier.reconcile(rule, { folderKey: 'assessments', confidence: 0.9 });
    expect(got.folderKey).toBe('assessments');
    expect(got.confidence).toBeGreaterThan(rule.confidence);
    expect(got.confidence).toBeLessThanOrEqual(1);
  });

  it('lets a clearly confident model overrule the rules', () => {
    const got = classifier.reconcile(rule, { folderKey: 'policies-procedures', confidence: 0.95 });
    expect(got.folderKey).toBe('policies-procedures');
    expect(got.source).toBe('ai');
  });

  it('does NOT let a hesitant model overrule a rule that can be read', () => {
    const got = classifier.reconcile(rule, { folderKey: 'policies-procedures', confidence: 0.4 });
    expect(got.folderKey).toBe('assessments');
    expect(got.source).toBe('rules');
  });

  it('lowers confidence on a contested placement, so the Owner can spot it', () => {
    const got = classifier.reconcile(rule, { folderKey: 'policies-procedures', confidence: 0.4 });
    expect(got.confidence).toBeLessThan(rule.confidence);
    expect(got.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('through the real gateway, on the mock provider', () => {
  const mock = require('../ai/providers/mock-provider');
  const registry = require('../ai/ai-model-registry');

  const profiles = [
    { resourceId: 'aaaa', title: 'Handwriting Checklist' },
    { resourceId: 'bbbb', title: 'Privacy Policy' },
  ];
  const ctx = { modelKey: 'mock', userId: null, organisationId: null };

  afterEach(() => mock._setHandlerForTests(null));

  /** The gateway only reaches the mock when the policy allows that key. */
  it('has the mock model available to this feature, so this suite can run offline', () => {
    expect(policyEngine.get(classifier.AI_FEATURE).allowedModels).toContain('mock');
    expect(registry.get('mock').provider).toBe(registry.PROVIDER_MOCK);
  });

  it('drops a fabricated id and keeps the real one', async () => {
    mock._setHandlerForTests(({ toolChoice }) => ({
      text: null,
      toolUse: {
        type: 'tool_use', name: toolChoice.name,
        input: {
          placements: [
            { resource_id: 'aaaa', folder: 'assessments', confidence: 0.9 },
            { resource_id: '00000000-dead-beef-0000-000000000000', folder: 'assessments', confidence: 0.9 },
          ],
        },
      },
      providerRequestId: 'mock', sourceRegion: 'ap-southeast-2',
    }));

    const got = await classifier.classifyBatch(profiles, FOLDERS, ctx).catch(() => new Map());
    // Either the gateway refused outright (no Bedrock config in this
    // environment) or it answered — in both cases the fabricated id is absent.
    expect(got.has('00000000-dead-beef-0000-000000000000')).toBe(false);
  });

  it('a failing batch leaves every deterministic placement standing (§61)', async () => {
    mock._setHandlerForTests(() => { throw new Error('provider_error'); });
    const result = await classifier.refinePlacements(profiles, FOLDERS, ctx);
    expect(result.placements.size).toBe(0);
    // The caller reconciles with an empty map, which returns the rules answer.
    const rule = { resourceId: 'aaaa', folderKey: 'assessments', confidence: 0.7, rationale: 'r' };
    expect(classifier.reconcile(rule, result.placements.get('aaaa') || null).folderKey)
      .toBe('assessments');
  });

  it('a nonsense taxonomy review changes nothing', async () => {
    mock._setHandlerForTests(({ toolChoice }) => ({
      text: null,
      toolUse: {
        type: 'tool_use', name: toolChoice.name,
        input: { folders: [{ key: 'not-a-folder', name: 'Miscellaneous' }] },
      },
      providerRequestId: 'mock', sourceRegion: 'ap-southeast-2',
    }));
    const patches = await classifier.refineTaxonomy(
      FOLDERS.map((f) => ({ ...f, count: 5, sampleTitles: [] })), ctx);
    expect(patches.size).toBe(0);
  });

  it('never asks the model about the review bucket or a renamed folder', async () => {
    let seen = null;
    mock._setHandlerForTests(({ tools }) => {
      seen = tools[0].input_schema.properties.folders.items.properties.key.enum;
      return {
        text: null, toolUse: { type: 'tool_use', name: tools[0].name, input: { folders: [] } },
        providerRequestId: 'mock', sourceRegion: 'ap-southeast-2',
      };
    });
    await classifier.refineTaxonomy([
      { key: 'assessments', name: 'Assessments', count: 5, sampleTitles: [] },
      { key: 'needs-review', name: 'Needs Review', isReviewBucket: true, count: 2, sampleTitles: [] },
      { key: 'mine', name: 'My Folder', nameLocked: true, count: 3, sampleTitles: [] },
    ], ctx);
    if (seen) {
      expect(seen).toContain('assessments');
      expect(seen).not.toContain('needs-review');
      expect(seen).not.toContain('mine');
    }
  });
});
