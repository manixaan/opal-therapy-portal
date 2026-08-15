'use strict';

/**
 * THE FCA WIZARD, DRIVEN.
 *
 * These are not source-string guards. Each test mounts the shipped fca.js in a
 * DOM with synthetic FCA data (tests/helpers/fca-harness.js), presses the same
 * controls a therapist would, and asserts what the page then does: which steps
 * exist, what Continue reaches, whether a toggle rebuilds the wizard, where the
 * focus ends up, what the preview requests and when, and what Download sends.
 *
 * No participant, no authentication change, no test-only route.
 */

const { mountFca } = require('./helpers/fca-harness');

/** Every harness gets closed, so no jsdom window outlives its test. */
function withWizard(opts, run) {
  const fn = typeof opts === 'function' ? opts : run;
  const options = typeof opts === 'function' ? undefined : opts;
  return async () => {
    const h = mountFca(options);
    try { await fn(h); } finally { h.close(); }
  };
}

// ── 1. Four steps ───────────────────────────────────────────────────────────

describe('the wizard is four steps', () => {
  test('exactly four steps are displayed, with the consolidated final label',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const labels = h.all('.fca-steplabel').map((n) => n.textContent);
      expect(labels).toEqual(['Client', 'Therapist', 'Review data', 'Sections & document']);
      expect(h.all('.fca-step').length).toBe(4);
      expect(h.all('.fca-stepnum').map((n) => n.textContent)).toEqual(['1', '2', '3', '4']);
    }));

  test('the header counts to four, not to six', withWizard(async (h) => {
    await h.openAtFinalStep();
    expect(h.q('.fca-head .fca-quiet').textContent).toContain('step 4 of 4');
  }));

  test('the current step is marked for assistive technology', withWizard(async (h) => {
    await h.openAtFinalStep();
    const current = h.q('[aria-current="step"]');
    expect(current.textContent).toContain('Sections & document');
  }));

  test('Continue on Review data goes straight to the final step', withWizard(async (h) => {
    await h.openAtFinalStep();
    const S = h.FCA._state;
    // Walk back to Review data through the stepper, as a therapist would.
    h.click(h.q('[data-fca="step"][data-step="3"]'));
    await h.settle(); h.flushFrames(); await h.settle();
    expect(S.step).toBe(3);
    expect(h.q('.fca-head .fca-quiet').textContent).toContain('step 3 of 4');

    h.clickAction('next');
    await h.settle(); h.flushFrames(); await h.settle();
    expect(S.step).toBe(4);
    expect(h.el('fca-orderlist')).toBeTruthy();
    expect(h.el('fca-preview')).toBeTruthy();
    // There is nothing beyond it: Continue is gone from the final step.
    expect(h.q('[data-fca="next"]')).toBeNull();
  }));
});

// ── 2. Legacy state ─────────────────────────────────────────────────────────

describe('a wizard state saved under the old six-step numbering', () => {
  test('steps 5 and 6 map onto the consolidated final step', withWizard(async (h) => {
    const { fcaMapStep, FCA_FINAL_STEP } = h.helpers;
    expect(FCA_FINAL_STEP).toBe(4);
    expect(fcaMapStep(5)).toBe(4);
    expect(fcaMapStep(6)).toBe(4);
    expect(fcaMapStep(4)).toBe(4);
    expect(fcaMapStep(3)).toBe(3);
    expect(fcaMapStep(1)).toBe(1);
    // Nonsense opens the wizard rather than stranding the draft.
    expect(fcaMapStep(0)).toBe(1);
    expect(fcaMapStep(-2)).toBe(1);
    expect(fcaMapStep('6')).toBe(4);
    expect(fcaMapStep(undefined)).toBe(1);
    expect(fcaMapStep(99)).toBe(4);
  }));

  test('a legacy deep link into step 6 lands on step 4 with the draft intact',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const S = h.FCA._state;
      h.window.FCA.open(6);
      await h.settle(); h.flushFrames(); await h.settle();
      expect(S.step).toBe(4);
      expect(S.draft).toBeTruthy();
      expect(h.q('[aria-current="step"]').textContent).toContain('Sections & document');
    }));

  test('resuming a draft opens the consolidated step, whatever it was saved as',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      expect(h.FCA._state.step).toBe(4);
      expect(h.FCA._state.furthest).toBe(4);
    }));
});

// ── 3. The consolidated step ────────────────────────────────────────────────

