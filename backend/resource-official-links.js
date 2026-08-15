'use strict';

/**
 * Canonical publisher pages verified by hand on 11 August 2026.
 *
 * WHY THIS FILE IS A LIST AND NOT A LOOKUP
 * The `7 Resources` catalogue contains no URLs — not one field in any of its
 * 650 records holds a web address. Every link below was found by searching for
 * the publisher and title, then opening the page and reading it back. Nothing
 * here was derived from a filename, guessed from a publisher's URL pattern, or
 * inferred from a document's contents.
 *
 * That is why the list is short. The brief's instruction — "Never invent an
 * official URL" — rules out the obvious shortcut of constructing plausible
 * addresses for the remaining items, so they stay in the verification queue
 * where a human can resolve them.
 *
 * LANDING PAGES, NOT PDFs
 * Each `url` is the publisher's HTML landing page rather than a direct PDF.
 * Landing pages survive the publisher reorganising their files, they carry the
 * publisher's own branding and copyright notice, and they show the current
 * edition rather than the one that happened to be downloaded years ago.
 *
 * `pageTitleSeen` is the title as it actually rendered, kept so a future link
 * check can tell "the publisher retitled this page" apart from "this link now
 * points somewhere else entirely".
 */

const CHECKED_ON = '2026-08-11';
/** Six months. Government and health publishers reorganise often enough. */
const NEXT_REVIEW = '2027-02-11';

const VERIFIED_LINKS = [
  {
    catalogueIds: ['res-0059', 'res-0060', 'res-0067'],
    title: 'Facing Your Feelings — tolerating distress workbook',
    url: 'https://www.cci.health.wa.gov.au/Resources/Looking-After-Yourself/Tolerating-Distress',
    publisher: 'Centre for Clinical Interventions',
    publisherLong: 'Centre for Clinical Interventions, Department of Health, Western Australia',
    pageTitleSeen: 'Tolerating Distress Self-Help Resources - Information Sheets & Workbooks',
    sourceClass: 'nonprofit',
    copyrightSeen: 'Copyright 2025; All contents copyright Government of Western Australia',
    evidence: 'Page lists Module 1 "Understanding Distress Intolerance" and Module 2 "Accepting Distress", '
      + 'matching the three catalogued copies.',
  },
  {
    catalogueIds: ['res-0065', 'res-0066'],
    title: 'Eating disorders — information sheets',
    url: 'https://www.cci.health.wa.gov.au/Resources/Looking-After-Yourself/Disordered-Eating',
    publisher: 'Centre for Clinical Interventions',
    publisherLong: 'Centre for Clinical Interventions, Department of Health, Western Australia',
    pageTitleSeen: 'Eating Disorders Self-Help Resources - Information Sheets & Workbooks',
    sourceClass: 'nonprofit',
    copyrightSeen: 'Copyright 2025; All contents copyright Government of Western Australia',
    evidence: 'Page lists "Body Image and Body Dissatisfaction" and "Normal Eating vs. Disordered Eating".',
  },
  {
    catalogueIds: ['res-0467', 'res-0468'],
    title: 'Improving self-esteem — worksheets',
    url: 'https://www.cci.health.wa.gov.au/resources/looking-after-yourself/self-esteem',
    publisher: 'Centre for Clinical Interventions',
    publisherLong: 'Centre for Clinical Interventions, Department of Health, Western Australia',
    pageTitleSeen: 'Self-Esteem Self-Help Resources - Information Sheets & Workbooks',
    sourceClass: 'nonprofit',
    copyrightSeen: 'Copyright 2025; All contents copyright Government of Western Australia',
    evidence: 'Page lists "How Low Self-Esteem Begins" and "Positive Qualities Record".',
  },
  {
    catalogueIds: ['res-0525'],
    title: 'Manage your money — Easy Read information guide',
    url: 'https://cid.org.au/resource/manage-your-money/',
    publisher: 'Council for Intellectual Disability',
    publisherLong: 'NSW Council for Intellectual Disability',
    pageTitleSeen: 'Manage your money',
    sourceClass: 'nonprofit',
    copyrightSeen: '© The New South Wales Council for Intellectual Disability',
    evidence: 'Publisher page confirms the October 2020 Easy Read guide. No open licence is stated on the '
      + 'page, so link-only delivery is the correct treatment — a Creative Commons claim appears in a '
      + 'third-party catalogue record but not on the publisher\'s own page, and was not relied on.',
  },
  {
    catalogueIds: ['res-0527', 'res-0528'],
    title: 'Individualised living options (ILO)',
    url: 'https://ndis.gov.au/participants/home-and-living/types-home-and-living-supports/what-are-individualised-living-options-ilo',
    publisher: 'NDIS',
    publisherLong: 'National Disability Insurance Agency',
    pageTitleSeen: 'What are individualised living options (ILO) | NDIS',
    sourceClass: 'government-official',
    copyrightSeen: null,
    evidence: 'Both catalogued items ("Individualised living options", "Funding ILO supports") now resolve '
      + 'here: the older /ilo-right-you address redirects to this page, so the NDIA has consolidated them.',
  },
  {
    catalogueIds: ['res-0529'],
    title: 'Specialist disability accommodation (SDA) pricing arrangements',
    url: 'https://ndis.gov.au/providers/housing-and-living-supports-and-services/specialist-disability-accommodation/sda-pricing-and-payments',
    publisher: 'NDIS',
    publisherLong: 'National Disability Insurance Agency',
    pageTitleSeen: 'The specialist disability accommodation (SDA) pricing arrangements | NDIS',
    sourceClass: 'government-official',
    copyrightSeen: null,
    supersedesLocalCopy: true,
    evidence: 'Live page publishes the 2026-27 arrangements. The catalogued local copy is therefore a '
      + 'superseded edition and must not be circulated — pricing documents are reissued annually.',
  },
];

