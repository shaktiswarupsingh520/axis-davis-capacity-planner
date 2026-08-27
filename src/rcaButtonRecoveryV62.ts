import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type Row = Record<string, unknown>;

type QueryResult = { records?: Array<Row | null> };

const PANEL_ID = 'axis-rca-v60';
const MARK = 'data-axis-rca-recovery-v62';

const asText = (v: unknown): string => Array.isArray(v) ? v.map(asText).filter(Boolean).join('; ') : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
const esc = (v: string) => v.replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]!));
const dqlEscape = (v: string) => v.replace(/\\/g, '\\\\').replace(/\"/g, '\\\"');

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
  if (tokens) return tokens.trim();
  return '';
}

async function analyze(problemId: string, status: HTMLElement, body: HTMLElement) {
  const id = dqlEscape(problemId);
  status.textContent = `Collecting ${problemId}: Davis problem and recurrence evidence…`;
  body.innerHTML = '';

  const problems = await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and display_id == \"${id}\"\n| fields display_id,event.id,event.name,event.status,event.severity,event.category,event.start,event.end,event.description,dt.davis.event_ids,dt.davis.impact_level,dt.davis.affected_users_count,root_cause_entity_id,root_cause.smartscape_entity,affected_entity_ids\n| limit 1`, 5);
  if (!problems.length) throw new Error(`Problem ${problemId} was not found in the last 365 days.`);

  const problem = problems[0];
  const name = asText(problem['event.name']);
  const history = name ? await runDql(`fetch dt.davis.problems, from:now()-365d, to:now()\n| filter not(dt.davis.is_duplicate) and event.name == \"${dqlEscape(name)}\"\n| fields display_id,event.name,event.status,event.severity,event.start,event.end,resolved_problem_duration,root_cause.smartscape_entity\n| sort event.start desc\n| limit 30`, 30).catch(() => []) : [];

  const evidence = JSON.stringify({
    problem: {
      id: asText(problem.display_id),
      title: name,
      status: asText(problem['event.status']),
      severity: asText(problem['event.severity']),
      category: asText(problem['event.category']),
      start: asText(problem['event.start']),
      end: asText(problem['event.end']),
      description: asText(problem['event.description']),
      rootCause: asText(problem['root_cause.smartscape_entity']) || asText(problem.root_cause_entity_id),
      impact: asText(problem['dt.davis.impact_level']),
      affectedUsers: asText(problem['dt.davis.affected_users_count'])
    },
    pastOccurrences: history
  }).slice(0, 12000);

  status.textContent = `Evidence collected (${history.length} matching occurrences). Asking Dynatrace Assist…`;
  const prompt = `You are the senior Dynatrace SRE RCA analyst for the Axis Davis Capacity Planner. Analyze the supplied Davis Problem evidence and produce a concise customer-ready RCA. Use only supplied facts. Clearly distinguish proven root cause from inference. If root cause is not proven, say Not proven by available evidence. Include: Executive Summary, Incident Overview, Root Cause Assessment, Technical Root-Cause Chain, Past Occurrences & Recurrence Pattern, Immediate Remediation Plan, Permanent / Preventive Actions, Monitoring & Alerting Recommendations, Validation Checklist, RCA Confidence & Evidence Gaps.\n\nDYNATRACE EVIDENCE:\n${evidence}`;

  const response = await publicClient.recommenderConversation({
    acceptType: 'application/json',
    body: {
      text: prompt,
      context: [
        { type: 'document-retrieval', value: 'disabled' },
        { type: 'supplementary', value: evidence },
        { type: 'instruction', value: 'Treat supplementary context as authoritative incident evidence. Do not claim lack of access.' }
      ]
    }
  });

  const answer = extractAssistText(response) || asText(response);
  if (!answer) throw new Error('Dynatrace Assist returned an empty response.');

  body.innerHTML = `<div class=\"rca60-grid\"><div class=\"rca60-card\"><span>Problem</span><strong>${esc(problemId)}</strong></div><div class=\"rca60-card\"><span>Status</span><strong>${esc(asText(problem['event.status']) || '—')}</strong></div><div class=\"rca60-card\"><span>Severity</span><strong>Level ${esc(asText(problem['event.severity']) || '—')}</strong></div><div class=\"rca60-card\"><span>Category</span><strong>${esc(asText(problem['event.category']) || '—')}</strong></div><div class=\"rca60-card\"><span>Past occurrences</span><strong>${history.length}</strong></div></div><div class=\"rca60-analysis\">${esc(answer)}</div>`;
  status.textContent = 'RCA generated successfully by the V62 recovery handler.';
}

export function installRcaButtonRecoveryV62() {
  const bind = () => {
    const root = document.getElementById(PANEL_ID);
    if (!root) return;
    const run = root.querySelector<HTMLButtonElement>('.rca60-run');
    const input = root.querySelector<HTMLInputElement>('.rca60-id');
    const status = root.querySelector<HTMLElement>('.rca60-status');
    const body = root.querySelector<HTMLElement>('.rca60-body');
    if (!run || !input || !status || !body || run.getAttribute(MARK) === 'true') return;

    run.setAttribute(MARK, 'true');
    run.onclick = async () => {
      const id = input.value.trim().toUpperCase();
      if (!/^P-[A-Z0-9]+$/i.test(id)) {
        status.textContent = 'Enter a valid Davis Problem ID.';
        input.focus();
        return;
      }
      run.disabled = true;
      try {
        await analyze(id, status, body);
      } catch (error) {
        body.innerHTML = `<div class=\"rca60-error\">${esc(error instanceof Error ? error.message : String(error))}</div>`;
        status.textContent = 'RCA generation failed.';
      } finally {
        run.disabled = false;
      }
    };
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') run.click();
    });
  };

  bind();
  const observer = new MutationObserver(bind);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(bind, 250);
  window.setTimeout(bind, 1000);
}