describe('sections and the document are on one step', () => {
  test('the section controls and the live preview render together',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      expect(h.el('fca-orderlist')).toBeTruthy();
      expect(h.q('[data-fca-check="section"]')).toBeTruthy();
      expect(h.q('[data-fca="select-all"]')).toBeTruthy();
      expect(h.q('[data-fca="preset-save"]')).toBeTruthy();
      expect(h.el('fca-preview')).toBeTruthy();
      expect(h.el('fca-docx-host')).toBeTruthy();
      expect(h.q('.fca-body-split')).toBeTruthy();
    }));

  test('the preview toolbar carries refresh, zoom, fit width and full screen',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      ['preview-refresh', 'zoom-out', 'zoom-in', 'zoom-fit', 'preview-full']
        .forEach((a) => expect(h.q('[data-fca="' + a + '"]')).toBeTruthy());
      expect(h.el('fca-preview-zoom').textContent).toBe('100%');
    }));

  test('the separate Preview and Generate stages are unreachable',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const S = h.FCA._state;
      // The stepper cannot offer them…
      expect(h.all('[data-fca="step"]').map((b) => b.getAttribute('data-step')))
        .toEqual(['1', '2', '3', '4']);
      // …and asking for them by number lands on the consolidated step.
      h.FCA._state.step = 3;
      h.window.FCA.open(5);
      await h.settle(); h.flushFrames(); await h.settle();
      expect(S.step).toBe(4);
      // There is no second workflow left to drift: one step body, one preview.
      expect(h.all('#fca-step-body').length).toBe(1);
      expect(h.all('#fca-docx-host').length).toBe(1);
      expect(h.all('.fca-preview-inline').length).toBe(0);
    }));

  test('the footer offers Back and one primary Download, and no Continue',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const foot = h.q('.fca-foot');
      expect(foot.querySelector('[data-fca="back"]')).toBeTruthy();
      expect(foot.querySelector('[data-fca="next"]')).toBeNull();
      const download = foot.querySelector('[data-fca="download"]');
      expect(download).toBeTruthy();
      expect(download.textContent).toContain('Download Word document');
      // One primary download action, not two: the toolbar no longer has one.
      expect(h.q('.fca-preview-bar [data-fca="download"]')).toBeNull();
      expect(h.all('[data-fca="download"]').length).toBe(1);
    }));
});

// ── 4. The preview starts by itself ─────────────────────────────────────────

describe('the preview renders without Refresh being pressed', () => {
  test('entering the step requests and draws the document unaided',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const previews = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1);
      expect(previews.length).toBe(1);
      expect(h.FCA._state.exact.status).toBe('ready');
      expect(h.pages().length).toBe(3);
      // Nothing pressed Refresh — no click of any kind reached the toolbar.
      expect(h.calls.filter((c) => c.method !== 'GET' && c.method !== 'PATCH').length).toBe(0);
    }));

  test('the request is scheduled after the panel is mounted and measurable',
    withWizard(async (h) => {
      // Before any frame runs the panel exists but nothing has been requested…
      h.window.FCA.openDraft('draft-synthetic-1');
      await h.settle();
      expect(h.el('fca-docx-host')).toBeTruthy();
      const before = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      expect(before).toBe(0);
      // …the post-mount frame is what starts it.
      h.flushFrames();
      await h.settle();
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(1);
    }));

  test('a tab that never paints still gets its preview', withWizard(async (h) => {
    // A hidden, occluded or throttled tab runs no animation frames at all.
    // The panel must not sit on "Preparing document preview…" because of it.
    h.window.requestAnimationFrame = function () { return 0; };
    h.window.FCA.openDraft('draft-synthetic-1');
    await h.settle();
    expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(0);
    await h.wait(120);
    expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(1);
    expect(h.FCA._state.exact.status).toBe('ready');
    expect(h.pages().length).toBe(3);
    expect(h.q('.fca-preview-empty')).toBeNull();
  }));

  test('coming back to a hidden tab re-measures rather than leaving it stuck',
    withWizard(async (h) => {
      h.window.requestAnimationFrame = function () { return 0; };
      await h.openAtFinalStep();
      await h.wait(120);
      const composes = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;

      h.geom.stageWidth = 300;
      Object.defineProperty(h.document, 'visibilityState', { configurable: true, get: () => 'visible' });
      h.document.dispatchEvent(new h.window.Event('visibilitychange'));
      expect(h.FCA._state.exact.base).toBeCloseTo((300 - 32) / 816, 6);
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(composes);
    }));

  test('the panel never says "Preparing" while nothing is scheduled',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const S = h.FCA._state;
      expect(S.exact.status).toBe('ready');
      expect(h.q('.fca-preview-empty')).toBeNull();
      expect(h.q('.fca-preview-updating')).toBeNull();
    }));

  test('re-entering the step keeps the document that is already drawn',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const first = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      h.clickAction('back');                       // to step 3
      await h.settle(); h.flushFrames(); await h.settle();
      expect(h.FCA._state.step).toBe(3);
      h.clickAction('next');                       // back to step 4
      await h.settle(); h.flushFrames(); await h.settle();
      await h.wait(900);
      expect(h.FCA._state.step).toBe(4);
      expect(h.pages().length).toBe(3);
      // The signature is unchanged, so the document was re-drawn at most once
      // for the rebuilt panel — never on a loop.
      const after = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      expect(after).toBeLessThanOrEqual(first + 1);
    }));

  test('Refresh forces a fresh compose even when nothing changed',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const before = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      h.clickAction('preview-refresh');
      await h.wait(50);
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(before + 1);
      expect(h.FCA._state.exact.status).toBe('ready');
    }));
});

