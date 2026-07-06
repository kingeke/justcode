import { describe, expect, it } from 'vitest';

import {
  buildSkillCommandIndex,
  parseSkillCommand,
  parseSkillManifest,
  renderSkillCommandPrompt,
  type InstalledSkill,
  type SkillCommandDefinition,
} from '@core/domain/skill';

function makeCommand(
  name: string,
  extra: Partial<SkillCommandDefinition> = {}
): SkillCommandDefinition {
  return { name, body: `Run ${name}.`, path: `commands/${name}.md`, ...extra };
}

function makeSkill(
  name: string,
  commands: SkillCommandDefinition[]
): InstalledSkill {
  return {
    manifest: { name, version: '1.0.0' },
    commands,
    directory: `/skills/${name}`,
    errors: [],
  };
}

describe('parseSkillManifest', () => {
  it('accepts a minimal manifest and preserves unknown keys', () => {
    const manifest = parseSkillManifest(
      JSON.stringify({
        name: 'test-skill',
        version: '1.0.0',
        mcpServers: { foo: {} },
      })
    );
    expect(manifest.name).toBe('test-skill');
    expect(manifest.mcpServers).toEqual({ foo: {} });
  });

  it('rejects invalid JSON, bad names, and missing versions', () => {
    expect(() => parseSkillManifest('{nope')).toThrow('not valid JSON');
    expect(() =>
      parseSkillManifest(JSON.stringify({ name: 'Bad Name', version: '1' }))
    ).toThrow("needs a 'name'");
    expect(() => parseSkillManifest(JSON.stringify({ name: 'ok' }))).toThrow(
      "needs a 'version'"
    );
  });

  it('rejects command paths that escape the skill root', () => {
    expect(() =>
      parseSkillManifest(
        JSON.stringify({
          name: 'x',
          version: '1',
          commands: ['../outside.md'],
        })
      )
    ).toThrow('relative to the skill root');
    expect(() =>
      parseSkillManifest(
        JSON.stringify({ name: 'x', version: '1', commands: ['/etc/passwd'] })
      )
    ).toThrow('relative to the skill root');
  });
});

describe('parseSkillCommand', () => {
  it('parses frontmatter scalars, dash lists, and the body', () => {
    const command = parseSkillCommand(
      [
        '---',
        'name: scan',
        'description: Review a resume against a job description',
        'tools:',
        '  - read_file',
        '  - grep',
        'model: auto',
        "argument-hint: '<resume> [jd]'",
        '---',
        '',
        '# Resume Scan',
        '',
        'You are an experienced recruiter.',
      ].join('\n'),
      'scan',
      'commands/scan.md'
    );
    expect(command.name).toBe('scan');
    expect(command.description).toBe(
      'Review a resume against a job description'
    );
    expect(command.tools).toEqual(['read_file', 'grep']);
    expect(command.model).toBe('auto');
    expect(command.argumentHint).toBe('<resume> [jd]');
    expect(command.body).toContain('You are an experienced recruiter.');
    expect(command.body).not.toContain('---');
  });

  it('parses inline [a, b] lists', () => {
    const command = parseSkillCommand(
      '---\ntools: [read_file, edit_file]\n---\nBody.',
      'fix',
      'commands/fix.md'
    );
    expect(command.tools).toEqual(['read_file', 'edit_file']);
  });

  it('falls back to the file name when frontmatter has no name', () => {
    const command = parseSkillCommand('Just a body.', 'pdf', 'commands/pdf.md');
    expect(command.name).toBe('pdf');
    expect(command.body).toBe('Just a body.');
  });

  it('maps Claude-convention allowed-tools onto JustCode tool names', () => {
    const fromList = parseSkillCommand(
      '---\nallowed-tools:\n  - Read\n  - "Bash(git add:*)"\n  - Grep\n  - SomethingUnknown\n---\nBody.',
      'prep',
      'commands/prep.md'
    );
    expect(fromList.tools).toEqual(['read_file', 'bash', 'grep']);

    const fromInline = parseSkillCommand(
      '---\nallowed-tools: Read, Edit, WebFetch\n---\nBody.',
      'prep',
      'commands/prep.md'
    );
    expect(fromInline.tools).toEqual(['read_file', 'edit_file', 'webfetch']);
  });

  it('slugifies a salvageable command name instead of rejecting it', () => {
    const command = parseSkillCommand(
      '---\nname: Scan ATS\n---\nBody.',
      'scan',
      'commands/scan.md'
    );
    expect(command.name).toBe('scan-ats');
  });

  it('rejects an empty body', () => {
    expect(() =>
      parseSkillCommand('---\nname: scan\n---\n', 'scan', 'commands/scan.md')
    ).toThrow('empty body');
  });

  it('slugifies the reserved namespace separator out of a name', () => {
    const command = parseSkillCommand(
      '---\nname: a:b\n---\nBody',
      'a',
      'commands/a.md'
    );
    expect(command.name).toBe('a-b');
  });
});

describe('buildSkillCommandIndex', () => {
  it('grants unique names their bare alias and always the qualified form', () => {
    const index = buildSkillCommandIndex([
      makeSkill('test-skill', [makeCommand('scan')]),
    ]);
    expect(index.collisions).toEqual([]);
    expect(index.resolve('scan')?.qualifiedName).toBe('test-skill:scan');
    expect(index.resolve('test-skill:scan')?.command.name).toBe('scan');
  });

  it('drops the bare alias (and reports a collision) for contested names', () => {
    const index = buildSkillCommandIndex([
      makeSkill('alpha', [makeCommand('review')]),
      makeSkill('beta', [makeCommand('review')]),
    ]);
    expect(index.resolve('review')).toBeUndefined();
    expect(index.resolve('alpha:review')?.skillName).toBe('alpha');
    expect(index.resolve('beta:review')?.skillName).toBe('beta');
    expect(index.collisions).toEqual([
      { name: 'review', claimedBy: ['alpha', 'beta'] },
    ]);
  });

  it('lets built-in names win: the skill command is namespaced only', () => {
    const index = buildSkillCommandIndex(
      [makeSkill('alpha', [makeCommand('models')])],
      ['models']
    );
    expect(index.resolve('models')).toBeUndefined();
    expect(index.resolve('alpha:models')).toBeDefined();
    expect(index.collisions).toEqual([
      { name: 'models', claimedBy: ['built-in', 'alpha'] },
    ]);
  });
});

describe('renderSkillCommandPrompt', () => {
  it('substitutes $ARGUMENTS when the body uses it', () => {
    const command = makeCommand('scan', {
      body: 'Review $ARGUMENTS carefully.',
    });
    expect(renderSkillCommandPrompt(command, 'resume.pdf jd.md')).toBe(
      'Review resume.pdf jd.md carefully.'
    );
    expect(renderSkillCommandPrompt(command, '')).toBe(
      'Review (no arguments given) carefully.'
    );
  });

  it('returns the body untouched when there is no placeholder', () => {
    const command = makeCommand('scan');
    expect(renderSkillCommandPrompt(command, 'extra args')).toBe('Run scan.');
  });
});
