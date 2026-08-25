/**
 * Phases of the multi-question flow a host renders when a tool asks the user
 * several questions at once. Shared by the CLI and the VS Code webview so both
 * step-through UIs speak the same language.
 */
export enum QuestionWizardPhase {
  /** Browsing/selecting an answer for the current question. */
  Answering = 'answering',
  /** Typing a custom answer for the current question. */
  CustomInput = 'customInput',
  /** Reviewing every answer before submitting, with the option to edit one. */
  Review = 'review',
}
