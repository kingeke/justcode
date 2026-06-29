import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { logDebug, logRequestResponse } from '@core/application/debug-log';

describe('logDebug', () => {
  it('appends timestamped log lines in chronological order', async () => {
    const filePath = join(tmpdir(), `justcode-debug-${Date.now()}.log`);

    await logDebug({ hello: 'world' }, { filePath });
    await logDebug('plain text', { filePath });

    const contents = await readFile(filePath, 'utf8');
    // Each entry is timestamped, and the earliest entry sits at the top with the
    // most recent ("plain text") appended below it.
    expect(contents).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*Z\] \{/);
    expect(contents).toContain('"hello": "world"');
    expect(contents.indexOf('"hello": "world"')).toBeLessThan(
      contents.indexOf('plain text')
    );
  });

  it('normalizes request-response bodies to empty strings', async () => {
    const filePath = join(
      tmpdir(),
      `justcode-debug-${Date.now()}-exchange.log`
    );

    await logRequestResponse(
      {
        request: {
          url: 'https://example.com',
          method: 'POST',
          body: undefined,
        },
        response: {
          url: 'https://example.com',
          status: 200,
          ok: true,
          body: undefined,
        },
      },
      { filePath }
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).toContain('"body": ""');
    expect(contents).toContain('"request"');
    expect(contents).toContain('"response"');
  });
});
