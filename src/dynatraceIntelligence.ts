import { analyzersClient } from '@dynatrace-sdk/client-davis-analyzers';
import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { ForecastHorizon, Host, MetricKey } from '@/types';

const ANALYZER = 'dt.statistics.GenericForecastAnalyzer';
const MAX_ASSIST_TEXT = 9000;
const FORECAST_CONCURRENCY = 5;

export interface DynatraceForecast { metric: MetricKey; horizon: ForecastHorizon; historical: number[]; forecast: number[]; lowerBound: number[]; upperBound: number[]; forecastStart: string | null; forecastEnd: string | null; quality: string; status: string; source: 'Dynatrace Intelligence' | 'fallback'; scopeHostCount?: number; error?: string; }
export interface AiCapacitySummary { text: string; generatedAt: string; source: 'Dynatrace Assist' | 'fallback'; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
interface VerifiedThroughput { requestsPerMinute: number; requestCount: number; serviceCount: number; }

const metricName = (metric: MetricKey) => metric === 'cpu' ? 'dt.host.cpu.usage' : metric === 'memory' ? 'dt.host.memory.usage' : 'dt.host.disk.used.percent';
const numericArray = (value: unknown): number[] => Array.isArray(value) ? value.map((v) => typeof v === 'number' && Number.isFinite(v) ? v : Number(v)).filter(Number.isFinite) : [];
const escapeDql = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql<T>(query: string, timeout = 30000): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: timeout, maxResultRecords: 1000 } });
  let result = response.result as QueryResult | undefined;
  let token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 20; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: timeout });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await new Promise((resolve) => setTimeout(resolve, 350));
  }
  if (!result) throw new Error(`DQL query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as T[];
}

async function pollForecast(requestToken: string) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await analyzersClient.pollAnalyzerExecution({ analyzerName: ANALYZER, requestToken, timeoutSeconds: 2 });
    if (response.result.executionStatus === 'COMPLETED') return response.result;
    if (response.result.executionStatus === 'ABORTED') throw new Error('Dynatrace Intelligence forecast was aborted.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Dynatrace Intelligence forecast did not complete within 30 seconds. The application stopped waiting so the UI remains responsive.');
}

function scopedExpression(hosts: Host[], metric: MetricKey) {
  const ids = hosts.map((host) => host.id).filter(Boolean).map((id) => `"${escapeDql(id)}"`).join(', ');
  return `timeseries value=avg(${metricName(metric)}), interval:1d, from:-90d, to:now(), filter:in(dt.entity.host, ${ids})`;
}

async function historyForScope(hosts: Host[], metric: MetricKey): Promise<number[]> {
  const expression = scopedExpression(hosts, metric);
  const records = await executeDql<Record<string, unknown>>(`${expression} | fields value`);
  return numericArray(records[0]?.value);
}

async function verifyApplicationThroughput(hosts: Host[]): Promise<VerifiedThroughput> {
  if (!hosts.length) return { requestsPerMinute: 0, requestCount: 0, serviceCount: 0 };
  const ids = hosts.map((host) => host.id).filter(Boolean).map((id) => `"${escapeDql(id)}"`).join(', ');
  const query = `fetch spans, from:now()-5m, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) and isNotNull(dt.entity.service) | filter in(dt.entity.host, ${ids}) | summarize requestCount=count(), by:{dt.entity.host, dt.entity.service}`;
  const records = await executeDql<Record<string, unknown>>(query, 15000);
  const toNumber = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
  const requestCount = Math.round(records.reduce((sum, record) => sum + toNumber(record.requestCount ?? record['count()']), 0));
  const serviceCount = new Set(records.map((record) => String(record['dt.entity.service'] ?? '')).filter(Boolean)).size;
  return { requestCount, requestsPerMinute: requestCount / 5, serviceCount };
}

export async function runDynatraceForecast(hosts: Host[], metric: MetricKey, horizon: ForecastHorizon): Promise<DynatraceForecast> {
  if (!hosts.length) return { metric, horizon, historical: [], forecast: [], lowerBound: [], upperBound: [], forecastStart: null, forecastEnd: null, quality: 'unavailable', status: 'NO_HOSTS', source: 'fallback', scopeHostCount: 0, error: 'No hosts were returned for the selected scope.' };
  const expression = scopedExpression(hosts, metric);
  let historical: number[] = [];
  try { historical = await historyForScope(hosts, metric); } catch { historical = []; }
  try {
    const response = await analyzersClient.executeAnalyzer({ analyzerName: ANALYZER, timeoutSeconds: 8, body: { timeSeriesData: { expression }, forecastHorizon: horizon, coverageProbability: 0.95, nPaths: 100 } });
    const result = response.requestToken ? await pollForecast(response.requestToken) : response.result;
    const output = result.output?.[0] as Record<string, any> | undefined;
    const band = output?.timeSeriesDataWithPredictions?.records?.[0] as Record<string, any> | undefined;
    if (!band || result.resultStatus === 'FAILED') throw new Error(output?.analysisStatus || result.logs?.map((x) => x.message).join(' ') || 'Forecast analyzer returned no prediction.');
    const point = numericArray(band['dt.davis.forecast:point']);
    const lower = numericArray(band['dt.davis.forecast:lower']);
    const upper = numericArray(band['dt.davis.forecast:upper']);
    if (point.length < 2) throw new Error('Dynatrace Intelligence returned fewer than two forecast points.');
    const timeframe = band.timeframe as { start?: string; end?: string } | undefined;
    return { metric, horizon, historical, forecast: point, lowerBound: lower, upperBound: upper, forecastStart: timeframe?.start ?? null, forecastEnd: timeframe?.end ?? null, quality: String(output?.forecastQualityAssessment ?? 'unknown'), status: String(output?.analysisStatus ?? 'OK'), source: 'Dynatrace Intelligence', scopeHostCount: hosts.length };
  } catch (error) {
    return { metric, horizon, historical, forecast: [], lowerBound: [], upperBound: [], forecastStart: null, forecastEnd: null, quality: 'unavailable', status: 'FAILED', source: 'fallback', scopeHostCount: hosts.length, error: error instanceof Error ? error.message : String(error) };
  }
}

async function mapWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>, concurrency: number): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

export async function getDynatraceForecasts(hosts: Host[], metric: MetricKey, horizon: ForecastHorizon) {
  // IMPORTANT: the previous implementation passed the entire scope to one analyzer call
  // and then returned hosts[0], which made a 53-host scope appear as a single forecast.
  // Run one forecast per host, with bounded concurrency to avoid flooding the analyzer API.
  return mapWithConcurrency(hosts, async (host) => ({
    host,
    forecast: await runDynatraceForecast([host], metric, horizon),
  }), FORECAST_CONCURRENCY);
}

function compactTelemetry(hosts: Host[]) {
  const rows = hosts.map((host) => {
    const p = host.telemetry.at(-1);
    return { host: host.name, cpu: Math.round(p?.cpu ?? 0), memory: Math.round(p?.memory ?? 0), disk: Math.round(p?.disk ?? 0), rx: Math.round(p?.networkRx ?? 0), tx: Math.round(p?.networkTx ?? 0) };
  });
  const avg = (key: 'cpu' | 'memory' | 'disk') => rows.length ? Math.round(rows.reduce((sum, row) => sum + row[key], 0) / rows.length) : 0;
  const peak = (key: 'cpu' | 'memory' | 'disk') => rows.length ? Math.max(...rows.map((row) => row[key])) : 0;
  const risks = rows.filter((row) => Math.max(row.cpu, row.memory, row.disk) >= 70).sort((a, b) => Math.max(b.cpu, b.memory, b.disk) - Math.max(a.cpu, a.memory, a.disk)).slice(0, 15);
  return { hostCount: hosts.length, averages: { cpu: avg('cpu'), memory: avg('memory'), disk: avg('disk') }, peaks: { cpu: peak('cpu'), memory: peak('memory'), disk: peak('disk') }, topRiskHosts: risks };
}

function compactForecasts(forecasts: Array<{ host: Host; forecast: DynatraceForecast }>) {
  const rows = forecasts.map(({ host, forecast }) => ({
    host: host.name,
    metric: forecast.metric,
    source: forecast.source,
    status: forecast.status,
    peak: forecast.forecast.length ? Math.round(Math.max(...forecast.forecast)) : null,
    upperPeak: forecast.upperBound.length ? Math.round(Math.max(...forecast.upperBound)) : null,
    quality: forecast.quality,
  }));
  const successful = rows.filter((row) => row.source === 'Dynatrace Intelligence').length;
  const risks = rows.filter((row) => Math.max(row.peak ?? 0, row.upperPeak ?? 0) >= 80).sort((a, b) => Math.max(b.peak ?? 0, b.upperPeak ?? 0) - Math.max(a.peak ?? 0, a.upperPeak ?? 0)).slice(0, 15);
  return { analyzed: rows.length, successful, failed: rows.length - successful, topForecastRisks: risks };
}

export async function generateAssistCapacitySummary(hosts: Host[], managementZone: string, forecasts: Array<{ host: Host; forecast: DynatraceForecast }> = []): Promise<AiCapacitySummary> {
  const verified = await verifyApplicationThroughput(hosts).catch(() => ({ requestsPerMinute: 0, requestCount: 0, serviceCount: 0 }));
  const telemetry = compactTelemetry(hosts);
  const forecastContext = compactForecasts(forecasts);
  const prompt = `You are the capacity planning advisor for an enterprise SRE team. Analyze ONLY the supplied live Dynatrace telemetry and Dynatrace Intelligence forecast result. Do not invent values.

