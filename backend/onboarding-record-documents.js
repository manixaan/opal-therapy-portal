'use strict';

/**
 * THE RECORD'S OWN DOCUMENTS — the Employment contract and the Position
 * description a starter acknowledges in the portal (migration 079).
 *
 * Both are personal to the record, so they are not library documents: the
 * Owner attaches them to the record (or, for the contract, generates it from
 * the practice's contract template and the agreed terms), and the starter's
 * acknowledgement is against exactly that file — its SHA-256 is recorded with
 * the acknowledgement. A requirement with nothing attached cannot be released
 * or acknowledged (audit B-5), and a file that still holds "[TO CONFIRM …]"
 * gaps is refused at upload (owner decision 4).
 */

const odb = require('./onboarding-db');

/** Requirement template code → the kind of record document that answers it. */
const KIND_BY_CODE = Object.freeze({
  REQ_CONTRACT: 'contract',
  REQ_POSITION_DESCRIPTION: 'position_description',
});
const CODE_BY_KIND = Object.freeze(Object.fromEntries(Object.entries(KIND_BY_CODE).map(([c, k]) => [k, c])));
const LABELS = Object.freeze({ contract: 'Employment contract', position_description: 'Position description' });
const KINDS = Object.keys(LABELS);

const kindFor = (templateCode) => KIND_BY_CODE[templateCode] || null;

/** The live file of a kind on a record, or null. */
async function liveDocument(assignmentId, kind, q = odb.pool) {
  if (!KINDS.includes(kind)) return null;
  const { rows } = await q.query(
    `SELECT d.*, u.name AS uploaded_by_name
       FROM onboarding_offer_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.assignment_id = $1 AND d.kind = $2 AND d.status = 'active'
      ORDER BY d.uploaded_at DESC LIMIT 1`,
    [assignmentId, kind]
  );
  return rows[0] || null;
}

/** Every record document, keyed by kind. */
async function liveDocuments(assignmentId) {
  const out = {};
  for (const kind of KINDS) out[kind] = await liveDocument(assignmentId, kind);
  return out;
}

/** The attached file answering a requirement, or null. */
async function forRequirement(assignmentId, templateCode) {
  const kind = kindFor(templateCode);
  return kind ? liveDocument(assignmentId, kind) : null;
}

async function bytesOf(doc) {
  return require('./onboarding-journey-db').readOfferDocumentBytes(doc);
}

module.exports = { KIND_BY_CODE, CODE_BY_KIND, LABELS, KINDS, kindFor, liveDocument, liveDocuments, forRequirement, bytesOf };
