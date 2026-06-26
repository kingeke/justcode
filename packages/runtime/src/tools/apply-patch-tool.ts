import { applyPatch, parsePatch, type StructuredPatch } from 'diff';

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
    const sections = parsePatch(parsed.patch);
    const paths = sections
      .map((section) => resolveTargetPath(section))
      .filter((path): path is string => path !== undefined);
    const title =
      paths.length === 0
        ? 'apply_patch'
        : paths.length === 1
          ? `apply patch to ${paths[0]}`
          : `apply patch to ${paths.length} files`;
    return { title, preview: parsed.patch };
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
    const sections = parsePatch(patch);
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
      if (section.hunks.length === 0) {
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

      const applied = applyPatch(oldText, section);
      if (applied === false) {
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

function isCreation(section: StructuredPatch): boolean {
  return section.isCreate === true || isDevNull(section.oldFileName);
}

function isDeletion(section: StructuredPatch): boolean {
  return section.isDelete === true || isDevNull(section.newFileName);
}

function isDevNull(name: string | undefined): boolean {
  return name === undefined || stripTimestamp(name) === DEV_NULL;
}

/**
 * The path the section targets: the new file for a create/modify, falling back
 * to the old file. Git-style `a/` and `b/` prefixes are stripped.
 */
function resolveTargetPath(section: StructuredPatch): string | undefined {
  const target = isDeletion(section)
    ? section.oldFileName
    : (section.newFileName ?? section.oldFileName);
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
