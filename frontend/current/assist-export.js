/**
 * Opal Assist — download a document reply as Word (.docx) or PowerPoint (.pptx).
 *
 * Built ENTIRELY IN THIS BROWSER from the document already on screen
 * ({ kind, title, blocks: [{ t:'h'|'p'|'li', text, lead? }] }, tokens in the
 * text). Names are put back here, from this browser's own name map, exactly as
 * Copy does — the file is never sent to the server, the AI or anyone else, and
 * this file makes no network call except loading the portal's own vendored
 * jszip. The FILE NAME never carries a name: tokens in the title read as roles
 * ("the client"), because file names are synced and indexed.
 *
 * Pure part builders (docxParts, pptxParts, slidesFor) are exported for node
 * tests; download() needs a document.
 */
(function (global) {
  'use strict';

  var PRIMARY = '2F5651';
  var FONT = 'Arial';
  var DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

  function DOC() { return global.OpalAssistDoc || (typeof require === 'function' ? require('./assist-doc.js') : null); }

  /** XML-safe text: escaped, and characters XML 1.0 forbids dropped. */
  function x(s) {
    return String(s == null ? '' : s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** The document with names back in (lead and text restored, tokens gone). */
  function restored(doc, names, style) {
    var D = DOC();
    return {
      kind: doc && doc.kind,
      title: doc && doc.title ? D.restoreText(doc.title, names, style) : '',
      blocks: (doc && doc.blocks || []).map(function (b) {
        var o = { t: b.t, text: D.restoreText(b.text, names, style) };
        if (b.lead) o.lead = D.restoreText(b.lead, names, style);
        return o;
      }),
    };
  }

  /** A safe file name: tokens read as roles, never names; no path characters. */
  function fileName(doc, ext) {
    var D = DOC();
    var base = doc && doc.title ? D.restoreText(doc.title, {}, 'first') : (doc && doc.kind === 'casenote' ? 'Case note' : 'Opal Assist document');
    base = base.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Opal Assist document';
    return base + '.' + ext;
  }

  var XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  var R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  var REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  var PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

  function rels(list) {
    return XML_HEAD + '<Relationships xmlns="' + PKG_REL + '">'
      + list.map(function (r) { return '<Relationship Id="' + r[0] + '" Type="' + REL + r[1] + '" Target="' + r[2] + '"/>'; }).join('')
      + '</Relationships>';
  }

  // ── Word ───────────────────────────────────────────────────────────────────
  /** Runs for one line of text; a newline inside a block becomes a line break. */
  function wRuns(text, bold) {
    var rPr = bold ? '<w:rPr><w:b/></w:rPr>' : '';
    return String(text || '').split('\n').map(function (line, i) {
      return '<w:r>' + rPr + (i ? '<w:br/>' : '') + '<w:t xml:space="preserve">' + x(line) + '</w:t></w:r>';
    }).join('');
  }
  function wPara(style, body) {
    return '<w:p>' + (style ? '<w:pPr><w:pStyle w:val="' + style + '"/></w:pPr>' : '') + body + '</w:p>';
  }

  function docxParts(doc, names, style) {
    var d = restored(doc, names, style);
    var body = '';
    if (d.title) body += wPara('Title', wRuns(d.title));
    d.blocks.forEach(function (b) {
      if (b.t === 'h') body += wPara('Heading1', wRuns(b.text));
      else if (b.t === 'li') body += wPara('ListBullet', (b.lead ? wRuns(b.lead + ': ', true) : '') + wRuns(b.text));
      else body += wPara(null, wRuns(b.text));
    });
    if (!body) body = '<w:p/>';
    var W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    return {
      '[Content_Types].xml': XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        + '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        + '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
        + '</Types>',
      '_rels/.rels': rels([['rId1', 'officeDocument', 'word/document.xml']]),
      'word/_rels/document.xml.rels': rels([['rId1', 'styles', 'styles.xml'], ['rId2', 'numbering', 'numbering.xml']]),
      'word/document.xml': XML_HEAD + '<w:document xmlns:w="' + W + '" xmlns:r="' + R_NS + '"><w:body>' + body
        + '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
        + '</w:body></w:document>',
      'word/styles.xml': XML_HEAD + '<w:styles xmlns:w="' + W + '">'
        + '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '" w:eastAsia="' + FONT + '" w:cs="' + FONT + '"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-AU"/></w:rPr></w:rPrDefault>'
        + '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        + '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        + '<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:color w:val="' + PRIMARY + '"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>'
        + '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>'
        + '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="' + PRIMARY + '"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>'
        + '<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:qFormat/>'
        + '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/></w:pPr></w:style>'
        + '</w:styles>',
      'word/numbering.xml': XML_HEAD + '<w:numbering xmlns:w="' + W + '">'
        + '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>'
        + '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="' + FONT + '" w:hAnsi="' + FONT + '"/></w:rPr></w:lvl></w:abstractNum>'
        + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
        + '</w:numbering>',
    };
  }

  // ── PowerPoint ─────────────────────────────────────────────────────────────
  var MAX_SLIDE_BLOCKS = 6;
  var MAX_SLIDE_CHARS = 700;

  /** Slides from the document: a title slide, then one slide per heading, split when a section runs long. */
  function slidesFor(d) {
    var slides = [];
    if (d.title) slides.push({ cover: true, title: d.title });
    var groups = []; var cur = null;
    d.blocks.forEach(function (b) {
      if (b.t === 'h') { cur = { title: b.text, blocks: [] }; groups.push(cur); return; }
      if (!cur) { cur = { title: d.title || (d.kind === 'casenote' ? 'Case note' : 'Overview'), blocks: [] }; groups.push(cur); }
      cur.blocks.push(b);
    });
    groups.forEach(function (g) {
      if (!g.blocks.length) { slides.push({ title: g.title, blocks: [] }); return; }
      var chunk = []; var chars = 0; var part = 0;
      var flush = function () { slides.push({ title: part ? g.title + ' (cont.)' : g.title, blocks: chunk }); part++; chunk = []; chars = 0; };
      g.blocks.forEach(function (b) {
        var len = (b.lead ? b.lead.length + 2 : 0) + b.text.length;
        if (chunk.length && (chunk.length >= MAX_SLIDE_BLOCKS || chars + len > MAX_SLIDE_CHARS)) flush();
        chunk.push(b); chars += len;
      });
      flush();
    });
    if (!slides.length) slides.push({ cover: true, title: 'Opal Assist document' });
    return slides;
  }

  var A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  var P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  var NS = 'xmlns:a="' + A + '" xmlns:r="' + R_NS + '" xmlns:p="' + P + '"';
  var CX = 12192000; var CY = 6858000;

  function aRun(text, sz, bold, color) {
    return '<a:r><a:rPr lang="en-AU" sz="' + sz + '"' + (bold ? ' b="1"' : '') + ' dirty="0">'
      + (color ? '<a:solidFill><a:srgbClr val="' + color + '"/></a:solidFill>' : '')
      + '<a:latin typeface="' + FONT + '"/><a:cs typeface="' + FONT + '"/></a:rPr><a:t>' + x(text) + '</a:t></a:r>';
  }
  function aText(text, sz, bold, color) {
    return String(text || '').split('\n').map(function (line, i) { return (i ? '<a:br><a:rPr lang="en-AU" sz="' + sz + '"/></a:br>' : '') + aRun(line, sz, bold, color); }).join('');
  }
  function shape(id, name, ph, off, ext, paras, anchor) {
    return '<p:sp><p:nvSpPr><p:cNvPr id="' + id + '" name="' + name + '"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>' + ph + '</p:nvPr></p:nvSpPr>'
      + '<p:spPr><a:xfrm><a:off x="' + off[0] + '" y="' + off[1] + '"/><a:ext cx="' + ext[0] + '" cy="' + ext[1] + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>'
      + '<p:txBody><a:bodyPr wrap="square" anchor="' + (anchor || 't') + '"><a:normAutofit/></a:bodyPr><a:lstStyle/>' + paras + '</p:txBody></p:sp>';
  }
  var TREE_HEAD = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';

  function slideXml(s) {
    var tree;
    if (s.cover) {
      tree = shape(2, 'Title', '<p:ph type="ctrTitle"/>', [838200, 2286000], [10515600, 1600200],
        '<a:p><a:pPr algn="ctr"/>' + aText(s.title, 4000, true, PRIMARY) + '</a:p>', 'ctr');
    } else {
      var paras = s.blocks.map(function (b) {
        if (b.t === 'li') return '<a:p><a:pPr marL="342900" indent="-342900"><a:buFont typeface="' + FONT + '"/><a:buChar char="•"/></a:pPr>'
          + (b.lead ? aRun(b.lead + ': ', 2000, true) : '') + aText(b.text, 2000) + '</a:p>';
        return '<a:p><a:pPr marL="0" indent="0"><a:spcAft><a:spcPts val="600"/></a:spcAft><a:buNone/></a:pPr>' + aText(b.text, 2000) + '</a:p>';
      }).join('') || '<a:p><a:endParaRPr lang="en-AU"/></a:p>';
      tree = shape(2, 'Title', '<p:ph type="title"/>', [838200, 365125], [10515600, 1325563],
        '<a:p>' + aText(s.title, 3200, true, PRIMARY) + '</a:p>', 'b')
        + shape(3, 'Content', '<p:ph idx="1"/>', [838200, 1825625], [10515600, 4351338], paras);
    }
    return XML_HEAD + '<p:sld ' + NS + '><p:cSld><p:spTree>' + TREE_HEAD + tree + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>';
  }

  function themeXml() {
    var clr = [['dk1', '<a:sysClr val="windowText" lastClr="000000"/>'], ['lt1', '<a:sysClr val="window" lastClr="FFFFFF"/>'],
      ['dk2', '<a:srgbClr val="' + PRIMARY + '"/>'], ['lt2', '<a:srgbClr val="E7EEED"/>'], ['accent1', '<a:srgbClr val="' + PRIMARY + '"/>'],
      ['accent2', '<a:srgbClr val="5E8C86"/>'], ['accent3', '<a:srgbClr val="A5A5A5"/>'], ['accent4', '<a:srgbClr val="FFC000"/>'],
      ['accent5', '<a:srgbClr val="5B9BD5"/>'], ['accent6', '<a:srgbClr val="70AD47"/>'], ['hlink', '<a:srgbClr val="0563C1"/>'], ['folHlink', '<a:srgbClr val="954F72"/>']];
    var font = '<a:latin typeface="' + FONT + '"/><a:ea typeface=""/><a:cs typeface=""/>';
    var fill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
    var ln = '<a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>';
    return XML_HEAD + '<a:theme xmlns:a="' + A + '" name="Opal"><a:themeElements>'
      + '<a:clrScheme name="Opal">' + clr.map(function (c) { return '<a:' + c[0] + '>' + c[1] + '</a:' + c[0] + '>'; }).join('') + '</a:clrScheme>'
      + '<a:fontScheme name="Opal"><a:majorFont>' + font + '</a:majorFont><a:minorFont>' + font + '</a:minorFont></a:fontScheme>'
      + '<a:fmtScheme name="Opal"><a:fillStyleLst>' + fill + fill + fill + '</a:fillStyleLst><a:lnStyleLst>' + ln + ln + ln + '</a:lnStyleLst>'
      + '<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>'
      + '<a:bgFillStyleLst>' + fill + fill + fill + '</a:bgFillStyleLst></a:fmtScheme>'
      + '</a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>';
  }

  function placeholderTree() {
    return TREE_HEAD
      + shape(2, 'Title Placeholder', '<p:ph type="title"/>', [838200, 365125], [10515600, 1325563], '<a:p><a:endParaRPr lang="en-AU"/></a:p>', 'b')
      + shape(3, 'Text Placeholder', '<p:ph type="body" idx="1"/>', [838200, 1825625], [10515600, 4351338], '<a:p><a:endParaRPr lang="en-AU"/></a:p>');
  }

  function pptxParts(doc, names, style) {
    var slides = slidesFor(restored(doc, names, style));
    var parts = {};
    var ct = '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>'
      + '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>'
      + '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>'
      + '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>'
      + '<Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>'
      + '<Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>'
      + '<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>';
    var presRels = [['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'],
      ['rId3', 'presProps', 'presProps.xml'], ['rId4', 'viewProps', 'viewProps.xml'], ['rId5', 'tableStyles', 'tableStyles.xml']];
    var sldIds = '';
    slides.forEach(function (s, i) {
      var n = i + 1;
      parts['ppt/slides/slide' + n + '.xml'] = slideXml(s);
      parts['ppt/slides/_rels/slide' + n + '.xml.rels'] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml']]);
      ct += '<Override PartName="/ppt/slides/slide' + n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>';
      presRels.push(['rId' + (100 + n), 'slide', 'slides/slide' + n + '.xml']);
      sldIds += '<p:sldId id="' + (255 + n) + '" r:id="rId' + (100 + n) + '"/>';
    });
    var lvl = function (sz, bullet) {
      return '<a:lvl1pPr marL="' + (bullet ? 342900 : 0) + '" indent="' + (bullet ? -342900 : 0) + '" algn="l">'
        + (bullet ? '<a:buFont typeface="' + FONT + '"/><a:buChar char="•"/>' : '<a:buNone/>')
        + '<a:defRPr sz="' + sz + '"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/></a:defRPr></a:lvl1pPr>';
    };
    parts['[Content_Types].xml'] = XML_HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' + ct + '</Types>';
    parts['_rels/.rels'] = rels([['rId1', 'officeDocument', 'ppt/presentation.xml']]);
    parts['ppt/_rels/presentation.xml.rels'] = rels(presRels);
    parts['ppt/presentation.xml'] = XML_HEAD + '<p:presentation ' + NS + ' saveSubsetFonts="1">'
      + '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>' + sldIds + '</p:sldIdLst>'
      + '<p:sldSz cx="' + CX + '" cy="' + CY + '"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>';
    parts['ppt/slideMasters/slideMaster1.xml'] = XML_HEAD + '<p:sldMaster ' + NS + '><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>' + placeholderTree() + '</p:spTree></p:cSld>'
      + '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>'
      + '<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>'
      + '<p:txStyles><p:titleStyle>' + lvl(3200, false) + '</p:titleStyle><p:bodyStyle>' + lvl(2000, true) + '</p:bodyStyle><p:otherStyle>' + lvl(1800, false) + '</p:otherStyle></p:txStyles></p:sldMaster>';
    parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = rels([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]);
    parts['ppt/slideLayouts/slideLayout1.xml'] = XML_HEAD + '<p:sldLayout ' + NS + ' type="obj" preserve="1"><p:cSld name="Title and Content"><p:spTree>' + placeholderTree() + '</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
    parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = rels([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]);
    parts['ppt/theme/theme1.xml'] = themeXml();
    parts['ppt/presProps.xml'] = XML_HEAD + '<p:presentationPr ' + NS + '/>';
    parts['ppt/viewProps.xml'] = XML_HEAD + '<p:viewPr ' + NS + '><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>';
    parts['ppt/tableStyles.xml'] = XML_HEAD + '<a:tblStyleLst xmlns:a="' + A + '" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>';
    return parts;
  }

  // ── Download (browser only) ────────────────────────────────────────────────
  function loadJsZip() {
    if (global.JSZip) return Promise.resolve(global.JSZip);
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = '/vendor/jszip.min.js'; s.dataset.src = '/vendor/jszip.min.js';
      s.onload = function () { resolve(global.JSZip); }; s.onerror = function () { reject(new Error('Could not load the file builder.')); };
      document.head.appendChild(s);
    });
  }

  /** Build the file here and hand it to the browser as a download. format: 'docx' | 'pptx'. */
  function download(format, doc, names, style) {
    var parts = format === 'pptx' ? pptxParts(doc, names, style) : docxParts(doc, names, style);
    var mime = format === 'pptx' ? PPTX_MIME : DOCX_MIME;
    return loadJsZip().then(function (JSZip) {
      var zip = new JSZip();
      // [Content_Types].xml first, as Office expects.
      zip.file('[Content_Types].xml', parts['[Content_Types].xml']);
      Object.keys(parts).forEach(function (k) { if (k !== '[Content_Types].xml') zip.file(k, parts[k]); });
      return zip.generateAsync({ type: 'blob', mimeType: mime, compression: 'DEFLATE' });
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a'); a.href = url; a.download = fileName(doc, format); a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
    });
  }

  var api = { docxParts: docxParts, pptxParts: pptxParts, slidesFor: slidesFor, fileName: fileName, restored: restored, download: download };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.OpalAssistExport = api;
})(typeof window !== 'undefined' ? window : globalThis);
