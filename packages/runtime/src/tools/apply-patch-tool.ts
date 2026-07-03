import { applyPatch, parsePatch } from 'diff';

import type { WorkspaceFilePort } from '@core/ports/workspace-file-port';
import type {
  Tool,
  ToolDefinition,
  ToolDiff,
  ToolExecutionContext,
  ToolInvocationView,
  ToolResult,
} from '@core/ports/tool';

interface ApplyPatchArguments {
  patch: string;
}

/** A single file change resolved from one section of a unified diff. */
interface ResolvedChange {
  path: string;
  oldText: string;
  newText: string;
  /** True when the section creates a file that did not exist before. */
  isCreate: boolean;
}

/**
 * Applies a unified-diff patch (as produced by `git diff` / `diff -u`) to one or
 * more workspace files. The patch is applied atomically: every hunk in every
 * file section is fitted in memory first, and the workspace is only written once
 * all of them apply cleanly — so a malformed section never leaves a half-patched
 * tree. Hunk placement tolerates shifted line numbers (the underlying matcher
 * scans for the surrounding context), but the lines a hunk deletes must be
 * present. Path-safety is enforced by the underlying `WorkspaceFilePort`.
 *
 * File deletion is intentionally unsupported (the workspace port can't remove
 * files); a delete section is reported as an error so the model uses `bash` /
 * `rm` instead.
 */
export class ApplyPatchTool implements Tool {
  public readonly requiresApproval = true;

  public readonly definition: ToolDefinition = {
    name: 'apply_patch',
    description:
      'Apply a unified-diff patch (the format emitted by `git diff` or ' +
      '`diff -u`) to the workspace. A single patch may span multiple files, ' +
      'each introduced by `--- a/<path>` and `+++ b/<path>` headers followed ' +
      'by one or more `@@` hunks. Paths are relative to the workspace root ' +
      '(leading `a/` and `b/` prefixes are stripped). Creating a new file is ' +
      'supported (`--- /dev/null`); deleting a file is not — use the bash ' +
      'tool for that. The patch is applied all-or-nothing: if any hunk fails ' +
      'to match, no file is modified.',
    parameters: {
      type: 'object',
      properties: {
        patch: {
          type: 'string',
          description:
            'The unified-diff text to apply, including the `---`/`+++` file ' +
            'headers and `@@` hunk headers.',
        },
      },
      required: ['patch'],
      additionalProperties: false,
    },
  };

  public constructor(private readonly workspace: WorkspaceFilePort) {}

  public describe(rawArguments: string): ToolInvocationView {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return { title: 'apply_patch (unparseable arguments)' };
    }
    const sections = splitPatchSections(normalizePatchFraming(parsed.patch));
    const paths = sections
      .map((section) => resolveTargetPath(section))
      .filter((path): path is string => path !== undefined);
    const title =
      paths.length === 0
        ? 'apply_patch'
        : paths.length === 1
          ? `apply patch to ${paths[0]}`
          : `apply patch to ${paths.length} files`;
    return {
      title,
      preview: parsed.patch,
      // Only link when the patch targets a single file.
      ...(paths.length === 1 ? { path: paths[0] } : {}),
    };
  }

  public async previewDiff(
    rawArguments: string,
    _context: ToolExecutionContext
  ): Promise<ToolDiff | undefined> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return undefined;
    }
    const plan = await this.planPatch(parsed.patch);
    if ('error' in plan) {
      return undefined;
    }
    // ToolDiff carries a single file; preview the first changed one.
    const first = plan.changes[0];
    if (!first) {
      return undefined;
    }
    return { path: first.path, oldText: first.oldText, newText: first.newText };
  }

  public async execute(
    rawArguments: string,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    const parsed = tryParse(rawArguments);
    if (!parsed) {
      return {
        content: 'Invalid arguments: expected JSON with a "patch" string.',
        isError: true,
      };
    }

    const plan = await this.planPatch(parsed.patch);
    if ('error' in plan) {
      return { content: plan.error, isError: true };
    }

    // Every section applied cleanly in memory; commit them all.
    for (const change of plan.changes) {
      try {
        await this.workspace.writeFile(change.path, change.newText);
      } catch (error: unknown) {
        return {
          content: `Failed to write ${change.path}: ${messageOf(error)}`,
          isError: true,
        };
      }
    }

    const summary = plan.changes
      .map(
        (change) => `${change.isCreate ? 'created' : 'updated'} ${change.path}`
      )
      .join(', ');
    const noun = plan.changes.length === 1 ? 'file' : 'files';
    return {
      content: `Applied patch to ${plan.changes.length} ${noun}: ${summary}.`,
    };
  }

  /**
   * Resolve and apply every section of the patch in memory, reading current
   * file contents from the workspace. Returns the set of pending writes, or the
   * first error encountered — nothing is written here.
   */
  private async planPatch(
    patch: string
  ): Promise<{ changes: ResolvedChange[] } | { error: string }> {
    const sections = splitPatchSections(normalizePatchFraming(patch));
    if (sections.length === 0) {
      return { error: 'No file sections found in the patch.' };
    }

    const changes: ResolvedChange[] = [];
    for (const section of sections) {
      const path = resolveTargetPath(section);
      if (!path) {
        return {
          error:
            'Could not determine the target file for a patch section ' +
            '(missing --- / +++ headers).',
        };
      }
      if (isDeletion(section)) {
        return {
          error:
            `Refusing to delete ${path}: apply_patch does not support file ` +
            'deletion. Use the bash tool (e.g. `rm`) instead.',
        };
      }
      if (!section.body.some((line) => /^[+-]/.test(line))) {
        return {
          error: `Patch section for ${path} contains no hunks to apply.`,
        };
      }

      const isCreate = isCreation(section);
      let oldText = '';
      if (!isCreate) {
        try {
          oldText = await this.workspace.readFile(path);
        } catch (error: unknown) {
          return { error: `Failed to read ${path}: ${messageOf(error)}` };
        }
      }

      const applied = applySection(oldText, section);
      if (applied === undefined) {
        return {
          error:
            `Patch did not apply to ${path}: the context lines around a hunk ` +
            "didn't match the current file. Re-read the file and regenerate " +
            'the patch against its current contents.',
        };
      }
      changes.push({ path, oldText, newText: applied, isCreate });
    }

    return { changes };
  }
}

