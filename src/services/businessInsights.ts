import type { Host, MetricKey } from '@/types';
import { forecastMetric } from './forecasting';

export function getBusinessInsights(hosts: Host[]): string[] {
  const cpuRisk = hosts.filter((host) => forecastMetric(host, 'cpu', 30).risk === 'High' || forecastMetric(host, 'cpu', 30).risk === 'Critical').length;
  const memoryRisk = hosts.filter((host) => forecastMetric(host, 'memory', 60).risk === 'High' || forecastMetric(host, 'memory', 60).risk === 'Critical').length;
  const diskRisk = hosts.filter((host) => forecastMetric(host, 'disk', 60).risk === 'High' || forecastMetric(host, 'disk', 60).risk === 'Critical').length;
  return [
    `${cpuRisk} hosts are projected to exceed 80% CPU utilization within 30 days.`,
    memoryRisk > 0 ? `Memory capacity risk is expected to increase across ${memoryRisk} hosts over the next 60 days.` : 'Memory capacity remains within the planning threshold over the next 60 days.',
    diskRisk > 0 ? `${diskRisk} hosts require a disk capacity review before the next planning cycle.` : 'Disk capacity is stable across the current estate.',
  ];
}

export const insightMetric: MetricKey = 'cpu';
