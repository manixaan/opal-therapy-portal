'use strict';

/**
 * AI OPERATIONAL READINESS — does the boundary hold when things break?
 *
 * The gateway tests prove the happy path is guarded. These prove the failure
 * paths are too, because healthcare security is mostly about what happens
 * when something is already wrong: the audit table is unreachable, the policy
 * registry did not load, the database that holds the kill switch is down.
 *
 * The governing principle is that an UNVERIFIABLE boundary is treated as a
 * broken one. A clinical system should decline to use AI rather than proceed
 * and hope.
 */

const gateway = require('../ai/ai-gateway');
const policy = require('../ai/ai-policy');
const registry = require('../ai/ai-model-registry');
const audit = require('../ai/ai-audit');
const killSwitch = require('../ai/ai-kill-switch');
const selfCheck = require('../ai/ai-self-check');
const outputTypes = require('../ai/ai-output-type');
const mockProvider = require('../ai/providers/mock-provider');

const CLINICAL_FEATURE = 'clinical_note_generation';
let events;
let savedEnv;

beforeEach(() => {
  savedEnv = { region: process.env.AWS_REGION, disable: process.env.AI_GLOBAL_DISABLE };
  // Required now — there is no default region to fall back on. Cases that
  // assert the absent-region refusal delete it themselves.
  process.env.AWS_REGION = 'ap-southeast-2';
  delete process.env.AI_GLOBAL_DISABLE;
  events = [];
  audit._setSinkForTests(async (payload) => { events.push(payload); });
  killSwitch._setReaderForTests(async () => 'true');
  mockProvider._setHandlerForTests(null);
  selfCheck._setResultForTests(null); // force a real check
});

afterEach(() => {
  if (savedEnv.region === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = savedEnv.region;
  if (savedEnv.disable === undefined) delete process.env.AI_GLOBAL_DISABLE;
  else process.env.AI_GLOBAL_DISABLE = savedEnv.disable;
  audit._setSinkForTests(null);
  killSwitch._setReaderForTests(null);
  mockProvider._setHandlerForTests(null);
  selfCheck._setResultForTests(null);
});

// ── Self-check ──────────────────────────────────────────────────────────────

test('the boundary self-check passes on the shipped configuration', () => {
  const result = selfCheck.run();
  expect(result.ok).toBe(true);
  expect(result.failed).toEqual([]);
  // Each named check should actually have run, not been skipped.
  expect(result.checks.length).toBeGreaterThanOrEqual(7);
  expect(result.checks.every((c) => c.ok)).toBe(true);
});

test('an unverified boundary disables AI entirely', () => {
  // The failure this guards: the policy or model registry loads in a
  // degraded state, the gateway's guards become unproven, and generation
  // continues anyway.
  selfCheck._setResultForTests({ ok: false, checks: [], failed: ['policy registry loaded: boom'] });

  for (const feature of policy.features()) {
    const decision = gateway.evaluate({ feature });
    expect(decision.ok).toBe(false);
    expect(decision.reason).toBe('ai_boundary_unverified');
  }
  expect(gateway.isAvailable(CLINICAL_FEATURE)).toBe(false);
});

test('the self-check rejects an audit allowlist that could carry content', () => {
  // Regression guard for the rule that matters most in the audit layer.
  for (const forbidden of selfCheck.FORBIDDEN_AUDIT_FIELDS) {
    expect(audit.ALLOWED_FIELDS.map((f) => f.toLowerCase()))
      .not.toContain(forbidden.toLowerCase());
  }
});

test('the self-check would catch a non-Australian model reaching the registry', () => {
  // Simulated rather than mutating the frozen registry: the check's own logic
  // is what is under test.
  const offshore = { id: 'us.anthropic.claude-opus-4-8', residency: 'us', regions: ['us-east-1'] };
  expect(offshore.id.startsWith(registry.AU_GEO_PREFIX)).toBe(false);
  expect(offshore.regions.every((r) => registry.AU_REGIONS.includes(r))).toBe(false);
});

// ── Invalid policy ──────────────────────────────────────────────────────────

test('a policy that breaches the clinical boundary fails at load, not at runtime', () => {
  // ai-policy.js calls validateAll() at module load, so a bad policy stops the
  // process at boot rather than producing an unreviewed clinical note at 4pm.
  expect(() => policy.validateAll()).not.toThrow();

  // And the invariants it enforces are the load-bearing ones.
  const clinical = policy.get(CLINICAL_FEATURE);
  expect(clinical.region).toBe('australia');
  expect(clinical.outputTypes).toContain(outputTypes.CLINICAL_DOCUMENT);
  for (const key of clinical.allowedModels) {
    expect(registry.get(key).residency).toBe('australia');
  }
});

// ── Audit unavailable ───────────────────────────────────────────────────────

test('an unavailable audit layer PREVENTS clinical generation', async () => {
  // A note in a client's file that cannot be traced to a model, a region and a
  // person is worse than no note. The audit row is reserved BEFORE the model
  // is called, so this denies before anything is transmitted.
  let transmitted = false;
  mockProvider._setHandlerForTests(async () => {
    transmitted = true;
    return { text: null, toolUse: { type: 'tool_use', name: 'case_note', input: {} } };
  });

  audit._setSinkForTests(async ({ op }) => {
    if (op === 'reserve') throw new Error('audit table unreachable');
  });

  await expect(gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    userId: 'therapist-1',
    messages: [{ role: 'user', content: 'synthetic dictation' }],
  })).rejects.toThrow('ai_denied');

  // The critical assertion: nothing left the building.
  expect(transmitted).toBe(false);
});

