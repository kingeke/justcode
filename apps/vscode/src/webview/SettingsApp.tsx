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
  type SettingsPromptInfo,
  type SettingsSkill,
  type SettingsSkillScope,
} from '@ext/shared/settings-protocol';
import {
  logoUri,
  onSettingsMessage,
  postSettingsToHost,
} from '@ext/webview/vscode-api';
import { PlusIcon } from '@ext/webview/components/Icons';
import { JsonEditor } from '@ext/webview/components/JsonEditor';
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
  Skills = 'skills',
  Prompts = 'prompts',
  About = 'about',
}

const TABS: { id: Tab; label: string }[] = [
  { id: Tab.Providers, label: 'Providers' },
  { id: Tab.Mcp, label: 'MCP Servers' },
  { id: Tab.Skills, label: 'Skills' },
  { id: Tab.Prompts, label: 'System Prompts' },
  { id: Tab.About, label: `About ${APP_NAME}` },
];

/** Result of the most recent prompt save, keyed to the mode it was for. */
interface PromptSaveState {
  modeId: string;
  success: boolean;
  error?: string | undefined;
}

/** Result of the most recent MCP save, shown beneath the editor. */
interface McpSaveState {
  success: boolean;
  error?: string | undefined;
  servers?: SettingsMcpServerStatus[];
}

/** Outcome of the most recent skill add/update/remove, shown on the tab. */
interface SkillActionState {
  action: 'add' | 'update' | 'remove';
  success: boolean;
  message: string;
}

/**
 * A browser-openable URL for a skill's install source, or undefined for
 * sources that have no web page (local paths). `git@host:owner/repo(.git)`
 * remotes are rewritten to their https equivalent so they're clickable too.
 */