// ── 5. Failure, timeout, recovery ───────────────────────────────────────────

describe('a preview that fails is recoverable', () => {
  test('a failed compose shows an actionable error and Try again works',
    withWizard(async (h) => {
      h.controls.previewFails = true;
      await h.openAtFinalStep();
      expect(h.FCA._state.exact.status).toBe('error');
      const err = h.q('.fca-preview-error');
      expect(err).toBeTruthy();
      expect(err.textContent).toContain('Try again');
      expect(err.textContent).toContain('Download Word document still work');

      h.controls.previewFails = false;
      h.clickAction('preview-refresh');
      await h.wait(50);
      expect(h.FCA._state.exact.status).toBe('ready');
      expect(h.q('.fca-preview-error')).toBeNull();
      expect(h.pages().length).toBe(3);
    }));

  test('a hung request times out rather than loading forever',
    withWizard({ timeScale: 1000 }, async (h) => {
      h.controls.holdPreview = () => new Promise(() => {});   // never resolves
      h.window.FCA.openDraft('draft-synthetic-1');
      await h.settle(); h.flushFrames(); await h.settle();
      expect(h.FCA._state.exact.status).toBe('rendering');
      await new Promise((r) => setTimeout(r, 80));            // 30s / 1000 + slack
      await h.settle();
      expect(h.FCA._state.exact.status).toBe('error');
      expect(h.FCA._state.exact.err).toBe('timed_out');
      expect(h.q('.fca-preview-error').textContent).toContain('took too long');
    }));

  test('an error leaves the section summary readable as a fallback',
    withWizard(async (h) => {
      h.controls.previewFails = true;
      await h.openAtFinalStep();
      const fallback = h.q('.fca-preview-fallback');
      expect(fallback).toBeTruthy();
      expect(fallback.textContent).toContain('Mobility');
    }));
});

// ── 6. Editing is immediate ─────────────────────────────────────────────────

