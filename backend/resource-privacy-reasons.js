'use strict';

/**
 * WHY A FILE WAS REFUSED — the checklist a person can work through.
 *
 * The privacy gate (resource-file-intake.js) used to answer every refusal with
 * one sentence: "appears to contain a person's completed details". That is
 * true and useless — a 46-page report gives no hint whether the problem is a
 * participant number in the running header or the practice's own email on the
 * signature page. This turns the gate's findings into one item per kind:
 * what was found, how many times, on which PDF pages, and what to change.
 *
 * NEVER THE CONTENT. Items carry a kind, a count and page numbers — never the
 * matched text, never the words around it. The person uploading has the file
 * in front of them; the page number is enough to find it, and echoing the
 * value back would put the identifier into a response the gate exists to keep
 * it out of.
 *
 * Two kinds of item, and the difference is told to the person honestly:
 *   'personal' — what identifies a client: a participant or Medicare number,
 *                a filled-in name, date of birth, address, guardian or phone.
 *   'pattern'  — a shape the gate cannot tell apart from a client's, with no
 *                label beside it: any email address, any dd/mm/yyyy date, any
 *                phone number. Often harmless (a report date, the practice's
 *                own email) — but the gate refuses it all the same, and saying
 *                so is better than letting someone hunt for a client detail
 *                that is not there.
 */

/**
 * Kind (from resource-file-quality.js or resource-privacy-scan.js) → the item.
 * Kinds that mean the same thing to a person share an `id` and merge.
 */
const KINDS = Object.freeze({
  'ndis-participant-number': {
    id: 'ndis-number', type: 'personal',
    title: 'NDIS participant number',
    fix: 'Replace every 9-digit number starting with 43 with XXXXXXXXX — check the header and footer, not only the body.',
  },
  'medicare-number': {
    id: 'medicare-number', type: 'personal',
    title: 'Medicare-style number',
    fix: 'Remove or replace any 10-digit number (written as 4-5-1 digits) with X’s — reference or invoice numbers of that shape count too.',
  },
  'medicare-shaped-number': {
    id: 'medicare-number', type: 'personal',
    title: 'Medicare-style number',
    fix: 'Remove or replace any 10-digit number (written as 4-5-1 digits) with X’s — reference or invoice numbers of that shape count too.',
  },
  'populated-client-name-field': {
    id: 'client-name', type: 'personal',
    title: 'A filled-in client / participant name',
    fix: 'Blank the value after “Client name:”, “Participant:” and similar labels, or use XX.',
  },
  'populated-date-of-birth-field': {
    id: 'dob-field', type: 'personal',
    title: 'A filled-in date of birth',
    fix: 'Replace the value after “Date of birth” / “DOB” with XX/XX/XXXX.',
  },
  'populated-address-field': {
    id: 'address-field', type: 'personal',
    title: 'A filled-in street address',
    fix: 'Replace the value after “Address:” with a region or XX.',
  },
  'populated-guardian-name-field': {
    id: 'guardian-name', type: 'personal',
    title: 'A filled-in parent / guardian / carer name',
    fix: 'Blank the value after “Parent”, “Guardian” or “Carer” labels, or use XX.',
  },
  'populated-phone-field': {
    id: 'phone', type: 'personal',
    title: 'A filled-in phone number',
    fix: 'Remove the number after “Phone:” / “Mobile:” labels, or replace it with XXXX XXX XXX.',
  },
  'australian-phone': {
    id: 'phone', type: 'pattern',
    title: 'Phone number',
    fix: 'Remove phone numbers or replace them with XXXX XXX XXX — the practice’s own number counts too.',
  },
  'date-of-birth': {
    id: 'date', type: 'pattern',
    title: 'Date written as dd/mm/yyyy',
    fix: 'Replace each date with XX/XX/XXXX — report, plan, session and signature dates all count, not only a date of birth.',
  },
  email: {
    id: 'email', type: 'pattern',
    title: 'Email address',
    fix: 'Remove email addresses, including the practice’s own (for example in the contact or signature block).',
  },
});

/** Listed first: what really identifies someone, then the blunt patterns. */
const ORDER = ['ndis-number', 'medicare-number', 'client-name', 'dob-field', 'address-field',
  'guardian-name', 'phone', 'date', 'email'];

/** A kind nobody has described yet still gets an item — refusing silently is the bug. */
function fallback(kind) {
  return {
    id: `other:${kind}`, type: 'personal',
    title: 'Possible client detail',
    fix: 'Look for client-identifying information and remove it.',
  };
}

/**
 * Build the refusal checklist from a quality-gate report.
 *
 * @param {object} report  assessFile().report — identifierFindings, privacy,
 *                         findingPages (PDF only), pageCount (PDF only)
 * @returns {Array<{id, type, title, count, pages: number[], repeatsOnEveryPage: boolean, fix}>}
 */
function buildChecklist(report) {
  const r = report || {};
  const findings = []
    .concat(r.identifierFindings || [])
    .concat((r.privacy && r.privacy.strong) || [])
    .concat((r.privacy && r.privacy.weak) || []);
  const located = r.findingPages || {};
  const pageCount = Number(r.pageCount) || 0;

  const byId = new Map();
  for (const f of findings) {
    if (!f || !f.kind || !(f.count > 0)) continue;
    const def = KINDS[f.kind] || fallback(f.kind);
    const item = byId.get(def.id) || {
      id: def.id, type: def.type, title: def.title, fix: def.fix, count: 0, pages: new Set(),
    };
    // The two scanners see the same NDIS number twice; the larger count is the
    // honest one, not the sum.
    item.count = Math.max(item.count, f.count);
    // A personal finding outranks a pattern for the same id (a labelled phone
    // is personal even though a bare one is only a pattern).
    if (def.type === 'personal' && item.type !== 'personal') {
      Object.assign(item, { type: 'personal', title: def.title, fix: def.fix });
    }
    for (const p of located[f.kind] || []) item.pages.add(p);
    byId.set(def.id, item);
  }

  const rank = (id) => { const i = ORDER.indexOf(id); return i === -1 ? ORDER.length : i; };
  return [...byId.values()]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((item) => {
      const pages = [...item.pages].sort((a, b) => a - b);
      return {
        id: item.id,
        type: item.type,
        title: item.title,
        count: item.count,
        pages,
        // On (nearly) every page: almost certainly a running header or footer,
        // which is the one place people do not think to look.
        repeatsOnEveryPage: pageCount >= 3 && pages.length >= Math.ceil(pageCount * 0.8),
        fix: item.fix,
      };
    });
}

module.exports = { buildChecklist, KINDS };