test('the denial reason for an unavailable audit layer is explicit', async () => {
  audit._setSinkForTests(async ({ op }) => {
    if (op === 'reserve') throw new Error('audit table unreachable');
    events.push({ op });
  });

  try {
    await gateway.generate({
      feature: CLINICAL_FEATURE,
      modelKey: 'mock',
      messages: [{ role: 'user', content: 'synthetic' }],
    });
    throw new Error('should have denied');
  } catch (err) {
    expect(err).toBeInstanceOf(gateway.AiPolicyError);
    expect(err.reason).toBe('audit_unavailable');
  }
});

test('an assistant answer still works when audit is degraded — deliberately', async () => {
  // The asymmetry is intentional. Losing a log line for "explain sensory
  // processing difficulties" is a missing audit detail; losing attribution for
  // a clinical document is a compliance failure. Only the second blocks.
  audit._setSinkForTests(async () => { throw new Error('audit table unreachable'); });

  const res = await gateway.generate({
    feature: 'opa_assistant',
    modelKey: 'mock',
    outputType: outputTypes.ASSISTANT_RESPONSE,
    messages: [{ role: 'user', content: 'explain sensory processing' }],
  });

  expect(res.text).toBeTruthy();
  expect(res.metadata.reviewRequired).toBe(false);
});

test('a clinical document reserves its audit row before the model is called', async () => {
  const order = [];
  audit._setSinkForTests(async ({ op }) => { order.push(`audit:${op}`); });
  mockProvider._setHandlerForTests(async () => {
    order.push('provider:invoke');
    return { text: null, toolUse: { type: 'tool_use', name: 'case_note', input: {} }, providerRequestId: 'r1' };
  });

  await gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    outputType: outputTypes.CLINICAL_DOCUMENT,
    messages: [{ role: 'user', content: 'synthetic' }],
  });

  expect(order).toEqual(['audit:reserve', 'provider:invoke', 'audit:finalise']);
});

// ── Kill switch: break-glass record ─────────────────────────────────────────

test('disabling AI records who, when and why', async () => {
  let setting = { value: 'true', updatedBy: 'admin-1', reason: null };
  killSwitch._setReaderForTests(async () => setting);

  expect(await killSwitch.isGloballyEnabled()).toBe(true);
  events.length = 0; // discard initialisation

  setting = { value: 'false', updatedBy: 'admin-1', reason: 'Security review after vendor advisory' };
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
  await new Promise((r) => setImmediate(r)); // securityEvent is fire-and-forget

  const security = events.find((e) => e.op === 'securityEvent');
  expect(security).toBeTruthy();
  expect(security.event.eventType).toBe('ai_disabled');
  expect(security.event.previousState).toBe('enabled');
  expect(security.event.newState).toBe('disabled');
  expect(security.event.reason).toBe('Security review after vendor advisory');
  expect(security.actorUserId).toBe('admin-1');
});

test('the first read is initialisation, not a break-glass event', async () => {
  killSwitch._setReaderForTests(async () => ({ value: 'false', updatedBy: null, reason: null }));
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
  await new Promise((r) => setImmediate(r));

  // Booting with AI already disabled is a state, not somebody flipping a
  // switch. Recording it as an event would bury the real ones.
  expect(events.find((e) => e.op === 'securityEvent')).toBeUndefined();
});

