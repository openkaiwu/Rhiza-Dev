import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { AuditEvent, WorkspaceData } from './domain';
import { createSeedWorkspace } from './seed';
import type { WorkspaceDirectoryPort } from './identity/workspace-directory';
import type { WorkspaceRecord } from './contracts/application';
import type { CommandFactContext, DomainEventDraft, DomainEventEnvelope } from './domain-journal';
import type { WorkspaceGraphProjection } from './contracts/graph-projection';

export interface TransactionalWorkspaceCommand<T> {
  context: CommandFactContext;
  options?: WorkspaceUpdateOptions;
  apply(current: WorkspaceData): Promise<{ next: WorkspaceData; value: T }>;
  events(previous: WorkspaceData, next: WorkspaceData, value: T): DomainEventDraft[];
}

export interface TransactionalWorkspaceCommandResult<T> {
  workspace: WorkspaceData;
  value: T;
  duplicate: boolean;
}

export interface WorkspaceRepository {
  bundleImportCheckpoints?: import('./application/ports/bundle-import').BundleImportCheckpointPort;
  activatePortableImport?(importId: string, ownerId: string, facts: import('./application/ports/portable-workspace').PortableWorkspaceFacts): Promise<void>;
  readPortableWorkspace?(): Promise<import('./application/ports/portable-workspace').PortableWorkspaceFacts>;
  readProvenance?(outputId: string): Promise<import('./domain').ProvenanceLink | undefined>;
  readContextHistory?(input: { manifestId: string } | { messageId: string }): Promise<import('./application/ports/workspace-unit-of-work').ContextHistoryFacts | undefined>;
  readConversationPreparation?(attachmentIds: string[], sourceMessageId?: string): Promise<import('./application/ports/workspace-unit-of-work').ConversationPreparation>;
  queryContextCandidates?(input: import('./context-runtime/contracts').ContextPlanningInput): Promise<import('./context-runtime/contracts').CandidateIndexSnapshot>;
  rebuildContextCandidates?(): Promise<{ writes: number }>;
  listRuns?(limit?: number): Promise<import('./execution-runtime/run').ExecutionRun[]>;
  getRun?(runId: string): Promise<import('./execution-runtime/run').ExecutionRun | undefined>;
  writeRunTraces?(runId: string, attempt: number, traces: import('./execution-runtime/run').RunTrace[]): Promise<void>;
  read(): Promise<WorkspaceData>;
  update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData>;
  close?(): Promise<void>;
  workspaceDirectory?: WorkspaceDirectoryPort;
  forWorkspace?(workspaceId: string): WorkspaceRepository;
  initialize?(workspace: WorkspaceData): Promise<WorkspaceData>;
  defaultWorkspaceId?: string;
  executeCommand?<T>(command: TransactionalWorkspaceCommand<T>): Promise<TransactionalWorkspaceCommandResult<T>>;
  readJournal?(limit?: number): Promise<DomainEventEnvelope[]>;
  backfillJournal?(): Promise<{ checksum: string; created: boolean; eventCount: number }>;
  readCommandReceipt?(commandId: string): Promise<import('./domain-journal').CommandReceipt | undefined>;
  executeWorkspaceLifecycle?(context: CommandFactContext, command: import('./application/ports/workspace-unit-of-work').WorkspaceLifecycleCommand): Promise<WorkspaceRecord>;
  readGraphProjection?(): Promise<WorkspaceGraphProjection>;
  rebuildGraphProjection?(): Promise<WorkspaceGraphProjection>;
}

export interface WorkspacePurgeCapability {
  nodeId: string;
  auditReceiptId: string;
}

export interface WorkspaceUpdateOptions {
  run?: import('./execution-runtime/run').RunMutation;
  purge?: WorkspacePurgeCapability;
}

const itemById = <T extends { id: string }>(items: T[]) => new Map(items.map(item => [item.id, item]));

/**
 * History is append-only until a narrowly-scoped Purge capability is presented.
 * Archive is an ordinary node status transition; it never needs this capability.
 */