describe('editing sections does not refresh the interface', () => {
  test('every editing control is a button, so nothing submits or navigates',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const buttons = h.all('#fca-root button');
      expect(buttons.length).toBeGreaterThan(5);
      buttons.forEach((b) => expect(b.getAttribute('type')).toBe('button'));
      // There is no form in the wizard at all, so there is nothing to submit.
      expect(h.all('#fca-root form').length).toBe(0);
    }));

  test('toggling a section updates its own row and the order list in place',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const shell = h.q('.fca-shell');
      const row = h.el('fca-sec-SEC_COMMUNICATION');
      expect(h.orderTags()).not.toContain('SEC_COMMUNICATION');

      h.toggleSection('SEC_COMMUNICATION');
      // Same elements — the wizard was not rebuilt around them.
      expect(h.q('.fca-shell')).toBe(shell);
      expect(h.el('fca-sec-SEC_COMMUNICATION')).toBe(row);
      expect(row.checked).toBe(true);
      expect(h.FCA._state.draft.selectedSections).toContain('SEC_COMMUNICATION');
      expect(h.orderTags()).toContain('SEC_COMMUNICATION');
    }));

  test('the toggle keeps focus on the control that was pressed',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const row = h.el('fca-sec-SEC_MOBILITY');
      row.focus();
      h.toggleSection('SEC_MOBILITY');
      expect(h.document.activeElement).toBe(row);
    }));

  test('moving a section moves the very same row, and focus goes with it',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const before = h.orderTags();
      const tag = before[2];
      const list = h.el('fca-orderlist');
      const rowNode = list.children[2];
      const up = h.el('fca-up-' + tag);
      up.focus();

      h.click(up);
      const after = h.orderTags();
      expect(after[1]).toBe(tag);
      expect(after.length).toBe(before.length);
      // The row itself travelled; nothing was recreated.
      expect(h.el('fca-orderlist').children[1]).toBe(rowNode);
      expect(h.el('fca-orderlist')).toBe(list);
      expect(h.document.activeElement).toBe(up);
      expect(rowNode.classList.contains('fca-just-moved')).toBe(true);
    }));

  test('focus falls to the neighbouring control when a move disables it',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const tag = h.orderTags()[1];
      const up = h.el('fca-up-' + tag);
      up.focus();
      h.click(up);                       // now first — Move earlier is disabled
      expect(h.orderTags()[0]).toBe(tag);
      expect(h.el('fca-up-' + tag).disabled).toBe(true);
      expect(h.document.activeElement).toBe(h.el('fca-down-' + tag));
    }));

  test('first and last lose their move controls as the list changes',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const tags = h.orderTags();
      expect(h.el('fca-up-' + tags[0]).disabled).toBe(true);
      expect(h.el('fca-down-' + tags[tags.length - 1]).disabled).toBe(true);
      h.click(h.el('fca-down-' + tags[0]));
      const after = h.orderTags();
      expect(after[0]).toBe(tags[1]);
      expect(h.el('fca-up-' + after[0]).disabled).toBe(true);
      expect(h.el('fca-up-' + tags[0]).disabled).toBe(false);
    }));

  test('drag-and-drop produces exactly the ordering the move buttons do',
    withWizard(async (h) => {
      const byButton = mountFca();
      try {
        await byButton.openAtFinalStep();
        byButton.click(byButton.el('fca-up-' + byButton.orderTags()[3]));
        var expected = byButton.orderTags();
      } finally { byButton.close(); }

      await h.openAtFinalStep();
      const tags = h.orderTags();
      const list = h.el('fca-orderlist');
      const dragged = list.children[3];
      const target = list.children[2];
      const dt = { effectAllowed: '', dropEffect: '', setData() {}, getData() { return tags[3]; } };

      const start = new h.window.Event('dragstart', { bubbles: true, cancelable: true });
      start.dataTransfer = dt;
      dragged.dispatchEvent(start);

      const over = new h.window.Event('dragover', { bubbles: true, cancelable: true });
      over.dataTransfer = dt;
      target.dispatchEvent(over);
      expect(over.defaultPrevented).toBe(true);          // no navigation

      const drop = new h.window.Event('drop', { bubbles: true, cancelable: true });
      drop.dataTransfer = dt;
      target.dispatchEvent(drop);
      expect(drop.defaultPrevented).toBe(true);          // and none here either

      expect(h.orderTags()).toEqual(expected);
    }));

  test('required sections stay locked and cannot be removed',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const box = h.el('fca-sec-SEC_PARTICIPANT');
      expect(box.disabled).toBe(true);
      expect(h.el('fca-out-SEC_PARTICIPANT').disabled).toBe(true);
      // Even pressed directly, the state refuses.
      const before = h.FCA._state.draft.selectedSections.slice();
      h.click(h.el('fca-out-SEC_PARTICIPANT'));
      expect(h.FCA._state.draft.selectedSections).toEqual(before);
    }));

  test('the scroll position of the panel and the modal is kept',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const scroller = h.q('.fca-body');
      scroller.scrollTop = 420;
      h.toggleSection('SEC_COMMUNICATION');
      expect(scroller.scrollTop).toBe(420);
      const tags = h.orderTags();
      h.click(h.el('fca-down-' + tags[0]));
      expect(scroller.scrollTop).toBe(420);
      expect(h.q('.fca-body')).toBe(scroller);
    }));

  test('an expanded disclosure stays expanded across an edit',
    withWizard(async (h) => {
      h.controls.previewFails = true;              // shows the fallback <details>
      await h.openAtFinalStep();
      const details = h.q('.fca-preview-fallback');
      details.open = true;
      h.toggleSection('SEC_COMMUNICATION');
      expect(h.q('.fca-preview-fallback')).toBe(details);
      expect(details.open).toBe(true);
    }));
});

// ── 7. The preview follows the edits ────────────────────────────────────────

