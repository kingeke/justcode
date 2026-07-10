/**
 * The skill system's shared domain model: what an installed skill looks like,
 * how its `justcode.json` manifest and command markdown files are parsed, and
 * how the commands of every installed skill fold into one collision-safe
 * slash-command index.
 *
 * Kept dependency-free (no `node:` imports) so it can be consumed by any host —
 * the CLI, the VSCode extension host, or the webview protocol layer. All disk
 * and git I/O lives in `@runtime/skills/skill-store`.
 */

/** Separates the skill name from the command name in a namespaced invocation. */
export const SKILL_COMMAND_SEPARATOR = ':';

/**
 * The `justcode.json` manifest at the root of a skill repository. Only `name`
 * and `version` are required; everything else is additive. Unknown keys are
 * preserved (not stripped) so future capabilities — dependencies, required MCP
 * servers, env vars, setup scripts, signing — can ride the same file without a
 * breaking change.
 */
export interface SkillManifest {
  /** Kebab-case identifier; doubles as the install directory name. */
  name: string;
  /** Semantic version of the skill pack. */
  version: string;
  description?: string;
  author?: string;
  /**
   * Repo-relative paths of the command markdown files. When omitted, every
   * `commands/*.md` file is discovered instead, so a minimal skill needs only
   * the manifest and a commands directory.
   */
  commands?: string[];
  /** Everything else in the manifest, preserved for forward compatibility. */
  [key: string]: unknown;
}

/** A command parsed from a skill's markdown file (frontmatter + body). */
export interface SkillCommandDefinition {
  /** Command name from the frontmatter (or the file name when omitted). */
  name: string;
  description?: string;
  /**
   * Tool names the command wants reachable from the first turn. They're
   * advertised eagerly for that turn (on top of lazy loading), not exclusively
   * — the model can still load others.
   */
  tools?: string[];
  /**
   * Model to run the command with. `"auto"` (or unset) keeps the session's
   * active model; any other value is used when it matches an available model.
   */
  model?: string;
  /** Short usage hint shown next to the command in pickers, e.g. "<file> [jd]". */
  argumentHint?: string;
  /** The markdown body — the system prompt the command executes with. */
  body: string;
  /** Repo-relative path of the source file, for `skill info` and errors. */
  path: string;
}

/**
 * Where a skill is installed: `local` lives in the project's `.justcode/skills`
 * (available only inside that project), `global` in the shared cache directory
 * (available everywhere). A local skill shadows a global one of the same name.
 */
export enum SkillScope {
  Local = 'local',
  Global = 'global',
}

/** A skill on disk with its manifest and parsed commands. */
export interface InstalledSkill {
  manifest: SkillManifest;
  commands: SkillCommandDefinition[];
  /** Absolute path of the install directory. */
  directory: string;
  /** Which scope the skill is installed in, when discovery knows it. */
  scope?: SkillScope;
  /** Where the skill was installed from (git URL), when known. */
  source?: string;
  /** ISO timestamp of the install, when known. */
  installedAt?: string;
  /**
   * Command files that failed to parse, as `path: reason` strings. A broken
   * command never blocks the rest of the skill.
   */
  errors: string[];
}

/**
 * One invocable slash command in the merged index. Every command is always
 * reachable under its namespaced name (`<skill>:<command>`); `bareName` is the
 * short alias, present only while no other skill (or built-in command) claims
 * the same name.
 */
export interface SkillCommandRef {
  /** The always-valid invocation, e.g. `test-skill:scan`. */
  qualifiedName: string;
  /** The short alias, e.g. `scan`; undefined when the name is contested. */
  bareName?: string;
  skillName: string;
  command: SkillCommandDefinition;
}

/** A command name claimed by more than one skill (or shadowing a built-in). */
export interface SkillCommandCollision {
  name: string;
  /** The skills that define it; includes 'built-in' when a host command wins. */
  claimedBy: string[];
}

export interface SkillCommandIndex {
  /** Every installed command, in skill order then file order. */
  commands: SkillCommandRef[];
  collisions: SkillCommandCollision[];
  /** Resolves a typed name — bare or namespaced — to its command. */
  resolve: (name: string) => SkillCommandRef | undefined;
}

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Validates a raw parsed JSON value as a skill manifest. Throws on problems. */
export function validateSkillManifest(raw: unknown): SkillManifest {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('justcode.json must be a JSON object.');
  }
  const manifest = raw as Record<string, unknown>;
  const name = manifest.name;
  if (typeof name !== 'string' || !SKILL_NAME_PATTERN.test(name)) {
    throw new Error(
      'justcode.json needs a \'name\': lowercase letters, digits, and hyphens (e.g. "test-skill").'
    );
  }
  if (typeof manifest.version !== 'string' || !manifest.version.trim()) {
    throw new Error('justcode.json needs a \'version\' string (e.g. "1.0.0").');
  }
  if (manifest.commands !== undefined) {
    if (
      !Array.isArray(manifest.commands) ||
      manifest.commands.some((entry) => typeof entry !== 'string')
    ) {
      throw new Error(
        "justcode.json 'commands' must be an array of file paths."
      );
    }
    // Reject absolute paths and traversal so a manifest can't point outside its
    // own repository (the store resolves these against the install directory).
    for (const entry of manifest.commands as string[]) {
      if (entry.startsWith('/') || entry.split('/').includes('..')) {
        throw new Error(
          `justcode.json command path '${entry}' must be relative to the skill root.`
        );
      }
    }
  }
  return manifest as SkillManifest;
}

