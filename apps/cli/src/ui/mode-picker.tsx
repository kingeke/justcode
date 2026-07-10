import React, { useMemo, useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { KeyName } from '@cli/ui/key-name.js';

import {
  BUILT_IN_MODE_CATEGORY,
  CUSTOM_MODE_CATEGORY,
  type ChatMode,
  ModeIcon,
} from '@core/domain/chat-mode';
import type { ModelDefaults, ModelReference } from '@core/domain/model-default';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

/** The two steps of the create-mode form. */
export enum ModeFormStep {
  Name = 'name',
  Prompt = 'prompt',
}

/**
 * Maps a mode's semantic icon key to a monochrome glyph the terminal renders
 * cleanly (no emoji). Shared by the picker and the composer's mode pill.
 */
export function modeGlyph(icon: ModeIcon): string {
  switch (icon) {
    case ModeIcon.Build:
      return '⚒';
    case ModeIcon.Ask:
      return '?';
    case ModeIcon.Plan:
      // U+2261 (identical to), not U+2630 (trigram): the trigram has patchy
      // monospace coverage and often draws wider than the single cell the
      // layout engine reserves, bleeding into the next glyph.
      return '≡';
    case ModeIcon.Custom:
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
  /** Delete the focused custom mode (built-ins can never be deleted). */
  onDelete?: (modeId: string) => void;
  /** Per-mode default models, so each row can show its bound model. */
  modelDefaults?: ModelDefaults;
  /** Resolves a bound reference to a human label (provider's model name). */
  modelLabelFor?: (reference: ModelReference | undefined) => string | undefined;
  /** Open the model picker to bind the focused mode's default model. */
  onSetDefaultModel?: (modeId: string) => void;
  /** Clear the focused mode's default model. */
  onClearDefaultModel?: (modeId: string) => void;
  onCancel: () => void;
}

/** The kinds of row the picker renders. */
enum RowKind {
  Category = 'category',
  Mode = 'mode',
  Create = 'create',
}

/** A navigable row: a category heading, a selectable mode, or the create action. */
type Row =
  | { kind: RowKind.Category; label: string }
  | { kind: RowKind.Mode; mode: ChatMode }
  | { kind: RowKind.Create };

/**
 * The `/mode` modal. Modes are grouped under Default/Custom headings; ↑↓ move
 * between selectable rows (headings are skipped), Enter switches to the focused
 * mode. The last row, "+ Create new mode", opens a small two-step form for a
 * name and an optional system prompt — AGENTS.md and the workspace path are
 * always included regardless, so only the prompt changes. Esc cancels.
 */
export function ModePicker(props: ModePickerProps): React.ReactNode {
  // null = the list; otherwise the create form, on its name or prompt step.
  const [step, setStep] = useState<ModeFormStep | null>(null);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');

  const rows = useMemo<Row[]>(() => {
    const builtIn = props.modes.filter((mode) => !mode.custom);
    const custom = props.modes.filter((mode) => mode.custom);
    const result: Row[] = [];
    result.push({ kind: RowKind.Category, label: BUILT_IN_MODE_CATEGORY });
    for (const mode of builtIn) result.push({ kind: RowKind.Mode, mode });
    if (custom.length > 0) {
      result.push({ kind: RowKind.Category, label: CUSTOM_MODE_CATEGORY });
      for (const mode of custom) result.push({ kind: RowKind.Mode, mode });
    }
    result.push({ kind: RowKind.Create });
    return result;
  }, [props.modes]);

  const isSelectable = (index: number): boolean =>
    rows[index]?.kind !== RowKind.Category;

  const firstSelectable = useMemo(() => {
    const fromActive = rows.findIndex(
      (row) => row.kind === RowKind.Mode && row.mode.id === props.activeModeId
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
        if (step === ModeFormStep.Prompt) {
          setStep(ModeFormStep.Name);
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
    if (key.name === KeyName.X) {
      const row = rows[focusedIndex];
      // Only custom modes are deletable; built-ins are permanent.
      if (row?.kind === RowKind.Mode && row.mode.custom) {
        props.onDelete?.(row.mode.id);
        // Keep the cursor on a valid row after the list shrinks.
        move(-1);
      }
      return;
    }
    // `d` binds a default model to the focused mode; `c` clears it. Works on
    // built-in and custom modes alike.
    if (key.name === KeyName.D) {
      const row = rows[focusedIndex];
      if (row?.kind === RowKind.Mode) props.onSetDefaultModel?.(row.mode.id);
      return;
    }
    if (key.name === KeyName.C && !key.ctrl) {
      const row = rows[focusedIndex];
      if (row?.kind === RowKind.Mode) props.onClearDefaultModel?.(row.mode.id);
      return;
    }
    if (key.name === KeyName.Return) {
      const row = rows[focusedIndex];
      if (!row) return;
      if (row.kind === RowKind.Create) {
        setStep(ModeFormStep.Name);
        return;
      }
      if (row.kind === RowKind.Mode) {
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
            {step === ModeFormStep.Name
              ? 'enter next · esc cancel'
              : 'enter create · esc back'}
          </text>
        </box>

        <text fg={MUTED}>
          AGENTS.md and the workspace path are always included — only the system
          prompt changes.
        </text>

        <box marginTop={1} flexDirection="row">
          <text fg={MUTED}>
            {step === ModeFormStep.Name ? 'name>   ' : 'prompt> '}
          </text>
          <input
            key={step}
            width="100%"
            value={step === ModeFormStep.Name ? name : prompt}
            placeholder={
              step === ModeFormStep.Name
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
              if (step === ModeFormStep.Name) setName(next);
              else setPrompt(next);
            }}
            onSubmit={() => {
              if (step === ModeFormStep.Name) {
                if (!name.trim()) return;
                setStep(ModeFormStep.Prompt);
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
        <text fg={MUTED}>
          ↑↓ move · enter select · d default model · c clear
          {props.modes.some((mode) => mode.custom) ? ' · x delete custom' : ''}
          {' · esc cancel'}
        </text>
      </box>

      <box flexDirection="column">
        {rows.map((row, index) => {
          if (row.kind === RowKind.Category) {
            return (
              <text key={`cat:${row.label}`} fg={MUTED} attributes={BOLD}>
                {'  '}
                {row.label}
              </text>
            );
          }
          const isFocused = index === focusedIndex;
          if (row.kind === RowKind.Create) {
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
          const defaultRef = props.modelDefaults?.byMode[row.mode.id];
          const defaultLabel = defaultRef
            ? (props.modelLabelFor?.(defaultRef) ?? defaultRef.modelId)
            : undefined;
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
              {defaultLabel ? (
                <text fg={isFocused ? 'black' : MUTED}>{defaultLabel}</text>
              ) : null}
            </box>
          );
        })}
      </box>
    </box>
  );
}
