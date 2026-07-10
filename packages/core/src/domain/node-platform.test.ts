import { describe, expect, it } from 'vitest';

import { NodePlatform } from '@core/domain/node-platform';

describe('NodePlatform', () => {
  it('has stable process.platform string values', () => {
    expect(NodePlatform.Darwin).toBe('darwin');
    expect(NodePlatform.Win32).toBe('win32');
    expect(NodePlatform.Linux).toBe('linux');
  });
});
