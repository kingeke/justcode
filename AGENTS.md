Always:

- Search first.
- Identify relevant files.
- Read only required files.
- Expand context incrementally.
- Use absolute imports for project code with `@cli`, `@core`, `@providers`, and `@runtime`.
- Run `npm run format` after code changes so the repository stays Prettier-formatted.
- Run `npm run typecheck` after code changes so you can confirm any typescript errors.
- Keep the existing app color palette as the default for new UI work unless a change explicitly calls for a new visual language.
- All imports must use absolute path and not relative path
- All new changes and new files must have a test case along with it to confirm it works properly
- Enums are mandatory, never raw strings — see "Enums" below.
- When changing one app confirm if it affects other apps as well
- Do not assume limits, always ask the user for limit clarifications and do not assume a limit.
- Use the exported APP_NAME or APP_NAME_LOWERED for string that mention the name of the app where applicable.
- Release notes are created using the .github/RELEASE_NOTES.md file, generated release notes must not be saved in the repo, can be stored to confirm, but must be deleted afterwards.

Treat full repository reads as a last resort.

## Enums

This is a hard rule, not a preference. Do not skip it because the change is
small or "just one string".

- Any value from a fixed set — statuses, kinds, roles, phases, message types,
  tool names, provider ids, command names, action types — MUST be an enum
  member. Never a raw string literal, never a string union type.
- Before adding an enum, search for an existing one and reuse it. Examples:
  `ToolName`, `MessageRole`, `ProviderId`, `AuthMethod`, `ReasoningEffort`
  (`packages/core/src`), `CommandName`, `KeyName` (`apps/cli/src`),
  `HostMessageType`, `WebviewMessageType`, `ChatStatus` (`apps/vscode/src`).
- Only create a new enum when no existing one fits. Put it next to the domain
  it describes (`packages/core/src/domain`, `apps/*/src/shared`) and export it.
- Comparisons, switches, object keys, and default values must reference the enum
  member (`ToolName.Bash`), never the literal (`"bash"`). The only place the
  literal may appear is the enum declaration itself and at true I/O boundaries
  (JSON parsing, env vars, network payloads), where you must map the incoming
  string onto the enum immediately.
- Opportunistic cleanup is expected: when you touch a file that still compares
  or switches on raw strings from a fixed set, convert those call sites to the
  matching enum as part of your change. Keep the conversion scoped to the files
  you are already editing — do not open a repo-wide rewrite unless asked.
- Before finishing, grep your diff for quoted string literals in conditionals
  (`=== "`, `case "`, `includes("`) and replace any that represent a fixed-set
  value. Then run `npm run typecheck`.

## Type-checking

Type-check with `npm run typecheck` (`tsc --noEmit`). NEVER run `tsc -b` or bare
`tsc` — `tsconfig.json` has no `outDir`, so emitting writes compiled
`.js`/`.d.ts` next to every source file, and vitest then runs the duplicated
`.test.js`, executing the whole suite twice. `noEmit` is set in `tsconfig.json`
to guard against this, but use the script regardless.

Stray emitted `.js`/`.d.ts`/`.js.map` files under `apps/**/src` or
`packages/**/src` are build artifacts, not source — delete them.