function skillSourceHref(source: string): string | undefined {
  if (source.startsWith('https://') || source.startsWith('http://')) {
    return source.replace(/\.git$/, '');
  }
  const scpLike = source.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (scpLike) return `https://${scpLike[1]}/${scpLike[2]}`;
  return undefined;
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
  // System Prompts tab state: the host's latest list, whether a save is in
  // flight, and the most recent save outcome.
  const [prompts, setPrompts] = React.useState<
    SettingsPromptInfo[] | undefined
  >();
  const [promptSaving, setPromptSaving] = React.useState(false);
  const [promptSaveState, setPromptSaveState] = React.useState<
    PromptSaveState | undefined
  >();
  // Skills tab state: the installed skills (both scopes), whether an action is
  // in flight, and the most recent action's outcome.
  const [skills, setSkills] = React.useState<SettingsSkill[] | undefined>();
  const [skillErrors, setSkillErrors] = React.useState<string[]>([]);
  const [skillWorkspaceOpen, setSkillWorkspaceOpen] = React.useState(true);
  const [skillBusy, setSkillBusy] = React.useState(false);
  const [skillActionState, setSkillActionState] = React.useState<
    SkillActionState | undefined
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
        case SettingsHostMessageType.Prompts:
          setPrompts(message.prompts);
          break;
        case SettingsHostMessageType.PromptSaveResult:
          setPromptSaving(false);
          setPromptSaveState({
            modeId: message.modeId,
            success: message.success,
            ...(message.error !== undefined ? { error: message.error } : {}),
          });
          break;
        case SettingsHostMessageType.Skills:
          setSkills(message.skills);
          setSkillErrors(message.errors);
          setSkillWorkspaceOpen(message.workspaceOpen);
          break;
        case SettingsHostMessageType.SkillActionResult:
          setSkillBusy(false);
          setSkillActionState({
            action: message.action,
            success: message.success,
            message: message.message,
          });
          break;
        case SettingsHostMessageType.FocusSection:
          if (message.section === SettingsSection.Mcp) setTab(Tab.Mcp);
          else if (message.section === SettingsSection.Providers)
            setTab(Tab.Providers);
          else if (message.section === SettingsSection.Prompts)
            setTab(Tab.Prompts);
          else if (message.section === SettingsSection.Skills)
            setTab(Tab.Skills);
          break;
      }
    });
    postSettingsToHost({ type: SettingsWebviewMessageType.Init });
    postSettingsToHost({ type: SettingsWebviewMessageType.GetMcpConfig });
    postSettingsToHost({ type: SettingsWebviewMessageType.GetPrompts });
    postSettingsToHost({ type: SettingsWebviewMessageType.GetSkills });
    return unsubscribe;
  }, []);

  const addSkill = (source: string, scope: SettingsSkillScope): void => {
    setSkillBusy(true);
    setSkillActionState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.AddSkill,
      source,
      scope,
    });
  };

  const updateSkill = (name: string, scope: SettingsSkillScope): void => {
    setSkillBusy(true);
    setSkillActionState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.UpdateSkill,
      name,
      scope,
    });
  };

  const removeSkill = (name: string, scope: SettingsSkillScope): void => {
    setSkillBusy(true);
    setSkillActionState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.RemoveSkill,
      name,
      scope,
    });
  };

  const savePrompt = (modeId: string, prompt: string): void => {
    setPromptSaving(true);
    setPromptSaveState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.SavePrompt,
      modeId,
      prompt,
    });
  };

  const createMode = (name: string, prompt: string): void => {
    setPromptSaving(true);
    setPromptSaveState(undefined);
    postSettingsToHost({
      type: SettingsWebviewMessageType.CreateMode,
      name,
      prompt,
    });
  };

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
          ) : tab === Tab.Skills ? (
            <SkillsTab
              skills={skills}
              errors={skillErrors}
              workspaceOpen={skillWorkspaceOpen}
              busy={skillBusy}
              actionState={skillActionState}
              onAdd={addSkill}
              onUpdate={updateSkill}
              onRemove={removeSkill}
            />
          ) : tab === Tab.Prompts ? (
            <PromptsTab
              prompts={prompts}
              saving={promptSaving}
              saveState={promptSaveState}
              onSave={savePrompt}
              onCreate={createMode}
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
// Skills tab — install/update/remove skill packs (slash-command repos)
// ---------------------------------------------------------------------------

function SkillsTab({
  skills,
  errors,
  workspaceOpen,
  busy,
  actionState,
  onAdd,
  onUpdate,
  onRemove,
}: {
  skills: SettingsSkill[] | undefined;
  errors: string[];
  workspaceOpen: boolean;
  busy: boolean;
  actionState: SkillActionState | undefined;
  onAdd: (source: string, scope: SettingsSkillScope) => void;
  onUpdate: (name: string, scope: SettingsSkillScope) => void;
  onRemove: (name: string, scope: SettingsSkillScope) => void;
}): React.JSX.Element {
  const [source, setSource] = React.useState('');
  const [scope, setScope] = React.useState<SettingsSkillScope>('global');
  // Two-step remove: the first click arms the button, the second removes.
  const [confirmingRemove, setConfirmingRemove] = React.useState<string | null>(
    null
  );
  // Cards start collapsed (some skills ship dozens of commands); clicking the
  // header toggles one open. Keyed by scope:name so the two scopes' copies of
  // a same-named skill fold independently.
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const toggleExpanded = (key: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const canAdd = !busy && source.trim().length > 0;
  const submitAdd = (): void => {
    if (!canAdd) return;
    onAdd(source.trim(), scope);
    setSource('');
  };

  const local = (skills ?? []).filter((skill) => skill.scope === 'local');
  const global = (skills ?? []).filter((skill) => skill.scope === 'global');
  const localNames = new Set(local.map((skill) => skill.name));

  const renderSkill = (skill: SettingsSkill): React.JSX.Element => {
    const key = `${skill.scope}:${skill.name}`;
    const open = expanded.has(key);
    return (
      <div key={key} className="skill-card">
        {/* The whole header row toggles the card; the action buttons stop the
            click so Update/Remove never double as a fold. */}
        <div
          className="skill-card-header skill-card-header-toggle"
          role="button"
          aria-expanded={open}
          tabIndex={0}
          onClick={() => toggleExpanded(key)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggleExpanded(key);
            }
          }}
        >
          <span className={`skill-card-chevron ${open ? 'open' : ''}`}>▸</span>
          <span className="skill-card-name">{skill.name}</span>
          <span className="skill-card-version">v{skill.version}</span>
          {!open ? (
            <span className="skill-card-count">
              {skill.commands.length}{' '}
              {skill.commands.length === 1 ? 'command' : 'commands'}
            </span>
          ) : null}
          {skill.scope === 'global' && localNames.has(skill.name) ? (
            <span className="skill-card-shadowed">
              shadowed by the local install
            </span>
          ) : null}
          <span
            className="skill-card-actions"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="provider-action"
              disabled={busy}
              onClick={() => onUpdate(skill.name, skill.scope)}
            >
              Update
            </button>
            <button
              type="button"
              className="provider-action skill-remove"
              disabled={busy}
              onClick={() => {
                if (confirmingRemove === key) {
                  setConfirmingRemove(null);
                  onRemove(skill.name, skill.scope);
                } else {
                  setConfirmingRemove(key);
                }
              }}
            >
              {confirmingRemove === key ? 'Confirm remove' : 'Remove'}
            </button>
          </span>
        </div>
        {open ? (
          <>
            {skill.description ? (
              <p className="skill-card-description">{skill.description}</p>
            ) : null}
            <ul className="skill-card-commands">
              {skill.commands.map((command) => (
                <li key={command.name}>
                  <code>/{command.name}</code>
                  {command.argumentHint ? (
                    <span className="skill-command-hint">
                      {' '}
                      {command.argumentHint}
                    </span>
                  ) : null}
                  {command.description ? (
                    <span className="skill-command-desc">
                      {' '}
                      — {command.description}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            {skill.errors.map((problem) => (
              <p key={problem} className="provider-connect-error">
                {problem}
              </p>
            ))}
            {skill.source ? (
              <p className="skill-card-source">
                {skillSourceHref(skill.source) ? (
                  <a
                    className="skill-card-source-link"
                    href={skillSourceHref(skill.source)}
                    title="Open the skill's repository"
                  >
                    {skill.source}
                  </a>
                ) : (
                  skill.source
                )}
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Skills</h2>
      <p className="settings-hint">
        Skills are packs of slash commands installed from git repositories —
        built for {APP_NAME} or following the shared ecosystem conventions
        (Claude plugins, SKILL.md, commands/*.md). Local skills live in this
        project&apos;s <code>.justcode/skills</code>; global ones are available
        in every project.
      </p>

      <div className="skill-add-form">
        <input
          type="text"
          className="skill-add-input"
          placeholder="owner/repo or a git URL"
          value={source}
          disabled={busy}
          onChange={(event) => setSource(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submitAdd();
          }}
        />
        <select
          className="skill-add-scope"
          value={scope}
          disabled={busy}
          onChange={(event) =>
            setScope(event.target.value as SettingsSkillScope)
          }
        >
          <option value="global">Global (all projects)</option>
          <option value="local" disabled={!workspaceOpen}>
            Local (this project)
          </option>
        </select>
        <button
          type="button"
          className="provider-action provider-action-primary"
          disabled={!canAdd}
          onClick={submitAdd}
        >
          {busy ? 'Working…' : 'Add skill'}
        </button>
      </div>

      {actionState ? (
        <p
          className={
            actionState.success
              ? 'skill-action-success'
              : 'provider-connect-error'
          }
        >
          {actionState.message}
        </p>
      ) : null}

      {skills === undefined ? (
        <p className="settings-hint">Loading skills…</p>
      ) : skills.length === 0 ? (
        <p className="settings-hint">
          No skills installed yet. Add one with its GitHub{' '}
          <code>owner/repo</code> above.
        </p>
      ) : (
        <>
          {local.length > 0 ? (
            <>
              <h3 className="skill-scope-heading">Local — this project</h3>
              {local.map(renderSkill)}
            </>
          ) : null}
          {global.length > 0 ? (
            <>
              <h3 className="skill-scope-heading">Global — all projects</h3>
              {global.map(renderSkill)}
            </>
          ) : null}
        </>
      )}

      {errors.map((problem) => (
        <p key={problem} className="provider-connect-error">
          {problem}
        </p>
      ))}
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

      <JsonEditor
        value={draft}
        placeholder={MCP_PLACEHOLDER}
        onChange={setDraft}
        ariaLabel="mcp.json contents"
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
          disabled={saving || content === undefined || parseError !== null}
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

// ---------------------------------------------------------------------------
// System Prompts tab — view and edit every mode's system prompt
// ---------------------------------------------------------------------------

function PromptsTab({
  prompts,
  saving,
  saveState,
  onSave,
  onCreate,
}: {
  prompts: SettingsPromptInfo[] | undefined;
  saving: boolean;
  saveState: PromptSaveState | undefined;
  onSave: (modeId: string, prompt: string) => void;
  onCreate: (name: string, prompt: string) => void;
}): React.JSX.Element {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = React.useState(false);

  if (!prompts) {
    return (
      <div className="settings-section">
        <h2 className="settings-section-title">System Prompts</h2>
        <p className="settings-hint">Loading…</p>
      </div>
    );
  }

  const builtIns = prompts.filter((p) => !p.custom);
  const custom = prompts.filter((p) => p.custom);

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">System Prompts</h2>
      <p className="settings-hint">
        Each chat mode sends its own system prompt, and Compaction is the prompt
        used to summarize a conversation when it's compacted. Edit any of them
        here — including the built-in defaults. Changes apply to the next
        message.
      </p>

      <div className="settings-subhead">Built-in prompts</div>
      <div className="provider-list">
        {builtIns.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            expanded={expandedId === prompt.id}
            onToggle={() =>
              setExpandedId(expandedId === prompt.id ? null : prompt.id)
            }
            saving={saving}
            saveState={saveState?.modeId === prompt.id ? saveState : undefined}
            onSave={onSave}
          />
        ))}
      </div>

      <div className="settings-subhead">Custom modes</div>
      <div className="provider-list">
        {custom.map((prompt) => (
          <PromptCard
            key={prompt.id}
            prompt={prompt}
            expanded={expandedId === prompt.id}
            onToggle={() =>
              setExpandedId(expandedId === prompt.id ? null : prompt.id)
            }
            saving={saving}
            saveState={saveState?.modeId === prompt.id ? saveState : undefined}
            onSave={onSave}
          />
        ))}
        <div className="provider-row-wrap">
          <div className="provider-row">
            <div className="provider-row-main">
              <span className="provider-name">Add custom mode</span>
              <span className="provider-desc">
                A new chat mode with its own system prompt
              </span>
            </div>
            <button
              type="button"
              className="provider-action"
              onClick={() => setShowCreateForm((prev) => !prev)}
            >
              {showCreateForm ? (
                'Cancel'
              ) : (
                <>
                  <PlusIcon size={13} /> Add
                </>
              )}
            </button>
          </div>
          {showCreateForm ? (
            <CreateModeForm
              saving={saving}
              saveState={saveState}
              onCreate={onCreate}
              onDone={() => setShowCreateForm(false)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CreateModeForm({
  saving,
  saveState,
  onCreate,
  onDone,
}: {
  saving: boolean;
  saveState: PromptSaveState | undefined;
  onCreate: (name: string, prompt: string) => void;
  onDone: () => void;
}): React.JSX.Element {
  const [name, setName] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  // Only react to save results for a create this form submitted, not to a
  // PromptCard save that happens to land while the form is open.
  const submittedRef = React.useRef(false);

  React.useEffect(() => {
    if (!submittedRef.current || saving || !saveState) return;
    submittedRef.current = false;
    if (saveState.success) onDone();
    else setError(saveState.error ?? 'Failed to create the mode.');
  }, [saving, saveState, onDone]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('A mode name is required.');
      return;
    }
    setError(null);
    submittedRef.current = true;
    onCreate(trimmedName, prompt);
  };

  return (
    <form className="prompt-editor-wrap" onSubmit={handleSubmit}>
      <div className="provider-connect-field">
        <label className="provider-connect-label" htmlFor="create-mode-name">
          Name
        </label>
        <input
          id="create-mode-name"
          className="provider-connect-input"
          type="text"
          placeholder="My Mode"
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
      <textarea
        className="prompt-editor"
        value={prompt}
        spellCheck={false}
        placeholder="System prompt — leave empty to use the Build prompt…"
        onChange={(e) => setPrompt(e.target.value)}
        aria-label="New mode system prompt"
      />
      {error ? <p className="provider-connect-error">{error}</p> : null}
      <div className="mcp-actions">
        <button
          type="submit"
          className="provider-action provider-action-primary"
          disabled={saving}
        >
          {saving ? 'Creating…' : 'Create mode'}
        </button>
      </div>
    </form>
  );
}

function PromptCard({
  prompt,
  expanded,
  onToggle,
  saving,
  saveState,
  onSave,
}: {
  prompt: SettingsPromptInfo;
  expanded: boolean;
  onToggle: () => void;
  saving: boolean;
  saveState: PromptSaveState | undefined;
  onSave: (modeId: string, prompt: string) => void;
}): React.JSX.Element {
  const [draft, setDraft] = React.useState(prompt.prompt);
  // The host re-sends the list after each save (the source of truth on disk);
  // sync the editor to it then. Between pushes `prompt.prompt` is stable, so
  // typing is preserved.
  React.useEffect(() => {
    setDraft(prompt.prompt);
  }, [prompt.prompt]);

  const dirty = draft !== prompt.prompt;

  return (
    <div className="provider-row-wrap">
      <div className="provider-row">
        <div className="provider-row-main">
          <span className="provider-name">{prompt.name}</span>
          <span className="provider-desc">
            {prompt.custom && !prompt.prompt
              ? 'Uses the Build prompt (no prompt of its own yet)'
              : `${prompt.prompt.length.toLocaleString()} characters`}
          </span>
        </div>
        <button type="button" className="provider-action" onClick={onToggle}>
          {expanded ? 'Close' : 'Edit'}
        </button>
      </div>

      {expanded ? (
        <div className="prompt-editor-wrap">
          <textarea
            className="prompt-editor"
            value={draft}
            spellCheck={false}
            placeholder={
              prompt.custom
                ? 'Leave empty to use the Build prompt…'
                : 'Leave empty to restore the built-in default…'
            }
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`${prompt.name} system prompt`}
          />
          <div className="mcp-actions">
            <button
              type="button"
              className="provider-action provider-action-primary"
              disabled={saving || !dirty}
              onClick={() => onSave(prompt.id, draft)}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {!prompt.custom && prompt.overridden ? (
              <button
                type="button"
                className="provider-action"
                disabled={saving}
                title="Discard the customization and restore the built-in prompt"
                onClick={() => onSave(prompt.id, '')}
              >
                Reset to default
              </button>
            ) : null}
            {dirty ? (
              <span className="mcp-dirty-hint">Unsaved changes</span>
            ) : null}
          </div>
          {saveState ? (
            saveState.success ? (
              <p className="mcp-result-ok prompt-save-ok">Saved.</p>
            ) : (
              <p className="provider-connect-error">
                {saveState.error ?? 'Save failed.'}
              </p>
            )
          ) : null}
        </div>
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

      <section className="about-card">
        <h3 className="about-card-title">Configuration</h3>
        <p className="about-card-text">
          All settings — providers, prompts, modes, and tunables — live in a
          single <code>config.json</code>. Open it to inspect or hand-edit
          anything not exposed in this UI. It contains your API keys, so treat
          it as a secret.
        </p>
        <div className="about-links">
          <button
            type="button"
            className="about-link about-link-button"
            onClick={() =>
              postSettingsToHost({
                type: SettingsWebviewMessageType.OpenConfigFile,
              })
            }
          >
            Open config.json in editor
          </button>
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
