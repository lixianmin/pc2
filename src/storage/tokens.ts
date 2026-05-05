import type { Message } from '../types.js';
import { logo } from '../lib/logo.js';

let _encoderPromise: Promise<any> | null = null;

function getEncoder() {
  if (!_encoderPromise) {
    _encoderPromise = (async () => {
      const tiktoken = await import('tiktoken');
      const enc = tiktoken.encoding_for_model('gpt-4o');
      logo.debug('tiktoken encoder initialized');
      return enc;
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
    const obj: Record<string, unknown> = {
      role: msg.role,
      content: msg.content,
    };
    if (msg.toolCalls) {
      obj.tool_calls = msg.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    if (msg.toolCallId) {
      obj.tool_call_id = msg.toolCallId;
    }
    total += await countTokens(JSON.stringify(obj));
  }
  return total;
}

export function freeEncoder(): void {
  if (_encoderPromise) {
    _encoderPromise.then(enc => enc.free()).catch(() => {});
    _encoderPromise = null;
  }
}
