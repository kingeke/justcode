import {
  DEFAULT_MAX_READ_LINES,
  formatNumberedLine,
  splitLines,
} from '@core/application/read-window';
import {
  extractSymbolBlock,
  listFileSymbols,
  type SymbolBlock,
} from '@core/application/symbol-extraction';
import type { MessageAttachment } from '@core/domain/message';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

const ACTIVE_MENTION_PATTERN = /(?:^|\s)@([^\s@]*)$/;
const MENTION_PATTERN = /(?:^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.:;!?\]]+$/;
// A trailing `@<path>::<query>` mention, used to switch the prompt's
// autocomplete from files to the symbols declared in `<path>`.
const ACTIVE_SYMBOL_MENTION_PATTERN = /(?:^|\s)@([^\s@]*?)::([^\s@:]*)$/;

export class PromptAttachmentService {
  public constructor(
    private readonly workspaceFiles: WorkspaceFilePort,
    private readonly getMaxAttachmentLines: () => number = () =>
      DEFAULT_MAX_READ_LINES
  ) {}

  public async listFiles(): Promise<string[]> {
    return this.workspaceFiles.listFiles();
  }

  /**
   * Lists the symbols declared in a workspace file, for the `@path::` method
   * autocomplete. Returns an empty list when the file can't be read.
   */
  public async listSymbols(path: string): Promise<string[]> {
    try {
      const text = await this.workspaceFiles.readFile(path);
      return listFileSymbols(text);
    } catch {
      return [];
    }
  }

  public async resolveAttachments(
    content: string,
    signal?: AbortSignal
  ): Promise<MessageAttachment[]> {
    const mentions = extractFileMentions(content);

    const resolved: Array<MessageAttachment | undefined> = [];
    for (const mention of mentions) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      const { path, symbol } = parseMention(mention);

      try {
        const text = await this.workspaceFiles.readFile(path);
        const maxLines = this.getMaxAttachmentLines();

        // A `@path::symbol` mention attaches just that method/symbol's block
        // rather than the whole file, so the model gets the relevant code
        // without the rest of the file crowding the context.
        if (symbol) {
          const block = extractSymbolBlock(text, symbol);
          if (block) {
            resolved.push({
              path: `${path}::${symbol}`,
              content: formatSymbolBlock(block, maxLines),
            });
            continue;
          }

          // Symbol not found: fall back to the whole file so the message still
          // carries useful context, with a note explaining the miss.
          resolved.push({
            path,
            content:
              `(Symbol '${symbol}' was not found in this file; showing the whole file.)\n` +
              formatAttachmentLines(text, maxLines),
          });
          continue;
        }

        resolved.push({
          path,
          content: formatAttachmentLines(text, maxLines),
        });
      } catch {
        // Skip mentions that don't resolve to a readable file (e.g. a typo or
        // an @mention the user never Tab-completed) so the message still sends.
        resolved.push(undefined);
      }
    }

    return resolved.filter(
      (attachment): attachment is MessageAttachment => attachment !== undefined
    );
  }
}

interface ParsedMention {
  path: string;
  /** Present for `@path::symbol` mentions: the method/symbol to extract. */
  symbol?: string;
}

/**
 * Splits a mention token into its file path and an optional `::symbol` suffix.
 * Only the first `::` separates the path from the symbol, so paths themselves
 * never contain `::`.
 */
export function parseMention(token: string): ParsedMention {
  const separatorIndex = token.indexOf('::');
  if (separatorIndex === -1) {
    return { path: token };
  }

  const path = token.slice(0, separatorIndex);
  const symbol = token.slice(separatorIndex + 2).trim();
  return symbol ? { path, symbol } : { path };
}

export function extractFileMentions(content: string): string[] {
  const matches = content.matchAll(MENTION_PATTERN);
  const dedupedMentions = new Set<string>();

  for (const match of matches) {
    const normalizedPath = normalizeMentionPath(match[1]);
    if (normalizedPath) {
      dedupedMentions.add(normalizedPath);
    }
  }

  return [...dedupedMentions];
}

export function getActiveMentionQuery(content: string): string | undefined {
  const matchedQuery = content.match(ACTIVE_MENTION_PATTERN)?.[1];
  if (matchedQuery === undefined) {
    return undefined;
  }

  // Once the user types `::` they're naming a symbol, not searching for a file,
  // so there's no active file-completion query anymore.
  if (matchedQuery.includes('::')) {
    return undefined;
  }

  return matchedQuery;
}

export function hasActiveMentionTrigger(content: string): boolean {
  const matchedQuery = content.match(ACTIVE_MENTION_PATTERN)?.[1];
  return matchedQuery !== undefined && !matchedQuery.includes('::');
}

/**
 * Detects a trailing `@path::query` mention, returning the file path and the
 * partial symbol typed so far. Used to offer the file's methods as completions
 * once the user types `::`. Returns undefined when no such mention is active.
 */
