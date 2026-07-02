import { describe, expect, it } from 'vitest';

import { formatTime } from '@cli/ui/format-message-timing.js';

describe('formatTime', () => {
  it('formats an ISO date as a local hour:minute time', () => {
    const iso = '2026-07-02T10:15:30.000Z';
    expect(formatTime(iso)).toBe(
      new Date(iso).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      })
    );
  });

  it('returns an empty string for an unparsable date', () => {
    expect(formatTime('not-a-date')).toBe('');
  });
});
