import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiEnhancementsV2 } from './uiEnhancementsV2';
import { installProductionPdfV2 } from './productionPdfV2';

export default function EnhancedApp() {
  useEffect(() => {
    installUiEnhancementsV2();
    installProductionPdfV2();
  }, []);
  return <RealAppV2 />;
}
