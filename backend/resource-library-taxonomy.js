'use strict';

/**
 * RESOURCE LIBRARY TAXONOMY — deciding where a resource belongs.
 *
 * The Library had become one list of roughly seven hundred documents. This
 * module is the part that turns it into somewhere a person can look things up,
 * and it is deliberately the part with no database and no network in it: given
 * profiles, it returns a folder tree and an assignment for every resource, and
 * can therefore be tested exhaustively without a model or a Postgres.
 *
 * ── WHY THE TAXONOMY IS DERIVED, NOT DECLARED ─────────────────────────────
 * What is declared below is a VOCABULARY of candidate themes — the shapes a
 * clinical resource library can take. Which of them become folders is decided
 * by the corpus: a theme is only a folder if enough resources actually land in
 * it (MIN_FOLDER_SIZE), a subfolder only survives if its parent is big enough
 * to need dividing and the subfolder itself is not a folder-of-three
 * (MIN_SUBFOLDER_SIZE, §70). Themes nothing matches are never created, which
 * is why the same code produces a different tree for a paediatric practice
 * than for an adult one.
 *
 * The alternative — letting a model name a category per document — produces
 * "Fine Motor Activities", "Fine-motor resources" and "Motor Skills" as three
 * folders, which is the failure §69 exists to prevent. Deterministic themes
 * with a model REFINING them keeps naming stable across runs (§25) while the
 * membership stays genuinely content-driven.
 *
 * ── PURPOSE OUTRANKS TOPIC ────────────────────────────────────────────────
 * A policy about emotional regulation is a policy (§45). Somebody looking for
 * it thinks "where are our policies", not "where is the emotional regulation
 * material". So classification runs purpose-first: a resource with a strong
 * purpose signal is shelved by purpose, and only the remainder — the great
 * mass of activities, worksheets and visual supports — is shelved by topic.
 *
 * ── CONFIDENCE AND HONESTY ────────────────────────────────────────────────
 * A resource whose best theme barely beats its second, or which matched almost
 * nothing, goes to Needs Review rather than being filed somewhere plausible
 * (§13). A library where three documents are openly unsorted is more useful
 * than one where thirty are quietly wrong.
 */

// ── tuning ────────────────────────────────────────────────────────────────

/**
 * HOW BIG IS BIG ENOUGH? — a proportion of the library, not a fixed number.
 *
 * These began as constants and that was wrong. A folder holding six of seven
 * hundred resources is a rounding error; a folder holding six of forty is a
 * seventh of the practice's material. A fixed floor of six therefore produced
 * a sensible tree for the large library it was tuned on and, for a small one,
 * a single folder with everything else in Needs Review.
 *
 * So the thresholds scale with the corpus and are clamped at both ends: an
 * absolute floor stops a two-resource "folder", and the original ceilings stop
 * a very large library from demanding hundreds of members per shelf.
 */
const MIN_FOLDER_SIZE = 6;
const MIN_SUBFOLDER_SIZE = 8;
const MIN_PARENT_FOR_SUBFOLDERS = 24;
/** Never build a folder smaller than this, however small the library. */
const ABSOLUTE_MIN_FOLDER = 3;
const ABSOLUTE_MIN_SUBFOLDER = 4;
const ABSOLUTE_MIN_PARENT = 12;
/** §9: a person can hold about a dozen top-level folders in their head. */
const MAX_TOP_LEVEL_FOLDERS = 12;

function thresholdsFor(total) {
  const scale = (ceiling, floor, proportion) =>
    Math.max(floor, Math.min(ceiling, Math.ceil(total * proportion)));
  return {
    folder: scale(MIN_FOLDER_SIZE, ABSOLUTE_MIN_FOLDER, 0.01),
    subfolder: scale(MIN_SUBFOLDER_SIZE, ABSOLUTE_MIN_SUBFOLDER, 0.0125),
    parent: scale(MIN_PARENT_FOR_SUBFOLDERS, ABSOLUTE_MIN_PARENT, 0.0375),
  };
}
/** Below this score a resource is not confidently anything. */
const MIN_SCORE = 3;
/** The winner must beat the runner-up by this ratio to be confident. */
const MIN_MARGIN = 1.25;
/** Assignments below this land in Needs Review. */
const CONFIDENCE_FLOOR = 0.42;
/** How much more a decisive phrase counts than an ordinary one. */
const STRONG_MULTIPLIER = 4;
/** Ceiling on what the document body alone can contribute to one theme. */
const MAX_BODY_SCORE = 8;
/** Bounds on how much one tag may be worth once corpus frequency is known. */
const TAG_WEIGHT_MIN = 3;
const TAG_WEIGHT_MAX = 9;
/** Used when corpus frequencies are unknown (single-resource classification). */
const TAG_WEIGHT_DEFAULT = 6;

const REVIEW_KEY = 'needs-review';
const REVIEW_FOLDER = Object.freeze({
  key: REVIEW_KEY,
  name: 'Needs Review',
  description: 'Resources that could not be confidently placed. Move them where they belong.',
  parent: null,
  isReviewBucket: true,
});

// ── the vocabulary ────────────────────────────────────────────────────────

/**
 * One candidate theme.
 *
 *   key/name/description  what a person sees. Names are 1–4 ordinary words
 *                         (§11) — no codes, no "Miscellaneous".
 *   parent                null for a top-level folder, else the parent key.
 *   purpose               TRUE when the theme is about what a document IS
 *                         rather than what it is about. Purpose themes are
 *                         scored first and win ties (§45).
 *   strong                phrases that are DECISIVE. "screening tool" in a
 *                         title settles the question; no amount of
 *                         accumulated weak matching should outvote it.
 *   words                 phrases that suggest the theme. Multi-word phrases
 *                         score higher than single words because "social
 *                         story" is evidence and "social" is not.
 *   types                 content_type values that suggest it.
 *   tags                  resource_tags names that suggest it. Tags are
 *                         curated by a person, so they carry the most weight.
 *   veto                  phrases that rule the theme OUT — the cheapest fix
 *                         for a lexicon's characteristic error.
 */