/** `/dev/null` marks the absent side of a create or delete. */
const DEV_NULL = '/dev/null';

/**
 * One `---`/`+++` file section of a patch, kept as raw lines so hunks can be
 * applied either strictly (numbered `@@ -l,c +l,c @@` headers, via the diff
 * library) or by context matching (the bare `@@` dialect OpenAI-trained models
 * emit, where hunks carry no line numbers at all).
 */
interface PatchSection {
  oldName?: string;
  newName?: string;
  body: string[];
}

/**
 * Strips the framing of OpenAI's patch dialect so the rest parses as a unified
 * diff: `*** Begin Patch` / `*** End Patch` wrapper lines are dropped, and
 * `*** Update File: x` / `*** Add File: x` / `*** Delete File: x` headers are
 * rewritten to `---`/`+++` pairs. Models trained on that dialect routinely mix
 * it into otherwise-standard diffs; bouncing the call just makes them retry
 * with the same format.
 */
function normalizePatchFraming(patch: string): string {
  const out: string[] = [];
  for (const line of patch.split('\n')) {
    const trimmed = line.trim();
    if (/^\*{3} (Begin|End) Patch$/i.test(trimmed)) continue;
    const fileHeader = /^\*{3} (Update|Add|Delete) File: (.+)$/i.exec(trimmed);
    if (fileHeader) {
      const [, action, path] = fileHeader;
      const target = (path as string).trim();
      if (action?.toLowerCase() === 'add') {
        out.push(`--- ${DEV_NULL}`, `+++ b/${target}`);
      } else if (action?.toLowerCase() === 'delete') {
        out.push(`--- a/${target}`, `+++ ${DEV_NULL}`);
      } else {
        out.push(`--- a/${target}`, `+++ b/${target}`);
      }
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

/** Splits a patch into its `---`/`+++` file sections, keeping raw hunk lines. */
function splitPatchSections(patch: string): PatchSection[] {
  const lines = patch.split('\n');
  const sections: PatchSection[] = [];
  let current: PatchSection | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith('--- ')) {
      current = { oldName: line.slice(4).trim(), body: [] };
      const next = lines[i + 1];
      if (next?.startsWith('+++ ')) {
        current.newName = next.slice(4).trim();
        i += 1;
      }
      sections.push(current);
      continue;
    }
    if (!current) continue; // `diff --git` / `index` prologue lines
    current.body.push(line);
  }
  return sections;
}

/** Whether every `@@` header in the section carries line numbers. */
function hasNumberedHunks(section: PatchSection): boolean {
  const headers = section.body.filter((line) => line.startsWith('@@'));
  return (
    headers.length > 0 &&
    headers.every((line) => /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/.test(line))
  );
}

/**
 * Applies one file section to `oldText`. Numbered hunks go through the diff
 * library (which already tolerates shifted line numbers); bare-`@@` hunks are
 * located purely by their context lines. Returns undefined when a hunk's
 * context can't be found.
 */
function applySection(
  oldText: string,
  section: PatchSection
): string | undefined {
  if (hasNumberedHunks(section)) {
    const sectionText = [
      `--- ${section.oldName ?? DEV_NULL}`,
      `+++ ${section.newName ?? DEV_NULL}`,
      ...section.body,
    ].join('\n');
    const [parsed] = parsePatch(sectionText);
    if (!parsed) return undefined;
    const applied = applyPatch(oldText, parsed);
    return applied === false ? undefined : applied;
  }
  return applyContextHunks(oldText, section.body);
}

/**
 * Applies bare-`@@` hunks by matching their context/deleted lines against the
 * file, scanning forward from a cursor so hunks apply in order. An `@@ <text>`
 * marker (e.g. a class or function name) advances the cursor past the matching
 * line when found, mirroring how OpenAI's dialect scopes a hunk.
 */
function applyContextHunks(
  oldText: string,
  body: string[]
): string | undefined {
  interface Chunk {
    marker?: string;
    lines: string[];
  }
  const chunks: Chunk[] = [];
  let current: Chunk | undefined;
  for (const raw of body) {
    if (raw.startsWith('@@')) {
      const marker = raw.slice(2).trim();
      current = { ...(marker ? { marker } : {}), lines: [] };
      chunks.push(current);
      continue;
    }
    if (raw.startsWith('\\')) continue; // "\ No newline at end of file"
    if (!current) {
      current = { lines: [] };
      chunks.push(current);
    }
    current.lines.push(raw);
  }

  const fileLines = oldText.split('\n');
  let cursor = 0;
  for (const chunk of chunks) {
    // Trailing blank lines are artifacts of the patch string, not context.
    const lines = [...chunk.lines];
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    if (chunk.marker) {
      const at = fileLines.findIndex(
        (line, index) => index >= cursor && line.trim() === chunk.marker
      );
      if (at !== -1) cursor = at + 1;
    }
    const pattern: string[] = [];
    const replacement: string[] = [];
    for (const line of lines) {
      if (line.startsWith('+')) {
        replacement.push(line.slice(1));
      } else if (line.startsWith('-')) {
        pattern.push(line.slice(1));
      } else {
        // Context: usually ' '-prefixed; tolerate a missing prefix (and treat
        // a fully blank line as a blank context line).
        const content = line.startsWith(' ') ? line.slice(1) : line;
        pattern.push(content);
        replacement.push(content);
      }
    }
    if (pattern.length === 0) {
      if (replacement.length === 0) continue; // marker-only chunk
      fileLines.splice(cursor, 0, ...replacement);
      cursor += replacement.length;
      continue;
    }
    const at = findSequence(fileLines, pattern, cursor);
    if (at === -1) return undefined;
    fileLines.splice(at, pattern.length, ...replacement);
    cursor = at + replacement.length;
  }
  return fileLines.join('\n');
}

/**
 * First occurrence of `needle` in `hay` at or after `from`, retrying from the
 * top and then with trailing-whitespace-insensitive comparison, so a slightly
 * out-of-order or whitespace-drifted hunk still lands.
 */
function findSequence(hay: string[], needle: string[], from: number): number {
  const matchers: Array<(a: string, b: string) => boolean> = [
    (a, b) => a === b,
    (a, b) => a.trimEnd() === b.trimEnd(),
  ];
  for (const eq of matchers) {
    for (const start of [from, 0]) {
      outer: for (let i = start; i <= hay.length - needle.length; i++) {
        for (let j = 0; j < needle.length; j++) {
          if (!eq(hay[i + j] as string, needle[j] as string)) continue outer;
        }
        return i;
      }
      if (from === 0) break; // retry-from-top is the same search
    }
  }
  return -1;
}

function isCreation(section: PatchSection): boolean {
  return isDevNull(section.oldName);
}

function isDeletion(section: PatchSection): boolean {
  return isDevNull(section.newName);
}

function isDevNull(name: string | undefined): boolean {
  return name === undefined || stripTimestamp(name) === DEV_NULL;
}

/**
 * The path the section targets: the new file for a create/modify, falling back
 * to the old file. Git-style `a/` and `b/` prefixes are stripped.
 */
function resolveTargetPath(section: PatchSection): string | undefined {
  const target = isDeletion(section)
    ? section.oldName
    : (section.newName ?? section.oldName);
  if (target === undefined) {
    return undefined;
  }
  const cleaned = stripPrefix(stripTimestamp(target));
  return cleaned === DEV_NULL || cleaned === '' ? undefined : cleaned;
}

/**
 * Unified-diff headers may carry a trailing tab-separated timestamp
 * (`--- a/file.ts\t2024-01-01 ...`). parsePatch usually splits it off, but
 * guard against it leaking into the path.
 */
function stripTimestamp(name: string): string {
  const tab = name.indexOf('\t');
  return tab === -1 ? name : name.slice(0, tab);
}

function stripPrefix(name: string): string {
  if (name.startsWith('a/') || name.startsWith('b/')) {
    return name.slice(2);
  }
  return name;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tryParse(rawArguments: string): ApplyPatchArguments | undefined {
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    if (typeof parsed.patch !== 'string' || parsed.patch.length === 0) {
      return undefined;
    }
    return { patch: parsed.patch };
  } catch {
    return undefined;
  }
}
