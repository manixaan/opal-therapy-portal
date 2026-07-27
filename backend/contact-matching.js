'use strict';

/**
 * CONTACT MATCHING ENGINE (pure — no I/O)
 *
 * Suggests Splose-client → Xero-contact mappings using the confidence ladder
 * from the Phase 2 plan:
 *
 *   stored mapping            → safe   (reason 'existing')   status mapped
 *   email exact (unique)      → high   (reason 'email')      status needs_review
 *   name exact (unique)       → medium (reason 'name_exact') status needs_review
 *   name fuzzy (unique)       → low    (reason 'name_fuzzy') status needs_review
 *   multiple plausible        → low    (reason 'multiple')   status needs_review
 *   none                      → —      (reason 'none')       status unmapped
 *
 * NOTHING here writes to Xero and nothing auto-confirms: every non-'existing'
 * suggestion requires an explicit owner decision. ContactID is the only
 * stable key ever stored.
 */

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function normEmail(s) {
  return String(s || '').toLowerCase().trim();
}

/** Loose containment match on normalised names ("Jane Smith" ~ "Smith, Jane (NDIS)"). */
function fuzzyNameMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return false; // exact handled separately
  const aw = a.split(' ').filter(w => w.length > 1);
  const bw = new Set(b.split(' ').filter(w => w.length > 1));
  if (aw.length < 2 || bw.size < 2) return false;
  return aw.every(w => bw.has(w)) || [...bw].every(w => aw.includes(w));
}

/**
 * @param sploseClients  [{ id, fullName, email }]
 * @param xeroContacts   [{ xero_contact_id, name, email }]  (cache rows)
 * @param existingMappings [{ splose_client_id, xero_contact_id, status }]
 * @returns suggestions: one entry per Splose client —
 *   { sploseClientId, xeroContactId|null, confidence, matchReason, status }
 */
function suggestContactMatches(sploseClients, xeroContacts, existingMappings = []) {
  const mapped = new Map();
  for (const m of existingMappings) {
    if (m.xero_contact_id && m.status === 'mapped') mapped.set(String(m.splose_client_id), m);
  }
  const byEmail = new Map();
  for (const c of xeroContacts) {
    const e = normEmail(c.email);
    if (!e) continue;
    if (!byEmail.has(e)) byEmail.set(e, []);
    byEmail.get(e).push(c);
  }

  const out = [];
  for (const client of sploseClients || []) {
    const id = String(client.id);
    const existing = mapped.get(id);
    if (existing) {
      out.push({ sploseClientId: id, xeroContactId: existing.xero_contact_id,
        confidence: 'high', matchReason: 'existing', status: 'mapped' });
      continue;
    }

    const email = normEmail(client.email);
    const emailHits = email ? (byEmail.get(email) || []) : [];
    if (emailHits.length === 1) {
      out.push({ sploseClientId: id, xeroContactId: emailHits[0].xero_contact_id,
        confidence: 'high', matchReason: 'email', status: 'needs_review' });
      continue;
    }
    if (emailHits.length > 1) {
      out.push({ sploseClientId: id, xeroContactId: null,
        confidence: 'low', matchReason: 'multiple', status: 'needs_review' });
      continue;
    }

    const name = normName(client.fullName);
    const exact = name ? xeroContacts.filter(c => normName(c.name) === name) : [];
    if (exact.length === 1) {
      out.push({ sploseClientId: id, xeroContactId: exact[0].xero_contact_id,
        confidence: 'medium', matchReason: 'name_exact', status: 'needs_review' });
      continue;
    }
    if (exact.length > 1) {
      out.push({ sploseClientId: id, xeroContactId: null,
        confidence: 'low', matchReason: 'multiple', status: 'needs_review' });
      continue;
    }

    const fuzzy = name ? xeroContacts.filter(c => fuzzyNameMatch(name, normName(c.name))) : [];
    if (fuzzy.length === 1) {
      out.push({ sploseClientId: id, xeroContactId: fuzzy[0].xero_contact_id,
        confidence: 'low', matchReason: 'name_fuzzy', status: 'needs_review' });
      continue;
    }
    if (fuzzy.length > 1) {
      out.push({ sploseClientId: id, xeroContactId: null,
        confidence: 'low', matchReason: 'multiple', status: 'needs_review' });
      continue;
    }

    out.push({ sploseClientId: id, xeroContactId: null,
      confidence: null, matchReason: 'none', status: 'unmapped' });
  }
  return out;
}

module.exports = { suggestContactMatches, normName, normEmail, fuzzyNameMatch };
