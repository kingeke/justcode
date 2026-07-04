# Writing GitHub release notes

How to produce the release notes for a JustCode release. The goal is a short,
readable summary a user can scan in under a minute — what version this is and
what changed for *them* since the last one. Not a changelog of commits.

## Gathering the changes

1. The new version is whatever the bump produced (`package.json` after
   `scripts/bump-version.mjs`, or the freshly pushed `v*` tag).
2. The previous version is the latest existing tag: `git describe --tags --abbrev=0`
   (or `git tag --sort=-v:refname | head -2` when the new tag already exists).
3. List what happened between them: `git log <last-tag>..<new-tag> --oneline`.
   Read the commits for *what changed*, then describe it in product terms —
   never copy commit subjects verbatim.

## Output format

```markdown
## vX.Y.Z

One or two sentences on the theme of the release, if it has one.

### New
- Conversation compaction: summarize a long chat and keep going (`/compact`, auto at 80%).
- Session switcher in the chat header — search, rename, delete, and jump between sessions.

### Improved
- Streaming no longer flickers on long responses in the terminal.
- Session lists group by recency (Today / Yesterday / Last 7 days / Older).

### Fixed
- Pasted-image markers no longer break the prompt layout.
```

## Rules

- **Lead with the version** (`## vX.Y.Z`) — it's the headline.
- **Surface level only.** Describe the visible behavior, not the
  implementation: "compaction shows live progress", not "CompactStatus
  messages carry a tokens field". No file names, no internal type names.
- **One line per change.** If a change needs three sentences, it gets one
  sentence here and the details stay in the commit.
- **User-facing changes only.** Skip refactors, test changes, CI tweaks, and
  dependency bumps unless a user would notice them.
- **Group under `New` / `Improved` / `Fixed`** — omit any empty section. When
  a change is surface-specific, say where it applies: "(CLI)", "(VS Code)".
- **Aim for 5–12 bullets total.** A patch release might be two lines; that's
  fine. Never pad.

## Publishing

The tag-push release workflow (`.github/workflows/release.yml`) creates the
GitHub release with auto-generated commit notes. Replace or prepend them with
the written summary:

```bash
gh release edit vX.Y.Z --notes-file notes.md
```

or paste the summary above the auto-generated "What's Changed" list when
editing the release on GitHub.
