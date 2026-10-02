import type { DiscussionEdge, DiscussionNode, EdgeRelation, GraphProjectionResult, PersonalGraphView } from '../types';

export type GraphRelation = EdgeRelation;
export interface GraphPersonalPresentation { positions: Record<string, { x: number; y: number }>; viewport?: { x: number; y: number; scale: number }; collapsedIds: string[]; relationFilter: GraphRelation | ''; layers?: Array<'conversation' | 'segment' | 'message'>; relationTypes?: GraphRelation[] }
export function toGraphPersonalPresentation(view: PersonalGraphView): GraphPersonalPresentation {
  const relationTypes = view.filters.relationTypes.map(type=>type.replaceAll('_','-')).filter((type): type is GraphRelation => ['derived-from','references','related-to','merged-into'].includes(type));
  const layers = view.filters.objectTypes.filter((type): type is 'conversation' | 'segment' | 'message' => ['conversation','segment','message'].includes(type));
  return { positions: Object.fromEntries(view.positions.filter(item => ['conversation', 'segment', 'message'].includes(item.objectType)).map(item => [item.objectId, { x: item.x, y: item.y }])), collapsedIds: view.positions.filter(item => item.collapsed).map(item => item.objectId), viewport: view.source === 'personal' ? { x: view.viewport.x, y: view.viewport.y, scale: view.viewport.zoom } : undefined, ...(view.source === 'personal' && layers.length ? {layers} : {}), ...(relationTypes.length>1 ? {relationTypes} : {}), relationFilter: view.filters.relationTypes.length === 1 ? (view.filters.relationTypes[0].replaceAll('_', '-') as GraphRelation) : '' };
}

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
