import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { McpClient } from '@runtime/mcp/mcp-client';
import { mcpConfigPath } from '@runtime/mcp/mcp-config';
import { loadMcpTools, mcpCategory } from '@runtime/mcp/load-mcp-tools';
import { mcpToolName } from '@runtime/mcp/mcp-tool';

/**
 * A minimal MCP server over stdio (newline-delimited JSON-RPC) used to exercise
 * the real handshake/call path without depending on an external server. It
 * exposes one `echo` tool and prints a stray non-JSON log line first to prove
 * the client ignores noise on stdout.
 */
const SERVER_SCRIPT = `
let buffer = '';
process.stderr.write('starting up\\n');
process.stdout.write('not-json log line\\n');
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let i;
  while ((i = buffer.indexOf('\\n')) !== -1) {
    const line = buffer.slice(0, i).trim();
    buffer = buffer.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line);
    if (msg.method === 'initialize') {
      reply(msg.id, { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'echo', version: '1' } });
    } else if (msg.method === 'tools/list') {
      reply(msg.id, { tools: [{ name: 'echo', description: 'Echo back the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] });
    } else if (msg.method === 'tools/call') {
      if (msg.params.name === 'boom') {
        replyError(msg.id, 'kaboom');
      } else {
        reply(msg.id, { content: [{ type: 'text', text: 'echo: ' + msg.params.arguments.text }], isError: false });
      }
    }
  }
});
function reply(id, result) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n'); }
function replyError(id, message) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code: -1, message } }) + '\\n'); }
`;

const dirs: string[] = [];
const clients: McpClient[] = [];

async function serverScript(): Promise<{ dir: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'justcode-mcp-srv-'));
  dirs.push(dir);
  const path = join(dir, 'server.mjs');
  await writeFile(path, SERVER_SCRIPT, 'utf8');
  return { dir, path };
}

afterEach(async () => {
  for (const client of clients) client.close();
  clients.length = 0;
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
  dirs.length = 0;
});

describe('McpClient', () => {
  it('connects, lists tools, and calls a tool', async () => {
    const { path } = await serverScript();
    const client = new McpClient('echo', {
      command: process.execPath,
      args: [path],
    });
    clients.push(client);

    await client.connect();
    const tools = await client.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]?.name).toBe('echo');

    const result = await client.callTool('echo', { text: 'hi' });
    expect(result).toEqual({ content: 'echo: hi', isError: false });
  });

  it('reports a JSON-RPC error as a failed request', async () => {
    const { path } = await serverScript();
    const client = new McpClient('echo', {
      command: process.execPath,
      args: [path],
    });
    clients.push(client);
    await client.connect();
    await expect(client.callTool('boom', {})).rejects.toThrow(/kaboom/);
  });

  it('rejects in-flight requests when the server fails to start', async () => {
    const client = new McpClient('nope', {
      command: 'definitely-not-a-binary',
    });
    clients.push(client);
    await expect(client.connect()).rejects.toThrow();
  });
});

describe('loadMcpTools', () => {
  it('launches configured servers and adapts their tools', async () => {
    const { dir, path } = await serverScript();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: { echo: { command: process.execPath, args: [path] } },
      }),
      'utf8'
    );

    const loaded = await loadMcpTools(dir);
    try {
      expect(loaded.tools).toHaveLength(1);
      expect(loaded.tools[0]?.definition.name).toBe(
        mcpToolName('echo', 'echo')
      );
      expect(loaded.displays[0]).toMatchObject({
        name: mcpToolName('echo', 'echo'),
        label: 'echo',
        category: mcpCategory('echo'),
        summary: 'Echo back the text.',
      });
    } finally {
      loaded.dispose();
    }
  });

  it('skips disabled servers', async () => {
    const { dir, path } = await serverScript();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          echo: { command: process.execPath, args: [path], disabled: true },
        },
      }),
      'utf8'
    );
    const loaded = await loadMcpTools(dir);
    expect(loaded.tools).toHaveLength(0);
  });

  it('returns nothing when no config exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'justcode-mcp-empty-'));
    dirs.push(dir);
    const loaded = await loadMcpTools(dir);
    expect(loaded.tools).toHaveLength(0);
  });

  it('skips a server that fails to launch without throwing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'justcode-mcp-bad-'));
    dirs.push(dir);
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({ mcpServers: { bad: { command: 'not-a-real-binary' } } }),
      'utf8'
    );
    const loaded = await loadMcpTools(dir);
    expect(loaded.tools).toHaveLength(0);
  });
});
