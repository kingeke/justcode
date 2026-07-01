import * as React from 'react';

import {
  AuthMethod,
  SettingsSection,
  WebviewProviderKind,
  type WebviewProvider,
} from '@ext/shared/protocol';
import {
  SettingsHostMessageType,
  SettingsWebviewMessageType,
  type SettingsAppInfo,
  type SettingsMcpServerStatus,
} from '@ext/shared/settings-protocol';
import {
  logoUri,
  onSettingsMessage,
  postSettingsToHost,
} from '@ext/webview/vscode-api';
import { PlusIcon } from '@ext/webview/components/Icons';
import { APP_NAME } from '@core/branding';
import { CRYPTO_WALLETS, KOFI_URL } from '@core/support';

const KIND_LABELS: Record<WebviewProviderKind, string> = {
  [WebviewProviderKind.ApiKey]: 'API Key',
  [WebviewProviderKind.OAuth]: 'Sign-in',
  [WebviewProviderKind.Local]: 'Local',
  [WebviewProviderKind.Custom]: 'Custom',
};

/** Result shape shared by the inline connect and OAuth flows. */
interface ConnectResult {
  success: boolean;
  error?: string | undefined;
}

/** Host-streamed OAuth events the active wizard listens for. */
interface OAuthHandlers {
  onStatus: (message: string) => void;
  onPrompt: (label: string) => void;
  onResult: (result: ConnectResult) => void;
}

/** OAuth controls handed down to the wizard to drive an in-extension sign-in. */
interface OAuthControls {
  start: (providerId: string, handlers: OAuthHandlers) => void;
  sendInput: (value: string) => void;
  cancel: () => void;
}

enum Tab {
  Providers = 'providers',
  Mcp = 'mcp',
  About = 'about',
}

const TABS: { id: Tab; label: string }[] = [
  { id: Tab.Providers, label: 'Providers' },
  { id: Tab.Mcp, label: 'MCP Servers' },
  { id: Tab.About, label: `About ${APP_NAME}` },
];

/** Result of the most recent MCP save, shown beneath the editor. */
interface McpSaveState {
  success: boolean;
  error?: string | undefined;
  servers?: SettingsMcpServerStatus[];
}

function matchesSearch(provider: WebviewProvider, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    provider.name.toLowerCase().includes(q) ||
    provider.description.toLowerCase().includes(q)
  );
}

