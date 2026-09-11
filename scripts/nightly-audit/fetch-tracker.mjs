#!/usr/bin/env node
/**
 * Nightly audit — step 1: pull the Opal Development Manager tracker.
 *
 * Reads every non-archived feature and its tasks from the Development
 * Manager's Supabase project (REST / PostgREST) and writes them to a JSON
 * file the auditing agent then reasons over.
 *
 * Auth:
 *   - In the cloud routine the Supabase key is injected by the environment's
 *     API-credential proxy as an `apikey` header on requests to *.supabase.co.
 *     The key never appears in this process or in the transcript.
 *   - Locally, set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_KEY) and the script
 *     adds the header itself. Never commit or print that value.
 *
 * Usage:
 *   SUPABASE_URL=https://<ref>.supabase.co node scripts/nightly-audit/fetch-tracker.mjs [out.json]
 *
 * Read-only: this script issues GET requests only.
 *
 * In the cloud sandbox run with NODE_USE_ENV_PROXY=1 so Node's fetch honours
 * HTTPS_PROXY; otherwise the request bypasses the credential proxy.
 */
import { writeFile } from 'node:fs/promises';

const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('fetch-tracker: SUPABASE_URL must look like https://<ref>.supabase.co');
  process.exit(2);
}
const localKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || '';
const out = process.argv[2] || 'tracker.json';

async function rest(path) {
  const headers = { Accept: 'application/json' };
  if (localKey) {
    headers.apikey = localKey;
    headers.Authorization = `Bearer ${localKey}`;
  }
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase ${res.status} on ${path.split('?')[0]}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

const featureCols = [
  'id', 'title', 'idea', 'why', 'who_uses_it', 'what_they_see', 'what_should_happen',
  'outcome', 'stage', 'environment', 'strategy', 'technical_plan', 'explanation',
  'build_explanation', 'build_prompt', 'claude_update', 'next_action',
  'created_at', 'updated_at',
].join(',');
const taskCols = [
  'id', 'feature_id', 'position', 'title', 'why', 'what', 'technical_notes', 'phase',
  'status', 'explanation', 'build_prompt', 'checklist', 'notes', 'updated_at', 'completed_at',
].join(',');

try {
  const [features, tasks, decisions, workspace] = await Promise.all([
    rest(`features?select=${featureCols}&archived_at=is.null&order=updated_at.desc`),
    rest(`tasks?select=${taskCols}&order=feature_id,position`),
    rest('decisions?select=feature_id,text,created_at&order=created_at'),
    rest('workspace?select=name,product_description,codebase_notes,repo_url&limit=1'),
  ]);
  const byFeature = new Map();
  for (const t of tasks) {
    if (!byFeature.has(t.feature_id)) byFeature.set(t.feature_id, { tasks: [], decisions: [] });
    byFeature.get(t.feature_id).tasks.push(t);
  }
  for (const d of decisions) {
    if (!byFeature.has(d.feature_id)) byFeature.set(d.feature_id, { tasks: [], decisions: [] });
    byFeature.get(d.feature_id).decisions.push(d);
  }
  const snapshot = {
    fetched_at: new Date().toISOString(),
    workspace: workspace[0] || null,
    features: features.map((f) => ({ ...f, ...(byFeature.get(f.id) || { tasks: [], decisions: [] }) })),
  };
  await writeFile(out, JSON.stringify(snapshot, null, 2));
  const taskCount = snapshot.features.reduce((n, f) => n + f.tasks.length, 0);
  console.log(`fetch-tracker: ${snapshot.features.length} features, ${taskCount} tasks -> ${out}`);
} catch (err) {
  console.error(`fetch-tracker: FAILED — ${err.message}`);
  process.exit(1);
}
