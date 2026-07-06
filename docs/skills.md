# Skills

Skills are installable packs of slash commands for JustCode. Installing a
skill from a GitHub repository automatically adds its commands to the chat —
both in the CLI (`justcode`) and in the VS Code extension.

Skills don't have to be built for JustCode: repositories that follow the
shared ecosystem conventions — Claude plugins (`.claude-plugin/plugin.json`),
`SKILL.md` skills, `commands/*.md` command files — install and work as-is
(see [Installing skills built for other tools](#installing-skills-built-for-other-tools)).

```bash
justcode skill add test/skill --global
```

```
/example src/example.ts
```

## Managing skills

```bash
justcode skill add <github-url|owner/repo>      # install (asks: local or global?)
justcode skill add <owner/repo> --local         # install into this project only
justcode skill add <owner/repo> --global        # install for all projects
justcode skill remove <skill-name>              # uninstall (local first, then global)
justcode skill update <skill-name>              # git pull the latest version
justcode skill list                             # installed skills, labelled (local)/(global)
justcode skill info <skill-name>                # manifest, source, commands
```

`skill add` accepts any of:

- `owner/repo` — GitHub shorthand (`test/skill`)
- a full URL — `https://github.com/test/skill`
- an SSH remote — `git@github.com:test/skill.git` (private repos use
  your existing git credentials)
- a local path or `file://` URL — handy while developing a skill

## Local vs global installs

Every skill installs into one of two scopes:

- **local** — `<project>/.justcode/skills/<skill-name>/`, available only
  inside that project
- **global** — `~/.cache/justcode/skills/<skill-name>/`, available in every
  project

When you run `skill add` in a terminal without a scope flag, it asks:

```
$ justcode skill add test/skill
Install locally (this project's .justcode/skills) or globally (all projects)?
[l]ocal / [g]lobal:
```

Pass `--local` or `--global` to skip the prompt (non-interactive runs, e.g.
CI or piped input, default to global). `skill remove`, `skill update`, and
`skill info` operate on the local install when one exists, falling back to
global — the same `--local` / `--global` flags pin a scope explicitly.
`skill list` shows both, labelled `(local)` / `(global)`.

When the same skill is installed in both scopes, the **local one wins** — its
commands shadow the global copy entirely, so a project can pin its own version
of a shared skill.

Local installs are cloned git repositories, so add `.justcode/skills/` to your
project's `.gitignore`; teammates install with `justcode skill add --local`.

In every scope the cloned repository is never modified — `skill update` is a
plain `git pull` — and install metadata (source URL, timestamps) lives in a
sibling `skills.json`.

Commands from both scopes are discovered automatically when JustCode starts
(the CLI uses its working directory as the project; the VS Code extension uses
the workspace folder, re-discovering on each panel load), so a skill installed
from the terminal shows up after reloading the chat view.

In VS Code you can also manage skills without the terminal: **Settings →
Skills** lists the installed skills of both scopes and lets you add (by
`owner/repo` or URL, choosing local or global), update, and remove them — the
chat panel's `/` completions refresh immediately.

## Quick start: create your own skill

A skill is just a git repository with a manifest and some markdown files.
Build a working one in five steps:

```bash
# 1. Scaffold the repo
mkdir -p test-skill/commands && cd test-skill

# 2. Write the manifest
cat > justcode.json <<'EOF'
{
  "name": "test-skill",
  "version": "1.0.0",
  "description": "Example slash commands"
}
EOF

# 3. Write a command (the file name becomes the command name: /explain)
cat > commands/explain.md <<'EOF'
---
description: Explain a file in plain language
argument-hint: <file>
tools:
  - read_file
---

You are a patient senior engineer.

The user ran /explain with: $ARGUMENTS

Read the file they named and explain what it does in plain language,
covering its purpose, inputs/outputs, and anything surprising.
EOF

# 4. Commit it — installs clone via git
git init && git add . && git commit -m "test-skill v1.0.0"

# 5. Install it into the current project (or --global for everywhere)
justcode skill add "$(pwd)" --local
```

Start `justcode` (or reload the VS Code chat panel) and type `/` — `/explain`
is in the palette. When you're happy with it, push the repo to GitHub and
anyone can install it with `justcode skill add <owner>/<repo>`.

## Installing skills built for other tools

A repository doesn't need a `justcode.json` to install. When one is absent,
JustCode adapts the conventions shared across agent CLIs:

- **Metadata** comes from `.claude-plugin/plugin.json` (name, version,
  description, author) when present, else the repository name.
- **Commands** are discovered from `commands/*.md`, `.claude/commands/`,
  `.opencode/commands/`, and `.agents/commands/` (including one level of
  grouping subdirectories). Repos that mirror the same commands for several
  CLIs register each command once.
- **Skills** are discovered from a root `SKILL.md` and from
  `skills/<name>/SKILL.md` (plus the `.claude`/`.opencode`/`.agents`
  variants); each becomes one slash command named after its skill.
- **Claude frontmatter is understood**: `allowed-tools` maps onto JustCode's
  tools (`Read` → `read_file`, `Bash(git:*)` → `bash`, …); unknown tool names
  are ignored safely, and `$ARGUMENTS` works the same way.

So `justcode skill add <owner>/<repo>` works on a Claude plugin or skill repo
exactly like on a native JustCode skill — install, `/` commands, update, and
remove all behave the same. An install is only rejected when none of the
above yields a single usable command.

A `justcode.json` still takes precedence when present, and is the way to
control exactly what a skill exposes to JustCode.

## Repository structure

For a native JustCode skill, only `justcode.json` is required. A fuller skill
might look like:

```
test-skill/
├── justcode.json          # the manifest (required)
├── README.md
├── commands/
│   ├── explain.md
│   ├── changelog.md
│   └── lint-review.md
├── prompts/               # anything else your commands reference
├── templates/
└── assets/
```

## The manifest (`justcode.json`)

```json
{
  "name": "test-skill",
  "version": "1.0.0",
  "description": "Example slash commands",
  "author": "test",
  "commands": [
    "commands/explain.md",
    "commands/changelog.md",
    "commands/lint-review.md"
  ]
}
```

| Field         | Required | Notes                                                                   |
| ------------- | -------- | ----------------------------------------------------------------------- |
| `name`        | yes      | Lowercase letters, digits, hyphens. Doubles as the install directory.   |
| `version`     | yes      | Semantic version of the pack.                                           |
| `description` | no       | Shown in `skill list` / `skill info`.                                   |
| `author`      | no       | Shown in `skill info`.                                                  |
| `commands`    | no       | Repo-relative markdown paths. Omit it to auto-discover `commands/*.md`. |

Unknown keys are preserved, not rejected — future capabilities (dependencies,
required MCP servers, env vars, setup scripts, signing) will ride the same
file without breaking older installs.

## Writing a command

Each command is a markdown file: optional YAML frontmatter for metadata, and a
body that becomes the **system prompt** the command runs with.

```md
---
name: changelog
description: Draft a changelog entry from recent commits
argument-hint: [version]
tools:
  - bash
  - read_file
model: auto
---

# Changelog

You are a meticulous release manager.

The user ran `/changelog` with: $ARGUMENTS

Inspect the recent git history and draft a changelog entry...
```

Frontmatter fields (all optional):

- `name` — the command's slash name. Defaults to the file's basename
  (`changelog.md` → `/changelog`). Lowercase letters, digits, dots, hyphens,
  underscores; `:` is reserved for namespacing.
- `description` — shown in the `/` completion palette.
- `argument-hint` — short usage hint shown next to the name in pickers.
- `tools` — tool names to make callable from the command's first model
  request (with lazy tool loading, other tools normally load on demand).
  Built-in names include `read_file`, `write_file`, `edit_file`, `grep`,
  `glob`, `bash`, `webfetch`, `websearch`. Unknown names are ignored.
- `model` — a model id to run the command with. `auto` (or omitting it) uses
  the session's active model; a named model is used only when the active
  provider lists it, otherwise the active model quietly stays.

The frontmatter parser supports simple `key: value` scalars (optionally
quoted), `key:` followed by `- item` lines, and inline `[a, b]` lists.

### Arguments

When the user runs `/explain src/app.ts`:

- If the body contains `$ARGUMENTS`, every occurrence is replaced with
  `src/app.ts` (or `(no arguments given)` when there are none).
- The typed invocation itself is sent as the user message, so the model also
  sees exactly what was run. `@file` mentions in the arguments are resolved
  into attachments as usual.

The command applies to **that turn only** — the active chat mode and its
system prompt come back on the next message.

## Name collisions

Every command is always reachable under its namespaced form:

```
/test-skill:explain
```

The bare `/explain` alias works while exactly one installed skill defines
`explain`. When two skills claim the same name, the bare alias is dropped,
both keep their namespaced form, and `justcode skill list` prints a warning.
Built-in commands (like `/models` in the CLI) always win over a skill command
of the same name — the skill command stays reachable via its namespaced form.

## Best practices

- **One job per command.** Prefer `/explain`, `/changelog`, `/lint-review`
  over one `/helper` command with sub-modes.
- **Write the body as a system prompt.** State the role, the steps, and the
  expected output format. It replaces the mode prompt for the turn, so make it
  self-contained.
- **Use `$ARGUMENTS` explicitly** so the model knows what the user passed and
  what to do when nothing was passed.
- **Declare the tools you need** in `tools:` so the first model request can
  already call them.
- **Pick collision-resistant names.** A command named `review` risks losing
  its bare `/review` to another skill; prefer distinctive names for commands
  you expect users to type bare.
- **Keep supporting files in the repo** (`prompts/`, `templates/`) and refer
  to them from the body by repo-relative path — the model can read them with
  `read_file` from the install directory when you spell the path out.
- **Version meaningfully.** Bump `version` on every change; users get it with
  `justcode skill update <name>`.

## Publishing

A skill is just a public (or shared) git repository — push it and tell users
to run `justcode skill add <owner>/<repo>`. There is no central registry yet;
the manifest format is designed so a registry, dependency resolution, and
signing can be added later without changing published skills.
