'use strict';

/**
 * Nothing this repository ships may carry a client's identity or the location of
 * the source vault.
 *
 * The Resource Hub work reads a vault of real clinical files, some of which are
 * client records. Every stage has its own redaction — the scanner drops identity
 * before it writes, `build-resource-catalogue.js` drops it again, migration 030
 * makes it a CHECK constraint. This test asks the question none of those can:
 * *did anything leak out sideways, into a file we commit?* A pasted debugging
 * manifest, a fixture copied from real data, a hard-coded path in a script —
 * none of those pass through the redaction layers at all.
 *
 * THIS TEST NEVER PRINTS WHAT IT FINDS
 * A privacy guard that reports a client's name in CI output has published it to
 * every build log, pull request and terminal scrollback that ever renders the
 * failure. So every assertion here is on a COUNT or a FILE PATH. When a derived
 * token matches, the report says which file and a short hash of the token; it
 * never says the token. Reading the file is then a deliberate human act, not a
 * side effect of running the suite.
 *
 * WHAT IS TOLERATED, AND WHY
 * Three different tolerances, because three different things are being asked:
 *
 *   1. Client identity — checked in every scanned file, tests included, with no
 *      allowlist. The names are derived from the vault's own directory at
 *      runtime, so no list of them is kept anywhere, least of all in this file.
 *      What IS filtered is the derivation, not the check: see
 *      `deriveClientTokens` for which words are treated as vocabulary rather
 *      than identity, and what that costs.
 *   2. The vault's location in shipped text — allowlisted by file, and only for
 *      the handful that legitimately take the vault as an input or that document
 *      the rule against touching it. A new file naming the vault fails.
 *   3. Test fixtures — a test may name the vault or the client root, because
 *      naming the thing being refused is how a refusal is tested. What a test
 *      may never contain is a path that reaches INTO the client area of a real
 *      vault, and the token check still covers every test file in full.
 *
 * The vault root and client root are read out of `scan-resource-source.js`
 * rather than typed here, so this file holds no vault path of its own and the
 * guard tracks the scanner's own notion of where the vault is.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SELF = 'backend/tests/resource-privacy-leak.test.js';
const SCANNER = path.join(REPO_ROOT, 'backend', 'setup', 'scan-resource-source.js');

/**
 * Optional, never committed. One string per line, `#` for comments. It exists so
 * an operator who knows a specific name has leaked can check for it without
 * writing that name into the repository — which would be the leak.
 */
const BLOCKLIST_FILE = process.env.OPAL_PRIVACY_BLOCKLIST
  || path.join(__dirname, '.privacy-blocklist');

// ── Where the vault is, according to the scanner ─────────────────────────────

function scannerConstant(name) {
  const src = fs.readFileSync(SCANNER, 'utf8');
  const m = src.match(new RegExp(`const ${name} = '([^']+)'`));
  if (!m) throw new Error(`Could not read ${name} from scan-resource-source.js.`);
  return m[1];
}

const VAULT_ROOT = process.env.OPAL_RESOURCE_VAULT || scannerConstant('DEFAULT_SOURCE');
const VAULT_NAME = path.basename(VAULT_ROOT);
const CLIENT_ROOT = scannerConstant('CLIENT_ROOT');

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The vault directory name used as a path component.
 *
 * Deliberately not the bare name. This repository discusses the vault by name
 * constantly — that is governance documentation and is the opposite of a leak.
 * What must not appear is the vault as a LOCATION: something a program could
 * open, or a reader could follow to a real machine.
 */
const VAULT_PATH = new RegExp(
  `[~\\w.]/${escapeRe(VAULT_NAME)}|(?:^|[\\s'"\`(\\[])${escapeRe(VAULT_NAME)}/`, 'gm');

/**
 * A client-root path segment with a real component after it.
 *
 * The client root on its own is a denylist entry — the constant that performs
 * the exclusion — and the root followed by the redaction ellipsis is the marker
 * the scanner writes. Neither identifies anybody. The root followed by a real
 * path component is a route to somebody's material.
 */
const CLIENT_PATH = new RegExp(
  `(?:^|[^A-Za-z0-9_])${escapeRe(CLIENT_ROOT)}/(?![…\\s'"\`,;)\\]}]|$)`, 'gm');

