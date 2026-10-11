'use strict';

/**
 * Recurrence UI (frontend/current/recurrence.js, 11 Oct 2026): the Smart
 * Booking Repeat section, the "Make it repeat" dialog and Outlook's delete
 * choices, driven in jsdom with fetch stubbed.
 */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/recurrence.js'), 'utf8');

function env() {
  const dom = new JSDOM(`<div id="booking-side-panel" class="open">
      <button class="bsp-day-chip active" data-day="mon"></button><div id="bsp-repeat" hidden></div></div>
      <div id="bd-body"></div>`, { runScripts: 'outside-only' });
  const w = dom.window;
  const log = [];
  w.DAY_DATES = { mon: '2026-10-12', wed: '2026-10-14' };
  w.showToast = (...a) => log.push(['toast', ...a]);
  w.loadOutlookEventsToCalendar = () => log.push(['reload']);
  w.openBookingPanel = () => {};
  w.bspSelectDay = () => {};
  w.closeBookingPanel = () => {};
  w.fetch = async (url, o) => {
    const body = o && o.body ? JSON.parse(o.body) : null;
    log.push([o && o.method || 'GET', url, body]);
    const json = (x, status = 200) => ({ ok: status < 400, status, json: async () => x });
    if (url === '/api/recurrence/preview') return json({ summary: 'Occurs every week on Monday until 11 Dec 2026', count: 9, last: '7 Dec 2026', capped: false });
    if (/\/series$/.test(url) && o && o.method === 'POST') return json({ ok: true, summary: 'Occurs every week on Monday', created: [{ dbId: 'b', date: '2026-10-19', sploseQueued: true }], failed: [] }, 201);
    if (/\/series$/.test(url)) return json({ series: { id: 's1', summary: 'Occurs every week on Monday for 3 appointments' },
      events: [{ dbId: 'a', start: '2026-10-12T01:30:00Z', isThis: false }, { dbId: 'b', start: '2026-10-19T01:30:00Z', isThis: true }, { dbId: 'c', start: '2026-10-26T01:30:00Z', isThis: false }] });
    if (/\/api\/outlook\/events\//.test(url)) return json({ ok: true });
    return json({}, 404);
  };
  w.eval(SRC);
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { w, log, flush, $: (id) => w.document.getElementById(id) };
}
const change = (w, el, value) => { el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };

describe('Smart Booking › Repeat', () => {
  test('presets follow the chosen day; Doesn\'t repeat sends nothing', async () => {
    const { w, $, flush } = env();
    w.openBookingPanel({}); await new Promise((r) => setTimeout(r, 80));
    const sel = $('bsp-repeat').querySelector('.rec-preset');
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual([
      'Doesn’t repeat', 'Weekly on Monday', 'Fortnightly on Monday', 'Monthly on day 12', 'Monthly on the second Monday', 'Custom…']);
    expect(w.Recurrence.panelRule()).toBeNull();
    change(w, sel, 'fortnightly'); await flush();
    expect(w.Recurrence.panelRule()).toEqual({ freq: 'week', interval: 2, days: ['mon'], end: { type: 'date', until: '2026-12-12' } });
    expect($('bsp-repeat').querySelector('.rec-summary').textContent).toMatch(/Occurs every week on Monday until 11 Dec 2026 · 9 appointments, the last on 7 Dec 2026/);
  });

  test('Custom is Outlook\'s editor: every N weeks on chosen days, or after N appointments', async () => {
    const { w, $, flush } = env();
    w.openBookingPanel({}); await new Promise((r) => setTimeout(r, 80));
    const box = $('bsp-repeat');
    change(w, box.querySelector('.rec-preset'), 'custom'); await flush();
    change(w, box.querySelector('.rec-interval'), '3'); await flush();
    box.querySelector('[data-rec-day="thu"]').click(); await flush();
    const count = box.querySelector('.rec-count');
    change(w, count, '6'); await flush();
    expect(w.Recurrence.panelRule()).toEqual({ freq: 'week', interval: 3, days: ['mon', 'thu'], end: { type: 'count', count: 6 } });
    // The last weekday cannot be switched off — a week repeat needs a day.
    box.querySelector('[data-rec-day="thu"]').click(); box.querySelector('[data-rec-day="mon"]').click(); await flush();
    expect(w.Recurrence.panelRule().days).toEqual(['mon']);
    change(w, box.querySelector('.rec-unit'), 'month'); await flush();
    box.querySelector('input[value="weekday"]').click(); await flush();
    expect(w.Recurrence.panelRule()).toMatchObject({ freq: 'month', monthly: 'weekday' });
  });

  test('after Create appointment the repeats are booked by the server and the calendar reloads', async () => {
    const { w, log, flush } = env();
    await w.Recurrence.afterBooked('a', { freq: 'week', interval: 1, days: ['mon'], end: { type: 'count', count: 2 } });
    await flush();
    expect(log.find((l) => l[0] === 'POST' && l[1] === '/api/events/a/series')[2]).toEqual({ rule: { freq: 'week', interval: 1, days: ['mon'], end: { type: 'count', count: 2 } } });
    expect(log.some((l) => l[0] === 'reload')).toBe(true);
    expect(log.filter((l) => l[0] === 'toast').pop()[2]).toMatch(/2 appointments booked · 1 waiting for “Write to Splose”/);
  });
});

describe('the event panel and delete', () => {
  test('an appointment that does not repeat offers "Make it repeat…"; one in a series says where it sits', async () => {
    const { w, $, flush } = env();
    w.recurrenceDecorateDetail({ dbId: 'x', patient: 'Casey', startTimeIso: '2026-10-12T01:30:00Z' });
    expect($('rec-detail').textContent).toMatch(/Doesn’t repeat\..*Make it repeat…/);
    $('rec-detail').querySelector('[data-rec-open]').click();
    expect(w.document.querySelector('.rec-dialog .rec-preset').value).toBe('weekly');
    w.document.querySelector('[data-rec-cancel]').click();
    w.recurrenceDecorateDetail({ dbId: 'b', seriesId: 's1' }); await flush(); await flush();
    expect($('rec-detail').textContent).toMatch(/Occurs every week on Monday for 3 appointments.*Appointment 2 of 3/);
  });

  test('delete: Outlook\'s three choices; "this and following" deletes from this one on', async () => {
    const { w, log, flush } = env();
    const p = w.Recurrence.chooseDeleteScope('Casey');
    expect(Array.from(w.document.querySelectorAll('.rec-scope label')).map((l) => l.textContent.trim()))
      .toEqual(['This event', 'This and all following events', 'All events in the series']);
    w.document.querySelector('input[value="following"]').checked = true;
    w.document.querySelector('[data-act="ok"]').click();
    expect(await p).toBe('following');
    await w.Recurrence.deleteSeries({ dbId: 'b' }, 'following'); await flush();
    expect(log.filter((l) => l[0] === 'DELETE').map((l) => l[1])).toEqual(['/api/outlook/events/b', '/api/outlook/events/c']);
    log.length = 0;
    await w.Recurrence.deleteSeries({ dbId: 'b' }, 'all'); await flush();
    expect(log.filter((l) => l[0] === 'DELETE')).toHaveLength(3);
  });
});
