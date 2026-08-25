import { describe, expect, it, vi } from 'vitest';

import { QuestionTool } from '@runtime/tools/question-tool';
import type { UserQuestionAnswer, UserQuestionRequest } from '@core/ports/tool';

describe('QuestionTool', () => {
  const tool = new QuestionTool();

  const run = (
    args: Record<string, unknown>,
    askUser?: (request: UserQuestionRequest) => Promise<UserQuestionAnswer[]>,
    signal?: AbortSignal
  ) =>
    tool.execute(JSON.stringify(args), {
      workspaceRoot: '/tmp',
      ...(askUser ? { askUser } : {}),
      ...(signal ? { signal } : {}),
    });

  it('asks a single question and returns the answer', async () => {
    const askUser = vi.fn(async () => [{ id: 'q1', answer: 'use postgres' }]);

    const result = await run(
      { questions: [{ question: 'Which database?' }] },
      askUser
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe(
      'The user answered:\n1. Which database? → use postgres'
    );
    expect(askUser).toHaveBeenCalledWith({
      questions: [{ id: 'q1', question: 'Which database?' }],
    });
  });

  it('asks several questions in one call and pairs up the answers', async () => {
    const askUser = vi.fn(async () => [
      { id: 'q1', answer: 'Postgres' },
      { id: 'q2', answer: '' },
      { id: 'q3', answer: 'Yes' },
    ]);

    const result = await run(
      {
        questions: [
          { question: 'Which database?', options: ['Postgres', 'MySQL'] },
          { question: 'Which region?' },
          { question: 'Enable backups?', options: ['Yes', 'No'] },
        ],
      },
      askUser
    );

    expect(askUser).toHaveBeenCalledWith({
      questions: [
        {
          id: 'q1',
          question: 'Which database?',
          options: ['Postgres', 'MySQL'],
        },
        { id: 'q2', question: 'Which region?' },
        { id: 'q3', question: 'Enable backups?', options: ['Yes', 'No'] },
      ],
    });
    expect(result.content).toBe(
      [
        'The user answered:',
        '1. Which database? → Postgres',
        '2. Which region? → (skipped)',
        '3. Enable backups? → Yes',
      ].join('\n')
    );
  });

  it('normalizes options: trims, drops blanks/non-strings, dedupes, caps at 8', async () => {
    const askUser = vi.fn(async () => [{ id: 'q1', answer: 'a' }]);

    await run(
      {
        questions: [
          {
            question: 'Pick',
            options: [
              ' a ',
              '',
              42,
              'a',
              'b',
              'c',
              'd',
              'e',
              'f',
              'g',
              'h',
              'i',
            ],
          },
        ],
      },
      askUser
    );

    expect(askUser).toHaveBeenCalledWith({
      questions: [
        {
          id: 'q1',
          question: 'Pick',
          options: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        },
      ],
    });
  });

  it('reports when the user answered nothing', async () => {
    const result = await run(
      { questions: [{ question: 'Anything?' }] },
      async () => [{ id: 'q1', answer: '   ' }]
    );

    expect(result.isError).toBeFalsy();
    expect(result.content).toBe('The user did not provide any answers.');
  });

  it('errors when no askUser callback is available', async () => {
    const result = await run({ questions: [{ question: 'Which database?' }] });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-interactive');
  });

  it('rejects a batch with no usable question without prompting', async () => {
    const askUser = vi.fn(async () => []);

    const result = await run({ questions: [{ question: '   ' }] }, askUser);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('at least one');
    expect(askUser).not.toHaveBeenCalled();
  });

  it('rejects more than five questions without prompting', async () => {
    const askUser = vi.fn(async () => []);

    const result = await run(
      {
        questions: Array.from({ length: 6 }, (_, index) => ({
          question: `Q${index}`,
        })),
      },
      askUser
    );

    expect(result.isError).toBe(true);
    expect(result.content).toContain('at most 5 questions');
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

    await expect(
      run({ questions: [{ question: 'Which?' }] }, askUser)
    ).rejects.toBe(abortError);
  });

  it('summarizes the call for the UI, including options', () => {
    const view = tool.describe(
      JSON.stringify({
        questions: [
          { question: 'Pick one', options: ['a', 'b'] },
          { question: 'And another' },
        ],
      })
    );

    expect(view.title).toBe('question: Pick one (+1 more)');
    expect(view.preview).toBe('1. Pick one\n   - a\n   - b\n2. And another');
  });
});
