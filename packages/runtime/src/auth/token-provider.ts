import {
  ProviderId,
  type OAuthCredentials,
} from '@core/ports/provider-catalog';

import { TOKEN_REFRESH_SKEW_MS } from '@runtime/auth/constants';
import { getOAuthFlow } from '@runtime/auth/oauth-flows';

export type PersistCredentials = (
  credentials: OAuthCredentials
) => void | Promise<void>;

/**
 * Returns an async function that resolves a currently-valid OAuth access token
 * for {@link providerId}. When the cached token is within
 * {@link TOKEN_REFRESH_SKEW_MS} of expiry it transparently refreshes via the
 * provider's flow, persists the new credentials through {@link persist}, and
 * returns the fresh token. Concurrent callers share a single in-flight refresh.
 */
export function createTokenProvider(
  providerId: ProviderId,
  initial: OAuthCredentials,
  persist: PersistCredentials
): () => Promise<string> {
  let current = initial;
  let refreshing: Promise<OAuthCredentials> | undefined;

  const isExpired = (creds: OAuthCredentials): boolean =>
    creds.expiresAt != null &&
    Date.now() >= creds.expiresAt - TOKEN_REFRESH_SKEW_MS;

  return async () => {
    if (!isExpired(current)) {
      return current.accessToken;
    }

    if (!refreshing) {
      const flow = getOAuthFlow(providerId);
      if (!flow) {
        // No refresh path — fall back to the (possibly stale) token rather than
        // breaking the request; the provider will surface a 401 if it's dead.
        return current.accessToken;
      }
      refreshing = flow
        .refresh(current)
        .then(async (next) => {
          current = next;
          await persist(next);
          return next;
        })
        .finally(() => {
          refreshing = undefined;
        });
    }

    const refreshed = await refreshing;
    return refreshed.accessToken;
  };
}
