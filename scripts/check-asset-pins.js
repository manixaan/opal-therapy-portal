#!/usr/bin/env node
'use strict';

/**
 * ASSET PIN CHECK — run this before you commit.
 *
 *   node scripts/check-asset-pins.js            # check what is STAGED (default)
 *   node scripts/check-asset-pins.js --worktree # check the working tree instead
 *
 * WHAT IT CATCHES
 * backend/tests/assessment-surface-guards.test.js pins a cache-bust version
 * for each front-end asset and asserts it against frontend/current/mockup_v3.html.
 * The guard is right to exist: the Azure staging proxy does not revalidate, so
 * a stale bundle there serves old JavaScript against a new API.
 *
 * The trap is that several sessions edit both files at once. Someone bumps an
 * asset in the WORKING TREE; someone else commits the guard with a blanket
 * `git add`. The commit then asserts a version for a shell that was never
 * committed, and CI fails on a file that only exists in a working copy. That
 * has happened three times on this repository in a single day.
 *
 * The fix is to compare the two blobs that will ACTUALLY be committed —
 * staged guard against staged shell — rather than either against the working
 * tree. That is what this does. A file with nothing staged is read from HEAD,
 * which is exactly what a commit of the other file alone would ship.
 *
 * Exits 0 when every pin matches, 1 when any does not (so it drops straight
 * into a pre-commit hook or a shell one-liner).
 */

const { execFileSync } = require('child_process');
const path = require('path');

const GUARD = 'backend/tests/assessment-surface-guards.test.js';
const SHELL = 'frontend/current/mockup_v3.html';
const REPO = path.join(__dirname, '..');

const worktree = process.argv.includes('--worktree');

function git(args) {
  return execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The content that a commit right now would contain: the staged blob when
 * there is one, otherwise HEAD's. Reading the working tree instead is the
 * mistake this script exists to prevent.
 */
function contentToBeCommitted(file) {
  if (worktree) return require('fs').readFileSync(path.join(REPO, file), 'utf8');
  const staged = git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean);
  return git(['show', `${staged.includes(file) ? '' : 'HEAD'}:${file}`]);
}

/** The [file, version] pairs the guard asserts. */
function pinsFrom(guardSrc) {
  const start = guardSrc.indexOf('for (const [file, version] of [');
  if (start === -1) return null;
  const block = guardSrc.slice(start, guardSrc.indexOf(']) {', start));
  return [...block.matchAll(/\['([^']+)',\s*'?([A-Za-z0-9]+)'?\]/g)].map((m) => [m[1], m[2]]);
}

const guard = contentToBeCommitted(GUARD);
const shell = contentToBeCommitted(SHELL);
const pins = pinsFrom(guard);

if (!pins) {
  console.error(`Could not find the pin list in ${GUARD}. Has the guard been restructured?`);
  process.exit(2);
}

const source = worktree ? 'working tree' : 'staged (falling back to HEAD)';
console.log(`Asset pins — ${source}\n`);

const bad = [];
for (const [file, version] of pins) {
  const attr = file.endsWith('.css') ? 'href' : 'src';
  const ok = shell.includes(`${attr}="/${file}?v=${version}"`);
  if (!ok) {
    const actual = (shell.match(new RegExp(`/${file.replace('.', '\\.')}\\?v=([A-Za-z0-9]+)`)) || [])[1];
    bad.push({ file, version, actual });
  }
  console.log(`  ${ok ? 'ok  ' : 'MISS'} ${file} = ${version}`);
}

if (!bad.length) {
  console.log('\nEvery pin matches the shell this commit would ship.');
  process.exit(0);
}

console.error('\nThese pins do not match the shell this commit would ship:');
for (const b of bad) {
  console.error(`  ${b.file}: the guard expects ${b.version}, the shell has ${b.actual || '(no pin at all)'}`);
}
console.error(`
A pin must describe what THIS commit ships. If the bump belongs to another
session's uncommitted work, leave the guard on the committed version and let
that session move it when they commit their asset and the shell together.
Stage the guard deliberately — a blanket 'git add' is how this breaks.`);
process.exit(1);
