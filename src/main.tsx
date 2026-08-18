import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EnhancedApp from './EnhancedApp';
import './index.css';
import './realApp.css';
import './enhanced.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnhancedApp />
  </StrictMode>
);
