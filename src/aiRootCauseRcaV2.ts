import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }
const ID = 'axis-ai-root-cause-rca-v2';
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const escDql = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const text = (v: unknown): string => Array.isArray(v) ? v.map(text).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function dql(query: string, max = 300): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result as QueryResult | undefined;
  let state = response.state;
  const token = response.requestToken;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(250);
  }
  if (!result) throw new Error(`DQL did not complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as Row[];
}

function duration(start: string, end: string) {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return '—';
  const minutes = Math.max(0, e - s) / 60000;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} d`;
}

function formatDate(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : value;
}

function unique(values: string[]) { return [...new Set(values.filter(Boolean))]; }
function affectedIds(problem: Row) {
  return Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(text).filter(Boolean) : [text(problem.affected_entity_ids)].filter(Boolean);
}

export interface RcaEvidence {
  problem: Row;
  affectedEntities: Row[];
  snapshots: Row[];
  events: Row[];
  logs: Row[];
  historical: Row[];
  relatedProblems: Row[];
}

export interface RcaResult {
  problemId: string;
  evidence: RcaEvidence;
  analysis: string;
  generatedAt: string;
}

async function loadEvidence(problemId: string): Promise<RcaEvidence> {
  const id = escDql(problemId);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| filter display_id == "${id}"
| fields display_id, event.id, event.name, event.status, event.severity, event.category, event.start, event.end, event.description, event.kind, dt.davis.event_ids, root_cause_entity_id, root_cause.smartscape_entity, dt.analysis.ready, dt.duration_marker, resolved_problem_duration, dt.davis.impact_level, dt.davis.affected_users_count, affected_entity_ids, smartscape.affected_entities, smartscape.related_entities
| sort event.start desc
| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);
  const problem = rows[0];
  const affected = affectedIds(problem);
  const entityList = unique(affected).slice(0, 100).map((x) => `"${escDql(x)}"`).join(', ');
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(text).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 100).map((x) => `"${escDql(x)}"`).join(', ');
  const eventName = text(problem['event.name']);
  const start = text(problem['event.start']);
  const end = text(problem['event.end']) || new Date().toISOString();

  const entities = entityList ? await dql(`fetch dt.davis.problems
| filter display_id == "${id}"
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields affected_entity_ids, entityName=entityName(affected_entity_ids)
| dedup affected_entity_ids
| limit 100`, 100).catch(() => []) : [];

  const snapshots = await dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()
| filter event.id == "${escDql(text(problem['event.id']))}"
| fields timestamp, event.id, event.status, event.status_transition, event.severity, event.name, affected_entity_ids, root_cause_entity_id, root_cause.smartscape_entity
| sort timestamp asc
| limit 100`, 100).catch(() => []);

  const events = eventList ? await dql(`fetch dt.davis.events, from:now()-365d, to:now()
| filter in(event.id, array(${eventList}))
| fields event.id, event.name, event.type, event.status, event.severity, event.category, event.start, event.end, event.description, dt.source_entity, dt.smartscape_source.id, dt.smartscape_source.type, dt.query, dt.davis.impact_level, dt.davis.is_rootcause_relevant
| sort event.start asc
| limit 100`, 100).catch(() => []) : [];

  const logs = entityList ? await dql(`fetch logs, from:now()-365d, to:now()
| filter timestamp >= toTimestamp("${escDql(start)}") - 15m and timestamp <= toTimestamp("${escDql(end)}") + 15m
| filter dt.source_entity in [${entityList}]
| fields timestamp, dt.source_entity, status, severity, log.source, content, message
| sort timestamp asc
| limit 120`, 120).catch(() => []) : [];

  const historical = eventName ? await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| filter event.name == "${escDql(eventName)}"
| fields display_id, event.name, event.status, event.severity, event.start, event.end, event.category, resolved_problem_duration, root_cause_entity_id, root_cause.smartscape_entity, affected_entity_ids
| sort event.start desc
| limit 50`, 50).catch(() => []) : [];

  const relatedProblems = entityList ? await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields display_id, event.name, event.status, event.severity, event.start, event.end, event.category, resolved_problem_duration, root_cause_entity_id, root_cause.smartscape_entity, affected_entity_ids
