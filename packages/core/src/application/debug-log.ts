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

// Directory the default `debug.log` lives in. The CLI runs anchored to the
// workspace so `process.cwd()` is correct there, but hosts that aren't anchored
// to a cwd (e.g. the VSCode extension host, whose cwd is VSCode's own working
// directory) must override this so logs land somewhere the user can find them.
let baseDirectory: string | undefined;

// Master switch for on-disk logging. Defaults to enabled so the CLI keeps its
// current behavior; hosts that must not write to the user's machine in shipped
// builds (e.g. the VSCode extension outside Development mode) turn it off. When
// disabled, both writing and deleting are no-ops so we never touch user files.
let loggingEnabled = true;

/**
 * Enable or disable all on-disk debug logging. The request/response logger
 * records full auth headers, so production hosts should disable it to avoid
 * writing secrets to the user's disk.
 */
export function setDebugLoggingEnabled(enabled: boolean): void {
  loggingEnabled = enabled;
}

/** Override the directory the default `debug.log` is written to. */
export function setDebugLogDirectory(directory: string): void {
  baseDirectory = directory;
}

function defaultFilePath(): string {
  return join(baseDirectory ?? process.cwd(), DEFAULT_FILE_NAME);
}

export async function logDebug(
  value: unknown,
  options: DebugLogOptions = {}
): Promise<void> {
  if (!loggingEnabled) return;
  try {
    const filePath = options.filePath ?? defaultFilePath();
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
  if (!loggingEnabled) return;
  try {
    const filePath = options.filePath ?? defaultFilePath();
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
