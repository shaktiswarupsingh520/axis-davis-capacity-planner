import { publicClient } from '@dynatrace-sdk/client-davis-copilot';

type ConversationArgs = {
  body?: {
    text?: string;
    context?: Array<{ type?: string; value?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type ConversationFn = (args: ConversationArgs) => Promise<unknown>;

const MAX_TEXT = 9000;
const MAX_SUPPLEMENTARY = 6500;

function trimEvidence(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 180))}\n\n[Evidence truncated by RCA payload guard to remain within Dynatrace Assist request limits.]`;
}

export function installRcaAssistPayloadGuardV60() {
  const client = publicClient as typeof publicClient & { recommenderConversation: ConversationFn };
  const marker = '__axisRcaPayloadGuardV60';
  const guarded = client as typeof client & { [marker]?: boolean };
  if (guarded[marker]) return;

  const original = client.recommenderConversation.bind(client);
  client.recommenderConversation = async (args: ConversationArgs) => {
    const body = args.body ?? {};
    const originalContext = Array.isArray(body.context) ? body.context : [];
    const context = originalContext.map(item => {
      if (item?.type === 'supplementary' && typeof item.value === 'string') {
        return { ...item, value: trimEvidence(item.value, MAX_SUPPLEMENTARY) };
      }
      return item;
    });

    const text = typeof body.text === 'string' ? trimEvidence(body.text, MAX_TEXT) : body.text;
    return original({ ...args, body: { ...body, text, context } });
  };

  guarded[marker] = true;
}
