import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface GlobalConfig {
  lastModel?: string;
  lastProvider?: string;
  thinkingCollapsed?: boolean;
}

export async function readGlobalConfig(configDirectory: string): Promise<GlobalConfig> {
  try {
    const raw = await readFile(join(configDirectory, 'config.json'), 'utf8');
    return JSON.parse(raw) as GlobalConfig;
  } catch {
    return {};
  }
}

export async function writeGlobalConfig(
  configDirectory: string,
  config: GlobalConfig
): Promise<void> {
  await mkdir(configDirectory, { recursive: true });
  await writeFile(
    join(configDirectory, 'config.json'),
    `${JSON.stringify(config, null, 2)}\n`,
    'utf8'
  );
}
