/*
 * File Purpose: Application entry point and router bootstrap.
 * Key Mechanics: Mounts React root and top-level router so route-based screens and navigation state are active.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import './styles.css';

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const existing = document.querySelector<HTMLScriptElement>('script[data-coi-bootstrap="true"]');
  if (!existing) {
    const script = document.createElement('script');
    script.src = `${import.meta.env.BASE_URL}coi-serviceworker.js`;
    script.dataset.coiBootstrap = 'true';
    script.defer = true;
    document.head.appendChild(script);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
