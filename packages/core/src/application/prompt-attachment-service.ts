import { DEFAULT_MAX_READ_BYTES } from '@core/application/limits';
import type { MessageAttachment } from '@core/domain/message';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

const ACTIVE_MENTION_PATTERN = /(?:^|\s)@([^\s@]*)$/;
const MENTION_PATTERN = /(?:^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.:;!?\]]+$/;

export class PromptAttachmentService {
  public constructor(
    private readonly workspaceFiles: WorkspaceFilePort,
    private readonly getMaxAttachmentBytes: () => number = () =>
      DEFAULT_MAX_READ_BYTES
  ) {}

  public async listFiles(): Promise<string[]> {
    return this.workspaceFiles.listFiles();
  }

  public async resolveAttachments(
    content: string,
    signal?: AbortSignal
  ): Promise<MessageAttachment[]> {
    const mentions = extractFileMentions(content);

    const resolved: Array<MessageAttachment | undefined> = [];
    for (const relativePath of mentions) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      try {
        const bytes = await this.workspaceFiles.readFileBytes(relativePath);
        resolved.push({
          path: relativePath,
          content: formatAttachmentContent(bytes, this.getMaxAttachmentBytes()),
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

  return matchedQuery;
}

export function hasActiveMentionTrigger(content: string): boolean {
  return ACTIVE_MENTION_PATTERN.test(content);
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
    `$1@${suggestedPath.replaceAll('$', '$$$$')} `
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

function formatAttachmentContent(bytes: Uint8Array, maxBytes: number): string {
  if (bytes.length === 0) {
    return '';
  }

  const byteLimit = Math.max(1, Math.floor(maxBytes));
  const end = Math.min(byteLimit, bytes.length);
  const text = Buffer.from(bytes.subarray(0, end)).toString('utf8');
  const body = numberLines(text.replaceAll('\r\n', '\n'));

  if (end >= bytes.length) {
    return body;
  }

  return (
    body +
    `\n\n(Output capped at ${byteLimit} bytes. Showing bytes 0-${end} of ${bytes.length}. Use read_file for more.)`
  );
}

function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, index) => `${index + 1}\t${line}`)
    .join('\n');
}
