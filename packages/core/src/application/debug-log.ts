import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface DebugLogOptions {
  filePath?: string;
}

export interface RequestResponseLogEntry {
  request: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: {
    url: string;
    status: number;
    ok: boolean;
    body?: unknown;
  };
}

const DEFAULT_FILE_NAME = 'debug.log';

export async function logDebug(
  value: unknown,
  options: DebugLogOptions = {}
): Promise<void> {
  try {
    const filePath = options.filePath ?? join(process.cwd(), DEFAULT_FILE_NAME);
    await mkdir(dirname(filePath), { recursive: true });
    // Prepend so the newest entry is at the top of the file. Best-effort: read
    // the prior contents (if any) and rewrite with the new entry first.
    let existing = '';
    try {
      existing = await readFile(filePath, 'utf8');
    } catch {
      // no prior log yet
    }
    await writeFile(filePath, `${formatEntry(value)}\n${existing}`, 'utf8');
  } catch {
    // best effort only; logging must never break the app
  }
}

export async function deleteDebugLog(
  options: DebugLogOptions = {}
): Promise<void> {
  try {
    const filePath = options.filePath ?? join(process.cwd(), DEFAULT_FILE_NAME);
    await unlink(filePath);
  } catch {
    // best effort only; startup cleanup must never break the app
  }
}

export async function logRequestResponse(
  entry: RequestResponseLogEntry,
  options: DebugLogOptions = {}
): Promise<void> {
  await logDebug(
    {
      request: normalizeRequest(entry.request),
      response: normalizeResponse(entry.response),
    },
    options
  );
}

function formatEntry(value: unknown): string {
  const timestamp = new Date().toISOString();
  const text = formatValue(value);
  return `[${timestamp}] ${text}`;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) {
    return value.stack ?? value.message;
  }

  try {
    return JSON.stringify(value, replacer, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (value === undefined) {
    return '';
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (
    typeof value === 'function' ||
    typeof value === 'symbol' ||
    typeof value === 'undefined'
  ) {
    return String(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return value;
}

function normalizeRequest(request: RequestResponseLogEntry['request']): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
} {
  return {
    ...request,
    headers: request.headers ?? {},
    body: request.body ?? '',
  };
}

function normalizeResponse(response: RequestResponseLogEntry['response']): {
  url: string;
  status: number;
  ok: boolean;
  body: unknown;
} {
  return {
    ...response,
    body: response.body ?? '',
  };
}
