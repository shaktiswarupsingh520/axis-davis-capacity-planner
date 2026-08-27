import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;
type QueryResult = { records?: Array<Row | null> };
type RecommenderConversation = typeof publicClient.recommenderConversation;
type ConversationArgs = Parameters<RecommenderConversation>[0];

const PANEL_ID = 'axis-rca-v60';
const MARK = 'data-axis-rca-recovery-v63';

const asText = (v: unknown): string => Array.isArray(v) ? v.map(asText).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const esc = (v: string) => v.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
const dqlEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function runDql(query: string, max = 100): Promise<Row[]> {
  const started = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: max } });
  let result = started.result as QueryResult | undefined;
  let state = started.state;
  if (!result && started.requestToken) {
    for (let i = 0; i < 30; i += 1) {
      const polled = await queryExecutionClient.queryPoll({ requestToken: started.requestToken, requestTimeoutMilliseconds: 30000 });
      state = polled.state;
      result = polled.result as QueryResult | undefined;
      if (result || state !== 'RUNNING') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!result) throw new Error(`DQL failed to complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as Row[];
}

function extractAssistText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return '';
  const v = value as Record<string, unknown>;
  for (const key of ['text', 'answer', 'content', 'message']) {
    const candidate = extractAssistText(v[key]);
    if (candidate) return candidate;
  }
  const tokens = Array.isArray(v.tokens) ? v.tokens.map(asText).join('') : '';
  return tokens.trim();
}

function pdfEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, ' ');
}

function createRcaPdf(problem: Row, problemId: string, answer: string, history: Row[]) {
  const lines: string[] = [];
  const addWrapped = (value: string, width = 105) => {
    value.split(/\r?\n/).forEach(raw => {
      const line = raw.trimEnd();
      if (!line) { lines.push(''); return; }
      let remaining = line;
      while (remaining.length > width) {
        let cut = remaining.lastIndexOf(' ', width);
        if (cut < 25) cut = width;
        lines.push(remaining.slice(0, cut));
        remaining = remaining.slice(cut).trimStart();
      }
      lines.push(remaining);
    });
  };
  lines.push('AXIS BANK | ApMoSys TECHNOLOGIES');
  lines.push('AI-Assisted Incident Root Cause Analysis');
  lines.push(`Problem ID: ${problemId}`);
  lines.push(`Generated: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(`Status: ${asText(problem['event.status']) || '—'}    Severity: Level ${asText(problem['event.severity']) || '—'}`);
  lines.push(`Category: ${asText(problem['event.category']) || '—'}`);
  lines.push(`Incident: ${asText(problem['event.name']) || '—'}`);
  lines.push(`Started: ${asText(problem['event.start']) || '—'}`);
  lines.push(`Ended: ${asText(problem['event.end']) || '—'}`);
  lines.push(`Root cause: ${asText(problem['root_cause.smartscape_entity']) || asText(problem.root_cause_entity_id) || 'Not identified'}`);
  lines.push(`Affected users: ${asText(problem['dt.davis.affected_users_count']) || 'Not available'}`);
  lines.push('');
  lines.push('AI ROOT CAUSE ANALYSIS');
  addWrapped(answer);
  lines.push('');
  lines.push('PAST OCCURRENCES');
  if (!history.length) lines.push('No matching past occurrences found.');
  history.slice(0, 20).forEach(x => addWrapped(`${asText(x.display_id)} | ${asText(x['event.start'])} | ${asText(x['event.status'])} | Root cause: ${asText(x['root_cause.smartscape_entity']) || '—'}`));
  lines.push('');
  addWrapped('RCA governance: Dynatrace evidence is separated from AI inference. Recommendations are proposed actions and must be validated by the responsible SRE/application team.');

  const perPage = 48;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
  if (!pages.length) pages.push([]);

  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids: string[] = [];
  const pageObjects: Array<{ page: number; content: number }> = [];
  let next = 3;
  pages.forEach(() => { pageObjects.push({ page: next, content: next + 1 }); kids.push(`${next} 0 R`); next += 2; });
  objects.push(`<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((pageLines, idx) => {
    const pageNo = pageObjects[idx].page;
    const contentNo = pageObjects[idx].content;
    const commands: string[] = ['BT', '/F1 9 Tf', '40 755 Td', '12 TL'];
    pageLines.forEach((line, lineIndex) => {
      const size = lineIndex === 1 ? 15 : lineIndex === 0 ? 10 : 9;
      if (lineIndex > 0) commands.push('0 -12 Td');
      commands.push(`/F${lineIndex === 0 || lineIndex === 1 ? 2 : 1} ${size} Tf (${pdfEscape(line)}) Tj`);
    });
    commands.push('ET');
    const stream = commands.join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${next} 0 R /F2 ${next + 1} 0 R >> >> /Contents ${contentNo} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const font1 = next;
  const font2 = next + 1;
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(x => `${String(x).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Axis-RCA-${problemId}.pdf`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function analyze(problemId: string, status: HTMLElement, body: HTMLElement, pdf: HTMLButtonElement) {
  const id = dqlEscape(problemId);
  status.textContent = `Collecting ${problemId}: Davis problem and recurrence evidence…`;
  body.innerHTML = '';
  pdf.disabled = true;

  const problems = await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == "${id}"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids\n| limit 1`, 5);
  if (!problems.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);

  const problem = problems[0];
  const name = asText(problem['event.name']);
  const history = name ? await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == "${dqlEscape(name)}"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity\n| sort event.start desc\n| limit 30`, 30).catch(() => []) : [];

  const evidence = JSON.stringify({ problem: {
    id: asText(problem.display_id), title: name, status: asText(problem['event.status']), severity: asText(problem['event.severity']),
    category: asText(problem['event.category']), start: asText(problem['event.start']), end: asText(problem['event.end']),
    description: asText(problem['event.description']), rootCause: asText(problem['root_cause.smartscape_entity']) || asText(problem.root_cause_entity_id),
    impact: asText(problem['dt.davis.impact_level']), affectedUsers: asText(problem['dt.davis.affected_users_count'])
  }, pastOccurrences: history }).slice(0, 12000);

  status.textContent = `Evidence collected (${history.length} matching occurrences). Asking Dynatrace Assist…`;
  const prompt = `You are the senior Dynatrace SRE RCA analyst for the Axis Davis Capacity Planner. Analyze the supplied Davis Problem evidence and produce a concise customer-ready RCA. Use only supplied facts. Clearly distinguish proven root cause from inference. If root cause is not proven, say Not proven by available evidence. Include: Executive Summary, Incident Overview, Root Cause Assessment, Technical Root-Cause Chain, Past Occurrences & Recurrence Pattern, Immediate Remediation Plan, Permanent / Preventive Actions, Monitoring & Alerting Recommendations, Validation Checklist, RCA Confidence & Evidence Gaps.\n\nDYNATRACE EVIDENCE:\n${evidence}`;
  const args = { body: { text: prompt, context: [
    { type: 'document-retrieval', value: 'disabled' },
    { type: 'supplementary', value: evidence },
    { type: 'instruction', value: 'Treat supplementary context as authoritative incident evidence. Do not claim lack of access.' }
  ] } } as ConversationArgs;
  const response = await publicClient.recommenderConversation(args);
  const answer = extractAssistText(response) || asText(response);
  if (!answer) throw new Error('Dynatrace Assist returned an empty response.');

  body.innerHTML = `<div class="rca60-grid"><div class="rca60-card"><span>Problem</span><strong>${esc(problemId)}</strong></div><div class="rca60-card"><span>Status</span><strong>${esc(asText(problem['event.status']) || '—')}</strong></div><div class="rca60-card"><span>Severity</span><strong>Level ${esc(asText(problem['event.severity']) || '—')}</strong></div><div class="rca60-card"><span>Category</span><strong>${esc(asText(problem['event.category']) || '—')}</strong></div><div class="rca60-card"><span>Past occurrences</span><strong>${history.length}</strong></div></div><div class="rca60-analysis">${esc(answer)}</div>`;
  pdf.disabled = false;
  pdf.textContent = 'Download RCA PDF';
  pdf.onclick = () => {
    try { createRcaPdf(problem, problemId, answer, history); status.textContent = `RCA PDF downloaded for ${problemId}.`; }
    catch (error) { status.textContent = `PDF generation failed: ${error instanceof Error ? error.message : String(error)}`; }
  };
  status.textContent = 'RCA generated successfully by the V63 recovery handler.';
}

export function installRcaButtonRecoveryV63() {
  const bind = () => {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const run = root.querySelector<HTMLButtonElement>('.rca60-run');
    const input = root.querySelector<HTMLInputElement>('.rca60-id');
    const status = root.querySelector<HTMLElement>('.rca60-status');
    const body = root.querySelector<HTMLElement>('.rca60-body');
    const pdf = root.querySelector<HTMLButtonElement>('.rca60-pdf');
    if (!run || !input || !status || !body || !pdf || run.getAttribute(MARK) === 'true') return;
    run.setAttribute(MARK, 'true');
    run.onclick = async () => {
      const id = input.value.trim().toUpperCase();
      if (!/^P-[A-Z0-9]+$/i.test(id)) { status.textContent = 'Enter a valid Davis Problem ID.'; input.focus(); return; }
      run.disabled = true;
      try { await analyze(id, status, body, pdf); }
      catch (error) { body.innerHTML = `<div class="rca60-error">${esc(error instanceof Error ? error.message : String(error))}</div>`; status.textContent = 'RCA generation failed.'; pdf.disabled = true; }
      finally { run.disabled = false; }
    };
    input.addEventListener('keydown', event => { if (event.key === 'Enter') run.click(); });
  };
  bind();
  const observer = new MutationObserver(bind);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(bind, 250);
  window.setTimeout(bind, 1000);
}
