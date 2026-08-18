interface LineChartProps { series?: number[]; values?: number[]; forecast?: number[]; lower?: number[]; upper?: number[]; threshold?: number; labels?: string[]; yAxisLabel?: string; xAxisLabel?: string; unit?: string; }

function formatValue(value: number, unit = '') { const formatted = Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : `${Math.round(value)}`; return `${formatted}${unit}`; }

export function LineChart({ series: seriesProp = [], values, forecast = [], lower = [], upper = [], threshold, labels = [], yAxisLabel, xAxisLabel = 'Time', unit }: LineChartProps) {
  const series = (values ?? seriesProp).filter((v) => Number.isFinite(v));
  const actualForecast = forecast.filter((v) => Number.isFinite(v));
  const lowerBand = lower.filter((v) => Number.isFinite(v));
  const upperBand = upper.filter((v) => Number.isFinite(v));
  const all = [...series, ...actualForecast, ...lowerBand, ...upperBand, ...(threshold !== undefined ? [threshold] : [])];
  const hasData = all.length > 0;
  const resolvedYAxis = yAxisLabel ?? (threshold !== undefined ? 'Utilization (%)' : 'Metric value');
  const resolvedUnit = unit ?? (threshold !== undefined ? '%' : '');
  const max = hasData ? Math.max(resolvedUnit === '%' ? 100 : 1, ...all) : 100;
  const width = 820; const height = 340; const left = 82; const right = 24; const top = 24; const bottom = 58;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const split = series.length && actualForecast.length ? plotWidth * 0.58 : plotWidth;
  const forecastWidth = plotWidth - split;
  const y = (value: number) => top + plotHeight - (Math.max(0, value) / Math.max(1, max)) * plotHeight;
  const pts = (arr: number[], offset: number, span: number) => arr.map((value, index) => `${offset + (arr.length === 1 ? span / 2 : index * span / Math.max(1, arr.length - 1))},${y(value)}`).join(' ');
  const band = lowerBand.length > 1 && upperBand.length === lowerBand.length ? `${pts(upperBand, left + split, forecastWidth)} ${pts([...lowerBand].reverse(), left + split, forecastWidth)}` : '';
  const xEnd = left + plotWidth;
  const startLabel = labels[0] ?? 'Start'; const midLabel = labels[Math.floor(labels.length / 2)] ?? 'Midpoint'; const endLabel = labels[labels.length - 1] ?? 'Now';
  return <div className="chart-wrap labeled-chart">
    <div className="chart-title-row"><strong>{resolvedYAxis}</strong><span>Unit: {resolvedUnit || 'value'} · X-axis: {xAxisLabel}</span></div>
    {!hasData ? <div className="chart-no-data"><strong>No usable trend data returned</strong><span>The selected scope/timeframe did not return numeric points for this metric.</span></div> : <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${resolvedYAxis} over ${xAxisLabel}`}>
      <defs><linearGradient id="axisTrendArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4a8dff" stopOpacity=".18"/><stop offset="1" stopColor="#4a8dff" stopOpacity="0"/></linearGradient></defs>
      {[0,25,50,75,100].map((tick) => { const value = max * tick / 100; const yy = y(value); return <g key={tick}><line x1={left} x2={xEnd} y1={yy} y2={yy} className="chart-grid"/><text x="7" y={yy + 4} className="chart-axis-label">{formatValue(value, resolvedUnit)}</text></g>; })}
      {threshold !== undefined && <><line x1={left} x2={xEnd} y1={y(threshold)} y2={y(threshold)} className="threshold-line"/><text x={xEnd - 126} y={y(threshold) - 8} className="threshold-label">Capacity threshold {formatValue(threshold, resolvedUnit)}</text></>}
      {series.length > 1 && <><polygon points={`${left},${top + plotHeight} ${pts(series, left, split)} ${left + split},${top + plotHeight}`} fill="url(#axisTrendArea)"/><polyline points={pts(series, left, split)} className="chart-line actual"/></>}
      {actualForecast.length > 1 && band && <polygon points={band} className="forecast-band"/>}
      {actualForecast.length > 1 && <polyline points={pts(actualForecast, left + split, forecastWidth)} className="chart-line forecast"/>}
      {upperBand.length > 1 && <polyline points={pts(upperBand, left + split, forecastWidth)} className="chart-line upper"/>}
      {actualForecast.length > 0 && <line x1={left + split} x2={left + split} y1={top} y2={top + plotHeight} className="forecast-split"/>}
      <text x={left} y={height - 25} className="chart-axis-label">{series.length ? `Historical (${series.length} points)` : 'Historical'}</text>
      {actualForecast.length > 0 && <text x={left + split + 8} y={height - 25} className="chart-axis-label">Dynatrace forecast ({actualForecast.length} points)</text>}
      <text x={left} y={height - 8} className="chart-axis-label">{startLabel}</text><text x={left + plotWidth / 2 - 22} y={height - 8} className="chart-axis-label">{midLabel}</text><text x={xEnd - 38} y={height - 8} className="chart-axis-label">{endLabel}</text><text x={left + plotWidth / 2 - 18} y={height - 2} className="chart-axis-title">{xAxisLabel}</text>
    </svg>}
    <div className="chart-legend">{series.length > 0 && <span><i className="legend-dot actual-dot"/>Historical</span>}{actualForecast.length > 0 && <span><i className="legend-dot forecast-dot"/>Dynatrace forecast</span>}{lowerBand.length > 0 && <span><i className="legend-dot band-dot"/>90% prediction band</span>}{threshold !== undefined && <span><i className="legend-dot threshold-dot"/>Capacity threshold</span>}</div>
  </div>;
}
