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
  simulation?: { trafficGrowth: number; projectedCpu?: number; projectedMemory?: number; projectedDisk?: number; additionalHosts?: number; capacityGap?: number; risk?: string; currentTraffic?: number; projectedTraffic90d?: number; };
  problems?: { windowDays: number; total: number; active: number; topCategories: Array<{ category: string; count: number }>; topProblems: Array<{ title: string; count: number }>; };
}

const MAX_CONTEXT = 9000;
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const toNum = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };

async function executeDql<T>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 1000 } });
  let result = response.result as QueryResult | undefined;
  let token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`DQL query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as T[];
}

function needsProblemContext(question: string) {
  return /\b(problem|problems|incident|incidents|issue|issues|outage|outages)\b/i.test(question);
}

function requestedDays(question: string) {
  const match = question.match(/last\s+(\d+)\s+days?/i);
  const days = match ? Number(match[1]) : 30;
  return Number.isFinite(days) ? Math.min(Math.max(days, 1), 90) : 30;
}

function requestedTrafficGrowth(question: string): number | null {
  const match = question.match(/(\d+(?:\.\d+)?)\s*%/);
  if (!match || !/(traffic|request|load)/i.test(question)) return null;
  const growth = Number(match[1]);
  return Number.isFinite(growth) && growth >= 0 && growth <= 500 ? growth : null;
}

async function getProblemContext(hosts: Host[], days: number) {
  if (!hosts.length) return { windowDays: days, total: 0, active: 0, topCategories: [], topProblems: [] };
  const ids = hosts.map((h) => h.id).filter(Boolean).slice(0, 300).map((id) => `"${escapeDql(id)}"`).join(', ');
  if (!ids) return { windowDays: days, total: 0, active: 0, topCategories: [], topProblems: [] };
  const base = `fetch dt.davis.problems, from:now()-${days}d, to:now() | filter not(dt.davis.is_duplicate) | expand affected_entity_ids | filter in(affected_entity_ids, ${ids})`;
  const [countRows, activeRows, categoryRows, problemRows] = await Promise.all([
    executeDql<Record<string, unknown>>(`${base} | summarize problemCount=countDistinct(event.id)`),
    executeDql<Record<string, unknown>>(`${base} | filter event.status == "ACTIVE" | summarize activeCount=countDistinct(event.id)`),
    executeDql<Record<string, unknown>>(`${base} | summarize count=countDistinct(event.id), by:{event.category} | sort count, direction:"descending" | limit 5`),
    executeDql<Record<string, unknown>>(`${base} | summarize count=countDistinct(event.id), by:{event.name} | sort count, direction:"descending" | limit 5`),
  ]);
  return {
    windowDays: days,
    total: Math.round(toNum(countRows[0]?.problemCount)),
    active: Math.round(toNum(activeRows[0]?.activeCount)),
    topCategories: categoryRows.map((r) => ({ category: String(r['event.category'] ?? 'Unknown'), count: Math.round(toNum(r.count)) })),
    topProblems: problemRows.map((r) => ({ title: String(r['event.name'] ?? 'Unnamed problem'), count: Math.round(toNum(r.count)) })),
  };
}

function avgCurrent(hosts: Host[], key: 'cpu' | 'memory' | 'disk') { return hosts.length ? hosts.reduce((sum, h) => sum + (h.telemetry.at(-1)?.[key] ?? 0), 0) / hosts.length : 0; }
function currentTraffic(hosts: Host[]) { return hosts.reduce((sum, h) => sum + (h.telemetry.at(-1)?.throughput ?? 0), 0); }

function buildSimulationContext(hosts: Host[], growth: number) {
  const cpu = Math.max(1, avgCurrent(hosts, 'cpu'));
  const memory = Math.max(1, avgCurrent(hosts, 'memory'));
  const disk = Math.max(1, avgCurrent(hosts, 'disk'));
  const traffic = Math.max(1, currentTraffic(hosts));
  const result = runCapacitySimulation({ cpuCapacity: cpu, memoryCapacity: memory, diskCapacity: disk, trafficGrowth: growth, transactionGrowth: growth, period: 90, additionalHosts: 0, cpuPerHost: 25, memoryPerHost: 25, diskPerHost: 20 });
  return { trafficGrowth: growth, projectedCpu: result.projectedCpu, projectedMemory: result.projectedMemory, projectedDisk: result.projectedDisk, additionalHosts: result.requiredHosts, capacityGap: result.capacityGap, risk: result.risk, currentTraffic: traffic, projectedTraffic90d: traffic * Math.pow(1 + growth / 100, 1) };
}

function compactContext(context: CapacityAiContext) {
  const hosts = context.hosts.map((h) => { const p = h.telemetry.at(-1); return { name: h.name, id: h.id, environment: h.environment, application: h.application, profile: h.profile, managementZones: h.managementZones, cpu: Math.round(p?.cpu ?? 0), memory: Math.round(p?.memory ?? 0), disk: Math.round(p?.disk ?? 0), networkRx: Math.round(p?.networkRx ?? 0), networkTx: Math.round(p?.networkTx ?? 0), throughput: Math.round(p?.throughput ?? 0) }; });
  const forecasts = context.forecasts.map(({ host, forecast }) => ({ host: host.name, metric: forecast.metric, source: forecast.source, status: forecast.status, horizon: forecast.horizon, peakForecast: forecast.forecast.length ? Math.round(Math.max(...forecast.forecast)) : null, peakUpperBound: forecast.upperBound.length ? Math.round(Math.max(...forecast.upperBound)) : null, quality: forecast.quality }));
  return { managementZone: context.managementZone, timeRange: context.timeRange, forecastHorizon: context.forecastHorizon, hosts, forecasts, simulation: context.simulation ?? null, problems: context.problems ?? null };
}

function buildPrompt(question: string, context: CapacityAiContext) {
  const prompt = `You are Davis, an interactive capacity-planning advisor for an Axis Bank SRE team. Answer the user's question using ONLY the live Dynatrace context supplied below. Never invent telemetry, forecasts, host names, capacity gaps, problem counts, or recommendations. If the supplied data is insufficient, say exactly what is missing.\n\nSelected scope: ${context.managementZone || 'All Management Zones'}\nQuestion: ${question}\n\nLIVE CAPACITY CONTEXT:\n${JSON.stringify(compactContext(context))}\n\nAnswer directly and practically. For numerical questions, show values and units. For problem questions, use the supplied problem count/status/category data. For traffic what-if questions, use the supplied 90-day simulation values and exact traffic growth. For risk questions, name affected hosts when available. Distinguish observed facts from forecast/simulation results. Keep the response under 400 words with concise headings and bullets.`;
  if (prompt.length <= MAX_CONTEXT) return prompt;
  return `${prompt.slice(0, MAX_CONTEXT - 180)}\n\n[Context truncated to fit the Davis API payload limit.]\nUse only the context included above and do not infer omitted data.`;
}

