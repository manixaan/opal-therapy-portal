'use strict';

/**
 * WALKTHROUGH CONTENT — pure helpers for the Owner-authorable interactive
 * induction catalogue (migration 045).
 *
 * Deterministic data-in/data-out only: no DB, no Express, no DOM — so
 * backend/walkthrough-catalogue.js, backend/tutorial-routes.js and the unit
 * tests share one source of truth for what a walkthrough IS. The counterpart
 * of learning-content.js for the learning-workflow layer.
 *
 * Step shape (see migration 045; identical to the contract
 * frontend/current/induction.js already renders and
 * backend/tests/induction-registry.test.js already enforces for the shipped
 * built-ins):
 *
 *   { type:    'intro' | 'highlight' | 'action' | 'screenshot' | 'callout'
 *              | 'warning' | 'quiz' | 'complete',
 *     title:   'Short heading',
 *     body:    'plain text; **bold** and blank-line paragraphs only',
 *     target:  'cal-view-tabs',            // highlight/action only
 *     route:   { tab, section, open },     // navigate before resolving target
 *     menu:    true, pad: 6, rounded: '8px',
 *     image:   { src: '/assets/…', alt: '…' },
 *     advance: 'click',                    // action steps
 *     roles:   ['owner'],                  // narrows, never widens
 *     quiz:    { question, options: [...], correctIndex, explain },
 *     next:    'portal-master-scheduler' } // complete steps
 *
 * Two rules here are load-bearing and are NOT presentation concerns:
 *
 *  • **Body text is never HTML.** The player escapes before formatting
 *    (indFormat), but an Owner-authored catalogue means untrusted-ish text
 *    now reaches a pop-up through the database rather than through code
 *    review, so the tags are stripped here as well. Defence in depth: the
 *    renderer's escape stays exactly as it is.
 *
 *  • **No step may click through a destructive or externally visible
 *    action.** That was a comment in induction-modules.js relying on author
 *    judgement — fine when the authors were engineers under code review, not
 *    fine once anyone can author. DESTRUCTIVE_TARGET now refuses
 *    `advance: 'click'` on anything that disconnects, deletes, invites,
 *    sends or bulk-marks. Explaining such a control is still allowed; making
 *    a learner press it is not.
 */

const crypto = require('crypto');

const STEP_TYPES = [
  'intro', 'highlight', 'action', 'screenshot', 'callout', 'warning', 'quiz', 'complete',
  // Phase 3 blocks. A walkthrough is not only a tour any more: it can carry a
  // page to read, a checkpoint that will not let a learner past, and a
  // statement to sign — the same pieces the learning layer has, usable inline.
  'page', 'checkpoint', 'acknowledgement',
];

/** Steps that record something a learner did, not merely something they saw. */
const EVIDENCE_TYPES = ['checkpoint', 'acknowledgement'];

/** Steps a learner may not simply page past. */
const BLOCKING_TYPES = ['checkpoint', 'acknowledgement'];

const KNOWN_ROLES = ['owner', 'admin', 'therapist', 'read_only'];

/** Steps that must name a live element to spotlight. */
const TARGETED_TYPES = ['highlight', 'action'];

const LIMITS = {
  steps: 200,
  ackStatement: 2000,
  key: 80,
  title: 200,
  stepTitle: 200,
  description: 1000,
  body: 8000,
  target: 200,
  thumb: 300,
  quizQuestion: 600,
  quizOptions: 8,
  quizOption: 300,
  quizExplain: 1000,
  minutesMax: 120,
};

/**
 * An `action` step makes the learner CLICK the highlighted control for real.
 * These names must never be on the other end of that.
 *
 * The verbs here are the IRREVERSIBLE ones. Openers are deliberately absent:
 * the shipped "Inviting Therapists" walkthrough clicks
 * `settings-invite-user`, which opens the invitation form and sends nothing —
 * banning the word "invite" outright would refuse a step that is already
 * safe and shipped, while the button that actually sends is caught by
 * `send`/`submit`. A guard that cries wolf on safe steps gets switched off.
 */
const DESTRUCTIVE_TARGET =
  /(disconnect|delete|remove|revoke|send|submit|publish|deactivate|suspend|approve|reject|mark-all|sign-?out|logout)/i;

