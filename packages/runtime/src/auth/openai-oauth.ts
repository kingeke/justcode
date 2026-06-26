import type { OAuthCredentials } from '@core/ports/provider-catalog';
import { logRequestResponse } from '@core/application/debug-log';

import { OPENAI_OAUTH } from '@runtime/auth/constants';
import { startLoopbackServer } from '@runtime/auth/loopback-server';
import type { OAuthFlow, OAuthLoginContext } from '@runtime/auth/oauth-flow';
import { createPkcePair, createState } from '@runtime/auth/pkce';

interface OpenAiTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  /** JWT carrying the ChatGPT account id under the OpenAI auth claim. */
  id_token?: string;
}

/**
 * Pulls the ChatGPT account id out of the OAuth `id_token`. The Codex backend
 * requires it as a `chatgpt-account-id` header on every request; without it the
 * Responses API returns 401. Returns undefined if the token can't be decoded
 * (e.g. a refresh response that omits the id_token) so callers can fall back to
 * the previously-stored value.
 */
function extractChatGptAccountId(
  idToken: string | undefined
): string | undefined {
  if (!idToken) return undefined;
  const payload = idToken.split('.')[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const claims = JSON.parse(json) as {
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string };
    };
    return claims['https://api.openai.com/auth']?.chatgpt_account_id;
  } catch {
    return undefined;
  }
}

/**
 * ChatGPT (OpenAI subscription) sign-in via OAuth + PKCE with a loopback
 * redirect. Codex pins the redirect to a fixed localhost port, so this binds the
 * same one and captures the authorization code automatically.
 */
export class OpenAiOAuthFlow implements OAuthFlow {
  public async login(context: OAuthLoginContext): Promise<OAuthCredentials> {
    const pkce = createPkcePair();
    const state = createState();

    // Redirect URI must use `localhost` (not `127.0.0.1`) — OpenAI does exact
    // string matching against the registered URIs for this client.
    const redirectUri = `http://${OPENAI_OAUTH.redirectHost}:${OPENAI_OAUTH.redirectPort}${OPENAI_OAUTH.redirectPath}`;

    const server = await startLoopbackServer({
      expectedState: state,
      port: OPENAI_OAUTH.redirectPort,
      path: OPENAI_OAUTH.redirectPath,
      host: OPENAI_OAUTH.redirectHost,
      ...(context.signal ? { signal: context.signal } : {}),
    });

    try {
      const authorizeUrl = new URL(OPENAI_OAUTH.authorizeUrl);
      authorizeUrl.searchParams.set('response_type', 'code');
      authorizeUrl.searchParams.set('client_id', OPENAI_OAUTH.clientId);
      authorizeUrl.searchParams.set('redirect_uri', redirectUri);
      authorizeUrl.searchParams.set('scope', OPENAI_OAUTH.scope);
      authorizeUrl.searchParams.set('code_challenge', pkce.challenge);
      authorizeUrl.searchParams.set('code_challenge_method', 'S256');
      authorizeUrl.searchParams.set('id_token_add_organizations', 'true');
      authorizeUrl.searchParams.set('codex_cli_simplified_flow', 'true');
      authorizeUrl.searchParams.set('state', state);

      const opened = await context.openUrl(authorizeUrl.toString());
      context.notify(
        opened
          ? 'Opened your browser to sign in to ChatGPT. Waiting for approval…'
          : `Open this URL to sign in:\n${authorizeUrl.toString()}`
      );

      const code = await server.waitForCode();
      return this.exchange({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        code_verifier: pkce.verifier,
      });
    } finally {
      server.close();
    }
  }

  public async refresh(
    credentials: OAuthCredentials
  ): Promise<OAuthCredentials> {
    if (!credentials.refreshToken) {
      throw new Error('Cannot refresh OpenAI token: no refresh token.');
    }
    // Carry the existing `extra` (endpoint + account id) forward in case the
    // refresh response omits a fresh id_token.
    return this.exchange(
      {
        grant_type: 'refresh_token',
        refresh_token: credentials.refreshToken,
        scope: OPENAI_OAUTH.scope,
      },
      credentials.extra
    );
  }

  private async exchange(
    body: Record<string, string>,
    previousExtra?: Record<string, string>
  ): Promise<OAuthCredentials> {
    const response = await fetch(OPENAI_OAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: OPENAI_OAUTH.clientId, ...body }),
    });
    if (!response.ok) {
      const text = await response.text();
      await logRequestResponse({
        request: {
          url: OPENAI_OAUTH.tokenUrl,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: { client_id: OPENAI_OAUTH.clientId, ...body },
        },
        response: {
          url: OPENAI_OAUTH.tokenUrl,
          status: response.status,
          ok: response.ok,
          body: text,
        },
      });
      throw new Error(
        `OpenAI token exchange failed (${response.status}): ${text}`
      );
    }

    const token = (await response.json()) as OpenAiTokenResponse;
    await logRequestResponse({
      request: {
        url: OPENAI_OAUTH.tokenUrl,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { client_id: OPENAI_OAUTH.clientId, ...body },
      },
      response: {
        url: OPENAI_OAUTH.tokenUrl,
        status: response.status,
        ok: response.ok,
        body: token,
      },
    });
    const chatgptAccountId =
      extractChatGptAccountId(token.id_token) ??
      previousExtra?.chatgptAccountId;

    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : undefined,
      // Persisted so the registry/connect flow can route to the Codex backend
      // and attach the account-id header on every request and across restarts.
      extra: {
        endpoint: OPENAI_OAUTH.codexBaseUrl,
        ...(chatgptAccountId ? { chatgptAccountId } : {}),
      },
    };
  }
}
