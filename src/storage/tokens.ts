import type { Message } from '../types.js';

let _encoder: Awaited<ReturnType<typeof initEncoder>> | null = null;

async function initEncoder() {
  const tiktoken = await import('tiktoken');
  return tiktoken.encoding_for_model('gpt-4o');
}

async function getEncoder() {
  if (!_encoder) {
    _encoder = await initEncoder();
  }
  return _encoder;
}

export async function countTokens(text: string): Promise<number> {
  if (!text) return 0;
  const encoder = await getEncoder();
  return encoder.encode(text).length;
}

export async function countMessagesTokens(messages: Message[]): Promise<number> {
  let total = 0;
  for (const msg of messages) {
    total += await countTokens(msg.content);
    if (msg.toolCalls) {
      for (const tc of msg.toolCalls) {
        total += await countTokens(JSON.stringify(tc.arguments));
      }
    }
  }
  return total;
}

export function freeEncoder(): void {
  if (_encoder) {
    _encoder.free();
    _encoder = null;
  }
}
