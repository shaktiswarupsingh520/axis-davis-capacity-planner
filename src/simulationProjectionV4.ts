import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type AnyRecord = Record<string, unknown>;
type Model = { slope: number; intercept: number; r2: number; current: number; samples: number };
type Point = { ts: number; value: number };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const series = (v: unknown): number[] =>
  Array.isArray(v)
    ? v.map((item: unknown) => num(item))
    : v && typeof v === 'object' && 'values' in v
      ? series((v as { values?: unknown }).values)
      : [];

function timestamp(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000;
  if (typeof v === 'string') {
    const n = Date.parse(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function intervalMs(record: AnyRecord): number {
  const raw = record.interval;
  if (typeof raw === 'number') return raw < 100000 ? raw * 1000 : raw;
  if (typeof raw === 'string') {
    const match = raw.match(/^(\d+)\s*(ms|s|m|h|d)$/i);
    if (match) {
      const value = Number(match[1]);
      const unit = match[2].toLowerCase();
      return unit === 'ms' ? value : unit === 's' ? value * 1000 : unit === 'm' ? value * 60000 : unit === 'h' ? value * 3600000 : value * 86400000;
    }
  }
  return 3600000;
}

function timeframeStart(record: AnyRecord): number | null {
  const tf = record.timeframe;
  if (tf && typeof tf === 'object') {
    const obj = tf as AnyRecord;
    return timestamp(obj.from ?? obj.start ?? obj.begin);
  }
  if (Array.isArray(tf) && tf.length) return timestamp(tf[0]);
  return timestamp(record.from ?? record.startTime ?? record.start);
}

/** Convert a Dynatrace timeseries field into timestamped points.
 * The timestamp is derived from the returned timeframe + interval, never from
 * array position alone. This lets CPU/memory/disk and traffic be joined safely.
 */
function points(record: AnyRecord, value: unknown): Point[] {
  const values = series(value);
  if (!values.length) return [];
  const start = timeframeStart(record);
  if (start == null) return [];
  const step = intervalMs(record);
  return values.map((value, index) => ({ ts: start + index * step, value })).filter((point) => Number.isFinite(point.value));
}

async function dql(query: string): Promise<AnyRecord[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 5000 },
  });
  let result = response.result as { records?: AnyRecord[] } | undefined;
  let token = response.requestToken;
  let state = response.state;

  for (let i = 0; !result && token && i < 20; i += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = poll.state;
    result = poll.result as { records?: AnyRecord[] } | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`Simulation query did not complete (${state})`);
  return (result.records ?? []).filter(Boolean);
}

function zone(): string {
  const select = [...document.querySelectorAll<HTMLSelectElement>('select')].find((element) => /management zone/i.test(element.previousElementSibling?.textContent || ''));
  return select?.value || 'All Management Zones';
}

function traffic(panel: HTMLElement) {
  const text = panel.innerText.replace(/,/g, '');
  return {
    current: num(text.match(/Current traffic[^0-9]*([0-9.]+)\s*req\/min/i)?.[1]),
    simulated: num(text.match(/Simulated traffic[^0-9]*([0-9.]+)\s*req\/min/i)?.[1]),
  };
}

function fit(xs: number[], ys: number[]): Model | null {
  const pairs: Array<[number, number]> = xs.map((x, index) => [x, ys[index]] as [number, number]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pairs.length < 8) return null;
  const mx = pairs.reduce((sum, [x]) => sum + x, 0) / pairs.length;
  const my = pairs.reduce((sum, [, y]) => sum + y, 0) / pairs.length;
  const denominator = pairs.reduce((sum, [x]) => sum + (x - mx) ** 2, 0);
  if (!denominator) return null;
  const slope = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0) / denominator;
  const intercept = my - slope * mx;
  const total = pairs.reduce((sum, [, y]) => sum + (y - my) ** 2, 0);
  const residual = pairs.reduce((sum, [x, y]) => sum + (y - (intercept + slope * x)) ** 2, 0);
  return {
    slope,
    intercept,
    r2: total ? Math.max(0, 1 - residual / total) : 0,
    current: ys.at(-1) || 0,
    samples: pairs.length,
  };
}

function joinByTimestamp(resource: Point[], trafficPoints: Point[]): Array<[number, number]> {
  const trafficByTs = new Map(trafficPoints.map((point) => [point.ts, point.value]));
  const exact = resource.flatMap((point) => {
    const trafficValue = trafficByTs.get(point.ts);
    return trafficValue == null ? [] : [[trafficValue, point.value] as [number, number]];
  });
  if (exact.length >= 8) return exact;

  // Small timestamp differences can occur because one query is evaluated a few
  // milliseconds apart. Match only within half a bucket; never by arbitrary index.
  const sortedTraffic = [...trafficPoints].sort((a, b) => a.ts - b.ts);
  const tolerance = 1800000;
  return resource.flatMap((point) => {
    let best: Point | undefined;
    let distance = Number.POSITIVE_INFINITY;
    for (const candidate of sortedTraffic) {
      const delta = Math.abs(candidate.ts - point.ts);
      if (delta <= tolerance && delta < distance) {
        best = candidate;
        distance = delta;
      }
    }
    return best ? [[best.value, point.value] as [number, number]] : [];
  });
}

