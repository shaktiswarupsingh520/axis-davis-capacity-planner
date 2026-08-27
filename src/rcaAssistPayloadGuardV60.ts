import { publicClient } from '@dynatrace-sdk/client-davis-copilot';

const MAX_TEXT = 9000;
const MAX_SUPPLEMENTARY = 6500;

type Client = typeof publicClient;
type ConversationConfig = Parameters<Client['recommenderConversation']>[0];

type GuardedClient = Client & {
  __axisRcaPayloadGuardV60?: boolean;
};

function trimEvidence(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 180))}\n\n[Evidence truncated by RCA payload guard to remain within Dynatrace Assist request limits.]`;
}

export function installRcaAssistPayloadGuardV60() {
  const client = publicClient as GuardedClient;
  if (client.__axisRcaPayloadGuardV60) return;

  const original = client.recommenderConversation.bind(client);
  client.recommenderConversation = async (args: ConversationConfig) => {
    const body = args.body;
    const context = body.context?.map(item => {
      if (item.type === 'supplementary' && typeof item.value === 'string') {
        return { ...item, value: trimEvidence(item.value, MAX_SUPPLEMENTARY) };
      }
      return item;
    });
    const text = typeof body.text === 'string' ? trimEvidence(body.text, MAX_TEXT) : body.text;

    return original({
      ...args,
      body: {
        ...body,
        text,
        ...(context ? { context } : {})
      }
    });
  };

  client.__axisRcaPayloadGuardV60 = true;
}
