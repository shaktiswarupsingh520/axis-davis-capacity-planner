type SnapshotMetric = { label: string; value: number };

const numericFromText = (value: string) => {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
};

function addEl(parent: Element, className: string, html: string) {
  const existing = parent.querySelector(`.${className}`);
  if (existing) return existing;
  const node = document.createElement('section');
  node.className = className;
  node.innerHTML = html;
  parent.appendChild(node);
  return node;
}

function enhanceSimulation() {
  const panel = document.querySelector('.simulation-enhanced');
  if (!panel) return;
  const cards = [...panel.querySelectorAll<HTMLElement>('.metric-card')];
  const values: SnapshotMetric[] = cards.slice(0, 3).map((card) => ({ label: card.querySelector('span')?.textContent?.trim() || 'Traffic', value: numericFromText(card.querySelector('strong')?.textContent || card.textContent || '0') }));
  const current = values.find((item) => item.label.toLowerCase().includes('current'))?.value ?? 0;
  const simulated = values.find((item) => item.label.toLowerCase().includes('simulated'))?.value ?? 0;
  const existing = panel.querySelector('.simulation-scenario-chart');
  if (existing) {
    const svg = existing.querySelector('svg');
    const currentText = existing.querySelector('.scenario-current');
    const simulatedText = existing.querySelector('.scenario-simulated');
    if (svg && currentText && simulatedText) { currentText.textContent = `${current.toFixed(1)} req/min`; simulatedText.textContent = `${simulated.toFixed(1)} req/min`; }
    return;
  }
  const max = Math.max(1, current, simulated);
  const currentY = 150 - (current / max) * 110;
  const simulatedY = 150 - (simulated / max) * 110;
  const chart = document.createElement('section');
  chart.className = 'simulation-scenario-chart chart-wrap';
  chart.innerHTML = `<div class="chart-title-row"><strong>Traffic scenario projection</strong><span>Unit: req/min · X-axis: Simulation horizon</span></div><svg viewBox="0 0 820 250" role="img" aria-label="Current traffic compared with simulated traffic"><line x1="76" x2="780" y1="150" y2="150" class="chart-grid"/><line x1="76" x2="780" y1="95" y2="95" class="chart-grid"/><line x1="76" x2="780" y1="40" y2="40" class="chart-grid"/><polyline points="76,${currentY} 252,${currentY} 428,${currentY} 604,${currentY} 780,${currentY}" class="scenario-line actual"/><polyline points="76,${currentY} 252,${currentY + (simulatedY-currentY)*.25} 428,${currentY + (simulatedY-currentY)*.5} 604,${currentY + (simulatedY-currentY)*.75} 780,${simulatedY}" class="scenario-line forecast"/><circle cx="780" cy="${currentY}" r="4" class="scenario-dot actual"/><circle cx="780" cy="${simulatedY}" r="4" class="scenario-dot forecast"/><text x="62" y="154" class="chart-axis-label">0</text><text x="32" y="99" class="chart-axis-label">${Math.round(max*.5)}</text><text x="32" y="44" class="chart-axis-label">${Math.round(max)}</text><text x="70" y="214" class="chart-axis-label">Now</text><text x="365" y="214" class="chart-axis-label">Mid-scenario</text><text x="736" y="214" class="chart-axis-label">Horizon</text><text x="345" y="238" class="chart-axis-title">Simulation horizon</text></svg><div class="chart-legend"><span><i class="legend-dot actual-dot"/>Current traffic</span><span><i class="legend-dot forecast-dot"/>Simulated traffic</span></div><div class="chart-insights"><div><small>Current baseline</small><strong class="scenario-current">${current.toFixed(1)} req/min</strong></div><div><small>Simulated endpoint</small><strong class="scenario-simulated">${simulated.toFixed(1)} req/min</strong></div><div><small>Scenario assumption</small><strong>Linear traffic ramp</strong></div></div>`;
  panel.appendChild(chart);
}

function enhanceForecast() {
  const panel = document.querySelector('.forecast-panel');
  if (!panel) return;
  const chart = panel.querySelector('.chart-wrap');
  if (!chart) return;
  const existing = panel.querySelector('.forecast-interpretation');
  const insights = [...chart.querySelectorAll<HTMLElement>('.chart-insights > div')].map((node) => ({ label: node.querySelector('small')?.textContent?.trim() || '', value: node.querySelector('strong')?.textContent?.trim() || '' }));
  const successful = panel.querySelector('.chart-line.forecast');
  const hasForecast = Boolean(successful);
  const target = addEl(panel, 'forecast-interpretation', `<div class="forecast-interpretation-title">How to read this forecast</div><div class="forecast-interpretation-grid"><div><small>Forecast status</small><strong>${hasForecast ? 'Forecast plotted' : 'No usable forecast points'}</strong></div>${insights.map((item) => `<div><small>${item.label}</small><strong>${item.value}</strong></div>`).join('')}</div><p>${hasForecast ? 'Orange = Dynatrace forecast. Gold band = 90% prediction interval. Red line = 80% capacity threshold. Use the peak and the prediction band together when deciding whether capacity action is required.' : 'Dynatrace Intelligence returned no usable forecast line for this run. The application intentionally does not fabricate a trend.'}</p>`);
  if (existing) existing.innerHTML = `<div class="forecast-interpretation-title">How to read this forecast</div><div class="forecast-interpretation-grid"><div><small>Forecast status</small><strong>${hasForecast ? 'Forecast plotted' : 'No usable forecast points'}</strong></div>${insights.map((item) => `<div><small>${item.label}</small><strong>${item.value}</strong></div>`).join('')}</div><p>${hasForecast ? 'Orange = Dynatrace forecast. Gold band = 90% prediction interval. Red line = 80% capacity threshold. Use the peak and the prediction band together when deciding whether capacity action is required.' : 'Dynatrace Intelligence returned no usable forecast line for this run. The application intentionally does not fabricate a trend.'}</p>`;
}

export function installUiEnhancements() {
  if ((window as Window & { __axisEnhancementsInstalled?: boolean }).__axisEnhancementsInstalled) return;
  (window as Window & { __axisEnhancementsInstalled?: boolean }).__axisEnhancementsInstalled = true;
  const refresh = () => { const active = document.querySelector('.nav-item.active')?.textContent?.trim() || ''; if (active.includes('Simulation')) enhanceSimulation(); if (active.includes('Capacity Forecast')) enhanceForecast(); };
  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  window.setInterval(refresh, 600);
  window.setTimeout(refresh, 800);
}
