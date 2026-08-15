'use strict';

/**
 * ASSESSMENT FRAMEWORK — catalogue, availability and share preparation.
 *
 * The rules these protect:
 *
 *   1. AVAILABILITY IS A FACT ABOUT THIS REPOSITORY, NOT A RIGHTS VERDICT.
 *      The Assessments tab used to gate every instrument on the governance
 *      register's rights_status/clinical_status, both of which default to
 *      'unreviewed'. The result was that WHODAS 2.0 — whose authoritative WHO
 *      source documents ship inside this repository — was presented as
 *      unusable, with the same sentence as an instrument we hold nothing of.
 *      Availability is now derived from what is on disk, and the register is
 *      carried alongside as information.
 *
 *   2. AN INSTRUMENT WE DO NOT HOLD SAYS SO, SPECIFICALLY. 'source-required'
 *      names the documents that are missing. "Awaiting human confirmation" told
 *      a clinician nothing they could act on.
 *
 *   3. NO ITEM WORDING AND NO SCORING RULE IS INVENTED. The catalogue carries
 *      identity, counts and availability. Not one question.
 *
 *   4. NOTHING IS SENT. The share route PREPARES a message and returns it.
 */

const fs = require('fs');
const path = require('path');

const definitions = require('../assessments/definitions');
const { availabilityFor, whodasRuntime } = require('../assessments/availability');
const { prepareShare } = require('../assessments/share');

const { AVAILABILITY, allDefinitions, definitionByKey } = definitions;

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'assessments-routes.js'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const CODE = strip(ROUTES);

const ON = { modules: { whodas: { enabled: true, healthy: true } } };

// ── The catalogue ───────────────────────────────────────────────────────────

describe('the catalogue', () => {
  const defs = allDefinitions();

  test('every registered instrument is present and addressable', () => {
    expect(defs.length).toBeGreaterThanOrEqual(28);
    for (const d of defs) {
      expect(typeof d.key).toBe('string');
      expect(d.key.length).toBeGreaterThan(0);
      expect(typeof d.name).toBe('string');
      expect(typeof d.abbreviation).toBe('string');
    }
    // Keys are unique, or two entries would share one information page.
    expect(new Set(defs.map((d) => d.key)).size).toBe(defs.length);
  });

  test('the instruments the practice catalogued are all listed', () => {
    const abbrs = defs.map((d) => d.abbreviation);
    for (const a of ['WHODAS 2.0', 'ALSFRS-R', 'BBS', 'Braden', 'CANS', 'Carer Burden',
      'COPM', 'DASS-42', 'FAST', 'FES', 'FIM', 'FSS', 'HoNOS', 'MoCA', 'RUDAS',
      'MOHOST', 'Sensory Profile']) {
      expect(abbrs).toContain(a);
    }
  });

  test('an instrument we do not hold is still visible, never dropped', () => {
    const copm = definitionByKey('copm');
    expect(copm).not.toBeNull();
    expect(availabilityFor(copm, ON).state).toBe(AVAILABILITY.SOURCE_REQUIRED);
  });

  test('lookup is case-insensitive and rejects nonsense without throwing', () => {
    expect(definitionByKey('WHODAS-2.0-36').key).toBe('whodas-2.0-36');
    for (const bad of [null, undefined, '', '   ', 'nope', '__proto__']) {
      expect(definitionByKey(bad)).toBeNull();
    }
  });

  test('no question text or scoring rule appears anywhere in the definitions', () => {
    const json = JSON.stringify(allDefinitions());
    // Exact phrases from the WHODAS form. If one appears here, somebody has
    // begun copying the instrument into the catalogue.
    for (const phrase of [
      'Concentrating on doing something',
      'Standing for long periods',
      'Washing your whole body',
      'Extreme or cannot do',
    ]) {
      expect(`${phrase}:${json.includes(phrase)}`).toBe(`${phrase}:false`);
    }
    // Nor the scoring denominators.
    expect(json).not.toMatch(/\b106\b/);
    expect(json).not.toMatch(/st_s3[26]/);
  });

  test('Opal is never recorded as the rights holder', () => {
    for (const d of allDefinitions()) {
      expect(String(d.attribution.rightsHolder || '')).not.toMatch(/opal/i);
    }
  });
});

