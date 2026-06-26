import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  type KeyEvent,
  type InputRenderable,
  type TextChunk,
} from '@opentui/core';
import { useKeyboard } from '@opentui/react';

import { type ModelInfo, type ProviderClient } from '@core/ports/chat-model';
import { ProviderId } from '@core/ports/provider-catalog';
import {
  PROVIDERS,
  createCustomProviderEntry,
  customProviderId,
  isCustomProviderId,
  type ProviderConfig,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import { getOAuthFlow } from '@runtime/auth/oauth-flows';
import { openBrowser } from '@runtime/auth/open-browser';
import {
  normalizeSingleLinePaste,
  pasteFromClipboard,
} from '@cli/ui/clipboard.js';
import { fuzzyFilter } from '@cli/ui/fuzzy-filter.js';
import { Spinner } from '@cli/ui/spinner.js';

const VISIBLE_ROWS = 12;
const BOLD = createTextAttributes({ bold: true });
const MUTED = '#8a8a8a';
const MUTED_RGBA = RGBA.fromHex(MUTED);
const INVERSE = createTextAttributes({ inverse: true });

type WizardStep =
  | 'provider'
  | 'name'
  | 'auth-method'
  | 'api-key'
  | 'base-url'
  | 'oauth-connect'
  | 'connecting';

const AUTH_METHOD_OPTIONS = [
  { label: 'Sign in', description: 'Use your subscription (browser sign-in)' },
  { label: 'Use API key', description: 'Paste a developer API key' },
] as const;

function authMethodLabel(entry: ProviderConnectionInfo): string {
  const methods = (entry as ProviderConnectionInfo).authMethods;
  if (!methods) return 'api key';
  const hasApiKey = methods.includes('apiKey');
  const hasOAuth = methods.includes('oauth');
  if (hasApiKey && hasOAuth) return 'api key · subscription';
  if (hasOAuth) return 'subscription';
  return 'api key';
}

// Synthetic row that starts the "add a custom provider" flow. Its id is not a
// real provider id; selecting it routes to the name step instead of connecting.
const ADD_CUSTOM_ID = '__add_custom__';
const ADD_CUSTOM_ENTRY = {
  id: ADD_CUSTOM_ID,
  name: '+ Add custom provider',
  description: 'Connect any OpenAI-compatible endpoint',
} as unknown as ProviderConnectionInfo;

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
  const [customName, setCustomName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authMethodIndex, setAuthMethodIndex] = useState(0);
  const [oauthStatus, setOauthStatus] = useState('');
  const scrollOffsetRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  let field: InputRenderable | null | undefined;

  // Already-connected custom providers, rebuilt from the saved config so they
  // appear in the list alongside the built-ins.
  const customEntries = useMemo(
    () =>
      Object.entries(props.configuredProviders)
        .filter(([id]) => isCustomProviderId(id))
        .map(([id, cfg]) =>
          createCustomProviderEntry(id as ProviderConnectionInfo['id'], {
            name: cfg?.name ?? id,
            baseUrl: cfg?.baseUrl ?? '',
            apiKey: cfg?.apiKey,
            defaultModel: cfg?.defaultModel,
          })
        ),
    [props.configuredProviders]
  );

  // Display order: built-in catalog (the single source of truth), then any
  // configured custom providers, then the row that adds a new custom provider.
  const providers = useMemo(
    () =>
      fuzzyFilter(
        [...PROVIDERS, ...customEntries, ADD_CUSTOM_ENTRY],
        query,
        (provider) => {
          const p = provider as ProviderConnectionInfo;
          return `${p.name} ${p.description} ${p.apiKeyEnvVar ?? ''} ${p.baseUrlEnvVar ?? ''}`;
        }
      ),
    [query, customEntries]
  );

  const clampFocus = (next: number) =>
    Math.max(0, Math.min(next, providers.length - 1));

  useEffect(() => {
    if (step !== 'provider') return;
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, step]);

  // Kick off the OAuth flow when we enter the oauth-connect step.
  useEffect(() => {
    if (step !== 'oauth-connect' || !selectedProvider) return;
    const controller = new AbortController();
    abortRef.current = controller;
    void connectProviderOAuth(selectedProvider, controller.signal);
    return () => {
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useKeyboard((key) => {
    // OAuth-connect: only allow esc to abort.
    if (step === 'oauth-connect') {
      if (key.name === 'escape') {
        abortRef.current?.abort();
        setError(null);
        setStep('provider');
      }
      return;
    }

    // Auth-method picker keyboard.
    if (step === 'auth-method') {
      if (key.name === 'escape') {
        setStep('provider');
        return;
      }
      if (key.name === 'up') {
        setAuthMethodIndex(0);
        return;
      }
      if (key.name === 'down') {
        setAuthMethodIndex(1);
        return;
      }
      if (key.name === 'return') {
        if (authMethodIndex === 0) {
          setOauthStatus('');
          setStep('oauth-connect');
        } else {
          setStep('api-key');
        }
        return;
      }
      return;
    }

    if (step !== 'provider') {
      // The api-key / base-url steps own keyboard input via TextArea; here we
      // only intercept Escape to step back. Enter is handled by onSubmit.
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
      if ((entry.id as string) === ADD_CUSTOM_ID) {
        setSelectedProvider(null);
        setCustomName('');
        setApiKey('');
        setBaseUrl('');
        setError(null);
        setStep('name');
        return;
      }
      setSelectedProvider(entry);
      const existing = props.configuredProviders[entry.id] ?? {};
      setApiKey(existing.apiKey ?? '');
      setBaseUrl(existing.baseUrl ?? entry.baseUrl ?? '');
      setError(null);

      const authMethods = (entry as ProviderConnectionInfo).authMethods ?? [
        'apiKey',
      ];
      if (authMethods.includes('oauth') && authMethods.includes('apiKey')) {
        setAuthMethodIndex(0);
        setStep('auth-method');
      } else if (
        authMethods.length === 1 &&
        authMethods[0] === 'oauth'
      ) {
        setOauthStatus('');
        setStep('oauth-connect');
      } else {
        setStep('api-key');
      }
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
            : step === 'name'
              ? 'New custom provider'
              : step === 'auth-method'
                ? `Authentication - ${selectedProvider?.name ?? ''}`
                : step === 'oauth-connect'
                  ? `Signing in - ${selectedProvider?.name ?? ''}`
                  : step === 'api-key'
                    ? `API key - ${selectedProvider?.name ?? ''}`
                    : step === 'base-url'
                      ? `Base URL - ${selectedProvider?.name ?? ''}`
                      : `Fetching models - ${selectedProvider?.name ?? ''}`}
        </text>
        <text fg={MUTED}>
          {step === 'provider'
            ? 'enter to configure · esc to cancel'
            : step === 'auth-method'
              ? 'enter to select · esc to go back'
              : step === 'oauth-connect'
                ? 'esc to cancel'
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

                const isReal = (entry.id as string) !== ADD_CUSTOM_ID;
                return (
                  <box key={entry.id} flexDirection="row">
                    <text {...(isFocused ? { bg: 'cyan', fg: 'black' } : {})}>
                      {isFocused ? '› ' : '  '}
                      {entry.name}
                      {isConnected ? ' ✓' : ''}
                    </text>
                    {isReal ? (
                      <text fg={MUTED}>
                        {'  '}
                        {authMethodLabel(entry as ProviderConnectionInfo)}
                      </text>
                    ) : null}
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
      ) : step === 'auth-method' ? (
        <box flexDirection="column">
          <text fg={MUTED} marginBottom={1}>
            How do you want to connect {selectedProvider?.name ?? ''}?
          </text>
          {AUTH_METHOD_OPTIONS.map((opt, i) => (
            <box key={opt.label}>
              <text {...(authMethodIndex === i ? { bg: 'cyan', fg: 'black' } : {})}>
                {authMethodIndex === i ? '› ' : '  '}
                {opt.label}
                {'  '}
                <text fg={authMethodIndex === i ? 'black' : MUTED}>
                  {opt.description}
                </text>
              </text>
            </box>
          ))}
        </box>
      ) : step === 'oauth-connect' ? (
        <box flexDirection="column">
          <box flexDirection="row">
            <Spinner fg="cyan" />
            <text fg={MUTED}> {oauthStatus || 'Opening browser...'}</text>
          </box>
          {error ? (
            <box marginTop={1}>
              <text fg="yellow">{error}</text>
            </box>
          ) : null}
        </box>
      ) : step === 'connecting' ? (
        <box flexDirection="row">
          <Spinner fg="cyan" />
          <text fg={MUTED}> Connecting and fetching models...</text>
        </box>
      ) : (
        <box flexDirection="column">
          <text fg={MUTED}>
            {step === 'name'
              ? 'Enter a name for the custom provider.'
              : step === 'api-key'
                ? selectedProvider?.apiKeyRequired
                  ? 'Enter the API key for this provider.'
                  : 'Optional API key. Leave blank and press enter to skip.'
                : `Confirm or edit the base URL for ${selectedProvider?.name ?? ''}.`}
          </text>

          <box marginTop={1} flexDirection="row">
            <text fg={MUTED}>
              {step === 'name'
                ? 'name> '
                : step === 'api-key'
                  ? 'key> '
                  : 'url> '}
            </text>
            <input
              key={step}
              width="100%"
              value={
                step === 'name'
                  ? customName
                  : step === 'api-key'
                    ? apiKey
                    : baseUrl
              }
              placeholder={
                step === 'name'
                  ? 'provider name...'
                  : step === 'api-key'
                    ? 'paste api key...'
                    : 'base url...'
              }
              placeholderColor={MUTED}
              textColor="white"
              focusedTextColor="white"
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
              cursorColor="white"
              focused
              onInput={(nextValue) => {
                if (step === 'name') {
                  setCustomName(nextValue);
                } else if (step === 'api-key') {
                  setApiKey(nextValue);
                } else {
                  setBaseUrl(nextValue);
                }
              }}
              onSubmit={() => {
                if (!field) return;

                const submitted = field.value;

                if (step === 'name') {
                  const name = submitted.trim();
                  if (!name) {
                    setError('A name is required.');
                    return;
                  }
                  // Build the custom catalog entry now so the remaining steps
                  // (api-key, base-url) reuse the shared provider flow.
                  const id = customProviderId(name);
                  setCustomName(name);
                  setSelectedProvider(
                    createCustomProviderEntry(id, { name, baseUrl: '' })
                  );
                  setError(null);
                  setStep('api-key');
                  return;
                }

                if (!selectedProvider) return;

                if (step === 'api-key') {
                  const nextApiKey = submitted.trim();
                  if (selectedProvider.apiKeyRequired && !nextApiKey) {
                    setError('An API key is required for this provider.');
                    return;
                  }

                  setError(null);
                  setApiKey(nextApiKey);
                  setStep('base-url');
                  return;
                }

                const nextBaseUrl = submitted.trim() || baseUrl.trim();
                if (!nextBaseUrl) {
                  setError('A base URL is required.');
                  return;
                }

                setBaseUrl(nextBaseUrl);
                void connectProvider(
                  selectedProvider,
                  nextApiKeyValue(apiKey),
                  nextBaseUrl
                );
              }}
              onKeyDown={(event) => {
                if (event.name === 'escape') {
                  event.preventDefault();
                  setError(null);
                  setStep('provider');
                }
              }}
              ref={(item) => {
                field = item;
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
      if (isCustomProviderId(provider.id)) {
        // Custom providers have no env-var slots; persist everything we need to
        // rebuild them on the next launch.
        config.name = provider.name;
        config.baseUrl = nextBaseUrl;
        if (nextApiKey) {
          config.apiKey = nextApiKey;
        }
      } else {
        if (nextApiKey && provider.apiKeyEnvVar) {
          config.apiKey = nextApiKey;
        }
        if (provider.baseUrlEnvVar) {
          config.baseUrl = nextBaseUrl;
        }
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

  async function connectProviderOAuth(
    provider: ProviderConnectionInfo,
    signal: AbortSignal
  ): Promise<void> {
    const flow = getOAuthFlow(provider.id as ProviderId);
    if (!flow) {
      setError(`OAuth sign-in is not supported for ${provider.name}.`);
      setStep('provider');
      return;
    }

    try {
      const oauthCreds = await flow.login({
        openUrl: openBrowser,
        notify: (msg) => setOauthStatus(msg),
        signal,
      });

      if (signal.aborted) return;

      setOauthStatus('Fetching available models...');

      const client = provider.create({
        baseUrl: oauthCreds.extra?.['endpoint'] ?? provider.baseUrl ?? '',
        oauth: oauthCreds,
        // At connect time return the freshly-minted token directly; the
        // ProviderRegistry wires up the full refresh logic on subsequent starts.
        getAccessToken: async () => oauthCreds.accessToken,
      });

      const models = await client.listModels();
      if (signal.aborted) return;

      const firstModel = models[0];
      if (!firstModel) {
        throw new Error(`No models are available for ${provider.name}.`);
      }

      const modelId = client.getDefaultModel() ?? firstModel.id;
      const selectedModel = models.find((m) => m.id === modelId) ?? firstModel;

      const config: ProviderConfig = {
        authType: 'oauth',
        oauth: oauthCreds,
      };

      props.onComplete({
        providerId: provider.id,
        provider,
        client,
        selectedModel,
        models,
        config,
      });
    } catch (caughtError) {
      if (signal.aborted) return;
      setError(
        caughtError instanceof Error ? caughtError.message : String(caughtError)
      );
      setStep('provider');
    }
  }

  function nextApiKeyValue(current: string): string | undefined {
    const trimmed = current.trim();
    return trimmed ? trimmed : undefined;
  }
}
