import { publicClient } from '@dynatrace-sdk/client-davis-copilot';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

const STYLE_ID = 'axis-usecase-workbench-v48-style';
const PANEL_ID = 'axis-usecase-workbench-v48';
const CHAT_ID = 'axis-ai-chat-v48';
const MAX_PROMPT = 9000;

type AnyRecord = Record<string, unknown>;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function dql(query: string): Promise<AnyRecord[]> {
  const response = await queryExecutionClient.queryExecute({ body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 500 } });
  let result = response.result as { records?: Array<AnyRecord | null> } | undefined;
  let token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 20; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as { records?: Array<AnyRecord | null> } | undefined;
    if (!result && state === 'RUNNING') await sleep(350);
  }
  if (!result) throw new Error(`DQL did not complete (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as AnyRecord[];
}

function injectStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .axis-usecase-group{margin:14px 10px 0;padding-top:12px;border-top:1px solid rgba(255,255,255,.10)}
    .axis-usecase-title{font-size:9px;color:#8fa5c0;text-transform:uppercase;letter-spacing:.09em;margin:0 8px 7px}
    .axis-usecase-btn{width:100%;display:flex;align-items:center;gap:9px;padding:9px 9px;margin:3px 0;border:1px solid transparent;border-radius:8px;background:transparent;color:#c9d6e8;font-size:10px;text-align:left;cursor:pointer}
    .axis-usecase-btn:hover{background:#193555;border-color:#2c4c6d;color:#fff}.axis-usecase-btn.active{background:#1c3d62;border-color:#2d638f;color:#fff}
    .axis-usecase-icon{width:22px;height:22px;display:grid;place-items:center;border-radius:6px;background:#203f62;color:#7fb8ff;font-size:11px}
    #${PANEL_ID}{margin:18px 0}.uc-panel{background:#fff;border:1px solid #dce5ef;border-radius:14px;padding:18px;box-shadow:0 8px 24px rgba(18,42,71,.06)}
    .dark .uc-panel{background:#172235;border-color:#33465f;color:#e5edf8}.uc-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.uc-title{font-size:18px;font-weight:800;color:#17365d}.dark .uc-title{color:#e5edf8}.uc-sub{font-size:11px;color:#6d7d91;line-height:1.5;margin-top:4px}.dark .uc-sub{color:#b9c7d8}.uc-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:16px 0}.uc-tab{border:1px solid #d5e0eb;background:#f7f9fc;border-radius:8px;padding:7px 10px;font-size:11px;cursor:pointer;color:#42566f}.uc-tab.active{background:#173b62;color:#fff;border-color:#173b62}.uc-form{display:grid;grid-template-columns:1fr auto;gap:10px;margin-top:14px}.uc-input,.uc-select,.uc-textarea{width:100%;box-sizing:border-box;border:1px solid #cfdbe8;border-radius:8px;padding:9px;font-size:11px;background:#fff;color:#17365d}.dark .uc-input,.dark .uc-select,.dark .uc-textarea{background:#111827;color:#e5edf8;border-color:#33465f}.uc-btn{border:0;border-radius:8px;padding:9px 13px;background:#2f78df;color:#fff;font-size:11px;font-weight:700;cursor:pointer}.uc-btn.secondary{background:#eef3f8;color:#17365d}.uc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}.uc-kpi{border:1px solid #e4ebf2;border-radius:9px;padding:11px;background:#f9fbfd}.dark .uc-kpi{background:#111827;border-color:#33465f}.uc-kpi small{display:block;font-size:9px;color:#718096}.uc-kpi strong{display:block;margin-top:4px;font-size:17px;color:#17365d}.dark .uc-kpi strong{color:#e5edf8}.uc-table{overflow:auto;margin-top:14px}.uc-table table{width:100%;border-collapse:collapse;font-size:10px}.uc-table th,.uc-table td{padding:8px;border-bottom:1px solid #e8eef4;text-align:left}.dark .uc-table th,.dark .uc-table td{border-color:#33465f}.uc-code{margin-top:12px;padding:12px;border-radius:8px;background:#0f1f33;color:#d8e6f8;font:10px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;max-height:240px;overflow:auto}.uc-chat{position:fixed;right:24px;bottom:72px;width:390px;max-height:72vh;z-index:10000;background:#fff;border:1px solid #d8e2ec;border-radius:14px;box-shadow:0 20px 50px rgba(18,42,71,.24);display:flex;flex-direction:column}.dark .uc-chat{background:#172235;border-color:#33465f}.uc-chat-head{padding:12px 14px;border-bottom:1px solid #e4ebf2;display:flex;justify-content:space-between;align-items:center}.dark .uc-chat-head{border-color:#33465f}.uc-chat-title{font-weight:800;font-size:13px;color:#17365d}.dark .uc-chat-title{color:#e5edf8}.uc-chat-body{padding:12px;overflow:auto;min-height:160px;max-height:47vh}.uc-msg{padding:9px 11px;border-radius:9px;margin:6px 0;font-size:11px;line-height:1.45;white-space:pre-wrap}.uc-msg.user{background:#edf4fc;margin-left:34px}.uc-msg.ai{background:#f7f9fb;margin-right:18px}.dark .uc-msg.user{background:#203d60}.dark .uc-msg.ai{background:#111827}.uc-chat-form{display:grid;grid-template-columns:1fr auto;gap:7px;padding:10px;border-top:1px solid #e4ebf2}.dark .uc-chat-form{border-color:#33465f}.uc-chat-btn{border:0;border-radius:8px;background:#2f78df;color:#fff;padding:8px 10px;font-size:10px;font-weight:700}.ai-chat-open{border:1px solid #bcd2eb;border-radius:8px;background:#edf5fe;color:#173b62;padding:7px 10px;font-size:10px;font-weight:700;cursor:pointer}.dark .ai-chat-open{background:#203d60;color:#e5edf8;border-color:#355d86}
    @media(max-width:900px){.uc-grid{grid-template-columns:repeat(2,1fr)}.uc-chat{left:12px;right:12px;width:auto}}
  `;
  document.head.appendChild(style);
}

