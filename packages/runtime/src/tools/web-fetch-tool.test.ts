import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebFetchTool } from '@runtime/tools/web-fetch-tool';

describe('WebFetchTool', () => {
  let tool: WebFetchTool;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    tool = new WebFetchTool();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = (args: Record<string, unknown>, signal?: AbortSignal) =>
    tool.execute(JSON.stringify(args), {
      workspaceRoot: '/tmp',
      ...(signal ? { signal } : {}),
    });

  const htmlResponse = (body: string, contentType = 'text/html'): Response =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': contentType },
    });

  it('strips HTML down to readable text', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        '<html><head><title>t</title><style>.a{color:red}</style></head>' +
          '<body><h1>Hello</h1><p>World &amp; everyone</p>' +
          '<script>alert(1)</script></body></html>'
      )
    );

    const result = await run({ url: 'https://example.com' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Fetched https://example.com/');
    expect(result.content).toContain('Hello');
    expect(result.content).toContain('World & everyone');
    expect(result.content).not.toContain('alert(1)');
    expect(result.content).not.toContain('color:red');
  });

  it('returns plain text responses as-is', async () => {
    fetchMock.mockResolvedValue(
      new Response('just text', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await run({ url: 'https://example.com/file.txt' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('just text');
  });

  it('rejects non-http(s) URLs without fetching', async () => {
    const result = await run({ url: 'file:///etc/passwd' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('absolute http:// or https:// URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports non-OK responses as errors', async () => {
    fetchMock.mockResolvedValue(
      new Response('nope', { status: 404, statusText: 'Not Found' })
    );

    const result = await run({ url: 'https://example.com/missing' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('404');
    expect(result.content).toContain('Not Found');
  });

  it('truncates content beyond max_length', async () => {
    fetchMock.mockResolvedValue(
      new Response('abcdefghij', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      })
    );

    const result = await run({ url: 'https://example.com', max_length: 4 });

    expect(result.content).toContain('abcd');
    expect(result.content).toContain('content truncated at 4 characters');
    expect(result.content).not.toContain('efgh');
  });

  it('rejects unparseable arguments', async () => {
    const result = await tool.execute('not json', { workspaceRoot: '/tmp' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Invalid arguments');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports cancellation via the abort signal', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_input, init) => {
      controller.abort();
      return Promise.reject(
        (init as RequestInit | undefined)?.signal?.reason ??
          new Error('aborted')
      );
    });

    const result = await run({ url: 'https://example.com' }, controller.signal);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('cancelled');
  });

  it('summarizes the call for the UI', () => {
    const view = tool.describe(JSON.stringify({ url: 'https://example.com' }));

    expect(view.title).toBe('webfetch: https://example.com');
    expect(view.preview).toBe('https://example.com');
  });
});