export function validateWorkspaceHistoryUpdate(previous: WorkspaceData, next: WorkspaceData, options?: WorkspaceUpdateOptions): void {
  const priorNodes = itemById(previous.discussionNodes);
  const nextNodes = itemById(next.discussionNodes);
  const removedNodeIds = [...priorNodes.keys()].filter(id => !nextNodes.has(id));
  const priorMessages = itemById(previous.messages);
  const nextMessages = itemById(next.messages);
  const removedMessageIds = [...priorMessages.keys()].filter(id => !nextMessages.has(id));
  const priorManifests = itemById(previous.manifests);
  const nextManifests = itemById(next.manifests);
  const removedManifestIds = [...priorManifests.keys()].filter(id => !nextManifests.has(id));
  const priorResourceVersions = itemById(previous.resourceVersions);
  const nextResourceVersions = itemById(next.resourceVersions);
  const nextResources = itemById(next.resources);
  const nextAttachments = itemById(next.attachments);
  const nextFileChunks = itemById(next.fileChunks);
  const priorMaterializations = itemById(previous.materializations);
  const nextMaterializations = itemById(next.materializations);

  for (const [id, manifest] of priorManifests) {
    const candidate = nextManifests.get(id);
    if (!candidate && manifest.schemaVersion === '1.0.0'
      && (!options?.purge || manifest.nodeId !== options.purge.nodeId)) throw Object.assign(new Error('该节点仍有不可变执行上下文，请使用归档。'), { code: 'PURGE_HAS_EXECUTION_HISTORY', status: 409 });
    if (candidate && !isDeepStrictEqual(candidate, manifest)) {
      throw new Error(`Immutable Manifest ${id} cannot be rewritten`);
    }
  }
  for (const [id, version] of priorResourceVersions) {
    const candidate = nextResourceVersions.get(id);
    if (candidate && !isDeepStrictEqual(candidate, version) && options?.purge
      && removedNodeIds.length === 1 && removedNodeIds[0] === options.purge.nodeId && !version.purgedAt
      && candidate.blobRef === 'purged-v1' && candidate.purgedAt
      && isDeepStrictEqual(Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== 'blobRef' && key !== 'purgedAt')),
        Object.fromEntries(Object.entries(version).filter(([key]) => key !== 'blobRef' && key !== 'purgedAt')))) continue;
    if (!candidate || !isDeepStrictEqual(candidate, version)) throw new Error(`Immutable ResourceVersion ${id} cannot be rewritten or removed`);
  }
  for (const [id, materialization] of priorMaterializations) {
    const candidate = nextMaterializations.get(id);
    if (!candidate || !isDeepStrictEqual(candidate, materialization)) throw new Error(`Immutable ResourceMaterialization ${id} cannot be rewritten or removed`);
  }

  if (!removedNodeIds.length && !removedMessageIds.length && !removedManifestIds.length) return;

  const purge = options?.purge;
  if (!purge) {
    throw new Error('Workspace history is append-only; an explicit purge capability is required to remove nodes, messages, or manifests');
  }
  if (removedNodeIds.length !== 1 || removedNodeIds[0] !== purge.nodeId) {
    throw new Error('Purge capability may remove exactly its specified node');
  }
  const node = priorNodes.get(purge.nodeId)!;
  if (node.status !== 'archived') {
    throw new Error(`Purge target ${purge.nodeId} must be archived`);
  }
  if (previous.discussionNodes.some(candidate => candidate.sourceNodeId === purge.nodeId)) {
    throw new Error(`Purge target ${purge.nodeId} must be a leaf node`);
  }
  if (removedMessageIds.some(id => priorMessages.get(id)?.nodeId !== purge.nodeId)
    || removedManifestIds.some(id => priorManifests.get(id)?.nodeId !== purge.nodeId)) {
    throw new Error('Purge capability may remove only history owned by its specified node');
  }
  const attachmentIds = new Set(previous.attachments.map(item => item.id));
  const chunkIds = new Set(previous.fileChunks.map(item => item.id));
  const retainedContextIds = new Set(next.contextItems.map(item => item.id));
  const receiptTime = next.auditEvents.find(event => event.id === purge.auditReceiptId)?.createdAt;
  const removedAttachmentIds = new Set(previous.attachments.filter(item => !next.attachments.some(candidate => candidate.id === item.id)).map(item => item.id));
  const attachedToRemovedMessages = new Set(removedMessageIds.flatMap(id => priorMessages.get(id)?.attachmentIds ?? []));
  const resourcesToPurge = new Set([...attachedToRemovedMessages].map(id => previous.attachments.find(item => item.id === id)?.resourceId).filter((id): id is string => !!id));
  const affectedAttachments = new Set(previous.attachments.filter(item => item.resourceId && resourcesToPurge.has(item.resourceId)).map(item => item.id));
  const affectedVersions = new Set(previous.resourceVersions.filter(item => resourcesToPurge.has(item.resourceId)).map(item => item.id));
  const affectedChunks = new Set(previous.fileChunks.filter(item => affectedAttachments.has(item.attachmentId)).map(item => item.id));
  const affectedContextIds = new Set(previous.contextItems.filter(item => item.sourceId
    && (affectedAttachments.has(item.sourceId) || affectedChunks.has(item.sourceId))).map(item => item.id));
  const sharedResource = next.messages.some(message => message.attachmentIds?.some(id => affectedAttachments.has(id)))
    || next.manifests.some(manifest => manifest.attachmentIds.some(id => affectedAttachments.has(id))
      || manifest.contextItemIds.some(id => affectedContextIds.has(id))
      || manifest.excludedItemIds.some(id => affectedContextIds.has(id))
      || manifest.contextItems.some(item => [item.resourceId, item.resourceVersionId, item.originResourceVersionId, item.sourceId]
        .some(id => id && (resourcesToPurge.has(id) || affectedVersions.has(id) || affectedAttachments.has(id)
          || affectedChunks.has(id) || affectedContextIds.has(id)))))
    || next.contextItems.some(item => item.sourceId && (resourcesToPurge.has(item.sourceId) || affectedVersions.has(item.sourceId)
      || affectedAttachments.has(item.sourceId) || affectedChunks.has(item.sourceId) || affectedContextIds.has(item.sourceId)));
  const safeAttachedResources = [...attachedToRemovedMessages].every(id => {
    const attachment = previous.attachments.find(item => item.id === id);
    return attachment?.resourceId && attachment.resourceVersionId && removedAttachmentIds.has(id)
      && previous.resourceVersions.some(version => version.id === attachment.resourceVersionId && version.resourceId === attachment.resourceId);
  }) && [...removedAttachmentIds].every(id => affectedAttachments.has(id)) && !sharedResource
    && [...resourcesToPurge].every(id => {
      const resource = nextResources.get(id);
      const versions = previous.resourceVersions.filter(version => version.resourceId === id);
      const relatedAttachments = previous.attachments.filter(item => item.resourceId === id);
      const relatedChunks = previous.fileChunks.filter(chunk => relatedAttachments.some(item => item.id === chunk.attachmentId));
      return resource?.logicalName === '[purged]' && versions.length > 0
        && versions.every(version => version.purgedAt || (version.blobRef.startsWith('sealed-v1/')
          && nextResourceVersions.get(version.id)?.blobRef === 'purged-v1'
          && nextResourceVersions.get(version.id)?.purgedAt === receiptTime))
        && relatedAttachments.every(item => removedAttachmentIds.has(item.id))
        && relatedChunks.every(chunk => !next.fileChunks.some(item => item.id === chunk.id));
    });
  const unauthorizedResourceChange = [...priorResourceVersions.values()].some(version =>
    !resourcesToPurge.has(version.resourceId) && !isDeepStrictEqual(nextResourceVersions.get(version.id), version))
    || previous.resources.some(resource => {
      const candidate = nextResources.get(resource.id);
      return !candidate || !isDeepStrictEqual(resourcesToPurge.has(resource.id)
        ? { ...candidate, logicalName: resource.logicalName } : candidate, resource);
    })
    || previous.attachments.some(attachment => {
      const candidate = nextAttachments.get(attachment.id);
      return candidate ? !isDeepStrictEqual(candidate, attachment) : !affectedAttachments.has(attachment.id);
    })
    || previous.fileChunks.some(chunk => {
      const candidate = nextFileChunks.get(chunk.id);
      return candidate ? !isDeepStrictEqual(candidate, chunk) : !affectedChunks.has(chunk.id);
    })
    || previous.messages.some(message => nextMessages.has(message.id)
      && !isDeepStrictEqual(nextMessages.get(message.id)?.attachmentIds ?? [], message.attachmentIds ?? []));
  const resourceManifest = removedManifestIds.some(id => {
    const manifest = priorManifests.get(id)!;
    return manifest.attachmentIds.some(attachmentId => !affectedAttachments.has(attachmentId))
      || manifest.contextItems.some(item => (item.resourceId && !resourcesToPurge.has(item.resourceId))
        || (item.resourceVersionId && !affectedVersions.has(item.resourceVersionId))
        || (item.originResourceVersionId && !affectedVersions.has(item.originResourceVersionId))
        || ((item.sourceType === 'file' || item.sourceType === 'chunk')
          && !(affectedAttachments.has(item.sourceId) || affectedChunks.has(item.sourceId)))
        || ((attachmentIds.has(item.sourceId) || chunkIds.has(item.sourceId))
          && !(affectedAttachments.has(item.sourceId) || affectedChunks.has(item.sourceId))));
  });
  const resourceContext = previous.contextItems.some(item => (item.sourceNodeId === purge.nodeId || !retainedContextIds.has(item.id))
    && (item.sourceType === 'file' || item.sourceType === 'chunk'
      || (item.sourceId && (attachmentIds.has(item.sourceId) || chunkIds.has(item.sourceId))))
    && (!item.sourceId || !(affectedAttachments.has(item.sourceId) || affectedChunks.has(item.sourceId))
      || retainedContextIds.has(item.id) || (!!item.sourceNodeId && item.sourceNodeId !== purge.nodeId)));
  if ((attachedToRemovedMessages.size && !safeAttachedResources) || unauthorizedResourceChange || resourceManifest || resourceContext) {
    throw Object.assign(new Error('该节点的历史内容仍引用文件资源，请使用归档；Purge 需要先覆盖资源密钥撤销。'), { code: 'PURGE_HAS_RESOURCE_HISTORY', status: 409 });
  }
  const removedSegments = previous.segments.filter(item => !next.segments.some(candidate => candidate.id === item.id));
  const removedAnchors = previous.anchors.filter(item => !next.anchors.some(candidate => candidate.id === item.id));
  const removedEdges = previous.discussionEdges.filter(item => !next.discussionEdges.some(candidate => candidate.id === item.id));
  const ownedMessageIds = new Set(previous.messages.filter(message => message.nodeId === purge.nodeId).map(message => message.id));
  const ownedSegmentIds = new Set(previous.segments.filter(segment => segment.nodeId === purge.nodeId).map(segment => segment.id));
  const ownedAnchorIds = new Set(previous.anchors.filter(anchor => anchor.nodeId === purge.nodeId
    || (anchor.messageId && ownedMessageIds.has(anchor.messageId))
    || (anchor.segmentId && ownedSegmentIds.has(anchor.segmentId))).map(anchor => anchor.id));
  if (removedSegments.some(segment => segment.nodeId !== purge.nodeId)
    || removedAnchors.some(anchor => !ownedAnchorIds.has(anchor.id))
    || removedEdges.some(edge => edge.source !== purge.nodeId && edge.target !== purge.nodeId && (!edge.anchorId || !ownedAnchorIds.has(edge.anchorId)))) {
    throw new Error('Purge capability may remove only relations owned by its specified node');
  }
  if (next.messages.some(message => message.nodeId === purge.nodeId)
    || next.manifests.some(manifest => manifest.nodeId === purge.nodeId)
    || next.segments.some(segment => segment.nodeId === purge.nodeId)
    || next.anchors.some(anchor => anchor.nodeId === purge.nodeId)
    || next.discussionEdges.some(edge => edge.source === purge.nodeId || edge.target === purge.nodeId)) {
    throw new Error('Purge must remove all persisted history and relations owned by its specified node');
  }
  const receipt = next.auditEvents.find(event => event.id === purge.auditReceiptId);
  if (!receipt
    || receipt.action !== 'node.purged'
    || receipt.entityType !== 'node'
    || receipt.entityId !== purge.nodeId
    || receipt.nodeId !== purge.nodeId
    || typeof receipt.metadata.reason !== 'string'
    || !receipt.metadata.reason.trim()
    || previous.auditEvents.some(event => event.id === receipt.id)) {
    throw new Error('Purge requires a new node.purged audit receipt for the specified node');
  }
  if (receipt.metadata.reason !== 'provided-redacted') throw new Error('Purge audit reason must be redacted');
  if (!isRedactedPurgeAuditMetadata(receipt.metadata)) throw new Error('Purge audit metadata must be redacted');
}

export function isRedactedPurgeAuditMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const metadata = value as Record<string, unknown>;
  const counts = metadata.removed;
  return metadata.reason === 'provided-redacted'
    && Object.keys(metadata).every(key => ['reason', 'confirmation', 'removed'].includes(key))
    && (metadata.confirmation === undefined || metadata.confirmation === 'explicit-id-phrase')
    && (counts === undefined || (counts !== null && typeof counts === 'object' && !Array.isArray(counts)
      && [Object.prototype, null].includes(Object.getPrototypeOf(counts))
      && Object.entries(counts).every(([key, count]) => ['nodes', 'messages', 'segments', 'manifests', 'anchors'].includes(key)
        && typeof count === 'number' && Number.isSafeInteger(count) && count >= 0)));
}

export class WorkspaceStore implements WorkspaceRepository {
  private queue: Promise<void> = Promise.resolve();
  private readonly scoped = new Map<string, WorkspaceStore>();

  constructor(private readonly filePath = resolve('var/data/workspace.json'), private readonly scopedFile = false, readonly defaultWorkspaceId = '00000000-0000-4000-8000-000000000001') {}

  forWorkspace(workspaceId: string): WorkspaceRepository {
    if (workspaceId === this.defaultWorkspaceId) return this;
    let scoped = this.scoped.get(workspaceId);
    if (!scoped) { scoped = new WorkspaceStore(resolve(dirname(this.filePath), 'workspaces', `${workspaceId}.json`), true, this.defaultWorkspaceId); this.scoped.set(workspaceId, scoped); }
    return scoped;
  }

