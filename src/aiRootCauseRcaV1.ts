import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }

const ID = 'axis-ai-root-cause-rca-v1';
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const escDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const text = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean).join('; ') : value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function dql(query: string, max = 300): Promise<Row[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = response.result as QueryResult | undefined;
  const token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    result = poll.result as QueryResult | undefined;
    state = poll.state;
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
  return minutes < 60 ? `${minutes.toFixed(1)} min` : `${(minutes / 60).toFixed(1)} h`;
}

export interface RcaEvidence {
  problem: Row;
  affectedEntities: Row[];
  snapshots: Row[];
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
  const problemRows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| filter display_id == "${id}"
| fields display_id, event.id, event.name, event.status, event.severity, event.category, event.start, event.end, event.description, root_cause_entity_id, dt.analysis.ready, dt.duration_marker, resolved_problem_duration, dt.davis.impact_level, dt.davis.affected_users_count, duplicate_problem_ids, affected_entity_ids
| sort timestamp desc
| limit 1`, 5);
  if (!problemRows.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);
  const problem = problemRows[0];
  const affected = Array.isArray(problem.affected_entity_ids) ? problem.affected_entity_ids.map(text).filter(Boolean) : [text(problem.affected_entity_ids)].filter(Boolean);
  const entityList = affected.map((x) => `"${escDql(x)}"`).join(', ');
  const eventName = text(problem['event.name']);

  const [entities, snapshots, historical] = await Promise.all([
    entityList ? dql(`fetch dt.davis.problems
| filter display_id == "${id}"
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields affected_entity_ids, entityName=entityName(affected_entity_ids)
| dedup affected_entity_ids`, 100) : Promise.resolve([]),
    dql(`fetch dt.davis.problems.snapshots
| filter event.id == "${id}"
| fields timestamp, event.id, event.status, event.status_transition, event.severity, event.name, affected_entity_ids, root_cause_entity_id
| sort timestamp asc
| limit 100`, 100).catch(() => []),
    eventName ? dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| filter event.name == "${escDql(eventName)}"
| fields display_id, event.name, event.status, event.severity, event.start, event.end, resolved_problem_duration, root_cause_entity_id, affected_entity_ids
| sort event.start desc
| limit 50`, 50) : Promise.resolve([]),
  ]);

  const related = entityList ? await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields display_id, event.name, event.status, event.severity, event.start, event.end, resolved_problem_duration, root_cause_entity_id, affected_entity_ids
| sort event.start desc
| limit 50`, 50) : [];

  return { problem, affectedEntities: entities, snapshots, historical, relatedProblems: related };
}

function compact(evidence: RcaEvidence) {
  const p = evidence.problem;
  return {
    problem: {
      id: text(p.display_id), title: text(p['event.name']), status: text(p['event.status']), severity: text(p['event.severity']), category: text(p['event.category']),
      start: text(p['event.start']), end: text(p['event.end']), duration: duration(text(p['event.start']), text(p['event.end'])), description: text(p['event.description']),
      rootCauseEntityId: text(p.root_cause_entity_id), analysisReady: text(p['dt.analysis.ready']), durationMarker: text(p['dt.duration_marker']), resolvedDuration: text(p.resolved_problem_duration), impactLevel: text(p['dt.davis.impact_level']), affectedUsers: text(p['dt.davis.affected_users_count']),
    },
    affectedEntities: evidence.affectedEntities.slice(0, 40),
    timeline: evidence.snapshots.slice(0, 50),
    sameProblemTypePastYear: evidence.historical.slice(0, 30),
    relatedEntityProblemsPastYear: evidence.relatedProblems.slice(0, 30),
  };
}

async function askAssist(problemId: string, evidence: RcaEvidence): Promise<string> {
  const data = JSON.stringify(compact(evidence)).slice(0, 30000);
  const prompt = `Perform a detailed enterprise RCA for Dynatrace Davis problem ${problemId}. You are an SRE incident investigator for Axis Bank. Use ONLY the supplied Dynatrace evidence and do not invent metrics, timestamps, causes, or remediation results. If evidence is insufficient for a conclusion, clearly label it as "Not proven by available evidence". Distinguish observed facts from inference.

Return a polished RCA using exactly these sections:
1. Executive Summary
2. Incident Overview (problem ID, title, severity, category, start, end, duration, status, impact)
3. Probable Root Cause (ranked causes with confidence: High/Medium/Low and evidence for each)
4. Technical Root-Cause Chain (symptom -> contributing signal -> affected entity -> likely underlying cause)
5. Incident Timeline (chronological, with important state changes)
6. Past Occurrences (frequency, recurrence pattern, previous problem IDs/times, common entities)
7. Impact Assessment
8. Recommended Immediate Actions (P1/P2/P3)
9. Preventive / Permanent Actions
10. Monitoring & Alerting Recommendations
11. What to Validate Next
12. RCA Confidence & Evidence Gaps