describe('edits update the preview without anyone pressing Refresh', () => {
  test('a section change schedules a new compose', withWizard(async (h) => {
    await h.openAtFinalStep();
    const before = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
    h.toggleSection('SEC_COMMUNICATION');
    expect(h.FCA._state.exact.status).toBe('scheduled');
    await h.wait(700);
    expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(before + 1);
    expect(h.FCA._state.exact.status).toBe('ready');
  }));

  test('several rapid changes compose once, for the last of them',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const before = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      h.toggleSection('SEC_COMMUNICATION');
      h.toggleSection('SEC_APPENDIX');
      h.toggleSection('SEC_MOBILITY');
      await h.wait(700);
      const previews = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1);
      expect(previews.length).toBe(before + 1);
      expect(h.FCA._state.exact.renderedSig).toBe(h.FCA._state.exact.sig);
    }));

  test('the document already on screen stays visible while the new one builds',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const drawn = h.pages();
      expect(drawn.length).toBe(3);
      let release;
      h.controls.holdPreview = (deliver) => new Promise((r) => { release = () => r(deliver()); });

      h.toggleSection('SEC_COMMUNICATION');
      await h.wait(700);
      // Mid-flight: the old pages are still there and the panel says so quietly.
      expect(h.pages().length).toBe(3);
      expect(h.pages()[0]).toBe(drawn[0]);
      expect(h.q('.fca-preview-updating')).toBeTruthy();
      expect(h.q('.fca-preview-empty')).toBeNull();

      h.controls.holdPreview = null;
      release();
      await h.settle(); await h.wait(20);
      expect(h.q('.fca-preview-updating')).toBeNull();
      expect(h.pages().length).toBe(3);
    }));

  test('an obsolete response cannot replace a newer one', withWizard(async (h) => {
    await h.openAtFinalStep();
    const held = [];
    h.controls.holdPreview = (deliver, url) => new Promise((r) => held.push({ url, go: () => r(deliver()) }));

    h.toggleSection('SEC_COMMUNICATION');
    await h.wait(700);
    h.renders.pageCount = 9;                 // the SECOND request draws 9 pages
    h.toggleSection('SEC_APPENDIX');
    await h.wait(700);
    expect(held.length).toBe(2);

    held[1].go();                            // newest lands first
    await h.settle(); await h.wait(20);
    expect(h.pages().length).toBe(9);

    h.renders.pageCount = 2;
    held[0].go();                            // the stale one arrives late
    await h.settle(); await h.wait(20);
    expect(h.pages().length).toBe(9);        // and is discarded
  }));

  test('the reading position is restored across a replacement',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const stage = h.el('fca-preview-stage');
      const fit = h.el('fca-docx-fit');
      fit.__top = 20;
      const scale = h.FCA._state.exact.scale;
      // Half way down page 3 of 3.
      const page3 = h.pages()[2];
      stage.scrollTop = 20 + (page3.offsetTop * scale) + (page3.offsetHeight * scale * 0.5);

      h.toggleSection('SEC_COMMUNICATION');
      await h.wait(700);

      const again = h.pages()[2];
      const expected = 20 + (again.offsetTop * h.FCA._state.exact.scale)
        + (again.offsetHeight * h.FCA._state.exact.scale * 0.5);
      expect(Math.abs(stage.scrollTop - expected)).toBeLessThan(2);
    }));

  test('the preview comes back around the section that was just edited',
    withWizard(async (h) => {
      h.controls.pageTitles = ['Participant Details', 'Referral Information', 'Mobility', 'Cognition'];
      h.renders.pageCount = 4;
      await h.openAtFinalStep();
      const stage = h.el('fca-preview-stage');
      const fit = h.el('fca-docx-fit');
      fit.__top = 0;
      stage.scrollTop = 0;                       // reading the first page

      h.controls.pageTitles = ['Participant Details', 'Referral Information', 'Mobility', 'Cognition', 'Communication'];
      h.renders.pageCount = 5;
      h.toggleSection('SEC_COMMUNICATION');      // …adds a section further down
      await h.wait(700);

      const scale = h.FCA._state.exact.scale;
      const communication = h.pages()[4];
      expect((communication.textContent || '')).toBe('Communication');
      expect(stage.scrollTop).toBeCloseTo(communication.offsetTop * scale, 3);
    }));

  test('a removed section leaves no anchor, so the nearest position is kept',
    withWizard(async (h) => {
      h.controls.pageTitles = ['Participant Details', 'Referral Information', 'Mobility'];
      h.renders.pageCount = 3;
      await h.openAtFinalStep();
      const stage = h.el('fca-preview-stage');
      h.el('fca-docx-fit').__top = 0;
      const scale = h.FCA._state.exact.scale;
      stage.scrollTop = h.pages()[1].offsetTop * scale;

      h.controls.pageTitles = ['Participant Details', 'Referral Information'];
      h.renders.pageCount = 2;
      h.click(h.el('fca-out-SEC_MOBILITY'));
      await h.wait(700);

      expect(h.FCA._state.draft.selectedSections).not.toContain('SEC_MOBILITY');
      expect(h.pages().length).toBe(2);
      expect(stage.scrollTop)
        .toBeCloseTo(h.pages()[1].offsetTop * h.FCA._state.exact.scale, 3);
    }));

  test('a shorter document clamps the restored position instead of overshooting',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const stage = h.el('fca-preview-stage');
      const fit = h.el('fca-docx-fit');
      fit.__top = 0;
      const page3 = h.pages()[2];
      stage.scrollTop = (page3.offsetTop * h.FCA._state.exact.scale) + 10;

      h.renders.pageCount = 1;                 // the section that held page 3 is gone
      h.toggleSection('SEC_MOBILITY');
      await h.wait(700);

      expect(h.pages().length).toBe(1);
      const only = h.pages()[0];
      expect(stage.scrollTop).toBeLessThanOrEqual(only.offsetHeight * h.FCA._state.exact.scale);
      expect(stage.scrollTop).toBeGreaterThanOrEqual(0);
    }));

  test('the updating marker clears once the newest document is drawn',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      h.toggleSection('SEC_COMMUNICATION');
      expect(h.q('.fca-preview-updating')).toBeTruthy();
      // Long enough for the edit's compose AND for the save that follows it to
      // land: a save that agrees with the panel must not re-arm the marker.
      await h.wait(2500);
      expect(h.FCA._state.exact.status).toBe('ready');
      expect(h.q('.fca-preview-updating')).toBeNull();
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(2);
    }));

  test('the zoom the therapist chose survives an edit', withWizard(async (h) => {
    await h.openAtFinalStep();
    h.clickAction('zoom-in');
    h.clickAction('zoom-in');
    const zoom = h.FCA._state.exact.zoom;
    expect(zoom).toBeCloseTo(1.2, 5);
    h.toggleSection('SEC_COMMUNICATION');
    await h.wait(700);
    expect(h.FCA._state.exact.zoom).toBeCloseTo(zoom, 5);
    expect(h.el('fca-preview-zoom').textContent).toBe('120%');
  }));
});

