'use strict';

/**
 * THE CREDENTIALS SURFACE — the promises the screen makes.
 *
 * Static-source assertions in the house style. Three of them matter more than
 * the rest, and none of them fails anything else in the app if it is deleted:
 *
 *   1. A PROPOSAL IS LABELLED AND REVERSIBLE. A field quietly filled by a
 *      model and then saved is a compliance date nobody chose. Every proposal
 *      lands with its confidence and an undo, and nothing is written until a
 *      person presses Save.
 *   2. THE OWNER DOES NOT EDIT SOMEBODY ELSE'S RECORD. The dialog stops
 *      offering it and the route refuses it. Both, because either alone is
 *      one deletion away from a register a manager can silently retype.
 *   3. THE SCAN IS REQUIRED FOR A NEW CREDENTIAL. That rule is the difference
 *      between a register of evidence and a register of assertions.
 */

const fs = require('fs');
const path = require('path');

const FRONTEND = path.join(__dirname, '..', '..', 'frontend', 'current');
const SHELL = fs.readFileSync(path.join(FRONTEND, 'mockup_v3.html'), 'utf8');
const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'profile-routes.js'), 'utf8');

/** The text of one top-level function in the shell's inline script. */
function fn(name) {
  const start = SHELL.indexOf(`function ${name}(`);
  if (start === -1) return '';
  const next = SHELL.indexOf('\nfunction ', start + 10);
  return SHELL.slice(start, next === -1 ? Math.min(start + 8000, SHELL.length) : next);
}

// ═══════════════════════════════════════════════════════════════════════════
//  THE CARD IS THE WAY IN
// ═══════════════════════════════════════════════════════════════════════════

