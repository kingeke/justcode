import type { ToolDefinition } from '@core/ports/tool';

/**
 * Builds the system prompt that grounds the model as justcode's coding agent.
 * It is injected at send time and is not persisted into the conversation.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  "You are JustCode, an AI coding assistant operating inside a user's terminal,",
  'in their current working directory (the workspace).',
  'Help with software engineering tasks: understanding code, writing files, and',
  'making changes. Be concise and direct.',
].join(' ');

export function buildSystemPrompt(
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  tools: ToolDefinition[] = [],
  projectInstructions?: string
): string {
  const base = systemPrompt;

  const sections = [base];

  if (projectInstructions) {
    sections.push(
      '',
      'Project instructions from AGENTS.md:',
      projectInstructions
    );
  }

  if (tools.length === 0) {
    return sections.join('\n');
  }

  const toolLines = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');

  sections.push(
    '',
    'You have access to the following tools. Use them when they help accomplish',
    'the task - for example, prefer the write_file tool over printing file',
    'contents when the user asks you to create or modify a file. Paths are relative',
    'to the workspace root. Only call a tool when it is genuinely needed.',
    '',
    'Available tools:',
    toolLines
  );

  return sections.join('\n');
}
