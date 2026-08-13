import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RealApp from './RealApp';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RealApp />
  </StrictMode>
);
