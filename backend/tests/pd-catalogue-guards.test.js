'use strict';

/**
 * Guards for the professional development catalogue, event detail and home
 * preview redesign.
 *
 * Two kinds of assertion:
 *   - Route grammar, exercised against navigation.js's real exported functions.
 *   - Static guards that parse the shipped resourcehub.js/.css, because the
 *     module is an IIFE with no test seam and these are contracts a future edit
 *     could quietly break.
 */

const fs = require('fs');
const path = require('path');

const {
  encodeRoute, decodeRoute, normaliseRoute,
} = require('../../frontend/current/navigation.js');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.css'), 'utf8');
const NAV = fs.readFileSync(path.join(FRONTEND, 'navigation.js'), 'utf8');

/**
 * Comment-stripped view. The prose in this codebase legitimately mentions the
 * very strings some guards forbid, so assertions run against code only.
 */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const JS_CODE = codeOnly(JS);
/** CSS comments explain the very tokens some guards forbid — strip them too. */
const CSS_CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

// ── Route grammar ───────────────────────────────────────────────────────────

describe('professional development is a real route', () => {
  test.each([
    '#resources/pd',
    '#resources/pd/evt-123',
    '#resources/instruments',
  ])('%s round-trips unchanged', (hash) => {
    expect(encodeRoute(decodeRoute(hash))).toBe(hash);
  });

  test('the catalogue no longer collapses to the hub home page', () => {
    // The defect this replaces: 'pd' was absent from RH_VIEWS, so every
    // professional development address normalised to '#resources'.
    expect(encodeRoute(decodeRoute('#resources/pd'))).not.toBe('#resources');
    expect(decodeRoute('#resources/pd').view).toBe('pd');
  });

  test('an event id survives decoding', () => {
    const r = decodeRoute('#resources/pd/14954374-e7ce-46de-b41f-ae41736c7f2f');
    expect(r.tab).toBe('resources');
    expect(r.view).toBe('pd');
    expect(r.id).toBe('14954374-e7ce-46de-b41f-ae41736c7f2f');
  });

  test('an idless pd address degrades to the catalogue, not to the library', () => {
    // '#resources/detail/' has no meaning without an id and falls back to the
    // library. '#resources/pd/' DOES have a meaning — it is the catalogue.
    expect(encodeRoute(decodeRoute('#resources/pd/'))).toBe('#resources/pd');
    expect(decodeRoute('#resources/pd/').view).toBe('pd');
    expect(encodeRoute(decodeRoute('#resources/detail/'))).toBe('#resources/library');
  });

  test('a hostile pd id is sanitised like any other', () => {
    const r = normaliseRoute({ tab: 'resources', view: 'pd', id: 'a/b!c#d e' });
    expect(r.id).not.toMatch(/[#!/\s]/);
  });

  test('an over-long pd id is capped', () => {
    const r = normaliseRoute({ tab: 'resources', view: 'pd', id: 'x'.repeat(400) });
    expect(r.id.length).toBeLessThanOrEqual(120);
  });

  test('unknown resources views still degrade to home', () => {
    expect(encodeRoute(decodeRoute('#resources/wibble'))).toBe('#resources');
  });

  test('opening an event is tracked in history', () => {
    // Without this hook the event page had no address at all: Back skipped
    // past it and it could not be linked to.
    expect(NAV).toMatch(/hookMethod\('RH2',\s*'openPd'/);
  });

  test('no hook is installed against a method nothing calls', () => {
    // closePdDetail existed only for the removed back control. A hook on a
    // method with no caller is dead code that reads as live wiring.
    expect(NAV).not.toMatch(/closePdDetail/);
    expect(JS_CODE).not.toMatch(/closePdDetail/);
  });

  test('a view change moves focus to the new heading', () => {
    // render() replaces the hub's whole DOM, dropping focus to <body>. A
    // keyboard user was left with no announcement and no position.
    expect(JS_CODE).toMatch(/function focusHeading/);
    expect(JS_CODE).toMatch(/focusHeading\('\.rh2-pdd-title/);
    expect(JS_CODE).toMatch(/setAttribute\('tabindex', '-1'\)/);
  });

  test('a deep-linked event is restored on cold load', () => {
    expect(NAV).toMatch(/t\.view === 'pd' && t\.id && isFn\(global\.RH2\.openPd\)/);
  });
});

// ── Event detail ────────────────────────────────────────────────────────────

describe('event detail navigation', () => {
  test('the standalone back control is gone', () => {
    expect(JS_CODE).not.toMatch(/Back to professional development/);
  });

  test('the persistent hub nav still offers professional development', () => {
    // The hub nav is data-driven, so the guard pins the nav ITEM rather than a
    // literal nav('pd') call — there is no such call in the source.
    expect(JS_CODE).toMatch(/items\.push\(\['pd', 'Professional development'\]\)/);
  });

  test("selecting it clears any open event so the catalogue is never a stale detail", () => {
    expect(JS_CODE).toMatch(/if \(view === 'pd'\) \{ S\.pd\.openId = null;/);
  });
});

describe('booking is one external action', () => {
  test('exactly one primary booking control is emitted', () => {
    const detail = JS_CODE.slice(JS_CODE.indexOf('function renderPdDetail'));
    const body = detail.slice(0, detail.indexOf('\n  function ', 10));
    expect((body.match(/rh2-btn-primary/g) || []).length).toBe(1);
  });

  test('the call to action names the destination and the new tab', () => {
    expect(JS_CODE).toContain('View and book on provider website');
    expect(JS_CODE).toMatch(/\(opens in a new tab\)/);
  });

  test('every outward link is safe', () => {
    const detail = JS_CODE.slice(JS_CODE.indexOf('function renderPdDetail'));
    const body = detail.slice(0, detail.indexOf('\n  function ', 10));
    const anchors = body.match(/<a class="[^"]*"[^>]*/g) || [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a).toContain("target=\"_blank\"");
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  test('the decorative icon is hidden from assistive technology', () => {
    expect(JS_CODE).toMatch(/EXTERNAL_ICON[\s\S]{0,400}aria-hidden="true"/);
  });

  test('nothing claims Opal takes the booking', () => {
    const detail = JS_CODE.slice(JS_CODE.indexOf('function renderPdDetail'));
    const body = detail.slice(0, detail.indexOf('\n  function ', 10));
    expect(body).toMatch(/Booking is completed on the provider/);
    expect(body).not.toMatch(/Book now|Register here|Reserve your (place|seat)/i);
  });
});

// ── Row structure ───────────────────────────────────────────────────────────

describe('catalogue and home rows are structured, not run together', () => {
  test('date and time are separate elements in both surfaces', () => {
    expect(JS_CODE).toMatch(/rh2-pdc-date[\s\S]{0,200}rh2-pdc-time/);
    expect(JS_CODE).toMatch(/rh2-pdp-date[\s\S]{0,200}rh2-pdp-time/);
  });

  test('fmtDateParts keeps an unparseable value rather than dropping it', () => {
    expect(JS_CODE).toMatch(/function fmtDateParts/);
    expect(JS_CODE).toMatch(/return \{ date: String\(v\), time: '' \}/);
  });

  test('every row is a real button, so it is keyboard reachable', () => {
    expect(JS_CODE).toMatch(/<button type="button" class="rh2-pdc-row"/);
    expect(JS_CODE).toMatch(/<button type="button" class="rh2-pdp-row"/);
  });

  test('the accessible name carries what the layout conveys', () => {
    // The visual date/time block is aria-hidden, so the label must restate it —
    // otherwise a screen-reader user loses when the event is.
    expect(JS_CODE).toMatch(/function whenLabel/);
    const home = JS_CODE.slice(JS_CODE.indexOf('rh2-pdp-list'));
    expect(home.slice(0, 1400)).toMatch(/aria-label="' \+ esc\(label\)/);
    expect(JS_CODE).toMatch(/rh2-pdp-when" aria-hidden="true"/);
    expect(JS_CODE).toMatch(/rh2-pdc-when" aria-hidden="true"/);
  });

  test('the home preview keeps its heading link and see-all action', () => {
    expect(JS_CODE).toContain('Upcoming professional development');
    expect(JS_CODE).toContain('See all professional development');
  });

  test('optional fields are omitted rather than rendered empty', () => {
    expect(JS_CODE).toMatch(/e\.provider \? '<span class="rh2-pdc-provider">/);
    expect(JS_CODE).toMatch(/bits\.length \? '<span class="rh2-pdc-meta">/);
  });

  test('every interpolated value is escaped', () => {
    const card = JS_CODE.slice(JS_CODE.indexOf('function renderPdCard'));
    const body = card.slice(0, card.indexOf('\n  function ', 10));
    // No raw ' + value + ' interpolation into markup without esc().
    const raw = body.match(/\+ (?!esc\()[a-zA-Z][\w.]*\s*\+/g) || [];
    expect(raw).toEqual([]);
  });
});

// ── Styling contracts ───────────────────────────────────────────────────────

describe('styling', () => {
  test('PD borders no longer depend on an undefined custom property', () => {
    // var(--line) is defined nowhere in the portal. With no fallback the whole
    // declaration is invalid at computed-value time and NO border renders,
    // which is why the catalogue looked like a plain borderless list.
    const pdRules = CSS_CODE.split('}')
      .filter((r) => /\.rh2-pd[cpd]?[-\s]/.test(r)).join('}');
    expect(pdRules).not.toMatch(/var\(--line\)/);
    expect(CSS_CODE).toMatch(/\.rh2-pdc-item \{[^}]*border: 1px solid var\(--border\)/);
  });

  test('the date column is a fixed width so titles line up row to row', () => {
    // Fixed, but expressed in em so it scales with the reader's text size.
    // max-content would size each row to its own date and the titles would
    // start at a different x-position on every line.
    expect(CSS_CODE).toMatch(/\.rh2-pdp-row \{[\s\S]{0,220}grid-template-columns: 7em minmax\(0, 1fr\)/);
    expect(CSS_CODE).toMatch(/\.rh2-pdc-row \{[\s\S]{0,220}grid-template-columns: 7\.5em minmax\(0, 1fr\)/);
  });

  test('rows carry a distinct hover and a visible focus ring', () => {
    expect(CSS).toMatch(/\.rh2-pdc-row:hover/);
    expect(CSS).toMatch(/\.rh2-pdc-row:focus-visible \{ outline: 2px solid var\(--accent\)/);
    expect(CSS).toMatch(/\.rh2-pdp-row:focus-visible \{ outline: 2px solid var\(--accent\)/);
  });

  test('entries are separated', () => {
    expect(CSS).toMatch(/\.rh2-pdp-item \+ \.rh2-pdp-item \{ border-top: 1px solid/);
  });

  test('narrow screens stack the date above the title', () => {
    // The catalogue row is full width, so the viewport is the right signal.
    const mq = CSS_CODE.slice(CSS_CODE.indexOf('@media (max-width: 560px)'));
    expect(mq).toMatch(/\.rh2-pdc-row \{ grid-template-columns: minmax\(0, 1fr\)/);
    // The home preview row is NOT full width, so it stacks on its container.
    const cq = CSS_CODE.slice(CSS_CODE.indexOf('@container pdpreview'));
    expect(cq).toMatch(/\.rh2-pdp-row \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  test('wide screens move the booking panel into a right column', () => {
    const mq = CSS.slice(CSS.indexOf('@media (min-width: 860px)'));
    expect(mq).toMatch(/grid-template-areas: "head action" "body action"/);
  });

  test('long unbroken titles wrap instead of widening the grid', () => {
    expect(CSS).toMatch(/\.rh2-pdp-main, \.rh2-pdc-main \{[^}]*min-width: 0/);
    expect(CSS).toMatch(/\.rh2-pdp-title, \.rh2-pdc-title \{ overflow-wrap: anywhere/);
  });

  test('the article header does not inherit the shell sticky bar', () => {
    // Bare <header> is styled globally as a sticky page bar with
    // align-items:center, which centred the title and painted a stray card.
    expect(CSS).toMatch(/\.rh2-pdd-head \{[\s\S]{0,220}position: static/);
    expect(CSS).toMatch(/\.rh2-pdd-head \{[\s\S]{0,220}align-items: stretch/);
  });

  test('the button-styled link is not underlined', () => {
    expect(CSS).toMatch(/\.rh2-pdd-cta \{[^}]*text-decoration: none/);
  });

  test('the learning page keeps the older row styles it still uses', () => {
    expect(JS_CODE).toMatch(/class="rh2-pd-row"/);
    expect(CSS).toMatch(/\.rh2-pd-row \{/);
    expect(CSS).toMatch(/\.rh2-pd-date \{/);
  });
});

describe('review fixes', () => {
  test('the region name is taken from plain heading text, not the whole h2', () => {
    // Naming the landmark from the h2 subtree swallowed the button's
    // visually-hidden hint, so the region announced as
    // "Upcoming professional development — open the professional development page".
    expect(JS_CODE).toMatch(/<span id="rh2-h-pd">Upcoming professional development<\/span>/);
    expect(JS_CODE).not.toMatch(/<h2 id="rh2-h-pd"/);
  });

  test('the detail record panel keeps a surface of its own', () => {
    // Outside a card it inherited the page colour and vanished.
    expect(CSS_CODE).toMatch(/\.rh2-pdd \.rh2-info \{[^}]*background: var\(--panel\)/);
  });

  test('the home preview stacks on its container, not the viewport', () => {
    // The card is narrowest just ABOVE the 760px grid breakpoint, so a
    // viewport-keyed rule made a tablet worse than a phone.
    expect(CSS_CODE).toMatch(/\.rh2-pd-preview \{[^}]*container-type: inline-size/);
    expect(CSS_CODE).toMatch(/@container pdpreview \(max-width: 420px\)/);
  });

  test('date columns scale with text size', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pdp-row \{[\s\S]{0,200}grid-template-columns: 7em/);
    expect(CSS_CODE).toMatch(/\.rh2-pdc-row \{[\s\S]{0,200}grid-template-columns: 7\.5em/);
  });

  test('CPD hours is a distinct third tier, not just a quieter colour', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pdp-cpd \{ font-size: 11\.5px/);
  });

  test('secondary metadata wraps unbroken strings', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pdp-sub \{[^}]*overflow-wrap: anywhere/);
    expect(CSS_CODE).toMatch(/\.rh2-pdc-provider \{[^}]*overflow-wrap: anywhere/);
    expect(CSS_CODE).toMatch(/\.rh2-pdp-date, \.rh2-pdc-date \{ overflow-wrap: anywhere/);
  });

  test('the heading button focus ring uses a defined token', () => {
    expect(CSS_CODE).toMatch(/\.rh2-heading-btn:focus-visible \{ outline: 2px solid var\(--accent\)/);
  });

  test('the secondary listing link keeps a link affordance', () => {
    expect(CSS_CODE).toMatch(/\.rh2-pdd-alt \{[^}]*text-decoration: none/);
    expect(CSS_CODE).toMatch(/\.rh2-pdd-alt:hover[^{]*\{ text-decoration: underline/);
  });
});
