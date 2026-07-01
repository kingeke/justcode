import { describe, expect, it } from 'vitest';

import { nextVersion } from './bump-version.mjs';

describe('nextVersion', () => {
  it('increments the patch for a patch release', () => {
    expect(nextVersion('0.1.1', 'patch')).toBe('0.1.2');
    expect(nextVersion('1.4.9', 'patch')).toBe('1.4.10');
  });

  it('increments the minor and resets patch for a minor release', () => {
    expect(nextVersion('0.1.1', 'minor')).toBe('0.2.0');
    expect(nextVersion('2.9.9', 'minor')).toBe('2.10.0');
  });

  it('increments the major and resets minor+patch for a major release', () => {
    expect(nextVersion('0.1.1', 'major')).toBe('1.0.0');
    expect(nextVersion('1.9.5', 'major')).toBe('2.0.0');
  });

  it('tolerates a pre-release/build suffix on the current version', () => {
    expect(nextVersion('0.1.1-beta.2', 'patch')).toBe('0.1.2');
  });

  it('throws on an unparseable version or unknown type', () => {
    expect(() => nextVersion('not-a-version', 'patch')).toThrow();
    expect(() => nextVersion('0.1.1', 'sideways')).toThrow();
  });
});
