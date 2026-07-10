import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  type TextChunk,
} from '@opentui/core';
import { KeyName, printableInput } from '@cli/ui/key-name.js';
import { useKeyboard } from '@opentui/react';

import { type ModelInfo } from '@core/ports/chat-model';
import { PROVIDER_IDS } from '@core/ports/provider-catalog';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import type { ProviderId } from '@core/ports/provider-catalog';
import {
  normalizeSingleLinePaste,
  pasteFromClipboard,
} from '@cli/ui/clipboard.js';
import { fuzzyFilter } from '@cli/ui/fuzzy-filter.js';
import { SortDirection } from '@cli/shared/sort.js';

const VISIBLE_ROWS = 18;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

export enum SortMode {
  Provider = 'provider',
  InputCost = 'input-cost',
  OutputCost = 'output-cost',
  ContextWindow = 'context-window',
}
type SortState = {
  mode: SortMode;
  direction: SortDirection;
};

const SORT_MODE_LABELS: Record<SortMode, string> = {
  [SortMode.Provider]: 'provider',
  [SortMode.InputCost]: 'input cost',
  [SortMode.OutputCost]: 'output cost',
  [SortMode.ContextWindow]: 'context length',
};

const SORT_STATES: SortState[] = Object.values(SortMode).flatMap((mode) => [
  { mode, direction: SortDirection.Asc },
  { mode, direction: SortDirection.Desc },
]);

interface ModelPickerProps {
  models: ModelInfo[];
  currentModel: string;
  /**
   * The active provider, so the ✓ marks the model actually in use rather than
   * every model that merely shares its id. Different providers (e.g. Ollama and
   * a LiteLLM proxy in front of it) can expose the same model id, so the id
   * alone is ambiguous. Optional: when absent, the marker falls back to id-only.
   */
  currentProviderId?: ProviderId | undefined;
  /** Heading shown above the list; defaults to "Select a model". */
  title?: string;
  onSelect: (model: ModelInfo) => void;
  onCancel: () => void;
}

/** The kinds of row the model picker renders. */
export enum ModelRowKind {
  Header = 'header',
  Model = 'model',
}

/**
 * A row of the picker list: either a provider heading (focusable, toggles its
 * group's collapse) or a selectable model.
 */
type PickerRow =
  | {
      kind: ModelRowKind.Header;
      providerId: ProviderId;
      groupName: string;
      count: number;
      collapsed: boolean;
    }
  | { kind: ModelRowKind.Model; model: ModelInfo };

