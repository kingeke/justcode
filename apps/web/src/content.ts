// All landing-page copy in one place. The tool/command/mode/provider lists are
// kept in sync by hand with the CLI (packages/runtime/src/tools,
// apps/cli/src/ui/commands.ts, packages/core/src/domain/chat-mode.ts).

import { APP_REPO_URL } from '@core/branding';

export interface Item {
  name: string;
  description: string;
}

/** The headline value propositions. */
export const highlights: Item[] = [
  {
    name: '~550 tokens per request',
    description:
      'Most tools quietly inflate every request — Copilot can spend ~27k tokens on a single "hey," others routinely send ~7k. JustCode sends roughly 550, so you don\'t pay for hidden bloat.',
  },
  {
    name: 'A system prompt you can read and edit',
    description:
      'Most of what JustCode sends is a system prompt you can open, read, and change to be exactly what you want. No black box.',
  },
  {
    name: 'Bring your own provider & key',
    description:
      'Connect OpenAI, Anthropic, OpenRouter, Qwen, Ollama, LM Studio, or any OpenAI-compatible endpoint. Your keys, your spend, your models.',
  },
  {
    name: 'Self-contained binary',
    description:
      'Ships as a single compiled binary with the runtime embedded — no Node, no Bun, no node_modules to install. Just the binary on your PATH.',
  },
  {
    name: 'File-backed history & sessions',
    description:
      'Conversations are saved to disk (~/.justcode/sessions) so you can resume, branch, and revisit past work.',
  },
  {
    name: 'Terminal + VS Code',
    description:
      'The same lean engine powers both the terminal UI and a VS Code extension, so you can work wherever you are.',
  },
];

/** The built-in tools the model can call. */
export const tools: Item[] = [
  {
    name: 'read_file',
    description: 'Read a file, with line windows for large files.',
  },
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing one.',
  },
  {
    name: 'edit_file',
    description: 'Make exact find-and-replace edits inside a file.',
  },
  {
    name: 'apply_patch',
    description: 'Apply a multi-hunk patch across one or more files.',
  },
  {
    name: 'bash',
    description: 'Run shell commands in your working directory.',
  },
  { name: 'glob', description: 'Find files by glob pattern.' },
  {
    name: 'grep',
    description: 'Search file contents with a regular expression.',
  },
  { name: 'web_fetch', description: 'Fetch a URL and read its contents.' },
  {
    name: 'web_search',
    description: 'Search the web for up-to-date information.',
  },
  {
    name: 'todowrite',
    description: 'Track a task list to stay organized on multi-step work.',
  },
  {
    name: 'question',
    description: 'Ask you a clarifying question mid-task when it matters.',
  },
  {
    name: 'present_plan',
    description:
      'Propose an implementation plan before touching code (Plan mode).',
  },
  {
    name: 'view_history',
    description: 'Look back through the conversation and session history.',
  },
  {
    name: 'lazy_load_tools',
    description: 'Load extra tools on demand to keep requests lean.',
  },
];

/** The chat modes (plus user-defined custom modes). */
export const modes: Item[] = [
  {
    name: 'Build',
    description:
      'Implement changes with the full toolset — the default working mode.',
  },
  {
    name: 'Ask',
    description: 'Read-only Q&A about your codebase; explains without editing.',
  },
  {
    name: 'Plan',
    description:
      'Produce a reviewable plan first, then implement it on approval.',
  },
  {
    name: 'Custom',
    description: 'Define your own mode with its own system prompt via /mode.',
  },
];