| sort event.start desc
| limit 50`, 50).catch(() => []) : [];

  return { problem, affectedEntities: entities, snapshots, events, logs, historical, relatedProblems };
}

function compactEvidence(e: RcaEvidence) {
  const p = e.problem;
  return {
    problem: {
      id: text(p.display_id), title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']),
      start: text(p['event.start']), end: text(p['event.end']), duration: duration(text(p['event.start']), text(p['event.end'])),
      description: text(p['event.description']), rootCauseEntity: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id),
      analysisReady: text(p['dt.analysis.ready']), impactLevel: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count']), affectedEntityIds: affectedIds(p),
    },
    affectedEntities: e.affectedEntities.slice(0, 50),
    timeline: e.snapshots.slice(0, 60),
    correlatedEvents: e.events.slice(0, 80),
    incidentLogs: e.logs.slice(0, 100),
    sameProblemTypePastYear: e.historical.slice(0, 30),
    relatedEntityProblemsPastYear: e.relatedProblems.slice(0, 30),
  };
}

const isRefusal = (answer: string) => /i (can't|cannot|do not|don't) (perform|have access|access)|missing critical data|i need .*data|no incident details/i.test(answer);

async function askAssist(problemId: string, evidence: RcaEvidence): Promise<string> {
  const payload = JSON.stringify(compactEvidence(evidence)).slice(0, 24000);
  const prompt = `Act as the Dynatrace Assist incident-investigation analyst for an enterprise SRE team. Generate a detailed, evidence-based RCA for Davis Problem ${problemId}.

You have been given the application's retrieved Dynatrace evidence below. Treat it as the source of truth for this investigation. Do NOT say that you lack access to the live environment, do NOT tell the user to open the Problems app, and do NOT ask for telemetry that is already present below. If some evidence is absent, say "Not available in retrieved evidence" and continue the RCA using what is present.

CRITICAL: Separate OBSERVED FACTS from INFERENCES. Never invent a metric, timestamp, deployment, root cause, affected-user count, previous occurrence, or remediation result. A recommendation is a proposal, not evidence that an action was completed. Use the Davis root-cause entity and correlated events when available. Use logs only when they contain useful incident evidence.

Return exactly these sections:
1. Executive Summary
2. Incident Overview
3. Root Cause Assessment
4. Technical Root-Cause Chain
5. Incident Timeline
6. Past Occurrences & Recurrence Pattern
7. Impact Assessment
8. Immediate Remediation Plan
9. Permanent / Preventive Actions
10. Monitoring & Alerting Recommendations
11. Validation Checklist
12. RCA Confidence & Evidence Gaps

For Root Cause Assessment, give the leading cause, confidence (High/Medium/Low), supporting evidence, and what would disprove it. For the timeline, use actual timestamps from the evidence. For past occurrences, identify recurrence count, recent examples, and whether the pattern is recurring or isolated. Keep the output detailed enough for an L3/SRE/customer RCA but concise enough to print into a formal document.

