import type { Message } from '../types';

/** Older retained summaries appended empty machine metadata to their prose. */
export function messageDisplayText(message: Message, synthesisOutputRefs: ReadonlySet<string>): string {
  if (message.kind !== 'assistant' || !message.sourceMessageId || !synthesisOutputRefs.has(message.sourceMessageId)) return message.text;
  const separator = message.text.lastIndexOf('\n');
  if (separator < 0) return message.text;
  try {
    const metadata: unknown = JSON.parse(message.text.slice(separator + 1));
    const keys = ['alternatives', 'risks', 'disagreements', 'missingParticipants'];
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return message.text;
    const record = metadata as Record<string, unknown>;
    if (Object.keys(record).length !== keys.length || keys.some(key => !Array.isArray(record[key]) || record[key].length !== 0)) return message.text;
    return message.text.slice(0, separator).trimEnd();
  } catch { return message.text; }
}
