'use strict';

/**
 * LIBRARY FOLDER UI — STATIC GUARDS.
 *
 * resourcehub.js has no browser test harness, so these read the source and
 * assert the properties that a refactor would break silently. They are crude
 * on purpose: if a renderer is renamed, update the assertion beside it rather
 * than deleting it.
 *
 * What is protected here is what a reviewer cannot see by reading a diff:
 *
 *   - the folder view never renders a name, description or count without
 *     escaping it — folder names can come from a model
 *   - search is not silently scoped to a folder (§21)
 *   - the Owner-only controls are gated in the client TOO, so a therapist is
 *     never offered a button that would 403. (The server is the control; this
 *     is manners.)
 *   - no model id, token count or job id reaches a user (§16)
 *   - every inline handler the markup calls is actually exported on RH2
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const JS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.js'), 'utf8');
const CSS = fs.readFileSync(path.join(FRONTEND, 'resourcehub.css'), 'utf8');

describe('the folder view exists and is the default', () => {
  it('renders folders before falling through to a flat list (§48)', () => {
    expect(JS).toContain('function renderFolderGrid()');
    expect(JS).toContain('function folderCard(');
    expect(JS).toContain("browse: 'folders'");
  });

  it('keeps a way to the flat list (§49)', () => {
    expect(JS).toContain('function allResourcesRow()');
    expect(JS).toContain('All Resources');
    // The handler is written inside a single-quoted JS string, so the source
    // carries the escaped form.
    expect(JS).toContain("RH2.libBrowse(\\'all\\')");
  });

  it('shows breadcrumbs (§20)', () => {
    expect(JS).toContain('function libCrumbs()');
    expect(JS).toContain('aria-label="Library location"');
    expect(JS).toContain('aria-current="page"');
  });
});

describe('escaping every folder-derived string', () => {
  const MUST_CONTAIN = [
    // Folder name, description and count all pass through esc().
    "'<span class=\"rh2-folder-name\">' + esc(node.name) + '</span>'",
    "esc(node.description)",
    "esc(countLabel(node.count))",
    // Breadcrumb segments.
    'esc(b.name)',
    'esc(meta.folder.name)',
    // The folder id in an inline handler.
    "RH2.libOpenFolder(\\'' + esc(node.id) + '\\')",
  ];

  it.each(MUST_CONTAIN)('escapes: %s', (snippet) => {
    expect(JS).toContain(snippet);
  });

  it('never interpolates a folder field raw into markup', () => {
    // Any `+ node.<field> +` outside an esc() call would be a raw sink.
    const raw = JS.match(/\+\s*node\.(name|description|id|slug)\s*\+/g) || [];
    expect(raw).toEqual([]);
  });
});

describe('search stays global (§21)', () => {
  it('only adds a folder to the query when browsing it, or on request', () => {
    expect(JS).toContain('if (f.folderId && (!libSearching(f) || f.folderSearch))');
    expect(JS).toContain("qs.push('folderId=' + encodeURIComponent(f.folderId))");
  });

  it('labels the search box as spanning everything', () => {
    expect(JS).toContain('placeholder="Search all resources..."');
    expect(JS).toContain('aria-label="Search all resources"');
  });

  it('offers folder-only search rather than imposing it', () => {
    expect(JS).toContain('Searching the whole library.');
    expect(JS).toContain('RH2.libScopeSearch(true)');
    expect(JS).toContain('RH2.libScopeSearch(false)');
  });
});

describe('Owner-only controls are gated in the client too (§34)', () => {
  const OWNER_ONLY = [
    'RH2.libOrganise(', 'RH2.libUndoOrganise()', 'RH2.libFolderArchive(',
    'RH2.libFolderForm(true)', 'RH2.libSelectMode(',
  ];

  it('renders the run controls only inside an owner check', () => {
    const bar = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('function libMovePanel()'));
    expect(bar).toContain("if (!isOwner()) return '';");
    for (const control of ['RH2.libOrganise(', 'RH2.libUndoOrganise()', 'RH2.libSelectMode(']) {
      expect(bar).toContain(control);
    }
  });

  it('passes an owner flag into every folder card rather than assuming', () => {
    expect(JS).toContain('function folderCard(node, owner)');
    expect(JS).toContain('var owner = isOwner();');
  });

  it('keeps every owner-only handler out of the therapist path', () => {
    // Each control appears only where an owner check precedes it.
    for (const control of OWNER_ONLY) {
      expect(JS).toContain(control);
    }
    expect(JS).toContain("owner ? '<span class=\"rh2-folder-tools\">'");
  });
});

describe('progress is described in words, not internals (§16)', () => {
  it('maps each phase to a plain sentence', () => {
    expect(JS).toContain('var ORG_PHASES = {');
    for (const phrase of ['Reading resources…', 'Understanding document topics…',
      'Creating library structure…', 'Organising resources…']) {
      expect(JS).toContain(phrase);
    }
  });

  it('never shows a model, a token count, a provider or a run id', () => {
    const owner = JS.slice(JS.indexOf('function libOwnerBar()'), JS.indexOf('function libMovePanel()'));
    for (const leak of ['modelKey', 'providerRequestId', 'tokens', 'bedrock', 'run.id', 'runId']) {
      expect(owner.toLowerCase()).not.toContain(leak.toLowerCase());
    }
  });

  it('says plainly when organisation could not run, and that nothing changed (§61)', () => {
    expect(JS).toContain("Library organisation couldn\\'t be completed right now.");
    expect(JS).toContain('Your resources have not been changed.');
  });
});

describe('manual control is offered where the mistake is noticed (§35, §36)', () => {
  it('supports selecting several resources and moving them at once', () => {
    expect(JS).toContain('function selectableCard(');
    expect(JS).toContain('function libMoveTo(');
    expect(JS).toContain("api('/api/rh2/library/move'");
  });

  it('leaves the resource card itself untouched when not selecting (§19)', () => {
    expect(JS).toContain('if (!S.lib.selMode) return resourceCard(r, backView);');
  });

  it('warns that removing a folder does not delete anything', () => {
    expect(JS).toContain('Its resources move to Needs Review — nothing is deleted.');
  });
});

describe('the api() contract', () => {
  /**
   * api() JSON-stringifies opts.body itself. Passing an already-stringified
   * body double-encodes it, and the server then receives a JSON *string*
   * where it expects an object — which fails silently as "nothing selected"
   * rather than as an error. Every library call must pass a plain object.
   */
  it('never hands api() a pre-stringified body', () => {
    const calls = [...JS.matchAll(/api\('\/api\/rh2\/library[^)]*\{[^}]*body:\s*([^,\n}]+)/g)];
    for (const [, body] of calls) {
      expect(body).not.toMatch(/JSON\.stringify/);
      expect(body.trim()).not.toMatch(/^'/);
    }
  });

  it('passes objects on the multi-line call sites too', () => {
    const block = JS.slice(JS.indexOf('async function libOrganise('), JS.indexOf('function libFolderArchive('));
    expect(block).not.toMatch(/body:\s*JSON\.stringify/);
    expect(block).not.toMatch(/body:\s*'\{/);
  });
});

describe('every inline handler is reachable', () => {
  it('exports each RH2.lib* function the markup calls', () => {
    const called = new Set(
      [...JS.matchAll(/RH2\.(lib[A-Za-z]+)\s*\(/g)].map((m) => m[1]));
    expect(called.size).toBeGreaterThan(8);
    const exportBlock = JS.slice(JS.indexOf('global.RH2 = {'));
    for (const name of called) {
      expect(exportBlock).toContain(`${name}:`);
    }
  });
});

describe('accessibility (§54)', () => {
  it('gives the folder controls text labels, not icon-only buttons', () => {
    expect(JS).toContain('aria-label="Rename ');
    expect(JS).toContain('aria-label="Remove ');
    expect(JS).toContain('rh2-visually-hidden');
  });

  it('announces progress and results to a screen reader', () => {
    expect(JS).toContain('role="status" aria-live="polite"');
  });

  it('marks folder icons decorative', () => {
    expect(JS).toContain("'<span class=\"rh2-folder-glyph\" aria-hidden=\"true\">'");
  });

  it('does not leave the folder tools hover-only', () => {
    expect(CSS).toContain('.rh2-folder:focus-within .rh2-folder-tools');
    expect(CSS).toContain('@media (hover: none) { .rh2-folder-tools { opacity: 1; } }');
  });

  it('distinguishes the review folder by more than colour', () => {
    expect(CSS).toContain('.rh2-folder-review { border-style: dashed; }');
  });

  it('respects a reduced-motion preference', () => {
    expect(CSS).toContain('@media (prefers-reduced-motion: reduce)');
  });
});

describe('responsive layout (§53)', () => {
  it('lays folders out as rows rather than a wide card grid', () => {
    expect(CSS).toContain('.rh2-folders { display: flex; flex-direction: column;');
  });

  it('adapts the folder row and the folder form on a narrow screen', () => {
    const small = CSS.slice(CSS.lastIndexOf('@media (max-width: 640px)'));
    expect(small).toContain('.rh2-folder-open');
    expect(small).toContain('.rh2-folderform');
  });
});
