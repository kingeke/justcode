# Just Code

Milestone 1 ships a working `justcode` CLI built with Ink. It supports OpenAI, Ollama, and LM Studio, loads provider configuration from environment variables, keeps file-backed conversation history, and includes automated tests.

## Install

JustCode ships as a single **self-contained binary** that embeds its runtime
(the Bun runtime plus the native terminal-UI library). End users need **no Bun,
no Node, and no `node_modules`** — just the binary.

### Published install (once released)

These channels work after a release is published (see [Publishing](#publishing)):

```bash
# curl — downloads the prebuilt binary for your OS/arch
curl -fsSL https://raw.githubusercontent.com/kingeke/just-code/main/scripts/install.sh | sh

# npm / bun / pnpm — installs a tiny launcher that fetches + runs the binary
npm install -g just-code
bun add -g just-code
pnpm add -g just-code

# Homebrew (via tap)
brew tap kingeke/just-code
brew install justcode
```

### Local install (from this repo)

For development, build the binary for your machine and put `justcode` on PATH:

```bash
npm install            # install dependencies (once; requires Bun for builds)
npm run install:local  # compile the host binary and symlink it as `justcode`
```

`install:local` compiles a self-contained binary (`dist-bin/justcode-<os>-<arch>`)
and symlinks it onto your PATH. After changing code, rebuild — the symlink picks
up the new binary automatically:

```bash
npm run update:local    # recompile the binary
npm run uninstall:local # remove the symlink
```

> **Building requires [Bun](https://bun.sh)** (`curl -fsSL https://bun.sh/install | bash`).
> Bun is only needed to *build* — the produced binary runs on its own. The
> terminal UI's native library (`@opentui/core`) is platform-specific, so
> binaries can't be cross-compiled; each platform is built on its own runner
> (see `.github/workflows/release.yml`).

## How distribution works

- `npm run build:binary` compiles `apps/cli/src/index.tsx` with `bun build
  --compile` into `dist-bin/justcode-<os>-<arch>`. The Bun runtime and the
  `@opentui` native library are embedded.
- On a tag push (`v*`), `.github/workflows/release.yml` builds one binary per
  platform on a native CI runner and uploads them as GitHub Release assets.
- `scripts/install.sh` (curl) and `Formula/justcode.rb` (brew) download the
  matching release asset directly.
- The npm package (`bin/justcode.mjs`) is a small Node launcher: on install it
  downloads the binary for the current platform (`scripts/postinstall.mjs`),
  falling back to a lazy download on first run if install scripts were blocked.

## Publishing

The package is marked `private` so it can't be published by accident. To release:

1. `npm version <patch|minor|major>` and push the tag — CI builds the binaries
   and creates the GitHub Release with all platform assets.
2. For **curl/brew** that's enough; brew also needs `Formula/justcode.rb`
   `version`/`sha256` updated and hosted in a tap repo (`homebrew-just-code`).
3. For **npm/pnpm/bun**: set `"private": false`, add an `NPM_TOKEN` secret, and
   enable the `npm-publish` job in `.github/workflows/release.yml` (remove the
   `&& false` guard). Publishing happens after the release so the launcher can
   find the matching binary.
4. Update `repository`/`homepage`/`bugs` URLs if the GitHub repo differs from
   `kingeke/just-code` (the download URLs are derived from `repository.url`).

## Setup

1. Install dependencies with `npm install`.
2. Export the provider settings you want to use.

### OpenAI

```bash
export OPENAI_API_KEY="your-api-key"
export JUSTCODE_PROVIDER="openai"
```

### Ollama

```bash
export JUSTCODE_PROVIDER="ollama"
export OLLAMA_BASE_URL="http://127.0.0.1:11434"
```

### LM Studio

```bash
export JUSTCODE_PROVIDER="lmstudio"
export LMSTUDIO_BASE_URL="http://127.0.0.1:1234/v1"
```

## Commands

```bash
npm run dev -- --provider ollama
npm run dev -- models --provider lmstudio
npm run build
npm test
```

The CLI stores session history under `~/.justcode/sessions` by default.
