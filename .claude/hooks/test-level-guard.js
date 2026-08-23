#!/usr/bin/env node
'use strict';

/**
 * PreToolUse guard — keeps FAST and FEATURE tasks off the complete suites.
 *
 * Registered from the `hooks:` frontmatter of .claude/skills/opal-fast-change
 * and .claude/skills/opal-feature, so it is only live while one of those two
 * skills is running. CRITICAL and RELEASE register nothing and are unaffected.
 *
 *   node .claude/hooks/test-level-guard.js <FAST|FEATURE>
 *
 * Reads the PreToolUse payload on stdin. Denies a Bash command only when it
 * invokes one of this project's known complete-suite runners with no test
 * selector. A targeted invocation of the same runner is always allowed.
 *
 * Escape hatch for an explicit user override of the level:
 *   OPAL_ALLOW_FULL_SUITE=1 npm test
 */

const LEVEL = (process.argv[2] || 'FEATURE').toUpperCase();

// backend/package.json + root package.json scripts that run a complete suite.
const SUITE_SCRIPTS = {
  'test': 'the complete backend unit suite (jest --config jest.config.js)',
  'test:integration': 'the complete integration suite against real Postgres',
  'test:all': 'the RELEASE gate — complete unit + integration suite',
  'test:e2e': 'the complete Playwright E2E suite',
  'test:e2e:headed': 'the complete Playwright E2E suite',
  'test:e2e:local': 'the complete Playwright E2E suite',
};
// test:all chains two suites with &&; a trailing selector reaches neither.
const NEVER_TARGETABLE = new Set(['test:all']);

const RUNNERS = new Set(['jest', 'playwright']);
const PKG_MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun']);

// Flags that consume the next token as their value (jest + playwright).
const VALUE_FLAGS = new Set([
  '-c', '--config', '-w', '--maxWorkers', '--max-workers', '--rootDir',
  '--testTimeout', '--timeout', '--reporters', '--reporter', '--outputFile',
  '--coverageDirectory', '--collectCoverageFrom', '--selectProjects',
  '--shard', '--maxConcurrency', '--globalSetup', '--globalTeardown',
  '--testEnvironment', '--cacheDirectory', '--testPathIgnorePatterns',
  '--testMatch', '--testRegex', '--runner', '--moduleNameMapper', '--seed',
  '--workerIdleMemoryLimit', '--project', '-j', '--workers', '--retries',
  '--output', '--max-failures', '--repeat-each', '--grep-invert',
]);

// Flags that are themselves a test selector.
const SELECTOR_FLAGS = new Set([
  '-t', '--testNamePattern', '--testPathPattern', '--testPathPatterns',
  '--findRelatedTests', '--runTestsByPath', '--onlyChanged', '-o',
  '--changedSince', '--lastCommit', '--grep', '-g',
]);
const SELECTOR_VALUE_FLAGS = new Set([
  '-t', '--testNamePattern', '--testPathPattern', '--testPathPatterns',
  '--changedSince', '--grep', '-g',
]);

// Flags that only report configuration — never actually run a suite.
const INFO_FLAGS = new Set([
  '--listTests', '--showConfig', '--help', '-h', '--version', '-v', '--init',
  '--clearCache', '--list-files',
]);

// Segments that only mention a command rather than run one.
const INERT_HEADS = new Set([
  'echo', 'printf', 'cat', 'grep', 'rg', 'sed', 'awk', 'head', 'tail', 'less',
  '#', ':',
]);

function tokenise(segment) {
  const out = [];
  let cur = '';
  let quote = null;
  let started = false;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if (quote) {
      if (ch === quote) quote = null;
      else { cur += ch; started = true; }
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started) { out.push(cur); cur = ''; started = false; }
      continue;
    }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

