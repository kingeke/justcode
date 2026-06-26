import type { OAuthCredentials } from '@core/ports/provider-catalog';

/**
 * Host-supplied hooks an OAuth flow uses to drive its interactive parts. The
 * runtime/UI provides these so flows stay free of any terminal/UI concerns.
 */
export interface OAuthLoginContext {
  /** Opens a URL in the browser (the UI may also render it for manual use). */
  openUrl: (url: string) => Promise<boolean> | boolean;
  /** Shows a status/instruction line to the user. */
  notify: (message: string) => void;
  /**
   * Prompts the user to paste a value (e.g. an authorization code) and resolves
   * with their input. Required by flows that can't capture a redirect.
   */
  promptInput?: (label: string) => Promise<string>;
  signal?: AbortSignal;
}

export interface OAuthFlow {
  /** Runs the interactive sign-in and returns freshly-minted credentials. */
  login(context: OAuthLoginContext): Promise<OAuthCredentials>;
  /** Exchanges a refresh token (or equivalent) for a fresh access token. */
  refresh(credentials: OAuthCredentials): Promise<OAuthCredentials>;
}
