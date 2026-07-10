/**
 * On-disk skill management: installing skill packs from git repositories,
 * updating and removing them, and discovering every installed skill
 * (manifest + commands) at startup.
 *
 * Skills install into one of two scopes, each an independent directory with
 * the same layout:
 *
 *   global — <configDirectory>/skills/       (available in every project)
 *   local  — <workspaceRoot>/.justcode/skills/  (this project only)
 *
 *   <skills dir>/
 *   ├── skills.json          — install metadata (source URL, timestamp) per skill
 *   ├── test-skill/          — a cloned skill repository, contents untouched
 *   │   ├── justcode.json
 *   │   └── commands/*.md
 *   └── ...
 *
 * A local skill shadows a global one of the same name (see
 * {@link discoverAllSkills}). The cloned repository is never modified (its
 * `.git` is kept so `skill update` is a plain `git pull`); install metadata
 * lives in the sibling `skills.json`.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { basename, join } from 'node:path';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import {
  parseSkillManifest,
  parseSkillCommand,
  slugifySkillName,
  type InstalledSkill,
  type SkillCommandDefinition,
  type SkillManifest,
  SkillScope,
} from '@core/domain/skill';

const execFileAsync = promisify(execFile);

/** Where globally installed skills live, under the app's config directory. */
export function skillsDirectory(configDirectory: string): string {
  return join(configDirectory, 'skills');
}

/** Where a project's local skills live, under its `.justcode` directory. */
export function localSkillsDirectory(workspaceRoot: string): string {
  return join(workspaceRoot, '.justcode', 'skills');
}

/** Install metadata for one skill, keyed by skill name in `skills.json`. */
interface SkillRecord {
  source: string;
  installedAt: string;
  updatedAt?: string;
}

type SkillRegistry = Record<string, SkillRecord>;

async function readRegistry(skillsDir: string): Promise<SkillRegistry> {
  try {
    const raw = await readFile(join(skillsDir, 'skills.json'), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      !Array.isArray(parsed)
    ) {
      return parsed as SkillRegistry;
    }
  } catch {
    // Missing or corrupt: rebuilt lazily; discovery works without it.
  }
  return {};
}

async function writeRegistry(
  skillsDir: string,
  registry: SkillRegistry
): Promise<void> {
  await mkdir(skillsDir, { recursive: true });
  await writeFile(
    join(skillsDir, 'skills.json'),
    `${JSON.stringify(registry, null, 2)}\n`,
    'utf8'
  );
}

/**
 * Normalizes what the user typed into a cloneable git URL. Accepts
 * `owner/repo` shorthand (assumed GitHub), full `https://` URLs (with or
 * without `.git`), `git@`/`ssh://` remotes, and local paths (`file://` or an
 * absolute path) — handy while developing a skill before publishing it.
 */
export function parseSkillSource(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('No repository given.');
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('git@') ||
    trimmed.startsWith('ssh://') ||
    trimmed.startsWith('file://') ||
    trimmed.startsWith('/')
  ) {
    return trimmed;
  }
  if (/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    return `https://github.com/${trimmed}.git`;
  }
  throw new Error(
    `'${input}' is not a repository URL or an owner/repo shorthand.`
  );
}

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      ...(cwd ? { cwd } : {}),
      env: {
        ...process.env,
        // Fail fast instead of hanging on a credential prompt for a private or
        // misspelled repo — the CLI is not a terminal git can ask questions in.
        GIT_TERMINAL_PROMPT: '0',
      },
      timeout: 120_000,
    });
    return stdout;
  } catch (error) {
    const stderr =
      typeof error === 'object' && error !== null && 'stderr' in error
        ? String((error as { stderr: unknown }).stderr).trim()
        : '';
    throw new Error(stderr || `git ${args[0]} failed`);
  }
}

/**
 * Reads a skill directory into an {@link InstalledSkill}: parses the manifest,
 * resolves its command list (explicit `commands` paths, else `commands/*.md`),
 * and parses each command file. A command that fails to parse lands in
 * `errors` instead of sinking the whole skill.
 */