const THEMES = Object.freeze([
  // ═══ PURPOSE THEMES ════════════════════════════════════════════════════
  {
    key: 'policies-procedures',
    name: 'Policies & Procedures',
    description: 'Practice policies, procedures and governance material staff work to.',
    parent: null, purpose: true,
    types: ['policy', 'standard', 'regulatory_update'],
    strong: ['policy', 'procedure', 'code of conduct', 'practice standards',
      'terms of reference', 'work health and safety'],
    words: ['policy', 'procedure', 'code of conduct', 'governance', 'compliance',
      'privacy policy', 'incident management', 'complaints', 'whs', 'work health and safety',
      'terms of reference', 'delegation', 'record keeping', 'data breach', 'infection control',
      'safeguarding', 'child safe', 'quality and safeguards', 'practice standards',
      'professional boundaries', 'conflict of interest', 'risk management framework'],
    tags: ['Risk/safety guide'],
  },
  {
    key: 'assessments',
    name: 'Assessments',
    description: 'Assessment tools, protocols and the guidance for administering them.',
    parent: null, purpose: true,
    strong: ['assessment', 'assessments', 'screening tool', 'screening',
      'assessment sheet', 'assessment tool', 'outcome measure', 'rating scale',
      'score sheet', 'scoring', 'standardised', 'norms', 'observation form',
      'functional capacity assessment', 'whodas', 'sensory profile'],
    words: ['assessment', 'assess ', 'screening tool', 'screener', 'standardised',
      'norms', 'scoring', 'score sheet', 'protocol', 'administration manual',
      'functional capacity assessment', 'fca', 'whodas', 'cognitive assessment',
      'sensory profile', 'observation form', 'rating scale', 'inventory',
      'outcome measure', 'goas', 'canadian occupational performance measure', 'copm'],
    tags: ['Assessment support'],
    veto: ['risk assessment policy'],
  },
  {
    key: 'reports-documentation',
    name: 'Reports & Documentation',
    description: 'Templates, phrase banks and guidance for clinical writing.',
    parent: null, purpose: true,
    strong: ['report template', 'letter template', 'phrase bank', 'report writing',
      'progress note', 'case note', 'referral letter', 'discharge summary',
      'service agreement', 'consent form', 'proforma', 'pro forma'],
    words: ['report template', 'letter template', 'phrase bank', 'report writing',
      'documentation', 'progress note', 'case note', 'clinical note', 'referral letter',
      'discharge summary', 'goal setting template', 'service agreement', 'consent form',
      'file note', 'report structure', 'writing guide', 'proforma', 'pro forma'],
    tags: ['Report-writing phrase bank', 'Template'],
  },
  {
    key: 'ndis-funding',
    name: 'NDIS & Funding',
    description: 'NDIS guidance, pricing, evidence requirements and funding pathways.',
    parent: null, purpose: true,
    types: ['ndis_guide'],
    strong: ['ndis', 'ndia', 'national disability insurance', 'price guide',
      'pricing arrangements', 'reasonable and necessary', 'support coordination',
      'specialist disability accommodation', 'plan manager', 'plan review'],
    words: ['ndis', 'ndia', 'national disability insurance', 'price guide',
      'pricing arrangements', 'reasonable and necessary', 'plan review',
      'support coordination', 'sda', 'sil', 'specialist disability accommodation',
      'assistive technology assessment', 'evidence of', 'funding', 'quote', 'plan manager'],
    tags: ['NDIS', 'NDIS evidence guide'],
  },
  {
    key: 'learning-development',
    name: 'Learning & Development',
    description: 'Courses, PD, tutorials and internal learning for staff.',
    parent: null, purpose: true,
    types: ['course', 'learning_module', 'tutorial', 'starter_kit', 'video'],
    strong: ['course', 'training', 'webinar', 'continuing education',
      'professional development', 'masterclass', 'elearning', 'e-learning',
      'certificate', 'supervision', 'mentoring', 'induction'],
    words: ['course', 'training', 'webinar', 'e-learning', 'elearning', 'module',
      'continuing education', 'cpd', 'professional development', 'certificate',
      'masterclass', 'workshop', 'tutorial', 'induction', 'onboarding', 'mentoring',
      'supervision', 'competency', 'catalogue of courses'],
    tags: ['PD video'],
  },
  {
    key: 'clinical-practice',
    name: 'Clinical Practice Guides',
    description: 'How Opal approaches intervention, reasoning and clinical decisions.',
    parent: null, purpose: true,
    types: ['clinical_guide'],
    strong: ['clinical reasoning', 'clinical guideline', 'practice guide',
      'evidence base', 'model of practice', 'treatment planning', 'clinical risk',
      'discharge planning', 'caregiver coaching', 'parent coaching'],
    words: ['intervention', 'clinical reasoning', 'evidence base', 'practice guide',
      'clinical guideline', 'best practice', 'framework', 'model of practice',
      'goal writing', 'treatment planning', 'workflow', 'caseload', 'clinical risk',
      'therapeutic', 'dosage', 'discharge planning', 'caregiver coaching', 'parent coaching'],
    tags: ['Research article', 'Case example'],
  },
  {
    key: 'practice-operations',
    name: 'Practice Operations',
    description: 'Running the practice: administration, systems, safety and travel.',
    parent: null, purpose: true,
    strong: ['information security', 'how we work', 'your first day',
      'who to ask for help', 'master scheduler', 'rural and remote practice',
      'staff handbook', 'practice information', 'pre trip checklist',
      'welcome to opal', 'about opal', 'timesheet', 'payroll', 'recruitment'],
    words: ['invoice', 'billing', 'roster', 'scheduling', 'timesheet', 'expense',
      'vehicle', 'travel', 'rural trip', 'pre-trip', 'fleet', 'office', 'stocktake',
      'equipment register', 'information security', 'password', 'software',
      'phone system', 'email signature', 'branding', 'marketing', 'recruitment',
      'employment', 'payroll', 'leave', 'human resources',
      'at opal', 'opal therapy', 'the practice', 'our team', 'first day',
      'who to ask', 'scheduler', 'rural', 'remote', 'onboarding', 'orientation',
      'workflow guide', 'how to use', 'portal'],
  },
  {
    key: 'client-family',
    name: 'Client & Family Resources',
    description: 'Handouts and information written for clients, families and carers.',
    parent: null, purpose: true,
    strong: ['handout', 'information sheet', 'infosheet', 'factsheet', 'fact sheet',
      'for parents', 'for families', 'for carers', 'parent guide', 'carer guide',
      'welcome pack', 'a guide for families', 'home program'],
    words: ['handout', 'information sheet', 'infosheet', 'factsheet', 'fact sheet',
      'for parents', 'for families', 'for carers', 'parent guide', 'carer guide',
      'what to expect', 'welcome pack', 'frequently asked', 'faq', 'brochure',
      'home program', 'tips for home', 'explaining', 'a guide for families'],
    tags: ['Handout', 'Home program'],
  },

  // ═══ TOPIC THEMES — the therapy material ═══════════════════════════════
  {
    key: 'therapy-resources',
    name: 'Therapy Resources',
    description: 'Activities, worksheets and materials used in and between sessions.',
    parent: null,
    types: ['worksheet', 'download', 'article', 'document', 'resource'],
    words: ['worksheet', 'activity', 'printable', 'poster', 'flashcard', 'flash card',
      'game', 'colouring', 'coloring', 'craft', 'cards', 'template pack', 'display pack',
      'session plan', 'lesson', 'workbook', 'booklet'],
    tags: ['Worksheet', 'Activity idea', 'Visual support', 'Session plan'],
  },
  {
    key: 'emotional-regulation',
    name: 'Emotional Regulation',
    description: 'Feelings, calming, coping and self-regulation materials.',
    parent: 'therapy-resources',
    words: ['emotion', 'emotional', 'feeling', 'feelings', 'zones of regulation',
      'areas of regulation', 'self regulation', 'self-regulation', 'regulation',
      'calm', 'calming', 'anger', 'angry', 'anxiety', 'anxious', 'worry', 'worries',
      'worried', 'frustration', 'coping', 'cope', 'mindfulness', 'breathing',
      'thermometer', 'volcano', 'meltdown', 'big feelings', 'mood', 'stress',
      'grounding', 'safe place', 'trauma', 'grief', 'mental health', 'depression',
      'window of tolerance', 'zones', 'blank faces', 'face outline', 'body mapping',
      'body outline', 'how i feel', 'i feel', 'cbt', 'wellbeing', 'self esteem',
      'confidence', 'resilience', 'reflection', 'gratitude', 'interoception'],
    tags: ['Emotional regulation'],
  },
  {
    key: 'social-skills',
    name: 'Social Skills',
    description: 'Social stories, friendship, conversation and social understanding.',
    parent: 'therapy-resources',
    words: ['social story', 'social stories', 'social script', 'social scripts',
      'social narrative', 'social narratives', 'social skills',
      'social situation', 'friendship', 'friend', 'friends', 'making friends',
      'conversation', 'turn taking', 'turn-taking', 'taking turns', 'sharing',
      'manners', 'greeting', 'empathy', 'bully', 'bullying', 'teasing',
      'personal space', 'boundaries', 'peer', 'play skills', 'group work',
      'saying no', 'asking for', 'compliment', 'apolog'],
    tags: ['Social skills', 'Play skills'],
  },
  {
    key: 'communication',
    name: 'Communication Supports',
    description: 'Visual supports, symbols, AAC, Auslan and communication aids.',
    parent: 'therapy-resources',
    strong: ['communication card', 'communication board', 'communication fan',
      'communication passport', 'visual support', 'auslan', 'key word sign',
      'nonverbal communication', 'display pack', 'aac', 'pecs'],
    words: ['visual support', 'visual aid', 'visual cue', 'symbol', 'pecs', 'aac',
      'communication board', 'communication fan', 'auslan', 'sign language',
      'key word sign', 'choice board', 'now and next', 'first then', 'speech',
      'language', 'vocabulary', 'talking', 'listening', 'voice level', 'voice volume',
      'traffic light', 'communication passport', 'widgit',
      'flashcard', 'flash card', 'task card', 'loop card', 'question card',
      'picture card', 'word card', 'expression card', 'prompt card', 'cue card',
      'labelling', 'word search', 'word wall', 'nonverbal', 'non verbal',
      'i need a break', 'lanyard', 'easy english', 'display poster'],
    tags: ['Communication supports', 'Visual support'],
  },
  {
    key: 'routines-schedules',
    name: 'Routines & Schedules',
    description: 'Visual timetables, checklists and daily routine supports.',
    parent: 'therapy-resources',
    words: ['visual timetable', 'timetable', 'schedule', 'routine', 'daily routine',
      'morning routine', 'bedtime', 'getting ready', 'checklist', 'planner',
      'calendar', 'time table', 'weekly', 'sequence', 'step by step', 'task list',
      'chore', 'reward chart', 'token board', 'star chart'],
    tags: ['Routine building'],
  },
  {
    key: 'handwriting-motor',
    name: 'Handwriting & Motor Skills',
    description: 'Handwriting, fine motor, gross motor and coordination activities.',
    parent: 'therapy-resources',
    words: ['handwriting', 'writing', 'letter formation', 'pencil grip', 'pencil grasp',
      'tracing', 'pre-writing', 'prewriting', 'cutting', 'scissor', 'fine motor',
      'gross motor', 'dough', 'playdough', 'threading', 'lacing', 'bilateral',
      'ball skills', 'balance', 'coordination', 'posture', 'core strength',
      'animal walk', 'bear walk', 'movement break', 'obstacle course', 'drawing',
      'colouring page', 'dot to dot', 'maze'],
    tags: ['Handwriting', 'Fine motor', 'Gross motor'],
  },
  {
    key: 'executive-function',
    name: 'Executive Function',
    description: 'Attention, planning, organisation, memory and problem solving.',
    parent: 'therapy-resources',
    words: ['executive function', 'executive functioning', 'attention', 'focus',
      'concentration', 'planning', 'organisation', 'organization', 'working memory',
      'memory', 'problem solving', 'decision making', 'time management',
      'impulse', 'inhibition', 'flexible thinking', 'goal setting', 'prioritis',
      'study skills', 'homework', 'circle of control'],
    tags: ['Executive functioning'],
  },
  {
    key: 'sensory',
    name: 'Sensory Processing',
    description: 'Sensory strategies, diets, oral sensory and regulation through the senses.',
    parent: 'therapy-resources',
    words: ['sensory', 'sensory diet', 'sensory processing', 'proprioceptive',
      'vestibular', 'tactile', 'oral sensory', 'chewing', 'chew', 'fidget',
      'weighted', 'heavy work', 'noise', 'sensory circuit', 'sensory profile',
      'over-responsive', 'under-responsive', 'ayres', 'sensory integration',
      'texture', 'messy play'],
    tags: ['Sensory processing', 'Oral sensory / chewing'],
  },
  {
    key: 'daily-living',
    name: 'Daily Living Skills',
    description: 'Self-care, dressing, feeding, toileting, cooking and independence.',
    parent: 'therapy-resources',
    words: ['dressing', 'getting dressed', 'toilet', 'toileting', 'showering',
      'bathing', 'personal care', 'hygiene', 'teeth', 'grooming', 'feeding',
      'eating', 'mealtime', 'cooking', 'kitchen', 'shopping', 'laundry',
      'cleaning', 'adl', 'iadl', 'self care', 'self-care', 'independence',
      'money', 'coins', 'budget', 'banking', 'sleep', 'road safety', 'safety at home',
      'catching the bus', 'public transport', 'community access', 'adulting'],
    tags: ['ADLs', 'IADLs', 'Personal care', 'Toileting', 'Feeding', 'Cooking',
      'Money management', 'Sleep', 'Community access'],
  },
  {
    key: 'equipment-environment',
    name: 'Equipment & Home Modifications',
    description: 'Assistive technology, equipment prescription and home safety.',
    parent: 'therapy-resources',
    types: ['product_link', 'equipment_idea'],
    strong: ['assistive technology', 'home modification', 'equipment prescription',
      'pressure care', 'shower chair', 'mobility aid', 'wheelchair', 'orthotic'],
    words: ['assistive technology', 'equipment', 'prescription', 'wheelchair',
      'seating', 'pressure care', 'hoist', 'transfer', 'rail', 'ramp',
      'home modification', 'home safety', 'falls', 'bathroom aid', 'shower chair',
      'adaptive', 'aids and equipment', 'mobility aid', 'walker', 'orthotic', 'splint',
      'scissors', 'putty', 'theraputty', 'cushion', 'wobble', 'lap pad', 'timer',
      'slant board', 'pencil grip', 'chewable', 'chew tool', 'wedge', 'grab rail'],
    tags: ['Assistive technology', 'Equipment prescription', 'Home safety', 'Mobility'],
  },
  {
    key: 'body-safety',
    name: 'Body Awareness & Safety',
    description: 'Body parts, personal safety, protective behaviours and consent.',
    parent: 'therapy-resources',
    strong: ['protective behaviour', 'personal safety', 'body part', 'safe and unsafe',
      'safe or unsafe', 'private part', 'consent', 'consensual', 'stranger danger',
      'body awareness', 'being safe online', 'online safety', 'road safety'],
    words: ['body', 'my body', 'body map', 'body outline', 'senses', 'anatomy',
      'safe', 'unsafe', 'safety', 'danger', 'touching', 'touch', 'ok to',
      'my circle', 'circle of trust', 'trusted adult', 'help me', 'who to tell',
      'privacy', 'private', 'boundaries', 'saying no', 'say no', 'secrets',
      'first aid', 'emergency', 'stay safe', 'fire safety', 'water safety'],
    veto: ['work health and safety', 'safety data sheet'],
  },
  {
    key: 'school-participation',
    name: 'School & Learning Support',
    description: 'Classroom strategies, school participation and educator resources.',
    parent: 'therapy-resources',
    words: ['classroom', 'school', 'teacher', 'educator', 'student', 'learning support',
      'curriculum', 'iep', 'individual education', 'school strategy', 'transition to school',
      'playground', 'homework', 'literacy', 'numeracy', 'phonics', 'maths', 'spelling',
      'geography', 'science worksheet'],
    tags: ['School participation', 'School-based therapy', 'School strategy'],
  },
]);

