import { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, BarChart3, CheckCircle2, Cpu, Database, Gauge, HardDrive, LayoutDashboard, Moon, RefreshCw, Server, SlidersHorizontal, Sun } from 'lucide-react';
import type { ForecastHorizon, Host, MetricKey } from '@/types';
import { forecastMetric, getBusinessInsights, metricLabels, runCapacitySimulation } from '@/services';
import { getHostRisk } from '@/services/hostStatus';
import { LineChart, MetricCard, StatusBadge } from '@/components';
import { dynatraceDataProvider, type ManagementZoneOption } from './realDynatrace';

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'inventory', label: 'Host Inventory', icon: Server },
  { id: 'forecast', label: 'Capacity Forecast', icon: BarChart3 },
  { id: 'simulation', label: 'Simulation', icon: SlidersHorizontal },
] as const;
type Page = typeof navItems[number]['id'];

const average = (hosts: Host[], key: 'cpu' | 'memory' | 'disk') => {
  if (!hosts.length) return 0;
  return Math.round(hosts.reduce((sum, host) => sum + (host.telemetry.at(-1)?.[key] ?? 0), 0) / hosts.length);
};

function escapePdfText(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)').replace(/[^\x20-\x7E]/g, ' ');
}

function downloadPdf(title: string, lines: string[]) {
  const pageHeight = 792;
  const lineHeight = 15;
  const contentLines = [title, '', ...lines].slice(0, 47);
  let content = 'BT\n/F1 16 Tf\n40 750 Td\n';
  content += `(${escapePdfText(contentLines[0])}) Tj\n/F1 10 Tf\n`;
  for (let index = 1; index < contentLines.length; index += 1) {
    content += `0 -${lineHeight} Td (${escapePdfText(contentLines[index])}) Tj\n`;
  }
  content += 'ET';

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => { pdf += `${String(offset).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function RealApp() {
  const [zones, setZones] = useState<ManagementZoneOption[]>([]);
  const [selectedZone, setSelectedZone] = useState('All Management Zones');
  const [hosts, setHosts] = useState<Host[]>([]);
  const [page, setPage] = useState<Page>('overview');
  const [selectedHost, setSelectedHost] = useState<Host | null>(null);
  const [dark, setDark] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = async (zone = selectedZone) => {
    setLoading(true);
    setError('');
    try {
      const [zoneResult, hostResult] = await Promise.all([
        zones.length ? Promise.resolve(zones) : dynatraceDataProvider.getManagementZones(),
        dynatraceDataProvider.getHosts(zone),
      ]);
      if (!zones.length) setZones(zoneResult);
      setHosts(hostResult);
      setLastUpdated(new Date());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to read Dynatrace data.');
      setHosts([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load('All Management Zones'); }, []);
  useEffect(() => { if (zones.length) void load(selectedZone); }, [selectedZone]);

  const avgCpu = average(hosts, 'cpu');
  const avgMemory = average(hosts, 'memory');
  const avgDisk = average(hosts, 'disk');
  const highRisk = hosts.filter((host) => ['High', 'Critical'].includes(getHostRisk(host))).length;
  const critical = hosts.filter((host) => getHostRisk(host) === 'Critical').length;
  const healthy = hosts.length - highRisk - critical;

  const reportLines = useMemo(() => {
    const risky = [...hosts].sort((a, b) => Math.max(b.telemetry.at(-1)?.cpu ?? 0, b.telemetry.at(-1)?.memory ?? 0, b.telemetry.at(-1)?.disk ?? 0) - Math.max(a.telemetry.at(-1)?.cpu ?? 0, a.telemetry.at(-1)?.memory ?? 0, a.telemetry.at(-1)?.disk ?? 0)).slice(0, 10);
    return [
      `Management Zone: ${selectedZone}`,
      `Generated: ${new Date().toLocaleString()}`,
      `Total hosts: ${hosts.length}`,
      `Healthy / stable: ${healthy}`,
      `High risk: ${highRisk}`,
      `Critical / over capacity: ${critical}`,
      `Average CPU: ${avgCpu}%`,
      `Average memory: ${avgMemory}%`,
      `Average disk: ${avgDisk}%`,
      '',
      'Top capacity risks:',
      ...risky.map((host, index) => {
        const latest = host.telemetry.at(-1);
        return `${index + 1}. ${host.name} | CPU ${Math.round(latest?.cpu ?? 0)}% | MEM ${Math.round(latest?.memory ?? 0)}% | DISK ${Math.round(latest?.disk ?? 0)}%`;
      }),
    ];
  }, [avgCpu, avgDisk, avgMemory, critical, healthy, highRisk, hosts, selectedZone]);

  return <div className={dark ? 'app dark' : 'app'}>
    <Sidebar page={page} setPage={setPage} />
    <main className="main">
      <header className="topbar">
        <div className="breadcrumbs"><span>Infrastructure</span><span>›</span><strong>Capacity Planner</strong></div>
        <div className="top-actions">
          <label className="mz-selector"><span>Management Zone</span><select value={selectedZone} onChange={(event) => { setSelectedZone(event.target.value); setSelectedHost(null); }}><option>All Management Zones</option>{zones.map((zone) => <option key={zone.name}>{zone.name}</option>)}</select></label>
          <div className="source-control"><span className="live-dot"/>Live Dynatrace</div>
          <button className="icon-button" onClick={() => void load()} aria-label="Refresh Dynatrace data"><RefreshCw size={18}/></button>
          <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18}/> : <Moon size={18}/>}</button>
        </div>
      </header>

      {error && <div className="notice"><AlertTriangle size={17}/><span>{error}</span></div>}
      {loading && <div className="loading-bar"><RefreshCw size={15}/> Reading live Dynatrace data…</div>}
      {selectedHost ? <HostDetail host={selectedHost} onBack={() => setSelectedHost(null)} /> : <>
        {page === 'overview' && <Overview hosts={hosts} onSelect={setSelectedHost} setPage={setPage} lastUpdated={lastUpdated} />}
        {page === 'inventory' && <Inventory hosts={hosts} onSelect={setSelectedHost} />}
        {page === 'forecast' && <Forecast hosts={hosts} />}
        {page === 'simulation' && <Simulation hosts={hosts} />}
      </>}
    </main>
    <button className="pdf-report-button" onClick={() => downloadPdf('Axis Capacity Report', reportLines)}>Generate PDF Report</button>
  </div>;
}

function Sidebar({ page, setPage }: { page: Page; setPage: (page: Page) => void }) {
  return <aside className="sidebar"><div className="brand"><div className="brand-mark"><Gauge size={22}/></div><div><strong>AXIS</strong><span>Capacity Planner</span></div></div><div className="mode-pill"><span className="live-dot"/>Live Dynatrace</div><nav>{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><div className="sidebar-footer"><div className="provider-icon"><Database size={17}/></div><div><small>Data provider</small><strong>Dynatrace DQL</strong></div></div></aside>;
}

function PageTitle({ eyebrow, title, children }: { eyebrow: string; title: string; children?: React.ReactNode }) { return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1></div>{children}</div>; }

function Overview({ hosts, onSelect, setPage, lastUpdated }: { hosts: Host[]; onSelect: (host: Host) => void; setPage: (page: Page) => void; lastUpdated: Date | null }) {
  const cpu = average(hosts, 'cpu'); const memory = average(hosts, 'memory'); const disk = average(hosts, 'disk');
  const high = hosts.filter((host) => getHostRisk(host) === 'High').length; const critical = hosts.filter((host) => getHostRisk(host) === 'Critical').length;
  const forecastRisk = hosts.filter((host) => ['High', 'Critical'].includes(forecastMetric(host, 'cpu', 30).risk)).length;
  return <div className="content"><PageTitle eyebrow="Live executive overview" title="Capacity at a glance"><div className="date-chip"><Activity size={16}/> {lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Connecting…'}</div></PageTitle>
    <section className="kpi-grid"><MetricCard label="Total Hosts" value={String(hosts.length)} detail="Live from Dynatrace" icon={<Server/>}/><MetricCard label="Healthy / Stable" value={String(hosts.length - high - critical)} detail="Current estate health" icon={<CheckCircle2/>} tone="green"/><MetricCard label="High Risk" value={String(high)} detail="Requires monitoring" icon={<AlertTriangle/>} tone="amber"/><MetricCard label="Critical" value={String(critical)} detail="Immediate attention" icon={<AlertTriangle/>} tone="red"/></section>
    <section className="overview-grid"><article className="panel resource-panel"><div className="panel-heading"><div><span className="eyebrow">Real telemetry</span><h2>Resource utilization</h2></div><button className="text-button" onClick={() => setPage('forecast')}>View forecast →</button></div><div className="resource-list"><ResourceRow icon={<Cpu/>} label="Average CPU" value={cpu} color="blue"/><ResourceRow icon={<Database/>} label="Average memory" value={memory} color="teal"/><ResourceRow icon={<HardDrive/>} label="Average disk" value={disk} color="amber"/></div><div className="forecast-callout"><div><strong>{forecastRisk} hosts show 30-day forecast risk</strong><p>Forecast is calculated from the live 24-hour telemetry series.</p></div></div></article><article className="panel status-panel"><div className="panel-heading"><div><span className="eyebrow">Fleet distribution</span><h2>Capacity status</h2></div></div><div className="donut-wrap"><div className="donut"><div><strong>{hosts.length}</strong><span>hosts</span></div></div><div className="donut-legend"><Legend color="green" label="Healthy / stable" value={hosts.length - high - critical}/><Legend color="amber" label="High risk" value={high}/><Legend color="red" label="Critical" value={critical}/></div></div></article></section>
    <section className="panel table-panel"><div className="panel-heading"><div><span className="eyebrow">Attention required</span><h2>Hosts to watch</h2></div><button className="text-button" onClick={() => setPage('inventory')}>View all hosts →</button></div><HostTable hosts={hosts.filter((host) => getHostRisk(host) !== 'Low').slice(0, 10)} onSelect={onSelect}/></section>
  </div>;
}

function ResourceRow({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) { return <div className="resource-row"><div className={`resource-icon ${color}`}>{icon}</div><span>{label}</span><div className="progress"><i className={color} style={{ width: `${Math.min(value, 100)}%` }}/></div><strong>{value}%</strong></div>; }
function Legend({ color, label, value }: { color: string; label: string; value: number }) { return <div><span><i className={`legend-square ${color}`}/>{label}</span><strong>{value}</strong></div>; }

function HostTable({ hosts, onSelect }: { hosts: Host[]; onSelect: (host: Host) => void }) { return <div className="table-scroll">{hosts.length === 0 ? <div className="empty-state"><Server size={24}/><strong>No capacity-risk hosts in this scope</strong><span>Dynatrace currently reports all returned hosts below the risk threshold.</span></div> : <table><thead><tr><th>Host name</th><th>Environment</th><th>Host group / application</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Status</th><th>Forecast risk</th></tr></thead><tbody>{hosts.map((host) => { const latest = host.telemetry.at(-1)!; return <tr key={host.id} onClick={() => onSelect(host)}><td><strong className="host-link">{host.name}</strong><small>{host.id}</small></td><td>{host.environment}</td><td>{host.application}</td><td><MetricValue value={latest.cpu}/></td><td><MetricValue value={latest.memory}/></td><td><MetricValue value={latest.disk}/></td><td><StatusBadge value={host.profile}/></td><td><StatusBadge value={getHostRisk(host)}/></td></tr>; })}</tbody></table>}</div>; }
function MetricValue({ value }: { value: number }) { return <span className={value >= 80 ? 'value-high' : value >= 70 ? 'value-medium' : ''}>{Math.round(value)}%</span>; }

function Inventory({ hosts, onSelect }: { hosts: Host[]; onSelect: (host: Host) => void }) { const [query, setQuery] = useState(''); const [risk, setRisk] = useState('All risks'); const filtered = hosts.filter((host) => `${host.name} ${host.application} ${host.environment}`.toLowerCase().includes(query.toLowerCase()) && (risk === 'All risks' || getHostRisk(host) === risk)); return <div className="content"><PageTitle eyebrow="Live infrastructure estate" title="Host inventory"><div className="count-chip"><Server size={15}/>{filtered.length} of {hosts.length} hosts</div></PageTitle><section className="panel table-panel inventory-panel"><div className="filter-row"><div className="search"><Activity size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search host, host group, environment…"/></div><select value={risk} onChange={(event) => setRisk(event.target.value)}><option>All risks</option><option>Low</option><option>Medium</option><option>High</option><option>Critical</option></select><button className="filter-button" onClick={() => { setQuery(''); setRisk('All risks'); }}>Reset</button></div><HostTable hosts={filtered} onSelect={onSelect}/></section></div>; }

function HostDetail({ host, onBack }: { host: Host; onBack: () => void }) {
  type HostDetailMetric = MetricKey | 'throughput';
  const [metric, setMetric] = useState<HostDetailMetric>('cpu');
  const latest = host.telemetry.at(-1)!;
  const metricTitle = metric === 'throughput' ? 'Application Throughput' : metricLabels[metric];
  const series = host.telemetry.map((point) => {
    if (metric === 'network') return (point.networkRx + point.networkTx) / 2;
    if (metric === 'throughput') return point.throughput ?? 0;
    return point[metric];
  });

  return <div className="content"><button className="back-button" onClick={onBack}>← Back to inventory</button><PageTitle eyebrow="Live host detail" title={host.name}><StatusBadge value={host.profile}/></PageTitle><div className="detail-meta"><span><Server size={15}/> {host.environment}</span><span><Database size={15}/> {host.application}</span><span><Activity size={15}/> {host.id}</span></div><section className="metric-strip"><MetricCard label="CPU" value={`${Math.round(latest.cpu)}%`} detail="Current" icon={<Cpu/>}/><MetricCard label="Memory" value={`${Math.round(latest.memory)}%`} detail="Current" icon={<Database/>} tone="teal"/><MetricCard label="Disk" value={`${Math.round(latest.disk)}%`} detail="Current" icon={<HardDrive/>} tone="amber"/><MetricCard label="Network RX / TX" value={`${Math.round(latest.networkRx)}% / ${Math.round(latest.networkTx)}%`} detail="NIC utilization" icon={<Activity/>} tone="green"/><MetricCard label="Service throughput" value={`${Math.round(latest.throughput ?? 0)} req/min`} detail="Application requests" icon={<Activity/>} tone="green"/></section><section className="panel chart-panel"><div className="panel-heading"><div><span className="eyebrow">24-hour live telemetry</span><h2>{metricTitle}</h2></div><select value={metric} onChange={(event) => setMetric(event.target.value as HostDetailMetric)}><option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option><option value="network">Network</option><option value="throughput">Throughput</option></select></div><LineChart values={series} threshold={metric === 'disk' ? 85 : metric === 'throughput' ? undefined : 80}/></section></div>;
}

function Forecast({ hosts }: { hosts: Host[] }) { const [metric, setMetric] = useState<MetricKey>('cpu'); const [horizon, setHorizon] = useState<ForecastHorizon>(30); const results = hosts.map((host) => ({ host, result: forecastMetric(host, metric, horizon) })).sort((a, b) => b.result.current - a.result.current); const risky = results.filter(({ result }) => ['High', 'Critical'].includes(result.risk)); return <div className="content"><PageTitle eyebrow="Predictive capacity planning" title="Capacity forecast"><div className="filter-row"><select value={metric} onChange={(event) => setMetric(event.target.value as MetricKey)}><option value="cpu">CPU</option><option value="memory">Memory</option><option value="disk">Disk</option></select><select value={horizon} onChange={(event) => setHorizon(Number(event.target.value) as ForecastHorizon)}><option value={7}>7 days</option><option value={14}>14 days</option><option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option></select></div></PageTitle><section className="kpi-grid"><MetricCard label="Hosts analysed" value={String(hosts.length)} detail="Live telemetry" icon={<Server/>}/><MetricCard label="Forecast risk" value={String(risky.length)} detail={`${metricLabels[metric]} · ${horizon} days`} icon={<AlertTriangle/>} tone="amber"/><MetricCard label="Current average" value={`${average(hosts, metric === 'network' ? 'cpu' : metric)}%`} detail="Across selected scope" icon={<BarChart3/>}/></section><section className="panel table-panel"><HostTable hosts={risky.slice(0, 25).map(({ host }) => host)} onSelect={() => undefined}/></section></div>; }

function Simulation({ hosts }: { hosts: Host[] }) { const [trafficGrowth, setTrafficGrowth] = useState(20); const [additionalHosts, setAdditionalHosts] = useState(0); const inputs = { cpuCapacity: 80, memoryCapacity: 80, diskCapacity: 85, trafficGrowth, transactionGrowth: trafficGrowth, period: 30 as ForecastHorizon, additionalHosts, cpuPerHost: 25, memoryPerHost: 25, diskPerHost: 20 }; const base = hosts.length ? hosts : []; const avgCpu = average(base, 'cpu'); const avgMemory = average(base, 'memory'); const avgDisk = average(base, 'disk'); const result = runCapacitySimulation({ ...inputs, cpuCapacity: Math.max(1, avgCpu), memoryCapacity: Math.max(1, avgMemory), diskCapacity: Math.max(1, avgDisk) }); const insight = getBusinessInsights(base); return <div className="content"><PageTitle eyebrow="What-if planning" title="Capacity simulation"/><section className="panel simulation-grid"><div><label>Traffic growth <strong>{trafficGrowth}%</strong></label><input type="range" min="0" max="100" value={trafficGrowth} onChange={(event) => setTrafficGrowth(Number(event.target.value))}/><label>Additional hosts <strong>{additionalHosts}</strong></label><input type="range" min="0" max="20" value={additionalHosts} onChange={(event) => setAdditionalHosts(Number(event.target.value))}/></div><div className="simulation-result"><span className="eyebrow">Projected capacity</span><strong>{result.recommendedExpansion} additional hosts</strong><p>{result.risk} risk · capacity gap {result.capacityGap}</p><small>{insight.summary}</small></div></section></div>; }
