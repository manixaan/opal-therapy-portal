'use strict';

/**
 * Builds branded Opal Therapy documents as DOCX and PDF from one spec.
 *
 * One spec, two renderers, so the Word and PDF versions cannot drift apart —
 * the alternative (author the DOCX, export a PDF by hand) is how a practice
 * ends up circulating two documents that say different things.
 *
 * ACCESSIBILITY, STATED HONESTLY
 * The DOCX uses real heading styles, marks table header rows to repeat, and
 * gives every image alt text, so Word's own accessibility checker and a screen
 * reader both get real structure.
 *
 * The PDF does NOT. pdf-lib cannot emit a tagged (PDF/UA) document, so the PDF
 * carries a text layer, document metadata and a reading order that matches its
 * visual order — but no tag tree. That is why the DOCX is the accessible master
 * and why every generated resource records `accessibility: 'pdf-untagged'`
 * rather than claiming a compliance it does not have.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/** FCA-aligned palette, from the handoff manifest. */
const PALETTE = {
  primary: '2F5651',
  secondary: '566E70',
  softMint: 'E4EFEB',
  warmBlush: 'F6EDE5',
  warmNeutral: 'FAF7F2',
  ink: '1F2A28',
};

const LOGO_PNG = '/Users/antonyxavier/Documents/Codex/2026-08-10/can-you-review-this-work-structure/'
  + 'outputs/opal-resource-hub/00_ADMIN/assets/opal-therapy-logo.png';

const LOGO_ALT = 'Opal Therapy logo';

