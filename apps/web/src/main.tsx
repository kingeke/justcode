import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';
import './styles.css';

// The favicon is declared statically in index.html (public/favicon.svg) so it is
// discoverable by crawlers and favicon fetchers that don't execute JS.

const root = document.getElementById('root');
if (!root) {
  throw new Error('JustCode site: #root element is missing.');
}

createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
