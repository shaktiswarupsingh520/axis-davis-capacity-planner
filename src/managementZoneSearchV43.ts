import { queryExecutionClient } from '@dynatrace-sdk/client-query';
import { dynatraceDataProvider, type ManagementZoneOption } from './realDynatrace';

interface QueryResult { records?: Array<Record<string, unknown> | null>; }
const win = window as Window & { __axisMzSearchV43?: boolean; __axisMzCatalogV43?: ManagementZoneOption[] };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function executeDql<T>(query: string): Promise<T[]> {
  const response = await queryExecutionClient.queryExecute({
    body: { query, requestTimeoutMilliseconds: 30000, maxResultRecords: 10000 },
  });
  let result = response.result as QueryResult | undefined;
  const token = response.requestToken;
  let state = response.state;
  for (let attempt = 0; !result && token && attempt < 30; attempt += 1) {
    const polled = await queryExecutionClient.queryPoll({ requestToken: token, requestTimeoutMilliseconds: 30000 });
    state = polled.state;
    result = polled.result as QueryResult | undefined;
    if (!result && state === 'RUNNING') await sleep(300);
  }
  if (!result) throw new Error(`Management Zone catalog query did not return a result (state: ${state}).`);
  return (result.records ?? []).filter(Boolean) as T[];
}

async function loadCompleteManagementZoneCatalog(): Promise<ManagementZoneOption[]> {
  // Summarize after expanding the entity field so the result limit applies to unique
  // zones instead of the potentially much larger host×zone intermediate result.
  const query = `fetch dt.entity.host | fields managementZones | expand managementZones | filterOut isNull(managementZones) | summarize hostCount=count(), by:{managementZones} | sort managementZones | fields managementZones`;
  const records = await executeDql<{ managementZones?: unknown }>(query);
  const names = records
    .map((record) => String(record.managementZones ?? '').trim())
    .filter(Boolean);
  return [...new Set(names.map((name) => name))].map((name) => ({ name }));
}

function injectStyles() {
  if (document.getElementById('mz-search-v43-style')) return;
  const style = document.createElement('style');
  style.id = 'mz-search-v43-style';
  style.textContent = `
    .mz-selector.mz-search-v43 { position: relative; min-width: 285px; }
    .mz-search-v43-input { width: 100%; box-sizing: border-box; min-height: 34px; padding: 7px 34px 7px 10px; border: 1px solid #cfd9e6; border-radius: 8px; background: #fff; color: #17365d; font: inherit; outline: none; }
    .mz-search-v43-input:focus { border-color: #4c8dff; box-shadow: 0 0 0 3px rgba(76,141,255,.13); }
    .mz-search-v43-results { position: absolute; z-index: 2147483646; top: calc(100% + 5px); left: 0; right: 0; max-height: 280px; overflow: auto; padding: 5px; border: 1px solid #dbe3ee; border-radius: 10px; background: #fff; box-shadow: 0 14px 32px rgba(15,38,66,.18); }
    .mz-search-v43-option { display: block; width: 100%; padding: 8px 9px; border: 0; border-radius: 7px; background: transparent; text-align: left; color: #17365d; font: inherit; cursor: pointer; }
    .mz-search-v43-option:hover, .mz-search-v43-option.active { background: #eef5ff; }
    .mz-search-v43-empty { padding: 10px; color: #718096; font-size: 12px; }
    .mz-search-v43-native { position: absolute !important; left: -99999px !important; width: 1px !important; height: 1px !important; opacity: 0 !important; pointer-events: none !important; }
    .dark .mz-search-v43-input { background:#172235; border-color:#33465f; color:#e5edf8; }
    .dark .mz-search-v43-results { background:#172235; border-color:#33465f; }
    .dark .mz-search-v43-option { color:#e5edf8; }
    .dark .mz-search-v43-option:hover, .dark .mz-search-v43-option.active { background:#243754; }
  `;
  document.head.appendChild(style);
}

