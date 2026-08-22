import { dynatraceDataProvider } from './realDynatrace';
import { getHostRisk } from './services/hostStatus';
import type { TimeRange } from '@/types';

const FLAG='__axisOverviewRiskCardsV51';
const text=(e:Element|null|undefined)=>e?.textContent?.replace(/\s+/g,' ').trim()||'';
const value=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:0;

function getScope(){
  const selects=[...document.querySelectorAll<HTMLSelectElement>('.top-actions select')];
  const zone=selects.find(s=>[...s.options].some(o=>o.textContent?.trim()==='All Management Zones'))?.value||'All Management Zones';
  const range=(selects.find(s=>['1h','6h','24h','7d','30d'].includes(s.value))?.value||'24h') as TimeRange;
  return {zone,range};
}

async function showRiskDetails(card:HTMLElement,kind:'High'|'Critical'){
  document.getElementById('overview-risk-v51')?.remove();
  const {zone,range}=getScope();
  const box=document.createElement('section');
  box.id='overview-risk-v51';
  box.className='panel';
  box.style.marginTop='14px';
  box.innerHTML='<div class="notice">Loading live host details…</div>';
  card.parentElement?.after(box);
  try{
    const hosts=await dynatraceDataProvider.getHosts(zone,range);
    const rows=hosts
      .filter(h=>getHostRisk(h)===kind)
      .sort((a,b)=>Math.max(value(b.telemetry.at(-1)?.cpu),value(b.telemetry.at(-1)?.memory),value(b.telemetry.at(-1)?.disk))-Math.max(value(a.telemetry.at(-1)?.cpu),value(a.telemetry.at(-1)?.memory),value(a.telemetry.at(-1)?.disk)));
    const scopeLabel=text(document.querySelector('.mz-selector select')?.parentElement)||zone;
    const body=rows.map(h=>{
      const p=h.telemetry.at(-1);
      return `<tr><td><strong>${h.name}</strong><div class="muted">${h.id}</div></td><td>${h.application}</td><td>${value(p?.cpu).toFixed(1)}%</td><td>${value(p?.memory).toFixed(1)}%</td><td>${value(p?.disk).toFixed(1)}%</td><td>${getHostRisk(h)}</td></tr>`;
    }).join('');
    box.innerHTML=`<div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div><strong>${kind} risk hosts · ${rows.length}</strong><div class="muted">Live hosts in ${scopeLabel}</div></div><button type="button" id="overview-risk-v51-close">Close</button></div><div style="overflow:auto;margin-top:10px"><table><thead><tr><th>Host</th><th>Application</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Risk</th></tr></thead><tbody>${body||'<tr><td colspan="6">No hosts currently meet this threshold.</td></tr>'}</tbody></table></div>`;
    box.querySelector('#overview-risk-v51-close')?.addEventListener('click',()=>box.remove());
  }catch(error){
    box.innerHTML=`<div style="display:flex;justify-content:space-between"><strong>Unable to load ${kind.toLowerCase()} risk details</strong><button type="button" id="overview-risk-v51-close">Close</button></div><div class="notice">${error instanceof Error?error.message:String(error)}</div>`;
    box.querySelector('#overview-risk-v51-close')?.addEventListener('click',()=>box.remove());
  }
}

export function installOverviewRiskCardsV51(){
  const w=window as Window & {[FLAG]?:boolean};
  if(w[FLAG])return;
  w[FLAG]=true;
  const bind=()=>{
    document.querySelectorAll<HTMLElement>('.metric-card').forEach(card=>{
      if(card.dataset.riskV51)return;
      const kind=card.textContent?.includes('Critical')?'Critical':card.textContent?.includes('High Risk')?'High':'';
      if(!kind)return;
      card.dataset.riskV51='1';
      card.style.cursor='pointer';
      card.title=`Show ${kind.toLowerCase()} risk host details`;
      card.addEventListener('click',()=>void showRiskDetails(card,kind as 'High'|'Critical'));
    });
  };
  bind();
  window.setInterval(bind,1000);
}
