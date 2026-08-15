'use strict';

/**
 * PDF inspection worker for the resource-file quality gate.
 *
 * pdfjs 4 ships ESM only. Importing it from CommonJS inside a Jest-managed VM
 * proved version-sensitive: Node's dynamic-import callback either refuses
 * outright (no --experimental-vm-modules) or routes through Jest's per-suite
 * module registry, which tears ES modules down between test files and fails
 * nondeterministically when two suites share a worker process. A
 * worker_thread is a plain Node realm — no test runner, no VM hooks — so the
 * import below behaves identically under test, in CI and on the server.
 *
 * Protocol: workerData = { op: 'inspect'|'text', data: Uint8Array }.
 * Reply: { ok: true, result } or { ok: false, error }.
 */

const path = require('path');
const { pathToFileURL } = require('url');
const { parentPort, workerData } = require('node:worker_threads');

/** Resolved from the package root so a hoisted install still works. */
const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));

/**
 * pdfjs fetches Foxit substitutes for the 14 standard PDF fonts. Without a
 * local path it warns on every page and falls back, which buries real findings
 * in noise. The fonts ship with the package.
 */
const STANDARD_FONTS = `${path.join(PDFJS_ROOT, 'standard_fonts')}/`;

async function openDocument(pdfjs, data) {
  return pdfjs.getDocument({
    data,
    // Server-side: no worker, no eval, no external font fetching.
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false,
    standardFontDataUrl: STANDARD_FONTS,
  }).promise;
}

/** Byte-for-byte port of the gate's original in-process inspectPdf. */
async function inspect(pdfjs, data) {
  const out = {
    pages: 0, perPage: [], textChars: 0, hasTextLayer: false,
    encrypted: false, corrupt: false, error: null, blankPages: [],
  };
  let doc;
  try {
    doc = await openDocument(pdfjs, data);
  } catch (err) {
    if (err && /password/i.test(err.name + err.message)) out.encrypted = true;
    else out.corrupt = true;
    out.error = err ? err.message : 'unknown';
    return out;
  }

  out.pages = doc.numPages;
  for (let i = 1; i <= doc.numPages; i += 1) {
    const entry = { page: i, chars: 0, ops: 0, rendered: false, error: null };
    try {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();       // full parse of the page
      entry.ops = ops.fnArray.length;
      entry.rendered = true;
      const text = await page.getTextContent();
      const s = text.items.map((it) => it.str || '').join('');
      entry.chars = s.length;
      out.textChars += s.length;
      // A page with no text AND almost no drawing operations is blank.
      if (entry.chars === 0 && entry.ops < 5) out.blankPages.push(i);
    } catch (err) {
      entry.error = err ? err.message : 'render failed';
      out.corrupt = true;
    }
    out.perPage.push(entry);
  }
  out.hasTextLayer = out.textChars > 0;
  await doc.destroy().catch(() => {});
  return out;
}

/** Per-page text, items joined with spaces — for fidelity/truncation checks. */
async function pageTexts(pdfjs, data) {
  const doc = await openDocument(pdfjs, data);
  const texts = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const t = await page.getTextContent();
    texts.push(t.items.map((it) => it.str || '').join(' '));
  }
  await doc.destroy().catch(() => {});
  return texts;
}

(async () => {
  const pdfjs = await import(pathToFileURL(path.join(PDFJS_ROOT, 'legacy/build/pdf.mjs')).href);
  const data = new Uint8Array(workerData.data);
  const result = workerData.op === 'text'
    ? await pageTexts(pdfjs, data)
    : await inspect(pdfjs, data);
  parentPort.postMessage({ ok: true, result });
})().catch((err) => {
  parentPort.postMessage({ ok: false, error: err ? err.message : 'pdf worker failed' });
});
