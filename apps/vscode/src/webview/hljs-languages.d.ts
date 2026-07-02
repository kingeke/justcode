// highlight.js ships type declarations for its core entry point but not for
// the per-language modules under lib/languages/, so each import in
// highlight.ts fails typecheck without this wildcard declaration.
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js';
  const language: LanguageFn;
  export default language;
}
