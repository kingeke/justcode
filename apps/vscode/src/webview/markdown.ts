import { marked } from 'marked';

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

export function renderMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}
