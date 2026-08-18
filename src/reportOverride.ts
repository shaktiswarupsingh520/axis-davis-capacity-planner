type ChartInfo = { title: string; unit: string; svg: SVGSVGElement };
type Snapshot = { page: string; title: string; cards: string[]; ai: string; verification: string; charts: ChartInfo[] };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const esc = (value: string) => value.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');

function pdfText(page: string[], x: number, y: number, value: string, size = 9, bold = false) {
  page.push(`0 0 0 rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`);
}
function pdfLine(page: string[], x1: number, y1: number, x2: number, y2: number, color = '0.84 0.87 0.91 RG', width = 0.7) {
  page.push(`${color} ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
}
function readNumericTicks(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map((node) => ({ label: node.textContent?.trim() ?? '', y: Number(node.getAttribute('y') ?? NaN) }))
    .filter((item) => /^-?\d+(?:\.\d+)?%?$/.test(item.label) && Number.isFinite(item.y))
    .sort((a, b) => a.y - b.y)
    .slice(0, 5);
}
function readXLabels(svg: SVGSVGElement) {
  return [...svg.querySelectorAll<SVGTextElement>('.chart-axis-label')]
    .map((node) => node.textContent?.trim() ?? '')
    .filter((text) => text && !/^-?\d+(?:\.\d+)?%?$/.test(text));
}
function polylineToPdf(svg: SVGSVGElement, page: string[], points: string, box: { x: number; y: number; w: number; h: number }, color: string, fill = false) {
  const view = svg.viewBox.baseVal;
  const source = points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (source.length < 2) return;
  const mapped = source.map(([sx, sy]) => [box.x + (sx / Math.max(1, view.width)) * box.w, box.y + box.h - (sy / Math.max(1, view.height)) * box.h] as const);
  const path = mapped.map(([x, y], index) => `${x.toFixed(2)} ${y.toFixed(2)} ${index ? 'l' : 'm'}`).join(' ');
  if (fill) page.push(`${color} rg ${path} h f`);
  else page.push(`${color} RG 1.7 w ${path} S`);
}
function chartToPdf(chart: ChartInfo, page: string[], x: number, y: number, w: number, h: number) {
  const svg = chart.svg;
  const box = { x, y, w, h };
  const unit = /throughput/i.test(chart.title) ? 'req/min' : /network/i.test(chart.title) ? 'bytes/s' : /cpu|memory|disk|utilization/i.test(chart.title) ? '%' : chart.unit || 'value';
  pdfText(page, x, y + h + 22, chart.title, 11, true);
  pdfText(page, x + w - 90, y + h + 22, `Unit: ${unit}`, 7);

  const ticks = readNumericTicks(svg);
  if (ticks.length >= 2) {
    for (const tick of ticks) {
      const yy = y + h - (tick.y / Math.max(1, svg.viewBox.baseVal.height)) * h;
      pdfLine(page, x, yy, x + w, yy);
      pdfText(page, x - 35, yy - 3, tick.label, 7);
    }
  } else {
    ['100', '75', '50', '25', '0'].forEach((label, index) => {
      const yy = y + h * (1 - index / 4);
      pdfLine(page, x, yy, x + w, yy);
      pdfText(page, x - 35, yy - 3, label, 7);
    });
  }

  const threshold = svg.querySelector<SVGLineElement>('.threshold-line');
  if (threshold) {
    const y1 = Number(threshold.getAttribute('y1') ?? 0);
    const py = y + h - (y1 / Math.max(1, svg.viewBox.baseVal.height)) * h;
    pdfLine(page, x, py, x + w, py, '0.88 0.35 0.30 RG', 1);
    pdfText(page, x + w - 110, py + 6, 'Capacity threshold', 7);
  }
  const forecast = svg.querySelector<SVGLineElement>('.forecast-split');
  if (forecast) {
    const sx = Number(forecast.getAttribute('x1') ?? 0);
    const px = x + sx / Math.max(1, svg.viewBox.baseVal.width) * w;
    pdfLine(page, px, y, px, y + h, '0.48 0.55 0.65 RG', 0.8);
  }
  const band = svg.querySelector<SVGPolygonElement>('.forecast-band');
  if (band) polylineToPdf(svg, page, band.getAttribute('points') ?? '', box, '0.95 0.78 0.25', true);
  const lines = [...svg.querySelectorAll<SVGPolylineElement>('polyline')];
  for (const line of lines) {
    const classes = line.getAttribute('class') ?? '';
    const points = line.getAttribute('points') ?? '';
    if (classes.includes('scenario-line actual') || classes.includes('chart-line actual')) polylineToPdf(svg, page, points, box, '0.12 0.43 0.95');
    else if (classes.includes('scenario-line forecast') || classes.includes('chart-line forecast')) polylineToPdf(svg, page, points, box, '0.92 0.43 0.12');
    else if (classes.includes('chart-line upper')) polylineToPdf(svg, page, points, box, '0.82 0.58 0.14');
  }
  const xLabels = readXLabels(svg);
  pdfText(page, x, y - 16, xLabels[0] || 'Start', 7);
  pdfText(page, x + w / 2 - 20, y - 16, xLabels[Math.floor(xLabels.length / 2)] || 'Midpoint', 7);
  pdfText(page, x + w - 42, y - 16, xLabels.at(-1) || 'Latest', 7);
  pdfText(page, x + w / 2 - 16, y - 30, 'Time', 7);
  if (svg.querySelector('.chart-line.forecast')) pdfText(page, x + 6, y + h - 12, 'Blue: historical/current  |  Orange: Dynatrace forecast/simulation', 7);
  if (band) pdfText(page, x + 6, y + h - 24, 'Gold: 90% prediction interval', 7);
}
function collectSnapshot(): Snapshot {
  const page = document.querySelector('.nav-item.active')?.textContent?.trim() || 'Overview';
  const title = document.querySelector('.page-title h1')?.textContent?.trim() || 'Capacity Planner';
  const cards = [...document.querySelectorAll<HTMLElement>('.metric-card')].slice(0, 12).map((element) => element.innerText.replace(/\n+/g, ' · ').trim()).filter(Boolean);
  const ai = document.querySelector('.ai-summary')?.textContent?.trim() || '';
  const verification = document.querySelector('.verification-grid')?.textContent?.trim() || document.querySelector('.traffic-summary')?.textContent?.trim() || '';
  const charts = [...document.querySelectorAll('.chart-wrap svg')].map((svg) => {
    const title = svg.parentElement?.querySelector('.chart-title-row strong')?.textContent?.trim() || svg.parentElement?.parentElement?.querySelector('h2')?.textContent?.trim() || 'Trend';
    const unit = svg.parentElement?.querySelector('.chart-title-row span')?.textContent?.replace(/^Unit:\s*/i, '').split('·')[0].trim() || '';
    return { title, unit, svg: svg as SVGSVGElement };
  });
  return { page, title, cards, ai, verification, charts };
}
function clickNav(name: string) { const button = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find((item) => item.innerText.trim() === name); button?.click(); return Boolean(button); }
function clickButton(regex: RegExp) { const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((item) => regex.test(item.innerText.trim())); button?.click(); return button; }
function setHostMetric(metric: string) { const select = document.querySelector<HTMLSelectElement>('.chart-panel select'); if (!select) return; select.value = metric; select.dispatchEvent(new Event('change', { bubbles: true })); }
function buildPdf(snapshots: Snapshot[]) {
  const pages: string[][] = [];
  const base = (title: string, subtitle: string) => { const page: string[] = []; pdfText(page, 40, 750, 'AXIS BANK  |  ApMoSys TECHNOLOGIES', 11, true); pdfText(page, 40, 725, title, 17, true); pdfText(page, 40, 708, subtitle, 9); pdfText(page, 40, 690, 'Developer: Shaktiswarup Pahantasingh', 8); return page; };
  const overview = snapshots.find((s) => s.page.includes('Overview')) || snapshots[0];
  let page = base('Executive Capacity Report', `${overview?.title || 'Capacity Planner'} · ${new Date().toLocaleString()}`);
  let y = 655;
  (overview?.cards || []).slice(0, 8).forEach((card) => { pdfText(page, 40, y, card, 9); y -= 18; });
  if (overview?.verification) { y -= 6; pdfText(page, 40, y, 'Verified application-service throughput', 11, true); y -= 18; overview.verification.split(/\n|\s{2,}/).filter(Boolean).slice(0, 8).forEach((line) => { pdfText(page, 40, y, line.slice(0, 100), 8); y -= 14; }); }
  const ai = snapshots.map((s) => s.ai).find(Boolean) || 'Dynatrace Assist analysis was not available for this report run.';
  pdfText(page, 40, Math.max(330, y - 6), 'AI-assisted capacity assessment', 11, true);
  ai.split(/\n+/).filter(Boolean).slice(0, 12).forEach((line, i) => pdfText(page, 40, Math.max(305, y - 25 - i * 14), line.slice(0, 105), 8));
  pages.push(page);

  const hostCharts = snapshots.filter((s) => s.page.includes('Host Inventory') && s.charts.length).flatMap((s) => s.charts);
  page = base('Infrastructure Trend Analysis', 'Observed telemetry with explicit units and correctly oriented axes.');
  hostCharts.slice(0, 4).forEach((chart, i) => chartToPdf(chart, page, 55, 420 - i * 140, 500, 115));
  if (!hostCharts.length) pdfText(page, 55, 620, 'No host trend charts were captured during report generation.', 9);
  pages.push(page);

  const forecast = snapshots.find((s) => s.page.includes('Capacity Forecast'));
  const simulation = snapshots.find((s) => s.page.includes('Simulation'));
  page = base('Forecast & What-if Simulation', forecast?.title || 'Dynatrace Intelligence forecast');
  const forecastChart = forecast?.charts.find((chart) => chart.svg.querySelector('.chart-line.forecast'));
  if (forecastChart) chartToPdf(forecastChart, page, 55, 420, 500, 205);
  else pdfText(page, 55, 610, 'No usable Dynatrace forecast graph was returned. No forecast is fabricated.', 9);
  const simChart = simulation?.charts.find((chart) => chart.svg.querySelector('.scenario-line'));
  if (simChart) chartToPdf(simChart, page, 55, 145, 500, 190);
  else pdfText(page, 55, 345, 'No simulation trajectory was captured.', 9);
  pages.push(page);

  page = base('AI Recommendations', 'Capacity recommendations grounded in the captured live scope and forecast context.');
  let ay = 650;
  ai.split(/\n+/).filter(Boolean).slice(0, 36).forEach((line) => { if (ay >= 75) { pdfText(page, 50, ay, line.slice(0, 110), 8); ay -= 16; } });
  pages.push(page);

  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`];
  pages.forEach((content, i) => { const pageNo = 3 + i * 2; const contentNo = pageNo + 1; const stream = content.join('\n'); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R /F2 10 0 R >> >> /Contents ${contentNo} 0 R >>`); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let output = '%PDF-1.4\n'; const offsets: number[] = [0]; objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([output], { type: 'application/pdf' })); anchor.download = 'axis-capacity-report.pdf'; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function installPdfReportOverride() {
  const state = window as Window & { __axisPdfOverrideInstalled?: boolean };
  if (state.__axisPdfOverrideInstalled) return;
  state.__axisPdfOverrideInstalled = true;
  document.addEventListener('click', async (event) => {
    const target = event.target instanceof Element ? event.target.closest('.pdf-report-button') : null;
    if (!target) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const snapshots: Snapshot[] = [];
    clickNav('Overview'); await sleep(300);
    if (!document.querySelector('.ai-summary')) {
      const button = clickButton(/Generate AI Assessment/i);
      if (button) { const start = Date.now(); while (Date.now() - start < 15000 && !document.querySelector('.ai-summary')) await sleep(500); }
    }
    snapshots.push(collectSnapshot());
    clickNav('Host Inventory'); await sleep(350);
    const firstRow = document.querySelector<HTMLTableRowElement>('table tbody tr');
    if (firstRow) {
      firstRow.click(); await sleep(350);
      for (const metric of ['throughput', 'cpu', 'memory', 'disk']) { setHostMetric(metric); await sleep(220); snapshots.push(collectSnapshot()); }
      clickButton(/Back to inventory/i); await sleep(250);
    }
    clickNav('Capacity Forecast'); await sleep(350); snapshots.push(collectSnapshot());
    clickNav('Simulation'); await sleep(600); snapshots.push(collectSnapshot());
    buildPdf(snapshots);
  }, true);
}
