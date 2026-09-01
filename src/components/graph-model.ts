import type { DiscussionEdge, DiscussionNode, EdgeRelation } from '../types';

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