function render(panel: HTMLElement, models: Record<'cpu' | 'memory' | 'disk', Model>, current: number, simulated: number, growth: number) {
  panel.querySelector('.simulation-scenario-detail-v4')?.remove();
  const target = simulated || current * (1 + growth / 100);
  const days = [0, 20, 60, 90];
  const trafficAt = (day: number) => current + (target - current) * day / 90;
  const predict = (model: Model, day: number) => {
    const trafficValue = trafficAt(day);
    const value = model.r2 >= 0.25
      ? model.slope * trafficValue + model.intercept
      : (model.current || 0) * (trafficValue / Math.max(1, current));
    return Math.max(0, Math.min(100, value));
  };
  const rows = days.map((day) => ({
    day,
    traffic: trafficAt(day),
    cpu: predict(models.cpu, day),
    memory: predict(models.memory, day),
    disk: predict(models.disk, day),
  }));
  const format = (value: number) => value.toFixed(1);
  const section = document.createElement('section');
  section.className = 'simulation-scenario-detail simulation-scenario-detail-v4';
  section.innerHTML = `
    <div class="projection-header">
      <span class="eyebrow">Traffic what-if capacity model</span>
      <h2>${growth >= 0 ? '+' : ''}${format(growth)}% traffic scenario</h2>
      <p>CPU, memory and disk are estimated from timestamp-aligned 30-day Dynatrace traffic/resource observations for the selected scope. This is a scenario model, not a Dynatrace Assist forecast.</p>
    </div>
    <div class="scenario-assumptions">
      <div><small>Current traffic</small><strong>${format(current)} req/min</strong></div>
      <div><small>Traffic change</small><strong>${growth >= 0 ? '+' : ''}${format(growth)}%</strong></div>
      <div><small>Scenario traffic at 90d</small><strong>${format(target)} req/min</strong></div>
      <div><small>Forecast checkpoints</small><strong>20 / 60 / 90 days</strong></div>
    </div>
    <div class="scenario-table"><table><thead><tr><th>Horizon</th><th>Traffic</th><th>CPU</th><th>Memory</th><th>Disk</th></tr></thead><tbody>${rows.slice(1).map((row) => `<tr><td>${row.day} days</td><td>${format(row.traffic)} req/min</td><td>${format(row.cpu)}%</td><td>${format(row.memory)}%</td><td>${format(row.disk)}%</td></tr>`).join('')}</tbody></table></div>
    <div class="projection-grid">
      ${(['cpu', 'memory', 'disk'] as const).map((key) => {
        const name = key === 'cpu' ? 'CPU utilization' : key === 'memory' ? 'Memory utilization' : 'Disk utilization';
        const model = models[key];
        const point = (row: typeof rows[number], index: number) => `${88 + index * 248},${270 - row[key] * 2}`;
        return `<div class="projection-card">
          <div class="chart-title-row"><strong>${name}</strong><span>Unit: % · ${growth >= 0 ? '+' : ''}${format(growth)}% traffic scenario</span></div>
          <svg class="projection-svg" viewBox="0 0 860 320" role="img" aria-label="${name} traffic scenario trend">
            <line x1="88" x2="832" y1="270" y2="270" class="chart-grid"/><line x1="88" x2="832" y1="220" y2="220" class="chart-grid"/><line x1="88" x2="832" y1="170" y2="170" class="chart-grid"/><line x1="88" x2="832" y1="120" y2="120" class="chart-grid"/><line x1="88" x2="832" y1="70" y2="70" class="chart-grid"/>
            <text x="12" y="274" class="chart-axis-label">0%</text><text x="12" y="224" class="chart-axis-label">25%</text><text x="12" y="174" class="chart-axis-label">50%</text><text x="12" y="124" class="chart-axis-label">75%</text><text x="12" y="74" class="chart-axis-label">100%</text>
            <line x1="88" x2="832" y1="110" y2="110" class="threshold-line"/><polyline points="${rows.map(point).join(' ')}" class="projection-line"/>
            ${rows.map((row, index) => `<circle cx="${88 + index * 248}" cy="${270 - row[key] * 2}" r="6" class="projection-point" data-day="${row.day}" data-value="${format(row[key])}"/><text x="${76 + index * 248}" y="${Math.max(22, 265 - row[key] * 2)}" class="projection-label">${format(row[key])}%</text>`).join('')}
            <text x="88" y="292" class="chart-axis-label">Now</text><text x="320" y="292" class="chart-axis-label">20d</text><text x="568" y="292" class="chart-axis-label">60d</text><text x="812" y="292" class="chart-axis-label">90d</text><text x="360" y="315" class="chart-axis-title">Days from now</text>
          </svg>
          <div class="projection-meta"><span>R²: <strong>${model.r2.toFixed(2)}</strong></span><span>Aligned samples: <strong>${model.samples}</strong></span><span>${model.r2 >= .7 ? 'High' : model.r2 >= .4 ? 'Moderate' : 'Low'} confidence</span></div>
        </div>`;
      }).join('')}
    </div>`;
  panel.appendChild(section);
}

