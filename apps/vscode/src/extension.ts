import * as dns from 'node:dns';
import * as net from 'node:net';

import * as vscode from 'vscode';

import { setDebugLoggingEnabled } from '@core/application/debug-log';
import { ChatViewProvider } from '@ext/host/chat-view-provider';

/**
 * Make the extension host's `fetch` (Node/undici) behave like the CLI's (Bun) on
 * networks with broken IPv6. Node resolves DNS "verbatim" since v17, so it tries
 * the AAAA (IPv6) address first; when the local network advertises IPv6 but has
 * no working route, the connection dies and undici surfaces only a generic
 * "fetch failed" — which is why the same request works in the Bun CLI, over a
 * VPN, or in curl (all of which fall back to IPv4 via Happy Eyeballs) but not in
 * the extension. Preferring IPv4 and enabling Happy Eyeballs removes the stall.
 */
function hardenNetworkForBrokenIpv6(): void {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Older runtimes may not support it; the autoSelectFamily fallback covers us.
  }
  try {
    net.setDefaultAutoSelectFamily?.(true);
  } catch {
    // Best-effort: not available on every Node version the host might ship.
  }
  // Configure undici's global agent (which backs the built-in `fetch`) with
  // Happy Eyeballs. net.setDefaultAutoSelectFamily() doesn't reach undici's
  // internal connection pool, so this is the only reliable way to make
  // `fetch()` calls — including OAuth flows and provider credential checks —
  // fall back to IPv4 when IPv6 is advertised but has no working route.
  // Node 18+ exposes undici under the `node:` prefix; try that first and fall
  // back to the bare specifier so the import survives across Electron builds.
  try {
    type UndiciShape = {
      setGlobalDispatcher: (d: object) => void;
      Agent: new (opts: { connect: { autoSelectFamily: boolean } }) => object;
    };
    let undici: UndiciShape | undefined;
    try { undici = require('node:undici') as UndiciShape; } catch { /* noop */ }
    if (!undici) {
      try { undici = require('undici') as UndiciShape; } catch { /* noop */ }
    }
    undici?.setGlobalDispatcher(
      new undici.Agent({ connect: { autoSelectFamily: true } })
    );
  } catch {
    // undici may not be importable in all Electron/Node runtime versions;
    // dns.setDefaultResultOrder is the baseline fallback.
  }
}

export function activate(context: vscode.ExtensionContext): void {
  hardenNetworkForBrokenIpv6();

  // Only write the request/response debug log (which includes auth headers) when
  // running from source in the Extension Development Host. A packaged/installed
  // build runs in Production mode and must never log to the user's machine.
  setDebugLoggingEnabled(
    context.extensionMode === vscode.ExtensionMode.Development
  );

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
    }),
    vscode.commands.registerCommand('justcode.openSettings', () => {
      provider.openSettings();
    })
  );
}

export function deactivate(): void {
  // Nothing to clean up: views dispose their own bridges via onDidDispose.
}