const BY_KEY = Object.freeze(THEMES.reduce((m, t) => { m[t.key] = t; return m; }, {}));
const TOP_LEVEL = THEMES.filter((t) => !t.parent);
const CHILDREN_OF = (key) => THEMES.filter((t) => t.parent === key);

// ── text handling ─────────────────────────────────────────────────────────

/**
 * Crude singularisation, applied identically to the vocabulary and to the
 * document, so "Understanding Emotions Worksheet" matches the phrase
 * "emotion".
 *
 * Without it the lexicon has to carry every plural by hand, and the ones
 * nobody remembered are invisible failures: an emotions worksheet that matched
 * no theme went to Needs Review looking like an genuinely ambiguous document.
 * Only plural 's'/'es'/'ies' is stripped — verb endings collide too often
 * ("reading" is not "read") for the gain they would buy here.
 */
function stem(word) {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && (word.endsWith('sses') || word.endsWith('shes') || word.endsWith('ches'))) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/** Lower-cased, punctuation flattened, singularised, so "self-regulation" matches "self regulation". */
function normalise(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(stem);
  return ` ${words.join(' ')} `;
}

/** Whole-phrase containment on the normalised haystack. */
function has(haystack, phrase) {
  return haystack.includes(` ${normalise(phrase).trim()} `);
}

