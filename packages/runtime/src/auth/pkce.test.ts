import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { createPkcePair, createState } from '@runtime/auth/pkce';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function base64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('createPkcePair', () => {
  it('derives the challenge as the base64url S256 hash of the verifier', () => {
    const { verifier, challenge } = createPkcePair();

    expect(verifier).toMatch(BASE64URL);
    expect(challenge).toMatch(BASE64URL);
    // No padding leaks through.
    expect(verifier).not.toContain('=');
    expect(challenge).not.toContain('=');

    const expected = base64Url(createHash('sha256').update(verifier).digest());
    expect(challenge).toBe(expected);
  });

  it('produces a unique high-entropy verifier each call', () => {
    const pairs = Array.from({ length: 50 }, () => createPkcePair().verifier);
    expect(new Set(pairs).size).toBe(pairs.length);
    // 32 random bytes → 43 base64url chars.
    expect(pairs[0]?.length).toBeGreaterThanOrEqual(43);
  });
});

describe('createState', () => {
  it('returns a unique base64url token', () => {
    const states = Array.from({ length: 50 }, () => createState());
    for (const state of states) {
      expect(state).toMatch(BASE64URL);
    }
    expect(new Set(states).size).toBe(states.length);
  });
});
