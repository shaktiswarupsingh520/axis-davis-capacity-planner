import { dynatraceDataProvider } from './realDynatrace';
import { runDynatraceForecast, type DynatraceForecast } from './dynatraceIntelligence';
import type { ForecastHorizon, Host, MetricKey, TimeRange } from '@/types';

const SHELL_ID = 'capacity-forecast-v42-shell';
const ALL = '__ALL_HOSTS__';

type ForecastRecord = { host: Host; forecast: DynatraceForecast };

const esc = (value: string) => value.replace(/[&<>\"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[char] ?? char));
const num = (value: number | undefined | null) => Number.isFinite(value) ? Number(value) : 0;
const avg = (hosts: Host[], key: 'cpu' | 'memory' | 'disk') => hosts.length ? hosts.reduce((sum, host) => sum + num(host.telemetry.at(-1)?.[key]), 0) / hosts.length : 0;

function chartSvg(forecast: DynatraceForecast, metric: MetricKey, title: string) {
  const history = forecast.historical.filter(Number.isFinite);
  const future = forecast.forecast.filter(Number.isFinite);
  if (!history.length && !future.length) return '<div class="forecast-v42-empty">No forecast points returned for this selection.</div>';
  const lower = forecast.lowerBound.filter(Number.isFinite);
  const upper = forecast.upperBound.filter(Number.isFinite);
  const width = 920, height = 360, left = 70, right = 25, top = 32, bottom = 64;
  const plotW = width - left - right, plotH = height - top - bottom;
  const values = [...history, ...future, ...lower, ...upper];
  const isPct = metric !== 'cpu' || true;
  const rawMax = Math.max(100, ...values, 1);
  const max = isPct ? Math.max(100, rawMax) : rawMax;
  const min = 0;
  const splitIndex = history.length > 1 && future.length ? history.length - 1 : history.length;
  const total = Math.max(2, history.length + future.length);
  const x = (index: number) => left + (index / Math.max(1, total - 1)) * plotW;
  const y = (value: number) => top + (1 - (value - min) / Math.max(1, max - min)) * plotH;
  const points = (series: number[], offset: number) => series.map((value, index) => `${x(index + offset).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const grid = [0, 25, 50, 75, 100].filter((tick) => tick <= max).map((tick) => `<line x1="${left}" x2="${width-right}" y1="${y(tick)}" y2="${y(tick)}" class="forecast-v42-grid"/><text x="12" y="${y(tick)+4}" class="forecast-v42-label">${tick}%</text>`).join('');
  const band = lower.length > 1 && upper.length === lower.length ? `<polygon points="${upper.map((value, i) => `${x(i + splitIndex)},${y(value)}`).concat([...lower].reverse().map((value, i) => `${x(splitIndex + lower.length - 1 - i)},${y(value)}`)).join(' ')}" class="forecast-v42-band"/>` : '';
  const histPoints = history.length > 1 ? `<polyline points="${points(history,0)}" class="forecast-v42-historical"/>` : '';
  const forecastPoints = future.length > 1 ? `<polyline points="${points(future,splitIndex)}" class="forecast-v42-forecast"/>` : '';
  const splitX = future.length ? x(splitIndex) : x(Math.max(0, history.length - 1));
  const current = history.at(-1) ?? 0;
  const peak = future.length ? Math.max(...future) : current;
  const end = future.at(-1) ?? current;
  return `<div class="forecast-v42-chart-title"><div><strong>${esc(title)}</strong><span>${esc(metric.toUpperCase())} · ${forecast.scopeHostCount ?? 1} host(s) · ${esc(forecast.status)}</span></div><div class="forecast-v42-chart-facts"><span>Current <b>${current.toFixed(1)}%</b></span><span>Peak <b>${peak.toFixed(1)}%</b></span><span>End <b>${end.toFixed(1)}%</b></span></div></div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)} forecast chart">${grid}${band}${histPoints}${forecastPoints}<line x1="${splitX}" x2="${splitX}" y1="${top}" y2="${height-bottom}" class="forecast-v42-split"/><line x1="${left}" x2="${width-right}" y1="${y(80)}" y2="${y(80)}" class="forecast-v42-threshold"/><text x="${width-right-180}" y="${y(80)-8}" class="forecast-v42-threshold-label">80% capacity threshold</text><text x="${left}" y="${height-25}" class="forecast-v42-label">Historical</text><text x="${Math.min(width-130,splitX+10)}" y="${height-25}" class="forecast-v42-label">Forecast</text><text x="${width/2-45}" y="${height-5}" class="forecast-v42-axis-title">Time</text></svg><div class="forecast-v42-legend"><span><i class="hist-dot"></i>Historical</span><span><i class="forecast-dot"></i>Dynatrace Intelligence forecast</span>${band ? '<span><i class="band-dot"></i>95% prediction interval</span>' : ''}</div>`;
}

function applicationSummary(hosts: Host[], forecasts: Map<string, ForecastRecord>) {
  const groups = new Map<string, Host[]>();
  hosts.forEach((host) => { const key = host.application || 'Unclassified host group'; groups.set(key, [...(groups.get(key) ?? []), host]); });
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([application, appHosts]) => {
    const appForecasts = appHosts.map((host) => forecasts.get(host.id)).filter(Boolean) as ForecastRecord[];
    const successful = appForecasts.filter(({ forecast }) => forecast.source === 'Dynatrace Intelligence');
    const peak = successful.flatMap(({ forecast }) => forecast.forecast).filter(Number.isFinite);
    return `<tr><td><strong>${esc(application)}</strong></td><td>${appHosts.length}</td><td>${avg(appHosts,'cpu').toFixed(1)}%</td><td>${avg(appHosts,'memory').toFixed(1)}%</td><td>${avg(appHosts,'disk').toFixed(1)}%</td><td>${successful.length}/${appHosts.length}</td><td>${peak.length ? `${Math.max(...peak).toFixed(1)}%` : '—'}</td></tr>`;
  }).join('');
}

