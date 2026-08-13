'use strict';

/**
 * TEMPORARY — delete alongside the staging diagnostic it guards.
 *
 * The diagnostic exists to name the failing federation stage. It runs on a
 * clinical path, so the thing that matters is not that it works but that it
 * cannot carry anything it should not: a prompt, a completion, a token, a
 * credential, a header, or a URL.
 *
 * These tests assert on the ALLOWLIST rather than on a denylist of known-bad
 * strings, because a denylist only catches the leaks somebody already thought
 * of.
 */

const fs = require('fs');
const path = require('path');

const PROVIDER = path.join(__dirname, '..', 'ai', 'providers', 'bedrock-provider.js');
const src = fs.readFileSync(PROVIDER, 'utf8');

/** Comments explain what is NOT read, so they must not fail a leak check. */
const stripComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n')
  .replace(/\/\/.*$/gm, '');

/** The diagnose() function body, isolated from the rest of the module. */
function diagnoseSource() {
  const start = src.indexOf('function diagnose(');
  expect(start).toBeGreaterThan(-1);
  // Ends at the next top-level declaration.
  const end = src.indexOf('\nlet _client', start);
  expect(end).toBeGreaterThan(start);
  return stripComments(src.slice(start, end));
}

describe('the diagnostic reads only allowlisted fields', () => {
  test('it never reads an error message', () => {
    const body = diagnoseSource();
    // An AWS error message quotes the role ARN, the account id and often the
    // resource. It is the single most likely leak and must never be read.
    expect(body).not.toMatch(/err\??\.message/);
    expect(body).not.toMatch(/error\??\.message/);
  });

  test('it never reads a body, prompt, completion or header collection', () => {
    const body = diagnoseSource();
    for (const forbidden of [
      'messages', 'transcript', 'content', 'prompt', 'system',
      'body', 'response.data', 'stack', 'config', 'url', 'URL',
    ]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test('it requests only the two agreed headers, and cannot enumerate', () => {
    // Every header read goes through headerValue(headers, '<literal name>'),
    // so the set of literals IS the set of headers this can ever see.
    const block = src.slice(src.indexOf('function headerValue('), src.indexOf('\nlet _client'));
    const requested = [...block.matchAll(/headerValue\([^,]+,\s*'([^']+)'\)/g)].map((m) => m[1]);
    expect(requested.length).toBeGreaterThan(0);
    expect(new Set(requested)).toEqual(new Set(['x-amzn-errortype', 'x-amzn-requestid']));

    // No iteration over the header collection — that would defeat the
    // allowlist by pulling in authorization or cookie headers.
    for (const forbidden of ['forEach', 'entries()', 'keys()', 'for (', 'Object.']) {
      expect(block).not.toContain(forbidden);
    }
  });

  test('the header reader itself leaks nothing', () => {
    const reader = src.slice(src.indexOf('function headerValue('), src.indexOf('function diagnose('));
    expect(reader).not.toMatch(/err\??\.message/);
    // Returns a single string or null — never the collection it was handed.
    expect(reader).toMatch(/return typeof raw === 'string' && raw \? raw : null;/);
  });

  test('every emitted field is bounded and typed', () => {
    const body = diagnoseSource();
    // An unbounded string could carry a whole payload if a future error shape
    // put one in `reason`.
    expect(body).toMatch(/\.slice\(0,\s*120\)/);
    // Each read is type-guarded, so a non-string object can never be spread
    // into the record.
    expect(body).toMatch(/typeof/);
  });
});

describe('the emitted record has a fixed four-field shape', () => {
  // Reproduces diagnose()'s contract without importing the module, which would
  // pull in the AI SDK.
  const EXPECTED_KEYS = ['stage', 'code', 'status', 'requestId'];

  test('the returned object declares exactly the agreed keys', () => {
    const body = diagnoseSource();
    const returned = body.slice(body.indexOf('return {'));
    // `status` is written as an ES6 shorthand property, so accept either form.
    for (const key of EXPECTED_KEYS) {
      expect(returned).toMatch(new RegExp(`\\b${key}\\s*[:,]`));
    }
    // Nothing else. A spread would defeat the whole allowlist.
    expect(returned).not.toMatch(/\.\.\./);
  });

  test('the log line is built from the record, not from the error', () => {
    const warn = src.slice(src.indexOf('[bedrock-diag]'));
    const line = warn.slice(0, warn.indexOf('\n'));
    expect(line).toMatch(/\{\s*region,\s*\.\.\.d\s*\}/);
    expect(line).not.toMatch(/err/);
  });
});

describe('the caller contract is unchanged', () => {
  test('a guardrail intervention still short-circuits before diagnosis', () => {
    const idx = src.indexOf("if (err?.message === 'guardrail_intervened') throw err;");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(src.indexOf('const d = diagnose('));
  });

  test('the thrown error is still provider_error', () => {
    expect(src).toMatch(/const failure = new Error\('provider_error'\)/);
  });
});

describe('the mobile route exposes the record and nothing more', () => {
  const mobileSrc = fs.readFileSync(path.join(__dirname, '..', 'mobile-routes.js'), 'utf8');
  const handler = mobileSrc.slice(mobileSrc.indexOf("router.post('/api/mobile/ai/case-note'"));
  const body = handler.slice(0, handler.indexOf('}));'));

  test('it returns the prebuilt diagnostic, never the error itself', () => {
    expect(body).toMatch(/diagnostic:\s*\(err && err\.diagnostic\) \|\| null/);
    expect(body).not.toMatch(/err\.message.*res\.json/);
    expect(body).not.toMatch(/err\.reason/);
  });

  test('the success path is untouched by the diagnostic', () => {
    // The diagnostic must appear only in the failure branch — a draft response
    // carrying provider internals would ship them to the phone. The catch
    // block precedes the success response, so everything from the first
    // success field onward must be free of it.
    const success = body.slice(body.indexOf('identify'));
    expect(success).not.toContain('diagnostic');
  });

  test('the diagnostic sits inside the 502 branch', () => {
    const failure = body.slice(body.indexOf('res.status(502)'));
    expect(failure.slice(0, failure.indexOf('});'))).toContain('diagnostic:');
  });
});
