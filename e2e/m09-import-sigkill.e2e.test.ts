// @vitest-environment node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { completeBundleImport } from '../server/application/prepare-bundle-import';
import { NodeContentKeys } from '../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { NodePortableBundle } from '../server/infrastructure/portable-bundle';
import { NodeSealedContentStore } from '../server/infrastructure/node-sealed-content-store';
import { ingestPortableWorkspace, NodeImportArchiveStore, stagePortableWorkspace } from '../server/infrastructure/portable-content';
import { RepositoryWorkspaceUnitOfWork } from '../server/infrastructure/workspace-repository-unit-of-work';
import { semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import type { BundleImportIdentity } from '../server/application/ports/bundle-import';
import type { ExecutionRun } from '../server/execution-runtime/run';

for (const backend of ['embedded', 'postgres'] as const) describe.skipIf(backend === 'postgres' && !process.env.DATABASE_URL)(`M09 import SIGKILL recovery (${backend})`, () => {
it.each(['validated', 'blobs-ready', 'activating'] as const)('resumes an import after SIGKILL at %s checkpoint', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-import-sigkill-'));
  const source = await openEmbeddedWorkspaceStore(join(root, 'source'));
  let child: ReturnType<typeof spawn> | undefined;
  let admin: Pool | undefined;
  let schema: string | undefined;
  try {
    const workspace = await source.read();
    await source.workspaceDirectory.ensureWorkspace({ workspaceId: workspace.projectId, name: 'Crash fixture', status: 'active', createdBy: LOCAL_USER_ID, revision: 1 });
    const bytes = new TextEncoder().encode('frozen content survives a process kill');
    const sourceBlobs = new NodeFilesystemBlobStore(join(root, 'source-uploads'));
    const stored = await sourceBlobs.put(bytes);
    const createdAt = new Date().toISOString();
    const attachment = { id: randomUUID(), name: 'crash.txt', mimeType: 'text/plain', size: stored.size, kind: 'file' as const,
      resourceId: 'crash-resource', resourceVersionId: 'crash-version', digest: stored.digest, blobRef: stored.blobRef, createdAt };
    await source.update(current => ({ ...current,
      attachments: [...current.attachments, attachment],
      resources: [...current.resources, { id: 'crash-resource', workspaceId: current.projectId, kind: 'attachment', logicalName: 'Crash fixture', createdAt },
        { id: 'purged-resource', workspaceId: current.projectId, kind: 'attachment', logicalName: '[purged]', createdAt }],
      resourceVersions: [...current.resourceVersions, { id: 'crash-version', resourceId: 'crash-resource', version: 1,
        digestAlgorithm: 'sha256', digest: stored.digest, canonicalization: 'raw-v1', mediaType: 'text/plain', size: stored.size, blobRef: stored.blobRef, createdAt },
        { id: 'purged-version', resourceId: 'purged-resource', version: 1, digestAlgorithm: 'sha256', digest: 'a'.repeat(64),
          canonicalization: 'raw-v1', mediaType: 'text/plain', size: 9, blobRef: 'purged-v1', createdAt, purgedAt: createdAt }],
    }));
    await source.backfillJournal();
    const runId = randomUUID();
    const input = { schemaVersion: '1.0.0' as const, request: { requestId: runId, manifestId: 'uncommitted-manifest', projectId: workspace.projectId,
      nodeId: workspace.activeNodeId, modelId: 'model', prompt: 'attachment replay fixture', history: [], contextItems: [], mode: 'Strict' as const,
      attachments: [structuredClone(attachment)] }, executor: { runtime: 'provider-adapter', modelSpecRef: 'model', providerEndpointRef: 'endpoint', model: 'model', provider: 'Provider' } };
    const run: ExecutionRun = { id: runId, commandId: runId, workspaceId: workspace.projectId, nodeId: workspace.activeNodeId,
      status: 'created', attempt: 1, input, inputHash: semanticStateChecksum(input), createdAt, telemetry: { traceCount: 0 } };
    const command = (commandId: string) => ({ commandId, commandType: 'TestRun', actor: { actorType: 'human' as const, actorId: LOCAL_USER_ID },
      scope: { scopeType: 'workspace' as const, scopeId: workspace.projectId }, occurredAt: createdAt });
    const unchanged = async (current: Awaited<ReturnType<typeof source.read>>) => ({ next: current, value: {} });
    const events = () => [{ eventType: 'workspace.renamed' as const, aggregateType: 'workspace' as const, aggregateId: workspace.projectId, payload: {} }];
    await source.executeCommand({ context: command(runId), options: { run: { kind: 'create', run } }, apply: unchanged, events });
    await source.executeCommand({ context: command(randomUUID()), options: { run: { kind: 'transition', runId, attempt: 1,
      from: ['created'], patch: { status: 'failed', terminalAt: createdAt, error: { code: 'TEST', class: 'provider', message: 'fixture' } } } }, apply: unchanged, events });
    const facts = await source.readPortableWorkspace();
    const portable = portableWorkspaceFacts(facts, value => semanticStateChecksum(value as Record<string, unknown>));
    const exported = await new NodePortableBundle(sourceBlobs).export(facts);
    const archivePath = join(root, 'workspace.rhiza');
    try { await writeFile(archivePath, exported.bytes); } finally { await exported.dispose(); }
    const staged = await stagePortableWorkspace(archivePath);
    const archiveRoot = join(root, 'retained');
    try { await new NodeImportArchiveStore(archiveRoot).retain(archivePath, staged.archiveDigest); }
    finally { await staged.dispose(); }
    const targetData = join(root, 'target');
    const targetUploads = join(root, 'target-uploads');
    let scopedUrl: string | undefined;
    if (backend === 'postgres') {
      admin = new Pool({ connectionString: process.env.DATABASE_URL });
      schema = `m09_import_${randomUUID().replaceAll('-', '')}`;
      await admin.query(`CREATE SCHEMA ${schema}`);
      const url = new URL(process.env.DATABASE_URL!);
      url.searchParams.set('options', `-c search_path=${schema}`);
      scopedUrl = url.toString();
      const migration = new Pool({ connectionString: scopedUrl });
      try { for (const entry of await loadMigrations()) await migration.query(entry.sql); }
      finally { await migration.end(); }
    }
    const openTarget = () => backend === 'postgres'
      ? Promise.resolve(PostgresWorkspaceStore.fromConnectionString(scopedUrl!, workspace.projectId, `${targetData}.content`))
      : openEmbeddedWorkspaceStore(targetData, workspace.projectId, 'verify');
    const prepared = backend === 'postgres' ? await openTarget() : await openEmbeddedWorkspaceStore(targetData, workspace.projectId);
    await prepared.close();
    const identity: BundleImportIdentity = { importId: randomUUID(), ownerId: LOCAL_USER_ID, workspaceId: workspace.projectId,
      archiveDigest: staged.archiveDigest, stateDigest: semanticStateChecksum({ facts: portable }) };
    const identityPath = join(root, 'identity.json');
    await writeFile(identityPath, JSON.stringify(identity));
    child = spawn(process.execPath, ['--import', 'tsx', resolve('e2e/fixtures/m09-import-crash-child.ts'), phase, backend,
      targetData, targetUploads, archiveRoot, identityPath], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: scopedUrl ?? '' } });
    let output = '';
    await new Promise<void>((done, fail) => {
      const timeout = setTimeout(() => fail(new Error(`CHECKPOINT_TIMEOUT:${output}`)), 30_000);
      child!.stdout!.on('data', chunk => { output += String(chunk); if (output.includes(`CHECKPOINT:${phase}`)) { clearTimeout(timeout); done(); } });
      child!.once('exit', code => { clearTimeout(timeout); fail(new Error(`CHILD_EXITED:${code}:${output}`)); });
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const target = await openTarget();
    try {
      expect(await target.bundleImportCheckpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: phase === 'validated' ? 'validated' : 'blobs-ready' });
      expect(await target.readExisting()).toBeUndefined();
      const recovered = await new NodeImportArchiveStore(archiveRoot).stage(identity.archiveDigest);
      try {
        const legacy = new NodeFilesystemBlobStore(targetUploads);
        const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
          legacy, new NodeContentKeys(join(targetUploads, 'resource-keys')),
        ), legacy);
        await completeBundleImport(identity, recovered.facts, target.bundleImportCheckpoints,
          () => ingestPortableWorkspace(recovered, blobs), new RepositoryWorkspaceUnitOfWork(target));
      } finally { await recovered.dispose(); }
      expect(await target.bundleImportCheckpoints.read(identity.importId, identity.ownerId)).toMatchObject({ phase: 'activated' });
      expect(portableWorkspaceFacts(await target.readPortableWorkspace(), value => semanticStateChecksum(value as Record<string, unknown>))).toEqual(portable);
      expect((await target.readGraphProjection()).checksum).toBe((await source.readGraphProjection()).checksum);
      const version = (await target.read()).resourceVersions.find(item => item.id === 'crash-version')!;
      expect(version.blobRef).toMatch(/^sealed-v1\//);
      expect(version.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect((await target.getRun(runId))?.input.request.attachments?.[0]?.blobRef).toBe(version.blobRef);
      expect(Buffer.from(await NodeEncryptedBlobStore.atDirectory(targetUploads).read(version.blobRef, version.digest))).toEqual(Buffer.from(bytes));
      expect((await target.read()).resourceVersions.find(item => item.id === 'purged-version'))
        .toMatchObject({ blobRef: 'purged-v1', purgedAt: createdAt });
    } finally { await target.close(); }
  } finally {
    if (child?.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    await source.close();
    if (admin && schema) { await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
});
