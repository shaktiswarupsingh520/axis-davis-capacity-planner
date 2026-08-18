interface LineChartProps { series?: number[]; values?: number[]; forecast?: number[]; lower?: number[]; upper?: number[]; threshold?: number; labels?: string[] }
function points(values: number[], width: number, height: number, offset: number, max: number, xSpan = width) { return values.map((value, index) => `${offset + (values.length === 1 ? xSpan / 2 : index * (xSpan / Math.max(1, values.length - 1)))},${height - 18 - (Math.max(0, value) / max) * (height - 34)}`).join(' '); }
export function LineChart({ series: seriesProp = [], values, forecast = [], lower = [], upper = [], threshold }: LineChartProps) {
  const series = values ?? seriesProp;
  const all = [...series, ...forecast, ...lower, ...upper, threshold ?? 0].filter((v) => Number.isFinite(v));
  const max = Math.max(100, ...all);
  const width = 720; const height = 270;
  const split = series.length && forecast.length ? width * 0.58 : width;
  const histWidth = split;
  const forecastWidth = width - split;
  const forecastPoints = (arr: number[]) => points(arr, forecastWidth, height, split, max, forecastWidth);
  const band = lower.length > 1 && upper.length === lower.length ? `${forecastPoints(upper)} ${forecastPoints([...lower].reverse())}` : '';
  return <div className="chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Historical and forecast trend chart">
    <defs><linearGradient id="area" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#4a8dff" stopOpacity=".25"/><stop offset="1" stopColor="#4a8dff" stopOpacity="0"/></linearGradient></defs>
    {[20,40,60,80,100].map((tick) => <line key={tick} x1="0" x2={width} y1={height - 18 - (tick / max) * (height - 34)} y2={height - 18 - (tick / max) * (height - 34)} className="chart-grid" />)}
    {threshold !== undefined && <line x1="0" x2={width} y1={height - 18 - (threshold / max) * (height - 34)} y2={height - 18 - (threshold / max) * (height - 34)} className="threshold-line" />}
    {series.length > 1 && <><polygon points={`0,${height - 18} ${points(series, histWidth, height, 0, max, histWidth)} ${histWidth},${height - 18}`} fill="url(#area)"/><polyline points={points(series, histWidth, height, 0, max, histWidth)} className="chart-line actual" /></>}
    {forecast.length > 1 && band && <polygon points={band} className="forecast-band" />}
    {forecast.length > 1 && <polyline points={forecastPoints(forecast)} className="chart-line forecast" />}
    {upper.length > 1 && <polyline points={forecastPoints(upper)} className="chart-line upper" />}
    {forecast.length > 0 && <line x1={split} x2={split} y1="12" y2={height - 18} className="forecast-split" />}
    {forecast.length > 0 && <><text x="8" y={height - 3}>Historical</text><text x={split + 8} y={height - 3}>Forecast</text></>}
  </svg><div className="chart-legend"><span><i className="legend-dot actual-dot"/>Historical</span>{forecast.length > 0 && <span><i className="legend-dot forecast-dot"/>Dynatrace forecast</span>}{lower.length > 0 && <span><i className="legend-dot band-dot"/>90% prediction band</span>}{threshold !== undefined && <span><i className="legend-dot threshold-dot"/>Threshold</span>}</div></div>;
}
