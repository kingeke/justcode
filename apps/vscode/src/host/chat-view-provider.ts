import * as vscode from 'vscode';

import { APP_NAME } from '@core/branding';
import { ChatBridge } from '@ext/host/chat-bridge';
import {
  WebviewMessageType,
  type WebviewToHost,
} from '@ext/shared/protocol';

/**
 * Hosts the chat webview in the sidebar. It owns the webview lifecycle, renders
 * the HTML shell (with a strict CSP), and pairs each view with a {@link
 * ChatBridge} that runs the actual agent session.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'justcode.chatView';

  private bridge: ChatBridge | undefined;

  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const { webview } = webviewView;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');

    webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };

    const bridge = new ChatBridge(
      (message) => {
        // postMessage is fire-and-forget; ignore the returned promise.
        void webview.postMessage(message);
      },
      resolveWorkspaceRoot(),
      () => {
        const terminal = vscode.window.createTerminal('JustCode Connect');
        terminal.show();
        terminal.sendText('justcode connect');
      }
    );
    this.bridge = bridge;

    webview.onDidReceiveMessage((message: WebviewToHost) => {
      void bridge.handle(message);
    });

    webviewView.onDidDispose(() => {
      bridge.dispose();
      if (this.bridge === bridge) {
        this.bridge = undefined;
      }
    });

    webview.html = this.renderHtml(webview, mediaUri);
  }

  /** Clears the conversation in the live webview, if one is open. */
  public newSession(): void {
    void this.bridge?.handle({ type: WebviewMessageType.NewSession });
  }

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.css')
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
    <title>${APP_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

/** Workspace folder the tools resolve against; the first folder, or undefined. */
function resolveWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri.fsPath : process.cwd();
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
