/**
 * Best-effort extraction of the file paths a shell command deletes, used to
 * surface bash-driven deletions in the changes panel (there is no delete tool;
 * `apply_patch` refuses deletes, so they all go through `bash`).
 *
 * This is intentionally conservative: it understands plain `rm`/`unlink`
 * invocations split across `&&`, `||`, `;`, `|`, and newlines, and skips any
 * argument it can't resolve to a literal path (globs, variables, brace/tilde
 * expansion). Those are left for the on-disk existence check to ignore rather
 * than guessed at, so we never offer to "restore" a path we didn't truly know.
 */
export function parseRemovedPaths(command: string): string[] {
  const paths: string[] = [];
  // Track a leading `cd` within the command so `cd sub && rm file` resolves to
  // `sub/file`. Reset to the command's root (workspace) on an absolute or
  // unexpandable `cd` target we can't follow.
  let cwd = '';
  for (const segment of command.split(/&&|\|\||[;|\n]/)) {
    const tokens = tokenize(segment.trim());
    if (tokens.length === 0) continue;
    const name = stripQuotes(tokens[0]!);

    if (name === 'cd') {
      cwd = nextCwd(cwd, tokens[1]);
      continue;
    }
    if (!isRemoveCommand(name)) continue;

    for (const token of tokens.slice(1)) {
      // Flags (`-rf`, `--force`, the `--` separator) aren't paths.
      if (token.startsWith('-')) continue;
      // Anything needing shell expansion can't be resolved to one literal path.
      if (HAS_SHELL_META.test(token)) continue;
      const path = stripQuotes(token);
      if (path) paths.push(joinPath(cwd, path));
    }
  }
  return paths;
}

/** Applies a `cd <target>` to the running relative directory. */
function nextCwd(cwd: string, rawTarget: string | undefined): string {
  if (!rawTarget) return '';
  if (HAS_SHELL_META.test(rawTarget)) return cwd;
  const target = stripQuotes(rawTarget);
  // Absolute targets escape the workspace-relative tracking we can resolve.
  if (target.startsWith('/')) return cwd;
  return joinPath(cwd, target);
}

/** Minimal POSIX-style path join that collapses `.` and `..` segments. */
function joinPath(base: string, rel: string): string {
  const segments = rel.startsWith('/') ? [] : base.split('/').filter(Boolean);
  for (const part of rel.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segments.pop();
    else segments.push(part);
  }
  return segments.join('/');
}

const HAS_SHELL_META = /[*?$~{}[\]!`()<>]/;

function isRemoveCommand(token: string): boolean {
  const name = stripQuotes(token);
  return (
    name === 'rm' ||
    name === 'unlink' ||
    name.endsWith('/rm') ||
    name.endsWith('/unlink')
  );
}

/** Splits on whitespace while keeping single/double-quoted runs intact. */
function tokenize(segment: string): string[] {
  return segment.match(/(?:[^\s'"]+|'[^']*'|"[^"]*")+/g) ?? [];
}

/** Removes a single layer of surrounding matching quotes from each quoted run. */
function stripQuotes(token: string): string {
  return token.replace(/'([^']*)'|"([^"]*)"/g, '$1$2');
}
