export type MetricKey = 'cpu' | 'memory' | 'disk' | 'network';
export type CapacityStatus = 'Healthy' | 'Stable' | 'Near Capacity' | 'Increasing Risk' | 'Over Capacity';
export type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';
export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d';
export type ForecastHorizon = 7 | 14 | 30 | 60 | 90;

export interface TelemetryPoint {
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  networkRx: number;
  networkTx: number;
}

export interface Host {
  id: string;
  name: string;
  environment: string;
  application: string;
  profile: CapacityStatus;
  managementZones: string[];
  telemetry: TelemetryPoint[];
}

export interface MetricSummary {
  current: number;
  growthRate: number;
  threshold: number;
  daysUntilThreshold: number;
  risk: RiskLevel;
  action: string;
  historical: number[];
  forecast: number[];
  upperBound: number[];
  crossingDate: string | null;
}

export interface ForecastResult extends MetricSummary {
  metric: MetricKey;
  horizon: ForecastHorizon;
}

export interface SimulationInputs {
  cpuCapacity: number;
  memoryCapacity: number;
  diskCapacity: number;
  trafficGrowth: number;
  transactionGrowth: number;
  period: ForecastHorizon;
  additionalHosts: number;
  cpuPerHost: number;
  memoryPerHost: number;
  diskPerHost: number;
}

export interface SimulationResult {
  projectedCpu: number;
  projectedMemory: number;
  projectedDisk: number;
  requiredHosts: number;
  capacityGap: number;
  recommendedExpansion: number;
  risk: RiskLevel;
}
