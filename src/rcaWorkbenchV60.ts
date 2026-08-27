import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }
interface Evidence { problem: Row; events: Row[]; snapshots: Row[]; history: Row[]; related: Row[]; logs: Row[]; deployments: Row[]; }
interface RcaResult { problemId: string; evidence: Evidence; analysis: string; generatedAt: string; }

const PANEL_ID = 'axis-rca-v60';
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
const text = (v: unknown): string => Array.isArray(v) ? v.map(text).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const dqlEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function dql(query: string, max = 200): Promise<Row[]> {
  const r = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = r.result as QueryResult | undefined;
  let state = r.state;
  const token = r.requestToken;
  for (let i = 0; !result && token && i < 30; i += 1) {
    const p = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = p.state;
    result = p.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(250);
  }
  if (!result) throw new Error(`DQL did not complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as Row[];
}

function duration(start: string, end: string) {
  const a = new Date(start).getTime();
  const b = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return '—';
  const m = Math.max(0, b - a) / 60000;
  return m < 60 ? `${m.toFixed(1)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`;
}

function date(v: string) { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString() : v || '—'; }

async function loadEvidence(problemId: string): Promise<Evidence> {
  const id = dqlEscape(problemId);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${id}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,event.kind,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,dt.analysis.ready,dt.duration_marker,resolved_problem_duration,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids,smartscape.affected_entities\n| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);
  const problem = rows[0];
  const ids = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(text).filter(Boolean) : [text(problem.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(ids)].slice(0, 100).map(x => `"${dqlEscape(x)}"`).join(', ');
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 100).map(x => `"${dqlEscape(x)}"`).join(', ');
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();
  const eventQuery = eventList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter in(event.id,array(${eventList}))\n| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,event.provider,dt.source_entity,dt.smartscape_source.id,dt.query,dt.davis.is_rootcause_relevant\n| sort event.start asc\n| limit 120`, 120).catch(() => []) : Promise.resolve([] as Row[]);
  const snapshots = dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()\n| filter event.id == "${dqlEscape(text(problem['event.id']))}"\n| fields timestamp,event.id,event.status,event.status_transition,event.severity,event.name,event.start,event.end,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids\n| sort timestamp asc\n| limit 120`, 120).catch(() => []);
  const history = dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${dqlEscape(text(problem['event.name']))}"\n| fields display_id,event.name,event.status,event.severity,event.category,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity,root_cause_entity_id,dt.davis.affected_users_count\n| sort event.start desc\n| limit 50`, 50).catch(() => []);
  const related = entityList ? dql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate)\n| expand affected_entity_ids\n| filter in(affected_entity_ids,array(${entityList}))\n| fields display_id,event.name,event.status,event.severity,event.category,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity,affected_entity_ids\n| sort event.start desc\n| limit 50`, 50).catch(() => []) : Promise.resolve([] as Row[]);
  const logs = entityList ? dql(`fetch logs, from:now()-365d, to:now()\n| filter timestamp >= toTimestamp("${dqlEscape(start)}") - 30m and timestamp <= toTimestamp("${dqlEscape(end)}") + 30m\n| filter in(dt.source_entity,array(${entityList}))\n| fields timestamp,dt.source_entity,status,severity,content,message\n| sort timestamp asc\n| limit 120`, 120).catch(() => []) : Promise.resolve([] as Row[]);
  const deployments = entityList ? dql(`fetch dt.davis.events, from:now()-365d, to:now()\n| filter event.type == "CUSTOM_DEPLOYMENT"\n| filter event.start >= toTimestamp("${dqlEscape(start)}") - 2h and event.start <= toTimestamp("${dqlEscape(end)}") + 2h\n| filter in(dt.source_entity,array(${entityList}))\n| fields event.id,event.name,event.type,event.start,event.end,event.description,event.provider,dt.source_entity,dt.smartscape_source.id\n| sort event.start asc\n| limit 50`, 50).catch(() => []) : Promise.resolve([] as Row[]);
  const [events, snapshotRows, historyRows, relatedRows, logRows, deploymentRows] = await Promise.all([eventQuery, snapshots, history, related, logs, deployments]);
  return { problem, events, snapshots: snapshotRows, history: historyRows, related: relatedRows, logs: logRows, deployments: deploymentRows };
}

async function askAssist(problemId: string, e: Evidence): Promise<string> {
  const p = e.problem;
  const evidence = JSON.stringify({
    problem: {
      id: text(p.display_id), title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']),
      start: text(p['event.start']), end: text(p['event.end']), duration: duration(text(p['event.start']), text(p['event.end'])), description: text(p['event.description']),
      rootCause: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id), impact: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count']),
      analysisReady: text(p['dt.analysis.ready']), eventIds: text(p['dt.davis.event_ids']), affectedEntityIds: text(p.affected_entity_ids)
    },
    timeline: e.snapshots.slice(0, 60), correlatedEvents: e.events.slice(0, 90), pastOccurrences: e.history.slice(0, 35), relatedProblems: e.related.slice(0, 35),
    incidentLogs: e.logs.slice(0, 100), nearbyDeployments: e.deployments.slice(0, 40)
  }).slice(0, 45000);
  const prompt = `You are the senior Dynatrace SRE RCA analyst embedded in the Axis Davis Capacity Planner. Generate a customer-ready root-cause analysis for Davis Problem ${problemId}. The application has already retrieved the Dynatrace evidence below. Analyze that evidence directly; do not tell the user to open Problems, do not claim that you lack access, and do not ask for telemetry that is already supplied.\n\nSTRICT EVIDENCE RULES:\n- Observed facts must come only from the supplied evidence.\n- Clearly label inference/probable cause versus proven root cause.\n- Never invent deployments, metrics, timestamps, affected users, recurrence, remediation results or service names.\n- If the root cause is not proven, state: Not proven by available evidence.\n- Recommendations are proposals, not completed actions.\n- Use the actual problem start/end and duration.\n- Use pastOccurrences/relatedProblems for recurrence analysis.\n- Use nearbyDeployments only when a deployment is actually present in the evidence.\n\nReturn a polished RCA with exactly these sections:\n1. Executive Summary\n2. Incident Overview\n3. Root Cause Assessment\n4. Technical Root-Cause Chain\n5. Incident Timeline\n6. Past Occurrences & Recurrence Pattern\n7. Impact Assessment\n8. Deployment / Change Correlation\n9. Immediate Remediation Plan\n10. Permanent / Preventive Actions\n11. Monitoring & Alerting Recommendations\n12. Validation Checklist\n13. RCA Confidence & Evidence Gaps\n\nFor Root Cause Assessment include confidence (High/Medium/Low) and cite the evidence type/entity that supports the conclusion. For the timeline, explain the sequence from first relevant signal to problem resolution. For recommendations, prioritize actionable L3/SRE steps.\n\nRETRIEVED DYNATRACE EVIDENCE:\n${evidence}`;
  const response = await publicClient.recommenderConversation({ body: {
    text: prompt,
    context: [
      { type: 'document-retrieval', value: 'disabled' },
      { type: 'supplementary', value: evidence },
      { type: 'instruction', value: 'Treat supplementary context as authoritative incident evidence. Analyze it directly. Never respond with a generic access limitation message.' }
    ],
    annotations: { origin: 'Axis Davis Capacity Planner RCA V60', problemId }
  } });
  const r = response as unknown as { status?: string; text?: string; answer?: string; content?: string };
  if (r.status === 'FAILED') throw new Error('Dynatrace Assist RCA request failed. Verify davis-copilot:conversations:execute and agentic AI availability.');
  const answer = text(r.text ?? r.answer ?? r.content).trim();
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

function styles() {
  if (document.getElementById(`${PANEL_ID}-style`)) return;
  const s = document.createElement('style'); s.id = `${PANEL_ID}-style`;
  s.textContent = `#${PANEL_ID}{margin:18px 0;border:1px solid #d8e3ee;border-radius:15px;background:#fff;box-shadow:0 10px 34px rgba(20,45,75,.09);overflow:hidden;color:#172334}.dark #${PANEL_ID}{background:#172235;border-color:#33465f;color:#e5edf8}.rca60-head{padding:20px 24px;background:linear-gradient(135deg,#edf7ff,#fff)}.dark .rca60-head{background:linear-gradient(135deg,#182f4a,#172235)}.rca60-head h2{margin:5px 0;font-size:23px}.rca60-head p{margin:0;color:#64758a;font-size:12px}.rca60-controls{display:flex;gap:10px;align-items:end;padding:15px 24px;border-block:1px solid #e2e8ef;background:#f7f9fb}.rca60-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:800}.rca60-controls input{height:38px;width:250px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca60-run,.rca60-pdf{height:38px;border-radius:7px;padding:0 16px;font-weight:800;cursor:pointer}.rca60-run{background:#174a7e;color:#fff;border:0}.rca60-pdf{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca60-run:disabled,.rca60-pdf:disabled{opacity:.45}.rca60-status{padding:9px 24px;font-size:11px;color:#63758a}.rca60-body{padding:0 24px 24px;max-height:760px;overflow:auto}.rca60-grid{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:12px 0 18px}.rca60-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca60-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca60-card strong{display:block;margin-top:3px;font-size:13px}.rca60-analysis{white-space:pre-wrap;font-size:12px;line-height:1.6;color:#24364a}.dark .rca60-analysis{color:#e5edf8}.rca60-evidence{margin-top:18px;padding-top:15px;border-top:1px solid #e3e8ee}.rca60-table{width:100%;border-collapse:collapse;font-size:10px}.rca60-table th,.rca60-table td{text-align:left;padding:7px;border-bottom:1px solid #e4e9ef;vertical-align:top}.rca60-table th{background:#eef4f9}.rca60-error{margin:12px 0;padding:11px;background:#fff2f1;color:#a52b20;border-radius:7px;font-size:11px}@media(max-width:900px){.rca60-grid{grid-template-columns:repeat(2,1fr)}.rca60-controls{flex-wrap:wrap}}`;
  document.head.appendChild(s);
}

