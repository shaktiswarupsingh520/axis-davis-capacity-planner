import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }

const debug = (...args: unknown[]) => {
  try {
    console.log('[Axis Capacity]', ...args);
  } catch {
    // Diagnostics must never break the live Dynatrace data path.
  }
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

  const records = (result.records ?? []).filter(Boolean) as T[];
  debug('DQL result', { state, recordCount: records.length, firstRecord: records[0] });
  return records;
}

export async function getManagementZones(): Promise<ManagementZoneOption[]> {
  const records = await executeDql<{ managementZones?: unknown }>(`
    fetch dt.entity.host
    | expand managementZones
    | filterOut isNull(managementZones)
    | dedup managementZones
    | fields managementZones
    | sort managementZones
  `);
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
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const parsed = numeric(value[i]);
      if (parsed !== undefined) return parsed;
    }
    return undefined;
  }
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const key of ['value', 'double', 'number', 'values', 'data']) {
      const n = numeric(v[key]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
};

const numericSeries = (value: unknown): Array<number | null> => {
  if (Array.isArray(value)) return value.map((item) => numeric(item) ?? null);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('values' in v) return numericSeries(v.values);
    if ('data' in v) return numericSeries(v.data);
  }
  const n = numeric(value);
  return n === undefined ? [] : [n];
};

const lastNumeric = (value: unknown): number | undefined => {
  const values = numericSeries(value);
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null) return values[i] as number;
  }
  return undefined;
};

const numbers = (value: unknown): number[] => numericSeries(value).map((item) => item ?? 0);

const hostId = (value: unknown): string => {
  if (Array.isArray(value)) return hostId(value[0]);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    return hostId(v.value ?? v.values ?? v.data ?? v.id);
  }
  return String(value ?? '').trim();
};

const intervalMs = (value: unknown) => {
  const text = String(value ?? '3600000000000');
  if (/^\d+$/.test(text)) return Number(text) / 1_000_000;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!match) return 3_600_000;
  return Number(match[1]) * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2].toLowerCase()] ?? 3_600_000);
};

