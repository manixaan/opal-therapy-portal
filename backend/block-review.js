'use strict';

/**
 * BLOCK REVIEW — making sense of blocks booked outside the portal.
 *
 * Someone books straight into Outlook ("Assessment – Jane Citizen") or Splose
 * ("Client Appointment (booked in Splose)"). The row arrives with no booking
 * type, usually no client and often no place, so billing and travel skip it.
 * This module guesses the booking the way Smart Booking would have made it:
 *
 *   kind      from Splose's service when the block is a Splose appointment,
 *             otherwise from words in the title (and Teams/Zoom in the place)
 *   client    Splose's patient when there is one, otherwise a caseload client
 *             named in the title, or whose address is the block's location
 *   location  the block's own place, else the client's address for a
 *             face-to-face service (never for telehealth or MDT/MDU)
 *
 * Each field carries a confidence (high / medium / low) and where it came
 * from. When every field the booking type needs is high, the guess is applied
 * to the event and the review row says 'guessed' — the event is then held out
 * of invoicing until a person confirms it (billing/invoice-generation.js).
 * Anything short of that is 'needs_input': nothing is applied and the review
 * panel asks. A guess made only from Splose's own ids is 'confirmed' outright.
 *
 * Rules only — no model is called. Nothing is written to Outlook or Splose.
 * Audit and logs carry ids and counts, never titles, names or addresses.
 */

const { bookingGroup, CLIENT_RULE } = require('./booking-rules');

const CLASSIFIER_VERSION = 1;

// Splose service ids the practice books (mockup_v3.html BOOKING_LEAVES) — the
// fallback when the live service list cannot be read.
const KNOWN_SPLOSE_SERVICES = Object.freeze({
  '131003': 'assessment', '125821': 'initial', '166733': 'mdt',
  '487597': 'telehealth', '125320': 'therapy',
});

// Face-to-face kinds that never take the client's address by default
// (BOOKING_LEAVES noDefaultAddress): they can happen from anywhere.
const NO_DEFAULT_ADDRESS = new Set(['mdt', 'mdu', 'telehealth', 'telehealth-ei']);

// event_type the rest of the portal keys off, per booking group/kind.
function eventTypeFor(kind) {
  const group = bookingGroup(kind);
  if (group === 'direct') return 'therapy';
  if (group === 'report' || group === 'nf2f') return 'report';
  if (kind === 'pd') return 'cpd';
  if (kind === 'lunch') return 'lunch';
  if (kind === 'supervision') return 'meeting';
  return 'admin';
}

const VIRTUAL_PLACE = /\b(teams|zoom|google meet|webex|skype|telehealth|online|virtual|phone)\b|https?:\/\//i;

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}
function hasWord(hay, word) {
  if (!word) return false;
  return (' ' + hay + ' ').includes(' ' + word + ' ');
}

/** PURE — direct-service leaf for a Splose service name (mirrors directLeafForService). */
function leafForServiceName(name) {
  const t = String(name || '').toLowerCase();
  const ei = /early\s*intervention|under\s*9|\bu9\b/.test(t) ? '-ei' : '';
  if (/\bmdu\b/.test(t)) return ei ? null : 'mdu';
  if (/\bmdt\b/.test(t)) return ei ? null : 'mdt';
  if (/telehealth/.test(t)) return 'telehealth' + ei;
  if (/initial/.test(t)) return 'initial' + ei;
  if (/assessment/.test(t)) return 'assessment' + ei;
  if (/therapy/.test(t)) return 'therapy' + ei;
  return null;
}

// Title words → booking kind. First match wins, so the specific come first.
const KIND_RULES = [
  [/\bfca\b|functional capacity/, 'fca'],
  [/assistive tech|\bat (report|assessment|trial)\b/, 'at-report'],
  [/progress report/, 'progress-report'],
  [/support letter|letter of support/, 'support-letter'],
  [/case ?not(e|es|ing)\b/, 'case-noting'],
  [/case management|case mgmt/, 'case-management'],
  [/resource|session prep|\bprep\b/, 'resource-prep'],
  [/\bemails?\b/, 'emails'],
  [/phone call|\bcalls?\b/, 'phone-calls'],
  [/supervision/, 'supervision'],
  [/\bpd\b|\bcpd\b|professional development|training|webinar|conference/, 'pd'],
  [/\blunch\b/, 'lunch'],
  [/\bmdu\b/, 'mdu'],
  [/\bmdt\b|multi ?disciplinary/, 'mdt'],
  [/telehealth|video (call|session)/, 'telehealth'],
  [/\binitial\b|\bintake\b/, 'initial'],
  [/assessment|\bwhodas\b/, 'assessment'],
  [/therapy|\bsession\b|\bot\b|appointment|\bappt\b|home visit|school visit/, 'therapy'],
];
const EI_RE = /early intervention|under 9|\bu9\b|\bei\b/;
const EI_KINDS = new Set(['assessment', 'initial', 'telehealth', 'therapy']);