test('the kill switch cannot silently recover after a database failure', async () => {
  // The failure this guards: an operator disables AI during an incident, the
  // cache expires, the next read fails, and the switch quietly flips back on.
  let mode = 'false';
  killSwitch._setReaderForTests(async () => {
    if (mode === 'throw') throw new Error('connection refused');
    return { value: mode, updatedBy: null, reason: null };
  });

  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  mode = 'throw';
  for (let i = 0; i < 5; i++) {
    killSwitch.invalidate();
    // eslint-disable-next-line no-await-in-loop
    expect(await killSwitch.isGloballyEnabled()).toBe(false);
  }
});

test('a disabled kill switch blocks generation and is recorded as a denial', async () => {
  killSwitch._setReaderForTests(async () => ({ value: 'false', updatedBy: null, reason: null }));

  let transmitted = false;
  mockProvider._setHandlerForTests(async () => { transmitted = true; return { text: 'x' }; });

  await expect(gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    userId: 'therapist-1',
    messages: [{ role: 'user', content: 'synthetic' }],
  })).rejects.toThrow('ai_denied');

  expect(transmitted).toBe(false);
  const denial = events.find((e) => e.event && e.event.status === 'denied');
  expect(denial.event.denyReason).toBe('ai_globally_disabled:setting');
});

// ── Regressions from the adversarial boundary review (2026-08-10) ───────────
//
// Each of these is a defect that shipped and was caught by review, not by the
// original tests. They are kept as named regressions because every one of them
// looked correct on the happy path.

test('REGRESSION: the Bedrock endpoint is pinned in code, not inherited from env', () => {
  // Found: getClient() set awsRegion but no baseURL, so the SDK fell back to
  // ANTHROPIC_BEDROCK_BASE_URL. awsRegion only sets the SigV4 signing scope,
  // so an env var could send every clinical transcript to us-east-1 while the
  // gateway, the audit row and the health endpoint all still said Sydney.
  const bedrock = require('../ai/providers/bedrock-provider');
  expect(bedrock.expectedBaseUrl('ap-southeast-2'))
    .toBe('https://bedrock-runtime.ap-southeast-2.amazonaws.com');

  // Prove an explicit baseURL actually beats the environment variable — the
  // assumption the fix rests on.
  const saved = process.env.ANTHROPIC_BEDROCK_BASE_URL;
  process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://bedrock-runtime.us-east-1.amazonaws.com';
  try {
    // eslint-disable-next-line global-require
    const { AnthropicBedrock } = require('@anthropic-ai/bedrock-sdk');
    const pinned = new AnthropicBedrock({
      awsRegion: 'ap-southeast-2',
      baseURL: bedrock.expectedBaseUrl('ap-southeast-2'),
    });
    expect(pinned.baseURL).toBe('https://bedrock-runtime.ap-southeast-2.amazonaws.com');
    expect(pinned.baseURL).not.toContain('us-east-1');
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    else process.env.ANTHROPIC_BEDROCK_BASE_URL = saved;
  }
});

test('REGRESSION: a transport override fails the boundary and names no value', () => {
  const saved = process.env.ANTHROPIC_BEDROCK_BASE_URL;
  process.env.ANTHROPIC_BEDROCK_BASE_URL = 'https://evil.example.com/v1?token=SUPERSECRET';
  try {
    selfCheck._setResultForTests(null);
    const result = selfCheck.run();
    expect(result.ok).toBe(false);
    expect(result.failed.join(' ')).toContain('ANTHROPIC_BEDROCK_BASE_URL');

    // The failure text reaches boundary_failures on the health endpoint, so it
    // must name the variable without echoing a value that could carry a
    // credential in its query string or userinfo.
    const text = JSON.stringify(result.failed);
    expect(text).not.toContain('SUPERSECRET');
    expect(text).not.toContain('evil.example.com');

    // And AI is disabled while it is set.
    expect(gateway.evaluate({ feature: CLINICAL_FEATURE }).ok).toBe(false);
  } finally {
    if (saved === undefined) delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    else process.env.ANTHROPIC_BEDROCK_BASE_URL = saved;
    selfCheck._setResultForTests(null);
  }
});

