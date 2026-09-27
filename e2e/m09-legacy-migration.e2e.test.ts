// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { expect, it } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { NodeEncryptedBlobStore } from '../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../server/infrastructure/node-host-runtime';
import { semanticChecksum, semanticStateChecksum } from '../server/infrastructure/workspace-semantic-checksum';
import { portableWorkspaceFacts } from '../server/application/portable-workspace';
import { validatePortableHistory } from '../server/application/portable-history';
import { workspaceSemanticSnapshot } from '../server/domain-journal';

it.skipIf(!process.env.DATABASE_URL)('migrates a populated PostgreSQL Workspace in bounded, repeatable batches', async () => {
  const connectionString = process.env.DATABASE_URL!;
  const admin = new Pool({ connectionString });
  const schema = `m09_migration_${randomUUID().replaceAll('-', '')}`;
  const directory = await mkdtemp(join(tmpdir(), 'rhiza-m09-migration-'));
  await admin.query(`CREATE SCHEMA ${schema}`);
  const scopedUrl = new URL(connectionString);
  scopedUrl.searchParams.set('options', `-c search_path=${schema}`);
  const database = new Pool({ connectionString: scopedUrl.toString() });
  const workspaceId = randomUUID();
  const legacy = new PostgresWorkspaceStore(database, workspaceId);
  const sealed = PostgresWorkspaceStore.fromConnectionString(scopedUrl.toString(), workspaceId, directory);
  const uploadDirectory = join(directory, 'uploads');
  const rawBlobs = new NodeFilesystemBlobStore(uploadDirectory);
  const encryptedBlobs = NodeEncryptedBlobStore.atDirectory(uploadDirectory);
  try {
    for (const migration of await loadMigrations()) await database.query(migration.sql);
    await legacy.read();
    await legacy.workspaceDirectory.ensureWorkspace({ workspaceId, name: 'Migration fixture', status: 'active', createdBy: randomUUID(), revision: 1 });
    const resourceId = randomUUID(), versionId = randomUUID();
    const bytes = new TextEncoder().encode('legacy resource bytes');
    const raw = await rawBlobs.put(bytes);
    const createdAt = new Date().toISOString();
    await legacy.update(current => ({ ...current,
      resources: [...current.resources, { id: resourceId, workspaceId, kind: 'attachment', logicalName: 'legacy resource', createdAt }],
      resourceVersions: [...current.resourceVersions, { id: versionId, resourceId, version: 1, digestAlgorithm: 'sha256',
        digest: raw.digest, canonicalization: 'raw-v1', mediaType: 'text/plain', size: raw.size, blobRef: raw.blobRef, createdAt }],
    }));
    await legacy.backfillJournal();
    const checksum = semanticChecksum(await legacy.read());
    const before = await legacy.auditLegacyPlaintextReplicas();
    for (const family of ['receipt_results', 'journal_payloads', 'messages', 'nodes', 'segments', 'context_items', 'resources', 'resource_blobs'] as const) {
      expect(before[family]).toBeGreaterThan(0);
    }
    await sealed.acquireRuntimeOwnership();
    const methods = [
      'sealLegacyReceiptResults', 'sealLegacyJournalPayloads', 'sealLegacyMessageContent',
      'sealLegacyNodeContent', 'sealLegacySegmentContent', 'sealLegacyContextItems', 'sealLegacyResourceContent',
    ] as const;
    for (const method of methods) {
      let migrated = 0;
      let batch: number;
      do { batch = await sealed[method](1); migrated += batch; } while (batch === 1);
      expect(migrated).toBe(before[{
        sealLegacyReceiptResults: 'receipt_results', sealLegacyJournalPayloads: 'journal_payloads',
        sealLegacyMessageContent: 'messages', sealLegacyNodeContent: 'nodes',
        sealLegacySegmentContent: 'segments', sealLegacyContextItems: 'context_items',
        sealLegacyResourceContent: 'resources',
      }[method]]);
      expect(await sealed[method](1)).toBe(0);
    }
    expect(semanticChecksum(await sealed.read())).toBe(checksum);
    expect(await sealed.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(1);
    expect(await sealed.sealLegacyResourceBlobs(rawBlobs, encryptedBlobs, 1)).toBe(0);
    expect(Object.values(await sealed.auditLegacyPlaintextReplicas()).every(count => count === 0)).toBe(true);
    const version = (await sealed.read()).resourceVersions.find(item => item.id === versionId)!;
    expect(version.blobRef).toMatch(/^sealed-v1\//);
    expect(Buffer.from(await encryptedBlobs.read(version.blobRef, version.digest))).toEqual(Buffer.from(bytes));
    const portable = portableWorkspaceFacts(await sealed.readPortableWorkspace(), input => semanticStateChecksum(input as Record<string, unknown>));
    expect(validatePortableHistory(portable, semanticStateChecksum)).toBe(semanticStateChecksum(workspaceSemanticSnapshot(portable.workspace)));
    expect(await sealed.reclaimLegacyResourceFiles(uploadDirectory, encryptedBlobs, 1)).toEqual({ resourceBlobs: 1, attachments: 0 });
    expect(await sealed.reclaimLegacyResourceFiles(uploadDirectory, encryptedBlobs, 1)).toEqual({ resourceBlobs: 0, attachments: 0 });
    expect(Buffer.from(await encryptedBlobs.read(version.blobRef, version.digest))).toEqual(Buffer.from(bytes));
  } finally {
    await sealed.close();
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
    await rm(directory, { recursive: true, force: true });
  }
}, 60_000);