describe('the credential card', () => {
  const card = fn('_renderCredentialCards');

  test('opens the credential when clicked', () => {
    expect(card).toContain('pfOpenCredential');
    expect(card).toMatch(/onclick="pfOpenCredential/);
  });

  test('is reachable from the keyboard, not only the mouse', () => {
    expect(card).toContain('role="button"');
    expect(card).toContain('tabindex="0"');
    expect(card).toMatch(/onkeydown=.*Enter/);
  });

  test('says whether the claim has a document behind it', () => {
    expect(card).toContain('Scan missing');
    expect(card).toContain('Document attached');
  });

  test('the action buttons do not also open the dialog', () => {
    expect(card).toMatch(/cred-actions" onclick="event\.stopPropagation\(\)/);
  });

  test('Remove is offered only to the person whose credential it is', () => {
    // The Owner's all-staff view previously rendered Remove on everybody's
    // card, where it could only ever 404.
    expect(card).toMatch(/isMine \? `<button[^`]*pfDeleteCredential/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  A PROPOSAL IS NOT A FACT
// ═══════════════════════════════════════════════════════════════════════════

describe('what the reader proposes', () => {
  const apply = fn('credApplyProposal');

  test('nothing is saved by the act of reading — no write from the apply path', () => {
    expect(apply).not.toMatch(/fetch\(/);
    expect(apply).not.toMatch(/method:\s*'(POST|PATCH|PUT)'/);
  });

  test('every proposal carries the reader\'s own confidence', () => {
    expect(apply).toContain('proposal.confidence');
    expect(apply).toMatch(/class="conf/);
  });

  test('every proposal can be undone', () => {
    expect(apply).toContain('credUndoProposal');
    expect(SHELL).toContain('function credUndoProposal(');
  });

  test('a value the person already typed is never overwritten silently', () => {
    expect(apply).toContain('conflicts');
    expect(apply).toMatch(/const conflicts = previous && previous !== proposal\.value/);
    // Offered instead, as "use it".
    expect(apply).toContain('credUseProposal');
  });

  test('the dialog tells the person these are proposals to check', () => {
    expect(fn('credReadScan')).toMatch(/proposals, not facts/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  READING FAILS IN MORE THAN ONE WAY, AND SAYS WHICH
// ═══════════════════════════════════════════════════════════════════════════

describe('when the document cannot be read', () => {
  const read = fn('credReadScan');

  test('a safety-filter refusal is distinguished from an outage', () => {
    expect(read).toContain("'refused'");
    expect(read).toMatch(/safety filter/i);
    expect(read).toContain("'unavailable'");
  });

  test('every failure still leaves the document attached and offers typing', () => {
    const paths = read.match(/_credStatus\(scope, 'warn',[\s\S]{0,500}?\);/g) || [];
    expect(paths.length).toBeGreaterThanOrEqual(3);
    for (const p of paths) expect(p).toMatch(/type the details below/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE SCAN IS REQUIRED
// ═══════════════════════════════════════════════════════════════════════════

describe('adding a credential', () => {
  test('the dialog refuses to save without the document', () => {
    const submit = fn('submitCredentialModal');
    expect(submit).toMatch(/if \(!_credScan\.add\.documentId\)/);
    expect(submit).toContain('documentId:         _credScan.add.documentId');
  });

  test('and so does the route, which is the half that counts', () => {
    expect(ROUTES).toContain('resolveScanForClaim');
    expect(ROUTES).toMatch(/A scan of the credential document is required/);
  });

  test('one scan cannot stand as the evidence for two credentials', () => {
    expect(ROUTES).toMatch(/already attached to another credential/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  WHO MAY DO WHAT
// ═══════════════════════════════════════════════════════════════════════════

describe('the Owner reading somebody else\'s credential', () => {
  const open = fn('pfOpenCredential');

  test('the fields are not editable and the actions are withdrawn', () => {
    expect(open).toMatch(/el\.disabled = !isMine/);
    expect(open).toMatch(/credx-save-btn'\)\.style\.display = isMine/);
    expect(open).toMatch(/credx-replace-btn'\)\.style\.display = isMine/);
    expect(open).toMatch(/credx-remove-btn'\)\.style\.display = isMine/);
  });

  test('verification is still offered, because that is the Owner\'s job', () => {
    expect(open).toContain('credx-verify-btn');
    expect(open).toMatch(/isManager && cred\.status !== 'verified'/);
  });

  test('the route enforces it rather than trusting the dialog', () => {
    const patch = ROUTES.slice(ROUTES.indexOf("router.patch('/api/profile/credentials/:id'"));
    expect(patch.slice(0, 2500)).toMatch(/existing\.user_id !== user\.id\) return notFound/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  VERIFICATION MEANS SOMETHING
// ═══════════════════════════════════════════════════════════════════════════

describe('verification and change', () => {
  test('changing a verified credential withdraws the tick', () => {
    expect(ROUTES).toContain('clearCredentialVerification');
    expect(ROUTES).toContain('verificationWithdrawn');
  });

  test('replacing the document withdraws it too — the evidence changed', () => {
    const attach = ROUTES.slice(ROUTES.indexOf("router.post('/api/profile/credentials/:id/scan'"));
    expect(attach.slice(0, 3000)).toContain('clearCredentialVerification');
  });

  test('a note is not a material change', () => {
    expect(ROUTES).toMatch(/const MATERIAL_FIELDS = \[[\s\S]*?\];/);
    const list = ROUTES.match(/const MATERIAL_FIELDS = \[([\s\S]*?)\];/)[1];
    expect(list).toContain('registration_number');
    expect(list).toContain('expiry_date');
    expect(list).toContain('document_id');
    expect(list).not.toContain("'notes'");
  });

  test('the holder is told when their verification has been withdrawn', () => {
    expect(SHELL).toMatch(/verification has been withdrawn/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE READ HAPPENS ON PIXELS THE PAGE PRODUCED
// ═══════════════════════════════════════════════════════════════════════════

describe('rasterising', () => {
  test('uses the portal\'s own vendored pdf.js, not a CDN', () => {
    const load = fn('_credLoadPdfJs') || SHELL.slice(SHELL.indexOf('_credLoadPdfJs'), SHELL.indexOf('_credLoadPdfJs') + 700);
    expect(load).toContain('/vendor/pdfjs/pdf.min.mjs');
    expect(load).not.toMatch(/https?:\/\//);
  });

  test('a transparent PDF page is painted white before encoding', () => {
    // Without this the JPEG comes out black and the reader sees nothing.
    expect(fn('_credPdfPageImages')).toMatch(/fillStyle = '#ffffff'/);
  });

  test('images are bounded before they leave the browser', () => {
    expect(SHELL).toMatch(/CRED_RASTER_MAX = \d+/);
    expect(SHELL).toMatch(/CRED_MAX_SCAN_BYTES = 5 \* 1024 \* 1024/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  THE SPECIMEN GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

describe('sample scans', () => {
  const SAMPLE = fs.readFileSync(path.join(__dirname, '..', 'credential-sample-scan.js'), 'utf8');

  test('every page it can produce is marked as not genuine', () => {
    expect(SAMPLE).toContain("NOT_GENUINE = 'SPECIMEN — NOT A GENUINE CREDENTIAL'");
    // Watermark, red-ruled statement and footer — three places, so cropping
    // one off does not produce a clean-looking certificate.
    const marks = SAMPLE.match(/NOT_GENUINE|SPECIMEN/g) || [];
    expect(marks.length).toBeGreaterThanOrEqual(6);
  });

  test('it carries no issuer mark that would make it convincing', () => {
    expect(SAMPLE).toMatch(/No signature, seal or issuer mark/);
    expect(SAMPLE).not.toMatch(/embedPng|embedJpg|drawImage/);
  });

  test('the backfill refuses an unfamiliar database without an explicit flag', () => {
    const SCRIPT = fs.readFileSync(
      path.join(__dirname, '..', 'scripts', 'backfill-credential-scans.js'), 'utf8');
    expect(SCRIPT).toContain('--i-know-this-is-production');
    expect(SCRIPT).toMatch(/document_id IS NULL/);
    // Never replaces a real scan, even in a race.
    expect(SCRIPT).toMatch(/WHERE id = \$2 AND document_id IS NULL/);
  });
});
