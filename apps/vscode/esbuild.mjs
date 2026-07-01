import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import esbuild from 'esbuild';

import { syncExtensionVersion } from '../../scripts/sync-extension-version.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// Derive the extension manifest version from the root package.json (the single
// source of truth) before bundling, so any package/publish ships the right one.
syncExtensionVersion();

// The same path aliases the CLI build uses, so the extension reuses the core /
// runtime / providers packages straight from source. `@ext` is the extension's
// own alias (host + webview), matching the repo's per-package alias convention.
const alias = {
  '@ext': resolve(root, 'src'),
  '@core': resolve(root, '../../packages/core/src'),
  '@providers': resolve(root, '../../packages/providers/src'),
  '@runtime': resolve(root, '../../packages/runtime/src'),
};

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  alias,
  sourcemap: true,
  logLevel: 'info',
  // The reusable packages import sibling files with explicit `.js` specifiers
  // (e.g. `provider-catalog.js`) that actually resolve to `.ts` sources; let
  // esbuild rewrite those the way tsup does for the CLI.
  resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
};

// The extension host runs in VSCode's Node-based extension host. `vscode` is
// provided by the runtime and must stay external; everything else is bundled so
// the published extension needs no node_modules.
const hostBuild = {
  ...shared,
  entryPoints: [resolve(root, 'src/extension.ts')],
  outfile: resolve(root, 'dist/extension.js'),
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  // `undici` / `node:undici` are left external so the bundle resolves to the
  // version embedded in VS Code's Electron/Node runtime — required to call
  // setGlobalDispatcher. node:undici is the reliable path on Node 18+.
  external: ['vscode', 'undici', 'node:undici'],
};

// The webview runs in a browser context; bundle React + the UI to an IIFE and
// emit the imported CSS as a sibling file the provider links.
const webviewBuild = {
  ...shared,
  entryPoints: [resolve(root, 'src/webview/index.tsx')],
  outfile: resolve(root, 'media/webview.js'),
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  loader: { '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' },
};

if (watch) {
  const contexts = await Promise.all([
    esbuild.context(hostBuild),
    esbuild.context(webviewBuild),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('[justcode] watching for changes…');
} else {
  await Promise.all([esbuild.build(hostBuild), esbuild.build(webviewBuild)]);
  console.log('[justcode] build complete.');
}
