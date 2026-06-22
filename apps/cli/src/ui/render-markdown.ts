import { Marked, type Token, type Tokens } from 'marked';
import { markedTerminal } from 'marked-terminal';
import Table from 'cli-table3';
import chalk from 'chalk';

const FALLBACK_WIDTH = 80;
const MIN_COLUMN_WIDTH = 8;

function terminalWidth(): number {
  return process.stdout.columns && process.stdout.columns > 20
    ? process.stdout.columns
    : FALLBACK_WIDTH;
}

// cli-table3 needs explicit colWidths to wrap; split the available width evenly
// (cells include 1 char of padding on each side, plus one border per column).
function columnWidths(columnCount: number): number[] {
  const available = terminalWidth() - (columnCount + 1);
  const each = Math.max(MIN_COLUMN_WIDTH, Math.floor(available / columnCount));
  return Array.from({ length: columnCount }, () => each);
}

const marked = new Marked();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(
  markedTerminal({
    showSectionPrefix: false,
    reflowText: true,
    width: terminalWidth(),
    code: chalk.greenBright,
    codespan: chalk.yellow,
    heading: chalk.bold.cyan,
    firstHeading: chalk.bold.cyan,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any
);

// Custom table renderer so wide tables wrap to the terminal instead of overflowing.
// marked's published types still describe the legacy (header, body) signature,
// but at runtime v15 passes a table token — so the override is typed loosely.
function renderTableToken(
  this: { parser: { parseInline: (tokens: Token[]) => string } },
  token: Tokens.Table
): string {
  const widths = columnWidths(token.header.length);
  const table = new Table({
    head: token.header.map((cell) =>
      chalk.bold.cyan(this.parser.parseInline(cell.tokens))
    ),
    colWidths: widths,
    wordWrap: true,
    wrapOnWordBoundary: true,
    style: { head: [], border: ['grey'] },
  });
  for (const row of token.rows) {
    table.push(row.map((cell) => this.parser.parseInline(cell.tokens)));
  }
  return `${table.toString()}\n`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use({ renderer: { table: renderTableToken as any } });

export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text, { async: false }) as string;
  return rendered.replace(/\n+$/, '');
}
