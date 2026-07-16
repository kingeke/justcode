import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConversationSummary } from '@core/ports/conversation-repository';
import {
  defaultCollapsedGroups,
  groupPickerSessions,
  PinnedGroup,
  SessionGroup,
} from '@cli/ui/session-picker-groups.js';

function summary(
  sessionId: string,
  updatedAt: Date,
  pinned?: boolean
): ConversationSummary {
  return {
    sessionId,
    createdAt: updatedAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    messageCount: 1,
    ...(pinned ? { pinned: true } : {}),
  };
}

const now = new Date();
const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('groupPickerSessions', () => {
  it('lists pinned sessions in their own group above the recency buckets', () => {
    const groups = groupPickerSessions([
      summary('today', now),
      summary('ancient-but-pinned', lastMonth, true),
    ]);

    expect(groups.map((bucket) => bucket.group)).toEqual(['Pinned', 'Today']);
    expect(groups[0]?.sessions.map((s) => s.sessionId)).toEqual([
      'ancient-but-pinned',
    ]);
    // A pinned session is lifted out of its recency bucket, not duplicated.
    expect(groups[1]?.sessions.map((s) => s.sessionId)).toEqual(['today']);
  });

  it('omits the pinned group when nothing is pinned', () => {
    const groups = groupPickerSessions([summary('today', now)]);

    expect(groups.map((bucket) => bucket.group)).toEqual(['Today']);
  });

  it('drops empty recency buckets', () => {
    const groups = groupPickerSessions([summary('old', lastMonth)]);

    expect(groups.map((bucket) => bucket.group)).toEqual(['Older']);
  });
});

describe('defaultCollapsedGroups', () => {
  it('collapses only the Last 7 days and Older buckets', () => {
    const collapsed = defaultCollapsedGroups();

    expect(collapsed.has(SessionGroup.LastSevenDays)).toBe(true);
    expect(collapsed.has(SessionGroup.Older)).toBe(true);
    expect(collapsed.has(SessionGroup.Today)).toBe(false);
    expect(collapsed.has(SessionGroup.Yesterday)).toBe(false);
    expect(collapsed.has(PinnedGroup.Pinned)).toBe(false);
  });
});

describe('session picker chrome', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/session-picker.tsx'),
    'utf8'
  );

  it('advertises the pin shortcut in the header hints', () => {
    expect(source).toContain('ctrl+p to pin');
  });

  it('seeds the collapsed groups from the shared default', () => {
    expect(source).toMatch(/\(\) =>\s*defaultCollapsedGroups\(\)/);
  });
});

describe('session picker model column', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/session-picker.tsx'),
    'utf8'
  );

  it('shows the provider → model the session last talked to', () => {
    expect(source).toContain('session.model');
    expect(source).toContain('`${providerName} → ${session.model.modelId}`');
  });

  it('renders the model on its own line under the title', () => {
    expect(source).toContain('function sessionModelContent(');
    expect(source).toMatch(
      /\{modelLine \? <text content=\{modelLine\} \/> : null\}/
    );
  });

  it('resolves the provider display name from the catalog', () => {
    expect(source).toContain('PROVIDER_BY_ID[session.model.providerId]?.name');
  });
});
