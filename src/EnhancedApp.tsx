import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiFixesV3 } from './uiFixesV3';
import { installProductionPdfV3 } from './productionPdfV3';

export default function EnhancedApp() {
  useEffect(() => {
    installUiFixesV3();
    installProductionPdfV3();
  }, []);
  return <RealAppV2 />;
}