function cleanStr(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

/**
 * Body/title text: strip anything tag-shaped before it is stored. The player
 * escapes on render too — this is the second lock, not the only one.
 */
function cleanText(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).replace(/<[^>]*>/g, '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

function newKey(prefix) {
  return prefix + '-' + crypto.randomUUID().slice(0, 8);
}

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Roles, deduped and ordered as KNOWN_ROLES. Unknown roles are dropped. */
function cleanRoles(raw) {
  if (!Array.isArray(raw)) return [];
  const set = new Set(raw.map((r) => String(r || '')));
  return KNOWN_ROLES.filter((r) => set.has(r));
}

/** An image src must be a site-relative asset path — never a remote URL. */
function cleanImageSrc(v) {
  const s = cleanStr(v, LIMITS.thumb);
  if (!s || !s.startsWith('/') || s.startsWith('//')) return '';
  return s;
}

function normaliseRoute(raw) {
  if (!isPlainObject(raw)) return null;
  const route = {};
  ['tab', 'section', 'open'].forEach((k) => {
    const v = cleanStr(raw[k], 80);
    if (v) route[k] = v;
  });
  return Object.keys(route).length ? route : null;
}

function normaliseQuiz(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: 'a quiz step needs a quiz object' };
  const question = cleanText(raw.question, LIMITS.quizQuestion);
  if (!question) return { ok: false, error: 'every quiz needs a question' };
  if (!Array.isArray(raw.options)) return { ok: false, error: 'every quiz needs an options array' };
  const options = raw.options.map((o) => cleanText(o, LIMITS.quizOption)).filter(Boolean);
  if (options.length < 2) return { ok: false, error: 'every quiz needs at least two answer options' };
  if (options.length > LIMITS.quizOptions) {
    return { ok: false, error: `a quiz may have at most ${LIMITS.quizOptions} options` };
  }
  const correctIndex = typeof raw.correctIndex === 'number' ? raw.correctIndex : NaN;
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    return { ok: false, error: 'correctIndex must point at one of the options' };
  }
  const quiz = { question, options, correctIndex };
  const explain = cleanText(raw.explain, LIMITS.quizExplain);
  if (explain) quiz.explain = explain;
  return { ok: true, quiz };
}

/**
 * Validate + normalise an authored step list.
 * `moduleRoles` gates per-step roles: a step may narrow the module's audience,
 * never widen it (a therapist-visible module cannot hide an owner-only step
 * behind a role the module itself does not admit).
 *
 * Returns { ok: true, steps } with a clean deep copy, or { ok: false, error }.
 */
function normaliseSteps(raw, moduleRoles) {
  if (raw === undefined || raw === null) return { ok: true, steps: [] };
  if (!Array.isArray(raw)) return { ok: false, error: 'steps must be an array' };
  if (raw.length > LIMITS.steps) {
    return { ok: false, error: `a walkthrough may have at most ${LIMITS.steps} steps` };
  }
  const allowed = cleanRoles(moduleRoles);

  // Stable per-step keys. Evidence (a passed checkpoint, a signed statement)
  // is recorded against the KEY, so reordering or inserting steps must not
  // move somebody's record onto a different step — which an index would.
  const seenKeys = new Set();
  const takeKey = (v) => {
    let k = cleanStr(v, LIMITS.key);
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(k)) k = '';
    while (!k || seenKeys.has(k)) k = newKey('s');
    seenKeys.add(k);
    return k;
  };

  const steps = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    const at = `step ${i + 1}`;
    if (!isPlainObject(s)) return { ok: false, error: `${at} must be an object` };

    const type = cleanStr(s.type, 20);
    if (!STEP_TYPES.includes(type)) {
      return { ok: false, error: `${at} has an unknown type "${type}"` };
    }
    const title = cleanText(s.title, LIMITS.stepTitle);
    if (!title) return { ok: false, error: `${at} needs a title` };

    const out = { key: takeKey(s.key), type, title };

    if (type === 'quiz' || type === 'checkpoint') {
      const q = normaliseQuiz(s.quiz);
      if (!q.ok) return { ok: false, error: `${at}: ${q.error}` };
      out.quiz = q.quiz;
      // A checkpoint's whole point is that it blocks. Storing the flag rather
      // than inferring it from the type keeps the player's gate explicit.
      if (type === 'checkpoint') out.blocking = true;
    } else if (type === 'acknowledgement') {
      const statement = cleanText(s.ack_statement, LIMITS.ackStatement);
      if (!statement) {
        return { ok: false, error: `${at} is a sign-here step and needs the statement being agreed to` };
      }
      out.ack_statement = statement;
      out.blocking = true;
      const body = cleanText(s.body, LIMITS.body);
      if (body) out.body = body;
    } else {
      const body = cleanText(s.body, LIMITS.body);
      if (!body) return { ok: false, error: `${at} needs body text` };
      out.body = body;
    }

    if (TARGETED_TYPES.includes(type)) {
      const target = cleanStr(s.target, LIMITS.target);
      if (!target) return { ok: false, error: `${at} is a ${type} step and needs a target` };
      out.target = target;
      if (type === 'action' && cleanStr(s.advance, 20) === 'click') {
        if (DESTRUCTIVE_TARGET.test(target)) {
          return {
            ok: false,
            error: `${at} asks the learner to click "${target}", which performs a destructive or ` +
                   'externally visible action. Explain the control with a spotlight instead.',
          };
        }
        out.advance = 'click';
      }
    }

    if (type === 'screenshot' || isPlainObject(s.image)) {
      const src = cleanImageSrc(s.image && s.image.src);
      if (type === 'screenshot' && !src) {
        return { ok: false, error: `${at} is a screenshot step and needs a site-relative image src` };
      }
      if (src) out.image = { src, alt: cleanText(s.image.alt, LIMITS.title) };
    }

    const route = normaliseRoute(s.route);
    if (route) out.route = route;
    if (s.menu === true) out.menu = true;
    if (typeof s.pad === 'number' && Number.isFinite(s.pad) && s.pad >= 0 && s.pad <= 64) {
      out.pad = Math.round(s.pad);
    }
    const rounded = cleanStr(s.rounded, 20);
    if (rounded && /^[0-9a-z% .]+$/i.test(rounded)) out.rounded = rounded;

    if (Array.isArray(s.roles)) {
      const roles = cleanRoles(s.roles);
      if (!roles.length) return { ok: false, error: `${at} lists no recognised role` };
      const widened = roles.filter((r) => allowed.length && !allowed.includes(r));
      if (widened.length) {
        return {
          ok: false,
          error: `${at} is gated to ${widened.join(', ')}, which this walkthrough does not admit`,
        };
      }
      out.roles = roles;
    }

    const next = cleanStr(s.next, LIMITS.key);
    if (next && /^[a-z0-9][a-z0-9-]*$/i.test(next)) out.next = next;

    steps.push(out);
  }

  return { ok: true, steps };
}

