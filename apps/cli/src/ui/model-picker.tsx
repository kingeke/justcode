import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  type KeyEvent,
  type TextChunk,
} from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { type ModelInfo } from '@core/ports/chat-model';
import { PROVIDER_IDS } from '@core/ports/provider-catalog';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import {
  normalizeSingleLinePaste,
  pasteFromClipboard,
} from '@cli/ui/clipboard.js';
import { fuzzyFilter } from '@cli/ui/fuzzy-filter.js';

const VISIBLE_ROWS = 18;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

const SORT_MODES = [
  'provider',
  'input-cost',
  'output-cost',
  'context-window',
] as const;
type SortMode = (typeof SORT_MODES)[number];
type SortDirection = 'asc' | 'desc';
type SortState = {
  mode: SortMode;
  direction: SortDirection;
};

const SORT_MODE_LABELS: Record<SortMode, string> = {
  provider: 'provider',
  'input-cost': 'input cost',
  'output-cost': 'output cost',
  'context-window': 'context length',
};

const SORT_STATES: SortState[] = SORT_MODES.flatMap((mode) => [
  { mode, direction: 'asc' },
  { mode, direction: 'desc' },
]);

// Literal character to append to the search query, or undefined for control keys.
function printableInput(key: KeyEvent): string | undefined {
  if (key.ctrl || key.meta) return undefined;
  const sequence = key.sequence;
  if (!sequence) return undefined;
  for (const char of sequence) {
    if (char < ' ' || char === '\x7f') return undefined;
  }
  return sequence;
}

interface ModelPickerProps {
  models: ModelInfo[];
  currentModel: string;
  onSelect: (model: ModelInfo) => void;
  onCancel: () => void;
}

interface GroupedModel {
  model: ModelInfo;
  isFirstInGroup: boolean;
  groupName: string;
}

export function ModelPicker(props: ModelPickerProps): React.ReactNode {
  const [query, setQuery] = useState('');
  const [sortState, setSortState] = useState<SortState>({
    mode: 'provider',
    direction: 'asc',
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollOffsetRef = useRef(0);

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

  const grouped: GroupedModel[] = useMemo(() => {
    const result: GroupedModel[] = [];
    const sorted = [...filteredModels].sort((a, b) =>
      compareModels(a, b, sortState)
    );

    for (const model of sorted) {
      const isFirstInGroup =
        sortState.mode === 'provider' &&
        model.providerId !== result.at(-1)?.model.providerId;
      result.push({
        model,
        isFirstInGroup,
        groupName: PROVIDER_BY_ID[model.providerId]?.name ?? model.providerId,
      });
    }

    return result;
  }, [filteredModels, sortState]);

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, grouped.length - 1));

  useEffect(() => {
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, sortState]);

  useKeyboard((key) => {
    if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
      props.onCancel();
      return;
    }

    if (key.name === 'return') {
      const entry = grouped[focusedIndex];
      if (entry) props.onSelect(entry.model);
      return;
    }

    if (key.name === 'tab') {
      setSortState((prev) => cycleSortState(prev, key.shift ? -1 : 1));
      return;
    }

    if (key.name === 'down') {
      const next = clampFocus(focusedIndex + 1);
      setFocusedIndex(next);
      if (next >= scrollOffsetRef.current + VISIBLE_ROWS) {
        scrollOffsetRef.current = next - VISIBLE_ROWS + 1;
      }
      return;
    }

    if (key.name === 'up') {
      const next = clampFocus(focusedIndex - 1);
      setFocusedIndex(next);
      if (next < scrollOffsetRef.current) {
        scrollOffsetRef.current = next;
      }
      return;
    }

    if (key.name === 'backspace' || key.name === 'delete') {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }

    if (
      (key.meta && key.name === 'v') ||
      (key.shift && key.name === 'insert')
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

  const visibleRows = grouped.slice(
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
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg="cyan" attributes={BOLD}>
          Select model
        </text>
        <text fg={MUTED}>
          tab sort · {formatSortState(sortState)} · esc to cancel
        </text>
      </box>

      <box marginBottom={1}>
        <text content={queryLineContent(query)} />
      </box>

      {grouped.length === 0 ? (
        <text fg={MUTED}>
          {props.models.length === 0 ? 'Loading models...' : 'No models match.'}
        </text>
      ) : (
        <box flexDirection="column">
          {visibleRows.map((entry, i) => {
            const absoluteIndex = scrollOffsetRef.current + i;
            const isFocused = absoluteIndex === focusedIndex;
            const isCurrent = entry.model.id === props.currentModel;

            return (
              <box
                key={`${entry.model.providerId}:${entry.model.id}`}
                flexDirection="column"
              >
                {entry.isFirstInGroup ? (
                  <text fg="cyan" attributes={BOLD}>
                    {'\n'}
                    {entry.groupName}
                  </text>
                ) : null}
                <box flexDirection="row">
                  <text
                    flexGrow={1}
                    {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}
                  >
                    {isFocused ? '› ' : '  '}
                    {entry.model.displayName}
                    {sortState.mode === 'provider' ? null : (
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
                    {...(isFocused
                      ? { bg: 'cyan', fg: 'black' }
                      : { fg: MUTED })}
                  >
                    {formatModelMeta(entry.model)}
                  </text>
                </box>
              </box>
            );
          })}
          {grouped.length > VISIBLE_ROWS ? (
            <text fg={MUTED}>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < grouped.length
                ? `↓ ${grouped.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                : ''}
            </text>
          ) : null}
        </box>
      )}
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
  if (sortState.mode === 'provider') {
    const orderedProviders =
      sortState.direction === 'asc'
        ? PROVIDER_IDS
        : [...PROVIDER_IDS].reverse();
    const ai = orderedProviders.indexOf(a.providerId);
    const bi = orderedProviders.indexOf(b.providerId);
    if (ai !== bi) return ai - bi;
    return compareStrings(a.displayName, b.displayName, sortState.direction);
  }

  if (sortState.mode === 'context-window') {
    const aContext = a.contextWindow ?? Number.NEGATIVE_INFINITY;
    const bContext = b.contextWindow ?? Number.NEGATIVE_INFINITY;
    if (aContext !== bContext)
      return sortState.direction === 'asc'
        ? aContext - bContext
        : bContext - aContext;
    return compareStrings(a.displayName, b.displayName, sortState.direction);
  }

  const key =
    sortState.mode === 'input-cost' ? 'inputPerToken' : 'outputPerToken';
  const aCost = a.pricing?.[key] ?? Number.POSITIVE_INFINITY;
  const bCost = b.pricing?.[key] ?? Number.POSITIVE_INFINITY;
  if (aCost !== bCost)
    return sortState.direction === 'asc' ? aCost - bCost : bCost - aCost;
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
  return direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a);
}

function formatModelMeta(model: ModelInfo): string {
  const parts: string[] = [];

  if (!model.pricing) {
    // Only label as "local" for providers that are actually running locally
    // (no authMethods = api-key-only local servers like Ollama/LM Studio).
    // Any provider that can sign in via OAuth is a hosted subscription provider
    // (Copilot, or OpenAI/Anthropic connected via subscription) and has no
    // per-request pricing by design — "local" would be misleading there.
    const entry = PROVIDER_BY_ID[model.providerId];
    const isSubscription = entry?.authMethods?.includes('oauth') ?? false;
    if (!isSubscription) {
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
