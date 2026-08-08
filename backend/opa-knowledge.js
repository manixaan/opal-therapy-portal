'use strict';

/**
 * OPA KNOWLEDGE — registry retrieval for the Opa assistant.
 *
 * The opa_feature_knowledge table is the assistant's ONLY source of claims
 * about the Portal. This module retrieves and ranks records for a user
 * question; the prompt layer then instructs the model to answer solely from
 * what is returned here.
 *
 * Honesty rules enforced at retrieval time (not left to the model):
 *   - 'planned' and 'deprecated' records are excluded entirely — they never
 *     enter model context in this phase, so the model cannot leak roadmap
 *     or removed features as if they existed.
 *   - minimum_role gates records to the caller's role and above
 *     (owner > admin > therapist > read_only); enforced in SQL AND re-checked
 *     in JS as defence in depth.
 *
 * Ranking is deliberately simple and deterministic (unit-testable, no
 * embeddings): alias match > feature-name overlap > summary overlap, with a
 * current-page module/route boost.
 *
 * No client or clinical data lives in this table by design.
 */

// Statuses that may be shown to the model when answering.
const ANSWERABLE_STATUSES = ['live', 'partial', 'experimental'];

// Role hierarchy (least → most privileged). minimum_role NULL = everyone.
const ROLE_RANK = { read_only: 0, therapist: 1, admin: 2, owner: 3 };

// Short domain terms that survive tokenisation despite being under 3 chars
// (or that we always want kept intact).
const SHORT_ALIASES = new Set(['fca', 'at', 'pd', 'ot', 'ndis', 'cpd', 'fy', 'r2']);

const MAX_QUERY_TOKENS = 12;

// ── pure helpers (exported for unit tests) ──────────────────────────────────

/**
 * Lowercase, split on non-alphanumerics, drop tokens shorter than 3 chars
 * unless they are known short domain aliases.
 */
function tokenise(str) {
  return String(str || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 || SHORT_ALIASES.has(t));
}

