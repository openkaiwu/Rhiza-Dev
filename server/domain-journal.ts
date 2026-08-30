import type { WorkspaceData } from './domain';
export type JournalActorRef = { actorType: 'human' | 'system' | 'executor' | 'extension'; actorId: string };
export type JournalScopeRef = { scopeType: 'user' | 'workspace' | 'conversation' | 'run'; scopeId: string };

export const DOMAIN_EVENT_SCHEMA_VERSION = '1.0.0' as const;

export type DomainEventType =
  | 'workspace.baseline.backfilled'
  | 'workspace.created'
  | 'workspace.renamed'
  | 'workspace.archived'
  | 'workspace.restored'
  | 'conversation.run.committed'
  | 'context.mode.changed'
  | 'context.selection.changed'
  | 'context.source.added'
  | 'graph.node.created'
  | 'graph.node.activated'
  | 'graph.node.status_changed'
  | 'graph.layout.updated'
  | 'graph.relation.created'
  | 'graph.relation.removed'
  | 'segment.created'
  | 'branch.created'
  | 'message.merge_revision.created'
  | 'resource.registered'
  | 'resource.version.created'
  | 'object.archived'
  | 'object.purged';

export interface CommandFactContext {
  commandId: string;
  commandType: string;
  actor: JournalActorRef;
  scope: JournalScopeRef;
  correlationId?: string;
  causationId?: string;
  expectedRevision?: number;
  occurredAt: string;
}

