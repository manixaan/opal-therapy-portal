/**
 * Opa AI Phase 1 — shell geometry (pure helpers, node).
 * The panel must never escape the viewport, never shrink below usable
 * dimensions, and default to a sensible bottom-right position.
 */

'use strict';

const { opaClampRect, opaDefaultRect } = require('../../frontend/current/opa.js');

const VP = { w: 1440, h: 900 };

describe('opa panel clamping', () => {
  test('a sane rect passes through unchanged', () => {
    const r = opaClampRect({ x: 900, y: 200, w: 440, h: 640 }, VP);
    expect(r).toEqual({ x: 900, y: 200, w: 440, h: 640 });
  });

  test('cannot be dragged fully off the right edge', () => {
    const r = opaClampRect({ x: 5000, y: 200, w: 440, h: 640 }, VP);
    expect(r.x).toBeLessThanOrEqual(VP.w - 68); // header corner stays reachable
  });

  test('cannot be dragged fully off the left edge', () => {
    const r = opaClampRect({ x: -2000, y: 200, w: 440, h: 640 }, VP);
    expect(r.x + r.w).toBeGreaterThanOrEqual(60);
  });

  test('cannot be dragged above or below the viewport', () => {
    expect(opaClampRect({ x: 100, y: -500, w: 440, h: 640 }, VP).y).toBe(8);
    expect(opaClampRect({ x: 100, y: 5000, w: 440, h: 640 }, VP).y).toBeLessThanOrEqual(VP.h - 48);
  });

  test('enforces minimum usable size', () => {
    const r = opaClampRect({ x: 100, y: 100, w: 50, h: 50 }, VP);
    expect(r.w).toBeGreaterThanOrEqual(320);
    expect(r.h).toBeGreaterThanOrEqual(400);
  });

  test('cannot outgrow the viewport', () => {
    const r = opaClampRect({ x: 0, y: 0, w: 4000, h: 4000 }, VP);
    expect(r.w).toBeLessThanOrEqual(Math.floor(VP.w * 0.92));
    expect(r.h).toBeLessThanOrEqual(Math.floor(VP.h * 0.92));
  });

  test('shrunken browser window keeps a saved rect reachable', () => {
    const laptop = { w: 1280, h: 800 };
    const saved = { x: 1300, y: 850, w: 480, h: 700 };
    const r = opaClampRect(saved, laptop);
    expect(r.x).toBeLessThanOrEqual(laptop.w - 68);
    expect(r.y).toBeLessThanOrEqual(laptop.h - 48);
  });
});

describe('opa default position', () => {
  test('defaults to bottom-right with margins', () => {
    const r = opaDefaultRect(VP);
    expect(r.x + r.w).toBeLessThanOrEqual(VP.w);
    expect(r.y + r.h).toBeLessThanOrEqual(VP.h);
    expect(r.w).toBeLessThanOrEqual(448);
    expect(r.h).toBeLessThanOrEqual(640);
  });

  test('adapts to small viewports', () => {
    const small = { w: 800, h: 600 };
    const r = opaDefaultRect(small);
    expect(r.w).toBeLessThanOrEqual(Math.floor(small.w * 0.9));
    expect(r.h).toBeLessThanOrEqual(Math.floor(small.h * 0.85));
  });
});