Scope: ${managementZone || 'All hosts'}
Hosts in scope: ${telemetry.hostCount}
Verified application traffic: ${verified.requestCount} request-root spans across ${verified.serviceCount} services in 5 minutes = ${verified.requestsPerMinute.toFixed(1)} requests/min. Treat this application-service throughput as authoritative application load; do not substitute host-associated throughput.

Current resource summary: ${JSON.stringify(telemetry)}
Forecast summary: ${JSON.stringify(forecastContext)}

Produce an executive-ready capacity assessment with these sections: Executive Summary, Key Findings, Capacity Risks, Recommended Actions (P1/P2/P3), and 30/60/90-day planning recommendation. Explicitly identify whether CPU, memory, disk, network, or application throughput is the primary constraint. Explain observed risk and forecast direction using only supplied values. If forecasts failed, state the count and do not fabricate forecast values. Keep the answer concise enough for an enterprise dashboard.`;
  const safePrompt = prompt.length <= MAX_ASSIST_TEXT ? prompt : `${prompt.slice(0, MAX_ASSIST_TEXT - 180)}\n\nImportant: stay within the supplied data and keep the response concise.`;
  try {
    const response = await publicClient.recommenderConversation({ body: { text: safePrompt, context: [{ type: 'instruction', value: 'Use only the supplied Dynatrace telemetry and independently verified application throughput. Return plain text with clear headings and bullets. Do not expose internal reasoning.' }] } });
    const text = (response as unknown as { text?: string }).text?.trim();
    if (!text) throw new Error('Dynatrace Assist returned an empty response.');
    return { text, generatedAt: new Date().toISOString(), source: 'Dynatrace Assist' };
  } catch (error) {
    const high = telemetry.topRiskHosts;
    const summary = high.length
      ? `Capacity risk is concentrated on ${high.length} host(s) in the top-risk set. Highest observed utilization includes ${high.slice(0, 5).map((x) => `${x.host} (CPU ${x.cpu}%, memory ${x.memory}%, disk ${x.disk}%)`).join('; ')}.`
      : `The selected scope contains ${hosts.length} hosts and no top-risk host is currently at or above 70% CPU, memory, or disk utilization.`;
    return { text: `Executive Summary\n${summary}\n\nCurrent scope\n• Hosts: ${hosts.length}\n• Verified application throughput: ${verified.requestsPerMinute.toFixed(1)} req/min across ${verified.serviceCount} services\n• Forecasts analysed: ${forecastContext.analyzed}\n• Successful Dynatrace Intelligence forecasts: ${forecastContext.successful}\n\nRecommended Actions\n• Prioritize hosts at or above 80% utilization.\n• Use independently verified application-service throughput as the traffic baseline for scaling decisions.\n• Re-run the Dynatrace Intelligence forecast after material infrastructure changes.\n\nNote: Dynatrace Assist was unavailable for this run (${error instanceof Error ? error.message : String(error)}).`, generatedAt: new Date().toISOString(), source: 'fallback' };
  }
}
