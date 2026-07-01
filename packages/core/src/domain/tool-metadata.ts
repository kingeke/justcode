import { ToolName } from '@core/domain/tool-name';

/**
 * Presentation metadata for a tool the user can turn on or off. The `name`
 * matches the tool's `definition.name`; `label` is the short human name shown in
 * the manage-tools UI; `category` groups tools under a heading (e.g. "Built in",
 * and, later, one heading per MCP server).
 */
export interface ToolDisplay {
  name: string;
  label: string;
  category: string;
  /** A short, one-line gist of what the tool does, for the manage-tools UI. */
  summary: string;
}

/** The category heading the built-in toolset is grouped under. */
export const BUILT_IN_TOOL_CATEGORY = 'Built in';

/**
 * The tools a user may toggle, in display order. The `lazy_load_tools` gateway
 * is intentionally absent — it's the mechanism that loads this very set, so
 * turning it off would just break lazy loading.
 */
export const TOOL_DISPLAY: ToolDisplay[] = [
  {
    name: ToolName.ReadFile,
    label: 'read',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Read files',
  },
  {
    name: ToolName.WriteFile,
    label: 'write',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Create or overwrite files',
  },
  {
    name: ToolName.EditFile,
    label: 'edit',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Edit files in place',
  },
  {
    name: ToolName.ApplyPatch,
    label: 'apply_patch',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Apply a multi-file patch',
  },
  {
    name: ToolName.Grep,
    label: 'grep',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Search file contents',
  },
  {
    name: ToolName.Glob,
    label: 'glob',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Find files by name',
  },
  {
    name: ToolName.Bash,
    label: 'bash',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Run shell commands',
  },
  {
    name: ToolName.TodoWrite,
    label: 'todo',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Track task todos',
  },
  {
    name: ToolName.WebFetch,
    label: 'web_fetch',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Fetch a URL',
  },
  {
    name: ToolName.WebSearch,
    label: 'web_search',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Search the web',
  },
  {
    name: ToolName.Question,
    label: 'question',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Ask the user a question',
  },
  {
    name: ToolName.ViewHistory,
    label: 'view_history',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Read earlier conversation history',
  },
  {
    name: ToolName.PresentPlan,
    label: 'present_plan',
    category: BUILT_IN_TOOL_CATEGORY,
    summary: 'Present a plan for review',
  },
];

const TOOL_DISPLAY_BY_NAME = new Map(
  TOOL_DISPLAY.map((entry) => [entry.name, entry])
);

/** Whether a tool name is one the user is allowed to toggle. */
export function isManageableTool(name: string): boolean {
  return TOOL_DISPLAY_BY_NAME.has(name);
}

/** A manageable tool plus its current on/off state, ready for a UI to render. */
export interface ManageableToolInfo extends ToolDisplay {
  description: string;
  enabled: boolean;
}
