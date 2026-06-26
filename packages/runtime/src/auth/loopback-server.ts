import { createServer, type Server } from 'node:http';
import { AddressInfo } from 'node:net';

export interface LoopbackServer {
  /** The `http://127.0.0.1:<port><path>` redirect URI to hand the provider. */
  redirectUri: string;
  /** Resolves with the authorization `code` once the browser is redirected. */
  waitForCode(): Promise<string>;
  /** Tears the server down. Safe to call more than once. */
  close(): void;
}

const SUCCESS_HTML =
  '<!doctype html><html><body style="font-family:sans-serif;text-align:center;padding-top:4rem">' +
  '<h2>Signed in to JustCode</h2><p>You can close this tab and return to your terminal.</p>' +
  '</body></html>';

/**
 * Starts a one-shot loopback HTTP server that captures the OAuth redirect.
 * Validates the `state` parameter to defend against CSRF, serves a "you can
 * close this tab" page, and resolves {@link LoopbackServer.waitForCode} with the
 * authorization code. Binds {@link options.port} when given (some providers
 * require a fixed redirect port), otherwise an ephemeral port.
 */
export async function startLoopbackServer(options: {
  expectedState: string;
  port?: number;
  path?: string;
  host?: string;
  signal?: AbortSignal;
}): Promise<LoopbackServer> {
  const path = options.path ?? '/callback';
  const host = options.host ?? '127.0.0.1';
  let resolveCode!: (code: string) => void;
  let rejectCode!: (error: Error) => void;
  const codePromise = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server: Server = createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', `http://${host}`);
    if (requestUrl.pathname !== path) {
      res.writeHead(404).end();
      return;
    }

    const error = requestUrl.searchParams.get('error');
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');

    if (error) {
      res.writeHead(400).end(`Authorization failed: ${error}`);
      rejectCode(new Error(`Authorization failed: ${error}`));
      return;
    }
    if (state !== options.expectedState) {
      res.writeHead(400).end('State mismatch.');
      rejectCode(new Error('OAuth state mismatch — aborting for safety.'));
      return;
    }
    if (!code) {
      res.writeHead(400).end('Missing authorization code.');
      rejectCode(new Error('No authorization code was returned.'));
      return;
    }

    res.writeHead(200, { 'content-type': 'text/html' }).end(SUCCESS_HTML);
    resolveCode(code);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });

  const address = server.address() as AddressInfo;
  const redirectUri = `http://${host}:${address.port}${path}`;

  let closed = false;
  const closeServer = () => {
    if (!closed) {
      closed = true;
      server.close();
    }
  };

  // If the caller aborts before the redirect arrives, release the port.
  if (options.signal) {
    options.signal.addEventListener('abort', () => {
      rejectCode(new Error('OAuth sign-in was cancelled.'));
      closeServer();
    }, { once: true });
  }

  return {
    redirectUri,
    waitForCode: () => codePromise,
    close: closeServer,
  };
}
