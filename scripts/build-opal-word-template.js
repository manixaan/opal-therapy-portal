#!/usr/bin/env node
'use strict';

/**
 * Builds the Opal Word template — office-addin/templates/Opal-Document-Template.dotx
 * and the copy the portal serves at /office/Opal-Document-Template.dotx.
 *
 * The template carries what an add-in cannot set from inside Word: page
 * margins, the rule beneath each heading, headings that start a new page,
 * numbered headings, the running header and the "Page X of Y" footer. Its
 * values are the Opal Document Standard v1 (structure from the reference
 * report, colour from the FCA master) — the same numbers as
 * frontend/current/assist-word-format.js, which is checked by a test.
 *
 * Usage:  node scripts/build-opal-word-template.js
 * No content from any client document is used: every part is written here.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require(path.join(__dirname, '../backend/node_modules/jszip'));

const C = { primary: '2F5651', ink: '263633', slate: '566E70', mint: 'C5E1CC', mist: 'F4F7F5', sage: 'E8F1EC', paper: 'FAF7F2' };
const FONT = 'Arial';
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

const rPr = ({ size, bold, color, caps, italic }) => `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:cs="${FONT}"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${caps ? '<w:caps/>' : ''}<w:color w:val="${color}"/><w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/></w:rPr>`;
const rule = (sz) => `<w:pBdr><w:bottom w:val="single" w:sz="${sz}" w:space="1" w:color="${C.primary}"/></w:pBdr>`;

/** One paragraph style. before/after in points. */
function pStyle({ id, name, basedOn = 'Normal', next, size, bold, color, caps, italic, before = 0, after = 0, keepNext, pageBreakBefore, outline, border, numLevel, ind, jc, tabs, uiPriority, quick = true, shade }) {
  return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''}<w:next w:val="${next || 'Normal'}"/>`
    + `${uiPriority ? `<w:uiPriority w:val="${uiPriority}"/>` : ''}${quick ? '<w:qFormat/>' : ''}<w:pPr>${keepNext ? '<w:keepNext/><w:keepLines/>' : ''}${pageBreakBefore ? '<w:pageBreakBefore/>' : ''}`
    + `${numLevel !== undefined ? `<w:numPr><w:ilvl w:val="${numLevel}"/><w:numId w:val="1"/></w:numPr>` : ''}${border ? rule(border) : ''}${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}${tabs || ''}`
    + `<w:spacing w:before="${before * 20}" w:after="${after * 20}" w:line="240" w:lineRule="auto"/>${ind || ''}${jc ? `<w:jc w:val="${jc}"/>` : ''}`
    + `${outline !== undefined ? `<w:outlineLvl w:val="${outline}"/>` : ''}</w:pPr>${rPr({ size, bold, color, caps, italic })}</w:style>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}><w:docDefaults><w:rPrDefault>${rPr({ size: 11, color: C.ink })}</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/></w:pPr>${rPr({ size: 11, color: C.ink })}</w:style>
