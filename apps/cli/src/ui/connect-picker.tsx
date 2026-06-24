import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import {
  ProviderId,
  type ModelInfo,
  type ProviderClient,
} from '@core/ports/chat-model';
import {
  PROVIDERS,
  type ProviderConfig,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import { AlibabaProvider } from '@providers/alibaba/alibaba-provider';
import { LmStudioProvider } from '@providers/lmstudio/lmstudio-provider';
import { OllamaProvider } from '@providers/ollama/ollama-provider';
import { OpenAiProvider } from '@providers/openai/openai-provider';
import { OpenRouterProvider } from '@providers/openrouter/openrouter-provider';
import { fuzzyFilter } from './fuzzy-filter.js';

const VISIBLE_ROWS = 12;

type WizardStep = 'provider' | 'api-key' | 'base-url' | 'connecting';

export interface ConnectedProviderResult {
  providerId: ProviderId;
  provider: ProviderConnectionInfo;
  client: ProviderClient;
  selectedModel: ModelInfo;
  config: ProviderConfig;
}

interface ConnectPickerProps {
  activeProviderId: ProviderId;
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
    if (step !== 'provider') return;
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, step]);

  const groupedLengthRef = useRef(sortedProviders.length);
  useEffect(() => {
    groupedLengthRef.current = sortedProviders.length;
  }, [sortedProviders.length]);

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
      const entry = sortedProviders[focusedIndex];
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

  const visibleRows = sortedProviders.slice(
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
                : `Connecting - ${selectedProvider?.name ?? ''}`}
        </Text>
        <Text dimColor>
          {step === 'provider'
            ? 'enter to configure · esc to cancel'
            : step === 'connecting'
              ? 'verifying...'
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

          {sortedProviders.length === 0 ? (
            <Text dimColor>No providers match.</Text>
          ) : (
            <Box flexDirection="column">
              {visibleRows.map((entry, index) => {
                const absoluteIndex = scrollOffsetRef.current + index;
                const isFocused = absoluteIndex === focusedIndex;
                const isCurrent = entry.id === props.activeProviderId;
                const isConfigured = configuredProviderSet.has(entry.id);

                return (
                  <Box key={entry.id} flexDirection="column">
                    <Box justifyContent="space-between">
                      <Text
                        {...(isFocused
                          ? { backgroundColor: 'cyan', color: 'black' }
                          : {})}
                      >
                        {isFocused ? '› ' : '  '}
                        {entry.name}
                        {isCurrent ? <Text dimColor> ✓ current</Text> : null}
                        {isConfigured ? <Text dimColor> ✓ setup</Text> : null}
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
                  {scrollOffsetRef.current + VISIBLE_ROWS <
                  sortedProviders.length
                    ? `↓ ${sortedProviders.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                    : ''}
                </Text>
              ) : null}
            </Box>
          )}
        </>
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
      const client = createProviderClient(provider.id, nextApiKey, nextBaseUrl);
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

function formatRequirements(provider: ProviderConnectionInfo): string {
  const apiKey = provider.apiKeyRequired
    ? `API key required${provider.apiKeyEnvVar ? ` (${provider.apiKeyEnvVar})` : ''}`
    : `API key optional${provider.apiKeyEnvVar ? ` (${provider.apiKeyEnvVar})` : ''}`;

  return provider.baseUrlEnvVar
    ? `${apiKey} · ${provider.baseUrlEnvVar}`
    : apiKey;
}

function createProviderClient(
  providerId: ProviderId,
  apiKey: string | undefined,
  baseUrl: string
): ProviderClient {
  switch (providerId) {
    case ProviderId.Openai:
      return new OpenAiProvider(apiKey ?? '', baseUrl, 'gpt-4.1-mini');
    case ProviderId.OpenRouter:
      return new OpenRouterProvider(apiKey ?? '', baseUrl);
    case ProviderId.Alibaba:
      return new AlibabaProvider(apiKey ?? '', baseUrl);
    case ProviderId.Ollama:
      return new OllamaProvider(baseUrl, apiKey);
    case ProviderId.LmStudio:
      return new LmStudioProvider(baseUrl, apiKey);
    default:
      throw new Error(`Unsupported provider '${providerId}'.`);
  }
}
