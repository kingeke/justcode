import type { HostToWebview, WebviewToHost } from '@ext/shared/protocol';
import type {
  SettingsHostToWebview,
  SettingsWebviewToHost,
} from '@ext/shared/settings-protocol';

/** The minimal slice of the VSCode webview API we use. */
interface VsCodeApi {
  postMessage(message: unknown): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// `acquireVsCodeApi` may be called only once per webview load; cache the single
// handle and route both the chat and settings message channels through it. The
// chat and settings UIs render in separate webview documents, so each document
// loads this module once and acquires its own handle.
const api = acquireVsCodeApi();

/**
 * Webview-safe URI for the JustCode emblem, injected into the HTML shell by the
 * host (which alone can resolve a `media/` asset to a `vscode-webview:` URI).
 * Undefined in test/non-VSCode contexts, so callers guard before rendering.
 */
export const logoUri: string | undefined = (
  window as unknown as { JUSTCODE_LOGO_URI?: string }
).JUSTCODE_LOGO_URI;

/** Sends a typed message from the chat webview to the extension host. */
export function postToHost(message: WebviewToHost): void {
  api.postMessage(message);
}

/** Subscribes to typed chat messages from the host; returns an unsubscribe fn. */
export function onHostMessage(
  handler: (message: HostToWebview) => void
): () => void {
  const listener = (event: MessageEvent<HostToWebview>): void => {
    handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** Sends a typed message from the settings webview to the extension host. */
export function postSettingsToHost(message: SettingsWebviewToHost): void {
  api.postMessage(message);
}

/** Subscribes to typed settings messages from the host. */
export function onSettingsMessage(
  handler: (message: SettingsHostToWebview) => void
): () => void {
  const listener = (event: MessageEvent<SettingsHostToWebview>): void => {
    handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
