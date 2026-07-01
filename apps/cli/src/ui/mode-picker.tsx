import React, { useMemo, useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { KeyName } from '@cli/ui/key-name.js';

import {
  BUILT_IN_MODE_CATEGORY,
  CUSTOM_MODE_CATEGORY,
  type ChatMode,
  type ModeIcon,
} from '@core/domain/chat-mode';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

/**
 * Maps a mode's semantic icon key to a monochrome glyph the terminal renders
 * cleanly (no emoji). Shared by the picker and the composer's mode pill.
 */
export function modeGlyph(icon: ModeIcon): string {
  switch (icon) {
    case 'build':
      return '⚒';
    case 'ask':
      return '?';
    case 'plan':
      return '☰';
    case 'custom':
      return '✦';
  }
}

interface ModePickerProps {
  modes: ChatMode[];
  activeModeId: string;
  /** Switch to an existing mode. */
  onSelect: (modeId: string) => void;
  /** Create a custom mode (name + optional system prompt) and switch to it. */
  onCreate: (name: string, systemPrompt?: string) => void;
  onCancel: () => void;
}

/** A navigable row: a category heading, a selectable mode, or the create action. */
type Row =
  | { kind: 'category'; label: string }
  | { kind: 'mode'; mode: ChatMode }
  | { kind: 'create' };

/**
 * The `/mode` modal. Modes are grouped under Default/Custom headings; ↑↓ move
 * between selectable rows (headings are skipped), Enter switches to the focused
 * mode. The last row, "+ Create new mode", opens a small two-step form for a
 * name and an optional system prompt — AGENTS.md and the workspace path are
 * always included regardless, so only the prompt changes. Esc cancels.
 */
export function ModePicker(props: ModePickerProps): React.ReactNode {
  // null = the list; otherwise the create form, on its name or prompt step.
  const [step, setStep] = useState<null | 'name' | 'prompt'>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const rows = useMemo<Row[]>(() => {
    const builtIn = props.modes.filter((mode) => !mode.custom);
    const custom = props.modes.filter((mode) => mode.custom);
    const result: Row[] = [];
    result.push({ kind: 'category', label: BUILT_IN_MODE_CATEGORY });
    for (const mode of builtIn) result.push({ kind: 'mode', mode });
    if (custom.length > 0) {
      result.push({ kind: 'category', label: CUSTOM_MODE_CATEGORY });
      for (const mode of custom) result.push({ kind: 'mode', mode });
    }
    result.push({ kind: 'create' });
    return result;
  }, [props.modes]);

  const isSelectable = (index: number): boolean =>
    rows[index]?.kind !== 'category';

  const firstSelectable = useMemo(() => {
    const fromActive = rows.findIndex(
      (row) => row.kind === 'mode' && row.mode.id === props.activeModeId
    );
    if (fromActive >= 0) return fromActive;
    return rows.findIndex((_, index) => isSelectable(index));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, props.activeModeId]);

  const [focusedIndex, setFocusedIndex] = useState(firstSelectable);

  // Step over category headings when moving the cursor.
  const move = (dir: 1 | -1): void => {
    setFocusedIndex((prev) => {
      let next = prev + dir;
      while (next >= 0 && next < rows.length && !isSelectable(next)) {
        next += dir;
      }
      if (next < 0 || next >= rows.length) return prev;
      return next;
    });
  };

  useKeyboard((key) => {
    // The create form owns its own keyboard via the focused <input>; here we
    // only handle Esc to back out to the list.
    if (step !== null) {
      if (key.name === KeyName.Escape) {
        if (step === 'prompt') {
          setStep('name');
        } else {
          setStep(null);
        }
      }
      return;
    }

    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      props.onCancel();
      return;
    }
    if (key.name === KeyName.Down) {
      move(1);
      return;
    }
    if (key.name === KeyName.Up) {
      move(-1);
      return;
    }
    if (key.name === KeyName.Return) {
      const row = rows[focusedIndex];
      if (!row) return;
      if (row.kind === 'create') {
        setStep('name');
        return;
      }
      if (row.kind === 'mode') {
        props.onSelect(row.mode.id);
      }
    }
  });

  if (step !== null) {
    return (
      <box
        flexDirection="column"
        border
        borderStyle="rounded"
        borderColor="cyan"
        paddingLeft={1}
        paddingRight={1}
      >
        <box
          flexDirection="row"
          justifyContent="space-between"
          marginBottom={1}
        >
          <text fg="cyan" attributes={BOLD}>
            New mode
          </text>
          <text fg={MUTED}>
            {step === 'name'
              ? 'enter next · esc cancel'
              : 'enter create · esc back'}
          </text>
        </box>

        <text fg={MUTED}>
          AGENTS.md and the workspace path are always included — only the system
          prompt changes.
        </text>

        <box marginTop={1} flexDirection="row">
          <text fg={MUTED}>{step === 'name' ? 'name>   ' : 'prompt> '}</text>
          <input
            key={step}
            width="100%"
            value={step === 'name' ? name : prompt}
            placeholder={
              step === 'name'
                ? 'mode name...'
                : 'system prompt (optional, enter to skip)...'
            }
            placeholderColor={MUTED}
            textColor="white"
            focusedTextColor="white"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            cursorColor="white"
            focused
            onInput={(next) => {
              if (step === 'name') setName(next);
              else setPrompt(next);
            }}
            onSubmit={() => {
              if (step === 'name') {
                if (!name.trim()) return;
                setStep('prompt');
                return;
              }
              const trimmed = prompt.trim();
              props.onCreate(name.trim(), trimmed ? trimmed : undefined);
            }}
          />
        </box>
      </box>
    );
  }

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
          Select a mode
        </text>
        <text fg={MUTED}>↑↓ move · enter select · esc cancel</text>
      </box>

      <box flexDirection="column">
        {rows.map((row, index) => {
          if (row.kind === 'category') {
            return (
              <text key={`cat:${row.label}`} fg={MUTED} attributes={BOLD}>
                {'  '}
                {row.label}
              </text>
            );
          }
          const isFocused = index === focusedIndex;
          if (row.kind === 'create') {
            return (
              <box key="create" flexDirection="row" marginTop={1}>
                <text
                  flexGrow={1}
                  {...(isFocused
                    ? { bg: 'cyan', fg: 'black' }
                    : { fg: 'cyan' })}
                >
                  {isFocused ? '› ' : '  '}+ Create new mode
                </text>
              </box>
            );
          }
          const isActive = row.mode.id === props.activeModeId;
          const mark = isActive ? '[x]' : '[ ]';
          return (
            <box key={`mode:${row.mode.id}`} flexDirection="row">
              <text
                flexGrow={1}
                {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
              >
                {isFocused ? '› ' : '  '}
                {'    '}
                {mark} {modeGlyph(row.mode.icon)} {row.mode.name}
              </text>
            </box>
          );
        })}
      </box>
    </box>
  );
}