function currentScope() {
  const selects = [...document.querySelectorAll<HTMLSelectElement>('.top-actions select')];
  return {
    zone: selects.find((s) => /All Management Zones|Management Zone/i.test(s.value || ''))?.value || 'All Management Zones',
    range: selects.find((s) => ['1h','6h','24h','7d','30d'].includes(s.value))?.value || '24h',
    horizon: Number(selects.find((s) => ['7','14','30','60','90'].includes(s.value))?.value || 30),
  };
}

function visibleContext() {
  const text = document.body.innerText.replace(/\s+/g, ' ').trim();
  const scope = currentScope();
  const clipped = text.length > 6500 ? `${text.slice(0, 6200)}\n[UI context clipped]` : text;
  return `Current scope: ${scope.zone}\nCurrent data range: ${scope.range}\nForecast horizon: ${scope.horizon} days\nVisible application context:\n${clipped}`;
}

async function askAssist(question: string, context: string) {
  const prompt = `You are the interactive capacity-planning assistant inside a Dynatrace enterprise application. Answer questions about the CURRENT forecast, simulation, host inventory, capacity, and SRE planning context supplied below. Use only supplied context and explicitly say when a value is not present. Never invent telemetry or forecast numbers. Keep answers concise and decision-oriented.\n\n${context}\n\nUser question: ${question}`;
  const safe = prompt.length <= MAX_PROMPT ? prompt : `${prompt.slice(0, MAX_PROMPT - 220)}\n\nKeep the response concise and use only supplied context.`;
  const response = await publicClient.recommenderConversation({ body: { text: safe, context: [{ type: 'instruction', value: 'Answer plain text. Use bullets where useful. Do not expose internal reasoning.' }] } });
  const text = (response as unknown as { text?: string }).text?.trim();
  if (!text) throw new Error('Dynatrace Assist returned an empty response.');
  return text;
}

function mountChat() {
  if (document.getElementById(CHAT_ID)) return;
  const chat = document.createElement('section'); chat.id = CHAT_ID; chat.className = 'uc-chat';
  chat.innerHTML = `<div class="uc-chat-head"><div><div class="uc-chat-title">Davis Capacity Copilot</div><div class="uc-sub">Ask about live forecast or simulation context</div></div><button class="uc-btn secondary" id="uc-chat-close">×</button></div><div class="uc-chat-body" id="uc-chat-body"><div class="uc-msg ai">Ask me things like “Which resource is the main capacity risk?” or “What happens at +30% traffic in 90 days?”</div></div><div class="uc-chat-form"><input class="uc-input" id="uc-chat-input" placeholder="Ask about forecast or simulation…"/><button class="uc-chat-btn" id="uc-chat-send">Ask</button></div>`;
  document.body.appendChild(chat);
  const body = chat.querySelector<HTMLElement>('#uc-chat-body'); const input = chat.querySelector<HTMLInputElement>('#uc-chat-input');
  const send = async () => { const q = input?.value.trim(); if (!q || !body) return; body.insertAdjacentHTML('beforeend', `<div class="uc-msg user">${escapeHtml(q)}</div><div class="uc-msg ai" data-loading="1">Thinking…</div>`); if (input) input.value = ''; body.scrollTop = body.scrollHeight; try { const answer = await askAssist(q, visibleContext()); const loading = body.querySelector<HTMLElement>('[data-loading="1"]'); if (loading) { loading.removeAttribute('data-loading'); loading.textContent = answer; } } catch (error) { const loading = body.querySelector<HTMLElement>('[data-loading="1"]'); if (loading) { loading.removeAttribute('data-loading'); loading.textContent = `Davis Assist unavailable: ${error instanceof Error ? error.message : String(error)}`; } } body.scrollTop = body.scrollHeight; };
  chat.querySelector('#uc-chat-send')?.addEventListener('click', () => void send());
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') void send(); });
  chat.querySelector('#uc-chat-close')?.addEventListener('click', () => chat.remove());
}

