import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type ProblemRecord = Record<string, unknown>;
interface QueryResult { records?: Array<Record<string, unknown> | null>; }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const text = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('; ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};
const escCsv = (value: unknown) => `"${text(value).replace(/"/g, '""')}"`;
const escHtml = (value: unknown) => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const download = (content: BlobPart, type: string, filename: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

async function executeDql(query: string): Promise<ProblemRecord[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 1000 } });
  let result = response.result as QueryResult | undefined;
  const token = response.requestToken; let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const poll = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = poll.state; result = poll.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`Problem query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as ProblemRecord[];
}

function problemDuration(row: ProblemRecord): string {
  const started = text(row['event.start']);
  const ended = text(row['event.end']);
  const start = new Date(started);
  const end = ended ? new Date(ended) : null;
  if (Number.isNaN(start.getTime())) return '—';
  const endTime = end && !Number.isNaN(end.getTime()) ? end.getTime() : Date.now();
  const minutes = Math.max(0, endTime - start.getTime()) / 60000;
  if (minutes < 60) return `${minutes.toFixed(1)} min`;
  return `${(minutes / 60).toFixed(1)} h`;
}

const COLUMNS = ['Problem ID','Title','Status','Severity','Category','Impact Level','Start Time','End Time','Duration','Affected Entities','Root Cause Entity','Description','Alerting Profile','Duplicate','Maintenance'];
const KEYS = ['display_id','event.name','event.status','event.severity','event.category','dt.davis.impact_level','event.start','event.end','problem.duration','affected_entity_names','root_cause_entity_id','event.description','labels.alerting_profile','dt.davis.is_duplicate','maintenance.is_under_maintenance'];

function rowsForExport(rows: ProblemRecord[]): ProblemRecord[] {
  return rows.map(row => {
    const exportRow: ProblemRecord = { ...row };
    exportRow['problem.duration'] = problemDuration(row);
    return exportRow;
  });
}

function downloadCsv(rows: ProblemRecord[]) {
  const exportRows = rowsForExport(rows);
  const lines = [COLUMNS.map(escCsv).join(','), ...exportRows.map(row => KEYS.map(key => escCsv(row[key])).join(','))];
  download(`\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8', `dynatrace-problem-alert-dump-${new Date().toISOString().slice(0,10)}.csv`);
}
function downloadExcel(rows: ProblemRecord[]) {
  const exportRows = rowsForExport(rows);
  const header = COLUMNS.map(escHtml).map(v => `<th>${v}</th>`).join('');
  const body = exportRows.map(row => `<tr>${KEYS.map(key => `<td>${escHtml(row[key])}</td>`).join('')}</tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>table{border-collapse:collapse;font-family:Arial;font-size:10pt}th{background:#183b63;color:#fff;font-weight:bold;border:1px solid #b8c2cc;padding:7px}td{border:1px solid #d7dde4;padding:6px;vertical-align:top}tr:nth-child(even){background:#f4f7fa}</style></head><body><table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></body></html>`;
  download(`\uFEFF${html}`, 'application/vnd.ms-excel;charset=utf-8', `dynatrace-problem-alert-dump-${new Date().toISOString().slice(0,10)}.xls`);
}

function readTopbarValue(index: number, fallback: string) {
  return Array.from(document.querySelectorAll<HTMLSelectElement>('.top-actions select'))[index]?.value ?? fallback;
}

function buildProblemQuery(range: string, status: string, severity: string, zone: string) {
  const safeRange = ['1h','6h','24h','7d','30d'].includes(range) ? range : '24h';
  const filters = ['not(dt.davis.is_duplicate)'];
  if (status !== 'ALL') filters.push(`event.status == "${status}"`);
  if (severity !== 'ALL') filters.push(`event.severity == ${severity}`);
  let query = `fetch dt.davis.problems, from:now()-${safeRange}, to:now() | filter ${filters.join(' and ')}`;
  if (zone !== 'All Management Zones') {
    const escaped = zone.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    query += `
| expand related_entity_names
| lookup sourceField:related_entity_names, lookupField:entity.name,
  [
    fetch dt.entity.host
    | expand managementZones
    | filter managementZones == "${escaped}"
    | fields entity.name
  ], fields:{zoneHostName=entity.name}
| filter isNotNull(zoneHostName)
| dedup display_id`;
  }
  return `${query} | sort event.start desc | limit 1000`;
}

function severityLabel(value: unknown) {
  const n = Number(value); return Number.isFinite(n) ? `Level ${n}` : text(value) || '—';
}

function createModal() {
  const modal = document.createElement('div'); modal.className = 'alert-dump-modal';
  modal.innerHTML = `<div class="alert-dump-backdrop"></div><section class="alert-dump-card" role="dialog" aria-modal="true">
<header class="alert-dump-header"><div><span class="alert-dump-eyebrow">LIVE DYNATRACE</span><h2>Dynatrace Alert Dump</h2><p>Download Davis Problem records for investigation, reporting and RCA.</p></div><button class="alert-dump-close" aria-label="Close">×</button></header>
<div class="alert-dump-controls"><label>Time range<select class="alert-dump-range"><option value="1h">Last 1 hour</option><option value="6h">Last 6 hours</option><option value="24h" selected>Last 24 hours</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label>
<label>Status<select class="alert-dump-status"><option value="ALL">All</option><option value="ACTIVE">Active</option><option value="CLOSED">Closed</option></select></label>
<label>Severity<select class="alert-dump-severity"><option value="ALL">All severities</option><option value="1">Level 1 — Critical</option><option value="2">Level 2</option><option value="3">Level 3</option><option value="4">Level 4</option><option value="5">Level 5 — Info</option></select></label><button class="alert-dump-load">Load problems</button></div>
<div class="alert-dump-scope"><span>Scope: <strong class="alert-dump-zone">All Management Zones</strong></span><span class="alert-dump-count">0 problems</span></div><div class="alert-dump-message"></div>
<div class="alert-dump-table-wrap"><table class="alert-dump-table"><thead><tr><th>Problem ID</th><th>Title</th><th>Status</th><th>Severity</th><th>Category</th><th>Started</th><th>Duration</th><th>Affected entities</th></tr></thead><tbody><tr><td colspan="8" class="alert-dump-empty">Loading live Davis problems…</td></tr></tbody></table></div>
<footer class="alert-dump-footer"><span>Up to 1,000 unique problems · duplicates excluded</span><div><button class="alert-dump-csv" disabled>Download CSV</button><button class="alert-dump-xls" disabled>Download Excel</button></div></footer></section>`;
  return modal;
}

function installStyles() {
  if (document.getElementById('alert-dump-v54-style')) return;
  const style = document.createElement('style'); style.id = 'alert-dump-v54-style';
  style.textContent = `.alert-dump-modal{position:fixed;inset:0;z-index:10000;font-family:Inter,system-ui,sans-serif}.alert-dump-backdrop{position:absolute;inset:0;background:rgba(7,18,31,.58);backdrop-filter:blur(2px)}.alert-dump-card{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(1180px,calc(100vw - 48px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;background:#fff;border:1px solid #d8e0e8;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.28);overflow:hidden;color:#172334}.alert-dump-header{display:flex;justify-content:space-between;gap:24px;padding:22px 24px 16px;border-bottom:1px solid #e2e8ef}.alert-dump-eyebrow{font-size:11px;font-weight:800;letter-spacing:.12em;color:#1476d4}.alert-dump-header h2{margin:5px 0 3px;font-size:24px}.alert-dump-header p{margin:0;color:#65758a;font-size:13px}.alert-dump-close{border:0;background:#eef3f8;width:34px;height:34px;border-radius:8px;font-size:24px;cursor:pointer}.alert-dump-controls{display:flex;align-items:end;gap:12px;padding:16px 24px;background:#f7f9fb;border-bottom:1px solid #e2e8ef}.alert-dump-controls label{display:flex;flex-direction:column;gap:5px;font-size:11px;font-weight:700;color:#526276}.alert-dump-controls select{height:36px;min-width:150px;border:1px solid #ccd6e1;border-radius:7px;background:#fff;padding:0 10px;color:#172334}.alert-dump-load,.alert-dump-csv,.alert-dump-xls{height:36px;border-radius:7px;padding:0 14px;font-weight:700;cursor:pointer;background:#174a7e;color:#fff;border:0}.alert-dump-load{margin-left:auto}.alert-dump-csv,.alert-dump-xls{background:#fff;color:#174a7e;border:1px solid #b9c8d8}.alert-dump-csv:disabled,.alert-dump-xls:disabled,.alert-dump-load:disabled{opacity:.45;cursor:not-allowed}.alert-dump-scope,.alert-dump-footer{display:flex;justify-content:space-between;align-items:center;padding:10px 24px;font-size:12px;color:#607086}.alert-dump-table-wrap{overflow:auto;min-height:220px;flex:1}.alert-dump-table{width:100%;border-collapse:collapse;font-size:12px}.alert-dump-table th{position:sticky;top:0;background:#edf3f8;color:#34485d;text-align:left;padding:9px 12px;border-bottom:1px solid #cbd6e1;white-space:nowrap}.alert-dump-table td{padding:9px 12px;border-bottom:1px solid #edf0f3;vertical-align:top;max-width:300px}.alert-dump-table tbody tr:hover{background:#f8fbfd}.alert-dump-empty{text-align:center;color:#7b8a9c;padding:36px!important}.alert-dump-status-active{color:#147a55;font-weight:800}.alert-dump-status-closed{color:#6c7785;font-weight:700}.alert-dump-message{display:none;margin:10px 24px;padding:9px 12px;border-radius:7px;background:#fff2f1;color:#a52b20;font-size:12px}.alert-dump-message.show{display:block}.alert-dump-footer{border-top:1px solid #e2e8ef}.alert-dump-footer div{display:flex;gap:8px}.alert-dump-zone{color:#174a7e}`;
  document.head.appendChild(style);
}

function openAlertDump() {
  const existing = document.querySelector('.alert-dump-modal'); if (existing) { existing.remove(); return; }
  installStyles(); const modal = createModal(); document.body.appendChild(modal);
  const rangeSelect = modal.querySelector<HTMLSelectElement>('.alert-dump-range')!;
  rangeSelect.value = readTopbarValue(1, '24h');
  modal.querySelector<HTMLElement>('.alert-dump-zone')!.textContent = readTopbarValue(0, 'All Management Zones');
  const tbody = modal.querySelector('tbody')!; const message = modal.querySelector<HTMLElement>('.alert-dump-message')!;
  const loadButton = modal.querySelector<HTMLButtonElement>('.alert-dump-load')!; const csvButton = modal.querySelector<HTMLButtonElement>('.alert-dump-csv')!; const xlsButton = modal.querySelector<HTMLButtonElement>('.alert-dump-xls')!;
  let rows: ProblemRecord[] = [];
  const render = () => {
    tbody.innerHTML = rows.length ? rows.map(row => {
      const status = text(row['event.status']); const started = text(row['event.start']);
      const start = new Date(started);
      const duration = problemDuration(row);
      return `<tr><td><strong>${escHtml(row.display_id)}</strong></td><td>${escHtml(row['event.name'])}</td><td class="alert-dump-status-${status.toLowerCase()}">${escHtml(status)}</td><td>${escHtml(severityLabel(row['event.severity']))}</td><td>${escHtml(row['event.category'])}</td><td>${Number.isNaN(start.getTime()) ? escHtml(started) : start.toLocaleString()}</td><td>${escHtml(duration)}</td><td>${escHtml(row.affected_entity_names || row.affected_entity_ids)}</td></tr>`;
    }).join('') : '<tr><td colspan="8" class="alert-dump-empty">No problems matched the selected filters.</td></tr>';
    modal.querySelector<HTMLElement>('.alert-dump-count')!.textContent = `${rows.length} problem${rows.length === 1 ? '' : 's'}`; csvButton.disabled = !rows.length; xlsButton.disabled = !rows.length;
  };
  const setMessage = (value: string) => { message.textContent = value; message.classList.toggle('show', Boolean(value)); };
  const load = async () => {
    loadButton.disabled = true; loadButton.textContent = 'Loading…'; setMessage(''); tbody.innerHTML = '<tr><td colspan="8" class="alert-dump-empty">Reading Davis problems from Grail…</td></tr>';
    try {
      const selectedZone = readTopbarValue(0, 'All Management Zones');
      const query = buildProblemQuery(rangeSelect.value, modal.querySelector<HTMLSelectElement>('.alert-dump-status')!.value, modal.querySelector<HTMLSelectElement>('.alert-dump-severity')!.value, selectedZone);
      rows = await executeDql(query); render();
    } catch (error) { rows = []; render(); setMessage(error instanceof Error ? error.message : 'Unable to load Dynatrace problems.'); }
    finally { loadButton.disabled = false; loadButton.textContent = 'Load problems'; }
  };
  modal.querySelector<HTMLButtonElement>('.alert-dump-close')!.onclick = () => modal.remove(); modal.querySelector<HTMLElement>('.alert-dump-backdrop')!.onclick = () => modal.remove();
  loadButton.onclick = () => void load(); csvButton.onclick = () => downloadCsv(rows); xlsButton.onclick = () => downloadExcel(rows); void load();
}

export function installDynatraceAlertDumpV54() {
  const install = () => { const nav = document.querySelector('.sidebar nav'); if (!nav || nav.querySelector('[data-alert-dump-v54]')) return; const button = document.createElement('button'); button.className = 'nav-item'; button.setAttribute('data-alert-dump-v54','true'); button.innerHTML = '<span style="display:inline-flex;align-items:center;justify-content:center;width:18px">⚠</span><span>Dynatrace Alert Dump</span>'; button.addEventListener('click', openAlertDump); nav.appendChild(button); };
  install(); const observer = new MutationObserver(install); observer.observe(document.body, { childList:true, subtree:true }); window.setTimeout(() => observer.disconnect(), 10000);
}
