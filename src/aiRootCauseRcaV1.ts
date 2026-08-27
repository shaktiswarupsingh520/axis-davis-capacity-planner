import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
interface QueryResult { records?: Array<Row | null>; }
const ID = 'axis-ai-root-cause-rca-v1';
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
  const rows = await dql(`fetch dt.davis.problems, from:now()-365d, to:now()
| filter not(dt.davis.is_duplicate)
| filter display_id == "${id}"
| fields display_id, event.id, event.name, event.status, event.severity, event.category, event.start, event.end, event.description, event.kind, event.id, dt.davis.event_ids, root_cause_entity_id, root_cause.smartscape_entity, dt.analysis.ready, dt.duration_marker, resolved_problem_duration, dt.davis.impact_level, dt.davis.affected_users_count, affected_entity_ids, smartscape.affected_entities
| sort event.start desc
| limit 1`, 5);
  if (!rows.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);

  const problem = rows[0];
  const affected = Array.isArray(problem.affected_entity_ids)
    ? problem.affected_entity_ids.map(text).filter(Boolean)
    : [text(problem.affected_entity_ids)].filter(Boolean);
  const entityList = unique(affected).slice(0, 100).map((x) => `"${escDql(x)}"`).join(', ');
  const eventName = text(problem['event.name']);
  const eventId = text(problem['event.id']);

  const entities = entityList ? await dql(`fetch dt.davis.problems
| filter display_id == "${id}"
| expand affected_entity_ids
| filter in(affected_entity_ids, ${entityList})
| fields affected_entity_ids, entityName=entityName(affected_entity_ids)
| dedup affected_entity_ids
| limit 100`, 100).catch(() => []) : [];

  const snapshots = eventId ? await dql(`fetch dt.davis.problems.snapshots
| filter event.id == "${escDql(eventId)}"
| fields timestamp, event.id, event.status, event.status_transition, event.severity, event.name, affected_entity_ids, root_cause_entity_id
| sort timestamp asc
| limit 100`, 100).catch(() => []) : [];

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

  return { problem, affectedEntities: entities, snapshots, historical, relatedProblems };
}

function compactEvidence(e: RcaEvidence) {
  const p = e.problem;
  return {
    problem: {
      id: text(p.display_id),
      title: text(p['event.name']),
      status: text(p['event.status']),
      severity: text(p['event.severity']),
      category: text(p['event.category']),
      kind: text(p['event.kind']),
      start: text(p['event.start']),
      end: text(p['event.end']),
      duration: duration(text(p['event.start']), text(p['event.end'])),
      description: text(p['event.description']),
      rootCauseEntity: text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id),
      analysisReady: text(p['dt.analysis.ready']),
      durationMarker: text(p['dt.duration_marker']),
      resolvedDuration: text(p.resolved_problem_duration),
      impactLevel: text(p['dt.davis.impact_level']),
      affectedUsers: text(p['dt.davis.affected_users_count']),
      eventIds: text(p['dt.davis.event_ids']),
      affectedEntityIds: affectedIds(p),
    },
    affectedEntities: e.affectedEntities.slice(0, 50),
    timeline: e.snapshots.slice(0, 50),
    sameProblemTypePastYear: e.historical.slice(0, 30),
    relatedEntityProblemsPastYear: e.relatedProblems.slice(0, 30),
  };
}

function affectedIds(problem: Row) {
  return Array.isArray(problem.affected_entity_ids)
    ? problem.affected_entity_ids.map(text).filter(Boolean)
    : [text(problem.affected_entity_ids)].filter(Boolean);
}

