import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';
import { installForecastEnhancementV42 } from './forecastEnhancementV42';
import { installAiForecastEnhancementV42 } from './aiForecastEnhancementV42';

export default function EnhancedApp() {
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
    installForecastEnhancementV42();
    installAiForecastEnhancementV42();
  }, []);
  return <RealAppV2 />;
}
