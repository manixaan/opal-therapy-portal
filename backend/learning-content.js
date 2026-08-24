'use strict';

/**
 * LEARNING CONTENT — pure helpers for the Owner-controlled learning layer.
 *
 * Everything here is deterministic data-in/data-out (no DB, no Express, no
 * DOM) so backend/learning-routes.js and the unit tests share one source of
 * truth for what a workflow's content IS: shape validation, normalisation,
 * required-item accounting, quiz grading, and the employee-safe projection
 * that strips quiz answers before content leaves the server.
 *
 * Content shape (stored in learning_workflows.draft_content and snapshotted
 * into learning_workflow_versions.content):
 *
 *   {
 *     sections: [{
 *       key:   's-…'            // stable across edits — progress maps by key
 *       title: 'Welcome',
 *       items: [{
 *         key:      'i-…',      // stable across edits
 *         type:     'content' | 'resource' | 'acknowledgement' | 'quiz' | 'task',
 *         title:    'Code of conduct',
 *         body:     'markdown-ish text (same rules as the hub renderer)',
 *         minutes:  5,               // optional honest estimate
 *         required: true,            // counts toward completion
 *         resource_id:   '<uuid>',   // type 'resource' only
 *         walkthrough_key: 'splose-booking',
 *                                    // type 'task' only, optional: names an
 *                                    // interactive walkthrough module the
 *                                    // player offers as the task's action
 *         ack_statement: '…',        // type 'acknowledgement' only
 *         quiz: {                    // type 'quiz' only
 *           passThreshold: 80,       // percent
 *           questions: [{ question, options: ['…'], correctIndex: 0 }],
 *         },
 *       }],
 *     }],
 *   }
 *
 * Completion rule: an assignment is complete when every COUNTED item has a
 * learning_item_progress row. Counted items are the required ones; if the
 * Owner marks every item optional, all items count instead (a workflow that
 * could never complete is a trap, not a feature).
 */

const crypto = require('crypto');

const ITEM_TYPES = ['content', 'resource', 'acknowledgement', 'quiz', 'task'];

/** Suggested categories — a UI vocabulary, not a constraint. The column is
 *  free text (≤60 chars) so future programs need no code change. */
const CATEGORIES = [
  'induction', 'clinical', 'compliance', 'safety', 'administration',
  'rural_remote', 'professional_development', 'policy_update', 'other',
];

const LIMITS = {
  sections: 50,
  itemsTotal: 200,
  title: 200,
  sectionTitle: 160,
  itemTitle: 200,
  body: 20000,
  ackStatement: 2000,
  quizQuestions: 30,
  quizOptions: 8,
  key: 80,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s) { return UUID_RE.test(String(s || '')); }

function cleanStr(v, max) {
  if (v === undefined || v === null) return '';
  const s = String(v).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function newKey(prefix) {
  return prefix + '-' + crypto.randomUUID().slice(0, 8);
}

/**
 * Validate + normalise raw content from the editor.
 * Returns { ok: true, content } with a clean deep copy (unknown fields
 * dropped, missing keys generated, strings trimmed/capped), or
 * { ok: false, error } with a human-readable reason.
 */
function normaliseContent(raw) {
  if (raw === undefined || raw === null) return { ok: true, content: { sections: [] } };
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'content must be an object with a sections array' };
  }
  const sectionsIn = raw.sections;
  if (!Array.isArray(sectionsIn)) return { ok: false, error: 'content.sections must be an array' };
  if (sectionsIn.length > LIMITS.sections) {
    return { ok: false, error: `a workflow may have at most ${LIMITS.sections} sections` };
  }

  const seenKeys = new Set();
  const takeKey = (v, prefix) => {
    let k = cleanStr(v, LIMITS.key);
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(k)) k = '';
    while (!k || seenKeys.has(k)) k = newKey(prefix);
    seenKeys.add(k);
    return k;
  };

  let itemCount = 0;
  const sections = [];
  for (const s of sectionsIn) {
    if (!s || typeof s !== 'object') return { ok: false, error: 'each section must be an object' };
    const title = cleanStr(s.title, LIMITS.sectionTitle);
    if (!title) return { ok: false, error: 'every section needs a title' };
    if (!Array.isArray(s.items)) return { ok: false, error: `section "${title}" needs an items array` };

    const items = [];
    for (const it of s.items) {
      if (!it || typeof it !== 'object') return { ok: false, error: 'each learning item must be an object' };
      itemCount += 1;
      if (itemCount > LIMITS.itemsTotal) {
        return { ok: false, error: `a workflow may have at most ${LIMITS.itemsTotal} learning items` };
      }
      const type = String(it.type || 'content');
      if (!ITEM_TYPES.includes(type)) return { ok: false, error: `unknown learning item type "${type}"` };
      const itemTitle = cleanStr(it.title, LIMITS.itemTitle);
      if (!itemTitle) return { ok: false, error: `every learning item in "${title}" needs a title` };

      const out = {
        key: takeKey(it.key, 'i'),
        type,
        title: itemTitle,
        body: cleanStr(it.body, LIMITS.body),
        required: it.required !== false,
      };
      const minutes = Number(it.minutes);
      if (Number.isInteger(minutes) && minutes > 0 && minutes <= 600) out.minutes = minutes;

      if (type === 'resource') {
        if (!isUuid(it.resource_id)) {
          return { ok: false, error: `resource item "${itemTitle}" needs a linked resource` };
        }
        out.resource_id = String(it.resource_id).toLowerCase();
        out.resource_title = cleanStr(it.resource_title, LIMITS.itemTitle) || undefined;
        if (!out.resource_title) delete out.resource_title;
      }

      if (type === 'acknowledgement') {
        const stmt = cleanStr(it.ack_statement, LIMITS.ackStatement);
        if (!stmt) return { ok: false, error: `acknowledgement "${itemTitle}" needs a statement to acknowledge` };
        out.ack_statement = stmt;
      }

      if (type === 'task') {
        // Optional: the registry key of an interactive walkthrough this task
        // runs. Kept on the item (not derived from its key) so duplication —
        // which regenerates keys — never severs the link. An invalid value is
        // dropped rather than refused: the task still stands as instructions.
        const wk = cleanStr(it.walkthrough_key, LIMITS.key);
        if (wk && /^[a-z0-9][a-z0-9-]*$/i.test(wk)) out.walkthrough_key = wk;
      }

      if (type === 'quiz') {
        const q = normaliseQuiz(it.quiz, itemTitle);
        if (!q.ok) return q;
        out.quiz = q.quiz;
      }

      items.push(out);
    }
    sections.push({ key: takeKey(s.key, 's'), title, items });
  }
  return { ok: true, content: { sections } };
}

