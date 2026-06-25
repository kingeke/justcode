import { Marked, type Token, type Tokens } from 'marked';
import { markedTerminal } from 'marked-terminal';
import markedShiki from 'marked-shiki';
import { codeToANSI } from '@shikijs/cli';
import type { BundledLanguage, BundledTheme } from 'shiki';
import chalk from 'chalk';

const FALLBACK_WIDTH = 80;
const MIN_COLUMN_WIDTH = 8;

// Shiki theme used for fenced code blocks. Any bundled theme name works.
const CODE_THEME = 'github-dark';

function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 20
    ? process.stdout.columns
    : FALLBACK_WIDTH;
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\[[0-9;]*m/g;

// marked-terminal's codespan renderer swaps ':' for this sentinel to shield colons
// from its emoji pass, expecting its own row transform to restore them. Our custom
// table renderer bypasses that transform, so we undo it (and HTML entities) here —
// otherwise inline code like `sse://` leaks as `sse*#COLON|*//` inside cells.
function cleanCellText(text: string): string {
  return text
    .replaceAll('*#COLON|*', ':')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');
}

// Approximate terminal cell width of a code point. Emoji and CJK glyphs occupy two
// cells; treating them as one undersizes columns and clips content (e.g. ✅ → …).
function codePointWidth(codePoint: number): number {
  const isWide =
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // Hangul Jamo
    (codePoint >= 0x2600 && codePoint <= 0x27bf) || // misc symbols / dingbats (✅)
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) || // CJK & friends
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // Hangul syllables
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK compatibility
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // fullwidth forms
    (codePoint >= 0x1f300 && codePoint <= 0x1faff); // emoji & pictographs
  return isWide ? 2 : 1;
}

function lineWidth(line: string): number {
  let width = 0;
  for (const char of line) {
    width += codePointWidth(char.codePointAt(0) ?? 0);
  }
  return width;
}

// Visible width of a cell, ignoring ANSI color codes and counting the widest line.
function visibleWidth(text: string): number {
  return text
    .replace(ANSI_PATTERN, '')
    .split('\n')
    .reduce((max, line) => Math.max(max, lineWidth(line)), 0);
}

// Size columns to their content instead of splitting the width evenly, so a narrow
// column (an icon or a number) stays narrow and the text columns get the rest. Only
// when the natural layout overflows the terminal do we shrink, proportionally and
// with a per-column floor, so wide tables still wrap rather than overflow.
// colWidths include 1 char of padding per side; borders take one column each + 1.
function computeColumnWidths(cells: string[][]): number[] {
  const columnCount = cells[0]?.length ?? 0;
  const natural = Array.from({ length: columnCount }, (_, column) => {
    const widest = cells.reduce(
      (max, row) => Math.max(max, visibleWidth(row[column] ?? '')),
      0
    );
    return widest + 2;
  });

  const available = terminalWidth() - (columnCount + 1);
  const total = natural.reduce((sum, width) => sum + width, 0);
  if (total <= available) {
    return natural;
  }

  const floors = natural.map((width) => Math.min(width, MIN_COLUMN_WIDTH));
  const floorTotal = floors.reduce((sum, width) => sum + width, 0);
  const pool = available - floorTotal;
  if (pool <= 0) {
    return floors;
  }

  const want = natural.map((width, column) =>
    Math.max(0, width - floors[column]!)
  );
  const wantTotal = want.reduce((sum, width) => sum + width, 0) || 1;
  return natural.map(
    (_, column) =>
      floors[column]! + Math.floor((pool * want[column]!) / wantTotal)
  );
}

// Custom table renderer so wide tables wrap to the terminal instead of overflowing.
// marked's published types still describe the legacy (header, body) signature,
// but at runtime v15 passes a table token — so the override is typed loosely.
function renderTableToken(
  this: { parser: { parseInline: (tokens: Token[]) => string } },
  token: Tokens.Table
): string {
  const header = token.header.map((cell) =>
    cleanCellText(this.parser.parseInline(cell.tokens))
  );
  const rows = token.rows.map((row) =>
    row.map((cell) => cleanCellText(this.parser.parseInline(cell.tokens)))
  );

  const widths = computeColumnWidths([header, ...rows]);
  const styledHeader = header.map((cell) => chalk.bold.cyan(cell));
  return drawTable(styledHeader, rows, widths);
}