function renderResult(root: HTMLElement, r: RcaResult) {
  const p = r.evidence.problem;
  const rows = r.evidence.history.slice(0, 15).map(x => `<tr><td>${esc(text(x.display_id))}</td><td>${esc(date(text(x['event.start'])))}</td><td>${esc(text(x['event.status']))}</td><td>${esc(duration(text(x['event.start']),text(x['event.end'])))}</td><td>${esc(text(x['root_cause.smartscape_entity']))}</td></tr>`).join('');
  const deps = r.evidence.deployments.slice(0, 15).map(x => `<tr><td>${esc(date(text(x['event.start'])))}</td><td>${esc(text(x['event.name']))}</td><td>${esc(text(x['dt.source_entity']) || text(x['dt.smartscape_source.id']))}</td><td>${esc(text(x['event.description']))}</td></tr>`).join('');
  root.querySelector<HTMLElement>('.rca60-body')!.innerHTML = `<div class="rca60-grid"><div class="rca60-card"><span>Problem</span><strong>${esc(r.problemId)}</strong></div><div class="rca60-card"><span>Status</span><strong>${esc(text(p['event.status']))}</strong></div><div class="rca60-card"><span>Severity</span><strong>Level ${esc(text(p['event.severity']))}</strong></div><div class="rca60-card"><span>Category</span><strong>${esc(text(p['event.category']) || '—')}</strong></div><div class="rca60-card"><span>Duration</span><strong>${esc(duration(text(p['event.start']),text(p['event.end'])))}</strong></div><div class="rca60-card"><span>Past occurrences</span><strong>${r.evidence.history.length}</strong></div></div><div class="rca60-analysis">${esc(r.analysis)}</div><div class="rca60-evidence"><h3>Evidence collected</h3><p>${r.evidence.events.length} Davis events · ${r.evidence.snapshots.length} problem snapshots · ${r.evidence.logs.length} logs · ${r.evidence.history.length} same-name occurrences · ${r.evidence.related.length} related problems · ${r.evidence.deployments.length} nearby deployments.</p><h3>Past occurrences</h3><table class="rca60-table"><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th><th>Root cause</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No matching past occurrences found.</td></tr>'}</tbody></table><h3>Deployment / change evidence</h3><table class="rca60-table"><thead><tr><th>Start</th><th>Name</th><th>Entity</th><th>Description</th></tr></thead><tbody>${deps || '<tr><td colspan="4">No CUSTOM_DEPLOYMENT event was found in the incident window.</td></tr>'}</tbody></table></div>`;
}

