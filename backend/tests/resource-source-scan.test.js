'use strict';

/**
 * The source scanner's judgement calls.
 *
 * Everything tested here decides something a human would otherwise have to:
 * what a file is called, whether two files are the same file, and whether a
 * document is about a person. The I/O around them is uninteresting; these are
 * the parts that can be quietly wrong for six hundred files at a time.
 *
 * Requiring the scanner must not walk the vault — that is asserted first,
 * because every other test here depends on it.
 */

const path = require('path');

const scan = require('../setup/scan-resource-source.js');

describe('importing the scanner is inert', () => {
  test('it exports its decision functions without scanning anything', () => {
    // If requiring the module had run main(), the process would have exited
    // before reaching this assertion.
    expect(typeof scan.friendlyTitle).toBe('function');
    expect(typeof scan.privacyFromEvidence).toBe('function');
  });
});

describe('filename normalisation', () => {
  const t = scan.friendlyTitle;

  test('vendor download codes and version suffixes are removed', () => {
    expect(t('au-s-2548656-an-introduction-to-adhd_ver_1.pdf')).toBe('An Introduction To ADHD');
    expect(t('t-c-254664-my-main-worries-activity-sheet-english_ver_3.pdf'))
      .toBe('My Main Worries Activity Sheet English');
  });

  test('stacked clutter is stripped even when one marker hides another', () => {
    // ` (1)` sits after `_ver_1`, so a single pass leaves the version stranded.
    expect(t('social-skills-scenarios-super-pack_ver_1 (1).zip'))
      .toBe('Social Skills Scenarios Super Pack');
  });

  test('a name that identifies nothing becomes no name at all', () => {
    expect(t('3f2504e0-4f89-11d3-9a0c-0305e82c3301.pdf')).toBeNull();
    expect(t('a3f9c2b1e7d84a6f0b2c9e1d.pdf')).toBeNull();
  });

  test('clinically load-bearing acronyms and versions survive', () => {
    expect(t('MOHOST_AssessmentForms_UK.pdf')).toBe('MOHOST AssessmentForms UK');
    expect(t('SDA-flowchart_.pdf')).toBe('SDA Flowchart');
    expect(t('NDIS price guide v2.docx')).toBe('NDIS Price Guide v2');
    expect(t('COPM Booklet.pdf')).toBe('COPM Booklet');
  });

  test('hyphenated names are not shattered into separated letters', () => {
    // The regression this pins: separators were expanded before the noise
    // patterns ran, producing "Au - S - 2548656 - An - Introduction - To - ADHD".
    expect(t('lazy-8-breathing.pdf')).toBe('Lazy 8 Breathing');
    expect(t('cbt-for-kids.pdf')).not.toMatch(/ - /);
  });
});

describe('canonical slugs', () => {
  const slug = scan.canonicalSlug;

  test('are filesystem- and storage-safe', () => {
    expect(slug("Jordan's plan: stage 2 (final)", 'x')).toBe('jordans-plan-stage-2-final');
    expect(slug('a/b\\c*d?e', 'x')).toBe('a-b-c-d-e');
  });

  test('are deterministic and bounded', () => {
    const long = 'word '.repeat(60);
    expect(slug(long, 'x')).toBe(slug(long, 'x'));
    expect(slug(long, 'x').length).toBeLessThanOrEqual(90);
    expect(slug('', '')).toBe('resource');
  });

  test('never begin or end with a separator', () => {
    expect(slug('---hello---', 'x')).toBe('hello');
  });
});

