import { describe, expect, it } from 'vitest';
import { createSeedWorkspace } from '../seed';
import type { WorkspaceData } from '../domain';
import type { WorkspaceRepository, WorkspaceUpdateOptions } from '../store';
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
});
