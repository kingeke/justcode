import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';

import {
  ensureMcpConfigFile,
  mcpConfigPath,
  readMcpConfig,
} from '@runtime/mcp/mcp-config';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'justcode-mcp-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    dirs.map((dir) => rm(dir, { recursive: true, force: true }))
  );
  dirs.length = 0;
});

describe('readMcpConfig', () => {
  it('returns an empty map when no file exists', async () => {
    const dir = await tempDir();
    expect(await readMcpConfig(dir)).toEqual({});
  });

  it('returns an empty map for malformed JSON', async () => {
    const dir = await tempDir();
    await writeFile(mcpConfigPath(dir), '{ not json', 'utf8');
    expect(await readMcpConfig(dir)).toEqual({});
  });

  it('parses a valid config with command, args, and env', async () => {
    const dir = await tempDir();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          playwright: {
            command: 'npx',
            args: ['@playwright/mcp@latest'],
            env: { TOKEN: 'abc' },
          },
        },
      }),
      'utf8'
    );
    expect(await readMcpConfig(dir)).toEqual({
      playwright: {
        command: 'npx',
        args: ['@playwright/mcp@latest'],
        env: { TOKEN: 'abc' },
      },
    });
  });

  it('skips entries missing a command and filters non-string args', async () => {
    const dir = await tempDir();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          good: { command: 'a', args: ['x', 2, 'y'] },
          bad: { args: ['x'] },
        },
      }),
      'utf8'
    );
    expect(await readMcpConfig(dir)).toEqual({
      good: { command: 'a', args: ['x', 'y'] },
    });
  });

  it('parses a remote (url) server with headers', async () => {
    const dir = await tempDir();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          remote: {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer x' },
          },
        },
      }),
      'utf8'
    );
    expect(await readMcpConfig(dir)).toEqual({
      remote: {
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer x' },
      },
    });
  });

  it('skips entries with neither a command nor a url', async () => {
    const dir = await tempDir();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({
        mcpServers: {
          good: { url: 'https://example.com/mcp' },
          bad: { headers: { a: 'b' } },
        },
      }),
      'utf8'
    );
    expect(await readMcpConfig(dir)).toEqual({
      good: { url: 'https://example.com/mcp' },
    });
  });

  it('carries the disabled flag through', async () => {
    const dir = await tempDir();
    await writeFile(
      mcpConfigPath(dir),
      JSON.stringify({ mcpServers: { s: { command: 'a', disabled: true } } }),
      'utf8'
    );
    expect(await readMcpConfig(dir)).toEqual({
      s: { command: 'a', disabled: true },
    });
  });
});

describe('ensureMcpConfigFile', () => {
  it('seeds an empty template when the file is absent', async () => {
    const dir = await tempDir();
    const path = await ensureMcpConfigFile(dir);
    expect(path).toBe(mcpConfigPath(dir));
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    expect(parsed).toEqual({ mcpServers: {} });
  });

  it('leaves an existing file untouched', async () => {
    const dir = await tempDir();
    const existing = JSON.stringify({ mcpServers: { s: { command: 'a' } } });
    await writeFile(mcpConfigPath(dir), existing, 'utf8');
    await ensureMcpConfigFile(dir);
    expect(await readFile(mcpConfigPath(dir), 'utf8')).toBe(existing);
  });
});
