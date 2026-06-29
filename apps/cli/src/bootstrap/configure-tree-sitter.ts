// OpenTUI highlights markdown in a tree-sitter worker it spawns by path. Because
// that path is computed at runtime, `bun build --compile` never embeds the worker
// (or its web-tree-sitter dependency and wasm), so in the shipped binary the
// worker fails to start, highlighting returns nothing, and markdown renders raw —
// literal `**`, no bold, no code highlighting.
//
// We ship our own self-contained worker (web-tree-sitter and its wasm inlined; see
// scripts/build-tree-sitter-worker.mjs) and embed it as a file so the binary
// carries it, then point OpenTUI at it via OTUI_TREE_SITTER_WORKER_PATH. The
// `with { type: 'file' }` import is what makes bun --compile embed the file and
// hand back a runtime path (a real path in dev, a `$bunfs` path in the binary).
//
// @ts-expect-error bun resolves a `type: 'file'` import to its path as a string.
import workerPath from '@cli/generated/tree-sitter-worker.js' with { type: 'file' };

export function configureTreeSitterWorker(): void {
  // Respect an explicit override (e.g. tests or debugging); otherwise use ours.
  if (!process.env.OTUI_TREE_SITTER_WORKER_PATH) {
    process.env.OTUI_TREE_SITTER_WORKER_PATH = workerPath as string;
  }
}
