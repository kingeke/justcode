import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { ProviderId } from '@core/ports/chat-model';
import {
  PROVIDERS,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import { fuzzyFilter } from './fuzzy-filter.js';

const VISIBLE_ROWS = 12;

interface ConnectPickerProps {
  activeProviderId: ProviderId;
  onSelect: (provider: ProviderConnectionInfo) => void;
  onCancel: () => void;
}

export function ConnectPicker(props: ConnectPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const scrollOffsetRef = useRef(0);

  const providers = useMemo(
    () =>
      fuzzyFilter(
        [...PROVIDERS],
        query,
        (provider) =>
          `${provider.name} ${provider.description} ${provider.apiKeyEnvVar ?? ''} ${provider.baseUrlEnvVar ?? ''}`
      ),
    [query]
  );

  const sortedProviders = useMemo(() => {
    const providerOrder = [
      ProviderId.Openai,
      ProviderId.OpenRouter,
      ProviderId.Alibaba,
      ProviderId.Ollama,
      ProviderId.LmStudio,
    ];

    return [...providers].sort((a, b) => {
      const ai = providerOrder.indexOf(a.id);
      const bi = providerOrder.indexOf(b.id);
      if (ai !== bi) return ai - bi;
      return a.name.localeCompare(b.name);
    });
  }, [providers]);

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, sortedProviders.length - 1));

  useEffect(() => {
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query]);

  const groupedLengthRef = useRef(sortedProviders.length);
  useEffect(() => {
    groupedLengthRef.current = sortedProviders.length;
  }, [sortedProviders.length]);

  useInput((_, key) => {
    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.return) {
      const entry = sortedProviders[focusedIndex];
      if (entry) props.onSelect(entry);
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

  const visibleRows = sortedProviders.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="magenta"
      paddingX={1}
      paddingY={0}
    >
      <Box justifyContent="space-between" marginBottom={1}>
        <Text bold color="magenta">
          Connect provider
        </Text>
        <Text dimColor>enter to connect · esc to cancel</Text>
      </Box>

      <Box marginBottom={1}>
        <Text dimColor>{'> '}</Text>
        <TextInput
          value={query}
          onChange={setQuery}
          placeholder="search providers..."
          focus
        />
      </Box>

      {sortedProviders.length === 0 ? (
        <Text dimColor>No providers match.</Text>
      ) : (
        <Box flexDirection="column">
          {visibleRows.map((entry, index) => {
            const absoluteIndex = scrollOffsetRef.current + index;
            const isFocused = absoluteIndex === focusedIndex;
            const isCurrent = entry.id === props.activeProviderId;

            return (
              <Box key={entry.id} flexDirection="column">
                <Box justifyContent="space-between">
                  <Text
                    {...(isFocused
                      ? { backgroundColor: 'magenta', color: 'black' }
                      : {})}
                  >
                    {isFocused ? '› ' : '  '}
                    {entry.name}
                    {isCurrent ? <Text dimColor> ✓ current</Text> : null}
                  </Text>
                  <Text dimColor>{formatRequirements(entry)}</Text>
                </Box>
                <Text dimColor>
                  {entry.description}
                  {entry.baseUrl ? ` · ${entry.baseUrl}` : ''}
                </Text>
              </Box>
            );
          })}
          {sortedProviders.length > VISIBLE_ROWS ? (
            <Text dimColor>
              {'\n'}
              {scrollOffsetRef.current + VISIBLE_ROWS < sortedProviders.length
                ? `↓ ${sortedProviders.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                : ''}
            </Text>
          ) : null}
        </Box>
      )}
    </Box>
  );
}

function formatRequirements(provider: ProviderConnectionInfo): string {
  const apiKey = provider.apiKeyRequired
    ? `API key required${provider.apiKeyEnvVar ? ` (${provider.apiKeyEnvVar})` : ''}`
    : `API key optional${provider.apiKeyEnvVar ? ` (${provider.apiKeyEnvVar})` : ''}`;

  return provider.baseUrlEnvVar
    ? `${apiKey} · ${provider.baseUrlEnvVar}`
    : apiKey;
}
