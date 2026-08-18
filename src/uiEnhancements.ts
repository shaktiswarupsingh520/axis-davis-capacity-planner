type SnapshotMetric = { label: string; value: number };

const numberFrom = (value: string) => {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

function setChartLabels() {
  const panel = document.querySelector<HTMLElement>('.chart-panel');
  if (!panel) return;
  const title = panel.querySelector('h2')?.textContent?.trim() ?? '';
  const row = panel.querySelector('.chart-title-row');
  if (!row) return;
  let label = 'Metric';
  let unit = 'value';
  if (/throughput/i.test(title)) { label = 'Application throughput'; unit = 'req/min'; }
  else if (/cpu/i.test(title)) { label = 'CPU utilization'; unit = '%'; }
  else if (/memory/i.test(title)) { label = 'Memory utilization'; unit = '%'; }
  else if (/disk/i.test(title)) { label = 'Disk utilization'; unit = '%'; }
  else if (/network rx/i.test(title)) { label = 'Network receive rate'; unit = 'bytes/s'; }
  else if (/network tx/i.test(title)) { label = 'Network transmit rate'; unit = 'bytes/s'; }
  const strong = row.querySelector('strong');
  const span = row.querySelector('span');
  if (strong) strong.textContent = `${label} (${unit})`;
  if (span) span.textContent = `Unit: ${unit} · X-axis: Selected time window`;
}

function addSimulationChart() {
  const panel = document.querySelector<HTMLElement>('.simulation-enhanced');
  if (!panel) return;
  const cards = [...panel.querySelectorAll<HTMLElement>('.metric-card')].slice(0, 3);
  const values: SnapshotMetric[] = cards.map((card) => ({
    label: card.querySelector('span')?.textContent?.trim() ?? 'Traffic',
    value: numberFrom(card.querySelector('strong')?.textContent ?? card.textContent ?? '0'),
  }));
  const current = values.find((item) => /current/i.test(item.label))?.value ?? 0;
  const simulated = values.find((item) => /simulated/i.test(item.label))?.value ?? 0;
  const signature = `${current}|${simulated}`;
  let chart = panel.querySelector<HTMLElement>('.simulation-scenario-chart');
  if (chart?.dataset.signature === signature) return;
  chart?.remove();
  const max = Math.max(1, current, simulated);
  const top = 40;
  const bottom = 220;
  const left = 76;
  const right = 780;
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const startY = y(current);
  const endY = y(simulated);
  chart = document.createElement('section');
  chart.className = 'simulation-scenario-chart chart-wrap labeled-chart';
  chart.dataset.signature = signature;
  chart.innerHTML = `
    <div class="chart-title-row"><strong>Traffic simulation trajectory</strong><span>Unit: req/min · X-axis: Simulation horizon</span></div>
    <svg viewBox="0 0 860 300" role="img" aria-label="Current traffic compared with simulated traffic">
      <line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" class="chart-grid"/>
      <line x1="${left}" x2="${right}" y1="${(top + bottom) / 2}" y2="${(top + bottom) / 2}" class="chart-grid"/>
      <line x1="${left}" x2="${right}" y1="${top}" y2="${top}" class="chart-grid"/>
      <text x="35" y="${bottom + 4}" class="chart-axis-label">0</text>
      <text x="18" y="${(top + bottom) / 2 + 4}" class="chart-axis-label">${Math.round(max / 2)}</text>
      <text x="10" y="${top + 4}" class="chart-axis-label">${Math.round(max)}</text>
      <polyline points="${left},${startY} ${right},${startY}" class="scenario-line actual"/>
      <polyline points="${left},${startY} ${left + 176},${startY + (endY - startY) * .25} ${left + 352},${startY + (endY - startY) * .5} ${left + 528},${startY + (endY - startY) * .75} ${right},${endY}" class="scenario-line forecast"/>
      <circle cx="${left}" cy="${startY}" r="5" class="scenario-dot actual"/>
      <circle cx="${right}" cy="${endY}" r="6" class="scenario-dot forecast"/>
      <text x="${left - 8}" y="252" class="chart-axis-label">Now</text>
      <text x="${left + 310}" y="252" class="chart-axis-label">Mid-scenario</text>
      <text x="${right - 40}" y="252" class="chart-axis-label">Horizon</text>
      <text x="370" y="280" class="chart-axis-title">Simulation horizon</text>
      <text x="${left + 8}" y="${startY - 10}" class="scenario-start-label">${current.toFixed(1)} req/min</text>
      <text x="${right - 86}" y="${endY - 10}" class="scenario-end-label">${simulated.toFixed(1)} req/min</text>
    </svg>
    <div class="chart-legend"><span><i class="legend-dot actual-dot"/>Current traffic baseline</span><span><i class="legend-dot forecast-dot"/>Simulated traffic</span></div>
    <div class="chart-insights"><div><small>Current baseline</small><strong>${current.toFixed(1)} req/min</strong></div><div><small>Simulated endpoint</small><strong>${simulated.toFixed(1)} req/min</strong></div><div><small>Traffic delta</small><strong>+${Math.max(0, simulated - current).toFixed(1)} req/min</strong></div><div><small>Scenario assumption</small><strong>Linear ramp</strong></div></div>`;
  panel.querySelector('.simulation-result')?.after(chart) ?? panel.appendChild(chart);
}

function enhanceForecastSummary() {
  const panel = document.querySelector<HTMLElement>('.forecast-panel');
  if (!panel) return;
  const chart = panel.querySelector('.chart-wrap');
  if (!chart) return;
  let section = panel.querySelector<HTMLElement>('.forecast-interpretation');
  if (!section) {
    section = document.createElement('section');
    section.className = 'forecast-interpretation';
    panel.appendChild(section);
  }
  const hasForecast = Boolean(panel.querySelector('.chart-line.forecast'));
  const hasBand = Boolean(panel.querySelector('.forecast-band'));
  section.innerHTML = `<div class="forecast-interpretation-title">How to read this forecast</div><div class="forecast-interpretation-grid"><div><small>Forecast status</small><strong>${hasForecast ? 'Dynatrace forecast plotted' : 'No usable forecast points'}</strong></div><div><small>Prediction interval</small><strong>${hasBand ? '90%' : 'Unavailable'}</strong></div></div><p>${hasForecast ? 'Blue = observed telemetry. Orange = Dynatrace Intelligence forecast. Gold = 90% prediction interval. Red = capacity threshold.' : 'Dynatrace Intelligence did not return usable forecast points for this run. No trend is fabricated.'}</p>`;
}

export function installUiEnhancements() {
  const state = window as Window & { __axisEnhancementsInstalled?: boolean };
  if (state.__axisEnhancementsInstalled) return;
  state.__axisEnhancementsInstalled = true;
  const refresh = () => {
    setChartLabels();
    const active = document.querySelector('.nav-item.active')?.textContent?.trim() ?? '';
    if (active.includes('Simulation')) addSimulationChart();
    if (active.includes('Capacity Forecast')) enhanceForecastSummary();
  };
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('.nav-item') : null;
    if (!target) return;
    window.setTimeout(refresh, 120);
  }, false);
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && targetInSimulation(event.target)) window.setTimeout(addSimulationChart, 50);
  }, false);
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && targetInSimulation(event.target)) window.setTimeout(addSimulationChart, 50);
  }, false);
  window.setTimeout(refresh, 500);
}

function targetInSimulation(target: Element) {
  return Boolean(target.closest('.simulation-enhanced'));
}
