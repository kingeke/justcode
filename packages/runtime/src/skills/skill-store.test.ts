import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  discoverAllSkills,
  discoverSkills,
  getInstalledSkill,
  installSkill,
  loadSkillFromDirectory,
  localSkillsDirectory,
  parseSkillSource,
  removeSkill,
  skillsDirectory,
  updateSkill,
} from '@runtime/skills/skill-store';

let workDir: string;
let skillsDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'justcode-skill-test-'));
  skillsDir = join(workDir, 'skills');
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

function gitIn(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'ignore',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  });
}

/** Writes a valid skill repo (manifest + one command) and commits it. */
async function createSkillRepo(name = 'test-skill'): Promise<string> {
  const repo = join(workDir, `${name}-repo`);
  await mkdir(join(repo, 'commands'), { recursive: true });
  await writeFile(
    join(repo, 'justcode.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      description: 'Career assistant workflows',
      commands: ['commands/scan.md'],
    })
  );
  await writeFile(
    join(repo, 'commands', 'scan.md'),
    '---\nname: scan\ndescription: Review a resume\n---\n\nYou are a recruiter.\n'
  );
  gitIn(repo, 'init', '-q');
  gitIn(repo, 'add', '.');
  gitIn(repo, 'commit', '-q', '-m', 'initial');
  return repo;
}

describe('parseSkillSource', () => {
  it('expands owner/repo to a GitHub URL and passes URLs through', () => {
    expect(parseSkillSource('test/skill')).toBe(
      'https://github.com/test/skill.git'
    );
    expect(parseSkillSource('https://github.com/test/skill')).toBe(
      'https://github.com/test/skill'
    );
    expect(parseSkillSource('git@github.com:a/b.git')).toBe(
      'git@github.com:a/b.git'
    );
    expect(parseSkillSource('/some/local/repo')).toBe('/some/local/repo');
  });

  it('rejects anything else', () => {
    expect(() => parseSkillSource('')).toThrow('No repository');
    expect(() => parseSkillSource('not a repo')).toThrow(
      'not a repository URL'
    );
  });
});

describe('loadSkillFromDirectory', () => {
  it('auto-discovers commands/*.md when the manifest lists none', async () => {
    const dir = join(workDir, 'auto');
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(
      join(dir, 'justcode.json'),
      JSON.stringify({ name: 'auto', version: '0.1.0' })
    );
    await writeFile(join(dir, 'commands', 'pdf.md'), 'Make a PDF.');
    await writeFile(join(dir, 'commands', 'notes.txt'), 'ignored');
    const skill = await loadSkillFromDirectory(dir);
    expect(skill.commands.map((command) => command.name)).toEqual(['pdf']);
  });

  it('collects a broken command in errors without sinking the skill', async () => {
    const dir = join(workDir, 'broken');
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(
      join(dir, 'justcode.json'),
      JSON.stringify({
        name: 'broken',
        version: '0.1.0',
        commands: ['commands/good.md', 'commands/missing.md'],
      })
    );
    await writeFile(join(dir, 'commands', 'good.md'), 'Works.');
    const skill = await loadSkillFromDirectory(dir);
    expect(skill.commands.map((command) => command.name)).toEqual(['good']);
    expect(skill.errors).toHaveLength(1);
    expect(skill.errors[0]).toContain('commands/missing.md');
  });
});

