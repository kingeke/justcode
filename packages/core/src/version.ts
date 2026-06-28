import pkg from '../../../package.json';
import { APP_NAME } from '@core/branding';

export const APP_VERSION: string = pkg.version;

/** Returns `JustCode/<version>` for use in User-Agent and editor headers. */
export function appUserAgent(): string {
  return `${APP_NAME}/${APP_VERSION}`;
}
