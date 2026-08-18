import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiEnhancements } from './uiEnhancements';
import { installPdfReportOverride } from './reportOverride';

export default function EnhancedApp() {
  useEffect(() => {
    installUiEnhancements();
    installPdfReportOverride();
  }, []);
  return <RealAppV2 />;
}
