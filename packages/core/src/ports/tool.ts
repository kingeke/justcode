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
}

/**
 * A human-readable view of a pending tool call, used both for rendering tool
 * activity and for the approval prompt.
 */
export interface ToolInvocationView {
  title: string;
  preview?: string;
}

export interface Tool {
  readonly definition: ToolDefinition;
  /** Whether the user must approve each invocation before it executes. */
  readonly requiresApproval: boolean;
  /** Summarize a call from its raw JSON arguments (for UI + approval). */
  describe(rawArguments: string): ToolInvocationView;
  execute(
    rawArguments: string,
    context: ToolExecutionContext
  ): Promise<ToolResult>;
}
