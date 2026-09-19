'use strict';

/**
 * AUTOMATIC DE-IDENTIFICATION — for chat surfaces with no review card.
 *
 * Opal Assist shows the person what will leave and lets them confirm. Opa (the
 * portal chat bubble and the phone app) has no such step, so the same rules
 * run on the server, inside the provider, on every request:
 *
 *   conversation in  →  every turn tokenised with ONE shared numbering
 *   model            →  sees tokens only
 *   reply out        →  names restored here, in this request's memory
 *
 * The token→name map exists for the life of one request and is never stored
 * or logged. What cannot be confirmed by a person is not guessed at: words
 * that merely LOOK like an unknown name are left as written (the guardrail
 * remains the net for those). Fail closed: if the reply carries a token this
 * request never issued, the reply is refused.
 */

const assist = require('./assist-deidentify');

const TOKEN = /\[([A-Z][A-Z0-9_]*)\]/g;

/**
 * @param {Array<{role, content}>} messages
 * @returns {{ messages, restore(text), streamRestorer(onText), hiddenCount }}
 */
async function prepare(messages, { system } = {}) {
  let known = [];
  const names = new Map(); // token → original text, this request only
  const out = [];
  for (const msg of messages || []) {
    if (!msg || typeof msg.content !== 'string' || !msg.content) { out.push(msg); continue; }
    const r = await assist.check({ text: msg.content, known });
    known = r.known;
    r.hidden.forEach((h) => { if (!names.has(h.token)) names.set(h.token, h.name); });
    out.push({ ...msg, content: r.text });
  }

  // The system prompt may carry a name too (the signed-in person, a page title).
  let safeSystem = system;
  if (typeof system === 'string' && system) {
    const r = await assist.check({ text: system, known });
    known = r.known;
    r.hidden.forEach((h) => { if (!names.has(h.token)) names.set(h.token, h.name); });
    safeSystem = r.text;
  }

  const restore = (text) => {
    let unknown = false;
    const restored = String(text || '').replace(TOKEN, (whole, tok) => {
      if (names.has(tok)) return names.get(tok);
      // Only OUR token families are a failure; "[1]" or "[NOTE]" in an answer is just text.
      if (/^(CLIENT|CONTACT|THERAPIST|STAFF|PERSON|EMAIL|PHONE|ADDRESS|NDIS_NUMBER|MEDICARE_NUMBER|DOB|SCHOOL|HOSPITAL)(_\d+)?$/.test(tok)) unknown = true;
      return whole;
    });
    if (unknown) throw new Error('content_blocked');
    return restored;
  };

  /**
   * Wrap a delta callback so a token split across chunks ("[CLI" + "ENT_1]")
   * is restored whole: text after an unclosed "[" is held until it closes.
   */
  const streamRestorer = (onText) => {
    let held = '';
    const push = (chunk) => {
      held += chunk;
      const open = held.lastIndexOf('[');
      const safe = open === -1 || held.indexOf(']', open) !== -1 || held.length - open > 40 ? held.length : open;
      if (safe > 0) { onText(restore(held.slice(0, safe))); held = held.slice(safe); }
    };
    const flush = () => { if (held) { onText(restore(held)); held = ''; } };
    return { push, flush };
  };

  return { messages: out, system: safeSystem, restore, streamRestorer, hiddenCount: names.size };
}

module.exports = { prepare };