function openPanel(title: string, subtitle: string, content: string) {
  const root = document.querySelector<HTMLElement>('.content'); if (!root) return;
  let panel = document.getElementById(PANEL_ID) as HTMLElement | null;
  if (!panel) { panel = document.createElement('section'); panel.id = PANEL_ID; root.prepend(panel); }
  panel.innerHTML = `<div class="uc-panel"><div class="uc-head"><div><div class="uc-title">${escapeHtml(title)}</div><div class="uc-sub">${escapeHtml(subtitle)}</div></div><button class="uc-btn secondary" id="uc-close-panel">Close</button></div>${content}</div>`;
  panel.querySelector('#uc-close-panel')?.addEventListener('click', () => panel?.remove());
}

async function alertDump() {
  const scope = currentScope();
  try {
    const rows = await dql(`fetch events, from:now()-${scope.range}, to:now() | fieldsAdd event.type, event.category, event.name, event.status, timestamp, dt.entity.host | sort timestamp desc | limit 120`);
    const items = rows.map((r) => `<tr><td>${escapeHtml(String(r.timestamp ?? ''))}</td><td>${escapeHtml(String(r['event.category'] ?? ''))}</td><td>${escapeHtml(String(r['event.type'] ?? ''))}</td><td>${escapeHtml(String(r['event.name'] ?? ''))}</td><td>${escapeHtml(String(r['event.status'] ?? ''))}</td><td>${escapeHtml(String(r['dt.entity.host'] ?? ''))}</td></tr>`).join('');
    openPanel('Dynatrace Alert Dump','Operational event/alert extract for the selected scope and time range.',`<div class="uc-grid"><div class="uc-kpi"><small>Scope</small><strong>${escapeHtml(scope.zone)}</strong></div><div class="uc-kpi"><small>Window</small><strong>${escapeHtml(scope.range)}</strong></div><div class="uc-kpi"><small>Rows</small><strong>${rows.length}</strong></div><div class="uc-kpi"><small>Export</small><strong>CSV-ready</strong></div></div><div class="uc-table"><table><thead><tr><th>Timestamp</th><th>Category</th><th>Type</th><th>Name</th><th>Status</th><th>Host</th></tr></thead><tbody>${items || '<tr><td colspan="6">No events returned for this scope.</td></tr>'}</tbody></table></div>`);
  } catch (error) {
    openPanel('Dynatrace Alert Dump','The live event query could not be completed.',`<div class="uc-sub">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`);
  }
}

function rcaWorkbench() {
  openPanel('RCA analysis with Davis','Paste the Problem summary, evidence, or incident notes and let Davis turn it into an evidence-based RCA.',`<div class="uc-form"><textarea id="uc-rca-input" class="uc-textarea" rows="8" placeholder="Paste problem title, impact, timestamps, symptoms, suspected services, error messages, or investigation notes…"></textarea><button class="uc-btn" id="uc-rca-run">Analyze</button></div><div id="uc-rca-output" class="uc-sub" style="margin-top:12px">RCA output will appear here. The assistant will not invent evidence that is not supplied.</div>`);
  panelBindRca();
}

function panelBindRca() {
  const input = document.querySelector<HTMLTextAreaElement>('#uc-rca-input'); const output = document.querySelector<HTMLElement>('#uc-rca-output');
  document.querySelector('#uc-rca-run')?.addEventListener('click', async () => { if (!input || !output || !input.value.trim()) return; output.textContent = 'Davis is analyzing the supplied incident evidence…'; try { output.textContent = await askAssist(`Perform an RCA analysis. Identify probable cause, contributing factors, evidence gaps, validation steps, and recommended actions.\nIncident evidence:\n${input.value}`, visibleContext()); } catch (error) { output.textContent = `Davis Assist unavailable: ${error instanceof Error ? error.message : String(error)}`; } });
}