const asArray = (v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

/**
 * Deterministic relevance score for one record.
 *
 *   exact alias match          +100  (whole query equals an alias)
 *   alias substring match       +60  (query contains an alias, or vice versa)
 *   feature-name token overlap  +10 per overlapping token
 *   summary token overlap        +4 per overlapping token
 *   current-page module match   +15  (record.module === ctx.module)
 *   exact route match            +8  (record.route === ctx.route)
 *
 * @param {object} record      opa_feature_knowledge row
 * @param {string[]} tokens    tokenise(query)
 * @param {string} queryLower  full query, lowercased and trimmed
 * @param {object} [ctx]       { module, route }
 */
function scoreRecord(record, tokens, queryLower, ctx = {}) {
  let score = 0;
  const q = String(queryLower || '').toLowerCase().trim();

  // Alias scoring: take the single best alias, never sum across aliases.
  let aliasScore = 0;
  for (const raw of asArray(record.aliases)) {
    const alias = String(raw || '').toLowerCase().trim();
    if (!alias) continue;
    if (alias === q) { aliasScore = Math.max(aliasScore, 100); continue; }
    if (q && (q.includes(alias) || alias.includes(q))) aliasScore = Math.max(aliasScore, 60);
  }
  score += aliasScore;

  const overlap = (text) => {
    const set = new Set(tokenise(text));
    return tokens.filter((t) => set.has(t)).length;
  };
  score += 10 * overlap(record.feature);
  score += 4 * overlap(record.summary);

  if (ctx.module && record.module === ctx.module) score += 15;
  if (ctx.route && record.route && record.route === ctx.route) score += 8;

  return score;
}

/** Roles the caller may see: minimum_role NULL or rank <= caller rank. */
function roleAllows(callerRole, minimumRole) {
  if (!minimumRole) return true;
  const caller = ROLE_RANK[callerRole];
  const needed = ROLE_RANK[minimumRole];
  if (caller === undefined || needed === undefined) return false;
  return caller >= needed;
}

// ── retrieval ───────────────────────────────────────────────────────────────

/**
 * Search the knowledge registry.
 *
 * @param {object} pool   pg pool (injected — keeps this module dependency-free)
 * @param {object} opts   { query, route, module, role, limit }
 * @returns {Promise<Array>} top-ranked records (score > 0), or the module's
 *          records when the query is empty.
 */
async function searchOpaKnowledge(pool, { query, route, module, role, limit = 6 } = {}) {
  const q = String(query || '').trim();
  const tokens = tokenise(q).slice(0, MAX_QUERY_TOKENS);
  const cap = Math.min(Math.max(parseInt(limit, 10) || 6, 1), 12);

  // Roles at-or-below the caller that minimum_role may name.
  const callerRank = ROLE_RANK[role] ?? 0;
  const allowedMinRoles = Object.keys(ROLE_RANK)
    .filter((r) => r !== 'read_only' && ROLE_RANK[r] <= callerRank);

  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  let where = `status NOT IN ('planned','deprecated')`;
  where += allowedMinRoles.length
    ? ` AND (minimum_role IS NULL OR minimum_role = ANY(${p(allowedMinRoles)}))`
    : ' AND minimum_role IS NULL';

  if (!q) {
    // Empty query → the current module's records (no ranking needed).
    if (!module) return [];
    where += ` AND module = ${p(module)}`;
    const { rows } = await pool.query(
      `SELECT * FROM opa_feature_knowledge WHERE ${where} ORDER BY feature LIMIT ${p(cap)}`,
      params
    );
    return rows.filter((r) => ANSWERABLE_STATUSES.includes(r.status) && roleAllows(role, r.minimum_role));
  }

  // Candidate fetch: broad ILIKE net; precise ranking happens in JS.
  const likeClauses = [];
  for (const t of tokens) {
    const pat = p(`%${t}%`);
    likeClauses.push(`feature ILIKE ${pat} OR summary ILIKE ${pat} OR aliases::text ILIKE ${pat}`);
  }
  {
    const pat = p(`%${q.slice(0, 120)}%`);
    likeClauses.push(`aliases::text ILIKE ${pat}`);
  }
  if (module) likeClauses.push(`module = ${p(module)}`);
  where += ` AND (${likeClauses.join(' OR ')})`;

  const { rows } = await pool.query(
    `SELECT * FROM opa_feature_knowledge WHERE ${where} LIMIT 60`,
    params
  );

  const ctx = { module: module || null, route: route || null };
  return rows
    // Defence in depth: re-apply status + role gates in JS.
    .filter((r) => ANSWERABLE_STATUSES.includes(r.status) && roleAllows(role, r.minimum_role))
    .map((r) => ({ record: r, score: scoreRecord(r, tokens, q.toLowerCase(), ctx) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || String(a.record.feature).localeCompare(String(b.record.feature)))
    .slice(0, cap)
    .map((s) => s.record);
}

// ── context validation ──────────────────────────────────────────────────────

/**
 * Sanitise client-supplied page context. The client is untrusted:
 *   - module must exist in the registry (SELECT DISTINCT module) else null
 *   - strings are length-capped (route 120, module 60, pageTitle 120)
 *   - availableActions (and anything else) is dropped server-side — Phase 4
 *     capability awareness comes from the registry, never client claims.
 *
 * @returns {Promise<{route: string|null, module: string|null, pageTitle: string|null}>}
 */
async function validateContext(pool, ctx) {
  const c = ctx && typeof ctx === 'object' ? ctx : {};
  const capped = (v, max) => {
    if (typeof v !== 'string') return null;
    const s = v.trim().slice(0, max);
    return s || null;
  };

  let module = capped(c.module, 60);
  if (module) {
    const { rows } = await pool.query('SELECT DISTINCT module FROM opa_feature_knowledge');
    if (!rows.some((r) => r.module === module)) module = null;
  }

  return {
    route: capped(c.route, 120),
    module,
    pageTitle: capped(c.pageTitle, 120),
  };
}

module.exports = {
  searchOpaKnowledge,
  validateContext,
  tokenise,
  scoreRecord,
  roleAllows,
  ANSWERABLE_STATUSES,
  ROLE_RANK,
};
