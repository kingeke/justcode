import pkg from '../../../package.json';

export const APP_VERSION: string = pkg.version;

/** Returns `JustCode/<version>` for use in User-Agent and editor headers. */
export function appUserAgent(): string {
  return `JustCode/${APP_VERSION}`;
}
