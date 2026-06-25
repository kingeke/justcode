import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { ReadFileTool } from '@runtime/tools/read-file-tool';
import { DEFAULT_MAX_READ_LINES } from '@core/application/read-window';

async function main(): Promise<void> {
  const [path = 'test.html', offsetArg] = process.argv.slice(2);
  const offset = offsetArg ? Number.parseInt(offsetArg, 10) : 1;

  const tool = new ReadFileTool(
    new LocalWorkspaceFileService(process.cwd()),
    () => DEFAULT_MAX_READ_LINES
  );
  const result = await tool.execute(JSON.stringify({ path, offset }), {
    workspaceRoot: process.cwd(),
  });
  console.log(`isError: ${result.isError ?? false}`);
  console.log(result.content);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