function printRca(r: RcaResult) {
  const p = r.evidence.problem;
  const w = window.open('', '_blank', 'width=1000,height=900');
  if (!w) throw new Error('Allow pop-ups to print the RCA PDF.');
  const hist = r.evidence.history.slice(0, 20).map(x => `<tr><td>${esc(text(x.display_id))}</td><td>${esc(date(text(x['event.start'])))}</td><td>${esc(text(x['event.status']))}</td><td>${esc(duration(text(x['event.start']),text(x['event.end'])))}</td></tr>`).join('');
  w.document.write(`<!doctype html><html><head><title>Axis RCA ${esc(r.problemId)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:10.5px;line-height:1.5}h1{color:#173b70;font-size:22px;margin:0}h2{color:#173b70;font-size:14px;border-bottom:2px solid #d9e5f2;padding-bottom:4px;margin-top:20px}.hero{padding:18px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.card{padding:8px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.analysis{white-space:pre-wrap}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}.note{margin-top:18px;padding:9px;background:#fff8e8;border-left:4px solid #e4a11b}</style></head><body><div class="hero"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div style="font-size:9px;color:#65758a">Problem ${esc(r.problemId)} · Generated ${esc(new Date(r.generatedAt).toLocaleString())}</div><div class="grid"><div class="card"><div class="label">Status</div><div class="value">${esc(text(p['event.status']))}</div></div><div class="card"><div class="label">Severity</div><div class="value">Level ${esc(text(p['event.severity']))}</div></div><div class="card"><div class="label">Category</div><div class="value">${esc(text(p['event.category']))}</div></div><div class="card"><div class="label">Duration</div><div class="value">${esc(duration(text(p['event.start']),text(p['event.end'])))}</div></div></div></div><h2>Incident Overview</h2><p><b>Title:</b> ${esc(text(p['event.name']))}<br><b>Started:</b> ${esc(date(text(p['event.start'])))}<br><b>Ended:</b> ${esc(date(text(p['event.end'])))}<br><b>Root cause:</b> ${esc(text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id) || 'Not identified')}<br><b>Affected users:</b> ${esc(text(p['dt.davis.affected_users_count']) || 'Not available')}</p><h2>AI Root Cause Analysis</h2><div class="analysis">${esc(r.analysis)}</div><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${hist || '<tr><td colspan="4">No matching past occurrences found.</td></tr>'}</tbody></table><div class="note"><b>RCA governance:</b> Dynatrace evidence is separated from AI inference. Recommendations are proposed actions and should be validated by the responsible SRE/application team.</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`);
  w.document.close();
}

