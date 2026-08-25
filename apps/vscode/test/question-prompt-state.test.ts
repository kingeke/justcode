import { describe, expect, it } from 'vitest';

import type { WebviewQuestion } from '@ext/shared/protocol';
import {
  answeredEntries,
  draftFor,
  isChosenOption,
} from '@ext/webview/question-prompt-state';

const questions: WebviewQuestion[] = [
  { id: 'q1', question: 'How many guests?', options: ['2', '4-6'] },
  { id: 'q2', question: 'Any allergies?' },
  { id: 'q3', question: 'Budget?', options: ['low', 'high'] },
];

describe('question prompt state', () => {
  it('summarises the answers given to the other questions', () => {
    const entries = answeredEntries(questions, { q1: '4-6', q2: 'peanuts' }, 1);

    // The question on screen (q2) is excluded — its own option is marked.
    expect(entries).toEqual([
      { id: 'q1', position: 1, question: 'How many guests?', answer: '4-6' },
    ]);
  });

  it('lists nothing before anything is answered', () => {
    expect(answeredEntries(questions, {}, 0)).toEqual([]);
  });

  it('marks the chosen option when a question is re-opened', () => {
    const answers = { q1: '4-6' };
    const question = questions[0]!;

    expect(isChosenOption(question, answers, '4-6')).toBe(true);
    expect(isChosenOption(question, answers, '2')).toBe(false);
  });

  it('restores only a typed answer into the free-text box', () => {
    // A picked option is shown as a marked button instead.
    expect(draftFor(questions[0], { q1: '4-6' })).toBe('');
    expect(draftFor(questions[0], { q1: 'about ten' })).toBe('about ten');
    expect(draftFor(questions[1], { q2: 'peanuts' })).toBe('peanuts');
    expect(draftFor(questions[1], {})).toBe('');
    expect(draftFor(undefined, {})).toBe('');
  });
});