async function askAssist(problemId: string, evidence: RcaEvidence): Promise<string> {
  const payload = JSON.stringify(compactEvidence(evidence)).slice(0, 45000);
  const prompt = `Investigate Dynatrace Davis problem ${problemId} and produce a customer-ready incident RCA for an enterprise SRE team.

IMPORTANT: The complete Dynatrace evidence collected by the application is supplied below as SUPPLEMENTARY EVIDENCE. You are not being asked whether you can access the environment. Analyze the supplied evidence directly. Do not respond with generic instructions to open Problems or tell the user that you lack access to live data.

Rules:
- Use only supplied evidence for factual claims.
- Never invent metrics, timestamps, root causes, remediation results, previous incidents, or affected users.
- Clearly distinguish OBSERVED FACT from INFERENCE.
- For each probable cause provide confidence: High, Medium, or Low and cite the evidence field/entity supporting it.
- If a root cause cannot be proven, explicitly state: "Not proven by available evidence".
- Past occurrences must come only from the supplied historical/related problem records.
- Recommendations may be proposed, but never state that they were already performed.

Return these sections exactly:
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

Make the answer concise enough for an RCA document but technically detailed enough for an L3/SRE review.

Problem ID: ${problemId}`;

  const response = await publicClient.recommenderConversation({
    acceptType: 'application/json',
    body: {
      text: prompt,
      context: [
        { type: 'document-retrieval', value: 'disabled' },
        { type: 'supplementary', value: payload },
        { type: 'instruction', value: 'The supplementary content is authoritative incident evidence. Analyze it directly. Do not answer that you lack access to the live environment. Do not invent missing facts.' },
      ],
      annotations: {
        origin: { value: 'Axis Davis Capacity Planner RCA' },
        problemId: { value: problemId },
      },
    },
  });

  const r = response as unknown as { status?: string; text?: string; answer?: string; content?: string };
  if (r.status === 'FAILED') throw new Error('Dynatrace Assist could not complete the RCA investigation.');
  const answer = String(r.text ?? r.answer ?? r.content ?? '').trim();
  if (!answer) throw new Error('Dynatrace Assist returned an empty RCA.');
  return answer;
}