export function getActiveSymbolMention(
  content: string
): { path: string; query: string } | undefined {
  const match = content.match(ACTIVE_SYMBOL_MENTION_PATTERN);
  const path = match?.[1];
  if (!path) {
    return undefined;
  }

  return { path, query: match?.[2] ?? '' };
}

/**
 * Filters a file's symbols against the partial symbol typed after `::`,
 * prefix-matches first. An empty query lists every symbol (capped to `limit`).
 */
export function filterSymbolSuggestions(
  symbols: readonly string[],
  query: string | undefined,
  limit = 8
): string[] {
  if (query === undefined) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return symbols.slice(0, limit);
  }

  return symbols
    .map((symbol) => {
      const lower = symbol.toLowerCase();
      let score = 0;
      if (lower === normalizedQuery) score += 50;
      if (lower.startsWith(normalizedQuery)) score += 30;
      else if (lower.includes(normalizedQuery)) score += 10;
      return { symbol, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol))
    .slice(0, limit)
    .map(({ symbol }) => symbol);
}

/** Replaces the partial `::query` at the end of the prompt with `::symbol`. */
export function applySymbolSuggestion(content: string, symbol: string): string {
  return content.replace(
    /(@[^\s@]*?::)[^\s@:]*$/,
    `$1${symbol.replaceAll('$', '$$$$')}`
  );
}

export function filterMentionSuggestions(
  files: readonly string[],
  query: string | undefined,
  limit = 8
): string[] {
  if (query === undefined) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const scoredFiles = files
    .map((filePath) => {
      const lowerPath = filePath.toLowerCase();
      const score = calculateMatchScore(lowerPath, normalizedQuery);
      return { filePath, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.filePath.localeCompare(b.filePath))
    .slice(0, limit)
    .map(({ filePath }) => filePath);

  return scoredFiles;
}

function calculateMatchScore(filePath: string, query: string): number {
  let score = 0;

  if (filePath.toLowerCase().startsWith(query)) {
    score += 30;
  } else if (filePath.includes(`/${query}`) || filePath.endsWith(`/${query}`)) {
    score += 25;
  } else if (filePath.toLowerCase().includes(query)) {
    score += 10;
  }

  if (filePath.toLowerCase() === query) {
    score += 50;
  }

  if (filePath.toLowerCase().startsWith(query)) {
    score += 15;
  }

  if (query.length >= 3) {
    const parts = query.split('');
    let matchIndex = -1;
    let matchCount = 0;

    for (let i = 0; i < filePath.length; i++) {
      if (filePath[i] === parts[0]) {
        matchIndex = i;
        matchCount++;
        break;
      }
    }

    if (matchCount > 0) {
      for (let i = 1; i < parts.length; i++) {
        for (let j = matchIndex + 1; j < filePath.length; j++) {
          if (filePath[j] === parts[i]) {
            matchCount++;
            matchIndex = j;
            break;
          }
        }
      }

      if (matchCount === parts.length) {
        score += 20;
      }
    }
  }

  return score;
}

export function applyMentionSuggestion(
  content: string,
  suggestedPath: string
): string {
  return content.replace(
    /(^|\s)@[^\s@]*$/,
    `$1@${suggestedPath.replaceAll('$', '$$$$')}`
  );
}

function normalizeMentionPath(path: string | undefined): string | undefined {
  const trimmedPath = path?.trim().replace(TRAILING_PUNCTUATION_PATTERN, '');
  if (!trimmedPath) {
    return undefined;
  }

  return trimmedPath;
}

function createAbortError(): Error {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function formatAttachmentLines(text: string, maxLines: number): string {
  const lines = splitLines(text);
  if (lines.length === 0) {
    return '';
  }

  const limit = Math.max(1, Math.floor(maxLines));
  const shown = lines.slice(0, limit);
  const body = shown
    .map((line, index) => formatNumberedLine(index + 1, line))
    .join('\n');

  if (shown.length >= lines.length) {
    return body;
  }

  return (
    body +
    `\n\n(Showing lines 1-${shown.length} of ${lines.length}. Use read_file for more.)`
  );
}

function formatSymbolBlock(block: SymbolBlock, maxLines: number): string {
  const limit = Math.max(1, Math.floor(maxLines));
  const shown = block.lines.slice(0, limit);
  const body = shown
    .map((line, index) => formatNumberedLine(block.startLine + index, line))
    .join('\n');

  if (shown.length >= block.lines.length) {
    return body;
  }

  const lastShownLine = block.startLine + shown.length - 1;
  const endLine = block.startLine + block.lines.length - 1;
  return (
    body +
    `\n\n(Showing lines ${block.startLine}-${lastShownLine} of ${block.startLine}-${endLine}. Use read_file for more.)`
  );
}