export async function askCapacityDavis(question: string, context: CapacityAiContext): Promise<string> {
  const q = question.trim();
  if (!q) throw new Error('Please enter a capacity-planning question.');
  const growth = requestedTrafficGrowth(q);
  const enriched: CapacityAiContext = { ...context, simulation: growth !== null ? buildSimulationContext(context.hosts, growth) : context.simulation };
  if (needsProblemContext(q)) {
    enriched.problems = await getProblemContext(context.hosts, requestedDays(q));
  }
  const response = await publicClient.recommenderConversation({ body: { text: buildPrompt(q, enriched).slice(0, MAX_CONTEXT), context: [{ type: 'instruction', value: 'You are answering a live capacity-planning question. Use only the supplied Dynatrace context. Do not expose internal reasoning or claim access to data not supplied.' }] } });
  const answer = (response as unknown as { text?: string }).text?.trim();
  if (!answer) throw new Error('Davis returned an empty assessment.');
  return answer;
}

export const suggestedCapacityQuestions = ['Which hosts are closest to CPU capacity?','What are the top capacity risks in this Management Zone?','What happens if traffic increases by 48%?','Which resource is the primary capacity constraint?','How many infrastructure problems were generated in the last 30 days?','What should I do about the highest-risk hosts?','Summarize the capacity outlook for the next 30 days.'];
