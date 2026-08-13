import type { Host, TelemetryPoint } from '@/types';

const profiles = [
  { profile: 'Healthy' as const, base: [32, 38, 48], trend: 0.01 },
  { profile: 'Stable' as const, base: [56, 61, 64], trend: 0.02 },
  { profile: 'Near Capacity' as const, base: [72, 76, 78], trend: 0.04 },
  { profile: 'Increasing Risk' as const, base: [63, 68, 70], trend: 0.11 },
  { profile: 'Over Capacity' as const, base: [87, 84, 91], trend: 0.08 },
] as const;

const environments = ['Production', 'UAT', 'DR'];
const applications = ['Payments', 'Core Banking', 'Digital Channels', 'Data Platform', 'Risk Analytics'];
const managementZones = ['Payments', 'Digital Banking', 'Core Banking', 'Retail Channels', 'Shared Infrastructure'];

export function generateMockHosts(): Host[] {
  const now = Date.now();
  return Array.from({ length: 12 }, (_, hostIndex) => {
    const profile = profiles[hostIndex % profiles.length];
    const telemetry: TelemetryPoint[] = Array.from({ length: 2016 }, (_, pointIndex) => {
      const progress = pointIndex / 2015;
      const wave = Math.sin(pointIndex / 19 + hostIndex) * 2.4 + Math.cos(pointIndex / 71) * 1.1;
      const base = profile.base;
      const cpu = Math.min(99, Math.max(5, base[0] + profile.trend * progress * 100 + wave));
      const memory = Math.min(99, Math.max(8, base[1] + profile.trend * progress * 78 + wave * 0.7));
      const disk = Math.min(99, Math.max(12, base[2] + profile.trend * progress * 52 + wave * 0.35));
      const network = Math.min(99, Math.max(4, 22 + base[0] * 0.45 + profile.trend * progress * 60 + wave));
      return {
        timestamp: new Date(now - (2015 - pointIndex) * 5 * 60 * 1000).toISOString(),
        cpu: Number(cpu.toFixed(2)),
        memory: Number(memory.toFixed(2)),
        disk: Number(disk.toFixed(2)),
        networkRx: Number(Math.max(1, network * 0.82).toFixed(2)),
        networkTx: Number(Math.max(1, network * 0.58).toFixed(2)),
      };
    });
    return {
      id: `host-${hostIndex + 1}`,
      name: `ax-${environments[hostIndex % environments.length].toLowerCase().slice(0, 3)}-${String(hostIndex + 1).padStart(2, '0')}`,
      environment: environments[hostIndex % environments.length],
      application: applications[hostIndex % applications.length],
      profile: profile.profile,
      managementZones: [managementZones[hostIndex % managementZones.length], ...(hostIndex % 3 === 0 ? ['Shared Infrastructure'] : [])].filter((value, index, values) => values.indexOf(value) === index),
      telemetry,
    };
  });
}
