import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SegmentSelector, useSegments } from '@dynatrace/strato-components/filters';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type FilterSegment = { id: string; variables?: Array<{ name: string; values: string[] }>; name?: string };
type QueryConfig = { body?: Record<string, unknown>; [key: string]: unknown };
const win = window as Window & { __axisSegmentQueryPatchV42?: boolean; __axisSegmentsV42?: Array<{ id: string; variables?: Array<{ name: string; values: string[] }> }>; __axisSegmentDisplayV42?: string };

function installQuerySegmentBridge() {
  if (win.__axisSegmentQueryPatchV42) return;
  win.__axisSegmentQueryPatchV42 = true;
  const client = queryExecutionClient as unknown as { queryExecute: (config: QueryConfig) => Promise<unknown> };
  const original = client.queryExecute.bind(queryExecutionClient);
  client.queryExecute = (config: QueryConfig) => {
    const segments = win.__axisSegmentsV42 ?? [];
    const body = { ...(config.body ?? {}) };
    if (segments.length) body.filterSegments = segments;
    else delete body.filterSegments;
    return original({ ...config, body });
  };
}

function installStyles() {
  if (document.getElementById('segment-selector-v42-style')) return;
  const style = document.createElement('style');
  style.id = 'segment-selector-v42-style';
  style.textContent = `.mz-selector[data-segment-legacy="true"]{display:none!important}.segment-selector-v42-host{display:flex;align-items:center}.segment-selector-v42{display:flex;align-items:center;gap:8px}.segment-selector-v42-label{font-size:11px;color:var(--dt-colors-text-secondary,#6b7280);font-weight:600;white-space:nowrap}.segment-selector-v42 button{min-width:190px}`;
  document.head.appendChild(style);
}

export default function SegmentScopeV42() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const { segments } = useSegments();

  useEffect(() => {
    installQuerySegmentBridge();
    installStyles();
    const find = () => {
      const actions = document.querySelector<HTMLElement>('.top-actions');
      const legacy = actions?.querySelector<HTMLElement>('.mz-selector');
      if (legacy) { legacy.dataset.segmentLegacy = 'true'; legacy.setAttribute('aria-hidden', 'true'); }
      if (!target && actions) {
        const host = document.createElement('div');
        host.className = 'segment-selector-v42-host';
        actions.prepend(host);
        setTarget(host);
      }
    };
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [target]);

  useEffect(() => {
    const raw = segments as unknown as FilterSegment[];
    win.__axisSegmentsV42 = raw.filter((segment) => segment?.id).map((segment) => ({ id: segment.id, variables: (segment.variables ?? []).map((variable) => ({ name: variable.name, values: variable.values })) }));
    win.__axisSegmentDisplayV42 = raw.map((segment) => segment.name).filter(Boolean).join(', ') || 'All Segments';
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.click(), 80);
  }, [segments]);

  if (!target) return null;
  return createPortal(<div className="segment-selector-v42"><span className="segment-selector-v42-label">Segment</span><SegmentSelector /></div>, target);
}
