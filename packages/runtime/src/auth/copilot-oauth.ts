import type { OAuthCredentials } from '@core/ports/provider-catalog';
import { appUserAgent } from '@core/version';

import { GITHUB_COPILOT_OAUTH } from '@runtime/auth/constants';
import { runDeviceFlow } from '@runtime/auth/device-flow';
import type { OAuthFlow, OAuthLoginContext } from '@runtime/auth/oauth-flow';

interface CopilotTokenResponse {
  token: string;
  /** Epoch seconds. */
  expires_at: number;
  endpoints?: { api?: string };
}

/**
 * GitHub Copilot sign-in. GitHub uses a device-code flow to mint a long-lived
 * GitHub OAuth token, which we then exchange for a short-lived Copilot API
 * token. The GitHub token is kept as the "refresh token" so we can re-mint the
 * Copilot token whenever it expires; the Copilot chat endpoint is persisted in
 * {@link OAuthCredentials.extra} so it survives a restart.
 */
export class CopilotOAuthFlow implements OAuthFlow {
  public async login(
    context: OAuthLoginContext
  ): Promise<OAuthCredentials> {
    const githubToken = await runDeviceFlow({
      clientId: GITHUB_COPILOT_OAUTH.clientId,
      scope: GITHUB_COPILOT_OAUTH.scope,
      deviceCodeUrl: GITHUB_COPILOT_OAUTH.deviceCodeUrl,
      accessTokenUrl: GITHUB_COPILOT_OAUTH.accessTokenUrl,
      ...(context.signal ? { signal: context.signal } : {}),
      onPrompt: (prompt) => {
        void context.openUrl(prompt.verificationUri);
        context.notify(
          `Go to ${prompt.verificationUri} and enter code: ${prompt.userCode}`
        );
      },
    });

    return this.exchangeCopilotToken(githubToken);
  }

  public async refresh(
    credentials: OAuthCredentials
  ): Promise<OAuthCredentials> {
    const githubToken = credentials.refreshToken;
    if (!githubToken) {
      throw new Error('Cannot refresh Copilot token: missing GitHub token.');
    }
    return this.exchangeCopilotToken(githubToken);
  }

  private async exchangeCopilotToken(
    githubToken: string
  ): Promise<OAuthCredentials> {
    const response = await fetch(GITHUB_COPILOT_OAUTH.copilotTokenUrl, {
      headers: {
        authorization: `token ${githubToken}`,
        accept: 'application/json',
        'editor-version': appUserAgent(),
        'user-agent': appUserAgent(),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Copilot token exchange failed (${response.status}): ${text}. ` +
          'Make sure your GitHub account has an active Copilot subscription.'
      );
    }

    const token = (await response.json()) as CopilotTokenResponse;
    const endpoint = token.endpoints?.api ?? 'https://api.githubcopilot.com';
    return {
      accessToken: token.token,
      refreshToken: githubToken,
      expiresAt: token.expires_at * 1000,
      extra: { endpoint },
    };
  }
}
