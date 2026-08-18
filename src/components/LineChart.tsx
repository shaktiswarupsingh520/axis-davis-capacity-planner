interface LineChartProps {
  series?: number[];
  values?: number[];
  forecast?: number[];
  lower?: number[];
  upper?: number[];
  threshold?: number;
  labels?: string[];
  yAxisLabel?: string;
  xAxisLabel?: string;
  unit?: string;
}

function formatValue(value: number, unit = '') {
  const formatted = Math.abs(value) >= 1000 ? `${Math.round(value / 100) / 10}k` : `${Math.round(value)}`;
  return `${formatted}${unit}`;
}

export function LineChart({ series: seriesProp = [], values, forecast = [], lower = [], upper = [], threshold, labels = [], yAxisLabel, xAxisLabel = 'Time', unit }: LineChartProps) {
  const series = (values ?? seriesProp).filter((v) => Number.isFinite(v));
  const actualForecast = forecast.filter((v) => Number.isFinite(v));
  const lowerBand = lower.filter((v) => Number.isFinite(v));
  const upperBand = upper.filter((v) => Number.isFinite(v));
  const all = [...series, ...actualForecast, ...lowerBand, ...upperBand, ...(threshold !== undefined ? [threshold] : [])];
  const hasData = all.length > 0;
  const resolvedYAxis = yAxisLabel ?? (threshold !== undefined ? 'Utilization (%)' : 'Metric value');
  const resolvedUnit = unit ?? (threshold !== undefined ? '%' : '');
  const isPercentage = resolvedUnit === '%' || threshold !== undefined;
  const max = hasData ? Math.max(isPercentage ? 100 : 1, ...all) : 100;
  const width = 860;
  const height = 360;
  const left = 88;
  const right = 28;
  const top = 28;
  const bottom = 68;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const split = series.length && actualForecast.length ? plotWidth * 0.56 : plotWidth;
  const forecastWidth = plotWidth - split;
  const y = (value: number) => top + plotHeight - (Math.max(0, value) / Math.max(1, max)) * plotHeight;
  const pts = (arr: number[], offset: number, span: number) => arr.map((value, index) => `${offset + (arr.length === 1 ? span / 2 : index * span / Math.max(1, arr.length - 1))},${y(value)}`).join(' ');
  const band = lowerBand.length > 1 && upperBand.length === lowerBand.length ? `${pts(upperBand, left + split, forecastWidth)} ${pts([...lowerBand].reverse(), left + split, forecastWidth)}` : '';
  const xEnd = left + plotWidth;
  const startLabel = labels[0] ?? (actualForecast.length ? 'Historical start' : 'Start');
  const midLabel = labels[Math.floor(labels.length / 2)] ?? (actualForecast.length ? 'Today' : 'Midpoint');
  const endLabel = labels[labels.length - 1] ?? (actualForecast.length ? 'Forecast end' : 'Now');
  const lastObserved = series.at(-1);
  const forecastPeak = actualForecast.length ? Math.max(...actualForecast) : undefined;
  const forecastAvg = actualForecast.length ? actualForecast.reduce((sum, value) => sum + value, 0) / actualForecast.length : undefined;
  const forecastDelta = lastObserved !== undefined && forecastPeak !== undefined ? forecastPeak - lastObserved : undefined;
  const dotEvery = (arr: number[]) => Math.max(1, Math.floor(arr.length / 10));

  return <div className="chart-wrap labeled-chart">
    <div className="chart-title-row"><strong>{resolvedYAxis}</strong><span>Unit: {resolvedUnit || 'value'} · X-axis: {xAxisLabel}</span></div>
    {!hasData ? <div className="chart-no-data"><strong>No usable trend data returned</strong><span>The selected scope/timeframe did not return numeric points for this metric.</span></div> : <>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${resolvedYAxis} over ${xAxisLabel}`}>
        <defs><linearGradient id="axisTrendArea" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4a8dff" stopOpacity=".18"/><stop offset="1" stopColor="#4a8dff" stopOpacity="0"/></linearGradient></defs>
        {[0,25,50,75,100].map((tick) => { const value = max * tick / 100; const yy = y(value); return <g key={tick}><line x1={left} x2={xEnd} y1={yy} y2={yy} className="chart-grid"/><text x="8" y={yy + 4} className="chart-axis-label">{formatValue(value, resolvedUnit)}</text></g>; })}
        {threshold !== undefined && <><line x1={left} x2={xEnd} y1={y(threshold)} y2={y(threshold)} className="threshold-line"/><text x={xEnd - 164} y={y(threshold) - 8} className="threshold-label">Capacity threshold {formatValue(threshold, resolvedUnit)}</text></>}
        {series.length > 1 && <><polygon points={`${left},${top + plotHeight} ${pts(series, left, split)} ${left + split},${top + plotHeight}`} fill="url(#axisTrendArea)"/><polyline points={pts(series, left, split)} className="chart-line actual" strokeLinecap="round" strokeLinejoin="round"/>{series.filter((_, index) => index % dotEvery(series) === 0 || index === series.length - 1).map((value, index) => <circle key={`a-${index}`} cx={left + (series.length === 1 ? split / 2 : index * split / Math.max(1, series.length - 1))} cy={y(value)} r="2.5" className="chart-point actual-point"/>)}</>}
        {actualForecast.length > 1 && band && <polygon points={band} className="forecast-band"/>}
        {actualForecast.length > 1 && <polyline points={pts(actualForecast, left + split, forecastWidth)} className="chart-line forecast" strokeLinecap="round" strokeLinejoin="round"/>
        }
        {actualForecast.length > 0 && actualForecast.filter((_, index) => index % dotEvery(actualForecast) === 0 || index === actualForecast.length - 1).map((value, index) => <circle key={`f-${index}`} cx={left + split + (actualForecast.length === 1 ? forecastWidth / 2 : index * forecastWidth / Math.max(1, actualForecast.length - 1))} cy={y(value)} r="3" className="chart-point forecast-point"/>)}
        {upperBand.length > 1 && <polyline points={pts(upperBand, left + split, forecastWidth)} className="chart-line upper" strokeLinecap="round"/>}
        {actualForecast.length > 0 && <line x1={left + split} x2={left + split} y1={top} y2={top + plotHeight} className="forecast-split"/>}
        <text x={left} y={height - 30} className="chart-axis-label">{series.length ? `Historical (${series.length} points)` : 'Historical'}</text>
        {actualForecast.length > 0 && <text x={left + split + 8} y={height - 30} className="chart-axis-label">Dynatrace forecast ({actualForecast.length} points)</text>}
        <text x={left} y={height - 10} className="chart-axis-label">{startLabel}</text><text x={left + plotWidth / 2 - 22} y={height - 10} className="chart-axis-label">{midLabel}</text><text x={xEnd - 74} y={height - 10} className="chart-axis-label">{endLabel}</text><text x={left + plotWidth / 2 - 18} y={height - 2} className="chart-axis-title">{xAxisLabel}</text>
      </svg>
      <div className="chart-legend">{series.length > 0 && <span><i className="legend-dot actual-dot"/>Historical</span>}{actualForecast.length > 0 && <span><i className="legend-dot forecast-dot"/>Dynatrace forecast</span>}{lowerBand.length > 0 && <span><i className="legend-dot band-dot"/>90% prediction band</span>}{threshold !== undefined && <span><i className="legend-dot threshold-dot"/>Capacity threshold</span>}</div>
      {(lastObserved !== undefined || forecastPeak !== undefined) && <div className="chart-insights"><div><small>Latest observed</small><strong>{lastObserved === undefined ? '—' : formatValue(lastObserved, resolvedUnit)}</strong></div>{forecastAvg !== undefined && <div><small>Forecast average</small><strong>{formatValue(forecastAvg, resolvedUnit)}</strong></div>}{forecastPeak !== undefined && <div><small>Forecast peak</small><strong>{formatValue(forecastPeak, resolvedUnit)}</strong></div>}{forecastDelta !== undefined && <div><small>Peak change</small><strong className={forecastDelta >= 0 ? 'trend-up' : 'trend-down'}>{forecastDelta >= 0 ? '+' : ''}{formatValue(forecastDelta, resolvedUnit)}</strong></div>}</div>}
    </>}
  </div>;
}
