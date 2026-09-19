'use strict';
/** Opal Assist page — the pure token helpers the page renders with. */
const { splitTokens, restoreTokens } = require('../../frontend/current/assist.js');

test('splitTokens separates prose from tokens', () => {
  expect(splitTokens('Hi [CLIENT_1], ring [PHONE_1].')).toEqual([
    { text: 'Hi ' }, { token: 'CLIENT_1' }, { text: ', ring ' }, { token: 'PHONE_1' }, { text: '.' },
  ]);
});
test('restoreTokens puts names back and leaves unknown tokens bracketed', () => {
  expect(restoreTokens('Hi [CLIENT_1], see [CLIENT_2].', { CLIENT_1: 'Aiden Blackwood-Tan' })).toBe('Hi Aiden Blackwood-Tan, see [CLIENT_2].');
});

describe('Word document tools', () => {
  const fs = require('fs'); const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist-word-format.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../frontend/current/assist.html'), 'utf8');

  test('formatting is code, never a network call: the file cannot send the document anywhere', () => {
    expect(src).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|\/api\//);
  });
  test('loaded only inside Word', () => {
    expect(page).toMatch(/if \(sf === 'word'\) document\.write\('<script src="\/assist-word-format\.js\?v=\d+">/);
    expect(src).toMatch(/get\('surface'\) !== 'word'\) return;/);
  });
  test('the standard carries Opal colours on the reference structure', () => {
    expect(src).toContain("primary: '#2F5651'");
    expect(src).toMatch(/'Heading 1':\s+\[14, true,\s+'primary', 18, 12, true\]/);
    expect(src).toContain("font: 'Arial'");
  });
  test('no invisible control characters hide in the source', () => {
    const bad = [...src].filter((ch) => { const c = ch.charCodeAt(0); return (c < 32 && c !== 10 && c !== 9 && c !== 13) || c === 160; });
    expect(bad).toEqual([]);
  });
});