/** An absolute vault path that continues into the client area. Never tolerated. */
const CLIENT_PATH_IN_VAULT = new RegExp(
  `${escapeRe(VAULT_NAME)}/[^\\s'"\`]*${escapeRe(CLIENT_ROOT)}/`, 'gm');

/**
 * Files permitted to name the vault as a location, and the reason each is.
 *
 * Allowlisted by NAME, not by occurrence count: the point of the ratchet is that
 * no NEW file starts hard-coding the vault, and pinning counts would turn every
 * unrelated edit to one of these files into a failure. Stale entries fail too —
 * a file that stops needing its exemption must lose it.
 */
const VAULT_PATH_ALLOWED = {
  'backend/setup/scan-resource-source.js':
    'The scanner. The vault root is its --source default: the one input it exists to read.',
  'backend/scripts/ingest-resource-files.js':
    'The bulk file importer. Same reason: the vault root is the input it walks.',
  'backend/resource-file-storage.js':
    'A comment recording which vault the governed storage root is deliberately NOT.',
  'backend/setup/ingest-resource-catalogue.js':
    'A comment recording that the importer has no filesystem call pointing at the vault.',
  'backend/setup/seed-opal-originals.js':
    'A comment recording that the seed data is authored, not lifted from the vault.',
  'docs/resource-hub/GOVERNANCE.md':
    'The governance document. It has to name the vault in order to state the rule about it.',
};

// ── The scan ────────────────────────────────────────────────────────────────

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', 'coverage', 'dist', 'build', '.next', '.cache',
]);

/** Reading a PNG as text proves nothing and costs a megabyte of string. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'pdf', 'zip',
  'docx', 'doc', 'xlsx', 'pptx', 'ppt', 'woff', 'woff2', 'ttf', 'otf', 'eot',
  'mp3', 'mp4', 'wav', 'mov', 'gz', 'tgz',
]);

/**
 * The committed text this repository ships or deploys.
 *
 * `backend/**\/*.js` is the code; the other roots are read whole because a
 * migration, a manifest, a stylesheet and a document are all just as capable of
 * carrying a name as a module is.
 */
const SCAN_ROOTS = [
  { dir: 'backend', accept: (rel) => rel.endsWith('.js') },
  { dir: 'backend/setup/manifests', accept: () => true },
  { dir: 'backend/migrations', accept: () => true },
  { dir: 'frontend/current', accept: () => true },
  { dir: 'docs', accept: () => true },
];

function walk(absDir, relDir, accept, into) {
  let entries;
  try {
    entries = fs.readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;                                   // a root that is absent is not a leak
  }
  for (const entry of entries) {
    // Never follow a symlink: backend/node_modules is one, and traversing it
    // would scan the whole dependency tree.
    if (entry.isSymbolicLink()) continue;
    const abs = path.join(absDir, entry.name);
    const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) walk(abs, rel, accept, into);
    } else if (entry.isFile() && accept(rel)) {
      into.add(rel);
    }
  }
}

