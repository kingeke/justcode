import { marked, type Tokens } from 'marked';

/**
 * Renders assistant Markdown to an HTML string for the transcript.
 *
 * The output is injected via `dangerouslySetInnerHTML`, so safety leans on the
 * webview's strict CSP (script-src is nonce-only with no `unsafe-inline`, so
 * neither inline `<script>` nor inline event handlers like `onerror` can run,
 * and img-src is limited to https/data). `gfm` enables tables/strikethrough/
 * task lists; `breaks` maps single newlines to `<br>` so chat replies wrap the
 * way users expect rather than collapsing soft line breaks.
 */
marked.setOptions({ gfm: true, breaks: true });

/** Escapes text so it displays literally instead of being parsed as HTML. */
function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

/**
 * Raw HTML in a reply must never reach the DOM live: a model that answers with
 * an unfenced HTML document (inline `<style>`, `<svg>`, …) would otherwise
 * restyle and overlay the entire webview — the CSP blocks scripts but not CSS
 * or SVG. Escape both block and inline HTML tokens so they render as visible
 * text; block tokens keep their line breaks to match the `breaks` option.
 */
marked.use({
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag): string {
      const escaped = escapeHtml(token.text);
      return token.block
        ? `<p>${escaped.replaceAll('\n', '<br>')}</p>`
        : escaped;
    },
  },
});

/**
 * Parsed-HTML cache, keyed by the source Markdown. Committed transcript
 * messages never change, but the transcript re-renders on every streamed
 * token — without the cache a long conversation re-parses every assistant
 * message per token. LRU-ish: a hit is refreshed to the back, and the oldest
 * entry is evicted at the cap (streaming inserts one entry per token for the
 * live message; eviction keeps that from growing unbounded).
 */
const cache = new Map<string, string>();
const CACHE_LIMIT = 2000;

export function renderMarkdown(text: string): string {
  const hit = cache.get(text);
  if (hit !== undefined) {
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const html = marked.parse(text, { async: false });
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(text, html);
  return html;
}