function splitSegments(command) {
  return command
    .split(/\n|&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Does this argument list select specific tests? */
function classifyArgs(args) {
  let selector = false;
  let info = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--') continue;
    const flag = arg.startsWith('-') ? arg.split('=')[0] : null;
    if (flag) {
      if (INFO_FLAGS.has(flag)) info = true;
      if (SELECTOR_FLAGS.has(flag)) selector = true;
      if (!arg.includes('=') && (VALUE_FLAGS.has(flag) || SELECTOR_VALUE_FLAGS.has(flag))) i += 1;
      continue;
    }
    // A bare positional is a jest/playwright test path or pattern.
    selector = true;
  }
  return { selector, info };
}

/**
 * @returns {null | {what: string, command: string}} what is being run in full
 */
function inspectSegment(segment) {
  let tokens = tokenise(segment);
  // Strip leading environment assignments: DB_NAME=x npm run ...
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
    if (tokens[0].startsWith('OPAL_ALLOW_FULL_SUITE=')) return null; // explicit override
    tokens = tokens.slice(1);
  }
  if (!tokens.length) return null;

  let head = tokens[0].split('/').pop();
  if (INERT_HEADS.has(head)) return null;

  let rest = tokens.slice(1);

  if (head === 'npx' || head === 'pnpx' || head === 'bunx') {
    while (rest.length && rest[0].startsWith('-')) rest = rest.slice(1);
    if (!rest.length) return null;
    head = rest[0].split('/').pop();
    rest = rest.slice(1);
  }

  if (PKG_MANAGERS.has(head)) {
    let script = null;
    if (rest[0] === 'run' || rest[0] === 'run-script') { script = rest[1]; rest = rest.slice(2); }
    else if (rest[0] === 'test') { script = 'test'; rest = rest.slice(1); }
    if (!script || !(script in SUITE_SCRIPTS)) return null;
    if (NEVER_TARGETABLE.has(script)) {
      return { what: SUITE_SCRIPTS[script], command: segment.trim() };
    }
    const dashDash = rest.indexOf('--');
    const passthrough = dashDash === -1 ? [] : rest.slice(dashDash + 1);
    const { selector, info } = classifyArgs(passthrough);
    if (selector || info) return null;
    return { what: SUITE_SCRIPTS[script], command: segment.trim() };
  }

  if (RUNNERS.has(head)) {
    if (head === 'playwright') {
      if (rest[0] !== 'test') return null;
      rest = rest.slice(1);
    }
    const { selector, info } = classifyArgs(rest);
    if (selector || info) return null;
    const what = head === 'playwright'
      ? 'the complete Playwright E2E suite'
      : 'every jest test the config matches — the complete suite';
    return { what, command: segment.trim() };
  }

  return null;
}

function deny(hit) {
  const targeted = LEVEL === 'FAST'
    ? 'npx jest tests/<affected>.test.js'
    : 'npx jest tests/<affected>.test.js  ·  npx jest --config jest.integration.config.js tests/integration/<affected>.itest.js --runInBand';
  const reason = [
    `Blocked by the ${LEVEL} execution level: \`${hit.command}\` runs ${hit.what}.`,
    '',
    'Full-suite validation is reserved for CRITICAL/RELEASE. Select the directly',
    `affected tests for this ${LEVEL} task.`,
    '',
    `Run instead (from backend/):  ${targeted}`,
    '',
    'Not a reason to run the complete suite: a baseline before implementing, a',
    'sweep after implementing, "just to be safe", targeted tests already passing,',
    'or a change that feels structurally broad. Escalate to /opal-critical if the',
    'risk is genuinely high, or defer complete regression to /opal-release.',
    '',
    'If the user has explicitly overridden the level, re-run the command prefixed',
    'with OPAL_ALLOW_FULL_SUITE=1.',
  ].join('\n');

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
    systemMessage: `${LEVEL} level: blocked complete-suite command \`${hit.command}\`.`,
  }));
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { raw += chunk; });
process.stdin.on('end', () => {
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  if (payload.tool_name !== 'Bash') process.exit(0);
  const command = payload.tool_input && payload.tool_input.command;
  if (typeof command !== 'string' || !command.trim()) process.exit(0);
  for (const segment of splitSegments(command)) {
    const hit = inspectSegment(segment);
    if (hit) deny(hit);
  }
  process.exit(0);
});
