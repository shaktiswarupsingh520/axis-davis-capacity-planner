import type { Host, RiskLevel } from '@/types';
import { thresholds } from './thresholds';

export function getHostRisk(host: Host): RiskLevel {
  const latest = host.telemetry[host.telemetry.length - 1];
  const max = Math.max(latest.cpu, latest.memory, latest.disk);
  if (max >= 90) return 'Critical';
  if (max >= 80) return 'High';
  if (max >= 70) return 'Medium';
  return 'Low';
}

export function getLatestMetric(host: Host, metric: 'cpu' | 'memory' | 'disk' | 'network'): number {
  const latest = host.telemetry[host.telemetry.length - 1];
  return metric === 'network' ? (latest.networkRx + latest.networkTx) / 2 : latest[metric];
}

export function isOverThreshold(value: number, metric: keyof typeof thresholds): boolean {
  return value >= thresholds[metric];
}
