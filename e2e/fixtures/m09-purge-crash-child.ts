import { Pool } from 'pg';
import { PostgresWorkspaceStore } from '../../server/postgres-store';
import { SealedNodeContent } from '../../server/infrastructure/sealed-node-content';

const [schema, workspaceId, contentDirectory] = process.argv.slice(2);
if (!/^[a-z0-9_]+$/.test(schema ?? '') || !workspaceId || !contentDirectory || !process.env.DATABASE_URL) {
  throw new Error('PURGE_CRASH_TEST_INPUT_INVALID');
}
const database = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
const content = SealedNodeContent.atDirectory(contentDirectory);
const destroy = content.destroy.bind(content);
content.destroy = async (...args) => {
  await destroy(...args);
  process.kill(process.pid, 'SIGKILL');
};
await new PostgresWorkspaceStore(database, workspaceId, undefined, undefined, undefined, undefined, undefined, content).resumePendingPurges();
throw new Error('PURGE_CRASH_CHECKPOINT_NOT_REACHED');
