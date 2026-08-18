interface LineChartProps { series?: number[]; values?: number[]; forecast?: number[]; lower?: number[]; upper?: number[]; threshold?: number; labels?: string[] }

function formatValue(value: number) { if (Math.abs(value) >= 1000) return `${Math.round(value / 100) / 10}k`; return `${Math.round(value)}`; }

export function LineChart({ series: seriesProp = [], values, forecast = [], lower = [], upper = [], threshold }: LineChartProps) {
  const series = values ?? seriesProp;
  const all = [...series, ...forecast, ...lower, ...upper, threshold ?? 0].filter((v) => Number.isFinite(v));
  const max = Math.max(100, ...all);
  const width = 760; const height = 300; const left = 58; const right = 18; const top = 18; const bottom = 46;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const split = series.length && forecast.length ? plotWidth * 0.58 : plotWidth;
  const forecastWidth = plotWidth - split;
  const y = (value: number) => top + plotHeight - (Math.max(0, value) / max) * plotHeight;
  const pts = (arr: number[], offset: number, span: number) => arr.map((value, index) => `${offset + (arr.length === 1 ? span / 2 : index * span / Math.max(1, arr.length - 1))},${y(value)}`).join(' ');
  const band = lower.length > 1 && upper.length === lower.length ? `${pts(upper, left + split, forecastWidth)} ${pts([...lower].reverse(), left + split, forecastWidth)}` : '';
  const xEnd = left + plotWidth;
  return <div className="chart-wrap">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical and forecast trend chart">
      <defs><linearGradient id="axisTrendArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4a8dff" stopOpacity=".18"/><stop offset="1" stopColor="#4a8dff" stopOpacity="0"/></linearGradient></defs>
      {[0,25,50,75,100].map((tick) => { const value = max * tick / 100; const yy = y(value); return <g key={tick}><line x1={left} x2={xEnd} y1={yy} y2={yy} className="chart-grid"/><text x="7" y={yy + 4} className="chart-axis-label">{formatValue(value)}</text></g>; })}
      {threshold !== undefined && <><line x1={left} x2={xEnd} y1={y(threshold)} y2={y(threshold)} className="threshold-line"/><text x={xEnd - 78} y={y(threshold) - 7} className="threshold-label">Threshold {formatValue(threshold)}</text></>}
      {series.length > 1 && <><polygon points={`${left},${top + plotHeight} ${pts(series, left, split)} ${left + split},${top + plotHeight}`} fill="url(#axisTrendArea)"/><polyline points={pts(series, left, split)} className="chart-line actual"/></>}
      {forecast.length > 1 && band && <polygon points={band} className="forecast-band"/>}
      {forecast.length > 1 && <polyline points={pts(forecast, left + split, forecastWidth)} className="chart-line forecast"/>}
      {upper.length > 1 && <polyline points={pts(upper, left + split, forecastWidth)} className="chart-line upper"/>}
      {forecast.length > 0 && <line x1={left + split} x2={left + split} y1={top} y2={top + plotHeight} className="forecast-split"/>}
      <text x={left} y={height - 16} className="chart-axis-label">Historical ({series.length} points)</text>
      {forecast.length > 0 && <text x={left + split + 8} y={height - 16} className="chart-axis-label">Forecast ({forecast.length} points)</text>}
      <text x={left + plotWidth / 2 - 16} y={height - 2} className="chart-axis-title">Time</text><text x="7" y="13" className="chart-axis-title">Value</text>
    </svg>
    <div className="chart-legend"><span><i className="legend-dot actual-dot"/>Historical</span>{forecast.length > 0 && <span><i className="legend-dot forecast-dot"/>Dynatrace forecast</span>}{lower.length > 0 && <span><i className="legend-dot band-dot"/>90% prediction band</span>}{threshold !== undefined && <span><i className="legend-dot threshold-dot"/>Threshold</span>}</div>
  </div>;
}
