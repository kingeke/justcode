import { describe, expect, it } from 'vitest';

import { QuestionWizardPhase } from '@core/domain/question-wizard';
import type { UserQuestionRequest } from '@core/ports/tool';
import {
  answerRows,
  answeredSummary,
  createWizard,
  currentOptions,
  isCustomRow,
  isSubmitSelection,
  reduceWizard,
  rowCount,
  shouldAutoSubmit,
  wizardAnswers,
  QuestionWizardActionType,
  type QuestionWizardAction,
  type QuestionWizardState,
} from '@cli/ui/question-wizard';

const request: UserQuestionRequest = {
  questions: [
    { id: 'q1', question: 'How many guests?', options: ['2', '4-6'] },
    { id: 'q2', question: 'Any allergies?' },
    { id: 'q3', question: 'Budget?', options: ['low', 'high'] },
  ],
};

const apply = (
  state: QuestionWizardState,
  ...actions: QuestionWizardAction[]
): QuestionWizardState => actions.reduce(reduceWizard, state);

describe('question wizard', () => {
  it('starts on the first question with the custom row highlighted', () => {
    const state = createWizard(request);

    expect(state.phase).toBe(QuestionWizardPhase.Answering);
    expect(state.index).toBe(0);
    expect(currentOptions(state)).toEqual(['2', '4-6']);
    // Options plus the "type your own" row.
    expect(rowCount(state)).toBe(3);
    expect(state.selection).toBe(0);
    expect(isCustomRow(state)).toBe(false);
  });

  it('wraps the selection around the rows', () => {
    const state = apply(createWizard(request), {
      type: QuestionWizardActionType.MoveSelection,
      delta: 1,
    });

    expect(state.selection).toBe(1);
    // Past the last option sits the "type your own" row, then it wraps.
    const custom = apply(state, {
      type: QuestionWizardActionType.MoveSelection,
      delta: 1,
    });
    expect(isCustomRow(custom)).toBe(true);
    expect(
      apply(custom, { type: QuestionWizardActionType.MoveSelection, delta: 1 })
        .selection
    ).toBe(0);
  });

  it('answers by option number and advances to the next question', () => {
    const state = apply(createWizard(request), {
      type: QuestionWizardActionType.Choose,
      index: 1,
    });

    expect(state.answers).toEqual({ q1: '4-6' });
    expect(state.index).toBe(1);
    expect(state.phase).toBe(QuestionWizardPhase.Answering);
  });

  it('commits a typed answer, expanding a bare option number', () => {
    const typed = apply(
      createWizard(request),
      { type: QuestionWizardActionType.StartCustom },
      { type: QuestionWizardActionType.CommitCustom, draft: ' 2 ' }
    );

    expect(typed.answers).toEqual({ q1: '4-6' });

    const free = apply(typed, {
      type: QuestionWizardActionType.CommitCustom,
      draft: 'peanuts',
    });

    expect(free.answers).toEqual({ q1: '4-6', q2: 'peanuts' });
    expect(free.index).toBe(2);
  });

  it('treats Enter on an empty custom box as a no-op, not a blank answer', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.StartCustom },
      { type: QuestionWizardActionType.CommitCustom, draft: '   ' }
    );

    expect(state.phase).toBe(QuestionWizardPhase.Answering);
    expect(state.index).toBe(0);
    expect(state.answers).toEqual({});
  });

  it('cancels a custom answer back to the option list', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.StartCustom },
      { type: QuestionWizardActionType.SetDraft, draft: 'abc' },
      { type: QuestionWizardActionType.CancelCustom }
    );

    expect(state.phase).toBe(QuestionWizardPhase.Answering);
    expect(state.draft).toBe('');
    expect(state.answers).toEqual({});
  });

  it('steps back to the previous question, re-highlighting its answer', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Choose, index: 0 },
      { type: QuestionWizardActionType.Previous }
    );

    expect(state.index).toBe(0);
    expect(state.selection).toBe(0);
    expect(isCustomRow(state)).toBe(false);
  });

  it('lands on the review screen after the last question', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Next }
    );

    expect(state.phase).toBe(QuestionWizardPhase.Review);
    // One row per question plus the submit row, which is preselected.
    expect(rowCount(state)).toBe(4);
    expect(isSubmitSelection(state)).toBe(true);
    expect(shouldAutoSubmit(state)).toBe(false);
  });

  it('edits a question from the review screen and returns to review', () => {
    const reviewing = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Choose, index: 0 },
      { type: QuestionWizardActionType.CommitCustom, draft: 'none' },
      { type: QuestionWizardActionType.Choose, index: 1 }
    );
    expect(reviewing.phase).toBe(QuestionWizardPhase.Review);

    const editing = apply(reviewing, {
      type: QuestionWizardActionType.Choose,
      index: 1,
    });

    expect(editing.phase).toBe(QuestionWizardPhase.Answering);
    expect(editing.index).toBe(1);

    // Committing resumes the forward flow from there; Next then re-reviews.
    const back = apply(
      editing,
      { type: QuestionWizardActionType.CommitCustom, draft: 'shellfish' },
      { type: QuestionWizardActionType.Next }
    );

    expect(back.phase).toBe(QuestionWizardPhase.Review);
    expect(wizardAnswers(back)).toEqual([
      { id: 'q1', answer: '2' },
      { id: 'q2', answer: 'shellfish' },
      { id: 'q3', answer: 'high' },
    ]);
  });

  it('reports skipped questions as empty answers', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Choose, index: 0 }
    );

    expect(wizardAnswers(state)).toEqual([
      { id: 'q1', answer: '' },
      { id: 'q2', answer: '' },
      { id: 'q3', answer: 'low' },
    ]);
  });

  it('auto-submits a lone question instead of showing a review step', () => {
    const single = createWizard({
      questions: [{ id: 'q1', question: 'Proceed?', options: ['yes', 'no'] }],
    });

    const state = apply(single, {
      type: QuestionWizardActionType.Choose,
      index: 0,
    });

    expect(shouldAutoSubmit(state)).toBe(true);
    expect(wizardAnswers(state)).toEqual([{ id: 'q1', answer: 'yes' }]);
  });

  it('marks the chosen option when stepping back to a question', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Choose, index: 1 },
      { type: QuestionWizardActionType.Previous }
    );

    expect(answerRows(state)).toEqual([
      { label: '1. 2', cursor: false, chosen: false },
      { label: '2. 4-6', cursor: true, chosen: true },
      { label: '✎ Type your own answer', cursor: false, chosen: false },
    ]);

    // Moving the cursor away keeps the chosen answer marked.
    const moved = apply(state, {
      type: QuestionWizardActionType.MoveSelection,
      delta: -1,
    });
    expect(moved.selection).toBe(0);
    expect(answerRows(moved)[1]).toEqual({
      label: '2. 4-6',
      cursor: false,
      chosen: true,
    });
  });

  it('shows a typed answer back on the custom row', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.CommitCustom, draft: 'about ten' },
      { type: QuestionWizardActionType.Previous }
    );

    expect(answerRows(state).at(-1)).toEqual({
      label: '✎ Your answer: about ten',
      cursor: true,
      chosen: true,
    });
  });

  it('summarizes the answers given to the other questions', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Choose, index: 1 },
      { type: QuestionWizardActionType.CommitCustom, draft: 'peanuts' }
    );

    // The current question (q3) is excluded — its own rows carry the mark.
    expect(answeredSummary(state)).toEqual([
      { id: 'q1', position: 1, question: 'How many guests?', answer: '4-6' },
      { id: 'q2', position: 2, question: 'Any allergies?', answer: 'peanuts' },
    ]);
  });

  it('goes back from review to the last question', () => {
    const state = apply(
      createWizard(request),
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Next },
      { type: QuestionWizardActionType.Previous }
    );

    expect(state.phase).toBe(QuestionWizardPhase.Answering);
    expect(state.index).toBe(2);
  });
});