function findManagementZoneField() {
  return [...document.querySelectorAll<HTMLElement>('.top-actions .mz-selector')]
    .find((node) => !node.dataset.segmentLegacy && node.querySelector('span')?.textContent?.trim() === 'Management Zone');
}

function installSearchField() {
  const field = findManagementZoneField();
  const native = field?.querySelector<HTMLSelectElement>('select');
  if (!field || !native || field.dataset.mzSearchInstalled === '1') return;
  field.dataset.mzSearchInstalled = '1';
  field.classList.add('mz-search-v43');
  native.classList.add('mz-search-v43-native');

  const input = document.createElement('input');
  input.className = 'mz-search-v43-input';
  input.type = 'search';
  input.autocomplete = 'off';
  input.placeholder = 'Search management zones...';
  input.setAttribute('aria-label', 'Search management zones');
  input.value = native.selectedOptions[0]?.text ?? 'All Management Zones';

  const results = document.createElement('div');
  results.className = 'mz-search-v43-results';
  results.hidden = true;

  const close = () => { results.hidden = true; };
  const options = () => [...native.options].map((option) => option.text).filter(Boolean);

  const render = () => {
    const term = input.value.trim().toLowerCase();
    const visible = options().filter((name) => !term || name.toLowerCase().includes(term));
    results.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'mz-search-v43-empty';
      empty.textContent = 'No matching management zones';
      results.appendChild(empty);
    } else {
      for (const name of visible.slice(0, 250)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mz-search-v43-option';
        button.textContent = name;
        if (name === native.selectedOptions[0]?.text) button.classList.add('active');
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const option = [...native.options].find((item) => item.text === name);
          if (!option) return;
          native.value = option.value;
          input.value = option.text;
          native.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        results.appendChild(button);
      }
      if (visible.length > 250) {
        const note = document.createElement('div');
        note.className = 'mz-search-v43-empty';
        note.textContent = `Showing first 250 of ${visible.length} matches. Refine your search.`;
        results.appendChild(note);
      }
    }
    results.hidden = false;
  };

  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { input.value = native.selectedOptions[0]?.text ?? ''; close(); }
    if (event.key === 'Enter') {
      const first = results.querySelector<HTMLButtonElement>('.mz-search-v43-option');
      first?.click();
    }
  });
  native.addEventListener('change', () => {
    input.value = native.selectedOptions[0]?.text ?? 'All Management Zones';
  });

  field.append(input, results);
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node) || !field.contains(event.target)) close();
  }, true);
}

export function installManagementZoneSearchV43() {
  if (win.__axisMzSearchV43) return;
  win.__axisMzSearchV43 = true;
  injectStyles();

  const refreshCatalog = async () => {
    try {
      const zones = await loadCompleteManagementZoneCatalog();
      win.__axisMzCatalogV43 = zones;
      const native = findManagementZoneField()?.querySelector<HTMLSelectElement>('select');
      if (native && zones.length) {
        const current = native.value;
        const fragment = document.createDocumentFragment();
        const all = document.createElement('option');
        all.value = 'All Management Zones';
        all.textContent = 'All Management Zones';
        fragment.appendChild(all);
        for (const zone of zones) {
          const option = document.createElement('option');
          option.value = zone.name;
          option.textContent = zone.name;
          fragment.appendChild(option);
        }
        native.replaceChildren(fragment);
        native.value = zones.some((zone) => zone.name === current) ? current : 'All Management Zones';
      }
    } catch (error) {
      console.warn('[MZ][catalog]', error);
    }
    installSearchField();
  };

  const original = dynatraceDataProvider.getManagementZones.bind(dynatraceDataProvider);
  dynatraceDataProvider.getManagementZones = async () => {
    try {
      return await loadCompleteManagementZoneCatalog();
    } catch {
      return original();
    }
  };

  const observer = new MutationObserver(() => installSearchField());
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => void refreshCatalog(), 100);
}