/** PURE — booking kind from a block's title (and place). */
function kindFromText(title, location) {
  const t = ' ' + norm(title) + ' ';
  let kind = null;
  for (const [re, k] of KIND_RULES) { if (re.test(t)) { kind = k; break; } }
  if (!kind) return null;
  // A Teams/Zoom place turns a plain session into telehealth.
  if (kind === 'therapy' && location && VIRTUAL_PLACE.test(location)) kind = 'telehealth';
  if (EI_KINDS.has(kind) && EI_RE.test(t)) kind += '-ei';
  return kind;
}

function streetOf(address) {
  // "12 Example St, Applecross WA 6153" → "12 example st"
  const first = String(address || '').split(',')[0];
  const n = norm(first);
  return /\d/.test(n) && n.length >= 6 ? n : null;
}

/**
 * PURE — which caseload client a block is for, from its title and location.
 * Returns { client, confidence, source, candidates } or null.
 */
function clientFromText(title, location, clients) {
  const t = norm(title);
  const full = [];
  const initial = [];
  const firstOnly = [];
  for (const c of clients || []) {
    const parts = norm(c.fullName).split(' ').filter(Boolean);
    if (parts.length < 2) continue;
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (hasWord(t, first) && hasWord(t, last)) full.push(c);
    else if (hasWord(t, last) && hasWord(t, first[0])) initial.push(c);
    else if (first.length >= 3 && hasWord(t, first)) firstOnly.push(c);
  }
  const loc = norm(location);
  const byAddress = loc ? (clients || []).filter(c => { const s = streetOf(c.formattedAddress); return s && loc.includes(s); }) : [];

  const pick = (list, confidence, source) => {
    if (list.length === 1) return { client: list[0], confidence, source, candidates: list };
    return { client: null, confidence: 'low', source, candidates: list.slice(0, 5) };
  };
  if (full.length) {
    if (full.length === 1) return pick(full, 'high', 'title');
    // Several clients named — the address may say which.
    const both = full.filter(c => byAddress.includes(c));
    return both.length === 1 ? pick(both, 'high', 'title+address') : pick(full, 'low', 'title');
  }
  if (byAddress.length === 1) {
    const corroborated = initial.includes(byAddress[0]) || firstOnly.includes(byAddress[0]);
    return pick(byAddress, corroborated ? 'high' : 'medium', 'address');
  }
  if (initial.length) return pick(initial, initial.length === 1 ? 'medium' : 'low', 'title');
  if (firstOnly.length) return pick(firstOnly, 'low', 'title');
  return null;
}

/**
 * PURE — the whole guess for one block.
 *
 * @param {object} ev        events row (title, location, event_type, client_id,
 *                           client_name, splose_id, is_teams_meeting, custom_metadata)
 * @param {object} ctx
 * @param {Array}  ctx.clients       caseload clients {id, fullName, formattedAddress}
 * @param {string} [ctx.serviceName] the Splose appointment's service name, if known
 * @param {string} [ctx.serviceId]   the Splose appointment's service id, if known
 * @returns {{ status, kind, group, client, location, fields, missing, eventType }}
 */
