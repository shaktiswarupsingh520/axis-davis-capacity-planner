import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { ForecastHorizon, Host } from '@/types';
import type { DynatraceForecast } from './dynatraceIntelligence';
import { runCapacitySimulation } from './services/capacitySimulation';

export interface CapacityAiContext {
  managementZone: string;
  timeRange: string;
  forecastHorizon: ForecastHorizon;
  hosts: Host[];
  forecasts: Array<{ host: Host; forecast: DynatraceForecast }>;
  simulation?: {
    trafficGrowth: number;
    projectedCpu?: number;
    projectedMemory?: number;
    projectedDisk?: number;
    additionalHosts?: number;
    capacityGap?: number;
    risk?: string;
    currentTraffic?: number;
    projectedTraffic90d?: number;
  };
}

type QueryRecord = Record<string, unknown>;
interface QueryResult { records?: Array<QueryRecord | null> }
interface Nl2DqlResponse { dql?: string; status?: string; metadata?: unknown }

const MAX_CONTEXT = 9000;
const MAX_DQL_ROWS = 300;
const MAX_TOOL_ROUNDS = 3;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function executeDql(query: string): Promise<QueryRecord[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: MAX_DQL_ROWS },
  });
  let result = response.result as QueryResult | undefined;
  let token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`DQL tool did not complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as QueryRecord[];
}

function avg(hosts: Host[], key: 'cpu' | 'memory' | 'disk') {
  return hosts.length ? hosts.reduce((sum, h) => sum + (h.telemetry.at(-1)?.[key] ?? 0), 0) / hosts.length : 0;
}

function traffic(hosts: Host[]) {
  return hosts.reduce((sum, h) => sum + (h.telemetry.at(-1)?.throughput ?? 0), 0);
}

function buildSimulation(hosts: Host[], growth: number) {
  const currentTraffic = Math.max(1, traffic(hosts));
  const result = runCapacitySimulation({
    cpuCapacity: Math.max(1, avg(hosts, 'cpu')),
    memoryCapacity: Math.max(1, avg(hosts, 'memory')),
    diskCapacity: Math.max(1, avg(hosts, 'disk')),
    trafficGrowth: growth,
    transactionGrowth: growth,
    period: 90 as ForecastHorizon,
    additionalHosts: 0,
    cpuPerHost: 25,
    memoryPerHost: 25,
    diskPerHost: 20,
  });
  return {
    trafficGrowth: growth,
    currentTraffic,
    projectedTraffic90d: currentTraffic * (1 + growth / 100),
    projectedCpu: result.projectedCpu,
    projectedMemory: result.projectedMemory,
    projectedDisk: result.projectedDisk,
    additionalHosts: result.requiredHosts,
    capacityGap: result.capacityGap,
    risk: result.risk,
  };
}

function compactHosts(hosts: Host[]) {
  return hosts.map((h) => {
    const p = h.telemetry.at(-1);
    return {
      name: h.name,
      id: h.id,
      environment: h.environment,
      application: h.application,
      profile: h.profile,
      managementZones: h.managementZones,
      cpu: Math.round(p?.cpu ?? 0),
      memory: Math.round(p?.memory ?? 0),
      disk: Math.round(p?.disk ?? 0),
      networkRx: Math.round(p?.networkRx ?? 0),
      networkTx: Math.round(p?.networkTx ?? 0),
      throughput: Math.round(p?.throughput ?? 0),
    };
  });
}

function compactForecasts(forecasts: CapacityAiContext['forecasts']) {
  return forecasts.map(({ host, forecast }) => ({
    host: host.name,
    metric: forecast.metric,
    source: forecast.source,
    status: forecast.status,
    horizon: forecast.horizon,
    peakForecast: forecast.forecast.length ? Math.round(Math.max(...forecast.forecast)) : null,
    peakUpperBound: forecast.upperBound.length ? Math.round(Math.max(...forecast.upperBound)) : null,
    quality: forecast.quality,
  }));
}

function answerText(response: unknown): string {
  const r = response as { text?: string; answer?: string; content?: string };
  return String(r.text ?? r.answer ?? r.content ?? '').trim();
}

function extractDql(response: unknown) {
  const r = response as Nl2DqlResponse;
  return String(r.dql ?? '').trim();
}

function parseGrowth(question: string) {
  const m = question.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!m || !/(traffic|request|load|throughput)/i.test(question)) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 && n <= 500 ? n : null;
}

function buildPrompt(question: string, context: CapacityAiContext, toolResults: Array<{ tool: string; input?: string; result: unknown }>, round: number) {
  const payload = {
    selectedScope: context.managementZone || 'All Management Zones',
    timeRange: context.timeRange,
    forecastHorizon: context.forecastHorizon,
    liveHosts: compactHosts(context.hosts),
    forecasts: compactForecasts(context.forecasts),
    simulation: context.simulation ?? null,
    toolResults,
    agentRound: round,
  };
  const text = `You are Davis, an interactive capacity-planning agent for the Axis Bank SRE team. You have a bounded tool loop. Use ONLY the supplied live Dynatrace context and tool results. Never invent telemetry, forecasts, host names, problem counts, or recommendations. The user asked: ${question}\n\nAGENT CONTEXT:\n${JSON.stringify(payload)}\n\nAnswer the user directly. Explain which live/tool evidence supports the answer. For what-if questions, use exact simulation values. For arbitrary data questions, use the executed DQL result rather than guessing. If data is unavailable, say so clearly. Keep the answer under 400 words.`;
  return text.length <= MAX_CONTEXT ? text : `${text.slice(0, MAX_CONTEXT - 180)}\n\n[Context truncated by the safety limit. Do not infer omitted data.]`;
}

export async function askAgenticDavis(question: string, context: CapacityAiContext): Promise<string> {
  const q = question.trim();
  if (!q) throw new Error('Please enter a capacity-planning question.');

  const toolResults: Array<{ tool: string; input?: string; result: unknown }> = [];
  const growth = parseGrowth(q);
  if (growth !== null) {
    const simulation = buildSimulation(context.hosts, growth);
    context = { ...context, simulation };
    toolResults.push({ tool: 'capacity_simulation', input: `${growth}% traffic growth`, result: simulation });
  }

  let dql = '';
  let dqlRows: QueryRecord[] = [];
  let lastToolError = '';

  for (let round = 1; round <= MAX_TOOL_ROUNDS; round += 1) {
    try {
      const nl = await publicClient.nl2dql({
        body: {
          text: `Generate ONE read-only DQL query to answer this capacity-planning question for Management Zone \"${context.managementZone}\": ${q}. Prefer hosts, timeseries, spans, events/problems and capacity-relevant fields available to this app. Return only executable DQL. Do not mutate data.`,
        },
      });
      dql = extractDql(nl);
      if (!dql) throw new Error('Davis NL-to-DQL returned no query.');
      dqlRows = await executeDql(dql);
      toolResults.push({ tool: 'grail_dql', input: dql, result: dqlRows.slice(0, 100) });
      lastToolError = '';
      break;
    } catch (error) {
      lastToolError = error instanceof Error ? error.message : String(error);
      toolResults.push({ tool: 'grail_dql_error', input: dql || 'NL-to-DQL', result: lastToolError });
      if (round === MAX_TOOL_ROUNDS) break;
    }
  }

  const finalPrompt = buildPrompt(q, context, toolResults, toolResults.length + 1);
  if (lastToolError && !dqlRows.length) {
    toolResults.push({ tool: 'agent_note', result: `The DQL tool failed: ${lastToolError}. Use only the remaining supplied context.` });
  }

  const response = await publicClient.recommenderConversation({
    body: {
      text: finalPrompt.slice(0, MAX_CONTEXT),
      context: [
        { type: 'instruction', value: 'You are the final synthesis step of a tool-using capacity agent. Do not fabricate tool results. Mention limitations explicitly.' },
        { type: 'supplementary', value: JSON.stringify({ dql, dqlRows: dqlRows.slice(0, 100), toolResults }).slice(0, MAX_CONTEXT - 500) },
      ],
    },
  });

  const answer = answerText(response);
  if (!answer) throw new Error('Davis agent returned an empty assessment.');
  return answer;
}

export const suggestedCapacityQuestions = [
  'Which hosts are closest to CPU capacity?',
  'What are the top capacity risks in this Management Zone?',
  'What happens if traffic increases by 48%?',
  'Which resource is the primary capacity constraint?',
  'How many infrastructure problems were generated in the last 30 days?',
  'What should I do about the highest-risk hosts?',
  'Show the main capacity trend for the selected scope.',
];
