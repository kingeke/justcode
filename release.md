## Install

JustCode ships as a single **self-contained binary** that embeds its runtime
(the Bun runtime plus the native terminal-UI library). End users need **no Bun,
no Node, and no `node_modules`** — just the binary.

### Published install (once released)

These channels work after a release is published (see [Publishing](#publishing)):

```bash
# curl — downloads the prebuilt binary for your OS/arch
curl -fsSL https://raw.githubusercontent.com/kingeke/justcode/main/scripts/install.sh | sh

# npm / bun / pnpm — installs a tiny launcher that fetches + runs the binary
npm install -g justcode-cli
bun add -g justcode-cli
pnpm add -g justcode-cli

# Homebrew (via tap)
brew tap kingeke/justcode
brew trust kingeke/justcode   # required: third-party taps are untrusted by default
brew install justcode
```

> **Building requires [Bun](https://bun.sh)** (`curl -fsSL https://bun.sh/install | bash`).
> Bun is only needed to _build_ — the produced binary runs on its own. The
> terminal UI's native library (`@opentui/core`) is platform-specific, so
> binaries can't be cross-compiled; each platform is built on its own runner
> (see `.github/workflows/release.yml`).

## How distribution works

- `npm run build:binary` compiles `apps/cli/src/index.tsx` with `bun build
--compile` into `dist-bin/justcode-<os>-<arch>`. The Bun runtime and the
  `@opentui` native library are embedded.
- On a tag push (`v*`), `.github/workflows/release.yml` builds one binary per
  platform on a native CI runner and uploads them as GitHub Release assets.
- `scripts/install.sh` (curl) and the Homebrew formula in the `homebrew-justcode`
  tap (brew) download the matching release asset directly. The tap formula is
  regenerated and pushed automatically by the `homebrew` job in `release.yml`.
- The npm package (`bin/justcode.mjs`) is a small Node launcher: on install it
  downloads the binary for the current platform (`scripts/postinstall.mjs`),
  falling back to a lazy download on first run if install scripts were blocked.

## Versioning

The **root `package.json` version is the single source of truth**. The CLI reads
it (`@core/version` → `APP_VERSION`, embedded into the binary at build) and so
does the extension's About tab. `apps/vscode/package.json` carries a version only
because the VS Code Marketplace reads it there — it is kept in lockstep
automatically by `scripts/sync-extension-version.mjs`, which the extension build
(`esbuild.mjs`) runs on every package/publish. Don't hand-edit either version.

## Releasing (one click)

Run the **Version** workflow from the Actions tab (`workflow_dispatch`) and pick
the bump — `patch` / `minor` / `major`. It:

1. Computes the new version from the current one (`scripts/bump-version.mjs`) and
   writes it to both manifests.
2. Commits `chore(release): vX.Y.Z`, then creates and pushes the **`vX.Y.Z` tag**
   (the tag is your rollback point — to roll back, re-run **Release** on an older
   tag, or `git checkout vX.Y.Z`).
3. Dispatches the **Release** workflow on that tag. (It dispatches explicitly
   rather than relying on the tag push, because a tag pushed with `GITHUB_TOKEN`
   does not trigger `on: push` workflows — `workflow_dispatch` does, so no PAT is
   needed.)

The Release workflow then builds a self-contained binary per platform, creates
the GitHub Release with all assets, and — where secrets are set — publishes the
npm launcher and the VS Code extension.

> **Branch protection:** the Version job pushes the bump commit straight to the
> default branch. If that branch is protected against direct pushes, allow the
> `github-actions` bot (or run the workflow from an unprotected release branch).

Per-channel notes:

- **curl/brew:** the release assets are enough. The `homebrew` job in
  `release.yml` regenerates the formula (version + per-arch `sha256`) and pushes
  it to the `homebrew-justcode` tap automatically, using the `RELEASE_TOKEN`
  secret.
- **npm/pnpm/bun:** set `"private": false`, add an `NPM_TOKEN` secret, and enable
  the `npm-publish` job in `.github/workflows/release.yml` (remove the `&& false`
  guard).
- **VS Code extension:** the `vscode-publish` job always builds the `.vsix` and
  attaches it to the Release (for sideloading), and publishes to a marketplace
  only when the matching token secret is set:
  - `VSCE_PAT` → VS Code Marketplace. Create a publisher named `kingeke` and an
    Azure DevOps PAT (Marketplace → Manage publishers). Once installed, VS Code
    **auto-updates** the extension — no in-app update check needed.
  - `OVSX_PAT` → Open VSX (Cursor / VSCodium / Windsurf). Optional.

  A proper Marketplace listing also wants a 128×128 PNG `icon` field in
  `apps/vscode/package.json` (only an SVG activity-bar icon exists today).

- If the GitHub repo differs from `kingeke/justcode`, update
  `repository`/`homepage`/`bugs` (download URLs derive from `repository.url`).

## Update notifications

The CLI is **notify-only** — it never updates itself silently or forces an
upgrade. On startup it reads the latest release tag from the public GitHub
Releases API and, when a newer version exists, shows a one-line banner with the
upgrade command for the channel it was installed through (curl / npm / brew,
detected from the binary's path). See
`packages/core/src/application/update-check.ts`.

- The check is fully non-blocking: the banner on a given run comes from the
  _previous_ run's cached result (`~/.cache/justcode/update-check.json`), while
  the current run refreshes that cache in the background at most once a day.
- It sends nothing about the user — only an anonymous read of the releases API.
- `JUSTCODE_NO_UPDATE_CHECK=1` disables it; it is also skipped in local dev
  (`JUSTCODE_DEBUG`) so an unreleased build doesn't nag.

A **forced** update (refuse to run below a minimum version) is intentionally not
implemented: there's no JustCode backend to enforce it, a client-side gate is
bypassable, and a coding tool shouldn't brick itself offline. If ever needed,
the same version-check plumbing supports a remote `minVersion` manifest gate.
