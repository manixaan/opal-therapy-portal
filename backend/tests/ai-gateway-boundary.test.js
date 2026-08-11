'use strict';

/**
 * THE BOUNDARY TEST — the structural guarantee behind the AI gateway.
 *
 * Everything else in this system is a convention that holds while people
 * remember it. This test is what makes "no feature may call an AI vendor
 * directly" a build failure instead of a code-review hope.
 *
 * It scans the backend source for AI SDK imports, vendor endpoints and raw
 * model identifiers, and fails if any appear outside the small set of files
 * permitted to contain them. The failure it prevents is specific and
 * plausible: someone adds AI to the FCA module next month, reaches for the
 * Anthropic SDK because that is what the docs show, and quietly creates a
 * path from clinical data to a US endpoint that no reviewer notices.
 *
 * Needles are assembled from fragments so this file does not match itself.
 * The tests directory is excluded from the scan as well, but relying on only
 * one of those would be fragile.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');

/** Only these files may import an AI SDK or name a vendor endpoint. */
const PROVIDER_ALLOWLIST = [
  path.join('ai', 'providers', 'bedrock-provider.js'),
  path.join('ai', 'providers', 'mock-provider.js'),
];

/** Only this file may contain raw model identifiers. */
const MODEL_ID_ALLOWLIST = [
  path.join('ai', 'ai-model-registry.js'),
];

const SKIP_DIRS = new Set(['node_modules', 'tests', '.git', 'coverage', 'uploads', 'templates']);

// Assembled from fragments — see the module note.
const AT = '@';
const SDK_NEEDLES = [
  `${AT}anthropic-ai/sdk`,
  `${AT}anthropic-ai/bedrock-sdk`,
  `${AT}aws-sdk/client-bedrock-runtime`,
  `${AT}google/generative-ai`,
  "require('openai')",
  'require("openai")',
  "from 'openai'",
];

const ENDPOINT_NEEDLES = [
  `api.${'anthropic'}.com`,
  `api.${'openai'}.com`,
  `${'bedrock'}-runtime.`,
  `${'bedrock'}-mantle.`,
  'generativelanguage.googleapis.com',
];

/**
 * Raw model ids. Deliberately broad — `claude-` catches a bare model string
 * anywhere, which is the thing that should only ever live in the registry.
 */
const MODEL_NEEDLES = [
  `${'au'}.anthropic.claude`,
  `${'global'}.anthropic.claude`,
  `${'apac'}.anthropic.claude`,
  `${'us'}.anthropic.claude`,
  `${'eu'}.anthropic.claude`,
  `${'claude'}-sonnet-`,
  `${'claude'}-opus-`,
  `${'claude'}-haiku-`,
  `${'claude'}-fable-`,
  `${'claude'}-mythos-`,
];

/**
 * Broad vendor terms. Applied to CODE ONLY — comments are stripped first.
 *
 * That distinction is what makes a guard this blunt usable. A file must be
 * able to explain the boundary in prose ("this used to call the Anthropic
 * API in the US") without failing the build, while `const model = "claude"`
 * in a feature module must fail. Without stripping, the project's own path
 * (…/Documents/Claude/Projects/…) appearing in a header comment would flag
 * unrelated setup scripts.
 */
const BROAD_TERMS = ['anthropic', 'openai', 'bedrock', 'claude', 'gemini'];

/** Everything under this directory owns the AI boundary and may name vendors. */
const AI_DIR = 'ai';

/**
 * Remove block comments, line comments and string-delimited URLs' scheme
 * noise. Deliberately simple: it over-strips rather than under-strips, and
 * over-stripping only risks a missed detection in code that also happens to
 * look like a comment, which is not a realistic way to smuggle in an SDK.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

/**
 * Extract string literals. The broad scan runs over these rather than over all
 * code, because a vendor name reaches a model only through a literal — an
 * import path, an endpoint, a model id.
 *
 * Referencing an exported constant (`registry.PROVIDER_BEDROCK`) is the
 * opposite of a boundary violation: it means the file is deferring to the
 * registry instead of hard-coding. Flagging that would push authors toward
 * inlining the literal, which is exactly the behaviour this guard exists to
 * prevent.
 */
function stringLiterals(code) {
  const matches = code.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g);
  return (matches || []).join('\n');
}

/**
 * Remove require() specifiers that point INTO backend/ai.
 *
 * `require('./ai/ai-bedrock-config')` is a feature module doing precisely what
 * the boundary asks of it — going through the gateway's directory instead of
 * reaching for an SDK. The broad scan would otherwise read the word 'bedrock'
 * in that path as a vendor reference and fail the build for compliance.
 *
 * The rewrite is narrow on purpose: only relative paths resolving into the ai
 * directory, and only inside a require() call. `require('@anthropic-ai/sdk')`
 * is untouched and still fails, as does any bare literal containing a vendor
 * name. Verified by a test below.
 */
function stripAiModuleRequires(code) {
  return code.replace(
    /require\(\s*(['"`])(?:\.\.?\/)+ai\/[^'"`]+\1\s*\)/g,
    'require(AI_MODULE)',
  );
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, acc);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      acc.push(full);
    }
  }
  return acc;
}

function scan(needles, allowlist) {
  const offenders = [];
  for (const file of walk(BACKEND)) {
    const rel = path.relative(BACKEND, file);
    if (allowlist.includes(rel)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const needle of needles) {
      if (source.includes(needle)) offenders.push(`${rel} → ${needle}`);
    }
  }
  return offenders;
}

