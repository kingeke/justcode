import * as vscode from 'vscode';

import { ChatViewProvider } from '@ext/host/chat-view-provider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      ChatViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand('justcode.openChat', () => {
      void vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    }),
    vscode.commands.registerCommand('justcode.newSession', () => {
      provider.newSession();
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up: views dispose their own bridges via onDidDispose.
}
