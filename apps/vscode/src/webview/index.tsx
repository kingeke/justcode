import * as React from 'react';
import { createRoot } from 'react-dom/client';

import { APP_NAME } from '@core/branding';
import { App } from '@ext/webview/App';
import '@ext/webview/webview.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error(`${APP_NAME} webview: #root element is missing.`);
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
