import { describe, expect, it } from 'vitest';

import { TodoWriteTool } from '@runtime/tools/todo-write-tool';

describe('TodoWriteTool', () => {
  const tool = new TodoWriteTool();

  function run(
    todos: unknown
  ): Promise<{ content: string; isError?: boolean }> {
    return tool.execute(JSON.stringify({ todos }));
  }

  it('requires approval', () => {
    expect(tool.requiresApproval).toBe(true);
  });

  it('renders the list with status markers', async () => {
    const result = await run([
      { content: 'design api', status: 'completed' },
      { content: 'write code', status: 'in_progress' },
      { content: 'add tests', status: 'pending' },
    ]);

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('[x] design api');
    expect(result.content).toContain('[~] write code');
    expect(result.content).toContain('[ ] add tests');
  });

  it('reports a cleared list for an empty array', async () => {
    const result = await run([]);
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('cleared');
  });

  it('summarizes progress in the describe() title', () => {
    const view = tool.describe(
      JSON.stringify({
        todos: [
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'pending' },
        ],
      })
    );
    expect(view.title).toBe('Update todos (1/2 done)');
    expect(view.preview).toContain('[x] a');
    expect(view.preview).toContain('[ ] b');
  });

  it('rejects an invalid status', async () => {
    const result = await run([{ content: 'x', status: 'doing' }]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('invalid "status"');
  });

  it('rejects empty content', async () => {
    const result = await run([{ content: '  ', status: 'pending' }]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-empty "content"');
  });

  it('rejects more than one in_progress item', async () => {
    const result = await run([
      { content: 'a', status: 'in_progress' },
      { content: 'b', status: 'in_progress' },
    ]);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('in progress');
  });

  it('rejects a non-array todos value', async () => {
    const result = await tool.execute(JSON.stringify({ todos: 'nope' }));
    expect(result.isError).toBe(true);
    expect(result.content).toContain('must be an array');
  });

  it('rejects unparseable arguments', async () => {
    const result = await tool.execute('not json');
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });
});
