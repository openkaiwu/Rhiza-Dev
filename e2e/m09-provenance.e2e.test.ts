// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from '../scripts/migrate';
import { PostgresWorkspaceStore } from '../server/postgres-store';
import { createSeedWorkspace } from '../server/seed';

describe('M09 provenance persistence', () => {
  it('backfills evidence idempotently and rolls back outputs when provenance persistence fails', async () => {
    const database = new PGlite();
    try {
      for (const migration of await loadMigrations()) await database.exec(migration.sql);
      const store = new PostgresWorkspaceStore(database);
      const workspace = await store.initialize(createSeedWorkspace());
      const outputs = workspace.messages.filter(message => message.kind === 'assistant');
      // Represent an existing aggregate whose provenance has not yet been backfilled.
      await database.query('DELETE FROM provenance_links');
      expect(await store.auditProvenanceCoverage()).toEqual({ outputs: outputs.length, missing: outputs.length, broken: 0, invalid: 0 });
      expect(await store.backfillProvenance()).toBe(outputs.length);
      expect(await store.auditProvenanceCoverage()).toEqual({ outputs: outputs.length, missing: 0, broken: 0, invalid: 0 });
      const before = (await database.query('SELECT record FROM provenance_links ORDER BY output_ref')).rows;
      expect(await store.backfillProvenance()).toBe(0);
      expect((await database.query('SELECT record FROM provenance_links ORDER BY output_ref')).rows).toEqual(before);
      for (const output of outputs) expect(await store.readProvenance(output.id)).toMatchObject({ outputRef: output.id, status: 'pre-run' });
      const outputId = randomUUID();
      const failing = new PostgresWorkspaceStore({ query: database.query.bind(database), transaction: work => database.transaction(transaction => work({
        query: async <Row>(sql: string, values?: unknown[]) => {
          if (sql.startsWith('INSERT INTO provenance_links')) throw new Error('injected provenance failure');
          return transaction.query<Row>(sql, values);
        },
      })) });
      await expect(failing.update(current => ({ ...current, messages: [...current.messages, {
        id: outputId, nodeId: current.activeNodeId, kind: 'assistant', text: 'must roll back', createdAt: current.updatedAt,
      }] }))).rejects.toThrow('injected provenance failure');
      expect((await store.read()).messages.some(message => message.id === outputId)).toBe(false);
      expect(await store.readProvenance(outputId)).toBeUndefined();
      expect((await database.query('SELECT record FROM provenance_links ORDER BY output_ref')).rows).toEqual(before);
      await database.query("UPDATE provenance_links SET record=jsonb_set(record,'{status}','\"broken-reference\"'::jsonb) WHERE output_ref=$1", [outputs[0].id]);
      expect(await store.auditProvenanceCoverage()).toEqual({ outputs: outputs.length, missing: 0, broken: 1, invalid: 0 });
      await database.query("UPDATE provenance_links SET record=jsonb_set(record,'{status}','\"unknown\"'::jsonb) WHERE output_ref=$1", [outputs[0].id]);
      expect(await store.auditProvenanceCoverage()).toEqual({ outputs: outputs.length, missing: 0, broken: 0, invalid: 1 });
    } finally { await database.close(); }
  });
});
