/**
 * OAuth endpoints, public client ids, and scopes for the subscription sign-in
 * flows. These mirror the public values used by the official first-party CLIs
 * (Claude Code, Codex, GitHub Copilot) — they are not secret, but they DO drift
 * over time. Keep them all here so they are easy to verify and update against
 * the live services in one place.
 */

export const ANTHROPIC_OAUTH = {
  /** Public Claude Code OAuth client id. */
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  /**
   * The Anthropic public client only allows this fixed redirect, which renders
   * the authorization code on screen for the user to paste back (no loopback).
   */
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  scope: 'org:create_api_key user:profile user:inference',
} as const;

export const OPENAI_OAUTH = {
  /** Public Codex CLI OAuth client id. */
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  /** Codex binds the loopback redirect to this fixed port. */
  redirectPort: 1455,
  redirectPath: '/auth/callback',
  scope: 'openid profile email offline_access',
} as const;

export const GITHUB_COPILOT_OAUTH = {
  /** Public GitHub OAuth app id used by Copilot editor integrations. */
  clientId: 'Iv1.b507a08c87ecfe98',
  deviceCodeUrl: 'https://github.com/login/device/code',
  accessTokenUrl: 'https://github.com/login/oauth/access_token',
  /** Exchanges a GitHub token for a short-lived Copilot API token. */
  copilotTokenUrl: 'https://api.github.com/copilot_internal/v2/token',
  scope: 'read:user',
} as const;

/** Refresh an OAuth token this many ms before it actually expires. */
export const TOKEN_REFRESH_SKEW_MS = 60_000;
