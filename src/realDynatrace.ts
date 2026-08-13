import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql<T>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 } });
  let result: QueryResult | undefined = response.result as QueryResult | undefined;
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
  const records = await executeDql<{ managementZones?: unknown }>(`
    fetch dt.entity.host
    | expand managementZones
    | filterOut isNull(managementZones)
    | dedup managementZones
    | fields managementZones
    | sort managementZones
  `);
  return records.map((record) => String(record.managementZones ?? '').trim()).filter(Boolean).map((name) => ({ name }));
}

const environmentFromHost = (hostGroupName: string) => {
  const value = hostGroupName.toLowerCase();
  if (/\b(dr|disaster|secondary)\b/.test(value)) return 'DR';
  if (/\b(uat|test|qa|stage|staging)\b/.test(value)) return 'UAT';
  if (/\b(prod|production|prd)\b/.test(value)) return 'Production';
  return 'Unknown';
};

const statusFromMetrics = (cpu: number, memory: number, disk: number): Host['profile'] => {
  const maximum = Math.max(cpu, memory, disk);
  if (maximum >= 90) return 'Over Capacity';
  if (maximum >= 80) return 'Near Capacity';
  if (maximum >= 70) return 'Increasing Risk';
  if (maximum >= 55) return 'Stable';
  return 'Healthy';
};

const numericValue = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    for (const key of ['value', 'double', 'number']) {
      const parsed = numericValue(candidate[key]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
};

const numericArray = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map((item) => numericValue(item) ?? 0);
  if (value && typeof value === 'object') {
    const candidate = value as Record<string, unknown>;
    if ('values' in candidate) return numericArray(candidate.values);
    if ('data' in candidate) return numericArray(candidate.data);
    if ('value' in candidate) {
      const scalar = numericValue(candidate.value);
      return scalar === undefined ? [] : [scalar];
    }
  }
  const scalar = numericValue(value);
  return scalar === undefined ? [] : [scalar];
};

const lastNumeric = (value: unknown): number | undefined => {
  const values = numericArray(value);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (Number.isFinite(values[index])) return values[index];
  }
  return undefined;
};

const intervalToMs = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000) return value / 1_000_000;
    return value;
  }
  const text = String(value ?? '1h');
  if (/^\d+$/.test(text)) return Number(text) / 1_000_000;
  const match = text.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (!match) return 60 * 60 * 1000;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit] ?? 3_600_000);
};

const timeframeStart = (value: unknown) => {
  if (value && typeof value === 'object' && 'start' in value) {
    const start = (value as { start?: unknown }).start;
    const parsed = new Date(String(start));
    if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  }
  return Date.now() - 24 * 60 * 60 * 1000;
};

interface HostEntityRecord { id?: unknown; 'entity.name'?: unknown; hostGroupName?: unknown; managementZones?: unknown; tags?: unknown; }
interface MetricRecord {
  'dt.entity.host'?: unknown;
  cpuSeries?: unknown;
  memorySeries?: unknown;
  diskSeries?: unknown;
  rx?: unknown;
  tx?: unknown;
  timeframe?: unknown;
  interval?: unknown;
}

async function getHostEntities(managementZone?: string): Promise<HostEntityRecord[]> {
  const selected = managementZone && managementZone !== 'All Management Zones';
  const escapedZone = selected ? escapeDqlString(managementZone as string) : '';
  const query = selected
    ? `
      fetch dt.entity.host
      | expand managementZones
      | filter managementZones == "${escapedZone}"
      | fields id, entity.name, hostGroupName, managementZones, tags
      | dedup id
    `
    : `
      fetch dt.entity.host
      | fields id, entity.name, hostGroupName, managementZones, tags
      | dedup id
    `;
  return executeDql<HostEntityRecord>(query);
}

async function getHostMetrics(): Promise<MetricRecord[]> {
  // Use the exact non-scalar timeseries shape verified in the Dynatrace
  // Notebook. Current values are derived from the last non-null datapoint.
  return executeDql<MetricRecord>(`
    timeseries {
      cpuSeries = avg(dt.host.cpu.usage),
      memorySeries = avg(dt.host.memory.usage),
      diskSeries = avg(dt.host.disk.used.percent)
    },
    by:{dt.entity.host},
    interval:1h,
    from:-24h
  `);
}

async function getNetworkMetrics(): Promise<MetricRecord[]> {
  return executeDql<MetricRecord>(`
    timeseries {
      rx = avg(dt.host.net.nic.link_util_rx),
      tx = avg(dt.host.net.nic.link_util_tx)
    },
    by:{dt.entity.host},
    interval:1h,
    from:-24h
  `);
}

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const entities = await getHostEntities(managementZone);
  if (!entities.length) return [];

  const [metricRecords, networkRecords] = await Promise.all([
    getHostMetrics(),
    getNetworkMetrics().catch(() => []),
  ]);

  const metricsByHost = new Map(metricRecords.map((record) => [String(record['dt.entity.host'] ?? '').trim(), record]));
  const networkByHost = new Map(networkRecords.map((record) => [String(record['dt.entity.host'] ?? '').trim(), record]));

  return entities.map((entity) => {
    const id = String(entity.id ?? '').trim();
    const metric = metricsByHost.get(id);
    const network = networkByHost.get(id);

    const cpu = numericArray(metric?.cpuSeries);
    const memory = numericArray(metric?.memorySeries);
    const disk = numericArray(metric?.diskSeries);
    const rx = numericArray(network?.rx);
    const tx = numericArray(network?.tx);

    const cpuCurrent = lastNumeric(metric?.cpuSeries);
    const memoryCurrent = lastNumeric(metric?.memorySeries);
    const diskCurrent = lastNumeric(metric?.diskSeries);

    const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, 1);
    const start = timeframeStart(metric?.timeframe);
    const step = intervalToMs(metric?.interval);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: cpu[index] ?? 0,
      memory: memory[index] ?? 0,
      disk: disk[index] ?? 0,
      networkRx: rx[index] ?? 0,
      networkTx: tx[index] ?? 0,
    }));

    const latest = telemetry[telemetry.length - 1];
    if (latest) {
      if (cpuCurrent !== undefined) latest.cpu = cpuCurrent;
      if (memoryCurrent !== undefined) latest.memory = memoryCurrent;
      if (diskCurrent !== undefined) latest.disk = diskCurrent;
    }

    const name = String(entity['entity.name'] ?? id ?? 'Unknown host');
    const hostGroup = String(entity.hostGroupName ?? '').trim();
    const managementZones = Array.isArray(entity.managementZones)
      ? entity.managementZones.map(String)
      : [String(entity.managementZones ?? '')].filter(Boolean);

    return {
      id,
      name,
      environment: environmentFromHost(hostGroup),
      application: hostGroup || 'Unclassified host group',
      profile: statusFromMetrics(latest.cpu, latest.memory, latest.disk),
      managementZones,
      telemetry,
    } satisfies Host;
  });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
