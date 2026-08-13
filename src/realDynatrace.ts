import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }
const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 } });
  let result: QueryResult | undefined = response.result as QueryResult | undefined;
  let token = response.requestToken;
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
const numericArray = (value: unknown): number[] => Array.isArray(value)
  ? value.map((item) => {
      if (typeof item === 'number') return item;
      const number = Number(item);
      return Number.isFinite(number) ? number : 0;
    })
  : [];
const numericValue = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const intervalToMs = (value: unknown) => {
  const match = String(value ?? '1h').match(/^(\d+)\s*([smhd])$/i);
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
  rx?: unknown;
  tx?: unknown;
  cpuCurrent?: unknown;
  memoryCurrent?: unknown;
  diskCurrent?: unknown;
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
  // IMPORTANT: do not filter the timeseries using a JavaScript-generated list of
  // HOST IDs. In current DQL, the `in` operator expects a subquery in this form,
  // and passing quoted HOST strings can be rejected by the DQL editor. We already
  // scope the entity list by Management Zone, so querying all host timeseries and
  // joining them by the stable dt.entity.host dimension is both valid and robust.
  const primary = await executeDql<MetricRecord>(`
    timeseries {
      cpu = avg(dt.host.cpu.usage),
      memory = avg(dt.host.memory.usage),
      disk = avg(dt.host.disk.used.percent),
      cpuCurrent = avg(dt.host.cpu.usage, scalar: true),
      memoryCurrent = avg(dt.host.memory.usage, scalar: true),
      diskCurrent = avg(dt.host.disk.used.percent, scalar: true)
    }, by:{dt.entity.host}, interval:1h, from:-24h
  `);

  // Network is supplementary. Query it independently because NIC telemetry is
  // not guaranteed to exist for every host/platform.
  try {
    const network = await executeDql<MetricRecord>(`
      timeseries {
        rx = avg(dt.host.net.nic.link_util_rx),
        tx = avg(dt.host.net.nic.link_util_tx)
      }, by:{dt.entity.host}, interval:1h, from:-24h
    `);
    const networkByHost = new Map(network.map((record) => [String(record['dt.entity.host'] ?? ''), record]));
    return primary.map((record) => ({
      ...record,
      rx: networkByHost.get(String(record['dt.entity.host'] ?? ''))?.rx,
      tx: networkByHost.get(String(record['dt.entity.host'] ?? ''))?.tx,
    }));
  } catch {
    return primary;
  }
}

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const entities = await getHostEntities(managementZone);
  if (!entities.length) return [];

  const metricRecords = await getHostMetrics();
  const metricsByHost = new Map(metricRecords.map((record) => [String(record['dt.entity.host'] ?? ''), record]));

  return entities.map((entity) => {
    const id = String(entity.id ?? '');
    const metric = metricsByHost.get(id);
    const cpu = numericArray(metric?.cpu);
    const memory = numericArray(metric?.memory);
    const disk = numericArray(metric?.disk);
    const rx = numericArray(metric?.rx);
    const tx = numericArray(metric?.tx);
    const cpuCurrent = numericValue(metric?.cpuCurrent);
    const memoryCurrent = numericValue(metric?.memoryCurrent);
    const diskCurrent = numericValue(metric?.diskCurrent);

    const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, 1);
    const start = timeframeStart(metric?.timeframe);
    const step = intervalToMs(metric?.interval);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: cpu[index] ?? (index === points - 1 ? cpuCurrent ?? 0 : 0),
      memory: memory[index] ?? (index === points - 1 ? memoryCurrent ?? 0 : 0),
      disk: disk[index] ?? (index === points - 1 ? diskCurrent ?? 0 : 0),
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
