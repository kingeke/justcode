import React from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { KeyName } from '@cli/ui/key-name.js';
import { APP_NAME } from '@core/branding';

const BOLD = createTextAttributes({ bold: true });
const WARNING = '#f59e0b';
const MUTED = '#8a8a8a';

type ResetChoice = 'cancel' | 'reset';

interface ResetPickerProps {
  onConfirm: () => void;
  onCancel: () => void;
}

export function ResetPicker(props: ResetPickerProps): React.ReactNode {
  const [selectedChoice, setSelectedChoice] =
    React.useState<ResetChoice>('cancel');

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
        current === 'cancel' ? 'reset' : 'cancel'
      );
      return;
    }

    if (key.name === KeyName.Return) {
      if (selectedChoice === 'reset') {
        props.onConfirm();
        return;
      }

      props.onCancel();
    }
  });

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
        Confirm reset
      </text>
      <text fg={WARNING}>This action is irreversible.</text>
      <text marginTop={1}>Resetting {APP_NAME} will:</text>
      <text>• restore config to defaults</text>
      <text>• remove all connected providers</text>
      <text>• remove all pulled models</text>
      <text>• disconnect all MCP servers</text>
      <text>• remove all saved sessions</text>
      <text marginTop={1} fg={MUTED}>
        You will be returned to the connect screen and start from scratch.
      </text>
      <box marginTop={1} flexDirection="row" gap={1}>
        {selectedChoice === 'cancel' ? (
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
        {selectedChoice === 'reset' ? (
          <box paddingLeft={1} paddingRight={1} backgroundColor={WARNING}>
            <text fg="black" attributes={BOLD}>
              Reset everything
            </text>
          </box>
        ) : (
          <box paddingLeft={1} paddingRight={1}>
            <text fg={WARNING}>Reset everything</text>
          </box>
        )}
      </box>
      <text marginTop={1} fg={MUTED}>
        Use ←/→ or Tab to choose, Enter to confirm, Esc to go back.
      </text>
    </box>
  );
}
