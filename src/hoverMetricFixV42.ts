type MetricMeta = { name: string; unit: string };
const META: Record<string, MetricMeta> = {
  cpu: { name: 'CPU utilization', unit: '%' },
  memory: { name: 'Memory utilization', unit: '%' },
  disk: { name: 'Disk utilization', unit: '%' },
  throughput: { name: 'Application throughput', unit: 'req/min' },
  networkRx: { name: 'Network RX', unit: 'B/s' },
  networkTx: { name: 'Network TX', unit: 'B/s' },
};
function metricFor(svg: SVGSVGElement): MetricMeta {
  const panel = svg.closest('.chart-panel');
  const select = panel?.querySelector<HTMLSelectElement>('select');
  const selected = select?.value;
  if (selected && META[selected]) return META[selected];
  const title = (panel?.querySelector('.chart-title-row strong')?.textContent || svg.getAttribute('aria-label') || '').toLowerCase();
  if (title.includes('memory')) return META.memory;
  if (title.includes('disk')) return META.disk;
  if (title.includes('network rx') || title.includes('receive')) return META.networkRx;
  if (title.includes('network tx') || title.includes('transmit')) return META.networkTx;
  if (title.includes('throughput')) return META.throughput;
  return META.cpu;
}
function valueAt(svg: SVGSVGElement, y: number) {
  const ticks = [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map((n) => ({ y: Number(n.getAttribute('y')), value: Number((n.textContent || '').replace(/[^0-9.+-]/g, '')) }))
    .filter((x) => Number.isFinite(x.y) && Number.isFinite(x.value))
    .sort((a, b) => a.y - b.y);
  if (ticks.length < 2) return NaN;
  const a = ticks[0]; const b = ticks[ticks.length - 1];
  return a.value + ((y - a.y) / Math.max(1, b.y - a.y)) * (b.value - a.value);
}
function points(svg: SVGSVGElement) {
  const out: Array<{ x: number; y: number; value?: number }> = [];
  svg.querySelectorAll<SVGPolylineElement>('polyline').forEach((line) => {
    const nums = (line.getAttribute('points') || '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) out.push({ x: nums[i], y: nums[i + 1] });
  });
  svg.querySelectorAll<SVGCircleElement>('circle').forEach((circle) => {
    const x = Number(circle.getAttribute('cx')); const y = Number(circle.getAttribute('cy'));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, value: Number(circle.getAttribute('data-value') || '') || undefined });
  });
  return out;
}
function tooltip(e: MouseEvent, html: string) {
  let node = document.querySelector<HTMLElement>('#axis-chart-tooltip-v5');
  if (!node) { node = document.createElement('div'); node.id = 'axis-chart-tooltip-v5'; node.className = 'chart-hover-tooltip'; document.body.appendChild(node); }
  node.innerHTML = html; node.style.display = 'block'; node.style.position = 'fixed'; node.style.zIndex = '2147483647'; node.style.pointerEvents = 'none';
  const w = node.offsetWidth || 250; const h = node.offsetHeight || 90; let x = e.clientX + 16; let y = e.clientY - h - 16;
  if (x + w > innerWidth) x = e.clientX - w - 16; if (y < 8) y = e.clientY + 16;
  node.style.left = `${Math.max(8, x)}px`; node.style.top = `${Math.max(8, y)}px`;
}
function install(svg: SVGSVGElement) {
  if (svg.dataset.hoverV42 === '1') return;
  svg.dataset.hoverV42 = '1';
  const move = (e: MouseEvent) => {
    const meta = metricFor(svg);
    const ps = points(svg);
    if (!ps.length) return;
    const rect = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
    const x = ((e.clientX - rect.left) / Math.max(1, rect.width)) * vb.width;
    const point = ps.reduce((a, b) => Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b);
    const value = point.value ?? valueAt(svg, point.y);
    tooltip(e, `<strong>${meta.name}</strong><span>Historical telemetry · nearest rendered point</span><b>${Number.isFinite(value) ? value.toFixed(meta.unit === '%' ? 2 : 1) : '—'} ${meta.unit}</b>`);
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => document.querySelector<HTMLElement>('#axis-chart-tooltip-v5')?.style.setProperty('display', 'none'));
}
export function installHoverMetricFixV42() {
  const win = window as Window & { __axisHoverMetricFixV42?: boolean };
  if (win.__axisHoverMetricFixV42) return;
  win.__axisHoverMetricFixV42 = true;
  const refresh = () => document.querySelectorAll<SVGSVGElement>('.chart-wrap svg,.forecast-band-wrap svg,.projection-svg').forEach(install);
  const observer = new MutationObserver(() => window.setTimeout(refresh, 80));
  observer.observe(document.body, { subtree: true, childList: true });
  document.addEventListener('change', () => window.setTimeout(refresh, 120));
  refresh();
}