RETRIEVED DYNATRACE EVIDENCE:
${payload}`;

  const request = {
    acceptType: 'application/json' as const,
    body: {
      text: prompt,
      context: [
        { type: 'document-retrieval' as const, value: 'disabled' },
        { type: 'supplementary' as const, value: payload },
        { type: 'instruction' as const, value: 'Analyze the supplied incident evidence directly. Do not respond with a generic limitation message. Do not invent missing facts.' },
      ],
      annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId },
    },
  };

  const first = await publicClient.recommenderConversation(request);
  const r1 = first as unknown as { status?: string; text?: string; answer?: string; content?: string };
  if (r1.status === 'FAILED') throw new Error('Dynatrace Assist could not complete the RCA investigation.');
  let answer = String(r1.text ?? r1.answer ?? r1.content ?? '').trim();
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');

  if (isRefusal(answer)) {
    const retry = await publicClient.recommenderConversation({
      acceptType: 'application/json',
      body: {
        text: `Produce the RCA now from the evidence embedded in this message. This is not a request for live access. Do not discuss limitations. Do not ask for more data. Problem: ${problemId}.\n\nEVIDENCE:\n${payload}\n\nReturn Executive Summary, Incident Overview, Root Cause Assessment, Technical Root-Cause Chain, Incident Timeline, Past Occurrences & Recurrence Pattern, Impact Assessment, Immediate Remediation Plan, Permanent / Preventive Actions, Monitoring & Alerting Recommendations, Validation Checklist, and RCA Confidence & Evidence Gaps. Clearly mark unproven conclusions.`,
        context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'instruction', value: 'The evidence is already present in the user message. Analyze it directly.' }],
        annotations: { origin: 'Axis Davis Capacity Planner RCA Retry', problemId },
      },
    });
    const r2 = retry as unknown as { status?: string; text?: string; answer?: string; content?: string };
    if (r2.status !== 'FAILED') answer = String(r2.text ?? r2.answer ?? r2.content ?? '').trim() || answer;
  }
  return answer;
}

function printRca(result: RcaResult) {
  const p = result.evidence.problem;
  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) throw new Error('Please allow pop-ups to print the RCA PDF.');
  const history = result.evidence.historical.slice(0, 20).map((r) => `<tr><td>${esc(text(r.display_id))}</td><td>${esc(formatDate(text(r['event.start'])))}</td><td>${esc(text(r['event.status']))}</td><td>${esc(duration(text(r['event.start']), text(r['event.end'])))}</td></tr>`).join('');
  const events = result.evidence.events.slice(0, 30).map((r) => `<tr><td>${esc(formatDate(text(r['event.start'])))}</td><td>${esc(text(r['event.name']))}</td><td>${esc(text(r['event.type']))}</td><td>${esc(text(r.dt.source_entity || r['dt.smartscape_source.id']))}</td><td>${esc(text(r['event.description']))}</td></tr>`).join('');
  win.document.write(`<!doctype html><html><head><title>Axis RCA ${esc(result.problemId)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:11px;line-height:1.5}h1{font-size:22px;margin:0;color:#173b70}h2{font-size:14px;color:#173b70;border-bottom:2px solid #d9e5f2;padding-bottom:5px;margin-top:20px}.banner{border:1px solid #d5e1ee;border-radius:10px;padding:18px;background:#f5f9fd;margin-bottom:16px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.card{border:1px solid #dce5ee;border-radius:7px;padding:9px;background:#fff}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700;margin-top:3px}.analysis{white-space:pre-wrap}.notice{padding:9px;background:#fff8e8;border-left:4px solid #e4a11b}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9;color:#47627c}.footer{margin-top:22px;border-top:1px solid #dce5ee;padding-top:8px;font-size:8px;color:#718197}</style></head><body><div class="banner"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div style="font-size:9px;color:#65758a">Problem ${esc(result.problemId)} · Generated ${esc(new Date(result.generatedAt).toLocaleString())}</div></div><div class="grid"><div class="card"><div class="label">Status</div><div class="value">${esc(text(p['event.status']))}</div></div><div class="card"><div class="label">Severity</div><div class="value">Level ${esc(text(p['event.severity']))}</div></div><div class="card"><div class="label">Category</div><div class="value">${esc(text(p['event.category']))}</div></div><div class="card"><div class="label">Duration</div><div class="value">${esc(duration(text(p['event.start']), text(p['event.end'])))}</div></div></div><h2>Incident Overview</h2><p><b>Title:</b> ${esc(text(p['event.name']))}<br><b>Started:</b> ${esc(formatDate(text(p['event.start'])))}<br><b>Ended:</b> ${esc(formatDate(text(p['event.end'])))}<br><b>Davis root-cause entity:</b> ${esc(text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id) || 'Not identified')}<br><b>Affected users:</b> ${esc(text(p['dt.davis.affected_users_count']) || 'Not available')}</p><h2>AI RCA</h2><div class="analysis">${esc(result.analysis)}</div><h2>Correlated Davis Events</h2><table><thead><tr><th>Start</th><th>Name</th><th>Type</th><th>Entity</th><th>Description</th></tr></thead><tbody>${events || '<tr><td colspan="5">No correlated event records retrieved.</td></tr>'}</tbody></table><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${history || '<tr><td colspan="4">No matching historical occurrences retrieved.</td></tr>'}</tbody></table><div class="notice"><b>RCA governance:</b> Conclusions are based on retrieved Dynatrace evidence and Assist synthesis. Any unproven cause is explicitly marked as such; recommendations are proposed actions, not evidence of completed remediation.</div><div class="footer">Axis Davis Capacity Planner · Dynatrace Assist RCA · ${esc(result.problemId)}</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`);
  win.document.close();
}

