'use strict';

/**
 * SERVER-ISSUED DOCUMENT CONTROL VALUES — pure, shared by every Opal document
 * type so a report and a letter number themselves the same way.
 *
 * The convention was set by the FCA report and is reproduced here verbatim:
 * a short uppercase document-type prefix, a hyphen, and the first eight
 * characters of the draft's uuid in upper case. It is short enough to read
 * aloud over the phone, unique in practice, and — because it is derived from
 * an id the database already holds — it needs no counter table and cannot
 * drift between the footer of the document and the row that produced it.
 *
 *   FCA report            FCA-1A2B3C4D
 *   Progress note letter  LTR-1A2B3C4D
 */

/** `${PREFIX}-${first 8 of the draft uuid, upper case}`. */
function documentReference(prefix, draftId) {
  return `${prefix}-${String(draftId).slice(0, 8).toUpperCase()}`;
}

/**
 * Australian English date rendering for a server-issued date: DD/MM/YYYY.
 * The ISO components are read in UTC — the process is pinned to UTC and a
 * document date must not shift by a day for a reader in another timezone.
 */
function australianDate(date) {
  const iso = date.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

module.exports = { documentReference, australianDate };
