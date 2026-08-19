import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint, TimeRange } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
interface HostEntityRecord { id?: unknown; 'entity.name'?: unknown; hostGroupName?: unknown; managementZones?: unknown; }

const RANGE_SPEC: Record<TimeRange, { from: string; interval: string; throughputInterval: string }> = {
  '1h': { from: '1h', interval: '1m', throughputInterval: '1m' },
  '6h': { from: '6h', interval: '5m', throughputInterval: '1m' },
  '24h': { from: '24h', interval: '15m', throughputInterval: '5m' },
  '7d': { from: '7d', interval: '6h', throughputInterval: '15m' },
  '30d': { from: '30d', interval: '1d', throughputInterval: '1h' },
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function executeDql<T>(query: string): Promise<T[]> {
  try {
    const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 } });
    let result = response.result as QueryResult | undefined;
    const token = response.requestToken;
    let state = response.state;
    for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
      try {
        const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
        state = poll.state;
        result = poll.result as QueryResult | undefined;
        if (!result && state === 'RUNNING') await sleep(300);
      } catch (error) {
        console.error('[DYNATRACE][queryPoll]', { attempt, requestToken: token, query, error });
        throw error;
      }
    }
    if (!result) throw new Error(`Dynatrace DQL query did not return a result (state: ${state}). Query: ${query}`);
    return (result.records ?? []).filter(Boolean) as T[];
  } catch (error) {
    console.error('[DYNATRACE][DQL]', { query, error });
    throw error;
  }
}

const hostId = (value: unknown): string =>
  Array.isArray(value)
    ? hostId(value[0])
    : value && typeof value === 'object'
      ? hostId((value as Record<string, unknown>).value ?? (value as Record<string, unknown>).values ?? (value as Record<string, unknown>).data ?? (value as Record<string, unknown>).id)
      : String(value ?? '').trim();

const numeric = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const n = numeric(value[i]);
      if (n !== undefined) return n;
    }
    return undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of ['value', 'double', 'number']) {
      const n = numeric(object[key]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
};

const series = (value: unknown): Array<number | null> => {
  if (Array.isArray(value)) return value.map((item) => numeric(item) ?? null);
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return series(object.values ?? object.data ?? object.value);
  }
  const n = numeric(value);
  return n === undefined ? [] : [n];
};

const last = (value: unknown): number | undefined => {
  const values = series(value);
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null) return values[i] as number;
  return undefined;
};

const percentSeries = (value: unknown): Array<number | null> => series(value).map((n) => n === null || n < 0 || n > 100 ? null : n);
const percentValue = (value: unknown): number => {
  const n = numeric(value);
  return n !== undefined && n >= 0 && n <= 100 ? n : 0;
};

const intervalMs = (value: unknown): number => {
  const raw = String(value ?? '3600000000000');
  if (/^\d+$/.test(raw)) return Number(raw) / 1e6;
  const match = raw.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  return match ? Number(match[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()] ?? 3600000) : 3600000;
};

const startMs = (value: unknown): number => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  if (value && typeof value === 'object') {
    const start = (value as Record<string, unknown>).start ?? (value as Record<string, unknown>).from;
    const date = new Date(String(start ?? ''));
    if (!Number.isNaN(date.getTime())) return date.getTime();
  }
  const date = new Date(String(value ?? ''));
  return Number.isNaN(date.getTime()) ? Date.now() - 86400000 : date.getTime();
};

const esc = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const hostFilter = (ids: string[]) => ids.length ? `filter in(dt.entity.host, ${ids.map((id) => `"${esc(id)}"`).join(', ')})` : '1==0';

async function getEntities(zone?: string): Promise<HostEntityRecord[]> {
  const selected = zone && zone !== 'All Management Zones';
  const query = selected
    ? `fetch dt.entity.host | expand managementZones | filter managementZones == "${esc(zone as string)}" | fields id, entity.name, hostGroupName, managementZones | dedup id`
    : 'fetch dt.entity.host | fields id, entity.name, hostGroupName, managementZones | dedup id';
  return executeDql<HostEntityRecord>(query);
}

async function getBaseSeries(range: TimeRange, ids: string[]) {
  if (!ids.length) return [];
  const { from, interval } = RANGE_SPEC[range];
  const filter = hostFilter(ids);
  const run = (alias: string, metric: string, current: string) => executeDql<Record<string, unknown>>(
    `timeseries ${alias}=avg(${metric}), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now() | ${filter} | fieldsAdd ${current}=arrayLast(${alias}) | fields dt.entity.host, ${alias}, ${current}, timeframe, interval`,
  );
  const [cpu, memory, disk] = await Promise.all([
    run('cpuSeries', 'dt.host.cpu.usage', 'cpuCurrent'),
    run('memorySeries', 'dt.host.memory.usage', 'memoryCurrent'),
    run('diskSeries', 'dt.host.disk.used.percent', 'diskCurrent'),
  ]);
  const map = new Map<string, Record<string, unknown>>();
  for (const record of [...cpu, ...memory, ...disk]) {
    const id = hostId(record['dt.entity.host']);
    if (!id) continue;
    const current = map.get(id) ?? { 'dt.entity.host': record['dt.entity.host'], timeframe: record.timeframe, interval: record.interval };
    Object.assign(current, record);
    map.set(id, current);
  }
  return [...map.values()];
}

