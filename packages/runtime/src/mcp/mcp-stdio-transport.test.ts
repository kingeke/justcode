import { describe, expect, it } from 'vitest';

import { buildStdioEnv } from '@runtime/mcp/mcp-stdio-transport';

describe('buildStdioEnv', () => {
  const source: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/dev',
    OPENAI_API_KEY: 'sk-secret',
    GITHUB_TOKEN: 'ghp_secret',
    AWS_SECRET_ACCESS_KEY: 'aws-secret',
    DB_PASSWORD: 'hunter2',
    MY_CREDENTIAL: 'x',
    LANG: 'en_US.UTF-8',
  };

  it('passes through ordinary vars but drops secret-shaped ones', () => {
    const env = buildStdioEnv(undefined, source);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/dev');
    expect(env.LANG).toBe('en_US.UTF-8');

    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.DB_PASSWORD).toBeUndefined();
    expect(env.MY_CREDENTIAL).toBeUndefined();
  });

  it('lets an explicitly-configured server env override the filter', () => {
    const env = buildStdioEnv({ GITHUB_TOKEN: 'granted' }, source);

    // A token the user deliberately put in mcp.json is allowed through.
    expect(env.GITHUB_TOKEN).toBe('granted');
    // ...but unrelated inherited secrets are still stripped.
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});
