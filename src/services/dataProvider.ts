import type { Host } from '@/types';
import { getMockHost, getMockHosts } from './mockDataProvider';

export interface DataProvider {
  getHosts(): Host[];
  getHost(id: string): Host | undefined;
}

export const mockDataProvider: DataProvider = {
  getHosts: getMockHosts,
  getHost: getMockHost,
};
