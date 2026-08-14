import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RealAppV2 from './RealAppV2';
import './index.css';
import './realApp.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RealAppV2 />
  </StrictMode>
);