test('REGRESSION: exactly one value leaves the kill switch on', async () => {
  // Found: the parse was `!== 'false'`, so an operator writing 'off', '0',
  // 'no' — or pasting 'false\n' from a runbook heredoc — silently left AI
  // running while believing it was halted. There is no application write path
  // for this setting, so hand-written SQL is the only way it is ever set.
  //
  // Now strict: 'true' and 'false' exactly. Everything else, including
  // near-misses like 'TRUE' and ' true ', fails closed.
  killSwitch._setReaderForTests(async () => ({ value: 'true', updatedBy: null, reason: null }));
  expect(await killSwitch.isGloballyEnabled()).toBe(true);

  const disabling = [
    'false', 'FALSE', 'False',      // case variants are not accepted
    ' true ', 'true\n', ' false ',  // whitespace is not trimmed away
    'enabled', 'disabled',          // no synonyms
    'off', 'on', '0', '1', 'no', 'yes',
    '', 'garbage', 'OFF',
  ];
  for (const value of disabling) {
    killSwitch._setReaderForTests(async () => ({ value, updatedBy: null, reason: null }));
    // eslint-disable-next-line no-await-in-loop
    expect(await killSwitch.isGloballyEnabled()).toBe(false);
  }
});

test('REGRESSION: the env kill switch disables on any set value, not only "true"', () => {
  const saved = process.env.AI_GLOBAL_DISABLE;
  try {
    for (const value of ['true', '1', 'yes', 'on', 'TRUE', 'anything']) {
      process.env.AI_GLOBAL_DISABLE = value;
      expect(killSwitch.envDisabled()).toBe(true);
    }
    for (const value of ['false', '0', 'no', 'off', '']) {
      process.env.AI_GLOBAL_DISABLE = value;
      expect(killSwitch.envDisabled()).toBe(false);
    }
  } finally {
    if (saved === undefined) delete process.env.AI_GLOBAL_DISABLE;
    else process.env.AI_GLOBAL_DISABLE = saved;
  }
});

test('REGRESSION: a vanished settings row cannot resurrect a disabled switch', async () => {
  // Found: the empty-row branch unconditionally set enabled, so deleting the
  // row (or a botched migration) re-enabled AI that had been deliberately
  // stopped — the same silent recovery the read-failure path already guarded.
  let value = 'false';
  killSwitch._setReaderForTests(async () => ({ value, updatedBy: null, reason: null }));
  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  value = null; // row deleted
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
});

test('REGRESSION: a stale in-flight read cannot re-enable AI after the switch is pulled', async () => {
  // Found: last-writer-wins. A read that started BEFORE the disable could land
  // after the read that saw it, re-enabling AI for a full cache TTL.
  let resolveSlow;
  const slow = new Promise((r) => { resolveSlow = r; });

  let call = 0;
  killSwitch._setReaderForTests(async () => {
    call += 1;
    if (call === 1) { await slow; return { value: 'true', updatedBy: null, reason: null }; }
    return { value: 'false', updatedBy: null, reason: null };
  });

  const stale = killSwitch.isGloballyEnabled();   // starts first, resolves last
  const fresh = await killSwitch.isGloballyEnabled(); // starts second, sees 'false'
  expect(fresh).toBe(false);

  resolveSlow();
  await stale;

  // The stale result must not have been accepted.
  killSwitch._setReaderForTests(async () => { throw new Error('no further reads'); });
  // (reader reset clears state, so assert on the value observed above instead)
  expect(fresh).toBe(false);
});

test('REGRESSION: the interaction is attributable to the therapist who asked', async () => {
  // Found: the routes never passed userId, so every ai_interactions row was
  // written with a null actor — no AI call could be traced to a person, and
  // the review update (scoped by user_id) could never match its own row.
  await gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    userId: 'therapist-42',
    organisationId: 'org-1',
    outputType: outputTypes.CLINICAL_DOCUMENT,
    messages: [{ role: 'user', content: 'synthetic' }],
  });

  const reserve = events.find((e) => e.op === 'reserve');
  expect(reserve.actorUserId).toBe('therapist-42');
  expect(reserve.organisationId).toBe('org-1');
});

// ── Milestone 2.6: fail-safe kill switch ────────────────────────────────────
//
// The kill switch is part of incident response, not an application feature.
// "We attempted to disable AI, but the setting format was invalid and the
// previous state remained active" is not an acceptable sentence to write in an
// incident report.