export function parseSkillManifest(json: string): SkillManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('justcode.json is not valid JSON.');
  }
  return validateSkillManifest(raw);
}

/**
 * Slugifies a free-form name (a repo or directory basename, a frontmatter
 * title) into a valid skill/command name: lowercased, runs of anything else
 * collapsed to hyphens.
 */
export function slugifySkillName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'skill'
  );
}

/**
 * Claude-convention tool names → JustCode tool names, so a command written for
 * Claude Code (`allowed-tools: [Read, "Bash(git:*)"]`) maps onto the tools
 * this runtime actually advertises. Names with call filters (`Bash(git:*)`)
 * map by their leading identifier; unknown names are dropped — eager tool
 * advertising is an optimization, never a gate, so dropping is safe.
 */
const EXTERNAL_TOOL_NAMES: Record<string, string> = {
  read: 'read_file',
  write: 'write_file',
  edit: 'edit_file',
  grep: 'grep',
  glob: 'glob',
  bash: 'bash',
  webfetch: 'webfetch',
  websearch: 'websearch',
  todowrite: 'todowrite',
};

function mapExternalTools(entries: string[]): string[] {
  const mapped: string[] = [];
  for (const entry of entries) {
    const identifier = entry.match(/^([A-Za-z_][\w]*)/)?.[1]?.toLowerCase();
    const name = identifier ? EXTERNAL_TOOL_NAMES[identifier] : undefined;
    if (name && !mapped.includes(name)) mapped.push(name);
  }
  return mapped;
}

/**
 * Parses a command markdown file: an optional `---` frontmatter block (a small
 * YAML subset: string scalars, `- item` lists, inline `[a, b]` lists) followed
 * by the body that becomes the command's system prompt.
 *
 * `fallbackName` (the file's basename) names the command when the frontmatter
 * omits `name`, so a bare markdown file is a valid command. Alongside the
 * native keys, Claude-convention frontmatter is understood: `allowed-tools`
 * maps onto `tools` (with tool names translated), so command files written for
 * Claude Code parse without changes.
 */
export function parseSkillCommand(
  markdown: string,
  fallbackName: string,
  path: string
): SkillCommandDefinition {
  const { frontmatter, body } = splitFrontmatter(markdown);
  let name = (frontmatter.name as string | undefined) ?? fallbackName;
  // Salvage names that only violate casing/characters (e.g. a "Scan ATS"
  // title or an Uppercase.md file) before rejecting outright. The pattern
  // also excludes ':', which is reserved for skill namespacing.
  if (!COMMAND_NAME_PATTERN.test(name)) name = slugifySkillName(name);
  if (!COMMAND_NAME_PATTERN.test(name)) {
    throw new Error(
      `Command name '${name}' must be lowercase letters, digits, dots, hyphens, or underscores.`
    );
  }
  if (!body.trim()) {
    throw new Error(`Command '${name}' has an empty body.`);
  }
  const tools = Array.isArray(frontmatter.tools)
    ? frontmatter.tools
    : toolsFromExternalFrontmatter(frontmatter);
  const description = frontmatter.description;
  const model = frontmatter.model;
  const argumentHint =
    frontmatter['argument-hint'] ?? frontmatter['argumentHint'];
  return {
    name,
    ...(typeof description === 'string' ? { description } : {}),
    ...(tools && tools.length ? { tools } : {}),
    ...(typeof model === 'string' ? { model } : {}),
    ...(typeof argumentHint === 'string' ? { argumentHint } : {}),
    body: body.trim(),
    path,
  };
}

/** The Claude-convention `allowed-tools` key, as a translated tool list. */
function toolsFromExternalFrontmatter(
  frontmatter: Record<string, string | string[]>
): string[] | undefined {
  const allowed = frontmatter['allowed-tools'];
  if (Array.isArray(allowed)) return mapExternalTools(allowed);
  // Inline form: `allowed-tools: Read, Grep, Bash(git:*)`.
  if (typeof allowed === 'string') {
    return mapExternalTools(allowed.split(',').map((entry) => entry.trim()));
  }
  return undefined;
}

