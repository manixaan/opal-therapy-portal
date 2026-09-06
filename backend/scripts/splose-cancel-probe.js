#!/usr/bin/env node
'use strict';
/**
 * Splose cancel-endpoint probe — proves whether POST /appointments/{id}/cancellation
 * works against the live practice account.
 *
 * WRITES TO SPLOSE. Only run when the owner has approved it. Everything it
 * creates is clearly labelled "API PROBE" and lands two years in the future
 * so it can never collide with a real session or an invoice run.
 *
 * Steps:
 *   1. create a throwaway patient   "ZZ-API-Probe Do-Not-Book"   (or reuse --patient=<id>)
 *   2. create a 15-minute appointment for --practitioner=<id>, --service=<id>, location 9456
 *   3. POST /appointments/{id}/cancellation with --reason=<id> (default 57066 "Other")
 *   4. re-read the appointment and print its patient status / cancellation fields
 *
 * Nothing is deleted: Splose has no delete for patients via the API. Archive the
 * probe patient in the Splose UI afterwards.
 *
 * Usage (from backend/, .env holding SPLOSE_API_KEY):
 *   node scripts/splose-cancel-probe.js --practitioner=88167 --service=125320 [--patient=ID] [--reason=57066]
 */
const axios = require('axios');
require('dotenv').config();

const args = Object.fromEntries(process.argv.slice(2).map(a => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v === undefined ? true : v];
}));

const BASE = (process.env.SPLOSE_BASE_URL || 'https://api.splose.com') + '/v1';
const c = axios.create({ baseURL: BASE, headers: { Authorization: `Bearer ${process.env.SPLOSE_API_KEY}` }, timeout: 20000 });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOCATION_ID = Number(args.location || 9456);
const REASON_ID = Number(args.reason || 57066);

function fail(msg, err) {
  console.error('✗', msg, err?.response?.status || '', JSON.stringify(err?.response?.data) || err?.message || '');
  process.exit(1);
}

(async () => {
  if (!process.env.SPLOSE_API_KEY) fail('SPLOSE_API_KEY not set');
  if (!args.practitioner || !args.service) fail('--practitioner and --service are required');

  // 1. patient
  let patientId = args.patient ? Number(args.patient) : null;
  if (!patientId) {
    try {
      const r = await c.post('/patients', {
        firstName: 'ZZ-API-Probe', lastName: 'Do-Not-Book',
        email: 'api-probe@example.invalid',
      });
      patientId = r.data.id;
      console.log('1. probe patient created:', patientId);
    } catch (e) { fail('create patient', e); }
    await sleep(700);
  } else {
    console.log('1. reusing patient', patientId);
  }

  // 2. appointment, two years out, 15 minutes
  const start = new Date(); start.setUTCFullYear(start.getUTCFullYear() + 2); start.setUTCHours(1, 0, 0, 0);
  const end = new Date(start.getTime() + 15 * 60000);
  let apptId;
  try {
    const r = await c.post('/appointments', {
      start: start.toISOString(), end: end.toISOString(),
      serviceId: Number(args.service), locationId: LOCATION_ID,
      practitionerId: Number(args.practitioner), patientId,
      note: 'API PROBE — cancellation test, ignore',
    });
    apptId = r.data.id;
    console.log('2. appointment created:', apptId, start.toISOString());
  } catch (e) { fail('create appointment', e); }
  await sleep(700);

  // 3. cancel
  try {
    const r = await c.post(`/appointments/${apptId}/cancellation`, { reasonId: REASON_ID, note: 'API probe cancel' });
    console.log('3. cancel response:', r.status, JSON.stringify(r.data));
  } catch (e) { fail(`cancel appointment ${apptId} (leave it to be cancelled by hand in Splose)`, e); }
  await sleep(700);

  // 4. verify
  try {
    const r = await c.get(`/appointments/${apptId}`);
    const a = r.data;
    console.log('4. re-read:', JSON.stringify({
      id: a.id, archived: a.archived, deletedAt: a.deletedAt,
      patients: (a.appointmentPatients || []).map(p => ({
        patientId: p.patientId, status: p.status,
        cancellationReason: p.cancellationReason, cancellationNote: p.cancellationNote, cancellationRate: p.cancellationRate,
      })),
    }, null, 2));
    const cancelled = (a.appointmentPatients || []).some(p => /cancel/i.test(p.status || '')) || a.deletedAt;
    console.log(cancelled ? '\n✓ Cancel via API WORKS' : '\n? Cancel returned OK but the appointment does not read as cancelled — inspect in the Splose UI');
  } catch (e) {
    if (e.response?.status === 404) console.log('4. re-read 404 — Splose removed the appointment on cancel. ✓ Cancel via API WORKS (as a delete)');
    else fail('re-read appointment', e);
  }
  console.log(`\nClean-up: archive patient ${patientId} in the Splose UI.`);
})();
