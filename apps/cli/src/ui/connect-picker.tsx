import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  type KeyEvent,
  type TextChunk,
} from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { type ModelInfo, type ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  PROVIDERS,
  type ProviderConfig,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import { fuzzyFilter } from './fuzzy-filter.js';
import { Spinner } from './spinner.js';

const VISIBLE_ROWS = 12;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

type WizardStep = 'provider' | 'api-key' | 'base-url' | 'connecting';

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

// Renders "> query" with a trailing inverse cursor cell for the provider search.
function queryLineContent(query: string, placeholder: string): StyledText {
  const chunks: TextChunk[] = [{ __isChunk: true, text: '> ', fg: MUTED_RGBA }];
  chunks.push(...fieldChunks(query, placeholder));
  return new StyledText(chunks);
}

// Renders a typed value (or dim placeholder) with a trailing inverse cursor cell.
// Used for the API key / base URL fields, which are edited with the same simple
// keyboard handling as the provider search rather than a separate input widget.
function fieldChunks(value: string, placeholder: string): TextChunk[] {
  const chunks: TextChunk[] = [];
  if (value.length === 0) {
    chunks.push({ __isChunk: true, text: placeholder, fg: MUTED_RGBA });
  } else {
    chunks.push({ __isChunk: true, text: value });
  }
  chunks.push({ __isChunk: true, text: ' ', attributes: INVERSE });
  return chunks;
}

function fieldContent(value: string, placeholder: string): StyledText {
  return new StyledText(fieldChunks(value, placeholder));
}

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

export function ConnectPicker(props: ConnectPickerProps): React.ReactNode {
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

  useKeyboard((key) => {
    if (step !== 'provider') {
      // The api-key / base-url steps own keyboard input via <input>; here we only
      // intercept Escape to step back. Enter is handled by the input's onSubmit.
      if (key.name === 'escape') {
        setError(null);
        setStep('provider');
      }
      return;
    }

    if (key.name === 'escape') {
      props.onCancel();
      return;
    }

    if (key.name === 'return') {
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

    const input = printableInput(key);
    if (input) {
      setQuery((prev) => prev + input);
    }
  });

  const visibleRows = providers.slice(
    scrollOffsetRef.current,
    scrollOffsetRef.current + VISIBLE_ROWS
  );

  const configuredProviderSet = new Set(props.configuredProviderIds);

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
          {step === 'provider'
            ? 'Connect provider'
            : step === 'api-key'
              ? `API key - ${selectedProvider?.name ?? ''}`
              : step === 'base-url'
                ? `Base URL - ${selectedProvider?.name ?? ''}`
                : `Fetching models - ${selectedProvider?.name ?? ''}`}
        </text>
        <text fg={MUTED}>
          {step === 'provider'
            ? 'enter to configure · esc to cancel'
            : step === 'connecting'
              ? 'fetching models...'
              : 'enter to continue · esc to go back'}
        </text>
      </box>

      {step === 'provider' ? (
        <>
          <box marginBottom={1}>
            <text content={queryLineContent(query, 'search providers...')} />
          </box>

          {providers.length === 0 ? (
            <text fg={MUTED}>No providers match.</text>
          ) : (
            <box flexDirection="column">
              {visibleRows.map((entry, index) => {
                const absoluteIndex = scrollOffsetRef.current + index;
                const isFocused = absoluteIndex === focusedIndex;
                const isConnected = configuredProviderSet.has(entry.id);

                return (
                  <box key={entry.id}>
                    <text {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}>
                      {isFocused ? '› ' : '  '}
                      {entry.name}
                      {isConnected ? ' ✓' : ''}
                    </text>
                  </box>
                );
              })}
              {providers.length > VISIBLE_ROWS ? (
                <text fg={MUTED}>
                  {'\n'}
                  {scrollOffsetRef.current + VISIBLE_ROWS < providers.length
                    ? `↓ ${providers.length - scrollOffsetRef.current - VISIBLE_ROWS} more`
                    : ''}
                </text>
              ) : null}
            </box>
          )}
        </>
      ) : step === 'connecting' ? (
        <box flexDirection="row">
          <Spinner fg="cyan" />
          <text fg={MUTED}> Connecting and fetching models...</text>
        </box>
      ) : (
        <box flexDirection="column">
          <text fg={MUTED}>
            {step === 'api-key'
              ? selectedProvider?.apiKeyRequired
                ? 'Enter the API key for this provider.'
                : 'Optional API key. Leave blank and press enter to skip.'
              : `Confirm or edit the base URL for ${selectedProvider?.name ?? ''}.`}
          </text>

          <box marginTop={1} flexDirection="row">
            <text fg={MUTED}>{step === 'api-key' ? 'key> ' : 'url> '}</text>
            <input
              // Uncontrolled: seed the value once and read the result from
              // onSubmit. Passing a controlled `value` on every keystroke fights
              // the input's internal cursor (typing jumps around). The key={step}
              // remount re-seeds the field (and lands the cursor at the end) when
              // switching between the api-key and base-url steps.
              key={step}
              value={step === 'api-key' ? apiKey : baseUrl}
              placeholder={
                step === 'api-key' ? 'paste api key...' : 'base url...'
              }
              focused
              onSubmit={(submitted) => {
                if (!selectedProvider) return;

                // The React <input> passes the committed string; fall back to the
                // seeded state for the inherited option's event-shaped overload.
                const value =
                  typeof submitted === 'string'
                    ? submitted
                    : step === 'api-key'
                      ? apiKey
                      : baseUrl;

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
          </box>

          {error ? (
            <box marginTop={1}>
              <text fg="yellow">{error}</text>
            </box>
          ) : null}
        </box>
      )}
    </box>
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
