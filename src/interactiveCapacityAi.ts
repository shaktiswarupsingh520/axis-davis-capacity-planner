import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import type { ForecastHorizon, Host } from '@/types';
import type { DynatraceForecast } from './dynatraceIntelligence';

export interface CapacityAiContext {
  managementZone: string;
  timeRange: string;
  forecastHorizon: ForecastHorizon;
  hosts: Host[];
  forecasts: Array<{ host: Host; forecast: DynatraceForecast }>;
  simulation?: { trafficGrowth: number; projectedCpu?: number; projectedMemory?: number; projectedDisk?: number; additionalHosts?: number; capacityGap?: number; };
}

// Dynatrace Davis recommenderConversation rejects text >= 10000 characters.
// Keep a safety margin for all questions, scopes and serialized telemetry.
const MAX_CONTEXT = 9000;

function compactContext(context: CapacityAiContext) {
  const hosts = context.hosts.map((h) => { const p = h.telemetry.at(-1); return { name: h.name, id: h.id, environment: h.environment, application: h.application, profile: h.profile, managementZones: h.managementZones, cpu: Math.round(p?.cpu ?? 0), memory: Math.round(p?.memory ?? 0), disk: Math.round(p?.disk ?? 0), networkRx: Math.round(p?.networkRx ?? 0), networkTx: Math.round(p?.networkTx ?? 0), throughput: Math.round(p?.throughput ?? 0) }; });
  const forecasts = context.forecasts.map(({ host, forecast }) => ({ host: host.name, metric: forecast.metric, source: forecast.source, status: forecast.status, horizon: forecast.horizon, peakForecast: forecast.forecast.length ? Math.round(Math.max(...forecast.forecast)) : null, peakUpperBound: forecast.upperBound.length ? Math.round(Math.max(...forecast.upperBound)) : null, quality: forecast.quality }));
  return { managementZone: context.managementZone, timeRange: context.timeRange, forecastHorizon: context.forecastHorizon, hosts, forecasts, simulation: context.simulation ?? null };
}

function buildPrompt(question: string, context: CapacityAiContext) {
  const prompt = `You are Davis, an interactive capacity-planning advisor for an Axis Bank SRE team. Answer the user's capacity-planning question using ONLY the live Dynatrace context supplied below. Never invent telemetry, forecasts, host names, capacity gaps, problem counts, or recommendations. If the supplied data is insufficient, say exactly what is missing.\n\nSelected scope: ${context.managementZone || 'All Management Zones'}\nQuestion: ${question}\n\nLIVE CAPACITY CONTEXT:\n${JSON.stringify(compactContext(context))}\n\nAnswer directly and practically. For numerical questions, show relevant values and units. For risk questions, name affected hosts when available. For recommendations, distinguish observed facts from forecast/simulation results. If a requested data type is not present in the supplied context, explicitly say it is not available rather than guessing. If a simulation is supplied, use its exact values. Keep the response under 400 words. Use concise headings and bullets when useful.`;

  // Hard cap the exact payload field, leaving a generous margin below the API limit.
  if (prompt.length <= MAX_CONTEXT) return prompt;
  return `${prompt.slice(0, MAX_CONTEXT - 180)}\n\n[Context truncated to fit the Davis API payload limit.]\nUse only the context included above and do not infer omitted data.`;
}

export async function askCapacityDavis(question: string, context: CapacityAiContext): Promise<string> {
  const q = question.trim();
  if (!q) throw new Error('Please enter a capacity-planning question.');
  const text = buildPrompt(q, context);
  // Defensive guard: never send a payload that can violate the Davis API text constraint.
  const safeText = text.length > 9000 ? text.slice(0, 9000) : text;
  const response = await publicClient.recommenderConversation({ body: { text: safeText, context: [{ type: 'instruction', value: 'You are answering a live capacity-planning question. Use only the supplied Dynatrace context. Do not expose internal reasoning or claim access to data not supplied.' }] } });
  const answer = (response as unknown as { text?: string }).text?.trim();
  if (!answer) throw new Error('Davis returned an empty assessment.');
  return answer;
}

export const suggestedCapacityQuestions = ['Which hosts are closest to CPU capacity?','What are the top capacity risks in this Management Zone?','What happens if traffic increases by 48%?','Which resource is the primary capacity constraint?','What should I do about the highest-risk hosts?','Summarize the capacity outlook for the next 30 days.'];
