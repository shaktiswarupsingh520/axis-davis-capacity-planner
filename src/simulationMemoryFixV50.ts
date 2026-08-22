import { dynatraceDataProvider } from './realDynatrace';
import { runCapacitySimulation } from './services/capacitySimulation';
import type { ForecastHorizon } from '@/types';

const FLAG='__axisSimulationMemoryFixV50';
const text=(e:Element|null|undefined)=>e?.textContent?.replace(/\s+/g,' ').trim()||'';
const num=(s:string)=>Number((s||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/)?.[0]||0);

function isSimulationPage(){return Boolean(document.querySelector('.simulation-controls')||document.querySelector('.simulation-scenario-detail-v4'))}
function selectedZone(){return [...document.querySelectorAll<HTMLSelectElement>('select')].find(s=>/management zone/i.test(s.previousElementSibling?.textContent||''))?.value||'All Management Zones'}
function scenarioGrowth(panel:HTMLElement){const header=panel.querySelector('.projection-header h2')?.textContent||'';const m=header.match(/([+-]?\d+(?:\.\d+)?)%/);if(m)return Number(m[1]);const sliders=[...document.querySelectorAll<HTMLInputElement>('.simulation-controls input[type="range"]')];return Number(sliders[0]?.value||0)}
function applyMemory(panel:HTMLElement, values:Map<number,number>){
  const memoryCard=[...panel.querySelectorAll<HTMLElement>('.projection-card')].find(c=>/Memory utilization/i.test(text(c)));
  if(memoryCard){
    const circles=[...memoryCard.querySelectorAll<SVGCircleElement>('circle[data-day]')];
    circles.forEach(c=>{const day=Number(c.dataset.day||0),v=values.get(day);if(v===undefined)return;c.dataset.value=v.toFixed(1);const cy=270-v*2;c.setAttribute('cy',String(cy));const labelNode=c.parentElement?.querySelector<SVGTextElement>('text.projection-label');if(labelNode)labelNode.textContent=`${v.toFixed(1)}%`});
    const line=memoryCard.querySelector<SVGPolylineElement>('polyline.projection-line');
    if(line){line.setAttribute('points',circles.map(c=>`${c.getAttribute('cx')},${c.getAttribute('cy')}`).join(' '))}
  }
  const table=panel.querySelector('.scenario-table table');
  if(table){const headers=[...table.querySelectorAll('thead th')].map(text);const mi=headers.findIndex(h=>/memory/i.test(h));if(mi>=0)[...table.querySelectorAll<HTMLTableRowElement>('tbody tr')].forEach(row=>{const day=num(text(row.cells[0]));const v=values.get(day);if(v!==undefined&&row.cells[mi])row.cells[mi].textContent=`${v.toFixed(1)}%`})}
}
async function refresh(){
  if(!isSimulationPage())return;const panel=document.querySelector<HTMLElement>('.simulation-scenario-detail-v4');if(!panel||panel.dataset.memoryFixV50==='done'||panel.dataset.memoryFixV50==='loading')return;const growth=scenarioGrowth(panel);if(!Number.isFinite(growth))return;panel.dataset.memoryFixV50='loading';
  try{const hosts=await dynatraceDataProvider.getHosts(selectedZone(),'24h');if(!hosts.length){panel.dataset.memoryFixV50='error';return};const memory=hosts.reduce((s,h)=>s+(h.telemetry.at(-1)?.memory??0),0)/hosts.length;const cpu=hosts.reduce((s,h)=>s+(h.telemetry.at(-1)?.cpu??0),0)/hosts.length;const disk=hosts.reduce((s,h)=>s+(h.telemetry.at(-1)?.disk??0),0)/hosts.length;const values=new Map<number,number>();for(const day of [0,20,30,60,90]){if(day===0){values.set(0,memory);continue}const r=runCapacitySimulation({cpuCapacity:Math.max(1,cpu),memoryCapacity:Math.max(1,memory),diskCapacity:Math.max(1,disk),trafficGrowth:growth,transactionGrowth:growth,period:day as ForecastHorizon,additionalHosts:0,cpuPerHost:25,memoryPerHost:25,diskPerHost:20});values.set(day,Math.max(0,Number(r.projectedMemory)||memory))}applyMemory(panel,values);panel.dataset.memoryFixV50='done'}catch{panel.dataset.memoryFixV50='error'}
}
export function installSimulationMemoryFixV50(){if((window as any)[FLAG])return;(window as any)[FLAG]=true;const schedule=()=>window.setTimeout(()=>void refresh(),180);const observer=new MutationObserver(schedule);observer.observe(document.body,{subtree:true,childList:true});document.addEventListener('click',schedule);document.addEventListener('change',schedule);schedule()}
