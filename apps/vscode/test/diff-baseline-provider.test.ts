import { beforeEach, describe, expect, it, vi } from 'vitest';

// The provider only touches `vscode.EventEmitter` and `vscode.Uri.from`, so a
// tiny stand-in keeps the test independent of the real extension host.
vi.mock('vscode', () => {
  class EventEmitter<T> {
    public readonly event = (): void => {};
    public fire(_value: T): void {}
    public dispose(): void {}
  }
  const Uri = {
    from: ({ scheme, path }: { scheme: string; path: string }) => ({
      scheme,
      path,
    }),
  };
  return { EventEmitter, Uri };
});

import { DiffBaselineProvider } from '@ext/host/diff-baseline-provider';

describe('DiffBaselineProvider', () => {
  let provider: DiffBaselineProvider;

  beforeEach(() => {
    provider = new DiffBaselineProvider();
  });

  it('serves stored baseline text for its path', () => {
    provider.setBaseline('src/app.ts', 'before');
    const uri = DiffBaselineProvider.uriFor('src/app.ts');

    expect(provider.provideTextDocumentContent(uri)).toBe('before');
  });

  it('returns an empty string for an unknown path', () => {
    const uri = DiffBaselineProvider.uriFor('src/missing.ts');

    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('uses the custom baseline scheme in built URIs', () => {
    const uri = DiffBaselineProvider.uriFor('src/app.ts');

    expect(uri.scheme).toBe(DiffBaselineProvider.scheme);
    expect(uri.path).toBe('src/app.ts');
  });

  it('overwrites a previously stored baseline', () => {
    provider.setBaseline('src/app.ts', 'first');
    provider.setBaseline('src/app.ts', 'second');
    const uri = DiffBaselineProvider.uriFor('src/app.ts');

    expect(provider.provideTextDocumentContent(uri)).toBe('second');
  });
});
