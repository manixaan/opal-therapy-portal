'use strict';
/**
 * STAGES 6–8: cloud validation harness — runs against the DEPLOYED staging
 * app over HTTPS. The cloud twin of the local infrastructure test bench.
 *
 * Usage:
 *   BASE=https://opal-portal-staging.azurewebsites.net \
 *   SYN_PASS="$(sed 's/.*: //' deploy/staging-synthetic.local.txt)" \
 *   node deploy/staging-validate.js
 *
 * Synthetic accounts only. Read-only toward Outlook/Splose (flags are off
 * server-side; nothing here can write to remote systems).
 */

const BASE = process.env.BASE;
const SYN_PASS = process.env.SYN_PASS;
if (!BASE || !SYN_PASS) { console.error('BASE and SYN_PASS are required'); process.exit(2); }

const PDF_B64 = Buffer.from('%PDF-1.4 synthetic staging validation document').toString('base64');
const results = [];
function record(id, desc, got, want) {
  const ok = String(got) === String(want);
  results.push({ id, desc, got: String(got), want: String(want), ok });
  console.log(`${ok ? '✓' : '✗ FINDING'} [${id}] ${desc} → ${got} (want ${want})`);
}

/** Minimal cookie-jar fetch client (per synthetic user). */
function makeClient() {
  let cookie = '';
  return async function client(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
    const res = await fetch(BASE + path, {
      method,
      redirect: 'manual',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        Origin: BASE,
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const setC = res.headers.getSetCookie?.() || [];
    if (setC.length) cookie = setC.map(c => c.split(';')[0]).join('; ');
    if (raw) return res;
    let json = null;
    try { json = await res.json(); } catch (_) {}
    return { status: res.status, json, headers: res.headers };
  };
}

async function login(email) {
  const c = makeClient();
  const r = await c('/api/auth/login', { method: 'POST', body: { email, password: SYN_PASS } });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`);
  return c;
}

(async () => {
  // ── STAGE 6: platform behaviour ────────────────────────────────────────
  const health = await fetch(BASE + '/health');
  record('6.1', '/health over HTTPS', health.status, 200);
  const ready = await (await fetch(BASE + '/ready')).json();
  record('6.2', '/ready database check', ready.checks?.database, 'ok');
  record('6.3', '/ready migrations check', ready.checks?.migrations, 'ok');
  record('6.4', '/ready config check', ready.checks?.config, 'ok');

  const loginPage = await fetch(BASE + '/login');
  record('6.5', 'frontend /login serves', loginPage.status, 200);
  record('6.6', 'CSP header present', loginPage.headers.has('content-security-policy'), true);
  record('6.7', 'HSTS header present', loginPage.headers.has('strict-transport-security'), true);
  record('6.8', 'X-Request-Id correlation header', (await fetch(BASE + '/login')).headers.has('x-request-id'), true);
  const sio = await fetch(BASE + '/socket.io/socket.io.js');
  record('6.9', 'Socket.IO client asset', sio.status, 200);
  const root = await fetch(BASE + '/', { redirect: 'manual' });
  record('6.10', 'unauthenticated / redirects to login', root.status, 302);

  // Socket.IO engine handshake (polling transport — proves the websocket
  // endpoint routes through App Service correctly)
  const sioHandshake = await fetch(BASE + '/socket.io/?EIO=4&transport=polling');
  record('6.11', 'Socket.IO handshake', sioHandshake.status, 200);

  // ── STAGE 7: synthetic employees — auth + roles ───────────────────────
  const owner = await login('synthetic.owner@example.test');
  const admin = await login('synthetic.admin@example.test');
  const therapist = await login('synthetic.therapist@example.test');
  const readonly = await login('synthetic.readonly@example.test');
  record('7.1', 'all four synthetic roles can log in', true, true);

  const badLogin = await makeClient()('/api/auth/login', {
    method: 'POST', body: { email: 'synthetic.owner@example.test', password: 'WrongPassword1' } });
  record('7.2', 'wrong password rejected', badLogin.status, 401);

  const me = await therapist('/api/auth/me');
  record('7.3', 'session persists across requests (PG session store)', me.status, 200);
  record('7.4', 'me returns correct role', me.json?.role, 'therapist');

  const adminUsers = await admin('/api/admin/users');
  record('7.5', 'admin can list users', adminUsers.status, 200);
  const therapistAdmin = await therapist('/api/admin/users');
  record('7.6', 'therapist blocked from admin users', therapistAdmin.status, 403);

  const roWrite = await readonly('/api/profile/credentials', {
    method: 'POST', body: { credentialType: 'ahpra', credentialName: 'X' } });
  record('7.7', 'read_only blocked from business writes', roWrite.status, 403);
  const roRead = await readonly('/api/profile/documents');
  record('7.8', 'read_only can read', roRead.status, 200);

  const leave = await therapist('/api/profile/leave', {
    method: 'POST', body: { leaveType: 'annual', startDate: '2026-08-03', endDate: '2026-08-04', reason: 'synthetic validation' } });
  record('7.9', 'therapist can submit leave', leave.status === 200 || leave.status === 201 ? '2xx' : leave.status, '2xx');

  const pw = await therapist('/api/auth/change-password', {
    method: 'POST', body: { currentPassword: SYN_PASS, newPassword: SYN_PASS + 'x' } });
  record('7.10', 'password change works', pw.status, 200);
  // change it back so the harness stays rerunnable
  await therapist('/api/auth/change-password', {
    method: 'POST', body: { currentPassword: SYN_PASS + 'x', newPassword: SYN_PASS } });

  // ── STAGE 8: Azure Blob document round trip ───────────────────────────
  const up = await therapist('/api/profile/documents', {
    method: 'POST',
    body: { title: 'Synthetic Blob Validation', fileName: 'synthetic.pdf', fileMime: 'application/pdf', fileData: PDF_B64 },
  });
  record('8.1', 'upload → private blob (201, backend=blob)',
    `${up.status}/${up.json?.document?.storage_backend}`, '201/blob');
  const docId = up.json?.document?.id;

  if (docId) {
    const dl = await therapist(`/api/profile/documents/${docId}/download`, { raw: true });
    const bytes = Buffer.from(await dl.arrayBuffer()).toString();
    record('8.2', 'authorised download returns exact bytes',
      `${dl.status}/${bytes.includes('%PDF-1.4 synthetic staging')}`, '200/true');

    const unauth = await fetch(`${BASE}/api/profile/documents/${docId}/download`);
    record('8.3', 'unauthenticated download denied', unauth.status, 401);
    const cross = await readonly(`/api/profile/documents/${docId}/download`);
    record('8.4', 'cross-user download denied', cross.status, 403);
    const ownerDl = await owner(`/api/profile/documents/${docId}/download`, { raw: true });
    record('8.5', 'owner cross-user download allowed', ownerDl.status, 200);
    const badId = await therapist('/api/profile/documents/not-a-uuid/download');
    record('8.6', 'invalid id handled safely', badId.status, 404);

    const del = await therapist(`/api/profile/documents/${docId}`, { method: 'DELETE' });
    record('8.7', 'delete removes document + blob', del.status, 200);
    const gone = await therapist(`/api/profile/documents/${docId}/download`);
    record('8.8', 'deleted document 404', gone.status, 404);
  }

  const exe = await therapist('/api/profile/documents', {
    method: 'POST', body: { title: 'x', fileName: 'evil.exe', fileMime: 'application/x-msdownload', fileData: 'TVqQAAM=' } });
  record('8.9', 'executable upload denied', exe.status, 415);

  // ── summary ────────────────────────────────────────────────────────────
  const findings = results.filter(r => !r.ok);
  console.log(`\n════ ${results.length} cloud probes, ${findings.length} findings ════`);
  findings.forEach(f => console.log(`  FINDING [${f.id}] ${f.desc}: got ${f.got}, want ${f.want}`));
  process.exit(findings.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR:', e.message); process.exit(2); });
