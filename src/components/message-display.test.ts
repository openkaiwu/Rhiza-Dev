import { expect, it } from 'vitest';
import { messageDisplayText } from './message-display';
import type { Message } from '../types';

const suffix = JSON.stringify({ alternatives: [], risks: [], disagreements: [], missingParticipants: [] });
const message: Message = { id: 'retained', nodeId: 'discussion', kind: 'assistant', sourceMessageId: 'synthesis-output', text: `已从支线合并引用：\n\n采用紧凑工作台\n\n${suffix}`, createdAt: '' };

it('keeps the immutable original while making known retained empty metadata optional', () => {
  expect(messageDisplayText(message, new Set(['synthesis-output']))).toBe('已从支线合并引用：\n\n采用紧凑工作台');
  expect(message.text).toContain(suffix);
});

it('preserves ordinary JSON answers and unverified source references verbatim', () => {
  expect(messageDisplayText({ ...message, sourceMessageId: undefined }, new Set(['synthesis-output']))).toBe(message.text);
  expect(messageDisplayText(message, new Set(['another-output']))).toBe(message.text);
});

it('never hides risks, missing participants, unknown fields, or malformed metadata', () => {
  for (const metadata of [{ alternatives: [], risks: ['Review permissions'], disagreements: [], missingParticipants: [] }, { alternatives: [], risks: [], disagreements: [], missingParticipants: ['B'] }, { alternatives: [], risks: [], disagreements: [], missingParticipants: [], extra: [] }, '{incomplete']) {
    const original = { ...message, text: `Known advice\n${typeof metadata === 'string' ? metadata : JSON.stringify(metadata)}` };
    expect(messageDisplayText(original, new Set(['synthesis-output']))).toBe(original.text);
  }
});
