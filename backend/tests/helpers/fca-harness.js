'use strict';

/**
 * A MOUNTED FCA WIZARD, for behavioural tests.
 *
 * fca.js is a browser IIFE with no module boundary, so the only way to assert
 * what it actually does — rather than what its source looks like — is to give
 * it a document, a fetch and a clock, and then drive it the way a therapist
 * would. That is what this is: the real file, in a real DOM, with the network
 * replaced by synthetic FCA data.
 *
 * What is faked, and only this:
 *   - fetch: the FCA API and the preview endpoint (no server, no participant)
 *   - docx.renderAsync: builds a page stack of the requested size, so page
 *     geometry can be asserted without the vendored renderer (a separate suite,
 *     fca-preview-pages.test.js, runs the REAL renderer over a REAL document)
 *   - element geometry: jsdom performs no layout, so offsetWidth/offsetHeight/
 *     clientWidth are backed by values the test sets
 *
 * Everything else — the wizard, its state, its event handlers, its DOM — is the
 * shipped file.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const FCA_JS = path.join(__dirname, '..', '..', '..', 'frontend', 'current', 'fca.js');

/** Deterministic synthetic sections — no client data, no real template. */
const TEMPLATE_SECTIONS = [
  { tag: 'SEC_PARTICIPANT', label: 'Participant Details', group: 'required', required: true, defaultSelected: true, defaultOrder: 0, description: 'Identity block.' },
  { tag: 'SEC_REFERRAL', label: 'Referral Information', group: 'required', required: true, defaultSelected: true, defaultOrder: 1, description: 'Why the referral was made.' },
  { tag: 'SEC_MOBILITY', label: 'Mobility', group: 'domains', required: false, defaultSelected: true, defaultOrder: 2, description: 'Moving around.' },
  { tag: 'SEC_COGNITION', label: 'Cognition', group: 'domains', required: false, defaultSelected: true, defaultOrder: 3, description: 'Thinking and memory.' },
  { tag: 'SEC_COMMUNICATION', label: 'Communication', group: 'domains', required: false, defaultSelected: false, defaultOrder: 4, description: 'Understanding and being understood.' },
  { tag: 'SEC_APPENDIX', label: 'Appendices', group: 'appendices', required: false, defaultSelected: false, defaultOrder: 5, description: 'Score sheets.' },
];

function manifestFor(selected, order) {
  const chosen = order.filter((t) => selected.indexOf(t) !== -1)
    .concat(order.filter((t) => selected.indexOf(t) === -1));
  return {
    sections: chosen.map((tag, i) => {
      const meta = TEMPLATE_SECTIONS.filter((s) => s.tag === tag)[0];
      return {
        tag,
        title: meta ? meta.label : tag,
        kind: meta && meta.required ? 'required' : 'optional',
        group: meta ? meta.group : 'other',
        included: selected.indexOf(tag) !== -1,
        order: i,
      };
    }),
    scalarData: { OPAL_CLIENT_FULL_NAME: 'Synthetic Participant', OPAL_THERAPIST_FULL_NAME: 'Synthetic Therapist' },
    scalarSources: { OPAL_CLIENT_FULL_NAME: 'splose', OPAL_THERAPIST_FULL_NAME: 'splose' },
    excludedTags: [],
  };
}

function draftFor(state) {
  return {
    id: 'draft-synthetic-1',
    clientId: 'client-synthetic-1',
    clientName: 'Synthetic Participant',
    clientPreferredName: 'Syn',
    therapistName: 'Synthetic Therapist',
    therapistProfileId: 'therapist-synthetic-1',
    templateVersion: 'v1',
    status: 'draft',
    selectedSections: state.selected.slice(),
    sectionOrder: state.order.slice(),
    customSections: [],
    excludedFields: [],
    missingFields: [],
    manifest: manifestFor(state.selected, state.order),
  };
}

/**
 * @param {object} [opts]
 * @param {number} [opts.pages=3]        pages the fake renderer produces
 * @param {number} [opts.stageWidth=520] measured stage width in px
 * @param {number} [opts.pageWidth=816]  measured page width in px (8.5in @96dpi)
 * @param {number} [opts.pageHeight=1056] measured page height in px (11in)
 */
