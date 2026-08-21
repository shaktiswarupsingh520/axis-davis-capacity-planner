import { dynatraceDataProvider } from './realDynatrace';
import { runDynatraceForecast, type DynatraceForecast } from './dynatraceIntelligence';
import { getHostRisk } from './services/hostStatus';
import type { ForecastHorizon, Host, TimeRange } from '@/types';

type MultiForecast = { cpu: DynatraceForecast; memory: DynatraceForecast; disk: DynatraceForecast };
const PAGE_ID = 'capacity-forecast-v45-page';
const ALL = '__ALL__';
const win = window as Window & { __capacityUxV45?: boolean };
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function inputs() {
  const fields = [...document.querySelectorAll<HTMLSelectElement>('.top-actions .mz-selector select')];
  return {
    zone: fields[0]?.value || 'All Management Zones',
    range: (fields[1]?.value || '24h') as TimeRange,
    horizon: Number(fields[2]?.value || 30) as ForecastHorizon,
  };
}
function active() { return [...document.querySelectorAll('.nav-item.active span')].some(n => n.textContent?.trim() === 'Capacity Forecast'); }
function lastValues(hosts: Host[]) {
  const p = hosts.map(h => h.telemetry.at(-1));
  const avg = (key: 'cpu' | 'memory' | 'disk') => p.length ? p.reduce((s, x) => s + num(x?.[key]), 0) / p.length : 0;
  return { cpu: avg('cpu'), memory: avg('memory'), disk: avg('disk') };
}

function styles() {
  if (document.getElementById('capacity-v45-style')) return;
  const s = document.createElement('style');
  s.id = 'capacity-v45-style';
  s.textContent = `
  #${PAGE_ID}{display:grid;gap:14px;margin-top:16px}.v45-card{border:1px solid #dfe7f0;border-radius:14px;background:#fff;padding:18px}.v45-toolbar{display:grid;grid-template-columns:minmax(300px,1fr) auto;gap:12px;align-items:end}.v45-field{display:flex;flex-direction:column;gap:6px;font-size:11px;color:#66778c}.v45-field select{min-height:38px;border:1px solid #cad6e4;border-radius:8px;background:#fff;padding:8px 10px;color:#18324f}.v45-status{font-size:11px;color:#62738a;text-align:right;line-height:1.5}.v45-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}.v45-kpi{border:1px solid #e4eaf1;border-radius:10px;padding:12px;background:#f9fbfd}.v45-kpi small{display:block;color:#718096;font-size:9px}.v45-kpi strong{display:block;color:#17365d;font-size:18px;margin-top:4px}.v45-chart{margin-top:14px;border:1px solid #e3e9f1;border-radius:12px;padding:12px;position:relative}.v45-chart svg{display:block;width:100%;height:auto;min-height:420px;overflow:visible}.v45-grid{stroke:#e7edf3;stroke-width:1}.v45-threshold{stroke:#d45c55;stroke-width:1.4;stroke-dasharray:5 4}.v45-cpu{fill:none;stroke:#2f78df;stroke-width:3}.v45-memory{fill:none;stroke:#6b5bd4;stroke-width:3}.v45-disk{fill:none;stroke:#e58a2d;stroke-width:3}.v45-axis{font:11px Arial;fill:#66778c}.v45-title{font-size:14px;font-weight:800;color:#17365d}.v45-sub{font-size:11px;color:#687a90;margin-top:3px}.v45-legend{display:flex;gap:16px;flex-wrap:wrap;margin:8px 2px 0;font-size:11px;color:#66778c}.v45-dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.v45-dot.cpu{background:#2f78df}.v45-dot.memory{background:#6b5bd4}.v45-dot.disk{background:#e58a2d}.v45-table{overflow:auto}.v45-table table{width:100%;border-collapse:collapse}.v45-table th,.v45-table td{padding:9px 8px;border-bottom:1px solid #edf1f5;text-align:left;font-size:11px}.v45-table th{font-size:10px;color:#72829a;text-transform:uppercase}.v45-table tr{cursor:pointer}.v45-table tr:hover,.v45-table tr.v45-selected{background:#f1f6fd}.v45-badge{display:inline-block;padding:3px 7px;border-radius:999px;font-size:9px;font-weight:700}.v45-ready{background:#e8f7ef;color:#147a4b}.v45-retry{background:#fff0e9;color:#b54708}.v45-low{background:#eef2f7;color:#667085}.v45-loading{text-align:center;padding:30px;color:#66778c}.dark .v45-card,.dark .v45-kpi,.dark .v45-field select{background:#172235;border-color:#33465f;color:#e5edf8}.dark .v45-title,.dark .v45-kpi strong{color:#e5edf8}.dark .v45-sub,.dark .v45-status,.dark .v45-axis,.dark .v45-field,.dark .v45-legend,.dark .v45-table th{color:#b9c7d8}.dark .v45-grid{stroke:#33465f}.dark .v45-table td,.dark .v45-table th{border-color:#33465f}
  @media(max-width:900px){.v45-toolbar,.v45-kpis{grid-template-columns:1fr 1fr}.v45-status{text-align:left}}
  `;
  document.head.appendChild(s);
}

