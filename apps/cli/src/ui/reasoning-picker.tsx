import React, { useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { KeyName } from '@cli/ui/key-name.js';

import { ReasoningEffort, type ModelInfo } from '@core/ports/chat-model';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

/** A pickable reasoning choice: one of the model's effort levels, or "off". */
type ReasoningChoice = ReasoningEffort | 'off';

interface ReasoningPickerProps {
  model: ModelInfo;
  /**
   * The stored choice for this model: a level, the explicit sentinel `'off'`,
   * or undefined when the user hasn't chosen (the model default is in effect).
   */
  current: ReasoningEffort | 'off' | undefined;
  onSelect: (effort: ReasoningEffort | 'off') => void;
  onCancel: () => void;
}

export function ReasoningPicker(props: ReasoningPickerProps): React.ReactNode {
  const reasoning = props.model.reasoning;
  const levels = reasoning?.effortLevels ?? [];
  const mandatory = reasoning?.mandatory ?? false;
  const defaultEffort = reasoning?.defaultEffort ?? levels[0];

  // Mandatory models always reason, so "off" isn't offered; optional ones lead
  // with it.
  const choices: ReasoningChoice[] = mandatory
    ? [...levels]
    : ['off', ...levels];

  // What's currently in effect: the stored choice, or the model default when the
  // user hasn't chosen. This is what gets the ✓ and initial focus.
  const currentChoice: ReasoningChoice =
    props.current ?? defaultEffort ?? 'off';
  const [focusedIndex, setFocusedIndex] = useState(
    Math.max(0, choices.indexOf(currentChoice))
  );

  const clamp = (next: number): number =>
    Math.max(0, Math.min(next, choices.length - 1));

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      props.onCancel();
      return;
    }
    if (key.name === KeyName.Return) {
      const choice = choices[focusedIndex];
      if (choice) props.onSelect(choice);
      return;
    }
    if (key.name === KeyName.Down) {
      setFocusedIndex((prev) => clamp(prev + 1));
      return;
    }
    if (key.name === KeyName.Up) {
      setFocusedIndex((prev) => clamp(prev - 1));
      return;
    }
  });

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan" attributes={BOLD}>
          Reasoning effort · {props.model.displayName}
        </text>
        <text fg={MUTED}>
          {mandatory ? 'required by model · ' : ''}↑↓ select · enter · esc
        </text>
      </box>

      <box flexDirection="column">
        {choices.map((choice, index) => {
          const isFocused = index === focusedIndex;
          const isCurrent = choice === currentChoice;
          const isDefault = choice !== 'off' && choice === defaultEffort;
          const label = choice === 'off' ? 'Off' : choice;
          return (
            <box key={choice} flexDirection="row">
              <text
                flexGrow={1}
                {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
              >
                {isFocused ? '› ' : '  '}
                {label}
                {isDefault ? (
                  <span fg={isFocused ? 'black' : MUTED}> (default)</span>
                ) : null}
                {isCurrent ? (
                  <span fg={isFocused ? 'black' : MUTED}> ✓</span>
                ) : null}
              </text>
            </box>
          );
        })}
      </box>
    </box>
  );
}