function sloSliWorkbench() {
  openPanel('SLO / SLI simulations & forecasting','Model reliability targets, error budget and what-if traffic/load scenarios before changing production capacity.',`<div class="uc-grid"><div class="uc-kpi"><small>Availability target</small><strong><input class="uc-input" id="slo-avail" value="99.9"/></strong></div><div class="uc-kpi"><small>Latency target (ms)</small><strong><input class="uc-input" id="slo-latency" value="500"/></strong></div><div class="uc-kpi"><small>Current monthly minutes</small><strong><input class="uc-input" id="slo-mins" value="43200"/></strong></div><div class="uc-kpi"><small>Traffic growth %</small><strong><input class="uc-input" id="slo-growth" value="20"/></strong></div></div><div class="uc-form"><button class="uc-btn" id="uc-slo-run">Simulate reliability scenario</button><div id="uc-slo-output" class="uc-sub">Configure targets and run the simulation.</div></div>`);
  document.querySelector('#uc-slo-run')?.addEventListener('click', () => { const avail = Number((document.querySelector('#slo-avail') as HTMLInputElement)?.value || 99.9); const mins = Number((document.querySelector('#slo-mins') as HTMLInputElement)?.value || 43200); const growth = Number((document.querySelector('#slo-growth') as HTMLInputElement)?.value || 20); const budget = mins * (1 - avail / 100); const projectedLoad = (100 + growth) / 100; const out = document.querySelector<HTMLElement>('#uc-slo-output'); if (!out) return; out.innerHTML = `<div class="uc-grid"><div class="uc-kpi"><small>Error budget / period</small><strong>${budget.toFixed(2)} min</strong></div><div class="uc-kpi"><small>Traffic multiplier</small><strong>${projectedLoad.toFixed(2)}×</strong></div><div class="uc-kpi"><small>Reliability posture</small><strong>${avail >= 99.95 ? 'Strict' : avail >= 99.9 ? 'Standard' : 'Relaxed'}</strong></div><div class="uc-kpi"><small>Capacity implication</small><strong>${growth >= 30 ? 'Review now' : 'Monitor'}</strong></div></div><div class="uc-sub" style="margin-top:10px">Use this as a planning simulation. It does not change the live SLO configuration.</div>`; });
}

function mountButtons() {
  const nav = document.querySelector('aside.sidebar nav'); if (!nav || document.querySelector('.axis-usecase-group')) return;
  const group = document.createElement('div'); group.className = 'axis-usecase-group';
  group.innerHTML = `<div class="axis-usecase-title">SRE Use Cases</div><button class="axis-usecase-btn" data-usecase="alerts"><span class="axis-usecase-icon">A</span>Dynatrace Alert Dump</button><button class="axis-usecase-btn" data-usecase="rca"><span class="axis-usecase-icon">R</span>RCA analysis with Davis</button><button class="axis-usecase-btn" data-usecase="slo"><span class="axis-usecase-icon">S</span>SLO / SLI simulations</button><button class="axis-usecase-btn" data-usecase="chat"><span class="axis-usecase-icon">✦</span>Davis Capacity Copilot</button>`;
  nav.after(group);
  group.querySelectorAll<HTMLButtonElement>('[data-usecase]').forEach((button) => button.addEventListener('click', () => { group.querySelectorAll('.axis-usecase-btn').forEach((b) => b.classList.remove('active')); button.classList.add('active'); const key = button.dataset.usecase; if (key === 'alerts') void alertDump(); else if (key === 'rca') rcaWorkbench(); else if (key === 'slo') sloSliWorkbench(); else mountChat(); }));
}

export function installUseCaseWorkbenchV48() {
  const win = window as Window & { __axisUseCaseWorkbenchV48?: boolean };
  if (win.__axisUseCaseWorkbenchV48) return;
  win.__axisUseCaseWorkbenchV48 = true;
  injectStyle();
  mountButtons();
  window.setInterval(mountButtons, 1200);
  document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('#uc-chat-open')) mountChat(); });
  document.addEventListener('click', (event) => { if (event.target instanceof Element && event.target.closest('.pdf-report-button')) setTimeout(() => window.dispatchEvent(new CustomEvent('axis-report-context-refresh')), 300); });
}