const startMs = (value: unknown) => {
  if (value && typeof value === 'object' && 'start' in value) {
    const parsed = new Date(String((value as { start?: unknown }).start));
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return Date.now() - 24 * 60 * 60 * 1000;
};

interface HostEntityRecord {
  id?: unknown;
  'entity.name'?: unknown;
  hostGroupName?: unknown;
  managementZones?: unknown;
}

interface SeriesRecord {
  'dt.entity.host'?: unknown;
  cpuSeries?: unknown;
  memorySeries?: unknown;
  diskSeries?: unknown;
  cpuCurrent?: unknown;
  memoryCurrent?: unknown;
  diskCurrent?: unknown;
  timeframe?: unknown;
  interval?: unknown;
}

interface ThroughputRecord {
  'dt.entity.host'?: unknown;
  throughputSeries?: unknown;
  throughputCurrent?: unknown;
  timeframe?: unknown;
  interval?: unknown;
}

const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function getHostEntities(managementZone?: string): Promise<HostEntityRecord[]> {
  const selected = managementZone && managementZone !== 'All Management Zones';
  const query = selected
    ? `
      fetch dt.entity.host
      | expand managementZones
      | filter managementZones == "${escapeDqlString(managementZone as string)}"
      | fields id, entity.name, hostGroupName, managementZones
      | dedup id
    `
    : `
      fetch dt.entity.host
      | fields id, entity.name, hostGroupName, managementZones
      | dedup id
    `;
  return executeDql<HostEntityRecord>(query);
}

async function getHostSeries(managementZone?: string): Promise<SeriesRecord[]> {
  const runMetric = async (alias: 'cpuSeries' | 'memorySeries' | 'diskSeries', metric: string): Promise<SeriesRecord[]> => {
    try {
      const currentField = alias === 'cpuSeries' ? 'cpuCurrent' : alias === 'memorySeries' ? 'memoryCurrent' : 'diskCurrent';
      const records = await executeDql<SeriesRecord>(`
        timeseries ${alias} = avg(${metric}),
        by:{dt.entity.host},
        interval:1h,
        from:-24h
        | fieldsAdd ${currentField} = arrayLast(${alias})
        | fields dt.entity.host, ${alias}, ${currentField}, timeframe, interval
      `);
      debug(`${alias} host series`, { metric, recordCount: records.length });
      return records;
    } catch (error) {
      debug(`${alias} host series failed`, { metric, error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  };

  const [cpu, memory, disk] = await Promise.all([
    runMetric('cpuSeries', 'dt.host.cpu.usage'),
    runMetric('memorySeries', 'dt.host.memory.usage'),
    runMetric('diskSeries', 'dt.host.disk.used.percent'),
  ]);

  const byHost = new Map<string, SeriesRecord>();
  for (const record of [...cpu, ...memory, ...disk]) {
    const id = hostId(record['dt.entity.host']);
    if (!id) continue;
    const current = byHost.get(id) ?? { 'dt.entity.host': record['dt.entity.host'], timeframe: record.timeframe, interval: record.interval };
    if (record.cpuSeries !== undefined) Object.assign(current, { cpuSeries: record.cpuSeries, cpuCurrent: record.cpuCurrent, timeframe: record.timeframe, interval: record.interval });
    if (record.memorySeries !== undefined) Object.assign(current, { memorySeries: record.memorySeries, memoryCurrent: record.memoryCurrent, timeframe: record.timeframe, interval: record.interval });
    if (record.diskSeries !== undefined) Object.assign(current, { diskSeries: record.diskSeries, diskCurrent: record.diskCurrent, timeframe: record.timeframe, interval: record.interval });
    byHost.set(id, current);
  }

  return [...byHost.values()];
}

async function getNetworkSeries(): Promise<Map<string, Record<string, unknown>>> {
  try {
    const records = await executeDql<Record<string, unknown>>(`
      timeseries {
        rx = avg(dt.host.net.nic.link_util_rx),
        tx = avg(dt.host.net.nic.link_util_tx)
      },
      by:{dt.entity.host},
      interval:1h,
      from:-24h
    `);
    debug('host network series', { recordCount: records.length });
    return new Map(records.map((r) => [hostId(r['dt.entity.host']), r]));
  } catch (error) {
    debug('host network series failed', { error: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}

/**
 * Application throughput is derived from root service-request spans and grouped by host.
 * The result is requests/minute observed on the host across its instrumented application services.
 */
async function getApplicationThroughputSeries(): Promise<Map<string, ThroughputRecord>> {
  try {
    const records = await executeDql<ThroughputRecord>(`
      fetch spans, samplingRatio:1
      | filter request.is_root_span == true
      | filter isNotNull(dt.entity.host) and isNotNull(dt.entity.service)
      | fieldsAdd samplingProbability = (power(2, 56) - coalesce(sampling.threshold, 0)) * power(2, -56)
      | fieldsAdd multiplicity = coalesce(1 / samplingProbability, 1) * coalesce(aggregation.count, 1) * coalesce(dt.system.sampling_ratio, 1)
      | makeTimeseries { throughputSeries = sum(multiplicity) }, by:{dt.entity.host}, interval:1m, from:-24h
      | fieldsAdd throughputCurrent = arrayLast(throughputSeries)
      | fields dt.entity.host, throughputSeries, throughputCurrent, timeframe, interval
    `);
    debug('application service throughput', { recordCount: records.length });
    return new Map(records.map((record) => [hostId(record['dt.entity.host']), record]));
  } catch (error) {
    debug('application service throughput failed', { error: error instanceof Error ? error.message : String(error) });
    return new Map();
  }
}

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const [entities, seriesRecords, networkByHost, throughputByHost] = await Promise.all([
    getHostEntities(managementZone),
    getHostSeries(managementZone),
    getNetworkSeries(),
    getApplicationThroughputSeries(),
  ]);

  const seriesByHost = new Map(seriesRecords.map((record) => [hostId(record['dt.entity.host']), record]));

  debug('Dynatrace series host map', { recordCount: seriesRecords.length, hostIds: [...seriesByHost.keys()].slice(0, 10) });

  return entities.map((entity) => {
    const id = hostId(entity.id);
    const series = seriesByHost.get(id);
    const network = networkByHost.get(id);
    const throughputSeriesRecord = throughputByHost.get(id);

    const seriesCpu = numbers(series?.cpuSeries);
    const seriesMemory = numbers(series?.memorySeries);
    const seriesDisk = numbers(series?.diskSeries);
    const seriesThroughput = numbers(throughputSeriesRecord?.throughputSeries);
    const rx = numbers(network?.rx);
    const tx = numbers(network?.tx);

    const currentCpu = numeric(series?.cpuCurrent) ?? lastNumeric(series?.cpuSeries) ?? 0;
    const currentMemory = numeric(series?.memoryCurrent) ?? lastNumeric(series?.memorySeries) ?? 0;
    const currentDisk = numeric(series?.diskCurrent) ?? lastNumeric(series?.diskSeries) ?? 0;
    const currentThroughput = numeric(throughputSeriesRecord?.throughputCurrent) ?? lastNumeric(throughputSeriesRecord?.throughputSeries) ?? 0;

    debug('Host metric mapping', {
      entityId: id,
      hostName: entity['entity.name'],
      matchedSeries: Boolean(series),
      seriesHostId: series ? hostId(series['dt.entity.host']) : undefined,
      rawCpuCurrent: series?.cpuCurrent,
      rawMemoryCurrent: series?.memoryCurrent,
      rawDiskCurrent: series?.diskCurrent,
      parsedCpu: currentCpu,
      parsedMemory: currentMemory,
      parsedDisk: currentDisk,
      networkRx: lastNumeric(network?.rx) ?? 0,
      networkTx: lastNumeric(network?.tx) ?? 0,
      applicationThroughput: currentThroughput,
    });

    const points = Math.max(seriesCpu.length, seriesMemory.length, seriesDisk.length, rx.length, tx.length, seriesThroughput.length, 1);
    const start = startMs(series?.timeframe ?? throughputSeriesRecord?.timeframe);
    const step = intervalMs(series?.interval ?? throughputSeriesRecord?.interval);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: seriesCpu[index] ?? 0,
      memory: seriesMemory[index] ?? 0,
      disk: seriesDisk[index] ?? 0,
      networkRx: rx[index] ?? 0,
      networkTx: tx[index] ?? 0,
      throughput: seriesThroughput[index] ?? 0,
    }));

    const latest = telemetry[telemetry.length - 1];
    latest.cpu = currentCpu;
    latest.memory = currentMemory;
    latest.disk = currentDisk;
    latest.throughput = currentThroughput;

    debug('Final host telemetry', { hostId: id, hostName: entity['entity.name'], cpu: latest.cpu, memory: latest.memory, disk: latest.disk, networkRx: latest.networkRx, networkTx: latest.networkTx, throughput: latest.throughput, telemetryLength: telemetry.length });

    const name = String(entity['entity.name'] ?? id ?? 'Unknown host');
    const group = String(entity.hostGroupName ?? '').trim();
    const zones = Array.isArray(entity.managementZones)
      ? entity.managementZones.map(String)
      : [String(entity.managementZones ?? '')].filter(Boolean);

    return {
      id,
      name,
      environment: environmentFromHost(group),
      application: group || 'Unclassified host group',
      profile: statusFromMetrics(currentCpu, currentMemory, currentDisk),
      managementZones: zones,
      telemetry,
    } satisfies Host;
  });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
