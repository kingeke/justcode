import * as React from 'react';

import type {
  ApprovalRequestMessage,
  UserInputRequestMessage,
  WebviewQuestionAnswer,
} from '@ext/shared/protocol';
import { QuestionWizardPhase } from '@core/domain/question-wizard';
import {
  answeredEntries,
  draftFor,
  isChosenOption,
} from '@ext/webview/question-prompt-state';
import { DiffView } from '@ext/webview/components/DiffView';
import { renderMarkdown, renderMarkdownInline } from '@ext/webview/markdown';

/** Inline gate shown when a tool needs the user's approval before running. */
export function ApprovalPrompt({
  request,
  onRespond,
  onApproveAll,
}: {
  request: ApprovalRequestMessage;
  onRespond: (approved: boolean) => void;
  /** Approve this tool and turn on auto-approve for the rest of the session. */
  onApproveAll: () => void;
}): React.JSX.Element {
  return (
    <div className="prompt prompt-approval">
      <div className="prompt-head">
        Allow <strong>{request.toolName}</strong>?
      </div>
      <div className="prompt-title">{request.view.title}</div>
      {request.view.preview ? (
        <pre className="tool-preview">{request.view.preview}</pre>
      ) : null}
      {request.view.diff ? <DiffView diff={request.view.diff} /> : null}
      <div className="prompt-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onRespond(true)}
        >
          Approve
        </button>
        <button type="button" className="btn" onClick={() => onRespond(false)}>
          Reject
        </button>
        <button
          type="button"
          className="btn"
          title="Approve this and stop asking — auto-approves all tools for the session"
          onClick={onApproveAll}
        >
          Approve all tools
        </button>
      </div>
    </div>
  );
}

/**
 * Inline step-through flow for the batch of questions a tool asked mid-turn:
 * one question at a time (pick an option or type your own), with back/next and
 * a review step that can jump back to edit any answer before submitting.
 */
export function InputPrompt({
  request,
  onRespond,
}: {
  request: UserInputRequestMessage;
  onRespond: (answers: WebviewQuestionAnswer[]) => void;
}): React.JSX.Element {
  const questions = request.questions;
  const total = questions.length;
  const [phase, setPhase] = React.useState(QuestionWizardPhase.Answering);
  const [index, setIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [draft, setDraft] = React.useState('');

  const question = questions[index];
  const collect = (source: Record<string, string>): WebviewQuestionAnswer[] =>
    questions.map((item) => ({ id: item.id, answer: source[item.id] ?? '' }));

  // Moves past the current question: to the next one, or to the review step
  // after the last. A lone question submits straight away, as before.
  const advance = (next: Record<string, string>): void => {
    setDraft('');
    if (index < total - 1) {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      setDraft(next[questions[nextIndex]?.id ?? ''] ?? '');
      return;
    }
    if (total === 1) {
      onRespond(collect(next));
      return;
    }
    setPhase(QuestionWizardPhase.Review);
  };

  const answer = (value: string): void => {
    if (!question) return;
    const next = { ...answers, [question.id]: value.trim() };
    setAnswers(next);
    advance(next);
  };

  // Re-opens a question: its picked option shows as chosen below, so only a
  // typed (custom) answer is restored into the text box.
  const edit = (target: number): void => {
    setPhase(QuestionWizardPhase.Answering);
    setIndex(target);
    setDraft(draftFor(questions[target], answers));
  };

  if (phase === QuestionWizardPhase.Review) {
    return (
      <div className="prompt prompt-input">
        <div className="prompt-head">Review your answers</div>
        <ol className="prompt-review">
          {questions.map((item, position) => (
            <li key={item.id} className="prompt-review-row">
              <span className="prompt-review-text">
                <span
                  className="prompt-review-question markdown-body"
                  dangerouslySetInnerHTML={{
                    __html: renderMarkdownInline(item.question),
                  }}
                />
                <span className="prompt-review-answer">
                  {answers[item.id]?.length ? answers[item.id] : 'not answered'}
                </span>
              </span>
              <button
                type="button"
                className="btn"
                onClick={() => edit(position)}
              >
                Edit
              </button>
            </li>
          ))}
        </ol>
        <div className="prompt-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onRespond(collect(answers))}
          >
            Submit answers
          </button>
          <button type="button" className="btn" onClick={() => edit(total - 1)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="prompt prompt-input">
      {/* Answers given so far stay on screen, so picking an option visibly
          registers even though the flow moves on to the next question. */}
      {answeredEntries(questions, answers, index).map((entry) => (
        <div key={entry.id} className="prompt-answered">
          <span className="prompt-answered-mark">✓</span>
          <span className="prompt-answered-text">
            <span
              className="prompt-answered-question markdown-body"
              dangerouslySetInnerHTML={{
                __html: renderMarkdownInline(entry.question),
              }}
            />
            <span className="prompt-answered-answer">{entry.answer}</span>
          </span>
          <button
            type="button"
            className="btn"
            onClick={() => edit(entry.position - 1)}
          >
            Edit
          </button>
        </div>
      ))}
      {total > 1 ? (
        <div className="prompt-step">{`Question ${index + 1} of ${total}`}</div>
      ) : null}
      {/* Questions are authored as Markdown (code spans, lists, emphasis), so
          render them like assistant text instead of showing the raw source. */}
      <div
        className="prompt-head markdown-body"
        dangerouslySetInnerHTML={{
          __html: renderMarkdown(question?.question ?? ''),
        }}
      />
      {question?.options && question.options.length > 0 ? (
        <ol className="prompt-options">
          {question.options.map((option, position) => {
            // The chosen answer stays marked, so stepping back shows what was
            // picked for this question.
            const chosen = isChosenOption(question, answers, option);
            return (
              <li key={option}>
                <button
                  type="button"
                  className={
                    chosen
                      ? 'btn prompt-option prompt-option-chosen'
                      : 'btn prompt-option'
                  }
                  aria-pressed={chosen}
                  onClick={() => answer(option)}
                >
                  <span className="prompt-option-number">
                    {chosen ? '✓' : `${position + 1}.`}
                  </span>
                  <span
                    className="prompt-option-label markdown-body"
                    dangerouslySetInnerHTML={{
                      __html: renderMarkdownInline(option),
                    }}
                  />
                </button>
              </li>
            );
          })}
        </ol>
      ) : null}
      <form
        className="prompt-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) answer(draft);
        }}
      >
        <input
          className="prompt-text"
          value={draft}
          autoFocus
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type your own answer…"
        />
        <button type="submit" className="btn btn-primary">
          {index < total - 1 ? 'Next' : 'Done'}
        </button>
      </form>
      <div className="prompt-actions">
        {index > 0 ? (
          <button type="button" className="btn" onClick={() => edit(index - 1)}>
            Back
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          title="Skip this question"
          onClick={() => advance(answers)}
        >
          {index < total - 1 ? 'Skip' : 'Skip & review'}
        </button>
      </div>
    </div>
  );
}
