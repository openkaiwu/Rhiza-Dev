import type { PortableWorkspaceFacts } from '../application/ports/portable-workspace';
import type { BundleIndex } from '../domain/portable-bundle';
import { BUNDLE_LIMITS, bundleError, type BundleLimits } from '../domain/portable-bundle';
import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { NodeFilesystemBlobStore } from './node-host-runtime';
import { NodeContentKeys } from './node-content-keys';
import { NodeSealedContentStore, type SealedContentRef } from './node-sealed-content-store';
import { stageBundleArchive, type StagedBundleArchive } from './bundle-archive';
import { semanticStateChecksum } from './workspace-semantic-checksum';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { portableWorkspaceSchema, portableWorkspaceV2Schema, portableCollaborationSchema, portableSemanticDeltaSchema } from '../domain/portable-workspace-schema';
import { validatePortableCollaborations } from '../application/portable-collaboration';
import journalSchema from '../contracts/domain-event-envelope.schema.json';
import { validatePortableReferences } from '../application/portable-references';
import { validatePortableHistory } from '../application/portable-history';
import { applySemanticChanges } from '../domain-journal';
import type { BlobStorePort } from '../application/ports/host-runtime';

interface PortableDocument {
  facts: PortableWorkspaceFacts;
  runtimeSnapshots: Array<{ id: string; runRef: string; digest: string }>;
  providerEndpoints: Array<{ id: string; runRef: string; providerType: string; configurationVersion: string | null }>;
  modelSpecs: Array<{ id: string; runRef: string; model: string; provider: string }>;
}
const ajv = new Ajv2020({ strict: true });
addFormats(ajv); ajv.addSchema(journalSchema);
// Only the locally shipped schema is executable; schemas included in archives are documentation.
const validateDocument = ajv.compile<PortableDocument>(portableWorkspaceSchema);
const validateDocumentV2 = ajv.compile<PortableDocument>(portableWorkspaceV2Schema);
const validateCollaboration = ajv.compile(portableCollaborationSchema);
const validateSemanticFields = ajv.compile(portableSemanticDeltaSchema);

export interface StagedPortableWorkspace extends StagedBundleArchive { facts: PortableWorkspaceFacts }

interface RetainedArchiveRef { version: 1; contentId: string; reference: SealedContentRef }

