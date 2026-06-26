import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OPENAI_OAUTH } from '@runtime/auth/constants';
import { OpenAiOAuthFlow } from '@runtime/auth/openai-oauth';
import { startLoopbackServer } from '@runtime/auth/loopback-server';

vi.mock('@runtime/auth/loopback-server', () => ({
  startLoopbackServer: vi.fn(),
}));

/** Builds a minimal unsigned JWT carrying the ChatGPT account-id claim. */
function makeIdToken(accountId: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url'
  );
  const payload = Buffer.from(
    JSON.stringify({
      'https://api.openai.com/auth': { chatgpt_account_id: accountId },
    })
  ).toString('base64url');
  return `${header}.${payload}.`;
}

describe('OpenAiOAuthFlow', () => {
  beforeEach(() => {
    vi.mocked(startLoopbackServer).mockResolvedValue({
      waitForCode: vi.fn().mockResolvedValue('auth-code'),
      close: vi.fn(),
    } as never);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          access_token: 'token',
          refresh_token: 'refresh',
          id_token: makeIdToken('acct-123'),
        }),
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests only ChatGPT scopes (no platform api.* scopes)', async () => {
    const flow = new OpenAiOAuthFlow();
    const openUrl = vi.fn().mockResolvedValue(true);

    await flow.login({ openUrl, notify: vi.fn() });

    const calledUrl = openUrl.mock.calls[0]?.[0];
    if (!calledUrl) throw new Error('Expected authorize URL to be opened.');

    const authorizeUrl = new URL(calledUrl);
    expect(authorizeUrl.searchParams.get('scope')).toBe(OPENAI_OAUTH.scope);
    expect(OPENAI_OAUTH.scope).not.toContain('api.');
  });

  it('captures the Codex endpoint and account id from the id_token', async () => {
    const flow = new OpenAiOAuthFlow();

    const creds = await flow.login({
      openUrl: vi.fn().mockResolvedValue(true),
      notify: vi.fn(),
    });

    expect(creds.accessToken).toBe('token');
    expect(creds.extra?.endpoint).toBe(OPENAI_OAUTH.codexBaseUrl);
    expect(creds.extra?.chatgptAccountId).toBe('acct-123');
  });

  it('preserves the account id on refresh when the id_token is absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ access_token: 'fresh' }),
      })
    );
    const flow = new OpenAiOAuthFlow();

    const creds = await flow.refresh({
      accessToken: 'old',
      refreshToken: 'refresh',
      extra: {
        endpoint: OPENAI_OAUTH.codexBaseUrl,
        chatgptAccountId: 'acct-9',
      },
    });

    expect(creds.accessToken).toBe('fresh');
    expect(creds.extra?.chatgptAccountId).toBe('acct-9');
  });
});
