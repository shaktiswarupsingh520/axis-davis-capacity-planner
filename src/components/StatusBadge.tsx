import type { RiskLevel, CapacityStatus } from '@/types';

interface StatusBadgeProps { value: RiskLevel | CapacityStatus }

export function StatusBadge({ value }: StatusBadgeProps) {
  const key = value.toLowerCase().replace(' ', '-');
  return <span className={`status-badge status-${key}`}>{value}</span>;
}
