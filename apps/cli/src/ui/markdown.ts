/**
 * Helpers for preparing model output before it's handed to OpenTUI's <markdown>
 * renderable.
 */

// A line that opens or closes a fenced code block: up to three leading spaces
// then a run of at least three backticks or tildes. Capturing the run lets us
// match a close to its open (same fence char, length >= the opening run).
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
// Inner content that's clearly markdown (a heading, bold, or a list item),
// used to decide whether to unwrap a fence that carries no language.
const LOOKS_LIKE_MARKDOWN = /(^|\n)\s{0,3}#{1,6}\s|\*\*|(^|\n)\s*[-*+]\s/;

/**
 * Prepares model output for the markdown renderer: unwraps a whole-message code
 * fence the model wrapped its answer in (which would otherwise render the entire
 * reply as literal text), then closes any still-open fence. Returns the content
 * unchanged when neither applies.
 */
export function prepareMarkdown(content: string): string {
  return closeUnbalancedCodeFences(stripEnclosingMarkdownFence(content));
}

/**
 * Unwraps a fence that encloses the entire message when it carries no language
 * or an explicit markdown/md language — i.e. the model wrapped its whole reply
 * in ```` ```markdown … ``` ````. Bails on ambiguous same-length nested fences
 * (e.g. a 3-backtick wrapper around a 3-backtick code block) since those can't
 * be unwrapped reliably; a longer outer fence around shorter inner ones is fine.
 */
export function stripEnclosingMarkdownFence(content: string): string {
  const lines = content.trim().split('\n');
  if (lines.length < 2) {
    return content;
  }

  const open = (lines[0] ?? '').match(/^(`{3,}|~{3,})(.*)$/);
  if (!open) {
    return content;
  }
  const char = (open[1] ?? '')[0] ?? '`';
  const length = (open[1] ?? '').length;
  const lang = (open[2] ?? '').trim().toLowerCase();
  if (lang !== '' && lang !== 'markdown' && lang !== 'md') {
    return content;
  }

  const close = (lines[lines.length - 1] ?? '').match(/^(`{3,}|~{3,})\s*$/);
  const closeRun = close?.[1] ?? '';
  if (closeRun[0] !== char || closeRun.length < length) {
    return content;
  }

  const inner = lines.slice(1, -1);
  for (const line of inner) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,})/);
    const run = fence?.[1] ?? '';
    if (run[0] === char && run.length >= length) {
      return content; // ambiguous nesting — leave it alone
    }
  }

  const innerText = inner.join('\n');
  if (lang === '' && !LOOKS_LIKE_MARKDOWN.test(innerText)) {
    return content; // a genuine, unlabelled code block — don't unwrap
  }

  return innerText;
}

/**
 * Closes an unbalanced code fence so trailing prose isn't swallowed into a code
 * block and rendered as raw markdown. Models occasionally emit an opening
 * ```` ```lang ```` without a matching close (or a close that's too short),
 * after which everything — headings, bold, lists — renders literally. Appending
 * the missing fence lets the rest parse normally. Well-formed content is
 * returned unchanged.
 */
export function closeUnbalancedCodeFences(content: string): string {
  let open: { char: string; length: number } | null = null;

  for (const line of content.split('\n')) {
    const match = line.match(FENCE_LINE);
    if (!match) {
      continue;
    }

    const run = match[1] ?? '';
    const char = run[0] ?? '`';
    const length = run.length;
    const rest = (match[2] ?? '').trim();

    if (!open) {
      // An opening fence may carry an info string (e.g. ```ts); start a block.
      open = { char, length };
    } else if (char === open.char && length >= open.length && rest === '') {
      // A bare same-or-longer fence of the same char closes the block.
      open = null;
    }
  }

  if (!open) {
    return content;
  }

  const suffix = content.endsWith('\n') ? '' : '\n';
  return `${content}${suffix}${open.char.repeat(open.length)}`;
}
