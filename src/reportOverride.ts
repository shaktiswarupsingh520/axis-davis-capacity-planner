type ChartInfo = { title: string; svg: SVGSVGElement };

const esc = (value: string) => value.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function pdfText(page: string[], x: number, y: number, value: string, size = 10, bold = false) {
  page.push(`0 0 0 rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y} Td (${esc(value)}) Tj ET`);
}
function pdfLine(page: string[], x1: number, y1: number, x2: number, y2: number, color = '0.72 0.77 0.84 RG', width = 1) {
  page.push(`${color} ${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
}
function polylineToPdf(svg: SVGSVGElement, page: string[], points: string, box: { x: number; y: number; w: number; h: number }, color: string, fill = false) {
  const viewBox = svg.viewBox.baseVal;
  const source = points.trim().split(/\s+/).map((pair) => pair.split(',').map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (source.length < 2) return;
  const mapped = source.map(([sx, sy]) => [box.x + (sx / Math.max(1, viewBox.width)) * box.w, box.y + box.h - (sy / Math.max(1, viewBox.height)) * box.h] as const);
  const path = mapped.map(([x, y], index) => `${x.toFixed(2)} ${y.toFixed(2)} ${index ? 'l' : 'm'}`).join(' ');
  if (fill) page.push(`${color} rg ${path} h f`); else page.push(`${color} RG 1.7 w ${path} S`);
}
function chartToPdf(chart: ChartInfo, page: string[], x: number, y: number, w: number, h: number) {
  const title = chart.title || 'Trend';
  pdfText(page, x, y + h + 22, title, 12, true);
  const box = { x, y, w, h };
  pdfLine(page, x, y, x + w, y, '0.65 0.70 0.78 RG', 1);
  pdfLine(page, x, y, x, y + h, '0.65 0.70 0.78 RG', 1);
  [0, 25, 50, 75, 100].forEach((tick) => {
    const yy = y + h * tick / 100;
    pdfLine(page, x, yy, x + w, yy, '0.88 0.90 0.94 RG', .6);
    pdfText(page, x - 34, yy - 3, `${Math.round(tick)}`, 7);
  });
  const lines = [...chart.svg.querySelectorAll('polyline')];
  for (const element of lines) {
    const classes = element.getAttribute('class') ?? '';
    const points = element.getAttribute('points') ?? '';
    if (classes.includes('actual')) polylineToPdf(chart.svg, page, points, box, '0.12 0.43 0.95');
    else if (classes.includes('forecast')) polylineToPdf(chart.svg, page, points, box, '0.92 0.43 0.12');
    else if (classes.includes('upper')) polylineToPdf(chart.svg, page, points, box, '0.82 0.58 0.14');
  }
  const band = chart.svg.querySelector('.forecast-band');
  if (band) polylineToPdf(chart.svg, page, band.getAttribute('points') ?? '', box, '0.94 0.76 0.28', true);
  const split = chart.svg.querySelector('.forecast-split');
  if (split) { const x1 = Number(split.getAttribute('x1') ?? 0); const sx = box.x + x1 / Math.max(1, chart.svg.viewBox.baseVal.width) * box.w; pdfLine(page, sx, y, sx, y + h, '0.50 0.58 0.68 RG', .8); }
  pdfText(page, x, y - 16, 'Start', 8); pdfText(page, x + w / 2 - 12, y - 16, 'Midpoint', 8); pdfText(page, x + w - 22, y - 16, 'Now', 8); pdfText(page, x + w / 2 - 14, y - 30, 'Time', 8);
  pdfText(page, x - 14, y + h + 7, 'Value', 8);
  pdfText(page, x + 8, y + h - 10, 'Historical', 8); if (chart.svg.querySelector('.chart-line.forecast')) pdfText(page, x + 92, y + h - 10, 'Dynatrace forecast', 8); if (chart.svg.querySelector('.forecast-band')) pdfText(page, x + 222, y + h - 10, '90% prediction band', 8);
}
function collectTextCards() { return [...document.querySelectorAll('.metric-card')].slice(0, 8).map((element) => element.innerText.replace(/\n+/g, ' · ').trim()).filter(Boolean); }
function collectCharts(): ChartInfo[] { return [...document.querySelectorAll('.chart-wrap svg')].map((svg) => { const title = svg.parentElement?.querySelector('.chart-title-row strong')?.textContent?.trim() || svg.parentElement?.parentElement?.querySelector('h2')?.textContent?.trim() || 'Trend'; return { title, svg: svg as SVGSVGElement }; }); }
function collectPageState() { return { title: document.querySelector('.page-title h1')?.textContent?.trim() || 'Capacity Planner', eyebrow: document.querySelector('.page-title .eyebrow')?.textContent?.trim() || '', cards: collectTextCards(), charts: collectCharts(), ai: document.querySelector('.ai-summary')?.textContent?.trim() || '', verification: document.querySelector('.status-panel')?.textContent?.trim() || '' }; }

function buildReport(pagesData: ReturnType<typeof collectPageState>[]) {
  const pages: string[][] = [];
  const makePage = (title: string, subtitle: string) => { const page: string[] = []; pdfText(page, 40, 750, 'AXIS BANK  |  ApMoSys TECHNOLOGIES', 11, true); pdfText(page, 40, 726, title, 17, true); pdfText(page, 40, 710, subtitle, 9); pdfText(page, 40, 692, 'Developer: Shaktiswarup Pahantasingh', 8); return page; };
  const executive = pagesData[0] ?? collectPageState();
  let page = makePage('Executive Capacity Report', `${executive.title} · generated ${new Date().toLocaleString()}`);
  let y = 660;
  executive.cards.slice(0, 6).forEach((card) => { pdfText(page, 40, y, card, 9); y -= 18; });
  if (executive.verification) { y -= 8; pdfText(page, 40, y, 'Throughput verification', 11, true); y -= 18; executive.verification.replace(/\n+/g, ' · ').slice(0, 220).split(' · ').slice(0, 5).forEach((line) => { pdfText(page, 40, y, line, 8); y -= 14; }); }
  if (executive.charts[0]) chartToPdf(executive.charts[0], page, 55, 280, 500, 250); pages.push(page);

  const trendPage = pagesData.find((data) => data.charts.length > 0 && data !== executive) ?? executive;
  page = makePage('Trend Analysis', `${trendPage.eyebrow || trendPage.title} · explicit units and time labels`);
  const charts = trendPage.charts.slice(0, 2); if (charts[0]) chartToPdf(charts[0], page, 55, 390, 500, 240); if (charts[1]) chartToPdf(charts[1], page, 55, 90, 500, 220); if (!charts.length) pdfText(page, 55, 600, 'No trend chart was available on the selected screen.', 10); pages.push(page);

  const forecastPage = pagesData.find((data) => data.charts.some((chart) => chart.svg.querySelector('.chart-line.forecast')));
  page = makePage('Forecast and Recommendations', forecastPage ? `${forecastPage.title} · Dynatrace forecast with prediction band` : 'Forecast not yet returned');
  if (forecastPage?.charts.length) chartToPdf(forecastPage.charts[0], page, 55, 400, 500, 225); else pdfText(page, 55, 620, 'No usable forecast points were returned. Run the Dynatrace Intelligence forecast before generating the report.', 10);
  const ai = forecastPage?.ai || executive.ai; if (ai) { pdfText(page, 55, 370, 'AI-assisted recommendations', 11, true); ai.split(/\n+/).filter(Boolean).slice(0, 14).forEach((line, index) => pdfText(page, 55, 350 - index * 15, line.slice(0, 105), 8)); }
  pages.push(page);

  const objects: string[] = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>'];
  pages.forEach((content, index) => { const pageNo = 3 + index * 2; const contentNo = pageNo + 1; const stream = content.join('\n'); objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R /F2 10 0 R >> >> /Contents ${contentNo} 0 R >>`); objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`); });
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  let output = '%PDF-1.4\n'; const offsets: number[] = [0]; objects.forEach((object, index) => { offsets.push(output.length); output += `${index + 1} 0 obj\n${object}\nendobj\n`; }); const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([output], { type: 'application/pdf' })); anchor.download = 'axis-capacity-planner-executive-report.pdf'; anchor.click(); setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function installPdfReportOverride() {
  document.addEventListener('click', async (event) => { const target = event.target instanceof Element ? event.target.closest('.pdf-report-button') : null; if (!target) return; event.preventDefault(); event.stopPropagation(); if ('stopImmediatePropagation' in event) event.stopImmediatePropagation(); const active = document.querySelector('.nav-item.active'); const pageButtons = [...document.querySelectorAll<HTMLButtonElement>('.nav-item')]; const snapshots: ReturnType<typeof collectPageState>[] = [collectPageState()]; const relevant = pageButtons.filter((button) => ['Overview', 'Capacity Forecast', 'Simulation'].includes(button.innerText.trim()) && button !== active); for (const button of relevant) { button.click(); await sleep(450); snapshots.push(collectPageState()); } (active as HTMLButtonElement | null)?.click(); await sleep(150); buildReport(snapshots); }, true);
}