/** Separate from resource GC; recovery archives have independent scoped keys. */
export class NodeImportArchiveStore {
  private readonly content: NodeSealedContentStore;
  private readonly blobs: NodeFilesystemBlobStore;
  constructor(private readonly root: string) {
    this.blobs = new NodeFilesystemBlobStore(root);
    this.content = new NodeSealedContentStore(this.blobs, new NodeContentKeys(join(root, 'keys')));
  }
  private descriptorPath(digest: string) { return join(this.root, 'retained', `${digest}.json`); }
  private transientRoot() { return join(this.root, 'transient'); }
  private legacyPath(digest: string) { return join(this.root, 'blobs', 'sha256', digest.slice(0, 2), digest); }
  private identity(contentId: string) { return { workspaceId: 'rhiza-bundle-import', contentId }; }
  private async descriptor(digest: string): Promise<RetainedArchiveRef | undefined> {
    const path = this.descriptorPath(digest);
    let file: Awaited<ReturnType<typeof lstat>>;
    try { file = await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    if (!file.isFile()) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
    let bytes: Buffer;
    try { bytes = await readFile(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
    let value: RetainedArchiveRef;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as RetainedArchiveRef; }
    catch { throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID'); }
    const ciphertext = value?.reference?.ciphertext;
    if (value?.version !== 1 || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.contentId)
      || value.reference?.version !== 1 || value.reference.digest !== digest
      || !Number.isSafeInteger(value.reference.size) || value.reference.size < 0 || value.reference.size > BUNDLE_LIMITS.maxArchiveBytes
      || ciphertext?.digestAlgorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(ciphertext.digest)
      || ciphertext.blobRef !== `sha256/${ciphertext.digest.slice(0, 2)}/${ciphertext.digest}`
      || ciphertext.size !== value.reference.size + 29) {
      throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
    }
    return value;
  }
  async retain(path: string, expectedDigest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    const file = await stat(path);
    if (!file.isFile() || file.size > BUNDLE_LIMITS.maxArchiveBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
    const existing = await this.descriptor(expectedDigest);
    if (existing) {
      for await (const chunk of this.content.readStream(this.identity(existing.contentId), existing.reference)) void chunk;
      const refreshed = new Date();
      await utimes(this.descriptorPath(expectedDigest), refreshed, refreshed);
      return;
    }
    const contentId = randomUUID();
    let reference: SealedContentRef;
    try { reference = await this.content.putStream(this.identity(contentId), createReadStream(path), file.size, expectedDigest); }
    catch (error) {
      if ((error as Error).message === 'CONTENT_DIGEST_MISMATCH') throw bundleError('BUNDLE_ARCHIVE_DIGEST_MISMATCH');
      throw error;
    }
    const directory = join(this.root, 'retained');
    const temporary = join(directory, `${randomUUID()}.tmp`);
    let published = false;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify({ version: 1, contentId, reference })); await handle.sync(); }
      finally { await handle.close(); }
      try { await link(temporary, this.descriptorPath(expectedDigest)); published = true; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const winner = await this.descriptor(expectedDigest);
        if (!winner) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
        for await (const chunk of this.content.readStream(this.identity(winner.contentId), winner.reference)) void chunk;
        await this.content.destroy(this.identity(contentId));
      }
      const parent = await open(directory, 'r');
      try { await parent.sync(); } finally { await parent.close(); }
    } catch (error) {
      if (!published) {
        try { await this.content.destroy(this.identity(contentId)); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'BUNDLE_ARCHIVE_PUBLICATION_CLEANUP_FAILED', { cause: cleanup }); }
      }
      throw error;
    } finally { await rm(temporary, { force: true }); }
  }
  async stage(digest: string): Promise<StagedPortableWorkspace> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    const retained = await this.descriptor(digest);
    if (!retained) throw bundleError('BUNDLE_RETAINED_ARCHIVE_MISSING');
    await mkdir(this.transientRoot(), { recursive: true, mode: 0o700 });
    const directory = await mkdtemp(join(this.transientRoot(), 'rhiza-bundle-recovery-'));
    let staged: StagedPortableWorkspace | undefined;
    try {
      const archivePath = join(directory, 'archive.rhiza');
      await pipeline(Readable.from(this.content.readStream(this.identity(retained.contentId), retained.reference)), createWriteStream(archivePath, { flags: 'wx', mode: 0o600 }));
      staged = await stagePortableWorkspace(archivePath, BUNDLE_LIMITS, this.transientRoot());
      if (staged.archiveDigest !== digest) throw bundleError('BUNDLE_ARCHIVE_DIGEST_MISMATCH');
      const ready = staged;
      return { ...ready, dispose: async () => { try { await ready.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } } };
    } catch (error) { try { await staged?.dispose(); } finally { await rm(directory, { recursive: true, force: true }); } throw error; }
  }

  /** Idempotent crypto-shred; descriptor removal is left to reclaim after the key tombstone is durable. */
  async revoke(digest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    const retained = await this.descriptor(digest);
    if (retained) await this.content.destroy(this.identity(retained.contentId));
  }

  /** Under the import-digest lock, free a descriptor whose old Purge key is already revoked. */
  async releaseRevoked(digest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    const retained = await this.descriptor(digest);
    if (!retained) return;
    const state = (await this.content.auditKeys([this.identity(retained.contentId)])).find(item => item.referenced)?.state;
    if (state === 'active') return;
    if (state !== 'revoked') throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
    await rm(this.descriptorPath(digest));
    const directory = await open(join(this.root, 'retained'), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  }

  async assertNoLegacyPlaintext(digest: string): Promise<void> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    try { await lstat(this.legacyPath(digest)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    throw bundleError('BUNDLE_LEGACY_ARCHIVE_PRESENT');
  }

  /** Convert a pre-encryption retained ZIP before orphan collection can remove it. */
  async migrateLegacy(digest: string): Promise<boolean> {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw bundleError('BUNDLE_INVALID_ARCHIVE_DIGEST');
    const path = this.legacyPath(digest);
    let file: Awaited<ReturnType<typeof lstat>>;
    try { file = await lstat(path); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
    if (!file.isFile()) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
    const legacy = await stagePortableWorkspace(path, BUNDLE_LIMITS, this.transientRoot());
    try {
      if (legacy.archiveDigest !== digest) throw bundleError('BUNDLE_ARCHIVE_DIGEST_MISMATCH');
      if (!await this.descriptor(digest)) await this.retain(path, digest);
      const encrypted = await this.stage(digest);
      try {
        if (semanticStateChecksum({ facts: encrypted.facts }) !== semanticStateChecksum({ facts: legacy.facts })) throw bundleError('BUNDLE_ARCHIVE_DIGEST_MISMATCH');
      } finally { await encrypted.dispose(); }
      await rm(path);
      return true;
    } finally { await legacy.dispose(); }
  }

  /** Maintenance only: caller owns the runtime and supplies every live checkpoint pin. */
  async reclaim(pinnedDigests: ReadonlySet<string>, recoveryWindowMs: number, now = Date.now()) {
    if (!Number.isSafeInteger(recoveryWindowMs) || recoveryWindowMs < 0) throw new Error('BUNDLE_RECOVERY_WINDOW_INVALID');
    const transient = this.transientRoot();
    const abandoned = await readdir(transient, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of abandoned) {
      if (entry.isDirectory() && /^rhiza-bundle-(upload|stage|recovery|export)-/.test(entry.name)) {
        await rm(join(transient, entry.name), { recursive: true, force: true });
      }
    }
    const directory = join(this.root, 'retained');
    const names = await readdir(directory).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const live = new Set<string>();
    let released = 0;
    for (const name of names.sort()) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const digest = name.slice(0, 64);
      const file = await lstat(this.descriptorPath(digest));
      if (!file.isFile()) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
      const retained = await this.descriptor(digest);
      if (!retained) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
      const keyState = (await this.content.auditKeys([this.identity(retained.contentId)])).find(item => item.referenced)?.state;
      if (keyState === 'revoked') {
        await rm(this.descriptorPath(digest));
        released += 1;
        continue;
      }
      if (pinnedDigests.has(digest) || now - file.mtimeMs < recoveryWindowMs) {
        live.add(digest);
        continue;
      }
      await this.content.destroy(this.identity(retained.contentId));
      await rm(this.descriptorPath(digest));
      released += 1;
    }
    const active = await Promise.all([...live].map(digest => this.descriptor(digest)));
    const descriptors = active.filter((item): item is RetainedArchiveRef => !!item);
    if (descriptors.length !== live.size) throw bundleError('BUNDLE_RETAINED_ARCHIVE_INVALID');
    await this.content.revokeUnreferencedKeys(descriptors.map(item => this.identity(item.contentId)));
    const garbage = await this.blobs.collectOrphans(new Set(descriptors.map(item => item.reference.ciphertext.blobRef)), recoveryWindowMs, now);
    return { released, retained: live.size, deletedCiphertexts: garbage.deleted.length };
  }
}

/** Re-running after interruption re-verifies existing content; it never replaces corrupt blobs. */
export async function ingestPortableBlobs(staged: StagedPortableWorkspace, blobs: BlobStorePort): Promise<string[]> {
  if (!blobs.putStream) throw bundleError('BUNDLE_STREAMING_STORAGE_REQUIRED');
  const refs: string[] = [];
  for (const entry of staged.index.entries) {
    if (!entry.path.startsWith('blobs/sha256/')) continue;
    const source = staged.files.get(entry.path);
    if (!source) throw bundleError('BUNDLE_MISSING_CONTENT');
    const result = await blobs.putStream(createReadStream(source), entry.digest.slice(7), entry.size);
    refs.push(result.blobRef);
  }
  return refs;
}

/** Rebind portable content-addressed blobs to target-scoped ResourceVersion identities. */
export async function ingestPortableWorkspace(staged: StagedPortableWorkspace, blobs: BlobStorePort): Promise<PortableWorkspaceFacts> {
  if (!blobs.putStream) throw bundleError('BUNDLE_STREAMING_STORAGE_REQUIRED');
  const facts = structuredClone(staged.facts);
  const byVersion = new Map(facts.workspace.resourceVersions.map(version => [version.id, version]));
  for (const version of facts.workspace.resourceVersions) {
    if (version.purgedAt) continue;
    const path = `blobs/sha256/${version.digest}`;
    const source = staged.files.get(path);
    const entry = staged.index.entries.find(item => item.path === path);
    if (!source || !entry || entry.size !== version.size) throw bundleError('BUNDLE_MISSING_CONTENT');
    const stored = await blobs.putStream(createReadStream(source), version.digest, version.size, {
      workspaceId: facts.workspace.projectId,
      contentId: version.id,
    });
    if (stored.digest !== version.digest || stored.size !== version.size) throw bundleError('BUNDLE_DIGEST_MISMATCH');
    version.blobRef = stored.blobRef;
  }
  for (const attachment of facts.workspace.attachments) {
    const version = attachment.resourceVersionId ? byVersion.get(attachment.resourceVersionId) : undefined;
    if (!version || version.digest !== attachment.digest) throw bundleError('BUNDLE_BROKEN_REFERENCES');
    attachment.blobRef = version.blobRef;
  }
  const byAttachment = new Map(facts.workspace.attachments.map(attachment => [attachment.id, attachment]));
  for (const run of facts.runs) {
    if (!run.input.request.attachments?.length) continue;
    for (const attachment of run.input.request.attachments) {
      const current = byAttachment.get(attachment.id);
      const version = byVersion.get(attachment.resourceVersionId ?? '');
      if (!current || !version || version.purgedAt || current.resourceId !== version.resourceId
        || version.resourceId !== attachment.resourceId || version.digest !== attachment.digest || version.size !== attachment.size) throw bundleError('BUNDLE_BROKEN_REFERENCES');
      attachment.blobRef = version.blobRef;
    }
    run.inputHash = semanticStateChecksum(run.input as unknown as Record<string, unknown>);
  }
  for (const event of facts.journal) {
    const record = event.payload.collaboration as import('../contracts/collaboration').CollaborationRecord | undefined;
    if (!record) continue;
    for (const base of [record.base, ...record.attempts.map(attempt => attempt.input.base)]) {
      for (const attachment of base.attachments ?? []) {
        const version = byVersion.get(attachment.resourceVersionId ?? '');
        if (!version || version.purgedAt || version.digest !== attachment.digest) throw bundleError('BUNDLE_BROKEN_COLLABORATION');
        attachment.blobRef = version.blobRef;
      }
    }
  }
  // Journal snapshots/deltas are another copy of attachment locations. Rebind them as well,
  // or the first local command after import starts from a different state than Journal replay.
  let originalState: Record<string, unknown> | undefined;
  let reboundState: Record<string, unknown> | undefined;
  const rebindState = (state: Record<string, unknown>) => {
    for (const key of ['resourceVersions', 'attachments'] as const) {
      const values = state[key] as Array<Record<string, unknown>> | undefined;
      for (const value of values ?? []) {
        const id = key === 'resourceVersions' ? value.id : value.resourceVersionId;
        const version = typeof id === 'string' ? byVersion.get(id) : undefined;
        if (!version || version.digest !== value.digest || version.resourceId !== value.resourceId || version.size !== value.size)
          throw bundleError('BUNDLE_BROKEN_REFERENCES');
        value.blobRef = version.blobRef;
      }
    }
  };
  for (const event of facts.journal) {
    const snapshot = event.payload.snapshot as { state?: Record<string, unknown> } | undefined;
    const changes = event.payload.stateChanges as Record<string, unknown> | undefined;
    if (snapshot?.state) originalState = structuredClone(snapshot.state);
    if (originalState && changes) applySemanticChanges(originalState, structuredClone(changes));
    if (event.payload.portableStateChecksum !== undefined && (!originalState || event.payload.portableStateChecksum !== semanticStateChecksum(originalState)))
      throw bundleError('BUNDLE_EVENT_STATE_MISMATCH');
    if (snapshot?.state) { rebindState(snapshot.state); reboundState = structuredClone(snapshot.state); }
    if (changes) { rebindState(changes); if (reboundState) applySemanticChanges(reboundState, changes); }
    if (reboundState) event.payload.portableStateChecksum = semanticStateChecksum(reboundState);
  }
  return facts;
}

/** Owns temporary files until the caller activates or abandons the import. No live store writes. */
export async function stagePortableWorkspace(path: string, limits: BundleLimits = BUNDLE_LIMITS, stagingRoot = tmpdir()): Promise<StagedPortableWorkspace> {
  const staged = await stageBundleArchive(path, limits, stagingRoot);
  try {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of createReadStream(staged.files.get(staged.index.root)!)) {
      bytes += chunk.length;
      if (bytes > limits.maxDocumentBytes) throw bundleError('BUNDLE_QUOTA_EXCEEDED');
      chunks.push(chunk);
    }
    let value: unknown;
    try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw bundleError('BUNDLE_INVALID_DOCUMENT'); }
    const pending = [{ value, depth: 0 }];
    while (pending.length) {
      const current = pending.pop()!;
      if (current.depth > 128) throw bundleError('BUNDLE_DOCUMENT_TOO_DEEP');
      if (current.value && typeof current.value === 'object') {
        for (const [key, child] of Object.entries(current.value)) {
          if (['__proto__', 'constructor', 'prototype'].includes(key)) throw bundleError('BUNDLE_INVALID_DOCUMENT');
          pending.push({ value: child, depth: current.depth + 1 });
        }
      }
    }
    return { ...staged, facts: decodePortableDocument(value, staged.index) };
  } catch (error) { await staged.dispose(); throw error; }
}

