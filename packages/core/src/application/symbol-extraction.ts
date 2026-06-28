/**
 * Lightweight, language-agnostic extraction of named symbols (functions,
 * methods, classes, types, …) from source text. This is a textual heuristic —
 * not a parser — so it favours simplicity and predictability over covering every
 * grammar; callers fall back to the whole file when a lookup misses.
 *
 * Shared by `@path::symbol` mention attachments, the `::` method autocomplete in
 * the prompt, and the `read_file_method` tool so they all agree on what a
 * "symbol" is and where its block begins and ends.
 */

import { splitLines } from '@core/application/read-window';

export interface SymbolBlock {
  /** 1-based line number of the symbol's first line in the original file. */
  startLine: number;
  lines: string[];
}

/**
 * Extracts a named symbol's source block: the first line that declares `symbol`
 * through the end of its `{ … }` body (via brace matching), or to the
 * terminating `;` for body-less declarations (overload signatures, type
 * aliases, single-statement arrows). Returns undefined when no declaration is
 * found.
 */
export function extractSymbolBlock(
  text: string,
  symbol: string
): SymbolBlock | undefined {
  const lines = splitLines(text);
  const declarationIndex = findDeclarationLine(lines, symbol);
  if (declarationIndex === -1) {
    return undefined;
  }

  const endIndex = findBlockEnd(lines, declarationIndex);
  return {
    startLine: declarationIndex + 1,
    lines: lines.slice(declarationIndex, endIndex + 1),
  };
}

/**
 * Lists the names of the top-level-ish symbols declared in a file, in source
 * order and de-duplicated. Powers the `@path::` autocomplete. Like the rest of
 * this module it's heuristic: it recognises common declaration shapes across
 * curly-brace and Python-style languages rather than parsing any one of them.
 */
export function listFileSymbols(text: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const line of splitLines(text)) {
    const name = declaredSymbolName(line);
    if (name && !seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }

  return names;
}

// Leading keywords that can precede a member/binding name (TS/JS member syntax).
const MODIFIER_KEYWORDS =
  '(?:export|default|public|private|protected|static|readonly|abstract|async|get|set|const|let|var)';

const KEYWORD_DECLARATION =
  /\b(?:function|class|interface|type|enum|struct|def|namespace|module)\s+([A-Za-z_$][\w$]*)/;
// A method/binding declaration: an identifier followed by `(`, `=`, `:`, or `<`,
// at the start of a (possibly indented) line. The trailing token disambiguates
// it from prose; the modifier prefix covers TS/JS member syntax.
const MEMBER_DECLARATION = new RegExp(
  `^\\s*(?:${MODIFIER_KEYWORDS}\\s+)*([A-Za-z_$][\\w$]*)\\s*[(=:<]`
);

// Lines that look like a declaration by shape but are really control flow, so
// their "name" (the keyword) must not be listed as a symbol.
const CONTROL_FLOW_NAMES = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'else',
  'do',
  'with',
  'case',
]);

function declaredSymbolName(line: string): string | undefined {
  const keywordMatch = line.match(KEYWORD_DECLARATION);
  if (keywordMatch?.[1]) {
    return keywordMatch[1];
  }

  const memberMatch = line.match(MEMBER_DECLARATION);
  const name = memberMatch?.[1];
  if (name && !CONTROL_FLOW_NAMES.has(name)) {
    return name;
  }

  return undefined;
}

function findDeclarationLine(lines: string[], symbol: string): number {
  const name = escapeRegExp(symbol);
  // Keyword-led declarations: `function foo`, `class Foo`, `type Foo`, `def foo`…
  const keywordDeclaration = new RegExp(
    `\\b(?:function|class|interface|type|enum|struct|def|namespace|module)\\s+${name}\\b`
  );
  // Members and bindings: a method `foo(`, an arrow/const `foo =`, a typed
  // property `foo:`, or a generic `foo<`. Anchored to the start of the
  // (possibly indented, possibly modifier-prefixed) line so it matches a
  // definition that begins the statement but not a call site mid-line such as
  // `return foo()` or `this.foo()`.
  const memberDeclaration = new RegExp(
    `^\\s*(?:${MODIFIER_KEYWORDS}\\s+)*${name}\\s*[(=:<]`
  );

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    if (keywordDeclaration.test(line) || memberDeclaration.test(line)) {
      return index;
    }
  }

  return -1;
}

function findBlockEnd(lines: string[], startIndex: number): number {
  let depth = 0;
  let seenBrace = false;

  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index] ?? '';
    for (const character of line) {
      if (character === '{') {
        depth += 1;
        seenBrace = true;
      } else if (character === '}') {
        depth -= 1;
        if (seenBrace && depth <= 0) {
          return index;
        }
      }
    }

    // No body opened yet: a line ending in `;` closes a body-less declaration
    // (an overload signature, a type alias, a single-statement arrow).
    if (!seenBrace && /;\s*$/.test(line)) {
      return index;
    }
  }

  return lines.length - 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
