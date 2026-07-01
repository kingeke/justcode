<p align="center">
  <img src="assets/images/logo.png" alt="JustCode" width="440" />
</p>

<p align="center">
  <strong>A lean, transparent terminal coding assistant where <em>you</em> control every token.</strong>
</p>

<p align="center">
  <a href="https://kingeke.github.io/justcode/">Website</a> ·
  <a href="release.md">Releasing</a> ·
  <a href="https://github.com/kingeke/justcode/issues">Issues</a>
</p>

---

Most AI coding tools quietly inflate every request with huge hidden prompts you
can't see or change — GitHub Copilot can spend ~27k tokens on a single "hey,"
and other tools routinely send ~7k. JustCode sends roughly **550 tokens per
request**, and most of that is a **system prompt you can read and edit** to be
exactly what you want. No hidden bloat, no wasted spend — your context, your
rules.

## Why JustCode

- **~550 tokens per request** — no hidden bloat inflating every call.
- **A system prompt you can read and edit** — no black box.
- **Bring your own provider & key** — OpenAI, Anthropic, OpenRouter, Qwen
  (Alibaba Cloud), Ollama, LM Studio, or any OpenAI-compatible endpoint.
- **Self-contained binary** — ships with its runtime embedded; end users need
  no Node, no Bun, and no `node_modules`.
- **File-backed sessions** — conversations are saved under `~/.justcode/sessions`
  so you can resume, branch, and revisit past work.
- **MCP servers**, **chat modes** (Build / Ask / Plan + custom), and a
  **VS Code extension** sharing the same lean engine.

## Install

Once a release is published, install through any channel (all fetch the same
self-contained binary — no runtime prerequisites):

```bash
# curl
curl -fsSL https://raw.githubusercontent.com/kingeke/justcode/main/scripts/install.sh | sh

# npm / bun / pnpm
npm install -g justcode

# Homebrew
brew tap kingeke/justcode && brew install justcode
```

See [release.md](release.md) for how binaries are built and published.

## Quick start

1. Run `justcode`.
2. Use `/connect` to add a provider (paste an API key or sign in), then
   `/models` to pick a model.
3. Start chatting. Type `/` to see every command; resume past work with
   `/sessions`.

## Tools, commands & modes

JustCode gives the model a focused toolset — read / write / edit files, run
`bash`, `grep`, `glob`, fetch and search the web, plan work, and more — and can
load extra tools on demand to keep requests lean. Everything is driven from the
prompt with ~23 slash commands (`/connect`, `/models`, `/mode`, `/sessions`,
`/manage-tools`, `/reasoning`, …), across three modes plus your own:

- **Build** — implement changes with the full toolset (the default).
- **Ask** — read-only Q&A about your codebase; explains without editing.
- **Plan** — produce a reviewable plan first, then implement on approval.
- **Custom** — define your own mode and system prompt via `/mode`.

The full, always-current list of tools and commands is on the
**[website](https://kingeke.github.io/justcode/)**.

## Develop locally

Building requires [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).
Bun is only needed to build — the produced binary runs on its own.

```bash
npm install            # install dependencies (once)
npm run install:local  # compile the host binary and symlink it as `justcode`
```

`install:local` compiles a self-contained binary
(`dist-bin/justcode-<os>-<arch>`) and symlinks it onto your PATH. After changing
code, rebuild — the symlink picks up the new binary automatically:

```bash
npm run update:local    # recompile the binary
npm run uninstall:local # remove the symlink
```

Handy scripts:

```bash
npm run dev        # run the CLI from source
npm test           # run the test suite
npm run typecheck  # type-check the workspace
npm run web        # run the landing page (apps/web) locally
```

## Repository layout

- `apps/cli` — the terminal UI.
- `apps/vscode` — the VS Code extension.
- `apps/web` — the landing page (React + Vite), deployed to GitHub Pages.
- `packages/core` — domain + application logic (provider-agnostic).
- `packages/runtime` — tools, MCP, auth, and service wiring.
- `packages/providers` — provider integrations.

## Website

The landing page lives in `apps/web` and deploys to GitHub Pages at
**https://kingeke.github.io/justcode/** via `.github/workflows/pages.yml`. Enable
it once under **Settings → Pages → Source: GitHub Actions**; after that every
push that touches the site republishes it.

## Support the developer

JustCode is free and open source. If it saved you time, a small tip is hugely
appreciated — no pressure, no paywall. 🙏

- **Ko-fi:** https://ko-fi.com/kingeke — card, Apple Pay, Google Pay, or PayPal;
  no account needed.
- **Bitcoin (BTC):** `1B8skEF6uo8PNGjcd624gkJf3TJt73DF8X`
- **Tether (USDT · TRC20):** `TD9UEFBPtsLLbQYxRXFCgtBWDdogkiXMqq`

## License

[MIT](LICENSE) © Chinonso Eke
