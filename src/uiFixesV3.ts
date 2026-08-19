type MetricMeta = { name: string; unit: string };
const META: Record<string, MetricMeta> = {
  cpu: { name: 'CPU utilization', unit: '%' },
  memory: { name: 'Memory utilization', unit: '%' },
  disk: { name: 'Disk utilization', unit: '%' },
  throughput: { name: 'Application throughput', unit: 'req/min' },
  networkRx: { name: 'Network RX', unit: 'B/s' },
  networkTx: { name: 'Network TX', unit: 'B/s' },
};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
function metricFromPanel(panel: Element): MetricMeta {
  const select = panel.querySelector<HTMLSelectElement>('select');
  if (select?.value && META[select.value]) return META[select.value];
  const text = `${panel.textContent || ''} ${panel.getAttribute('aria-label') || ''}`.toLowerCase();
  if (text.includes('network rx') || text.includes('receive')) return META.networkRx;
  if (text.includes('network tx') || text.includes('transmit')) return META.networkTx;
  if (text.includes('throughput')) return META.throughput;
  if (text.includes('memory')) return META.memory;
  if (text.includes('disk')) return META.disk;
  return META.cpu;
}
function metricFor(svg: SVGSVGElement): MetricMeta {
  const panel = svg.closest('.chart-panel, .forecast-band-wrap, .projection-card, .chart-wrap') || svg.parentElement || svg;
  const aria = svg.getAttribute('aria-label') || '';
  const text = `${aria} ${panel.textContent || ''}`.toLowerCase();
  if (text.includes('network rx') || text.includes('receive')) return META.networkRx;
  if (text.includes('network tx') || text.includes('transmit')) return META.networkTx;
  if (text.includes('throughput')) return META.throughput;
  if (text.includes('memory')) return META.memory;
  if (text.includes('disk')) return META.disk;
  if (text.includes('cpu')) return META.cpu;
  return metricFromPanel(panel);
}
function labelPanel(panel: Element) {
  const meta = metricFromPanel(panel);
  const row = panel.querySelector<HTMLElement>('.chart-title-row');
  if (row) {
    const strong = row.querySelector('strong');
    const span = row.querySelector('span');
    if (strong) strong.textContent = `${meta.name} (${meta.unit})`;
    if (span) span.textContent = `Unit: ${meta.unit} · X-axis: Date / time · Hover for exact value`;
  }
}
function axisTicks(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map((n) => ({ y: Number(n.getAttribute('y')), value: Number((n.textContent || '').replace(/[^0-9.+-]/g, '')) }))
    .filter((x) => Number.isFinite(x.y) && Number.isFinite(x.value))
    .sort((a, b) => a.y - b.y);
}
function valueFromY(svg: SVGSVGElement, y: number, meta: MetricMeta) {
  const ticks = axisTicks(svg);
  if (ticks.length >= 2) {
    const a = ticks[0], b = ticks[ticks.length - 1];
    return a.value + ((y - a.y) / Math.max(1, b.y - a.y)) * (b.value - a.value);
  }
  const v = svg.viewBox.baseVal;
  const max = meta.unit === '%' ? 100 : 1;
  return Math.max(0, max - ((y - 28) / Math.max(1, v.height - 96)) * max);
}
function chartPoints(svg: SVGSVGElement) {
  const points: Array<{ x: number; y: number; series: string; index: number; total: number }> = [];
  const circles = [...svg.querySelectorAll<SVGCircleElement>('circle')];
  circles.forEach((c, i) => {
    const x = Number(c.getAttribute('cx')), y = Number(c.getAttribute('cy'));
    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, series: /forecast/i.test(c.getAttribute('class') || '') ? 'Dynatrace forecast' : 'Historical telemetry', index: i, total: circles.length });
  });
  if (points.length) return points;
  [...svg.querySelectorAll<SVGPolylineElement>('polyline')].forEach((line) => {
    const cls = line.getAttribute('class') || '';
    const raw = (line.getAttribute('points') || '').trim().split(/\s+/);
    raw.forEach((pair, i) => {
      const [x, y] = pair.split(',').map(Number);
      if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y, series: /forecast/i.test(cls) ? 'Dynatrace forecast' : 'Historical telemetry', index: i, total: raw.length });
    });
  });
  return points;
}
function tooltip(event: MouseEvent, html: string) {
  let t = document.querySelector<HTMLElement>('#axis-chart-tooltip-v3');
  if (!t) { t = document.createElement('div'); t.id = 'axis-chart-tooltip-v3'; t.className = 'chart-hover-tooltip'; document.body.appendChild(t); }
  t.innerHTML = html;
  t.style.display = 'flex'; t.style.position = 'fixed'; t.style.zIndex = '2147483647'; t.style.pointerEvents = 'none';
  t.style.left = `${Math.min(window.innerWidth - 300, Math.max(8, event.clientX + 14))}px`;
  t.style.top = `${Math.min(window.innerHeight - 110, Math.max(8, event.clientY - 95))}px`;
}
function hideTooltip() { document.querySelector<HTMLElement>('#axis-chart-tooltip-v3')?.style.setProperty('display', 'none'); }
function installHover(svg: SVGSVGElement) {
  if (svg.dataset.hoverV3 === '1') return;
  const points = chartPoints(svg); if (!points.length) return;
  const meta = metricFor(svg); const forecast = Boolean(svg.closest('.forecast-panel'));
  const move = (event: MouseEvent) => {
    const rect = svg.getBoundingClientRect(), view = svg.viewBox.baseVal;
    const x = (event.clientX - rect.left) / Math.max(1, rect.width) * view.width;
    const p = points.reduce((a, b) => Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a, points[0]);
    let value = valueFromY(svg, p.y, meta);
    const projectionDay = (svg.closest('.projection-card') && (event.target as Element)?.closest('circle')?.getAttribute('data-day')) || '';
    const projectionValue = (event.target as Element)?.closest('circle')?.getAttribute('data-value');
    if (projectionValue) value = Number(projectionValue);
    const now = Date.now();
    const horizon = Math.max(1, Number([...document.querySelectorAll<HTMLSelectElement>('select')].find((s) => /forecast/i.test(s.previousElementSibling?.textContent || ''))?.value || 30));
    const start = forecast ? now - 30 * 86400000 : now - 24 * 3600000;
    const end = forecast ? now + horizon * 86400000 : now;
    const left = 88, right = view.width - 28;
    const f = Math.max(0, Math.min(1, (p.x - left) / Math.max(1, right - left)));
    const date = new Date(start + (end - start) * f);
    const dateLine = projectionDay ? `${projectionDay} days from now` : date.toLocaleString('en-IN');
    tooltip(event, `<strong>${meta.name}</strong><span>${dateLine}</span><b>${Number.isFinite(value) ? value.toFixed(meta.unit === 'B/s' || meta.unit === 'req/min' ? 1 : 2) : '—'} ${meta.unit}</b><small>${p.series} · exact rendered chart point</small>`);
  };
  svg.addEventListener('mousemove', move); svg.addEventListener('mouseleave', hideTooltip); svg.dataset.hoverV3 = '1';
}
function addForecastHover(svg: SVGSVGElement) { installHover(svg); }
function refresh() {
  document.querySelectorAll<HTMLElement>('.chart-panel').forEach(labelPanel);
  document.querySelectorAll<SVGSVGElement>('.chart-wrap svg, .forecast-band-wrap svg, .projection-svg').forEach((svg) => { labelPanel(svg.closest('.chart-panel, .projection-card') || svg.parentElement || svg); addForecastHover(svg); });
}
export function installUiFixesV3() {
  const state = window as Window & { __axisUiFixesV3?: boolean };
  if (state.__axisUiFixesV3) return; state.__axisUiFixesV3 = true;
  const observer = new MutationObserver(() => { window.clearTimeout((observer as unknown as { timer?: number }).timer); (observer as unknown as { timer?: number }).timer = window.setTimeout(refresh, 80); });
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('click', () => window.setTimeout(refresh, 150));
  document.addEventListener('change', () => window.setTimeout(refresh, 250));
  void sleep(300).then(refresh);
}