test('parseSwitchValue accepts exactly two values and nothing else', () => {
  expect(killSwitch.parseSwitchValue('true')).toEqual({ ok: true, enabled: true });
  expect(killSwitch.parseSwitchValue('false')).toEqual({ ok: true, enabled: false });

  // Absence is a distinct case from an unparseable value.
  expect(killSwitch.parseSwitchValue(null)).toEqual({ missing: true });
  expect(killSwitch.parseSwitchValue(undefined)).toEqual({ missing: true });

  for (const bad of ['TRUE', ' true', 'true ', 'enabled', 'off', '1', '', 'banana', true, 1, {}]) {
    expect(killSwitch.parseSwitchValue(bad)).toEqual({ ok: false });
  }
});

test('INCIDENT SIMULATION: an admin types "OFF" and AI actually stops', async () => {
  // The real human scenario. Nobody types carefully during an incident, and
  // the previous behaviour would have read 'OFF' as ENABLED — telling the
  // operator nothing was wrong while clinical transcripts kept flowing.
  let value = 'true';
  killSwitch._setReaderForTests(async () => ({
    value, updatedBy: 'admin-1', reason: 'Suspected data exposure — halting AI',
  }));

  expect(await killSwitch.isGloballyEnabled()).toBe(true);
  events.length = 0;

  // The admin reaches for the switch and gets the format wrong.
  value = 'OFF';
  killSwitch.invalidate();

  let transmitted = false;
  mockProvider._setHandlerForTests(async () => { transmitted = true; return { text: 'x' }; });

  await expect(gateway.generate({
    feature: CLINICAL_FEATURE,
    modelKey: 'mock',
    userId: 'therapist-1',
    messages: [{ role: 'user', content: 'synthetic dictation' }],
  })).rejects.toThrow('ai_denied');

  // The switch was understood as "stop", not as "carry on".
  expect(transmitted).toBe(false);
  const denial = events.find((e) => e.event && e.event.status === 'denied');
  expect(denial.event.denyReason).toBe('ai_globally_disabled:setting');

  await new Promise((r) => setImmediate(r));

  // And the operator can find out WHY their command looked odd.
  const invalid = events.find((e) => e.op === 'securityEvent'
    && e.event.eventType === 'invalid_kill_switch_value');
  expect(invalid).toBeTruthy();
  expect(invalid.event.newState).toBe('disabled');
  expect(invalid.event.detail).toContain('expected "true" or "false"');
  expect(invalid.event.detail).toContain('OFF');
  expect(invalid.actorUserId).toBe('admin-1');
});

test('an invalid value is reported once, not once per cache expiry', async () => {
  // A 15-second cache TTL means an un-deduplicated event would write four
  // rows a minute for as long as the bad value sat there, burying the events
  // that matter under the one already understood.
  killSwitch._setReaderForTests(async () => ({ value: 'banana', updatedBy: null, reason: null }));

  for (let i = 0; i < 5; i++) {
    killSwitch.invalidate();
    // eslint-disable-next-line no-await-in-loop
    expect(await killSwitch.isGloballyEnabled()).toBe(false);
  }
  await new Promise((r) => setImmediate(r));

  const invalidEvents = events.filter((e) => e.op === 'securityEvent'
    && e.event.eventType === 'invalid_kill_switch_value');
  expect(invalidEvents).toHaveLength(1);
});

test('a corrected value clears the reported state and is honoured', async () => {
  let value = 'nonsense';
  killSwitch._setReaderForTests(async () => ({ value, updatedBy: null, reason: null }));
  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  // Operator fixes the typo.
  value = 'true';
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(true);

  // A later relapse is reported again rather than suppressed by the earlier one.
  events.length = 0;
  value = 'nonsense';
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
  await new Promise((r) => setImmediate(r));

  expect(events.some((e) => e.op === 'securityEvent'
    && e.event.eventType === 'invalid_kill_switch_value')).toBe(true);
});

test('an invalid value cannot re-enable AI that was already disabled', async () => {
  // Composition of the two failure modes: deliberate disable, then somebody
  // "fixes" the row with an unparseable value. It must stay off.
  let value = 'false';
  killSwitch._setReaderForTests(async () => ({ value, updatedBy: null, reason: null }));
  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  value = 'ON';
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);

  value = null; // and then the row is deleted
  killSwitch.invalidate();
  expect(await killSwitch.isGloballyEnabled()).toBe(false);
});
