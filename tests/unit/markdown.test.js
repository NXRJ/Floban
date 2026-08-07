const { test } = require('node:test');
const assert = require('node:assert/strict');
const Markdown = require('../../js/core/markdown.js');

test('escapeHtml escapes angle brackets and ampersands', () => {
  assert.equal(Markdown.escapeHtml('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});

test('escapeHtml escapes quotes and apostrophes', () => {
  assert.equal(Markdown.escapeHtml('"quoted" \'apostrophe\''), '&quot;quoted&quot; &#39;apostrophe&#39;');
});

test('escapeHtml coerces non-strings', () => {
  assert.equal(Markdown.escapeHtml(42), '42');
  assert.equal(Markdown.escapeHtml(null), 'null');
});

test('renderMarkdownLite renders bold', () => {
  assert.equal(Markdown.renderMarkdownLite('a **bold** b'), 'a <strong>bold</strong> b');
});

test('renderMarkdownLite renders italic', () => {
  assert.equal(Markdown.renderMarkdownLite('a *ital* b'), 'a <em>ital</em> b');
});

test('renderMarkdownLite renders inline code', () => {
  assert.equal(Markdown.renderMarkdownLite('run `npm test` now'), 'run <code>npm test</code> now');
});

test('renderMarkdownLite converts newlines to line breaks', () => {
  assert.equal(Markdown.renderMarkdownLite('line one\nline two'), 'line one<br>line two');
});

test('renderMarkdownLite renders https links with safe attributes', () => {
  const out = Markdown.renderMarkdownLite('[docs](https://example.com/a)');
  assert.equal(out, '<a href="https://example.com/a" target="_blank" rel="noopener noreferrer">docs</a>');
});

test('renderMarkdownLite renders http links', () => {
  const out = Markdown.renderMarkdownLite('[docs](http://example.com/a)');
  assert.equal(out, '<a href="http://example.com/a" target="_blank" rel="noopener noreferrer">docs</a>');
});

test('renderMarkdownLite renders mailto links', () => {
  const out = Markdown.renderMarkdownLite('[mail](mailto:hi@example.com)');
  assert.equal(out, '<a href="mailto:hi@example.com" target="_blank" rel="noopener noreferrer">mail</a>');
});

test('javascript: links do not become anchors', () => {
  const out = Markdown.renderMarkdownLite('[x](javascript:alert(1))');
  assert.equal(out.indexOf('<a'), -1);
  assert.equal(out, '[x](javascript:alert(1))');
});

test('data: links do not become anchors', () => {
  const out = Markdown.renderMarkdownLite('[x](data:text/html,<b>hi</b>)');
  assert.equal(out.indexOf('<a'), -1);
});

test('raw img tags with event handlers remain escaped', () => {
  const out = Markdown.renderMarkdownLite('<img src=x onerror=alert(1)>');
  assert.equal(out.indexOf('<img'), -1);
  assert.equal(out.indexOf('&lt;img'), 0);
  assert.equal(out.indexOf('onerror'), 14);
});

test('raw script tags remain escaped', () => {
  const out = Markdown.renderMarkdownLite('<script>alert(1)</script>');
  assert.equal(out.indexOf('<script'), -1);
  assert.equal(out, '&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('malformed markdown does not create unsafe HTML', () => {
  const out = Markdown.renderMarkdownLite('[x](https://ok.example/" onclick="alert(1))');
  assert.equal(out.indexOf('<a'), -1);
  assert.equal(out.indexOf('onclick="'), -1);
});

test('an unclosed link stays literal text', () => {
  const out = Markdown.renderMarkdownLite('[x](https://example.com');
  assert.equal(out.indexOf('<a'), -1);
});

test('markdown applied to raw text does not leak unescaped tags', () => {
  const out = Markdown.renderMarkdownLite('**bold** <svg onload=alert(1)>');
  assert.equal(out.indexOf('<svg'), -1);
  assert.equal(out.indexOf('&lt;svg'), 22);
  assert.equal(out.indexOf('<strong>bold</strong>'), 0);
});