export function ModelPicker(props: ModelPickerProps): React.ReactNode {
  const [query, setQuery] = useState('');
  const [sortState, setSortState] = useState<SortState>({
    mode: SortMode.Provider,
    direction: SortDirection.Asc,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [collapsedProviders, setCollapsedProviders] = useState<Set<ProviderId>>(
    new Set()
  );
  const scrollOffsetRef = useRef(0);

  // A live search overrides collapsing so matches are never hidden; the
  // collapsed set is kept and applies again once the query is cleared.
  const searching = query.trim().length > 0;

  const filteredModels = useMemo(
    () =>
      fuzzyFilter(
        props.models,
        query,
        (m) =>
          `${PROVIDER_BY_ID[m.providerId]?.name ?? ''} ${m.id} ${m.displayName}`
      ),
    [props.models, query]
  );

  const rows: PickerRow[] = useMemo(() => {
    const sorted = [...filteredModels].sort((a, b) =>
      compareModels(a, b, sortState)
    );
    if (sortState.mode !== SortMode.Provider) {
      return sorted.map((model) => ({
        kind: ModelRowKind.Model as const,
        model,
      }));
    }

    const counts = new Map<ProviderId, number>();
    for (const model of sorted) {
      counts.set(model.providerId, (counts.get(model.providerId) ?? 0) + 1);
    }

    const result: PickerRow[] = [];
    let lastProviderId: ProviderId | undefined;
    for (const model of sorted) {
      if (model.providerId !== lastProviderId) {
        lastProviderId = model.providerId;
        result.push({
          kind: ModelRowKind.Header,
          providerId: model.providerId,
          groupName: PROVIDER_BY_ID[model.providerId]?.name ?? model.providerId,
          count: counts.get(model.providerId) ?? 0,
          collapsed: !searching && collapsedProviders.has(model.providerId),
        });
      }
      if (!searching && collapsedProviders.has(model.providerId)) continue;
      result.push({ kind: ModelRowKind.Model, model });
    }

    return result;
  }, [filteredModels, sortState, collapsedProviders, searching]);

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, rows.length - 1));

  const toggleProvider = (providerId: ProviderId): void => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
      } else {
        next.add(providerId);
      }
      return next;
    });
  };

  useEffect(() => {
    // Land on the first model, not the heading above it, so Enter still picks
    // a model straight away like it did before headers became focusable.
    setFocusedIndex(sortState.mode === SortMode.Provider ? 1 : 0);
    scrollOffsetRef.current = 0;
  }, [query, sortState]);

  // Collapsing shrinks the list; keep focus and scroll inside it.
  useEffect(() => {
    setFocusedIndex((current) =>
      Math.max(0, Math.min(current, rows.length - 1))
    );
    const maxOffset = Math.max(0, rows.length - VISIBLE_ROWS);
    if (scrollOffsetRef.current > maxOffset) {
      scrollOffsetRef.current = maxOffset;
    }
  }, [rows.length]);

  useKeyboard((key) => {
    if (key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C)) {
      props.onCancel();
      return;
    }

    if (key.name === KeyName.Return) {
      const entry = rows[focusedIndex];
      if (entry?.kind === ModelRowKind.Model) props.onSelect(entry.model);
      else if (entry?.kind === ModelRowKind.Header)
        toggleProvider(entry.providerId);
      return;
    }

    if (key.name === KeyName.Left || key.name === KeyName.Right) {
      if (sortState.mode !== SortMode.Provider) return;
      const shouldCollapse = key.name === KeyName.Left;
      // Shift folds/unfolds every provider group at once.
      if (key.shift) {
        setCollapsedProviders(
          shouldCollapse
            ? new Set(filteredModels.map((m) => m.providerId))
            : new Set()
        );
        return;
      }
      const entry = rows[focusedIndex];
      if (entry?.kind === ModelRowKind.Header) {
        if (shouldCollapse !== entry.collapsed)
          toggleProvider(entry.providerId);
      }
      return;
    }

    if (key.name === KeyName.Tab) {
      setSortState((prev) => cycleSortState(prev, key.shift ? -1 : 1));
      return;
    }

    if (key.name === KeyName.Down) {
      const next = clampFocus(focusedIndex + 1);
      setFocusedIndex(next);
      if (next >= scrollOffsetRef.current + VISIBLE_ROWS) {
        scrollOffsetRef.current = next - VISIBLE_ROWS + 1;
      }
      return;
    }

    if (key.name === KeyName.Up) {
      const next = clampFocus(focusedIndex - 1);
      setFocusedIndex(next);
      if (next < scrollOffsetRef.current) {
        scrollOffsetRef.current = next;
      }
      return;
    }

    if (key.name === KeyName.Backspace || key.name === KeyName.Delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }

    if (
      (key.meta && key.name === KeyName.V) ||
      (key.shift && key.name === KeyName.Insert)
    ) {
      const paste = pasteFromClipboard();
      if (paste) {
        setQuery((prev) => prev + normalizeSingleLinePaste(paste));
      }
      return;
    }

    const input = printableInput(key);
    if (input) {
      setQuery((prev) => prev + input);
    }
  });

  const visibleRows = rows.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  return (
    <box
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor="cyan"
      paddingLeft={1}
      paddingRight={1}
    >
      <box marginBottom={1}>
        <text fg="cyan" attributes={BOLD}>
          {props.title ?? 'Select model'}
        </text>
      </box>

      <box marginBottom={1}>
        <text content={queryLineContent(query)} />
      </box>

      {rows.length === 0 ? (
        <text fg={MUTED}>
          {props.models.length === 0 ? 'Loading models...' : 'No models match.'}
        </text>
      ) : (
        <box flexDirection="column">
          {visibleRows.map((entry, i) => {
            const absoluteIndex = scrollOffsetRef.current + i;
            const isFocused = absoluteIndex === focusedIndex;

            if (entry.kind === ModelRowKind.Header) {
              return (
                <box key={`header:${entry.providerId}`} flexDirection="column">
                  <text
                    attributes={BOLD}
                    {...(isFocused
                      ? { bg: 'cyan', fg: 'black' }
                      : { fg: 'cyan' })}
                  >
                    {'\n'}
                    {isFocused ? '› ' : '  '}
                    {entry.collapsed ? '▸ ' : '▾ '}
                    {entry.groupName}
                    {entry.collapsed ? (
                      <span fg={isFocused ? 'black' : MUTED}>
                        {' '}
                        · {entry.count} model{entry.count === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </text>
                </box>
              );
            }

            const isCurrent =
              entry.model.id === props.currentModel &&
              (props.currentProviderId === undefined ||
                entry.model.providerId === props.currentProviderId);

            return (
              <box
                key={`${entry.model.providerId}:${entry.model.id}`}
                flexDirection="row"
              >
                <text
                  flexGrow={1}
                  {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
                >
                  {isFocused ? '› ' : '  '}
                  {entry.model.displayName}
                  {sortState.mode === SortMode.Provider ? null : (
                    <span fg={isFocused ? 'black' : MUTED}>
                      {' '}
                      ·{' '}
                      {PROVIDER_BY_ID[entry.model.providerId]?.name ??
                        entry.model.providerId}
                    </span>
                  )}
                  {isCurrent ? (
                    <span fg={isFocused ? 'black' : MUTED}> ✓</span>
                  ) : null}
                </text>
                <text
                  {...(isFocused ? { bg: 'cyan', fg: 'black' } : { fg: MUTED })}
                >
                  {formatModelMeta(entry.model)}
                </text>
              </box>
            );
          })}
          {rows.length > VISIBLE_ROWS ? (
            <text fg={MUTED}>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < rows.length
                ? `↓ ${rows.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                : ''}
            </text>
          ) : null}
        </box>
      )}

      <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <text fg={MUTED}>
          tab sort · {formatSortState(sortState)}
          {sortState.mode === SortMode.Provider
            ? ' · ←→ fold (shift: all)'
            : ''}{' '}
          · esc to cancel
        </text>
      </box>
    </box>
  );
}

// Renders the search prompt "> query" with a trailing inverse cursor cell.
function queryLineContent(query: string): StyledText {
  const chunks: TextChunk[] = [{ __isChunk: true, text: '> ', fg: MUTED_RGBA }];
  if (query.length === 0) {
    chunks.push({ __isChunk: true, text: 'search...', fg: MUTED_RGBA });
  } else {
    chunks.push({ __isChunk: true, text: query });
  }
  chunks.push({ __isChunk: true, text: ' ', attributes: INVERSE });
  return new StyledText(chunks);
}

function compareModels(
  a: ModelInfo,
  b: ModelInfo,
  sortState: SortState
): number {
  if (sortState.mode === SortMode.Provider) {
    const orderedProviders =
      sortState.direction === SortDirection.Asc
        ? PROVIDER_IDS
        : [...PROVIDER_IDS].reverse();
    const ai = orderedProviders.indexOf(a.providerId);
    const bi = orderedProviders.indexOf(b.providerId);
    if (ai !== bi) return ai - bi;
    return compareStrings(a.displayName, b.displayName, sortState.direction);
  }

  if (sortState.mode === SortMode.ContextWindow) {
    const aContext = a.contextWindow ?? Number.NEGATIVE_INFINITY;
    const bContext = b.contextWindow ?? Number.NEGATIVE_INFINITY;
    if (aContext !== bContext)
      return sortState.direction === SortDirection.Asc
        ? aContext - bContext
        : bContext - aContext;
    return compareStrings(a.displayName, b.displayName, sortState.direction);
  }

  const key =
    sortState.mode === SortMode.InputCost ? 'inputPerToken' : 'outputPerToken';
  const aCost = a.pricing?.[key] ?? Number.POSITIVE_INFINITY;
  const bCost = b.pricing?.[key] ?? Number.POSITIVE_INFINITY;
  if (aCost !== bCost)
    return sortState.direction === SortDirection.Asc
      ? aCost - bCost
      : bCost - aCost;
  return compareStrings(a.displayName, b.displayName, sortState.direction);
}

function cycleSortState(current: SortState, step: 1 | -1): SortState {
  const index = SORT_STATES.findIndex(
    (candidate) =>
      candidate.mode === current.mode &&
      candidate.direction === current.direction
  );
  return SORT_STATES[(index + step + SORT_STATES.length) % SORT_STATES.length]!;
}

function formatSortState(sortState: SortState): string {
  return `${SORT_MODE_LABELS[sortState.mode]} ${sortState.direction}`;
}

function compareStrings(
  a: string,
  b: string,
  direction: SortDirection
): number {
  return direction === SortDirection.Asc
    ? a.localeCompare(b)
    : b.localeCompare(a);
}

function formatModelMeta(model: ModelInfo): string {
  const parts: string[] = [];

  if (!model.pricing) {
    // Only label as "local" for providers that actually run on the user's
    // machine (Ollama/LM Studio). Hosted providers without per-request pricing
    // — subscription sign-ins, or API-key providers like Anthropic that don't
    // report pricing — must not be labeled "local".
    const entry = PROVIDER_BY_ID[model.providerId];
    if (entry?.local) {
      parts.push('local');
    }
  } else {
    const { inputPerToken, outputPerToken } = model.pricing;
    if (inputPerToken === 0 && outputPerToken === 0) {
      parts.push('free');
    } else {
      const fmt = (n: number) => `$${(n * 1_000_000).toFixed(2)}/M`;
      parts.push(`${fmt(inputPerToken)} in`, `${fmt(outputPerToken)} out`);
    }
  }

  if (model.contextWindow != null) {
    parts.push(`${formatCompactNumber(model.contextWindow)} ctx`);
  }

  return parts.join(' · ');
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
