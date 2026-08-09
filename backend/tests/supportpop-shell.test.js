/**
 * Support popup — shell geometry (pure helpers, node).
 * Mirrors opa-shell.test.js: the floating Support window must never escape
 * the viewport, never shrink below usable dimensions (360x420), and default
 * to a sensible position clear of the Opa pebble.
 */

'use strict';

const { supClampRect, supDefaultRect, SUP_MIN_W, SUP_MIN_H } =
  require('../../frontend/current/supportpop.js');

const VP = { w: 1440, h: 900 };

describe('support popup clamping', () => {
  test('minimum size constants are the specified 360x420', () => {
    expect(SUP_MIN_W).toBe(360);
    expect(SUP_MIN_H).toBe(420);
  });

  test('a sane rect passes through unchanged', () => {
    const r = supClampRect({ x: 900, y: 200, w: 480, h: 620 }, VP);
    expect(r).toEqual({ x: 900, y: 200, w: 480, h: 620 });
  });

  test('cannot be dragged fully off the right edge', () => {
    const r = supClampRect({ x: 5000, y: 200, w: 480, h: 620 }, VP);
    expect(r.x).toBeLessThanOrEqual(VP.w - 68); // header corner stays reachable
  });

  test('cannot be dragged fully off the left edge', () => {
    const r = supClampRect({ x: -2000, y: 200, w: 480, h: 620 }, VP);
    expect(r.x + r.w).toBeGreaterThanOrEqual(60);
  });

  test('cannot be dragged above or below the viewport', () => {
    expect(supClampRect({ x: 100, y: -500, w: 480, h: 620 }, VP).y).toBe(8);
    expect(supClampRect({ x: 100, y: 5000, w: 480, h: 620 }, VP).y).toBeLessThanOrEqual(VP.h - 48);
  });

  test('enforces minimum usable size', () => {
    const r = supClampRect({ x: 100, y: 100, w: 50, h: 50 }, VP);
    expect(r.w).toBeGreaterThanOrEqual(360);
    expect(r.h).toBeGreaterThanOrEqual(420);
  });

  test('cannot outgrow the viewport', () => {
    const r = supClampRect({ x: 0, y: 0, w: 4000, h: 4000 }, VP);
    expect(r.w).toBeLessThanOrEqual(Math.floor(VP.w * 0.92));
    expect(r.h).toBeLessThanOrEqual(Math.floor(VP.h * 0.92));
  });

  test('shrunken browser window keeps a saved rect reachable', () => {
    const laptop = { w: 1280, h: 800 };
    const saved = { x: 1300, y: 850, w: 520, h: 700 };
    const r = supClampRect(saved, laptop);
    expect(r.x).toBeLessThanOrEqual(laptop.w - 68);
    expect(r.y).toBeLessThanOrEqual(laptop.h - 48);
  });
});

describe('support popup default position', () => {
  test('defaults inside the viewport with margins', () => {
    const r = supDefaultRect(VP);
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(VP.w);
    expect(r.y + r.h).toBeLessThanOrEqual(VP.h);
    expect(r.w).toBeLessThanOrEqual(480);
    expect(r.h).toBeLessThanOrEqual(620);
  });

  test('adapts to small viewports', () => {
    const small = { w: 800, h: 600 };
    const r = supDefaultRect(small);
    expect(r.w).toBeLessThanOrEqual(Math.floor(small.w * 0.9));
    expect(r.h).toBeLessThanOrEqual(Math.floor(small.h * 0.85));
    expect(r.x + r.w).toBeLessThanOrEqual(small.w);
    expect(r.y + r.h).toBeLessThanOrEqual(small.h);
  });

  test('default stays clear of the bottom-right Opa pebble corner', () => {
    const r = supDefaultRect(VP);
    // the pebble sits at right:22 bottom:22 (54px round button)
    expect(r.x + r.w).toBeLessThanOrEqual(VP.w - 80);
  });
});