async function load(panel: HTMLElement) {
  if (panel.dataset.simV4 === 'loading' || panel.dataset.simV4 === 'done') return;
  const { current, simulated } = traffic(panel);
  if (!current) return;
  panel.dataset.simV4 = 'loading';
  const growth = simulated ? ((simulated / current) - 1) * 100 : 0;
  try {
    const selectedZone = zone();
    const safeZone = selectedZone.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const zoneFilter = selectedZone !== 'All Management Zones' ? `| expand managementZones | filter managementZones == "${safeZone}"` : '';
    const hosts = await dql(`fetch dt.entity.host ${zoneFilter} | fields id | dedup id`);
    const ids = hosts.map((record) => String(record.id || '')).filter(Boolean);
    if (!ids.length) throw new Error('No hosts in selected scope');
    const list = ids.map((id) => `"${id.replace(/"/g, '\\"')}"`).join(',');

    const [resources, requestSeries] = await Promise.all([
      dql(`timeseries cpu=avg(dt.host.cpu.usage), memory=avg(dt.host.memory.usage), disk=avg(dt.host.disk.used.percent), by:{dt.entity.host}, interval:1h, from:-30d, to:now() | filter in(dt.entity.host, ${list})`),
      dql(`fetch spans, from:now()-30d, to:now() | filter request.is_root_span == true | filter isNotNull(dt.entity.host) | filter in(dt.entity.host, ${list}) | makeTimeseries requests=count(), by:{dt.entity.host}, interval:1h`),
    ]);

    const trafficByHost = new Map<string, Point[]>();
    requestSeries.forEach((record) => {
      trafficByHost.set(String(record['dt.entity.host'] || ''), points(record, record.requests).map((point) => ({ ...point, value: point.value / 60 })));
    });

    const models: Record<'cpu' | 'memory' | 'disk', Model> = {
      cpu: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0 },
      memory: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0 },
      disk: { r2: 0, slope: 0, intercept: 0, current: 0, samples: 0 },
    };

    for (const key of ['cpu', 'memory', 'disk'] as const) {
      const xs: number[] = [];
      const ys: number[] = [];
      resources.forEach((record) => {
        const host = String(record['dt.entity.host'] || '');
        const trafficPoints = trafficByHost.get(host) || [];
        const pairs = joinByTimestamp(points(record, record[key]), trafficPoints);
        pairs.forEach(([trafficValue, resourceValue]) => {
          if (Number.isFinite(trafficValue) && Number.isFinite(resourceValue)) {
            xs.push(trafficValue);
            ys.push(resourceValue);
          }
        });
      });
      const fitted = fit(xs, ys);
      models[key] = fitted || {
        r2: 0,
        slope: 0,
        intercept: ys.at(-1) || 0,
        current: ys.at(-1) || 0,
        samples: xs.length,
      };
    }

    render(panel, models, current, simulated, growth);
    panel.dataset.simV4 = 'done';
  } catch (error) {
    console.error('Simulation V4', error);
    panel.dataset.simV4 = 'error';
    const warning = document.createElement('div');
    warning.className = 'simulation-data-warning';
    warning.textContent = 'Resource scenario model could not be calculated from timestamp-aligned Dynatrace observations. No fabricated trend is shown.';
    panel.appendChild(warning);
  }
}

export function installSimulationProjectionV4() {
  const win = window as Window & { __axisSimV4?: boolean };
  if (win.__axisSimV4) return;
  win.__axisSimV4 = true;
  const check = () => {
    const panel = document.querySelector<HTMLElement>('.simulation-enhanced');
    if (panel && !panel.querySelector('.projection-grid')) void load(panel);
  };
  const observer = new MutationObserver(() => setTimeout(check, 250));
  observer.observe(document.body, { subtree: true, childList: true });
  document.addEventListener('change', () => setTimeout(() => {
    const panel = document.querySelector<HTMLElement>('.simulation-enhanced');
    if (panel) {
      panel.dataset.simV4 = '';
      panel.querySelector('.simulation-scenario-detail-v4')?.remove();
      void load(panel);
    }
  }, 300));
  check();
}
