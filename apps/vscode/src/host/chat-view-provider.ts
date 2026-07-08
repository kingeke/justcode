import * as vscode from 'vscode';

import { APP_NAME } from '@core/branding';
import { ChatBridge } from '@ext/host/chat-bridge';
import { DiffBaselineProvider } from '@ext/host/diff-baseline-provider';
import { SettingsPanel } from '@ext/host/settings-panel';
import { WebviewMessageType, type WebviewToHost } from '@ext/shared/protocol';

/**
 * Hosts the chat webview in the sidebar. It owns the webview lifecycle, renders
 * the HTML shell (with a strict CSP), and pairs each view with a {@link
 * ChatBridge} that runs the actual agent session. It also owns the {@link
 * SettingsPanel} editor tab, opened from the sidebar's settings button.
 */
export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'justcode.chatView';

  private bridge: ChatBridge | undefined;
  private readonly settings: SettingsPanel;

  public constructor(private readonly extensionUri: vscode.Uri) {
    this.settings = new SettingsPanel(
      extensionUri,
      () => openConnectTerminal(),
      // A connect/disconnect in the Settings tab invalidates the sidebar's
      // cached provider; let the live session reload from config.
      () => void this.bridge?.refreshProviders(),
      // Saving mcp.json reconnects MCP in the live session; return each server's
      // outcome so the Settings page can report what loaded (undefined when no
      // chat session is open to reload).
      () => this.bridge?.reloadMcp() ?? Promise.resolve(undefined),
      // A system-prompt edit in the Settings tab re-applies to the live session
      // so the next turn runs under the new prompt.
      () => void this.bridge?.refreshPrompts(),
      // A skill add/update/remove in the Settings tab re-discovers skills so
      // the composer's `/` completions update without reloading the panel.
      () => void this.bridge?.refreshSkillCommands()
    );
  }

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    const { webview } = webviewView;
    const mediaUri = vscode.Uri.joinPath(this.extensionUri, 'media');

    webview.options = {
      enableScripts: true,
      localResourceRoots: [mediaUri],
    };

    const baselineProvider = new DiffBaselineProvider();
    const baselineSub = vscode.workspace.registerTextDocumentContentProvider(
      DiffBaselineProvider.scheme,
      baselineProvider
    );

    const bridge = new ChatBridge(
      (message) => {
        // postMessage is fire-and-forget; ignore the returned promise. It
        // throws synchronously once the webview is disposed — and turns keep
        // running in the host after the view closes — so swallow that instead
        // of letting it unwind (and effectively crash) the running turn.
        try {
          void webview.postMessage(message);
        } catch {
          // Webview gone; the turn's state is persisted and replayed on reopen.
        }
      },
      resolveWorkspaceRoot(),
      () => openConnectTerminal(),
      async (title) => {
        const choice = await vscode.window.showWarningMessage(
          `Delete ${title}? This cannot be undone.`,
          { modal: true },
          'Delete'
        );
        return choice === 'Delete';
      },
      (section) => this.settings.reveal(section),
      (absolutePath) => {
        void vscode.window.showTextDocument(vscode.Uri.file(absolutePath), {
          preview: false,
        });
      },
      (absolutePath, relativePath, baseline, created) => {
        baselineProvider.setBaseline(relativePath, baseline);
        const left = DiffBaselineProvider.uriFor(relativePath);
        const right = vscode.Uri.file(absolutePath);
        const name = relativePath.split('/').pop() ?? relativePath;
        const title = created
          ? `${name} (created)`
          : `${name} (baseline ↔ current)`;
        void vscode.commands.executeCommand('vscode.diff', left, right, title);
      },
      // OS notifications fire only while the window is unfocused — the user is
      // elsewhere and should know a turn finished or a question is waiting.
      () => vscode.window.state.focused,
      vscode.Uri.joinPath(mediaUri, 'icon.png').fsPath
    );
    this.bridge = bridge;

    // Keep `@currentfile` pointed at the editor's active file. Seed with the
    // file open now, then follow editor changes. A focus shift to the sidebar
    // reports an undefined active editor; ignore that so the mention keeps
    // referring to the last real file the user was looking at.
    bridge.setCurrentFile(activeWorkspaceFile());
    const activeEditorSub = vscode.window.onDidChangeActiveTextEditor(
      (editor) => {
        const file = activeWorkspaceFile(editor);
        if (file) bridge.setCurrentFile(file);
      }
    );

    webview.onDidReceiveMessage((message: WebviewToHost) => {
      // Never let a handler failure escape as an unhandled rejection in the
      // extension host — log it so it shows in the Developer Tools console.
      bridge.handle(message).catch((error: unknown) => {
        console.error(`[${APP_NAME}] failed to handle webview message`, error);
      });
    });

    webviewView.onDidDispose(() => {
      activeEditorSub.dispose();
      baselineSub.dispose();
      baselineProvider.dispose();
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

  /**
   * Attaches files (by absolute path) to the chat composer — the context-menu
   * counterpart to drag-and-drop. The bridge reads them from disk and the
   * webview stages them as chips (see AttachDroppedPaths).
   */
  public async attachFiles(paths: string[]): Promise<void> {
    await this.bridge?.handle({
      type: WebviewMessageType.AttachDroppedPaths,
      paths,
    });
  }

  /** Reveals the Settings editor tab. */
  public openSettings(): void {
    this.settings.reveal();
  }

  private renderHtml(webview: vscode.Webview, mediaUri: vscode.Uri): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(mediaUri, 'webview.css')
    );
    // Only the host can resolve a bundled `media/` asset to a webview-safe URI;
    // hand it to the webview as a global so the UI can show the brand emblem.
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
    <title>${APP_NAME}</title>
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}">window.JUSTCODE_LOGO_URI = ${JSON.stringify(logoUri.toString())};</script>
    <script nonce="${nonce}" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}

/** Opens a terminal running the CLI's interactive provider-connect flow. */
function openConnectTerminal(): void {
  const terminal = vscode.window.createTerminal(`${APP_NAME} Connect`);
  terminal.show();
  terminal.sendText('justcode connect');
}

/** Workspace folder the tools resolve against; the first folder, or undefined. */
function resolveWorkspaceRoot(): string {
  const folder = vscode.workspace.workspaceFolders?.[0];
  return folder ? folder.uri.fsPath : process.cwd();
}

/**
 * The active editor's file as a workspace-relative path, or undefined when no
 * file-backed editor is active or it sits outside the workspace. Used to drive
 * the `@currentfile` mention. Defaults to the current active editor.
 */
function activeWorkspaceFile(
  editor: vscode.TextEditor | undefined = vscode.window.activeTextEditor
): string | undefined {
  const uri = editor?.document.uri;
  if (!uri || uri.scheme !== 'file') return undefined;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return undefined;
  return vscode.workspace.asRelativePath(uri, false);
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
