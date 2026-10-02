// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { embedTerms, planCandidates, tokenize } from '../context-planner';
import type { ContextItem, ContextMode } from '../domain';
import type { CandidateIndexSnapshot, ContextPlanningInput, ContextPlanner } from './contracts';
import { IndexedContextPlanner } from './indexed-planner';

const candidate = {
  text: 'payment evidence', terms: tokenize('payment evidence'), embedding: embedTerms(tokenize('payment evidence')), graphDistance: 1,
  item: { id: 'recommendation', title: 'Payment evidence', detail: 'Source', content: 'payment evidence', tokens: 4, role: 'Reference', status: 'active', sourceType: 'node', sourceId: 'related' } as ContextItem,
};
const input: ContextPlanningInput = { workspaceId: 'workspace', nodeId: 'current', mode: 'Assisted', query: 'payment', selection: [], attachmentIds: [], budget: 100 };

describe('M15 selection modes', () => {
  it('distinguishes automatic inclusion, unconfirmed recommendations and strict explicit input', () => {
    const plan = (mode: ContextMode) => planCandidates({ ...input, mode }, [candidate]);
    expect(plan('Auto').items).toMatchObject([{ sourceId: 'related', selectionMode: 'AUTO_RETRIEVED' }]);
    const assisted = plan('Assisted');
    expect(assisted.items).toEqual([]);
    expect(assisted).toMatchObject({ recommendations: [{ sourceId: 'related', status: 'recommended' }] });
    expect(plan('Strict')).toMatchObject({ items: [], recommendations: [] });
  });

  it('does not carry active automatic selections into Assisted or Strict, but retains accepted and pinned sources', () => {
    const selection: ContextItem[] = [
      { ...candidate.item, selectionMode: 'AUTO_RETRIEVED' },
      { ...candidate.item, id: 'accepted', sourceId: 'accepted', selectionMode: 'AI_RECOMMENDED_ACCEPTED' },
      { ...candidate.item, id: 'pin', sourceId: 'pin', pinned: true, selectionMode: 'USER_SELECTED', tokens: 120 },
    ];
    for (const mode of ['Assisted', 'Strict'] as const) {
      expect(planCandidates({ ...input, mode, selection }, []).items.map(item => item.id)).toEqual(['accepted', 'pin']);
    }
  });

  it('keeps explicit attachments separate from unconfirmed recommendations and explains budget rejection', () => {
    const chunks = [0, 1].map(index => ({ ...candidate, attachmentId: 'file', item: { ...candidate.item, id: `chunk-${index}`, sourceId: `chunk-${index}`, sourceType: 'chunk' as const } }));
    const result = planCandidates({ ...input, attachmentIds: ['file'], budget: 5 }, [...chunks, candidate]);
    expect(result.items.map(item => item.sourceId)).toEqual(['chunk-0']);
    expect(result.omissions).toMatchObject([{ sourceId: 'chunk-1', code: 'budget' }]);
    expect(result).toMatchObject({ recommendations: [{ sourceId: 'related' }] });
  });

  it.each(['Assisted', 'Strict'] as const)('never adds an unselected source when %s ranking fails', async mode => {
    const snapshot: CandidateIndexSnapshot = { version: 'v1', revision: '1', graphCheckpoint: 0, selection: [], candidates: [{ ...candidate, item: { ...candidate.item, sourceId: 'current' } }], sourceVersions: [], audit: { fullWorkspaceScans: 0, candidateRows: 1, neighborhoodObjects: 1 } };
    const planner: ContextPlanner = { version: 'failed', plan() { throw new Error('ranking unavailable'); } };
    const result = await new IndexedContextPlanner({ query: async () => snapshot }, planner).plan({ ...input, mode });
    expect(result.items).toEqual([]);
    expect(result.diagnostics.fallback).toBe(true);
  });
});
