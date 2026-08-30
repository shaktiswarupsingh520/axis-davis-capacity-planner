import { useEffect } from 'react';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';
import { installAiForecastEnhancementV42 } from './aiForecastEnhancementV42';
import { installManagementZoneSearchV43 } from './managementZoneSearchV43';
import { installHostHoverFixV45 } from './hostHoverFixV45';
import { installForecastHoverV45 } from './forecastHoverV45';
import { installCapacityPresentationV46 } from './capacityPresentationV46';
import { installCapacityPresentationV47 } from './capacityPresentationV47';
import { installUseCaseWorkbenchV48 } from './useCaseWorkbenchV48';
import { installInteractiveCapacityAiV47 } from './interactiveCapacityAiV47';
import { installSimulationMemoryFixV50 } from './simulationMemoryFixV50';
import { installOverviewRiskCardsV51 } from './overviewRiskCardsV51';
import { installDynatraceAlertDumpV54 } from './dynatraceAlertDumpV54';
import { installRcaWorkbenchV60 } from './rcaWorkbenchV60';
import { installRcaAssistPayloadGuardV60 } from './rcaAssistPayloadGuardV60';
import { installRcaButtonRecoveryV62 } from './rcaButtonRecoveryV62';
import { installRcaButtonRecoveryV63 } from './rcaButtonRecoveryV63';
import './interactiveCapacityAiV47.css';

// Application-service throughput verification is disabled for the current release.
// This guard prevents the legacy Overview span query from executing while keeping
// the rest of the application query path unchanged. The feature can be restored
// later with a DPS-efficient metric-based implementation.
const originalQueryExecute = queryExecutionClient.queryExecute.bind(queryExecutionClient);
let throughputQueryGuardInstalled = false;

function installThroughputQueryGuard() {
  if (throughputQueryGuardInstalled) return;
  throughputQueryGuardInstalled = true;
  queryExecutionClient.queryExecute = async (request) => {
    const query = String(request?.body?.query ?? '');
    if (query.includes('fetch spans') && query.includes('request.is_root_span')) {
      return {
        state: 'SUCCEEDED',
        result: { records: [] },
      } as unknown as Awaited<ReturnType<typeof originalQueryExecute>>;
    }
    return originalQueryExecute(request);
  };
}

function hideDisabledThroughputPanel() {
  if (document.getElementById('capacity-throughput-disabled-style')) return;
  const style = document.createElement('style');
  style.id = 'capacity-throughput-disabled-style';
  style.textContent = '.overview-grid .status-panel{display:none!important}.overview-grid{grid-template-columns:1fr!important}';
  document.head.appendChild(style);
}

export default function EnhancedApp() {
  installThroughputQueryGuard();
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
    installAiForecastEnhancementV42();
    installManagementZoneSearchV43();
    installHostHoverFixV45();
    installForecastHoverV45();
    installCapacityPresentationV46();
    installCapacityPresentationV47();
    installUseCaseWorkbenchV48();
    installInteractiveCapacityAiV47();
    installSimulationMemoryFixV50();
    installOverviewRiskCardsV51();
    installDynatraceAlertDumpV54();
    installRcaAssistPayloadGuardV60();
    installRcaWorkbenchV60();
    installRcaButtonRecoveryV62();
    installRcaButtonRecoveryV63();
    hideDisabledThroughputPanel();
  }, []);
  return <RealAppV2 />;
}
