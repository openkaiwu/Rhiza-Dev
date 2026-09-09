import { randomBytes } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { openContent, sealContent } from './sealed-content';

it('clears temporary plaintext on authentication failure and after a successful copy', () => {
  const identity = { workspaceId: 'workspace-a', contentId: 'resource-a' };
  const key = randomBytes(32);
  const original = Buffer.from('private authenticated content');
  const sealed = sealContent(identity, original, key);
  const invalid = { ...sealed, tag: Buffer.from(sealed.tag) };
  invalid.tag[0] ^= 1;
  const fill = vi.spyOn(Buffer.prototype, 'fill');
  try {
    expect(() => openContent(identity, invalid, key)).toThrow();
    const rejected = fill.mock.contexts.filter(buffer => buffer.length === original.length);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].every((byte: number) => byte === 0)).toBe(true);
    fill.mockClear();
    const opened = openContent(identity, sealed, key);
    expect(opened).toEqual(original);
    const cleared = fill.mock.contexts.filter(buffer => buffer.length === original.length);
    expect(cleared).toHaveLength(1);
    expect(cleared[0]).not.toBe(opened);
    expect(cleared[0].every((byte: number) => byte === 0)).toBe(true);
    expect(original.toString()).toBe('private authenticated content');
  } finally { fill.mockRestore(); }
});

it('authenticates content identity, bytes and key before returning plaintext', () => {
  const identity = { workspaceId: 'workspace-a', contentId: 'resource-a' };
  const key = randomBytes(32);
  const plaintext = Buffer.from('历史内容\u0000');
  const sealed = sealContent(identity, plaintext, key);
  expect(openContent(identity, sealed, key)).toEqual(plaintext);
  expect(sealed.ciphertext).not.toEqual(plaintext);
  expect(sealContent(identity, plaintext, key).iv).not.toEqual(sealed.iv);
  expect(() => openContent({ ...identity, workspaceId: 'workspace-b' }, sealed, key)).toThrow();
  expect(() => openContent({ ...identity, contentId: 'resource-b' }, sealed, key)).toThrow();
  expect(() => openContent(identity, sealed, randomBytes(32))).toThrow();
  for (const field of ['ciphertext', 'tag', 'iv'] as const) {
    const changed = { ...sealed, [field]: Buffer.from(sealed[field]) };
    changed[field][0] ^= 1;
    expect(() => openContent(identity, changed, key)).toThrow();
  }
  expect(() => openContent(identity, { ...sealed, tag: new Uint8Array(0) }, key)).toThrow('CONTENT_ENVELOPE_INVALID');
  expect(() => sealContent({ ...identity, contentId: '' }, plaintext, key)).toThrow('CONTENT_IDENTITY_REQUIRED');
  expect(openContent(identity, sealContent(identity, new Uint8Array(), key), key)).toHaveLength(0);
});
