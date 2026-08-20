import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { SegmentSelector, useSegments } from '@dynatrace/strato-components/filters';
import { queryExecutionClient } from '@dynatrace-sdk/client-query';

type FilterSegment = {
  id: string;
  variables?: Array<{ name: string; values: string[] }>;
};

type QueryConfig = { body?: Record<string, unknown>; [key: string]: unknown };

const win = window as Window & { __axisSegmentQueryPatchV42?: boolean; __axisSegmentsV42?: FilterSegment[] };

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

export default function SegmentScopeV42() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const { segments } = useSegments();

  useEffect(() => {
    installQuerySegmentBridge();
    const find = () => {
      const actions = document.querySelector<HTMLElement>('.top-actions');
      const legacy = actions?.querySelector<HTMLElement>('.mz-selector');
      if (legacy) {
        legacy.dataset.segmentLegacy = 'true';
        legacy.setAttribute('aria-hidden', 'true');
      }
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
    const active = segments
      .filter((segment) => segment && segment.id)
      .map((segment) => ({
        id: segment.id,
        variables: (segment.variables ?? []).map((variable) => ({ name: variable.name, values: variable.values })),
      }));
    win.__axisSegmentsV42 = active;
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]')?.click(), 80);
  }, [segments]);

  if (!target) return null;
  return createPortal(
    <div className="segment-selector-v42">
      <span className="segment-selector-v42-label">Segment</span>
      <SegmentSelector />
    </div>,
    target,
  );
}
