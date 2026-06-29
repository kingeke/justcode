import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { APP_NAME } from '@core/branding';
import { App } from '@ext/webview/App';
import { SettingsApp } from '@ext/webview/SettingsApp';
import '@ext/webview/webview.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error(`${APP_NAME} webview: #root element is missing.`);
}

// The same bundle backs two webviews — the sidebar chat and the Settings editor
// tab. The host injects `JUSTCODE_VIEW` into the HTML shell to pick which one
// renders, so neither surface needs its own bundle.
const view = (window as unknown as { JUSTCODE_VIEW?: string }).JUSTCODE_VIEW;

createRoot(container).render(
  <React.StrictMode>
    {view === 'settings' ? <SettingsApp /> : <App />}
  </React.StrictMode>
);