export async function loadSkillFromDirectory(
  directory: string,
  record?: SkillRecord,
  fallbackName?: string
): Promise<InstalledSkill> {
  let manifestRaw: string | undefined;
  try {
    manifestRaw = await readFile(join(directory, 'justcode.json'), 'utf8');
  } catch {
    // Not a native JustCode skill — adapt the ecosystem conventions instead
    // (Claude plugins, SKILL.md skills, commands/*.md), so any skill repo
    // installs without needing a JustCode-specific manifest.
    return adaptExternalSkill(directory, record, fallbackName);
  }
  const manifest = parseSkillManifest(manifestRaw);

  let commandPaths = manifest.commands;
  if (commandPaths === undefined) {
    commandPaths = await listMarkdownFiles(directory, 'commands');
  }

  const commands: SkillCommandDefinition[] = [];
  const errors: string[] = [];
  for (const path of commandPaths) {
    try {
      const markdown = await readFile(join(directory, path), 'utf8');
      const name = basename(path).replace(/\.md$/, '');
      commands.push(parseSkillCommand(markdown, name, path));
    } catch (error) {
      errors.push(
        `${path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return {
    manifest,
    commands,
    directory,
    ...(record
      ? { source: record.source, installedAt: record.installedAt }
      : {}),
    errors,
  };
}

/**
 * Where non-JustCode repos keep their commands and skills. Checked in order,
 * deduped by command name (first hit wins), so a repo that mirrors the same
 * commands for several agent CLIs (`.claude`, `.opencode`, …) registers each
 * command once.
 */
const EXTERNAL_COMMAND_DIRS = [
  'commands',
  '.claude/commands',
  '.opencode/commands',
  '.agents/commands',
];
const EXTERNAL_SKILL_DIRS = [
  'skills',
  '.claude/skills',
  '.opencode/skills',
  '.agents/skills',
];

/**
 * Reads a repository without a `justcode.json` as a skill by adapting the
 * shared ecosystem conventions:
 *
 * - metadata from `.claude-plugin/plugin.json` (name/version/description),
 *   else the repo/directory name
 * - commands from `commands/*.md` and the per-CLI mirrors
 *   (`.claude/commands`, `.opencode/commands`, …)
 * - skills from a root `SKILL.md` and `skills/<name>/SKILL.md` (and the
 *   per-CLI mirrors) — each SKILL.md becomes one command
 *
 * Rejects only when none of those yield a single usable command.
 */
async function adaptExternalSkill(
  directory: string,
  record?: SkillRecord,
  fallbackName?: string
): Promise<InstalledSkill> {
  const plugin = await readClaudePluginManifest(directory);
  const name = slugifySkillName(
    plugin?.name ?? fallbackName ?? basename(directory)
  );
  const manifest: SkillManifest = {
    name,
    version: plugin?.version ?? '0.0.0',
    ...(plugin?.description ? { description: plugin.description } : {}),
    ...(plugin?.author ? { author: plugin.author } : {}),
  };

  const commands: SkillCommandDefinition[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  const addCommand = (command: SkillCommandDefinition): void => {
    if (seen.has(command.name)) return;
    seen.add(command.name);
    commands.push(command);
  };

  // Command markdown files, native dir first then the per-CLI mirrors.
  for (const dir of EXTERNAL_COMMAND_DIRS) {
    for (const path of await listMarkdownFiles(directory, dir)) {
      try {
        const markdown = await readFile(join(directory, path), 'utf8');
        const commandName = basename(path).replace(/\.md$/, '');
        addCommand(parseSkillCommand(markdown, commandName, path));
      } catch (error) {
        errors.push(
          `${path}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // SKILL.md files: the root one (named after the skill) and one per
  // `skills/<name>/` directory (named after its directory).
  const skillFiles: { path: string; name: string }[] = [];
  if (await exists(join(directory, 'SKILL.md'))) {
    skillFiles.push({ path: 'SKILL.md', name });
  }
  for (const dir of EXTERNAL_SKILL_DIRS) {
    try {
      for (const entry of (await readdir(join(directory, dir))).sort()) {
        const path = join(dir, entry, 'SKILL.md');
        if (await exists(join(directory, path))) {
          skillFiles.push({ path, name: slugifySkillName(entry) });
        }
      }
    } catch {
      // Directory absent — fine.
    }
  }
  for (const file of skillFiles) {
    try {
      const markdown = await readFile(join(directory, file.path), 'utf8');
      addCommand(parseSkillCommand(markdown, file.name, file.path));
    } catch (error) {
      errors.push(
        `${file.path}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  if (commands.length === 0 && errors.length === 0) {
    throw new Error(
      'No skill files found: the repository has no justcode.json, SKILL.md, or commands/*.md (including .claude/.opencode variants). See docs/skills.md for the supported formats.'
    );
  }

  return {
    manifest,
    commands,
    directory,
    ...(record
      ? { source: record.source, installedAt: record.installedAt }
      : {}),
    errors,
  };
}

/** The `.claude-plugin/plugin.json` metadata, when the repo is a Claude plugin. */
async function readClaudePluginManifest(directory: string): Promise<
  | {
      name?: string;
      version?: string;
      description?: string;
      author?: string;
    }
  | undefined
> {
  try {
    const raw = await readFile(
      join(directory, '.claude-plugin', 'plugin.json'),
      'utf8'
    );
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const plugin = parsed as Record<string, unknown>;
    // `author` may be a string or an object with a `name`.
    const author =
      typeof plugin.author === 'string'
        ? plugin.author
        : typeof plugin.author === 'object' && plugin.author !== null
          ? (plugin.author as { name?: unknown }).name
          : undefined;
    return {
      ...(typeof plugin.name === 'string' ? { name: plugin.name } : {}),
      ...(typeof plugin.version === 'string'
        ? { version: plugin.version }
        : {}),
      ...(typeof plugin.description === 'string'
        ? { description: plugin.description }
        : {}),
      ...(typeof author === 'string' ? { author } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Markdown files under `dir` (repo-relative), recursing one level so grouped
 * commands (`.claude/commands/<group>/<name>.md`) are found. Sorted for
 * deterministic registration order; missing directories yield nothing.
 */
async function listMarkdownFiles(root: string, dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md')) {
      results.push(join(dir, entry.name));
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      try {
        for (const nested of await readdir(join(root, dir, entry.name))) {
          if (nested.endsWith('.md')) {
            results.push(join(dir, entry.name, nested));
          }
        }
      } catch {
        // Unreadable subdirectory — skip.
      }
    }
  }
  return results.sort();
}

/**
 * Installs a skill from a git repository into the given skills directory (see
 * {@link skillsDirectory} / {@link localSkillsDirectory} for the two scopes):
 * clones it to a temp directory, validates the manifest, then moves it into
 * place under its manifest name. Fails without side effects when the repo is
 * unreachable or invalid; an already-installed skill of the same name (in this
 * scope) is rejected (use update).
 */
export async function installSkill(
  source: string,
  skillsDir: string
): Promise<InstalledSkill> {
  const url = parseSkillSource(source);
  await mkdir(skillsDir, { recursive: true });

  // A name to fall back on when the repo carries no manifest at all: the
  // repository's own name (e.g. `career-ops` from `…/career-ops.git`).
  const repoName = repoNameFromSource(url);

  // Clone into a temp sibling first so a failed validation never leaves a
  // half-installed directory under a real skill name.
  const staging = join(skillsDir, `.staging-${randomUUID()}`);
  try {
    await git(['clone', '--depth', '1', url, staging]);
    const skill = await loadSkillFromDirectory(staging, undefined, repoName);
    if (skill.commands.length === 0 && skill.errors.length > 0) {
      throw new Error(`No usable commands:\n  ${skill.errors.join('\n  ')}`);
    }

    const name = skill.manifest.name;
    const target = join(skillsDir, name);
    const registry = await readRegistry(skillsDir);
    if (registry[name] || (await exists(target))) {
      throw new Error(
        `Skill '${name}' is already installed. Run \`skill update ${name}\` or remove it first.`
      );
    }

    await rename(staging, target);
    registry[name] = { source: url, installedAt: new Date().toISOString() };
    await writeRegistry(skillsDir, registry);
    return await loadSkillFromDirectory(target, registry[name], name);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** The repository name a git source URL points at, slugified. */
function repoNameFromSource(url: string): string {
  const trimmed = url.replace(/\/+$/, '').replace(/\.git$/, '');
  // Covers https/ssh/file paths and scp-style `git@host:owner/repo` remotes.
  const segment = trimmed.split(/[/:]/).pop() ?? trimmed;
  return slugifySkillName(segment);
}

/** Removes an installed skill's directory and registry entry from a scope. */
export async function removeSkill(
  name: string,
  skillsDir: string
): Promise<void> {
  const target = join(skillsDir, name);
  if (!(await exists(target))) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  await rm(target, { recursive: true, force: true });
  const registry = await readRegistry(skillsDir);
  if (registry[name]) {
    delete registry[name];
    await writeRegistry(skillsDir, registry);
  }
}

/**
 * Updates an installed skill in place with `git pull`. Falls back to a fresh
 * clone from the recorded source when the checkout can't pull (e.g. it was
 * installed by an older version without `.git`, or history was rewritten).
 */
export async function updateSkill(
  name: string,
  skillsDir: string
): Promise<InstalledSkill> {
  const target = join(skillsDir, name);
  if (!(await exists(target))) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  const registry = await readRegistry(skillsDir);
  const record = registry[name];

  try {
    await git(['pull', '--ff-only'], target);
  } catch (pullError) {
    if (!record?.source) {
      throw new Error(
        `Could not update '${name}': ${pullError instanceof Error ? pullError.message : String(pullError)}`
      );
    }
    // Re-clone from the recorded source, replacing the directory only after
    // the fresh copy validates.
    const staging = join(skillsDir, `.staging-${randomUUID()}`);
    try {
      await git(['clone', '--depth', '1', record.source, staging]);
      await loadSkillFromDirectory(staging, undefined, name);
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  const updated = await loadSkillFromDirectory(target, record, name);
  if (record) {
    record.updatedAt = new Date().toISOString();
    await writeRegistry(skillsDir, registry);
  }
  return updated;
}

/**
 * Discovers every installed skill in one skills directory. Broken skills
 * (unreadable manifest) are skipped and reported in `errors` rather than
 * failing discovery — one bad install must never take the app down.
 */
export async function discoverSkills(
  skillsDir: string,
  scope?: SkillScope
): Promise<{
  skills: InstalledSkill[];
  errors: string[];
}> {
  let entries;
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return { skills: [], errors: [] };
  }
  const registry = await readRegistry(skillsDir);

  const skills: InstalledSkill[] = [];
  const errors: string[] = [];
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  for (const entry of names) {
    const directory = join(skillsDir, entry);
    try {
      const skill = await loadSkillFromDirectory(
        directory,
        registry[entry],
        entry
      );
      skills.push(scope ? { ...skill, scope } : skill);
    } catch (error) {
      errors.push(
        `${entry}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { skills, errors };
}

/**
 * Discovers skills across both scopes: the project's `.justcode/skills` and
 * the global `<configDirectory>/skills`. A local skill shadows a global one of
 * the same name, so a project can pin its own copy of a shared skill. The
 * result lists local skills first.
 */
export async function discoverAllSkills(options: {
  configDirectory: string;
  workspaceRoot?: string | undefined;
}): Promise<{ skills: InstalledSkill[]; errors: string[] }> {
  const local = options.workspaceRoot
    ? await discoverSkills(
        localSkillsDirectory(options.workspaceRoot),
        SkillScope.Local
      )
    : { skills: [], errors: [] };
  const global = await discoverSkills(
    skillsDirectory(options.configDirectory),
    SkillScope.Global
  );
  const localNames = new Set(local.skills.map((skill) => skill.manifest.name));
  return {
    skills: [
      ...local.skills,
      ...global.skills.filter((skill) => !localNames.has(skill.manifest.name)),
    ],
    errors: [...local.errors, ...global.errors],
  };
}

/** Loads one installed skill by name from a skills directory. */
export async function getInstalledSkill(
  name: string,
  skillsDir: string
): Promise<InstalledSkill> {
  const directory = join(skillsDir, name);
  if (!(await exists(directory))) {
    throw new Error(`Skill '${name}' is not installed.`);
  }
  const registry = await readRegistry(skillsDir);
  return loadSkillFromDirectory(directory, registry[name], name);
}

/** Whether a skill of this name is installed in the given skills directory. */
export async function isSkillInstalled(
  name: string,
  skillsDir: string
): Promise<boolean> {
  return exists(join(skillsDir, name));
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path, 'utf8');
    return true;
  } catch (error) {
    // A directory hits EISDIR — it exists; only ENOENT means absent.
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code !== 'ENOENT'
    );
  }
}