export function SettingsApp(): React.JSX.Element {
  const [tab, setTab] = React.useState<Tab>(Tab.Providers);
  const [providers, setProviders] = React.useState<WebviewProvider[]>([]);
  const [appInfo, setAppInfo] = React.useState<SettingsAppInfo | undefined>();
  // MCP editor state: the last text the host sent (for the "Loaded"/reset
  // baseline), whether a save is in flight, and the most recent save outcome.
  const [mcpContent, setMcpContent] = React.useState<string | undefined>();
  const [mcpSaving, setMcpSaving] = React.useState(false);
  const [mcpSaveState, setMcpSaveState] = React.useState<
    McpSaveState | undefined
  >();

  // Callback ref: set by ConnectWizard when it fires TestConnectProvider so
  // the incoming ConnectResult message can be routed back to the right form.
  const connectResultRef = React.useRef<
    ((result: { success: boolean; error?: string | undefined }) => void) | null
  >(null);

  // Callbacks set by the wizard running an OAuth sign-in, so the host's
  // streamed status/prompt/result messages reach the right form.
  const oauthHandlersRef = React.useRef<OAuthHandlers | null>(null);

  React.useEffect(() => {
    const unsubscribe = onSettingsMessage((message) => {
      switch (message.type) {
        case SettingsHostMessageType.Snapshot:
          setAppInfo(message.appInfo);
          setProviders(message.providers);
          break;
        case SettingsHostMessageType.ProvidersUpdate:
          setProviders(message.providers);
          break;
        case SettingsHostMessageType.ConnectResult:
          connectResultRef.current?.(message);
          connectResultRef.current = null;
          break;
        case SettingsHostMessageType.OAuthStatus:
          oauthHandlersRef.current?.onStatus(message.message);
          break;
        case SettingsHostMessageType.OAuthPrompt:
          oauthHandlersRef.current?.onPrompt(message.label);
          break;
        case SettingsHostMessageType.OAuthResult:
          oauthHandlersRef.current?.onResult(message);
          oauthHandlersRef.current = null;
          break;
        case SettingsHostMessageType.McpConfig:
          setMcpContent(message.content);
          break;
        case SettingsHostMessageType.McpSaveResult:
          setMcpSaving(false);
          setMcpSaveState({
            success: message.success,
            ...(message.error !== undefined ? { error: message.error } : {}),
            ...(message.servers !== undefined
              ? { servers: message.servers }
              : {}),
          });
          break;
        case SettingsHostMessageType.FocusSection:
          if (message.section === SettingsSection.Mcp) setTab(Tab.Mcp);
          else if (message.section === SettingsSection.Providers)
            setTab(Tab.Providers);
          break;
      }
    });
    postSettingsToHost({ type: SettingsWebviewMessageType.Init });
    postSettingsToHost({ type: SettingsWebviewMessageType.GetMcpConfig });
    return unsubscribe;
  }, []);

  const saveMcpConfig = (content: string): void => {
    setMcpSaving(true);
    setMcpSaveState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.SaveMcpConfig,
      content,
    });
  };

  const startOAuth = (providerId: string, handlers: OAuthHandlers): void => {
    oauthHandlersRef.current = handlers;
    postSettingsToHost({
      type: SettingsWebviewMessageType.OAuthConnectProvider,
      providerId,
    });
  };

  const sendOAuthInput = (value: string): void => {
    postSettingsToHost({ type: SettingsWebviewMessageType.OAuthInput, value });
  };

  const cancelOAuth = (): void => {
    oauthHandlersRef.current = null;
    postSettingsToHost({ type: SettingsWebviewMessageType.CancelOAuth });
  };

  const addCustom = (
    name: string,
    apiKey: string | undefined,
    baseUrl: string,
    onResult: (result: ConnectResult) => void
  ): void => {
    connectResultRef.current = onResult;
    postSettingsToHost({
      type: SettingsWebviewMessageType.AddCustomProvider,
      name,
      apiKey,
      baseUrl,
    });
  };

  const testConnect = (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: { success: boolean; error?: string | undefined }) => void
  ): void => {
    connectResultRef.current = onResult;
    postSettingsToHost({
      type: SettingsWebviewMessageType.TestConnectProvider,
      providerId,
      apiKey,
      baseUrl,
    });
  };

  const disconnect = (providerId: string): void => {
    postSettingsToHost({
      type: SettingsWebviewMessageType.DisconnectProvider,
      providerId,
    });
  };

  return (
    <div className="settings-app">
      <div className="settings-app-header">
        {logoUri ? (
          <img className="brand-logo" src={logoUri} alt="" aria-hidden="true" />
        ) : null}
        <span className="settings-app-title">Settings</span>
      </div>

      <div className="settings-app-body">
        <nav className="settings-nav" aria-label="Settings sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`settings-nav-item ${
                tab === entry.id ? 'settings-nav-item-active' : ''
              }`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          {tab === Tab.Providers ? (
            <ProvidersTab
              providers={providers}
              oauth={{
                start: startOAuth,
                sendInput: sendOAuthInput,
                cancel: cancelOAuth,
              }}
              onTestConnect={testConnect}
              onDisconnect={disconnect}
              onAddCustom={addCustom}
            />
          ) : tab === Tab.Mcp ? (
            <McpTab
              content={mcpContent}
              saving={mcpSaving}
              saveState={mcpSaveState}
              onSave={saveMcpConfig}
            />
          ) : (
            <AboutTab appInfo={appInfo} />
          )}
        </div>
      </div>
    </div>
  );
}

function ProvidersTab({
  providers,
  oauth,
  onTestConnect,
  onDisconnect,
  onAddCustom,
}: {
  providers: WebviewProvider[];
  oauth: OAuthControls;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: ConnectResult) => void
  ) => void;
  onDisconnect: (providerId: string) => void;
  onAddCustom: (
    name: string,
    apiKey: string | undefined,
    baseUrl: string,
    onResult: (result: ConnectResult) => void
  ) => void;
}): React.JSX.Element {
  const [search, setSearch] = React.useState('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [showCustomForm, setShowCustomForm] = React.useState(false);

  const connected = providers.filter(
    (p) => p.connected && matchesSearch(p, search)
  );
  const available = providers.filter(
    (p) => !p.connected && matchesSearch(p, search)
  );

  const hasOAuthOnly = available.some(
    (p) =>
      p.kind === WebviewProviderKind.OAuth &&
      !p.authMethods.includes(AuthMethod.ApiKey)
  );

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Providers</h2>

      <div className="provider-search-wrap">
        <input
          className="provider-search-input"
          type="search"
          placeholder="Search providers…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setExpandedId(null);
          }}
          aria-label="Search providers"
        />
      </div>

      {connected.length > 0 ? (
        <>
          <div className="settings-subhead">Connected providers</div>
          <div className="provider-list">
            {connected.map((provider) => (
              <div key={provider.id} className="provider-row">
                <div className="provider-row-main">
                  <span className="provider-name">
                    {provider.name}
                    <span className="provider-badge">
                      {KIND_LABELS[provider.kind]}
                    </span>
                  </span>
                </div>
                <button
                  type="button"
                  className="provider-action provider-action-danger"
                  onClick={() => onDisconnect(provider.id)}
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {available.length > 0 ? (
        <>
          <div className="settings-subhead">Available providers</div>
          <div className="provider-list">
            {available.map((provider) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                expanded={expandedId === provider.id}
                onExpand={() =>
                  setExpandedId(expandedId === provider.id ? null : provider.id)
                }
                oauth={oauth}
                onTestConnect={onTestConnect}
              />
            ))}
          </div>
        </>
      ) : null}

      {search && connected.length === 0 && available.length === 0 ? (
        <p className="settings-hint">
          No providers match &ldquo;{search}&rdquo;.
        </p>
      ) : null}

      {hasOAuthOnly ? (
        <p className="settings-hint">
          Sign-in providers (e.g. GitHub Copilot) open your browser to complete
          the OAuth flow, then connect automatically.
        </p>
      ) : null}

      <div className="provider-list">
        <div className="provider-row-wrap">
          <div className="provider-row">
            <div className="provider-row-main">
              <span className="provider-name">Add custom provider</span>
              <span className="provider-desc">
                Connect any OpenAI-compatible endpoint
              </span>
            </div>
            <button
              type="button"
              className="provider-action"
              onClick={() => setShowCustomForm((prev) => !prev)}
            >
              {showCustomForm ? (
                'Cancel'
              ) : (
                <>
                  <PlusIcon size={13} /> Add
                </>
              )}
            </button>
          </div>
          {showCustomForm ? (
            <CustomProviderForm
              onAddCustom={onAddCustom}
              onDone={() => setShowCustomForm(false)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  expanded,
  onExpand,
  oauth,
  onTestConnect,
}: {
  provider: WebviewProvider;
  expanded: boolean;
  onExpand: () => void;
  oauth: OAuthControls;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: ConnectResult) => void
  ) => void;
}): React.JSX.Element {
  return (
    <div className="provider-row-wrap">
      <div className="provider-row">
        <div className="provider-row-main">
          <span className="provider-name">{provider.name}</span>
          <span className="provider-desc">{provider.description}</span>
        </div>
        <button
          type="button"
          className="provider-action"
          title={
            expanded
              ? `Cancel connecting ${provider.name}`
              : `Connect ${provider.name}`
          }
          onClick={onExpand}
        >
          {expanded ? (
            'Cancel'
          ) : (
            <>
              <PlusIcon size={13} /> Connect
            </>
          )}
        </button>
      </div>

      {expanded ? (
        <ConnectWizard
          provider={provider}
          oauth={oauth}
          onTestConnect={onTestConnect}
          onDone={onExpand}
          onCancel={onExpand}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Connect wizard — mirrors the CLI's api-key → base-url → connecting steps
// ---------------------------------------------------------------------------

enum WizardStep {
  AuthMethod = 'auth-method',
  ApiKey = 'api-key',
  BaseUrl = 'base-url',
  Connecting = 'connecting',
  OAuth = 'oauth',
}

enum AuthChoice {
  OAuth = 'oauth',
  ApiKey = 'apiKey',
}

function initialStep(provider: WebviewProvider): WizardStep {
  // Providers that support both OAuth AND API key offer an auth-method picker.
  if (
    provider.authMethods.includes(AuthMethod.OAuth) &&
    provider.authMethods.includes(AuthMethod.ApiKey)
  ) {
    return WizardStep.AuthMethod;
  }
  // OAuth-only providers (e.g. GitHub Copilot) go straight to the sign-in step.
  if (provider.authMethods.includes(AuthMethod.OAuth)) {
    return WizardStep.OAuth;
  }
  // All providers (including local ones) go through the API key step — it's
  // just optional for providers where apiKeyRequired is false.
  return WizardStep.ApiKey;
}

function ConnectWizard({
  provider,
  oauth,
  onTestConnect,
  onDone,
  onCancel,
}: {
  provider: WebviewProvider;
  oauth: OAuthControls;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: ConnectResult) => void
  ) => void;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const first = initialStep(provider);
  const [step, setStep] = React.useState<WizardStep>(first);
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState(provider.defaultBaseUrl ?? '');
  const [error, setError] = React.useState<string | null>(null);
  // OAuth-step UI state: the host's latest status line and, when the flow needs
  // the user to paste something, the prompt label + input value.
  const [oauthStatus, setOauthStatus] = React.useState('');
  const [oauthPrompt, setOauthPrompt] = React.useState<string | null>(null);
  const [oauthInput, setOauthInput] = React.useState('');

  // "Cancel" on the first step (nothing to go back to), "Back" on later steps.
  const backLabel = step === first ? 'Cancel' : 'Back';

  const startOAuth = (): void => {
    setError(null);
    setOauthStatus('Opening your browser to sign in…');
    setOauthPrompt(null);
    setOauthInput('');
    setStep(WizardStep.OAuth);
    oauth.start(provider.id, {
      onStatus: (message) => setOauthStatus(message),
      onPrompt: (label) => {
        setOauthPrompt(label);
        setOauthInput('');
      },
      onResult: (result) => {
        if (result.success) {
          onDone();
        } else {
          // Stay on the sign-in step and surface the error with a retry; the
          // user can Cancel to fall back to the auth picker if there is one.
          setError(result.error ?? 'Sign-in failed.');
          setOauthPrompt(null);
          setStep(WizardStep.OAuth);
        }
      },
    });
  };

  const handleAuthMethod = (method: AuthChoice): void => {
    if (method === AuthChoice.OAuth) {
      startOAuth();
    } else {
      setStep(WizardStep.ApiKey);
    }
  };

  const submitOAuthInput = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (!oauthInput.trim()) return;
    oauth.sendInput(oauthInput.trim());
    setOauthPrompt(null);
    setOauthStatus('Completing sign-in…');
  };

  const cancelOAuth = (): void => {
    oauth.cancel();
    onCancel();
  };

  // OAuth-only providers open straight into the sign-in step; kick the flow off
  // once on mount. The ref guard keeps StrictMode's double-invoked effect (dev)
  // from starting two sign-ins, which would clash on the loopback redirect port.
  const oauthStartedRef = React.useRef(false);
  React.useEffect(() => {
    if (first === WizardStep.OAuth && !oauthStartedRef.current) {
      oauthStartedRef.current = true;
      startOAuth();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApiKeySubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (provider.apiKeyRequired && !apiKey.trim()) {
      setError('An API key is required for this provider.');
      return;
    }
    setError(null);
    setStep(WizardStep.BaseUrl);
  };

  const handleBaseUrlSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const url = baseUrl.trim();
    if (!url) {
      setError('A base URL is required.');
      return;
    }
    setError(null);
    setStep(WizardStep.Connecting);
    onTestConnect(
      provider.id,
      apiKey.trim() || undefined,
      url !== provider.defaultBaseUrl ? url : undefined,
      (result) => {
        if (result.success) {
          onDone();
        } else {
          setError(result.error ?? 'Connection failed.');
          setStep(WizardStep.BaseUrl);
        }
      }
    );
  };

  const stepBack = (): void => {
    setError(null);
    if (step === WizardStep.OAuth) {
      cancelOAuth();
    } else if (step === first) {
      onCancel();
    } else if (step === WizardStep.ApiKey) {
      setStep(WizardStep.AuthMethod);
    } else if (step === WizardStep.BaseUrl) {
      setStep(WizardStep.ApiKey);
    } else {
      onCancel();
    }
  };

  return (
    <div className="provider-connect-wizard">
      {step === WizardStep.AuthMethod ? (
        <div className="provider-connect-step">
          <p className="provider-connect-hint">
            How do you want to connect {provider.name}?
          </p>
          <div className="provider-auth-options">
            <button
              type="button"
              className="provider-auth-option"
              onClick={() => handleAuthMethod(AuthChoice.ApiKey)}
            >
              <span className="provider-auth-option-label">Use API key</span>
              <span className="provider-auth-option-desc">
                Paste a developer API key
              </span>
            </button>
            <button
              type="button"
              className="provider-auth-option"
              onClick={() => handleAuthMethod(AuthChoice.OAuth)}
            >
              <span className="provider-auth-option-label">Sign in</span>
              <span className="provider-auth-option-desc">
                Use your subscription (opens browser)
              </span>
            </button>
          </div>
          <div className="provider-connect-actions">
            <button
              type="button"
              className="provider-action"
              onClick={stepBack}
            >
              {backLabel}
            </button>
          </div>
        </div>
      ) : step === WizardStep.ApiKey ? (
        <form className="provider-connect-step" onSubmit={handleApiKeySubmit}>
          <p className="provider-connect-hint">
            {provider.apiKeyRequired
              ? 'Enter the API key for this provider.'
              : 'Optional API key — leave blank to skip.'}
          </p>
          <div className="provider-connect-field">
            <label
              className="provider-connect-label"
              htmlFor={`key-${provider.id}`}
            >
              API Key
            </label>
            <input
              id={`key-${provider.id}`}
              className="provider-connect-input"
              type="password"
              placeholder="Paste API key…"
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setError(null);
              }}
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error ? <p className="provider-connect-error">{error}</p> : null}
          <div className="provider-connect-actions">
            <button
              type="submit"
              className="provider-action provider-action-primary"
            >
              Continue
            </button>
            <button
              type="button"
              className="provider-action"
              onClick={stepBack}
            >
              {backLabel}
            </button>
          </div>
        </form>
      ) : step === WizardStep.BaseUrl ? (
        <form className="provider-connect-step" onSubmit={handleBaseUrlSubmit}>
          <p className="provider-connect-hint">
            Confirm or edit the base URL for {provider.name}.
          </p>
          <div className="provider-connect-field">
            <label
              className="provider-connect-label"
              htmlFor={`url-${provider.id}`}
            >
              Base URL
            </label>
            <input
              id={`url-${provider.id}`}
              className="provider-connect-input"
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {error ? <p className="provider-connect-error">{error}</p> : null}
          <div className="provider-connect-actions">
            <button
              type="submit"
              className="provider-action provider-action-primary"
            >
              Connect
            </button>
            <button
              type="button"
              className="provider-action"
              onClick={stepBack}
            >
              {backLabel}
            </button>
          </div>
        </form>
      ) : step === WizardStep.OAuth ? (
        <div className="provider-connect-step">
          {oauthPrompt ? (
            <form className="provider-connect-step" onSubmit={submitOAuthInput}>
              <p className="provider-connect-hint">{oauthPrompt}</p>
              <div className="provider-connect-field">
                <input
                  className="provider-connect-input"
                  type="text"
                  placeholder="Paste value…"
                  value={oauthInput}
                  onChange={(e) => setOauthInput(e.target.value)}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {error ? <p className="provider-connect-error">{error}</p> : null}
              <div className="provider-connect-actions">
                <button
                  type="submit"
                  className="provider-action provider-action-primary"
                >
                  Submit
                </button>
                <button
                  type="button"
                  className="provider-action"
                  onClick={cancelOAuth}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : error ? (
            <>
              <p className="provider-connect-error">{error}</p>
              <div className="provider-connect-actions">
                <button
                  type="button"
                  className="provider-action provider-action-primary"
                  onClick={startOAuth}
                >
                  Try again
                </button>
                <button
                  type="button"
                  className="provider-action"
                  onClick={cancelOAuth}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="provider-connect-connecting">
                <span className="provider-connect-spinner" aria-hidden="true" />
                <span className="provider-connect-hint">
                  {oauthStatus || 'Waiting for sign-in…'}
                </span>
              </div>
              <div className="provider-connect-actions">
                <button
                  type="button"
                  className="provider-action"
                  onClick={cancelOAuth}
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="provider-connect-step provider-connect-connecting">
          <span className="provider-connect-spinner" aria-hidden="true" />
          <span className="provider-connect-hint">
            Connecting and fetching models…
          </span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom provider form — name → api key (optional) → base url → connecting
// ---------------------------------------------------------------------------

enum CustomProviderStep {
  Fields = 'fields',
  Connecting = 'connecting',
}

function CustomProviderForm({
  onAddCustom,
  onDone,
}: {
  onAddCustom: (
    name: string,
    apiKey: string | undefined,
    baseUrl: string,
    onResult: (result: ConnectResult) => void
  ) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [step, setStep] = React.useState<CustomProviderStep>(
    CustomProviderStep.Fields
  );
  const [name, setName] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedBaseUrl = baseUrl.trim();

    if (!trimmedName) {
      setError('A provider name is required.');
      return;
    }
    if (!trimmedBaseUrl) {
      setError('A base URL is required.');
      return;
    }

    setError(null);
    setStep(CustomProviderStep.Connecting);

    onAddCustom(
      trimmedName,
      apiKey.trim() || undefined,
      trimmedBaseUrl,
      (result) => {
        if (result.success) {
          onDone();
        } else {
          setError(result.error ?? 'Connection failed.');
          setStep(CustomProviderStep.Fields);
        }
      }
    );
  };

  if (step === CustomProviderStep.Connecting) {
    return (
      <div className="provider-connect-wizard">
        <div className="provider-connect-step provider-connect-connecting">
          <span className="provider-connect-spinner" aria-hidden="true" />
          <span className="provider-connect-hint">
            Connecting and fetching models…
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="provider-connect-wizard">
      <form className="provider-connect-step" onSubmit={handleSubmit}>
        <p className="provider-connect-hint">
          Enter the details for your custom OpenAI-compatible provider.
        </p>

        <div className="provider-connect-field">
          <label
            className="provider-connect-label"
            htmlFor="custom-provider-name"
          >
            Name
          </label>
          <input
            id="custom-provider-name"
            className="provider-connect-input"
            type="text"
            placeholder="My Provider"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            // eslint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="provider-connect-field">
          <label
            className="provider-connect-label"
            htmlFor="custom-provider-apikey"
          >
            API Key <span style={{ opacity: 0.6 }}>(optional)</span>
          </label>
          <input
            id="custom-provider-apikey"
            className="provider-connect-input"
            type="password"
            placeholder="Paste API key…"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className="provider-connect-field">
          <label
            className="provider-connect-label"
            htmlFor="custom-provider-baseurl"
          >
            Base URL
          </label>
          <input
            id="custom-provider-baseurl"
            className="provider-connect-input"
            type="url"
            placeholder="https://my-provider.example.com/v1"
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error ? <p className="provider-connect-error">{error}</p> : null}

        <div className="provider-connect-actions">
          <button
            type="submit"
            className="provider-action provider-action-primary"
          >
            Connect
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCP servers tab — edit mcp.json in a textarea and save (reconnects live)
// ---------------------------------------------------------------------------

const MCP_PLACEHOLDER = `{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    },
    "remote": {
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    }
  }
}`;

// Matches the JSON tokens we colour: (1) a string literal, (2) an optional
// trailing colon that marks the string as an object key, (3) a keyword, and
// (4) a number. Everything else (braces, commas, whitespace) is left plain.
const JSON_TOKEN_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

/** Splits JSON source into React nodes with syntax-highlighting spans. */
function highlightJson(source: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const match of source.matchAll(JSON_TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(source.slice(last, index));

    if (match[1] !== undefined) {
      const isKey = match[2] !== undefined;
      nodes.push(
        <span key={key++} className={isKey ? 'json-key' : 'json-string'}>
          {match[1]}
        </span>
      );
      // The colon (group 2) stays plain text so only the key string is tinted.
      if (match[2]) nodes.push(match[2]);
    } else if (match[3] !== undefined) {
      nodes.push(
        <span
          key={key++}
          className={match[3] === 'null' ? 'json-null' : 'json-boolean'}
        >
          {match[3]}
        </span>
      );
    } else if (match[4] !== undefined) {
      nodes.push(
        <span key={key++} className="json-number">
          {match[4]}
        </span>
      );
    }
    last = index + match[0].length;
  }
  if (last < source.length) nodes.push(source.slice(last));
  return nodes;
}

/**
 * A JSON editor with live syntax highlighting: a transparent <textarea> sits on
 * top of a highlighted <pre> that mirrors its text, kept aligned by matching
 * their box/font and syncing scroll. Tab inserts two spaces.
 */
function McpJsonEditor({
  value,
  placeholder,
  onChange,
}: {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}): React.JSX.Element {
  const preRef = React.useRef<HTMLPreElement>(null);

  const syncScroll = (e: React.UIEvent<HTMLTextAreaElement>): void => {
    const pre = preRef.current;
    if (!pre) return;
    pre.scrollTop = e.currentTarget.scrollTop;
    pre.scrollLeft = e.currentTarget.scrollLeft;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const target = e.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    onChange(next);
    // Restore the caret just past the inserted spaces on the next tick.
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2;
    });
  };

  return (
    <div className="mcp-editor-wrap">
      <pre className="mcp-editor-highlight" aria-hidden="true" ref={preRef}>
        {value ? (
          <code>
            {highlightJson(value)}
            {'\n'}
          </code>
        ) : (
          <code className="mcp-editor-placeholder">{placeholder}</code>
        )}
      </pre>
      <textarea
        className="mcp-editor"
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        aria-label="mcp.json contents"
      />
    </div>
  );
}

function McpTab({
  content,
  saving,
  saveState,
  onSave,
}: {
  content: string | undefined;
  saving: boolean;
  saveState: McpSaveState | undefined;
  onSave: (content: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(content ?? '');
  // The host pushes the file text at load and again after each save (the source
  // of truth on disk). Sync the editor to it on those pushes — between them
  // `content` is stable, so typing is preserved.
  React.useEffect(() => {
    if (content !== undefined) setDraft(content);
  }, [content]);

  const dirty = content !== undefined && draft !== content;

  // Parse the draft so we can gate Format/Save on valid JSON and surface the
  // reason inline. Empty (or whitespace-only) content is treated as "not yet
  // invalid" so the hint doesn't nag before anything is typed.
  const parseError = React.useMemo(() => {
    if (!draft.trim()) return null;
    try {
      JSON.parse(draft);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid JSON';
    }
  }, [draft]);

  const canFormat = !saving && draft.trim().length > 0 && parseError === null;

  const format = (): void => {
    try {
      setDraft(JSON.stringify(JSON.parse(draft), null, 2));
    } catch {
      // Ignore — the button is disabled while the JSON is invalid.
    }
  };

  return (
    <div className="settings-section mcp-section">
      <h2 className="settings-section-title">MCP Servers</h2>
      <p className="settings-hint mcp-intro">
        Define MCP servers as JSON — a local <code>command</code> or a remote{' '}
        <code>url</code> (over HTTP). On save, {APP_NAME} connects to each
        server and adds its tools — manage them under the tools button in chat.
        Changes apply immediately.
      </p>

      <McpJsonEditor
        value={draft}
        placeholder={MCP_PLACEHOLDER}
        onChange={setDraft}
      />

      {parseError ? (
        <p className="provider-connect-error mcp-parse-error">
          Invalid JSON: {parseError}
        </p>
      ) : null}

      <div className="mcp-actions">
        <button
          type="button"
          className="provider-action provider-action-primary"
          disabled={saving || !dirty || parseError !== null}
          onClick={() => onSave(draft)}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="provider-action"
          disabled={!canFormat}
          onClick={format}
          title="Reindent the JSON with 2-space indentation"
        >
          Format
        </button>
        {dirty ? <span className="mcp-dirty-hint">Unsaved changes</span> : null}
      </div>

      {saveState ? <McpSaveSummary saveState={saveState} /> : null}
    </div>
  );
}

function McpSaveSummary({
  saveState,
}: {
  saveState: McpSaveState;
}): React.JSX.Element {
  if (!saveState.success) {
    return (
      <p className="provider-connect-error mcp-result">
        {saveState.error ?? 'Save failed.'}
      </p>
    );
  }

  const servers = saveState.servers ?? [];
  const totalTools = servers.reduce((sum, s) => sum + s.toolCount, 0);
  const okCount = servers.filter((s) => s.ok).length;

  return (
    <div className="mcp-result">
      <p className="mcp-result-ok">
        {saveState.error
          ? saveState.error
          : servers.length === 0
            ? 'Saved. No servers configured.'
            : `Saved — loaded ${totalTools} tool${totalTools === 1 ? '' : 's'} from ${okCount} of ${servers.length} server${servers.length === 1 ? '' : 's'}.`}
      </p>
      {servers.length > 0 ? (
        <ul className="mcp-server-list">
          {servers.map((server) => (
            <li
              key={server.name}
              className={`mcp-server-row ${server.ok ? '' : 'mcp-server-row-error'}`}
            >
              <span className="mcp-server-status" aria-hidden="true">
                {server.ok ? '✓' : '✕'}
              </span>
              <span className="mcp-server-name">{server.name}</span>
              <span className="mcp-server-detail">
                {server.ok
                  ? `${server.toolCount} tool${server.toolCount === 1 ? '' : 's'}`
                  : (server.error ?? 'failed to connect')}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AboutTab({
  appInfo,
}: {
  appInfo: SettingsAppInfo | undefined;
}): React.JSX.Element {
  const name = appInfo?.name ?? APP_NAME;
  const [confirming, setConfirming] = React.useState(false);

  const handleReset = (): void => {
    postSettingsToHost({ type: SettingsWebviewMessageType.ResetApp });
    setConfirming(false);
  };

  return (
    <div className="settings-section about-section">
      <h2 className="settings-section-title">About {name}</h2>

      <section className="about-card">
        <h3 className="about-card-title">Version Information</h3>
        <div className="about-row">
          <span className="about-row-label">Version:</span>
          <span className="about-row-value">{appInfo?.version ?? '—'}</span>
        </div>
      </section>

      <section className="about-card">
        <h3 className="about-card-title">Community &amp; Support</h3>
        {appInfo?.description ? (
          <p className="about-card-text">{appInfo.description}</p>
        ) : null}
        <div className="about-links">
          {appInfo?.repository ? (
            <a className="about-link" href={appInfo.repository}>
              {logoUri ? (
                <img
                  className="about-link-logo"
                  src={logoUri}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              GitHub Repository
            </a>
          ) : null}
          {appInfo?.issues ? (
            <a className="about-link" href={appInfo.issues}>
              Report an Issue
            </a>
          ) : null}
          {appInfo?.repository ? (
            <a
              className="about-link"
              href={`${appInfo.repository}#contributing`}
            >
              Contribute
            </a>
          ) : null}
          {appInfo?.repository ? (
            <a
              className="about-link"
              href={`${appInfo.repository}/blob/main/TERMS.md`}
            >
              Terms of Use
            </a>
          ) : null}
          {appInfo?.repository ? (
            <a
              className="about-link"
              href={`${appInfo.repository}/blob/main/PRIVACY.md`}
            >
              Privacy Policy
            </a>
          ) : null}
        </div>
      </section>

      <section className="about-card">
        <h3 className="about-card-title">Support the Developer</h3>
        <p className="about-card-text">
          {name} is free and open source. If it saves you time, a small tip is
          hugely appreciated — no pressure, no paywall.
        </p>
        <div className="about-links">
          <a className="about-link" href={KOFI_URL}>
            Buy me a coffee (Ko-fi)
          </a>
        </div>
        <div className="about-crypto">
          {CRYPTO_WALLETS.map((wallet) => (
            <div key={wallet.ticker} className="about-row about-crypto-row">
              <span className="about-row-label">
                {wallet.ticker}
                <span className="about-crypto-net"> · {wallet.network}</span>
              </span>
              <code
                className="about-crypto-addr"
                title="Click to copy"
                onClick={() =>
                  void navigator.clipboard?.writeText(wallet.address)
                }
              >
                {wallet.address}
              </code>
            </div>
          ))}
        </div>
      </section>

      <section className="about-card about-card-danger">
        <h3 className="about-card-title about-card-title-danger">
          Danger Zone
        </h3>

        {confirming ? (
          <div className="reset-confirm">
            <p className="reset-confirm-warning">
              This action is irreversible.
            </p>
            <p className="reset-confirm-label">Resetting {name} will:</p>
            <ul className="reset-confirm-list">
              <li>restore config to defaults</li>
              <li>remove all connected providers</li>
              <li>remove all pulled models</li>
              <li>remove all configured MCP servers</li>
              <li>remove all saved sessions</li>
            </ul>
            <div className="reset-confirm-actions">
              <button
                type="button"
                className="provider-action"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="provider-action reset-confirm-btn"
                onClick={handleReset}
              >
                Reset everything
              </button>
            </div>
          </div>
        ) : (
          <div className="reset-row">
            <div className="reset-row-text">
              <span className="reset-row-label">Reset {name}</span>
              <span className="reset-row-desc">
                Restore defaults and remove all providers, models, and sessions.
              </span>
            </div>
            <button
              type="button"
              className="provider-action reset-trigger-btn"
              onClick={() => setConfirming(true)}
            >
              Reset…
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
