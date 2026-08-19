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
function metricKey(panel: Element) {
  const s = panel.querySelector<HTMLSelectElement>('select');
  if (s?.value && META[s.value]) return s.value;
  const t = panel.querySelector('.chart-title-row strong')?.textContent?.toLowerCase() || '';
  if (t.includes('memory')) return 'memory';
  if (t.includes('disk')) return 'disk';
  if (t.includes('network rx') || t.includes('receive')) return 'networkRx';
  if (t.includes('network tx') || t.includes('transmit')) return 'networkTx';
  if (t.includes('throughput')) return 'throughput';
  if (t.includes('cpu')) return 'cpu';
  return '';
}
function metaFor(svg: SVGSVGElement): MetricMeta {
  const panel = svg.closest('.chart-panel');
  const key = panel && metricKey(panel);
  if (key) return META[key];
  const t = (svg.getAttribute('aria-label') || svg.closest('.projection-card')?.querySelector('.chart-title-row strong')?.textContent || '').toLowerCase();
  if (t.includes('memory')) return META.memory;
  if (t.includes('disk')) return META.disk;
  if (t.includes('network rx') || t.includes('receive')) return META.networkRx;
  if (t.includes('network tx') || t.includes('transmit')) return META.networkTx;
  if (t.includes('throughput')) return META.throughput;
  return META.cpu;
}
function rangeMs() {
  const s = [...document.querySelectorAll<HTMLSelectElement>('select')].find((x) => /current data/i.test(x.previousElementSibling?.textContent || ''));
  const v = s?.value || 'Last 24 hours';
  if (/1 hour/i.test(v)) return 3600000;
  if (/6 hours/i.test(v)) return 21600000;
  if (/7 days/i.test(v)) return 604800000;
  if (/30 days/i.test(v)) return 2592000000;
  return 86400000;
}
function forecastHorizon() {
  const s = [...document.querySelectorAll<HTMLSelectElement>('select')].find((x) => /forecast/i.test(x.previousElementSibling?.textContent || ''));
  return Math.max(1, Number(s?.value || 30));
}
function ticks(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map((n) => ({ y: Number(n.getAttribute('y')), v: Number((n.textContent || '').replace(/[^0-9.+-]/g, '')) }))
    .filter((x) => Number.isFinite(x.y) && Number.isFinite(x.v))
    .sort((a, b) => a.y - b.y);
}
function valueAt(svg: SVGSVGElement, y: number) {
  const t = ticks(svg);
  if (t.length >= 2) {
    const a = t[0], b = t[t.length - 1];
    return a.v + ((y - a.y) / Math.max(1, b.y - a.y)) * (b.v - a.v);
  }
  return NaN;
}
type Point = { x: number; y: number; forecast: boolean; value?: number; day?: string };
function points(svg: SVGSVGElement): Point[] {
  const out: Point[] = [];
  // Use every rendered polyline point so hover is not restricted to the sparse visible circles.
  [...svg.querySelectorAll<SVGPolylineElement>('polyline')].forEach((line) => {
    const forecast = /forecast/i.test(line.getAttribute('class') || '');
    const raw = (line.getAttribute('points') || '').trim();
    const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) out.push({ x: nums[i], y: nums[i + 1], forecast });
    }
  });
  [...svg.querySelectorAll<SVGCircleElement>('circle')].forEach((c) => {
    const x = Number(c.getAttribute('cx')), y = Number(c.getAttribute('cy'));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, forecast: /forecast/i.test(c.getAttribute('class') || ''), value: Number(c.getAttribute('data-value') || '') || undefined, day: c.getAttribute('data-day') || undefined });
  });
  return out;
}
function show(e: MouseEvent, html: string) {
  let t = document.querySelector<HTMLElement>('#axis-chart-tooltip-v5');
  if (!t) { t = document.createElement('div'); t.id = 'axis-chart-tooltip-v5'; t.className = 'chart-hover-tooltip'; document.body.appendChild(t); }
  t.innerHTML = html; t.style.display = 'block'; t.style.position = 'fixed'; t.style.zIndex = '2147483647'; t.style.pointerEvents = 'none';
  const w = t.offsetWidth || 250, h = t.offsetHeight || 92; let x = e.clientX + 16, y = e.clientY - h - 16;
  if (x + w > innerWidth) x = e.clientX - w - 16; if (y < 8) y = e.clientY + 16;
  t.style.left = `${Math.max(8, x)}px`; t.style.top = `${Math.max(8, y)}px`;
}
function hide() { document.querySelector<HTMLElement>('#axis-chart-tooltip-v5')?.style.setProperty('display', 'none'); }
function install(svg: SVGSVGElement) {
  if (svg.dataset.hoverV5 === '1') return;
  const ps = points(svg); if (!ps.length) return;
  const meta = metaFor(svg), projection = Boolean(svg.closest('.projection-card'));
  const forecastChart = Boolean(svg.closest('.forecast-band-wrap')) || ps.some((p) => p.forecast);
  const move = (e: MouseEvent) => {
    const r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    const x = ((e.clientX - r.left) / Math.max(1, r.width)) * vb.width;
    const p = ps.reduce((a, b) => Math.abs(a.x - x) < Math.abs(b.x - x) ? a : b);
    const val = p.value ?? valueAt(svg, p.y); let date = '';
    if (p.day) date = `${p.day} days from now`;
    else {
      const splitText = [...svg.querySelectorAll<SVGLineElement>('.forecast-split')][0];
      const splitX = splitText ? Number(splitText.getAttribute('x1')) : NaN;
      const left = 48, right = vb.width - 28, f = Math.max(0, Math.min(1, (p.x - left) / Math.max(1, right - left)));
      const horizon = forecastHorizon(); let start = Date.now() - rangeMs(), end = Date.now();
      if (forecastChart && p.forecast) { start = Date.now(); end = Date.now() + horizon * 86400000; }
      else if (forecastChart && Number.isFinite(splitX) && p.x < splitX) { start = Date.now() - 30 * 86400000; end = Date.now(); }
      date = new Date(start + (end - start) * f).toLocaleString('en-IN');
    }
    show(e, `<strong>${meta.name}</strong><span>${date}</span><b>${Number.isFinite(val) ? val.toFixed(meta.unit === '%' ? 2 : 1) : '—'} ${meta.unit}</b><small>${p.forecast ? 'Dynatrace forecast' : projection ? 'Traffic-driven scenario estimate' : 'Historical telemetry'} · nearest rendered point</small>`);
  };
  svg.addEventListener('mousemove', move); svg.addEventListener('mouseleave', hide); svg.dataset.hoverV5 = '1';
}
function refresh() {
  document.querySelectorAll<HTMLElement>('.chart-panel').forEach((p) => {
    const k = metricKey(p); if (!k) return; const m = META[k], row = p.querySelector('.chart-title-row');
    if (row) { const strong = row.querySelector('strong'), span = row.querySelector('span'); if (strong) strong.textContent = `${m.name} (${m.unit})`; if (span) span.textContent = `Unit: ${m.unit} · X-axis: Date / time · Hover for exact value`; }
  });
  document.querySelectorAll<SVGSVGElement>('.chart-wrap svg,.forecast-band-wrap svg,.projection-svg').forEach(install);
}
export function installUiFixesV4() {
  const w = window as Window & { __axisUiFixesV5?: boolean }; if (w.__axisUiFixesV5) return; w.__axisUiFixesV5 = true;
  const ob = new MutationObserver(() => { clearTimeout((ob as any).timer); (ob as any).timer = setTimeout(refresh, 100); });
  ob.observe(document.body, { subtree: true, childList: true }); document.addEventListener('change', () => setTimeout(refresh, 150)); document.addEventListener('click', () => setTimeout(refresh, 150)); void sleep(250).then(refresh);
}
