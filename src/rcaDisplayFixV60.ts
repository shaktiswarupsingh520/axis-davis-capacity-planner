const PANEL_ID = 'axis-rca-v60';
const isRcaButton = (el: Element | null) => !!el && /RCA analysis with Davis/i.test((el as HTMLElement).textContent || '');

export function installRcaDisplayFixV60() {
  window.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const button = target?.closest('.axis-usecase-btn');
    if (!isRcaButton(button)) return;
    const panel = document.getElementById(PANEL_ID) as HTMLElement | null;
    if (panel) panel.style.display = 'block';
  }, true);
}
