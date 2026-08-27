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
        origin: 'Axis Davis Capacity Planner RCA',
        problemId,
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
