/**
 * The product name, in one place. Import {@link APP_NAME} everywhere the brand
 * is shown to the user (UI labels, headers, prompts) so a rename is a one-line
 * change here rather than a hunt across the codebase.
 *
 * Kept dependency-free so it is safe to bundle into any surface, including the
 * VSCode webview, without dragging in `node:` modules.
 */
export const APP_NAME = 'JustCode';
export const APP_NAME_LOWERED = APP_NAME.toLowerCase();