function normaliseQuiz(raw, itemTitle) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: `quiz "${itemTitle}" needs at least one question` };
  }
  const questionsIn = Array.isArray(raw.questions) ? raw.questions : [];
  if (!questionsIn.length) return { ok: false, error: `quiz "${itemTitle}" needs at least one question` };
  if (questionsIn.length > LIMITS.quizQuestions) {
    return { ok: false, error: `quiz "${itemTitle}" may have at most ${LIMITS.quizQuestions} questions` };
  }
  let passThreshold = Number(raw.passThreshold);
  if (!Number.isInteger(passThreshold) || passThreshold < 0 || passThreshold > 100) passThreshold = 80;

  const questions = [];
  for (const q of questionsIn) {
    if (!q || typeof q !== 'object') return { ok: false, error: `quiz "${itemTitle}" has an invalid question` };
    const question = cleanStr(q.question, 1000);
    if (!question) return { ok: false, error: `quiz "${itemTitle}" has a question with no text` };
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => cleanStr(o, 300)).filter(Boolean);
    if (options.length < 2) {
      return { ok: false, error: `question "${question.slice(0, 40)}…" needs at least two options` };
    }
    if (options.length > LIMITS.quizOptions) {
      return { ok: false, error: `question "${question.slice(0, 40)}…" may have at most ${LIMITS.quizOptions} options` };
    }
    const correctIndex = Number(q.correctIndex);
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
      return { ok: false, error: `question "${question.slice(0, 40)}…" needs a correct answer` };
    }
    questions.push({ question, options, correctIndex });
  }
  return { ok: true, quiz: { passThreshold, questions } };
}

/** Flat list of items with their section context. */
function allItems(content) {
  const out = [];
  for (const s of (content && content.sections) || []) {
    for (const it of s.items || []) out.push(it);
  }
  return out;
}

/**
 * The keys that count toward completion: required items, or every item when
 * nothing is marked required.
 */
function countedKeys(content) {
  const items = allItems(content);
  const required = items.filter((it) => it.required !== false);
  return (required.length ? required : items).map((it) => it.key);
}

function contentStats(content) {
  const items = allItems(content);
  const minutes = items.reduce((sum, it) => sum + (Number(it.minutes) || 0), 0);
  return {
    sections: ((content && content.sections) || []).length,
    items: items.length,
    countedTotal: countedKeys(content).length,
    minutes,
  };
}

/**
 * Progress for an assignment: which counted items are done, the honest
 * percentage, and whether the assignment is complete. `completedKeys` may
 * contain keys that no longer exist in this version (a pushed update
 * removed them) — those are ignored rather than counted.
 */
function progressFor(content, completedKeys) {
  const counted = countedKeys(content);
  const done = new Set(completedKeys || []);
  const countedDone = counted.filter((k) => done.has(k)).length;
  const percent = counted.length ? Math.floor((countedDone / counted.length) * 100) : 0;
  return {
    countedTotal: counted.length,
    countedDone,
    percent: counted.length && countedDone === counted.length ? 100 : percent,
    complete: counted.length > 0 && countedDone === counted.length,
  };
}

/** Find one item by key. Returns null rather than throwing. */
function itemByKey(content, key) {
  return allItems(content).find((it) => it.key === String(key || '')) || null;
}

/**
 * Grade a quiz submission. `answers` is an array of selected option indexes,
 * one per question (missing/invalid answers are simply wrong).
 */