export function decodePortableDocument(value: unknown, index: BundleIndex): PortableWorkspaceFacts {
  const v2 = !!value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion === '2.0.0';
  if (v2 ? !validateDocumentV2(value) : !validateDocument(value)) throw bundleError('BUNDLE_INVALID_DOCUMENT');
  const document = value as PortableDocument;
  const { facts, runtimeSnapshots, providerEndpoints, modelSpecs } = document;
  for (const event of facts.journal) {
    if (event.eventType === 'collaboration.changed' && (!v2 || (event.payload.collaboration !== undefined && !validateCollaboration(event.payload.collaboration)))) throw bundleError('BUNDLE_INVALID_COLLABORATION');
    const snapshot = event.payload.snapshot as { state?: unknown } | undefined;
    if ((snapshot && !validateSemanticFields(snapshot.state))
      || (event.payload.stateChanges !== undefined && !validateSemanticFields(event.payload.stateChanges))) throw bundleError('BUNDLE_INVALID_HISTORY_DELTA');
  }
  validatePortableReferences(facts);
  validatePortableCollaborations(facts, semanticStateChecksum);
  validatePortableContent(facts, index);
  validatePortableHistory(facts, semanticStateChecksum);
  const byRun = <T extends { runRef: string }>(items: T[]) => {
    const result = new Map(items.map(item => [item.runRef, item]));
    if (result.size !== items.length || result.size !== facts.runs.length) throw bundleError('BUNDLE_DESCRIPTOR_MISMATCH');
    return result;
  };
  const snapshots = byRun(runtimeSnapshots), endpoints = byRun(providerEndpoints), models = byRun(modelSpecs);
  for (const run of facts.runs) {
    const snapshot = snapshots.get(run.id), endpoint = endpoints.get(run.id), model = models.get(run.id);
    if (snapshot?.id !== `run:${run.id}:input:${run.originInputHash ?? run.inputHash}` || snapshot.digest !== `sha256:${run.inputHash}`
      || endpoint?.id !== run.input.executor.providerEndpointRef || endpoint.providerType !== run.input.executor.provider
      || endpoint.configurationVersion !== (run.input.request.modelSnapshot?.endpointVersion ?? null)
      || model?.id !== run.input.executor.modelSpecRef || model.model !== run.input.executor.model || model.provider !== run.input.executor.provider) {
      throw bundleError('BUNDLE_DESCRIPTOR_MISMATCH');
    }
  }
  return structuredClone(facts);
}

/** Run after archive digest verification and document schema decoding, before activation. */
export function validatePortableContent(facts: PortableWorkspaceFacts, index: BundleIndex): void {
  if (facts.workspace.projectId !== index.workspaceId) throw bundleError('BUNDLE_WORKSPACE_MISMATCH');
  const entries = new Map(index.entries.map(entry => [entry.path, entry]));
  const requireBlob = (digest: string, size?: number) => {
    const entry = entries.get(`blobs/sha256/${digest}`);
    if (!entry || entry.digest !== `sha256:${digest}`) throw bundleError('BUNDLE_MISSING_CONTENT');
    if (size !== undefined && entry.size !== size) throw bundleError('BUNDLE_SIZE_MISMATCH');
  };
  for (const version of facts.workspace.resourceVersions) if (!version.purgedAt) requireBlob(version.digest, version.size);
  for (const run of facts.runs) {
    if (semanticStateChecksum({ ...run.input }) !== run.inputHash) throw bundleError('BUNDLE_RUNTIME_DIGEST_MISMATCH');
    requireBlob(run.inputHash);
  }
}
