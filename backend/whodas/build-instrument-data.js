'use strict';

/**
 * WHODAS 2.0 — INSTRUMENT DATA BUILDER (derivation script)
 *
 * Derives the exact item wording and the response-control coordinates for each
 * administration method straight out of the immutable template PDFs, and writes
 * `instrument-data.json` + `field-maps/<key>.json`.
 *
 * WHY DERIVE INSTEAD OF TRANSCRIBE
 * Two things must never drift from the WHO document: the words a screen reader
 * announces for an item, and where a response mark lands on the page. Both are
 * read out of the PDF itself here, so neither can be mistyped, and a test
 * re-runs this and diffs the committed output.
 *
 * COORDINATE SPACE
 * pdftotext emits top-left-origin coordinates in MediaBox space (567 x 780).
 * Everything written out is converted to PDF user space (bottom-left origin,
 * MediaBox), because that is what pdf-lib draws in. The CropBox is recorded in
 * the map so the browser viewer can subtract its origin — the viewer renders
 * the CropBox (482.04 x 693.24), which is what hides the printer's marks.
 *
 * RUN
 *   node backend/whodas/build-instrument-data.js
 *   node backend/whodas/build-instrument-data.js --check   (no writes; diffs)
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TEMPLATES_DIR = path.join(__dirname, 'templates');
const FIELD_MAPS_DIR = path.join(__dirname, 'field-maps');
const DATA_PATH = path.join(__dirname, 'instrument-data.json');

/** The five difficulty categories, in printed left-to-right order. */
const DIFFICULTY_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'mild', label: 'Mild' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'severe', label: 'Severe' },
  { value: 'extreme', label: 'Extreme or cannot do' },
];

/** Words that make up the printed option labels on the self/proxy forms. */
const OPTION_HEAD = ['None', 'Mild', 'Moderate', 'Severe', 'Extreme'];

const SOURCES = [
  { key: 'whodas-36-interviewer', method: 'interviewer', file: 'whodas-36-interviewer.pdf', numeric: true },
  { key: 'whodas-36-self', method: 'self', file: 'whodas-36-self.pdf', numeric: false },
  { key: 'whodas-36-proxy', method: 'proxy', file: 'whodas-36-proxy.pdf', numeric: false },
];

const ITEM_ID = /^(D[1-6]\.\d{1,2}|H[1-4]|A[1-5]|F[1-5])$/;
const SCORED_ID = /^D[1-6]\.\d$/;

