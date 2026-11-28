/**
 * One wording for every travel leg (28 Nov 2026): "Travel 8 min → Harrisdale".
 * Legs used to open with Start / End / Home / From home / To <place>, and the
 * booking previews read "8 min · A → B". A drive ending at the base names the
 * base ("Home"), not its suburb.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '../../frontend/current/travel.js'), 'utf8');
function fnSrc(name) {
  const at = SRC.indexOf('function ' + name + '(');
  expect(at).toBeGreaterThan(-1);
  const rest = SRC.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}
const api = new Function(`
  function _tpEsc(s) { return String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'); }
  ${fnSrc('_legLabelHtml')}
  ${fnSrc('_legDestName')}
  ${fnSrc('_legPlaceWord')}
  ${fnSrc('_legClientName')}
  ${fnSrc('_fitLegText')}
  return { label: _legLabelHtml, dest: _legDestName, fit: _fitLegText };
`)();
const text = (html) => html.replace(/<[^>]+>/g, '');

describe('travel leg wording', () => {
  test('every leg reads Travel, minutes, then where to', () => {
    expect(text(api.label(8, 'Harrisdale'))).toBe('Travel8 min → Harrisdale');
    expect(api.label(8, 'Harrisdale')).toContain('<span class="t-min">8 min</span>');
    expect(api.label(8, 'Harrisdale')).toContain('<span class="t-dest"> → Harrisdale</span>');
  });
  test('only the Tight warning replaces the word', () => {
    expect(text(api.label(12, 'Atwell', 'Tight'))).toBe('Tight12 min → Atwell');
  });
  test('the place is escaped', () => {
    expect(api.label(5, '<b>x</b>')).not.toContain('<b>');
  });
  test('a drive to the base names the base, not its suburb', () => {
    const home = { label: 'Home', suburb: 'Como' };
    expect(api.dest({ kind: 'end', toLoc: home })).toBe('Home');
    expect(api.dest({ kind: 'between', via: 'home-return', toLoc: home })).toBe('Home');
    expect(api.dest({ kind: 'between', via: 'place-in', toLoc: { label: 'Office', suburb: 'Perth' } })).toBe('Office');
  });
  test('a drive to a client names the suburb', () => {
    expect(api.dest({ kind: 'start', toLoc: { label: 'Evana Samuel', suburb: 'Harrisdale' } })).toBe('Harrisdale');
    expect(api.dest({ kind: 'between', via: 'direct', toLoc: { suburb: 'Atwell' } })).toBe('Atwell');
  });
  test('a street with no suburb is never the place word: the client is named instead', () => {
    expect(api.dest({ kind: 'between', via: 'direct', toLoc: { suburb: '6 Elbert Way', label: 'Julie Pitham · 6 Elbert Way' } })).toBe('Julie Pitham');
    expect(api.dest({ kind: 'between', via: 'direct', toLoc: { suburb: null, label: 'Julie Pitham (Haynes)' } })).toBe('Julie Pitham');
    expect(api.dest({ kind: 'between', via: 'direct', toLoc: { suburb: '6 Elbert Way', label: '6 Elbert Way' } })).toBe('next stop');
  });
  test('a tall leg wraps before it drops a word; a short one drops as before', () => {
    const leg = (clientHeight, fitsWrapped) => {
      const cls = new Set();
      const el = { clientWidth: 100, clientHeight, classList: { add: (c) => cls.add(c) },
        get scrollWidth() { return cls.has('t-wrap') && fitsWrapped ? 100 : 160; },
        get scrollHeight() { return clientHeight; } };
      api.fit(el);
      return [...cls];
    };
    expect(leg(40, true)).toEqual(['t-wrap']);
    expect(leg(16, true)).toEqual(['t-no-ico', 't-no-dest', 't-no-switch']);
  });
  test('no leg uses the old per-kind words or the "min · A → B" form', () => {
    expect(SRC).not.toMatch(/seg\.kind === 'start' \? 'Start' : seg\.kind === 'end' \? 'End'/);
    expect(SRC).not.toMatch(/<span class="t-ico">Home<\/span>/);
    expect(SRC).not.toMatch(/' min · ' \+ esc\(/);
  });
});
