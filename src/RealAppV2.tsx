import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Cpu, Database, FileText, Gauge, HardDrive, LayoutDashboard, Loader2, Moon, RefreshCw, Server, SlidersHorizontal, Sparkles, Sun } from 'lucide-react';
import type { ForecastHorizon, Host, MetricKey, TimeRange } from '@/types';
import { forecastMetric, getBusinessInsights, runCapacitySimulation } from '@/services';
import { getHostRisk } from '@/services/hostStatus';
import { LineChart, MetricCard, StatusBadge } from '@/components';
import { dynatraceDataProvider, type ManagementZoneOption } from './realDynatrace';
import { generateAssistCapacitySummary, getDynatraceForecasts, type AiCapacitySummary, type DynatraceForecast } from './dynatraceIntelligence';

type Page = 'overview' | 'inventory' | 'forecast' | 'simulation';
type DetailMetric = MetricKey | 'networkRx' | 'networkTx' | 'throughput';
const currentRanges: Array<{ value: TimeRange; label: string }> = [
  { value: '1h', label: 'Last 1 hour' }, { value: '6h', label: 'Last 6 hours' }, { value: '24h', label: 'Last 24 hours' }, { value: '7d', label: 'Last 7 days' }, { value: '30d', label: 'Last 30 days' },
];
const forecastRanges: ForecastHorizon[] = [30, 60, 90];
const avg = (hosts: Host[], key: 'cpu' | 'memory' | 'disk') => hosts.length ? Math.round(hosts.reduce((s, h) => s + (h.telemetry.at(-1)?.[key] ?? 0), 0) / hosts.length) : 0;
const totalThroughput = (hosts: Host[]) => Math.round(hosts.reduce((s, h) => s + (h.telemetry.at(-1)?.throughput ?? 0), 0));
const rate = (v: number) => v >= 1048576 ? `${(v / 1048576).toFixed(1)} MB/s` : v >= 1024 ? `${(v / 1024).toFixed(1)} KB/s` : `${Math.round(v)} B/s`;