// ── WHODAS: the one instrument whose source ships here ──────────────────────

describe('WHODAS 2.0 is available because its source is present', () => {
  const def = definitionByKey('whodas-2.0-36');

  test('the definition is read from the instrument module, not restated', () => {
    const instrument = require('../whodas/instrument');
    expect(def.structure.itemCount).toBe(instrument.ITEM_IDS.length);
    expect(def.structure.domains.map((d) => d.key))
      .toEqual(instrument.DOMAINS.map((d) => d.key));
    expect(def.structure.conditionalItemIds).toEqual(instrument.WORK_SCHOOL_ITEMS);
    expect(def.administrationMethods.map((m) => m.method).sort())
      .toEqual(['interviewer', 'proxy', 'self']);
  });

  test('it is electronic AND PDF when its module is running', () => {
    const a = availabilityFor(def, ON);
    expect(a.state).toBe(AVAILABILITY.ELECTRONIC_AND_PDF);
    expect(a.canStart).toBe(true);
    expect(a.canDownloadBlank).toBe(true);
    expect(a.canScore).toBe(true);
    expect(a.missingSources).toEqual([]);
    // And no rights sentence anywhere near it.
    expect(a.reason).toBeNull();
    expect(JSON.stringify(a)).not.toMatch(/awaiting human confirmation/i);
  });

  test('WHO attribution travels with it', () => {
    expect(def.attribution.rightsHolder).toBe('World Health Organization');
    expect(def.attribution.copyright).toMatch(/World Health Organization/);
    expect(def.attribution.sourceTitle).toMatch(/WHODAS 2\.0/);
  });

  test('no cut-point or severity band is invented', () => {
    expect(def.interpretation.cutPoints).toBeNull();
    expect(def.interpretation.statement).toBe('0 = no disability, 100 = full disability');
    expect(def.interpretation.source).toMatch(/WHO/);
    expect(JSON.stringify(def.interpretation))
      .not.toMatch(/\b(mild|moderate|severe)\s+disability\b/i);
  });
});

// ── The five availability states ────────────────────────────────────────────