function installStyles() {
  if (document.getElementById(`${ID}-style`)) return;
  const style = document.createElement('style'); style.id = `${ID}-style`;
  style.textContent = `#${ID}{margin:22px 0;border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.08);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#172334}.rca-head{padding:20px 24px 14px;background:linear-gradient(135deg,#eef7ff,#fff)}.rca-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#1476d4}.rca-head h2{margin:5px 0;font-size:23px}.rca-head p{margin:0;color:#65758a;font-size:12px}.rca-controls{display:flex;gap:10px;align-items:end;padding:15px 24px;border-top:1px solid #e2e8ef;border-bottom:1px solid #e2e8ef;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#53657a}.rca-controls input{height:38px;width:250px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca-run,.rca-pdf{height:38px;border-radius:7px;padding:0 16px;font-weight:800;cursor:pointer}.rca-run{background:#174a7e;color:#fff;border:0}.rca-pdf{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca-run:disabled,.rca-pdf:disabled{opacity:.45;cursor:not-allowed}.rca-status{padding:9px 24px;font-size:11px;color:#63758a}.rca-body{padding:0 24px 22px;max-height:760px;overflow:auto}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:10px 0 18px}.rca-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca-card strong{display:block;margin-top:3px;font-size:13px}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.55;color:#24364a}.rca-evidence{margin-top:18px;padding-top:15px;border-top:1px solid #e3e8ee}.rca-evidence h3{font-size:12px;margin:0 0 8px}.rca-table{width:100%;border-collapse:collapse;font-size:10px}.rca-table th,.rca-table td{text-align:left;padding:7px;border-bottom:1px solid #e9edf2;vertical-align:top}.rca-table th{background:#f3f6f9;color:#516276}.rca-error{margin:10px 24px;padding:10px 12px;background:#fff2f1;color:#a52b20;border-radius:7px;font-size:11px}`;
  document.head.appendChild(style);
}