function mountFca(opts) {
  const o = opts || {};
  const dom = new JSDOM(
    '<!doctype html><html><body>'
    + '<div id="rh2-root" data-view="library" data-collection="templates"></div>'
    + '<div id="fca-hub-entry" hidden></div>'
    + '<div id="fca-root" hidden></div>'
    + '</body></html>',
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://opal.test/' }
  );
  const win = dom.window;

  // ── geometry ────────────────────────────────────────────────────────────
  // jsdom lays nothing out. Elements carry the numbers a browser would report,
  // set by the fake renderer and by the harness.
  const geom = {
    stageWidth: o.stageWidth === undefined ? 520 : o.stageWidth,
    pageWidth: o.pageWidth === undefined ? 816 : o.pageWidth,
    pageHeight: o.pageHeight === undefined ? 1056 : o.pageHeight,
    gap: o.gap === undefined ? 18 : o.gap,
  };
  function defineGeom(name, fn) {
    Object.defineProperty(win.HTMLElement.prototype, name, { configurable: true, get: fn });
  }
  defineGeom('offsetWidth', function () {
    if (this.__w !== undefined) return this.__w;
    if (this.id === 'fca-preview-stage') return geom.stageWidth;
    return 0;
  });
  defineGeom('offsetHeight', function () { return this.__h === undefined ? 0 : this.__h; });
  defineGeom('offsetTop', function () { return this.__top === undefined ? 0 : this.__top; });
  Object.defineProperty(win.HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return this.id === 'fca-preview-stage' ? geom.stageWidth : (this.__w === undefined ? 0 : this.__w); },
  });

  const controls = {
    patchFails: false,
    generateFails: false,
    previewFails: false,
    holdPreview: null,      // set to a function to defer preview responses
    pageTitles: null,       // per-page opening text, as a real render has
    generated: 0,
  };

  // ── the fake docx renderer ──────────────────────────────────────────────
  // Builds the same shape the vendored library builds: a wrapper div with one
  // <section> per page, each carrying the document's real page dimensions.
  const renders = [];
  win.JSZip = {};
  win.docx = {
    renderAsync(buf, container) {
      const call = { pages: renders.pageCount === undefined ? (o.pages === undefined ? 3 : o.pages) : renders.pageCount };
      renders.push(call);
      const wrapper = win.document.createElement('div');
      wrapper.className = 'fca-docx-render-wrapper';
      let top = 0;
      for (let i = 0; i < call.pages; i += 1) {
        const page = win.document.createElement('section');
        page.className = 'fca-docx-render';
        page.setAttribute('data-page', String(i + 1));
        page.style.width = geom.pageWidth + 'px';
        page.style.minHeight = geom.pageHeight + 'px';
        page.__w = geom.pageWidth;
        page.__h = geom.pageHeight;
        page.__top = top;
        // Real pages start with the section heading the break was put there
        // for; controls.pageTitles lets a test reproduce that.
        page.textContent = (controls.pageTitles && controls.pageTitles[i])
          ? controls.pageTitles[i]
          : 'Page ' + (i + 1);
        wrapper.appendChild(page);
        top += geom.pageHeight + geom.gap;
      }
      wrapper.__w = geom.pageWidth;
      wrapper.__h = call.pages * geom.pageHeight + Math.max(0, call.pages - 1) * geom.gap;
      container.innerHTML = '';
      container.appendChild(wrapper);
      return Promise.resolve();
    },
  };

  // ── the network ─────────────────────────────────────────────────────────
  const state = {
    selected: ['SEC_PARTICIPANT', 'SEC_REFERRAL', 'SEC_MOBILITY', 'SEC_COGNITION'],
    order: TEMPLATE_SECTIONS.map((s) => s.tag),
  };
  const calls = [];

  function json(body) {
    return Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve(body),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }

  win.fetch = function (url, init) {
    const method = (init && init.method) || 'GET';
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), method, body });

    if (String(url).indexOf('/preview.docx') !== -1) {
      if (controls.previewFails) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      const deliver = () => Promise.resolve({
        ok: true, status: 200,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(64)),
        json: () => Promise.resolve({}),
      });
      if (controls.holdPreview) {
        const held = controls.holdPreview(deliver, String(url));
        const signal = init && init.signal;
        if (!signal) return held;
        // A real fetch rejects when its signal aborts; a held one must too, or
        // the timeout path could never be observed.
        return Promise.race([held, new Promise((resolve, reject) => {
          const fail = () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          };
          if (signal.aborted) fail();
          else signal.addEventListener('abort', fail);
        })]);
      }
      return deliver();
    }
    if (/\/drafts\/[^/]+$/.test(String(url)) && method === 'PATCH') {
      if (controls.patchFails) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'save_failed' }) });
      }
      if (body && body.selectedSections) state.selected = body.selectedSections.slice();
      if (body && body.sectionOrder) state.order = body.sectionOrder.slice();
      return json({ draft: draftFor(state) });
    }
    if (/\/drafts\/[^/]+$/.test(String(url)) && method === 'GET') return json({ draft: draftFor(state) });
    if (/\/generate$/.test(String(url))) {
      if (controls.generateFails) return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: 'generation_failed' }) });
      controls.generated += 1;
      return json({
        documentId: 'doc-synthetic-' + controls.generated,
        filename: 'FCA - Synthetic Participant.docx',
        missingFields: [], excludedFields: [], warnings: [],
      });
    }
    if (/\/template$/.test(String(url))) {
      return json({ template: { sections: TEMPLATE_SECTIONS, profileEligibleTags: [] } });
    }
    if (/\/presets/.test(String(url))) return json({ presets: [] });
    if (/\/drafts$/.test(String(url))) return json({ drafts: [] });
    if (/\/therapists$/.test(String(url))) return json({ profiles: [] });
    return json({});
  };

  win.APP_USER = { displayName: 'Synthetic Therapist', therapistProfileId: 'therapist-synthetic-1', role: 'therapist' };
  win.OP_ICONS = { doc: '', trash: '', lock: '', grip: '', check: '', alert: '', info: '', plus: '', x: '', edit: '', search: '', user: '', refresh: '' };
  win.opIcon = () => '<svg></svg>';
  const observers = [];
  win.ResizeObserver = function (cb) {
    const self = this;
    self.cb = cb;
    self.live = false;
    self.observe = function () { self.live = true; observers.push(self); };
    self.disconnect = function () { self.live = false; };
  };
  // rAF must be a real deferral so post-mount scheduling can be observed.
  const frames = [];
  win.requestAnimationFrame = function (fn) { frames.push(fn); return frames.length; };

  // Time runs 100× faster inside the wizard. Every delay is divided by the same
  // factor, so the debounce still coalesces and a 600ms edit delay still fires
  // before an 800ms one — the ORDER, which is what the tests are about, is
  // exactly the shipped order.
  const scale = o.timeScale === undefined ? 100 : o.timeScale;
  const realSetTimeout = win.setTimeout;
  win.setTimeout = function (fn, ms) {
    const wait = typeof ms === 'number' && ms > 0 ? Math.ceil(ms / scale) : ms;
    return realSetTimeout.call(win, fn, wait);
  };

  win.eval(fs.readFileSync(FCA_JS, 'utf8'));

  const api = {
    window: win,
    document: win.document,
    FCA: win.FCA,
    state: win.FCA._state,
    helpers: win.FCA._helpers,
    calls,
    controls,
    renders,
    geom,
    server: state,
    TEMPLATE_SECTIONS,

    /** Run every pending animation frame callback. */
    flushFrames() {
      const pending = frames.splice(0, frames.length);
      pending.forEach((fn) => fn());
    },
    /** Let queued promises settle. */
    async settle(times) {
      for (let i = 0; i < (times || 6); i += 1) await Promise.resolve();
      await new Promise((r) => setTimeout(r, 0));
      for (let i = 0; i < (times || 6); i += 1) await Promise.resolve();
    },
    /** Open the wizard on the consolidated final step with a live draft. */
    async openAtFinalStep() {
      win.FCA.openDraft('draft-synthetic-1');
      await api.settle();
      api.flushFrames();
      await api.settle();
      api.flushFrames();
      await api.settle();
      return api;
    },
    /** Wait a wizard delay, in the wizard's own (scaled) time. */
    async wait(ms) {
      await new Promise((r) => setTimeout(r, Math.ceil(ms / scale) + 8));
      await api.settle();
      api.flushFrames();
      await api.settle();
    },
    /** Call the panel's own resize observer, the way a browser would. */
    resizeStage() {
      const live = observers.filter((ob) => ob.live);
      if (!live.length) throw new Error('no live ResizeObserver on the preview stage');
      live[live.length - 1].cb([]);
    },
    observers,
    el(id) { return win.document.getElementById(id); },
    q(sel) { return win.document.querySelector(sel); },
    all(sel) { return Array.prototype.slice.call(win.document.querySelectorAll(sel)); },
    click(node) {
      if (!node) throw new Error('click: no node');
      node.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
    },
    clickAction(action, tag) {
      const sel = tag
        ? '[data-fca="' + action + '"][data-tag="' + tag + '"]'
        : '[data-fca="' + action + '"]';
      const node = win.document.querySelector(sel);
      if (!node) throw new Error('no control for ' + sel);
      api.click(node);
      return node;
    },
    toggleSection(tag) {
      const box = win.document.getElementById('fca-sec-' + tag);
      if (!box) throw new Error('no section checkbox for ' + tag);
      box.checked = !box.checked;
      box.dispatchEvent(new win.Event('change', { bubbles: true }));
      return box;
    },
    orderTags() {
      const list = win.document.getElementById('fca-orderlist');
      if (!list) return [];
      return Array.prototype.slice.call(list.children).map((li) => li.getAttribute('data-tag'));
    },
    pages() { return api.all('#fca-docx-host .fca-docx-render-wrapper > section'); },
    close() { dom.window.close(); },
  };
  return api;
}

module.exports = { mountFca, TEMPLATE_SECTIONS };