function hexToRgb(hex) {
  return rgb(parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// ── DOCX ────────────────────────────────────────────────────────────────────

const TWIPS_PER_PAGE_WIDTH = 9026;   // A4 minus 2cm margins

function docxStyles() {
  const style = (id, name, size, color, bold, spacingBefore, outline) => `
    <w:style w:type="paragraph" w:styleId="${id}">
      <w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>
      <w:pPr>${outline !== undefined ? `<w:outlineLvl w:val="${outline}"/>` : ''}
        <w:spacing w:before="${spacingBefore}" w:after="120"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>
        <w:sz w:val="${size}"/>${bold ? '<w:b/>' : ''}<w:color w:val="${color}"/></w:rPr>
    </w:style>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr>
    <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:color w:val="${PALETTE.ink}"/>
  </w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:style>
  ${style('Title', 'Title', 40, PALETTE.primary, true, 0, 0)}
  ${style('Heading1', 'heading 1', 28, PALETTE.primary, true, 280, 0)}
  ${style('Heading2', 'heading 2', 24, PALETTE.secondary, true, 220, 1)}
  <w:style w:type="paragraph" w:styleId="Guidance"><w:name w:val="Guidance"/><w:basedOn w:val="Normal"/>
    <w:rPr><w:i/><w:color w:val="${PALETTE.secondary}"/><w:sz w:val="20"/></w:rPr></w:style>
</w:styles>`;
}

function docxParagraph(text, style, opts = {}) {
  return `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}`
    + `${opts.shading ? `<w:shd w:val="clear" w:fill="${opts.shading}"/>` : ''}`
    + '</w:pPr>'
    + `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}

/** A labelled writing area: a single-cell bordered box tall enough to write in. */
function docxWritingBox(label, lines = 3) {
  const height = 260 * lines;
  return `${docxParagraph(label, null)}
  <w:tbl>
    <w:tblPr><w:tblW w:w="${TWIPS_PER_PAGE_WIDTH}" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
        <w:left w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
        <w:bottom w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
        <w:right w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
      </w:tblBorders></w:tblPr>
    <w:tr><w:trPr><w:trHeight w:val="${height}"/></w:trPr>
      <w:tc><w:tcPr><w:tcW w:w="${TWIPS_PER_PAGE_WIDTH}" w:type="dxa"/></w:tcPr>
        <w:p/></w:tc></w:tr>
  </w:tbl>${docxParagraph('', null)}`;
}

/**
 * A table with a marked header row. `w:tblHeader` makes the row repeat across
 * pages AND is what assistive technology reads as the header — the two reasons
 * are the same markup, which is why it is never omitted.
 */
function docxTable(headers, rows) {
  const width = Math.floor(TWIPS_PER_PAGE_WIDTH / headers.length);
  const cell = (text, header) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>`
    + `${header ? `<w:shd w:val="clear" w:fill="${PALETTE.softMint}"/>` : ''}</w:tcPr>`
    + `<w:p><w:r>${header ? '<w:rPr><w:b/></w:rPr>' : ''}`
    + `<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p></w:tc>`;
  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>`
    + headers.map((h) => cell(h, true)).join('') + '</w:tr>';
  const bodyRows = rows.map((r) => `<w:tr><w:trPr><w:trHeight w:val="420"/></w:trPr>`
    + headers.map((_, i) => cell(r[i] || '', false)).join('') + '</w:tr>').join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${TWIPS_PER_PAGE_WIDTH}" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
      <w:left w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
      <w:bottom w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
      <w:right w:val="single" w:sz="6" w:color="${PALETTE.secondary}"/>
      <w:insideH w:val="single" w:sz="4" w:color="${PALETTE.secondary}"/>
      <w:insideV w:val="single" w:sz="4" w:color="${PALETTE.secondary}"/>
    </w:tblBorders></w:tblPr>${headerRow}${bodyRows}</w:tbl>${docxParagraph('', null)}`;
}

function docxLogo(hasLogo) {
  if (!hasLogo) return '';
  // descr carries the alt text — a logo without one is an unlabelled image to a
  // screen reader.
  return `<w:p><w:r><w:drawing>
    <wp:inline distT="0" distB="0" distL="0" distR="0"
      xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
      <wp:extent cx="1524000" cy="533400"/>
      <wp:docPr id="1" name="Picture 1" descr="${esc(LOGO_ALT)}"/>
      <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:nvPicPr><pic:cNvPr id="1" name="logo.png" descr="${esc(LOGO_ALT)}"/><pic:cNvPicPr/></pic:nvPicPr>
            <pic:blipFill><a:blip r:embed="rId10"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
              <a:stretch><a:fillRect/></a:stretch></pic:blipFill>
            <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1524000" cy="533400"/></a:xfrm>
              <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
          </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

async function buildDocx(spec) {
  const zip = new JSZip();
  const hasLogo = fs.existsSync(LOGO_PNG);

  const body = [];
  body.push(docxLogo(hasLogo));
  body.push(docxParagraph(spec.title, 'Title'));
  if (spec.subtitle) body.push(docxParagraph(spec.subtitle, 'Guidance'));

  for (const section of spec.sections) {
    if (section.heading) body.push(docxParagraph(section.heading, 'Heading1'));
    if (section.guidance) body.push(docxParagraph(section.guidance, 'Guidance'));
    for (const p of section.paragraphs || []) body.push(docxParagraph(p, null));
    for (const f of section.fields || []) body.push(docxWritingBox(f.label, f.lines || 3));
    if (section.table) body.push(docxTable(section.table.headers, section.table.rows));
  }

  if (spec.limitations && spec.limitations.length) {
    body.push(docxParagraph('Limitations of this document', 'Heading1'));
    for (const l of spec.limitations) body.push(docxParagraph(`• ${l}`, null));
  }
  body.push(docxParagraph(spec.footer, 'Guidance'));

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`);

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`);

  // Language is set so a screen reader pronounces the document correctly.
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">
  <dc:title>${esc(spec.title)}</dc:title>
  <dc:creator>Opal Therapy</dc:creator>
  <cp:lastModifiedBy>Opal Therapy</cp:lastModifiedBy>
  <dc:language>en-AU</dc:language>
  <cp:contentStatus>Draft - clinical review required</cp:contentStatus>
</cp:coreProperties>`);

  zip.file('word/styles.xml', docxStyles());
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  ${hasLogo ? '<Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.png"/>' : ''}
</Relationships>`);
  if (hasLogo) zip.file('word/media/logo.png', fs.readFileSync(LOGO_PNG));

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body.join('\n')}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/>
      <w:docGrid w:linePitch="360"/></w:sectPr>
  </w:body></w:document>`);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── PDF ─────────────────────────────────────────────────────────────────────

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 48;

