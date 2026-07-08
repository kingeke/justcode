import React, { useMemo, useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { KeyName } from '@cli/ui/key-name.js';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

/** The category headings the sub agents picker groups under. */
export const BUILT_IN_SUB_AGENT_CATEGORY = 'Built-in sub agents';
export const CUSTOM_SUB_AGENT_CATEGORY = 'Custom sub agents';

/** One sub agent as listed/edited by the `/sub-agents` picker. */
export interface SubAgentEntry {
  /** Built-in type id (`explorer`/`general`) or a custom agent's config id. */
  id: string;
  name: string;
  /** One-line description advertised to the model in the task tool schema. */
  summary: string;
  /** The effective system prompt (override/custom prompt, or the default). */
  prompt: string;
  custom: boolean;
  /** True when the agent runs with the read-only Explorer toolset. */
  readOnly: boolean;
}

/** What a create submission carries besides the name. */
export interface SubAgentDraft {
  summary?: string;
  systemPrompt?: string;
  readOnly?: boolean;
}

interface SubAgentsPickerProps {
  agents: SubAgentEntry[];
  /** Create a custom sub agent. */
  onCreate: (name: string, draft: SubAgentDraft) => void;
  /** Delete the focused custom sub agent (built-ins can never be deleted). */
  onDelete: (id: string) => void;
  /** Persist an agent's system prompt (built-in override or custom prompt). */
  onSavePrompt: (id: string, prompt: string) => void;
  onCancel: () => void;
}

/** Keeps a row to a single line: long summaries are cut, not wrapped. */
function truncateSummary(summary: string, limit = 60): string {
  return summary.length <= limit ? summary : `${summary.slice(0, limit)}…`;
}

/** The kinds of row the picker renders. */
enum RowKind {
  Category = 'category',
  Agent = 'agent',
  Create = 'create',
}

type Row =
  | { kind: RowKind.Category; label: string }
  | { kind: RowKind.Agent; agent: SubAgentEntry }
  | { kind: RowKind.Create };

/** Steps of the create form; `null` renders the list instead. */
enum CreateStep {
  Name = 'name',
  Summary = 'summary',
  ReadOnly = 'readonly',
  Prompt = 'prompt',
}

/**
 * The `/sub-agents` modal. Lists the agents the `task` tool can spawn, grouped
 * under Built-in/Custom headings; ↑↓ move (headings are skipped), Enter edits
 * the focused agent's system prompt, `x` deletes a custom agent, and the last
 * row opens a small stepped form (name → summary → read-only → prompt) that
 * creates a new custom sub agent. Esc backs out one level.
 */
export function SubAgentsPicker(props: SubAgentsPickerProps): React.ReactNode {
  const [step, setStep] = useState<CreateStep | null>(null);
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [readOnlyAnswer, setReadOnlyAnswer] = useState('');
  const [prompt, setPrompt] = useState('');
  // Id of the agent whose prompt is being edited, or null for the list/create.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  const rows = useMemo<Row[]>(() => {
    const builtIn = props.agents.filter((agent) => !agent.custom);
    const custom = props.agents.filter((agent) => agent.custom);
    const result: Row[] = [];
    result.push({ kind: RowKind.Category, label: BUILT_IN_SUB_AGENT_CATEGORY });
    for (const agent of builtIn) result.push({ kind: RowKind.Agent, agent });
    if (custom.length > 0) {
      result.push({ kind: RowKind.Category, label: CUSTOM_SUB_AGENT_CATEGORY });
      for (const agent of custom) result.push({ kind: RowKind.Agent, agent });
    }
    result.push({ kind: RowKind.Create });
    return result;
  }, [props.agents]);

  const isSelectable = (index: number): boolean =>
    rows[index]?.kind !== RowKind.Category;

  const firstSelectable = useMemo(
    () => rows.findIndex((_, index) => isSelectable(index)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows]
  );

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
    // The create/edit forms own their own keyboard via the focused <input>;
    // here we only handle Esc to back out one level.
    if (editingId !== null) {
      if (key.name === KeyName.Escape) setEditingId(null);
      return;
    }
    if (step !== null) {
      if (key.name === KeyName.Escape) {
        if (step === CreateStep.Prompt) setStep(CreateStep.ReadOnly);
        else if (step === CreateStep.ReadOnly) setStep(CreateStep.Summary);
        else if (step === CreateStep.Summary) setStep(CreateStep.Name);
        else setStep(null);
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
      // Only custom agents are deletable; the built-ins are permanent.
      if (row?.kind === RowKind.Agent && row.agent.custom) {
        props.onDelete(row.agent.id);
        // Keep the cursor on a valid row after the list shrinks.
        move(-1);
      }
      return;
    }
    if (key.name === KeyName.Return) {
      const row = rows[focusedIndex];
      if (!row) return;
      if (row.kind === RowKind.Create) {
        setStep(CreateStep.Name);
        return;
      }
      if (row.kind === RowKind.Agent) {
        setEditingId(row.agent.id);
        setEditPrompt(row.agent.prompt);
      }
    }
  });

  if (editingId !== null) {
    const agent = props.agents.find((entry) => entry.id === editingId);
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
            Edit sub agent prompt · {agent?.name ?? editingId}
          </text>
          <text fg={MUTED}>enter save · esc cancel</text>
        </box>
        <text fg={MUTED}>
          {agent?.custom
            ? 'Leave empty to fall back to the General sub agent prompt.'
            : 'Overrides the built-in prompt; save it unchanged to keep the default.'}
        </text>
        <box marginTop={1} flexDirection="row">
          <text fg={MUTED}>{'prompt> '}</text>
          <input
            width="100%"
            value={editPrompt}
            placeholder="system prompt..."
            placeholderColor={MUTED}
            textColor="white"
            focusedTextColor="white"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            cursorColor="white"
            focused
            onInput={setEditPrompt}
            onSubmit={() => {
              props.onSavePrompt(editingId, editPrompt.trim());
              setEditingId(null);
            }}
          />
        </box>
      </box>
    );
  }

  if (step !== null) {
    const stepPrompts: Record<CreateStep, { label: string; hint: string }> = {
      [CreateStep.Name]: { label: 'name>    ', hint: 'sub agent name...' },
      [CreateStep.Summary]: {
        label: 'summary> ',
        hint: 'one line telling the model when to pick it (enter to skip)...',
      },
      [CreateStep.ReadOnly]: {
        label: 'tools>   ',
        hint: 'read-only? y/N (read-only agents cannot edit or run commands)',
      },
      [CreateStep.Prompt]: {
        label: 'prompt>  ',
        hint: 'system prompt (optional, enter to create)...',
      },
    };
    const value =
      step === CreateStep.Name
        ? name
        : step === CreateStep.Summary
          ? summary
          : step === CreateStep.ReadOnly
            ? readOnlyAnswer
            : prompt;
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
            New sub agent
          </text>
          <text fg={MUTED}>
            {step === CreateStep.Prompt
              ? 'enter create · esc back'
              : 'enter next · esc back'}
          </text>
        </box>

        <text fg={MUTED}>
          The task tool offers custom sub agents to the model alongside Explorer
          and General.
        </text>

        <box marginTop={1} flexDirection="row">
          <text fg={MUTED}>{stepPrompts[step].label}</text>
          <input
            key={step}
            width="100%"
            value={value}
            placeholder={stepPrompts[step].hint}
            placeholderColor={MUTED}
            textColor="white"
            focusedTextColor="white"
            backgroundColor="transparent"
            focusedBackgroundColor="transparent"
            cursorColor="white"
            focused
            onInput={(next) => {
              if (step === CreateStep.Name) setName(next);
              else if (step === CreateStep.Summary) setSummary(next);
              else if (step === CreateStep.ReadOnly) setReadOnlyAnswer(next);
              else setPrompt(next);
            }}
            onSubmit={() => {
              if (step === CreateStep.Name) {
                if (!name.trim()) return;
                setStep(CreateStep.Summary);
                return;
              }
              if (step === CreateStep.Summary) {
                setStep(CreateStep.ReadOnly);
                return;
              }
              if (step === CreateStep.ReadOnly) {
                setStep(CreateStep.Prompt);
                return;
              }
              const trimmedSummary = summary.trim();
              const trimmedPrompt = prompt.trim();
              props.onCreate(name.trim(), {
                ...(trimmedSummary ? { summary: trimmedSummary } : {}),
                ...(trimmedPrompt ? { systemPrompt: trimmedPrompt } : {}),
                ...(readOnlyAnswer.trim().toLowerCase().startsWith('y')
                  ? { readOnly: true }
                  : {}),
              });
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
          Sub agents
        </text>
        <text fg={MUTED}>
          ↑↓ move · enter edit prompt
          {props.agents.some((agent) => agent.custom)
            ? ' · x delete custom'
            : ''}
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
                  {isFocused ? '› ' : '  '}+ Create new sub agent
                </text>
              </box>
            );
          }
          return (
            <box key={`agent:${row.agent.id}`} flexDirection="row">
              <text
                flexGrow={1}
                {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
              >
                {isFocused ? '› ' : '  '}
                {'    '}
                {`${row.agent.readOnly ? '◇' : '◆'} ${row.agent.name}${
                  row.agent.summary
                    ? ` — ${truncateSummary(row.agent.summary)}`
                    : ''
                }`}
              </text>
            </box>
          );
        })}
      </box>
      <box marginTop={1}>
        <text fg={MUTED}>◇ read-only tools · ◆ full toolset</text>
      </box>
    </box>
  );
}
