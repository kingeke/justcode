import * as vscode from 'vscode';

import { APP_NAME } from '@core/branding';
import { APP_VERSION } from '@core/version';
import { cacheDirectory } from '@core/application/cache-dir';

import { readFile, writeFile } from 'node:fs/promises';

import {
  SettingsHostMessageType,
  SettingsWebviewMessageType,
  type SettingsAppInfo,
  type SettingsHostToWebview,
  type SettingsMcpServerStatus,
  type SettingsWebviewToHost,
} from '@ext/shared/settings-protocol';
import {
  addCustomProvider,
  disconnectProvider,
  listProviders,
  oauthConnectProvider,
  testAndConnectProvider,
} from '@ext/host/provider-settings';
import { resetAppState } from '@runtime/persistence/reset-app-state';
import { ensureMcpConfigFile } from '@runtime/mcp/mcp-config';

const APP_INFO: SettingsAppInfo = {
  name: APP_NAME,
  version: APP_VERSION,
  description:
    'A lean, transparent coding assistant — bring your own provider, control every token.',
  repository: 'https://github.com/kingeke/justcode',
  issues: 'https://github.com/kingeke/justcode/issues',
};

/**
 * Owns the Settings editor tab: a single webview panel (not a sidebar view)
 * with its own tab nav (Providers, About). It is created lazily on first open
 * and revealed thereafter, so only one Settings tab ever exists.
 */
export class SettingsPanel {
  private panel: vscode.WebviewPanel | undefined;
  /** Aborts the in-progress OAuth sign-in, if any. */
  private oauthAbort: AbortController | undefined;
  /** Resolves the OAuth flow's pending promptInput() with the user's reply. */
  private oauthInputResolve: ((value: string) => void) | undefined;
  /** A section to focus once the webview has loaded (e.g. opened for MCP). */
  private pendingSection: 'mcp' | undefined;

  public constructor(
    private readonly extensionUri: vscode.Uri,
    /** Opens the connect flow (terminal); used for OAuth-only providers. */
    private readonly onConnectProvider: () => void,
    /** Notifies the host that the provider set changed (connect/disconnect). */
    private readonly onProvidersChanged: () => void,
    /**
     * Persists+reconnects MCP servers after the user saves `mcp.json`, returning
     * each server's load outcome. Injected by the view provider so the panel can
     * stay decoupled from the live chat session. Returns undefined when no chat
     * session is open to reload (the file is still saved either way).
     */
    private readonly onMcpChanged: () => Promise<
      SettingsMcpServerStatus[] | undefined
    >
  ) {}

