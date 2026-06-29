/**
 * Canonical names of the tools advertised to the model. Centralised as an enum
 * so the agentic loop's by-name special-casing (e.g. `discover_tools`,
 * `view_history`) and each tool's own `definition.name` can't drift apart.
 */
export enum ToolName {
  DiscoverTools = 'discover_tools',
  ViewHistory = 'view_history',
  ReadFile = 'read_file',
  WriteFile = 'write_file',
  EditFile = 'edit_file',
  ApplyPatch = 'apply_patch',
  Grep = 'grep',
  Glob = 'glob',
  Bash = 'bash',
  TodoWrite = 'todo_write',
  WebFetch = 'web_fetch',
  WebSearch = 'web_search',
  Question = 'question',
}
