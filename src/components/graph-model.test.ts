import { describe, expect, it } from 'vitest';
import type { DiscussionEdge, DiscussionNode } from '../types';
import { projectionToGraphPresentationModel, toGraphPresentationModel } from './graph-model';

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

  it('adapts bounded projection DTOs without exposing projector metadata to GraphView', () => {
    expect(projectionToGraphPresentationModel({ version: 'graph-v1', checkpoint: 12, objects: [{
      ref: { workspaceId: 'workspace', objectType: 'conversation', objectId: 'node-1' }, revision: 2,
      lifecycle: 'archived', title: 'Projected', summary: 'read model', kind: 'branch', status: 'active',
      createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z', layout: { x: 10, y: 20 },
    }, {
      ref: { workspaceId: 'workspace', objectType: 'run', objectId: 'run-1' }, revision: 1,
      lifecycle: 'active', title: 'Run', summary: '', kind: 'execution', status: 'completed',
      createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
    }], relations: [{
      id: 'edge-1', source: { workspaceId: 'workspace', objectType: 'conversation', objectId: 'node-1' },
      target: { workspaceId: 'workspace', objectType: 'conversation', objectId: 'node-2' }, relationType: 'derived_from',
      lifecycle: 'active', label: 'branch', createdAt: '2026-09-04T00:00:00.000Z',
    }] })).toEqual({
      nodes: [{ id: 'node-1', title: 'Projected', summary: 'read model', status: 'archived', kind: 'branch', x: 10, y: 20 }],
      edges: [],
    });
  });
});