/** Slash commands available in the chat UI. */
export const commands: Item[] = [
  { name: '/connect', description: 'Search providers and connect to one.' },
  { name: '/models', description: 'Browse and switch the active model.' },
  {
    name: '/refresh-models',
    description: 'Re-fetch every provider model list, bypassing the cache.',
  },
  { name: '/sessions', description: 'Browse saved sessions and resume one.' },
  {
    name: '/new-session',
    description: 'Start a fresh conversation in a new session.',
  },
  { name: '/clear', description: 'Clear the current session and start fresh.' },
  { name: '/clear-sessions', description: 'Delete all saved sessions.' },
  {
    name: '/thinking',
    description: 'Toggle whether model reasoning is shown.',
  },
  {
    name: '/reasoning',
    description: 'Choose reasoning effort for the current model.',
  },
  {
    name: '/auto-approve',
    description: 'Toggle auto-approving all tool actions without confirmation.',
  },
  {
    name: '/local-model-refresh',
    description:
      'Toggle always refreshing local models (off uses a daily cache).',
  },
  {
    name: '/toggle-lazy-tool-loading',
    description: 'Toggle lazy tool loading (off sends all tools by default).',
  },
  {
    name: '/expand-tools',
    description: 'Toggle showing full tool input/output inline by default.',
  },
  { name: '/manage-tools', description: 'Turn individual tools on or off.' },
  {
    name: '/mode',
    description: 'Switch the chat mode or create a custom one.',
  },
  {
    name: '/implement',
    description: 'Switch to Build mode and implement the latest plan.',
  },
  {
    name: '/edit-plan',
    description: 'Save the latest plan to a file to edit before implementing.',
  },
  {
    name: '/collapse-responses',
    description: 'Toggle hiding model responses to scan just your messages.',
  },
  {
    name: '/configure-mcp-servers',
    description: 'Open mcp.json to add or edit MCP servers.',
  },
  {
    name: '/read-limit',
    description: 'Set how many lines of a file the model reads at once.',
  },
  {
    name: '/context-window',
    description: 'Set how many recent context items are sent to the model.',
  },
  { name: '/config', description: 'Open the config file in your editor.' },
  {
    name: '/reset',
    description: 'Reset app defaults and clear connected providers and models.',
  },
];

/** Supported providers. */
export const providers: Item[] = [
  { name: 'OpenAI', description: 'GPT models via the OpenAI API.' },
  { name: 'Anthropic', description: 'Claude models via the Anthropic API.' },
  {
    name: 'OpenRouter',
    description: 'One key, hundreds of models across providers.',
  },
  {
    name: 'Alibaba (Qwen)',
    description: "Qwen via Alibaba Cloud's OpenAI-compatible API.",
  },
  { name: 'Ollama', description: 'Run open models locally, offline.' },
  { name: 'LM Studio', description: 'Local models through LM Studio.' },
  {
    name: 'OpenAI-compatible',
    description: 'Point at any custom OpenAI-compatible endpoint.',
  },
];

/** Install one-liners per channel. */
export const installCommands: { label: string; command: string }[] = [
  {
    label: 'curl',
    command:
      'curl -fsSL https://raw.githubusercontent.com/kingeke/justcode/main/scripts/install.sh | sh',
  },
  { label: 'npm', command: 'npm install -g justcode-cli' },
  {
    label: 'brew',
    command:
      'brew tap kingeke/justcode && brew trust kingeke/justcode && brew install justcode',
  },
];

export const repoUrl = APP_REPO_URL;
export const termsUrl = `${repoUrl}/blob/main/TERMS.md`;
export const privacyUrl = `${repoUrl}/blob/main/PRIVACY.md`;

/** The VS Code extension. */
export const extensionId = 'kingeke.justcode-vscode';
export const marketplaceUrl = `https://marketplace.visualstudio.com/items?itemName=${extensionId}`;
export const extensionInstall = `code --install-extension ${extensionId}`;

/** The two surfaces the same engine drives, shown side by side. */
export const surfaces: { name: string; blurb: string; points: string[] }[] = [
  {
    name: 'Terminal',
    blurb:
      'A fast, keyboard-driven TUI that runs anywhere — a single self-contained binary with no runtime to install.',
    points: [
      'Install via curl, npm, or Homebrew',
      'Slash commands, modes, and session history',
      'Works over SSH and in any shell',
    ],
  },
  {
    name: 'VS Code extension',
    blurb:
      'The exact same lean engine, in a sidebar chat panel — bring the assistant right next to the code you are editing.',
    points: [
      'Chat in the sidebar with inline diffs for every edit',
      'Settings UI for providers and MCP servers',
      'Attach images, browse and resume sessions',
    ],
  },
];
