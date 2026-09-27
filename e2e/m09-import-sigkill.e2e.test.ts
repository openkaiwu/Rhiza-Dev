// @vitest-environment node
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { LOCAL_USER_ID } from '../server/identity/workspace-scope';
import { openEmbeddedWorkspaceStore } from '../server/embedded-store';
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

it.each(['validated', 'blobs-ready', 'activating'] as const)('resumes an import after SIGKILL at %s checkpoint', async phase => {
  const root = await mkdtemp(join(tmpdir(), 'rhiza-import-sigkill-'));
  const source = await openEmbeddedWorkspaceStore(join(root, 'source'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const workspace = await source.read();
    await source.workspaceDirectory.ensureWorkspace({ workspaceId: workspace.projectId, name: 'Crash fixture', status: 'active', createdBy: LOCAL_USER_ID, revision: 1 });
    const bytes = new TextEncoder().encode('frozen content survives a process kill');
    const sourceBlobs = new NodeFilesystemBlobStore(join(root, 'source-uploads'));
    const stored = await sourceBlobs.put(bytes);
    const createdAt = new Date().toISOString();
    await source.update(current => ({ ...current,
      resources: [...current.resources, { id: 'crash-resource', workspaceId: current.projectId, kind: 'attachment', logicalName: 'Crash fixture', createdAt }],
      resourceVersions: [...current.resourceVersions, { id: 'crash-version', resourceId: 'crash-resource', version: 1,
        digestAlgorithm: 'sha256', digest: stored.digest, canonicalization: 'raw-v1', mediaType: 'text/plain', size: stored.size, blobRef: stored.blobRef, createdAt }],
    }));
    await source.backfillJournal();
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
    const prepared = await openEmbeddedWorkspaceStore(targetData, workspace.projectId);
    await prepared.close();
    const identity: BundleImportIdentity = { importId: randomUUID(), ownerId: LOCAL_USER_ID, workspaceId: workspace.projectId,
      archiveDigest: staged.archiveDigest, stateDigest: semanticStateChecksum({ facts: portable }) };
    const identityPath = join(root, 'identity.json');
    await writeFile(identityPath, JSON.stringify(identity));
    child = spawn(process.execPath, ['--import', 'tsx', resolve('e2e/fixtures/m09-import-crash-child.ts'), phase,
      targetData, targetUploads, archiveRoot, identityPath], { cwd: resolve('.'), stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, DATABASE_URL: '' } });
    let output = '';
    await new Promise<void>((done, fail) => {
      const timeout = setTimeout(() => fail(new Error(`CHECKPOINT_TIMEOUT:${output}`)), 30_000);
      child!.stdout!.on('data', chunk => { output += String(chunk); if (output.includes(`CHECKPOINT:${phase}`)) { clearTimeout(timeout); done(); } });
      child!.once('exit', code => { clearTimeout(timeout); fail(new Error(`CHILD_EXITED:${code}:${output}`)); });
    });
    const exited = once(child, 'exit');
    child.kill('SIGKILL');
    await exited;
    const target = await openEmbeddedWorkspaceStore(targetData, workspace.projectId, 'verify');
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
      const version = (await target.read()).resourceVersions.find(item => item.id === 'crash-version')!;
      expect(version.blobRef).toMatch(/^sealed-v1\//);
      expect(version.digest).toBe(createHash('sha256').update(bytes).digest('hex'));
    } finally { await target.close(); }
  } finally {
    if (child?.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    await source.close();
    await rm(root, { recursive: true, force: true });
  }
}, 90_000);
