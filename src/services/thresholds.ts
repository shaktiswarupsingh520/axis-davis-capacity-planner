import type { MetricKey } from '@/types';

export const thresholds: Record<MetricKey, number> = {
  cpu: 80,
  memory: 80,
  disk: 85,
  network: 80,
};

export const metricLabels: Record<MetricKey, string> = {
  cpu: 'CPU',
  memory: 'Memory',
  disk: 'Disk',
  network: 'Network',
};
