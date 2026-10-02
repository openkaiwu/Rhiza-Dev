import type { DiscussionEdge, DiscussionNode, EdgeRelation, GraphProjectionResult } from '../types';

export type GraphRelation = EdgeRelation;

export interface GraphNodeModel {
  id: string;
  objectType?: 'conversation' | 'segment' | 'message';
  parentId?: string;
  lifecycle?: 'active' | 'archived' | 'tombstoned';
  updatedAt?: string;
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
  const supported = graph.objects.filter(item => ['conversation','segment','message'].includes(item.ref.objectType));
  const visibleIds = new Set(supported.map(item => item.ref.objectId));
  const parents = new Map(graph.relations.filter(edge => edge.relationType === 'contains').map(edge => [edge.target.objectId,edge.source.objectId]));
  return {
    nodes: supported.map(item => ({
      id: item.ref.objectId, objectType: item.ref.objectType as 'conversation' | 'segment' | 'message', parentId: parents.get(item.ref.objectId), lifecycle: item.lifecycle, updatedAt:item.updatedAt,
      title: item.title, summary: item.summary, ...(item.anchorText ? { anchorText:item.anchorText } : {}),
      status: (item.lifecycle==='archived'?'archived':item.status) as DiscussionNode['status'],kind:(item.kind==='main'?'main':'branch') as DiscussionNode['kind'],x:item.layout?.x??0,y:item.layout?.y??0,
    })),
    edges: graph.relations.filter(edge=>edge.lifecycle==='active'&&visibleIds.has(edge.source.objectId)&&visibleIds.has(edge.target.objectId)).flatMap(edge=>{
      const relation=projectedRelation[edge.relationType]??(edge.relationType==='contains'?'related-to':undefined);
      return relation?[{id:edge.id,source:edge.source.objectId,target:edge.target.objectId,relation,label:edge.label||edge.relationType}]:[];
    }),
  };
}