  /**
   * Creates the Settings tab if needed, then brings it to the foreground.
   * An optional section focuses a specific tab (e.g. `'mcp'`) once loaded.
   */
  public reveal(section?: 'mcp'): void {
    this.pendingSection = section;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      // Already loaded: the webview won't re-send Init, so focus it now.
      if (section)
        this.post({ type: SettingsHostMessageType.FocusSection, section });
      return;
    }

    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel(
      'justcode.settings',
      `${APP_NAME} Settings`,
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [mediaUri],
      }
    );
    panel.iconPath = vscode.Uri.joinPath(mediaUri, 'emblem.svg');
    this.panel = panel;

    panel.webview.onDidReceiveMessage((message: SettingsWebviewToHost) => {
      void this.handle(message);
    });

    // The terminal connect flow finishes out-of-band; re-send providers each
    // time the tab regains focus so a freshly connected provider shows up.
    panel.onDidChangeViewState(() => {
      if (panel.visible) void this.sendProviders();
    });

    panel.onDidDispose(() => {
      // Closing the tab orphans any running sign-in (its prompts/status have
      // nowhere to go), so abort it.
      this.oauthAbort?.abort();
      this.oauthAbort = undefined;
      this.oauthInputResolve = undefined;
      if (this.panel === panel) this.panel = undefined;
    });

    panel.webview.html = this.renderHtml(panel.webview, mediaUri);
  }

  public dispose(): void {
    this.oauthAbort?.abort();
    this.oauthAbort = undefined;
    this.oauthInputResolve = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }

  private async handle(message: SettingsWebviewToHost): Promise<void> {
    switch (message.type) {
      case SettingsWebviewMessageType.Init:
        this.post({
          type: SettingsHostMessageType.Snapshot,
          appInfo: APP_INFO,
          providers: await listProviders(cacheDirectory()),
        });
        // If the tab was opened to a specific section (e.g. the chat's
        // "Configure MCP servers" link), focus it now that the UI is ready.
        if (this.pendingSection) {
          this.post({
            type: SettingsHostMessageType.FocusSection,
            section: this.pendingSection,
          });
          this.pendingSection = undefined;
        }
        return;
      case SettingsWebviewMessageType.ListProviders:
        await this.sendProviders();
        return;
      case SettingsWebviewMessageType.ConnectProvider:
        this.onConnectProvider();
        return;
      case SettingsWebviewMessageType.TestConnectProvider: {
        const result = await testAndConnectProvider(
          cacheDirectory(),
          message.providerId,
          message.apiKey,
          message.baseUrl
        );
        this.post({
          type: SettingsHostMessageType.ConnectResult,
          ...result,
        });
        if (result.success) {
          this.onProvidersChanged();
          await this.sendProviders();
        }
        return;
      }
      case SettingsWebviewMessageType.OAuthConnectProvider:
        await this.runOAuthConnect(message.providerId);
        return;
      case SettingsWebviewMessageType.OAuthInput:
        this.oauthInputResolve?.(message.value);
        this.oauthInputResolve = undefined;
        return;
      case SettingsWebviewMessageType.CancelOAuth:
        this.oauthAbort?.abort();
        return;
      case SettingsWebviewMessageType.DisconnectProvider: {
        const removed = await disconnectProvider(
          cacheDirectory(),
          message.providerId
        );
        if (removed) this.onProvidersChanged();
        await this.sendProviders();
        return;
      }
      case SettingsWebviewMessageType.ResetApp: {
        await resetAppState(cacheDirectory());
        this.onProvidersChanged();
        await this.sendProviders();
        return;
      }
      case SettingsWebviewMessageType.AddCustomProvider: {
        const result = await addCustomProvider(
          cacheDirectory(),
          message.name,
          message.apiKey,
          message.baseUrl
        );
        this.post({ type: SettingsHostMessageType.ConnectResult, ...result });
        if (result.success) {
          this.onProvidersChanged();
          await this.sendProviders();
        }
        return;
      }
      case SettingsWebviewMessageType.GetMcpConfig:
        await this.sendMcpConfig();
        return;
      case SettingsWebviewMessageType.SaveMcpConfig:
        await this.saveMcpConfig(message.content);
        return;
    }
  }

  /** Reads `mcp.json` (seeding an empty template if absent) and sends its text. */
  private async sendMcpConfig(): Promise<void> {
    const path = await ensureMcpConfigFile(cacheDirectory());
    let content = '';
    try {
      content = await readFile(path, 'utf8');
    } catch {
      content = '{\n  "mcpServers": {}\n}\n';
    }
    this.post({ type: SettingsHostMessageType.McpConfig, content });
  }

  /**
   * Validates and writes new `mcp.json` text, then reconnects MCP servers so
   * their tools appear immediately. Rejects malformed JSON without writing, so a
   * typo can't wipe a working config or leave servers half-loaded.
   */
  private async saveMcpConfig(content: string): Promise<void> {
    // Clearing the editor means "no servers" rather than an error — fall back to
    // an empty config instead of complaining about empty/blank input.
    const toSave = content.trim() ? content : '{\n  "mcpServers": {}\n}\n';

    const validationError = validateMcpJson(toSave);
    if (validationError) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: false,
        error: validationError,
      });
      return;
    }

    try {
      const path = await ensureMcpConfigFile(cacheDirectory());
      await writeFile(path, toSave, 'utf8');
    } catch (error) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: false,
        error: `Couldn't save mcp.json: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    // Re-sync the editor to exactly what was written (e.g. a cleared editor
    // becomes the empty template), so the textarea and "unsaved" hint match disk.
    this.post({ type: SettingsHostMessageType.McpConfig, content: toSave });

    // Reconnect against the new config; the chat view (if open) reloads its tool
    // list as part of this. A failure to reconnect doesn't unsave the file.
    let servers: SettingsMcpServerStatus[] | undefined;
    try {
      servers = await this.onMcpChanged();
    } catch (error) {
      this.post({
        type: SettingsHostMessageType.McpSaveResult,
        success: true,
        error: `Saved, but reconnecting failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }

    this.post({
      type: SettingsHostMessageType.McpSaveResult,
      success: true,
      ...(servers ? { servers } : {}),
    });
  }

  /**
   * Drives a provider's OAuth sign-in to completion inside the extension. The
   * runtime flow opens the browser (via {@link vscode.env.openExternal}) and
   * captures the redirect or device code itself; we relay its status lines and
   * any "paste this value" prompts to the webview and feed the user's reply
   * back. Only one sign-in runs at a time — a new request aborts the previous.
   */
  private async runOAuthConnect(providerId: string): Promise<void> {
    this.oauthAbort?.abort();
    const abort = new AbortController();
    this.oauthAbort = abort;
    this.oauthInputResolve = undefined;

    const result = await oauthConnectProvider(cacheDirectory(), providerId, {
      openUrl: (url) =>
        Promise.resolve(vscode.env.openExternal(vscode.Uri.parse(url))),
      notify: (message) =>
        this.post({ type: SettingsHostMessageType.OAuthStatus, message }),
      promptInput: (label) =>
        new Promise<string>((resolve) => {
          this.oauthInputResolve = resolve;
          this.post({ type: SettingsHostMessageType.OAuthPrompt, label });
        }),
      signal: abort.signal,
    });

    if (this.oauthAbort === abort) {
      this.oauthAbort = undefined;
      this.oauthInputResolve = undefined;
    }

    this.post({ type: SettingsHostMessageType.OAuthResult, ...result });
    if (result.success) {
      this.onProvidersChanged();
      await this.sendProviders();
    }
  }

  private async sendProviders(): Promise<void> {
    this.post({
      type: SettingsHostMessageType.ProvidersUpdate,
      providers: await listProviders(cacheDirectory()),
    });
  }

  private post(message: SettingsHostToWebview): void {
    void this.panel?.webview.postMessage(message);
  }

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.css')
    );
    const logoUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'emblem.svg')
    );
    const nonce = createNonce();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `font-src ${webview.cspSource}`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link href="${styleUri}" rel="stylesheet" />
    <title>${APP_NAME} Settings</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">
      window.JUSTCODE_VIEW = 'settings';
      window.JUSTCODE_LOGO_URI = ${JSON.stringify(logoUri.toString())};
    </script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

/**
 * Validates MCP config text before it's written: it must be a JSON object whose
 * `mcpServers` (if present) maps names to entries that each carry a string
 * `command`. Returns a human-readable error, or undefined when the text is fine.
 */
function validateMcpJson(content: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return 'Expected a JSON object at the top level.';
  }
  const servers = (parsed as { mcpServers?: unknown }).mcpServers;
  if (servers === undefined) {
    return 'Missing a "mcpServers" object.';
  }
  if (
    typeof servers !== 'object' ||
    servers === null ||
    Array.isArray(servers)
  ) {
    return '"mcpServers" must be an object mapping a name to its config.';
  }
  for (const [name, value] of Object.entries(servers)) {
    if (typeof value !== 'object' || value === null) {
      return `Server "${name}" must be an object.`;
    }
    const entry = value as { command?: unknown; url?: unknown };
    if (typeof entry.command !== 'string' && typeof entry.url !== 'string') {
      return `Server "${name}" must have a string "command" (local) or "url" (remote).`;
    }
  }
  return undefined;
}

function createNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
