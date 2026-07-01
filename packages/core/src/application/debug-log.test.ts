import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  logDebug,
  logRequestResponse,
  setDebugLoggingEnabled,
} from '@core/application/debug-log';

// Logging defaults to OFF (production-safe); enable it for the tests that assert
// on written output, and restore the default afterwards.
beforeEach(() => setDebugLoggingEnabled(true));
afterEach(() => setDebugLoggingEnabled(false));

async function tempLogPath(suffix = ''): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'justcode-debug-'));
  return join(dir, `debug${suffix}.log`);
}

describe('logDebug', () => {
  it('appends timestamped log lines in chronological order', async () => {
    const filePath = await tempLogPath();

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
    const filePath = await tempLogPath('-exchange');

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

describe('debug logging gate', () => {
  it('writes nothing when logging is disabled', async () => {
    setDebugLoggingEnabled(false);
    const filePath = await tempLogPath('-disabled');

    await logDebug({ secret: 'value' }, { filePath });

    expect(existsSync(filePath)).toBe(false);
  });
});

describe('secret redaction', () => {
  it('redacts auth headers and never writes bearer/api-key values', async () => {
    const filePath = await tempLogPath('-headers');

    await logRequestResponse(
      {
        request: {
          url: 'https://api.example.com/v1',
          method: 'POST',
          headers: {
            authorization: 'Bearer sk-live-abcdef1234567890',
            'x-api-key': 'sk-ant-super-secret-key',
            'anthropic-beta': 'oauth-2025-04-20',
            'content-type': 'application/json',
          },
          body: { model: 'gpt-5', prompt: 'hi' },
        },
        response: { url: 'https://api.example.com/v1', status: 200, ok: true },
      },
      { filePath }
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).toContain('[REDACTED]');
    expect(contents).not.toContain('sk-live-abcdef1234567890');
    expect(contents).not.toContain('sk-ant-super-secret-key');
    // Non-sensitive headers survive.
    expect(contents).toContain('application/json');
  });

  it('redacts token fields inside a JSON-string response body', async () => {
    const filePath = await tempLogPath('-token-exchange');

    // Mirrors an OAuth token-exchange response, which is logged as a raw JSON
    // string rather than a structured object.
    await logRequestResponse(
      {
        request: { url: 'https://auth.example.com/token', method: 'POST' },
        response: {
          url: 'https://auth.example.com/token',
          status: 200,
          ok: true,
          body: JSON.stringify({
            access_token: 'at-9f8e7d6c5b4a',
            refresh_token: 'rt-1a2b3c4d5e6f',
            token_type: 'Bearer',
          }),
        },
      },
      { filePath }
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).not.toContain('at-9f8e7d6c5b4a');
    expect(contents).not.toContain('rt-1a2b3c4d5e6f');
    expect(contents).toContain('[REDACTED]');
  });

  it('scrubs bearer tokens embedded in free-form strings', async () => {
    const filePath = await tempLogPath('-freeform');

    await logDebug(
      { message: 'request failed with Authorization: Bearer sk-abc12345678' },
      { filePath }
    );

    const contents = await readFile(filePath, 'utf8');
    expect(contents).not.toContain('sk-abc12345678');
    expect(contents).toContain('[REDACTED]');
  });
});
