import * as React from 'react';

import type {
  WebviewProvider,
  WebviewProviderKind,
} from '@ext/shared/protocol';
import {
  SettingsHostMessageType,
  SettingsWebviewMessageType,
  type SettingsAppInfo,
} from '@ext/shared/settings-protocol';
import {
  logoUri,
  onSettingsMessage,
  postSettingsToHost,
} from '@ext/webview/vscode-api';
import { PlusIcon } from '@ext/webview/components/Icons';

const KIND_LABELS: Record<WebviewProviderKind, string> = {
  apiKey: 'API Key',
  oauth: 'Sign-in',
  local: 'Local',
  custom: 'Custom',
};

type Tab = 'providers' | 'about';

const TABS: { id: Tab; label: string }[] = [
  { id: 'providers', label: 'Providers' },
  { id: 'about', label: 'About JustCode' },
];

function matchesSearch(provider: WebviewProvider, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    provider.name.toLowerCase().includes(q) ||
    provider.description.toLowerCase().includes(q)
  );
}

export function SettingsApp(): React.JSX.Element {
  const [tab, setTab] = React.useState<Tab>('providers');
  const [providers, setProviders] = React.useState<WebviewProvider[]>([]);
  const [appInfo, setAppInfo] = React.useState<SettingsAppInfo | undefined>();

  // Callback ref: set by ConnectWizard when it fires TestConnectProvider so
  // the incoming ConnectResult message can be routed back to the right form.
  const connectResultRef = React.useRef<
    ((result: { success: boolean; error?: string | undefined }) => void) | null
  >(null);

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
      }
    });
    postSettingsToHost({ type: SettingsWebviewMessageType.Init });
    return unsubscribe;
  }, []);

  const connectViaCli = (): void => {
    postSettingsToHost({ type: SettingsWebviewMessageType.ConnectProvider });
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
          {tab === 'providers' ? (
            <ProvidersTab
              providers={providers}
              onConnectViaCli={connectViaCli}
              onTestConnect={testConnect}
              onDisconnect={disconnect}
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
  onConnectViaCli,
  onTestConnect,
  onDisconnect,
}: {
  providers: WebviewProvider[];
  onConnectViaCli: () => void;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: { success: boolean; error?: string | undefined }) => void
  ) => void;
  onDisconnect: (providerId: string) => void;
}): React.JSX.Element {
  const [search, setSearch] = React.useState('');
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const connected = providers.filter(
    (p) => p.connected && matchesSearch(p, search)
  );
  const available = providers.filter(
    (p) => !p.connected && matchesSearch(p, search)
  );

  const hasOAuthOnly = available.some(
    (p) => p.kind === 'oauth' && !p.authMethods.includes('apiKey')
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
                  setExpandedId(
                    expandedId === provider.id ? null : provider.id
                  )
                }
                onConnectViaCli={onConnectViaCli}
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
          Sign-in providers (e.g. GitHub Copilot) open the JustCode CLI in a
          terminal to complete the OAuth flow.
        </p>
      ) : null}
    </div>
  );
}