function loadScannedFiles() {
  const paths = new Set();
  for (const root of SCAN_ROOTS) {
    walk(path.join(REPO_ROOT, root.dir), root.dir, root.accept, paths);
  }

  const blocklistRel = path.relative(REPO_ROOT, path.resolve(BLOCKLIST_FILE));
  const files = [];
  for (const rel of [...paths].sort()) {
    if (rel === SELF) continue;                       // this file describes the leak
    if (rel === blocklistRel) continue;               // as does the blocklist
    if (BINARY_EXTENSIONS.has(path.extname(rel).slice(1).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    files.push({
      rel,
      text,
      isTest: rel.startsWith('backend/tests/'),
      // Whole-word tokens, so `Jordan's` and `jordan-worksheet.pdf` both reduce
      // to `jordan` and neither `jordans` nor `jordanfile` false-matches it.
      words: new Set(text.toLowerCase().match(/[a-z]{4,}/g) || []),
    });
  }
  return files;
}

const FILES = loadScannedFiles();
const SHIPPED = FILES.filter((f) => !f.isTest);
const TESTS = FILES.filter((f) => f.isTest);

const countMatches = (text, re) => {
  re.lastIndex = 0;
  return (text.match(re) || []).length;
};

// ── Vault location ──────────────────────────────────────────────────────────

describe('the vault\'s location does not reach shipped text', () => {
  test('the guard knows where the vault is, and is not matching on nothing', () => {
    expect(VAULT_NAME.length).toBeGreaterThan(2);
    expect(CLIENT_ROOT.length).toBeGreaterThan(2);
    expect(SHIPPED.length).toBeGreaterThan(50);
  });

  test('no file outside the allowlist names the vault as a path', () => {
    const offenders = SHIPPED
      .filter((f) => !Object.prototype.hasOwnProperty.call(VAULT_PATH_ALLOWED, f.rel))
      .filter((f) => countMatches(f.text, VAULT_PATH) > 0)
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test('every allowlisted exemption is still earning it', () => {
    // A stale entry is a hole: it would silently absorb a future leak into a
    // file that no longer has any reason to mention the vault at all.
    const stale = Object.keys(VAULT_PATH_ALLOWED).filter((rel) => {
      const file = SHIPPED.find((f) => f.rel === rel);
      return !file || countMatches(file.text, VAULT_PATH) === 0;
    });
    expect(stale).toEqual([]);
  });

  test('every exemption states a reason', () => {
    for (const reason of Object.values(VAULT_PATH_ALLOWED)) {
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

// ── Client paths ────────────────────────────────────────────────────────────

describe('no client path segment reaches shipped text', () => {
  test('no shipped file contains a client-root path with a component after it', () => {
    const offenders = SHIPPED
      .filter((f) => countMatches(f.text, CLIENT_PATH) > 0)
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test('no file anywhere holds a vault path that reaches into the client area', () => {
    // A test may name the vault, and a test may name the client root. Joining
    // the two produces a path to somebody's records, and nothing justifies that.
    const offenders = FILES
      .filter((f) => countMatches(f.text, CLIENT_PATH_IN_VAULT) > 0)
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  test('the client-path pattern ignores the denylist constant and the redaction marker', () => {
    // Guards the guard. If this drifted into matching `'CLIENTS/'` on its own,
    // the assertions above would be failing on the exclusion logic itself and
    // somebody would relax them.
    expect(countMatches(`'${CLIENT_ROOT}/',`, CLIENT_PATH)).toBe(0);
    expect(countMatches(`${CLIENT_ROOT}/…`, CLIENT_PATH)).toBe(0);
    expect(countMatches(`${CLIENT_ROOT}/somebody/notes.pdf`, CLIENT_PATH)).toBe(1);
  });

  test('the vault-path pattern ignores the vault named in prose', () => {
    expect(countMatches(`the \`${VAULT_NAME}\` catalogue`, VAULT_PATH)).toBe(0);
    expect(countMatches(`~/Documents/${VAULT_NAME}`, VAULT_PATH)).toBe(1);
    expect(countMatches(`/Users/someone/${VAULT_NAME}/x.pdf`, VAULT_PATH)).toBe(1);
  });
});

// ── Client identity, derived from the vault at runtime ──────────────────────

/**
 * Ordinary vocabulary that a folder name may contain without naming anybody.
 *
 * A stopword list is a blunt instrument, and it is used here only to keep the
 * derived set to name-shaped tokens. It is not the safety property: the safety
 * property is that a token surviving this list and then appearing in committed
 * text is reported, not ignored.
 */
const STOPWORDS = new Set(`
about active address adult adults admin annual archive archived assessment
assessments attachment attachments audit august april autism backup backups
board booking bookings brief briefing budget builder calendar care case cases
child children clinic clinical client clients closed community complete
completed consent contact contacts copy correspondence court current daily data
december demo design detail details discharge document documents download
draft drafts early education email entry equipment evidence example examples
export exports external family feedback file files final finance folder form
forms friday functional general goal goals group groups guide guides handout
handouts health home household image images import imports incoming individual
info information initial intake internal invoice invoices january july june
letter letters list lists march may meeting meetings mental miscellaneous
monday month monthly motor network notes november occupational october ongoing
online other outcome outcomes outgoing paediatric paediatrics parent parents
past pending person personal photo photos physical plan planning plans policy
practice presentation previous primary print printed private profile program
progress project projects provider public quarterly query record records
referral referrals registration registrations report reports request resource
resources review reviews
saturday scan scanned school schedule screening secondary sensory september
service services session sessions setup shared sheet sheets social speech staff
standard statement summary sunday support supports survey team template
templates test testing therapy thursday tool tools training transfer transport
tuesday update updated upload uploads version visit visits wednesday week
weekly work working workshop worksheet year zone zones
`.trim().split(/\s+/));

/** Name-shaped: capitalised, alphabetic, long enough to be a name not a code. */
const NAME_SHAPED = /^[A-Z][a-zA-Z]{3,}$/;

function collectEntryNames(dir, depth, budget, into) {
  if (depth < 0 || into.length >= budget) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (into.length >= budget) return;
    if (entry.isSymbolicLink()) continue;
    into.push(entry.name);
    if (entry.isDirectory()) collectEntryNames(path.join(dir, entry.name), depth - 1, budget, into);
  }
}

/** Every alphabetic token in a set of names, with no shape requirement. */
function vocabularyOf(names) {
  const vocabulary = new Set();
  for (const name of names) {
    for (const part of name.split(/[^A-Za-z]+/)) {
      if (part.length >= 4) vocabulary.add(part.toLowerCase());
    }
  }
  return vocabulary;
}

/**
 * Tokens that identify clients, taken from the vault's own client directory.
 *
 * Derived at runtime and never written down. That is the whole design: the guard
 * knows the names while it runs and the repository never does.
 *
 * THE CROSS-CHECK, AND WHAT IT COSTS
 * Client folders are named by people, so they contain ordinary words as well as
 * names — and an ordinary word matches half the repository, which would drown
 * the real signal and get the guard deleted within a week. A word that ALSO
 * names something in the non-client part of the vault is vocabulary rather than
 * identity, so it is dropped. On the current vault that is the difference
 * between dozens of meaningless hits and none.
 *
 * The cost is stated rather than hidden: a client whose name also happens to
 * name a resource folder would not be derived. That is a narrower gap than the
 * one left by a guard nobody trusts, and the hard-coded stopword list is a
 * second, independent reason a token might be dropped — neither is relied on
 * alone.
 */
function deriveClientTokens() {
  const clientNames = [];
  collectEntryNames(path.join(VAULT_ROOT, CLIENT_ROOT), 6, 20000, clientNames);

  const otherNames = [];
  let rootEntries = [];
  try {
    rootEntries = fs.readdirSync(VAULT_ROOT, { withFileTypes: true });
  } catch {
    rootEntries = [];
  }
  for (const entry of rootEntries) {
    if (entry.name === CLIENT_ROOT || entry.isSymbolicLink()) continue;
    otherNames.push(entry.name);
    if (entry.isDirectory()) {
      collectEntryNames(path.join(VAULT_ROOT, entry.name), 7, 60000, otherNames);
    }
  }
  const ordinary = vocabularyOf(otherNames);

  const tokens = new Set();
  for (const name of clientNames) {
    for (const part of name.split(/[^A-Za-z]+/)) {
      if (!NAME_SHAPED.test(part)) continue;
      if (part === part.toUpperCase()) continue;         // an acronym, not a name
      const lower = part.toLowerCase();
      if (STOPWORDS.has(lower)) continue;
      if (ordinary.has(lower)) continue;                 // vocabulary, not identity
      tokens.add(lower);
    }
  }
  return [...tokens];
}

const CLIENTS_DIR = path.join(VAULT_ROOT, CLIENT_ROOT);
const vaultReadable = (() => {
  try {
    return fs.statSync(CLIENTS_DIR).isDirectory();
  } catch {
    return false;
  }
})();

/** Derived once: two tests need it and the walk should not run twice. */
let derivedTokens = null;
const clientTokens = () => {
  if (derivedTokens === null) derivedTokens = deriveClientTokens();
  return derivedTokens;
};

/** Never the token. A short hash is enough to tell two findings apart. */
const marker = (token) => `token-${crypto.createHash('sha256').update(token).digest('hex').slice(0, 8)}`;

const derivedSuite = vaultReadable
  ? 'client identifiers derived from the vault at runtime'
  : 'client identifiers derived from the vault at runtime — SKIPPED, THE VAULT IS NOT READABLE HERE';

/**
 * Announce the skip on stderr, not through `console`.
 *
 * A privacy guard that quietly does half its work on the machines where the
 * other half is impossible is worse than one that fails, because everyone reads
 * the green tick and nobody reads the skip count. The suite name carries the
 * state, but the default reporter prints suite names only on failure and the
 * suite is run with --silent, which mocks `console`. `process.stderr` is not
 * mocked, so this line survives both. It names no file and no person.
 */
process.stderr.write(vaultReadable
  ? '[resource-privacy-leak] derived client-token check: ACTIVE (vault readable)\n'
  : '[resource-privacy-leak] derived client-token check: SKIPPED — the vault is not '
    + 'readable here, so only the path checks ran\n');

describe(derivedSuite, () => {
  const run = vaultReadable ? test : test.skip;

  run('the derivation produced tokens to check against', () => {
    // A count, never a value. Zero would mean the check below proves nothing.
    expect(clientTokens().length).toBeGreaterThan(0);
  });

  run('no committed file contains a token derived from a client name', () => {
    const tokens = clientTokens();
    const offenders = [];
    for (const file of FILES) {
      for (const token of tokens) {
        if (file.words.has(token)) offenders.push(`${file.rel} :: ${marker(token)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  run('test files are covered by this check as fully as shipped files are', () => {
    // The path checks exempt `backend/tests/**`, on the grounds that a fixture
    // naming the vault is an assertion rather than a disclosure. That exemption
    // is only defensible because this check has none.
    expect(TESTS.length).toBeGreaterThan(0);
    expect(FILES).toEqual(expect.arrayContaining(TESTS));
  });
});

// ── Operator-supplied blocklist ─────────────────────────────────────────────

function loadBlocklist() {
  try {
    return fs.readFileSync(BLOCKLIST_FILE, 'utf8')
      .split('\n')
      .map((line, i) => ({ line: i + 1, value: line.trim() }))
      .filter((e) => e.value && !e.value.startsWith('#'));
  } catch {
    return null;
  }
}

const blocklist = loadBlocklist();
const blocklistSuite = blocklist
  ? 'the local blocklist'
  : 'the local blocklist — NOT PRESENT, NOTHING EXTRA WAS CHECKED';

process.stderr.write(blocklist
  ? `[resource-privacy-leak] local blocklist: ACTIVE (${blocklist.length} entr${blocklist.length === 1 ? 'y' : 'ies'})\n`
  : '[resource-privacy-leak] local blocklist: none present, nothing extra was checked\n');

describe(blocklistSuite, () => {
  const run = blocklist ? test : test.skip;

  run('no committed file contains a blocked string', () => {
    // Entries are reported by their LINE NUMBER in the blocklist. Echoing the
    // value would put the very string an operator was trying to keep out of the
    // repository into the test output instead.
    const offenders = [];
    for (const file of FILES) {
      const haystack = file.text.toLowerCase();
      for (const entry of blocklist) {
        if (haystack.includes(entry.value.toLowerCase())) {
          offenders.push(`${file.rel} :: blocklist line ${entry.line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ── The guard reports nothing it should not ─────────────────────────────────

describe('the guard itself discloses nothing', () => {
  test('this file holds no vault path, client path or embedded name list', () => {
    const self = fs.readFileSync(path.join(REPO_ROOT, SELF), 'utf8');
    expect(countMatches(self, VAULT_PATH)).toBe(0);
    expect(countMatches(self, CLIENT_PATH)).toBe(0);
    // Everything identifying is derived at runtime, so there is nothing here to
    // leak even if this file were pasted into an issue.
    expect(self).not.toMatch(/deriveClientTokens\(\)\s*\.\s*join/);
  });

  test('failures are reported as file paths and hashed markers', () => {
    expect(marker('a-name')).toMatch(/^token-[0-9a-f]{8}$/);
    expect(marker('a-name')).not.toMatch(/name/);
    expect(marker('a-name')).toBe(marker('a-name'));
    expect(marker('a-name')).not.toBe(marker('another-name'));
  });
});