/**
 * A phrase is worth more when it is specific. "social story" is evidence of a
 * theme; "social" appears in a dozen unrelated documents. Word count is a
 * crude proxy for specificity and it is a good one here.
 */
function phraseWeight(phrase) {
  const words = normalise(phrase).trim().split(' ').filter(Boolean).length;
  if (words >= 3) return 3;
  if (words === 2) return 2;
  return 1;
}

/**
 * HOW MUCH IS A TAG WORTH? — the corpus decides, not the code.
 *
 * A person curated these tags, so a tag is strong evidence in principle. In
 * practice a tag applied to a quarter of the library says almost nothing:
 * "Social skills" (157 resources) and "Communication supports" (150) are
 * applied together so routinely that they tie on every resource that carries
 * them, and a tie is what sends material to Needs Review.
 *
 * Inverse document frequency turns that observation into arithmetic. A tag on
 * sixteen resources is decisive; a tag on a hundred and fifty is a hint, and
 * the words in the title get to decide instead. This is the collection-level
 * analysis of §7 doing real work: the same tag is worth different amounts in
 * different libraries, because it carries different amounts of information in
 * each.
 *
 * @param {string[][]} tagLists one array of tag names per resource
 * @returns {Record<string, number>} normalised tag name → weight
 */
function tagWeights(tagLists) {
  const total = Math.max(1, tagLists.length);
  const freq = new Map();
  for (const list of tagLists) {
    for (const tag of new Set((list || []).map((t) => normalise(t).trim()))) {
      if (tag) freq.set(tag, (freq.get(tag) || 0) + 1);
    }
  }
  const out = {};
  for (const [tag, n] of freq) {
    const idf = Math.log(total / Math.max(1, n));
    out[tag] = Math.round(Math.min(TAG_WEIGHT_MAX, Math.max(TAG_WEIGHT_MIN, idf * 2)) * 100) / 100;
  }
  return out;
}

