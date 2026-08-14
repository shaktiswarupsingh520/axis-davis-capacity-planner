import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint, TimeRange } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
interface HostEntityRecord { id?: unknown; 'entity.name'?: unknown; hostGroupName?: unknown; managementZones?: unknown; }
interface SeriesRecord { 'dt.entity.host'?: unknown; cpuSeries?: unknown; memorySeries?: unknown; diskSeries?: unknown; cpuCurrent?: unknown; memoryCurrent?: unknown; diskCurrent?: unknown; timeframe?: unknown; interval?: unknown; }
interface ThroughputRecord { 'dt.entity.host'?: unknown; throughputSeries?: unknown; throughputCurrent?: unknown; timeframe?: unknown; interval?: unknown; }

const RANGE_SPEC: Record<TimeRange, { from: string; interval: string }> = {
  '1h': { from: '1h', interval: '1m' },
  '6h': { from: '6h', interval: '5m' },
  '24h': { from: '24h', interval: '1h' },
  '7d': { from: '7d', interval: '6h' },
  '30d': { from: '30d', interval: '1d' },
};

async function executeDql<T>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 } });
  let result = response.result as QueryResult | undefined;
  const token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!result) throw new Error(`Dynatrace DQL query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as T[];
}

export async function getManagementZones(): Promise<ManagementZoneOption[]> {
  const records = await executeDql<{ managementZones?: unknown }>(`fetch dt.entity.host | expand managementZones | filterOut isNull(managementZones) | dedup managementZones | fields managementZones | sort managementZones`);
  return records.map((r) => String(r.managementZones ?? '').trim()).filter(Boolean).map((name) => ({ name }));
}

const environmentFromHost = (group: string) => {
  const value = group.toLowerCase();
  if (/\b(dr|disaster|secondary)\b/.test(value)) return 'DR';
  if (/\b(uat|test|qa|stage|staging)\b/.test(value)) return 'UAT';
  if (/\b(prod|production|prd)\b/.test(value)) return 'Production';
  return 'Unknown';
};

const statusFromMetrics = (cpu: number, memory: number, disk: number): Host['profile'] => {
  const max = Math.max(cpu, memory, disk);
  if (max >= 90) return 'Over Capacity';
  if (max >= 80) return 'Near Capacity';
  if (max >= 70) return 'Increasing Risk';
  if (max >= 55) return 'Stable';
  return 'Healthy';
};

const numeric = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) { for (let i = value.length - 1; i >= 0; i -= 1) { const n = numeric(value[i]); if (n !== undefined) return n; } return undefined; }
  if (typeof value === 'string' && value.trim()) { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
  if (value && typeof value === 'object') { const v = value as Record<string, unknown>; for (const key of ['value', 'double', 'number', 'values', 'data']) { const n = numeric(v[key]); if (n !== undefined) return n; } }
  return undefined;
};
const numericSeries = (value: unknown): Array<number | null> => Array.isArray(value) ? value.map((item) => numeric(item) ?? null) : value && typeof value === 'object' ? numericSeries((value as Record<string, unknown>).values ?? (value as Record<string, unknown>).data) : (numeric(value) === undefined ? [] : [numeric(value)!]);
const numbers = (value: unknown) => numericSeries(value).map((item) => item ?? 0);
const lastNumeric = (value: unknown) => { const values = numericSeries(value); for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null) return values[i] as number; return undefined; };
const hostId = (value: unknown): string => Array.isArray(value) ? hostId(value[0]) : value && typeof value === 'object' ? hostId((value as Record<string, unknown>).value ?? (value as Record<string, unknown>).values ?? (value as Record<string, unknown>).data ?? (value as Record<string, unknown>).id) : String(value ?? '').trim();
const intervalMs = (value: unknown) => { const text = String(value ?? '3600000000000'); if (/^\d+$/.test(text)) return Number(text) / 1_000_000; const match = text.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i); return match ? Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()] ?? 3600000) : 3600000; };
const startMs = (value: unknown) => { if (value && typeof value === 'object' && 'start' in value) { const parsed = new Date(String((value as { start?: unknown }).start)); if (!Number.isNaN(parsed.getTime())) return parsed.getTime(); } return Date.now() - 86400000; };
const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function getHostEntities(managementZone?: string): Promise<HostEntityRecord[]> {
  const selected = managementZone && managementZone !== 'All Management Zones';
  const query = selected
    ? `fetch dt.entity.host | expand managementZones | filter managementZones == "${escapeDqlString(managementZone as string)}" | fields id, entity.name, hostGroupName, managementZones | dedup id`
    : `fetch dt.entity.host | fields id, entity.name, hostGroupName, managementZones | dedup id`;
  return executeDql<HostEntityRecord>(query);
}

async function getHostSeries(timeRange: TimeRange): Promise<SeriesRecord[]> {
  const { from, interval } = RANGE_SPEC[timeRange];
  const run = async (alias: 'cpuSeries' | 'memorySeries' | 'diskSeries', metric: string) => {
    const current = alias === 'cpuSeries' ? 'cpuCurrent' : alias === 'memorySeries' ? 'memoryCurrent' : 'diskCurrent';
    try {
      return await executeDql<SeriesRecord>(`timeseries ${alias}=avg(${metric}), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now() | fieldsAdd ${current}=arrayLast(${alias}) | fields dt.entity.host, ${alias}, ${current}, timeframe, interval`);
    } catch { return []; }
  };
  const [cpu, memory, disk] = await Promise.all([run('cpuSeries', 'dt.host.cpu.usage'), run('memorySeries', 'dt.host.memory.usage'), run('diskSeries', 'dt.host.disk.used.percent')]);
  const map = new Map<string, SeriesRecord>();
  for (const record of [...cpu, ...memory, ...disk]) {
    const id = hostId(record['dt.entity.host']);
    if (!id) continue;
    const current = map.get(id) ?? { 'dt.entity.host': record['dt.entity.host'], timeframe: record.timeframe, interval: record.interval };
    Object.assign(current, record);
    map.set(id, current);
  }
  return [...map.values()];
}

async function getNetworkSeries(timeRange: TimeRange): Promise<Map<string, Record<string, unknown>>> {
  const { from, interval } = RANGE_SPEC[timeRange];
  try {
    const records = await executeDql<Record<string, unknown>>(`timeseries rx=avg(dt.host.net.nic.bytes_rx), tx=avg(dt.host.net.nic.bytes_tx), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now()`);
    return new Map(records.map((r) => [hostId(r['dt.entity.host']), r]));
  } catch { return new Map(); }
}

async function getApplicationThroughputSeries(timeRange: TimeRange): Promise<Map<string, ThroughputRecord>> {
  const { from, interval } = RANGE_SPEC[timeRange];
  try {
    // Root request spans are the authoritative host-associated application-service traffic source.
    const records = await executeDql<ThroughputRecord>(`fetch spans, from:now()-${from}, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) and isNotNull(dt.entity.service) | makeTimeseries throughputSeries=count(), by:{dt.entity.host}, interval:${interval} | fieldsAdd throughputCurrent=arrayLast(throughputSeries) | fields dt.entity.host, throughputSeries, throughputCurrent, timeframe, interval`);
    return new Map(records.map((record) => [hostId(record['dt.entity.host']), record]));
  } catch {
    return new Map();
  }
}

export async function getHosts(managementZone?: string, timeRange: TimeRange = '24h'): Promise<Host[]> {
  const [entities, seriesRecords, networkByHost, throughputByHost] = await Promise.all([
    getHostEntities(managementZone),
    getHostSeries(timeRange),
    getNetworkSeries(timeRange),
    getApplicationThroughputSeries(timeRange),
  ]);
  const seriesByHost = new Map(seriesRecords.map((record) => [hostId(record['dt.entity.host']), record]));
  return entities.map((entity) => {
    const id = hostId(entity.id);
    const series = seriesByHost.get(id);
    const network = networkByHost.get(id);
    const throughput = throughputByHost.get(id);
    const cpu = numbers(series?.cpuSeries);
    const memory = numbers(series?.memorySeries);
    const disk = numbers(series?.diskSeries);
    const rx = numbers(network?.rx);
    const tx = numbers(network?.tx);
    const appThroughput = numbers(throughput?.throughputSeries);
    const currentCpu = numeric(series?.cpuCurrent) ?? lastNumeric(series?.cpuSeries) ?? 0;
    const currentMemory = numeric(series?.memoryCurrent) ?? lastNumeric(series?.memorySeries) ?? 0;
    const currentDisk = numeric(series?.diskCurrent) ?? lastNumeric(series?.diskSeries) ?? 0;
    const currentThroughput = numeric(throughput?.throughputCurrent) ?? lastNumeric(throughput?.throughputSeries) ?? 0;
    const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, appThroughput.length, 1);
    const start = startMs(series?.timeframe ?? network?.timeframe ?? throughput?.timeframe);
    const step = intervalMs(series?.interval ?? network?.interval ?? throughput?.interval);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: cpu[index] ?? 0,
      memory: memory[index] ?? 0,
      disk: disk[index] ?? 0,
      networkRx: rx[index] ?? 0,
      networkTx: tx[index] ?? 0,
      throughput: appThroughput[index] ?? 0,
    }));
    const latest = telemetry[telemetry.length - 1];
    latest.cpu = currentCpu;
    latest.memory = currentMemory;
    latest.disk = currentDisk;
    latest.throughput = currentThroughput;
    const group = String(entity.hostGroupName ?? '').trim();
    const zones = Array.isArray(entity.managementZones) ? entity.managementZones.map(String) : [String(entity.managementZones ?? '')].filter(Boolean);
    return {
      id,
      name: String(entity['entity.name'] ?? id),
      environment: environmentFromHost(group),
      application: group || 'Unclassified host group',
      profile: statusFromMetrics(currentCpu, currentMemory, currentDisk),
      managementZones: zones,
      telemetry,
    } satisfies Host;
  });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
