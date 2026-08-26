import { useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronRight, Clock3, RefreshCw, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';

type Range = 7 | 15 | 30;
type Zone = { name: string; total: number; active: number; inactive: number };
type User = { name: string; zone: string; lastLogin: string; activeDays: number; logins: number; status: 'Active' | 'Inactive' };

const zones: Zone[] = [
  { name: 'Retail', total: 52, active: 43, inactive: 9 },
  { name: 'Digital', total: 36, active: 30, inactive: 6 },
  { name: 'Payments', total: 29, active: 18, inactive: 11 },
  { name: 'Corporate', total: 41, active: 31, inactive: 10 },
  { name: 'Cards', total: 27, active: 21, inactive: 6 },
];

const users: User[] = [
  { name: 'aditya.sharma', zone: 'Retail', lastLogin: '26 Aug 2026 10:42', activeDays: 7, logins: 21, status: 'Active' },
  { name: 'priya.patel', zone: 'Retail', lastLogin: '26 Aug 2026 09:18', activeDays: 6, logins: 17, status: 'Active' },
  { name: 'rahul.mehta', zone: 'Digital', lastLogin: '25 Aug 2026 16:04', activeDays: 4, logins: 11, status: 'Active' },
  { name: 'sanjay.kumar', zone: 'Payments', lastLogin: '22 Aug 2026 14:32', activeDays: 2, logins: 4, status: 'Active' },
  { name: 'neha.singh', zone: 'Corporate', lastLogin: '—', activeDays: 0, logins: 0, status: 'Inactive' },
];

export default function App() {
  const [range, setRange] = useState<Range>(7);
  const [zone, setZone] = useState<string | null>(null);
  const selectedUsers = useMemo(() => zone ? users.filter((u) => u.zone === zone) : users, [zone]);
  const total = zones.reduce((s, z) => s + z.total, 0);
  const active = zones.reduce((s, z) => s + z.active, 0);
  const inactive = total - active;
  const adoption = Math.round((active / total) * 100);

  return (
    <div className="appShell">
      <header className="header">
        <div>
          <div className="eyebrow">AXIS BANK · DYNATRACE APPENGINE</div>
          <h1>User Adoption</h1>
          <p>Dynatrace login engagement across applications and Management Zones.</p>
        </div>
        <div className="actions">
          <div className="rangePicker">
            {[7, 15, 30].map((d) => <button key={d} className={range === d ? 'active' : ''} onClick={() => setRange(d as Range)}>{d} Days</button>)}
          </div>
          <button className="refresh"><RefreshCw size={16} /></button>
        </div>
      </header>

      <div className="subbar"><span><i className="liveDot" /> Live data integration</span><span><CalendarDays size={13} /> Last {range} days</span><span>Refresh: manual</span></div>

      <section className="metrics">
        <Metric icon={<Users />} title="Total Users" value={total} hint="Configured Dynatrace users" />
        <Metric icon={<UserCheck />} title="Active Users" value={active} hint={`${adoption}% adoption`} />
        <Metric icon={<UserX />} title="Inactive Users" value={inactive} hint="No activity in window" />
        <Metric icon={<Activity />} title="Adoption Rate" value={`${adoption}%`} hint={`Selected: ${range} days`} />
      </section>

      <div className="contentGrid">
        <section className="panel">
          <div className="panelHeader"><div><h2>Management Zone Adoption</h2><p>Click a zone for user-level activity.</p></div><span className="count">{zones.length} zones</span></div>
          <div className="zoneTable">
            <div className="zoneHead"><span>MANAGEMENT ZONE</span><span>USERS</span><span>ACTIVE</span><span>INACTIVE</span><span>ADOPTION</span></div>
            {zones.map((z) => { const pct = Math.round(z.active / z.total * 100); return <button className={`zoneRow ${zone === z.name ? 'selected' : ''}`} key={z.name} onClick={() => setZone(zone === z.name ? null : z.name)}><strong>{z.name}</strong><span>{z.total}</span><span>{z.active}</span><span>{z.inactive}</span><span className="adoption"><b>{pct}%</b><i><em style={{ width: `${pct}%` }} /></i></span><ChevronRight size={15} /></button>; })}
          </div>
        </section>

        <section className="panel signalPanel">
          <div className="panelHeader"><div><h2>Adoption Health</h2><p>Current selected window.</p></div></div>
          <div className="healthRing"><b>{adoption}%</b><span>ADOPTION</span></div>
          <div className="healthStats"><div><strong>{active}</strong><span>Active</span></div><div><strong>{inactive}</strong><span>Inactive</span></div></div>
          <div className="callout"><ShieldCheck size={15} /><span>Production-ready UI foundation. The next data layer will connect the real Axis audit/login records and Management Zone membership.</span></div>
        </section>
      </div>

      <section className="panel detailPanel">
        <div className="panelHeader"><div><h2>{zone ? `${zone} · User Activity` : 'User Activity'}</h2><p>Last login, active days and login events.</p></div><span className="count">{selectedUsers.length} shown</span></div>
        <div className="table"><div className="tableHead"><span>USER</span><span>MANAGEMENT ZONE</span><span>LAST LOGIN</span><span>ACTIVE DAYS</span><span>LOGINS</span><span>STATUS</span></div>
          {selectedUsers.map((u) => <div className="tableRow" key={u.name}><strong>{u.name}</strong><span>{u.zone}</span><span className="login"><Clock3 size={13} />{u.lastLogin}</span><span>{u.activeDays}</span><span>{u.logins}</span><span className={`badge ${u.status.toLowerCase()}`}>{u.status}</span></div>)}
        </div>
      </section>

      <footer>Dynatrace User Adoption · V1 · Axis Bank AppEngine release baseline</footer>
    </div>
  );
}

function Metric({ icon, title, value, hint }: { icon: React.ReactNode; title: string; value: string | number; hint: string }) {
  return <article className="metric"><div className="metricIcon">{icon}</div><span>{title}</span><strong>{value}</strong><small>{hint}</small></article>;
}
