import { createCli } from '@cli/bootstrap/create-cli';

await createCli().parseAsync(process.argv);