Keep it factual and customer-ready. Never claim that an action was performed. Use concrete values from the evidence where available.

Dynatrace evidence:\n${data}`;
  const response = await publicClient.recommenderConversation({ body: { text: prompt, context: [
    { type: 'instruction', value: 'You are generating an incident RCA, not a generic capacity answer. Use only supplied evidence. Do not expose hidden reasoning. Be precise about confidence and evidence gaps.' },
  ] } });
  const answer = String((response as unknown as { text?: string; answer?: string; content?: string }).text ?? (response as unknown as { answer?: string }).answer ?? (response as unknown as { content?: string }).content ?? '').trim();
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

function pdf(result: RcaResult) {
  const lines = result.analysis.replace(/\r/g, '').split('\n').map((x) => x.replace(/[*#`]/g, '').trim()).filter(Boolean);
  const p = result.evidence.problem;
  const escPdf = (v: string) => v.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');
  const objects: string[] = [];
  const pageContents: string[][] = [];
  let page: string[] = [];
  const add = (value: string, size = 9, bold = false) => { page.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf 42 735 Td (${escPdf(value.slice(0, 125))}) Tj ET`); };
  const newPage = () => { if (page.length) pageContents.push(page); page = []; };
  add('AXIS BANK | ApMoSys TECHNOLOGIES', 11, true); add('AI-ASSISTED INCIDENT ROOT CAUSE ANALYSIS', 17, true); add(`Problem ${result.problemId} | ${text(p['event.name'])}`, 10); add(`Generated ${new Date(result.generatedAt).toLocaleString()}`, 8); add('');
  for (const line of lines) {
    if (/^(1\.|2\.|3\.|4\.|5\.|6\.|7\.|8\.|9\.|10\.|11\.|12\.)/.test(line)) { if (page.length > 35) newPage(); add(line, 12, true); }
    else { add(`• ${line}`, 8); }
    if (page.length >= 40) newPage();
  }
  newPage();
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids: string[] = [];
  const font1 = 3 + pageContents.length * 2; const font2 = font1 + 1;
  pageContents.forEach((content, i) => { const pageNo = 3 + i * 2; const contentNo = pageNo + 1; kids.push(`${pageNo} 0 R`); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${contentNo} 0 R >>`); const stream = content.join('\n'); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  objects.splice(1, 0, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let out = '%PDF-1.4\n'; const offsets: number[] = [0]; objects.forEach((obj, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${obj}\nendobj\n`; }); const xref = out.length; out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' })); const a = document.createElement('a'); a.href = url; a.download = `Axis-RCA-${result.problemId}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function installStyles() {
  if (document.getElementById(`${ID}-style`)) return;
  const style = document.createElement('style'); style.id = `${ID}-style`; style.textContent = `#${ID}{margin:22px 0;padding:0;border:1px solid #dbe3ec;border-radius:14px;background:#fff;box-shadow:0 8px 30px rgba(20,45,75,.08);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#172334}.rca-head{padding:20px 24px 14px;background:linear-gradient(135deg,#eef7ff,#fff)}.rca-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#1476d4}.rca-head h2{margin:5px 0;font-size:23px}.rca-head p{margin:0;color:#65758a;font-size:12px}.rca-controls{display:flex;gap:10px;align-items:end;padding:15px 24px;border-top:1px solid #e2e8ef;border-bottom:1px solid #e2e8ef;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#53657a}.rca-controls input{height:38px;width:250px;border:1px solid #cbd6e1;border-radius:7px;padding:0 11px}.rca-run,.rca-pdf{height:38px;border:0;border-radius:7px;padding:0 16px;font-weight:800;cursor:pointer}.rca-run{background:#174a7e;color:#fff}.rca-pdf{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.rca-run:disabled,.rca-pdf:disabled{opacity:.45;cursor:not-allowed}.rca-status{padding:9px 24px;font-size:11px;color:#63758a}.rca-body{padding:0 24px 22px;max-height:620px;overflow:auto}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:10px 0 18px}.rca-card{padding:10px 12px;border:1px solid #e0e7ee;border-radius:8px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#718197;text-transform:uppercase}.rca-card strong{display:block;margin-top:3px;font-size:13px}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.55;color:#24364a}.rca-evidence{margin-top:18px;padding-top:15px;border-top:1px solid #e3e8ee}.rca-evidence h3{font-size:12px;margin:0 0 8px}.rca-table{width:100%;border-collapse:collapse;font-size:10px}.rca-table th,.rca-table td{text-align:left;padding:7px;border-bottom:1px solid #e9edf2;vertical-align:top}.rca-table th{background:#f3f6f9;color:#516276}.rca-error{margin:10px 24px;padding:10px 12px;background:#fff2f1;color:#a52b20;border-radius:7px;font-size:11px}`; document.head.appendChild(style);
}

export function installAiRootCauseRcaV1() {
  if (document.getElementById(ID)) return;
  installStyles();
  const root = document.createElement('section'); root.id = ID;
  root.innerHTML = `<div class="rca-head"><span class="rca-eyebrow">DYNATRACE ASSIST + DAVIS</span><h2>AI Root Cause & RCA</h2><p>Enter a Davis Problem ID to generate an evidence-backed incident RCA with timeline, recurrence analysis, impact and remediation recommendations.</p></div><div class="rca-controls"><label>Problem ID<input class="rca-id" placeholder="e.g. P-260838152" /></label><button class="rca-run">Analyze with Assist</button><button class="rca-pdf" disabled>Print RCA PDF</button></div><div class="rca-status">Ready for a Davis Problem ID.</div><div class="rca-body"></div>`;
  const mount = () => { if (document.getElementById(ID)) return; const overview = [...document.querySelectorAll('h1')].find((h) => h.textContent?.includes('Capacity at a glance'))?.closest('.content'); if (overview) overview.parentElement?.insertBefore(root, overview.nextSibling); };
  mount(); const observer = new MutationObserver(mount); observer.observe(document.body, { childList: true, subtree: true });
  const input = root.querySelector<HTMLInputElement>('.rca-id')!; const run = root.querySelector<HTMLButtonElement>('.rca-run')!; const pdfButton = root.querySelector<HTMLButtonElement>('.rca-pdf')!; const status = root.querySelector<HTMLElement>('.rca-status')!; const body = root.querySelector<HTMLElement>('.rca-body')!;
  let last: RcaResult | null = null;
  const render = (result: RcaResult) => { const p = result.evidence.problem; const affected = result.evidence.affectedEntities.map((r) => `<tr><td>${esc(text(r.affected_entity_ids))}</td><td>${esc(text(r.entityName))}</td></tr>`).join(''); const history = result.evidence.historical.slice(0, 10).map((r) => `<tr><td>${esc(text(r.display_id))}</td><td>${esc(text(r['event.start']))}</td><td>${esc(text(r['event.status']))}</td><td>${esc(duration(text(r['event.start']), text(r['event.end'])))}</td></tr>`).join(''); body.innerHTML = `<div class="rca-summary"><div class="rca-card"><span>Problem</span><strong>${esc(result.problemId)}</strong></div><div class="rca-card"><span>Status</span><strong>${esc(text(p['event.status']))}</strong></div><div class="rca-card"><span>Severity</span><strong>Level ${esc(text(p['event.severity']))}</strong></div><div class="rca-card"><span>Category</span><strong>${esc(text(p['event.category']) || '—')}</strong></div><div class="rca-card"><span>Duration</span><strong>${esc(duration(text(p['event.start']), text(p['event.end'])))}</strong></div><div class="rca-card"><span>Past occurrences</span><strong>${result.evidence.historical.length}</strong></div></div><div class="rca-analysis">${esc(result.analysis)}</div><div class="rca-evidence"><h3>Affected entities</h3><table class="rca-table"><thead><tr><th>Entity ID</th><th>Name</th></tr></thead><tbody>${affected || '<tr><td colspan="2">No entity names resolved.</td></tr>'}</tbody></table><h3 style="margin-top:18px">Recent same-type occurrences</h3><table class="rca-table"><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${history || '<tr><td colspan="4">No historical occurrences found.</td></tr>'}</tbody></table></div>`; };
  const analyze = async () => { const problemId = input.value.trim().toUpperCase(); if (!/^P-[A-Z0-9]+$/i.test(problemId)) { status.textContent = 'Enter a valid Davis Problem ID such as P-260838152.'; return; } run.disabled = true; pdfButton.disabled = true; body.innerHTML = ''; status.textContent = `Collecting ${problemId}: problem details, timeline, affected entities and 365-day recurrence evidence…`; try { const evidence = await loadEvidence(problemId); status.textContent = 'Evidence collected. Asking Dynatrace Assist for the RCA…'; const analysis = await askAssist(problemId, evidence); last = { problemId, evidence, analysis, generatedAt: new Date().toISOString() }; render(last); pdfButton.disabled = false; status.textContent = `RCA generated with Dynatrace Assist · ${new Date().toLocaleTimeString()}`; } catch (error) { last = null; body.innerHTML = `<div class="rca-error">${esc(error instanceof Error ? error.message : String(error))}</div>`; status.textContent = 'RCA generation failed.'; } finally { run.disabled = false; } };
  run.onclick = () => void analyze(); input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void analyze(); }); pdfButton.onclick = () => { if (last) pdf(last); };
}
