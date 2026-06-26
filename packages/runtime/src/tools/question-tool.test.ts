import { describe, expect, it, vi } from 'vitest';

import { QuestionTool } from '@runtime/tools/question-tool';
import type { UserQuestionRequest } from '@core/ports/tool';

describe('QuestionTool', () => {
  const tool = new QuestionTool();

  const run = (
    args: Record<string, unknown>,
    askUser?: (request: UserQuestionRequest) => Promise<string>,
    signal?: AbortSignal
  ) =>
    tool.execute(JSON.stringify(args), {
      workspaceRoot: '/tmp',
      ...(askUser ? { askUser } : {}),
      ...(signal ? { signal } : {}),
    });

  it('asks the user and returns their answer', async () => {
    const askUser = vi.fn(async () => 'use postgres');

    const result = await run({ question: 'Which database?' }, askUser);

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('The user answered: use postgres');
    expect(askUser).toHaveBeenCalledWith({ question: 'Which database?' });
  });

  it('forwards normalized options to the prompt', async () => {
    const askUser = vi.fn(async () => 'Postgres');

    await run(
      { question: 'Which database?', options: ['Postgres', ' ', 'MySQL', 42] },
      askUser
    );

    expect(askUser).toHaveBeenCalledWith({
      question: 'Which database?',
      options: ['Postgres', 'MySQL'],
    });
  });

  it('reports when the user gives no answer', async () => {
    const result = await run({ question: 'Anything?' }, async () => '   ');

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('The user did not provide an answer.');
  });

  it('errors when no askUser callback is available', async () => {
    const result = await run({ question: 'Which database?' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-interactive');
  });

  it('rejects an empty question without prompting', async () => {
    const askUser = vi.fn(async () => 'x');

    const result = await run({ question: '   ' }, askUser);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-empty string');
    expect(askUser).not.toHaveBeenCalled();
  });

  it('rejects unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot: '/tmp' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
  });

  it('propagates an abort so the agentic loop can unwind', async () => {
    const abortError = new DOMException('aborted', 'AbortError');
    const askUser = vi.fn(() => Promise.reject(abortError));

    await expect(run({ question: 'Which?' }, askUser)).rejects.toBe(abortError);
  });

  it('summarizes the call for the UI, including options', () => {
    const view = tool.describe(
      JSON.stringify({ question: 'Pick one', options: ['a', 'b'] })
    );

    expect(view.title).toBe('question: Pick one');
    expect(view.preview).toBe('Pick one\n1. a\n2. b');
  });
});
