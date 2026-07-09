import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ConversationSummary } from '@core/ports/conversation-repository';
import { groupPickerSessions } from '@cli/ui/session-picker-groups.js';

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

describe('session picker chrome', () => {
  const source = readFileSync(
    join(process.cwd(), 'apps/cli/src/ui/session-picker.tsx'),
    'utf8'
  );

  it('advertises the pin shortcut in the header hints', () => {
    expect(source).toContain('ctrl+p to pin');
  });
});