function hostRows(hosts: Host[], forecasts: Map<string, ForecastRecord>, selectedHost: string) {
  return hosts.map((host) => {
    const record = forecasts.get(host.id);
    const p = host.telemetry.at(-1);
    const peak = record?.forecast.forecast.length ? Math.max(...record.forecast.forecast) : null;
    const state = record?.forecast.source === 'Dynatrace Intelligence' ? 'Ready' : record?.forecast.error ? 'Retry' : 'Not loaded';
    return `<tr class="${host.id === selectedHost ? 'selected' : ''}" data-forecast-host="${esc(host.id)}"><td><strong>${esc(host.name)}</strong><small>${esc(host.application)}</small></td><td>${num(p?.cpu).toFixed(1)}%</td><td>${num(p?.memory).toFixed(1)}%</td><td>${num(p?.disk).toFixed(1)}%</td><td>${state}</td><td>${peak === null ? '—' : `${peak.toFixed(1)}%`}</td></tr>`;
  }).join('');
}

function injectStyles() {
  if (document.getElementById('forecast-v42-style')) return;
  const style = document.createElement('style');
  style.id = 'forecast-v42-style';
  style.textContent = `.forecast-v42-shell{margin-top:18px;display:grid;gap:16px}.forecast-v42-toolbar{display:flex;justify-content:space-between;align-items:end;gap:16px;flex-wrap:wrap}.forecast-v42-toolbar label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:#607189}.forecast-v42-toolbar select{min-width:340px;padding:10px 12px;border:1px solid #d6e0eb;border-radius:8px;background:#fff;color:#18324f}.forecast-v42-status{font-size:11px;color:#61748c}.forecast-v42-panel{border:1px solid #dfe7f0;border-radius:14px;background:#fff;padding:18px}.forecast-v42-chart-title{display:flex;justify-content:space-between;gap:15px;align-items:start;margin-bottom:8px}.forecast-v42-chart-title strong{display:block;font-size:14px;color:#17365d}.forecast-v42-chart-title span{display:block;margin-top:4px;font-size:11px;color:#72829a}.forecast-v42-chart-facts{display:flex;gap:10px}.forecast-v42-chart-facts span{padding:8px 10px;background:#f7f9fc;border:1px solid #e5eaf1;border-radius:8px;font-size:10px;color:#607189}.forecast-v42-chart-facts b{color:#183c65}.forecast-v42-chart{overflow:auto}.forecast-v42-chart svg{width:100%;min-width:720px;height:auto}.forecast-v42-grid{stroke:#e4eaf1;stroke-width:1}.forecast-v42-label,.forecast-v42-axis-title{font:11px Arial,sans-serif;fill:#66778c}.forecast-v42-historical{fill:none;stroke:#2f78df;stroke-width:3}.forecast-v42-forecast{fill:none;stroke:#ef8c2f;stroke-width:3;stroke-dasharray:8 5}.forecast-v42-band{fill:#f4c35e;fill-opacity:.18}.forecast-v42-split{stroke:#9aaabd;stroke-dasharray:5 5}.forecast-v42-threshold{stroke:#d65c55;stroke-width:1.5;stroke-dasharray:5 4}.forecast-v42-threshold-label{font:10px Arial,sans-serif;fill:#a24a46}.forecast-v42-legend{display:flex;gap:16px;flex-wrap:wrap;margin-top:7px;font-size:10px;color:#66778c}.forecast-v42-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px}.forecast-v42-legend .hist-dot{background:#2f78df}.forecast-v42-legend .forecast-dot{background:#ef8c2f}.forecast-v42-legend .band-dot{background:#dba63d}.forecast-v42-empty{padding:50px;text-align:center;color:#6e7f94;border:1px dashed #d6e0eb;border-radius:10px}.forecast-v42-table{overflow:auto}.forecast-v42-table table{width:100%;border-collapse:collapse}.forecast-v42-table th,.forecast-v42-table td{padding:10px 8px;border-bottom:1px solid #edf1f5;text-align:left;font-size:11px}.forecast-v42-table th{color:#72829a;font-size:10px;text-transform:uppercase}.forecast-v42-table tr[data-forecast-host]{cursor:pointer}.forecast-v42-table tr.selected{background:#f0f6ff}.forecast-v42-table td small{display:block;color:#8190a4;margin-top:2px}.forecast-v42-subtitle{font-size:12px;color:#62738a;line-height:1.5}.dark .forecast-v42-panel,.dark .forecast-v42-toolbar select{background:#172235;border-color:#33465f;color:#e5edf8}.dark .forecast-v42-chart-title strong{color:#e5edf8}.dark .forecast-v42-chart-title span,.dark .forecast-v42-chart-facts span,.dark .forecast-v42-status,.dark .forecast-v42-subtitle,.dark .forecast-v42-label,.dark .forecast-v42-axis-title,.dark .forecast-v42-legend{color:#b9c7d8}.dark .forecast-v42-chart-facts span{background:#111827;border-color:#33465f}.dark .forecast-v42-table td,.dark .forecast-v42-table th{border-color:#33465f}.dark .forecast-v42-table tr.selected{background:#20334e}`;
  document.head.appendChild(style);
}

