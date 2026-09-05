'use strict';

/**
 * A download's Content-Disposition, so the file lands with its real name.
 *
 * `filename="…"` percent-encoded (what several routes used to send) makes
 * browsers save "Letter%20of%20Offer.docx" literally. RFC 6266 wants a plain
 * ASCII fallback in `filename` and the full UTF-8 name in `filename*`.
 */
function contentDisposition(type, name) {
  const raw = String(name || 'download').replace(/[\r\n]/g, ' ').trim() || 'download';
  const ascii = raw.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(raw).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

module.exports = { contentDisposition };
