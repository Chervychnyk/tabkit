// Markdown → HTML for AI answers. Answers are untrusted (@page feeds arbitrary page text into the prompt), so:
// raw HTML is shown as text, links must be http(s)/mailto, and images become links so nothing loads on its own.
import { Marked } from 'marked';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]!);
const safeUrl = (href: string) => (/^(https?:|mailto:)/i.test(href.trim()) ? href.trim() : null);
const anchor = (url: string, inner: string, title?: string | null) =>
  `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${esc(title)}"` : ''}>${inner}</a>`;

const md = new Marked({
  gfm: true,
  breaks: true,
  async: false,
  renderer: {
    html: ({ text }) => esc(text),
    // The chat view handles clicks on .copy-code (event delegation), copying the sibling <pre>'s text.
    code({ text, lang }) {
      const cls = lang && /^[\w+-]+$/.test(lang) ? ` class="language-${lang}"` : '';
      return `<div class="code"><button type="button" class="copy-code" aria-label="Copy code">Copy</button><pre><code${cls}>${esc(text)}</code></pre></div>\n`;
    },
    link({ href, title, tokens }) {
      const inner = this.parser.parseInline(tokens);
      const url = safeUrl(href);
      return url ? anchor(url, inner, title) : inner;
    },
    image({ href, text }) {
      const url = safeUrl(href);
      return url ? anchor(url, `🖼 ${esc(text || url)}`) : esc(text);
    },
  },
});

export const renderMarkdown = (src: string) => md.parse(src) as string;