describe('install / discover / update / remove', () => {
  it('installs from a git repo, discovers it, and removes it', async () => {
    const repo = await createSkillRepo();

    const installed = await installSkill(repo, skillsDir);
    expect(installed.manifest.name).toBe('test-skill');
    expect(installed.commands.map((command) => command.name)).toEqual(['scan']);
    expect(installed.source).toBe(repo);

    const registry = JSON.parse(
      await readFile(join(skillsDir, 'skills.json'), 'utf8')
    );
    expect(registry['test-skill'].source).toBe(repo);

    const discovered = await discoverSkills(skillsDir);
    expect(discovered.skills.map((skill) => skill.manifest.name)).toEqual([
      'test-skill',
    ]);
    expect(discovered.errors).toEqual([]);

    const info = await getInstalledSkill('test-skill', skillsDir);
    expect(info.manifest.description).toBe('Career assistant workflows');

    await removeSkill('test-skill', skillsDir);
    const after = await discoverSkills(skillsDir);
    expect(after.skills).toEqual([]);
  });

  it('rejects installing the same skill twice', async () => {
    const repo = await createSkillRepo();
    await installSkill(repo, skillsDir);
    await expect(installSkill(repo, skillsDir)).rejects.toThrow(
      'already installed'
    );
  });

  it('rejects a repo with no skill files at all, leaving nothing behind', async () => {
    const repo = join(workDir, 'no-manifest');
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, 'README.md'), 'not a skill');
    gitIn(repo, 'init', '-q');
    gitIn(repo, 'add', '.');
    gitIn(repo, 'commit', '-q', '-m', 'initial');

    await expect(installSkill(repo, skillsDir)).rejects.toThrow(
      'No skill files found'
    );
    const discovered = await discoverSkills(skillsDir);
    expect(discovered.skills).toEqual([]);
  });

  it('adapts a Claude-convention repo without a justcode.json', async () => {
    // Mirrors the ecosystem layout: plugin metadata, a SKILL.md skill, and
    // per-CLI command mirrors that must dedupe to one command each.
    const repo = join(workDir, 'claude-style');
    await mkdir(join(repo, '.claude-plugin'), { recursive: true });
    await mkdir(join(repo, '.claude', 'skills', 'job-hunt'), {
      recursive: true,
    });
    await mkdir(join(repo, '.claude', 'commands'), { recursive: true });
    await mkdir(join(repo, '.opencode', 'commands'), { recursive: true });
    await writeFile(
      join(repo, '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'job-hunt',
        version: '2.1.0',
        description: 'Job hunting workflows',
        author: { name: 'someone' },
      })
    );
    await writeFile(
      join(repo, '.claude', 'skills', 'job-hunt', 'SKILL.md'),
      '---\nname: job-hunt\ndescription: Router skill\n---\n\nRoute the request.\n'
    );
    const commandMd =
      '---\ndescription: Prep for an interview\nallowed-tools: Read, Bash(git:*)\n---\n\nPrep for: $ARGUMENTS\n';
    await writeFile(join(repo, '.claude', 'commands', 'prep.md'), commandMd);
    // Same command mirrored for another CLI — must not register twice.
    await writeFile(join(repo, '.opencode', 'commands', 'prep.md'), commandMd);
    gitIn(repo, 'init', '-q');
    gitIn(repo, 'add', '.');
    gitIn(repo, 'commit', '-q', '-m', 'initial');

    const installed = await installSkill(repo, skillsDir);
    expect(installed.manifest.name).toBe('job-hunt');
    expect(installed.manifest.version).toBe('2.1.0');
    expect(installed.manifest.author).toBe('someone');
    expect(installed.commands.map((command) => command.name).sort()).toEqual([
      'job-hunt',
      'prep',
    ]);
    // Claude tool names are translated to this runtime's tool names.
    const prep = installed.commands.find((c) => c.name === 'prep');
    expect(prep?.tools).toEqual(['read_file', 'bash']);
    expect(installed.errors).toEqual([]);

    // The adapted skill round-trips through discovery, update, and removal.
    const discovered = await discoverSkills(skillsDir);
    expect(discovered.skills.map((skill) => skill.manifest.name)).toEqual([
      'job-hunt',
    ]);
    await updateSkill('job-hunt', skillsDir);
    await removeSkill('job-hunt', skillsDir);
  });

  it('adapts a bare repo with only a root SKILL.md, named after the repo', async () => {
    const repo = join(workDir, 'bare-skill');
    await mkdir(repo, { recursive: true });
    await writeFile(
      join(repo, 'SKILL.md'),
      '---\ndescription: One-file skill\n---\n\nDo the thing.\n'
    );
    gitIn(repo, 'init', '-q');
    gitIn(repo, 'add', '.');
    gitIn(repo, 'commit', '-q', '-m', 'initial');

    const installed = await installSkill(repo, skillsDir);
    expect(installed.manifest.name).toBe('bare-skill');
    expect(installed.manifest.version).toBe('0.0.0');
    expect(installed.commands.map((command) => command.name)).toEqual([
      'bare-skill',
    ]);
  });

  it('updates an installed skill via git pull', async () => {
    const repo = await createSkillRepo();
    await installSkill(repo, skillsDir);

    // Publish a new version with an extra command.
    await writeFile(
      join(repo, 'justcode.json'),
      JSON.stringify({
        name: 'test-skill',
        version: '1.1.0',
        commands: ['commands/scan.md', 'commands/pdf.md'],
      })
    );
    await writeFile(join(repo, 'commands', 'pdf.md'), 'Make a PDF.');
    gitIn(repo, 'add', '.');
    gitIn(repo, 'commit', '-q', '-m', 'v1.1.0');

    const updated = await updateSkill('test-skill', skillsDir);
    expect(updated.manifest.version).toBe('1.1.0');
    expect(updated.commands.map((command) => command.name)).toEqual([
      'scan',
      'pdf',
    ]);
  });

  it('errors cleanly when updating or removing a missing skill', async () => {
    await expect(updateSkill('nope', skillsDir)).rejects.toThrow(
      'not installed'
    );
    await expect(removeSkill('nope', skillsDir)).rejects.toThrow(
      'not installed'
    );
  });
});

describe('discoverAllSkills', () => {
  it('merges scopes, tags them, and lets a local skill shadow a global one', async () => {
    const configDir = join(workDir, 'config');
    const workspaceRoot = join(workDir, 'project');
    const repo = await createSkillRepo();
    const otherRepo = await createSkillRepo('other-skill');

    // The same skill in both scopes, plus one global-only skill.
    await installSkill(repo, skillsDirectory(configDir));
    await installSkill(otherRepo, skillsDirectory(configDir));
    await installSkill(repo, localSkillsDirectory(workspaceRoot));

    const { skills, errors } = await discoverAllSkills({
      configDirectory: configDir,
      workspaceRoot,
    });
    expect(errors).toEqual([]);
    expect(skills.map((skill) => [skill.manifest.name, skill.scope])).toEqual([
      ['test-skill', 'local'],
      ['other-skill', 'global'],
    ]);
  });

  it('works without a workspace root (global scope only)', async () => {
    const configDir = join(workDir, 'config');
    const repo = await createSkillRepo();
    await installSkill(repo, skillsDirectory(configDir));

    const { skills } = await discoverAllSkills({ configDirectory: configDir });
    expect(skills.map((skill) => skill.scope)).toEqual(['global']);
  });
});
