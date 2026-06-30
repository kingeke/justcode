import { describe, expect, it, vi } from 'vitest';

import type { McpClient, McpCallResult } from '@runtime/mcp/mcp-client';
import { McpTool, mcpToolName } from '@runtime/mcp/mcp-tool';

function fakeClient(
  callTool: (
    name: string,
    args: Record<string, unknown>
  ) => Promise<McpCallResult>
): McpClient {
  return { callTool } as unknown as McpClient;
}

describe('mcpToolName', () => {
  it('namespaces by server and tool', () => {
    expect(mcpToolName('playwright', 'browser_navigate')).toBe(
      'mcp__playwright__browser_navigate'
    );
  });
});

describe('McpTool', () => {
  it('builds a namespaced definition from the remote tool', () => {
    const tool = new McpTool(
      fakeClient(() => Promise.resolve({ content: '', isError: false })),
      'playwright',
      {
        name: 'browser_navigate',
        description: 'Navigate the browser.',
        inputSchema: {
          type: 'object',
          properties: { url: { type: 'string' } },
        },
      }
    );
    expect(tool.definition.name).toBe('mcp__playwright__browser_navigate');
    expect(tool.definition.description).toBe('Navigate the browser.');
    expect(tool.definition.parameters).toEqual({
      type: 'object',
      properties: { url: { type: 'string' } },
    });
    expect(tool.requiresApproval).toBe(true);
  });

  it('falls back to an open schema when inputSchema is missing', () => {
    const tool = new McpTool(
      fakeClient(() => Promise.resolve({ content: '', isError: false })),
      's',
      { name: 't' }
    );
    expect(tool.definition.parameters).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: true,
    });
  });

  it('parses arguments and forwards them to the client', async () => {
    const callTool = vi.fn(() =>
      Promise.resolve({ content: 'done', isError: false })
    );
    const tool = new McpTool(fakeClient(callTool), 's', { name: 't' });
    const result = await tool.execute('{"url":"https://x.com"}');
    expect(callTool).toHaveBeenCalledWith('t', { url: 'https://x.com' });
    expect(result).toEqual({ content: 'done', isError: false });
  });

  it('treats empty arguments as an empty object', async () => {
    const callTool = vi.fn(() =>
      Promise.resolve({ content: 'ok', isError: false })
    );
    const tool = new McpTool(fakeClient(callTool), 's', { name: 't' });
    await tool.execute('');
    expect(callTool).toHaveBeenCalledWith('t', {});
  });

  it('rejects non-object arguments', async () => {
    const tool = new McpTool(
      fakeClient(() => Promise.resolve({ content: '', isError: false })),
      's',
      { name: 't' }
    );
    const result = await tool.execute('[1,2,3]');
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/expected a JSON object/);
  });

  it('surfaces a client failure as an error result', async () => {
    const tool = new McpTool(
      fakeClient(() => Promise.reject(new Error('boom'))),
      's',
      { name: 't' }
    );
    const result = await tool.execute('{}');
    expect(result.isError).toBe(true);
    expect(result.content).toMatch(/boom/);
  });

  it('propagates the server isError flag', async () => {
    const tool = new McpTool(
      fakeClient(() => Promise.resolve({ content: 'nope', isError: true })),
      's',
      { name: 't' }
    );
    const result = await tool.execute('{}');
    expect(result).toEqual({ content: 'nope', isError: true });
  });
});
