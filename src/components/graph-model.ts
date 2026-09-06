import type { DiscussionEdge, DiscussionNode, EdgeRelation, GraphProjectionResult } from '../types';

export type GraphRelation = EdgeRelation;

export interface GraphNodeModel {
  id: string;
  title: string;
  summary: string;
  anchorText?: string;
  status: DiscussionNode['status'];
  kind: DiscussionNode['kind'];
  x: number;
  y: number;
}

export interface GraphEdgeModel {
  id: string;
  source: string;
  target: string;
  relation: GraphRelation;
  label: string;
}

export interface GraphPresentationModel {
  nodes: GraphNodeModel[];
  edges: GraphEdgeModel[];
}

export function toGraphPresentationModel(
  nodes: readonly DiscussionNode[],
  edges: readonly DiscussionEdge[],
): GraphPresentationModel {
  return {
    nodes: nodes.map(({ id, title, summary, anchorText, status, kind, x, y }) => ({
      id,
      title,
      summary,
      anchorText,
      status,
      kind,
      x,
      y,
    })),
    edges: edges.map(({ id, source, target, relation, label }) => ({
      id,
      source,
      target,
      relation,
      label,
    })),
  };
}

const projectedRelation: Record<string, GraphRelation> = {
  derived_from: 'derived-from', references: 'references', related_to: 'related-to', merged_into: 'merged-into',
};

export function projectionToGraphPresentationModel(graph: GraphProjectionResult): GraphPresentationModel {
  const visibleIds = new Set(graph.objects.filter(item => item.ref.objectType === 'conversation' && item.lifecycle !== 'tombstoned').map(item => item.ref.objectId));
  return {
    nodes: graph.objects.filter(item => item.ref.objectType === 'conversation' && item.lifecycle !== 'tombstoned').map(item => ({
      id: item.ref.objectId, title: item.title, summary: item.summary, ...(item.anchorText ? { anchorText: item.anchorText } : {}),
      status: (item.lifecycle === 'archived' ? 'archived' : item.status) as DiscussionNode['status'],
      kind: (item.kind === 'main' ? 'main' : 'branch') as DiscussionNode['kind'],
      x: item.layout?.x ?? 0, y: item.layout?.y ?? 0,
    })),
    edges: graph.relations.filter(item => item.lifecycle === 'active' && item.source.objectType === 'conversation' && item.target.objectType === 'conversation' && visibleIds.has(item.source.objectId) && visibleIds.has(item.target.objectId)).flatMap(item => {
      const relation = projectedRelation[item.relationType];
      return relation ? [{ id: item.id, source: item.source.objectId, target: item.target.objectId, relation, label: item.label }] : [];
    }),
  };
}
