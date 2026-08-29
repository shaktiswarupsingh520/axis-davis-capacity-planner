import { jsPDF } from 'jspdf';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
type QueryResult = { records?: Array<Row | null> };
type RecommenderConversation = typeof publicClient.recommenderConversation;
type ConversationArgs = Parameters<RecommenderConversation>[0];

const PANEL_ID = 'axis-rca-v60';
const MARK = 'data-axis-rca-recovery-v63';

type RGB = readonly [number, number, number];
const C: Record<string, RGB> = {
  navy:[20,35,64], blue:[47,91,214], cyan:[0,128,160], green:[25,130,86], amber:[202,132,30], red:[190,55,55],
  ink:[32,43,60], muted:[96,109,128], border:[218,224,233], pale:[246,248,252], white:[255,255,255],
  softBlue:[235,241,255], softGreen:[232,247,239], softAmber:[255,247,227], softRed:[253,237,237]
};
const W=595,H=842,M=38,CW=W-M*2;

const asText=(v:unknown):string=>Array.isArray(v)?v.map(asText).filter(Boolean).join('; '):v==null?'':typeof v==='object'?JSON.stringify(v):String(v);
const esc=(v:string)=>v.replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]!));
const dqlEscape=(v:string)=>v.replace(/\\/g,'\\\\').replace(/\"/g,'\\\"');
const safe=(s:string)=>s.replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2022\u2713\u2717\u2192]/g,'-').replace(/[^\x20-\x7E]/g,' ');
const fmtDate=(v:unknown)=>{const s=asText(v);if(!s)return '-';const d=new Date(s);return Number.isNaN(d.getTime())?s:d.toLocaleString('en-IN',{year:'numeric',month:'short',day:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'UTC'})+' UTC';};
const durationMinutes=(a:unknown,b:unknown)=>{const x=new Date(asText(a)).getTime(),y=new Date(asText(b)).getTime();return Number.isFinite(x)&&Number.isFinite(y)&&y>=x?(y-x)/60000:null;};
const statusColor=(s:string):RGB=>/active|open/i.test(s)?C.red:/closed|resolved/i.test(s)?C.green:C.amber;
const lighten=(rgb:RGB,amount:number):RGB=>[Math.min(255,rgb[0]+amount),Math.min(255,rgb[1]+amount),Math.min(255,rgb[2]+amount)];

