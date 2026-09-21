'use strict';

/**
 * ONBOARDING OCR — reading a scan or a photograph, on this server.
 *
 * A returned document is often a scan of a signed form or a phone photo of a
 * licence: pages with no text layer. This module recognises the print on them
 * with Tesseract running in-process, from language data shipped in
 * node_modules. Nothing is sent anywhere — an identity document never leaves
 * the server to be read — and no model, provider or network call is involved,
 * so the AI gateway is not in play.
 *
 *   ocrDocument({ buffer, mime }) → { status, pages: [text], chars, confidence, pageCount, truncated }
 *
 *   status  'ocr'         text was recognised
 *           'no_text'     the pages were read and nothing legible was on them
 *           'unsupported' not a PDF, PNG or JPEG
 *           'failed'      the engine could not run (reported, never thrown)
 *
 * `confidence` is Tesseract's mean word confidence (0–100) across the pages.
 * What is read here is a proposal like any other reading: it is shown beside
 * the document for a person to check before it counts.
 */

const path = require('path');
const { Worker } = require('node:worker_threads');
const log = require('./logger').createLogger('onboarding-ocr');

const RASTER_WORKER = path.join(__dirname, 'onboarding-ocr-worker.js');
const MAX_PAGES = 8;            // a scanned pack form is six pages; a certificate is one or two
const RASTER_SCALE = 2.4;       // ≈ 170 dpi from a 72 dpi page: enough for 9pt print, small enough to be quick
const RASTER_TIMEOUT_MS = 120000;
const IMAGE_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg']);

function rasterisePdf(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(RASTER_WORKER, { workerData: { data: new Uint8Array(buffer), maxPages: MAX_PAGES, scale: RASTER_SCALE } });
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate().catch(() => {}); fn(value); };
    const timer = setTimeout(() => finish(reject, new Error('pdf rasterising timed out')), RASTER_TIMEOUT_MS);
    worker.once('message', (msg) => (msg && msg.ok ? finish(resolve, msg) : finish(reject, new Error((msg && msg.error) || 'pdf rasterising failed'))));
    worker.once('error', (err) => finish(reject, err));
  });
}

/** One Tesseract worker per document: created, used for its pages, terminated. */
async function recognise(images) {
  const { createWorker } = require('tesseract.js');
  const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
  const worker = await createWorker('eng', 1, { langPath, cachePath: langPath, cacheMethod: 'none', gzip: true });
  try {
    const pages = []; const confidences = [];
    for (const image of images) {
      const { data } = await worker.recognize(Buffer.from(image));
      pages.push(String(data.text || '').replace(/[ \t]+\n/g, '\n').trim());
      if (Number.isFinite(data.confidence)) confidences.push(data.confidence);
    }
    return { pages, confidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null };
  } finally {
    await worker.terminate().catch(() => {});
  }
}

async function ocrDocument({ buffer, mime }) {
  const type = String(mime || '').toLowerCase();
  if (type !== 'application/pdf' && !IMAGE_MIMES.has(type)) return { status: 'unsupported', pages: [], chars: 0, confidence: null, pageCount: 0, truncated: false };
  try {
    let images; let totalPages = 1;
    if (type === 'application/pdf') { const r = await rasterisePdf(buffer); images = r.pages; totalPages = r.totalPages; } else images = [buffer];
    const { pages, confidence } = await recognise(images);
    const chars = pages.reduce((n, p) => n + p.replace(/\s+/g, '').length, 0);
    return { status: chars >= 20 ? 'ocr' : 'no_text', pages, chars, confidence, pageCount: totalPages, truncated: totalPages > images.length };
  } catch (err) {
    // Content-free: the message of an engine failure, never what was on the page.
    log.warn('ocr failed', { error: err && err.message, mime: type });
    return { status: 'failed', pages: [], chars: 0, confidence: null, pageCount: 0, truncated: false };
  }
}

module.exports = { ocrDocument, MAX_PAGES };
