import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('model picker provider collapse during search', () => {
  const view = readFileSync(
    join(
      process.cwd(),
      'apps/vscode/src/webview/components/ModelPickerView.tsx'
    ),
    'utf8'
  );

  it('collapsing works mid-search via a transient search-scoped set', () => {
    // A group's collapsed state must come from the active set, never gated
    // behind "not searching" — that gate made the chevron dead during search.
    expect(view).toContain('const collapsed = activeCollapsed.has(');
    expect(view).not.toContain('!searching && collapsedProviders.has(');

    // While searching, toggles go to the transient set; the persistent set is
    // untouched so it re-applies once the query clears.
    expect(view).toMatch(
      /const setActive = searching\s*\? setSearchCollapsedProviders\s*: setCollapsedProviders;/
    );
    expect(view).toMatch(
      /const activeCollapsed = searching\s*\? searchCollapsedProviders\s*: collapsedProviders;/
    );
  });

  it('every new query starts with all matches visible', () => {
    expect(view).toMatch(
      /React\.useEffect\(\(\) => \{\s*setSearchCollapsedProviders\(new Set\(\)\);\s*\}, \[query\]\);/
    );
  });
});
