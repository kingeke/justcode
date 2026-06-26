import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSearchTool } from '@runtime/tools/web-search-tool';

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    tool = new WebSearchTool();
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

  /** Build one DuckDuckGo HTML result block. */
  const resultBlock = (
    target: string,
    title: string,
    snippet: string
  ): string => {
    const href = `//duckduckgo.com/l/?uddg=${encodeURIComponent(target)}&rut=x`;
    return (
      '<div class="result results_links results_links_deep web-result">' +
      `<h2 class="result__title"><a rel="nofollow" class="result__a" href="${href}">${title}</a></h2>` +
      `<a class="result__snippet" href="${href}">${snippet}</a>` +
      '</div>'
    );
  };

  const htmlResponse = (body: string): Response =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

  it('parses titles, decoded URLs, and snippets', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        resultBlock(
          'https://example.com/page',
          'Example <b>Title</b>',
          'A short snippet &amp; description.'
        )
      )
    );

    const result = await run({ query: 'hello world' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Search results for "hello world"');
    expect(result.content).toContain('1. Example Title');
    expect(result.content).toContain('https://example.com/page');
    expect(result.content).toContain('A short snippet & description.');
    // The query is URL-encoded into the DuckDuckGo endpoint.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('q=hello%20world'),
      expect.anything()
    );
  });

  it('respects max_results', async () => {
    fetchMock.mockResolvedValue(
      htmlResponse(
        resultBlock('https://a.com', 'First', 'one') +
          resultBlock('https://b.com', 'Second', 'two') +
          resultBlock('https://c.com', 'Third', 'three')
      )
    );

    const result = await run({ query: 'q', max_results: 2 });

    expect(result.content).toContain('1. First');
    expect(result.content).toContain('2. Second');
    expect(result.content).not.toContain('3. Third');
  });

  it('reports an empty result page', async () => {
    fetchMock.mockResolvedValue(htmlResponse('<div>no results here</div>'));

    const result = await run({ query: 'asdfqwerty' });

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('No results found for "asdfqwerty"');
  });

  it('rejects an empty query without fetching', async () => {
    const result = await run({ query: '   ' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('non-empty string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports non-OK responses as errors', async () => {
    fetchMock.mockResolvedValue(
      new Response('nope', { status: 503, statusText: 'Service Unavailable' })
    );

    const result = await run({ query: 'q' });

    expect(result.isError).toBe(true);
    expect(result.content).toContain('503');
    expect(result.content).toContain('Service Unavailable');
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

    const result = await run({ query: 'q' }, controller.signal);

    expect(result.isError).toBe(true);
    expect(result.content).toContain('cancelled');
  });

  it('summarizes the call for the UI', () => {
    const view = tool.describe(JSON.stringify({ query: 'latest news' }));

    expect(view.title).toBe('websearch: latest news');
    expect(view.preview).toBe('latest news');
  });
});
