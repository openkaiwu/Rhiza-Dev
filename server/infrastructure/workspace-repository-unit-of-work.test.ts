import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSeedWorkspace } from '../seed';
import type { WorkspaceData } from '../domain';
import { WorkspaceStore, type WorkspaceRepository, type WorkspaceUpdateOptions } from '../store';
import { RepositoryWorkspaceUnitOfWork } from './workspace-repository-unit-of-work';

class FakeRepository implements WorkspaceRepository {
  data = createSeedWorkspace();
  options: WorkspaceUpdateOptions | undefined;

  async read(): Promise<WorkspaceData> { return this.data; }

  async update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData> {
    this.options = options;
    this.data = await mutator(this.data);
    return this.data;
  }
}

describe('RepositoryWorkspaceUnitOfWork', () => {
  it('reads through the repository and applies ordinary mutations without update options', async () => {
    const repository = new FakeRepository();
    const unit = new RepositoryWorkspaceUnitOfWork(repository);
    await expect(unit.read(workspace => workspace.projectId)).resolves.toBe(repository.data.projectId);
    await expect(unit.execute({
      policy: { kind: 'normal' },
      apply: workspace => ({ next: { ...workspace, projectTitle: 'Changed' }, value: 'ok' }),
    })).resolves.toEqual({ workspace: expect.objectContaining({ projectTitle: 'Changed' }), value: 'ok' });
    expect(repository.data.projectTitle).toBe('Changed');
    expect(repository.options).toBeUndefined();
  });

  it('maps a purge policy exactly to the repository purge capability', async () => {
    const repository = new FakeRepository();
    const unit = new RepositoryWorkspaceUnitOfWork(repository);
    await unit.execute({
      policy: { kind: 'purge', nodeId: 'node-1', auditReceiptId: 'receipt-1' },
      apply: workspace => ({ next: workspace, value: undefined }),
    });
    expect(repository.options).toEqual({ purge: { nodeId: 'node-1', auditReceiptId: 'receipt-1' } });
  });

  it('persists scoped JSON workspaces across reconstructed stores without cross-write loss', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-uow-'));
    try {
      const path = join(directory, 'workspace.json');
      const first = new RepositoryWorkspaceUnitOfWork(new WorkspaceStore(path));
      await Promise.all(['workspace-a', 'workspace-b'].map(async id => {
        await first.createWorkspace(id, id);
        await first.withWorkspace!(id, () => first.execute({ policy: { kind: 'normal' }, apply: current => ({ next: { ...current, projectTitle: `${id}-saved` }, value: undefined }) }));
      }));
      const restored = new RepositoryWorkspaceUnitOfWork(new WorkspaceStore(path));
      await expect(restored.withWorkspace!('workspace-a', () => restored.read(item => item.projectTitle))).resolves.toBe('workspace-a-saved');
      await expect(restored.withWorkspace!('workspace-b', () => restored.read(item => item.projectTitle))).resolves.toBe('workspace-b-saved');
      await expect(restored.withWorkspace!('missing', () => restored.read(item => item.projectId))).rejects.toMatchObject({ code: 'WORKSPACE_DATA_MISSING', status: 409 });
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
