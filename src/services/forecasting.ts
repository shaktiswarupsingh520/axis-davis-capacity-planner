import type { ForecastHorizon, ForecastResult, Host, MetricKey, MetricSummary, TimeRange } from '@/types';
import { thresholds } from './thresholds';

function valuesFor(host: Host, metric: MetricKey, range: TimeRange): number[] {
  const points = range === '1h' ? 12 : range === '6h' ? 72 : range === '24h' ? 288 : range === '7d' ? 2016 : 2016;
  const step = Math.max(1, Math.floor(host.telemetry.length / points));
  return host.telemetry.filter((_, index) => index % step === 0).map((point) => metric === 'network' ? (point.networkRx + point.networkTx) / 2 : point[metric]);
}

function regression(values: number[]): { slope: number; intercept: number } {
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, value) => sum + value, 0) / n;
  const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0) || 1;
  const slope = values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator;
  return { slope, intercept: meanY - slope * meanX };
}

export function forecastMetric(host: Host, metric: MetricKey, horizon: ForecastHorizon, range: TimeRange = '7d'): ForecastResult {
  const historical = valuesFor(host, metric, range);
  const { slope, intercept } = regression(historical);
  const points = Math.max(7, horizon);
  const current = historical[historical.length - 1] ?? 0;
  const growthRate = Number((slope * 12).toFixed(2));
  const forecast = Array.from({ length: points }, (_, index) => Number(Math.min(100, Math.max(0, intercept + slope * (historical.length + index))).toFixed(2)));
  const spread = Math.max(2, Math.abs(slope) * 10 + 2);
  const upperBound = forecast.map((value, index) => Number(Math.min(100, value + spread + index * 0.03).toFixed(2)));
  const threshold = thresholds[metric];
  const crossingIndex = forecast.findIndex((value) => value >= threshold);
  const daysUntilThreshold = crossingIndex < 0 ? Math.max(0, Math.round((threshold - current) / Math.max(slope * 12, 0.01))) : crossingIndex + 1;
  const risk = current >= threshold || crossingIndex === 0 ? 'Critical' : daysUntilThreshold <= 14 ? 'High' : daysUntilThreshold <= 45 ? 'Medium' : 'Low';
  const action = risk === 'Critical' ? 'Expand capacity immediately' : risk === 'High' ? 'Plan additional hosts' : risk === 'Medium' ? 'Monitor weekly and review growth' : 'Continue monitoring';
  return {
    metric, horizon, current: Number(current.toFixed(1)), growthRate, threshold, daysUntilThreshold, risk, action,
    historical: historical.slice(-96), forecast, upperBound,
    crossingDate: crossingIndex < 0 ? null : new Date(Date.now() + daysUntilThreshold * 86400000).toISOString(),
  };
}

export function summarizeMetric(hosts: Host[], metric: MetricKey, horizon: ForecastHorizon): MetricSummary {
  const results = hosts.map((host) => forecastMetric(host, metric, horizon));
  const average = (key: keyof MetricSummary): number => results.reduce((sum, result) => sum + Number(result[key]), 0) / results.length;
  const first = results[0];
  return { ...first, current: Number(average('current').toFixed(1)), growthRate: Number(average('growthRate').toFixed(2)), daysUntilThreshold: Math.round(average('daysUntilThreshold')) };
}
