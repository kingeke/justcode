/**
 * Shared helpers for reading files into the model's context as numbered lines.
 * Used by both the `read_file` tool and `@`-mention attachments so paging and
 * long-line handling behave identically across the board.
 */

/**
 * Default maximum number of lines returned by a single read before it is
 * paged. A default only: the runtime overrides it from user config (see
 * `create-services`/`create-cli` and the `/read-limit` command).
 */
export const DEFAULT_MAX_READ_LINES = 200;

/**
 * Maximum characters kept for a single line. Guards against one pathological
 * line (minified JS, a huge JSON blob) flooding the context. Longer lines are
 * truncated and flagged.
 */
export const MAX_LINE_LENGTH = 8192;

/**
 * Split text into lines, handling LF, CRLF, and lone-CR endings. A single
 * trailing newline does not produce a phantom empty final line (so "a\n" is one
 * line, not two). An empty string yields no lines.
 */
export function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Format one line as `<number> | <text>`, truncating to `maxLength` characters
 * and appending a marker that tells the model the line was shortened and how
 * long it really is.
 */
export function formatNumberedLine(
  lineNumber: number,
  text: string,
  maxLength = MAX_LINE_LENGTH
): string {
  if (text.length <= maxLength) {
    return `${lineNumber} | ${text}`;
  }
  return (
    `${lineNumber} | ${text.slice(0, maxLength)}` +
    `… [line truncated: ${text.length} chars total, showing first ${maxLength}]`
  );
}
