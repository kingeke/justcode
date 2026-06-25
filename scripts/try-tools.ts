/**
 * Manual harness for exercising the file tools without an LLM.
 *
 * Usage:  npx tsx scripts/try-tools.ts
 *
 * It spins up a throwaway sandbox directory, runs write -> read -> edit against
 * it, and prints each tool's result (and the colored diff a real run would show
 * in the approval prompt). Tweak the calls below to try your own scenarios.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalWorkspaceFileService } from '@runtime/workspace/local-workspace-file-service';
import { WriteFileTool } from '@runtime/tools/write-file-tool';
import { ReadFileTool } from '@runtime/tools/read-file-tool';
import { EditFileTool } from '@runtime/tools/edit-file-tool';
import { renderDiff } from '@cli/ui/render-diff';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'justcode-try-'));
  const workspace = new LocalWorkspaceFileService(root);
  const context = { workspaceRoot: root };

  // Read limit is a fn so you can change it between calls if you want.
  let maxReadLines = 200;
  const write = new WriteFileTool(workspace);
  const edit = new EditFileTool(workspace);
  const read = new ReadFileTool(workspace, () => maxReadLines);

  const call = async (
    label: string,
    tool: WriteFileTool | ReadFileTool | EditFileTool,
    args: Record<string, unknown>
  ): Promise<void> => {
    const raw = JSON.stringify(args);
    console.log(`\n=== ${label} ===`);
    console.log('args:', raw);
    if ('previewDiff' in tool && typeof tool.previewDiff === 'function') {
      const diff = await tool.previewDiff(raw, context);
      if (diff) console.log('diff:\n' + renderDiff(diff));
    }
    const result = await tool.execute(raw, context);
    console.log(
      `result${result.isError ? ' (ERROR)' : ''}:\n${result.content}`
    );
  };

  await call('write index.html', write, {
    path: 'index.html',
    content: '<div>\n  <p>This is a serious file</p>\n</div>\n',
  });

  await call('read index.html', read, { path: 'index.html' });

  await call('edit (unique match)', edit, {
    path: 'index.html',
    old_string: 'serious',
    new_string: 'not serious',
  });

  await call('read after edit', read, { path: 'index.html' });

  // Try a long-line + paging scenario.
  maxReadLines = 3;
  await call('write many lines', write, {
    path: 'big.txt',
    content: Array.from({ length: 8 }, (_, i) => `line ${i + 1}`).join('\n'),
  });
  await call('read page 1 (limit 3)', read, { path: 'big.txt' });
  await call('read page 2 (offset 4)', read, { path: 'big.txt', offset: 4 });

  await rm(root, { recursive: true, force: true });
  console.log(`\n(sandbox ${root} cleaned up)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
