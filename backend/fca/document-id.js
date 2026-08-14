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
 *
 * ── ISSUED, NOT LOOKED UP ───────────────────────────────────────────────────
 * A document reference, a document date, a version and a status are not facts
 * about the world that Opal might or might not hold — they are Opal's to
 * issue. Showing them as "Missing" in the review step was a category error: a
 * therapist cannot go and find the document id of a document that does not
 * exist yet.
 *
 * So they are issued ONCE, when the draft is created, and stored on the draft.
 * Everything downstream reads that stored value, which is what makes
 * regenerating a report safe: a second generation cannot mint a second
 * reference, because it does not mint anything at all.
 *
 * This is emphatically NOT licence to invent the rest. An issue date, a
 * reviewer's name and role, and the list of authorised recipients are real
 * facts about the world that Opal genuinely does not hold, and they stay
 * missing until a human supplies them.
 */

/** `${PREFIX}-${first 8 of the draft uuid, upper case}`. */
function documentReference(prefix, draftId) {
  return `${prefix}-${String(draftId).slice(0, 8).toUpperCase()}`;
}

/** A brand new document is version 1.0 and is a Draft until someone says otherwise. */
const INITIAL_DOCUMENT_VERSION = '1.0';
const INITIAL_DOCUMENT_STATUS = 'Draft';

/**
 * Australian English date rendering for a server-issued date: DD/MM/YYYY.
 * The ISO components are read in UTC — the process is pinned to UTC and a
 * document date must not shift by a day for a reader in another timezone.
 */
function australianDate(date) {
  const iso = date.toISOString().slice(0, 10);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * Every server-issued document-control value for one draft, in the shape
 * resolve-scalars.js reads (`server.<field>` per the template map).
 *
 * @param {string} prefix    the document type's reference prefix ('FCA', 'LTR')
 * @param {string} draftId   the draft uuid
 * @param {Date}   issuedAt  when the draft was created
 */
function issueDocumentControl(prefix, draftId, issuedAt) {
  return {
    documentReference: documentReference(prefix, draftId),
    reportDate: australianDate(issuedAt instanceof Date && !Number.isNaN(issuedAt.getTime())
      ? issuedAt
      : new Date()),
    reportVersion: INITIAL_DOCUMENT_VERSION,
    reportStatus: INITIAL_DOCUMENT_STATUS,
  };
}

/**
 * The stored document-control values for a draft, with every gap filled the
 * way it would have been filled at creation.
 *
 * A draft created before this behaviour existed carries '{}', so its values are
 * derived from the two facts the row has always had — its id and its
 * created_at. That yields exactly the reference it would always have been
 * given, so an older draft is not renumbered by the upgrade either.
 */
function documentControlFor(prefix, row) {
  const stored = row && row.document_control && typeof row.document_control === 'object'
    ? row.document_control
    : {};
  const createdAt = row && row.created_at ? new Date(row.created_at) : new Date();
  const issued = issueDocumentControl(prefix, row ? row.id : '', createdAt);
  return {
    documentReference: stored.documentReference || issued.documentReference,
    reportDate: stored.reportDate || issued.reportDate,
    reportVersion: stored.reportVersion || issued.reportVersion,
    reportStatus: stored.reportStatus || issued.reportStatus,
  };
}

module.exports = {
  documentReference,
  australianDate,
  issueDocumentControl,
  documentControlFor,
  INITIAL_DOCUMENT_VERSION,
  INITIAL_DOCUMENT_STATUS,
};
