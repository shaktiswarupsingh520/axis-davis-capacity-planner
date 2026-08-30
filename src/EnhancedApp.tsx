import { useEffect } from 'react';
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
import { installInteractiveCapacityAiV47 } from './interactiveCapacityAiV47';
import { installSimulationMemoryFixV50 } from './simulationMemoryFixV50';
import { installOverviewRiskCardsV51 } from './overviewRiskCardsV51';
import { installDynatraceAlertDumpV54 } from './dynatraceAlertDumpV54';
import { installRcaWorkbenchV60 } from './rcaWorkbenchV60';
import { installRcaAssistPayloadGuardV60 } from './rcaAssistPayloadGuardV60';
import { installRcaButtonRecoveryV62 } from './rcaButtonRecoveryV62';
import { installRcaButtonRecoveryV63 } from './rcaButtonRecoveryV63';
import './interactiveCapacityAiV47.css';

function installRcaSidebarButton() {
  const sync = () => {
    const nav = document.querySelector<HTMLElement>('aside.sidebar nav');
    const alertButton = nav?.querySelector<HTMLElement>('[data-alert-dump-v54]');
    if (!nav || !alertButton || nav.querySelector('[data-rca-sidebar-v60]')) return;

    const button = document.createElement('button');
    button.className = 'nav-item axis-usecase-btn';
    button.setAttribute('data-rca-sidebar-v60', 'true');
    button.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:5px;background:#8b5cf6;color:#fff;font-size:11px;font-weight:800">R</span><span>RCA analysis with Davis</span>';
    alertButton.insertAdjacentElement('afterend', button);
  };

  sync();
  const timer = window.setInterval(sync, 500);
  window.setTimeout(() => window.clearInterval(timer), 10000);
}

export default function EnhancedApp() {
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
    installInteractiveCapacityAiV47();
    installSimulationMemoryFixV50();
    installOverviewRiskCardsV51();
    installDynatraceAlertDumpV54();
    installRcaSidebarButton();
    installRcaAssistPayloadGuardV60();
    installRcaWorkbenchV60();
    installRcaButtonRecoveryV62();
    installRcaButtonRecoveryV63();
  }, []);
  return <RealAppV2 />;
}
