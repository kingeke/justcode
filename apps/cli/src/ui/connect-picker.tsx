import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  StyledText,
  createTextAttributes,
  RGBA,
  type InputRenderable,
  type TextChunk,
} from '@opentui/core';
import { KeyName, printableInput } from '@cli/ui/key-name.js';
import { useKeyboard } from '@opentui/react';

import { type ModelInfo, type ProviderClient } from '@core/ports/chat-model';
import { AuthMethod, ProviderId } from '@core/ports/provider-catalog';
import {
  PROVIDERS,
  createCustomProviderEntry,
  customProviderId,
  isCustomProviderId,
  type ProviderConfig,
  type ProviderConnectionInfo,
} from '@core/ports/provider-catalog';
import {
  detectClaudeExecutable,
  detectClaudeConfigDirs,
} from '@providers/claude-code/detect-claude';
import { detectCursorExecutable } from '@providers/cursor/detect-cursor';
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

export enum WizardStep {
  Provider = 'provider',
  Name = 'name',
  AuthMethod = 'auth-method',
  ApiKey = 'api-key',
  BaseUrl = 'base-url',
  ExecutablePath = 'executable-path',
  ConfigDir = 'config-dir',
  OauthConnect = 'oauth-connect',
  Connecting = 'connecting',
}

const AUTH_METHOD_OPTIONS = [
  { label: 'Sign in', description: 'Use your subscription (browser sign-in)' },
  { label: 'Use API key', description: 'Paste a developer API key' },
] as const;

