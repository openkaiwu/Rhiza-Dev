import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import { WorkspaceStore } from '../store';
import { NodeHostRuntimeAdapter } from './node-host-runtime';
import { backfillWorkspaceResources } from './resource-backfill';

const directories: string[] = [];
afterEach(async () => Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))));

describe('resource backfill', () => {
  it('is repeatable, preserves attachment identity and leaves zero dangling refs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-backfill-')); directories.push(directory);
    const uploadRoot = join(directory, 'uploads'); await mkdir(uploadRoot);
    const fixture = JSON.parse(await readFile('docs/architecture-gates/M04/resource-fixture.json', 'utf8')) as { attachment_id: string; name: string; mime_type: string; content: string; sha256: string };
    const attachmentId = fixture.attachment_id;
    await writeFile(join(uploadRoot, attachmentId), fixture.content);
    const store = new WorkspaceStore(join(directory, 'workspace.json'));
    const seed = createSeedWorkspace();
    await store.initialize!({ ...seed, attachments: [{ id: attachmentId, name: fixture.name, mimeType: fixture.mime_type, size: Buffer.byteLength(fixture.content), kind: 'file', createdAt: seed.updatedAt }] });
    const host = new NodeHostRuntimeAdapter(uploadRoot);
    const first = await backfillWorkspaceResources(store, host);
    const second = await backfillWorkspaceResources(store, host);
    expect(first).toMatchObject({ migrated: 1, dangling: 0 });
    expect(second).toMatchObject({ migrated: 0, dangling: 0, checksum: first.checksum });
    expect((await store.read()).attachments[0]).toMatchObject({ id: attachmentId, resourceId: attachmentId, resourceVersionId: `resource:${attachmentId}:v1`, digest: fixture.sha256 });
    await expect(store.update(current => ({ ...current, resourceVersions: current.resourceVersions.map(item => ({ ...item, digest: 'b'.repeat(64) })) }))).rejects.toThrow('Immutable ResourceVersion');
  });
});
