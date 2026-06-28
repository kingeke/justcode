# Just Code

**A lean, transparent terminal coding assistant where _you_ control every token.**

Most AI coding tools quietly inflate every request with huge hidden prompts you
can't see or change — GitHub Copilot can spend ~27k tokens on a single "hey,"
and other tools routinely send ~7k. JustCode sends roughly **550 tokens per
request**, and most of that is a **system prompt you can read and edit** to be
exactly what you want. No hidden bloat, no wasted spend — your context, your
rules.

It supports OpenAI, Ollama, and LM Studio, loads provider configuration from
environment variables, keeps file-backed conversation history, and includes
automated tests.

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
## Setup

1. Install dependencies with `npm install`.
2. Start the app.

## Commands

```bash
npm run dev
npm run build
npm test
```

## License

[MIT](LICENSE) © Chinonso Eke

The CLI stores session history under `~/.justcode/sessions` by default.
