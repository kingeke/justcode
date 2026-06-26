import { logRequestResponse } from '@core/application/debug-log';

/**
 * Generic OAuth 2.0 device-authorization-grant helper (RFC 8628), used by the
 * GitHub Copilot sign-in. Requests a device code, surfaces the user code +
 * verification URL via {@link onPrompt}, then polls until the user authorizes —
 * honoring `authorization_pending` and `slow_down` responses.
 */

export interface DeviceFlowPrompt {
  userCode: string;
  verificationUri: string;
  expiresInSeconds: number;
}

export interface DeviceFlowOptions {
  clientId: string;
  scope: string;
  deviceCodeUrl: string;
  accessTokenUrl: string;
  onPrompt: (prompt: DeviceFlowPrompt) => void;
  signal?: AbortSignal;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Runs the device flow end to end and resolves with the GitHub access token. */
export async function runDeviceFlow(
  options: DeviceFlowOptions
): Promise<string> {
  const device = await postForm<DeviceCodeResponse>(options.deviceCodeUrl, {
    client_id: options.clientId,
    scope: options.scope,
  });

  options.onPrompt({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    expiresInSeconds: device.expires_in,
  });

  let intervalMs = (device.interval || 5) * 1000;
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error('Sign-in cancelled.');
    }
    await sleep(intervalMs);

    const token = await postForm<AccessTokenResponse>(options.accessTokenUrl, {
      client_id: options.clientId,
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });

    if (token.access_token) return token.access_token;

    switch (token.error) {
      case 'authorization_pending':
        break;
      case 'slow_down':
        intervalMs += 5000;
        break;
      default:
        throw new Error(
          token.error_description ??
            token.error ??
            'Device authorization failed.'
        );
    }
  }

  throw new Error('Sign-in timed out. Please try again.');
}

async function postForm<T>(
  url: string,
  fields: Record<string, string>
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(fields),
  });
  if (!response.ok) {
    const text = await response.text();
    await logRequestResponse({
      request: {
        url,
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
        },
        body: fields,
      },
      response: {
        url,
        status: response.status,
        ok: response.ok,
        body: text,
      },
    });
    throw new Error(`Request to ${url} failed with status ${response.status}.`);
  }
  const parsed = (await response.json()) as T;
  await logRequestResponse({
    request: {
      url,
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
      },
      body: fields,
    },
    response: {
      url,
      status: response.status,
      ok: response.ok,
      body: parsed,
    },
  });
  return parsed;
}
