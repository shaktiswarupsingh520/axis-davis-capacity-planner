import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }
const ID = 'axis-ai-root-cause-rca-v3';
const s = (v: unknown): string => Array.isArray(v) ? v.map(s).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const esc = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const q = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const mins = (a: string, b: string) => { const x = new Date(a).getTime(), y = b ? new Date(b).getTime() : Date.now(); if (!Number.isFinite(x) || !Number.isFinite(y)) return '—'; const m = Math.max(0, y - x) / 60000; return m < 60 ? `${m.toFixed(1)} min` : m < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} d`; };
const dt = (v: string) => { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString() : v || '—'; };

async function dql(query: string, max = 200): Promise<Row[]> {
  const r = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = r.result as QueryResult | undefined;
  const token = r.requestToken;
  for (let i = 0; !result && token && i < 30; i++) { const p = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 }); result = p.result as QueryResult | undefined; if (!result) await new Promise((resolve) => setTimeout(resolve, 250)); }
  if (!result) throw new Error('DQL did not complete.');
  return (result.records ?? []).filter(Boolean) as Row[];
}

interface Evidence { problem: Row; events: Row[]; logs: Row[]; history: Row[]; entities: Row[]; snapshots: Row[]; }
interface Result { id: string; evidence: Evidence; analysis: string; generatedAt: string; }

async function evidenceFor(id: string): Promise<Evidence> {
  const pid = q(id);
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate) and display_id == "${pid}"
| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,affected_entity_ids,root_cause.smartscape_entity,root_cause_entity_id
| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${id} was not found in the last 365 days.`);
  const problem = rows[0];
  const ids = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(s).filter(Boolean) : [s(problem.affected_entity_ids)].filter(Boolean);
  const entityList = [...new Set(ids)].slice(0, 80).map((x) => `"${q(x)}"`).join(', ');
  const eventIds = Array.isArray(problem['dt.davis.event_ids']) ? problem['dt.davis.event_ids'].map(s).filter(Boolean) : [];
  const eventList = eventIds.slice(0, 80).map((x) => `"${q(x)}"`).join(', ');
  const start = s(problem['event.start']);
  const end = s(problem['event.end']) || new Date().toISOString();
  const events = eventList ? await dql(`fetch dt.davis.events, from:now()-365d, to:now()
| filter in(event.id, array(${eventList}))
| fields event.id,event.name,event.type,event.status,event.severity,event.category,event.start,event.end,event.description,dt.source_entity,dt.smartscape_source.id,dt.query,dt.davis.is_rootcause_relevant
| sort event.start asc
| limit 100`, 100).catch(() => []) : [];
  const logs = entityList ? await dql(`fetch logs, from:now()-365d, to:now()
| filter timestamp >= toTimestamp("${q(start)}") - 15m and timestamp <= toTimestamp("${q(end)}") + 15m
| filter in(dt.source_entity, array(${entityList}))
| fields timestamp,dt.source_entity,status,severity,content,message
| sort timestamp asc
| limit 100`, 100).catch(() => []) : [];
  const history = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate) and event.name == "${q(s(problem['event.name']))}"
| fields display_id,event.name,event.status,event.severity,event.start,event.end,event.category,resolved_problem_duration,root_cause.smartscape_entity
| sort event.start desc
| limit 40`, 40).catch(() => []);
  const entities = entityList ? await dql(`fetch dt.davis.problems
| filter display_id == "${pid}"
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields affected_entity_ids,entityName=entityName(affected_entity_ids)
| dedup affected_entity_ids
| limit 80`, 80).catch(() => []) : [];
  const snapshots = await dql(`fetch dt.davis.problems.snapshots, from:now()-365d, to:now()
