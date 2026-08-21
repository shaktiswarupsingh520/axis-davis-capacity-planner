export function installForecastHoverV45() {
  const w = window as Window & { __forecastHoverV45?: boolean };
  if (w.__forecastHoverV45) return;
  w.__forecastHoverV45 = true;
  const refresh = () => {
    document.querySelectorAll<SVGSVGElement>('svg.v45-main-chart').forEach((svg) => {
      if (svg.dataset.hoverV45Installed === '1') return;
      const show = (event: MouseEvent, html: string) => {
        let tip = document.getElementById('forecast-hover-v45') as HTMLElement | null;
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'forecast-hover-v45';
          tip.className = 'chart-hover-tooltip';
          document.body.appendChild(tip);
        }
        tip.innerHTML = html;
        tip.style.display = 'block';
        tip.style.position = 'fixed';
        tip.style.zIndex = '2147483647';
        tip.style.pointerEvents = 'none';
        const width = tip.offsetWidth || 270;
        const height = tip.offsetHeight || 130;
        let left = event.clientX + 16;
        let top = event.clientY - height - 16;
        if (left + width > window.innerWidth) left = event.clientX - width - 16;
        if (top < 8) top = event.clientY + 16;
        tip.style.left = `${Math.max(8, left)}px`;
        tip.style.top = `${Math.max(8, top)}px`;
      };
      const hide = () => {
        const tip = document.getElementById('forecast-hover-v45') as HTMLElement | null;
        if (tip) tip.style.display = 'none';
      };
      const move = (event: MouseEvent) => {
        const box = svg.getBoundingClientRect();
        const view = svg.viewBox.baseVal;
        const histLen = Number(svg.dataset.histLen || 0);
        const forecastLen = Number(svg.dataset.forecastLen || 0);
        const total = Math.max(2, histLen + forecastLen);
        const x = ((event.clientX - box.left) / Math.max(1, box.width)) * view.width;
        const plotLeft = 62;
        const plotRight = view.width - 30;
        const rawIndex = ((x - plotLeft) / Math.max(1, plotRight - plotLeft)) * Math.max(1, total - 1);
        const index = Math.max(0, Math.min(total - 1, Math.round(rawIndex)));
        const startMs = Number(svg.dataset.histStart || Date.now());
        const timestamp = new Date(startMs + index * 86400000).toLocaleString('en-IN');
        const readValue = (className: string) => {
          const polyline = svg.querySelector<SVGPolylineElement>(`polyline.${className}`);
          if (!polyline) return NaN;
          const raw = polyline.getAttribute('points') || '';
          const nums = raw.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
          const isForecast = className.includes('v45-f');
          const offset = isForecast ? histLen - 1 : 0;
          const localIndex = index - offset;
          if (localIndex < 0 || localIndex * 2 + 1 >= nums.length) return NaN;
          const y = nums[localIndex * 2 + 1];
          const plotTop = 38;
          const plotHeight = view.height - 38 - 78;
          return Math.max(0, Math.min(100, (1 - (y - plotTop) / Math.max(1, plotHeight)) * 100));
        };
        show(event, `<strong>Capacity forecast</strong><span>${timestamp}</span><b>CPU: ${Number.isFinite(readValue('v45-cpu')) ? readValue('v45-cpu').toFixed(2) : '—'}%</b><b>Memory: ${Number.isFinite(readValue('v45-memory')) ? readValue('v45-memory').toFixed(2) : '—'}%</b><b>Disk: ${Number.isFinite(readValue('v45-disk')) ? readValue('v45-disk').toFixed(2) : '—'}%</b><small>${index < histLen ? 'Historical telemetry' : `Dynatrace forecast · day ${Math.max(0, index - histLen + 1)}`}</small>`);
      };
      svg.addEventListener('mousemove', move);
      svg.addEventListener('mouseleave', hide);
      svg.dataset.hoverV45Installed = '1';
    });
  };
  const observer = new MutationObserver(() => window.setTimeout(refresh, 80));
  observer.observe(document.body, { subtree: true, childList: true });
  refresh();
}
