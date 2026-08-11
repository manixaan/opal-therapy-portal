'use strict';

/**
 * Guards for the consolidation: one config owner, one gateway, no defaults.
 *
 * These pin the properties the cleanup was for, rather than the behaviour of
 * any one module. Most are static — they read the shipped source — because the
 * failures they catch are structural: a second config module reappearing, a
 * literal profile id creeping back, a helpful default being restored.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');
const AI_DIR = path.join(BACKEND, 'ai');

const read = (p) => fs.readFileSync(p, 'utf8');
const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/** Every .js under backend/, excluding node_modules and tests. */
function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'tests' || e.name === 'coverage') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) out.push(full);
    }
  };
  walk(BACKEND);
  return out;
}

// ── One configuration owner ─────────────────────────────────────────────────

describe('exactly one Bedrock configuration owner', () => {
  test('ai/aws/bedrock-config.js exists and owns all six settings', () => {
    const src = read(path.join(AI_DIR, 'aws', 'bedrock-config.js'));
    for (const name of [
      'AWS_ROLE_ARN', 'AZURE_BEDROCK_AUDIENCE', 'AWS_REGION',
      'BEDROCK_MODEL_ID', 'BEDROCK_GUARDRAIL_ID', 'BEDROCK_GUARDRAIL_VERSION',
    ]) {
      expect(src).toContain(name);
    }
  });

  test('the second config module is gone and nothing imports it', () => {
    expect(fs.existsSync(path.join(AI_DIR, 'ai-bedrock-config.js'))).toBe(false);
    for (const f of sourceFiles()) {
      expect(strip(read(f))).not.toMatch(/require\([^)]*ai-bedrock-config[^)]*\)/);
    }
  });

  test('no module outside the owner reads a Bedrock setting directly', () => {
    // Otherwise the validation rules live in one place and the reads live in
    // another, which is how the two modules drifted in the first place.
    const owner = path.join(AI_DIR, 'aws', 'bedrock-config.js');
    for (const f of sourceFiles()) {
      if (f === owner) continue;
      const src = strip(read(f));
      expect(src).not.toMatch(/process\.env\.BEDROCK_(MODEL_ID|GUARDRAIL_ID|GUARDRAIL_VERSION)/);
      expect(src).not.toMatch(/process\.env\.AWS_ROLE_ARN/);
      expect(src).not.toMatch(/process\.env\.AZURE_BEDROCK_AUDIENCE/);
    }
  });
});

// ── No default region ───────────────────────────────────────────────────────

