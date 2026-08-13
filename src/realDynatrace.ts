import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql<T extends Record<string, unknown>>(query: string): Promise<T[]> {
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
  return (result.records ?? []).filter((record): record is T => Boolean(record));
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
  if (typeof value === 'string') {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }
  return undefined;
};

const numericArray = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map((item) => numericValue(item) ?? 0);
  if (value && typeof value === 'object' && 'values' in value) {
    return numericArray((value as { values?: unknown }).values);
  }
  const scalar = numericValue(value);
  return scalar === undefined ? [] : [scalar];
};

const intervalToMs = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value > 1_000_000_000) return value / 1_000_000;
    return value;
  }
  const match = String(value ?? '1h').match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
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
  cpu?: unknown;
  memory?: unknown;
  disk?: unknown;
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
  // The scalar:true fields mirror the verified notebook query and provide a
  // reliable current value. The non-scalar fields preserve the 24-hour series
  // used by the forecast and host-detail pages.
  const primary = await executeDql<MetricRecord>(`
    timeseries {
      cpu = avg(dt.host.cpu.usage, scalar:true),
      memory = avg(dt.host.memory.usage, scalar:true),
      disk = avg(dt.host.disk.used.percent, scalar:true),
      cpuSeries = avg(dt.host.cpu.usage),
      memorySeries = avg(dt.host.memory.usage),
      diskSeries = avg(dt.host.disk.used.percent)
    }, by:{dt.entity.host}, interval:1h, from:-24h
  `);

  try {
    const network = await executeDql<MetricRecord>(`
      timeseries {
        rx = avg(dt.host.net.nic.link_util_rx),
        tx = avg(dt.host.net.nic.link_util_tx)
      }, by:{dt.entity.host}, interval:1h, from:-24h
    `);
    const networkByHost = new Map(network.map((record) => [String(record['dt.entity.host'] ?? '').trim(), record]));
    return primary.map((record) => ({
      ...record,
      rx: networkByHost.get(String(record['dt.entity.host'] ?? '').trim())?.rx,
      tx: networkByHost.get(String(record['dt.entity.host'] ?? '').trim())?.tx,
    }));
  } catch {
    return primary;
  }
}

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const entities = await getHostEntities(managementZone);
  if (!entities.length) return [];

  const metricRecords = await getHostMetrics();
  const metricsByHost = new Map(metricRecords.map((record) => [String(record['dt.entity.host'] ?? '').trim(), record]));

  return entities.map((entity) => {
    const id = String(entity.id ?? '').trim();
    const metric = metricsByHost.get(id);

    const cpuSeries = numericArray(metric?.cpuSeries);
    const memorySeries = numericArray(metric?.memorySeries);
    const diskSeries = numericArray(metric?.diskSeries);
    const cpu = cpuSeries.length ? cpuSeries : numericArray(metric?.cpu);
    const memory = memorySeries.length ? memorySeries : numericArray(metric?.memory);
    const disk = diskSeries.length ? diskSeries : numericArray(metric?.disk);
    const rx = numericArray(metric?.rx);
    const tx = numericArray(metric?.tx);

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
