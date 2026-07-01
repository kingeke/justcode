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

/**
 * Canonical GitHub repository URL, in one place. Import these wherever the repo
 * or issue tracker is referenced (UI links, request-attribution headers) so a
 * move/rename is a one-line change here.
 */
export const APP_REPO_URL = 'https://github.com/kingeke/justcode';
export const APP_ISSUES_URL = `${APP_REPO_URL}/issues`;

/**
 * The public marketing site. Used for request-attribution headers (e.g.
 * OpenRouter's `HTTP-Referer`, which renders this domain's favicon as the app
 * icon) so traffic is credited to JustCode rather than the code host.
 */
export const APP_SITE_URL = 'https://justcodeapp.dev';
