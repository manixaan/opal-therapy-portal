'use strict';

/**
 * RETURNED DOCUMENTS — a ZIP is a folder of returns, not a document.
 *
 *   expandZip(buffer, { limits }) → Promise<{ files, rejected }>
 *
 * An employee sends everything back in one archive; the Owner drops it on
 * the record; each entry becomes its own returned document and goes through
 * the same reading, matching and extraction as a file uploaded on its own.
 *
 * ── What is refused, and why ────────────────────────────────────────────────
 * Every rule here is a limit on what an archive can make the server do:
 *   - an entry is read only after its declared uncompressed size is checked
 *     (a small archive that inflates to gigabytes is a zip bomb);
 *   - a nested archive is rejected, never opened (bounded depth);
 *   - entry count and total inflated bytes are capped;
 *   - only the types a returned document may be — the archive is not a way
 *     around RETURN_MIMES;
 *   - Finder's __MACOSX resource forks and dotfiles are skipped silently,
 *     because they are noise, not a decision for the Owner.
 * The file name kept is the entry's base name; the folder path survives as
 * the document title so the Owner can still see how it was organised.
 */

const JSZip = require('jszip');

/** The types a returned document may be, by extension. Mirrors RETURN_MIMES. */
const EXT_MIMES = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain',
};

const ZIP_MIMES = ['application/zip', 'application/x-zip-compressed'];

const LIMITS = {
  maxEntries: 40,                    // decisions an Owner can reasonably review from one drop
  maxEntryBytes: 10 * 1024 * 1024,   // the single-file limit, applied per entry
  maxTotalBytes: 60 * 1024 * 1024,   // inflated, across the archive
};

function isZipMime(mime) { return ZIP_MIMES.includes(String(mime || '').toLowerCase()); }

function baseName(entryName) {
  return String(entryName).split('/').pop();
}

/**
 * @param {Buffer} buffer  the archive
 * @param {object} [limits]
 * @returns {Promise<{ files: Array<{fileName, fileMime, title, buffer}>, rejected: Array<{fileName, reason}> }>}
 */
async function expandZip(buffer, limits = {}) {
  const L = { ...LIMITS, ...limits };
  const files = []; const rejected = [];
  let zip;
  try { zip = await JSZip.loadAsync(buffer); } catch (_) {
    return { files, rejected: [{ fileName: 'archive', reason: 'The ZIP could not be opened.' }] };
  }
  const entries = Object.values(zip.files).filter((e) => !e.dir);
  let considered = 0; let total = 0;
  for (const entry of entries) {
    const name = entry.name;
    const base = baseName(name);
    if (!base || base.startsWith('.') || /(^|\/)__MACOSX\//.test(name) || base === 'Thumbs.db') continue;
    considered += 1;
    if (considered > L.maxEntries) { rejected.push({ fileName: base, reason: `The ZIP holds more than ${L.maxEntries} files; the rest were not read.` }); continue; }
    const ext = base.includes('.') ? base.split('.').pop().toLowerCase() : '';
    if (ext === 'zip') { rejected.push({ fileName: base, reason: 'A ZIP inside the ZIP is not opened. Upload it on its own.' }); continue; }
    const fileMime = EXT_MIMES[ext];
    if (!fileMime) { rejected.push({ fileName: base, reason: 'That file type is not accepted. Use PDF, Word, PNG, JPEG or text.' }); continue; }
    if (/\.\./.test(base)) { rejected.push({ fileName: base, reason: 'The file name is not valid.' }); continue; }
    // Declared size first: nothing is inflated before it is known to fit.
    const declared = entry._data && Number.isFinite(entry._data.uncompressedSize) ? entry._data.uncompressedSize : null;
    if (declared != null && declared > L.maxEntryBytes) { rejected.push({ fileName: base, reason: 'That file is too large (10 MB limit).' }); continue; }
    if (declared != null && total + declared > L.maxTotalBytes) { rejected.push({ fileName: base, reason: 'The ZIP is too large once unpacked; the rest were not read.' }); continue; }
    let bytes;
    try { bytes = await entry.async('nodebuffer'); } catch (_) { rejected.push({ fileName: base, reason: 'The file could not be read from the ZIP.' }); continue; }
    if (!bytes.length) { rejected.push({ fileName: base, reason: 'The file is empty.' }); continue; }
    if (bytes.length > L.maxEntryBytes) { rejected.push({ fileName: base, reason: 'That file is too large (10 MB limit).' }); continue; }
    total += bytes.length;
    if (total > L.maxTotalBytes) { rejected.push({ fileName: base, reason: 'The ZIP is too large once unpacked; the rest were not read.' }); continue; }
    const folder = name.slice(0, name.length - base.length).replace(/\/$/, '');
    files.push({ fileName: base.slice(0, 255), fileMime, title: (folder ? `${folder} / ${base}` : base).slice(0, 250), buffer: bytes });
  }
  return { files, rejected };
}

module.exports = { expandZip, isZipMime, ZIP_MIMES, EXT_MIMES, LIMITS };
