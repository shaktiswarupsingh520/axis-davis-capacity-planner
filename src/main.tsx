import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EnhancedApp from './EnhancedApp';
import { installPdfReportOverride } from './reportOverride';
import './index.css';
import './realApp.css';
import './enhanced.css';
import './branding.css';

installPdfReportOverride();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnhancedApp />
  </StrictMode>
);