// ── 8. Persistence ──────────────────────────────────────────────────────────

describe('saving section edits', () => {
  test('a failed save is reported inline and the list is put back, in place',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const shell = h.q('.fca-shell');
      const confirmed = h.FCA._state.draft.selectedSections.slice();

      h.controls.patchFails = true;
      h.toggleSection('SEC_COMMUNICATION');
      expect(h.FCA._state.draft.selectedSections).toContain('SEC_COMMUNICATION');
      await h.wait(700);

      expect(h.FCA._state.save).toBe('error');
      expect(h.FCA._state.draft.selectedSections).toEqual(confirmed);
      expect(h.el('fca-sec-SEC_COMMUNICATION').checked).toBe(false);
      const inline = h.el('fca-section-err');
      expect(inline).toBeTruthy();
      expect(inline.textContent).toContain('could not be saved');
      // Still the same wizard — a failed save is not a reset.
      expect(h.q('.fca-shell')).toBe(shell);
      expect(h.FCA._state.step).toBe(4);
      expect(h.el('fca-preview')).toBeTruthy();
    }));

  test('Retry re-applies the change and saves it', withWizard(async (h) => {
    await h.openAtFinalStep();
    h.controls.patchFails = true;
    h.toggleSection('SEC_COMMUNICATION');
    await h.wait(700);
    expect(h.FCA._state.draft.selectedSections).not.toContain('SEC_COMMUNICATION');

    h.controls.patchFails = false;
    h.clickAction('retry-save');
    await h.wait(700);
    expect(h.FCA._state.save).toBe('saved');
    expect(h.FCA._state.draft.selectedSections).toContain('SEC_COMMUNICATION');
    expect(h.el('fca-section-err')).toBeNull();
  }));

  test('a typed value is never rolled back by a failed save', withWizard(async (h) => {
    await h.openAtFinalStep();
    const S = h.FCA._state;
    S.overrides.OPAL_CLIENT_FULL_NAME = 'Typed by the therapist';
    h.controls.patchFails = true;
    h.toggleSection('SEC_COMMUNICATION');
    await h.wait(700);
    expect(S.overrides.OPAL_CLIENT_FULL_NAME).toBe('Typed by the therapist');
  }));
});

// ── 9. Download ─────────────────────────────────────────────────────────────

