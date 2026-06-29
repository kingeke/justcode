import { describe, expect, it } from 'vitest';

import {
  applyMentionSuggestion,
  applySymbolSuggestion,
  extractFileMentions,
  filterMentionSuggestions,
  filterSymbolSuggestions,
  getActiveMentionQuery,
  getActiveSymbolMention,
  hasActiveMentionTrigger,
  parseMention,
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
      { path: 'src/app.ts', content: '1 | console.log("app")' },
      { path: 'README.md', content: '1 | # Readme' },
    ]);
  });

  it('caps attachment content to the configured number of lines', async () => {
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({
        'src/app.ts': 'one\ntwo\nthree\nfour',
      }),
      () => 2
    );

    const attachments = await service.resolveAttachments('Review @src/app.ts');

    expect(attachments).toEqual([
      {
        path: 'src/app.ts',
        content:
          '1 | one\n2 | two\n\n(Showing lines 1-2 of 4. Use read_file for more.)',
      },
    ]);
  });

  it('attaches just the named method block for a @path::symbol mention', async () => {
    const file = [
      'export class ReportsRepository {',
      '  async findOne(id: string) {',
      '    return this.db.one(id);',
      '  }',
      '',
      '  async findMultipleBoq(ids: string[]) {',
      '    const rows = await this.db.many(ids);',
      '    return rows.map(toBoq);',
      '  }',
      '}',
    ].join('\n');
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({ 'reports.repository.ts': file })
    );

    const attachments = await service.resolveAttachments(
      'check @reports.repository.ts::findMultipleBoq please'
    );

    expect(attachments).toEqual([
      {
        path: 'reports.repository.ts::findMultipleBoq',
        content: [
          '6 |   async findMultipleBoq(ids: string[]) {',
          '7 |     const rows = await this.db.many(ids);',
          '8 |     return rows.map(toBoq);',
          '9 |   }',
        ].join('\n'),
      },
    ]);
  });

  it('extracts a body-less declaration up to its terminating semicolon', async () => {
    const file = [
      'export const A = 1;',
      'export type Boq = { id: string; total: number };',
      'export const B = 2;',
    ].join('\n');
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({ 'types.ts': file })
    );

    const attachments = await service.resolveAttachments('see @types.ts::Boq');

    expect(attachments).toEqual([
      {
        path: 'types.ts::Boq',
        content: '2 | export type Boq = { id: string; total: number };',
      },
    ]);
  });

  it('falls back to the whole file when the symbol is not found', async () => {
    const service = new PromptAttachmentService(
      new InMemoryWorkspaceFiles({ 'reports.repository.ts': 'const x = 1;' })
    );

    const attachments = await service.resolveAttachments(
      '@reports.repository.ts::missingMethod'
    );

    expect(attachments).toEqual([
      {
        path: 'reports.repository.ts',
        content:
          "(Symbol 'missingMethod' was not found in this file; showing the whole file.)\n1 | const x = 1;",
      },
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
      { path: 'src/app.ts', content: '1 | console.log("app")' },
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
    ).toBe('Review @apps/cli/src/index.tsx');
  });

  it('parses a mention into its path and optional symbol', () => {
    expect(parseMention('reports.repository.ts')).toEqual({
      path: 'reports.repository.ts',
    });
    expect(parseMention('reports.repository.ts::findMultipleBoq')).toEqual({
      path: 'reports.repository.ts',
      symbol: 'findMultipleBoq',
    });
    // A trailing `::` with no symbol is treated as a plain path.
    expect(parseMention('reports.repository.ts::')).toEqual({
      path: 'reports.repository.ts',
    });
  });

  it('stops file completion once the user starts naming a symbol', () => {
    expect(hasActiveMentionTrigger('look at @reports.repository.ts')).toBe(
      true
    );
    expect(
      hasActiveMentionTrigger('look at @reports.repository.ts::find')
    ).toBe(false);
    expect(
      getActiveMentionQuery('look at @reports.repository.ts::find')
    ).toBeUndefined();
  });

  it('detects an active @path::query symbol mention', () => {
    expect(
      getActiveSymbolMention('look at @reports.repository.ts::find')
    ).toEqual({ path: 'reports.repository.ts', query: 'find' });
    // Just-typed `::` with no query yet lists everything.
    expect(getActiveSymbolMention('@reports.repository.ts::')).toEqual({
      path: 'reports.repository.ts',
      query: '',
    });
    expect(
      getActiveSymbolMention('look at @reports.repository.ts')
    ).toBeUndefined();
  });

  it('filters symbols by the partial query, prefix-first', () => {
    expect(
      filterSymbolSuggestions(['findOne', 'findMany', 'create'], 'find')
    ).toEqual(['findMany', 'findOne']);
    // Empty query lists all symbols in order.
    expect(
      filterSymbolSuggestions(['findOne', 'findMany', 'create'], '')
    ).toEqual(['findOne', 'findMany', 'create']);
  });

  it('applies a selected symbol to the active mention', () => {
    expect(
      applySymbolSuggestion(
        'look at @reports.repository.ts::find',
        'findMultipleBoq'
      )
    ).toBe('look at @reports.repository.ts::findMultipleBoq');
  });
});
