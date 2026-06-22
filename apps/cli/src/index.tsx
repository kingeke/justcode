import { createCli, normalizeArgv } from '@cli/bootstrap/create-cli';

await createCli().parseAsync(normalizeArgv(process.argv));
