import { ProviderId } from '@core/ports/provider-catalog';

import { CopilotOAuthFlow } from '@runtime/auth/copilot-oauth';
import { OpenAiOAuthFlow } from '@runtime/auth/openai-oauth';
import type { OAuthFlow } from '@runtime/auth/oauth-flow';

/**
 * The OAuth sign-in flow for each subscription-capable provider, if any.
 * Anthropic subscriptions deliberately have no flow here: consumer OAuth
 * tokens may not be used outside the official Claude Code client, so the
 * 'claude-code' provider defers auth to the user's own `claude /login`.
 */
export function getOAuthFlow(providerId: ProviderId): OAuthFlow | undefined {
  switch (providerId) {
    case ProviderId.Openai:
      return new OpenAiOAuthFlow();
    case ProviderId.Copilot:
      return new CopilotOAuthFlow();
    default:
      return undefined;
  }
}
