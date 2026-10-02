import { randomUUID } from 'node:crypto';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import type { AIRuntime } from '../server/ai-runtime';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { completeBundleImport } from '../server/application/prepare-bundle-import';
import type { BundleImportIdentity } from '../server/application/ports/bundle-import';
import type { PortableWorkspaceFacts } from '../server/application/ports/portable-workspace';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { createApp } from '../server/host-node/create-app';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { NodeBundleImport } from '../server/infrastructure/node-bundle-import';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodePortableBundle } from '../server/infrastructure/portable-bundle';
import { ingestPortableWorkspace, NodeImportArchiveStore, stagePortableWorkspace } from '../server/infrastructure/portable-content';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { ProviderService } from '../server/provider-service';
import { ProviderStore } from '../server/provider-store';
import { SecretVault } from '../server/secret-vault';
import { createSeedWorkspace } from '../server/seed';
import type { PostgresWorkspaceStore } from '../server/postgres-store';
import { inspectM10Store } from './m10-inspection';

function assert(condition: unknown, code: string): asserts condition {
  if (!condition) throw new Error(code);
}
const checksum = (facts: PortableWorkspaceFacts) => semanticStateChecksum({ facts: portableWorkspaceFacts(facts,
  value => semanticStateChecksum(value as Record<string, unknown>)) });

