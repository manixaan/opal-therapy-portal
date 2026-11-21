/**
 * C-10: with the event drawer open, one click on another tile opens that
 * tile — the grid sits above the drawer's backdrop — and a press on empty
 * grid only closes the drawer, as the backdrop did.
 */
const fs = require('fs');
const path = require('path');

const HTML = fs.readFileSync(path.join(__dirname, '../../frontend/current/mockup_v3.html'), 'utf8');
function fnSrc(name) {
  const at = HTML.indexOf('function ' + name + '(');
  expect(at).toBeGreaterThan(-1);
  const rest = HTML.slice(at);
  return rest.slice(0, rest.indexOf('\n}\n') + 2);
}

test('the drawer marks the body while open', () => {
  expect(fnSrc('openBlockDetail')).toContain("document.body.classList.add('dd-open');");
  expect(fnSrc('closeBlockDetail')).toContain("document.body.classList.remove('dd-open');");
});
test('the grid is raised above the backdrop (1090) but below the drawer (1100); the move review above both', () => {
  expect(HTML).toContain('body.dd-open #cal-grid { position: relative; z-index: 1091; }');
  expect(HTML).toContain('body.dd-open #impact-modal    { z-index: 1201; }');
});
test('an empty-grid press closes the drawer and goes no further; a tile press goes through', () => {
  const at = HTML.indexOf('(function calGridDrawerGuard()');
  expect(at).toBeGreaterThan(-1);
  const g = HTML.slice(at, at + 600);
  expect(g).toContain("e.target.closest('.session, .travel-overlay')");
  expect(g).toContain('e.stopPropagation(); e.preventDefault();');
  expect(g).toContain('closeBlockDetail();');
  expect(g).toContain('}, true);');
});
