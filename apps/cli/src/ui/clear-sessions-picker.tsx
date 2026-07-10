import React from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { KeyName } from '@cli/ui/key-name.js';

const BOLD = createTextAttributes({ bold: true });
const WARNING = '#f59e0b';
const MUTED = '#8a8a8a';

export enum ClearSessionsChoice {
  Cancel = 'cancel',
  Delete = 'delete',
}

interface ClearSessionsPickerProps {
  /** How many sessions will be deleted if confirmed. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ClearSessionsPicker(
  props: ClearSessionsPickerProps
): React.ReactNode {
  const [selectedChoice, setSelectedChoice] =
    React.useState<ClearSessionsChoice>(ClearSessionsChoice.Cancel);

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      props.onCancel();
      return;
    }

    if (
      key.name === KeyName.Left ||
      key.name === KeyName.Right ||
      key.name === KeyName.Tab
    ) {
      setSelectedChoice((current) =>
        current === ClearSessionsChoice.Cancel
          ? ClearSessionsChoice.Delete
          : ClearSessionsChoice.Cancel
      );
      return;
    }

    if (key.name === KeyName.Return) {
      if (selectedChoice === ClearSessionsChoice.Delete) {
        props.onConfirm();
        return;
      }

      props.onCancel();
    }
  });

  const plural = props.count === 1 ? '' : 's';

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={WARNING}
      paddingLeft={1}
      paddingRight={1}
    >
      <text fg={WARNING} attributes={BOLD}>
        Clear all sessions
      </text>
      <text fg={WARNING}>This action is irreversible.</text>
      <text marginTop={1}>
        All {props.count} saved session{plural} will be permanently deleted.
      </text>
      <box marginTop={1} flexDirection="row" gap={1}>
        {selectedChoice === ClearSessionsChoice.Cancel ? (
          <box paddingLeft={1} paddingRight={1} backgroundColor="white">
            <text fg="black" attributes={BOLD}>
              Cancel
            </text>
          </box>
        ) : (
          <box paddingLeft={1} paddingRight={1}>
            <text>Cancel</text>
          </box>
        )}
        {selectedChoice === ClearSessionsChoice.Delete ? (
          <box paddingLeft={1} paddingRight={1} backgroundColor={WARNING}>
            <text fg="black" attributes={BOLD}>
              Delete all {props.count} session{plural}
            </text>
          </box>
        ) : (
          <box paddingLeft={1} paddingRight={1}>
            <text fg={WARNING}>
              Delete all {props.count} session{plural}
            </text>
          </box>
        )}
      </box>
      <text marginTop={1} fg={MUTED}>
        Use ←/→ or Tab to choose, Enter to confirm, Esc to go back.
      </text>
    </box>
  );
}
