# Contributing to JustCode

JustCode is **free and open source (MIT)**, and contributions are very welcome —
bug reports, documentation, fixes, and features alike. This guide covers how to
get set up, the conventions we follow, and how to get a change merged.

Found a bug or have an idea? [Open an issue](https://github.com/kingeke/justcode/issues).
For anything large, please open an issue to discuss the approach **before** you
start building, so we can agree on direction and save you rework.

## Getting started

1. **Fork** the repository and clone your fork.
2. **Branch off `main`** with a descriptive name (e.g. `fix/mcp-reset` or
   `feat/custom-modes`).
3. **Install dependencies:**

   ```bash
   npm install
   ```

Building the self-contained binary requires [Bun](https://bun.sh)
(`curl -fsSL https://bun.sh/install | bash`). Bun is only needed to build — the
produced binary runs on its own.

```bash
npm run install:local   # compile the host binary and symlink it as `justcode`
npm run update:local    # recompile after changes (the symlink picks it up)
npm run uninstall:local # remove the symlink
```

Handy scripts while developing:

```bash
npm run dev        # run the CLI from source
npm test           # run the test suite
npm run typecheck  # type-check the workspace
npm run format     # format with Prettier
npm run web        # run the landing page (apps/web) locally
```

## Repository layout

- `apps/cli` — the terminal UI.
- `apps/vscode` — the VS Code extension.
- `apps/web` — the landing page (React + Vite), deployed to GitHub Pages.
- `packages/core` — domain + application logic (provider-agnostic).
- `packages/runtime` — tools, MCP, auth, and service wiring.
- `packages/providers` — provider integrations.

When you change one app, check whether the change affects the others — the apps
share the same lean engine under `packages/`.

## Coding conventions

- **Match the surrounding style** — keep new code consistent with the file it
  lives in.
- **Absolute imports only.** Use the project aliases (`@cli`, `@core`,
  `@providers`, `@runtime`) rather than relative paths for project code.
- **Prefer enums over raw strings** for fixed sets of values, and reuse existing
  enums where one already fits.
- **Every change ships with a test.** New files and behavior should come with a
  test that confirms they work.
- **Keep the existing color palette** as the default for new UI work unless the
  change explicitly calls for a new visual language.
- **Keep requests lean.** JustCode's whole premise is minimal token usage — avoid
  adding hidden prompt bloat.

## Before opening a pull request

Make sure the checks pass:

```bash
npm run typecheck
npm test
npm run format
```

> **Note:** type-check with `npm run typecheck` (`tsc --noEmit`). Do not run
> `tsc -b` or bare `tsc` — the root `tsconfig.json` has no `outDir`, so emitting
> would write compiled `.js`/`.d.ts` files next to every source file. Any stray
> `.js`/`.d.ts`/`.js.map` under `apps/**/src` or `packages/**/src` are build
> artifacts, not source — delete them before committing.

## Opening the pull request

1. Push your branch to your fork.
2. Open a PR against `main` that clearly describes **what** changed and **why**.
3. Reference any related issue.
4. Keep PRs focused — smaller, single-purpose changes are easier to review and
   merge.

## License

By contributing, you agree that your contributions will be licensed under the
project's [MIT License](LICENSE).
