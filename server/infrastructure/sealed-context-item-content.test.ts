import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SealedContextItemContent, contextItemStorageProjection } from './sealed-context-item-content';
import type { ContextItem } from '../domain';

it('seals authored context fields separately from selection metadata with item-scoped keys', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-context-item-content-'));
  try {
    const content = SealedContextItemContent.atDirectory(root);
    const value = { title: 'private title', detail: 'private detail', reason: 'private reason', content: 'private content', sourceId: 'source', pinned: true };
    const expected = { title: value.title, detail: value.detail, reason: value.reason, content: value.content };
    const reference = await content.seal('a', 'item', value);
    const item: ContextItem = { ...value, id: 'item', role: 'Reference', status: 'active', tokens: 10, contentVersion: 2 };
    const projection = JSON.parse(JSON.stringify(contextItemStorageProjection({ ...item, ...{ unexpected: 'private extra' } }, reference)));
    expect(projection).toEqual({ id: 'item', title: '', detail: '', role: item.role, status: item.status, tokens: 10, sourceId: 'source', pinned: true, contentVersion: 2, contentRef: reference });
    expect(JSON.stringify(projection)).not.toContain('private');
    const other = await content.seal('b', 'item', value);
    expect(await SealedContextItemContent.atDirectory(root).read('a', 'item', reference)).toEqual(expected);
    await expect(content.read('b', 'item', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    await expect(content.read('a', 'different', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    const empty = await content.seal('a', 'empty', { title: '', detail: '' });
    expect(await content.read('a', 'empty', empty)).toEqual({ title: '', detail: '' });
    await content.destroy('a', 'item', reference);
    await expect(content.read('a', 'item', reference)).rejects.toThrow('CONTENT_KEY_UNAVAILABLE');
    expect(await content.read('b', 'item', other)).toEqual(expected);
  } finally { await rm(root, { recursive: true, force: true }); }
});
