import { useEffect } from 'react';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import RealAppV2 from './RealAppV2';
import { installUiFixesV4 } from './uiFixesV4';
import { installSimulationProjectionV4 } from './simulationProjectionV4';
import { installProductionPdfV4 } from './productionPdfV4';

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
      } as Awaited<ReturnType<typeof originalQueryExecute>>;
    }
    return originalQueryExecute(request);
  };
}

export default function EnhancedApp() {
  installThroughputQueryGuard();
  useEffect(() => {
    installUiFixesV4();
    installSimulationProjectionV4();
    installProductionPdfV4();
  }, []);
  return <RealAppV2 />;
}