describe('availability states', () => {
  const def = definitionByKey('whodas-2.0-36');

  test('a switched-off module is temporarily unavailable, with the technical reason', () => {
    const a = availabilityFor(def, {
      modules: { whodas: whodasRuntime({ enabled: false }) },
    });
    expect(a.state).toBe(AVAILABILITY.TEMPORARILY_UNAVAILABLE);
    expect(a.canStart).toBe(false);
    expect(a.reason).toMatch(/ENABLE_WHODAS_ASSESSMENT/);
    // A technical reason, never a licensing one.
    expect(a.reason).not.toMatch(/rights|licen[cs]e|confirm/i);
  });

  test('a failed source-integrity check is temporarily unavailable, not source-required', () => {
    const runtime = whodasRuntime({
      enabled: true,
      verify: () => { throw new Error('sha256 mismatch on whodas-36-self.pdf'); },
    });
    const a = availabilityFor(def, { modules: { whodas: runtime } });
    expect(a.state).toBe(AVAILABILITY.TEMPORARILY_UNAVAILABLE);
    expect(a.reason).toMatch(/integrity check/);
    expect(runtime.detail).toMatch(/sha256 mismatch/);
  });

  test('items but no blank form is "electronic"', () => {
    const d = JSON.parse(JSON.stringify(def));
    d.sources.blankForm = false;
    expect(availabilityFor(d, ON).state).toBe(AVAILABILITY.ELECTRONIC);
  });

  test('a blank form but no items is "pdf", and cannot be started', () => {
    const d = JSON.parse(JSON.stringify(def));
    d.sources.questions = false;
    d.sources.responseOptions = false;
    d.missingSources = ['the authoritative item wording'];
    const a = availabilityFor(d, ON);
    expect(a.state).toBe(AVAILABILITY.PDF);
    expect(a.canStart).toBe(false);
    expect(a.canDownloadBlank).toBe(true);
    expect(a.missingSources).toContain('the authoritative item wording');
  });

  test('source-required names what is missing, in words a person can act on', () => {
    const a = availabilityFor(definitionByKey('braden-scale'), ON);
    expect(a.state).toBe(AVAILABILITY.SOURCE_REQUIRED);
    expect(a.missingSources.length).toBeGreaterThan(0);
    for (const m of a.missingSources) expect(m.length).toBeGreaterThan(8);
    expect(a.missingSources.join(' ')).toMatch(/item wording/);
    expect(a.missingSources.join(' ')).toMatch(/scoring rules/);
  });

  test('scoring is only claimed where the scoring rules are held', () => {
    const d = JSON.parse(JSON.stringify(def));
    d.sources.scoringRules = false;
    expect(availabilityFor(d, ON).canScore).toBe(false);
  });

  test('every state carries a human label and summary', () => {
    const seen = new Set();
    for (const d of allDefinitions()) {
      const a = availabilityFor(d, ON);
      seen.add(a.state);
      expect(typeof a.label).toBe('string');
      expect(a.label.length).toBeGreaterThan(0);
      expect(typeof a.summary).toBe('string');
    }
    expect(seen.has(AVAILABILITY.ELECTRONIC_AND_PDF)).toBe(true);
    expect(seen.has(AVAILABILITY.SOURCE_REQUIRED)).toBe(true);
  });

  test('no availability state is a rights-confirmation state', () => {
    for (const d of allDefinitions()) {
      const a = availabilityFor(d, ON);
      expect(JSON.stringify(a)).not.toMatch(/awaiting human confirmation/i);
      expect(JSON.stringify(a)).not.toMatch(/rights_status|licensed-for-use/);
    }
  });
});

// ── Share preparation ───────────────────────────────────────────────────────

describe('share preparation never sends', () => {
  const def = definitionByKey('whodas-2.0-36');
  const draft = prepareShare({
    definition: def,
    kind: 'completed',
    clientName: 'Jordan Avery',
    assessorName: 'A. Therapist',
    completedOn: '2026-08-14',
    method: 'Self-administered',
    orgName: 'Opal Therapy',
    attachment: { filename: 'whodas.pdf', downloadPath: '/api/whodas/assessments/x/document' },
    transportConfigured: false,
  });

  test('the draft is explicitly unsent and requires review', () => {
    expect(draft.sent).toBe(false);
    expect(draft.requiresReview).toBe(true);
    expect(draft.delivery.configured).toBe(false);
    expect(draft.delivery.instruction).toMatch(/will not send/);
  });

  test('no recipient is ever prefilled', () => {
    expect(draft.to).toEqual([]);
  });

  test('the subject carries no client identity', () => {
    expect(draft.subject).not.toMatch(/Jordan|Avery/);
    expect(draft.subject).toMatch(/WHODAS/);
  });

  test('the body carries no score, no response and no domain value', () => {
    expect(draft.body).not.toMatch(/\b\d{1,3}\.\d{2}\b/);
    expect(draft.body).not.toMatch(/\b(none|mild|moderate|severe|extreme)\b/i);
    expect(draft.body).not.toMatch(/\bD[1-6]\.\d/);
  });

  test('attribution and a confidentiality notice are present', () => {
    expect(draft.body).toMatch(/World Health Organization/);
    expect(draft.body).toMatch(/confidential health information/);
    expect(draft.notices.join(' ')).toMatch(/consent/i);
  });

  test('a blank-form share mentions no client at all', () => {
    const blank = prepareShare({
      definition: def, kind: 'blank', clientName: 'Jordan Avery', transportConfigured: false,
    });
    expect(blank.body).not.toMatch(/Jordan|Avery/);
    expect(blank.subject).not.toMatch(/Jordan|Avery/);
    expect(blank.sent).toBe(false);
  });

  test('a missing document is stated rather than implied', () => {
    const noDoc = prepareShare({ definition: def, kind: 'completed', transportConfigured: false });
    expect(noDoc.attachment).toBeNull();
    expect(noDoc.notices.join(' ')).toMatch(/No document is attached/);
  });

  test('nothing in the share module can transmit', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'assessments', 'share.js'), 'utf8');
    expect(strip(src)).not.toMatch(/sendMail|nodemailer|require\('\.\.\/email'\)|fetch\(/);
  });
});

