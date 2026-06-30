import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { McpClient } from '@runtime/mcp/mcp-client';

/**
 * A tiny Streamable HTTP MCP server for tests. It answers `initialize` and
 * `tools/list` as plain JSON, and `tools/call` as an SSE stream (to exercise
 * both reply encodings the transport must handle). It also issues a session id
 * on initialize and asserts the client echoes it back, plus a stray header so we
 * can confirm config headers are sent.
 */
function startServer(): Promise<{
  url: string;
  server: Server;
  auth: string[];
}> {
  const auth: string[] = [];
  const server = createServer((req, res) => {
    if (req.method === 'DELETE') {
      res.statusCode = 200;
      res.end();
      return;
    }
    const authHeader = req.headers['authorization'];
    if (typeof authHeader === 'string') auth.push(authHeader);

    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const message = JSON.parse(body) as {
        id?: number;
        method: string;
        params?: { name?: string; arguments?: { text?: string } };
      };

      if (message.method === 'notifications/initialized') {
        res.statusCode = 202;
        res.end();
        return;
      }

      if (message.method === 'initialize') {
        res.setHeader('content-type', 'application/json');
        res.setHeader('mcp-session-id', 'sess-123');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2025-06-18', capabilities: {} },
          })
        );
        return;
      }

      if (message.method === 'tools/list') {
        // Reject if the client didn't echo the negotiated session id.
        if (req.headers['mcp-session-id'] !== 'sess-123') {
          res.statusCode = 400;
          res.end('missing session');
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo text.',
                  inputSchema: { type: 'object' },
                },
              ],
            },
          })
        );
        return;
      }

      if (message.method === 'tools/call') {
        // Reply as an SSE stream: a stray notification first, then the result.
        res.setHeader('content-type', 'text/event-stream');
        res.write('event: message\ndata: {"jsonrpc":"2.0","method":"x"}\n\n');
        res.write(
          `data: ${JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              content: [
                {
                  type: 'text',
                  text: `echo: ${message.params?.arguments?.text}`,
                },
              ],
              isError: false,
            },
          })}\n\n`
        );
        res.end();
        return;
      }

      res.statusCode = 404;
      res.end();
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}/mcp`, server, auth });
    });
  });
}

let active: Server | undefined;
let client: McpClient | undefined;

afterEach(async () => {
  client?.close();
  client = undefined;
  if (active) {
    await new Promise<void>((resolve) => active?.close(() => resolve()));
    active = undefined;
  }
});

describe('McpClient over HTTP', () => {
  it('initializes, lists tools (JSON), and calls a tool (SSE)', async () => {
    const { url, server, auth } = await startServer();
    active = server;

    client = new McpClient('remote', {
      url,
      headers: { Authorization: 'Bearer tok' },
    });
    await client.connect();

    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('echo');

    const result = await client.callTool('echo', { text: 'hi' });
    expect(result).toEqual({ content: 'echo: hi', isError: false });

    // The configured auth header reached the server on every request.
    expect(auth.every((value) => value === 'Bearer tok')).toBe(true);
    expect(auth.length).toBeGreaterThan(0);
  });

  it('surfaces an HTTP error from an unreachable endpoint', async () => {
    client = new McpClient('remote', { url: 'http://127.0.0.1:1/mcp' });
    await expect(client.connect()).rejects.toThrow();
  });
});
