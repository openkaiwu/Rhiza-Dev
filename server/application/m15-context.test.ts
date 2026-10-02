// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createLegacyCommandEnvelope, createLegacyQueryEnvelope } from '../contracts/application';
import { createSeedWorkspace } from '../seed';
import { LegacyContextPlanner } from '../context-runtime/legacy-planner';
import { createRhizaApplication } from './create-application';

function fixture() {
  let sequence = 0;
  let workspace = createSeedWorkspace();
  workspace.contextItems = [];
  workspace.discussionNodes.push({ ...workspace.discussionNodes[0], id: 'related', title: 'Payment evidence', summary: 'payment idempotency' });
  const execute = vi.fn(async (mutation: import('./ports/workspace-unit-of-work').WorkspaceMutation<unknown>) => {
    const result = await mutation.apply(workspace); workspace = result.next; return { workspace, value: result.value };
  });
  const generate = vi.fn(async function* (request: import('./ports/runtime').RuntimeRequest) {
    yield { type: 'RUN_START' as const, requestId: request.requestId, manifestId: request.manifestId, model: 'fixture', provider: 'Fixture' };
    yield { type: 'RUN_END' as const, requestId: request.requestId, text: 'Answer', model: 'fixture', provider: 'Fixture' };
  });
  const application = createRhizaApplication({
    unitOfWork: { read: async reader => reader(workspace), execute: execute as import('./ports/workspace-unit-of-work').WorkspaceUnitOfWork['execute'] },
    planner: new LegacyContextPlanner(() => `item-${++sequence}`),
    runtime: { listModels: async () => [{ id: 'fixture', model: 'fixture', provider: 'Fixture', displayName: 'Fixture', active: true }], generate },
    providers: {} as import('./ports/provider-management').ProviderManagementPort,
    host: {} as import('./ports/host-runtime').HostRuntimePort,
    textExtraction: {} as import('./ports/legacy-upload').LegacyTextExtractionPort,
    id: () => `id-${++sequence}`, now: () => '2026-10-02T00:00:00.000Z',
  });
  const preview = () => application.query(createLegacyQueryEnvelope('preview', 'GetContextPreview', { query: 'payment' }));
  const decide = (sourceRevision: string, decision: 'accept' | 'reject' = 'accept') => application.execute(createLegacyCommandEnvelope(`decision-${++sequence}`, 'DecideContextRecommendation', { sourceType: 'node', sourceId: 'related', sourceRevision, decision, reason: 'Relevant payment evidence' }));
  return { application, preview, decide, execute, generate, workspace: () => workspace };
}

describe('M15 version-bound Context decisions', () => {
  it('omits old automatic active entries from Manifest identities and temporary inputs', async () => {
    const f = fixture();
    f.workspace().contextItems.push({ id: 'old-auto', title: 'Payment evidence', detail: 'Source', role: 'Reference', tokens: 4, sourceType: 'node', sourceId: 'related', status: 'active', selectionMode: 'AUTO_RETRIEVED' });
    const result = await f.application.execute(createLegacyCommandEnvelope('chat', 'CreateConversationRun', { prompt: 'payment', operation: 'send', attachmentIds: [], generation: { temperature: 0, topP: 1, maxTokens: 100 } }));
    expect(result.manifest.contextItemIds).not.toContain('old-auto');
    await f.application.execute(createLegacyCommandEnvelope('temporary', 'ExecuteTemporaryConversation', { prompt: 'payment', sourceNodeId: f.workspace().activeNodeId, anchorText: 'anchor' }));
    expect(f.generate.mock.calls[1][0].contextItems.some(item => item.id === 'old-auto')).toBe(false);
  });
  it('binds legacy confirmation to the authoritative source version', async () => {
    const f = fixture();
    f.workspace().contextItems.push({ id: 'legacy', title: 'Payment evidence', detail: 'Source', role: 'Reference', tokens: 4, sourceType: 'node', sourceId: 'related', status: 'recommended' });
    await f.application.execute(createLegacyCommandEnvelope('legacy-confirm', 'ChangeContextSelection', { contextItemId: 'legacy', status: 'active' }));
    expect(f.workspace().contextItems[0].sourceRevision).toMatch(/^[a-f0-9]{64}$/);
  });
  it('previews without writes or dispatch and only accepted recommendations become active', async () => {
    const f = fixture();
    const preview = await f.preview();
    const recommendation = preview.recommendations.find(item => item.sourceId === 'related')!;
    expect(recommendation.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.items).toEqual([]);
    expect(f.execute).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    await f.decide(recommendation.sourceRevision!);
    const accepted = await f.preview();
    expect(accepted.items).toMatchObject([{ sourceId: 'related', selectionMode: 'AI_RECOMMENDED_ACCEPTED', reason: 'Relevant payment evidence' }]);
    expect(accepted.recommendations.some(item => item.sourceId === 'related')).toBe(false);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('rejects confirmation after a source changed and rejects an accepted source that changed later', async () => {
    const f = fixture();
    const before = (await f.preview()).recommendations.find(item => item.sourceId === 'related')!;
    f.workspace().discussionNodes.find(node => node.id === 'related')!.summary += ' updated';
    await expect(f.decide(before.sourceRevision!)).rejects.toMatchObject({ details: { code: 'CONTEXT_SELECTION_STALE' } });
    expect(f.workspace().contextItems).toEqual([]);
    const fresh = (await f.preview()).recommendations.find(item => item.sourceId === 'related')!;
    await f.decide(fresh.sourceRevision!);
    f.workspace().discussionNodes.find(node => node.id === 'related')!.summary += ' changed again';
    await expect(f.preview()).rejects.toMatchObject({ details: { code: 'CONTEXT_SELECTION_STALE' } });
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('records a rejection reason and excludes that source from subsequent recommendations', async () => {
    const f = fixture();
    const recommendation = (await f.preview()).recommendations.find(item => item.sourceId === 'related')!;
    await f.decide(recommendation.sourceRevision!, 'reject');
    expect(f.workspace().contextItems).toMatchObject([{ status: 'excluded', reason: 'Relevant payment evidence' }]);
    const preview = await f.preview();
    expect(preview.recommendations.some(item => item.sourceId === 'related')).toBe(false);
    expect(preview.omissions).toMatchObject([{ sourceId: 'related', code: 'excluded', reason: 'Relevant payment evidence' }]);
  });
});
