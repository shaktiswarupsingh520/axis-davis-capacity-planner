import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import type { Host, TelemetryPoint } from '@/types';

export interface ManagementZoneOption {
  name: string;
}

interface QueryResult {
  records?: Array<Record<string, unknown> | null>;
}

const escapeDqlString = (value: string) => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

async function executeDql<T extends Record<string, unknown>>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({
    body: {
      query,
      requestTimeoutMilliseconds: 30000,
      maxResultRecords: 5000,
    },
  });

  let result: QueryResult | undefined = response.result as QueryResult | undefined;
  let state = response.state;
  let token = response.requestToken;

  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({
      requestToken: token,
      requestTimeoutMilliseconds: 30000,
    });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    token = undefined;
    if (!result && state === 'RUNNING') {
      await new Promise((resolve) => setTimeout(resolve, 300));
      token = response.requestToken;
    }
  }

  if (!result) {
    throw new Error(`Dynatrace DQL query did not return a result (state: ${state}).`);
  }

  return (result.records ?? []).filter((record): record is T => Boolean(record));
}

export async function getManagementZones(): Promise<ManagementZoneOption[]> {
  const records = await executeDql<{ zone?: unknown }>(`
    fetch dt.entity.host
    | expand managementZones
    | filterOut isNull(managementZones)
    | dedup managementZones
    | fields zone = managementZones
    | sort zone
  `);

  return records
    .map((record) => String(record.zone ?? '').trim())
    .filter(Boolean)
    .map((name) => ({ name }));
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
  ? value.map((item) => typeof item === 'number' ? item : Number(item)).map((item) => Number.isFinite(item) ? item : 0)
  : [];

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

export async function getHosts(managementZone?: string): Promise<Host[]> {
  const escapedZone = managementZone && managementZone !== 'All Management Zones'
    ? escapeDqlString(managementZone)
    : undefined;

  const entityFilter = escapedZone
    ? `| filter iAny(managementZones[] == "${escapedZone}")`
    : '';

  const query = `
    timeseries {
      cpu = avg(dt.host.cpu.usage),
      memory = avg(dt.host.memory.usage),
      disk = avg(dt.host.disk.used.percent),
      rx = avg(dt.host.net.nic.link_util_rx),
      tx = avg(dt.host.net.nic.link_util_tx)
    }, by:{dt.entity.host}, interval:1h, from:-24h
    | lookup [
        fetch dt.entity.host
        ${entityFilter}
        | fields id, entity.name, hostGroupName, managementZones, tags
      ], sourceField:dt.entity.host, lookupField:id,
      fields:{entity.name, hostGroupName, managementZones, tags}
    | fieldsAdd cpuCurrent=arrayLast(cpu), memoryCurrent=arrayLast(memory), diskCurrent=arrayLast(disk), rxCurrent=arrayLast(rx), txCurrent=arrayLast(tx)
    | fields dt.entity.host, entity.name, hostGroupName, managementZones, tags, timeframe, interval, cpu, memory, disk, rx, tx, cpuCurrent, memoryCurrent, diskCurrent, rxCurrent, txCurrent
  `;

  const records = await executeDql<Record<string, unknown>>(query);

  return records.map((record) => {
    const cpu = numericArray(record.cpu);
    const memory = numericArray(record.memory);
    const disk = numericArray(record.disk);
    const rx = numericArray(record.rx);
    const tx = numericArray(record.tx);
    const points = Math.max(cpu.length, memory.length, disk.length, rx.length, tx.length, 1);
    const start = timeframeStart(record.timeframe);
    const step = intervalToMs(record.interval);
    const telemetry: TelemetryPoint[] = Array.from({ length: points }, (_, index) => ({
      timestamp: new Date(start + index * step).toISOString(),
      cpu: cpu[index] ?? 0,
      memory: memory[index] ?? 0,
      disk: disk[index] ?? 0,
      networkRx: rx[index] ?? 0,
      networkTx: tx[index] ?? 0,
    }));

    const latest = telemetry[telemetry.length - 1];
    const name = String(record['entity.name'] ?? record['dt.entity.host'] ?? 'Unknown host');
    const hostGroup = String(record.hostGroupName ?? '').trim();
    const managementZones = Array.isArray(record.managementZones)
      ? record.managementZones.map(String)
      : [];

    return {
      id: String(record['dt.entity.host'] ?? name),
      name,
      environment: environmentFromHost(hostGroup),
      application: hostGroup || 'Unclassified host group',
      profile: statusFromMetrics(latest.cpu, latest.memory, latest.disk),
      managementZones,
      telemetry,
    } satisfies Host;
  });
}

export const dynatraceDataProvider = {
  getHosts,
  getManagementZones,
};
