import type { Agent, fetch as UndiciFetch } from 'undici';

/**
 * Undici (Node's fetch implementation) applies its own default
 * `headersTimeout` and `bodyTimeout` of 300 seconds per request, independent
 * of any AbortSignal the caller passes. A local model that streams a long
 * generation — or a cloud model on a slow reasoning turn — can legitimately
 * exceed that, and undici then kills the request with UND_ERR_BODY_TIMEOUT
 * even though tokens are still arriving.
 *
 * Chat requests must never be killed by a fixed client-side deadline: the
 * user's abort signal (Esc / cancel) is the only thing allowed to stop them.
 * `streamFetch` disables both undici timeouts entirely. Node's built-in fetch
 * refuses dispatchers created by a different undici version, so streaming
 * requests go through the bundled undici's own `fetch` with a no-timeout
 * Agent. Under Bun the runtime's fetch has no such deadline, so the global
 * fetch is used as-is; undici is loaded lazily so Bun never evaluates it.
 */
interface UndiciRuntime {
  fetch: typeof UndiciFetch;
  agent: Agent;
}

let runtime: Promise<UndiciRuntime> | undefined;

function loadUndici(): Promise<UndiciRuntime> {
  if (!runtime) {
    runtime = import('undici').then((undici) => ({
      fetch: undici.fetch,
      agent: new undici.Agent({
        headersTimeout: 0,
        bodyTimeout: 0,
        // Match the IPv6 hardening applied to the global fetch dispatcher
        // (see apps/vscode/src/extension.ts): fall back to IPv4 when IPv6 is
        // advertised but unroutable.
        connect: { autoSelectFamily: true },
      }),
    }));
  }
  return runtime;
}

function isBun(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.bun);
}

/**
 * Tests stub `globalThis.fetch` with `vi.fn()` (`vi.stubGlobal('fetch', ...)`)
 * to intercept provider requests. A vitest mock carries a `.mock` state
 * object; when present, route through it so the stub sees the request instead
 * of undici hitting the real network.
 */
function mockedGlobalFetch(): typeof fetch | undefined {
  const candidate = globalThis.fetch as unknown;
  const hasMockState =
    typeof candidate === 'function' &&
    (candidate as unknown as { mock?: unknown }).mock !== undefined;
  return hasMockState ? globalThis.fetch : undefined;
}

/**
 * A fetch for streaming model responses that is never killed by a client-side
 * request deadline — only the caller's AbortSignal can stop it.
 */
export async function streamFetch(
  url: string,
  init: RequestInit
): Promise<Response> {
  const mocked = mockedGlobalFetch();
  if (mocked) {
    return mocked(url, init);
  }
  if (isBun()) {
    return fetch(url, init);
  }
  const undici = await loadUndici();
  const response = await undici.fetch(url, {
    ...(init as Parameters<typeof UndiciFetch>[1]),
    dispatcher: undici.agent,
  });
  // Undici's Response is structurally identical for our purposes (ok, status,
  // text, json, body.getReader); only the TS declarations differ.
  return response as unknown as Response;
}
