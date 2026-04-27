import type { Message } from '../types.js';

let _encoderPromise: Promise<any> | null = null;

function getEncoder() {
  if (!_encoderPromise) {
    _encoderPromise = (async () => {
      const tiktoken = await import('tiktoken');
      return tiktoken.encoding_for_model('gpt-4o');
    })();
  }
  return _encoderPromise;
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
  if (_encoderPromise) {
    _encoderPromise.then(enc => enc.free()).catch(() => {});
    _encoderPromise = null;
  }
}
