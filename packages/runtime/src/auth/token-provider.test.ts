import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderId } from '@core/ports/provider-catalog';
import type { OAuthCredentials } from '@core/ports/provider-catalog';

import { createTokenProvider } from '@runtime/auth/token-provider';
import { getOAuthFlow } from '@runtime/auth/oauth-flows';

vi.mock('@runtime/auth/oauth-flows', () => ({
  getOAuthFlow: vi.fn(),
}));

const mockedGetFlow = vi.mocked(getOAuthFlow);

describe('createTokenProvider', () => {
  beforeEach(() => {
    mockedGetFlow.mockReset();
  });

  it('returns the cached token while it is still valid', async () => {
    const creds: OAuthCredentials = {
      accessToken: 'valid',
      expiresAt: Date.now() + 60 * 60_000,
    };
    const persist = vi.fn();

    const getToken = createTokenProvider(ProviderId.Anthropic, creds, persist);

    expect(await getToken()).toBe('valid');
    expect(mockedGetFlow).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it('refreshes, persists, and returns a new token when expired', async () => {
    const stale: OAuthCredentials = { accessToken: 'stale', expiresAt: 0 };
    const fresh: OAuthCredentials = {
      accessToken: 'fresh',
      expiresAt: Date.now() + 60 * 60_000,
    };
    const refresh = vi.fn().mockResolvedValue(fresh);
    mockedGetFlow.mockReturnValue({ refresh } as never);
    const persist = vi.fn().mockResolvedValue(undefined);

    const getToken = createTokenProvider(ProviderId.Anthropic, stale, persist);

    expect(await getToken()).toBe('fresh');
    expect(refresh).toHaveBeenCalledWith(stale);
    expect(persist).toHaveBeenCalledWith(fresh);
    // A subsequent call uses the cached fresh token without refreshing again.
    expect(await getToken()).toBe('fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shares a single in-flight refresh across concurrent callers', async () => {
    const stale: OAuthCredentials = { accessToken: 'stale', expiresAt: 0 };
    const fresh: OAuthCredentials = {
      accessToken: 'fresh',
      expiresAt: Date.now() + 60 * 60_000,
    };
    const refresh = vi.fn().mockResolvedValue(fresh);
    mockedGetFlow.mockReturnValue({ refresh } as never);

    const getToken = createTokenProvider(ProviderId.Anthropic, stale, vi.fn());

    const [a, b] = await Promise.all([getToken(), getToken()]);

    expect(a).toBe('fresh');
    expect(b).toBe('fresh');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('falls back to the stale token when no refresh flow exists', async () => {
    const stale: OAuthCredentials = { accessToken: 'stale', expiresAt: 0 };
    mockedGetFlow.mockReturnValue(undefined);
    const persist = vi.fn();

    const getToken = createTokenProvider(ProviderId.Anthropic, stale, persist);

    expect(await getToken()).toBe('stale');
    expect(persist).not.toHaveBeenCalled();
  });
});
