'use strict';

/**
 * ONBOARDING OCR — the PDF rasteriser, in a worker_thread.
 *
 * pdfjs 4 is ESM only and is kept out of the main realm for the reasons set
 * out in resource-file-quality.js. This worker draws each page of a PDF that
 * has no text layer onto a canvas and hands the PNGs back; the recognition
 * itself happens in onboarding-ocr.js.
 *
 * Protocol: workerData = { data: Uint8Array, maxPages, scale }
 *           → { ok: true, pages: [Uint8Array png], totalPages } | { ok: false, error }
 */

const path = require('path');
const { pathToFileURL } = require('node:url');
const { parentPort, workerData } = require('node:worker_threads');

const PDFJS_ROOT = path.dirname(require.resolve('pdfjs-dist/package.json'));
const STANDARD_FONTS = `${path.join(PDFJS_ROOT, 'standard_fonts')}/`;

(async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const pdfjs = await import(pathToFileURL(path.join(PDFJS_ROOT, 'legacy/build/pdf.mjs')).href);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(workerData.data),
    useWorkerFetch: false, isEvalSupported: false, useSystemFonts: false, standardFontDataUrl: STANDARD_FONTS,
  }).promise;
  const pages = [];
  const count = Math.min(doc.numPages, workerData.maxPages);
  for (let n = 1; n <= count; n += 1) {
    const page = await doc.getPage(n);
    const viewport = page.getViewport({ scale: workerData.scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pages.push(new Uint8Array(canvas.toBuffer('image/png')));
    page.cleanup();
  }
  parentPort.postMessage({ ok: true, pages, totalPages: doc.numPages });
})().catch((err) => {
  parentPort.postMessage({ ok: false, error: err ? err.message : 'ocr rasteriser failed' });
});
