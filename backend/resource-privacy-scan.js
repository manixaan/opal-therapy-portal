'use strict';

/**
 * CONTENT-EVIDENCE privacy detection for Resource Hub documents.
 *
 * One module, consulted by every path that can put bytes in front of staff:
 * the upload route, the file quality gate, and any future ingestion run. The
 * 2026-08-15 audit found a hosted plan template carrying a real participant's
 * NDIS number precisely because the bulk import trusted file-level (path and
 * filename) review alone — content evidence is the layer that catches what
 * naming conventions miss.
 *
 * THE DISTINCTION THAT MATTERS
 * `Client Name: ____________` on a blank worksheet is a template label.
 * `Client Name: <a capitalised name>` is a disclosure. Every detector here
 * requires the LABEL AND A FILLED VALUE together before it counts a strong
 * signal, so publishing blank templates stays uneventful while a completed
 * form quarantines.
 *
 * Findings carry pattern names and counts ONLY. Matched text is never stored,
 * returned or logged — copying the identifier into a report would be the
 * problem being detected. (Same rule as resource-file-quality.js and
 * setup/scan-resource-source.js, which these detectors mirror.)
 *
 * Verdicts fail toward review: any strong signal → 'client-confidential';
 * weak-only → 'privacy-review'; neither → 'no-obvious-pii'. Callers must treat
 * anything except 'no-obvious-pii' as "do not publish without a human".
 */

/** Words after a person-label that are instructions or labels, not a name. */
const NOT_A_NAME = /^(?:name|date|dob|the|a|an|please|write|draw|insert|type|enter|your|their|his|her|signature|address|phone|details?|surname|first|given|of|to|and|or|will|has|is|was|can|may|n\/?a|tbc|tba|x{2,}|sample|example|template|form|worksheet|here|below|above|print)\b/i;

/** A plausible filled name: 2–4 capitalised words. */
const NAME_SHAPE = /^[A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+){1,3}$/;

/** Value part is blank when it is underscores, dots, dashes or nothing. */
const BLANK_VALUE = /^[\s_.\-…:]*$/;

/** Content-control/template placeholder phrases that are not values. */
const PLACEHOLDER_VALUE = /click (?:here )?to enter|choose an item|select (?:a|an) |\[insert/i;

const LABELS = {
  personName: /\b(?:client|patient|participant|child|student|young\s+person)(?:['’]s)?\s*(?:full\s+|first\s+|given\s+|preferred\s+)?name\s*[:\-]\s*([^\n\r]{0,60})/gi,
  personBare: /\b(?:client|patient|participant)\s*[:\-]\s*([^\n\r]{0,60})/gi,
  guardianName: /\b(?:parent|guardian|carer|caregiver)(?:['’]s)?\s*(?:name)?\s*[:\-]\s*([^\n\r]{0,60})/gi,
  dob: /\b(?:d\.?o\.?b\.?|date\s+of\s+birth|birth\s*date)\s*[:\-]?\s*((?:0?[1-9]|[12]\d|3[01])[/\-. ](?:0?[1-9]|1[0-2]|[A-Za-z]{3,9})[/\-. ](?:19|20)\d{2})/gi,
  addressField: /\baddress\s*[:\-]\s*(\d+[^\n\r]{4,60}?(?:street|st|road|rd|avenue|ave|court|ct|drive|dr|place|pl|crescent|cres|parade|pde|way|close|cl|terrace|tce|circuit|cct|boulevard|blvd)\b)/gi,
  phoneField: /\b(?:phone|mobile|contact\s*number|ph|mob)\.?\s*[:\-]\s*((?:\+?61|0)[2-478](?:[ \-]?\d){8})/gi,
};

// Bare identifiers that are strong on their own, matching the vault scanner
// (setup/scan-resource-source.js): an NDIS participant number or a
// Medicare-shaped number has no legitimate reason to appear in a library
// worksheet at all, labelled or not.
const NDIS_NUMBER = /\b43\d{7}\b/g;
const MEDICARE_NUMBER = /\b[2-6]\d{3}\s?\d{5}\s?\d\b/g;

function filledName(raw) {
  if (raw === undefined || raw === null) return false;
  let v = String(raw).normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!v || BLANK_VALUE.test(v) || PLACEHOLDER_VALUE.test(v)) return false;
  // Strip a following label that bled into the capture ("Jane Doe DOB:").
  v = v.split(/\b(?:dob|d\.o\.b|date of birth|age|address|ndis|phone)\b/i)[0].trim().replace(/[:\-_\s]+$/, '');
  if (!v || BLANK_VALUE.test(v) || NOT_A_NAME.test(v)) return false;
  return NAME_SHAPE.test(v);
}

function filledValue(raw) {
  if (raw === undefined || raw === null) return false;
  const v = String(raw).trim();
  return !!v && !BLANK_VALUE.test(v) && !PLACEHOLDER_VALUE.test(v);
}

function countMatches(text, re, judge) {
  let n = 0;
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (!judge || judge(m[1])) n += 1;
    if (m.index === re.lastIndex) re.lastIndex += 1; // zero-width safety
  }
  return n;
}

/**
 * Scan extracted document text for evidence of a real person's completed
 * details.
 *
 * @param {string} text plain text extracted from the document
 * @returns {{
 *   strong: Array<{kind: string, count: number}>,
 *   weak: Array<{kind: string, count: number}>,
 *   verdict: 'client-confidential'|'privacy-review'|'no-obvious-pii'
 * }}
 */
function scanTextForClientContent(text) {
  const t = String(text || '');
  const strong = [];
  const weak = [];
  const add = (list, kind, count) => { if (count > 0) list.push({ kind, count }); };

  add(strong, 'populated-client-name-field',
    countMatches(t, LABELS.personName, filledName) + countMatches(t, LABELS.personBare, filledName));
  add(strong, 'populated-date-of-birth-field', countMatches(t, LABELS.dob, filledValue));
  add(strong, 'populated-address-field', countMatches(t, LABELS.addressField, filledValue));
  add(strong, 'ndis-participant-number', (t.match(NDIS_NUMBER) || []).length);
  add(strong, 'medicare-shaped-number', (t.match(MEDICARE_NUMBER) || []).length);

  add(weak, 'populated-guardian-name-field', countMatches(t, LABELS.guardianName, filledName));
  add(weak, 'populated-phone-field', countMatches(t, LABELS.phoneField, filledValue));

  let verdict = 'no-obvious-pii';
  if (strong.length) verdict = 'client-confidential';
  else if (weak.length) verdict = 'privacy-review';
  return { strong, weak, verdict };
}

/** True when the verdict forbids publishing without human review. */
function requiresHumanReview(verdict) {
  return verdict !== 'no-obvious-pii';
}

module.exports = { scanTextForClientContent, requiresHumanReview };
