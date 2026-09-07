'use strict';

/**
 * PLACEHOLDER DOCUMENT — a one-page PDF that stands in for a practice
 * document the Owner has not uploaded yet, so a pack can be assembled,
 * previewed and sent end to end before the real forms are in. The file
 * name and the page both say what it is, and Edit Onboarding replaces it.
 */

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const PLACEHOLDER_PREFIX = 'PLACEHOLDER - ';
const isPlaceholderName = (name) => String(name || '').startsWith(PLACEHOLDER_PREFIX);

async function buildPlaceholderPdf({ title, note }) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${PLACEHOLDER_PREFIX}${title}`);
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.18, 0.34, 0.32); const soft = rgb(0.34, 0.43, 0.44);
  page.drawText('OPAL THERAPY', { x: 56, y: 780, size: 9, font: bold, color: soft });
  page.drawText('PLACEHOLDER', { x: 56, y: 700, size: 30, font: bold, color: ink });
  page.drawText(String(title || 'Document'), { x: 56, y: 664, size: 18, font: bold, color: ink });
  const lines = [
    'This page stands in for the practice\'s own document while the pack is set up.',
    'Replace it in the portal under Onboarding > Edit onboarding > Onboarding Documentation,',
    'by uploading the real file against this document. Every new onboarding then sends the real one.',
    '',
    note || '',
  ];
  let y = 620;
  for (const line of lines) { if (line) page.drawText(line, { x: 56, y, size: 10.5, font, color: soft }); y -= 16; }
  return Buffer.from(await pdf.save());
}

module.exports = { buildPlaceholderPdf, PLACEHOLDER_PREFIX, isPlaceholderName };
