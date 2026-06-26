import { ProviderId } from '@core/ports/provider-catalog';

import { AnthropicOAuthFlow } from '@runtime/auth/anthropic-oauth';
import { CopilotOAuthFlow } from '@runtime/auth/copilot-oauth';
import { OpenAiOAuthFlow } from '@runtime/auth/openai-oauth';
import type { OAuthFlow } from '@runtime/auth/oauth-flow';

/** The OAuth sign-in flow for each subscription-capable provider, if any. */
export function getOAuthFlow(providerId: ProviderId): OAuthFlow | undefined {
  switch (providerId) {
    case ProviderId.Anthropic:
      return new AnthropicOAuthFlow();
    case ProviderId.Openai:
      return new OpenAiOAuthFlow();
    case ProviderId.Copilot:
      return new CopilotOAuthFlow();
    default:
      return undefined;
  }
}
