/**
 * Syntax-highlight styles for the markdown renderer. OpenTUI resolves every
 * markdown chunk (and every tree-sitter highlight inside fenced code) to a named
 * style here; a bare `SyntaxStyle.create()` registers none, so everything falls
 * back to the default and renders as unstyled raw text. Registering these makes
 * prose markup (headings, bold, code, links, …) and code blocks actually style.
 *
 * Names follow OpenTUI's capture groups: `markup.*` for prose, plus common
 * tree-sitter captures for code. Lookups fall back to the first dotted segment
 * (e.g. `markup.heading.1` → `markup`), so the top-level catch-alls cover
 * anything not named explicitly.
 */

interface ThemeStyle {
  fg?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  dim?: boolean;
}

const FG = '#d4d4d4';
const HEADING = '#58a6ff';
const ACCENT = '#79c0ff';
const RED = '#ff7b72';
const STRING = '#a5d6ff';
const MUTED = '#8b949e';
const FUNCTION = '#d2a8ff';
const TYPE = '#ffa657';
const TAG = '#7ee787';

export const MARKDOWN_SYNTAX_STYLES: Record<string, ThemeStyle> = {
  default: { fg: FG },

  // Prose markup (used by both the streaming inline path and tree-sitter).
  markup: { fg: FG },
  'markup.heading': { fg: HEADING, bold: true },
  'markup.heading.1': { fg: HEADING, bold: true },
  'markup.heading.2': { fg: HEADING, bold: true },
  'markup.heading.3': { fg: ACCENT, bold: true },
  'markup.heading.4': { fg: ACCENT, bold: true },
  'markup.heading.5': { fg: ACCENT, bold: true },
  'markup.heading.6': { fg: ACCENT, bold: true },
  'markup.strong': { fg: '#e6edf3', bold: true },
  'markup.italic': { fg: FG, italic: true },
  'markup.strikethrough': { fg: MUTED, dim: true },
  'markup.raw': { fg: STRING },
  'markup.list': { fg: RED },
  'markup.quote': { fg: MUTED, italic: true },
  'markup.link': { fg: HEADING, underline: true },
  'markup.link.label': { fg: HEADING },
  'markup.link.url': { fg: MUTED, underline: true },

  // Common code captures for fenced code blocks.
  keyword: { fg: RED },
  string: { fg: STRING },
  comment: { fg: MUTED, italic: true },
  function: { fg: FUNCTION },
  number: { fg: ACCENT },
  constant: { fg: ACCENT },
  boolean: { fg: ACCENT },
  type: { fg: TYPE },
  variable: { fg: '#e6edf3' },
  property: { fg: ACCENT },
  operator: { fg: RED },
  punctuation: { fg: MUTED },
  tag: { fg: TAG },
  attribute: { fg: FUNCTION },
};

/**
 * A dimmed variant of {@link MARKDOWN_SYNTAX_STYLES} for reasoning/thinking:
 * every token renders in the same muted gray so the block stays visually
 * distinct from the model's answer, while bold/italic/underline attributes are
 * kept so structure (bold labels, headings) is still legible. Markers are still
 * concealed by the tree-sitter highlighter, so no raw `**`/`#` leaks through.
 */
export const MARKDOWN_MUTED_SYNTAX_STYLES: Record<string, ThemeStyle> =
  Object.fromEntries(
    Object.entries(MARKDOWN_SYNTAX_STYLES).map(([name, style]) => [
      name,
      { ...style, fg: MUTED },
    ])
  );