<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>
<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
${pStyle({ id: 'Title', name: 'Title', size: 30, bold: true, color: C.primary, after: 8, keepNext: true })}
${pStyle({ id: 'Subtitle', name: 'Subtitle', size: 13, color: C.slate, after: 12, keepNext: true })}
${pStyle({ id: 'Heading1', name: 'heading 1', size: 14, bold: true, color: C.primary, before: 18, after: 12, keepNext: true, pageBreakBefore: true, outline: 0, border: 12, numLevel: 0, uiPriority: 9 })}
${pStyle({ id: 'Heading2', name: 'heading 2', size: 11, bold: true, color: C.primary, before: 18, after: 6, keepNext: true, outline: 1, border: 12, numLevel: 1, uiPriority: 9 })}
${pStyle({ id: 'Heading3', name: 'heading 3', size: 11, color: C.slate, before: 12, after: 6, keepNext: true, outline: 2, border: 4, numLevel: 2, uiPriority: 9 })}
${pStyle({ id: 'Heading4', name: 'heading 4', size: 11, color: C.slate, before: 12, after: 6, keepNext: true, outline: 3, numLevel: 3, uiPriority: 9 })}
${pStyle({ id: 'AppendixHeading', name: 'Opal Appendix Heading', next: 'Normal', size: 14, bold: true, color: C.primary, before: 18, after: 12, keepNext: true, pageBreakBefore: true, outline: 0, border: 12 })}
${pStyle({ id: 'ContentsHeading', name: 'Opal Contents Heading', size: 14, bold: true, color: C.primary, before: 18, after: 12, keepNext: true, pageBreakBefore: true, border: 12 })}
${pStyle({ id: 'Caption', name: 'caption', size: 9, bold: true, color: C.primary, before: 12, after: 0, keepNext: true, uiPriority: 35 })}
${pStyle({ id: 'ListParagraph', name: 'List Paragraph', size: 11, color: C.ink, before: 3, after: 3, ind: '<w:ind w:left="720"/>', uiPriority: 34 })}
${pStyle({ id: 'OpalBullet', name: 'Opal Bullet', size: 11, color: C.ink, before: 2, after: 2, ind: '<w:ind w:left="540" w:hanging="270"/>' }).replace('<w:pPr>', '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr>')}
${pStyle({ id: 'OpalKeyFinding', name: 'Opal Key Finding', size: 11, color: C.primary, before: 5, after: 9, shade: C.sage, ind: '<w:ind w:left="245" w:right="144"/>' }).replace('<w:pPr>', `<w:pPr><w:pBdr><w:left w:val="single" w:sz="28" w:space="8" w:color="${C.primary}"/></w:pBdr>`)}
${pStyle({ id: 'OpalRecommendation', name: 'Opal Recommendation', size: 10, color: C.ink, before: 5, after: 8, shade: C.paper, ind: '<w:ind w:left="245" w:right="144"/>' }).replace('<w:pPr>', `<w:pPr><w:pBdr><w:left w:val="single" w:sz="28" w:space="8" w:color="${C.mint}"/></w:pBdr>`)}
${pStyle({ id: 'TableText', name: 'Opal Table Text', size: 9, color: C.ink, before: 3, after: 3 })}
${pStyle({ id: 'TableHeading', name: 'Opal Table Heading', size: 9, bold: true, color: 'FFFFFF', before: 3, after: 3 })}
${pStyle({ id: 'TOC1', name: 'toc 1', size: 11, bold: true, caps: true, color: C.primary, after: 5, tabs: '<w:tabs><w:tab w:val="left" w:pos="567"/><w:tab w:val="right" w:leader="dot" w:pos="10456"/></w:tabs>', uiPriority: 39, quick: false })}
${pStyle({ id: 'TOC2', name: 'toc 2', size: 11, color: C.ink, after: 5, ind: '<w:ind w:left="567"/>', tabs: '<w:tabs><w:tab w:val="left" w:pos="1276"/><w:tab w:val="right" w:leader="dot" w:pos="10456"/></w:tabs>', uiPriority: 39, quick: false })}
${pStyle({ id: 'TOC3', name: 'toc 3', size: 10, color: C.slate, after: 5, ind: '<w:ind w:left="1276"/>', tabs: '<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="10456"/></w:tabs>', uiPriority: 39, quick: false })}
${pStyle({ id: 'Header', name: 'header', size: 9, caps: true, color: C.slate, tabs: '<w:tabs><w:tab w:val="right" w:pos="10456"/></w:tabs>', uiPriority: 99, quick: false })}
${pStyle({ id: 'Footer', name: 'footer', size: 9, color: C.primary, tabs: '<w:tabs><w:tab w:val="right" w:pos="10456"/></w:tabs>', uiPriority: 99, quick: false })}
<w:style w:type="table" w:styleId="OpalTable"><w:name w:val="Opal Table"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="59"/><w:qFormat/>
<w:pPr><w:spacing w:before="60" w:after="60" w:line="240" w:lineRule="auto"/></w:pPr>${rPr({ size: 9, color: C.ink })}
<w:tblPr><w:tblStyleRowBandSize w:val="1"/><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="${C.primary}"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${C.primary}"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="${C.mint}"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="${C.mint}"/></w:tblBorders><w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr>
<w:tcPr><w:vAlign w:val="center"/></w:tcPr>
<w:tblStylePr w:type="firstRow"><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:color w:val="FFFFFF"/></w:rPr><w:trPr><w:tblHeader/></w:trPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${C.primary}"/></w:tcPr></w:tblStylePr>
<w:tblStylePr w:type="band2Horz"><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="${C.mist}"/></w:tcPr></w:tblStylePr>
</w:style>
</w:styles>`;

const lvl = (i, text, left, hanging) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:pStyle w:val="Heading${i + 1}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="${hanging}"/></w:pPr></w:lvl>`;
const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="multilevel"/>${lvl(0, '%1', 567, 567)}${lvl(1, '%1.%2', 709, 709)}${lvl(2, '%1.%2.%3', 851, 851)}${lvl(3, '%1.%2.%3.%4', 992, 992)}</w:abstractNum>
<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="540" w:hanging="270"/></w:pPr><w:rPr><w:color w:val="${C.primary}"/></w:rPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;

