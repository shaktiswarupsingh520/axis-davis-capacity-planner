import type { SimulationInputs, SimulationResult, RiskLevel } from '@/types';

export function runCapacitySimulation(inputs: SimulationInputs): SimulationResult {
  const growth = 1 + (inputs.trafficGrowth * 0.55 + inputs.transactionGrowth * 0.45) / 100 * (inputs.period / 30);
  const projectedCpu = inputs.cpuCapacity * growth / (1 + inputs.additionalHosts * inputs.cpuPerHost / 100);
  const projectedMemory = inputs.memoryCapacity * growth / (1 + inputs.additionalHosts * inputs.memoryPerHost / 100);
  const projectedDisk = inputs.diskCapacity * growth / (1 + inputs.additionalHosts * inputs.diskPerHost / 100);
  const peak = Math.max(projectedCpu, projectedMemory, projectedDisk);
  const requiredHosts = Math.max(0, Math.ceil((peak - 80) / 12));
  const capacityGap = Math.max(0, peak - 80);
  const risk: RiskLevel = peak >= 95 ? 'Critical' : peak >= 85 ? 'High' : peak >= 75 ? 'Medium' : 'Low';
  return { projectedCpu: Number(projectedCpu.toFixed(1)), projectedMemory: Number(projectedMemory.toFixed(1)), projectedDisk: Number(projectedDisk.toFixed(1)), requiredHosts, capacityGap: Number(capacityGap.toFixed(1)), recommendedExpansion: Math.max(0, requiredHosts - inputs.additionalHosts), risk };
}
