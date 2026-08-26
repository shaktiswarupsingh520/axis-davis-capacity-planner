import { useEffect, useMemo, useState } from 'react';
import { Activity, CalendarDays, ChevronRight, Clock3, RefreshCw, ShieldCheck, UserCheck, UserX, Users } from 'lucide-react';
import { buildDailyActivity, buildUserActivity, fetchLoginEvents, type UserActivity } from './services/dynatraceUserAdoption';

type Range = 7 | 15 | 30;
type Zone = { name: string; total: number; active: number; inactive: number };

const zoneNames = ['Retail', 'Digital', 'Payments', 'Corporate', 'Cards'];

export default function App() {
  const [range, setRange] = useState<Range>(7);
  const [zone, setZone] = useState<string | null>(null);
  const [users, setUsers] = useState<UserActivity[]>([]);
  const [daily, setDaily] = useState<{ date: string; activeUsers: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async (selectedRange = range) => {
    setLoading(true);
    setError('');
    try {
      const events = await fetchLoginEvents(selectedRange);
      setUsers(buildUserActivity(events));
      setDaily(buildDailyActivity(events));
    } catch (err) {
      console.error(err);
      setError('Dynatrace login data could not be loaded. Verify the app has the required Grail audit-event permissions and that dt.system.events is available in this environment.');
      setUsers([]);
      setDaily([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [range]);

  const active = users.filter((u) => u.status === 'Active').length;
  const inactive = users.length - active;
  const adoption = users.length ? Math.round((active / users.length) * 100) : 0;
  const selectedUsers = useMemo(() => zone ? users.filter((u) => u.zone === zone) : users, [users, zone]);
  const zones = useMemo<Zone[]>(() => zoneNames.map((name) => {
    const zoneUsers = users.filter((u) => u.zone === name);
    return { name, total: zoneUsers.length, active: zoneUsers.filter((u) => u.status === 'Active').length, inactive: zoneUsers.filter((u) => u.status === 'Inactive').length };
  }), [users]);

  return (
    <div className="appShell">
      <header className="header">
        <div><div className="eyebrow">AXIS BANK · DYNATRACE APPENGINE</div><h1>User Adoption</h1><p>Live Dynatrace login engagement across applications and Management Zones.</p></div>
        <div className="actions"><div className="rangePicker">{[7, 15, 30].map((d) => <button key={d} className={range === d ? 'active' : ''} onClick={() => setRange(d as Range)}>{d} Days</button>)}</div><button className="refresh" onClick={() => void load()}><RefreshCw size={16} className={loading ? 'spin' : ''} /></button></div>
      </header>

      <div className="subbar"><span><i className="liveDot" /> {loading ? 'Querying Grail…' : 'Live Dynatrace data'}</span><span><CalendarDays size={13} /> Last {range} days</span><span>{daily.length} days with activity</span></div>
      {error && <div className="error"><b>Live data error</b><span>{error}</span></div>}

      <section className="metrics"><Metric icon={<Users />} title="Active Users" value={active} hint={`${users.length} unique users found`} /><Metric icon={<UserCheck />} title="Adoption Rate" value={`${adoption}%`} hint={`Selected: ${range} days`} /><Metric icon={<UserX />} title="Inactive Users" value={inactive} hint="No login in selected window" /><Metric icon={<Activity />} title="Daily Active Users" value={daily.at(-1)?.activeUsers ?? 0} hint="Latest activity day" /></section>

      <div className="contentGrid">
        <section className="panel"><div className="panelHeader"><div><h2>Management Zone Adoption</h2><p>Real user records are loaded from Grail; zone enrichment follows next.</p></div><span className="count">{zones.length} zones</span></div>
          <div className="zoneTable"><div className="zoneHead"><span>MANAGEMENT ZONE</span><span>USERS</span><span>ACTIVE</span><span>INACTIVE</span><span>ADOPTION</span></div>
            {zones.map((z) => { const pct = z.total ? Math.round(z.active / z.total * 100) : 0; return <button className={`zoneRow ${zone === z.name ? 'selected' : ''}`} key={z.name} onClick={() => setZone(zone === z.name ? null : z.name)}><strong>{z.name}</strong><span>{z.total}</span><span>{z.active}</span><span>{z.inactive}</span><span className="adoption"><b>{pct}%</b><i><em style={{ width: `${pct}%` }} /></i></span><ChevronRight size={15} /></button>; })}
          </div>
        </section>

        <section className="panel signalPanel"><div className="panelHeader"><div><h2>Adoption Health</h2><p>Current live query window.</p></div></div><div className="healthRing"><b>{adoption}%</b><span>ADOPTION</span></div><div className="healthStats"><div><strong>{active}</strong><span>Active</span></div><div><strong>{inactive}</strong><span>Inactive</span></div></div><div className="callout"><ShieldCheck size={15} /><span>{loading ? 'Loading live audit activity…' : 'Live Grail audit/login provider connected.'}</span></div></section>
      </div>

      <section className="panel detailPanel"><div className="panelHeader"><div><h2>{zone ? `${zone} · User Activity` : 'User Activity'}</h2><p>Last login, active days and login events from the selected window.</p></div><span className="count">{selectedUsers.length} shown</span></div>
        <div className="table"><div className="tableHead"><span>USER</span><span>MANAGEMENT ZONE</span><span>LAST LOGIN</span><span>ACTIVE DAYS</span><span>LOGINS</span><span>STATUS</span></div>
          {selectedUsers.slice(0, 250).map((u) => <div className="tableRow" key={u.userId}><strong>{u.userName}</strong><span>{u.zone}</span><span className="login"><Clock3 size={13} />{u.lastLogin || '—'}</span><span>{u.activeDays}</span><span>{u.logins}</span><span className={`badge ${u.status.toLowerCase()}`}>{u.status}</span></div>)}
          {!loading && !selectedUsers.length && <div className="empty">No login events were returned for this period.</div>}
        </div>
      </section>
      <footer>Dynatrace User Adoption · Phase 1 · Real Grail audit/login integration</footer>
    </div>
  );
}

function Metric({ icon, title, value, hint }: { icon: React.ReactNode; title: string; value: string | number; hint: string }) { return <article className="metric"><div className="metricIcon">{icon}</div><span>{title}</span><strong>{value}</strong><small>{hint}</small></article>; }