const p = (style, text) => `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${text ? `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>` : ''}</w:p>`;
const field = (code, shown) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>${shown}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
const cell = (w, style, text) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/></w:tcPr>${p(style, text)}</w:tc>`;
const row = (cells, head) => `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}${cells.map((c) => cell(c[0], head ? 'TableHeading' : 'TableText', c[1])).join('')}</w:tr>`;
const table = `<w:tbl><w:tblPr><w:tblStyle w:val="OpalTable"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="0420" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid><w:gridCol w:w="3485"/><w:gridCol w:w="3485"/><w:gridCol w:w="3486"/></w:tblGrid>`
  + row([[3485, 'Area'], [3485, 'Finding'], [3486, 'Recommendation']], true)
  + row([[3485, 'Replace this text'], [3485, 'Replace this text'], [3486, 'Replace this text']])
  + row([[3485, 'Replace this text'], [3485, 'Replace this text'], [3486, 'Replace this text']]) + '</w:tbl>';

// A4; top margin leaves room for the running header; the other three match the reference report.
const sect = '<w:sectPr><w:headerReference w:type="default" r:id="rId10"/><w:footerReference w:type="default" r:id="rId11"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="720" w:bottom="1134" w:left="720" w:header="567" w:footer="454" w:gutter="0"/><w:titlePg/></w:sectPr>';

const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>
${p('Title', 'Document title')}${p('Subtitle', 'Subtitle, client initials or reference, and date')}
${p('ContentsHeading', 'Contents')}
<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>${field('TOC \\o "1-3" \\h \\z \\u', 'Right-click here and choose Update Field, or press Update contents in Opal Assist.')}</w:p>
${p('Heading1', 'Introduction')}${p('Normal', 'Body text is Arial 11 pt. Each main heading starts a new page, is numbered, and carries a rule beneath it. Type over this text.')}
${p('Heading2', 'Second-level heading')}${p('Normal', 'Replace this text.')}${p('OpalBullet', 'A bullet point')}${p('OpalBullet', 'Another bullet point')}
${p('Heading3', 'Third-level heading')}${p('OpalKeyFinding', 'Key finding: use this style for the one thing the reader must not miss.')}${p('OpalRecommendation', 'Recommendation: use this style for each recommendation.')}
${p('Caption', 'Table 1: Replace this caption')}${table}${p('Normal', '')}
${p('AppendixHeading', 'Appendix A: Replace this title')}${p('Normal', 'Replace this text. Every appendix mentioned in the report needs a heading like the one above; Check document in Opal Assist confirms it.')}
${sect}</w:body></w:document>`;

const header = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}><w:p><w:pPr><w:pStyle w:val="Header"/><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="${C.mint}"/></w:pBdr></w:pPr><w:r><w:t>Opal Therapy</w:t></w:r><w:r><w:tab/></w:r>${field('STYLEREF "Title"', 'Document title')}</w:p></w:hdr>`;
const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}><w:p><w:pPr><w:pStyle w:val="Footer"/></w:pPr><w:r><w:t>Confidential</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t xml:space="preserve">Page </w:t></w:r>${field('PAGE', '1')}<w:r><w:t xml:space="preserve"> of </w:t></w:r>${field('NUMPAGES', '1')}</w:p></w:ftr>`;
const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings ${NS}><w:updateFields w:val="false"/><w:defaultTabStop w:val="567"/><w:characterSpacingControl w:val="doNotCompress"/><w:themeFontLang w:val="en-AU"/></w:settings>`;

const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Opal"><a:themeElements><a:clrScheme name="Opal">`
  + `<a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="${C.primary}"/></a:dk2><a:lt2><a:srgbClr val="${C.paper}"/></a:lt2>`
  + `<a:accent1><a:srgbClr val="${C.primary}"/></a:accent1><a:accent2><a:srgbClr val="${C.mint}"/></a:accent2><a:accent3><a:srgbClr val="BFCDCE"/></a:accent3><a:accent4><a:srgbClr val="F6EDE5"/></a:accent4><a:accent5><a:srgbClr val="${C.slate}"/></a:accent5><a:accent6><a:srgbClr val="86A0A2"/></a:accent6>`
  + `<a:hlink><a:srgbClr val="${C.primary}"/></a:hlink><a:folHlink><a:srgbClr val="${C.slate}"/></a:folHlink></a:clrScheme>`
  + `<a:fontScheme name="Opal"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>`
  + '<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>'
  + '<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>'
  + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
  + '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const contentTypes = (main) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
  + `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${main}.main+xml"/>`
  + ['styles', 'numbering', 'settings'].map((n) => `<Override PartName="/word/${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n}+xml"/>`).join('')
  + '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'
  + '<Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';

async function build(main) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes(main));
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="${REL}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="${REL}/settings" Target="settings.xml"/><Relationship Id="rId4" Type="${REL}/theme" Target="theme/theme1.xml"/><Relationship Id="rId10" Type="${REL}/header" Target="header1.xml"/><Relationship Id="rId11" Type="${REL}/footer" Target="footer1.xml"/></Relationships>`);
  zip.file('word/document.xml', document); zip.file('word/styles.xml', styles); zip.file('word/numbering.xml', numbering);
  zip.file('word/settings.xml', settings); zip.file('word/header1.xml', header); zip.file('word/footer1.xml', footer); zip.file('word/theme/theme1.xml', theme);
  zip.file('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Opal Document Template</dc:title><dc:creator>Opal Therapy</dc:creator></cp:coreProperties>');
  // A fixed date keeps the file byte-identical between builds, so a rebuild is not a diff.
  Object.values(zip.files).forEach((f) => { f.date = new Date('2026-09-20T00:00:00Z'); });
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

(async () => {
  const root = path.join(__dirname, '..');
  const outs = [['template', 'office-addin/templates/Opal-Document-Template.dotx'], ['template', 'frontend/current/office/Opal-Document-Template.dotx']];
  for (const [main, rel] of outs) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, await build(main));
    console.log('wrote', rel);
  }
})().catch((err) => { console.error(err); process.exit(1); });

module.exports = { C, FONT };