  async initialize(workspace: WorkspaceData): Promise<WorkspaceData> {
    let result!: WorkspaceData;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      try {
        result = this.normalize(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<WorkspaceData>);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        await this.write(workspace);
        result = workspace;
      }
    });
    await this.queue;
    return result;
  }

  readonly workspaceDirectory: WorkspaceDirectoryPort = {
    isOwner: async (userId, workspaceId) => (await this.readDirectory()).some(item => item.workspaceId === workspaceId && item.createdBy === userId),
    listWorkspaces: async (userId, includeArchived = false) => (await this.readDirectory()).filter(item => item.createdBy === userId && (includeArchived || item.status === 'active')),
    createWorkspace: record => this.inDirectoryQueue(async () => {
      const records = await this.readDirectory();
      const existing = records.find(item => item.workspaceId === record.workspaceId);
      if (existing) return { record: existing, created: false };
      await this.writeDirectory([...records, record]);
      return { record, created: true };
    }),
    updateWorkspace: (record, expectedRevision) => this.inDirectoryQueue(async () => {
      const records = await this.readDirectory();
      const current = records.find(item => item.workspaceId === record.workspaceId);
      if (!current || current.revision !== expectedRevision) return undefined;
      await this.writeDirectory(records.map(item => item.workspaceId === record.workspaceId ? record : item));
      return record;
    }),
    ensureWorkspace: record => this.inDirectoryQueue(async () => {
      const records = await this.readDirectory();
      const existing = records.find(item => item.workspaceId === record.workspaceId);
      if (existing) return existing;
      await this.writeDirectory([...records, record]);
      return record;
    }),
  };

  private directoryPath() { return `${this.filePath}.workspaces.json`; }
  private async inDirectoryQueue<T>(work: () => Promise<T>): Promise<T> {
    let result!: T;
    this.queue = this.queue.catch(() => undefined).then(async () => { result = await work(); });
    await this.queue;
    return result;
  }
  private async readDirectory(): Promise<WorkspaceRecord[]> {
    try { return JSON.parse(await readFile(this.directoryPath(), 'utf8')) as WorkspaceRecord[]; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const seed: WorkspaceRecord = { workspaceId: this.defaultWorkspaceId, name: createSeedWorkspace().projectTitle, status: 'active', createdBy: '00000000-0000-4000-8000-000000000002', revision: 1 };
      await this.writeDirectory([seed]); return [seed];
    }
  }
  private async writeDirectory(records: WorkspaceRecord[]) {
    await mkdir(dirname(this.directoryPath()), { recursive: true });
    const temporaryPath = `${this.directoryPath()}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8'); await rename(temporaryPath, this.directoryPath());
  }

  async read(): Promise<WorkspaceData> {
    try {
      return this.normalize(JSON.parse(await readFile(this.filePath, 'utf8')) as Partial<WorkspaceData>);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      if (this.scopedFile) throw Object.assign(new Error('Workspace data is missing'), { code: 'WORKSPACE_DATA_MISSING', status: 409 });
      const seed = createSeedWorkspace();
      await this.write(seed);
      return seed;
    }
  }

  private normalize(raw: Partial<WorkspaceData>): WorkspaceData {
    const fallback = createSeedWorkspace();
    const activeNodeId = raw.activeNodeId || raw.nodeId || fallback.activeNodeId;
    const now = new Date().toISOString();
    const discussionNodes = raw.discussionNodes?.length ? raw.discussionNodes : [{ id: activeNodeId, title: '信息架构方向', summary: '探索首屏的内容层级、上下文入口与专业能力的渐进呈现方式。', status: 'active' as const, kind: 'main' as const, x: 350, y: 150, createdAt: now, updatedAt: now }];
    return {
      ...fallback,
      ...raw,
      projectTitle: raw.projectTitle || fallback.projectTitle,
      nodeId: activeNodeId,
      activeNodeId,
      discussionNodes,
      discussionEdges: raw.discussionEdges || [],
      anchors: raw.anchors || [],
      messages: (raw.messages || fallback.messages).map(message => ({ ...message, nodeId: message.nodeId || activeNodeId })),
      attachments: raw.attachments || [],
      resources: raw.resources || [],
      resourceVersions: raw.resourceVersions || [],
      materializations: raw.materializations || [],
      fileChunks: raw.fileChunks || [],
      contextItems: raw.contextItems || fallback.contextItems,
      manifests: raw.manifests || [],
      segments: raw.segments || [],
      auditEvents: raw.auditEvents || [],
      mode: raw.mode || fallback.mode,
      updatedAt: raw.updatedAt || now,
    };
  }

  async update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData> {
    let result!: WorkspaceData;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      const current = await this.read();
      result = await mutator(structuredClone(current));
      validateWorkspaceHistoryUpdate(current, result, options);
      result.updatedAt = new Date().toISOString();
      const audit: AuditEvent = {
        id: randomUUID(), projectId: result.projectId, nodeId: result.activeNodeId,
        action: 'workspace.updated', entityType: 'workspace', entityId: result.projectId,
        metadata: { backend: 'json' }, createdAt: result.updatedAt,
      };
      result.auditEvents = [...(result.auditEvents || []), audit];
      await this.write(result);
    });
    await this.queue;
    return result;
  }

  private async write(data: WorkspaceData): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}
