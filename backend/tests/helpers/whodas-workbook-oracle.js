'use strict';

/**
 * WHO SCORING WORKBOOK ORACLE
 *
 * An independent reference implementation of the two supplied WHO scoring
 * workbooks — independent because it does not reimplement them at all. It opens
 * the actual .xlsx files, reads the item → cell mapping out of column A, writes
 * response values into the score column, and evaluates the workbook's OWN
 * formula strings.
 *
 * That is what makes the golden tests meaningful. If `scoring.js` and this
 * oracle agree, the engine agrees with WHO's spreadsheet — not with a second
 * copy of my reading of it. A transcription slip in the engine cannot be
 * mirrored here, because nothing is transcribed.
 *
 * Only the arithmetic subset the workbooks actually use is supported:
 * SUM over a range, SUM over a sum-expression, cell references, + - * / and
 * parentheses. Anything else throws rather than guessing.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REFERENCE_DIR = path.join(__dirname, '..', '..', 'whodas', 'reference');

const WORKBOOKS = {
  simple: {
    file: '36item-scoring-template-simple-scoring.xlsx',
    sha256: 'cec01e176693f36fccebd7d5e3e1022bf31cdb6d04d9a16df8b0158c1b8e6b6d',
    overallCell: 'C50',
  },
  domainMean: {
    file: '36item-scoring-template-complex-scoring.xlsx',
    sha256: '3d52651d8fc4c0b6de620b4f62dedaf02d84a4ff30bba8ebb231485ed86f11d4',
    overallCell: 'C56',
    domainCells: { 1: 'C15', 2: 'C22', 3: 'C28', 4: 'C35', 5: 'C45', 6: 'C55' },
  },
};

// ── Minimal zip reader (avoids adding a dependency for two 16 KB files) ──────

function readZipEntries(buf) {
  // Locate the End Of Central Directory record, then walk the central
  // directory. Deliberately minimal: these are two fixed, hashed files.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('Not a zip file: no EOCD record');

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);
  const entries = {};

  for (let n = 0; n < count; n += 1) {
    if (buf.readUInt32LE(ptr) !== 0x02014b50) throw new Error('Bad central directory header');
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString('utf8', ptr + 46, ptr + 46 + nameLen);

    const lhNameLen = buf.readUInt16LE(localOff + 26);
    const lhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lhNameLen + lhExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    entries[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ── Sheet parsing ────────────────────────────────────────────────────────────

function decode(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

function parseWorkbook(key) {
  const spec = WORKBOOKS[key];
  const buf = fs.readFileSync(path.join(REFERENCE_DIR, spec.file));

  const actual = require('crypto').createHash('sha256').update(buf).digest('hex');
  if (actual !== spec.sha256) {
    throw new Error(
      `${spec.file} has changed.\n  expected ${spec.sha256}\n  actual   ${actual}\n` +
      'The golden tests are only meaningful against the audited WHO workbook.'
    );
  }

  const entries = readZipEntries(buf);
  const sheetXml = entries['xl/worksheets/sheet1.xml'].toString('utf8');

  const shared = [];
  if (entries['xl/sharedStrings.xml']) {
    const ss = entries['xl/sharedStrings.xml'].toString('utf8');
    for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) || []) {
      shared.push(decode((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, '')).join('')));
    }
  }

  const cells = {};
  const cellRe = /<c\s[^>]*?\/>|<c\s[^>]*?>[\s\S]*?<\/c>/g;
  for (const c of sheetXml.match(cellRe) || []) {
    const ref = (c.match(/r="([A-Z]+\d+)"/) || [])[1];
    if (!ref) continue;
    const type = (c.match(/t="(\w+)"/) || [])[1];
    const formula = (c.match(/<f[^>]*>([\s\S]*?)<\/f>/) || [])[1];
    const value = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];

    cells[ref] = {
      formula: formula ? decode(formula) : null,
      text: type === 's' && value !== undefined ? shared[Number(value)] : null,
      number: !type && value !== undefined ? Number(value) : null,
    };
  }

  // Item id → score cell. Column A holds "D1.1"; the score lives in column C of
  // the same row. Read from the file so a workbook row shift cannot go unnoticed.
  const itemCells = {};
  for (const [ref, cell] of Object.entries(cells)) {
    const m = ref.match(/^A(\d+)$/);
    if (!m || !cell.text) continue;
    if (/^D[1-6]\.\d$/.test(cell.text.trim())) itemCells[cell.text.trim()] = `C${m[1]}`;
  }

  const found = Object.keys(itemCells).length;
  if (found !== 36) {
    throw new Error(`${spec.file}: located ${found} item rows in column A, expected 36`);
  }

  return { spec, cells, itemCells };
}

// ── Formula evaluation ───────────────────────────────────────────────────────

const colToNum = (col) => [...col].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0);

function expandRange(from, to) {
  const a = from.match(/^([A-Z]+)(\d+)$/);
  const b = to.match(/^([A-Z]+)(\d+)$/);
  if (!a || !b) throw new Error(`Unsupported range ${from}:${to}`);
  if (a[1] !== b[1]) throw new Error(`Only single-column ranges are supported (${from}:${to})`);
  const out = [];
  for (let r = Number(a[2]); r <= Number(b[2]); r += 1) out.push(`${a[1]}${r}`);
  return out;
}

/**
 * Evaluate one workbook formula against a cell-value map.
 *
 * `SUM(C9:C49)` sums a range; blank cells count as 0, exactly as Excel does —
 * which matters, because the simple workbook's range spans section-heading rows
 * that hold no value.
 */
