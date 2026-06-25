import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

import { type ModelInfo, type ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  PROVIDERS,
  type ProviderConfig,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import { fuzzyFilter } from './fuzzy-filter.js';

const VISIBLE_ROWS = 12;

type WizardStep = 'provider' | 'api-key' | 'base-url' | 'connecting';

export interface ConnectedProviderResult {
  providerId: ProviderId;
  provider: ProviderConnectionInfo;
  client: ProviderClient;
  /** Default model (provider default or first available). */
  selectedModel: ModelInfo;
  /** All models the provider reported, for the follow-up model picker. */
  models: ModelInfo[];
  config: ProviderConfig;
}

interface ConnectPickerProps {
  activeProviderId: ProviderId | undefined;
  configuredProviderIds: ProviderId[];
  configuredProviders: Partial<Record<ProviderId, ProviderConfig>>;
  onComplete: (result: ConnectedProviderResult) => void;
  onCancel: () => void;
}

export function ConnectPicker(props: ConnectPickerProps): React.ReactElement {
  const [query, setQuery] = useState('');
  const [step, setStep] = useState<WizardStep>('provider');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderConnectionInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scrollOffsetRef = useRef(0);

  // Display order comes straight from the catalog (PROVIDERS) — the single
  // source of truth — so there's no separate ordering to keep in sync here.
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

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, providers.length - 1));

  useEffect(() => {
    if (step !== 'provider') return;
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, step]);

  useInput((_, key) => {
    if (step !== 'provider') {
      if (key.escape) {
        setError(null);
        setStep('provider');
      }
      return;
    }

    if (key.escape) {
      props.onCancel();
      return;
    }

    if (key.return) {
      const entry = providers[focusedIndex];
      if (!entry) return;
      setSelectedProvider(entry);
      const existing = props.configuredProviders[entry.id] ?? {};
      setApiKey(existing.apiKey ?? '');
      setBaseUrl(existing.baseUrl ?? entry.baseUrl ?? '');
      setError(null);
      setStep('api-key');
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

  const visibleRows = providers.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  const configuredProviderSet = new Set(props.configuredProviderIds);

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
          {step === 'provider'
            ? 'Connect provider'
            : step === 'api-key'
              ? `API key - ${selectedProvider?.name ?? ''}`
              : step === 'base-url'
                ? `Base URL - ${selectedProvider?.name ?? ''}`
                : `Fetching models - ${selectedProvider?.name ?? ''}`}
        </Text>
        <Text dimColor>
          {step === 'provider'
            ? 'enter to configure · esc to cancel'
            : step === 'connecting'
              ? 'fetching models...'
              : 'enter to continue · esc to go back'}
        </Text>
      </Box>

      {step === 'provider' ? (
        <>
          <Box marginBottom={1}>
            <Text dimColor>{'> '}</Text>
            <TextInput
              value={query}
              onChange={setQuery}
              placeholder="search providers..."
              focus
            />
          </Box>

          {providers.length === 0 ? (
            <Text dimColor>No providers match.</Text>
          ) : (
            <Box flexDirection="column">
              {visibleRows.map((entry, index) => {
                const absoluteIndex = scrollOffsetRef.current + index;
                const isFocused = absoluteIndex === focusedIndex;
                const isConnected = configuredProviderSet.has(entry.id);

                return (
                  <Box key={entry.id}>
                    <Text
                      {...(isFocused
                        ? { backgroundColor: 'cyan', color: 'black' }
                        : {})}
                    >
                      {isFocused ? '› ' : '  '}
                      {entry.name}
                      {isConnected ? ' ✓' : ''}
                    </Text>
                  </Box>
                );
              })}
              {providers.length > VISIBLE_ROWS ? (
                <Text dimColor>
                  {'\n'}
                  {scrollOffsetRef.current + VISIBLE_ROWS < providers.length
                    ? `↓ ${providers.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                    : ''}
                </Text>
              ) : null}
            </Box>
          )}
        </>
      ) : step === 'connecting' ? (
        <Box>
          <Text color="cyan">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Connecting and fetching models...</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            {step === 'api-key'
              ? selectedProvider?.apiKeyRequired
                ? 'Enter the API key for this provider.'
                : 'Optional API key. Leave blank and press enter to skip.'
              : `Confirm or edit the base URL for ${selectedProvider?.name ?? ''}.`}
          </Text>

          <Box marginTop={1}>
            <Text dimColor>{step === 'api-key' ? 'key> ' : 'url> '}</Text>
            <TextInput
              // Remount when the step changes so ink-text-input's cursor jumps
              // to the end of the pre-filled value instead of staying at 0.
              key={step}
              value={step === 'api-key' ? apiKey : baseUrl}
              onChange={step === 'api-key' ? setApiKey : setBaseUrl}
              placeholder={
                step === 'api-key' ? 'paste api key...' : 'base url...'
              }
              focus
              onSubmit={(value) => {
                if (!selectedProvider) return;

                if (step === 'api-key') {
                  const nextApiKey = value.trim();
                  if (selectedProvider.apiKeyRequired && !nextApiKey) {
                    setError('An API key is required for this provider.');
                    return;
                  }

                  setError(null);
                  setApiKey(nextApiKey);
                  setStep('base-url');
                  return;
                }

                const nextBaseUrl = value.trim() || baseUrl.trim();
                if (!nextBaseUrl) {
                  setError('A base URL is required.');
                  return;
                }

                void connectProvider(
                  selectedProvider,
                  nextApiKeyValue(apiKey),
                  nextBaseUrl
                );
              }}
            />
          </Box>

          {error ? (
            <Box marginTop={1}>
              <Text color="yellow">{error}</Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );

  async function connectProvider(
    provider: ProviderConnectionInfo,
    nextApiKey: string | undefined,
    nextBaseUrl: string
  ): Promise<void> {
    setStep('connecting');

    try {
      const client = provider.create({
        apiKey: nextApiKey,
        baseUrl: nextBaseUrl,
      });
      const models = await client.listModels();
      const firstModel = models[0];
      if (!firstModel) {
        throw new Error(
          `No models are available for provider '${provider.name}'.`
        );
      }

      const modelId = client.getDefaultModel() ?? firstModel.id;
      const selectedModel =
        models.find((model) => model.id === modelId) ?? models[0];
      if (!selectedModel) {
        throw new Error(
          `No models are available for provider '${provider.name}'.`
        );
      }

      const config: ProviderConfig = {};
      if (nextApiKey && provider.apiKeyEnvVar) {
        config.apiKey = nextApiKey;
      }
      if (provider.baseUrlEnvVar) {
        config.baseUrl = nextBaseUrl;
      }

      props.onComplete({
        providerId: provider.id,
        provider,
        client,
        selectedModel,
        models,
        config,
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error ? caughtError.message : String(caughtError)
      );
      setStep('base-url');
    }
  }

  function nextApiKeyValue(current: string): string | undefined {
    const trimmed = current.trim();
    return trimmed ? trimmed : undefined;
  }
}
