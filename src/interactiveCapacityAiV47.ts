import { dynatraceDataProvider } from './realDynatrace';
import { getDynatraceForecasts } from './dynatraceIntelligence';
import { askAgenticDavis, suggestedCapacityQuestions, type CapacityAiContext } from './agenticCapacityAiV50';
import type { TimeRange } from '@/types';

const ID = 'axis-davis-interactive-ai-v47';
const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function installInteractiveCapacityAiV47() {
  if (document.getElementById(ID)) return;
  const root = document.createElement('section');
  root.id = ID;
  root.className = 'panel axis-davis-ai-panel';
  root.innerHTML = `
    <div class="axis-davis-ai-head">
      <div><span class="eyebrow">Davis Intelligence</span><h2>Ask Davis about capacity</h2><p>Ask a question about the currently selected Axis Bank Management Zone. Davis can use live Dynatrace data, generate read-only DQL, execute it, run what-if simulation and synthesize the result.</p></div>
      <span class="axis-davis-ai-badge">Agentic AI</span>
    </div>
    <div class="axis-davis-ai-suggestions">${suggestedCapacityQuestions.slice(0, 4).map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>
    <div class="axis-davis-ai-input"><textarea rows="2" placeholder="Ask Davis: What are the top capacity risks in this Management Zone?"></textarea><button type="button" data-ask>Ask Davis</button></div>
    <div class="axis-davis-ai-status" data-status></div>
    <div class="axis-davis-ai-answer" data-answer hidden></div>`;

  const mount = () => {
    if (document.getElementById(ID)) return;
    const overview = [...document.querySelectorAll('h1')].find((h) => h.textContent?.includes('Capacity at a glance'))?.closest('.content');
    if (!overview) return;
    const anchor = overview.querySelector('.overview-grid');
    if (anchor?.parentElement) anchor.parentElement.insertBefore(root, anchor.nextSibling);
  };
  mount();
  const observer = new MutationObserver(mount);
  observer.observe(document.body, { childList: true, subtree: true });

  const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
  const status = root.querySelector('[data-status]') as HTMLElement;
  const answer = root.querySelector('[data-answer]') as HTMLElement;
  const askButton = root.querySelector('[data-ask]') as HTMLButtonElement;
  root.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((button) => button.addEventListener('click', () => { textarea.value = button.dataset.q ?? ''; textarea.focus(); }));

  const ask = async () => {
    const question = textarea.value.trim();
    if (!question) { status.textContent = 'Enter a capacity-planning question first.'; return; }
    askButton.disabled = true;
    status.textContent = 'Davis is planning the tool chain…';
    answer.hidden = true;
    try {
      const zoneSelect = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent === 'All Management Zones')) as HTMLSelectElement | undefined;
      const zone = zoneSelect?.value || 'All Management Zones';
      const hosts = await dynatraceDataProvider.getHosts(zone, '24h' as TimeRange);
      if (!hosts.length) throw new Error('No hosts are available for the selected Management Zone.');
      status.textContent = `Collecting live context from ${hosts.length} host${hosts.length === 1 ? '' : 's'} in ${zone}…`;
      let forecasts: Awaited<ReturnType<typeof getDynatraceForecasts>> = [];
      try { forecasts = await getDynatraceForecasts(hosts, 'cpu', 30); } catch { forecasts = []; }
      const context: CapacityAiContext = { managementZone: zone, timeRange: '24h', forecastHorizon: 30, hosts, forecasts };
      status.textContent = 'Davis is using Dynatrace tools and synthesizing the evidence…';
      const text = await askAgenticDavis(question, context);
      answer.innerHTML = esc(text).replace(/\n/g, '<br/>');
      answer.hidden = false;
      (window as Window & { __axisDavisLastQa?: { question: string; answer: string } }).__axisDavisLastQa = { question, answer: text };
      window.dispatchEvent(new CustomEvent('axis-davis-answer', { detail: { question, answer: text } }));
      status.textContent = `Agentic Davis assessment · ${new Date().toLocaleTimeString()}`;
    } catch (error) {
      status.textContent = `Davis could not complete the assessment: ${error instanceof Error ? error.message : String(error)}`;
    } finally { askButton.disabled = false; }
  };
  askButton.addEventListener('click', ask);
  textarea.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void ask(); });
}
