NEVER read entire repositories by default.

Always:

1. Search first.
2. Identify relevant files.
3. Read only required files.
4. Expand context incrementally.
5. Use absolute imports for project code with `@cli`, `@core`, `@providers`, and `@runtime`.
6. Run `npm run format` after code changes so the repository stays Prettier-formatted.

Treat full repository reads as a last resort.

## Type-checking

Type-check with `npm run typecheck` (`tsc --noEmit`). NEVER run `tsc -b` or bare
`tsc` — `tsconfig.json` has no `outDir`, so emitting writes compiled
`.js`/`.d.ts` next to every source file, and vitest then runs the duplicated
`.test.js`, executing the whole suite twice. `noEmit` is set in `tsconfig.json`
to guard against this, but use the script regardless.

Stray emitted `.js`/`.d.ts`/`.js.map` files under `apps/**/src` or
`packages/**/src` are build artifacts, not source — delete them.