test('no AI SDK is imported outside the approved provider files', () => {
  const offenders = scan(SDK_NEEDLES, PROVIDER_ALLOWLIST);
  expect(offenders).toEqual([]);
});

test('no vendor endpoint is referenced outside the approved provider files', () => {
  // This is what stops a feature reaching api.anthropic.com — i.e. the US —
  // regardless of what the gateway would have decided.
  const offenders = scan(ENDPOINT_NEEDLES, PROVIDER_ALLOWLIST);
  expect(offenders).toEqual([]);
});

test('no raw model identifier appears outside the model registry', () => {
  // Model ids scattered through the codebase are how a `global.` or `apac.`
  // profile eventually gets pasted in from a blog post. One file, one place
  // to review, one place to change when a new Claude generation ships.
  const offenders = scan(MODEL_NEEDLES, MODEL_ID_ALLOWLIST);
  expect(offenders).toEqual([]);
});

test('the scan actually reaches the feature modules it is meant to protect', () => {
  // A scanner that silently walks nothing passes every assertion above. This
  // asserts the walk covers the real AI entry points and the future ones.
  const scanned = walk(BACKEND).map((f) => path.relative(BACKEND, f));

  expect(scanned).toContain('clinical-note-provider.js');
  expect(scanned).toContain('opa-provider.js');
  expect(scanned).toContain(path.join('ai', 'ai-gateway.js'));
  expect(scanned.length).toBeGreaterThan(20);

  // And the allowlisted provider files must exist — an allowlist entry for a
  // deleted file would silently widen the boundary.
  for (const rel of [...PROVIDER_ALLOWLIST, ...MODEL_ID_ALLOWLIST]) {
    expect(fs.existsSync(path.join(BACKEND, rel))).toBe(true);
  }
});

test('no vendor term appears in code outside backend/ai', () => {
  // The catch-all. The three scans above name specific SDKs, endpoints and
  // model ids; this one catches the shapes nobody anticipated — a new vendor,
  // a renamed package, a model id typed from memory. If a feature module has
  // any business naming an AI vendor in executable code, that is the moment
  // to ask why it is not going through the gateway.
  const offenders = [];
  for (const file of walk(BACKEND)) {
    const rel = path.relative(BACKEND, file);
    if (rel.split(path.sep)[0] === AI_DIR) continue;
    const code = stripAiModuleRequires(stripComments(fs.readFileSync(file, 'utf8')));
    const literals = stringLiterals(code).toLowerCase();
    for (const term of BROAD_TERMS) {
      if (literals.includes(term)) offenders.push(`${rel} → ${term}`);
    }
  }
  expect(offenders).toEqual([]);
});

test('the require exemption is narrow — only paths into backend/ai', () => {
  // The exemption above is the one place this guard was deliberately loosened,
  // so its edges are asserted directly rather than assumed.
  const permitted = stripAiModuleRequires("const c = require('./ai/ai-bedrock-config');");
  expect(stringLiterals(permitted).toLowerCase()).not.toContain('bedrock');

  const nested = stripAiModuleRequires("const c = require('../ai/providers/bedrock-provider');");
  expect(stringLiterals(nested).toLowerCase()).not.toContain('bedrock');

  // An actual SDK import is NOT exempted.
  const sdk = stripAiModuleRequires(`const a = require('${AT}anthropic-ai/bedrock-sdk');`);
  expect(stringLiterals(sdk).toLowerCase()).toContain('anthropic');

  // Nor is a vendor path that merely looks similar.
  const lookalike = stripAiModuleRequires("const x = require('./ai-bedrock-shim');");
  expect(stringLiterals(lookalike).toLowerCase()).toContain('bedrock');

  // Nor is a bare literal outside a require.
  const literal = stripAiModuleRequires('const endpoint = "./ai/bedrock";');
  expect(stringLiterals(literal).toLowerCase()).toContain('bedrock');
});

test('the broad scan catches literals but not registry references', () => {
  // The distinction the guard turns on, asserted directly.
  const violation = stringLiterals(stripComments('const model = "claude-opus-4-8";')).toLowerCase();
  expect(violation).toContain('claude');

  const deferring = stringLiterals(stripComments('provider: registry.PROVIDER_BEDROCK,')).toLowerCase();
  expect(deferring).not.toContain('bedrock');

  const importPath = stringLiterals(stripComments("require('@anthropic-ai/sdk');")).toLowerCase();
  expect(importPath).toContain('anthropic');
});

test('stripComments does not blind the scan to real code', () => {
  // A stripper that removed too much would make the test above vacuous.
  const sample = `
    // this comment mentions anthropic and should be ignored
    /* so does this block, mentioning bedrock */
    const model = "claude-opus-4-8";
  `;
  const code = stripComments(sample).toLowerCase();
  expect(code).not.toContain('this comment mentions');
  expect(code).not.toContain('so does this block');
  expect(code).toContain('claude-opus-4-8');
});

test('the allowlist is as small as it looks', () => {
  // Guards against the allowlist quietly growing. Widening it is a
  // governance decision and should require editing this expectation.
  expect(PROVIDER_ALLOWLIST).toHaveLength(2);
  expect(MODEL_ID_ALLOWLIST).toHaveLength(1);
});