describe('region is required, with no default', () => {
  const config = require('../ai/aws/bedrock-config');
  let saved;
  beforeEach(() => { saved = process.env.AWS_REGION; });
  afterEach(() => {
    if (saved === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = saved;
  });

  test('an absent region refuses rather than choosing one', () => {
    delete process.env.AWS_REGION;
    expect(config.resolveRegion()).toMatchObject({ ok: false, reason: 'region_not_configured' });
  });

  test('AI_AWS_REGION is gone from the source entirely', () => {
    for (const f of sourceFiles()) {
      expect(strip(read(f))).not.toContain('AI_AWS_REGION');
    }
  });

  test('no module hardcodes an AWS region as a fallback', () => {
    // ALLOWED_REGIONS in the owner is an allowlist, not a default, so the owner
    // is exempt. Anywhere else, a literal region string is a default waiting to
    // be used.
    const owner = path.join(AI_DIR, 'aws', 'bedrock-config.js');
    for (const f of sourceFiles()) {
      if (f === owner) continue;
      const src = strip(read(f));
      expect(src).not.toMatch(/['"`]ap-southeast-[24]['"`]\s*[;,)\]]/);
    }
  });

  test.each(['us-east-1', 'eu-west-1', 'ap-southeast-1'])('%s is refused', (region) => {
    process.env.AWS_REGION = region;
    expect(config.resolveRegion()).toMatchObject({ ok: false, reason: 'region_not_permitted' });
  });
});

// ── No hardcoded model id ───────────────────────────────────────────────────

describe('no Bedrock model id is written in source', () => {
  const registry = require('../ai/ai-model-registry');

  test('every Bedrock registry entry carries a null id', () => {
    for (const key of registry.keys()) {
      const model = registry.get(key);
      if (model.provider !== registry.PROVIDER_BEDROCK) continue;
      expect(model.id).toBeNull();
    }
  });

  test('no source file contains an au. profile literal outside the blocklist', () => {
    // PERMANENTLY_BLOCKED names ids in order to EXCLUDE them; that is the
    // opposite of selecting one, and it must stay.
    const registrySrc = path.join(AI_DIR, 'ai-model-registry.js');
    for (const f of sourceFiles()) {
      const src = strip(read(f));
      const hits = src.match(/['"`]au\.anthropic\.[a-z0-9.-]+['"`]/g) || [];
      if (!hits.length) continue;
      expect(f).toBe(registrySrc);
      // In the registry the only permitted occurrences are inside the blocklist.
      const blocked = strip(read(registrySrc)).slice(
        strip(read(registrySrc)).indexOf('PERMANENTLY_BLOCKED'),
      );
      for (const h of hits) expect(blocked).toContain(h);
    }
  });

  test('the mock model keeps its own id — it is not a Bedrock profile', () => {
    expect(registry.get('mock').id).toBe('mock-model');
    expect(registry.get('mock').provider).toBe(registry.PROVIDER_MOCK);
  });
});

// ── One gateway for both clients ────────────────────────────────────────────

describe('the website and the iOS app share one path', () => {
  const mobileSrc = strip(read(path.join(BACKEND, 'mobile-routes.js')));

  test('the mobile AI route delegates to the same provider the website uses', () => {
    expect(mobileSrc).toMatch(/require\('\.\/clinical-note-provider'\)/);
    expect(mobileSrc).toMatch(/noteProvider\.generateCaseNote\(/);
  });

  test('the mobile route never reaches the gateway, a provider or AWS directly', () => {
    // A second entry point would be a second set of policy decisions.
    expect(mobileSrc).not.toMatch(/require\([^)]*ai-gateway[^)]*\)/);
    expect(mobileSrc).not.toMatch(/require\([^)]*providers\/[^)]*\)/);
    expect(mobileSrc).not.toMatch(/require\([^)]*aws\/[^)]*\)/);
    expect(mobileSrc).not.toMatch(/bedrock/i);
  });

  test('the endpoint is authenticated, rate limited and size capped', () => {
    expect(mobileSrc).toMatch(/router\.use\('\/api\/mobile', requireAuth\)/);
    expect(mobileSrc).toMatch(/router\.post\('\/api\/mobile\/ai\/case-note', mobileAiRateLimit/);
    expect(mobileSrc).toMatch(/MAX_TRANSCRIPT_CHARS/);
    expect(mobileSrc).toMatch(/status\(413\)/);
  });

  test('the response never carries the resolved inference profile id', () => {
    const handler = mobileSrc.slice(mobileSrc.indexOf("router.post('/api/mobile/ai/case-note'"));
    const body = handler.slice(0, handler.indexOf('}));'));
    expect(body).not.toMatch(/providerIdentity\(\)/);
    expect(body).not.toMatch(/modelId/);
  });

  test('every downstream failure returns one generic shape', () => {
    const handler = mobileSrc.slice(mobileSrc.indexOf("router.post('/api/mobile/ai/case-note'"));
    const body = handler.slice(0, handler.indexOf('}));'));
    expect(body).toMatch(/status\(502\)/);
    // The reason must not travel to the phone.
    expect(body).not.toMatch(/err\.reason|err\.message.*res\.json/);
  });
});

// ── No direct Anthropic route, no static credentials ────────────────────────

describe('the only route out is federated Bedrock', () => {
  test('nothing calls the Anthropic API directly', () => {
    for (const f of sourceFiles()) {
      const src = strip(read(f));
      expect(src).not.toContain('api.anthropic.com');
      expect(src).not.toMatch(/['"]x-api-key['"]/);
      expect(src).not.toMatch(/process\.env\.ANTHROPIC_API_KEY/);
    }
  });

  test('no static AWS credential is read anywhere', () => {
    for (const f of sourceFiles()) {
      const src = strip(read(f));
      expect(src).not.toMatch(/AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|AWS_SESSION_TOKEN/);
    }
  });

  test('the AI SDK is imported in exactly one file', () => {
    const importers = sourceFiles().filter((f) => /@anthropic-ai\//.test(strip(read(f))));
    expect(importers.map((f) => path.relative(BACKEND, f)))
      .toEqual(['ai/providers/bedrock-provider.js']);
  });
});
