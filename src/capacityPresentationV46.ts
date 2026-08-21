import { dynatraceDataProvider } from './realDynatrace';
import { runDynatraceForecast, type DynatraceForecast } from './dynatraceIntelligence';
import type { ForecastHorizon, Host, MetricKey, TimeRange } from '@/types';

const STYLE_ID = 'capacity-presentation-v46-style';
const FORECAST_ID = 'capacity-forecast-v46';
const SIM_ID = 'simulation-combined-v46';
const ALL = '__ALL__';

type Metric = 'cpu' | 'memory' | 'disk';
type ForecastSet = Record<Metric, DynatraceForecast | null>;

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : 0;
const label = (m: Metric) => m === 'cpu' ? 'CPU' : m === 'memory' ? 'Memory' : 'Disk';
const metricKey = (v: string): Metric => v === 'memory' ? 'memory' : v === 'disk' ? 'disk' : 'cpu';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${FORECAST_ID}{display:grid;gap:14px;margin-top:16px}.v46-card{border:1px solid #dfe7f0;border-radius:14px;background:#fff;padding:18px}.v46-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 170px auto;gap:12px;align-items:end}.v46-field{display:flex;flex-direction:column;gap:5px;font-size:11px;color:#66778c}.v46-field select{min-height:36px;border:1px solid #cfdae7;border-radius:8px;padding:7px 10px;background:#fff;color:#18324f}.v46-status{font-size:11px;color:#62738a;text-align:right}.v46-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px}.v46-kpi{border:1px solid #e6ebf2;border-radius:10px;padding:11px;background:#f9fbfd}.v46-kpi small{display:block;color:#718096;font-size:9px}.v46-kpi strong{display:block;color:#17365d;font-size:18px;margin-top:4px}.v46-chart-wrap{margin-top:14px;border:1px solid #e3e9f1;border-radius:10px;padding:10px;overflow:auto}.v46-chart{width:100%;min-width:900px;height:420px}.v46-grid{stroke:#e8edf3}.v46-axis{font:11px Arial;fill:#66778c}.v46-title{font-size:14px;font-weight:800;color:#17365d}.v46-sub{font-size:11px;color:#6b7c90;margin-top:3px}.v46-line-hist{fill:none;stroke-width:2.8}.v46-line-fc{fill:none;stroke-width:2.8;stroke-dasharray:8 5}.v46-cpu{stroke:#2f78df}.v46-memory{stroke:#16a36b}.v46-disk{stroke:#9b5de5}.v46-threshold{stroke:#d45c55;stroke-width:1.5;stroke-dasharray:5 4}.v46-tooltip{position:fixed;z-index:2147483647;pointer-events:none;display:none;min-width:220px;max-width:300px;padding:10px 12px;border:1px solid #d7e0ec;border-radius:10px;background:rgba(16,35,62,.98);color:#fff;box-shadow:0 12px 28px rgba(20,42,72,.24);font-size:11px}.v46-tooltip strong,.v46-tooltip span,.v46-tooltip b,.v46-tooltip small{display:block}.v46-tooltip strong{font-size:12px;margin-bottom:3px}.v46-tooltip b{font-size:13px;margin-top:6px}.v46-tooltip small{opacity:.78;margin-top:4px}.dark .v46-card{background:#172235;border-color:#33465f}.dark .v46-kpi{background:#111827;border-color:#33465f}.dark .v46-kpi strong,.dark .v46-title{color:#e5edf8}.dark .v46-sub,.dark .v46-status,.dark .v46-axis,.dark .v46-field{color:#b9c7d8}.dark .v46-field select{background:#172235;border-color:#33465f;color:#e5edf8}
    @media(max-width:900px){.v46-toolbar,.v46-kpis{grid-template-columns:1fr 1fr}.v46-status{text-align:left}}
    #${SIM_ID}{margin-top:18px}.v46-sim-chart{width:100%;min-width:900px;height:360px}.v46-sim-hover{cursor:crosshair}.v46-sim-legend{display:flex;gap:18px;flex-wrap:wrap;margin-top:8px;font-size:10px;color:#66778c}.v46-sim-legend i{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:5px}.v46-combined-hidden{display:none!important}
  `;
  document.head.appendChild(style);
}

function tooltip(html: string, e: MouseEvent) {
  let node = document.getElementById('capacity-v46-tooltip') as HTMLElement | null;
  if (!node) { node = document.createElement('div'); node.id = 'capacity-v46-tooltip'; node.className = 'v46-tooltip'; document.body.appendChild(node); }
  node.innerHTML = html; node.style.display = 'block';
  const w = node.offsetWidth || 240, h = node.offsetHeight || 100;
  let x = e.clientX + 14, y = e.clientY - h - 14;
  if (x + w > window.innerWidth) x = e.clientX - w - 14;
  if (y < 8) y = e.clientY + 14;
  node.style.left = `${Math.max(8, x)}px`; node.style.top = `${Math.max(8, y)}px`;
}
function hideTooltip() { const node = document.getElementById('capacity-v46-tooltip'); if (node) node.style.display = 'none'; }

function stateInputs() {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.top-actions select')];
  const zone = selects.find((s) => /All Management Zones|Management Zone/i.test(s.value || ''))?.value || selects[0]?.value || 'All Management Zones';
  const range = (selects.find((s) => ['1h','6h','24h','7d','30d'].includes(s.value))?.value || '24h') as TimeRange;
  const horizon = Number(selects.find((s) => ['7','14','30','60','90'].includes(s.value))?.value || 30) as ForecastHorizon;
  return { zone, range, horizon };
}

function forecastDates(f: DynatraceForecast, kind: 'historical' | 'forecast', index: number, total: number) {
  const horizon = f.horizon * 86400000;
  const fcEnd = f.forecastEnd ? Date.parse(f.forecastEnd) : Date.now() + horizon;
  const fcStart = f.forecastStart ? Date.parse(f.forecastStart) : Date.now();
  if (kind === 'forecast') return fcStart + (fcEnd - fcStart) * (index / Math.max(1, total - 1));
  const start = Date.now() - Math.max(1, total - 1) * 86400000;
  return start + (Date.now() - start) * (index / Math.max(1, total - 1));
}

function makeForecastSet(): ForecastSet { return { cpu: null, memory: null, disk: null }; }

function renderCombinedForecast(root: HTMLElement, scopeLabel: string, selectedHost: Host | null, forecasts: ForecastSet, totalHosts: number, loading: boolean, error: string, onHost: (id: string) => void) {
  let shell = document.getElementById(FORECAST_ID) as HTMLElement | null;
  if (!shell) { shell = document.createElement('div'); shell.id = FORECAST_ID; root.appendChild(shell); }
  const fns = (['cpu','memory','disk'] as const).filter((m) => forecasts[m]?.historical.length || forecasts[m]?.forecast.length) as Metric[];
  const cpu = forecasts.cpu, mem = forecasts.memory, disk = forecasts.disk;
  const ready = fns.length;
  const current = (m: Metric) => { const a = forecasts[m]?.historical || []; return a.at(-1) ?? 0; };
  const peak = (m: Metric) => { const a = forecasts[m]?.forecast || []; return a.length ? Math.max(...a) : current(m); };
  const title = selectedHost ? selectedHost.name : scopeLabel;
  const max = Math.max(100, ...fns.flatMap((m) => [...(forecasts[m]?.historical || []), ...(forecasts[m]?.forecast || []), ...(forecasts[m]?.upperBound || [])]));
  const W=1100,H=420,L=70,R=28,T=28,B=64,plotW=W-L-R,plotH=H-T-B;
  const series = (m: Metric, forecast:boolean) => forecast ? (forecasts[m]?.forecast || []) : (forecasts[m]?.historical || []);
  const count = Math.max(...fns.map((m) => series(m,false).length + series(m,true).length),2);
  const splitIndex = Math.max(...fns.map((m) => Math.max(0, series(m,false).length-1)),0);
  const x=(i:number)=>L+i*plotW/Math.max(1,count-1), y=(v:number)=>T+(1-v/max)*plotH;
  const poly=(vals:number[],offset:number)=>vals.map((v,i)=>`${x(i+offset).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const grid=[0,25,50,75,100].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="v46-grid"/><text x="18" y="${y(v)+4}" class="v46-axis">${v}%</text>`).join('');
  const lines=fns.map((m)=>{const h=series(m,false), fc=series(m,true);const cls=`v46-${m}`;return `${h.length>1?`<polyline points="${poly(h,0)}" class="v46-line-hist ${cls}"/>`:''}${fc.length>1?`<polyline points="${poly(fc,splitIndex)}" class="v46-line-fc ${cls}"/>`:''}`;}).join('');
  const mid = Math.max(0, Math.min(count-1, splitIndex));
  const historicalTs = (i:number) => forecastDates(cpu || mem || disk!, 'historical', i, Math.max(1,splitIndex+1));
  const forecastTs = (i:number) => forecastDates(cpu || mem || disk!, 'forecast', i, Math.max(1,count-splitIndex));
  const legend = fns.map((m)=>`<span><i class="v46-${m}" style="background:currentColor"></i>${label(m)}</span>`).join('');
  shell.innerHTML=`<section class="v46-card"><div class="v46-toolbar"><label class="v46-field">Host / scope<select id="v46-host"><option value="${ALL}">${esc(scopeLabel)} (${totalHosts} hosts)</option></select></label><div class="v46-status">${loading?'Loading forecast…':error?`Forecast error: ${esc(error)}`:`${ready}/3 metrics available`}<br/>Combined CPU · Memory · Disk</div></div><div class="v46-kpis"><div class="v46-kpi"><small>Hosts in scope</small><strong>${totalHosts}</strong></div><div class="v46-kpi"><small>Current CPU</small><strong>${current('cpu').toFixed(1)}%</strong></div><div class="v46-kpi"><small>Current Memory</small><strong>${current('memory').toFixed(1)}%</strong></div><div class="v46-kpi"><small>Current Disk</small><strong>${current('disk').toFixed(1)}%</strong></div></div><div class="v46-chart-wrap"><div class="v46-title">${esc(title)} · Combined capacity trend · ${cpu?.horizon ?? mem?.horizon ?? disk?.horizon ?? 30} days</div><div class="v46-sub">Solid = historical · dashed = Dynatrace Intelligence forecast · red line = 80% capacity threshold</div><svg id="v46-forecast-svg" class="v46-chart v46-hover" viewBox="0 0 ${W} ${H}">${grid}${lines}<line x1="${x(mid)}" x2="${x(mid)}" y1="${T}" y2="${H-B}" class="v46-grid"/><line x1="${L}" x2="${W-R}" y1="${y(80)}" y2="${y(80)}" class="v46-threshold"/><text x="${L}" y="${H-32}" class="v46-axis">${new Date(historicalTs(0)).toLocaleDateString('en-IN')}</text><text x="${Math.min(W-180,x(mid)+10)}" y="${H-32}" class="v46-axis">Forecast start</text><text x="${W-R-150}" y="${H-32}" class="v46-axis">${new Date(forecastTs(Math.max(0,count-splitIndex-1))).toLocaleDateString('en-IN')}</text><text x="${W/2-24}" y="${H-10}" class="v46-axis">Date / time</text></svg><div class="v46-sim-legend">${legend}</div></div></section><section class="v46-card"><div class="v46-title">Forecast summary</div><div class="v46-sub">Peak forecast by resource for the selected scope/host.</div><div class="v46-kpis"><div class="v46-kpi"><small>CPU forecast peak</small><strong>${peak('cpu').toFixed(1)}%</strong></div><div class="v46-kpi"><small>Memory forecast peak</small><strong>${peak('memory').toFixed(1)}%</strong></div><div class="v46-kpi"><small>Disk forecast peak</small><strong>${peak('disk').toFixed(1)}%</strong></div><div class="v46-kpi"><small>Selection</small><strong>${selectedHost?'Host':'Scope'}</strong></div></div></section>`;
  const svg = shell.querySelector<SVGSVGElement>('#v46-forecast-svg');
  if (svg) {
    svg.addEventListener('mousemove',(e)=>{
      const r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,xx=((e.clientX-r.left)/Math.max(1,r.width))*vb.width;
      const idx=Math.round(((xx-L)/Math.max(1,plotW))*(count-1));
      const isFc=idx>=splitIndex; const local=isFc?idx-splitIndex:idx; const ts=isFc?forecastTs(local):historicalTs(idx);
      const values=(['cpu','memory','disk'] as Metric[]).map((m)=>{const a=series(m,isFc);return `${label(m)}: ${a[local] == null ? '—' : `${a[local].toFixed(2)}%`}`;}).join('<br>');
      tooltip(`<strong>${new Date(ts).toLocaleString('en-IN')}</strong><span>${isFc?'Dynatrace Intelligence forecast':'Historical telemetry'}</span><b>${values}</b><small>Nearest rendered date bucket</small>`,e);
    });
    svg.addEventListener('mouseleave',hideTooltip);
  }
}

async function forecastPage() {
  return [...document.querySelectorAll('.nav-item.active span')].some((n) => n.textContent?.trim() === 'Capacity Forecast');
}

async function installForecast() {
  if ((window as any).__capacityPresentationV46Forecast) return;
  (window as any).__capacityPresentationV46Forecast = true;
  let timer=0, seq=0; let hosts:Host[]=[]; let selected=ALL;
  const run = async () => {
    if (!(await forecastPage())) return;
    const id=++seq, input=stateInputs();
    document.querySelectorAll<HTMLElement>('.forecast-panel').forEach((n)=>n.style.display='none');
    document.getElementById('forecast-v44-page')?.remove();
    try {
      hosts=await dynatraceDataProvider.getHosts(input.zone,input.range); if(id!==seq)return;
      const chosen=selected===ALL?null:hosts.find((h)=>h.id===selected) || null;
      const scope = chosen ? [chosen] : hosts;
      const results=makeForecastSet();
      const metrics:Metric[]=['cpu','memory','disk'];
      await Promise.all(metrics.map(async(m)=>{ results[m]=await runDynatraceForecast(scope,m,input.horizon); }));
      const root=document.querySelector<HTMLElement>('.content'); if(!root)return;
      renderCombinedForecast(root,input.zone,chosen,results,hosts.length, false, '', (id)=>{selected=id;clearTimeout(timer);void run();});
      const sel=document.querySelector<HTMLSelectElement>('#v46-host');
      if(sel){sel.innerHTML=`<option value="${ALL}" ${selected===ALL?'selected':''}>${esc(input.zone)} — ${hosts.length} hosts (scope)</option>${hosts.map((h)=>`<option value="${esc(h.id)}" ${h.id===selected?'selected':''}>${esc(h.name)} · ${esc(h.application)}</option>`).join('')}`;sel.addEventListener('change',()=>{selected=sel.value;void run();});}
    } catch (e) {
      const root=document.querySelector<HTMLElement>('.content'); if(root) renderCombinedForecast(root,input.zone,null,makeForecastSet(),hosts.length,false,e instanceof Error?e.message:String(e),()=>{});
    }
  };
  const schedule=()=>{clearTimeout(timer);timer=window.setTimeout(()=>void run(),200);};
  document.addEventListener('click',(e)=>{if(e.target instanceof Element&&e.target.closest('.nav-item'))schedule();});
  document.addEventListener('change',(e)=>{if(e.target instanceof HTMLSelectElement&&e.target.closest('.top-actions')){selected=ALL;schedule();}});
  window.setInterval(()=>{if(forecastPage()&&!document.getElementById(FORECAST_ID))void run();},1200);
  schedule();
}

function parseSimulationRows(root: HTMLElement) {
  const rows = [...root.querySelectorAll<HTMLTableRowElement>('.scenario-table tbody tr')];
  return rows.map((row)=>{const cells=[...row.querySelectorAll('td')].map((c)=>c.textContent?.trim()||'');const n=(s:string)=>Number(s.replace(/[^0-9.+-]/g,''))||0;return {day:n(cells[0]),traffic:n(cells[1]),cpu:n(cells[2]),memory:n(cells[3]),disk:n(cells[4])};}).filter((r)=>r.day>0);
}
function enhanceSimulation() {
  const panel=document.querySelector<HTMLElement>('.simulation-enhanced'); if(!panel)return;
  const target=panel.querySelector<HTMLElement>('.simulation-scenario-detail-v4') || panel.querySelector<HTMLElement>('.simulation-scenario-detail'); if(!target)return;
  target.querySelectorAll<HTMLElement>('.projection-meta span').forEach((span)=>{if(/Aligned samples/i.test(span.textContent||''))span.remove();});
  target.querySelectorAll<HTMLElement>('.projection-grid').forEach((n)=>n.classList.add('v46-combined-hidden'));
  const rows=parseSimulationRows(target); if(!rows.length)return;
  let card=target.querySelector<HTMLElement>('#'+SIM_ID); if(card?.dataset.signature===JSON.stringify(rows))return; card?.remove();
  card=document.createElement('section'); card.id=SIM_ID; card.className='v46-card'; card.dataset.signature=JSON.stringify(rows);
  const W=1100,H=360,L=70,R=28,T=30,B=58,plotW=W-L-R,plotH=H-T-B,max=Math.max(100,...rows.flatMap((r)=>[r.cpu,r.memory,r.disk]));
  const x=(i:number)=>L+i*plotW/Math.max(1,rows.length-1),y=(v:number)=>T+(1-v/max)*plotH;
  const poly=(key:Metric)=>rows.map((r,i)=>`${x(i)},${y(r[key])}`).join(' ');
  const grid=[0,25,50,75,100].map(v=>`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" class="v46-grid"/><text x="18" y="${y(v)+4}" class="v46-axis">${v}%</text>`).join('');
  card.innerHTML=`<div class="v46-title">CPU · Memory · Disk — combined simulation trajectory</div><div class="v46-sub">Single view of the traffic what-if resource trajectory. Hover any point to read the checkpoint values.</div><div class="v46-chart-wrap"><svg class="v46-sim-chart v46-sim-hover" viewBox="0 0 ${W} ${H}">${grid}${(['cpu','memory','disk'] as const).map((m)=>`<polyline points="${poly(m)}" class="v46-line-hist v46-${m}"/>${rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(r[m])}" r="5" fill="#fff" stroke="currentColor" class="v46-${m}" data-index="${i}"/>`).join('')}`).join('')}<line x1="${L}" x2="${W-R}" y1="${y(80)}" y2="${y(80)}" class="v46-threshold"/>${rows.map((r,i)=>`<text x="${x(i)-15}" y="${H-28}" class="v46-axis">${r.day}d</text>`).join('')}<text x="${W/2-54}" y="${H-8}" class="v46-axis">Simulation horizon</text></svg><div class="v46-sim-legend"><span><i class="v46-cpu"></i>CPU</span><span><i class="v46-memory"></i>Memory</span><span><i class="v46-disk"></i>Disk</span></div></div>`;
  target.appendChild(card);
  const svg=card.querySelector<SVGSVGElement>('svg');
  svg?.addEventListener('mousemove',(e)=>{const r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,xx=((e.clientX-r.left)/Math.max(1,r.width))*vb.width;const idx=Math.max(0,Math.min(rows.length-1,Math.round(((xx-L)/Math.max(1,plotW))*(rows.length-1))));const row=rows[idx];tooltip(`<strong>${row.day} days from now</strong><span>Scenario traffic ${row.traffic.toFixed(1)} req/min</span><b>CPU ${row.cpu.toFixed(2)}%<br>Memory ${row.memory.toFixed(2)}%<br>Disk ${row.disk.toFixed(2)}%</b><small>Traffic-driven what-if estimate</small>`,e);});
  svg?.addEventListener('mouseleave',hideTooltip);
}

export function installCapacityPresentationV46() {
  injectStyle();
  void installForecast();
  const observer=new MutationObserver(()=>{clearTimeout((observer as any).t);(observer as any).t=window.setTimeout(enhanceSimulation,120);});
  observer.observe(document.body,{subtree:true,childList:true});
  document.addEventListener('click',()=>setTimeout(enhanceSimulation,180));
  document.addEventListener('change',()=>setTimeout(enhanceSimulation,180));
  window.setInterval(enhanceSimulation,1500);
}
