// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { embedTerms, tokenize } from '../context-planner';
import type { CandidateIndexSnapshot, ContextPlanningInput } from './contracts';
import { CONTEXT_VERSIONS, contextCacheIdentity, IndexedContextPlanner } from './indexed-planner';

const input: ContextPlanningInput = { workspaceId: 'workspace', nodeId: 'node', mode: 'Assisted', query: 'payment', selection: [], attachmentIds: [], budget: 100 };
const fixture = (): CandidateIndexSnapshot => ({
  version: 'candidate-v1', revision: '1', graphCheckpoint: 1,
  candidates: [{ text: 'payment', terms: tokenize('payment'), embedding: embedTerms(tokenize('payment')), graphDistance: 0, item: { id: 'candidate', title: 'Payment', detail: 'Evidence', content: 'payment', tokens: 2, role: 'Reference', status: 'active', sourceType: 'node', sourceId: 'node' } }],
  selection: [], sourceVersions: [{ sourceType: 'node', sourceId: 'node', revision: '1', resourceVersionId: 'version-1', digest: 'digest-1' }],
  audit: { fullWorkspaceScans: 0, candidateRows: 1, neighborhoodObjects: 1 },
});

describe('M08 indexed planning contract', () => {
  it('uses indexed candidates, refreshes revisions on hits and isolates cached results from mutation', async () => {
    const snapshot = fixture(); const query = vi.fn(async () => snapshot);
    const runtime = new IndexedContextPlanner({ query });
    const first = await runtime.plan(input);
    expect(first.items[0].sourceId).toBe('node');
    first.items[0].title = 'caller mutation';
    const second = await runtime.plan(input);
    expect(second.cache.reason).toBe('hit'); expect(second.items[0].title).toBe('Payment');
    snapshot.sourceVersions[0].resourceVersionId = 'version-2';
    expect((await runtime.plan(input)).cache.reason).toBe('sources_changed');
    expect(query).toHaveBeenCalledTimes(3);
  });

  it('retains explicit pins over budget and prevents automatic selection in Strict mode', async () => {
    const snapshot = fixture();
    snapshot.selection = [{ ...snapshot.candidates[0].item, id: 'pin', tokens: 120, pinned: true, selectionMode: 'USER_SELECTED' }];
    const runtime = new IndexedContextPlanner({ query: async () => snapshot });
    const result = await runtime.plan({ ...input, mode: 'Strict' });
    expect(result.items.map(item => item.id)).toEqual(['pin']); expect(result.diagnostics.usedTokens).toBe(120);
    snapshot.selection[0].status = 'excluded';
    expect((await runtime.plan(input)).items).toEqual([]);
  });

  it('invalidates every declared cache dependency', () => {
    const baseline = contextCacheIdentity(input, fixture(), CONTEXT_VERSIONS).key;
    for (const patch of [{ workspaceId: 'other' }, { nodeId: 'other' }, { mode: 'Strict' as const }, { query: 'refund' }, { budget: 99 }, { attachmentIds: ['file'] }, { selection: [{ ...fixture().candidates[0].item, pinned: true }] }]) {
      expect(contextCacheIdentity({ ...input, ...patch }, fixture(), CONTEXT_VERSIONS).key).not.toBe(baseline);
    }
    for (const field of ['version', 'revision', 'graphCheckpoint'] as const) {
      const snapshot = fixture(); Object.assign(snapshot, { [field]: field === 'graphCheckpoint' ? 2 : 'changed' });
      expect(contextCacheIdentity(input, snapshot, CONTEXT_VERSIONS).key).not.toBe(baseline);
    }
    for (const field of ['revision', 'resourceVersionId', 'digest'] as const) {
      const snapshot = fixture(); snapshot.sourceVersions[0][field] = 'changed';
      expect(contextCacheIdentity(input, snapshot, CONTEXT_VERSIONS).key).not.toBe(baseline);
    }
    for (const field of ['planner', 'compiler', 'tokenizer', 'selectionPolicy'] as const) {
      expect(contextCacheIdentity(input, fixture(), { ...CONTEXT_VERSIONS, [field]: 'changed' }).key).not.toBe(baseline);
    }
    expect(contextCacheIdentity(input, fixture(), { ...CONTEXT_VERSIONS, contributors: { lexical: 'v2' } }).key).not.toBe(baseline);
    const selected = fixture(); selected.selection = [{ ...selected.candidates[0].item, pinned: true }];
    expect(contextCacheIdentity(input, selected, CONTEXT_VERSIONS).key).not.toBe(baseline);
  });

  it('rejects full Workspace scans and oversized candidate queries', async () => {
    const snapshot = fixture(); const runtime = new IndexedContextPlanner({ query: async () => snapshot });
    snapshot.audit.fullWorkspaceScans = 1;
    await expect(runtime.plan(input)).rejects.toThrow('CONTEXT_QUERY_BOUNDARY_VIOLATION');
    snapshot.audit.fullWorkspaceScans = 0; snapshot.candidates = Array(501).fill(snapshot.candidates[0]);
    await expect(runtime.plan(input)).rejects.toThrow('CONTEXT_QUERY_BOUNDARY_VIOLATION');
  });
});

describe('M08 source contributor', () => {
  it('materializes one changed source with deterministic terms and token count', async () => {
    const { LexicalContextContributor } = await import('./lexical-contributor');
    const contributor = new LexicalContextContributor();
    const source = { workspaceId: 'workspace', sourceType: 'node' as const, sourceId: 'node', nodeId: 'node', title: 'Payment', content: '支付 payment', revision: '1' };
    const first = contributor.contribute(source);
    expect(first).toEqual(contributor.contribute(source));
    expect(first.terms).toContain('支付'); expect(first.terms).toContain('payment');
    expect(first.item.tokens).toBe(Math.ceil(source.content.length / 4));
    expect(contributor.contribute({ ...source, content: 'refund', revision: '2' }).terms).toEqual(['refund']);
  });
});
