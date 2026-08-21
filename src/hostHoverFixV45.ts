type MetricMeta = { name: string; unit: string };
const META: Record<string, MetricMeta> = {
  cpu: { name: 'CPU utilization', unit: '%' },
  memory: { name: 'Memory utilization', unit: '%' },
  disk: { name: 'Disk utilization', unit: '%' },
  throughput: { name: 'Application throughput', unit: 'req/min' },
  networkRx: { name: 'Network RX', unit: 'B/s' },
  networkTx: { name: 'Network TX', unit: 'B/s' },
};
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
function metricKey(panel: Element) {
  const s = panel.querySelector<HTMLSelectElement>('select');
  if (s?.value && META[s.value]) return s.value;
  const t = panel.querySelector('.chart-title-row strong')?.textContent?.toLowerCase() || '';
  if (t.includes('memory')) return 'memory';
  if (t.includes('disk')) return 'disk';
  if (t.includes('network rx') || t.includes('receive')) return 'networkRx';
  if (t.includes('network tx') || t.includes('transmit')) return 'networkTx';
  if (t.includes('throughput')) return 'throughput';
  if (t.includes('cpu')) return 'cpu';
  return '';
}
function rangeMs() {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.top-actions .mz-selector select')];
  const v = selects[1]?.value || '24h';
  return v === '1h' ? 3600000 : v === '6h' ? 21600000 : v === '7d' ? 604800000 : v === '30d' ? 2592000000 : 86400000;
}
function valueFromY(svg: SVGSVGElement, y: number) {
  const ticks = [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map(n => ({ y: Number(n.getAttribute('y')), v: Number((n.textContent || '').replace(/[^0-9.+-]/g, '')) }))
    .filter(x => Number.isFinite(x.y) && Number.isFinite(x.v))
    .sort((a,b) => a.y-b.y);
  if (ticks.length < 2) return NaN;
  const top = ticks[0], bottom = ticks[ticks.length-1];
  return top.v + ((y-top.y) / Math.max(1,bottom.y-top.y)) * (bottom.v-top.v);
}
function tooltip(e: MouseEvent, html: string) {
  let t = document.getElementById('axis-chart-tooltip-v45') as HTMLElement | null;
  if (!t) { t = document.createElement('div'); t.id = 'axis-chart-tooltip-v45'; t.className = 'chart-hover-tooltip'; document.body.appendChild(t); }
  t.innerHTML = html; t.style.display='block'; t.style.position='fixed'; t.style.zIndex='2147483647'; t.style.pointerEvents='none';
  const w=t.offsetWidth||260,h=t.offsetHeight||90; let x=e.clientX+14,y=e.clientY-h-14; if(x+w>innerWidth)x=e.clientX-w-14;if(y<8)y=e.clientY+14;t.style.left=`${Math.max(8,x)}px`;t.style.top=`${Math.max(8,y)}px`;
}
const hide=()=>{const t=document.getElementById('axis-chart-tooltip-v45');if(t)t.style.display='none';};
function install(svg: SVGSVGElement) {
  if (svg.dataset.hoverV45 === '1') return;
  const panel = svg.closest('.chart-panel'); if (!panel) return;
  const move = (e: MouseEvent) => {
    const metaKey = metricKey(panel); if (!metaKey) return;
    const meta = META[metaKey];
    const r=svg.getBoundingClientRect(), vb=svg.viewBox.baseVal;
    const x=((e.clientX-r.left)/Math.max(1,r.width))*vb.width;
    const lines=[...svg.querySelectorAll<SVGPolylineElement>('polyline')].filter(l=>l.getAttribute('points'));
    if(!lines.length)return;
    let best:{line:SVGPolylineElement,x:number,y:number}|null=null;
    for(const line of lines){const ns=(line.getAttribute('points')||'').match(/-?\d+(?:\.\d+)?/g)?.map(Number)||[];for(let i=0;i+1<ns.length;i+=2){const px=ns[i],py=ns[i+1];if(!best||Math.abs(px-x)<Math.abs(best.x-x))best={line,x:px,y:py};}}
    if(!best)return;
    const split=svg.querySelector<SVGLineElement>('.forecast-split');
    const splitX=split?Number(split.getAttribute('x1')):NaN;
    const forecast=/forecast/i.test(best.line.getAttribute('class')||'');
    const duration=rangeMs();
    let start=Date.now()-duration,end=Date.now();
    if(forecast){start=Date.now();end=Date.now()+Math.max(1,Number((document.querySelector('.top-actions .mz-selector:nth-of-type(3) select') as HTMLSelectElement | null)?.value||30))*86400000;}
    const left=40,right=vb.width-40;const f=Math.max(0,Math.min(1,(best.x-left)/Math.max(1,right-left)));const date=new Date(start+(end-start)*f).toLocaleString('en-IN');
    const value=valueFromY(svg,best.y);
    document.getElementById('axis-chart-tooltip-v5')?.style.setProperty('display','none');
    tooltip(e,`<strong>${meta.name}</strong><span>${date}</span><b>${Number.isFinite(value)?value.toFixed(meta.unit==='%'?2:1):'—'} ${meta.unit}</b><small>${forecast?'Dynatrace forecast':'Historical telemetry'} · exact rendered chart point</small>`);
  };
  svg.addEventListener('mousemove',move);svg.addEventListener('mouseleave',hide);svg.dataset.hoverV45='1';
}
export function installHostHoverFixV45(){
  const state=window as Window & { __hostHoverFixV45?: boolean }; if(state.__hostHoverFixV45)return;state.__hostHoverFixV45=true;
  const refresh=()=>document.querySelectorAll<SVGSVGElement>('.chart-panel svg').forEach(install);
  const ob=new MutationObserver(()=>{window.setTimeout(refresh,80)});ob.observe(document.body,{subtree:true,childList:true});
  document.addEventListener('change',()=>window.setTimeout(refresh,120));
  window.setInterval(refresh,800); refresh();
}