describe('personal-information detection', () => {
  const textSignals = (s) => {
    const r = scan.newPiiReport();
    scan.scanText(s, r);
    return r;
  };

  test('a filled label is a disclosure', () => {
    expect(textSignals('Client: Jane Smith').strongCount).toBe(1);
    expect(textSignals('client: Jane').strongCount).toBe(1);
    expect(textSignals('Participant Name: Alex Brown').strongCount).toBe(1);
  });

  test('a blank label is a worksheet, not a disclosure', () => {
    // This distinction is why the quarantine set is 49 files and not 113.
    expect(textSignals('Client: ________').strongCount).toBe(0);
    expect(textSignals('Client:').strongCount).toBe(0);
    expect(textSignals('Client: ......').strongCount).toBe(0);
    expect(textSignals('Client: see attached').strongCount).toBe(0);
  });

  test('participant and medicare numbers are strong evidence', () => {
    expect(textSignals('NDIS 430123456').signals['ndis-participant-number']).toBe(1);
    expect(textSignals('Medicare 2123 45678 1').signals['medicare-number']).toBe(1);
  });

  test('a date-of-birth label needs an actual date', () => {
    expect(textSignals('DOB: 14/03/1998').strongCount).toBe(1);
    expect(textSignals('Date of birth: ___/___/___').strongCount).toBe(0);
  });

  test('contact details are recorded but never quarantine anything', () => {
    // 123 files carry a publisher's support address in a footer. Treating that
    // as client data would quarantine most of the vault for being published.
    const r = textSignals('Questions? support@twinkl.co.uk or 08 9123 4567');
    expect(r.signals['email-address']).toBe(1);
    expect(r.signals['australian-phone-number']).toBe(1);
    expect(r.contactCount).toBe(2);
    expect(r.strongCount).toBe(0);
    expect(r.weakCount).toBe(0);
    expect(scan.privacyFromEvidence(r)).toBe('no-obvious-pii');
  });

  test('a personal name in a filename is weak evidence', () => {
    const r = scan.newPiiReport();
    scan.scanFilename("Jordan's strategy sheet.docx", r);
    expect(r.weakCount).toBe(1);
    expect(scan.privacyFromEvidence(r)).toBe('privacy-review');
  });

  test('ordinary possessives and eponymous conditions are not names', () => {
    for (const name of ["Children's routine chart.docx", "Alzheimer's guide.pdf",
      "Parkinson's exercises.pdf", "today's plan.docx", "the child's needs.pdf"]) {
      const r = scan.newPiiReport();
      scan.scanFilename(name, r);
      expect({ name, weak: r.weakCount }).toEqual({ name, weak: 0 });
    }
  });

  test('uncertainty resolves to quarantine, never to publication', () => {
    expect(scan.privacyFromEvidence({ strongCount: 1, weakCount: 0, contactCount: 0 }))
      .toBe('client-confidential');
    expect(scan.privacyFromEvidence({ strongCount: 0, weakCount: 1, contactCount: 0 }))
      .toBe('privacy-review');
    expect(scan.privacyFromEvidence({ strongCount: 0, weakCount: 0, contactCount: 9 }))
      .toBe('no-obvious-pii');
  });
});

describe('path redaction', () => {
  test('the containing folder is kept and the filename dropped', () => {
    expect(scan.redactedContainer('PAEDS/SENSORY/Some Child Plan.docx')).toBe('PAEDS/SENSORY/…');
    expect(scan.redactedContainer('loose-file.pdf')).toBe('…');
  });

  test('the client root is recognised whatever its case', () => {
    expect(scan.isClientPath('CLIENTS/a/b.pdf')).toBe(true);
    expect(scan.isClientPath('clients/a.pdf')).toBe(true);
    expect(scan.isClientPath('PAEDS/clients-are-people.pdf')).toBe(false);
    expect(scan.isClientPath('')).toBe(false);
  });
});

describe('format sniffing judges bytes, not names', () => {
  test('a PDF is recognised by its header', () => {
    expect(scan.sniff(Buffer.from('%PDF-1.7\n...')).ext).toBe('pdf');
  });

  test('OOXML and legacy Office are distinguished by container', () => {
    expect(scan.sniff(Buffer.from([0x50, 0x4b, 0x03, 0x04])).ext).toBe('zip');
    expect(scan.sniff(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])).ext).toBe('ole');
  });

  test('unrecognised bytes are not guessed at', () => {
    expect(scan.sniff(Buffer.from('just some text'))).toBeNull();
  });
});

describe('OOXML text extraction keeps runs apart', () => {
  test('a label and its value do not fuse into one token', () => {
    // Word splits a line across runs freely. Concatenating without a separator
    // turns `Client:` + ` Jane` into `Client:Jane` and hides it from the
    // detector that exists to find it.
    const xml = '<w:p><w:r><w:t>Client:</w:t></w:r><w:r><w:t>Jane Smith</w:t></w:r></w:p>';
    const text = scan.ooxmlPartText(xml);
    expect(text).toMatch(/Client:\s+Jane Smith/);
    const r = scan.newPiiReport();
    scan.scanText(text, r);
    expect(r.strongCount).toBe(1);
  });
});

describe('the path key', () => {
  const crypto = require('crypto');
  const key = (p) => crypto.createHmac('sha256', scan.PATH_KEY_SALT).update(p).digest('hex').slice(0, 32);

  test('is stable for the same path and distinct for different ones', () => {
    expect(key('PAEDS/a.pdf')).toBe(key('PAEDS/a.pdf'));
    expect(key('PAEDS/a.pdf')).not.toBe(key('PAEDS/b.pdf'));
  });

  test('does not contain the path it was built from', () => {
    expect(key('CLIENTS/Some Person/plan.pdf')).not.toMatch(/CLIENTS|Person|plan/i);
    expect(key('CLIENTS/Some Person/plan.pdf')).toMatch(/^[0-9a-f]{32}$/);
  });

  test('gives duplicated content distinct ids, unlike a checksum', () => {
    // Two byte-identical copies need two register rows; ids keyed on content
    // would collide and lose one of them.
    expect(key('PAEDS/copy-a.pdf')).not.toBe(key('OTHER/copy-a.pdf'));
  });
});
