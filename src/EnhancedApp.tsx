import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';
import { installForecastEnhancementV43 } from './forecastEnhancementV43';
import { installAiForecastEnhancementV42 } from './aiForecastEnhancementV42';
import { installManagementZoneSearchV43 } from './managementZoneSearchV43';
import { installOverviewRiskDrilldownV43 } from './overviewRiskDrilldownV43';

export default function EnhancedApp() {
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
    installForecastEnhancementV43();
    installAiForecastEnhancementV42();
    installManagementZoneSearchV43();
    installOverviewRiskDrilldownV43();
  }, []);
  return <RealAppV2 />;
}
