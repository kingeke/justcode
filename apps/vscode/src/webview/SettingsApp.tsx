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

export function SettingsApp(): React.JSX.Element {
  const [tab, setTab] = React.useState<Tab>('providers');
  const [providers, setProviders] = React.useState<WebviewProvider[]>([]);
  const [appInfo, setAppInfo] = React.useState<SettingsAppInfo | undefined>();

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
      }
    });
    postSettingsToHost({ type: SettingsWebviewMessageType.Init });
    return unsubscribe;
  }, []);

  const connect = (): void => {
    postSettingsToHost({ type: SettingsWebviewMessageType.ConnectProvider });
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
              onConnect={connect}
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
  onConnect,
  onDisconnect,
}: {
  providers: WebviewProvider[];
  onConnect: () => void;
  onDisconnect: (providerId: string) => void;
}): React.JSX.Element {
  const connected = providers.filter((p) => p.connected);
  const available = providers.filter((p) => !p.connected);

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Providers</h2>

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

      <div className="settings-subhead">Available providers</div>
      <div className="provider-list">
        {available.map((provider) => (
          <div key={provider.id} className="provider-row">
            <div className="provider-row-main">
              <span className="provider-name">{provider.name}</span>
              <span className="provider-desc">{provider.description}</span>
            </div>
            <button
              type="button"
              className="provider-action"
              title={`Connect ${provider.name}`}
              onClick={onConnect}
            >
              <PlusIcon size={13} /> Connect
            </button>
          </div>
        ))}
      </div>

      <p className="settings-hint">
        Connecting opens the JustCode CLI in a terminal to sign in or paste an
        API key. The list refreshes automatically once you return to this tab.
      </p>
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
