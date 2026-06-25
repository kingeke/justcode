import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { BashTool } from '@runtime/tools/bash-tool';

describe('BashTool', () => {
  let workspaceRoot: string;
  let tool: BashTool;

  beforeEach(async () => {
    workspaceRoot = await mkdtemp(join(tmpdir(), 'justcode-bash-'));
    tool = new BashTool();
  });

  afterEach(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  const run = (args: Record<string, unknown>, signal?: AbortSignal) =>
    tool.execute(JSON.stringify(args), {
      workspaceRoot,
      ...(signal ? { signal } : {}),
    });

  it('runs a command and returns its stdout', async () => {
    const result = await run({ command: 'echo hello' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('hello');
  });

  it('captures stderr as well as stdout', async () => {
    const result = await run({ command: 'echo oops 1>&2' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('oops');
  });

  it('runs in the workspace root', async () => {
    await writeFile(join(workspaceRoot, 'marker.txt'), 'x', 'utf8');

    const result = await run({ command: 'ls' });

    expect(result.content).toContain('marker.txt');
  });

  it('honors pipes and shell operators', async () => {
    const result = await run({ command: 'echo a && echo b | cat' });

    expect(result.content).toContain('a');
    expect(result.content).toContain('b');
  });

  it('reports a non-zero exit code as an error', async () => {
    const result = await run({ command: 'exit 3' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('exit code 3');
  });

  it('kills a command that exceeds its timeout', async () => {
    const result = await run({ command: 'sleep 5', timeout: 50 });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('timed out');
  });

  it('stops a command when the signal is aborted', async () => {
    const controller = new AbortController();
    const pending = run({ command: 'sleep 5' }, controller.signal);
    controller.abort();

    const result = await pending;
    expect(result.isError).toBe(true);
    expect(result.content).toContain('cancelled');
  });

  it('truncates very large output', async () => {
    const result = await run({
      command: 'for i in $(seq 1 100000); do echo aaaaaaaaaa; done',
    });

    expect(result.content).toContain('output truncated');
  });

  it('returns an error for unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot });

    expect(result.isError).toBe(true);
  });

  it('returns an error for an empty command', async () => {
    const result = await run({ command: '   ' });

    expect(result.isError).toBe(true);
  });

  it('requires approval', () => {
    expect(tool.requiresApproval).toBe(true);
  });
});
