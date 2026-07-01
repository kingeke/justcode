import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebFetchTool } from '@runtime/tools/web-fetch-tool';

describe('WebFetchTool', () => {
  let tool: WebFetchTool;
  const fetchMock = vi.fn<typeof fetch>();
  // Default resolver maps every hostname to a public IP so the SSRF guard never
  // makes a real DNS query in the non-SSRF tests.
  const publicResolver = async () => ['93.184.216.34'];

  beforeEach(() => {
    tool = new WebFetchTool(publicResolver);
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

  describe('SSRF protection', () => {
    it.each([
      ['loopback', 'http://127.0.0.1/'],
      ['loopback ipv6', 'http://[::1]/'],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['private 10.x', 'http://10.0.0.5/'],
      ['private 192.168.x', 'http://192.168.1.1/admin'],
      ['localhost name', 'http://localhost:8080/'],
      ['unspecified', 'http://0.0.0.0/'],
    ])('refuses to fetch %s without a network call', async (_label, url) => {
      const result = await run({ url });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Refusing to fetch');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('refuses a public hostname that resolves to a private IP (DNS rebinding)', async () => {
      const rebinding = new WebFetchTool(async () => ['10.1.2.3']);

      const result = await rebinding.execute(
        JSON.stringify({ url: 'https://evil.example.com/' }),
        { workspaceRoot: '/tmp' }
      );

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Refusing to fetch');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('re-validates redirect targets and blocks an internal hop', async () => {
      fetchMock.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/latest/meta-data/' },
        })
      );

      const result = await run({ url: 'https://example.com/redirect' });

      expect(result.isError).toBe(true);
      expect(result.content).toContain('Refusing to fetch');
      // The first hop was fetched; the internal redirect target was not.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
