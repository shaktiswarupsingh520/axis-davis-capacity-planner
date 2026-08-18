import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EnhancedApp from './EnhancedApp';
import { installChartUxFixes } from './chartUxFixes';
import { installProductionPdf } from './productionPdf';
import './index.css';
import './realApp.css';
import './enhanced.css';
import './branding.css';

installChartUxFixes();
installProductionPdf();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnhancedApp />
  </StrictMode>
);