async function getNetwork(range: TimeRange, ids: string[]) {
  if (!ids.length) return new Map<string, Record<string, unknown>>();
  const { from, interval } = RANGE_SPEC[range];
  const filter = hostFilter(ids);
  const records = await executeDql<Record<string, unknown>>(`timeseries rx=avg(dt.host.net.nic.bytes_rx), tx=avg(dt.host.net.nic.bytes_tx), by:{dt.entity.host}, interval:${interval}, from:-${from}, to:now() | ${filter} | fieldsAdd rxCurrent=arrayLast(rx), txCurrent=arrayLast(tx) | fields dt.entity.host, rx, tx, rxCurrent, txCurrent, timeframe, interval`);
  return new Map(records.map((record) => [hostId(record['dt.entity.host']), record]));
}

async function getThroughput(range: TimeRange, ids: string[]) {
  if (!ids.length) return new Map<string, Record<string, unknown>>();
  const { from, throughputInterval } = RANGE_SPEC[range];
  const filter = hostFilter(ids);
  const query = `fetch spans, from:now()-${from}, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) and isNotNull(dt.entity.service) | ${filter} | makeTimeseries throughputSeries=count(), by:{dt.entity.host}, interval:${throughputInterval} | fieldsAdd throughputCurrent=arrayLast(throughputSeries) | fields dt.entity.host, throughputSeries, throughputCurrent, timeframe, interval`;
  return new Map((await executeDql<Record<string, unknown>>(query)).map((record) => [hostId(record['dt.entity.host']), record]));
}

const environment = (group: string): Host['environment'] => {
  const value = group.toLowerCase();
  if (/\b(dr|disaster|secondary)\b/.test(value)) return 'DR';
  if (/\b(uat|test|qa|stage|staging)\b/.test(value)) return 'UAT';
  if (/\b(prod|production|prd)\b/.test(value)) return 'Production';
  return 'Unknown';
};

const status = (cpu: number, memory: number, disk: number): Host['profile'] => {
  const peak = Math.max(cpu, memory, disk);
  if (peak >= 90) return 'Over Capacity';
  if (peak >= 80) return 'Near Capacity';
  if (peak >= 70) return 'Increasing Risk';
  if (peak >= 55) return 'Stable';
  return 'Healthy';
};

export async function getManagementZones(): Promise<ManagementZoneOption[]> {
  const records = await executeDql<{ managementZones?: unknown }>('fetch dt.entity.host | expand managementZones | filterOut isNull(managementZones) | dedup managementZones | fields managementZones | sort managementZones');
  return records.map((record) => String(record.managementZones ?? '').trim()).filter(Boolean).map((name) => ({ name }));
}

export async function getHosts(zone?: string, range: TimeRange = '24h'): Promise<Host[]> {
  const entities = await getEntities(zone);
  const ids = entities.map((entity) => hostId(entity.id)).filter(Boolean);
  const [base, network, throughput] = await Promise.all([getBaseSeries(range, ids), getNetwork(range, ids), getThroughput(range, ids)]);
  const baseMap = new Map(base.map((record) => [hostId(record['dt.entity.host']), record]));

  return entities.map((entity) => {
    const id = hostId(entity.id);
    const baseRecord = baseMap.get(id);
    const networkRecord = network.get(id);
    const throughputRecord = throughput.get(id);
    const cpu = percentSeries(baseRecord?.cpuSeries);
    const memory = percentSeries(baseRecord?.memorySeries);
    const disk = percentSeries(baseRecord?.diskSeries);
    const rx = series(networkRecord?.rx);
    const tx = series(networkRecord?.tx);
    const throughputSeries = series(throughputRecord?.throughputSeries);
    const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, throughputSeries.length, 1);
    const currentCpu = percentValue(baseRecord?.cpuCurrent ?? last(baseRecord?.cpuSeries));
    const currentMemory = percentValue(baseRecord?.memoryCurrent ?? last(baseRecord?.memorySeries));
    const currentDisk = percentValue(baseRecord?.diskCurrent ?? last(baseRecord?.diskSeries));
    const currentRx = numeric(networkRecord?.rxCurrent ?? last(networkRecord?.rx)) ?? 0;
    const currentTx = numeric(networkRecord?.txCurrent ?? last(networkRecord?.tx)) ?? 0;
    const currentThroughput = numeric(throughputRecord?.throughputCurrent ?? last(throughputRecord?.throughputSeries)) ?? 0;
    const start = startMs(baseRecord?.timeframe ?? networkRecord?.timeframe ?? throughputRecord?.timeframe);
    const step = intervalMs(baseRecord?.interval ?? networkRecord?.interval ?? throughputRecord?.interval);
    const throughputScale = Math.max(step / 60000, 1);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: cpu[index] ?? Number.NaN,
      memory: memory[index] ?? Number.NaN,
      disk: disk[index] ?? Number.NaN,
      networkRx: rx[index] ?? Number.NaN,
      networkTx: tx[index] ?? Number.NaN,
      throughput: throughputSeries[index] !== null && throughputSeries[index] !== undefined ? Number(throughputSeries[index]) / throughputScale : Number.NaN,
    }));
    const latest = telemetry[telemetry.length - 1];
    latest.cpu = currentCpu;
    latest.memory = currentMemory;
    latest.disk = currentDisk;
    latest.networkRx = currentRx;
    latest.networkTx = currentTx;
    latest.throughput = currentThroughput / throughputScale;
    const group = String(entity.hostGroupName ?? '').trim();
    const zones = Array.isArray(entity.managementZones) ? entity.managementZones.map(String) : [String(entity.managementZones ?? '')].filter(Boolean);
    return {
      id,
      name: String(entity['entity.name'] ?? id),
      environment: environment(group),
      application: group || 'Unclassified host group',
      profile: status(currentCpu, currentMemory, currentDisk),
      managementZones: zones,
      telemetry,
    } satisfies Host;
  });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
