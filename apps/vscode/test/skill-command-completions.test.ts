import { describe, expect, it } from 'vitest';

import {
  filterSkillCommands,
  getActiveSlashQuery,
} from '@ext/webview/skill-command-completions';
import type { WebviewSkillCommand } from '@ext/shared/protocol';

function command(name: string): WebviewSkillCommand {
  return { name, skillName: 'test-skill' };
}

describe('getActiveSlashQuery', () => {
  it('is active only for a single leading /token', () => {
    expect(getActiveSlashQuery('/')).toBe('');
    expect(getActiveSlashQuery('/sc')).toBe('sc');
    expect(getActiveSlashQuery('/scan resume.pdf')).toBeUndefined();
    expect(getActiveSlashQuery('hello /scan')).toBeUndefined();
    expect(getActiveSlashQuery('plain text')).toBeUndefined();
  });
});

describe('filterSkillCommands', () => {
  const commands = [
    command('scan'),
    command('pdf'),
    command('tailor'),
    command('test-skill:review'),
  ];

  it('lists everything for an empty query', () => {
    expect(filterSkillCommands(commands, '')).toHaveLength(4);
  });

  it('ranks prefix over segment over substring matches', () => {
    expect(filterSkillCommands(commands, 'scan').map((c) => c.name)).toEqual([
      'scan',
    ]);
    // "review" prefixes the command segment of the namespaced form.
    expect(filterSkillCommands(commands, 'review').map((c) => c.name)).toEqual([
      'test-skill:review',
    ]);
    expect(filterSkillCommands(commands, 'zzz')).toEqual([]);
  });
});