// ── the semantic profile ──────────────────────────────────────────────────

/**
 * What we understand about one resource, before any folder is chosen.
 *
 * The FIELDS the model is later asked to refine are exactly these, so an AI
 * profile and a rules profile are interchangeable downstream and the pipeline
 * behaves identically with the model off (§61).
 *
 * @param {object} resource  row-shaped: id, title, description, content,
 *                           content_type, resource_type, external_url
 * @param {object} extra     { tags: string[], text: string, textSource: string }
 * @returns {object} profile
 */
function buildProfile(resource, extra = {}) {
  const tags = Array.isArray(extra.tags) ? extra.tags : [];
  const text = String(extra.text || '');

  // Weighted fields: a title is the strongest single statement of what a
  // document is, a tag is the strongest because a person chose it, and the
  // body is corroboration rather than evidence.
  const fields = [
    { hay: normalise(resource.title), weight: 3 },
    { hay: normalise(resource.description), weight: 2 },
    { hay: normalise(`${resource.content || ''} ${text}`.slice(0, 20000)), weight: 1 },
  ];
  const tagHay = normalise(tags.join(' | '));
  const tagWeights = extra.tagWeights || {};
  const contentType = String(resource.content_type || resource.resource_type || '').toLowerCase();

  const signals = {};
  for (const theme of THEMES) {
    let score = 0;
    /**
     * Body matches are capped per theme. Without this, a fifteen-page document
     * that happens to say "NDIS" throughout outscores a title that says
     * "Screening Tool" — the theme with the longest word list wins, which is a
     * property of the lexicon rather than of the document. The body corroborates
     * a theme; it does not establish one.
     */
    let bodyScore = 0;
    /**
     * The title's contribution, kept separately. Tags are shared far more
     * loosely than titles in this corpus, so when two sibling themes tie on
     * tags the title is what actually distinguishes them — see chooseTheme.
     */
    let titleScore = 0;
    const hits = [];

    const scorePhrase = (phrase, multiplier) => {
      const w = phraseWeight(phrase) * multiplier;
      for (const f of fields) {
        if (!has(f.hay, phrase)) continue;
        if (f.weight === 1) bodyScore += w;          // body: capped below
        else score += w * f.weight;
        if (f.weight === 3) titleScore += w * f.weight;
        hits.push(phrase);
        return; // one field's worth per phrase — repetition is not evidence
      }
    };

    // Decisive first, so a title that names what the document IS cannot be
    // outvoted by another theme's accumulated hints.
    for (const phrase of theme.strong || []) scorePhrase(phrase, STRONG_MULTIPLIER);
    for (const phrase of theme.words || []) {
      if ((theme.strong || []).includes(phrase)) continue;
      scorePhrase(phrase, 1);
    }
    score += Math.min(bodyScore, MAX_BODY_SCORE);

    for (const tag of theme.tags || []) {
      if (has(tagHay, tag)) {
        const w = tagWeights[normalise(tag).trim()];
        score += Number.isFinite(w) ? w : TAG_WEIGHT_DEFAULT;
        hits.push(`tag:${tag}`);
      }
    }
    if ((theme.types || []).includes(contentType)) { score += 4; hits.push(`type:${contentType}`); }
    for (const phrase of theme.veto || []) {
      if (fields.some((f) => has(f.hay, phrase))) { score = 0; break; }
    }

    if (score > 0) signals[theme.key] = { score, titleScore, hits: hits.slice(0, 6) };
  }

  const ranked = Object.entries(signals)
    .map(([key, s]) => ({ key, score: s.score }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));

  const topics = ranked.slice(0, 4).map((r) => BY_KEY[r.key].name);
  const purposeHit = ranked.find((r) => BY_KEY[r.key].purpose);

  return {
    resourceId: resource.id,
    title: resource.title || '',
    summary: summarise(resource, text),
    primaryPurpose: purposeHit ? BY_KEY[purposeHit.key].name : 'Therapy material',
    resourceKind: kindOf(resource, contentType),
    audience: audienceOf(fields, tagHay, contentType),
    topics,
    signals,
    ranked,
    source: 'rules',
    textSource: extra.textSource || (resource.content ? 'content' : 'metadata'),
  };
}

