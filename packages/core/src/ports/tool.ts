/**
 * A tool the model can invoke. Tools live behind this port so the agentic loop in
 * `ChatSessionService` stays provider- and implementation-agnostic: the loop only
 * knows how to advertise definitions, describe a pending call, and execute it.
 */

/** A function definition advertised to the model (OpenAI function-calling shape). */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON Schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** The result of executing a tool, fed back to the model as a `tool` message. */
export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  signal?: AbortSignal;
}

/**
 * A before/after view of a file a tool is about to change, so the UI can render
 * a colored diff. `oldText` is empty when the file is being created.
 */
export interface ToolDiff {
  /** Workspace-relative path being changed. */
  path: string;
  oldText: string;
  newText: string;
}

/**
 * A human-readable view of a pending tool call, used both for rendering tool
 * activity and for the approval prompt.
 */
export interface ToolInvocationView {
  title: string;
  preview?: string;
  /** Structured before/after, when the call changes a file. */
  diff?: ToolDiff;
}

export interface Tool {
  readonly definition: ToolDefinition;
  /** Whether the user must approve each invocation before it executes. */
  readonly requiresApproval: boolean;
  /** Summarize a call from its raw JSON arguments (for UI + approval). */
  describe(rawArguments: string): ToolInvocationView;
  /**
   * Optionally compute a before/after diff for the pending call, shown in the
   * UI and approval prompt. Async because it may read the current file from the
   * workspace. Returns undefined when no meaningful diff applies (e.g. the call
   * is invalid or wouldn't change anything).
   */
  previewDiff?(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolDiff | undefined>;
  execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult>;
}
