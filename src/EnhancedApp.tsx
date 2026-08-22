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
import { installCapacityPresentationV46 } from './capacityPresentationV46';
import { installCapacityPresentationV47 } from './capacityPresentationV47';
import { installUseCaseWorkbenchV48 } from './useCaseWorkbenchV48';
import { installInteractiveCapacityAiV47 } from './interactiveCapacityAiV47';
import { installProductionPdfInteractiveV49 } from './productionPdfInteractiveV49';
import './interactiveCapacityAiV47.css';

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
    installCapacityPresentationV46();
    installCapacityPresentationV47();
    installUseCaseWorkbenchV48();
    installInteractiveCapacityAiV47();
    installProductionPdfInteractiveV49();
  }, []);
  return <RealAppV2 />;
}
