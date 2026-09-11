#!/usr/bin/env node
/**
 * Nightly audit — step 3: write the night's findings back into the Opal
 * Development Manager tracker so the team sees them where they already look.
 *
 * Input: a JSON file written by the auditing agent:
 * {
 *   "audit_date": "YYYY-MM-DD",
 *   "brief": { "summary": "one paragraph: status line + do-this-first" },
 *   "features": [
 *     { "id": "<feature uuid>",
 *       "claude_update": "one friendly sentence on where things stand",
 *       "next_action":   "the single next step, plain English",
 *       "start_prompt":  "full START.md text (or null when proven)",
 *       "activity_summary": "one line for the feature's activity feed" }
 *   ]
 * }
 *
 * What it touches — and nothing else:
 *   features.claude_update, features.next_action   (overwritten nightly)
 *   feature_messages                              (one assistant message per feature per night)
 *   activity                                      (one 'ai' row per feature per night, plus one workspace row)
 * It never changes stage, environment, tasks, decisions, build_prompt or any human-written field.
 * Idempotent per audit_date: re-running the same night skips rows already posted.
 *
 * Auth: same as fetch-tracker.mjs — the cloud environment's credential proxy adds
 * the key on requests to *.supabase.co; locally set SUPABASE_SERVICE_ROLE_KEY.
 * Run with NODE_USE_ENV_PROXY=1 in the cloud sandbox.
 *
 * Usage: SUPABASE_URL=https://<ref>.supabase.co node scripts/nightly-audit/post-tracker.mjs writeback.json
 */
import { readFile } from 'node:fs/promises';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('post-tracker: SUPABASE_URL must look like https://<ref>.supabase.co');
  process.exit(2);
}
const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const inPath = process.argv[2];
if (!inPath) { console.error('post-tracker: usage: post-tracker.mjs <writeback.json>'); process.exit(2); }

function headers(extra = {}) {
  const h = { Accept: 'application/json', 'Content-Type': 'application/json', ...extra };
  if (localKey) { h.apikey = localKey; h.Authorization = `Bearer ${localKey}`; }
  return h;
}
async function rest(method, path, body, extra) {
  const res = await fetch(`${url}/rest/v1/${path}`, { method, headers: headers(extra), body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} on ${method} ${path.split('?')[0]}: ${text.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

try {
  const payload = JSON.parse(await readFile(inPath, 'utf8'));
  if (!DATE.test(payload.audit_date || '')) throw new Error('audit_date must be YYYY-MM-DD');
  if (!Array.isArray(payload.features)) throw new Error('features must be an array');
  const tag = `Nightly audit ${payload.audit_date}`;

  // Which features already have tonight's activity row? (idempotence)
  const existing = await rest('GET', `activity?select=feature_id&action=eq.nightly_audit&metadata->>audit_date=eq.${payload.audit_date}`);
  const done = new Set(existing.map((r) => r.feature_id));

  let updated = 0, skipped = 0;
  for (const f of payload.features) {
    if (!UUID.test(f.id || '')) throw new Error(`bad feature id: ${f.id}`);
    const claudeUpdate = clip(f.claude_update, 400);
    const nextAction = clip(f.next_action, 200);
    if (!claudeUpdate || !nextAction) throw new Error(`feature ${f.id}: claude_update and next_action are required`);

    // Always refresh the two summary fields — they describe "now".
    await rest('PATCH', `features?id=eq.${f.id}`, { claude_update: claudeUpdate, next_action: nextAction }, { Prefer: 'return=minimal' });

    if (done.has(f.id)) { skipped++; continue; }

    const startPrompt = clip(f.start_prompt, 12000);
    const content = startPrompt
      ? `${tag}\n\n${claudeUpdate}\n\n---\nStarter prompt for the next Claude Code session (edit before use):\n\n${startPrompt}`
      : `${tag}\n\n${claudeUpdate}`;
    await rest('POST', 'feature_messages', [{ feature_id: f.id, role: 'assistant', content, user_id: null }], { Prefer: 'return=minimal' });
    await rest('POST', 'activity', [{
      feature_id: f.id, task_id: null, actor: 'ai', action: 'nightly_audit',
      summary: clip(f.activity_summary, 300) || claudeUpdate,
      metadata: { audit_date: payload.audit_date, source: 'nightly-audit' }, user_id: null,
    }], { Prefer: 'return=minimal' });
    updated++;
  }

  // One workspace-level row so the day's headline exists even without opening a feature.
  const briefSummary = clip(payload.brief && payload.brief.summary, 1000);
  if (briefSummary && !done.has(null)) {
    await rest('POST', 'activity', [{
      feature_id: null, task_id: null, actor: 'ai', action: 'nightly_audit',
      summary: `${tag}: ${briefSummary}`,
      metadata: { audit_date: payload.audit_date, source: 'nightly-audit', scope: 'workspace' }, user_id: null,
    }], { Prefer: 'return=minimal' });
  }
  console.log(`post-tracker: ${updated} features posted, ${skipped} already posted tonight, brief ${briefSummary ? 'posted' : 'absent'}`);
} catch (err) {
  console.error(`post-tracker: FAILED — ${err.message}`);
  process.exit(1);
}