// Proper SGR strip (the module-level ANSI_PATTERN omits the leading ESC).
// eslint-disable-next-line no-control-regex
const SGR = /\x1b\[[0-9;]*m/g;

function visibleLen(text: string): number {
  return lineWidth(text.replace(SGR, ''));
}

// Pad a (possibly ANSI-coloured) cell line to a target visible width.
function padTo(text: string, width: number): string {
  const gap = width - visibleLen(text);
  return gap > 0 ? text + ' '.repeat(gap) : text;
}

// Word-wrap a cell to `width` visible cells. Wrapping happens on spaces so the
// ANSI escapes that chalk wraps around each inline token stay intact.
function wrapCell(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || visibleLen(candidate) <= width) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

// Renders a bordered table without cli-table3 (whose bundled string-width breaks
// under Bun). `widths` are full column widths including one space of padding per side.
function drawTable(
  header: string[],
  rows: string[][],
  widths: number[]
): string {
  const grey = (text: string): string => chalk.grey(text);
  const rule = (left: string, mid: string, right: string): string =>
    grey(left + widths.map((w) => '─'.repeat(w)).join(mid) + right);

  const renderRow = (cells: string[]): string => {
    const wrapped = cells.map((cell, column) =>
      wrapCell(cell, Math.max(1, (widths[column] ?? 2) - 2))
    );
    const height = Math.max(1, ...wrapped.map((lines) => lines.length));
    const out: string[] = [];
    for (let row = 0; row < height; row += 1) {
      const columns = wrapped.map((lines, column) => {
        const content = padTo(lines[row] ?? '', (widths[column] ?? 2) - 2);
        return ` ${content} `;
      });
      out.push(grey('│') + columns.join(grey('│')) + grey('│'));
    }
    return out.join('\n');
  };

  const lines = [rule('┌', '┬', '┐'), renderRow(header), rule('├', '┼', '┤')];
  for (const row of rows) {
    lines.push(renderRow(row));
  }
  lines.push(rule('└', '┴', '┘'));
  return `${lines.join('\n')}\n`;
}

// marked-terminal's `text` renderer returns the token's raw `.text`, ignoring its
// inline `.tokens`. In tight lists, items are `text` tokens (not paragraphs), so
// inline markup like **bold** or `code` leaks through unrendered. Parse the inline
// tokens ourselves, as marked's own default text renderer does.
function renderTextToken(
  this: { parser: { parseInline: (tokens: Token[]) => string } },
  token: Tokens.Text
): string {
  return token.tokens?.length
    ? this.parser.parseInline(token.tokens)
    : token.text;
}

function withTerminal(
  instance: Marked,
  options: Record<string, unknown>
): Marked {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance.use(markedTerminal(options as any) as any);
  instance.use({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    renderer: { table: renderTableToken as any, text: renderTextToken as any },
  });
  return instance;
}

// Synchronous renderer (no Shiki). Used for streaming output, where re-rendering
// happens on every token and we cannot await per-block highlighting.
const markedSync = withTerminal(new Marked(), {
  showSectionPrefix: false,
  reflowText: true,
  width: terminalWidth(),
  code: chalk.greenBright,
  codespan: chalk.yellow,
  heading: chalk.bold.cyan,
  firstHeading: chalk.bold.cyan,
});

// Async renderer: marked-terminal handles prose, marked-shiki replaces fenced
// code blocks with Shiki-highlighted ANSI. marked-shiki rewrites each code token
// into an `html` token, so `html` is set to identity to pass the ANSI through
// untouched (otherwise marked-terminal would re-style it and clobber the colors).
const markedShikiInstance = withTerminal(new Marked(), {
  showSectionPrefix: false,
  reflowText: true,
  width: terminalWidth(),
  codespan: chalk.yellow,
  heading: chalk.bold.cyan,
  firstHeading: chalk.bold.cyan,
  html: (text: string) => text,
});

markedShikiInstance.use(
  markedShiki({
    async highlight(code, lang) {
      const language = (lang?.trim() || 'text') as BundledLanguage;
      try {
        return (
          await codeToANSI(code, language, CODE_THEME as BundledTheme)
        ).replace(/\n$/, '');
      } catch {
        // Unknown/unsupported language — fall back to the raw code.
        return code;
      }
    },
  })
);

export function renderMarkdown(text: string): string {
  const rendered = markedSync.parse(text, { async: false }) as string;
  return rendered.replace(/\n+$/, '');
}

export async function renderMarkdownAsync(text: string): Promise<string> {
  const rendered = (await markedShikiInstance.parse(text, {
    async: true,
  })) as string;
  return rendered.replace(/\n+$/, '');
}
