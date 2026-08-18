type AxisRange = { start: Date; end: Date };

function currentRange(): AxisRange {
  const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find((node) => node.previousElementSibling?.textContent?.toLowerCase().includes('current data'));
  const value = select?.value ?? 'Last 24 hours';
  const end = new Date();
  const start = new Date(end);
  if (/1 hour/i.test(value)) start.setHours(start.getHours() - 1);
  else if (/6 hours/i.test(value)) start.setHours(start.getHours() - 6);
  else if (/7 days/i.test(value)) start.setDate(start.getDate() - 7);
  else if (/30 days/i.test(value)) start.setDate(start.getDate() - 30);
  else start.setHours(start.getHours() - 24);
  return { start, end };
}

function forecastRange(): AxisRange | null {
  const raw = [...document.querySelectorAll('.forecast-select-row span')].find((node) => node.textContent?.includes('→'))?.textContent ?? '';
  const parts = raw.split('→').map((v) => new Date(v.trim())).filter((v) => !Number.isNaN(v.getTime()));
  if (parts.length !== 2) return null;
  const end = parts[1];
  const start = new Date(parts[0]);
  start.setDate(start.getDate() - 30);
  return { start, end };
}

function fmt(date: Date, includeTime = false) {
  return new Intl.DateTimeFormat('en-IN', includeTime
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function setDateAxisLabels(svg: SVGSVGElement) {
  const labels = [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')];
  const generic = labels.filter((node) => /^(Start|Midpoint|Now|Historical start|Today|Forecast end|Latest)$/.test(node.textContent?.trim() ?? ''));
  if (generic.length < 2) return;
  const range = svg.closest('.forecast-panel') ? (forecastRange() ?? currentRange()) : currentRange();
  const mid = new Date((range.start.getTime() + range.end.getTime()) / 2);
  const values = [fmt(range.start), fmt(mid), fmt(range.end)];
  generic.slice(-3).forEach((node, index) => { node.textContent = values[index] ?? values.at(-1)!; });

  const title = svg.querySelector<SVGTextElement>('.chart-axis-title');
  if (title) title.textContent = 'Date / time';
}

function installTooltipStyle() {
  if (document.getElementById('axis-chart-ux-style')) return;
  const style = document.createElement('style');
  style.id = 'axis-chart-ux-style';
  style.textContent = `
    .chart-hover-tooltip{position:fixed!important;z-index:2147483647!important;pointer-events:none!important;max-width:320px!important;min-width:190px!important;background:#10233e!important;color:#fff!important;border:1px solid #335476!important;border-radius:9px!important;padding:10px 12px!important;box-shadow:0 10px 28px rgba(0,0,0,.24)!important;font-size:11px!important;line-height:1.35!important}
    .chart-hover-tooltip strong,.chart-hover-tooltip span,.chart-hover-tooltip b,.chart-hover-tooltip small{display:block!important;color:#fff!important}
    .chart-hover-tooltip span{margin-top:3px;color:#d8e6f7!important}.chart-hover-tooltip b{font-size:14px;margin-top:4px;color:#fff!important}.chart-hover-tooltip small{margin-top:5px;color:#a9bfd8!important}
    .interactive-chart{position:relative!important;overflow:visible!important}.chart-wrap{overflow:visible!important}
  `;
  document.head.appendChild(style);
}

function repositionTooltip(event: MouseEvent) {
  const tooltip = document.querySelector<HTMLElement>('.chart-hover-tooltip');
  if (!tooltip || tooltip.style.display === 'none') return;
  const pad = 14;
  const width = tooltip.offsetWidth || 220;
  const height = tooltip.offsetHeight || 90;
  let left = event.clientX + pad;
  let top = event.clientY - height - pad;
  if (left + width > window.innerWidth - pad) left = event.clientX - width - pad;
  if (top < pad) top = event.clientY + pad;
  left = Math.max(pad, Math.min(left, window.innerWidth - width - pad));
  top = Math.max(pad, Math.min(top, window.innerHeight - height - pad));
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

export function installChartUxFixes() {
  const state = window as Window & { __axisChartUxFixes?: boolean };
  if (state.__axisChartUxFixes) return;
  state.__axisChartUxFixes = true;
  installTooltipStyle();

  const refresh = () => {
    document.querySelectorAll<SVGSVGElement>('.chart-wrap svg, .projection-svg').forEach(setDateAxisLabels);
  };

  document.addEventListener('click', () => window.setTimeout(refresh, 120), true);
  document.addEventListener('change', () => window.setTimeout(refresh, 120), true);
  document.addEventListener('mousemove', repositionTooltip, true);
  window.addEventListener('resize', refresh);
  window.setTimeout(refresh, 300);
}
