import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import emblemUrl from './assets/emblem.svg';
import './styles.css';

// Set the favicon from the bundled emblem so its URL carries the Pages base.
const favicon = document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = emblemUrl;
document.head.appendChild(favicon);

const root = document.getElementById('root');
if (!root) {
  throw new Error('JustCode site: #root element is missing.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