export function installAiRootCauseRcaV2() {
  if (document.getElementById(ID)) return;
  installStyles();
  const root = document.createElement('section'); root.id = ID;
  root.innerHTML = `<div class="rca-head"><span class="rca-eyebrow">DYNATRACE ASSIST + DAVIS</span><h2>AI Root Cause & RCA</h2><p>Enter a Davis Problem ID to retrieve incident evidence, correlated events, incident logs and recurrence history, then generate an evidence-backed RCA with Assist.</p></div><div class="rca-controls"><label>Problem ID<input class="rca-id" placeholder="e.g. P-260838152" /></label><button class="rca-run">Analyze with Assist</button><button class="rca-pdf" disabled>Print RCA PDF</button></div><div class="rca-status">Ready for a Davis Problem ID.</div><div class="rca-body"></div>`;
  const mount = () => { if (document.getElementById(ID)) return; const overview = [...document.querySelectorAll('h1')].find((h) => h.textContent?.includes('Capacity at a glance'))?.closest('.content'); if (overview) overview.parentElement?.insertBefore(root, overview.nextSibling); };
  mount();
  const observer = new MutationObserver(mount); observer.observe(document.body, { childList: true, subtree: true });
  const input = root.querySelector<HTMLInputElement>('.rca-id')!; const run = root.querySelector<HTMLButtonElement>('.rca-run')!; const pdf = root.querySelector<HTMLButtonElement>('.rca-pdf')!; const status = root.querySelector<HTMLElement>('.rca-status')!; const body = root.querySelector<HTMLElement>('.rca-body')!;
  let last: RcaResult | null = null;
  const render = (result: RcaResult) => {
    const p = result.evidence.problem;
    const affected = result.evidence.affectedEntities.map((r) => `<tr><td>${esc(text(r.affected_entity_ids))}</td><td>${esc(text(r.entityName))}</td></tr>`).join('');
    const history = result.evidence.historical.slice(0, 12).map((r) => `<tr><td>${esc(text(r.display_id))}</td><td>${esc(formatDate(text(r['event.start'])))}</td><td>${esc(text(r['event.status']))}</td><td>${esc(duration(text(r['event.start']), text(r['event.end'])))}</td></tr>`).join('');
    const logs = result.evidence.logs.slice(0, 15).map((r) => `<tr><td>${esc(formatDate(text(r.timestamp)))}</td><td>${esc(text(r.dt.source_entity))}</td><td>${esc(text(r.severity))}</td><td>${esc(text(r.message || r.content))}</td></tr>`).join('');
    body.innerHTML = `<div class="rca-summary"><div class="rca-card"><span>Problem</span><strong>${esc(result.problemId)}</strong></div><div class="rca-card"><span>Status</span><strong>${esc(text(p['event.status']))}</strong></div><div class="rca-card"><span>Severity</span><strong>Level ${esc(text(p['event.severity']))}</strong></div><div class="rca-card"><span>Category</span><strong>${esc(text(p['event.category']) || '—')}</strong></div><div class="rca-card"><span>Duration</span><strong>${esc(duration(text(p['event.start']), text(p['event.end'])))}</strong></div><div class="rca-card"><span>Past occurrences</span><strong>${result.evidence.historical.length}</strong></div></div><div class="rca-analysis">${esc(result.analysis)}</div><div class="rca-evidence"><h3>Correlated Davis events: ${result.evidence.events.length}</h3><table class="rca-table"><thead><tr><th>Start</th><th>Name</th><th>Type</th><th>Entity</th></tr></thead><tbody>${result.evidence.events.slice(0, 20).map((r) => `<tr><td>${esc(formatDate(text(r['event.start'])))}</td><td>${esc(text(r['event.name']))}</td><td>${esc(text(r['event.type']))}</td><td>${esc(text(r.dt.source_entity || r['dt.smartscape_source.id']))}</td></tr>`).join('') || '<tr><td colspan="4">No correlated event records retrieved.</td></tr>'}</tbody></table><h3 style="margin-top:18px">Incident logs: ${result.evidence.logs.length} records</h3><table class="rca-table"><thead><tr><th>Time</th><th>Entity</th><th>Severity</th><th>Message</th></tr></thead><tbody>${logs || '<tr><td colspan="4">No incident logs retrieved for affected entities.</td></tr>'}</tbody></table><h3 style="margin-top:18px">Affected entities</h3><table class="rca-table"><thead><tr><th>Entity ID</th><th>Name</th></tr></thead><tbody>${affected || '<tr><td colspan="2">No entity names resolved.</td></tr>'}</tbody></table><h3 style="margin-top:18px">Recent same-type occurrences</h3><table class="rca-table"><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${history || '<tr><td colspan="4">No historical occurrences found.</td></tr>'}</tbody></table></div>`;
  };
  const analyze = async () => {
    const problemId = input.value.trim().toUpperCase();
    if (!/^P-[A-Z0-9]+$/i.test(problemId)) { status.textContent = 'Enter a valid Davis Problem ID such as P-260838152.'; return; }
    run.disabled = true; pdf.disabled = true; body.innerHTML = '';
    status.textContent = `Collecting ${problemId}: Davis problem, correlated events, incident logs and 365-day recurrence evidence…`;
    try {
      const evidence = await loadEvidence(problemId);
      status.textContent = `Evidence collected (${evidence.events.length} events, ${evidence.logs.length} logs, ${evidence.historical.length} same-type occurrences). Asking Dynatrace Assist…`;
      const analysis = await askAssist(problemId, evidence);
      last = { problemId, evidence, analysis, generatedAt: new Date().toISOString() }; render(last); pdf.disabled = false;
      status.textContent = `RCA generated with Dynatrace Assist · ${new Date().toLocaleTimeString()}`;
    } catch (error) { last = null; body.innerHTML = `<div class="rca-error">${esc(error instanceof Error ? error.message : String(error))}</div>`; status.textContent = 'RCA generation failed.'; }
    finally { run.disabled = false; }
  };
  run.onclick = () => void analyze(); input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void analyze(); }); pdf.onclick = () => { if (last) printRca(last); };
}
