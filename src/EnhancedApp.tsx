import { useEffect } from 'react';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';
import { installAiForecastEnhancementV42 } from './aiForecastEnhancementV42';
import { installManagementZoneSearchV43 } from './managementZoneSearchV43';
import { installCapacityUxV44 } from './capacityUxV44';
import { installCapacityUxV45 } from './capacityUxV45';
import { installHostHoverFixV45 } from './hostHoverFixV45';
import { installForecastHoverV45 } from './forecastHoverV45';

export default function EnhancedApp() {
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
    installAiForecastEnhancementV42();
    installManagementZoneSearchV43();
    installCapacityUxV44();
    installCapacityUxV45();
    installHostHoverFixV45();
    installForecastHoverV45();
  }, []);
  return <RealAppV2 />;
}
