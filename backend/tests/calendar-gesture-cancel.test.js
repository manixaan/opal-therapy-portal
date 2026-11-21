/**
 * C-09: one cancel path for every calendar gesture — tile drag, edge resize
 * and drag-to-create — bound to pointercancel on all three and to Escape.
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

describe('cancelActiveGesture', () => {
  const src = fnSrc('cancelActiveGesture');
  test('a live tile drag goes back and its state resets', () => {
    expect(src).toContain('if (drag && drag.live) {');
    expect(src).toContain('revertDragVisuals();');
    expect(src).toContain('_dragRevertGroup(drag);');
  });
  test('a resize restores the tile, removes the tip and ends the travel preview', () => {
    expect(src).toContain("r.el.classList.remove('resizing');");
    expect(src).toContain('r.tip.parentElement.removeChild(r.tip)');
    expect(src).toContain('endTravelPreview(true)');
  });
  test('a drag-to-create removes the ghost and stops creating', () => {
    expect(src).toContain('dragState.block.remove()');
    expect(src).toContain('dragState.isCreating = false;');
    expect(src).toContain('_calDragPending = null;');
  });
  test('wired to pointercancel on all three and to Escape', () => {
    expect(fnSrc('onBlockPointerCancel')).toContain('cancelActiveGesture();');
    expect(HTML).toContain("col.addEventListener('pointercancel', () => cancelActiveGesture());");
    expect(fnSrc('onBlockResizeStart')).toContain("window.addEventListener('pointercancel', onBlockPointerCancel, { once: true });");
    expect(HTML).toContain("if (e.key === 'Escape' && cancelActiveGesture()) { e.preventDefault(); e.stopPropagation(); }");
  });
  test('a drag whose pointer is up (move review open) is not cancelled by Escape', () => {
    expect(fnSrc('onBlockPointerUp')).toContain('drag.live = false;');
  });
});