function ProviderRow({
  provider,
  expanded,
  onExpand,
  onConnectViaCli,
  onTestConnect,
}: {
  provider: WebviewProvider;
  expanded: boolean;
  onExpand: () => void;
  onConnectViaCli: () => void;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: { success: boolean; error?: string | undefined }) => void
  ) => void;
}): React.JSX.Element {
  // OAuth-only providers can't be connected inline (need browser flow).
  const canInline =
    provider.kind !== 'oauth' || provider.authMethods.includes('apiKey');

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
          title={expanded ? `Cancel connecting ${provider.name}` : `Connect ${provider.name}`}
          onClick={canInline ? onExpand : onConnectViaCli}
        >
          {expanded ? 'Cancel' : <><PlusIcon size={13} /> Connect</>}
        </button>
      </div>

      {expanded && canInline ? (
        <ConnectWizard
          provider={provider}
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

type WizardStep = 'auth-method' | 'api-key' | 'base-url' | 'connecting';

function initialStep(provider: WebviewProvider): WizardStep {
  // Providers that support both OAuth AND API key offer an auth-method picker.
  if (provider.authMethods.includes('oauth') && provider.authMethods.includes('apiKey')) {
    return 'auth-method';
  }
  // All providers (including local ones) go through the API key step — it's
  // just optional for providers where apiKeyRequired is false.
  return 'api-key';
}

function ConnectWizard({
  provider,
  onTestConnect,
  onDone,
  onCancel,
}: {
  provider: WebviewProvider;
  onTestConnect: (
    providerId: string,
    apiKey: string | undefined,
    baseUrl: string | undefined,
    onResult: (result: { success: boolean; error?: string | undefined }) => void
  ) => void;
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const first = initialStep(provider);
  const [step, setStep] = React.useState<WizardStep>(first);
  const [apiKey, setApiKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState(provider.defaultBaseUrl ?? '');
  const [error, setError] = React.useState<string | null>(null);

  // "Cancel" on the first step (nothing to go back to), "Back" on later steps.
  const backLabel = step === first ? 'Cancel' : 'Back';

  const handleAuthMethod = (method: 'oauth' | 'apiKey'): void => {
    if (method === 'oauth') {
      onCancel();
      // Slight delay so the form closes before the CLI opens.
      setTimeout(
        () =>
          postSettingsToHost({
            type: SettingsWebviewMessageType.ConnectProvider,
          }),
        50
      );
    } else {
      setStep('api-key');
    }
  };

  const handleApiKeySubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (provider.apiKeyRequired && !apiKey.trim()) {
      setError('An API key is required for this provider.');
      return;
    }
    setError(null);
    setStep('base-url');
  };

  const handleBaseUrlSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const url = baseUrl.trim();
    if (!url) {
      setError('A base URL is required.');
      return;
    }
    setError(null);
    setStep('connecting');
    onTestConnect(
      provider.id,
      apiKey.trim() || undefined,
      url !== provider.defaultBaseUrl ? url : undefined,
      (result) => {
        if (result.success) {
          onDone();
        } else {
          setError(result.error ?? 'Connection failed.');
          setStep('base-url');
        }
      }
    );
  };

  const stepBack = (): void => {
    setError(null);
    if (step === first) {
      onCancel();
    } else if (step === 'api-key') {
      setStep('auth-method');
    } else if (step === 'base-url') {
      setStep('api-key');
    } else {
      onCancel();
    }
  };

  return (
    <div className="provider-connect-wizard">
      {step === 'auth-method' ? (
        <div className="provider-connect-step">
          <p className="provider-connect-hint">
            How do you want to connect {provider.name}?
          </p>
          <div className="provider-auth-options">
            <button
              type="button"
              className="provider-auth-option"
              onClick={() => handleAuthMethod('apiKey')}
            >
              <span className="provider-auth-option-label">Use API key</span>
              <span className="provider-auth-option-desc">
                Paste a developer API key
              </span>
            </button>
            <button
              type="button"
              className="provider-auth-option"
              onClick={() => handleAuthMethod('oauth')}
            >
              <span className="provider-auth-option-label">Sign in</span>
              <span className="provider-auth-option-desc">
                Use your subscription (opens CLI)
              </span>
            </button>
          </div>
          <div className="provider-connect-actions">
            <button type="button" className="provider-action" onClick={stepBack}>
              {backLabel}
            </button>
          </div>
        </div>
      ) : step === 'api-key' ? (
        <form
          className="provider-connect-step"
          onSubmit={handleApiKeySubmit}
        >
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
      ) : step === 'base-url' ? (
        <form
          className="provider-connect-step"
          onSubmit={handleBaseUrlSubmit}
        >
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

function AboutTab({
  appInfo,
}: {
  appInfo: SettingsAppInfo | undefined;
}): React.JSX.Element {
  const name = appInfo?.name ?? 'JustCode';
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
        </div>
      </section>
    </div>
  );
}