async function buildPdf(spec) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(spec.title);
  pdf.setAuthor('Opal Therapy');
  pdf.setSubject(spec.subtitle || '');
  pdf.setProducer('Opal Therapy Portal');
  pdf.setLanguage('en-AU');

  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const logo = fs.existsSync(LOGO_PNG) ? await pdf.embedPng(fs.readFileSync(LOGO_PNG)) : null;

  let page = pdf.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;
  const width = A4.w - MARGIN * 2;

  const newPage = () => { page = pdf.addPage([A4.w, A4.h]); y = A4.h - MARGIN; };
  const need = (h) => { if (y - h < MARGIN + 24) newPage(); };

  const wrap = (text, font, size, maxWidth) => {
    const words = String(text).split(/\s+/);
    const lines = [];
    let line = '';
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) { lines.push(line); line = w; }
      else line = candidate;
    }
    if (line) lines.push(line);
    return lines;
  };

  const text = (s, { font = regular, size = 10.5, color = PALETTE.ink, gap = 4 } = {}) => {
    for (const line of wrap(s, font, size, width)) {
      need(size + gap);
      page.drawText(line, { x: MARGIN, y: y - size, size, font, color: hexToRgb(color) });
      y -= size + gap;
    }
  };

  if (logo) {
    const dims = logo.scaleToFit(150, 52);
    need(dims.height + 12);
    page.drawImage(logo, { x: MARGIN, y: y - dims.height, width: dims.width, height: dims.height });
    y -= dims.height + 14;
  }

  text(spec.title, { font: bold, size: 19, color: PALETTE.primary, gap: 7 });
  if (spec.subtitle) text(spec.subtitle, { font: italic, size: 10, color: PALETTE.secondary, gap: 8 });
  y -= 6;

  for (const section of spec.sections) {
    if (section.heading) {
      y -= 8;
      // A heading must not be the last thing on a page. Reserve room for the
      // heading AND whatever follows it, so the break lands above the heading
      // rather than immediately below it.
      let firstBlock = 0;
      if (section.guidance) {
        firstBlock = wrap(section.guidance, italic, 9.5, width).length * 14.5;
      } else if (section.paragraphs && section.paragraphs.length) {
        firstBlock = Math.min(wrap(section.paragraphs[0], regular, 10.5, width).length, 3) * 14.5;
      } else if (section.fields && section.fields.length) {
        firstBlock = wrap(section.fields[0].label, bold, 10.5, width).length * 15.5
          + 16 * (section.fields[0].lines || 3) + 12;
      } else if (section.table) {
        firstBlock = 48;                                   // header row plus one
      }
      need(19 + firstBlock);
      text(section.heading, { font: bold, size: 13, color: PALETTE.primary, gap: 6 });
    }
    if (section.guidance) text(section.guidance, { font: italic, size: 9.5, color: PALETTE.secondary, gap: 5 });
    for (const p of section.paragraphs || []) text(p);

    for (const f of section.fields || []) {
      const boxH = 16 * (f.lines || 3);
      // Break BEFORE the label if the label and its box will not fit together.
      // Checking them separately strands a label at the foot of a page with its
      // writing area overleaf, which reads as an unlabelled box.
      const labelLines = wrap(f.label, bold, 10.5, width).length;
      need(labelLines * 15.5 + boxH + 12);
      text(f.label, { font: bold, size: 10.5, gap: 5 });
      page.drawRectangle({
        x: MARGIN, y: y - boxH, width, height: boxH,
        color: hexToRgb(PALETTE.warmNeutral),
        borderColor: hexToRgb(PALETTE.secondary), borderWidth: 0.7,
      });
      // Ruled writing lines, so the space is usable by hand.
      for (let i = 1; i < (f.lines || 3); i += 1) {
        const ly = y - (boxH / (f.lines || 3)) * i;
        page.drawLine({
          start: { x: MARGIN + 6, y: ly }, end: { x: MARGIN + width - 6, y: ly },
          thickness: 0.4, color: hexToRgb(PALETTE.softMint),
        });
      }
      y -= boxH + 12;
    }

    if (section.table) {
      // Cells WRAP. They are never truncated: a clinical instruction cut off
      // mid-word ("where swallowing is unsafe — s") is worse than no
      // instruction, because it still looks like guidance.
      const { headers, rows } = section.table;
      const colW = width / headers.length;
      const pad = 5;
      const cellW = colW - pad * 2;
      const lineH = 12;
      const size = 9.5;

      const layout = (cells, font) => {
        const wrapped = cells.map((c) => (c ? wrap(String(c), font, size, cellW) : []));
        const lines = Math.max(1, ...wrapped.map((w) => w.length));
        return { wrapped, height: lines * lineH + pad * 2 };
      };

      const drawRow = (cells, font, { fill, border }) => {
        const { wrapped, height } = layout(cells, font);
        // Keep a row whole rather than splitting it across a page break.
        if (y - height < MARGIN + 24) newPage();
        page.drawRectangle({
          x: MARGIN, y: y - height, width, height,
          ...(fill ? { color: hexToRgb(fill) } : {}),
          ...(border ? { borderColor: hexToRgb(border), borderWidth: 0.5 } : {}),
        });
        wrapped.forEach((lines, i) => {
          lines.forEach((line, n) => {
            page.drawText(line, {
              x: MARGIN + colW * i + pad,
              y: y - pad - (n + 1) * lineH + 3,
              size,
              font,
              color: hexToRgb(fill ? PALETTE.primary : PALETTE.ink),
            });
          });
        });
        y -= height;
      };

      need(60);
      drawRow(headers, bold, { fill: PALETTE.softMint });
      rows.forEach((r) => drawRow(headers.map((_, i) => r[i] || ''), regular,
        { border: PALETTE.secondary }));
      y -= 10;
    }
  }

  if (spec.limitations && spec.limitations.length) {
    y -= 8;
    text('Limitations of this document', { font: bold, size: 13, color: PALETTE.primary, gap: 6 });
    for (const l of spec.limitations) text(`•  ${l}`, { size: 10 });
  }

  y -= 10;
  text(spec.footer, { font: italic, size: 9, color: PALETTE.secondary });

  return Buffer.from(await pdf.save());
}

module.exports = { PALETTE, LOGO_PNG, LOGO_ALT, buildDocx, buildPdf };
