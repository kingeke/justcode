# JustCode for VS Code

The JustCode coding assistant as a VS Code sidebar — the same lean, transparent
agent as the CLI, reusing `@core` / `@runtime` / `@providers` directly. Bring
your own provider, keep your editable system prompt, control every token.

## Architecture

```
src/
  extension.ts            activate(): registers the webview view + commands
  host/
    chat-view-provider.ts WebviewViewProvider — owns the webview + CSP shell
    chat-bridge.ts        wires ChatSessionService <-> webview messages
  shared/
    protocol.ts           typed host <-> webview message protocol (enums)
  webview/
    index.tsx             React entry
    App.tsx               chat state machine (useReducer)
    state.ts              reducer over host messages + local UI actions
    components/           transcript, tool activity, approvals, composer, header
    webview.css           themed entirely via VS Code CSS variables
```

The extension host runs in VS Code's Node-based extension host, so it imports
the reusable packages straight from source (no Bun, no OpenTUI — that
dependency lives only in `apps/cli`). The webview is a separate browser bundle.

Both bundles are produced by `esbuild.mjs`, reusing the repo's path aliases
(`@core`, `@runtime`, `@providers`) plus `@ext` for the extension's own modules.

## Develop

From the repo root, install once (`npm install`). Then, from this folder:

```bash
npm run build      # bundle host -> dist/, webview -> media/
npm run watch      # rebuild on change
npm run typecheck  # tsc --noEmit
```

To run it: open `apps/vscode` in VS Code and press **F5** ("Run JustCode
Extension"). A second VS Code window launches with the extension loaded — open
the JustCode view from the activity bar.

A provider must be configured first (via the JustCode CLI or provider env vars);
the panel shows a notice with instructions until one is connected.

## Milestone status

Milestone 1 (this build): streaming chat, live tool activity, inline tool
approvals, in-tool questions, provider/model selection, and session reset.

Later: rich markdown rendering in the transcript, image paste, session history
browsing, and reasoning-effort selection.
