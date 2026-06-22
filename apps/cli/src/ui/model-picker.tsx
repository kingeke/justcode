import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { PROVIDERS, ProviderId, type ModelInfo } from '@core/ports/chat-model';
import { fuzzyFilter } from './fuzzy-filter.js';

const VISIBLE_ROWS = 18;

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
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollOffsetRef = useRef(0);

  const filteredModels = useMemo(
    () =>
      fuzzyFilter(
        props.models,
        query,
        (m) => `${PROVIDERS[m.providerId]?.name ?? ''} ${m.id} ${m.displayName}`
      ),
    [props.models, query]
  );

  const grouped: GroupedModel[] = useMemo(() => {
    const result: GroupedModel[] = [];
    let lastProvider: ProviderId | null = null;

    const providerOrder = [
      ProviderId.OpenRouter,
      ProviderId.Openai,
      ProviderId.Ollama,
      ProviderId.LmStudio,
    ];

    const sorted = [...filteredModels].sort((a, b) => {
      const ai = providerOrder.indexOf(a.providerId);
      const bi = providerOrder.indexOf(b.providerId);
      if (ai !== bi) return ai - bi;
      return a.displayName.localeCompare(b.displayName);
    });

    for (const model of sorted) {
      const isFirstInGroup = model.providerId !== lastProvider;
      result.push({
        model,
        isFirstInGroup,
        groupName: PROVIDERS[model.providerId]?.name ?? model.providerId,
      });
      lastProvider = model.providerId;
    }

    return result;
  }, [filteredModels]);

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, grouped.length - 1));

  useEffect(() => {
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query]);

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
        <Text dimColor>esc to cancel</Text>
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
                    {isCurrent ? <Text dimColor> ✓</Text> : null}
                  </Text>
                  <Text dimColor>{formatPricing(entry.model)}</Text>
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

function formatPricing(model: ModelInfo): string {
  if (!model.pricing) return 'local';
  const { inputPerToken, outputPerToken } = model.pricing;
  if (inputPerToken === 0 && outputPerToken === 0) return 'free';
  const fmt = (n: number) => `$${(n * 1_000_000).toFixed(2)}/M`;
  return [`${fmt(inputPerToken)} in`, `${fmt(outputPerToken)} out`].join(' · ');
}