// ── PDF word extraction ──────────────────────────────────────────────────────

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** → [{ pageNumber, width, height, words: [{x0,y0,x1,y1,text}] }] (top-left origin) */
function readWords(pdfPath) {
  const xml = execFileSync('pdftotext', ['-bbox', pdfPath, '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const pages = [];
  const pageRe = /<page width="([\d.]+)" height="([\d.]+)">([\s\S]*?)<\/page>/g;
  const wordRe = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g;
  let pm;
  let n = 0;
  while ((pm = pageRe.exec(xml)) !== null) {
    n += 1;
    const words = [];
    let wm;
    while ((wm = wordRe.exec(pm[3])) !== null) {
      words.push({
        x0: +wm[1], y0: +wm[2], x1: +wm[3], y1: +wm[4],
        text: decodeEntities(wm[5]).trim(),
      });
    }
    pages.push({ pageNumber: n, width: +pm[1], height: +pm[2], words: words.filter((w) => w.text) });
  }
  return pages;
}

/** Group words into visual lines (same baseline within 1.2pt), left-to-right. */
function toLines(words) {
  const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines = [];
  for (const w of sorted) {
    const line = lines.find((l) => Math.abs(l.y0 - w.y0) <= 1.2);
    if (line) {
      line.words.push(w);
      line.y0 = Math.min(line.y0, w.y0);
      line.y1 = Math.max(line.y1, w.y1);
    } else {
      lines.push({ y0: w.y0, y1: w.y1, words: [w] });
    }
  }
  lines.forEach((l) => l.words.sort((a, b) => a.x0 - b.x0));
  return lines.sort((a, b) => a.y0 - b.y0);
}

// ── Item rows ────────────────────────────────────────────────────────────────

/**
 * A scored item row is a line carrying an item id in the left column together
 * with its full set of response controls. On self/proxy those controls are the
 * words None/Mild/Moderate/Severe/Extreme; on the interviewer form they are the
 * numerals 1-5. Anchoring on the controls (not on the id alone) is what keeps
 * section headings and instruction paragraphs out of the row.
 */
function findOptionCells(line, numeric) {
  if (numeric) {
    const nums = line.words.filter((w) => /^[1-5]$/.test(w.text) && w.x0 > 250);
    if (nums.length !== 5) return null;
    const seq = nums.map((w) => w.text).join('');
    if (seq !== '12345') return null;
    return nums;
  }
  const cells = OPTION_HEAD.map((label) =>
    line.words.find((w) => w.text === label && w.x0 > 250)
  );
  return cells.every(Boolean) ? cells : null;
}

/**
 * Question text for an item: the lines from the item's own line down to the
 * next row, restricted to the question column, and cut at the first vertical
 * gap wider than a within-cell line break. Without that cut, a section heading
 * printed between two rows bleeds onto the row above it.
 */
function questionText(lines, startIdx, endIdx, colLeft, colRight) {
  const pick = (line) =>
    line.words.filter((w) => w.x0 >= colLeft - 2 && w.x1 <= colRight);

  const out = [];
  let prevY1 = null;
  for (let i = startIdx; i < endIdx; i += 1) {
    const chunk = pick(lines[i]);
    if (!chunk.length) {
      if (prevY1 !== null) break;
      continue;
    }
    // Within a table cell, consecutive lines sit ~2-3pt apart. Anything larger
    // is a new cell, a heading, or an instruction block.
    if (prevY1 !== null && lines[i].y0 - prevY1 > 4.5) break;
    out.push(chunk.map((w) => w.text).join(' '));
    prevY1 = lines[i].y1;
  }
  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Non-scored fields a person filling in the paper form would also complete:
 * the H1-H3 day counts, the proxy's H4 relationship grid, and the interviewer's
 * face sheet and conditional follow-ups. Each is expected to yield an exact
 * number of controls; the build fails if it does not, so a layout change can
 * never silently drop a field from the completed PDF.
 *
 * `codes` counts coded radio options; `blanks` counts write-in rules.
 */
const NON_SCORED_EXPECTATIONS = {
  interviewer: {
    A1: { codes: 2 }, A4: { codes: 6 }, A5: { codes: 9 }, F5: { codes: 3 },
    'D5.9': { codes: 2 }, 'D5.10': { codes: 2 },
    'D5.01': { blanks: 1 }, 'D5.02': { blanks: 1 },
    H1: { blanks: 1 }, H2: { blanks: 1 }, H3: { blanks: 1 },
  },
  self: { H1: { blanks: 1 }, H2: { blanks: 1 }, H3: { blanks: 1 } },
  proxy: { H4: { codes: 8 }, H1: { blanks: 1 }, H2: { blanks: 1 }, H3: { blanks: 1 } },
};

const BLANK_RULE = /^_{3,}$/;

/**
 * Attribute every blank rule and coded option on a page to the item whose row
 * it sits in. Rows are delimited by the item ids in the left column, which is
 * how the printed tables are organised.
 */
function buildNonScoredFields(page, lines, scoredIds) {
  const anchors = [];
  lines.forEach((line, idx) => {
    const w = line.words.find((word) => ITEM_ID.test(word.text) && word.x0 < 140);
    if (w) anchors.push({ id: w.text, idx, y0: line.y0 });
  });

  const out = [];

  /**
   * On the interviewer face sheet the FIRST option of a multi-option question
   * is typeset a couple of points above the item id's own baseline (A4's "1"
   * sits at y=352.6 while "A4" sits at y=354.7). Slicing rows on the id's
   * baseline therefore hands that option to the previous question — which is
   * exactly the kind of silent, plausible-looking mis-attribution that a count
   * check alone would not catch. Rows are opened slightly early to absorb it;
   * genuine rows are at least 9pt apart, so nothing else moves.
   */
  const ROW_LEAD = 3;

  anchors.forEach((anchor, k) => {
    if (scoredIds.has(anchor.id)) return;

    const startY = anchor.y0 - ROW_LEAD;
    const endY = k + 1 < anchors.length ? anchors[k + 1].y0 - ROW_LEAD : Infinity;
    const rowLines = lines.filter((l) => l.y0 >= startY && l.y0 < endY);

    const blanks = [];
    const codes = [];

    for (const line of rowLines) {
      for (let j = 0; j < line.words.length; j += 1) {
        const w = line.words[j];

        if (BLANK_RULE.test(w.text)) {
          blanks.push({
            page: page.pageNumber,
            // Text sits just above the rule, left-aligned to it.
            x: round2(w.x0 + 1),
            y: round2(page.height - w.y1 + 1.5),
            w: round2(w.x1 - w.x0),
            h: round2(w.y1 - w.y0),
          });
          continue;
        }

        // A coded option is a small integer that is either followed by "="
        // (the proxy H4 grid) or sits alone at the end of its line in the
        // interviewer face sheet's code column, which is printed at x≈451-461.
        if (/^\d{1,2}$/.test(w.text) && Number(w.text) >= 1 && Number(w.text) <= 20) {
          const next = line.words[j + 1];
          const followedByEquals = next && next.text === '=';
          const isRightMost = j === line.words.length - 1 && w.x0 > 440;
          if (!followedByEquals && !isRightMost) continue;

          codes.push({
            code: Number(w.text),
            mark: {
              cx: round2((w.x0 + w.x1) / 2),
              cy: round2(page.height - (w.y0 + w.y1) / 2),
              rx: round2(Math.max((w.x1 - w.x0) / 2 + 4, 7)),
              ry: round2((w.y1 - w.y0) / 2 + 3.2),
            },
            hit: {
              x: round2(w.x0 - 6),
              y: round2(page.height - (w.y1 + 3)),
              w: round2(w.x1 - w.x0 + 12),
              h: round2(w.y1 - w.y0 + 6),
            },
          });
        }
      }
    }

    if (codes.length) {
      out.push({
        field: anchor.id,
        page: page.pageNumber,
        type: 'coded-radio',
        scored: false,
        options: codes.sort((a, b) => a.code - b.code),
      });
    }
    // A write-in only takes the bare item id when it is the item's ONLY
    // control. A5 has nine coded options AND an "Other (specify)" rule, so
    // both must not answer to "A5".
    const bare = blanks.length === 1 && codes.length === 0;
    for (const [n, blank] of blanks.entries()) {
      out.push({
        field: bare ? anchor.id : `${anchor.id}#${n + 1}`,
        page: page.pageNumber,
        type: 'text',
        scored: false,
        writeIn: blank,
      });
    }
  });

  return out;
}

function buildTemplate(src) {
  const pdfPath = path.join(TEMPLATES_DIR, src.file);
  const pages = readWords(pdfPath);

  const items = {};
  const fields = [];
  const nonScored = [];
  const scoredIds = new Set();

  for (const page of pages) {
    const lines = toLines(page.words);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const idWord = line.words.find((w) => ITEM_ID.test(w.text) && w.x0 < 140);
      if (!idWord) continue;
      const cells = findOptionCells(line, src.numeric);
      if (!cells) continue;

      const id = idWord.text;
      const nextIdx = lines.findIndex(
        (l, j) => j > i && l.words.some((w) => ITEM_ID.test(w.text) && w.x0 < 140)
      );
      const endIdx = nextIdx === -1 ? lines.length : nextIdx;

      // The question column runs from just right of the id to just left of the
      // first response control.
      const colLeft = idWord.x0;
      const colRight = cells[0].x0 - 4;
      const text = questionText(lines, i, endIdx, colLeft, colRight)
        .replace(new RegExp(`^${id.replace('.', '\\.')}\\s*`), '')
        .trim();

      items[id] = { id, page: page.pageNumber, text };

      // Response controls. Column boundaries are the midpoints between adjacent
      // printed labels, so each hit target covers its own table column and no
      // two overlap.
      const centres = cells.map((c) => (c.x0 + c.x1) / 2);

      // Column edges are rounded ONCE and shared, so adjacent hit targets meet
      // exactly. Rounding each box's own left and right independently leaves
      // sub-point overlaps, and an overlapping target means a click near a
      // boundary can select the wrong response.
      const edges = [round2(cells[0].x0 - 12)];
      for (let k = 1; k < cells.length; k += 1) edges.push(round2((centres[k - 1] + centres[k]) / 2));
      edges.push(round2(cells[cells.length - 1].x1 + 12));

      const options = cells.map((cell, k) => {
        const left = edges[k];
        const right = edges[k + 1];

        // On the self and proxy forms the last option is printed over two lines
        // ("Extreme or / cannot do"). A ring drawn around the first line alone
        // strikes through the second, so the label's full extent is measured
        // and the ring encloses the whole cell — which is also what a person
        // circling the response on paper would do.
        let box = { x0: cell.x0, y0: cell.y0, x1: cell.x1, y1: cell.y1 };
        for (let j = i + 1; j < endIdx; j += 1) {
          const cont = lines[j].words.filter((w) => w.x0 >= left && w.x1 <= right + 2);
          if (!cont.length) break;
          if (lines[j].y0 - box.y1 > 4.5) break;
          box = {
            x0: Math.min(box.x0, ...cont.map((w) => w.x0)),
            y0: box.y0,
            x1: Math.max(box.x1, ...cont.map((w) => w.x1)),
            y1: Math.max(box.y1, ...cont.map((w) => w.y1)),
          };
        }

        return {
          value: DIFFICULTY_OPTIONS[k].value,
          label: DIFFICULTY_OPTIONS[k].label,
          // PDF user space: y measured from the bottom of the MediaBox.
          mark: {
            cx: round2((box.x0 + box.x1) / 2),
            cy: round2(page.height - (box.y0 + box.y1) / 2),
            rx: round2(Math.max((box.x1 - box.x0) / 2 + 4, 9)),
            ry: round2((box.y1 - box.y0) / 2 + 3.2),
          },
          hit: {
            x: left,
            y: round2(page.height - (box.y1 + 3)),
            w: round2(right - left),
            h: round2(box.y1 - box.y0 + 6),
          },
        };
      });

      if (SCORED_ID.test(id)) scoredIds.add(id);
      fields.push({
        field: id,
        page: page.pageNumber,
        type: 'radio-group',
        scored: SCORED_ID.test(id),
        options,
      });
    }
  }

  // Second pass, now that every scored row is known.
  for (const page of pages) {
    nonScored.push(...buildNonScoredFields(page, toLines(page.words), scoredIds));
  }

  return {
    items,
    fields: [...fields, ...nonScored],
    pages: pages.map((p) => ({ width: p.width, height: p.height })),
  };
}

const round2 = (n) => Math.round(n * 100) / 100;

// ── Entry point ──────────────────────────────────────────────────────────────

function build() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(TEMPLATES_DIR, 'manifest.json'), 'utf8')
  );

  const data = { generatedBy: 'backend/whodas/build-instrument-data.js', methods: {} };
  const maps = {};

  for (const src of SOURCES) {
    const tpl = manifest.templates.find((t) => t.key === src.key);
    if (!tpl) throw new Error(`manifest has no template ${src.key}`);

    const built = buildTemplate(src);
    const scored = Object.keys(built.items).filter((id) => SCORED_ID.test(id)).sort();

    if (scored.length !== 36) {
      throw new Error(`${src.key}: found ${scored.length} scored items, expected 36 — ${scored.join(',')}`);
    }

    // Every non-scored control the form actually has must be found, or the
    // completed PDF would silently omit something a paper form would carry.
    const expectations = NON_SCORED_EXPECTATIONS[src.method] || {};
    const problems = [];
    for (const [fieldId, expect] of Object.entries(expectations)) {
      if (expect.codes) {
        const f = built.fields.find((x) => x.field === fieldId && x.type === 'coded-radio');
        const n = f ? f.options.length : 0;
        if (n !== expect.codes) problems.push(`${fieldId}: ${n} coded options, expected ${expect.codes}`);
      }
      if (expect.blanks) {
        const n = built.fields.filter(
          (x) => x.type === 'text' && (x.field === fieldId || x.field.startsWith(`${fieldId}#`))
        ).length;
        if (n !== expect.blanks) problems.push(`${fieldId}: ${n} write-in rules, expected ${expect.blanks}`);
      }
    }
    if (problems.length) {
      throw new Error(`${src.key}: non-scored field extraction mismatch:\n  ${problems.join('\n  ')}`);
    }

    data.methods[src.method] = {
      templateKey: src.key,
      items: built.items,
    };

    maps[src.key] = {
      templateKey: src.key,
      templateVersion: tpl.version,
      templateSha256: tpl.sha256,
      method: src.method,
      pageCount: tpl.pageCount,
      mediaBox: tpl.mediaBox,
      cropBox: tpl.cropBox,
      fields: built.fields,
    };

    const counts = built.fields.reduce((acc, f) => {
      acc[f.type] = (acc[f.type] || 0) + 1;
      return acc;
    }, {});
    console.log(
      `  ${src.key.padEnd(24)} items=${scored.length} ` +
      `radio=${counts['radio-group'] || 0} coded=${counts['coded-radio'] || 0} text=${counts.text || 0}`
    );
  }

  return { data, maps };
}

function main() {
  const check = process.argv.includes('--check');
  const { data, maps } = build();

  fs.mkdirSync(FIELD_MAPS_DIR, { recursive: true });

  const writes = [[DATA_PATH, `${JSON.stringify(data, null, 2)}\n`]];
  for (const [key, map] of Object.entries(maps)) {
    writes.push([path.join(FIELD_MAPS_DIR, `${key}.json`), `${JSON.stringify(map, null, 2)}\n`]);
  }

  let drift = 0;
  for (const [file, content] of writes) {
    if (check) {
      const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
      if (existing !== content) {
        console.error(`  DRIFT  ${path.relative(process.cwd(), file)}`);
        drift += 1;
      }
    } else {
      fs.writeFileSync(file, content);
    }
  }

  if (check) {
    if (drift) {
      console.error(`\n${drift} file(s) differ from a fresh derivation.`);
      process.exit(1);
    }
    console.log('\nAll derived files match the templates.');
  } else {
    console.log(`\nWrote instrument-data.json + ${Object.keys(maps).length} field maps`);
  }
}

if (require.main === module) main();

module.exports = { build, readWords, toLines, DIFFICULTY_OPTIONS };
