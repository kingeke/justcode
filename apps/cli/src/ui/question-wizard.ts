import { QuestionWizardPhase } from '@core/domain/question-wizard';
import type { UserQuestionAnswer, UserQuestionRequest } from '@core/ports/tool';

/** Actions the CLI key handler dispatches into the question wizard. */
export enum QuestionWizardActionType {
  MoveSelection = 'moveSelection',
  Choose = 'choose',
  StartCustom = 'startCustom',
  SetDraft = 'setDraft',
  CommitCustom = 'commitCustom',
  CancelCustom = 'cancelCustom',
  Next = 'next',
  Previous = 'previous',
}

export type QuestionWizardAction =
  | { type: QuestionWizardActionType.MoveSelection; delta: number }
  | { type: QuestionWizardActionType.Choose; index?: number }
  | { type: QuestionWizardActionType.StartCustom }
  | { type: QuestionWizardActionType.SetDraft; draft: string }
  | { type: QuestionWizardActionType.CommitCustom; draft: string }
  | { type: QuestionWizardActionType.CancelCustom }
  | { type: QuestionWizardActionType.Next }
  | { type: QuestionWizardActionType.Previous };

export interface QuestionWizardState {
  request: UserQuestionRequest;
  phase: QuestionWizardPhase;
  /** Index of the question being answered (or edited from the review step). */
  index: number;
  /** Answer per question id; missing/empty means "skipped". */
  answers: Record<string, string>;
  /** Highlighted row: an option index, the custom row, or a review row. */
  selection: number;
  /** In-flight custom answer text (mirrors the prompt textarea). */
  draft: string;
}

/**
 * True when the wizard's submit action should fire: the user pressed Enter on
 * the review screen's "Submit" row, or answered the only question.
 */
export function isSubmitSelection(state: QuestionWizardState): boolean {
  return (
    state.phase === QuestionWizardPhase.Review &&
    state.selection === state.request.questions.length
  );
}

/**
 * A lone question keeps today's behaviour: answering it submits straight away
 * instead of showing a one-row review screen.
 */
export function shouldAutoSubmit(state: QuestionWizardState): boolean {
  return (
    state.phase === QuestionWizardPhase.Review &&
    state.request.questions.length === 1
  );
}

export function createWizard(
  request: UserQuestionRequest
): QuestionWizardState {
  return {
    request,
    phase: QuestionWizardPhase.Answering,
    index: 0,
    answers: {},
    selection: 0,
    draft: '',
  };
}

/** Number of selectable rows on the current screen. */
export function rowCount(state: QuestionWizardState): number {
  if (state.phase === QuestionWizardPhase.Review) {
    // One row per question, plus the submit row.
    return state.request.questions.length + 1;
  }
  // Options plus the "type your own answer" row.
  return currentOptions(state).length + 1;
}

/** The options of the question currently on screen. */
export function currentOptions(state: QuestionWizardState): string[] {
  return state.request.questions[state.index]?.options ?? [];
}

/** True when the highlighted row is the "type your own answer" row. */
export function isCustomRow(state: QuestionWizardState): boolean {
  return (
    state.phase === QuestionWizardPhase.Answering &&
    state.selection === currentOptions(state).length
  );
}

/** The answers to hand back to the tool, in question order. */
export function wizardAnswers(
  state: QuestionWizardState
): UserQuestionAnswer[] {
  return state.request.questions.map((question) => ({
    id: question.id,
    answer: state.answers[question.id] ?? '',
  }));
}

/** A question already answered, summarised above the one being asked. */
export interface AnsweredSummaryEntry {
  id: string;
  /** 1-based position of the question in the batch. */
  position: number;
  question: string;
  answer: string;
}

/**
 * The questions answered so far, excluding the one on screen (its own answer is
 * marked on its rows). Keeps the user's picks visible as the flow moves on.
 */
export function answeredSummary(
  state: QuestionWizardState
): AnsweredSummaryEntry[] {
  const entries: AnsweredSummaryEntry[] = [];
  state.request.questions.forEach((question, index) => {
    if (index === state.index) return;
    const answer = state.answers[question.id] ?? '';
    if (answer.length === 0) return;
    entries.push({
      id: question.id,
      position: index + 1,
      question: question.question,
      answer,
    });
  });
  return entries;
}

/** A selectable row of the answering screen, ready to render. */
export interface QuestionWizardRow {
  /** Row text, without the cursor/chosen markers. */
  label: string;
  /** True when the ❯ cursor sits on this row. */
  cursor: boolean;
  /** True when this row is the answer already given for the question. */
  chosen: boolean;
}

/**
 * The rows of the current question: its options followed by the custom-answer
 * row. `chosen` marks the answer already given, so stepping back to a question
 * shows what was picked no matter where the cursor sits.
 */
