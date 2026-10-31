import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import { AppLayout } from './components/layout/AppLayout';
import { initPersistence } from './store/persistence';
import { $persistenceEnabled } from './store/uiStore';
import './styles/global.css';

const agentMode = new URLSearchParams(location.search).has('agent');
if (agentMode) {
  $persistenceEnabled.set(false);
} else {
  inject({ beforeSend: (event) => ({ ...event, url: event.url.split('#')[0] }) });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(console.error), { once: true });
  }
}
const restored = agentMode ? Promise.resolve() : initPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLayout />
  </StrictMode>
);

import('./agent/api').then(({ installAgentApi }) => installAgentApi(restored));
