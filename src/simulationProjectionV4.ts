import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type AnyRecord = Record<string, unknown>;
type Model = { slope: number; intercept: number; r2: number; current: number; samples: number; fallback: boolean };
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function scalar(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const n = Number(v); return Number.isFinite(n) ? n : null; }
  if (v && typeof v === 'object') { const o = v as AnyRecord; for (const key of ['value', 'double', 'number']) { const n = scalar(o[key]); if (n !== null) return n; } }
  return null;
}
function series(v: unknown): Array<number | null> {
  if (Array.isArray(v)) return v.map((item) => scalar(item));
  if (v && typeof v === 'object') { const o = v as AnyRecord; return series(o.values ?? o.data ?? o.value); }
  const n = scalar(v); return n === null ? [] : [n];
}
function validPercent(v: number | null): number | null { return v !== null && Number.isFinite(v) && v >= 0 && v <= 100 ? v : null; }
function hostKey(v: unknown): string {
  if (Array.isArray(v)) return hostKey(v[0]);
  if (v && typeof v === 'object') { const o = v as AnyRecord; return hostKey(o.value ?? o.id ?? o.data ?? o.values); }
  return String(v ?? '').trim();
}
function timestamp(v: unknown): number | null {
  if (v instanceof Date) return Number.isFinite(v.getTime()) ? v.getTime() : null;
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') { const n = Date.parse(v); return Number.isFinite(n) ? n : null; }
  if (v && typeof v === 'object') { const o = v as AnyRecord; return timestamp(o.value ?? o.start ?? o.from); }
  return null;
}
function intervalMs(record: AnyRecord): number {
  const raw = record.interval;
  if (typeof raw === 'number') return raw > 100000 ? raw / 1e6 : raw * 1000;
  if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw) / 1e6;
  if (typeof raw === 'string') { const m = raw.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i); if (m) return Number(m[1]) * ({ ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 }[m[2].toLowerCase()] ?? 3600000); }
  return 3600000;
}
function timeframeStart(record: AnyRecord): number | null {
  const tf = record.timeframe;
  if (tf && typeof tf === 'object') { const o = tf as AnyRecord; return timestamp(o.start ?? o.from ?? o.begin); }
  return timestamp(record.start ?? record.from ?? record.startTime);
}
function pointSeries(record: AnyRecord, value: unknown) {
  const values = series(value), start = timeframeStart(record); if (start === null) return [] as Array<{ ts: number; value: number }>;
  const step = intervalMs(record); return values.flatMap((v, index) => v === null ? [] : [{ ts: start + index * step, value: v }]);
}
async function dql(query: string): Promise<AnyRecord[]> {
  try {
    const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 } });
    let result = response.result as { records?: AnyRecord[] } | undefined, token = response.requestToken, state = response.state;
    for (let attempt = 0; !result && token && attempt < 30; attempt += 1) { const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 }); state = poll.state; result = poll.result as { records?: AnyRecord[] } | undefined; if (!result && state === 'RUNNING') await sleep(300); }
    if (!result) throw new Error(`Simulation DQL did not complete (state: ${state}).`);
    return (result.records ?? []).filter(Boolean);
  } catch (error) { console.error('[DYNATRACE][simulation DQL]', { query, error }); throw error; }
}
function zone(): string { const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find((element) => /management zone/i.test(element.previousElementSibling?.textContent || '')); return select?.value || 'All Management Zones'; }
function traffic(panel: HTMLElement) { const text = panel.innerText.replace(/,/g, ''); return { current: Number(text.match(/Current traffic[^0-9]*([0-9.]+)\s*req\/min/i)?.[1] || 0), simulated: Number(text.match(/Simulated traffic[^0-9]*([0-9.]+)\s*req\/min/i)?.[1] || 0) }; }
function fit(xs: number[], ys: number[], current: number): Model {
  const pairs = xs.map((x, i) => [x, ys[i]] as const).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 8) return { slope: 0, intercept: 0, r2: 0, current, samples: pairs.length, fallback: true };
  const mx = pairs.reduce((s, [x]) => s + x, 0) / pairs.length, my = pairs.reduce((s, [, y]) => s + y, 0) / pairs.length;
  const denominator = pairs.reduce((s, [x]) => s + (x - mx) ** 2, 0); if (!denominator) return { slope: 0, intercept: 0, r2: 0, current, samples: pairs.length, fallback: true };
  const slope = pairs.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0) / denominator, intercept = my - slope * mx;
  const total = pairs.reduce((s, [, y]) => s + (y - my) ** 2, 0), residual = pairs.reduce((s, [x, y]) => s + (y - (intercept + slope * x)) ** 2, 0);
  return { slope, intercept, r2: total ? Math.max(0, 1 - residual / total) : 0, current, samples: pairs.length, fallback: false };
}
function alignedPairs(resourceRecord: AnyRecord, resource: unknown, trafficRecord: AnyRecord, trafficSeries: unknown): Array<[number, number]> {
  const r = series(resource).map(validPercent), t = series(trafficSeries).map((v) => v === null ? null : v / 60), direct: Array<[number, number]> = [];
  for (let i = 0; i < Math.min(r.length, t.length); i += 1) { const x = t[i], y = r[i]; if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) direct.push([x, y]); }
  if (direct.length >= 8) return direct;
  const rp = pointSeries(resourceRecord, r), tp = pointSeries(trafficRecord, trafficSeries).map((p) => ({ ...p, value: p.value / 60 })), out: Array<[number, number]> = [];
  const tolerance = Math.max(intervalMs(resourceRecord), intervalMs(trafficRecord)) / 2;
  for (const a of rp) { let best: { ts: number; value: number } | undefined, distance = Infinity; for (const b of tp) { const delta = Math.abs(a.ts - b.ts); if (delta <= tolerance && delta < distance) { best = b; distance = delta; } } if (best) out.push([best.value, a.value]); }
  return out;
}
function memorySeries(record: AnyRecord): Array<number | null> {
  const used = series(record.memory).map(validPercent);
  const available = series(record.memoryAvailable).map(validPercent);
  const length = Math.max(used.length, available.length);
  return Array.from({ length }, (_, i) => used[i] ?? (available[i] === null || available[i] === undefined ? null : 100 - available[i]));
}
function render(panel: HTMLElement, models: Record<'cpu' | 'memory' | 'disk', Model>, current: number, simulated: number, growth: number) {
  panel.querySelector('.simulation-scenario-detail-v4')?.remove();
  const target = simulated || current * (1 + growth / 100), days = [0, 20, 60, 90], trafficAt = (day: number) => current + (target - current) * day / 90;
  const predict = (model: Model, day: number) => { const trafficValue = trafficAt(day); const value = !model.fallback && model.r2 >= 0.25 ? model.slope * trafficValue + model.intercept : model.current * (trafficValue / Math.max(1, current)); return Math.max(0, Math.min(100, value)); };
  const rows = days.map((day) => ({ day, traffic: trafficAt(day), cpu: predict(models.cpu, day), memory: predict(models.memory, day), disk: predict(models.disk, day) })), f = (v: number) => v.toFixed(1);
  const section = document.createElement('section'); section.className = 'simulation-scenario-detail simulation-scenario-detail-v4';
  section.innerHTML = `<div class="projection-header"><span class="eyebrow">Traffic what-if capacity model</span><h2>${growth >= 0 ? '+' : ''}${f(growth)}% traffic scenario</h2><p>CPU, memory and disk use live 30-day Dynatrace observations. Memory uses the host memory-used metric and falls back to 100% minus memory-available when required.</p></div><div class="scenario-assumptions"><div><small>Current traffic</small><strong>${f(current)} req/min</strong></div><div><small>Traffic change</small><strong>${growth >= 0 ? '+' : ''}${f(growth)}%</strong></div><div><small>Scenario traffic at 90d</small><strong>${f(target)} req/min</strong></div><div><small>Forecast checkpoints</small><strong>20 / 60 / 90 days</strong></div></div><div class="scenario-table"><table><thead><tr><th>Horizon</th><th>Traffic</th><th>CPU</th><th>Memory</th><th>Disk</th></tr></thead><tbody>${rows.slice(1).map((row) => `<tr><td>${row.day} days</td><td>${f(row.traffic)} req/min</td><td>${f(row.cpu)}%</td><td>${f(row.memory)}%</td><td>${f(row.disk)}%</td></tr>`).join('')}</tbody></table></div><div class="projection-grid">${(['cpu', 'memory', 'disk'] as const).map((key) => { const name = key === 'cpu' ? 'CPU utilization' : key === 'memory' ? 'Memory utilization' : 'Disk utilization', model = models[key]; return `<div class="projection-card"><div class="chart-title-row"><strong>${name}</strong><span>Unit: % · ${growth >= 0 ? '+' : ''}${f(growth)}% traffic scenario</span></div><svg class="projection-svg" viewBox="0 0 860 320" role="img" aria-label="${name} traffic scenario trend"><line x1="88" x2="832" y1="270" y2="270" class="chart-grid"/><line x1="88" x2="832" y1="220" y2="220" class="chart-grid"/><line x1="88" x2="832" y1="170" y2="170" class="chart-grid"/><line x1="88" x2="832" y1="120" y2="120" class="chart-grid"/><line x1="88" x2="832" y1="70" y2="70" class="chart-grid"/><text x="12" y="274" class="chart-axis-label">0%</text><text x="12" y="224" class="chart-axis-label">25%</text><text x="12" y="174" class="chart-axis-label">50%</text><text x="12" y="124" class="chart-axis-label">75%</text><text x="12" y="74" class="chart-axis-label">100%</text><line x1="88" x2="832" y1="110" y2="110" class="threshold-line"/><polyline points="${rows.map((row, i) => `${88 + i * 248},${270 - row[key] * 2}`).join(' ')}" class="projection-line"/>${rows.map((row, i) => `<circle cx="${88 + i * 248}" cy="${270 - row[key] * 2}" r="6" class="projection-point" data-day="${row.day}" data-value="${f(row[key])}"/><text x="${76 + i * 248}" y="${Math.max(22, 265 - row[key] * 2)}" class="projection-label">${f(row[key])}%</text>`).join('')}<text x="88" y="292" class="chart-axis-label">Now</text><text x="320" y="292" class="chart-axis-label">20d</text><text x="568" y="292" class="chart-axis-label">60d</text><text x="812" y="292" class="chart-axis-label">90d</text><text x="360" y="315" class="chart-axis-title">Days from now</text></svg><div class="projection-meta"><span>R²: <strong>${model.r2.toFixed(2)}</strong></span><span>Aligned samples: <strong>${model.samples}</strong></span><span>${model.fallback ? 'Low confidence · proportional fallback' : model.r2 >= .7 ? 'High confidence' : model.r2 >= .4 ? 'Moderate confidence' : 'Low confidence'}</span></div></div>`; }).join('')}</div>`;
  panel.appendChild(section);
}
async function load(panel: HTMLElement) {
  if (panel.dataset.simV4 === 'loading' || panel.dataset.simV4 === 'done') return;
  const { current, simulated } = traffic(panel); if (!current) return; panel.dataset.simV4 = 'loading'; const growth = simulated ? ((simulated / current) - 1) * 100 : 0;
  try {
    const selectedZone = zone(), safeZone = selectedZone.replace(/\\/g, '\\\\').replace(/"/g, '\\"'), zoneFilter = selectedZone !== 'All Management Zones' ? `| expand managementZones | filter managementZones == "${safeZone}"` : '';
    const hosts = await dql(`fetch dt.entity.host ${zoneFilter} | fields id | dedup id`), ids = hosts.map((record) => hostKey(record.id)).filter(Boolean); if (!ids.length) throw new Error('No hosts in selected scope');
    const list = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');
    const [resources, requestSeries] = await Promise.all([
      dql(`timeseries cpu=avg(dt.host.cpu.usage), memory=avg(dt.host.memory.usage), memoryAvailable=avg(dt.host.memory.avail.percent), disk=avg(dt.host.disk.used.percent), by:{dt.entity.host}, interval:1h, from:-30d, to:now() | filter in(dt.entity.host, ${list})`),
      dql(`fetch spans, from:now()-30d, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) | filter in(dt.entity.host, ${list}) | makeTimeseries requests=count(), by:{dt.entity.host}, interval:1h`),
    ]);
    const trafficByHost = new Map<string, AnyRecord>(); requestSeries.forEach((record) => trafficByHost.set(hostKey(record['dt.entity.host']), record));
    const models: Record<'cpu' | 'memory' | 'disk', Model> = { cpu: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0, fallback: true }, memory: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0, fallback: true }, disk: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0, fallback: true } };
    for (const key of ['cpu', 'memory', 'disk'] as const) {
      const xs: number[] = [], ys: number[] = [];
      resources.forEach((record) => {
        const trafficRecord = trafficByHost.get(hostKey(record['dt.entity.host'])); if (!trafficRecord) return;
        const resourceValues = key === 'memory' ? memorySeries(record) : series(record[key]).map(validPercent);
        const lastResource = [...resourceValues].reverse().find((v) => v !== null && Number.isFinite(v));
        const pairs = alignedPairs(record, resourceValues, trafficRecord, trafficRecord.requests);
        pairs.forEach(([x, y]) => { if (Number.isFinite(x) && Number.isFinite(y) && y >= 0 && y <= 100) { xs.push(x); ys.push(y); } });
        if (lastResource !== undefined && lastResource !== null && Number.isFinite(lastResource)) models[key].current += Number(lastResource);
      });
      const hostCount = resources.filter((record) => trafficByHost.has(hostKey(record['dt.entity.host']))).length; if (hostCount) models[key].current /= hostCount;
      models[key] = fit(xs, ys, models[key].current);
    }
    render(panel, models, current, simulated, growth); panel.dataset.simV4 = 'done';
  } catch (error) { console.error('Simulation V4', error); panel.dataset.simV4 = 'error'; const warning = document.createElement('div'); warning.className = 'simulation-data-warning'; warning.textContent = 'Live resource observations could not be aligned for this scope. No fabricated trend is shown.'; panel.appendChild(warning); }
}
export function installSimulationProjectionV4() {
  const win = window as Window & { __axisSimV4?: boolean }; if (win.__axisSimV4) return; win.__axisSimV4 = true;
  const check = () => { const panel = document.querySelector<HTMLElement>('.simulation-enhanced'); if (panel && !panel.querySelector('.projection-grid')) void load(panel); };
  const observer = new MutationObserver(() => setTimeout(check, 250)); observer.observe(document.body, { subtree: true, childList: true });
  document.addEventListener('change', () => setTimeout(() => { const panel = document.querySelector<HTMLElement>('.simulation-enhanced'); if (panel) { panel.dataset.simV4 = ''; panel.querySelector('.simulation-scenario-detail-v4')?.remove(); void load(panel); } }, 300));
  check();
}