| filter event.id == "${q(s(problem['event.id']))}"
| fields timestamp,event.status,event.status_transition,event.severity,event.name,root_cause_entity_id
| sort timestamp asc
| limit 80`, 80).catch(() => []);
  return { problem, events, logs, history, entities, snapshots };
}

function evidenceText(e: Evidence) {
  const p = e.problem;
  return JSON.stringify({
    problem: { id: s(p.display_id), title: s(p['event.name']), status: s(p['event.status']), severity: s(p['event.severity']), category: s(p['event.category']), start: s(p['event.start']), end: s(p['event.end']), duration: mins(s(p['event.start']), s(p['event.end'])), description: s(p['event.description']), rootCause: s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id), impact: s(p['dt.davis.impact_level']), affectedUsers: s(p['dt.davis.affected_users_count']) },
    snapshots: e.snapshots.slice(0, 50), correlatedEvents: e.events.slice(0, 70), incidentLogs: e.logs.slice(0, 80), pastOccurrences: e.history.slice(0, 30), affectedEntities: e.entities.slice(0, 50)
  }).slice(0, 26000);
}

async function ask(id: string, e: Evidence): Promise<string> {
  const evidence = evidenceText(e);
  const prompt = `Create a customer-ready Dynatrace incident RCA for Davis Problem ${id}. The following is retrieved evidence from this exact Dynatrace environment. Analyze it directly; do not claim that you lack access, do not ask the user to open Problems, and do not ask for telemetry already included. Use only the supplied evidence for factual claims. Clearly label inference and confidence. Never invent a deployment, metric, timestamp, affected-user count, root cause, recurrence, or remediation result. If something is not proven, say "Not proven by available evidence". Recommendations are proposed actions only.

Return exactly: 1. Executive Summary 2. Incident Overview 3. Root Cause Assessment 4. Technical Root-Cause Chain 5. Incident Timeline 6. Past Occurrences & Recurrence Pattern 7. Impact Assessment 8. Immediate Remediation Plan 9. Permanent / Preventive Actions 10. Monitoring & Alerting Recommendations 11. Validation Checklist 12. RCA Confidence & Evidence Gaps.

RETRIEVED EVIDENCE:\n${evidence}`;
  const response = await publicClient.recommenderConversation({ acceptType: 'application/json', body: { text: prompt, context: [{ type: 'document-retrieval', value: 'disabled' }, { type: 'supplementary', value: evidence }, { type: 'instruction', value: 'Analyze the supplied evidence directly. Do not produce a generic access limitation response.' }], annotations: { origin: 'Axis Davis Capacity Planner RCA', problemId: id } } });
  const r = response as unknown as { status?: string; text?: string; answer?: string; content?: string };
  if (r.status === 'FAILED') throw new Error('Dynatrace Assist RCA request failed. Check the user copilot permission and agentic AI availability.');
  const answer = s(r.text ?? r.answer ?? r.content).trim();
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

function printRca(result: Result) {
  const p = result.evidence.problem;
  const win = window.open('', '_blank', 'width=1000,height=900');
  if (!win) throw new Error('Allow pop-ups to print the RCA PDF.');
  const eventRows = result.evidence.events.slice(0, 30).map((r) => `<tr><td>${esc(dt(s(r['event.start'])))}</td><td>${esc(s(r['event.name']))}</td><td>${esc(s(r['event.type']))}</td><td>${esc(s(r['dt.source_entity']) || s(r['dt.smartscape_source.id']))}</td><td>${esc(s(r['event.description']))}</td></tr>`).join('');
  const histRows = result.evidence.history.slice(0, 20).map((r) => `<tr><td>${esc(s(r.display_id))}</td><td>${esc(dt(s(r['event.start'])))}</td><td>${esc(s(r['event.status']))}</td><td>${esc(mins(s(r['event.start']), s(r['event.end'])))}</td></tr>`).join('');
  win.document.write(`<!doctype html><html><head><title>Axis RCA ${esc(result.id)}</title><style>@page{size:A4;margin:14mm}body{font-family:Arial,sans-serif;color:#172334;font-size:10.5px;line-height:1.5}h1{color:#173b70;margin:0;font-size:22px}h2{color:#173b70;font-size:14px;border-bottom:2px solid #d9e5f2;padding-bottom:4px;margin-top:20px}.hero{padding:18px;border:1px solid #d5e1ee;border-radius:10px;background:#f5f9fd}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:12px}.card{padding:8px;border:1px solid #dce5ee;border-radius:7px}.label{font-size:8px;color:#718197;text-transform:uppercase}.value{font-weight:700}.analysis{white-space:pre-wrap}table{width:100%;border-collapse:collapse;font-size:8px}th,td{padding:5px;border-bottom:1px solid #e4e9ef;text-align:left;vertical-align:top}th{background:#eef4f9}.note{margin-top:18px;padding:9px;background:#fff8e8;border-left:4px solid #e4a11b}</style></head><body><div class="hero"><div style="font-size:9px;color:#65758a">AXIS BANK | ApMoSys TECHNOLOGIES</div><h1>AI-Assisted Incident Root Cause Analysis</h1><div style="font-size:9px;color:#65758a">Problem ${esc(result.id)} · Generated ${esc(new Date(result.generatedAt).toLocaleString())}</div><div class="grid"><div class="card"><div class="label">Status</div><div class="value">${esc(s(p['event.status']))}</div></div><div class="card"><div class="label">Severity</div><div class="value">Level ${esc(s(p['event.severity']))}</div></div><div class="card"><div class="label">Category</div><div class="value">${esc(s(p['event.category']))}</div></div><div class="card"><div class="label">Duration</div><div class="value">${esc(mins(s(p['event.start']), s(p['event.end'])))}</div></div></div></div><h2>Incident Overview</h2><p><b>Title:</b> ${esc(s(p['event.name']))}<br><b>Started:</b> ${esc(dt(s(p['event.start'])))}<br><b>Ended:</b> ${esc(dt(s(p['event.end'])))}<br><b>Root-cause entity:</b> ${esc(s(p['root_cause.smartscape_entity']) || s(p.root_cause_entity_id) || 'Not identified')}<br><b>Affected users:</b> ${esc(s(p['dt.davis.affected_users_count']) || 'Not available')}</p><h2>AI Root Cause Analysis</h2><div class="analysis">${esc(result.analysis)}</div><h2>Correlated Davis Events</h2><table><thead><tr><th>Start</th><th>Name</th><th>Type</th><th>Entity</th><th>Description</th></tr></thead><tbody>${eventRows || '<tr><td colspan="5">No correlated events retrieved.</td></tr>'}</tbody></table><h2>Past Occurrences</h2><table><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${histRows || '<tr><td colspan="4">No matching past occurrences retrieved.</td></tr>'}</tbody></table><div class="note"><b>RCA governance:</b> Facts come from retrieved Dynatrace evidence. Inferences and recommendations must not be treated as completed remediation.</div><script>window.onload=()=>setTimeout(()=>window.print(),500)</script></body></html>`);
  win.document.close();
}

