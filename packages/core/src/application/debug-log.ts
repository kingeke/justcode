import { appendFile, mkdir, unlink } from 'node:fs/promises';
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

// Master switch for on-disk logging. Defaults to DISABLED so no host writes to
// the user's disk unless it explicitly opts in: the CLI enables it only when a
// dev signal is present (see apps/cli/src/bootstrap/create-cli.tsx) and the
// VSCode extension only in Development mode. A shipped/production build that
// never calls setDebugLoggingEnabled therefore stays silent. When disabled,
// both writing and deleting are no-ops so we never touch user files.
let loggingEnabled = false;

/**
 * Enable or disable all on-disk debug logging. Even when enabled the serializer
 * redacts auth headers and token fields (see {@link redactSensitive}), but
 * logging remains a dev-only convenience and should stay off in production.
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
    // Append so entries land in chronological (ascending) order: oldest first,
    // newest at the bottom.
    await appendFile(filePath, `${formatEntry(value)}\n`, 'utf8');
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

/**
 * Property names whose values are secrets and must never be written to disk,
 * whatever nesting they appear at. Matched case-insensitively. Covers auth
 * headers (`authorization`, `x-api-key`, `anthropic-beta`, cookies) and OAuth
 * token-exchange body fields (`access_token`, `refresh_token`, `client_secret`,
 * `code`, `api_key`, and common variants).
 */
const SENSITIVE_KEYS = new Set([
  'authorization',
  'x-api-key',
  'anthropic-beta',
  'cookie',
  'set-cookie',
  'proxy-authorization',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'api_key',
  'apikey',
  'code',
  'password',
]);

const REDACTED = '[REDACTED]';

/**
 * Backstop that scrubs bearer tokens and `sk-…`-style keys embedded in free-form
 * strings (e.g. a token that slipped into an error message or URL), so a value
 * that isn't behind a known key name still can't leak.
 */
function scrubString(text: string): string {
  return text
    .replace(/\bBearer\s+[\w.\-~+/]+=*/gi, `Bearer ${REDACTED}`)
    .replace(/\bsk-[A-Za-z0-9_\-]{8,}/g, REDACTED);
}

function redactSensitive(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key.toLowerCase())) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return scrubString(value);
  }
  return value;
}

function replacer(key: string, value: unknown): unknown {
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

  return redactSensitive(key, value);
}

function normalizeRequest(request: RequestResponseLogEntry['request']): {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
} {
  return {
    ...request,
    url: scrubString(request.url),
    headers: deepRedact(request.headers ?? {}) as Record<string, string>,
    body: deepRedact(request.body ?? ''),
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
    url: scrubString(response.url),
    body: deepRedact(response.body ?? ''),
  };
}

/**
 * Recursively strips secrets from a logged value before it reaches disk. Objects
 * and arrays are walked so a `refresh_token` at any depth is masked; a string
 * that is itself serialized JSON (e.g. an OAuth token-exchange response body) is
 * parsed and redacted rather than logged verbatim, and any remaining free-form
 * string is scrubbed of bearer/`sk-` tokens. This runs ahead of the JSON
 * `replacer`, which repeats the same masking as a backstop.
 */
function deepRedact(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return deepRedact(JSON.parse(trimmed));
      } catch {
        // Not valid JSON — fall through to plain string scrubbing.
      }
    }
    return scrubString(value);
  }
  if (Array.isArray(value)) {
    return value.map(deepRedact);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.has(key.toLowerCase())
        ? REDACTED
        : deepRedact(nested);
    }
    return out;
  }
  return value;
}