function classifyBlock(ev, ctx = {}) {
  const clients = ctx.clients || [];
  const fields = {};
  const location = String(ev.location || '').trim();
  const virtual = !!ev.is_teams_meeting || ev.event_type === 'teams_meeting' || (location && VIRTUAL_PLACE.test(location));

  // ── Kind ─────────────────────────────────────────────────────────────────
  let kind = null;
  const svcLeaf = ctx.serviceName ? leafForServiceName(ctx.serviceName)
    : (ctx.serviceId != null ? KNOWN_SPLOSE_SERVICES[String(ctx.serviceId)] || null : null);
  if (svcLeaf) {
    kind = svcLeaf;
    fields.kind = { value: kind, confidence: 'high', source: 'splose' };
  } else {
    // The portal's own placeholder title for a Splose import says nothing.
    const k = /booked in splose/i.test(ev.title || '') ? null : kindFromText(ev.title, location);
    if (k) {
      kind = k;
      fields.kind = { value: kind, confidence: 'high', source: 'title' };
    } else if (ev.splose_id || ev.event_type === 'therapy') {
      // A Splose appointment, or Outlook's "Client Appointments" category:
      // a client session of some sort, but which one is a guess.
      kind = virtual ? 'telehealth' : 'therapy';
      fields.kind = { value: kind, confidence: 'medium', source: ev.splose_id ? 'splose' : 'category' };
    } else if (virtual) {
      kind = 'telehealth';
      fields.kind = { value: kind, confidence: 'low', source: 'location' };
    } else {
      fields.kind = { value: null, confidence: 'none', source: null };
    }
  }
  const group = kind ? bookingGroup(kind) : null;
  const clientRule = group ? CLIENT_RULE[group] : 'optional';

  // ── Client ───────────────────────────────────────────────────────────────
  let client = null;
  if (ev.client_id) {
    const known = clients.find(c => String(c.id) === String(ev.client_id));
    client = { id: String(ev.client_id), fullName: (known && known.fullName) || ev.client_name || null,
      formattedAddress: (known && known.formattedAddress) || null };
    fields.client = { value: client.id, confidence: 'high', source: ev.splose_id ? 'splose' : 'event' };
  } else if (clientRule !== 'none') {
    const m = clientFromText(ev.title, location, clients);
    if (m && m.client) {
      client = { id: String(m.client.id), fullName: m.client.fullName || null, formattedAddress: m.client.formattedAddress || null };
      fields.client = { value: client.id, confidence: m.confidence, source: m.source };
    } else {
      fields.client = { value: null, confidence: 'none', source: m ? m.source : null,
        candidates: m ? m.candidates.map(c => String(c.id)) : [] };
    }
  } else {
    fields.client = { value: null, confidence: 'n/a', source: null };
  }

  // ── Location ─────────────────────────────────────────────────────────────
  let place = null;
  const needsPlace = group === 'direct' && !NO_DEFAULT_ADDRESS.has(kind) && !virtual;
  if (location && !VIRTUAL_PLACE.test(location)) {
    place = location;
    fields.location = { value: place, confidence: 'high', source: 'event' };
  } else if (needsPlace && client && client.formattedAddress) {
    place = client.formattedAddress;
    fields.location = { value: place, confidence: fields.client.confidence === 'high' ? 'high' : 'medium', source: 'client_address' };
  } else if (needsPlace) {
    fields.location = { value: null, confidence: 'none', source: null };
  } else {
    fields.location = { value: null, confidence: 'n/a', source: virtual ? 'virtual' : null };
  }

  // ── Verdict ──────────────────────────────────────────────────────────────
  const missing = [];
  const unsure = [];
  if (!kind) missing.push('kind');
  else if (fields.kind.confidence !== 'high') unsure.push('kind');
  if (clientRule === 'required') {
    if (!client) missing.push('client');
    else if (fields.client.confidence !== 'high') unsure.push('client');
  }
  if (needsPlace) {
    if (!place) missing.push('location');
    else if (fields.location.confidence !== 'high') unsure.push('location');
  }
  let status;
  if (missing.length || unsure.length) status = 'needs_input';
  else {
    // Settled by Splose's own records (and the block's own place) alone: there
    // is nothing for a person to check.
    const authoritative = Object.values(fields).every(f => !f.value || ['splose', 'event'].includes(f.source));
    status = authoritative ? 'confirmed' : 'guessed';
  }

  return {
    status, kind, group, eventType: kind ? eventTypeFor(kind) : null,
    client: client && clientRule !== 'none' ? client : null,
    location: place, virtual, fields, missing, unsure,
  };
}

/** PURE — what a guess was made from; a change means look again. */
function fingerprintOf(ev) {
  const t = (v) => (v instanceof Date ? v.toISOString() : String(v || ''));
  return [norm(ev.title), norm(ev.location), t(ev.start_time), t(ev.end_time), String(ev.client_id || '')].join('|');
}