async function runDql(query:string,max=100):Promise<Row[]>{
  const started=await queryExecutionClient.queryExecute({body:{query,requestTimeoutMilliseconds:30000,maxResultRecords:max}});
  let result=started.result as QueryResult|undefined;
  let state=started.state;
  if(!result&&started.requestToken){
    for(let i=0;i<30;i+=1){
      const polled=await queryExecutionClient.queryPoll({requestToken:started.requestToken,requestTimeoutMilliseconds:30000});
      state=polled.state;
      result=polled.result as QueryResult|undefined;
      if(result||state!=='RUNNING')break;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
  }
  if(!result)throw new Error(`DQL failed to complete (state: ${state}).`);
  return(result.records??[]).filter(Boolean) as Row[];
}

function extractAssistText(value:unknown):string{
  if(typeof value==='string')return value.trim();
  if(!value||typeof value!=='object')return '';
  const v=value as Record<string,unknown>;
  for(const key of ['text','answer','content','message']){const candidate=extractAssistText(v[key]);if(candidate)return candidate;}
  return(Array.isArray(v.tokens)?v.tokens.map(asText).join(''):'').trim();
}

function text(doc:jsPDF,s:string,x:number,y:number,size=9,bold=false,color:RGB=C.ink){doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);doc.text(safe(s),x,y);}
function wrap(doc:jsPDF,s:string,x:number,y:number,w:number,size=9,lead=13){doc.setFont('helvetica','normal');doc.setFontSize(size);doc.setTextColor(...C.ink);const lines=doc.splitTextToSize(safe(s),w) as string[];doc.text(lines,x,y);return y+lines.length*lead;}
function rect(doc:jsPDF,x:number,y:number,w:number,h:number,fill:RGB=C.white,border:RGB=C.border,r=5){doc.setFillColor(...fill);doc.setDrawColor(...border);doc.roundedRect(x,y,w,h,r,r,'FD');}
function pageHeader(doc:jsPDF,title:string,kicker:string,page:number,total:number){doc.setFillColor(...C.navy);doc.rect(0,0,W,62,'F');text(doc,'AXIS BANK  |  ApMoSys TECHNOLOGIES',M,20,8,true,C.white);text(doc,title,M,43,18,true,C.white);text(doc,kicker,W-M,20,7,false,[218,226,240]);text(doc,`${page} / ${total}`,W-M,43,8,true,C.white);}
function footer(doc:jsPDF){doc.setDrawColor(...C.border);doc.line(M,H-32,W-M,H-32);text(doc,'Axis Davis Capacity Planner  |  AI-assisted incident RCA  |  Confidential',M,H-18,7,false,C.muted);text(doc,'Evidence-based analysis; recommendations require SRE/application validation.',W-M,H-18,6.5,false,C.muted);}
function section(doc:jsPDF,title:string,y:number,subtitle?:string){doc.setFillColor(...C.blue);doc.roundedRect(M,y,4,18,2,2,'F');text(doc,title,M+12,y+13,12,true,C.navy);if(subtitle)text(doc,subtitle,W-M,y+13,7,false,C.muted);return y+28;}
function pill(doc:jsPDF,label:string,value:string,x:number,y:number,w:number,fill:RGB,accent:RGB){rect(doc,x,y,w,50,fill,fill,7);text(doc,label.toUpperCase(),x+12,y+16,6.5,true,C.muted);text(doc,value,x+12,y+37,12,true,accent);}
function table(doc:jsPDF,x:number,y:number,widths:number[],headers:string[],rows:string[][],rowH=22){const total=widths.reduce((a,b)=>a+b,0);doc.setFillColor(...C.navy);doc.roundedRect(x,y,total,rowH,4,4,'F');let xx=x;headers.forEach((h,i)=>{text(doc,h,xx+6,y+14,7,true,C.white);xx+=widths[i];});let yy=y+rowH;rows.forEach((row,ri)=>{doc.setFillColor(...(ri%2?C.pale:C.white));doc.setDrawColor(...C.border);doc.rect(x,yy,total,rowH,'FD');xx=x;row.forEach((cell,i)=>{const lines=doc.splitTextToSize(safe(cell),Math.max(15,widths[i]-12)) as string[];text(doc,lines[0]||'',xx+6,yy+14,6.8,false,C.ink);if(lines[1])text(doc,lines[1],xx+6,yy+21,6.3,false,C.ink);xx+=widths[i];});yy+=rowH;});return yy;}
function bullet(doc:jsPDF,s:string,x:number,y:number,w:number,accent:RGB=C.blue){doc.setFillColor(...accent);doc.circle(x+3,y-3,2,'F');return wrap(doc,s,x+11,y,w-11,8.3,11)+3;}
function parseRca(answer:string){const blocks:{heading:string,body:string[]}[]=[];let current:{heading:string,body:string[]}|null=null;for(const raw of answer.split(/\r?\n/)){const line=raw.trim();if(!line)continue;const h=line.match(/^#{1,4}\s*(.+)$/);if(h){current={heading:safe(h[1]).replace(/\*\*(.*?)\*\*/g,'$1'),body:[]};blocks.push(current);continue;}if(!current){current={heading:'AI Assessment',body:[]};blocks.push(current);}current.body.push(safe(line.replace(/^[-*]\s+/,'').replace(/^\d+[.)]\s+/,'').replace(/^\[[ xX]\]\s*/,'')).replace(/\*\*(.*?)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1'));}return blocks;}

function createRcaPdf(problem:Row,problemId:string,answer:string,history:Row[],recurrenceCount:number){
  const doc=new jsPDF({unit:'pt',format:'a4',compress:true});
  const generated=new Date();
  const incident=asText(problem['event.name'])||'Dynatrace Davis Incident';
  const st=asText(problem['event.status'])||'UNKNOWN';
  const sev=asText(problem['event.severity'])||'-';
  const cat=asText(problem['event.category'])||'-';
  const root=asText(problem['root_cause.smartscape_entity'])||asText(problem.root_cause_entity_id)||'Not identified';
  const start=asText(problem['event.start']),end=asText(problem['event.end']);
  const mins=durationMinutes(start,end);
  const dur=mins===null?'Not available':mins<1?'<1 min':mins<60?`${mins.toFixed(1)} min`:`${(mins/60).toFixed(1)} hr`;
  const occ=recurrenceCount;
  const active=history.filter(x=>/active|open/i.test(asText(x['event.status']))).length;
  const closed=history.filter(x=>/closed|resolved/i.test(asText(x['event.status']))).length;
  const blocks=parseRca(answer);
  const totalPages=7;
  let y:number;

  doc.setFillColor(...C.navy);doc.rect(0,0,W,H,'F');doc.setFillColor(...C.blue);doc.rect(0,0,10,H,'F');
  text(doc,'AXIS BANK',M+10,58,12,true,C.white);text(doc,'ApMoSys TECHNOLOGIES',M+10,77,8,false,[190,205,228]);
  text(doc,'AI-ASSISTED',M+10,142,9,true,[128,177,255]);text(doc,'INCIDENT ROOT',M+10,171,27,true,C.white);text(doc,'CAUSE ANALYSIS',M+10,203,27,true,C.white);
  text(doc,problemId,M+10,242,13,true,[224,232,247]);y=wrap(doc,incident,M+10,275,450,15,21);doc.setDrawColor(255,255,255);doc.line(M+10,322,W-M,322);
  text(doc,'EXECUTIVE INCIDENT BRIEF',M+10,352,9,true,[128,177,255]);
  pill(doc,'Status',st,M+10,375,105,lighten(statusColor(st),50),statusColor(st));
  pill(doc,'Severity',`Level ${sev}`,M+125,375,105,[238,242,249],C.navy);pill(doc,'Duration',dur,M+240,375,105,[238,242,249],C.navy);pill(doc,'Recurrence',String(occ),M+355,375,105,[238,242,249],C.red);
  y=468;text(doc,'Incident window',M+10,y,7,true,[160,176,202]);y+=20;text(doc,fmtDate(start),M+10,y,10,true,C.white);text(doc,'to',M+210,y,8,false,[160,176,202]);text(doc,fmtDate(end),M+235,y,10,true,C.white);
  y+=44;text(doc,'Root-cause entity',M+10,y,7,true,[160,176,202]);y+=19;wrap(doc,root,M+10,y,470,10,14);
  text(doc,'Prepared by Axis Davis Capacity Planner',M+10,H-72,8,false,[160,176,202]);text(doc,`Generated ${generated.toLocaleString('en-IN')}`,M+10,H-52,8,false,[160,176,202]);text(doc,'CONFIDENTIAL',W-M,H-52,8,true,[160,176,202]);

  doc.addPage();pageHeader(doc,'Executive Decision View','Leadership summary',2,totalPages);y=92;y=section(doc,'Incident at a glance',y,'What leadership needs to know');
  pill(doc,'Problem ID',problemId,M,y,120,C.softBlue,C.blue);pill(doc,'Status',st,M+130,y,100,lighten(statusColor(st),55),statusColor(st));pill(doc,'Severity',`Level ${sev}`,M+240,y,105,C.softAmber,C.amber);pill(doc,'Category',cat,M+355,y,105,C.pale,C.navy);y+=65;
  rect(doc,M,y,CW,92,C.pale,C.border,7);text(doc,'PRIMARY FINDING',M+14,y+18,7,true,C.blue);y=wrap(doc,blocks.find(b=>/executive summary|summary/i.test(b.heading))?.body.join(' ')||`Davis identified ${incident} and the RCA was generated from the supplied Dynatrace evidence.`,M+14,y+39,CW-28,10,14)+8;y+=12;
  y=section(doc,'Impact & recurrence',y,'Observed operational risk');
  table(doc,M,y,[150,150,150],['Indicator','Observed','Leadership interpretation'],[['Incident duration',dur,'Time to recover / contain'],['Past occurrences',String(occ),occ>10?'High recurrence pressure':'Review recurrence trend'],['Active occurrences in detail sample',String(active),active>0?'Operational risk in latest occurrence sample':'No active occurrence in displayed sample'],['Closed occurrences in detail sample',String(closed),'Latest occurrence detail sample']],21);y+=120;
  y=section(doc,'Incident facts',y);table(doc,M,y,[145,350],['Attribute','Value'],[['Incident',incident],['Root-cause entity',root],['Started',fmtDate(start)],['Ended',fmtDate(end)],['Affected users',asText(problem['dt.davis.affected_users_count'])||'Not available'],['Impact level',asText(problem['dt.davis.impact_level'])||'Not available']],22);footer(doc);

  doc.addPage();pageHeader(doc,'Root Cause Assessment','Evidence and causal chain',3,totalPages);y=92;y=section(doc,'Root cause assessment',y,'Evidence-backed interpretation');const rca=blocks.find(b=>/root cause assessment/i.test(b.heading));
  rect(doc,M,y,CW,100,C.softBlue,C.softBlue,7);text(doc,'ASSESSMENT',M+14,y+18,7,true,C.blue);y=wrap(doc,rca?.body.slice(0,3).join(' ')||'The available evidence identifies a Dynatrace root-cause entity. Underlying trigger should be treated according to the confidence and evidence gaps stated by the AI assessment.',M+14,y+40,CW-28,9.2,13)+12;
  y=section(doc,'Technical root-cause chain',y,'From signal to service effect');const chain=blocks.find(b=>/technical root|causal chain/i.test(b.heading));const chainLines=chain?.body||[];
  if(chainLines.length)chainLines.slice(0,6).forEach((line,i)=>{rect(doc,M,y,CW,42,i%2?C.pale:C.white,C.border,6);text(doc,`${i+1}`,M+12,y+26,11,true,C.blue);wrap(doc,line,M+34,y+18,CW-48,8.3,11);y+=50;});else y=bullet(doc,'Review the causal chain in the AI assessment and validate each transition against telemetry, events and service-flow evidence.',M,y,CW);
  y+=8;y=section(doc,'Proven vs. not proven',y);const gaps=blocks.find(b=>/evidence gaps|not proven|confidence/i.test(b.heading));
  table(doc,M,y,[260,235],['Evidence classification','Interpretation'],[['Proven / high confidence',rca?.body[0]||'Davis problem and root-cause entity are identified.'],['Inference / validation required',gaps?.body[0]||'Underlying trigger should be validated.'],['Evidence gap',gaps?.body[1]||'Additional telemetry may be required.']],22);footer(doc);

  doc.addPage();pageHeader(doc,'Incident Timeline & Recurrence','Operational history',4,totalPages);y=92;y=section(doc,'Incident timeline',y,'Primary Davis problem window');
  [['Detection / problem start',fmtDate(start),'Davis problem opened'],['Recovery / problem end',fmtDate(end),'Davis problem closed'],['Duration',dur,'Calculated from supplied start/end']].forEach((e,i)=>{const cx=M+20,cy=y+25+i*62;doc.setFillColor(...C.blue);doc.circle(cx,cy,6,'F');if(i<2){doc.setDrawColor(...C.border);doc.line(cx,cy+7,cx,cy+56);}text(doc,e[0],M+42,cy-2,7,true,C.muted);text(doc,e[1],M+42,cy+16,9,true,C.ink);text(doc,e[2],M+280,cy+7,8,false,C.muted);});y+=200;
  y=section(doc,'Recurrence pattern',y,`${occ} past matching occurrence(s) found in the last 365 days`);
  table(doc,M,y,[82,90,118,125,70],['Problem ID','Started','Title','Impacted Entity','Status'],history.slice(0,10).map(x=>[asText(x.display_id)||'-',fmtDate(x['event.start']),asText(x['event.name'])||'-',asText(x['affected_entity_ids'])||'-',asText(x['event.status'])||'-']),21);footer(doc);

  doc.addPage();pageHeader(doc,'Remediation & Preventive Actions','Operational response plan',5,totalPages);y=92;y=section(doc,'Immediate stabilization',y,'Actions to contain current operational risk');
  const immediate=blocks.find(b=>/immediate remediation/i.test(b.heading));(immediate?.body||['Validate the current incident state and contain customer impact.','Confirm the root-cause entity and collect supporting telemetry.','Verify service recovery and absence of recurrence.']).slice(0,6).forEach(s=>{y=bullet(doc,s,M,y,CW,C.red);});
  y+=12;y=section(doc,'Permanent / preventive controls',y,'Reduce repeat incidents');const preventive=blocks.find(b=>/permanent|preventive/i.test(b.heading));(preventive?.body||['Implement durable monitoring and alerting around the confirmed failure condition.','Track recurrence and validate the effectiveness of the remediation.']).slice(0,7).forEach(s=>{y=bullet(doc,s,M,y,CW,C.green);});
  y+=12;y=section(doc,'Monitoring recommendations',y);const monitor=blocks.find(b=>/monitoring|alerting/i.test(b.heading));(monitor?.body||['Add targeted alerts for the affected signal and downstream service impact.','Review telemetry coverage for the incident window.']).slice(0,6).forEach(s=>{y=bullet(doc,s,M,y,CW,C.blue);});footer(doc);

  doc.addPage();pageHeader(doc,'Validation, Confidence & Governance','RCA quality controls',6,totalPages);y=92;y=section(doc,'Validation checklist',y,'Before closing the RCA');
  const validation=blocks.find(b=>/validation checklist/i.test(b.heading));(validation?.body||['Confirm root cause with independent telemetry evidence.','Validate corrective action in production-like conditions.','Confirm no recurrence after remediation.','Capture residual evidence gaps.']).slice(0,8).forEach(s=>{y=bullet(doc,s,M,y,CW,C.green);});
  y+=10;y=section(doc,'RCA confidence & evidence gaps',y);const confidence=blocks.find(b=>/confidence|evidence gaps/i.test(b.heading));
  rect(doc,M,y,CW,100,C.softAmber,C.softAmber,7);text(doc,'CONFIDENCE STATEMENT',M+14,y+18,7,true,C.amber);y=wrap(doc,confidence?.body.slice(0,3).join(' ')||'Confidence should reflect the strength of supplied Dynatrace evidence. Any unproven trigger must remain explicitly identified as an evidence gap.',M+14,y+40,CW-28,9.2,13)+16;
  y=section(doc,'Governance note',y);wrap(doc,'This report distinguishes observed Dynatrace evidence from AI-generated interpretation. Recommendations are proposed actions and require validation and ownership by the responsible SRE/application teams before being treated as completed remediation.',M,y,CW,8.7,12);footer(doc);

  doc.addPage();pageHeader(doc,'AI Assessment Appendix','Detailed AI-generated RCA',7,totalPages);y=92;const detail=blocks.length?blocks:[{heading:'AI Assessment',body:[answer]}];
  for(const block of detail){if(y>770){footer(doc);doc.addPage();pageHeader(doc,'AI Assessment Appendix','Continued',7,totalPages);y=92;}y=section(doc,block.heading,y);for(const line of block.body.slice(0,12)){if(y>785){footer(doc);doc.addPage();pageHeader(doc,'AI Assessment Appendix','Continued',7,totalPages);y=92;}y=bullet(doc,line,M,y,CW,C.blue);}y+=6;}
  footer(doc);
  doc.save(`Axis-CIO-RCA-${problemId}.pdf`);
}

async function analyze(problemId:string,status:HTMLElement,body:HTMLElement,pdf:HTMLButtonElement){
  const id=dqlEscape(problemId);status.textContent=`Collecting ${problemId}: Davis problem and recurrence evidence...`;body.innerHTML='';pdf.disabled=true;
  const problems=await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${id}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.impact_level,dt.davis.affected_users_count,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids\n| limit 1`,5);
  if(!problems.length)throw new Error(`Problem ${problemId} was not found in the last 365 days.`);
  const problem=problems[0];
  const name=asText(problem['event.name']);
  const selectedZone=Array.from(document.querySelectorAll<HTMLSelectElement>('.top-actions select'))[0]?.value||'All Management Zones';
  const zoneFilter=selectedZone!=='All Management Zones'?`\n| expand related_entity_names\n| lookup sourceField:related_entity_names, lookupField:entity.name,\n  [\n    fetch dt.entity.host\n    | expand managementZones\n    | filter managementZones == "${dqlEscape(selectedZone)}"\n    | fields entity.name\n  ], fields:{zoneHostName=entity.name}\n| filter isNotNull(zoneHostName)\n| dedup display_id`:'';
  const recurrenceRows=name?await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${dqlEscape(name)}" and display_id != "${id}"${zoneFilter}\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity,affected_entity_ids\n| sort event.start desc\n| limit 30`,30).catch(()=>[] as Row[]):[];
  const recurrenceCountRows=name?await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${dqlEscape(name)}" and display_id != "${id}"${zoneFilter}\n| summarize recurrence_count=count()`,1).catch(()=>[] as Row[]):[];
  const recurrenceCount=Number(asText(recurrenceCountRows[0]?.recurrence_count)||0);
  const evidence=JSON.stringify({problem:{id:asText(problem.display_id),title:name,status:asText(problem['event.status']),severity:asText(problem['event.severity']),category:asText(problem['event.category']),start:asText(problem['event.start']),end:asText(problem['event.end']),description:asText(problem['event.description']),rootCause:asText(problem['root_cause.smartscape_entity'])||asText(problem.root_cause_entity_id),impact:asText(problem['dt.davis.impact_level']),affectedUsers:asText(problem['dt.davis.affected_users_count'])},pastOccurrences:recurrenceRows,recurrenceCount,managementZone:selectedZone}).slice(0,12000);
  status.textContent=`Evidence collected (${recurrenceCount} past matching occurrences; ${recurrenceRows.length} detail rows loaded). Asking Dynatrace Assist...`;
  const prompt=`You are the senior Dynatrace SRE RCA analyst for the Axis Davis Capacity Planner. Analyze the supplied Davis Problem evidence and produce a customer-ready RCA. Use only supplied facts. Clearly distinguish proven root cause from inference. IMPORTANT: recurrenceCount is the authoritative total number of past matching occurrences in the last 365 days; pastOccurrences is only a recent detail sample. Do not use the number of detail rows as the recurrence count. The recurrence evidence is scoped to the selected Management Zone when a specific zone is selected. Do not claim lack of access. Include: Executive Summary, Incident Overview, Root Cause Assessment, Technical Root-Cause Chain, Past Occurrences & Recurrence Pattern, Immediate Remediation Plan, Permanent / Preventive Actions, Monitoring & Alerting Recommendations, Validation Checklist, RCA Confidence & Evidence Gaps.\n\nDYNATRACE EVIDENCE:\n${evidence}`;
  const args={body:{text:prompt,context:[{type:'document-retrieval',value:'disabled'},{type:'supplementary',value:evidence},{type:'instruction',value:'Treat supplementary context as authoritative incident evidence. Do not claim lack of access.'}]}} as ConversationArgs;
  const response=await publicClient.recommenderConversation(args);const answer=extractAssistText(response)||asText(response);if(!answer)throw new Error('Dynatrace Assist returned an empty response.');
  const occurrenceRows=recurrenceRows.map(x=>`<tr style="border-bottom:1px solid #e3e8ef;">
    <td style="padding:9px 8px;font-weight:700;color:#2f5bd6;white-space:nowrap;">${esc(asText(x.display_id)||'-')}</td>
    <td style="padding:9px 8px;white-space:nowrap;">${esc(fmtDate(x['event.start']))}</td>
    <td style="padding:9px 8px;min-width:220px;">${esc(asText(x['event.name'])||'-')}</td>
    <td style="padding:9px 8px;word-break:break-word;">${esc(asText(x['affected_entity_ids'])||'-')}</td>
    <td style="padding:9px 8px;white-space:nowrap;">${esc(asText(x['event.status'])||'-')}</td>
  </tr>`).join('');
  body.innerHTML=`
    <div class="rca60-grid">
      <div class="rca60-card"><span>Problem</span><strong>${esc(problemId)}</strong></div>
      <div class="rca60-card"><span>Status</span><strong>${esc(asText(problem['event.status'])||'-')}</strong></div>
      <div class="rca60-card"><span>Severity</span><strong>Level ${esc(asText(problem['event.severity'])||'-')}</strong></div>
      <div class="rca60-card"><span>Category</span><strong>${esc(asText(problem['event.category'])||'-')}</strong></div>
      <div class="rca60-card"><span>Past occurrences</span><button type="button" data-rca-occurrences style="margin-top:6px;border:1px solid #c9d7f4;background:#eef4ff;color:#2f5bd6;border-radius:8px;padding:5px 10px;font-size:16px;font-weight:800;cursor:pointer;">${recurrenceCount}</button></div>
    </div>
    <div data-rca-occurrence-panel style="display:none;margin-top:14px;border:1px solid #dbe2ec;border-radius:10px;background:#fff;overflow:auto;box-shadow:0 2px 8px rgba(20,35,64,.06);">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#f6f8fc;border-bottom:1px solid #dbe2ec;">
        <div><div style="font-size:12px;font-weight:800;color:#142340;text-transform:uppercase;letter-spacing:.04em;">Recurrence history</div><div style="font-size:11px;color:#68788f;margin-top:3px;">${recurrenceCount} past occurrence(s) found in ${esc(selectedZone)}; latest ${recurrenceRows.length} loaded for detail.</div></div>
        <button type="button" data-rca-occurrences-close style="border:0;background:transparent;color:#68788f;font-size:18px;cursor:pointer;">&times;</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:850px;">
        <thead><tr style="background:#142340;color:#fff;text-align:left;">
          <th style="padding:10px 8px;">Problem ID</th><th style="padding:10px 8px;">Timestamp</th><th style="padding:10px 8px;">Title</th><th style="padding:10px 8px;">Impacted Entity</th><th style="padding:10px 8px;">Status</th>
        </tr></thead>
        <tbody>${occurrenceRows||'<tr><td colspan="5" style="padding:18px;text-align:center;color:#68788f;">No past occurrence details were returned.</td></tr>'}</tbody>
      </table>
    </div>
    <div class="rca60-analysis">${esc(answer)}</div>`;
  const occurrenceButton=body.querySelector<HTMLButtonElement>('[data-rca-occurrences]');
  const occurrencePanel=body.querySelector<HTMLElement>('[data-rca-occurrence-panel]');
  const occurrenceClose=body.querySelector<HTMLButtonElement>('[data-rca-occurrences-close]');
  occurrenceButton?.addEventListener('click',()=>{if(occurrencePanel)occurrencePanel.style.display=occurrencePanel.style.display==='none'?'block':'none';});
  occurrenceClose?.addEventListener('click',()=>{if(occurrencePanel)occurrencePanel.style.display='none';});
  pdf.disabled=false;pdf.textContent='Download CIO-ready RCA PDF';pdf.onclick=()=>{try{createRcaPdf(problem,problemId,answer,recurrenceRows,recurrenceCount);status.textContent=`CIO-ready RCA PDF downloaded for ${problemId}.`;}catch(error){status.textContent=`PDF generation failed: ${error instanceof Error?error.message:String(error)}`;}};
  status.textContent='RCA generated successfully by the V63 recovery handler.';
}

export function installRcaButtonRecoveryV63(){
  const bind=()=>{const root=document.getElementById(PANEL_ID);if(!root)return;const run=root.querySelector<HTMLButtonElement>('.rca60-run');const input=root.querySelector<HTMLInputElement>('.rca60-id');const status=root.querySelector<HTMLElement>('.rca60-status');const body=root.querySelector<HTMLElement>('.rca60-body');const pdf=root.querySelector<HTMLButtonElement>('.rca60-pdf');if(!run||!input||!status||!body||!pdf||run.getAttribute(MARK)==='true')return;run.setAttribute(MARK,'true');run.onclick=async()=>{const id=input.value.trim().toUpperCase();if(!/^P-[A-Z0-9]+$/i.test(id)){status.textContent='Enter a valid Davis Problem ID.';input.focus();return;}run.disabled=true;try{await analyze(id,status,body,pdf);}catch(error){body.innerHTML=`<div class="rca60-error">${esc(error instanceof Error?error.message:String(error))}</div>`;status.textContent='RCA generation failed.';pdf.disabled=true;}finally{run.disabled=false;}};input.addEventListener('keydown',event=>{if(event.key==='Enter')run.click();});};
  bind();const observer=new MutationObserver(bind);observer.observe(document.body,{childList:true,subtree:true});window.setTimeout(bind,250);window.setTimeout(bind,1000);
}
