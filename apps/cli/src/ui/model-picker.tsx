import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { type ModelInfo } from '@core/ports/chat-model';
import { PROVIDER_IDS } from '@core/ports/provider-catalog';
import { PROVIDER_BY_ID } from '@core/ports/provider-catalog';
import { fuzzyFilter } from './fuzzy-filter.js';

const VISIBLE_ROWS = 18;
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

// SGR mouse reports (ESC[<b;x;yM) get fed into stdin while mouse tracking is on.
// Ink passes them through to TextInput as typed text, so strip them from the query.
const MOUSE_SEQUENCE = /\x1b?\[<\d+;\d+;\d+[Mm]/g;
const stripMouseSequences = (value: string): string =>
  value.replace(MOUSE_SEQUENCE, '').replace(/\x1b?\[<[\d;]*$/g, '');

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

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
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

  const groupedLengthRef = useRef(grouped.length);
  useEffect(() => {
    groupedLengthRef.current = grouped.length;
  }, [grouped.length]);

  // Mouse wheel scroll support (SGR mouse protocol)
  useEffect(() => {
    process.stdout.write('\x1b[?1006h\x1b[?1000h');

    const onData = (chunk: Buffer) => {
      const str = chunk.toString('utf8');
      const match = /\x1b\[<(\d+);\d+;\d+M/.exec(str);
      if (!match) return;
      const btn = Number(match[1]);

      if (btn === 64) {
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          if (next < scrollOffsetRef.current) scrollOffsetRef.current = next;
          return next;
        });
      } else if (btn === 65) {
        setFocusedIndex((prev) => {
          const next = Math.min(groupedLengthRef.current - 1, prev + 1);
          if (next >= scrollOffsetRef.current + VISIBLE_ROWS) {
            scrollOffsetRef.current = next - VISIBLE_ROWS + 1;
          }
          return next;
        });
      }
    };

    process.stdin.on('data', onData);
    return () => {
      process.stdout.write('\x1b[?1006l\x1b[?1000l');
      process.stdin.off('data', onData);
    };
  }, []);

  useInput((_, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.return) {
      const entry = grouped[focusedIndex];
      if (entry) props.onSelect(entry.model);
      return;
    }

    if (key.tab) {
      setSortState((prev) => cycleSortState(prev, key.shift ? -1 : 1));
      return;
    }

    if (key.downArrow) {
      const next = clampFocus(focusedIndex + 1);
      setFocusedIndex(next);
      if (next >= scrollOffsetRef.current + VISIBLE_ROWS) {
        scrollOffsetRef.current = next - VISIBLE_ROWS + 1;
      }
      return;
    }

    if (key.upArrow) {
      const next = clampFocus(focusedIndex - 1);
      setFocusedIndex(next);
      if (next < scrollOffsetRef.current) {
        scrollOffsetRef.current = next;
      }
    }
  });

  const visibleRows = grouped.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      paddingY={0}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="cyan">
          Select model
        </Text>
        <Text dimColor>
          tab sort · {formatSortState(sortState)} · esc to cancel
        </Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{'> '}</Text>
        <TextInput
          value={query}
          onChange={(value) => setQuery(stripMouseSequences(value))}
          placeholder="search..."
          focus
        />
      </Box>

      {grouped.length === 0 ? (
        <Text dimColor>
          {props.models.length === 0 ? 'Loading models...' : 'No models match.'}
        </Text>
      ) : (
        <Box flexDirection="column">
          {visibleRows.map((entry, i) => {
            const absoluteIndex = scrollOffsetRef.current + i;
            const isFocused = absoluteIndex === focusedIndex;
            const isCurrent = entry.model.id === props.currentModel;

            return (
              <Box
                key={`${entry.model.providerId}:${entry.model.id}`}
                flexDirection="column"
              >
                {entry.isFirstInGroup ? (
                  <Text bold color="cyan">
                    {'\n'}
                    {entry.groupName}
                  </Text>
                ) : null}
                <Box justifyContent="space-between">
                  <Text
                    {...(isFocused
                      ? { backgroundColor: 'cyan', color: 'black' }
                      : {})}
                  >
                    {isFocused ? '› ' : '  '}
                    {entry.model.displayName}
                    {sortState.mode === 'provider' ? null : (
                      <Text dimColor>
                        {' '}
                        ·{' '}
                        {PROVIDER_BY_ID[entry.model.providerId]?.name ??
                          entry.model.providerId}
                      </Text>
                    )}
                    {isCurrent ? <Text dimColor> ✓</Text> : null}
                  </Text>
                  <Text dimColor>{formatModelMeta(entry.model)}</Text>
                </Box>
              </Box>
            );
          })}
          {grouped.length > VISIBLE_ROWS ? (
            <Text dimColor>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < grouped.length
                ? `↓ ${grouped.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                : ''}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
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
    parts.push('local');
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
