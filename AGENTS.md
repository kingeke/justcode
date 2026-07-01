NEVER read entire repositories by default.

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
- Prioritize reusing enums instead of raw strings
- Always use ENUMS instead of strings
- When changing one app confirm if it affects other apps as well

Treat full repository reads as a last resort.

## Type-checking

Type-check with `npm run typecheck` (`tsc --noEmit`). NEVER run `tsc -b` or bare
`tsc` — `tsconfig.json` has no `outDir`, so emitting writes compiled
`.js`/`.d.ts` next to every source file, and vitest then runs the duplicated
`.test.js`, executing the whole suite twice. `noEmit` is set in `tsconfig.json`
to guard against this, but use the script regardless.

Stray emitted `.js`/`.d.ts`/`.js.map` files under `apps/**/src` or
`packages/**/src` are build artifacts, not source — delete them.
