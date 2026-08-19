import { jsPDF } from 'jspdf';

type ChartSnap = { title: string; unit: string; svg: SVGSVGElement; context: 'history' | 'forecast' | 'simulation' };
type Kpi = { label: string; value: string; detail: string };
type HostRow = { host: string; environment: string; application: string; cpu: string; memory: string; disk: string; throughput: string; status: string };
type ProjectionPoint = { day: number; value: number };
type ProjectionSeries = { name: string; values: ProjectionPoint[]; r2: string; samples: string; confidence: string };
type ReportState = {
  zone: string;
  timeRange: string;
  horizon: string;
  generatedAt: string;
  overviewKpis: Kpi[];
  ai: string;
  charts: ChartSnap[];
  forecastContext: string[];
  hosts: HostRow[];
  scenario: {
    growth: number;
    currentTraffic: number;
    scenarioTraffic: number;
    horizon: number;
    projections: ProjectionSeries[];
  } | null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const NAV = ['Overview', 'Host Inventory', 'Capacity Forecast', 'Simulation'];

const COLORS = {
  navy: [22, 41, 67] as const,
  blue: [44, 103, 180] as const,
  blueSoft: [232, 240, 250] as const,
  teal: [32, 132, 125] as const,
  amber: [206, 137, 34] as const,
  red: [190, 74, 65] as const,
  green: [45, 132, 91] as const,
  text: [37, 49, 66] as const,
  muted: [95, 109, 128] as const,
  border: [214, 222, 232] as const,
  light: [247, 249, 252] as const,
  white: [255, 255, 255] as const,
};

function txt(element: Element | null): string { return element?.textContent?.replace(/\s+/g, ' ').trim() || ''; }
function nav(name: string) { [...document.querySelectorAll<HTMLButtonElement>('.nav-item')].find((button) => button.innerText.trim() === name)?.click(); }
function activePage(): string { return document.querySelector('.nav-item.active')?.textContent?.trim() || ''; }
async function waitFor(predicate: () => boolean, timeout = 30000) { const started = Date.now(); while (Date.now() - started < timeout) { if (predicate()) return true; await sleep(250); } return false; }
function numberFrom(text: string): number | null { const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/); return match ? Number(match[0]) : null; }
function pct(text: string): number { return numberFrom(text) ?? 0; }
function metricMeta(panel: Element): [string, string] {
  const title = txt(panel.querySelector('h2,.chart-title-row strong')).toLowerCase();
  if (title.includes('memory')) return ['Memory utilization', '%'];
  if (title.includes('disk')) return ['Disk utilization', '%'];
  if (title.includes('network rx') || title.includes('receive')) return ['Network RX', 'B/s'];
  if (title.includes('network tx') || title.includes('transmit')) return ['Network TX', 'B/s'];
  if (title.includes('throughput')) return ['Application throughput', 'req/min'];
  return ['CPU utilization', '%'];
}
function chartContext(svg: SVGSVGElement): ChartSnap['context'] {
  if (svg.closest('.projection-card') || svg.classList.contains('projection-svg')) return 'simulation';
  if (svg.closest('.forecast-panel') || svg.closest('.forecast-band-wrap')) return 'forecast';
  return 'history';
}
function snapshotCharts(): ChartSnap[] {
  return [...document.querySelectorAll<SVGSVGElement>('.chart-wrap svg,.forecast-band-wrap svg,.projection-svg')].map((svg) => {
    const panel = svg.closest('.chart-panel,.projection-card,.forecast-band-wrap') || svg.parentElement || svg;
    const [title, unit] = metricMeta(panel);
    return { title, unit, context: chartContext(svg), svg: svg.cloneNode(true) as SVGSVGElement };
  });
}
function snapshotKpis(): Kpi[] {
  return [...document.querySelectorAll<HTMLElement>('.metric-card')].map((card) => ({
    label: txt(card.querySelector('p')) || txt(card.querySelector('[class*=label]')),
    value: txt(card.querySelector('strong')),
    detail: txt(card.querySelector('small')),
  })).filter((k) => k.label && k.value);
}
function snapshotAi(): string {
  const node = document.querySelector<HTMLElement>('.ai-summary pre') || document.querySelector<HTMLElement>('.ai-summary') || document.querySelector<HTMLElement>('.ai-panel pre');
  return node?.innerText?.trim() || '';
}
function snapshotHosts(): HostRow[] {
  return [...document.querySelectorAll<HTMLTableRowElement>('table tbody tr')].map((row) => {
    const cells = [...row.cells].map((cell) => txt(cell));
    if (!cells.length) return null;
    return {
      host: cells[0] || '—',
      environment: cells[1] || '—',
      application: cells[2] || '—',
      cpu: cells[3] || '—',
      memory: cells[4] || '—',
      disk: cells[5] || '—',
      throughput: cells[6] || '—',
      status: cells[7] || '—',
    };
  }).filter((x): x is HostRow => Boolean(x && x.host !== '—'));
}
function extractForecastContext(): string[] {
  return [...document.querySelectorAll<HTMLElement>('.forecast-source,.forecast-select-row,.forecast-panel .panel-subtitle')].map(txt).filter(Boolean);
}
function extractProjectionSeries(): ProjectionSeries[] {
  return [...document.querySelectorAll<HTMLElement>('.projection-card')].map((card) => {
    const name = txt(card.querySelector('.chart-title-row strong')) || 'Resource utilization';
    const svg = card.querySelector<SVGSVGElement>('svg');
    const values = svg ? [...svg.querySelectorAll<SVGCircleElement>('circle')].map((circle) => ({ day: numberFrom(circle.getAttribute('data-day') || '') ?? 0, value: numberFrom(circle.getAttribute('data-value') || '') ?? NaN })).filter((p) => Number.isFinite(p.value)).sort((a, b) => a.day - b.day) : [];
    const meta = txt(card.querySelector('.projection-meta'));
    return {
      name,
      values,
      r2: meta.match(/R²:\s*([0-9.]+)/i)?.[1] || '—',
      samples: meta.match(/Aligned samples:\s*(\d+)/i)?.[1] || '—',
      confidence: meta.match(/(High confidence|Moderate confidence|Low confidence|proportional fallback)/i)?.[1] || '—',
    };
  }).filter((s) => s.values.length > 0);
}
function extractScenario(): ReportState['scenario'] {
  const detail = document.querySelector<HTMLElement>('.simulation-scenario-detail');
  const assumptions = document.querySelectorAll<HTMLElement>('.scenario-assumptions div');
  const cards = [...assumptions].map((item) => txt(item));
  const growth = numberFrom(txt(detail?.querySelector('.projection-header h2'))) ?? numberFrom(txt(detail));
  const current = numberFrom(cards.find((x) => /current traffic/i.test(x)) || '') ?? 0;
  const target = numberFrom(cards.find((x) => /scenario traffic/i.test(x)) || '') ?? 0;
  const horizon = numberFrom(cards.find((x) => /forecast checkpoints/i.test(x)) || '') ?? 90;
  const projections = extractProjectionSeries();
  if (!detail && !projections.length) return null;
  return { growth: growth ?? 0, currentTraffic: current, scenarioTraffic: target, horizon, projections };
}
function snapshotState(): ReportState {
  const zoneSelect = [...document.querySelectorAll<HTMLSelectElement>('select')].find((s) => /management zone/i.test(s.previousElementSibling?.textContent || ''));
  const rangeSelect = [...document.querySelectorAll<HTMLSelectElement>('select')].find((s) => /current data/i.test(s.previousElementSibling?.textContent || ''));
  const forecastSelect = [...document.querySelectorAll<HTMLSelectElement>('select')].find((s) => /forecast/i.test(s.previousElementSibling?.textContent || ''));
  return { zone: zoneSelect?.value || 'All Management Zones', timeRange: rangeSelect?.value || 'Current window', horizon: forecastSelect?.value ? `${forecastSelect.value} days` : '30 days', generatedAt: new Date().toLocaleString('en-IN'), overviewKpis: snapshotKpis(), ai: snapshotAi(), charts: snapshotCharts(), forecastContext: extractForecastContext(), hosts: snapshotHosts(), scenario: extractScenario() };
}
async function generateAiIfMissing() {
  if (snapshotAi()) return;
  const button = document.querySelector<HTMLButtonElement>('.ai-panel .ai-button');
  if (!button) return;
  button.click();
  await waitFor(() => Boolean(snapshotAi()), 45000);
}
async function ensureForecast() {
  if (document.querySelector('.forecast-panel .chart-wrap svg, .forecast-panel svg')) return;
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => /Run .*forecast/i.test(b.innerText));
  if (button) button.click();
  await waitFor(() => Boolean(document.querySelector('.forecast-panel .chart-wrap svg, .forecast-panel svg')), 45000);
}
async function setMetric(key: string) {
  const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find((s) => ['throughput', 'cpu', 'memory', 'disk', 'networkRx', 'networkTx'].includes(s.value) || /metric/i.test(s.previousElementSibling?.textContent || ''));
  if (!select) return;
  select.value = key;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await waitFor(() => Boolean(document.querySelector('.chart-wrap svg')), 7000);
}
async function collect(): Promise<ReportState> {
  nav('Overview'); await sleep(700); const overviewBefore = snapshotState();
  nav('Host Inventory'); await sleep(700); const hosts = snapshotHosts();
  const hostCharts: ChartSnap[] = [];
  if (hosts.length && document.querySelector('table tbody tr')) {
    (document.querySelector('table tbody tr') as HTMLTableRowElement).click();
    await sleep(650);
    for (const key of ['throughput', 'cpu', 'memory', 'disk', 'networkRx', 'networkTx']) { await setMetric(key); hostCharts.push(...snapshotCharts().filter((c) => c.context === 'history')); }
    nav('Host Inventory'); await sleep(500);
  }
  nav('Capacity Forecast'); await sleep(700); await ensureForecast(); const forecastState = snapshotState();
  nav('Overview'); await sleep(500); await generateAiIfMissing(); const aiState = snapshotState();
  nav('Simulation'); await sleep(700); await waitFor(() => document.querySelectorAll('.projection-card').length >= 3 || document.querySelectorAll('.projection-svg').length >= 3, 20000); const simulationState = snapshotState();
  return {
    ...overviewBefore,
    ai: aiState.ai,
    hosts,
    charts: [...hostCharts, ...forecastState.charts.filter((c) => c.context === 'forecast')],
    forecastContext: forecastState.forecastContext,
    scenario: simulationState.scenario,
  };
}
function addHeader(doc: jsPDF, title: string, subtitle: string, state: ReportState) {
  doc.setFillColor(...COLORS.navy); doc.rect(0, 0, 595, 86, 'F');
  doc.setTextColor(...COLORS.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('AXIS BANK  |  ApMoSys TECHNOLOGIES', 38, 28);
  doc.setFontSize(20); doc.text(title, 38, 53); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(subtitle, 38, 70);
  doc.text(`${state.zone}  ·  ${state.timeRange}  ·  ${state.generatedAt}`, 557, 28, { align: 'right' });
}
function addFooter(doc: jsPDF, page: number, total: number) {
  doc.setDrawColor(...COLORS.border); doc.line(38, 790, 557, 790); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...COLORS.muted); doc.text('Axis Davis Capacity Planner  ·  Live Dynatrace telemetry  ·  Planning report', 38, 805); doc.text(`Page ${page} of ${total}`, 557, 805, { align: 'right' });
}
function sectionTitle(doc: jsPDF, title: string, y: number, subtitle?: string) {
  doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text(title, 38, y); if (subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORS.muted); doc.text(subtitle, 38, y + 14); } return y + (subtitle ? 28 : 20);
}
function drawKpiCard(doc: jsPDF, x: number, y: number, w: number, h: number, kpi: Kpi, tone: readonly number[] = COLORS.blue) {
  doc.setFillColor(...COLORS.white); doc.setDrawColor(...COLORS.border); doc.roundedRect(x, y, w, h, 6, 6, 'FD'); doc.setFillColor(...tone); doc.roundedRect(x, y, 5, h, 3, 3, 'F');
  doc.setTextColor(...COLORS.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(kpi.label, x + 14, y + 17);
  doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.text(kpi.value, x + 14, y + 38);
  doc.setTextColor(...COLORS.muted); doc.setFontSize(7); const details = doc.splitTextToSize(kpi.detail || 'Live Dynatrace value', w - 28); doc.text(details.slice(0, 2), x + 14, y + 51);
}
function drawTable(doc: jsPDF, x: number, y: number, widths: number[], headers: string[], rows: string[][], rowH = 19) {
  const totalW = widths.reduce((a, b) => a + b, 0);
  let yy = y;
  doc.setFillColor(...COLORS.navy); doc.rect(x, yy, totalW, rowH, 'F'); doc.setTextColor(...COLORS.white); doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2); let xx = x;
  headers.forEach((header, i) => { doc.text(header, xx + 5, yy + 12); xx += widths[i]; }); yy += rowH;
  rows.forEach((row, r) => { doc.setFillColor(...(r % 2 ? COLORS.light : COLORS.white)); doc.setDrawColor(...COLORS.border); doc.rect(x, yy, totalW, rowH, 'FD'); xx = x; doc.setTextColor(...COLORS.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8); row.forEach((cell, i) => { const lines = doc.splitTextToSize(String(cell), Math.max(20, widths[i] - 8)); doc.text(lines.slice(0, 2), xx + 4, yy + 11); xx += widths[i]; }); yy += rowH; });
  return yy;
}
async function svgToPng(svg: SVGSVGElement, width = 1120, height = 420): Promise<string> {
  const clone = svg.cloneNode(true) as SVGSVGElement; clone.setAttribute('width', String(width)); clone.setAttribute('height', String(height)); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style'); style.textContent = '.chart-grid{stroke:#dfe6ef;stroke-width:1}.chart-line.actual{fill:none;stroke:#2c67b4;stroke-width:3}.chart-line.forecast{fill:none;stroke:#ce8922;stroke-width:3;stroke-dasharray:7 5}.chart-line.upper{fill:none;stroke:#ce8922;stroke-width:1.5;stroke-dasharray:4 4}.forecast-band{fill:#ce8922;fill-opacity:.15}.threshold-line{stroke:#be4a41;stroke-width:1.5;stroke-dasharray:5 4}.chart-axis-label,.chart-axis-title,.threshold-label,.projection-label{font-family:Arial,sans-serif;font-size:11px;fill:#40566f}.projection-line{fill:none;stroke:#2c67b4;stroke-width:3}.projection-point{fill:#fff;stroke:#2c67b4;stroke-width:2}.forecast-split{stroke:#9aaabd;stroke-width:1;stroke-dasharray:4 4}'; clone.insertBefore(style, clone.firstChild);
  return await new Promise<string>((resolve, reject) => { const image = new Image(); image.onload = () => { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; const context = canvas.getContext('2d'); if (!context) return reject(new Error('Unable to create canvas')); context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height); resolve(canvas.toDataURL('image/png')); }; image.onerror = () => reject(new Error('Unable to render SVG chart')); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`; });
}
async function addChart(doc: jsPDF, snap: ChartSnap, x: number, y: number, w: number, h: number) {
  doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(snap.title, x, y); doc.setTextColor(...COLORS.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.text(`Unit: ${snap.unit}`, x + w, y, { align: 'right' });
  try { const png = await svgToPng(snap.svg, 1120, Math.max(300, Math.round(h * 2.1))); doc.addImage(png, 'PNG', x, y + 7, w, h - 7, undefined, 'FAST'); } catch { doc.setTextColor(...COLORS.muted); doc.setFontSize(8); doc.text('Chart could not be rendered from the captured application state.', x, y + 25); }
}
function splitAi(ai: string) { return ai.split(/\n+/).map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/^[-•*]\s*/, '')); }
function aiSection(doc: jsPDF, ai: string, x: number, y: number, w: number, maxY: number) {
  if (!ai) { doc.setFont('helvetica', 'italic'); doc.setTextColor(...COLORS.muted); doc.setFontSize(8.5); doc.text('Dynatrace Assist did not return an assessment during report generation.', x, y); return y + 18; }
  let yy = y; const lines = splitAi(ai);
  for (const line of lines) {
    const heading = /^(Executive Summary|Key Findings|Capacity Risks|Recommended Actions|30\/60\/90-day planning recommendation|30\/60\/90-day recommendation|Recommended Actions \(P1\/P2\/P3\))/i.test(line);
    if (heading) { yy += 5; doc.setTextColor(...COLORS.blue); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.text(line.replace(/[:#]+$/, ''), x, yy); yy += 14; continue; }
    doc.setTextColor(...COLORS.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); const wrapped = doc.splitTextToSize(line, w); doc.text(wrapped.slice(0, 4), x, yy); yy += wrapped.slice(0, 4).length * 10 + 4; if (yy > maxY) break;
  }
  return yy;
}
function hostRowsSorted(hosts: HostRow[]) { return [...hosts].sort((a, b) => (pct(b.memory) + pct(b.disk) + pct(b.cpu)) - (pct(a.memory) + pct(a.disk) + pct(a.cpu))); }
function deterministicFindings(state: ReportState): string[] {
  const findings: string[] = [];
  if (state.hosts.length) {
    const avgCpu = state.hosts.reduce((s, h) => s + pct(h.cpu), 0) / state.hosts.length;
    const avgMem = state.hosts.reduce((s, h) => s + pct(h.memory), 0) / state.hosts.length;
    const avgDisk = state.hosts.reduce((s, h) => s + pct(h.disk), 0) / state.hosts.length;
    findings.push(`Current estate: ${state.hosts.length} host(s) in the selected scope.`);
    findings.push(`Average utilization: CPU ${avgCpu.toFixed(1)}%, memory ${avgMem.toFixed(1)}%, disk ${avgDisk.toFixed(1)}%.`);
    const high = state.hosts.filter((h) => Math.max(pct(h.cpu), pct(h.memory), pct(h.disk)) >= 80).length;
    if (high) findings.push(`${high} host(s) are currently at or above the 80% planning threshold on CPU, memory or disk.`);
    else findings.push('No host is currently at or above the 80% planning threshold on CPU, memory or disk.');
  }
  if (state.scenario) findings.push(`What-If scenario: +${state.scenario.growth.toFixed(0)}% traffic, from ${state.scenario.currentTraffic.toFixed(1)} req/min to ${state.scenario.scenarioTraffic.toFixed(1)} req/min.`);
  return findings;
}
function recommendationList(state: ReportState): string[] {
  const out: string[] = [];
  const high = hostRowsSorted(state.hosts).slice(0, 5).filter((h) => Math.max(pct(h.cpu), pct(h.memory), pct(h.disk)) >= 70);
  if (high.length) out.push(`Prioritize review of the top ${high.length} utilization host(s) shown in the Host Resource Utilization section.`);
  if (state.scenario) out.push(`Use the +${state.scenario.growth.toFixed(0)}% traffic scenario as a sensitivity case and validate the required infrastructure headroom before workload expansion.`);
  if (state.forecastContext.length) out.push('Use the Dynatrace Intelligence forecast and its prediction interval together with the live utilization trend; avoid relying on a single endpoint value.');
  out.push('Re-run the forecast after material changes to host capacity, workload mix or management-zone scope.');
  return out;
}
async function buildReport(state: ReportState) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true });

  // 1 Executive summary
  addHeader(doc, 'Capacity & Performance Report', 'Production capacity planning snapshot', state);
  let y = 112;
  y = sectionTitle(doc, 'Executive Summary', y, 'Live Dynatrace telemetry, verified application throughput, forecasting and what-if planning.');
  const kpis = state.overviewKpis.slice(0, 8);
  for (let row = 0; row < Math.ceil(kpis.length / 4); row += 1) for (let col = 0; col < 4; col += 1) { const kpi = kpis[row * 4 + col]; if (!kpi) continue; const tone = /critical|risk/i.test(kpi.label) ? COLORS.red : /healthy|verified/i.test(kpi.label) ? COLORS.green : COLORS.blue; drawKpiCard(doc, 38 + col * 130, y + row * 78, 120, 68, kpi, tone); }
  y += Math.ceil(kpis.length / 4) * 78 + 12;
  doc.setFillColor(...COLORS.light); doc.roundedRect(38, y, 519, 102, 6, 6, 'F'); y += 20; doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Key Findings', 52, y); y += 16; doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORS.text); for (const finding of deterministicFindings(state)) { const wrapped = doc.splitTextToSize(`• ${finding}`, 490); doc.text(wrapped.slice(0, 2), 52, y); y += wrapped.slice(0, 2).length * 10 + 3; }
  y += 12; doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('AI Capacity Assessment', 38, y); y += 16; aiSection(doc, state.ai, 38, y, 515, 770);

  // 2 AI detail
  doc.addPage(); addHeader(doc, 'AI Capacity Assessment', 'Dynatrace Assist assessment and planning recommendations', state); y = 112; y = aiSection(doc, state.ai, 38, y, 519, 730); y += 20;
  doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Deterministic planning signals', 38, y); y += 18; for (const line of deterministicFindings(state)) { y = aiSection(doc, line, 48, y, 500, 740) + 3; }
  y += 12; doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text('Recommended actions', 38, y); y += 18; for (const line of recommendationList(state)) { const wrapped = doc.splitTextToSize(`• ${line}`, 500); doc.setTextColor(...COLORS.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(wrapped.slice(0, 3), 48, y); y += wrapped.slice(0, 3).length * 11 + 5; }

  // 3 infrastructure trends
  doc.addPage(); addHeader(doc, 'Infrastructure Utilization Trends', 'Historical CPU, memory and disk telemetry from the selected host scope', state); y = 112;
  for (const title of ['CPU utilization', 'Memory utilization', 'Disk utilization']) { const chart = state.charts.find((c) => c.context === 'history' && c.title.toLowerCase() === title.toLowerCase()); if (!chart) continue; await addChart(doc, chart, 48, y, 499, 145); y += 165; }
  doc.setTextColor(...COLORS.muted); doc.setFontSize(7.5); doc.text('Planning reference: 80% utilization threshold is used for capacity-risk screening in the application.', 48, 625);

  // 4 Application/network
  doc.addPage(); addHeader(doc, 'Application & Network Performance', 'Application throughput and NIC-level network telemetry', state); y = 112;
  for (const title of ['Application throughput', 'Network RX', 'Network TX']) { const chart = state.charts.find((c) => c.context === 'history' && c.title.toLowerCase() === title.toLowerCase()); if (!chart) continue; await addChart(doc, chart, 48, y, 499, 150); y += 170; }
  if (!state.charts.some((c) => ['Application throughput', 'Network RX', 'Network TX'].includes(c.title))) { doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(...COLORS.muted); doc.text('No application/network chart was available in the captured state.', 48, y); }

  // 5 Forecast
  doc.addPage(); addHeader(doc, 'Dynatrace Intelligence Forecast', `Forecast horizon: ${state.horizon}`, state); y = 112;
  const forecastChart = state.charts.find((c) => c.context === 'forecast');
  if (forecastChart) { await addChart(doc, forecastChart, 48, y, 499, 290); y += 320; }
  else { doc.setFillColor(...COLORS.light); doc.roundedRect(48, y, 499, 70, 6, 6, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...COLORS.navy); doc.text('Forecast unavailable', 64, y + 23); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORS.muted); doc.text('Dynatrace Intelligence did not return a renderable forecast during report capture.', 64, y + 40); y += 90; }
  if (state.forecastContext.length) { y = sectionTitle(doc, 'Forecast Context', y, undefined); for (const line of state.forecastContext) { const wrapped = doc.splitTextToSize(`• ${line}`, 490); doc.setTextColor(...COLORS.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.text(wrapped.slice(0, 3), 52, y); y += wrapped.slice(0, 3).length * 10 + 4; } }

  // 6 Host inventory
  doc.addPage(); addHeader(doc, 'Host Resource Utilization', 'Current host-level utilization and capacity status', state); y = 112;
  const hostRows = hostRowsSorted(state.hosts).slice(0, 40).map((h) => [h.host, h.environment, h.application, h.cpu, h.memory, h.disk, h.throughput, h.status]);
  if (hostRows.length) drawTable(doc, 28, y, [150, 62, 94, 45, 55, 45, 70, 60], ['Host', 'Env.', 'Application', 'CPU', 'Memory', 'Disk', 'Throughput', 'Status'], hostRows, 18);
  else { doc.setFont('helvetica', 'italic'); doc.setTextColor(...COLORS.muted); doc.text('No host inventory rows were available in the captured state.', 48, y); }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...COLORS.muted); doc.text(`Showing ${Math.min(40, state.hosts.length)} of ${state.hosts.length} host(s). Rows are ordered by combined CPU, memory and disk utilization.`, 28, 770);

  // 7 Host risk outlook / methodology
  doc.addPage(); addHeader(doc, 'Capacity Outlook & Host Prioritization', 'Operational view of where capacity review should begin', state); y = 112;
  const riskRows = hostRowsSorted(state.hosts).slice(0, 15).map((h) => [h.host, h.cpu, h.memory, h.disk, h.status]);
  y = sectionTitle(doc, 'Top Hosts for Capacity Review', y, 'Current values only; per-host future forecasts are not fabricated when the application does not expose them.');
  if (riskRows.length) y = drawTable(doc, 38, y, [235, 70, 80, 70, 80], ['Host', 'CPU', 'Memory', 'Disk', 'Status'], riskRows, 19) + 14;
  doc.setFillColor(...COLORS.light); doc.roundedRect(38, y, 519, 120, 6, 6, 'F'); y += 20; doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Data quality & limitations', 52, y); y += 17; const notes = ['Live host/resource metrics come from the Dynatrace DQL provider used by the application.', 'Application traffic is independently verified from request-root spans when the verification query succeeds.', 'Dynatrace Intelligence forecast values are reproduced only when the analyzer returns a usable prediction.', 'Host-level future forecasts and problem correlation are intentionally not invented when those datasets are not exposed by the current application path.']; for (const note of notes) { const wrapped = doc.splitTextToSize(`• ${note}`, 485); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...COLORS.text); doc.text(wrapped.slice(0, 3), 52, y); y += wrapped.slice(0, 3).length * 10 + 3; }

  // 8 What-if and trajectory
  doc.addPage(); addHeader(doc, 'What-If Traffic & Resource Capacity', 'Scenario-based sensitivity analysis using the application simulation model', state); y = 112;
  if (state.scenario) {
    const s = state.scenario; const trafficRows = [0, 30, 60, 90].map((day) => { const traffic = s.currentTraffic + (s.scenarioTraffic - s.currentTraffic) * (day / 90); return [day === 0 ? 'Now' : `${day} days`, `${traffic.toFixed(1)} req/min`]; });
    y = sectionTitle(doc, 'Traffic Simulation Trajectory', y, `Scenario: +${s.growth.toFixed(0)}% traffic · ${s.currentTraffic.toFixed(1)} → ${s.scenarioTraffic.toFixed(1)} req/min at 90 days`);
    y = drawTable(doc, 38, y, [120, 150], ['Horizon', 'Scenario throughput'], trafficRows, 19) + 20;
    const points = trafficRows.map((row) => ({ label: row[0], value: Number(row[1].replace(/[^0-9.]/g, '')) }));
    // Inline trajectory chart
    const cx = 230, cy = y + 5, cw = 320, ch = 125; doc.setDrawColor(...COLORS.border); for (let i = 0; i <= 4; i++) doc.line(cx, cy + i * ch / 4, cx + cw, cy + i * ch / 4); const max = Math.max(...points.map((p) => p.value), 1), min = Math.min(...points.map((p) => p.value), 0), range = Math.max(1, max - min); const coords = points.map((p, i) => [cx + i * cw / (points.length - 1), cy + ch - ((p.value - min) / range) * ch] as const); doc.setDrawColor(...COLORS.blue); doc.setLineWidth(2.2); coords.forEach((p, i) => { if (i) doc.line(coords[i - 1][0], coords[i - 1][1], p[0], p[1]); doc.setFillColor(...COLORS.white); doc.circle(p[0], p[1], 3.2, 'FD'); doc.setFontSize(7); doc.setTextColor(...COLORS.text); doc.text(`${points[i].value.toFixed(0)}`, p[0], p[1] - 8, { align: 'center' }); doc.text(points[i].label, p[0], cy + ch + 13, { align: 'center' }); }); doc.setLineWidth(0.2); y = cy + ch + 40;
    y = sectionTitle(doc, '30 / 60 / 90-Day Resource Outlook', y, 'Projection values reproduced from the rendered simulation state.');
    const allDays = [...new Set(s.projections.flatMap((p) => p.values.map((v) => v.day)))].sort((a, b) => a - b); const resourceRows = allDays.map((day) => { const valueFor = (name: string) => s.projections.find((p) => p.name.toLowerCase().includes(name))?.values.find((v) => v.day === day)?.value; return [day === 0 ? 'Now' : `${day} days`, valueFor('cpu') !== undefined ? `${valueFor('cpu')!.toFixed(1)}%` : '—', valueFor('memory') !== undefined ? `${valueFor('memory')!.toFixed(1)}%` : '—', valueFor('disk') !== undefined ? `${valueFor('disk')!.toFixed(1)}%` : '—']; });
    if (resourceRows.length) y = drawTable(doc, 38, y, [120, 120, 120, 120], ['Horizon', 'CPU', 'Memory', 'Disk'], resourceRows, 19) + 18;
    y = sectionTitle(doc, 'Projection Quality', y, undefined); for (const p of s.projections) { doc.setTextColor(...COLORS.text); doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.text(`${p.name}: R² ${p.r2} · ${p.samples} aligned samples · ${p.confidence}`, 48, y); y += 13; }
  } else { doc.setTextColor(...COLORS.muted); doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.text('No simulation state was available at report generation time.', 48, y); }

  // 9 Current vs scenario comparison
  doc.addPage(); addHeader(doc, 'What-If Capacity Comparison', 'Current baseline versus scenario values', state); y = 112;
  if (state.scenario) {
    const at90 = (name: string) => state.scenario?.projections.find((p) => p.name.toLowerCase().includes(name))?.values.find((v) => v.day === 90)?.value ?? null;
    const now = (name: string) => state.scenario?.projections.find((p) => p.name.toLowerCase().includes(name))?.values.find((v) => v.day === 0)?.value ?? null;
    const rows = ['cpu', 'memory', 'disk'].map((key) => { const base = now(key), projected = at90(key); return [key.toUpperCase(), base === null ? '—' : `${base.toFixed(1)}%`, projected === null ? '—' : `${projected.toFixed(1)}%`, base === null || projected === null ? '—' : `${(projected - base >= 0 ? '+' : '')}${(projected - base).toFixed(1)} pp`]; });
    y = sectionTitle(doc, 'Current vs 90-Day Scenario', y, `Traffic scenario: +${state.scenario.growth.toFixed(0)}% · projected workload ${state.scenario.scenarioTraffic.toFixed(1)} req/min`); y = drawTable(doc, 38, y, [110, 125, 125, 125], ['Metric', 'Current', '90-Day Scenario', 'Delta'], rows, 21) + 25;
    doc.setFillColor(...COLORS.blueSoft); doc.roundedRect(38, y, 519, 96, 6, 6, 'F'); y += 21; doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Capacity interpretation', 52, y); y += 17; const max = Math.max(...rows.map((r) => numberFrom(r[2]) ?? 0)); const interpretation = max >= 80 ? 'The 90-day scenario reaches or exceeds the 80% planning threshold on at least one resource. Capacity action should be reviewed before the scenario materializes.' : 'The 90-day scenario remains below the 80% planning threshold across the modeled resources. Continue monitoring the trend and revisit after material workload changes.'; const wrap = doc.splitTextToSize(interpretation, 480); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.text); doc.setFontSize(8.5); doc.text(wrap.slice(0, 4), 52, y); }

  // Final page - methodology
  doc.addPage(); addHeader(doc, 'Report Methodology & Data Provenance', 'What is measured, what is forecast, and what is intentionally not fabricated', state); y = 112;
  y = sectionTitle(doc, 'Data Sources', y); const methods = [
    ['Live host telemetry', 'Dynatrace Grail / DQL host entity and metric queries used by Axis Davis Capacity Planner.'],
    ['Application throughput', 'Request-root span verification over a 5-minute window when available in the application state.'],
    ['Capacity forecast', 'Dynatrace Intelligence Generic Forecast Analyzer output for the selected metric and horizon.'],
    ['What-If simulation', 'The application simulation model using the selected traffic-growth and capacity assumptions.'],
    ['AI assessment', 'Dynatrace Assist response generated from the live telemetry and forecast context supplied by the application.'],
  ]; y = drawTable(doc, 38, y, [150, 369], ['Dataset', 'Production report source'], methods, 25) + 25;
  y = sectionTitle(doc, 'Known Limitations', y); const limitations = ['Problem history / incident correlation is not currently part of the production data path, so the report does not invent problem counts or root-cause correlations.', 'Per-host future forecasts are not presented unless the application returns host-level forecast data. Scope-level forecast values are kept separate from current host values.', 'When Dynatrace returns no forecast result, the report calls that out explicitly instead of presenting a synthetic line.']; for (const item of limitations) { const lines = doc.splitTextToSize(`• ${item}`, 490); doc.setTextColor(...COLORS.text); doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.text(lines.slice(0, 4), 48, y); y += lines.slice(0, 4).length * 11 + 5; }
  y += 18; doc.setFillColor(...COLORS.light); doc.roundedRect(38, y, 519, 78, 6, 6, 'F'); doc.setTextColor(...COLORS.navy); doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('Production-readiness rule', 52, y + 21); doc.setFont('helvetica', 'normal'); doc.setTextColor(...COLORS.text); doc.setFontSize(8.5); const rule = doc.splitTextToSize('Every numeric statement in this report must come from live application state, the Dynatrace analyzer response, or a calculation explicitly derived from those values. Unknown data is shown as unavailable instead of guessed.', 485); doc.text(rule, 52, y + 39);

  const total = doc.getNumberOfPages(); for (let page = 1; page <= total; page += 1) { doc.setPage(page); addFooter(doc, page, total); }
  doc.save(`axis-capacity-performance-report-${new Date().toISOString().slice(0, 10)}.pdf`);
}

export function installProductionPdfV4() {
  const scope = window as Window & { __axisProductionPdfV6?: boolean };
  if (scope.__axisProductionPdfV6) return;
  scope.__axisProductionPdfV6 = true;
  document.addEventListener('click', async (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.pdf-report-button') : null;
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    button.disabled = true;
    const previous = button.innerText;
    button.innerText = 'Preparing production report…';
    try { const state = await collect(); await buildReport(state); }
    catch (error) { console.error('Production PDF V6', error); alert(`Production PDF generation failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { button.disabled = false; button.innerText = previous; }
  }, true);
}
