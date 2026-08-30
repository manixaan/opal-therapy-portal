'use strict';

/**
 * THE PORTAL MAP — the searchable list of things a walkthrough step can point
 * at, so authoring a spotlight is picking from a list rather than hunting.
 *
 * Anchors are discovered by scanning the shipped frontend for `data-help="…"`
 * names and for the ids/classes the existing walkthroughs already target.
 * Discovery beats a hand-maintained list: a curated file drifts the moment
 * someone adds a control, and a stale map is exactly how an author ends up
 * pointing a tour at something that no longer exists.
 *
 * Why data-help is preferred, and surfaced first:
 *   induction.js resolveEl() tries a bare token as data-help, then #id, then
 *   a CSS selector. A data-help name is an ANCHOR — it is placed for this
 *   purpose and survives markup changes. A CSS path is a description of
 *   today's DOM and breaks silently. The map therefore labels every anchor
 *   with a `stability`, and the editor warns on anything but 'anchor'.
 *
 * Read once and cached: these files do not change while the process runs.
 */

const fs = require('fs');
const path = require('path');
const log = require('./logger').createLogger('walkthroughs');

const FRONTEND = path.join(__dirname, '..', 'frontend', 'current');

/** The shell sources a step target can legitimately resolve against. */
const SOURCES = [
  'mockup_v3.html', 'resourcehub.js', 'scheduler.js', 'opa.js',
  'supportpop.js', 'navigation.js', 'induction.js', 'casenotes.js',
];

/**
 * Where an anchor lives, so the picker can group it. Longest prefix wins.
 * Anything unmatched falls into 'Other'.
 */
const GROUPS = [
  ['app-header', 'Top bar'], ['header-', 'Top bar'], ['sync-status', 'Top bar'],
  ['main-nav', 'Navigation'], ['tab-', 'Navigation'],
  ['cal-', 'Calendar'], ['calendar-', 'Calendar'], ['mini-calendar', 'Calendar'],
  ['booking-', 'Booking'],
  ['travel-', 'Travel'],
  ['profile-', 'Profile'],
  ['notif-', 'Notifications'],
  ['settings-', 'Settings'],
  ['report-', 'Reports'],
  ['rh2-', 'Resource Hub'],
  ['opa-', 'Opa'],
  ['invite-', 'Settings'],
  ['stg-', 'Settings'],
  ['detail-panel', 'Panels'], ['gap-modal', 'Panels'],
];

/** Turn `cal-view-week` into `Cal view week` for anchors with no better name. */
function humanise(name) {
  const s = String(name).replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function groupFor(name) {
  let best = null;
  for (const [prefix, group] of GROUPS) {
    if (name.startsWith(prefix) && (!best || prefix.length > best[0].length)) best = [prefix, group];
  }
  return best ? best[1] : 'Other';
}

let cached = null;

function scan() {
  const text = SOURCES.map((f) => {
    try {
      return fs.readFileSync(path.join(FRONTEND, f), 'utf8');
    } catch (e) {
      log.warn('shell source unreadable while building the portal map', { file: f, error: e });
      return '';
    }
  }).join('\n');

  const names = new Set();
  // Static markup, string-built markup, and the escaped form inside JS
  // template strings all appear as a literal data-help="…" in the source.
  const re = /data-help=\\?["']([a-z0-9][a-z0-9-]*)\\?["']/gi;
  let m;
  while ((m = re.exec(text))) names.add(m[1]);

  const anchors = [...names].sort().map((name) => ({
    target: name,
    label: humanise(name),
    group: groupFor(name),
    stability: 'anchor',
  }));

  return anchors;
}

/**
 * The portal map. `stability` is the editor's warning signal:
 *   'anchor'  — a data-help name placed for this purpose. Safe.
 *   'id'      — a real element id. Usually stable, not guaranteed.
 *   'css'     — a selector describing today's DOM. Fragile; allowed, warned.
 *   'unknown' — a bare name that is not an anchor in the portal today. The
 *               player would find nothing; the editor says so rather than
 *               letting it ship and fail in front of a new employee.
 */
function anchors() {
  if (!cached) cached = scan();
  return cached;
}

/** Classify a target an author typed or picked, for the same warning. */
function stabilityOf(target) {
  const t = String(target || '');
  if (!t) return 'css';
  if (anchors().some((a) => a.target === t)) return 'anchor';
  if (t.charAt(0) === '#') return 'id';
  // A bare token resolves as a data-help name — and this one is not in the
  // portal, so it resolves to nothing.
  if (t.charAt(0) !== '.' && t.indexOf('[') === -1) return 'unknown';
  return 'css';
}

module.exports = { anchors, stabilityOf, _reset: () => { cached = null; } };
