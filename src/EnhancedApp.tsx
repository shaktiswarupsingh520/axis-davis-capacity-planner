import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';
import { installBrandingPatchV41 } from './brandingPatchV41';
import { installHoverMetricFixV42 } from './hoverMetricFixV42';
import { installAssistPayloadGuardV42 } from './assistPayloadGuardV42';
import SegmentScopeV42 from './segmentScopeV42';

export default function EnhancedApp() {
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
    installBrandingPatchV41();
    installHoverMetricFixV42();
    installAssistPayloadGuardV42();
  }, []);
  return <><RealAppV2 /><SegmentScopeV42 /></>;
}
