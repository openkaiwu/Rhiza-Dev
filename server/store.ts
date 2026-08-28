import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { AuditEvent, WorkspaceData } from './domain';
import { createSeedWorkspace } from './seed';
import type { WorkspaceDirectoryPort } from './identity/workspace-directory';
import type { WorkspaceRecord } from './contracts/application';

export interface WorkspaceRepository {
  read(): Promise<WorkspaceData>;
  update(mutator: (current: WorkspaceData) => WorkspaceData | Promise<WorkspaceData>, options?: WorkspaceUpdateOptions): Promise<WorkspaceData>;
  close?(): Promise<void>;
  workspaceDirectory?: WorkspaceDirectoryPort;
  forWorkspace?(workspaceId: string): WorkspaceRepository;
  initialize?(workspace: WorkspaceData): Promise<WorkspaceData>;
  defaultWorkspaceId?: string;
}

export interface WorkspacePurgeCapability {
  nodeId: string;
  auditReceiptId: string;
}

export interface WorkspaceUpdateOptions {
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

  for (const [id, manifest] of priorManifests) {
    const candidate = nextManifests.get(id);
    if (candidate && !isDeepStrictEqual(candidate, manifest)) {
      throw new Error(`Immutable Manifest ${id} cannot be rewritten`);
    }
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
