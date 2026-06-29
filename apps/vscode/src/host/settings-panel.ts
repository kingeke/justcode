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
  testAndConnectProvider,
} from '@ext/host/provider-settings';

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
      if (this.panel === panel) this.panel = undefined;
    });

    panel.webview.html = this.renderHtml(panel.webview, mediaUri);
  }

  public dispose(): void {
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
      case SettingsWebviewMessageType.DisconnectProvider: {
        const removed = await disconnectProvider(
          cacheDirectory(),
          message.providerId
        );
        if (removed) this.onProvidersChanged();
        await this.sendProviders();
        return;
      }
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