// ── The route layer ─────────────────────────────────────────────────────────

describe('assessment routes', () => {
  test('the share routes prepare and audit, and never send', () => {
    expect(CODE).not.toMatch(/sendMail|nodemailer|require\('\.\/email'\)/);
    expect(CODE).toMatch(/assessment_share_prepared/);
    expect(CODE).toMatch(/sent: false/);
  });

  test('a draft cannot be shared', () => {
    expect(CODE).toMatch(/status === 'draft'[\s\S]{0,220}not_completed/);
  });

  test('every client-scoped query is organisation-filtered', () => {
    const queries = CODE.match(/pool\.query\(\s*`[\s\S]*?`/g) || [];
    const clientScoped = queries.filter((q) => /whodas_assessments/.test(q));
    expect(clientScoped.length).toBeGreaterThan(0);
    for (const q of clientScoped) expect(q).toMatch(/organisation_id = \$/);
  });

  test('drafts stay personal; filed records are the organisation\'s', () => {
    expect(CODE).toMatch(/a\.status <> 'draft' OR a\.started_by_user_id = \$/);
  });

  test('the catalogue is readable without the clinical write role, records are not', () => {
    expect(CODE).toMatch(/CATALOGUE_ROLES = new Set\(\['therapist', 'owner', 'admin', 'read_only'\]\)/);
    expect(CODE).toMatch(/CLINICAL_ROLES = new Set\(\['therapist', 'owner'\]\)/);
    expect(CODE).toMatch(/catalogue', requireCatalogue/);
    expect(CODE).toMatch(/records', requireClinicalRead/);
    expect(CODE).toMatch(/share', requireClinicalWrite/);
  });

  test('the catalogue is not feature-gated, so a switched-off module can be explained', () => {
    // whodas-routes.js 404s wholesale when the flag is off; this file must not,
    // or the catalogue would go silent exactly when it has something to say.
    expect(CODE).not.toMatch(/router\.use\('\/api\/assessments',[\s\S]{0,120}isWhodasAssessmentEnabled/);
    expect(CODE).toMatch(/whodasRuntime\(\{/);
  });

  test('no clinical content reaches the audit log', () => {
    const audits = CODE.match(/audit\(req,[\s\S]{0,220}?\)\;/g) || [];
    expect(audits.length).toBeGreaterThan(0);
    for (const a of audits) {
      expect(a).not.toMatch(/client_name|clientName|responses|scores\b/);
    }
  });

  test('a record\'s address is published by the server, not assembled by the browser', () => {
    expect(CODE).toMatch(/route: `#assessment\/record\/\$\{row\.id\}`/);
  });

  test('the governance register never decides availability', () => {
    // registerRows/governanceOf feed the information page. If either appeared
    // in an availability decision, the blanket gate would be back.
    const availabilityCalls = CODE.match(/availabilityFor\([^)]*\)/g) || [];
    expect(availabilityCalls.length).toBeGreaterThan(0);
    for (const c of availabilityCalls) {
      expect(c).not.toMatch(/register|governance|rights/i);
    }
  });
});

// ── Defects found by the post-implementation sweep ──────────────────────────

describe('an instrument we hold but cannot load is broken, not missing', () => {
  test('a module whose assets failed to load is temporarily unavailable', () => {
    // It used to report SOURCE_REQUIRED, which told clinicians the portal does
    // not have WHODAS and listed documents to go and obtain — when the real
    // answer is that an asset failed to load and an administrator should look.
    const stub = definitions.baseDefinition();
    stub.key = 'whodas-2.0-36';
    stub.abbreviation = 'WHODAS 2.0';
    stub.name = 'WHODAS';
    stub.module = 'whodas';
    stub.moduleHealthy = false;
    stub.moduleError = 'instrument-data.json is corrupt';

    const a = availabilityFor(stub, ON);
    expect(a.state).toBe(AVAILABILITY.TEMPORARILY_UNAVAILABLE);
    expect(a.missingSources).toEqual([]);          // nothing is missing
    expect(a.reason).toMatch(/could not be loaded/);
    expect(a.reason).toMatch(/not a missing instrument/);
  });

  test('the module check runs before the source check, never after', () => {
    // A module that fails to load also fails to report its sources, so testing
    // sources first got the answer backwards.
    const src = fs.readFileSync(path.join(__dirname, '..', 'assessments', 'availability.js'), 'utf8');
    expect(src.indexOf('if (def.module) {')).toBeLessThan(src.indexOf('AVAILABILITY.SOURCE_REQUIRED'));
  });

  test('an instrument with no module at all is still source-required', () => {
    expect(availabilityFor(definitionByKey('copm'), ON).state).toBe(AVAILABILITY.SOURCE_REQUIRED);
  });
});

describe('the catalogue does not promise what this actor cannot do', () => {
  test('the actor overlay is applied in the route, not inside availabilityFor', () => {
    // availability.js documents itself as deriving from exactly two facts about
    // the deployment. Smuggling the actor in would destroy the property that
    // makes the badge checkable.
    const av = fs.readFileSync(path.join(__dirname, '..', 'assessments', 'availability.js'), 'utf8');
    expect(av).not.toMatch(/req\b|role|organisation/i);
    expect(CODE).toMatch(/function canAdminister\(req\)/);
    expect(CODE).toMatch(/function actorFor\(req\)/);
    expect(CODE).toMatch(/availability\.canStart = false/);
  });

  test('both catalogue routes pass the actor', () => {
    // Call sites only — the declaration `function describe(def, runtime, actor)`
    // must not be counted as one of them.
    const calls = (CODE.match(/(?<!function )describe\(def, runtime, actor(For\(req\))?\)/g) || []);
    expect(calls.length).toBe(2);
    // And neither route may still call the two-argument form.
    expect(CODE).not.toMatch(/(?<!function )describe\(def, runtime\)/);
  });

  test('the overlay requires a clinical role AND an organisation', () => {
    expect(CODE).toMatch(/CLINICAL_ROLES\.has\(req\.user\?\.role\) && Boolean\(orgOf\(req\)\)/);
  });
});

describe('every refusal carries a sentence a person can read', () => {
  test('the catalogue 404s explain themselves', () => {
    const notFounds = CODE.match(/status\(404\)\.json\([^)]*\)/g) || [];
    expect(notFounds.length).toBeGreaterThan(0);
    for (const nf of notFounds) {
      expect(`${nf}:${/message|missing/.test(nf)}`).toBe(`${nf}:true`);
    }
  });

  test('the WHODAS flag gate and the record lookup both explain themselves', () => {
    const wr = fs.readFileSync(path.join(__dirname, '..', 'whodas-routes.js'), 'utf8');
    expect(wr).toMatch(/WHODAS 2\.0 is not enabled in this environment/);
    expect(wr).toMatch(/could not be found, or is no longer available to you/);
  });

  test('a not-found record still refuses to distinguish "gone" from "not yours"', () => {
    // The 404-not-403 rule only works if the response cannot tell them apart.
    const wr = fs.readFileSync(path.join(__dirname, '..', 'whodas-routes.js'), 'utf8');
    expect(wr).not.toMatch(/belongs to another organisation|not your assessment/i);
  });
});
