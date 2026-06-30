import React, { useMemo, useState } from 'react';
import { createTextAttributes } from '@opentui/core';
import { useKeyboard } from '@opentui/react';
import { KeyName } from '@cli/ui/key-name.js';

import type { ManageableToolInfo } from '@core/domain/tool-metadata';

const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';

interface ToolsPickerProps {
  tools: ManageableToolInfo[];
  /** Called with the names of the tools that are turned off, on confirm. */
  onConfirm: (disabledNames: string[]) => void;
  onCancel: () => void;
}

/** A navigable row: either a category heading or a tool under it. */
type Row =
  | { kind: 'category'; category: string }
  | { kind: 'tool'; tool: ManageableToolInfo };

/**
 * The `/manage-tools` modal. Tools are grouped under collapsible category
 * headings; ↑↓ move through the visible rows, space toggles, and ←/→ fold or
 * unfold the focused section (so future groups like MCP servers stay tidy).
 * Toggling a heading flips its whole group on or off (off only when every tool
 * under it is already on). Enter saves the new on/off state, Esc cancels.
 */
export function ToolsPicker(props: ToolsPickerProps): React.ReactNode {
  // Local working copy of each tool's enabled state, keyed by name. Edits stay
  // here until the user confirms, so Esc can discard them.
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(props.tools.map((tool) => [tool.name, tool.enabled]))
  );
  // Which category headings are folded shut (tool rows hidden), keyed by name.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // The categories in first-seen order.
  const categories = useMemo<string[]>(() => {
    const seen: string[] = [];
    for (const tool of props.tools) {
      if (!seen.includes(tool.category)) seen.push(tool.category);
    }
    return seen;
  }, [props.tools]);

  // Flatten into navigable rows: a heading per category followed by its tools,
  // skipping the tools of a collapsed category.
  const rows = useMemo<Row[]>(() => {
    const result: Row[] = [];
    for (const category of categories) {
      result.push({ kind: 'category', category });
      if (collapsed[category]) continue;
      for (const tool of props.tools) {
        if (tool.category === category) result.push({ kind: 'tool', tool });
      }
    }
    return result;
  }, [props.tools, categories, collapsed]);

  const [focusedIndex, setFocusedIndex] = useState(0);

  const clamp = (next: number): number =>
    Math.max(0, Math.min(next, rows.length - 1));

  const toolsInCategory = (category: string): ManageableToolInfo[] =>
    props.tools.filter((tool) => tool.category === category);

  const toggleRow = (row: Row): void => {
    if (row.kind === 'tool') {
      setEnabled((prev) => ({
        ...prev,
        [row.tool.name]: !prev[row.tool.name],
      }));
      return;
    }
    // A heading turns its whole group on, unless every tool is already on — then
    // it turns them all off, so a second press undoes the first.
    const group = toolsInCategory(row.category);
    const allOn = group.every((tool) => enabled[tool.name]);
    setEnabled((prev) => {
      const next = { ...prev };
      for (const tool of group) next[tool.name] = !allOn;
      return next;
    });
  };

  // Fold/unfold the focused category. On a tool row, ←/→ act on its parent
  // category, so the user doesn't have to land exactly on the heading.
  const setFold = (row: Row | undefined, folded: boolean): void => {
    const category =
      row?.kind === 'category' ? row.category : row?.tool.category;
    if (!category) return;
    setCollapsed((prev) => ({ ...prev, [category]: folded }));
    // Keep focus on the heading so the cursor doesn't strand on a now-hidden row.
    const headingIndex = rows.findIndex(
      (r) => r.kind === 'category' && r.category === category
    );
    if (headingIndex >= 0) setFocusedIndex(headingIndex);
  };

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      props.onCancel();
      return;
    }
    if (key.name === KeyName.Return) {
      const disabled = props.tools
        .filter((tool) => !enabled[tool.name])
        .map((tool) => tool.name);
      props.onConfirm(disabled);
      return;
    }
    if (key.name === KeyName.Space) {
      const row = rows[focusedIndex];
      if (row) toggleRow(row);
      return;
    }
    if (key.name === KeyName.Left) {
      setFold(rows[focusedIndex], true);
      return;
    }
    if (key.name === KeyName.Right) {
      setFold(rows[focusedIndex], false);
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
          Manage tools
        </text>
        <text fg={MUTED}>
          ↑↓ move · space toggle · ←→ fold · enter save · esc cancel
        </text>
      </box>

      <box flexDirection="column">
        {rows.map((row, index) => {
          const isFocused = index === focusedIndex;
          if (row.kind === 'category') {
            const group = toolsInCategory(row.category);
            const allOn = group.every((tool) => enabled[tool.name]);
            const someOn = group.some((tool) => enabled[tool.name]);
            const mark = allOn ? '[x]' : someOn ? '[~]' : '[ ]';
            const caret = collapsed[row.category] ? '▸' : '▾';
            return (
              <box key={`cat:${row.category}`} flexDirection="row">
                <text
                  flexGrow={1}
                  attributes={BOLD}
                  {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
                >
                  {isFocused ? '› ' : '  '}
                  {caret} {mark} {row.category}
                </text>
              </box>
            );
          }
          const isOn = enabled[row.tool.name];
          const mark = isOn ? '[x]' : '[ ]';
          return (
            <box key={`tool:${row.tool.name}`} flexDirection="row">
              <text
                flexGrow={1}
                {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
              >
                {isFocused ? '› ' : '  '}
                {'    '}
                {mark} {row.tool.label}
                <span fg={isFocused ? 'black' : MUTED}>
                  {' '}
                  — {row.tool.summary}
                </span>
              </text>
            </box>
          );
        })}
      </box>
    </box>
  );
}
