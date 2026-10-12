'use strict';

/**
 * Non-face-to-face UI (frontend/current/nf2f.js, 11 Oct 2026): several clients
 * on a booking, the block's timer button, the running chip, Allocate billing.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/nf2f.js'), 'utf8');

function env({ running = [] } = {}) {
  const dom = new JSDOM(`<div id="cat-client-section"><div id="patient-list">
      <div class="patient-card" data-patient-id="1">Al</div><div class="patient-card" data-patient-id="2">Bo</div><div class="patient-card" data-patient-id="3">Cy</div>
    </div></div><div id="bd-body"></div><div id="day-mon" class="cal-col"></div>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const log = [];
  let leaf = { group: 'nf2f' };
  w.PATIENTS = [{ id: 1, first: 'Al', last: 'A' }, { id: 2, first: 'Bo', last: 'B' }, { id: 3, first: 'Cy', last: 'C' }];
  w.BOOKING_STATE = { selectedPatient: null };
  w.SESSIONS = {};
  w.currentBookingLeaf = () => leaf;
  w.selectBookingLeaf = () => {};
  w.clearBookingClient = () => {};
  w.openBookingPanel = () => {};
  w.renderPatients = () => {};
  w.openBlockDetail = (id) => log.push(['open', id]);
  w.showToast = (...a) => log.push(['toast', ...a]);
  w.addSession = (col, opts) => { const el = w.document.createElement('div'); el.className = 'session'; col.appendChild(el); w.SESSIONS[opts.id] = { ...opts, element: el }; return opts.id; };
  let runningNow = running;
  w.fetch = async (url, o) => {
    log.push([(o && o.method) || 'GET', url, o && o.body ? JSON.parse(o.body) : null]);
    const json = (x, status = 200) => ({ ok: status < 400, status, json: async () => x });
    if (url === '/api/nf2f/running') return json({ running: runningNow });
    if (/\/nf2f\/start$/.test(url)) { runningNow = [{ eventId: 'db-1', title: 'Case Management', clients: [{ clientId: '1', clientName: 'Al A' }], timer: { status: 'RUNNING', elapsedSeconds: 0, limitSeconds: 3600 } }]; return json({ timer: { status: 'RUNNING' } }); }
    if (/\/nf2f\/stop$/.test(url)) { runningNow = []; return json({ timer: { status: 'STOPPED', elapsedSeconds: 600 }, clients: [{}, {}] }); }
    return json({}, 404);
  };
  w.eval(SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
  return { w, log, flush, setLeaf: (l) => { leaf = l; }, $: (id) => w.document.getElementById(id) };
}

describe('Smart Booking: several clients, or none', () => {
  test('clicks add and remove clients; none means non-billable', async () => {
    const { w, $ } = env();
    const card = (id) => w.document.querySelector(`.patient-card[data-patient-id="${id}"]`);
    card(1).click(); card(3).click();
    expect(w.Nf2f.selectedClients()).toEqual([{ clientId: '1', clientName: 'Al A' }, { clientId: '3', clientName: 'Cy C' }]);
    expect(card(1).classList.contains('selected') && card(3).classList.contains('selected')).toBe(true);
    expect($('nf2f-picked').textContent).toMatch(/2 clients · billable time is split between them/);
    expect(w.BOOKING_STATE.selectedPatient.id).toBe(1);
    card(1).click();
    w.document.querySelector('[data-nf2f-unpick="3"]').click();
    expect(w.Nf2f.selectedClients()).toEqual([]);
    expect($('nf2f-picked').textContent).toMatch(/No clients.*non-billable/);
  });
  test('on other booking types the list keeps its single-client behaviour', () => {
    const { w, setLeaf } = env();
    setLeaf({ group: 'direct' });
    let hit = 0;
    w.document.querySelector('.patient-card').addEventListener('click', () => { hit++; });
    w.document.querySelector('.patient-card').click();
    expect(hit).toBe(1);
    expect(w.Nf2f.selectedClients()).toEqual([]);
  });
});

describe('the block and the running timer', () => {
  test('a block with clients lists them with Start; with none it says Non-billable', async () => {
    const { w, $, flush } = env();
    w.addSession($('day-mon'), { id: 'A', dbId: 'db-1', booking: { group: 'nf2f', clients: [{ clientId: '1', clientName: 'Al A' }, { clientId: '2', clientName: 'Bo B' }] } });
    w.addSession($('day-mon'), { id: 'B', dbId: 'db-2', booking: { group: 'nf2f', clientId: null } });
    await flush();
    expect(w.SESSIONS.A.element.querySelector('.nf2f-clients').textContent).toBe('Al A, Bo B');
    // Start is in the right-click menu, not on the block.
    expect(w.SESSIONS.A.element.querySelector('.nf2f-btn')).toBeNull();
    expect(w.Nf2f.menuItems(w.SESSIONS.A)).toMatch(/data-nf2f-start="db-1".*Start billable time.*data-nf2f-alloc="db-1".*Allocate billing/);
    expect(w.Nf2f.menuItems(w.SESSIONS.B)).toBe('');
    expect(w.SESSIONS.B.element.querySelector('.nf2f-nonbill').textContent).toBe('Non-billable');
  });
  test('Start (right-click menu) → the chip appears on the calendar with Stop; Stop from the chip clears it', async () => {
    const { w, $, log, flush } = env();
    w.addSession($('day-mon'), { id: 'A', dbId: 'db-1', booking: { group: 'nf2f', clients: [{ clientId: '1', clientName: 'Al A' }] } });
    await flush();
    const menu = w.document.createElement('div');
    menu.innerHTML = w.Nf2f.menuItems(w.SESSIONS.A);
    w.document.body.appendChild(menu);
    menu.querySelector('[data-nf2f-start]').click();
    await flush();
    expect(log.some((l) => l[0] === 'POST' && l[1] === '/api/events/db-1/nf2f/start')).toBe(true);
    const chip = $('nf2f-run-chip');
    expect(chip.textContent).toMatch(/Case Management.*Al A/);
    // The block shows a blinking dot while it records — no clock to get cut off.
    expect(w.SESSIONS.A.element.querySelector('.nf2f-live-dot')).not.toBeNull();
    expect(w.SESSIONS.A.element.querySelector('.nf2f-btn')).toBeNull();
    chip.querySelector('[data-nf2f-stop]').click();
    await flush();
    expect(log.some((l) => l[0] === 'POST' && l[1] === '/api/events/db-1/nf2f/stop')).toBe(true);
    expect($('nf2f-run-chip')).toBeNull();
    expect(w.SESSIONS.A.element.querySelector('.nf2f-live-dot')).toBeNull();
  });
});

describe('Allocate billing — the rest is shared by the clients not changed', () => {
  test('5 clients at 20%: one set to 40% → the other four 15% each', () => {
    const { w } = env();
    const rows = [1, 2, 3, 4, 5].map((i) => ({ clientId: String(i), percent: 20, locked: false }));
    rows[0].percent = 40; rows[0].locked = true;
    expect(w.Nf2f._redistribute(rows, 0)).toBe(100);
    expect(rows.map((r) => r.percent)).toEqual([40, 15, 15, 15, 15]);
  });
  test('a non-billable share comes off what the unset clients share', () => {
    const { w } = env();
    const rows = [1, 2, 3, 4, 5].map((i) => ({ clientId: String(i), percent: 20, locked: false }));
    rows[0].percent = 40; rows[0].locked = true;
    expect(w.Nf2f._redistribute(rows, 20)).toBe(100);
    expect(rows.map((r) => r.percent)).toEqual([40, 10, 10, 10, 10]);
  });
  test('three unset clients split evenly to the cent, adding to 100', () => {
    const { w } = env();
    const rows = [1, 2, 3, 4].map((i) => ({ clientId: String(i), percent: 25, locked: false }));
    rows[0].percent = 50; rows[0].locked = true;
    expect(w.Nf2f._redistribute(rows, 0)).toBe(100);
    expect(rows.map((r) => r.percent)).toEqual([50, 16.68, 16.66, 16.66]);
  });
});

test('the panel shows each client\'s share to the second (1:51 over 4 clients is not "0 min")', async () => {
  const { w, $, flush } = env();
  w.fetch = async () => ({ ok: true, status: 200, json: async () => ({
    timer: { status: 'STOPPED', elapsedSeconds: 111, limitSeconds: 3600 },
    allocation: { nonBillablePercent: 0, clients: [] },
    split: [{ clientId: '1', clientName: 'Al', percent: 25, seconds: 28 }, { clientId: '2', clientName: 'Bo', percent: 25, seconds: 28 },
      { clientId: '3', clientName: 'Cy', percent: 25, seconds: 28 }, { clientId: '4', clientName: 'Di', percent: 25, seconds: 27 }],
  }) });
  w.nf2fDecorateDetail({ dbId: 'db-1', booking: { group: 'nf2f', clients: [{ clientId: '1' }] } });
  await flush();
  const cells = Array.from($('nf2f-detail').querySelectorAll('.nf2f-split td:last-child')).map((td) => td.textContent);
  expect(cells).toEqual(['0:28', '0:28', '0:28', '0:27']);
});

describe('Allocate billing — typing', () => {
  function dialogEnv() {
    const e = env();
    e.w.fetch = async (url, o) => ({ ok: true, status: 200, json: async () => ({
      title: 'Case Management', timer: { status: 'STOPPED', elapsedSeconds: 600, limitSeconds: 3600 },
      allocation: { nonBillablePercent: 0, clients: ['1', '2', '3', '4'].map((id) => ({ clientId: id, clientName: 'C' + id, percent: 25 })) },
      split: [] }) });
    return e;
  }
  const type = (w, inp, text) => { inp.value = text; inp.dispatchEvent(new w.Event('input', { bubbles: true })); };

  test('two digits stay in the box; the other shares follow as you type', async () => {
    const { w, flush } = dialogEnv();
    w.Nf2f.openAllocate('db-1'); await flush();
    const box = w.document.querySelector('[data-row="0"]');
    type(w, box, '4');
    type(w, box, '40');
    expect(box.value).toBe('40');
    expect(Array.from(w.document.querySelectorAll('.nf2f-pct[data-row]')).map((i) => i.value)).toEqual(['40', '20', '20', '20']);
    expect(w.document.querySelector('.nf2f-total').textContent).toBe('Total 100%');
    expect(w.document.querySelector('[data-act="save"]').disabled).toBe(false);
  });

  test('any number can be typed; over 100% in a share or in total is a warning and Save waits', async () => {
    const { w, flush } = dialogEnv();
    w.Nf2f.openAllocate('db-1'); await flush();
    const a = w.document.querySelector('[data-row="0"]');
    type(w, a, '150');
    expect(a.value).toBe('150');
    expect(w.document.querySelector('.nf2f-total').textContent).toMatch(/a share cannot be over 100%/);
    expect(w.document.querySelector('[data-act="save"]').disabled).toBe(true);
    type(w, a, '70');
    const b = w.document.querySelector('[data-row="1"]');
    type(w, b, '50');
    expect(w.document.querySelector('.nf2f-total').textContent).toMatch(/Total 120% — over 100%/);
    expect(w.document.querySelector('[data-act="save"]').disabled).toBe(true);
    type(w, b, '10');
    expect(w.document.querySelector('.nf2f-total').textContent).toBe('Total 100%');
  });

  test('non-billable is greyed until ticked, then takes its share off the clients not changed', async () => {
    const { w, flush } = dialogEnv();
    w.Nf2f.openAllocate('db-1'); await flush();
    const nb = w.document.querySelector('[data-nb]');
    expect(nb.disabled).toBe(true);
    const tick = w.document.querySelector('[data-nb-on]');
    tick.checked = true; tick.dispatchEvent(new w.Event('change', { bubbles: true }));
    expect(nb.disabled).toBe(false);
    type(w, nb, '20');
    expect(Array.from(w.document.querySelectorAll('.nf2f-pct[data-row]')).map((i) => i.value)).toEqual(['20', '20', '20', '20']);
  });
});

