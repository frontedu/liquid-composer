import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppLayout } from './components/layout/AppLayout';
import { initPersistence } from './store/persistence';
import './styles/global.css';

// Load state from localStorage before mounting
initPersistence();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppLayout />
  </StrictMode>
);
