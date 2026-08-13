import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption { name: string; }
interface QueryResult { records?: Array<Record<string, unknown> | null>; }

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
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const key of ['value', 'double', 'number']) {
      const n = numeric(v[key]);
      if (n !== undefined) return n;
    }
  }
  return undefined;
};

const numbers = (value: unknown): number[] => {
  if (Array.isArray(value)) return value.map((v) => numeric(v) ?? 0);
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if ('values' in v) return numbers(v.values);
    if ('data' in v) return numbers(v.data);
  }
  const n = numeric(value);
  return n === undefined ? [] : [n];
};

const lastNumber = (value: unknown) => {
  const values = numbers(value);
  for (let i = values.length - 1; i >= 0; i -= 1) if (Number.isFinite(values[i])) return values[i];
  return 0;
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

interface HostMetricRecord {
  'dt.entity.host'?: unknown;
  'host.entity.name'?: unknown;
  'host.hostGroupName'?: unknown;
  'host.managementZones'?: unknown;
  cpuSeries?: unknown;
  memorySeries?: unknown;
  diskSeries?: unknown;
  timeframe?: unknown;
  interval?: unknown;
}

async function getHostMetrics(): Promise<HostMetricRecord[]> {
  // Critical change: the host entity metadata is joined INSIDE DQL.
  // The React code no longer joins a separately-fetched entity ID to a
  // separately-fetched metric ID. This removes the source of the 0% rows.
  return executeDql<HostMetricRecord>(`
    timeseries {
      cpuSeries = avg(dt.host.cpu.usage),
      memorySeries = avg(dt.host.memory.usage),
      diskSeries = avg(dt.host.disk.used.percent)
    },
    by:{dt.entity.host},
    interval:1h,
    from:-24h
    | lookup [
        fetch dt.entity.host
        | fields id, entity.name, hostGroupName, managementZones
      ],
      sourceField:dt.entity.host,
      lookupField:id,
      prefix:"host.",
      fields:{entity.name, hostGroupName, managementZones}
  `);
}

async function getNetworkMetrics(): Promise<Array<Record<string, unknown>>> {
  return executeDql<Record<string, unknown>>(`
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
  const [records, networkRecords] = await Promise.all([
    getHostMetrics(),
    getNetworkMetrics().catch(() => []),
  ]);

  const networkByHost = new Map(networkRecords.map((r) => [String(r['dt.entity.host'] ?? '').trim(), r]));
  const selected = managementZone && managementZone !== 'All Management Zones' ? managementZone : undefined;

  return records
    .filter((record) => {
      if (!selected) return true;
      const zones = Array.isArray(record['host.managementZones'])
        ? record['host.managementZones'].map(String)
        : [String(record['host.managementZones'] ?? '')];
      return zones.includes(selected);
    })
    .map((record) => {
      const id = String(record['dt.entity.host'] ?? '').trim();
      const cpu = numbers(record.cpuSeries);
      const memory = numbers(record.memorySeries);
      const disk = numbers(record.diskSeries);
      const network = networkByHost.get(id);
      const rx = numbers(network?.rx);
      const tx = numbers(network?.tx);
      const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, 1);
      const start = startMs(record.timeframe);
      const step = intervalMs(record.interval);
      const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
        timestamp: new Date(start + index * step).toISOString(),
        cpu: cpu[index] ?? 0,
        memory: memory[index] ?? 0,
        disk: disk[index] ?? 0,
        networkRx: rx[index] ?? 0,
        networkTx: tx[index] ?? 0,
      }));

      const latest = telemetry[telemetry.length - 1];
      latest.cpu = lastNumber(record.cpuSeries);
      latest.memory = lastNumber(record.memorySeries);
      latest.disk = lastNumber(record.diskSeries);

      const name = String(record['host.entity.name'] ?? id ?? 'Unknown host');
      const group = String(record['host.hostGroupName'] ?? '').trim();
      const zones = Array.isArray(record['host.managementZones'])
        ? record['host.managementZones'].map(String)
        : [String(record['host.managementZones'] ?? '')].filter(Boolean);

      return {
        id,
        name,
        environment: environmentFromHost(group),
        application: group || 'Unclassified host group',
        profile: statusFromMetrics(latest.cpu, latest.memory, latest.disk),
        managementZones: zones,
        telemetry,
      } satisfies Host;
    });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