function mountPanel() {
  if (document.getElementById(PANEL_ID)) return document.getElementById(PANEL_ID)!;
  const host = document.querySelector<HTMLElement>('.content') || document.querySelector<HTMLElement>('main') || document.body;
  const root = document.createElement('section'); root.id = PANEL_ID;
  root.innerHTML = `<div class="rca60-head"><span style="font-size:10px;font-weight:800;letter-spacing:.14em;color:#1476d4">DYNATRACE DAVIS + ASSIST</span><h2>AI Root Cause & RCA</h2><p>Enter a Davis Problem ID. The app retrieves problem details, causal events, timeline snapshots, logs, recurrence and nearby deployment evidence before asking Dynatrace Assist to produce the RCA.</p></div><div class="rca60-controls"><label>Problem ID<input class="rca60-id" placeholder="e.g. P-2608125701" /></label><button class="rca60-run">Analyze with Assist</button><button class="rca60-pdf" disabled>Print RCA PDF</button></div><div class="rca60-status">Ready for a Davis Problem ID.</div><div class="rca60-body"></div>`;
  host.prepend(root); return root;
}

export function installRcaWorkbenchV60() {
  styles();
  const open = () => {
    const root = mountPanel();
    root.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const intercept = (event: Event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest<HTMLElement>('.axis-usecase-btn');
    if (!button || !/RCA analysis with Davis/i.test(button.textContent || '')) return;
    event.preventDefault(); event.stopImmediatePropagation(); open();
  };
  document.addEventListener('click', intercept, true);
  const observer = new MutationObserver(() => {
    const button = [...document.querySelectorAll<HTMLElement>('.axis-usecase-btn')].find(x => /RCA analysis with Davis/i.test(x.textContent || ''));
    if (button) button.setAttribute('data-rca-v60','true');
  });
  observer.observe(document.body, { childList: true, subtree: true });
  if (document.querySelector('.axis-usecase-btn')) return;
  setTimeout(() => { const b = [...document.querySelectorAll<HTMLElement>('.axis-usecase-btn')].find(x => /RCA analysis with Davis/i.test(x.textContent || '')); if (b) b.setAttribute('data-rca-v60','true'); }, 500);

  const root = mountPanel();
  root.style.display = 'none';
  const input = root.querySelector<HTMLInputElement>('.rca60-id')!;
  const run = root.querySelector<HTMLButtonElement>('.rca60-run')!;
  const pdf = root.querySelector<HTMLButtonElement>('.rca60-pdf')!;
  const status = root.querySelector<HTMLElement>('.rca60-status')!;
  let last: RcaResult | null = null;
  const analyze = async () => {
    const id = input.value.trim().toUpperCase();
    if (!/^P-[A-Z0-9]+$/i.test(id)) { status.textContent = 'Enter a valid Davis Problem ID.'; return; }
    run.disabled = true; pdf.disabled = true; root.querySelector<HTMLElement>('.rca60-body')!.innerHTML = '';
    status.textContent = `Collecting ${id}: Davis problem, causal events, timeline, logs, recurrence and deployments…`;
    try {
      const evidence = await loadEvidence(id);
      status.textContent = `Evidence collected (${evidence.events.length} events, ${evidence.logs.length} logs, ${evidence.history.length} past occurrences, ${evidence.deployments.length} deployments). Asking Dynatrace Assist…`;
      const analysis = await askAssist(id, evidence);
      last = { problemId:id, evidence, analysis, generatedAt:new Date().toISOString() };
      renderResult(root, last); pdf.disabled = false; status.textContent = 'RCA generated from retrieved Dynatrace evidence with Dynatrace Assist.';
    } catch (error) {
      last = null; root.querySelector<HTMLElement>('.rca60-body')!.innerHTML = `<div class="rca60-error">${esc(error instanceof Error ? error.message : String(error))}</div>`; status.textContent = 'RCA generation failed.';
    } finally { run.disabled = false; }
  };
  run.onclick = () => void analyze(); input.addEventListener('keydown', e => { if (e.key === 'Enter') void analyze(); }); pdf.onclick = () => { if (last) printRca(last); };
}
