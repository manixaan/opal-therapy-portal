/**
 * Final Resource Hub work: staff file access in the UI, the controlled
 * instrument register, the unresolved-source review queue, the repaired
 * clinical filters, and governance-readiness presentation.
 *
 * The frontend assertions parse the shipped source rather than a copy, because
 * this module is one string-building IIFE with no seams to unit-test through.
 * Code-level assertions run against a comment-stripped view so that prose
 * explaining a removed behaviour cannot satisfy or trip them.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const UI = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'resourcehub.js'), 'utf8');
const CODE = UI
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const ROUTES = fs.readFileSync(
  path.join(__dirname, '..', 'resource-hub-r2-routes.js'), 'utf8');
const REGISTER = fs.readFileSync(
  path.join(__dirname, '..', 'instrument-register-routes.js'), 'utf8');
const SEED = fs.readFileSync(
  path.join(__dirname, '..', 'setup', 'seed-controlled-instruments.js'), 'utf8');
const MIG_027 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '027_controlled_instruments.sql'), 'utf8');

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const REGISTER_CODE = strip(REGISTER);
const SEED_CODE = strip(SEED);

const G = require('../resource-governance');

// ── 1. File access in the interface ─────────────────────────────────────────

describe('resource detail file section', () => {
  test('files come from the authorised metadata endpoint only', () => {
    expect(CODE).toMatch(/api\('\/api\/rh2\/resources\/' \+ encodeURIComponent\(id\) \+ '\/files'\)/);
  });

  test('the download href is the server-supplied URL, never rebuilt', () => {
    const fn = CODE.slice(CODE.indexOf('function renderDetailFiles'), CODE.indexOf('function tierLabel'));
    expect(fn).toMatch(/href="' \+ esc\(f\.downloadUrl\)/);
    // no storage key, backend name or path fragment is ever referenced
    expect(fn).not.toMatch(/storage_key|storageKey|storage_backend|rhub|\.resource-hub-files/);
  });

  test('nothing anywhere in the module reconstructs a file path', () => {
    expect(CODE).not.toMatch(/storage_key|storageKey|storage_backend/);
    expect(CODE).not.toMatch(/7 Resources/);
    expect(CODE).not.toMatch(/\/api\/rh2\/files\/' \+/);   // ids come from downloadUrl
  });

  test('the primary PDF gets the main action and the DOCX its own', () => {
    const fn = CODE.slice(CODE.indexOf('function fileActionLabel'), CODE.indexOf('function fileSizeLabel'));
    expect(fn).toMatch(/View or download PDF/);
    expect(fn).toMatch(/Editable Word version/);
    expect(fn).toMatch(/f\.isPrimary && f\.format === 'pdf'/);
  });

  test('a restricted file is labelled with its access level', () => {
    expect(CODE).toMatch(/function tierLabel/);
    expect(CODE).toMatch(/Clinician access/);
    expect(CODE).toMatch(/Administrator access/);
  });

  test('the view renders only what the server returned — it makes no access decision', () => {
    const fn = CODE.slice(CODE.indexOf('function renderDetailFiles'), CODE.indexOf('function tierLabel'));
    expect(fn).not.toMatch(/canReadFile|canReadTier|role\(\)|isOwner\(\)/);
  });

  test('loading, empty and unavailable states are all handled in plain language', () => {
    const fn = CODE.slice(CODE.indexOf('function renderDetailFiles'), CODE.indexOf('function tierLabel'));
    expect(fn).toMatch(/filesLoading/);
    expect(fn).toMatch(/Loading files/);
    expect(fn).toMatch(/No files are attached/);
    expect(fn).toMatch(/filesErr/);
  });

  test('a 404 from the files endpoint means "none", not an error banner', () => {
    const loader = CODE.slice(CODE.indexOf('async function loadDetailFiles'), CODE.indexOf('function fileActionLabel'));
    expect(loader).toMatch(/d\.status === 404/);
  });

  test('a stale response from a previous resource cannot render', () => {
    const loader = CODE.slice(CODE.indexOf('async function loadDetailFiles'), CODE.indexOf('function fileActionLabel'));
    expect(loader).toMatch(/S\.detail\.id !== id/);
  });

  test('download controls are real links, so they are keyboard reachable', () => {
    const fn = CODE.slice(CODE.indexOf('function renderDetailFiles'), CODE.indexOf('function tierLabel'));
    expect(fn).toMatch(/<a class="rh2-btn/);
    expect(fn).toMatch(/aria-describedby=/);
  });

  test('status messages are announced to screen readers', () => {
    const fn = CODE.slice(CODE.indexOf('function renderDetailFiles'), CODE.indexOf('function tierLabel'));
    expect(fn).toMatch(/role="status"/);
    expect(fn).toMatch(/rh2-visually-hidden/);
  });

  test('the new file state is declared in BOTH the initial literal and openDetail', () => {
    const decls = CODE.match(/files: null, filesLoading: false, filesErr: ''/g) || [];
    expect(decls.length).toBe(2);
  });
});

describe('file surfaces agree with the detail surface', () => {
  // Delivery now climbs ONE decision ladder (loadDeliverableFile) shared by
  // download, inline preview and thumbnail, so the surfaces cannot drift from
  // each other — the guard asserts the ladder applies the detail rule and that
  // every delivery route actually climbs it.
  const ladder = ROUTES.slice(ROUTES.indexOf('async function loadDeliverableFile'),
    ROUTES.indexOf("router.get('/api/rh2/files/:fileId'"));

  test('the shared delivery ladder applies the same visibleTo rule as the detail route', () => {
    expect(ladder).toMatch(/visibleTo\(req\.user/);
    const meta = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources/:id/files'"),
      ROUTES.indexOf('Walk a resource through the review lifecycle'));
    expect(meta).toMatch(/visibleTo\(req\.user, resource\)/);
  });

  test('the ladder query selects the parent status and tier the rule needs', () => {
    expect(ladder).toMatch(/r\.status AS resource_status/);
    expect(ladder).toMatch(/r\.access_tier AS resource_tier/);
  });

  test('download, preview and thumbnail all climb the ladder', () => {
    for (const route of ["'/api/rh2/files/:fileId'", "'/api/rh2/files/:fileId/preview'",
      "'/api/rh2/files/:fileId/thumbnail'"]) {
      const start = ROUTES.indexOf(`router.get(${route}`);
      expect(start).toBeGreaterThan(-1);
      const body = ROUTES.slice(start, ROUTES.indexOf('}));', start));
      expect(body).toMatch(/loadDeliverableFile\(req, res/);
    }
  });
});

// ── 2. Controlled instrument register ───────────────────────────────────────

describe('controlled instrument register', () => {
  test('the register stores metadata only — no column can hold instrument content', () => {
    expect(MIG_027).not.toMatch(/file_data|storage_key|content BYTEA|blob/i);
    const create = MIG_027.slice(MIG_027.indexOf('CREATE TABLE IF NOT EXISTS controlled_instruments'),
      MIG_027.indexOf('COMMENT ON TABLE'));
    expect(create).not.toMatch(/\bfile\b/i);
  });

  test('all six instruments are seeded', () => {
    for (const k of ['whodas-2.0-36', 'copm', 'moca', 'rudas', 'sensory-profile', 'mohost']) {
      expect(SEED).toContain(k);
    }
  });

  test('every seeded row starts unreviewed — no licence conclusion is invented', () => {
    expect(SEED).toMatch(/'clinician','unreviewed','unreviewed',FALSE,'active'/);
    expect(SEED).not.toMatch(/licensed-for-use/);
  });

  test('the defaults in the schema are pessimistic', () => {
    expect(MIG_027).toMatch(/rights_status\s+VARCHAR\(40\) NOT NULL DEFAULT 'unreviewed'/);
    expect(MIG_027).toMatch(/clinical_status\s+VARCHAR\(30\) NOT NULL DEFAULT 'unreviewed'/);
    expect(MIG_027).toMatch(/access_restriction VARCHAR\(30\) NOT NULL DEFAULT 'clinician'/);
    expect(MIG_027).toMatch(/evidence_checked\s+BOOLEAN\s+NOT NULL DEFAULT FALSE/);
  });

  test('an instrument is never broader than clinician access', () => {
    const block = MIG_027.slice(MIG_027.indexOf('valid_instrument_access_restriction'));
    expect(block).toMatch(/IN \('clinician','admin'\)/);
    expect(block.slice(0, 300)).not.toMatch(/'staff'/);
  });

  test('WHODAS is LINKED to the existing module, not duplicated', () => {
    expect(SEED).toMatch(/linkedModule: 'whodas'/);
    expect(SEED).toMatch(/linkedModuleRoute: '\/api\/whodas\/instrument'/);
    // No instrument CONTENT is copied into the seed: no file references, no
    // item wording arrays, no scoring tables. The instrument NAME may of course
    // contain the word "item" ("36-item"), so match structures, not vocabulary.
    expect(SEED_CODE).not.toMatch(/\.pdf['"]/);
    expect(SEED_CODE).not.toMatch(/readFileSync|require\(.*whodas/);
    expect(SEED_CODE).not.toMatch(/items\s*:\s*\[/);
    expect(SEED_CODE).not.toMatch(/scoring\s*:/i);
  });

  test('the seed records the WHO position as a quotation, not as a conclusion', () => {
    expect(SEED).toMatch(/quotation of the source, not a determination/);
    expect(SEED).toMatch(/remains unticked/);
  });

  test('Opal is never recorded as the rights holder of a controlled instrument', () => {
    const holders = SEED.match(/rightsHolder: '[^']*'/g) || [];
    for (const h of holders) expect(h).not.toMatch(/Opal/i);
  });

  test('the source URL column cannot point at the local disk', () => {
    expect(MIG_027).toMatch(/instrument_source_url_is_web/);
    expect(MIG_027).toMatch(/source_url ~\* '\^https:\/\/'/);
  });

  test('unresolved fields are surfaced rather than left to look complete', () => {
    expect(REGISTER).toMatch(/function withUnresolvedFlags/);
    expect(REGISTER).toMatch(/unresolvedFields/);
    expect(REGISTER).toMatch(/mayBeUsedUnderRecordedLicence: row\.rights_status === 'licensed-for-use'/);
  });

  test('register edits require a reason and are restricted to governance roles', () => {
    expect(REGISTER).toMatch(/A reason is required for every register change/);
    expect(REGISTER).toMatch(/function requireReviewer/);
  });

  test('declaring an instrument clinically current is owner-only', () => {
    expect(REGISTER).toMatch(/function requireOwnerForClinical/);
    expect(REGISTER).toMatch(/canSetClinicalStatus/);
  });

  test('every register change writes an audit row inside the transaction', () => {
    const fn = REGISTER.slice(REGISTER.indexOf("router.post('/api/rh2/instruments/:id/review'"));
    expect(fn).toMatch(/BEGIN/);
    expect(fn).toMatch(/FOR UPDATE/);
    expect(fn).toMatch(/INSERT INTO controlled_instrument_events/);
    expect(fn).toMatch(/COMMIT/);
  });
});

// ── 3. Unresolved-source review queue ───────────────────────────────────────

describe('unresolved-source review queue', () => {
  test('the queue only lists records nobody has classified', () => {
    expect(REGISTER).toMatch(/r\.source_class = 'unknown'/);
  });

  test('quarantined records never appear in it', () => {
    const q = REGISTER.slice(REGISTER.indexOf("'/api/rh2/admin/source-review'"));
    expect(q).toMatch(/r\.access_tier <> 'excluded-private'/);
    expect(q).toMatch(/r\.publication_state <> 'excluded-private'/);
  });

  test('evidence is labelled as evidence, not as a proposed answer', () => {
    expect(REGISTER).toMatch(/evidenceNote:/);
    expect(REGISTER).toMatch(/They do not establish authorship or any right to redistribute/);
    // the API proposes nothing
    expect(REGISTER_CODE).not.toMatch(/suggested|likelySourceClass|proposedClass/i);
  });

  test('source class, publisher and rights are three independent inputs', () => {
    const post = REGISTER.slice(REGISTER.indexOf("router.post('/api/rh2/admin/source-review/:id'"));
    expect(post).toMatch(/const sourceClass =/);
    expect(post).toMatch(/const rightsStatus =/);
    expect(post).toMatch(/const publisher =/);
  });

  test('recording a source class CANNOT change rights implicitly', () => {
    const post = REGISTER.slice(REGISTER.indexOf("router.post('/api/rh2/admin/source-review/:id'"));
    // rights is only ever written from the explicit rightsStatus input
    // The ONLY branch that writes rights_status must test rightsStatus and
    // nothing else — a sourceClass term in that condition would be the implicit
    // grant this whole design exists to prevent.
    const lines = post.split('\n');
    const writeIdx = lines.findIndex((l) => /sets\.push\(`rights_status = /.test(l));
    expect(writeIdx).toBeGreaterThan(0);
    const guard = lines.slice(0, writeIdx).reverse().find((l) => /if \(/.test(l));
    expect(guard).toMatch(/rightsStatus !== undefined/);
    expect(guard).not.toMatch(/sourceClass/);
    // and the response says so
    expect(post).toMatch(/rightsUnchanged: rightsStatus === undefined/);
    expect(post).toMatch(/classification grants no redistribution right/);
  });

  test('a reason is mandatory for every decision', () => {
    expect(REGISTER).toMatch(/A reason or evidence note is required for every source decision/);
  });

  test('each changed field writes its own audit event', () => {
    const post = REGISTER.slice(REGISTER.indexOf("router.post('/api/rh2/admin/source-review/:id'"));
    expect(post).toMatch(/INSERT INTO resource_governance_events/);
    expect(post).toMatch(/for \(const \[field, from, to\] of events\)/);
  });

  test('the queue paginates rather than truncating the catalogue', () => {
    expect(REGISTER).toMatch(/const limit = Math\.min\(Math\.max\(parseInt\(req\.query\.limit/);
    expect(REGISTER).toMatch(/OFFSET/);
    expect(REGISTER).toMatch(/COUNT\(\*\)::int AS total/);
  });

  test('027 adds the audit vocabulary the queue needs, without editing 024', () => {
    expect(MIG_027).toMatch(/ALTER TABLE resource_governance_events DROP CONSTRAINT IF EXISTS valid_governance_event_field/);
    expect(MIG_027).toMatch(/'source_publisher'/);
  });

  test('therapist and read_only get no editing controls in the UI', () => {
    expect(CODE).toMatch(/function canReview\(\) \{ return isOwner\(\) \|\| isAdminRole\(\); \}/);
    const view = CODE.slice(CODE.indexOf('function renderSourceReview'), CODE.indexOf('function renderInstruments'));
    expect(view).toMatch(/if \(!canReview\(\)\)/);
  });

  test('leaving the rights control untouched sends no rights field at all', () => {
    const submit = CODE.slice(CODE.indexOf('async function submitSourceReview'), CODE.indexOf('async function loadInstruments'));
    expect(submit).toMatch(/if \(rights\) body\.rightsStatus = rights;/);
    expect(submit).not.toMatch(/body\.rightsStatus = rights \|\|/);
  });
});

// ── 4. Clinical filters ─────────────────────────────────────────────────────

describe('clinical filters are truthful', () => {
  test('the vocabulary is server-owned and validated', () => {
    expect(ROUTES).toMatch(/const CLINICAL_POPULATIONS = \['paediatric', 'adolescent', 'adult', 'older_adult'\]/);
    expect(ROUTES).toMatch(/const CLINICAL_SETTINGS = /);
    expect(ROUTES).toMatch(/CLINICAL_POPULATIONS\.includes\(req\.query\.population\)/);
    expect(ROUTES).toMatch(/CLINICAL_SETTINGS\.includes\(req\.query\.setting\)/);
  });

  test('unclassified is a real selection that actually matches rows', () => {
    expect(ROUTES).toMatch(/req\.query\.population === UNCLASSIFIED/);
    expect(ROUTES).toMatch(/r\.clinical_population IS NULL OR r\.clinical_population = '\[\]'::jsonb/);
    expect(ROUTES).toMatch(/req\.query\.setting === UNCLASSIFIED/);
    expect(ROUTES).toMatch(/r\.clinical_setting IS NULL OR r\.clinical_setting = '\[\]'::jsonb/);
  });

  test('the filters keep the organisation and privacy predicates', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    expect(route).toMatch(/organisation_id IS NOT DISTINCT FROM \$1/);
    expect(route).toMatch(/r\.status = 'approved'/);
  });

  test('the UI offers Unclassified first, and the counts come from the server', () => {
    expect(CODE).toMatch(/\['unclassified', 'Unclassified'\], \['paediatric'/);
    expect(CODE).toMatch(/function countedVocab/);
    expect(CODE).toMatch(/api\('\/api\/rh2\/clinical-vocabulary'\)/);
  });

  test('no clinical classification is invented for existing records', () => {
    // nothing in the seeds or setup scripts writes these columns
    const setupDir = path.join(__dirname, '..', 'setup');
    for (const f of fs.readdirSync(setupDir).filter((n) => n.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(setupDir, f), 'utf8');
      expect(src).not.toMatch(/clinical_population\s*=|clinicalPopulation:/);
      expect(src).not.toMatch(/clinical_setting\s*=|clinicalSetting:/);
    }
  });
});

describe('invalid clinical filters fail explicitly', () => {
  test('an unrecognised value returns 400 rather than unfiltered results', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    // Both parameters must have an else-branch that rejects.
    expect(route).toMatch(/code: 'invalid_filter_value',\s*parameter: 'population'/);
    expect(route).toMatch(/code: 'invalid_filter_value',\s*parameter: 'setting'/);
  });

  test('the rejection cannot be bypassed by an empty or absent parameter', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    expect(route).toMatch(/req\.query\.population !== undefined && req\.query\.population !== ''/);
    expect(route).toMatch(/req\.query\.setting !== undefined && req\.query\.setting !== ''/);
  });

  test('unclassified is still accepted', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    expect(route).toMatch(/req\.query\.population === UNCLASSIFIED/);
    expect(route).toMatch(/req\.query\.setting === UNCLASSIFIED/);
  });

  test('the error discloses nothing about the schema or the data', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    const errors = route.match(/error: 'Unknown clinical [^']*'/g) || [];
    expect(errors.length).toBe(2);
    for (const e of errors) {
      expect(e).not.toMatch(/clinical_population|clinical_setting|jsonb|SELECT|table/i);
    }
  });

  test('rejection happens before the query runs, so nothing broadens', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    const rejectIdx = route.indexOf("code: 'invalid_filter_value'");
    const queryIdx = route.indexOf('await pool.query');
    expect(rejectIdx).toBeGreaterThan(-1);
    expect(rejectIdx).toBeLessThan(queryIdx);
  });

  test('the organisation and privacy predicates are untouched by this change', () => {
    const route = ROUTES.slice(ROUTES.indexOf("router.get('/api/rh2/resources'"), ROUTES.indexOf('res.json({ resources'));
    expect(route).toMatch(/organisation_id IS NOT DISTINCT FROM \$1/);
    expect(route).toMatch(/r\.status = 'approved'/);
    expect(route).toMatch(/LIMIT \$\{params\.length \+ 1\}|LIMIT \$\{limit\}|LIMIT/);
  });
});

describe('clinical classification can be authored', () => {
  test('write paths validate against the server vocabulary', () => {
    expect(ROUTES).toMatch(/function validateClinicalArray/);
    expect(ROUTES).toMatch(/validateClinicalArray\(b\.clinicalPopulation, CLINICAL_POPULATIONS/);
    expect(ROUTES).toMatch(/validateClinicalArray\(b\.clinicalSetting, CLINICAL_SETTINGS/);
  });

  test('an invalid classification on write is a 400, not a silent store', () => {
    expect(ROUTES).toMatch(/code: 'invalid_clinical_value'/);
    // free-text strArr must no longer be used for these two columns
    expect(ROUTES).not.toMatch(/set\('clinical_population', JSON\.stringify\(strArr/);
    expect(ROUTES).not.toMatch(/set\('clinical_setting', JSON\.stringify\(strArr/);
  });

  test('classification writes an audit event naming the values', () => {
    expect(ROUTES).toMatch(/rh2\.resource_classified/);
    expect(ROUTES).toMatch(/clinicalPopulation: popCheck\.value/);
    expect(ROUTES).toMatch(/clinicalSetting: setCheck\.value/);
  });

  test('the admin form has the control and always sends both fields', () => {
    expect(CODE).toMatch(/class="rh2-form-pop"/);
    expect(CODE).toMatch(/class="rh2-form-set"/);
    expect(CODE).toMatch(/clinicalPopulation: checkedValues\('\.rh2-form-pop'\)/);
    expect(CODE).toMatch(/clinicalSetting: checkedValues\('\.rh2-form-set'\)/);
  });

  // Bound the slice to the classification fieldset itself — the surrounding
  // admin form legitimately contains role checks for other controls.
  const classificationFieldset = (() => {
    const start = CODE.indexOf('Clinical classification');
    const end = CODE.indexOf("'</fieldset>';", start);
    return CODE.slice(start, end);
  })();

  test('the control uses existing edit permissions — no new role is introduced', () => {
    expect(classificationFieldset).not.toMatch(/canReview\(\)|isOwner\(\)|role\(\)/);
  });

  test('unclassified is not offerable as a stored value', () => {
    const filters = classificationFieldset.match(/o\[0\] !== 'unclassified'/g) || [];
    expect(filters.length).toBe(2);        // one for population, one for setting
  });
});

describe('approval blockers read as staff language', () => {
  test('blockers are sentences, not column names or codes', () => {
    const blockers = G.approvalBlockers({});
    expect(blockers.length).toBeGreaterThan(0);
    for (const b of blockers) {
      expect(b).toMatch(/^[A-Z].*\.$/);                       // a sentence
      expect(b).not.toMatch(/_|::|jsonb|NULL|undefined/);      // no internals
    }
  });

  test('governance values are humanised rather than shown raw', () => {
    expect(CODE).toMatch(/var GOV_WORDS = \{/);
    expect(CODE).toMatch(/'opal-original': 'Opal Therapy'/);
    expect(CODE).toMatch(/'unreviewed': 'Not reviewed'/);
    expect(CODE).toMatch(/function govWord/);
    expect(CODE).toMatch(/esc\(govWord\(value\)\)/);
  });

  test('an unmapped value falls back to the raw string rather than vanishing', () => {
    expect(CODE).toMatch(/GOV_WORDS\[value\] \|\| String\(value\)/);
  });

  test('the five distinctions survive the humanising', () => {
    // authorship, rights, clinical, approval, publication stay separate labels
    const fn = CODE.slice(CODE.indexOf('function renderGovernance'), CODE.indexOf('function fileActionLabel'));
    expect(fn).toMatch(/reviewChip\('Source'/);
    expect(fn).toMatch(/reviewChip\('Rights review'/);
    expect(fn).toMatch(/reviewChip\('Clinical review'/);
    expect(fn).toMatch(/reviewChip\('Brand & accessibility'/);
    expect(fn).toMatch(/Approving does not publish/);
  });
});

// ── 5. Governance readiness presentation ────────────────────────────────────

describe('governance readiness', () => {
  test('the browser uses the server verdict and holds no copy of the policy', () => {
    const fn = CODE.slice(CODE.indexOf('function renderGovernance'), CODE.indexOf('function fileActionLabel'));
    expect(fn).toMatch(/approval_ready/);
    expect(fn).toMatch(/approval_blockers/);
    expect(CODE).not.toMatch(/approvalBlockers\s*\(/);
  });

  test('approval and publication are presented as different things', () => {
    const fn = CODE.slice(CODE.indexOf('function renderGovernance'), CODE.indexOf('function fileActionLabel'));
    expect(fn).toMatch(/Approving does not publish/);
  });

  test('all nine governance concepts have distinct wording', () => {
    for (const w of ['In rights review', 'In clinical review', 'In brand and accessibility review',
      'Approved for use', 'Published', 'Withdrawn (inactive)', 'Quarantined']) {
      expect(CODE).toContain(w);
    }
  });

  test('the detail route supplies the computed flags', () => {
    expect(ROUTES).toMatch(/resource: withGovernanceFlags\(resource\)/);
  });

  test('the five seeded drafts have blockers that explain why they cannot progress', () => {
    const seeded = {
      source_class: 'opal-original', rights_status: 'opal-owned', content_owner: null,
      content_version: '0.1', review_due_at: null, clinical_status: 'draft',
      brand_review_status: 'pending',
    };
    const blockers = G.approvalBlockers(seeded);
    expect(blockers.join(' ')).toMatch(/clinical review/i);
    expect(blockers.join(' ')).toMatch(/brand and accessibility/i);
    expect(G.canTransition('clinical-review', 'approved').ok).toBe(false);
  });
});
