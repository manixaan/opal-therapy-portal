/**
 * WHODAS external completion (uploaded forms), document re-issue, and the two
 * defects found during the architecture audit.
 *
 * The rule these protect: an uploaded form is a record that a clinical event
 * happened, not a source of clinical data. Nothing here reads, interprets or
 * scores the file, and the database refuses to let one carry a score.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROUTES = fs.readFileSync(path.join(__dirname, '..', 'whodas-routes.js'), 'utf8');
const MIG_028 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '028_whodas_external_completion.sql'), 'utf8');
const UI = fs.readFileSync(
  path.join(__dirname, '..', '..', 'frontend', 'current', 'whodas.js'), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
const CODE = strip(ROUTES);
const UI_CODE = strip(UI);

describe('an uploaded assessment can never carry a score', () => {
  test('the database refuses it, not just the route', () => {
    expect(MIG_028).toMatch(/uploaded_whodas_has_no_score/);
    expect(MIG_028).toMatch(/completion_source <> 'uploaded'\s*OR \(scores = '\{\}'::jsonb AND responses = '\{\}'::jsonb\)/);
  });

  test('the upload route stores empty responses and scores', () => {
    const fn = CODE.slice(CODE.indexOf("assessments/upload'"), CODE.indexOf('COMMIT'));
    expect(fn).toMatch(/'\{\}'::jsonb,'\{\}'::jsonb,'\{\}'::jsonb/);
  });

  test('nothing in the upload path reads or interprets the file', () => {
    const start = CODE.indexOf("assessments/upload'");
    const end = CODE.indexOf('router.post', start + 50);
    const fn = CODE.slice(start, end === -1 ? CODE.length : end);
    // No OCR, no parsing, no extraction. 'score' legitimately appears in the
    // response note that says a score was NOT produced, so match the verbs.
    expect(fn).not.toMatch(/\bocr\b|parsePdf|extractText|pdfjs|calculateScore|computeScore/i);
  });

  test('the caller is told plainly that no score was produced', () => {
    expect(ROUTES).toMatch(/No score is calculated for an uploaded form/);
  });
});

describe('upload validation', () => {
  test('the administration method is required and validated against the instrument', () => {
    expect(CODE).toMatch(/instrument\.ADMINISTRATION_METHODS\.indexOf\(method\) === -1/);
    expect(CODE).toMatch(/method_required/);
  });

  test('a completion date is required', () => {
    expect(CODE).toMatch(/date_required/);
  });

  test('the file is checked by magic bytes, not by its name', () => {
    expect(CODE).toMatch(/bytes\.slice\(0, 5\)\.toString\('latin1'\) !== '%PDF-'/);
    expect(CODE).toMatch(/not_a_pdf/);
  });

  test('an oversized file is refused', () => {
    expect(CODE).toMatch(/20 \* 1024 \* 1024/);
    expect(CODE).toMatch(/file_too_large/);
  });

  test('the assessment and its document are written in one transaction', () => {
    const fn = CODE.slice(CODE.indexOf("assessments/upload'"));
    expect(fn).toMatch(/BEGIN/);
    expect(fn).toMatch(/exec: client/);      // the document joins the transaction
    expect(fn).toMatch(/COMMIT/);
    expect(fn).toMatch(/ROLLBACK/);
  });
});

describe('document re-issue — the remedy for a swallowed generation failure', () => {
  test('a generation failure is no longer silent', () => {
    expect(CODE).toMatch(/documentError = err\.message/);
    expect(CODE).toMatch(/WHODAS_PDF_GENERATION_FAILED/);
    expect(ROUTES).toMatch(/documentRemedy/);
  });

  test('a regenerate route exists and is write-guarded', () => {
    expect(CODE).toMatch(/router\.post\('\/api\/whodas\/assessments\/:id\/document\/regenerate', requireClinicalWrite/);
  });

  test('it refuses to overwrite an existing document', () => {
    const fn = CODE.slice(CODE.indexOf('document/regenerate'));
    expect(fn).toMatch(/document_exists/);
  });

  test('it refuses an uploaded assessment — nothing here rendered that file', () => {
    const fn = CODE.slice(CODE.indexOf('document/regenerate'));
    expect(fn).toMatch(/externally_completed/);
  });

  test('it refuses an assessment that is not completed', () => {
    const fn = CODE.slice(CODE.indexOf('document/regenerate'));
    expect(fn).toMatch(/not_completed/);
  });
});

describe('download resolves the backend the document was written with', () => {
  test('getBackend is given the row backend, not the environment default', () => {
    expect(CODE).toMatch(/getBackend\(doc\.storage_backend \|\| 'db'\)/);
    // the bare call that ignored the row must be gone
    const dl = CODE.slice(CODE.indexOf("assessments/:id/document'"));
    expect(dl).not.toMatch(/getBackend\(\)\s*;/);
  });
});

describe('filenames carry no client identity', () => {
  test('the shared helper is dated and id-suffixed, never named', () => {
    expect(CODE).toMatch(/function completedFilename/);
    const fn = CODE.slice(CODE.indexOf('function completedFilename'), CODE.indexOf('async function storeDocument'));
    expect(fn).toMatch(/whodas-2\.0-36-item-/);
    expect(fn).not.toMatch(/client_name|clientName/);
  });

  test('every store path uses it', () => {
    const uses = CODE.match(/completedFilename\(/g) || [];
    expect(uses.length).toBeGreaterThanOrEqual(3);   // complete, regenerate, upload
  });
});

describe('client profile presentation', () => {
  /* The client profile drawer shows a SUMMARY and a way through to the
     assessment page. It used to render the whole library — instrument card,
     Start button, history table and, from there, the form itself. That put a
     clinical instrument inside a drawer whose other contents are appointment
     history, invoices and a "Book appointment" action, which is how starting
     an assessment came to read as part of the booking flow. */

  test('the drawer summarises, and links out to the assessment page', () => {
    expect(UI_CODE).toMatch(/function renderSummary/);
    expect(UI_CODE).toMatch(/data-whodas="open-page"/);
    expect(UI_CODE).toMatch(/Assess\.openForClient/);
  });

  test('the drawer never opens the form itself', () => {
    const summary = UI_CODE.slice(
      UI_CODE.indexOf('function renderSummary'),
      UI_CODE.indexOf('// \u2550\u2550 MODALS') === -1
        ? UI_CODE.indexOf('function closeModal')
        : UI_CODE.indexOf('function closeModal'));
    expect(summary).not.toMatch(/data-whodas="start"/);
    expect(summary).not.toMatch(/renderViewer|openAssessment/);
  });

  test('the three entry actions are offered, through the framework adapter', () => {
    // They moved to the full-page surface, which invokes them by name rather
    // than by rendering the buttons itself.
    expect(UI_CODE).toMatch(/startAssessment: startAssessment/);
    expect(UI_CODE).toMatch(/blankForm: blankForm/);
    expect(UI_CODE).toMatch(/uploadCompleted: uploadCompleted/);
    // And the confirm handlers they lead to are still wired.
    expect(UI_CODE).toMatch(/action === 'start-confirm'/);
    expect(UI_CODE).toMatch(/action === 'blank-confirm-download' \|\| action === 'blank-confirm-print'/);
    expect(UI_CODE).toMatch(/action === 'upload-confirm'/);
  });

  test('the upload dialog states that no score will be produced', () => {
    expect(UI).toMatch(/No score is calculated for an uploaded form/);
  });

  test('the upload posts to the client-scoped route', () => {
    expect(UI_CODE).toMatch(/'\/clients\/' \+ encodeURIComponent\(S\.clientId\) \+ '\/assessments\/upload'/);
  });
});

describe('multi-therapist readiness — no owner assumption is hard-coded', () => {
  test('assessments record the acting user, never a fixed owner', () => {
    expect(CODE).toMatch(/started_by_user_id/);
    expect(CODE).toMatch(/completed_by_user_id/);
    expect(CODE).not.toMatch(/owner_id\s*=|role === 'owner' \?/);
  });

  test('an assessment belongs to a client, not to the Splose connection identity', () => {
    expect(CODE).toMatch(/client_id/);
    expect(CODE).not.toMatch(/practitionerId.*assessment|assessment.*practitionerId/i);
  });
});
