import type { HostToWebview, WebviewToHost } from '@ext/shared/protocol';

/** The minimal slice of the VSCode webview API we use. */
interface VsCodeApi {
  postMessage(message: WebviewToHost): void;
  getState<T>(): T | undefined;
  setState<T>(state: T): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

// `acquireVsCodeApi` may be called only once per webview load; cache the handle.
const api = acquireVsCodeApi();

/** Sends a typed message to the extension host. */
export function postToHost(message: WebviewToHost): void {
  api.postMessage(message);
}

/** Subscribes to typed messages from the host; returns an unsubscribe fn. */
export function onHostMessage(
  handler: (message: HostToWebview) => void
): () => void {
  const listener = (event: MessageEvent<HostToWebview>): void => {
    handler(event.data);
  };
  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}