/**
 * Items whose canonical page could NOT be confirmed, and the specific reason.
 *
 * Recorded rather than dropped, because "we looked and could not confirm" is a
 * different state from "nobody has looked yet", and only the first one tells a
 * reviewer where to start.
 */
const UNVERIFIED_LINKS = [
  { catalogueId: 'res-0506', publisher: 'Summer Foundation',
    reason: 'Publisher page returns HTTP 403 to automated requests. The resource appears to exist; a human '
      + 'should confirm the current edition in a browser.' },
  { catalogueId: 'res-0301', publisher: 'Government health department',
    reason: 'Publisher not identified in the catalogue beyond "government health department". No canonical '
      + 'page can be chosen without knowing the jurisdiction.' },
  { catalogueId: 'res-0507', publisher: 'NDIS / NDIA',
    reason: 'A 2014 Independent Advisory Council paper. Likely superseded; needs a human to decide whether '
      + 'to link an archived copy or retire the record.' },
  { catalogueId: 'res-0511', publisher: 'NDIS / NDIA',
    reason: 'Title does not correspond to a published NDIA document. Possibly a provider-authored template '
      + 'misattributed to the NDIA — rights review, not link verification.' },
  { catalogueId: 'res-0512', publisher: 'NDIS / NDIA',
    reason: 'Catalogued as an extract, not a whole publication. Extracts must not be circulated; the source '
      + 'document needs identifying first.' },
  { catalogueId: 'res-0526', publisher: 'NDIS / NDIA',
    reason: 'A consultation paper. Consultation documents are usually withdrawn once the consultation '
      + 'closes; a human should confirm whether any current version exists.' },
  { catalogueId: 'res-0532', publisher: 'Government health department',
    reason: 'No matching regulatory bulletin located on the NDIS Commission site under this title.' },
  { catalogueId: 'res-0607', publisher: 'NDIS / NDIA',
    reason: 'Carries an internal document code (CQ S017), which indicates a provider template rather than '
      + 'an NDIA publication. Rights review, not link verification.' },
  { catalogueId: 'res-0611', publisher: 'NDIS / NDIA',
    reason: 'Generic template title with no identifiable NDIA publication. Likely provider-authored.' },
  { catalogueId: 'res-0629', publisher: 'NDIS / NDIA',
    reason: 'Generic tool title with no identifiable NDIA publication. Likely provider-authored.' },
];

/** catalogueId → verified link entry. */
function linkFor(catalogueId) {
  return VERIFIED_LINKS.find((l) => l.catalogueIds.includes(catalogueId)) || null;
}

function verifiedCatalogueIds() {
  return VERIFIED_LINKS.flatMap((l) => l.catalogueIds);
}

module.exports = {
  CHECKED_ON,
  NEXT_REVIEW,
  VERIFIED_LINKS,
  UNVERIFIED_LINKS,
  linkFor,
  verifiedCatalogueIds,
};
