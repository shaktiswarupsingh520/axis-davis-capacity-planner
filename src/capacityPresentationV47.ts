const STYLE_ID='capacity-presentation-v47-style';
const FORECAST_ID='v46-forecast-svg';
const SIM_ID='simulation-combined-v46';
const COLORS={cpu:'#2f78df',memory:'#16a36b',disk:'#9b5de5'} as const;

type Metric='cpu'|'memory'|'disk';
const label=(m:Metric)=>m==='cpu'?'CPU':m==='memory'?'Memory':'Disk';

function installStyle(){
  if(document.getElementById(STYLE_ID))return;
  const style=document.createElement('style');style.id=STYLE_ID;style.textContent=`
    .v46-sim-legend .v46-cpu{background:${COLORS.cpu}!important;color:${COLORS.cpu}!important}
    .v46-sim-legend .v46-memory{background:${COLORS.memory}!important;color:${COLORS.memory}!important}
    .v46-sim-legend .v46-disk{background:${COLORS.disk}!important;color:${COLORS.disk}!important}
    .v47-hover-guide{stroke:#718096;stroke-width:1;stroke-dasharray:3 3;pointer-events:none}
  `;document.head.appendChild(style);
}
function tooltip(html:string,e:MouseEvent){
  let node=document.getElementById('capacity-v47-tooltip') as HTMLElement|null;
  if(!node){node=document.createElement('div');node.id='capacity-v47-tooltip';node.className='v46-tooltip';document.body.appendChild(node);}
  node.innerHTML=html;node.style.display='block';const w=node.offsetWidth||250,h=node.offsetHeight||110;let x=e.clientX+14,y=e.clientY-h-14;if(x+w>window.innerWidth)x=e.clientX-w-14;if(y<8)y=e.clientY+14;node.style.left=`${Math.max(8,x)}px`;node.style.top=`${Math.max(8,y)}px`;
}
function hide(){document.getElementById('capacity-v47-tooltip')?.style.setProperty('display','none');}
function points(poly:SVGPolylineElement){
  return (poly.getAttribute('points')||'').trim().split(/\s+/).map(token=>{const [x,y]=token.split(',').map(Number);return Number.isFinite(x)&&Number.isFinite(y)?{x,y}:null;}).filter((p):p is {x:number;y:number}=>!!p);
}
function nearest(arr:Array<{x:number;y:number}>,x:number){if(!arr.length)return null;return arr.reduce((best,p)=>Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,arr[0]);}
function axisScale(svg:SVGSVGElement){
  const lines=[...svg.querySelectorAll<SVGLineElement>('.v46-grid')].filter(l=>l.getAttribute('x1')===l.getAttribute('x2'));
  const split=lines.find(l=>l.getAttribute('y1')!==l.getAttribute('y2'));
  const horizontal=[...svg.querySelectorAll<SVGLineElement>('.v46-grid')].filter(l=>l.getAttribute('y1')===l.getAttribute('y2')).map(l=>Number(l.getAttribute('y1'))).filter(Number.isFinite);
  const y0=Math.max(...horizontal);const y100=Math.min(...horizontal);const plotH=Math.max(1,y0-y100);const max=100*plotH/Math.max(1,y0-y100);
  return {splitX:split?Number(split.getAttribute('x1')):0,y0,plotH,max};
}
function valueFromY(y:number,scale:{y0:number;plotH:number;max:number}){return Math.max(0,Math.min(scale.max,(scale.y0-y)/scale.plotH*scale.max));}
function parseDateText(svg:SVGSVGElement){
  const text=[...svg.querySelectorAll('text')].map(n=>n.textContent?.trim()||'').join(' | ');
  const dates=[...text.matchAll(/(?:Start:\s*)?(\d{1,2})[\/ -]([A-Za-z]{3,9}|\d{1,2})[\/ -](\d{4})/g)].map(m=>m[0].replace(/^Start:\s*/,'').trim());
  const parsed=dates.map(s=>{const d=Date.parse(s);return Number.isFinite(d)?d:null;}).filter((d):d is number=>d!==null);
  return {start:parsed[0]??Date.now()-90*86400000, end:parsed.at(-1)??Date.now()+30*86400000};
}
function installForecastHover(){
  const svg=document.getElementById(FORECAST_ID) as SVGSVGElement|null;
  if(!svg||svg.dataset.v47Hover==='1')return;
  svg.dataset.v47Hover='1';
  const run=(e:MouseEvent)=>{
    const rect=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal;
    const x=((e.clientX-rect.left)/Math.max(1,rect.width))*vb.width;
    const hist:{m:Metric;p:{x:number;y:number}|null}[]=(['cpu','memory','disk'] as Metric[]).map(m=>({m,p:nearest(points(svg.querySelector<SVGPolylineElement>(`.v46-line-hist.v46-${m}`)!),x)}));
    const fc:{m:Metric;p:{x:number;y:number}|null}[]=(['cpu','memory','disk'] as Metric[]).map(m=>({m,p:nearest(points(svg.querySelector<SVGPolylineElement>(`.v46-line-fc.v46-${m}`)!),x)}));
    const histDist=Math.min(...hist.map(v=>v.p?Math.abs(v.p.x-x):Infinity));
    const fcDist=Math.min(...fc.map(v=>v.p?Math.abs(v.p.x-x):Infinity));
    const forecast=fcDist<histDist;
    const chosen=forecast?fc:hist;const scale=axisScale(svg);const dateRange=parseDateText(svg);const splitX=scale.splitX||vb.width*.65;
    const frac=forecast?Math.max(0,Math.min(1,(x-splitX)/Math.max(1,vb.width-28-splitX))):Math.max(0,Math.min(1,(x-70)/Math.max(1,splitX-70)));
    const ts=forecast?dateRange.end-(1-frac)*Math.max(1,dateRange.end-Date.now()):dateRange.start+frac*Math.max(1,Date.now()-dateRange.start);
    const values=chosen.map(({m,p})=>`${label(m)}: ${p?`${valueFromY(p.y,scale).toFixed(2)}%`:'—'}`).join('<br>');
    tooltip(`<strong>${new Date(ts).toLocaleString('en-IN')}</strong><span>${forecast?'Dynatrace Intelligence forecast':'Historical telemetry'}</span><b>${values}</b><small>${forecast?'Forecast point':'Historical point'} · nearest rendered bucket</small>`,e);
  };
  svg.addEventListener('mousemove',run);svg.addEventListener('mouseleave',hide);
}
function fixSimulationLegend(){
  document.querySelectorAll<HTMLElement>(`#${SIM_ID} .v46-sim-legend i`).forEach(node=>{
    const cls=(node.className||'').toString();
    const m=(['cpu','memory','disk'] as Metric[]).find(k=>cls.split(/\s+/).includes(`v46-${k}`));
    if(m)node.style.background=COLORS[m];
  });
}
export function installCapacityPresentationV47(){
  installStyle();
  const apply=()=>{installForecastHover();fixSimulationLegend();};
  apply();
  document.addEventListener('click',()=>window.setTimeout(apply,120));
  document.addEventListener('change',()=>window.setTimeout(apply,120));
  window.setInterval(apply,800);
}