describe('Download Word document', () => {
  test('it flushes pending edits, then generates from the latest ordering',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      const clicked = [];
      h.window.HTMLAnchorElement.prototype.click = function () { clicked.push(this.getAttribute('href')); };

      const tags = h.orderTags();
      h.click(h.el('fca-down-' + tags[0]));       // a save is now queued
      h.toggleSection('SEC_COMMUNICATION');
      const expectedOrder = h.orderTags();

      h.clickAction('download');
      await h.settle(); await h.wait(900);

      const patches = h.calls.filter((c) => c.method === 'PATCH');
      const generate = h.calls.filter((c) => /\/generate$/.test(c.url));
      expect(generate.length).toBe(1);
      // The save landed BEFORE the document was built…
      expect(h.calls.indexOf(patches[patches.length - 1])).toBeLessThan(h.calls.indexOf(generate[0]));
      // …and it carried the ordering and the selection now on screen.
      expect(h.server.order.filter((t) => h.server.selected.indexOf(t) !== -1))
        .toEqual(expectedOrder);
      expect(h.server.selected).toContain('SEC_COMMUNICATION');
      expect(clicked).toEqual(['/api/fca/documents/doc-synthetic-1/download']);
    }));

  test('a second press while it is working is ignored', withWizard(async (h) => {
    await h.openAtFinalStep();
    h.window.HTMLAnchorElement.prototype.click = function () {};
    h.clickAction('download');
    const button = h.q('[data-fca="download"]');
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Preparing your document…');
    h.click(button);
    h.click(button);
    await h.settle(); await h.wait(900);
    expect(h.calls.filter((c) => /\/generate$/.test(c.url)).length).toBe(1);
  }));

  test('it stays on the final step and keeps the selections when it fails',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      h.window.HTMLAnchorElement.prototype.click = function () {};
      h.toggleSection('SEC_COMMUNICATION');
      await h.wait(700);
      h.controls.generateFails = true;

      h.clickAction('download');
      await h.settle(); await h.wait(900);

      expect(h.FCA._state.step).toBe(4);
      expect(h.FCA._state.draft.selectedSections).toContain('SEC_COMMUNICATION');
      expect(h.el('fca-sec-SEC_COMMUNICATION').checked).toBe(true);
      expect(h.q('.fca-err').textContent).toContain('generation_failed');
      expect(h.q('[data-fca="download"]').disabled).toBe(false);
    }));

  test('the finished document is also offered as a plain link',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      h.window.HTMLAnchorElement.prototype.click = function () {};
      h.clickAction('download');
      await h.settle(); await h.wait(900);
      const link = h.q('[data-fca-download]');
      expect(link.getAttribute('href')).toBe('/api/fca/documents/doc-synthetic-1/download');
      expect(link.hasAttribute('download')).toBe(true);
    }));
});

// ── 10. Fitted zoom ─────────────────────────────────────────────────────────