function makePdf(result: RcaResult) {
  const clean = (v: string) => v.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');
  const wrap = (value: string, width: number) => { const out: string[] = []; let s = value.trim(); while (s.length > width) { let cut = s.lastIndexOf(' ', width); if (cut < 35) cut = width; out.push(s.slice(0, cut)); s = s.slice(cut).trim(); } if (s) out.push(s); return out; };
  const lines: Array<{ text: string; heading?: boolean }> = [];
  for (const raw of result.analysis.replace(/\r/g, '').split('\n').map((x) => x.replace(/[*#`]/g, '').trim()).filter(Boolean)) {
    const heading = /^\d+\./.test(raw);
    for (const part of wrap(raw, heading ? 88 : 96)) lines.push({ text: part, heading });
  }
  const pages: string[][] = [];
  let page: string[] = [];
  let y = 690;
  const cmd = (value: string, size: number, bold: boolean, yy: number, x = 42) => `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${yy} Td (${clean(value)}) Tj ET`;
  const header = () => {
    page.push(cmd('AXIS BANK  |  ApMoSys TECHNOLOGIES', 10, true, 752));
    page.push('0.20 0.40 0.75 RG 2 w 42 741 m 570 741 l S');
    page.push(cmd('AI-ASSISTED INCIDENT ROOT CAUSE ANALYSIS', 15, true, 718));
    page.push(cmd(`Problem ${result.problemId}  |  ${text(result.evidence.problem['event.name'])}`, 9, false, 699));
    y = 674;
  };
  const flush = () => { if (page.length) pages.push(page); page = []; };
  header();
  const add = (value: string, size: number, bold = false, gap = 13) => { if (y < 58) { flush(); header(); } page.push(cmd(value, size, bold, y)); y -= gap; };
  const p = result.evidence.problem;
  add('INCIDENT SNAPSHOT', 11, true, 18);
  add(`Status: ${text(p['event.status'])}    Severity: Level ${text(p['event.severity'])}    Category: ${text(p['event.category'])}`, 8);
  add(`Started: ${formatDate(text(p['event.start']))}`, 8);
  add(`Ended: ${formatDate(text(p['event.end']))}`, 8);
  add(`Duration: ${duration(text(p['event.start']), text(p['event.end']))}`, 8);
  add(`Root-cause entity: ${text(p['root_cause.smartscape_entity']) || text(p.root_cause_entity_id) || 'Not identified'}`, 8, false, 18);
  add('AI RCA', 11, true, 18);
  for (const line of lines) add(line.text, line.heading ? 10 : 8, !!line.heading, line.heading ? 17 : 12);
  if (y > 75) add(`Generated: ${new Date(result.generatedAt).toLocaleString()}`, 7, false, 10);
  flush();

  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', ''];
  const kids: string[] = [];
  const font1 = 3 + pages.length * 2;
  const font2 = font1 + 1;
  pages.forEach((content, index) => {
    const pageNo = 3 + index * 2;
    const streamNo = pageNo + 1;
    kids.push(`${pageNo} 0 R`);
    const stream = content.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font1} 0 R /F2 ${font2} 0 R >> >> /Contents ${streamNo} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => { offsets.push(out.length); out += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((x) => `${String(x).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.download = `Axis-RCA-${result.problemId}.pdf`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function installStyles() {
  if (document.getElementById(`${ID}-style`)) return;
  const style = document.createElement('style');
  style.id = `${ID}-style`;
  style.textContent = `#${ID}{margin:20px 0;border:1px solid #d7e1ec;border-radius:16px;background:#fff;box-shadow:0 10px 34px rgba(25,55,90,.10);overflow:hidden;font-family:Inter,system-ui,sans-serif;color:#18263a}.rca-head{padding:22px 24px 16px;background:linear-gradient(135deg,#edf6ff,#fff)}.rca-eyebrow{font-size:10px;font-weight:800;letter-spacing:.14em;color:#1667c7}.rca-head h2{margin:6px 0 4px;font-size:24px}.rca-head p{margin:0;color:#61748b;font-size:12px}.rca-controls{display:flex;gap:10px;align-items:end;padding:16px 24px;border-top:1px solid #e1e8f0;border-bottom:1px solid #e1e8f0;background:#f7f9fb}.rca-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:800;color:#53657a}.rca-controls input{height:40px;width:260px;border:1px solid #c7d4e1;border-radius:8px;padding:0 12px;font-weight:600}.rca-run,.rca-pdf{height:40px;border-radius:8px;padding:0 17px;font-weight:800;cursor:pointer}.rca-run{background:#174a7e;color:#fff;border:0}.rca-pdf{background:#fff;color:#174a7e;border:1px solid #b8c8d8}.rca-run:disabled,.rca-pdf:disabled{opacity:.45;cursor:not-allowed}.rca-status{padding:10px 24px;font-size:11px;color:#60748a}.rca-body{padding:0 24px 24px;max-height:760px;overflow:auto}.rca-summary{display:grid;grid-template-columns:repeat(6,minmax(100px,1fr));gap:8px;margin:10px 0 18px}.rca-card{padding:11px 12px;border:1px solid #dfe7ef;border-radius:9px;background:#f9fbfd}.rca-card span{display:block;font-size:9px;color:#728398;text-transform:uppercase;letter-spacing:.06em}.rca-card strong{display:block;margin-top:4px;font-size:13px}.rca-analysis{white-space:pre-wrap;font-size:12px;line-height:1.58;color:#24364a}.rca-section{margin-top:18px;padding-top:14px;border-top:1px solid #e3e9ef}.rca-section h3{font-size:12px;margin:0 0 9px;color:#193c63}.rca-table{width:100%;border-collapse:collapse;font-size:10px}.rca-table th,.rca-table td{text-align:left;padding:7px;border-bottom:1px solid #e8edf2;vertical-align:top}.rca-table th{background:#f3f6f9;color:#516276}.rca-badge{display:inline-block;padding:3px 7px;border-radius:999px;background:#edf5ff;color:#1b5fa8;font-size:9px;font-weight:800}.rca-error{margin:10px 24px;padding:11px 13px;background:#fff2f1;color:#a52b20;border-radius:8px;font-size:11px}.rca-progress{display:flex;gap:7px;flex-wrap:wrap;margin:4px 0 8px}.rca-progress span{padding:5px 8px;border-radius:999px;background:#edf7f1;color:#23724b;font-size:9px;font-weight:800}`;
  document.head.appendChild(style);
}

export function installAiRootCauseRcaV1() {
  if (document.getElementById(ID)) return;
  installStyles();
  const root = document.createElement('section');
  root.id = ID;
  root.innerHTML = `<div class="rca-head"><span class="rca-eyebrow">DYNATRACE ASSIST + DAVIS</span><h2>AI Root Cause & RCA</h2><p>Enter a Davis Problem ID and generate an evidence-backed incident investigation, recurrence analysis and customer-ready RCA.</p></div><div class="rca-controls"><label>Problem ID<input class="rca-id" placeholder="e.g. P-260838152" /></label><button class="rca-run">Analyze with Assist</button><button class="rca-pdf" disabled>Print RCA PDF</button></div><div class="rca-status">Ready for a Davis Problem ID.</div><div class="rca-body"></div>`;

  const mount = () => {
    if (document.getElementById(ID)) return;
    const heading = [...document.querySelectorAll('h1,h2')].find((node) => /Capacity at a glance/i.test(node.textContent ?? ''));
    if (!heading) return;
    const target = heading.closest('section') ?? heading.parentElement;
    target?.parentElement?.insertBefore(root, target);
  };
  mount();
  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });

  const input = root.querySelector<HTMLInputElement>('.rca-id')!;
  const run = root.querySelector<HTMLButtonElement>('.rca-run')!;
  const pdfButton = root.querySelector<HTMLButtonElement>('.rca-pdf')!;
  const status = root.querySelector<HTMLElement>('.rca-status')!;
  const body = root.querySelector<HTMLElement>('.rca-body')!;
  let last: RcaResult | null = null;

  const progress = (message: string) => {
    status.innerHTML = `<div class="rca-progress"><span>✓ Problem ID</span><span>✓ Davis evidence</span><span>✓ Timeline</span><span>✓ Recurrence</span><span>● Assist RCA</span></div>${esc(message)}`;
  };

  const render = (result: RcaResult) => {
    const p = result.evidence.problem;
    const affected = result.evidence.affectedEntities.map((r) => `<tr><td>${esc(text(r.affected_entity_ids))}</td><td>${esc(text(r.entityName) || 'Unresolved')}</td></tr>`).join('');
    const timeline = result.evidence.snapshots.slice(0, 20).map((r) => `<tr><td>${esc(formatDate(text(r.timestamp)))}</td><td>${esc(text(r.event_status_transition) || text(r['event.status']))}</td><td>${esc(text(r.event_name) || text(r['event.name']))}</td></tr>`).join('');
    const history = result.evidence.historical.slice(0, 15).map((r) => `<tr><td>${esc(text(r.display_id))}</td><td>${esc(formatDate(text(r['event.start'])))}</td><td>${esc(text(r['event.status']))}</td><td>${esc(duration(text(r['event.start']), text(r['event.end'])))}</td></tr>`).join('');
    const related = result.evidence.relatedProblems.slice(0, 15).map((r) => `<tr><td>${esc(text(r.display_id))}</td><td>${esc(text(r['event.name']))}</td><td>${esc(formatDate(text(r['event.start'])))}</td></tr>`).join('');
    body.innerHTML = `<div class="rca-summary"><div class="rca-card"><span>Problem</span><strong>${esc(result.problemId)}</strong></div><div class="rca-card"><span>Status</span><strong>${esc(text(p['event.status']))}</strong></div><div class="rca-card"><span>Severity</span><strong>Level ${esc(text(p['event.severity']))}</strong></div><div class="rca-card"><span>Category</span><strong>${esc(text(p['event.category']) || '—')}</strong></div><div class="rca-card"><span>Duration</span><strong>${esc(duration(text(p['event.start']), text(p['event.end'])))}</strong></div><div class="rca-card"><span>Past matches</span><strong>${result.evidence.historical.length}</strong></div></div><div class="rca-analysis">${esc(result.analysis)}</div><div class="rca-section"><h3>Affected entities</h3><table class="rca-table"><thead><tr><th>Entity ID</th><th>Name</th></tr></thead><tbody>${affected || '<tr><td colspan="2">No affected entities resolved.</td></tr>'}</tbody></table></div><div class="rca-section"><h3>Incident timeline</h3><table class="rca-table"><thead><tr><th>Time</th><th>Transition</th><th>Event</th></tr></thead><tbody>${timeline || '<tr><td colspan="3">No snapshot timeline was returned.</td></tr>'}</tbody></table></div><div class="rca-section"><h3>Past occurrences — same problem type</h3><table class="rca-table"><thead><tr><th>Problem</th><th>Start</th><th>Status</th><th>Duration</th></tr></thead><tbody>${history || '<tr><td colspan="4">No matching occurrences found.</td></tr>'}</tbody></table></div><div class="rca-section"><h3>Related problems on affected entities</h3><table class="rca-table"><thead><tr><th>Problem</th><th>Title</th><th>Start</th></tr></thead><tbody>${related || '<tr><td colspan="3">No related problems found.</td></tr>'}</tbody></table></div>`;
  };

  const analyze = async () => {
    const problemId = input.value.trim().toUpperCase();
    if (!/^P-[A-Z0-9]+$/i.test(problemId)) { status.textContent = 'Enter a valid Davis Problem ID such as P-260838152.'; return; }
    run.disabled = true; pdfButton.disabled = true; body.innerHTML = ''; last = null;
    try {
      progress(`Collecting evidence for ${problemId} from Grail…`);
      const evidence = await loadEvidence(problemId);
      progress('Evidence collected. Sending the evidence package to Dynatrace Assist…');
      const analysis = await askAssist(problemId, evidence);
      last = { problemId, evidence, analysis, generatedAt: new Date().toISOString() };
      render(last);
      pdfButton.disabled = false;
      status.textContent = `RCA generated by Dynatrace Assist · ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      body.innerHTML = `<div class="rca-error"><strong>RCA generation failed.</strong><br/>${esc(message)}</div>`;
      status.textContent = 'Investigation failed. No RCA was fabricated.';
    } finally { run.disabled = false; }
  };

  run.onclick = () => void analyze();
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') void analyze(); });
  pdfButton.onclick = () => { if (last) makePdf(last); };
}
