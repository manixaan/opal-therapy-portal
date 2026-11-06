'use strict';
/**
 * Opal Assist load test: how many questions at once, how fast, and what fails.
 *
 *   BASE=https://opal-portal-staging.azurewebsites.net \
 *   SYN_PASS="$(sed 's/.*: //' deploy/staging-synthetic.local.txt)" \
 *   node deploy/assist-stress.js
 *
 * Refuses any host but staging or localhost: staging and production share one
 * AWS account and so one Bedrock quota, so this is run briefly and on purpose,
 * and never against the live portal. Made-up prompts only, synthetic accounts
 * only. About 47 short model calls (cents). Prints counts, timings and reason
 * codes — no prompt or reply text.
 *
 * What it answers:
 *   1. Bursts of 1, 2, 5, 10, 20 at once: how many succeed, and how slowly?
 *   2. Long case notes at once: do they beat the 45 s timeout?
 *   3. Five prompts in a row in ONE chat: does it die after the first or second?
 *   4. What the audit trail says went wrong (owner's security-status endpoint).
 */
const BASE = process.env.BASE;
const SYN_PASS = process.env.SYN_PASS;
if (!BASE || !SYN_PASS) { console.error('Set BASE and SYN_PASS'); process.exit(2); }
if (!/staging|localhost|127\.0\.0\.1/.test(BASE) || /prod/.test(BASE)) { console.error('Refusing: staging or localhost only.'); process.exit(2); }
const EMAILS = (process.env.EMAILS || 'synthetic.owner@example.test,synthetic.admin@example.test,synthetic.therapist@example.test').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body } = {}) => {
    const res = await fetch(BASE + path, { method, redirect: 'manual', headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), Origin: BASE }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.getSetCookie?.() || [];
    if (set.length) cookie = set.map((c) => c.split(';')[0]).join('; ');
    let json = null; try { json = await res.json(); } catch (_) { /* not json */ }
    return { status: res.status, json };
  };
}

async function ask(c, body) {
  const t0 = Date.now();
  try {
    const r = await c('/api/assist/chat', { method: 'POST', body });
    const outcome = r.status === 200 ? (r.json?.status || 'no_status') : `http_${r.status}`;
    return { outcome, ms: Date.now() - t0, kind: r.json?.kind, conversationId: r.json?.conversationId };
  } catch (e) { return { outcome: 'network_error', ms: Date.now() - t0 }; }
}

function report(label, results) {
  const counts = {}; results.forEach((r) => { counts[r.outcome] = (counts[r.outcome] || 0) + 1; });
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const s = (v) => (v / 1000).toFixed(1) + 's';
  console.log(`${label.padEnd(26)} ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ').padEnd(34)} fastest ${s(ms[0])}  median ${s(ms[Math.floor(ms.length / 2)])}  slowest ${s(ms[ms.length - 1])}`);
}

// A made-up note with no names, long enough to need a real document back.
const NOTE = 'Rewrite this case note. '.concat(Array.from({ length: 30 }, (_, i) => `Observation ${i + 1}: the participant moved between the kitchen and living room with prompting, used the sensory items offered, then took a short break before returning to the activity.`).join(' '));

(async () => {
  const users = [];
  for (const e of EMAILS) {
    const c = client();
    const r = await c('/api/auth/login', { method: 'POST', body: { email: e, password: SYN_PASS } });
    if (r.status === 200) users.push(c); else console.log(`login failed for one account: ${r.status}`);
  }
  if (!users.length) { console.error('No account could sign in.'); process.exit(1); }
  const cfg = await users[0]('/api/assist/config');
  console.log(`enabled=${cfg.json?.enabled} reason=${cfg.json?.reason} model=${cfg.json?.model?.name} accounts=${users.length}\n`);

  console.log('── 1. Bursts of short questions at the same moment');
  for (const n of [1, 2, 5, 10, 20]) {
    const results = await Promise.all(Array.from({ length: n }, (_, i) => ask(users[i % users.length], { message: `In one short sentence, why do therapy sessions use visual schedules? (sample ${n}-${i})`, surface: 'word' })));
    report(`${n} at once`, results);
    await sleep(5000);
  }

  console.log('\n── 2. Long case notes (a real document back; the limit is 45 s a try)');
  for (const n of [1, 3]) {
    const results = await Promise.all(Array.from({ length: n }, (_, i) => ask(users[i % users.length], { message: NOTE })));
    report(`${n} long at once`, results);
    console.log(`  kinds: ${results.map((r) => r.kind || '-').join(', ')}`);
    await sleep(5000);
  }

  console.log('\n── 3. Five prompts in a row in one chat');
  let conversationId = null;
  const prompts = ['Rewrite this case note: the participant was settled and used the fan and sponge.', 'Make it shorter.', 'Now make it more formal.', 'Add a plan to continue next week.', 'What does reasonable and necessary mean?'];
  for (let i = 0; i < prompts.length; i++) {
    const r = await ask(users[0], { message: prompts[i], ...(conversationId ? { conversationId } : {}) });
    conversationId = r.conversationId || conversationId;
    console.log(`  prompt ${i + 1}: ${r.outcome.padEnd(14)} ${(r.ms / 1000).toFixed(1)}s  ${r.kind || ''}`);
  }

  console.log('\n── 4. What the audit trail recorded (latest 15 AI calls)');
  const st = await users[0]('/api/ai/security-status');
  const recent = st.json?.recent_outcomes || null;
  if (!recent) console.log(`  not available (http ${st.status})`);
  else {
    const seen = {};
    recent.forEach((r) => { const k = `${r.feature} ${r.status}${r.deny_reason ? ' ' + r.deny_reason : ''}`; seen[k] = (seen[k] || 0) + 1; });
    Object.entries(seen).forEach(([k, v]) => console.log(`  ${v} × ${k}`));
    const lat = recent.map((r) => r.latency_ms).filter(Boolean).sort((a, b) => a - b);
    if (lat.length) console.log(`  latency: median ${(lat[Math.floor(lat.length / 2)] / 1000).toFixed(1)}s, slowest ${(lat[lat.length - 1] / 1000).toFixed(1)}s`);
  }
  console.log('\nDone.');
  process.exit(0);
})().catch((e) => { console.error('Stopped:', e.message); process.exit(1); });
