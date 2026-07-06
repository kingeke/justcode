# Using Claude subscriptions in JustCode legally

Researched July 6, 2026. **Implemented July 6, 2026** — subscription support
ships as the `claude-code` provider (`packages/providers/src/claude-code/`),
built on the official Claude Agent SDK; the prohibited direct-OAuth path was
removed from `AnthropicProvider`.

## Context

JustCode is a third-party terminal coding assistant. Today its Anthropic provider (`packages/providers/src/anthropic/anthropic-provider.ts`) authenticates with Claude Pro/Max **OAuth tokens directly against `api.anthropic.com`**, sending the `oauth-2025-04-20` beta header and injecting the "You are Claude Code, Anthropic's official CLI" identity block. This is the pattern Anthropic explicitly banned: since Jan–Feb 2026, consumer (Free/Pro/Max) OAuth tokens **may not be used in third-party tools or direct API clients**, and impersonating Claude Code violates the Consumer Terms. Anthropic has been blocking this technically and it risks user account bans.

## Policy research (as of July 2026)

Timeline of Anthropic's position:

1. **Jan–Feb 2026** — Anthropic blocked consumer OAuth tokens in third-party API clients and clarified in docs that Free/Pro/Max OAuth tokens cannot be used in third-party tools; API keys required for product integrations.
2. **Apr 4, 2026** — hard block: subscriptions could no longer power non-Anthropic agents/harnesses (OpenClaw et al.).
3. **May 2026** — reinstated third-party agent usage via a dedicated **"Agent SDK credit"** pool ($20 Pro / $100 Max 5x / $200 Max 20x per month) for programmatic use (`claude -p`, GitHub Actions, third-party tools built on the Agent SDK).
4. **Jun 15, 2026** — Anthropic **paused the credit split**. Per the official Help Center ("Use the Claude Agent SDK with your Claude plan"): Agent SDK, `claude -p`, and third-party app usage **currently draw from the normal subscription limits**, and third-party applications built on the Agent SDK that authenticate through the user's subscription **are allowed**. Anthropic will give advance notice before any future change.

**The legal boundary today:**
- ✅ **Allowed**: building JustCode's Anthropic backend on the **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), which runs the official Claude Code runtime locally and uses the user's own subscription login (`claude /login` or `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`). Usage draws from the user's Pro/Max limits.
- ✅ **Allowed**: API keys from Claude Console (already supported).
- ❌ **Prohibited**: extracting/obtaining consumer OAuth tokens and calling the Messages API directly from JustCode's own HTTP client, spoofing Claude Code headers/system prompt (the current implementation).

## Recommended approach

Replace the direct-OAuth path with an **Agent SDK-backed provider**; keep the API-key path as-is.

1. Add `@anthropic-ai/claude-agent-sdk` (via `bun add` — bun.lock is canonical).
2. New provider implementation, e.g. `packages/providers/src/anthropic/anthropic-agent-sdk-provider.ts`, implementing the existing `ProviderClient` port (`packages/core/src/ports/chat-model.ts`) by driving the SDK's `query()` stream and mapping its events to JustCode's chat events. It relies on the user's Claude Code credentials (keychain login or `CLAUDE_CODE_OAUTH_TOKEN`) — JustCode never touches the token.
3. In `packages/core/src/ports/provider-catalog.ts` / connect flow (`apps/cli/src/ui/connect-picker.tsx`): the Anthropic "subscription" auth method routes to the Agent SDK provider; detect the Claude Code CLI / credentials and guide the user to run `claude` login (or `claude setup-token`) if absent.
4. Remove the OAuth-token wire path from `anthropic-provider.ts` (the `OAUTH_BETA` header, Claude Code identity block, and `getAccessToken` bearer flow), leaving API-key auth only.
5. Docs: note in README/TERMS that subscription usage runs through the official Claude Agent SDK and counts against the user's plan limits; recommend API keys for heavy/production use.

Trade-offs to be aware of: the Agent SDK runs the Claude Code agent loop (its own tool-calling), so mapping to JustCode's own tool/agent loop is the main integration work; alternatively use its "bare"/single-turn options to use it as a pure model gateway where supported. Requires the user to have Claude Code installed (the SDK can bundle/download the CLI runtime).

## Verification

- `bun run dev`, connect Anthropic via subscription, confirm chat works with only a `claude` login and no API key.
- Confirm API-key path still works unchanged.
- Unit tests for the event mapping in `packages/providers/src/anthropic/`.

## Sources

- [Use the Claude Agent SDK with your Claude plan — Claude Help Center](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Claude Code authentication docs](https://code.claude.com/docs/en/authentication)
- [Anthropic reinstates OpenClaw and third-party agent usage on Claude subscriptions — VentureBeat](https://venturebeat.com/technology/anthropic-reinstates-openclaw-and-third-party-agent-usage-on-claude-subscriptions-with-a-catch)
- [Anthropic cuts off Claude subscriptions for third-party agents — VentureBeat](https://venturebeat.com/technology/anthropic-cuts-off-the-ability-to-use-claude-subscriptions-with-openclaw-and)
- [Anthropic clarifies ban on third-party tool access to Claude — The Register](https://www.theregister.com/2026/02/20/anthropic_clarifies_ban_third_party_claude_access/)
- [Anthropic Bans Claude Subscription OAuth in Third-Party Apps — WinBuzzer](https://winbuzzer.com/2026/02/19/anthropic-bans-claude-subscription-oauth-in-third-party-apps-xcxwbn/)
- [What Anthropic's New Claude Billing Means for Zed Users — Zed blog](https://zed.dev/blog/anthropic-subscription-changes)