/** Synthetic, disposable PGlite drill. Never opens the deployment's database or Provider config. */
export async function runRestoreDrill() {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-m16-restore-'));
  const sourceUploads = join(root, 'source-uploads');
  const targetUploads = join(root, 'target-uploads');
  const sourceBlobs = NodeEncryptedBlobStore.atDirectory(sourceUploads);
  const targetBlobs = NodeEncryptedBlobStore.atDirectory(targetUploads);
  const sourceArchives = new NodeImportArchiveStore(join(sourceUploads, 'imports'));
  const targetArchives = new NodeImportArchiveStore(join(targetUploads, 'imports'));
  const source = await openEmbeddedWorkspaceStore(join(root, 'source-db'), undefined, 'apply', sourceBlobs, sourceArchives);
  let target: Awaited<ReturnType<typeof openEmbeddedWorkspaceStore>> | undefined;
  let stage = 'fixture';
  let calls = 0;
  const runtime: AIRuntime = { kind: 'provider-adapter',
    listModels: async () => ['fixture', 'reviewer'].map(id => ({ id, model: id, provider: 'Offline fixture', displayName: id, active: id === 'fixture', providerEndpointRef: `fixture-${id}` })),
    async *generate(input) {
      calls++;
      yield { type: 'RUN_END', requestId: input.requestId, text: `Offline answer ${calls}`, model: 'fixture', provider: 'Offline fixture',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 } };
    } };
  const provider = new ProviderService(new ProviderStore(join(root, 'providers')), new SecretVault(join(root, 'provider-key')),
    { baseUrl: 'https://example.test/v1', apiKey: '', model: 'fixture', providerName: 'Offline fixture', chatPath: '/chat',
      timeoutMs: 1000, temperature: 0, extraHeaders: {}, allowNoKey: true });
  try {
    await source.initialize({ ...createSeedWorkspace(), messages: [], segments: [], contextItems: [] });
    const app = createApp(source, provider, false, runtime, undefined, sourceUploads, sourceBlobs);
    await request(app).get('/api/workspace').expect(200);
    const second = await request(app).post('/api/v1/workspaces').send({ name: 'Restore drill second Workspace' }).expect(201);
    const ids = [source.defaultWorkspaceId, second.body.workspace.workspaceId as string];
    assert(ids.every(id => typeof id === 'string') && ids[0] !== ids[1], 'M16_DRILL_SCOPE_FAILED');
    for (const [index, id] of ids.entries()) {
      const scoped = source.forWorkspace(id) as PostgresWorkspaceStore;
      await scoped.backfillJournal();
      const prefix = `/api/v1/workspaces/${id}`;
      const attachment = await request(app).post(`${prefix}/attachments`).send({ name: `evidence-${index}.txt`, mimeType: 'text/plain',
        dataBase64: Buffer.from(`Frozen attachment ${index}`).toString('base64') }).expect(201);
      const first = await request(app).post(`${prefix}/chat`).send({ message: `First message ${index}`, modelId: 'fixture', attachmentIds: [attachment.body.attachment.id] }).expect(201);
      await request(app).post(`${prefix}/chat`).send({ message: `Follow-up ${index}`, modelId: 'fixture' }).expect(201);
      assert(first.body.manifest?.id, 'M16_DRILL_HISTORY_MISSING');
    }
    const collaboration = (await request(app).post('/api/collaborations').send({ prompt: 'Offline review', mode: 'independent-review', modelIds: ['fixture', 'reviewer'], synthesisModelId: 'fixture' }).expect(201)).body.collaboration;
    await request(app).post(`/api/collaborations/${collaboration.id}/invoke`).send({ participantId: 'fixture', round: 1 }).expect(201);
    await request(app).post(`/api/collaborations/${collaboration.id}/stop`).send({}).expect(200);

    const snapshots: Array<{ facts: PortableWorkspaceFacts; digest: string; path: string; graph: string }> = [];
    stage = 'export';
    for (const [index, id] of ids.entries()) {
      const scoped = source.forWorkspace(id) as PostgresWorkspaceStore;
      const facts = await scoped.readPortableWorkspace();
      const bundle = await new NodePortableBundle(sourceBlobs, root).export(facts);
      const path = join(root, `workspace-${index}.rhiza`);
      try { await pipeline(Readable.from(bundle.bytes), createWriteStream(path, { flags: 'wx', mode: 0o600 })); }
      finally { await bundle.dispose(); }
      const graph = await scoped.readGraphProjection();
      snapshots.push({ facts, digest: checksum(facts), path, graph: semanticStateChecksum({ objects: graph.objects, relations: graph.relations }) });
    }
    const callsBeforeRestore = calls;
    stage = 'restore';
    target = await openEmbeddedWorkspaceStore(join(root, 'target-db'), undefined, 'apply', targetBlobs, targetArchives);
    const receive = new NodeBundleImport(join(targetUploads, 'imports'), targetBlobs);
    let interruptedPhase = '';
    let recoveredWithoutUpload = false;
    let duplicateIngestions = 0;
    for (const [index, snapshot] of snapshots.entries()) {
      const staged = await receive.receive(createReadStream(snapshot.path));
      const identity: BundleImportIdentity = { importId: randomUUID(), ownerId: LOCAL_USER_ID, workspaceId: staged.facts.workspace.projectId,
        archiveDigest: staged.archiveDigest, stateDigest: semanticStateChecksum({ facts: staged.facts }) };
      assert(staged.facts.members.some(member => member.userId === LOCAL_USER_ID && member.role === 'owner'), 'M16_DRILL_OWNER_MISMATCH');
      try {
        await target.bundleImportCheckpoints.begin(identity);
        await target.bundleImportCheckpoints.retainArchive!(identity, staged.retain);
        if (index === 0) {
          const uow = new RepositoryWorkspaceUnitOfWork(target);
          // Deliberately stop at the durable blobs-ready boundary, before activation begins.
          uow.activatePortableImport = async () => { throw new Error('M16_DRILL_INTERRUPTED'); };
          try { await completeBundleImport(identity, staged.facts, target.bundleImportCheckpoints, staged.ingest, uow); }
          catch (error) { if (!(error instanceof Error) || error.message !== 'M16_DRILL_INTERRUPTED') throw error; }
          interruptedPhase = (await target.bundleImportCheckpoints.read(identity.importId, LOCAL_USER_ID))!.phase;
          assert(interruptedPhase === 'blobs-ready' && (await target.listWorkspaceIds()).length === 0, 'M16_DRILL_PARTIAL_ACTIVATION');
        } else {
          await completeBundleImport(identity, staged.facts, target.bundleImportCheckpoints, staged.ingest, new RepositoryWorkspaceUnitOfWork(target));
        }
      } finally { await staged.dispose(); }
      await rm(snapshot.path); // Recovery must use retained ciphertext, not the original upload.
      if (index === 0) {
        await target.close();
        target = undefined;
        target = await openEmbeddedWorkspaceStore(join(root, 'target-db'), undefined, 'verify', targetBlobs, targetArchives);
        const recovered = await targetArchives.stage(identity.archiveDigest);
        try { await completeBundleImport(identity, recovered.facts, target.bundleImportCheckpoints,
          () => ingestPortableWorkspace(recovered, targetBlobs), new RepositoryWorkspaceUnitOfWork(target)); }
        finally { await recovered.dispose(); }
        recoveredWithoutUpload = true;
      }
      // An activated checkpoint returns before ingesting bytes or dispatching any model.
      await completeBundleImport(identity, snapshot.facts, target.bundleImportCheckpoints,
        async () => { duplicateIngestions++; throw new Error('M16_DRILL_DUPLICATE_INGEST'); }, new RepositoryWorkspaceUnitOfWork(target));
    }
    const corruptPath = join(root, 'corrupt.rhiza');
    stage = 'compare';
    await writeFile(corruptPath, Buffer.from('truncated synthetic ZIP'), { mode: 0o600 });
    let corruptArchiveRejected = false;
    try { const unexpected = await stagePortableWorkspace(corruptPath); await unexpected.dispose(); }
    catch { corruptArchiveRejected = true; }
    let checksumMismatches = 0;
    const counts = { messages: 0, manifests: 0, resourceVersions: 0, collaborations: 0, provenance: 0, journal: 0 };
    for (const snapshot of snapshots) {
      const scoped = target.forWorkspace(snapshot.facts.workspace.projectId) as PostgresWorkspaceStore;
      const restored = await scoped.readPortableWorkspace();
      const graph = await scoped.readGraphProjection();
      if (checksum(restored) !== snapshot.digest || semanticStateChecksum({ objects: graph.objects, relations: graph.relations }) !== snapshot.graph) checksumMismatches++;
      for (const version of restored.workspace.resourceVersions) {
        if (version.purgedAt) continue;
        const bytes = await targetBlobs.read(version.blobRef, version.digest);
        assert(bytes.byteLength === version.size, 'M16_DRILL_ATTACHMENT_SIZE_MISMATCH');
      }
      counts.messages += restored.workspace.messages.length;
      counts.manifests += restored.workspace.manifests.length;
      counts.resourceVersions += restored.workspace.resourceVersions.length;
      counts.collaborations += (await scoped.listCollaborations()).length;
      counts.provenance += restored.provenance.length;
      counts.journal += restored.journal.length;
    }
    const originalDataUnchanged = (await Promise.all(snapshots.map(async snapshot => checksum(await (source.forWorkspace(snapshot.facts.workspace.projectId) as PostgresWorkspaceStore).readPortableWorkspace()) === snapshot.digest))).every(Boolean);
    const restoreModelCalls = calls - callsBeforeRestore;
    const restoredApp = createApp(target, provider, false, runtime, undefined, targetUploads, targetBlobs);
    stage = 'continue';
    const continued = await request(restoredApp).post('/api/chat').set('Idempotency-Key', 'restore-continued')
      .send({ message: 'Continue restored history', modelId: 'fixture' }).expect(201);
    const retried = await request(restoredApp).post('/api/chat').set('Idempotency-Key', 'restore-continued')
      .send({ message: 'Continue restored history', modelId: 'fixture' }).expect(201);
    const continuedModelCalls = calls - callsBeforeRestore - restoreModelCalls;
    const continuedConversation = continued.body.assistantMessage.id === retried.body.assistantMessage.id && continuedModelCalls === 1;
    const reconciliation = await inspectM10Store(target);
    const reconciliationPassed = reconciliation.ok;
    return { schemaVersion: '1.0.0', ok: checksumMismatches === 0 && originalDataUnchanged && reconciliationPassed && corruptArchiveRejected
      && recoveredWithoutUpload && interruptedPhase === 'blobs-ready' && duplicateIngestions === 0 && restoreModelCalls === 0 && continuedConversation,
    workspaces: (await target.listWorkspaceIds()).length, checksumMismatches, interruptedPhase, recoveredWithoutUpload,
    duplicateIngestions, restoreModelCalls, corruptArchiveRejected, originalDataUnchanged, reconciliationPassed, reconciliation, counts, continuedConversation, continuedModelCalls,
    managedBackup: 'pending', externalAcceptance: 'pending' };
  } catch (error) {
    throw Object.assign(new Error('M16_RESTORE_DRILL_FAILED', { cause: error }), { stage,
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined });
  } finally {
    try { await target?.close(); } finally { try { await source.close(); } finally { await rm(root, { recursive: true, force: true }); } }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const output = console.info;
  console.info = (...args) => console.error(...args);
  try {
    const report = await runRestoreDrill();
    output(JSON.stringify(report));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
      && /^BUNDLE_[A-Z_]{1,60}$/.test(error.code) ? error.code : 'M16_RESTORE_DRILL_FAILED';
    const stage = error && typeof error === 'object' && 'stage' in error ? error.stage : 'initialization';
    output(JSON.stringify({ schemaVersion: '1.0.0', ok: false, error: code, stage }));
    process.exitCode = 1;
  } finally { console.info = output; }
}
