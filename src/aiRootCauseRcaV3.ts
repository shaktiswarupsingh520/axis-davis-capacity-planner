import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QR { records?: Array<Row | null> }
const ID = 'axis-ai-root-cause-rca-v3';
const s = (v: unknown): string => Array.isArray(v) ? v.map(s).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));

async function dql(query:string,max=200):Promise<Row[]> {
  const r = await queryExecutionClient.queryExecute({ body:{ query, requestTimeoutMilliseconds:30000, maxResultRecords:max } });
  let result = r.result as QR|undefined;
  const token = r.requestToken;
  for(let i=0; !result && token && i<30; i++) {
    const p = await queryExecutionClient.queryPoll({ requestToken:token, requestTimeoutMilliseconds:30000 });
    result = p.result as QR|undefined;
    if(!result) await new Promise(x=>setTimeout(x,250));
  }
  if(!result) throw new Error('DQL did not complete.');
  return (result.records??[]).filter(Boolean) as Row[];
}

const duration = (a:string,b:string) => {
  const x=new Date(a).getTime(), y=b?new Date(b).getTime():Date.now();
  if(!Number.isFinite(x)||!Number.isFinite(y)) return '—';
  const m=Math.max(0,y-x)/60000;
  return m<60?`${m.toFixed(1)} min`:m<1440?`${(m/60).toFixed(1)} h`:`${(m/1440).toFixed(1)} d`;
};
const dt = (v:string) => { const d=new Date(v); return Number.isFinite(d.getTime())?d.toLocaleString():v||'—'; };

interface Evidence { problem:Row; events:Row[]; logs:Row[]; history:Row[]; snapshots:Row[]; }
interface RcaResult { id:string; evidence:Evidence; analysis:string; generatedAt:string; }

async function loadEvidence(id:string):Promise<Evidence> {
  const pid=q(id);
  const rows=await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${pid}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,root_cause.smartscape_entity,root_cause_entity_id\n| limit 1`,5);
  if(!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const p=rows[0];
  const ids=Array.isArray(p.affected_entity_ids)?p.affected_entity_ids.map(s).filter(Boolean):[s(p.affected_entity_ids)].filter(Boolean);
  const entityList=[...new Set(ids)].slice(0,80).map(x=>`"${q(x)}"`).join(', ');
  const eventIds=Array.isArray(p['dt.davis.event_ids'])?p['dt.davis.event_ids'].map(s).filter(Boolean):[];
  const eventList=eventIds.slice(0,80).map(x=>`"${q(x)}"`).join(', ');
  const start=s(p['event.start']);
  const end=s(p['event.end'])||new Date().toISOString();
  const events=eventList?await dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.query,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 100`,100).catch(()=>[]):Row[];
  const logs=entityList?await dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 100`,100).catch(()=>[]):Row[];
  const history=await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${q(s(p['event.name']))}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,root_cause.smartscape_entity\n| sort event.start desc\n| limit 40`,40).catch(()=>[]):Row[];
  const snapshots=await dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${q(s(p['event.id']))}"\n| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id\n| sort timestamp asc\n| limit 80`,80).catch(()=>[]):Row[];
  return {problem:p,events,logs,history,snapshots};
}

