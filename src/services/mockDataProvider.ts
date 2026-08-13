import type { Host } from '@/types';
import { generateMockHosts } from './mockDataGenerator';

const hosts = generateMockHosts();

export function getMockHosts(): Host[] {
  return hosts;
}

export function getMockHost(id: string): Host | undefined {
  return hosts.find((host) => host.id === id);
}
