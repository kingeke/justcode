import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative } from 'node:path';

/**
 * Terminals deliver a file drag-and-drop as a paste of the file's path —
 * usually absolute, with spaces backslash-escaped or the whole path quoted,
 * and some terminals paste `file://` URIs instead. This module recognizes such
 * pastes and rewrites them so the file is actually pulled into the prompt:
 *
 * - a path inside the workspace becomes an `@relative/path` mention, which the
 *   attachment pipeline resolves into file content on send;
 * - a path outside the workspace stays as a plain absolute path the model can
 *   read with its tools.
 *
 * A paste that isn't purely existing file paths returns null and flows through
 * as ordinary text.
 */
export function rewriteDroppedPaths(
  pasted: string,
  workspaceRoot: string,
  exists: (path: string) => boolean = existsSync
): string | null {
  const trimmed = pasted.trim();
  if (trimmed.length === 0) return null;

  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const resolved: string[] = [];
  for (const token of tokens) {
    const path = normalizeDroppedToken(token);
    if (path === null || !exists(path)) return null;
    const rel = relative(workspaceRoot, path);
    const insideWorkspace =
      rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel);
    // Workspace files become @mentions (attached as content on send). The
    // mention grammar breaks on spaces, so space-bearing workspace paths fall
    // back to the plain absolute path like external files.
    resolved.push(insideWorkspace && !rel.includes(' ') ? `@${rel}` : path);
  }

  return `${resolved.join(' ')} `;
}

/**
 * Splits a paste into path tokens, honoring backslash-escaped spaces
 * (`My\ File.txt`) and single/double quotes — the escaping styles terminals
 * use when pasting dropped paths.
 */
function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: string | null = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === '\\' && text[i + 1] === ' ') {
      current += ' ';
      i += 1;
      continue;
    }
    if (char === ' ' || char === '\n' || char === '\t' || char === '\r') {
      if (current.length > 0) tokens.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (quote !== null) return []; // Unbalanced quote: not a dropped path.
  if (current.length > 0) tokens.push(current);
  return tokens;
}

/**
 * Turns one pasted token into an absolute filesystem path, or null when it
 * doesn't look like one. Accepts absolute paths, `~/` home paths, and
 * `file://` URIs (percent-decoded).
 */
function normalizeDroppedToken(token: string): string | null {
  let path = token;
  if (path.startsWith('file://')) {
    try {
      path = decodeURIComponent(path.slice('file://'.length));
    } catch {
      return null;
    }
    // file://localhost/... hosts reduce to the path part.
    const slash = path.indexOf('/');
    if (!path.startsWith('/')) {
      if (slash === -1) return null;
      path = path.slice(slash);
    }
  }
  if (path.startsWith('~/')) {
    path = `${homedir()}${path.slice(1)}`;
  }
  if (!isAbsolute(path)) return null;
  return path;
}
