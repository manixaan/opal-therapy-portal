'use strict';

/**
 * RESOURCE PREVIEW POLICY — what may be shown in a browser, and how.
 *
 * Deliberately pure: no database, no express, no filesystem, no I/O. Every
 * decision the preview surface makes lives here so that
 *
 *   1. the route and the browser cannot disagree about what is previewable —
 *      the server computes the answer and the client obeys it, rather than each
 *      keeping its own list of extensions that drift apart; and
 *   2. the policy is unit-testable without a database or an HTTP server.
 *
 * TWO SEPARATE QUESTIONS, DELIBERATELY NOT ONE
 *
 *   previewKindFor()  — "how could this be rendered?"  A metadata answer.
 *   canInline()       — "may the bytes carry Content-Disposition: inline?"
 *
 * The second is much narrower than the first, and is keyed on `format` ALONE.
 * `format` is the same column that chooses the response Content-Type
 * (resource-file-storage.mimeForFormat), so exactly one stored value decides
 * both how the browser is told to interpret the bytes and whether it is invited
 * to render them in place. A stored MIME string is data written by whatever
 * created the row; letting it influence a response header would hand that
 * writer the ability to have a document rendered as something else. It never
 * gets a vote on headers here — it is consulted only to explain, in words, why
 * a file cannot be previewed.
 *
 * DOCX IS PREVIEWABLE BUT NEVER INLINE
 * The vendored docx-preview renderer fetches the bytes with JavaScript and
 * draws them into the page, so Content-Disposition is irrelevant to it and the
 * bytes stay 'attachment'. Only PDF and images — which a browser renders from
 * the response itself — are ever served inline.
 *
 * 'none' IS A FIRST-CLASS ANSWER
 * There is no LibreOffice, no pandoc and no ghostscript in this environment, so
 * legacy binary Office files genuinely cannot be converted. Saying so plainly,
 * with a reason a human can read, is better than opening a viewer that renders
 * a grey rectangle and leaves the reader wondering whether the document is
 * broken or the portal is.
 */

/** The complete previewKind vocabulary. The client must handle all five. */
const PREVIEW_KINDS = ['pdf', 'image', 'docx', 'bundle', 'none'];

/* ── Format allow-lists ─────────────────────────────────────────────────────
 * Keyed on `resource_files.format`, whose vocabulary is fixed by the CHECK
 * constraint in migration 026 ('pdf','docx','pptx','xlsx','png','jpg','link').
 * Legacy types (doc, ppt, zip, jpeg) are listed here as well because the
 * ingestion script stores format NULL for them and leaves the real type in
 * file_mime — see MIME_FORMAT_FALLBACK below. */

const PDF_FORMATS = ['pdf'];
const IMAGE_FORMATS = ['png', 'jpg', 'jpeg'];
const DOCX_FORMATS = ['docx'];
const BUNDLE_FORMATS = ['zip'];

/**
 * Formats whose bytes may be served with Content-Disposition: inline.
 *
 * Narrower than "previewable" on purpose. A format reaches this list only if a
 * browser can render it from the response without a converter AND the type we
 * declare for it is one that cannot execute: PDF in the built-in viewer, PNG
 * and JPEG as images. Nothing that a browser would parse as markup or script
 * can ever be added here — the response would still carry nosniff, but the
 * point of the list is that the question never arises.
 */
const INLINE_FORMATS = ['pdf', 'png', 'jpg', 'jpeg'];

/**
 * Types with no converter available on this machine, and the plain-words reason
 * each one cannot be rendered. Naming the missing tool matters: "unsupported"
 * invites someone to file a bug against the viewer, whereas "no converter is
 * installed" points at the actual, deliberate constraint.
 */