function pdf(lines: string[]) {
  const esc = (v: string) => v.replace(/[\\()]/g, ' ').replace(/[^\x20-\x7E]/g, ' ');
  const body = ['AXIS CAPACITY PLANNER — EXECUTIVE REPORT', '', ...lines].slice(0, 65);
  let c = 'BT\n/F1 16 Tf\n40 750 Td\n';
  body.forEach((line, i) => { if (i === 1) c += '/F1 9 Tf\n'; if (i) c += '0 -13 Td '; c += `(${esc(line)}) Tj\n`; }); c += 'ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>', `<< /Length ${c.length} >>\nstream\n${c}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const offsets = [0]; objects.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; }); const x = out.length;
  out += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'application/pdf' })); a.download = 'axis-capacity-report.pdf'; a.click();
}

export default function RealAppV2() {
  const [zones, setZones] = useState<ManagementZoneOption[]>([]);
  const [zone, setZone] = useState('All Management Zones');
  const [timeRange, setTimeRange] = useState<TimeRange>('24h');
  const [forecastHorizon, setForecastHorizon] = useState<ForecastHorizon>(30);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [page, setPage] = useState<Page>('overview');
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ai, setAi] = useState<AiCapacitySummary | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [forecastData, setForecastData] = useState<Array<{ host: Host; forecast: DynatraceForecast }>>([]);
  const [forecastMetric, setForecastMetric] = useState<MetricKey>('cpu');
  const [forecastLoading, setForecastLoading] = useState(false);

  const load = async (selectedZone = zone, selectedTimeRange = timeRange) => {
    setLoading(true); setError(''); setAi(null);
    try {
      const [z, h] = await Promise.all([zones.length ? Promise.resolve(zones) : dynatraceDataProvider.getManagementZones(), dynatraceDataProvider.getHosts(selectedZone, selectedTimeRange)]);
      if (!zones.length) setZones(z);
      setHosts(h);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read Dynatrace data'); setHosts([]);
    } finally { setLoading(false); }
  };

  useEffect(() => { void load('All Management Zones', timeRange); }, []);
  useEffect(() => { if (zones.length) void load(zone, timeRange); }, [zone, timeRange]);

  const runForecast = async () => {
    if (!hosts.length) return;
    setForecastLoading(true); setForecastData([]);
    try { setForecastData(await getDynatraceForecasts(hosts, forecastMetric, forecastHorizon)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Dynatrace forecast failed'); }
    finally { setForecastLoading(false); }
  };

  const runAi = async () => {
    setAiLoading(true);
    try { setAi(await generateAssistCapacitySummary(hosts, zone, forecastData)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Dynatrace Assist failed'); }
    finally { setAiLoading(false); }
  };

  const makePdf = async () => {
    setAiLoading(true);
    try {
      const summary = ai ?? await generateAssistCapacitySummary(hosts, zone, forecastData);
      setAi(summary);
      const risks = [...hosts].sort((a, b) => Math.max(b.telemetry.at(-1)?.cpu ?? 0, b.telemetry.at(-1)?.memory ?? 0, b.telemetry.at(-1)?.disk ?? 0) - Math.max(a.telemetry.at(-1)?.cpu ?? 0, a.telemetry.at(-1)?.memory ?? 0, a.telemetry.at(-1)?.disk ?? 0));
      pdf([
        `Management Zone: ${zone}`, `Current data timeframe: ${currentRanges.find((r) => r.value === timeRange)?.label ?? timeRange}`, `Forecast horizon: ${forecastHorizon} days`, `Generated: ${new Date().toLocaleString()}`, `Hosts: ${hosts.length}`,
        `Average CPU: ${avg(hosts, 'cpu')}%`, `Average Memory: ${avg(hosts, 'memory')}%`, `Average Disk: ${avg(hosts, 'disk')}%`, `Current application throughput: ${totalThroughput(hosts)} req/min`, '',
        'DYNATRACE INTELLIGENCE / AI ASSESSMENT', ...summary.text.split('\n').filter(Boolean), '', 'TOP CAPACITY RISKS', ...risks.slice(0, 10).map((h, i) => { const p = h.telemetry.at(-1); return `${i + 1}. ${h.name} | CPU ${Math.round(p?.cpu ?? 0)}% | MEM ${Math.round(p?.memory ?? 0)}% | DISK ${Math.round(p?.disk ?? 0)}% | APP ${Math.round(p?.throughput ?? 0)} req/min`; }), '', 'Dynatrace Intelligence uses AI. Always verify important information and decisions.'
      ]);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to generate PDF report'); }
    finally { setAiLoading(false); }
  };

  const nav = [{ id: 'overview' as Page, label: 'Overview', icon: LayoutDashboard }, { id: 'inventory' as Page, label: 'Host Inventory', icon: Server }, { id: 'forecast' as Page, label: 'Capacity Forecast', icon: BarChart3 }, { id: 'simulation' as Page, label: 'Simulation', icon: SlidersHorizontal }];
  return <div className={dark ? 'app dark' : 'app'}>
    <aside className="sidebar"><div className="brand"><div className="brand-mark"><Gauge size={22}/></div><div><strong>AXIS</strong><span>Capacity Planner</span></div></div><div className="mode-pill"><span className="live-dot"/>Live Dynatrace</div><nav>{nav.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => { setPage(id); setSelectedHost(null); }}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-footer"><Database size={17}/><div><small>Data provider</small><strong>Dynatrace DQL</strong></div></div></aside>
    <main className="main"><header className="topbar"><div className="breadcrumbs"><span>Infrastructure</span><span>›</span><strong>Capacity Planner</strong></div><div className="top-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <label className="mz-selector"><span>Management Zone</span><select value={zone} onChange={(e) => { setZone(e.target.value); setSelectedHost(null); }}><option>All Management Zones</option>{zones.map((z) => <option key={z.name}>{z.name}</option>)}</select></label>
      <label className="mz-selector"><span>Current data</span><select value={timeRange} onChange={(e) => setTimeRange(e.target.value as TimeRange)}>{currentRanges.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></label>
      <label className="mz-selector"><span>Forecast</span><select value={forecastHorizon} onChange={(e) => setForecastHorizon(Number(e.target.value) as ForecastHorizon)}>{forecastRanges.map((d) => <option key={d} value={d}>{d} days</option>)}</select></label>
      <div className="source-control"><span className="live-dot"/>Live Dynatrace</div><button className="icon-button" onClick={() => void load()}><RefreshCw size={18}/></button><button className="icon-button" onClick={() => setDark(!dark)}>{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
    </div></header>
      {error && <div className="notice"><AlertTriangle size={17}/><span>{error}</span></div>}
      {loading && <div className="loading-bar"><RefreshCw size={15}/> Reading live Dynatrace data for {currentRanges.find((r) => r.value === timeRange)?.label ?? timeRange}…</div>}
      {selectedHost ? <HostDetail host={selectedHost} timeRange={timeRange} back={() => setSelectedHost(null)}/> : page === 'overview' ? <Overview hosts={hosts} ai={ai} aiLoading={aiLoading} runAi={runAi} select={setSelectedHost} setPage={setPage} timeRange={timeRange} forecastHorizon={forecastHorizon}/> : page === 'inventory' ? <Inventory hosts={hosts} select={setSelectedHost}/> : page === 'forecast' ? <Forecast hosts={hosts} metric={forecastMetric} horizon={forecastHorizon} setMetric={setForecastMetric} data={forecastData} loading={forecastLoading} run={runForecast} /> : <Simulation hosts={hosts} forecastHorizon={forecastHorizon}/>}</main>
      <button className="pdf-report-button" onClick={() => void makePdf()} disabled={aiLoading}><FileText size={16}/>{aiLoading ? 'Generating AI Report…' : 'Generate PDF Report'}</button>
  </div>;
}

function Overview({ hosts, ai, aiLoading, runAi, select, setPage, timeRange, forecastHorizon }: { hosts: Host[]; ai: AiCapacitySummary | null; aiLoading: boolean; runAi: () => void; select: (h: Host) => void; setPage: (p: Page) => void; timeRange: TimeRange; forecastHorizon: ForecastHorizon }) {
  const high = hosts.filter((h) => getHostRisk(h) === 'High').length; const critical = hosts.filter((h) => getHostRisk(h) === 'Critical').length; const currentTraffic = totalThroughput(hosts);
  return <div className="content"><PageTitle eyebrow="Live executive overview" title="Capacity at a glance"/>
    <section className="kpi-grid"><MetricCard label="Total Hosts" value={String(hosts.length)} detail="Live from Dynatrace" icon={<Server/>}/><MetricCard label="Healthy / Stable" value={String(Math.max(0, hosts.length - high - critical))} detail="Current estate health" icon={<CheckCircle2/>} tone="green"/><MetricCard label="High Risk" value={String(high)} detail="Requires monitoring" icon={<AlertTriangle/>} tone="amber"/><MetricCard label="Critical" value={String(critical)} detail="Immediate attention" icon={<AlertTriangle/>} tone="red"/></section>
    <section className="overview-grid"><article className="panel resource-panel"><div className="panel-heading"><div><span className="eyebrow">Real telemetry</span><h2>Resource utilization</h2></div><button className="text-button" onClick={() => setPage('forecast')}>View Dynatrace forecast →</button></div><div className="resource-list"><Resource label="Average CPU" value={avg(hosts, 'cpu')} icon={<Cpu/>}/><Resource label="Average memory" value={avg(hosts, 'memory')} icon={<Database/>}/><Resource label="Average disk" value={avg(hosts, 'disk')} icon={<HardDrive/>}/></div><div className="telemetry-extra"><strong>Current application throughput: {currentTraffic.toLocaleString()} req/min</strong><span>Current data: {timeRange} · Forecast horizon: {forecastHorizon} days</span></div></article><article className="panel status-panel"><div className="panel-heading"><div><span className="eyebrow">Fleet distribution</span><h2>Capacity status</h2></div></div><div className="donut-wrap"><div className="donut"><div><strong>{hosts.length}</strong><span>hosts</span></div></div><div className="donut-legend"><Legend label="Healthy / stable" value={Math.max(0, hosts.length - high - critical)} color="green"/><Legend label="High risk" value={high} color="amber"/><Legend label="Critical" value={critical} color="red"/></div></div></article></section>
    <section className="panel ai-panel"><div className="ai-header"><div><span className="eyebrow ai-eyebrow"><Sparkles size={14}/> Dynatrace Intelligence</span><h2>AI-assisted capacity assessment</h2><p>Live telemetry + Dynatrace forecast horizon {forecastHorizon} days.</p></div><button className="ai-button" onClick={runAi} disabled={aiLoading}>{aiLoading ? <><Loader2 size={16}/> Analyzing…</> : <><Sparkles size={16}/> Generate AI Assessment</>}</button></div>{ai ? <div className="ai-summary"><pre>{ai.text}</pre><small>{ai.source} · {new Date(ai.generatedAt).toLocaleString()} · Dynatrace Intelligence uses AI. Always verify important information and decisions.</small></div> : <div className="ai-empty">Generate prioritized capacity risks, actions and a 30/60/90-day recommendation.</div>}</section>
    <section className="panel table-panel"><div className="panel-heading"><h2>Hosts to watch</h2><button className="text-button" onClick={() => setPage('inventory')}>View all hosts →</button></div><HostTable hosts={hosts.filter((h) => getHostRisk(h) !== 'Low').slice(0, 10)} select={select}/></section>
  </div>;
}

function Inventory({ hosts, select }: { hosts: Host[]; select: (h: Host) => void }) { const [q, setQ] = useState(''); const filtered = hosts.filter((h) => `${h.name} ${h.application} ${h.environment}`.toLowerCase().includes(q.toLowerCase())); return <div className="content"><PageTitle eyebrow="Live infrastructure estate" title="Host inventory"><div className="count-chip"><Server size={15}/>{filtered.length} of {hosts.length} hosts</div></PageTitle><section className="panel table-panel"><div className="filter-row"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search host, host group, environment…"/></div><HostTable hosts={filtered} select={select}/></section></div>; }

function HostTable({ hosts, select }: { hosts: Host[]; select: (h: Host) => void }) { return <div className="table-scroll">{hosts.length ? <table><thead><tr><th>Host</th><th>Environment</th><th>Application</th><th>CPU</th><th>Memory</th><th>Disk</th><th>App throughput</th><th>Status</th></tr></thead><tbody>{hosts.map((h) => { const p = h.telemetry.at(-1)!; return <tr key={h.id} onClick={() => select(h)}><td><strong className="host-link">{h.name}</strong><small>{h.id}</small></td><td>{h.environment}</td><td>{h.application}</td><td>{Math.round(p.cpu)}%</td><td>{Math.round(p.memory)}%</td><td>{Math.round(p.disk)}%</td><td>{Math.round(p.throughput ?? 0).toLocaleString()} req/min</td><td><StatusBadge value={h.profile}/></td></tr>; })}</tbody></table> : <div className="empty-state"><Server size={24}/><strong>No hosts returned for this scope</strong></div>}</div>; }

function HostDetail({ host, back, timeRange }: { host: Host; back: () => void; timeRange: TimeRange }) { const [metric, setMetric] = useState<DetailMetric>('throughput'); const p = host.telemetry.at(-1)!; const values = host.telemetry.map((x) => metric === 'networkRx' ? x.networkRx : metric === 'networkTx' ? x.networkTx : metric === 'throughput' ? x.throughput ?? 0 : x[metric]); const label = metric === 'networkRx' ? 'Network RX (bytes/s)' : metric === 'networkTx' ? 'Network TX (bytes/s)' : metric === 'throughput' ? 'Application Throughput (requests/min)' : metric.toUpperCase(); return <div className="content"><button className="back-button" onClick={back}>← Back to inventory</button><PageTitle eyebrow="Live host detail" title={host.name}><StatusBadge value={host.profile}/></PageTitle><div className="detail-meta"><span><Server size={15}/> {host.environment}</span><span><Database size={15}/> {host.application}</span><span><Activity size={15}/> {host.id}</span></div><section className="metric-strip"><MetricCard label="CPU" value={`${Math.round(p.cpu)}%`} detail="Current" icon={<Cpu/>}/><MetricCard label="Memory" value={`${Math.round(p.memory)}%`} detail="Current" icon={<Database/>} tone="teal"/><MetricCard label="Disk" value={`${Math.round(p.disk)}%`} detail="Current" icon={<HardDrive/>} tone="amber"/><MetricCard label="Network RX / TX" value={`${rate(p.networkRx)} / ${rate(p.networkTx)}`} detail="Real NIC bytes/sec" icon={<Activity/>} tone="green"/><MetricCard label="Service Throughput" value={`${Math.round(p.throughput ?? 0).toLocaleString()} req/min`} detail="Request-root spans" icon={<BarChart3/>}/></section><section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">{timeRange} live telemetry</span><h2>{label}</h2></div><select value={metric} onChange={(e) => setMetric(e.target.value as DetailMetric)}><option value="throughput">Throughput</option><option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option><option value="networkRx">Network RX</option><option value="networkTx">Network TX</option></select></div><LineChart values={values} threshold={['cpu', 'memory', 'disk'].includes(metric) ? 80 : undefined}/></section></div>; }

function Forecast({ hosts, metric, horizon, setMetric, data, loading, run }: { hosts: Host[]; metric: MetricKey; horizon: ForecastHorizon; setMetric: (m: MetricKey) => void; data: Array<{ host: Host; forecast: DynatraceForecast }>; loading: boolean; run: () => void }) { const selected = data[0]; const risky = data.filter(({ forecast }) => Math.max(...forecast.forecast, 0) >= 80 || Math.max(...forecast.upperBound, 0) >= 80); return <div className="content"><PageTitle eyebrow="Predictive capacity planning" title="Capacity forecast"><div className="filter-row"><select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}><option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option></select><button className="ai-button" onClick={run} disabled={loading}>{loading ? 'Running…' : `Run ${horizon}-day forecast`}</button></div></PageTitle><section className="kpi-grid"><MetricCard label="Hosts analysed" value={String(hosts.length)} detail="Live Dynatrace telemetry" icon={<Server/>}/><MetricCard label="Forecast results" value={String(data.length)} detail="Dynatrace Intelligence" icon={<Sparkles/>} tone="green"/><MetricCard label="Forecast risk" value={String(risky.length)} detail={`${metric} · ${horizon} days`} icon={<AlertTriangle/>} tone="amber"/></section><section className="panel forecast-panel"><div className="forecast-source"><Sparkles size={16}/><strong>Dynatrace Intelligence Forecast Analyzer</strong><span>Historical input: 30 days · 90% prediction interval · selected horizon: {horizon} days</span></div>{loading ? <div className="empty-state"><Loader2 size={24}/><strong>Running Dynatrace forecast…</strong></div> : selected ? <><div className="forecast-select-row"><strong>{selected.host.name}</strong><span>{selected.forecast.forecastStart ? new Date(selected.forecast.forecastStart).toLocaleString() : '—'} → {selected.forecast.forecastEnd ? new Date(selected.forecast.forecastEnd).toLocaleString() : '—'}</span></div><LineChart values={selected.forecast.historical} forecast={selected.forecast.forecast} upper={selected.forecast.upperBound} threshold={80}/></> : <div className="empty-state"><Server size={24}/><strong>Click “Run forecast” to execute Dynatrace Intelligence for the selected {horizon}-day horizon.</strong></div>}</section></div>; }

function Simulation({ hosts, forecastHorizon }: { hosts: Host[]; forecastHorizon: ForecastHorizon }) { const [growth, setGrowth] = useState(20); const [additional, setAdditional] = useState(0); const current = totalThroughput(hosts); const simulated = Math.round(current * (1 + growth / 100)); const r = runCapacitySimulation({ cpuCapacity: Math.max(1, avg(hosts, 'cpu')), memoryCapacity: Math.max(1, avg(hosts, 'memory')), diskCapacity: Math.max(1, avg(hosts, 'disk')), trafficGrowth: growth, transactionGrowth: growth, period: forecastHorizon, additionalHosts: additional, cpuPerHost: 25, memoryPerHost: 25, diskPerHost: 20 }); const insight = getBusinessInsights(hosts); return <div className="content"><PageTitle eyebrow="What-if planning" title="Capacity simulation"/><section className="panel" style={{ padding: 24 }}><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}><div><label style={{ display:'block', marginBottom:8 }}>Traffic growth <strong>{growth}%</strong></label><input type="range" min="0" max="100" value={growth} onChange={(e) => setGrowth(Number(e.target.value))} style={{ width:'100%' }}/><label style={{ display:'block', margin:'22px 0 8px' }}>Additional hosts <strong>{additional}</strong></label><input type="range" min="0" max="20" value={additional} onChange={(e) => setAdditional(Number(e.target.value))} style={{ width:'100%' }}/></div><div><div className="kpi-grid" style={{ gridTemplateColumns:'repeat(3,1fr)' }}><MetricCard label="Current traffic" value={`${current.toLocaleString()} req/min`} detail="Live Dynatrace application traffic" icon={<Activity/>}/><MetricCard label="Simulated traffic" value={`${simulated.toLocaleString()} req/min`} detail={`+${growth}% from current`} icon={<BarChart3/>} tone="green"/><MetricCard label="Traffic delta" value={`+${Math.max(0, simulated-current).toLocaleString()} req/min`} detail="Simulation delta" icon={<SlidersHorizontal/>} tone="amber"/></div><div className="simulation-result" style={{ marginTop:18 }}><span className="eyebrow">Projected capacity · {forecastHorizon} days</span><strong>{r.recommendedExpansion} additional hosts</strong><p>{r.risk} risk · capacity gap {r.capacityGap.toFixed(1)}</p><small>{insight.summary}</small></div></div></div></section>{current === 0 && <div className="notice" style={{ marginTop:16 }}>No application throughput was returned for this scope/timeframe. Open a host in Dynatrace and verify request-root spans (`request.is_root_span == true`) before using traffic simulation.</div>}</div>; }

function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) { return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</div>; }
function Resource({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) { return <div className="resource-row"><div className="resource-icon blue">{icon}</div><span>{label}</span><div className="progress"><i className="blue" style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></div><strong>{value}%</strong></div>; }
function Legend({ label, value, color }: { label: string; value: number; color: string }) { return <div><span><i className={`legend-square ${color}`}/>{label}</span><strong>{value}</strong></div>; }