/**
 * Splits a markdown document into its frontmatter map and body. Documents
 * without frontmatter yield an empty map and the whole text as body.
 */
function splitFrontmatter(markdown: string): {
  frontmatter: Record<string, string | string[]>;
  body: string;
} {
  const normalized = markdown.replace(/^﻿/, '');
  if (!normalized.startsWith('---')) {
    return { frontmatter: {}, body: normalized };
  }
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) {
    return { frontmatter: {}, body: normalized };
  }
  const block = normalized.slice(normalized.indexOf('\n') + 1, end);
  const body = normalized.slice(end + 4).replace(/^\r?\n/, '');
  return { frontmatter: parseFrontmatterBlock(block), body };
}

/**
 * A deliberately small YAML subset — enough for command metadata without
 * pulling a YAML dependency into the bundle: `key: value` scalars (optionally
 * quoted), `key:` followed by `- item` lines, and inline `[a, b]` lists.
 * Unknown constructs are skipped rather than rejected.
 */
function parseFrontmatterBlock(
  block: string
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  let pendingListKey: string | null = null;
  for (const rawLine of block.split(/\r?\n/)) {
    const listItem = rawLine.match(/^\s+-\s*(.+)$/);
    if (listItem && pendingListKey) {
      const existing = result[pendingListKey];
      if (Array.isArray(existing)) existing.push(unquote(listItem[1]!.trim()));
      continue;
    }
    const keyValue = rawLine.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!keyValue) continue;
    const key = keyValue[1]!;
    const value = keyValue[2]!.trim();
    if (!value) {
      // `key:` with nothing after it opens a `- item` list.
      result[key] = [];
      pendingListKey = key;
      continue;
    }
    pendingListKey = null;
    if (value.startsWith('[') && value.endsWith(']')) {
      result[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter((item) => item.length > 0);
      continue;
    }
    result[key] = unquote(value);
  }
  return result;
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Merges every installed skill's commands into one collision-safe index.
 *
 * Naming strategy: each command is always registered under its namespaced
 * `<skill>:<command>` form. The bare `<command>` alias is granted only while
 * exactly one skill defines that name AND no host built-in claims it
 * (`reservedNames`). Contested names are reported as collisions so hosts can
 * warn; nothing is silently dropped — the namespaced form always works.
 */
export function buildSkillCommandIndex(
  skills: InstalledSkill[],
  reservedNames: readonly string[] = []
): SkillCommandIndex {
  const reserved = new Set(reservedNames);
  const claimants = new Map<string, string[]>();
  for (const skill of skills) {
    for (const command of skill.commands) {
      const list = claimants.get(command.name) ?? [];
      list.push(skill.manifest.name);
      claimants.set(command.name, list);
    }
  }

  const commands: SkillCommandRef[] = [];
  const byName = new Map<string, SkillCommandRef>();
  const collisions: SkillCommandCollision[] = [];

  for (const [name, claimedBy] of claimants) {
    if (reserved.has(name)) {
      collisions.push({ name, claimedBy: ['built-in', ...claimedBy] });
    } else if (claimedBy.length > 1) {
      collisions.push({ name, claimedBy });
    }
  }

  for (const skill of skills) {
    for (const command of skill.commands) {
      const contested =
        reserved.has(command.name) ||
        (claimants.get(command.name)?.length ?? 0) > 1;
      const qualifiedName = `${skill.manifest.name}${SKILL_COMMAND_SEPARATOR}${command.name}`;
      const ref: SkillCommandRef = {
        qualifiedName,
        ...(contested ? {} : { bareName: command.name }),
        skillName: skill.manifest.name,
        command,
      };
      commands.push(ref);
      byName.set(qualifiedName, ref);
      if (!contested) byName.set(command.name, ref);
    }
  }

  return {
    commands,
    collisions,
    resolve: (name: string) => byName.get(name),
  };
}

/** The `$ARGUMENTS` placeholder a command body may use to receive CLI args. */
export const SKILL_ARGUMENTS_PLACEHOLDER = '$ARGUMENTS';

/**
 * Resolves the prompt a command executes with: the body with `$ARGUMENTS`
 * replaced by what the user typed after the command (or a note that none were
 * given, so the placeholder never leaks into the prompt verbatim).
 */
export function renderSkillCommandPrompt(
  command: SkillCommandDefinition,
  args: string
): string {
  if (!command.body.includes(SKILL_ARGUMENTS_PLACEHOLDER)) {
    return command.body;
  }
  return command.body.replaceAll(
    SKILL_ARGUMENTS_PLACEHOLDER,
    args.trim() || '(no arguments given)'
  );
}