async function ask(id:string,e:Evidence):Promise<string> {
  const p=e.problem;
  const evidence=JSON.stringify({
    problem:{id:s(p.display_id),title:s(p['event.name']),status:s(p['event.status']),severity:s(p['event.severity']),category:s(p['event.category']),start:s(p['event.start']),end:s(p['event.end']),duration:duration(s(p['event.start']),s(p['event.end'])),description:s(p['event.description']),rootCause:s(p['root_cause.smartscape_entity'])||s(p.root_cause_entity_id),impact:s(p['dt.davis.impact_level']),affectedUsers:s(p['dt.davis.affected_users_count'])},
    timeline:e.snapshots.slice(0,50),correlatedEvents:e.events.slice(0,70),incidentLogs:e.logs.slice(0,80),pastOccurrences:e.history.slice(0,30)
  }).slice(0,26000);
  const prompt=`Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. Analyze ONLY the retrieved evidence below. Do not claim lack of access and do not ask for telemetry already included. Separate observed facts from inference. Never invent metrics, timestamps, deployments, root causes, affected users, recurrence or remediation results. If unproven, say "Not proven by available evidence". Recommendations are proposals only.\n\nReturn exactly: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps.\n\nRETRIEVED DYNATRACE EVIDENCE:\n${evidence}`;
  const r=await publicClient.recommenderConversation({ body:{ text:prompt, context:[{type:'document-retrieval',value:'disabled'},{type:'supplementary',value:evidence},{type:'instruction',value:'Analyze the supplied evidence directly. Do not produce a generic access limitation response.'}], annotations:{origin:'Axis Davis Capacity Planner RCA',problemId:id} } }) as unknown as {text?:string;answer?:string;content?:string;status?:string};
  if(r.status==='FAILED') throw new Error('Dynatrace Assist RCA request failed. Check copilot permission and agentic AI availability.');
  const answer=s(r.text??r.answer??r.content).trim();
  if(!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

function printRca(r:RcaResult) {
  const p=r.evidence.problem;
  const w=window.open('','_blank','width=1000,height=900');
  if(!w) throw new Error('Allow pop-ups to print the RCA.');
  const events=r.evidence.events.slice(0,30).map(x=>`<tr><td>${esc(dt(s(x['event.start'])))}</td><td>${esc(s(x['event.name']))}</td><td>${esc(s(x['event.type']))}</td><td>${esc(s(x['dt.source_entity'])||s(x['dt.smartscape_source.id']))}</td><td>${esc(s(x['event.description']))}</td></tr>`).join('');
  const hist=r.evidence.history.slice(0,20).map(x=>`<tr><td>${esc(s(x.display_id))}</td><td>${esc(dt(s(x['event.start'])))}</td><td>${esc(s(x['event.status']))}</td><td>${esc(duration(s(x['event.start']),s(x['event.end'])))}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>Axis RCA ${esc(r.id)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:10.5px;line-height:1.5}h1{color:#173b70;margin:0;font-size:22px}h2{color:#173b70;font-size:14px;border-bottom:2px solid #d9e5f2;padding-bottom:4px;margin-top:20px}.hero{padding:18px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.card{padding:8px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.analysis{white-space:pre-wrap}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}.note{margin-top:18px;padding:9px;background:#fff8e8;border-left:4px solid #e4a11b}</style></head><body><div class="hero"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div style="font-size:9px;color:#65758a">Problem ${esc(r.id)} · Generated ${esc(new Date(r.generatedAt).toLocaleString())}</div><div class="grid"><div class="card"><div class="label">Status</div><div class="value">${esc(s(p['event.status']))}</div></div><div class="card"><div class="label">Severity</div><div class="value">Level ${esc(s(p['event.severity']))}</div></div><div class="card"><div class="label">Category</div><div class="value">${esc(s(p['event.category']))}</div></div><div class="card"><div class="label">Duration</div><div class="value">${esc(duration(s(p['event.start']),s(p['event.end'])))}</div></div></div></div><h2>Incident Overview</h2><p><b>Title:</b> ${esc(s(p['event.name']))}<br><b>Started:</b> ${esc(dt(s(p['event.start'])))}<br><b>Ended:</b> ${esc(dt(s(p['event.end'])))}<br><b>Root-cause entity:</b> ${esc(s(p['root_cause.smartscape_entity'])||s(p.root_cause_entity_id)||'Not identified')}<br><b>Affected users:</b> ${esc(s(p['dt.davis.affected_users_count'])||'Not available')}</p><h2>AI Root Cause Analysis</h2><div class="analysis">${esc(r.analysis)}</div><h2>Correlated Davis Events</h2><table><thead><tr><th>Start</th><th>Name</th><th>Type</th><th>Entity</th><th>Description</th></tr></thead><tbody>${events||'<tr><td colspan="5">No correlated events retrieved.</td></tr>'}</tbody></table><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${hist||'<tr><td colspan="4">No matching past occurrences retrieved.</td></tr>'}</tbody></table><div class="note"><b>RCA governance:</b> Facts come from retrieved Dynatrace evidence. Inferences and recommendations must not be treated as completed remediation.</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`);
  w.document.close();
}

function styles(){
  if(document.getElementById(`${ID}-style`))return;
  const x=document.createElement('style');x.id=`${ID}-style`;x.textContent=`#${ID}{margin:22px 0;border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.08);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#172334}.rca-head{padding:20px 24px;background:linear-gradient(135deg,#eef7ff,#fff)}.rca-head h2{margin:5px 0;font-size:23px}.rca-controls{display:flex;gap:10px;align-items:end;padding:15px 24px;border-block:1px solid #e2e8ef;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700}.rca-controls input{height:38px;width:250px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca-run,.rca-pdf{height:38px;border-radius:7px;padding:0 16px;font-weight:800;cursor:pointer}.rca-run{background:#174a7e;color:#fff;border:0}.rca-pdf{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca-status{padding:9px 24px;font-size:11px;color:#63758a}.rca-body{padding:0 24px 22px;max-height:760px;overflow:auto}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:10px 0 18px}.rca-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca-card strong{display:block;margin-top:3px;font-size:13px}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.55;color:#24364a}.rca-evidence{margin-top:18px;padding-top:15px;border-top:1px solid #e3e8ee}.rca-table{width:100%;border-collapse:collapse;font-size:10px}.rca-table th,.rca-table td{text-align:left;padding:7px;border-bottom:1px solid #e4e9ef}.rca-error{margin:10px 24px;padding:10px;background:#fff2f1;color:#a52b20;border-radius:7px;font-size:11px}`;document.head.appendChild(x);
}

export function installAiRootCauseRcaV3(){
  if(document.getElementById(ID))return;
  styles();
  const root=document.createElement('section');root.id=ID;
  root.innerHTML=`<div class="rca-head"><span style="font-size:10px;font-weight:800;letter-spacing:.14em;color:#1476d4">DYNATRACE DAVIS + ASSIST</span><h2>AI Root Cause & RCA</h2><p>Evidence-backed incident RCA from Davis problem data, correlated events, incident logs and recurrence history.</p></div><div class="rca-controls"><label>Problem ID<input class="rca-id" placeholder="e.g. P-2608125701" /></label><button class="rca-run">Analyze with Assist</button><button class="rca-pdf" disabled>Print RCA</button></div><div class="rca-status">Ready for a Davis Problem ID.</div><div class="rca-body"></div>`;
  const mount=()=>{if(document.getElementById(ID))return;const h=[...document.querySelectorAll('h1')].find(x=>x.textContent?.includes('Capacity at a glance'));const host=h?.closest('.content');if(host)host.parentElement?.insertBefore(root,host.nextSibling)};
  mount();new MutationObserver(mount).observe(document.body,{childList:true,subtree:true});
  const input=root.querySelector<HTMLInputElement>('.rca-id')!,run=root.querySelector<HTMLButtonElement>('.rca-run')!,pdf=root.querySelector<HTMLButtonElement>('.rca-pdf')!,status=root.querySelector<HTMLElement>('.rca-status')!,body=root.querySelector<HTMLElement>('.rca-body')!;
  let last:RcaResult|null=null;
  const render=(r:RcaResult)=>{const p=r.evidence.problem;body.innerHTML=`<div class="rca-summary"><div class="rca-card"><span>Problem</span><strong>${esc(r.id)}</strong></div><div class="rca-card"><span>Status</span><strong>${esc(s(p['event.status']))}</strong></div><div class="rca-card"><span>Severity</span><strong>Level ${esc(s(p['event.severity']))}</strong></div><div class="rca-card"><span>Category</span><strong>${esc(s(p['event.category'])||'—')}</strong></div><div class="rca-card"><span>Duration</span><strong>${esc(duration(s(p['event.start']),s(p['event.end'])))}</strong></div><div class="rca-card"><span>Past occurrences</span><strong>${r.evidence.history.length}</strong></div></div><div class="rca-analysis">${esc(r.analysis)}</div><p>Evidence: ${r.evidence.events.length} correlated events · ${r.evidence.logs.length} logs · ${r.evidence.snapshots.length} timeline snapshots.</p>`;};
  const analyze=async()=>{const id=input.value.trim().toUpperCase();if(!/^P-[A-Z0-9]+$/i.test(id)){status.textContent='Enter a valid Davis Problem ID.';return;}run.disabled=true;pdf.disabled=true;body.innerHTML='';status.textContent=`Collecting ${id} evidence…`;try{const e=await loadEvidence(id);status.textContent=`Evidence collected: ${e.events.length} events, ${e.logs.length} logs, ${e.history.length} matching occurrences. Asking Dynatrace Assist…`;const analysis=await ask(id,e);last={id,evidence:e,analysis,generatedAt:new Date().toISOString()};render(last);pdf.disabled=false;status.textContent='RCA generated with Dynatrace Assist.';}catch(err){last=null;body.innerHTML=`<div class="rca-error">${esc(err instanceof Error?err.message:String(err))}</div>`;status.textContent='RCA generation failed.';}finally{run.disabled=false;}};
  run.onclick=()=>void analyze();input.addEventListener('keydown',e=>{if(e.key==='Enter')void analyze();});pdf.onclick=()=>{if(last)printRca(last);};
}
