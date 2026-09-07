'use strict';

const { bodyToHtml, stripMarks } = require('../onboarding-email-markup');

describe('onboarding email markup', () => {
  test('bold, italic and underline marks render, and only as marks', () => {
    const html = bodyToHtml('Please **read** the _pack_ and *sign* by __Friday__.');
    expect(html).toContain('<strong>read</strong>');
    expect(html).toContain('<em>sign</em>');
    expect(html).toContain('<u>Friday</u>');
    expect(html).toContain('the _pack_ and');
  });

  test('a mark spanning a line break still renders, and escaping happens first', () => {
    const html = bodyToHtml('**Two\nlines** <b>not html</b>');
    expect(html).toContain('<strong>Two<br>lines</strong>');
    expect(html).toContain('&lt;b&gt;not html&lt;/b&gt;');
  });

  test('stray asterisks and underscores are left alone', () => {
    expect(bodyToHtml('5 * 3 = 15, file_name_here and ** nothing **')).toBe(
      '<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#1a1a1a"><p style="margin:0 0 12px">5 * 3 = 15, file_name_here and ** nothing **</p></div>',
    );
  });

  test('paragraphs and escapes are kept as before', () => {
    const html = bodyToHtml('Hi <Jane>,\n\nLine one\nLine two');
    expect(html).toContain('<p style="margin:0 0 12px">Hi &lt;Jane&gt;,</p>');
    expect(html).toContain('Line one<br>Line two');
  });

  test('stripMarks gives the bare words for mailto and previews', () => {
    expect(stripMarks('**Bold** and *italic* and __under__')).toBe('Bold and italic and under');
  });
});
