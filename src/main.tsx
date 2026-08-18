import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import EnhancedApp from './EnhancedApp';
import { installPdfReportOverride } from './reportOverride';
import { installChartUxFixes } from './chartUxFixes';
import './index.css';
import './realApp.css';
import './enhanced.css';
import './branding.css';

installPdfReportOverride();
installChartUxFixes();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EnhancedApp />
  </StrictMode>
);