function evaluateFormula(formula, valueOf) {
  let expr = formula.replace(/^=/, '');

  expr = expr.replace(/SUM\(([^()]*)\)/gi, (_, arg) => {
    const range = arg.match(/^\s*([A-Z]+\d+)\s*:\s*([A-Z]+\d+)\s*$/);
    if (range) {
      const total = expandRange(range[1], range[2]).reduce((s, ref) => s + (valueOf(ref) || 0), 0);
      return `(${total})`;
    }
    // SUM(C15+C22+…) — a single expression argument; Excel returns its value.
    return `(${arg})`;
  });

  expr = expr.replace(/\$?([A-Z]+)\$?(\d+)/g, (ref) => {
    const v = valueOf(ref.replace(/\$/g, ''));
    return `(${v === null || v === undefined ? 0 : v})`;
  });

  if (!/^[\d+\-*/(). ]+$/.test(expr)) {
    throw new Error(`Refusing to evaluate unsupported formula: ${formula} → ${expr}`);
  }
  // eslint-disable-next-line no-new-func
  const out = Function(`"use strict";return (${expr});`)();
  if (!Number.isFinite(out)) throw new Error(`Formula ${formula} produced ${out}`);
  return out;
}

// ── Public oracle ────────────────────────────────────────────────────────────

const WHO04 = { none: 0, mild: 1, moderate: 2, severe: 3, extreme: 4 };

function buildValueResolver(parsed, responses) {
  const overrides = {};
  for (const [itemId, ref] of Object.entries(parsed.itemCells)) {
    const v = responses[itemId];
    if (v === undefined || v === null || v === '') {
      throw new Error(`Oracle needs a response for every item; ${itemId} is missing`);
    }
    const n = typeof v === 'number' ? v : WHO04[v];
    if (n === undefined) throw new Error(`Unknown response ${JSON.stringify(v)} for ${itemId}`);
    overrides[ref] = n;
  }

  const memo = {};
  const valueOf = (ref) => {
    if (ref in overrides) return overrides[ref];
    if (ref in memo) return memo[ref];
    const cell = parsed.cells[ref];
    if (!cell) return 0;
    if (cell.formula) {
      memo[ref] = evaluateFormula(cell.formula, valueOf);
      return memo[ref];
    }
    return cell.number === null ? 0 : cell.number;
  };
  return valueOf;
}

/**
 * Run the WHO simple-scoring workbook.
 * @returns {{ overallFraction: number, overallPercent: number }}
 */
function runSimpleWorkbook(responses) {
  const parsed = parseWorkbook('simple');
  const valueOf = buildValueResolver(parsed, responses);
  const fraction = valueOf(parsed.spec.overallCell);
  return { overallFraction: fraction, overallPercent: fraction * 100 };
}

/**
 * Run the WHO 36-item ("complex" filename) domain-mean workbook.
 * @returns {{ overallFraction, overallPercent, domainFractions, domainPercents }}
 */
function runDomainMeanWorkbook(responses) {
  const parsed = parseWorkbook('domainMean');
  const valueOf = buildValueResolver(parsed, responses);

  const domainFractions = {};
  const domainPercents = {};
  for (const [domain, ref] of Object.entries(parsed.spec.domainCells)) {
    domainFractions[domain] = valueOf(ref);
    domainPercents[domain] = valueOf(ref) * 100;
  }
  const fraction = valueOf(parsed.spec.overallCell);
  return {
    overallFraction: fraction,
    overallPercent: fraction * 100,
    domainFractions,
    domainPercents,
  };
}

/** Item → cell mapping actually found in the workbook, for structural tests. */
function workbookItemCells(key) {
  return parseWorkbook(key).itemCells;
}

/** The raw formula strings, so a test can assert what is being evaluated. */
function workbookFormulas(key) {
  const parsed = parseWorkbook(key);
  const out = {};
  for (const [ref, cell] of Object.entries(parsed.cells)) {
    if (cell.formula) out[ref] = cell.formula;
  }
  return out;
}

module.exports = {
  WORKBOOKS,
  runSimpleWorkbook,
  runDomainMeanWorkbook,
  workbookItemCells,
  workbookFormulas,
  evaluateFormula,
};
