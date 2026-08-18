function parseReqPerMin(card: HTMLElement, label: string): number | undefined {
  const text = card.innerText.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const match = text.match(new RegExp(`${label}[^0-9]*([0-9]+(?:\\.[0-9]+)?)\\s*req/min`, 'i'));
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

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
  row.querySelector('strong')?.replaceChildren(document.createTextNode(`${label} (${unit})`));
  row.querySelector('span')?.replaceChildren(document.createTextNode(`Unit: ${unit} · X-axis: Selected time window`));
}

function addSimulationChart() {
  const panel = document.querySelector<HTMLElement>('.simulation-enhanced');
  if (!panel) return;
  const cards = [...panel.querySelectorAll<HTMLElement>('.metric-card')];
  if (cards.length < 2) return;

  const current = cards.map((card) => parseReqPerMin(card, 'Current traffic')).find((value) => value !== undefined);
  const simulated = cards.map((card) => parseReqPerMin(card, 'Simulated traffic')).find((value) => value !== undefined);
  if (current === undefined || simulated === undefined) return;

  const signature = `${current.toFixed(3)}|${simulated.toFixed(3)}`;
  let chart = panel.querySelector<HTMLElement>('.simulation-scenario-chart');
  if (chart?.dataset.signature === signature) return;
  chart?.remove();

  const max = Math.max(1, current, simulated);
  const top = 42;
  const bottom = 218;
  const left = 82;
  const right = 775;
  const y = (value: number) => bottom - (value / max) * (bottom - top);
  const startY = y(current);
  const endY = y(simulated);
  const quarter = (fraction: number) => startY + (endY - startY) * fraction;

  chart = document.createElement('section');
  chart.className = 'simulation-scenario-chart chart-wrap labeled-chart';
  chart.dataset.signature = signature;
  chart.innerHTML = `
    <div class="chart-title-row"><strong>Traffic simulation trajectory</strong><span>Unit: req/min · X-axis: Simulation horizon</span></div>
    <svg viewBox="0 0 860 300" role="img" aria-label="Current traffic compared with simulated traffic">
      <line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" class="chart-grid"/>
      <line x1="${left}" x2="${right}" y1="${(top + bottom) / 2}" y2="${(top + bottom) / 2}" class="chart-grid"/>
      <line x1="${left}" x2="${right}" y1="${top}" y2="${top}" class="chart-grid"/>
      <text x="38" y="${bottom + 4}" class="chart-axis-label">0</text>
      <text x="18" y="${(top + bottom) / 2 + 4}" class="chart-axis-label">${Math.round(max / 2)}</text>
      <text x="8" y="${top + 4}" class="chart-axis-label">${Math.round(max)}</text>
      <polyline points="${left},${startY} ${right},${startY}" class="scenario-line actual"/>
      <polyline points="${left},${startY} ${left + 173},${quarter(.25)} ${left + 346},${quarter(.5)} ${left + 519},${quarter(.75)} ${right},${endY}" class="scenario-line forecast"/>
      <circle cx="${left}" cy="${startY}" r="5" class="scenario-dot actual"/>
      <circle cx="${right}" cy="${endY}" r="6" class="scenario-dot forecast"/>
      <text x="${left - 6}" y="252" class="chart-axis-label">Now</text>
      <text x="${left + 300}" y="252" class="chart-axis-label">Mid-scenario</text>
      <text x="${right - 38}" y="252" class="chart-axis-label">Horizon</text>
      <text x="366" y="280" class="chart-axis-title">Simulation horizon</text>
      <text x="${left + 8}" y="${Math.max(28, startY - 10)}" class="scenario-start-label">${current.toFixed(1)} req/min</text>
      <text x="${right - 96}" y="${Math.max(28, endY - 10)}" class="scenario-end-label">${simulated.toFixed(1)} req/min</text>
    </svg>
    <div class="chart-legend"><span><i class="legend-dot actual-dot"/>Current traffic baseline</span><span><i class="legend-dot forecast-dot"/>Simulated traffic</span></div>
    <div class="chart-insights"><div><small>Current baseline</small><strong>${current.toFixed(1)} req/min</strong></div><div><small>Simulated endpoint</small><strong>${simulated.toFixed(1)} req/min</strong></div><div><small>Traffic delta</small><strong>+${Math.max(0, simulated - current).toFixed(1)} req/min</strong></div><div><small>Scenario assumption</small><strong>Linear ramp</strong></div></div>`;

  const kpis = panel.querySelector('.simulation-kpis');
  const result = panel.querySelector('.simulation-result');
  if (kpis) kpis.after(chart);
  else if (result) result.after(chart);
  else panel.appendChild(chart);
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
    if (target) window.setTimeout(refresh, 120);
  });
  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.closest('.simulation-enhanced')) window.setTimeout(addSimulationChart, 60);
  });
  document.addEventListener('change', (event) => {
    if (event.target instanceof HTMLInputElement && event.target.closest('.simulation-enhanced')) window.setTimeout(addSimulationChart, 60);
  });

  window.setTimeout(refresh, 500);
}
