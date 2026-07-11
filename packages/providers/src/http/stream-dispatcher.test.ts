import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { streamFetch } from '@providers/http/stream-dispatcher';

/** Delay between body chunks; long enough to distinguish from an instant response. */
const CHUNK_DELAY_MS = 150;

let server: Server;
let url = '';

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/slow-body') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('first');
      setTimeout(() => {
        res.end('second');
      }, CHUNK_DELAY_MS);
      return;
    }
    if (req.url === '/never') {
      // Holds the body open until the client aborts.
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.write('start');
      req.on('close', () => res.destroy());
      return;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind to a port.');
  }
  url = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('streamFetch', () => {
  it('streams a slow body to completion without a client-side deadline', async () => {
    const response = await streamFetch(`${url}/slow-body`, { method: 'GET' });
    expect(response.ok).toBe(true);
    await expect(response.text()).resolves.toBe('firstsecond');
  });

  it('still honours the caller-provided abort signal', async () => {
    const controller = new AbortController();
    const response = await streamFetch(`${url}/never`, {
      method: 'GET',
      signal: controller.signal,
    });
    const pending = response.text();
    controller.abort();
    await expect(pending).rejects.toThrow();
  });
});