/**
 * Validate + normalise the module's own metadata (everything but the steps).
 * Returns { ok: true, meta } or { ok: false, error }.
 */
function normaliseModuleMeta(raw) {
  if (!isPlainObject(raw)) return { ok: false, error: 'a walkthrough needs a title and roles' };

  let key = cleanStr(raw.key, LIMITS.key).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) key = newKey('wt');

  const title = cleanText(raw.title, LIMITS.title);
  if (title.length < 3) return { ok: false, error: 'a walkthrough needs a title' };

  const roles = cleanRoles(raw.roles);
  if (!roles.length) return { ok: false, error: 'a walkthrough must admit at least one role' };

  const minutesRaw = typeof raw.minutes === 'number' ? raw.minutes : NaN;
  const minutes = Number.isInteger(minutesRaw) && minutesRaw >= 1 && minutesRaw <= LIMITS.minutesMax
    ? minutesRaw : 5;

  const meta = {
    key,
    title,
    description: cleanText(raw.description, LIMITS.description),
    group_key: cleanStr(raw.group || raw.group_key, 40) || 'portal',
    minutes,
    roles,
    thumb: cleanImageSrc(raw.thumb),
    start_context: normaliseRoute(raw.start || raw.start_context) || {},
  };
  return { ok: true, meta };
}

/**
 * The learner-safe projection of a step list.
 *
 * A checkpoint BLOCKS, so its answer must not travel with it — a gate whose
 * key ships in the payload is decoration. The server grades the attempt
 * (POST /api/tutorials/:key/evidence) and returns the explanation with the
 * verdict. Ordinary quiz steps are unchanged: they are formative, they never
 * gate anything, and they have always been graded in the browser.
 */
function learnerSteps(steps) {
  return (steps || []).map((s) => {
    if (s.type !== 'checkpoint' || !s.quiz) return s;
    const quiz = { question: s.quiz.question, options: s.quiz.options };
    return Object.assign({}, s, { quiz });
  });
}

/** Steps of a module a role actually sees (per-step roles narrow further). */
function stepsForRole(steps, role) {
  const r = String(role || '');
  return (steps || []).filter((s) => !s.roles || s.roles.indexOf(r) !== -1);
}

/**
 * The dashboard status of one module given its tutorial_progress row.
 * 'not_started' | 'in_progress' | 'completed' | 'updated' — identical
 * semantics to the registry helper it replaces ('updated' = completed on an
 * older version; the completion stays valid).
 */
function moduleState(mod, row) {
  if (!row) return 'not_started';
  if (row.status === 'completed') {
    const done = Number(row.completed_version || row.version || 0);
    return done < Number(mod.version || 0) ? 'updated' : 'completed';
  }
  return 'in_progress';
}

/**
 * Map one shipped registry module (frontend/current/induction-modules.js)
 * onto the seed payload for migration 045. Pure — the seeding transaction
 * lives in walkthrough-catalogue.js.
 */
function fromRegistryModule(m) {
  const meta = normaliseModuleMeta({
    key: m.key,
    title: m.title,
    description: m.description,
    group: m.group || 'portal',
    minutes: m.minutes,
    roles: m.roles,
    thumb: m.thumb,
    start: m.start,
  });
  if (!meta.ok) return { ok: false, error: `${m && m.key}: ${meta.error}` };
  const steps = normaliseSteps(m.steps, m.roles);
  if (!steps.ok) return { ok: false, error: `${m && m.key}: ${steps.error}` };
  return {
    ok: true,
    module: Object.assign({}, meta.meta, {
      version: Number.isInteger(m.version) && m.version >= 1 ? m.version : 1,
      steps: steps.steps,
    }),
  };
}

module.exports = {
  STEP_TYPES,
  EVIDENCE_TYPES,
  BLOCKING_TYPES,
  KNOWN_ROLES,
  LIMITS,
  DESTRUCTIVE_TARGET,
  normaliseSteps,
  normaliseModuleMeta,
  stepsForRole,
  learnerSteps,
  moduleState,
  fromRegistryModule,
};