export function answerRows(state: QuestionWizardState): QuestionWizardRow[] {
  const options = currentOptions(state);
  const question = state.request.questions[state.index];
  const answer = question ? (state.answers[question.id] ?? '') : '';
  const typing = state.phase === QuestionWizardPhase.CustomInput;
  const rows: QuestionWizardRow[] = options.map((option, index) => ({
    label: `${index + 1}. ${option}`,
    cursor: !typing && state.selection === index,
    chosen: option === answer,
  }));
  // A typed answer (anything that isn't one of the options) belongs to the
  // custom row, which shows it back instead of the generic invitation.
  const typed = answer.length > 0 && !options.includes(answer) ? answer : '';
  rows.push({
    label: typed ? `✎ Your answer: ${typed}` : '✎ Type your own answer',
    cursor: typing || isCustomRow(state),
    chosen: typed.length > 0,
  });
  return rows;
}

export function reduceWizard(
  state: QuestionWizardState,
  action: QuestionWizardAction
): QuestionWizardState {
  switch (action.type) {
    case QuestionWizardActionType.MoveSelection: {
      if (state.phase === QuestionWizardPhase.CustomInput) return state;
      const total = rowCount(state);
      const next = (state.selection + action.delta + total) % total;
      return { ...state, selection: next };
    }

    case QuestionWizardActionType.Choose: {
      if (state.phase === QuestionWizardPhase.CustomInput) return state;
      if (state.phase === QuestionWizardPhase.Review) {
        // Enter on a question row re-opens it for editing; the submit row is
        // handled by the caller (see isSubmitSelection).
        const target = action.index ?? state.selection;
        if (target >= state.request.questions.length) return state;
        return enterQuestion(state, target);
      }
      const options = currentOptions(state);
      const target = action.index ?? state.selection;
      const option = options[target];
      if (option === undefined) {
        // The custom row (or an out-of-range number key): start typing.
        return startCustom(state);
      }
      const question = state.request.questions[state.index];
      if (!question) return state;
      return advance({
        ...state,
        answers: { ...state.answers, [question.id]: option },
      });
    }

    case QuestionWizardActionType.StartCustom:
      return startCustom(state);

    case QuestionWizardActionType.SetDraft:
      return { ...state, draft: action.draft };

    case QuestionWizardActionType.CommitCustom: {
      const question = state.request.questions[state.index];
      if (!question) return state;
      const answer = action.draft.trim();
      // Enter on an empty box is a no-op, not an answer: it backs out to the
      // option list instead of recording a blank ("not answered").
      if (answer.length === 0) {
        return {
          ...state,
          phase: QuestionWizardPhase.Answering,
          draft: '',
        };
      }
      const expanded = expandOptionNumber(state, answer);
      return advance({
        ...state,
        phase: QuestionWizardPhase.Answering,
        draft: '',
        answers: { ...state.answers, [question.id]: expanded },
      });
    }

    case QuestionWizardActionType.CancelCustom:
      return {
        ...state,
        phase: QuestionWizardPhase.Answering,
        draft: '',
      };

    case QuestionWizardActionType.Next:
      if (state.phase === QuestionWizardPhase.Review) return state;
      return advance(state);

    case QuestionWizardActionType.Previous: {
      if (state.phase === QuestionWizardPhase.Review) {
        return enterQuestion(state, state.request.questions.length - 1);
      }
      if (state.index === 0) return state;
      return enterQuestion(state, state.index - 1);
    }

    default:
      return state;
  }
}

/** Moves to the next question, or to the review screen after the last one. */
function advance(state: QuestionWizardState): QuestionWizardState {
  const isLast = state.index >= state.request.questions.length - 1;
  if (!isLast) {
    return enterQuestion(state, state.index + 1);
  }
  return {
    ...state,
    phase: QuestionWizardPhase.Review,
    draft: '',
    // Land on the submit row so a straight run of Enters completes the flow.
    selection: state.request.questions.length,
  };
}

/** Opens a question for answering, highlighting its existing answer if any. */
function enterQuestion(
  state: QuestionWizardState,
  index: number
): QuestionWizardState {
  const question = state.request.questions[index];
  const options = question?.options ?? [];
  const existing = question ? (state.answers[question.id] ?? '') : '';
  const selected = options.indexOf(existing);
  return {
    ...state,
    phase: QuestionWizardPhase.Answering,
    index,
    draft: '',
    // Existing pick stays highlighted; a custom answer highlights the custom
    // row so Enter re-opens it for editing. Otherwise start at the top (which,
    // for a question with no options, is the custom row).
    selection:
      selected >= 0 ? selected : existing.length > 0 ? options.length : 0,
  };
}

function startCustom(state: QuestionWizardState): QuestionWizardState {
  const question = state.request.questions[state.index];
  const existing = question ? (state.answers[question.id] ?? '') : '';
  const options = currentOptions(state);
  return {
    ...state,
    phase: QuestionWizardPhase.CustomInput,
    selection: options.length,
    // Re-editing a custom answer starts from it; a picked option doesn't seed
    // the draft (the user chose the custom row to write something else).
    draft: options.includes(existing) ? '' : existing,
  };
}

/** "2" answers the second option when options were offered. */
function expandOptionNumber(
  state: QuestionWizardState,
  answer: string
): string {
  const options = currentOptions(state);
  if (options.length === 0 || !/^\d+$/.test(answer)) return answer;
  const index = Number.parseInt(answer, 10) - 1;
  return options[index] ?? answer;
}