const NO_CONVERTER_FORMATS = {
  doc: 'Legacy Word (.doc) cannot be shown in the browser: converting it needs LibreOffice or pandoc, and neither is installed on this server. Download it to open in Word.',
  ppt: 'Legacy PowerPoint (.ppt) cannot be shown in the browser: converting it needs LibreOffice, which is not installed on this server. Download it to open in PowerPoint.',
  pptx: 'PowerPoint files cannot be shown in the browser: there is no slide renderer here and converting them needs LibreOffice, which is not installed on this server. Download it to open in PowerPoint.',
  xls: 'Spreadsheets cannot be shown in the browser: there is no spreadsheet renderer here and converting them needs LibreOffice, which is not installed on this server. Download it to open in Excel.',
  xlsx: 'Spreadsheets cannot be shown in the browser: there is no spreadsheet renderer here and converting them needs LibreOffice, which is not installed on this server. Download it to open in Excel.',
};

/** A 'link' resource has no stored bytes at all — a different thing entirely. */
const LINK_REASON = 'This resource is a link to an external source, not a file held in the hub, so there is nothing to preview.';

const NO_FORMAT_REASON = 'This file has no recorded type, so the server cannot say what it is safely enough to show it. Download it, or ask an administrator to record its format.';

const UNRECORDED_FORMAT_REASON = 'This file looks previewable, but its format was never recorded on the record itself. The server will not guess a type from stored metadata, so the file can be downloaded but not shown here.';

/**
 * MIME strings we recognise, and the format token each implies.
 *
 * Used ONLY as a fallback when `format` is NULL, and even then only to explain
 * a refusal or to identify a ZIP bundle — never to unlock inline rendering.
 * The ingestion script records format NULL for .doc, .ppt and .zip rather than
 * widening migration 026's CHECK constraint to suit an import, so without this
 * map every one of those files would report the same uninformative "no recorded
 * type" and a staff member would never learn that the .doc simply needs Word.
 */
const MIME_FORMAT_FALLBACK = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'application/msword': 'doc',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
};

/**
 * Normalise a stored format to a short, safe token.
 *
 * Anything that is not a plain short alphanumeric word becomes null rather than
 * being cleaned up, because a format column holding punctuation is a broken row
 * and treating it as a near-miss would be guessing. The narrow shape also means
 * a token can be echoed into a JSON reason without reflecting stored data.
 */
function normaliseFormat(format) {
  const s = String(format === null || format === undefined ? '' : format).trim().toLowerCase();
  return /^[a-z0-9]{1,20}$/.test(s) ? s : null;
}

/** The format a stored MIME implies, or null. Never consulted for headers. */
function formatFromMime(mime) {
  const s = String(mime === null || mime === undefined ? '' : mime).trim().toLowerCase();
  // Strip any parameters: 'application/pdf; charset=binary' is still a PDF.
  const base = s.split(';')[0].trim();
  return Object.prototype.hasOwnProperty.call(MIME_FORMAT_FALLBACK, base)
    ? MIME_FORMAT_FALLBACK[base]
    : null;
}

/**
 * May these bytes be served with Content-Disposition: inline?
 *
 * Keyed on `format` only — see the header. An unrecorded format is never
 * inline, which is the same conservative answer the Content-Type allow-list
 * gives it (application/octet-stream).
 */
function canInline(format) {
  const f = normaliseFormat(format);
  return f !== null && INLINE_FORMATS.indexOf(f) !== -1;
}

/**
 * The Content-Disposition token for a delivery.
 *
 * `requested` is untrusted query input. The only value that changes anything is
 * the exact string 'inline', and even that is honoured only for a format on the
 * inline allow-list. Everything else — absent, misspelt, an array from a
 * repeated query parameter, an object from a bracketed one — falls through to
 * 'attachment', which is the behaviour the route had before previews existed.
 */
function dispositionFor(format, requested) {
  const wants = typeof requested === 'string' && requested.trim().toLowerCase() === 'inline';
  return (wants && canInline(format)) ? 'inline' : 'attachment';
}

/**
 * Coerce a stored page count to a number the client can trust, or null.
 * Zero pages is not a page count, it is a failed inspection.
 */
function normalisePageCount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v < 1 || v > 100000) return null;
  return v;
}