describe('the fitted 100% baseline', () => {
  test('the whole page width fits the stage, with a margin, at 100%',
    withWizard({ stageWidth: 520, pageWidth: 816 }, async (h) => {
      await h.openAtFinalStep();
      const S = h.FCA._state;
      expect(S.exact.zoom).toBe(1);
      expect(S.exact.base).toBeCloseTo((520 - 32) / 816, 6);
      const shownWidth = 816 * S.exact.scale;
      expect(shownWidth).toBeLessThanOrEqual(520);      // both edges visible
      expect(520 - shownWidth).toBeGreaterThanOrEqual(30);
      expect(h.el('fca-preview-zoom').textContent).toBe('100%');
    }));

  test('the fit box carries the scaled stack, gaps and final page included',
    withWizard({ stageWidth: 520, pageWidth: 816, pageHeight: 1056, gap: 18, pages: 3 },
      async (h) => {
        await h.openAtFinalStep();
        const scale = h.FCA._state.exact.scale;
        const fit = h.el('fca-docx-fit');
        const stackHeight = (3 * 1056) + (2 * 18);
        expect(parseFloat(fit.style.height)).toBeCloseTo(stackHeight * scale, 3);
        expect(parseFloat(fit.style.width)).toBeCloseTo(816 * scale, 3);
        // The page keeps its proportions — nothing stretches it to the panel.
        const page = h.pages()[0];
        expect(page.offsetWidth / page.offsetHeight).toBeCloseTo(816 / 1056, 6);
        expect(h.el('fca-docx-host').style.width).toBe('816px');
        expect(h.el('fca-docx-host').style.transform).toBe('scale(' + scale + ')');
        expect(h.el('fca-docx-host').style.transformOrigin).toBe('top left');
      }));

  test('a page never overlaps the one below it', withWizard(async (h) => {
    await h.openAtFinalStep();
    const scale = h.FCA._state.exact.scale;
    const pages = h.pages();
    for (let i = 1; i < pages.length; i += 1) {
      const previousBottom = (pages[i - 1].offsetTop + pages[i - 1].offsetHeight) * scale;
      expect(pages[i].offsetTop * scale).toBeGreaterThan(previousBottom);
    }
  }));

  test('zooming in is relative to the fitted base and enables sideways scroll',
    withWizard({ stageWidth: 520, pageWidth: 816 }, async (h) => {
      await h.openAtFinalStep();
      const base = h.FCA._state.exact.base;
      for (let i = 0; i < 8; i += 1) h.clickAction('zoom-in');
      const S = h.FCA._state;
      expect(S.exact.zoom).toBeCloseTo(1.8, 5);
      expect(S.exact.scale).toBeCloseTo(base * 1.8, 6);
      expect(h.el('fca-preview-zoom').textContent).toBe('180%');
      // Wider than the stage now — and the fit box says so, so the stage can
      // scroll to it instead of the page spilling out of the panel.
      expect(parseFloat(h.el('fca-docx-fit').style.width)).toBeGreaterThan(520);
    }));

  test('a stage wider than the page fits at natural size, never magnified',
    withWizard({ stageWidth: 1400, pageWidth: 816 }, async (h) => {
      await h.openAtFinalStep();
      expect(h.FCA._state.exact.base).toBe(1);
      expect(h.FCA._state.exact.scale).toBe(1);
      expect(h.el('fca-preview-zoom').textContent).toBe('100%');
    }));

  test('Fit width returns to the relative 100% baseline', withWizard(async (h) => {
    await h.openAtFinalStep();
    h.clickAction('zoom-out');
    h.clickAction('zoom-out');
    expect(h.FCA._state.exact.fit).toBe(false);
    h.clickAction('zoom-fit');
    expect(h.FCA._state.exact.fit).toBe(true);
    expect(h.FCA._state.exact.zoom).toBe(1);
    expect(h.el('fca-preview-zoom').textContent).toBe('100%');
    expect(h.q('[data-fca="zoom-fit"]').getAttribute('aria-pressed')).toBe('true');
  }));

  test('resizing rescales without composing the document again',
    withWizard({ stageWidth: 520 }, async (h) => {
      await h.openAtFinalStep();
      const composes = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      const first = h.FCA._state.exact.base;

      // The panel installed a ResizeObserver on its stage; a wider panel is
      // that observer firing, and nothing else.
      h.geom.stageWidth = 700;
      h.resizeStage();

      expect(h.FCA._state.exact.base).toBeCloseTo((700 - 32) / 816, 6);
      expect(h.FCA._state.exact.base).toBeGreaterThan(first);
      expect(parseFloat(h.el('fca-docx-fit').style.width))
        .toBeCloseTo(816 * h.FCA._state.exact.base, 3);
      // …and no new document was composed for a resize.
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(composes);
      expect(h.renders.length).toBe(1);
    }));

  test('full screen re-measures on the way in and on the way out',
    withWizard({ stageWidth: 520 }, async (h) => {
      await h.openAtFinalStep();
      const composes = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      const fitted = h.FCA._state.exact.base;

      h.geom.stageWidth = 1400;
      h.clickAction('preview-full');
      h.flushFrames();
      expect(h.FCA._state.exact.full).toBe(true);
      expect(h.q('.fca-preview').classList.contains('fca-preview-full')).toBe(true);
      expect(h.q('.fca-preview').classList.contains('fca-preview-full')).toBe(true);
      expect(h.FCA._state.exact.base).toBeGreaterThan(fitted);

      h.geom.stageWidth = 520;
      h.clickAction('preview-full');
      h.flushFrames();
      expect(h.FCA._state.exact.full).toBe(false);
      expect(h.q('.fca-preview').classList.contains('fca-preview-full')).toBe(false);
      expect(h.FCA._state.exact.base).toBeCloseTo(fitted, 6);
      // Nothing was recomposed for any of it.
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(composes);
    }));

  test('full screen re-measures even when the tab is not painting',
    withWizard({ stageWidth: 520 }, async (h) => {
      h.window.requestAnimationFrame = function () { return 0; };
      await h.openAtFinalStep();
      await h.wait(120);
      const fitted = h.FCA._state.exact.base;
      h.geom.stageWidth = 1400;
      h.clickAction('preview-full');
      await h.wait(120);
      expect(h.FCA._state.exact.base).toBe(1);
      expect(h.FCA._state.exact.base).toBeGreaterThan(fitted);
    }));

  test('closing the wizard tears down the observer and the pending work',
    withWizard(async (h) => {
      await h.openAtFinalStep();
      h.toggleSection('SEC_COMMUNICATION');       // a compose is now scheduled
      const before = h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length;
      h.window.FCA.close();
      await h.wait(900);
      expect(h.FCA._state.exact.status).toBe('idle');
      expect(h.el('fca-docx-host')).toBeNull();
      expect(h.calls.filter((c) => c.url.indexOf('preview.docx') !== -1).length).toBe(before);
    }));
});
