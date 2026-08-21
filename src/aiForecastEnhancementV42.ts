import { dynatraceDataProvider } from './realDynatrace';
import { generateAssistCapacitySummary } from './dynatraceIntelligence';
import { runDynatraceForecast } from './dynatraceIntelligence';
import type { ForecastHorizon, MetricKey, TimeRange } from '@/types';

const stateKey = '__aiForecastV42' as const;

export function installAiForecastEnhancementV42() {
  const state = window as Window & { [stateKey]?: boolean };
  if (state[stateKey]) return;
  state[stateKey] = true;

  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button.ai-button') : null;
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (button.disabled) return;
    button.disabled = true;
    const original = button.innerHTML;
    button.textContent = 'Analyzing scope forecast…';
    try {
      const selects = [...document.querySelectorAll<HTMLSelectElement>('.mz-selector select')];
      const zone = selects[0]?.value || 'All Management Zones';
      const timeRange = (selects[1]?.value || '24h') as TimeRange;
      const horizon = Number(selects[2]?.value || 30) as ForecastHorizon;
      const hosts = await dynatraceDataProvider.getHosts(zone, timeRange);
      const metric: MetricKey = 'cpu';
      const aggregate = await runDynatraceForecast(hosts, metric, horizon);
      const forecasts = hosts.length && hosts[0]
        ? [{ host: hosts[0], forecast: aggregate }]
        : [];
      const summary = await generateAssistCapacitySummary(hosts, zone, forecasts);
      const panel = document.querySelector<HTMLElement>('.ai-panel');
      if (panel) {
        const old = panel.querySelector('.ai-summary');
        const next = document.createElement('div');
        next.className = 'ai-summary';
        next.innerHTML = `<pre>${escapeHtml(summary.text)}</pre><small>Generated ${new Date(summary.generatedAt).toLocaleString()} · ${summary.source}. Scope forecast: ${aggregate.forecast.length ? 'available' : 'unavailable'} · ${hosts.length} hosts in scope.</small>`;
        old?.replaceWith(next);
        if (!old) panel.querySelector('.ai-empty')?.replaceWith(next);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const panel = document.querySelector<HTMLElement>('.ai-panel');
      if (panel) {
        panel.querySelector('.ai-empty')?.replaceWith(Object.assign(document.createElement('div'), { className: 'ai-summary', innerHTML: `<pre>Executive Summary\nScope analysis failed: ${escapeHtml(message)}</pre>` }));
      }
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }, true);
}

function escapeHtml(value: string) { return value.replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char] ?? char)); }
