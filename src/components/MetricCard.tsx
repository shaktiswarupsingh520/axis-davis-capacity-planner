import type { ReactNode } from 'react';

interface MetricCardProps { label: string; value: string; detail: string; icon: ReactNode; tone?: string }

export function MetricCard({ label, value, detail, icon, tone = 'blue' }: MetricCardProps) {
  return <article className={`metric-card tone-${tone}`}><div className="metric-icon">{icon}</div><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