function authMethodLabel(entry: ProviderConnectionInfo): string {
  if (entry.directConnect) {
    return entry.id === ProviderId.Cursor
      ? 'subscription · cursor login'
      : 'subscription · claude login';
  }
  const methods = (entry as ProviderConnectionInfo).authMethods;
  if (!methods) return 'api key';
  const hasApiKey = methods.includes(AuthMethod.ApiKey);
  const hasOAuth = methods.includes(AuthMethod.OAuth);
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
  const [step, setStep] = useState<WizardStep>(WizardStep.Provider);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedProvider, setSelectedProvider] =
    useState<ProviderConnectionInfo | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  // The CLI executable path for direct-connect providers (`claude` for Claude
  // Code, `cursor-agent` for Cursor), prefilled with the saved value or an
  // auto-detected install so users with several installs can confirm it.
  const [executablePath, setExecutablePath] = useState('');
  // Direct-connect copy differs per CLI (executable name, config dir).
  const directConnectCursor = selectedProvider?.id === ProviderId.Cursor;
  const directConnectCliName = directConnectCursor ? 'Cursor' : 'Claude';
  // The CLAUDE_CONFIG_DIR (account/login dir) for direct-connect providers, and
  // the auto-detected candidates (`~/.claude`, `~/.claude-work`, …) shown as a
  // hint so the user can pick which account to use.
  const [configDir, setConfigDir] = useState('');
  const [detectedConfigDirs, setDetectedConfigDirs] = useState<string[]>([]);
  const [customName, setCustomName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [authMethodIndex, setAuthMethodIndex] = useState(0);
  const [oauthStatus, setOauthStatus] = useState('');
  // When an OAuth flow asks the user to paste a value (e.g. Anthropic's
  // authorization code), we render an input during the oauth-connect step and
  // resolve the flow's promptInput promise once the user submits.
  const [codePrompt, setCodePrompt] = useState<{ label: string } | null>(null);
  const [codeInput, setCodeInput] = useState('');
  const codeResolverRef = useRef<((value: string) => void) | null>(null);
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
    if (step !== WizardStep.Provider) return;
    setFocusedIndex(0);
    scrollOffsetRef.current = 0;
  }, [query, step]);

  // Kick off the OAuth flow when we enter the oauth-connect step.
  useEffect(() => {
    if (step !== WizardStep.OauthConnect || !selectedProvider) return;
    const controller = new AbortController();
    abortRef.current = controller;
    void connectProviderOAuth(selectedProvider, controller.signal);
    return () => {
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useKeyboard((key) => {
    const isBack =
      key.name === KeyName.Escape || (key.ctrl && key.name === KeyName.C);

    // OAuth-connect: only allow esc/ctrl+c to abort.
    if (step === WizardStep.OauthConnect) {
      if (isBack) {
        abortRef.current?.abort();
        codeResolverRef.current = null;
        setCodePrompt(null);
        setCodeInput('');
        setError(null);
        setStep(WizardStep.Provider);
      }
      return;
    }

    // Auth-method picker keyboard.
    if (step === WizardStep.AuthMethod) {
      if (isBack) {
        setStep(WizardStep.Provider);
        return;
      }
      if (key.name === KeyName.Up) {
        setAuthMethodIndex(0);
        return;
      }
      if (key.name === KeyName.Down) {
        setAuthMethodIndex(1);
        return;
      }
      if (key.name === KeyName.Return) {
        if (authMethodIndex === 0) {
          setOauthStatus('');
          setStep(WizardStep.OauthConnect);
        } else {
          setStep(WizardStep.ApiKey);
        }
        return;
      }
      return;
    }

    if (step !== WizardStep.Provider) {
      // The api-key / base-url steps own keyboard input via TextArea; here we
      // only intercept Escape to step back. Enter is handled by onSubmit.
      if (isBack) {
        setError(null);
        setStep(WizardStep.Provider);
      }
      return;
    }

    if (isBack) {
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
        setStep(WizardStep.Name);
        return;
      }
      setSelectedProvider(entry);
      const existing = props.configuredProviders[entry.id] ?? {};
      setApiKey(existing.apiKey ?? '');
      setBaseUrl(existing.baseUrl ?? entry.baseUrl ?? '');
      setError(null);

      // Direct-connect providers (Claude Code) have no key or URL to collect —
      // auth lives in the user's `claude` login — but we do let them confirm or
      // change which `claude` executable to drive. Prefill with the saved path
      // or an auto-detected install and route to the executable-path step.
      if ((entry as ProviderConnectionInfo).directConnect) {
        const savedExe = existing.executablePath ?? '';
        setExecutablePath(savedExe);
        setConfigDir(existing.configDir ?? '');
        setDetectedConfigDirs([]);
        setStep(WizardStep.ExecutablePath);
        if (!savedExe) {
          const detect =
            entry.id === ProviderId.Cursor
              ? detectCursorExecutable
              : detectClaudeExecutable;
          void detect().then((detected) => {
            // Don't clobber a path the user has already started typing.
            if (detected) setExecutablePath((prev) => prev || detected);
          });
        }
        // Surface the available account dirs for the config-dir step's hint.
        // Only Claude Code has discoverable account dirs (~/.claude siblings).
        if (entry.id === ProviderId.ClaudeCode) {
          void detectClaudeConfigDirs().then(setDetectedConfigDirs);
        }
        return;
      }

      const authMethods = (entry as ProviderConnectionInfo).authMethods ?? [
        AuthMethod.ApiKey,
      ];
      if (
        authMethods.includes(AuthMethod.OAuth) &&
        authMethods.includes(AuthMethod.ApiKey)
      ) {
        setAuthMethodIndex(0);
        setStep(WizardStep.AuthMethod);
      } else if (
        authMethods.length === 1 &&
        authMethods[0] === AuthMethod.OAuth
      ) {
        setOauthStatus('');
        setStep(WizardStep.OauthConnect);
      } else {
        setStep(WizardStep.ApiKey);
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
          {step === WizardStep.Provider
            ? 'Connect provider'
            : step === WizardStep.Name
              ? 'New custom provider'
              : step === WizardStep.AuthMethod
                ? `Authentication - ${selectedProvider?.name ?? ''}`
                : step === WizardStep.OauthConnect
                  ? `Signing in - ${selectedProvider?.name ?? ''}`
                  : step === WizardStep.ApiKey
                    ? `API key - ${selectedProvider?.name ?? ''}`
                    : step === WizardStep.BaseUrl
                      ? `Base URL - ${selectedProvider?.name ?? ''}`
                      : step === WizardStep.ExecutablePath
                        ? `${directConnectCliName} executable - ${selectedProvider?.name ?? ''}`
                        : step === WizardStep.ConfigDir
                          ? `${directConnectCliName} account - ${selectedProvider?.name ?? ''}`
                          : `Fetching models - ${selectedProvider?.name ?? ''}`}
        </text>
        <text fg={MUTED}>
          {step === WizardStep.Provider
            ? 'enter to configure · esc to cancel'
            : step === WizardStep.AuthMethod
              ? 'enter to select · esc to go back'
              : step === WizardStep.OauthConnect
                ? codePrompt
                  ? 'enter to submit · esc to cancel'
                  : 'esc to cancel'
                : step === WizardStep.Connecting
                  ? 'fetching models...'
                  : 'enter to continue · esc to go back'}
        </text>
      </box>

      {step === WizardStep.Provider ? (
        <>
          <box marginBottom={1}>
            <text content={queryLineContent(query, 'search providers...')} />
          </box>

          {error ? (
            <box marginBottom={1}>
              <text fg="yellow">{error}</text>
            </box>
          ) : null}

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
      ) : step === WizardStep.AuthMethod ? (
        <box flexDirection="column">
          <text fg={MUTED} marginBottom={1}>
            How do you want to connect {selectedProvider?.name ?? ''}?
          </text>
          {AUTH_METHOD_OPTIONS.map((opt, i) => (
            <box key={opt.label}>
              <text
                {...(authMethodIndex === i ? { bg: 'cyan', fg: 'black' } : {})}
              >
                {authMethodIndex === i ? '› ' : '  '}
                {opt.label}
                {'  '}
                <span fg={authMethodIndex === i ? 'black' : MUTED}>
                  {opt.description}
                </span>
              </text>
            </box>
          ))}
        </box>
      ) : step === WizardStep.OauthConnect ? (
        <box flexDirection="column">
          {codePrompt ? (
            <box flexDirection="column">
              <text fg={MUTED}>
                {oauthStatus ||
                  'Approve access in the browser, then paste the code shown.'}
              </text>
              <box marginTop={1} flexDirection="row">
                <text fg={MUTED}>{codePrompt.label}&gt; </text>
                <input
                  width="100%"
                  value={codeInput}
                  placeholder="paste code..."
                  placeholderColor={MUTED}
                  textColor="white"
                  focusedTextColor="white"
                  backgroundColor="transparent"
                  focusedBackgroundColor="transparent"
                  cursorColor="white"
                  focused
                  onInput={(nextValue) => setCodeInput(nextValue)}
                  onSubmit={() => {
                    const resolve = codeResolverRef.current;
                    const value = codeInput.trim();
                    if (!value) {
                      setError('A code is required.');
                      return;
                    }
                    codeResolverRef.current = null;
                    setError(null);
                    setCodePrompt(null);
                    setOauthStatus('Completing sign-in...');
                    resolve?.(value);
                  }}
                />
              </box>
            </box>
          ) : (
            <box flexDirection="row">
              <Spinner fg="cyan" />
              <text fg={MUTED}> {oauthStatus || 'Opening browser...'}</text>
            </box>
          )}
          {error ? (
            <box marginTop={1}>
              <text fg="yellow">{error}</text>
            </box>
          ) : null}
        </box>
      ) : step === WizardStep.Connecting ? (
        <box flexDirection="row">
          <Spinner fg="cyan" />
          <text fg={MUTED}> Connecting and fetching models...</text>
        </box>
      ) : (
        <box flexDirection="column">
          <text fg={MUTED}>
            {step === WizardStep.Name
              ? 'Enter a name for the custom provider.'
              : step === WizardStep.ApiKey
                ? selectedProvider?.apiKeyRequired
                  ? 'Enter the API key for this provider.'
                  : 'Optional API key. Leave blank and press enter to skip.'
                : step === WizardStep.ExecutablePath
                  ? directConnectCursor
                    ? 'Confirm or edit the `cursor-agent` executable to use. Leave blank to auto-detect it.'
                    : 'Confirm or edit the `claude` executable to use. Leave blank to let the Agent SDK find it.'
                  : step === WizardStep.ConfigDir
                    ? directConnectCursor
                      ? 'Config directory (CURSOR_CONFIG_DIR) selecting the account. Leave blank for the default.'
                      : detectedConfigDirs.length > 1
                        ? `Which account? Found: ${detectedConfigDirs.join(', ')}. Leave blank for the default (~/.claude).`
                        : 'Config directory (CLAUDE_CONFIG_DIR) selecting the account. Leave blank for the default (~/.claude).'
                    : `Confirm or edit the base URL for ${selectedProvider?.name ?? ''}.`}
          </text>

          <box marginTop={1} flexDirection="row">
            <text fg={MUTED}>
              {step === WizardStep.Name
                ? 'name> '
                : step === WizardStep.ApiKey
                  ? 'key> '
                  : step === WizardStep.ExecutablePath
                    ? 'path> '
                    : step === WizardStep.ConfigDir
                      ? 'dir> '
                      : 'url> '}
            </text>
            <input
              key={step}
              width="100%"
              value={
                step === WizardStep.Name
                  ? customName
                  : step === WizardStep.ApiKey
                    ? apiKey
                    : step === WizardStep.ExecutablePath
                      ? executablePath
                      : step === WizardStep.ConfigDir
                        ? configDir
                        : baseUrl
              }
              placeholder={
                step === WizardStep.Name
                  ? 'provider name...'
                  : step === WizardStep.ApiKey
                    ? 'paste api key...'
                    : step === WizardStep.ExecutablePath
                      ? directConnectCursor
                        ? 'cursor-agent'
                        : 'claude'
                      : step === WizardStep.ConfigDir
                        ? directConnectCursor
                          ? '~/.cursor'
                          : '~/.claude'
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
                if (step === WizardStep.Name) {
                  setCustomName(nextValue);
                } else if (step === WizardStep.ApiKey) {
                  setApiKey(nextValue);
                } else if (step === WizardStep.ExecutablePath) {
                  setExecutablePath(nextValue);
                } else if (step === WizardStep.ConfigDir) {
                  setConfigDir(nextValue);
                } else {
                  setBaseUrl(nextValue);
                }
              }}
              onSubmit={() => {
                if (!field) return;

                const submitted = field.value;

                if (step === WizardStep.Name) {
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
                  setStep(WizardStep.ApiKey);
                  return;
                }

                if (!selectedProvider) return;

                if (step === WizardStep.ExecutablePath) {
                  // Blank means "let the Agent SDK resolve `claude` itself".
                  // Advance to pick the account (config dir) before connecting.
                  setExecutablePath(submitted.trim());
                  setError(null);
                  setStep(WizardStep.ConfigDir);
                  return;
                }

                if (step === WizardStep.ConfigDir) {
                  // Blank means the default account (~/.claude).
                  const dir = submitted.trim();
                  setConfigDir(dir);
                  void connectProvider(
                    selectedProvider,
                    undefined,
                    selectedProvider.baseUrl ?? '',
                    executablePath.trim() || undefined,
                    dir || undefined
                  );
                  return;
                }

                if (step === WizardStep.ApiKey) {
                  const nextApiKey = submitted.trim();
                  if (selectedProvider.apiKeyRequired && !nextApiKey) {
                    setError('An API key is required for this provider.');
                    return;
                  }

                  setError(null);
                  setApiKey(nextApiKey);
                  setStep(WizardStep.BaseUrl);
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
                  setStep(WizardStep.Provider);
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
    nextBaseUrl: string,
    nextExecutablePath?: string | undefined,
    nextConfigDir?: string | undefined
  ): Promise<void> {
    setStep(WizardStep.Connecting);

    try {
      const client = provider.create({
        apiKey: nextApiKey,
        baseUrl: nextBaseUrl,
        executablePath: nextExecutablePath,
        configDir: nextConfigDir,
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
        // Persist the chosen `claude` executable for direct-connect providers so
        // the same install is used on every launch. Blank means "auto-detect",
        // so we simply omit it.
        if (provider.directConnect && nextExecutablePath) {
          config.executablePath = nextExecutablePath;
        }
        // Persist the chosen account dir (CLAUDE_CONFIG_DIR); blank = default.
        if (provider.directConnect && nextConfigDir) {
          config.configDir = nextConfigDir;
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
      // Direct-connect providers fall back to the executable-path step so the
      // user can fix a wrong `claude` path; others return to the base-url step.
      setStep(
        provider.directConnect ? WizardStep.ExecutablePath : WizardStep.BaseUrl
      );
    }
  }

  async function connectProviderOAuth(
    provider: ProviderConnectionInfo,
    signal: AbortSignal
  ): Promise<void> {
    const flow = getOAuthFlow(provider.id as ProviderId);
    if (!flow) {
      setError(`OAuth sign-in is not supported for ${provider.name}.`);
      setStep(WizardStep.Provider);
      return;
    }

    try {
      const oauthCreds = await flow.login({
        openUrl: openBrowser,
        notify: (msg) => setOauthStatus(msg),
        promptInput: (label) =>
          new Promise<string>((resolve) => {
            codeResolverRef.current = resolve;
            setCodeInput('');
            setCodePrompt({ label });
          }),
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
        authType: AuthMethod.OAuth,
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
      setStep(WizardStep.Provider);
    }
  }

  function nextApiKeyValue(current: string): string | undefined {
    const trimmed = current.trim();
    return trimmed ? trimmed : undefined;
  }
}
