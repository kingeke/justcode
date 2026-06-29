import * as vscode from 'vscode';

import { APP_NAME } from '@core/branding';
import { APP_VERSION } from '@core/version';
import { cacheDirectory } from '@core/application/cache-dir';

import {
  SettingsHostMessageType,
  SettingsWebviewMessageType,
  type SettingsAppInfo,
  type SettingsHostToWebview,
  type SettingsWebviewToHost,
} from '@ext/shared/settings-protocol';
import {
  disconnectProvider,
  listProviders,
  oauthConnectProvider,
  testAndConnectProvider,
} from '@ext/host/provider-settings';
import { resetAppState } from '@runtime/persistence/reset-app-state';

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

  public constructor(
    private readonly extensionUri: vscode.Uri,
    /** Opens the connect flow (terminal); used for OAuth-only providers. */
    private readonly onConnectProvider: () => void,
    /** Notifies the host that the provider set changed (connect/disconnect). */
    private readonly onProvidersChanged: () => void
  ) {}

  /** Creates the Settings tab if needed, then brings it to the foreground. */
  public reveal(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
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
    }
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

function createNonce(): string {
  const chars =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
