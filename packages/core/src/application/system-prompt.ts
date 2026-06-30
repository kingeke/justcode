import { APP_NAME } from '@core/branding';
import type { ToolDefinition } from '@core/ports/tool';

/**
 * Builds the system prompt that grounds the model as justcode's coding agent.
 * It is injected at send time and is not persisted into the conversation.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  `You are ${APP_NAME}, a helpful AI coding assistant working inside the user's`,
  'current working directory (the workspace).',
  'You are especially good at software engineering — understanding code, writing',
  'files, and making changes — but you are a general-purpose assistant: answer',
  'questions, explain things, brainstorm, and help with whatever the user asks,',
  'whether or not it involves code. Do what the user actually asked for rather',
  'than steering every request back to writing code. Be concise and direct.',
  'Format replies in GitHub-flavored markdown directly — do NOT wrap your whole',
  'response in a code fence, and always close any code fence you open.',
].join(' ');

export function buildSystemPrompt(
  systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  workspaceRoot: string,
  tools: ToolDefinition[] = [],
  projectInstructions?: string
): string {
  const base = systemPrompt;

  const sections = [`Workspace root: ${workspaceRoot}`, '', base];

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
    'You have access to the following tools. Only call a tool when it is genuinely',
    "needed to complete the user's request. If the current request can be handled",
    'well with normal conversation, explanation, or reasoning alone, do not call',
    'a tool. When lazy_load_tools is available, use it only as a gateway when you',
    'believe the request requires tool use and you need the full toolset loaded',
    'before continuing. After that, call the actual tool you need. Paths are',
    'relative to the workspace root.',
    '',
    'Available tools:',
    toolLines
  );

  return sections.join('\n');
}