/**
 * How, if at all, this file can be previewed.
 *
 * @param {object} file
 * @param {string} [file.format]              resource_files.format (authoritative)
 * @param {string} [file.mime]                resource_files.file_mime (explanatory only)
 * @param {number} [file.pageCount]           previously inspected page count, if any
 * @param {boolean} [file.hasFillableFields]  previously inspected AcroForm result
 * @returns {{previewKind: string, reason: string|null, pageCount: number|null,
 *            hasFillableFields: boolean}}
 */
function previewKindFor(file) {
  const f = file || {};
  const pageCount = normalisePageCount(f.pageCount);
  const fillable = f.hasFillableFields === true;

  const none = (reason) => ({
    previewKind: 'none', reason, pageCount: null, hasFillableFields: false,
  });

  let fmt = normaliseFormat(f.format);
  let fromMime = false;
  if (fmt === null) {
    fmt = formatFromMime(f.mime);
    fromMime = fmt !== null;
  }

  if (fmt === null) return none(NO_FORMAT_REASON);
  if (fmt === 'link') return none(LINK_REASON);

  // A ZIP listing is generated server-side as JSON, so it needs no declared
  // Content-Type for the bytes and can safely be identified from the MIME when
  // the format column is empty. The renderable kinds below cannot: they depend
  // on the format-keyed Content-Type the byte route will actually send, and an
  // unrecorded format means that type is application/octet-stream.
  if (BUNDLE_FORMATS.indexOf(fmt) !== -1) {
    return { previewKind: 'bundle', reason: null, pageCount: null, hasFillableFields: false };
  }

  const renderable = PDF_FORMATS.indexOf(fmt) !== -1
    || IMAGE_FORMATS.indexOf(fmt) !== -1
    || DOCX_FORMATS.indexOf(fmt) !== -1;

  if (renderable && fromMime) return none(UNRECORDED_FORMAT_REASON);

  if (PDF_FORMATS.indexOf(fmt) !== -1) {
    // Fillable fields are an AcroForm property, so the flag is meaningful for a
    // PDF and for nothing else. It is carried through to the client so a viewer
    // can say "this form is filled in your PDF reader, not here" rather than
    // silently showing a form nobody can type into.
    return { previewKind: 'pdf', reason: null, pageCount, hasFillableFields: fillable };
  }
  if (IMAGE_FORMATS.indexOf(fmt) !== -1) {
    return { previewKind: 'image', reason: null, pageCount: null, hasFillableFields: false };
  }
  if (DOCX_FORMATS.indexOf(fmt) !== -1) {
    return { previewKind: 'docx', reason: null, pageCount, hasFillableFields: false };
  }
  if (Object.prototype.hasOwnProperty.call(NO_CONVERTER_FORMATS, fmt)) {
    return none(NO_CONVERTER_FORMATS[fmt]);
  }

  // A known-shaped but unrecognised token. Safe to name: normaliseFormat has
  // already restricted it to at most twenty alphanumerics.
  return none(`Files of type .${fmt} have no viewer in this portal. Download the file to open it.`);
}

/**
 * True when this file is the editable companion of a PDF on the same resource.
 *
 * The hub routinely holds the same document twice — a PDF for reading and a
 * DOCX a clinician can adapt. Marking the editable one lets the UI offer it as
 * "editable copy" instead of presenting two files with near-identical names and
 * leaving the reader to guess. It is a labelling hint and grants nothing: both
 * files were already independently authorised before this was ever called.
 *
 * @param {object} file            the file being labelled
 * @param {object[]} siblings      the OTHER files the caller may already see
 */
function isEditableVariant(file, siblings) {
  const fmt = normaliseFormat(file && file.format) || formatFromMime(file && file.mime);
  if (fmt !== 'docx' && fmt !== 'doc') return false;
  return (siblings || []).some((s) => {
    if (!s || s === file) return false;
    const sf = normaliseFormat(s.format) || formatFromMime(s.mime);
    return sf === 'pdf';
  });
}

/* ── ZIP bundles ────────────────────────────────────────────────────────────
 *
 * A bundle is LISTED, never extracted. Nothing here writes a file, creates a
 * directory or resolves a path — the member names are strings on their way to a
 * JSON response, and the sanitiser below decides which of them are fit to be
 * shown at all.
 *
 * The names inside an archive are attacker-controlled in the general case: a
 * ZIP can carry '../../etc/cron.d/x', 'C:\Windows\System32\x' or a name full of
 * control characters. None of those can hurt this server, because we never act
 * on them — but they would be rendered in a staff member's browser and would
 * misrepresent what the archive contains, so they are refused rather than
 * displayed. */

