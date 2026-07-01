import {
  ASK_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '@core/application/system-prompt';
import { ToolName } from '@core/domain/tool-name';
import { APP_NAME } from '@core/branding';

/**
 * A chat "mode" swaps the system prompt sent to the model so the same workspace
 * and toolset can be driven with a different posture — Build (do the work), Ask
 * (answer without changing anything), Plan (lay out an approach first), or a
 * user-defined custom mode. Only the system prompt changes between modes; the
 * workspace root and AGENTS.md are always included regardless (see
 * `buildSystemPrompt`).
 */
/**
 * A semantic icon key. Each surface maps it to its own rendering — an SVG in
 * the VSCode webview, a monochrome glyph in the CLI — so no emoji ships in the
 * shared model.
 */
export type ModeIcon = 'build' | 'ask' | 'plan' | 'custom';

export interface ChatMode {
  id: string;
  /** Human label shown in the picker and the composer pill. */
  name: string;
  /** Which icon to show beside the name; rendered per surface. */
  icon: ModeIcon;
  /** Whether the user created this mode (vs. a built-in). */
  custom: boolean;
}

/** A user-created mode as persisted in config, keyed by its id. */
export interface CustomModeConfig {
  name: string;
  /** Optional override; when omitted the mode uses the Build (agent) prompt. */
  systemPrompt?: string;
}

/** The id of the default mode — the full coding agent. */
export const BUILD_MODE_ID = 'build';
export const ASK_MODE_ID = 'ask';
export const PLAN_MODE_ID = 'plan';

/** Icon shown for any user-created mode. */
export const CUSTOM_MODE_ICON: ModeIcon = 'custom';

/** The built-in modes, in display order. */
export const BUILT_IN_MODES: ChatMode[] = [
  { id: BUILD_MODE_ID, name: 'Build', icon: 'build', custom: false },
  { id: ASK_MODE_ID, name: 'Ask', icon: 'ask', custom: false },
  { id: PLAN_MODE_ID, name: 'Plan', icon: 'plan', custom: false },
];

/** The category headings the mode picker groups under. */
export const BUILT_IN_MODE_CATEGORY = 'Default modes';
export const CUSTOM_MODE_CATEGORY = 'Custom modes';

/**
 * The full mode list — built-ins followed by the user's custom modes — for the
 * picker. Custom mode ids are their config keys.
 */
export function listModes(
  customModes: Record<string, CustomModeConfig> = {}
): ChatMode[] {
  const custom = Object.entries(customModes).map(([id, config]) => ({
    id,
    name: config.name,
    icon: CUSTOM_MODE_ICON,
    custom: true,
  }));
  return [...BUILT_IN_MODES, ...custom];
}

/** Whether a mode id refers to a known mode (built-in or custom). */
export function isKnownMode(
  modeId: string,
  customModes: Record<string, CustomModeConfig> = {}
): boolean {
  return listModes(customModes).some((mode) => mode.id === modeId);
}

/**
 * Slugifies a mode name into an id that doesn't collide with a built-in mode or
 * an existing custom mode, so the picker and config stay readable.
 */
export function uniqueModeId(
  name: string,
  existing: Record<string, CustomModeConfig> = {}
): string {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'mode';
  let id = base;
  let n = 2;
  while (
    id === BUILD_MODE_ID ||
    id === ASK_MODE_ID ||
    id === PLAN_MODE_ID ||
    existing[id]
  ) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/**
 * Adds a custom mode (name + optional system prompt) to a custom-mode map,
 * returning the new map and the created mode's id. Returns null when the name is
 * blank. The input map is not mutated.
 */
export function addCustomMode(
  name: string,
  systemPrompt: string | undefined,
  existing: Record<string, CustomModeConfig> = {}
): { id: string; customModes: Record<string, CustomModeConfig> } | null {
  const trimmedName = name.trim();
  if (!trimmedName) return null;
  const customModes: Record<string, CustomModeConfig> = { ...existing };
  const id = uniqueModeId(trimmedName, customModes);
  const prompt = systemPrompt?.trim();
  customModes[id] = {
    name: trimmedName,
    ...(prompt ? { systemPrompt: prompt } : {}),
  };
  return { id, customModes };
}

/**
 * Resolves the system prompt for the active mode. Built-in Ask/Plan use their
 * fixed prompts; Build uses `agentPrompt` (the user-editable base from config,
 * falling back to the default). A custom mode uses its own prompt, or the agent
 * prompt when it didn't set one. An unknown id falls back to the agent prompt.
 */
export function resolveModeSystemPrompt(
  modeId: string,
  options: {
    agentPrompt?: string | undefined;
    customModes?: Record<string, CustomModeConfig> | undefined;
  } = {}
): string {
  const agentPrompt = options.agentPrompt ?? DEFAULT_SYSTEM_PROMPT;
  if (modeId === ASK_MODE_ID) return ASK_SYSTEM_PROMPT;
  if (modeId === PLAN_MODE_ID) return PLAN_SYSTEM_PROMPT;
  if (modeId === BUILD_MODE_ID) return agentPrompt;

  const custom = options.customModes?.[modeId];
  if (custom) {
    return custom.systemPrompt && custom.systemPrompt.trim()
      ? custom.systemPrompt
      : agentPrompt;
  }
  return agentPrompt;
}

/**
 * The composer's idle placeholder for a mode, hinting at what the mode does.
 * Built-ins get their own line; custom modes fall back to the Build/default one.
 */
export function modePlaceholder(modeId: string): string {
  switch (modeId) {
    case ASK_MODE_ID:
      return `Ask ${APP_NAME} about your code…`;
    case PLAN_MODE_ID:
      return `Ask ${APP_NAME} to plan a change…`;
    default:
      return `Ask ${APP_NAME} to build, fix, or explain…`;
  }
}

/**
 * Tool names a mode needs advertised up front even under lazy loading. Plan mode
 * surfaces `present_plan` from the first turn so the model can deliver a plan
 * without first loading the whole toolset; other modes add nothing (present_plan
 * is still reachable via `lazy_load_tools` when they need it).
 */
export function eagerToolsForMode(modeId: string): string[] {
  return modeId === PLAN_MODE_ID ? [ToolName.PresentPlan] : [];
}