/** One sentence a person could read, drawn from what the record already says. */
function summarise(resource, text) {
  const desc = String(resource.description || '').trim();
  if (desc) return desc.slice(0, 400);
  const body = String(resource.content || text || '')
    .replace(/[#*_>`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body ? body.slice(0, 300) : '';
}

const KIND_WORDS = [
  ['policy', ['policy', 'procedure', 'code of conduct']],
  ['assessment', ['assessment', 'screening tool', 'rating scale', 'outcome measure']],
  ['template', ['template', 'proforma', 'phrase bank']],
  ['checklist', ['checklist', 'audit tool']],
  ['worksheet', ['worksheet', 'activity sheet', 'activity']],
  ['visual support', ['visual', 'poster', 'card', 'cards', 'timetable', 'symbol']],
  ['social story', ['social story', 'social script', 'social narrative']],
  ['handout', ['handout', 'information sheet', 'factsheet', 'fact sheet', 'brochure']],
  ['course', ['course', 'training', 'webinar', 'module']],
  ['guide', ['guide', 'guideline', 'framework', 'workflow']],
];

function kindOf(resource, contentType) {
  const hay = normalise(`${resource.title} ${resource.description || ''}`);
  for (const [kind, words] of KIND_WORDS) {
    if (words.some((w) => has(hay, w))) return kind;
  }
  if (resource.external_url) return 'external reference';
  return contentType || 'document';
}

const CLIENT_WORDS = ['for parents', 'for families', 'for carers', 'handout', 'my ', 'i can',
  'social story', 'colouring', 'coloring', 'activity sheet', 'worksheet'];
const STAFF_WORDS = ['policy', 'procedure', 'staff', 'clinician', 'therapist', 'supervision',
  'clinical reasoning', 'report writing', 'workflow', 'induction'];

function audienceOf(fields, tagHay, contentType) {
  const hay = fields[0].hay + fields[1].hay;
  if (STAFF_WORDS.some((w) => has(hay, w))) return 'Staff';
  if (CLIENT_WORDS.some((w) => has(hay, w))) return 'Client or family';
  if (['policy', 'standard', 'clinical_guide', 'course', 'tutorial'].includes(contentType)) return 'Staff';
  return 'Therapist';
}

// ── choosing a theme for one profile ──────────────────────────────────────

/**
 * The best theme for a profile, with a confidence that means something.
 *
 * Purpose beats topic (§45): a policy about handwriting is a policy. The
 * purpose winner only has to be credible, not dominant, to take precedence —
 * but it must still clear MIN_SCORE, so a stray word like "framework" does
 * not drag an activity sheet into Clinical Practice Guides.
 */
function chooseTheme(profile, allowedKeys) {
  const allowed = allowedKeys ? new Set(allowedKeys) : null;
  const ranked = (profile.ranked || []).filter((r) => !allowed || allowed.has(r.key));
  if (!ranked.length) return { key: null, confidence: 0, reason: 'no signal' };

  const purposeRanked = ranked.filter((r) => BY_KEY[r.key] && BY_KEY[r.key].purpose);
  const topicRanked = ranked.filter((r) => BY_KEY[r.key] && !BY_KEY[r.key].purpose);

  // A purpose theme wins when it is credible on its own terms, or when it is
  // simply the strongest signal present.
  const bestPurpose = purposeRanked[0];
  const bestTopic = topicRanked[0];
  let winner = ranked[0];
  let purposeOverride = false;
  if (bestPurpose && bestPurpose.score >= MIN_SCORE
      && (!bestTopic || bestPurpose.score >= bestTopic.score * 0.75)) {
    purposeOverride = winner.key !== bestPurpose.key;
    winner = bestPurpose;
  }

  if (winner.score < MIN_SCORE) {
    const weak = BY_KEY[winner.key];
    if (weak && weak.parent) {
      return { key: weak.parent, confidence: CONFIDENCE_FLOOR, reason: 'broad placement' };
    }
    return { key: winner.key, confidence: 0.2, reason: 'weak signal' };
  }

  const runnerUp = ranked.find((r) => r.key !== winner.key);

  /**
   * A CLOSE SECOND IS ONLY AMBIGUITY WHEN THE TWO ANSWERS DISAGREE.
   *
   * Three near-ties in this corpus are not ambiguity at all, and treating them
   * as such is what produced a Needs Review bucket holding one document in
   * seven:
   *
   *   parent vs child   "Emotional Regulation" against "Therapy Resources" is
   *                     the same answer at two levels of detail. Take the
   *                     child: it is more useful and it is not wrong.
   *   sibling vs sibling  handled below — the title decides, else the parent.
   *   purpose vs topic  the purpose rule (§45) deliberately outranks the
   *                     topic theme, so that theme's score is an expected
   *                     consequence of the rule, not evidence against it.
   *
   * Only a close second that is genuinely a different answer counts against
   * confidence.
   */
  if (runnerUp) {
    const a = BY_KEY[winner.key];
    const b = BY_KEY[runnerUp.key];
    if (a && b && winner.score / runnerUp.score < MIN_MARGIN) {
      if (a.parent === runnerUp.key || b.parent === winner.key) {
        const child = a.parent === runnerUp.key ? a : b;
        const best = Math.max(winner.score, runnerUp.score);
        return {
          key: child.key,
          confidence: Math.max(CONFIDENCE_FLOOR, Math.round(Math.min(1, best / 16) * 1000) / 1000),
          reason: 'more specific',
        };
      }
      if (a.parent && a.parent === b.parent) {
        // Ask the title before giving up on the child. A resource carrying both
        // "Social skills" and "Communication supports" ties on tags, but
        // "Traffic Light Communication Fans" is not ambiguous to a reader, and
        // the title is where that plain fact lives.
        const ta = (profile.signals[a.key] || {}).titleScore || 0;
        const tb = (profile.signals[b.key] || {}).titleScore || 0;
        if (ta !== tb) {
          const won = ta > tb ? a : b;
          return {
            key: won.key,
            confidence: Math.max(CONFIDENCE_FLOOR, Math.round(Math.min(1, (winner.score + Math.abs(ta - tb)) / 24) * 1000) / 1000),
            reason: 'title tiebreak',
          };
        }
        return {
          key: a.parent,
          confidence: Math.max(CONFIDENCE_FLOOR, Math.round(Math.min(1, winner.score / 20) * 1000) / 1000),
          reason: 'shared parent',
        };
      }
    }
  }

  const contender = ranked.find((r) => {
    if (r.key === winner.key) return false;
    if (purposeOverride && BY_KEY[r.key] && !BY_KEY[r.key].purpose) return false;
    const t = BY_KEY[r.key];
    const w = BY_KEY[winner.key];
    if (!t || !w) return true;
    // Related themes are the same answer at a different altitude, not a rival.
    return !(t.parent === winner.key || w.parent === r.key || (t.parent && t.parent === w.parent));
  });
  const second = contender ? contender.score : 0;

  // Two components: how much evidence there is at all, and how clearly the
  // winner beat the field. Both matter — a strong score that two themes share
  // equally is still a coin toss.
  const magnitude = Math.min(1, winner.score / 30);
  const margin = second === 0 ? 1 : Math.min(1, (winner.score / second) / (MIN_MARGIN * 1.6));
  const confidence = Math.round((0.45 * magnitude + 0.55 * margin) * 1000) / 1000;

  return { key: winner.key, confidence, reason: purposeOverride ? 'purpose' : 'lexical' };
}

// ── deriving the tree ─────────────────────────────────────────────────────

/**
 * PASS 2 — look at the whole collection and decide what the folders are.
 *
 * Every profile is provisionally placed, the placements are counted, and only
 * then is the tree decided. A theme nobody landed in is not created; a theme
 * with three members is folded into its parent (or, at the top level, its
 * members are re-placed among the survivors). Subfolders appear only under a
 * parent large enough to be worth dividing.
 *
 * @param {object[]} profiles
 * @returns {{folders: object[], counts: object}}
 */
function deriveTaxonomy(profiles) {
  // Provisional placement against the full vocabulary.
  const provisional = new Map();
  for (const p of profiles) {
    provisional.set(p.resourceId, chooseTheme(p));
  }

  // Roll every placement up to its top-level theme so a parent is measured by
  // everything beneath it, not only by what landed directly on it.
  const topCount = new Map();
  const subCount = new Map();
  for (const choice of provisional.values()) {
    if (!choice.key || choice.confidence < CONFIDENCE_FLOOR) continue;
    const theme = BY_KEY[choice.key];
    if (!theme) continue;
    const topKey = theme.parent || theme.key;
    topCount.set(topKey, (topCount.get(topKey) || 0) + 1);
    if (theme.parent) subCount.set(theme.key, (subCount.get(theme.key) || 0) + 1);
  }

  const limits = thresholdsFor(profiles.length);

  // Big enough to exist, and — if more themes qualify than a person can hold
  // in their head — only the largest of them (§9).
  const keptTop = TOP_LEVEL
    .filter((t) => (topCount.get(t.key) || 0) >= limits.folder)
    .sort((a, b) => (topCount.get(b.key) || 0) - (topCount.get(a.key) || 0))
    .slice(0, MAX_TOP_LEVEL_FOLDERS)
    .map((t) => t.key);

  const folders = [];
  // Emitted in vocabulary order rather than by size, so the shelf order a
  // reader learns does not shuffle every time a run changes the counts (§25).
  for (const theme of TOP_LEVEL) {
    const key = theme.key;
    if (!keptTop.includes(key)) continue;
    folders.push({
      key: theme.key, name: theme.name, description: theme.description,
      parent: null, isReviewBucket: false,
    });
    // Subfolders only where the parent is big enough to need them (§70).
    if ((topCount.get(key) || 0) < limits.parent) continue;
    for (const child of CHILDREN_OF(key)) {
      if ((subCount.get(child.key) || 0) < limits.subfolder) continue;
      folders.push({
        key: child.key, name: child.name, description: child.description,
        parent: child.parent, isReviewBucket: false,
      });
    }
  }

  folders.push({ ...REVIEW_FOLDER });
  return {
    folders, limits,
    counts: { top: Object.fromEntries(topCount), sub: Object.fromEntries(subCount) },
  };
}

/**
 * PASS 3 — final placement against the tree that actually exists.
 *
 * Re-chosen rather than reused, because pruning changed the option set: a
 * resource whose best theme was dropped must be re-placed among the survivors,
 * not orphaned.
 *
 * @returns {object[]} [{resourceId, folderKey, confidence, source, rationale}]
 */
function assignAll(profiles, taxonomy) {
  const live = new Set(taxonomy.folders.filter((f) => !f.isReviewBucket).map((f) => f.key));
  const liveKeys = [...live];

  return profiles.map((p) => {
    let choice = chooseTheme(p);

    /**
     * PRUNING MUST NOT CREATE ORPHANS.
     *
     * The best theme for a resource may not have survived derivation — its
     * subfolder was too small, or its whole top-level theme was. A subfolder's
     * members belong with their parent, which is easy. A pruned TOP-LEVEL
     * theme has no parent to fall to, and treating that as "unclassifiable"
     * was wrong: the resource is not ambiguous, we simply decided not to build
     * the shelf it wanted. So it is re-chosen among the shelves that do exist,
     * exactly as a resource uploaded after the fact would be.
     *
     * This matters most for a SMALL library, where most themes are pruned and
     * the old behaviour sent half the collection to Needs Review.
     */
    let folderKey = null;
    if (choice.key) {
      if (live.has(choice.key)) folderKey = choice.key;
      else {
        const theme = BY_KEY[choice.key];
        if (theme && theme.parent && live.has(theme.parent)) folderKey = theme.parent;
        else {
          const second = chooseTheme(p, liveKeys);
          if (second.key && live.has(second.key)) { folderKey = second.key; choice = second; }
        }
      }
    }

    if (!folderKey || choice.confidence < CONFIDENCE_FLOOR) {
      return {
        resourceId: p.resourceId, folderKey: REVIEW_KEY,
        confidence: choice.confidence || 0, source: p.source === 'ai' ? 'ai' : 'rules',
        rationale: choice.key ? `Best match ${BY_KEY[choice.key] ? BY_KEY[choice.key].name : choice.key} was not confident enough.` : 'No clear subject matter.',
      };
    }
    const theme = BY_KEY[folderKey];
    const hits = ((p.signals[choice.key] || {}).hits || []).slice(0, 3).join(', ');
    return {
      resourceId: p.resourceId,
      folderKey,
      confidence: choice.confidence,
      source: p.source === 'ai' ? 'ai' : 'rules',
      rationale: hits ? `Matched ${theme.name} on: ${hits}.`.slice(0, 300) : `Matched ${theme.name}.`,
    };
  });
}

/**
 * Place ONE resource against a taxonomy that already exists (§23, §24).
 *
 * Deliberately cannot create a folder. A new upload belongs in an existing
 * shelf or in Needs Review; letting a single document invent a category is
 * exactly the drift §24 forbids.
 */
function classifyOne(profile, existingFolderKeys) {
  const live = new Set(existingFolderKeys.filter((k) => k !== REVIEW_KEY));
  const choice = chooseTheme(profile, [...live]);
  if (!choice.key || choice.confidence < CONFIDENCE_FLOOR) {
    return { folderKey: REVIEW_KEY, confidence: choice.confidence || 0, rationale: 'Not confidently any existing folder.' };
  }
  const theme = BY_KEY[choice.key];
  const hits = ((profile.signals[choice.key] || {}).hits || []).slice(0, 3).join(', ');
  return {
    folderKey: choice.key,
    confidence: choice.confidence,
    rationale: hits ? `Matched ${theme.name} on: ${hits}.`.slice(0, 300) : `Matched ${theme.name}.`,
  };
}

// ── duplicate awareness (§27) ─────────────────────────────────────────────

/** Title reduced to its meaningful words, for near-duplicate detection. */
function titleKey(title) {
  return normalise(title).trim().split(' ')
    .filter((w) => w.length > 2 && !['the', 'and', 'for', 'with', 'activity', 'sheet', 'free', 'printable'].includes(w))
    .sort().join(' ');
}

/**
 * Obvious duplicates only — same reduced title, or one title contained in
 * another of similar length. Reported, never acted on (§27).
 */
function findDuplicates(profiles, limit = 40) {
  const groups = new Map();
  for (const p of profiles) {
    const k = titleKey(p.title);
    if (!k) continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ resourceId: p.resourceId, title: p.title });
  }
  const out = [];
  for (const [, members] of groups) {
    if (members.length > 1) out.push({ reason: 'Same title', members: members.slice(0, 6) });
    if (out.length >= limit) break;
  }
  return out;
}

module.exports = {
  THEMES, BY_KEY, REVIEW_KEY, REVIEW_FOLDER, STRONG_MULTIPLIER, MAX_BODY_SCORE,
  MIN_FOLDER_SIZE, MIN_SUBFOLDER_SIZE, MIN_PARENT_FOR_SUBFOLDERS, CONFIDENCE_FLOOR,
  MAX_TOP_LEVEL_FOLDERS, thresholdsFor,
  TAG_WEIGHT_MIN, TAG_WEIGHT_MAX, TAG_WEIGHT_DEFAULT,
  stem, normalise, has, tagWeights, buildProfile, chooseTheme, deriveTaxonomy, assignAll, classifyOne,
  findDuplicates, titleKey,
};