function gradeQuiz(quiz, answers) {
  const qs = (quiz && quiz.questions) || [];
  const given = Array.isArray(answers) ? answers : [];
  let score = 0;
  qs.forEach((q, i) => { if (Number(given[i]) === q.correctIndex) score += 1; });
  const total = qs.length;
  const percent = total ? Math.round((score / total) * 100) : 0;
  return { score, total, percent, passed: total > 0 && percent >= (quiz.passThreshold || 80) };
}

/**
 * The employee-facing projection: a deep copy with quiz answers removed.
 * Employees learn whether they passed from the server's grading — the
 * correct indexes never leave the database.
 */
function serialiseForEmployee(content) {
  const copy = JSON.parse(JSON.stringify(content || { sections: [] }));
  for (const s of copy.sections || []) {
    for (const it of s.items || []) {
      if (it.quiz) {
        it.quiz = {
          passThreshold: it.quiz.passThreshold,
          questions: (it.quiz.questions || []).map((q) => ({
            question: q.question,
            options: q.options,
          })),
        };
      }
    }
  }
  return copy;
}

/**
 * Stable deep-equality for content snapshots (key order independent).
 * Used to decide whether assigning needs a new published version.
 */
function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/**
 * SECTION SIZING — how many learning items belong on one screen.
 *
 * The induction is delivered one section at a time (Back / Next), so a
 * section IS a screen. Eighteen modules in a single section reproduces
 * exactly the long scrolling page the step flow exists to replace.
 */
const SECTION_MAX = 6;
const SECTION_MIN = 2;

/**
 * Group an ORDERED list of learning entries into screen-sized sections.
 *
 * Used by the importer, which receives a flat, ordered list (a Resource Hub
 * learning path, the portal walkthroughs) and has to produce something a
 * learner can step through. It divides at the boundaries the source data
 * already carries — a change of resource kind — and never at more than
 * SECTION_MAX items.
 *
 * ORDER IS NEVER REARRANGED: every section is a contiguous run of the
 * original list, so the sequence the practice curated survives intact. A run
 * too short to be a screen of its own is folded into the section beside it,
 * keeping that section's title; a run longer than SECTION_MAX continues into
 * a "(continued)" section.
 *
 * Titles are unique within the workflow — a kind that recurs later in the
 * list, or a run too long for one screen, continues under the same name. Two
 * sections called "Orientation" in one step rail is a reader's problem, not a
 * data problem. All of them are a starting point rather than a decision: the
 * Owner renames any section inline while editing.
 *
 * @param entries [{ group, label, item }] in delivery order
 * @param fallbackLabel title for entries that carry no label of their own
 */
function sectionsFromOrderedItems(entries, fallbackLabel) {
  const list = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!list.length) return [];
  const fallback = cleanStr(fallbackLabel, LIMITS.sectionTitle) || 'Modules';

  // 1. Contiguous runs of the same group.
  const runs = [];
  for (const e of list) {
    const last = runs[runs.length - 1];
    if (last && last.group === e.group) { last.items.push(e.item); continue; }
    runs.push({
      group: e.group,
      label: cleanStr(e.label, LIMITS.sectionTitle) || fallback,
      items: [e.item],
    });
  }

  // 2. A run too short to be a screen joins the section beside it. Backwards
  //    by preference; the first run has nothing behind it, so it folds forward.
  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.items.length < SECTION_MIN && prev.items.length < SECTION_MAX) {
      prev.items = prev.items.concat(run.items);
    } else {
      merged.push({ label: run.label, items: run.items.slice() });
    }
  }
  if (merged.length > 1 && merged[0].items.length < SECTION_MIN &&
      merged[1].items.length < SECTION_MAX) {
    merged[1] = { label: merged[0].label, items: merged[0].items.concat(merged[1].items) };
    merged.shift();
  }

  // 3. Nothing longer than a screen, and no two screens with the same name.
  const used = new Map();
  const uniqueTitle = (label) => {
    const n = (used.get(label) || 0) + 1;
    used.set(label, n);
    const t = n === 1 ? label
      : (n === 2 ? label + ' (continued)' : label + ' (continued ' + (n - 1) + ')');
    return t.slice(0, LIMITS.sectionTitle);
  };
  const out = [];
  for (const sec of merged) {
    for (let i = 0; i < sec.items.length; i += SECTION_MAX) {
      out.push({ title: uniqueTitle(sec.label), items: sec.items.slice(i, i + SECTION_MAX) });
    }
  }
  return out;
}

function equalContent(a, b) {
  return stableStringify(a || null) === stableStringify(b || null);
}

module.exports = {
  ITEM_TYPES,
  CATEGORIES,
  LIMITS,
  isUuid,
  normaliseContent,
  allItems,
  countedKeys,
  contentStats,
  progressFor,
  itemByKey,
  gradeQuiz,
  serialiseForEmployee,
  equalContent,
  stableStringify,
  SECTION_MAX,
  SECTION_MIN,
  sectionsFromOrderedItems,
};
