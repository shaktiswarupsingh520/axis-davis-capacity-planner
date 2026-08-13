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

const hostId = (value: unknown): string => {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
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

interface CurrentHostRecord {
  'dt.entity.host'?: unknown;
  'host.entity.name'?: unknown;
  'host.hostGroupName'?: unknown;
  'host.managementZones'?: unknown;
  cpu?: unknown;
  memory?: unknown;
  disk?: unknown;
}

interface SeriesRecord {
  'dt.entity.host'?: unknown;
  cpuSeries?: unknown;
  memorySeries?: unknown;
  diskSeries?: unknown;
  timeframe?: unknown;
  interval?: unknown;
}

async function getCurrentHostMetrics(): Promise<CurrentHostRecord[]> {
  return executeDql<CurrentHostRecord>(`
    timeseries {
      cpu = avg(dt.host.cpu.usage, scalar:true),
      memory = avg(dt.host.memory.usage, scalar:true),
      disk = avg(dt.host.disk.used.percent, scalar:true)
    },
    by:{dt.entity.host}
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

async function getHostSeries(): Promise<SeriesRecord[]> {
  return executeDql<SeriesRecord>(`
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

async function getNetworkSeries(): Promise<Map<string, Record<string, unknown>>> {
  const records = await executeDql<Record<string, unknown>>(`
    timeseries {
      rx = avg(dt.host.net.nic.link_util_rx),
      tx = avg(dt.host.net.nic.link_util_tx)
    },
    by:{dt.entity.host},
    interval:1h,
    from:-24h
  `).catch(() => []);
  return new Map(records.map((r) => [hostId(r['dt.entity.host']), r]));
}

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const [currentRecords, seriesRecords, networkByHost] = await Promise.all([
    getCurrentHostMetrics(),
    getHostSeries(),
    getNetworkSeries(),
  ]);

  const seriesByHost = new Map(seriesRecords.map((r) => [hostId(r['dt.entity.host']), r]));
  const selected = managementZone && managementZone !== 'All Management Zones' ? managementZone : undefined;

  return currentRecords
    .filter((record) => {
      if (!selected) return true;
      const zones = Array.isArray(record['host.managementZones'])
        ? record['host.managementZones'].map(String)
        : [String(record['host.managementZones'] ?? '')];
      return zones.includes(selected);
    })
    .map((record) => {
      const id = hostId(record['dt.entity.host']);
      const series = seriesByHost.get(id);
      const network = networkByHost.get(id);

      const currentCpu = numeric(record.cpu) ?? 0;
      const currentMemory = numeric(record.memory) ?? 0;
      const currentDisk = numeric(record.disk) ?? 0;

      const cpu = numbers(series?.cpuSeries);
      const memory = numbers(series?.memorySeries);
      const disk = numbers(series?.diskSeries);
      const rx = numbers(network?.rx);
      const tx = numbers(network?.tx);

      const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, 1);
      const start = startMs(series?.timeframe);
      const step = intervalMs(series?.interval);
      const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
        timestamp: new Date(start + index * step).toISOString(),
        cpu: cpu[index] ?? 0,
        memory: memory[index] ?? 0,
        disk: disk[index] ?? 0,
        networkRx: rx[index] ?? 0,
        networkTx: tx[index] ?? 0,
      }));

      const latest = telemetry[telemetry.length - 1];
      latest.cpu = currentCpu;
      latest.memory = currentMemory;
      latest.disk = currentDisk;

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
        profile: statusFromMetrics(currentCpu, currentMemory, currentDisk),
        managementZones: zones,
        telemetry,
      } satisfies Host;
    });
}

export const dynatraceDataProvider = { getHosts, getManagementZones };
