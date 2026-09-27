import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openEmbeddedWorkspaceStore } from '../../server/embedded-store';
import { PostgresWorkspaceStore } from '../../server/postgres-store';
import { NodeContentKeys } from '../../server/infrastructure/node-content-keys';
import { NodeEncryptedBlobStore } from '../../server/infrastructure/node-encrypted-blob-store';
import { NodeFilesystemBlobStore } from '../../server/infrastructure/node-host-runtime';
import { NodeSealedContentStore } from '../../server/infrastructure/node-sealed-content-store';
import { ingestPortableWorkspace, NodeImportArchiveStore } from '../../server/infrastructure/portable-content';
import type { BundleImportIdentity } from '../../server/application/ports/bundle-import';
import { completeBundleImport } from '../../server/application/prepare-bundle-import';
import { RepositoryWorkspaceUnitOfWork } from '../../server/infrastructure/workspace-repository-unit-of-work';
import type { SqlQueryable } from '../../server/postgres-store';

const [phase, backend, dataDirectory, uploadDirectory, archiveRoot, identityPath] = process.argv.slice(2);
if (!['validated', 'blobs-ready', 'activating'].includes(phase)) throw new Error('INVALID_TEST_PHASE');
if (!['embedded', 'postgres'].includes(backend)) throw new Error('INVALID_TEST_BACKEND');
const identity = JSON.parse(await readFile(identityPath, 'utf8')) as BundleImportIdentity;
const store = backend === 'postgres'
  ? PostgresWorkspaceStore.fromConnectionString(process.env.DATABASE_URL!, identity.workspaceId, `${dataDirectory}.content`)
  : await openEmbeddedWorkspaceStore(dataDirectory, identity.workspaceId, 'verify');
const staged = await new NodeImportArchiveStore(archiveRoot).stage(identity.archiveDigest);
try {
  const checkpoint = await store.bundleImportCheckpoints.begin(identity);
  if (phase !== 'validated') {
    const legacy = new NodeFilesystemBlobStore(uploadDirectory);
    const blobs = new NodeEncryptedBlobStore(new NodeSealedContentStore(
      legacy, new NodeContentKeys(join(uploadDirectory, 'resource-keys')),
    ), legacy);
    const targetFacts = await ingestPortableWorkspace(staged, blobs);
    await store.bundleImportCheckpoints.markBlobsReady(identity.importId, identity.ownerId, checkpoint.revision);
    if (phase === 'activating') {
      process.stdout.write('STAGE:blobs-ready\n');
      const pauseAfterProjectInsert = async <Row = Record<string, unknown>>(query: SqlQueryable, sql: string, values?: unknown[]) => {
        const result = await query.query<Row>(sql, values);
        if (sql.startsWith('INSERT INTO rhiza_projects(id,title,state)')) {
          process.stdout.write('CHECKPOINT:activating\n');
          await new Promise<void>(() => { setInterval(() => undefined, 1000); });
        }
        return result;
      };
      if (backend === 'postgres') {
        const database = (store as unknown as { database: { connect(...args: unknown[]): unknown } }).database;
        const original = database.connect.bind(database);
        database.connect = ((...args: unknown[]) => {
          if (args.length) return original(...args);
          return (original() as Promise<SqlQueryable & { release(): void }>).then(client => ({
            query: <Row = Record<string, unknown>>(sql: string, values?: unknown[]) =>
              pauseAfterProjectInsert<Row>(client, sql, values),
            release: () => client.release(),
          }));
        });
      } else {
        const database = (store as unknown as { database: { transaction<T>(callback: (query: SqlQueryable) => Promise<T>): Promise<T> } }).database;
        const original = database.transaction.bind(database);
        database.transaction = <T>(callback: (query: SqlQueryable) => Promise<T>) => original(async query => callback({
          query: <Row = Record<string, unknown>>(sql: string, values?: unknown[]) => pauseAfterProjectInsert<Row>(query, sql, values),
        }));
      }
      process.stdout.write('STAGE:activation-start\n');
      await completeBundleImport(identity, staged.facts, store.bundleImportCheckpoints, async () => targetFacts,
        new RepositoryWorkspaceUnitOfWork(store));
      throw new Error('ACTIVATION_DID_NOT_PAUSE');
    }
  }
  process.stdout.write(`CHECKPOINT:${phase}\n`);
  await new Promise<void>(() => { setInterval(() => undefined, 1000); });
} finally { await staged.dispose(); await store.close(); }