async function loadHostForecast(host: Host, metric: MetricKey, horizon: ForecastHorizon) { return { host, forecast: await runDynatraceForecast([host], metric, horizon) }; }

export function installForecastEnhancementV42() {
  injectStyles();
  const state = window as Window & { __forecastV42?: boolean };
  if (state.__forecastV42) return;
  state.__forecastV42 = true;
  let activePage = false;
  let refreshTimer = 0;
  let requestId = 0;
  let forecasts = new Map<string, ForecastRecord>();
  let hosts: Host[] = [];
  let aggregate: DynatraceForecast | null = null;
  let selectedHost = ALL;
  let metric: MetricKey = 'cpu';
  let horizon: ForecastHorizon = 30;

  const topSelects = () => [...document.querySelectorAll<HTMLSelectElement>('.mz-selector select')];
  const isForecastPage = () => [...document.querySelectorAll('.nav-item.active span')].some((node) => node.textContent?.trim() === 'Capacity Forecast');

  const hideOriginal = (hide: boolean) => {
    document.querySelectorAll<HTMLElement>('.forecast-panel, .forecast-panel + .table-panel').forEach((node) => { node.style.display = hide ? 'none' : ''; });
  };
  const shellHost = () => document.querySelector<HTMLElement>('.content');

  const getInputs = () => {
    const sels = topSelects();
    const zone = sels[0]?.value || 'All Management Zones';
    const timeRange = (sels[1]?.value || '24h') as TimeRange;
    const horizonValue = Number(sels[2]?.value || 30) as ForecastHorizon;
    const metricSelect = document.querySelector<HTMLSelectElement>('.content .page-title .filter-row select');
    const metricValue = (metricSelect?.value || 'cpu') as MetricKey;
    return { zone, timeRange, horizon: horizonValue, metric: metricValue };
  };

  const render = (loading = false, error = '') => {
    const content = shellHost();
    if (!content || !activePage) return;
    let shell = document.getElementById(SHELL_ID) as HTMLElement | null;
    if (!shell) { shell = document.createElement('div'); shell.id = SHELL_ID; content.appendChild(shell); }
    hideOriginal(true);
    const ready = [...forecasts.values()].filter((x) => x.forecast.source === 'Dynatrace Intelligence').length;
    const selectedForecast = selectedHost === ALL ? aggregate : forecasts.get(selectedHost)?.forecast ?? null;
    const title = selectedHost === ALL ? `Scope average — ${hosts.length} hosts` : hosts.find((h) => h.id === selectedHost)?.name ?? 'Selected host';
    const applicationRows = applicationSummary(hosts, forecasts);
    shell.innerHTML = `<section class="forecast-v42-shell"><div class="forecast-v42-panel"><div class="forecast-v42-toolbar"><label>Forecast selection<select id="forecast-v42-host"><option value="${ALL}" ${selectedHost===ALL?'selected':''}>All hosts — scope average (${hosts.length})</option>${hosts.map((host) => `<option value="${esc(host.id)}" ${host.id===selectedHost?'selected':''}>${esc(host.name)} · ${esc(host.application)}</option>`).join('')}</select></label><div class="forecast-v42-status">${loading ? 'Loading Dynatrace Intelligence forecast…' : `${ready}/${hosts.length} host forecasts loaded`} · Scope forecast: ${aggregate?.forecast.length ? 'available' : 'unavailable'}</div></div><p class="forecast-v42-subtitle">The main view is the average utilization trend for the entire selected Management Zone. Choose a host to switch to its individual forecast. Individual forecasts are loaded on demand so large zones do not overwhelm the analyzer.</p>${error ? `<div class="notice">${esc(error)}</div>` : ''}<div class="forecast-v42-chart">${selectedForecast ? chartSvg(selectedForecast, metric, title) : '<div class="forecast-v42-empty">No forecast returned for this selection.</div>'}</div></div><div class="forecast-v42-panel"><div class="panel-heading"><div><span class="eyebrow">Application view</span><h2>Applications in selected scope</h2></div><span class="forecast-v42-status">Host count and average live utilization; forecast completion updates as hosts are loaded.</span></div><div class="forecast-v42-table"><table><thead><tr><th>Application / host group</th><th>Hosts</th><th>Avg CPU</th><th>Avg Memory</th><th>Avg Disk</th><th>Forecasts</th><th>Highest forecast</th></tr></thead><tbody>${applicationRows || '<tr><td colspan="7">No applications in selected scope.</td></tr>'}</tbody></table></div></div><div class="forecast-v42-panel"><div class="panel-heading"><div><span class="eyebrow">Host forecast inventory</span><h2>Host-wise capacity forecast</h2></div><span class="forecast-v42-status">Click any host to load/view its forecast.</span></div><div class="forecast-v42-table"><table><thead><tr><th>Host</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Forecast status</th><th>Forecast peak</th></tr></thead><tbody>${hostRows(hosts, forecasts, selectedHost)}</tbody></table></div></div></section>`;
    const select = document.getElementById('forecast-v42-host') as HTMLSelectElement | null;
    select?.addEventListener('change', async () => {
      selectedHost = select.value;
      if (selectedHost === ALL) { render(false); return; }
      if (!forecasts.has(selectedHost)) {
        const id = ++requestId;
        render(true);
        const host = hosts.find((item) => item.id === selectedHost);
        if (host) {
          try { forecasts.set(host.id, await loadHostForecast(host, metric, horizon)); if (id !== requestId) return; }
          catch (e) { if (id !== requestId) return; render(false, e instanceof Error ? e.message : String(e)); return; }
        }
      }
      render(false);
    });
    shell.querySelectorAll<HTMLElement>('[data-forecast-host]').forEach((row) => row.addEventListener('click', () => {
      const id = row.dataset.forecastHost;
      if (id) { selectedHost = id; render(false); document.getElementById('forecast-v42-host')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    }));
  };

  const refresh = async () => {
    const nowForecast = isForecastPage();
    if (!nowForecast) { if (activePage) { activePage = false; hideOriginal(false); document.getElementById(SHELL_ID)?.remove(); } return; }
    activePage = true;
    const input = getInputs();
    metric = input.metric; horizon = input.horizon;
    const id = ++requestId;
    try {
      const freshHosts = await dynatraceDataProvider.getHosts(input.zone, input.timeRange);
      if (id !== requestId) return;
      hosts = freshHosts;
      forecasts = new Map();
      selectedHost = ALL;
      render(true);
      try { aggregate = await runDynatraceForecast(hosts, metric, horizon); } catch { aggregate = null; }
      if (id !== requestId) return;
      render(false);
    } catch (error) {
      aggregate = null;
      hosts = [];
      forecasts = new Map();
      render(false, error instanceof Error ? error.message : String(error));
    }
  };

  const schedule = () => { window.clearTimeout(refreshTimer); refreshTimer = window.setTimeout(() => void refresh(), 220); };
  document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('.nav-item')) schedule(); });
  document.addEventListener('change', (event) => { if (event.target instanceof HTMLSelectElement && (event.target.closest('.mz-selector') || event.target.closest('.content .filter-row'))) schedule(); });
  window.setInterval(() => { if (isForecastPage()) schedule(); }, 1800);
  window.setTimeout(schedule, 600);
}
