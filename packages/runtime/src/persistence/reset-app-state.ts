import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  ASK_SYSTEM_PROMPT,
  DEFAULT_SYSTEM_PROMPT,
  PLAN_SYSTEM_PROMPT,
} from '@core/application/system-prompt';
import { MCP_CONFIG_FILE_NAME } from '@runtime/mcp/mcp-config';

export async function resetAppState(configDirectory: string): Promise<void> {
  await mkdir(configDirectory, { recursive: true });

  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(
      {
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        askSystemPrompt: ASK_SYSTEM_PROMPT,
        planSystemPrompt: PLAN_SYSTEM_PROMPT,
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  await rm(join(configDirectory, 'providers.json'), { force: true });
  await rm(join(configDirectory, 'models.json'), { force: true });
  await rm(join(configDirectory, MCP_CONFIG_FILE_NAME), { force: true });
  await Promise.all([
    rm(join(configDirectory, 'sessions'), { recursive: true, force: true }),
  ]);
}