/** PURE — the booking object a portal booking would carry (booking-rules.js shape). */
function bookingFor(kind, client) {
  const group = bookingGroup(kind);
  const withClient = client && CLIENT_RULE[group] !== 'none';
  const b = { kind, group, clientId: withClient ? String(client.id) : null, clientName: withClient ? (client.fullName || null) : null };
  if (group === 'nf2f' && withClient) b.clients = [{ clientId: b.clientId, clientName: b.clientName }];
  return b;
}

// ── Service: sweep, apply, confirm, dismiss ─────────────────────────────────

const SWEEP_LIMIT = 300;
const SPLOSE_LOOKUPS_PER_SWEEP = 25;

function createBlockReview({ db, sploseApi, log = () => {} }) {
  const pool = db.pool;

  /**
   * Write a booking onto the event and keep what it replaced. client_id is set
   * only for a direct service — a report/nf2f client lives in `booking`, as a
   * portal booking's does (routes.js): client_id marks a Splose appointment.
   */
  async function applyToEvent(q, ev, { kind, client, location }) {
    const booking = bookingFor(kind, client);
    const group = booking.group;
    const before = {
      event_type: ev.event_type, client_id: ev.client_id ?? null, client_name: ev.client_name ?? null,
      booking: (ev.custom_metadata && ev.custom_metadata.booking) || null,
      location: ev.location ?? null, manual_location: ev.manual_location ?? null,
      is_manual_location_override: !!ev.is_manual_location_override,
    };
    const setClient = group === 'direct' && client && !ev.client_id;
    const setPlace = location && location !== String(ev.location || '').trim();
    await q.query(
      `UPDATE events SET
          event_type      = $2,
          custom_metadata = COALESCE(custom_metadata, '{}'::jsonb) || jsonb_build_object('booking', $3::jsonb),
          client_id       = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE client_id END,
          client_name     = CASE WHEN $4::text IS NOT NULL THEN $5 ELSE client_name END,
          location        = CASE WHEN $6::text IS NOT NULL THEN $6 ELSE location END,
          manual_location = CASE WHEN $6::text IS NOT NULL THEN jsonb_build_object('address', $6::text, 'source', 'block_review') ELSE manual_location END,
          is_manual_location_override = CASE WHEN $6::text IS NOT NULL THEN TRUE ELSE is_manual_location_override END,
          updated_at      = NOW()
        WHERE id = $1`,
      [ev.id, eventTypeFor(kind), JSON.stringify(booking),
        setClient ? String(client.id) : null, setClient ? (client.fullName || null) : null,
        setPlace ? location : null]);
    return before;
  }

  async function restoreEvent(q, eventId, before) {
    if (!before) return;
    await q.query(
      `UPDATE events SET
          event_type = $2,
          custom_metadata = CASE WHEN $3::jsonb IS NULL THEN COALESCE(custom_metadata, '{}'::jsonb) - 'booking'
                                 ELSE COALESCE(custom_metadata, '{}'::jsonb) || jsonb_build_object('booking', $3::jsonb) END,
          client_id = $4, client_name = $5, location = $6, manual_location = $7::jsonb,
          is_manual_location_override = $8, updated_at = NOW()
        WHERE id = $1`,
      [eventId, before.event_type, before.booking ? JSON.stringify(before.booking) : null,
        before.client_id, before.client_name, before.location,
        before.manual_location ? JSON.stringify(before.manual_location) : null, !!before.is_manual_location_override]);
  }

  /** The Splose service of a Splose-sourced block, read once and kept on the event. */
  async function serviceFor(ev, budget, serviceNames) {
    const meta = ev.custom_metadata || {};
    let id = meta.splose_service_id != null ? String(meta.splose_service_id) : null;
    if (!id && ev.splose_id && sploseApi && budget.left > 0) {
      budget.left -= 1;
      try {
        const appt = await sploseApi.getAppointment(ev.splose_id);
        if (appt && appt.serviceId != null) {
          id = String(appt.serviceId);
          await pool.query(
            `UPDATE events SET custom_metadata = COALESCE(custom_metadata, '{}'::jsonb) || jsonb_build_object('splose_service_id', $2::text) WHERE id = $1`,
            [ev.id, id]);
        }
      } catch (_) { /* Splose unreachable: the kind stays a guess */ }
    }
    return { serviceId: id, serviceName: id && serviceNames ? serviceNames.get(id) || null : null };
  }

  async function loadServiceNames() {
    if (!sploseApi || typeof sploseApi.getServices !== 'function') return null;
    try {
      const list = await sploseApi.getServices();
      const m = new Map();
      for (const s of (Array.isArray(list) ? list : (list && list.data) || [])) {
        if (s && s.id != null) m.set(String(s.id), s.name || s.title || '');
      }
      return m;
    } catch (_) { return null; }
  }

  /**
   * Classify the caller's outside-the-portal blocks from `since` onward.
   * New blocks, and needs_input blocks whose title/place/time changed, are
   * (re)classified; guessed/confirmed/dismissed rows are left alone.
   */
  async function sweep(userId, { since, clients }) {
    const { rows } = await pool.query(
      `SELECT e.id, e.title, e.start_time, e.end_time, e.location, e.event_type, e.client_id, e.client_name,
              e.splose_id, e.outlook_id, e.is_teams_meeting, e.custom_metadata, e.manual_location,
              e.is_manual_location_override, COALESCE(e.created_by_source, e.source) AS origin,
              br.status AS review_status, br.fingerprint AS review_fingerprint
         FROM events e
         LEFT JOIN event_block_reviews br ON br.event_id = e.id
        WHERE e.user_id = $1
          AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND COALESCE(e.created_by_source, e.source) IN ('outlook', 'splose')
          AND e.start_time >= ($2::date)
          AND e.start_time <  NOW() + INTERVAL '60 days'
          AND COALESCE(e.event_type, '') NOT IN ('leave', 'travel')
          AND (br.event_id IS NULL OR (br.status = 'needs_input' AND e.custom_metadata->'booking' IS NULL))
          AND (br.event_id IS NOT NULL OR e.custom_metadata->'booking' IS NULL)
        ORDER BY e.start_time
        LIMIT ${SWEEP_LIMIT}`,
      [userId, since]);
    const pending = rows.filter(r => !r.review_status || r.review_fingerprint !== fingerprintOf(r));
    if (!pending.length) return { classified: 0 };

    const budget = { left: SPLOSE_LOOKUPS_PER_SWEEP };
    const serviceNames = pending.some(r => r.splose_id) ? await loadServiceNames() : null;
    const counts = { guessed: 0, needs_input: 0, confirmed: 0 };
    for (const ev of pending) {
      const svc = ev.splose_id ? await serviceFor(ev, budget, serviceNames) : {};
      const g = classifyBlock(ev, { clients, serviceId: svc.serviceId, serviceName: svc.serviceName });
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        let before = null;
        if (g.status === 'guessed' || g.status === 'confirmed') {
          before = await applyToEvent(client, ev, { kind: g.kind, client: g.client, location: g.location });
        }
        await client.query(
          `INSERT INTO event_block_reviews (event_id, user_id, status, guess, before, fingerprint, classifier_version, classified_at)
           VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, NOW())
           ON CONFLICT (event_id) DO UPDATE SET status = EXCLUDED.status, guess = EXCLUDED.guess,
             before = COALESCE(event_block_reviews.before, EXCLUDED.before), fingerprint = EXCLUDED.fingerprint,
             classifier_version = EXCLUDED.classifier_version, classified_at = NOW()`,
          [ev.id, userId, g.status, JSON.stringify(storedGuess(g)), before ? JSON.stringify(before) : null,
            fingerprintOf(ev), CLASSIFIER_VERSION]);
        await client.query('COMMIT');
        counts[g.status] += 1;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        log(`block-review: event ${ev.id} not classified (${err.code || 'error'})`);
      } finally { client.release(); }
    }
    return { classified: pending.length, ...counts };
  }

  function storedGuess(g) {
    return { kind: g.kind, group: g.group, clientId: g.client ? g.client.id : null,
      clientName: g.client ? g.client.fullName : null, location: g.location, virtual: g.virtual,
      fields: g.fields, missing: g.missing, unsure: g.unsure };
  }

  /** The caller's open reviews (guessed + needs_input), oldest first. */
  async function list(userId, { since }) {
    const { rows } = await pool.query(
      `SELECT br.event_id, br.status, br.guess, br.classified_at,
              e.title, e.start_time, e.end_time, e.location, e.client_id, e.client_name,
              e.splose_id, e.outlook_id, COALESCE(e.created_by_source, e.source) AS origin
         FROM event_block_reviews br
         JOIN events e ON e.id = br.event_id
        WHERE br.user_id = $1 AND br.status IN ('guessed', 'needs_input')
          AND COALESCE(e.is_deleted, FALSE) = FALSE
          AND e.start_time >= ($2::date)
        ORDER BY e.start_time
        LIMIT ${SWEEP_LIMIT}`,
      [userId, since]);
    return rows;
  }

  async function lockOwn(q, userId, eventId) {
    const { rows } = await q.query(
      `SELECT e.*, br.status AS review_status, br.before AS review_before
         FROM events e JOIN event_block_reviews br ON br.event_id = e.id
        WHERE e.id = $1 AND e.user_id = $2 AND br.user_id = $2
        FOR UPDATE OF br`, [eventId, userId]);
    return rows[0] || null;
  }

  /**
   * A person settles a block: { kind, client?, location? }. A guessed block's
   * earlier guess is undone first, so the event ends up exactly as chosen.
   */
  async function confirm(userId, eventId, { kind, client, location }) {
    const q = await pool.connect();
    try {
      await q.query('BEGIN');
      const ev = await lockOwn(q, userId, eventId);
      if (!ev) { await q.query('ROLLBACK'); return { error: 'not_found' }; }
      if (ev.review_status === 'confirmed' || ev.review_status === 'dismissed') { await q.query('ROLLBACK'); return { error: 'already_resolved' }; }
      let base = ev;
      if (ev.review_status === 'guessed' && ev.review_before) {
        await restoreEvent(q, ev.id, ev.review_before);
        base = (await q.query('SELECT * FROM events WHERE id = $1', [ev.id])).rows[0];
      }
      const before = await applyToEvent(q, base, { kind, client, location });
      await q.query(
        `UPDATE event_block_reviews SET status = 'confirmed', resolved_by = $2, resolved_at = NOW(),
                before = COALESCE(before, $3::jsonb),
                guess = guess || jsonb_build_object('confirmed', jsonb_build_object('kind', $4::text, 'clientId', $5::text, 'location', $6::text))
          WHERE event_id = $1`,
        [ev.id, userId, JSON.stringify(before), kind, client ? String(client.id) : null, location || null]);
      await q.query('COMMIT');
      return { ok: true };
    } catch (err) { await q.query('ROLLBACK').catch(() => {}); throw err; } finally { q.release(); }
  }

  /** Leave a block as it came in; an applied guess is undone. */
  async function dismiss(userId, eventId) {
    const q = await pool.connect();
    try {
      await q.query('BEGIN');
      const ev = await lockOwn(q, userId, eventId);
      if (!ev) { await q.query('ROLLBACK'); return { error: 'not_found' }; }
      if (ev.review_status === 'confirmed' || ev.review_status === 'dismissed') { await q.query('ROLLBACK'); return { error: 'already_resolved' }; }
      if (ev.review_status === 'guessed') await restoreEvent(q, ev.id, ev.review_before);
      await q.query(`UPDATE event_block_reviews SET status = 'dismissed', resolved_by = $2, resolved_at = NOW() WHERE event_id = $1`, [ev.id, userId]);
      await q.query('COMMIT');
      return { ok: true };
    } catch (err) { await q.query('ROLLBACK').catch(() => {}); throw err; } finally { q.release(); }
  }

  /** Accept every applied guess as it stands. */
  async function confirmAllGuessed(userId, eventIds) {
    const { rows } = await pool.query(
      `UPDATE event_block_reviews SET status = 'confirmed', resolved_by = $1, resolved_at = NOW()
        WHERE user_id = $1 AND status = 'guessed' AND event_id = ANY($2::uuid[]) RETURNING event_id`,
      [userId, eventIds]);
    return { confirmed: rows.length };
  }

  return { sweep, list, confirm, dismiss, confirmAllGuessed };
}

module.exports = {
  CLASSIFIER_VERSION,
  classifyBlock, kindFromText, clientFromText, leafForServiceName, eventTypeFor,
  fingerprintOf, bookingFor, createBlockReview,
};