function style() {
  if (document.getElementById(`${ID}-style`)) return;
  const x = document.createElement('style'); x.id = `${ID}-style`; x.textContent = `#${ID}{margin:22px 0;border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.08);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#172334}.rca-head{padding:20px 24px;background:linear-gradient(135deg,#eef7ff,#fff)}.rca-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#1476d4}.rca-head h2{margin:5px 0;font-size:23px}.rca-head p{margin:0;color:#65758a;font-size:12px}.rca-controls{display:flex;gap:10px;align-items:end;padding:15px 24px;border-block:1px solid #e2e8ef;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#53657a}.rca-controls input{height:38px;width:250px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca-run,.rca-pdf{height:38px;border-radius:7px;padding:0 16px;font-weight:800;cursor:pointer}.rca-run{background:#174a7e;color:#fff;border:0}.rca-pdf{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca-run:disabled,.rca-pdf:disabled{opacity:.45}.rca-status{padding:9px 24px;font-size:11px;color:#63758a}.rca-body{padding:0 24px 22px;max-height:760px;overflow:auto}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:10px 0 18px}.rca-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca-card strong{display:block;margin-top:3px;font-size:13px}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.55;color:#24364a}.rca-evidence{margin-top:18px;padding-top:15px;border-top:1px solid #e3e8ee}.rca-table{width:100%;border-collapse:collapse;font-size:10px}.rca-table th,.rca-table td{text-align:left;padding:7px;border-bottom:1px solid #e9edf2;vertical-align:top}.rca-table th{background:#f3f6f9}.rca-error{margin:10px 24px;padding:10px;background:#fff2f1;color:#a52b20;border-radius:7px;font-size:11px}`; document.head.appendChild(x);
}

