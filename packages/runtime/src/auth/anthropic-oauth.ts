import type { OAuthCredentials } from '@core/ports/provider-catalog';
import { logRequestResponse } from '@core/application/debug-log';

import { ANTHROPIC_OAUTH } from '@runtime/auth/constants';
import type { OAuthFlow, OAuthLoginContext } from '@runtime/auth/oauth-flow';
import { createPkcePair, createState } from '@runtime/auth/pkce';

interface AnthropicTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

/**
 * Claude Pro/Max sign-in via OAuth + PKCE. Anthropic's public client only
 * permits its hosted redirect, which displays the authorization code for the
 * user to paste back — so this flow uses {@link OAuthLoginContext.promptInput}
 * rather than a loopback server. The pasted value is `code#state`.
 */
export class AnthropicOAuthFlow implements OAuthFlow {
  public async login(context: OAuthLoginContext): Promise<OAuthCredentials> {
    if (!context.promptInput) {
      throw new Error(
        'Anthropic sign-in requires pasting an authorization code.'
      );
    }

    const pkce = createPkcePair();
    const state = createState();
    // Build the query with encodeURIComponent (which encodes spaces as %20)
    // rather than URLSearchParams (which uses `+`). Anthropic's authorize
    // endpoint parses `+` in the multi-value `scope` as a literal plus, not a
    // space separator, and rejects the request as "Invalid request format".
    const query = Object.entries({
      code: 'true',
      client_id: ANTHROPIC_OAUTH.clientId,
      response_type: 'code',
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      scope: ANTHROPIC_OAUTH.scope,
      state,
      code_challenge: pkce.challenge,
      code_challenge_method: 'S256',
    })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join('&');
    const authorizeUrl = `${ANTHROPIC_OAUTH.authorizeUrl}?${query}`;

    await context.openUrl(authorizeUrl);
    context.notify(
      'Opened claude.ai to sign in. Approve access, then paste the code shown.'
    );

    const pasted = (await context.promptInput('authorization code')).trim();
    const [code, returnedState] = pasted.split('#');
    if (!code) throw new Error('No authorization code was entered.');

    return this.exchange({
      grant_type: 'authorization_code',
      code,
      state: returnedState ?? state,
      redirect_uri: ANTHROPIC_OAUTH.redirectUri,
      code_verifier: pkce.verifier,
    });
  }

  public async refresh(
    credentials: OAuthCredentials
  ): Promise<OAuthCredentials> {
    if (!credentials.refreshToken) {
      throw new Error('Cannot refresh Anthropic token: no refresh token.');
    }
    return this.exchange({
      grant_type: 'refresh_token',
      refresh_token: credentials.refreshToken,
    });
  }

  private async exchange(
    body: Record<string, string>
  ): Promise<OAuthCredentials> {
    const response = await fetch(ANTHROPIC_OAUTH.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: ANTHROPIC_OAUTH.clientId, ...body }),
    });
    if (!response.ok) {
      const text = await response.text();
      await logRequestResponse({
        request: {
          url: ANTHROPIC_OAUTH.tokenUrl,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: { client_id: ANTHROPIC_OAUTH.clientId, ...body },
        },
        response: {
          url: ANTHROPIC_OAUTH.tokenUrl,
          status: response.status,
          ok: response.ok,
          body: text,
        },
      });
      throw new Error(
        `Anthropic token exchange failed (${response.status}): ${text}`
      );
    }

    const token = (await response.json()) as AnthropicTokenResponse;
    await logRequestResponse({
      request: {
        url: ANTHROPIC_OAUTH.tokenUrl,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { client_id: ANTHROPIC_OAUTH.clientId, ...body },
      },
      response: {
        url: ANTHROPIC_OAUTH.tokenUrl,
        status: response.status,
        ok: response.ok,
        body: token,
      },
    });
    return {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: token.expires_in
        ? Date.now() + token.expires_in * 1000
        : undefined,
    };
  }
}
