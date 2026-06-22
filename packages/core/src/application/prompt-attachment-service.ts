import type { MessageAttachment } from '@core/domain/message';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

const ACTIVE_MENTION_PATTERN = /(?:^|\s)@([^\s@]*)$/;
const MENTION_PATTERN = /(?:^|\s)@([^\s@]+)/g;
const TRAILING_PUNCTUATION_PATTERN = /[),.:;!?\]]+$/;

export class PromptAttachmentService {
  public constructor(private readonly workspaceFiles: WorkspaceFilePort) {}

  public async listFiles(): Promise<string[]> {
    return this.workspaceFiles.listFiles();
  }

  public async resolveAttachments(
    content: string
  ): Promise<MessageAttachment[]> {
    const mentions = extractFileMentions(content);

    return Promise.all(
      mentions.map(async (relativePath) => ({
        path: relativePath,
        content: await this.workspaceFiles.readFile(relativePath),
      }))
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

export function filterMentionSuggestions(
  files: readonly string[],
  query: string | undefined,
  limit = 8
): string[] {
  if (query === undefined) {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const rankedFiles = [...files].sort((left, right) => {
    const leftStartsWith = left.toLowerCase().startsWith(normalizedQuery);
    const rightStartsWith = right.toLowerCase().startsWith(normalizedQuery);

    if (leftStartsWith !== rightStartsWith) {
      return leftStartsWith ? -1 : 1;
    }

    return left.localeCompare(right);
  });

  return rankedFiles
    .filter((filePath) => filePath.toLowerCase().includes(normalizedQuery))
    .slice(0, limit);
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
