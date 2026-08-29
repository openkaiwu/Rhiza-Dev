// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { NodeHostRuntimeAdapter } from '../server/infrastructure/node-host-runtime';
import { backfillWorkspaceResources } from '../server/infrastructure/resource-backfill';
import { PostgresWorkspaceStore } from '../server/postgres-store';

async function migratedDatabase() {
  const database = new PGlite();
  for (const migration of ['0001_rhiza_core', '0002_chat_parity', '0003_domain_persistence', '0004_immutable_manifest_history', '0005_identity_workspace_scope', '0006_resource_blob_host']) {
    await database.exec(await readFile(resolve(`db/migrations/${migration}.up.sql`), 'utf8'));
  }
  return database;
}

describe('Resource attachment backfill E2E', () => {
  it('is idempotent, leaves no dangling references and rejects digest corruption', async () => {
    const database = await migratedDatabase();
    const directory = await mkdtemp(join(tmpdir(), 'rhiza-resource-e2e-'));
    const workspaceId = randomUUID();
    const attachmentId = randomUUID();
    try {
      const store = new PostgresWorkspaceStore(database, workspaceId);
      const seed = await store.read();
      await writeFile(join(directory, attachmentId), 'backfill bytes');
      await store.update(current => ({ ...current, attachments: [{ id: attachmentId, name: 'legacy.txt', mimeType: 'text/plain', size: 14, kind: 'file', createdAt: seed.updatedAt }] }));
      const host = new NodeHostRuntimeAdapter(directory);
      const first = await backfillWorkspaceResources(store, host);
      const second = await backfillWorkspaceResources(store, host);
      expect(first).toMatchObject({ migrated: 1, dangling: 0 });
      expect(second).toMatchObject({ migrated: 0, dangling: 0, checksum: first.checksum });
      const dangling = await database.query<{ count: number }>(`SELECT count(*)::int count FROM rhiza_attachments a LEFT JOIN rhiza_resources r ON r.resource_id=a.resource_id LEFT JOIN rhiza_resource_versions rv ON rv.resource_version_id=a.resource_version_id WHERE a.project_id=$1 AND (r.resource_id IS NULL OR rv.resource_version_id IS NULL)`, [workspaceId]);
      expect(dangling.rows).toEqual([{ count: 0 }]);
      const recovered = await new PostgresWorkspaceStore(database, workspaceId).read();
      const attachment = recovered.attachments[0];
      expect(recovered.resourceVersions).toHaveLength(1);
      await writeFile(join(directory, 'blobs', ...attachment.blobRef!.split('/')), 'corrupt');
      await expect(host.blobs.read(attachment.blobRef!, attachment.digest!)).rejects.toMatchObject({ code: 'BLOB_INTEGRITY_ERROR' });
      await expect(database.query('UPDATE rhiza_resource_versions SET digest=$2 WHERE resource_version_id=$1', [attachment.resourceVersionId, 'b'.repeat(64)])).rejects.toThrow('immutable');
    } finally {
      await database.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