export interface DomainEventDraft {
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

export interface DomainEventEnvelope extends DomainEventDraft {
  eventId: string;
  workspaceId: string;
  sequence: number;
  ceSpecversion: '1.0';
  envelopeVersion: typeof DOMAIN_EVENT_SCHEMA_VERSION;
  eventSource: string;
  subject: string;
  dataSchema: string;
  aggregateRevision: number;
  actor: JournalActorRef;
  scope: JournalScopeRef;
  commandId: string;
  eventIndex: number;
  causationId?: string;
  correlationId?: string;
  occurredAt: string;
  recordedAt: string;
}

export interface CommandReceipt {
  workspaceId: string;
  commandId: string;
  commandType: string;
  status: 'committed' | 'rejected';
  firstSequence?: number;
  lastSequence?: number;
  result?: unknown;
  error?: { message: string; code: string; status: number };
  createdAt: string;
}

export interface WorkspaceActivityItem {
  id: string;
  sequence: number;
  type: DomainEventType;
  title: string;
  detail: string;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
}

const eventByCommand: Record<string, DomainEventType> = {
  CreateConversationRun: 'conversation.run.committed',
  ChangeContextMode: 'context.mode.changed',
  ChangeContextSelection: 'context.selection.changed',
  AddContextSource: 'context.source.added',
  CreateGraphNode: 'graph.node.created',
  ActivateNode: 'graph.node.activated',
  ChangeNodeStatus: 'graph.node.status_changed',
  UpdateGraphLayout: 'graph.layout.updated',
  CreateRelation: 'graph.relation.created',
  RemoveRelation: 'graph.relation.removed',
  CreateSegment: 'segment.created',
  CreateBranch: 'branch.created',
  CreateMergeRevision: 'message.merge_revision.created',
  RegisterLegacyAttachment: 'resource.registered',
  RegisterResource: 'resource.registered',
  CreateResourceVersion: 'resource.version.created',
  ArchiveObject: 'object.archived',
  PurgeObject: 'object.purged',
};

export function eventForCommand(context: CommandFactContext, previous: WorkspaceData, next: WorkspaceData, value: unknown): DomainEventDraft[] {
  const eventType = eventByCommand[context.commandType];
  if (!eventType) throw new Error(`Persistent command ${context.commandType} has no Domain Event catalog entry`);
  const nodeId = next.activeNodeId;
  const aggregateType = eventType.startsWith('resource.') ? 'resource'
    : eventType.startsWith('conversation.') ? 'conversation'
      : eventType.startsWith('context.') ? 'context'
        : eventType.startsWith('graph.') || eventType.startsWith('segment.') || eventType.startsWith('branch.') || eventType.startsWith('object.') ? 'workspace-graph'
          : 'workspace';
  const addedNode = next.discussionNodes.find(item => !previous.discussionNodes.some(before => before.id === item.id));
  const addedResource = next.resources.find(item => !previous.resources.some(before => before.id === item.id));
  const addedVersion = next.resourceVersions.find(item => !previous.resourceVersions.some(before => before.id === item.id));
  const aggregateId = addedResource?.id || addedVersion?.resourceId || addedNode?.id || nodeId || next.projectId;
  return [{
    eventType,
    aggregateType,
    aggregateId,
    payload: {
      commandType: context.commandType,
      workspaceId: next.projectId,
      activeNodeId: next.activeNodeId,
      addedMessages: next.messages.length - previous.messages.length,
      addedNodes: next.discussionNodes.length - previous.discussionNodes.length,
      addedResources: next.resources.length - previous.resources.length,
      valueId: value && typeof value === 'object' && 'id' in value ? String((value as { id: unknown }).id) : undefined,
    },
  }];
}

export function workspaceSemanticSnapshot(workspace: WorkspaceData): Record<string, unknown> {
  const byId = <T extends { id: string }>(items: T[]): T[] => [...items].sort((left, right) => left.id.localeCompare(right.id));
  return {
    projectId: workspace.projectId,
    projectTitle: workspace.projectTitle,
    activeNodeId: workspace.activeNodeId,
    mode: workspace.mode,
    contextItems: byId(workspace.contextItems),
    nodes: byId(workspace.discussionNodes).map(({ createdAt: _createdAt, updatedAt: _updatedAt, ...item }) => item),
    messages: byId(workspace.messages).map(({ createdAt: _createdAt, ...item }) => ({ ...item, operation: item.operation ?? 'send', version: item.version ?? 1, attachmentIds: item.attachmentIds ?? [] })),
    segments: byId(workspace.segments).map(({ createdAt: _createdAt, ...item }) => item),
    anchors: byId(workspace.anchors).map(({ createdAt: _createdAt, ...item }) => item),
    edges: byId(workspace.discussionEdges).map(({ createdAt: _createdAt, ...item }) => item),
    manifests: byId(workspace.manifests).map(({ createdAt: _createdAt, ...item }) => item),
    attachments: byId(workspace.attachments).map(({ createdAt: _createdAt, ...item }) => item),
    resources: byId(workspace.resources).map(({ createdAt: _createdAt, ...item }) => item),
    resourceVersions: byId(workspace.resourceVersions).map(({ createdAt: _createdAt, ...item }) => item),
    materializations: byId(workspace.materializations).map(({ createdAt: _createdAt, ...item }) => item),
    fileChunks: byId(workspace.fileChunks),
  };
}

/** Changed semantic sections for baseline + tail verification; Current State remains authoritative. */
export function workspaceSemanticChanges(previous: WorkspaceData, next: WorkspaceData): Record<string, unknown> {
  const before = workspaceSemanticSnapshot(previous);
  return Object.fromEntries(Object.entries(workspaceSemanticSnapshot(next)).filter(([key, value]) => JSON.stringify(before[key]) !== JSON.stringify(value)));
}

const activityTitles: Record<DomainEventType, string> = {
  'workspace.baseline.backfilled': '建立 Workspace 历史基线',
  'workspace.created': '创建 Workspace',
  'workspace.renamed': '重命名 Workspace',
  'workspace.archived': '归档 Workspace',
  'workspace.restored': '恢复 Workspace',
  'conversation.run.committed': '完成一次对话',
  'context.mode.changed': '切换 Context 模式',
  'context.selection.changed': '调整 Context 选择',
  'context.source.added': '加入 Context 来源',
  'graph.node.created': '创建讨论节点',
  'graph.node.activated': '切换活动节点',
  'graph.node.status_changed': '更新节点状态',
  'graph.layout.updated': '调整图谱布局',
  'graph.relation.created': '创建节点关系',
  'graph.relation.removed': '移除节点关系',
  'segment.created': '创建讨论分段',
  'branch.created': '创建讨论支线',
  'message.merge_revision.created': '合并讨论修订',
  'resource.registered': '添加 Resource',
  'resource.version.created': '创建 Resource 新版本',
  'object.archived': '归档对象',
  'object.purged': '清除归档对象',
};

export function toActivityItem(event: DomainEventEnvelope): WorkspaceActivityItem {
  return {
    id: event.eventId,
    sequence: event.sequence,
    type: event.eventType,
    title: activityTitles[event.eventType],
    detail: `${event.aggregateType} · ${event.aggregateId}`,
    occurredAt: event.occurredAt,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
  };
}