export function installAiRootCauseRcaV3() {
  if (document.getElementById(ID)) return;
  style();
  const root = document.createElement('section'); root.id = ID;
  root.innerHTML = `<div class="rca-head"><span class="rca-eyebrow">DYNATRACE ASSIST + DAVIS</span><h2>AI Root Cause & RCA</h2><p>Enter a Davis Problem ID to retrieve the incident, correlated Davis events, incident-window logs and recurrence history, then generate a detailed customer-ready RCA.</p></div><div class="rca-controls"><label>Problem ID<input class="rca-id" placeholder="e.g. P-260838152" /></label><button class="rca-run">Analyze with Assist</button><button class="rca-pdf" disabled>Print RCA PDF</button></div><div class="rca-status">Ready for a Davis Problem ID.</div><div class="rca-body"></div>`;
  const mount = () => { if (document.getElementById(ID)) return; const h = [...document.querySelectorAll('h1')].find((x) => x.textContent?.includes('Capacity at a glance')); if (h?.parentElement?.parentElement) h.parentElement.parentElement.parentElement?.insertBefore(root, h.parentElement.parentElement); };
  mount(); new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
  const input = root.querySelector<HTMLInputElement>('.rca-id')!; const run = root.querySelector<HTMLButtonElement>('.rca-run')!; const pdf = root.querySelector<HTMLButtonElement>('.rca-pdf')!; const status = root.querySelector<HTMLElement>('.rca-status')!; const body = root.querySelector<HTMLElement>('.rca-body')!;
  let last: Result | null = null;
  const render = (r: Result) => { const p = r.evidence.problem; const events = r.evidence.events.slice(0, 20).map((x) => `<tr><td>${esc(dt(s(x['event.start'])))}</td><td>${esc(s(x['event.name']))}</td><td>${esc(s(x['event.type']))}</td><td>${esc(s(x['dt.source_entity']) || s(x['dt.smartscape_source.id']))}</td></tr>`).join(''); const hist = r.evidence.history.slice(0, 12).map((x) => `<tr><td>${esc(s(x.display_id))}</td><td>${esc(dt(s(x['event.start'])))}</td><td>${esc(s(x['event.status']))}</td><td>${esc(mins(s(x['event.start']), s(x['event.end'])))}</td></tr>`).join(''); body.innerHTML = `<div class="rca-summary"><div class="rca-card"><span>Problem</span><strong>${esc(r.id)}</strong></div><div class="rca-card"><span>Status</span><strong>${esc(s(p['event.status']))}</strong></div><div class="rca-card"><span>Severity</span><strong>Level ${esc(s(p['event.severity']))}</strong></div><div class="rca-card"><span>Category</span><strong>${esc(s(p['event.category']) || '—')}</strong></div><div class="rca-card"><span>Duration</span><strong>${esc(mins(s(p['event.start']), s(p['event.end'])))}</strong></div><div class="rca-card"><span>Past occurrences</span><strong>${r.evidence.history.length}</strong></div></div><div class="rca-analysis">${esc(r.analysis)}</div><div class="rca-evidence"><h3>Correlated Davis events (${r.evidence.events.length})</h3><table class="rca-table"><thead><tr><th>Start</th><th>Name</th><th>Type</th><th>Entity</th></tr></thead><tbody>${events || '<tr><td colspan="4">No correlated events retrieved.</td></tr>'}</tbody></table><h3>Incident logs retrieved: ${r.evidence.logs.length}</h3><h3>Recent same-type occurrences</h3><table class="rca-table"><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${hist || '<tr><td colspan="4">No matching past occurrences retrieved.</td></tr>'}</tbody></table></div>`; };
  const analyze = async () => { const id = input.value.trim().toUpperCase(); if (!/^P-[A-Z0-9]+$/i.test(id)) { status.textContent = 'Enter a valid Davis Problem ID such as P-260838152.'; return; } run.disabled = true; pdf.disabled = true; body.innerHTML = ''; status.textContent = `Collecting ${id}: problem, correlated events, incident logs and 365-day recurrence…`; try { const e = await evidenceFor(id); status.textContent = `Evidence collected: ${e.events.length} events, ${e.logs.length} logs, ${e.history.length} matching occurrences. Asking Dynatrace Assist…`; const analysis = await ask(id, e); last = { id, evidence: e, analysis, generatedAt: new Date().toISOString() }; render(last); pdf.disabled = false; status.textContent = `RCA generated with Dynatrace Assist · ${new Date().toLocaleTimeString()}`; } catch (err) { last = null; body.innerHTML = `<div class="rca-error">${esc(err instanceof Error ? err.message : String(err))}</div>`; status.textContent = 'RCA generation failed.'; } finally { run.disabled = false; } };
  run.onclick = () => void analyze(); input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void analyze(); }); pdf.onclick = () => { if (last) printRca(last); };
}
