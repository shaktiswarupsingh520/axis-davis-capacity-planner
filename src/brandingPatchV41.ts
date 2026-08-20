export function installBrandingPatchV41() {
  const win = window as Window & { __axisBrandingPatchV41?: boolean };
  if (win.__axisBrandingPatchV41) return;
  win.__axisBrandingPatchV41 = true;

  const replace = () => {
    const brand = document.querySelector<HTMLElement>('.brand');
    if (!brand) return;
    const walker = document.createTreeWalker(brand, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const value = node.nodeValue;
      if (value && /^\s*AXIS\s*$/.test(value)) {
        node.nodeValue = value.replace('AXIS', 'Dynatrace');
      }
    }
  };

  replace();
  const observer = new MutationObserver(replace);
  observer.observe(document.body, { subtree: true, childList: true });
}
