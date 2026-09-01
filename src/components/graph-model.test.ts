import { describe, expect, it } from 'vitest';
import type { DiscussionEdge, DiscussionNode } from '../types';
import { toGraphPresentationModel } from './graph-model';

describe('toGraphPresentationModel', () => {
  it('exposes only the stable fields needed by graph presentation', () => {
    const node: DiscussionNode = {
      id: 'node-1',
      title: 'Graph seam',
      summary: 'Projection DTO stays independent from rendering state.',
      status: 'active',
      kind: 'main',
      sourceNodeId: 'domain-only-source',
      anchorText: 'bounded graph data',
      x: 120,
      y: 80,
      createdAt: '2026-09-02T00:00:00.000Z',
      updatedAt: '2026-09-02T00:00:00.000Z',
    };
    const edge: DiscussionEdge = {
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
      relation: 'references',
      anchorId: 'domain-only-anchor',
      label: '引用',
      createdAt: '2026-09-02T00:00:00.000Z',
    };

    expect(toGraphPresentationModel([node], [edge])).toEqual({
      nodes: [{
        id: 'node-1',
        title: 'Graph seam',
        summary: 'Projection DTO stays independent from rendering state.',
        status: 'active',
        kind: 'main',
        anchorText: 'bounded graph data',
        x: 120,
        y: 80,
      }],
      edges: [{
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        relation: 'references',
        label: '引用',
      }],
    });
  });
});