function hideOld() {
  document.querySelectorAll<HTMLElement>('.forecast-panel').forEach(n => n.style.display = 'none');
  document.getElementById('forecast-v44-page')?.remove();
  document.getElementById('capacity-forecast-v42-shell')?.remove();
}

function forecastOk(f: DynatraceForecast) { return f.source === 'Dynatrace Intelligence' && f.forecast.length > 1; }

function dateAt(startMs: number, index: number) {
  return new Date(startMs + index * 86400000).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function chart(hostLabel: string, forecasts: MultiForecast, horizon: ForecastHorizon) {
  const series = [
    { key: 'cpu' as const, label: 'CPU', colorClass: 'v45-cpu', f: forecasts.cpu },
    { key: 'memory' as const, label: 'Memory', colorClass: 'v45-memory', f: forecasts.memory },
    { key: 'disk' as const, label: 'Disk', colorClass: 'v45-disk', f: forecasts.disk },
  ];
  if (!series.some(s => forecastOk(s.f))) return '<div class="v45-loading">No usable Dynatrace Intelligence forecast was returned for this selection.</div>';
  const histLen = Math.max(...series.map(s => s.f.historical.filter(Number.isFinite).length), 0);
  const fcLen = Math.max(...series.map(s => s.f.forecast.filter(Number.isFinite).length), 0);
  const total = Math.max(2, histLen + fcLen);
  const width = 1120, height = 460, left = 62, right = 30, top = 38, bottom = 78;
  const plotW = width - left - right, plotH = height - top - bottom;
  const x = (i: number) => left + i * plotW / Math.max(1, total - 1);
  const y = (v: number) => top + (1 - Math.max(0, Math.min(100, v)) / 100) * plotH;
  const poly = (vals: number[], offset: number) => vals.map((v, i) => `${x(i + offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const histStart = Date.now() - Math.max(0, histLen - 1) * 86400000;
  const forecastStartIndex = Math.max(0, histLen - 1);
  const dates = [
    [histStart, 'Start'],
    [Date.now(), 'Now'],
    [Date.now() + Math.max(0, fcLen - 1) * 86400000, 'Forecast end'],
  ] as const;
  const grid = [0, 25, 50, 75, 100].map(t => `<line x1="${left}" x2="${width-right}" y1="${y(t)}" y2="${y(t)}" class="v45-grid"/><text x="14" y="${y(t)+4}" class="v45-axis">${t}%</text>`).join('');
  const lines = series.map(s => {
    const h = s.f.historical.filter(Number.isFinite);
    const fc = s.f.forecast.filter(Number.isFinite);
    return `${h.length > 1 ? `<polyline points="${poly(h,0)}" class="${s.colorClass}"/>` : ''}${fc.length > 1 ? `<polyline points="${poly(fc,forecastStartIndex)}" class="${s.colorClass}" stroke-dasharray="8 5"/>` : ''}`;
  }).join('');
  const current = lastValues([]);
  const sub = `90-day historical trend + ${horizon}-day forecast · Scope: ${hostLabel}`;
  return `<div><div class="v45-title">CPU, Memory & Disk utilization — single capacity trend</div><div class="v45-sub">${esc(sub)}</div><svg class="v45-main-chart" viewBox="0 0 ${width} ${height}" data-hist-start="${histStart}" data-hist-len="${histLen}" data-forecast-len="${fcLen}">${grid}<line x1="${left}" x2="${width-right}" y1="${y(80)}" y2="${y(80)}" class="v45-threshold"/>${lines}<line x1="${x(forecastStartIndex)}" x2="${x(forecastStartIndex)}" y1="${top}" y2="${height-bottom}" class="v45-grid"/>${dates.map(([ms,label],i)=>`<text x="${[left,left+plotW/2,width-right][i]}" y="${height-38}" text-anchor="${i===0?'start':i===2?'end':'middle'}" class="v45-axis">${label}: ${new Date(ms).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</text>`).join('')}<text x="${left}" y="${height-14}" class="v45-axis">Historical telemetry</text><text x="${width-right}" y="${height-14}" text-anchor="end" class="v45-axis">Dynatrace Intelligence forecast</text></svg><div class="v45-legend"><span><i class="v45-dot cpu"></i>CPU</span><span><i class="v45-dot memory"></i>Memory</span><span><i class="v45-dot disk"></i>Disk</span><span>Dashed line = forecast</span><span>Red dashed line = 80% capacity threshold</span></div></div>`;
}

export function installCapacityUxV45() {
  if (win.__capacityUxV45) return;
  win.__capacityUxV45 = true;
  styles();
  let hosts: Host[] = [];
  let selected = ALL;
  let horizon: ForecastHorizon = 30;
  let scope: MultiForecast | null = null;
  const individual = new Map<string, MultiForecast>();
  let timer = 0;
  let req = 0;
  const root = () => document.querySelector<HTMLElement>('.content');

  const render = (loading = false, error = '') => {
    if (!active()) return;
    hideOld();
    const c = root(); if (!c) return;
    let shell = document.getElementById(PAGE_ID);
    if (!shell) { shell = document.createElement('div'); shell.id = PAGE_ID; c.appendChild(shell); }
    const chosen = selected === ALL ? scope : individual.get(selected) || null;
    const ready = individual.size;
    const p = hosts.map(h => h.telemetry.at(-1));
    const avg = (k: 'cpu'|'memory'|'disk') => hosts.length ? p.reduce((s,x)=>s+num(x?.[k]),0)/hosts.length : 0;
    const host = hosts.find(h => h.id === selected);
    const html = `<section class="v45-card"><div class="v45-toolbar"><label class="v45-field">Host selection<select id="v45-host"><option value="${ALL}">All hosts — scope average (${hosts.length})</option>${hosts.map(h=>`<option value="${esc(h.id)}" ${h.id===selected?'selected':''}>${esc(h.name)} · ${esc(h.application)}</option>`).join('')}</select></label><div class="v45-status">${loading?'Loading live forecast…':`${ready}/${hosts.length} individual hosts loaded`}<br/>Scope forecast: ${scope && [scope.cpu,scope.memory,scope.disk].some(forecastOk)?'Ready':'Unavailable'}</div></div><div class="v45-kpis"><div class="v45-kpi"><small>Hosts in scope</small><strong>${hosts.length}</strong></div><div class="v45-kpi"><small>Current CPU</small><strong>${avg('cpu').toFixed(1)}%</strong></div><div class="v45-kpi"><small>Current Memory</small><strong>${avg('memory').toFixed(1)}%</strong></div><div class="v45-kpi"><small>Current Disk</small><strong>${avg('disk').toFixed(1)}%</strong></div></div>${error?`<div class="notice">${esc(error)}</div>`:''}<div class="v45-chart">${chosen?chart(selected===ALL?'selected Management Zone':host?.name??'Selected host',chosen,horizon):'<div class="v45-loading">Select a Management Zone and wait for the forecast to load.</div>'}</div></section><section class="v45-card"><div class="v45-title">Host forecast inventory</div><div class="v45-sub">Click a host to load its CPU, memory and disk forecasts on the same graph.</div><div class="v45-table"><table><thead><tr><th>Host</th><th>Application</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Risk</th><th>Forecast</th></tr></thead><tbody>${hosts.map(h=>{const ff=individual.get(h.id), p=h.telemetry.at(-1), ready=ff&&[ff.cpu,ff.memory,ff.disk].some(forecastOk);return `<tr data-v45-host="${esc(h.id)}" class="${h.id===selected?'v45-selected':''}"><td><strong>${esc(h.name)}</strong><small>${esc(h.id)}</small></td><td>${esc(h.application)}</td><td>${num(p?.cpu).toFixed(1)}%</td><td>${num(p?.memory).toFixed(1)}%</td><td>${num(p?.disk).toFixed(1)}%</td><td>${esc(getHostRisk(h))}</td><td><span class="v45-badge ${ready?'v45-ready':'v45-low'}">${ready?'Ready':'Select'}</span></td></tr>`}).join('')}</tbody></table></div></section>`;
    shell.innerHTML = html;
    shell.querySelector('#v45-host')?.addEventListener('change', async e => { selected = (e.target as HTMLSelectElement).value; if (selected !== ALL) await loadHost(selected); else render(); });
    shell.querySelectorAll<HTMLElement>('[data-v45-host]').forEach(r => r.addEventListener('click', async () => { selected = r.dataset.v45Host || ALL; if (selected !== ALL) await loadHost(selected); else render(); }));
    attachChartHover(shell);
  };

  const loadTriplet = async (targetHosts: Host[]) => {
    const [cpu,memory,disk] = await Promise.all([
      runDynatraceForecast(targetHosts,'cpu',horizon),
      runDynatraceForecast(targetHosts,'memory',horizon),
      runDynatraceForecast(targetHosts,'disk',horizon),
    ]);
    return { cpu, memory, disk };
  };
  const loadHost = async (id: string) => {
    const h = hosts.find(x => x.id === id); if (!h) return;
    render(true);
    try { individual.set(id, await loadTriplet([h])); render(); }
    catch (e) { render(false, e instanceof Error ? e.message : String(e)); }
  };
  const reload = async () => {
    if (!active()) return;
    const my = ++req; const i = inputs(); horizon = i.horizon; render(true);
    try {
      hosts = await dynatraceDataProvider.getHosts(i.zone, i.range);
      if (my !== req) return;
      scope = await loadTriplet(hosts);
      individual.clear(); selected = ALL; render();
    } catch (e) { if (my !== req) return; render(false, e instanceof Error ? e.message : String(e)); }
  };
  const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(() => void reload(), 250); };
  document.addEventListener('click', e => { if (e.target instanceof Element && e.target.closest('.nav-item')) schedule(); });
  document.addEventListener('change', e => { if (e.target instanceof HTMLSelectElement && e.target.closest('.top-actions')) schedule(); });
  window.setInterval(() => { if (active() && !document.getElementById(PAGE_ID)) schedule(); }, 1200);
  schedule();
}

function attachChartHover(root: HTMLElement) {
  root.querySelectorAll<SVGSVGElement>('svg.v45-main-chart').forEach(svg => {
    if (svg.dataset.hoverReady === '1') return;
    const tooltipId = 'v45-forecast-tooltip';
    const show = (e: MouseEvent, html: string) => {
      let t = document.getElementById(tooltipId) as HTMLElement | null;
      if (!t) { t = document.createElement('div'); t.id = tooltipId; t.className = 'chart-hover-tooltip'; document.body.appendChild(t); }
      t.innerHTML = html; t.style.display='block'; t.style.position='fixed'; t.style.zIndex='2147483647'; t.style.pointerEvents='none';
      const w=t.offsetWidth||280,h=t.offsetHeight||100; let x=e.clientX+14,y=e.clientY-h-14; if(x+w>innerWidth)x=e.clientX-w-14;if(y<8)y=e.clientY+14;t.style.left=`${Math.max(8,x)}px`;t.style.top=`${Math.max(8,y)}px`;
    };
    const hide=()=>{const t=document.getElementById(tooltipId);if(t)t.style.display='none';};
    const move=(e:MouseEvent)=>{
      const r=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal, histLen=Number(svg.dataset.histLen||0), fcLen=Number(svg.dataset.forecastLen||0), total=Math.max(2,histLen+fcLen), x=((e.clientX-r.left)/Math.max(1,r.width))*vb.width, idx=Math.max(0,Math.min(total-1,Math.round((x-62)/(Math.max(1,vb.width-92))*Math.max(1,total-1))));
      const daysFromHist=idx-(histLen-1), start=Number(svg.dataset.histStart||Date.now()); const date=new Date(start+idx*86400000).toLocaleString('en-IN');
      const readSeries=(cls:string)=>{ const lines=[...svg.querySelectorAll<SVGPolylineElement>(`polyline.${cls}`)]; if(!lines.length)return NaN; const line=lines[0], raw=line.getAttribute('points')||'', ns=raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[]; const offset=cls.includes('fc')?histLen-1:0; const local=idx-offset; if(local<0||local*2+1>=ns.length)return NaN; const y=ns[local*2+1]; return (1-(y-38)/(vb.height-38-78))*100; };
      const values={CPU:readSeries('v45-cpu'),Memory:readSeries('v45-memory'),Disk:readSeries('v45-disk')};
      show(e,`<strong>Forecast trend</strong><span>${date}</span><b>CPU: ${Number.isFinite(values.CPU)?values.CPU.toFixed(2):'—'}%</b><b>Memory: ${Number.isFinite(values.Memory)?values.Memory.toFixed(2):'—'}%</b><b>Disk: ${Number.isFinite(values.Disk)?values.Disk.toFixed(2):'—'}%</b><small>${daysFromHist<0?'Historical telemetry':`Forecast · ${Math.max(0,daysFromHist)} day(s) from now`}</small>`);
    };
    svg.addEventListener('mousemove',move);svg.addEventListener('mouseleave',hide);svg.dataset.hoverReady='1';
  });
}
