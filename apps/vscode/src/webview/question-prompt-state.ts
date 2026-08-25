import type { WebviewQuestion } from '@ext/shared/protocol';

/** A question already answered, summarised above the one being asked. */
export interface AnsweredEntry {
  id: string;
  /** 1-based position of the question in the batch. */
  position: number;
  question: string;
  answer: string;
}

/**
 * The questions answered so far, excluding the one on screen (its own option is
 * marked instead). Keeps the user's picks visible as the flow moves on, which
 * is the only feedback that choosing an option registered.
 */
export function answeredEntries(
  questions: WebviewQuestion[],
  answers: Record<string, string>,
  currentIndex: number
): AnsweredEntry[] {
  const entries: AnsweredEntry[] = [];
  questions.forEach((question, index) => {
    if (index === currentIndex) return;
    const answer = answers[question.id] ?? '';
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

/**
 * The text to restore into the free-text box when a question is re-opened: a
 * picked option shows as a marked button instead, so only a typed answer comes
 * back into the input.
 */
export function draftFor(
  question: WebviewQuestion | undefined,
  answers: Record<string, string>
): string {
  if (!question) return '';
  const existing = answers[question.id] ?? '';
  return question.options?.includes(existing) ? '' : existing;
}

/** True when this option is the answer already recorded for the question. */
export function isChosenOption(
  question: WebviewQuestion,
  answers: Record<string, string>,
  option: string
): boolean {
  return answers[question.id] === option;
}
