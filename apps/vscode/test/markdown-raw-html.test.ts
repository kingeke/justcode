import { describe, expect, it } from 'vitest';

import { renderMarkdown } from '@ext/webview/markdown';

/**
 * A model can answer with a raw, unfenced HTML document (seen in the wild: a
 * full lava-lamp page with inline <style> and <svg>). If that HTML reaches the
 * DOM live it restyles and overlays the whole webview — the CSP blocks scripts
 * but not CSS or SVG — so renderMarkdown must escape raw HTML tokens.
 */
describe('renderMarkdown raw HTML escaping', () => {
  it('escapes an unfenced HTML document so no live tags reach the DOM', () => {
    const reply = [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <style>html, body { overflow: hidden; }</style>',
      '</head>',
      '<body>',
      '  <svg><path d="M0 0 L10 10" /></svg>',
      '  <script>alert(1)</script>',
      '</body>',
      '</html>',
    ].join('\n');

    const html = renderMarkdown(reply);

    expect(html).not.toContain('<style>');
    expect(html).not.toContain('<svg>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;style&gt;');
    expect(html).toContain('&lt;svg&gt;');
    // Block HTML keeps its line structure, matching the `breaks` option.
    expect(html).toContain('<br>');
  });

  it('escapes inline HTML inside a normal sentence', () => {
    const html = renderMarkdown('this is <b onmouseover="x()">bold</b> text');
    expect(html).not.toContain('<b ');
    expect(html).toContain('&lt;b onmouseover=');
  });

  it('still renders fenced code blocks as escaped code', () => {
    const html = renderMarkdown('```html\n<div>hi</div>\n```');
    expect(html).toContain('<pre>');
    expect(html).toContain('&lt;div&gt;hi&lt;/div&gt;');
  });

  it('leaves ordinary markdown rendering intact', () => {
    const html = renderMarkdown('**bold** and `code`');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });
});
