import { describe, expect, it } from 'vitest';

import {
  applyMentionSuggestion,
  extractFileMentions,
  filterMentionSuggestions,
  getActiveMentionQuery,
  PromptAttachmentService,
} from '@core/application/prompt-attachment-service';
import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';

class InMemoryWorkspaceFiles implements WorkspaceFilePort {
  public constructor(private readonly files: Record<string, string>) {}

  public async listFiles(): Promise<string[]> {
    return Object.keys(this.files);
  }

  public async readFile(relativePath: string): Promise<string> {
    const content = this.files[relativePath];
    if (content === undefined) {
      throw new Error(`File '${relativePath}' was not found.`);
    }

    return content;
  }

  public async readFileBytes(relativePath: string): Promise<Uint8Array> {
    return Buffer.from(await this.readFile(relativePath), 'utf8');
  }

  public async writeFile(relativePath: string, content: string): Promise<void> {
    this.files[relativePath] = content;
  }
}

describe('PromptAttachmentService', () => {
  it('resolves unique file mentions into attachments', async () => {
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({
        'src/app.ts': 'console.log("app")',
        'README.md': '# Readme',
      })
    );

    const attachments = await service.resolveAttachments(
      'Review @src/app.ts and @README.md and @src/app.ts.'
    );

    expect(attachments).toEqual([
      { path: 'src/app.ts', content: 'console.log("app")' },
      { path: 'README.md', content: '# Readme' },
    ]);
  });

  it('skips mentions that do not resolve to a readable file', async () => {
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({ 'src/app.ts': 'console.log("app")' })
    );

    const attachments = await service.resolveAttachments(
      'Review @src/app.ts and @tsup'
    );

    expect(attachments).toEqual([
      { path: 'src/app.ts', content: 'console.log("app")' },
    ]);
  });
});

describe('prompt mention helpers', () => {
  it('extracts and deduplicates file mentions', () => {
    expect(
      extractFileMentions('Check @src/app.ts, @README.md, and @src/app.ts.')
    ).toEqual(['src/app.ts', 'README.md']);
  });

  it('detects the active mention query at the end of the prompt', () => {
    expect(getActiveMentionQuery('Review @src/ui/ch')).toBe('src/ui/ch');
    expect(getActiveMentionQuery('Review src/ui/ch')).toBeUndefined();
  });

  it('filters matching suggestions with prefix-first ranking', () => {
    expect(
      filterMentionSuggestions(
        [
          'README.md',
          'apps/cli/src/index.tsx',
          'packages/core/src/domain/message.ts',
        ],
        'app'
      )
    ).toEqual(['apps/cli/src/index.tsx']);
  });

  it('applies the selected suggestion to the current mention', () => {
    expect(
      applyMentionSuggestion('Review @apps/cli/s', 'apps/cli/src/index.tsx')
    ).toBe('Review @apps/cli/src/index.tsx ');
  });
});
