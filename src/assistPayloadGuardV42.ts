import { publicClient } from '@dynatrace-sdk/client-davis-copilot';

export function installAssistPayloadGuardV42() {
  const win = window as Window & { __axisAssistPayloadGuardV42?: boolean; __axisSegmentDisplayV42?: string };
  if (win.__axisAssistPayloadGuardV42) return;
  win.__axisAssistPayloadGuardV42 = true;
  const client = publicClient as unknown as { recommenderConversation: (config: { body?: { text?: string; [key: string]: unknown }; [key: string]: unknown }) => Promise<unknown> };
  const original = client.recommenderConversation.bind(publicClient);
  client.recommenderConversation = (config) => {
    const body = { ...(config.body ?? {}) };
    const segment = win.__axisSegmentDisplayV42 || 'All Segments';
    let text = String(body.text ?? '');
    text = text.replace(/Management Zone:\s*All Management Zones/g, `Segment: ${segment}`);
    text = text.replace(/Management Zone:/g, 'Segment:');
    if (text.length > 9500) text = `${text.slice(0, 9300)}\n\n[Context truncated to stay within Dynatrace Assist payload limits. Prioritize the supplied aggregate telemetry, forecast, and top-risk hosts.]`;
    body.text = text;
    return original({ ...config, body });
  };
}