/**
 * How many members a listing may contain.
 *
 * A ZIP's central directory can declare hundreds of thousands of entries in a
 * few kilobytes, so an uncapped listing is an unbounded response generated from
 * a tiny input. The cap is stated in the response (see the route's `reason`) so
 * a truncated listing never passes itself off as a complete one.
 */
const ZIP_MEMBER_LIMIT = 200;

/** Longest member name we will echo. Longer names are refused, not truncated. */
const ZIP_MEMBER_NAME_MAX = 200;

// Control characters, including CR, LF and NUL. Harmless in JSON, but a name
// containing them is not a name anybody meant to read.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/**
 * Is this member name safe to show?
 *
 * Refuses, rather than repairs: an absolute path, a traversal or a drive letter
 * inside an archive is a fact about that archive worth surfacing as a refusal,
 * and a "cleaned up" version of such a name would tell the reader the archive
 * contains something it does not.
 *
 * @returns {string|null} the name to display, or null if it must not be shown
 */
function safeZipMemberName(name) {
  if (typeof name !== 'string') return null;
  const n = name.trim();
  if (!n) return null;
  if (n.length > ZIP_MEMBER_NAME_MAX) return null;
  if (CONTROL_CHARS.test(n)) return null;
  if (n.startsWith('/') || n.startsWith('\\')) return null;   // absolute, and UNC
  if (/^[A-Za-z]:/.test(n)) return null;                      // drive letter
  if (n.indexOf('..') !== -1) return null;                    // traversal
  if (n.startsWith('~')) return null;                         // home expansion
  return n;
}

/**
 * Project raw archive entries into a listing fit for a JSON response.
 *
 * Directory entries are dropped (they are structure, not content), unsafe names
 * are counted and dropped, and the result is capped. The counts come back with
 * the listing so the route can tell the reader that what they are seeing is
 * partial — a silently shortened list is worse than no list.
 *
 * @param {{name: string, bytes: number, dir: boolean}[]} entries
 * @returns {{members: {name: string, bytes: number|null}[], total: number,
 *            truncated: boolean, rejected: number}}
 */
function safeZipMembers(entries) {
  const members = [];
  let total = 0;
  let rejected = 0;

  for (const entry of (entries || [])) {
    if (!entry || entry.dir === true) continue;
    const raw = entry.name;
    if (typeof raw === 'string' && raw.endsWith('/')) continue;  // directory by convention
    total++;
    const safe = safeZipMemberName(raw);
    if (safe === null) { rejected++; continue; }
    if (members.length >= ZIP_MEMBER_LIMIT) continue;            // counted, not listed
    // An absent declared size is null, not zero. Number(null) and Number('')
    // are both 0, which would report every unknown-size member as an empty
    // file — a stated fact where there is only a gap.
    const declared = entry.bytes;
    const bytes = (declared === null || declared === undefined || declared === '')
      ? NaN : Number(declared);
    members.push({
      name: safe,
      bytes: Number.isFinite(bytes) && bytes >= 0 ? Math.floor(bytes) : null,
    });
  }

  return {
    members,
    total,
    truncated: (total - rejected) > members.length,
    rejected,
  };
}

module.exports = {
  PREVIEW_KINDS,
  PDF_FORMATS,
  IMAGE_FORMATS,
  DOCX_FORMATS,
  BUNDLE_FORMATS,
  INLINE_FORMATS,
  NO_CONVERTER_FORMATS,
  MIME_FORMAT_FALLBACK,
  ZIP_MEMBER_LIMIT,
  ZIP_MEMBER_NAME_MAX,
  normaliseFormat,
  formatFromMime,
  normalisePageCount,
  canInline,
  dispositionFor,
  previewKindFor,
  isEditableVariant,
  safeZipMemberName,
  safeZipMembers,
};
